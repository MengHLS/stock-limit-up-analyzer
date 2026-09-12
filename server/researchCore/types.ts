/**
 * RESEARCH-001 — Research 领域类型与枚举（**唯一权威来源**）。
 *
 * 职责边界（本目录 server/researchCore 的定位）：
 *   - 只承载 Research 领域模型 + 持久化（Domain Types / Enum / Repository）；
 *   - **不实现** Research Engine、统计计算、参数搜索、回测、前端；
 *   - **不复制** Dataset 任何数据（无行情表、无 event/prefix/post/path/outcome 副本），
 *     只通过 `datasetVersionId` 引用 `dataset_version.id`；
 *   - **不写** 正式 Strategy 表（`strategies` / `strategy_versions`），只通过
 *     `strategyDefinitionId` 软引用。
 *
 * ⚠️ 与 `server/research/types.ts` 的 `ResearchExperiment` / `ResearchRun` **同名不同物**：
 *    那是 STEP 6.x 遗留链路（字符串 `experimentId` + `strategyId` 驱动 + `snapshotJson` 单一大 JSON）；
 *    本文件是 Dataset-Registry 原生 Research 领域对象。两者**分属不同模块、不共用 barrel**，
 *    详见 docs/research/RESEARCH-001-AUDIT.md §4。
 *
 * 枚举集中管理（指令 §17）：一律 `const 数组 as const` + 派生类型 —— 同时提供**运行时取值**
 * （供校验 / DB 断言）与**编译期类型**，避免同一取值在不同文件出现大小写不一致。
 */

// ---------------------------------------------------------------------------
// 枚举（集中管理，唯一权威）
// ---------------------------------------------------------------------------

/** 研究类型。 */
export const RESEARCH_TYPES = [
  "FEATURE",
  "EVENT_STUDY",
  "CONDITIONAL",
  "PATH",
  "REGIME",
  "FACTOR",
  "HYPOTHESIS",
  "CUSTOM",
] as const;
export type ResearchType = (typeof RESEARCH_TYPES)[number];

/** 实验状态。 */
export const RESEARCH_EXPERIMENT_STATUSES = [
  "DRAFT",
  "READY",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "ARCHIVED",
] as const;
export type ResearchExperimentStatus = (typeof RESEARCH_EXPERIMENT_STATUSES)[number];

/** 假设状态。 */
export const RESEARCH_HYPOTHESIS_STATUSES = [
  "DRAFT",
  "TESTING",
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "REJECTED",
  "INCONCLUSIVE",
] as const;
export type ResearchHypothesisStatus = (typeof RESEARCH_HYPOTHESIS_STATUSES)[number];

/** 运行状态。 */
export const RESEARCH_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];

/** 分析类型。 */
export const RESEARCH_ANALYSIS_TYPES = [
  "DESCRIPTIVE",
  "DISTRIBUTION",
  "QUANTILE",
  "CORRELATION",
  "IC",
  "EVENT_STUDY",
  "CONDITIONAL",
  "PATH",
  "REGIME",
  "SIGNIFICANCE",
  "STABILITY",
  /**
   * RESEARCH-004 —— 分段（两窗）关系分析。
   *
   * 用于回答「同一根价格路径被切成先后两段，前一段的表现与后一段的表现有何关系」，
   * 例如「T+1~T+5 的最大回撤」与「T+5~T+20 的收益」。
   *
   * 为什么必须新增一种类型而不是复用 CONDITIONAL：CONDITIONAL 只能表达「满足 / 不满足」，
   * 拿不到 A 分档 × B 的交叉表，也无法把「窗 A 统计量」当分组键（QUANTILE 的 featureField
   * 会因 PIT 角色校验拒绝 outcome 变量）。两窗之间的**重叠守卫**也无处挂载。
   */
  "SEGMENT_RELATION",
] as const;
export type ResearchAnalysisType = (typeof RESEARCH_ANALYSIS_TYPES)[number];

/** 分析状态（与 Run 状态同集合，独立声明以保留各自演进空间）。 */
export const RESEARCH_ANALYSIS_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ResearchAnalysisStatus = (typeof RESEARCH_ANALYSIS_STATUSES)[number];

/** 结论类型。 */
export const RESEARCH_CONCLUSION_TYPES = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "REJECTED",
  "INCONCLUSIVE",
] as const;
export type ResearchConclusionType = (typeof RESEARCH_CONCLUSION_TYPES)[number];

/** 结论记录状态（草稿 / 定稿 / 被取代）。 */
export const RESEARCH_CONCLUSION_STATUSES = ["DRAFT", "FINAL", "SUPERSEDED"] as const;
export type ResearchConclusionStatus = (typeof RESEARCH_CONCLUSION_STATUSES)[number];

/** 策略候选状态。 */
export const RESEARCH_CANDIDATE_STATUSES = [
  "DRAFT",
  "REVIEW",
  "ACCEPTED",
  "REJECTED",
  "CONVERTED",
  "ARCHIVED",
] as const;
export type ResearchCandidateStatus = (typeof RESEARCH_CANDIDATE_STATUSES)[number];

/** 产物类型。 */
export const RESEARCH_ARTIFACT_TYPES = [
  "REPORT",
  "DATA",
  "CHART",
  "STATISTICS",
  "EXPORT",
  "OTHER",
] as const;
export type ResearchArtifactType = (typeof RESEARCH_ARTIFACT_TYPES)[number];

/** 产物存储形态。 */
export const RESEARCH_ARTIFACT_STORAGE_TYPES = ["FILE", "S3", "URL", "INLINE"] as const;
export type ResearchArtifactStorageType = (typeof RESEARCH_ARTIFACT_STORAGE_TYPES)[number];

/** 结果形态。 */
export const RESEARCH_RESULT_TYPES = ["SCALAR", "GROUPED", "SERIES"] as const;
export type ResearchResultType = (typeof RESEARCH_RESULT_TYPES)[number];

/** 条件比较运算符（条件研究的原子能力）。 */
export const RESEARCH_CONDITION_OPERATORS = [
  ">",
  ">=",
  "<",
  "<=",
  "==",
  "!=",
  "IN",
  "NOT_IN",
  "BETWEEN",
  "IS_NULL",
  "IS_NOT_NULL",
] as const;
export type ResearchConditionOperator = (typeof RESEARCH_CONDITION_OPERATORS)[number];

/**
 * 条件**组内**连接符（本条件相对**前一条**条件的连接方式）。
 *
 * 精确语义（消除歧义）：
 *   - 组内**首条**条件忽略本字段；
 *   - `AND` → `… AND <cond>`；
 *   - `OR`  → `… OR <cond>`；
 *   - `NOT` → `… AND NOT <cond>`（「取反 + AND」，不是「连接符 NOT」）。
 *
 * 因此「OR + 取反」需借条件组表达：组 A = `[x]`，组 B = `[NOT y]`，组间 `OR` ⇒ `(x) OR (AND NOT y)`。
 * 完整 AST（括号嵌套）不在第一版范围（指令 §8 只要求「预留扩展能力」）。
 */
export const RESEARCH_LOGICAL_OPERATORS = ["AND", "OR", "NOT"] as const;
export type ResearchLogicalOperator = (typeof RESEARCH_LOGICAL_OPERATORS)[number];

/** 条件**组间**连接符。 */
export const RESEARCH_GROUP_LOGICAL_OPERATORS = ["AND", "OR"] as const;
export type ResearchGroupLogicalOperator = (typeof RESEARCH_GROUP_LOGICAL_OPERATORS)[number];

// ---------------------------------------------------------------------------
// 领域对象（Repository 出参 / 入参；不直接暴露 Drizzle Row 类型）
// ---------------------------------------------------------------------------

/**
 * 研究实验。**输入边界恒为单一 `datasetVersionId`**。
 * 禁止一个 Experiment 动态混用多个 Dataset Version；需要跨版本比较时应新建明确类型（未来扩展）。
 */
export interface ResearchExperiment {
  id?: number;
  datasetVersionId: number;
  name: string;
  description?: string | null;
  researchType: ResearchType;
  status: ResearchExperimentStatus;
  config?: unknown;
  sampleCount?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** 研究假设（研究意图；**不是** Analysis，也**不是** Conclusion）。 */
export interface ResearchHypothesis {
  id?: number;
  experimentId: number;
  name: string;
  statement: string;
  nullHypothesis?: string | null;
  alternativeHypothesis?: string | null;
  status: ResearchHypothesisStatus;
  /** 速记备注；正式结论落 `ResearchConclusion`。 */
  conclusion?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 执行批次模式。
 * - `FULL`：全量执行（该 Run 的**基准**——Dataset Version / 日期窗口 / 变量并集——由此落定）；
 * - `INCREMENTAL`：增量补跑（只补算尚无结果的分析，**复用**已落定的基准，不重跑已完成的）。
 */
export type ResearchRunExecutionMode = "FULL" | "INCREMENTAL";

/** 单次执行批次的终态。与 Run 的终态彼此独立：一次增量失败不否定此前批次的结果。 */
export type ResearchRunExecutionStatus = "RUNNING" | "COMPLETED" | "FAILED";

/**
 * Run **执行批次日志**条目（`research_run.executionLogJson`，**追加式**）。
 *
 * 为什么需要它：`inputSnapshot` 是「首次执行时落定的基准，**事后不得修改**」，它只能证明
 * 「这条 Run 的基准是什么」，**不能**证明「这条 Run 被跑过几次、每次跑了哪些分析」。
 * 一旦允许增量补跑，缺失这层记录就会让读者把「跑过 3 个分析、分 2 批」误读成「只跑过 1 批」。
 *
 * 纪律：
 *   - **追加式**：只新增条目，不修改 / 不删除既有条目；
 *   - `sequence` 在 Run 内单调递增、不跳号；
 *   - ⚠️ 本字段生效之前已存在的 Run，其 batch 1（全量）只体现在 `inputSnapshot` 中，
 *     日志自 batch 2 起记录 —— 这是如实的版本边界，**不 backfill 伪造历史**。
 */
export interface ResearchRunExecutionLogEntry {
  /** 批次序号（1 起）。 */
  sequence: number;
  mode: ResearchRunExecutionMode;
  /** 本批次**实际执行**的分析 id（升序）。全量批次 = 该 Run 当时的全部分析。 */
  analysisIds: number[];
  /** 本批次实际使用的样本数；失败在装配样本之前时为 null。 */
  sampleCount: number | null;
  status: ResearchRunExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  errorCode?: string;
  errorMessage?: string;
  /**
   * 本批次**未生成结论**的原因（有值即代表「本批次没有结论」这一事实是刻意的，而非遗漏）。
   * 目前仅增量批次会出现（`AnalysisSummary` 未落库，无法重建已跳过分析的历史摘要）。
   */
  conclusionSkippedReason?: string;
}

/**
 * 一次实验执行。**Experiment ≠ Run**。
 * `inputSnapshot` 回答「这次到底用什么配置执行的」，不得只依赖 Experiment 当前 config。
 * `executionLog` 回答「这条 Run 被跑过几次、每批跑了什么」（见 `ResearchRunExecutionLogEntry`）。
 */
export interface ResearchRun {
  id?: number;
  experimentId: number;
  /** 实验内序号，1 起；`(experimentId, runNo)` 唯一。 */
  runNo: number;
  status: ResearchRunStatus;
  config?: unknown;
  inputSnapshot?: unknown;
  /** 追加式执行批次日志（batch 1 = 首次全量执行）。 */
  executionLog?: ResearchRunExecutionLogEntry[] | null;
  sampleCount?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
}

/** 分析定义（描述「要执行什么分析」；结果在 `ResearchResult`）。 */
export interface ResearchAnalysis {
  id?: number;
  runId: number;
  analysisType: ResearchAnalysisType;
  name: string;
  target?: string | null;
  config?: unknown;
  status: ResearchAnalysisStatus;
  createdAt?: string;
  completedAt?: string | null;
}

/**
 * 分析条件（**结构化**表达）。
 * 组内用 `logicalOperator` 连接，组间用 `groupLogicalOperator` 连接。
 */
export interface ResearchAnalysisCondition {
  id?: number;
  analysisId: number;
  groupNo: number;
  /** 组内确定性顺序（复现性要求）。 */
  sortOrder: number;
  fieldName: string;
  operator: ResearchConditionOperator;
  /** 领域形态的值（读写时与 `valueJson` 互转）。 */
  value: unknown;
  logicalOperator: ResearchLogicalOperator;
  groupLogicalOperator: ResearchGroupLogicalOperator;
  createdAt?: string;
}

/** 分析指标**定义**（实际计算结果在 `ResearchResult`）。 */
export interface ResearchAnalysisMetric {
  id?: number;
  analysisId: number;
  metricCode: string;
  metricName: string;
  config?: unknown;
  displayOrder: number;
  createdAt?: string;
}

/**
 * 分析**结果**（统计结果层，**不是样本层**）。
 * `dimension` / `details` 为开放扩展；`metricCode` / `metricValue` / `sampleCount` 为结构化列。
 */
export interface ResearchResult {
  id?: number;
  analysisId: number;
  resultType: ResearchResultType;
  dimension?: Record<string, unknown> | null;
  metricCode: string;
  metricValue?: number | null;
  sampleCount?: number | null;
  details?: unknown;
  createdAt?: string;
}

/**
 * 研究结论。**必须关联 Experiment**（`experimentId` 必填）。
 * `confidence` = **主观置信度 [0,1]，不是 p-value**。
 */
export interface ResearchConclusion {
  id?: number;
  experimentId: number;
  hypothesisId?: number | null;
  conclusionType: ResearchConclusionType;
  title: string;
  conclusion: string;
  evidence?: unknown;
  confidence?: number | null;
  status: ResearchConclusionStatus;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 策略候选（Research 的出口）。
 * `strategyDefinitionId = null` → **尚未转正，合法状态**；
 * Research 层只写本表，绝不写 `strategies` / `strategy_versions`。
 *
 * 🔴 RESEARCH-006.1 —— 三类字段的写入边界（Domain Model 层，见 `candidates.ts#assertCandidateUpdatePatchKeys`）：
 *   - **草图（人可编辑，可经普通 update）**：`name` / `description` / `entryRule` / `filterRule` /
 *     `exitRule` / `riskRule` / `parameterSpace`；
 *   - **来源快照（只由语义入口写）**：4 个 `source*` 字段 —— 未来归 `createFromConclusion` / `promote`；
 *   - **结构 / 状态（只由语义入口写）**：`experimentId` / `conclusionId` / `strategyDefinitionId` / `status`
 *     —— `status` 未来归 `transition` / `promote`（`CONVERTED` **只能**由 promote 到达）。
 */
export interface ResearchStrategyCandidate {
  id?: number;
  experimentId: number;
  conclusionId?: number | null;
  strategyDefinitionId?: string | null;
  name: string;
  description?: string | null;
  entryRule?: unknown;
  filterRule?: unknown;
  exitRule?: unknown;
  riskRule?: unknown;
  parameterSpace?: unknown;
  /**
   * 研究**来源** Dataset Version 坐标**快照** = `dataset_version.id`（唯一跨模块 Dataset 坐标）。
   * 写入时从 `research_experiment.datasetVersionId` 复制，之后**不随上游变化**。
   * ⚠️ 它回答「基于哪份数据研究出来的」，**不是**「未来 Strategy 执行用哪份数据」
   * （后者是 `strategy_versions.datasetVersionId`，两者允许不同，见 `sourceDatasetDivergenceReason`）。
   */
  sourceDatasetVersionId?: number | null;
  /**
   * 来源 `research_run.id`（**可空**）。
   * `research_conclusion` 无 `runId` 列，只能经 `evidence.primaryAnalysis.analysisId →
   * research_analysis.runId` 两跳解析；**解析不出即 null，禁止伪造**。
   */
  sourceResearchRunId?: number | null;
  /** 研究证据**快照**（provenance snapshot，非 `research_result` 第二份存储；Result 会被重算覆盖）。 */
  sourceTraceJson?: unknown;
  /**
   * Research Source Dataset ≠ Strategy Execution Dataset 时的原因（人可读）。
   * 一致时**必须为 null**，禁止填无意义默认文本凑数。
   */
  sourceDatasetDivergenceReason?: string | null;
  status: ResearchCandidateStatus;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 文件型产物。`experimentId` / `runId` **至少一个非空**（应用层不变量）。
 * 只存 `uri` + `checksum`，禁止把大量二进制写入数据库。
 */
export interface ResearchArtifact {
  id?: number;
  experimentId?: number | null;
  runId?: number | null;
  artifactType: ResearchArtifactType;
  storageType: ResearchArtifactStorageType;
  uri: string;
  checksum?: string | null;
  metadata?: unknown;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// 聚合视图（关系查询出参）
// ---------------------------------------------------------------------------

/** Experiment + 其全部 Run。 */
export interface ResearchExperimentWithRuns {
  experiment: ResearchExperiment;
  runs: ResearchRun[];
}

/** Run + 其全部 Analysis。 */
export interface ResearchRunWithAnalyses {
  run: ResearchRun;
  analyses: ResearchAnalysis[];
}

/** Analysis + 条件 + 指标定义 + 结果（一次取全，供前端单次渲染）。 */
export interface ResearchAnalysisBundle {
  analysis: ResearchAnalysis;
  conditions: ResearchAnalysisCondition[];
  metrics: ResearchAnalysisMetric[];
  results: ResearchResult[];
}

// ---------------------------------------------------------------------------
// 分析模板（RESEARCH-002C）
// 模板是「建分析的配方」：把一组常用分析固化成可跨实验复用的清单。
// ---------------------------------------------------------------------------

/**
 * 模板明细项（= 一个待展开的分析定义）。
 *
 * 与 `ResearchAnalysis` 的差别：**没有 `runId`** —— 模板不属于任何 Run，
 * 展开时才把每一项落成某个 Run 下的分析。
 */
export interface ResearchAnalysisTemplateItem {
  id?: number;
  templateId: number;
  /** 模板内确定性顺序（复现性要求）。 */
  sortOrder: number;
  analysisType: ResearchAnalysisType;
  /** 展开时的默认名称（用户可在预览清单里改，因此只是建议而非约束）。 */
  name: string;
  target?: string | null;
  config?: unknown;
  /**
   * 条件行 JSON（模板项自带）。
   *
   * 这里**允许 JSON**（而 `research_analysis_condition` 是关系表）的理由：模板项的条件是
   * **配置快照**，既不需要被索引、也不需要唯一约束；模板是「配方」而非研究产物，
   * 为它再建第三张表只会让模板读取变成三表 join，换不来任何完整性收益。
   * 条件**落库到真分析时**仍走 `research_analysis_condition`（关系表），口径不降级。
   */
  conditionsJson?: unknown;
  createdAt?: string;
}

/** 分析模板（头 + 明细）。 */
export interface ResearchAnalysisTemplate {
  id?: number;
  /** 全局唯一 —— 用于「一键铺开」时的不歧义引用。 */
  name: string;
  description?: string | null;
  /** 来源实验（仅作溯源展示，不参与展开逻辑，允许为空）。 */
  sourceExperimentId?: number | null;
  items: ResearchAnalysisTemplateItem[];
  createdAt?: string;
  updatedAt?: string;
}
