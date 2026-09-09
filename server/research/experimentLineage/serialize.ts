/**
 * STEP 13 / C-13.3 — Experiment Lineage：序列化 / 指纹（纯函数、确定性）。
 *
 * 铁律（对齐 researchDataset/version.ts 的 canonical 范式）：
 *   - serialize / fingerprint 使用按键字典序排序的 canonical JSON（canonicalStringify），
 *     同内容必同串，不依赖对象键插入顺序；
 *   - 任何 NaN / Infinity 在进入指纹 / 序列化前直接抛错（绝不静默转 null）；
 *   - fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - deserialize：JSON → 结构校验 → 指纹复核，防篡改 / 防字段退化。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import type { ExperimentLineageRecord } from "./types";
import { validateExperimentLineageRecord } from "./validate";

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝含非有限数字 ${value}（${path}）；谱系记录禁止 NaN / Infinity`);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteRecord(item, `${path}[${index}]`));
    return;
  }
  for (const key of Object.keys(value as object)) {
    assertFiniteRecord((value as Record<string, unknown>)[key], path === "" ? key : `${path}.${key}`);
  }
}

/**
 * 计算谱系记录内容指纹：除 fingerprint 字段外全部字段的 canonical JSON 摘要。
 * 输入允许已带 fingerprint（计算时自动剔除），便于反序列化复核。
 */
export function computeExperimentLineageFingerprint(
  record: Omit<ExperimentLineageRecord, "fingerprint"> | ExperimentLineageRecord,
): string {
  assertFiniteRecord(record, "record");
  const body: Record<string, unknown> = { ...(record as object) };
  delete body.fingerprint;
  const canonical = canonicalStringify(body);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** 序列化谱系记录（canonical JSON；拒绝 NaN/Infinity；同内容必同串）。 */
export function serializeExperimentLineageRecord(record: ExperimentLineageRecord): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

/**
 * 反序列化谱系记录：结构校验（结构档：missing 缺省合法）→ 指纹完整性复核。
 * 齐备性（§28 15 字段是否全解析）由调用方另行用 validateExperimentLineageRecord 默认档检查。
 */
export function deserializeExperimentLineageRecord(json: string): ExperimentLineageRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`谱系记录反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("谱系记录反序列化失败：顶层必须是对象");
  }
  const record = parsed as ExperimentLineageRecord;
  const validation = validateExperimentLineageRecord(record, { requireResolvedRefs: false });
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const recomputed = computeExperimentLineageFingerprint(record);
  if (record.fingerprint !== recomputed) {
    const fingerprintIssues: ResearchValidationIssue[] = [{
      code: "LINEAGE_FINGERPRINT_MISMATCH",
      path: "fingerprint",
      message: `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
    }];
    throw new ResearchValidationError(fingerprintIssues);
  }
  return record;
}
