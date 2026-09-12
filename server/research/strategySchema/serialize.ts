/**
 * STEP 15 / C-15.1 — Strategy Schema + Versioning：序列化 / 指纹（纯函数、确定性）。
 *
 * 铁律（对齐 researchDataset/version.ts canonical 范式与 experimentLineage/serialize.ts）：
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
import type { StrategyDefinition } from "./definition";
import type { StrategyDocument, StrategyVersionRecord } from "./types";
import { validateStrategyDocument, validateStrategyVersionRecord } from "./validate";

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝含非有限数字 ${value}（${path}）；策略文档禁止 NaN / Infinity`);
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

function digestBody(body: Record<string, unknown>): string {
  const canonical = canonicalStringify(body);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// StrategyDefinition（STEP STRATEGY-003 · Canonical Definition 指纹）
// ---------------------------------------------------------------------------

/**
 * 计算 **Canonical StrategyDefinition** 的内容指纹：`SHA-256(canonicalStringify(definition))`。
 *
 * SPEC §九 / §29 要求统一入口 `computeStrategyDefinitionFingerprint()`，并保证：
 *   - 同一 Definition（语义相同，含规范化后的确定性数组顺序）→ 同一 Hash；
 *   - 任何实质改动（entry / exit / parameter / position / risk / execution / dataset 绑定）
 *     → Hash 必须变化。
 *
 * 说明：本函数与 `computeStrategyDocumentFingerprint` 是**两个不同层级**的指纹——
 *   - Document 指纹（本文件上半部）= 整个 StrategyDocument（含身份 / universe /
 *     executionAssumptions / recipe / metadata 与嵌入的 definition）的指纹，
 *     它是 `strategy_versions.fingerprint` 的实际取值（物理列名不变，用户裁定 D2）；
 *   - Definition 指纹（本函数）= 只覆盖 `StrategyDefinition` 子树，供「两份定义是否同一套规则」
 *     的独立比对（例如 `versionRecordJson.strategy.definition` 与 `strategyDocumentJson.definition`
 *     的一致性断言）。
 * 二者都是 sha256 of canonical JSON，不依赖对象键插入顺序。
 */
export function computeStrategyDefinitionFingerprint(definition: StrategyDefinition): string {
  assertFiniteRecord(definition, "definition");
  return digestBody(definition as unknown as Record<string, unknown>);
}

/** 序列化 StrategyDefinition（canonical JSON；同内容必同串）。 */
export function serializeStrategyDefinition(definition: StrategyDefinition): string {
  assertFiniteRecord(definition, "definition");
  return canonicalStringify(definition);
}

// ---------------------------------------------------------------------------
// StrategyDocument
// ---------------------------------------------------------------------------

/**
 * 计算策略本体内容指纹：除 fingerprint 字段外全部字段的 canonical JSON 摘要。
 * 输入允许已带 fingerprint（计算时自动剔除），便于反序列化复核。
 */
export function computeStrategyDocumentFingerprint(
  document: Omit<StrategyDocument, "fingerprint"> | StrategyDocument,
): string {
  assertFiniteRecord(document, "document");
  const body: Record<string, unknown> = { ...(document as object) };
  delete body.fingerprint;
  return digestBody(body);
}

/** 序列化策略本体（canonical JSON；拒绝 NaN/Infinity；同内容必同串）。 */
export function serializeStrategyDocument(document: StrategyDocument): string {
  assertFiniteRecord(document, "document");
  return canonicalStringify(document);
}

/** 反序列化策略本体：结构校验 → 指纹完整性复核。 */
export function deserializeStrategyDocument(json: string): StrategyDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`策略本体反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("策略本体反序列化失败：顶层必须是对象");
  }
  const document = parsed as StrategyDocument;
  const validation = validateStrategyDocument(document);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const recomputed = computeStrategyDocumentFingerprint(document);
  if (document.fingerprint !== recomputed) {
    const mismatchIssues: ResearchValidationIssue[] = [{
      code: "STRATEGY_FINGERPRINT_MISMATCH",
      path: "fingerprint",
      message: `指纹不匹配：策略本体已被篡改或退化（期望 ${recomputed}，实际 ${document.fingerprint}）`,
    }];
    throw new ResearchValidationError(mismatchIssues);
  }
  return document;
}

// ---------------------------------------------------------------------------
// StrategyVersionRecord
// ---------------------------------------------------------------------------

/**
 * 计算版本追溯记录内容指纹：除 fingerprint 字段外全部字段的 canonical JSON 摘要。
 */
export function computeStrategyVersionRecordFingerprint(
  record: Omit<StrategyVersionRecord, "fingerprint"> | StrategyVersionRecord,
): string {
  assertFiniteRecord(record, "record");
  const body: Record<string, unknown> = { ...(record as object) };
  delete body.fingerprint;
  return digestBody(body);
}

/** 序列化版本追溯记录（canonical JSON）。 */
export function serializeStrategyVersionRecord(record: StrategyVersionRecord): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

/** 反序列化版本追溯记录：结构校验 → 指纹完整性复核。 */
export function deserializeStrategyVersionRecord(json: string): StrategyVersionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`版本追溯记录反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("版本追溯记录反序列化失败：顶层必须是对象");
  }
  const record = parsed as StrategyVersionRecord;
  const validation = validateStrategyVersionRecord(record);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const recomputed = computeStrategyVersionRecordFingerprint(record);
  if (record.fingerprint !== recomputed) {
    const mismatchIssues: ResearchValidationIssue[] = [{
      code: "STRATEGY_VERSION_RECORD_FINGERPRINT_MISMATCH",
      path: "fingerprint",
      message: `指纹不匹配：版本追溯记录已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
    }];
    throw new ResearchValidationError(mismatchIssues);
  }
  return record;
}
