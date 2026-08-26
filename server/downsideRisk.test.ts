import { describe, expect, it } from "vitest";
import { buildDownsideRiskResearch } from "./downsideRisk";
import type { LeaderCandidateBacktestRow } from "./leaderCandidates";
import { simulateRealisticTPlus1ToTPlus2 } from "./realisticBacktest";

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

function buildWeightSelectionFixture() {
  const dates = Array.from({ length: 42 }, (_, index) => `2026-03-${String(index + 1).padStart(2, "0")}`);
  const rows: LeaderCandidateBacktestRow[] = [];
  const prices = new Map<string, { openPrice: number; closePrice: number; lowPrice: number; amount: number }>();
  for (let index = 0; index < 40; index += 1) {
    const date = dates[index]!;
    const secondDayDate = dates[index + 1]!;
    const highRisk = row({
      date, nextDate: date, nextDayDate: date, secondDayDate,
      stockCode: `600H${String(index).padStart(3, "0")}.SH`, stockName: `高风险${index}`,
      score: 90, boards: 4, sectorCount: 1, limitUpTime: "14:40:00", marketCapScore: 4, phase: "高位退潮", maxBoards: 6,
    });
    const lowRisk = row({
      date, nextDate: date, nextDayDate: date, secondDayDate,
      stockCode: `600L${String(index).padStart(3, "0")}.SH`, stockName: `低风险${index}`,
      score: 80, boards: 2, sectorCount: 4, limitUpTime: "09:40:00", marketCapScore: 16, phase: "修复上升", maxBoards: 3,
    });
    rows.push(highRisk, lowRisk);
    prices.set(`${highRisk.stockCode}::${date}`, { openPrice: 10, closePrice: 10, lowPrice: 9.8, amount: 5_000 });
    prices.set(`${highRisk.stockCode}::${secondDayDate}`, { openPrice: 8, closePrice: 8, lowPrice: 8, amount: 5_000 });
    prices.set(`${lowRisk.stockCode}::${date}`, { openPrice: 10, closePrice: 10, lowPrice: 10, amount: 90_000 });
    prices.set(`${lowRisk.stockCode}::${secondDayDate}`, { openPrice: 12, closePrice: 12, lowPrice: 10, amount: 90_000 });
  }
  return { dates, rows, prices };
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

  it("在每个训练窗口内从固定网格选出更优扣分权重，并只将其用于后续验证窗口", () => {
    const { dates, rows, prices } = buildWeightSelectionFixture();
    const result = buildDownsideRiskResearch(rows, {
      observationDays: 2, rollingTrainTradingDays: 30, rollingValidationTradingDays: 10, autoTunePenaltyWeight: true,
    }, {
      initialCapital: 100000, maxPositions: 1, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0,
      trailingProfitActivationPercent: 100, strongHoldMinReturn: 100, maxHoldingDays: 2,
    }, { priceByStockDate: prices, tradingDates: dates });

    const window = result.rollingWindows[0]!;
    expect(result.autoTunePenaltyWeight).toBe(true);
    expect(result.penaltyWeightGrid).toEqual([0, 0.15, 0.35, 0.55, 0.75, 1]);
    expect(window.autoTunedPenaltyWeight).toBe(0.15);
    expect(window.trainingSampleSize).toBe(60);
    expect(window.weightTrials).toHaveLength(6);
    expect(window.weightTrials.find((trial) => trial.penaltyWeight === 0.15)!.objectiveValue).toBeGreaterThan(window.weightTrials.find((trial) => trial.penaltyWeight === 0)!.objectiveValue);
    expect(window.experiments.find((experiment) => experiment.key === "riskPenalty")!.realisticSimulation.assumptions.exitStrategy).toBe("riskManagedHold");
  });

  it("验证期未来价格变化不会影响已在训练期选出的权重，完全平局时选择更小权重", () => {
    const { dates, rows, prices } = buildWeightSelectionFixture();
    const options = { observationDays: 2, rollingTrainTradingDays: 30, rollingValidationTradingDays: 10, autoTunePenaltyWeight: true };
    const realistic = { initialCapital: 100000, maxPositions: 1, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0, trailingProfitActivationPercent: 100, strongHoldMinReturn: 100, maxHoldingDays: 2 };
    const before = buildDownsideRiskResearch(rows, options, realistic, { priceByStockDate: prices, tradingDates: dates });
    for (const item of rows.filter((candidate) => candidate.date >= dates[30]!)) {
      prices.set(`${item.stockCode}::${item.nextDayDate}`, { openPrice: 10, closePrice: 1, lowPrice: 1, amount: 1 });
      if (item.secondDayDate) prices.set(`${item.stockCode}::${item.secondDayDate}`, { openPrice: 1, closePrice: 1, lowPrice: 1, amount: 1 });
    }
    const after = buildDownsideRiskResearch(rows, options, realistic, { priceByStockDate: prices, tradingDates: dates });
    expect(after.rollingWindows[0]!.autoTunedPenaltyWeight).toBe(before.rollingWindows[0]!.autoTunedPenaltyWeight);

    const tied = buildDownsideRiskResearch(rows.filter((candidate) => candidate.stockName.startsWith("高风险")), { observationDays: 2, rollingTrainTradingDays: 30, rollingValidationTradingDays: 10, autoTunePenaltyWeight: true }, realistic, { priceByStockDate: prices, tradingDates: dates });
    expect(tied.rollingWindows[0]!.autoTunedPenaltyWeight).toBe(0);
  });

  it("关闭自动寻优时所有验证窗口回退使用手动扣分权重", () => {
    const { dates, rows, prices } = buildWeightSelectionFixture();
    const result = buildDownsideRiskResearch(rows, {
      observationDays: 2, rollingTrainTradingDays: 30, rollingValidationTradingDays: 10, autoTunePenaltyWeight: false, penaltyWeight: 0.55,
    }, { initialCapital: 100000, maxPositions: 1, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0 }, { priceByStockDate: prices, tradingDates: dates });

    expect(result.rollingWindows[0]).toMatchObject({ autoTunedPenaltyWeight: 0.55, weightTrials: [] });
    expect(result.experiments.find((experiment) => experiment.key === "riskPenalty")!.description).toContain("手动设定");
  });

  it("将全部无重叠验证窗口在同一连续资金账户中拼接，并返回有序且无重复的整体样本外曲线", () => {
    const dates = Array.from({ length: 72 }, (_, index) => `2026-04-${String(index + 1).padStart(2, "0")}`);
    const rows = dates.slice(0, 70).map((date, index) => row({
      date, nextDate: date, nextDayDate: date, secondDayDate: dates[index + 1]!,
      stockCode: `601${String(index).padStart(3, "0")}.SH`, stockName: `拼接${index}`,
    }));
    const prices = new Map<string, { openPrice: number; closePrice: number; lowPrice: number; amount: number }>();
    for (const item of rows) {
      prices.set(`${item.stockCode}::${item.nextDayDate}`, { openPrice: 10, closePrice: 10, lowPrice: 9.8, amount: 60_000 });
      prices.set(`${item.stockCode}::${item.secondDayDate}`, { openPrice: 10.5, closePrice: 10.5, lowPrice: 10, amount: 60_000 });
    }
    const result = buildDownsideRiskResearch(rows, {
      observationDays: 2, rollingTrainTradingDays: 30, rollingValidationTradingDays: 10, autoTunePenaltyWeight: false, penaltyWeight: 0.35,
    }, {
      initialCapital: 100000, maxPositions: 1, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0,
      trailingProfitActivationPercent: 100, strongHoldMinReturn: 100, maxHoldingDays: 2,
    }, { priceByStockDate: prices, tradingDates: dates });

    const walkForward = result.walkForward!;
    expect(result.rollingWindows).toHaveLength(4);
    expect(walkForward).toMatchObject({ startDate: dates[30], endDate: dates[69], validationWindowCount: 4 });
    expect(walkForward.equityCurve.map((point) => point.date)).toEqual([...walkForward.equityCurve.map((point) => point.date)].sort());
    expect(new Set(walkForward.equityCurve.map((point) => point.date)).size).toBe(walkForward.equityCurve.length);
    for (const experiment of walkForward.experiments) {
      const source = result.experiments.find((item) => item.key === experiment.key)!;
      expect(experiment).toMatchObject({ totalReturn: source.realisticSimulation.totalReturn, finalCapital: source.realisticSimulation.finalCapital, completedCount: source.realisticSimulation.completedCount });
    }
  });

  it("对原始、风险扣分和高风险硬过滤执行同一全周期连续回测，并只在验证段应用训练选出的权重", () => {
    const { dates, rows, prices } = buildWeightSelectionFixture();
    const realistic = { initialCapital: 100000, maxPositions: 1, commissionRate: 0, stampDutyRate: 0, transferFeeRate: 0, slippageBps: 0, trailingProfitActivationPercent: 100, strongHoldMinReturn: 100, maxHoldingDays: 2 };
    const result = buildDownsideRiskResearch(rows, {
      observationDays: 2, rollingTrainTradingDays: 30, rollingValidationTradingDays: 10, autoTunePenaltyWeight: true, penaltyWeight: 0.35,
    }, realistic, { priceByStockDate: prices, tradingDates: dates });

    expect(result.fullCycle).toMatchObject({ startDate: dates[0], endDate: dates[39] });
    expect(result.fullCycle.experiments.map((experiment) => experiment.key)).toEqual(["baseline", "riskPenalty", "hardFilter"]);
    expect(result.fullCycle.experiments.find((experiment) => experiment.key === "baseline")).toMatchObject({ inputCandidateCount: rows.length, excludedCandidateCount: 0 });
    expect(result.fullCycle.experiments.find((experiment) => experiment.key === "riskPenalty")!.description).toContain("前置训练窗口自动选出的风险扣分权重");
    expect(result.fullCycle.experiments.every((experiment) => experiment.realisticSimulation.assumptions.exitStrategy === "riskManagedHold")).toBe(true);
    expect(result.fullCycle.experiments.every((experiment) => experiment.realisticSimulation.assumptions.initialCapital === realistic.initialCapital)).toBe(true);
    const standaloneBaseline = simulateRealisticTPlus1ToTPlus2(rows, realistic, prices, dates);
    expect(result.fullCycle.experiments.find((experiment) => experiment.key === "baseline")!.realisticSimulation).toMatchObject({
      totalReturn: standaloneBaseline.totalReturn,
      finalCapital: standaloneBaseline.finalCapital,
      maxDrawdown: standaloneBaseline.maxDrawdown,
      filledCount: standaloneBaseline.filledCount,
      completedCount: standaloneBaseline.completedCount,
    });
    expect(result.fullCycle.tradeDifferences).toHaveLength(rows.length);
    expect(new Set(result.fullCycle.tradeDifferences.map((item) => `${item.signalDate}::${item.stockCode}`)).size).toBe(rows.length);
    const highRisk = result.fullCycle.tradeDifferences.find((item) => item.stockName.startsWith("高风险"))!;
    const lowRisk = result.fullCycle.tradeDifferences.find((item) => item.stockName.startsWith("低风险"))!;
    expect(highRisk).toMatchObject({ hardFilterExcluded: true, hardFilter: null });
    expect(highRisk.riskPenalty!.score).toBeLessThan(highRisk.baseline!.score);
    expect(lowRisk).toMatchObject({ hardFilterExcluded: false });
    expect(lowRisk.hardFilter).not.toBeNull();
    const attribution = result.fullCycle.riskPenaltyAttribution;
    const baselineFilled = result.fullCycle.experiments.find((experiment) => experiment.key === "baseline")!.realisticSimulation.filledCount;
    const riskPenaltyFilled = result.fullCycle.experiments.find((experiment) => experiment.key === "riskPenalty")!.realisticSimulation.filledCount;
    expect(attribution.baselineOnlyFilledCount + attribution.commonFilledCount).toBe(baselineFilled);
    expect(attribution.riskPenaltyOnlyFilledCount + attribution.commonFilledCount).toBe(riskPenaltyFilled);
    expect(attribution.commonFilledDifferentReturnCount).toBe(0);
    expect(attribution.autoTunedSignalCount + attribution.fallbackWeightSignalCount).toBe(rows.length);
  });
});
