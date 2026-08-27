import { describe, expect, it } from "vitest";
import { buildLeaderCandidateBacktest } from "./leaderCandidates";

const makeRecord = (date: string, stockCode: string, stockName: string, limitUpTime = "09:40:00") => ({
  stockCode,
  stockName,
  limitUpDate: date,
  limitUpTime,
  sector: "题材A",
  turnover: "20",
  circulationValue: "100",
});

describe("三策略持仓与准备买入快照", () => {
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
    const baseline = result.strategyPortfolioSnapshot.strategies.find((item) => item.key === "baseline")!;
    expect(baseline.preparedBuys).toHaveLength(2);
    expect(baseline.preparedBuys.every((item) => item.signalDate === "2026-08-20")).toBe(true);
    expect(baseline.preparedBuys.flatMap((item) => item.conditions).join(" ")).toContain("未承诺成交");
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

  it("高风险硬过滤的准备清单不包含被阈值排除的候选", () => {
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
    expect(hardFilter.preparedBuys).toHaveLength(0);
    expect(hardFilter.excludedHighRiskCount).toBeGreaterThan(0);
  });
});
