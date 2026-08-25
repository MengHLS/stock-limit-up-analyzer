import { describe, expect, it } from "vitest";
import type { LeaderCandidateBacktestRow } from "./leaderCandidates";
import { simulateRealisticTPlus1ToTPlus2 } from "./realisticBacktest";

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
    nextOpenPrice: 10.5,
    nextClosePrice: 10.8,
    nextOpenPremium: 5,
    nextClosePremium: 8,
    secondDayOpenPrice: 10.9,
    secondDayClosePrice: 11,
    secondDayOpenPremium: 9,
    secondDayClosePremium: 10,
    tPlus1CloseToTPlus2CloseReturn: 1.85,
    tPlus1CloseToTPlus2CloseSuccess: true,
    phase: "修复上升",
    maxBoards: 3,
    ...overrides,
  };
}

describe("simulateRealisticTPlus1ToTPlus2", () => {
  it("按整手、滑点和买卖费用计算净收益，并生成资金曲线", () => {
    const result = simulateRealisticTPlus1ToTPlus2([row()], {
      initialCapital: 10000,
      maxPositions: 1,
      commissionRate: 0.0003,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      slippageBps: 10,
      lotSize: 100,
      blockLimitUpBuys: false,
      blockLimitDownSells: false,
    });

    expect(result.filledCount).toBe(1);
    expect(result.trades[0]).toMatchObject({ status: "filled", shares: 900, entryPrice: 10.5105, exitPrice: 10.989 });
    expect(result.trades[0].netPnl).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBe(2);
    expect(result.finalCapital).toBeGreaterThan(result.initialCapital);
  });

  it("同日超过最大持仓数时按评分优先，其余记录为跳过", () => {
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ stockCode: "600001.SH", score: 90 }),
      row({ stockCode: "600002.SH", score: 80 }),
    ], { initialCapital: 100000, maxPositions: 1, blockLimitUpBuys: false, blockLimitDownSells: false });

    expect(result.filledCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.trades.find((trade) => trade.stockCode === "600002.SH")?.reason).toBe("资金按评分排序优先分配");
  });

  it("按保守规则拒绝接近涨停的买入，并记录缺行情原因", () => {
    const blocked = simulateRealisticTPlus1ToTPlus2([row({ nextOpenPrice: 11 })], { initialCapital: 100000 });
    expect(blocked.filledCount).toBe(0);
    expect(blocked.blockedBuyCount).toBe(1);
    expect(blocked.trades[0].reason).toContain("涨停");

    const missing = simulateRealisticTPlus1ToTPlus2([row({ secondDayClosePrice: null })], { initialCapital: 100000 });
    expect(missing.filledCount).toBe(0);
    expect(missing.missingDataCount).toBe(1);
    expect(missing.trades[0].reason).toContain("缺少");
  });
});
