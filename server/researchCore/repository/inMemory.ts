/**
 * RESEARCH-001 — In-Memory Repository（测试替身）。
 *
 * 用途：让 Repository 契约 / 领域不变量可在**不连数据库**的前提下被完整测试
 * （与 `server/datasetRegistry/registry.test.ts` 用 `InMemoryDatasetRegistry` 的做法一致）。
 *
 * 语义与 `db.ts` **严格对齐**：
 *   - 同样的引用完整性校验（父引用不存在 → 抛 `ResearchReferenceError`）；
 *   - 同样的唯一约束（`(experimentId, runNo)`、`(analysisId, metricCode)`）；
 *   - 同样的时间戳 / id 生成（自增）。
 *
 * `dataset_version` 属**外部表**，内存替身无法内省；通过可选的 `datasetVersionExists`
 * 注入校验器（未注入 = 不做该校验，仅限单元测试场景）。
 */

import {
  ResearchCandidateError,
  assertCandidateConversionCoherence,
  assertCandidateInput,
  assertCandidateTransition,
  assertCandidateUpdatePatchKeys,
} from "../candidates";
import { assertConditionSet, groupConditions } from "../conditions";
import { assertResearchResult } from "../results";
import {
  RESEARCH_REFERENCE_ERROR,
  ResearchConflictError,
  ResearchReferenceError,
} from "./errors";
import type {
  ResearchAnalysisBundle,
  ResearchAnalysis,
  ResearchAnalysisCondition,
  ResearchAnalysisMetric,
  ResearchAnalysisTemplate,
  ResearchAnalysisTemplateItem,
  ResearchArtifact,
  ResearchConclusion,
  ResearchExperiment,
  ResearchExperimentWithRuns,
  ResearchHypothesis,
  ResearchResult,
  ResearchRun,
  ResearchRunExecutionLogEntry,
  ResearchRunWithAnalyses,
  ResearchStrategyCandidate,
} from "../types";
import { toIso } from "../serialization";
import { assertResearchRunExecutionLog } from "../executionLog";
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

interface Store {
  experiments: Array<ResearchExperiment & { id: number }>;
  hypotheses: Array<ResearchHypothesis & { id: number }>;
  runs: Array<ResearchRun & { id: number }>;
  analyses: Array<ResearchAnalysis & { id: number }>;
  conditions: Array<ResearchAnalysisCondition & { id: number }>;
  metrics: Array<ResearchAnalysisMetric & { id: number }>;
  results: Array<ResearchResult & { id: number }>;
  conclusions: Array<ResearchConclusion & { id: number }>;
  candidates: Array<ResearchStrategyCandidate & { id: number }>;
  artifacts: Array<ResearchArtifact & { id: number }>;
  templates: Array<ResearchAnalysisTemplate & { id: number }>;
  templateItems: Array<ResearchAnalysisTemplateItem & { id: number }>;
}

export interface InMemoryResearchOptions {
  /** 外部表 `dataset_version` 的存在性校验器（注入后可测 DATASET_VERSION_NOT_FOUND）。 */
  datasetVersionExists?: (id: number) => Promise<boolean>;
  /** 固定时钟（测试确定性）；缺省用真实时间。 */
  now?: () => Date;
}

/**
 * 执行批次日志的深拷贝（含 `analysisIds` 数组）。
 * 内存替身必须与真实仓储一样阻断「调用方持引用改写内部状态」，否则测试会掩盖真实缺陷。
 */
function cloneLog(
  log: ResearchRunExecutionLogEntry[] | null | undefined,
): ResearchRunExecutionLogEntry[] | null {
  if (log === null || log === undefined) return null;
  return assertResearchRunExecutionLog(log).map((e) => ({ ...e, analysisIds: [...e.analysisIds] }));
}

/**
 * 开放 JSON 值（模板的 `config` / `conditionsJson`）的深拷贝。
 *
 * 与 `cloneLog` 同一纪律：内存替身必须阻断「调用方持引用改写内部状态」，
 * 否则测试会掩盖真实缺陷（真实 DB 每次查询都是新对象，不可能被外部改写）。
 */
function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryResearchRepositories(
  options: InMemoryResearchOptions = {},
): ResearchRepositories {
  const now = options.now ?? (() => new Date());
  const seq: Record<string, number> = {};
  const nextId = (key: string): number => {
    seq[key] = (seq[key] ?? 0) + 1;
    return seq[key];
  };

  const store: Store = {
    experiments: [],
    hypotheses: [],
    runs: [],
    analyses: [],
    conditions: [],
    metrics: [],
    results: [],
    conclusions: [],
    candidates: [],
    artifacts: [],
    templates: [],
    templateItems: [],
  };

  const stamp = (): string => toIso(now()) ?? new Date().toISOString();

  // ---- 引用完整性 ----
  async function requireExperiment(id: number): Promise<ResearchExperiment & { id: number }> {
    const found = store.experiments.find((e) => e.id === id);
    if (!found) {
      throw new ResearchReferenceError(
        RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
        `引用不存在的 Experiment：${id}`,
      );
    }
    return found;
  }
  async function requireRun(id: number): Promise<ResearchRun & { id: number }> {
    const found = store.runs.find((r) => r.id === id);
    if (!found) {
      throw new ResearchReferenceError(RESEARCH_REFERENCE_ERROR.RUN_NOT_FOUND, `引用不存在的 Run：${id}`);
    }
    return found;
  }
  async function requireAnalysis(id: number): Promise<ResearchAnalysis & { id: number }> {
    const found = store.analyses.find((a) => a.id === id);
    if (!found) {
      throw new ResearchReferenceError(
        RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
        `引用不存在的 Analysis：${id}`,
      );
    }
    return found;
  }
  async function requireHypothesis(id: number): Promise<void> {
    if (!store.hypotheses.some((h) => h.id === id)) {
      throw new ResearchReferenceError(
        RESEARCH_REFERENCE_ERROR.HYPOTHESIS_NOT_FOUND,
        `引用不存在的 Hypothesis：${id}`,
      );
    }
  }
  async function requireConclusion(id: number): Promise<void> {
    if (!store.conclusions.some((c) => c.id === id)) {
      throw new ResearchReferenceError(
        RESEARCH_REFERENCE_ERROR.CONCLUSION_NOT_FOUND,
        `引用不存在的 Conclusion：${id}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // experiment
  // -------------------------------------------------------------------------
  const experiments: ResearchExperimentRepository = {
    async create(input) {
      if (options.datasetVersionExists) {
        const ok = await options.datasetVersionExists(input.datasetVersionId);
        if (!ok) {
          throw new ResearchReferenceError(
            RESEARCH_REFERENCE_ERROR.DATASET_VERSION_NOT_FOUND,
            `引用不存在的 Dataset Version：${input.datasetVersionId}`,
          );
        }
      }
      const at = stamp();
      const row: ResearchExperiment & { id: number } = {
        ...input,
        id: nextId("experiment"),
        status: input.status ?? "DRAFT",
        researchType: input.researchType,
        sampleCount: input.sampleCount ?? null,
        description: input.description ?? null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        createdAt: at,
        updatedAt: at,
      };
      store.experiments.push(row);
      return { ...row };
    },
    async getById(id) {
      const found = store.experiments.find((e) => e.id === id);
      return found ? { ...found } : undefined;
    },
    async list(filter) {
      return store.experiments
        .filter(
          (e) =>
            (filter?.datasetVersionId === undefined || e.datasetVersionId === filter.datasetVersionId) &&
            (filter?.status === undefined || e.status === filter.status) &&
            (filter?.researchType === undefined || e.researchType === filter.researchType),
        )
        .map((e) => ({ ...e }))
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id - a.id);
    },
    async update(id, patch) {
      const found = await requireExperiment(id);
      Object.assign(found, patch, { updatedAt: stamp() });
      return { ...found };
    },
    async delete(id) {
      const idx = store.experiments.findIndex((e) => e.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `删除失败，Experiment 不存在：${id}`,
        );
      }
      store.experiments.splice(idx, 1);
    },
  };

  // -------------------------------------------------------------------------
  // hypothesis
  // -------------------------------------------------------------------------
  const hypotheses: ResearchHypothesisRepository = {
    async create(input) {
      await requireExperiment(input.experimentId);
      const at = stamp();
      const row: ResearchHypothesis & { id: number } = {
        ...input,
        id: nextId("hypothesis"),
        status: input.status ?? "DRAFT",
        conclusion: input.conclusion ?? null,
        createdAt: at,
        updatedAt: at,
      };
      store.hypotheses.push(row);
      return { ...row };
    },
    async getById(id) {
      const found = store.hypotheses.find((h) => h.id === id);
      return found ? { ...found } : undefined;
    },
    async listByExperiment(experimentId) {
      return store.hypotheses.filter((h) => h.experimentId === experimentId).map((h) => ({ ...h }));
    },
    async update(id, patch) {
      const found = store.hypotheses.find((h) => h.id === id);
      if (!found) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.HYPOTHESIS_NOT_FOUND,
          `更新失败，Hypothesis 不存在：${id}`,
        );
      }
      Object.assign(found, patch, { updatedAt: stamp() });
      return { ...found };
    },
    async delete(id) {
      const idx = store.hypotheses.findIndex((h) => h.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.HYPOTHESIS_NOT_FOUND,
          `删除失败，Hypothesis 不存在：${id}`,
        );
      }
      store.hypotheses.splice(idx, 1);
    },
  };

  // -------------------------------------------------------------------------
  // run
  // -------------------------------------------------------------------------
  const runs: ResearchRunRepository = {
    async create(input) {
      await requireExperiment(input.experimentId);
      if (store.runs.some((r) => r.experimentId === input.experimentId && r.runNo === input.runNo)) {
        throw new ResearchConflictError(
          `Run 已存在：(experimentId=${input.experimentId}, runNo=${input.runNo})`,
        );
      }
      const row: ResearchRun & { id: number } = {
        ...input,
        id: nextId("run"),
        status: input.status ?? "PENDING",
        // 执行批次日志：校验后**深拷贝**，避免调用方后续改写穿透到仓储内部
        executionLog:
          input.executionLog === undefined || input.executionLog === null
            ? null
            : assertResearchRunExecutionLog(input.executionLog).map((e) => ({ ...e, analysisIds: [...e.analysisIds] })),
        sampleCount: input.sampleCount ?? null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        createdAt: stamp(),
      };
      store.runs.push(row);
      return { ...row, executionLog: cloneLog(row.executionLog) };
    },
    async getById(id) {
      const found = store.runs.find((r) => r.id === id);
      return found ? { ...found, executionLog: cloneLog(found.executionLog) } : undefined;
    },
    async list(filter) {
      return store.runs
        .filter(
          (r) =>
            (filter?.experimentId === undefined || r.experimentId === filter.experimentId) &&
            (filter?.status === undefined || r.status === filter.status),
        )
        .map((r) => ({ ...r, executionLog: cloneLog(r.executionLog) }))
        .sort((a, b) => a.runNo - b.runNo);
    },
    async nextRunNo(experimentId) {
      const nums = store.runs.filter((r) => r.experimentId === experimentId).map((r) => r.runNo);
      return nums.length === 0 ? 1 : Math.max(...nums) + 1;
    },
    async update(id, patch) {
      const found = store.runs.find((r) => r.id === id);
      if (!found) {
        throw new ResearchReferenceError(RESEARCH_REFERENCE_ERROR.RUN_NOT_FOUND, `更新失败，Run 不存在：${id}`);
      }
      const normalized: Partial<ResearchRun> = { ...patch };
      if (patch.executionLog !== undefined) {
        normalized.executionLog =
          patch.executionLog === null ? null : cloneLog(patch.executionLog);
      }
      Object.assign(found, normalized);
      return { ...found, executionLog: cloneLog(found.executionLog) };
    },
    async delete(id) {
      const idx = store.runs.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(RESEARCH_REFERENCE_ERROR.RUN_NOT_FOUND, `删除失败，Run 不存在：${id}`);
      }
      store.runs.splice(idx, 1);
    },
  };

  // -------------------------------------------------------------------------
  // analysis
  // -------------------------------------------------------------------------
  const analyses: ResearchAnalysisRepository = {
    async create(input) {
      await requireRun(input.runId);
      const row: ResearchAnalysis & { id: number } = {
        ...input,
        id: nextId("analysis"),
        status: input.status ?? "PENDING",
        target: input.target ?? null,
        completedAt: input.completedAt ?? null,
        createdAt: stamp(),
      };
      store.analyses.push(row);
      return { ...row };
    },
    async getById(id) {
      const found = store.analyses.find((a) => a.id === id);
      return found ? { ...found } : undefined;
    },
    async list(filter: ResearchAnalysisListFilter = {}) {
      return store.analyses
        .filter(
          (a) =>
            (filter.runId === undefined || a.runId === filter.runId) &&
            (filter.analysisType === undefined || a.analysisType === filter.analysisType) &&
            (filter.status === undefined || a.status === filter.status),
        )
        .map((a) => ({ ...a }))
        .sort((a, b) => a.id - b.id);
    },
    async update(id, patch) {
      const found = store.analyses.find((a) => a.id === id);
      if (!found) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
          `更新失败，Analysis 不存在：${id}`,
        );
      }
      Object.assign(found, patch);
      return { ...found };
    },
    async delete(id) {
      const idx = store.analyses.findIndex((a) => a.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
          `删除失败，Analysis 不存在：${id}`,
        );
      }
      store.analyses.splice(idx, 1);
    },
  };

  // -------------------------------------------------------------------------
  // condition
  // -------------------------------------------------------------------------
  const conditions: ResearchAnalysisConditionRepository = {
    async replaceForAnalysis(analysisId, incoming) {
      await requireAnalysis(analysisId);
      const snapshotAt = stamp();
      // 先按扁平行聚合为条件组再校验（组号连续 / 组内 sortOrder 唯一 / 值 arity 合法）。
      assertConditionSet({
        groups: groupConditions(
          incoming.map((c, i) => ({ ...c, id: i, analysisId, createdAt: snapshotAt })),
        ),
      });
      store.conditions = store.conditions.filter((c) => c.analysisId !== analysisId);
      const rows = incoming.map((c) => {
        const row: ResearchAnalysisCondition & { id: number } = {
          ...c,
          id: nextId("condition"),
          analysisId,
          createdAt: stamp(),
        };
        store.conditions.push(row);
        return { ...row };
      });
      return rows;
    },
    async listByAnalysis(analysisId) {
      return store.conditions
        .filter((c) => c.analysisId === analysisId)
        .map((c) => ({ ...c }))
        .sort((a, b) => a.groupNo - b.groupNo || a.sortOrder - b.sortOrder);
    },
    async deleteByAnalysis(analysisId) {
      const before = store.conditions.length;
      store.conditions = store.conditions.filter((c) => c.analysisId !== analysisId);
      return before - store.conditions.length;
    },
  };

  // -------------------------------------------------------------------------
  // metric
  // -------------------------------------------------------------------------
  const metrics: ResearchAnalysisMetricRepository = {
    async create(input) {
      await requireAnalysis(input.analysisId);
      if (store.metrics.some((m) => m.analysisId === input.analysisId && m.metricCode === input.metricCode)) {
        throw new ResearchConflictError(
          `指标重复定义：(analysisId=${input.analysisId}, metricCode=${input.metricCode})`,
        );
      }
      const row: ResearchAnalysisMetric & { id: number } = {
        ...input,
        id: nextId("metric"),
        displayOrder: input.displayOrder ?? 0,
        createdAt: stamp(),
      };
      store.metrics.push(row);
      return { ...row };
    },
    async getById(id) {
      const found = store.metrics.find((m) => m.id === id);
      return found ? { ...found } : undefined;
    },
    async listByAnalysis(analysisId) {
      return store.metrics
        .filter((m) => m.analysisId === analysisId)
        .map((m) => ({ ...m }))
        .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);
    },
    async update(id, patch) {
      const found = store.metrics.find((m) => m.id === id);
      if (!found) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
          `更新失败，Metric 不存在：${id}`,
        );
      }
      Object.assign(found, patch);
      return { ...found };
    },
    async delete(id) {
      const idx = store.metrics.findIndex((m) => m.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ANALYSIS_NOT_FOUND,
          `删除失败，Metric 不存在：${id}`,
        );
      }
      store.metrics.splice(idx, 1);
    },
  };

  // -------------------------------------------------------------------------
  // result
  // -------------------------------------------------------------------------
  const results: ResearchResultRepository = {
    async createMany(inputs) {
      for (const input of inputs) {
        await requireAnalysis(input.analysisId);
        assertResearchResult(input);
      }
      const rows = inputs.map((input) => {
        const row: ResearchResult & { id: number } = {
          ...input,
          id: nextId("result"),
          dimension: input.dimension ?? null,
          metricValue: input.metricValue ?? null,
          sampleCount: input.sampleCount ?? null,
          details: input.details ?? null,
          createdAt: stamp(),
        };
        store.results.push(row);
        return { ...row };
      });
      return rows;
    },
    async list(filter: ResearchResultListFilter = {}) {
      return store.results
        .filter(
          (r) =>
            (filter.analysisId === undefined || r.analysisId === filter.analysisId) &&
            (filter.metricCode === undefined || r.metricCode === filter.metricCode) &&
            (filter.resultType === undefined || r.resultType === filter.resultType),
        )
        .map((r) => ({ ...r }));
    },
    async deleteByAnalysis(analysisId) {
      const before = store.results.length;
      store.results = store.results.filter((r) => r.analysisId !== analysisId);
      return before - store.results.length;
    },
  };

  // -------------------------------------------------------------------------
  // conclusion
  // -------------------------------------------------------------------------
  const conclusions: ResearchConclusionRepository = {
    async create(input) {
      await requireExperiment(input.experimentId);
      if (input.hypothesisId !== null && input.hypothesisId !== undefined) {
        await requireHypothesis(input.hypothesisId);
      }
      const at = stamp();
      const row: ResearchConclusion & { id: number } = {
        ...input,
        id: nextId("conclusion"),
        status: input.status ?? "DRAFT",
        hypothesisId: input.hypothesisId ?? null,
        confidence: input.confidence ?? null,
        createdAt: at,
        updatedAt: at,
      };
      store.conclusions.push(row);
      return { ...row };
    },
    async getById(id) {
      const found = store.conclusions.find((c) => c.id === id);
      return found ? { ...found } : undefined;
    },
    async list(filter: ResearchConclusionListFilter = {}) {
      return store.conclusions
        .filter(
          (c) =>
            (filter.experimentId === undefined || c.experimentId === filter.experimentId) &&
            (filter.hypothesisId === undefined || c.hypothesisId === filter.hypothesisId) &&
            (filter.status === undefined || c.status === filter.status),
        )
        .map((c) => ({ ...c }));
    },
    async update(id, patch) {
      const found = store.conclusions.find((c) => c.id === id);
      if (!found) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.CONCLUSION_NOT_FOUND,
          `更新失败，Conclusion 不存在：${id}`,
        );
      }
      Object.assign(found, patch, { updatedAt: stamp() });
      return { ...found };
    },
    async delete(id) {
      const idx = store.conclusions.findIndex((c) => c.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.CONCLUSION_NOT_FOUND,
          `删除失败，Conclusion 不存在：${id}`,
        );
      }
      store.conclusions.splice(idx, 1);
    },
  };

  // -------------------------------------------------------------------------
  // candidate
  // -------------------------------------------------------------------------
  const candidates: ResearchStrategyCandidateRepository = {
    async create(input) {
      await requireExperiment(input.experimentId);
      if (input.conclusionId !== null && input.conclusionId !== undefined) {
        await requireConclusion(input.conclusionId);
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
      const at = stamp();
      const row: ResearchStrategyCandidate & { id: number } = {
        ...input,
        id: nextId("candidate"),
        status,
        conclusionId: input.conclusionId ?? null,
        strategyDefinitionId: input.strategyDefinitionId ?? null,
        description: input.description ?? null,
        // RESEARCH-006.1 —— 研究来源快照：与 db.ts 同语义（缺省归一为 null，不落 undefined）。
        sourceDatasetVersionId: input.sourceDatasetVersionId ?? null,
        sourceResearchRunId: input.sourceResearchRunId ?? null,
        sourceTraceJson: input.sourceTraceJson ?? null,
        sourceDatasetDivergenceReason: input.sourceDatasetDivergenceReason ?? null,
        createdAt: at,
        updatedAt: at,
      };
      store.candidates.push(row);
      return { ...row };
    },
    async getById(id) {
      const found = store.candidates.find((c) => c.id === id);
      return found ? { ...found } : undefined;
    },
    async list(filter: ResearchCandidateListFilter = {}) {
      return store.candidates
        .filter(
          (c) =>
            (filter.experimentId === undefined || c.experimentId === filter.experimentId) &&
            (filter.conclusionId === undefined || c.conclusionId === filter.conclusionId) &&
            (filter.status === undefined || c.status === filter.status) &&
            (filter.strategyDefinitionId === undefined ||
              c.strategyDefinitionId === filter.strategyDefinitionId) &&
            (filter.sourceDatasetVersionId === undefined ||
              c.sourceDatasetVersionId === filter.sourceDatasetVersionId),
        )
        .map((c) => ({ ...c }));
    },
    async update(id, patch) {
      // RESEARCH-006.1 —— 与 db.ts **同一判据**：patch 携带硬拒字段（结构锚 / 来源快照）即响亮失败。
      assertCandidateUpdatePatchKeys(patch as Record<string, unknown>);
      const found = store.candidates.find((c) => c.id === id);
      if (!found) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `更新失败，Candidate 不存在：${id}`,
        );
      }
      // 状态机守卫（既有语义，本 STEP 不改）。
      if (patch.status !== undefined && patch.status !== found.status) {
        assertCandidateTransition(found.status, patch.status);
      }
      const nextStatus = patch.status ?? found.status;
      const nextSid =
        patch.strategyDefinitionId === undefined ? found.strategyDefinitionId : patch.strategyDefinitionId;
      assertCandidateConversionCoherence({ status: nextStatus, strategyDefinitionId: nextSid });
      // 逐字段显式赋值（**不是** Object.assign）：保证「哪些字段可写」在两个实现里由同一份
      // 代码形状表达，而不是依赖调用方不越界。
      if (patch.name !== undefined) found.name = patch.name;
      if (patch.description !== undefined) found.description = patch.description;
      if (patch.entryRule !== undefined) found.entryRule = patch.entryRule;
      if (patch.filterRule !== undefined) found.filterRule = patch.filterRule;
      if (patch.exitRule !== undefined) found.exitRule = patch.exitRule;
      if (patch.riskRule !== undefined) found.riskRule = patch.riskRule;
      if (patch.parameterSpace !== undefined) found.parameterSpace = patch.parameterSpace;
      if (patch.strategyDefinitionId !== undefined) found.strategyDefinitionId = patch.strategyDefinitionId;
      if (patch.status !== undefined) found.status = patch.status;
      found.updatedAt = stamp();
      return { ...found };
    },
    async delete(id) {
      const idx = store.candidates.findIndex((c) => c.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `删除失败，Candidate 不存在：${id}`,
        );
      }
      store.candidates.splice(idx, 1);
    },
    /**
     * RESEARCH-006.3 —— 语义化单列写入（`sourceDatasetDivergenceReason`）。
     * 判据与 `db.ts` **完全一致**：写一次即定；相同值幂等；不同值拒绝。
     */
    async setSourceDatasetDivergenceReason(id, reason) {
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new ResearchCandidateError("sourceDatasetDivergenceReason 必须是非空字符串");
      }
      const found = store.candidates.find((c) => c.id === id);
      if (!found) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `写入来源分歧原因失败，Candidate 不存在：${id}`,
        );
      }
      const trimmed = reason.trim();
      const existing = found.sourceDatasetDivergenceReason ?? null;
      if (existing !== null) {
        if (existing === trimmed) return { ...found };
        throw new ResearchCandidateError(
          `Candidate #${id} 已记录来源分歧原因（${existing}），不可改写为 ${trimmed}`,
        );
      }
      found.sourceDatasetDivergenceReason = trimmed;
      found.updatedAt = stamp();
      return { ...found };
    },
  };

  // -------------------------------------------------------------------------
  // artifact
  // -------------------------------------------------------------------------
  const artifacts: ResearchArtifactRepository = {
    async create(input) {
      const hasExperiment = input.experimentId !== null && input.experimentId !== undefined;
      const hasRun = input.runId !== null && input.runId !== undefined;
      if (!hasExperiment && !hasRun) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.ARTIFACT_SCOPE_REQUIRED,
          "Artifact 必须至少挂载 experimentId 或 runId",
        );
      }
      if (hasExperiment) await requireExperiment(input.experimentId as number);
      if (hasRun) await requireRun(input.runId as number);
      const row: ResearchArtifact & { id: number } = {
        ...input,
        id: nextId("artifact"),
        storageType: input.storageType ?? "FILE",
        experimentId: input.experimentId ?? null,
        runId: input.runId ?? null,
        checksum: input.checksum ?? null,
        createdAt: stamp(),
      };
      store.artifacts.push(row);
      return { ...row };
    },
    async getById(id) {
      const found = store.artifacts.find((a) => a.id === id);
      return found ? { ...found } : undefined;
    },
    async list(filter: ResearchArtifactListFilter = {}) {
      return store.artifacts
        .filter(
          (a) =>
            (filter.experimentId === undefined || a.experimentId === filter.experimentId) &&
            (filter.runId === undefined || a.runId === filter.runId) &&
            (filter.artifactType === undefined || a.artifactType === filter.artifactType),
        )
        .map((a) => ({ ...a }));
    },
    async delete(id) {
      const idx = store.artifacts.findIndex((a) => a.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND,
          `删除失败，Artifact 不存在：${id}`,
        );
      }
      store.artifacts.splice(idx, 1);
    },
  };

  // -------------------------------------------------------------------------
  // 分析模板（RESEARCH-002C）
  // -------------------------------------------------------------------------
  function templateItemsOf(templateId: number): ResearchAnalysisTemplateItem[] {
    return store.templateItems
      .filter((i) => i.templateId === templateId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((i) => ({
        ...i,
        config: cloneJson(i.config),
        conditionsJson: cloneJson(i.conditionsJson),
      }));
  }

  function withItems(row: ResearchAnalysisTemplate & { id: number }): ResearchAnalysisTemplate {
    return { ...row, items: templateItemsOf(row.id) };
  }

  const templates: ResearchAnalysisTemplateRepository = {
    async create(input) {
      const name = input.name.trim();
      if (store.templates.some((t) => t.name === name)) {
        throw new ResearchConflictError(`模板名已存在：${name}`);
      }
      const at = stamp();
      const row: ResearchAnalysisTemplate & { id: number } = {
        id: nextId("template"),
        name,
        description: input.description ?? null,
        sourceExperimentId: input.sourceExperimentId ?? null,
        items: [],
        createdAt: at,
        updatedAt: at,
      };
      store.templates.push(row);
      input.items.forEach((item, index) => {
        store.templateItems.push({
          id: nextId("templateItem"),
          templateId: row.id,
          sortOrder: item.sortOrder ?? index,
          analysisType: item.analysisType,
          name: item.name,
          target: item.target ?? null,
          config: cloneJson(item.config),
          conditionsJson: cloneJson(item.conditionsJson),
          createdAt: at,
        });
      });
      return withItems(row);
    },
    async getById(id) {
      const found = store.templates.find((t) => t.id === id);
      return found ? withItems(found) : undefined;
    },
    async getByName(name) {
      const found = store.templates.find((t) => t.name === name.trim());
      return found ? withItems(found) : undefined;
    },
    async list() {
      return [...store.templates]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => withItems(t));
    },
    async delete(id) {
      const idx = store.templates.findIndex((t) => t.id === id);
      if (idx < 0) {
        throw new ResearchReferenceError(
          RESEARCH_REFERENCE_ERROR.TEMPLATE_NOT_FOUND,
          `删除失败，模板不存在：${id}`,
        );
      }
      store.templates.splice(idx, 1);
      // 零 FK，故明细显式删除（与真实实现同语义）。
      for (let i = store.templateItems.length - 1; i >= 0; i -= 1) {
        if (store.templateItems[i]!.templateId === id) store.templateItems.splice(i, 1);
      }
    },
  };

  // -------------------------------------------------------------------------
  // 关系查询
  // -------------------------------------------------------------------------
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
