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
  RESEARCH_EXPECTED_DIRECTIONS,
  RESEARCH_EXPERIMENT_STATUSES,
  RESEARCH_FINDING_STATUSES,
  RESEARCH_GROUP_LOGICAL_OPERATORS,
  RESEARCH_HYPOTHESIS_STATUSES,
  RESEARCH_LOGICAL_OPERATORS,
  RESEARCH_TYPES,
  ResearchCandidateError,
  ResearchConflictError,
  ResearchFindingError,
  ResearchHypothesisError,
  assertHypothesisReadyForCandidate,
  assertHypothesisTestable,
  assertHypothesisTransition,
  createDbResearchRepositories,
  type ResearchAnalysisType,
  type ResearchConditionSet,
  type ResearchRepositories,
} from "./researchCore";
import { RegistryResearchDatasetReader, type ResearchDatasetReader } from "./researchEngine/datasetReader";
import { ResearchEngine } from "./researchEngine/engine";
import { ResearchEngineError } from "./researchEngine/errors";
import { FindingEngine } from "./researchEngine/finding/findingEngine";
import { assertFindingTransition } from "./researchCore";
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
 * 已序列化的 `ResearchConditionSet`（`{ groups: [...] }` 形态）。
 *
 * 供 Hypothesis 的 `conditions` 入参复用 —— 与 Candidate 草图同构，
 * 由 `assertConditionSet` 做领域级校验（本 schema 只做结构收敛）。
 *
 * `value` 用 `z.unknown()`（条件右值可为字符串/数字/布尔/null/数组/二元组），
 * 结构收敛后经 `as ResearchConditionSet` 落领域形态 —— 真正的取值合法性由
 * `assertConditionSet`（Repository 层）把关，不在这里重复造 zod 联合。
 */
const conditionSetSchema: z.ZodType<ResearchConditionSet> = z.object({
  groups: z.array(
    z.object({
      groupNo: z.number().int().min(0),
      groupLogicalOperator: z.enum(RESEARCH_GROUP_LOGICAL_OPERATORS),
      conditions: z.array(
        z.object({
          groupNo: z.number().int().min(0),
          sortOrder: z.number().int().min(0),
          fieldName: z.string().min(1),
          operator: z.enum(RESEARCH_CONDITION_OPERATORS),
          value: z.unknown(),
          logicalOperator: z.enum(RESEARCH_LOGICAL_OPERATORS),
          groupLogicalOperator: z.enum(RESEARCH_GROUP_LOGICAL_OPERATORS),
        }),
      ),
    }),
  ),
}) as z.ZodType<ResearchConditionSet>;

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
    // ---- 变量目录（供前端构造合法配置；一次拿到特征 / 结果 / 观察日 / 维度）----
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
        // 观察日视界来自 post.relativeDay 的真实覆盖（**不是**写死 20）：
        // 数据集没有 post 数据时，这里返回空数组，前端下拉里就不该出现任何 `obs_*`。
        const postHorizons = context.postRelativeDayRange
          ? Array.from(
              { length: context.postRelativeDayRange.max - Math.max(1, context.postRelativeDayRange.min) + 1 },
              (_, i) => Math.max(1, context.postRelativeDayRange!.min) + i,
            )
          : [];
        const catalog = new ResearchVariableCatalog(context.horizons, pathHorizons, postHorizons);
        const observationMaxOffset = catalog.observationMaxOffset;
        return {
          datasetVersion: context,
          features: catalog.listFeatures(),
          outcomes: catalog.listOutcomes(),
          /**
           * 观察日变量（T+k 可观测，可当条件）。数量随 `observationMaxOffset` 二次增长
           * （逐日 8 + 累积 6 每 offset），因此**另附分组清单**供前端做「先选天数、再选字段」
           * 的两级下拉，避免一次性渲染 280 项。
           */
          observations: {
            variables: catalog.listObservations(),
            maxOffset: observationMaxOffset,
            /**
             * 逐日字段（每个 offset 都有这 8 个）。
             * 名字模板里的 `{k}` 由前端替换成选中的天数。
             */
            dayFields: [
              { field: "open", label: "当日开盘价", unit: "元" },
              { field: "high", label: "当日最高价", unit: "元" },
              { field: "low", label: "当日最低价", unit: "元" },
              { field: "close", label: "当日收盘价", unit: "元" },
              { field: "volume", label: "当日成交量", unit: "股" },
              { field: "amount", label: "当日成交额", unit: "元" },
              { field: "return_from_event_close", label: "相对首板日收盘涨跌幅", unit: "比例" },
              { field: "volume_ratio", label: "相对首板日成交量比", unit: "比例" },
            ],
            /**
             * 累积口径（覆盖 T+1..T+k 整段，而不是单看某一天）。
             * 这是「回调形态」这一类判断的主力：单日最低价没有意义，
             * 「回调期间最低价」才对应「是否跌破首板日最低价」。
             */
            pullbackStats: [
              { stat: "min_low", label: "回调期间最低价", unit: "元" },
              { stat: "max_high", label: "回调期间最高价", unit: "元" },
              { stat: "close", label: "回调末日收盘价", unit: "元" },
              { stat: "close_ratio", label: "回调末日收盘 / 首板日收盘", unit: "比例" },
              { stat: "min_volume", label: "回调期间最小成交量（绝对量，慎用于比较）", unit: "股" },
              {
                stat: "min_volume_ratio",
                label: "回调期间最小量能比 / 首板日成交量（缩量验证用这个）",
                unit: "比例",
              },
              { stat: "last_volume_ratio", label: "回调末日量能比 / 首板日成交量", unit: "比例" },
              { stat: "holds_event_low", label: "回调期间未破首板日最低价（1=未破 / 0=已破）", unit: "0/1" },
              /**
               * RESEARCH-PLANNER-001 新增 —— 与 `holds_event_low` 平行，只换基准字段。
               *
               * 为什么必须并列出现：`low(T) ≤ open(T)` 恒成立，因此「未破开盘价」严格强于
               * 「未破最低价」，两者筛出的样本不同。任务书 §27 的验收问题问的是**开盘价**，
               * 若下拉里只有 `holds_event_low`，用户只能选到含义不同的口径。
               */
              { stat: "holds_event_open", label: "回调期间未破首板日开盘价（1=未破 / 0=已破）", unit: "0/1" },
              { stat: "last_is_bullish", label: "回调末日为阳线（1=是 / 0=否）", unit: "0/1" },
            ],
          },
          /** 观察日条件在 T+k 判定时的 PIT 上限（前端据此提示「在 T+3 判定只能用 ≤ T+3 的字段」）。 */
          observationsUnavailable: observationMaxOffset === 0
            ? [{ key: "observations", reason: "该 Dataset 没有 post（观察日）数据，无法用 T+k 可观测变量做条件" }]
            : [],
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
          researchQuestion: z.string().optional(),
          conditions: conditionSetSchema.optional(),
          target: z.string().optional(),
          horizon: z.string().optional(),
          expectedDirection: z.enum(RESEARCH_EXPECTED_DIRECTIONS).optional(),
          expectedEffect: z.string().optional(),
          sourceFindingIds: z.array(z.number().int().positive()).optional(),
          sourceConclusionId: z.number().int().positive().optional(),
        }),
      )
      .mutation(async ({ input }) =>
        repos.hypotheses.create({
          experimentId: input.experimentId,
          name: input.name,
          statement: input.statement,
          nullHypothesis: input.nullHypothesis ?? null,
          alternativeHypothesis: input.alternativeHypothesis ?? null,
          researchQuestion: input.researchQuestion ?? null,
          conditions: input.conditions ?? null,
          target: input.target ?? null,
          horizon: input.horizon ?? null,
          expectedDirection: input.expectedDirection ?? null,
          expectedEffect: input.expectedEffect ?? null,
          sourceFindingIds: input.sourceFindingIds ?? null,
          sourceConclusionId: input.sourceConclusionId ?? null,
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
          researchQuestion: z.string().nullable().optional(),
          conditions: conditionSetSchema.nullable().optional(),
          target: z.string().nullable().optional(),
          horizon: z.string().nullable().optional(),
          expectedDirection: z.enum(RESEARCH_EXPECTED_DIRECTIONS).nullable().optional(),
          expectedEffect: z.string().nullable().optional(),
          sourceFindingIds: z.array(z.number().int().positive()).nullable().optional(),
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
        if (input.researchQuestion !== undefined) patch.researchQuestion = input.researchQuestion;
        if (input.conditions !== undefined) patch.conditions = input.conditions;
        if (input.target !== undefined) patch.target = input.target;
        if (input.horizon !== undefined) patch.horizon = input.horizon;
        if (input.expectedDirection !== undefined) patch.expectedDirection = input.expectedDirection;
        if (input.expectedEffect !== undefined) patch.expectedEffect = input.expectedEffect;
        if (input.sourceFindingIds !== undefined) patch.sourceFindingIds = input.sourceFindingIds;
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

    // ---- Finding（RESEARCH-FINDING-001）----
    /**
     * GET /research/findings —— 列出 Finding（按实验 / Run / 类型 / 状态 / 强度下界过滤）。
     *
     * Finding 是「Result → Finding」的**发现层**产物；只读端点，不做任何统计。
     */
    listFindings: publicProcedure
      .input(
        z.object({
          experimentId: z.number().int().positive().optional(),
          runId: z.number().int().positive().optional(),
          findingType: z.string().optional(),
          status: z.enum(RESEARCH_FINDING_STATUSES).optional(),
          minResearchStrength: z.number().min(0).max(1).optional(),
        }),
      )
      .query(async ({ input }) =>
        repos.findings.list({
          ...(input.experimentId !== undefined ? { experimentId: input.experimentId } : {}),
          ...(input.runId !== undefined ? { runId: input.runId } : {}),
          ...(input.findingType !== undefined ? { findingType: input.findingType as never } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.minResearchStrength !== undefined ? { minResearchStrength: input.minResearchStrength } : {}),
        }),
      ),

    /** GET /research/findings/:id —— 单条 Finding 明细。 */
    getFinding: publicProcedure
      .input(z.object({ findingId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const finding = await repos.findings.getById(input.findingId);
        if (!finding) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Finding：${input.findingId}` });
        }
        return finding;
      }),

    /**
     * POST /research/findings/detect —— 对某 Run 重新运行 Finding 检测并落库。
     *
     * 🔴 只读 `research_result`（任务书 §28），**绝不重扫 Dataset**；
     * 引擎只能产出 `DISCOVERED` 状态，重跑幂等（fingerprint 去重）。
     */
    detectFindings: adminProcedure
      .input(
        z.object({
          experimentId: z.number().int().positive(),
          runId: z.number().int().positive(),
          analysisIds: z.array(z.number().int().positive()).optional(),
          resetExisting: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const findingEngine = new FindingEngine({ repos });
          return await findingEngine.detect({
            experimentId: input.experimentId,
            runId: input.runId,
            ...(input.analysisIds !== undefined ? { analysisIds: input.analysisIds } : {}),
            ...(input.resetExisting !== undefined ? { resetExisting: input.resetExisting } : {}),
          });
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * POST /research/findings/:id/review —— 用户 review 一条 Finding（状态流转）。
     *
     * 🔴 任务书 §13「不要让系统自动把所有 Finding 标记为 SUPPORTED」：
     *    `SUPPORTED` / `WEAK` / `CONTRADICTED` / `REJECTED` 只能由**用户**在此流转；
     *    转移必须过 `assertFindingTransition`（状态机）。
     */
    reviewFinding: adminProcedure
      .input(
        z.object({
          findingId: z.number().int().positive(),
          status: z.enum(RESEARCH_FINDING_STATUSES),
        }),
      )
      .mutation(async ({ input }) => {
        const existing = await repos.findings.getById(input.findingId);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Finding：${input.findingId}` });
        }
        try {
          assertFindingTransition(existing.status, input.status);
        } catch (e) {
          if (e instanceof ResearchFindingError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          }
          throw e;
        }
        return repos.findings.update(input.findingId, { status: input.status });
      }),

    // ---- Hypothesis 补充（create/update/delete 已存在）----
    /** GET /research/hypotheses/:id —— 单条假设明细。 */
    getHypothesis: publicProcedure
      .input(z.object({ hypothesisId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const hypothesis = await repos.hypotheses.getById(input.hypothesisId);
        if (!hypothesis) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Hypothesis：${input.hypothesisId}` });
        }
        return hypothesis;
      }),

    /**
     * POST /research/hypotheses/:id/test —— 假设进入「可测」或「已测」状态（§26）。
     *
     * - 置 `TESTABLE`：三件套（conditions / target / horizon）必须齐备（`assertHypothesisTestable`）；
     * - 其余转移走 `assertHypothesisTransition`（状态机，禁止跳级）。
     *
     * 🔴 本端点**只改状态**，不跑任何统计；实际验证由 `runEngine`（Run 收口时回写）完成。
     */
    testHypothesis: adminProcedure
      .input(
        z.object({
          hypothesisId: z.number().int().positive(),
          status: z.enum(RESEARCH_HYPOTHESIS_STATUSES),
        }),
      )
      .mutation(async ({ input }) => {
        const existing = await repos.hypotheses.getById(input.hypothesisId);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Hypothesis：${input.hypothesisId}` });
        }
        try {
          if (input.status === "TESTABLE") {
            assertHypothesisTestable(existing);
          }
          assertHypothesisTransition(existing.status, input.status);
        } catch (e) {
          if (e instanceof ResearchHypothesisError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          }
          throw e;
        }
        return repos.hypotheses.update(input.hypothesisId, { status: input.status });
      }),

    // ---- Strategy Candidate：从假设转正（RESEARCH-FINDING-001 §26）----
    /**
     * POST /research/strategy-candidates/from-hypothesis —— 把一条 `SUPPORTED` 假设转成候选草稿。
     *
     * 🔴 任务书 §26「不要自动生成 Strategy」：只允许 `SUPPORTED` / `PROMOTED` 假设转候选
     *    （`assertHypothesisReadyForCandidate`）；产物是 `DRAFT` 候选，**不**自动转正 Strategy。
     *    候选继承假设的条件/目标/视界/方向，并落 `sourceHypothesisId` + `sourceFindingIds` 谱系锚。
     */
    createCandidateFromHypothesis: adminProcedure
      .input(
        z.object({
          hypothesisId: z.number().int().positive(),
          name: z.string().min(1).max(200).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const hypothesis = await repos.hypotheses.getById(input.hypothesisId);
        if (!hypothesis) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Hypothesis：${input.hypothesisId}` });
        }
        try {
          assertHypothesisReadyForCandidate(hypothesis);
        } catch (e) {
          if (e instanceof ResearchHypothesisError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
          }
          throw e;
        }
        const experiment = await repos.experiments.getById(hypothesis.experimentId);
        if (!experiment) {
          throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Research Experiment：${hypothesis.experimentId}` });
        }
        try {
          const candidate = await repos.candidates.create({
            experimentId: hypothesis.experimentId,
            conclusionId: hypothesis.sourceConclusionId ?? null,
            name: input.name ?? `${hypothesis.name}（候选）`,
            description: `由假设「${hypothesis.name}」转出（§26）。${hypothesis.statement}`,
            filterRule: hypothesis.conditions ?? undefined,
            sourceDatasetVersionId: experiment.datasetVersionId ?? null,
            sourceResearchRunId: hypothesis.runId ?? null,
            sourceHypothesisId: hypothesis.id ?? null,
            sourceFindingIds: hypothesis.sourceFindingIds ?? null,
            status: "DRAFT",
          });
          return candidate;
        } catch (e) {
          if (e instanceof ResearchCandidateError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          }
          throw e;
        }
      }),

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
