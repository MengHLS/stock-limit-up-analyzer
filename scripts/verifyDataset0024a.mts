/**
 * STEP DATASET-002.4A — 真实 TiDB 验证：Build Lifecycle & State Machine。
 *
 * 两个阶段（全程真实 DB，无 mock）：
 *   1. 【只读】验证真实 first_limit_pullback / v2（不修改任何现有数据）；
 *   2. 【生命周期】在真实 DB 上建一个临时版本 verify-0024a-<ts>，驱动完整状态机
 *      （create/start/progress/cancel/retry/fail/complete + 非法转换 + 并发保护 + 历史保留），
 *      验证后删除该临时版本与其作业（不触碰 v2 及既有数据）。
 *
 * 用法：npx tsx scripts/verifyDataset0024a.mts
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { datasetBuildJobs, datasetVersions } from "../drizzle/schema";
import { DbDatasetRegistry, DatasetRegistryService } from "../server/datasetRegistry";
import { DatasetLifecycleError } from "../server/datasetRegistry";

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

const db = await getDb();
if (!db) {
  console.error("数据库不可用");
  process.exit(1);
}

const registry = new DbDatasetRegistry();
const service = new DatasetRegistryService(registry);
const tempVersionStr = `verify-0024a-${Date.now()}`;
let tempVersionId: number | null = null;
let allOk = false;

async function cleanup(): Promise<void> {
  if (tempVersionId !== null) {
    await db!.delete(datasetBuildJobs).where(eq(datasetBuildJobs.datasetVersionId, tempVersionId));
    await db!.delete(datasetVersions).where(eq(datasetVersions.id, tempVersionId));
    console.log(`  🧹 已清理临时版本 id=${tempVersionId}（${tempVersionStr}）及其作业`);
  }
}

try {
  console.log("=== [阶段 1] 只读验证真实 first_limit_pullback / v2 ===\n");
  const definition = await registry.getDefinitionByCode("first_limit_pullback");
  check("查询 Definition（first_limit_pullback）", !!definition, definition ? `id=${definition.id} status=${definition.status}` : "");
  if (!definition) throw new Error("definition 不存在");

  const v2 = await registry.getVersion(definition.id!, "v2");
  check("查询 Version v2", !!v2, v2 ? `id=${v2.id} status=${v2.status} events=${v2.totalEvents} rows=${v2.totalRows}` : "");
  if (!v2) throw new Error("v2 不存在");

  const v2Jobs = await registry.listJobs(v2.id!);
  check("v2 历史 Job 列表", v2Jobs.length >= 1, `共 ${v2Jobs.length} 个作业`);
  check("v2 作业状态仅 COMPLETED", v2Jobs.every((j) => j.status === "COMPLETED"), v2Jobs.map((j) => j.status).join(","));

  console.log("\n=== [阶段 2] 真实 DB 生命周期（临时版本）===\n");
  const tempVersion = await service.createVersion({
    datasetId: definition.id!,
    version: tempVersionStr,
    startDate: "2024-01-02",
    endDate: "2024-01-05",
    // DATASET-003B：筛选配置成为建版本的必填入参（构建门禁）；本脚本只验证生命周期状态机，
    // 故显式传入权威默认口径（全板块 / 含 ST / T 日首板 / t-0..t+20）。
    filter: {
      boards: [],
      excludeSt: false,
      events: [{ relativeDay: 0, kind: "firstBoard" }],
      preWindowDays: 0,
      postWindowDays: 20,
      outcomeHorizons: [5, 10, 20],
      batchSize: 1000,
    },
  });
  tempVersionId = tempVersion.id!;
  check("创建临时版本（DRAFT）", tempVersion.status === "DRAFT", `id=${tempVersionId} version=${tempVersionStr}`);

  // job1：create → start → progress → cancel
  const job1 = await service.createJob(tempVersionId);
  check("createJob → PENDING", job1.status === "PENDING", `jobId=${job1.jobId}`);

  const running1 = await service.startJob(job1.jobId);
  check("startJob → RUNNING", running1.status === "RUNNING", `startedAt=${running1.startedAt}`);

  await service.updateJobProgress(job1.jobId, {
    totalChunks: 100,
    completedChunks: 40,
    processedRows: 1000,
    lastTradeDate: "2024-01-03",
    lastCursor: JSON.stringify({ phase: "events", lastTradeDate: "2024-01-03", processedRows: 1000, completedChunks: 40 }),
  });
  const progressed = await registry.getJob(job1.jobId);
  check("progress 落库（completed=40/100）", progressed?.completedChunks === 40 && progressed?.totalChunks === 100, `completed=${progressed?.completedChunks} total=${progressed?.totalChunks}`);

  check("非法重复 start 被拒", await expectLifecycleError(() => service.startJob(job1.jobId), "INVALID_JOB_TRANSITION"));

  // 并发保护：job1 已 RUNNING，再建 jobConcurrent（version 仍 DRAFT 可构建）start 被拒
  const jobConcurrent = await service.createJob(tempVersionId);
  check("并发保护：版本已有 RUNNING，另一作业 start 被拒", await expectLifecycleError(() => service.startJob(jobConcurrent.jobId), "JOB_ALREADY_RUNNING"));
  await service.cancelJob(jobConcurrent.jobId); // PENDING → CANCELLED 清理

  await service.markBuilding(tempVersionId); // DRAFT → BUILDING
  const cancelled1 = await service.cancelJob(job1.jobId);
  check("cancelJob RUNNING → CANCELLED", cancelled1.status === "CANCELLED");
  const afterCancel = await registry.getVersionById(tempVersionId);
  check("cancel 后版本 BUILDING → FAILED", afterCancel?.status === "FAILED", `version.status=${afterCancel?.status}`);

  check("非法重复 cancel 被拒", await expectLifecycleError(() => service.cancelJob(job1.jobId), "INVALID_JOB_TRANSITION"));

  // job2：retry（CANCELLED）→ start → fail
  const job2 = await service.retryJob(job1.jobId);
  check("retry CANCELLED → 新 PENDING", job2.status === "PENDING" && job2.jobId !== job1.jobId, `newJobId=${job2.jobId}`);

  await service.startJob(job2.jobId);
  await service.markBuilding(tempVersionId); // FAILED → BUILDING
  await service.failJob(job2.jobId, "test failure injection");
  const failed2 = await registry.getJob(job2.jobId);
  check("failJob RUNNING → FAILED", failed2?.status === "FAILED", `err=${failed2?.errorMessage}`);
  await service.markFailed(tempVersionId); // BUILDING → FAILED

  // job3：retry（FAILED）→ start → complete
  const job3 = await service.retryJob(job2.jobId);
  check("retry FAILED → 新 PENDING", job3.status === "PENDING" && job3.jobId !== job2.jobId, `newJobId=${job3.jobId}`);

  await service.startJob(job3.jobId);
  await service.markBuilding(tempVersionId); // FAILED → BUILDING
  await service.completeJob(job3.jobId);
  const completed3 = await registry.getJob(job3.jobId);
  check("completeJob RUNNING → COMPLETED", completed3?.status === "COMPLETED");

  check("非法重复 complete 被拒", await expectLifecycleError(() => service.completeJob(job3.jobId), "INVALID_JOB_TRANSITION"));

  // 历史 Job 不被覆盖：job1/jobConcurrent/job2/job3 各自保留最终状态
  const history = await registry.listJobs(tempVersionId);
  const byId = new Map(history.map((j) => [j.jobId, j.status]));
  check(
    "历史 Job 保留（4 作业：2 CANCELLED + 1 FAILED + 1 COMPLETED）",
    history.length === 4 &&
      byId.get(job1.jobId) === "CANCELLED" &&
      byId.get(jobConcurrent.jobId) === "CANCELLED" &&
      byId.get(job2.jobId) === "FAILED" &&
      byId.get(job3.jobId) === "COMPLETED",
    `jobs=${history.length} statuses=${history.map((j) => j.status).sort().join(",")}`,
  );

  console.log("\n=== [阶段 3] 验证 v2 未被触碰 ===\n");
  const v2After = await registry.getVersion(definition.id!, "v2");
  check("v2 状态仍为 READY（未被修改）", v2After?.status === "READY", `status=${v2After?.status}`);
  const v2JobsAfter = await registry.listJobs(v2.id!);
  check("v2 作业数量未变", v2JobsAfter.length === v2Jobs.length, `${v2JobsAfter.length} 个`);

  allOk = results.every((r) => r.ok);
  console.log(`\n${allOk ? "✅" : "❌"} 真实 TiDB 验证${allOk ? "全部通过" : "存在失败"}`);
} finally {
  await cleanup();
}
process.exit(allOk ? 0 : 1);
