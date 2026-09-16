/**
 * RESEARCH-FINDING-001 B6 —— Finding / Hypothesis / Candidate tRPC 端点契约测试。
 *
 * 覆盖：
 *   - 路由注册：finding.* / hypothesis.get / hypothesis.test / candidate.createFromHypothesis；
 *   - Finding 只读链路：runEngine（收口自动 detect）→ listFindings / getFinding；
 *   - reviewFinding 状态机：引擎只能 DISCOVERED，用户 review 才可流转；非法转移被拒；
 *   - testHypothesis：TESTABLE 需三件套；状态机拒绝跳级；
 *   - createCandidateFromHypothesis：仅 SUPPORTED 可转；产物 DRAFT 候选 + 谱系锚。
 */

import { describe, expect, it } from "vitest";
import { buildResearchEngineRouter } from "../../server/researchEngineRouter";
import { createInMemoryResearchRepositories } from "../../server/researchCore";
import { buildSyntheticDataset, linearEvents, TEST_DATASET_VERSION_ID } from "../../server/researchEngine/testFixtures";

const DATASET_VERSION_ID = TEST_DATASET_VERSION_ID;
const EVENT_COUNT = 40;

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

function buildFixture() {
  const ds = buildSyntheticDataset({ events: linearEvents(EVENT_COUNT), horizons: [5, 10, 20] });
  const repos = makeRepos();
  const router = buildResearchEngineRouter({ repos, reader: ds.reader, eventPageSize: 8 });
  const caller = router.createCaller({ req: {} as never, res: {} as never, user: adminUser });
  return { ds, repos, router, caller };
}

/** 建立一个可产出 Finding 的 QUANTILE 前置并跑通 Run。 */
async function seedRunWithFindings(caller: ReturnType<typeof buildFixture>["caller"]) {
  const experiment = await caller.createExperiment({
    datasetVersionId: DATASET_VERSION_ID,
    name: "首板换手率与未来5日收益研究",
    researchType: "FEATURE",
  });
  const run = await caller.createRun({ experimentId: experiment.id! });
  await caller.createAnalysis({
    runId: run.id!,
    analysisType: "QUANTILE",
    name: "换手率十分位 → 未来5日收益",
    target: "future_return_5d",
    config: { featureField: "turnover", targetField: "future_return_5d", quantileGroups: 10 },
  });
  const engineResult = await caller.runEngine({ experimentId: experiment.id!, runId: run.id! });
  return { experiment, run, engineResult };
}

describe("researchEngineRouter — Finding 端点", () => {
  it("runEngine 收口自动检测 Finding；listFindings / getFinding 可查回", async () => {
    const { caller } = buildFixture();
    const { experiment, run, engineResult } = await seedRunWithFindings(caller);

    // B5 接线：Run 收口自动跑 detect（QUANTILE 单调结构应产出 Finding）
    expect(engineResult.findingCount).toBeGreaterThan(0);

    const findings = await caller.listFindings({ experimentId: experiment.id! });
    expect(findings.length).toBe(engineResult.findingCount);
    expect(findings.map((f) => f.id).sort((a, b) => a - b)).toEqual(engineResult.findingIds!.slice().sort((a, b) => a - b));

    // 引擎只能写 DISCOVERED
    for (const f of findings) expect(f.status).toBe("DISCOVERED");

    // 单条明细
    const detail = await caller.getFinding({ findingId: findings[0]!.id! });
    expect(detail.id).toBe(findings[0]!.id);
    expect(detail.runId).toBe(run.id);
    expect(detail.primaryAnalysisId).toBeDefined();
  });

  it("detectFindings 端点幂等：重跑不翻倍（fingerprint 去重）", async () => {
    const { caller } = buildFixture();
    const { experiment, run } = await seedRunWithFindings(caller);

    const before = await caller.listFindings({ runId: run.id! });
    const detect = await caller.detectFindings({ experimentId: experiment.id!, runId: run.id! });
    const after = await caller.listFindings({ runId: run.id! });

    // resetExisting 默认 true ⇒ 清理后重落，数量不涨
    expect(after.length).toBe(before.length);
    expect(detect.reusedCount).toBe(0); // 清理后重落，全部算新建
    expect(detect.createdCount).toBe(after.length);
  });

  it("reviewFinding 状态机：DISCOVERED → REVIEWED → SUPPORTED 合法；跳级被拒", async () => {
    const { caller } = buildFixture();
    const { experiment } = await seedRunWithFindings(caller);
    const findings = await caller.listFindings({ experimentId: experiment.id! });
    const fid = findings[0]!.id!;

    // 非法：DISCOVERED → SUPPORTED（跳级）
    await expect(caller.reviewFinding({ findingId: fid, status: "SUPPORTED" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    // 合法逐级：DISCOVERED → REVIEWED → SUPPORTED
    const reviewed = await caller.reviewFinding({ findingId: fid, status: "REVIEWED" });
    expect(reviewed.status).toBe("REVIEWED");
    const supported = await caller.reviewFinding({ findingId: fid, status: "SUPPORTED" });
    expect(supported.status).toBe("SUPPORTED");
  });

  it("getFinding / reviewFinding 对不存在的 id 报 NOT_FOUND", async () => {
    const { caller } = buildFixture();
    await expect(caller.getFinding({ findingId: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.reviewFinding({ findingId: 999_999, status: "REVIEWED" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("researchEngineRouter — Hypothesis 补充端点", () => {
  it("getHypothesis 查回；testHypothesis 置 TESTABLE 需三件套", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "假设测试",
      researchType: "FEATURE",
    });
    const hypothesis = await caller.createHypothesis({
      experimentId: experiment.id!,
      name: "H-未形式化",
      statement: "尚未形式化的假设。",
    });

    const detail = await caller.getHypothesis({ hypothesisId: hypothesis.id! });
    expect(detail.id).toBe(hypothesis.id);

    // 缺三件套 ⇒ TESTABLE 被拒
    await expect(
      caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "TESTABLE" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("testHypothesis 状态机：形式化后可逐级推进；跳级被拒", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "假设状态机",
      researchType: "FEATURE",
    });
    // 建一个已形式化的假设（含条件/目标/视界/方向）
    const hypothesis = await caller.createHypothesis({
      experimentId: experiment.id!,
      name: "H-形式化",
      statement: "换手率高的首板股票未来5日收益更高。",
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
      target: "future_return_5d",
      horizon: "T+5",
      expectedDirection: "POSITIVE",
    });

    // 未形式化时 DRAFT → TESTABLE 应被 assertHypothesisTestable 拦截（这里已形式化，故应通过）
    const testable = await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "TESTABLE" });
    expect(testable.status).toBe("TESTABLE");

    // 跳级 TESTABLE → SUPPORTED（跳过 TESTED）应被状态机拒绝
    await expect(
      caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "SUPPORTED" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // 合法：TESTABLE → TESTED → SUPPORTED
    const tested = await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "TESTED" });
    expect(tested.status).toBe("TESTED");
    const supported = await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "SUPPORTED" });
    expect(supported.status).toBe("SUPPORTED");
  });
});

describe("researchEngineRouter — Candidate 从假设转出", () => {
  it("非 SUPPORTED 假设不能转候选（§26 不要自动生成 Strategy）", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "候选转出",
      researchType: "FEATURE",
    });
    const hypothesis = await caller.createHypothesis({
      experimentId: experiment.id!,
      name: "H-草稿",
      statement: "尚未验证的假设。",
    });
    await expect(
      caller.createCandidateFromHypothesis({ hypothesisId: hypothesis.id! }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("SUPPORTED 假设可转出 DRAFT 候选，并落谱系锚（sourceHypothesisId / sourceFindingIds）", async () => {
    const { caller } = buildFixture();
    const experiment = await caller.createExperiment({
      datasetVersionId: DATASET_VERSION_ID,
      name: "候选转出-正路",
      researchType: "FEATURE",
    });
    const hypothesis = await caller.createHypothesis({
      experimentId: experiment.id!,
      name: "H-已验证",
      statement: "换手率高的首板股票未来5日收益更高。",
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
      target: "future_return_5d",
      horizon: "T+5",
      expectedDirection: "POSITIVE",
      sourceFindingIds: [1, 2],
    });
    // 走合法状态链：DRAFT → TESTABLE → TESTED → SUPPORTED
    await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "TESTABLE" });
    await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "TESTED" });
    await caller.testHypothesis({ hypothesisId: hypothesis.id!, status: "SUPPORTED" });

    const candidate = await caller.createCandidateFromHypothesis({ hypothesisId: hypothesis.id! });
    expect(candidate.status).toBe("DRAFT");
    expect(candidate.experimentId).toBe(experiment.id);
    expect(candidate.sourceHypothesisId).toBe(hypothesis.id);
    expect(candidate.sourceFindingIds).toEqual([1, 2]);
    expect(candidate.filterRule).toBeDefined();
  });

  it("不存在的假设报 NOT_FOUND", async () => {
    const { caller } = buildFixture();
    await expect(caller.createCandidateFromHypothesis({ hypothesisId: 999_999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
