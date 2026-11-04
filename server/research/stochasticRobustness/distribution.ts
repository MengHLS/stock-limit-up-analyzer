/**
 * STEP 18 / C-18.2 — 经验分布摘要、百分位置信区间、尾部概率（纯函数、确定性）。
 *
 * 口径（复用既有统计原语，不另立标准）：
 *   - 分位数 / 中位数 / 均值 / 样本标准差一律复用 `shared/quant-stats`
 *     （`percentile` 线性插值 = R type 7 / numpy 默认；`sampleStandardDeviation`）；
 *   - 置信区间 = **百分位区间**：lower = P100·alpha/2、upper = P100·(1 − alpha/2)
 *     （未做 BCa / bootstrap-t 偏差校正，诚实声明，见 bootstrap.ts）；
 *   - 基准百分位 = 中秩口径：100 × (count(s < b) + 0.5 × count(s == b)) / n；
 *   - 尾部概率以**百分比**（0~100）表达，字段名带 `Pct` 后缀明示。
 *
 * 铁律：纯函数、无 IO / Date.now / Math.random；空样本拒绝静默产出（调用方须先
 * 保证有成功样本，本层对空输入抛错）。
 */

import { mean, percentile, sampleStandardDeviation } from "../../../shared/quant-stats";
import type {
  StochasticConfidenceInterval,
  StochasticDistributionSummary,
  StochasticMetricInference,
  StochasticMetricKey,
  StochasticMetricsView,
  StochasticQuantileSummary,
  StochasticTailProbabilities,
} from "./types";

function requireValues(values: readonly number[], label: string): number[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`summarizeStochasticQuantiles(${label}): 样本为空，拒绝静默产出分布摘要`);
  }
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) {
    throw new Error(`summarizeStochasticQuantiles(${label}): 样本无有限数值（禁止 NaN / Infinity）`);
  }
  return finite;
}

function quantileOrThrow(values: number[], p: number, label: string): number {
  const value = percentile(values, p);
  if (value === null) {
    throw new Error(`分位数计算失败（${label}, p=${p}）：样本不可用`);
  }
  return value;
}

/** 经验分位摘要（count / mean / stdDev / min / max / p05 / p25 / median / p75 / p95）。 */
export function summarizeStochasticQuantiles(
  values: readonly number[],
  label = "values"
): StochasticQuantileSummary {
  const finite = requireValues(values, label);
  let min = finite[0]!;
  let max = finite[0]!;
  for (const value of finite) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const meanValue = mean(finite);
  if (meanValue === null) {
    throw new Error(`summarizeStochasticQuantiles(${label}): 均值计算失败`);
  }
  return {
    count: finite.length,
    mean: meanValue,
    stdDev: sampleStandardDeviation(finite),
    min,
    max,
    p05: quantileOrThrow(finite, 5, label),
    p25: quantileOrThrow(finite, 25, label),
    median: quantileOrThrow(finite, 50, label),
    p75: quantileOrThrow(finite, 75, label),
    p95: quantileOrThrow(finite, 95, label),
  };
}

/**
 * 基准值在经验分布中的百分位（中秩口径，0~100）。
 * 基准为 null / 无样本 → null（不伪造 50）。
 */
export function computeStochasticPercentileRank(
  values: readonly number[],
  baseline: number | null
): number | null {
  if (baseline === null || !Number.isFinite(baseline)) return null;
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const value of finite) {
    if (value < baseline) below += 1;
    else if (value === baseline) equal += 1;
  }
  return ((below + equal / 2) / finite.length) * 100;
}

/** 百分位置信区间（level% = (1 − alpha) × 100）。 */
export function computeStochasticConfidenceInterval(
  values: readonly number[],
  alpha: number
): StochasticConfidenceInterval {
  const finite = requireValues(values, "confidenceInterval");
  return {
    levelPct: (1 - alpha) * 100,
    lower: quantileOrThrow(finite, (alpha / 2) * 100, "ciLower"),
    upper: quantileOrThrow(finite, (1 - alpha / 2) * 100, "ciUpper"),
  };
}

/** 单指标的分布 + 区间 + 基准相对位置推断。 */
export function buildStochasticMetricInference(input: {
  readonly values: readonly number[];
  readonly baseline: number | null;
  readonly alpha: number;
  readonly label: string;
}): StochasticMetricInference {
  const summary = summarizeStochasticQuantiles(input.values, input.label);
  const confidenceInterval = computeStochasticConfidenceInterval(input.values, input.alpha);
  const baselinePercentile = computeStochasticPercentileRank(input.values, input.baseline);
  const lowerTail = (input.alpha / 2) * 100;
  const upperTail = 100 - lowerTail;
  return {
    summary,
    confidenceInterval,
    baselinePercentile,
    baselineWithinCi:
      baselinePercentile !== null &&
      baselinePercentile >= lowerTail &&
      baselinePercentile <= upperTail,
    baselineInTail:
      baselinePercentile !== null &&
      (baselinePercentile < lowerTail || baselinePercentile > upperTail),
  };
}

function collectMetric(
  samples: readonly StochasticMetricsView[],
  key: StochasticMetricKey
): number[] {
  const values: number[] = [];
  for (const sample of samples) {
    const value = sample[key];
    if (typeof value === "number" && Number.isFinite(value)) values.push(value);
  }
  return values;
}

/** 三指标分布推断（sharpe 全样本为 null → null，不伪造分布）。 */
export function summarizeStochasticDistribution(input: {
  readonly samples: readonly StochasticMetricsView[];
  readonly baseline: StochasticMetricsView;
  readonly alpha: number;
}): StochasticDistributionSummary {
  if (input.samples.length === 0) {
    throw new Error("summarizeStochasticDistribution: 无成功样本，拒绝产出分布摘要");
  }
  const totalReturnValues = collectMetric(input.samples, "totalReturnPct");
  const drawdownValues = collectMetric(input.samples, "maxDrawdownPct");
  const sharpeValues = collectMetric(input.samples, "sharpe");
  if (totalReturnValues.length === 0 || drawdownValues.length === 0) {
    throw new Error(
      "summarizeStochasticDistribution: totalReturnPct / maxDrawdownPct 无可用样本（禁止静默 NaN）"
    );
  }
  return {
    totalReturnPct: buildStochasticMetricInference({
      values: totalReturnValues,
      baseline: input.baseline.totalReturnPct,
      alpha: input.alpha,
      label: "totalReturnPct",
    }),
    maxDrawdownPct: buildStochasticMetricInference({
      values: drawdownValues,
      baseline: input.baseline.maxDrawdownPct,
      alpha: input.alpha,
      label: "maxDrawdownPct",
    }),
    sharpe:
      sharpeValues.length === 0
        ? null
        : buildStochasticMetricInference({
            values: sharpeValues,
            baseline: input.baseline.sharpe,
            alpha: input.alpha,
            label: "sharpe",
          }),
  };
}

/** 尾部概率（%，0~100）。 */
export function computeStochasticTailProbabilities(input: {
  readonly samples: readonly StochasticMetricsView[];
  readonly drawdownThresholdPct: number;
}): StochasticTailProbabilities {
  const succeeded = input.samples;
  if (succeeded.length === 0) {
    throw new Error("computeStochasticTailProbabilities: 无成功样本，拒绝产出尾部概率");
  }
  let lossCount = 0;
  let drawdownExceedCount = 0;
  let sharpeConsidered = 0;
  let sharpeNegative = 0;
  for (const sample of succeeded) {
    if (sample.totalReturnPct < 0) lossCount += 1;
    if (sample.maxDrawdownPct > input.drawdownThresholdPct) drawdownExceedCount += 1;
    if (sample.sharpe !== null && Number.isFinite(sample.sharpe)) {
      sharpeConsidered += 1;
      if (sample.sharpe < 0) sharpeNegative += 1;
    }
  }
  const n = succeeded.length;
  return {
    probLossPct: (lossCount / n) * 100,
    probDrawdownExceedsPct: (drawdownExceedCount / n) * 100,
    drawdownThresholdPct: input.drawdownThresholdPct,
    probNegativeSharpePct: sharpeConsidered === 0 ? null : (sharpeNegative / sharpeConsidered) * 100,
  };
}
