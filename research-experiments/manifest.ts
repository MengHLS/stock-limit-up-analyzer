/**
 * 独立研究实验 · 注册清单（**唯一**需要人工改动的注册点之一）。
 *
 * ## 新增一个实验：两步
 *
 * 1. 本文件：加 1 行 `import`，并在 `EXPERIMENT_DEFINITIONS` 数组里加 1 项；
 * 2. `client/src/researchExperiments/pages.ts`：加 1 行页面注册（`pageKey → 组件`）。
 *
 * 两步之外**不需要**改任何核心代码（不改 Research Core、不改 Strategy Core、
 * 不改 tRPC 路由、不改数据库）。详见 `docs/research/EXPERIMENT-CODE-SPEC.md`。
 *
 * ## 为什么是显式清单而不是目录扫描
 *
 * 本仓库约定「**无目录扫描、无 `import.meta.glob`、无 codegen**」
 * （先例：`server/research/patternLibrary/patterns/index.ts`）。
 * 显式清单可 diff、可 code review、在 vitest / esbuild 下行为确定 ——
 * 对研究平台来说，「可复现」优先于「魔法自动发现」。
 */

import type { ExperimentDefinition } from "../server/researchExperiments/types";
import { withFirstBoardPullbackFoundation } from "./shared/firstBoardPullback/wrapExperiment";
import { bodyFilteredExitCurveStudyExperiment } from "./first-board-pullback/body-filtered-exit-curve-study/experiment";
import { bodyMaSupportScreenStudyExperiment } from "./first-board-pullback/body-ma-support-screen-study/experiment";
import { compositeFactorEqualWeightStudyExperiment } from "./first-board-pullback/composite-factor-equal-weight-study/experiment";
import { constrainedWeightExperiments } from "./first-board-pullback/composite-factor-constrained-weight-study/experiment";
import { compositeFactorOosValidationExperiments } from "./first-board-pullback/composite-factor-oos-validation-study/experiment";
import { compositeFactorFourStrongStudyExperiment } from "./first-board-pullback/composite-factor-four-strong-study/experiment";
import { decisionForwardStudyExperiment } from "./first-board-pullback/decision-forward-study/experiment";
import { dynamicEntryPathDistributionStudyExperiment } from "./first-board-pullback/dynamic-entry-path-distribution-study/experiment";
import { dynamicStateFactorExpansionStudyExperiment } from "./first-board-pullback/dynamic-state-factor-expansion-study/experiment";
import { conditionalPullbackStateExitStudyExperiment } from "./first-board-pullback/conditional-pullback-state-exit-study/experiment";
import { entryDayExperiment } from "./first-board-pullback/entry-day/experiment";
import { entryAlignedExitHorizonStudyExperiment } from "./first-board-pullback/entry-aligned-exit-horizon-study/experiment";
import { firstBoardBodyStudyExperiment } from "./first-board-pullback/first-board-body-study/experiment";
import { holdStreakAmplitudeT10StudyExperiment } from "./first-board-pullback/hold-streak-amplitude-t10-study/experiment";
import { fundamentalStudyExperiment } from "./first-board-pullback/fundamental-study/experiment";
import { holdOpenPricePullbackExperiment } from "./first-board-pullback/hold-open-price-pullback/experiment";
import { limitUpCloseHoldStudyExperiment } from "./first-board-pullback/limit-up-close-hold-study/experiment";
import { limitUpPriceHoldStreakStudyExperiment } from "./first-board-pullback/limit-up-price-hold-streak-study/experiment";
import { oversoldGapReversalValidationExperiment } from "./first-board-pullback/oversold-gap-reversal-validation/experiment";
import { preEventContextStudyExperiment } from "./first-board-pullback/pre-event-context-study/experiment";
import { postEventAmplitudeStudyExperiment } from "./first-board-pullback/post-event-amplitude-study/experiment";
import { singleFactorV1Experiment } from "./first-board-pullback/single-factor-v1/experiment";
import { turnoverStudyExperiment } from "./first-board-pullback/turnover-study/experiment";
import { thresholdRacePolicyStudyExperiment } from "./first-board-pullback/threshold-race-policy-study/experiment";
import { volumeRelationshipDynamicEntryStudyExperiment } from "./first-board-pullback/volume-relationship-dynamic-entry-study/experiment";
import { volumeRecoveryFilteredValidationExperiment } from "./first-board-pullback/volume-recovery-filtered-validation/experiment";
import { stabilityValidationExperiment } from "./first-board-pullback/stability-validation/experiment";
import { twelveFactorCompositeStudyExperiment } from "./first-board-pullback/twelve-factor-composite-study/experiment";
import { twelveFactorTopNRankingStudyExperiment } from "./first-board-pullback/twelve-factor-topn-ranking-study/experiment";
import { leaderCandidateBaselineExperiment } from "./combo-backtest/leader-candidate-baseline/experiment";
import { compositeRunnerNewHigh3Hold20Experiment } from "./first-board-pullback/composite-runner-newhigh3-hold20/experiment";
import { compositeRunnerNewHigh3T74Experiment } from "./first-board-pullback/composite-runner-newhigh3-t74/experiment";
import { compositeRunnerNewHigh3T74TrendExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-trend/experiment";
import { compositeRunnerNewHigh3T74TrendGateExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-trend-gate/experiment";
import { compositeRunnerNewHigh3T74TrendV2Experiment } from "./first-board-pullback/composite-runner-newhigh3-t74-trend-v2/experiment";
import { compositeRunnerT74SlotsExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-slots/experiment";
import { compositeRunnerT74StopWideExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-stopwide/experiment";
import { compositeRunnerT74Top5Experiment } from "./first-board-pullback/composite-runner-newhigh3-t74-top5/experiment";
import { compositeRunnerT74CarryoverExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-carryover/experiment";
import { compositeRunnerT74CarryoverRefreshExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-carryover-refresh/experiment";
import { compositeRunnerT74LateEntryExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-late-entry/experiment";
import { compositeRunnerT74EventGateExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-event-gate/experiment";
import { compositeRunnerT74SubNewExperiment } from "./first-board-pullback/composite-runner-newhigh3-t74-subnew/experiment";
import { trendEntryMaV1Experiment } from "./first-board-pullback/trend-entry-ma-v1/experiment";

/** 全部已注册实验（顺序不参与任何计算；registry 内部按 id 排序输出）。 */
const RAW_EXPERIMENT_DEFINITIONS: readonly ExperimentDefinition[] = [
  compositeRunnerNewHigh3Hold20Experiment,
  compositeRunnerNewHigh3T74Experiment,
  // P0：3F 选股排序 × 趋势评分融合（只改排序值；Runner / 仓位 / 退出全部冻结）
  compositeRunnerNewHigh3T74TrendExperiment,
  // P0-2：趋势分只作候选门槛（只筛不改排序）
  compositeRunnerNewHigh3T74TrendGateExperiment,
  // P1：趋势评分 v2（符号修正 + 分位融合）
  compositeRunnerNewHigh3T74TrendV2Experiment,
  // P2：只放开买入名额 / 持仓上限（选股与排序冻结）
  compositeRunnerT74SlotsExperiment,
  // P3-stopwide：只扩大固定止损（其余冻结），关注回撤
  compositeRunnerT74StopWideExperiment,
  // P4：选股广度 TopN 3 -> 5（其余冻结），目标抓更多超级票
  compositeRunnerT74Top5Experiment,
  // P6：跨日候选池 carry 1 / 2 日（第一轮不重评分）
  compositeRunnerT74CarryoverExperiment,
  // P7：跨日候选池 + 当日 CarryRefreshV1 统一重评分
  compositeRunnerT74CarryoverRefreshExperiment,
  // P8：延迟入场 + 原 top5 门槛内晚窗口滚动 3F
  compositeRunnerT74LateEntryExperiment,
  // P9：事件事实 gate（不重排 3F）
  compositeRunnerT74EventGateExperiment,
  compositeRunnerT74SubNewExperiment,
  trendEntryMaV1Experiment,
  entryDayExperiment,
  fundamentalStudyExperiment,
  bodyFilteredExitCurveStudyExperiment,
  bodyMaSupportScreenStudyExperiment,
  firstBoardBodyStudyExperiment,
  holdStreakAmplitudeT10StudyExperiment,
  stabilityValidationExperiment,
  decisionForwardStudyExperiment,
  dynamicEntryPathDistributionStudyExperiment,
  dynamicStateFactorExpansionStudyExperiment,
  conditionalPullbackStateExitStudyExperiment,
  holdOpenPricePullbackExperiment,
  limitUpCloseHoldStudyExperiment,
  limitUpPriceHoldStreakStudyExperiment,
  entryAlignedExitHorizonStudyExperiment,
  oversoldGapReversalValidationExperiment,
  preEventContextStudyExperiment,
  postEventAmplitudeStudyExperiment,
  singleFactorV1Experiment,
  turnoverStudyExperiment,
  thresholdRacePolicyStudyExperiment,
  volumeRelationshipDynamicEntryStudyExperiment,
  volumeRecoveryFilteredValidationExperiment,
  twelveFactorCompositeStudyExperiment,
  compositeFactorEqualWeightStudyExperiment,
  compositeFactorFourStrongStudyExperiment,
  // 受约束权重三方案（2F 等权 / 3F 等权 / 4F 预设 35-35-15-15）；顺序 = 方案顺序
  ...constrainedWeightExperiments,
  // 组合因子 OOS 后置窗口验证（3F 主判定 / 4F-EQ 描述性参照 / 12F-EQ 负对照）；
  // members 与 weighting 逐字复制自既有实例，**只换 id**（原因见该模块 README）；顺序 = 方案顺序
  ...compositeFactorOosValidationExperiments,
  twelveFactorTopNRankingStudyExperiment,
  leaderCandidateBaselineExperiment,
];

/**
 * 所有首板回撤核心实验统一接入公共研究底座。
 *
 * 原始定义不直接注册：生产清单中的每个核心实验都必须声明 Dataset `v5`，
 * 并输出 commonSample、entryDay × exitDay 面板、逐日净收益曲线和 Run 坐标。
 */
export const EXPERIMENT_DEFINITIONS: readonly ExperimentDefinition[] =
  RAW_EXPERIMENT_DEFINITIONS.map(definition =>
    definition.descriptor.id.startsWith("first-board-pullback/")
      ? withFirstBoardPullbackFoundation(definition)
      : definition
  );

