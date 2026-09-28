import { describe, expect, it } from "vitest";
import { evaluateAdvancedStopPolicy } from "../../../../server/research/simulator/advancedStop";
import type { TrailingPriceHistory } from "../../../../server/research/simulator/advancedTrailing";
import type { StopPolicyDefinition } from "../../../../server/research/stopPolicy";

function history(closes: readonly number[]): TrailingPriceHistory {
  return {
    dates: closes.map((_, index) => `2026-02-${String(index + 1).padStart(2, "0")}`),
    closes: [...closes],
    highs: closes.map(value => value + 0.5),
    lows: closes.map(value => value - 0.5),
  };
}

const FIXED: StopPolicyDefinition = {
  anchor: {
    kind: "FIXED_PERCENT",
    stopRatio: 0.06,
  },
  confirmation: "INTRADAY",
};

function evaluate(
  policy: StopPolicyDefinition,
  input: Partial<Parameters<typeof evaluateAdvancedStopPolicy>[0]> = {},
) {
  return evaluateAdvancedStopPolicy({
    policy,
    date: "2026-02-05",
    phase: "INTRADAY",
    close: 10,
    high: 10.5,
    low: 9.3,
    entryPrice: 10,
    holdingDays: 2,
    peakClosePrice: 10,
    history: history([10, 10.2, 10.3, 10.1, 10]),
    ...input,
  });
}

describe("advanced stop policies", () => {
  it("SL-00 fixed intraday stop triggers at the fixed line", () => {
    const result = evaluate(FIXED);
    expect(result.triggered).toBe(true);
    expect(result.line).toBeCloseTo(9.4, 8);
  });

  it("SL-09 close confirmation ignores an intraday touch", () => {
    expect(evaluate({ ...FIXED, confirmation: "ON_CLOSE" }).triggered).toBe(false);
    expect(evaluate(
      { ...FIXED, confirmation: "ON_CLOSE" },
      { phase: "CLOSE", close: 9.3 },
    ).triggered).toBe(true);
  });

  it("SL-10 requires two closes below the line", () => {
    const first = evaluate(
      { ...FIXED, confirmation: "TWO_CLOSES" },
      { phase: "CLOSE", close: 9.3 },
    );
    expect(first.triggered).toBe(false);
    const second = evaluate(
      { ...FIXED, confirmation: "TWO_CLOSES" },
      { phase: "CLOSE", close: 9.2, state: first.state },
    );
    expect(second.triggered).toBe(true);
  });

  it("SL-02 ATR anchor clamps the distance", () => {
    const result = evaluate({
      anchor: {
        kind: "ATR",
        atrWindow: 3,
        atrMultiplier: 1.5,
        minStopRatio: 0.04,
        maxStopRatio: 0.08,
      },
      confirmation: "INTRADAY",
    }, {
      low: 8.5,
    });
    expect(result.triggered).toBe(true);
    expect(result.line).not.toBeNull();
  });

  it("SL-14 ladder raises the stop after profit", () => {
    const result = evaluate({
      ...FIXED,
      escalation: {
        kind: "LADDER",
        steps: [
          { activationRatio: 0.03, stopRatio: 0 },
          { activationRatio: 0.06, stopRatio: 0.02 },
        ],
      },
    }, {
      close: 10.1,
      low: 10.01,
      peakClosePrice: 10.7,
    });
    expect(result.line).toBeCloseTo(10.2, 8);
    expect(result.triggered).toBe(true);
  });

  it("SL-23 partial stop returns a partial sell ratio", () => {
    const result = evaluate({
      ...FIXED,
      reduction: {
        steps: [
          { triggerRatio: -0.03, sellRatio: 0.5 },
          { triggerRatio: -0.06, sellRatio: 1 },
        ],
      },
    }, {
      close: 9.6,
      low: 9.6,
    });
    expect(result.triggered).toBe(true);
    expect(result.sellRatio).toBe(0.5);
  });
});
