/**
 * COMPOSITE-RUNNER-BRIDGE-001 —— 组合执行能力的**实验侧唯一入口**（零实现，只有 re-export）。
 *
 * 与既有 `@experiments/robustnessBridge` 同一纪律：方法（组合回测）是跨阶段通用的，
 * 实验**可以消费**它，但实现只有一处（`server/research/compositeRunner`），
 * 这里不写任何逻辑、不新增第二套引擎。
 *
 * 使用前提：实验 descriptor 必须声明 `executionSurface: "COMPOSITE_PORTFOLIO"`。
 */
export {
  buildFirstLimitPullback3FTop3SourceRun,
  buildCompositeEvents,
  buildCompositeSourceRun,
  buildCompositeExecutionDataset,
  rebuildCompositeRun,
  runCompositeRunnerBacktest,
  COMPOSITE_RUNNER_TOP_N,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
} from "../server/research/compositeRunner/index";
export {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_CREATED_AT,
} from "../server/research/patternLibrary/threeFactorTopNStrategy";
export { buildThreeFactorTopNFamilyArmInput } from "../server/research/patternLibrary/threeFactorTopNFamilies";
export type {
  CompositeExecutionSurfacePayload,
  ExperimentCompositeDatasetProvider,
} from "../server/researchExperiments/compositeDatasetProvider";
export type {
  ResearchDataset,
  ResearchDatasetRow,
  CompositeSelectedEvent,
  CompositeExtensionBar,
  BuiltCompositeArm,
  CompositeArmKind,
  CompositeRunnerBacktestResult,
} from "../server/research/compositeRunner/index";

