/**
 * STEP 16 / C-16.3 — 策略评价·交易质量与稳定性指标测试。
 *
 * 全部 fixture 手工构造（确定性、可手算），覆盖：
 *   (a) 交易质量：WinRate / Profit Factor / Expectancy / AverageWin/AverageLoss /
 *       Trade Count 手算断言，且与 STEP 8 computeMetrics 同输入对照一致（复用口径）；
 *   (b) Turnover 公式（buy/sell/gross/averageEquity/区间与年化换手）手算；
 *   (c) Average Holding Period（交易日）手算 + 回退 trade.holdingPeriod 路径 +
 *       不可确定笔数显式计数；
 *   (d) 月度一致性：盈利月占比/中位数/最佳最差月/最大连亏月手算、空月不伪造、
 *       月度收益连乘 ≡ 区间总收益（望远镜恒等）；
 *   (e) 年度一致性：逐年收益/占比/最差年手算 + 年度连乘恒等；
 *   (f) regime：unassessed 占位（reasonCode 与 experimentLineage 一致）+
 *       assessed 扩展槽类型存在；
 *   (g) 退化输入：空/单点/非有限/非正/乱序曲线、非法参数、非法 trade 字段响亮抛错；
 *       无 trades / 空 trades / 全 open trades 结构化空态（无 NaN）；
 *   (h) 确定性 / round-trip / fingerprint 防篡改 / inputFingerprint 与 C-16.1 同载荷。
 */

import { describe, expect, it } from "vitest";
import type { EquityPoint, Trade } from "../../backtest/types";
import { computeMetrics } from "../../backtest/metrics";
import { computeInputFingerprint as computeInputFingerprint161 } from "../performanceMetrics/evaluate";
import {
  REGIME_UNASSESSED_REASON_CODE,
  DEFAULT_REGIME_UNASSESSED_REASON,
} from "../experimentLineage/types";
import {
  TRADE_QUALITY_EVALUATION_RUN_KIND,
  PerformanceEvaluationError,
  computeAverageHoldingPeriodDays,
  computeMonthlyConsistency,
  computeTradeQualityMetrics,
  computeTradeQualityRunFingerprint,
  computeTurnoverMetrics,
  computeYearlyConsistency,
  deserializeTradeQualityEvaluationRun,
  evaluateTradeQualityMetrics,
  isRegimeUnassessed,
  serializeTradeQualityEvaluationRun,
  unassessedRegimePerformance,
} from "./index";
import type {
  MonthlyConsistencyMetrics,
  TradeQualityRegimePerformance,
  YearlyConsistencyMetrics,
} from "./types";

// ---------------------------------------------------------------------------
// fixture 构建工具
// ---------------------------------------------------------------------------

function mkPoint(date: string, equity: number): EquityPoint {
  return { date, cash: equity, marketValue: 0, equity, openPositions: 0 };
}

function curve(dates: string[], equities: number[]): EquityPoint[] {
  if (dates.length !== equities.length) {
    throw new Error(`fixture: dates(${dates.length}) 与 equities(${equities.length}) 不等长`);
  }
  return dates.map((date, index) => mkPoint(date, equities[index]!));
}

/** 构造 Trade（未给字段用中性默认；每次独立对象）。 */
function mkTrade(over: Partial<Trade> = {}): Trade {
  const base: Trade = {
    securityId: "T.SH",
    entryTime: "2024-01-02",
    entryPrice: 10,
    exitTime: null,
    exitPrice: null,
    quantity: 100,
    grossPnL: null,
    fees: 0,
    slippageAmount: 0,
    netPnl: null,
    returnPct: null,
    holdingPeriod: null,
    openAtEnd: false,
    reason: null,
  };
  return { ...base, ...over };
}

// ---------------------------------------------------------------------------
// 主 fixture：可手算的 3 个月权益曲线 + 5 笔交易
// ---------------------------------------------------------------------------
// 权益曲线（7 点，日收益每步一个「实现日」）：
//   2024-01-02 1000
//   2024-01-03 1100  (+10%，实现于 01-03)
//   2024-01-31 1210  (+10%，实现于 01-31)   → 1月 连乘 1.21 = +21%（2 条）
//   2024-02-01 1089  (−10%，实现于 02-01)
//   2024-02-28  980.1 (−10%，实现于 02-28)   → 2月 连乘 0.81 = −19%（2 条）
//   2024-03-01 1029.105 (+5%，实现于 03-01)
//   2024-03-29 1080.56025 (+5%，实现于 03-29) → 3月 连乘 1.1025 = +10.25%（2 条）
// 总收益 = 1080.56025/1000 − 1 = +8.056025%（= 1.21×0.81×1.1025 − 1）
const THREE_MONTH_DATES = [
  "2024-01-02",
  "2024-01-03",
  "2024-01-31",
  "2024-02-01",
  "2024-02-28",
  "2024-03-01",
  "2024-03-29",
];
const THREE_MONTH_EQUITIES = [
  1000, 1100, 1210, 1089, 980.1, 1029.105, 1080.56025,
];
const THREE_MONTH_CURVE = curve(THREE_MONTH_DATES, THREE_MONTH_EQUITIES);
const THREE_MONTH_SUM_EQUITY = 7488.76525; // Σ 上表 equities

// 交易（含 1 笔 openAtEnd）：
//   完成 4 笔净盈亏：+190, +90, −620, +180 → 胜 3/4 = 75%；总盈 460、总亏 620；
//   PF = 460/620 ≈ 0.741935；expectancy = (−160)/4 = −40；
//   avgWin = 460/3 ≈ 153.3333；avgLoss = −620。
//   持仓（曲线索引差+1）：T1=2、T2=3、T3=2、T4=2 → 平均 2.25，covered=4。
//   换手：buy=9590、sell=7590、gross=17180；avgEquity = 7488.76525/7。
const TRADES: readonly Trade[] = [
  mkTrade({
    securityId: "A.SH",
    entryTime: "2024-01-02",
    entryPrice: 10,
    quantity: 100,
    exitTime: "2024-01-03",
    exitPrice: 12,
    grossPnL: 200,
    fees: 10,
    netPnl: 190,
    returnPct: 19,
    holdingPeriod: 2,
  }),
  mkTrade({
    securityId: "B.SH",
    entryTime: "2024-01-02",
    entryPrice: 10,
    quantity: 100,
    exitTime: "2024-01-31",
    exitPrice: 11,
    grossPnL: 100,
    fees: 10,
    netPnl: 90,
    returnPct: 9,
    holdingPeriod: 3,
  }),
  mkTrade({
    securityId: "C.SH",
    entryTime: "2024-02-01",
    entryPrice: 20,
    quantity: 200,
    exitTime: "2024-02-28",
    exitPrice: 17,
    grossPnL: -600,
    fees: 20,
    netPnl: -620,
    returnPct: -15.5,
    holdingPeriod: 2,
  }),
  mkTrade({
    securityId: "D.SH",
    entryTime: "2024-02-28",
    entryPrice: 17,
    quantity: 100,
    exitTime: "2024-03-01",
    exitPrice: 18.9,
    grossPnL: 190,
    fees: 10,
    netPnl: 180,
    returnPct: (180 / 1700) * 100,
    holdingPeriod: 2,
  }),
  mkTrade({
    securityId: "E.SH",
    entryTime: "2024-03-01",
    entryPrice: 18.9,
    quantity: 100,
    openAtEnd: true,
  }),
];

// 跨年曲线（2024 = +21%，2025 = −5.5%），月收益 4 条、缺失月不伪造。
const MULTI_YEAR_CURVE = curve(
  ["2023-12-29", "2024-01-31", "2024-12-31", "2025-06-30", "2025-12-31"],
  [1000, 1100, 1210, 1089, 1143.45]
);

// 单月多日曲线（只有 1 个日历月参与）。
const SINGLE_MONTH_CURVE = curve(
  ["2024-01-02", "2024-01-03", "2024-01-04"],
  [100, 110, 104.5]
);

// 跨 4 个日历月、权益恒定（全 0% 月）。
const FLAT_CURVE = curve(
  ["2024-01-31", "2024-02-29", "2024-03-29", "2024-04-30"],
  [100, 100, 100, 100]
);

function expectPerformanceError(fn: () => unknown, code: string): PerformanceEvaluationError {
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
// (a) 交易质量（WinRate/PF/Expectancy/Trade Count）手算
// ---------------------------------------------------------------------------

describe("交易质量指标（手算断言 + 与 STEP 8 对照一致）", () => {
  const metrics = computeTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: TRADES });

  it("完成/总交易数、胜率手算：75% = 3/4", () => {
    const quality = metrics.tradeQuality!;
    expect(quality.totalTradeCount).toBe(5);
    expect(quality.completedTradeCount).toBe(4);
    expect(quality.winRatePct).toBeCloseTo(75, 9);
  });

  it("Profit Factor / Expectancy / AverageWin / AverageLoss 手算", () => {
    const quality = metrics.tradeQuality!;
    // STEP 8 复用取值按 4 位小数 round：PF=round(460/620,4)=0.7419、avgWin=round(460/3,4)=153.3333。
    expect(quality.profitFactor).toBeCloseTo(460 / 620, 4);
    expect(quality.expectancy).toBeCloseTo(-40, 9);
    expect(quality.averageWin).toBeCloseTo(153.3333, 6);
    expect(quality.averageLoss).toBeCloseTo(-620, 9);
  });

  it("与 STEP 8 computeMetrics 同输入逐字段一致（复用口径，无第二套实现）", () => {
    const step8 = computeMetrics({
      equityCurve: THREE_MONTH_CURVE,
      trades: TRADES as Trade[],
      initialCapital: 1000,
    });
    const quality = metrics.tradeQuality!;
    expect(quality.completedTradeCount).toBe(step8.completedTradeCount);
    expect(quality.winRatePct).toBe(step8.winRatePct);
    expect(quality.profitFactor).toBe(step8.profitFactor);
    expect(quality.averageWin).toBe(step8.averageWin);
    expect(quality.averageLoss).toBe(step8.averageLoss);
    expect(quality.expectancy).toBe(step8.expectancy);
    expect(quality.totalTradeCount).toBe(step8.tradeCount);
  });
});

// ---------------------------------------------------------------------------
// (b) Turnover 公式
// ---------------------------------------------------------------------------

describe("Turnover（换手率）", () => {
  it("buy/sell/gross 名义额手算（含 openAtEnd 买入侧、不含其卖出侧）", () => {
    const turnover = computeTurnoverMetrics(TRADES, THREE_MONTH_EQUITIES);
    expect(turnover.buyNotional).toBeCloseTo(9590, 6); // 1000+1000+4000+1700+1890
    expect(turnover.sellNotional).toBeCloseTo(7590, 6); // 1200+1100+3400+1890
    expect(turnover.grossTradedNotional).toBeCloseTo(17180, 6);
    expect(turnover.averageEquity).toBeCloseTo(THREE_MONTH_SUM_EQUITY / 7, 9);
  });

  it("区间与年化双边换手公式手算", () => {
    const turnover = computeTurnoverMetrics(TRADES, THREE_MONTH_EQUITIES);
    const averageEquity = THREE_MONTH_SUM_EQUITY / 7;
    expect(turnover.periodTurnover).toBeCloseTo(17180 / averageEquity, 9);
    expect(turnover.annualizedTurnover).toBeCloseTo(
      (17180 * 252) / (averageEquity * (THREE_MONTH_EQUITIES.length - 1)),
      9
    );
  });

  it("换手口径参数 annualizationFactor 生效（默认 252 可覆盖）", () => {
    const record = evaluateTradeQualityMetrics({
      equityCurve: THREE_MONTH_CURVE,
      trades: TRADES,
      annualizationFactor: 250,
    });
    expect(record.annualizationFactor).toBe(250);
    const averageEquity = THREE_MONTH_SUM_EQUITY / 7;
    expect(record.metrics.tradeQuality!.turnover.annualizedTurnover).toBeCloseTo(
      (17180 * 250) / (averageEquity * 6),
      9
    );
  });
});

// ---------------------------------------------------------------------------
// (c) Average Holding Period（平均持仓）
// ---------------------------------------------------------------------------

describe("Average Holding Period（交易日）", () => {
  it("从 Trade 进出场日期按曲线索引差 + 1 手算：2/3/2/2 → 均值 2.25", () => {
    const holding = computeAverageHoldingPeriodDays(TRADES, THREE_MONTH_DATES);
    expect(holding.averageHoldingPeriodDays).toBeCloseTo(2.25, 9);
    expect(holding.coveredCount).toBe(4);
    expect(holding.unavailableCount).toBe(0);
    const quality = computeTradeQualityMetrics({
      equityCurve: THREE_MONTH_CURVE,
      trades: TRADES,
    }).tradeQuality!;
    expect(quality.averageHoldingPeriodDays).toBeCloseTo(2.25, 9);
    expect(quality.holdingPeriodCoveredCount).toBe(4);
    expect(quality.holdingPeriodUnavailableCount).toBe(0);
  });

  it("进出场日期不在曲线内时回退 trade.holdingPeriod", () => {
    const trade = mkTrade({
      entryTime: "2023-12-01",
      exitTime: "2023-12-10",
      exitPrice: 11,
      grossPnL: 100,
      fees: 0,
      netPnl: 100,
      holdingPeriod: 7,
    });
    const holding = computeAverageHoldingPeriodDays([trade], THREE_MONTH_DATES);
    expect(holding.averageHoldingPeriodDays).toBe(7);
    expect(holding.coveredCount).toBe(1);
    expect(holding.unavailableCount).toBe(0);
  });

  it("日期不在曲线且无 holdingPeriod → 该笔 excluded，显式计数 unavailable", () => {
    const trade = mkTrade({
      entryTime: "2023-12-01",
      exitTime: "2023-12-10",
      exitPrice: 11,
      grossPnL: 100,
      fees: 0,
      netPnl: 100,
      holdingPeriod: null,
    });
    const holding = computeAverageHoldingPeriodDays([trade], THREE_MONTH_DATES);
    expect(holding.averageHoldingPeriodDays).toBeNull();
    expect(holding.coveredCount).toBe(0);
    expect(holding.unavailableCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (d) 月度一致性
// ---------------------------------------------------------------------------

describe("月度一致性", () => {
  const monthly = computeMonthlyConsistency(THREE_MONTH_CURVE);

  it("逐月收益手算：2024-01 +21、2024-02 −19、2024-03 +10.25", () => {
    expect(monthly.monthCount).toBe(3);
    expect(monthly.entries.map((entry) => entry.monthKey)).toEqual([
      "2024-01",
      "2024-02",
      "2024-03",
    ]);
    const jan = monthly.entries[0]!;
    expect(jan.returnPct).toBeCloseTo(21, 6);
    expect(jan.realizedReturnCount).toBe(2);
    expect(monthly.entries[1]!.returnPct).toBeCloseTo(-19, 6);
    expect(monthly.entries[2]!.returnPct).toBeCloseTo(10.25, 6);
  });

  it("盈利月占比 / 中位数 / 最佳最差月 / 最大连亏月手算", () => {
    expect(monthly.positiveMonthCount).toBe(2);
    expect(monthly.negativeMonthCount).toBe(1);
    expect(monthly.positiveMonthRatio).toBeCloseTo(2 / 3, 9);
    expect(monthly.medianMonthlyReturnPct).toBeCloseTo(10.25, 6);
    expect(monthly.bestMonth!.monthKey).toBe("2024-01");
    expect(monthly.bestMonth!.returnPct).toBeCloseTo(21, 6);
    expect(monthly.worstMonth!.monthKey).toBe("2024-02");
    expect(monthly.worstMonth!.returnPct).toBeCloseTo(-19, 6);
    expect(monthly.maxConsecutiveLosingMonths).toBe(1);
  });

  it("月度连乘 ≡ 区间总收益（望远镜恒等）", () => {
    let product = 1;
    for (const entry of monthly.entries) product *= 1 + entry.returnPct / 100;
    expect(product).toBeCloseTo(1080.56025 / 1000, 9);
  });

  it("无曲线点的空月不被伪造为 0%（MULTI_YEAR 曲线仅 4 个月参与）", () => {
    const monthly = computeMonthlyConsistency(MULTI_YEAR_CURVE);
    expect(monthly.monthCount).toBe(4);
    expect(monthly.entries.map((entry) => entry.monthKey)).toEqual([
      "2024-01",
      "2024-12",
      "2025-06",
      "2025-12",
    ]);
    expect(monthly.positiveMonthRatio).toBeCloseTo(3 / 4, 9);
    expect(monthly.negativeMonthCount).toBe(1);
  });

  it("权益恒定（全 0% 月）结构化处理：占比 0、连亏 0、中位数 0", () => {
    // 曲线首点 2024-01-31 无后继同日实现收益 → 参与月为 2024-02/03/04，共 3 个。
    const monthly = computeMonthlyConsistency(FLAT_CURVE);
    expect(monthly.monthCount).toBe(3);
    expect(monthly.positiveMonthCount).toBe(0);
    expect(monthly.negativeMonthCount).toBe(0);
    expect(monthly.positiveMonthRatio).toBe(0);
    expect(monthly.medianMonthlyReturnPct).toBeCloseTo(0, 9);
    expect(monthly.maxConsecutiveLosingMonths).toBe(0);
    expect(monthly.bestMonth!.monthKey).toBe("2024-02");
    expect(monthly.worstMonth!.monthKey).toBe("2024-02");
  });

  it("曲线只覆盖一个日历月 → 仅 1 个参与月", () => {
    const monthly = computeMonthlyConsistency(SINGLE_MONTH_CURVE);
    expect(monthly.monthCount).toBe(1);
    expect(monthly.entries[0]!.monthKey).toBe("2024-01");
    expect(monthly.entries[0]!.returnPct).toBeCloseTo(4.5, 9); // 1.1×0.95 − 1
  });
});

// ---------------------------------------------------------------------------
// (e) 年度一致性
// ---------------------------------------------------------------------------

describe("年度一致性", () => {
  it("逐年收益手算：2024 +21、2025 −5.5", () => {
    const yearly: YearlyConsistencyMetrics = computeYearlyConsistency(MULTI_YEAR_CURVE);
    expect(yearly.yearCount).toBe(2);
    expect(yearly.entries.map((entry) => entry.yearKey)).toEqual(["2024", "2025"]);
    expect(yearly.entries[0]!.returnPct).toBeCloseTo(21, 6);
    expect(yearly.entries[1]!.returnPct).toBeCloseTo(-5.5, 6);
    expect(yearly.positiveYearRatio).toBeCloseTo(0.5, 9);
    expect(yearly.medianYearlyReturnPct).toBeCloseTo(7.75, 6);
    expect(yearly.bestYear!.yearKey).toBe("2024");
    expect(yearly.worstYear!.yearKey).toBe("2025");
    expect(yearly.maxConsecutiveLosingYears).toBe(1);
  });

  it("年度连乘 ≡ 月度连乘 ≡ 区间总收益（望远镜恒等）", () => {
    const monthly: MonthlyConsistencyMetrics = computeMonthlyConsistency(MULTI_YEAR_CURVE);
    const yearly = computeYearlyConsistency(MULTI_YEAR_CURVE);
    let monthlyProduct = 1;
    for (const entry of monthly.entries) monthlyProduct *= 1 + entry.returnPct / 100;
    let yearlyProduct = 1;
    for (const entry of yearly.entries) yearlyProduct *= 1 + entry.returnPct / 100;
    const total = 1143.45 / 1000;
    expect(monthlyProduct).toBeCloseTo(total, 9);
    expect(yearlyProduct).toBeCloseTo(total, 9);
  });
});

// ---------------------------------------------------------------------------
// (f) regime：unassessed 占位 + assessed 扩展槽
// ---------------------------------------------------------------------------

describe("regime 占位", () => {
  it("评估记录 metrics.regime 恒为 unassessed，reasonCode 与 experimentLineage 一致", () => {
    const metrics = computeTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: TRADES });
    expect(metrics.regime.kind).toBe("unassessed");
    if (metrics.regime.kind !== "unassessed") throw new Error("不可达");
    expect(metrics.regime.reasonCode).toBe(REGIME_UNASSESSED_REASON_CODE);
    expect(metrics.regime.reason).toBe(DEFAULT_REGIME_UNASSESSED_REASON);
    expect(isRegimeUnassessed(metrics.regime)).toBe(true);
  });

  it("unassessed 工厂支持自定义 reason（默认值可覆盖）", () => {
    const placeholder = unassessedRegimePerformance("自定义原因");
    expect(placeholder.kind).toBe("unassessed");
    if (placeholder.kind !== "unassessed") throw new Error("不可达");
    expect(placeholder.reason).toBe("自定义原因");
  });

  it("assessed 扩展槽类型存在（判别联合分支可赋值，C-22.1 前不产出）", () => {
    const assessed: TradeQualityRegimePerformance = { kind: "assessed", segments: [] };
    expect(assessed.kind).toBe("assessed");
    expect(isRegimeUnassessed(assessed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (g) 退化 / 非法输入
// ---------------------------------------------------------------------------

describe("退化与非法输入", () => {
  it("空曲线 / 单点曲线响亮抛错 INSUFFICIENT_EQUITY_CURVE", () => {
    expectPerformanceError(
      () => computeTradeQualityMetrics({ equityCurve: [] }),
      "INSUFFICIENT_EQUITY_CURVE"
    );
    expectPerformanceError(
      () => evaluateTradeQualityMetrics({ equityCurve: [mkPoint("2024-01-01", 100)] }),
      "INSUFFICIENT_EQUITY_CURVE"
    );
  });

  it("非有限 / 非正 equity 抛 INVALID_EQUITY_VALUE", () => {
    expectPerformanceError(
      () => computeTradeQualityMetrics({ equityCurve: curve(["2024-01-01", "2024-01-02"], [100, Number.NaN]) }),
      "INVALID_EQUITY_VALUE"
    );
    expectPerformanceError(
      () => computeTradeQualityMetrics({ equityCurve: curve(["2024-01-01", "2024-01-02"], [100, 0]) }),
      "INVALID_EQUITY_VALUE"
    );
  });

  it("日期乱序抛 EQUITY_CURVE_UNSORTED", () => {
    expectPerformanceError(
      () => computeTradeQualityMetrics({ equityCurve: curve(["2024-01-02", "2024-01-01"], [100, 110]) }),
      "EQUITY_CURVE_UNSORTED"
    );
  });

  it("非法 annualizationFactor 抛 INVALID_PARAMETER", () => {
    expectPerformanceError(
      () =>
        computeTradeQualityMetrics({
          equityCurve: THREE_MONTH_CURVE,
          trades: TRADES,
          annualizationFactor: 0,
        }),
      "INVALID_PARAMETER"
    );
    expectPerformanceError(
      () =>
        computeTradeQualityMetrics({
          equityCurve: THREE_MONTH_CURVE,
          trades: TRADES,
          annualizationFactor: Number.NaN,
        }),
      "INVALID_PARAMETER"
    );
  });

  it("非法 trade 数值字段抛 INVALID_TRADE_VALUE（非有限/非正/非整数）", () => {
    const curveOk = THREE_MONTH_CURVE;
    expectPerformanceError(
      () => computeTradeQualityMetrics({ equityCurve: curveOk, trades: [mkTrade({ entryPrice: Number.NaN })] }),
      "INVALID_TRADE_VALUE"
    );
    expectPerformanceError(
      () => computeTradeQualityMetrics({ equityCurve: curveOk, trades: [mkTrade({ quantity: -5 })] }),
      "INVALID_TRADE_VALUE"
    );
    expectPerformanceError(
      () =>
        computeTradeQualityMetrics({
          equityCurve: curveOk,
          trades: [mkTrade({ exitPrice: 11, grossPnL: 100, netPnl: Number.NaN })],
        }),
      "INVALID_TRADE_VALUE"
    );
    expectPerformanceError(
      () =>
        computeTradeQualityMetrics({
          equityCurve: curveOk,
          trades: [mkTrade({ exitPrice: 11, grossPnL: 100, netPnl: 100, holdingPeriod: 2.5 })],
        }),
      "INVALID_TRADE_VALUE"
    );
  });

  it("未提供 trades → tradeQuality = null，月度/年度照常，无 NaN", () => {
    const metrics = computeTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE });
    expect(metrics.tradeQuality).toBeNull();
    expect(metrics.monthly.monthCount).toBe(3);
    expect(metrics.yearly.yearCount).toBe(1);
    const record = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE });
    expect(record.input.tradeCount).toBeNull();
    expect(JSON.parse(serializeTradeQualityEvaluationRun(record))).toBeTruthy();
  });

  it("空 trades → tradeQuality 结构化空态：counts=0、winRate null、PF 0（STEP 8 语义）、换手 0", () => {
    const metrics = computeTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: [] });
    const quality = metrics.tradeQuality!;
    expect(quality.totalTradeCount).toBe(0);
    expect(quality.completedTradeCount).toBe(0);
    expect(quality.winRatePct).toBeNull();
    expect(quality.profitFactor).toBe(0);
    expect(quality.expectancy).toBeNull();
    expect(quality.averageHoldingPeriodDays).toBeNull();
    expect(quality.holdingPeriodCoveredCount).toBe(0);
    expect(quality.turnover.grossTradedNotional).toBe(0);
    expect(quality.turnover.periodTurnover).toBe(0);
    expect(quality.turnover.annualizedTurnover).toBe(0);
  });

  it("全部为 openAtEnd 交易（无完成交易）→ counts 反映、指标 null、买入侧计换手", () => {
    const trades = [
      mkTrade({ entryPrice: 10, openAtEnd: true }),
      mkTrade({ securityId: "F.SH", entryTime: "2024-01-03", entryPrice: 20, quantity: 50, openAtEnd: true }),
    ];
    const quality = computeTradeQualityMetrics({
      equityCurve: THREE_MONTH_CURVE,
      trades,
    }).tradeQuality!;
    expect(quality.completedTradeCount).toBe(0);
    expect(quality.winRatePct).toBeNull();
    expect(quality.averageHoldingPeriodDays).toBeNull();
    expect(quality.turnover.buyNotional).toBeCloseTo(10 * 100 + 20 * 50, 9);
    expect(quality.turnover.sellNotional).toBe(0);
  });

  it("单笔完成且盈利 → winRate=100、PF=null（无亏损，STEP 8 语义）、expectancy=单笔", () => {
    const trade = mkTrade({
      exitTime: "2024-01-03",
      exitPrice: 12,
      grossPnL: 200,
      fees: 10,
      netPnl: 190,
      holdingPeriod: 2,
    });
    const quality = computeTradeQualityMetrics({
      equityCurve: THREE_MONTH_CURVE,
      trades: [trade],
    }).tradeQuality!;
    expect(quality.completedTradeCount).toBe(1);
    expect(quality.winRatePct).toBe(100);
    expect(quality.profitFactor).toBeNull();
    expect(quality.averageWin).toBeCloseTo(190, 9);
    expect(quality.averageLoss).toBeNull();
    expect(quality.expectancy).toBeCloseTo(190, 9);
    expect(quality.averageHoldingPeriodDays).toBeCloseTo(2, 9);
  });
});

// ---------------------------------------------------------------------------
// (h) 确定性 / round-trip / fingerprint / inputFingerprint 同载荷
// ---------------------------------------------------------------------------

describe("确定性与指纹", () => {
  it("同输入两次评估产出同一记录与同一 fingerprint", () => {
    const input = { equityCurve: THREE_MONTH_CURVE, trades: TRADES };
    const a = evaluateTradeQualityMetrics(input);
    const b = evaluateTradeQualityMetrics(input);
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.recordKind).toBe(TRADE_QUALITY_EVALUATION_RUN_KIND);
  });

  it("inputFingerprint 与 C-16.1 computeInputFingerprint 同载荷同值（指纹互链）", () => {
    const record = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: TRADES });
    expect(record.inputFingerprint).toBe(
      computeInputFingerprint161({ equityCurve: THREE_MONTH_CURVE, trades: TRADES })
    );
    const recordNoTrades = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE });
    expect(recordNoTrades.inputFingerprint).toBe(
      computeInputFingerprint161({ equityCurve: THREE_MONTH_CURVE })
    );
    expect(record.inputFingerprint).not.toBe(recordNoTrades.inputFingerprint);
  });

  it("不同输入曲线产出不同 fingerprint", () => {
    const a = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE });
    const b = evaluateTradeQualityMetrics({ equityCurve: MULTI_YEAR_CURVE });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("serialize → deserialize round-trip 还原同一记录", () => {
    const record = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: TRADES });
    const json = serializeTradeQualityEvaluationRun(record);
    const restored = deserializeTradeQualityEvaluationRun(json);
    expect(restored).toEqual(record);
    expect(restored.fingerprint).toBe(record.fingerprint);
  });

  it("篡改记录（改月度收益）→ fingerprint 复核抛错", () => {
    const record = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: TRADES });
    const json = serializeTradeQualityEvaluationRun(record);
    const tampered = JSON.parse(json) as Record<string, unknown>;
    (tampered.metrics as { monthly: { entries: { returnPct: number }[] } }).monthly.entries[0]!.returnPct = 999;
    expect(() => deserializeTradeQualityEvaluationRun(JSON.stringify(tampered))).toThrow(/指纹不匹配/);
  });

  it("篡改记录（改交易质量字段）→ fingerprint 复核抛错", () => {
    const record = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: TRADES });
    const json = serializeTradeQualityEvaluationRun(record);
    const tampered = JSON.parse(json) as Record<string, unknown>;
    (tampered.metrics as { tradeQuality: { winRatePct: number | null } }).tradeQuality.winRatePct = 99;
    expect(() => deserializeTradeQualityEvaluationRun(JSON.stringify(tampered))).toThrow(/指纹不匹配/);
  });

  it("返回记录深冻结（不可变）", () => {
    const record = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: TRADES });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.metrics)).toBe(true);
    expect(Object.isFrozen(record.metrics.monthly)).toBe(true);
    expect(Object.isFrozen(record.metrics.tradeQuality)).toBe(true);
  });

  it("记录输入边界回显正确（点数/起止日期/tradeCount）", () => {
    const record = evaluateTradeQualityMetrics({ equityCurve: THREE_MONTH_CURVE, trades: TRADES });
    expect(record.input.equityCurvePointCount).toBe(7);
    expect(record.input.startDate).toBe("2024-01-02");
    expect(record.input.endDate).toBe("2024-03-29");
    expect(record.input.tradeCount).toBe(5);
    expect(record.annualizationFactor).toBe(252);
  });
});
