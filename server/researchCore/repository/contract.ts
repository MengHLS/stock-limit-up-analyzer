/**
 * RESEARCH-001 — Repository 契约（8 + 2 个接口）。
 *
 * 边界（指令 §18）：
 *   - Repository **只负责 Persistence / Query**；
 *   - **禁止**在 Repository 中实现统计计算、信号求值、回测、参数搜索；
 *   - 所有跨实体引用为 **soft reference**，写入前必须校验父引用存在性（见 errors.ts）；
 *   - 单实体 CRUD 在各自的 Repository；**关系查询**（getExperimentWithRuns 等）由
 *     `ResearchRelationshipQueries` 承载，实现方可组合多个单实体 Repository。
 */

import type {
  ResearchAnalysis,
  ResearchAnalysisCondition,
  ResearchAnalysisMetric,
  ResearchArtifact,
  ResearchConclusion,
  ResearchExperiment,
  ResearchExperimentWithRuns,
  ResearchHypothesis,
  ResearchResult,
  ResearchRun,
  ResearchRunWithAnalyses,
  ResearchAnalysisBundle,
  ResearchStrategyCandidate,
  ResearchAnalysisTemplate,
  ResearchAnalysisTemplateItem,
} from "../types";

// ---------------------------------------------------------------------------
// 创建 / 更新入参
// ---------------------------------------------------------------------------

export type ResearchExperimentCreateInput = Omit<
  ResearchExperiment,
  "id" | "createdAt" | "updatedAt" | "status"
> & { status?: ResearchExperiment["status"] };

/** 更新补丁：`datasetVersionId` **不可改**（输入边界创建即冻结）。 */
export type ResearchExperimentUpdatePatch = Partial<
  Omit<ResearchExperiment, "id" | "datasetVersionId" | "createdAt" | "updatedAt">
>;

export type ResearchHypothesisCreateInput = Omit<
  ResearchHypothesis,
  "id" | "createdAt" | "updatedAt" | "status"
> & { status?: ResearchHypothesis["status"] };
export type ResearchHypothesisUpdatePatch = Partial<
  Omit<ResearchHypothesis, "id" | "experimentId" | "createdAt" | "updatedAt">
>;

export type ResearchRunCreateInput = Omit<
  ResearchRun,
  "id" | "createdAt" | "status"
> & { status?: ResearchRun["status"] };
export type ResearchRunUpdatePatch = Partial<
  Omit<ResearchRun, "id" | "experimentId" | "runNo" | "createdAt">
>;

export type ResearchAnalysisCreateInput = Omit<ResearchAnalysis, "id" | "createdAt" | "status"> & {
  status?: ResearchAnalysis["status"];
};
export type ResearchAnalysisUpdatePatch = Partial<
  Omit<ResearchAnalysis, "id" | "runId" | "createdAt">
>;

export type ResearchAnalysisConditionCreateInput = Omit<
  ResearchAnalysisCondition,
  "id" | "createdAt"
>;
export type ResearchAnalysisConditionUpdatePatch = Partial<
  Omit<ResearchAnalysisCondition, "id" | "analysisId" | "createdAt">
>;

export type ResearchAnalysisMetricCreateInput = Omit<ResearchAnalysisMetric, "id" | "createdAt">;
export type ResearchAnalysisMetricUpdatePatch = Partial<
  Omit<ResearchAnalysisMetric, "id" | "analysisId" | "createdAt">
>;

export type ResearchResultCreateInput = Omit<ResearchResult, "id" | "createdAt">;

export type ResearchConclusionCreateInput = Omit<
  ResearchConclusion,
  "id" | "createdAt" | "updatedAt" | "status"
> & { status?: ResearchConclusion["status"] };
export type ResearchConclusionUpdatePatch = Partial<
  Omit<ResearchConclusion, "id" | "experimentId" | "createdAt" | "updatedAt">
>;

export type ResearchStrategyCandidateCreateInput = Omit<
  ResearchStrategyCandidate,
  "id" | "createdAt" | "updatedAt" | "status"
> & { status?: ResearchStrategyCandidate["status"] };

/**
 * RESEARCH-006.1 — **普通更新补丁**。
 *
 * 含两部分，边界不同（见 `researchCore/candidates.ts` 顶部说明）：
 *   - 人可编辑的研究草图：`name` / `description` / `entryRule` / `filterRule` / `exitRule` /
 *     `riskRule` / `parameterSpace`；
 *   - **状态机守卫字段**：`status` / `strategyDefinitionId` —— 取值必须过
 *     `assertCandidateTransition` + `assertCandidateConversionCoherence`。
 *
 * **硬排除**（类型层 + 运行时 `assertCandidateUpdatePatchKeys` 双保险）：
 *   `experimentId` / `conclusionId` / 4 个 `source*` —— 结构锚与历史事实快照，
 *   只能由未来的 `createFromConclusion` / `promote` 通过**专用方法**写入。
 *
 * ⚠️ 006.0 §10.1：API 层（006.2）必须再把 `status` / `strategyDefinitionId` 从通用 update
 * 白名单摘出，只走语义化 `transition` / `promote`。006.1 **不重构**既有迁移路径。
 */
export type ResearchStrategyCandidateUpdatePatch = Partial<
  Pick<
    ResearchStrategyCandidate,
    | "name"
    | "description"
    | "entryRule"
    | "filterRule"
    | "exitRule"
    | "riskRule"
    | "parameterSpace"
    | "status"
    | "strategyDefinitionId"
  >
>;

export type ResearchArtifactCreateInput = Omit<ResearchArtifact, "id" | "createdAt" | "storageType"> & {
  storageType?: ResearchArtifact["storageType"];
};

// ---------------------------------------------------------------------------
// 列表过滤
// ---------------------------------------------------------------------------

export interface ResearchExperimentListFilter {
  datasetVersionId?: number;
  status?: ResearchExperiment["status"];
  researchType?: ResearchExperiment["researchType"];
}

export interface ResearchRunListFilter {
  experimentId?: number;
  status?: ResearchRun["status"];
}

export interface ResearchAnalysisListFilter {
  runId?: number;
  analysisType?: ResearchAnalysis["analysisType"];
  status?: ResearchAnalysis["status"];
}

export interface ResearchConclusionListFilter {
  experimentId?: number;
  hypothesisId?: number;
  status?: ResearchConclusion["status"];
}

export interface ResearchCandidateListFilter {
  experimentId?: number;
  conclusionId?: number;
  status?: ResearchStrategyCandidate["status"];
  strategyDefinitionId?: string;
  /** RESEARCH-006.1：按研究来源 Dataset Version 坐标（`dataset_version.id`）过滤。 */
  sourceDatasetVersionId?: number;
}

export interface ResearchArtifactListFilter {
  experimentId?: number;
  runId?: number;
  artifactType?: ResearchArtifact["artifactType"];
}

export interface ResearchResultListFilter {
  analysisId?: number;
  metricCode?: string;
  resultType?: ResearchResult["resultType"];
}

// ---------------------------------------------------------------------------
// Repository 接口
// ---------------------------------------------------------------------------

export interface ResearchExperimentRepository {
  create(input: ResearchExperimentCreateInput): Promise<ResearchExperiment>;
  getById(id: number): Promise<ResearchExperiment | undefined>;
  list(filter?: ResearchExperimentListFilter): Promise<ResearchExperiment[]>;
  update(id: number, patch: ResearchExperimentUpdatePatch): Promise<ResearchExperiment>;
  delete(id: number): Promise<void>;
}

export interface ResearchHypothesisRepository {
  create(input: ResearchHypothesisCreateInput): Promise<ResearchHypothesis>;
  getById(id: number): Promise<ResearchHypothesis | undefined>;
  listByExperiment(experimentId: number): Promise<ResearchHypothesis[]>;
  update(id: number, patch: ResearchHypothesisUpdatePatch): Promise<ResearchHypothesis>;
  delete(id: number): Promise<void>;
}

export interface ResearchRunRepository {
  create(input: ResearchRunCreateInput): Promise<ResearchRun>;
  getById(id: number): Promise<ResearchRun | undefined>;
  list(filter?: ResearchRunListFilter): Promise<ResearchRun[]>;
  /** 下一个可用 runNo（当前最大 + 1；无 Run 时为 1）。 */
  nextRunNo(experimentId: number): Promise<number>;
  update(id: number, patch: ResearchRunUpdatePatch): Promise<ResearchRun>;
  delete(id: number): Promise<void>;
}

export interface ResearchAnalysisRepository {
  create(input: ResearchAnalysisCreateInput): Promise<ResearchAnalysis>;
  getById(id: number): Promise<ResearchAnalysis | undefined>;
  list(filter?: ResearchAnalysisListFilter): Promise<ResearchAnalysis[]>;
  update(id: number, patch: ResearchAnalysisUpdatePatch): Promise<ResearchAnalysis>;
  delete(id: number): Promise<void>;
}

export interface ResearchAnalysisConditionRepository {
  /** 整批替换该 Analysis 的条件（先删后插，保证顺序确定性）。 */
  replaceForAnalysis(
    analysisId: number,
    conditions: ReadonlyArray<Omit<ResearchAnalysisCondition, "id" | "analysisId" | "createdAt">>,
  ): Promise<ResearchAnalysisCondition[]>;
  listByAnalysis(analysisId: number): Promise<ResearchAnalysisCondition[]>;
  deleteByAnalysis(analysisId: number): Promise<number>;
}

export interface ResearchAnalysisMetricRepository {
  create(input: ResearchAnalysisMetricCreateInput): Promise<ResearchAnalysisMetric>;
  getById(id: number): Promise<ResearchAnalysisMetric | undefined>;
  listByAnalysis(analysisId: number): Promise<ResearchAnalysisMetric[]>;
  update(id: number, patch: ResearchAnalysisMetricUpdatePatch): Promise<ResearchAnalysisMetric>;
  delete(id: number): Promise<void>;
}

export interface ResearchResultRepository {
  /** 批量写入结果行（一次 Analysis 的完整结果集）。 */
  createMany(inputs: ReadonlyArray<ResearchResultCreateInput>): Promise<ResearchResult[]>;
  list(filter?: ResearchResultListFilter): Promise<ResearchResult[]>;
  deleteByAnalysis(analysisId: number): Promise<number>;
}

export interface ResearchConclusionRepository {
  create(input: ResearchConclusionCreateInput): Promise<ResearchConclusion>;
  getById(id: number): Promise<ResearchConclusion | undefined>;
  list(filter?: ResearchConclusionListFilter): Promise<ResearchConclusion[]>;
  update(id: number, patch: ResearchConclusionUpdatePatch): Promise<ResearchConclusion>;
  delete(id: number): Promise<void>;
}

export interface ResearchStrategyCandidateRepository {
  create(input: ResearchStrategyCandidateCreateInput): Promise<ResearchStrategyCandidate>;
  getById(id: number): Promise<ResearchStrategyCandidate | undefined>;
  list(filter?: ResearchCandidateListFilter): Promise<ResearchStrategyCandidate[]>;
  update(id: number, patch: ResearchStrategyCandidateUpdatePatch): Promise<ResearchStrategyCandidate>;
  delete(id: number): Promise<void>;
}

export interface ResearchArtifactRepository {
  create(input: ResearchArtifactCreateInput): Promise<ResearchArtifact>;
  getById(id: number): Promise<ResearchArtifact | undefined>;
  list(filter?: ResearchArtifactListFilter): Promise<ResearchArtifact[]>;
  delete(id: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// 分析模板（RESEARCH-002C）
// ---------------------------------------------------------------------------

/** 模板明细入参：`templateId` / `id` / `createdAt` 由 Repository 负责。 */
export type ResearchAnalysisTemplateItemInput = Omit<
  ResearchAnalysisTemplateItem,
  "id" | "templateId" | "createdAt"
>;

/** 模板创建入参（明细整体给出；不支持单独增删明细项 —— 模板是整体替换的「配方」）。 */
export interface ResearchAnalysisTemplateCreateInput {
  name: string;
  description?: string | null;
  sourceExperimentId?: number | null;
  items: ReadonlyArray<ResearchAnalysisTemplateItemInput>;
}

export interface ResearchAnalysisTemplateRepository {
  /** 创建模板（头 + 明细）。名字冲突由实现方抛 `TEMPLATE_NAME_CONFLICT`（唯一约束兜底）。 */
  create(input: ResearchAnalysisTemplateCreateInput): Promise<ResearchAnalysisTemplate>;
  getById(id: number): Promise<ResearchAnalysisTemplate | undefined>;
  getByName(name: string): Promise<ResearchAnalysisTemplate | undefined>;
  /** 全部模板（含明细）。模板数量天然很小，故不提供分页；**空库返回 `[]` 而非 undefined**。 */
  list(): Promise<ResearchAnalysisTemplate[]>;
  delete(id: number): Promise<void>;
}

/**
 * 关系查询（指令 §18 要求；由实现方**组合**单实体 Repository，不引入新的持久化职责）。
 */
export interface ResearchRelationshipQueries {
  getExperimentWithRuns(experimentId: number): Promise<ResearchExperimentWithRuns | undefined>;
  getRunWithAnalyses(runId: number): Promise<ResearchRunWithAnalyses | undefined>;
  getAnalysisBundle(analysisId: number): Promise<ResearchAnalysisBundle | undefined>;
  getExperimentConclusions(experimentId: number): Promise<ResearchConclusion[]>;
  getHypothesisConclusions(hypothesisId: number): Promise<ResearchConclusion[]>;
  getCandidatesByExperiment(experimentId: number): Promise<ResearchStrategyCandidate[]>;
}

/** 完整仓储集合（便于一次性注入 / 测试替身）。 */
export interface ResearchRepositories {
  experiments: ResearchExperimentRepository;
  hypotheses: ResearchHypothesisRepository;
  runs: ResearchRunRepository;
  analyses: ResearchAnalysisRepository;
  conditions: ResearchAnalysisConditionRepository;
  metrics: ResearchAnalysisMetricRepository;
  results: ResearchResultRepository;
  conclusions: ResearchConclusionRepository;
  candidates: ResearchStrategyCandidateRepository;
  artifacts: ResearchArtifactRepository;
  /** 分析模板（跨实验复用的建分析配方）。 */
  templates: ResearchAnalysisTemplateRepository;
  relationships: ResearchRelationshipQueries;
}
