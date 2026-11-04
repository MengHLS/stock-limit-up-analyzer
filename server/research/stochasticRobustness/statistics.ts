/**
 * STEP 18 / C-18.2 — 路径统计（复利总收益 / 最大回撤 / Sharpe）与数值契约校验。
 *
 * 口径（与既有层对齐，不另立标准）：
 *   - 总收益：按 stepReturns 逐步复利，totalReturnPct = (Π(1 + r) − 1) × 100；
 *   - 最大回撤：权益路径 e0 = 1、e_i = e_{i−1} × (1 + r_i)，peak = 历史最大，
 *     depthPct = (peak − e) / peak × 100，取全程最大值（>= 0）；
 *   - Sharpe：复用 `shared/quant-stats` 的 `sharpeRatio`（mean / sampleStd × √ann，
 *     rf = 0，与 C-16.2 及 STEP 8 口径一致）——
 *       · 日收益序列（sourceKind="dailyReturn"）→ 年化因子 = annualizationFactor（默认 252）；
 *       · trade 级序列（sourceKind="tradeReturn"）→ **不年化（因子固定 1）**：
 *         成交频率不固定，按 √252 年化会伪造精度，故报告「每笔 Sharpe」。
 *
 * 数值契约（FAIL FAST，禁止静默 NaN / clamp）：
 *   - 序列元素必须有限，且 **r > −1**（1 + r > 0）：r <= −100% 会让权益归零并使
 *     后续回撤出现 0/0；
 *   - 序列长度 < 2 → 拒绝（单点序列无分布可言）；
 *   - 绩效标量：totalReturnPct / maxDrawdownPct 必须有限、maxDrawdownPct >= 0、
 *     tradeCount 为 null 或非负整数。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random。
 */

import { sharpeRatio } from "../../../shared/quant-stats";
import type {
  StochasticMetricKey,
  StochasticMetricsView,
  StochasticSourceKind,
} from "./types";
import { STOCHASTIC_MIN_SOURCE_LENGTH, STOCHASTIC_MIN_STEP_RETURN } from "./types";

// ---------------------------------------------------------------------------
// 序列校验
// ---------------------------------------------------------------------------

/**
 * 校验收益序列（小数）。合法返回 null，否则返回人类可读错误串。
 * 长度不足 / 元素非有限 / r <= −100% 均拒绝。
 */
export function validateStochasticSeries(
  series: readonly number[],
  label: string
): string | null {
  if (!Array.isArray(series)) {
    return `${label} 必须是数组`;
  }
  if (series.length === 0) {
    return `${label} 不能为空（空序列无法做随机化鲁棒性测试）`;
  }
  if (series.length < STOCHASTIC_MIN_SOURCE_LENGTH) {
    return `${label} 长度 ${series.length} < ${STOCHASTIC_MIN_SOURCE_LENGTH}（单点序列无分布可言，拒绝静默产出）`;
  }
  for (let i = 0; i < series.length; i += 1) {
    const value = series[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${label}[${i}] 必须是有限数字（禁止 NaN / Infinity），实际 ${String(value)}`;
    }
    if (value <= STOCHASTIC_MIN_STEP_RETURN) {
      return `${label}[${i}] = ${value} <= ${STOCHASTIC_MIN_STEP_RETURN}（单步收益不能 <= -100%，否则权益归零导致回撤除零）`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 绩效标量校验
// ---------------------------------------------------------------------------

/** 校验绩效视图。合法返回 null，否则返回人类可读错误串。 */
export function validateStochasticMetricsView(metrics: StochasticMetricsView): string | null {
  if (metrics === null || typeof metrics !== "object") {
    return "绩效视图必须是对象";
  }
  const problems: string[] = [];
  for (const field of ["totalReturnPct", "maxDrawdownPct"] as const) {
    if (typeof metrics[field] !== "number" || !Number.isFinite(metrics[field])) {
      problems.push(`${field} 必须是有限数字（禁止 NaN / Infinity）`);
    }
  }
  if (typeof metrics.maxDrawdownPct === "number" && metrics.maxDrawdownPct < 0) {
    problems.push(`maxDrawdownPct 不能为负（实际 ${metrics.maxDrawdownPct}）`);
  }
  if (metrics.sharpe !== null && (typeof metrics.sharpe !== "number" || !Number.isFinite(metrics.sharpe))) {
    problems.push("sharpe 必须为 null 或有限数字");
  }
  if (metrics.tradeCount !== null) {
    if (typeof metrics.tradeCount !== "number" || !Number.isInteger(metrics.tradeCount)) {
      problems.push("tradeCount 必须为 null 或整数");
    } else if (metrics.tradeCount < 0) {
      problems.push(`tradeCount 不能为负（实际 ${metrics.tradeCount}）`);
    }
  }
  return problems.length === 0 ? null : problems.join("；");
}

/** 取指标数值（sharpe 可为 null；tradeCount 不参与分布统计）。 */
export function readStochasticMetric(
  metrics: StochasticMetricsView,
  key: StochasticMetricKey
): number | null {
  return metrics[key];
}

// ---------------------------------------------------------------------------
// 路径统计
// ---------------------------------------------------------------------------

/**
 * 计算复利路径的最大回撤深度（%，>= 0）。
 * 输入序列须已通过 `validateStochasticSeries`（本函数对退化输入抛错，不静默）。
 */
export function computeStochasticMaxDrawdownPct(stepReturns: readonly number[]): number {
  const problem = validateStochasticSeries(stepReturns, "stepReturns");
  if (problem !== null) {
    throw new Error(`computeStochasticMaxDrawdownPct: ${problem}`);
  }
  let equity = 1;
  let peak = 1;
  let maxDepth = 0;
  for (const step of stepReturns) {
    equity *= 1 + step;
    if (equity > peak) peak = equity;
    const depth = (peak - equity) / peak;
    if (depth > maxDepth) maxDepth = depth;
  }
  return maxDepth * 100;
}

/**
 * 计算一条收益路径的绩效标量。
 *
 * @param stepReturns   逐步收益（小数），顺序即路径顺序
 * @param sourceKind    决定 Sharpe 是否年化（日收益 → annualizationFactor；trade → 1）
 * @param annualizationFactor 年化因子（> 0）
 * @param tradeCount    成交笔数回显（null 表示未知）
 */
export function computeStochasticPathMetrics(input: {
  readonly stepReturns: readonly number[];
  readonly sourceKind: StochasticSourceKind;
  readonly annualizationFactor: number;
  readonly tradeCount: number | null;
}): StochasticMetricsView {
  const problem = validateStochasticSeries(input.stepReturns, "stepReturns");
  if (problem !== null) {
    throw new Error(`computeStochasticPathMetrics: ${problem}`);
  }
  if (!Number.isFinite(input.annualizationFactor) || input.annualizationFactor <= 0) {
    throw new Error(
      `computeStochasticPathMetrics: annualizationFactor 必须 > 0，实际 ${String(input.annualizationFactor)}`
    );
  }

  let equity = 1;
  let peak = 1;
  let maxDepth = 0;
  for (const step of input.stepReturns) {
    equity *= 1 + step;
    if (equity > peak) peak = equity;
    const depth = (peak - equity) / peak;
    if (depth > maxDepth) maxDepth = depth;
  }

  const sharpeFactor = input.sourceKind === "dailyReturn" ? input.annualizationFactor : 1;
  const sharpe = sharpeRatio([...input.stepReturns], sharpeFactor);

  return {
    totalReturnPct: (equity - 1) * 100,
    maxDrawdownPct: maxDepth * 100,
    sharpe,
    tradeCount: input.tradeCount,
  };
}
