/**
 * STEP 16 / C-16.2 — 策略评价·风险调整指标（Sharpe / Sortino / Calmar）测试。
 *
 * 全部 fixture 手工构造（确定性、可手算），覆盖：
 *   (a) Sharpe：手算断言（mean(e)/sampleStd × √252）、与 shared sharpeRatio 逐位一致、
 *       与 STEP 8 computeMetrics.sharpeRatio 同输入对照、rf 使分子归零、年化因子缩放、
 *       零波动 → null；
 *   (b) Sortino / 下行偏差：下行偏差手算（总体口径）、Sortino 手算、downsideTarget 过滤、
 *       无低于目标回落 → null、样本 < 2 门控；
 *   (c) Calmar：CAGR/|MaxDD| 手算、无回撤 → null、负 CAGR 有限负值；
 *   (d) 记录：确定性 / 深冻结 / round-trip / 防篡改 / 与 C-16.1 记录字段与指纹对齐；
 *   (e) 退化/非法输入响亮抛错（空/单点曲线、非法 rf/ann/downsideTarget）。
 */

import { describe, expect, it } from "vitest";
import { sharpeRatio } from "../../../shared/quant-stats";
import { computeMetrics } from "../../backtest/metrics";
import type { EquityPoint } from "../../backtest/types";
import {
  PerformanceEvaluationError,
  computePerformanceMetrics,
  evaluatePerformance,
} from "../performanceMetrics";
import {
  RISK_ADJUSTED_EVALUATION_RUN_KIND,
  RISK_ADJUSTED_EVALUATION_RUN_RECORD_VERSION,
  assertValidRiskAdjustedEvaluationRun,
  computeCalmarRatio,
  computeDownsideDeviationPct,
  computeRiskAdjustedMetrics,
  computeSharpeRatio,
  computeSortinoRatio,
  deserializeRiskAdjustedEvaluationRun,
  evaluateRiskAdjustedMetrics,
  serializeRiskAdjustedEvaluationRun,
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

function expectErrorCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PerformanceEvaluationError);
    expect((error as PerformanceEvaluationError).code).toBe(code);
    return;
  }
  throw new Error(`期望抛错但未抛（code=${code}）`);
}

// ---------------------------------------------------------------------------
// 主 fixture（手工可算）
// ---------------------------------------------------------------------------
// 日收益 R = [0.10, −0.05, 0.10]（均值 0.05，样本方差 0.0075，std = √0.0075）。
// equity 路径：100 → 110 → 104.5 → 114.95。
const SHARPE_RETURNS = [0.1, -0.05, 0.1];
const SHARPE_EQUITIES = [100, 110, 104.5, 114.95];
const SHARPE_CURVE = curve(consecutiveDates(4), SHARPE_EQUITIES);

// 日收益 SR = [0.01, −0.02, 0.03, −0.04]（均值 −0.005；下行平方和 0.002 → dd = √0.0005）。
const SORTINO_RETURNS = [0.01, -0.02, 0.03, -0.04];
const SORTINO_EQUITIES = [100, 101, 98.98, 101.9494, 97.871424];
const SORTINO_CURVE = curve(consecutiveDates(5), SORTINO_EQUITIES);

// ---------------------------------------------------------------------------
// (a) Sharpe
// ---------------------------------------------------------------------------

describe("Sharpe", () => {
  it("手算：R=[0.1,−0.05,0.1] → mean/std×√252 = (0.05/√0.0075)×√252，且 rf=0 时与 shared sharpeRatio 逐位一致", () => {
    const expected = (0.05 / Math.sqrt(0.0075)) * Math.sqrt(252);
    const actual = computeSharpeRatio(SHARPE_RETURNS);
    expect(actual).toBeCloseTo(expected, 9);
    // rf 默认 0 → 超额 = 原收益 → 与 shared 原语逐位一致（STEP 8 锚点）。
    expect(actual).toBe(sharpeRatio(SHARPE_RETURNS, 252));
  });

  it("记录级同 fixture：metrics.sharpeRatio 与手算一致，并与 STEP 8 computeMetrics.sharpeRatio 同输入对照", () => {
    const metrics = computeRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE });
    const expected = (0.05 / Math.sqrt(0.0075)) * Math.sqrt(252);
    expect(metrics.sharpeRatio).toBeCloseTo(expected, 9);
    // STEP 8 生产口径：锚点 initialCapital=100 == 曲线首点，rf=0，公式一致。
    // （STEP 8 输出 round 到 4 位小数；本任务不 round，故对照到 1e-3 级即可，同 C-16.1 惯例。）
    const m8 = computeMetrics({
      equityCurve: SHARPE_CURVE,
      trades: [],
      initialCapital: 100,
    });
    expect(metrics.sharpeRatio).toBeCloseTo(m8.sharpeRatio ?? Number.NaN, 3);
  });

  it("rf 生效：rfAnnualPct = mean(R)×252×100 = 1260 时超额分子归零 → Sharpe ≈ 0", () => {
    const meanDaily = 0.05;
    const rfAnnualPct = meanDaily * 252 * 100; // 1260（%）
    const actual = computeSharpeRatio(SHARPE_RETURNS, { rfAnnualPct });
    expect(actual).toBeCloseTo(0, 8);
  });

  it("年化因子缩放：ann 63 的 Sharpe = ann 252 的 √(63/252) = 0.5 倍", () => {
    const at252 = computeSharpeRatio(SHARPE_RETURNS, { annualizationFactor: 252 })!;
    const at63 = computeSharpeRatio(SHARPE_RETURNS, { annualizationFactor: 63 })!;
    expect(at252 / at63).toBeCloseTo(2, 9);
    // Sortino 同比例（分子含 ann、分母含 √ann → 净 √ann 缩放）。
    const sortino252 = computeSortinoRatio(SORTINO_RETURNS, { annualizationFactor: 252 })!;
    const sortino63 = computeSortinoRatio(SORTINO_RETURNS, { annualizationFactor: 63 })!;
    expect(sortino252 / sortino63).toBeCloseTo(2, 9);
  });

  it("零波动（样本标准差恰为 0）→ Sharpe = null（绝不返回 Infinity）", () => {
    // 全零收益：方差恰为 0 → shared sharpeRatio 返回 null。
    // 注：非零常数序列（如 [0.1,0.1,0.1]）因浮点均值漂移产生极小微方差，按 shared
    // 原语语义 std≠0 处理（非本层定义范围），此处只锁定严格零方差场景。
    expect(computeSharpeRatio([0, 0, 0])).toBeNull();
    // 平坦曲线记录级：日收益全为 0 → Sharpe/Sortino/Calmar 三 null，波动与下行偏差为 0，CAGR 为 0。
    const flat = curve(consecutiveDates(4), [100, 100, 100, 100]);
    const metrics = computeRiskAdjustedMetrics({ equityCurve: flat });
    expect(metrics.sharpeRatio).toBeNull();
    expect(metrics.sortinoRatio).toBeNull();
    expect(metrics.calmarRatio).toBeNull();
    expect(metrics.annualizedVolatilityPct).toBe(0);
    expect(metrics.downsideDeviationPct).toBe(0);
    expect(metrics.cagrPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) Sortino / 下行偏差
// ---------------------------------------------------------------------------

describe("Sortino 与下行偏差", () => {
  it("下行偏差手算：SR=[0.01,−0.02,0.03,−0.04] → dd=√((0.0004+0.0016)/4)=√0.0005；Sortino = −0.005×252/(dd×√252)", () => {
    const ddDaily = Math.sqrt(0.0005);
    expect(computeDownsideDeviationPct(SORTINO_RETURNS)).toBeCloseTo(
      ddDaily * Math.sqrt(252) * 100,
      9
    );
    const expectedSortino = (-0.005 * 252) / (ddDaily * Math.sqrt(252));
    expect(computeSortinoRatio(SORTINO_RETURNS)).toBeCloseTo(expectedSortino, 9);
    // 记录级：同一 equity 路径产物与 C-16.1 risk.downsideDeviationPct（rf=0/target=0）同值。
    const metrics = computeRiskAdjustedMetrics({ equityCurve: SORTINO_CURVE });
    const ours16 = computePerformanceMetrics({ equityCurve: SORTINO_CURVE });
    expect(metrics.sortinoRatio).toBeCloseTo(expectedSortino, 9);
    expect(metrics.downsideDeviationPct).toBeCloseTo(ours16.risk.downsideDeviationPct, 9);
  });

  it("downsideTarget 过滤：target=−0.01 时只计 −0.02/−0.04 → dd=√(0.001/4)=√0.00025", () => {
    const ddDaily = Math.sqrt(0.001 / 4);
    const expectedSortino = (-0.005 * 252) / (ddDaily * Math.sqrt(252));
    expect(computeDownsideDeviationPct(SORTINO_RETURNS, { downsideTarget: -0.01 })).toBeCloseTo(
      ddDaily * Math.sqrt(252) * 100,
      9
    );
    expect(computeSortinoRatio(SORTINO_RETURNS, { downsideTarget: -0.01 })).toBeCloseTo(
      expectedSortino,
      9
    );
  });

  it("全部收益高于目标 → 下行偏差 0、Sortino = null（分母无定义），但 Sharpe 仍可算", () => {
    const allPositive = curve(consecutiveDates(4), [100, 105, 110, 120]);
    const metrics = computeRiskAdjustedMetrics({ equityCurve: allPositive });
    expect(computeSortinoRatio([0.05, 0.02, 0.01])).toBeNull();
    expect(metrics.sortinoRatio).toBeNull();
    expect(metrics.downsideDeviationPct).toBe(0);
    expect(metrics.sharpeRatio).not.toBeNull();
    expect(metrics.sharpeRatio!).toBeGreaterThan(0);
    expect(metrics.calmarRatio).toBeNull(); // 单调上升 → 无回撤
  });

  it("日收益样本 < 2（两点曲线）→ Sharpe/Sortino/年化波动均 null，下行偏差成分仍可定义", () => {
    expect(computeSharpeRatio([0.1])).toBeNull();
    expect(computeSortinoRatio([0.1])).toBeNull();
    expect(computeDownsideDeviationPct([])).toBeNull(); // 无有限样本 → null
    const twoPoint = curve(["2024-01-01", "2024-01-02"], [100, 110]);
    const metrics = computeRiskAdjustedMetrics({ equityCurve: twoPoint });
    expect(metrics.sharpeRatio).toBeNull();
    expect(metrics.sortinoRatio).toBeNull();
    expect(metrics.annualizedVolatilityPct).toBeNull();
    expect(metrics.calmarRatio).toBeNull(); // 无回撤
    expect(metrics.downsideDeviationPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (c) Calmar
// ---------------------------------------------------------------------------

describe("Calmar", () => {
  it("手算：equity 100→120→108→130、ann=3 → CAGR=(130/100)^(3/3)−1=30%，MaxDD=(120−108)/120=10% → Calmar=3", () => {
    const calmarCurve = curve(consecutiveDates(4), [100, 120, 108, 130]);
    const metrics = computeRiskAdjustedMetrics({
      equityCurve: calmarCurve,
      annualizationFactor: 3,
    });
    expect(metrics.cagrPct).toBeCloseTo(30, 9);
    expect(metrics.maxDrawdownPct).toBeCloseTo(10, 9);
    expect(metrics.calmarRatio).toBeCloseTo(3, 9);
    // 纯函数等价：CAGR(小数)/|MaxDD|(小数)
    expect(computeCalmarRatio(0.3, 0.1)).toBeCloseTo(3, 9);
  });

  it("无回撤 → Calmar = null（分母 0，显式信号）；单调上升虽 CAGR>0 亦然", () => {
    expect(computeCalmarRatio(0.2, 0)).toBeNull();
    expect(computeCalmarRatio(0, 0)).toBeNull();
    const monotonic = curve(consecutiveDates(4), [100, 110, 121, 133.1]);
    const metrics = computeRiskAdjustedMetrics({ equityCurve: monotonic });
    expect(metrics.cagrPct).toBeGreaterThan(0);
    expect(metrics.maxDrawdownPct).toBe(0);
    expect(metrics.calmarRatio).toBeNull();
  });

  it("负 CAGR + 回撤：两点曲线 100→90、ann=3 → CAGR=(0.9)^3−1=−27.1%，MaxDD=10% → Calmar≈−2.71（有限负值）", () => {
    const twoPoint = curve(["2024-01-01", "2024-01-02"], [100, 90]);
    const metrics = computeRiskAdjustedMetrics({
      equityCurve: twoPoint,
      annualizationFactor: 3,
    });
    expect(metrics.cagrPct).toBeCloseTo((0.9 ** 3 - 1) * 100, 9);
    expect(metrics.maxDrawdownPct).toBeCloseTo(10, 9);
    expect(metrics.calmarRatio).toBeCloseTo((0.9 ** 3 - 1) / 0.1, 9);
    // 同一记录里：单收益区间使 Sharpe/Sortino 为 null（门控），Calmar 仍定义。
    expect(metrics.sharpeRatio).toBeNull();
    expect(metrics.sortinoRatio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) 记录：确定性 / round-trip / 防篡改 / 与 C-16.1 对齐
// ---------------------------------------------------------------------------

describe("评估器记录：确定性 / round-trip / 指纹", () => {
  it("同输入两次评估结果与 fingerprint 完全一致（确定性），且产物深冻结", () => {
    const first = evaluateRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE });
    const second = evaluateRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE });
    expect(second).toEqual(first);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.metrics)).toBe(true);
    expect(() => {
      (second.metrics as { sharpeRatio: number | null }).sharpeRatio = 999;
    }).toThrow();
  });

  it("记录回显：kind/version/参数默认（ann=252, rf=0, downsideTarget=0）/输入边界，inputFingerprint 与 C-16.1 同载荷一致", () => {
    const record = evaluateRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE, trades: [] });
    expect(record.recordKind).toBe(RISK_ADJUSTED_EVALUATION_RUN_KIND);
    expect(record.recordVersion).toBe(RISK_ADJUSTED_EVALUATION_RUN_RECORD_VERSION);
    expect(record.annualizationFactor).toBe(252);
    expect(record.rfAnnualPct).toBe(0);
    expect(record.downsideTarget).toBe(0);
    expect(record.input.equityCurvePointCount).toBe(4);
    expect(record.input.tradeCount).toBe(0);
    // 与 C-16.1 同曲线同 trades 的输入绑定指纹逐位一致（复用同一 computeInputFingerprint）。
    const run16 = evaluatePerformance({ equityCurve: SHARPE_CURVE, trades: [] });
    expect(record.inputFingerprint).toBe(run16.inputFingerprint);
    // trades 缺省 → tradeCount null 且指纹改变（对齐 C-16.1 语义）。
    const withoutTrades = evaluateRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE });
    expect(withoutTrades.input.tradeCount).toBeNull();
    expect(withoutTrades.inputFingerprint).not.toBe(record.inputFingerprint);
  });

  it("round-trip：serialize → deserialize 内容不变、指纹复核通过；篡改指标 → 指纹不匹配抛错", () => {
    const record = evaluateRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE });
    const json = serializeRiskAdjustedEvaluationRun(record);
    const restored = deserializeRiskAdjustedEvaluationRun(json);
    expect(restored).toEqual(record);
    expect(restored.fingerprint).toBe(record.fingerprint);
    assertValidRiskAdjustedEvaluationRun(restored);

    const parsed: Record<string, unknown> = JSON.parse(json);
    const metrics = parsed.metrics as { sharpeRatio: number | null };
    metrics.sharpeRatio = (metrics.sharpeRatio ?? 0) + 1;
    expect(() => deserializeRiskAdjustedEvaluationRun(JSON.stringify(parsed))).toThrow(
      /指纹不匹配/
    );
  });

  it("与 C-16.1 同曲线同口径的成分指标一致（CAGR/MaxDD/年化波动/下行偏差继承 C-16.1 口径）", () => {
    const ours = computeRiskAdjustedMetrics({ equityCurve: SORTINO_CURVE });
    const theirs = computePerformanceMetrics({ equityCurve: SORTINO_CURVE });
    expect(ours.cagrPct).toBeCloseTo(theirs.returns.cagrPct, 9);
    expect(ours.maxDrawdownPct).toBeCloseTo(theirs.drawdown.maxDrawdownPct, 9);
    expect(ours.annualizedVolatilityPct ?? Number.NaN).toBeCloseTo(
      theirs.risk.annualizedVolatilityPct ?? Number.NaN,
      9
    );
    expect(ours.downsideDeviationPct).toBeCloseTo(theirs.risk.downsideDeviationPct, 9);
  });
});

// ---------------------------------------------------------------------------
// (e) 退化 / 非法输入：响亮抛错
// ---------------------------------------------------------------------------

describe("退化与非法输入", () => {
  it("空 / 单点曲线 → INSUFFICIENT_EQUITY_CURVE（复用 C-16.1 校验）", () => {
    expectErrorCode(() => computeRiskAdjustedMetrics({ equityCurve: [] }), "INSUFFICIENT_EQUITY_CURVE");
    expectErrorCode(
      () => evaluateRiskAdjustedMetrics({ equityCurve: [mkPoint("2024-01-01", 100)] }),
      "INSUFFICIENT_EQUITY_CURVE"
    );
  });

  it("非法口径参数 → INVALID_PARAMETER：rf/ann/downsideTarget 非有限、ann<=0、Calmar 负回撤", () => {
    expectErrorCode(
      () => computeRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE, rfAnnualPct: Number.NaN }),
      "INVALID_PARAMETER"
    );
    expectErrorCode(
      () => computeRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE, rfAnnualPct: Number.POSITIVE_INFINITY }),
      "INVALID_PARAMETER"
    );
    expectErrorCode(
      () => computeRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE, annualizationFactor: 0 }),
      "INVALID_PARAMETER"
    );
    expectErrorCode(
      () => computeRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE, downsideTarget: Number.NEGATIVE_INFINITY }),
      "INVALID_PARAMETER"
    );
    expectErrorCode(
      () => evaluateRiskAdjustedMetrics({ equityCurve: SHARPE_CURVE, rfAnnualPct: Number.NaN }),
      "INVALID_PARAMETER"
    );
    expectErrorCode(() => computeCalmarRatio(0.2, -0.1), "INVALID_PARAMETER");
    expectErrorCode(() => computeCalmarRatio(Number.NaN, 0.1), "INVALID_PARAMETER");
  });

  it("computeCalmarRatio / computeSharpeRatio 对合法输入不抛错且确定性可复现", () => {
    expect(computeCalmarRatio(0.3, 0.1)).toBe(computeCalmarRatio(0.3, 0.1));
    expect(computeSharpeRatio(SHARPE_RETURNS, { rfAnnualPct: 2 })).toBe(
      computeSharpeRatio(SHARPE_RETURNS, { rfAnnualPct: 2 })
    );
  });
});
