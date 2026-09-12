/**
 * STEP DATASET-002.2 — datasetRegistryRouter 单测（InMemory 依赖注入，不触真实 DB）。
 *
 * 覆盖：router 注册守卫、入参校验（id/date/limit/cursor/date 区间）、
 * Definition/Version/Job list/get、Statistics、Event/Path/Outcome keyset 分页端点、
 * update/archive admin 端点。
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { InMemoryDatasetDataReader } from "./query";
import { makeTestFilter, makeTestRouter, makeTestService } from "./testHelpers";
import type { FirstLimitPullbackEvent, FirstLimitPullbackOutcome, FirstLimitPullbackPath } from "./types";

/** 测试用 admin 用户（跨 describe 复用）。 */
const adminUser = {
  id: 1,
  openId: "t",
  name: "t",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function makeEvent(datasetVersionId: number, symbol: string, tradeDate: string): FirstLimitPullbackEvent {
  return {
    datasetVersionId,
    eventId: `${symbol}@${tradeDate}`,
    symbol,
    tradeDate,
    market: null,
    industryCode: null,
    boardType: "main",
    open: 10,
    high: 11,
    low: 9.5,
    close: 11,
    previousClose: 10,
    limitUpPrice: 11,
    volume: 1000,
    amount: 10000,
    turnover: 5,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 0,
    marketCap: 1000000,
    floatMarketCap: 500000,
  };
}

function makePath(datasetVersionId: number, eventId: string, relativeDay: number): FirstLimitPullbackPath {
  return {
    datasetVersionId,
    eventId,
    symbol: eventId.split("@")[0]!,
    tradeDate: "2024-01-03",
    relativeDay,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1000,
    amount: 10000,
    turnover: 5,
    returnFromEventClose: 0.01,
    highFromEventClose: 0.02,
    lowFromEventClose: -0.01,
    closeFromEventClose: 0.005,
    pullbackFromEventClose: -0.005,
    pullbackFromEventHigh: -0.01,
    volumeRatio: 0.9,
    isBreakout: false,
    breakoutPrice: null,
    daysToBreakout: null,
  };
}

function makeOutcome(datasetVersionId: number, eventId: string, horizon: number): FirstLimitPullbackOutcome {
  return {
    datasetVersionId,
    eventId,
    horizon,
    maxReturn: 0.05,
    minReturn: -0.02,
    maxDrawdown: -0.03,
    isBreakout: false,
    daysToBreakout: null,
  };
}

async function buildFixture() {
  const { repo, plugins, physicalStore, service } = makeTestService();
  const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
  const version = await service.createVersion({ datasetId: def.id!, version: "v2", startDate: "2024-01-01", endDate: "2024-12-31" });
  await service.markBuilding(version.id!);
  await service.markReady(version.id!, { totalEvents: 2, totalRows: 6 });
  const createdJob = await service.createJob(version.id!);
  await service.startJob(createdJob.jobId);

  const reader = new InMemoryDatasetDataReader(
    [makeEvent(version.id!, "600001.SH", "2024-01-02"), makeEvent(version.id!, "000001.SZ", "2024-01-02")],
    [makePath(version.id!, "600001.SH@2024-01-02", 1), makePath(version.id!, "600001.SH@2024-01-02", 2)],
    [makeOutcome(version.id!, "600001.SH@2024-01-02", 5), makeOutcome(version.id!, "600001.SH@2024-01-02", 10)],
  );
  const router = makeTestRouter({ repo, plugins, physicalStore, service, reader });
  const caller = router.createCaller({ req: {} as never, res: {} as never, user: null });
  return { def, version, caller, job: createdJob };
}

describe("DATASET-002.2 · router 注册守卫", () => {
  it("appRouter.datasetRegistry 已注册，且不破坏旧 researchDataset", () => {
    expect(appRouter).toHaveProperty("datasetRegistry");
    expect(appRouter).toHaveProperty("researchDataset");
    const procedures = Object.keys((appRouter as any)._def.procedures);
    for (const proc of [
      "datasetRegistry.listDefinitions",
      "datasetRegistry.getDefinition",
      "datasetRegistry.listVersions",
      "datasetRegistry.getVersion",
      "datasetRegistry.listJobs",
      "datasetRegistry.getJob",
      "datasetRegistry.getStatistics",
      "datasetRegistry.listEvents",
      "datasetRegistry.listPaths",
      "datasetRegistry.listOutcomes",
      // DATASET-002.4A/4B — 生命周期写端点
      "datasetRegistry.createDatasetVersion",
      "datasetRegistry.createBuildJob",
      "datasetRegistry.startBuildJob",
      "datasetRegistry.cancelBuildJob",
      "datasetRegistry.retryBuildJob",
    ]) {
      expect(procedures).toContain(proc);
    }
    // 旧链不受影响
    expect(procedures).toContain("researchDataset.build");
  });
});

describe("DATASET-002.2 · 入参校验（经 tRPC caller）", () => {
  it("listEvents：非法 datasetVersionId / limit 越界 / 非法 cursor / 日期区间倒置 均被拒", async () => {
    const { caller } = await buildFixture();
    await expect(caller.listEvents({ datasetVersionId: 0 } as never)).rejects.toThrow();
    await expect(caller.listEvents({ datasetVersionId: 1, limit: 9999 } as never)).rejects.toThrow();
    await expect(caller.listEvents({ datasetVersionId: 1, cursor: "garbage!" } as never)).rejects.toThrow();
    await expect(caller.listEvents({ datasetVersionId: 1, fromDate: "2024-02-01", toDate: "2024-01-01" } as never)).rejects.toThrow();
  });

  it("listPaths / listOutcomes：非法入参被拒", async () => {
    const { caller } = await buildFixture();
    await expect(caller.listPaths({ datasetVersionId: 1, eventId: "" } as never)).rejects.toThrow();
    await expect(caller.listOutcomes({ datasetVersionId: 1, horizon: 0 } as never)).rejects.toThrow();
  });
});

describe("DATASET-002.2 · Definition / Version / Job 端点", () => {
  it("listDefinitions / getDefinition", async () => {
    const { def, caller } = await buildFixture();
    const list = await caller.listDefinitions();
    expect(list).toHaveLength(1);
    expect(list[0]!.datasetCode).toBe("first_limit_pullback");
    expect(list[0]!.eventTableName).toBe("ds_first_limit_pullback_event");

    const detail = await caller.getDefinition({ definitionId: def.id! });
    expect(detail.id).toBe(def.id);
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]!.version).toBe("v2");
  });

  it("getDefinition：未命中返回 NOT_FOUND", async () => {
    const { caller } = await buildFixture();
    await expect(caller.getDefinition({ definitionId: 999 })).rejects.toThrow();
  });

  it("listVersions / getVersion / listJobs / getJob", async () => {
    const { def, version, caller, job } = await buildFixture();
    const versions = await caller.listVersions({ datasetId: def.id! });
    expect(versions).toHaveLength(1);
    expect(versions[0]!.status).toBe("READY");

    const detail = await caller.getVersion({ datasetVersionId: version.id! });
    expect(detail.version).toBe("v2");
    expect(detail.jobs).toHaveLength(1);

    const jobs = await caller.listJobs({ datasetVersionId: version.id! });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobId).toBe(job.jobId);

    const jobDetail = await caller.getJob({ jobId: job.jobId });
    expect(jobDetail.jobId).toBe(job.jobId);
    expect(jobDetail.status).toBe("RUNNING");
    expect(jobDetail.checkpointSummary).toBeNull(); // 无 lastCursor → null
    expect(jobDetail.progress).toBeNull(); // 无 totalChunks → progress null（不臆造）
  });

  it("getStatistics：声明 vs 实测统计正确", async () => {
    const { version, caller } = await buildFixture();
    const stats = await caller.getStatistics({ datasetVersionId: version.id! });
    expect(stats.version).toBe("v2");
    expect(stats.status).toBe("READY");
    expect(stats.declared.totalEvents).toBe(2);
    expect(stats.actual.eventCount).toBe(2);
    expect(stats.actual.pathCount).toBe(2);
    expect(stats.actual.outcomeCount).toBe(2);
    expect(stats.actual.rowCount).toBe(6);
    expect(stats.actual.firstDate).toBe("2024-01-02");
    expect(stats.actual.lastDate).toBe("2024-01-02");
    expect(stats.actual.horizons).toEqual([5, 10]);
  });
});

describe("DATASET-002.2 · Event / Path / Outcome keyset 端点", () => {
  it("listEvents：第一页 + 第二页不重不漏", async () => {
    const { version, caller } = await buildFixture();
    const page1 = await caller.listEvents({ datasetVersionId: version.id!, limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await caller.listEvents({ datasetVersionId: version.id!, cursor: page1.nextCursor!, limit: 1 });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const all = [...page1.items, ...page2.items].map((e) => e.eventId).sort();
    expect(all).toEqual(["000001.SZ@2024-01-02", "600001.SH@2024-01-02"]);
  });

  it("listPaths / listOutcomes：返回分页结构", async () => {
    const { version, caller } = await buildFixture();
    const paths = await caller.listPaths({ datasetVersionId: version.id!, limit: 10 });
    expect(paths.items).toHaveLength(2);
    expect(paths.nextCursor).toBeNull();

    const outcomes = await caller.listOutcomes({ datasetVersionId: version.id!, limit: 10 });
    expect(outcomes.items).toHaveLength(2);
  });
});

describe("DATASET-002.2 · update / archive admin 端点", () => {
  it("updateDefinition / archiveDefinition 需要 admin 权限", async () => {
    const { repo, plugins, physicalStore, service } = makeTestService();
    await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const def = await repo.getDefinitionByCode("first_limit_pullback");

    const router = makeTestRouter({ repo, plugins, physicalStore, service });
    const admin = { id: 1, openId: "t", name: "t", email: null, loginMethod: null, role: "admin" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
    const adminCaller = router.createCaller({ req: {} as never, res: {} as never, user: admin });

    const updated = await adminCaller.updateDefinition({ definitionId: def!.id!, name: "改名" });
    expect(updated.name).toBe("改名");

    const archived = await adminCaller.archiveDefinition({ definitionId: def!.id! });
    expect(archived.status).toBe("ARCHIVED");

    // 非 admin 调用被拒
    const nonAdminCaller = router.createCaller({ req: {} as never, res: {} as never, user: { ...admin, role: "user" as const } });
    await expect(nonAdminCaller.archiveDefinition({ definitionId: def!.id! })).rejects.toThrow();
  });
});

describe("DATASET-002.4A · Build Lifecycle mutation 端点", () => {
  async function buildLifecycleFixture() {
    const { repo, plugins, physicalStore, service } = makeTestService();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const version = await service.createVersion({ datasetId: def.id!, version: "v1", startDate: null, endDate: null });
    const router = makeTestRouter({ repo, plugins, physicalStore, service });
    const caller = router.createCaller({ req: {} as never, res: {} as never, user: adminUser });
    return { version, caller };
  }

  it("createBuildJob → startBuildJob → cancelBuildJob 全链路（PENDING→RUNNING→CANCELLED）", async () => {
    const { version, caller } = await buildLifecycleFixture();
    const created = await caller.createBuildJob({ datasetVersionId: version.id! });
    expect(created.status).toBe("PENDING");
    expect(created.jobId).toBeTruthy();

    const started = await caller.startBuildJob({ jobId: created.jobId });
    expect(started.status).toBe("RUNNING");

    const cancelled = await caller.cancelBuildJob({ jobId: created.jobId });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("cancelBuildJob：取消即回滚（返回真实清理结果），重复取消幂等不报错", async () => {
    const { version, caller } = await buildLifecycleFixture();
    const created = await caller.createBuildJob({ datasetVersionId: version.id! });
    await caller.startBuildJob({ jobId: created.jobId });

    const first = await caller.cancelBuildJob({ jobId: created.jobId });
    expect(first.status).toBe("CANCELLED");
    expect(first.rollback).not.toBeNull();
    expect(first.rollback!.purgedRows).toBe(0); // 该 fixture 从未落库数据
    expect(first.rollback!.tables).toHaveLength(5);
    expect(first.rollbackSkippedReason).toBeNull();

    // 幂等：作业已 CANCELLED 时再次取消 → 只补做回滚，不抛 INVALID_JOB_TRANSITION
    const again = await caller.cancelBuildJob({ jobId: created.jobId });
    expect(again.status).toBe("CANCELLED");
    expect(again.alreadyCancelled).toBe(true);
  });

  it("retryBuildJob：CANCELLED → 新 PENDING（历史保留）", async () => {
    const { version, caller } = await buildLifecycleFixture();
    const created = await caller.createBuildJob({ datasetVersionId: version.id! });
    await caller.startBuildJob({ jobId: created.jobId });
    await caller.cancelBuildJob({ jobId: created.jobId });
    const retried = await caller.retryBuildJob({ jobId: created.jobId });
    expect(retried.status).toBe("PENDING");
    expect(retried.jobId).not.toBe(created.jobId);
  });

  it("非法输入被 schema 拒绝（datasetVersionId=0 / 空 jobId）", async () => {
    const { caller } = await buildLifecycleFixture();
    await expect(caller.createBuildJob({ datasetVersionId: 0 } as never)).rejects.toThrow();
    await expect(caller.startBuildJob({ jobId: "" } as never)).rejects.toThrow();
    await expect(caller.cancelBuildJob({ jobId: "" } as never)).rejects.toThrow();
    await expect(caller.retryBuildJob({ jobId: "" } as never)).rejects.toThrow();
  });

  it("稳定错误码：不存在的版本 → NOT_FOUND；重复 start → CONFLICT", async () => {
    const { version, caller } = await buildLifecycleFixture();
    // 不存在版本
    await expect(caller.createBuildJob({ datasetVersionId: 999999 })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const created = await caller.createBuildJob({ datasetVersionId: version.id! });
    await caller.startBuildJob({ jobId: created.jobId });
    // 重复 start → 状态冲突
    await expect(caller.startBuildJob({ jobId: created.jobId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("非 admin 调用被拒（FORBIDDEN）", async () => {
    const { repo, plugins, physicalStore, service } = makeTestService();
    await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const router = makeTestRouter({ repo, plugins, physicalStore, service });
    const nonAdminCaller = router.createCaller({ req: {} as never, res: {} as never, user: { ...adminUser, role: "user" as const } });
    await expect(nonAdminCaller.createBuildJob({ datasetVersionId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("DATASET-002.4B · createDatasetVersion（构建新版本入口）", () => {
  async function buildCreateFixture() {
    const { repo, plugins, physicalStore, service } = makeTestService();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const router = makeTestRouter({ repo, plugins, physicalStore, service });
    const caller = router.createCaller({ req: {} as never, res: {} as never, user: adminUser });
    return { def, caller };
  }

  it("创建版本（DRAFT）+ 固化筛选配置", async () => {
    const { def, caller } = await buildCreateFixture();
    const v = await caller.createDatasetVersion({
      datasetId: def.id!,
      version: "v1",
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      filter: makeTestFilter({
        boards: ["main"],
        excludeSt: true,
        events: [{ relativeDay: -1, kind: "firstBoard" }],
        preWindowDays: 5,
        postWindowDays: 30,
        outcomeHorizons: [5, 10],
        batchSize: 500,
      }),
    });
    expect(v.status).toBe("DRAFT");
    expect(v.version).toBe("v1");
    expect(v.startDate).toBe("2024-01-01");

    // 通过端点回读已固化的筛选配置（版本详情 / 专用端点两条路径都应一致）
    const cfg = await caller.getBuildConfig({ datasetVersionId: v.id });
    expect(cfg).not.toBeNull();
    expect(cfg!.boards).toEqual(["main"]);
    expect(cfg!.excludeSt).toBe(true);
    expect(cfg!.events).toEqual([{ relativeDay: -1, kind: "firstBoard" }]);
    expect(cfg!.preWindowDays).toBe(5);
    expect(cfg!.postWindowDays).toBe(30);
    expect(cfg!.outcomeHorizons).toEqual([5, 10]);
    expect(cfg!.batchSize).toBe(500);

    const detail = await caller.getVersion({ datasetVersionId: v.id });
    expect(detail.buildConfig?.postWindowDays).toBe(30);
    expect(detail.buildConfig?.events).toEqual([{ relativeDay: -1, kind: "firstBoard" }]);

    // 解析出的执行配置与固化配置一致
    const resolved = await caller.resolveBuildConfig({ datasetVersionId: v.id });
    expect(resolved.boards).toEqual(["main"]);
    expect(resolved.excludeSt).toBe(true);
    expect(resolved.preWindowDays).toBe(5);
    expect(resolved.postWindowDays).toBe(30);
  });

  it("非法输入被 schema 拒绝（无日期 / 区间倒置 / 空 version / 视界越界）", async () => {
    const { def, caller } = await buildCreateFixture();
    await expect(
      caller.createDatasetVersion({ datasetId: def.id!, version: "v1", startDate: "", endDate: "2024-12-31", filter: makeTestFilter() } as never),
    ).rejects.toThrow();
    await expect(
      caller.createDatasetVersion({ datasetId: def.id!, version: "v1", startDate: "2024-12-31", endDate: "2024-01-01", filter: makeTestFilter() } as never),
    ).rejects.toThrow();
    await expect(
      caller.createDatasetVersion({ datasetId: def.id!, version: "", startDate: "2024-01-01", endDate: "2024-12-31", filter: makeTestFilter() } as never),
    ).rejects.toThrow();
    await expect(
      caller.createDatasetVersion({
        datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31",
        filter: makeTestFilter({ outcomeHorizons: [999] }),
      } as never),
    ).rejects.toThrow();
    await expect(
      caller.createDatasetVersion({
        datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31",
        filter: makeTestFilter({ postWindowDays: 0 }),
      } as never),
    ).rejects.toThrow();
  });

  it("未完成筛选配置（filter 缺失 / events 为空）→ schema 拒绝（构建门禁）", async () => {
    const { def, caller } = await buildCreateFixture();
    await expect(
      caller.createDatasetVersion({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31" } as never),
    ).rejects.toThrow();
    await expect(
      caller.createDatasetVersion({
        datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31",
        filter: makeTestFilter({ events: [] }),
      } as never),
    ).rejects.toThrow();
  });

  it("非法版本标签 → BAD_REQUEST（不走 service 也应被 schema 拦截）", async () => {
    const { def, caller } = await buildCreateFixture();
    await expect(
      caller.createDatasetVersion({ datasetId: def.id!, version: "v 1", startDate: "2024-01-01", endDate: "2024-12-31", filter: makeTestFilter() }),
    ).rejects.toThrow();
  });

  it("重复版本 → CONFLICT；不存在定义 → NOT_FOUND", async () => {
    const { def, caller } = await buildCreateFixture();
    await caller.createDatasetVersion({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31", filter: makeTestFilter() });
    await expect(
      caller.createDatasetVersion({ datasetId: def.id!, version: "v1", startDate: "2024-02-01", endDate: "2024-02-29", filter: makeTestFilter() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller.createDatasetVersion({ datasetId: 999999, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31", filter: makeTestFilter() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("非 admin 调用被拒（FORBIDDEN）", async () => {
    const { repo, plugins, physicalStore, service } = makeTestService();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const router = makeTestRouter({ repo, plugins, physicalStore, service });
    const nonAdminCaller = router.createCaller({ req: {} as never, res: {} as never, user: { ...adminUser, role: "user" as const } });
    await expect(
      nonAdminCaller.createDatasetVersion({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-12-31", filter: makeTestFilter() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("DATASET-003A · 多数据集管理与删除端点", () => {
  async function buildManageFixture() {
    const bundle = makeTestService();
    const { repo, plugins, physicalStore, service } = bundle;
    const router = makeTestRouter({ repo, plugins, physicalStore, service });
    const caller = router.createCaller({ req: {} as never, res: {} as never, user: adminUser });
    return { ...bundle, router, caller };
  }

  it("listDatasetPlugins：返回已注册插件与其物理表", async () => {
    const { caller } = await buildManageFixture();
    const result = await caller.listDatasetPlugins();
    expect(result.plugins.map((p) => p.datasetCode)).toEqual(["first_limit_pullback"]);
    const plugin = result.plugins[0]!;
    expect(plugin.physicalTables.map((t) => t.role)).toEqual(["event", "prefix", "post", "path", "outcome"]);
    expect(plugin.physicalTables[0]!.tableName).toBe("ds_first_limit_pullback_event");
  });

  it("createDatasetDefinition：未注册插件的 code → buildable=false（不建表）", async () => {
    const { caller, physicalStore } = await buildManageFixture();
    const def = await caller.createDatasetDefinition({
      datasetCode: "breakout",
      name: "突破",
      datasetType: "EVENT",
    });
    expect(def.datasetCode).toBe("breakout");
    expect(def.buildable).toBe(false); // breakout 未注册插件（fixture 只注册 first_limit_pullback）
    expect(physicalStore.hasTable("ds_breakout_event")).toBe(false);
  });

  it("createDatasetDefinition：已注册的 code → buildable=true 且建表", async () => {
    const { caller, physicalStore } = await buildManageFixture();
    const def = await caller.createDatasetDefinition({
      datasetCode: "first_limit_pullback",
      name: "首板回踩",
      datasetType: "EVENT",
    });
    expect(def.buildable).toBe(true);
    expect(physicalStore.hasTable("ds_first_limit_pullback_event")).toBe(true);
  });

  it("createDatasetDefinition：非法 code / 重复 code / 非 admin 被拒", async () => {
    const { caller, router } = await buildManageFixture();
    // 非法 code（带版本后缀）
    await expect(
      caller.createDatasetDefinition({ datasetCode: "first_limit_pullback_v1", name: "x", datasetType: "EVENT" }),
    ).rejects.toThrow();
    // 合法创建一次
    await caller.createDatasetDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    // 重复 → 报错（service 抛普通 Error → INTERNAL_SERVER_ERROR 语义，但必须 reject）
    await expect(
      caller.createDatasetDefinition({ datasetCode: "first_limit_pullback", name: "dup", datasetType: "EVENT" }),
    ).rejects.toThrow();
    // 非 admin
    const nonAdminCaller = router.createCaller({ req: {} as never, res: {} as never, user: { ...adminUser, role: "user" as const } });
    await expect(
      nonAdminCaller.createDatasetDefinition({ datasetCode: "breakout", name: "突破", datasetType: "EVENT" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deleteDatasetVersion：删数据（表结构保留）+ 删作业；RUNNING 时 CONFLICT", async () => {
    const { caller, service, physicalStore, repo } = await buildManageFixture();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v1 = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    const v2 = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v2", startDate: "2024-02-01", endDate: "2024-02-29", filter: makeTestFilter() });
    physicalStore.seedRows(def, v1.id!, 42);

    const result = await caller.deleteDatasetVersion({ datasetVersionId: v1.id! });
    expect(result.purgedRows).toBe(210); // 5 表 × 42
    expect(await repo.getVersionById(v1.id!)).toBeUndefined();
    expect(await repo.getVersionById(v2.id!)).toBeDefined();
    expect(physicalStore.hasTable("ds_first_limit_pullback_event")).toBe(true); // 表结构保留

    // RUNNING 作业 → CONFLICT
    const job = await service.createJob(v2.id!);
    await service.startJob(job.jobId);
    await expect(caller.deleteDatasetVersion({ datasetVersionId: v2.id! })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("deleteDatasetVersion：不存在 → NOT_FOUND", async () => {
    const { caller } = await buildManageFixture();
    await expect(caller.deleteDatasetVersion({ datasetVersionId: 999999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deleteDatasetDefinition：confirmDatasetCode 不匹配 → BAD_REQUEST（防误删）", async () => {
    const { caller, service } = await buildManageFixture();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    await expect(
      caller.deleteDatasetDefinition({ definitionId: def.id!, confirmDatasetCode: "wrong_code" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deleteDatasetDefinition：级联删版本 + DROP 表 + 删定义", async () => {
    const { caller, service, physicalStore, repo } = await buildManageFixture();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v1 = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    physicalStore.seedRows(def, v1.id!, 3);

    const result = await caller.deleteDatasetDefinition({ definitionId: def.id!, confirmDatasetCode: "first_limit_pullback" });
    expect(result.datasetCode).toBe("first_limit_pullback");
    expect(result.versionsDeleted).toBe(1);
    expect(result.purgedRows).toBe(15);
    expect(result.droppedTables.every((t) => t.dropped)).toBe(true);
    expect(physicalStore.listTables()).toEqual([]); // 表结构随数据集删除
    expect(await repo.getDefinitionById(def.id!)).toBeUndefined();
  });

  it("deleteDatasetDefinition：RUNNING 作业 → CONFLICT；不存在 → NOT_FOUND", async () => {
    const { caller, service } = await buildManageFixture();
    const def = await service.createDefinition({ datasetCode: "first_limit_pullback", name: "首板回踩", datasetType: "EVENT" });
    const v = await service.createVersionWithBuildConfig({ datasetId: def.id!, version: "v1", startDate: "2024-01-01", endDate: "2024-01-31", filter: makeTestFilter() });
    const job = await service.createJob(v.id!);
    await service.startJob(job.jobId);
    await expect(
      caller.deleteDatasetDefinition({ definitionId: def.id!, confirmDatasetCode: "first_limit_pullback" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      caller.deleteDatasetDefinition({ definitionId: 999999, confirmDatasetCode: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
