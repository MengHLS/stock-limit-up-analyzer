/**
 * STEP 14 / C-14.2 — 成本模型：声明序列化 round-trip。
 *
 * 与 simulator/serialize 同一纪律：严格 replacer 拒绝 NaN/Infinity（绝不静默转
 * null）；deserialize 先结构校验（assertValidCostModelDeclaration）再返回，保证
 * JSON → 对象不回退类型边界；不含时间戳/随机数，同声明必同串。
 */

import type { CostModelDeclaration } from "./types";
import { assertValidCostModelDeclaration } from "./validate";

/** 严格 replacer：拒绝非有限数字（NaN/Infinity 不得静默转 null）。 */
function strictReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`拒绝序列化非有限数字：${String(value)}`);
  }
  return value;
}

/** 序列化成本模型声明（拒绝 NaN/Infinity）。 */
export function serializeCostModelDeclaration(
  declaration: CostModelDeclaration
): string {
  return JSON.stringify(declaration, strictReplacer);
}

/** 反序列化成本模型声明：结构复核 + 类型收窄。 */
export function deserializeCostModelDeclaration(json: string): CostModelDeclaration {
  const parsed: unknown = JSON.parse(json);
  assertValidCostModelDeclaration(parsed);
  return parsed;
}
