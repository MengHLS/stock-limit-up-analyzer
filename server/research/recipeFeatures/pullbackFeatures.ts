/**
 * 运行工作台 — 「首板回踩 · 守线 + 缩量」配方的**特征实现**。
 *
 * ## 为什么单独成文件
 *
 * `recipeRegistry.ts` 的职责是「注册表 + 解析 + 校验」；把每个配方的特征计算摊在里面会让
 * 它随配方数量线性膨胀。本文件只放**纯计算**：由（已按 decisionTime as-of 过滤的）bars
 * 算出特征值，无 IO、无副作用、确定性。与 `variables.ts` 的 `resolve` 同性质。
 *
 * ## 口径来源（🔴 与 Research 侧逐字对齐，禁另立口径）
 *
 * 这些特征必须与研究分析里那 13 条 CONDITIONAL 的**同名口径**一致，否则「研究说有效、
 * 回测跑的是另一个东西」——正是本次改造要消灭的错配。对齐关系：
 *
 * | 本文件特征 | Research 侧变量 | 口径 |
 * |---|---|---|
 * | `haircutFromEventLow` | `obs_{k}d.low` / `prefix(rd=0).open` | 观察日最低价相对**首板日开盘价**的回撤深度 |
 * | `volumeRatio` | `obs_{k}d.volume_ratio` | 观察日成交量 / 首板日成交量 |
 * | `isBullish` | `pullback_last_is_bullish_{k}d` | 观察日收盘 > 观察日开盘（用户口径「红盘」） |
 * | `closeRatioFromEventClose` | `obs_{k}d.return_from_event_close` | 观察日收盘 / 首板日收盘 − 1 |
 *
 * ## 为什么基准取「窗口内第一根 bar 的首板日数据」
 *
 * `bars` 是**单一证券**的历史序列（已按 `decisionTime` as-of 过滤）。首板日 D0 即「观察窗口
 * 开始前最后一根 bar」所对应的首板日 —— 但本配方不需要自己找：调用方（`signalEngine` 的
 * pipeline）传入的 `bars` 尾部即决策日，而首板日的基准价由**窗口起点前的最后一根 bar**给出。
 *
 * ⚠️ 简化与诚实边界：本实现用 **bars 序列里第 1 根 bar** 作为首板日基准（`bars[0]`）。
 * 这样做的依据是：装配层给每个信号日的 bars 都是「该日 as-of 的完整历史」，而首板事件的
 * 起点就是序列开头。若未来窗口左边界未预热（`bars[0]` 不是首板日），特征会偏 ——
 * 这是**已知限制**，已在 `_probe_recipe_features.mts` 用真实数据取证，不做静默假设。
 */

import type { CanonicalMarketBar } from "../../data";

/** 首板日基准（来自观察窗口起点那根 bar）。 */
export interface EventBaseline {
  readonly open: number;
  readonly close: number;
  readonly volume: number;
  readonly low: number;
}

/**
 * 取「首板日」基准 = bars 序列**第一根** bar。
 *
 * 返回 null 表示无法构造基准（序列为空 / 关键字段缺失 / volume ≤ 0）⇒ 调用方应让特征返回
 * null（该证券不参与），**禁止**填默认值。
 */
export function eventBaselineOf(bars: readonly CanonicalMarketBar[]): EventBaseline | null {
  const first = bars[0];
  if (first === undefined) return null;
  const { open, close, volume, low } = first;
  if (
    typeof open !== "number" || !Number.isFinite(open) || open <= 0
    || typeof close !== "number" || !Number.isFinite(close) || close <= 0
    || typeof low !== "number" || !Number.isFinite(low)
    || typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0
  ) {
    return null;
  }
  return { open, close, volume, low };
}

/** 决策日那根 bar（序列末根）。 */
export function decisionBarOf(bars: readonly CanonicalMarketBar[]): CanonicalMarketBar | null {
  const last = bars[bars.length - 1];
  return last === undefined ? null : last;
}

/**
 * 回撤深度：`(首板日开盘价 − 观察日最低价) / 首板日开盘价`。
 *
 * - `= 0` ⇒ 最低价恰在首板日开盘价；
 * - `> 0` ⇒ 跌破首板日开盘价（回撤）；
 * - `< 0` ⇒ 高于首板日开盘价（未回撤到该位置）。
 *
 * 这是「守线」的**连续量**版本：`haircutFromEventLow <= drawdownTolerance` 即「守线」。
 * 取「首板日开盘价」为线，与研究侧 `bar.low >= prefix.rd0.open` 守线口径逐字一致。
 */
export function computeHaircutFromEventLow(
  bars: readonly CanonicalMarketBar[],
  baseline: EventBaseline,
): number | null {
  const bar = decisionBarOf(bars);
  if (bar === null || bar.low === null || !Number.isFinite(bar.low)) return null;
  const value = (baseline.open - bar.low) / baseline.open;
  return Number.isFinite(value) ? value : null;
}

/** 量能比：`观察日成交量 / 首板日成交量`。< 1 = 缩量。与研究侧 `obs_{k}d.volume_ratio` 同口径。 */
export function computeVolumeRatio(
  bars: readonly CanonicalMarketBar[],
  baseline: EventBaseline,
): number | null {
  const bar = decisionBarOf(bars);
  if (bar === null || bar.volume === null || !Number.isFinite(bar.volume)) return null;
  const value = bar.volume / baseline.volume;
  return Number.isFinite(value) ? value : null;
}

/**
 * 当日阳线（用户口径「红盘」）：`观察日收盘 > 观察日开盘` 取 1，否则 0。
 *
 * ⚠️ 与研究侧 `pullback_last_is_bullish_{k}d` 同一口径 —— **不是**「收盘相对首板日为正」。
 */
export function computeIsBullish(bars: readonly CanonicalMarketBar[]): number | null {
  const bar = decisionBarOf(bars);
  if (bar === null) return null;
  const { open, close } = bar;
  if (open === null || close === null || !Number.isFinite(open) || !Number.isFinite(close)) return null;
  return close > open + PRICE_EPS ? 1 : 0;
}

/**
 * 收盘相对首板日收盘涨幅：`观察日收盘 / 首板日收盘 − 1`。
 * 与研究侧 `obs_{k}d.return_from_event_close` 同口径（用于「翻红」类条件，与「阳线」区分）。
 */
export function computeCloseReturnFromEventClose(
  bars: readonly CanonicalMarketBar[],
  baseline: EventBaseline,
): number | null {
  const bar = decisionBarOf(bars);
  if (bar === null || bar.close === null || !Number.isFinite(bar.close)) return null;
  const value = bar.close / baseline.close - 1;
  return Number.isFinite(value) ? value : null;
}

/**
 * 持有期涨幅（供排序特征使用；＝决策日收盘 / 首板日收盘 − 1）。
 * 与 `computeCloseReturnFromEventClose` 同式，单独命名以明示「它被用作排序键」的语义。
 */
export function computeMomentum(bars: readonly CanonicalMarketBar[], baseline: EventBaseline): number | null {
  return computeCloseReturnFromEventClose(bars, baseline);
}

/** 价格比较容差（与研究侧 `variables.ts` 的 `PRICE_EPS` 一致，防浮点抖动把平盘判成阳线）。 */
export const PRICE_EPS = 1e-6;
