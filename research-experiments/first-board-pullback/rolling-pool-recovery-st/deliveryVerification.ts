/**
 * `SORT-PARITY-008` §5 —— **交付预算校验与压缩读回**（实验侧，不新增平台能力）。
 *
 * ## 它解决的问题
 *
 * 007 的教训：42 账户**算完了**，但 `observation-repair-ledger-A_STRICT_20-2024.csv`
 * （99,097,445 B）超过平台单件上限 67,108,864 B ⇒ Run 记 `FAILED`、`resultManifestKey = null`，
 * 交付物**根本读不回来**；而本地落盘成功**不能**证明发布通过。
 *
 * 因此 SMOKE 必须调用**平台既有的** `validatePublishLimits`（同一份上限常量、同一套
 * 「result + logs + 产物件数/单件/总量」规则），并真的走一次
 * `publishRunArtifacts`（**只写内存 ArtifactStorage**，不碰生产对象存储）
 * 来证明：manifest 可定位、每个对象真的能读回、`.csv.gz` 解压后 SHA-256 与原文一致。
 *
 * 🔴 本模块**不修改**任何平台上限（单件 64 MiB / 总量 256 MiB / 100 件），
 *    也不新增全局自动压缩路径；压缩发生在实验的产物打包层（`experiment.ts#packArtifactForDelivery`）。
 */

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { InMemoryArtifactStorage } from "../../../server/artifactStorage/inMemoryArtifactStorage";
import {
  DEFAULT_EXPERIMENT_PUBLISH_LIMITS,
  publishRunArtifacts,
  validatePublishLimits,
  type PublishRunArtifactsInput,
} from "../../../server/researchExperiments/persistence/artifactPublisher";
import type {
  ExperimentArtifactFileSpec,
  ExperimentResultEnvelope,
} from "@shared/researchExperimentsContracts";

/** 交付产物的最小形状（`ExperimentArtifactFileSpec` 的窄化视图）。 */
export interface DeliveryArtifactLike {
  readonly name: string;
  readonly role: "table" | "chart" | "log" | "artifact";
  readonly body: string | Uint8Array;
  readonly contentType?: string;
  readonly label?: string;
  readonly description?: string;
}

/** 单件 gzip 的解压核对结果。 */
export interface DecompressionCheck {
  readonly objectName: string;
  readonly logicalName: string;
  readonly deliveredBytes: number;
  readonly originalBytes: number;
  readonly originalSha256: string;
  readonly recomputedSha256: string;
  readonly match: boolean;
  readonly deliveredIsNotPlainText: boolean;
}

/** 交付预算 + 读回报告（**只用事实字段**；不参与任何研究计算）。 */
export interface DeliveryBudgetReport {
  readonly withinLimits: boolean;
  readonly limitError: string | null;
  /** 实验声明的文件产物件数。 */
  readonly artifactFileCount: number;
  /** 本次 Run 实际写出的对象数（= 产物 + result + logs/run.log + manifest）。 */
  readonly publishedObjectCount: number;
  readonly artifactMaxCount: number;
  readonly largestSingleName: string | null;
  readonly largestSingleBytes: number;
  readonly artifactMaxSingleBytes: number;
  readonly totalDeliveredBytes: number;
  readonly artifactMaxTotalBytes: number;
  readonly resultJsonBytes: number;
  readonly resultJsonMaxBytes: number;
  readonly compressedObjectNames: readonly string[];
  readonly identityObjectNames: readonly string[];
  readonly decompressionChecks: readonly DecompressionCheck[];
  readonly manifestKey: string | null;
  readonly manifestObjectCount: number;
  readonly manifestVerificationPassed: boolean;
  readonly everyManifestObjectReadable: boolean;
  readonly readBackOk: boolean;
  readonly notes: readonly string[];
}

/** 交付校验入参（与实验 Run 坐标一致的执行事实）。 */
export interface DeliveryVerificationInput {
  readonly experimentId: string;
  readonly experimentVersion: string;
  readonly experimentCodeDigest: string;
  /** 仅用于构造对象前缀；SMOKE 不持久化 ⇒ 用 `SMOKE-…` 形式即可。 */
  readonly runId: string;
  readonly datasetVersionId: number;
  readonly createdAt: string;
  readonly result: ExperimentResultEnvelope | null;
  readonly logs: readonly string[];
  readonly artifactFiles: readonly DeliveryArtifactLike[];
}

// ---------------------------------------------------------------------------
// 最小 CSV 读取（引号感知；与 `rollingPoolRecoverySt007Analysis.mts` 同口径）
// ---------------------------------------------------------------------------

/**
 * 极简 CSV 拆行/拆列（引号感知，支持 `""` 转义）。
 *
 * 🔴 只用于**读取本实验自己的产物**（值里不含换行；含逗号/引号的字段由 `toCsv` 加引号）。
 *    把「按编码读回」这件事集中在这里，分析工具与交付校验共用**同一份**解析口径。
 */
export function parseCsvText(text: string): { readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] } {
  const lines = text.replace(/\r\n/gu, "\n").split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const split = (line: string): string[] => {
    const out: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]!;
      if (quoted) {
        if (char === '"') {
          if (line[index + 1] === '"') { current += '"'; index += 1; } else { quoted = false; }
        } else current += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { out.push(current); current = ""; }
      else current += char;
    }
    out.push(current);
    return out;
  };
  return { header: split(lines[0]!), rows: lines.slice(1).map(split) };
}

/** CSV 文本 → 记录数组（列名取自表头）。 */
export function csvTextToObjects(text: string): Record<string, string>[] {
  const parsed = parseCsvText(text);
  return parsed.rows.map((row) => {
    const record: Record<string, string> = {};
    parsed.header.forEach((key, index) => { record[key] = row[index] ?? ""; });
    return record;
  });
}

// ---------------------------------------------------------------------------
// 交付预算 + 发布/读回
// ---------------------------------------------------------------------------

function byteLengthOf(body: string | Uint8Array): number {
  return typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
}

/** 由压缩索引行解析「实际对象名 → 原文 SHA-256」映射。 */
function shaIndexFromCsv(text: string): Map<string, { logicalName: string; originalSha256: string; originalBytes: number; deliveredBytes: number; encoding: string }> {
  const out = new Map<string, { logicalName: string; originalSha256: string; originalBytes: number; deliveredBytes: number; encoding: string }>();
  for (const row of csvTextToObjects(text)) {
    const objectName = row.objectName ?? "";
    if (objectName === "") continue;
    out.set(objectName, {
      logicalName: row.logicalName ?? objectName,
      originalSha256: row.originalSha256 ?? "",
      originalBytes: Number(row.originalBytes ?? "0"),
      deliveredBytes: Number(row.deliveredBytes ?? "0"),
      encoding: row.encoding ?? "",
    });
  }
  return out;
}

/** 空报告（未达发布阶段时使用）。 */
function emptyReport(artifactFileCount: number, notes: readonly string[]): DeliveryBudgetReport {
  return {
    withinLimits: false,
    limitError: null,
    artifactFileCount,
    publishedObjectCount: 0,
    artifactMaxCount: DEFAULT_EXPERIMENT_PUBLISH_LIMITS.artifactMaxCount,
    largestSingleName: null,
    largestSingleBytes: 0,
    artifactMaxSingleBytes: DEFAULT_EXPERIMENT_PUBLISH_LIMITS.artifactMaxSingleBytes,
    totalDeliveredBytes: 0,
    artifactMaxTotalBytes: DEFAULT_EXPERIMENT_PUBLISH_LIMITS.artifactMaxTotalBytes,
    resultJsonBytes: 0,
    resultJsonMaxBytes: DEFAULT_EXPERIMENT_PUBLISH_LIMITS.resultJsonMaxBytes,
    compressedObjectNames: [],
    identityObjectNames: [],
    decompressionChecks: [],
    manifestKey: null,
    manifestObjectCount: 0,
    manifestVerificationPassed: false,
    everyManifestObjectReadable: false,
    readBackOk: false,
    notes: [...notes],
  };
}

/**
 * 走一遍**既有**的发布链（内存 ArtifactStorage）并核对交付预算与读回。
 *
 * 步骤：① 平台预算校验（`validatePublishLimits`，**不放松**）→ ② `publishRunArtifacts`
 * （写 result / 产物 / run.log / manifest，并真去存储 HEAD 一遍）→ ③ 逐对象读回：
 * `.gz` 解压后 SHA-256 必须等于压缩索引里的 `originalSha256`，且字节数与索引一致。
 */
export async function verifyDeliveryBudgetAndReadBack(
  input: DeliveryVerificationInput,
): Promise<DeliveryBudgetReport> {
  const artifactFileCount = input.artifactFiles.length;
  const storage = new InMemoryArtifactStorage();
  const publishInput: PublishRunArtifactsInput = {
    storage,
    experimentId: input.experimentId,
    experimentVersion: input.experimentVersion,
    experimentCodeDigest: input.experimentCodeDigest,
    runId: input.runId,
    datasetVersionId: input.datasetVersionId,
    createdAt: input.createdAt,
    result: input.result,
    logs: input.logs,
    artifactFiles: input.artifactFiles as readonly ExperimentArtifactFileSpec[],
  };
  const resultBody = input.result === null ? null : `${JSON.stringify(input.result, null, 2)}\n`;
  let limitError: string | null = null;
  try {
    validatePublishLimits(publishInput, resultBody, DEFAULT_EXPERIMENT_PUBLISH_LIMITS);
  } catch (error) {
    limitError = error instanceof Error ? error.message : String(error);
  }
  if (limitError !== null) {
    const report = emptyReport(artifactFileCount, [
      "🔴 平台发布预算校验**未通过**：本轮交付按平台既有规则**不允许发布**（不放松校验、不提高上限）。",
      limitError,
    ]);
    return { ...report, limitError };
  }

  const published = await publishRunArtifacts(publishInput);
  const declared = [...published.manifest.tables, ...published.manifest.charts, ...published.manifest.artifacts];
  const indexRef = declared.find((ref) => ref.key.endsWith("/artifact-compression-index.csv")) ?? null;
  let shaIndex = new Map<string, { logicalName: string; originalSha256: string; originalBytes: number; deliveredBytes: number; encoding: string }>();
  if (indexRef !== null) {
    const got = await storage.get(indexRef.key);
    shaIndex = shaIndexFromCsv(got.body.toString("utf8"));
  }

  const compressedObjectNames: string[] = [];
  const identityObjectNames: string[] = [];
  const decompressionChecks: DecompressionCheck[] = [];
  let everyManifestObjectReadable = true;
  const allRefs = [
    ...(published.manifest.result === null ? [] : [published.manifest.result]),
    ...published.manifest.tables,
    ...published.manifest.charts,
    ...published.manifest.artifacts,
  ];
  for (const ref of allRefs) {
    const objectName = ref.key.split("/").pop() ?? ref.key;
    let body: Buffer | null = null;
    try {
      body = (await storage.get(ref.key)).body;
    } catch {
      everyManifestObjectReadable = false;
    }
    if (objectName.endsWith(".gz")) {
      compressedObjectNames.push(objectName);
      if (body === null) continue;
      const restored = gunzipSync(body);
      const recomputedSha256 = createHash("sha256").update(restored).digest("hex");
      const expected = shaIndex.get(objectName) ?? null;
      decompressionChecks.push({
        objectName,
        logicalName: expected?.logicalName ?? objectName.replace(/\.gz$/u, ""),
        deliveredBytes: body.byteLength,
        originalBytes: restored.byteLength,
        originalSha256: expected?.originalSha256 ?? "",
        recomputedSha256,
        match: expected !== null && expected.originalSha256 === recomputedSha256,
        deliveredIsNotPlainText: body.byteLength !== restored.byteLength,
      });
    } else {
      identityObjectNames.push(objectName);
    }
  }

  let largestSingleName: string | null = null;
  let largestSingleBytes = 0;
  let totalDeliveredBytes = 0;
  for (const file of input.artifactFiles) {
    const bytes = byteLengthOf(file.body);
    if (bytes > largestSingleBytes) { largestSingleBytes = bytes; largestSingleName = file.name; }
    totalDeliveredBytes += bytes;
  }
  const resultJsonBytes = resultBody === null ? 0 : Buffer.byteLength(resultBody, "utf8");
  const checksOk = decompressionChecks.every((check) => check.match && check.deliveredIsNotPlainText);
  const readBackOk = everyManifestObjectReadable
    && published.verification.verified
    && checksOk
    && compressedObjectNames.length === decompressionChecks.length;

  return {
    withinLimits: true,
    limitError: null,
    artifactFileCount,
    publishedObjectCount: published.keys.length,
    artifactMaxCount: DEFAULT_EXPERIMENT_PUBLISH_LIMITS.artifactMaxCount,
    largestSingleName,
    largestSingleBytes,
    artifactMaxSingleBytes: DEFAULT_EXPERIMENT_PUBLISH_LIMITS.artifactMaxSingleBytes,
    totalDeliveredBytes,
    artifactMaxTotalBytes: DEFAULT_EXPERIMENT_PUBLISH_LIMITS.artifactMaxTotalBytes,
    resultJsonBytes,
    resultJsonMaxBytes: DEFAULT_EXPERIMENT_PUBLISH_LIMITS.resultJsonMaxBytes,
    compressedObjectNames,
    identityObjectNames,
    decompressionChecks,
    manifestKey: published.manifestKey,
    manifestObjectCount: allRefs.length,
    manifestVerificationPassed: published.verification.verified,
    everyManifestObjectReadable,
    readBackOk,
    notes: [
      "预算判据 = 平台既有 `validatePublishLimits`（同一份上限常量与同一套件数/单件/总量规则）；"
      + "本模块**不**提高 64 MiB / 256 MiB / 100 件，也**不**放松校验。",
      "发布走既有 `publishRunArtifacts`，但 storage 是**内存** ArtifactStorage"
      + "（只为证明 manifest 可定位、对象可读回、`.gz` 解压哈希一致；不写生产对象存储）。",
      "🔴 本地落盘成功**不**等于发布通过：因此这里必须真的跑一遍发布器的预算校验与存在性验证。",
    ],
  };
}
