/**
 * P7 · 跨日候选池的当日重评分（CarryRefreshV1）。
 *
 * 与 trendScoreV2Features.ts 的关系：
 *   - 复用其**实测方向**：回撤深度越大越好、动量越弱越好、越贴近事件窗均线越好；
 *   - 但趋势 v2 固定只读 rd0..5 共 6 根；本模块允许 rd0..D（D=5/6/7），
 *     首板事件的观察窗随当前决策日延长，供 fresh 与 carry 在同一决策日统一重评分；
 *   - 本模块不自行分位化：三个分量量纲不同，横截面分位由调用方在当日候选集合上完成。
 *
 * PIT：
 *   - 入参必须已截断到当前决策日；本模块只读入参；
 *   - 少于 6 根 ⇒ null；多于 8 根 ⇒ 响亮抛错（第一轮 carry 最多跨 2 个决策日）。
 */
import type { CanonicalMarketBar } from "../../data";

export const CARRY_REFRESH_MIN_BARS = 6;
export const CARRY_REFRESH_MAX_BARS = 8;

export interface CarryRefreshComponents {
  /** (事件以来最高收盘 - 决策日收盘) / 最高收盘；越大越好。 */
  readonly pullbackDepth: number;
  /** -(决策日收盘 / 首板日收盘 - 1)；越大越好。 */
  readonly negMomentum: number;
  /** -(决策日收盘 / 事件窗收盘均值 - 1)；越大越好。 */
  readonly negWindowGap: number;
}

export const CARRY_REFRESH_COMPONENT_IDS = [
  "pullbackDepth",
  "negMomentum",
  "negWindowGap",
] as const;
export type CarryRefreshComponentId = (typeof CARRY_REFRESH_COMPONENT_IDS)[number];

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 由「事件日 rd0 → 当前决策日 rdD」的连续 bars 计算三项方向化分量。
 * bars.length 必须是 [6,8]；否则按“不可证实”返回 null / 抛错，不插补。
 */
export function computeCarryRefreshComponents(
  bars: readonly CanonicalMarketBar[],
): CarryRefreshComponents | null {
  if (bars.length < CARRY_REFRESH_MIN_BARS) return null;
  if (bars.length > CARRY_REFRESH_MAX_BARS) {
    throw new Error(
      "CarryRefreshV1：入参必须是已按当前决策日截断的 "
        + CARRY_REFRESH_MIN_BARS + ".." + CARRY_REFRESH_MAX_BARS + " 根 bar，"
        + "实际 " + bars.length + " 根 —— 调用方必须在当前决策日截断（PIT，禁未来数据）。",
    );
  }

  const closes: number[] = [];
  for (const bar of bars) {
    if (!finitePositive(bar.close)) return null;
    closes.push(bar.close);
  }
  const eventClose = closes[0]!;
  const decisionClose = closes[closes.length - 1]!;
  let peak = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    sum += close;
  }
  if (!Number.isFinite(peak) || peak <= 0) return null;
  const mean = sum / closes.length;
  if (!Number.isFinite(mean) || mean <= 0) return null;

  const pullbackDepth = (peak - decisionClose) / peak;
  const negMomentum = -(decisionClose / eventClose - 1);
  const negWindowGap = -(decisionClose / mean - 1);
  if (![pullbackDepth, negMomentum, negWindowGap].every(Number.isFinite)) return null;
  return { pullbackDepth, negMomentum, negWindowGap };
}

/** 三个方向化分量的等权均值；仅用于诊断，不替代横截面分位。 */
export function computeCarryRefreshMeanComponent(
  bars: readonly CanonicalMarketBar[],
): number | null {
  const components = computeCarryRefreshComponents(bars);
  if (components === null) return null;
  return (
    components.pullbackDepth
    + components.negMomentum
    + components.negWindowGap
  ) / 3;
}

/** 将 CarryRefreshV1 的当日横截面分位融合到原始 3F 分。 */
export function fuseCarryRefreshIntoBaseScore(
  baseScore: number,
  refreshPercentile: number,
  refreshWeight: number,
): number {
  if (!Number.isFinite(baseScore)) {
    throw new Error("CarryRefreshV1 融合：baseScore 必须是有限数字。");
  }
  if (!Number.isFinite(refreshPercentile)) {
    throw new Error("CarryRefreshV1 融合：refreshPercentile 必须是有限数字。");
  }
  if (!Number.isFinite(refreshWeight) || refreshWeight < 0 || refreshWeight > 1) {
    throw new Error("CarryRefreshV1 融合：refreshWeight 必须位于 [0,1]。");
  }
  return (1 - refreshWeight) * baseScore + refreshWeight * refreshPercentile;
}
