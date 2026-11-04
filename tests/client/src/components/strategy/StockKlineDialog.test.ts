import { describe, expect, it } from "vitest";
import {
  candleColor,
  oneWordLimitState,
} from "../../../../../client/src/components/strategy/StockKlineDialog";

function point(overrides: {
  open: number;
  high: number;
  low: number;
  close: number;
  preClose: number;
}) {
  return {
    tradeDate: "2026-01-05",
    open: overrides.open,
    high: overrides.high,
    low: overrides.low,
    close: overrides.close,
    preClose: overrides.preClose,
    changePct: null,
    volume: 1000,
    amount: 10000,
    ma5: null,
    ma10: null,
    ma20: null,
  };
}

describe("StockKlineDialog one-word limit helpers", () => {
  it("identifies one-word limit up and uses the red candle color", () => {
    const value = point({
      open: 11,
      high: 11,
      low: 11,
      close: 11,
      preClose: 10,
    });

    expect(oneWordLimitState(value)).toBe("ONE_WORD_UP");
    expect(candleColor(value)).toBe("#dc2626");
  });

  it("identifies one-word limit down and uses the green candle color", () => {
    const value = point({
      open: 9,
      high: 9,
      low: 9,
      close: 9,
      preClose: 10,
    });

    expect(oneWordLimitState(value)).toBe("ONE_WORD_DOWN");
    expect(candleColor(value)).toBe("#059669");
  });

  it("keeps regular rising and falling candle colors", () => {
    expect(
      candleColor(
        point({
          open: 10,
          high: 11,
          low: 9.8,
          close: 10.8,
          preClose: 9.9,
        })
      )
    ).toBe("#dc2626");
    expect(
      candleColor(
        point({
          open: 10,
          high: 10.2,
          low: 9,
          close: 9.2,
          preClose: 10.1,
        })
      )
    ).toBe("#059669");
  });
});
