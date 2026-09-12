/**
 * STEP DATASET-002.4B / 003A — Build Runner 单测。
 *
 * 覆盖（任务 §测试）：
 *   - 成功：RUNNING 作业被真实执行 → COMPLETED + 版本 READY + 进度 100；
 *   - 幂等 start：同作业同进程只执行一个实例；
 *   - 非法 start：PENDING 作业 / 不存在作业 → 稳定错误，不置 RUNNING；
 *   - 失败：builder 抛错 → job FAILED + version FAILED（错误落 errorMessage）；
 *   - 无插件：runner 侧插件缺失 → BUILDER_NOT_REGISTERED（诚实失败，不冒充成功）；
 *   - 协作式取消：build 中途 cancel → 作业由 service.cancelJob 落 CANCELLED，runner 不覆盖。
 *
 * 插件（表结构 / IO / 构建器）由真实 DatasetPluginRegistry 提供（测试用假插件实现），
 * 因此本文件同时覆盖「runner 经插件注册表解析构建能力」的多数据集编排路径。
 */

import { describe, expect, it } from "vitest";
import { DatasetPluginRegistry } from "./plugins";
import { DefaultDatasetBuildRunner } from "./runner";
import { DATASET_LIFECYCLE_ERROR, DatasetLifecycleError } from "./lifecycle";
import { makeTestFilter, makeTestPlugin, makeTestService } from "./testHelpers";

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor 超时：条件未在预期时间内成立");
}

/** 建 fixture：definition + version（DRAFT，含构建窗口）+ PENDING job，并返回 service / runner。 */
async function makeFixture(
  builderOpts: Parameters<typeof makeTestPlugin>[0]["builderOpts"] = {},
  options: { runnerPlugins?: DatasetPluginRegistry } = {},
) {
  const plugin = makeTestPlugin({ builderOpts });
  const plugins = new DatasetPluginRegistry();
  plugins.register(plugin);
  const { repo, physicalStore, service } = makeTestService({ plugins });
  const def = await service.createDefinition({
    datasetCode: "first_limit_pullback",
    name: "首板回踩",
    datasetType: "EVENT",
  });
  const version = await service.createVersionWithBuildConfig({
    datasetId: def.id!,
    version: "v1",
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    filter: makeTestFilter(),
  });
  const job = await service.createJob(version.id!);

  const runner = new DefaultDatasetBuildRunner({
    repo,
    service,
    plugins: options.runnerPlugins ?? plugins,
  });
  return { repo, physicalStore, service, runner, def, version, job };
}

describe("DefaultDatasetBuildRunner", () => {
  it("成功：RUNNING 作业被真实执行 → COMPLETED + 版本 READY + 进度 100", async () => {
    const { repo, service, runner, version, job } = await makeFixture();
    await service.startJob(job.jobId);
    await runner.start(job.jobId);

    await waitFor(async () => (await repo.getJob(job.jobId))?.status === "COMPLETED");

    const done = await repo.getJob(job.jobId);
    expect(done!.status).toBe("COMPLETED");
    expect(done!.completedChunks).toBe(3);
    expect(done!.totalChunks).toBeGreaterThan(0);
    expect(done!.lastCursor).toBeTruthy();

    const v = await repo.getVersionById(version.id!);
    expect(v!.status).toBe("READY");
    expect(v!.totalEvents).toBe(3);
    expect(v!.totalRows).toBe(126); // events 3 + prefixes 3 + posts 30 + paths 30 + outcomes 60（= rowCount 同口径）
  });

  it("幂等 start：同作业同进程只执行一个实例", async () => {
    const { repo, service, runner, job } = await makeFixture({ delayPerChunkMs: 20 });
    await service.startJob(job.jobId);
    await runner.start(job.jobId);
    await runner.start(job.jobId); // 第二次：应被幂等短路
    await runner.start(job.jobId);

    await waitFor(async () => (await repo.getJob(job.jobId))?.status === "COMPLETED");
    // 若重复执行，completedChunks 会超过 3；这里应恰为 3
    const done = await repo.getJob(job.jobId);
    expect(done!.completedChunks).toBe(3);
  });

  it("非法 start：PENDING 作业 → INVALID_JOB_TRANSITION，且不置 RUNNING", async () => {
    const { repo, runner, job } = await makeFixture();
    await expect(runner.start(job.jobId)).rejects.toMatchObject({
      code: DATASET_LIFECYCLE_ERROR.INVALID_JOB_TRANSITION,
    });
    const still = await repo.getJob(job.jobId);
    expect(still!.status).toBe("PENDING");
  });

  it("非法 start：不存在的作业 → JOB_NOT_FOUND", async () => {
    const { runner } = await makeFixture();
    await expect(runner.start("no-such-job")).rejects.toMatchObject({
      code: DATASET_LIFECYCLE_ERROR.JOB_NOT_FOUND,
    });
  });

  it("失败：builder 抛错 → job FAILED + version FAILED（错误落 errorMessage）", async () => {
    const { repo, service, runner, version, job } = await makeFixture({ fail: true });
    await service.startJob(job.jobId);
    await runner.start(job.jobId);

    await waitFor(async () => (await repo.getJob(job.jobId))?.status === "FAILED");

    const failed = await repo.getJob(job.jobId);
    expect(failed!.status).toBe("FAILED");
    expect(failed!.errorMessage).toContain("构建过程中发生真实错误");

    const v = await repo.getVersionById(version.id!);
    expect(v!.status).toBe("FAILED");
  });

  it("无插件：runner 侧插件缺失 → BUILDER_NOT_REGISTERED，作业 FAILED（不冒充成功）", async () => {
    // service 侧仍持有插件（startJob 通过），runner 侧给一个空注册表 → 执行时解析失败
    const { repo, service, runner, version, job } = await makeFixture({}, { runnerPlugins: new DatasetPluginRegistry() });
    await service.startJob(job.jobId);
    await runner.start(job.jobId);

    await waitFor(async () => (await repo.getJob(job.jobId))?.status === "FAILED");
    const failed = await repo.getJob(job.jobId);
    expect(failed!.status).toBe("FAILED");
    expect(failed!.errorMessage).toContain("没有已注册的构建插件");

    const v = await repo.getVersionById(version.id!);
    expect(v!.status).toBe("FAILED");
  });

  it("协作式取消：build 中途 cancel → 作业保持 CANCELLED（runner 不覆盖终态）", async () => {
    const { repo, service, runner, version, job } = await makeFixture({ delayPerChunkMs: 60, chunks: 10 });
    await service.startJob(job.jobId);
    await runner.start(job.jobId);

    // 等第一个 chunk 上报后取消
    await waitFor(async () => {
      const j = await repo.getJob(job.jobId);
      return (j?.completedChunks ?? 0) >= 1;
    });
    await service.cancelJob(job.jobId); // job → CANCELLED, version BUILDING → FAILED
    runner.cancel(job.jobId); // 协作式通知

    await waitFor(async () => !runner.isRunning(job.jobId), 3000);

    const cancelled = await repo.getJob(job.jobId);
    expect(cancelled!.status).toBe("CANCELLED");
    expect(cancelled!.completedChunks).toBeLessThan(10);
    expect(cancelled!.completedAt).toBeTruthy();

    const v = await repo.getVersionById(version.id!);
    expect(v!.status).toBe("FAILED");
  });

  it("重建 = 从零：构建开始前清空该版本遗留数据行（upsert 空更新不会清理旧行）", async () => {
    const { repo, physicalStore, service, runner, def, version, job } = await makeFixture();
    // 模拟「上一轮构建遗留的旧行」（落库走 ON DUPLICATE KEY UPDATE id=id，空更新 ⇒ 永不清理）
    physicalStore.seedRows(def, version.id!, 99);
    expect((await service.purgeVersionRows(version.id!)).purgedRows).toBe(495); // 前置事实：确实有旧行
    physicalStore.seedRows(def, version.id!, 99); // 复原，交由构建自身清理

    await service.startJob(job.jobId);
    await runner.start(job.jobId);
    await waitFor(async () => (await repo.getJob(job.jobId))?.status === "COMPLETED");

    // 旧行已被构建开始前的清场删除；此处再清一次应为 0
    expect((await service.purgeVersionRows(version.id!)).purgedRows).toBe(0);
  });

  it("取消即回滚：waitForStop 等到执行体真正退出后，该版本已落库数据被清空", async () => {
    const { repo, physicalStore, service, runner, def, version, job } = await makeFixture({
      delayPerChunkMs: 40,
      chunks: 10,
    });
    await service.startJob(job.jobId);
    await runner.start(job.jobId);
    await waitFor(async () => ((await repo.getJob(job.jobId))?.completedChunks ?? 0) >= 1);
    // 模拟「构建期间已落库的中间产物」（真实场景由 builder 的 flush 写入）
    physicalStore.seedRows(def, version.id!, 20);

    const stopped = await runner.waitForStop(job.jobId, 5000);
    expect(stopped).toBe(true);
    expect(runner.isRunning(job.jobId)).toBe(false); // 返回 true ⇒ 已无写入者，可安全回滚

    const { job: cancelled, rollback } = await service.cancelJobAndRollback(job.jobId);
    expect(cancelled.status).toBe("CANCELLED");
    expect(rollback.purgedRows).toBe(100); // 5 表 × 20 行
    expect((await repo.getVersionById(version.id!))!.status).toBe("FAILED");
    expect((await service.purgeVersionRows(version.id!)).purgedRows).toBe(0);
  });

  it("waitForStop：本进程无在途执行体 → 立即 true（孤儿作业可安全回滚）", async () => {
    const { runner } = await makeFixture();
    const started = Date.now();
    expect(await runner.waitForStop("no-such-job", 30_000)).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("start 会联动版本 → BUILDING（构建期间）", async () => {
    const { repo, service, runner, version, job } = await makeFixture({ delayPerChunkMs: 40 });
    await service.startJob(job.jobId);
    await runner.start(job.jobId);
    await waitFor(async () => (await repo.getVersionById(version.id!))?.status === "BUILDING");
    await waitFor(async () => (await repo.getJob(job.jobId))?.status === "COMPLETED", 4000);
  });

  it("DatasetLifecycleError 是稳定错误类型（可被上层映射）", async () => {
    const { runner } = await makeFixture();
    await runner.start("no-such-job").catch((e) => {
      expect(e).toBeInstanceOf(DatasetLifecycleError);
    });
  });
});
