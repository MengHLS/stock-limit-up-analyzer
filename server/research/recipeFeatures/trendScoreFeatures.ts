/**
 * 运行工作台 —— **趋势评分**（P0：选股排序融合的第二维）的**纯计算**。
 *
 * ## 这个模块是什么
 *
 * `first-limit-pullback-3f-top3@1.62.1`（及其 Runner 变体 T74）**只用 3F 合成分**排 TopN。
 * P0 的假设是：在**同样的候选池**上把「趋势评分」按权重融合进排序值，能在不改退出政策、
 * 不改仓位、不改 Runner 的前提下继续提高组合收益。
 *
 * 因此本文件只做一件事：给定「首板日 → 决策日」这段**已经截断**的 bar 序列，算出
 * `trendScore ∈ [0,1]`，以及把它与 3F 合成分融合后的排序值。**无 IO、无副作用、确定性。**
 *
 * ## 🔴 与方案 V1 的一处**如实偏差**（P0 必须登记）
 *
 * 方案 V1 写的结构分是 `trendHoldsMa5Ma10`（收盘 > MA10 且 MA5 > MA10）。
 * 但**当前数据集坐标下 MA10 不可算**：`750001` / `780001` 的实测分布是
 * 「prefix 只有 `relativeDay = 0`（每个事件恰 1 行），post 为 `relativeDay = 1..80`」，
 * 即**没有任何 `relativeDay < 0` 的预热行**。决策日（T+5）可见历史 = 事件窗内 6 根
 * （`rd 0..5`）⇒ MA10 无从计算，`computeTrendHoldsMa5Ma10` 在这个坐标上恒返回 `null`。
 *
 * P0 因此把结构分定义为**事件窗内的均线结构**（收盘站上窗内均值 + 均线抬升），
 * 与 V1 的「价在均线上 + 均线多头」同义，只是窗口长度由数据可得性决定。
 * 这一处与 `momentum` / `pullback` 的阈值一样属于**候选边界**：必须在训练段冻结后
 * 才允许进入 HOLDOUT，不能在完整样本上调参（见该实验 README）。
 *
 * ## PIT（不变量 I-4）
 *
 * 本模块**只读入参序列**。调用方必须在**决策日截断**（组合侧由
 * `compositeRunner#decisionWindowBarsOf` 保证只取 `rd 0..决策日`）；本模块不读
 * `bars` 之外的任何数据，也不读 `relativeDay > 决策日` 的行。
 */

import type { CanonicalMarketBar } from "../../data";

/**
 * 决策窗长度（事件日 + T+1..T+5）。3F TopN 的决策日是 T+5，因此正式口径下
 * 入参恰好 6 根。
 *
 * 🔴 入参形状是本模块的 **PIT 防线**（不是可选项）：
 *   - 少于 6 根 ⇒ 该特征**不可算**，返回 `null`（不插补）；
 *   - 多于 6 根 ⇒ **响亮抛错**，因为那意味着调用方没有在决策日截断，
 *     直接把 rd > 决策日的行喂了进来（会静默读未来数据）。
 */
export const TREND_DECISION_WINDOW_BARS = 6;

/** 结构分用的短均线窗口（最近 / 最早各 3 根收盘）。 */
const STRUCTURE_LEG_BARS = 3;

/**
 * 趋势评分阈值（P0 第一轮冻结值）。
 *
 * 🔴 全部是**候选边界**：训练段冻结前不得在完整样本上调整。
 * 调整任一项都等于换了一个趋势评分定义 ⇒ 必须新开 arm / 新版本，不得回改历史留档。
 */
export interface TrendScoreThresholds {
  /** 动量 `<` 该值 ⇒ 动量分 0（决策日收盘仍低于首板日收盘）。 */
  readonly momentumWeakBelow: number;
  /** 动量 `>=` 该值 ⇒ 动量分 1；其间 ⇒ 0.5。 */
  readonly momentumStrongAtOrAbove: number;
  /** 相对事件以来最高收盘的回撤 `<=` 该值 ⇒ 回踩分 1（贴紧新高）。 */
  readonly pullbackShallowAtOrBelow: number;
  /** 回撤 `>` 该值 ⇒ 回踩分 0（结构走坏）；其间 ⇒ 0.5。 */
  readonly pullbackDeepAbove: number;
}

export const DEFAULT_TREND_SCORE_THRESHOLDS: TrendScoreThresholds = {
  momentumWeakBelow: 0,
  momentumStrongAtOrAbove: 0.03,
  pullbackShallowAtOrBelow: 0.03,
  pullbackDeepAbove: 0.08,
};

/** 三个分项（各为 0 / 0.5 / 1 或 0 / 1），便于在页面上逐项归因。 */
export interface TrendScoreComponents {
  readonly structureScore: number;
  readonly momentumScore: number;
  readonly pullbackScore: number;
}

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 取「事件日 → 决策日」的决策窗；长度不符 ⇒ 见 `TREND_DECISION_WINDOW_BARS` 的说明。
 */
function decisionWindowOf(
  bars: readonly CanonicalMarketBar[],
): readonly CanonicalMarketBar[] | null {
  if (bars.length < TREND_DECISION_WINDOW_BARS) return null;
  if (bars.length > TREND_DECISION_WINDOW_BARS) {
    throw new Error(
      `趋势评分：入参必须是「事件日 → 决策日」截断后的 ${TREND_DECISION_WINDOW_BARS} 根 bar，`
        + `实际 ${bars.length} 根 —— 调用方必须在决策日截断（PIT，禁未来数据）。`,
    );
  }
  return bars;
}

function meanOf(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * 取序列里所有收盘价；任一缺失 / 非有限 / 非正 ⇒ `null`（**不跳过**缺失 bar 伪造序列）。
 */
function closesOf(bars: readonly CanonicalMarketBar[]): number[] | null {
  const closes: number[] = [];
  for (const bar of bars) {
    if (!isFinitePositive(bar.close)) return null;
    closes.push(bar.close);
  }
  return closes;
}

/**
 * 结构分：`决策日收盘 > 事件窗收盘均值` 且 `最近 3 根收盘均值 > 最早 3 根收盘均值` ⇒ 1，否则 0。
 *
 * 序列不足 `TREND_DECISION_WINDOW_BARS` 根 ⇒ `null`（**不把「数据不足」伪装成结构不成立**）。
 */
export function computeTrendStructureScore(bars: readonly CanonicalMarketBar[]): number | null {
  const window = decisionWindowOf(bars);
  if (window === null) return null;
  const closes = closesOf(window);
  if (closes === null) return null;
  const last = closes[closes.length - 1]!;
  const early = meanOf(closes.slice(0, STRUCTURE_LEG_BARS));
  const recent = meanOf(closes.slice(-STRUCTURE_LEG_BARS));
  const windowMean = meanOf(closes);
  if (!Number.isFinite(windowMean) || !Number.isFinite(early) || !Number.isFinite(recent)) return null;
  return last > windowMean && recent > early ? 1 : 0;
}

/**
 * 动量分：决策日收盘相对**首板日收盘**的涨幅。
 *
 * `< momentumWeakBelow` ⇒ 0；`>= momentumStrongAtOrAbove` ⇒ 1；其间 ⇒ 0.5。
 */
export function computeTrendMomentumScore(
  bars: readonly CanonicalMarketBar[],
  thresholds: TrendScoreThresholds = DEFAULT_TREND_SCORE_THRESHOLDS,
): number | null {
  const window = decisionWindowOf(bars);
  if (window === null) return null;
  const closes = closesOf(window);
  if (closes === null) return null;
  const momentum = closes[closes.length - 1]! / closes[0]! - 1;
  if (!Number.isFinite(momentum)) return null;
  if (momentum < thresholds.momentumWeakBelow) return 0;
  if (momentum >= thresholds.momentumStrongAtOrAbove) return 1;
  return 0.5;
}

/**
 * 回踩分：决策日收盘相对**事件以来最高收盘**的回撤。
 *
 * `<= pullbackShallowAtOrBelow` ⇒ 1（贴紧新高）；`> pullbackDeepAbove` ⇒ 0（结构走坏）；其间 ⇒ 0.5。
 */
export function computeTrendPullbackScore(
  bars: readonly CanonicalMarketBar[],
  thresholds: TrendScoreThresholds = DEFAULT_TREND_SCORE_THRESHOLDS,
): number | null {
  const window = decisionWindowOf(bars);
  if (window === null) return null;
  const closes = closesOf(window);
  if (closes === null) return null;
  const peak = Math.max(...closes);
  if (!Number.isFinite(peak) || peak <= 0) return null;
  const pullback = (peak - closes[closes.length - 1]!) / peak;
  if (!Number.isFinite(pullback)) return null;
  if (pullback <= thresholds.pullbackShallowAtOrBelow) return 1;
  if (pullback > thresholds.pullbackDeepAbove) return 0;
  return 0.5;
}

/** 三个分项；任一项不可算 ⇒ `null`（不插补、不填 0）。 */
export function computeTrendScoreComponents(
  bars: readonly CanonicalMarketBar[],
  thresholds: TrendScoreThresholds = DEFAULT_TREND_SCORE_THRESHOLDS,
): TrendScoreComponents | null {
  const structureScore = computeTrendStructureScore(bars);
  const momentumScore = computeTrendMomentumScore(bars, thresholds);
  const pullbackScore = computeTrendPullbackScore(bars, thresholds);
  if (structureScore === null || momentumScore === null || pullbackScore === null) return null;
  return { structureScore, momentumScore, pullbackScore };
}

/**
 * `trendScore = (结构分 + 动量分 + 回踩分) / 3`，落在 `[0,1]`。
 *
 * 累加顺序固定为（结构 → 动量 → 回踩）——浮点结果因此可复现；
 * 桶位分横截面上同值极多，顺序变化会改变 TopN 边界上的破平次序。
 */
export function computeTrendScore(
  bars: readonly CanonicalMarketBar[],
  thresholds: TrendScoreThresholds = DEFAULT_TREND_SCORE_THRESHOLDS,
): number | null {
  const components = computeTrendScoreComponents(bars, thresholds);
  if (components === null) return null;
  return (
    components.structureScore + components.momentumScore + components.pullbackScore
  ) / 3;
}

/**
 * 排序融合：`fused = (1 - trendWeight) · threeFactorScore + trendWeight · trendScore`。
 *
 * `trendWeight = 0` ⇒ 逐位等于 3F 合成分（但**仍要求 trendScore 可算**，
 * 因此控制臂不要用 0，直接用 `rankFusion = null` 走既有路径）。
 * 权重越界 ⇒ 响亮抛错（不静默夹取）。
 */
export function fuseTrendIntoThreeFactorScore(
  threeFactorScore: number,
  trendScore: number,
  trendWeight: number,
): number {
  if (!Number.isFinite(threeFactorScore)) {
    throw new Error(`趋势融合：3F 合成分必须是有限数字，实际 ${String(threeFactorScore)}。`);
  }
  if (!Number.isFinite(trendScore)) {
    throw new Error(`趋势融合：趋势评分必须是有限数字，实际 ${String(trendScore)}。`);
  }
  if (!Number.isFinite(trendWeight) || trendWeight < 0 || trendWeight > 1) {
    throw new Error(`趋势融合：trendWeight 必须位于 [0,1]，实际 ${String(trendWeight)}。`);
  }
  return (1 - trendWeight) * threeFactorScore + trendWeight * trendScore;
}