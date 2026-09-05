/**
 * STEP 8 — Serialization Layer：严格序列化与确定性指纹。
 *
 * 铁律：
 *   - serialize → JSON → deserialize 语义一致；
 *   - 禁止 undefined → "undefined"、NaN → "NaN"、Infinity → "Infinity" 等字符串化污染；
 *   - 确定性：canonical 序列化对对象键做稳定排序，供 runId 派生与结果一致性校验（deepEqual）。
 */

import { createHash } from "node:crypto";
import type { BacktestResult } from "./types";

/** 严格 replacer：拒绝非有限数字（NaN/Infinity 不得静默转 null）。 */
export function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`拒绝序列化非有限数字：${String(value)}`);
  }
  return value;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`反序列化结果不是对象：${label}`);
  }
}

/** 序列化回测结果（拒绝非有限数字）。 */
export function serializeBacktestResult(result: BacktestResult): string {
  return JSON.stringify(result, strictReplacer);
}

/** 反序列化回测结果（结构轻校验）。 */
export function deserializeBacktestResult(json: string): BacktestResult {
  const parsed: unknown = JSON.parse(json);
  assertObject(parsed, "result");
  return parsed as unknown as BacktestResult;
}

/** 深度排序对象键（稳定序列化，供指纹/一致性比较）。 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** 稳定 JSON（键排序，拒绝非有限数字）。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), strictReplacer);
}

/** SHA-256 十六进制指纹。 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 任意可序列化值的稳定指纹。 */
export function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
