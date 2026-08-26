import { describe, expect, it } from "vitest";
import type { LeaderCandidateBacktestRow } from "./leaderCandidates";
import { buildExitStrategyComparison } from "./leaderCandidates";

function row(overrides: Partial<LeaderCandidateBacktestRow> = {}): LeaderCandidateBacktestRow {
  return {
    date: "2026-08-18",
    nextDate: "2026-08-19",
    nextDayDate: "2026-08-19",
    secondDayDate: "2026-08-20",
    stockCode: "600001.SH",
    stockName: "测试股票",
    sector: "题材A",
    boards: 2,
    score: 80,
    circulationValue: "50",
    marketCapScore: 12,
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10,
    nextClosePrice: 10.2,
    nextOpenPremium: 0,
    nextClosePremium: 2,
    secondDayOpenPrice: 10.4,
    secondDayClosePrice: 10.5,
    secondDayOpenPremium: 4,
    secondDayClosePremium: 5,
    tPlus1CloseToTPlus2CloseReturn: 2.94,
    tPlus1CloseToTPlus2CloseSuccess: true,
    phase: "修复上升",
    maxBoards: 3,
    ...overrides,
  };
}

describe("buildExitStrategyComparison", () => {
  it("在相同候选、入场、成本、仓位和交易日下仅比较退出规则", () => {
    const prices = new Map([
      ["600001.SH::2026-08-19", { openPrice: 10, closePrice: 10.2 }],
      ["600001.SH::2026-08-20", { openPrice: 10.4, closePrice: 10.5 }],
      ["600001.SH::2026-08-21", { openPrice: 10.3, closePrice: 10.2 }],
    ]);
    const comparison = buildExitStrategyComparison([row()], {
      initialCapital: 100000,
      maxPositions: 1,
      commissionRate: 0,
      stampDutyRate: 0,
      transferFeeRate: 0,
      slippageBps: 0,
      trailingProfitActivationPercent: 6,
      trailingDrawdownPercent: 3,
      stopLossPercent: 8,
      strongHoldMinReturn: 3,
      maxHoldingDays: 5,
    }, { priceByStockDate: prices, tradingDates: ["2026-08-19", "2026-08-20", "2026-08-21"] });

    expect(comparison.map((item) => item.exitStrategy)).toEqual(["t2Close", "trailingHold", "riskManagedHold"]);
    expect(comparison.every((item) => item.realisticSimulation.assumptions.initialCapital === 100000 && item.realisticSimulation.totalCandidateCount === 1)).toBe(true);
    expect(comparison.find((item) => item.exitStrategy === "t2Close")?.realisticSimulation.trades[0]).toMatchObject({ exitDate: "2026-08-20" });
    expect(comparison.find((item) => item.exitStrategy === "riskManagedHold")?.realisticSimulation.trades[0]).toMatchObject({ exitDate: "2026-08-21", reason: expect.stringContaining("未满足强势续持") });
    expect(comparison.find((item) => item.exitStrategy === "trailingHold")?.realisticSimulation).toMatchObject({ openPositionCount: 1 });
  });
});
