/**
 * RESEARCH-002 — ResearchEngine 增量补跑测试（合成 Dataset，真实执行链路）。
 *
 * 增量补跑的定义：在**已整轮执行过**的 Run 上，只补算「尚无有效结果」的分析
 * （PENDING / FAILED / CANCELLED），**不重跑已完成的**。
 *
 * 本文件锁住的六条不变量（任何一条被改坏都会让「补跑」变成不实）：
 *   1. **复用 Run 冻结的基准** —— Dataset Version + 日期窗口取自 `inputSnapshot`，
 *      不是 Experiment / Run 的当前配置（否则补跑出的数字与原批次不可比）；
 *   2. **不覆盖已完成分析的产物** —— 结果行与 completedAt 原样保留；
 *   3. **显式记账** —— 每批追加 `run.executionLog`，批次号递增不跳号、不覆盖；
 *   4. **不生成结论** —— 返回 conclusionId=null + 确切原因，既有结论原样保留；
 *   5. **拒绝非法目标** —— 已 COMPLETED / 不属于该 Run / Run 正在 RUNNING / 无基准快照；
 *   6. **失败仍可追溯** —— Run 落 FAILED + errorCode，批次日志收敛为 FAILED（不留 RUNNING 悬挂），
 *      且此前批次的结果保留；FAILED 的分析可再次补跑。
 */

import { describe, expect, it } from "vitest";
import { createInMemoryResearchRepositories, type ResearchRepositories } from "../researchCore";
import { ResearchEngine } from "./engine";
import { buildSyntheticDataset, linearEvents, type SyntheticDataset } from "./testFixtures";
import type { AnalysisExecutorRegistry } from "./analyses/registry";

const DATASET_VERSION_ID = 900001;

function makeRepos(): ResearchRepositories {
  return createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === DATASET_VERSION_ID,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });
}

function makeDataset(): SyntheticDataset {
  return buildSyntheticDataset({ events: linearEvents(20), horizons: [5], maxPathDay: 5 });
}

interface SeedSpec {
  analysisType: string;
  name?: string;
  config: unknown;
}

async function seed(repos: ResearchRepositories, analyses: SeedSpec[]) {
  const experiment = await repos.experiments.create({
    datasetVersionId: DATASET_VERSION_ID,
    name: "首板换手率与未来5日收益",
    researchType: "QUANTILE",
  });
  const run = await repos.runs.create({ experimentId: experiment.id!, runNo: 1 });
  const created = [];
  for (const a of analyses) created.push(await addAnalysis(repos, run.id!, a));
  return { experiment, run, analyses: created };
}

async function addAnalysis(repos: ResearchRepositories, runId: number, spec: SeedSpec) {
  return repos.analyses.create({
    runId,
    analysisType: spec.analysisType as never,
    name: spec.name ?? spec.analysisType,
    config: spec.config,
  });
}

function engineFor(ds: SyntheticDataset, repos: ResearchRepositories) {
  return new ResearchEngine({ repos, reader: ds.reader, eventPageSize: 7 });
}

/** 故意让 execute 抛错的注册表（用于验证失败路径）。 */
function failingRegistry(): AnalysisExecutorRegistry {
  return {
    require: () => ({
      analysisType: "DESCRIPTIVE",
      requiredVariables: () => ({ features: ["turnover"], outcomes: [] }),
      execute: async () => {
        throw new Error("补跑时执行器炸了");
      },
    }),
    has: () => true,
    listTypes: () => ["DESCRIPTIVE"],
    list: () => [],
    register: () => undefined,
  } as never;
}

const QUANTILE = {
  analysisType: "QUANTILE",
  name: "分位分析",
  config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10, minSampleCount: 1 },
};
const EVENT_STUDY = {
  analysisType: "EVENT_STUDY",
  name: "事件研究",
  config: { horizons: [5], minSampleCount: 1 },
};

describe("ResearchEngine.runIncremental — 正常补跑", () => {
  it("补跑新分析：新分析产出结果，旧分析的结果与完成时间**原样保留**", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run, analyses } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    const oldId = analyses[0]!.id!;
    const oldResultsBefore = await repos.results.list({ analysisId: oldId });
    const oldCompletedBefore = (await repos.analyses.getById(oldId))!.completedAt;
    expect(oldResultsBefore.length).toBeGreaterThan(0);

    // 整轮执行后新增一个分析（PENDING）
    const added = await addAnalysis(repos, run.id!, EVENT_STUDY);

    const result = await engineFor(ds, repos).runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
      analysisIds: [added.id!],
    });

    expect(result.analysisCount).toBe(1);
    expect(result.resultCount).toBeGreaterThan(0);
    expect((await repos.analyses.getById(added.id!))!.status).toBe("COMPLETED");
    expect((await repos.results.list({ analysisId: added.id! })).length).toBe(result.resultCount);

    // 旧分析的产物未被触碰（不可覆盖）
    const oldResultsAfter = await repos.results.list({ analysisId: oldId });
    expect(oldResultsAfter.map((r) => r.id)).toEqual(oldResultsBefore.map((r) => r.id));
    expect((await repos.analyses.getById(oldId))!.completedAt).toBe(oldCompletedBefore);

    // 全部完成后 Run 回到 COMPLETED
    expect((await repos.runs.getById(run.id!))!.status).toBe("COMPLETED");
    expect((await repos.experiments.getById(experiment.id!))!.status).toBe("COMPLETED");
  });

  it("🔴 补跑时的 RUNNING 转换必须清掉上一轮的失败残留（否则 errorCode 会「粘住」）", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    // 模拟「上一轮失败」残留（真实场景见 2026-09-11 实查）
    await repos.runs.update(run.id!, {
      status: "FAILED",
      completedAt: "2026-09-10T00:00:01.000Z",
      errorCode: "INTERNAL_ERROR",
      errorMessage: "上一轮失败：Failed query: select MIN(relativeDay) …",
    });

    const captured: Array<Record<string, unknown>> = [];
    const originalUpdate = repos.runs.update.bind(repos.runs);
    repos.runs.update = async (id, patch) => {
      captured.push(patch as Record<string, unknown>);
      return originalUpdate(id, patch);
    };

    const added = await addAnalysis(repos, run.id!, EVENT_STUDY);
    await engineFor(ds, repos).runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
      analysisIds: [added.id!],
    });

    const runningPatch = captured.find((p) => p.status === "RUNNING");
    expect(runningPatch).toBeDefined();
    expect(runningPatch!.completedAt).toBeNull();
    expect(runningPatch!.errorCode).toBeNull();
    expect(runningPatch!.errorMessage).toBeNull();

    const afterRun = await repos.runs.getById(run.id!);
    expect(afterRun!.status).toBe("COMPLETED");
    expect(afterRun!.errorCode).toBeNull();
  });

  it("🔴 复用 Run 冻结的基准：整轮后改 Run 配置的日期窗口，补跑仍按快照窗口装配", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run, analyses } = await seed(repos, [QUANTILE]);
    const full = await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    // 事后把 Run 配置的日期窗口改到一个**不可能有事件**的区间。
    // 若补跑错误地读「当前配置」，会装配出 0 个样本 → EMPTY_SAMPLE_SET。
    await repos.runs.update(run.id!, {
      config: { dateRange: { startDate: "2099-01-01", endDate: "2099-12-31" } },
    });

    const added = await addAnalysis(repos, run.id!, EVENT_STUDY);
    const inc = await engineFor(ds, repos).runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
      analysisIds: [added.id!],
    });

    expect(inc.basisSource).toBe("run-snapshot");
    expect(inc.sampleCount).toBe(full.sampleCount); // 与原批次同一基准
    expect(inc.datasetVersionId).toBe(full.datasetVersionId);
    expect(analyses[0]!.id).toBeDefined();
  });

  it("省略 analysisIds → 自动补跑全部「尚无有效结果」的分析", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run } = await seed(repos, [
      { analysisType: "DESCRIPTIVE", name: "已完成", config: { variables: ["turnover"], minSampleCount: 1 } },
    ]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    const a2 = await addAnalysis(repos, run.id!, EVENT_STUDY);
    const a3 = await addAnalysis(repos, run.id!, {
      analysisType: "DESCRIPTIVE",
      name: "描述统计",
      config: { variables: ["turnover", "future_return_5d"], minSampleCount: 1 },
    });

    const inc = await engineFor(ds, repos).runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
    });
    expect(inc.analysisCount).toBe(2);
    expect(inc.analyses.map((a) => a.analysisId).sort()).toEqual([a2.id!, a3.id!].sort());
  });
});

describe("ResearchEngine.runIncremental — 执行批次日志", () => {
  it("整轮写 batch 1（FULL），补跑写 batch 2（INCREMENTAL），样本数与批次号都对得上", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run } = await seed(repos, [QUANTILE]);
    const full = await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    let log = (await repos.runs.getById(run.id!))!.executionLog!;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ sequence: 1, mode: "FULL", status: "COMPLETED", sampleCount: full.sampleCount });
    expect(log[0]!.completedAt).not.toBeNull();
    expect(log[0]!.conclusionSkippedReason).toBeUndefined();

    const added = await addAnalysis(repos, run.id!, EVENT_STUDY);
    const inc = await engineFor(ds, repos).runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
      analysisIds: [added.id!],
    });

    log = (await repos.runs.getById(run.id!))!.executionLog!;
    expect(log).toHaveLength(2); // 追加，不覆盖
    expect(log[1]).toMatchObject({
      sequence: 2,
      mode: "INCREMENTAL",
      analysisIds: [added.id!],
      status: "COMPLETED",
      sampleCount: full.sampleCount,
    });
    expect(log[1]!.conclusionSkippedReason).toBe(inc.conclusionSkippedReason);
    // batch 1 仍是原样
    expect(log[0]!.mode).toBe("FULL");
  });

  it("快照不可变：补跑不修改 inputSnapshot（只追加执行日志）", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });
    const snapBefore = JSON.stringify((await repos.runs.getById(run.id!))!.inputSnapshot);

    const added = await addAnalysis(repos, run.id!, EVENT_STUDY);
    await engineFor(ds, repos).runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
      analysisIds: [added.id!],
    });

    expect(JSON.stringify((await repos.runs.getById(run.id!))!.inputSnapshot)).toBe(snapBefore);
  });
});

describe("ResearchEngine.runIncremental — 结论", () => {
  it("补跑不生成结论，也不动既有结论（只用部分分析的摘要拼不出完整结论）", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });
    const conclusionsBefore = await repos.conclusions.list({ experimentId: experiment.id! });
    expect(conclusionsBefore).toHaveLength(1);

    const added = await addAnalysis(repos, run.id!, EVENT_STUDY);
    const inc = await engineFor(ds, repos).runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
      analysisIds: [added.id!],
    });

    expect(inc.conclusionId).toBeNull();
    expect(inc.conclusionSkippedReason).toContain("INCREMENTAL_EXECUTION");
    const conclusionsAfter = await repos.conclusions.list({ experimentId: experiment.id! });
    expect(conclusionsAfter.map((c) => c.id)).toEqual(conclusionsBefore.map((c) => c.id));
  });
});

describe("ResearchEngine.runIncremental — 拒绝非法目标", () => {
  it("已 COMPLETED 的分析 → ANALYSIS_NOT_RUNNABLE（不覆盖）", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run, analyses } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    await expect(
      engineFor(ds, repos).runIncremental({
        experimentId: experiment.id!,
        runId: run.id!,
        analysisIds: [analyses[0]!.id!],
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_NOT_RUNNABLE" });
  });

  it("全部已完成且未指定 id → NO_RUNNABLE_ANALYSES", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    await expect(
      engineFor(ds, repos).runIncremental({ experimentId: experiment.id!, runId: run.id! }),
    ).rejects.toMatchObject({ code: "NO_RUNNABLE_ANALYSES" });
  });

  it("分析不属于该 Run → ANALYSIS_NOT_IN_RUN", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    const other = await repos.runs.create({ experimentId: experiment.id!, runNo: 2 });
    const foreign = await addAnalysis(repos, other.id!, EVENT_STUDY);

    await expect(
      engineFor(ds, repos).runIncremental({
        experimentId: experiment.id!,
        runId: run.id!,
        analysisIds: [foreign.id!],
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_NOT_IN_RUN" });
  });

  it("Run 正在 RUNNING → RUN_ALREADY_RUNNING", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run, analyses } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });
    await repos.runs.update(run.id!, { status: "RUNNING" });

    await expect(
      engineFor(ds, repos).runIncremental({
        experimentId: experiment.id!,
        runId: run.id!,
        analysisIds: [analyses[0]!.id!],
      }),
    ).rejects.toMatchObject({ code: "RUN_ALREADY_RUNNING" });
  });

  it("从未整轮执行过（无基准快照）→ RUN_SNAPSHOT_MISSING，并指引先整轮执行", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run, analyses } = await seed(repos, [QUANTILE]);

    const err = await engineFor(ds, repos)
      .runIncremental({ experimentId: experiment.id!, runId: run.id!, analysisIds: [analyses[0]!.id!] })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).not.toBeNull();
    expect((err as { code?: string }).code).toBe("RUN_SNAPSHOT_MISSING");
    expect(err!.message).toContain("运行引擎");
    // 预检失败不写批次日志（没有产生任何执行）
    expect((await repos.runs.getById(run.id!))!.executionLog ?? null).toBeNull();
  });

  it("Run 属于别的 Experiment → RUN_EXPERIMENT_MISMATCH", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { run, analyses } = await seed(repos, [QUANTILE]);
    const otherExp = await repos.experiments.create({
      datasetVersionId: DATASET_VERSION_ID,
      name: "另一个实验",
      researchType: "QUANTILE",
    });

    await expect(
      engineFor(ds, repos).runIncremental({
        experimentId: otherExp.id!,
        runId: run.id!,
        analysisIds: [analyses[0]!.id!],
      }),
    ).rejects.toMatchObject({ code: "RUN_EXPERIMENT_MISMATCH" });
  });
});

describe("ResearchEngine.runIncremental — 失败路径与可重入", () => {
  it("补跑失败 → Run FAILED + errorCode；批次日志收敛为 FAILED（不留 RUNNING），此前批次结果保留", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run, analyses } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });
    const oldResultsBefore = await repos.results.list({ analysisId: analyses[0]!.id! });

    const added = await addAnalysis(repos, run.id!, EVENT_STUDY);
    const failing = new ResearchEngine({ repos, reader: ds.reader, registry: failingRegistry(), eventPageSize: 7 });

    await expect(
      failing.runIncremental({ experimentId: experiment.id!, runId: run.id!, analysisIds: [added.id!] }),
    ).rejects.toMatchObject({ code: "ANALYSIS_FAILED" });

    const afterRun = (await repos.runs.getById(run.id!))!;
    expect(afterRun.status).toBe("FAILED");
    expect(afterRun.errorCode).toBe("ANALYSIS_FAILED");
    expect((await repos.analyses.getById(added.id!))!.status).toBe("FAILED");

    const log = afterRun.executionLog!;
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ sequence: 2, mode: "INCREMENTAL", status: "FAILED" });
    expect(log[1]!.errorCode).toBe("ANALYSIS_FAILED");
    expect(log[1]!.completedAt).not.toBeNull();
    // batch 1 未被牵连，此前批次的结果原样保留
    expect(log[0]!.status).toBe("COMPLETED");
    expect((await repos.results.list({ analysisId: analyses[0]!.id! })).map((r) => r.id)).toEqual(
      oldResultsBefore.map((r) => r.id),
    );
  });

  it("失败后分析为 FAILED，可再次补跑并成功（批次号继续递增，不复用）", async () => {
    const repos = makeRepos();
    const ds = makeDataset();
    const { experiment, run } = await seed(repos, [QUANTILE]);
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });
    const added = await addAnalysis(repos, run.id!, EVENT_STUDY);

    const failing = new ResearchEngine({ repos, reader: ds.reader, registry: failingRegistry(), eventPageSize: 7 });
    await expect(
      failing.runIncremental({ experimentId: experiment.id!, runId: run.id!, analysisIds: [added.id!] }),
    ).rejects.toMatchObject({ code: "ANALYSIS_FAILED" });

    const retry = await engineFor(ds, repos).runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
      analysisIds: [added.id!],
    });
    expect(retry.executionSequence).toBe(3); // 失败的批次已占用 2，不复用
    expect((await repos.analyses.getById(added.id!))!.status).toBe("COMPLETED");
    const log = (await repos.runs.getById(run.id!))!.executionLog!;
    expect(log.map((e) => [e.sequence, e.status])).toEqual([
      [1, "COMPLETED"],
      [2, "FAILED"],
      [3, "COMPLETED"],
    ]);
  });
});
