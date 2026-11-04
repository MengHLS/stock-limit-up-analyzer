/**
 * RESEARCH-EXPERIMENT-004 — Manifest 构造与校验（规格 §10 / §11）。
 *
 * ## Manifest 的定位
 *
 * `manifest.json` 是**这一次 Run 到底产出了什么**的唯一索引：
 *
 * ```
 * { schemaVersion, experimentCode, experimentVersion, runId, datasetVersionId, createdAt,
 *   result: { key, format, … } | null,
 *   tables: [...], charts: [...], artifacts: [...] }
 * ```
 *
 * 🔴 三条纪律：
 *   1. **`result` 是引用不是内容** —— 结果信封本体在 `result.json`，Manifest 只指路；
 *   2. **不同实验的 Result 结构不同** ⇒ Manifest **不描述结果字段**（规格 §11：
 *      禁设计全局固定 Result 表）。它只描述「产物在哪、是什么类型」；
 *   3. **Key 一律由 `artifactStorage/objectKey.ts` 生成**，本文件不手拼路径。
 *
 * ## 校验发生在写入之后、落库之前
 *
 * 顺序是「**上传 → 生成 Manifest → 校验 Artifact 存在 → 写 `resultManifestKey` → COMPLETED**」
 * （规格 §12）。本文件提供 `validateRunManifest`（结构与自洽）与
 * `verifyManifestArtifacts`（**真去存储问一遍**），两者都过才允许置 COMPLETED。
 */

import {
  EXPERIMENT_MANIFEST_SCHEMA_VERSION,
  experimentRunManifestSchema,
  type ExperimentArtifactKind,
  type ExperimentArtifactRef,
  type ExperimentRunManifest,
} from "@shared/researchExperimentsContracts";
import { ExperimentError } from "../errors";
import type { ArtifactObjectMetadata, ArtifactStorage } from "../../artifactStorage/types";

/** 角色 → 默认 kind（扩展名可以覆盖它，见 `inferArtifactDescriptor`）。 */
export type ArtifactRole = "result" | "table" | "chart" | "log" | "artifact";

/** 扩展名 → (kind, format, contentType)。 */
const EXTENSION_TABLE: Readonly<Record<string, { kind: ExperimentArtifactKind; format: string; contentType: string }>> = {
  ".json": { kind: "TABLE", format: "json", contentType: "application/json" },
  ".csv": { kind: "CSV", format: "csv", contentType: "text/csv; charset=utf-8" },
  ".tsv": { kind: "CSV", format: "tsv", contentType: "text/tab-separated-values; charset=utf-8" },
  ".parquet": { kind: "PARQUET", format: "parquet", contentType: "application/vnd.apache.parquet" },
  ".log": { kind: "LOG", format: "text", contentType: "text/plain; charset=utf-8" },
  ".txt": { kind: "LOG", format: "text", contentType: "text/plain; charset=utf-8" },
  ".svg": { kind: "CHART", format: "svg", contentType: "image/svg+xml" },
  ".png": { kind: "IMAGE", format: "png", contentType: "image/png" },
  ".jpg": { kind: "IMAGE", format: "jpg", contentType: "image/jpeg" },
  ".jpeg": { kind: "IMAGE", format: "jpeg", contentType: "image/jpeg" },
  ".webp": { kind: "IMAGE", format: "webp", contentType: "image/webp" },
  ".html": { kind: "CHART", format: "html", contentType: "text/html; charset=utf-8" },
};

/** 取扩展名（小写，含点；无扩展名返回空串）。 */
export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  if (index < 0) return "";
  return name.slice(index).toLowerCase();
}

/** 由「角色 + 名字」推断 (kind, format, contentType)。规则**确定性**、无猜测。 */
export function inferArtifactDescriptor(
  role: ArtifactRole,
  name: string,
): { kind: ExperimentArtifactKind; format: string; contentType: string } {
  const byExtension = EXTENSION_TABLE[extensionOf(name)];
  if (byExtension) {
    /**
     * 角色优先于扩展名的**三处**：结果文件、纯文本日志、以及「其它产物」。
     *
     * 🔴 第三处是 `9cl`（EXP-002 首次声明 `.json` 文件产物）实测暴露的缺陷：
     *    原实现只让 `result` / `log` 覆盖扩展名，于是 `role: "artifact"` + `name:
     *    "robustness-run.json"` 被 `.json` 扩展名改判成 `kind: "TABLE"`
     *    ⇒ `artifactPublisher` 的**按 `kind` 分桶**（见该文件 `buildRunManifest` 调用处注释
     *    「角色分层：table → tables 段、chart → charts 段、log/artifact → artifacts 段」）
     *    把一份 **JSON 文档**放进 `manifest.tables`，页面上显示为「tables（表格）」+ TABLE 徽章。
     *    也就是说：**代码与它自己声明的分桶契约矛盾**，而当时没有任何测试覆盖
     *    `inferArtifactDescriptor` 的角色优先级（因此静默存活）。
     *
     * `.json → TABLE` 这条映射本身**保留**（对 `role: "table"` 是刻意的：允许表状 JSON）；
     * 只有显式声明为「其它产物」时，扩展名不再把它拉回表格桶。
     */
    if (role === "result") return { kind: "RESULT", format: "json", contentType: "application/json" };
    if (role === "log") return { kind: "LOG", format: byExtension.format, contentType: byExtension.contentType };
    if (role === "artifact") {
      return { kind: "OTHER", format: byExtension.format, contentType: byExtension.contentType };
    }
    return byExtension;
  }
  switch (role) {
    case "result":
      return { kind: "RESULT", format: "json", contentType: "application/json" };
    case "table":
      return { kind: "TABLE", format: "binary", contentType: "application/octet-stream" };
    case "chart":
      return { kind: "CHART", format: "binary", contentType: "application/octet-stream" };
    case "log":
      return { kind: "LOG", format: "text", contentType: "text/plain; charset=utf-8" };
    default:
      return { kind: "OTHER", format: "binary", contentType: "application/octet-stream" };
  }
}

/** 装配一个 Artifact 索引项（元数据来自**上传后的真实回报**，不是调用方猜的）。 */
export function artifactRefFromMetadata(args: {
  key: string;
  kind: ExperimentArtifactKind;
  format: string;
  label: string;
  description?: string | null;
  metadata: ArtifactObjectMetadata;
  createdAt?: string | null;
}): ExperimentArtifactRef {
  return {
    key: args.key,
    kind: args.kind,
    format: args.format,
    contentType: args.metadata.contentType,
    sizeBytes: args.metadata.sizeBytes,
    createdAt: args.createdAt ?? args.metadata.lastModified ?? null,
    label: args.label,
    ...(args.description !== undefined ? { description: args.description } : {}),
  };
}

export interface BuildRunManifestInput {
  experimentId: string;
  experimentVersion: string;
  experimentCodeDigest: string;
  runId: string;
  datasetVersionId: number;
  createdAt: string;
  result: ExperimentArtifactRef | null;
  tables?: readonly ExperimentArtifactRef[];
  charts?: readonly ExperimentArtifactRef[];
  artifacts?: readonly ExperimentArtifactRef[];
}

/** 构造 Manifest（顺序稳定：调用方给的顺序，不重排 —— 重排会让 diff 噪音变大）。 */
export function buildRunManifest(input: BuildRunManifestInput): ExperimentRunManifest {
  return {
    schemaVersion: EXPERIMENT_MANIFEST_SCHEMA_VERSION,
    experimentCode: input.experimentId,
    experimentVersion: input.experimentVersion,
    experimentCodeDigest: input.experimentCodeDigest,
    runId: input.runId,
    datasetVersionId: input.datasetVersionId,
    createdAt: input.createdAt,
    result: input.result,
    tables: [...(input.tables ?? [])],
    charts: [...(input.charts ?? [])],
    artifacts: [...(input.artifacts ?? [])],
  };
}

/** 结构校验（zod）+ 自洽校验（坐标必须与期望一致）。 */
export function validateRunManifest(
  raw: unknown,
  expected: { experimentId: string; runId: string; datasetVersionId: number },
): ExperimentRunManifest {
  const parsed = experimentRunManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExperimentError(
      "EXPERIMENT_MANIFEST_INVALID",
      `manifest.json 不符合 Manifest 契约：${parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("；")}`,
      { issues: parsed.error.issues.slice(0, 20) },
    );
  }
  const manifest = parsed.data;
  // 自洽：「这份 Manifest 说的就是这条 Run」——防止把一个 Run 的 Manifest 挪到另一个 Run 上。
  const mismatches: string[] = [];
  if (manifest.experimentCode !== expected.experimentId) {
    mismatches.push(`experimentCode=${manifest.experimentCode} ≠ ${expected.experimentId}`);
  }
  if (manifest.runId !== expected.runId) {
    mismatches.push(`runId=${manifest.runId} ≠ ${expected.runId}`);
  }
  if (manifest.datasetVersionId !== expected.datasetVersionId) {
    mismatches.push(`datasetVersionId=${manifest.datasetVersionId} ≠ ${expected.datasetVersionId}`);
  }
  if (mismatches.length > 0) {
    throw new ExperimentError(
      "EXPERIMENT_MANIFEST_INVALID",
      `manifest.json 的坐标与本次 Run 不一致：${mismatches.join("；")}`,
      { mismatches },
    );
  }
  return manifest;
}

/** 把 JSON 文本解析成 Manifest（解析失败即 `EXPERIMENT_MANIFEST_INVALID`）。 */
export function parseRunManifest(text: string, expected: {
  experimentId: string;
  runId: string;
  datasetVersionId: number;
}): ExperimentRunManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ExperimentError(
      "EXPERIMENT_MANIFEST_INVALID",
      `manifest.json 不是合法 JSON：${(error as Error).message}`,
      { runId: expected.runId },
    );
  }
  return validateRunManifest(raw, expected);
}

/** Manifest 里全部 Artifact 索引项（result + tables + charts + artifacts）。 */
export function manifestArtifactRefs(manifest: ExperimentRunManifest): ExperimentArtifactRef[] {
  return [
    ...(manifest.result === null ? [] : [manifest.result]),
    ...manifest.tables,
    ...manifest.charts,
    ...manifest.artifacts,
  ];
}

/** Manifest 里全部 Object Key（**下载入口的授权白名单**）。 */
export function manifestArtifactKeys(manifest: ExperimentRunManifest): Set<string> {
  return new Set(manifestArtifactRefs(manifest).map((ref) => ref.key));
}

/** 按 Key 找索引项；找不到返回 null。 */
export function findManifestArtifact(
  manifest: ExperimentRunManifest,
  key: string,
): ExperimentArtifactRef | null {
  return manifestArtifactRefs(manifest).find((ref) => ref.key === key) ?? null;
}

/** 校验结果：逐个 Artifact 的存在性实测。 */
export interface ManifestVerificationResult {
  verified: boolean;
  present: string[];
  missing: string[];
}

/**
 * **真去存储问一遍**：Manifest 里每个非 `result` 的产物是否都存在。
 *
 * 🔴 为什么要实测而不是「上传成功就当成在了」：对象可能被外部生命周期策略删掉、
 *    也可能桶/权限变更导致 PUT 成功而 HEAD 失败。规格 §13 情况 C 要的正是这个判据。
 *    `skipKinds` 允许跳过「刚刚在同一请求里上传过、已由 `put()` 返回值证明」的项，
 *    但**默认不跳过任何项**（保守优先）。
 */
export async function verifyManifestArtifacts(
  storage: ArtifactStorage,
  manifest: ExperimentRunManifest,
): Promise<ManifestVerificationResult> {
  const refs = manifestArtifactRefs(manifest);
  const present: string[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const ok = await storage.exists(ref.key);
    (ok ? present : missing).push(ref.key);
  }
  return { verified: missing.length === 0, present, missing };
}
