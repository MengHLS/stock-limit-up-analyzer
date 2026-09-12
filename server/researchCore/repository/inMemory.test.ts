/**
 * RESEARCH-001 — Repository 契约测试（内存替身）。
 *
 * 覆盖指令 §26 Phase F 要求的 10 类 CRUD，以及 §18 的关系查询与 §21 的引用完整性。
 * 关系链以指令 §25 的完整链路验证：
 *   DatasetVersion → Experiment → (Hypothesis | Run → Analysis → Result)
 *                 → Conclusion → StrategyCandidate →(软引用)→ StrategyDefinition
 */

import { describe, expect, it } from "vitest";
import { createInMemoryResearchRepositories } from "./inMemory";
import { RESEARCH_REFERENCE_ERROR, ResearchConflictError, ResearchReferenceError } from "./errors";
import type { ResearchRepositories } from "./contract";
import { groupedResults, scalarResult } from "../results";

/** 可注入的 Dataset Version 存在性（模拟 `dataset_version` 外部表）。 */
const KNOWN_DATASET_VERSION = 42;

function makeRepos(): ResearchRepositories {
  return createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === KNOWN_DATASET_VERSION,
    now: () => new Date("2026-09-10T12:00:00.000Z"),
  });
}

describe("Research Repository — Experiment CRUD", () => {
  it("create / getById / list / update / delete", async () => {
    const repos = makeRepos();
    const created = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "首板后换手率与 T+5 收益",
      description: "研究首板后换手率与 T+5 收益的关系",
      researchType: "CONDITIONAL",
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.status).toBe("DRAFT");
    expect(created.createdAt).toBe("2026-09-10T12:00:00.000Z");

    const fetched = await repos.experiments.getById(created.id as number);
    expect(fetched?.name).toBe("首板后换手率与 T+5 收益");

    const updated = await repos.experiments.update(created.id as number, { status: "READY" });
    expect(updated.status).toBe("READY");

    expect((await repos.experiments.list()).length).toBe(1);
    expect((await repos.experiments.list({ status: "READY" })).length).toBe(1);
    expect((await repos.experiments.list({ status: "DRAFT" })).length).toBe(0);
    expect((await repos.experiments.list({ datasetVersionId: KNOWN_DATASET_VERSION })).length).toBe(1);

    await repos.experiments.delete(created.id as number);
    expect(await repos.experiments.getById(created.id as number)).toBeUndefined();
  });

  it("dataset_version_id 必须存在（soft reference 的应用层保证）", async () => {
    const repos = makeRepos();
    await expect(
      repos.experiments.create({
        datasetVersionId: 999,
        name: "x",
        researchType: "FEATURE",
      }),
    ).rejects.toMatchObject({
      name: "ResearchReferenceError",
      code: RESEARCH_REFERENCE_ERROR.DATASET_VERSION_NOT_FOUND,
    });
  });

  it("实验创建后知道自己基于哪个 Dataset Version，且不可改（输入边界冻结）", async () => {
    const repos = makeRepos();
    const created = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "x",
      researchType: "FEATURE",
    });
    expect(created.datasetVersionId).toBe(KNOWN_DATASET_VERSION);
    // 更新补丁类型不含 datasetVersionId —— 运行时即使强塞也不应生效
    const updated = await repos.experiments.update(created.id as number, { name: "y" });
    expect(updated.datasetVersionId).toBe(KNOWN_DATASET_VERSION);
  });
});

describe("Research Repository — Hypothesis CRUD", () => {
  it("create / getById / listByExperiment / update / delete", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "HYPOTHESIS",
    });
    const h = await repos.hypotheses.create({
      experimentId: exp.id as number,
      name: "换手率区间优势",
      statement: "首板股票换手率 8%~15% 时，未来 5 日收益显著高于其他区间。",
      nullHypothesis: "换手率区间与 T+5 收益无关",
      alternativeHypothesis: "换手率区间与 T+5 收益相关",
    });
    expect(h.status).toBe("DRAFT");

    const updated = await repos.hypotheses.update(h.id as number, { status: "TESTING" });
    expect(updated.status).toBe("TESTING");

    expect((await repos.hypotheses.listByExperiment(exp.id as number)).length).toBe(1);
    expect((await repos.hypotheses.listByExperiment(999)).length).toBe(0);

    await repos.hypotheses.delete(h.id as number);
    expect(await repos.hypotheses.getById(h.id as number)).toBeUndefined();
  });

  it("引用不存在的 Experiment 被拒绝", async () => {
    const repos = makeRepos();
    await expect(
      repos.hypotheses.create({ experimentId: 777, name: "h", statement: "s" }),
    ).rejects.toBeInstanceOf(ResearchReferenceError);
  });
});

describe("Research Repository — Run CRUD", () => {
  it("create / getById / list / nextRunNo / update / delete", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "EVENT_STUDY",
    });
    expect(await repos.runs.nextRunNo(exp.id as number)).toBe(1);

    const r1 = await repos.runs.create({
      experimentId: exp.id as number,
      runNo: 1,
      inputSnapshot: { datasetVersionId: KNOWN_DATASET_VERSION, startDate: "2019-01-02" },
    });
    expect(r1.status).toBe("PENDING");
    expect(await repos.runs.nextRunNo(exp.id as number)).toBe(2);

    const r2 = await repos.runs.create({ experimentId: exp.id as number, runNo: 2, config: { dateRange: { startDate: "2025-01-01" } } });
    expect((await repos.runs.list({ experimentId: exp.id as number })).map((r) => r.runNo)).toEqual([1, 2]);

    const updated = await repos.runs.update(r2.id as number, {
      status: "COMPLETED",
      sampleCount: 512,
      completedAt: "2026-09-10T13:00:00.000Z",
    });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.sampleCount).toBe(512);
    expect((await repos.runs.list({ status: "COMPLETED" })).length).toBe(1);
    expect((await repos.runs.list({ status: "PENDING" })).length).toBe(1);

    await repos.runs.delete(r1.id as number);
    expect((await repos.runs.list({ experimentId: exp.id as number })).length).toBe(1);
  });

  it("(experimentId, runNo) 唯一 —— 重复 runNo 被拒绝", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "FEATURE",
    });
    await repos.runs.create({ experimentId: exp.id as number, runNo: 1 });
    await expect(repos.runs.create({ experimentId: exp.id as number, runNo: 1 })).rejects.toBeInstanceOf(
      ResearchConflictError,
    );
  });

  it("inputSnapshot 记录本次执行真正使用的配置", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "FEATURE",
    });
    const run = await repos.runs.create({
      experimentId: exp.id as number,
      runNo: 1,
      config: { excludeExtremeRegime: true },
      inputSnapshot: {
        datasetVersionId: KNOWN_DATASET_VERSION,
        datasetCode: "first_limit_pullback",
        startDate: "2019-01-02",
        endDate: "2025-12-31",
        snapshotAt: "2026-09-10T12:00:00.000Z",
      },
    });
    const snapshot = run.inputSnapshot as { datasetVersionId: number; excludeExtremeRegime?: boolean };
    expect(snapshot.datasetVersionId).toBe(KNOWN_DATASET_VERSION);
    expect((run.config as { excludeExtremeRegime?: boolean }).excludeExtremeRegime).toBe(true);
  });
});

describe("Research Repository — Analysis CRUD", () => {
  it("create / getById / list / update / delete", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    const { analysis } = chain;

    expect(analysis.status).toBe("PENDING");
    expect((await repos.analyses.list({ runId: chain.run.id as number })).length).toBe(1);
    expect((await repos.analyses.list({ analysisType: "QUANTILE" })).length).toBe(1);
    expect((await repos.analyses.list({ analysisType: "IC" })).length).toBe(0);

    const updated = await repos.analyses.update(analysis.id as number, {
      status: "COMPLETED",
      completedAt: "2026-09-10T14:00:00.000Z",
    });
    expect(updated.status).toBe("COMPLETED");

    await repos.analyses.delete(analysis.id as number);
    expect(await repos.analyses.getById(analysis.id as number)).toBeUndefined();
  });
});

describe("Research Repository — Condition CRUD", () => {
  it("replaceForAnalysis 整批写入并按组号 / 顺序读回", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    const analysisId = chain.analysis.id as number;

    const rows = await repos.conditions.replaceForAnalysis(analysisId, [
      { groupNo: 0, sortOrder: 0, fieldName: "market_strength", operator: ">", value: 0.6, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 0, sortOrder: 1, fieldName: "turnover", operator: ">=", value: 8, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 0, sortOrder: 2, fieldName: "turnover", operator: "<=", value: 15, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 1, sortOrder: 0, fieldName: "amount", operator: ">", value: 500_000_000, logicalOperator: "AND", groupLogicalOperator: "AND" },
    ]);
    expect(rows.length).toBe(4);
    expect(rows.map((r) => r.groupNo)).toEqual([0, 0, 0, 1]);

    const listed = await repos.conditions.listByAnalysis(analysisId);
    expect(listed.map((r) => r.fieldName)).toEqual(["market_strength", "turnover", "turnover", "amount"]);
    expect(listed[3].value).toBe(500_000_000);

    // 整批替换：旧条件被清除
    const replaced = await repos.conditions.replaceForAnalysis(analysisId, [
      { groupNo: 0, sortOrder: 0, fieldName: "win_rate", operator: ">", value: 0.5, logicalOperator: "AND", groupLogicalOperator: "AND" },
    ]);
    expect(replaced.length).toBe(1);
    expect((await repos.conditions.listByAnalysis(analysisId)).length).toBe(1);

    expect(await repos.conditions.deleteByAnalysis(analysisId)).toBe(1);
    expect((await repos.conditions.listByAnalysis(analysisId)).length).toBe(0);
  });

  it("非法条件被拒绝（不静默落库）", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    await expect(
      repos.conditions.replaceForAnalysis(chain.analysis.id as number, [
        { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: "BETWEEN", value: [15, 8], logicalOperator: "AND", groupLogicalOperator: "AND" },
      ]),
    ).rejects.toThrow(/下界 > 上界/);
  });

  it("引用不存在的 Analysis 被拒绝", async () => {
    const repos = makeRepos();
    await expect(repos.conditions.replaceForAnalysis(999, [])).rejects.toBeInstanceOf(ResearchReferenceError);
  });
});

describe("Research Repository — Metric CRUD", () => {
  it("create / getById / listByAnalysis / update / delete", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    const analysisId = chain.analysis.id as number;

    const m1 = await repos.metrics.create({ analysisId, metricCode: "MEAN_RETURN", metricName: "平均收益", displayOrder: 1 });
    const m2 = await repos.metrics.create({ analysisId, metricCode: "WIN_RATE", metricName: "胜率", displayOrder: 2 });
    expect(m1.createdAt).toBe("2026-09-10T12:00:00.000Z");

    const listed = await repos.metrics.listByAnalysis(analysisId);
    expect(listed.map((m) => m.metricCode)).toEqual(["MEAN_RETURN", "WIN_RATE"]);

    const updated = await repos.metrics.update(m2.id as number, { displayOrder: 0 });
    expect(updated.displayOrder).toBe(0);
    expect((await repos.metrics.listByAnalysis(analysisId))[0].metricCode).toBe("WIN_RATE");

    await repos.metrics.delete(m1.id as number);
    expect((await repos.metrics.listByAnalysis(analysisId)).length).toBe(1);
  });

  it("(analysisId, metricCode) 唯一 —— 重复定义被拒绝", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    const analysisId = chain.analysis.id as number;
    await repos.metrics.create({ analysisId, metricCode: "IC", metricName: "IC", displayOrder: 0 });
    await expect(
      repos.metrics.create({ analysisId, metricCode: "IC", metricName: "IC dup", displayOrder: 1 }),
    ).rejects.toBeInstanceOf(ResearchConflictError);
  });
});

describe("Research Repository — Result CRUD", () => {
  it("createMany：单值 + 分组结果，结构化字段可查", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    const analysisId = chain.analysis.id as number;

    const rows = await repos.results.createMany([
      scalarResult({ analysisId, metricCode: "MEAN_RETURN", metricValue: 0.0283, sampleCount: 120 }),
      ...groupedResults({
        analysisId,
        metricCode: "MEAN_RETURN",
        dimensionKey: "quantile",
        groups: [
          { label: 1, metricValue: 0.012, sampleCount: 50 },
          { label: 10, metricValue: 0.056, sampleCount: 48 },
        ],
      }),
    ]);
    expect(rows.length).toBe(3);
    expect(rows[0].resultType).toBe("SCALAR");
    expect(rows[1].dimension).toEqual({ quantile: 1 });

    const byMetric = await repos.results.list({ analysisId, metricCode: "MEAN_RETURN" });
    expect(byMetric.length).toBe(3);
    const grouped = await repos.results.list({ analysisId, resultType: "GROUPED" });
    expect(grouped.length).toBe(2);
    expect(grouped[1].metricValue).toBeCloseTo(0.056, 6);

    expect(await repos.results.deleteByAnalysis(analysisId)).toBe(3);
    expect((await repos.results.list({ analysisId })).length).toBe(0);
  });

  it("非法结果被拒绝（NaN 不入库）", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    await expect(
      repos.results.createMany([
        scalarResult({ analysisId: chain.analysis.id as number, metricCode: "IC", metricValue: NaN }),
      ]),
    ).rejects.toThrow(/有限数值/);
  });

  it("引用不存在的 Analysis 被拒绝", async () => {
    const repos = makeRepos();
    await expect(
      repos.results.createMany([scalarResult({ analysisId: 888, metricCode: "IC", metricValue: 0.1 })]),
    ).rejects.toBeInstanceOf(ResearchReferenceError);
  });
});

describe("Research Repository — Conclusion CRUD", () => {
  it("create / getById / list / update / delete（可关联 Hypothesis）", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "CONDITIONAL",
    });
    const h = await repos.hypotheses.create({ experimentId: exp.id as number, name: "h", statement: "s" });

    const c = await repos.conclusions.create({
      experimentId: exp.id as number,
      hypothesisId: h.id as number,
      conclusionType: "SUPPORTED",
      title: "换手率 8~15% 存在优势",
      conclusion: "首板股票换手率 8%~15% 时，未来 5 日收益存在显著优势。",
      evidence: [
        { kind: "QUANTILE", analysisId: 1, metricCode: "MEAN_RETURN", direction: "POSITIVE" },
        { kind: "YEAR_CONSISTENCY", years: [2022, 2023, 2024], consistent: true },
      ],
      confidence: 0.72,
    });
    expect(c.status).toBe("DRAFT");
    expect(c.confidence).toBe(0.72);

    expect((await repos.conclusions.list({ experimentId: exp.id as number })).length).toBe(1);
    expect((await repos.conclusions.list({ hypothesisId: h.id as number })).length).toBe(1);

    const updated = await repos.conclusions.update(c.id as number, { status: "FINAL", confidence: 0.8 });
    expect(updated.status).toBe("FINAL");
    expect(updated.confidence).toBe(0.8);

    await repos.conclusions.delete(c.id as number);
    expect(await repos.conclusions.getById(c.id as number)).toBeUndefined();
  });

  it("Conclusion 不能只有一段文字：必须关联 Experiment", async () => {
    const repos = makeRepos();
    await expect(
      repos.conclusions.create({
        experimentId: 555,
        conclusionType: "INCONCLUSIVE",
        title: "t",
        conclusion: "only text",
      }),
    ).rejects.toMatchObject({ code: RESEARCH_REFERENCE_ERROR.EXPERIMENT_NOT_FOUND });
  });

  it("关联不存在的 Hypothesis 被拒绝", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "FEATURE",
    });
    await expect(
      repos.conclusions.create({
        experimentId: exp.id as number,
        hypothesisId: 4242,
        conclusionType: "REJECTED",
        title: "t",
        conclusion: "c",
      }),
    ).rejects.toMatchObject({ code: RESEARCH_REFERENCE_ERROR.HYPOTHESIS_NOT_FOUND });
  });
});

describe("Research Repository — StrategyCandidate CRUD", () => {
  it("create（strategyDefinitionId = null 合法）→ REVIEW → ACCEPTED → CONVERTED", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "CONDITIONAL",
    });
    const c = await repos.conclusions.create({
      experimentId: exp.id as number,
      conclusionType: "SUPPORTED",
      title: "t",
      conclusion: "c",
    });

    const cand = await repos.candidates.create({
      experimentId: exp.id as number,
      conclusionId: c.id as number,
      strategyDefinitionId: null,
      name: "首板换手率 8~15% T+5",
      description: "desc",
      entryRule: { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" },
      exitRule: { holdingDays: 5 },
      parameterSpace: { turnoverLow: { type: "number", min: 5, max: 12, step: 1 } },
    });
    expect(cand.status).toBe("DRAFT");
    expect(cand.strategyDefinitionId).toBeNull();

    expect((await repos.candidates.update(cand.id as number, { status: "REVIEW" })).status).toBe("REVIEW");
    expect((await repos.candidates.update(cand.id as number, { status: "ACCEPTED" })).status).toBe("ACCEPTED");

    const converted = await repos.candidates.update(cand.id as number, {
      status: "CONVERTED",
      strategyDefinitionId: "limit-up-baseline",
    });
    expect(converted.status).toBe("CONVERTED");
    expect(converted.strategyDefinitionId).toBe("limit-up-baseline");

    expect(
      (await repos.candidates.list({ strategyDefinitionId: "limit-up-baseline" })).length,
    ).toBe(1);
    expect((await repos.candidates.list({ experimentId: exp.id as number })).length).toBe(1);
    expect((await repos.candidates.list({ conclusionId: c.id as number })).length).toBe(1);

    await repos.candidates.delete(cand.id as number);
    expect((await repos.candidates.list()).length).toBe(0);
  });

  it("非法状态迁移被拒绝（DRAFT → CONVERTED 需经 REVIEW/ACCEPTED）", async () => {
    const repos = makeRepos();
    const cand = await buildDraftCandidate(repos);
    await expect(
      repos.candidates.update(cand.id as number, {
        status: "CONVERTED",
        strategyDefinitionId: "x",
      }),
    ).rejects.toThrow(/非法候选状态迁移/);
  });

  it("CONVERTED 但无 strategyDefinitionId 被拒绝", async () => {
    const repos = makeRepos();
    const cand = await buildDraftCandidate(repos);
    await repos.candidates.update(cand.id as number, { status: "REVIEW" });
    await repos.candidates.update(cand.id as number, { status: "ACCEPTED" });
    await expect(repos.candidates.update(cand.id as number, { status: "CONVERTED" })).rejects.toThrow(
      /必须提供 strategyDefinitionId/,
    );
  });

  it("引用不存在的 Conclusion 被拒绝", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "FEATURE",
    });
    await expect(
      repos.candidates.create({
        experimentId: exp.id as number,
        conclusionId: 31337,
        name: "c",
      }),
    ).rejects.toMatchObject({ code: RESEARCH_REFERENCE_ERROR.CONCLUSION_NOT_FOUND });
  });
});

describe("Research Repository — Artifact CRUD", () => {
  it("create（挂 Experiment）/ list / delete", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "FEATURE",
    });
    const a = await repos.artifacts.create({
      experimentId: exp.id as number,
      artifactType: "REPORT",
      uri: "file:///reports/research-001.md",
      checksum: "a".repeat(64),
      metadata: { bytes: 2048, format: "md" },
    });
    expect(a.storageType).toBe("FILE");
    expect(a.checksum).toHaveLength(64);

    expect((await repos.artifacts.list({ experimentId: exp.id as number })).length).toBe(1);
    expect((await repos.artifacts.list({ artifactType: "REPORT" })).length).toBe(1);
    expect((await repos.artifacts.list({ artifactType: "CHART" })).length).toBe(0);

    await repos.artifacts.delete(a.id as number);
    expect(await repos.artifacts.getById(a.id as number)).toBeUndefined();
  });

  it("create（挂 Run）", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    const a = await repos.artifacts.create({
      runId: chain.run.id as number,
      artifactType: "DATA",
      storageType: "S3",
      uri: "s3://bucket/results/run-1.parquet",
    });
    expect(a.experimentId).toBeNull();
    expect((await repos.artifacts.list({ runId: chain.run.id as number })).length).toBe(1);
  });

  it("既无 experimentId 也无 runId 被拒绝", async () => {
    const repos = makeRepos();
    await expect(
      repos.artifacts.create({ artifactType: "OTHER", uri: "http://x" }),
    ).rejects.toMatchObject({ code: RESEARCH_REFERENCE_ERROR.ARTIFACT_SCOPE_REQUIRED });
  });
});

describe("Research Repository — 关系查询（指令 §18）", () => {
  it("getExperimentWithRuns", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "FEATURE",
    });
    await repos.runs.create({ experimentId: exp.id as number, runNo: 1 });
    await repos.runs.create({ experimentId: exp.id as number, runNo: 2 });

    const withRuns = await repos.relationships.getExperimentWithRuns(exp.id as number);
    expect(withRuns?.experiment.id).toBe(exp.id);
    expect(withRuns?.runs.map((r) => r.runNo)).toEqual([1, 2]);
    expect(await repos.relationships.getExperimentWithRuns(9999)).toBeUndefined();
  });

  it("getRunWithAnalyses", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    const bundle = await repos.relationships.getRunWithAnalyses(chain.run.id as number);
    expect(bundle?.run.id).toBe(chain.run.id);
    expect(bundle?.analyses.length).toBe(1);
    expect(await repos.relationships.getRunWithAnalyses(9999)).toBeUndefined();
  });

  it("getAnalysisBundle 一次取全 conditions / metrics / results", async () => {
    const repos = makeRepos();
    const chain = await buildAnalysisChain(repos);
    const analysisId = chain.analysis.id as number;
    await repos.conditions.replaceForAnalysis(analysisId, [
      { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 8, logicalOperator: "AND", groupLogicalOperator: "AND" },
    ]);
    await repos.metrics.create({ analysisId, metricCode: "MEAN_RETURN", metricName: "平均收益", displayOrder: 0 });
    await repos.results.createMany([scalarResult({ analysisId, metricCode: "MEAN_RETURN", metricValue: 0.0283, sampleCount: 120 })]);

    const bundle = await repos.relationships.getAnalysisBundle(analysisId);
    expect(bundle?.conditions.length).toBe(1);
    expect(bundle?.metrics.length).toBe(1);
    expect(bundle?.results.length).toBe(1);
    expect(bundle?.results[0].metricValue).toBeCloseTo(0.0283, 6);
    expect(await repos.relationships.getAnalysisBundle(9999)).toBeUndefined();
  });

  it("getExperimentConclusions / getHypothesisConclusions / getCandidatesByExperiment", async () => {
    const repos = makeRepos();
    const exp = await repos.experiments.create({
      datasetVersionId: KNOWN_DATASET_VERSION,
      name: "e",
      researchType: "CONDITIONAL",
    });
    const h1 = await repos.hypotheses.create({ experimentId: exp.id as number, name: "h1", statement: "s" });
    await repos.hypotheses.create({ experimentId: exp.id as number, name: "h2", statement: "s" });
    await repos.conclusions.create({
      experimentId: exp.id as number,
      hypothesisId: h1.id as number,
      conclusionType: "SUPPORTED",
      title: "t1",
      conclusion: "c1",
    });
    await repos.conclusions.create({
      experimentId: exp.id as number,
      conclusionType: "INCONCLUSIVE",
      title: "t2",
      conclusion: "c2",
    });
    const c1 = (await repos.conclusions.list({ hypothesisId: h1.id as number }))[0];
    await repos.candidates.create({
      experimentId: exp.id as number,
      conclusionId: c1.id as number,
      name: "cand",
    });

    expect((await repos.relationships.getExperimentConclusions(exp.id as number)).length).toBe(2);
    expect((await repos.relationships.getHypothesisConclusions(h1.id as number)).length).toBe(1);
    expect((await repos.relationships.getCandidatesByExperiment(exp.id as number)).length).toBe(1);
  });
});

describe("Research Repository — 指令 §25 完整领域链路", () => {
  it("DatasetVersion → Experiment → Run → Analysis → Result / Conclusion → Candidate → Strategy(软引用)", async () => {
    const repos = makeRepos();

    // 1. Dataset Version（外部表，注入校验）
    const DATASET_VERSION_ID = KNOWN_DATASET_VERSION;

    // 2. Experiment 基于该 Dataset Version
    const exp = await repos.experiments.create({
      datasetVersionId: DATASET_VERSION_ID,
      name: "首板后换手率与 T+5 收益",
      researchType: "CONDITIONAL",
      status: "READY",
    });

    // 3. Hypothesis
    const h = await repos.hypotheses.create({
      experimentId: exp.id as number,
      name: "换手率区间优势",
      statement: "首板股票换手率 8%~15% 时，未来 5 日收益显著高于其他区间。",
    });

    // 4. Run
    const run = await repos.runs.create({
      experimentId: exp.id as number,
      runNo: await repos.runs.nextRunNo(exp.id as number),
      status: "RUNNING",
      inputSnapshot: { datasetVersionId: DATASET_VERSION_ID, startDate: "2019-01-02" },
    });
    await repos.experiments.update(exp.id as number, { status: "RUNNING", startedAt: "2026-09-10T12:00:00.000Z" });
    await repos.runs.update(run.id as number, { status: "COMPLETED", sampleCount: 512 });

    // 5. Analysis + Condition + Metric
    const analysis = await repos.analyses.create({
      runId: run.id as number,
      analysisType: "QUANTILE",
      name: "换手率分位收益",
      target: "return_5d",
      status: "COMPLETED",
    });
    await repos.conditions.replaceForAnalysis(analysis.id as number, [
      { groupNo: 0, sortOrder: 0, fieldName: "market_strength", operator: ">", value: 0.6, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 0, sortOrder: 1, fieldName: "turnover", operator: ">=", value: 8, logicalOperator: "AND", groupLogicalOperator: "AND" },
      { groupNo: 0, sortOrder: 2, fieldName: "turnover", operator: "<=", value: 15, logicalOperator: "AND", groupLogicalOperator: "AND" },
    ]);
    await repos.metrics.create({
      analysisId: analysis.id as number,
      metricCode: "MEAN_RETURN",
      metricName: "平均收益",
      displayOrder: 0,
    });

    // 6. Result
    await repos.results.createMany(
      groupedResults({
        analysisId: analysis.id as number,
        metricCode: "MEAN_RETURN",
        dimensionKey: "quantile",
        groups: [
          { label: 1, metricValue: 0.012 },
          { label: 4, metricValue: 0.041 },
          { label: 5, metricValue: 0.038 },
          { label: 6, metricValue: 0.045 },
          { label: 10, metricValue: 0.056 },
        ],
      }),
    );

    // 7. Conclusion（带证据 + 关联 Hypothesis）
    const conclusion = await repos.conclusions.create({
      experimentId: exp.id as number,
      hypothesisId: h.id as number,
      conclusionType: "SUPPORTED",
      title: "换手率 8~15% 存在优势",
      conclusion: "首板股票换手率 8%~15% 时，未来 5 日收益存在显著优势。",
      evidence: [
        { kind: "QUANTILE", quantiles: [4, 5, 6], direction: "POSITIVE" },
        { kind: "YEAR_CONSISTENCY", consistent: true },
        { kind: "REGIME", strongMarket: "ENHANCED", weakMarket: "WEAKENED" },
      ],
      confidence: 0.72,
      status: "FINAL",
    });
    await repos.hypotheses.update(h.id as number, { status: "SUPPORTED" });
    await repos.experiments.update(exp.id as number, {
      status: "COMPLETED",
      completedAt: "2026-09-10T15:00:00.000Z",
      sampleCount: 512,
    });

    // 8. Candidate（尚未转正）
    const candidate = await repos.candidates.create({
      experimentId: exp.id as number,
      conclusionId: conclusion.id as number,
      name: "首板换手率 8~15% T+5",
      entryRule: { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" },
      filterRule: {
        groups: [
          {
            groupNo: 0,
            groupLogicalOperator: "AND",
            conditions: [
              { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: "BETWEEN", value: [8, 15], logicalOperator: "AND", groupLogicalOperator: "AND" },
            ],
          },
        ],
      },
      exitRule: { holdingDays: 5 },
      parameterSpace: { turnoverLow: { type: "number", min: 5, max: 12, step: 1 } },
    });
    expect(candidate.strategyDefinitionId).toBeNull();

    // 9. 转正（软引用正式 Strategy）
    await repos.candidates.update(candidate.id as number, { status: "REVIEW" });
    await repos.candidates.update(candidate.id as number, { status: "ACCEPTED" });
    const converted = await repos.candidates.update(candidate.id as number, {
      status: "CONVERTED",
      strategyDefinitionId: "limit-up-baseline",
    });

    // 全链路断言
    const withRuns = await repos.relationships.getExperimentWithRuns(exp.id as number);
    expect(withRuns?.runs.length).toBe(1);

    const bundle = await repos.relationships.getAnalysisBundle(analysis.id as number);
    expect(bundle?.conditions.length).toBe(3);
    expect(bundle?.metrics.length).toBe(1);
    expect(bundle?.results.length).toBe(5);

    expect((await repos.relationships.getExperimentConclusions(exp.id as number))[0].conclusionType).toBe("SUPPORTED");
    expect((await repos.relationships.getCandidatesByExperiment(exp.id as number))[0].id).toBe(candidate.id);
    expect(converted.strategyDefinitionId).toBe("limit-up-baseline");

    // 最终 Experiment 状态
    const finalExp = await repos.experiments.getById(exp.id as number);
    expect(finalExp?.status).toBe("COMPLETED");
    expect(finalExp?.datasetVersionId).toBe(DATASET_VERSION_ID);
  });
});

// ---------------------------------------------------------------------------
// RESEARCH-002C — 分析模板（头 + 明细两表）
// ---------------------------------------------------------------------------

describe("Research Repository — 分析模板（RESEARCH-002C）", () => {
  function item(name: string, sortOrder: number) {
    return {
      sortOrder,
      analysisType: "QUANTILE" as const,
      name,
      target: "future_return_5d",
      config: { featureField: "turnover", quantileGroups: 10 },
      conditionsJson: null,
    };
  }

  it("create 写头 + 明细，明细按 sortOrder 排序并可读回", async () => {
    const repos = makeRepos();
    const created = await repos.templates.create({
      name: "标准换手套件",
      description: "跨实验复用",
      sourceExperimentId: 7,
      items: [item("T+10", 1), item("T+5", 0)],
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe("标准换手套件");
    expect(created.sourceExperimentId).toBe(7);
    expect(created.createdAt).toBe("2026-09-10T12:00:00.000Z");
    expect(created.items.map((i) => i.name)).toEqual(["T+5", "T+10"]);

    const fetched = await repos.templates.getById(created.id as number);
    expect(fetched?.items.map((i) => i.sortOrder)).toEqual([0, 1]);
  });

  it("CONDITIONAL 模板项的条件以 JSON 快照往返（展开落库时才转关系表）", async () => {
    const repos = makeRepos();
    const conditions = [
      { groupNo: 0, sortOrder: 0, fieldName: "turnover", operator: ">=", value: 2 },
      { groupNo: 1, sortOrder: 0, fieldName: "volumeRatio", operator: "<", value: 3 },
    ];
    const created = await repos.templates.create({
      name: "条件套件",
      items: [
        {
          sortOrder: 0,
          analysisType: "CONDITIONAL",
          name: "首板高换手",
          target: "future_return_5d",
          config: { targetField: "future_return_5d" },
          conditionsJson: conditions,
        },
      ],
    });

    conditions[0]!.value = 999; // 改写传入的数组
    const fetched = await repos.templates.getById(created.id as number);
    const roundTripped = fetched?.items[0]!.conditionsJson as typeof conditions;
    expect(roundTripped).toHaveLength(2);
    expect(roundTripped[0]!.value).toBe(2);
    expect(roundTripped[1]!.groupNo).toBe(1);
  });

  it("名字 trim 后入库；重名 → ResearchConflictError（唯一约束兜底）", async () => {
    const repos = makeRepos();
    await repos.templates.create({ name: "  同名  ", items: [item("a", 0)] });
    expect((await repos.templates.getByName("同名"))?.name).toBe("同名");

    await expect(
      repos.templates.create({ name: "同名", items: [item("b", 0)] }),
    ).rejects.toBeInstanceOf(ResearchConflictError);
    // 失败不得留下半成品头
    expect(await repos.templates.list()).toHaveLength(1);
  });

  it("list：空库返回 []，非空按 name 排序（模板少，不分页）", async () => {
    const repos = makeRepos();
    expect(await repos.templates.list()).toEqual([]);

    await repos.templates.create({ name: "乙", items: [item("a", 0)] });
    await repos.templates.create({ name: "甲", items: [item("b", 0)] });
    expect((await repos.templates.list()).map((t) => t.name)).toEqual(["甲", "乙"]);
  });

  it("delete 显式先删明细（零 FK，不依赖级联）", async () => {
    const repos = makeRepos();
    const created = await repos.templates.create({ name: "待删", items: [item("a", 0), item("b", 1)] });
    await repos.templates.delete(created.id as number);

    expect(await repos.templates.getById(created.id as number)).toBeUndefined();
    // 明细已随头清掉：复用同名可再建，且新模板不继承旧明细
    const again = await repos.templates.create({ name: "待删", items: [item("c", 0)] });
    expect(again.items).toHaveLength(1);
    expect(again.items[0]!.name).toBe("c");
  });

  it("config / conditionsJson 深拷贝：外部持引用改不动内部状态", async () => {
    const repos = makeRepos();
    const config = { featureField: "turnover", quantileGroups: 10 };
    const created = await repos.templates.create({
      name: "深拷贝",
      items: [{ analysisType: "QUANTILE", name: "a", target: null, config, conditionsJson: null }],
    });

    config.quantileGroups = 99; // 改写传入对象
    const fetched = await repos.templates.getById(created.id as number);
    expect((fetched?.items[0]!.config as { quantileGroups: number }).quantileGroups).toBe(10);

    (fetched!.items[0]!.config as { quantileGroups: number }).quantileGroups = 123; // 改写读出的对象
    const reread = await repos.templates.getById(created.id as number);
    expect((reread?.items[0]!.config as { quantileGroups: number }).quantileGroups).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

async function buildAnalysisChain(repos: ResearchRepositories) {
  const exp = await repos.experiments.create({
    datasetVersionId: KNOWN_DATASET_VERSION,
    name: "e",
    researchType: "CONDITIONAL",
  });
  const run = await repos.runs.create({ experimentId: exp.id as number, runNo: 1 });
  const analysis = await repos.analyses.create({
    runId: run.id as number,
    analysisType: "QUANTILE",
    name: "a",
  });
  return { exp, run, analysis };
}

async function buildDraftCandidate(repos: ResearchRepositories) {
  const exp = await repos.experiments.create({
    datasetVersionId: KNOWN_DATASET_VERSION,
    name: "e",
    researchType: "FEATURE",
  });
  return repos.candidates.create({ experimentId: exp.id as number, name: "cand" });
}
