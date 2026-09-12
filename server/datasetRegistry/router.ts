/**
 * STEP DATASET-002.2 / 002.4A / 003A — datasetRegistry tRPC Router。
 *
 * 写端点（全部 adminProcedure，DDL/DML 一律在后端领域层执行，前端不得直连数据库）：
 *   - 数据集级：createDatasetDefinition / updateDefinition / archiveDefinition / deleteDatasetDefinition（级联 + DROP 表）；
 *   - 版本级：createDatasetVersion / deleteDatasetVersion（删数据保留表结构）；
 *   - 作业级：createBuildJob / startBuildJob / cancelBuildJob / retryBuildJob；
 *   - 只读：listDefinitions / getDefinition / listVersions / getVersion / listJobs / getJob /
 *     getStatistics / listEvents / listPaths / listOutcomes / listDatasetPlugins（构建插件）。
 *
 * 纪律：
 * - **禁止任意 tableName 进 SQL**：本 router 绝不接收 tableName 入参；物理表名只在
 *   Registry 已验证的 dataset_definition.eventTableName/pathTableName/outcomeTableName 中读取，
 *   或由 datasetCode 经命名规范派生，且经 physicalTables.assertSafeTableName 白名单校验；
 * - **多数据集**：构建能力由 plugins 注册表按 datasetCode 决定，未注册 → BUILDER_NOT_REGISTERED；
 * - **keyset 分页**：Event/Path/Outcome 绝不 `SELECT *` 全量返回；
 * - **诚实 null / 诚实拒绝**：get 端点未命中返回 NOT_FOUND；删除被守卫拒绝时返回稳定错误码。
 */

import { TRPCError } from "@trpc/server";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { DbDatasetRegistry } from "./db";
import {
  DbDatasetDataReader,
  DatasetQueryService,
  decodeEventCursor,
  decodeOutcomeCursor,
  decodePathCursor,
  toBuildConfigView,
  toDefinitionListItem,
  toJobListItem,
  toVersionListItem,
  type DatasetDataReader,
} from "./query";
import {
  DEFAULT_STALE_BUILD_MINUTES,
  DatasetRegistryService,
  type DatasetRegistryRepository,
  type ReclaimStaleJobResult,
} from "./registry";
import { DatasetLifecycleError, type DatasetLifecycleErrorCode } from "./lifecycle";
import { DbDatasetPhysicalStore, type DatasetPhysicalStore } from "./physicalTables";
import {
  defaultDatasetPluginRegistry,
  resolvePluginTables,
  type DatasetPluginRegistry,
} from "./plugins";
import {
  BUILD_STOP_TIMEOUT_MS,
  DefaultDatasetBuildRunner,
  type DatasetBuildRunner,
} from "./runner";
import {
  DATASET_PAGE_LIMIT_DEFAULT,
  archiveDefinitionInputSchema,
  cancelBuildJobInputSchema,
  createBuildJobInputSchema,
  createDatasetDefinitionInputSchema,
  createDatasetVersionInputSchema,
  deleteDatasetDefinitionInputSchema,
  deleteDatasetVersionInputSchema,
  eventPageInputSchema,
  getBuildConfigInputSchema,
  getDefinitionInputSchema,
  getJobInputSchema,
  getStatisticsInputSchema,
  getVersionInputSchema,
  listJobsInputSchema,
  listVersionsInputSchema,
  outcomePageInputSchema,
  pathPageInputSchema,
  rawBarPageInputSchema,
  retryBuildJobInputSchema,
  startBuildJobInputSchema,
  updateDefinitionInputSchema,
} from "../../shared/datasetRegistryContracts";

function assertDateRange(fromDate?: string, toDate?: string): void {
  if (fromDate && toDate && fromDate > toDate) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "fromDate 不能晚于 toDate" });
  }
}

/** 把领域生命周期错误码映射为稳定的 tRPC code。 */
function mapLifecycleErrorToTrpc(code: DatasetLifecycleErrorCode): TRPCError["code"] {
  switch (code) {
    case "JOB_NOT_FOUND":
    case "VERSION_NOT_FOUND":
    case "DEFINITION_NOT_FOUND":
      return "NOT_FOUND";
    case "INVALID_JOB_TRANSITION":
    case "INVALID_VERSION_TRANSITION":
    case "JOB_ALREADY_RUNNING":
    case "VERSION_ALREADY_EXISTS":
      return "CONFLICT";
    case "DEFINITION_ARCHIVED":
      return "PRECONDITION_FAILED";
    case "VERSION_NOT_BUILDABLE":
      return "PRECONDITION_FAILED";
    case "BUILDER_NOT_REGISTERED":
      return "PRECONDITION_FAILED";
    case "VERSION_HAS_RUNNING_JOB":
    case "DEFINITION_HAS_RUNNING_JOB":
      return "CONFLICT";
    case "INVALID_VERSION_LABEL":
    case "INVALID_BUILD_FILTER":
      return "BAD_REQUEST";
    case "CHECKPOINT_INCOMPATIBLE":
      return "PRECONDITION_FAILED";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}

function toTrpcError(e: unknown): never {
  if (e instanceof DatasetLifecycleError) {
    throw new TRPCError({ code: mapLifecycleErrorToTrpc(e.code), message: e.message });
  }
  throw e;
}

type CursorKind = "event" | "path" | "outcome";

function decodeCursorOrThrow(
  cursor: string | undefined,
  kind: CursorKind,
): ReturnType<typeof decodeEventCursor> | ReturnType<typeof decodePathCursor> | ReturnType<typeof decodeOutcomeCursor> {
  if (!cursor) return null;
  const decoded =
    kind === "event" ? decodeEventCursor(cursor) : kind === "path" ? decodePathCursor(cursor) : decodeOutcomeCursor(cursor);
  if (!decoded) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cursor 非法或已损坏，请原样回传上次返回的 nextCursor" });
  }
  return decoded;
}

export interface DatasetRegistryRouterDeps {
  repo: DatasetRegistryRepository;
  reader: DatasetDataReader;
  registryService?: DatasetRegistryService;
  /**
   * 构建插件注册表（多数据集）：决定哪些 datasetCode 可构建、用什么表结构 / IO / 构建器。
   * 缺省 = 生产内置插件集合（当前含 first_limit_pullback）。
   */
  pluginRegistry?: DatasetPluginRegistry;
  /** 物理表存储（建表 / 清版本数据 / DROP 表）；缺省构造真实 DB 实现。 */
  physicalStore?: DatasetPhysicalStore;
  /** 构建执行器；缺省按 pluginRegistry + physicalStore 自动构造。 */
  buildRunner?: DatasetBuildRunner;
}

export function buildDatasetRegistryRouter(deps: DatasetRegistryRouterDeps) {
  const plugins = deps.pluginRegistry ?? defaultDatasetPluginRegistry;
  const physicalStore = deps.physicalStore ?? new DbDatasetPhysicalStore();
  const service =
    deps.registryService ?? new DatasetRegistryService(deps.repo, { plugins, physicalStore });
  const query = new DatasetQueryService(deps.repo, deps.reader, (code) => plugins.has(code));
  const runner: DatasetBuildRunner =
    deps.buildRunner ?? new DefaultDatasetBuildRunner({ repo: deps.repo, service, plugins });

  /** 统一把「定义」映射为 wire（附带 buildable）。 */
  const definitionToWire = (def: Parameters<typeof toDefinitionListItem>[0]) =>
    toDefinitionListItem(def, plugins.has(def.datasetCode));

  return router({
    // ---- Plugin（只读：已注册的构建插件，供前端判断可构建性 / 展示物理表）----
    listDatasetPlugins: publicProcedure.query(() => ({
      plugins: plugins.list().map((p) => ({
        datasetCode: p.datasetCode,
        displayName: p.displayName,
        description: p.description,
        physicalTables: resolvePluginTables(p, p.datasetCode).map((t) => ({
          role: t.role,
          label: t.label,
          tableName: t.tableName,
        })),
      })),
    })),

    // ---- Definition ----
    listDefinitions: publicProcedure.query(async () => query.listDefinitions()),

    getDefinition: publicProcedure
      .input(getDefinitionInputSchema)
      .query(async ({ input }) => {
        const def = await query.getDefinition(input.definitionId);
        if (!def) throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Dataset 定义：${input.definitionId}` });
        return def;
      }),

    /** 新建 Dataset 定义（admin）：插件已注册时同时建立物理表。 */
    createDatasetDefinition: adminProcedure
      .input(createDatasetDefinitionInputSchema)
      .mutation(async ({ input }) => {
        try {
          const created = await service.createDefinition({
            datasetCode: input.datasetCode,
            name: input.name,
            datasetType: input.datasetType,
            ...(input.description !== undefined ? { description: input.description } : {}),
          });
          return definitionToWire(created);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    updateDefinition: adminProcedure
      .input(updateDefinitionInputSchema)
      .mutation(async ({ input }) => {
        const updated = await service.updateDefinition({
          definitionId: input.definitionId,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        });
        return definitionToWire(updated);
      }),

    archiveDefinition: adminProcedure
      .input(archiveDefinitionInputSchema)
      .mutation(async ({ input }) => {
        const archived = await service.archiveDefinition(input.definitionId);
        return definitionToWire(archived);
      }),

    /**
     * 删除 Dataset 定义（admin，危险操作）：级联删除版本数据 + 作业 + DROP 物理表 + 定义记录。
     * 必须回传与落库一致的 confirmDatasetCode（二次确认，防误删）。
     */
    deleteDatasetDefinition: adminProcedure
      .input(deleteDatasetDefinitionInputSchema)
      .mutation(async ({ input }) => {
        try {
          const def = await deps.repo.getDefinitionById(input.definitionId);
          if (!def) {
            throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Dataset 定义：${input.definitionId}` });
          }
          if (def.datasetCode !== input.confirmDatasetCode) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `确认用的 datasetCode 不匹配（期望 "${def.datasetCode}"，收到 "${input.confirmDatasetCode}"）`,
            });
          }
          return await service.deleteDefinition(input.definitionId);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- Version ----
    listVersions: publicProcedure
      .input(listVersionsInputSchema)
      .query(async ({ input }) => query.listVersions(input.datasetId)),

    getVersion: publicProcedure
      .input(getVersionInputSchema)
      .query(async ({ input }) => {
        const version = await query.getVersion(input.datasetVersionId);
        if (!version) throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Dataset 版本：${input.datasetVersionId}` });
        return version;
      }),

    // ---- Create Version（admin 写端点：建版本 + 固化筛选配置，新版本以 DRAFT 落地）----
    createDatasetVersion: adminProcedure
      .input(createDatasetVersionInputSchema)
      .mutation(async ({ input }) => {
        try {
          const version = await service.createVersionWithBuildConfig({
            datasetId: input.datasetId,
            version: input.version,
            startDate: input.startDate,
            endDate: input.endDate,
            filter: input.filter,
          });
          return toVersionListItem(version);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * 读取某版本已固化的构建 / 筛选配置（只读）。
     * 历史版本（DATASET-001/002 创建）无配置行 → 返回 null（不臆造）。
     */
    getBuildConfig: publicProcedure
      .input(getBuildConfigInputSchema)
      .query(async ({ input }) => {
        const config = await service.getBuildConfig(input.datasetVersionId);
        return config ? toBuildConfigView(config) : null;
      }),

    /** 解析某版本「构建时实际会用的」配置（配置行 → 历史镜像 → 权威默认）。 */
    resolveBuildConfig: publicProcedure
      .input(getBuildConfigInputSchema)
      .query(async ({ input }) => {
        try {
          return await service.resolveBuildConfigForVersion(input.datasetVersionId);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * 删除 Dataset 版本（admin，危险操作）：
     * 删除该版本物理表数据行（**保留表结构**）+ 全部构建作业 + 版本记录。
     * 存在 RUNNING 作业 → 拒绝（先取消或等待结束）。
     */
    deleteDatasetVersion: adminProcedure
      .input(deleteDatasetVersionInputSchema)
      .mutation(async ({ input }) => {
        try {
          return await service.deleteVersion(input.datasetVersionId);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- Build Job ----
    listJobs: publicProcedure
      .input(listJobsInputSchema)
      .query(async ({ input }) => query.listJobs(input.datasetVersionId)),

    getJob: publicProcedure
      .input(getJobInputSchema)
      .query(async ({ input }) => {
        const job = await query.getJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `未找到构建作业：${input.jobId}` });
        return job;
      }),

    // ---- Build Lifecycle（admin 写端点：create/start/cancel/retry）----
    createBuildJob: adminProcedure
      .input(createBuildJobInputSchema)
      .mutation(async ({ input }) => {
        try {
          return toJobListItem(await service.createJob(input.datasetVersionId));
        } catch (e) {
          toTrpcError(e);
        }
      }),

    startBuildJob: adminProcedure
      .input(startBuildJobInputSchema)
      .mutation(async ({ input }) => {
        try {
          // 1) 状态机：PENDING → RUNNING（含 §六 全部前置校验，原子转换防并发重复 start）
          const job = await service.startJob(input.jobId);
          // 2) 真正执行：异步启动构建器（立即返回，进度写库供前端轮询）
          if (runner) {
            try {
              await runner.start(job.jobId);
            } catch (launchErr) {
              // 执行器启动失败 → 不留下「假 RUNNING」作业
              const message = launchErr instanceof Error ? launchErr.message : String(launchErr);
              try {
                await service.failJob(job.jobId, `构建执行器启动失败：${message}`);
              } catch {
                // 作业状态已变更，忽略
              }
              throw launchErr;
            }
          }
          return toJobListItem(job);
        } catch (e) {
          toTrpcError(e);
        }
      }),

    /**
     * 取消构建作业（admin）—— **取消 = 回滚，不是暂停**。
     *
     * 固定顺序（任一步换序都会留下残余数据）：
     *   1. 置协作式取消标志；
     *   2. `waitForStop` 等执行体**真正退出**（含在途 INSERT 落盘）；
     *   3. 作业 → CANCELLED、版本 BUILDING → FAILED；
     *   4. 清空该版本 `ds_*` 全部数据行（保留表结构），使「取消后重建」不可能新旧混合。
     *
     * 执行体未在超时内停止 → 只落状态、**不回滚**（诚实：不做「删了又被写回」的假动作），
     * 并在响应里说明原因；用户稍后再次取消即可（`cancelJobAndRollback` 对已取消作业幂等）。
     */
    cancelBuildJob: adminProcedure
      .input(cancelBuildJobInputSchema)
      .mutation(async ({ input }) => {
        try {
          // 1) 先停写入者：置标志 + 等待执行体退出（顺序不能反，否则回滚会被在途写入写回）。
          runner.cancel(input.jobId);
          const stopped = await runner.waitForStop(input.jobId);

          if (!stopped) {
            // 执行体未停止 → 仅落终态（保持既有语义），不删数据、不伪装成功。
            const job = await service.cancelJob(input.jobId);
            return {
              ...toJobListItem(job),
              rollback: null,
              rollbackSkippedReason:
                `构建执行体未在 ${Math.round(BUILD_STOP_TIMEOUT_MS / 1000)} 秒内停止，` +
                `已置为取消但**未回滚数据**；请稍后再次取消以清理已落库的残留行。`,
            };
          }

          // 2) 落终态 + 回滚该版本已落库数据。
          const { job, rollback, rollbackSkippedReason, alreadyCancelled } =
            await service.cancelJobAndRollback(input.jobId);
          return {
            ...toJobListItem(job),
            alreadyCancelled,
            rollback: rollback
              ? {
                  purgedRows: rollback.purgedRows,
                  tables: rollback.tables.map((t) => ({
                    table: t.table,
                    deleted: t.deleted,
                    tableMissing: t.tableMissing,
                  })),
                }
              : null,
            rollbackSkippedReason,
          };
        } catch (e) {
          toTrpcError(e);
        }
      }),

    retryBuildJob: adminProcedure
      .input(retryBuildJobInputSchema)
      .mutation(async ({ input }) => {
        try {
          return toJobListItem(await service.retryJob(input.jobId));
        } catch (e) {
          toTrpcError(e);
        }
      }),

    // ---- Statistics ----
    getStatistics: publicProcedure
      .input(getStatisticsInputSchema)
      .query(async ({ input }) => {
        const stats = await query.getStatistics(input.datasetVersionId);
        if (!stats) throw new TRPCError({ code: "NOT_FOUND", message: `未找到 Dataset 版本：${input.datasetVersionId}` });
        return stats;
      }),

    // ---- Event（keyset 分页）----
    listEvents: publicProcedure
      .input(eventPageInputSchema)
      .query(async ({ input }) => {
        assertDateRange(input.fromDate, input.toDate);
        const cursor = decodeCursorOrThrow(input.cursor, "event");
        return query.listEvents({
          datasetVersionId: input.datasetVersionId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          cursor: cursor as { tradeDate: string; eventId: string } | null,
          limit: input.limit ?? DATASET_PAGE_LIMIT_DEFAULT,
        });
      }),

    // ---- Path（keyset 分页）----
    listPaths: publicProcedure
      .input(pathPageInputSchema)
      .query(async ({ input }) => {
        assertDateRange(input.fromDate, input.toDate);
        const cursor = decodeCursorOrThrow(input.cursor, "path");
        return query.listPaths({
          datasetVersionId: input.datasetVersionId,
          eventId: input.eventId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          cursor: cursor as { eventId: string; relativeDay: number } | null,
          limit: input.limit ?? DATASET_PAGE_LIMIT_DEFAULT,
        });
      }),

    // ---- Prefix / Post（原始行情窗口，keyset 分页；两表同构，共用一套读取语义）----
    listPrefix: publicProcedure
      .input(rawBarPageInputSchema)
      .query(async ({ input }) => {
        assertDateRange(input.fromDate, input.toDate);
        const cursor = decodeCursorOrThrow(input.cursor, "path");
        return query.listRawBars("prefix", {
          datasetVersionId: input.datasetVersionId,
          eventId: input.eventId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          cursor: cursor as { eventId: string; relativeDay: number } | null,
          limit: input.limit ?? DATASET_PAGE_LIMIT_DEFAULT,
        });
      }),

    listPost: publicProcedure
      .input(rawBarPageInputSchema)
      .query(async ({ input }) => {
        assertDateRange(input.fromDate, input.toDate);
        const cursor = decodeCursorOrThrow(input.cursor, "path");
        return query.listRawBars("post", {
          datasetVersionId: input.datasetVersionId,
          eventId: input.eventId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          cursor: cursor as { eventId: string; relativeDay: number } | null,
          limit: input.limit ?? DATASET_PAGE_LIMIT_DEFAULT,
        });
      }),

    // ---- Outcome（keyset 分页）----
    listOutcomes: publicProcedure
      .input(outcomePageInputSchema)
      .query(async ({ input }) => {
        const cursor = decodeCursorOrThrow(input.cursor, "outcome");
        return query.listOutcomes({
          datasetVersionId: input.datasetVersionId,
          eventId: input.eventId,
          horizon: input.horizon,
          cursor: cursor as { eventId: string; horizon: number } | null,
          limit: input.limit ?? DATASET_PAGE_LIMIT_DEFAULT,
        });
      }),
  });
}

/** 默认实例（真实 TiDB，惰性连接；多数据集插件注册表 + 真实构建执行器 + 物理表存储）。 */
export const datasetRegistryRouter = buildDatasetRegistryRouter({
  repo: new DbDatasetRegistry(),
  reader: new DbDatasetDataReader(),
  pluginRegistry: defaultDatasetPluginRegistry,
  physicalStore: new DbDatasetPhysicalStore(),
});

export type DatasetRegistryRouter = ReturnType<typeof buildDatasetRegistryRouter>;

/**
 * 回收**孤儿构建作业**（服务启动时调用一次；幂等、可重复调用）。
 *
 * 为什么需要：构建的运行态 / 取消标志是**进程内内存 map**（`DefaultDatasetBuildRunner.running`）。
 * 进程退出（重启 / 热重载 / 崩溃）后，DB 里状态仍为 RUNNING 的作业**无人接管、永不终态**，
 * 于是版本永久卡在 BUILDING —— `createJob` 报 `VERSION_NOT_BUILDABLE`、
 * `deleteVersion` 报 `VERSION_HAS_RUNNING_JOB`，用户既不能重建也不能删除（实测 v2/390002 即此死锁）。
 *
 * 阈值：环境变量 `DATASET_RECLAIM_STALE_MINUTES`（缺省 `DEFAULT_STALE_BUILD_MINUTES`；
 * `<= 0` → 关闭自动回收）。判据与动作见 `DatasetRegistryService.reclaimStaleJobs`。
 */
export async function reclaimOrphanBuildJobs(
  options: { staleMinutes?: number } = {},
): Promise<ReclaimStaleJobResult[]> {
  const fromEnv = Number(process.env.DATASET_RECLAIM_STALE_MINUTES);
  const staleMinutes =
    options.staleMinutes ?? (Number.isFinite(fromEnv) ? fromEnv : DEFAULT_STALE_BUILD_MINUTES);
  const service = new DatasetRegistryService(new DbDatasetRegistry(), {
    plugins: defaultDatasetPluginRegistry,
    physicalStore: new DbDatasetPhysicalStore(),
  });
  return service.reclaimStaleJobs({ staleMinutes });
}
