/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— 唯一出口（`shared/compositeFactor`）。
 *
 * 使用方式（新增一个组合因子实验）：
 *
 * ```ts
 * import { defineCompositeFactorExperiment } from "@experiments/shared/compositeFactor";
 *
 * export const myExperiment = defineCompositeFactorExperiment({
 *   id: "first-board-pullback/my-composite-study",
 *   name: "……",
 *   description: "……",
 *   source: "stock-limit-up-analyzer/first-board-pullback",
 *   tags: ["composite-factor"],
 *   pageTitle: "……",
 *   members: [{ code: "turnover", direction: "LOW" }],
 * });
 * ```
 *
 * ⚠️ 本模块**不得**被 `page.tsx` 运行时引用（`manifest.test.ts` 会检查页面不 import
 *    `experiment.ts` 之类把服务端计算带进 bundle 的路径）。页面只 import `./result`。
 */

export * from "./types";
export {
  compositionBucketFingerprint,
  resolveCompositeMember,
  COMPOSITE_MEMBER_CATALOG,
  COMPOSITE_MEMBER_CATALOG_CODES,
  FROZEN_TWELVE_FACTOR_MEMBERS,
  assertMemberDirections,
  assertMembersUsable,
  requireFrozenFactorDefinition,
  frozenCodeOf,
} from "./members";
export {
  buildScoringPlan,
  crossSectionPercentileOf,
  orientValue,
  resolveNormalizers,
  resolveWeights,
  scoreSamples,
  summarizeCompositeScores,
  type CompositeScoreSummary,
  type ResolvedWeighting,
  type ScoredSample,
} from "./scoring";
export {
  compositeBootstrapSeed,
  COMPOSITE_BOOTSTRAP_SEED_BASE,
  fnv1a32,
} from "./hash";
export {
  analyseComposite,
  dailySeriesCsvOf,
  RANDOM_SIMULATIONS,
  type ComboEvaluation,
  type CompositeAnalysisResult,
} from "./analyse";
export {
  REFERENCE_CANDIDATE_COUNT,
  REFERENCE_ELIGIBLE_COUNT,
  REFERENCE_EXPERIMENT_ID,
  TRADE_PREVIEW_LIMIT,
  assembleCompositeFactorResult,
  compositeFactorSchema,
  type AssembleCompositeFactorArgs,
  type CompositeFactorPayload,
} from "./assemble";
export {
  defineCompositeFactorExperiment,
  type CompositeFactorExperimentConfig,
} from "./template";
