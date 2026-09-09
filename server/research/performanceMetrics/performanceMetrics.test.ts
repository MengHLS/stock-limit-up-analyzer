/**
 * STEP 16 / C-16.1 — 策略评价·收益/风险/回撤指标测试。
 *
 * 全部 fixture 手工构造（确定性、可手算），覆盖：
 *   (a) 退化/非法输入响亮抛错（空/单点/非有限/非正权益/日期乱序/非法参数）；
 *   (b) 收益：CAGR 手算（252 日 +10% 期 ≈ +10%、指数可手算的 annFactor 覆盖）、
 *       Total Return、STEP 8 annualizedReturnPct 公式一致性与锚点差异文档化；
 *   (c) 回撤：MaxDD 深度/峰谷恢复日期/交易日与自然日时长手算断言、未恢复段、
 *       无回撤段、深度并列取更早峰值、剖面阈值分段；
 *   (d) Recovery Factor（总收益口径，含无回撤 → null）；
 *   (e) tail risk：最差连续亏损段/单日最差/最佳/下行偏差/波动率/偏度峰度/
 *       1%/5% 分位数手算或半手算；
 *   (f) 与 STEP 8 computeMetrics / maxDrawdownFromEquity / dailyReturnsFromEquity
 *       同输入同口径对照；
 *   (g) 确定性 / round-trip / fingerprint 防篡改。
 */

import { describe, expect, it } from "vitest";
import type { EquityPoint, Trade } from "../../backtest/types";
import {
  computeMetrics,
  dailyReturnsFromEquity,
  maxDrawdownFromEquity,
} from "../../backtest/metrics";
import { excessKurtosis, skewness } from "../../../shared/quant-stats";
import {
  InvalidEquityCurveError,
  PerformanceEvaluationError,
  analyzeDrawdown,
  assertValidEquityCurve,
  computeInputFingerprint,
  computePerformanceEvaluationRunFingerprint,
  computePerformanceMetrics,
  dailyReturnSeries,
  deserializePerformanceEvaluationRun,
  evaluatePerformance,
  serializePerformanceEvaluationRun,
} from "./index";

// ---------------------------------------------------------------------------
// fixture 构建工具
// ---------------------------------------------------------------------------

/** 由 (date, equity) 构造 EquityPoint（cash/marketValue 仅为占位，评估只读 equity/date）。 */
function mkPoint(date: string, equity: number): EquityPoint {
  return { date, cash: equity, marketValue: 0, equity, openPositions: 0 };
}

function curve(dates: string[], equities: number[]): EquityPoint[] {
  if (dates.length !== equities.length) {
    throw new Error(`fixture: dates(${dates.length}) 与 equities(${equities.length}) 不等长`);
  }
  return dates.map((date, index) => mkPoint(date, equities[index]!));
}

/** 连续自然日 YYYY-MM-DD（自 2024-01-01 起）。 */
function consecutiveDates(count: number, from = "2024-01-01"): string[] {
  const base = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(base + index * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}

function expectEvaluationError(
  fn: () => unknown,
  code: string
): PerformanceEvaluationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PerformanceEvaluationError);
    const evaluationError = error as PerformanceEvaluationError;
    expect(evaluationError.code).toBe(code);
    return evaluationError;
  }
  throw new Error(`期望抛错但未抛（code=${code}）`);
}

// ---------------------------------------------------------------------------
// 主 fixture：手工可手算的峰值 → 回撤 → 恢复曲线
// ---------------------------------------------------------------------------
// 10 个工作日（2024-01-01..2024-01-12，含 01-06/07 周末缺口），权益：
//   100, 110, 105, 100, 95, 100, 110, 108, 104, 110
// 段1：峰 idx1(110, 01-02) → 谷 idx4(95, 01-05) → 恢复 idx6(110, 01-09)
//      深度 (110−95)/110 = 13.636%；峰→谷 3 交易日/3 自然日；峰→恢复 5 交易日/7 自然日
// 段2：峰 idx6(110, 01-09) → 谷 idx8(104, 01-11) → 恢复 idx9(110, 01-12)
//      深度 (110−104)/110 = 5.4545%
// 日收益：+10%, −4.545%, −4.762%, −5.0%, +5.263%, +10%, −1.818%, −3.704%, +5.769%
// 最差连亏 = j1..j3（−4.545% −4.762% −5.0% = −14.307%），实现点位 idx2..idx4（01-03..01-05）

const MAIN_DATES = [
  "2024-01-01",
  "2024-01-02",
  "2024-01-03",
  "2024-01-04",
  "2024-01-05",
  "2024-01-08",
  "2024-01-09",
  "2024-01-10",
  "2024-01-11",
  "2024-01-12",
];
const MAIN_EQUITIES = [100, 110, 105, 100, 95, 100, 110, 108, 104, 110];
const MAIN_CURVE = curve(MAIN_DATES, MAIN_EQUITIES);

// ---------------------------------------------------------------------------
// (a) 退化 / 非法输入：响亮抛错
// ---------------------------------------------------------------------------

describe("退化与非法输入", () => {
  it("空 equityCurve 抛 INSUFFICIENT_EQUITY_CURVE", () => {
    expectEvaluationError(() => computePerformanceMetrics({ equityCurve: [] }), "INSUFFICIENT_EQUITY_CURVE");
    expectEvaluationError(() => evaluatePerformance({ equityCurve: [] }), "INSUFFICIENT_EQUITY_CURVE");
  });

  it("单点曲线抛 INSUFFICIENT_EQUITY_CURVE（无法年化/无收益率区间）", () => {
    expectEvaluationError(
      () => computePerformanceMetrics({ equityCurve: [mkPoint("2024-01-01", 100)] }),
      "INSUFFICIENT_EQUITY_CURVE"
    );
  });

  it("非有限或非正 equity 抛 INVALID_EQUITY_VALUE", () => {
    expectEvaluationError(
      () => computePerformanceMetrics({ equityCurve: curve(["2024-01-01", "2024-01-02"], [100, Number.NaN]) }),
      "INVALID_EQUITY_VALUE"
    );
    expectEvaluationError(
      () => computePerformanceMetrics({ equityCurve: curve(["2024-01-01", "2024-01-02"], [100, 0]) }),
      "INVALID_EQUITY_VALUE"
    );
    expectEvaluationError(
      () => computePerformanceMetrics({ equityCurve: curve(["2024-01-01", "2024-01-02"], [100, -5]) }),
      "INVALID_EQUITY_VALUE"
    );
  });

  it("日期乱序 / 重复 / 非法格式抛错", () => {
    expectEvaluationError(
      () =>
        computePerformanceMetrics({
          equityCurve: curve(["2024-01-02", "2024-01-01"], [100, 110]),
        }),
      "EQUITY_CURVE_UNSORTED"
    );
    expectEvaluationError(
      () =>
        computePerformanceMetrics({
          equityCurve: curve(["2024-01-01", "2024-01-01"], [100, 110]),
        }),
      "EQUITY_CURVE_UNSORTED"
    );
    expectEvaluationError(
      () =>
        computePerformanceMetrics({
          equityCurve: curve(["2024/01/01", "2024-01-02"], [100, 110]),
        }),
      "INVALID_DATE"
    );
  });

  it("非法口径参数抛 INVALID_PARAMETER", () => {
    expectEvaluationError(
      () => computePerformanceMetrics({ equityCurve: MAIN_CURVE, annualizationFactor: 0 }),
      "INVALID_PARAMETER"
    );
    expectEvaluationError(
      () => computePerformanceMetrics({ equityCurve: MAIN_CURVE, drawdownThresholdPct: -1 }),
      "INVALID_PARAMETER"
    );
    expectEvaluationError(
      () => computePerformanceMetrics({ equityCurve: MAIN_CURVE, downsideTarget: Number.POSITIVE_INFINITY }),
      "INVALID_PARAMETER"
    );
  });

  it("assertValidEquityCurve 通过后返回 void（不抛错）", () => {
    expect(assertValidEquityCurve(MAIN_CURVE)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (b) 收益指标
// ---------------------------------------------------------------------------

describe("收益指标（Total Return / CAGR）", () => {
  it("Total Return 手算：主 fixture 100 → 110 = +10%", () => {
    const metrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    expect(metrics.returns.startEquity).toBe(100);
    expect(metrics.returns.endEquity).toBe(110);
    expect(metrics.returns.totalReturnPct).toBeCloseTo(10, 10);
  });

  it("CAGR 手算：252 个交易日 +10% 期 ≈ +10%/年（指数=252/252=1）", () => {
    // 253 点（252 个收益率区间），几何增长使期末恰为 110。
    const r = (110 / 100) ** (1 / 252) - 1;
    const equities: number[] = [100];
    for (let i = 1; i <= 252; i += 1) equities.push(100 * (1 + r) ** i);
    const metrics = computePerformanceMetrics({
      equityCurve: curve(consecutiveDates(253), equities),
    });
    expect(equities[252]).toBeCloseTo(110, 9);
    expect(metrics.returns.totalReturnPct).toBeCloseTo(10, 6);
    expect(metrics.returns.cagrPct).toBeCloseTo(10, 6);
  });

  it("CAGR 指数手算：5 点 +10%、annualizationFactor=8 → (1.1)^(8/4)−1 = +21%", () => {
    const metrics = computePerformanceMetrics({
      equityCurve: curve(consecutiveDates(5), [100, 102, 104, 108, 110]),
      annualizationFactor: 8,
    });
    expect(metrics.returns.cagrPct).toBeCloseTo(21, 9);
    expect(metrics.returns.totalReturnPct).toBeCloseTo(10, 9);
  });

  it("负收益曲线 CAGR 为负且为有限值", () => {
    const metrics = computePerformanceMetrics({
      equityCurve: curve(consecutiveDates(3), [100, 90, 81]),
      annualizationFactor: 252,
    });
    expect(metrics.returns.totalReturnPct).toBeCloseTo(-19, 6);
    expect(Number.isFinite(metrics.returns.cagrPct)).toBe(true);
    expect(metrics.returns.cagrPct).toBeLessThan(0);
  });

  it("与 STEP 8 computeMetrics：同输入同口径（锚点重合时）字段一致", () => {
    // STEP 8 annualizedReturnPct 公式与 CAGR 相同（shared 原语），此处 C-14.1 场景
    // equityCurve[0].equity == initialCapital，锚点重合，应逐项一致。
    const m8 = computeMetrics({
      equityCurve: MAIN_CURVE,
      trades: [],
      initialCapital: 100,
    });
    const ours = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    expect(ours.returns.totalReturnPct).toBeCloseTo(m8.totalReturnPct, 6);
    // STEP 8 输出 round 到 4 位小数；本任务不 round，故对照到 1e-3 级即可。
    expect(ours.returns.cagrPct).toBeCloseTo(m8.annualizedReturnPct ?? Number.NaN, 3);
    expect(ours.risk.annualizedVolatilityPct ?? Number.NaN).toBeCloseTo(
      m8.annualizedVolatilityPct ?? Number.NaN,
      3
    );
    expect(ours.drawdown.maxDrawdownPct).toBeCloseTo(m8.maxDrawdownPct, 3);
  });

  it("锚点差异文档化：initialCapital != equityCurve[0].equity 时与 STEP 8 不同（曲线视角 vs 存入资金视角）", () => {
    const m8 = computeMetrics({
      equityCurve: MAIN_CURVE,
      trades: [],
      initialCapital: 90,
    });
    const ours = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    expect(m8.totalReturnPct).toBeCloseTo(22.2222, 2); // (110−90)/90
    expect(ours.returns.totalReturnPct).toBeCloseTo(10, 6); // 锚点为首点 100
    expect(ours.returns.totalReturnPct).not.toBeCloseTo(m8.totalReturnPct, 6);
  });
});

// ---------------------------------------------------------------------------
// (c) 回撤：深度 / 起止 / 时长 / 剖面
// ---------------------------------------------------------------------------

describe("回撤指标", () => {
  it("MaxDD 深度手算：主 fixture = (110−95)/110 = 13.6363%", () => {
    const metrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    expect(metrics.drawdown.maxDrawdownPct).toBeCloseTo(13.6363636363, 9);
    // 与 STEP 8 maxDrawdownFromEquity（running peak）深度一致
    expect(metrics.drawdown.maxDrawdownPct).toBeCloseTo(
      maxDrawdownFromEquity(MAIN_EQUITIES) * 100,
      9
    );
  });

  it("MaxDD 段起止/恢复日期与时长手算（交易日 vs 自然日）", () => {
    const metrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    const segment = metrics.drawdown.maxDrawdownSegment!;
    expect(segment.peakIndex).toBe(1);
    expect(segment.troughIndex).toBe(4);
    expect(segment.recoveryIndex).toBe(6);
    expect(segment.peakDate).toBe("2024-01-02");
    expect(segment.troughDate).toBe("2024-01-05");
    expect(segment.recoveryDate).toBe("2024-01-09");
    expect(segment.peakEquity).toBe(110);
    expect(segment.troughEquity).toBe(95);
    expect(segment.tradingDaysToTrough).toBe(3);
    expect(segment.calendarDaysToTrough).toBe(3); // 01-02 → 01-05
    expect(segment.tradingDaysToRecovery).toBe(5);
    expect(segment.calendarDaysToRecovery).toBe(7); // 01-02 → 01-09（跨周末，> 交易日 5）
    expect(segment.recoveryIndex).not.toBeNull();
  });

  it("回撤剖面：阈值 5% 默认列出两段（13.64% 与 5.45%）；阈值 10% 仅最深段；阈值 20% 为空但 max 段仍在", () => {
    const defaultMetrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    expect(defaultMetrics.drawdown.drawdownEpisodeCount).toBe(2);
    expect(defaultMetrics.drawdown.drawdownSegments.map((s) => s.peakIndex)).toEqual([1, 6]);

    const threshold10 = computePerformanceMetrics({
      equityCurve: MAIN_CURVE,
      drawdownThresholdPct: 10,
    });
    expect(threshold10.drawdown.drawdownEpisodeCount).toBe(1);
    expect(threshold10.drawdown.drawdownSegments[0]!.depthPct).toBeCloseTo(13.6363636363, 9);

    const threshold20 = computePerformanceMetrics({
      equityCurve: MAIN_CURVE,
      drawdownThresholdPct: 20,
    });
    expect(threshold20.drawdown.drawdownEpisodeCount).toBe(0);
    // 最深段不受阈值影响，始终记录
    expect(threshold20.drawdown.maxDrawdownSegment).not.toBeNull();
    expect(threshold20.drawdown.maxDrawdownPct).toBeCloseTo(13.6363636363, 9);
  });

  it("第二段深度手算：(110−104)/110 = 5.4545%，起止/恢复日期正确", () => {
    const metrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    const segment = metrics.drawdown.drawdownSegments[1]!;
    expect(segment.depthPct).toBeCloseTo(5.4545454545, 9);
    expect(segment.peakIndex).toBe(6);
    expect(segment.troughIndex).toBe(8);
    expect(segment.recoveryIndex).toBe(9);
    expect(segment.tradingDaysToTrough).toBe(2);
    expect(segment.calendarDaysToRecovery).toBe(3);
  });

  it("期末未恢复段：recoveryIndex/Date = null，恢复时长 = null", () => {
    const openCurve = curve(["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"], [100, 120, 110, 100, 115]);
    const metrics = computePerformanceMetrics({ equityCurve: openCurve });
    const segment = metrics.drawdown.maxDrawdownSegment!;
    expect(segment.recoveryIndex).toBeNull();
    expect(segment.recoveryDate).toBeNull();
    expect(segment.tradingDaysToRecovery).toBeNull();
    expect(segment.calendarDaysToRecovery).toBeNull();
    expect(segment.peakIndex).toBe(1); // 峰 120
    expect(segment.troughIndex).toBe(3); // 谷 100
    expect(segment.depthPct).toBeCloseTo(16.6666666667, 9);
  });

  it("无回撤的单调上升曲线：maxDrawdownPct = 0、段为 null、剖面为空", () => {
    const monotonic = curve(["2024-01-01", "2024-01-02", "2024-01-03"], [100, 110, 130]);
    const metrics = computePerformanceMetrics({ equityCurve: monotonic });
    expect(metrics.drawdown.maxDrawdownPct).toBe(0);
    expect(metrics.drawdown.maxDrawdownSegment).toBeNull();
    expect(metrics.drawdown.drawdownSegments).toHaveLength(0);
    expect(metrics.drawdown.drawdownEpisodeCount).toBe(0);
  });

  it("深度并列的最深回撤段取 peakIndex 更早者", () => {
    // 两段深度相同（(110−105)/110 = 4.545%），峰分别在 idx1 与 idx3。
    const tieCurve = curve(consecutiveDates(6), [100, 110, 105, 110, 105, 110]);
    const metrics = computePerformanceMetrics({
      equityCurve: tieCurve,
      drawdownThresholdPct: 4,
    });
    expect(metrics.drawdown.drawdownEpisodeCount).toBe(2);
    expect(metrics.drawdown.maxDrawdownSegment!.peakIndex).toBe(1);
    expect(metrics.drawdown.maxDrawdownSegment!.depthPct).toBeCloseTo(4.5454545455, 9);
  });
});

// ---------------------------------------------------------------------------
// (d) Recovery Factor
// ---------------------------------------------------------------------------

describe("Recovery Factor", () => {
  it("主 fixture：totalReturn 10% / maxDD 13.6363% = 11/15 ≈ 0.7333", () => {
    const metrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    expect(metrics.recoveryFactor).toBeCloseTo(11 / 15, 9);
  });

  it("无回撤时 recoveryFactor = null（分母为 0，无定义）", () => {
    const monotonic = curve(["2024-01-01", "2024-01-02", "2024-01-03"], [100, 110, 130]);
    const metrics = computePerformanceMetrics({ equityCurve: monotonic });
    expect(metrics.drawdown.maxDrawdownPct).toBe(0);
    expect(metrics.recoveryFactor).toBeNull();
  });

  it("未恢复回撤曲线上 recoveryFactor = 0.15/0.1666… = 0.9", () => {
    const openCurve = curve(["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"], [100, 120, 110, 100, 115]);
    const metrics = computePerformanceMetrics({ equityCurve: openCurve });
    expect(metrics.returns.totalReturnPct).toBeCloseTo(15, 9);
    expect(metrics.recoveryFactor).toBeCloseTo(0.9, 9);
  });
});

// ---------------------------------------------------------------------------
// (e) tail risk / 下行风险
// ---------------------------------------------------------------------------

describe("下行风险与 tail risk", () => {
  it("最差连续亏损段手算：主 fixture = −(5/110+5/105+5/100) ≈ −14.307%，3 天，01-03..01-05", () => {
    const metrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    const streak = metrics.risk.worstLosingStreak!;
    const expected = -(5 / 110 + 5 / 105 + 5 / 100) * 100;
    expect(streak.totalPct).toBeCloseTo(expected, 9);
    expect(streak.days).toBe(3);
    expect(streak.startIndex).toBe(2);
    expect(streak.endIndex).toBe(4);
    expect(streak.startDate).toBe("2024-01-03");
    expect(streak.endDate).toBe("2024-01-05");
  });

  it("单日最差/最佳手算：主 fixture = −5.0% / +10%", () => {
    const metrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    expect(metrics.risk.worstSingleDayPct).toBeCloseTo(-5, 9);
    expect(metrics.risk.bestSingleDayPct).toBeCloseTo(10, 9);
  });

  it("无任何负收益日 → worstLosingStreak = null", () => {
    const rising = curve(["2024-01-01", "2024-01-02", "2024-01-03"], [100, 110, 130]);
    const metrics = computePerformanceMetrics({ equityCurve: rising });
    expect(metrics.risk.worstLosingStreak).toBeNull();
  });

  it("下行偏差与年化波动率半手算（日收益 [0.01,−0.02,0.03,−0.04]）", () => {
    // equity 路径：100 → 101 → 98.98 → 101.9494 → 97.871424
    const equities = [100, 101, 98.98, 101.9494, 97.871424];
    const returns = [0.01, -0.02, 0.03, -0.04];
    const metrics = computePerformanceMetrics({
      equityCurve: curve(consecutiveDates(5), equities),
    });
    // 下行偏差（总体口径，仅负向）：√( (0.0004+0.0016)/4 ) × √252 × 100
    expect(metrics.risk.downsideDeviationPct).toBeCloseTo(
      Math.sqrt(0.002 / 4) * Math.sqrt(252) * 100,
      9
    );
    // 样本波动率：√( Σdev²/(n−1) ) × √252 × 100
    const sampleStd = Math.sqrt(0.0029 / 3);
    expect(metrics.risk.annualizedVolatilityPct).toBeCloseTo(
      sampleStd * Math.sqrt(252) * 100,
      9
    );
    // 手动复核样本方差中间量（Σdev² = 0.0029，mean = −0.005）
    const meanR = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const sumSqDev = returns.reduce((sum, r) => sum + (r - meanR) ** 2, 0);
    expect(meanR).toBeCloseTo(-0.005, 12);
    expect(sumSqDev).toBeCloseTo(0.0029, 12);
    // 单日最差/最佳
    expect(metrics.risk.worstSingleDayPct).toBeCloseTo(-4, 9);
    expect(metrics.risk.bestSingleDayPct).toBeCloseTo(3, 9);
  });

  it("偏度/峰度与 shared/quant-stats 原语一致（直接对照）", () => {
    const equities = [100, 101, 98.98, 101.9494, 97.871424];
    const returns = dailyReturnSeries(equities);
    const metrics = computePerformanceMetrics({
      equityCurve: curve(consecutiveDates(5), equities),
    });
    expect(metrics.risk.skewness).toBeCloseTo(skewness(returns) ?? Number.NaN, 12);
    expect(metrics.risk.excessKurtosis).toBeCloseTo(excessKurtosis(returns) ?? Number.NaN, 12);
    expect(metrics.risk.skewness).not.toBeNull();
    expect(metrics.risk.excessKurtosis).not.toBeNull();
  });

  it("常数收益序列：波动率/下行偏差=0，偏度/峰度=null（无分布可描述）", () => {
    const flatDaily = curve(consecutiveDates(6), [100, 100, 100, 100, 100, 100]);
    const metrics = computePerformanceMetrics({ equityCurve: flatDaily });
    expect(metrics.risk.annualizedVolatilityPct).toBe(0);
    expect(metrics.risk.downsideDeviationPct).toBe(0);
    expect(metrics.risk.skewness).toBeNull();
    expect(metrics.risk.excessKurtosis).toBeNull();
    expect(metrics.risk.worstLosingStreak).toBeNull();
    expect(metrics.risk.bestSingleDayPct).toBe(0);
  });

  it("1%/5% 历史分位手算：21 个日收益，第二小 = −5% → p05 = −5%；p01 线性插值 = −10.6%", () => {
    // 收益集：{−0.12, −0.05, 0.01×19}；排序后 index=(21−1)·q。
    const returns = [-0.12, -0.05, ...Array<number>(19).fill(0.01)];
    const equities: number[] = [100];
    for (const r of returns) equities.push(equities[equities.length - 1]! * (1 + r));
    const metrics = computePerformanceMetrics({
      equityCurve: curve(consecutiveDates(22), equities),
    });
    expect(metrics.risk.dailyReturnP05Pct).toBeCloseTo(-5, 9);
    // q01: index = 20×0.01 = 0.2 → sorted[0] + 0.2×(sorted[1]−sorted[0])
    const expectedP01 = (-0.12 + 0.2 * (-0.05 - -0.12)) * 100;
    expect(expectedP01).toBeCloseTo(-10.6, 12);
    expect(metrics.risk.dailyReturnP01Pct).toBeCloseTo(expectedP01, 9);
  });

  it("日收益序列纯函数与 STEP 8 dailyReturnsFromEquity 逐项一致", () => {
    const ours = dailyReturnSeries(MAIN_EQUITIES);
    const theirs = dailyReturnsFromEquity(MAIN_CURVE);
    expect(ours).toHaveLength(theirs.length);
    ours.forEach((value, index) => expect(value).toBeCloseTo(theirs[index]!, 12));
  });
});

// ---------------------------------------------------------------------------
// (f) 确定性 / 记录 / round-trip / 指纹
// ---------------------------------------------------------------------------

describe("评估器记录：确定性 / round-trip / 指纹", () => {
  it("同输入两次评估结果与 fingerprint 完全一致（确定性）", () => {
    const first = evaluatePerformance({ equityCurve: MAIN_CURVE });
    const second = evaluatePerformance({ equityCurve: MAIN_CURVE });
    expect(second).toEqual(first);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.inputFingerprint).toBe(first.inputFingerprint);
  });

  it("记录回显：参数/输入边界/kind/version 正确", () => {
    const record = evaluatePerformance({ equityCurve: MAIN_CURVE, trades: [] });
    expect(record.recordKind).toBe("PERFORMANCE_EVALUATION_RUN");
    expect(record.recordVersion).toBe(1);
    expect(record.annualizationFactor).toBe(252);
    expect(record.drawdownThresholdPct).toBe(5);
    expect(record.downsideTarget).toBe(0);
    expect(record.input.equityCurvePointCount).toBe(10);
    expect(record.input.startDate).toBe("2024-01-01");
    expect(record.input.endDate).toBe("2024-01-12");
    expect(record.input.tradeCount).toBe(0);
  });

  it("trades 未提供时 tradeCount = null，且影响输入绑定指纹", () => {
    const withTrades = evaluatePerformance({ equityCurve: MAIN_CURVE, trades: [] });
    const withoutTrades = evaluatePerformance({ equityCurve: MAIN_CURVE });
    expect(withTrades.input.tradeCount).toBe(0);
    expect(withoutTrades.input.tradeCount).toBeNull();
    expect(withTrades.inputFingerprint).not.toBe(withoutTrades.inputFingerprint);
    expect(withTrades.fingerprint).not.toBe(withoutTrades.fingerprint);
    // 指标（与 trades 无关）应一致
    expect(withTrades.metrics).toEqual(withoutTrades.metrics);
  });

  it("输入指纹绑定：修改任一权益点 → inputFingerprint 与指标随之改变", () => {
    const original = evaluatePerformance({ equityCurve: MAIN_CURVE });
    const mutated = curve(MAIN_DATES, [...MAIN_EQUITIES.slice(0, 9), 115]);
    const after = evaluatePerformance({ equityCurve: mutated });
    expect(computeInputFingerprint({ equityCurve: mutated })).not.toBe(
      computeInputFingerprint({ equityCurve: MAIN_CURVE })
    );
    expect(after.fingerprint).not.toBe(original.fingerprint);
    expect(after.metrics.returns.endEquity).toBe(115);
  });

  it("round-trip：serialize → deserialize 内容不变、指纹复核通过", () => {
    const record = evaluatePerformance({ equityCurve: MAIN_CURVE });
    const json = serializePerformanceEvaluationRun(record);
    const restored = deserializePerformanceEvaluationRun(json);
    expect(restored).toEqual(record);
    expect(restored.fingerprint).toBe(record.fingerprint);
  });

  it("反序列化复核：篡改指标字段 → 指纹不匹配抛错", () => {
    const record = evaluatePerformance({ equityCurve: MAIN_CURVE });
    const parsed: Record<string, unknown> = JSON.parse(
      serializePerformanceEvaluationRun(record)
    );
    const metrics = parsed.metrics as { returns: { totalReturnPct: number } };
    metrics.returns.totalReturnPct += 1;
    const tampered = JSON.stringify(parsed);
    expect(() => deserializePerformanceEvaluationRun(tampered)).toThrow(/指纹不匹配/);
  });

  it("记录指纹可独立重算（防篡改契约暴露）", () => {
    const record = evaluatePerformance({ equityCurve: MAIN_CURVE });
    expect(computePerformanceEvaluationRunFingerprint(record)).toBe(record.fingerprint);
  });

  it("结果不可变：metrics 对象被深冻结", () => {
    const record = evaluatePerformance({ equityCurve: MAIN_CURVE });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.metrics)).toBe(true);
    expect(Object.isFrozen(record.metrics.returns)).toBe(true);
    expect(() => {
      (record.metrics.returns as { totalReturnPct: number }).totalReturnPct = 999;
    }).toThrow();
  });

  it("analyzeDrawdown 导出的独立纯函数与 computePerformanceMetrics 结果一致", () => {
    const analysis = analyzeDrawdown(MAIN_CURVE);
    const metrics = computePerformanceMetrics({ equityCurve: MAIN_CURVE });
    expect(analysis.maxDrawdownPct).toBe(metrics.drawdown.maxDrawdownPct);
    expect(analysis.maxDrawdownSegment).toEqual(metrics.drawdown.maxDrawdownSegment);
    // allSegments = 全部回撤段（不按阈值过滤），默认阈值 5% 过滤后更少或相等
    expect(analysis.allSegments.length).toBeGreaterThanOrEqual(
      metrics.drawdown.drawdownSegments.length
    );
  });
});

// ---------------------------------------------------------------------------
// (g) 与真实 C-14.1 TradeSimulationRun 记录的字段形状对接（类型级冒烟）
// ---------------------------------------------------------------------------

describe("与 simulator 类型的字段形状对接", () => {
  it("真实 Trade 记录字段可被评估器接收（编译期类型契约）", () => {
    const trades: Trade[] = [
      {
        securityId: "TEST.SH",
        entryTime: "2024-01-02",
        entryPrice: 10,
        exitTime: "2024-01-08",
        exitPrice: 11,
        quantity: 1000,
        grossPnL: 1000,
        fees: 10,
        slippageAmount: 0,
        netPnl: 990,
        returnPct: 9.9,
        holdingPeriod: 4,
        openAtEnd: false,
        reason: null,
      },
    ];
    const record = evaluatePerformance({ equityCurve: MAIN_CURVE, trades });
    expect(record.input.tradeCount).toBe(1);
    expect(record.metrics.returns.totalReturnPct).toBeCloseTo(10, 9);
  });
});
