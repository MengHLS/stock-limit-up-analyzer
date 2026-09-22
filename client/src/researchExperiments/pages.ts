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
import ConditionalPullbackStateExitStudyPage from "@experiments/first-board-pullback/conditional-pullback-state-exit-study/page";
import EntryDayExperimentPage from "@experiments/first-board-pullback/entry-day/page";
import FirstBoardBodyStudyPage from "@experiments/first-board-pullback/first-board-body-study/page";
import FundamentalStudyExperimentPage from "@experiments/first-board-pullback/fundamental-study/page";
import HoldOpenPricePullbackPage from "@experiments/first-board-pullback/hold-open-price-pullback/page";
import LimitUpCloseHoldStudyPage from "@experiments/first-board-pullback/limit-up-close-hold-study/page";
import OversoldGapReversalValidationPage from "@experiments/first-board-pullback/oversold-gap-reversal-validation/page";
import PreEventContextStudyPage from "@experiments/first-board-pullback/pre-event-context-study/page";
import PostEventAmplitudeStudyPage from "@experiments/first-board-pullback/post-event-amplitude-study/page";
import TurnoverStudyPage from "@experiments/first-board-pullback/turnover-study/page";
import VolumeRelationshipDynamicEntryStudyPage from "@experiments/first-board-pullback/volume-relationship-dynamic-entry-study/page";
import VolumeRecoveryFilteredValidationPage from "@experiments/first-board-pullback/volume-recovery-filtered-validation/page";
import StabilityValidationExperimentPage from "@experiments/first-board-pullback/stability-validation/page";
import type { ExperimentPageComponent } from "./contract";

/** pageKey → 实验页面组件。 */
export const EXPERIMENT_PAGES: Readonly<
  Record<string, ExperimentPageComponent>
> = {
  "first-board-pullback/decision-forward-study": DecisionForwardStudyPage,
  "first-board-pullback/conditional-pullback-state-exit-study":
    ConditionalPullbackStateExitStudyPage,
  "first-board-pullback/entry-day": EntryDayExperimentPage,
  "first-board-pullback/first-board-body-study": FirstBoardBodyStudyPage,
  "first-board-pullback/fundamental-study": FundamentalStudyExperimentPage,
  "first-board-pullback/hold-open-price-pullback": HoldOpenPricePullbackPage,
  "first-board-pullback/limit-up-close-hold-study": LimitUpCloseHoldStudyPage,
  "first-board-pullback/oversold-gap-reversal-validation":
    OversoldGapReversalValidationPage,
  "first-board-pullback/pre-event-context-study": PreEventContextStudyPage,
  "first-board-pullback/post-event-amplitude-study":
    PostEventAmplitudeStudyPage,
  "first-board-pullback/turnover-study": TurnoverStudyPage,
  "first-board-pullback/volume-relationship-dynamic-entry-study":
    VolumeRelationshipDynamicEntryStudyPage,
  "first-board-pullback/volume-recovery-filtered-validation":
    VolumeRecoveryFilteredValidationPage,
  "first-board-pullback/stability-validation":
    StabilityValidationExperimentPage,
};

/** 取页面组件；未注册返回 null（由调用方降级并提示）。 */
export function experimentPageOf(
  pageKey: string
): ExperimentPageComponent | null {
  return EXPERIMENT_PAGES[pageKey] ?? null;
}
