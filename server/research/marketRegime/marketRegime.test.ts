/**
 * STEP 22 / C-22.1 — Market Regime 体系单测。
 *
 * 覆盖：
 *   ① 七维分类正确性（手算：趋势/波动/流动性/宽度/情绪/指数状态/涨停环境）；
 *   ② PIT 无泄漏（截断未来数据标签不变、asOf 缺失响亮抛错、窗口前向/冻结快照拒绝）；
 *   ③ 窗口边界（恰好 N 日 → 评估；N−1 日 → unassessed INSUFFICIENT_HISTORY）；
 *   ④ 数据不足 / 数据缺失语义（各 reasonCode，绝不默认中性）；
 *   ⑤ 复合状态拼装（含 NA:<reasonCode> 显式编码）；
 *   ⑥ 归因聚合正确性（手算复利/胜率/分组占比/未匹配计数）；
 *   ⑦ 适配接口（C-16.3 segments / C-13.3 lineage regime，含回落 unassessed）；
 *   ⑧ 记录 round-trip + 篡改拒绝 + 指纹确定性 + 配置非法响亮拒绝；
 *   ⑨ facts 构建（涨停规则复用 boardRules：主板 10% / 创业板 20% / ST 5%）+ dataset 行适配。
 */

import { describe, expect, it } from "vitest";
import type { ResearchDatasetRow } from "../../researchDataset/types";
import { REGIME_UNASSESSED_REASON_CODE } from "../experimentLineage/types";
import type { ExperimentLineageRegime } from "../experimentLineage/types";
import {
  MARKET_REGIME_DEFAULT_CONFIGS,
  MARKET_REGIME_RUN_RECORD_KIND,
  RegimeAnalysisError,
  aggregateRegimeAttribution,
  assertRegimeIsoDate,
  assertRegimeWindowPit,
  buildRegimeCompositeState,
  buildRegimeContiguousSegments,
  buildRegimeDayFacts,
  buildRegimeDayFactsFromDatasetRows,
  buildRegimeLookbackWindow,
  buildTradeQualityRegimePerformance,
  classifyRegimeBreadth,
  classifyRegimeIndexState,
  classifyRegimeLimitUpEnv,
  classifyRegimeLiquidity,
  classifyRegimeSentiment,
  classifyRegimeTrend,
  classifyRegimeVolatility,
  computeRegimeDayTags,
  computeRegimeUnassessedStats,
  deserializeMarketRegimeRun,
  dominantRegimeCompositeKey,
  regimeCalendarDaysBetween,
  regimeDateOrdinal,
  regimeSecuritySnapshotFromDatasetRow,
  resolveRegimeConfigSet,
  runMarketRegimeAnalysis,
  serializeMarketRegimeRun,
  toExperimentLineageRegime,
  toExperimentLineageRegimeFromRun,
  validateMarketRegimeRun,
} from "./index";
import type {
  MarketRegimeRun,
  RegimeDayFacts,
  RegimeDayTags,
  RegimeDimensionTag,
  RegimePerformanceSample,
  RegimeSentimentFacts,
  ResolvedRegimeConfigSet,
} from "./types";

// ---------------------------------------------------------------------------
// fixture 工具（测试专用；生产代码不依赖 Date）
// ---------------------------------------------------------------------------

const BENCH = "000300.SH";

/** 观测用：取已评估标签的 label（unassessed 时抛错，避免测试里出现假通过）。 */
function labelOf(tag: RegimeDimensionTag<string>): string {
  if (tag.kind !== "assessed") {
    throw new Error(`期望已评估标签，实际 unassessed（${tag.reasonCode}）: ${tag.reason}`);
  }
  return tag.label;
}

/** 测试内独立实现的样本标准差（防止与被测代码共用实现造成自证）。 */
function sampleStd(values: readonly number[]): number {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  );
}

/** 由日收益序列（%）反推收盘价序列（起点 100），便于构造精确收益。 */
function closesFromReturns(returns: readonly number[], start = 100): number[] {
  const closes: number[] = [start];
  for (const value of returns) {
    closes.push(closes[closes.length - 1]! * (1 + value / 100));
  }
  return closes;
}

function isoDateAfter(start: string, offset: number): string {
  const [year, month, day] = start.split("-").map(Number);
  const base = Date.UTC(year!, month! - 1, day!);
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

function makeDates(count: number, start = "2024-01-02"): string[] {
  return Array.from({ length: count }, (_, index) => isoDateAfter(start, index));
}

interface DaySpec {
  /** 基准收盘（简写；与 indexCloses 二选一）。 */
  readonly close?: number;
  readonly indexCloses?: Readonly<Record<string, number>>;
  readonly advancing?: number;
  readonly declining?: number;
  readonly unchanged?: number;
  readonly limitUp?: number;
  readonly limitDown?: number;
  readonly classifiable?: number;
  readonly amount?: number | null;
  readonly turnoverRate?: number | null;
  readonly sentiment?: RegimeSentimentFacts | null;
}

function makeDay(tradeDate: string, spec: DaySpec = {}): RegimeDayFacts {
  const indexCloses =
    spec.indexCloses ?? (spec.close === undefined ? {} : { [BENCH]: spec.close });
  const advancing = spec.advancing ?? 0;
  const declining = spec.declining ?? 0;
  const unchanged = spec.unchanged ?? 0;
  return {
    tradeDate,
    asOf: tradeDate,
    indexCloses,
    sampleSize: advancing + declining + unchanged,
    advancingCount: advancing,
    decliningCount: declining,
    unchangedCount: unchanged,
    limitUpCount: spec.limitUp ?? 0,
    limitDownCount: spec.limitDown ?? 0,
    limitClassifiableCount: spec.classifiable ?? 0,
    totalAmount: spec.amount === undefined ? 1000 : spec.amount,
    meanTurnoverRate: spec.turnoverRate === undefined ? 1 : spec.turnoverRate,
    sentiment: spec.sentiment ?? null,
  };
}

/** 线性收盘序列（step > 0 上涨 / step < 0 下跌 / 0 持平）。 */
function rampSeries(count: number, step: number, start = 100): RegimeDayFacts[] {
  return makeDates(count).map((date, index) => makeDay(date, { close: start + index * step }));
}

const smallConfigs = (): ResolvedRegimeConfigSet =>
  resolveRegimeConfigSet({
    trend: { lookbackTradingDays: 5 },
    volatility: { lookbackTradingDays: 6, minSampleSize: 5 },
    liquidity: { lookbackTradingDays: 5 },
    breadth: { lookbackTradingDays: 3 },
    sentiment: { lookbackTradingDays: 3 },
    indexState: { lookbackTradingDays: 5 },
    limitUpEnv: { lookbackTradingDays: 3 },
  });

// ---------------------------------------------------------------------------
// ① 七维分类正确性（手算）
// ---------------------------------------------------------------------------

describe("C-22.1 七维分类正确性（手算）", () => {
  it("Trend：窗口收益 +9.5% → up（20 日回看，100 → 109.5）", () => {
    const series = rampSeries(25, 0.5);
    const asOf = series[19]!.tradeDate;
    const tag = classifyRegimeTrend(series, asOf, MARKET_REGIME_DEFAULT_CONFIGS.trend, BENCH);
    expect(labelOf(tag)).toBe("up");
    if (tag.kind === "assessed") {
      expect(tag.metrics.windowReturnPct).toBeCloseTo(9.5, 6);
      expect(tag.sampleSize).toBe(20);
      expect(tag.lookbackWindow.startDate).toBe(series[0]!.tradeDate);
      expect(tag.lookbackWindow.endDate).toBe(asOf);
    }
  });

  it("Trend：−9.5% → down；0% → sideways", () => {
    const down = rampSeries(25, -0.5);
    expect(
      labelOf(classifyRegimeTrend(down, down[19]!.tradeDate, MARKET_REGIME_DEFAULT_CONFIGS.trend, BENCH)),
    ).toBe("down");
    const flat = rampSeries(25, 0);
    expect(
      labelOf(classifyRegimeTrend(flat, flat[19]!.tradeDate, MARKET_REGIME_DEFAULT_CONFIGS.trend, BENCH)),
    ).toBe("sideways");
  });

  it("Volatility：交替 ±2% 日收益 → 年化约 32.5% → high", () => {
    const closes = closesFromReturns([1, -1.980198, 2.020202, -1.980198, 2.020202]);
    const series = makeDates(closes.length).map((date, index) =>
      makeDay(date, { close: closes[index]! }),
    );
    const tag = classifyRegimeVolatility(
      series,
      series[5]!.tradeDate,
      resolveRegimeConfigSet({
        volatility: { lookbackTradingDays: 6, minSampleSize: 5 },
      }).volatility,
      BENCH,
    );
    expect(labelOf(tag)).toBe("high");
    if (tag.kind === "assessed") {
      const returns = [1, -1.980198, 2.020202, -1.980198, 2.020202];
      expect(tag.metrics.dailyStdPct!).toBeCloseTo(sampleStd(returns), 8);
      expect(tag.metrics.annualizedVolPct!).toBeCloseTo(
        sampleStd(returns) * Math.sqrt(252),
        8,
      );
      expect(tag.metrics.annualizedVolPct!).toBeGreaterThan(30);
      expect(tag.sampleSize).toBe(5);
    }
  });

  it("Volatility：微幅震荡 → low；±1.2% 震荡 → mid", () => {
    const lowCloses = closesFromReturns([0.01, -0.009999, 0.01, -0.009999, 0.01]);
    const lowSeries = makeDates(lowCloses.length).map((date, index) =>
      makeDay(date, { close: lowCloses[index]! }),
    );
    const lowTag = classifyRegimeVolatility(
      lowSeries,
      lowSeries[5]!.tradeDate,
      smallConfigs().volatility,
      BENCH,
    );
    expect(labelOf(lowTag)).toBe("low");

    const midCloses = closesFromReturns([1.2, -1.2, 1.2, -1.2, 1.2]);
    const midSeries = makeDates(midCloses.length).map((date, index) =>
      makeDay(date, { close: midCloses[index]! }),
    );
    const midTag = classifyRegimeVolatility(
      midSeries,
      midSeries[5]!.tradeDate,
      smallConfigs().volatility,
      BENCH,
    );
    expect(labelOf(midTag)).toBe("mid");
    if (midTag.kind === "assessed") {
      expect(midTag.metrics.annualizedVolPct!).toBeGreaterThan(15);
      expect(midTag.metrics.annualizedVolPct!).toBeLessThan(30);
    }
  });

  it("Liquidity：当日/窗口均值 = 1500/1025 ≈ 1.4634 → high；0.71 → low；1.0 → mid", () => {
    const dates = makeDates(20);
    const highSeries = dates.map((date, index) =>
      makeDay(date, { amount: index === 19 ? 1500 : 1000 }),
    );
    const highTag = classifyRegimeLiquidity(
      highSeries,
      highSeries[19]!.tradeDate,
      resolveRegimeConfigSet({ liquidity: { lookbackTradingDays: 20 } }).liquidity,
    );
    expect(labelOf(highTag)).toBe("high");
    if (highTag.kind === "assessed") {
      expect(highTag.metrics.windowMeanValue!).toBeCloseTo(1025, 6);
      expect(highTag.metrics.relativeRatio!).toBeCloseTo(1500 / 1025, 8);
    }

    const lowSeries = dates.map((date, index) =>
      makeDay(date, { amount: index === 19 ? 700 : 1000 }),
    );
    expect(
      labelOf(
        classifyRegimeLiquidity(
          lowSeries,
          lowSeries[19]!.tradeDate,
          resolveRegimeConfigSet({ liquidity: { lookbackTradingDays: 20 } }).liquidity,
        ),
      ),
    ).toBe("low");

    const midSeries = dates.map((date) => makeDay(date, { amount: 1000 }));
    expect(
      labelOf(
        classifyRegimeLiquidity(
          midSeries,
          midSeries[19]!.tradeDate,
          resolveRegimeConfigSet({ liquidity: { lookbackTradingDays: 20 } }).liquidity,
        ),
      ),
    ).toBe("mid");
  });

  it("Breadth：上涨占比 0.7 → broad；0.3 → narrow；0.5 → mixed", () => {
    const dates = makeDates(5);
    const build = (advancing: number) =>
      dates.map((date) => makeDay(date, { advancing, declining: 100 - advancing }));
    const config = smallConfigs().breadth;
    expect(labelOf(classifyRegimeBreadth(build(70), dates[4]!, config))).toBe("broad");
    expect(labelOf(classifyRegimeBreadth(build(30), dates[4]!, config))).toBe("narrow");
    expect(labelOf(classifyRegimeBreadth(build(50), dates[4]!, config))).toBe("mixed");
  });

  it("Sentiment：涨停60/跌停20 → 净占比 0.5 → risk_on；反向 → risk_off；40/40 → neutral", () => {
    const dates = makeDates(5);
    const config = smallConfigs().sentiment;
    const build = (limitUp: number, limitDown: number) =>
      dates.map((date) => makeDay(date, { sentiment: { limitUpCount: limitUp, limitDownCount: limitDown, maxConsecutiveBoard: 3, brokenBoardCount: 1 } }));
    expect(labelOf(classifyRegimeSentiment(build(60, 20), dates[4]!, config))).toBe("risk_on");
    expect(labelOf(classifyRegimeSentiment(build(20, 60), dates[4]!, config))).toBe("risk_off");
    expect(labelOf(classifyRegimeSentiment(build(40, 40), dates[4]!, config))).toBe("neutral");
  });

  it("IndexState：5 日窗口 102..110（均值 106）→ 偏离 +3.77% → above_ma；持平 → near_ma；下跌 → below_ma", () => {
    const up = rampSeries(6, 2);
    const upTag = classifyRegimeIndexState(up, up[5]!.tradeDate, smallConfigs().indexState, BENCH);
    expect(labelOf(upTag)).toBe("above_ma");
    if (upTag.kind === "assessed") {
      expect(upTag.metrics.movingAverage!).toBeCloseTo(106, 8);
      expect(upTag.metrics.deviationFromMaPct!).toBeCloseTo((110 / 106 - 1) * 100, 8);
    }
    const flat = rampSeries(6, 0);
    expect(
      labelOf(classifyRegimeIndexState(flat, flat[5]!.tradeDate, smallConfigs().indexState, BENCH)),
    ).toBe("near_ma");
    const down = rampSeries(6, -2);
    expect(
      labelOf(classifyRegimeIndexState(down, down[5]!.tradeDate, smallConfigs().indexState, BENCH)),
    ).toBe("below_ma");
  });

  it("LimitUpEnv：涨停占比 3% → hot；0.2% → cold；1% → normal", () => {
    const dates = makeDates(5);
    const config = smallConfigs().limitUpEnv;
    const build = (limitUp: number) =>
      dates.map((date) => makeDay(date, { limitUp, classifiable: 1000 }));
    expect(labelOf(classifyRegimeLimitUpEnv(build(30), dates[4]!, config))).toBe("hot");
    expect(labelOf(classifyRegimeLimitUpEnv(build(2), dates[4]!, config))).toBe("cold");
    expect(labelOf(classifyRegimeLimitUpEnv(build(10), dates[4]!, config))).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// ② PIT 纪律实证（无泄漏）
// ---------------------------------------------------------------------------

describe("C-22.1 PIT 纪律实证", () => {
  it("同一 asOf：截断序列（只含 T 及之前）与完整序列（含未来）标签逐位相同", () => {
    const series = makeDates(40).map((date, index) =>
      makeDay(date, {
        close: 100 + index * 0.3 + (index % 3 === 0 ? 0.5 : 0),
        advancing: 60 + (index % 5),
        declining: 40,
        limitUp: 10 + (index % 7),
        classifiable: 1000,
        amount: 1000 + index * 5,
      }),
    );
    const configs = smallConfigs();
    series.forEach((day, index) => {
      const truncated = series.slice(0, index + 1);
      const fromTruncated = computeRegimeDayTags(truncated, day.tradeDate, configs);
      const fromFull = computeRegimeDayTags(series, day.tradeDate, configs);
      expect(fromTruncated).toEqual(fromFull);
    });
  });

  it("T 日标签在 T−1 日不可得：asOf 不在序列 → 响亮抛错 REGIME_ASOF_NOT_AVAILABLE", () => {
    const series = rampSeries(20, 0.5);
    const futureDate = series[15]!.tradeDate;
    const truncated = series.slice(0, 10);
    expect(() => computeRegimeDayTags(truncated, futureDate, smallConfigs())).toThrow(
      RegimeAnalysisError,
    );
    try {
      computeRegimeDayTags(truncated, futureDate, smallConfigs());
    } catch (error) {
      expect((error as RegimeAnalysisError).code).toBe("REGIME_ASOF_NOT_AVAILABLE");
    }
  });

  it("窗口只回看：endDate === asOf，起点不早于 asOf−(N−1) 个交易日", () => {
    const series = rampSeries(30, 0.2);
    const { window, lookbackWindow } = buildRegimeLookbackWindow(series, series[25]!.tradeDate, 10);
    expect(lookbackWindow.endDate).toBe(series[25]!.tradeDate);
    expect(lookbackWindow.startDate).toBe(series[16]!.tradeDate);
    expect(window).toHaveLength(10);
    expect(window[window.length - 1]!.tradeDate).toBe(series[25]!.tradeDate);
  });

  it("窗口含未来数据 → REGIME_LOOKAHEAD_VIOLATION（防前向窗）", () => {
    const future = makeDay("2030-01-01", { close: 100 });
    expect(() => assertRegimeWindowPit([future], "2024-01-02")).toThrow(RegimeAnalysisError);
    try {
      assertRegimeWindowPit([future], "2024-01-02");
    } catch (error) {
      expect((error as RegimeAnalysisError).code).toBe("REGIME_LOOKAHEAD_VIOLATION");
    }
  });

  it("冻结快照（asOf !== tradeDate）→ REGIME_ASOF_INVARIANT_VIOLATION", () => {
    expect(() =>
      buildRegimeDayFacts({ tradeDate: "2024-01-04", asOf: "2024-01-05", snapshots: [] }),
    ).toThrow(RegimeAnalysisError);
    expect(() => assertRegimeWindowPit([makeDay("2024-01-04")], "2024-01-04")).not.toThrow();
    expect(() =>
      assertRegimeWindowPit(
        [{ ...makeDay("2024-01-04"), asOf: "2024-01-05" }],
        "2024-01-04",
      ),
    ).toThrow(/asOf/);
  });
});

// ---------------------------------------------------------------------------
// ③ 窗口边界 + ④ 数据不足 / 缺失语义
// ---------------------------------------------------------------------------

describe("C-22.1 窗口边界与数据不足语义", () => {
  it("恰好 N 日 → 评估；N−1 日 → unassessed INSUFFICIENT_HISTORY（不降级为中性）", () => {
    const series = rampSeries(25, 0.5);
    const at19 = classifyRegimeTrend(series, series[19]!.tradeDate, MARKET_REGIME_DEFAULT_CONFIGS.trend, BENCH);
    expect(at19.kind).toBe("assessed");
    const at18 = classifyRegimeTrend(series, series[18]!.tradeDate, MARKET_REGIME_DEFAULT_CONFIGS.trend, BENCH);
    expect(at18.kind).toBe("unassessed");
    if (at18.kind === "unassessed") {
      expect(at18.reasonCode).toBe("REGIME_INSUFFICIENT_HISTORY");
      expect(at18.lookbackWindow?.tradingDayCount).toBe(19);
      expect(at18.lookbackWindow?.requiredTradingDayCount).toBe(20);
    }
  });

  it("基准指数缺失 → REGIME_BENCHMARK_MISSING（趋势/波动/指数状态）", () => {
    const series = rampSeries(10, 0.5).map((day) => ({ ...day, indexCloses: {} }));
    const configs = smallConfigs();
    const trend = classifyRegimeTrend(series, series[6]!.tradeDate, configs.trend, BENCH);
    expect(trend.kind).toBe("unassessed");
    if (trend.kind === "unassessed") expect(trend.reasonCode).toBe("REGIME_BENCHMARK_MISSING");
    expect(
      (classifyRegimeVolatility(series, series[6]!.tradeDate, configs.volatility, BENCH) as { reasonCode?: string }).reasonCode,
    ).toBe("REGIME_BENCHMARK_MISSING");
    expect(
      (classifyRegimeIndexState(series, series[6]!.tradeDate, configs.indexState, BENCH) as { reasonCode?: string }).reasonCode,
    ).toBe("REGIME_BENCHMARK_MISSING");
  });

  it("横截面为空 → REGIME_NO_CROSS_SECTION（宽度/涨停环境）", () => {
    const series = makeDates(5).map((date) => makeDay(date, { close: 100 }));
    const configs = smallConfigs();
    const breadth = classifyRegimeBreadth(series, series[4]!.tradeDate, configs.breadth);
    expect(breadth.kind).toBe("unassessed");
    if (breadth.kind === "unassessed") expect(breadth.reasonCode).toBe("REGIME_NO_CROSS_SECTION");
    const limitUp = classifyRegimeLimitUpEnv(series, series[4]!.tradeDate, configs.limitUpEnv);
    if (limitUp.kind === "unassessed") expect(limitUp.reasonCode).toBe("REGIME_NO_CROSS_SECTION");
  });

  it("情绪源缺失（默认关闭代理）→ REGIME_SENTIMENT_SOURCE_MISSING；开启代理后可用涨跌停家数派生", () => {
    const series = makeDates(5).map((date) =>
      makeDay(date, { close: 100, limitUp: 60, limitDown: 20, classifiable: 1000 }),
    );
    const asOf = series[4]!.tradeDate;
    const off = classifyRegimeSentiment(series, asOf, smallConfigs().sentiment);
    expect(off.kind).toBe("unassessed");
    if (off.kind === "unassessed") expect(off.reasonCode).toBe("REGIME_SENTIMENT_SOURCE_MISSING");

    const on = classifyRegimeSentiment(
      series,
      asOf,
      resolveRegimeConfigSet({
        sentiment: { lookbackTradingDays: 3, allowSentimentLimitUpProxy: true },
      }).sentiment,
    );
    expect(labelOf(on)).toBe("risk_on");
  });

  it("情绪代理开启但涨跌停家数恒为 0 → REGIME_DATA_MISSING（不当中性）", () => {
    const series = makeDates(5).map((date) => makeDay(date, { close: 100 }));
    const tag = classifyRegimeSentiment(
      series,
      series[4]!.tradeDate,
      resolveRegimeConfigSet({
        sentiment: { lookbackTradingDays: 3, allowSentimentLimitUpProxy: true },
      }).sentiment,
    );
    expect(tag.kind).toBe("unassessed");
    if (tag.kind === "unassessed") expect(tag.reasonCode).toBe("REGIME_DATA_MISSING");
  });

  it("成交额缺失 → 流动性 REGIME_DATA_MISSING（不退化成 0 成交额）", () => {
    const series = makeDates(5).map((date, index) =>
      makeDay(date, { close: 100, amount: index === 4 ? null : 1000 }),
    );
    const tag = classifyRegimeLiquidity(series, series[4]!.tradeDate, smallConfigs().liquidity);
    expect(tag.kind).toBe("unassessed");
    if (tag.kind === "unassessed") expect(tag.reasonCode).toBe("REGIME_DATA_MISSING");
  });
});

// ---------------------------------------------------------------------------
// ⑤ 复合状态
// ---------------------------------------------------------------------------

describe("C-22.1 复合状态", () => {
  it("七维拼接顺序固定，unassessed 维显式编码为 NA:<reasonCode>", () => {
    const series = makeDates(6).map((date, index) =>
      makeDay(date, {
        close: 100 + index,
        advancing: 70,
        declining: 30,
        limitUp: 30,
        classifiable: 1000,
        amount: 1000,
      }),
    );
    const tags = computeRegimeDayTags(series, series[5]!.tradeDate, smallConfigs());
    expect(tags.composite).not.toBeNull();
    const key = tags.composite!.compositeKey;
    expect(key.split("|")).toHaveLength(7);
    expect(key).toContain("trend=");
    expect(key).toContain("sentiment=NA:REGIME_SENTIMENT_SOURCE_MISSING");
    expect(tags.composite!.unassessedDimensionCount).toBeGreaterThanOrEqual(1);
  });

  it("维度子集裁剪：compositeKey 只含指定维（顺序按子集给出）", () => {
    const series = rampSeries(10, 1);
    const tags = computeRegimeDayTags(series, series[9]!.tradeDate, smallConfigs());
    const subset = buildRegimeCompositeState(tags, { dimensions: ["limitUpEnv", "trend"] });
    expect(subset.dimensionOrder).toEqual(["limitUpEnv", "trend"]);
    expect(subset.compositeKey.split("|")).toHaveLength(2);
    expect(subset.compositeKey.startsWith("limitUpEnv=")).toBe(true);
    expect(subset.assessedDimensionCount + subset.unassessedDimensionCount).toBe(2);
  });

  it("空子集 / 重复维 / 非法维 → 响亮抛错", () => {
    const series = rampSeries(10, 0.5);
    const tags = computeRegimeDayTags(series, series[9]!.tradeDate, smallConfigs());
    expect(() => buildRegimeCompositeState(tags, { dimensions: [] })).toThrow(RegimeAnalysisError);
    expect(() => buildRegimeCompositeState(tags, { dimensions: ["trend", "trend"] })).toThrow(
      RegimeAnalysisError,
    );
    expect(() => buildRegimeCompositeState(tags, { dimensions: ["nope" as never] })).toThrow(
      RegimeAnalysisError,
    );
  });

  it("主导复合状态：并列按字典序取前者（确定性）", () => {
    const first: RegimeDayTags = {
      tradeDate: "2024-01-02",
      asOf: "2024-01-02",
      ...({} as never),
      composite: {
        compositeKey: "breadth=broad",
        dimensionOrder: ["breadth"],
        assessedDimensionCount: 1,
        unassessedDimensionCount: 0,
      },
    } as unknown as RegimeDayTags;
    const second = { ...first, tradeDate: "2024-01-03", asOf: "2024-01-03" } as RegimeDayTags;
    const third = {
      ...first,
      tradeDate: "2024-01-04",
      asOf: "2024-01-04",
      composite: { ...first.composite!, compositeKey: "breadth=narrow" },
    } as RegimeDayTags;
    expect(dominantRegimeCompositeKey([first, second, third])).toBe("breadth=broad");
    // 频数优先：narrow 出现 2 次 > broad 1 次
    expect(dominantRegimeCompositeKey([third, third, first])).toBe("breadth=narrow");
    // 并列（各 1 次）→ 按 compositeKey 字典序取前者
    expect(dominantRegimeCompositeKey([third, first])).toBe("breadth=broad");
    expect(dominantRegimeCompositeKey([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ⑥ 归因聚合
// ---------------------------------------------------------------------------

describe("C-22.1 归因聚合（表现数据注入，本模块不跑回测）", () => {
  function buildSixDayRun(): { run: MarketRegimeRun; dates: string[] } {
    const dates = makeDates(6);
    const series = dates.map((date, index) =>
      makeDay(date, {
        close: 100,
        advancing: index < 3 ? 80 : 20,
        declining: index < 3 ? 20 : 80,
      }),
    );
    const run = runMarketRegimeAnalysis({
      regimeRunId: "REGIME-20240101-000001",
      series,
      configs: { breadth: { lookbackTradingDays: 1 } },
      compositeDimensions: ["breadth"],
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    return { run, dates };
  }

  it("分组复利/均值/胜率/占比手算一致（broad: +1,+2,+3；narrow: −1,−2,−3）", () => {
    const { run, dates } = buildSixDayRun();
    const samples: RegimePerformanceSample[] = dates.map((date, index) => ({
      tradeDate: date,
      returnPct: index < 3 ? index + 1 : -(index - 2),
    }));
    const report = aggregateRegimeAttribution(samples, run.tags, { groupBy: "composite" });
    expect(report.totalSampleCount).toBe(6);
    expect(report.matchedSampleCount).toBe(6);
    expect(report.unmatchedSampleCount).toBe(0);
    expect(report.groups).toHaveLength(2);

    const broad = report.groups.find((group) => group.regimeKey === "breadth=broad")!;
    const narrow = report.groups.find((group) => group.regimeKey === "breadth=narrow")!;
    // 1.01 × 1.02 × 1.03 − 1 = 6.1106%
    expect(broad.cumulativeReturnPct).toBeCloseTo(6.1106, 4);
    expect(broad.meanReturnPct).toBeCloseTo(2, 8);
    expect(broad.winRatePct).toBeCloseTo(100, 8);
    expect(broad.sampleCount).toBe(3);
    expect(broad.shareOfSamplesPct).toBeCloseTo(50, 8);
    // 0.99 × 0.98 × 0.97 − 1 = −5.8906%
    expect(narrow.cumulativeReturnPct).toBeCloseTo(-5.8906, 4);
    expect(narrow.meanReturnPct).toBeCloseTo(-2, 8);
    expect(narrow.winRatePct).toBeCloseTo(0, 8);
    expect(report.spreadPct!).toBeCloseTo(6.1106 - -5.8906, 4);
  });

  it("未匹配样本显式计数（无标签日 → NO_REGIME_TAG；未评估日 → 该维 reasonCode）", () => {
    const { run, dates } = buildSixDayRun();
    const samples: RegimePerformanceSample[] = [
      { tradeDate: dates[0]!, returnPct: 1 },
      { tradeDate: "2099-01-01", returnPct: 2 },
    ];
    const report = aggregateRegimeAttribution(samples, run.tags, { groupBy: "composite" });
    expect(report.matchedSampleCount).toBe(1);
    expect(report.unmatchedSampleCount).toBe(1);
    expect(report.unmatchedByReasonCode["NO_REGIME_TAG"]).toBe(1);

    const sentimentReport = aggregateRegimeAttribution(
      [{ tradeDate: dates[5]!, returnPct: 1 }],
      run.tags,
      { groupBy: "sentiment" },
    );
    expect(sentimentReport.unmatchedSampleCount).toBe(1);
    expect(sentimentReport.unmatchedByReasonCode["REGIME_SENTIMENT_SOURCE_MISSING"]).toBe(1);
  });

  it("非有限收益 / 重复 tradeDate 响亮拒绝", () => {
    const { run, dates } = buildSixDayRun();
    expect(() =>
      aggregateRegimeAttribution([{ tradeDate: dates[0]!, returnPct: Number.NaN }], run.tags),
    ).toThrow(RegimeAnalysisError);
    expect(() =>
      aggregateRegimeAttribution(
        [{ tradeDate: dates[0]!, returnPct: 1 }],
        [run.tags[0]!, run.tags[0]!],
      ),
    ).toThrow(RegimeAnalysisError);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 适配接口（C-16.3 / C-13.3 占位填充）
// ---------------------------------------------------------------------------

describe("C-22.1 适配接口", () => {
  function sixDayTags(): RegimeDayTags[] {
    const dates = makeDates(6);
    const series = dates.map((date, index) =>
      makeDay(date, { close: 100, advancing: index < 3 ? 80 : 20, declining: index < 3 ? 20 : 80 }),
    );
    const run = runMarketRegimeAnalysis({
      regimeRunId: "REGIME-20240101-000002",
      series,
      configs: { breadth: { lookbackTradingDays: 1 } },
      compositeDimensions: ["breadth"],
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    return run.tags;
  }

  it("连续区间切分：前 3 日 broad、后 3 日 narrow → 2 段", () => {
    const segments = buildRegimeContiguousSegments(sixDayTags());
    expect(segments).toHaveLength(2);
    expect(segments[0]!.regimeId).toBe("breadth=broad");
    expect(segments[0]!.tradingDayCount).toBe(3);
    expect(segments[1]!.regimeId).toBe("breadth=narrow");
    expect(segments[1]!.tradingDayCount).toBe(3);
  });

  it("C-16.3 适配：assessed 形态 + 月度收益注入 + 按月去重", () => {
    const performance = buildTradeQualityRegimePerformance(sixDayTags(), {
      monthlyProvider: () => [{ monthKey: "2024-01", returnPct: 5, realizedReturnCount: 20 }],
    });
    expect(performance.kind).toBe("assessed");
    if (performance.kind === "assessed") {
      expect(performance.segments).toHaveLength(2);
      expect(performance.segments[0]!.monthlyReturns).toEqual([
        { monthKey: "2024-01", returnPct: 5, realizedReturnCount: 20 },
      ]);
    }
    const withoutProvider = buildTradeQualityRegimePerformance(sixDayTags());
    if (withoutProvider.kind === "assessed") {
      expect(withoutProvider.segments[0]!.monthlyReturns).toEqual([]);
    }
  });

  it("C-16.3 适配：无可用标签 → 回落 unassessed（reasonCode=REGIME_NOT_ASSESSED）", () => {
    const performance = buildTradeQualityRegimePerformance([]);
    expect(performance.kind).toBe("unassessed");
    if (performance.kind === "unassessed") {
      expect(performance.reasonCode).toBe(REGIME_UNASSESSED_REASON_CODE);
    }
  });

  it("C-13.3 适配：§28 regime 单值 = 主导复合状态，note 含覆盖与未评估计数", () => {
    const regime: ExperimentLineageRegime = toExperimentLineageRegime(sixDayTags());
    expect(regime.kind).toBe("assessed");
    if (regime.kind === "assessed") {
      expect(regime.regimeId).toBe("breadth=broad");
      expect(regime.note).toContain("3/6");
      expect(regime.note).toContain("未评估标签数=");
    }
    const empty = toExperimentLineageRegime([]);
    expect(empty.kind).toBe("unassessed");
    if (empty.kind === "unassessed") {
      expect(empty.reasonCode).toBe(REGIME_UNASSESSED_REASON_CODE);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑧ Run 记录：统计 / 确定性 / round-trip / 篡改拒绝 / 配置校验
// ---------------------------------------------------------------------------

function seventyDayRequest() {
  const series = makeDates(70).map((date, index) =>
    makeDay(date, {
      close: 100 + index * 0.5,
      advancing: 60,
      declining: 40,
      limitUp: 30,
      classifiable: 1000,
      amount: 1000,
    }),
  );
  return {
    regimeRunId: "REGIME-20240101-000003",
    series,
    datasetVersion: "rd-1.0.0-1-abcdef1234567890",
    createdAt: "2026-09-07T00:00:00.000Z",
  } as const;
}

function buildSeventyDayRun(): MarketRegimeRun {
  return runMarketRegimeAnalysis(seventyDayRequest());
}

describe("C-22.1 MarketRegimeRun 记录", () => {
  it("unassessed 统计：情绪维全缺 + 窗口不足各维计数准确", () => {
    const run = buildSeventyDayRun();
    expect(run.recordKind).toBe(MARKET_REGIME_RUN_RECORD_KIND);
    expect(run.tags).toHaveLength(70);
    expect(run.coverage.tradingDayCount).toBe(70);
    expect(run.coverage.startDate).toBe(run.tags[0]!.tradeDate);
    expect(run.coverage.endDate).toBe(run.tags[69]!.tradeDate);

    const stats = run.unassessedStats;
    expect(stats.totalTagCount).toBe(70 * 7);
    expect(stats.byDimension.sentiment).toBe(70); // 数据源缺失
    expect(stats.byDimension.trend).toBe(19); // 20 日回看，前 19 日不足
    expect(stats.byDimension.volatility).toBe(19);
    expect(stats.byDimension.liquidity).toBe(59); // 60 日回看
    expect(stats.byDimension.indexState).toBe(59);
    expect(stats.byDimension.breadth).toBe(4); // 5 日回看
    expect(stats.byDimension.limitUpEnv).toBe(4);
    // 情绪维：前 4 日（5 日回看）先判窗口不足，其余 66 日才是数据源缺失
    expect(stats.byReasonCode["REGIME_SENTIMENT_SOURCE_MISSING"]).toBe(66);
    expect(stats.byReasonCode["REGIME_INSUFFICIENT_HISTORY"]).toBe(19 + 19 + 59 + 4 + 59 + 4 + 4);
    expect(stats.totalUnassessedCount).toBe(70 + 19 + 19 + 59 + 59 + 4 + 4);
    expect(computeRegimeUnassessedStats(run.tags)).toEqual(stats);
  });

  it("末日七维中 6 维已评估、情绪维 unassessed（诚实反映数据缺口）", () => {
    const run = buildSeventyDayRun();
    const last = run.tags[69]!;
    expect(labelOf(last.trend)).toBe("up");
    expect(labelOf(last.volatility)).toBe("low");
    expect(labelOf(last.liquidity)).toBe("mid");
    expect(labelOf(last.breadth)).toBe("broad");
    expect(labelOf(last.indexState)).toBe("above_ma");
    expect(labelOf(last.limitUpEnv)).toBe("hot");
    expect(last.sentiment.kind).toBe("unassessed");
    if (last.sentiment.kind === "unassessed") {
      expect(last.sentiment.reasonCode).toBe("REGIME_SENTIMENT_SOURCE_MISSING");
    }
  });

  it("确定性：同输入两次运行深比较一致（指纹稳定）", () => {
    const first = buildSeventyDayRun();
    const second = buildSeventyDayRun();
    expect(second).toEqual(first);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.tagSequenceFingerprint).toBe(first.tagSequenceFingerprint);
  });

  it("确定性：指数键插入顺序不同不影响 canonical 指纹", () => {
    const dates = makeDates(30);
    const build = (order: "AB" | "BA") =>
      dates.map((date, index) =>
        order === "AB"
          ? makeDay(date, { indexCloses: { "000001.SH": 3000, [BENCH]: 100 + index } })
          : makeDay(date, { indexCloses: { [BENCH]: 100 + index, "000001.SH": 3000 } }),
      );
    const runA = runMarketRegimeAnalysis({
      regimeRunId: "REGIME-20240101-000004",
      series: build("AB"),
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    const runB = runMarketRegimeAnalysis({
      regimeRunId: "REGIME-20240101-000004",
      series: build("BA"),
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(runB.fingerprint).toBe(runA.fingerprint);
  });

  it("round-trip：serialize → deserialize 深比较一致；篡改标签/指纹被拒绝", () => {
    const run = buildSeventyDayRun();
    const json = serializeMarketRegimeRun(run);
    expect(deserializeMarketRegimeRun(json)).toEqual(run);

    const tamperedLabel = JSON.parse(json) as Record<string, unknown>;
    const tags = tamperedLabel.tags as Record<string, unknown>[];
    const lastTag = { ...(tags[69] as Record<string, unknown>) } as Record<string, unknown>;
    lastTag.trend = { ...(lastTag.trend as Record<string, unknown>), label: "down" };
    tags[69] = lastTag;
    expect(() => deserializeMarketRegimeRun(JSON.stringify(tamperedLabel))).toThrow(
      RegimeAnalysisError,
    );

    const tamperedPit = JSON.parse(json) as Record<string, unknown>;
    (tamperedPit.tags as Record<string, unknown>[])[69] = {
      ...((tamperedPit.tags as Record<string, unknown>[])[69] as object),
      asOf: "2030-01-01",
    };
    const issues = validateMarketRegimeRun(tamperedPit);
    expect(issues.some((item) => item.code === "REGIME_ASOF_INVARIANT_VIOLATION")).toBe(true);
  });

  it("配置非法 → 响亮抛错（NaN 阈值 / 回看窗 < 2 / 低阈值 >= 高阈值 / 空基准）", () => {
    expect(() => resolveRegimeConfigSet({ trend: { upThresholdPct: Number.NaN } })).toThrow(
      RegimeAnalysisError,
    );
    expect(() => resolveRegimeConfigSet({ trend: { lookbackTradingDays: 1 } })).toThrow(
      RegimeAnalysisError,
    );
    expect(() =>
      resolveRegimeConfigSet({ volatility: { lowThresholdPct: 30, highThresholdPct: 30 } }),
    ).toThrow(RegimeAnalysisError);
    expect(() => resolveRegimeConfigSet({ annualizationFactor: 0 })).toThrow(RegimeAnalysisError);
    expect(() => resolveRegimeConfigSet({ benchmarkIndexCode: "  " })).toThrow(RegimeAnalysisError);
    expect(() => resolveRegimeConfigSet({ liquidity: { metric: "nope" as never } })).toThrow(
      RegimeAnalysisError,
    );
  });

  it("运行请求非法 → 响亮抛错（空 runId / 空 createdAt / 乱序序列）", () => {
    const series = rampSeries(10, 0.5);
    expect(() =>
      runMarketRegimeAnalysis({
        regimeRunId: "  ",
        series,
        createdAt: "2026-09-07T00:00:00.000Z",
      }),
    ).toThrow(RegimeAnalysisError);
    expect(() =>
      runMarketRegimeAnalysis({ regimeRunId: "R1", series, createdAt: "" }),
    ).toThrow(RegimeAnalysisError);
    expect(() =>
      runMarketRegimeAnalysis({
        regimeRunId: "R1",
        series: [series[1]!, series[0]!],
        createdAt: "2026-09-07T00:00:00.000Z",
      }),
    ).toThrow(RegimeAnalysisError);
  });

  it("注入表现样本 → Run 携带归因且通过记录校验", () => {
    const run = runMarketRegimeAnalysis({
      ...seventyDayRequest(),
      performanceSamples: makeDates(70).map((date, index) => ({
        tradeDate: date,
        returnPct: index % 2 === 0 ? 0.5 : -0.2,
      })),
    });
    expect(run.attribution).not.toBeNull();
    expect(run.attribution!.totalSampleCount).toBe(70);
    expect(run.attribution!.matchedSampleCount).toBe(70);
    expect(validateMarketRegimeRun(run)).toEqual([]);
    expect(deserializeMarketRegimeRun(serializeMarketRegimeRun(run))).toEqual(run);
  });

  it("篡改 fingerprint / unassessedStats → 校验拒绝（防统计造假）", () => {
    const run = buildSeventyDayRun();
    const tamperedFingerprint = { ...run, fingerprint: "0".repeat(64) };
    expect(
      validateMarketRegimeRun(tamperedFingerprint).some(
        (item) => item.code === "REGIME_FINGERPRINT_MISMATCH",
      ),
    ).toBe(true);
    expect(() => deserializeMarketRegimeRun(JSON.stringify(tamperedFingerprint))).toThrow(
      RegimeAnalysisError,
    );

    const tamperedStats = {
      ...run,
      unassessedStats: { ...run.unassessedStats, totalUnassessedCount: 0 },
    };
    expect(
      validateMarketRegimeRun(tamperedStats).some((item) => item.code === "REGIME_STATS_MISMATCH"),
    ).toBe(true);
  });

  it("复合未启用（enableComposite=false）→ composite=null，归因记 NO_COMPOSITE 未匹配", () => {
    const run = runMarketRegimeAnalysis({
      ...seventyDayRequest(),
      enableComposite: false,
    });
    expect(run.tags.every((day) => day.composite === null)).toBe(true);
    const report = aggregateRegimeAttribution(
      [{ tradeDate: run.tags[69]!.tradeDate, returnPct: 1 }],
      run.tags,
      { groupBy: "composite" },
    );
    expect(report.matchedSampleCount).toBe(0);
    expect(report.unmatchedByReasonCode["NO_COMPOSITE"]).toBe(1);
  });

  it("序列重复交易日 → REGIME_SERIES_NOT_ORDERED", () => {
    const series = rampSeries(10, 0.5);
    const duplicated = [series[0]!, series[0]!, ...series.slice(1)];
    expect(() =>
      runMarketRegimeAnalysis({
        regimeRunId: "R-DUP",
        series: duplicated,
        createdAt: "2026-09-07T00:00:00.000Z",
      }),
    ).toThrow(RegimeAnalysisError);
  });

  it("空序列 → 空 Run（coverage 起止为 null，统计全 0）", () => {
    const run = runMarketRegimeAnalysis({
      regimeRunId: "REGIME-EMPTY",
      series: [],
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(run.tags).toEqual([]);
    expect(run.coverage).toEqual({ startDate: null, endDate: null, tradingDayCount: 0 });
    expect(run.unassessedStats.totalTagCount).toBe(0);
    expect(validateMarketRegimeRun(run)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ⑨ facts 构建（涨停规则复用 boardRules）+ Research Dataset 行适配
// ---------------------------------------------------------------------------

describe("C-22.1 日级事实构建", () => {
  it("涨跌停判定复用 boardRules：主板 10% / 创业板 20% / ST 5%；代码缺失不可判定", () => {
    const facts = buildRegimeDayFacts({
      tradeDate: "2024-01-04",
      indexBars: [{ indexCode: BENCH, close: 3500 }],
      snapshots: [
        // 主板 100 → 110 涨停
        { securityId: "S1", code: "600000.SH", close: 110, preClose: 100, amount: 1000, turnoverRate: 1, st: "NORMAL" },
        // 创业板 20%：118 未达 120 → 不涨停
        { securityId: "S2", code: "300001.SZ", close: 118, preClose: 100, amount: 1000, turnoverRate: 1, st: "NORMAL" },
        // 创业板 120 → 涨停
        { securityId: "S3", code: "300002.SZ", close: 120, preClose: 100, amount: 1000, turnoverRate: 1, st: "NORMAL" },
        // ST 主板 5%：105 → 涨停；104 不算
        { securityId: "S4", code: "000001.SZ", close: 105, preClose: 100, amount: 1000, turnoverRate: 1, st: "ST" },
        { securityId: "S5", code: "000002.SZ", close: 104, preClose: 100, amount: 1000, turnoverRate: 1, st: "ST" },
        // 主板跌停 90
        { securityId: "S6", code: "600001.SH", close: 90, preClose: 100, amount: 1000, turnoverRate: 1, st: "NORMAL" },
        // 代码缺失 → 不可判定（不计入分母）
        { securityId: "S7", code: null, close: 200, preClose: 100, amount: 1000, turnoverRate: 1, st: "NORMAL" },
      ],
    });
    expect(facts.sampleSize).toBe(7);
    expect(facts.advancingCount).toBe(6); // S1~S5 与 S7 上涨
    expect(facts.decliningCount).toBe(1); // S6
    expect(facts.unchangedCount).toBe(0);
    expect(facts.limitUpCount).toBe(3); // S1 / S3 / S4
    expect(facts.limitDownCount).toBe(1); // S6
    expect(facts.limitClassifiableCount).toBe(6); // 排除代码缺失的 S7
    expect(facts.totalAmount).toBe(7000);
    expect(facts.meanTurnoverRate).toBeCloseTo(1, 8);
    expect(facts.indexCloses[BENCH]).toBe(3500);
    expect(facts.sentiment).toBeNull();
  });

  it("成交额/换手率全缺 → totalAmount / meanTurnoverRate 为 null（不填零）", () => {
    const facts = buildRegimeDayFacts({
      tradeDate: "2024-01-04",
      snapshots: [
        { securityId: "S1", code: "600000.SH", close: 100, preClose: 99, amount: null, turnoverRate: null, st: "NORMAL" },
      ],
    });
    expect(facts.totalAmount).toBeNull();
    expect(facts.meanTurnoverRate).toBeNull();
    expect(facts.advancingCount).toBe(1);
  });

  it("Research Dataset 行适配：字段直取 + 行级 PIT 断言（脏行拒绝）", () => {
    const row: ResearchDatasetRow = {
      tradeDate: "2024-01-04",
      asOf: "2024-01-04",
      securityId: "SEC-1",
      code: "600000.SH",
      securityType: "STOCK",
      exchange: "SH",
      lifecycleVerdict: "LISTED",
      eligible: true,
      exclusionReason: null,
      st: "NORMAL",
      industryCode: "801010",
      industryName: "农林牧渔",
      turnoverRate: 1.5,
      circulationMarketCap: 1e11,
      totalMarketCap: 2e11,
      liquidityAmount: 1000,
      liquidityVolume: 100,
      open: 101,
      high: 112,
      low: 100,
      close: 110,
      preClose: 100,
      volume: 100,
      amount: 1000,
      corporateActionsEffectiveCount: 0,
      corporateActionsKnownCount: 0,
      indexClose: { "000300.SH": 3500 },
      knowledge: {
        policy: "PIT",
        listing: "KNOWN",
        delisting: "KNOWN",
        tradability: "KNOWN",
        industry: "KNOWN",
        liquidity: "KNOWN",
        price: "KNOWN",
        corporateActions: "KNOWN",
        marketState: "KNOWN",
      },
    };
    const snapshot = regimeSecuritySnapshotFromDatasetRow(row);
    expect(snapshot).toEqual({
      securityId: "SEC-1",
      code: "600000.SH",
      close: 110,
      preClose: 100,
      amount: 1000,
      turnoverRate: 1.5,
      st: "NORMAL",
    });

    const facts = buildRegimeDayFactsFromDatasetRows({ tradeDate: "2024-01-04", rows: [row] });
    expect(facts.limitUpCount).toBe(1);
    expect(facts.indexCloses["000300.SH"]).toBe(3500);

    const dirtyRow: ResearchDatasetRow = { ...row, asOf: "2026-09-07" };
    expect(() => buildRegimeDayFactsFromDatasetRows({ tradeDate: "2024-01-04", rows: [dirtyRow] })).toThrow();
  });

  it("非有限成交额 / 非法日期 → 响亮抛错（不静默）", () => {
    expect(() =>
      buildRegimeDayFacts({
        tradeDate: "2024-01-04",
        snapshots: [
          { securityId: "S1", code: "600000.SH", close: 100, preClose: 99, amount: Number.NaN, turnoverRate: 1, st: "NORMAL" },
        ],
      }),
    ).toThrow(RegimeAnalysisError);
    expect(() => buildRegimeDayFacts({ tradeDate: "2024/01/04", snapshots: [] })).toThrow(
      RegimeAnalysisError,
    );
  });
});

// ---------------------------------------------------------------------------
// ⑩ 补充：默认口径下的 PIT 流式等价 / 换手率口径 / 日期纯函数 / Run→§28 映射
// ---------------------------------------------------------------------------

describe("C-22.1 补充断言", () => {
  it("默认口径（20/60 日回看）：逐日标签只依赖 T 及之前（流式等价）", () => {
    const run = buildSeventyDayRun();
    const series = seventyDayRequest().series;
    run.tags.forEach((day, index) => {
      const fromPrefix = computeRegimeDayTags(
        series.slice(0, index + 1),
        day.tradeDate,
        run.configs,
      );
      expect(fromPrefix).toEqual(day);
    });
  });

  it("流动性口径可切 turnoverRate：当日 2.0 / 窗口均值 1.2 → high", () => {
    const dates = makeDates(5);
    const series = dates.map((date, index) =>
      makeDay(date, { close: 100, turnoverRate: index === 4 ? 2 : 1, amount: null }),
    );
    const tag = classifyRegimeLiquidity(
      series,
      dates[4]!,
      resolveRegimeConfigSet({
        liquidity: { lookbackTradingDays: 5, metric: "turnoverRate" },
      }).liquidity,
    );
    expect(labelOf(tag)).toBe("high");
    if (tag.kind === "assessed") {
      expect(tag.metrics.windowMeanValue!).toBeCloseTo(1.2, 8);
      expect(tag.metrics.relativeRatio!).toBeCloseTo(2 / 1.2, 8);
    }
  });

  it("日期纯函数：儒略日序号与跨闰年天数差（无 Date 对象依赖）", () => {
    expect(regimeCalendarDaysBetween("2024-01-01", "2024-01-02")).toBe(1);
    expect(regimeCalendarDaysBetween("2024-02-28", "2024-03-01")).toBe(2); // 2024 闰年
    expect(regimeCalendarDaysBetween("2023-02-28", "2023-03-01")).toBe(1); // 平年
    expect(regimeDateOrdinal("2024-12-31") - regimeDateOrdinal("2024-01-01")).toBe(365);
    expect(() => assertRegimeIsoDate("2024-13-01", "x")).toThrow(RegimeAnalysisError);
    expect(() => assertRegimeIsoDate("2024-01-32", "x")).toThrow(RegimeAnalysisError);
  });

  it("Run → §28 regime 映射（toExperimentLineageRegimeFromRun）与 tags 入口一致", () => {
    const run = buildSeventyDayRun();
    const fromRun = toExperimentLineageRegimeFromRun(run);
    const fromTags = toExperimentLineageRegime(run.tags);
    expect(fromRun).toEqual(fromTags);
    expect(fromRun.kind).toBe("assessed");
    if (fromRun.kind === "assessed") {
      // 默认口径下前 59 日多维窗口不足 → 主导键含 NA 片段，如实反映未评估
      expect(fromRun.regimeId).toContain("indexState=NA:REGIME_INSUFFICIENT_HISTORY");
    }
  });
});
