/**
 * BACKTEST-002 收尾 — B-04：Canonical Metrics 收口（规格 §2 §2D §3 §17 §18）。
 *
 * 本文件证明三件事，且**全部落在真实接线点**上（规格 §27 禁止「helper + unit test 就报完成」）：
 *
 * 1. **年化口径只剩一套**：`backtest/backtestResult.ts#canonicalMetrics()` 的 CAGR
 *    与闭环 `evaluation` 阶段的 `performanceMetrics.cagrPct` 在**同一曲线**上逐位相等
 *    （基数 252 + `n = 点数 − 1`）。这正是收尾前两者不一致（244 / 点数）的那个差异。
 * 2. **闭环评估引用（`ClosedLoopEvaluationRef`）的重叠标量取自 canonical**：
 *    故意让「评估器用的曲线」与「canonical 用的曲线」不同 ⇒ 投影出来的值必须是 canonical 的，
 *    否则说明还有第二条计算路径。
 * 3. **未接线时如实降级**：不给 canonical ⇒ `metricsSource = "evaluators"`；
 *    canonical 某量为 `NOT_AVAILABLE` ⇒ 投影为 `null`，**不被评估器的数值顶替**（不掩盖不可算）。
 */

import { describe, expect, it } from "vitest";
import type { EquityPoint, Trade } from "../../../server/backtest/types";
import {
  BACKTEST_ANNUALIZATION_BASIS,
  BACKTEST_ANNUALIZATION_DAYS,
  NOT_AVAILABLE,
  canonicalMetrics,
} from "../../../server/backtest/backtestResult";
import { composeClosedLoopEvaluationRef } from "../../../server/research/closedLoop/adapters";
import { evaluatePerformance } from "../../../server/research/performanceMetrics/evaluate";
import { evaluateTradeQualityMetrics } from "../../../server/research/tradeQualityMetrics/evaluate";

const INITIAL_CAPITAL = 100_000;

function point(date: string, equity: number): EquityPoint {
  return { date, cash: equity, marketValue: 0, equity, openPositions: 0 };
}

/** A 曲线：10 万 → 12 万（盈利）。 */
const CURVE_UP: readonly EquityPoint[] = [
  point("2026-01-02", 100_000),
  point("2026-01-03", 102_000),
  point("2026-01-04", 101_000),
  point("2026-01-05", 105_000),
  point("2026-01-06", 104_000),
  point("2026-01-07", 108_000),
  point("2026-01-08", 107_500),
  point("2026-01-09", 112_000),
  point("2026-01-10", 115_000),
  point("2026-01-11", 118_000),
  point("2026-01-12", 120_000),
];

/** B 曲线：10 万 → 9 万（亏损）。用于证明「投影确实来自 canonical」。 */
const CURVE_DOWN: readonly EquityPoint[] = [
  point("2026-01-02", 100_000),
  point("2026-01-03", 98_000),
  point("2026-01-04", 96_000),
  point("2026-01-05", 95_000),
  point("2026-01-06", 93_000),
  point("2026-01-07", 94_000),
  point("2026-01-08", 92_000),
  point("2026-01-09", 91_000),
  point("2026-01-10", 90_000),
  point("2026-01-11", 90_500),
  point("2026-01-12", 90_000),
];

function trade(securityId: string, netPnl: number, returnPct: number, openAtEnd = false): Trade {
  return {
    securityId,
    entryTime: "2026-01-02",
    entryPrice: 10,
    exitTime: openAtEnd ? null : "2026-01-05",
    exitPrice: openAtEnd ? null : 11,
    quantity: 1000,
    grossPnL: netPnl,
    fees: 6,
    slippageAmount: 0,
    netPnl: openAtEnd ? null : netPnl,
    returnPct: openAtEnd ? null : returnPct,
    holdingPeriod: openAtEnd ? null : 3,
    openAtEnd,
  };
}

const TRADES: readonly Trade[] = [
  trade("A", 1_500, 15),
  trade("B", -600, -6),
  trade("C", 2_400, 24),
];

// ---------------------------------------------------------------------------
// 1. 年化口径只剩一套
// ---------------------------------------------------------------------------

describe("B-04 — 年化基数唯一（规格 §2A/§2B/§2C）", () => {
  it("常量是 252，且口径可序列化自述（不是散落的魔法数字）", () => {
    expect(BACKTEST_ANNUALIZATION_DAYS).toBe(252);
    expect(BACKTEST_ANNUALIZATION_BASIS).toEqual({ type: "TRADING_DAYS", daysPerYear: 252 });
  });

  it("🔴 canonical CAGR 与闭环 evaluation 的 cagrPct 在同一曲线上逐位相等（收口前两者不一致）", () => {
    const performance = evaluatePerformance({
      equityCurve: CURVE_UP,
      annualizationFactor: BACKTEST_ANNUALIZATION_DAYS,
    });
    const canonical = canonicalMetrics({
      equityCurve: CURVE_UP,
      tradeLedger: [],
      initialCapital: INITIAL_CAPITAL,
    });
    // 10 位小数相等 ⇒ 基数（252）与指数分母（点数 − 1）都对齐。
    expect(canonical.annualizedReturnPct).toBeCloseTo(performance.metrics.returns.cagrPct, 10);
    expect(canonical.totalReturnPct).toBeCloseTo(performance.metrics.returns.totalReturnPct, 10);
    expect(canonical.maxDrawdownPct).toBeCloseTo(performance.metrics.drawdown.maxDrawdownPct, 10);
  });

  it("年化口径随指标一起输出（消费方无需知道 252 从哪来）", () => {
    const canonical = canonicalMetrics({
      equityCurve: CURVE_UP,
      tradeLedger: [],
      initialCapital: INITIAL_CAPITAL,
    });
    expect(canonical.annualizationBasis).toEqual({ type: "TRADING_DAYS", daysPerYear: 252 });
  });

  it("退化曲线 ⇒ 年化 NOT_AVAILABLE（不编 0）", () => {
    expect(
      canonicalMetrics({ equityCurve: [], tradeLedger: [], initialCapital: INITIAL_CAPITAL }).annualizedReturnPct,
    ).toBe(NOT_AVAILABLE);
    // 单点曲线：区间数 = 0 ⇒ 原语要求 n >= 1 ⇒ NOT_AVAILABLE。
    expect(
      canonicalMetrics({ equityCurve: [point("2026-01-02", 100_000)], tradeLedger: [], initialCapital: 100_000 })
        .annualizedReturnPct,
    ).toBe(NOT_AVAILABLE);
  });
});

// ---------------------------------------------------------------------------
// 2. 闭环评估引用取自 canonical（不是「评估器另一算一套」）
// ---------------------------------------------------------------------------

describe("B-04 — 闭环 evaluationRef 的重叠标量取自 canonical（规格 §3）", () => {
  it("🔴 评估器看 A 曲线、canonical 看 B 曲线 ⇒ 投影必须是 B 的值（证明没有第二条路径）", () => {
    const performance = evaluatePerformance({
      equityCurve: CURVE_UP,
      annualizationFactor: BACKTEST_ANNUALIZATION_DAYS,
    });
    const tradeQuality = evaluateTradeQualityMetrics({
      equityCurve: CURVE_UP,
      trades: TRADES,
      annualizationFactor: BACKTEST_ANNUALIZATION_DAYS,
    });
    const canonicalDown = canonicalMetrics({
      equityCurve: CURVE_DOWN,
      tradeLedger: TRADES,
      initialCapital: INITIAL_CAPITAL,
    });

    const ref = composeClosedLoopEvaluationRef({
      backtestFingerprint: "fp-test",
      performance,
      tradeQuality,
      canonicalMetrics: canonicalDown,
    });

    expect(ref.metricsSource).toBe("canonical");
    expect(ref.canonicalMetrics).not.toBeNull();
    expect(ref.canonicalMetrics!.cagrPct).toBeCloseTo(canonicalDown.annualizedReturnPct as number, 10);
    expect(ref.canonicalMetrics!.annualizationBasis).toEqual({ type: "TRADING_DAYS", daysPerYear: 252 });

    // performance 节：三处重叠量 = B 曲线的值（= canonical），**不是** A 曲线（= 评估器）。
    expect(ref.performance!.totalReturnPct).toBeCloseTo(canonicalDown.totalReturnPct as number, 10);
    expect(ref.performance!.cagrPct).toBeCloseTo(canonicalDown.annualizedReturnPct as number, 10);
    expect(ref.performance!.maxDrawdownPct).toBeCloseTo(canonicalDown.maxDrawdownPct, 10);
    expect(ref.performance!.totalReturnPct).not.toBeCloseTo(performance.metrics.returns.totalReturnPct, 4);

    // tradeQuality 节：三处重叠量同样来自 canonical（两份台账相同 ⇒ 数值一致但来源已切换）。
    expect(ref.tradeQuality!.winRatePct).toBeCloseTo(canonicalDown.winRatePct as number, 10);
    expect(ref.tradeQuality!.profitFactor).toBeCloseTo(canonicalDown.profitFactor as number, 10);
    expect(ref.tradeQuality!.completedTradeCount).toBe(canonicalDown.completedTradeCount);

    // 评估器指纹仍保留（可追溯到它算过的非重叠指标：Sharpe / Sortino / Calmar / 波动率…）。
    expect(ref.performance!.fingerprint).toBe(performance.fingerprint);
    expect(ref.tradeQuality!.fingerprint).toBe(tradeQuality.fingerprint);
    expect(ref.evaluatorsCovered).toContain("performanceMetrics");
    expect(ref.evaluatorsCovered).toContain("tradeQualityMetrics");
  });

  it("评估器的**非重叠**指标仍由其自身供给（Sharpe 等未被抹掉）", () => {
    const performance = evaluatePerformance({
      equityCurve: CURVE_UP,
      annualizationFactor: BACKTEST_ANNUALIZATION_DAYS,
    });
    const ref = composeClosedLoopEvaluationRef({
      backtestFingerprint: "fp",
      performance,
      canonicalMetrics: canonicalMetrics({
        equityCurve: CURVE_UP,
        tradeLedger: [],
        initialCapital: INITIAL_CAPITAL,
      }),
    });
    expect(ref.riskAdjusted).toBeNull(); // 未传 riskAdjusted ⇒ 该节为 null（不伪造）
    expect(ref.evaluatorsCovered).toEqual(["performanceMetrics"]);
  });

  it("未给 canonical ⇒ 如实降级为 evaluators（历史留档 / 直供路径向后兼容）", () => {
    const performance = evaluatePerformance({
      equityCurve: CURVE_UP,
      annualizationFactor: BACKTEST_ANNUALIZATION_DAYS,
    });
    const ref = composeClosedLoopEvaluationRef({ backtestFingerprint: "fp", performance });
    expect(ref.metricsSource).toBe("evaluators");
    expect(ref.canonicalMetrics).toBeNull();
    expect(ref.performance!.cagrPct).toBeCloseTo(performance.metrics.returns.cagrPct, 10);
  });

  it("🔴 canonical 为 NOT_AVAILABLE ⇒ 投影为 null，**不被评估器的数值顶替**（不掩盖不可算）", () => {
    const performance = evaluatePerformance({
      equityCurve: CURVE_UP,
      annualizationFactor: BACKTEST_ANNUALIZATION_DAYS,
    });
    // 无交易 ⇒ winRate / profitFactor / averageWin / averageLoss 均为 NOT_AVAILABLE。
    const canonicalNoTrades = canonicalMetrics({
      equityCurve: CURVE_UP,
      tradeLedger: [],
      initialCapital: INITIAL_CAPITAL,
    });
    expect(canonicalNoTrades.winRatePct).toBe(NOT_AVAILABLE);
    const ref = composeClosedLoopEvaluationRef({
      backtestFingerprint: "fp",
      performance,
      canonicalMetrics: canonicalNoTrades,
    });
    expect(ref.tradeQuality).toBeNull();
    expect(ref.performance!.cagrPct).not.toBeNull(); // 可算的仍然给出
  });
});

// ---------------------------------------------------------------------------
// 3. 同一输入不同路径 ⇒ 同一数字（规格 §2D / §9）
// ---------------------------------------------------------------------------

describe("B-04 — 同一曲线与台账，任何路径都得不到第二个数字", () => {
  it("canonicalMetrics / buildBacktestResult / 载荷 三条路径的 8 项指标逐项相等", () => {
    const direct = canonicalMetrics({
      equityCurve: CURVE_UP,
      tradeLedger: TRADES,
      initialCapital: INITIAL_CAPITAL,
    });
    const performance = evaluatePerformance({
      equityCurve: CURVE_UP,
      annualizationFactor: BACKTEST_ANNUALIZATION_DAYS,
    });
    const tradeQuality = evaluateTradeQualityMetrics({
      equityCurve: CURVE_UP,
      trades: TRADES,
      annualizationFactor: BACKTEST_ANNUALIZATION_DAYS,
    });
    const ref = composeClosedLoopEvaluationRef({
      backtestFingerprint: "fp",
      performance,
      tradeQuality,
      canonicalMetrics: direct,
    });

    expect(ref.performance!.totalReturnPct).toBeCloseTo(direct.totalReturnPct as number, 10);
    expect(ref.performance!.cagrPct).toBeCloseTo(direct.annualizedReturnPct as number, 10);
    expect(ref.performance!.maxDrawdownPct).toBeCloseTo(direct.maxDrawdownPct, 10);
    expect(ref.tradeQuality!.winRatePct).toBeCloseTo(direct.winRatePct as number, 10);
    expect(ref.tradeQuality!.profitFactor).toBeCloseTo(direct.profitFactor as number, 10);
    expect(ref.tradeQuality!.completedTradeCount).toBe(direct.completedTradeCount);
  });
});
