/**
 * PARAMETER-001 — Parameter Search 线级契约（wire + 持久化快照）。
 *
 * 本文件是 **Parameter Search 域唯一对外契约面**：tRPC 入参校验、返回值形态、
 * 以及落库快照（`parameter_search_run.parameterSpaceJson` /
 * `parameter_search_combination.parametersJson` / `parameter_search_result.*Json`）共用同一组 schema。
 *
 * 纪律（对齐 `shared/researchContracts.ts` 既有做法）：
 *   - **zod schema 与 TS 类型同文件**（`z.infer` 派生，不手抄两份形状）；
 *   - 新增字段一律 **可选**（历史行读取不得炸 —— CONTRACT-MAP 附录第 5 条）；
 *   - 只描述**传输 / 持久化**形态，不含任何口径计算；
 *   - 指标口径唯一来源 = `server/backtest/backtestResult.ts#canonicalMetrics()`，
 *     本文件只承载其**读数快照**（`metrics` + `metricsSource`，不做任何重算）。
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 记录身份
// ---------------------------------------------------------------------------

/** 参数空间快照记录标签（落库 JSON 的可判别标记）。 */
export const PARAMETER_SEARCH_SPACE_RECORD_KIND = "PARAMETER_SEARCH_SPACE" as const;
/** 参数空间快照 schema 版本：字段语义变更必须递增。 */
export const PARAMETER_SEARCH_SPACE_RECORD_VERSION = 1 as const;

/** 单组合评估产物记录标签。 */
export const PARAMETER_SEARCH_RESULT_RECORD_KIND = "PARAMETER_SEARCH_RESULT" as const;
/** 单组合评估产物 schema 版本。 */
export const PARAMETER_SEARCH_RESULT_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// §7 Search Run 状态机取值（与 §9 Result / 组合执行状态共用一套词表根）
// ---------------------------------------------------------------------------

/** Search Run 状态（规格 §7）。 */
export const PARAMETER_SEARCH_RUN_STATUSES = [
  "CREATED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export const parameterSearchRunStatusSchema = z.enum(PARAMETER_SEARCH_RUN_STATUSES);
export type ParameterSearchRunStatus = (typeof PARAMETER_SEARCH_RUN_STATUSES)[number];

/** 单个参数组合的执行状态（进度 / resume / retry 的判据）。 */
export const PARAMETER_SEARCH_COMBINATION_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
] as const;
export const parameterSearchCombinationStatusSchema = z.enum(PARAMETER_SEARCH_COMBINATION_STATUSES);
export type ParameterSearchCombinationStatus = (typeof PARAMETER_SEARCH_COMBINATION_STATUSES)[number];

/** 搜索方法：本阶段只实现 GRID_SEARCH；其余为**已登记但未实现**的扩展位（不得静默接受）。 */
export const PARAMETER_SEARCH_METHODS = ["GRID_SEARCH", "RANDOM_SEARCH", "BAYESIAN", "TPE"] as const;
export const parameterSearchMethodSchema = z.enum(PARAMETER_SEARCH_METHODS);
export type ParameterSearchMethod = (typeof PARAMETER_SEARCH_METHODS)[number];

/** 本阶段已实现的搜索方法（其余方法入参会被响亮拒绝）。 */
export const IMPLEMENTED_PARAMETER_SEARCH_METHODS = ["GRID_SEARCH"] as const;

// ---------------------------------------------------------------------------
// §3 Parameter Space
// ---------------------------------------------------------------------------

/** 参数分类（规格 §4；与 `strategySchema#StrategyParameterRole` 同词表）。 */
export const PARAMETER_SEARCH_PARAMETER_KINDS = ["FIXED", "TUNABLE", "DERIVED"] as const;
export const parameterSearchParameterKindSchema = z.enum(PARAMETER_SEARCH_PARAMETER_KINDS);
export type ParameterSearchParameterKind = (typeof PARAMETER_SEARCH_PARAMETER_KINDS)[number];

/** 参数值（与 `research/types.ts#ResearchParameterValue` 同域）。 */
export const parameterSearchValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.null(),
]);

/** 搜索域形态（规格 §3：enum / integer range / decimal range / fixed value）。 */
export const PARAMETER_SEARCH_DOMAIN_MODES = [
  "FIXED",
  "ENUM",
  "INTEGER_RANGE",
  "DECIMAL_RANGE",
] as const;
export const parameterSearchDomainModeSchema = z.enum(PARAMETER_SEARCH_DOMAIN_MODES);
export type ParameterSearchDomainMode = (typeof PARAMETER_SEARCH_DOMAIN_MODES)[number];

/** 搜索域判别联合。 */
export const parameterSearchDomainSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("FIXED"), value: parameterSearchValueSchema }),
  z.object({ mode: z.literal("ENUM"), values: z.array(parameterSearchValueSchema).min(1) }),
  z.object({
    mode: z.literal("INTEGER_RANGE"),
    min: z.number(),
    max: z.number(),
    step: z.number(),
  }),
  z.object({
    mode: z.literal("DECIMAL_RANGE"),
    min: z.number(),
    max: z.number(),
    step: z.number(),
  }),
]);
export type ParameterSearchDomain = z.infer<typeof parameterSearchDomainSchema>;

/** 单个参数字段（规格 §3：name / type / kind / defaultValue / required / description）。 */
export const parameterSearchParameterDefinitionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["number", "string", "boolean"]),
  kind: parameterSearchParameterKindSchema,
  defaultValue: parameterSearchValueSchema.optional(),
  required: z.boolean(),
  description: z.string().optional(),
  unit: z.string().optional(),
  /** 搜索域；`kind !== "TUNABLE"` 时必须缺省（FIXED 不进搜索空间、DERIVED 不得直接搜索）。 */
  search: parameterSearchDomainSchema.optional(),
  /** 不参与搜索的如实原因（不静默丢弃）。 */
  exclusionReason: z.string().optional(),
});
export type ParameterSearchParameterDefinition = z.infer<
  typeof parameterSearchParameterDefinitionSchema
>;

/** 参数空间快照（落库 + 派生自策略文档的唯一形态）。 */
export const parameterSearchSpaceDefinitionSchema = z.object({
  recordKind: z.literal(PARAMETER_SEARCH_SPACE_RECORD_KIND),
  recordVersion: z.literal(PARAMETER_SEARCH_SPACE_RECORD_VERSION),
  /** 派生来源策略身份（快照自述，不从未来版本重新解释）。 */
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  parameters: z.array(parameterSearchParameterDefinitionSchema),
  /** 派生说明（未进搜索空间的参数及原因）。 */
  notes: z.array(z.string()).optional(),
});
export type ParameterSearchSpaceDefinition = z.infer<typeof parameterSearchSpaceDefinitionSchema>;

// ---------------------------------------------------------------------------
// §6 Parameter Combination
// ---------------------------------------------------------------------------

/** 参数组合视图（笛卡尔积成员 + 稳定 parameterHash）。 */
export const parameterSearchCombinationViewSchema = z.object({
  searchRunId: z.string().min(1),
  /** 组合序号（生成顺序，从 0 起；仅用于展示与稳定排序，不作身份）。 */
  combinationIndex: z.number().int().nonnegative(),
  /** 稳定参数哈希（身份；见 `parameterHash.ts`）。 */
  parameterHash: z.string().min(1),
  parameters: z.record(z.string(), parameterSearchValueSchema),
  status: parameterSearchCombinationStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  lastError: z.string().nullable().optional(),
});
export type ParameterSearchCombinationView = z.infer<typeof parameterSearchCombinationViewSchema>;

// ---------------------------------------------------------------------------
// §9 / §10 Search Result（指标只**读数**、不重算）
// ---------------------------------------------------------------------------

/**
 * canonical metrics 读数快照（规格 §10 的六个标量）。
 *
 * 🔴 全部取自 `ClosedLoopEvaluationRef#canonicalMetrics`（唯一口径面）；
 *   `canonicalMetrics` 缺省 null 时按既有语义回落 `performance` / `tradeQuality`，
 *   并如实标注 `metricsSource = "evaluators"` —— **绝不用 `NOT_AVAILABLE` 之外的编造值顶替**。
 */
export const parameterSearchMetricsViewSchema = z.object({
  totalReturnPct: z.number().nullable(),
  annualizedReturnPct: z.number().nullable(),
  maxDrawdownPct: z.number().nullable(),
  tradeCount: z.number().nullable(),
  winRatePct: z.number().nullable(),
  profitFactor: z.number().nullable(),
});
export type ParameterSearchMetricsView = z.infer<typeof parameterSearchMetricsViewSchema>;

/** 指标来源（如实标注，不静默降级）。 */
export const parameterSearchMetricsSourceSchema = z.enum(["canonical", "evaluators"]);
export type ParameterSearchMetricsSource = z.infer<typeof parameterSearchMetricsSourceSchema>;

/** 单组合评估产物（可追溯到 Backtest Run / Evaluation）。 */
export const parameterSearchResultViewSchema = z.object({
  recordKind: z.literal(PARAMETER_SEARCH_RESULT_RECORD_KIND),
  recordVersion: z.literal(PARAMETER_SEARCH_RESULT_RECORD_VERSION),
  searchRunId: z.string().min(1),
  combinationIndex: z.number().int().nonnegative(),
  parameterHash: z.string().min(1),
  parameters: z.record(z.string(), parameterSearchValueSchema),
  status: z.enum(["SUCCEEDED", "FAILED"]),
  /** 失败原因（结构化字符串）；成功时为 null。 */
  error: z.string().nullable(),
  /** 可追溯：本次组合对应的回测指纹（`ClosedLoopEvaluationRef#backtestFingerprint`）。 */
  backtestFingerprint: z.string().nullable(),
  /** 可追溯：**落库**回测 run id。本阶段评估端口不落 `closed_loop_backtest_run` 行 ⇒ 恒为 null（如实登记，不伪造）。 */
  backtestRunId: z.string().nullable(),
  /** 可追溯：评估产物身份（`deriveExperimentId` 产出的实验 id）。 */
  evaluationId: z.string().nullable(),
  /** 可追溯：闭环 run id（`<前缀>::<experimentId>`；**内存态**，非落库 run 行）。 */
  evaluationRunId: z.string().nullable(),
  /** 可追溯：完整评估引用投影（canonical metrics 原始面 + 指纹）。 */
  evaluation: z.unknown().nullable(),
  metrics: parameterSearchMetricsViewSchema,
  metricsSource: parameterSearchMetricsSourceSchema,
  /** 年化基数自述（canonical 面带回；缺省 null）。 */
  annualizationBasis: z
    .object({ type: z.literal("TRADING_DAYS"), daysPerYear: z.number().int().positive() })
    .nullable(),
  /** 复现要素快照（cache 判据的组成部分，如实记录）。 */
  evaluationConfigFingerprint: z.string().nullable(),
  createdAt: z.string().min(1),
});
export type ParameterSearchResultView = z.infer<typeof parameterSearchResultViewSchema>;

// ---------------------------------------------------------------------------
// §7 Search Run 视图
// ---------------------------------------------------------------------------

/** Search Run 视图（列表 / 详情共用）。 */
export const parameterSearchRunViewSchema = z.object({
  searchRunId: z.string().min(1),
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  /** 🔴 运行时**唯一权威**数据集坐标（label 仅展示）。 */
  datasetVersionId: z.number().int().nullable(),
  datasetVersionLabel: z.string().nullable(),
  /** 回测窗口（FIXED 参数：搜索过程中不变）。 */
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  searchMethod: parameterSearchMethodSchema,
  status: parameterSearchRunStatusSchema,
  parameterSpace: parameterSearchSpaceDefinitionSchema,
  parameterSpaceFingerprint: z.string().min(1),
  /** FIXED 坐标快照（用于回答「这次搜索固定了什么」）。 */
  fixedCoordinates: z.record(z.string(), parameterSearchValueSchema),
  executionPolicyVersion: z.number().int(),
  evaluationConfigFingerprint: z.string().min(1),
  combinationCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** 运行说明（如 cache 命中数 / resume 跳过数；如实记录，不静默）。 */
  notes: z.array(z.string()).optional(),
  /**
   * PARAMETER-002 — 本次 Run 是否做过「死参数」筛查（`ruleGraph#collectRuleParameterReferences`）。
   * 新增字段一律**可选**：该列加入之前落库的历史行读到的是 `undefined` /
   * `null` ⇒ 下游（ROBUSTNESS-001 §12）必须按**未验证**处理，不得沉默或回读当前策略版本补算。
   */
  referenceCheckApplied: z.boolean().nullable().optional(),
  /** PARAMETER-002 — 被排除的死参数 code（声明为 TUNABLE 但规则图从未引用）。 */
  unreferencedTunableCodes: z.array(z.string()).optional(),
});
export type ParameterSearchRunView = z.infer<typeof parameterSearchRunViewSchema>;

// ---------------------------------------------------------------------------
// §15 API 入参
// ---------------------------------------------------------------------------

/** 创建 Search：策略身份 + 数据集坐标 + 回测窗口 + 参数空间 + 搜索方法。 */
export const createParameterSearchInputSchema = z.object({
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  /** Dataset Registry 权威坐标（`dataset_version.id`）；缺省时回落策略文档绑定。 */
  datasetVersionId: z.number().int().positive().nullish(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  searchMethod: parameterSearchMethodSchema,
  /**
   * 参数空间覆盖（可选）。
   * 不给 ⇒ 由策略文档 `definition.parameters` 派生（只取 `parameterRole = TUNABLE`）。
   * 给了 ⇒ 逐参数覆盖搜索域，但**参数名必须存在于策略 Schema**，且 FIXED / DERIVED 不得搜索。
   */
  parameterSearchSpace: z
    .array(
      z.object({
        name: z.string().min(1),
        domain: parameterSearchDomainSchema,
      }),
    )
    .optional(),
  /** 组合数上限（生成前强制，不截断）。 */
  maxCombinations: z.number().int().positive().optional(),
  /** 数据集来源策略（透传给评估端口；缺省由端口决定）。 */
  datasetSourcePolicy: z.string().min(1).optional(),
});
export type CreateParameterSearchInput = z.infer<typeof createParameterSearchInputSchema>;

/** 启动 / 取消 / 重试 入参。 */
export const parameterSearchRunIdInputSchema = z.object({
  searchRunId: z.string().min(1),
});

/** 重试单个失败组合。 */
export const retryParameterSearchCombinationInputSchema = z.object({
  searchRunId: z.string().min(1),
  parameterHash: z.string().min(1),
});

/** 结果排序 / 过滤（规格 §11：只提供数据与排序能力，不产出「最佳参数」结论）。 */
export const PARAMETER_SEARCH_RESULT_SORT_FIELDS = [
  "combinationIndex",
  "totalReturnPct",
  "annualizedReturnPct",
  "maxDrawdownPct",
  "tradeCount",
  "winRatePct",
  "profitFactor",
] as const;
export const parameterSearchResultSortFieldSchema = z.enum(PARAMETER_SEARCH_RESULT_SORT_FIELDS);
export type ParameterSearchResultSortField = (typeof PARAMETER_SEARCH_RESULT_SORT_FIELDS)[number];

export const listParameterSearchResultsInputSchema = z.object({
  searchRunId: z.string().min(1),
  sortBy: parameterSearchResultSortFieldSchema.optional(),
  sortDirection: z.enum(["ASC", "DESC"]).optional(),
  status: z.enum(["SUCCEEDED", "FAILED"]).optional(),
  minTradeCount: z.number().int().nonnegative().optional(),
  maxDrawdownPct: z.number().optional(),
  minTotalReturnPct: z.number().optional(),
  /** 分页（缺省全量返回，超上限截断并在 `truncated` 如实标注）。 */
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type ListParameterSearchResultsInput = z.infer<
  typeof listParameterSearchResultsInputSchema
>;

/** 结果列表返回（`truncated` 如实标注截断，不静默丢数据）。 */
export const parameterSearchResultPageSchema = z.object({
  searchRunId: z.string().min(1),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  results: z.array(parameterSearchResultViewSchema),
});
export type ParameterSearchResultPage = z.infer<typeof parameterSearchResultPageSchema>;

// ---------------------------------------------------------------------------
// 契约 ↔ 领域类型的双向结构断言锚点（编译期；由测试引用，防止两处形状漂移）
// ---------------------------------------------------------------------------

/** 编译期断言工具：两侧必须互相可赋值，否则本文件编译失败。 */
export type ContractAssertion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// ---------------------------------------------------------------------------
// 视图聚合（详情 / 创建回执 / 执行回执）
// ---------------------------------------------------------------------------

/** 进度（**唯一**算法在 `server/research/parameterSearch/searchRun.ts#computeRunProgress`）。 */
export const parameterSearchProgressSchema = z.object({
  combinationCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  settledCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  progressPct: z.number(),
});
export type ParameterSearchProgressView = z.infer<typeof parameterSearchProgressSchema>;

/** 参数空间分类摘要（如实回报「派生了什么 / 排除了什么」）。 */
export const parameterSearchSpaceSummarySchema = z.object({
  searchable: z.array(z.string()),
  fixed: z.array(z.string()),
  derived: z.array(z.string()),
  excluded: z.array(z.object({ name: z.string(), reason: z.string() })),
});
export type ParameterSearchSpaceSummaryView = z.infer<typeof parameterSearchSpaceSummarySchema>;

/** 创建回执。 */
export const parameterSearchCreateResultSchema = z.object({
  run: parameterSearchRunViewSchema,
  summary: parameterSearchSpaceSummarySchema,
  derivationNotes: z.array(z.string()),
  /**
   * PARAMETER-002 — 是否做了「死参数」（规则图未引用）筛查。
   * `false` = 决策引擎不可构造 / 未提供引用面 ⇒ 本次搜索**可能包含不改变执行结果的参数**。
   */
  referenceCheckApplied: z.boolean().optional(),
  /** PARAMETER-002 — 被排除的死参数 code（声明为 TUNABLE 但规则图从未引用）。 */
  unreferencedTunableCodes: z.array(z.string()).optional(),
});
export type ParameterSearchCreateResultView = z.infer<typeof parameterSearchCreateResultSchema>;

/** 详情（Run + 进度 + 组合计划）。 */
export const parameterSearchRunDetailSchema = z.object({
  run: parameterSearchRunViewSchema,
  progress: parameterSearchProgressSchema,
  combinations: z.array(parameterSearchCombinationViewSchema),
});
export type ParameterSearchRunDetailView = z.infer<typeof parameterSearchRunDetailSchema>;

/** 执行 / 续跑 / 重试回执（如实回报本次干了什么）。 */
export const parameterSearchExecuteOutcomeSchema = z.object({
  run: parameterSearchRunViewSchema,
  evaluatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  reusedFromCacheCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  notes: z.array(z.string()),
});
export type ParameterSearchExecuteOutcomeView = z.infer<typeof parameterSearchExecuteOutcomeSchema>;

/** 列表入参。 */
export const listParameterSearchRunsInputSchema = z.object({
  strategyId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type ListParameterSearchRunsInput = z.infer<typeof listParameterSearchRunsInputSchema>;

/** 执行入参（`codeVersion` 由服务端解析，调用方不传）。 */
export const executeParameterSearchInputSchema = z.object({
  searchRunId: z.string().min(1),
  maxCombinations: z.number().int().positive().optional(),
});
export type ExecuteParameterSearchInput = z.infer<typeof executeParameterSearchInputSchema>;

/** 重试入参（`force` 才会覆盖已成功的组合结果）。 */
export const retryParameterSearchCombinationInputSchemaV2 = z.object({
  searchRunId: z.string().min(1),
  parameterHash: z.string().min(1),
  force: z.boolean().optional(),
});
export type RetryParameterSearchCombinationInputV2 = z.infer<
  typeof retryParameterSearchCombinationInputSchemaV2
>;
