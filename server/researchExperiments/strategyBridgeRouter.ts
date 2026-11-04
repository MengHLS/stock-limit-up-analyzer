/**
 * RESEARCH-EXPERIMENT-002 — `experimentStrategy.*` tRPC 端点（Experiment → Strategy）。
 *
 * ## 端点面（一个写口，零新表）
 *
 * | 端点 | 类型 | 作用 |
 * | --- | --- | --- |
 * | `experimentStrategy.createFromExperiment` | mutation（admin） | 真实跑一次实验 → 复用既有转正端口建策略 + 首版本 → 写 Experiment provenance |
 * | `experimentStrategy.createFromEvidenceRuns` | mutation（admin） | 按**已持久化的真实 Run** 建策略（STRATEGY-RESEARCH-BRIDGE-001 §7 / §12）—— 不重跑，直接核实 Run 行 |
 *
 * 读路径**不新增端点**：策略版本的溯源仍由既有
 * `research.strategyCandidate.getVersionProvenance` 提供（它已按 `sourceKind` 分派显示面）。
 * 「不新增第二套读取入口」是本仓的既有纪律。
 *
 * ## 鉴权与错误
 *
 * - 写端点用 `adminProcedure`（与 `researchExperiments.run` / `researchEngine.runEngine` 同口径）；
 * - 领域码写进 message（`[CODE] …`），消费端复用既有 `readRpcDomainCode` / `rpcErrorToDiagnostic`
 *   协议 —— 不新造第二套。
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  experimentParameterValuesSchema,
  type ExperimentParameterValues,
} from "@shared/researchExperimentsContracts";
import { adminProcedure, router } from "../_core/trpc";
import {
  RESEARCH_EVIDENCE_KINDS,
  type ResearchEvidenceRef,
} from "../research/strategyCandidate/researchEvidence";
import {
  EXPERIMENT_STRATEGY_ERROR,
  ExperimentStrategyError,
  type CreateStrategyFromExperimentResult,
  type CreateStrategyFromEvidenceRunsResult,
  type ExperimentStrategyBridge,
} from "./strategyBridge";

/**
 * 领域错误 → tRPC 错误。
 *
 * 🔴 分层纪律：本函数只做「领域码 → tRPC code」的映射，**不重写 message**
 * （领域码已按 `[CODE] …` 写进 message，消费端抠码协议不变）。
 */
function toTrpcError(error: unknown): never {
  if (error instanceof ExperimentStrategyError) {
    const message = `[${error.code}] ${error.message}`;
    switch (error.code) {
      case EXPERIMENT_STRATEGY_ERROR.EXPERIMENT_INVALID:
      case EXPERIMENT_STRATEGY_ERROR.DRAFT_INVALID:
      case EXPERIMENT_STRATEGY_ERROR.EVIDENCE_INVALID:
      case EXPERIMENT_STRATEGY_ERROR.EVIDENCE_REFERENCE_UNRESOLVED:
      case EXPERIMENT_STRATEGY_ERROR.EVIDENCE_DATASET_MISMATCH:
        throw new TRPCError({ code: "BAD_REQUEST", message });
      case EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RUN_NOT_FOUND:
        throw new TRPCError({ code: "NOT_FOUND", message });
      case EXPERIMENT_STRATEGY_ERROR.EXPERIMENT_RUN_FAILED:
      case EXPERIMENT_STRATEGY_ERROR.PROVENANCE_WRITE_FAILED:
      case EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RUN_NOT_COMPLETED:
      case EXPERIMENT_STRATEGY_ERROR.EVIDENCE_RESULT_UNAVAILABLE:
        // tRPC 的 code 集合里没有 FAILED_DEPENDENCY；用 PRECONDITION_FAILED 表达
        // 「请求本身没问题，但执行/回读这一步没成立」——领域码仍在 message 里可抠。
        throw new TRPCError({ code: "PRECONDITION_FAILED", message });
      case EXPERIMENT_STRATEGY_ERROR.STRATEGY_CREATE_FAILED:
      case EXPERIMENT_STRATEGY_ERROR.EVIDENCE_PROVENANCE_CONFLICT:
        throw new TRPCError({ code: "CONFLICT", message });
      default:
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}

/**
 * 草稿入参。
 *
 * 🔴 用**宽松记录**而不是逐键声明（沿用 `PatternCandidateSketch.entryRule.extra` 的既有纪律）：
 * 逐键声明会诱使「只投影自己声明的键」，而 `buildStrategyDefinition` 的必填面会随策略 schema
 * 演进 —— 漏一个键的症状是**创建失败**（`PROMOTE_SKETCH_INCOMPLETE`），而不是一个提示。
 */
const draftSchema = z.strictObject({
  entryRule: z.record(z.string(), z.unknown()),
  /** 执行侧筛选条件（可选）；引用 TUNABLE 参数才可能被参数搜索真正搜到。 */
  filterRule: z.record(z.string(), z.unknown()).optional(),
  parameterSpace: z.record(z.string(), z.record(z.string(), z.unknown())),
  exitRule: z.record(z.string(), z.unknown()),
  riskRule: z.record(z.string(), z.unknown()),
  notes: z.array(z.string()).optional(),
});

const createFromExperimentInputSchema = z.strictObject({
  experimentId: z.string().min(1),
  datasetVersionId: z.number().int().positive(),
  experimentParameters: experimentParameterValuesSchema.optional(),
  strategyId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  draft: draftSchema,
  executionBinding: z
    .strictObject({
      datasetVersionId: z.number().int().positive().optional(),
      datasetDivergenceReason: z.string().min(1).max(512).optional(),
    })
    .optional(),
});

/** 返回值形状（与桥的返回类型逐字对应；此处显式声明以便 router 有 `output()` 可校验）。 */
const createFromExperimentOutputSchema = z.object({
  strategyId: z.string(),
  strategyVersion: z.string(),
  strategyVersionId: z.number().int().positive(),
  created: z.boolean(),
  provenanceId: z.number().int().positive(),
  sourceKind: z.literal("INDEPENDENT_EXPERIMENT"),
  experimentId: z.string(),
  experimentVersion: z.string(),
  experimentParameters: experimentParameterValuesSchema,
  experimentResultDigest: z.string(),
  experimentExecution: z.unknown(),
});

export interface ExperimentStrategyRouterDeps {
  bridge: ExperimentStrategyBridge;
}

// ---------------------------------------------------------------------------
// STRATEGY-RESEARCH-BRIDGE-001 —— 按真实持久化 Run 建策略的入参 / 出参
// ---------------------------------------------------------------------------

/**
 * 单条证据引用。
 *
 * 🔴 调用方**只给 `runId`**：`experimentCode` / `experimentVersion` / `datasetVersionId`
 * 是 Run 行的函数，由服务端从真实 Run 读回 —— 契约上就不给「手写一个不存在的 Run」的机会。
 */
const evidenceRefSchema = z.strictObject({
  runId: z.string().min(1).max(64),
  evidenceKind: z.enum(RESEARCH_EVIDENCE_KINDS),
  reference: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
});

const createFromEvidenceRunsInputSchema = z.strictObject({
  /** 至少一条；`min(1)` 让「空证据建策略」在入参层就被拒。 */
  evidences: z.array(evidenceRefSchema).min(1).max(50),
  strategyId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  draft: draftSchema,
  executionBinding: z
    .strictObject({
      datasetVersionId: z.number().int().positive().optional(),
      datasetDivergenceReason: z.string().min(1).max(512).optional(),
    })
    .optional(),
});

/** 已核实的证据记录（服务端读回的真实 Run 事实 + 结果摘要指纹）。 */
const evidenceRecordOutputSchema = z.object({
  experimentCode: z.string(),
  experimentVersion: z.string(),
  runId: z.string(),
  datasetVersionId: z.number().int().positive(),
  datasetVersionLabel: z.string().nullable(),
  evidenceKind: z.string(),
  reference: z.string(),
  description: z.string().optional(),
  resultDigest: z.string(),
  runStatus: z.string(),
  startedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
});

const createFromEvidenceRunsOutputSchema = z.object({
  strategyId: z.string(),
  strategyVersion: z.string(),
  strategyVersionId: z.number().int().positive(),
  created: z.boolean(),
  provenanceId: z.number().int().positive(),
  sourceKind: z.literal("INDEPENDENT_EXPERIMENT"),
  /**
   * 证据的**内容指纹**（`evi-sha256:…`）。
   * ⚠️ 与 `strategy_versions.fingerprint`（执行语义指纹）同名不同义 —— 见
   * `researchEvidence.ts` 文件头。
   */
  researchEvidenceFingerprint: z.string(),
  evidences: z.array(evidenceRecordOutputSchema),
  datasetVersionId: z.number().int().positive(),
  datasetVersionLabel: z.string().nullable(),
});

/** 构造 router（测试可注入替身桥）。 */
export function buildExperimentStrategyRouter(deps: ExperimentStrategyRouterDeps) {
  return router({
    /**
     * 从独立实验创建策略（真实执行实验 + 写 Experiment provenance）。
     *
     * 失败语义（与桥一致）：实验不可运行 / 草案非法 ⇒ `BAD_REQUEST`；
     * 实验执行失败 ⇒ `FAILED_DEPENDENCY`；策略版本冲突 ⇒ `CONFLICT`；
     * 策略已建但溯源写入失败 ⇒ `FAILED_DEPENDENCY`（消息里带已产生的坐标）。
     */
    createFromExperiment: adminProcedure
      .input(createFromExperimentInputSchema)
      .output(createFromExperimentOutputSchema)
      .mutation(async ({ input }) => {
        try {
          const result: CreateStrategyFromExperimentResult = await deps.bridge.createStrategyFromExperiment({
            experimentId: input.experimentId,
            datasetVersionId: input.datasetVersionId,
            ...(input.experimentParameters !== undefined
              ? { experimentParameters: input.experimentParameters as ExperimentParameterValues }
              : {}),
            strategyId: input.strategyId,
            name: input.name,
            ...(input.description !== undefined ? { description: input.description } : {}),
            draft: input.draft,
            ...(input.executionBinding !== undefined ? { executionBinding: input.executionBinding } : {}),
          });
          return { ...result, experimentExecution: result.experimentExecution };
        } catch (error) {
          toTrpcError(error);
        }
      }),

    /**
     * 按**已持久化的真实 Run** 创建策略（STRATEGY-RESEARCH-BRIDGE-001 §7 / §12 / §19）。
     *
     * 与 `createFromExperiment` 的区别：那条路径**先实时跑一次实验**（`runner.run()` 纯执行、
     * 不落 Run 行）；本路径要求证据指向 `research_experiment_run` 里**真实存在且 `COMPLETED`**
     * 的运行——不重跑、不手写 id、不复制 result.json。
     *
     * 失败语义：证据非法 / Dataset 分歧 ⇒ `BAD_REQUEST`；Run 不存在 ⇒ `NOT_FOUND`；
     * Run 未完成 / 结果读不回 ⇒ `PRECONDITION_FAILED`；版本或证据指纹冲突 ⇒ `CONFLICT`。
     */
    createFromEvidenceRuns: adminProcedure
      .input(createFromEvidenceRunsInputSchema)
      .output(createFromEvidenceRunsOutputSchema)
      .mutation(async ({ input }) => {
        try {
          const result: CreateStrategyFromEvidenceRunsResult =
            await deps.bridge.createStrategyFromEvidenceRuns({
              evidences: input.evidences as readonly ResearchEvidenceRef[],
              strategyId: input.strategyId,
              name: input.name,
              ...(input.description !== undefined ? { description: input.description } : {}),
              draft: input.draft,
              ...(input.executionBinding !== undefined ? { executionBinding: input.executionBinding } : {}),
            });
          return {
            strategyId: result.strategyId,
            strategyVersion: result.strategyVersion,
            strategyVersionId: result.strategyVersionId,
            created: result.created,
            provenanceId: result.provenanceId,
            sourceKind: result.sourceKind,
            researchEvidenceFingerprint: result.researchEvidenceFingerprint,
            evidences: result.evidences.map((e) => ({
              experimentCode: e.experimentCode,
              experimentVersion: e.experimentVersion,
              runId: e.runId,
              datasetVersionId: e.datasetVersionId,
              datasetVersionLabel: e.datasetVersionLabel,
              evidenceKind: e.evidenceKind,
              reference: e.reference,
              ...(e.description !== undefined ? { description: e.description } : {}),
              resultDigest: e.resultDigest,
              runStatus: e.runStatus,
              startedAt: e.startedAt,
              durationMs: e.durationMs,
            })),
            datasetVersionId: result.datasetVersionId,
            datasetVersionLabel: result.datasetVersionLabel,
          };
        } catch (error) {
          toTrpcError(error);
        }
      }),
  });
}

export type ExperimentStrategyRouter = ReturnType<typeof buildExperimentStrategyRouter>;
