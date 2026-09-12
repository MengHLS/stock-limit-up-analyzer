/**
 * RESEARCH-001 — 结果层领域模型（指标码 / 分组维度 / 结果构造与校验）。
 *
 * 边界（指令 §7 / §10 / §22 / §23）：
 *   - `ResearchAnalysis` = 「要执行什么分析」；`ResearchAnalysisMetric` = 指标**定义**；
 *     本文件的 `ResearchResult` = **实际计算结果**；
 *   - `ResearchResult` 是**统计结果层，不是样本层** —— 禁止为每个 Dataset 样本生成一行；
 *   - 查询 / 排序 / 过滤 / 聚合要用的 → 结构化列（`metricCode` / `metricValue` / `sampleCount`）；
 *     开放扩展 / 复杂统计 → JSON（`dimensionJson` / `resultJson`）；
 *   - 本文件**不含任何统计计算实现**（属 Research Engine）。
 */

import type { ResearchResult, ResearchResultType } from "./types";

// ---------------------------------------------------------------------------
// 指标码（结构化主键；新增时在此登记，避免不同文件出现拼写漂移）
// ---------------------------------------------------------------------------

export const RESEARCH_METRIC_CODES = [
  // 收益 / 分布
  "MEAN_RETURN",
  "MEDIAN_RETURN",
  "STD_RETURN",
  "SKEWNESS",
  "KURTOSIS",
  // 胜率 / 盈亏
  "WIN_RATE",
  "PROFIT_FACTOR",
  "AVG_WIN",
  "AVG_LOSS",
  "PAYOFF_RATIO",
  // 风险
  "MAX_DRAWDOWN",
  "VOLATILITY",
  "DOWNSIDE_DEVIATION",
  // 信息系数
  "IC",
  "RANK_IC",
  "ICIR",
  // 统计显著性
  "T_STAT",
  "P_VALUE",
  "CONFIDENCE_INTERVAL_LOW",
  "CONFIDENCE_INTERVAL_HIGH",
  // 覆盖度
  "SAMPLE_COUNT",
  "COVERAGE_RATE",
  // RESEARCH-002 新增：变量无关的通用分布统计（DESCRIPTIVE / 分组内统计复用同一实现）
  "MEAN",
  "MEDIAN",
  "STD",
  "MIN",
  "MAX",
  "MISSING_COUNT",
  "MISSING_RATE",
  "P01",
  "P05",
  "P10",
  "P25",
  "P50",
  "P75",
  "P90",
  "P95",
  "P99",
  // RESEARCH-002 新增：对比 / 稳定性语义
  "SPREAD_TOP_BOTTOM",
  "DIFFERENCE",
  "RELATIVE_DIFFERENCE",
  "MAX_FAVORABLE_EXCURSION",
  "MAX_ADVERSE_EXCURSION",
  "STABILITY_RATIO",
  "T_STAT_DIFFERENCE",
  "P_VALUE_DIFFERENCE",
  "BREAKOUT_RATE",
  "MEAN_DAYS_TO_BREAKOUT",
  // RESEARCH-004 新增：配对两序列的关系度量（SEGMENT_RELATION 用）。
  // 「配对」= 同一样本的两个时段统计量，按事件一一对齐后求关系；与二元指标（左右两组）不同，
  // 因此不在 BINARY_METRIC_COMPUTATIONS 里实现，见 metrics.ts#PAIRED_METRIC_COMPUTATIONS。
  "PAIR_CORRELATION",
  "PAIR_RANK_CORRELATION",
  "PAIR_SAMPLE_COUNT",
] as const;
export type ResearchMetricCode = (typeof RESEARCH_METRIC_CODES)[number];

export function isResearchMetricCode(value: string): value is ResearchMetricCode {
  return (RESEARCH_METRIC_CODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 分组维度
// ---------------------------------------------------------------------------

/**
 * 结果分组维度（落到 `research_result.dimensionJson`）。
 * 例：分位分析 → `{ quantile: 4 }`（第 4 组，1 起）；年度 → `{ year: 2025 }`；环境 → `{ regime: "STRONG" }`。
 */
export type ResearchDimension = Record<string, string | number>;

export class ResearchResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchResultError";
  }
}

// ---------------------------------------------------------------------------
// 构造器（纯函数）
// ---------------------------------------------------------------------------

/** 构造单值结果（如 `MEAN_RETURN = 0.0283`）。`metricValue` 允许 null（指标定义存在但样本不足算不出）。 */
export function scalarResult(input: {
  analysisId: number;
  metricCode: string;
  metricValue: number | null;
  sampleCount?: number | null;
  details?: unknown;
}): Omit<ResearchResult, "id" | "createdAt"> {
  return {
    analysisId: input.analysisId,
    resultType: "SCALAR",
    dimension: null,
    metricCode: input.metricCode,
    metricValue: input.metricValue,
    sampleCount: input.sampleCount ?? null,
    details: input.details ?? null,
  };
}

/**
 * 构造分组结果序列（如 Q1..Q10）。
 * 每个分组产生**一行** `research_result`，`dimension` 记分组维度。
 */
export function groupedResults(input: {
  analysisId: number;
  metricCode: string;
  /** 维度键（写入 dimensionJson 的键名，如 `quantile`）。 */
  dimensionKey: string;
  groups: Array<{ label: string | number; metricValue: number; sampleCount?: number | null }>;
  details?: unknown;
}): Array<Omit<ResearchResult, "id" | "createdAt">> {
  if (typeof input.dimensionKey !== "string" || input.dimensionKey.trim().length === 0) {
    throw new ResearchResultError("dimensionKey 不能为空");
  }
  return input.groups.map((g) => ({
    analysisId: input.analysisId,
    resultType: "GROUPED" as ResearchResultType,
    dimension: { [input.dimensionKey]: g.label },
    metricCode: input.metricCode,
    metricValue: g.metricValue,
    sampleCount: g.sampleCount ?? null,
    details: input.details ?? null,
  }));
}

/** 构造序列结果（如逐日净值 / 逐年 IC）。 */
export function seriesResults(input: {
  analysisId: number;
  metricCode: string;
  points: Array<{ dimension: ResearchDimension; metricValue: number; sampleCount?: number | null }>;
  details?: unknown;
}): Array<Omit<ResearchResult, "id" | "createdAt">> {
  return input.points.map((p) => ({
    analysisId: input.analysisId,
    resultType: "SERIES" as ResearchResultType,
    dimension: p.dimension,
    metricCode: input.metricCode,
    metricValue: p.metricValue,
    sampleCount: p.sampleCount ?? null,
    details: input.details ?? null,
  }));
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/** 校验结果行：结构化数值必须有限（禁 NaN / Infinity），样本数非负。 */
export function assertResearchResult(result: Omit<ResearchResult, "id" | "createdAt">): void {
  if (!Number.isInteger(result.analysisId) || result.analysisId <= 0) {
    throw new ResearchResultError(`非法 analysisId：${String(result.analysisId)}`);
  }
  if (typeof result.metricCode !== "string" || result.metricCode.trim().length === 0) {
    throw new ResearchResultError("metricCode 不能为空");
  }
  if (result.metricValue !== null && result.metricValue !== undefined) {
    if (typeof result.metricValue !== "number" || !Number.isFinite(result.metricValue)) {
      throw new ResearchResultError(`metricValue 必须是有限数值或 null（实得 ${String(result.metricValue)}）`);
    }
  }
  if (result.sampleCount !== null && result.sampleCount !== undefined) {
    if (!Number.isInteger(result.sampleCount) || result.sampleCount < 0) {
      throw new ResearchResultError(`sampleCount 须为非负整数（实得 ${String(result.sampleCount)}）`);
    }
  }
  const isGroupedOrSeries = result.resultType === "GROUPED" || result.resultType === "SERIES";
  if (isGroupedOrSeries && (result.dimension === null || result.dimension === undefined)) {
    throw new ResearchResultError(`${result.resultType} 结果必须提供 dimension`);
  }
  if (result.resultType === "SCALAR" && result.dimension !== null && result.dimension !== undefined) {
    throw new ResearchResultError("SCALAR 结果的 dimension 必须为 null");
  }
  if (isGroupedOrSeries && Object.keys(result.dimension ?? {}).length === 0) {
    throw new ResearchResultError(`${result.resultType} 结果的 dimension 不能为空对象`);
  }
}
