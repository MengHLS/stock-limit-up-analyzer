/**
 * STEP 21 / C-21.1 — Strategy Lifecycle Management：序列化 / 指纹 / 链校验（纯函数、确定性）。
 *
 * 对齐既有范式（experimentLineage/serialize.ts、strategySchema/serialize.ts）：
 *   - serialize / fingerprint 使用按键字典序排序的 canonical JSON（canonicalStringify），
 *     同内容必同串，不依赖对象键插入顺序；
 *   - 任何 NaN / Infinity 进入指纹前直接抛错（绝不静默转 null）；
 *   - record fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical JSON 摘要）；
 *   - transition 级防篡改**可校验链**：hash = sha256(prevHash + 本跳其余全部字段)。
 *     篡改任意历史跳 → 后续 hash 全部断链 → deserialize/verify 复核失败。
 *
 * 依赖方向（与既有目录一致，防循环 import）：validate.ts 只做结构与语义（不含 hash 重算）；
 * 链式 hash 与反序列化复核都在本文件完成。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import type { LifecycleTransition, StrategyLifecycleRecord } from "./types";
import { validateStrategyLifecycleRecord } from "./validate";

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝含非有限数字 ${value}（${path}）；生命周期记录禁止 NaN / Infinity`);
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

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 单跳 hash（可校验链节）
// ---------------------------------------------------------------------------

/**
 * 计算一条 transition 的链式 hash：除 hash 字段外全部字段（含 prevHash）的 canonical 摘要。
 * genesis 首跳 prevHash=null；非 genesis prevHash = 上一跳的 hash。
 * 输入允许已带 hash（自动剔除），便于复核。
 */
export function computeLifecycleTransitionHash(transition: LifecycleTransition | Omit<LifecycleTransition, "hash">): string {
  assertFiniteRecord(transition, "transition");
  const body: Record<string, unknown> = { ...(transition as object) };
  delete body.hash;
  return digest(body);
}

/**
 * 校验整条链的 hash 连续性与完整性（防篡改可校验链）。
 * 只做 crypto 复核（连续性/seq/from-to 等结构性不变量在 validate.ts）。
 * 返回问题清单；空 = 链完整。
 */
export function verifyLifecycleTransitionChain(
  transitions: readonly LifecycleTransition[],
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  transitions.forEach((transition, index) => {
    const recomputed = computeLifecycleTransitionHash(transition);
    if (transition.hash !== recomputed) {
      issues.push({
        code: "LIFECYCLE_CHAIN_HASH_MISMATCH",
        path: `transitions[${index}].hash`,
        message:
          `链 hash 不匹配：transitions[${index}] 内容与 hash 不符（期望 ${recomputed}，实际 ${transition.hash}）。` +
          "生命周期审计链 append-only：任何对历史跳的篡改都会使链断裂，禁止无记录修改",
      });
    }
    if (index > 0 && transition.prevHash !== transitions[index - 1]?.hash) {
      issues.push({
        code: "LIFECYCLE_CHAIN_LINK_BROKEN",
        path: `transitions[${index}].prevHash`,
        message:
          `链断裂：transitions[${index}].prevHash（${String(transition.prevHash)}）不等于前一跳 hash（${transitions[index - 1]?.hash}）。` +
          "审计链必须逐跳衔接（append-only），不允许插入 / 删除 / 重排历史",
      });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// StrategyLifecycleRecord 指纹与 round-trip
// ---------------------------------------------------------------------------

/**
 * 计算生命周期壳内容指纹：除 fingerprint 字段外全部字段（含整条 transitions 链）的
 * canonical JSON 摘要。输入允许已带 fingerprint（自动剔除），便于反序列化复核。
 */
export function computeStrategyLifecycleRecordFingerprint(
  record: Omit<StrategyLifecycleRecord, "fingerprint"> | StrategyLifecycleRecord,
): string {
  assertFiniteRecord(record, "record");
  const body: Record<string, unknown> = { ...(record as object) };
  delete body.fingerprint;
  return digest(body);
}

/** 序列化生命周期壳（canonical JSON；拒绝 NaN/Infinity）。 */
export function serializeStrategyLifecycleRecord(record: StrategyLifecycleRecord): string {
  assertFiniteRecord(record, "record");
  return canonicalStringify(record);
}

/**
 * 反序列化生命周期壳：结构 + 语义校验（validate.ts）→ 链 hash 复核 → 指纹复核。
 * 任一步失败即抛 ResearchValidationError（中文信息）；绝不返回被篡改 / 退化的记录。
 */
export function deserializeStrategyLifecycleRecord(json: string): StrategyLifecycleRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`生命周期壳反序列化失败：JSON 解析错误（${(error as Error).message}）`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("生命周期壳反序列化失败：顶层必须是对象");
  }
  const record = parsed as StrategyLifecycleRecord;
  const validation = validateStrategyLifecycleRecord(record);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  const chainIssues = verifyLifecycleTransitionChain(record.transitions);
  if (chainIssues.length > 0) {
    throw new ResearchValidationError(chainIssues);
  }
  const recomputed = computeStrategyLifecycleRecordFingerprint(record);
  if (record.fingerprint !== recomputed) {
    const mismatchIssues: ResearchValidationIssue[] = [{
      code: "LIFECYCLE_RECORD_FINGERPRINT_MISMATCH",
      path: "fingerprint",
      message: `指纹不匹配：生命周期壳已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`,
    }];
    throw new ResearchValidationError(mismatchIssues);
  }
  return record;
}
