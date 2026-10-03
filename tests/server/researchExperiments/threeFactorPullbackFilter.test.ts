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

  it("显式关闭回踩门槛后，纯上升路径也进入 3F 排序", () => {
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
    expect(
      raw === null
        ? null
        : threeFactorCompositeScoreOf(raw, { requirePullback: false }),
    ).not.toBeNull();
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
  it("Te 截点只使用 T+1..Te，且 t1VolumeRatio 固定使用 T+1", () => {
    const bars = [
      bar(10, { volume: 1000, high: 10.2, low: 9.8 }),
      bar(11, { volume: 800, high: 11.5, low: 10.5 }),
      bar(9.5, { volume: 700, high: 10.0, low: 9.0 }),
      bar(12, { volume: 600, high: 12.5, low: 11.0 }),
    ];
    const raw1 = computeThreeFactorRaw(bars, 1)!;
    expect(raw1.maxAmplitude).toBeCloseTo((11.5 - 10.5) / 10, 12);
    expect(raw1.meanAmplitude).toBeCloseTo((11.5 - 10.5) / 10, 12);
    expect(raw1.hasPullbackInObservationWindow).toBe(false);
    expect(raw1.t1VolumeRatio).toBeCloseTo(0.8, 12);

    const raw3 = computeThreeFactorRaw(bars, 3)!;
    expect(raw3.maxAmplitude).toBeCloseTo(Math.max((11.5 - 10.5) / 10, (10 - 9) / 11, (12.5 - 11) / 9.5), 12);
    expect(raw3.meanAmplitude).toBeCloseTo(((11.5 - 10.5) / 10 + (10 - 9) / 11 + (12.5 - 11) / 9.5) / 3, 12);
    expect(raw3.hasPullbackInObservationWindow).toBe(true);
    expect(raw3.t1VolumeRatio).toBeCloseTo(0.8, 12);
  });

});
