/**
 * STEP 16 / C-16.3 — 策略评价·交易质量与稳定性指标：确定性评估核心（纯函数）。
 *
 * 背景与边界：
 *   - C-14.1 simulator 产出 TradeSimulationRun（equityCurve: 逐收盘权益点，每点一个
 *     交易日；trades: 完整交易生命周期）。C-16.1 已交付收益/风险/回撤、C-16.2 已交付
 *     Sharpe/Sortino/Calmar；本任务只交付「交易质量 + 月度/年度一致性 + regime 占位」。
 *   - 输入形态 =（equityCurve, trades, annualizationFactor），与 C-16.1 / C-16.2
 *     同构（C-16.1 PerformanceEvaluationRun 记录不含原始 equityCurve，无法还原月/年
 *     收益分布，故不消费其记录、直接消费曲线；三者共享 C-16.1 computeInputFingerprint
 *     同载荷指纹互链，防「指标与来源曲线脱钩」）。
 *
 * 口径核对（STEP 8 backtest/metrics vs 本任务 vs 全研究链）：
 *   1. WinRate / Profit Factor / Average Win / Average Loss / Expectancy /
 *      Completed Trade Count —— 与 STEP 8 computeMetrics 的 trade 段口径逐项一致：
 *      completedTrades 过滤 = !openAtEnd && netPnl !== null（复用 STEP 8 导出纯函数）；
 *      winRatePct = 盈利完成交易数 / 完成交易数 × 100（netPnl === 0 记为不赢，计入分母）；
 *      profitFactor = 总盈利 / |总亏损|（无亏损但有盈利 → null 表示无限大；
 *      无任何完成交易/无盈亏 → 0，这是 STEP 8 生产语义，本任务**原样复用**不覆盖）；
 *      averageLoss 为负数（净盈亏为负者均值）；expectancy = 完成交易 netPnl 均值（元）。
 *      本任务通过 read-only import 直接调用 computeMetrics（initialCapital 取
 *      equityCurve[0].equity，与研究曲线锚点一致；只消费其 trade 段数值），
 *      保证生产口径不漂移，不做第二套实现。
 *   2. Average Holding Period —— STEP 8 未给出聚合值，仅 Trade.holdingPeriod
 *      字段（单笔，交易日）。本任务聚合口径：单笔持仓日数 = max(1, 曲线日期索引差 + 1)
 *      （含进出场两端，与 STEP 8 portfolio.holdingDays 逐位一致）；进出场日期不在
 *      评估曲线内时回退使用 trade.holdingPeriod；两者皆不可得则该笔不计入并显式计数
 *      unavailable。平均 = 覆盖笔数均值；无覆盖或无可确定笔数 → null（绝不静默 0/NaN）。
 *   3. Turnover —— STEP 8 与生产 Performance Analytics 均无此指标，本任务自定义并
 *      文档化（见 computeTurnoverMetrics / TurnoverMetrics 注释）：双边名义成交额 /
 *      平均资产，按区间交易日数线性年化。trade 级近似：卖出侧以清仓 exitPrice ×
 *      quantity 计（引擎记录不含逐笔 Fill 流，此为可得的最高精度口径，已声明限制）。
 *   4. 月度/年度一致性 —— STEP 8 未覆盖。口径见 computeMonthlyConsistency。
 *
 * 月度/年度一致性口径（全文件统一）：
 *   - 日收益 r_j = equity_j / equity_{j−1} − 1 在点 j 的日期上**实现**；
 *   - 月收益 = 该日历月内实现的各日收益连乘 − 1；跨月边界的日收益（上一交易日 →
 *     本月首交易日）按实现日归属当月。由此 Σ(1+月收益) 恒等于 区间总收益
 *     （endEquity/startEquity），年度同理——该「望远镜恒等」性质是正确性的强校验；
 *   - 键提取用纯字符串切片：月键 = date.slice(0,7)、年键 = date.slice(0,4)
 *     （YYYY-MM-DD 已由 assertValidEquityCurve 校验，无 Date 对象依赖）；
 *   - 只统计「曲线内至少实现一条日收益」的日历月/年；无曲线点的空月/空年不出现、
 *     也不被当作 0% 计入（不编造空月）。
 *
 * regime 占位：
 *   - C-22.1 前 regime 未建模，禁止编造 regime 标签。metrics.regime 恒为
 *     unassessed（reasonCode = REGIME_UNASSESSED_REASON_CODE，import 自
 *     experimentLineage 单一事实来源）；assessed 分支与分段类型仅作扩展槽，不产出。
 *
 * 退化输入策略（响亮失败，绝不静默 NaN）：
 *   - equityCurve 空 / 单点 / 非有限 / 非正 equity / 日期乱序 → 复用 C-16.1
 *     assertValidEquityCurve 抛 InvalidEquityCurveError；
 *   - trades 数值字段非法（entryPrice/quantity/exitPrice 非有限、closed netPnl 非有限、
 *     holdingPeriod 非正整数等）→ 抛 INVALID_TRADE_VALUE；
 *   - 口径参数非法（annualizationFactor <= 0 或非有限）→ 抛 INVALID_PARAMETER；
 *   - 「无 trades / 无完成交易 / 持仓不可确定」属语义缺省而非输入错误 →
 *     显式 null / 0 计数，绝不产出 NaN。
 */

import {
  PerformanceEvaluationError,
  assertValidEquityCurve,
} from "../performanceMetrics/analyze";
import { computeMetrics, completedTrades } from "../../backtest/metrics";
import type { EquityPoint, Trade } from "../../backtest/types";
import { mean, median } from "../../../shared/quant-stats";
import {
  DEFAULT_REGIME_UNASSESSED_REASON,
  REGIME_UNASSESSED_REASON_CODE,
} from "../experimentLineage/types";
import type {
  MonthlyConsistencyMetrics,
  MonthlyReturnEntry,
  TradeQualityEvaluationInput,
  TradeQualityEvaluationMetrics,
  TradeQualityMetrics,
  TradeQualityRegimePerformance,
  TurnoverMetrics,
  YearlyConsistencyMetrics,
  YearlyReturnEntry,
} from "./types";

// ---------------------------------------------------------------------------
// 结构化错误与校验
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验口径参数（响亮抛错，不静默回退）。 */
function assertValidParameters(input: TradeQualityEvaluationInput): void {
  const { annualizationFactor } = input;
  if (
    annualizationFactor !== undefined &&
    (!Number.isFinite(annualizationFactor) || annualizationFactor <= 0)
  ) {
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `tradeQualityMetrics: annualizationFactor=${String(annualizationFactor)} 必须为正有限数`
    );
  }
}

/** 校验被评估器消费的 Trade 数值字段（NaN/Infinity/非正值一律响亮抛错）。 */
export function assertValidTrades(trades: readonly Trade[]): void {
  trades.forEach((trade, index) => {
    const where = `trades[${index}]`;
    if (!Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) {
      throw new PerformanceEvaluationError(
        "INVALID_TRADE_VALUE",
        `tradeQualityMetrics: ${where}.entryPrice=${String(trade.entryPrice)} 必须为 > 0 的有限数`
      );
    }
    if (!Number.isFinite(trade.quantity) || trade.quantity <= 0) {
      throw new PerformanceEvaluationError(
        "INVALID_TRADE_VALUE",
        `tradeQualityMetrics: ${where}.quantity=${String(trade.quantity)} 必须为 > 0 的有限数`
      );
    }
    if (trade.exitPrice !== null && (!Number.isFinite(trade.exitPrice) || trade.exitPrice <= 0)) {
      throw new PerformanceEvaluationError(
        "INVALID_TRADE_VALUE",
        `tradeQualityMetrics: ${where}.exitPrice=${String(trade.exitPrice)} 非 null 时必须为 > 0 的有限数`
      );
    }
    if (trade.netPnl !== null && !Number.isFinite(trade.netPnl)) {
      throw new PerformanceEvaluationError(
        "INVALID_TRADE_VALUE",
        `tradeQualityMetrics: ${where}.netPnl=${String(trade.netPnl)} 非 null 时必须为有限数`
      );
    }
    if (
      trade.holdingPeriod !== null &&
      (!Number.isInteger(trade.holdingPeriod) || trade.holdingPeriod < 1)
    ) {
      throw new PerformanceEvaluationError(
        "INVALID_TRADE_VALUE",
        `tradeQualityMetrics: ${where}.holdingPeriod=${String(trade.holdingPeriod)} 非 null 时必须为 >= 1 的整数`
      );
    }
  });
}

/** 校验独立调用的权益数组（有限且 > 0，点数 >= 2），供 turnover 等纯函数自守卫。 */
function assertValidEquityArray(equities: readonly number[]): void {
  if (equities.length < 2) {
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `tradeQualityMetrics: 权益序列点数 ${equities.length}，至少需要 2 点`
    );
  }
  for (let i = 0; i < equities.length; i += 1) {
    const value = equities[i]!;
    if (!Number.isFinite(value) || value <= 0) {
      throw new PerformanceEvaluationError(
        "INVALID_PARAMETER",
        `tradeQualityMetrics: equities[${i}]=${String(value)} 必须为 > 0 的有限数`
      );
    }
  }
}

/** YYYY-MM-DD → 月键（YYYY-MM，纯字符串切片；日期须已校验形态）。 */
export function monthKeyOf(date: string): string {
  if (!ISO_DATE_RE.test(date)) {
    throw new PerformanceEvaluationError(
      "INVALID_DATE",
      `tradeQualityMetrics: monthKeyOf 收到非法日期 ${date}（须为 YYYY-MM-DD）`
    );
  }
  return date.slice(0, 7);
}

/** YYYY-MM-DD → 年键（YYYY，纯字符串切片；日期须已校验形态）。 */
export function yearKeyOf(date: string): string {
  if (!ISO_DATE_RE.test(date)) {
    throw new PerformanceEvaluationError(
      "INVALID_DATE",
      `tradeQualityMetrics: yearKeyOf 收到非法日期 ${date}（须为 YYYY-MM-DD）`
    );
  }
  return date.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Turnover（换手率）
// ---------------------------------------------------------------------------

/**
 * 计算换手率指标（口径见 TurnoverMetrics 注释与文件头「口径核对 #3」）。
 *
 * 公式（文档化）：
 *   buyNotional      = Σ(entryPrice × quantity)                        —— 全部交易买入侧
 *   sellNotional     = Σ(exitPrice × quantity)  (exitPrice 非 null)    —— 已清仓卖出侧
 *   grossNotional    = buyNotional + sellNotional
 *   averageEquity    = mean(equities)
 *   periodTurnover   = grossNotional / averageEquity                   —— 区间双边换手（倍）
 *   annualizedTurnover = grossNotional × annualizationFactor /
 *                       (averageEquity × (equities.length − 1))        —— 年化双边换手（倍/年）
 *
 * 限制（诚实声明）：以 Trade 记录近似成交额（无逐笔 Fill 流）；买卖双侧都计入
 * 「总交易活动相对资产规模」以反映佣金/滑点成本敏感度，非基金业单边 min(买,卖) 口径。
 */
export function computeTurnoverMetrics(
  trades: readonly Trade[],
  equities: readonly number[],
  annualizationFactor = 252
): TurnoverMetrics {
  assertValidEquityArray(equities);
  if (!Number.isFinite(annualizationFactor) || annualizationFactor <= 0) {
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `tradeQualityMetrics: annualizationFactor=${String(annualizationFactor)} 必须为正有限数`
    );
  }
  assertValidTrades(trades);

  let buyNotional = 0;
  let sellNotional = 0;
  for (const trade of trades) {
    buyNotional += trade.entryPrice * trade.quantity;
    if (trade.exitPrice !== null) sellNotional += trade.exitPrice * trade.quantity;
  }
  const grossTradedNotional = buyNotional + sellNotional;
  const averageEquity = mean([...equities])!; // 点数 >= 2 且全有限，mean 必非 null
  const intervals = equities.length - 1;
  return {
    buyNotional,
    sellNotional,
    grossTradedNotional,
    averageEquity,
    periodTurnover: grossTradedNotional / averageEquity,
    annualizedTurnover: (grossTradedNotional * annualizationFactor) / (averageEquity * intervals),
  };
}

// ---------------------------------------------------------------------------
// Average Holding Period（平均持仓，交易日）
// ---------------------------------------------------------------------------

/**
 * 平均持仓（交易日）聚合。
 *
 * 单笔持仓日数判定顺序：
 *   1. entryTime / exitTime 均在评估曲线日期轴上 → 索引差 + 1
 *      （max(1, idxExit − idxEntry + 1)，含进出场两端，与 STEP 8
 *      portfolio.holdingDays 口径逐位一致）；
 *   2. 否则回退 trade.holdingPeriod（引擎按自身完整交易日历计）；
 *   3. 两者皆不可得 → 该完成交易不计入均值，计入 unavailableCount。
 *
 * 无完成交易或无可确定笔数 → averageHoldingPeriodDays = null（显式缺省，
 * 绝不返回 NaN / 静默 0）。只对完成交易（completedTrades）统计。
 */
export function computeAverageHoldingPeriodDays(
  trades: readonly Trade[],
  curveDates: readonly string[]
): {
  readonly averageHoldingPeriodDays: number | null;
  readonly coveredCount: number;
  readonly unavailableCount: number;
} {
  const closed = completedTrades([...trades]);
  const dateIndex = new Map(curveDates.map((date, index) => [date, index]));
  let sumDays = 0;
  let coveredCount = 0;
  let unavailableCount = 0;
  for (const trade of closed) {
    const entryIndex = dateIndex.get(trade.entryTime);
    const exitIndex = trade.exitTime === null ? undefined : dateIndex.get(trade.exitTime);
    let days: number | null = null;
    if (entryIndex !== undefined && exitIndex !== undefined) {
      days = Math.max(1, exitIndex - entryIndex + 1);
    } else if (trade.holdingPeriod !== null && Number.isFinite(trade.holdingPeriod)) {
      days = trade.holdingPeriod;
    }
    if (days === null) {
      unavailableCount += 1;
    } else {
      sumDays += days;
      coveredCount += 1;
    }
  }
  return {
    averageHoldingPeriodDays: coveredCount === 0 ? null : sumDays / coveredCount,
    coveredCount,
    unavailableCount,
  };
}

// ---------------------------------------------------------------------------
// 月度 / 年度一致性
// ---------------------------------------------------------------------------

/** 日收益序列按实现日分桶连乘（口径见文件头「月度/年度一致性口径」）。 */
interface ReturnBucket {
  readonly key: string;
  /** 桶内 (1+日收益) 连乘（可变累加量，非记录字段）。 */
  product: number;
  realizedCount: number;
}

function bucketizeCurveReturns(
  curve: readonly EquityPoint[],
  keyOf: (date: string) => string
): ReturnBucket[] {
  const byKey = new Map<string, ReturnBucket>();
  for (let j = 1; j < curve.length; j += 1) {
    const date = curve[j]!.date;
    const ratio = curve[j]!.equity / curve[j - 1]!.equity; // equity > 0 已校验
    const key = keyOf(date);
    const bucket = byKey.get(key) ?? { key, product: 1, realizedCount: 0 };
    bucket.product *= ratio;
    bucket.realizedCount += 1;
    byKey.set(key, bucket);
  }
  const buckets = Array.from(byKey.values());
  // 日期严格升序 → 键字符串升序即时间升序（YYYY-MM / YYYY 字典序 = 时间序）。
  buckets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return buckets;
}

/** 对升序收益序列做一致性统计聚合（中位数/正负月/最佳最差/最大连亏）。 */
function aggregatePeriodStats<T extends { readonly returnPct: number }>(
  entries: readonly T[]
): {
  readonly positive: number;
  readonly negative: number;
  readonly medianReturnPct: number | null;
  readonly bestIndex: number | null;
  readonly worstIndex: number | null;
  readonly maxConsecutiveLosing: number;
} {
  let positive = 0;
  let negative = 0;
  let bestIndex: number | null = null;
  let worstIndex: number | null = null;
  let run = 0;
  let maxConsecutiveLosing = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const value = entries[i]!.returnPct;
    if (value > 0) positive += 1;
    if (value < 0) negative += 1;
    if (bestIndex === null || value > entries[bestIndex]!.returnPct) bestIndex = i;
    if (worstIndex === null || value < entries[worstIndex]!.returnPct) worstIndex = i;
    if (value < 0) {
      run += 1;
      maxConsecutiveLosing = Math.max(maxConsecutiveLosing, run);
    } else {
      run = 0;
    }
  }
  const returnPcts = entries.map((entry) => entry.returnPct);
  return {
    positive,
    negative,
    medianReturnPct: median(returnPcts),
    bestIndex,
    worstIndex,
    maxConsecutiveLosing,
  };
}

/**
 * 月度一致性（口径见文件头）。curve 须先通过 assertValidEquityCurve
 * （>= 2 点、equity > 0 且有限、日期严格升序）。
 */
export function computeMonthlyConsistency(curve: readonly EquityPoint[]): MonthlyConsistencyMetrics {
  assertValidEquityCurve(curve);
  const buckets = bucketizeCurveReturns(curve, monthKeyOf);
  const entries: MonthlyReturnEntry[] = buckets.map((bucket) => ({
    monthKey: bucket.key,
    returnPct: (bucket.product - 1) * 100,
    realizedReturnCount: bucket.realizedCount,
  }));
  const stats = aggregatePeriodStats(entries);
  return {
    entries,
    monthCount: entries.length,
    positiveMonthCount: stats.positive,
    negativeMonthCount: stats.negative,
    positiveMonthRatio: entries.length === 0 ? 0 : stats.positive / entries.length,
    medianMonthlyReturnPct: stats.medianReturnPct,
    bestMonth: stats.bestIndex === null ? null : entries[stats.bestIndex]!,
    worstMonth: stats.worstIndex === null ? null : entries[stats.worstIndex]!,
    maxConsecutiveLosingMonths: stats.maxConsecutiveLosing,
  };
}

/**
 * 年度一致性（口径同月度，键为 YYYY）。curve 校验同上。
 */
export function computeYearlyConsistency(curve: readonly EquityPoint[]): YearlyConsistencyMetrics {
  assertValidEquityCurve(curve);
  const buckets = bucketizeCurveReturns(curve, yearKeyOf);
  const entries: YearlyReturnEntry[] = buckets.map((bucket) => ({
    yearKey: bucket.key,
    returnPct: (bucket.product - 1) * 100,
    realizedReturnCount: bucket.realizedCount,
  }));
  const stats = aggregatePeriodStats(entries);
  return {
    entries,
    yearCount: entries.length,
    positiveYearCount: stats.positive,
    negativeYearCount: stats.negative,
    positiveYearRatio: entries.length === 0 ? 0 : stats.positive / entries.length,
    medianYearlyReturnPct: stats.medianReturnPct,
    bestYear: stats.bestIndex === null ? null : entries[stats.bestIndex]!,
    worstYear: stats.worstIndex === null ? null : entries[stats.worstIndex]!,
    maxConsecutiveLosingYears: stats.maxConsecutiveLosing,
  };
}

// ---------------------------------------------------------------------------
// regime 占位
// ---------------------------------------------------------------------------

/** 构造 unassessed regime 占位（reasonCode 单一事实来源自 experimentLineage）。 */
export function unassessedRegimePerformance(
  reason: string = DEFAULT_REGIME_UNASSESSED_REASON
): TradeQualityRegimePerformance {
  return { kind: "unassessed", reasonCode: REGIME_UNASSESSED_REASON_CODE, reason };
}

/** regime 是否 unassessed（判别辅助）。 */
export function isRegimeUnassessed(regime: TradeQualityRegimePerformance): boolean {
  return regime.kind === "unassessed";
}

// ---------------------------------------------------------------------------
// 交易质量指标组（复用 STEP 8 computeMetrics 的 trade 段）
// ---------------------------------------------------------------------------

function computeTradeQualityBlock(
  trades: readonly Trade[],
  curve: readonly EquityPoint[],
  annualizationFactor: number
): TradeQualityMetrics {
  // 复用 STEP 8 computeMetrics：initialCapital 取曲线首点 equity（研究曲线锚点），
  // 只消费其 trade 段数值（tradeCount/completedTradeCount/winRate/profitFactor/
  // averageWin/averageLoss/expectancy），保证与生产口径逐位一致、无第二套实现。
  // 传入可变副本以满足 STEP 8 签名（函数只读，不产生副作用）。
  const step8 = computeMetrics({
    equityCurve: curve.map((point) => ({ ...point })),
    trades: [...trades],
    initialCapital: curve[0]!.equity,
    annualizationFactor,
  });

  const equities = curve.map((point) => point.equity);
  const curveDates = curve.map((point) => point.date);
  const holding = computeAverageHoldingPeriodDays(trades, curveDates);
  const turnover = computeTurnoverMetrics(trades, equities, annualizationFactor);

  return {
    totalTradeCount: trades.length,
    completedTradeCount: step8.completedTradeCount,
    winRatePct: step8.winRatePct,
    profitFactor: step8.profitFactor,
    averageWin: step8.averageWin,
    averageLoss: step8.averageLoss,
    expectancy: step8.expectancy,
    averageHoldingPeriodDays: holding.averageHoldingPeriodDays,
    holdingPeriodCoveredCount: holding.coveredCount,
    holdingPeriodUnavailableCount: holding.unavailableCount,
    turnover,
  };
}

// ---------------------------------------------------------------------------
// 综合评估（主入口纯函数）
// ---------------------------------------------------------------------------

/**
 * 计算 C-16.3 交易质量与稳定性综合指标（纯函数、确定性、无副作用）。
 * 输入退化/非法 → 结构化抛错（见文件头「退化输入策略」）。
 */
export function computeTradeQualityMetrics(
  input: TradeQualityEvaluationInput
): TradeQualityEvaluationMetrics {
  assertValidParameters(input);
  assertValidEquityCurve(input.equityCurve);

  const monthly = computeMonthlyConsistency(input.equityCurve);
  const yearly = computeYearlyConsistency(input.equityCurve);
  const annualizationFactor = input.annualizationFactor ?? 252;

  let tradeQuality: TradeQualityMetrics | null = null;
  if (input.trades !== undefined) {
    assertValidTrades(input.trades);
    tradeQuality = computeTradeQualityBlock(input.trades, input.equityCurve, annualizationFactor);
  }

  return {
    tradeQuality,
    monthly,
    yearly,
    regime: unassessedRegimePerformance(),
  };
}
