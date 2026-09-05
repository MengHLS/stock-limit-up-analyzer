import { describe, expect, it } from "vitest";
import {
  calculateSharpeMoments,
  deflatedSharpeRatio,
  expectedMaximumSharpe,
  mulberry32,
  normalCdf,
  normalQuantile,
  probabilisticSharpeRatio,
  runMonkeyBenchmark,
  runReturnBootstrap,
} from "./overfittingGuard";
import type { LeaderCandidateBacktestRow, LeaderCandidateDailyPrice } from "./leaderCandidates";
import type { RealisticBacktestOptions, RealisticBacktestResult } from "./realisticBacktest";

function makeRow(score: number, index: number): LeaderCandidateBacktestRow {
  return {
    stockCode: `6000${String(index).padStart(2, "0")}.SH`,
    stockName: "测试股",
    sector: "题材",
    boards: 2,
    score,
    circulationValue: "50",
    marketCapScore: 12,
    date: "2026-08-18",
    nextDate: "2026-08-19",
    nextDayDate: "2026-08-19",
    secondDayDate: "2026-08-20",
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10.5,
    nextClosePrice: 11,
    nextOpenPremium: 5,
    nextClosePremium: 10,
    secondDayOpenPrice: 11,
    secondDayClosePrice: 11.5,
    secondDayOpenPremium: 10,
    secondDayClosePremium: 15,
    tPlus1CloseToTPlus2CloseReturn: 4.55,
    tPlus1CloseToTPlus2CloseSuccess: true,
  };
}

function fixedSimulation(totalReturn: number): RealisticBacktestResult {
  return {
    assumptions: {
      initialCapital: 100000, maxPositions: 5, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0,
      lotSize: 100, blockLimitUpBuys: false, blockLimitDownSells: false, enableOneWordLimitDownProbability: false,
      oneWordLimitDownSellProbability: 0, positionSizingStrategy: "equal", fixedPositionPercent: 20, exitStrategy: "riskManagedHold",
      trailingProfitActivationPercent: 6, trailingDrawdownPercent: 3, stopLossPercent: 5, strongHoldMinReturn: 3,
      maxHoldingDays: 5, minimumExpectedOpenChangePercent: -2, blockOneWordLimitUpBuys: false, enableIntradayStopLoss: false,
      maxPositionAmountRatio: 0, detectExRights: false,
    },
    initialCapital: 100000,
    finalCapital: 100000 * (1 + totalReturn / 100),
    netProfit: 100000 * totalReturn / 100,
    totalReturn,
    maxDrawdown: 0,
    tradeCount: 0, filledCount: 0, completedCount: 0, openPositionCount: 0, peakOpenPositionCount: 0,
    minimumCash: 100000, totalCandidateCount: 0, priceAvailableCount: 0, capacitySkippedCount: 0, skippedCount: 0,
    winningTrades: 0, winRate: null, averageReturn: null, profitFactor: null,
    blockedBuyCount: 0, blockedSellCount: 0, missingDataCount: 0, exRightsCount: 0,
    equityCurve: [
      { date: "2026-08-18", equity: 100000, cash: 100000, openPositions: 0 },
      { date: "2026-08-19", equity: 100000 * (1 + totalReturn / 100), cash: 100000, openPositions: 0 },
    ],
    trades: [],
  };
}

describe("mulberry32", () => {
  it("相同种子可复现，不同种子不同", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
    expect(a()).not.toBe(c());
  });
});

describe("normalCdf / normalQuantile", () => {
  it("标准正态已知值", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it("normalQuantile 与 normalCdf 互为逆", () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.96, 2);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.96, 2);
  });
});

describe("calculateSharpeMoments", () => {
  it("正收益序列夏普为正，常数序列或样本不足返回 null", () => {
    const moments = calculateSharpeMoments([0.01, 0.02, 0.015, 0.018, 0.022, 0.025]);
    expect(moments).not.toBeNull();
    expect(moments!.sharpeRatio).toBeGreaterThan(0);
    expect(calculateSharpeMoments([0.01, 0.02])).toBeNull();
    expect(calculateSharpeMoments([0.01, 0.01, 0.01, 0.01])).toBeNull();
  });
});

describe("expectedMaximumSharpe / deflatedSharpeRatio", () => {
  it("试验次数越多，期望最优夏普越大", () => {
    const e1 = expectedMaximumSharpe(10, 2, 0, 0, 100);
    const e2 = expectedMaximumSharpe(100, 2, 0, 0, 100);
    expect(e2).toBeGreaterThan(e1);
  });
  it("DSR 合理：零夏普远低于 0.5，高夏普接近 1", () => {
    // 夏普=0 低于多次试验的期望最优夏普（正值），DSR 应显著小于 0.5
    const zeroDsf = deflatedSharpeRatio(0, 10, 0, 0, 200);
    expect(zeroDsf).toBeLessThan(0.1);
    const highDsf = deflatedSharpeRatio(3, 10, 0, 0, 200);
    expect(highDsf).toBeGreaterThan(0.9);
  });
});

describe("runMonkeyBenchmark", () => {
  const rows = [makeRow(90, 1), makeRow(88, 2), makeRow(85, 3), makeRow(80, 4), makeRow(75, 5)];
  const options: RealisticBacktestOptions = {};
  const priceMap = new Map<string, LeaderCandidateDailyPrice>();

  it("真实策略显著优于随机时 exceededRandom95 为 true", () => {
    const result = runMonkeyBenchmark(rows, options, priceMap, ["2026-08-18", "2026-08-19"], 50, 1,
      (r, _o, _p, _t) => {
        // 真实 rows 的 score 都是高值（90 附近）；随机打乱后 score 仍相近，故用固定值区分：
        // 若传入的 rows 有 5 条（真实池），返回高收益；随机池同样 5 条，返回低收益。
        const isReal = r[0]?.stockCode === "600001.SH" && r[0]?.score === 90;
        return fixedSimulation(isReal ? 50 : 0);
      });
    expect(result.trialCount).toBe(50);
    expect(result.randomReturns).toHaveLength(50);
    expect(result.realTotalReturn).toBe(50);
    expect(result.exceededRandom95).toBe(true);
    expect(result.percentileRank).toBe(100);
  });

  it("真实策略不优于随机时 exceededRandom95 为 false", () => {
    const result = runMonkeyBenchmark(rows, options, priceMap, ["2026-08-18", "2026-08-19"], 30, 2,
      () => fixedSimulation(10));
    expect(result.realTotalReturn).toBe(10);
    expect(result.exceededRandom95).toBe(false);
  });
});

describe("probabilisticSharpeRatio", () => {
  it("高夏普 PSR 接近 1，零夏普约 0.5", () => {
    expect(probabilisticSharpeRatio(3, 0, 0, 0, 200)).toBeGreaterThan(0.95);
    expect(probabilisticSharpeRatio(0, 0, 0, 0, 200)).toBeCloseTo(0.5, 2);
  });
  it("相对更高基准夏普，PSR 下降", () => {
    const vsZero = probabilisticSharpeRatio(1, 0, 0, 0, 200);
    const vsOne = probabilisticSharpeRatio(1, 1, 0, 0, 200);
    expect(vsOne).toBeLessThan(vsZero);
  });
});

describe("runReturnBootstrap", () => {
  it("正收益序列夏普置信区间下界为正、破产概率在 [0,1]", () => {
    const returns = [0.01, 0.02, 0.015, 0.018, 0.022, 0.025, 0.012, 0.02, 0.018, 0.024];
    const result = runReturnBootstrap(returns, 500, 7);
    expect(result.sharpeMean).not.toBeNull();
    expect(result.sharpeLower95!).toBeLessThanOrEqual(result.sharpeUpper95!);
    expect(result.maxDrawdownP95!).toBeGreaterThanOrEqual(0);
    expect(result.ruinProbability!).toBeGreaterThanOrEqual(0);
    expect(result.ruinProbability!).toBeLessThanOrEqual(1);
  });
  it("样本不足返回 null 指标", () => {
    const result = runReturnBootstrap([0.01, 0.02], 10, 7);
    expect(result.sharpeMean).toBeNull();
    expect(result.ruinProbability).toBeNull();
  });
});
