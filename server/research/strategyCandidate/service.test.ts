/**
 * RESEARCH-006.2 — `StrategyCandidateService` 契约测试（InMemory 仓储，不触真实 DB）。
 *
 * 覆盖（006.2 §23 / §24 / §34）：
 *   A. `createFromConclusion` 12 例（§23）；
 *   B. `get`（含来源缺失如实标注）；
 *   C. `update` 白名单逐字段越界拒绝（§24「API / Service 白名单不能绕过 Repository boundary」）；
 *   D. `transition` 状态机 + **三处 → CONVERTED 全部拒绝**（§17 / §24）；
 *   E. 全局不变量：Service 从不产出 `CONVERTED`、从不写 `strategyDefinitionId`（§28 / §29 / §34）。
 *
 * 证据纪律：断言的是**领域语义**（错误码 / 字段值 / 快照内容），不是实现细节。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryResearchRepositories,
  type ResearchConclusion,
  type ResearchRepositories,
} from "../../researchCore";
import {
  STRATEGY_CANDIDATE_ERROR,
  StrategyCandidateError,
} from "./candidateTypes";
import { SOURCE_TRACE_MAX_TEXT } from "./evidenceTrace";
import {
  createStrategyCandidateService,
  type DatasetVersionReadPort,
  type DatasetVersionSnapshot,
  type StrategyCandidateService,
} from "./service";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const DATASET_VERSION_ID = 900701;
const DATASET_LABEL = "v2";
const NOW = () => new Date("2026-09-12T10:00:00.000Z");

function makeDatasetPort(
  overrides: Partial<DatasetVersionSnapshot> = {},
  opts: { missing?: boolean } = {},
): DatasetVersionReadPort {
  return {
    async getVersionById(id) {
      if (opts.missing || id !== DATASET_VERSION_ID) return undefined;
      return {
        datasetVersionId: id,
        label: DATASET_LABEL,
        status: "READY",
        datasetId: 120001,
        ...overrides,
      };
    },
  };
}

/** 与真实库结构一致（2026-09-12 实查 7 行 `evidenceJson`）的最小证据夹具。 */
function evidenceFixture(analysisId: number) {
  return {
    disclaimer: "⚠️ 自动结论仅为研究辅助，不等同于统计显著性或交易有效性；任何策略性判断必须经 Backtest / 稳健性 / OOS 验证后才可成立。",
    policy: {
      alpha: 0.05,
      materialityAbs: 0.005,
      minSampleCount: 30,
      stabilityMinConsistentRatio: 0.6,
      strongSampleMultiple: 2,
    },
    hypothesisId: null,
    hypothesisStatement: "(未登记假设陈述)",
    primaryAnalysis: {
      analysisId,
      analysisType: "CONDITIONAL",
      effectLabel: "条件组 − 全样本的 future_return_20d 均值差",
      effect: 0.038950159772887606,
      pValue: 0,
      tStat: 16.396856329822153,
      sampleCount: 23033,
      minGroupSampleCount: 16158,
      groupCount: 2,
      directionConsistency: null,
    },
    primarySelectionRule: "按 QUANTILE → CONDITIONAL → … 的固定优先级选择主分析",
    contributingAnalyses: [
      {
        analysisId,
        analysisType: "CONDITIONAL",
        effect: 0.038950159772887606,
        effectLabel: "条件组 − 全样本的 future_return_20d 均值差",
        pValue: 0,
        sampleCount: 23033,
        notes: ["DIFFERENCE = mean(条件样本) − mean(全样本)。"],
      },
    ],
    ruleTrace: [
      { rule: "R2_样本达标", passed: true, detail: "总样本 23033（门槛 30）" },
      { rule: "R4_统计量达标", passed: true, detail: "p = 0.0000，alpha = 0.05" },
    ],
    confidenceBasis: "基础 0.30；+0.25 统计达标；+0.15 样本充裕",
    confidenceIsNotPValue: true,
  };
}

interface Harness {
  repos: ResearchRepositories;
  service: StrategyCandidateService;
  datasetVersions: DatasetVersionReadPort;
  experimentId: number;
  runId: number;
  analysisId: number;
  conclusionId: number;
}

async function seedHarness(options: {
  datasetStatus?: string;
  datasetMissing?: boolean;
  conclusionStatus?: ResearchConclusion["status"];
  evidence?: unknown;
  conclusionBody?: string;
  conclusionTitle?: string;
  /** 不建 Run / Analysis（用于「Run 无法解析 ⇒ NULL」）。 */
  skipRun?: boolean;
} = {}): Promise<Harness> {
  const repos = createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === DATASET_VERSION_ID,
    now: NOW,
  });
  const datasetVersions = makeDatasetPort(
    options.datasetStatus ? { status: options.datasetStatus } : {},
    { missing: options.datasetMissing === true },
  );

  const experiment = await repos.experiments.create({
    datasetVersionId: DATASET_VERSION_ID,
    name: "正式数据，首板回踩与未来收益的关系",
    researchType: "EVENT_STUDY",
    status: "COMPLETED",
  });

  let runId = 0;
  let analysisId = 0;
  if (options.skipRun !== true) {
    const run = await repos.runs.create({
      experimentId: experiment.id as number,
      runNo: 1,
      status: "COMPLETED",
    });
    const analysis = await repos.analyses.create({
      runId: run.id as number,
      analysisType: "CONDITIONAL",
      name: "条件组 vs 全样本 · future_return_20d",
      status: "COMPLETED",
    });
    runId = run.id as number;
    analysisId = analysis.id as number;
  }

  const conclusion = await repos.conclusions.create({
    experimentId: experiment.id as number,
    conclusionType: "SUPPORTED",
    title: options.conclusionTitle ?? "正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）",
    conclusion: options.conclusionBody ?? "假设：「…」\n\n判定：在预设规则下支持该假设。\n\n关键量：…",
    evidence:
      options.evidence !== undefined
        ? options.evidence
        : options.skipRun === true
          ? null
          : evidenceFixture(analysisId),
    confidence: 0.85,
    ...(options.conclusionStatus ? { status: options.conclusionStatus } : {}),
  });

  return {
    repos,
    datasetVersions,
    service: createStrategyCandidateService({ repos, datasetVersions }),
    experimentId: experiment.id as number,
    runId,
    analysisId,
    conclusionId: conclusion.id as number,
  };
}

async function expectCandidateError(
  promise: Promise<unknown>,
  code: string,
): Promise<StrategyCandidateError> {
  try {
    await promise;
  } catch (err) {
    expect(err, `期望 StrategyCandidateError(${code})，实际抛出：${String(err)}`).toBeInstanceOf(
      StrategyCandidateError,
    );
    const e = err as StrategyCandidateError;
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`期望抛出 StrategyCandidateError(${code})，但调用成功返回`);
}

// ---------------------------------------------------------------------------

describe("RESEARCH-006.2 · createFromConclusion（§23）", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await seedHarness();
  });

  it("1) Conclusion 不存在 → CONCLUSION_NOT_FOUND", async () => {
    await expectCandidateError(
      h.service.createFromConclusion({ conclusionId: 999999999 }),
      STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_FOUND,
    );
  });

  it("2) Conclusion 不允许登记（SUPERSEDED）→ CONCLUSION_NOT_CANDIDATE_ELIGIBLE", async () => {
    const superseded = await h.repos.conclusions.create({
      experimentId: h.experimentId,
      conclusionType: "REJECTED",
      title: "已被取代的结论",
      conclusion: "正文",
      status: "SUPERSEDED",
    });
    await expectCandidateError(
      h.service.createFromConclusion({ conclusionId: superseded.id as number }),
      STRATEGY_CANDIDATE_ERROR.CONCLUSION_NOT_CANDIDATE_ELIGIBLE,
    );
  });

  it("2b) Conclusion 状态为 FINAL 时允许登记（资格白名单含 FINAL）", async () => {
    const final = await h.repos.conclusions.create({
      experimentId: h.experimentId,
      conclusionType: "SUPPORTED",
      title: "已定稿的结论",
      conclusion: "正文",
      status: "FINAL",
    });
    const view = await h.service.createFromConclusion({ conclusionId: final.id as number });
    expect(view.candidate.status).toBe("DRAFT");
  });

  it("3) Experiment 不存在 → EXPERIMENT_NOT_FOUND", async () => {
    // 结论建好后再删实验（模拟「结论悬空」这种真实存在的数据完整性缺口）
    const orphan = await h.repos.conclusions.create({
      experimentId: h.experimentId,
      conclusionType: "SUPPORTED",
      title: "孤儿结论",
      conclusion: "正文",
    });
    await h.repos.experiments.delete(h.experimentId);
    await expectCandidateError(
      h.service.createFromConclusion({ conclusionId: orphan.id as number }),
      STRATEGY_CANDIDATE_ERROR.EXPERIMENT_NOT_FOUND,
    );
  });

  it("3b) Experiment.datasetVersionId 非法（0）→ DATASET_VERSION_INVALID", async () => {
    const repos: ResearchRepositories = {
      ...h.repos,
      experiments: {
        ...h.repos.experiments,
        getById: async (id) => ({
          id,
          datasetVersionId: 0,
          name: "坏坐标实验",
          researchType: "EVENT_STUDY",
          status: "COMPLETED",
        }),
      },
    };
    const service = createStrategyCandidateService({ repos, datasetVersions: h.datasetVersions });
    await expectCandidateError(
      service.createFromConclusion({ conclusionId: h.conclusionId }),
      STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_INVALID,
    );
  });

  it("4) Dataset Version 不存在 → DATASET_VERSION_NOT_FOUND", async () => {
    const repos = createInMemoryResearchRepositories({
      datasetVersionExists: async () => true,
      now: NOW,
    });
    const experiment = await repos.experiments.create({
      datasetVersionId: DATASET_VERSION_ID,
      name: "E",
      researchType: "EVENT_STUDY",
    });
    const conclusion = await repos.conclusions.create({
      experimentId: experiment.id as number,
      conclusionType: "SUPPORTED",
      title: "T",
      conclusion: "C",
    });
    const service = createStrategyCandidateService({
      repos,
      datasetVersions: makeDatasetPort({}, { missing: true }),
    });
    await expectCandidateError(
      service.createFromConclusion({ conclusionId: conclusion.id as number }),
      STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND,
    );
  });

  it("4b) Dataset Version 未 READY → DATASET_VERSION_NOT_READY", async () => {
    const h2 = await seedHarness({ datasetStatus: "BUILDING" });
    await expectCandidateError(
      h2.service.createFromConclusion({ conclusionId: h2.conclusionId }),
      STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY,
    );
  });

  it("5) 正常创建 → status = DRAFT，且 name / description 缺省取自结论", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    expect(view.candidate.status).toBe("DRAFT");
    expect(view.candidate.conclusionId).toBe(h.conclusionId);
    expect(view.candidate.experimentId).toBe(h.experimentId);
    expect(view.candidate.strategyDefinitionId).toBeNull();
    expect(view.candidate.name).toBe("正式数据，首板回踩与未来收益的关系 — 自动结论（SUPPORTED）");
    expect(view.candidate.description).toBe("假设：「…」\n\n判定：在预设规则下支持该假设。\n\n关键量：…");
  });

  it("5b) 显式 name / description 覆盖缺省", async () => {
    const view = await h.service.createFromConclusion({
      conclusionId: h.conclusionId,
      name: "首板回踩不破开盘价",
      description: "人写的说明",
    });
    expect(view.candidate.name).toBe("首板回踩不破开盘价");
    expect(view.candidate.description).toBe("人写的说明");
  });

  it("6+7) sourceDatasetVersionId 正确复制自 Experiment（唯一 Dataset 坐标）", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    expect(view.candidate.sourceDatasetVersionId).toBe(DATASET_VERSION_ID);
    // 视图里的 dataset 由 Registry 现查（label 不落列、不成第二副本）
    expect(view.dataset).toEqual({
      datasetVersionId: DATASET_VERSION_ID,
      label: DATASET_LABEL,
      status: "READY",
      datasetId: 120001,
    });
    expect(view.sourceMissing).toEqual([]);
  });

  it("8) sourceResearchRunId 由 evidence.primaryAnalysis.analysisId 两跳解析得到", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    expect(view.candidate.sourceResearchRunId).toBe(h.runId);
    const trace = view.candidate.sourceTraceJson as Record<string, unknown>;
    expect(trace.runResolution).toMatchObject({
      sourceResearchRunId: h.runId,
      path: "PRIMARY_ANALYSIS",
      analysisIds: [h.analysisId],
      distinctRunIds: [h.runId],
      missingAnalysisIds: [],
    });
  });

  it("9) 无法解析 Run → sourceResearchRunId = NULL（不伪造）", async () => {
    // 9a: evidence 引用一个不存在的 analysisId
    const dangling = await h.repos.conclusions.create({
      experimentId: h.experimentId,
      conclusionType: "SUPPORTED",
      title: "证据指向不存在的分析",
      conclusion: "正文",
      evidence: evidenceFixture(888888),
    });
    const a = await h.service.createFromConclusion({ conclusionId: dangling.id as number });
    expect(a.candidate.sourceResearchRunId).toBeNull();
    expect((a.candidate.sourceTraceJson as Record<string, unknown>).runResolution).toMatchObject({
      sourceResearchRunId: null,
      path: "PRIMARY_ANALYSIS",
      missingAnalysisIds: [888888],
    });

    // 9b: 完全没有 evidence
    const noEvidence = await h.repos.conclusions.create({
      experimentId: h.experimentId,
      conclusionType: "INCONCLUSIVE",
      title: "无证据结论",
      conclusion: "正文",
      evidence: null,
    });
    const b = await h.service.createFromConclusion({ conclusionId: noEvidence.id as number });
    expect(b.candidate.sourceResearchRunId).toBeNull();
    const traceB = b.candidate.sourceTraceJson as Record<string, unknown>;
    expect(traceB.runResolution).toMatchObject({ path: "NONE", analysisIds: [] });
    expect(traceB.evidenceShape).toMatchObject({ hasEvidence: false, topLevelKeys: [] });
  });

  it("9c) 证据跨多个 Run（runId 不唯一）→ NULL", async () => {
    const run2 = await h.repos.runs.create({
      experimentId: h.experimentId,
      runNo: 2,
      status: "COMPLETED",
    });
    const analysis2 = await h.repos.analyses.create({
      runId: run2.id as number,
      analysisType: "DESCRIPTIVE",
      name: "另一个 Run 的分析",
      status: "COMPLETED",
    });
    const crossRun = await h.repos.conclusions.create({
      experimentId: h.experimentId,
      conclusionType: "SUPPORTED",
      title: "跨 Run 结论",
      conclusion: "正文",
      evidence: {
        ...evidenceFixture(h.analysisId),
        contributingAnalyses: [
          { analysisId: h.analysisId, analysisType: "CONDITIONAL" },
          { analysisId: analysis2.id as number, analysisType: "DESCRIPTIVE" },
        ],
      },
    });
    const view = await h.service.createFromConclusion({ conclusionId: crossRun.id as number });
    expect(view.candidate.sourceResearchRunId).toBeNull();
    expect((view.candidate.sourceTraceJson as Record<string, unknown>).runResolution).toMatchObject({
      distinctRunIds: [h.runId, run2.id as number],
    });
  });

  it("10) sourceTraceJson 是**最小充分**快照：证据形状 + 主分析 + 免责声明（截断有上限）", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    const trace = view.candidate.sourceTraceJson as Record<string, unknown>;
    expect(trace.snapshotKind).toBe("research_conclusion_evidence");
    expect(trace.snapshotFormatVersion).toBe(1);
    expect(trace.conclusionId).toBe(h.conclusionId);
    expect(trace.experimentId).toBe(h.experimentId);
    expect(trace.conclusionType).toBe("SUPPORTED");
    expect(trace.conclusionStatus).toBe("DRAFT");
    expect(trace.confidence).toBe(0.85);
    expect(trace.confidenceIsNotPValue).toBe(true);
    expect(trace.generatedFrom).toBe("research_conclusion.evidenceJson");
    expect((trace.primaryAnalysis as Record<string, unknown>).analysisId).toBe(h.analysisId);
    expect(trace.evidenceShape).toMatchObject({
      hasEvidence: true,
      ruleTraceCount: 2,
      legacyAnalysesKeyUsed: false,
    });
    // 快照**不**整体序列化 Result / Analysis / Run 内容（不是第二份结果存储）
    const text = JSON.stringify(trace);
    expect(text).not.toContain("research_result");
    expect(typeof trace.disclaimer === "string").toBe(true);
    expect((trace.disclaimer as string).length).toBeLessThanOrEqual(SOURCE_TRACE_MAX_TEXT + 32);
  });

  it("11a) intent 映射：不传 overrides ⇒ 5 个规则列**保持为空**（Research 没研究出来的，Service 不猜）", async () => {
    const view = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    expect(view.candidate.entryRule).toBeUndefined();
    expect(view.candidate.filterRule).toBeUndefined();
    expect(view.candidate.exitRule).toBeUndefined();
    expect(view.candidate.riskRule).toBeUndefined();
    expect(view.candidate.parameterSpace).toBeUndefined();
  });

  it("11b) intent 映射：人显式传入的 overrides 原样落库（不补默认值）", async () => {
    const view = await h.service.createFromConclusion({
      conclusionId: h.conclusionId,
      overrides: {
        entryRule: { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" },
        exitRule: {},
        parameterSpace: { holdGuardDays: { type: "number", min: 1, max: 5, step: 1 } },
      },
    });
    expect(view.candidate.entryRule).toEqual({ event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" });
    expect(view.candidate.exitRule).toEqual({});
    expect(view.candidate.parameterSpace).toEqual({
      holdGuardDays: { type: "number", min: 1, max: 5, step: 1 },
    });
    // 未提供的仍为空 —— 不因「应该有一个」而编造
    expect(view.candidate.filterRule).toBeUndefined();
    expect(view.candidate.riskRule).toBeUndefined();
  });

  it("11c) overrides 不接受 datasetVersionId（研究来源坐标不可被调用方改写）", async () => {
    await expectCandidateError(
      h.service.createFromConclusion({
        conclusionId: h.conclusionId,
        overrides: { datasetVersionId: 390001 } as never,
      }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
  });

  it("11d) overrides 不接受 status / experimentId 等非草图字段", async () => {
    await expectCandidateError(
      h.service.createFromConclusion({
        conclusionId: h.conclusionId,
        overrides: { status: "ACCEPTED" } as never,
      }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
  });

  it("12) 同一 Conclusion + 同名 ⇒ CANDIDATE_ALREADY_EXISTS；不同名允许（1:N）", async () => {
    await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    await expectCandidateError(
      h.service.createFromConclusion({ conclusionId: h.conclusionId }),
      STRATEGY_CANDIDATE_ERROR.CANDIDATE_ALREADY_EXISTS,
    );
    await h.service.createFromConclusion({ conclusionId: h.conclusionId, name: "另一种出场设计" });
    const all = await h.repos.candidates.list({ conclusionId: h.conclusionId });
    expect(all).toHaveLength(2);
    expect(all.every((c) => c.status === "DRAFT")).toBe(true);
  });

  it("12b) 名称非法（空白 / 超长）→ INVALID_INPUT", async () => {
    await expectCandidateError(
      h.service.createFromConclusion({ conclusionId: h.conclusionId, name: "   " }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
    await expectCandidateError(
      h.service.createFromConclusion({ conclusionId: h.conclusionId, name: "x".repeat(201) }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
  });
});

describe("RESEARCH-006.2 · get", () => {
  it("返回候选本体 + 上游摘要；上游被删时如实标注 sourceMissing（不报错、不伪造）", async () => {
    const h = await seedHarness();
    const created = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    const id = created.candidate.id as number;

    const view = await h.service.get(id);
    expect(view.candidate.id).toBe(id);
    expect(view.experiment).toMatchObject({ id: h.experimentId, datasetVersionId: DATASET_VERSION_ID });
    expect(view.conclusion).toMatchObject({ id: h.conclusionId, conclusionType: "SUPPORTED" });
    expect(view.dataset?.label).toBe(DATASET_LABEL);
    expect(view.sourceMissing).toEqual([]);

    // 上游删除后：候选行仍在（快照 vs FK 的全部价值）
    await h.repos.experiments.delete(h.experimentId);
    await h.repos.conclusions.delete(h.conclusionId);
    const after = await h.service.get(id);
    expect(after.candidate.sourceDatasetVersionId).toBe(DATASET_VERSION_ID);
    expect(after.experiment).toBeNull();
    expect(after.conclusion).toBeNull();
    expect(after.sourceMissing.sort()).toEqual(["CONCLUSION", "EXPERIMENT"]);
  });

  it("不存在 → CANDIDATE_NOT_FOUND", async () => {
    const h = await seedHarness();
    await expectCandidateError(h.service.get(424242), STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_FOUND);
  });
});

describe("RESEARCH-006.2 · update 白名单（§24）", () => {
  let h: Harness;
  let candidateId: number;

  beforeEach(async () => {
    h = await seedHarness();
    const created = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    candidateId = created.candidate.id as number;
  });

  it("允许修改草图字段（name / description / entryRule）", async () => {
    const updated = await h.service.update(candidateId, {
      name: "首板回踩不破开盘价",
      description: "人的描述",
      entryRule: { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" },
    });
    expect(updated.name).toBe("首板回踩不破开盘价");
    expect(updated.description).toBe("人的描述");
    expect(updated.entryRule).toEqual({ event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" });
    // 来源快照与状态**完全不动**
    expect(updated.sourceDatasetVersionId).toBe(DATASET_VERSION_ID);
    expect(updated.sourceResearchRunId).toBe(h.runId);
    expect(updated.status).toBe("DRAFT");
    expect(updated.conclusionId).toBe(h.conclusionId);
  });

  const forbidden: Array<[string, Record<string, unknown>]> = [
    ["status", { status: "REVIEW" }],
    ["strategyDefinitionId", { strategyDefinitionId: "some-strategy" }],
    ["experimentId", { experimentId: 424242 }],
    ["conclusionId", { conclusionId: 424242 }],
    ["sourceDatasetVersionId", { sourceDatasetVersionId: 390001 }],
    ["sourceResearchRunId", { sourceResearchRunId: 424242 }],
    ["sourceTraceJson", { sourceTraceJson: { hacked: true } }],
    ["sourceDatasetDivergenceReason", { sourceDatasetDivergenceReason: "看起来严肃的空话" }],
    ["未来的新字段", { brandNewField: 1 }],
  ];

  for (const [label, patch] of forbidden) {
    it(`拒绝越界字段：${label}`, async () => {
      const err = await expectCandidateError(
        h.service.update(candidateId, patch as never),
        STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
      );
      expect(err.message).toContain(label === "未来的新字段" ? "brandNewField" : label);
      // 拒绝对行内容零影响
      const after = await h.repos.candidates.getById(candidateId);
      expect(after?.status).toBe("DRAFT");
      expect(after?.strategyDefinitionId).toBeNull();
      expect(after?.sourceDatasetVersionId).toBe(DATASET_VERSION_ID);
      expect(after?.sourceDatasetDivergenceReason).toBeNull();
    });
  }

  it("空 patch → INVALID_INPUT（不返回假成功）", async () => {
    await expectCandidateError(
      h.service.update(candidateId, {}),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
  });

  it("name 为空串 → INVALID_INPUT", async () => {
    await expectCandidateError(
      h.service.update(candidateId, { name: "  " }),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
  });

  it("候选不存在 → CANDIDATE_NOT_FOUND（且先于任何写入）", async () => {
    await expectCandidateError(
      h.service.update(424242, { description: "x" }),
      STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_FOUND,
    );
  });

  it("白名单不能绕过 Repository boundary：一次越界 patch 不会顺带改掉合法字段", async () => {
    await expectCandidateError(
      h.service.update(candidateId, { description: "应当无效", status: "ACCEPTED" } as never),
      STRATEGY_CANDIDATE_ERROR.INVALID_INPUT,
    );
    const after = await h.repos.candidates.getById(candidateId);
    expect(after?.description).toBe("假设：「…」\n\n判定：在预设规则下支持该假设。\n\n关键量：…");
    expect(after?.status).toBe("DRAFT");
  });
});

describe("RESEARCH-006.2 · transition 状态机（§17 / §24）", () => {
  let h: Harness;
  let candidateId: number;

  beforeEach(async () => {
    h = await seedHarness();
    const created = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    candidateId = created.candidate.id as number;
  });

  it("DRAFT → REVIEW 通过", async () => {
    const updated = await h.service.transition({ candidateId, to: "REVIEW" });
    expect(updated.status).toBe("REVIEW");
  });

  it("REVIEW → ACCEPTED 通过", async () => {
    await h.service.transition({ candidateId, to: "REVIEW" });
    const updated = await h.service.transition({ candidateId, to: "ACCEPTED" });
    expect(updated.status).toBe("ACCEPTED");
  });

  it("REVIEW → REJECTED 通过", async () => {
    await h.service.transition({ candidateId, to: "REVIEW" });
    const updated = await h.service.transition({ candidateId, to: "REJECTED" });
    expect(updated.status).toBe("REJECTED");
  });

  it("各级 → ARCHIVED 通过", async () => {
    await h.service.transition({ candidateId, to: "REVIEW" });
    await h.service.transition({ candidateId, to: "ACCEPTED" });
    const archived = await h.service.transition({ candidateId, to: "ARCHIVED" });
    expect(archived.status).toBe("ARCHIVED");
  });

  it("🔴 DRAFT → CONVERTED 拒绝（CONVERSION_REQUIRES_PROMOTE，且提示走 promote）", async () => {
    const err = await expectCandidateError(
      h.service.transition({ candidateId, to: "CONVERTED" }),
      STRATEGY_CANDIDATE_ERROR.CONVERSION_REQUIRES_PROMOTE,
    );
    expect(err.message).toContain("promote");
    expect((await h.repos.candidates.getById(candidateId))?.status).toBe("DRAFT");
  });

  it("🔴 REVIEW → CONVERTED 拒绝", async () => {
    await h.service.transition({ candidateId, to: "REVIEW" });
    await expectCandidateError(
      h.service.transition({ candidateId, to: "CONVERTED" }),
      STRATEGY_CANDIDATE_ERROR.CONVERSION_REQUIRES_PROMOTE,
    );
    expect((await h.repos.candidates.getById(candidateId))?.status).toBe("REVIEW");
  });

  it("🔴 ACCEPTED → CONVERTED 拒绝（即便已 ACCEPTED，006.2 也不放行）", async () => {
    await h.service.transition({ candidateId, to: "REVIEW" });
    await h.service.transition({ candidateId, to: "ACCEPTED" });
    await expectCandidateError(
      h.service.transition({ candidateId, to: "CONVERTED" }),
      STRATEGY_CANDIDATE_ERROR.CONVERSION_REQUIRES_PROMOTE,
    );
    const after = await h.repos.candidates.getById(candidateId);
    expect(after?.status).toBe("ACCEPTED");
    expect(after?.strategyDefinitionId).toBeNull();
  });

  it("非法迁移：DRAFT → ACCEPTED 拒绝（不能跳过 REVIEW）", async () => {
    await expectCandidateError(
      h.service.transition({ candidateId, to: "ACCEPTED" }),
      STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
    );
  });

  it("非法迁移：终态 ARCHIVED 之后不可再迁移", async () => {
    await h.service.transition({ candidateId, to: "ARCHIVED" });
    await expectCandidateError(
      h.service.transition({ candidateId, to: "REVIEW" }),
      STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
    );
  });

  it("未开放目标（含 DRAFT 退回 / 未知枚举）→ TRANSITION_INVALID", async () => {
    await h.service.transition({ candidateId, to: "REVIEW" });
    await expectCandidateError(
      h.service.transition({ candidateId, to: "DRAFT" }),
      STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
    );
    await expectCandidateError(
      h.service.transition({ candidateId, to: "PUBLISHED" }),
      STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
    );
  });

  it("状态未变化 → TRANSITION_INVALID（不返回假成功）", async () => {
    await expectCandidateError(
      h.service.transition({ candidateId, to: "ARCHIVED" }).then(() =>
        h.service.transition({ candidateId, to: "ARCHIVED" }),
      ),
      STRATEGY_CANDIDATE_ERROR.TRANSITION_INVALID,
    );
  });

  it("候选不存在 → CANDIDATE_NOT_FOUND", async () => {
    await expectCandidateError(
      h.service.transition({ candidateId: 424242, to: "REVIEW" }),
      STRATEGY_CANDIDATE_ERROR.CANDIDATE_NOT_FOUND,
    );
  });
});

describe("RESEARCH-006.2 · 全局不变量（§28 / §29 / §34）", () => {
  it("无论怎样操作，Service 都不产出 CONVERTED、不写 strategyDefinitionId", async () => {
    const h = await seedHarness();
    const created = await h.service.createFromConclusion({ conclusionId: h.conclusionId });
    const id = created.candidate.id as number;
    await h.service.update(id, { description: "改一下" });
    await h.service.transition({ candidateId: id, to: "REVIEW" });
    await h.service.transition({ candidateId: id, to: "ACCEPTED" });
    await h.service.transition({ candidateId: id, to: "CONVERTED" }).catch(() => undefined);

    const all = await h.repos.candidates.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe("ACCEPTED");
    expect(all[0]?.strategyDefinitionId).toBeNull();
  });
});
