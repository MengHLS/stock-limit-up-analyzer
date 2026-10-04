import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import {
  computePeakCloseSinceEvent,
  computePullbackFromEventPeakClose,
  computeTrendHoldsMa5Ma10,
} from "../../../../server/research/recipeFeatures/pullbackFeatures";
import type { DecisionTime } from "../../../../server/research/framework/leakage";
import {
  ENTRY_CONDITION_FEATURE_IDS,
  buildEntryConditionFeatureProviders,
} from "../../../../server/research/recipeRegistryAtoms";
import {
  makeEventPeakPullbackFeatures,
  type FeatureDefinition,
  type VisibleBar,
} from "../../../../server/strategyCore";

function canonicalBar(timestamp: string, close: number): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 1_000_000,
    amount: close * 1_000_000,
    turnoverRate: null,
    adjustment: "raw",
  };
}

function scenario(): {
  readonly bars: readonly CanonicalMarketBar[];
  readonly eventDayIndex: number;
} {
  const prefixCloses = [1, 1, 1, 1, 1, 20, 20, 20, 20];
  const closes = [...prefixCloses, 12, 11.5];
  return {
    bars: closes.map((close, index) => canonicalBar(`2026-01-${String(index + 1).padStart(2, "0")}`, close)),
    eventDayIndex: prefixCloses.length,
  };
}

function coreVisibleBars(bars: readonly CanonicalMarketBar[], eventDayIndex: number): readonly VisibleBar[] {
  return bars.map((bar, index) => ({
    date: bar.timestamp,
    relativeDay: index - eventDayIndex,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount,
    preClose: bar.preClose,
  }));
}

function featureById(features: readonly FeatureDefinition[], featureId: string): FeatureDefinition {
  const feature = features.find((item) => item.featureId === featureId);
  if (feature === undefined) throw new Error(`missing feature ${featureId}`);
  return feature;
}

describe("ENTRY_CONDITION pullback features", () => {
  it("peak / pullback / trend 数学与 prefix 历史定位正确", () => {
    const { bars, eventDayIndex } = scenario();
    expect(computePeakCloseSinceEvent(bars, eventDayIndex)).toBeCloseTo(12, 10);
    expect(computePullbackFromEventPeakClose(bars, eventDayIndex)).toBeCloseTo((12 - 11.5) / 12, 10);
    expect(computeTrendHoldsMa5Ma10(bars, eventDayIndex)).toBe(1);
    expect(computePeakCloseSinceEvent(bars, 0)).toBeCloseTo(20, 10);
  });

  it("Core / Research provider 对同一 prefix + event + current 序列逐值等价", () => {
    const { bars, eventDayIndex } = scenario();
    const decisionTime: DecisionTime = { date: bars[bars.length - 1]!.timestamp, point: "close" };
    const coreBars = coreVisibleBars(bars, eventDayIndex);
    const eventBar = coreBars[eventDayIndex]!;
    const coreContext = {
      asOf: decisionTime,
      bars: coreBars,
      eventDayBar: eventBar,
      eventField: () => null,
      parameters: {},
    };
    const coreFeatures = makeEventPeakPullbackFeatures();
    const researchFeatures = buildEntryConditionFeatureProviders("close", { eventDayIndex });
    const ids = [
      ENTRY_CONDITION_FEATURE_IDS.peakCloseSinceEvent,
      ENTRY_CONDITION_FEATURE_IDS.pullbackFromEventPeakClose,
      ENTRY_CONDITION_FEATURE_IDS.trendHoldsMa5Ma10,
    ] as const;

    for (const featureId of ids) {
      const coreValue = featureById(coreFeatures, featureId).compute(coreContext);
      const researchProvider = researchFeatures.find((feature) => feature.featureId === featureId);
      expect(researchProvider, featureId).toBeDefined();
      const researchValue = researchProvider!.compute({
        securityId: "sec_test",
        decisionTime,
        data: { symbol: "600001.SH", bars },
      });
      expect(researchValue, featureId).toBe(coreValue);
    }
  });

  it("严格大于边界：close == MA10 或 MA5 == MA10 返回 0；历史不足返回 null", () => {
    const flat = Array.from({ length: 10 }, (_, index) => canonicalBar(`2026-02-${String(index + 1).padStart(2, "0")}`, 10));
    expect(computeTrendHoldsMa5Ma10(flat, 0)).toBe(0);
    expect(computeTrendHoldsMa5Ma10(flat.slice(0, 9), 0)).toBeNull();

    const rising = [...flat.slice(0, 9), canonicalBar("2026-02-10", 11)];
    expect(computeTrendHoldsMa5Ma10(rising, 0)).toBe(1);
  });

  it("缺失 close / 零峰值不造默认值", () => {
    const { bars, eventDayIndex } = scenario();
    const zeroPeak = bars.map((bar, index) =>
      index >= eventDayIndex ? { ...bar, close: 0 } : bar,
    );
    expect(computePeakCloseSinceEvent(zeroPeak, eventDayIndex)).toBeNull();
    expect(computePullbackFromEventPeakClose(zeroPeak, eventDayIndex)).toBeNull();

    const missing = bars.map((bar, index) =>
      index === bars.length - 1 ? { ...bar, close: null } : bar,
    );
    expect(computePeakCloseSinceEvent(missing, eventDayIndex)).toBeNull();
    expect(computePullbackFromEventPeakClose(missing, eventDayIndex)).toBeNull();
    expect(computeTrendHoldsMa5Ma10(missing, eventDayIndex)).toBeNull();
  });
});
