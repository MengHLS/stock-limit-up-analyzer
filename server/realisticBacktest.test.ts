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
    expect(result.trades[0]).toMatchObject({ status: "filled", shares: 900, entryPrice: 10.5105, exitPrice: 10.989, netReturn: expect.any(Number), entryPointPremium: 5.11 });
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

  it("同日开盘买入不能使用当日收盘出清所得资金，也不能在原持仓收盘前释放仓位", () => {
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ stockCode: "600001.SH", date: "2026-08-18", nextDayDate: "2026-08-19", secondDayDate: "2026-08-20" }),
      row({ stockCode: "600002.SH", date: "2026-08-19", nextDayDate: "2026-08-20", secondDayDate: "2026-08-21" }),
    ], { initialCapital: 10000, maxPositions: 1 });

    expect(result.trades.find((trade) => trade.stockCode === "600001.SH")).toMatchObject({ status: "filled", exitDate: "2026-08-20" });
    expect(result.trades.find((trade) => trade.stockCode === "600002.SH")).toMatchObject({ status: "skipped", reason: "超过最大持仓数" });
    expect(result).toMatchObject({ peakOpenPositionCount: 1, minimumCash: expect.any(Number) });
  });

  it("首笔全仓买入后即使尚有持仓槽位，也不得用不足一手的剩余资金继续买入", () => {
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ stockCode: "600001.SH", date: "2026-08-18", nextDayDate: "2026-08-19", secondDayDate: "2026-08-21", nextOpenPrice: 9.5 }),
      row({ stockCode: "600002.SH", date: "2026-08-19", nextDayDate: "2026-08-20", secondDayDate: "2026-08-22" }),
    ], { initialCapital: 1000, maxPositions: 2, lotSize: 100 });

    expect(result.trades.find((trade) => trade.stockCode === "600001.SH")).toMatchObject({ status: "filled", shares: 100 });
    expect(result.trades.find((trade) => trade.stockCode === "600002.SH")).toMatchObject({ status: "skipped", reason: "可用资金不足以买入一手" });
    expect(result).toMatchObject({ peakOpenPositionCount: 1, minimumCash: expect.any(Number) });
    expect(result.minimumCash).toBeGreaterThanOrEqual(0);
  });

  it("支持等权、评分加权和固定比例分仓，并保持资金与仓位约束", () => {
    const candidates = [
      row({ stockCode: "600001.SH", score: 90, nextOpenPrice: 10, secondDayClosePrice: 10 }),
      row({ stockCode: "600002.SH", score: 60, nextOpenPrice: 10, secondDayClosePrice: 10 }),
    ];
    const baseOptions = { initialCapital: 20000, maxPositions: 2, lotSize: 100, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0 };
    const equal = simulateRealisticTPlus1ToTPlus2(candidates, { ...baseOptions, positionSizingStrategy: "equal" });
    const weighted = simulateRealisticTPlus1ToTPlus2(candidates, { ...baseOptions, positionSizingStrategy: "scoreWeighted" });
    const fixed = simulateRealisticTPlus1ToTPlus2(candidates, { ...baseOptions, positionSizingStrategy: "fixedPercent", fixedPositionPercent: 25 });

    expect(equal.trades.filter((trade) => trade.status === "filled").map((trade) => trade.shares)).toEqual([1000, 1000]);
    expect(weighted.trades.filter((trade) => trade.status === "filled").map((trade) => trade.shares)).toEqual([1200, 800]);
    expect(fixed.trades.filter((trade) => trade.status === "filled").map((trade) => trade.shares)).toEqual([500, 500]);
    expect(fixed.minimumCash).toBe(10000);
    expect([equal, weighted, fixed].every((result) => result.minimumCash >= 0 && result.peakOpenPositionCount <= 2)).toBe(true);
  });

  it("按保守规则拒绝接近涨停的买入，并记录缺行情原因", () => {
    const blocked = simulateRealisticTPlus1ToTPlus2([row({ nextOpenPrice: 11 })], { initialCapital: 100000, blockLimitUpBuys: true });
    expect(blocked.filledCount).toBe(0);
    expect(blocked.blockedBuyCount).toBe(1);
    expect(blocked.trades[0].reason).toContain("涨停");

    const missing = simulateRealisticTPlus1ToTPlus2([row({ secondDayClosePrice: null })], { initialCapital: 100000 });
    expect(missing.filledCount).toBe(1);
    expect(missing.missingDataCount).toBe(1);
    expect(missing.trades[0].reason).toContain("T+2收盘行情缺失");

    const missingEntryClose = simulateRealisticTPlus1ToTPlus2([row({ nextClosePrice: null })], { initialCapital: 100000 });
    expect(missingEntryClose.trades[0]).toMatchObject({ status: "filled", entryPointPremium: 5.11 });
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

    expect(result.trades[0]).toMatchObject({ status: "filled", entryDate: "2026-08-19", exitDate: null, netPnl: null });
    expect(result.trades[0].reason).toContain("回测结束仍持仓");
    expect(result.openPositionCount).toBe(1);
  });

  it("限制跌停卖出时在后续实际交易日持续尝试出清，而非停止回测", () => {
    const prices = new Map([
      ["600001.SH::2026-08-24", { openPrice: 10.5, closePrice: 10.8 }],
      ["600001.SH::2026-08-25", { openPrice: 9.7, closePrice: 9.7 }],
      ["600001.SH::2026-08-26", { openPrice: 8.7, closePrice: 8.7 }],
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
      ["600001.SH::2026-08-25", { openPrice: 9.7, closePrice: 9.7 }],
    ]);
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ date: "2026-08-21", nextDate: "2026-08-24", nextDayDate: "2026-08-24", secondDayDate: "2026-08-25", secondDayClosePrice: 9.7 }),
    ], { initialCapital: 100000, maxPositions: 1, blockLimitDownSells: true }, prices, ["2026-08-24", "2026-08-25"]);

    expect(result).toMatchObject({ blockedSellCount: 1, completedCount: 0, openPositionCount: 1, missingDataCount: 0 });
    expect(result.trades[0]).toMatchObject({ exitDate: "2026-08-25", netPnl: null });
    expect(result.trades[0].reason).toContain("回测结束仍持仓，按2026-08-25收盘价期末估值");
    expect(result.finalCapital).toBeLessThan(result.initialCapital);
  });

  it("非一字跌停即使收盘接近跌停，严格模式下仍按当日收盘价正常出清", () => {
    const prices = new Map([
      ["600001.SH::2026-08-24", { openPrice: 10.5, closePrice: 10.8 }],
      ["600001.SH::2026-08-25", { openPrice: 9.9, closePrice: 9.7 }],
    ]);
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ date: "2026-08-21", nextDate: "2026-08-24", nextDayDate: "2026-08-24", secondDayDate: "2026-08-25", secondDayClosePrice: 9.7 }),
    ], { initialCapital: 100000, maxPositions: 1, blockLimitDownSells: true }, prices, ["2026-08-24", "2026-08-25"]);

    expect(result).toMatchObject({ blockedSellCount: 0, completedCount: 1, openPositionCount: 0 });
    expect(result.trades[0]).toMatchObject({ exitDate: "2026-08-25", netPnl: expect.any(Number), reason: null });
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

  it("风险管理续持策略仅用当日收盘触发止盈、止损或继续持有", () => {
    const candidate = row({ nextOpenPrice: 10, nextClosePrice: 10.2, secondDayClosePrice: 11 });
    const base = { initialCapital: 100000, maxPositions: 1, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0, exitStrategy: "riskManagedHold" as const };

    const takeProfit = simulateRealisticTPlus1ToTPlus2([candidate], { ...base, takeProfitPercent: 10, stopLossPercent: 5, strongHoldMinReturn: 3, maxHoldingDays: 5 });
    const stopLoss = simulateRealisticTPlus1ToTPlus2([row({ nextOpenPrice: 10, secondDayClosePrice: 9.4 })], { ...base, takeProfitPercent: 10, stopLossPercent: 5, strongHoldMinReturn: 3, maxHoldingDays: 5 });

    expect(takeProfit.trades[0]).toMatchObject({ exitDate: "2026-08-20", reason: expect.stringContaining("触发止盈") });
    expect(stopLoss.trades[0]).toMatchObject({ exitDate: "2026-08-20", reason: expect.stringContaining("触发止损") });
  });

  it("强势续持在T+2只看当日收盘，随后转弱或达到持有上限时出清", () => {
    const candidate = row({ nextOpenPrice: 10, nextClosePrice: 10.2, secondDayClosePrice: 10.5 });
    const prices = new Map([
      ["600001.SH::2026-08-19", { openPrice: 10, closePrice: 10.2 }],
      ["600001.SH::2026-08-20", { openPrice: 10.3, closePrice: 10.5 }],
      ["600001.SH::2026-08-21", { openPrice: 10.5, closePrice: 10.8 }],
      ["600001.SH::2026-08-22", { openPrice: 10.2, closePrice: 10.1 }],
    ]);
    const result = simulateRealisticTPlus1ToTPlus2([candidate], {
      initialCapital: 100000,
      maxPositions: 1,
      commissionRate: 0,
      stampDutyRate: 0,
      transferFeeRate: 0,
      slippageBps: 0,
      exitStrategy: "riskManagedHold",
      takeProfitPercent: 20,
      stopLossPercent: 8,
      strongHoldMinReturn: 3,
      maxHoldingDays: 5,
    }, prices, ["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"]);
    const maxHolding = simulateRealisticTPlus1ToTPlus2([candidate], {
      initialCapital: 100000,
      maxPositions: 1,
      commissionRate: 0,
      stampDutyRate: 0,
      transferFeeRate: 0,
      slippageBps: 0,
      exitStrategy: "riskManagedHold",
      takeProfitPercent: 20,
      stopLossPercent: 8,
      strongHoldMinReturn: 3,
      maxHoldingDays: 3,
    }, prices, ["2026-08-19", "2026-08-20", "2026-08-21"]);

    expect(result.equityCurve.find((point) => point.date === "2026-08-20")?.openPositions).toBe(1);
    expect(result.trades[0]).toMatchObject({ exitDate: "2026-08-22", reason: expect.stringContaining("未满足强势续持") });
    expect(maxHolding.trades[0]).toMatchObject({ exitDate: "2026-08-21", reason: expect.stringContaining("达到最多续持3个交易日") });
  });

  it("风险管理策略在T+2开盘触发止损时按开盘价立即出清", () => {
    const prices = new Map([
      ["600001.SH::2026-08-19", { openPrice: 10, closePrice: 10.2 }],
      ["600001.SH::2026-08-20", { openPrice: 9.4, closePrice: 9.8 }],
    ]);
    const result = simulateRealisticTPlus1ToTPlus2([row({ nextOpenPrice: 10, nextClosePrice: 10.2, secondDayClosePrice: 9.8 })], {
      initialCapital: 100000,
      maxPositions: 1,
      commissionRate: 0,
      stampDutyRate: 0,
      transferFeeRate: 0,
      slippageBps: 0,
      exitStrategy: "riskManagedHold",
      stopLossPercent: 5,
      takeProfitPercent: 10,
    }, prices, ["2026-08-19", "2026-08-20"]);

    expect(result.trades[0]).toMatchObject({ exitDate: "2026-08-20", exitPrice: 9.4, reason: expect.stringContaining("开盘触发止损") });
  });

  it("开盘止损完成后可释放仓位与现金供同日开盘候选使用，但一字跌停仍不强行成交", () => {
    const prices = new Map([
      ["600001.SH::2026-08-19", { openPrice: 10, closePrice: 10.2 }],
      ["600001.SH::2026-08-20", { openPrice: 9.4, closePrice: 9.8 }],
      ["600002.SH::2026-08-20", { openPrice: 10, closePrice: 10.2 }],
      ["600001.SH::2026-08-21", { openPrice: 9, closePrice: 9 }],
    ]);
    const result = simulateRealisticTPlus1ToTPlus2([
      row({ stockCode: "600001.SH", date: "2026-08-18", nextDayDate: "2026-08-19", secondDayDate: "2026-08-20", nextOpenPrice: 10, nextClosePrice: 10.2, secondDayClosePrice: 9.8 }),
      row({ stockCode: "600002.SH", date: "2026-08-19", nextDayDate: "2026-08-20", secondDayDate: "2026-08-21", nextOpenPrice: 10, nextClosePrice: 10.2, secondDayClosePrice: 10.1 }),
    ], { initialCapital: 10000, maxPositions: 1, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0, exitStrategy: "riskManagedHold", stopLossPercent: 5, takeProfitPercent: 10 }, prices, ["2026-08-19", "2026-08-20", "2026-08-21"]);
    const oneWordPrices = new Map([
      ["600001.SH::2026-08-19", { openPrice: 10, closePrice: 10.2 }],
      ["600001.SH::2026-08-20", { openPrice: 9, closePrice: 9 }],
    ]);
    const oneWordLimit = simulateRealisticTPlus1ToTPlus2([
      row({ nextOpenPrice: 10, nextClosePrice: 10.2, secondDayClosePrice: 9 }),
    ], { initialCapital: 100000, maxPositions: 1, exitStrategy: "riskManagedHold", stopLossPercent: 5, blockLimitDownSells: true }, oneWordPrices, ["2026-08-19", "2026-08-20"]);

    expect(result.trades.find((trade) => trade.stockCode === "600001.SH")).toMatchObject({ reason: expect.stringContaining("开盘触发止损") });
    expect(result.trades.find((trade) => trade.stockCode === "600002.SH")).toMatchObject({ status: "filled", entryDate: "2026-08-20" });
    expect(oneWordLimit.trades[0].reason).toContain("开盘触发止损但接近跌停");
  });
});
