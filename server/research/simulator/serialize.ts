/**
 * STEP 14 / C-14.1 — 交易模拟核心：运行记录序列化。
 *
 * 铁律（对齐 signalEngine / framework serialization）：
 *   - serialize → JSON → deserialize 保持语义一致；拒绝序列化 NaN/Infinity
 *     （遇到非有限数字直接抛错，绝不静默转 null）；
 *   - fingerprint：sha256（十六进制），对「除 fingerprint 外全部字段」的确定性 JSON
 *     摘要；反序列化时复核，防篡改/防字段退化；
 *   - 不含任何时间戳 / 随机数，同内容必同串。
 */

import { createHash } from "node:crypto";
import type { TradeSimulationRun } from "./types";
import { assertValidTradeSimulationRun } from "./validate";

/** 严格 replacer：拒绝非有限数字（NaN/Infinity 不得静默转 null）。 */
function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`拒绝序列化非有限数字：${String(value)}`);
  }
  return value;
}

/** fingerprint replacer：剔除 fingerprint 自身，防止自引用。 */
function fingerprintReplacer(key: string, value: unknown): unknown {
  if (key === "fingerprint") return undefined;
  return strictReplacer(key, value);
}

function assertObject(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`反序列化结果不是对象：${label}`);
  }
}

/**
 * 计算运行记录指纹：除 fingerprint 字段外全部字段的确定性 JSON 摘要。
 * record 允许已含 fingerprint（计算时自动忽略），便于反序列化复核。
 */
export function computeTradeSimulationRunFingerprint(
  record: Omit<TradeSimulationRun, "fingerprint"> | TradeSimulationRun
): string {
  const json = JSON.stringify(record, fingerprintReplacer);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/** 序列化运行记录（拒绝 NaN/Infinity；不含时间戳/随机数）。 */
export function serializeTradeSimulationRun(
  record: TradeSimulationRun
): string {
  return JSON.stringify(record, strictReplacer);
}

/** 反序列化运行记录：结构复核 + fingerprint 完整性校验。 */
export function deserializeTradeSimulationRun(
  json: string
): TradeSimulationRun {
  const parsed: unknown = JSON.parse(json);
  assertObject(parsed, "tradeSimulationRun");
  const record = parsed as unknown as TradeSimulationRun;
  assertValidTradeSimulationRun(record);
  const recomputed = computeTradeSimulationRunFingerprint(record);
  if (record.fingerprint !== recomputed) {
    throw new Error(
      `指纹不匹配：记录内容已被篡改或退化（期望 ${recomputed}，实际 ${record.fingerprint}）`
    );
  }
  return record;
}
