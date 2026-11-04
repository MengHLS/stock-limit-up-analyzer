/**
 * STEP 16 / C-16.2 — 策略评价·风险调整指标：确定性计算核心（纯函数）。
 *
 * 背景与边界：
 *   - C-16.1（performanceMetrics，CODE_READY）已交付收益 / 风险 / 回撤确定性评估器，
 *     并明确把 Sharpe / Sortino / Calmar 留作 C-16.2 扩展槽。本文件只补这三个
 *     「风险调整比率」及其成分纯函数；日收益序列、回撤分段、曲线校验、错误类
 *     一律 import 复用 C-16.1 analyze.ts 的既有导出，不重新实现、不越界。
 *
 * 口径核对（STEP 8 backtest/metrics·shared/quant-stats vs 本任务）：
 *   1. Sharpe —— STEP 8（shared sharpeRatio）定义：
 *        sharpeRatio(dailyReturns, ann) = mean(r) / sampleStd(r) · √ann，
 *        无风险利率固定 0（即超额收益 = 日收益）。
 *      本任务将口径推广为可配置 rfAnnualPct：在日超额收益 e_i = r_i − rf_daily
 *      （rf_daily = rfAnnualPct/100/ann）上应用同一公式（常数平移不改样本标准差，
 *      故 sampleStd(e) = sampleStd(r)）。rfAnnualPct = 0 时与 STEP 8 逐位一致，
 *      是生产/研究同口径对表的锚点（STEP 8 输出 round 到 4 位，本任务不 round）。
 *   2. Sortino —— STEP 8 未实现。下行偏差分母取 C-16.1 已确立的语义：
 *      √(mean(min(收益 − 目标, 0)²))，总体口径（分母 = 日收益个数），年化 × √ann。
 *      C-16.1 只在 RiskMetrics.downsideDeviationPct 暴露其年化结果，未导出该纯函数，
 *      本任务以相同定义独立实现 downsideDeviationDaily，并用 C-16.1 输出做对照测试锁定。
 *      目标位于超额收益空间（downsideTarget 默认 0 = 只计低于无风险日收益的回落）。
 *   3. Calmar —— CAGR / |MaxDD|。CAGR = (end/start)^(ann/n) − 1，与 C-16.1
 *      ReturnMetrics.cagrPct、STEP 8 annualizedReturnPct 同公式（shared 原语），
 *      锚点 = equityCurve[0].equity（同 C-16.1 曲线视角）；MaxDD 复用 C-16.1
 *      analyzeDrawdown 的 running-peak 口径，故与 DrawdownMetrics.maxDrawdownPct 同值。
 *      消费 C-16.1 产物（同一曲线）时自动继承其曲线锚点口径。
 *
 * 口径约定（全文件统一，数值单位见各函数注释）：
 *   - 日收益 r_i = equity_i / equity_{i−1} − 1（小数）；年化交易日数 ann 默认 252。
 *   - rfAnnualPct 为百分数（%），默认 0；日无风险收益 rf_daily = rfAnnualPct/100/ann。
 *   - 「年化算术超额收益」= mean(e) × ann（Sharpe/Sortino 分子，对齐 STEP 8 算术口径）；
 *     CAGR 为几何年化，只用于 Calmar。两者概念不同，禁止混用。
 *
 * 退化与无定义策略（响亮失败 or 显式 null，绝不静默 NaN / Infinity）：
 *   - equityCurve 为空 / < 2 点 / equity 非有限或 <= 0 / 日期乱序 → 复用 C-16.1
 *     assertValidEquityCurve 抛错。
 *   - 口径参数非法（ann <= 0、非有限 rf / downsideTarget）→ 抛错（INVALID_PARAMETER）。
 *   - 比率类指标：日收益样本 < 2（权益点 < 3）→ null（样本方差/均值无意义，对齐
 *     shared sharpeRatio 与 C-16.1 annualizedVolatilityPct 的 null 语义）；
 *     样本标准差 = 0（零波动）→ Sharpe null；下行偏差 = 0（无低于目标回落）→
 *     Sortino null；maxDrawdownPct = 0（无回撤）→ Calmar null。
 *   - 成分回显指标（波动/下行偏差/CAGR/MaxDD）对合法曲线恒有定义（数值或 null），
 *     供调用方透明核对比率分母。
 */

import {
  annualizedReturnFromEquityCurve,
  mean,
  sampleStandardDeviation,
  sharpeRatio,
} from "../../../shared/quant-stats";
import {
  PerformanceEvaluationError,
  analyzeDrawdown,
  assertValidEquityCurve,
  dailyReturnSeries,
} from "../performanceMetrics/analyze";
import type { RiskAdjustedEvaluationInput, RiskAdjustedMetrics } from "./types";

// ---------------------------------------------------------------------------
// 选项类型与校验
// ---------------------------------------------------------------------------

/** 无风险利率与年化交易日数选项（均可选，缺省见各函数）。 */
export interface RfAnnualizationOptions {
  /** 无风险年利率（%，默认 0）。 */
  readonly rfAnnualPct?: number;
  /** 年化交易日数（默认 252）。 */
  readonly annualizationFactor?: number;
}

/** Sortino 附加选项（在下行偏差上叠加 downsideTarget）。 */
export interface DownsideTargetOptions {
  /** 下行偏差目标日收益（小数，超额收益空间，默认 0）。 */
  readonly downsideTarget?: number;
  /** 年化交易日数（默认 252）。 */
  readonly annualizationFactor?: number;
}

/** 下行偏差百分位回显选项。 */
export interface DownsideDeviationOptions {
  readonly downsideTarget?: number;
  readonly annualizationFactor?: number;
}

function assertFiniteOption(
  value: number | undefined,
  label: string,
  minExclusive?: number
): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || (minExclusive !== undefined && value <= minExclusive)) {
    const bound = minExclusive !== undefined ? `（须 > ${minExclusive}）` : "（须为有限数）";
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `riskAdjustedMetrics: ${label}=${String(value)}${bound}`
    );
  }
}

/** 校验 C-16.2 口径参数（响亮抛错，不静默回退）。 */
function assertValidRiskAdjustedParameters(input: RiskAdjustedEvaluationInput): void {
  assertFiniteOption(input.annualizationFactor, "annualizationFactor", 0);
  assertFiniteOption(input.rfAnnualPct, "rfAnnualPct");
  assertFiniteOption(input.downsideTarget, "downsideTarget");
}

/** 校验纯函数级选项（缺省默认值已由调用方/函数体内确定，只做有限性断言）。 */
function assertValidOptions(options: {
  rfAnnualPct?: number;
  annualizationFactor?: number;
  downsideTarget?: number;
}): void {
  assertFiniteOption(options.annualizationFactor, "annualizationFactor", 0);
  assertFiniteOption(options.rfAnnualPct, "rfAnnualPct");
  assertFiniteOption(options.downsideTarget, "downsideTarget");
}

// ---------------------------------------------------------------------------
// 日下行偏差（总体口径，对齐 C-16.1 analyze.ts 的 downsideDeviationDaily）
// ---------------------------------------------------------------------------

/**
 * 日下行偏差（小数）：√( mean( min(值 − 目标, 0)² ) )。
 *
 * 口径 = C-16.1 RiskMetrics.downsideDeviationPct 的日频底层（总体分母 = 样本个数，
 * 非 n−1）。C-16.1 未导出该纯函数（只暴露年化 % 结果），本文件按同一定义独立实现，
 * 并以 computeDownsideDeviationPct 与 C-16.1 输出对照测试锁定同值。
 * 调用方必须保证 values 非空（空数组无定义；合法曲线至少有 1 个日收益）。
 */
function downsideDeviationDaily(values: readonly number[], target: number): number {
  const n = values.length;
  let sumSquares = 0;
  for (const value of values) {
    const below = value - target;
    if (below < 0) sumSquares += below * below;
  }
  return Math.sqrt(sumSquares / n);
}

// ---------------------------------------------------------------------------
// 风险调整比率纯函数（输入日收益小数序列，输出比率或显式 null）
// ---------------------------------------------------------------------------

/**
 * 计算日下行偏差年化百分数：
 * √(mean(min(x − downsideTarget, 0)²)) × √ann × 100（对有限值样本，总体口径）。
 * 无有限值样本 → null（与 shared「样本不足」null 语义一致）。
 */
export function computeDownsideDeviationPct(
  values: readonly number[],
  options?: DownsideDeviationOptions
): number | null {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return null;
  const ann = options?.annualizationFactor ?? 252;
  const target = options?.downsideTarget ?? 0;
  assertFiniteOption(ann, "annualizationFactor", 0);
  assertFiniteOption(target, "downsideTarget");
  return downsideDeviationDaily(finiteValues, target) * Math.sqrt(ann) * 100;
}

/**
 * Sharpe（日收益口径，可配无风险利率）：
 *   = mean(e) / sampleStd(e) × √ann，其中 e_i = x_i − rfAnnualPct/100/ann。
 * rfAnnualPct = 0 时与 shared/quant-stats.sharpeRatio 逐位一致（STEP 8 锚点）。
 * 有限样本 < 2 或样本标准差 = 0（零波动）→ null（绝不返回 Infinity，对齐 shared）。
 */
export function computeSharpeRatio(
  dailyReturns: readonly number[],
  options?: RfAnnualizationOptions
): number | null {
  const ann = options?.annualizationFactor ?? 252;
  const rfAnnualPct = options?.rfAnnualPct ?? 0;
  assertValidOptions({ annualizationFactor: ann, rfAnnualPct });
  const rfDaily = rfAnnualPct / 100 / ann;
  const excess = dailyReturns.map((value) => value - rfDaily);
  return sharpeRatio(excess, ann);
}

/**
 * Sortino（日收益口径，可配无风险利率与下行目标）：
 *   = (mean(e) × ann) / (√(mean(min(e − downsideTarget, 0)²)) × √ann)，
 * 其中 e_i = x_i − rfAnnualPct/100/ann（下行偏差为总体口径）。
 * 有限样本 < 2 或下行偏差 = 0（无低于目标回落）→ null。
 */
export function computeSortinoRatio(
  dailyReturns: readonly number[],
  options?: RfAnnualizationOptions & DownsideTargetOptions
): number | null {
  const finiteValues = dailyReturns.filter((value) => Number.isFinite(value));
  if (finiteValues.length < 2) return null;
  const ann = options?.annualizationFactor ?? 252;
  const rfAnnualPct = options?.rfAnnualPct ?? 0;
  const target = options?.downsideTarget ?? 0;
  assertValidOptions({ annualizationFactor: ann, rfAnnualPct, downsideTarget: target });
  const rfDaily = rfAnnualPct / 100 / ann;
  const excess = finiteValues.map((value) => value - rfDaily);
  const ddDaily = downsideDeviationDaily(excess, target);
  if (ddDaily === 0) return null;
  const meanExcess = mean(excess)!; // 有限样本 >= 2，mean 必非 null
  return (meanExcess * ann) / (ddDaily * Math.sqrt(ann));
}

/**
 * Calmar = CAGR / |MaxDD|（两者均以小数传入，如 0.3 表示 30% / 0.1 表示 10%）。
 * maxDrawdownFraction = 0（无回撤，分母为 0）→ null。任一输入非有限或
 * maxDrawdownFraction < 0 → 抛错（响亮失败，不静默）。
 */
export function computeCalmarRatio(
  cagrFraction: number,
  maxDrawdownFraction: number
): number | null {
  if (!Number.isFinite(cagrFraction) || !Number.isFinite(maxDrawdownFraction)) {
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `riskAdjustedMetrics: computeCalmarRatio 入参须为有限数（cagr=${String(cagrFraction)}, maxDD=${String(maxDrawdownFraction)}）`
    );
  }
  if (maxDrawdownFraction < 0) {
    throw new PerformanceEvaluationError(
      "INVALID_PARAMETER",
      `riskAdjustedMetrics: maxDrawdownFraction=${maxDrawdownFraction} 须 >= 0`
    );
  }
  if (maxDrawdownFraction === 0) return null;
  return cagrFraction / maxDrawdownFraction;
}

// ---------------------------------------------------------------------------
// 综合风险调整评估（主入口纯函数）
// ---------------------------------------------------------------------------

/**
 * 计算 C-16.2 风险调整指标（纯函数、确定性、无副作用）。
 * 输入退化/非法 → 结构化抛错（复用 C-16.1 assertValidEquityCurve 曲线校验；
 * 口径参数非法抛 INVALID_PARAMETER）；比率无定义场景返回显式 null（见文件头）。
 */
export function computeRiskAdjustedMetrics(
  input: RiskAdjustedEvaluationInput
): RiskAdjustedMetrics {
  assertValidRiskAdjustedParameters(input);
  assertValidEquityCurve(input.equityCurve);

  const annualizationFactor = input.annualizationFactor ?? 252;
  const rfAnnualPct = input.rfAnnualPct ?? 0;
  const downsideTarget = input.downsideTarget ?? 0;

  const equities = input.equityCurve.map((point) => point.equity);
  const returns = dailyReturnSeries(equities);
  const n = returns.length; // >= 1（assertValidEquityCurve 保证点数 >= 2）

  const rfDaily = rfAnnualPct / 100 / annualizationFactor;
  const excess = returns.map((value) => value - rfDaily);
  const meanExcess = mean(excess)!; // n >= 1，mean 必非 null

  const sampleStd = sampleStandardDeviation(returns);
  const ddDaily = downsideDeviationDaily(excess, downsideTarget);

  const cagrFraction = annualizedReturnFromEquityCurve(
    equities[0]!,
    equities[equities.length - 1]!,
    n,
    annualizationFactor
  );
  if (cagrFraction === null) {
    // 校验层已保证 equity > 0、n >= 1、annualizationFactor > 0，正常不可达；
    // 防御性抛错避免静默。
    throw new PerformanceEvaluationError(
      "INTERNAL_CAGR_UNAVAILABLE",
      `riskAdjustedMetrics: CAGR 计算返回 null（start=${equities[0]}, end=${equities[equities.length - 1]}, n=${n}）`
    );
  }
  const maxDrawdownPct = analyzeDrawdown(input.equityCurve).maxDrawdownPct;

  return {
    sharpeRatio: computeSharpeRatio(returns, { rfAnnualPct, annualizationFactor }),
    sortinoRatio: computeSortinoRatio(returns, {
      rfAnnualPct,
      downsideTarget,
      annualizationFactor,
    }),
    calmarRatio: computeCalmarRatio(cagrFraction, maxDrawdownPct / 100),
    annualizedExcessReturnPct: meanExcess * annualizationFactor * 100,
    annualizedVolatilityPct:
      sampleStd === null ? null : sampleStd * Math.sqrt(annualizationFactor) * 100,
    downsideDeviationPct: ddDaily * Math.sqrt(annualizationFactor) * 100,
    cagrPct: cagrFraction * 100,
    maxDrawdownPct,
  };
}
