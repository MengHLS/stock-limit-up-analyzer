/**
 * RESEARCH-FINDING-001 B8 —— 闭环集成测试。
 *
 * 走**真实 Router + 真实 ResearchEngine + 真实 InMemory 仓储**（不含 DB / Dataset 扫描），
 * 验证任务书 §3.1 的五段闭环：
 *
 *   Analysis ──run──> Result ──detect──> Finding ──review──> Hypothesis ──test──> Candidate
 *
 * 每一跳都断言「谱系锚点」（provenance）真实存在，而非只断言数量：
 *   - Finding.primaryAnalysisId / sourceResultIds 指向真实 Analysis / Result；
 *   - Hypothesis.sourceFindingIds 指向真实 Finding；
 *   - Candidate.sourceHypothesisId / sourceFindingIds 指向真实 Hypothesis / Finding。
 */

import { describe, expect, it } from "vitest";
import { buildResearchEngineRouter } from "../../server/researchEngineRouter";
import { createInMemoryResearchRepositories } from "../../server/researchCore";
import { buildSyntheticDataset, linearEvents, TEST_DATASET_VERSION_ID } from "../../server/researchEngine/testFixtures";

const EVENT_COUNT = 60; // 60 事件 → 十分位每组 6，样本量够过 Finding 的 sampleWeak 门槛

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

function buildFixture() {
  const ds = buildSyntheticDataset({ events: linearEvents(EVENT_COUNT), horizons: [5, 10, 20] });
  const repos = createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === TEST_DATASET_VERSION_ID,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });
  const router = buildResearchEngineRouter({ repos, reader: ds.reader, eventPageSize: 8 });
  const caller = router.createCaller({ req: {} as never, res: {} as never, user: adminUser });
  return { ds, repos, caller };
}

describe("RESEARCH-FINDING-001 闭环集成（Analysis → Result → Finding → Hypothesis → Candidate）", () => {
  it("五段闭环逐跳谱系可回溯", async () => {
    const { caller } = buildFixture();

    // ---- 1) Experiment + Run + Analysis ----
    const experiment = await caller.createExperiment({
      datasetVersionId: TEST_DATASET_VERSION_ID,
      name: "首板换手率与未来5日收益（闭环集成）",
      researchType: "FEATURE",
    });
    const run = await caller.createRun({ experimentId: experiment.id! });
    const analysis = await caller.createAnalysis({
      runId: run.id!,
      analysisType: "QUANTILE",
      name: "换手率十分位 → 未来5日收益",
      target: "future_return_5d",
      config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 },
    });

    // ---- 2) runEngine：Result + Finding（收口自动 detect）----
    const engineResult = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
    expect(engineResult.resultCount).toBeGreaterThan(0);
    expect(engineResult.findingCount).toBeGreaterThan(0);

    // ---- 3) Finding 谱系：primaryAnalysisId / sourceResultIds 指向真实产物 ----
    const findings = await caller.listFindings({ runId: run.id! });
    expect(findings.length).toBe(engineResult.findingCount);
    for (const f of findings) {
      expect(f.status).toBe("DISCOVERED");
      expect(f.runId).toBe(run.id);
      // provenance 硬锚：至少有一个 primaryAnalysisId 或 sourceResultIds
      const hasAnalysis = typeof f.primaryAnalysisId === "number" && f.primaryAnalysisId > 0;
      const hasResults = Array.isArray(f.sourceResultIds) && f.sourceResultIds.length > 0;
      expect(hasAnalysis || hasResults).toBe(true);
    }
    const primaryFinding = findings[0]!;
    expect(primaryFinding.primaryAnalysisId).toBe(analysis.id);

    // ---- 4) Finding → Hypothesis（携带 sourceFindingIds）----
    const hypothesis = await caller.createHypothesis({
      experimentId: experiment.id!,
      name: "H-从发现提出",
      statement: primaryFinding.title,
      target: "future_return_5d",
      horizon: "T+5",
      expectedDirection: "POSITIVE",
      conditions: {
        groups: [
          {
            groupNo: 0,
            groupLogicalOperator: "AND",
            conditions: [
              {
                groupNo: 0,
                sortOrder: 0,
                fieldName: "turnover",
                operator: ">",
                value: 0.1,
                logicalOperator: "AND",
                groupLogicalOperator: "AND",
              },
            ],
          },
        ],
      },
      sourceFindingIds: [primaryFinding.id!],
    });
    expect(hypothesis.sourceFindingIds).toEqual([primaryFinding.id!]);

    // ---- 5) Hypothesis 逐级验证（testHypothesis）----
    const testable = await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "TESTABLE" });
    expect(testable.status).toBe("TESTABLE");
    const tested = await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "TESTED" });
    expect(tested.status).toBe("TESTED");
    const supported = await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "SUPPORTED" });
    expect(supported.status).toBe("SUPPORTED");

    // ---- 6) Hypothesis → Candidate（谱系锚落 sourceHypothesisId / sourceFindingIds）----
    const candidate = await caller.createCandidateFromHypothesis({ hypothesisId: hypothesis.id! });
    expect(candidate.status).toBe("DRAFT");
    expect(candidate.sourceHypothesisId).toBe(hypothesis.id);
    expect(candidate.sourceFindingIds).toEqual([primaryFinding.id!]);
    expect(candidate.sourceDatasetVersionId).toBe(TEST_DATASET_VERSION_ID);
    expect(candidate.filterRule).toBeDefined();

    // ---- 7) 候选经 listCandidates 可查回（闭环收敛）----
    const candidates = await caller.listCandidates({ experimentId: experiment.id! });
    expect(candidates.map((c) => c.id)).toContain(candidate.id);
  });

  it("非 SUPPORTED 假设在闭环中卡在 Hypothesis 段（§26 不得跳转）", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: TEST_DATASET_VERSION_ID,
      name: "闭环-非法跳转",
      researchType: "FEATURE",
    });
    const hypothesis = await caller.createHypothesis({
      experimentId: experiment.id!,
      name: "H-未验证",
      statement: "尚未验证的假设。",
    });
    // DRAFT 假设直接转候选 ⇒ 拒绝（闭环在 Hypothesis→Candidate 段被领域守卫卡住）
    await expect(caller.createCandidateFromHypothesis({ hypothesisId: hypothesis.id! })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
