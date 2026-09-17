/**
 * RESEARCH-ORPHAN-RECLAIM-001 —— 孤儿回收判据单测（**纯逻辑，零 DB**）。
 *
 * 本文件锁住的核心判据（最容易改错的几条）：
 *   ① 父 Run 已终态 **且过了缓冲期** ⇒ 子 Analysis 收敛为 CANCELLED（真孤儿）；
 *   ② 父 Run 刚终态（缓冲期内）⇒ **不收敛**（让位给「用户正要重跑」）；
 *   ③ 🔴 父 Run `PENDING` 且**从未执行** ⇒ **保留**（待执行草稿，不是在途 Run）；
 *   ④ 父 Run `RUNNING` 未超阈值 ⇒ **不动**（可能真在跑）；
 *   ⑤ 父 Run `RUNNING` 超阈值 ⇒ Run 收敛 FAILED/RUN_ORPHANED + 子 Analysis 收敛 + Experiment 回滚；
 *   ⑥ 幂等：连跑两次，第二次零写入；
 *   ⑦ 阈值全关 ⇒ 整体跳过（零写入）。
 *
 * ⚠️ 本测试**不覆盖**「父 Run 无任何时间基准 ⇒ 跳过」。原因：内存仓储的 `create` 恒会盖
 * `createdAt` 时间戳，构造不出「三项皆空」的行；该分支由真实库场景守护（见实施报告）。
 */
import { describe, expect, it } from "vitest";
import { createInMemoryResearchRepositories } from "../../../server/researchCore/repository/inMemory";
import type { ResearchRepositories } from "../../../server/researchCore/repository/contract";
import type { ResearchExperiment, ResearchRun } from "../../../server/researchCore/types";
import {
  DEFAULT_ORPHAN_GRACE_MINUTES,
  DEFAULT_STALE_RUNNING_MINUTES,
  reclaimOrphanResearchWork,
} from "../../../server/researchEngine/reclaim";

const DATASET_VERSION_ID = 42;
/** 注入时钟：2026-09-17T04:00:00Z。 */
const NOW = new Date("2026-09-17T04:00:00.000Z");

function makeRepos(): ResearchRepositories {
  return createInMemoryResearchRepositories({
    datasetVersionExists: async (id: number) => id === DATASET_VERSION_ID,
    now: () => NOW,
  });
}

interface SeedOptions {
  runStatus: ResearchRun["status"];
  startedAt?: string | null;
  completedAt?: string | null;
  inputSnapshot?: unknown;
  experimentStatus?: ResearchExperiment["status"];
}

/** 造「1 个 Experiment + 1 条 Run + 1 条子 Analysis」的最小夹具。 */
async function seed(repos: ResearchRepositories, options: SeedOptions) {
  const experiment = await repos.experiments.create({
    datasetVersionId: DATASET_VERSION_ID,
    name: "orphan-fixture",
    researchType: "CUSTOM",
    status: options.experimentStatus ?? "DRAFT",
  });
  const run = await repos.runs.create({
    experimentId: experiment.id!,
    runNo: 1,
    status: options.runStatus,
    inputSnapshot: options.inputSnapshot,
    startedAt: options.startedAt ?? null,
    completedAt: options.completedAt ?? null,
  });
  const analysis = await repos.analyses.create({
    runId: run.id!,
    analysisType: "DESCRIPTIVE",
    name: "child",
  });
  return { experiment, run, analysis };
}

describe("reclaimOrphanResearchWork —— 研究链孤儿回收", () => {
  it("默认阈值：父 Run 终态缓冲 30 分钟 / RUNNING 停更 12 小时", () => {
    expect(DEFAULT_ORPHAN_GRACE_MINUTES).toBe(30);
    expect(DEFAULT_STALE_RUNNING_MINUTES).toBe(720);
  });

  it("① 父 Run 已终态且过缓冲期 ⇒ 子 Analysis 收敛为 CANCELLED（Run 本身不再改写）", async () => {
    const repos = makeRepos();
    const { run, analysis } = await seed(repos, {
      runStatus: "FAILED",
      completedAt: "2026-09-01T00:00:00.000Z", // 16 天前，远超 30 分钟缓冲
    });

    const result = await reclaimOrphanResearchWork(repos, { now: NOW });

    expect(result.reclaimedRuns).toEqual([]);
    expect(result.reclaimedAnalyses).toEqual([
      {
        analysisId: analysis.id,
        runId: run.id,
        previousStatus: "PENDING",
        reason: "run-terminal",
      },
    ]);
    expect((await repos.analyses.getById(analysis.id!))?.status).toBe("CANCELLED");
    expect((await repos.analyses.getById(analysis.id!))?.completedAt).toBe(NOW.toISOString());
    // 已终态的 Run 不该被回收器再次改写（它不是孤儿 Run）。
    expect((await repos.runs.getById(run.id!))?.status).toBe("FAILED");
  });

  it("② 父 Run 刚终态（缓冲期内）⇒ 不收敛，让位给「用户正要重跑」", async () => {
    const repos = makeRepos();
    const { analysis } = await seed(repos, {
      runStatus: "FAILED",
      completedAt: new Date(NOW.getTime() - 60_000).toISOString(), // 1 分钟前
    });

    const result = await reclaimOrphanResearchWork(repos, { now: NOW });

    expect(result.reclaimedAnalyses).toEqual([]);
    expect((await repos.analyses.getById(analysis.id!))?.status).toBe("PENDING");
  });

  it("③ 🔴 父 Run PENDING 且从未执行 ⇒ 保留（待执行草稿），并如实回报", async () => {
    const repos = makeRepos();
    const { run, analysis } = await seed(repos, {
      runStatus: "PENDING",
      inputSnapshot: null,
      startedAt: null,
    });

    const result = await reclaimOrphanResearchWork(repos, { now: NOW });

    expect(result.reclaimedRuns).toEqual([]);
    expect(result.reclaimedAnalyses).toEqual([]);
    expect(result.skippedUnexecutedRuns).toHaveLength(1);
    expect(result.skippedUnexecutedRuns[0]!.runId).toBe(run.id);
    expect(result.skippedUnexecutedRuns[0]!.experimentId).toBe(run.experimentId);
    // 草案与分析都必须原样保留 —— 这是本测试最重要的一条断言。
    expect((await repos.runs.getById(run.id!))?.status).toBe("PENDING");
    expect((await repos.analyses.getById(analysis.id!))?.status).toBe("PENDING");
  });

  it("④ 父 Run RUNNING 但未超阈值 ⇒ 不动（可能真在跑）", async () => {
    const repos = makeRepos();
    const { run, analysis } = await seed(repos, {
      runStatus: "RUNNING",
      startedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), // 5 分钟前
      inputSnapshot: { datasetVersionId: DATASET_VERSION_ID },
      experimentStatus: "RUNNING",
    });

    const result = await reclaimOrphanResearchWork(repos, { now: NOW });

    expect(result.reclaimedRuns).toEqual([]);
    expect(result.reclaimedAnalyses).toEqual([]);
    expect((await repos.runs.getById(run.id!))?.status).toBe("RUNNING");
    expect((await repos.analyses.getById(analysis.id!))?.status).toBe("PENDING");
  });

  it("⑤ 父 Run RUNNING 超阈值 ⇒ 收敛 Run（FAILED / RUN_ORPHANED）+ 子分析 + Experiment 回滚", async () => {
    const repos = makeRepos();
    const { experiment, run, analysis } = await seed(repos, {
      runStatus: "RUNNING",
      startedAt: "2026-09-16T00:00:00.000Z", // 28 小时前 > 12 小时
      inputSnapshot: { datasetVersionId: DATASET_VERSION_ID },
      experimentStatus: "RUNNING",
    });

    const result = await reclaimOrphanResearchWork(repos, { now: NOW });

    expect(result.reclaimedRuns).toEqual([
      { runId: run.id, experimentId: experiment.id, staleMinutes: 1680, analysisCount: 1 },
    ]);
    const settledRun = await repos.runs.getById(run.id!);
    expect(settledRun?.status).toBe("FAILED");
    expect(settledRun?.errorCode).toBe("RUN_ORPHANED");
    expect(settledRun?.errorMessage).toContain("1680 分钟");
    expect((await repos.analyses.getById(analysis.id!))?.status).toBe("CANCELLED");
    // Experiment 卡 RUNNING 是同类死锁（与 Dataset 侧「卡 BUILDING」同构）⇒ 必须回滚。
    expect((await repos.experiments.getById(experiment.id!))?.status).toBe("FAILED");
  });

  it("⑥ 幂等：连跑两次，第二次零写入", async () => {
    const repos = makeRepos();
    await seed(repos, { runStatus: "FAILED", completedAt: "2026-09-01T00:00:00.000Z" });

    const first = await reclaimOrphanResearchWork(repos, { now: NOW });
    expect(first.reclaimedAnalyses).toHaveLength(1);

    const second = await reclaimOrphanResearchWork(repos, { now: NOW });
    expect(second.reclaimedRuns).toEqual([]);
    expect(second.reclaimedAnalyses).toEqual([]);
    expect(second.skippedUnexecutedRuns).toEqual([]);
  });

  it("⑦ 阈值全关 ⇒ 整体跳过（即使存在真孤儿也不写）", async () => {
    const repos = makeRepos();
    const { run, analysis } = await seed(repos, {
      runStatus: "FAILED",
      completedAt: "2026-09-01T00:00:00.000Z",
    });

    const result = await reclaimOrphanResearchWork(repos, {
      now: NOW,
      graceMinutes: 0,
      staleRunningMinutes: 0,
    });

    expect(result).toEqual({ reclaimedRuns: [], reclaimedAnalyses: [], skippedUnexecutedRuns: [] });
    expect((await repos.runs.getById(run.id!))?.status).toBe("FAILED");
    expect((await repos.analyses.getById(analysis.id!))?.status).toBe("PENDING");
  });
});
