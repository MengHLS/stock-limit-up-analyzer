/**
 * 模式声明清单 —— **新增一种交易模式，只需要在这里加一行**。
 *
 * 顺序 = 迁移前的注册顺序（`moduleRegistry.ts` 与 `recipeRegistry.ts` 原本的排列），
 * 用于保证「同一份声明清单 ⇒ 同一套注册表」。注册表本身按 key / id 排序输出，
 * 因此顺序不参与任何计算结果。
 */

import type { TradingPatternSpec } from "../types";
import { FIRST_LIMIT_PULLBACK_HOLD_SHRINK } from "./firstLimitPullbackHoldShrink";
import { EVENT_RETURN_RESEARCH } from "./eventReturnResearch";
import { ENTRY_TIMING_RESEARCH } from "./entryTimingResearch";
import { HOLDING_PERIOD_RESEARCH } from "./holdingPeriodResearch";
import { BREAKOUT_SUCCESS_RESEARCH } from "./breakoutSuccessResearch";
import { STOP_LOSS_RESEARCH } from "./stopLossResearch";
import { MARKET_REGIME_STABILITY } from "./marketRegimeStability";
import { LEADER_CANDIDATE_BASELINE } from "./leaderCandidateBaseline";

export {
  FIRST_LIMIT_PULLBACK_HOLD_SHRINK,
  FIRST_LIMIT_PULLBACK_HOLD_SHRINK_NOTES,
} from "./firstLimitPullbackHoldShrink";
export { EVENT_RETURN_RESEARCH } from "./eventReturnResearch";
export { ENTRY_TIMING_RESEARCH } from "./entryTimingResearch";
export { HOLDING_PERIOD_RESEARCH } from "./holdingPeriodResearch";
export { BREAKOUT_SUCCESS_RESEARCH } from "./breakoutSuccessResearch";
export { STOP_LOSS_RESEARCH } from "./stopLossResearch";
export { MARKET_REGIME_STABILITY } from "./marketRegimeStability";
export { LEADER_CANDIDATE_BASELINE } from "./leaderCandidateBaseline";

/**
 * 全部已声明的交易模式。
 *
 * ⚠️ 这是一个可在**模块顶层安全求值**的常量：`patterns/*.ts` 都是叶子模块
 * （只 `import type`），不以任何方式依赖 `moduleRegistry` / `recipeRegistry` 的运行时。
 * 反过来，那两个注册表在**函数体内**读这个常量 —— 依赖方向单向，无循环 import。
 */
export const ALL_TRADING_PATTERNS: readonly TradingPatternSpec[] = [
  EVENT_RETURN_RESEARCH,
  FIRST_LIMIT_PULLBACK_HOLD_SHRINK,
  ENTRY_TIMING_RESEARCH,
  HOLDING_PERIOD_RESEARCH,
  BREAKOUT_SUCCESS_RESEARCH,
  STOP_LOSS_RESEARCH,
  MARKET_REGIME_STABILITY,
  LEADER_CANDIDATE_BASELINE,
];
