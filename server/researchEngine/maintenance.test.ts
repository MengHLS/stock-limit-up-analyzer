/**
 * RESEARCH-002 — 研究维护服务单测（级联删除 + 产物失效）。
 *
 * 这一层的价值全在**边界语义**上，所以测试重点不是「函数能跑」，而是：
 *   - 级联删除后**孤儿为 0**（本项目零数据库外键，只能靠顺序保证）；
 *   - 结论归属靠证据里的 analysisId 精确判定 —— 删 run1 **不得**误删 run2 的结论；
 *   - 提不出 analysisId 的结论**不删**且如实计数（宁可留可核查记录，也不猜着删）；
 *   - 改口径后旧产物必须失效，否则 UI 会继续展示用旧口径算出的数字（静默不实）；
 *   - 执行中（RUNNING）一律拒绝删除。
 *
 * 夹具用 in-memory 仓储：无需 DB，但**沿用真实仓储契约**（不放松约束）。
 */

import { describe, expect, it } from "vitest";
import { createInMemoryResearchRepositories, type ResearchRepositories } from "../researchCore";
import { ResearchEngineError } from "./errors";
import {
  analysisIdsReferencedByConclusionEvidence,
  deleteAnalysisCascade,
  deleteExperimentCascade,
  deleteHypothesisCascade,
  deleteRunCascade,
  describeDeletionCounts,
  invalidateAnalysis,
  replaceConditionsAndInvalidate,
} from "./maintenance";

const DATASET_VERSION_ID = 900001;

function makeRepos(): ResearchRepositories {
  return createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === DATASET_VERSION_ID,
    now: () => new Date("2026-09-11T00:00:00.000Z"),
  });
}

/** 建一棵完整的实验子树：experiment → hypothesis → run → analysis → (条件/指标/结果) + 结论。 */
async function seedTree(
  repos: ResearchRepositories,
  options: { withConclusion?: boolean; conclusionEvidence?: unknown } = {},
) {
  const experiment = await repos.experiments.create({
    datasetVersionId: DATASET_VERSION_ID,
    name: "维护服务测试实验",
    description: null,
    researchType: "FEATURE",
    config: null,
  });
  const hypothesis = await repos.hypotheses.create({
    experimentId: experiment.id!,
    name: "H1",
    statement: "换手率与未来收益相关。",
  });
  const run = await repos.runs.create({
    experimentId: experiment.id!,
    runNo: await repos.runs.nextRunNo(experiment.id!),
    config: null,
  });
  const analysis = await repos.analyses.create({
    runId: run.id!,
    analysisType: "QUANTILE",
    name: "换手率十分位",
    target: "future_return_5d",
    config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 },
  });
  await repos.conditions.replaceForAnalysis(analysis.id!, [
    {
      groupNo: 0,
      sortOrder: 0,
      fieldName: "turnover",
      operator: ">",
      value: 10,
      logicalOperator: "AND",
      groupLogicalOperator: "AND",
    },
  ]);
  await repos.metrics.create({
    analysisId: analysis.id!,
    metricCode: "SPREAD_TOP_BOTTOM",
    metricName: "首尾组收益差",
    displayOrder: 1,
  });
  await repos.results.createMany([
    {
      analysisId: analysis.id!,
      resultType: "GROUPED",
      metricCode: "MEAN_RETURN",
      dimension: { group: "Q1" },
      metricValue: 0.0304,
      sampleCount: 107,
      details: null,
    },
    {
      analysisId: analysis.id!,
      resultType: "GROUPED",
      metricCode: "MEAN_RETURN",
      dimension: { group: "Q10" },
      metricValue: -0.0004,
      sampleCount: 107,
      details: null,
    },
  ]);
  await repos.analyses.update(analysis.id!, {
    status: "COMPLETED",
    completedAt: "2026-09-11T00:00:30.000Z",
  });
  await repos.runs.update(run.id!, {
    status: "COMPLETED",
    completedAt: "2026-09-11T00:00:30.000Z",
    sampleCount: 214,
  });

  if (options.withConclusion !== false) {
    await repos.conclusions.create({
      experimentId: experiment.id!,
      hypothesisId: hypothesis.id!,
      conclusionType: "PARTIALLY_SUPPORTED",
      title: "首板换手率与未来5日收益",
      conclusion: "方向为负但未过统计门槛。",
      evidence:
        options.conclusionEvidence ??
        {
          disclaimer: "d",
          primaryAnalysis: { analysisId: analysis.id!, analysisType: "QUANTILE" },
          contributingAnalyses: [{ analysisId: analysis.id!, analysisType: "QUANTILE" }],
        },
      confidence: 0.58,
      status: "DRAFT",
    });
  }

  return { experiment, hypothesis, run, analysis };
}

describe("analysisIdsReferencedByConclusionEvidence", () => {
  it("提取当前形状（primaryAnalysis + contributingAnalyses）", () => {
    expect(
      analysisIdsReferencedByConclusionEvidence({
        primaryAnalysis: { analysisId: 7 },
        contributingAnalyses: [{ analysisId: 7 }, { analysisId: 9 }],
      }),
    ).toEqual([7, 9]);
  });

  it("兼容历史分支键 analyses（旧 evidence 形状）", () => {
    expect(analysisIdsReferencedByConclusionEvidence({ analyses: [{ analysisId: 3 }] })).toEqual([3]);
  });

  it("形状不认识 → 返回空数组（不猜，交由调用方按不可归属处理）", () => {
    expect(analysisIdsReferencedByConclusionEvidence(null)).toEqual([]);
    expect(analysisIdsReferencedByConclusionEvidence("nope")).toEqual([]);
    expect(analysisIdsReferencedByConclusionEvidence({ primaryAnalysis: { analysisId: "7" } })).toEqual([]);
    expect(analysisIdsReferencedByConclusionEvidence({ contributingAnalyses: [{ analysisId: -1 }] })).toEqual([]);
  });
});

describe("deleteRunCascade — 结论归属必须精确", () => {
  it("只删归属该 Run 的结论，另一个 Run 的结论保留", async () => {
    const repos = makeRepos();
    const first = await seedTree(repos);
    // 第二个 Run（独立分析 + 独立结论）
    const run2 = await repos.runs.create({
      experimentId: first.experiment.id!,
      runNo: await repos.runs.nextRunNo(first.experiment.id!),
      config: null,
    });
    const analysis2 = await repos.analyses.create({
      runId: run2.id!,
      analysisType: "DESCRIPTIVE",
      name: "描述统计",
      target: "future_return_5d",
      config: null,
    });
    await repos.conclusions.create({
      experimentId: first.experiment.id!,
      hypothesisId: first.hypothesis.id!,
      conclusionType: "INCONCLUSIVE",
      title: "第二条结论",
      conclusion: "样本不足以判断。",
      evidence: { primaryAnalysis: { analysisId: analysis2.id! }, contributingAnalyses: [] },
      confidence: null,
      status: "DRAFT",
    });

    const result = await deleteRunCascade(repos, first.run.id!);
    expect(result.counts.runs).toBe(1);
    expect(result.counts.analyses).toBe(1);
    expect(result.counts.conclusions).toBe(1);
    expect(result.unattributedConclusions).toBe(0);

    const left = await repos.conclusions.list({ experimentId: first.experiment.id! });
    expect(left.length).toBe(1);
    expect(left[0]!.title).toBe("第二条结论");
    expect(await repos.analyses.getById(first.analysis.id!)).toBeUndefined();
    expect(await repos.analyses.getById(analysis2.id!)).toBeDefined();
  });

  it("删 Run 会清掉它的条件 / 指标定义 / 结果行（孤儿为 0）", async () => {
    const repos = makeRepos();
    const { run, analysis } = await seedTree(repos);
    const result = await deleteRunCascade(repos, run.id!);
    expect(result.counts.conditions).toBe(1);
    expect(result.counts.metrics).toBe(1);
    expect(result.counts.results).toBe(2);
    expect(await repos.conditions.listByAnalysis(analysis.id!)).toEqual([]);
    expect(await repos.metrics.listByAnalysis(analysis.id!)).toEqual([]);
    expect(await repos.results.list({ analysisId: analysis.id! })).toEqual([]);
  });

  it("证据提不出 analysisId 的结论**不删**，并如实计入 unattributedConclusions", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seedTree(repos, {
      conclusionEvidence: { disclaimer: "旧形状没有 analysisId" },
    });
    await seedTree(repos); // 再建一棵，确保计数不受影响

    const result = await deleteRunCascade(repos, run.id!);
    expect(result.counts.conclusions).toBe(0);
    expect(result.unattributedConclusions).toBe(1);
    // 该结论仍在（宁可留下可核查的记录，也不猜着删）
    const left = await repos.conclusions.list({ experimentId: experiment.id! });
    expect(left.length).toBe(1);
  });

  it("Run 不存在 → RUN_NOT_FOUND", async () => {
    const repos = makeRepos();
    await expect(deleteRunCascade(repos, 999_999)).rejects.toBeInstanceOf(ResearchEngineError);
    await expect(deleteRunCascade(repos, 999_999)).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
  });

  it("RUNNING 的 Run → DELETE_CONFLICT（拒绝删飞行中的写入）", async () => {
    const repos = makeRepos();
    const { run } = await seedTree(repos);
    await repos.runs.update(run.id!, { status: "RUNNING" });
    await expect(deleteRunCascade(repos, run.id!)).rejects.toMatchObject({
      code: "DELETE_CONFLICT",
    });
  });
});

describe("deleteExperimentCascade — 整树无残留", () => {
  it("级联删除后各实体计数与仓储状态一致（无孤儿）", async () => {
    const repos = makeRepos();
    const { experiment, run, analysis } = await seedTree(repos);

    const counts = await deleteExperimentCascade(repos, experiment.id!);
    expect(counts).toMatchObject({
      experiments: 1,
      runs: 1,
      analyses: 1,
      hypotheses: 1,
      conclusions: 1,
      conditions: 1,
      metrics: 1,
      results: 2,
    });
    expect(await repos.experiments.getById(experiment.id!)).toBeUndefined();
    expect(await repos.runs.list({ experimentId: experiment.id! })).toEqual([]);
    expect(await repos.analyses.list({ runId: run.id! })).toEqual([]);
    expect(await repos.hypotheses.listByExperiment(experiment.id!)).toEqual([]);
    expect(await repos.conclusions.list({ experimentId: experiment.id! })).toEqual([]);
    expect(await repos.results.list({ analysisId: analysis.id! })).toEqual([]);
  });

  it("多 Run 实验：全部 Run 一并删除", async () => {
    const repos = makeRepos();
    const { experiment } = await seedTree(repos);
    await seedTree(repos); // 第二个实验（不应被波及）
    const run2 = await repos.runs.create({
      experimentId: experiment.id!,
      runNo: 2,
      config: null,
    });
    await repos.analyses.create({
      runId: run2.id!,
      analysisType: "STABILITY",
      name: "稳定性",
      target: "future_return_5d",
      config: null,
    });
    const counts = await deleteExperimentCascade(repos, experiment.id!);
    expect(counts.runs).toBe(2);
    expect(counts.analyses).toBe(2);
  });

  it("有 RUNNING 的 Run 时整体拒绝（不留半删状态）", async () => {
    const repos = makeRepos();
    const { experiment, run } = await seedTree(repos);
    await repos.runs.update(run.id!, { status: "RUNNING" });
    await expect(deleteExperimentCascade(repos, experiment.id!)).rejects.toMatchObject({
      code: "DELETE_CONFLICT",
    });
    // 拒绝后实验仍在（原子性：先守卫再动手）
    expect(await repos.experiments.getById(experiment.id!)).toBeDefined();
  });

  it("Experiment 不存在 → EXPERIMENT_NOT_FOUND", async () => {
    const repos = makeRepos();
    await expect(deleteExperimentCascade(repos, 999_999)).rejects.toMatchObject({
      code: "EXPERIMENT_NOT_FOUND",
    });
  });
});

describe("deleteAnalysisCascade / deleteHypothesisCascade", () => {
  it("删分析保留其 Run，但删掉证据指向它的结论", async () => {
    const repos = makeRepos();
    const { run, analysis, experiment } = await seedTree(repos);
    const counts = await deleteAnalysisCascade(repos, analysis.id!);
    expect(counts.analyses).toBe(1);
    expect(counts.runs).toBe(0);
    expect(counts.conclusions).toBe(1);
    expect(await repos.runs.getById(run.id!)).toBeDefined();
    expect(await repos.conclusions.list({ experimentId: experiment.id! })).toEqual([]);
  });

  it("删假设连带删它的结论（同实验其他假设的结论不动）", async () => {
    const repos = makeRepos();
    const { experiment, hypothesis } = await seedTree(repos);
    const other = await repos.hypotheses.create({
      experimentId: experiment.id!,
      name: "H2",
      statement: "另一条假设。",
    });
    await repos.conclusions.create({
      experimentId: experiment.id!,
      hypothesisId: other.id!,
      conclusionType: "INCONCLUSIVE",
      title: "H2 的结论",
      conclusion: "x",
      evidence: { primaryAnalysis: { analysisId: 1 } },
      confidence: null,
      status: "DRAFT",
    });

    const counts = await deleteHypothesisCascade(repos, hypothesis.id!);
    expect(counts.hypotheses).toBe(1);
    expect(counts.conclusions).toBe(1);
    const left = await repos.conclusions.list({ experimentId: experiment.id! });
    expect(left.length).toBe(1);
    expect(left[0]!.title).toBe("H2 的结论");
  });
});

describe("invalidateAnalysis — 改口径后旧产物必须失效", () => {
  it("清结果 + 删失效结论 + Analysis 与 Run 回退 PENDING", async () => {
    const repos = makeRepos();
    const { analysis, run, experiment } = await seedTree(repos);

    const result = await invalidateAnalysis(repos, analysis.id!);
    expect(result.deletedResults).toBe(2);
    expect(result.deletedConclusions).toBe(1);
    expect(result.runId).toBe(run.id!);
    expect(await repos.results.list({ analysisId: analysis.id! })).toEqual([]);
    expect(await repos.conclusions.list({ experimentId: experiment.id! })).toEqual([]);
    expect((await repos.analyses.getById(analysis.id!))!.status).toBe("PENDING");
    const reloadedRun = await repos.runs.getById(run.id!);
    expect(reloadedRun!.status).toBe("PENDING");
    expect(reloadedRun!.completedAt).toBeNull();
  });

  it("replaceConditionsAndInvalidate：先守卫 → 再替换 → 最后失效（顺序不可颠倒）", async () => {
    const repos = makeRepos();
    const { analysis } = await seedTree(repos);
    const { conditions, invalidation } = await replaceConditionsAndInvalidate(repos, analysis.id!, [
      { groupNo: 0, sortOrder: 0, fieldName: "board", operator: "==", value: "main" },
      { groupNo: 0, sortOrder: 1, fieldName: "turnover", operator: ">=", value: 5 },
    ]);
    expect(conditions.length).toBe(2);
    expect(conditions.map((c) => c.fieldName)).toEqual(["board", "turnover"]);
    // 未显式给 logicalOperator → 默认 AND（与 createAnalysis 语义一致）
    expect(conditions[0]!.logicalOperator).toBe("AND");
    expect(invalidation.deletedResults).toBe(2);
    expect(invalidation.deletedConclusions).toBe(1);
  });

  it("RUNNING 时拒绝替换条件，且**条件不被改写**（守卫在前）", async () => {
    const repos = makeRepos();
    const { analysis } = await seedTree(repos);
    await repos.analyses.update(analysis.id!, { status: "RUNNING" });
    await expect(
      replaceConditionsAndInvalidate(repos, analysis.id!, [
        { groupNo: 0, sortOrder: 0, fieldName: "board", operator: "==", value: "main" },
      ]),
    ).rejects.toMatchObject({ code: "DELETE_CONFLICT" });
    // 原条件未被改动 —— 否则会制造「条件变了、结果还是旧的」静默不实
    const unchanged = await repos.conditions.listByAnalysis(analysis.id!);
    expect(unchanged.length).toBe(1);
    expect(unchanged[0]!.fieldName).toBe("turnover");
  });

  it("分析不存在 → ANALYSIS_NOT_FOUND", async () => {
    const repos = makeRepos();
    await expect(invalidateAnalysis(repos, 999_999)).rejects.toMatchObject({
      code: "ANALYSIS_NOT_FOUND",
    });
  });
});

describe("describeDeletionCounts", () => {
  it("只列非零项；全零时给明确措辞（不假装删了什么）", () => {
    expect(
      describeDeletionCounts({
        experiments: 1,
        hypotheses: 0,
        runs: 2,
        analyses: 3,
        conditions: 0,
        metrics: 0,
        results: 0,
        conclusions: 0,
        candidates: 0,
        artifacts: 0,
      }),
    ).toBe("已删除 1 个实验 / 2 个Run / 3 个分析");
    expect(
      describeDeletionCounts({
        experiments: 0,
        hypotheses: 0,
        runs: 0,
        analyses: 0,
        conditions: 0,
        metrics: 0,
        results: 0,
        conclusions: 0,
        candidates: 0,
        artifacts: 0,
      }),
    ).toBe("未删除任何记录");
  });
});
