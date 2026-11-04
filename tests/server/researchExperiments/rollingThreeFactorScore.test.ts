import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../server/data";
import {
  ROLLING_THREE_FACTOR_CALIBRATION,
  computeRollingThreeFactorRaw,
  rollingThreeFactorCompositeScoreOf,
} from "../../../server/research/recipeFeatures/rollingThreeFactorScoreFeatures";
import { resolveStrategyRecipeById } from "../../../server/research/recipeRegistry";

function bar(day: number, high: number, low: number, close: number, volume: number): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp: `2026-09-${String(10 + day).padStart(2, "0")}`,
    open: close,
    high,
    low,
    close,
    preClose: close,
    volume,
    amount: volume * close,
    turnoverRate: null,
    adjustment: "raw",
  } as unknown as CanonicalMarketBar;
}

describe("rolling three-factor score", () => {
  it("T+1 起使用已可见窗口，T+5 后窗口冻结", () => {
    const bars = [
      bar(0, 11, 10, 10, 1000),
      bar(1, 10.5, 10.1, 10.4, 900),
      bar(2, 10.8, 10.2, 10.7, 950),
      bar(3, 11.2, 10.5, 11, 970),
      bar(4, 11.4, 10.9, 11.2, 990),
      bar(5, 11.8, 11, 11.5, 1010),
      bar(6, 100, 1, 2, 2000),
    ];

    const t1 = computeRollingThreeFactorRaw(bars.slice(0, 2));
    const t5 = computeRollingThreeFactorRaw(bars.slice(0, 6));
    const afterT5 = computeRollingThreeFactorRaw(bars);
    expect(t1?.relativeDay).toBe(1);
    expect(t5?.relativeDay).toBe(5);
    expect(afterT5).toEqual(t5);
    expect(rollingThreeFactorCompositeScoreOf(t1!)).toBeGreaterThan(0);
    expect(rollingThreeFactorCompositeScoreOf(t5!)).toBeGreaterThan(0);
  });

  it("校准边界按 N 独立且保持桶数量", () => {
    expect(ROLLING_THREE_FACTOR_CALIBRATION).toHaveLength(5);
    for (const calibration of ROLLING_THREE_FACTOR_CALIBRATION) {
      expect(calibration.maxAmplitudeEdges).toHaveLength(1);
      expect(calibration.meanAmplitudeEdges).toHaveLength(4);
      expect(calibration.t1VolumeRatioEdges).toHaveLength(4);
      expect(calibration.sampleCount).toBeGreaterThan(50_000);
    }
  });

  it("主策略、固定桶池化和 N=5 事件窗对照均可执行", () => {
    expect(resolveStrategyRecipeById("first-limit-pool-rolling-3f").features).toHaveLength(1);
    expect(resolveStrategyRecipeById("first-limit-pool-fixed-3f").features).toHaveLength(1);
    expect(resolveStrategyRecipeById("first-limit-pullback-3f-calibrated-n5").features).toHaveLength(1);
  });
});
