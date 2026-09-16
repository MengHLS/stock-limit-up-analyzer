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

/**
 * 假设状态 —— **严格取 RESEARCH-FINDING-001 §16 的 6 态**。
 *
 * 与 RESEARCH-001 原 6 态（`DRAFT/TESTING/SUPPORTED/PARTIALLY_SUPPORTED/REJECTED/INCONCLUSIVE`）
 * 的**差异是有意为之**（用户 2026-09-16 拍板「严格改为任务书 6 值」）：
 *   - 主轴从「结论强度」改为「**研究阶段**」：DRAFT → TESTABLE → TESTED → {SUPPORTED|REJECTED} → PROMOTED；
 *   - 废弃 `TESTING`（被 `TESTED` 的完成态语义取代）、`PARTIALLY_SUPPORTED` / `INCONCLUSIVE`
 *     （这两个是「结论强度」，属 `RESEARCH_CONCLUSION_TYPES`，不该出现在假设阶段轴上）；
 *   - 新增 `PROMOTED` —— 假设已转成 Strategy Candidate（**唯一**由 `Hypothesis → Candidate` 入口到达）。
 *
 * ⚠️ 该表迁移前 **0 行**（见 `docs/research/RESEARCH-FINDING-001-audit.md` §1.2），
 *    故本次收敛**无数据迁移负担**，也不存在「既有值无解释」问题。
 */
export const RESEARCH_HYPOTHESIS_STATUSES = [
  "DRAFT",
  "TESTABLE",
  "TESTED",
  "SUPPORTED",
  "REJECTED",
  "PROMOTED",
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

// ---------------------------------------------------------------------------
// RESEARCH-FINDING-001 —— Finding（Result 与 Conclusion 之间的**发现层**）
// ---------------------------------------------------------------------------

/**
 * 发现类型（任务书 §9 的 `MONOTONIC_RELATION / PEAK_RELATION / VALLEY_RELATION` + §6/§10/§11/§12）。
 *
 * 纪律（任务书 §9 末句「不要为了类型数量而过度设计」）：只登记**引擎真实产出**的类型，
 * 不做愿望清单。`EFFECT` 是兜底型（有显著分组差异但不符合更具体的形态时）。
 */
export const RESEARCH_FINDING_TYPES = [
  /** 分组间存在明显差异（§6 Effect）。 */
  "EFFECT",
  /** 连续单调上升 / 下降（§9）。 */
  "MONOTONIC_RELATION",
  /** 局部峰值后反转（§9 例：0~2 → 2~4 → 4~6 → 6~8 → 8%+ 掉头）。 */
  "PEAK_RELATION",
  /** 局部谷值后回升。 */
  "VALLEY_RELATION",
  /** 跨视界形态（§10：效果集中在 T+3~T+10）。 */
  "HORIZON_PATTERN",
  /** 时间切片稳定性（§11）。 */
  "STABILITY",
  /** 条件组合（§12 Interaction / Conditional Finding）。 */
  "INTERACTION",
] as const;
export type ResearchFindingType = (typeof RESEARCH_FINDING_TYPES)[number];

/**
 * 发现状态（任务书 §13）。
 *
 * 🔴 「不要让系统自动把所有 Finding 标记为 SUPPORTED」—— 引擎产出一律 `DISCOVERED`；
 * `SUPPORTED` / `WEAK` / `CONTRADICTED` / `REJECTED` 只能由**用户**经 review 流转。
 */
export const RESEARCH_FINDING_STATUSES = [
  "DISCOVERED",
  "REVIEWED",
  "SUPPORTED",
  "WEAK",
  "CONTRADICTED",
  "REJECTED",
] as const;
export type ResearchFindingStatus = (typeof RESEARCH_FINDING_STATUSES)[number];

/** 研究强度分级（**研究优先级**，不是策略评分 —— 任务书 §14）。 */
export const RESEARCH_STRENGTH_GRADES = ["WEAK", "MEDIUM", "STRONG"] as const;
export type ResearchStrengthGrade = (typeof RESEARCH_STRENGTH_GRADES)[number];

/** 样本充分性分级（任务书 §7：<100 INSUFFICIENT / 100~299 WEAK / 300~999 MEDIUM / >=1000 STRONG）。 */
export const RESEARCH_SAMPLE_GRADES = ["INSUFFICIENT", "WEAK", "MEDIUM", "STRONG"] as const;
export type ResearchSampleGrade = (typeof RESEARCH_SAMPLE_GRADES)[number];

/** 假设的预期方向（任务书 §17 `Expected: positive`）。 */
export const RESEARCH_EXPECTED_DIRECTIONS = ["POSITIVE", "NEGATIVE", "NON_MONOTONIC", "NEUTRAL"] as const;
export type ResearchExpectedDirection = (typeof RESEARCH_EXPECTED_DIRECTIONS)[number];

/**
 * 单调性形态（任务书 §9）。
 * `NONE` = 未观察到连续关系（**如实标注**，不是失败）。
 */
export const RESEARCH_MONOTONICITY_PATTERNS = [
  "MONOTONIC_INCREASING",
  "MONOTONIC_DECREASING",
  "PEAK",
  "VALLEY",
  "NONE",
] as const;
export type ResearchMonotonicityPattern = (typeof RESEARCH_MONOTONICITY_PATTERNS)[number];

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
// RESEARCH-PLANNER-001 — 自动研究编排层枚举（唯一权威）
// ---------------------------------------------------------------------------

/** 研究问题状态（业务对象自身的生命周期）。 */
export const RESEARCH_QUESTION_STATUSES = [
  "DRAFT",
  "PLANNED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "REJECTED",
] as const;
export type ResearchQuestionStatus = (typeof RESEARCH_QUESTION_STATUSES)[number];

/** 研究计划状态。 */
export const RESEARCH_PLAN_STATUSES = ["PLANNED", "MATERIALIZED", "EXECUTED", "FAILED"] as const;
export type ResearchPlanStatus = (typeof RESEARCH_PLAN_STATUSES)[number];

/**
 * 分析优先级（规模控制时的裁剪顺序）。
 *
 * 语义刻意只有三档且**有序**：P0 核心实验 / P1 辅助实验 / P2 探索实验。
 * 裁剪只从 P2 开始，且**永不丢弃 P0 必需项** —— 见 `planner/analysisPlan.ts#applyPlanCap`。
 */
export const RESEARCH_ANALYSIS_PRIORITIES = ["P0", "P1", "P2"] as const;
export type ResearchAnalysisPriority = (typeof RESEARCH_ANALYSIS_PRIORITIES)[number];

/**
 * 「这份研究由谁设计」。
 *
 * `SYSTEM` = Planner 自动生成；`WORKBUDDY` = 由外部智能体经 API 发起；`USER` = 人工在界面创建。
 * 记录它只为一件事：**事后能分清「这实验是谁设计的」**，不参与任何统计判定。
 */
export const RESEARCH_GENERATED_BY = ["USER", "WORKBUDDY", "SYSTEM"] as const;
export type ResearchGeneratedBy = (typeof RESEARCH_GENERATED_BY)[number];

// ---------------------------------------------------------------------------
// 条件形态（RESEARCH-FINDING-001 起迁入本文件）
//
// 为什么迁移：这些是**领域类型**，而本文件自述为「Research 领域类型唯一权威来源」。
// 原先定义在 `conditions.ts` 导致 `types.ts` 无法引用 `ResearchConditionSet`
// （Hypothesis.conditions / Finding.interaction 都需要它），只能造出
// `types → conditions → types` 的循环依赖。迁到此处后 `conditions.ts` 只保留
// **规则**（校验 / 互转 / 渲染），职责反而更清晰；`conditions.ts` 继续 re-export 以保持向后兼容。
// ---------------------------------------------------------------------------

/** 条件值形态（与 `research_analysis_condition.valueJson` 一一对应）。 */
export type ResearchConditionValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<string | number>
  | readonly [number, number];

/** 单条条件（领域形态，未落库；`analysisId` / `id` 由 Repository 补）。 */
export interface ResearchConditionSpec {
  groupNo: number;
  sortOrder: number;
  fieldName: string;
  operator: ResearchConditionOperator;
  value: ResearchConditionValue;
  logicalOperator: ResearchLogicalOperator;
  groupLogicalOperator: ResearchGroupLogicalOperator;
}

/** 条件组（由同一 `groupNo` 的扁平行聚合而成）。 */
export interface ResearchConditionGroup {
  groupNo: number;
  /** 与**前一条件组**的连接符（首个组无前序，值被忽略但保留以维持列非空）。 */
  groupLogicalOperator: ResearchGroupLogicalOperator;
  conditions: ResearchConditionSpec[];
}

/** 条件组集合（前端 / Hypothesis / Candidate 规则复用同一形态）。 */
export interface ResearchConditionSet {
  groups: ResearchConditionGroup[];
}

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

/**
 * 研究假设（研究意图；**不是** Analysis，也**不是** Conclusion）。
 *
 * RESEARCH-FINDING-001 §17 —— **必须结构化**：不允许只存 `description` 式的自然语言。
 * `conditions` / `target` / `horizon` / `expectedDirection` 四件套齐备才可能进 Candidate。
 * 其中 `conditions` **不得**引用 Outcome 变量（前视约束，见 `researchEngine/types.ts#ResearchVariableRole`）。
 */
export interface ResearchHypothesis {
  id?: number;
  experimentId: number;
  /** 软引用 `research_run.id`（可空 —— 假设可先于 Run 提出）。 */
  runId?: number | null;
  name: string;
  statement: string;
  nullHypothesis?: string | null;
  alternativeHypothesis?: string | null;
  /** 结构化研究问题（人读；与 Conclusion 的 researchQuestion 呼应）。 */
  researchQuestion?: string | null;
  /**
   * **结构化条件**（与 `research_analysis_condition` / Candidate 草图同构）。
   * 允许为空（探索性假设尚未完全形式化），但**空条件无法进入 Candidate**。
   */
  conditions?: ResearchConditionSet | null;
  /** 目标变量（如 `future_return`）。 */
  target?: string | null;
  /** 验证视界（如 `T+5`）。 */
  horizon?: string | null;
  /** 预期方向。 */
  expectedDirection?: ResearchExpectedDirection | null;
  /** 预期效应的**人读**描述（不是数值承诺）。 */
  expectedEffect?: string | null;
  /** 来源 Finding id（软引用 `research_finding.id`）。 */
  sourceFindingIds?: number[] | null;
  /** 来源 Conclusion（软引用 `research_conclusion.id`，可空）。 */
  sourceConclusionId?: number | null;
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
  // ---- RESEARCH-PLANNER-001：计划溯源（人工创建时为 null，专家模式不受影响）----
  /** 由哪份研究计划生成（软引用 `research_plan.id`）。 */
  planId?: number | null;
  /** 由哪个 Research Module 生成（研究方法键，如 `PULLBACK_EFFECTIVENESS`）。 */
  moduleKey?: string | null;
  /** 规模裁剪顺序（P0 / P1 / P2）。 */
  priority?: ResearchAnalysisPriority | null;
  /** 这条分析要回答什么（人读）。 */
  purpose?: string | null;
  /** 是否为计划中的必需项。 */
  requiredFlag?: boolean | null;
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
  /** 机器可读证据（唯一构造入口 `conclusionBuilder#buildEvidence`）。 */
  evidence?: unknown;
  /** 主观置信度 [0,1]（**非 p-value**）。 */
  confidence?: number | null;
  /** RESEARCH-FINDING-001 —— 结论回答的**研究问题**原文。 */
  researchQuestion?: string | null;
  /** RESEARCH-FINDING-001 —— 证据**人读**摘要（机器可读证据仍在 `evidence`，不重复存储）。 */
  evidenceSummary?: string | null;
  /**
   * RESEARCH-FINDING-001 —— 引用的 Finding id。
   * **不允许凭空产生结论**：非空即代表结论建立在可回溯的 Finding 上。
   * 空数组 ≠ 无结论，仅表示「该结论不依赖 Finding」（既有 12 条即如此）。
   */
  findingIds?: number[] | null;
  /** RESEARCH-FINDING-001 —— 局限性（必须如实列，禁留空凑数）。 */
  limitations?: string[] | null;
  /** RESEARCH-FINDING-001 —— 后续待答问题。 */
  nextQuestions?: string[] | null;
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
  /**
   * RESEARCH-PLANNER-001 —— 来源 Research Plan id（软引用 `research_plan.id`，**可空**）。
   *
   * 补齐任务书 §16 要求的 Candidate 六项 provenance 中唯一缺位的一项。
   * 它的作用是把「自动规划产出的候选」与「专家手工堆分析产出的候选」区分开，
   * 并支持反查「这份计划产出了哪些候选」。
   *
   * 与 `sourceResearchRunId` 同属**历史事实快照**：只经 create 写入，
   * 被 `RESEARCH_CANDIDATE_IMMUTABLE_FIELDS` 硬拒于普通 update 之外。
   */
  sourceResearchPlanId?: number | null;
  /** 研究证据**快照**（provenance snapshot，非 `research_result` 第二份存储；Result 会被重算覆盖）。 */
  sourceTraceJson?: unknown;
  /**
   * Research Source Dataset ≠ Strategy Execution Dataset 时的原因（人可读）。
   * 一致时**必须为 null**，禁止填无意义默认文本凑数。
   */
  sourceDatasetDivergenceReason?: string | null;
  /**
   * RESEARCH-FINDING-001 —— 来源 Hypothesis（软引用 `research_hypothesis.id`，可空）。
   *
   * 为空 = 该候选走 `Conclusion → Candidate` 老路径（无假设环节）。**不 backfill 伪造**。
   */
  sourceHypothesisId?: number | null;
  /**
   * RESEARCH-FINDING-001 —— 来源 Finding id（软引用 `research_finding.id`）。
   * 与 `sourceTraceJson` 的分工：后者是**证据快照**，本字段是**可检索的谱系锚点**。
   */
  sourceFindingIds?: number[] | null;
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
// RESEARCH-FINDING-001 —— 发现层（Result → Finding）
//
// 三层职责（严格区分，任务书 §3.1）：
//   Result    = 某一次 Analysis 得到的**原始统计证据**（不解释）；
//   Finding   = 从**一个或多个 Result** 中识别出的、具有研究意义的**统计发现**（保留 provenance）；
//   Conclusion = 针对 Research Question 对**多个 Finding** 综合后的**研究判断**。
//
// 🔴 Finding 不允许脱离 Result 独立存在：`primaryAnalysisId` + `sourceResultIds` 是硬锚点。
// 🔴 一切数值来自 `research_result` 实际行，**禁止虚构 / 禁止为 Demo 造数**（任务书 §35.8）。
// ---------------------------------------------------------------------------

/** Effect 证据（§6 效果 / §8 基准）。 */
export interface ResearchFindingEffect {
  /** 条件组收益（`MEAN_RETURN`）。 */
  groupReturn: number | null;
  /** 基准收益。**无 benchmark 能力时为 null**，并置 `benchmarkUnavailable = true`。 */
  benchmarkReturn: number | null;
  /** 超额 = groupReturn − benchmarkReturn（任一分量为 null 即为 null，**不补 0**）。 */
  excessReturn: number | null;
  /** §8：拿不到基准就**明确标记**，不得强行虚构。 */
  benchmarkUnavailable: boolean;
  /** 基准来源说明（如 `experiment-baseline:analysis=123` / `unavailable`）。 */
  benchmarkSource: string;
  medianReturn: number | null;
  winRate: number | null;
  /** 逐分组明细（如回撤分档），供前端柱状图直接消费。 */
  buckets: Array<{ label: string; metricValue: number | null; sampleCount: number | null }>;
}

/** 样本充分性（§7）。阈值**配置化**，不得硬编码在 UI。 */
export interface ResearchFindingSample {
  sampleCount: number;
  grade: ResearchSampleGrade;
  /** 判定所用阈值快照（可复核）。 */
  thresholds: { weak: number; medium: number; strong: number };
}

/** 视界一致性（§10）。数据来源 = 同一 metricCode 在各 `dimension.horizon` 上的 Result 行。 */
export interface ResearchFindingHorizon {
  peakHorizon: number | null;
  /** 效果「较明显」的连续视界区间（如 `[3,10]`）。 */
  effectiveHorizonRange: [number, number] | null;
  /** 方向一致性 [0,1]（各视界效应符号与峰值方向一致的比例）。 */
  directionConsistency: number | null;
  points: Array<{ horizon: number; metricValue: number | null; sampleCount: number | null }>;
}

/** 时间稳定性（§11）。第一版至少完成**时间**维度（年）。 */
export interface ResearchFindingStability {
  /** 切片维度键（第一版 = `year`）。 */
  dimensionKey: string;
  slices: Array<{ label: string; metricValue: number | null; sampleCount: number | null }>;
  /** 方向是否稳定（各切片同号且通过一致性下限）。 */
  stable: boolean;
  /** 是否出现明显冲突（§13 `CONTRADICTED` 的客观依据）。 */
  contradicted: boolean;
  /** 方向一致性 [0,1]。 */
  consistentRatio: number | null;
}

/** 单调性（§9）。 */
export interface ResearchFindingMonotonicity {
  pattern: ResearchMonotonicityPattern;
  /** 反转点档位标签（`PEAK` / `VALLEY` 时有值，其余为 null）。 */
  reversalAt: string | null;
  /** 有序档位明细（按自然顺序排列）。 */
  buckets: Array<{ label: string; metricValue: number | null; sampleCount: number | null }>;
  /** 有序档位上的秩相关（[−1,1]；样本不足算不出为 null，**不编造**）。 */
  rankCorrelation: number | null;
}

/** Interaction / Conditional Finding（§12）。 */
export interface ResearchFindingInteraction {
  /** 参与组合的 Finding id。 */
  findingIds: number[];
  /** 组合后的结构化条件（单条件为 `groups[0]`）。 */
  combinedConditions: ResearchConditionSet | null;
  singleEffect: number | null;
  combinedEffect: number | null;
  /**
   * 组合结果**是否真实存在于 Result**。
   * 🔴 `false` ⇒ **不允许产 Finding**，只能产 `UNTESTED_HYPOTHESIS`（任务书 §12）。
   */
  tested: boolean;
  /** 未测试时的原因（人读）。 */
  untestedReason: string | null;
}

/**
 * Research 发现（**研究事实**，非策略、非评分推荐）。
 *
 * §14 纪律：`researchStrength` 是**研究优先级指标**，禁止变成「策略评分 / 推荐买入」。
 */
export interface ResearchFinding {
  id?: number;
  experimentId: number;
  runId?: number | null;
  /**
   * 主证据分析（固定优先级单选，**不按效应大小挑**，避免选择性报告）。
   */
  primaryAnalysisId?: number | null;
  findingType: ResearchFindingType;
  title: string;
  summary?: string | null;
  status: ResearchFindingStatus;
  /** 目标变量（与 Analysis.target 同口径）。 */
  target?: string | null;
  /** 分析维度（如 `{feature:"pullback_depth", bucket:"3%~5%", horizon:5}`）。 */
  dimension?: Record<string, string | number> | null;
  /** **provenance 锚点**：依据的 `research_result.id`。 */
  sourceResultIds?: number[] | null;
  effect?: ResearchFindingEffect | null;
  sample?: ResearchFindingSample | null;
  horizon?: ResearchFindingHorizon | null;
  stability?: ResearchFindingStability | null;
  monotonicity?: ResearchFindingMonotonicity | null;
  interaction?: ResearchFindingInteraction | null;
  /** 五维研究强度分项（各 [0,1]）—— 与 DB 列 1:1，不嵌套。 */
  effectStrength?: number | null;
  sampleStrength?: number | null;
  stabilityStrength?: number | null;
  horizonConsistency?: number | null;
  monotonicityStrength?: number | null;
  /** 加权合成总分（[0,1]）。 */
  researchStrength?: number | null;
  researchStrengthGrade?: ResearchStrengthGrade | null;
  /** 判定阈值快照（`FindingPolicy`，可复核 / 可调参 / 可复现）。 */
  policy?: unknown;
  limitations?: string[] | null;
  /** 人读证据摘要 + 免责声明（机器可读证据在各 `effect/sample/...` 字段）。 */
  evidence?: unknown;
  /** 确定性指纹（幂等；同 Run 重复 detect 不产生重复行）。 */
  fingerprint?: string | null;
  createdAt?: string;
  updatedAt?: string;
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

// ---------------------------------------------------------------------------
// RESEARCH-PLANNER-001 — 研究问题 / 研究计划
// ---------------------------------------------------------------------------

/**
 * 意图识别证据（可复核，**不是黑箱**）。
 *
 * 自动编排最危险的不是「没识别出来」，而是「识别错了却不告诉用户」。
 * 因此本结构强制记录三样东西：
 *   - `matchedModuleKeys`：最终选中的 Research Module（按确定性打分排序，禁随机）；
 *   - `matchedClauses`：问题文本里**被采纳**的分句及其命中的关键词；
 *   - `unresolvedClauses`：**没被任何规则采纳**的分句 —— 必须原样回显给用户，
 *     否则用户会对着一个「看起来完整、实际没回答我的问题」的计划做决策。
 */
export interface ResearchIntentEvidence {
  matchedModuleKeys: string[];
  matchedClauses: Array<{
    clause: string;
    keyword: string;
    /** 命中的方法键（同一分句可提示多个方法）。 */
    moduleKeys: string[];
  }>;
  unresolvedClauses: string[];
  /** 逐关键词的命中记录（含未命中已登记关键词 —— 用于解释「为什么没选中某方法」）。 */
  keywordHits: Array<{ moduleKey: string; keyword: string; matched: boolean }>;
}

/** 研究问题（RESEARCH-PLANNER-001 的核心业务对象）。 */
export interface ResearchQuestion {
  id?: number;
  /** 软引用 `dataset_version.id`（唯一 Dataset 坐标）。 */
  datasetVersionId: number;
  /** 用户原话（**禁改写**）。 */
  questionText: string;
  researchType: ResearchType;
  createdBy: ResearchGeneratedBy;
  intent?: ResearchIntentEvidence | null;
  status: ResearchQuestionStatus;
  experimentId?: number | null;
  planId?: number | null;
  runId?: number | null;
  conclusionId?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 计划中的一条分析（落成后的 `research_analysis` 行是它的物化形态）。
 *
 * 这里的字段与 `ResearchAnalysis` **有意重叠**（analysisType / name / target / config /
 * conditions），因为它是「同一条分析在执行前的描述」。区别只有三样：优先级、用途、是否必需。
 * 不另造 `research_plan_analysis` 表，理由见 `drizzle/0039_research_planner.sql` 头部。
 */
export interface ResearchPlanItem {
  /** 计划内确定性顺序（= `sortOrder`，保证复现性）。 */
  sortOrder: number;
  analysisType: ResearchAnalysisType;
  /** 展开后的分析名（用户可在预览里改）。 */
  name: string;
  target?: string | null;
  config?: unknown;
  conditions?: ResearchConditionSpec[];
  priority: ResearchAnalysisPriority;
  /** 这条分析回答什么（人读；写进 `research_analysis.purpose`）。 */
  purpose: string;
  required: boolean;
  /** 生成它的研究方法键。 */
  moduleKey: string;
}

/** 计划构造过程中被丢弃的理由（**如实登记，不静默丢**）。 */
export interface ResearchPlanDropNote {
  moduleKey: string;
  analysisType: ResearchAnalysisType;
  name: string;
  /** `CAP_EXCEEDED` = 规模上限裁剪；`CAPABILITY_MISSING` = 该 Dataset 没有所需数据能力。 */
  reason: "CAP_EXCEEDED" | "CAPABILITY_MISSING";
  detail: string;
}

/** 研究计划（执行前可预览，落成后每条对应一行 `research_analysis`）。 */
export interface ResearchPlan {
  id?: number;
  questionId: number;
  experimentId: number;
  runId?: number | null;
  datasetVersionId: number;
  moduleKeys: string[];
  items: ResearchPlanItem[];
  plannedCount: number;
  materializedCount: number;
  droppedCount: number;
  maxAnalysisPerPlan: number;
  capApplied: boolean;
  generatedBy: ResearchGeneratedBy;
  status: ResearchPlanStatus;
  /** 未采纳分句 + 丢弃项 + 能力缺口说明。 */
  notes?: ResearchPlanNotes | null;
  createdAt?: string;
  updatedAt?: string;
}

/** RESEARCH-PLANNER-001 — 一个变量在这份计划里扮演的角色。 */
export type PlanVariableRole = "condition" | "grouping" | "descriptive" | "target";

/** 变量在计划中的使用登记（同一个变量可能同时是「条件」与「描述」）。 */
export interface PlanVariableUse {
  variable: string;
  roles: PlanVariableRole[];
  /** 有多少条分析用到了它（不是「值」的条数）。 */
  analysisCount: number;
  /** 人读口径（能翻译成中文的才有；翻不出来的留下空数组，**不编造**）。 */
  readbacks: string[];
  /** 结果变量才有：计划覆盖的视界（升序去重）。 */
  horizons: number[];
}

/**
 * RESEARCH-PLANNER-001（§7）—— Analysis Plan 的**结构化登记**。
 *
 * §7 要求计划记录 `analysisTypes / featureMapping / targetMapping / horizons / segments /
 * baseline / condition / stabilityPlan / interactionPlan`，只有这样「执行前预览」才能回答
 * 「系统到底打算算什么」，而不是让用户去逐条读 28 个分析名。
 *
 * 🔴 为什么不给 `research_plan` 加列：该表已确立的分工是
 *    「列存**可检索的谱系锚点**（questionId / runId / status / 计数），JSON 存**计划形状**」。
 *    本结构的九个字段全部是这份计划**自己的形状**（不可检索、不外键、随分析类型演进），
 *    加列等于把它们冻结进 schema，与「Research Module 可扩展」（§3）直接冲突。
 *    因此登记在 `notesJson.spec`，与 `planJson` 同属计划形状。
 *
 * 🔴 它由 `items` **确定性推导**（见 `buildPlanSpec`）：
 *    - **不含任何统计结论**（本结构在「执行前」就已存在，那时还没有任何数字）；
 *    - **不臆造**意图 —— `baseline` / `condition` / `segments` 都指向计划里**真实存在**的那几条分析；
 *    - 翻译不出来的口径留空数组，不写近似说法。
 */
export interface ResearchPlanSpec {
  /** 采用的研究方法（主方法恒为 `[0]`）。 */
  researchModule: { primary: string; primaryLabel: string; secondary: string[] };
  datasetVersionId: number;
  /** 计划实际采用的分析类型（升序去重）。 */
  analysisTypes: string[];
  /** 特征侧：条件 / 分组 / 描述用到的变量。 */
  featureMapping: PlanVariableUse[];
  /** 结果侧：被当作结果变量使用的变量（含视界）。 */
  targetMapping: PlanVariableUse[];
  /** 计划覆盖的收益视界（升序去重）。 */
  horizons: number[];
  /** SEGMENT_RELATION 的分段窗口（A / B 不重叠 —— 这是该分析类型的前提）。 */
  segments: Array<{
    analysisName: string;
    windowA: number[];
    windowB: number[];
    windowAStat: string;
    windowBStat: string;
  }>;
  /** 比较基准：全样本无条件事件研究。没有它，任何「条件更好」都无法归因。 */
  baseline: { analysisName: string; horizons: number[]; note: string } | null;
  /** 主条件口径：P0 必需分析的条件表达式 + 人读回执（用户核对口径的地方）。 */
  condition: Array<{ analysisName: string; expressions: string[]; readbacks: string[] }>;
  /** 稳定性分析计划（哪个维度、哪条分析）。 */
  stabilityPlan: Array<{ dimension: string; dimensionLabel: string; analysisName: string }>;
  /** 关系 / 分布类分析计划（分段关系、分位关系、描述统计）。 */
  interactionPlan: Array<{ analysisName: string; analysisType: string; description: string }>;
}

/** 计划说明（可复核；**不含任何统计结论**）。 */
export interface ResearchPlanNotes {
  unresolvedClauses: string[];
  dropped: ResearchPlanDropNote[];
  /** 用到的条件字段 → 人读口径（用户要能核对「系统理解的和我说的是一回事吗」）。 */
  conditionReadback: Array<{ fieldName: string; operator: string; value: unknown; readback: string }>;
  /** 目标变量 / 视界的选取理由。 */
  selectionRationale: string[];
  /** §7 结构化登记（可选：RESEARCH-PLANNER-001 之前的计划没有这一项）。 */
  spec?: ResearchPlanSpec;
  /**
   * **与用户提问侧重直接相关**的分析名（§13 / §15 / §28）。
   *
   * 由「强调词命中的精修配方」生成、且**最终被保留在计划里**的那些分析名。
   * 消费方 = `buildResearchOutcome`：据此产出 `questionAlignedFindings`，
   * 并在结论正文里显式分段回答「你问的那件事」。**不含任何统计结果**。
   *
   * 可选：RESEARCH-PLANNER-001 修复前的计划没有这一项（如实缺省，不回填）。
   */
  emphasisAnalysisNames?: string[];
}
