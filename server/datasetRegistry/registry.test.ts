/**
 * STEP DATASET-001 — Registry 测试（§38.2 Definition Test / §38.3 Version Test / §38.4 Version Isolation）。
 */

import { describe, expect, it } from "vitest";
import { DatasetRegistryService, InMemoryDatasetRegistry } from "./registry";
import { DatasetPluginRegistry } from "./plugins";
import { InMemoryDatasetPhysicalStore } from "./physicalTables";
import { DatasetLifecycleError } from "./lifecycle";
import { makeTestFilter, makeTestPlugin } from "./testHelpers";

/** 测试用数据集代码（每个都注册了假插件，使构建能力校验可通过）。 */
const TEST_CODES = ["first_limit_pullback", "breakout", "consecutive_limit"] as const;

function makeService(): DatasetRegistryService {
  const plugins = new DatasetPluginRegistry();
  for (const code of TEST_CODES) plugins.register(makeTestPlugin({ datasetCode: code }));
  return new DatasetRegistryService(new InMemoryDatasetRegistry(), {
    plugins,
    physicalStore: new InMemoryDatasetPhysicalStore(),
  });
}

describe("Dataset Registry", () => {
  it("datasetCode 唯一（重复创建被拒绝）", async () => {
    const svc = makeService();
    await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    await expect(
      svc.createDefinition({ datasetCode: "first_limit_pullback", name: "dup", datasetType: "EVENT" }),
    ).rejects.toThrow(/已存在/);
  });

  it("创建定义时物理表名显式落库（§8 不运行时猜名）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    expect(def.eventTableName).toBe("ds_first_limit_pullback_event");
    expect(def.pathTableName).toBe("ds_first_limit_pullback_path");
    expect(def.outcomeTableName).toBe("ds_first_limit_pullback_outcome");
    expect(def.featureTableName).toBeNull();
  });

  it("非法 datasetCode 拒绝创建", async () => {
    const svc = makeService();
    await expect(
      svc.createDefinition({ datasetCode: "first_limit_pullback_v1", name: "x", datasetType: "EVENT" }),
    ).rejects.toThrow(/非法 datasetCode/);
  });

  it("(datasetId, version) 唯一（§38.3）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "breakout", name: "突破", datasetType: "EVENT" });
    const datasetId = def.id!;
    await svc.createVersion({ datasetId, version: "v1", startDate: null, endDate: null });
    await expect(
      svc.createVersion({ datasetId, version: "v1", startDate: null, endDate: null }),
    ).rejects.toThrow(/版本已存在/);
    // 不同 dataset 可用同 version 字符串
    const def2 = await svc.createDefinition({ datasetCode: "consecutive_limit", name: "连板", datasetType: "EVENT" });
    await expect(svc.createVersion({ datasetId: def2.id!, version: "v1", startDate: null, endDate: null })).resolves.toBeDefined();
  });

  it("Version 隔离：v1 / v2 物理同表、逻辑隔离（dataset_version_id）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v1 = await svc.createVersion({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-06-30" });
    const v2 = await svc.createVersion({ datasetId: def.id!, version: "v2", startDate: "2024-07-01", endDate: "2024-12-31" });
    expect(v1.id).not.toBe(v2.id);
    expect(v1.id).toBeDefined();
    expect(v2.id).toBeDefined();
    // 物理表名不因 version 变化（§30：禁止一版一表）
    expect(def.eventTableName).toBe("ds_first_limit_pullback_event");
  });

  it("作业生命周期：create → start → progress → complete", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "breakout", name: "突破", datasetType: "EVENT" });
    const v = await svc.createVersion({ datasetId: def.id!, version: "v1", startDate: null, endDate: null });
    const job = await svc.createJob(v.id!);
    expect(job.status).toBe("PENDING");
    const running = await svc.startJob(job.jobId);
    expect(running.status).toBe("RUNNING");
    await svc.updateJobProgress(job.jobId, { processedRows: 100, lastTradeDate: "2024-01-03" });
    await svc.completeJob(job.jobId);
    const done = await (svc as unknown as { repo: { getJob: (id: string) => Promise<{ status: string }> } }).repo.getJob(job.jobId);
    expect(done.status).toBe("COMPLETED");
  });
});

describe("DATASET-002.4A · Build Job Lifecycle（service 层）", () => {
  async function makeVersion(svc: DatasetRegistryService) {
    const def = await svc.createDefinition({ datasetCode: "breakout", name: "突破", datasetType: "EVENT" });
    const v = await svc.createVersion({ datasetId: def.id!, version: "v1", startDate: null, endDate: null });
    return v;
  }

  it("createJob：PENDING；无效版本被拒（VERSION_NOT_FOUND）", async () => {
    const svc = makeService();
    await expect(svc.createJob(9999)).rejects.toThrow(DatasetLifecycleError);
    await expect(svc.createJob(9999)).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
  });

  it("createJob：BUILDING 版本不可创建（VERSION_NOT_BUILDABLE）", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    await svc.markBuilding(v.id!);
    await expect(svc.createJob(v.id!)).rejects.toMatchObject({ code: "VERSION_NOT_BUILDABLE" });
  });

  it("startJob：PENDING→RUNNING；非法 job 被拒", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const job = await svc.createJob(v.id!);
    expect(job.status).toBe("PENDING");
    const running = await svc.startJob(job.jobId);
    expect(running.status).toBe("RUNNING");
    expect(running.startedAt).toBeTruthy();
    await expect(svc.startJob("no-such-job")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  it("重复 start 被拒（INVALID_JOB_TRANSITION）", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const job = await svc.createJob(v.id!);
    await svc.startJob(job.jobId);
    await expect(svc.startJob(job.jobId)).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  it("cancelJob：PENDING 可取消、RUNNING 可取消", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const a = await svc.createJob(v.id!);
    await svc.cancelJob(a.jobId);
    expect((await svc["repo"].getJob(a.jobId))!.status).toBe("CANCELLED");

    const b = await svc.createJob(v.id!);
    await svc.startJob(b.jobId);
    await svc.cancelJob(b.jobId);
    expect((await svc["repo"].getJob(b.jobId))!.status).toBe("CANCELLED");
  });

  it("重复 cancel 被拒（INVALID_JOB_TRANSITION）", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const job = await svc.createJob(v.id!);
    await svc.cancelJob(job.jobId);
    await expect(svc.cancelJob(job.jobId)).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  it("COMPLETED/FAILED 不可取消", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const done = await svc.createJob(v.id!);
    await svc.startJob(done.jobId);
    await svc.completeJob(done.jobId);
    await expect(svc.cancelJob(done.jobId)).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });

    const failed = await svc.createJob(v.id!);
    await svc.startJob(failed.jobId);
    await svc.failJob(failed.jobId, "boom");
    await expect(svc.cancelJob(failed.jobId)).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  it("completeJob/failJob：仅 RUNNING 可转换，重复被拒", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const job = await svc.createJob(v.id!);
    // PENDING 不可直接 complete / fail
    await expect(svc.completeJob(job.jobId)).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
    await expect(svc.failJob(job.jobId, "x")).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });

    await svc.startJob(job.jobId);
    await svc.completeJob(job.jobId);
    await expect(svc.completeJob(job.jobId)).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
    await expect(svc.failJob(job.jobId, "x")).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  it("retryJob：FAILED/CANCELLED → 新 PENDING；历史 Job 保留", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const original = await svc.createJob(v.id!);
    await svc.startJob(original.jobId);
    await svc.failJob(original.jobId, "boom");

    const retried = await svc.retryJob(original.jobId);
    expect(retried.status).toBe("PENDING");
    expect(retried.jobId).not.toBe(original.jobId);
    expect(retried.datasetVersionId).toBe(original.datasetVersionId);

    // 历史 Job 保留且仍 FAILED
    const history = (await svc["repo"].listJobs(v.id!)).map((j) => ({ id: j.jobId, status: j.status }));
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.jobId, status: "FAILED" }),
      expect.objectContaining({ id: retried.jobId, status: "PENDING" }),
    ]));
  });

  it("retryJob：非 FAILED/CANCELLED 被拒", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const job = await svc.createJob(v.id!);
    await svc.startJob(job.jobId);
    await expect(svc.retryJob(job.jobId)).rejects.toMatchObject({ code: "INVALID_JOB_TRANSITION" });
  });

  it("并发保护：两个 Job 同一版本，第二个 start 被拒（JOB_ALREADY_RUNNING）", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    const a = await svc.createJob(v.id!);
    const b = await svc.createJob(v.id!);
    await svc.startJob(a.jobId);
    await expect(svc.startJob(b.jobId)).rejects.toMatchObject({ code: "JOB_ALREADY_RUNNING" });
  });

  it("Version 状态机：非法 markReady/markFailed 被拒", async () => {
    const svc = makeService();
    const v = await makeVersion(svc);
    // DRAFT → READY 非法
    await expect(svc.markReady(v.id!, { totalEvents: 0, totalRows: 0 })).rejects.toMatchObject({ code: "INVALID_VERSION_TRANSITION" });
    // DRAFT → FAILED 非法
    await expect(svc.markFailed(v.id!)).rejects.toMatchObject({ code: "INVALID_VERSION_TRANSITION" });
    // 合法：DRAFT → BUILDING → READY
    await svc.markBuilding(v.id!);
    await svc.markReady(v.id!, { totalEvents: 0, totalRows: 0 });
    // READY → FAILED 非法
    await expect(svc.markFailed(v.id!)).rejects.toMatchObject({ code: "INVALID_VERSION_TRANSITION" });
  });
});

describe("DATASET-002.4B / 003B · createVersionWithBuildConfig（构建入口）", () => {
  it("创建 DRAFT 版本并固化筛选配置（filterDefinition 镜像 + dataset_build_config 行）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const filter = makeTestFilter({
      boards: ["main", "chinext"],
      excludeSt: true,
      events: [{ relativeDay: 0, kind: "firstBoard" }, { relativeDay: -1, kind: "limitUp" }],
      preWindowDays: 5,
      postWindowDays: 30,
      outcomeHorizons: [3, 5],
      batchSize: 500,
    });
    const v = await svc.createVersionWithBuildConfig({
      datasetId: def.id!,
      version: "v1",
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      filter,
    });
    expect(v.status).toBe("DRAFT");
    expect(v.startDate).toBe("2024-01-01");
    expect(v.endDate).toBe("2024-12-31");

    // legacy 镜像（审计 / 回退用）
    const mirror = v.filterDefinition as Record<string, unknown>;
    expect(mirror.kind).toBe("build-config");
    expect(mirror.builder).toBe("first_limit_pullback");
    expect(mirror.pathHorizon).toBe(30);
    expect(mirror.postWindowDays).toBe(30);
    expect(mirror.preWindowDays).toBe(5);
    expect(mirror.outcomeHorizons).toEqual([3, 5]);
    expect(mirror.batchSize).toBe(500);

    // 权威来源：dataset_build_config 行（标量 + 子表多值）
    const cfg = await svc.getBuildConfig(v.id!);
    expect(cfg).toBeDefined();
    expect(cfg!.boards).toEqual(["main", "chinext"]);
    expect(cfg!.excludeSt).toBe(true);
    expect(cfg!.events).toEqual([
      { relativeDay: 0, kind: "firstBoard" },
      { relativeDay: -1, kind: "limitUp" },
    ]);
    expect(cfg!.preWindowDays).toBe(5);
    expect(cfg!.postWindowDays).toBe(30);
    expect(cfg!.outcomeHorizons).toEqual([3, 5]);
    expect(cfg!.batchSize).toBe(500);

    // 物理表名不因 version 变化（§30）
    expect(def.eventTableName).toBe("ds_first_limit_pullback_event");
  });

  it("缺省筛选参数：回退权威默认（事件日首板 / 无前置 / t+20 / [5,10,20] / 1000）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v = await svc.createVersionWithBuildConfig({
      datasetId: def.id!,
      version: "v1",
      startDate: "2024-01-01",
      endDate: "2024-06-30",
      // 只给必填的事件维度；其余项缺省 → 由权威默认补齐（boards 空 / 不排除 ST / 前置 0 / t+20 / [5,10,20] / 1000）
      filter: makeTestFilter({
        boards: undefined,
        excludeSt: undefined,
        preWindowDays: undefined,
        postWindowDays: undefined,
        outcomeHorizons: undefined,
        batchSize: undefined,
      }),
    });
    const cfg = await svc.getBuildConfig(v.id!);
    expect(cfg!.boards).toEqual([]);
    expect(cfg!.excludeSt).toBe(false);
    expect(cfg!.events).toEqual([{ relativeDay: 0, kind: "firstBoard" }]);
    expect(cfg!.preWindowDays).toBe(0);
    expect(cfg!.postWindowDays).toBe(20);
    expect(cfg!.outcomeHorizons).toEqual([5, 10, 20]);
    expect(cfg!.batchSize).toBe(1000);

    // 解析出的执行配置 = 与旧口径一致（不动筛选项时建出的数据语义不变）
    const resolved = await svc.resolveBuildConfigForVersion(v.id!);
    expect(resolved.startDate).toBe("2024-01-01");
    expect(resolved.postWindowDays).toBe(20);
    expect(resolved.events).toEqual([{ relativeDay: 0, kind: "firstBoard" }]);
  });

  it("未完成筛选配置（events 为空）→ INVALID_BUILD_FILTER（构建门禁）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    await expect(
      svc.createVersionWithBuildConfig({
        datasetId: def.id!,
        version: "v1",
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        filter: makeTestFilter({ events: [] }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_BUILD_FILTER" });
    // 不得留下半成品版本：同 version 再用合法配置创建应当成功（说明 v1 未被占用）
    const ok = await svc.createVersionWithBuildConfig({
      datasetId: def.id!,
      version: "v1",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      filter: makeTestFilter(),
    });
    expect(ok.status).toBe("DRAFT");
  });

  it("筛选边界越界 → INVALID_BUILD_FILTER（不静默夹取）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const base = { datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31" };
    await expect(
      svc.createVersionWithBuildConfig({ ...base, filter: makeTestFilter({ preWindowDays: -1 }) }),
    ).rejects.toMatchObject({ code: "INVALID_BUILD_FILTER" });
    await expect(
      svc.createVersionWithBuildConfig({ ...base, filter: makeTestFilter({ postWindowDays: 0 }) }),
    ).rejects.toMatchObject({ code: "INVALID_BUILD_FILTER" });
    await expect(
      svc.createVersionWithBuildConfig({ ...base, filter: makeTestFilter({ events: [{ relativeDay: 1, kind: "firstBoard" }] }) }),
    ).rejects.toMatchObject({ code: "INVALID_BUILD_FILTER" });
    await expect(
      svc.createVersionWithBuildConfig({ ...base, filter: makeTestFilter({ boards: ["nasdaq"] }) }),
    ).rejects.toMatchObject({ code: "INVALID_BUILD_FILTER" });
    await expect(
      svc.createVersionWithBuildConfig({
        ...base,
        filter: makeTestFilter({ events: [{ relativeDay: 0, kind: "firstBoard" }, { relativeDay: 0, kind: "firstBoard" }] }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_BUILD_FILTER" });
  });

  it("重复版本 → VERSION_ALREADY_EXISTS", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    await svc.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    await expect(
      svc.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-02-01", endDate: "2024-02-29", filter: makeTestFilter() }),
    ).rejects.toMatchObject({ code: "VERSION_ALREADY_EXISTS" });
  });

  it("定义不存在 → DEFINITION_NOT_FOUND", async () => {
    const svc = makeService();
    await expect(
      svc.createVersionWithBuildConfig({ datasetId: 9999, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() }),
    ).rejects.toMatchObject({ code: "DEFINITION_NOT_FOUND" });
  });

  it("定义已归档 → DEFINITION_ARCHIVED", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    await svc.archiveDefinition(def.id!);
    await expect(
      svc.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() }),
    ).rejects.toMatchObject({ code: "DEFINITION_ARCHIVED" });
  });

  it("非法版本标签 → INVALID_VERSION_LABEL（含空格 / 首字符为符号）", async () => {
    const svc = makeService();
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    await expect(
      svc.createVersionWithBuildConfig({ datasetId: def.id!, version: "v 1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() }),
    ).rejects.toMatchObject({ code: "INVALID_VERSION_LABEL" });
    await expect(
      svc.createVersionWithBuildConfig({ datasetId: def.id!, version: "-v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() }),
    ).rejects.toMatchObject({ code: "INVALID_VERSION_LABEL" });
  });
});

describe("DATASET-003A · 多数据集与删除", () => {
  function makeBundle() {
    const plugins = new DatasetPluginRegistry();
    for (const code of TEST_CODES) plugins.register(makeTestPlugin({ datasetCode: code }));
    const physicalStore = new InMemoryDatasetPhysicalStore();
    const repo = new InMemoryDatasetRegistry();
    const service = new DatasetRegistryService(repo, { plugins, physicalStore });
    return { plugins, physicalStore, repo, service };
  }

  it("插件已注册：createDefinition 同时建立物理表（每个数据集独立表名）", async () => {
    const { physicalStore, service } = makeBundle();
    await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    await service.createDefinition({ datasetCode: "breakout", name: "突破", datasetType: "EVENT" });
    expect(physicalStore.listTables()).toEqual([
      "ds_breakout_event",
      "ds_breakout_outcome",
      "ds_breakout_path",
      "ds_breakout_post",
      "ds_breakout_prefix",
      "ds_first_limit_pullback_event",
      "ds_first_limit_pullback_outcome",
      "ds_first_limit_pullback_path",
      "ds_first_limit_pullback_post",
      "ds_first_limit_pullback_prefix",
    ]);
  });

  it("未注册插件：可登记定义（不建表），但创建构建作业被拒（BUILDER_NOT_REGISTERED）", async () => {
    const { physicalStore, service } = makeBundle();
    const def = await service.createDefinition({ datasetCode: "momentum_rank", name: "动量排名", datasetType: "FACTOR" });
    expect(physicalStore.listTables()).toEqual([]); // 无插件 → 不建表
    expect(service.isBuildable("momentum_rank")).toBe(false);
    const v = await service.createVersion({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31" });
    await expect(service.createJob(v.id!)).rejects.toMatchObject({ code: "BUILDER_NOT_REGISTERED" });
  });

  it("isBuildable：已注册插件为 true", async () => {
    const { service } = makeBundle();
    expect(service.isBuildable("first_limit_pullback")).toBe(true);
    expect(service.isBuildable("no_such_dataset")).toBe(false);
  });

  it("deleteVersion：删数据（保留表结构）+ 删作业 + 删版本记录", async () => {
    const { physicalStore, repo, service } = makeBundle();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v1 = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    const v2 = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v2", startDate: "2024-02-01", endDate: "2024-02-29", filter: makeTestFilter() });
    physicalStore.seedRows(def, v1.id!, 100);
    physicalStore.seedRows(def, v2.id!, 200);
    const job = await service.createJob(v1.id!);
    await service.cancelJob(job.jobId); // terminal，允许删除

    const result = await service.deleteVersion(v1.id!);
    expect(result.datasetVersionId).toBe(v1.id!);
    expect(result.purgedRows).toBe(500); // 5 表 × 100 行
    expect(result.jobsDeleted).toBe(1);
    expect(result.tables.every((t) => !t.tableMissing)).toBe(true);

    // 版本记录已删除；v2 仍在；表结构保留（其它版本仍可用）
    expect(await repo.getVersionById(v1.id!)).toBeUndefined();
    expect(await repo.getVersionById(v2.id!)).toBeDefined();
    expect(physicalStore.hasTable("ds_first_limit_pullback_event")).toBe(true);
    expect(physicalStore.hasTable("ds_first_limit_pullback_path")).toBe(true);
    expect(physicalStore.hasTable("ds_first_limit_pullback_outcome")).toBe(true);
  });

  it("deleteVersion：RUNNING 作业存在 → 拒绝（VERSION_HAS_RUNNING_JOB）", async () => {
    const { service } = makeBundle();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    const job = await service.createJob(v.id!);
    await service.startJob(job.jobId); // RUNNING
    await expect(service.deleteVersion(v.id!)).rejects.toMatchObject({ code: "VERSION_HAS_RUNNING_JOB" });
  });

  it("deleteVersion：版本不存在 → VERSION_NOT_FOUND", async () => {
    const { service } = makeBundle();
    await expect(service.deleteVersion(9999)).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
  });

  it("deleteDefinition：级联删版本 + DROP 物理表 + 删定义（可同 code 重建）", async () => {
    const { physicalStore, repo, service } = makeBundle();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v1 = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    const v2 = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v2", startDate: "2024-02-01", endDate: "2024-02-29", filter: makeTestFilter() });
    physicalStore.seedRows(def, v1.id!, 10);
    physicalStore.seedRows(def, v2.id!, 20);
    const j1 = await service.createJob(v1.id!);
    const j2 = await service.createJob(v2.id!);
    await service.cancelJob(j1.jobId);
    await service.cancelJob(j2.jobId);

    const result = await service.deleteDefinition(def.id!);
    expect(result.datasetCode).toBe("first_limit_pullback");
    expect(result.versionsDeleted).toBe(2);
    expect(result.purgedRows).toBe(150); // (10 + 20) × 5 表
    expect(result.jobsDeleted).toBe(2);
    expect(result.droppedTables.every((t) => t.dropped)).toBe(true);

    // 表结构随数据集一并删除
    expect(physicalStore.listTables()).toEqual([]);
    // 定义与版本记录已删除
    expect(await repo.getDefinitionById(def.id!)).toBeUndefined();
    expect(await repo.getVersionById(v1.id!)).toBeUndefined();

    // 同 code 可重建（datasetCode 已释放）
    const rebuilt = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "重建", datasetType: "EVENT" });
    expect(rebuilt.id).not.toBe(def.id);
    expect(physicalStore.hasTable("ds_first_limit_pullback_event")).toBe(true);
  });

  it("deleteDefinition：存在 RUNNING 作业 → 拒绝（DEFINITION_HAS_RUNNING_JOB）", async () => {
    const { service } = makeBundle();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    const job = await service.createJob(v.id!);
    await service.startJob(job.jobId);
    await expect(service.deleteDefinition(def.id!)).rejects.toMatchObject({ code: "DEFINITION_HAS_RUNNING_JOB" });
  });

  it("deleteDefinition：不存在 → DEFINITION_NOT_FOUND", async () => {
    const { service } = makeBundle();
    await expect(service.deleteDefinition(9999)).rejects.toMatchObject({ code: "DEFINITION_NOT_FOUND" });
  });

  it("多数据集隔离：删 A 不影响 B 的定义 / 版本 / 物理表", async () => {
    const { physicalStore, repo, service } = makeBundle();
    const a = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "A", datasetType: "EVENT" });
    const b = await service.createDefinition({ datasetCode: "breakout", name: "B", datasetType: "EVENT" });
    const va = await service.createVersionWithBuildConfig({ datasetId: a.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    const vb = await service.createVersionWithBuildConfig({ datasetId: b.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    physicalStore.seedRows(a, va.id!, 5);
    physicalStore.seedRows(b, vb.id!, 7);

    await service.deleteDefinition(a.id!);

    expect(await repo.getDefinitionById(a.id!)).toBeUndefined();
    expect(await repo.getDefinitionById(b.id!)).toBeDefined();
    expect(await repo.getVersionById(vb.id!)).toBeDefined();
    expect(physicalStore.listTables()).toEqual([
      "ds_breakout_event",
      "ds_breakout_outcome",
      "ds_breakout_path",
      "ds_breakout_post",
      "ds_breakout_prefix",
    ]);
  });

  it("deleteVersion / deleteDefinition：无物理表存储时明确报错（不静默跳过）", async () => {
    const svc = new DatasetRegistryService(new InMemoryDatasetRegistry());
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "x", datasetType: "EVENT" });
    const v = await svc.createVersion({ datasetId: def.id!, version: "v1", startDate: null, endDate: null });
    await expect(svc.deleteVersion(v.id!)).rejects.toThrow(/物理/);
  });
});

describe("DATASET-LIFECYCLE-001 · 取消即回滚（取消 ≠ 暂停）", () => {
  function makeBundle() {
    const plugins = new DatasetPluginRegistry();
    plugins.register(makeTestPlugin());
    const physicalStore = new InMemoryDatasetPhysicalStore();
    const repo = new InMemoryDatasetRegistry();
    const service = new DatasetRegistryService(repo, { plugins, physicalStore });
    return { physicalStore, repo, service };
  }

  async function makeVersion(service: DatasetRegistryService, label = "v1") {
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const version = await service.createVersionWithBuildConfig({
      datasetId: def.id!,
      version: label,
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      filter: makeTestFilter(),
    });
    return { def, version };
  }

  it("RUNNING 取消 → 作业 CANCELLED + 版本 FAILED + 该版本数据行清空（表结构保留、其它版本不受影响）", async () => {
    const { physicalStore, repo, service } = makeBundle();
    const { def, version } = await makeVersion(service, "v1");
    const other = await service.createVersionWithBuildConfig({
      datasetId: def.id!,
      version: "v2",
      startDate: "2024-02-01",
      endDate: "2024-02-29",
      filter: makeTestFilter(),
    });
    physicalStore.seedRows(def, version.id!, 100);
    physicalStore.seedRows(def, other.id!, 200);

    const job = await service.createJob(version.id!);
    await service.startJob(job.jobId);
    await service.markBuilding(version.id!); // 真实 runner 在执行前会置 BUILDING（此处显式复现）
    const { job: cancelled, rollback, alreadyCancelled } = await service.cancelJobAndRollback(job.jobId);

    expect(cancelled.status).toBe("CANCELLED");
    expect(alreadyCancelled).toBe(false);
    expect(rollback.purgedRows).toBe(500); // 5 表 × 100 行
    expect((await repo.getVersionById(version.id!))!.status).toBe("FAILED");
    // 表结构保留（可重建），其它版本数据未被牵连
    expect(physicalStore.hasTable("ds_first_limit_pullback_event")).toBe(true);
    expect((await service.purgeVersionRows(other.id!)).purgedRows).toBe(1000); // 5 × 200
  });

  it("幂等：对已 CANCELLED 的作业再次取消不抛错，只补做回滚（并修回版本态）", async () => {
    const { physicalStore, repo, service } = makeBundle();
    const { def, version } = await makeVersion(service);
    const job = await service.createJob(version.id!);
    await service.startJob(job.jobId);
    await service.markBuilding(version.id!);
    await service.cancelJobAndRollback(job.jobId);

    // 模拟「首次取消回滚失败 / 版本态卡在 BUILDING」的遗留现场
    physicalStore.seedRows(def, version.id!, 7);
    await repo.updateVersion(version.id!, { status: "BUILDING" });

    const again = await service.cancelJobAndRollback(job.jobId);
    expect(again.alreadyCancelled).toBe(true);
    expect(again.job.status).toBe("CANCELLED");
    expect(again.rollback.purgedRows).toBe(35);
    expect((await repo.getVersionById(version.id!))!.status).toBe("FAILED"); // 版本态兜底修复
  });

  it("COMPLETED 作业不可取消（不冒充可回滚）", async () => {
    const { service } = makeBundle();
    const { version } = await makeVersion(service);
    const job = await service.createJob(version.id!);
    await service.startJob(job.jobId);
    await service.completeJob(job.jobId);
    await expect(service.cancelJobAndRollback(job.jobId)).rejects.toMatchObject({
      code: "INVALID_JOB_TRANSITION",
    });
  });

  it("取消 PENDING 作业同样清空该版本残留数据（版本态保持可构建）", async () => {
    const { physicalStore, repo, service } = makeBundle();
    const { def, version } = await makeVersion(service);
    physicalStore.seedRows(def, version.id!, 3);
    const job = await service.createJob(version.id!);
    const { rollback } = await service.cancelJobAndRollback(job.jobId);
    expect(rollback!.purgedRows).toBe(15);
    // 从未进入 BUILDING 的版本保持 DRAFT（不需要「修回可构建」）
    expect((await repo.getVersionById(version.id!))!.status).toBe("DRAFT");
  });

  it("🔴 版本仍是 READY（本轮构建尚未接管）→ 取消**不得清空数据**，原数据集保持有效", async () => {
    const { physicalStore, repo, service } = makeBundle();
    const { def, version } = await makeVersion(service);

    // 现场：一个已 READY 的可用版本（含 100 行有效数据）；用户点了「重建」又立刻取消，
    // 而 runner.execute 的执行顺序是 markBuilding → 清场 → build，
    // 此时尚未走到 markBuilding ⇒ 版本仍是 READY ⇒ 本轮既未清场也未写入任何行。
    await service.markBuilding(version.id!);
    await service.markReady(version.id!, { totalEvents: 10, totalRows: 500 });
    physicalStore.seedRows(def, version.id!, 100);

    const job = await service.createJob(version.id!); // 重建作业（READY 可重建）
    await service.startJob(job.jobId);
    const result = await service.cancelJobAndRollback(job.jobId);

    expect(result.job.status).toBe("CANCELLED");
    // 关键：不是「清了 0 行」，而是**按语义不回滚**（否则会制造 status=READY 却 0 行的谎报态）
    expect(result.rollback).toBeNull();
    expect(result.rollbackSkippedReason).toMatch(/READY/);
    // 原数据 100% 保留（5 表 × 100 行），版本态不变
    expect((await service.purgeVersionRows(version.id!)).purgedRows).toBe(500);
    expect((await repo.getVersionById(version.id!))!.status).toBe("READY");
  });

  it("无物理表存储时 cancelJobAndRollback 明确报错（不静默跳过）", async () => {
    const plugins = new DatasetPluginRegistry();
    plugins.register(makeTestPlugin());
    const svc = new DatasetRegistryService(new InMemoryDatasetRegistry(), { plugins });
    const def = await svc.createDefinition({ datasetCode: "first_limit_pullback", name: "x", datasetType: "EVENT" });
    const v = await svc.createVersion({ datasetId: def.id!, version: "v1", startDate: null, endDate: null });
    const job = await svc.createJob(v.id!);
    await expect(svc.cancelJobAndRollback(job.jobId)).rejects.toThrow(/物理/);
  });
});

describe("DATASET-LIFECYCLE-001 · 孤儿作业回收", () => {
  /** 造一个「RUNNING 作业 + BUILDING 版本」fixture（= 进程退出后残留的孤儿形态）。 */
  async function makeOrphan() {
    const plugins = new DatasetPluginRegistry();
    plugins.register(makeTestPlugin());
    const physicalStore = new InMemoryDatasetPhysicalStore();
    const repo = new InMemoryDatasetRegistry();
    const service = new DatasetRegistryService(repo, { plugins, physicalStore });
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const version = await service.createVersionWithBuildConfig({
      datasetId: def.id!,
      version: "v1",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      filter: makeTestFilter(),
    });
    physicalStore.seedRows(def, version.id!, 40);
    const job = await service.createJob(version.id!);
    await service.startJob(job.jobId); // RUNNING
    await service.markBuilding(version.id!); // BUILDING
    return { physicalStore, repo, service, version, job };
  }

  it("停更超过阈值 → 回收：作业 CANCELLED + 版本 FAILED + 数据清空（表结构保留、死锁解除）", async () => {
    const { physicalStore, repo, service, version, job } = await makeOrphan();
    // 注入「一小时后的时钟」：作业 updatedAt 是刚刚写入的 ⇒ 相对该时刻已停更 60 分钟。
    const result = await service.reclaimStaleJobs({ staleMinutes: 10, now: new Date(Date.now() + 60 * 60_000) });

    expect(result).toHaveLength(1);
    expect(result[0]!.jobId).toBe(job.jobId);
    expect(result[0]!.staleMinutes).toBe(60);
    expect(result[0]!.purgedRows).toBe(200); // 5 表 × 40 行
    expect(result[0]!.rollbackSkipped).toBe(false);
    expect((await repo.getJob(job.jobId))!.status).toBe("CANCELLED");
    expect((await repo.getVersionById(version.id!))!.status).toBe("FAILED");
    expect(physicalStore.hasTable("ds_first_limit_pullback_event")).toBe(true);
    // 死锁解除的标志：不再有 RUNNING 作业 ⇒ 可重建、可删除
    expect(await repo.getRunningJobForVersion(version.id!)).toBeUndefined();
  });

  it("仍在刷新进度（updatedAt 新）→ 视为存活，不回收", async () => {
    const { repo, service, job } = await makeOrphan();
    expect(await service.reclaimStaleJobs({ staleMinutes: 10, now: new Date() })).toHaveLength(0);
    expect((await repo.getJob(job.jobId))!.status).toBe("RUNNING");
  });

  it("staleMinutes <= 0 → 整体跳过（关闭自动回收）", async () => {
    const { repo, service, job } = await makeOrphan();
    expect(await service.reclaimStaleJobs({ staleMinutes: 0 })).toHaveLength(0);
    expect((await repo.getJob(job.jobId))!.status).toBe("RUNNING");
  });

  it("🔴 版本仍是 READY（本轮未接管）→ 回收作业但**不清空**该版本有效数据", async () => {
    const { physicalStore, repo, service, version, job } = await makeOrphan();
    // 极端窗口：重建的 markBuilding 还没执行，进程就退出了（版本停在 READY）。
    await repo.updateVersion(version.id!, { status: "READY" });
    const result = await service.reclaimStaleJobs({ staleMinutes: 10, now: new Date(Date.now() + 60 * 60_000) });

    expect(result).toHaveLength(1);
    expect(result[0]!.rollbackSkipped).toBe(true);
    expect(result[0]!.purgedRows).toBe(0);
    expect((await repo.getJob(job.jobId))!.status).toBe("CANCELLED"); // 死锁仍被解除
    expect((await repo.getVersionById(version.id!))!.status).toBe("READY");
    // 数据未被销毁（仍在）
    expect((await service.purgeVersionRows(version.id!)).purgedRows).toBe(200);
    expect(physicalStore.hasTable("ds_first_limit_pullback_event")).toBe(true);
  });
});
