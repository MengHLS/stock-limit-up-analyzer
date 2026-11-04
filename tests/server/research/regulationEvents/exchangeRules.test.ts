import { describe, expect, it } from "vitest";
import { buildTradingCalendar } from "../../../../server/security/tradingCalendar";
import {
  computePriceDeviationPct,
  computeResetDate,
  evaluateMainBoardAbnormalConditions,
  resolveRegulationRuleVersion,
} from "../../../../server/research/regulationEvents/exchangeRules";
import type { DailyBar, IndexDailyBar } from "../../../../server/research/regulationEvents/types";

function bar(tradeDate: string, close: number, previousClose = close, turnoverRate = 1): DailyBar {
  return { tradeDate, close, previousClose, high: close, low: close, turnoverRate };
}

const indexRows: IndexDailyBar[] = [
  "2026-07-01",
  "2026-07-02",
  "2026-07-03",
  "2026-07-06",
  "2026-07-07",
].map((tradeDate, i) => ({ tradeDate, close: 100 + i }));

describe("exchange regulation rules", () => {
  it("resolves current SSE and SZSE 2026 rule versions", () => {
    expect(resolveRegulationRuleVersion("SSE", "2026-07-06").id).toBe("SSE_2026_MAIN_BOARD");
    expect(resolveRegulationRuleVersion("SZSE", "2026-07-06").id).toBe("SZSE_2026_MAIN_BOARD");
  });

  it("computes price deviation relative to the index", () => {
    const stockRows = [
      bar("2026-07-01", 10),
      bar("2026-07-02", 10),
      bar("2026-07-03", 10),
      bar("2026-07-06", 13, 10),
      bar("2026-07-07", 13),
    ];
    const dev = computePriceDeviationPct(stockRows, indexRows, "2026-07-06", 3);
    expect(dev).not.toBeNull();
    expect(dev!).toBeGreaterThan(25);
  });

  it("flags abnormal volatility when 3-day deviation reaches 20%", () => {
    const stockRows = [
      bar("2026-07-01", 10),
      bar("2026-07-02", 10),
      bar("2026-07-03", 10),
      bar("2026-07-06", 13, 10),
      bar("2026-07-07", 13),
    ];
    const result = evaluateMainBoardAbnormalConditions(
      stockRows,
      indexRows,
      "2026-07-06",
      resolveRegulationRuleVersion("SSE", "2026-07-06"),
    );
    expect(result.priceCondition).toBe(true);
    expect(result.isAbnormal).toBe(true);
  });

  it("computes reset date as next trading day", () => {
    const calendar = buildTradingCalendar([
      "2026-07-10",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ]);
    expect(computeResetDate("2026-07-10", calendar).resetDate).toBe("2026-07-13");
  });

  it("uses resumption day when next trading day is suspended", () => {
    const calendar = buildTradingCalendar([
      "2026-07-10",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
    ]);
    const result = computeResetDate("2026-07-10", calendar, [
      { startDate: "2026-07-13", endDate: "2026-07-15" },
    ]);
    expect(result.resetDueToResumption).toBe(true);
    expect(result.resetDate).toBe("2026-07-16");
  });
});