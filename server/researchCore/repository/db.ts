/**
 * RESEARCH-001 — 真实 DB Repository 实现（TiDB / MySQL，沿用 drizzle + getDb）。
 *
 * 语义与 `inMemory.ts` **严格对齐**（同一套不变量、同一批错误码），差异仅在存储介质。
 *
 * 边界：
 *   - 只做 Persistence / Query；**禁止**统计计算 / 信号求值 / 回测 / 参数搜索；
 *   - 零数据库 FK，故**写入前显式校验父引用存在性**（`dataset_version` 亦实查）；
 *   - 不写 `strategies` / `strategy_versions`（Candidate 只软引用）。
 */

import { and, asc, desc, eq, gt, inArray, max } from "drizzle-orm";
import { getDb } from "../../db";
import {
  datasetVersions,
  researchAnalysis,
  researchAnalysisCondition,
  researchAnalysisMetric,
  researchAnalysisTemplate,
  researchAnalysisTemplateItem,
  researchArtifact,
  researchConclusion,
  researchExperiment,
  researchHypothesis,
  researchResult,
  researchRun,
  researchStrategyCandidate,
} from "../../../drizzle/schema";
import {
  assertCandidateConversionCoherence,
  assertCandidateInput,
  assertCandidateTransition,
  assertCandidateUpdatePatchKeys,
} from "../candidates";
import { assertConditionSet, groupConditions } from "../conditions";
import { assertResearchRunExecutionLog, parseResearchRunExecutionLog } from "../executionLog";
import { assertResearchResult } from "../results";
import { decodeJson, encodeJson, toDate, toIso } from "../serialization";
import {
  RESEARCH_REFERENCE_ERROR,
  ResearchConflictError,
  ResearchReferenceError,
} from "./errors";
import type {
  ResearchAnalysis,
  ResearchAnalysisCondition,
  ResearchAnalysisMetric,
  ResearchAnalysisTemplate,
  ResearchAnalysisTemplateItem,
  ResearchArtifact,
  ResearchConclusion,
  ResearchExperiment,
  ResearchHypothesis,
  ResearchResult,
  ResearchRun,
  ResearchStrategyCandidate,
} from "../types";
import type {
  ResearchAnalysisConditionRepository,
  ResearchAnalysisListFilter,
  ResearchAnalysisMetricRepository,
  ResearchAnalysisRepository,
  ResearchAnalysisTemplateRepository,
  ResearchArtifactListFilter,
  ResearchArtifactRepository,
  ResearchCandidateListFilter,
  ResearchConclusionListFilter,
  ResearchConclusionRepository,
  ResearchExperimentListFilter,
  ResearchExperimentRepository,
  ResearchHypothesisRepository,
  ResearchRelationshipQueries,
  ResearchRepositories,
  ResearchResultListFilter,
  ResearchResultRepository,
  ResearchRunListFilter,
  ResearchRunRepository,
  ResearchStrategyCandidateRepository,
} from "./contract";

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用（DATABASE_URL 未配置或连接失败），无法执行 Research 持久化操作");
  return db;
}

/** 插入并返回自增 id。 */
async function insertAndGetId(insert: PromiseLike<unknown> | unknown): Promise<number> {
  const result = (await insert) as Array<{ insertId: number }>;
  const id = Number(result[0]?.insertId);
  if (!Number.isFinite(id)) throw new Error("插入成功但未取得自增 id");
  return id;
}

async function requireDatasetVersion(db: Db, datasetVersionId: number): Promise<void> {
  const rows = await db
    .select({ id: datasetVersions.id })
    .from(datasetVersions)
    .where(eq(datasetVersions.id, datasetVersionId))
    .limit(1);
  if (rows.length === 0) {
    throw new ResearchReferenceError(
      RESEARCH_REFERENCE_ERROR.DATASET_VERSION_NOT_FOUND,
      `引用不存在的 Dataset Version：${datasetVersionId}`,
    );
  }
}

async function requireExperimentRow(db: Db, experimentId: number): Promise<void> {
  const rows = await db
    .select({ id: researchExperiment.id })
    .from(researchExperiment)
    .where(eq(researchExperiment.id, experimentId))
    .limit(1);
  if (rows.length === 0) {
    throw new ResearchReferenceError(
      RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
      `引用不存在的 Experiment：${experimentId}`,
    );
  }
}

async function requireRunRow(db: Db, runId: number): Promise<void> {
  const rows = await db.select({ id: researchRun.id }).from(researchRun).where(eq(researchRun.id, runId)).limit(1);
  if (rows.length === 0) {
    throw new ResearchReferenceError(RESEARCH_REFERENCE_ERROR.RUN_NOT_FOUND, `引用不存在的 Run：${runId}`);
  }
}

async function requireAnalysisRow(db: Db, analysisId: number): Promise<void> {
  const rows = await db
    .select({ id: researchAnalysis.id })
    .from(researchAnalysis)
    .where(eq(researchAnalysis.id, analysisId))
    .limit(1);
  if (rows.length === 0) {
    throw new ResearchReferenceError(
      RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
      `引用不存在的 Analysis：${analysisId}`,
    );
  }
}

async function requireHypothesisRow(db: Db, hypothesisId: number): Promise<void> {
  const rows = await db
    .select({ id: researchHypothesis.id })
    .from(researchHypothesis)
    .where(eq(researchHypothesis.id, hypothesisId))
    .limit(1);
  if (rows.length === 0) {
    throw new ResearchReferenceError(
      RESEARCH_REFERENCE_ERROR.HYPOTHESIS_NOT_FOUND,
      `引用不存在的 Hypothesis：${hypothesisId}`,
    );
  }
}

async function requireConclusionRow(db: Db, conclusionId: number): Promise<void> {
  const rows = await db
    .select({ id: researchConclusion.id })
    .from(researchConclusion)
    .where(eq(researchConclusion.id, conclusionId))
    .limit(1);
  if (rows.length === 0) {
    throw new ResearchReferenceError(
      RESEARCH_REFERENCE_ERROR.CONCLUSION_NOT_FOUND,
      `引用不存在的 Conclusion：${conclusionId}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 行 → 领域 映射
// ---------------------------------------------------------------------------

type ExperimentRow = typeof researchExperiment.$inferSelect;
type HypothesisRow = typeof researchHypothesis.$inferSelect;
type RunRow = typeof researchRun.$inferSelect;
type AnalysisRow = typeof researchAnalysis.$inferSelect;
type ConditionRow = typeof researchAnalysisCondition.$inferSelect;
type MetricRow = typeof researchAnalysisMetric.$inferSelect;
type ResultRow = typeof researchResult.$inferSelect;
type ConclusionRow = typeof researchConclusion.$inferSelect;
type CandidateRow = typeof researchStrategyCandidate.$inferSelect;
type ArtifactRow = typeof researchArtifact.$inferSelect;
type TemplateRow = typeof researchAnalysisTemplate.$inferSelect;
type TemplateItemRow = typeof researchAnalysisTemplateItem.$inferSelect;

function mapExperiment(r: ExperimentRow): ResearchExperiment {
  return {
    id: r.id,
    datasetVersionId: r.datasetVersionId,
    name: r.name,
    description: r.description,
    researchType: r.researchType as ResearchExperiment["researchType"],
    status: r.status as ResearchExperiment["status"],
    config: decodeJson(r.configJson, "research_experiment.configJson"),
    sampleCount: r.sampleCount,
    startedAt: toIso(r.startedAt),
    completedAt: toIso(r.completedAt),
    createdAt: toIso(r.createdAt) ?? undefined,
    updatedAt: toIso(r.updatedAt) ?? undefined,
  };
}

function mapHypothesis(r: HypothesisRow): ResearchHypothesis {
  return {
    id: r.id,
    experimentId: r.experimentId,
    name: r.name,
    statement: r.statement,
    nullHypothesis: r.nullHypothesis,
    alternativeHypothesis: r.alternativeHypothesis,
    status: r.status as ResearchHypothesis["status"],
    conclusion: r.conclusion,
    createdAt: toIso(r.createdAt) ?? undefined,
    updatedAt: toIso(r.updatedAt) ?? undefined,
  };
}

function mapRun(r: RunRow): ResearchRun {
  return {
    id: r.id,
    experimentId: r.experimentId,
    runNo: r.runNo,
    status: r.status as ResearchRun["status"],
    config: decodeJson(r.configJson, "research_run.configJson"),
    inputSnapshot: decodeJson(r.inputSnapshotJson, "research_run.inputSnapshotJson"),
    executionLog: parseResearchRunExecutionLog(r.executionLogJson),
    sampleCount: r.sampleCount,
    startedAt: toIso(r.startedAt),
    completedAt: toIso(r.completedAt),
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    createdAt: toIso(r.createdAt) ?? undefined,
  };
}

function mapAnalysis(r: AnalysisRow): ResearchAnalysis {
  return {
    id: r.id,
    runId: r.runId,
    analysisType: r.analysisType as ResearchAnalysis["analysisType"],
    name: r.name,
    target: r.target,
    config: decodeJson(r.configJson, "research_analysis.configJson"),
    status: r.status as ResearchAnalysis["status"],
    createdAt: toIso(r.createdAt) ?? undefined,
    completedAt: toIso(r.completedAt),
  };
}

function mapCondition(r: ConditionRow): ResearchAnalysisCondition {
  return {
    id: r.id,
    analysisId: r.analysisId,
    groupNo: r.groupNo,
    sortOrder: r.sortOrder,
    fieldName: r.fieldName,
    operator: r.operator as ResearchAnalysisCondition["operator"],
    value: decodeJson(r.valueJson, "research_analysis_condition.valueJson"),
    logicalOperator: r.logicalOperator as ResearchAnalysisCondition["logicalOperator"],
    groupLogicalOperator: r.groupLogicalOperator as ResearchAnalysisCondition["groupLogicalOperator"],
    createdAt: toIso(r.createdAt) ?? undefined,
  };
}

function mapMetric(r: MetricRow): ResearchAnalysisMetric {
  return {
    id: r.id,
    analysisId: r.analysisId,
    metricCode: r.metricCode,
    metricName: r.metricName,
    config: decodeJson(r.configJson, "research_analysis_metric.configJson"),
    displayOrder: r.displayOrder,
    createdAt: toIso(r.createdAt) ?? undefined,
  };
}

function mapResult(r: ResultRow): ResearchResult {
  return {
    id: r.id,
    analysisId: r.analysisId,
    resultType: r.resultType as ResearchResult["resultType"],
    dimension: decodeJson<Record<string, unknown>>(r.dimensionJson, "research_result.dimensionJson") ?? null,
    metricCode: r.metricCode,
    metricValue: r.metricValue,
    sampleCount: r.sampleCount,
    details: decodeJson(r.resultJson, "research_result.resultJson"),
    createdAt: toIso(r.createdAt) ?? undefined,
  };
}

function mapConclusion(r: ConclusionRow): ResearchConclusion {
  return {
    id: r.id,
    experimentId: r.experimentId,
    hypothesisId: r.hypothesisId,
    conclusionType: r.conclusionType as ResearchConclusion["conclusionType"],
    title: r.title,
    conclusion: r.conclusion,
    evidence: decodeJson(r.evidenceJson, "research_conclusion.evidenceJson"),
    confidence: r.confidence,
    status: r.status as ResearchConclusion["status"],
    createdAt: toIso(r.createdAt) ?? undefined,
    updatedAt: toIso(r.updatedAt) ?? undefined,
  };
}

function mapCandidate(r: CandidateRow): ResearchStrategyCandidate {
  return {
    id: r.id,
    experimentId: r.experimentId,
    conclusionId: r.conclusionId,
    strategyDefinitionId: r.strategyDefinitionId,
    name: r.name,
    description: r.description,
    entryRule: decodeJson(r.entryRuleJson, "research_strategy_candidate.entryRuleJson"),
    filterRule: decodeJson(r.filterRuleJson, "research_strategy_candidate.filterRuleJson"),
    exitRule: decodeJson(r.exitRuleJson, "research_strategy_candidate.exitRuleJson"),
    riskRule: decodeJson(r.riskRuleJson, "research_strategy_candidate.riskRuleJson"),
    parameterSpace: decodeJson(r.parameterSpaceJson, "research_strategy_candidate.parameterSpaceJson"),
    // RESEARCH-006.1 —— 研究来源快照（只读语义；写入只经 create，见 update 的边界断言）。
    sourceDatasetVersionId: r.sourceDatasetVersionId,
    sourceResearchRunId: r.sourceResearchRunId,
    sourceTraceJson: decodeJson(r.sourceTraceJson, "research_strategy_candidate.sourceTraceJson"),
    sourceDatasetDivergenceReason: r.sourceDatasetDivergenceReason,
    status: r.status as ResearchStrategyCandidate["status"],
    createdAt: toIso(r.createdAt) ?? undefined,
    updatedAt: toIso(r.updatedAt) ?? undefined,
  };
}

function mapArtifact(r: ArtifactRow): ResearchArtifact {
  return {
    id: r.id,
    experimentId: r.experimentId,
    runId: r.runId,
    artifactType: r.artifactType as ResearchArtifact["artifactType"],
    storageType: r.storageType as ResearchArtifact["storageType"],
    uri: r.uri,
    checksum: r.checksum,
    metadata: decodeJson(r.metadataJson, "research_artifact.metadataJson"),
    createdAt: toIso(r.createdAt) ?? undefined,
  };
}

function mapTemplateItem(r: TemplateItemRow): ResearchAnalysisTemplateItem {
  return {
    id: r.id,
    templateId: Number(r.templateId),
    sortOrder: r.sortOrder,
    analysisType: r.analysisType as ResearchAnalysisTemplateItem["analysisType"],
    name: r.name,
    target: r.target,
    config: decodeJson(r.configJson, "research_analysis_template_item.configJson"),
    conditionsJson: decodeJson(r.conditionsJson, "research_analysis_template_item.conditionsJson"),
    createdAt: toIso(r.createdAt) ?? undefined,
  };
}

function mapTemplate(r: TemplateRow, items: ResearchAnalysisTemplateItem[]): ResearchAnalysisTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    sourceExperimentId: r.sourceExperimentId,
    items,
    createdAt: toIso(r.createdAt) ?? undefined,
    updatedAt: toIso(r.updatedAt) ?? undefined,
  };
}


// ---------------------------------------------------------------------------
// Repository 实现
// ---------------------------------------------------------------------------

export function createDbResearchRepositories(): ResearchRepositories {
  // ---- experiment ----
  const experiments: ResearchExperimentRepository = {
    async create(input) {
      const db = await requireDb();
      await requireDatasetVersion(db, input.datasetVersionId);
      const id = await insertAndGetId(
                db.insert(researchExperiment).values({
          datasetVersionId: input.datasetVersionId,
          name: input.name,
          description: input.description ?? null,
          researchType: input.researchType,
          status: input.status ?? "DRAFT",
          configJson: encodeJson(input.config, "research_experiment.configJson"),
          sampleCount: input.sampleCount ?? null,
          startedAt: toDate(input.startedAt),
          completedAt: toDate(input.completedAt),
        }),
      );
      const created = await experiments.getById(id);
      if (!created) throw new Error(`Experiment 创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db.select().from(researchExperiment).where(eq(researchExperiment.id, id)).limit(1);
      return rows[0] ? mapExperiment(rows[0]) : undefined;
    },
    async list(filter: ResearchExperimentListFilter = {}) {
      const db = await requireDb();
      const conds = [];
      if (filter.datasetVersionId !== undefined) {
        conds.push(eq(researchExperiment.datasetVersionId, filter.datasetVersionId));
      }
      if (filter.status !== undefined) conds.push(eq(researchExperiment.status, filter.status));
      if (filter.researchType !== undefined) conds.push(eq(researchExperiment.researchType, filter.researchType));
      const rows = await (conds.length > 0
        ? db.select().from(researchExperiment).where(and(...conds))
        : db.select().from(researchExperiment)
      ).orderBy(desc(researchExperiment.createdAt), desc(researchExperiment.id));
      return rows.map(mapExperiment);
    },
    async update(id, patch) {
      const db = await requireDb();
      await requireExperimentRow(db, id);
      await db
        .update(researchExperiment)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.description === undefined ? {} : { description: patch.description }),
          ...(patch.researchType === undefined ? {} : { researchType: patch.researchType }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.config === undefined ? {} : { configJson: encodeJson(patch.config, "configJson") }),
          ...(patch.sampleCount === undefined ? {} : { sampleCount: patch.sampleCount }),
          ...(patch.startedAt === undefined ? {} : { startedAt: toDate(patch.startedAt) }),
          ...(patch.completedAt === undefined ? {} : { completedAt: toDate(patch.completedAt) }),
        })
        .where(eq(researchExperiment.id, id));
      const updated = await experiments.getById(id);
      if (!updated) throw new Error(`Experiment 更新后读取失败：${id}`);
      return updated;
    },
    async delete(id) {
      const db = await requireDb();
      const res = await db.delete(researchExperiment).where(eq(researchExperiment.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `删除失败，Experiment 不存在：${id}`,
        );
      }
    },
  };

  // ---- hypothesis ----
  const hypotheses: ResearchHypothesisRepository = {
    async create(input) {
      const db = await requireDb();
      await requireExperimentRow(db, input.experimentId);
      const id = await insertAndGetId(
                db.insert(researchHypothesis).values({
          experimentId: input.experimentId,
          name: input.name,
          statement: input.statement,
          nullHypothesis: input.nullHypothesis ?? null,
          alternativeHypothesis: input.alternativeHypothesis ?? null,
          status: input.status ?? "DRAFT",
          conclusion: input.conclusion ?? null,
        }),
      );
      const created = await hypotheses.getById(id);
      if (!created) throw new Error(`Hypothesis 创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db.select().from(researchHypothesis).where(eq(researchHypothesis.id, id)).limit(1);
      return rows[0] ? mapHypothesis(rows[0]) : undefined;
    },
    async listByExperiment(experimentId) {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchHypothesis)
        .where(eq(researchHypothesis.experimentId, experimentId))
        .orderBy(asc(researchHypothesis.id));
      return rows.map(mapHypothesis);
    },
    async update(id, patch) {
      const db = await requireDb();
      await db
        .update(researchHypothesis)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.statement === undefined ? {} : { statement: patch.statement }),
          ...(patch.nullHypothesis === undefined ? {} : { nullHypothesis: patch.nullHypothesis }),
          ...(patch.alternativeHypothesis === undefined
            ? {}
            : { alternativeHypothesis: patch.alternativeHypothesis }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.conclusion === undefined ? {} : { conclusion: patch.conclusion }),
        })
        .where(eq(researchHypothesis.id, id));
      const updated = await hypotheses.getById(id);
      if (!updated) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.HYPOTHESIS_NOT_FOUND,
          `更新失败，Hypothesis 不存在：${id}`,
        );
      }
      return updated;
    },
    async delete(id) {
      const db = await requireDb();
      const res = await db.delete(researchHypothesis).where(eq(researchHypothesis.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.HYPOTHESIS_NOT_FOUND,
          `删除失败，Hypothesis 不存在：${id}`,
        );
      }
    },
  };

  // ---- run ----
  const runs: ResearchRunRepository = {
    async create(input) {
      const db = await requireDb();
      await requireExperimentRow(db, input.experimentId);
      const existing = await db
        .select({ id: researchRun.id })
        .from(researchRun)
        .where(and(eq(researchRun.experimentId, input.experimentId), eq(researchRun.runNo, input.runNo)))
        .limit(1);
      if (existing.length > 0) {
        throw new ResearchConflictError(
          `Run 已存在：(experimentId=${input.experimentId}, runNo=${input.runNo})`,
        );
      }
      const id = await insertAndGetId(
                db.insert(researchRun).values({
          experimentId: input.experimentId,
          runNo: input.runNo,
          status: input.status ?? "PENDING",
          configJson: encodeJson(input.config, "research_run.configJson"),
          inputSnapshotJson: encodeJson(input.inputSnapshot, "research_run.inputSnapshotJson"),
          executionLogJson:
            input.executionLog === undefined || input.executionLog === null
              ? null
              : encodeJson(
                  assertResearchRunExecutionLog(input.executionLog),
                  "research_run.executionLogJson",
                ),
          sampleCount: input.sampleCount ?? null,
          startedAt: toDate(input.startedAt),
          completedAt: toDate(input.completedAt),
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
        }),
      );
      const created = await runs.getById(id);
      if (!created) throw new Error(`Run 创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db.select().from(researchRun).where(eq(researchRun.id, id)).limit(1);
      return rows[0] ? mapRun(rows[0]) : undefined;
    },
    async list(filter: ResearchRunListFilter = {}) {
      const db = await requireDb();
      const conds = [];
      if (filter.experimentId !== undefined) conds.push(eq(researchRun.experimentId, filter.experimentId));
      if (filter.status !== undefined) conds.push(eq(researchRun.status, filter.status));
      const rows = await (conds.length > 0
        ? db.select().from(researchRun).where(and(...conds))
        : db.select().from(researchRun)
      ).orderBy(asc(researchRun.experimentId), asc(researchRun.runNo));
      return rows.map(mapRun);
    },
    async nextRunNo(experimentId) {
      const db = await requireDb();
      const rows = await db
        .select({ maxNo: max(researchRun.runNo) })
        .from(researchRun)
        .where(eq(researchRun.experimentId, experimentId));
      const current = rows[0]?.maxNo;
      return current === null || current === undefined ? 1 : Number(current) + 1;
    },
    async update(id, patch) {
      const db = await requireDb();
      await db
        .update(researchRun)
        .set({
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.config === undefined ? {} : { configJson: encodeJson(patch.config, "configJson") }),
          ...(patch.inputSnapshot === undefined
            ? {}
            : { inputSnapshotJson: encodeJson(patch.inputSnapshot, "inputSnapshotJson") }),
          ...(patch.executionLog === undefined
            ? {}
            : {
                executionLogJson:
                  patch.executionLog === null
                    ? null
                    : encodeJson(
                        assertResearchRunExecutionLog(patch.executionLog),
                        "research_run.executionLogJson",
                      ),
              }),
          ...(patch.sampleCount === undefined ? {} : { sampleCount: patch.sampleCount }),
          ...(patch.startedAt === undefined ? {} : { startedAt: toDate(patch.startedAt) }),
          ...(patch.completedAt === undefined ? {} : { completedAt: toDate(patch.completedAt) }),
          ...(patch.errorCode === undefined ? {} : { errorCode: patch.errorCode }),
          ...(patch.errorMessage === undefined ? {} : { errorMessage: patch.errorMessage }),
        })
        .where(eq(researchRun.id, id));
      const updated = await runs.getById(id);
      if (!updated) {
        throw new ResearchReferenceError(RESEARCH_REFERENCE_ERROR.RUN_NOT_FOUND, `更新失败，Run 不存在：${id}`);
      }
      return updated;
    },
    async delete(id) {
      const db = await requireDb();
      const res = await db.delete(researchRun).where(eq(researchRun.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(RESEARCH_REFERENCE_ERROR.RUN_NOT_FOUND, `删除失败，Run 不存在：${id}`);
      }
    },
  };

  // ---- analysis ----
  const analyses: ResearchAnalysisRepository = {
    async create(input) {
      const db = await requireDb();
      await requireRunRow(db, input.runId);
      const id = await insertAndGetId(
                db.insert(researchAnalysis).values({
          runId: input.runId,
          analysisType: input.analysisType,
          name: input.name,
          target: input.target ?? null,
          configJson: encodeJson(input.config, "research_analysis.configJson"),
          status: input.status ?? "PENDING",
          completedAt: toDate(input.completedAt),
        }),
      );
      const created = await analyses.getById(id);
      if (!created) throw new Error(`Analysis 创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db.select().from(researchAnalysis).where(eq(researchAnalysis.id, id)).limit(1);
      return rows[0] ? mapAnalysis(rows[0]) : undefined;
    },
    async list(filter: ResearchAnalysisListFilter = {}) {
      const db = await requireDb();
      const conds = [];
      if (filter.runId !== undefined) conds.push(eq(researchAnalysis.runId, filter.runId));
      if (filter.analysisType !== undefined) conds.push(eq(researchAnalysis.analysisType, filter.analysisType));
      if (filter.status !== undefined) conds.push(eq(researchAnalysis.status, filter.status));
      const rows = await (conds.length > 0
        ? db.select().from(researchAnalysis).where(and(...conds))
        : db.select().from(researchAnalysis)
      ).orderBy(asc(researchAnalysis.id));
      return rows.map(mapAnalysis);
    },
    async update(id, patch) {
      const db = await requireDb();
      await db
        .update(researchAnalysis)
        .set({
          ...(patch.analysisType === undefined ? {} : { analysisType: patch.analysisType }),
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.target === undefined ? {} : { target: patch.target }),
          ...(patch.config === undefined ? {} : { configJson: encodeJson(patch.config, "configJson") }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.completedAt === undefined ? {} : { completedAt: toDate(patch.completedAt) }),
        })
        .where(eq(researchAnalysis.id, id));
      const updated = await analyses.getById(id);
      if (!updated) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
          `更新失败，Analysis 不存在：${id}`,
        );
      }
      return updated;
    },
    async delete(id) {
      const db = await requireDb();
      const res = await db.delete(researchAnalysis).where(eq(researchAnalysis.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
          `删除失败，Analysis 不存在：${id}`,
        );
      }
    },
  };

  // ---- condition ----
  const conditions: ResearchAnalysisConditionRepository = {
    async replaceForAnalysis(analysisId, incoming) {
      const db = await requireDb();
      await requireAnalysisRow(db, analysisId);
      assertConditionSet({
        groups: groupConditions(
          incoming.map((c, i) => ({ ...c, id: i, analysisId, createdAt: new Date().toISOString() })),
        ),
      });
      if (incoming.length > 0) {
        await db.insert(researchAnalysisCondition).values(
          incoming.map((c) => ({
            analysisId,
            groupNo: c.groupNo,
            sortOrder: c.sortOrder,
            fieldName: c.fieldName,
            operator: c.operator,
            valueJson: encodeJson(c.value, "research_analysis_condition.valueJson") ?? "null",
            logicalOperator: c.logicalOperator,
            groupLogicalOperator: c.groupLogicalOperator,
          })),
        );
      }
      return conditions.listByAnalysis(analysisId);
    },
    async listByAnalysis(analysisId) {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchAnalysisCondition)
        .where(eq(researchAnalysisCondition.analysisId, analysisId))
        .orderBy(asc(researchAnalysisCondition.groupNo), asc(researchAnalysisCondition.sortOrder));
      return rows.map(mapCondition);
    },
    async deleteByAnalysis(analysisId) {
      const db = await requireDb();
      const res = await db
        .delete(researchAnalysisCondition)
        .where(eq(researchAnalysisCondition.analysisId, analysisId));
      return res[0].affectedRows;
    },
  };

  // ---- metric ----
  const metrics: ResearchAnalysisMetricRepository = {
    async create(input) {
      const db = await requireDb();
      await requireAnalysisRow(db, input.analysisId);
      const existing = await db
        .select({ id: researchAnalysisMetric.id })
        .from(researchAnalysisMetric)
        .where(
          and(
            eq(researchAnalysisMetric.analysisId, input.analysisId),
            eq(researchAnalysisMetric.metricCode, input.metricCode),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        throw new ResearchConflictError(
          `指标重复定义：(analysisId=${input.analysisId}, metricCode=${input.metricCode})`,
        );
      }
      const id = await insertAndGetId(
                db.insert(researchAnalysisMetric).values({
          analysisId: input.analysisId,
          metricCode: input.metricCode,
          metricName: input.metricName,
          configJson: encodeJson(input.config, "research_analysis_metric.configJson"),
          displayOrder: input.displayOrder ?? 0,
        }),
      );
      const created = await metrics.getById(id);
      if (!created) throw new Error(`Metric 创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchAnalysisMetric)
        .where(eq(researchAnalysisMetric.id, id))
        .limit(1);
      return rows[0] ? mapMetric(rows[0]) : undefined;
    },
    async listByAnalysis(analysisId) {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchAnalysisMetric)
        .where(eq(researchAnalysisMetric.analysisId, analysisId))
        .orderBy(asc(researchAnalysisMetric.displayOrder), asc(researchAnalysisMetric.id));
      return rows.map(mapMetric);
    },
    async update(id, patch) {
      const db = await requireDb();
      await db
        .update(researchAnalysisMetric)
        .set({
          ...(patch.metricCode === undefined ? {} : { metricCode: patch.metricCode }),
          ...(patch.metricName === undefined ? {} : { metricName: patch.metricName }),
          ...(patch.config === undefined ? {} : { configJson: encodeJson(patch.config, "configJson") }),
          ...(patch.displayOrder === undefined ? {} : { displayOrder: patch.displayOrder }),
        })
        .where(eq(researchAnalysisMetric.id, id));
      const updated = await metrics.getById(id);
      if (!updated) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
          `更新失败，Metric 不存在：${id}`,
        );
      }
      return updated;
    },
    async delete(id) {
      const db = await requireDb();
      const res = await db.delete(researchAnalysisMetric).where(eq(researchAnalysisMetric.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
          `删除失败，Metric 不存在：${id}`,
        );
      }
    },
  };

  // ---- result ----
  const results: ResearchResultRepository = {
    async createMany(inputs) {
      const db = await requireDb();
      if (inputs.length === 0) return [];
      const analysisIds = [...new Set(inputs.map((i) => i.analysisId))];
      const found = await db
        .select({ id: researchAnalysis.id })
        .from(researchAnalysis)
        .where(inArray(researchAnalysis.id, analysisIds));
      const foundSet = new Set(found.map((r) => r.id));
      for (const input of inputs) {
        if (!foundSet.has(input.analysisId)) {
          throw new ResearchReferenceError(
            RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
            `引用不存在的 Analysis：${input.analysisId}`,
          );
        }
        assertResearchResult(input);
      }
      // 先记下插入前最大 id，插入后按 `id > before` 精确回读本批行（避免跨批次串读）。
      const beforeRows = await db.select({ maxId: max(researchResult.id) }).from(researchResult);
      const before = Number(beforeRows[0]?.maxId ?? 0) || 0;
      await db.insert(researchResult).values(
        inputs.map((input) => ({
          analysisId: input.analysisId,
          resultType: input.resultType,
          dimensionJson: encodeJson(input.dimension ?? null, "research_result.dimensionJson"),
          metricCode: input.metricCode,
          metricValue: input.metricValue ?? null,
          sampleCount: input.sampleCount ?? null,
          resultJson: encodeJson(input.details ?? null, "research_result.resultJson"),
        })),
      );
      const inserted = await db
        .select()
        .from(researchResult)
        .where(gt(researchResult.id, before))
        .orderBy(asc(researchResult.id));
      return inserted.map(mapResult);
    },
    async list(filter: ResearchResultListFilter = {}) {
      const db = await requireDb();
      const conds = [];
      if (filter.analysisId !== undefined) conds.push(eq(researchResult.analysisId, filter.analysisId));
      if (filter.metricCode !== undefined) conds.push(eq(researchResult.metricCode, filter.metricCode));
      if (filter.resultType !== undefined) conds.push(eq(researchResult.resultType, filter.resultType));
      const rows = await (conds.length > 0
        ? db.select().from(researchResult).where(and(...conds))
        : db.select().from(researchResult)
      ).orderBy(asc(researchResult.id));
      return rows.map(mapResult);
    },
    async deleteByAnalysis(analysisId) {
      const db = await requireDb();
      const res = await db.delete(researchResult).where(eq(researchResult.analysisId, analysisId));
      return res[0].affectedRows;
    },
  };

  // ---- conclusion ----
  const conclusions: ResearchConclusionRepository = {
    async create(input) {
      const db = await requireDb();
      await requireExperimentRow(db, input.experimentId);
      if (input.hypothesisId !== null && input.hypothesisId !== undefined) {
        await requireHypothesisRow(db, input.hypothesisId);
      }
      const id = await insertAndGetId(
                db.insert(researchConclusion).values({
          experimentId: input.experimentId,
          hypothesisId: input.hypothesisId ?? null,
          conclusionType: input.conclusionType,
          title: input.title,
          conclusion: input.conclusion,
          evidenceJson: encodeJson(input.evidence, "research_conclusion.evidenceJson"),
          confidence: input.confidence ?? null,
          status: input.status ?? "DRAFT",
        }),
      );
      const created = await conclusions.getById(id);
      if (!created) throw new Error(`Conclusion 创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db.select().from(researchConclusion).where(eq(researchConclusion.id, id)).limit(1);
      return rows[0] ? mapConclusion(rows[0]) : undefined;
    },
    async list(filter: ResearchConclusionListFilter = {}) {
      const db = await requireDb();
      const conds = [];
      if (filter.experimentId !== undefined) conds.push(eq(researchConclusion.experimentId, filter.experimentId));
      if (filter.hypothesisId !== undefined) conds.push(eq(researchConclusion.hypothesisId, filter.hypothesisId));
      if (filter.status !== undefined) conds.push(eq(researchConclusion.status, filter.status));
      const rows = await (conds.length > 0
        ? db.select().from(researchConclusion).where(and(...conds))
        : db.select().from(researchConclusion)
      ).orderBy(asc(researchConclusion.id));
      return rows.map(mapConclusion);
    },
    async update(id, patch) {
      const db = await requireDb();
      await db
        .update(researchConclusion)
        .set({
          ...(patch.hypothesisId === undefined ? {} : { hypothesisId: patch.hypothesisId }),
          ...(patch.conclusionType === undefined ? {} : { conclusionType: patch.conclusionType }),
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.conclusion === undefined ? {} : { conclusion: patch.conclusion }),
          ...(patch.evidence === undefined ? {} : { evidenceJson: encodeJson(patch.evidence, "evidenceJson") }),
          ...(patch.confidence === undefined ? {} : { confidence: patch.confidence }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
        })
        .where(eq(researchConclusion.id, id));
      const updated = await conclusions.getById(id);
      if (!updated) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.CONCLUSION_NOT_FOUND,
          `更新失败，Conclusion 不存在：${id}`,
        );
      }
      return updated;
    },
    async delete(id) {
      const db = await requireDb();
      const res = await db.delete(researchConclusion).where(eq(researchConclusion.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.CONCLUSION_NOT_FOUND,
          `删除失败，Conclusion 不存在：${id}`,
        );
      }
    },
  };

  // ---- candidate ----
  const candidates: ResearchStrategyCandidateRepository = {
    async create(input) {
      const db = await requireDb();
      await requireExperimentRow(db, input.experimentId);
      if (input.conclusionId !== null && input.conclusionId !== undefined) {
        await requireConclusionRow(db, input.conclusionId);
      }
      const status = input.status ?? "DRAFT";
      assertCandidateInput({
        experimentId: input.experimentId,
        name: input.name,
        status,
        strategyDefinitionId: input.strategyDefinitionId,
        filterRule: input.filterRule,
      });
      assertCandidateConversionCoherence({ status, strategyDefinitionId: input.strategyDefinitionId });
      const id = await insertAndGetId(
                db.insert(researchStrategyCandidate).values({
          experimentId: input.experimentId,
          conclusionId: input.conclusionId ?? null,
          strategyDefinitionId: input.strategyDefinitionId ?? null,
          name: input.name,
          description: input.description ?? null,
          entryRuleJson: encodeJson(input.entryRule, "entryRuleJson"),
          filterRuleJson: encodeJson(input.filterRule, "filterRuleJson"),
          exitRuleJson: encodeJson(input.exitRule, "exitRuleJson"),
          riskRuleJson: encodeJson(input.riskRule, "riskRuleJson"),
          parameterSpaceJson: encodeJson(input.parameterSpace, "parameterSpaceJson"),
          // RESEARCH-006.1 —— 研究来源快照：写入时定格，之后不再由任何路径 UPDATE。
          sourceDatasetVersionId: input.sourceDatasetVersionId ?? null,
          sourceResearchRunId: input.sourceResearchRunId ?? null,
          sourceTraceJson: encodeJson(input.sourceTraceJson, "sourceTraceJson"),
          sourceDatasetDivergenceReason: input.sourceDatasetDivergenceReason ?? null,
          status,
        }),
      );
      const created = await candidates.getById(id);
      if (!created) throw new Error(`Candidate 创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchStrategyCandidate)
        .where(eq(researchStrategyCandidate.id, id))
        .limit(1);
      return rows[0] ? mapCandidate(rows[0]) : undefined;
    },
    async list(filter: ResearchCandidateListFilter = {}) {
      const db = await requireDb();
      const conds = [];
      if (filter.experimentId !== undefined) {
        conds.push(eq(researchStrategyCandidate.experimentId, filter.experimentId));
      }
      if (filter.conclusionId !== undefined) {
        conds.push(eq(researchStrategyCandidate.conclusionId, filter.conclusionId));
      }
      if (filter.status !== undefined) conds.push(eq(researchStrategyCandidate.status, filter.status));
      if (filter.strategyDefinitionId !== undefined) {
        conds.push(eq(researchStrategyCandidate.strategyDefinitionId, filter.strategyDefinitionId));
      }
      if (filter.sourceDatasetVersionId !== undefined) {
        conds.push(
          eq(researchStrategyCandidate.sourceDatasetVersionId, filter.sourceDatasetVersionId),
        );
      }
      const rows = await (conds.length > 0
        ? db.select().from(researchStrategyCandidate).where(and(...conds))
        : db.select().from(researchStrategyCandidate)
      ).orderBy(asc(researchStrategyCandidate.id));
      return rows.map(mapCandidate);
    },
    async update(id, patch) {
      const db = await requireDb();
      // RESEARCH-006.1 —— 写入边界：patch 若携带硬拒字段（结构锚 / 来源快照）即响亮失败，
      // 不静默忽略。它们只能由 006.2/006.3 的语义化入口通过**专用方法**写入。
      assertCandidateUpdatePatchKeys(patch as Record<string, unknown>);
      const current = await candidates.getById(id);
      if (!current) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `更新失败，Candidate 不存在：${id}`,
        );
      }
      // 状态机守卫（既有语义，本 STEP 不改）：status / strategyDefinitionId 只能按
      // CANDIDATE_TRANSITIONS 迁移，且 CONVERTED 必须挂 strategyDefinitionId。
      if (patch.status !== undefined && patch.status !== current.status) {
        assertCandidateTransition(current.status, patch.status);
      }
      const nextStatus = patch.status ?? current.status;
      const nextSid =
        patch.strategyDefinitionId === undefined ? current.strategyDefinitionId : patch.strategyDefinitionId;
      assertCandidateConversionCoherence({ status: nextStatus, strategyDefinitionId: nextSid });
      await db
        .update(researchStrategyCandidate)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.description === undefined ? {} : { description: patch.description }),
          ...(patch.entryRule === undefined ? {} : { entryRuleJson: encodeJson(patch.entryRule, "entryRuleJson") }),
          ...(patch.filterRule === undefined
            ? {}
            : { filterRuleJson: encodeJson(patch.filterRule, "filterRuleJson") }),
          ...(patch.exitRule === undefined ? {} : { exitRuleJson: encodeJson(patch.exitRule, "exitRuleJson") }),
          ...(patch.riskRule === undefined ? {} : { riskRuleJson: encodeJson(patch.riskRule, "riskRuleJson") }),
          ...(patch.parameterSpace === undefined
            ? {}
            : { parameterSpaceJson: encodeJson(patch.parameterSpace, "parameterSpaceJson") }),
          ...(patch.strategyDefinitionId === undefined
            ? {}
            : { strategyDefinitionId: patch.strategyDefinitionId }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
        })
        .where(eq(researchStrategyCandidate.id, id));
      const updated = await candidates.getById(id);
      if (!updated) throw new Error(`Candidate 更新后读取失败：${id}`);
      return updated;
    },
    async delete(id) {
      const db = await requireDb();
      const res = await db.delete(researchStrategyCandidate).where(eq(researchStrategyCandidate.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `删除失败，Candidate 不存在：${id}`,
        );
      }
    },
  };

  // ---- artifact ----
  const artifacts: ResearchArtifactRepository = {
    async create(input) {
      const db = await requireDb();
      const hasExperiment = input.experimentId !== null && input.experimentId !== undefined;
      const hasRun = input.runId !== null && input.runId !== undefined;
      if (!hasExperiment && !hasRun) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ARTIFACT_SCOPE_REQUIRED,
          "Artifact 必须至少挂载 experimentId 或 runId",
        );
      }
      if (hasExperiment) await requireExperimentRow(db, input.experimentId as number);
      if (hasRun) await requireRunRow(db, input.runId as number);
      const id = await insertAndGetId(
                db.insert(researchArtifact).values({
          experimentId: input.experimentId ?? null,
          runId: input.runId ?? null,
          artifactType: input.artifactType,
          storageType: input.storageType ?? "FILE",
          uri: input.uri,
          checksum: input.checksum ?? null,
          metadataJson: encodeJson(input.metadata, "research_artifact.metadataJson"),
        }),
      );
      const created = await artifacts.getById(id);
      if (!created) throw new Error(`Artifact 创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db.select().from(researchArtifact).where(eq(researchArtifact.id, id)).limit(1);
      return rows[0] ? mapArtifact(rows[0]) : undefined;
    },
    async list(filter: ResearchArtifactListFilter = {}) {
      const db = await requireDb();
      const conds = [];
      if (filter.experimentId !== undefined) conds.push(eq(researchArtifact.experimentId, filter.experimentId));
      if (filter.runId !== undefined) conds.push(eq(researchArtifact.runId, filter.runId));
      if (filter.artifactType !== undefined) conds.push(eq(researchArtifact.artifactType, filter.artifactType));
      const rows = await (conds.length > 0
        ? db.select().from(researchArtifact).where(and(...conds))
        : db.select().from(researchArtifact)
      ).orderBy(asc(researchArtifact.id));
      return rows.map(mapArtifact);
    },
    async delete(id) {
      const db = await requireDb();
      const res = await db.delete(researchArtifact).where(eq(researchArtifact.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `删除失败，Artifact 不存在：${id}`,
        );
      }
    },
  };

  // ---- 分析模板（RESEARCH-002C）----
  /**
   * 批量取明细，避免 N+1。排序 = templateId → sortOrder → id，
   * 保证同一模板内顺序**确定**（复现性要求：同一模板两次展开得到同一批分析顺序）。
   */
  async function loadTemplateItems(
    ids: readonly number[],
  ): Promise<Map<number, ResearchAnalysisTemplateItem[]>> {
    const out = new Map<number, ResearchAnalysisTemplateItem[]>();
    if (ids.length === 0) return out;
    const db = await requireDb();
    const rows = await db
      .select()
      .from(researchAnalysisTemplateItem)
      .where(inArray(researchAnalysisTemplateItem.templateId, [...ids]))
      .orderBy(
        asc(researchAnalysisTemplateItem.templateId),
        asc(researchAnalysisTemplateItem.sortOrder),
        asc(researchAnalysisTemplateItem.id),
      );
    for (const row of rows) {
      const key = Number(row.templateId);
      const list = out.get(key) ?? [];
      list.push(mapTemplateItem(row));
      out.set(key, list);
    }
    return out;
  }

  const templates: ResearchAnalysisTemplateRepository = {
    async create(input) {
      const db = await requireDb();
      const name = input.name.trim();
      // 预检给出可读信息；下面的唯一索引是并发场景的最终护栏（人为可读 > 依赖驱动报错文案）。
      if (await templates.getByName(name)) {
        throw new ResearchConflictError(`模板名已存在：${name}`);
      }
      let id: number;
      try {
        id = await insertAndGetId(
          db.insert(researchAnalysisTemplate).values({
            name,
            description: input.description ?? null,
            sourceExperimentId: input.sourceExperimentId ?? null,
          }),
        );
      } catch (err) {
        if ((err as { code?: string } | null)?.code === "ER_DUP_ENTRY") {
          throw new ResearchConflictError(`模板名已存在：${name}`);
        }
        throw err;
      }
      for (const [index, item] of input.items.entries()) {
        await db.insert(researchAnalysisTemplateItem).values({
          templateId: id,
          sortOrder: item.sortOrder ?? index,
          analysisType: item.analysisType,
          name: item.name,
          target: item.target ?? null,
          configJson: encodeJson(item.config, "research_analysis_template_item.configJson"),
          conditionsJson: encodeJson(item.conditionsJson, "research_analysis_template_item.conditionsJson"),
        });
      }
      const created = await templates.getById(id);
      if (!created) throw new Error(`模板创建后读取失败：${id}`);
      return created;
    },
    async getById(id) {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchAnalysisTemplate)
        .where(eq(researchAnalysisTemplate.id, id))
        .limit(1);
      if (!rows[0]) return undefined;
      const items = await loadTemplateItems([id]);
      return mapTemplate(rows[0], items.get(id) ?? []);
    },
    async getByName(name) {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchAnalysisTemplate)
        .where(eq(researchAnalysisTemplate.name, name.trim()))
        .limit(1);
      if (!rows[0]) return undefined;
      const id = rows[0].id;
      const items = await loadTemplateItems([id]);
      return mapTemplate(rows[0], items.get(id) ?? []);
    },
    async list() {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(researchAnalysisTemplate)
        .orderBy(asc(researchAnalysisTemplate.name));
      const items = await loadTemplateItems(rows.map((r) => r.id));
      return rows.map((r) => mapTemplate(r, items.get(r.id) ?? []));
    },
    async delete(id) {
      const db = await requireDb();
      // 零 FK，故明细必须显式先删（不依赖数据库级联）。
      await db.delete(researchAnalysisTemplateItem).where(eq(researchAnalysisTemplateItem.templateId, id));
      const res = await db.delete(researchAnalysisTemplate).where(eq(researchAnalysisTemplate.id, id));
      if (res[0].affectedRows === 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.TEMPLATE_NOT_FOUND,
          `删除失败，模板不存在：${id}`,
        );
      }
    },
  };

  // ---- 关系查询 ----
  const relationships: ResearchRelationshipQueries = {
    async getExperimentWithRuns(experimentId) {
      const experiment = await experiments.getById(experimentId);
      if (!experiment) return undefined;
      return { experiment, runs: await runs.list({ experimentId }) };
    },
    async getRunWithAnalyses(runId) {
      const run = await runs.getById(runId);
      if (!run) return undefined;
      return { run, analyses: await analyses.list({ runId }) };
    },
    async getAnalysisBundle(analysisId) {
      const analysis = await analyses.getById(analysisId);
      if (!analysis) return undefined;
      return {
        analysis,
        conditions: await conditions.listByAnalysis(analysisId),
        metrics: await metrics.listByAnalysis(analysisId),
        results: await results.list({ analysisId }),
      };
    },
    async getExperimentConclusions(experimentId) {
      return conclusions.list({ experimentId });
    },
    async getHypothesisConclusions(hypothesisId) {
      return conclusions.list({ hypothesisId });
    },
    async getCandidatesByExperiment(experimentId) {
      return candidates.list({ experimentId });
    },
  };

  return {
    experiments,
    hypotheses,
    runs,
    analyses,
    conditions,
    metrics,
    results,
    conclusions,
    candidates,
    artifacts,
    templates,
    relationships,
  };
}
