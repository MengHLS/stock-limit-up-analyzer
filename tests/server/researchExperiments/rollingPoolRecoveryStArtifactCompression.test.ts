/**
 * `SORT-PARITY-008` §5 —— **无损压缩交付**回归。
 *
 * 覆盖目标 §5 要求的回归项：
 *   1. 大件压缩（≥1 MiB ⇒ `.csv.gz`，`application/gzip`，**真实二进制 body**）；
 *   2. 解压内容**逐字节一致**（原文 SHA-256 相等，行/列/顺序/数值不变）；
 *   3. manifest 可定位（走**真实** `publishRunArtifacts`）；
 *   4. 后端读取返回的是**压缩字节**（不是被当字符串处理过的内容）；
 *   5. 分析工具口径的解析函数（`parseCsvText` / `csvTextToObjects`）能**按编码**读回并解析；
 *   6. 旧普通 CSV 兼容（< 门槛 ⇒ 仍叫 `.csv`、`text/csv`）；
 *   7. 单件 / 总量 / 件数限制**仍然有效**（平台常量未被抬高）。
 *
 * 🔴 用**内存 ArtifactStorage** 完成发布 → 读回，不另建大回测来验证存储。
 */

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_ARTIFACT_MAX_COUNT,
  EXPERIMENT_ARTIFACT_MAX_SINGLE_BYTES,
  EXPERIMENT_ARTIFACT_MAX_TOTAL_BYTES,
  EXPERIMENT_RESULT_JSON_MAX_BYTES,
} from "../../../shared/researchExperimentsContracts";
import { validatePublishLimits } from "../../../server/researchExperiments/persistence/artifactPublisher";
import {
  ARTIFACT_COMPRESSION_CONTENT_TYPE,
  ARTIFACT_COMPRESSION_THRESHOLD_BYTES,
  compressionIndexCsvOf,
  packArtifactForDelivery,
  type ArtifactCompressionIndexEntry,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment";
import {
  csvTextToObjects,
  parseCsvText,
  verifyDeliveryBudgetAndReadBack,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/deliveryVerification";

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes).digest("hex");

/** 造一份 ≥1 MiB 的 CSV（行内含逗号 / 引号，检验 CSV 解析没有被压缩打乱）。 */
function makeLargeCsv(rows: number): string {
  const lines = ["group,anchorEventId,symbol,note"];
  for (let index = 0; index < rows; index += 1) {
    // 与 `experiment.ts#toCsv` 同口径转义：含逗号/引号 ⇒ 加引号，内部 `"` 写成 `""`。
    const note = index % 3 === 0 ? '"has,comma"' : (index % 3 === 1 ? '"has""quote"' : "plain");
    lines.push(`A_STRICT_20,evt-${index},${String(index).padStart(6, "0")}.SZ,${note}`);
  }
  return lines.join("\n");
}

/** 把一批产物按实验打包层的方式成包（含压缩索引自身）。 */
function packAll(specs: readonly { name: string; role: "table" | "artifact"; body: string; compressible?: boolean }[]): {
  readonly files: { name: string; role: "table" | "artifact"; body: string | Uint8Array; contentType: string }[];
  readonly entries: readonly ArtifactCompressionIndexEntry[];
} {
  const entries: ArtifactCompressionIndexEntry[] = [];
  const files: { name: string; role: "table" | "artifact"; body: string | Uint8Array; contentType: string }[] = [];
  for (const spec of specs) {
    const { packed, indexEntry } = packArtifactForDelivery({
      name: spec.name,
      role: spec.role,
      body: spec.body,
      contentType: "text/csv",
      ...(spec.compressible === undefined ? {} : { compressible: spec.compressible }),
    });
    entries.push(indexEntry);
    files.push({ name: packed.name, role: packed.role, body: packed.body, contentType: packed.contentType });
  }
  files.push({
    name: "artifact-compression-index.csv",
    role: "table",
    body: compressionIndexCsvOf(entries),
    contentType: "text/csv",
  });
  return { files, entries };
}

// ---------------------------------------------------------------------------
// 1) 打包层行为
// ---------------------------------------------------------------------------

describe("1) 打包层：门槛 / MIME / 二进制 body / 无损（§5）", () => {
  it("低于 1 MiB ⇒ 仍按原文交付（旧普通 CSV 路径完全不变）", () => {
    const body = "a,b\n1,2";
    const { packed, indexEntry } = packArtifactForDelivery({
      name: "small.csv", role: "table", body, contentType: "text/csv",
    });
    expect(packed.name).toBe("small.csv");
    expect(packed.contentType).toBe("text/csv");
    expect(packed.body).toBe(body);
    expect(indexEntry.encoding).toBe("identity");
    expect(indexEntry.originalBytes).toBe(Buffer.byteLength(body, "utf8"));
    expect(indexEntry.deliveredBytes).toBe(indexEntry.originalBytes);
    expect(indexEntry.originalSha256).toBe(sha256(body));
    expect(indexEntry.lineCount).toBe(2);
  });

  it("达到门槛 ⇒ `.csv.gz` + `application/gzip` + 真二进制 body，解压后 SHA-256 一致", () => {
    const body = makeLargeCsv(40_000);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThanOrEqual(ARTIFACT_COMPRESSION_THRESHOLD_BYTES);
    const { packed, indexEntry } = packArtifactForDelivery({
      name: "opportunity-day-attribution.csv", role: "table", body, contentType: "text/csv",
    });
    expect(packed.name).toBe("opportunity-day-attribution.csv.gz");
    expect(packed.contentType).toBe(ARTIFACT_COMPRESSION_CONTENT_TYPE);
    expect(packed.body).toBeInstanceOf(Uint8Array);
    expect(typeof packed.body).not.toBe("string");
    const compressed = Buffer.from(packed.body as Uint8Array);
    /** ④ 交付的确实是**压缩字节**（不是原文）。 */
    expect(compressed.equals(Buffer.from(body, "utf8"))).toBe(false);
    expect(compressed.byteLength).toBeLessThan(Buffer.byteLength(body, "utf8"));
    /** ② 解压内容逐字节一致。 */
    const restored = gunzipSync(compressed);
    expect(restored.equals(Buffer.from(body, "utf8"))).toBe(true);
    expect(sha256(restored)).toBe(indexEntry.originalSha256);
    expect(indexEntry.encoding).toBe("gzip");
    expect(indexEntry.deliveredBytes).toBe(compressed.byteLength);
    expect(indexEntry.originalBytes).toBe(Buffer.byteLength(body, "utf8"));
    expect(indexEntry.lineCount).toBe(body.split("\n").length);
  });

  it("`compressible: false` ⇒ 即使超门槛也按原文交付", () => {
    const body = makeLargeCsv(40_000);
    const { packed, indexEntry } = packArtifactForDelivery({
      name: "artifact-compression-index.csv", role: "table", body, contentType: "text/csv", compressible: false,
    });
    expect(packed.name).toBe("artifact-compression-index.csv");
    expect(packed.body).toBe(body);
    expect(indexEntry.encoding).toBe("identity");
  });

  it("大件 CSV 的行/列/顺序/数值无损保留（含逗号与引号字段）", () => {
    const body = makeLargeCsv(40_000);
    const { packed } = packArtifactForDelivery({ name: "big.csv", role: "table", body, contentType: "text/csv" });
    const restored = gunzipSync(Buffer.from(packed.body as Uint8Array)).toString("utf8");
    expect(restored).toBe(body);
    const objects = csvTextToObjects(restored);
    expect(objects).toHaveLength(40_000);
    expect(objects[0]).toEqual({ group: "A_STRICT_20", anchorEventId: "evt-0", symbol: "000000.SZ", note: "has,comma" });
    expect(objects[1]!.note).toBe('has"quote');
    expect(objects[2]!.note).toBe("plain");
    expect(objects[39_999]!.anchorEventId).toBe("evt-39999");
    expect(parseCsvText(restored).header).toEqual(["group", "anchorEventId", "symbol", "note"]);
  });

  it("压缩索引 CSV 自身可解析，且逻辑名 → 实际对象名映射完整", () => {
    const { entries } = packAll([
      { name: "big.csv", role: "table", body: makeLargeCsv(40_000) },
      { name: "small.csv", role: "table", body: "a,b\n1,2" },
    ]);
    const rows = csvTextToObjects(compressionIndexCsvOf(entries));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ logicalName: "big.csv", objectName: "big.csv.gz", encoding: "gzip" });
    expect(rows[1]).toMatchObject({ logicalName: "small.csv", objectName: "small.csv", encoding: "identity" });
    expect(rows[0]!.originalSha256).toHaveLength(64);
    expect(Number(rows[0]!.lineCount)).toBe(40_001);
  });
});

// ---------------------------------------------------------------------------
// 2) 发布 → 读回（真实发布器 + 内存 ArtifactStorage）
// ---------------------------------------------------------------------------

const RESULT_ENVELOPE = {
  metadata: {
    experimentId: "first-board-pullback/rolling-pool-recovery-st",
    experimentName: "sort-parity-008-compression-test",
    experimentVersion: "1.0.0",
    experimentCodeDigest: "exp-code-sha256:test",
    datasetVersionId: 780_004,
    datasetCode: "first_limit_pullback",
    datasetVersionLabel: "v10-listed365-pre10-post80",
    runMode: "SMOKE",
    generatedAt: "2026-10-11T00:00:00.000Z",
  },
  parameters: { randomAccountCount: 2, stPolicy: "known-st-only" },
  sampleSummary: { candidateCount: 1, eligibleCount: 1, excludedCount: 0, excludedByReason: {}, notes: [] },
  customPayload: { note: "compression delivery test" },
};

async function publishFixture(): Promise<Awaited<ReturnType<typeof verifyDeliveryBudgetAndReadBack>>> {
  const { files } = packAll([
    { name: "opportunity-day-attribution.csv", role: "table", body: makeLargeCsv(40_000) },
    { name: "observation-repair-ledger-A-2024.csv", role: "table", body: makeLargeCsv(30_000) },
    { name: "trades-R-A_STRICT_20.csv", role: "table", body: "group,account\ng,A" },
    { name: "frozen-config.json", role: "artifact", body: JSON.stringify({ computationVersion: "1.0.0" }) },
  ]);
  return verifyDeliveryBudgetAndReadBack({
    experimentId: "first-board-pullback/rolling-pool-recovery-st",
    experimentVersion: "1.0.0",
    experimentCodeDigest: "exp-code-sha256:test",
    runId: "RUN-20261012-TESTCOMPRESS",
    datasetVersionId: 780_004,
    createdAt: "2026-10-12T00:00:00.000Z",
    result: RESULT_ENVELOPE as never,
    logs: ["log-line-1", "log-line-2"],
    artifactFiles: files,
  });
}

describe("2) 发布 → 读回：预算通过、解压哈希一致、manifest 可定位（§5）", () => {
  it("混合产物：2 件压缩 + 2 件原文 + 索引；预算与读回全通过", async () => {
    const report = await publishFixture();
    expect(report.withinLimits).toBe(true);
    expect(report.limitError).toBeNull();
    expect(report.compressedObjectNames.sort()).toEqual([
      "observation-repair-ledger-A-2024.csv.gz",
      "opportunity-day-attribution.csv.gz",
    ]);
    expect(report.identityObjectNames).toContain("trades-R-A_STRICT_20.csv");
    expect(report.identityObjectNames).toContain("artifact-compression-index.csv");
    expect(report.decompressionChecks).toHaveLength(2);
    for (const check of report.decompressionChecks) {
      expect(check.match).toBe(true);
      expect(check.deliveredIsNotPlainText).toBe(true);
      expect(check.recomputedSha256).toBe(check.originalSha256);
      expect(check.deliveredBytes).toBeLessThan(check.originalBytes);
    }
    expect(report.manifestKey).not.toBeNull();
    expect(report.manifestKey!).toContain("RUN-20261012-TESTCOMPRESS/manifest.json");
    expect(report.manifestVerificationPassed).toBe(true);
    expect(report.everyManifestObjectReadable).toBe(true);
    expect(report.readBackOk).toBe(true);
    /** 对象数 = 产物 5 件 + result.json + logs/run.log + manifest.json */
    expect(report.publishedObjectCount).toBe(5 + 3);
    expect(report.largestSingleBytes).toBeLessThan(report.artifactMaxSingleBytes);
    expect(report.totalDeliveredBytes).toBeLessThan(report.artifactMaxTotalBytes);
  });

  it("缺压缩索引 ⇒ 读回**不通过**（索引是 gzip 校验的必要证据）", async () => {
    const big = makeLargeCsv(40_000);
    const { packed } = packArtifactForDelivery({ name: "big.csv", role: "table", body: big, contentType: "text/csv" });
    const report = await verifyDeliveryBudgetAndReadBack({
      experimentId: "first-board-pullback/rolling-pool-recovery-st",
      experimentVersion: "1.0.0",
      experimentCodeDigest: "exp-code-sha256:test",
      runId: "RUN-20261012-NOINDEX",
      datasetVersionId: 780_004,
      createdAt: "2026-10-12T00:00:00.000Z",
      result: RESULT_ENVELOPE as never,
      logs: [],
      artifactFiles: [{ name: packed.name, role: packed.role, body: packed.body, contentType: packed.contentType }],
    });
    expect(report.withinLimits).toBe(true);
    expect(report.decompressionChecks[0]!.match).toBe(false);
    expect(report.readBackOk).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3) 限制仍然有效（不抬高平台上限、不放松校验）
// ---------------------------------------------------------------------------

describe("3) 单件 / 总量 / 件数限制仍然有效（§5）", () => {
  /** 领域错误的**码**才是判据（message 是人读说明，会随文案变化）。 */
  function expectLimitExceeded(run: () => void): string {
    try {
      run();
    } catch (error) {
      const code = (error as { code?: string }).code;
      expect(code).toBe("EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED");
      return (error as Error).message;
    }
    throw new Error("预期抛 EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED，但调用没有抛错");
  }

  const baseInput = {
    storage: null as never,
    experimentId: "first-board-pullback/rolling-pool-recovery-st",
    experimentVersion: "1.0.0",
    experimentCodeDigest: "exp-code-sha256:test",
    runId: "RUN-20261012-LIMITS",
    datasetVersionId: 780_004,
    createdAt: "2026-10-12T00:00:00.000Z",
    result: RESULT_ENVELOPE as never,
    logs: [] as string[],
  };

  it("平台默认常量**未被抬高**：64 MiB / 256 MiB / 100 件 / result 8 MiB", () => {
    expect(EXPERIMENT_ARTIFACT_MAX_SINGLE_BYTES).toBe(64 * 1024 * 1024);
    expect(EXPERIMENT_ARTIFACT_MAX_TOTAL_BYTES).toBe(256 * 1024 * 1024);
    expect(EXPERIMENT_ARTIFACT_MAX_COUNT).toBe(100);
    expect(EXPERIMENT_RESULT_JSON_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(ARTIFACT_COMPRESSION_THRESHOLD_BYTES).toBe(1024 * 1024);
  });

  it("单件超限 ⇒ `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`", () => {
    const message = expectLimitExceeded(() => validatePublishLimits(
      { ...baseInput, artifactFiles: [{ name: "big.csv", role: "table", body: "x".repeat(1_001) }] } as never,
      null,
      {
        resultJsonMaxBytes: 1024, resultTableMaxRows: 10, resultTableMaxCells: 10,
        artifactMaxCount: 10, artifactMaxSingleBytes: 1_000, artifactMaxTotalBytes: 10_000,
      },
    ));
    expect(message).toContain("超过单文件上限");
  });

  it("总量超限 ⇒ `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`", () => {
    const message = expectLimitExceeded(() => validatePublishLimits(
      {
        ...baseInput,
        artifactFiles: [
          { name: "a.csv", role: "table", body: "x".repeat(600) },
          { name: "b.csv", role: "table", body: "x".repeat(600) },
        ],
      } as never,
      null,
      {
        resultJsonMaxBytes: 1024, resultTableMaxRows: 10, resultTableMaxCells: 10,
        artifactMaxCount: 10, artifactMaxSingleBytes: 1_000, artifactMaxTotalBytes: 1_000,
      },
    ));
    expect(message).toContain("产物总量");
  });

  it("件数超限 ⇒ `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`", () => {
    const message = expectLimitExceeded(() => validatePublishLimits(
      {
        ...baseInput,
        artifactFiles: [
          { name: "a.csv", role: "table", body: "x" },
          { name: "b.csv", role: "table", body: "x" },
        ],
      } as never,
      null,
      {
        resultJsonMaxBytes: 1024, resultTableMaxRows: 10, resultTableMaxCells: 10,
        artifactMaxCount: 3, artifactMaxSingleBytes: 1_000, artifactMaxTotalBytes: 10_000,
      },
    ));
    expect(message).toContain("超过上限");
  });

  it("件数按平台规则计入 result + logs + 运行日志对象（不是只数产物）", () => {
    /** 0 件产物时仍预告 3 个对象（result.json + logs/run.log + manifest.json）。 */
    const message = expectLimitExceeded(() => validatePublishLimits(
      { ...baseInput, artifactFiles: [] } as never,
      null,
      {
        resultJsonMaxBytes: 1024, resultTableMaxRows: 10, resultTableMaxCells: 10,
        artifactMaxCount: 2, artifactMaxSingleBytes: 1_000, artifactMaxTotalBytes: 10_000,
      },
    ));
    expect(message).toContain("预计写出 3 个对象");
  });
});
