/**
 * STEP 12.6 — Research Dataset：确定性 dataset_version 派生。
 *
 * dataset_version 语义（C-12.6.1）：
 *   - 覆盖：NormalizedRequest + universeDefinition + rows（全部内容）+ 构建器/schema 版本；
 *   - 内容变则版本必变；同内容必同版本（可复现）；
 *   - 不包含 capturedAt / 瞬时字段（同内容重跑版本稳定）。
 *
 * 算法：canonical JSON（键按字典序递归排序）+ SHA-256 前 16 字节 hex 前缀 + 构建器版本。
 * 纯函数、无 IO；与本项目既有 SHA-256 fingerprint 范式一致（见 research/datasetSplit.ts）。
 */

import { createHash } from "node:crypto";
import {
  RESEARCH_DATASET_BUILDER_VERSION,
  RESEARCH_DATASET_ROW_SCHEMA_VERSION,
  type NormalizedResearchDatasetRequest,
  type ResearchDatasetRow,
  type UniverseDefinition,
} from "./types";

/** 递归按键字典序排序的 canonical 序列化（array 保持顺序，object 键排序）。
 *  导出供 policy/versionSnapshot 复用（同模块内保持唯一实现）。 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
    .join(",");
  return `{${body}}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** 版本前缀（构建器版本 + 行 schema 版本，变化即整体前缀变化）。 */
function versionPrefix(): string {
  return `rd-${RESEARCH_DATASET_BUILDER_VERSION}-${RESEARCH_DATASET_ROW_SCHEMA_VERSION}`;
}

/**
 * 派生 Research Dataset 版本。
 * 为保证同内容可复现，rows 与 universeDefinition 以规范化后的稳定结构参与指纹；
 * 不含 capturedAt。
 */
export function computeDatasetVersion(
  request: NormalizedResearchDatasetRequest,
  universeDefinition: UniverseDefinition,
  rows: readonly ResearchDatasetRow[],
): string {
  const canonical = canonicalStringify({ request, universeDefinition, rows });
  const digest = sha256Hex(canonical);
  return `${versionPrefix()}-${digest.slice(0, 16)}`;
}

/** 只对内容指纹部分做摘要（测试/调试用；正式版本用 computeDatasetVersion）。 */
export function computeRowsFingerprint(rows: readonly ResearchDatasetRow[]): string {
  return sha256Hex(canonicalStringify(rows)).slice(0, 32);
}

// ---------------------------------------------------------------------------
// 流式指纹（分片构建配套）
//
// 分片构建把标准行逐片写入行表后，最终需要「不一次性加载全量 rows 到内存」也能算出
// content-addressed 的 datasetVersion / rowsFingerprint。流式实现逐行增量 update 哈希，
// 必须精确复现 canonicalStringify 的输出字节，从而保证：
//   分片构建的 datasetVersion === 一次性构建（同内容）的 datasetVersion。
// 关键格式：canonicalStringify({request,rows,universeDefinition}) 按字典序输出
//   {"request":…,"rows":[…],"universeDefinition":…}  （request < rows < universeDefinition）
// 因此流式按 request → rows（逐行，元素间逗号）→ universeDefinition 拼接。
// ---------------------------------------------------------------------------

/**
 * 流式派生 datasetVersion（内存 O(1) 逐行，rows 需按 (tradeDate, securityId) 升序确定性排序）。
 * 与 computeDatasetVersion 对「同内容」产出完全一致的版本字符串。
 */
export function computeDatasetVersionStreaming(
  request: NormalizedResearchDatasetRequest,
  universeDefinition: UniverseDefinition,
  rows: Iterable<ResearchDatasetRow>,
): string {
  const hash = createHash("sha256");
  hash.update('{"request":');
  hash.update(canonicalStringify(request));
  hash.update(',"rows":[');
  let first = true;
  for (const row of rows) {
    if (!first) hash.update(",");
    hash.update(canonicalStringify(row));
    first = false;
  }
  hash.update('],"universeDefinition":');
  hash.update(canonicalStringify(universeDefinition));
  hash.update("}");
  const digest = hash.digest("hex");
  return `${versionPrefix()}-${digest.slice(0, 16)}`;
}

/** 流式标准行内容指纹（与 computeRowsFingerprint 同内容同值）。 */
export function computeRowsFingerprintStreaming(rows: Iterable<ResearchDatasetRow>): string {
  const hash = createHash("sha256");
  hash.update("[");
  let first = true;
  for (const row of rows) {
    if (!first) hash.update(",");
    hash.update(canonicalStringify(row));
    first = false;
  }
  hash.update("]");
  return hash.digest("hex").slice(0, 32);
}

/** 流式指纹组合结果。 */
export interface DatasetFingerprints {
  datasetVersion: string;
  rowsFingerprint: string;
}

/**
 * 一次遍历同时计算 datasetVersion 与 rowsFingerprint（避免分片构建后对全量行做两轮流式读库）。
 * rows 为异步可迭代（行表流式读回）；与 computeDatasetVersionStreaming / computeRowsFingerprintStreaming
 * 对同内容产出完全一致。
 */
export async function computeDatasetFingerprintsStreaming(
  request: NormalizedResearchDatasetRequest,
  universeDefinition: UniverseDefinition,
  rows: AsyncIterable<ResearchDatasetRow>,
): Promise<DatasetFingerprints> {
  const versionHash = createHash("sha256");
  const rowsHash = createHash("sha256");
  versionHash.update('{"request":');
  versionHash.update(canonicalStringify(request));
  versionHash.update(',"rows":[');
  rowsHash.update("[");
  let first = true;
  for await (const row of rows) {
    if (!first) {
      versionHash.update(",");
      rowsHash.update(",");
    }
    const canonical = canonicalStringify(row);
    versionHash.update(canonical);
    rowsHash.update(canonical);
    first = false;
  }
  versionHash.update('],"universeDefinition":');
  versionHash.update(canonicalStringify(universeDefinition));
  versionHash.update("}");
  rowsHash.update("]");
  return {
    datasetVersion: `${versionPrefix()}-${versionHash.digest("hex").slice(0, 16)}`,
    rowsFingerprint: rowsHash.digest("hex").slice(0, 32),
  };
}
