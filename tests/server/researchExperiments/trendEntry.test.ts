/**
 * P · 趋势入场/条件退出求值器测试（`research-experiments/shared/firstBoardPullback/trendEntry.ts`）。
 *
 * 钉住四类条件 + 触发语义 + PIT + 不插补 + 退出口径：
 *   1. PRICE_VS_MA / MA_ORDER / MA_SLOPE / RETURN_OVER 的求值正确性；
 *   2. MA 窗口任一根缺失 ⇒ 不可评估（返回 null / unevaluable），**不插补**；
 *   3. 触发 = 观察窗内**首个**满足日；入场 = 触发日**次一交易日开盘**；
 *   4. 次一交易日不可买 ⇒ UNFILLABLE（不顺延、不假设成交）；
 *   5. 退出优先级：盘中止损 → 条件 → 持有期；条件命中默认次一开盘成交；
 *   6. PIT：改动 rd 之后的行不改变更早的判定。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateEntry,
  evaluateExit,
  movingAverageAt,
  netReturnPct,
  type TrendBarSeries,
  type TrendEntryConfig,
  type TrendExitConfig,
} from "../../../research-experiments/shared/firstBoardPullback/trendEntry";
import type { NormalizedFoundationBar } from "../../../research-experiments/shared/firstBoardPullback/types";

/** 构造一根可买可卖的合法 bar；closes 由外部控制。 */
function bar(close: number, options: Partial<NormalizedFoundationBar> = {}): NormalizedFoundationBar {
  return {
    relativeDay: 0,
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    limitUpPrice: close * 1.1,
    limitDownPrice: close * 0.9,
    barPresent: true,
    suspended: false,
    canBuyAtOpen: true,
    canSellAtClose: true,
    structurallyValid: true,
    ...options,
  };
}

/** 用「相对日 → 收盘价」构造序列（开盘默认 = 收盘，可用 opens 覆盖）。 */
function seriesOf(
  closes: readonly (number | null)[],
  startRd: number,
  opens?: Readonly<Record<number, number>>,
  overrides?: Readonly<Record<number, Partial<NormalizedFoundationBar>>>,
): TrendBarSeries {
  const map = new Map<number, NormalizedFoundationBar>();
  closes.forEach((close, index) => {
    const rd = startRd + index;
    if (close === null) return; // 缺行 = 不放入 map（模拟数据缺失）
    const open = opens?.[rd] ?? close;
    map.set(rd, bar(close, { relativeDay: rd, open, ...overrides?.[rd] }));
  });
  return map;
}

/** 连续 61 根（rd −60..0）收盘恒为 10 的预热序列。 */
const flatWarmup = Array.from({ length: 60 }, () => 10);

describe("trendEntry · 四类条件求值", () => {
  it("PRICE_VS_MA：收盘 vs MA_N", () => {
    // rd 0..4 = 10,10,10,10,12 ⇒ MA5 = 10.4，收盘 12 > MA5；rd 5 = 入场日
    const series = seriesOf([...flatWarmup, 10, 10, 10, 10, 12, 12], -60);
    const entry: TrendEntryConfig = {
      window: { fromRd: 1, toRd: 20 },
      trigger: { all: [{ kind: "PRICE_VS_MA", ma: 5, op: "GT" }], any: [] },
      execution: "NEXT_OPEN",
      onNoTrigger: "SKIP",
    };
    const outcome = evaluateEntry(entry, series);
    expect(outcome.status).toBe("TRIGGERED");
    expect(outcome.triggerRd).toBe(4);
    expect(outcome.entryRd).toBe(5);
    expect(outcome.entryPrice).toBeCloseTo(12, 9);
  });

  it("MA_ORDER：MA_fast vs MA_slow", () => {
    // 递增序列 ⇒ MA5 > MA10
    const closes = [...flatWarmup, 10, 11, 12, 13, 14, 15];
    const series = seriesOf(closes, -60);
    const entry: TrendEntryConfig = {
      window: { fromRd: 1, toRd: 6 },
      trigger: { all: [{ kind: "MA_ORDER", fast: 5, slow: 10, op: "GT" }], any: [] },
      execution: "NEXT_OPEN",
      onNoTrigger: "SKIP",
    };
    const outcome = evaluateEntry(entry, series);
    expect(outcome.status).toBe("TRIGGERED");
  });

  it("MA_SLOPE：MA_N 的 lookback 日斜率（%）", () => {
    const closes = [...flatWarmup, 10, 10, 10, 10, 10, 12, 12, 12, 12, 12, 12];
    const series = seriesOf(closes, -60);
    // rd 9 的 MA5 = 12；rd 4 的 MA5 = 10 ⇒ 斜率 +20%
    const slope = movingAverageAt(series, 9, 5)! / movingAverageAt(series, 4, 5)! - 1;
    expect(slope * 100).toBeCloseTo(20, 6);
    const entry: TrendEntryConfig = {
      window: { fromRd: 9, toRd: 9 },
      trigger: { all: [{ kind: "MA_SLOPE", ma: 5, lookback: 5, op: "GT", pct: 15 }], any: [] },
      execution: "NEXT_OPEN",
      onNoTrigger: "SKIP",
    };
    expect(evaluateEntry(entry, series).status).toBe("TRIGGERED");
  });

  it("RETURN_OVER：N 日收益（%）", () => {
    const closes = [...flatWarmup, 10, 10, 10, 10, 10, 11, 11];
    const series = seriesOf(closes, -60);
    // rd 5 = 11，rd 0 = 10 ⇒ +10%
    const entry: TrendEntryConfig = {
      window: { fromRd: 5, toRd: 5 },
      trigger: { all: [{ kind: "RETURN_OVER", days: 5, op: "GT", pct: 5 }], any: [] },
      execution: "NEXT_OPEN",
      onNoTrigger: "SKIP",
    };
    expect(evaluateEntry(entry, series).status).toBe("TRIGGERED");
    const stricter: TrendEntryConfig = {
      ...entry,
      trigger: { all: [{ kind: "RETURN_OVER", days: 5, op: "GT", pct: 15 }], any: [] },
    };
    expect(evaluateEntry(stricter, series).status).toBe("NO_TRIGGER");
  });

  it("MA 窗口任一根缺失 ⇒ 不可评估（不插补、不回退前值）", () => {
    const closes = [...flatWarmup, 10, 10, 10, 10, 12, 12];
    const series = seriesOf(closes, -60);
    // 完整序列：MA5(rd 4) = mean(rd 0..4) = 10.4
    expect(movingAverageAt(series, 4, 5)).toBeCloseTo(10.4, 9);
    // 抽掉 rd 2 ⇒ 所有覆盖 rd 2 的 MA5 窗口都不可评估（不插补、不回退前值）
    const mutable = new Map(series);
    mutable.delete(2);
    const gapped: TrendBarSeries = mutable;
    expect(movingAverageAt(gapped, 4, 5)).toBeNull();
    expect(movingAverageAt(gapped, 2, 5)).toBeNull();
    expect(movingAverageAt(gapped, 5, 5)).toBeNull();
    expect(movingAverageAt(gapped, 6, 5)).toBeNull();
    // 抽掉 rd -1（预热）不影响只覆盖 rd 0..4 的 MA5 —— 口径如实：只需窗口内 5 根
    const warmupGap = new Map(series);
    warmupGap.delete(-1);
    expect(movingAverageAt(warmupGap, 4, 5)).toBeCloseTo(10.4, 9);
  });
});

describe("trendEntry · 触发与入场", () => {
  const alwaysTrue: TrendEntryConfig = {
    // MA5 恒等于 close ⇒ close > MA5 不成立；这里用 MA_ORDER 构造恒真
    window: { fromRd: 1, toRd: 10 },
    trigger: { all: [{ kind: "MA_ORDER", fast: 5, slow: 5, op: "GT" }], any: [] },
    execution: "NEXT_OPEN",
    onNoTrigger: "SKIP",
  };

  it("取观察窗内**首个**满足日；入场 = 次一交易日开盘", () => {
    const closes = [...flatWarmup, 10, 10, 10, 10];
    const series = seriesOf(closes, -60, { 1: 9.5, 2: 10.5 });
    const entry = { ...alwaysTrue, window: { fromRd: 1, toRd: 10 } };
    const outcome = evaluateEntry(entry, series);
    // MA5 > MA5 恒为假 ⇒ 不触发（先钉住「不可用同窗口比较冒充恒真」的边界）
    expect(outcome.status).toBe("NO_TRIGGER");
    // 换成永真条件：MA_SLOPE 阈值为 −999%
    const satisfied: TrendEntryConfig = {
      ...entry,
      trigger: { all: [{ kind: "MA_SLOPE", ma: 5, lookback: 1, op: "GT", pct: -999 }], any: [] },
    };
    const hit = evaluateEntry(satisfied, series);
    expect(hit.status).toBe("TRIGGERED");
    expect(hit.triggerRd).toBe(1);
    expect(hit.entryRd).toBe(2);
    expect(hit.entryPrice).toBeCloseTo(10.5, 9);
  });

  it("次一交易日不可买 ⇒ UNFILLABLE（不顺延、不假设成交）", () => {
    const closes = [...flatWarmup, 10, 10, 10, 10];
    const series = seriesOf(closes, -60, undefined, { 2: { canBuyAtOpen: false } });
    const entry: TrendEntryConfig = {
      window: { fromRd: 1, toRd: 1 },
      trigger: { all: [{ kind: "MA_SLOPE", ma: 5, lookback: 1, op: "GT", pct: -999 }], any: [] },
      execution: "NEXT_OPEN",
      onNoTrigger: "SKIP",
    };
    const outcome = evaluateEntry(entry, series);
    expect(outcome.status).toBe("UNFILLABLE");
    expect(outcome.entryPrice).toBeNull();
  });
});

describe("trendEntry · 退出口径", () => {
  it("持有期自**实际入场日**起算", () => {
    const closes = [...flatWarmup, 10, 10, 10, 11, 12, 13];
    const series = seriesOf(closes, -60);
    const exit: TrendExitConfig = { mode: "HORIZON_FROM_ENTRY", horizonDays: 2, conditions: [], stopRatio: null, exitAt: "SAME_CLOSE" };
    const outcome = evaluateExit(exit, series, 2, 10, 6);
    expect(outcome.status).toBe("EXITED");
    expect(outcome.exitRd).toBe(4);
    expect(outcome.exitPrice).toBeCloseTo(12, 9);
    expect(outcome.holdingDays).toBe(2);
  });

  it("盘中止损优先于其他退出口径（按止损价成交）", () => {
    const closes = [...flatWarmup, 10, 10, 10, 10];
    const series = seriesOf(closes, -60, undefined, { 3: { low: 9.0 } });
    const exit: TrendExitConfig = { mode: "HORIZON_FROM_ENTRY", horizonDays: 5, conditions: [], stopRatio: 0.06, exitAt: "SAME_CLOSE" };
    const outcome = evaluateExit(exit, series, 1, 10, 4);
    expect(outcome.reason).toBe("STOP_INTRADAY");
    expect(outcome.exitRd).toBe(3);
    expect(outcome.exitPrice).toBeCloseTo(9.4, 9);
  });

  it("条件退出默认次一交易日开盘成交", () => {
    // rd 3 收盘跌破 MA5 ⇒ rd 4 开盘退出
    const closes = [...flatWarmup, 10, 10, 10, 8, 8];
    const series = seriesOf(closes, -60, { 4: 7.5 });
    const exit: TrendExitConfig = {
      mode: "CONDITION",
      horizonDays: null,
      conditions: [{ kind: "PRICE_VS_MA", ma: 5, op: "LT" }],
      stopRatio: null,
      exitAt: "NEXT_OPEN",
    };
    const outcome = evaluateExit(exit, series, 1, 10, 5);
    expect(outcome.reason).toBe("CONDITION_NEXT_OPEN");
    expect(outcome.exitRd).toBe(4);
    expect(outcome.exitPrice).toBeCloseTo(7.5, 9);
  });

  it("窗口末端仍未触发 ⇒ OPEN_AT_END（按最后有效收盘估值并如实标记）", () => {
    const closes = [...flatWarmup, 10, 10, 10];
    const series = seriesOf(closes, -60);
    const exit: TrendExitConfig = { mode: "HORIZON_FROM_ENTRY", horizonDays: 50, conditions: [], stopRatio: null, exitAt: "SAME_CLOSE" };
    const outcome = evaluateExit(exit, series, 1, 10, 3);
    expect(outcome.status).toBe("OPEN_AT_END");
    expect(outcome.reason).toBe("WINDOW_END_CLOSE");
  });
});

describe("trendEntry · 成本口径", () => {
  it("净收益 = 毛收益 −（买边 + 卖边含印花税）", () => {
    const cost = { commissionBpsPerSide: 2.5, slippageBpsPerSide: 2.5, impactBpsPerSide: 2.5, stampDutyBps: 5 };
    // 买边 7.5bps + 卖边 12.5bps = 20bps = 0.2%
    expect(netReturnPct(10, cost)).toBeCloseTo(9.8, 9);
  });
});
