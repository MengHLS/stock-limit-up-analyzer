/**
 * 量化研究统一统计基础层（Phase 1 Step 1）。
 *
 * 这是全系统唯一的统计数学实现，目标：
 * - 无数据库 / Express / tRPC / React / 策略业务 / UI 依赖。
 * - 纯函数优先，不修改输入数组，不依赖全局状态，不使用随机数。
 * - 明确 population vs sample、空数组、单元素、NaN/Infinity 的边界行为。
 *
 * 设计约定（务必遵守，禁止各业务文件再自造一份）：
 * 1. 所有聚合/矩/分位/相关函数在内部过滤非有限值（NaN / ±Infinity），
 *    过滤后样本不足时返回 `null`，绝不静默产出 NaN/Infinity 进入下游评分。
 * 2. `null` 是"样本不足以可靠计算"的统一信号；调用方据此跳过或降级。
 * 3. 本文件不负责时间对齐——RankIC 的 T 日因子 → T+1 收益对齐由上层保证。
 */

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 过滤出有限值（排除 NaN / ±Infinity），不修改原数组。 */
function finite(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

/** 类型守卫：是否为有限数值（排除 NaN / ±Infinity）。 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 数值比较器（升序）。 */
const ascending = (left: number, right: number) => left - right;

// ---------------------------------------------------------------------------
// 基础统计
// ---------------------------------------------------------------------------

/** 算术平均；空数组或全非有限值返回 null。 */
export function mean(values: number[]): number | null {
  const valid = finite(values);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

/** 中位数（偶数取中间两者均值）；空数组或全非有限值返回 null。 */
export function median(values: number[]): number | null {
  const valid = finite(values);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort(ascending);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** 总体方差：Σ(x-μ)² / n；样本数 < 1 返回 null。 */
export function variance(values: number[]): number | null {
  const valid = finite(values);
  if (valid.length === 0) return null;
  const meanValue = mean(valid)!;
  return valid.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / valid.length;
}

/** 样本方差：Σ(x-μ)² / (n-1)；样本数 < 2 返回 null。 */
export function sampleVariance(values: number[]): number | null {
  const valid = finite(values);
  if (valid.length < 2) return null;
  const meanValue = mean(valid)!;
  return valid.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (valid.length - 1);
}

/** 总体标准差 = sqrt(variance)；样本数 < 1 返回 null。 */
export function standardDeviation(values: number[]): number | null {
  const value = variance(values);
  return value === null ? null : Math.sqrt(value);
}

/** 样本标准差 = sqrt(sampleVariance)；样本数 < 2 返回 null。 */
export function sampleStandardDeviation(values: number[]): number | null {
  const value = sampleVariance(values);
  return value === null ? null : Math.sqrt(value);
}

// ---------------------------------------------------------------------------
// 偏度与峰度（统一采用 sample-adjusted Fisher-Pearson 定义）
// ---------------------------------------------------------------------------

/**
 * 偏度（adjusted Fisher-Pearson，g1）。
 *
 * 定义：g1 = [ n / ((n-1)(n-2)) ] · Σ((xᵢ - x̄)/s)³
 * 其中 x̄ 为样本均值，s 为样本标准差（除以 n-1）。
 *
 * 边界：n < 3 或 s = 0 时返回 null（分母无定义 / 常数序列无偏度）。
 */
export function skewness(values: number[]): number | null {
  const valid = finite(values);
  const n = valid.length;
  if (n < 3) return null;
  const meanValue = mean(valid)!;
  const std = sampleStandardDeviation(valid);
  if (std === null || std === 0) return null;
  const sumCubes = valid.reduce((sum, value) => sum + ((value - meanValue) / std) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sumCubes;
}

/**
 * 超额峰度（adjusted Fisher-Pearson，g2，excess kurtosis）。
 *
 * 定义：g2 = [ n(n+1) / ((n-1)(n-2)(n-3)) ] · Σ((xᵢ - x̄)/s)⁴
 *           − [ 3(n-1)² / ((n-2)(n-3)) ]
 * 其中 x̄ 为样本均值，s 为样本标准差（除以 n-1）。
 *
 * 边界：n < 4 或 s = 0 时返回 null。
 */
export function excessKurtosis(values: number[]): number | null {
  const valid = finite(values);
  const n = valid.length;
  if (n < 4) return null;
  const meanValue = mean(valid)!;
  const std = sampleStandardDeviation(valid);
  if (std === null || std === 0) return null;
  const sumQuads = valid.reduce((sum, value) => sum + ((value - meanValue) / std) ** 4, 0);
  const term1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * sumQuads;
  const term2 = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return term1 - term2;
}

// ---------------------------------------------------------------------------
// 分位数
// ---------------------------------------------------------------------------

/**
 * 分位数（线性插值，等价 R type 7 / numpy 默认）。
 *
 * - q ∈ [0, 1]；越界返回 null。
 * - 内部排序，插值索引 index = (n-1) · q。
 * - 空数组返回 null。
 */
export function quantile(values: number[], q: number): number | null {
  if (!Number.isFinite(q) || q < 0 || q > 1) return null;
  const valid = finite(values);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort(ascending);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

/** 百分位（p ∈ [0, 100]），等价 quantile(values, p / 100)。 */
export function percentile(values: number[], p: number): number | null {
  if (!Number.isFinite(p) || p < 0 || p > 100) return null;
  return quantile(values, p / 100);
}

// ---------------------------------------------------------------------------
// 相关性
// ---------------------------------------------------------------------------

/** 对两向量做平均秩（并列值取平均秩）。 */
function rankValues(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < indexed.length; i += 1) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.value === indexed[i]!.value) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k]!.index] = averageRank;
    i = j;
  }
  return ranks;
}

/** 提取两向量同时为有限值的配对；任一为空或长度不一致时抛错。 */
function paired(x: Array<number | null>, y: Array<number | null>): Array<[number, number]> {
  if (x.length !== y.length) {
    throw new Error(`quant-stats: 相关计算要求两向量等长，实际 ${x.length} vs ${y.length}`);
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i];
    const yi = y[i];
    if (xi === null || yi === null || !Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    pairs.push([xi, yi]);
  }
  return pairs;
}

/** 由配对计算 Pearson 相关系数；样本 < 3 或任一变差为 0 返回 null。 */
function pearsonFromPairs(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 3) return null;
  const xs = pairs.map((pair) => pair[0]);
  const ys = pairs.map((pair) => pair[1]);
  const meanX = mean(xs);
  const meanY = mean(ys);
  if (meanX === null || meanY === null) return null;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    numerator += (xs[i]! - meanX) * (ys[i]! - meanY);
    denomX += (xs[i]! - meanX) ** 2;
    denomY += (ys[i]! - meanY) ** 2;
  }
  if (denomX === 0 || denomY === 0) return null;
  return numerator / Math.sqrt(denomX * denomY);
}

/**
 * Pearson 相关系数。
 * - 长度不一致直接抛错。
 * - 仅使用两向量同时为有限值的样本；配对 < 3 或任一变差为 0 返回 null。
 */
export function pearsonCorrelation(x: Array<number | null>, y: Array<number | null>): number | null {
  return pearsonFromPairs(paired(x, y));
}

/**
 * Spearman 秩相关（纯数值底层）。
 * - 长度不一致抛错；样本 < 3 或任一变差为 0 返回 null。
 * - 缺失值采用 pairwise finite 过滤：仅保留两向量同时为有限数值的配对（与
 *   pearsonCorrelation / spearmanCorrelation / rankIC 语义一致）。
 * - 并列值使用平均秩，保持与既有技术因子评估一致的统计语义。
 */
export function spearman(x: number[], y: number[]): number | null {
  const pairs = paired(x, y);
  if (pairs.length < 3) return null;
  const xs = pairs.map((pair) => pair[0]);
  const ys = pairs.map((pair) => pair[1]);
  const rx = rankValues(xs);
  const ry = rankValues(ys);
  return pearsonFromPairs(rx.map((value, index) => [value, ry[index]!] as [number, number]));
}

/**
 * Spearman 秩相关（可空向量版）。
 * - 长度不一致抛错；仅使用同时为有限值的样本；配对 < 3 或任一变差为 0 返回 null。
 */
export function spearmanCorrelation(x: Array<number | null>, y: Array<number | null>): number | null {
  const pairs = paired(x, y);
  if (pairs.length < 3) return null;
  const xs = pairs.map((pair) => pair[0]);
  const ys = pairs.map((pair) => pair[1]);
  return spearman(xs, ys);
}

// ---------------------------------------------------------------------------
// Rank IC
// ---------------------------------------------------------------------------

/**
 * Rank IC：对因子值与前向收益分别做 rank 后计算 Spearman 相关。
 * 即 spearmanCorrelation 的语义别名。
 *
 * 注意：本函数只做两向量的秩相关；"T 日因子 → T+1 及未来收益"的时间对齐
 * 由调用方在传入数据前保证，本层不做任何日期对齐或改写。
 */
export function rankIC(factorValues: Array<number | null>, forwardReturns: Array<number | null>): number | null {
  return spearmanCorrelation(factorValues, forwardReturns);
}

// ---------------------------------------------------------------------------
// 收益年化与夏普（全系统唯一标准）
// ---------------------------------------------------------------------------

/**
 * 由权益曲线端点计算年化收益（CAGR，几何年化）。
 *
 * 定义：CAGR = (endEquity / startEquity) ^ (annualizationTradingDays / n) − 1
 *
 * 边界：起点/终点 <= 0 或 n < 1 时返回 null。
 */
export function annualizedReturnFromEquityCurve(
  startEquity: number,
  endEquity: number,
  n: number,
  annualizationTradingDays = 252,
): number | null {
  if (!Number.isFinite(startEquity) || !Number.isFinite(endEquity) || !Number.isFinite(n)) return null;
  if (startEquity <= 0 || endEquity <= 0 || n < 1 || annualizationTradingDays <= 0) return null;
  return (endEquity / startEquity) ** (annualizationTradingDays / n) - 1;
}

/**
 * 夏普比率（全系统唯一标准，算术年化）。
 *
 * 定义：Sharpe = mean(dailyReturn) / sampleStdDev(dailyReturn) · √(annualizationFactor)
 * 无风险利率默认 0，即 excessDailyReturn = dailyReturn。
 *
 * 边界：n < 2 或样本标准差 = 0 时返回 null（绝不返回 Infinity/NaN，
 * 以免污染 DSR/PSR/WFA/策略评分与排序）。
 *
 * 注意：这不是 CAGR。CAGR 见 annualizedReturnFromEquityCurve，两者概念不同，禁止混用。
 */
export function sharpeRatio(dailyReturns: number[], annualizationFactor = 252): number | null {
  const valid = finite(dailyReturns);
  if (valid.length < 2) return null;
  const meanValue = mean(valid)!;
  const std = sampleStandardDeviation(valid);
  if (std === null || std === 0) return null;
  return (meanValue / std) * Math.sqrt(annualizationFactor);
}

// ---------------------------------------------------------------------------
// Newey-West HAC 与 p-value
// ---------------------------------------------------------------------------

/**
 * Newey-West HAC 稳健 t 统计量：考虑序列自相关，不假设每日 IC 独立。
 * Bartlett 核权重 w_l = 1 - l/(L+1)；默认滞后 L = floor(4·(n/100)^(2/9))。
 *
 * 返回均值的 HAC 标准误与 t 统计量；样本 < 3 或标准误为 0 时返回 null。
 */
export function neweyWestMeanTStat(series: number[], lag?: number): { tStat: number; se: number } | null {
  const valid = finite(series);
  const n = valid.length;
  if (n < 3) return null;

  // 滞后阶数：默认沿用既有公式；显式传入时必须是 [0, n-2] 的整数，
  // 非法 lag（负数 / 非整数 / 超过上限）直接返回 null，绝不静默截断。
  let L: number;
  if (lag === undefined) {
    const maxLag = Math.max(1, Math.floor(4 * (n / 100) ** (2 / 9)));
    L = Math.min(n - 2, maxLag);
  } else if (Number.isInteger(lag) && lag >= 0 && lag <= n - 2) {
    L = lag;
  } else {
    return null;
  }

  const meanValue = valid.reduce((sum, value) => sum + value, 0) / n;
  const errors = valid.map((value) => value - meanValue);
  const gamma = (l: number): number => {
    let sum = 0;
    for (let t = l; t < n; t += 1) sum += errors[t]! * errors[t - l]!;
    return sum / n;
  };
  let varianceValue = gamma(0);
  for (let l = 1; l <= L; l += 1) {
    varianceValue += 2 * (1 - l / (L + 1)) * gamma(l);
  }
  const se = Math.sqrt(Math.max(0, varianceValue / n));
  if (se <= 0) return null;
  return { tStat: meanValue / se, se };
}

// ---------------------------------------------------------------------------
// 正态分布基础
// ---------------------------------------------------------------------------

/** 误差函数 erf(x)，Abramowitz-Stegun 7.1.26 近似。 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);
  return sign * y;
}

/** 标准正态累积分布函数 Φ(x)：NaN → null，±Infinity → 1/0，其余按 erf 计算。 */
export function normalCdf(x: number): number | null {
  if (Number.isNaN(x)) return null;
  if (x === Number.POSITIVE_INFINITY) return 1;
  if (x === Number.NEGATIVE_INFINITY) return 0;
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** 标准正态逆累积分布函数 Φ⁻¹(p)，Acklam 算法：NaN → null，p=0 → -Infinity，p=1 → +Infinity。 */
export function normalQuantile(p: number): number | null {
  if (Number.isNaN(p)) return null;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

/** 双尾 p 值（正态近似）：2 · (1 − Φ(|z|))；NaN → null，±Infinity → 0。 */
export function normalTwoSidedPValue(z: number): number | null {
  if (Number.isNaN(z)) return null;
  if (z === Number.POSITIVE_INFINITY || z === Number.NEGATIVE_INFINITY) return 0;
  const cdf = normalCdf(Math.abs(z));
  return cdf === null ? null : 2 * (1 - cdf);
}
