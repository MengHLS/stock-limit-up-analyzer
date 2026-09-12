/**
 * STEP DATASET-002.4B — Dataset 构建执行器（Build Runner）。
 *
 * 定位：把 DATASET-002.4A 建立的「作业状态机」与 DATASET-001 的「真实构建实现」接起来——
 * 之前 `startJob` 只把作业置 RUNNING，真实构建只能靠 CLI `runDataset001Build.mts` 手工跑；
 * 本模块让 RUNNING 作业**真的被执行**，并全程把进度写回 `dataset_build_job`。
 *
 * 编排（与 CLI 同一条链，不引入第二套构建逻辑）：
 *   RegistryService（状态机 + 校验）→ FirstLimitPullbackDatasetBuilder（events 逐日 + paths/outcomes 分块）
 *   → DatasetBuildIO（真实 TiDB push-down + 幂等 upsert）。
 *
 * 纪律：
 *   - **异步执行、不阻塞请求**：`start()` 只登记 + 触发，立即返回；构建在后台跑，前端轮询 `getVersion` 看进度；
 *   - **不臆造进度**：`completedChunks / totalChunks` 均为真实计数（见 `resolveBuildConfig` 与 `countTradingDays`），
 *     信息不足时写 null（进度计算见 lifecycle.computeBuildProgress）；
 *   - **协作式取消 + 可等待停止**：`cancel()` 只置内存标志（构建器在下一个 chunk 回调时中止）；
 *     `waitForStop()` 额外 await 执行体真正退出（含在途写库），调用方据此才能安全回滚数据 ——
 *     取消端点必须「先 waitForStop，再落终态 / 删数据」，否则回滚会被在途 INSERT 写回；
 *     作业/版本终态落库由 `service.cancelJob*` 负责（本模块不重复写终态）；
 *   - **重建 = 从零**：执行前清空该版本已落库的物理数据行（见 `service.purgeVersionRows`），
 *     否则 upsert 的 `ON DUPLICATE KEY UPDATE id = id`（空更新）会让旧行永不清理、
 *     同键新值永不覆盖 ⇒ 重建产物会是「新旧混合」；
 *   - **不吞异常**：真实错误 → job FAILED + version FAILED，错误信息落 `errorMessage`；
 *   - **幂等**：同一 jobId 同一进程内只允许一个执行实例（重复 start 直接返回）。
 */

import {
  DATASET_LIFECYCLE_ERROR,
  DatasetLifecycleError,
  resolveBuildConfig,
  type ResolvedBuildConfig,
} from "./lifecycle";
import type { DatasetBuildIO } from "./builder";
import type { DatasetPluginRegistry } from "./plugins";
import type { DatasetRegistryRepository, DatasetRegistryService } from "./registry";
import type {
  DatasetBuildCheckpoint,
  DatasetBuildJob,
} from "./types";

// ---------------------------------------------------------------------------
// 取消信号（不是失败：终态由 service.cancelJob 落库）
// ---------------------------------------------------------------------------

export class DatasetBuildCancelledError extends Error {
  constructor() {
    super("构建已被取消");
    this.name = "DatasetBuildCancelledError";
  }
}

/**
 * `waitForStop` 默认等待上限。
 *
 * 取值依据：构建器只在 chunk 边界检查取消标志，两个检查点之间最长的工作单元是
 * 「月度候选下推」（`CANDIDATE_RANGE_MAX_MONTHS = 1`，实测 ~12.8s）。60s 给出 ~4.7× 余量。
 * 超时 → 返回 false，调用方**不得回滚数据**（写入者可能仍活着）。
 */
export const BUILD_STOP_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// 执行器接口 / 实现
// ---------------------------------------------------------------------------

/** 构建执行器（router 只依赖此接口，便于测试注入假实现）。 */
export interface DatasetBuildRunner {
  /** 启动一个已 RUNNING 的作业（异步执行，立即返回；重复调用幂等）。 */
  start(jobId: string): Promise<void>;
  /** 请求协作式取消（不落库；落库由 service.cancelJob 负责）。 */
  cancel(jobId: string): void;
  /**
   * 请求取消并**等待执行体真正退出**（含在途写库落盘），返回是否在超时内停止。
   *
   * - 本进程正在执行该作业 → 置取消标志后 await 执行体，保证返回 true 时「已无写入者」；
   * - 本进程未执行（孤儿作业 / 已结束 / 从未启动）→ 立即返回 true（无写入者）。
   *
   * 调用方（取消端点）必须在落终态 + 回滚数据**之前**调用本方法，否则回滚会被在途写入写回。
   */
  waitForStop(jobId: string, timeoutMs?: number): Promise<boolean>;
  /** 当前进程是否正在执行该作业。 */
  isRunning(jobId: string): boolean;
}

interface BuildControl {
  cancelled: boolean;
}

/** 一次执行实例：取消标志 + 执行体 promise（waitForStop 据此等待真正结束）。 */
interface BuildRun {
  control: BuildControl;
  promise: Promise<void>;
}

export interface DatasetBuildRunnerDeps {
  repo: DatasetRegistryRepository;
  service: DatasetRegistryService;
  /**
   * 构建插件注册表（多数据集）：按 `definition.datasetCode` 解析该数据集的 IO 与构建器。
   * 未注册 → `BUILDER_NOT_REGISTERED`（不静默回退，不冒充构建成功）。
   */
  plugins: DatasetPluginRegistry;
}

export class DefaultDatasetBuildRunner implements DatasetBuildRunner {
  private readonly running = new Map<string, BuildRun>();
  private readonly deps: DatasetBuildRunnerDeps;

  constructor(deps: DatasetBuildRunnerDeps) {
    this.deps = deps;
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  cancel(jobId: string): void {
    const run = this.running.get(jobId);
    if (run) run.control.cancelled = true;
  }

  async waitForStop(jobId: string, timeoutMs: number = BUILD_STOP_TIMEOUT_MS): Promise<boolean> {
    const run = this.running.get(jobId);
    // 本进程没有该作业的执行体 ⇒ 不存在写入者（孤儿作业 / 已结束 / 从未启动），立即可安全回滚。
    if (!run) return true;
    run.control.cancelled = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), Math.max(0, timeoutMs));
    });
    try {
      const outcome = await Promise.race([
        run.promise.then(() => "stopped" as const),
        timedOut,
      ]);
      return outcome === "stopped";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async start(jobId: string): Promise<void> {
    if (this.running.has(jobId)) return; // 幂等：同作业同进程只跑一个实例
    const job = await this.deps.repo.getJob(jobId);
    if (!job) {
      throw new DatasetLifecycleError(DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND, `未找到构建作业：${jobId}`);
    }
    if (job.status !== "RUNNING") {
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.INVALID_JOB_TRANSITION,
        `仅 RUNNING 作业可执行构建（当前 ${job.status}）`,
      );
    }
    const control: BuildControl = { cancelled: false };
    // 关键：不 await execute，请求立即返回；构建在后台推进，进度写库供前端轮询。
    // promise 登记到 running，使 waitForStop 能等到「真正没有写入者」。
    const promise = this.execute(job, control)
      .catch(() => {
        // execute 内部已兜住全部异常；此处仅防止极端情况下未处理的 rejection。
      })
      .finally(() => {
        // 只在「仍是自己」时清理，避免被后续 start 覆盖后误删新一轮登记。
        if (this.running.get(jobId)?.control === control) this.running.delete(jobId);
      });
    this.running.set(jobId, { control, promise });
  }

  // -------------------------------------------------------------------------
  // 后台执行体
  // -------------------------------------------------------------------------

  private async execute(job: DatasetBuildJob, control: BuildControl): Promise<void> {
    const { repo, service, plugins } = this.deps;
    const versionId = job.datasetVersionId;
    try {
      const version = await repo.getVersionById(versionId);
      if (!version) {
        throw new DatasetLifecycleError(
          DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND,
          `未找到 Dataset 版本：${versionId}`,
        );
      }
      const definition = await repo.getDefinitionById(version.datasetId);
      if (!definition) {
        throw new DatasetLifecycleError(
          DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND,
          `未找到 Dataset 定义：${version.datasetId}`,
        );
      }

      if (control.cancelled) return; // 启动前已被取消（job/version 已由 cancelJob 落库）

      // 版本 → BUILDING（与作业 RUNNING 联动；守卫在 service 内）。
      // 先于插件解析：任何「执行尝试」都应反映到版本态，失败可落到 FAILED（可重试），
      // 不留「作业 FAILED 但版本仍 DRAFT」的不一致观感。
      await service.markBuilding(versionId);

      // 按 datasetCode 解析构建插件（多数据集：每个数据集有自己的表结构 / IO / 构建器）。
      // 未注册 → 明确失败（BUILDER_NOT_REGISTERED）；正常路径已由 service.createJob/startJob 前置拦截，
      // 此处为运行期防御（例如插件被注销）。
      const plugin = plugins.get(definition.datasetCode);
      if (!plugin) {
        throw new DatasetLifecycleError(
          DATASET_LIFECYCLE_ERROR.BUILDER_NOT_REGISTERED,
          `数据集 "${definition.datasetCode}" 没有已注册的构建插件，无法构建`,
        );
      }

      // 构建配置解析（DATASET-003B）：优先读已固化的 dataset_build_config 行（筛选口径的权威来源），
      // 缺失时回退版本 filterDefinition 镜像 → 权威默认。绝不由 runner 自行决定筛选口径。
      const configRow = await repo.getBuildConfig(versionId);
      const config = resolveBuildConfig(version, configRow ?? null);
      const io = plugin.createIO();
      const builder = plugin.createBuilder(io, { batchSize: config.batchSize });

      // 真实 totalChunks：窗口内交易日数（后端确定可知，不猜）。
      const totalDays = await this.countTradingDays(io, config);
      await service.updateJobProgress(job.jobId, {
        totalChunks: totalDays > 0 ? totalDays : null,
        completedChunks: 0,
        currentChunk: null,
      });

      // paths/outcomes 阶段的真实分母 = 窗口交易日数 + 事件数（事件数在 events 阶段结束后才可知）。
      let phase2Total: number | null = null;

      const report = async (checkpoint: DatasetBuildCheckpoint): Promise<void> => {
        if (control.cancelled) throw new DatasetBuildCancelledError();
        if (checkpoint.phase !== "events" && phase2Total === null) {
          const events = await io.listEvents(versionId).catch(() => []);
          phase2Total = totalDays + events.length;
        }
        const total = phase2Total ?? totalDays;
        await service.updateJobProgress(job.jobId, {
          lastTradeDate: checkpoint.lastTradeDate,
          lastSymbol: checkpoint.lastSymbol,
          lastCursor: JSON.stringify(checkpoint),
          processedRows: checkpoint.processedRows,
          completedChunks: checkpoint.completedChunks,
          totalChunks: total > 0 ? total : null,
        });
      };

      // 🔴 重建 = 从零（DATASET-LIFECYCLE-001）：构建开始前清空该版本已落库的物理数据行。
      //
      // 为什么必须清：落库走 `ON DUPLICATE KEY UPDATE id = id`（**空更新**，不是覆盖），
      //   ① 本轮不再产出的旧行**永不清理**（例如上游筛选口径收紧后，被排除的事件会残留）；
      //   ② 同业务键的新值**永不覆盖旧值**（先写入者胜出），上游数据/代码变更后重建会得到新旧混合。
      // 且 `version.totalEvents / totalRows` 只反映本轮产出 ⇒ 声明与实际脱节且无人察觉。
      //
      // 位置：在「配置解析 + 交易日计数」之后、「builder.build」之前 ——
      //   前置步骤可能因配置非法而抛错，此时**不应破坏**版本已有数据；
      //   放到 build 之前则保证「一旦开始写，表内必为空」，结果只属于本轮。
      if (control.cancelled) throw new DatasetBuildCancelledError();
      await service.purgeVersionRows(versionId);

      const result = await builder.build(
        {
          datasetVersionId: versionId,
          startDate: config.startDate,
          endDate: config.endDate,
          boards: config.boards,
          excludeSt: config.excludeSt,
          events: config.events,
          preWindowDays: config.preWindowDays,
          postWindowDays: config.postWindowDays,
          outcomeHorizons: config.outcomeHorizons,
          batchSize: config.batchSize,
          resumeCheckpoint: null,
        },
        report,
      );

      if (control.cancelled) throw new DatasetBuildCancelledError();

      await service.completeJob(job.jobId);
      // totalRows = 该版本五张物理表行数之和，与 `DatasetVersionCounts.rowCount` 完全同口径
      // （否则前端「声明行数 vs 实际行数」会因口径不同而永久对不上）。
      await service.markReady(versionId, {
        totalEvents: result.events,
        totalRows:
          result.events + result.prefixes + result.posts + result.paths + result.outcomes,
      });
    } catch (err) {
      // 取消是正常终止：job → CANCELLED、version → FAILED 已由 service.cancelJob 落库，此处不再写终态。
      if (err instanceof DatasetBuildCancelledError) return;
      const message = err instanceof Error ? err.message : String(err);
      // 🔴 不吞异常（铁律）：这个 catch 曾经**完全没有日志**，于是一旦 failJob 的写入没生效，
      // 表现只有「版本 FAILED + 作业永久 RUNNING + 零线索」——实测在真实库上复现两次
      // （版本 510002：B2 在 Phase 1 结束后停止推进，作业 630004 停留 RUNNING，errorMessage 为空）。
      // 终态写入失败必须留下痕迹，否则无法定位，且作业要等孤儿回收（默认 10 分钟）才能解开。
      console.error(`[DatasetBuild] 构建失败 job=${job.jobId} version=${versionId}：${message}`);
      try {
        await service.failJob(job.jobId, message);
      } catch (failErr) {
        // 作业已非 RUNNING（例如同时被取消），忽略——但**必须记录**，不掩盖原始错误。
        console.error(
          `[DatasetBuild] ⚠️ 作业终态写入失败（作业可能停留 RUNNING，需靠孤儿回收兜底）job=${job.jobId}：` +
            `${failErr instanceof Error ? failErr.message : String(failErr)}；原始错误=${message}`,
        );
      }
      try {
        await service.markFailed(versionId);
      } catch (markErr) {
        // 版本已非 BUILDING，忽略——同样记录。
        console.error(
          `[DatasetBuild] ⚠️ 版本终态写入失败 version=${versionId}：` +
            `${markErr instanceof Error ? markErr.message : String(markErr)}`,
        );
      }
    }
    // 注意：`running` 的清理在 start() 注册的 .finally() 中完成（须早于 waitForStop 的等待方被唤醒）。
  }

  /** 窗口内交易日数（真实计数；DB 不可用 → 0 → 进度写 null，不编造）。 */
  private async countTradingDays(io: DatasetBuildIO, config: ResolvedBuildConfig): Promise<number> {
    const days = await io.loadTradingDays();
    return days.filter((d) => d >= config.startDate && d <= config.endDate).length;
  }
}
