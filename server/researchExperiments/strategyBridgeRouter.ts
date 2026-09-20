/**
 * RESEARCH-EXPERIMENT-002 — `experimentStrategy.*` tRPC 端点（Experiment → Strategy）。
 *
 * ## 端点面（一个写口，零新表）
 *
 * | 端点 | 类型 | 作用 |
 * | --- | --- | --- |
 * | `experimentStrategy.createFromExperiment` | mutation（admin） | 真实跑一次实验 → 复用既有转正端口建策略 + 首版本 → 写 Experiment provenance |
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
  EXPERIMENT_STRATEGY_ERROR,
  ExperimentStrategyError,
  type CreateStrategyFromExperimentResult,
  type ExperimentStrategyBridge,
} from "./strategyBridge";

/** 领域错误 → tRPC 错误。 */
function toTrpcError(error: unknown): never {
  if (error instanceof ExperimentStrategyError) {
    const message = `[${error.code}] ${error.message}`;
    switch (error.code) {
      case EXPERIMENT_STRATEGY_ERROR.EXPERIMENT_INVALID:
      case EXPERIMENT_STRATEGY_ERROR.DRAFT_INVALID:
        throw new TRPCError({ code: "BAD_REQUEST", message });
      case EXPERIMENT_STRATEGY_ERROR.EXPERIMENT_RUN_FAILED:
      case EXPERIMENT_STRATEGY_ERROR.PROVENANCE_WRITE_FAILED:
        // tRPC 的 code 集合里没有 FAILED_DEPENDENCY；用 PRECONDITION_FAILED 表达
        // 「请求本身没问题，但执行/回写这一步没成立」——领域码仍在 message 里可抠。
        throw new TRPCError({ code: "PRECONDITION_FAILED", message });
      case EXPERIMENT_STRATEGY_ERROR.STRATEGY_CREATE_FAILED:
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
  });
}

export type ExperimentStrategyRouter = ReturnType<typeof buildExperimentStrategyRouter>;
