/**
 * 跨阶段 Robustness 核心 ↔ 独立研究实验体系 的**唯一引桥**。
 *
 * ## 为什么需要这一层（规格 §1.1 / §17）
 *
 * EXP-002 要复用**既有**的 Robustness 方法（baseline-first / variant execution /
 * evaluator 注入 / failed 样本结构化 / baseline 失败不产结论 / 容差判定 / fingerprint），
 * 而不是在 `research-experiments/**` 里再写一套研究侧引擎。
 *
 * 那份方法住在 `server/research/robustness/**`（C-18.1 + ROBUSTNESS-CROSS-STAGE-001 的
 * 泛化层）。实验作者面（`research-experiments/**`）按约定**只引 `@shared/*` 与
 * `@experiments/*`**，所以「怎么引到 `server/**`」这件事被收敛到**这一个文件**里：
 *
 * - 实验代码只写 `from "@experiments/robustnessBridge"`；
 * - 将来 robustness 目录搬家 / 改名，只需要改这里（一处），不必逐个实验改；
 * - 「研究侧重算」与「策略侧回测」的差别对核心是不可见的 —— 核心只认注入的 evaluator。
 *
 * ## 它**不是**第二套引擎（规格 §17 明禁）
 *
 * 本文件**零实现、零状态、零 IO** —— 只有 re-export。任何「在引桥里加一层封装逻辑」
 * 的念头都是错的：那会在核心与实验之间长出第二个语义层，正是规格要避免的东西。
 *
 * ## 浏览器安全的强制约束（不是口头约定）
 *
 * `page.tsx` 跑在浏览器里，**不得**引 `server/**` 运行时
 * （`tests/server/researchExperiments/manifest.test.ts` 有 AST 级闸门钉住）。
 * 因此本文件被**明确分成两段**：
 *
 *   1. `export type { … }` —— 纯类型，`import type` 时被 TS 完全擦除，
 *      `result.ts`（会被 `page.tsx` 间接引入）**只允许**用这一段；
 *   2. `export { … }` —— 运行时值，**只允许** `experiment.ts`（服务端 Runner 内）使用。
 *
 * 于是「`result.ts` 只引类型」这件事在代码形态上就是可读、可 review、可 grep 的。
 */

// ---------------------------------------------------------------------------
// 一、纯类型（`result.ts` / `page.tsx` 侧只允许用这一段）
// ---------------------------------------------------------------------------

export type { RobustnessDimension, RobustnessSubject, RobustnessVariantItem } from "../server/research/robustness/dimension";
export type {
  RobustnessMetricSnapshot,
  RobustnessSampleAccounting,
  RobustnessSubjectKind,
} from "../server/research/robustness/dimension";
export type {
  MetricComparisonResult,
  MetricComparisonSpec,
  ComparisonDirection,
  UnitVerdict,
} from "../server/research/robustness/comparison";
export type {
  MultiDimensionDimensionConclusion,
  MultiDimensionRunCounts,
  MultiDimensionRobustnessRun,
  MultiDimensionRobustnessEvaluator,
  MultiDimensionSampleOutcome,
  MultiDimensionVariantResult,
} from "../server/research/robustness/multiDimension";

// ---------------------------------------------------------------------------
// 二、运行时值（**只允许** `experiment.ts` 使用；页面一旦引它就会把 node 侧代码带进 bundle）
// ---------------------------------------------------------------------------

/** 多维稳定性运行器（一个 Run 出 Baseline + N 维度 × M 变体；零 IO，只调注入的 evaluator）。 */
export { runMultiDimensionRobustness } from "../server/research/robustness/multiDimension";

/** 记录序列化 / 结构校验 / 指纹（策略侧与本研究侧共用同一份实现）。 */
export {
  MULTI_DIMENSION_ACCOUNTING_FORMULA,
  MULTI_DIMENSION_RUN_ID_PREFIX,
  MULTI_DIMENSION_RUN_RECORD_KIND,
  MULTI_DIMENSION_RUN_RECORD_VERSION,
  computeMultiDimensionRunFingerprint,
  deserializeMultiDimensionRobustnessRun,
  serializeMultiDimensionRobustnessRun,
  validateMultiDimensionRobustnessRun,
} from "../server/research/robustness/multiDimension";

/** 泛化身份适配器 + 样本账守恒闸门（策略侧与本研究侧共用）。 */
export {
  ROBUSTNESS_SAMPLE_ACCOUNTING_FORMULA,
  assertSampleAccountingBalanced,
  subjectFromExperiment,
  subjectFromStrategy,
} from "../server/research/robustness/dimension";

/** 容差判定的**唯一实现**（C-18.1 的 `applyDriftThresholds` 也走它 —— 全仓只有一份）。 */
export { evaluateTolerance, summarizeUnitVerdict } from "../server/research/robustness/comparison";

/** canonical 指纹原语（先在 `assertFiniteRecord` 上把关，再 sha256；全仓只有一份实现）。 */
export { computeCanonicalFingerprint } from "../server/research/robustness/serialize";
