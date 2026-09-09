/**
 * STEP 14 / C-14.3 — 执行与约束模型：声明序列化与指纹。
 *
 * 铁律（对齐 strategySchema / researchDataset version 序列化）：
 *   - serialize / fingerprint 使用按键字典序递归排序的 canonical JSON
 *     （canonicalStringify，来自 researchDataset/version.ts，只读复用），
 *     同内容必同串（与对象键插入序无关）；
 *   - 拒绝序列化 NaN / Infinity（canonicalStringify 会把 NaN 折叠为 null，故先做
 *     strict 守卫，遇到非有限数字直接抛错，绝不静默转 null）；
 *   - fingerprint = sha256（十六进制），对整份声明的确定性摘要；
 *     declaration 本身不内嵌 fingerprint（它是配置文档而非运行记录，指纹由消费方
 *     与外层审计记录关联保存），compute*Fingerprint 供审计/去重/漂移检测使用；
 *   - deserialize 先过 validateExecutionConstraintDeclaration 复核结构，保证
 *     JSON → 对象不回退类型边界。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import type { ExecutionConstraintDeclaration } from "./types";
import { assertValidExecutionConstraintDeclaration } from "./validate";

/** strict 守卫：递归断言不存在非有限数字（NaN/Infinity 不得静默转 null）。 */
function assertFiniteNumbers(value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`拒绝序列化非有限数字：${String(value)}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertFiniteNumbers(item);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertFiniteNumbers(item);
    }
  }
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
 * 计算声明指纹：整份声明的 canonical JSON 的 sha256（十六进制）。
 * 与键插入序无关：同内容的声明无论构造时字段先后，指纹必相同。
 */
export function computeExecutionConstraintDeclarationFingerprint(
  declaration: ExecutionConstraintDeclaration
): string {
  const canonical = canonicalStringify(declaration);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** 序列化声明（canonical JSON；拒绝 NaN/Infinity；不含时间戳/随机数）。 */
export function serializeExecutionConstraintDeclaration(
  declaration: ExecutionConstraintDeclaration
): string {
  assertFiniteNumbers(declaration);
  return canonicalStringify(declaration);
}

/** 反序列化声明：结构复核（规范化序/字面量守卫），不内嵌指纹故无需指纹比对。 */
export function deserializeExecutionConstraintDeclaration(
  json: string
): ExecutionConstraintDeclaration {
  const parsed: unknown = JSON.parse(json);
  assertObject(parsed, "executionConstraintDeclaration");
  const declaration = parsed as unknown as ExecutionConstraintDeclaration;
  assertValidExecutionConstraintDeclaration(declaration);
  return declaration;
}
