/**
 * PHASE-A-001 — Research Report 生成器 / 落库服务测试。
 *
 * 覆盖任务书里**可机械验证**的几条硬约束：
 *   1. 纯投影：同输入 ⇒ 同正文 ⇒ 同 checksum（正文里不含任何时钟读数）；
 *   2. 原样引用：`research_result` 的数值在正文里**逐字**出现，不被四舍五入或改名；
 *   3. 幂等：同 Run 重复生成 ⇒ `REUSED`，`research_artifact` 行数不增加（A-2）；
 *   4. 唯一性：结果变化后重生成 ⇒ Supersede 旧产物，仍只有 1 份 REPORT（A-1）；
 *   5. 时机纪律：Run 未 COMPLETED ⇒ 拒绝产出最终报告；
 *   6. 溯源纪律：取不到的字段如实置空 + 记入 `unresolvedTraceFields`，不伪造（A-3）；
 *   7. 不用「实验下最新结论」冒充本 Run 的结论。
 *
 * 测试替身说明：仓储一律用 `createInMemoryResearchRepositories`（与真实仓储同一契约），
 * Dataset 读取器只实现 `getVersionContext`（报告只消费版本元数据，**不读行情**，这正是我们要断言的边界）。
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInMemoryResearchRepositories, type ResearchRepositories } from "../../../server/researchCore";
import type { ResearchDatasetReader } from "../../../server/researchEngine/datasetReader";
import { buildResearchReport } from "../../../server/researchEngine/report/generator";
import { generateResearchReport } from "../../../server/researchEngine/report/service";
import {
  REPORT_ARTIFACT_TYPE,
  REPORT_GENERATOR_VERSION,
  REPORT_STORAGE_TYPE,
  buildReportUri,
  type ResearchReportSource,
} from "../../../server/researchEngine/report/types";

const DATASET_VERSION_ID = 900001;
const GENERATED_AT = "2026-09-19T12:00:00.000Z";

/** 刻意选一个「看起来像被四舍五入过」的长尾小数：正文必须逐字包含它。 */
const RAW_MEAN_RETURN = 0.012300000000000123;

const VERSION_CONTEXT = {
  datasetVersionId: DATASET_VERSION_ID,
  datasetId: 800001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回封观察集",
  versionLabel: "v1",
  status: "READY",
  startDate: "2024-01-01",
  endDate: "2025-06-30",
  totalEvents: 23978,
  horizons: [1, 3, 5, 10],
  pathRelativeDayRange: { min: -10, max: 30 },
  postRelativeDayRange: { min: 1, max: 20 },
};

function makeRepos(): ResearchRepositories {
  return createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === DATASET_VERSION_ID,
    now: () => new Date(GENERATED_AT),
  });
}

function makeReader(): ResearchDatasetReader {
  const unsupported = async (): Promise<never> => {
    throw new Error("报告只消费 Dataset 元数据，不应读取行情 —— 本测试断言该边界");
  };
  return {
    getVersionContext: async (id) => (id === DATASET_VERSION_ID ? VERSION_CONTEXT : null),
    loadEventPage: unsupported,
    loadOutcomes: unsupported,
    loadPaths: unsupported,
    loadPrefixBars: unsupported,
    loadPostBars: unsupported,
  };
}

interface SeededRun {
  experimentId: number;
  runId: number;
  analysisIds: number[];
  findingId: number;
  /** 刻意让结论的 `evidence.primaryAnalysis.analysisId` 指向**另一个 Run** 的分析。 */
  foreignConclusion?: boolean;
}

async function seed(
  repos: ResearchRepositories,
  options: { runStatus?: string; attachConclusionToForeignRun?: boolean; withFinding?: boolean } = {},
): Promise<SeededRun> {
  const experiment = await repos.experiments.create({
    datasetVersionId: DATASET_VERSION_ID,
    name: "首板后回踩深度是否影响后续收益",
    researchType: "QUANTILE",
    status: "COMPLETED",
  });
  const run = await repos.runs.create({
    experimentId: experiment.id!,
    runNo: 1,
    status: (options.runStatus ?? "COMPLETED") as never,
    sampleCount: 42,
  });
  await repos.runs.update(run.id!, {
    inputSnapshot: {
      datasetVersionId: DATASET_VERSION_ID,
      datasetCode: VERSION_CONTEXT.datasetCode,
      datasetVersionLabel: VERSION_CONTEXT.versionLabel,
      snapshotAt: GENERATED_AT,
    },
  });

  const analysisA = await repos.analyses.create({
    runId: run.id!,
    analysisType: "CONDITIONAL" as never,
    name: "回踩深度分桶",
    target: "future_return_5d",
    config: { featureField: "pullback_depth", buckets: 3 },
    moduleKey: "PULLBACK_EFFECTIVENESS",
    status: "COMPLETED" as never,
  });
  const analysisB = await repos.analyses.create({
    runId: run.id!,
    analysisType: "DESCRIPTIVE" as never,
    name: "样本描述",
    target: "future_return_5d",
    config: { metrics: ["MEAN", "MEDIAN"] },
    moduleKey: "EVENT_RETURN_RESEARCH",
    status: "COMPLETED" as never,
  });

  const results = await repos.results.createMany([
    {
      analysisId: analysisA.id!,
      resultType: "SCALAR",
      metricCode: "MEAN_RETURN",
      metricValue: RAW_MEAN_RETURN,
      sampleCount: 42,
    },
    {
      analysisId: analysisA.id!,
      resultType: "GROUPED",
      metricCode: "MEAN_RETURN",
      metricValue: 0.02,
      sampleCount: 14,
      dimension: { bucket: "3%~5%" },
    },
  ]);

  let findingId = 0;
  if (options.withFinding !== false) {
    const finding = await repos.findings.create({
      experimentId: experiment.id!,
      runId: run.id!,
      primaryAnalysisId: analysisA.id!,
      findingType: "EFFECT" as never,
      title: "回踩 3%~5% 档的后续收益高于基准",
      summary: "该档 groupReturn 高于实验基准，样本量中等。",
      target: "future_return_5d",
      dimension: { feature: "pullback_depth", bucket: "3%~5%", horizon: 5 },
      sourceResultIds: [results[0]!.id!],
      effect: {
        groupReturn: 0.0212,
        benchmarkReturn: 0.0088,
        excessReturn: 0.0124,
        benchmarkUnavailable: false,
        benchmarkSource: "experiment-baseline:analysis=2",
        medianReturn: 0.017,
        winRate: 0.58,
        buckets: [{ label: "3%~5%", metricValue: 0.0212, sampleCount: 14 }],
      },
      sample: { sampleCount: 42, grade: "MEDIUM" as never, thresholds: { weak: 10, medium: 30, strong: 100 } },
      limitations: ["样本时间集中在 2024 年"],
      researchStrength: 0.62,
      researchStrengthGrade: "MEDIUM" as never,
    });
    findingId = finding.id!;
  }

  // 结论：`evidence.primaryAnalysis.analysisId` = 主分析 id（唯一允许的归属路径）。
  let conclusionAnalysisId = analysisA.id!;
  if (options.attachConclusionToForeignRun === true) {
    const otherRun = await repos.runs.create({
      experimentId: experiment.id!,
      runNo: 2,
      status: "COMPLETED" as never,
    });
    const otherAnalysis = await repos.analyses.create({
      runId: otherRun.id!,
      analysisType: "DESCRIPTIVE" as never,
      name: "另一个 Run 的分析",
      status: "COMPLETED" as never,
    });
    conclusionAnalysisId = otherAnalysis.id!;
  }
  await repos.conclusions.create({
    experimentId: experiment.id!,
    conclusionType: "SUPPORTED" as never,
    title: "回踩深度存在系统性差异",
    conclusion: "在给定口径下观察到回踩档位间的收益差异，需经回测与 OOS 验证后才可成立。",
    evidence: {
      disclaimer: "⚠️ 自动结论仅为**研究辅助**，不等同于统计显著性或交易有效性。",
      policy: {
        alpha: 0.05,
        materialityAbs: 0.005,
        minSampleCount: 30,
        stabilityMinConsistentRatio: 0.6,
        strongSampleMultiple: 2,
      },
      hypothesisId: null,
      hypothesisStatement: "(未登记假设陈述)",
      researchQuestion: "回踩深度是否影响后续收益？",
      primaryAnalysis: {
        analysisId: conclusionAnalysisId,
        analysisType: "CONDITIONAL",
        effectLabel: "MEAN_RETURN",
        effect: 0.02,
        pValue: 0.01,
        tStat: 2.4,
        sampleCount: 42,
      },
      primarySelectionRule: "按固定优先级选择主分析（不按效应大小挑选）",
      contributingAnalyses: [
        {
          analysisId: analysisA.id!,
          analysisType: "CONDITIONAL",
          effect: 0.02,
          effectLabel: "MEAN_RETURN",
          pValue: 0.01,
          sampleCount: 42,
        },
      ],
      ruleTrace: [{ rule: "sample-count", passed: true, detail: "总样本 42（门槛 30）" }],
    },
    confidence: 0.6,
    findingIds: options.withFinding === false ? [] : [findingId],
    limitations: ["样本量偏低，稳定性仅覆盖一年"],
    nextQuestions: ["加入换手率后差异是否仍然存在？"],
    status: "DRAFT" as never,
  });

  return { experimentId: experiment.id!, runId: run.id!, analysisIds: [analysisA.id!, analysisB.id!], findingId };
}

function depsFor(repos: ResearchRepositories) {
  return { repos, reader: makeReader() };
}

// ---------------------------------------------------------------------------
// 纯投影（generator）
// ---------------------------------------------------------------------------

describe("buildResearchReport（纯投影）", () => {
  function sourceFixture(overrides: Partial<ResearchReportSource> = {}): ResearchReportSource {
    return {
      experiment: {
        id: 1,
        datasetVersionId: DATASET_VERSION_ID,
        name: "纯投影夹具",
        researchType: "QUANTILE" as never,
        status: "COMPLETED" as never,
      },
      run: {
        id: 750003,
        runNo: 3,
        status: "COMPLETED",
        sampleCount: 100,
        startedAt: "2026-09-16T17:00:00.000Z",
        completedAt: "2026-09-16T17:57:23.000Z",
        inputSnapshot: { snapshotAt: "2026-09-16T17:00:00.000Z", datasetVersionId: DATASET_VERSION_ID },
      },
      dataset: VERSION_CONTEXT,
      analyses: [],
      resultsByAnalysisId: new Map(),
      findings: [],
      conclusion: null,
      patterns: [],
      conclusionResolution: null,
      ...overrides,
    };
  }

  it("同输入 ⇒ 同正文 ⇒ 同 checksum（不含任何时钟读数）", () => {
    const a = buildResearchReport(sourceFixture());
    const b = buildResearchReport(sourceFixture());
    expect(a.body).toBe(b.body);
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).toBe(createHash("sha256").update(a.body, "utf8").digest("hex"));
    expect(a.metadata.report.body).toBe(a.body);
    expect(a.metadata.report.bytes).toBe(Buffer.byteLength(a.body, "utf8"));
    expect(a.generatorVersion).toBe(REPORT_GENERATOR_VERSION);
  });

  it("无 Finding 时如实展示「没有发现」，不造数", () => {
    const draft = buildResearchReport(sourceFixture());
    expect(draft.metadata.findingIds).toEqual([]);
    expect(draft.body).toContain("没有 Finding");
  });

  it("取不到模式与结论时，置空并记入 unresolvedTraceFields（不伪造）", () => {
    const draft = buildResearchReport(sourceFixture());
    expect(draft.metadata.patternId).toBeNull();
    expect(draft.metadata.patternIds).toEqual([]);
    expect(draft.metadata.conclusionId).toBeNull();
    expect(draft.metadata.unresolvedTraceFields.join("|")).toContain("patternId");
    expect(draft.metadata.unresolvedTraceFields.join("|")).toContain("conclusionId");
  });
});

// ---------------------------------------------------------------------------
// 装配 + 落库（service）
// ---------------------------------------------------------------------------

describe("generateResearchReport（落库与幂等）", () => {
  it("Run 未 COMPLETED ⇒ REPORT_RUN_NOT_COMPLETED，且一行都不写", async () => {
    const repos = makeRepos();
    const seeded = await seed(repos, { runStatus: "RUNNING" });
    await expect(generateResearchReport(depsFor(repos), seeded.runId)).rejects.toMatchObject({
      code: "REPORT_RUN_NOT_COMPLETED",
    });
    expect(await repos.artifacts.list({ runId: seeded.runId })).toHaveLength(0);
  });

  it("首次生成 → CREATED；artifactType=REPORT / storageType=INLINE；metadata 可溯源", async () => {
    const repos = makeRepos();
    const seeded = await seed(repos);
    const result = await generateResearchReport(depsFor(repos), seeded.runId);

    expect(result.outcome).toBe("CREATED");
    expect(result.artifact.artifactType).toBe(REPORT_ARTIFACT_TYPE);
    expect(result.artifact.storageType).toBe(REPORT_STORAGE_TYPE);
    expect(result.artifact.uri).toBe(buildReportUri(seeded.runId));
    expect(result.artifact.experimentId).toBe(seeded.experimentId);

    const metadata = result.artifact.metadata as Record<string, unknown>;
    expect(metadata["runId"]).toBe(seeded.runId);
    expect(metadata["experimentId"]).toBe(seeded.experimentId);
    expect(metadata["datasetVersionId"]).toBe(DATASET_VERSION_ID);
    expect(metadata["analysisIds"]).toEqual([...seeded.analysisIds].sort((a, b) => a - b));
    expect(metadata["findingIds"]).toEqual([seeded.findingId]);
    expect(metadata["conclusionId"]).not.toBeNull();
    expect(metadata["patternIds"]).toEqual(["event-return-research", "first-limit-pullback-hold-shrink"]);
    expect(metadata["generatorVersion"]).toBe(REPORT_GENERATOR_VERSION);
    expect(metadata["unresolvedTraceFields"]).toEqual([]);

    const report = metadata["report"] as Record<string, unknown>;
    expect(report["format"]).toBe("markdown");
    expect(report["mediaType"]).toBe("text/markdown");
    expect(typeof report["body"]).toBe("string");
    expect(report["bytes"]).toBe(Buffer.byteLength(report["body"] as string, "utf8"));
    expect(result.artifact.checksum).toBe(
      createHash("sha256").update(report["body"] as string, "utf8").digest("hex"),
    );
  });

  it("正文**原样引用** research_result 的数值（未四舍五入、未改名）", async () => {
    const repos = makeRepos();
    const seeded = await seed(repos);
    const result = await generateResearchReport(depsFor(repos), seeded.runId);
    const body = (result.artifact.metadata as Record<string, unknown>)["report"] as Record<string, unknown>;
    expect(body["body"]).toContain(String(RAW_MEAN_RETURN));
    expect(body["body"]).toContain("MEAN_RETURN");
    // 结论 policy / disclaimer 原样保留
    expect(body["body"]).toContain("alpha=0.05");
    expect(body["body"]).toContain("不等同于统计显著性或交易有效性");
    // Finding 层免责声明也在
    expect(body["body"]).toContain("研究优先级");
  });

  it("同 Run 重复生成 ⇒ REUSED，artifact 行数不增加（A-2）", async () => {
    const repos = makeRepos();
    const seeded = await seed(repos);
    const first = await generateResearchReport(depsFor(repos), seeded.runId);
    const second = await generateResearchReport(depsFor(repos), seeded.runId);

    expect(second.outcome).toBe("REUSED");
    expect(second.checksum).toBe(first.checksum);
    expect(second.artifact.id).toBe(first.artifact.id);

    const list = await repos.artifacts.list({ runId: seeded.runId, artifactType: REPORT_ARTIFACT_TYPE });
    expect(list).toHaveLength(1);
  });

  it("结果变化后重生成 ⇒ SUPERSEDED，仍只有 1 份 REPORT（A-1）", async () => {
    const repos = makeRepos();
    const seeded = await seed(repos);
    const first = await generateResearchReport(depsFor(repos), seeded.runId);

    // 模拟「该 Run 的某条分析被补跑，结果数值变化」。
    await repos.results.createMany([
      {
        analysisId: seeded.analysisIds[1]!,
        resultType: "SCALAR",
        metricCode: "MEAN",
        metricValue: 0.999,
        sampleCount: 42,
      },
    ]);

    const second = await generateResearchReport(depsFor(repos), seeded.runId);
    expect(second.outcome).toBe("SUPERSEDED");
    expect(second.checksum).not.toBe(first.checksum);
    expect(second.supersededArtifactIds).toEqual([first.artifact.id]);

    const list = await repos.artifacts.list({ runId: seeded.runId, artifactType: REPORT_ARTIFACT_TYPE });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(second.artifact.id);
  });

  it("结论的 primaryAnalysis 不属于本 Run ⇒ conclusionId=null，不拿别的 Run 的结论冒充（A-3）", async () => {
    const repos = makeRepos();
    const seeded = await seed(repos, { attachConclusionToForeignRun: true });
    const result = await generateResearchReport(depsFor(repos), seeded.runId);

    const metadata = result.artifact.metadata as Record<string, unknown>;
    expect(metadata["conclusionId"]).toBeNull();
    expect((metadata["unresolvedTraceFields"] as string[]).join("|")).toContain("conclusionId");
    const report = metadata["report"] as Record<string, string>;
    expect(report["body"]).toContain("未解析出归属结论");
  });

  it("Dataset 版本上下文不可达 ⇒ 不编造区间/事件数，如实记入 unresolvedTraceFields", async () => {
    const repos = makeRepos();
    const seeded = await seed(repos);
    const blindReader = makeReader();
    const result = await generateResearchReport(
      {
        repos,
        reader: {
          ...blindReader,
          getVersionContext: async () => null,
        },
      },
      seeded.runId,
    );
    const metadata = result.artifact.metadata as Record<string, unknown>;
    expect((metadata["unresolvedTraceFields"] as string[]).join("|")).toContain("datasetVersion");
    const report = metadata["report"] as Record<string, string>;
    expect(report["body"]).toContain("版本上下文不可达");
  });
});
