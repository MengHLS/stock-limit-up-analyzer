import { describe, expect, it } from "vitest";
import { buildDownsideRiskResearch } from "./downsideRisk";
import type { LeaderCandidateBacktestRow } from "./leaderCandidates";

function row(overrides: Partial<LeaderCandidateBacktestRow>): LeaderCandidateBacktestRow {
  return {
    date: "2026-08-18",
    nextDate: "2026-08-19",
    nextDayDate: "2026-08-19",
    secondDayDate: "2026-08-20",
    stockCode: "600001.SH",
    stockName: "测试股",
    sector: "题材A",
    boards: 2,
    sectorCount: 4,
    score: 80,
    limitUpTime: "09:40:00",
    turnover: "20",
    circulationValue: "100",
    marketCapScore: 16,
    success: false,
    signalClosePrice: 10,
    nextOpenPrice: 10,
    nextClosePrice: 10,
    nextOpenPremium: 0,
    nextClosePremium: 0,
    secondDayOpenPrice: 10,
    secondDayClosePrice: 10,
    secondDayOpenPremium: 0,
    secondDayClosePremium: 0,
    tPlus1CloseToTPlus2CloseReturn: 0,
    tPlus1CloseToTPlus2CloseSuccess: false,
    phase: "修复上升",
    maxBoards: 3,
    ...overrides,
  };
}

describe("buildDownsideRiskResearch", () => {
  it("只以信号日特征计分，并优先用买入后完整实际交易日最低价路径生成下行标签和可比实验", () => {
    const highRisk = row({
      stockCode: "600001.SH", stockName: "高风险", boards: 4, sectorCount: 1, score: 45, limitUpTime: "14:40:00", turnover: "1", marketCapScore: 4, phase: "高位退潮", maxBoards: 6,
    });
    const lowRisk = row({ stockCode: "600002.SH", stockName: "低风险" });
    const prices = new Map([
      ["600001.SH::2026-08-18", { openPrice: 10, closePrice: 10, lowPrice: 9.8, amount: 5000 }],
      ["600001.SH::2026-08-19", { openPrice: 10, closePrice: 9, lowPrice: 8.5, amount: 5000 }],
      ["600001.SH::2026-08-20", { openPrice: 8.5, closePrice: 8, lowPrice: 7, amount: 5000 }],
      ["600002.SH::2026-08-18", { openPrice: 10, closePrice: 10, lowPrice: 9.9, amount: 90000 }],
      ["600002.SH::2026-08-19", { openPrice: 10, closePrice: 10.5, lowPrice: 10.2, amount: 90000 }],
      ["600002.SH::2026-08-20", { openPrice: 10.4, closePrice: 10.4, lowPrice: 10.1, amount: 90000 }],
    ]);
    const result = buildDownsideRiskResearch([highRisk, lowRisk], {
      observationDays: 2,
      mediumDownsidePercent: 4,
      highDownsidePercent: 8,
      penaltyWeight: 0.5,
      hardRiskThreshold: 65,
    }, {
      initialCapital: 100000,
      maxPositions: 2,
      commissionRate: 0,
      stampDutyRate: 0,
      transferFeeRate: 0,
      slippageBps: 0,
    }, { priceByStockDate: prices, tradingDates: ["2026-08-19", "2026-08-20"] });

    expect(result.featureMatrix.every((feature) => feature.timing === "信号日")).toBe(true);
    expect(result.labeledSampleSize).toBe(2);
    expect(result.lowPriceLabelSampleSize).toBe(2);
    expect(result.signalAmountSampleSize).toBe(2);
    expect(result.riskTiers.find((tier) => tier.tier === "高风险")).toMatchObject({ sampleSize: 1, averageMaxAdverseReturn: -30, mediumDownsideCount: 1, highDownsideCount: 1 });
    expect(result.riskTiers.find((tier) => tier.tier === "低风险")).toMatchObject({ sampleSize: 1, averageMaxAdverseReturn: 0, mediumDownsideCount: 0, highDownsideCount: 0 });
    expect(result.experiments.map((experiment) => experiment.key)).toEqual(["baseline", "riskPenalty", "hardFilter"]);
    expect(result.experiments.find((experiment) => experiment.key === "hardFilter")).toMatchObject({ inputCandidateCount: 1, excludedCandidateCount: 1 });
    expect(result.experiments.every((experiment) => experiment.realisticSimulation.assumptions.initialCapital === 100000)).toBe(true);
    expect(result.experiments.every((experiment) => experiment.realisticSimulation.assumptions.exitStrategy === "riskManagedHold")).toBe(true);
  });

  it("观察期不完整时不生成下行标签，避免用不完整的未来路径比较风险分层", () => {
    const incomplete = row({ stockCode: "600003.SH" });
    const prices = new Map([["600003.SH::2026-08-19", { openPrice: 10, closePrice: 9 }]]);
    const result = buildDownsideRiskResearch([incomplete], { observationDays: 2 }, {}, { priceByStockDate: prices, tradingDates: ["2026-08-19"] });

    expect(result.labeledSampleSize).toBe(0);
    expect(result.riskTiers.reduce((sum, tier) => sum + tier.sampleSize, 0)).toBe(0);
  });

  it("滚动验证窗口始终位于前置训练窗口之后，且只用验证期完整标签生成实验", () => {
    const dates = Array.from({ length: 42 }, (_, index) => `2026-02-${String(index + 1).padStart(2, "0")}`);
    const rows = dates.slice(0, 40).map((date, index) => row({
      stockCode: `600${String(index).padStart(3, "0")}.SH`, stockName: `窗口${index}`, date, nextDate: dates[index + 1], nextDayDate: dates[index], secondDayDate: dates[index + 1],
    }));
    const prices = new Map<string, { openPrice: number; closePrice: number; lowPrice: number; amount: number }>();
    for (const item of rows) {
      prices.set(`${item.stockCode}::${item.nextDayDate}`, { openPrice: 10, closePrice: 10, lowPrice: 9, amount: 60000 });
      if (item.secondDayDate) prices.set(`${item.stockCode}::${item.secondDayDate}`, { openPrice: 10, closePrice: 10, lowPrice: 9, amount: 60000 });
      prices.set(`${item.stockCode}::${item.date}`, { openPrice: 10, closePrice: 10, lowPrice: 9, amount: 60000 });
    }
    const result = buildDownsideRiskResearch(rows, { observationDays: 2, rollingTrainTradingDays: 30, rollingValidationTradingDays: 10 }, {}, { priceByStockDate: prices, tradingDates: dates });

    expect(result.rollingWindows).toHaveLength(1);
    expect(result.rollingWindows[0]).toMatchObject({ calibrationStartDate: dates[0], calibrationEndDate: dates[29], validationStartDate: dates[30], validationEndDate: dates[39], labeledSampleSize: 10 });
    expect(result.labeledSampleSize).toBe(10);
  });
});
