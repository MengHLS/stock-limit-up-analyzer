import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../server/data/types";
import {
  computeThreeFactorRaw,
  threeFactorCompositeScoreOf,
} from "../../../server/research/recipeFeatures/threeFactorScoreFeatures";

function bar(close: number, overrides: Partial<CanonicalMarketBar> = {}): CanonicalMarketBar {
  return {
    symbol: "sec_test",
    timestamp: "2026-01-01",
    open: close,
    high: close + 0.2,
    low: close - 0.2,
    close,
    preClose: close,
    volume: 1000,
    amount: 10000,
    turnoverRate: null,
    adjustment: "raw",
    ...overrides,
  };
}

describe("3F 首板回踩资格", () => {
  it("T+1..T+5 连续上涨且从未低于首板收盘 ⇒ 不产信号", () => {
    const bars = [
      bar(10),
      bar(11),
      bar(12),
      bar(13),
      bar(14),
      bar(15),
    ];
    const raw = computeThreeFactorRaw(bars);
    expect(raw?.hasPullbackInObservationWindow).toBe(false);
    expect(raw === null ? null : threeFactorCompositeScoreOf(raw)).toBeNull();
  });

  it("T+1..T+5 任一天回踩到首板收盘价下方 ⇒ 保留为候选", () => {
    const bars = [
      bar(10),
      bar(11),
      bar(9.8),
      bar(10.2),
      bar(10.5),
      bar(10.8),
    ];
    const raw = computeThreeFactorRaw(bars);
    expect(raw?.hasPullbackInObservationWindow).toBe(true);
    expect(raw === null ? null : threeFactorCompositeScoreOf(raw)).not.toBeNull();
  });
});
