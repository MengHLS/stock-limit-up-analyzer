/**
 * STRATEGY-BRIDGE-001 · 后事件状态轴特征（`EVENT_STATE_LONG` 第一版）契约测试。
 *
 * 覆盖 `makeEventStateAmplitudeFeatures()` 的**四条硬契约**：
 *   1. **rd15 可算**：窗口 rd11~15 完整时给出确定值；
 *   2. **决策点下界**：rd14 及以前**拿不到完整 rd11~15 定义**（返回 null，不臆造）；
 *   3. **上限硬截断**：**rd16+ 的 bar 永不进入计算**（即使决策日在 rd20+）；
 *   4. **逐值一致**：与冻结研究的链式前收定义**逐值相同**（测试内独立复算同一公式）。
 *
 * 另覆盖：registration / leakage 声明 / **既有 rd1~5 特征定义未被改动**。
 */

import { describe, expect, it } from "vitest";
import {
  EVENT_STATE_AMPLITUDE_FEATURE_IDS,
  EVENT_STATE_AMPLITUDE_WINDOW,
  getDefaultFeatureRegistry,
  makeEventStateAmplitudeFeatures,
  makeObservationWindowFeatures,
  makeRollingObservationWindowFeatures,
  type FeatureComputeContext,
  type FeatureDefinition,
  type VisibleBar,
} from "../../../server/strategyCore";
import { BAR_FIXTURE } from "./_graphHarness";

function context(bars: readonly VisibleBar[], eventDayBar: VisibleBar | null): FeatureComputeContext {
  return {
    asOf: { date: "2026-09-19", point: "close" },
    bars,
    eventDayBar,
    eventField: () => null,
    parameters: {},
  };
}

/** 事件日收盘 = 10；rd_i 收盘 = 10 + i*0.1；每根 high/low 距收盘 ±0.2。 */
const EVENT_CLOSE = 10;
const EVENT_BAR: VisibleBar = { ...BAR_FIXTURE(0), open: 10, high: 10, low: 10, close: EVENT_CLOSE };

function barAt(relativeDay: number, high: number, low: number, close: number): VisibleBar {
  return { ...BAR_FIXTURE(relativeDay), open: close, high, low, close };
}

/** rd1..maxRd 的确定性 bar 序列（振幅 = 0.4 / 上一根收盘）。 */
function chainBars(maxRd: number, overrides: Partial<Record<number, Partial<VisibleBar>>> = {}): VisibleBar[] {
  const bars: VisibleBar[] = [EVENT_BAR];
  for (let rd = 1; rd <= maxRd; rd += 1) {
    const close = EVENT_CLOSE + rd * 0.1;
    bars.push({ ...barAt(rd, close + 0.2, close - 0.2, close), ...(overrides[rd] ?? {}) });
  }
  return bars;
}

/**
 * **独立复算**冻结研究的链式前收定义（不 import 生产实现）：
 * `amp(rd) = (high - low) / close(rd-1)`，前收自事件日收盘起步。
 */
function expectedAmplitudes(bars: readonly VisibleBar[], eventClose: number): number[] {
  const out: number[] = [];
  let runningPreClose = eventClose;
  const sorted = [...bars].filter((b) => b.relativeDay >= 1).sort((l, r) => l.relativeDay - r.relativeDay);
  for (const bar of sorted) {
    out.push(((bar.high as number) - (bar.low as number)) / runningPreClose);
    runningPreClose = bar.close as number;
  }
  return out;
}

function byId(features: readonly FeatureDefinition[], featureId: string): FeatureDefinition {
  const found = features.find((feature) => feature.featureId === featureId);
  if (found === undefined) throw new Error("未找到特征 " + featureId);
  return found;
}

describe("STRATEGY-BRIDGE-001 · 后事件状态振幅特征（rd11~15）", () => {
  const [maxAmp5, avgAmp5] = makeEventStateAmplitudeFeatures();

  it("契约：id / version / historyMode / leakage（无未来依赖）", () => {
    expect(EVENT_STATE_AMPLITUDE_WINDOW).toEqual({ start: 11, end: 15 });
    expect(EVENT_STATE_AMPLITUDE_FEATURE_IDS.maxAmp5).toBe("maxAmp5");
    expect(EVENT_STATE_AMPLITUDE_FEATURE_IDS.avgAmp5).toBe("avgAmp5");
    expect(makeEventStateAmplitudeFeatures().map((f) => f.featureId)).toEqual(["maxAmp5", "avgAmp5"]);
    for (const feature of makeEventStateAmplitudeFeatures()) {
      expect(feature.version).toBe("1.0.0");
      expect(feature.historyMode).toBe("EVENT_TO_CURRENT");
      expect(feature.leakage.usesForwardData).toBe(false);
      // 🔴 无未来依赖：0 表示「相对当前 bar 不需要任何未来 bar」
      expect(feature.leakage.dataThroughRelativeDay).toBe(0);
      expect(feature.leakage.availableAtPoint).toBe("close");
    }
  });

  it("注册：默认注册表包含 maxAmp5 / avgAmp5，且可被 resolve", () => {
    const registry = getDefaultFeatureRegistry();
    expect(registry.has("maxAmp5")).toBe(true);
    expect(registry.has("avgAmp5")).toBe(true);
    expect(registry.resolve({ featureId: "maxAmp5", version: "1.0.0" }).featureId).toBe("maxAmp5");
    expect(registry.resolve({ featureId: "avgAmp5", version: "1.0.0" }).featureId).toBe("avgAmp5");
  });

  it("① rd15 可算：给出 rd11~15 的最大 / 平均振幅", () => {
    const bars = chainBars(15);
    const ctx = context(bars, EVENT_BAR);
    const amps = expectedAmplitudes(bars, EVENT_CLOSE).slice(10);
    expect(amps).toHaveLength(5);
    expect(maxAmp5.compute(ctx)).toBeCloseTo(Math.max(...amps), 12);
    expect(avgAmp5.compute(ctx)).toBeCloseTo(amps.reduce((s, v) => s + v, 0) / 5, 12);
    // 手算锚点：振幅 = 0.4 / (10 + (i-1)*0.1)
    expect(maxAmp5.compute(ctx)).toBeCloseTo(0.4 / 11.0, 12);
    expect(avgAmp5.compute(ctx)).toBeCloseTo((0.4 / 11.0 + 0.4 / 11.1 + 0.4 / 11.2 + 0.4 / 11.3 + 0.4 / 11.4) / 5, 12);
  });

  it("② rd14 及以前 ⇒ null（拿不到完整 rd11~15 定义，不臆造）", () => {
    for (const maxRd of [0, 1, 5, 10, 11, 12, 13, 14]) {
      const bars = chainBars(maxRd);
      const ctx = context(bars, EVENT_BAR);
      expect(maxAmp5.compute(ctx)).toBeNull();
      expect(avgAmp5.compute(ctx)).toBeNull();
    }
  });

  it("③ rd16+ 的 bar 永不进入计算（即使决策日在 rd20+）", () => {
    const clean = chainBars(15);
    const cleanCtx = context(clean, EVENT_BAR);
    const baselineMax = maxAmp5.compute(cleanCtx);
    const baselineAvg = avgAmp5.compute(cleanCtx);

    // rd16..rd25 注入极端振幅（若被读取，结果会剧烈变化）
    const poisoned = chainBars(25, {
      16: { high: 1000, low: 1 }, 17: { high: 1000, low: 1 }, 18: { high: 1000, low: 1 },
      19: { high: 1000, low: 1 }, 20: { high: 1000, low: 1 }, 21: { high: 1000, low: 1 },
      22: { high: 1000, low: 1 }, 23: { high: 1000, low: 1 }, 24: { high: 1000, low: 1 },
      25: { high: 1000, low: 1 },
    });
    const poisonedCtx = context(poisoned, EVENT_BAR);
    expect(maxAmp5.compute(poisonedCtx)).toBeCloseTo(baselineMax as number, 12);
    expect(avgAmp5.compute(poisonedCtx)).toBeCloseTo(baselineAvg as number, 12);
    // 🔴 决策点从 rd15 推到 rd25，特征值**逐位不变** ⇒ 证明 rd16+ 未被读取
    expect(maxAmp5.compute(poisonedCtx)).toBe(maxAmp5.compute(cleanCtx));
    expect(avgAmp5.compute(poisonedCtx)).toBe(avgAmp5.compute(cleanCtx));
  });

  it("④ 逐值一致：与冻结研究的链式前收定义逐值相同（多组随机形状）", () => {
    const shapes: Array<(rd: number) => { high: number; low: number; close: number }> = [
      (rd) => ({ high: 10 + rd * 0.3, low: 10 - rd * 0.1, close: 10 + rd * 0.05 }),
      (rd) => ({ high: 20 - rd * 0.4, low: 19 - rd * 0.4, close: 19.5 - rd * 0.4 }),
      (rd) => ({ high: 11, low: 9, close: 10 }),
    ];
    for (const shape of shapes) {
      const bars: VisibleBar[] = [EVENT_BAR];
      for (let rd = 1; rd <= 15; rd += 1) {
        const s = shape(rd);
        bars.push(barAt(rd, s.high, s.low, s.close));
      }
      const ctx = context(bars, EVENT_BAR);
      const amps = expectedAmplitudes(bars, EVENT_CLOSE).slice(10);
      expect(maxAmp5.compute(ctx)).toBeCloseTo(Math.max(...amps), 12);
      expect(avgAmp5.compute(ctx)).toBeCloseTo(amps.reduce((x, y) => x + y, 0) / amps.length, 12);
    }
  });

  it("数据不完整 / 非法 ⇒ null（不臆造）", () => {
    const bars = chainBars(15);
    // 事件日缺失
    expect(maxAmp5.compute(context(bars, null))).toBeNull();
    expect(avgAmp5.compute(context(bars, null))).toBeNull();
    // 事件日收盘非正
    expect(maxAmp5.compute(context(bars, { ...EVENT_BAR, close: 0 }))).toBeNull();
    // 窗口中间某根 high 缺失
    const missing = chainBars(15, { 13: { high: null } });
    expect(maxAmp5.compute(context(missing, EVENT_BAR))).toBeNull();
    expect(avgAmp5.compute(context(missing, EVENT_BAR))).toBeNull();
    // 窗口中间某根整体缺失（只有 14 根 post bar）⇒ 不足 5 个振幅
    const gapped = chainBars(15).filter((bar) => bar.relativeDay !== 12);
    expect(maxAmp5.compute(context(gapped, EVENT_BAR))).toBeNull();
    expect(avgAmp5.compute(context(gapped, EVENT_BAR))).toBeNull();
    // 无可见 bar
    expect(maxAmp5.compute(context([], EVENT_BAR))).toBeNull();
  });

  it("不修改既有 rd1~5 特征定义：observation* 仍为 rd1~5；rollingMaxAmplitude 仍封顶 rd5", () => {
    const [obsMean, obsMax] = makeObservationWindowFeatures();
    const [rolling] = makeRollingObservationWindowFeatures();
    // 定义层：仍各自使用原有的 lookback / leakage（-4），未被我方改动
    expect(obsMean.lookback).toBe(5);
    expect(obsMax.lookback).toBe(5);
    expect(obsMean.leakage.dataThroughRelativeDay).toBe(-4);
    expect(obsMax.leakage.dataThroughRelativeDay).toBe(-4);
    expect(rolling.leakage.dataThroughRelativeDay).toBe(0);
    expect(rolling.historyMode).toBeUndefined();

    // 行为层：rd1~5 的振幅窗口不因 rd11~15 的极端值而改变
    const bars = chainBars(25, { 11: { high: 1000, low: 1 }, 15: { high: 1000, low: 1 } });
    const ctx = context(bars, EVENT_BAR);
    const first5 = expectedAmplitudes(bars, EVENT_CLOSE).slice(0, 5);
    expect(obsMax.compute(ctx)).toBeCloseTo(Math.max(...first5), 12);
    // rollingMaxAmplitude 亦只吃 rd1~5 ⇒ 不受 rd11/rd15 极值影响
    expect(rolling.compute(ctx)).toBeCloseTo(Math.max(...expectedAmplitudes(bars.slice(0, 6), EVENT_CLOSE)), 12);
    expect(rolling.compute(ctx)).toBeLessThan(1);
  });

  it("默认注册表中的这两个特征与工厂产出一致（无第二份语义）", () => {
    const registry = getDefaultFeatureRegistry();
    const registered = byId(registry.list(), "maxAmp5");
    expect(registered.description).toBe(maxAmp5.description);
    expect(registered.leakage).toEqual(maxAmp5.leakage);
    const bars = chainBars(15);
    expect(registered.compute(context(bars, EVENT_BAR))).toBe(maxAmp5.compute(context(bars, EVENT_BAR)));
  });
});
