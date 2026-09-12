/**
 * RESEARCH-002 — Research Engine tRPC Router。
 *
 * 遵循项目既有 API 风格（与 `datasetRegistry/router.ts` 一致）：
 *   - 只读端点用 `publicProcedure`，写端点与执行端点用 `adminProcedure`；
 *   - 未命中一律 `NOT_FOUND`，领域错误映射为稳定 tRPC code；
 *   - **前端绝不直连数据库**：所有读写都经 Research Repository；
 *   - Router 内**不做任何统计计算**，统计只在 ResearchEngine 内部发生。
 *
 * 端点（对应指令 §16 的路径清单，按项目 tRPC 命名规范呈现）：
 *   POST /research/experiments/:id/runs  → createRun + runEngine
 *   GET  /research/experiments/:id       → getExperiment（含 runs / hypotheses / conclusions）
 *   GET  /research/runs/:id              → getRun（含 analyses）
 *   GET  /research/analyses/:id          → getAnalysis（bundle：conditions / metrics / results）
 *   GET  /research/analyses/:id/results  → getAnalysisResults
 *   GET  /research/experiments/:id/conclusions → listConclusions
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { DbDatasetRegistry } from "./datasetRegistry/db";
import {
  RESEARCH_ANALYSIS_TYPES,
  RESEARCH_CONDITION_OPERATORS,
  RESEARCH_EXPERIMENT_STATUSES,
  RESEARCH_GROUP_LOGICAL_OPERATORS,
  RESEARCH_HYPOTHESIS_STATUSES,
  RESEARCH_LOGICAL_OPERATORS,
  RESEARCH_TYPES,
  ResearchConflictError,
  createDbResearchRepositories,
  type ResearchAnalysisType,
  type ResearchRepositories,
} from "./researchCore";
import { RegistryResearchDatasetReader, type ResearchDatasetReader } from "./researchEngine/datasetReader";
import { ResearchEngine } from "./researchEngine/engine";
import { ResearchEngineError } from "./researchEngine/errors";
import { createAnalysesBatch } from "./researchEngine/batchCreate";
import {
  assertTemplateDraft,
  batchItemsToTemplateItems,
  templateItemsToBatchItems,
} from "./researchEngine/templates";
import {
  deleteAnalysisCascade,
  deleteExperimentCascade,
  deleteHypothesisCascade,
  deleteRunCascade,
  describeDeletionCounts,
  replaceConditionsAndInvalidate,
} from "./researchEngine/maintenance";
import { DEFAULT_CONCLUSION_POLICY, type ConclusionPolicy } from "./researchEngine/conclusion";
import { ResearchVariableCatalog } from "./researchEngine/variables";
import { DEFAULT_EVENT_PAGE_SIZE, DEFAULT_MAX_SAMPLES } from "./researchEngine/sampleSet";

// ---------------------------------------------------------------------------
// 入参 schema
// ---------------------------------------------------------------------------

const conditionInputSchema = z.object({
  groupNo: z.number().int().min(0),
  sortOrder: z.number().int().min(0),
  fieldName: z.string().min(1),
  operator: z.enum(RESEARCH_CONDITION_OPERATORS),
  value: z.unknown(),
  logicalOperator: z.enum(RESEARCH_LOGICAL_OPERATORS).optional(),
  groupLogicalOperator: z.enum(RESEARCH_GROUP_LOGICAL_OPERATORS).optional(),
});

/**
 * 单个分析的定义（**单建与批量建共用同一份 schema**）。
 *
 * 共用是刻意的：两条路径若各写一份，就会出现「单建能过、批量过不了」或更糟的
 * 「两条路径写入的口径不一样」。这里唯一的分叉是 `runId`（批量在顶层）与
 * `metrics`（批量不支持 —— 前端本就不登记指标定义，见 `CreateAnalysisDialog` 的说明）。
 *
 * ⚠️ `analysisType` 用**领域全集**而不是「已实现子集」：未实现的类型（DISTRIBUTION 等）
 * 交给批量预检报出「已实现：…」这种可读原因，而不是让 zod 抛一条看不出所以然的类型错误。
 */
const createAnalysisItemSchema = z.object({
  analysisType: z.enum(RESEARCH_ANALYSIS_TYPES),
  name: z.string().min(1).max(200),
  target: z.string().optional(),
  config: z.unknown().optional(),
  /** 可选：同时写入条件（仅 CONDITIONAL 必须有）。 */
  conditions: z.array(conditionInputSchema).optional(),
});

export interface ResearchEngineRouterDeps {
  repos: ResearchRepositories;
  reader: ResearchDatasetReader;
  /** 结论判定阈值覆盖。 */
  conclusionPolicy?: Partial<ConclusionPolicy>;
  eventPageSize?: number;
  maxSamples?: number;
}

const conclusionPolicySchema = z
  .object({
    alpha: z.number().gt(0).lt(1).optional(),
    materialityAbs: z.number().min(0).optional(),
    minSampleCount: z.number().int().min(1).optional(),
    stabilityMinConsistentRatio: z.number().min(0).max(1).optional(),
    strongSampleMultiple: z.number().min(1).optional(),
  })
  .optional();

// ---------------------------------------------------------------------------
// Router 构造
// ---------------------------------------------------------------------------

export function buildResearchEngineRouter(deps: ResearchEngineRouterDeps) {
  const { repos, reader } = deps;

  const engine = new ResearchEngine({
    repos,
    reader,
    ...(deps.conclusionPolicy !== undefined ? { conclusionPolicy: deps.conclusionPolicy } : {}),
    ...(deps.eventPageSize !== undefined ? { eventPageSize: deps.eventPageSize } : {}),
    ...(deps.maxSamples !== undefined ? { maxSamples: deps.maxSamples } : {}),
  });

  /** 领域错误 → 稳定 tRPC code。 */
  function toTrpcError(e: unknown): never {
    if (e instanceof ResearchEngineError) {
      switch (e.code) {
        case "EXPERIMENT_NOT_FOUND":
        case "RUN_NOT_FOUND":
        case "HYPOTHESIS_NOT_FOUND":
        case "ANALYSIS_NOT_FOUND":
        case "DATASET_VERSION_NOT_FOUND":
        // ---- 分析模板：不存在 ----
        case "TEMPLATE_NOT_FOUND":
          throw new TRPCError({ code: "NOT_FOUND", message: e.message });
        case "RUN_NOT_PENDING":
        case "RUN_EXPERIMENT_MISMATCH":
        case "DELETE_CONFLICT":
        // ---- 增量补跑：状态不允许 ----
        case "RUN_ALREADY_RUNNING":
        case "ANALYSIS_NOT_RUNNABLE":
        case "NO_RUNNABLE_ANALYSES":
        case "DATASET_VERSION_DRIFT":
        // ---- 分析模板：重名 ----
        case "TEMPLATE_NAME_CONFLICT":
          throw new TRPCError({ code: "CONFLICT", message: e.message });
        case "DATASET_VERSION_NOT_READY":
        case "REGIME_PROVIDER_UNAVAILABLE":
        case "EMPTY_SAMPLE_SET":
        case "DATASET_TOO_LARGE":
        // 增量补跑：缺少整轮执行落定的基准快照（应先整轮执行）
        case "RUN_SNAPSHOT_MISSING":
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        case "INVALID_ANALYSIS_CONFIG":
        case "UNKNOWN_VARIABLE":
        case "VARIABLE_ROLE_VIOLATION":
        case "UNKNOWN_ANALYSIS_TYPE":
        // 分段（两窗）关系：两窗取值区间重叠 → 拒绝执行（见 analysisConfig.ts#resolveSegmentWindows）
        case "WINDOW_OVERLAP":
        case "NO_ANALYSES":
        // 增量补跑：指定的分析不属于该 Run
        case "ANALYSIS_NOT_IN_RUN":
        // 批量建分析：预检未通过（整批拒绝）/ 超出单批上限
        case "BATCH_VALIDATION_FAILED":
        case "BATCH_TOO_LARGE":
        // 分析模板：内容不合法
        case "TEMPLATE_VALIDATION_FAILED":
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        default:
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
      }
    }
    throw e;
  }

  async function requireVersionContext(datasetVersionId: number) {
    const context = await reader.getVersionContext(datasetVersionId);
    if (!context) {
      throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Dataset Version：${datasetVersionId}` });
    }
    return context;
  }

  async function requireExperiment(experimentId: number) {
    const experiment = await repos.experiments.getById(experimentId);
    if (!experiment) {
      throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Experiment：${experimentId}` });
    }
    return experiment;
  }

  return router({
    // ---- 变量目录（供前端构造合法配置；一次拿到特征 / 结果 / 维度）----
    listVariables: publicProcedure
      .input(z.object({ datasetVersionId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const context = await requireVersionContext(input.datasetVersionId);
        const pathHorizons = context.pathRelativeDayRange
          ? Array.from(
              { length: context.pathRelativeDayRange.max - context.pathRelativeDayRange.min + 1 },
              (_, i) => context.pathRelativeDayRange!.min + i,
            )
          : [];
        const catalog = new ResearchVariableCatalog(context.horizons, pathHorizons);
        return {
          datasetVersion: context,
          features: catalog.listFeatures(),
          outcomes: catalog.listOutcomes(),
          dimensions: ["year", "month", "quarter", "board", "market", "industry"],
          /** regime 维度需要注入标签源；当前 Dataset 未提供，故不列入默认可选维度。 */
          unavailableDimensions: [{ key: "regime", reason: "当前 Dataset 未提供市场环境列，且未接入 RegimeTagProvider" }],
        };
      }),

    // ---- Experiment ----
    createExperiment: adminProcedure
      .input(
        z.object({
          datasetVersionId: z.number().int().positive(),
          name: z.string().min(1).max(200),
          description: z.string().optional(),
          researchType: z.enum(RESEARCH_TYPES),
          config: z.unknown().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        await requireVersionContext(input.datasetVersionId);
        return repos.experiments.create({
          datasetVersionId: input.datasetVersionId,
          name: input.name,
          description: input.description ?? null,
          researchType: input.researchType,
          config: input.config ?? null,
        });
      }),

    listExperiments: publicProcedure
      .input(
        z
          .object({
            datasetVersionId: z.number().int().positive().optional(),
            status: z.enum(RESEARCH_EXPERIMENT_STATUSES).optional(),
            researchType: z.enum(RESEARCH_TYPES).optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => repos.experiments.list(input ?? {})),

    /** GET /research/experiments/:id */
    getExperiment: publicProcedure
      .input(z.object({ experimentId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const experiment = await repos.experiments.getById(input.experimentId);
        if (!experiment) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Experiment：${input.experimentId}` });
        }
        const [withRuns, hypotheses, conclusions] = await Promise.all([
          repos.relationships.getExperimentWithRuns(input.experimentId),
          repos.hypotheses.listByExperiment(input.experimentId),
          repos.relationships.getExperimentConclusions(input.experimentId),
        ]);
        return {
          experiment,
          runs: withRuns?.runs ?? [],
          hypotheses,
          conclusions,
          datasetVersion: await reader.getVersionContext(experiment.datasetVersionId),
        };
      }),

    /** 更新实验元信息（`datasetVersionId` 创建即冻结，不可改）。 */
    updateExperiment: adminProcedure
      .input(
        z.object({
          experimentId: z.number().int().positive(),
          name: z.string().min(1).max(200).optional(),
          description: z.string().nullable().optional(),
          researchType: z.enum(RESEARCH_TYPES).optional(),
          status: z.enum(RESEARCH_EXPERIMENT_STATUSES).optional(),
          config: z.unknown().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        await requireExperiment(input.experimentId);
        const patch: Record<string, unknown> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.researchType !== undefined) patch.researchType = input.researchType;
        if (input.status !== undefined) patch.status = input.status;
        if (input.config !== undefined) patch.config = input.config;
        if (Object.keys(patch).length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "未提供任何可更新字段" });
        }
        return repos.experiments.update(input.experimentId, patch);
      }),

    /**
     * 删除实验（leaf-first 全量级联）。
     * 本项目零数据库外键 → 级联必须显式执行，故**只提供这一个**整实验删除入口；
     * 返回逐实体删除计数，UI 如实回显删了什么。
     */
    deleteExperiment: adminProcedure
      .input(z.object({ experimentId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          const counts = await deleteExperimentCascade(repos, input.experimentId);
          return { counts, summary: describeDeletionCounts(counts) };
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- Hypothesis ----
    createHypothesis: adminProcedure
      .input(
        z.object({
          experimentId: z.number().int().positive(),
          name: z.string().min(1).max(200),
          statement: z.string().min(1),
          nullHypothesis: z.string().optional(),
          alternativeHypothesis: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) =>
        repos.hypotheses.create({
          experimentId: input.experimentId,
          name: input.name,
          statement: input.statement,
          nullHypothesis: input.nullHypothesis ?? null,
          alternativeHypothesis: input.alternativeHypothesis ?? null,
        }),
      ),

    /** 更新假设（`experimentId` 不可改）。 */
    updateHypothesis: adminProcedure
      .input(
        z.object({
          hypothesisId: z.number().int().positive(),
          name: z.string().min(1).max(200).optional(),
          statement: z.string().min(1).optional(),
          nullHypothesis: z.string().nullable().optional(),
          alternativeHypothesis: z.string().nullable().optional(),
          status: z.enum(RESEARCH_HYPOTHESIS_STATUSES).optional(),
          conclusion: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const existing = await repos.hypotheses.getById(input.hypothesisId);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Hypothesis：${input.hypothesisId}` });
        }
        const patch: Record<string, unknown> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.statement !== undefined) patch.statement = input.statement;
        if (input.nullHypothesis !== undefined) patch.nullHypothesis = input.nullHypothesis;
        if (input.alternativeHypothesis !== undefined) patch.alternativeHypothesis = input.alternativeHypothesis;
        if (input.status !== undefined) patch.status = input.status;
        if (input.conclusion !== undefined) patch.conclusion = input.conclusion;
        if (Object.keys(patch).length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "未提供任何可更新字段" });
        }
        return repos.hypotheses.update(input.hypothesisId, patch);
      }),

    /** 删除假设（连带删除挂在它下面的结论）。 */
    deleteHypothesis: adminProcedure
      .input(z.object({ hypothesisId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          const counts = await deleteHypothesisCascade(repos, input.hypothesisId);
          return { counts, summary: describeDeletionCounts(counts) };
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- Run ----
    /** POST /research/experiments/:id/runs（只创建，不执行） */
    createRun: adminProcedure
      .input(
        z.object({
          experimentId: z.number().int().positive(),
          runNo: z.number().int().positive().optional(),
          config: z.unknown().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const experiment = await repos.experiments.getById(input.experimentId);
        if (!experiment) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Experiment：${input.experimentId}` });
        }
        const runNo = input.runNo ?? (await repos.runs.nextRunNo(input.experimentId));
        return repos.runs.create({
          experimentId: input.experimentId,
          runNo,
          config: input.config ?? null,
        });
      }),

    listRuns: publicProcedure
      .input(z.object({ experimentId: z.number().int().positive().optional() }).optional())
      .query(async ({ input }) => repos.runs.list(input ?? {})),

    /** GET /research/runs/:id */
    getRun: publicProcedure
      .input(z.object({ runId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const run = await repos.runs.getById(input.runId);
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Run：${input.runId}` });
        const withAnalyses = await repos.relationships.getRunWithAnalyses(input.runId);
        return { run, analyses: withAnalyses?.analyses ?? [] };
      }),

    /**
     * 删除 Run（+ 其全部分析与子行 + **证据指向这些分析的**结论）。
     *
     * 结论为实验级实体（无 runId）→ 归属靠证据里的 analysisId 精确判定；
     * 提不出 analysisId 的结论**不删**，以 `unattributedConclusions` 如实上报。
     */
    deleteRun: adminProcedure
      .input(z.object({ runId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          const result = await deleteRunCascade(repos, input.runId);
          return { ...result, summary: describeDeletionCounts(result.counts) };
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /** 执行 Run（真实读取 Dataset → 计算 → 落结果 → 生成结论）。 */
    runEngine: adminProcedure
      .input(
        z.object({
          experimentId: z.number().int().positive(),
          runId: z.number().int().positive(),
          conclusionPolicy: conclusionPolicySchema,
        }),
      )
      .mutation(async ({ input }) => {
        const runtimeEngine = input.conclusionPolicy
          ? new ResearchEngine({
              repos,
              reader,
              conclusionPolicy: input.conclusionPolicy,
              ...(deps.eventPageSize !== undefined ? { eventPageSize: deps.eventPageSize } : {}),
              ...(deps.maxSamples !== undefined ? { maxSamples: deps.maxSamples } : {}),
            })
          : engine;
        try {
          return await runtimeEngine.run({ experimentId: input.experimentId, runId: input.runId });
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * 增量补跑：在**已整轮执行过**的 Run 上，只补算「尚无有效结果」的分析
     * （PENDING / FAILED / CANCELLED），**不重跑已完成的**。
     *
     * 与 `runEngine` 的分工：
     *   - `runEngine` = 整轮执行（Run 处于 PENDING / FAILED / CANCELLED 时才有意义，
     *     会覆盖该 Run 全部分析的结果）；
     *   - `runIncremental` = 补跑（Run 已完成整轮后，新加的分析没有结果可看时的唯一出路）。
     *
     * 复用 Run 冻结的基准（Dataset Version + 日期窗口取自 `inputSnapshot`），
     * 因此补跑结果与原批次**可比**；并在 `run.executionLog` 追加一条批次记录。
     * ⚠️ 增量批次**不生成结论**（`AnalysisSummary` 未落库，无法重建已跳过分析的历史摘要）；
     * 返回值里的 `conclusionSkippedReason` 会说明这一点，既有结论保持不动。
     */
    runIncremental: adminProcedure
      .input(
        z.object({
          experimentId: z.number().int().positive(),
          runId: z.number().int().positive(),
          /** 省略 = 该 Run 下全部「尚无有效结果」的分析。 */
          analysisIds: z.array(z.number().int().positive()).min(1).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          return await engine.runIncremental({
            experimentId: input.experimentId,
            runId: input.runId,
            ...(input.analysisIds !== undefined ? { analysisIds: input.analysisIds } : {}),
          });
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- Analysis ----
    createAnalysis: adminProcedure
      .input(
        createAnalysisItemSchema.extend({
          runId: z.number().int().positive(),
          /** 可选：同时登记指标定义。 */
          metrics: z
            .array(z.object({ metricCode: z.string().min(1), metricName: z.string().min(1), displayOrder: z.number().int().min(0).optional() }))
            .optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const run = await repos.runs.getById(input.runId);
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Run：${input.runId}` });
        const analysis = await repos.analyses.create({
          runId: input.runId,
          analysisType: input.analysisType,
          name: input.name,
          target: input.target ?? null,
          config: input.config ?? null,
        });
        if (input.conditions && input.conditions.length > 0) {
          await repos.conditions.replaceForAnalysis(
            analysis.id!,
            input.conditions.map((c) => ({
              groupNo: c.groupNo,
              sortOrder: c.sortOrder,
              fieldName: c.fieldName,
              operator: c.operator,
              value: c.value,
              logicalOperator: c.logicalOperator ?? "AND",
              groupLogicalOperator: c.groupLogicalOperator ?? "AND",
            })),
          );
        }
        for (const metric of input.metrics ?? []) {
          await repos.metrics.create({
            analysisId: analysis.id!,
            metricCode: metric.metricCode,
            metricName: metric.metricName,
            displayOrder: metric.displayOrder ?? 0,
          });
        }
        return analysis;
      }),

    /**
     * POST /research/runs/:id/analyses/batch —— **批量建分析**（RESEARCH-002C）。
     *
     * 解决的问题：研究里大量重复的是「类型 × 目标 × 视界」矩阵，逐个填对话框成本极高。
     *
     * 语义（与单建逐项一致，只多出「一次多个」）：
     *   - **预检整批拒绝**：任一项不合法则 `BATCH_VALIDATION_FAILED`，**一个都不建**；
     *   - **执行期部分失败如实回显**：`created` / `failed` 各带 `index`，
     *     前端可把结果精确映射回预览清单的对应行；
     *   - `created` 中每一项都**完整可用**（条件写入失败会补偿删除该分析）；
     *   - **不自动执行** —— 建完仍需显式触发整轮执行或增量补跑。
     *
     * `metrics` 不支持（前端本就不登记指标定义，指标由引擎逐行写入结果）。
     */
    createAnalyses: adminProcedure
      .input(
        z.object({
          runId: z.number().int().positive(),
          items: z.array(createAnalysisItemSchema).min(1),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          return await createAnalysesBatch(repos, input.runId, input.items);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    listAnalyses: publicProcedure
      .input(
        z
          .object({
            runId: z.number().int().positive().optional(),
            analysisType: z.enum(RESEARCH_ANALYSIS_TYPES).optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => repos.analyses.list(input ?? {})),

    /** GET /research/analyses/:id（bundle：分析 + 条件 + 指标定义 + 结果） */
    getAnalysis: publicProcedure
      .input(z.object({ analysisId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const bundle = await repos.relationships.getAnalysisBundle(input.analysisId);
        if (!bundle) throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Analysis：${input.analysisId}` });
        return bundle;
      }),

    /** GET /research/analyses/:id/results */
    getAnalysisResults: publicProcedure
      .input(
        z.object({
          analysisId: z.number().int().positive(),
          metricCode: z.string().optional(),
          resultType: z.enum(["SCALAR", "GROUPED", "SERIES"]).optional(),
        }),
      )
      .query(async ({ input }) =>
        repos.results.list({
          analysisId: input.analysisId,
          ...(input.metricCode !== undefined ? { metricCode: input.metricCode } : {}),
          ...(input.resultType !== undefined ? { resultType: input.resultType } : {}),
        }),
      ),

    /** 更新分析元信息（`runId` 不可改；口径变更请走 `setAnalysisConditions`）。 */
    updateAnalysis: adminProcedure
      .input(
        z.object({
          analysisId: z.number().int().positive(),
          name: z.string().min(1).max(200).optional(),
          target: z.string().nullable().optional(),
          config: z.unknown().optional(),
          status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const existing = await repos.analyses.getById(input.analysisId);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Analysis：${input.analysisId}` });
        }
        const patch: Record<string, unknown> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.target !== undefined) patch.target = input.target;
        if (input.config !== undefined) patch.config = input.config;
        if (input.status !== undefined) patch.status = input.status;
        if (Object.keys(patch).length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "未提供任何可更新字段" });
        }
        return repos.analyses.update(input.analysisId, patch);
      }),

    /** 删除单个分析（+ 条件 / 指标定义 / 结果 + 证据指向它的结论）。 */
    deleteAnalysis: adminProcedure
      .input(z.object({ analysisId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          const counts = await deleteAnalysisCascade(repos, input.analysisId);
          return { counts, summary: describeDeletionCounts(counts) };
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * 整批替换分析条件 —— **并且让旧产物失效**。
     *
     * 只替换条件不清理旧结果，会让 UI 继续展示「用旧口径算出的数字」，这是比
     * 抛错更危险的静默不实。故本端点做三件事：守卫（RUNNING 拒绝）→ 替换条件 →
     * 删旧结果 + 删失效结论 + 把 Analysis/Run 回退为 PENDING（于是可直接重跑）。
     */
    setAnalysisConditions: adminProcedure
      .input(
        z.object({
          analysisId: z.number().int().positive(),
          conditions: z.array(conditionInputSchema),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          return await replaceConditionsAndInvalidate(repos, input.analysisId, input.conditions);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- Conclusion / Candidate ----
    /** GET /research/experiments/:id/conclusions */
    listConclusions: publicProcedure
      .input(z.object({ experimentId: z.number().int().positive(), hypothesisId: z.number().int().positive().optional() }))
      .query(async ({ input }) =>
        repos.conclusions.list({
          experimentId: input.experimentId,
          ...(input.hypothesisId !== undefined ? { hypothesisId: input.hypothesisId } : {}),
        }),
      ),

    listCandidates: publicProcedure
      .input(z.object({ experimentId: z.number().int().positive() }))
      .query(async ({ input }) => repos.relationships.getCandidatesByExperiment(input.experimentId)),

    /** 引擎默认策略（供前端展示阈值口径）。 */
    getConclusionPolicy: publicProcedure.query(() => DEFAULT_CONCLUSION_POLICY),

    // ---- 分析模板（RESEARCH-002C）----
    /**
     * GET /research/analysis-templates —— 模板清单（含明细）。
     *
     * 模板数量天然很小且前端要展示「含 N 个分析」，故**不分页**；空库返回 `[]`。
     */
    listAnalysisTemplates: publicProcedure.query(async () => repos.templates.list()),

    /**
     * POST /research/analysis-templates —— 把一组分析存成可跨实验复用的模板。
     *
     * 校验（名非空 / ≤120、至少一项、类型已实现、CONDITIONAL 必须有条件）不通过即
     * `TEMPLATE_VALIDATION_FAILED`，**一个模板都不写**；重名 → `TEMPLATE_NAME_CONFLICT`。
     */
    createAnalysisTemplate: adminProcedure
      .input(
        z.object({
          name: z.string().min(1).max(120),
          description: z.string().max(2000).optional(),
          sourceExperimentId: z.number().int().positive().optional(),
          items: z.array(createAnalysisItemSchema).min(1),
        }),
      )
      .mutation(async ({ input }) => {
        assertTemplateDraft({ name: input.name, items: input.items });
        try {
          return await repos.templates.create({
            name: input.name.trim(),
            description: input.description ?? null,
            sourceExperimentId: input.sourceExperimentId ?? null,
            items: batchItemsToTemplateItems(input.items).map((item, index) => ({
              sortOrder: index,
              // 上面 `assertTemplateDraft` 已断言过类型属于「已实现子集」，
              // 这里只是把 Draft 的宽松 `string` 收回领域联合类型。
              analysisType: item.analysisType as ResearchAnalysisType,
              name: item.name,
              target: item.target ?? null,
              config: item.config,
              conditionsJson: item.conditions ?? null,
            })),
          });
        } catch (e) {
          if (e instanceof ResearchConflictError) {
            toTrpcError(new ResearchEngineError("TEMPLATE_NAME_CONFLICT", e.message));
          }
          toTrpcError(e);
        }
      }),

    /** DELETE /research/analysis-templates/:id —— 删模板（连带明细）。 */
    deleteAnalysisTemplate: adminProcedure
      .input(z.object({ templateId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const existing = await repos.templates.getById(input.templateId);
        if (!existing) {
          toTrpcError(new ResearchEngineError("TEMPLATE_NOT_FOUND", `未找到分析模板：${input.templateId}`));
        }
        await repos.templates.delete(input.templateId);
        return { deleted: true, templateId: input.templateId, names: existing.items.map((i) => i.name) };
      }),

    /**
     * POST /research/analysis-templates/:id/apply —— 把模板展开成某个 Run 下的一批分析。
     *
     * 复用批量创建路径（预检整批拒绝 / 部分失败如实回显 / 补偿删除全部一致），
     * 因此这里有两条**必须先满足**的前置：模板存在且明细非空。
     * **不自动执行** —— 展开完仍需显式触发整轮执行或增量补跑。
     */
    applyAnalysisTemplate: adminProcedure
      .input(
        z.object({
          templateId: z.number().int().positive(),
          runId: z.number().int().positive(),
        }),
      )
      .mutation(async ({ input }) => {
        const template = await repos.templates.getById(input.templateId);
        if (!template) {
          toTrpcError(new ResearchEngineError("TEMPLATE_NOT_FOUND", `未找到分析模板：${input.templateId}`));
        }
        if (template.items.length === 0) {
          toTrpcError(
            new ResearchEngineError(
              "TEMPLATE_VALIDATION_FAILED",
              `模板「${template.name}」没有任何分析明细，无法展开`,
            ),
          );
        }
        const items = templateItemsToBatchItems(template.items);
        try {
          const result = await createAnalysesBatch(repos, input.runId, items);
          return { templateId: template.id, templateName: template.name, ...result };
        } catch (e) {
          toTrpcError(e);
        }
      }),
  });
}

/** 默认实例（真实 TiDB，惰性连接；复用 datasetRegistry 的读取层与仓储）。 */
export const researchEngineRouter = buildResearchEngineRouter({
  repos: createDbResearchRepositories(),
  reader: new RegistryResearchDatasetReader({ registryRepo: new DbDatasetRegistry() }),
  eventPageSize: DEFAULT_EVENT_PAGE_SIZE,
  maxSamples: DEFAULT_MAX_SAMPLES,
});

export type ResearchEngineRouter = ReturnType<typeof buildResearchEngineRouter>;
