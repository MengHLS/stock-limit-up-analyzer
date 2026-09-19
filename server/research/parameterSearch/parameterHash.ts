/**
 * PARAMETER-001 §6 — 稳定 `parameterHash`（确定性 · 规范化 · 跨进程可复现）。
 *
 * ## 语义契约
 *
 * ```text
 * 相同 Strategy Version + 相同参数  =  相同 hash
 * ```
 *
 * 因此 hash 的输入**只有**两项（`strategyVersionId` 的角色 + 规范化后的参数值）：
 *
 * ```text
 * parameterHash = sha256( canonicalStringify({
 *   strategyVersionId,          // 见下「strategyVersionId 的口径」
 *   parameters: { <name>: <canonical value> }   // 键按字典序、值规范化
 * }) )
 * ```
 *
 * ## strategyVersionId 的口径（🔴 不发明第二套 ID）
 *
 * 本项目策略身份的唯一权威形态是 **`strategyId` + `strategyVersion`（semver）**
 * （`strategy_versions` 的唯一键 `(strategyId, version)`；`strategy_versions.id` 只是自增主键）。
 * ⇒ 本模块用 `strategyId@strategyVersion` 作为规格里的 `strategyVersionId`，
 *   写成 `"<strategyId>@<strategyVersion>"` 一个字符串参与哈希，**不另立 ID 体系**。
 *
 * ## 规范化规则（保证「同参数 ⇒ 同字节」）
 *
 * - 键：`Object.keys(...).sort()`（字典序，UTF-16 code unit 序，`localeCompare` 会受 locale 影响 ⇒ 不用）；
 * - 值：`number` 统一 `-0 → 0`（`-0` 与 `0` 的 `JSON.stringify` 不同，但语义相同值）；
 * - 值：**拒绝** `NaN` / `Infinity`（静默变 `null` 会造成「两个不同参数得到同一 hash」）；
 * - `null`：原样保留（表达「该参数不设阈值」，与「参数缺省」不同）；
 * - `undefined` / 缺失键：**不参与**哈希（缺省 ≠ 值为 null）。
 *
 * 复用 `server/researchDataset/version.ts#canonicalStringify`（全仓唯一 canonical 序列化实现），
 * 不另写第二套。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import type { ResearchParameterSet } from "../types";

/** 参数哈希的输入。 */
export interface ParameterHashInput {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameters: ResearchParameterSet;
}

/** 参数哈希十六进制长度（sha256）。 */
export const PARAMETER_HASH_HEX_LENGTH = 64;

/** `strategyId@strategyVersion` —— 规格 `strategyVersionId` 在本项目的等价表达。 */
export function strategyVersionCoordinate(input: {
  readonly strategyId: string;
  readonly strategyVersion: string;
}): string {
  return `${input.strategyId}@${input.strategyVersion}`;
}

/**
 * 规范化单个参数值。
 *
 * 🔴 非有限数**响亮抛错**（不是静默转 null）—— 否则 `NaN` 与 `null` 会撞成同一个 hash。
 */
export function canonicalizeParameterValue(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`parameterHash 拒绝非有限数字：${String(value)}（NaN / Infinity 不得静默转 null）`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  throw new Error(
    `parameterHash 拒绝非法参数值类型：${value === undefined ? "undefined" : typeof value}`,
  );
}

/**
 * 规范化参数集：键字典序 + 值规范化 + 丢弃 `undefined` 键。
 *
 * 返回**新对象**（不改入参）。
 */
export function canonicalizeParameterSet(
  parameters: ResearchParameterSet,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(parameters).sort()) {
    const value = parameters[key];
    if (value === undefined) continue; // 缺省 ≠ null：缺省键不进哈希
    out[key] = canonicalizeParameterValue(value);
  }
  return out;
}

/** 参数集的 canonical JSON（供指纹 / 展示 / 断言用）。 */
export function canonicalParameterSetString(parameters: ResearchParameterSet): string {
  return canonicalStringify(canonicalizeParameterSet(parameters));
}

/**
 * 计算稳定 `parameterHash`（sha256 十六进制，小写）。
 *
 * 纯函数：无 IO / 无 Date.now / 无 Math.random ⇒ 跨进程、跨时间、跨机器一致。
 */
export function computeParameterHash(input: ParameterHashInput): string {
  const payload = {
    strategyVersionId: strategyVersionCoordinate(input),
    parameters: canonicalizeParameterSet(input.parameters),
  };
  return createHash("sha256").update(canonicalStringify(payload), "utf8").digest("hex");
}

/**
 * 评估配置指纹（规格 §13 的 cache 判据四要素之一）。
 *
 * 🔴 为什么单独一个指纹而不是直接存对象：cache 判据要能**逐字节比较**，
 *   而 `evaluationConfig` 是嵌套结构 ⇒ 用 canonical 序列化后的 sha256 做等值判据。
 *   `evaluationConfig` 的内容由调用方给出（本项目里 = 回测窗口 + 执行政策版本 +
 *   数据集坐标 + 数据集来源策略），本模块**不替它猜默认值**。
 */
export function computeEvaluationConfigFingerprint(config: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(canonicalStringify(config), "utf8").digest("hex");
}

/** cache 判据的五个要素（规格 §13）。 */
export interface ParameterSearchCacheKey {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly datasetVersionId: number | null;
  readonly parameterHash: string;
  readonly executionPolicyVersion: number;
  readonly evaluationConfigFingerprint: string;
}

/** cache 判据的稳定字符串（落库 / 比较共用）。 */
export function parameterSearchCacheKeyString(key: ParameterSearchCacheKey): string {
  return canonicalStringify({
    strategyVersionId: strategyVersionCoordinate(key),
    datasetVersionId: key.datasetVersionId,
    parameterHash: key.parameterHash,
    executionPolicyVersion: key.executionPolicyVersion,
    evaluationConfigFingerprint: key.evaluationConfigFingerprint,
  });
}

/** 两个 cache 判据是否逐字段相等（唯一比较入口，避免各处各写一遍）。 */
export function sameParameterSearchCacheKey(
  left: ParameterSearchCacheKey,
  right: ParameterSearchCacheKey,
): boolean {
  return parameterSearchCacheKeyString(left) === parameterSearchCacheKeyString(right);
}
