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
