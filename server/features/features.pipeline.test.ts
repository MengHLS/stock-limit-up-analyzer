/**
 * STEP 5 — Feature Pipeline 破坏性测试：
 *   Future Leakage（未来数据修改 / 删除）、Decision Time、Determinism、Instance Isolation、
 *   Warm-up 语义、Registry 约束。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../data";
import { MarketBarSeries, visibleBars } from "../data";
import { FeatureRegistry, registerBasicFeatures, runFeaturePipeline } from "./index";

/** 构造一根主板股票的 canonical bar（默认价格围绕 10 元小幅波动）。 */
function bar(timestamp: string, overrides: Partial<CanonicalMarketBar> = {}): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp,
    open: 10,
    high: 10.4,
    low: 9.8,
    close: 10.1,
    preClose: 10,
    volume: 100_000,
    amount: 120_000,
    turnoverRate: null,
    adjustment: "raw",
    ...overrides,
  };
}

/** 连续的 7 个自然日（2026-01-05 周一 … 2026-01-11 周日）。 */
const DAYS = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"];

function barsOf(days: string[]): CanonicalMarketBar[] {
  return days.map((day, index) => bar(day, { close: 10 + index * 0.1, amount: 120_000 + index * 1_000, volume: 100_000 + index * 100 }));
}

const ALL_FEATURES = [
  { id: "sma", params: { period: 3 } },
  { id: "return", params: { period: 3 } },
  { id: "avgAmount", params: { period: 3 } },
  { id: "avgVolume", params: { period: 3 } },
  { id: "volatility", params: { period: 3 } },
  { id: "amplitude" },
  { id: "limitUpHit" },
];

function snapshotJson(bars: CanonicalMarketBar[], decisionDate: string, point: "close" | "open") {
  return JSON.stringify(
    runFeaturePipeline({
      symbol: "600001.SH",
      bars,
      decisionDate,
      decisionPoint: point,
      features: ALL_FEATURES,
    }),
  );
}

describe("Future Leakage — 破坏性测试", () => {
  it("Feature(T)：修改 T+1/T+2 的 close/high/low/volume/amount 后结果完全一致", () => {
    // decisionDate = 01-07（T）。future = 01-08/09/10/11（T+1..T+4）。
    const original = barsOf(DAYS.slice(0, 7));
    const baseline = snapshotJson(original, DAYS[2], "close");

    const mutated = original.map((b, index) => (index >= 3
      ? { ...b, close: b.close! * 3, high: b.high! * 3, low: b.low! * 0.3, volume: b.volume! * 7, amount: b.amount! * 9 }
      : b));
    expect(snapshotJson(mutated, DAYS[2], "close")).toBe(baseline);
  });

  it("Feature(T)：删除 T+1 及全部未来数据后重新计算，结果与原结果一致", () => {
    const original = barsOf(DAYS.slice(0, 7));
    const baseline = snapshotJson(original, DAYS[2], "close");

    const withoutFuture = barsOf(DAYS.slice(0, 3)); // 只有 T-2..T
    expect(snapshotJson(withoutFuture, DAYS[2], "close")).toBe(baseline);
  });

  it("单个 feature（sma/return/avgAmount/volatility/limitUpHit）同样不受未来数据影响", () => {
    const original = barsOf(DAYS.slice(0, 7));
    const run = (bars: CanonicalMarketBar[]) => JSON.stringify(
      runFeaturePipeline({ symbol: "600001.SH", bars, decisionDate: DAYS[2], decisionPoint: "close", features: ALL_FEATURES }),
    );
    const mutated = original.map((b, index) => (index >= 3 ? { ...b, close: 999, high: 999, low: 0.1, amount: 999999, volume: 999999 } : b));
    expect(run(mutated)).toBe(run(original));
  });
});

describe("Decision Time — asOf / Availability", () => {
  it("T 开盘决策看不到 T 的 high/low/close/volume/amount：可见序列以 T-1 截止", () => {
    const extremeDay = bar(DAYS[3], { open: 100, high: 150, low: 90, close: 140, volume: 999_999, amount: 888_888 });
    const bars = [...barsOf(DAYS.slice(0, 3)), extremeDay];
    // decisionDate = 01-08 开盘：仅可见 01-05..01-07
    const visible = visibleBars(bars, DAYS[3], "open");
    expect(visible.map((b) => b.timestamp)).toEqual(DAYS.slice(0, 3));
    expect(visible.some((b) => b.timestamp === DAYS[3])).toBe(false);
  });

  it("T 开盘决策：sma3 值等于截至 T-1 收盘的 sma3（T 当日信息不影响）", () => {
    const bars = [...barsOf(DAYS.slice(0, 4))]; // 01-05..01-08
    const smaAtOpenT = runFeaturePipeline({
      symbol: "600001.SH", bars, decisionDate: DAYS[3], decisionPoint: "open",
      features: [{ id: "sma", params: { period: 3 } }],
    }).features.sma;
    const smaAtClosePrev = runFeaturePipeline({
      symbol: "600001.SH", bars, decisionDate: DAYS[2], decisionPoint: "close",
      features: [{ id: "sma", params: { period: 3 } }],
    }).features.sma;
    expect(smaAtOpenT.status).toBe("READY");
    expect(smaAtOpenT.value).toBeCloseTo(smaAtClosePrev.value!, 10);
  });

  it("T 开盘决策：把 T 的 close 改到天价不影响以 open 决策的快照", () => {
    const base = [...barsOf(DAYS.slice(0, 4))];
    const runOpen = (bars: CanonicalMarketBar[]) => snapshotJson(bars, DAYS[3], "open");
    const before = runOpen(base);
    const mutated = base.map((b, index) => (index === 3 ? { ...b, close: 9999, high: 9999, amount: 1 } : b));
    expect(runOpen(mutated)).toBe(before);
  });
});

describe("Determinism / Isolation / Warm-up / Registry", () => {
  it("Determinism：相同输入运行 100 次结果完全一致", () => {
    const bars = barsOf(DAYS);
    const first = snapshotJson(bars, DAYS[4], "close");
    for (let i = 0; i < 100; i += 1) {
      expect(snapshotJson(bars, DAYS[4], "close")).toBe(first);
    }
  });

  it("Instance Isolation：period=20 与 period=60 实例互不影响，无共享可变状态", () => {
    const bars = barsOf(DAYS);
    const registry = new FeatureRegistry();
    registerBasicFeatures(registry);
    const instA = registry.get("sma").create({ period: 20 });
    const instB = registry.get("sma").create({ period: 60 });
    const series = new MarketBarSeries("600001.SH", bars);
    // 先跑 A（20 期，数据不足）
    const ra = instA.calculate({ symbol: "600001.SH", stockName: null, series, decisionDate: DAYS[4], decisionPoint: "close" });
    expect(ra.status).toBe("INSUFFICIENT_DATA");
    // B 的参数与 A 互不影响
    expect(instB.params.period).toBe(60);
    expect(instA.params.period).toBe(20);
    expect(instB.requiredBars).toBe(60);
    expect(instA.requiredBars).toBe(20);
  });

  it("Warm-up：数据不足 → INSUFFICIENT_DATA（requiredBars 与 availableBars 明确）", () => {
    const fewBars = barsOf(DAYS.slice(0, 3)); // 3 根
    const result = runFeaturePipeline({
      symbol: "600001.SH", bars: fewBars, decisionDate: DAYS[2], decisionPoint: "close",
      features: [{ id: "sma", params: { period: 20 } }],
    });
    const sma = result.features.sma!;
    expect(sma.status).toBe("INSUFFICIENT_DATA");
    expect(sma.requiredBars).toBe(20);
    expect(sma.availableBars).toBe(3);
    expect(sma.value).toBeNull();
  });

  it("INVALID_DATA：窗口内字段缺失不静默跳过", () => {
    const withHole = [bar(DAYS[0]), bar(DAYS[1], { close: null }), bar(DAYS[2])];
    const result = runFeaturePipeline({
      symbol: "600001.SH", bars: withHole, decisionDate: DAYS[2], decisionPoint: "close",
      features: [{ id: "sma", params: { period: 3 } }],
    });
    expect(result.features.sma!.status).toBe("INVALID_DATA");
  });

  it("Registry：重复注册抛错、未知 id 抛错、幂等注册可重复调用", () => {
    const registry = new FeatureRegistry();
    registerBasicFeatures(registry);
    expect(() => registerBasicFeatures(registry)).not.toThrow(); // 幂等
    expect(() => registry.register(registry.get("sma"))).toThrow(/重复注册/);
    expect(() => registry.get("not-exist")).toThrow(/未注册/);
    expect(() => registry.get("sma")).not.toThrow();
  });
});
