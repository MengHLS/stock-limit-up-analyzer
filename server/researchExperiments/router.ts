/**
 * RESEARCH-EXPERIMENT-004 — 独立研究实验体系 tRPC 端点（含 Run 持久化）。
 *
 * ## 端点面
 *
 * | 端点 | 类型 | 作用 |
 * | --- | --- | --- |
 * | `researchExperiments.list` | query | 实验摘要列表（描述符 + Run 数 + 最近 Run） |
 * | `researchExperiments.get` | query | 单个实验详情（描述符 + 该实验的 Run 列表） |
 * | `researchExperiments.listDatasetVersions` | query | 可选的 Dataset 版本目录（前端选择器） |
 * | `researchExperiments.listRuns` | query | 跨实验 / 单实验的历史 Run 列表 |
 * | `researchExperiments.getRun` | query | 单条 Run 的完整视图（元数据 + Manifest + Result + 产物元数据） |
 * | `researchExperiments.getRunResultManifest` | query | 单条 Run 的 `manifest.json` |
 * | `researchExperiments.getArtifactMetadata` | query | 单个 Artifact 的元数据（含实测存在性） |
 * | `researchExperiments.run` | mutation | 执行一次实验（**走完整生命周期并持久化**） |
 * | `researchExperiments.reconcileRun` | mutation | 把卡住的 `RUNNING` 收敛为 `FAILED`（admin） |
 *
 * ## 纪律（与 001 一致，本任务只做扩展）
 *
 * 1. **读用 `publicProcedure`、执行与收敛用 `adminProcedure`**；
 * 2. **领域码写进 message**（`[CODE] …`）—— 前端只认既有 `readRpcDomainCode` 抠码协议；
 * 3. **凭据永不出服务端**：前端只拿 Object Key 与元数据；内容一律经后端代理
 *    （Express 路由 `/api/experiments/artifact`，见 `server/experimentArtifactRoutes.ts`）。
 *
 * 🔴 「扩展而不是新建」：`list` / `get` / `run` 是本体系**既有**端点（001 建立），
 *    本任务只把它们的输出**加宽**（描述符 → 摘要；outcome → outcome + 持久化坐标），
 *    没有另开一套 `listExperiments` / `getExperiment` 的同义端点。
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  experimentArtifactMetadataSchema,
  experimentDatasetVersionOptionSchema,
  experimentDetailSchema,
  experimentRunDetailSchema,
  experimentRunExecutionResultSchema,
  experimentRunManifestSchema,
  experimentRunRecordSchema,
  experimentSummarySchema,
  getArtifactInputSchema,
  getExperimentInputSchema,
  getRunInputSchema,
  getRunResultManifestInputSchema,
  listExperimentsInputSchema,
  listRunsInputSchema,
  reconcileRunInputSchema,
  runExperimentInputSchema,
  type ExperimentRunRecord,
} from "@shared/researchExperimentsContracts";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import type { ExperimentDatasetPort } from "./datasetPort";
import { defaultResearchExperimentsDeps } from "./defaults";
import { ExperimentError } from "./errors";
import type { ExperimentRunService } from "./persistence/runService";
import type { ExperimentRunner } from "./runner";

/** 领域错误 → tRPC 错误（领域码进 message；不改 tRPC code 语义之外的任何东西）。 */
function toTrpcError(error: unknown): never {
  if (error instanceof ExperimentError) {
    const message = `[${error.code}] ${error.message}`;
    switch (error.code) {
      case "EXPERIMENT_NOT_FOUND":
      case "EXPERIMENT_DATASET_VERSION_NOT_FOUND":
      case "EXPERIMENT_RUN_NOT_FOUND":
      case "EXPERIMENT_ARTIFACT_NOT_FOUND":
        throw new TRPCError({ code: "NOT_FOUND", message });
      case "EXPERIMENT_METADATA_INVALID":
      case "EXPERIMENT_PARAMETER_INVALID":
      case "EXPERIMENT_DATASET_REQUIREMENT_INVALID":
      case "EXPERIMENT_DATASET_CODE_MISMATCH":
      case "EXPERIMENT_FORWARD_DATA_FORBIDDEN":
      case "EXPERIMENT_FORWARD_DATA_PURPOSE_MISSING":
      case "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE":
      case "EXPERIMENT_ARTIFACT_KEY_INVALID":
      case "EXPERIMENT_RUN_STATE_INVALID":
      case "EXPERIMENT_MANIFEST_INVALID":
      case "EXPERIMENT_PROTOCOL_INVALID":
      case "EXPERIMENT_PROTOCOL_PHASE_CONFLICT":
      case "EXPERIMENT_PROTOCOL_PARAMETERS_FROZEN":
      case "EXPERIMENT_CONFIRMATORY_GATE_INVALID":
        throw new TRPCError({ code: "BAD_REQUEST", message });
      case "EXPERIMENT_DATASET_VERSION_NOT_READY":
        throw new TRPCError({ code: "PRECONDITION_FAILED", message });
      case "EXPERIMENT_ARTIFACT_STORAGE_UNAVAILABLE":
      case "EXPERIMENT_ARTIFACT_UPLOAD_FAILED":
        // 依赖不可用 ≠ 请求错 ⇒ 用「服务端依赖不可用」的语义码，而不是 BAD_REQUEST。
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
      case "EXPERIMENT_RUN_ID_CONFLICT":
        throw new TRPCError({ code: "CONFLICT", message });
      default:
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}

/** Run 事实不可用时的如实编码（**不用空数组冒充「没有 Run」**）。 */
function describeRunAccessError(error: unknown): { code: string; message: string } {
  if (error instanceof ExperimentError) return { code: error.code, message: error.message };
  return {
    code: "EXPERIMENT_RUN_QUERY_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

export interface ResearchExperimentsRouterDeps {
  runner: ExperimentRunner;
  datasetPort: ExperimentDatasetPort;
  /** RESEARCH-EXPERIMENT-004：Run 持久化编排。 */
  runService: ExperimentRunService;
}

/** 构造 router（测试可注入内存替身）。 */
export function buildResearchExperimentsRouter(deps: ResearchExperimentsRouterDeps) {
  return router({
    /** 实验摘要列表（描述符 + Run 数 + 最近 Run）。 */
    list: publicProcedure
      .input(listExperimentsInputSchema)
      .output(experimentSummarySchema.array())
      .query(async ({ input }) => {
        const all = deps.runner.listDescriptors();
        const wanted = input?.datasetCode;
        const descriptors =
          wanted === undefined
            ? all
            : all.filter((descriptor) => descriptor.datasetRequirement.datasetCode === wanted);

        // Run 事实来自 DB：取不到就如实标注，而不是让整页 500 或用 0 冒充。
        let latest = new Map<string, ExperimentRunRecord>();
        let counts = new Map<string, number>();
        let runsError: { code: string; message: string } | null = null;
        try {
          const [latestRuns, typedCounts] = await Promise.all([
            deps.runService.latestRunByExperiment(),
            Promise.all(
              descriptors.map(async (d) => [d.id, await deps.runService.countRunsByExperiment(d.id)] as const),
            ),
          ]);
          latest = latestRuns;
          counts = new Map(typedCounts);
        } catch (error) {
          runsError = describeRunAccessError(error);
        }

        return descriptors.map((descriptor) => ({
          descriptor,
          runCount: counts.get(descriptor.id) ?? 0,
          latestRun: latest.get(descriptor.id) ?? null,
          runsAvailable: runsError === null,
          runsError,
        }));
      }),

    /** 单个实验详情（描述符 + 该实验的 Run 列表）。 */
    get: publicProcedure
      .input(getExperimentInputSchema)
      .output(experimentDetailSchema)
      .query(async ({ input }) => {
        let descriptor;
        try {
          descriptor = deps.runner.requireDescriptor(input.experimentId);
        } catch (error) {
          toTrpcError(error);
        }
        try {
          const runs = await deps.runService.listRuns({
            experimentId: descriptor.id,
            limit: 200,
            offset: input.runOffset ?? 0,
          });
          return { descriptor, runs, runsAvailable: true, runsError: null };
        } catch (error) {
          // 描述符取到了（它不是 DB 事实）⇒ 仍返回描述符，只是 Run 列表不可用。
          return {
            descriptor,
            runs: [],
            runsAvailable: false,
            runsError: describeRunAccessError(error),
          };
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

    /** 历史 Run 列表（可按实验过滤）。 */
    listRuns: publicProcedure
      .input(listRunsInputSchema)
      .output(experimentRunRecordSchema.array())
      .query(async ({ input }) => {
        try {
          return await deps.runService.listRuns({
            ...(input?.experimentId !== undefined ? { experimentId: input.experimentId } : {}),
            ...(input?.limit !== undefined ? { limit: input.limit } : {}),
            ...(input?.offset !== undefined ? { offset: input.offset } : {}),
          });
        } catch (error) {
          toTrpcError(error);
        }
      }),

    /** 单条 Run 的完整视图。 */
    getRun: publicProcedure
      .input(getRunInputSchema)
      .output(experimentRunDetailSchema)
      .query(async ({ input }) => {
        try {
          return await deps.runService.readRunDetail(input.runId);
        } catch (error) {
          toTrpcError(error);
        }
      }),

    /** 单条 Run 的 `manifest.json`（`null` = 该 Run 没有 Manifest，如已失败）。 */
    getRunResultManifest: publicProcedure
      .input(getRunResultManifestInputSchema)
      .output(experimentRunManifestSchema.nullable())
      .query(async ({ input }) => {
        try {
          return await deps.runService.readManifest(input.runId);
        } catch (error) {
          toTrpcError(error);
        }
      }),

    /**
     * 单个 Artifact 的元数据（含**实测**存在性）。
     *
     * 🔴 只返回元数据，不返回内容：内容走 `GET /api/experiments/artifact`
     *    （浏览器 → 应用 API → 对象存储；规格 §18）。这样即使 8 MB 的 Parquet 也不会
     *    在页面初始化时被无意拉到浏览器里。
     */
    getArtifactMetadata: publicProcedure
      .input(getArtifactInputSchema)
      .output(experimentArtifactMetadataSchema)
      .query(async ({ input }) => {
        try {
          const detail = await deps.runService.readRunDetail(input.runId);
          const found = detail.artifacts.find((item) => item.ref.key === input.key);
          if (!found) {
            throw new ExperimentError(
              "EXPERIMENT_ARTIFACT_NOT_FOUND",
              `对象 "${input.key}" 不在 Run "${input.runId}" 的 Manifest 索引里`,
              { runId: input.runId, key: input.key },
            );
          }
          return found;
        } catch (error) {
          toTrpcError(error);
        }
      }),

    /**
     * 执行一次实验 —— 走完整生命周期并**持久化**（规格 §12）。
     *
     * 返回 `{ persisted, run, outcome }`：
     *   - `run.status === "COMPLETED"` ⇒ 结果与 Manifest 已确实写入对象存储；
     *   - `run.status === "FAILED"` 且 `outcome.runStatus === "SUCCEEDED"` ⇒
     *     **实验算完了但产物没落存储**（规格 §13 情况 A 的正确表现），页面必须响亮提示；
     *   - 「请求本身不成立」（未注册 / 参数越界 / 版本非 READY）仍走 tRPC 错误。
     */
    run: adminProcedure
      .input(runExperimentInputSchema)
      .output(experimentRunExecutionResultSchema)
      .mutation(async ({ input }) => {
        try {
          return await deps.runService.execute({
            experimentId: input.experimentId,
            datasetVersionId: input.datasetVersionId,
            ...(input.auxiliaryDatasetVersionIds !== undefined
              ? { auxiliaryDatasetVersionIds: input.auxiliaryDatasetVersionIds }
              : {}),
            ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
            ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
          });
        } catch (error) {
          toTrpcError(error);
        }
      }),

    /**
     * 异步启动一次实验：只创建 Run 并入队，立即返回 Run 记录。
     *
     * 页面应使用本端点；`run` 仅保留给同步测试 / 维护工具，禁止长请求页面再依赖它。
     */
    startRun: adminProcedure
      .input(runExperimentInputSchema)
      .output(experimentRunRecordSchema)
      .mutation(async ({ input }) => {
        try {
          return await deps.runService.start({
            experimentId: input.experimentId,
            datasetVersionId: input.datasetVersionId,
            ...(input.auxiliaryDatasetVersionIds !== undefined
              ? { auxiliaryDatasetVersionIds: input.auxiliaryDatasetVersionIds }
              : {}),
            ...(input.parameters !== undefined ? { parameters: input.parameters } : {}),
            ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
          });
        } catch (error) {
          toTrpcError(error);
        }
      }),

    /** 把一条卡住的 `RUNNING` 收敛为 `FAILED`（人为判定，必须给 reason）。 */
    reconcileRun: adminProcedure
      .input(reconcileRunInputSchema)
      .output(experimentRunRecordSchema)
      .mutation(async ({ input }) => {
        try {
          return await deps.runService.reconcileRun(input.runId, input.reason);
        } catch (error) {
          toTrpcError(error);
        }
      }),
  });
}

/** 默认实例（真实 TiDB + 真实清单 + 真实对象存储）。 */
export const researchExperimentsRouter = buildResearchExperimentsRouter(
  defaultResearchExperimentsDeps(),
);

export type ResearchExperimentsRouter = ReturnType<typeof buildResearchExperimentsRouter>;
