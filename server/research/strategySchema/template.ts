/**
 * 新策略开发模板的**类型化入口**（不是第二套 Strategy Schema）。
 *
 * 结构分工：
 * - `identity` / `dataset` / `universe` / `provenance` 属于 StrategyDocument 或独立 provenance 切面；
 * - `definition` 属于 `StrategyDocument.definition` 的 Canonical StrategyDefinition；
 * - 具体事件、状态名、参数值只出现在 `definition` / `config`，通用层不得硬编码 3570001 的值。
 */

import type { StrategyDefinitionInput } from "./definition";
import type { StrategyUniverse } from "./types";

export const STRATEGY_TEMPLATE_SECTIONS = [
  "strategyId",
  "version",
  "dataset",
  "universe",
  "entry",
  "stateFactors",
  "execution",
  "exit",
  "position",
  "risk",
  "parameters",
  "provenance",
] as const;
export type StrategyTemplateSection = (typeof STRATEGY_TEMPLATE_SECTIONS)[number];

export interface StrategyDevelopmentTemplateIdentity {
  readonly strategyId: string;
  readonly strategyVersion: string;
}

export interface StrategyDevelopmentTemplateDataset {
  readonly datasetVersionId: number;
  readonly datasetVersion: string;
  readonly datasetCode: string;
}

export interface StrategyDevelopmentTemplateProvenanceRequirement {
  /** 允许的来源类型；INDEPENDENT_EXPERIMENT 是当前独立实验桥的主路径。 */
  readonly sourceKinds: readonly ("INDEPENDENT_EXPERIMENT" | "RESEARCH_CONCLUSION")[];
  /** 至少引用的真实证据数量；0 = 明确的无证据开发草稿，不得冒充正式策略。 */
  readonly minimumEvidenceCount: number;
  /** 是否必须先通过 HOLDOUT / confirmatory gate 才能提升。 */
  readonly requireConfirmatoryGate: boolean;
}

/** 后续策略只填写这一对象；其余执行、评估、模拟盘由平台复用。 */
export interface StrategyDevelopmentTemplate {
  readonly identity: StrategyDevelopmentTemplateIdentity;
  readonly dataset: StrategyDevelopmentTemplateDataset;
  readonly universe: StrategyUniverse;
  readonly definition: StrategyDefinitionInput;
  readonly provenance: StrategyDevelopmentTemplateProvenanceRequirement;
}

/** 只做结构冻结，不创建 Strategy Version；落库仍走唯一 StrategyPromotionPort。 */
export function createStrategyDevelopmentTemplate(
  input: StrategyDevelopmentTemplate,
): StrategyDevelopmentTemplate {
  return Object.freeze({
    ...input,
    identity: Object.freeze({ ...input.identity }),
    dataset: Object.freeze({ ...input.dataset }),
    universe: Object.freeze({ ...input.universe }),
    provenance: Object.freeze({
      ...input.provenance,
      sourceKinds: Object.freeze([...input.provenance.sourceKinds]),
    }),
  });
}
