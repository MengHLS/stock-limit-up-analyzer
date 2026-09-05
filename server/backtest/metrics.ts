/**
 * STEP 8 — Metrics Layer：绩效指标。
 *
 * 所有绩效指标统一从 equityCurve 与 trades 计算，绝不内联到策略/引擎。
 * 所有统计数学原语统一来自 shared/quant-stats（mean / sampleStdDev / Sharpe / CAGR），
 * 禁止重新实现。口径与既有生产 Performance Analytics 一致：
 *   Sharpe = mean(dailyReturn) / sampleStdDev(dailyReturn) · √annualizationFactor；
 *   CAGR   = (endEquity / startEquity)^(annualizationFactor / n) − 1。
 */

import {
  annualizedReturnFromEquityCurve,
  mean,
  sampleStandardDeviation,
  sharpeRatio,
} from "../../shared/quant-stats";
import type { EquityPoint, Metrics, Trade } from "./types";

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

/** 从权益曲线提取日收益率序列（跳过首点）。 */
export function dailyReturnsFromEquity(equityCurve: EquityPoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = equityCurve[i - 1]!.equity;
    const curr = equityCurve[i]!.equity;
    if (prev > 0) returns.push(curr / prev - 1);
  }
  return returns;
}

/** 从权益序列计算最大回撤（比例）。 */
export function maxDrawdownFromEquity(equities: number[]): number {
  let peak = equities[0] ?? 0;
  let maxDrawdown = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }
  return maxDrawdown;
}

/** 已平仓且实现盈亏的交易。 */
export function completedTrades(trades: Trade[]): Trade[] {
  return trades.filter((trade) => !trade.openAtEnd && trade.netPnl !== null);
}

export interface MetricsInput {
  equityCurve: EquityPoint[];
  trades: Trade[];
  initialCapital: number;
  annualizationFactor?: number;
}

/** 统一计算全部绩效指标（纯函数、确定性、无副作用）。 */
export function computeMetrics(input: MetricsInput): Metrics {
  const { equityCurve, trades, initialCapital, annualizationFactor = 252 } = input;

  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1]!.equity : initialCapital;
  const totalReturnPct = initialCapital > 0 ? ((finalEquity - initialCapital) / initialCapital) * 100 : 0;

  const dailyReturns = dailyReturnsFromEquity(equityCurve);
  const n = dailyReturns.length;
  const annualizedReturnPct = n === 0
    ? null
    : (annualizedReturnFromEquityCurve(initialCapital, finalEquity, n, annualizationFactor) ?? 0) * 100;
  const dailyVol = sampleStandardDeviation(dailyReturns);
  const annualizedVolatilityPct = dailyVol === null ? null : dailyVol * Math.sqrt(annualizationFactor) * 100;
  const sharpe = sharpeRatio(dailyReturns, annualizationFactor);

  const equities = equityCurve.map((point) => point.equity);
  const maxDrawdownPct = maxDrawdownFromEquity(equities) * 100;

  const closed = completedTrades(trades);
  const pnlValues = closed.map((trade) => trade.netPnl!);
  const grossProfit = pnlValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(pnlValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const winning = pnlValues.filter((value) => value > 0);
  const losing = pnlValues.filter((value) => value < 0);

  return {
    totalReturnPct: round(totalReturnPct),
    annualizedReturnPct: annualizedReturnPct === null ? null : round(annualizedReturnPct),
    annualizedVolatilityPct: annualizedVolatilityPct === null ? null : round(annualizedVolatilityPct),
    sharpeRatio: sharpe === null ? null : round(sharpe, 4),
    maxDrawdownPct: round(maxDrawdownPct),
    tradeCount: trades.length,
    completedTradeCount: closed.length,
    winRatePct: closed.length === 0 ? null : round((winning.length / closed.length) * 100),
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : round(grossProfit / grossLoss, 4),
    averageWin: winning.length === 0 ? null : round(mean(winning) ?? 0),
    averageLoss: losing.length === 0 ? null : round(mean(losing) ?? 0),
    expectancy: closed.length === 0 ? null : round(mean(pnlValues) ?? 0),
    openPositionCount: trades.filter((trade) => trade.openAtEnd).length,
  };
}
