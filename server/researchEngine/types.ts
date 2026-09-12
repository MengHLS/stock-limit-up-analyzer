/**
 * RESEARCH-002 — Research Engine MVP 类型层（Engine / Analysis / Metric 三层的公共契约）。
 *
 * 定位（严格分层，禁止越界）：
 *   ResearchEngine（编排）
 *     → ResearchDatasetReader（**唯一** Dataset 读取层）
 *     → AnalysisExecutor（每类分析一个独立实现，经 Registry 派发）
 *     → MetricCalculator（**唯一**统计实现，复用 shared/quant-stats）
 *     → ResearchResultWriter（researchCore Repository）
 *     → ConclusionBuilder（规则型结论）
 *
 * 边界：
 *   - 本层**不读 DB**（除 datasetReader.ts）、**不写 SQL 到 Analysis**、**不改 Dataset**、**不做回测**；
 *   - `ResearchSample` 是 Engine 内部的**样本视图**，不是持久化实体（不落库，不复制 Dataset）；
 *   - FEATURE 与 OUTCOME 的取值在类型层面分离（见 variables.ts / ResearchSample 注释）。
 */

import type {
  ResearchAnalysis,
  ResearchAnalysisType,
  ResearchConditionSet,
  ResearchConclusionType,
  ResearchResult,
  SegmentStatKind,
} from "../researchCore";

// ---------------------------------------------------------------------------
// 变量角色（PIT 的关键：FEATURE 只允许 T 及之前，OUTCOME 只允许 T 之后）
// ---------------------------------------------------------------------------

/** 变量角色。`FEATURE` = PIT 安全（≤ T）；`OUTCOME` = 未来结果（> T）。 */
export const RESEARCH_VARIABLE_ROLES = ["FEATURE", "OUTCOME"] as const;
export type ResearchVariableRole = (typeof RESEARCH_VARIABLE_ROLES)[number];

/**
 * 单条分析样本（Engine 内部视图，**不落库**）。
 *
 * 关键不变量：`features` 的写入路径在 `variables.ts#resolveFeatureValues` 中**只能**访问
 * event / prefix（≤ T）；`outcomes` 的写入路径**只能**访问 path / outcome（> T）。
 * 二者是两段物理隔离的代码，靠类型 + 结构而不是靠「记得别写错」来保证 PIT。
 */
export interface ResearchSample {
  eventId: string;
  symbol: string;
  /** 事件日（YYYY-MM-DD）。 */
  tradeDate: string;
  /** PIT 安全特征（≤ T）。 */
  features: Record<string, number | null>;
  /** 未来结果（> T）。 */
  outcomes: Record<string, number | null>;
  /** 分组维度（year / month / quarter / board / market / regime…）。 */
  dimensions: Record<string, string | number | null>;
}

// ---------------------------------------------------------------------------
// 分析执行
// ---------------------------------------------------------------------------

/** 变量需求（Analysis 声明自己要读什么，Engine 据此最小化加载）。 */
export interface ResearchVariableRequirement {
  /** 特征变量名（PIT 安全）。 */
  features: readonly string[];
  /** 结果变量名（未来）。 */
  outcomes: readonly string[];
  /** 需要额外解析的分组维度键（year / board / regime…）。 */
  dimensions?: readonly string[];
}

/** 单个分组（分位 / 年度 / 环境 / 条件组）的统计摘要，供结论构造使用。 */
export interface AnalysisGroupSummary {
  /** 分组标签（维度键下的取值，如 `quantile: 10`）。 */
  label: string | number;
  sampleCount: number;
  mean: number | null;
  median: number | null;
  winRate: number | null;
}

/**
 * 分析级摘要（**不落库**；只供 ConclusionBuilder 使用）。
 * 让结论建立在「可复核的中间量」上，而不是去反解 result 行。
 */
export interface AnalysisSummary {
  analysisType: ResearchAnalysisType;
  /** 主效应标签（人读，如 `Q10 − Q1 的未来5日收益均值差`）。 */
  effectLabel: string;
  /** 主效应数值（无量纲化前的原始量）。 */
  effect: number | null;
  /** 该主效应对应的 p 值（正态近似；不可算时为 null，**不编造**）。 */
  pValue: number | null;
  tStat: number | null;
  /** 参与统计的样本总数。 */
  sampleCount: number;
  /** 各分组中的最小样本数（分位 / 年度 / 条件组）。 */
  minGroupSampleCount: number | null;
  /** 参与比较的分组数。 */
  groupCount: number | null;
  /** 跨分组的效应方向一致性比例 [0,1]（单调性 / 稳定性代理）。 */
  directionConsistency: number | null;
  /** 结论构造时必须原样转述的注意事项。 */
  notes: string[];
}

/** 分析执行结果（结果行 + 摘要）。 */
export interface AnalysisExecutionResult {
  /** 待落库的结果行（直接交给 `ResearchResultRepository.createMany`）。 */
  rows: ReadonlyArray<Omit<ResearchResult, "id" | "createdAt">>;
  summary: AnalysisSummary;
  /** 诊断信息（供报告 / 追溯；不落 result_json）。 */
  diagnostics?: Record<string, unknown>;
}

/** 分析执行上下文。 */
export interface AnalysisExecutionContext {
  analysis: ResearchAnalysis;
  /** 已解析默认值并完成校验的分析配置。 */
  config: ResolvedEngineAnalysisConfig;
  datasetVersionId: number;
  /** 已装配好的样本（FEATURE / OUTCOME 已按角色隔离）。 */
  samples: readonly ResearchSample[];
  /** 该 Dataset Version 的可用视界信息（outcome.horizon 真实取值）。 */
  horizons: readonly number[];
  /** 结构化条件集（CONDITIONAL 分析使用；其余分析为空集）。 */
  conditionSet: ResearchConditionSet;
}

/** 变量需求推导上下文（Engine 在装配样本前提供）。 */
export interface AnalysisVariableRequirementContext {
  /** 变量目录（判断字段是特征 / 结果 / 未知）。 */
  catalog: ResearchVariableCatalogLike;
  /** 该分析已落库的结构化条件集（CONDITIONAL 用）。 */
  conditionSet: ResearchConditionSet;
}

/** 变量目录的最小接口（避免 types.ts 反向依赖 variables.ts 的类实现）。 */
export interface ResearchVariableCatalogLike {
  hasFeature(name: string): boolean;
  hasOutcome(name: string): boolean;
  listFeatures(): string[];
  listOutcomes(): string[];
}

/** 分析执行器（策略模式；一类分析一个实现）。 */
export interface AnalysisExecutor {
  readonly analysisType: ResearchAnalysisType;
  /**
   * 声明本分析需要哪些变量（Engine 取并集后最小化加载）。
   * 返回的每个名字都会被变量目录校验；未登记的字段 → `UNKNOWN_VARIABLE`。
   */
  requiredVariables(
    config: ResolvedEngineAnalysisConfig,
    context: AnalysisVariableRequirementContext,
  ): ResearchVariableRequirement;
  /** 执行分析，产出结构化结果行 + 摘要。 */
  execute(context: AnalysisExecutionContext): Promise<AnalysisExecutionResult>;
}

// ---------------------------------------------------------------------------
// 分析配置（Engine 侧解析后的形态）
// ---------------------------------------------------------------------------

/** 引擎侧解析并校验后的分析配置（默认值已补齐，变量名已过角色校验）。 */
export interface ResolvedEngineAnalysisConfig {
  /** 分位组数（QUANTILE）。 */
  quantileGroups: number;
  /** 结果视界（与 Dataset outcome.horizon / path.relativeDay 对齐）。 */
  horizons: number[];
  /** 最小样本门槛（低于该值的结果标记为不可用；不静默丢弃）。 */
  minSampleCount: number;
  /** 目标变量名（结果变量，如 `future_return_5d`）。 */
  targetVariable?: string;
  /** 特征变量名（PIT 安全，如 `turnover`）。 */
  featureVariable?: string;
  /** 参与分析的全部变量名（DESCRIPTIVE）。 */
  variables: string[];
  /** STABILITY 的分组来源维度键。 */
  stabilityDimension: string;
  /** 结果 `dimensionJson` 的分组键名。 */
  dimensionKey?: string;
  /**
   * SEGMENT_RELATION —— 窗 A（分组窗）相对日闭区间 `[a, b]`。
   * 校验后保证：`a ≥ path 最小相对日`、`b ≤ path 最大相对日`、`a < b`、与窗 B 不重叠。
   */
  windowA?: [number, number];
  /** SEGMENT_RELATION —— 窗 B（结果窗）相对日闭区间 `[c, d]`。 */
  windowB?: [number, number];
  /** SEGMENT_RELATION —— 窗 A 的统计口径。 */
  windowAStat?: SegmentStatKind;
  /** SEGMENT_RELATION —— 窗 B 的统计口径。 */
  windowBStat?: SegmentStatKind;
  /** SEGMENT_RELATION —— 窗 A 分档数。 */
  windowBands?: number;
  /** 开放扩展（沿用 researchCore 的 scalar 约束）。 */
  extra: Record<string, string | number | boolean | null>;
}

// ---------------------------------------------------------------------------
// 一次 Run 的结果
// ---------------------------------------------------------------------------

/** 引擎级错误码（机器可读，稳定，落 `research_run.errorCode`）。 */
export const RESEARCH_ENGINE_ERROR_CODES = [
  "EXPERIMENT_NOT_FOUND",
  "RUN_NOT_FOUND",
  "HYPOTHESIS_NOT_FOUND",
  "ANALYSIS_NOT_FOUND",
  "RUN_EXPERIMENT_MISMATCH",
  "RUN_NOT_PENDING",
  "DATASET_VERSION_NOT_FOUND",
  "DATASET_VERSION_NOT_READY",
  "DATASET_VERSION_MISMATCH",
  "NO_ANALYSES",
  "UNKNOWN_ANALYSIS_TYPE",
  "UNKNOWN_VARIABLE",
  "VARIABLE_ROLE_VIOLATION",
  "INVALID_ANALYSIS_CONFIG",
  // ---- 分段（两窗）关系（RESEARCH-004）----
  /**
   * 两窗重叠：窗 A 与窗 B 的取值区间有交集。
   *
   * 为什么必须**拒绝**而不是「标注一下继续跑」：窗 B 的结果里混进了用来分组的那段行情，
   * 于是「前一段回撤大 → 后一段收益差」这个结论会有一部分是**同义反复**（两个量共享同一批
   * K 线），相关系数与组间差都会被机械地拉高/拉低。这不是精度问题，是口径失效。
   * 本项目一律宁可报错，也不产出「看起来正常但含义已变」的数字。
   */
  "WINDOW_OVERLAP",
  "REGIME_PROVIDER_UNAVAILABLE",
  "DATASET_TOO_LARGE",
  "EMPTY_SAMPLE_SET",
  "ANALYSIS_FAILED",
  "DELETE_CONFLICT",
  "BUILDER_NOT_REGISTERED",
  /**
   * 变量解析读取了一个**未被列投影选中**的列。
   *
   * 为什么必须是显式错误而不是静默 null：装配阶段按变量实际读取的列做裁剪（列裁剪实测 3.27×），
   * 若某个变量在特定取值下才去读另一列，那一列不会被裁剪进来 → 读到 `undefined` → 经 `?? null`
   * 变成「特征悄悄变空」。这类错误在结果层几乎不可见（只是某个特征多了一堆 null），
   * 因此必须在装配期当场失败。详见 `researchEngine/columnProjection.ts`。
   */
  "PROJECTION_MISSING_COLUMN",
  // ---- 增量补跑（RESEARCH-002 · 增量执行）----
  /** Run 正在执行（含另一个增量批次），拒绝并发。 */
  "RUN_ALREADY_RUNNING",
  /** 该 Run 没有可用的执行基准快照（从未全量执行过）→ 应走整轮执行。 */
  "RUN_SNAPSHOT_MISSING",
  /** 快照里的 Dataset Version 与 Experiment 当前绑定不一致（正常路径不可能，防御性断言）。 */
  "DATASET_VERSION_DRIFT",
  /** 该 Run 下没有任何「尚无有效结果」的分析可补跑。 */
  "NO_RUNNABLE_ANALYSES",
  /** 指定的分析不属于该 Run。 */
  "ANALYSIS_NOT_IN_RUN",
  /** 指定的分析当前不可补跑（已 COMPLETED 或正在 RUNNING）。 */
  "ANALYSIS_NOT_RUNNABLE",
  // ---- 批量建分析（RESEARCH-002C）----
  /**
   * 批量创建**预检未通过**（逐项校验），整批拒绝、**一个都不建**。
   *
   * 为什么是整批拒绝而不是「能建几个建几个」：预检能发现的问题（名字空、类型未实现、
   * 条件缺失）都是**用户可修**的输入问题，此时建一半只会留下难以解释的半成品；
   * 而真正无法预知的失败（写库报错）留到执行期，那时才如实回显部分成功。
   */
  "BATCH_VALIDATION_FAILED",
  /** 批量创建项数超过上限（`MAX_BATCH_CREATE_ITEMS`）。 */
  "BATCH_TOO_LARGE",
  // ---- 分析模板（RESEARCH-002C）----
  /** 模板不存在。 */
  "TEMPLATE_NOT_FOUND",
  /** 模板名已存在（模板名全局唯一，用于「一键铺开」时的不歧义引用）。 */
  "TEMPLATE_NAME_CONFLICT",
  /** 模板内容不合法（空模板 / 明细项类型未实现 / 名字为空）。 */
  "TEMPLATE_VALIDATION_FAILED",
  "INTERNAL_ERROR",
] as const;
export type ResearchEngineErrorCode = (typeof RESEARCH_ENGINE_ERROR_CODES)[number];

/** 单次 Run 的对外结果。 */
export interface ResearchEngineRunResult {
  experimentId: number;
  runId: number;
  datasetVersionId: number;
  sampleCount: number;
  analysisCount: number;
  resultCount: number;
  conclusionId: number | null;
  conclusionType: ResearchConclusionType | null;
  /** 各分析的执行状态（COMPLETED / FAILED）与真实耗时。 */
  analyses: Array<{
    analysisId: number;
    analysisType: ResearchAnalysisType;
    status: "COMPLETED" | "FAILED";
    resultCount: number;
    /** 该分析自身的执行耗时（毫秒），不含数据集装配。 */
    durationMs: number;
    errorCode?: string;
  }>;
  /** Dataset 装配（分页读事件 + 批量读 path/outcome + 维度解析）耗时（毫秒）。 */
  sampleBuildMs: number;
  /** 真实耗时（毫秒）：装配 + 全部分析 + 结论 + 落库。 */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// 增量补跑（只在已全量执行过的 Run 上补算缺失分析）
// ---------------------------------------------------------------------------

/** 增量补跑入参。 */
export interface ResearchEngineIncrementalInput {
  experimentId: number;
  runId: number;
  /**
   * 要补跑的分析 id。
   * 省略 = 该 Run 下**全部「尚无有效结果」的分析**（status ∈ PENDING / FAILED / CANCELLED）。
   */
  analysisIds?: readonly number[];
}

/** 增量补跑的对外结果。 */
export interface ResearchEngineIncrementalResult {
  experimentId: number;
  runId: number;
  /** 本次批次的序号（写入 `run.executionLog`，1 起递增）。 */
  executionSequence: number;
  /** 本批次实际使用的 Dataset Version（= Run 冻结基准，不取 Experiment 当前值）。 */
  datasetVersionId: number;
  /** 样本基准来源。`run-snapshot` = 复用 Run 冻结的 Dataset Version + 日期窗口。 */
  basisSource: "run-snapshot";
  sampleCount: number;
  analysisCount: number;
  resultCount: number;
  /**
   * **恒为 null**：增量批次不生成结论。
   * 原因见 `conclusionSkippedReason` —— 绝不用「部分分析的摘要」拼一条假装完整的结论。
   */
  conclusionId: null;
  /** 本批次未生成结论的确切原因（机器可读 + 人可读）。 */
  conclusionSkippedReason: string;
  /** 各补跑分析的执行状态与真实耗时。 */
  analyses: ResearchEngineRunResult["analyses"];
  sampleBuildMs: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// 批量建分析（RESEARCH-002C）
// ---------------------------------------------------------------------------

/** 批量创建的单个分析（与单建 `createAnalysis` 的字段逐项一致）。 */
export interface ResearchBatchAnalysisItem {
  analysisType: ResearchAnalysisType;
  name: string;
  target?: string | null;
  config?: unknown;
  /** 条件行（组号必须连续 0..n-1，与单建同口径）。 */
  conditions?: ReadonlyArray<{
    groupNo: number;
    sortOrder: number;
    fieldName: string;
    operator: string;
    value: unknown;
    logicalOperator?: string;
    groupLogicalOperator?: string;
  }>;
}

/**
 * 批量创建的对外结果。
 *
 * `created` 里每一项都保证**完整可用**（若条件写入失败，该分析会被补偿删除并计入 `failed`），
 * 因此「有 id 就能跑」。`failed` 只出现在**执行期**（写库报错）——预检问题会在动手前整批拒绝。
 */
export interface ResearchBatchCreateResult {
  runId: number;
  created: Array<{
    /** 在入参 `items` 中的下标（便于前端把结果映射回预览清单的那一行）。 */
    index: number;
    analysisId: number;
    analysisType: ResearchAnalysisType;
    name: string;
  }>;
  failed: Array<{
    index: number;
    name: string;
    errorCode: string;
    errorMessage: string;
  }>;
  createdCount: number;
  failedCount: number;
}

/** 结论草稿（ConclusionBuilder 产出，由 Engine 落库）。 */
export interface ResearchConclusionDraft {
  conclusionType: ResearchConclusionType;
  title: string;
  conclusion: string;
  evidence: unknown;
  confidence: number | null;
}

// ---------------------------------------------------------------------------
// 数据集版本上下文（Dataset 边界校验用）
// ---------------------------------------------------------------------------

/** Dataset Version 的读取上下文（全部来自真实 DB，不臆造）。 */
export interface ResearchDatasetVersionContext {
  datasetVersionId: number;
  datasetId: number;
  datasetCode: string;
  datasetName: string;
  versionLabel: string;
  /** DRAFT / BUILDING / READY / FAILED。 */
  status: string;
  startDate: string | null;
  endDate: string | null;
  totalEvents: number | null;
  /** outcome.horizon 的真实取值集合（升序）。 */
  horizons: number[];
  /** path.relativeDay 的真实取值范围（无 path 数据为 null）。 */
  pathRelativeDayRange: { min: number; max: number } | null;
}
