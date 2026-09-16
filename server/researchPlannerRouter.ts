/**
 * RESEARCH-PLANNER-001 — 自动研究编排 tRPC Router。
 *
 * 遵循项目既有 API 风格（与 `researchEngineRouter.ts` 一致）：
 *   - 只读端点 `publicProcedure`，写端点与执行端点 `adminProcedure`；
 *   - 未命中一律 `NOT_FOUND`，领域错误映射为稳定 tRPC code；
 *   - **前端绝不直连数据库**：所有读写都经 Research Repository；
 *   - Router 内**不做任何统计计算**，统计只在 ResearchEngine / FindingEngine 内部发生。
 *
 * 端点（§19 的八个能力，按项目 tRPC 命名规范呈现）：
 *   createQuestion       POST  {datasetVersionId, questionText} → Question + Experiment + Run + Plan + 预览
 *   getPlan              GET   {planId}                        → 计划 + 预览（重算，不落库）
 *   runResearch          POST  {planId}                        → 物化 + 执行 + 结论视图（同步）
 *   runResearchDetached  POST  {planId}                        → 物化 + 后台执行（立即返回，§23）
 *   getOutcome           GET   {questionId|runId}              → 结论视图（Finding 聚合 / 有效性 / 建议）
 *   runFromQuestion      POST  {datasetVersionId, questionText} → §20 单次调用全链路
 *   createCandidate      POST  {questionId|runId, name, ...}   → 保留全套 provenance 的候选
 *
 * 🔴 与 `researchEngineRouter` 的分工：本路由**只做编排**（问题 → 计划 → 建分析 → 触发执行），
 *    单条分析的读写、模板、增量补跑、Finding review 全部仍在 `researchEngine` 路由上。
 *    不重复实现任何一条已有端点。
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { DbDatasetRegistry } from "./datasetRegistry/db";
import {
  createDbResearchRepositories,
  groupConditions,
  type ResearchAnalysisCondition,
  type ResearchConditionSet,
  type ResearchRepositories,
} from "./researchCore";
import { RegistryResearchDatasetReader, type ResearchDatasetReader } from "./researchEngine/datasetReader";
import { ResearchEngine } from "./researchEngine/engine";
import { ResearchVariableCatalog } from "./researchEngine/variables";
import { DEFAULT_EVENT_PAGE_SIZE, DEFAULT_MAX_SAMPLES } from "./researchEngine/sampleSet";
import {
  buildResearchOutcome,
  type ResearchOutcome,
  type ResearchOutcomeCandidateSource,
} from "./researchEngine/planner/aggregate";
import { ResearchPlannerError } from "./researchEngine/planner/errors";
import {
  buildPreview,
  materializePlan,
  planResearchQuestion,
  type PlanResearchQuestionResult,
} from "./researchEngine/planner/questionPlanning";
import type { GeneratedAnalysisPlan, PlanDataFacts } from "./researchEngine/planner/analysisPlan";
import {
  DEFAULT_RESEARCH_MODULE_REGISTRY,
  type ResearchModuleRegistry,
} from "./researchEngine/planner/moduleRegistry";

/** 前端可选的分组维度（与 `listVariables` 的 `dimensions` 同口径）。 */
const SUPPORTED_DIMENSIONS = ["year", "month", "quarter", "board", "market", "industry"];

export interface ResearchPlannerRouterDeps {
  repos: ResearchRepositories;
  reader: ResearchDatasetReader;
  registry?: ResearchModuleRegistry;
  eventPageSize?: number;
  maxSamples?: number;
}

/** 由「真实数据集覆盖」推导计划事实（**不臆造**任何一项）。 */
export async function loadPlanDataFacts(
  reader: ResearchDatasetReader,
  datasetVersionId: number,
): Promise<PlanDataFacts> {
  const context = await reader.getVersionContext(datasetVersionId);
  if (!context) {
    throw new ResearchPlannerError(
      "DATASET_VERSION_NOT_FOUND",
      `未找到 Dataset Version：${datasetVersionId}`,
    );
  }
  const pathHorizons = context.pathRelativeDayRange
    ? Array.from(
        { length: context.pathRelativeDayRange.max - context.pathRelativeDayRange.min + 1 },
        (_, i) => context.pathRelativeDayRange!.min + i,
      )
    : [];
  const postHorizons = context.postRelativeDayRange
    ? Array.from(
        { length: context.postRelativeDayRange.max - Math.max(1, context.postRelativeDayRange.min) + 1 },
        (_, i) => Math.max(1, context.postRelativeDayRange!.min) + i,
      )
    : [];
  const catalog = new ResearchVariableCatalog(context.horizons, pathHorizons, postHorizons);
  return {
    datasetVersionId,
    features: catalog.listFeatures(),
    pathHorizons,
    outcomeHorizons: context.horizons,
    observationMaxOffset: catalog.observationMaxOffset,
    dimensions: SUPPORTED_DIMENSIONS,
  };
}

// ---------------------------------------------------------------------------
// 后台执行注册表（§23：不阻塞 HTTP；进度靠既有逐分析 status 落库可见）
// ---------------------------------------------------------------------------

/**
 * 进程内「已启动的后台执行」注册表。
 *
 * 🔴 刻意的能力边界（**如实声明，不假装有队列**）：
 *   - 它是**进程内**的：进程重启（含 dev 热重载）会丢失在途执行，Run 会停在 RUNNING。
 *     这与本项目既有行为一致（`PROJECT_RULES` 已登记：改 `server/**` 会热重启并杀死在途 Run）；
 *   - 它**不做重试 / 不做持久化**：重试由用户经 `runIncremental` 显式触发（既有能力）；
 *   - 它的唯一职责是：**同一份计划不会被同时跑两次**（重复调用返回同一个 runId 与 `alreadyRunning`）。
 *
 * 之所以不引入队列基础设施：任务书 §23 只要求「不长时间阻塞 + 进度可见」，
 * 而进度已经由引擎逐条写 `research_analysis.status` 实现 —— 再引入一套队列只会多一份状态源。
 */
const detachedRuns = new Map<number, { runId: number; startedAt: string; promise: Promise<void> }>();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function buildResearchPlannerRouter(deps: ResearchPlannerRouterDeps) {
  const { repos, reader } = deps;
  const registry = deps.registry ?? DEFAULT_RESEARCH_MODULE_REGISTRY;

  const engine = new ResearchEngine({
    repos,
    reader,
    ...(deps.eventPageSize !== undefined ? { eventPageSize: deps.eventPageSize } : {}),
    ...(deps.maxSamples !== undefined ? { maxSamples: deps.maxSamples } : {}),
  });

  /** 领域错误 → 稳定 tRPC code（与 `researchEngineRouter#toTrpcError` 同一口径）。 */
  function toTrpcError(e: unknown): never {
    if (e instanceof ResearchPlannerError) {
      switch (e.code) {
        case "QUESTION_NOT_FOUND":
        case "PLAN_NOT_FOUND":
        case "DATASET_VERSION_NOT_FOUND":
          throw new TRPCError({ code: "NOT_FOUND", message: e.message });
        case "QUESTION_TOO_SHORT":
        case "QUESTION_TOO_LONG":
        case "PLAN_RUN_MISSING":
        case "PLAN_EMPTY":
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        case "DATASET_VERSION_NOT_READY":
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        default:
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
      }
    }
    if (e instanceof Error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
    }
    throw e;
  }

  async function requireQuestion(questionId: number) {
    const question = await repos.questions.getById(questionId);
    if (!question) {
      throw new TRPCError({ code: "NOT_FOUND", message: `未找到研究问题：${questionId}` });
    }
    return question;
  }

  async function requirePlan(planId: number) {
    const plan = await repos.plans.getById(planId);
    if (!plan) {
      throw new TRPCError({ code: "NOT_FOUND", message: `未找到研究计划：${planId}` });
    }
    return plan;
  }

  /** 从已落库的计划重算预览（**不落库**，避免预览成为第二份可漂移的状态）。 */
  async function previewOfPlan(planId: number) {
    const plan = await requirePlan(planId);
    const facts = await loadPlanDataFacts(reader, plan.datasetVersionId);
    const generated: GeneratedAnalysisPlan = {
      items: plan.items,
      dropped: plan.notes?.dropped ?? [],
      conditionReadback: plan.notes?.conditionReadback ?? [],
      selectionRationale: plan.notes?.selectionRationale ?? [],
      capApplied: plan.capApplied,
      maxAnalysisPerPlan: plan.maxAnalysisPerPlan,
      analysisTypes: [...new Set(plan.items.map((i) => i.analysisType))].sort(),
      // 重算预览时如实沿用计划里**已登记**的侧重标注（没有则空 —— 不按新代码重推断，
      // 否则「重读的预览」会和当时真正跑的计划不一致）。
      emphasisAnalysisNames: plan.notes?.emphasisAnalysisNames ?? [],
    };
    const question = await repos.questions.getById(plan.questionId);
    return {
      plan,
      preview: buildPreview(generated, facts, question?.intent?.unresolvedClauses ?? []),
    };
  }

  /** 物化（幂等）+ 把 question 置为 RUNNING。 */
  async function prepareRun(planId: number) {
    const plan = await requirePlan(planId);
    if (plan.items.length === 0) {
      throw new ResearchPlannerError(
        "PLAN_EMPTY",
        `研究计划 ${planId} 里没有任何分析（通常是该 Dataset 缺少所需数据能力），无法执行。`,
      );
    }
    const materialized = await materializePlan(repos, planId);
    const question = await repos.questions.getById(plan.questionId);
    if (question?.id !== undefined && question.status !== "RUNNING") {
      await repos.questions.update(question.id, { status: "RUNNING" });
    }
    return { plan, materialized };
  }

  /** 执行 + 收尾（把 question 状态推进到 COMPLETED / FAILED），最后返回结论视图。 */
  async function executeAndSummarize(planId: number): Promise<ResearchOutcome> {
    const plan = await requirePlan(planId);
    if (plan.runId === null || plan.runId === undefined) {
      throw new ResearchPlannerError("PLAN_RUN_MISSING", `研究计划 ${planId} 没有绑定 Run。`);
    }
    try {
      await engine.run({ experimentId: plan.experimentId, runId: plan.runId });
      await repos.plans.update(planId, { status: "EXECUTED" });
      await markQuestion(plan.questionId, "COMPLETED");
    } catch (e) {
      await repos.plans.update(planId, { status: "FAILED" });
      await markQuestion(plan.questionId, "FAILED");
      toTrpcError(e);
    }
    return buildResearchOutcome(repos, { questionId: plan.questionId });
  }

  async function markQuestion(questionId: number, status: "RUNNING" | "COMPLETED" | "FAILED") {
    const question = await repos.questions.getById(questionId);
    if (question?.id === undefined) return;
    await repos.questions.update(question.id, { status });
  }

  /** 单次调用全链路（§20）：Question → Plan → Materialize → Run → Outcome。 */
  async function planAndRun(input: {
    datasetVersionId: number;
    questionText: string;
    generatedBy?: "USER" | "WORKBUDDY" | "SYSTEM";
    maxAnalysisPerPlan?: number;
  }): Promise<{ planned: PlanResearchQuestionResult; outcome: ResearchOutcome }> {
    const facts = await loadPlanDataFacts(reader, input.datasetVersionId);
    const planned = await planResearchQuestion({
      repos,
      datasetVersionId: input.datasetVersionId,
      questionText: input.questionText,
      facts,
      registry,
      ...(input.generatedBy !== undefined ? { createdBy: input.generatedBy } : {}),
      ...(input.maxAnalysisPerPlan !== undefined ? { maxAnalysisPerPlan: input.maxAnalysisPerPlan } : {}),
    });
    if (planned.plan.id === undefined) {
      throw new ResearchPlannerError("PLAN_WRITE_FAILED", "计划创建成功但未返回 id。");
    }
    const planId = planned.plan.id;
    await prepareRun(planId);
    const outcome = await executeAndSummarize(planId);
    return { planned, outcome };
  }

  return router({
    // ---- ① 提出问题 = 自动生成实验 + Run + 计划（不执行）----
    createQuestion: adminProcedure
      .input(
        z.object({
          datasetVersionId: z.number().int().positive(),
          questionText: z.string().min(1).max(2000),
          generatedBy: z.enum(["USER", "WORKBUDDY", "SYSTEM"]).optional(),
          maxAnalysisPerPlan: z.number().int().min(1).max(50).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const facts = await loadPlanDataFacts(reader, input.datasetVersionId);
          return await planResearchQuestion({
            repos,
            datasetVersionId: input.datasetVersionId,
            questionText: input.questionText,
            facts,
            registry,
            ...(input.generatedBy !== undefined ? { createdBy: input.generatedBy } : {}),
            ...(input.maxAnalysisPerPlan !== undefined ? { maxAnalysisPerPlan: input.maxAnalysisPerPlan } : {}),
          });
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- ② 计划明细 + 预览（只读；预览每次重算，不落库）----
    getPlan: publicProcedure
      .input(z.object({ planId: z.number().int().positive() }))
      .query(async ({ input }) => {
        try {
          return await previewOfPlan(input.planId);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- ③ 研究问题 / 计划（只读列举，供前端列表页）----
    getQuestion: publicProcedure
      .input(z.object({ questionId: z.number().int().positive() }))
      .query(async ({ input }) => {
        try {
          const question = await requireQuestion(input.questionId);
          const plan = await repos.plans.latestForQuestion(input.questionId);
          return { question, plan: plan ?? null };
        } catch (e) {
          toTrpcError(e);
        }
      }),

    listQuestions: publicProcedure
      .input(
        z
          .object({
            datasetVersionId: z.number().int().positive().optional(),
            status: z.enum(["DRAFT", "PLANNED", "RUNNING", "COMPLETED", "FAILED", "REJECTED"]).optional(),
            experimentId: z.number().int().positive().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => repos.questions.list(input ?? {})),

    // ---- ④ 执行（同步：物化 + 跑 + 结论视图）----
    runResearch: adminProcedure
      .input(z.object({ planId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          await prepareRun(input.planId);
          return await executeAndSummarize(input.planId);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * ⑤ 后台执行（§23：立即返回，不阻塞 HTTP）。
     *
     * 进度观测方式：执行期间引擎会**逐条**更新 `research_analysis.status`，
     * 前端轮询 `getOutcome` / 既有 `researchEngine.getRun` 即可看到进度推进。
     * 本端点只返回 `{ runId, started, alreadyRunning }`，不返回统计结果。
     */
    runResearchDetached: adminProcedure
      .input(z.object({ planId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          const existing = detachedRuns.get(input.planId);
          if (existing !== undefined) {
            return { planId: input.planId, runId: existing.runId, started: true, alreadyRunning: true };
          }
          const { plan } = await prepareRun(input.planId);
          const runId = plan.runId!;
          const promise = (async () => {
            try {
              await executeAndSummarize(input.planId);
            } finally {
              detachedRuns.delete(input.planId);
            }
          })();
          detachedRuns.set(input.planId, { runId, startedAt: new Date().toISOString(), promise });
          return { planId: input.planId, runId, started: true, alreadyRunning: false };
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- ⑥ 结论视图（§12–§15）----
    getOutcome: publicProcedure
      .input(
        z
          .object({
            questionId: z.number().int().positive().optional(),
            runId: z.number().int().positive().optional(),
            topN: z.number().int().min(1).max(50).optional(),
            minStrength: z.number().min(0).max(1).optional(),
          })
          .refine((v) => v.questionId !== undefined || v.runId !== undefined, {
            message: "至少要给出 questionId 或 runId",
          }),
      )
      .query(async ({ input }) => {
        try {
          return await buildResearchOutcome(repos, {
            ...(input.questionId !== undefined ? { questionId: input.questionId } : {}),
            ...(input.runId !== undefined ? { runId: input.runId } : {}),
            ...(input.topN !== undefined ? { topN: input.topN } : {}),
            ...(input.minStrength !== undefined ? { minStrength: input.minStrength } : {}),
          });
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * ⑦ §20 —— **Workbuddy 单次调用入口**。
     *
     * 入参只有 `{ datasetVersionId, researchQuestion }`，出参含 §20 要求的
     * `{ researchId, researchPlanId, analysisCount, findings, conclusion }`（外加预览与建议）。
     *
     * ⚠️ 这是**同步长请求**（30 条分析 ≈ 95s，跨境 TiDB 实测均摊 ≈ 3.1s/条）。
     *    调用方若怕超时，改用 `createQuestion` + `runResearchDetached` 两段式。
     */
    runFromQuestion: adminProcedure
      .input(
        z.object({
          datasetVersionId: z.number().int().positive(),
          researchQuestion: z.string().min(1).max(2000),
          generatedBy: z.enum(["USER", "WORKBUDDY", "SYSTEM"]).optional(),
          maxAnalysisPerPlan: z.number().int().min(1).max(50).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const { planned, outcome } = await planAndRun({
            datasetVersionId: input.datasetVersionId,
            questionText: input.researchQuestion,
            ...(input.generatedBy !== undefined ? { generatedBy: input.generatedBy } : {}),
            ...(input.maxAnalysisPerPlan !== undefined ? { maxAnalysisPerPlan: input.maxAnalysisPerPlan } : {}),
          });
          return {
            researchId: planned.experiment.id,
            researchPlanId: planned.plan.id,
            researchRunId: planned.run.id,
            questionId: planned.question.id,
            analysisCount: outcome.analysisCount,
            findings: outcome.topFindings,
            findingsTotal: outcome.findingsTotal,
            conclusion: outcome.conclusion,
            recommendation: outcome.recommendation,
            dataValidity: outcome.dataValidity,
            preview: planned.preview,
            intent: planned.intent.evidence,
            outcome,
          };
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * ⑧ 创建 Candidate（§16）。
     *
     * 设计要点：
     *   - **必须保留全套 provenance**：experimentId / sourceResearchRunId / sourceResearchPlanId /
     *     sourceDatasetVersionId / sourceFindingIds / conclusionId 六项一次写齐；
     *   - `filterRule` 可由**指定的主分析**的落库条件直接导出（`deriveFilterFromAnalysisId`），
     *     这样候选筛选条件与研究条件**同源**，不会出现「研究用的是 A 口径、候选写的是 B 口径」；
     *   - 状态一律 `DRAFT`：任务书 §30 明确禁止 Research → Strategy 自动流转，
     *     且 §2 要求「Research → Candidate → **User confirms** → Strategy」。
     */
    createCandidate: adminProcedure
      .input(
        z.object({
          questionId: z.number().int().positive().optional(),
          runId: z.number().int().positive().optional(),
          name: z.string().min(1).max(200),
          description: z.string().optional(),
          conclusionId: z.number().int().positive().optional(),
          findingIds: z.array(z.number().int().positive()).optional(),
          /**
           * 指定「用哪条分析的条件」导出候选 `filterRule`（可选）。
           *
           * 🔴 **可以不传** —— 不传时系统自己挑（见下方 `resolveCandidateFilterSource`）。
           *    要求调用方知道 analysisId 是不合理的：§20 的调用契约只有
           *    `{ datasetVersionId, researchQuestion }`，Workbuddy 拿不到库内主键。
           */
          deriveFilterFromAnalysisId: z.number().int().positive().optional(),
          entryRule: z.unknown().optional(),
          exitRule: z.unknown().optional(),
          riskRule: z.unknown().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const outcome = await buildResearchOutcome(repos, {
            ...(input.questionId !== undefined ? { questionId: input.questionId } : {}),
            ...(input.runId !== undefined ? { runId: input.runId } : {}),
          });

          /**
           * ---- §16：解析「候选筛选条件从哪条分析来」----
           *
           * 🔴 这里曾经是本缺陷的现场：服务端**只校验**调用方给的那条，自己不参与挑选；
           *    前端则按「第一条 P0」挑 —— 而计划里第一条 P0 是
           *    `EVENT_STUDY 全样本基准`（`analysisPlan.ts:361` 是全函数第一条 push，
           *    `requiredFlag = true`、条件数 0）⇒ 必然落到「没有任何条件」上，
           *    「创建候选」在产品上**恒失败**（实测报错号 780001）。
           *
           *    之所以 E2E 全绿：E2E 自己写了更严的判据
           *    （`priority === "P0" && analysisType === "CONDITIONAL"`）。
           *    测试比产品严 ⇒ 测试通过不等于产品可用。**挑选规则从此只实现一次**，
           *    在 `aggregate.ts#rankCandidateSourceAnalyses`，前端 / E2E / Workbuddy 共用同一份。
           */
          const source = await resolveCandidateFilterSource(repos, outcome, input.deriveFilterFromAnalysisId);

          let filterRule: ResearchConditionSet | undefined;
          if (source.analysisId !== null) {
            // `groupConditions` 是条件分组的**唯一权威**（按 groupNo 归组、组内按 sortOrder），
            // 这里直接复用其结果，不另写一份分组逻辑。
            filterRule = { groups: groupConditions(source.rows) };
          }

          const candidate = await repos.candidates.create({
            experimentId: outcome.experimentId,
            conclusionId: input.conclusionId ?? outcome.conclusion?.id ?? null,
            name: input.name,
            description: input.description ?? outcome.questionText ?? null,
            ...(filterRule !== undefined ? { filterRule } : {}),
            ...(input.entryRule !== undefined ? { entryRule: input.entryRule } : {}),
            ...(input.exitRule !== undefined ? { exitRule: input.exitRule } : {}),
            ...(input.riskRule !== undefined ? { riskRule: input.riskRule } : {}),
            // ---- 全套 provenance（§16）----
            sourceDatasetVersionId: outcome.datasetVersionId,
            sourceResearchRunId: outcome.runId,
            sourceResearchPlanId: outcome.planId,
            sourceFindingIds:
              input.findingIds ?? outcome.topFindings.map((f) => f.findingId),
            sourceTraceJson: {
              questionId: outcome.questionId,
              questionText: outcome.questionText,
              moduleKeys: outcome.moduleKeys,
              planDroppedCount: outcome.plan.droppedCount,
              planCapApplied: outcome.plan.capApplied,
              planUnresolvedClauses: outcome.plan.unresolvedClauses,
              dataValidityPassed: outcome.dataValidity.passed,
              recommendationStage: outcome.recommendation.stage,
              recommendationReasons: outcome.recommendation.reasons,
              derivedFilterFromAnalysisId: source.analysisId,
              filterRuleOrigin: source.origin,
              snapshotAt: new Date().toISOString(),
            },
            status: "DRAFT",
          });
          return {
            candidate,
            provenance: buildProvenanceEcho(outcome, candidate.id ?? null),
            filterRuleSource: {
              origin: source.origin,
              analysisId: source.analysisId,
              analysisName: source.analysisName,
              conditionCount: source.rows.length,
              eligibleCount: outcome.candidateEligibleAnalyses.length,
              eligible: outcome.candidateEligibleAnalyses,
              note: source.note,
            },
          };
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          toTrpcError(e);
        }
      }),

    // ---- ⑨ 模块目录（只读：让前端能展示「系统会哪些研究方法」）----
    listModules: publicProcedure.query(() =>
      registry.list().map((m) => ({
        key: m.key,
        label: m.label,
        purpose: m.purpose,
        whenToUse: m.whenToUse,
        researchType: m.researchType,
        requiredCapabilities: m.requiredCapabilities,
        recommendedAnalysisTypes: m.recommendedAnalysisTypes,
        preferredHorizons: m.preferredHorizons,
        keywords: m.keywords,
        groupingDimensions: m.groupingDimensions,
        stabilityDimension: m.stabilityDimension,
      })),
    ),
  });
}

/**
 * 候选筛选条件的来源解析结果（内部类型；对外的形状在端点回执里）。
 */
interface CandidateFilterSource {
  origin: "EXPLICIT" | "AUTO" | "NONE";
  analysisId: number | null;
  analysisName: string | null;
  rows: ResearchAnalysisCondition[];
  note: string;
}

/**
 * 决定「用哪条分析的条件」当候选筛选条件。
 *
 * 三条路径：
 *   ① **显式指定**（`EXPLICIT`）：调用方说了算，但校验从严 ——
 *      分析必须存在、必须属于同一 Run、必须真的有条件行。任一不满足即抛错。
 *   ② **自动挑选**（`AUTO`）：调用方没指定 ⇒ 取
 *      `outcome.candidateEligibleAnalyses[0]`（排序唯一实现在 `aggregate.ts`）。
 *   ③ **没有可导出者**（`NONE`）：本 Run 一条带条件的分析都没有。
 *      🔴 这时**不报错** —— 候选仍然可以建（`filterRule` 留空），
 *         因为「研究结论 → 候选」这一步的价值不全在筛选条件上；
 *         静默给个空条件集才是错的，所以 `note` 必须如实说明，
 *         前端也要把这个状态显示出来（§16 人工确认时用户必须看得到口径是缺的）。
 */
async function resolveCandidateFilterSource(
  repos: ResearchRepositories,
  outcome: ResearchOutcome,
  explicitAnalysisId: number | undefined,
): Promise<CandidateFilterSource> {
  if (explicitAnalysisId !== undefined) {
    const analysis = await repos.analyses.getById(explicitAnalysisId);
    if (!analysis) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          `未找到分析：${explicitAnalysisId}。`
          + `本 Run 可导出条件的分析：${describeEligible(outcome.candidateEligibleAnalyses)}`,
      });
    }
    if (outcome.runId !== null && analysis.runId !== outcome.runId) {
      // 不允许把另一个 Run 的条件挂到本次研究产出的候选上（口径会被悄悄换掉）。
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `分析 ${explicitAnalysisId} 属于 Run ${analysis.runId}，`
          + `而本次研究是 Run ${outcome.runId} —— 拒绝跨 Run 取条件。`,
      });
    }
    const rows = await repos.conditions.listByAnalysis(explicitAnalysisId);
    if (rows.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `分析 ${explicitAnalysisId}（${analysis.analysisType}）没有任何条件，无法导出候选题筛选条件。`
          + (outcome.candidateEligibleAnalyses.length > 0
            ? `本 Run 可导出条件的分析：${describeEligible(outcome.candidateEligibleAnalyses)}`
            : "本 Run 没有任何带条件的分析：请换一条分析口径，或先建一条带条件的分析后增量补跑。"),
      });
    }
    return {
      origin: "EXPLICIT",
      analysisId: explicitAnalysisId,
      analysisName: analysis.name,
      rows,
      note: `按调用方指定，用「${analysis.name}」的 ${rows.length} 条条件。`,
    };
  }

  const auto = outcome.candidateEligibleAnalyses[0];
  if (auto === undefined) {
    return {
      origin: "NONE",
      analysisId: null,
      analysisName: null,
      rows: [],
      note:
        `本 Run 的 ${outcome.analysisCount} 条分析里没有一条带条件`
        + `（现状下只有 CONDITIONAL 类分析才会落条件）`
        + "⇒ 候选已创建，但**没有筛选条件**。进入策略前必须补上口径，"
        + "否则候选等于「全市场 / 全样本」，不构成一个可执行的选股条件。",
    };
  }
  const rows = await repos.conditions.listByAnalysis(auto.analysisId);
  if (rows.length === 0) {
    // 与 `candidateEligibleAnalyses` 的口径不一致（并发写入 / 条件被删）。
    // 如实报错，不悄悄退回 NONE —— 那会让用户以为「本来就是无条件」。
    throw new TRPCError({
      code: "CONFLICT",
      message:
        `分析 ${auto.analysisId}（${auto.name}）在聚合时报告有 ${auto.conditionCount} 条条件，`
        + `但读取时一条都没有 —— 条件可能已被并发修改（「setAnalysisConditions」会删旧条件并回退 PENDING）。`
        + "请刷新结论页后重试。",
    });
  }
  return {
    origin: "AUTO",
    analysisId: auto.analysisId,
    analysisName: auto.name,
    rows,
    note: `自动选择「${auto.name}」的 ${rows.length} 条条件（依据：${auto.why}）。`,
  };
}

/** 把可导出条件的分析列成人读一行（用于错误信息里给出「那你说我该选哪条」）。 */
function describeEligible(list: readonly ResearchOutcomeCandidateSource[]): string {
  if (list.length === 0) return "（无）";
  return list
    .slice(0, 5)
    .map((c) => `#${c.analysisId} ${c.name}（${c.conditionCount} 条条件）`)
    .join("；");
}

/** provenance 回执（供前端展示「这条候选凭什么」；也让"六项齐备"可被断言）。 */
function buildProvenanceEcho(outcome: ResearchOutcome, candidateId: number | null) {
  return {
    candidateId,
    researchId: outcome.experimentId,
    researchRunId: outcome.runId,
    researchPlanId: outcome.planId,
    datasetVersionId: outcome.datasetVersionId,
    findingIds: outcome.topFindings.map((f) => f.findingId),
    conclusionId: outcome.conclusion?.id ?? null,
    complete:
      outcome.experimentId !== null
      && outcome.runId !== null
      && outcome.planId !== null
      && outcome.datasetVersionId !== null
      && outcome.conclusion?.id !== undefined,
  };
}

/** 默认实例（真实 TiDB；复用 datasetRegistry 的读取层与仓储）。 */
export const researchPlannerRouter = buildResearchPlannerRouter({
  repos: createDbResearchRepositories(),
  reader: new RegistryResearchDatasetReader({ registryRepo: new DbDatasetRegistry() }),
  eventPageSize: DEFAULT_EVENT_PAGE_SIZE,
  maxSamples: DEFAULT_MAX_SAMPLES,
});

export type ResearchPlannerRouter = ReturnType<typeof buildResearchPlannerRouter>;
