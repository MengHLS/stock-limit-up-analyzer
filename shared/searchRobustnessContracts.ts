/**
 * ROBUSTNESS-001 — Search-Result Robustness Analysis 线级契约（wire + 详情形态）。
 *
 * 与 `shared/parameterSearchContracts.ts` 的关系：
 *   - **复用**其中的 `parameterSearchValueSchema`（参数值同域）、
 *     `parameterSearchSpaceDefinitionSchema`（冻结快照同域）、
 *     `parameterSearchRunStatusSchema`（状态机同词表）—— 不为这三样各造一份；
 *   - 本文件只新增**稳健性分析独有**的形态（稳定性 / 敏感性 / 邻域 / 矩阵 / 汇总 / 入参）。
 *
 * 纪律：
 *   - zod schema 与 TS 类型同文件（`z.infer` 派生，不手抄两份形状）；
 *   - 新增字段一律**可选**（历史行读取不得炸）；
 *   - **严禁**出现「最佳 / 最优 / 推荐 / winner / best / optimal」这类结论性词汇
 *     （规格 §4 / §17）；该禁令由 `tests/server/research/searchRobustness/wording.test.ts`
 *     以源码扫描方式钉住 —— 「不产出推荐」不是文档承诺，而是可执行事实。
 */

import { z } from "zod";
import {
  parameterSearchRunStatusSchema,
  parameterSearchSpaceDefinitionSchema,
  parameterSearchValueSchema,
} from "./parameterSearchContracts";

// ---------------------------------------------------------------------------
// 记录身份
// ---------------------------------------------------------------------------

/** Run 视图记录标签（wire 上用于判别）。 */
export const SEARCH_ROBUSTNESS_RUN_RECORD_KIND = "SEARCH_ROBUSTNESS_RUN" as const;
/** Run 视图 schema 版本。 */
export const SEARCH_ROBUSTNESS_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 指标 / 邻域 / 离散度 / 敏感性
// ---------------------------------------------------------------------------

/** 指标读数（**源 `parameter_search_result` 的冻结副本**；缺失一律 null，不补 0）。 */
export const robustnessMetricsSnapshotSchema = z.object({
  totalReturnPct: z.number().nullable(),
  annualizedReturnPct: z.number().nullable(),
  maxDrawdownPct: z.number().nullable(),
  tradeCount: z.number().int().nullable(),
  winRatePct: z.number().nullable(),
  profitFactor: z.number().nullable(),
});

/** 邻居可用性判据（前端按此决定「这一格是缺失、还是没交易、还是指标不全」）。 */
export const ROBUSTNESS_NEIGHBOR_AVAILABILITIES = [
  "MISSING_COMBINATION",
  "NO_METRICS",
  "INSUFFICIENT_TRADING_ACTIVITY",
  "METRICS_INCOMPLETE",
  "VALID",
] as const;
export const robustnessNeighborAvailabilitySchema = z.enum(ROBUSTNESS_NEIGHBOR_AVAILABILITIES);

/** 单条邻居。 */
export const robustnessNeighborSchema = z.object({
  axis: z.string().min(1),
  stepOffset: z.number().int(),
  parameters: z.record(z.string(), parameterSearchValueSchema),
  parameterHash: z.string().nullable(),
  availability: robustnessNeighborAvailabilitySchema,
  metrics: robustnessMetricsSnapshotSchema.nullable(),
  deltaTotalReturnPct: z.number().nullable(),
  deltaMaxDrawdownPct: z.number().nullable(),
  withinTolerance: z.boolean().nullable(),
  unavailableReason: z.string().nullable(),
});

/** 离散度（`count = 0` 时统计字段全为 null）。 */
export const ROBUSTNESS_DISPERSION_METRICS = [
  "totalReturnPct",
  "annualizedReturnPct",
  "maxDrawdownPct",
  "tradeCount",
  "winRatePct",
  "profitFactor",
] as const;
export const robustnessDispersionSchema = z.object({
  metric: z.enum(ROBUSTNESS_DISPERSION_METRICS),
  count: z.number().int().nonnegative(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  stdDev: z.number().nullable(),
  range: z.number().nullable(),
});

/** 敏感性条目（枚举参数 `relativeChange` 恒 null —— 不制造连续意义）。 */
export const robustnessSensitivityEntrySchema = z.object({
  axis: z.string().min(1),
  stepOffset: z.number().int(),
  parameterHash: z.string().nullable(),
  absoluteChangePct: z.number().nullable(),
  relativeChange: z.number().nullable(),
  withinTolerance: z.boolean().nullable(),
});

/** 单参数敏感性汇总。 */
export const robustnessParameterSensitivitySchema = z.object({
  parameter: z.string().min(1),
  domainMode: z.string().min(1),
  numeric: z.boolean(),
  entries: z.array(robustnessSensitivityEntrySchema),
  measuredCount: z.number().int().nonnegative(),
  meanAbsoluteChangePct: z.number().nullable(),
  maxAbsoluteChangePct: z.number().nullable(),
  meanRelativeChange: z.number().nullable(),
  maxRelativeChange: z.number().nullable(),
});

// ---------------------------------------------------------------------------
// 单组合结果
// ---------------------------------------------------------------------------

/** 单组合稳定性状态。 */
export const ROBUSTNESS_COMBINATION_STATUSES = [
  "STABLE",
  "UNSTABLE",
  "INSUFFICIENT_TRADING_ACTIVITY",
  "INSUFFICIENT_NEIGHBORHOOD",
  "SOURCE_RESULT_UNAVAILABLE",
] as const;
export const robustnessCombinationStatusSchema = z.enum(ROBUSTNESS_COMBINATION_STATUSES);

/** 单组合稳健性结果视图。 */
export const searchRobustnessResultViewSchema = z.object({
  robustnessRunId: z.string().min(1),
  sourceSearchRunId: z.string().min(1),
  parameterHash: z.string().min(1),
  combinationIndex: z.number().int().nonnegative(),
  parameters: z.record(z.string(), parameterSearchValueSchema),
  metrics: robustnessMetricsSnapshotSchema,
  metricsSource: z.string().min(1),
  status: robustnessCombinationStatusSchema,
  /** `true` 仅当状态为 STABLE；证据不足一律 false。 */
  stable: z.boolean(),
  stabilityRatio: z.number().nullable(),
  stableNeighborCount: z.number().int().nonnegative(),
  validNeighborCount: z.number().int().nonnegative(),
  expectedNeighborCount: z.number().int().nonnegative(),
  presentNeighborCount: z.number().int().nonnegative(),
  /** 邻域不完整（源 Search 缺邻居组合）⇒ 规格 §3.2 的 `NEIGHBORHOOD_INCOMPLETE`。 */
  neighborhoodIncomplete: z.boolean(),
  statusReason: z.string().nullable(),
  neighbors: z.array(robustnessNeighborSchema),
  dispersion: z.array(robustnessDispersionSchema),
  sensitivity: z.array(robustnessParameterSensitivitySchema),
  fingerprint: z.string().min(1),
});

// ---------------------------------------------------------------------------
// 多参数矩阵
// ---------------------------------------------------------------------------

export const robustnessMatrixAxisSchema = z.object({
  parameter: z.string(),
  domainMode: z.string(),
  values: z.array(parameterSearchValueSchema),
});

export const robustnessMatrixCellSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  columnIndex: z.number().int().nonnegative(),
  rowValue: parameterSearchValueSchema,
  columnValue: parameterSearchValueSchema,
  parameterHash: z.string().nullable(),
  present: z.boolean(),
  status: z.union([robustnessCombinationStatusSchema, z.enum(["MISSING", "AMBIGUOUS"])]),
  stable: z.boolean().nullable(),
  stabilityRatio: z.number().nullable(),
  totalReturnPct: z.number().nullable(),
  tradeCount: z.number().int().nullable(),
  matchedCount: z.number().int().nonnegative(),
});

export const robustnessMatrixSchema = z.object({
  rowAxis: robustnessMatrixAxisSchema,
  columnAxis: robustnessMatrixAxisSchema,
  cells: z.array(robustnessMatrixCellSchema),
  parameterCount: z.number().int().nonnegative(),
  omittedParameters: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// 单参数分析
// ---------------------------------------------------------------------------

export const ROBUSTNESS_PARAMETER_VERDICTS = ["sensitive", "insensitive", "insufficient"] as const;
export const robustnessParameterSensitivityVerdictSchema = z.enum(ROBUSTNESS_PARAMETER_VERDICTS);

export const searchRobustnessParameterAnalysisViewSchema = z.object({
  robustnessRunId: z.string().min(1),
  sourceSearchRunId: z.string().min(1),
  parameterName: z.string().min(1),
  domainMode: z.string().min(1),
  domainValueCount: z.number().int().nonnegative(),
  numeric: z.boolean(),
  analyzedValueCount: z.number().int().nonnegative(),
  stableCombinationCount: z.number().int().nonnegative(),
  unstableCombinationCount: z.number().int().nonnegative(),
  sensitivity: robustnessParameterSensitivitySchema,
  valueDispersion: z.array(robustnessDispersionSchema),
  verdict: robustnessParameterSensitivityVerdictSchema,
  fingerprint: z.string().min(1),
});

// ---------------------------------------------------------------------------
// 汇总 / 进度
// ---------------------------------------------------------------------------

export const searchRobustnessSummarySchema = z.object({
  sourceCombinationCount: z.number().int().nonnegative(),
  analyzedCombinationCount: z.number().int().nonnegative(),
  stableCount: z.number().int().nonnegative(),
  unstableCount: z.number().int().nonnegative(),
  insufficientTradingActivityCount: z.number().int().nonnegative(),
  insufficientNeighborhoodCount: z.number().int().nonnegative(),
  sourceResultUnavailableCount: z.number().int().nonnegative(),
  neighborhoodIncompleteCount: z.number().int().nonnegative(),
  /** 参数引用未验证（继承 PARAMETER-002）；前端**必须**据此提示，不得沉默。 */
  parameterReferenceUnverified: z.boolean(),
  parameterReferenceNote: z.string(),
});

export const searchRobustnessProgressSchema = z.object({
  sourceCombinationCount: z.number().int().nonnegative(),
  analyzedCombinationCount: z.number().int().nonnegative(),
  progressPct: z.number(),
});

// ---------------------------------------------------------------------------
// Run 视图
// ---------------------------------------------------------------------------

export const searchRobustnessAnalysisConfigSchema = z.object({
  returnTolerancePct: z.number(),
  drawdownTolerancePct: z.number(),
  neighborDistance: z.number().int(),
  minValidNeighbors: z.number().int(),
});

export const searchRobustnessRunViewSchema = z.object({
  robustnessRunId: z.string().min(1),
  sourceSearchRunId: z.string().min(1),
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  datasetVersionId: z.number().int().nullable(),
  datasetVersionLabel: z.string().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  searchMethod: z.string().min(1),
  /** 源 Run 的冻结参数空间快照（列表页可能为空串占位，详情页才有）。 */
  searchSnapshot: parameterSearchSpaceDefinitionSchema,
  searchSnapshotFingerprint: z.string().min(1),
  fixedCoordinates: z.record(z.string(), parameterSearchValueSchema),
  executionPolicyVersion: z.number().int(),
  evaluationConfigFingerprint: z.string().min(1),
  sourceReferenceCheckApplied: z.boolean().nullable(),
  sourceUnreferencedTunableCodes: z.array(z.string()),
  analysisConfig: searchRobustnessAnalysisConfigSchema,
  status: parameterSearchRunStatusSchema,
  summary: searchRobustnessSummarySchema,
  createdAt: z.string().min(1),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  notes: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// §16 API 入参 / 出参
// ---------------------------------------------------------------------------

/** 创建稳健性分析：选一个 Search Run + 给判定口径。 */
export const createRobustnessRunInputSchema = z.object({
  sourceSearchRunId: z.string().min(1),
  /**
   * 稳定性判定口径（缺省 = 平台缺省）。**持久化到 Run**，不写死前端、不随数据变化。
   */
  analysisConfig: z
    .object({
      returnTolerancePct: z.number().optional(),
      drawdownTolerancePct: z.number().optional(),
      neighborDistance: z.number().int().optional(),
      minValidNeighbors: z.number().int().optional(),
    })
    .optional(),
});
export type CreateRobustnessRunInput = z.infer<typeof createRobustnessRunInputSchema>;

/** Run 身份入参。 */
export const robustnessRunIdInputSchema = z.object({
  robustnessRunId: z.string().min(1),
});

/** 列表入参。 */
export const listRobustnessRunsInputSchema = z.object({
  sourceSearchRunId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type ListRobustnessRunsInput = z.infer<typeof listRobustnessRunsInputSchema>;

/**
 * 结果排序 / 过滤（规格 §11 / §4）。
 *
 * 🔴 只提供**描述性**排序能力（按某指标排），**不**把它包装成「哪个参数最好」。
 */
export const ROBUSTNESS_RESULT_SORT_FIELDS = [
  "combinationIndex",
  "totalReturnPct",
  "annualizedReturnPct",
  "maxDrawdownPct",
  "tradeCount",
  "winRatePct",
  "profitFactor",
  "stabilityRatio",
] as const;
export const robustnessResultSortFieldSchema = z.enum(ROBUSTNESS_RESULT_SORT_FIELDS);
export type RobustnessResultSortField = (typeof ROBUSTNESS_RESULT_SORT_FIELDS)[number];

export const listRobustnessResultsInputSchema = z.object({
  robustnessRunId: z.string().min(1),
  sortBy: robustnessResultSortFieldSchema.optional(),
  sortDirection: z.enum(["ASC", "DESC"]).optional(),
  status: robustnessCombinationStatusSchema.optional(),
  /** `true` = 只看邻域不完整的组合（规格 §3.2 的 `NEIGHBORHOOD_INCOMPLETE`）。 */
  neighborhoodIncompleteOnly: z.boolean().optional(),
  minTradeCount: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type ListRobustnessResultsInput = z.infer<typeof listRobustnessResultsInputSchema>;

/** 结果页（`truncated` 如实标注截断）。 */
export const searchRobustnessResultPageSchema = z.object({
  robustnessRunId: z.string().min(1),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  results: z.array(searchRobustnessResultViewSchema),
});

/** 详情（Run + 进度 + 单参数分析 + 矩阵）。 */
export const searchRobustnessRunDetailSchema = z.object({
  run: searchRobustnessRunViewSchema,
  progress: searchRobustnessProgressSchema,
  parameterAnalyses: z.array(searchRobustnessParameterAnalysisViewSchema),
  matrix: robustnessMatrixSchema,
});

/** 创建回执（含 gate 说明与「参数引用未验证」标记）。 */
export const searchRobustnessCreateResultSchema = z.object({
  run: searchRobustnessRunViewSchema,
  notes: z.array(z.string()),
});

/** 执行回执（如实回报本次算了什么）。 */
export const searchRobustnessExecuteOutcomeSchema = z.object({
  run: searchRobustnessRunViewSchema,
  resultCount: z.number().int().nonnegative(),
  parameterCount: z.number().int().nonnegative(),
  notes: z.array(z.string()),
});

/**
 * 编译期契约 ↔ 领域双向断言锚点（由测试引用，防两处形状漂移）。
 */
export type ContractAssertion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// ---------------------------------------------------------------------------
// TS 类型（全部 `z.infer` 派生，**不手抄两份形状**）
// ---------------------------------------------------------------------------

export type RobustnessMetricsSnapshotView = z.infer<typeof robustnessMetricsSnapshotSchema>;
export type RobustnessNeighborAvailabilityView = z.infer<typeof robustnessNeighborAvailabilitySchema>;
export type RobustnessNeighborView = z.infer<typeof robustnessNeighborSchema>;
export type RobustnessDispersionView = z.infer<typeof robustnessDispersionSchema>;
export type RobustnessSensitivityEntryView = z.infer<typeof robustnessSensitivityEntrySchema>;
export type RobustnessParameterSensitivityView = z.infer<
  typeof robustnessParameterSensitivitySchema
>;
export type RobustnessCombinationStatusView = z.infer<typeof robustnessCombinationStatusSchema>;
export type SearchRobustnessResultView = z.infer<typeof searchRobustnessResultViewSchema>;
export type RobustnessMatrixAxisView = z.infer<typeof robustnessMatrixAxisSchema>;
export type RobustnessMatrixCellView = z.infer<typeof robustnessMatrixCellSchema>;
export type RobustnessMatrixView = z.infer<typeof robustnessMatrixSchema>;
export type RobustnessParameterSensitivityVerdictView = z.infer<
  typeof robustnessParameterSensitivityVerdictSchema
>;
export type SearchRobustnessParameterAnalysisView = z.infer<
  typeof searchRobustnessParameterAnalysisViewSchema
>;
export type SearchRobustnessSummaryView = z.infer<typeof searchRobustnessSummarySchema>;
export type SearchRobustnessProgressView = z.infer<typeof searchRobustnessProgressSchema>;
export type SearchRobustnessAnalysisConfigView = z.infer<
  typeof searchRobustnessAnalysisConfigSchema
>;
export type SearchRobustnessRunView = z.infer<typeof searchRobustnessRunViewSchema>;
export type SearchRobustnessResultPage = z.infer<typeof searchRobustnessResultPageSchema>;
export type SearchRobustnessRunDetail = z.infer<typeof searchRobustnessRunDetailSchema>;
export type SearchRobustnessCreateResult = z.infer<typeof searchRobustnessCreateResultSchema>;
export type SearchRobustnessExecuteOutcome = z.infer<
  typeof searchRobustnessExecuteOutcomeSchema
>;
