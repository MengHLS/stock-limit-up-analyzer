/**
 * STEP DATASET-001 / DATABASE_REDESIGN §3.3 — 事件窗口构建（纯函数，无 IO，确定性）。
 *
 * 三层血缘（事件窗口五表分层）：
 *
 *   event(身份)  +  prefix(原始 rd ≤ 0)  +  post(原始 rd ≥ 1)     ← L-事实（依赖行情源）
 *                             │
 *                             │ 依赖事件参考价 eventReferenceFrom(relativeBars)
 *                             ▼
 *                     path(衍生 rd ≥ 1)                          ← L-衍生（可由上层 100% 重算）
 *                             │
 *                             │ 窗口极值聚合（有损：只留极值，丢轨迹）
 *                             ▼
 *                     outcome(按 horizon)                        ← L-聚合（可由 path 100% 重算）
 *
 * 铁律：
 *   - relative_day 必须用交易日历推进（D+1 = 下一交易日，周五 D0 → 下周一 D+1），
 *     禁止自然日 +1；日历推进复用 server/security/tradingCalendar 的 addTradingDays 语义。
 *   - **单源**：事件参考价只从入参 `relativeBars` 提取（其 `relativeDay = 0` 行与 `prefix` 表同源），
 *     禁止从 `DailyBar` 取另外一套（C1）—— 否则 `closeFromEventClose` 的基准可能偏离 `prefix.close`。
 *   - **不伪造**：参考价缺失如实为 `null`，**禁止** `?? 0` 魔数兜底（C2）。
 *   - 反泄漏：`path` / `outcome` 是前视结果，绝不进入 Backtest Signal（边界由调用方强制）。
 *
 * 口径（研究定义，文档化）：
 *   - 所有收益率相对「事件收盘价」eventClose（D0 close）；
 *   - 突破（breakout）参考价 = 事件最高价 eventHigh（前高突破）；某日 high > eventHigh 即突破。
 */

import type {
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "./types";

/** 相对交易日 bar（`relativeDay ∈ [-preWindowDays, +postWindowDays]`）。 */
export interface RelativeBar {
  relativeDay: number;
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  amount: number | null;
}

/**
 * 事件参考价（D0 收盘 / 最高 / 成交量）。
 * 三个字段均可为 `null`（缺 D0 数据是**可表达状态**，不是 0）。
 */
export interface EventReference {
  eventClose: number | null;
  eventHigh: number | null;
  eventVolume: number | null;
}

/**
 * 从相对 bars 提取事件参考价（唯一取数路径，C1）。
 * 无 `relativeDay = 0` 行 → `null`（调用方据此跳过该事件，C3）。
 */
export function eventReferenceFrom(bars: readonly RelativeBar[]): EventReference | null {
  const d0 = bars.find((b) => b.relativeDay === 0);
  if (!d0) return null;
  return { eventClose: d0.close, eventHigh: d0.high, eventVolume: d0.volume };
}

/** 收益率（(numerator − base) / base）；任一缺失或 base=0 → null（不伪造）。 */
function ratioTo(numerator: number | null, base: number | null): number | null {
  if (numerator === null || base === null || base === 0) return null;
  return (numerator - base) / base;
}

/** 极值相对基准的收益率；窗口为空或基准缺失/为 0 → null（不伪造）。 */
function extremeRatioTo(values: number[], base: number | null, pick: (xs: number[]) => number): number | null {
  if (values.length === 0) return null;
  return ratioTo(pick(values), base);
}

/** 量比（volume / eventVolume）；缺失或除零 → null。 */
function volumeRatioTo(volume: number | null, eventVolume: number | null): number | null {
  if (volume === null || eventVolume === null || eventVolume === 0) return null;
  return volume / eventVolume;
}

/**
 * 窗口内首个「突破前高」的 relative_day（≥ 1）；无 → null。
 * `eventHigh` 为 null（缺 D0 行情）时短路返回 null —— 不做任何假设性比较。
 */
export function firstBreakoutRelativeDay(
  bars: readonly RelativeBar[],
  eventHigh: number | null,
): number | null {
  if (eventHigh === null) return null;
  for (const bar of bars) {
    if (bar.relativeDay <= 0) continue;
    if (bar.high !== null && bar.high > eventHigh) return bar.relativeDay;
  }
  return null;
}

// ---------------------------------------------------------------------------
// L-事实：原始行情窗口（prefix / post 同构）
// ---------------------------------------------------------------------------

/** 由相对 bar 构造单条原始行情行（不含任何衍生列）。 */
export function buildRawBar(
  datasetVersionId: number,
  eventId: string,
  symbol: string,
  bar: RelativeBar,
): FirstLimitPullbackRawBar {
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
  };
}

/** 原始行情行集（窗口内全部相对日，未按 prefix/post 切分）。 */
export function buildRawBars(
  datasetVersionId: number,
  eventId: string,
  symbol: string,
  bars: readonly RelativeBar[],
): FirstLimitPullbackRawBar[] {
  return bars.map((bar) => buildRawBar(datasetVersionId, eventId, symbol, bar));
}

/**
 * 按 PIT 边界切分原始行情行：`relativeDay ≤ 0` → `prefix`（后视，特征可用）；
 * `relativeDay ≥ 1` → `post`（前视，仅撮合 / 标签）。
 */
export function partitionRawBars(rows: readonly FirstLimitPullbackRawBar[]): {
  prefix: FirstLimitPullbackRawBar[];
  post: FirstLimitPullbackRawBar[];
} {
  const prefix: FirstLimitPullbackRawBar[] = [];
  const post: FirstLimitPullbackRawBar[] = [];
  for (const row of rows) {
    if (row.relativeDay <= 0) prefix.push(row);
    else post.push(row);
  }
  return { prefix, post };
}

// ---------------------------------------------------------------------------
// L-衍生：相对事件价指标（path，relativeDay ≥ 1）
// ---------------------------------------------------------------------------

/** 由相对 bar + 事件参考价构造单条 path 行（仅衍生量）。 */
export function buildDerivedRow(
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
    highFromEventClose: ratioTo(bar.high, ref.eventClose),
    lowFromEventClose: ratioTo(bar.low, ref.eventClose),
    closeFromEventClose: ratioTo(bar.close, ref.eventClose),
    pullbackFromEventHigh: ratioTo(bar.low, ref.eventHigh),
    volumeRatio: volumeRatioTo(bar.volume, ref.eventVolume),
    isBreakout: ref.eventHigh !== null && bar.high !== null && bar.high > ref.eventHigh,
    breakoutPrice: ref.eventHigh,
    daysToBreakout,
  };
}

/** 由相对 bars + 事件参考价构造完整 path 行集（**只含 `relativeDay ≥ 1`**）。 */
export function buildDerivedRows(
  datasetVersionId: number,
  eventId: string,
  symbol: string,
  bars: readonly RelativeBar[],
  ref: EventReference,
): FirstLimitPullbackPath[] {
  const daysToBreakout = firstBreakoutRelativeDay(bars, ref.eventHigh);
  return bars
    .filter((bar) => bar.relativeDay >= 1)
    .map((bar) => buildDerivedRow(datasetVersionId, eventId, symbol, bar, ref, daysToBreakout));
}

// ---------------------------------------------------------------------------
// L-聚合：outcome（按 horizon）
// ---------------------------------------------------------------------------

/**
 * 由相对 bars + 事件参考价构造单条 outcome 行（horizon H 的未来结果）。
 *
 * 聚合只依赖**原始 OHLC**（MAX(high) / MIN(low) / MIN(close)），因此取数语义等价于读 `post` 表。
 */
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
    maxReturn: extremeRatioTo(highs, ref.eventClose, (xs) => Math.max(...xs)),
    minReturn: extremeRatioTo(lows, ref.eventClose, (xs) => Math.min(...xs)),
    maxDrawdown: extremeRatioTo(closes, ref.eventClose, (xs) => Math.min(...xs)),
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
