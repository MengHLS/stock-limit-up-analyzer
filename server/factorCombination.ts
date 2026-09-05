import type { LeaderCandidateBacktestRow } from "./leaderCandidates";
import { mean, pearsonCorrelation, spearmanCorrelation, spearman } from "../shared/quant-stats";
import type { EvaluableFactorKey, TechnicalFactorKey } from "./technicalFactors";

// 保持既有调用方（测试等）兼容：Pearson/Spearman 已统一迁移到 shared/quant-stats。
export { pearsonCorrelation, spearmanCorrelation } from "../shared/quant-stats";

/**
 * 因子组合与筛选流程（二-P0）：相关性去重、标准化、市值/题材中性化。
 * 纯统计工具，输入为历史回测行（含 technicalFactors 与原始候选字段），
 * 输出因子间相关性矩阵、去重建议，以及标准化/中性化后的因子值。
 */

export type CombinationFactorKey = EvaluableFactorKey;

export type CombinationFactorDefinition = {
  key: CombinationFactorKey;
  label: string;
  source: "technical" | "candidate";
  /** 因子所属语义簇（Liquidity/Volume/Volatility/Momentum/Sentiment/Size/Composite），用于识别簇内信息重复。 */
  cluster: "Liquidity" | "Volume" | "Volatility" | "Momentum" | "Sentiment" | "Size" | "Composite";
};

export const COMBINATION_FACTOR_DEFINITIONS: CombinationFactorDefinition[] = [
  { key: "turnoverRate", label: "换手率", source: "technical", cluster: "Liquidity" },
  { key: "volumeRatio", label: "量比", source: "technical", cluster: "Volume" },
  { key: "amplitude", label: "振幅", source: "technical", cluster: "Volatility" },
  { key: "boards", label: "连板高度", source: "candidate", cluster: "Sentiment" },
  { key: "sectorCount", label: "题材支撑", source: "candidate", cluster: "Sentiment" },
  { key: "marketCapScore", label: "流通市值评分", source: "candidate", cluster: "Size" },
  { key: "score", label: "原始候选分", source: "candidate", cluster: "Composite" },
];

function readFactorValue(row: LeaderCandidateBacktestRow, key: CombinationFactorKey): number | null {
  switch (key) {
    case "turnoverRate":
    case "volumeRatio":
    case "amplitude":
      return row.technicalFactors?.[key] ?? null;
    case "boards":
      return row.boards;
    case "sectorCount":
      return row.sectorCount ?? null;
    case "marketCapScore":
      return row.marketCapScore;
    case "score":
      return row.score;
    default:
      return null;
  }
}

export type FactorValueMatrix = {
  keys: CombinationFactorKey[];
  values: Record<CombinationFactorKey, Array<number | null>>;
};

/** 从历史回测行提取候选/技术因子值矩阵（每列一个因子，缺失为 null）。 */
export function extractFactorValueMatrix(rows: LeaderCandidateBacktestRow[]): FactorValueMatrix {
  const keys = COMBINATION_FACTOR_DEFINITIONS.map((definition) => definition.key);
  const values = {} as Record<CombinationFactorKey, Array<number | null>>;
  for (const key of keys) {
    values[key] = rows.map((row) => readFactorValue(row, key));
  }
  return { keys, values };
}

export type FactorCorrelationMatrix = {
  keys: CombinationFactorKey[];
  labels: Record<CombinationFactorKey, string>;
  matrix: Array<Array<number | null>>;
};

/** 计算因子间 Pearson 相关矩阵（对称，对角为 1）。 */
export function buildFactorCorrelationMatrix(matrix: FactorValueMatrix): FactorCorrelationMatrix {
  const labels = Object.fromEntries(COMBINATION_FACTOR_DEFINITIONS.map((definition) => [definition.key, definition.label])) as Record<CombinationFactorKey, string>;
  const correlationMatrix = matrix.keys.map((rowKey) => matrix.keys.map((colKey) => (
    rowKey === colKey ? 1 : pearsonCorrelation(matrix.values[rowKey], matrix.values[colKey])
  )));
  return { keys: matrix.keys, labels, matrix: correlationMatrix };
}

/** 计算因子间 Spearman 秩相关矩阵（对非线性/异常值更稳健）。 */
export function buildSpearmanCorrelationMatrix(matrix: FactorValueMatrix): FactorCorrelationMatrix {
  const labels = Object.fromEntries(COMBINATION_FACTOR_DEFINITIONS.map((definition) => [definition.key, definition.label])) as Record<CombinationFactorKey, string>;
  const correlationMatrix = matrix.keys.map((rowKey) => matrix.keys.map((colKey) => (
    rowKey === colKey ? 1 : spearmanCorrelation(matrix.values[rowKey], matrix.values[colKey])
  )));
  return { keys: matrix.keys, labels, matrix: correlationMatrix };
}

/**
 * 由相关矩阵计算 VIF（方差膨胀因子）：VIF_j = [R⁻¹]_jj。
 * 缺失的相关系数视为 0（无相关）；矩阵不可逆时返回全 null。
 */
export function buildVif(correlation: FactorCorrelationMatrix): Record<CombinationFactorKey, number | null> {
  const n = correlation.keys.length;
  const complete = correlation.keys.map((_, i) => correlation.keys.map((__, j) => {
    if (i === j) return 1;
    const value = correlation.matrix[i]![j];
    return value === null ? 0 : value;
  }));
  const inverse = invertMatrix(complete);
  const vif = {} as Record<CombinationFactorKey, number | null>;
  correlation.keys.forEach((key, i) => {
    vif[key] = inverse === null ? null : Number(inverse[i]![i]!.toFixed(3));
  });
  return vif;
}

/** Gauss-Jordan 求逆（含部分主元）；奇异矩阵返回 null。 */
function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row]![col]!) > Math.abs(augmented[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![col]!) < 1e-12) return null;
    [augmented[col], augmented[pivot]] = [augmented[pivot]!, augmented[col]!];
    const pivotValue = augmented[col]![col]!;
    for (let j = 0; j < 2 * n; j += 1) augmented[col]![j]! /= pivotValue;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row]![col]!;
      for (let j = 0; j < 2 * n; j += 1) augmented[row]![j]! -= factor * augmented[col]![j]!;
    }
  }
  return augmented.map((row) => row.slice(n));
}

/**
 * 有效因子数量（participation ratio）：EN = (Σλ)² / Σλ² = n² / ‖R‖_F²。
 * 完全不相关时 EN = n；完全相关时 EN → 1。
 */
export function effectiveNumberOfFactors(correlation: FactorCorrelationMatrix): number | null {
  const n = correlation.keys.length;
  let frobeniusSquared = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const value = i === j ? 1 : (correlation.matrix[i]![j] ?? 0);
      frobeniusSquared += value * value;
    }
  }
  if (frobeniusSquared === 0) return null;
  return Number((n * n / frobeniusSquared).toFixed(3));
}

export type FactorCluster = {
  cluster: string;
  keys: CombinationFactorKey[];
  /** 簇内两两 |ρ| 最大值，衡量簇内信息重复程度。 */
  maxAbsCorrelation: number | null;
  redundant: boolean;
};

/** 按语义簇分组，并度量簇内信息重复（|ρ|≥0.7 判为冗余）。 */
export function buildFactorClusters(correlation: FactorCorrelationMatrix): FactorCluster[] {
  const clusterMap = new Map<string, CombinationFactorKey[]>();
  for (const definition of COMBINATION_FACTOR_DEFINITIONS) {
    if (!correlation.keys.includes(definition.key)) continue;
    const list = clusterMap.get(definition.cluster) ?? [];
    list.push(definition.key);
    clusterMap.set(definition.cluster, list);
  }
  const clusters: FactorCluster[] = [];
  for (const [cluster, keys] of Array.from(clusterMap.entries())) {
    let maxAbs = 0;
    let hasPair = false;
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const value = correlation.matrix[correlation.keys.indexOf(keys[i]!)]![correlation.keys.indexOf(keys[j]!)]!;
        if (value !== null) {
          hasPair = true;
          maxAbs = Math.max(maxAbs, Math.abs(value));
        }
      }
    }
    clusters.push({
      cluster,
      keys,
      maxAbsCorrelation: hasPair ? Number(maxAbs.toFixed(3)) : null,
      redundant: hasPair && maxAbs >= 0.7,
    });
  }
  return clusters.sort((a, b) => a.cluster.localeCompare(b.cluster));
}

export type FactorNeutralizationIC = {
  factorKey: TechnicalFactorKey;
  label: string;
  /** 原始因子对 T+1 收盘溢价的日均 RankIC。 */
  rawMeanIc: number | null;
  /** 市值中性化后因子对 T+1 收盘溢价的日均 RankIC。 */
  neutralizedMeanIc: number | null;
  /** 中性化后 |IC| 相对原始 |IC| 的下降比例（0~1）；负值代表中性化后预测力不降反升。 */
  icReduction: number | null;
};

/** 由配对计算逐日截面 Spearman IC 后取均值。 */
function meanRankIc(factorValues: Array<number | null>, forwardReturns: Array<number | null>, dates: string[]): number | null {
  const byDate = new Map<string, Array<{ factor: number; forward: number }>>();
  for (let i = 0; i < factorValues.length; i += 1) {
    const factor = factorValues[i];
    const forward = forwardReturns[i];
    if (factor === null || forward === null || !Number.isFinite(factor) || !Number.isFinite(forward)) continue;
    const date = dates[i] ?? "";
    const bucket = byDate.get(date) ?? [];
    bucket.push({ factor, forward });
    byDate.set(date, bucket);
  }
  const dailyIcs: number[] = [];
  for (const bucket of Array.from(byDate.values())) {
    if (bucket.length < 3) continue;
    const ic = spearman(bucket.map((item) => item.factor), bucket.map((item) => item.forward));
    if (ic !== null) dailyIcs.push(ic);
  }
  if (dailyIcs.length === 0) return null;
  return dailyIcs.reduce((sum, value) => sum + value, 0) / dailyIcs.length;
}

/**
 * 中性化诊断：对比原始因子与市值中性化后因子的预测 IC，判断因子是自身有效还是市值代理。
 * 注：中性化基于全样本统计量（in-sample 诊断），仅用于解释因子来源，不用于样本外选股。
 */
export function buildNeutralizationIcReport(
  rows: LeaderCandidateBacktestRow[],
  neutralizedTechnicalFactors: Record<TechnicalFactorKey, Array<number | null>>,
): FactorNeutralizationIC[] {
  const labels = Object.fromEntries(COMBINATION_FACTOR_DEFINITIONS.map((definition) => [definition.key, definition.label])) as Record<CombinationFactorKey, string>;
  const dates = rows.map((row) => row.date);
  const forwardReturns = rows.map((row) => row.nextClosePremium ?? null);
  const results: FactorNeutralizationIC[] = [];
  for (const key of TECHNICAL_KEYS) {
    const raw = rows.map((row) => row.technicalFactors?.[key] ?? null);
    const neutralized = neutralizedTechnicalFactors[key] ?? raw.map(() => null);
    const rawMeanIc = meanRankIc(raw, forwardReturns, dates);
    const neutralizedMeanIc = meanRankIc(neutralized, forwardReturns, dates);
    const icReduction = rawMeanIc !== null && neutralizedMeanIc !== null && rawMeanIc !== 0
      ? (Math.abs(rawMeanIc) - Math.abs(neutralizedMeanIc)) / Math.abs(rawMeanIc)
      : null;
    results.push({
      factorKey: key,
      label: labels[key],
      rawMeanIc: rawMeanIc === null ? null : Number(rawMeanIc.toFixed(4)),
      neutralizedMeanIc: neutralizedMeanIc === null ? null : Number(neutralizedMeanIc.toFixed(4)),
      icReduction: icReduction === null ? null : Number(icReduction.toFixed(4)),
    });
  }
  return results;
}

export type CorrelationPair = {
  left: CombinationFactorKey;
  right: CombinationFactorKey;
  correlation: number;
};

/** 列出 |ρ| 超过阈值的因子对（按 |ρ| 降序），用于识别冗余。 */
export function findHighlyCorrelatedPairs(correlation: FactorCorrelationMatrix, threshold = 0.7): CorrelationPair[] {
  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < correlation.keys.length; i += 1) {
    for (let j = i + 1; j < correlation.keys.length; j += 1) {
      const value = correlation.matrix[i]![j];
      if (value !== null && Math.abs(value) >= threshold) {
        pairs.push({ left: correlation.keys[i]!, right: correlation.keys[j]!, correlation: value });
      }
    }
  }
  return pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

/**
 * 贪心去重：按优先级顺序保留因子，丢弃与已保留因子 |ρ|>=threshold 的冗余因子。
 * 返回应保留的因子 key 列表。
 */
export function deduplicateFactors(
  correlation: FactorCorrelationMatrix,
  threshold = 0.7,
  priority: CombinationFactorKey[],
): CombinationFactorKey[] {
  const kept: CombinationFactorKey[] = [];
  const ordered = [...priority, ...correlation.keys.filter((key) => !priority.includes(key))];
  for (const key of ordered) {
    if (!correlation.keys.includes(key)) continue;
    const redundant = kept.some((keptKey) => {
      const leftIndex = correlation.keys.indexOf(key);
      const rightIndex = correlation.keys.indexOf(keptKey);
      const value = correlation.matrix[leftIndex]![rightIndex];
      return value !== null && Math.abs(value) >= threshold;
    });
    if (!redundant) kept.push(key);
  }
  return kept;
}

/** z-score 标准化（缺失保持 null）；变差为 0 时返回 null 占位。 */
export function zScore(values: Array<number | null>): Array<number | null> {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const meanValue = mean(present);
  if (meanValue === null || present.length < 2) return values.map(() => null);
  const variance = present.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (present.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return values.map(() => null);
  return values.map((value) => (value === null || !Number.isFinite(value) ? null : (value - meanValue) / std));
}

/** 分位归一化（0~1，缺失保持 null）。 */
export function quantileRank(values: Array<number | null>): Array<number | null> {
  const presentIndexes = values
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: number; index: number } => item.value !== null && Number.isFinite(item.value));
  if (presentIndexes.length === 0) return values.map(() => null);
  const sorted = [...presentIndexes].sort((a, b) => a.value - b.value);
  const ranks = new Map<number, number>();
  sorted.forEach((item, rankIndex) => ranks.set(item.index, rankIndex / (sorted.length - 1)));
  return values.map((value, index) => (value === null || !Number.isFinite(value) ? null : ranks.get(index)!));
}

/**
 * 线性中性化：对暴露向量（如市值、题材哑变量）做最小二乘回归，返回残差。
 * 实现简单 OLS（单暴露），缺失样本被跳过。
 */
export function residualize(values: Array<number | null>, exposure: Array<number | null>): Array<number | null> {
  const pairs: Array<{ value: number; exposure: number; index: number }> = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const exp = exposure[i];
    if (value === null || exp === null || !Number.isFinite(value) || !Number.isFinite(exp)) continue;
    pairs.push({ value, exposure: exp, index: i });
  }
  if (pairs.length < 2) return values.map(() => null);
  const xs = pairs.map((pair) => pair.exposure);
  const ys = pairs.map((pair) => pair.value);
  const meanX = mean(xs)!;
  const meanY = mean(ys)!;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i += 1) {
    numerator += (xs[i]! - meanX) * (ys[i]! - meanY);
    denominator += (xs[i]! - meanX) ** 2;
  }
  if (denominator === 0) return values.map(() => null);
  const beta = numerator / denominator;
  const alpha = meanY - beta * meanX;
  const residuals = values.map(() => null as number | null);
  for (const pair of pairs) {
    residuals[pair.index] = pair.value - (alpha + beta * pair.exposure);
  }
  return residuals;
}

export type FactorNeutralizationReport = {
  keys: CombinationFactorKey[];
  labels: Record<CombinationFactorKey, string>;
  correlationMatrix: FactorCorrelationMatrix;
  /** Spearman 秩相关矩阵（对非线性/异常值更稳健）。 */
  spearmanMatrix: FactorCorrelationMatrix;
  /** 方差膨胀因子（VIF_j = [R⁻¹]_jj），>5 提示多重共线性。 */
  vif: Record<CombinationFactorKey, number | null>;
  /** 有效因子数量（participation ratio），越接近因子总数说明信息越独立。 */
  effectiveNumber: number | null;
  /** 语义簇分组及簇内信息重复程度。 */
  clusters: FactorCluster[];
  /** 原始因子 vs 市值中性化因子的预测 IC 对比。 */
  neutralizationIc: FactorNeutralizationIC[];
  highlyCorrelatedPairs: CorrelationPair[];
  deduplicatedKeys: CombinationFactorKey[];
  removedKeys: CombinationFactorKey[];
  /** 对流通市值评分做中性化后的技术因子（z-score），供组合评分使用。 */
  neutralizedTechnicalFactors: Record<TechnicalFactorKey, Array<number | null>>;
};

const TECHNICAL_KEYS: TechnicalFactorKey[] = ["turnoverRate", "volumeRatio", "amplitude"];

/**
 * 组合分析入口：提取因子矩阵 → 相关性矩阵 → 高相关因子对 → 贪心去重 →
 * 技术因子标准化 + 对流通市值中性化。
 */
export function buildFactorNeutralizationReport(rows: LeaderCandidateBacktestRow[]): FactorNeutralizationReport {
  const matrix = extractFactorValueMatrix(rows);
  const correlationMatrix = buildFactorCorrelationMatrix(matrix);
  const spearmanMatrix = buildSpearmanCorrelationMatrix(matrix);
  const vif = buildVif(correlationMatrix);
  const effectiveNumber = effectiveNumberOfFactors(correlationMatrix);
  const clusters = buildFactorClusters(correlationMatrix);
  const highlyCorrelatedPairs = findHighlyCorrelatedPairs(correlationMatrix, 0.7);
  const priority: CombinationFactorKey[] = ["turnoverRate", "volumeRatio", "amplitude", "boards", "sectorCount", "marketCapScore", "score"];
  const deduplicatedKeys = deduplicateFactors(correlationMatrix, 0.7, priority);
  const removedKeys = correlationMatrix.keys.filter((key) => !deduplicatedKeys.includes(key));

  const marketCapValues = matrix.values.marketCapScore;
  const neutralizedTechnicalFactors = {} as Record<TechnicalFactorKey, Array<number | null>>;
  for (const key of TECHNICAL_KEYS) {
    const standardized = zScore(matrix.values[key]);
    neutralizedTechnicalFactors[key] = residualize(standardized, marketCapValues);
  }
  const neutralizationIc = buildNeutralizationIcReport(rows, neutralizedTechnicalFactors);

  return {
    keys: correlationMatrix.keys,
    labels: correlationMatrix.labels,
    correlationMatrix,
    spearmanMatrix,
    vif,
    effectiveNumber,
    clusters,
    neutralizationIc,
    highlyCorrelatedPairs,
    deduplicatedKeys,
    removedKeys,
    neutralizedTechnicalFactors,
  };
}
