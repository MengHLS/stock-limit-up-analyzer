/**
 * STEP DATASET-002.4B — 真实 TiDB 端到端验证：构建入口 + 真实构建执行。
 *
 * 全程真实 DB（无 mock），分三阶段：
 *   1. 【只读】快照真实 first_limit_pullback / v2（不修改任何现有数据）；
 *   2. 【真实构建】建临时版本（小窗口，标签 ≤32 字符）→ DRAFT → createBuildJob(PENDING) → startJob(RUNNING)
 *      → runner 后台真实执行（写 ds_first_limit_pullback_*）→ 轮询进度 → COMPLETED + 版本 READY，
 *      并核对物理表真实行数 > 0；随后 cancel 场景（较大窗口）验证协作式取消。
 *   3. 【清理】删除临时版本的物理表行 + 作业 + 版本（不触碰 v2 及既有数据）。
 *
 * 用法：npx tsx scripts/verifyDataset0024b.mts
 */

import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../server/db";
import {
  datasetBuildJobs,
  datasetDefinitions,
  datasetVersions,
  firstLimitPullbackEvents,
  firstLimitPullbackOutcomes,
  firstLimitPullbackPaths,
} from "../drizzle/schema";
import {
  DbDatasetBuildIO,
  DbDatasetRegistry,
  DatasetLifecycleError,
  DatasetRegistryService,
  DefaultDatasetBuildRunner,
} from "../server/datasetRegistry";

const results: { step: string; ok: boolean; detail: string }[] = [];
function check(step: string, ok: boolean, detail = ""): void {
  results.push({ step, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}

async function expectLifecycleError(fn: () => Promise<unknown>, code: string): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    if (e instanceof DatasetLifecycleError) return e.code === code;
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await sleep(500);
  }
  console.log(`     ⏱ waitFor 超时：${label}（${timeoutMs}ms）`);
  return false;
}

const db = await getDb();
if (!db) {
  console.error("数据库不可用");
  process.exit(1);
}

const registry = new DbDatasetRegistry();
const service = new DatasetRegistryService(registry);
const io = new DbDatasetBuildIO();
const runner = new DefaultDatasetBuildRunner({ repo: registry, service, io });

const tempVersions: number[] = [];

async function countRows(versionId: number): Promise<{ events: number; paths: number; outcomes: number }> {
  const [ev] = await db!
    .select({ c: sql<number>`count(*)` })
    .from(firstLimitPullbackEvents)
    .where(eq(firstLimitPullbackEvents.datasetVersionId, versionId));
  const [pa] = await db!
    .select({ c: sql<number>`count(*)` })
    .from(firstLimitPullbackPaths)
    .where(eq(firstLimitPullbackPaths.datasetVersionId, versionId));
  const [ou] = await db!
    .select({ c: sql<number>`count(*)` })
    .from(firstLimitPullbackOutcomes)
    .where(eq(firstLimitPullbackOutcomes.datasetVersionId, versionId));
  return { events: Number(ev?.c ?? 0), paths: Number(pa?.c ?? 0), outcomes: Number(ou?.c ?? 0) };
}

async function cleanup(): Promise<void> {
  for (const versionId of tempVersions) {
    await db!.delete(firstLimitPullbackPaths).where(eq(firstLimitPullbackPaths.datasetVersionId, versionId));
    await db!.delete(firstLimitPullbackOutcomes).where(eq(firstLimitPullbackOutcomes.datasetVersionId, versionId));
    await db!.delete(firstLimitPullbackEvents).where(eq(firstLimitPullbackEvents.datasetVersionId, versionId));
    await db!.delete(datasetBuildJobs).where(eq(datasetBuildJobs.datasetVersionId, versionId));
    await db!.delete(datasetVersions).where(eq(datasetVersions.id, versionId));
    console.log(`  🧹 已清理临时版本 id=${versionId}（物理表行 + 作业 + 版本）`);
  }
}

let allOk = false;
try {
  // =========================================================================
  // 阶段 1：只读快照
  // =========================================================================
  console.log("\n【阶段 1】只读快照（不修改现有数据）");
  const [definition] = await db
    .select()
    .from(datasetDefinitions)
    .where(eq(datasetDefinitions.datasetCode, "first_limit_pullback"));
  if (!definition) throw new Error("未找到 first_limit_pullback 定义");
  check("first_limit_pullback 定义存在", true, `id=${definition.id} eventTable=${definition.eventTableName}`);

  const v2Before = await registry.getVersion(definition.id!, "v2");
  if (!v2Before) throw new Error("未找到 v2");
  const v2JobsBefore = await registry.listJobs(v2Before.id!);
  const v2RowsBefore = await countRows(v2Before.id!);
  check(
    "v2 只读快照",
    v2Before.status === "READY",
    `status=${v2Before.status} jobs=${v2JobsBefore.length} events=${v2RowsBefore.events} rows=${v2RowsBefore.paths + v2RowsBefore.outcomes}`,
  );

  // =========================================================================
  // 阶段 2a：真实构建（小窗口，完整跑通）
  // =========================================================================
  console.log("\n【阶段 2a】真实构建（小窗口 2024-01-02 → 2024-01-05）");
  const vA = await service.createVersionWithBuildConfig({
    datasetId: definition.id!,
    version: `vfy24b-ok-${Date.now()}`,
    startDate: "2024-01-02",
    endDate: "2024-01-05",
    // DATASET-003B：入参收敛为单一 `filter`（筛选 + 执行参数）。
    filter: {
      boards: ["main"],
      excludeSt: false,
      events: [{ relativeDay: 0, kind: "firstBoard" }],
      preWindowDays: 2,
      postWindowDays: 5,
      outcomeHorizons: [1, 2],
      batchSize: 500,
    },
  });
  tempVersions.push(vA.id!);
  check("createVersionWithBuildConfig → DRAFT 且构建配置固化", vA.status === "DRAFT", `status=${vA.status}`);
  // DATASET-003B：配置真实落在独立配置表（dataset_build_config + 两张多值子表），
  // 以「配置表回读」为权威，而非只看 legacy JSON 镜像。
  const cfgA = await service.getBuildConfig(vA.id!);
  check(
    "构建配置固化正确（配置表回读）",
    cfgA != null &&
      cfgA.boards.join(",") === "main" &&
      cfgA.postWindowDays === 5 &&
      cfgA.preWindowDays === 2 &&
      cfgA.batchSize === 500 &&
      cfgA.events.length === 1 &&
      Array.isArray(cfgA.outcomeHorizons),
    `boards=[${cfgA?.boards.join(",")}] pre=${cfgA?.preWindowDays} post=${cfgA?.postWindowDays} ` +
      `events=${JSON.stringify(cfgA?.events)} horizons=${JSON.stringify(cfgA?.outcomeHorizons)} batchSize=${cfgA?.batchSize}`,
  );

  const jobA = await service.createJob(vA.id!);
  check("createBuildJob → PENDING", jobA.status === "PENDING", `jobId=${jobA.jobId}`);

  const startedA = await service.startJob(jobA.jobId);
  check("startBuildJob → RUNNING", startedA.status === "RUNNING");
  await runner.start(jobA.jobId);

  const sawProgress = await waitFor(
    async () => {
      const j = await registry.getJob(jobA.jobId);
      return j?.totalChunks != null && j.totalChunks > 0;
    },
    60_000,
    "进度出现（totalChunks）",
  );
  const midJob = await registry.getJob(jobA.jobId);
  check(
    "构建进度真实落库（chunk checkpoint）",
    sawProgress,
    `totalChunks=${midJob?.totalChunks} completedChunks=${midJob?.completedChunks} processedRows=${midJob?.processedRows}`,
  );

  const completedA = await waitFor(
    async () => (await registry.getJob(jobA.jobId))?.status === "COMPLETED",
    180_000,
    "作业 COMPLETED",
  );
  const doneA = await registry.getJob(jobA.jobId);
  check(
    "真实构建完成 → 作业 COMPLETED",
    completedA && doneA?.status === "COMPLETED",
    `status=${doneA?.status} completedChunks=${doneA?.completedChunks}/${doneA?.totalChunks} err=${doneA?.errorMessage ?? "-"}`,
  );

  const vAAfter = await registry.getVersionById(vA.id!);
  check("版本 → READY（真实完成）", vAAfter?.status === "READY", `status=${vAAfter?.status}`);

  const rowsA = await countRows(vA.id!);
  check(
    "物理表真实写入（ds_first_limit_pullback_*）",
    rowsA.events > 0 && rowsA.paths > 0 && rowsA.outcomes > 0,
    `events=${rowsA.events} paths=${rowsA.paths} outcomes=${rowsA.outcomes}`,
  );
  check(
    "版本统计与物理表一致",
    vAAfter?.totalEvents === rowsA.events && vAAfter?.totalRows === rowsA.paths + rowsA.outcomes,
    `declared events=${vAAfter?.totalEvents} rows=${vAAfter?.totalRows} | actual events=${rowsA.events} rows=${rowsA.paths + rowsA.outcomes}`,
  );

  // 非法重复 start / cancel（真实 DB）
  check(
    "重复 start 被拒（INVALID_JOB_TRANSITION）",
    await expectLifecycleError(() => service.startJob(jobA.jobId), "INVALID_JOB_TRANSITION"),
  );
  check(
    "已完成作业 cancel 被拒（INVALID_JOB_TRANSITION）",
    await expectLifecycleError(() => service.cancelJob(jobA.jobId), "INVALID_JOB_TRANSITION"),
  );

  // retry：COMPLETED 不可重试
  check(
    "COMPLETED 不可 retry（INVALID_JOB_TRANSITION）",
    await expectLifecycleError(() => service.retryJob(jobA.jobId), "INVALID_JOB_TRANSITION"),
  );

  // =========================================================================
  // 阶段 2b：真实取消（较大窗口，协作式中止）
  // =========================================================================
  console.log("\n【阶段 2b】真实取消（窗口 2024-01-02 → 2024-03-29）");
  const vB = await service.createVersionWithBuildConfig({
    datasetId: definition.id!,
    version: `vfy24b-cancel-${Date.now()}`,
    startDate: "2024-01-02",
    endDate: "2024-03-29",
    filter: {
      boards: [],
      excludeSt: false,
      events: [{ relativeDay: 0, kind: "firstBoard" }],
      preWindowDays: 0,
      postWindowDays: 5,
      outcomeHorizons: [1],
      batchSize: 500,
    },
  });
  tempVersions.push(vB.id!);
  const jobB = await service.createJob(vB.id!);
  await service.startJob(jobB.jobId);
  await runner.start(jobB.jobId);

  await waitFor(
    async () => (await registry.getJob(jobB.jobId))?.completedChunks != null && ((await registry.getJob(jobB.jobId))?.completedChunks ?? 0) >= 1,
    60_000,
    "取消前至少完成 1 个 chunk",
  );
  await service.cancelJob(jobB.jobId);
  runner.cancel(jobB.jobId);

  const stopped = await waitFor(() => !runner.isRunning(jobB.jobId), 60_000, "执行器停止");
  const doneB = await registry.getJob(jobB.jobId);
  check(
    "取消 RUNNING 作业 → CANCELLED（协作式停止）",
    stopped && doneB?.status === "CANCELLED",
    `status=${doneB?.status} completedChunks=${doneB?.completedChunks}/${doneB?.totalChunks}`,
  );
  const vBAfter = await registry.getVersionById(vB.id!);
  check("取消后版本 → FAILED（解除 BUILDING 卡态，可重试）", vBAfter?.status === "FAILED", `status=${vBAfter?.status}`);
  check(
    "重复 cancel 被拒（INVALID_JOB_TRANSITION）",
    await expectLifecycleError(() => service.cancelJob(jobB.jobId), "INVALID_JOB_TRANSITION"),
  );

  const retriedB = await service.retryJob(jobB.jobId);
  check(
    "CANCELLED retry → 新 PENDING 作业（历史保留）",
    retriedB.status === "PENDING" && retriedB.jobId !== jobB.jobId,
    `new=${retriedB.jobId} old=${jobB.jobId}`,
  );
  const jobsB = await registry.listJobs(vB.id!);
  check(
    "历史 Job 未被覆盖（两条记录并存）",
    jobsB.length === 2 &&
      jobsB.some((j) => j.jobId === jobB.jobId && j.status === "CANCELLED") &&
      jobsB.some((j) => j.jobId === retriedB.jobId && j.status === "PENDING"),
    jobsB.map((j) => `${j.jobId}:${j.status}`).join(", "),
  );

  // =========================================================================
  // 阶段 3：v2 未被触及
  // =========================================================================
  console.log("\n【阶段 3】确认既有数据未被修改");
  const v2After = await registry.getVersion(definition.id!, "v2");
  const v2JobsAfter = await registry.listJobs(v2After!.id!);
  const v2RowsAfter = await countRows(v2After!.id!);
  check("v2 状态仍为 READY", v2After?.status === "READY", `status=${v2After?.status}`);
  check("v2 作业数未变", v2JobsAfter.length === v2JobsBefore.length, `${v2JobsAfter.length} 个`);
  check(
    "v2 物理表行数未变",
    v2RowsAfter.events === v2RowsBefore.events && v2RowsAfter.paths === v2RowsBefore.paths && v2RowsAfter.outcomes === v2RowsBefore.outcomes,
    `events=${v2RowsAfter.events} paths=${v2RowsAfter.paths} outcomes=${v2RowsAfter.outcomes}`,
  );

  allOk = results.every((r) => r.ok);
  console.log(`\n${allOk ? "✅" : "❌"} 真实 TiDB 端到端验证${allOk ? "全部通过" : "存在失败"}`);
  process.exitCode = allOk ? 0 : 1;
} catch (err) {
  console.error("\n❌ 验证脚本异常：", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  await db.execute(sql`select 1`).catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
