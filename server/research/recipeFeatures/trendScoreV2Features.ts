/**
 * 运行工作台 —— **趋势评分 v2（符号修正版）** 的纯计算（P1）。
 *
 * ## 为什么有 v2
 *
 * v1（`trendScoreFeatures.ts`）把「站上窗内均线 + 追动量 + 贴新高」当正向，实测三者**方向全反**：
 * `docs/evidence/_analysis_trend_score_v1_forward_ic_20261004.json`（口径：入场 rd6 开盘 / 出场 rdN 收盘 / 毛收益 /
 * 全候选池 43,528 个 / Spearman IC + 200 次 bootstrap 95% CI）：
 *
 * | 分量 | rd10 IC | rd16 IC | 控制 3F 的偏 IC（rd10 / rd16） | 方向含义 |
 * |---|---|---|---|---|
 * | `structureGap`（连续结构） | -0.0342 | -0.0337 | -0.0352 / -0.0351 | 越大越差 |
 * | `momentum`（相对首板日收盘） | -0.0338 | -0.0409 | -0.0327 / -0.0394 | 越大越差 |
 * | `pullbackDepth`（回撤深度） | +0.0252 | +0.0230 | +0.0324 / +0.0329 | **越大越好** |
 * | 3F 合成分（对照） | +0.0499 | +0.0695 | — | 越大越好 |
 *
 * 三者的偏 IC 不随控制 3F 而衰减，与 3F 的秩相关仅 |rho| <= 0.15 ⇒ **不是 3F 的代理**。
 *
 * ## 本模块只做「原始量 + 方向」
 *
 * 三项原始量的量纲完全不同（回撤 ∈ [0,1]、动量 ∈ (-1,+∞)、结构偏离 ∈ (-1,+∞)），
 * 直接加权会被动量极值支配 ⇒ **横截面分位化不在本模块做**，它需要当日 peer 集合，
 * 由组合层（`compositeRunner#buildCompositeSourceRun`）用唯一 ranker `framework/ranking#rankSignals` 完成。
 * 本模块只负责：由「事件日 rd0 → 决策日 rd5」的 bars 算出**三项目的小越好的原始量**。
 *
 * ## PIT
 *
 * 只读入参序列；入参必须已在决策日截断（rd0..5 共 6 根），多于 6 根**响亮抛错**
 * （与 v1 同一防线，理由见 `trendScoreFeatures.ts`）。
 */
import type { CanonicalMarketBar } from "../../data";
import { TREND_DECISION_WINDOW_BARS } from "./trendScoreFeatures";

/** 方向化后的三个分量（都满足「越大越好」）。 */
export interface TrendV2Components {
  /** 回撤深度：`(事件以来最高收盘 - 决策日收盘) / 最高收盘`。越大越好（实测 +IC）。 */
  readonly pullbackDepth: number;
  /** 取负的动量：`-(决策日收盘 / 首板日收盘 - 1)`。越大越好（= 涨幅越小越好，实测 -IC）。 */
  readonly negMomentum: number;
  /** 取负的连续结构偏离：`-(决策日收盘 / 事件窗收盘均值 - 1)`。越大越好（= 越贴近/跌破窗内均值越好，实测 -IC）。 */
  readonly negWindowGap: number;
}

/** 分量 id（组合层横截面分位化时的键；顺序即合成顺序，参与浮点累加 ⇒ 不得随意改序）。 */
export const TREND_V2_COMPONENT_IDS = ["pullbackDepth", "negMomentum", "negWindowGap"] as const;
export type TrendV2ComponentId = (typeof TREND_V2_COMPONENT_IDS)[number];

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 决策窗形状防线（与 v1 同一条：少于 6 根 ⇒ null；多于 6 根 ⇒ 抛错）。 */
function decisionWindowOf(bars: readonly CanonicalMarketBar[]): readonly CanonicalMarketBar[] | null {
  if (bars.length < TREND_DECISION_WINDOW_BARS) return null;
  if (bars.length > TREND_DECISION_WINDOW_BARS) {
    throw new Error(
      `趋势评分 v2：入参必须是「事件日 → 决策日」截断后的 ${TREND_DECISION_WINDOW_BARS} 根 bar，`
        + `实际 ${bars.length} 根 —— 调用方必须在决策日截断（PIT，禁未来数据）。`,
    );
  }
  return bars;
}

/**
 * 三项**方向化**分量；任一分量不可算 ⇒ `null`（不插补、不填 0）。
 *
 * 注意 `pullbackDepth` 在这个坐标上恒 >= 0（决策日收盘不高于事件以来最高收盘），
 * 而 `negMomentum` / `negWindowGap` 可正可负。
 */
export function computeTrendV2Components(bars: readonly CanonicalMarketBar[]): TrendV2Components | null {
  const window = decisionWindowOf(bars);
  if (window === null) return null;
  const closes: number[] = [];
  for (const bar of window) {
    if (!isFinitePositive(bar.close)) return null;
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
  if (![pullbackDepth, negMomentum, negWindowGap].every((value) => Number.isFinite(value))) return null;
  return { pullbackDepth, negMomentum, negWindowGap };
}

/**
 * 三项目量取平均前的**方向化合成值**（**未**做横截面分位；仅用于需要单值、且 day 内只有一只候选时的退化路径）。
 *
 * 组合层请优先用「逐分量横截面分位 + 等权平均」的路径（见 `compositeRunner`），
 * 否则量纲差异会让动量支配结果。
 */
export function computeTrendV2MeanComponent(bars: readonly CanonicalMarketBar[]): number | null {
  const components = computeTrendV2Components(bars);
  if (components === null) return null;
  return (components.pullbackDepth + components.negMomentum + components.negWindowGap) / 3;
}

/** 把 v2 的等权分位合成与 3F 合成分融合（`null` 安全的调用方由组合层负责）。 */
export function fuseTrendV2IntoThreeFactorScore(
  threeFactorScore: number,
  trendV2Percentile: number,
  v2Weight: number,
): number {
  if (!Number.isFinite(threeFactorScore)) {
    throw new Error(`趋势 v2 融合：3F 合成分必须是有限数字，实际 ${String(threeFactorScore)}。`);
  }
  if (!Number.isFinite(trendV2Percentile)) {
    throw new Error(`趋势 v2 融合：v2 分位必须是有限数字，实际 ${String(trendV2Percentile)}。`);
  }
  if (!Number.isFinite(v2Weight) || v2Weight < 0 || v2Weight > 1) {
    throw new Error(`趋势 v2 融合：v2Weight 必须位于 [0,1]，实际 ${String(v2Weight)}。`);
  }
  return (1 - v2Weight) * threeFactorScore + v2Weight * trendV2Percentile;
}
