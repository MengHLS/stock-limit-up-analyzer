import { describe, expect, it } from "vitest";
import { buildLeaderCandidateBacktest } from "../../server/leaderCandidates";
import { allocatePlannedBudgets } from "../../server/positionBudget";
import { boardHeightPositionScale } from "../../shared/boardHeightRisk";

const makeRecord = (date: string, stockCode: string, stockName: string, limitUpTime = "09:40:00") => ({
  stockCode,
  stockName,
  limitUpDate: date,
  limitUpTime,
  sector: "题材A",
  turnover: "20",
  circulationValue: "100",
});

describe("五策略持仓与准备买入快照", () => {
  it("只以最新信号日生成下一实际交易日准备买入优先级，不预设未知开盘成交", () => {
    const records = [
      ...["2026-08-18", "2026-08-19"].flatMap((date) => [
        makeRecord(date, "600001.SH", "主板甲"), makeRecord(date, "600002.SH", "主板乙", "10:00:00"), makeRecord(date, "600003.SH", "主板丙", "10:20:00"),
      ]),
      makeRecord("2026-08-20", "600004.SH", "主板丁"), makeRecord("2026-08-20", "600005.SH", "主板戊", "10:00:00"), makeRecord("2026-08-20", "600006.SH", "主板己", "10:20:00"),
    ];
    const result = buildLeaderCandidateBacktest(records, { minScore: 0 }, {
      tradingDates: ["2026-08-18", "2026-08-19", "2026-08-20"],
      priceByStockDate: new Map([
        ["600001.SH::2026-08-18", { openPrice: 10, closePrice: 10 }], ["600002.SH::2026-08-18", { openPrice: 10, closePrice: 10 }], ["600003.SH::2026-08-18", { openPrice: 10, closePrice: 10 }],
        ["600001.SH::2026-08-19", { openPrice: 10.2, closePrice: 10.5 }], ["600002.SH::2026-08-19", { openPrice: 10.2, closePrice: 10.5 }], ["600003.SH::2026-08-19", { openPrice: 10.2, closePrice: 10.5 }],
        ["600001.SH::2026-08-20", { openPrice: 10.4, closePrice: 10.6 }], ["600002.SH::2026-08-20", { openPrice: 10.4, closePrice: 10.6 }], ["600003.SH::2026-08-20", { openPrice: 10.4, closePrice: 10.6 }],
        ["600004.SH::2026-08-20", { openPrice: 10, closePrice: 10 }], ["600005.SH::2026-08-20", { openPrice: 10, closePrice: 10 }], ["600006.SH::2026-08-20", { openPrice: 10, closePrice: 10 }],
      ]),
    });

    expect(result.strategyPortfolioSnapshot.latestSignalDate).toBe("2026-08-20");
    expect(result.strategyPortfolioSnapshot.nextEntryTiming).toBe("下一实际交易日开盘");
    expect(result.strategyPortfolioSnapshot.strategies.map((item) => item.key)).toEqual(["baseline", "riskPenalty", "hardFilter", "qualityBlend", "qualityGate"]);
    const baseline = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "baseline")!;
    expect(baseline.preparedBuys).toHaveLength(2);
    expect(baseline.preparedBuys.every((item) => item.signalDate === "2026-08-20")).toBe(true);
    expect(baseline.preparedBuys.flatMap((item) => item.conditions).join(" ")).toContain("未承诺成交");
    const qualityBlend = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "qualityBlend")!;
    expect(qualityBlend.preparedBuys.every((item, index, items) => index === 0 || items[index - 1]!.strategyScore >= item.strategyScore)).toBe(true);
  });

  it("当前持仓取模拟截止日未出清订单，并且准备买入不重复已有持仓", () => {
    const records = ["2026-08-18", "2026-08-19", "2026-08-20"].flatMap((date) => [
      makeRecord(date, "600001.SH", "主板甲"),
      makeRecord(date, "600002.SH", "主板乙"),
    ]);
    const result = buildLeaderCandidateBacktest(records, { minScore: 0, realistic: { maxPositions: 2 } }, {
      tradingDates: ["2026-08-18", "2026-08-19", "2026-08-20"],
      priceByStockDate: new Map([
        ["600001.SH::2026-08-18", { openPrice: 10, closePrice: 10 }], ["600002.SH::2026-08-18", { openPrice: 10, closePrice: 10 }],
        ["600001.SH::2026-08-19", { openPrice: 10.1, closePrice: 10.3 }], ["600002.SH::2026-08-19", { openPrice: 10.1, closePrice: 10.3 }],
        ["600001.SH::2026-08-20", { openPrice: 10.2, closePrice: 10.4 }], ["600002.SH::2026-08-20", { openPrice: 10.2, closePrice: 10.4 }],
      ]),
    });

    const baseline = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "baseline")!;
    expect(baseline.currentHoldings).toHaveLength(2);
    expect(baseline.availableSlots).toBe(0);
    expect(baseline.preparedBuys).toHaveLength(0);
  });

  it("高风险硬过滤与质量门控的准备清单均不包含被阈值排除的候选", () => {
    const records = ["2026-08-18", "2026-08-19", "2026-08-20"].flatMap((date) => [
      makeRecord(date, "600001.SH", "主板甲"), makeRecord(date, "600002.SH", "主板乙"),
    ]);
    const result = buildLeaderCandidateBacktest(records, { minScore: 0, downsideRisk: { hardRiskThreshold: 0 } }, {
      tradingDates: ["2026-08-18", "2026-08-19", "2026-08-20"],
      priceByStockDate: new Map([
        ["600001.SH::2026-08-18", { openPrice: 10, closePrice: 10 }], ["600002.SH::2026-08-18", { openPrice: 10, closePrice: 10 }],
        ["600001.SH::2026-08-19", { openPrice: 10.1, closePrice: 10.3 }], ["600002.SH::2026-08-19", { openPrice: 10.1, closePrice: 10.3 }],
        ["600001.SH::2026-08-20", { openPrice: 10.2, closePrice: 10.4 }], ["600002.SH::2026-08-20", { openPrice: 10.2, closePrice: 10.4 }],
      ]),
    });

    const hardFilter = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "hardFilter")!;
    const qualityGate = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "qualityGate")!;
    expect(hardFilter.preparedBuys).toHaveLength(0);
    expect(hardFilter.excludedHighRiskCount).toBeGreaterThan(0);
    expect(qualityGate.preparedBuys).toHaveLength(0);
    expect(qualityGate.excludedHighRiskCount).toBeGreaterThan(0);
  });

  it("准备买入清单回显计划仓位：等权分仓、比例自洽、原始策略不降仓", () => {
    const records = [
      ...["2026-08-18", "2026-08-19"].flatMap((date) => [
        makeRecord(date, "600001.SH", "主板甲"), makeRecord(date, "600002.SH", "主板乙", "10:00:00"), makeRecord(date, "600003.SH", "主板丙", "10:20:00"),
      ]),
      makeRecord("2026-08-20", "600004.SH", "主板丁"), makeRecord("2026-08-20", "600005.SH", "主板戊", "10:00:00"), makeRecord("2026-08-20", "600006.SH", "主板己", "10:20:00"),
    ];
    const result = buildLeaderCandidateBacktest(records, { minScore: 0, realistic: { positionSizingStrategy: "equal", maxPositions: 5 } }, {
      tradingDates: ["2026-08-18", "2026-08-19", "2026-08-20"],
      priceByStockDate: new Map([
        ["600001.SH::2026-08-18", { openPrice: 10, closePrice: 10 }], ["600002.SH::2026-08-18", { openPrice: 10, closePrice: 10 }], ["600003.SH::2026-08-18", { openPrice: 10, closePrice: 10 }],
        ["600001.SH::2026-08-19", { openPrice: 10.2, closePrice: 10.5 }], ["600002.SH::2026-08-19", { openPrice: 10.2, closePrice: 10.5 }], ["600003.SH::2026-08-19", { openPrice: 10.2, closePrice: 10.5 }],
        ["600001.SH::2026-08-20", { openPrice: 10.4, closePrice: 10.6 }], ["600002.SH::2026-08-20", { openPrice: 10.4, closePrice: 10.6 }], ["600003.SH::2026-08-20", { openPrice: 10.4, closePrice: 10.6 }],
        ["600004.SH::2026-08-20", { openPrice: 10, closePrice: 10 }], ["600005.SH::2026-08-20", { openPrice: 10, closePrice: 10 }], ["600006.SH::2026-08-20", { openPrice: 10, closePrice: 10 }],
      ]),
    });

    const baseline = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "baseline")!;
    const sizing = baseline.plannedPositionSizing;
    expect(sizing.strategy).toBe("equal");
    expect(sizing.plannedCount).toBe(baseline.preparedBuys.length);
    expect(sizing.maxParticipatingBoards).toBe(6);
    expect(sizing.positionScaledCount).toBe(0);
    // 原始策略作为对照基准：逐笔不降仓。
    expect(baseline.preparedBuys.every((item) => item.positionScale === 1)).toBe(true);
    if (sizing.cash > 0 && baseline.preparedBuys.length > 0) {
      const expectedBudget = Number((sizing.cash / baseline.preparedBuys.length).toFixed(2));
      expect(baseline.preparedBuys.every((item) => item.plannedBudget === expectedBudget)).toBe(true);
      expect(baseline.preparedBuys.every((item) => item.plannedBudgetRatio === Number(((item.plannedBudget / sizing.cash) * 100).toFixed(2)))).toBe(true);
      expect(sizing.totalPlannedBudget).toBe(Number((expectedBudget * baseline.preparedBuys.length).toFixed(2)));
      // 等权分仓下预算合计不得超过可用现金。
      expect(sizing.totalPlannedBudgetRatio).toBeLessThanOrEqual(100.01);
    } else {
      expect(sizing.totalPlannedBudget).toBe(0);
    }
  });

  it("非基准策略按高位连板系数降低仓位（5 板 ×0.6），原始基准不降仓", () => {
    const dates = ["2026-08-14", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];
    // 600001 连续 5 个交易日涨停 ⇒ 最新信号日连板高度 5（连板链按表内日期集合反向邻接计），
    // 且其每个 T+1 开盘都恰为涨停（blockLimitUpBuys 拦截）⇒ 既不会被买入持有、也不会被
    // heldCodes 过滤，必然出现在「下一交易日准备买入」清单里（= 非平凡用例的确定性来源）。
    // 600002 正常成交并被持有，保证组合仍有可开仓位（availableSlots >= 1）。
    const records = dates.flatMap((date) => [
      makeRecord(date, "600001.SH", "主板甲"),
      makeRecord(date, "600002.SH", "主板乙", "10:00:00"),
    ]);
    const priceByStockDate = new Map<string, { openPrice: number; closePrice: number }>(
      dates.flatMap((date) => [
        [`600001.SH::${date}`, { openPrice: Number((10 * 1.1).toFixed(2)), closePrice: 10 }],
        [`600002.SH::${date}`, { openPrice: 10, closePrice: 10.5 }],
      ]),
    );
    const result = buildLeaderCandidateBacktest(
      records,
      { minScore: 0, realistic: { blockLimitUpBuys: true, maxPositions: 5 } },
      { tradingDates: dates, priceByStockDate },
    );

    const baseline = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "baseline")!;
    const riskPenalty = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "riskPenalty")!;
    const baselineFiveBoard = baseline.preparedBuys.find((item) => item.boards === 5);
    expect(baselineFiveBoard).toBeDefined();
    // 原始策略作为对照基准：即使 5 板也不降仓。
    expect(baselineFiveBoard!.positionScale).toBe(1);
    expect(baseline.plannedPositionSizing.positionScaledCount).toBe(0);

    const sizing = riskPenalty.plannedPositionSizing;
    expect(sizing.maxParticipatingBoards).toBe(6);
    expect(sizing.plannedCount).toBe(riskPenalty.preparedBuys.length);
    const scaled = riskPenalty.preparedBuys.find((item) => item.boards === 5);
    expect(scaled).toBeDefined();
    // 逐笔系数必须等于权威函数在同一上限下的取值。
    expect(scaled!.positionScale).toBe(boardHeightPositionScale(5, sizing.maxParticipatingBoards));
    expect(scaled!.positionScale).toBe(0.6);
    expect(sizing.positionScaledCount).toBe(riskPenalty.preparedBuys.filter((item) => item.positionScale < 1).length);
    expect(sizing.positionScaledCount).toBeGreaterThan(0);
    // 降仓后预算上限 = 等权预算 × 0.6（与模拟器同一口径）。
    expect(scaled!.plannedBudget).toBe(Number((((sizing.cash / sizing.plannedCount) * 0.6)).toFixed(2)));
  });
});

describe("单笔计划预算分配（分仓口径唯一权威）", () => {
  it("等权 / 评分加权 / 固定比例三种口径与交易模拟器一致", () => {
    const targets = [{ score: 10 }, { score: 30 }, { score: 60 }];
    expect(allocatePlannedBudgets({ strategy: "equal", cash: 100000, initialCapital: 200000, fixedPositionPercent: 20, targets }))
      .toEqual([100000 / 3, 100000 / 3, 100000 / 3]);
    expect(allocatePlannedBudgets({ strategy: "scoreWeighted", cash: 100000, initialCapital: 200000, fixedPositionPercent: 20, targets }))
      .toEqual([10000, 30000, 60000]);
    expect(allocatePlannedBudgets({ strategy: "fixedPercent", cash: 100000, initialCapital: 200000, fixedPositionPercent: 25, targets: [{ score: 1 }, { score: 1 }] }))
      .toEqual([50000, 50000]);
  });

  it("评分加权合计为 0 时退化为等权；positionScale 只缩放该笔预算", () => {
    expect(allocatePlannedBudgets({ strategy: "scoreWeighted", cash: 90000, initialCapital: 0, fixedPositionPercent: 0, targets: [{ score: 0 }, { score: 0 }, { score: 0 }] }))
      .toEqual([30000, 30000, 30000]);
    expect(allocatePlannedBudgets({ strategy: "equal", cash: 100000, initialCapital: 0, fixedPositionPercent: 0, targets: [{ score: 0, positionScale: 0.6 }, { score: 0 }, { score: 0, positionScale: 0 }] }))
      .toEqual([20000, 100000 / 3, 0]);
  });

  it("空清单不产生分配（不出现除以 0）", () => {
    expect(allocatePlannedBudgets({ strategy: "equal", cash: 0, initialCapital: 0, fixedPositionPercent: 0, targets: [] })).toEqual([]);
    expect(allocatePlannedBudgets({ strategy: "fixedPercent", cash: 0, initialCapital: 100000, fixedPositionPercent: 20, targets: [] })).toEqual([]);
  });
});
