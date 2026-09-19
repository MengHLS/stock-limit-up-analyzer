/**
 * STRATEGY-ARCH-001 · 规格 §23.4 Feature
 *
 * 覆盖：Feature Registry / lookup / version / lookback / availability（含「未来结果类特征禁止注册」）。
 */

import { describe, expect, it } from "vitest";
import {
  StrategyCoreError,
  createFeatureRegistry,
  createDefaultFeatureRegistry,
  getDefaultFeatureRegistry,
  makeAtrFeature,
  makeEmaFeature,
  makePullbackFeatures,
  makePctChangeFeature,
  makeRsiFeature,
  makeSmaFeature,
  sameBarLeakage,
  type FeatureComputeContext,
  type FeatureDefinition,
  type VisibleBar,
} from "../../../server/strategyCore";
import { BAR_FIXTURE, barsFor } from "./_graphHarness";

function context(bars: readonly VisibleBar[], eventDayBar: VisibleBar | null = null): FeatureComputeContext {
  return {
    asOf: { date: "2026-09-19", point: "close" },
    bars,
    eventDayBar,
    eventField: () => null,
    parameters: {},
  };
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
    return "NO_ERROR";
  } catch (error) {
    return (error as { code?: string }).code ?? "NO_CODE";
  }
}

const ORDINARY: FeatureDefinition = {
  featureId: "ordinary",
  version: "1.0.0",
  inputs: ["close"],
  lookback: 1,
  leakage: sameBarLeakage("close", 0),
  compute: (ctx) => ctx.bars[ctx.bars.length - 1]?.close ?? null,
};

describe("§23.4 Feature — Registry", () => {
  it("注册 / 查找 / 列举（列举稳定排序）", () => {
    const registry = createFeatureRegistry([ORDINARY, makeSmaFeature(5)]);
    expect(registry.has("ordinary")).toBe(true);
    expect(registry.has("missing")).toBe(false);
    expect(registry.get("ordinary")?.version).toBe("1.0.0");
    expect(registry.get("missing")).toBeNull();
    expect(registry.list().map((item) => item.featureId)).toEqual(["ma5", "ordinary"]);
  });

  it("重复 featureId ⇒ 响亮拒绝（后者不静默覆盖前者）", () => {
    expect(errorCode(() => createFeatureRegistry([ORDINARY, ORDINARY]))).toBe("FEATURE_VERSION_MISMATCH");
  });

  it("版本不一致 ⇒ FEATURE_VERSION_MISMATCH（不静默用别的版本）", () => {
    const registry = createFeatureRegistry([ORDINARY]);
    expect(errorCode(() => registry.resolve({ featureId: "ordinary", version: "2.0.0" }))).toBe("FEATURE_VERSION_MISMATCH");
    expect(registry.resolve({ featureId: "ordinary", version: "1.0.0" }).featureId).toBe("ordinary");
  });

  it("未注册 ⇒ FEATURE_NOT_REGISTERED", () => {
    const registry = createFeatureRegistry([ORDINARY]);
    expect(errorCode(() => registry.resolve({ featureId: "ghost", version: "1.0.0" }))).toBe("FEATURE_NOT_REGISTERED");
  });

  it("availability 声明缺省（lookback < 1 / 空 featureId）被拒", () => {
    expect(errorCode(() => createFeatureRegistry([{ ...ORDINARY, lookback: 0 }]))).toBe("FEATURE_LOOKBACK_INSUFFICIENT");
    expect(errorCode(() => createFeatureRegistry([{ ...ORDINARY, featureId: " " }]))).toBe("FEATURE_NOT_REGISTERED");
    expect(errorCode(() => createFeatureRegistry([{ ...ORDINARY, version: "" }]))).toBe("FEATURE_VERSION_MISMATCH");
  });
});

describe("§23.4 Feature — availability / leakage 声明", () => {
  it("usesForwardData=true（未来结果类）禁止注册", () => {
    const future: FeatureDefinition = {
      ...ORDINARY,
      featureId: "futureOutcome",
      leakage: { usesForwardData: true, dataThroughRelativeDay: 1, availableAtPoint: "close" },
    };
    expect(errorCode(() => createFeatureRegistry([future]))).toBe("LEAKAGE_LOOK_AHEAD");
  });

  it("dataThroughRelativeDay > 0（需要未来数据）禁止注册", () => {
    const needsFuture: FeatureDefinition = {
      ...ORDINARY,
      featureId: "needsFuture",
      leakage: { usesForwardData: false, dataThroughRelativeDay: 3, availableAtPoint: "close" },
    };
    expect(errorCode(() => createFeatureRegistry([needsFuture]))).toBe("LEAKAGE_LOOK_AHEAD");
  });

  it("声明面完整可得（availableAtPoint / dataThroughRelativeDay 都是相对当前 bar 的，不是远古常量）", () => {
    const definition = makeSmaFeature(5);
    expect(definition.leakage.usesForwardData).toBe(false);
    expect(definition.leakage.dataThroughRelativeDay).toBe(0);
    expect(definition.leakage.availableAtPoint).toBe("close");
    expect(definition.lookback).toBe(5);
    expect(definition.inputs).toEqual(["close"]);
  });
});

describe("§23.4 Feature — lookback 与计算", () => {
  it("SMA：lookback 不足 ⇒ 返回 null（不臆造）", () => {
    const ma5 = makeSmaFeature(5);
    expect(ma5.compute(context([BAR_FIXTURE(0), BAR_FIXTURE(1)]))).toBeNull();
    const enough = barsFor(4).bars.map((bar) => ({ ...bar, close: 10 }));
    expect(ma5.compute(context(enough))).toBeCloseTo(10, 10);
  });

  it("SMA / EMA / RSI / ATR 的 lookback 与取值范围", () => {
    expect(makeSmaFeature(20).lookback).toBe(20);
    expect(makeEmaFeature(12).lookback).toBe(12);
    expect(makeRsiFeature(14).lookback).toBe(15);
    expect(makeAtrFeature(14).lookback).toBe(15);
    const closes = [10, 11, 12, 11, 13, 14, 13, 15].map((close, index) => ({ ...BAR_FIXTURE(index), close }));
    expect(makeSmaFeature(4).compute(context(closes))).toBeCloseTo((13 + 14 + 13 + 15) / 4, 10);
    expect(makeEmaFeature(4).compute(context(closes))).not.toBeNull();
    const rsi = makeRsiFeature(4).compute(context(closes));
    expect(typeof rsi).toBe("number");
    expect(rsi as number).toBeGreaterThanOrEqual(0);
    expect(rsi as number).toBeLessThanOrEqual(100);
    expect(makeAtrFeature(4).compute(context(closes))).toBeGreaterThan(0);
  });

  it("RSI：全涨 ⇒ 100（边界可辨）", () => {
    const bars = [10, 11, 12, 13, 14, 15].map((close, index) => ({ ...BAR_FIXTURE(index), close, high: close, low: close - 0.5 }));
    expect(makeRsiFeature(5).compute(context(bars))).toBe(100);
  });

  it("事件相对特征用**显式事件日 bar**（修掉 legacy「假定 bars[0] 是首板日」的限制）", () => {
    const [haircut, volumeRatio, isBullish, momentum] = makePullbackFeatures();
    const eventBar = { ...BAR_FIXTURE(0), open: 10, close: 11, volume: 1_000_000 };
    // 当前 bar 是 rd=2（不是序列第一根）：若按 legacy 的 bars[0] 取基准会算错
    const current = { ...BAR_FIXTURE(2), low: 9.5, close: 11.5, open: 11, volume: 300_000 };
    const ctx = context([current], eventBar);
    expect(haircut.compute(ctx)).toBeCloseTo((10 - 9.5) / 10, 10);
    expect(volumeRatio.compute(ctx)).toBeCloseTo(0.3, 10);
    expect(isBullish.compute(ctx)).toBe(1);
    expect(momentum.compute(ctx)).toBeCloseTo(11.5 / 11 - 1, 10);
  });

  it("事件日 bar 缺失 ⇒ 全部事件相对特征返回 null（不臆造基准）", () => {
    const [haircut, volumeRatio, , momentum] = makePullbackFeatures();
    const ctx = context([BAR_FIXTURE(2)], null);
    expect(haircut.compute(ctx)).toBeNull();
    expect(volumeRatio.compute(ctx)).toBeNull();
    expect(momentum.compute(ctx)).toBeNull();
  });

  it("pctChange 需要 preClose；缺失 ⇒ null", () => {
    const feature = makePctChangeFeature();
    const withPre = { ...BAR_FIXTURE(1), close: 11, preClose: 10 };
    expect(feature.compute(context([withPre]))).toBeCloseTo(0.1, 10);
    const withoutPre = { ...BAR_FIXTURE(1), close: 11, preClose: null };
    expect(feature.compute(context([withoutPre]))).toBeNull();
  });

  it("默认注册表：内置指标 + 事件相对特征 + pctChange 全部就位，且是惰性单例", () => {
    const registry = createDefaultFeatureRegistry();
    const ids = registry.list().map((item) => item.featureId);
    for (const expected of ["ma5", "ma10", "ma20", "ma60", "ema12", "ema26", "rsi14", "atr14", "haircutFromEventLow", "volumeRatio", "isBullish", "momentumFromEventClose", "pctChange"]) {
      expect(ids).toContain(expected);
    }
    expect(getDefaultFeatureRegistry()).toBe(getDefaultFeatureRegistry());
  });

  it("新增特征不需要改 Core 代码（数据驱动可扩展）—— 注册一个全新特征即可被 resolve", () => {
    const custom: FeatureDefinition = {
      featureId: "myCustomFactor",
      version: "0.1.0",
      inputs: ["close", "volume"],
      lookback: 2,
      leakage: sameBarLeakage("close", 0),
      compute: (ctx) => ctx.bars.length,
    };
    const registry = createFeatureRegistry([...createDefaultFeatureRegistry().list(), custom]);
    expect(registry.has("myCustomFactor")).toBe(true);
    expect(registry.resolve({ featureId: "myCustomFactor", version: "0.1.0" }).compute(context(barsFor(3).bars))).toBe(4);
    expect(() => registry.resolve({ featureId: "myCustomFactor", version: "9.9.9" })).toThrow(StrategyCoreError);
  });
});
