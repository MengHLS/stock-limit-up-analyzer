/**
 * STRATEGY-ARCH-001 — Fingerprint（规格 §17）。
 *
 * 指纹必须覆盖**实际影响策略行为**的核心定义：
 *
 *   RuleGraph · ParameterSchema · FeatureRequirements · DataRequirements ·
 *   ExecutionSemantics · Capabilities（以及本实现额外的 positionSpec / riskSpec / schemaVersion）
 *
 * **不**覆盖：`metadata`（name / description / author / tags）—— 改名字不应产生新行为指纹。
 *
 * 🔴 指纹覆盖的是**声明**，不是**实现**：特征的计算代码改了但 id/version 没改时，
 *   指纹**不会**变 —— 因此「改实现必须 bump 特征版本」是硬纪律（见 featureRegistry）。
 *   同理，执行引擎的实现变更由 `engineVersion` 承载（RunSnapshot 记录，见 runSnapshot.ts）。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import { canonicalJson, sha256Hex } from "./canonical";
import type { StrategyCoreDefinition } from "./definition";

/** 参与指纹的字段清单（唯一权威；测试据此断言覆盖率）。 */
export const FINGERPRINT_SCOPES = [
  "schemaVersion",
  "ruleGraph",
  "exitRuleGraph",
  "exitRules",
  "positionSpec",
  "riskSpec",
  "featureRequirements",
  "parameterSchema",
  "dataRequirements",
  "executionSemantics",
  "capabilities",
] as const;
export type FingerprintScope = (typeof FINGERPRINT_SCOPES)[number];

/** Definition 的 canonical 指纹输入（**只取参与指纹的面**）。 */
export function fingerprintPayload(definition: StrategyCoreDefinition): Record<string, unknown> {
  return {
    schemaVersion: definition.schemaVersion,
    ruleGraph: definition.ruleGraph,
    exitRuleGraph: definition.exitRuleGraph,
    exitRules: definition.exitRules,
    positionSpec: definition.positionSpec,
    riskSpec: definition.riskSpec,
    featureRequirements: definition.featureRequirements,
    parameterSchema: definition.parameterSchema,
    dataRequirements: definition.dataRequirements,
    executionSemantics: definition.executionSemantics,
    capabilities: definition.capabilities,
  };
}

/** 计算定义指纹（canonical JSON → sha256）。 */
export function computeDefinitionFingerprint(definition: StrategyCoreDefinition): string {
  return sha256Hex(canonicalJson(fingerprintPayload(definition)));
}

/** canonical 串（调试 / 差异定位用；与指纹同源）。 */
export function canonicalDefinitionJson(definition: StrategyCoreDefinition): string {
  return canonicalJson(fingerprintPayload(definition));
}

/**
 * 行为等价判定：仅比较指纹参与面。
 * ⚠️ 用于「同一定义 ⇒ 同指纹」「行为变化 ⇒ 不同指纹」的判据（规格 §23.8）。
 */
export function definitionsBehaviorallyEqual(
  left: StrategyCoreDefinition,
  right: StrategyCoreDefinition,
): boolean {
  return computeDefinitionFingerprint(left) === computeDefinitionFingerprint(right);
}

/**
 * 声明式指纹的**已知盲区**（如实登记，供报告与调用方决策）：
 * 特征实现的代码内容 / 引擎实现 / 数据集内容 / 参数取值 都不在指纹内。
 */
export const FINGERPRINT_BLIND_SPOTS = [
  "特征 compute 实现（改实现必须 bump 特征 version，否则指纹不变）",
  "执行引擎实现（由 RunSnapshot.engineVersion 承载）",
  "数据集内容（由 RunSnapshot.datasetReference 承载）",
  "参数取值（由 RunSnapshot.parameterSet 承载）",
  "metadata（name / description / author / tags，刻意排除）",
] as const;
