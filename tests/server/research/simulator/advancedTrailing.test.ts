import { describe, expect, it } from "vitest";
import {
  evaluateAdvancedTrailingPolicy,
  type TrailingPriceHistory,
} from "../../../../server/research/simulator/advancedTrailing";

function history(
  closes: readonly number[],
  highs = closes.map(value => value + 0.5),
  lows = closes.map(value => value - 0.5),
): TrailingPriceHistory {
  return {
    dates: closes.map((_, index) => `2026-01-${String(index + 1).padStart(2, "0")}`),
    closes: [...closes],
    highs: [...highs],
    lows: [...lows],
  };
}

function evaluate(
  policy: Parameters<typeof evaluateAdvancedTrailingPolicy>[0]["policy"],
  input: Partial<Parameters<typeof evaluateAdvancedTrailingPolicy>[0]> = {},
) {
  const prices = history([10, 11, 12, 13, 10]);
  return evaluateAdvancedTrailingPolicy({
    policy,
    date: "2026-01-05",
    close: 10,
    high: 10.5,
    low: 9.5,
    riskEntryPrice: 10,
    peakClosePrice: 13,
    stopLossRatio: 0.06,
    history: prices,
    ...input,
  });
}

describe("advanced trailing policy evaluator", () => {
  it("MA_CROSS requires profit activation and a close below both averages", () => {
    expect(evaluate({
      kind: "MA_CROSS",
      fastWindow: 2,
      slowWindow: 3,
      activationRatio: 0,
    }).reason).toContain("MA趋势止盈");
  });

  it("ATR_CHANDELIER uses peak close minus ATR multiple", () => {
    expect(evaluate({
      kind: "ATR_CHANDELIER",
      atrWindow: 3,
      atrMultiplier: 2.5,
      activationRatio: 0,
    }, { close: 7.5, low: 7.0 }).reason).toContain("ATR吊灯止盈");
  });

  it("R_MULTIPLE locks the highest reached risk multiple", () => {
    expect(evaluate(
      {
        kind: "R_MULTIPLE",
        lockLadder: [
          { triggerR: 2, lockR: 1 },
          { triggerR: 3, lockR: 2 },
        ],
      },
      {
        close: 11.1,
        peakClosePrice: 12,
      },
    ).reason).toContain("R倍利润锁止盈");
  });

  it("PROFIT_GIVEBACK limits retracement to a fraction of peak profit", () => {
    expect(evaluate(
      {
        kind: "PROFIT_GIVEBACK",
        activationRatio: 0.05,
        givebackFraction: 1 / 3,
      },
      {
        close: 11.1,
        peakClosePrice: 12,
      },
    ).reason).toContain("利润回吐止盈");
  });

  it("SWING_LOW exits below the prior lookback low", () => {
    const prices = history([10, 11, 12, 13, 8.9], [10.5, 11.5, 12.5, 13.5, 9.4], [9.5, 10.5, 11.5, 12.5, 8.5]);
    expect(evaluate(
      {
        kind: "SWING_LOW",
        lookbackDays: 3,
        activationRatio: 0,
      },
      {
        history: prices,
        close: 8.9,
        low: 8.5,
      },
    ).reason).toContain("结构低点止盈");
  });

  it("PARABOLIC_SAR exits on a close below the long-side SAR", () => {
    const prices = history(
      [10, 11, 12, 13, 10],
      [10.5, 11.5, 12.5, 13.5, 10.5],
      [11.5, 12.5, 13.5, 12.5, 9.5],
    );
    expect(evaluate(
      {
        kind: "PARABOLIC_SAR",
        step: 0.02,
        maxStep: 0.2,
        activationRatio: 0,
      },
      {
        history: prices,
        sarState: { sar: 10, extreme: 12, acceleration: 0.2 },
      },
    ).reason).toContain("SAR趋势止盈");
  });

  it("HYBRID uses the highest floor, MA and ATR trail", () => {
    expect(evaluate({
      kind: "HYBRID",
      fastWindow: 2,
      atrWindow: 3,
      atrMultiplier: 2.5,
      floorRatio: 0.01,
      activationRatio: 0.03,
    }).reason).toContain("混合轨止盈");
  });
});
