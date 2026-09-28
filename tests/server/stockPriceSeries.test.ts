import { describe, expect, it } from "vitest";
import { buildStockDailySeries } from "../../server/stockPriceSeries";

function row(
  tradeDate: string,
  close: number,
  preClose: number | null = close - 1
) {
  return {
    tradeDate,
    openPrice: String(close - 0.2),
    closePrice: String(close),
    highPrice: String(close + 0.5),
    lowPrice: String(close - 0.6),
    preClosePrice: preClose === null ? null : String(preClose),
    volume: "10000",
    amount: "200000",
  };
}

describe("buildStockDailySeries", () => {
  it("uses lookback rows to calculate MA5 and MA10 at the requested range edge", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row(`2026-01-${String(index + 1).padStart(2, "0")}`, 10 + index)
    );

    const points = buildStockDailySeries(rows, "2026-01-10", "2026-01-12");

    expect(points.map(point => point.tradeDate)).toEqual([
      "2026-01-10",
      "2026-01-11",
      "2026-01-12",
    ]);
    expect(points[0]?.ma5).toBe(17);
    expect(points[0]?.ma10).toBe(14.5);
    expect(points[2]?.ma5).toBe(19);
    expect(points[2]?.ma10).toBe(16.5);
  });

  it("drops incomplete OHLC rows without fabricating values", () => {
    const rows = [
      row("2026-01-01", 10),
      { ...row("2026-01-02", 11), closePrice: null },
      row("2026-01-03", 12),
      row("2026-01-04", 13),
      row("2026-01-05", 14),
      row("2026-01-06", 15),
    ];

    const points = buildStockDailySeries(rows, "2026-01-03", "2026-01-06");

    expect(points.map(point => point.tradeDate)).toEqual([
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
    ]);
    expect(points[0]?.ma5).toBeNull();
    expect(points[3]?.ma5).toBe(12.8);
  });
});
