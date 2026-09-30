/**
 * BREADTH-001 — 回测「覆盖广度 / 重复买入 / 连续链」诊断指标的**唯一计算实现**
 * （纯函数，无 IO，确定性）。
 *
 * 定位：回答「这轮回测到底做了多少只不同的股票、多少笔是重复买回、
 * 同一个代码的连续买回链有多长」——此前只能事后手算，不进留档。
 *
 * 纪律：
 *   1. **只搬运事实**：全部输入取自真实成交明细与权益曲线，不做任何估算；
 *   2. **截断即 null**：成交明细被截断（`tradesTruncated=true`）时派生指标整体为 null，
 *      绝不按截断样本低报（那会把"看不全"伪装成"重复少"）；
 *   3. **交易日口径**：再入场间隔一律用权益曲线的日期序列（= 运行交易日历）计数，
 *      不是日历日 —— 否则周五出场、周一买回会被算成 3 天。
 */

import { panelCodeOf } from "../research/panelIdentity";

export interface BreadthTradeFact {
  readonly securityId: string;
  readonly entryTime: string;
  readonly exitTime: string | null;
}

export interface BreadthMetrics {
  /** 成交覆盖的底层个股数（按代码去重；解析不到代码时按身份计）。 */
  readonly tradedInstrumentCount: number | null;
  /** 成交覆盖的池身份数（按 securityId 去重）。 */
  readonly tradedIdentityCount: number | null;
  /** 重复交易笔数 = 同一代码第 2 笔及以后的成交。 */
  readonly repeatTradeCount: number | null;
  /** 重复交易占比（%，= repeatTradeCount / tradeCount × 100）。 */
  readonly repeatTradeRatioPct: number | null;
  /** 单票最大成交次数。 */
  readonly maxTradesPerInstrument: number | null;
  /** 同代码并行持仓对数（两笔持仓区间有交集）。 */
  readonly sameCodeOverlapPairCount: number | null;
  /** 同代码连续买回链的最长笔数（相邻两笔间隔 ≤1 交易日为同链）。 */
  readonly longestReentryChainLength: number | null;
  /** 链内成交占比（%，链长 ≥3 的笔数 / 总笔数）。 */
  readonly chainTradeRatioPct: number | null;
  /** 立即买回次数（同代码相邻两笔间隔 ≤1 交易日）。 */
  readonly immediateReentryCount: number | null;
  /** 再入场间隔中位数（交易日）。 */
  readonly medianReentryGapTradingDays: number | null;
  /** 再入场间隔最大值（交易日）。 */
  readonly maxReentryGapTradingDays: number | null;
}

export const EMPTY_BREADTH_METRICS: BreadthMetrics = {
  tradedInstrumentCount: null,
  tradedIdentityCount: null,
  repeatTradeCount: null,
  repeatTradeRatioPct: null,
  maxTradesPerInstrument: null,
  sameCodeOverlapPairCount: null,
  longestReentryChainLength: null,
  chainTradeRatioPct: null,
  immediateReentryCount: null,
  medianReentryGapTradingDays: null,
  maxReentryGapTradingDays: null,
};

export interface ComputeBreadthMetricsInput {
  readonly trades: readonly BreadthTradeFact[];
  /** 权益曲线日期（升序）—— 交易日历的权威来源。 */
  readonly tradingDates: readonly string[];
  /** 成交明细是否被截断；true 时派生指标一律 null。 */
  readonly tradesTruncated: boolean;
}

const CHAIN_GAP_TRADING_DAYS = 1;
const CHAIN_MIN_LENGTH = 3;

function median(sortedValues: readonly number[]): number | null {
  if (sortedValues.length === 0) return null;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1]! + sortedValues[middle]!) / 2
    : sortedValues[middle]!;
}

/** 计算广度 / 重复 / 链指标。输入为空成交 ⇒ 全 null（没有可陈述的事实）。 */
export function computeBreadthMetrics(input: ComputeBreadthMetricsInput): BreadthMetrics {
  if (input.tradesTruncated) return EMPTY_BREADTH_METRICS;
  if (input.trades.length === 0) return EMPTY_BREADTH_METRICS;

  const dayIndex = new Map<string, number>();
  for (let index = 0; index < input.tradingDates.length; index += 1) {
    const date = input.tradingDates[index]!;
    if (!dayIndex.has(date)) dayIndex.set(date, index);
  }

  const byCode = new Map<string, BreadthTradeFact[]>();
  for (const trade of input.trades) {
    const code = panelCodeOf(trade.securityId);
    const bucket = byCode.get(code);
    if (bucket === undefined) byCode.set(code, [trade]);
    else bucket.push(trade);
  }

  const tradeCount = input.trades.length;
  const tradedInstrumentCount = byCode.size;
  const tradedIdentityCount = new Set(input.trades.map(trade => trade.securityId)).size;
  const repeatTradeCount = tradeCount - tradedInstrumentCount;
  let maxTradesPerInstrument = 0;
  let sameCodeOverlapPairCount = 0;
  let longestReentryChainLength = 0;
  let chainTradeCount = 0;
  let immediateReentryCount = 0;
  const gaps: number[] = [];

  for (const trades of byCode.values()) {
    maxTradesPerInstrument = Math.max(maxTradesPerInstrument, trades.length);
    const sorted = [...trades].sort((left, right) =>
      left.entryTime < right.entryTime ? -1 : left.entryTime > right.entryTime ? 1 : 0,
    );

    // 并行持仓对（按入场顺序，前一笔尚未出场即算重叠）。
    for (let i = 0; i < sorted.length; i += 1) {
      const exitIndex = sorted[i]!.exitTime === null ? null : dayIndex.get(sorted[i]!.exitTime!);
      if (exitIndex === null || exitIndex === undefined) continue;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const entryIndex = dayIndex.get(sorted[j]!.entryTime);
        if (entryIndex === undefined || entryIndex > exitIndex) break;
        sameCodeOverlapPairCount += 1;
      }
    }

    // 连续买回链 + 间隔。
    let chainLength = 1;
    for (let i = 1; i < sorted.length; i += 1) {
      const previousExit = sorted[i - 1]!.exitTime;
      const exitIndex = previousExit === null ? undefined : dayIndex.get(previousExit);
      const entryIndex = dayIndex.get(sorted[i]!.entryTime);
      if (exitIndex === undefined || entryIndex === undefined) {
        chainLength = 1;
        continue;
      }
      const gap = entryIndex - exitIndex;
      // 链口径 = 相邻两笔间隔 ≤1 交易日（含并行持仓的负间隔：连续在场也算同一条链）。
      chainLength = gap <= CHAIN_GAP_TRADING_DAYS ? chainLength + 1 : 1;
      if (chainLength === CHAIN_MIN_LENGTH) chainTradeCount += CHAIN_MIN_LENGTH;
      else if (chainLength > CHAIN_MIN_LENGTH) chainTradeCount += 1;
      if (gap >= 0) {
        gaps.push(gap);
        if (gap <= CHAIN_GAP_TRADING_DAYS) immediateReentryCount += 1;
      }
      longestReentryChainLength = Math.max(longestReentryChainLength, chainLength);
    }
    longestReentryChainLength = Math.max(longestReentryChainLength, chainLength);
  }

  const sortedGaps = [...gaps].sort((left, right) => left - right);
  return {
    tradedInstrumentCount,
    tradedIdentityCount,
    repeatTradeCount,
    repeatTradeRatioPct: tradeCount === 0 ? null : (repeatTradeCount / tradeCount) * 100,
    maxTradesPerInstrument,
    sameCodeOverlapPairCount,
    longestReentryChainLength,
    chainTradeRatioPct: tradeCount === 0 ? null : (chainTradeCount / tradeCount) * 100,
    immediateReentryCount,
    medianReentryGapTradingDays: median(sortedGaps),
    maxReentryGapTradingDays: sortedGaps.length === 0 ? null : sortedGaps[sortedGaps.length - 1]!,
  };
}
