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
    expect(result.totalCandidateCount).toBe(2);
    expect(result.priceAvailableCount).toBe(2);
    expect(result.capacitySkippedCount).toBe(1);
    expect(result.trades.find((trade) => trade.stockCode === "600002.SH")?.reason).toBe("资金按评分排序优先分配");
  });

  it("按保守规则拒绝接近涨停的买入，并记录缺行情原因", () => {
    const blocked = simulateRealisticTPlus1ToTPlus2([row({ nextOpenPrice: 11 })], { initialCapital: 100000, blockLimitUpBuys: true });
    expect(blocked.filledCount).toBe(0);
    expect(blocked.blockedBuyCount).toBe(1);
    expect(blocked.trades[0].reason).toContain("涨停");

    const missing = simulateRealisticTPlus1ToTPlus2([row({ secondDayClosePrice: null })], { initialCapital: 100000 });
    expect(missing.filledCount).toBe(0);
    expect(missing.missingDataCount).toBe(1);
    expect(missing.trades[0].reason).toBe("T+2实际交易日无可用收盘价");
  });

  it("按实际交易日而非自然日跨周末与节假日出清", () => {
    const acrossWeekend = simulateRealisticTPlus1ToTPlus2([
      row({ date: "2026-08-21", nextDate: "2026-08-24", nextDayDate: "2026-08-24", secondDayDate: "2026-08-25" }),
    ], { initialCapital: 100000, maxPositions: 1 });
    const acrossHoliday = simulateRealisticTPlus1ToTPlus2([
      row({ stockCode: "600002.SH", date: "2026-10-01", nextDate: "2026-10-09", nextDayDate: "2026-10-09", secondDayDate: "2026-10-12" }),
    ], { initialCapital: 100000, maxPositions: 1 });

    expect(acrossWeekend.trades[0]).toMatchObject({ entryDate: "2026-08-24", exitDate: "2026-08-25", netPnl: expect.any(Number), reason: null });
    expect(acrossWeekend.equityCurve.map((point) => point.date)).toEqual(["2026-08-24", "2026-08-25"]);
    expect(acrossHoliday.trades[0]).toMatchObject({ entryDate: "2026-10-09", exitDate: "2026-10-12", netPnl: expect.any(Number), reason: null });
    expect(acrossHoliday.equityCurve.map((point) => point.date)).toEqual(["2026-10-09", "2026-10-12"]);
  });

  it("对数据末端尚无 T+2 交易日给出精确提示，不归因于周末", () => {
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ secondDayDate: null, secondDayClosePrice: null }),
    ], { initialCapital: 100000 });

    expect(result.trades[0]).toMatchObject({ status: "skipped", exitDate: null, reason: "未到T+2实际交易日" });
    expect(result.openPositionCount).toBe(0);
  });

  it("限制跌停卖出时在后续实际交易日持续尝试出清，而非停止回测", () => {
    const prices = new Map([
      ["600001.SH::2026-08-24", { openPrice: 10.5, closePrice: 10.8 }],
      ["600001.SH::2026-08-25", { openPrice: 9.8, closePrice: 9.7 }],
      ["600001.SH::2026-08-26", { openPrice: 8.8, closePrice: 8.7 }],
      ["600001.SH::2026-08-27", { openPrice: 8.8, closePrice: 8.9 }],
    ]);
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ date: "2026-08-21", nextDate: "2026-08-24", nextDayDate: "2026-08-24", secondDayDate: "2026-08-25", secondDayClosePrice: 9.7 }),
    ], { initialCapital: 100000, maxPositions: 1, blockLimitDownSells: true }, prices, ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"]);

    expect(result).toMatchObject({ blockedSellCount: 2, completedCount: 1, openPositionCount: 0 });
    expect(result.trades[0]).toMatchObject({ exitDate: "2026-08-27", netPnl: expect.any(Number), reason: "跌停后延期至实际交易日出清" });
    expect(result.equityCurve.map((point) => point.date)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"]);
  });

  it("回测末端仍无法卖出时，以最后实际交易日收盘价估值并保留持仓", () => {
    const prices = new Map([
      ["600001.SH::2026-08-24", { openPrice: 10.5, closePrice: 10.8 }],
      ["600001.SH::2026-08-25", { openPrice: 9.8, closePrice: 9.7 }],
    ]);
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ date: "2026-08-21", nextDate: "2026-08-24", nextDayDate: "2026-08-24", secondDayDate: "2026-08-25", secondDayClosePrice: 9.7 }),
    ], { initialCapital: 100000, maxPositions: 1, blockLimitDownSells: true }, prices, ["2026-08-24", "2026-08-25"]);

    expect(result).toMatchObject({ blockedSellCount: 1, completedCount: 0, openPositionCount: 1, missingDataCount: 0 });
    expect(result.trades[0]).toMatchObject({ exitDate: "2026-08-25", netPnl: null });
    expect(result.trades[0].reason).toContain("回测结束仍持仓，按2026-08-25收盘价期末估值");
    expect(result.finalCapital).toBeLessThan(result.initialCapital);
  });

  it("一字跌停保守成交概率支持 0%、可复现的中间概率与 100% 三种情景", () => {
    const prices = new Map([
      ["600001.SH::2026-08-24", { openPrice: 10.5, closePrice: 10.8 }],
      ["600001.SH::2026-08-25", { openPrice: 9.7, closePrice: 9.7 }],
    ]);
    const candidate = row({ date: "2026-08-21", nextDate: "2026-08-24", nextDayDate: "2026-08-24", secondDayDate: "2026-08-25", secondDayClosePrice: 9.7 });
    const baseOptions = { initialCapital: 100000, maxPositions: 1, blockLimitDownSells: true, enableOneWordLimitDownProbability: true };
    const dates = ["2026-08-24", "2026-08-25"];

    const zeroProbability = simulateRealisticTPlus1ToTPlus2([candidate], { ...baseOptions, oneWordLimitDownSellProbability: 0 }, prices, dates);
    const midpointFirst = simulateRealisticTPlus1ToTPlus2([candidate], { ...baseOptions, oneWordLimitDownSellProbability: 50 }, prices, dates);
    const midpointSecond = simulateRealisticTPlus1ToTPlus2([candidate], { ...baseOptions, oneWordLimitDownSellProbability: 50 }, prices, dates);
    const fullProbability = simulateRealisticTPlus1ToTPlus2([candidate], { ...baseOptions, oneWordLimitDownSellProbability: 100 }, prices, dates);

    expect(zeroProbability).toMatchObject({ blockedSellCount: 1, completedCount: 0, openPositionCount: 1 });
    expect(zeroProbability.trades[0].reason).toContain("概率0%未命中");
    expect(midpointFirst.trades[0]).toEqual(midpointSecond.trades[0]);
    expect(midpointFirst.assumptions.oneWordLimitDownSellProbability).toBe(50);
    expect(fullProbability).toMatchObject({ blockedSellCount: 0, completedCount: 1, openPositionCount: 0 });
    expect(fullProbability.trades[0].reason).toContain("概率100%命中");
  });
});
