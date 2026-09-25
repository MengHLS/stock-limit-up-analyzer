/**
 * 实验页面注册表（**新增实验的第 2 个（也是最后一个）人工改动点**）。
 *
 * ## 用法
 *
 * 新增一个实验时，在这里加 1 行：
 *
 * ```ts
 * import MyPage from "@experiments/my-group/my-experiment/page";
 *
 * export const EXPERIMENT_PAGES: Readonly<Record<string, ExperimentPageComponent>> = {
 *   "first-board-pullback/entry-day": EntryDayExperimentPage,
 *   "my-group/my-experiment": MyPage,   // ← 键必须等于 descriptor.pageKey
 * };
 * ```
 *
 * 键 = `descriptor.pageKey`。键对不上（或忘记注册）**不会白屏** ——
 * 平台会降级到通用结果渲染器，并在页面上明确提示「该实验未注册自定义页面」，
 * 因此「忘了注册」表现为一条可见的提示，而不是一个打不开的页面。
 *
 * ## 为什么不用 `import.meta.glob` 自动发现
 *
 * 本仓库约定「无目录扫描、无 `import.meta.glob`、无 codegen」
 * （先例：`server/research/patternLibrary/patterns/index.ts`）。显式映射可 diff、
 * 可 code review，且不依赖打包器行为 —— 对研究平台来说，「可复现」优先于「魔法」。
 */

import DecisionForwardStudyPage from "@experiments/first-board-pullback/decision-forward-study/page";
import BodyFilteredExitCurveStudyPage from "@experiments/first-board-pullback/body-filtered-exit-curve-study/page";
import BodyMaSupportScreenStudyPage from "@experiments/first-board-pullback/body-ma-support-screen-study/page";
import CompositeFactorEqualWeightStudyPage from "@experiments/first-board-pullback/composite-factor-equal-weight-study/page";
import CompositeFactorFourStrongStudyPage from "@experiments/first-board-pullback/composite-factor-four-strong-study/page";
import CompositeFactorConstrainedWeightStudyPage from "@experiments/first-board-pullback/composite-factor-constrained-weight-study/page";
import CompositeFactorOosValidationStudyPage from "@experiments/first-board-pullback/composite-factor-oos-validation-study/page";
import DynamicEntryPathDistributionStudyPage from "@experiments/first-board-pullback/dynamic-entry-path-distribution-study/page";
import DynamicStateFactorExpansionStudyPage from "@experiments/first-board-pullback/dynamic-state-factor-expansion-study/page";
import ConditionalPullbackStateExitStudyPage from "@experiments/first-board-pullback/conditional-pullback-state-exit-study/page";
import EntryDayExperimentPage from "@experiments/first-board-pullback/entry-day/page";
import EntryAlignedExitHorizonStudyPage from "@experiments/first-board-pullback/entry-aligned-exit-horizon-study/page";
import FirstBoardBodyStudyPage from "@experiments/first-board-pullback/first-board-body-study/page";
import HoldStreakAmplitudeT10StudyPage from "@experiments/first-board-pullback/hold-streak-amplitude-t10-study/page";
import FundamentalStudyExperimentPage from "@experiments/first-board-pullback/fundamental-study/page";
import HoldOpenPricePullbackPage from "@experiments/first-board-pullback/hold-open-price-pullback/page";
import LimitUpCloseHoldStudyPage from "@experiments/first-board-pullback/limit-up-close-hold-study/page";
import LimitUpPriceHoldStreakStudyPage from "@experiments/first-board-pullback/limit-up-price-hold-streak-study/page";
import OversoldGapReversalValidationPage from "@experiments/first-board-pullback/oversold-gap-reversal-validation/page";
import PreEventContextStudyPage from "@experiments/first-board-pullback/pre-event-context-study/page";
import PostEventAmplitudeStudyPage from "@experiments/first-board-pullback/post-event-amplitude-study/page";
import SingleFactorV1Page from "@experiments/first-board-pullback/single-factor-v1/page";
import TurnoverStudyPage from "@experiments/first-board-pullback/turnover-study/page";
import ThresholdRacePolicyStudyPage from "@experiments/first-board-pullback/threshold-race-policy-study/page";
import VolumeRelationshipDynamicEntryStudyPage from "@experiments/first-board-pullback/volume-relationship-dynamic-entry-study/page";
import VolumeRecoveryFilteredValidationPage from "@experiments/first-board-pullback/volume-recovery-filtered-validation/page";
import StabilityValidationExperimentPage from "@experiments/first-board-pullback/stability-validation/page";
import TwelveFactorCompositeStudyPage from "@experiments/first-board-pullback/twelve-factor-composite-study/page";
import TwelveFactorTopNRankingStudyPage from "@experiments/first-board-pullback/twelve-factor-topn-ranking-study/page";
import LeaderCandidateBaselinePage from "@experiments/combo-backtest/leader-candidate-baseline/page";
import type { ExperimentPageComponent } from "./contract";

/** pageKey → 实验页面组件。 */
export const EXPERIMENT_PAGES: Readonly<
  Record<string, ExperimentPageComponent>
> = {
  "first-board-pullback/body-filtered-exit-curve-study":
    BodyFilteredExitCurveStudyPage,
  "first-board-pullback/body-ma-support-screen-study":
    BodyMaSupportScreenStudyPage,
  "first-board-pullback/composite-factor-equal-weight-study":
    CompositeFactorEqualWeightStudyPage,
  "first-board-pullback/composite-factor-four-strong-study":
    CompositeFactorFourStrongStudyPage,
  // 受约束权重三方案共用一份页面（结果结构同构，靠 descriptor + payload 区分）
  "first-board-pullback/composite-factor-2f-amplitude-study":
    CompositeFactorConstrainedWeightStudyPage,
  "first-board-pullback/composite-factor-3f-amplitude-volume-study":
    CompositeFactorConstrainedWeightStudyPage,
  "first-board-pullback/composite-factor-4f-weighted-study":
    CompositeFactorConstrainedWeightStudyPage,
  // OOS 后置窗口验证三方案共用一份页面（与上面同构，另加「研究协议与评估窗口」一栏）
  "first-board-pullback/composite-factor-3f-amplitude-volume-oos-study":
    CompositeFactorOosValidationStudyPage,
  "first-board-pullback/composite-factor-4f-equal-weight-oos-study":
    CompositeFactorOosValidationStudyPage,
  "first-board-pullback/composite-factor-12f-equal-weight-oos-study":
    CompositeFactorOosValidationStudyPage,
  "first-board-pullback/decision-forward-study": DecisionForwardStudyPage,
  "first-board-pullback/dynamic-entry-path-distribution-study":
    DynamicEntryPathDistributionStudyPage,
  "first-board-pullback/dynamic-state-factor-expansion-study":
    DynamicStateFactorExpansionStudyPage,
  "first-board-pullback/conditional-pullback-state-exit-study":
    ConditionalPullbackStateExitStudyPage,
  "first-board-pullback/entry-day": EntryDayExperimentPage,
  "first-board-pullback/entry-aligned-exit-horizon-study":
    EntryAlignedExitHorizonStudyPage,
  "first-board-pullback/first-board-body-study": FirstBoardBodyStudyPage,
  "first-board-pullback/hold-streak-amplitude-t10-study":
    HoldStreakAmplitudeT10StudyPage,
  "first-board-pullback/fundamental-study": FundamentalStudyExperimentPage,
  "first-board-pullback/hold-open-price-pullback": HoldOpenPricePullbackPage,
  "first-board-pullback/limit-up-close-hold-study": LimitUpCloseHoldStudyPage,
  "first-board-pullback/limit-up-price-hold-streak-study":
    LimitUpPriceHoldStreakStudyPage,
  "first-board-pullback/oversold-gap-reversal-validation":
    OversoldGapReversalValidationPage,
  "first-board-pullback/pre-event-context-study": PreEventContextStudyPage,
  "first-board-pullback/post-event-amplitude-study":
    PostEventAmplitudeStudyPage,
  "first-board-pullback/single-factor-v1": SingleFactorV1Page,
  "first-board-pullback/turnover-study": TurnoverStudyPage,
  "first-board-pullback/threshold-race-policy-study":
    ThresholdRacePolicyStudyPage,
  "first-board-pullback/volume-relationship-dynamic-entry-study":
    VolumeRelationshipDynamicEntryStudyPage,
  "first-board-pullback/volume-recovery-filtered-validation":
    VolumeRecoveryFilteredValidationPage,
  "first-board-pullback/stability-validation":
    StabilityValidationExperimentPage,
  "first-board-pullback/twelve-factor-composite-study":
    TwelveFactorCompositeStudyPage,
  "first-board-pullback/twelve-factor-topn-ranking-study":
    TwelveFactorTopNRankingStudyPage,
  "combo-backtest/leader-candidate-baseline": LeaderCandidateBaselinePage,
};

/** 取页面组件；未注册返回 null（由调用方降级并提示）。 */
export function experimentPageOf(
  pageKey: string
): ExperimentPageComponent | null {
  return EXPERIMENT_PAGES[pageKey] ?? null;
}
