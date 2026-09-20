/**
 * RESEARCH-EXPERIMENT-001 — 独立研究实验体系 tRPC 端点。
 *
 * ## 端点面（**零新表、零写口**）
 *
 * | 端点 | 类型 | 作用 |
 * | --- | --- | --- |
 * | `researchExperiments.list` | query | 已注册实验的描述符列表 |
 * | `researchExperiments.get` | query | 单个实验的描述符 |
 * | `researchExperiments.listDatasetVersions` | query | 可选的 Dataset 版本目录（前端选择器） |
 * | `researchExperiments.run` | mutation | 执行一次实验，返回完整执行事实 + 结果 |
 *
 * ## 三条纪律
 *
 * 1. **读用 `publicProcedure`、执行用 `adminProcedure`** —— 与既有研究链路一致
 *    （`researchEngine.runEngine` / `researchRun.loopRun` 都是 `adminProcedure`）；
 * 2. **领域码写进 message**（`[CODE] …`）—— `toTrpcError` 不带 `cause`，
 *    前端只认既有那一套 `readRpcDomainCode` 抠码协议，不新造第二套；
 * 3. **写口为零** —— 本 router 不含任何落库操作（执行结果通过返回值交付）。
 *    这也是「不新增数据库表」的兑现方式：实验执行是**请求内计算**，
 *    与 `researchEngine.runEngine` 同形，不引入新持久化面。
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  experimentDatasetVersionOptionSchema,
  experimentDescriptorSchema,
  experimentRunOutcomeSchema,
  getExperimentInputSchema,
  listExperimentsInputSchema,
  runExperimentInputSchema,
} from "@shared/researchExperimentsContracts";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import type { ExperimentDatasetPort } from "./datasetPort";
import { defaultResearchExperimentsDeps } from "./defaults";
import { ExperimentError } from "./errors";
import type { ExperimentRunner } from "./runner";

/** 领域错误 → tRPC 错误（领域码进 message；不改 tRPC code 语义之外的任何东西）。 */
function toTrpcError(error: unknown): never {
  if (error instanceof ExperimentError) {
    const message = `[${error.code}] ${error.message}`;
    switch (error.code) {
      case "EXPERIMENT_NOT_FOUND":
      case "EXPERIMENT_DATASET_VERSION_NOT_FOUND":
        throw new TRPCError({ code: "NOT_FOUND", message });
      case "EXPERIMENT_METADATA_INVALID":
      case "EXPERIMENT_PARAMETER_INVALID":
      case "EXPERIMENT_DATASET_REQUIREMENT_INVALID":
      case "EXPERIMENT_DATASET_CODE_MISMATCH":
      case "EXPERIMENT_FORWARD_DATA_FORBIDDEN":
      case "EXPERIMENT_FORWARD_DATA_PURPOSE_MISSING":
      case "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE":
        throw new TRPCError({ code: "BAD_REQUEST", message });
      case "EXPERIMENT_DATASET_VERSION_NOT_READY":
        throw new TRPCError({ code: "PRECONDITION_FAILED", message });
      default:
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}

export interface ResearchExperimentsRouterDeps {
  runner: ExperimentRunner;
  datasetPort: ExperimentDatasetPort;
}

/** 构造 router（测试可注入内存替身）。 */
export function buildResearchExperimentsRouter(deps: ResearchExperimentsRouterDeps) {
  return router({
    /** 已注册实验列表（可按数据集语义代码过滤）。 */
    list: publicProcedure
      .input(listExperimentsInputSchema)
      .output(experimentDescriptorSchema.array())
      .query(({ input }) => {
        const all = deps.runner.listDescriptors();
        const wanted = input?.datasetCode;
        if (wanted === undefined) return all;
        return all.filter((descriptor) => descriptor.datasetRequirement.datasetCode === wanted);
      }),

    /** 单个实验的描述符。 */
    get: publicProcedure
      .input(getExperimentInputSchema)
      .output(experimentDescriptorSchema)
      .query(({ input }) => {
        try {
          return deps.runner.requireDescriptor(input.experimentId);
        } catch (error) {
          toTrpcError(error);
        }
      }),

    /** 可选的 Dataset 版本目录（只读）。 */
    listDatasetVersions: publicProcedure
      .input(z.object({ datasetCode: z.string().min(1) }).optional())
      .output(experimentDatasetVersionOptionSchema.array())
      .query(({ input }) => {
        return deps.datasetPort.listVersionOptions(
          input?.datasetCode !== undefined ? { datasetCode: input.datasetCode } : undefined,
        );
      }),

    /**
     * 执行一次实验。
     *
     * 返回值里 `runStatus === "FAILED"` 表示**执行期**失败（`result: null` + `error` 有值）；
     * 而「请求本身不成立」（未注册 / 参数越界 / 版本非 READY）走 tRPC 错误。
     */
    run: adminProcedure
      .input(runExperimentInputSchema)
      .output(experimentRunOutcomeSchema)
      .mutation(async ({ input }) => {
        try {
          return await deps.runner.run({
            experimentId: input.experimentId,
            datasetVersionId: input.datasetVersionId,
            ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
          });
        } catch (error) {
          toTrpcError(error);
        }
      }),
  });
}

/** 默认实例（真实 TiDB + 真实清单）。 */
export const researchExperimentsRouter = buildResearchExperimentsRouter(
  defaultResearchExperimentsDeps(),
);

export type ResearchExperimentsRouter = ReturnType<typeof buildResearchExperimentsRouter>;
