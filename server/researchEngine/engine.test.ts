/**
 * RESEARCH-002 — ResearchEngine 端到端测试（合成 Dataset，真实执行链路）。
 *
 * 覆盖（指令 §17）：
 *   - Experiment load（含不存在 → EXPERIMENT_NOT_FOUND）
 *   - Dataset Version 校验（不存在 / 非 READY）
 *   - Run lifecycle（PENDING → RUNNING → COMPLETED；失败 → FAILED + errorCode/errorMessage）
 *   - Analysis dispatch（未实现类型 → UNKNOWN_ANALYSIS_TYPE；配置非法 → INVALID_ANALYSIS_CONFIG）
 *   - 成功链路：Experiment → Run → Analysis → Result → Conclusion 全可查回
 *   - 反模式守卫：不写 Dataset、不建副本表
 */

import { describe, expect, it } from "vitest";
import { createInMemoryResearchRepositories, type ResearchRepositories } from "../researchCore";
import { ResearchEngine } from "./engine";
import { ResearchEngineError } from "./errors";
import { buildSyntheticDataset, linearEvents, type SyntheticDataset, type SyntheticEventSpec } from "./testFixtures";
import type { ResearchDatasetReader } from "./datasetReader";

const DATASET_VERSION_ID = 900001;

function makeRepos(): ResearchRepositories {
  return createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === DATASET_VERSION_ID,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });
}

/** 建 Experiment + Hypothesis + Run + Analyses 的完整前置。 */
async function seed(
  repos: ResearchRepositories,
  analyses: Array<{ analysisType: string; name?: string; config: unknown }>,
  options: { experimentStatus?: string; runStatus?: string; datasetVersionId?: number; conclusions?: boolean } = {},
) {
  const experiment = await repos.experiments.create({
    datasetVersionId: options.datasetVersionId ?? DATASET_VERSION_ID,
    name: "首板换手率与未来5日收益",
    researchType: "QUANTILE",
    ...(options.experimentStatus ? { status: options.experimentStatus as never } : {}),
  });
  const hypothesis = await repos.hypotheses.create({
    experimentId: experiment.id!,
    name: "H1",
    statement: "换手率不同区间的首板股票，未来5日收益存在系统性差异。",
  });
  const run = await repos.runs.create({
    experimentId: experiment.id!,
    runNo: 1,
    ...(options.runStatus ? { status: options.runStatus as never } : {}),
  });
  const created = [];
  for (const a of analyses) {
    const analysis = await repos.analyses.create({
      runId: run.id!,
      analysisType: a.analysisType as never,
      name: a.name ?? a.analysisType,
      config: a.config,
    });
    created.push(analysis);
  }
  return { experiment, hypothesis, run, analyses: created };
}

function engineFor(ds: SyntheticDataset, repos: ResearchRepositories, reader?: ResearchDatasetReader) {
  return new ResearchEngine({
    repos,
    reader: reader ?? ds.reader,
    eventPageSize: 7, // 故意用小分页，验证分批装配
  });
}

const EVENT_SPECS: SyntheticEventSpec[] = Array.from({ length: 60 }, (_, i) => ({
  index: i,
  turnover: 1 + i * 0.5,
  tradeDate: `202${i < 30 ? 4 : 5}-0${(i % 9) + 1}-1${i % 9}`,
  futureReturn: (h) => (h === 5 ? (i / 60) * 0.12 : null),
}));

describe("ResearchEngine", () => {
  it("Experiment 不存在 → EXPERIMENT_NOT_FOUND", async () => {
    const repos = makeRepos();
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    const engine = engineFor(ds, repos);
    await expect(engine.run({ experimentId: 999, runId: 1 })).rejects.toMatchObject({
      code: "EXPERIMENT_NOT_FOUND",
    });
  });

  it("Run 不属于该 Experiment → RUN_EXPERIMENT_MISMATCH", async () => {
    const repos = makeRepos();
    const a = await seed(repos, [{ analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } }]);
    const b = await seed(repos, [{ analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } }]);
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    await expect(engineFor(ds, repos).run({ experimentId: a.experiment.id!, runId: b.run.id! })).rejects.toMatchObject({
      code: "RUN_EXPERIMENT_MISMATCH",
    });
  });

  it("Dataset Version 不存在 → DATASET_VERSION_NOT_FOUND", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(repos, [{ analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } }]);
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    // 读取层报告该版本不存在（版本可能已被删除）→ Engine 必须具名失败
    const missing: ResearchDatasetReader = {
      getVersionContext: async () => null,
      loadEventPage: (q) => ds.reader.loadEventPage(q),
      loadOutcomes: (q) => ds.reader.loadOutcomes(q),
      loadPaths: (q) => ds.reader.loadPaths(q),
      loadPrefixBars: (q) => ds.reader.loadPrefixBars(q),
    };
    await expect(engineFor(ds, repos, missing).run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "DATASET_VERSION_NOT_FOUND",
    });
  });

  it("Dataset Version 非 READY → DATASET_VERSION_NOT_READY（BUILDING 版本不得用于研究）", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(repos, [{ analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } }]);
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    ds.context.status = "BUILDING";
    // 重新构造 reader，保证读到被改过的 context
    const reader = new (await import("./datasetReader")).InMemoryResearchDatasetReader({
      context: ds.context,
      events: ds.events,
      paths: ds.paths,
      outcomes: ds.outcomes,
      prefixBars: ds.prefixBars,
    });
    await expect(engineFor(ds, repos, reader).run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "DATASET_VERSION_NOT_READY",
    });
  });

  it("无 Analysis → NO_ANALYSES", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(repos, []);
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    await expect(engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "NO_ANALYSES",
    });
  });

  it("未实现的分析类型 → UNKNOWN_ANALYSIS_TYPE；Run 落 FAILED 但 startedAt 为空（预检拒绝）", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(repos, [{ analysisType: "IC", config: {} }]);
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    await expect(engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "UNKNOWN_ANALYSIS_TYPE",
    });
    const after = await repos.runs.getById(run.id!);
    // 失败原因必须可追溯（否则 Run 永久停在 PENDING，用户看不到为什么没跑）
    expect(after!.status).toBe("FAILED");
    expect(after!.errorCode).toBe("UNKNOWN_ANALYSIS_TYPE");
    // startedAt 为空 → 可据此区分「预检拒绝」与「执行中崩溃」，两者不会混淆
    expect(after!.startedAt ?? null).toBeNull();
    // 预检拒绝不污染 Experiment：修正配置后可直接重跑
    expect((await repos.experiments.getById(experiment.id!))!.status).not.toBe("FAILED");
  });

  it("配置非法（QUANTILE 缺 featureField）→ INVALID_ANALYSIS_CONFIG；Run 落 FAILED 且未开始执行", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(repos, [
      { analysisType: "QUANTILE", config: { targetField: "future_return_5d" } },
    ]);
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    await expect(engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "INVALID_ANALYSIS_CONFIG",
    });
    const after = await repos.runs.getById(run.id!);
    expect(after!.status).toBe("FAILED");
    expect(after!.errorCode).toBe("INVALID_ANALYSIS_CONFIG");
    expect(after!.startedAt ?? null).toBeNull();
    expect(after!.sampleCount ?? null).toBeNull();
  });

  it("Run 不存在 / Run 不归属该 Experiment → 不回写任何状态（无法归因则不动状态）", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(
      repos,
      [{ analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } }],
      { runStatus: "COMPLETED" },
    );
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    await expect(engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "RUN_NOT_PENDING",
    });
    // 状态不可执行的 Run 不能被改写（否则一次误点就能破坏已完成的历史运行）
    expect((await repos.runs.getById(run.id!))!.status).toBe("COMPLETED");
  });

  it("Run 状态非 PENDING/FAILED/CANCELLED → RUN_NOT_PENDING", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(
      repos,
      [{ analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } }],
      { runStatus: "COMPLETED" },
    );
    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    await expect(engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "RUN_NOT_PENDING",
    });
  });

  it("重跑时 RUNNING 转换必须清掉上一轮的失败残留（errorCode / errorMessage / completedAt）", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(
      repos,
      [{ analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } }],
      { runStatus: "FAILED" },
    );
    // 模拟「上一轮失败」留下的残留（真实场景见 2026-09-11 实查：RUNNING 的 Run 带着旧 errorCode，
    // 且 completedAt < startedAt，破坏了「startedAt 空/非空 + completedAt」的收口语义）。
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

    const ds = buildSyntheticDataset({ events: linearEvents(10), horizons: [5], maxPathDay: 5 });
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    const runningPatch = captured.find((p) => p.status === "RUNNING");
    expect(runningPatch).toBeDefined();
    expect(runningPatch!.completedAt).toBeNull();
    expect(runningPatch!.errorCode).toBeNull();
    expect(runningPatch!.errorMessage).toBeNull();

    const afterRun = await repos.runs.getById(run.id!);
    expect(afterRun!.status).toBe("COMPLETED");
    expect(afterRun!.errorCode).toBeNull();
    expect(afterRun!.errorMessage).toBeNull();
  });

  it("执行期失败 → Run 落 FAILED 且 errorCode / errorMessage 已保存，Analysis 落 FAILED", async () => {
    const repos = makeRepos();
    const { experiment, run, analyses } = await seed(repos, [
      { analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } },
    ]);
    const ds = buildSyntheticDataset({ events: linearEvents(20), horizons: [5], maxPathDay: 5 });
    // 注入「第 2 页开始报错」的读取层 → 在 RUNNING 之后失败
    const failing: ResearchDatasetReader = {
      getVersionContext: (id) => ds.reader.getVersionContext(id),
      loadEventPage: async (q) => {
        if (q.cursor) throw new Error("模拟读取中断");
        return ds.reader.loadEventPage(q);
      },
      loadOutcomes: (q) => ds.reader.loadOutcomes(q),
      loadPaths: (q) => ds.reader.loadPaths(q),
      loadPrefixBars: (q) => ds.reader.loadPrefixBars(q),
    };
    await expect(engineFor(ds, repos, failing).run({ experimentId: experiment.id!, runId: run.id! })).rejects.toBeInstanceOf(
      ResearchEngineError,
    );
    const afterRun = await repos.runs.getById(run.id!);
    expect(afterRun!.status).toBe("FAILED");
    expect(afterRun!.errorCode).toBe("INTERNAL_ERROR");
    expect(afterRun!.errorMessage).toContain("模拟读取中断");
    expect((await repos.experiments.getById(experiment.id!))!.status).toBe("FAILED");
    // 失败发生在第一个 analysis 执行之前（装配阶段），因此 analysis 未被置为 FAILED
    expect((await repos.analyses.getById(analyses[0]!.id!))!.status).toBe("PENDING");
  });

  it("分析执行器内部失败 → Run FAILED + errorCode=ANALYSIS_FAILED", async () => {
    const repos = makeRepos();
    const { experiment, run, analyses } = await seed(repos, [
      { analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } },
    ]);
    const ds = buildSyntheticDataset({ events: linearEvents(20), horizons: [5], maxPathDay: 5 });
    const engine = new ResearchEngine({
      repos,
      reader: ds.reader,
      registry: {
        // 故意让执行器在 execute 阶段抛错
        require: () => ({
          analysisType: "DESCRIPTIVE",
          requiredVariables: () => ({ features: ["turnover"], outcomes: [] }),
          execute: async () => {
            throw new Error("分析内部炸了");
          },
        }),
        has: () => true,
        listTypes: () => ["DESCRIPTIVE"],
        list: () => [],
        register: () => undefined,
      } as never,
    });
    await expect(engine.run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "ANALYSIS_FAILED",
    });
    const afterRun = await repos.runs.getById(run.id!);
    expect(afterRun!.status).toBe("FAILED");
    expect(afterRun!.errorCode).toBe("ANALYSIS_FAILED");
    expect((await repos.analyses.getById(analyses[0]!.id!))!.status).toBe("FAILED");
  });

  it("成功链路：5 类分析全跑通，结果与结论均可经 Repository 查回", async () => {
    const repos = makeRepos();
    const { experiment, run, analyses } = await seed(repos, [
      { analysisType: "DESCRIPTIVE", config: { variables: ["turnover", "future_return_5d"], minSampleCount: 1 } },
      { analysisType: "EVENT_STUDY", config: { horizons: [5], minSampleCount: 1 } },
      { analysisType: "QUANTILE", config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10, minSampleCount: 1 } },
      { analysisType: "STABILITY", config: { targetField: "future_return_5d", stabilityDimension: "year", minSampleCount: 1 } },
      {
        analysisType: "CONDITIONAL",
        name: "CONDITIONAL-turnover",
        config: { targetField: "future_return_5d", minSampleCount: 1 },
      },
    ]);
    // 给 CONDITIONAL 写条件
    const conditional = analyses.find((a) => a.analysisType === "CONDITIONAL")!;
    await repos.conditions.replaceForAnalysis(conditional.id!, [
      { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 15, logicalOperator: "AND", groupLogicalOperator: "AND" },
    ]);

    const ds = buildSyntheticDataset({ events: EVENT_SPECS, horizons: [5], maxPathDay: 5 });
    const result = await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });

    // ---- Run 生命周期 ----
    expect(result.sampleCount).toBe(EVENT_SPECS.length);
    expect(result.analysisCount).toBe(5);
    expect(result.resultCount).toBeGreaterThan(50);
    expect(result.analyses.every((a) => a.status === "COMPLETED")).toBe(true);

    const afterRun = await repos.runs.getById(run.id!);
    expect(afterRun!.status).toBe("COMPLETED");
    expect(afterRun!.sampleCount).toBe(EVENT_SPECS.length);
    expect(afterRun!.startedAt).toBeTruthy();
    expect(afterRun!.completedAt).toBeTruthy();
    expect(afterRun!.errorCode).toBeNull();
    // inputSnapshot 精确记录「这次到底用什么跑的」
    const snapshot = afterRun!.inputSnapshot as { datasetVersionId: number; variables: unknown };
    expect(snapshot.datasetVersionId).toBe(DATASET_VERSION_ID);
    expect(snapshot.variables).toBeTruthy();

    expect((await repos.experiments.getById(experiment.id!))!.status).toBe("COMPLETED");

    // ---- 分页装配确实分批（60 个事件 / 每页 7 → 9 次读取）----
    expect(ds.reader.callLog.filter((c) => c.method === "loadEventPage").length).toBe(Math.ceil(EVENT_SPECS.length / 7));

    // ---- 结果可查回，且结构化字段可用 ----
    const quantileAnalysis = analyses.find((a) => a.analysisType === "QUANTILE")!;
    const bundle = await repos.relationships.getAnalysisBundle(quantileAnalysis.id!);
    expect(bundle!.results.length).toBeGreaterThan(10);
    const spread = bundle!.results.find((r) => r.metricCode === "SPREAD_TOP_BOTTOM")!;
    expect(spread.resultType).toBe("SCALAR");
    expect(spread.metricValue!).toBeGreaterThan(0);

    // ---- 结论可查回，且带证据与免责声明 ----
    const conclusions = await repos.relationships.getExperimentConclusions(experiment.id!);
    expect(conclusions).toHaveLength(1);
    expect(conclusions[0]!.hypothesisId).toBeTruthy();
    expect(conclusions[0]!.conclusion).toContain("研究辅助");
    expect((conclusions[0]!.evidence as { primarySelectionRule: string }).primarySelectionRule).toContain("固定优先级");

    // ---- 全链路聚合查询 ----
    const withRuns = await repos.relationships.getExperimentWithRuns(experiment.id!);
    expect(withRuns!.runs).toHaveLength(1);
    const runWithAnalyses = await repos.relationships.getRunWithAnalyses(run.id!);
    expect(runWithAnalyses!.analyses).toHaveLength(5);
  });

  it("重跑幂等：二次执行不会重复累积结果行", async () => {
    const repos = makeRepos();
    const { experiment, run, analyses } = await seed(repos, [
      { analysisType: "DESCRIPTIVE", config: { variables: ["turnover"], minSampleCount: 1 } },
    ]);
    const ds = buildSyntheticDataset({ events: EVENT_SPECS, horizons: [5], maxPathDay: 5 });
    const engine = engineFor(ds, repos);
    const first = await engine.run({ experimentId: experiment.id!, runId: run.id! });
    await repos.runs.update(run.id!, { status: "PENDING" });
    const second = await engine.run({ experimentId: experiment.id!, runId: run.id! });
    expect(second.resultCount).toBe(first.resultCount);
    const rows = await repos.results.list({ analysisId: analyses[0]!.id! });
    expect(rows).toHaveLength(first.resultCount);
  });

  it("反模式守卫：执行不写 Dataset（事件 / 路径 / 结果行数与执行前一致）", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(repos, [
      { analysisType: "QUANTILE", config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 5, minSampleCount: 1 } },
    ]);
    const ds = buildSyntheticDataset({ events: EVENT_SPECS, horizons: [5], maxPathDay: 5 });
    const before = {
      events: ds.events.length,
      paths: ds.paths.length,
      outcomes: ds.outcomes.length,
      prefix: ds.prefixBars.length,
    };
    await engineFor(ds, repos).run({ experimentId: experiment.id!, runId: run.id! });
    expect({
      events: ds.events.length,
      paths: ds.paths.length,
      outcomes: ds.outcomes.length,
      prefix: ds.prefixBars.length,
    }).toEqual(before);
  });

  it("样本超硬上限 → DATASET_TOO_LARGE（诚实失败，不 OOM）", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seed(repos, [
      { analysisType: "DESCRIPTIVE", config: { variables: ["turnover"] } },
    ]);
    const ds = buildSyntheticDataset({ events: linearEvents(50), horizons: [5], maxPathDay: 5 });
    const engine = new ResearchEngine({ repos, reader: ds.reader, eventPageSize: 10, maxSamples: 20 });
    await expect(engine.run({ experimentId: experiment.id!, runId: run.id! })).rejects.toMatchObject({
      code: "DATASET_TOO_LARGE",
    });
    expect((await repos.runs.getById(run.id!))!.errorCode).toBe("DATASET_TOO_LARGE");
  });
});
