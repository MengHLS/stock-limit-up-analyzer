/**
 * RESEARCH-002 — Research Engine tRPC Router 契约测试。
 *
 * 覆盖（指令 §16 / §17 / §20「API 验证通过」）：
 *   - 路由注册：`researchEngine.*` 全部端点在 `appRouter` 中可见，且未破坏既有 router；
 *   - 权限：写端点 / 执行端点走 `adminProcedure`（未登录 → UNAUTHORIZED）；
 *   - 真实链路：createExperiment → createHypothesis → createRun → createAnalysis
 *                → runEngine → getAnalysisResults → listConclusions → getExperiment；
 *   - 领域错误 → 稳定 tRPC code 的映射（NOT_FOUND / BAD_REQUEST / PRECONDITION_FAILED）；
 *   - `listVariables` 返回的变量目录与 Dataset 真实视界一致（不发明视界）。
 *
 * Router 层不做统计：本测试断言的所有数字都由 ResearchEngine 真实计算得出。
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { buildResearchEngineRouter } from "./researchEngineRouter";
import { createInMemoryResearchRepositories, type ResearchRepositories } from "./researchCore";
import { ResearchEngineError } from "./researchEngine/errors";
import { buildSyntheticDataset, linearEvents } from "./researchEngine/testFixtures";

const DATASET_VERSION_ID = 900001;
/** appRouter 既有端点数量的下界（防止注册分支意外截断整棵路由树）。 */
const APP_ROUTER_MIN_PROCEDURES = 40;

const adminUser = {
  id: 1,
  openId: "test-admin",
  name: "test-admin",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function makeRepos(): ResearchRepositories {
  return createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === DATASET_VERSION_ID,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });
}

/** 40 个事件：turnover 与未来收益同序递增 → 分位研究应有清晰的单调结构。 */
const EVENT_COUNT = 40;

function buildFixture() {
  const ds = buildSyntheticDataset({ events: linearEvents(EVENT_COUNT), horizons: [5, 10, 20] });
  const repos = makeRepos();
  const router = buildResearchEngineRouter({
    repos,
    reader: ds.reader,
    eventPageSize: 8, // 故意用小分页，验证路由链路上的分批装配
  });
  const caller = router.createCaller({ req: {} as never, res: {} as never, user: adminUser });
  const anonCaller = router.createCaller({ req: {} as never, res: {} as never, user: null });
  return { ds, repos, router, caller, anonCaller };
}

/** 走真实 router 建立一个「Experiment + Hypothesis + Run + QUANTILE Analysis」前置。 */
async function seedThroughRouter(caller: ReturnType<typeof buildFixture>["caller"]) {
  const experiment = await caller.createExperiment({
    datasetVersionId: DATASET_VERSION_ID,
    name: "首板换手率与未来5日收益研究",
    researchType: "FEATURE",
  });
  const hypothesis = await caller.createHypothesis({
    experimentId: experiment.id!,
    name: "H1-换手率分位",
    statement: "换手率不同区间的首板股票，未来5日收益存在系统性差异。",
  });
  const run = await caller.createRun({ experimentId: experiment.id! });
  const analysis = await caller.createAnalysis({
    runId: run.id!,
    analysisType: "QUANTILE",
    name: "换手率十分位 → 未来5日收益",
    target: "future_return_5d",
    config: {
      featureField: "turnover",
      targetField: "future_return_5d",
      quantileGroups: 10,
    },
    metrics: [
      { metricCode: "SPREAD_TOP_BOTTOM", metricName: "首尾组收益差", displayOrder: 1 },
      { metricCode: "P_VALUE_DIFFERENCE", metricName: "首尾组差异 p 值", displayOrder: 2 },
    ],
  });
  return { experiment, hypothesis, run, analysis };
}

describe("researchEngineRouter — 注册与权限", () => {
  it("appRouter 暴露全部 researchEngine 端点", () => {
    const procedures = Object.keys((appRouter as never as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    const expected = [
      "researchEngine.listVariables",
      "researchEngine.createExperiment",
      "researchEngine.listExperiments",
      "researchEngine.getExperiment",
      "researchEngine.updateExperiment",
      "researchEngine.deleteExperiment",
      "researchEngine.createHypothesis",
      "researchEngine.updateHypothesis",
      "researchEngine.deleteHypothesis",
      "researchEngine.createRun",
      "researchEngine.listRuns",
      "researchEngine.getRun",
      "researchEngine.deleteRun",
      "researchEngine.runEngine",
      "researchEngine.runIncremental",
      "researchEngine.createAnalysis",
      "researchEngine.createAnalyses",
      "researchEngine.listAnalyses",
      "researchEngine.getAnalysis",
      "researchEngine.updateAnalysis",
      "researchEngine.deleteAnalysis",
      "researchEngine.getAnalysisResults",
      "researchEngine.setAnalysisConditions",
      "researchEngine.listConclusions",
      "researchEngine.listCandidates",
      "researchEngine.getConclusionPolicy",
      "researchEngine.listAnalysisTemplates",
      "researchEngine.createAnalysisTemplate",
      "researchEngine.deleteAnalysisTemplate",
      "researchEngine.applyAnalysisTemplate",
    ];
    for (const name of expected) {
      expect(procedures, `缺少端点 ${name}`).toContain(name);
    }
  });

  it("注册 researchEngine 未破坏既有 router", () => {
    const procedures = Object.keys((appRouter as never as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    expect(procedures).toContain("datasetRegistry.listDefinitions");
    expect(procedures.length).toBeGreaterThan(APP_ROUTER_MIN_PROCEDURES);
  });

  it("写端点与执行端点必须管理员：未登录 / 非管理员一律拒绝", async () => {
    const { anonCaller, router } = buildFixture();
    const forbidden = { code: "FORBIDDEN" };

    await expect(
      anonCaller.createExperiment({
        datasetVersionId: DATASET_VERSION_ID,
        name: "x",
        researchType: "FEATURE",
      }),
    ).rejects.toMatchObject(forbidden);
    await expect(anonCaller.runEngine({ experimentId: 1, runId: 1 })).rejects.toMatchObject(forbidden);
    await expect(
      anonCaller.runIncremental({ experimentId: 1, runId: 1, analysisIds: [1] }),
    ).rejects.toMatchObject(forbidden);

    // 已登录但非管理员同样被拒（研究执行会写库，不能开放给普通用户）
    const viewerCaller = router.createCaller({
      req: {} as never,
      res: {} as never,
      user: { ...adminUser, role: "user" as never },
    });
    await expect(
      viewerCaller.createExperiment({
        datasetVersionId: DATASET_VERSION_ID,
        name: "x",
        researchType: "FEATURE",
      }),
    ).rejects.toMatchObject(forbidden);

    // 只读端点不要求管理员
    await expect(viewerCaller.getConclusionPolicy()).resolves.toBeTruthy();
  });

  it("维护端点（update / delete）同样必须管理员：未登录一律拒绝", async () => {
    const { anonCaller } = buildFixture();
    const forbidden = { code: "FORBIDDEN" };
    await expect(
      anonCaller.updateExperiment({ experimentId: 1, name: "x" }),
    ).rejects.toMatchObject(forbidden);
    await expect(anonCaller.deleteExperiment({ experimentId: 1 })).rejects.toMatchObject(forbidden);
    await expect(anonCaller.deleteRun({ runId: 1 })).rejects.toMatchObject(forbidden);
    await expect(anonCaller.deleteAnalysis({ analysisId: 1 })).rejects.toMatchObject(forbidden);
    await expect(
      anonCaller.updateHypothesis({ hypothesisId: 1, name: "x" }),
    ).rejects.toMatchObject(forbidden);
    await expect(anonCaller.deleteHypothesis({ hypothesisId: 1 })).rejects.toMatchObject(forbidden);
    await expect(anonCaller.updateAnalysis({ analysisId: 1, name: "x" })).rejects.toMatchObject(forbidden);
    // RESEARCH-002C：批量创建与模板写端点
    await expect(
      anonCaller.createAnalyses({ runId: 1, items: [{ analysisType: "QUANTILE", name: "x" }] }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      anonCaller.createAnalysisTemplate({ name: "t", items: [{ analysisType: "QUANTILE", name: "x" }] }),
    ).rejects.toMatchObject(forbidden);
    await expect(anonCaller.deleteAnalysisTemplate({ templateId: 1 })).rejects.toMatchObject(forbidden);
    await expect(
      anonCaller.applyAnalysisTemplate({ templateId: 1, runId: 1 }),
    ).rejects.toMatchObject(forbidden);
    // 模板清单是只读，不需要管理员
    const { caller: adminCaller } = buildFixture();
    await expect(adminCaller.listAnalysisTemplates()).resolves.toEqual([]);
  });
});

describe("researchEngineRouter — 变量目录", () => {
  it("listVariables 只暴露 Dataset 真实存在的视界", async () => {
    const { caller } = buildFixture();
    const result = await caller.listVariables({ datasetVersionId: DATASET_VERSION_ID });

    expect(result.datasetVersion.datasetCode).toBe("synthetic_fixture");
    expect(result.datasetVersion.status).toBe("READY");

    // 视界有两个真实来源：outcome.horizon = {5,10,20}，以及 path.relativeDay = 1..20。
    // 取并集 → 每个 path 日的变量都真实存在（不是编造），但**不得超出**这两者的范围。
    const outcomeNames = result.outcomes;
    expect(outcomeNames).toContain("future_return_5d");
    expect(outcomeNames).toContain("future_return_20d");
    // 7d 来自 path.relativeDay（fixture 的 maxPathDay=20），是真实行 → 应当存在
    expect(outcomeNames).toContain("future_return_7d");
    // 21d / 25d 超出 path 与 outcome 的全部范围 → 一律不得出现（证明目录不发明视界）
    expect(outcomeNames.some((n) => n.endsWith("_21d"))).toBe(false);
    expect(outcomeNames.some((n) => n.endsWith("_25d"))).toBe(false);

    // feature 必须含 turnover（换手率研究的前提）
    expect(result.features).toContain("turnover");

    // regime 维度未接入标签源，必须显式标注不可用而不是默默给一个假枚举
    expect(result.dimensions).not.toContain("regime");
    expect(result.unavailableDimensions.map((d) => d.key)).toContain("regime");
  });

  it("listVariables 对不存在的 Dataset Version → NOT_FOUND", async () => {
    const { caller } = buildFixture();
    await expect(caller.listVariables({ datasetVersionId: 999_999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("researchEngineRouter — 端到端链路", () => {
  it("QUANTILE：Experiment → Run → Analysis → Result → Conclusion 全链路可查回", async () => {
    const { caller } = buildFixture();
    const { experiment, hypothesis, run } = await seedThroughRouter(caller);

    const engineResult = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });

    expect(engineResult.sampleCount).toBe(EVENT_COUNT);
    expect(engineResult.analysisCount).toBe(1);
    expect(engineResult.resultCount).toBeGreaterThan(0);
    expect(engineResult.conclusionId).not.toBeNull();
    expect(engineResult.durationMs).toBeGreaterThanOrEqual(0);

    const runView0 = await caller.getRun({ runId: run.id! });
    expect(runView0.run.status).toBe("COMPLETED");
    expect(runView0.run.sampleCount).toBe(EVENT_COUNT);

    // ---- 结果可经 Repository 查回 ----
    const results = await caller.getAnalysisResults({
      analysisId: engineResult.analyses[0]!.analysisId,
    });
    expect(results.length).toBeGreaterThan(0);

    // 十分位分组必须覆盖全部样本（40 个事件 → 10 组，每组 4 个）
    const groupRows = results.filter((r) => r.metricCode === "SAMPLE_COUNT" && r.resultType === "GROUPED");
    expect(groupRows.length).toBe(10);
    expect(groupRows.reduce((sum, r) => sum + (r.sampleCount ?? 0), 0)).toBe(EVENT_COUNT);

    const spread = results.find((r) => r.metricCode === "SPREAD_TOP_BOTTOM");
    expect(spread).toBeDefined();
    // turnover 与未来收益同序 → 首尾组差必须为正（引擎真实算出来的方向）
    expect(spread!.metricValue).toBeGreaterThan(0);
    // SPREAD 只在顶 / 底两组上计算，其 sampleCount = 两组样本数之和（不是全样本）
    expect(spread!.sampleCount).toBe((EVENT_COUNT / 10) * 2);

    // ---- bundle 可查回：分析 + 指标定义 + 结果 ----
    const bundle = await caller.getAnalysis({
      analysisId: engineResult.analyses[0]!.analysisId,
    });
    expect(bundle.analysis.analysisType).toBe("QUANTILE");
    expect(bundle.metrics.map((m) => m.metricCode)).toContain("SPREAD_TOP_BOTTOM");
    expect(bundle.results.length).toBe(results.length);

    // ---- Experiment 聚合视图 ----
    const detail = await caller.getExperiment({ experimentId: experiment.id! });
    expect(detail.experiment.id).toBe(experiment.id);
    expect(detail.runs.map((r) => r.id)).toContain(run.id);
    expect(detail.hypotheses.map((h) => h.id)).toContain(hypothesis.id);
    expect(detail.conclusions.length).toBe(1);
    expect(detail.conclusions[0]!.id).toBe(engineResult.conclusionId);
    expect(detail.datasetVersion?.datasetVersionId).toBe(DATASET_VERSION_ID);

    // ---- Run 视图 ----
    const runView = await caller.getRun({ runId: run.id! });
    expect(runView.run.status).toBe("COMPLETED");
    expect(runView.analyses.length).toBe(1);
  });

  it("已 COMPLETED 的 Run 不允许重复执行（CONFLICT）", async () => {
    const { caller } = buildFixture();
    const { experiment, run } = await seedThroughRouter(caller);
    await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });

    await expect(
      caller.runEngine({ experimentId: experiment.id!, runId: run.id! }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("重跑同一 Run 时结果被整批重写而非追加", async () => {
    const { caller, repos } = buildFixture();
    const { experiment, run } = await seedThroughRouter(caller);

    const first = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
    const analysisId = first.analyses[0]!.analysisId;
    const firstResults = await caller.getAnalysisResults({ analysisId });

    // 引擎不允许直接重跑 COMPLETED 的 Run；把它退回可执行状态后重跑，
    // 以此验证「同一次分析重复执行」不会把结果追加成两份。
    await repos.runs.update(run.id!, { status: "PENDING" });
    const second = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
    const secondResults = await caller.getAnalysisResults({
      analysisId: second.analyses[0]!.analysisId,
    });

    expect(second.analyses[0]!.analysisId).toBe(analysisId);
    expect(secondResults.length).toBe(firstResults.length);
    expect(second.resultCount).toBe(first.resultCount);
    const firstSpread = firstResults.find((r) => r.metricCode === "SPREAD_TOP_BOTTOM")!.metricValue;
    const secondSpread = secondResults.find((r) => r.metricCode === "SPREAD_TOP_BOTTOM")!.metricValue;
    expect(secondSpread).toBeCloseTo(firstSpread!, 10);
  });

  it("分析条件替换后旧产物失效：清结果 + 删失效结论 + 回退 PENDING（于是可重跑）", async () => {
    const { caller } = buildFixture();
    const { experiment, run } = await seedThroughRouter(caller);

    const engineResult = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
    const analysisId = engineResult.analyses[0]!.analysisId;

    const beforeResults = await caller.getAnalysisResults({ analysisId });
    expect(beforeResults.length).toBeGreaterThan(0);
    const beforeConclusions = await caller.listConclusions({ experimentId: experiment.id! });
    expect(beforeConclusions.length).toBe(1);

    const replaced = await caller.setAnalysisConditions({
      analysisId,
      conditions: [
        { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">", value: 15 },
      ],
    });
    expect(replaced.conditions.length).toBe(1);
    expect(replaced.conditions[0]!.fieldName).toBe("turnover");

    // 1) 旧结果被整批清除（不残留用旧口径算出的数字）
    expect(replaced.invalidation.deletedResults).toBe(beforeResults.length);
    expect(await caller.getAnalysisResults({ analysisId })).toEqual([]);
    // 2) 证据指向该分析的结论被删除（不留悬空证据）
    expect(replaced.invalidation.deletedConclusions).toBe(1);
    expect(await caller.listConclusions({ experimentId: experiment.id! })).toEqual([]);
    // 3) Analysis / Run 回退 PENDING → 可直接重跑，无需额外入口
    const afterRun = await caller.getRun({ runId: run.id! });
    expect(afterRun.run.status).toBe("PENDING");
    expect(afterRun.analyses[0]!.status).toBe("PENDING");
    const rerun = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
    expect(rerun.conclusionId).not.toBeNull();
    expect((await caller.listConclusions({ experimentId: experiment.id! })).length).toBe(1);
  });
});

describe("researchEngineRouter — 维护端点（更新 / 级联删除）", () => {
  it("updateExperiment 改名生效；datasetVersionId 不可改（schema 里没有该键）", async () => {
    const { caller, repos } = buildFixture();
    const { experiment } = await seedThroughRouter(caller);
    const updated = await caller.updateExperiment({
      experimentId: experiment.id!,
      name: "改名后的实验",
      description: "补充说明",
    });
    expect(updated.name).toBe("改名后的实验");
    expect(updated.description).toBe("补充说明");
    expect(updated.datasetVersionId).toBe(DATASET_VERSION_ID);
    const reloaded = await repos.experiments.getById(experiment.id!);
    expect(reloaded!.name).toBe("改名后的实验");
  });

  it("updateExperiment 空 patch → BAD_REQUEST（拒绝无意义写）", async () => {
    const { caller } = buildFixture();
    const { experiment } = await seedThroughRouter(caller);
    await expect(
      caller.updateExperiment({ experimentId: experiment.id! }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deleteExperiment 级联删干净：实验 / Run / 分析 / 结果 / 假设 / 结论全为 0 残留", async () => {
    const { caller, repos } = buildFixture();
    const { experiment, run } = await seedThroughRouter(caller);
    await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });

    const { counts, summary } = await caller.deleteExperiment({ experimentId: experiment.id! });
    expect(counts.experiments).toBe(1);
    expect(counts.runs).toBe(1);
    expect(counts.analyses).toBe(1);
    expect(counts.hypotheses).toBe(1);
    expect(counts.conclusions).toBe(1);
    expect(counts.results).toBeGreaterThan(0);
    expect(summary).toContain("已删除");

    // 孤儿检查：整棵子树在仓储里确实消失了
    expect(await repos.experiments.getById(experiment.id!)).toBeUndefined();
    expect(await repos.runs.list({ experimentId: experiment.id! })).toEqual([]);
    expect(await repos.analyses.list({ runId: run.id! })).toEqual([]);
    expect(await repos.hypotheses.listByExperiment(experiment.id!)).toEqual([]);
    expect(await repos.conclusions.list({ experimentId: experiment.id! })).toEqual([]);
    expect(await repos.results.list({ analysisId: 1 })).toEqual([]);
  });

  it("deleteExperiment 未命中 → NOT_FOUND", async () => {
    const { caller } = buildFixture();
    await expect(caller.deleteExperiment({ experimentId: 999_999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deleteRun 只删归属该 Run 的结论：另一个 Run 的结论必须保留", async () => {
    const { caller } = buildFixture();
    const { experiment, run } = await seedThroughRouter(caller);
    await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });

    // 第二个 Run：独立分析 + 独立结论
    const run2 = await caller.createRun({ experimentId: experiment.id! });
    await caller.createAnalysis({
      runId: run2.id!,
      analysisType: "DESCRIPTIVE",
      name: "描述统计",
      target: "future_return_5d",
      config: { targetField: "future_return_5d" },
      metrics: [{ metricCode: "MEAN_RETURN", metricName: "平均收益" }],
    });
    await caller.runEngine({ experimentId: experiment.id!, runId: run2.id! });
    expect((await caller.listConclusions({ experimentId: experiment.id! })).length).toBe(2);

    const result = await caller.deleteRun({ runId: run.id! });
    expect(result.counts.runs).toBe(1);
    expect(result.counts.analyses).toBe(1);
    // 只删掉 run1 那条结论，run2 的必须还在
    expect(result.counts.conclusions).toBe(1);
    expect(result.unattributedConclusions).toBe(0);
    const remaining = await caller.listConclusions({ experimentId: experiment.id! });
    expect(remaining.length).toBe(1);

    // run1 的分析已消失、run2 的仍在
    expect(await caller.listAnalyses({ runId: run.id! })).toEqual([]);
    expect((await caller.listAnalyses({ runId: run2.id! })).length).toBe(1);
  });

  it("deleteRun 未命中 → NOT_FOUND", async () => {
    const { caller } = buildFixture();
    await expect(caller.deleteRun({ runId: 999_999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deleteRun 对 RUNNING 的 Run → CONFLICT（拒绝删除飞行中的写入）", async () => {
    const { caller, repos } = buildFixture();
    const { run } = await seedThroughRouter(caller);
    await repos.runs.update(run.id!, { status: "RUNNING" });
    await expect(caller.deleteRun({ runId: run.id! })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("deleteAnalysis 删分析 + 子行 + 证据指向它的结论（Run 保留）", async () => {
    const { caller } = buildFixture();
    const { experiment, run } = await seedThroughRouter(caller);
    const engineResult = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
    const analysisId = engineResult.analyses[0]!.analysisId;

    const { counts } = await caller.deleteAnalysis({ analysisId });
    expect(counts.analyses).toBe(1);
    expect(counts.results).toBeGreaterThan(0);
    expect(counts.conclusions).toBe(1);
    expect(counts.runs).toBe(0); // Run 本身保留
    expect(await caller.listConclusions({ experimentId: experiment.id! })).toEqual([]);
    const runAfter = await caller.getRun({ runId: run.id! });
    expect(runAfter.run.id).toBe(run.id);
  });

  it("updateHypothesis / deleteHypothesis 生效（删假设连带删其结论）", async () => {
    const { caller, repos } = buildFixture();
    const { experiment, hypothesis, run } = await seedThroughRouter(caller);
    await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });

    const updated = await caller.updateHypothesis({
      hypothesisId: hypothesis.id!,
      status: "TESTING",
    });
    expect(updated.status).toBe("TESTING");

    const { counts } = await caller.deleteHypothesis({ hypothesisId: hypothesis.id! });
    expect(counts.hypotheses).toBe(1);
    expect(counts.conclusions).toBe(1);
    expect(await repos.hypotheses.listByExperiment(experiment.id!)).toEqual([]);
    expect(await caller.listConclusions({ experimentId: experiment.id! })).toEqual([]);
  });

  it("updateAnalysis 改名称生效，且不影响已落库结果", async () => {
    const { caller } = buildFixture();
    const { experiment, run } = await seedThroughRouter(caller);
    const engineResult = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
    const analysisId = engineResult.analyses[0]!.analysisId;
    const resultCount = (await caller.getAnalysisResults({ analysisId })).length;

    const updated = await caller.updateAnalysis({ analysisId, name: "重命名后的分析" });
    expect(updated.name).toBe("重命名后的分析");
    // 只改元信息，结果不受影响（与 setAnalysisConditions 的语义差别在此）
    expect((await caller.getAnalysisResults({ analysisId })).length).toBe(resultCount);
  });
});

describe("researchEngineRouter — 错误码映射", () => {
  it("未找到 Experiment → NOT_FOUND", async () => {
    const { caller } = buildFixture();
    await expect(caller.runEngine({ experimentId: 999_999, runId: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("未找到 Run → NOT_FOUND", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "x",
      researchType: "FEATURE",
    });
    await expect(
      caller.runEngine({ experimentId: experiment.id!, runId: 999_999 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Run 不属于该 Experiment → CONFLICT", async () => {
    const { caller } = buildFixture();
    const a = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "A",
      researchType: "FEATURE",
    });
    const b = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "B",
      researchType: "FEATURE",
    });
    const runOfB = await caller.createRun({ experimentId: b.id! });
    await expect(
      caller.runEngine({ experimentId: a.id!, runId: runOfB.id! }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("未知变量 → BAD_REQUEST（引擎在计算前就拒绝）", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "x",
      researchType: "FEATURE",
    });
    const run = await caller.createRun({ experimentId: experiment.id! });
    await caller.createAnalysis({
      runId: run.id!,
      analysisType: "QUANTILE",
      name: "bad feature",
      config: { featureField: "not_a_real_feature", targetField: "future_return_5d", quantileGroups: 10 },
    });
    await expect(
      caller.runEngine({ experimentId: experiment.id!, runId: run.id! }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("没有任何分析 → BAD_REQUEST", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "x",
      researchType: "FEATURE",
    });
    const run = await caller.createRun({ experimentId: experiment.id! });
    await expect(
      caller.runEngine({ experimentId: experiment.id!, runId: run.id! }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("runEngine 失败后 Run 必须落 FAILED + errorCode（可查回）", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "x",
      researchType: "FEATURE",
    });
    const run = await caller.createRun({ experimentId: experiment.id! });
    await caller.createAnalysis({
      runId: run.id!,
      analysisType: "QUANTILE",
      name: "bad",
      config: { featureField: "nope", targetField: "future_return_5d", quantileGroups: 10 },
    });

    await expect(
      caller.runEngine({ experimentId: experiment.id!, runId: run.id! }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const runView = await caller.getRun({ runId: run.id! });
    expect(runView.run.status).toBe("FAILED");
    expect(runView.run.errorCode).toBeTruthy();
    expect(runView.run.errorMessage).toBeTruthy();
  });

  it("getExperiment / getRun / getAnalysis 未命中 → NOT_FOUND", async () => {
    const { caller } = buildFixture();
    await expect(caller.getExperiment({ experimentId: 999_999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.getRun({ runId: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.getAnalysis({ analysisId: 999_999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("researchEngineRouter — 增量补跑（runIncremental）", () => {
  it("整轮执行后新增分析：走路由补跑 → 有新结果、有批次日志、不生成结论、旧结果不变", async () => {
    const { caller } = buildFixture();
    const { experiment, run, analysis } = await seedThroughRouter(caller);

    const full = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
    expect(full.conclusionId).not.toBeNull();
    const oldRowsBefore = await caller.getAnalysisResults({ analysisId: analysis.id! });
    expect(oldRowsBefore.length).toBeGreaterThan(0);

    // 整轮跑完后新增一个分析 —— 此时「运行引擎」按钮因 Run 已 COMPLETED 而不可点
    const added = await caller.createAnalysis({
      runId: run.id!,
      analysisType: "EVENT_STUDY",
      name: "首板后 T+N 日收益分布",
      config: { horizons: [5, 10] },
    });

    const inc = await caller.runIncremental({
      experimentId: experiment.id!,
      runId: run.id!,
      analysisIds: [added.id!],
    });

    // 增量批次不生成结论（诚实声明），但确实产出了结果
    expect(inc.conclusionId).toBeNull();
    expect(inc.conclusionSkippedReason).toContain("INCREMENTAL_EXECUTION");
    expect(inc.basisSource).toBe("run-snapshot");
    expect(inc.sampleCount).toBe(full.sampleCount);
    expect(inc.analyses).toHaveLength(1);
    expect(inc.analyses[0]!.status).toBe("COMPLETED");
    expect(inc.analyses[0]!.resultCount).toBeGreaterThan(0);

    const addedRows = await caller.getAnalysisResults({ analysisId: added.id! });
    expect(addedRows.length).toBe(inc.analyses[0]!.resultCount);

    // 旧分析的结果行未被覆盖
    const oldRowsAfter = await caller.getAnalysisResults({ analysisId: analysis.id! });
    expect(oldRowsAfter.map((r) => r.id)).toEqual(oldRowsBefore.map((r) => r.id));

    // 批次日志：batch 1 = 整轮（FULL），batch 2 = 补跑（INCREMENTAL）
    const runView = await caller.getRun({ runId: run.id! });
    const log = (runView.run as { executionLog?: Array<Record<string, unknown>> }).executionLog!;
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ sequence: 1, mode: "FULL", status: "COMPLETED" });
    expect(log[1]).toMatchObject({ sequence: 2, mode: "INCREMENTAL", status: "COMPLETED" });
    expect(log[1]!.analysisIds).toEqual([added.id!]);
    // 全部完成后 Run 回到 COMPLETED
    expect(runView.run.status).toBe("COMPLETED");
  });

  it("从未整轮执行过（无基准快照）→ PRECONDITION_FAILED", async () => {
    const { caller } = buildFixture();
    const { experiment, run, analysis } = await seedThroughRouter(caller);

    await expect(
      caller.runIncremental({
        experimentId: experiment.id!,
        runId: run.id!,
        analysisIds: [analysis.id!],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("已 COMPLETED 的分析不可补跑 → CONFLICT；无待补跑分析 → CONFLICT", async () => {
    const { caller } = buildFixture();
    const { experiment, run, analysis } = await seedThroughRouter(caller);
    await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });

    await expect(
      caller.runIncremental({
        experimentId: experiment.id!,
        runId: run.id!,
        analysisIds: [analysis.id!],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 全部已完成且未指定 id → 没有可补跑的分析
    await expect(
      caller.runIncremental({ experimentId: experiment.id!, runId: run.id! }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("researchEngineRouter — 批量建分析（createAnalyses）", () => {
  it("一次提交建出一组分析，且 created 的 index 能映射回入参", async () => {
    const { caller } = buildFixture();
    const { run } = await seedThroughRouter(caller);

    const result = await caller.createAnalyses({
      runId: run.id!,
      items: [
        { analysisType: "QUANTILE", name: "分位 T+5", target: "future_return_5d", config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 } },
        { analysisType: "QUANTILE", name: "分位 T+10", target: "future_return_10d", config: { featureField: "turnover", targetField: "future_return_10d", quantileGroups: 10 } },
        { analysisType: "EVENT_STUDY", name: "事件 T+5/T+10", config: { horizons: [5, 10] } },
      ],
    });

    expect(result.createdCount).toBe(3);
    expect(result.failedCount).toBe(0);
    expect(result.created.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(result.created.map((c) => c.name)).toEqual(["分位 T+5", "分位 T+10", "事件 T+5/T+10"]);

    const analyses = await caller.listAnalyses({ runId: run.id! });
    // seedThroughRouter 已建 1 个，本批再加 3 个
    expect(analyses).toHaveLength(4);
  });

  it("CONDITIONAL 带条件时条件真实落库（组号连续）", async () => {
    const { caller } = buildFixture();
    const { run } = await seedThroughRouter(caller);

    const result = await caller.createAnalyses({
      runId: run.id!,
      items: [
        {
          analysisType: "CONDITIONAL",
          name: "高换手 vs 全样本",
          target: "future_return_5d",
          config: { targetField: "future_return_5d" },
          conditions: [
            { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 1.5 },
          ],
        },
      ],
    });
    expect(result.createdCount).toBe(1);

    const bundle = await caller.getAnalysis({ analysisId: result.created[0]!.analysisId });
    expect(bundle.conditions).toHaveLength(1);
    expect(bundle.conditions[0]!.fieldName).toBe("turnover");
    expect(bundle.conditions[0]!.groupNo).toBe(0);
  });

  it("预检未通过 → 整批拒绝，**一个都不建**（BAD_REQUEST）", async () => {
    const { caller } = buildFixture();
    const { run } = await seedThroughRouter(caller);
    const before = await caller.listAnalyses({ runId: run.id! });

    await expect(
      caller.createAnalyses({
        runId: run.id!,
        items: [
          { analysisType: "QUANTILE", name: "合法项", target: "future_return_5d", config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 } },
          // 第 2 项非法：DISTRIBUTION 未在 RESEARCH-002 实现
          { analysisType: "DISTRIBUTION", name: "非法项" },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const after = await caller.listAnalyses({ runId: run.id! });
    expect(after).toHaveLength(before.length);
  });

  it("CONDITIONAL 缺条件 → 预检拦住（不写出一个跑不了的分析）", async () => {
    const { caller } = buildFixture();
    const { run } = await seedThroughRouter(caller);

    await expect(
      caller.createAnalyses({
        runId: run.id!,
        items: [{ analysisType: "CONDITIONAL", name: "无条件", target: "future_return_5d" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("Run 不存在 → NOT_FOUND", async () => {
    const { caller } = buildFixture();
    await expect(
      caller.createAnalyses({
        runId: 999999,
        items: [{ analysisType: "QUANTILE", name: "x", config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 } }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("researchEngineRouter — 分析模板（跨实验复用）", () => {
  async function seedTemplate(caller: ReturnType<typeof buildFixture>["caller"], name = "首板标准检查") {
    return caller.createAnalysisTemplate({
      name,
      items: [
        { analysisType: "QUANTILE", name: "分位 T+5", target: "future_return_5d", config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 } },
        { analysisType: "EVENT_STUDY", name: "事件 T+5/T+10", config: { horizons: [5, 10] } },
      ],
    });
  }

  it("创建 → 清单 → 按模板铺到另一个 Run（跨实验复用）", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "实验 A",
      researchType: "FEATURE",
    });
    const runA = await caller.createRun({ experimentId: experiment.id! });
    const runB = await caller.createRun({ experimentId: experiment.id! });

    const template = await seedTemplate(caller);
    expect(template.items).toHaveLength(2);

    const listed = await caller.listAnalysisTemplates();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toBe("首板标准检查");
    expect(listed[0]!.items).toHaveLength(2);

    const applied = await caller.applyAnalysisTemplate({ templateId: template.id!, runId: runB.id! });
    expect(applied.createdCount).toBe(2);
    expect(applied.failedCount).toBe(0);
    expect(applied.templateName).toBe("首板标准检查");

    // 模板是「配方」：两个 Run 各自独立落库，互不影响
    expect(await caller.listAnalyses({ runId: runA.id! })).toHaveLength(0);
    expect(await caller.listAnalyses({ runId: runB.id! })).toHaveLength(2);
  });

  it("模板里带条件时，展开后条件是**真关系行**（不是 JSON 直通）", async () => {
    const { caller } = buildFixture();
    const { run } = await seedThroughRouter(caller);

    const template = await caller.createAnalysisTemplate({
      name: "带条件的模板",
      items: [
        {
          analysisType: "CONDITIONAL",
          name: "高换手条件",
          target: "future_return_5d",
          config: { targetField: "future_return_5d" },
          conditions: [{ groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 1.5 }],
        },
      ],
    });
    const applied = await caller.applyAnalysisTemplate({ templateId: template.id!, runId: run.id! });
    const bundle = await caller.getAnalysis({ analysisId: applied.created[0]!.analysisId });
    expect(bundle.conditions).toHaveLength(1);
    expect(bundle.conditions[0]!.fieldName).toBe("turnover");
  });

  it("模板名重名 → CONFLICT（名字是「一键铺开」的不歧义引用基础）", async () => {
    const { caller } = buildFixture();
    await seedTemplate(caller, "重名测试");
    await expect(seedTemplate(caller, "重名测试")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("空模板明细 → BAD_REQUEST（zod min(1)），不写出一个铺不出东西的模板", async () => {
    const { caller } = buildFixture();
    await expect(caller.createAnalysisTemplate({ name: "空", items: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("模板不存在 → NOT_FOUND（apply 与 delete 都如此）", async () => {
    const { caller } = buildFixture();
    const { run } = await seedThroughRouter(caller);
    await expect(
      caller.applyAnalysisTemplate({ templateId: 987654, runId: run.id! }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.deleteAnalysisTemplate({ templateId: 987654 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("删除模板：明细一并消失，且不影响已铺出的分析", async () => {
    const { caller } = buildFixture();
    const { run } = await seedThroughRouter(caller);
    const template = await seedTemplate(caller, "将被删除");
    const applied = await caller.applyAnalysisTemplate({ templateId: template.id!, runId: run.id! });

    const deleted = await caller.deleteAnalysisTemplate({ templateId: template.id! });
    expect(deleted.deleted).toBe(true);
    expect(deleted.names).toHaveLength(2);

    expect(await caller.listAnalysisTemplates()).toHaveLength(0);
    // 已铺出的分析仍在（模板只是配方，不是父实体）
    const bundle = await caller.getAnalysis({ analysisId: applied.created[0]!.analysisId });
    expect(bundle.analysis.name).toBe("分位 T+5");
  });
});

describe("researchEngineRouter — 默认实例契约", () => {
  it("getConclusionPolicy 返回引擎默认阈值（前端展示用）", async () => {
    const { caller } = buildFixture();
    const policy = await caller.getConclusionPolicy();
    expect(policy.alpha).toBeGreaterThan(0);
    expect(policy.alpha).toBeLessThan(1);
    expect(policy.minSampleCount).toBeGreaterThan(0);
  });

  it("ResearchEngineError 是 Engine 边界上唯一的领域错误类型", () => {
    const e = new ResearchEngineError("NO_ANALYSES", "x");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("NO_ANALYSES");
  });
});
