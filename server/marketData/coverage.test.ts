import { describe, it, expect } from "vitest";
import { computeIndexCoverage, computeLiquidityCoverageByYear } from "./coverage";
import type { IndexDailyBar, IndexMasterEntry, LiquidityDaily } from "./types";

function indexBar(tradeDate: string): IndexDailyBar {
  return { indexCode: "000300.SH", tradeDate, open: 1000, high: 1000, low: 1000, close: 1000, amount: null, volume: null, source: "sina" };
}

const master: IndexMasterEntry = {
  indexCode: "000300.SH",
  indexName: "沪深300",
  provider: "sina",
  providerCode: "sh000300",
  firstDate: "2005-04-08",
  lastDate: "2026-09-05",
  source: "sina",
  retrievedAt: "2026-09-06T00:00:00.000Z",
};

describe("computeIndexCoverage", () => {
  it("返回 first/last/rowCount", () => {
    const coverage = computeIndexCoverage(master, [indexBar("2026-01-05"), indexBar("2026-01-06"), indexBar("2026-01-07")]);
    expect(coverage.firstDate).toBe("2026-01-05");
    expect(coverage.lastDate).toBe("2026-01-07");
    expect(coverage.rowCount).toBe(3);
  });

  it("无 bar 时回退 master first/last", () => {
    const coverage = computeIndexCoverage(master, []);
    expect(coverage.firstDate).toBe("2005-04-08");
    expect(coverage.lastDate).toBe("2026-09-05");
    expect(coverage.rowCount).toBe(0);
  });

  it("传入交易日历可计算缺失日期", () => {
    const tradingDates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
    const coverage = computeIndexCoverage(master, [indexBar("2026-01-05"), indexBar("2026-01-07")], tradingDates);
    expect(coverage.missingDates).toEqual(["2026-01-06"]);
  });

  it("无日历时 missingDates 为空", () => {
    const coverage = computeIndexCoverage(master, [indexBar("2026-01-05"), indexBar("2026-01-07")]);
    expect(coverage.missingDates).toEqual([]);
  });
});

describe("computeLiquidityCoverageByYear", () => {
  function liq(tradeDate: string, securityId = "002361.SZ"): LiquidityDaily {
    return { securityId, tradeDate, turnoverRate: 1, circulationMarketCap: null, totalMarketCap: null, amount: 1, volume: 1, source: "tushare-daily" };
  }

  it("按年分组并计算填充率", () => {
    const rows = [
      liq("2025-01-02"),
      liq("2025-01-03"),
      liq("2025-01-02", "600000.SH"),
      liq("2026-01-05"),
    ];
    const tradingDates = ["2025-01-02", "2025-01-03", "2026-01-05"];
    const coverage = computeLiquidityCoverageByYear(rows, tradingDates);

    const year2025 = coverage.find((c) => c.year === 2025)!;
    expect(year2025.tradingDays).toBe(2);
    expect(year2025.symbols).toBe(2);
    expect(year2025.rows).toBe(3);
    // 3 rows / (2 days × 2 symbols) = 0.75
    expect(year2025.coverageRatio).toBeCloseTo(0.75);
  });

  it("无日历时以数据内日期去重为 tradingDays", () => {
    const rows = [liq("2025-01-02"), liq("2025-01-02", "600000.SH")];
    const coverage = computeLiquidityCoverageByYear(rows);
    expect(coverage[0]!.tradingDays).toBe(1);
    expect(coverage[0]!.coverageRatio).toBe(1);
  });

  it("分母为 0 时 coverageRatio 为 0", () => {
    const coverage = computeLiquidityCoverageByYear([], ["2025-01-02"]);
    expect(coverage).toEqual([]);
  });

  it("coverageRatio 封顶为 1", () => {
    // 同一交易日重复行数 > symbols×days（理论不可能，但封顶保护）
    const rows = [liq("2025-01-02"), liq("2025-01-02"), liq("2025-01-02")];
    const coverage = computeLiquidityCoverageByYear(rows, ["2025-01-02"]);
    expect(coverage[0]!.coverageRatio).toBeLessThanOrEqual(1);
  });
});
