/**
 * STEP DATASET-001 — 首板回踩 Dataset：path + outcome 构建（纯函数，无 IO，确定性）。
 *
 * 铁律：
 *   - relative_day 必须用交易日历推进（D+1 = 下一交易日，周五 D0 → 下周一 D+1），
 *     禁止自然日 +1；日历推进复用 server/security/tradingCalendar 的 addTradingDays 语义。
 *   - path 记录「事件之后价格如何演化」的客观事实；outcome 记录「未来结果」。
 *   - 反泄漏：path/outcome 是研究结果，绝不进入 Backtest Signal（边界由调用方强制）。
 *
 * 口径（研究定义，文档化）：
 *   - 所有收益率相对「首板事件收盘价」eventClose（D0 close）；
 *   - 突破（breakout）参考价 = 事件最高价 eventHigh（前高突破）；某日 high > eventHigh 即突破。
 *   - 换手率 / 市值等流动性富集字段可空（数据缺失不伪造）。
 */

import type { FirstLimitPullbackOutcome, FirstLimitPullbackPath } from "./types";

/** 相对交易日 bar（relative_day 0..N）。 */
export interface RelativeBar {
  relativeDay: number;
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  amount: number | null;
  turnover: number | null;
}

/** 事件参考价（D0 收盘 / 最高 / 成交量）。 */
export interface EventReference {
  eventClose: number;
  eventHigh: number;
  eventVolume: number | null;
}

/** 收益率（(numerator − base) / base）；任一缺失或 base=0 → null（不伪造）。 */
function ratioTo(numerator: number | null, base: number | null): number | null {
  if (numerator === null || base === null || base === 0) return null;
  return (numerator - base) / base;
}

/** 量比（volume / eventVolume）；缺失或除零 → null。 */
function volumeRatioTo(volume: number | null, eventVolume: number | null): number | null {
  if (volume === null || eventVolume === null || eventVolume === 0) return null;
  return volume / eventVolume;
}

/** 窗口内首个「突破前高」的 relative_day（>0）；无 → null。 */
export function firstBreakoutRelativeDay(bars: readonly RelativeBar[], eventHigh: number): number | null {
  for (const bar of bars) {
    if (bar.relativeDay <= 0) continue;
    if (bar.high !== null && bar.high > eventHigh) return bar.relativeDay;
  }
  return null;
}

/** 由相对 bar + 事件参考价构造单条 path 行。 */
export function buildPathRow(
  datasetVersionId: number,
  eventId: string,
  symbol: string,
  bar: RelativeBar,
  ref: EventReference,
  daysToBreakout: number | null,
): FirstLimitPullbackPath {
  return {
    datasetVersionId,
    eventId,
    symbol,
    tradeDate: bar.tradeDate,
    relativeDay: bar.relativeDay,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount,
    turnover: bar.turnover,
    returnFromEventClose: ratioTo(bar.close, ref.eventClose),
    highFromEventClose: ratioTo(bar.high, ref.eventClose),
    lowFromEventClose: ratioTo(bar.low, ref.eventClose),
    closeFromEventClose: ratioTo(bar.close, ref.eventClose),
    pullbackFromEventClose: ratioTo(bar.low, ref.eventClose),
    pullbackFromEventHigh: ratioTo(bar.low, ref.eventHigh),
    volumeRatio: volumeRatioTo(bar.volume, ref.eventVolume),
    isBreakout: bar.high !== null && bar.high > ref.eventHigh,
    breakoutPrice: ref.eventHigh,
    daysToBreakout,
  };
}

/** 由相对 bars + 事件参考价构造完整 path 行集（relative_day 0..N）。 */
export function buildPathRows(
  datasetVersionId: number,
  eventId: string,
  symbol: string,
  bars: readonly RelativeBar[],
  ref: EventReference,
): FirstLimitPullbackPath[] {
  const daysToBreakout = firstBreakoutRelativeDay(bars, ref.eventHigh);
  return bars.map((bar) => buildPathRow(datasetVersionId, eventId, symbol, bar, ref, daysToBreakout));
}

/** 由相对 bars + 事件参考价构造单条 outcome 行（horizon H 的未来结果）。 */
export function buildOutcomeRow(
  datasetVersionId: number,
  eventId: string,
  horizon: number,
  bars: readonly RelativeBar[],
  ref: EventReference,
): FirstLimitPullbackOutcome {
  const window = bars.filter((b) => b.relativeDay >= 1 && b.relativeDay <= horizon);
  const highs = window.map((b) => b.high).filter((h): h is number => h !== null);
  const lows = window.map((b) => b.low).filter((l): l is number => l !== null);
  const closes = window.map((b) => b.close).filter((c): c is number => c !== null);
  const daysToBreakout = firstBreakoutRelativeDay(window, ref.eventHigh);
  return {
    datasetVersionId,
    eventId,
    horizon,
    maxReturn: highs.length > 0 ? Math.max(...highs) / ref.eventClose - 1 : null,
    minReturn: lows.length > 0 ? Math.min(...lows) / ref.eventClose - 1 : null,
    maxDrawdown: closes.length > 0 ? Math.min(...closes) / ref.eventClose - 1 : null,
    isBreakout: daysToBreakout !== null,
    daysToBreakout,
  };
}

/** 由相对 bars + 事件参考价构造多 horizon 的 outcome 行集。 */
export function buildOutcomeRows(
  datasetVersionId: number,
  eventId: string,
  horizons: readonly number[],
  bars: readonly RelativeBar[],
  ref: EventReference,
): FirstLimitPullbackOutcome[] {
  return horizons.map((horizon) => buildOutcomeRow(datasetVersionId, eventId, horizon, bars, ref));
}
