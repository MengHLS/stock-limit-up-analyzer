/**
 * RESEARCH-006.2 — `research.strategyCandidate.*` Router 契约测试（InMemory 依赖注入，不触真实 DB）。
 *
 * 覆盖（006.2 §25）：
 *   - 端点存在性 + **不存在 promote**（§29「严禁偷跑」的运行时证据）；
 *   - 入参校验（zod v4 `strictObject`：未知字段 / 非法枚举 → BAD_REQUEST）；
 *   - 权限（写 → adminProcedure；未授权 → FORBIDDEN）；
 *   - 领域错误 → 稳定 tRPC code（NOT_FOUND / PRECONDITION_FAILED / CONFLICT / BAD_REQUEST）；
 *   - 端到端效果（Service 真实被调用：候选真的落库、状态真的迁移）；
 *   - 注册证明：`appRouter.research.strategyCandidate` 在**整棵路由树**里可见（只引用不调用，
 *     避免拉起真实 DB）。
 */

import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../../routers";
import { createInMemoryResearchRepositories } from "../../researchCore";
import { buildStrategyCandidateRouter } from "./router";
import { createStrategyCandidateService, type DatasetVersionReadPort } from "./service";

const DATASET_VERSION_ID = 900801;

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

const datasetPort: DatasetVersionReadPort = {
  async getVersionById(id) {
    return id === DATASET_VERSION_ID
      ? { datasetVersionId: id, label: "v2", status: "READY", datasetId: 120001 }
      : undefined;
  },
};

async function buildFixture() {
  const repos = createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === DATASET_VERSION_ID,
    now: () => new Date("2026-09-12T10:00:00.000Z"),
  });
  const experiment = await repos.experiments.create({
    datasetVersionId: DATASET_VERSION_ID,
    name: "正式数据，首板回踩与未来收益的关系",
    researchType: "EVENT_STUDY",
    status: "COMPLETED",
  });
  const run = await repos.runs.create({
    experimentId: experiment.id as number,
    runNo: 1,
    status: "COMPLETED",
  });
  const analysis = await repos.analyses.create({
    runId: run.id as number,
    analysisType: "CONDITIONAL",
    name: "条件组 vs 全样本",
    status: "COMPLETED",
  });
  const conclusion = await repos.conclusions.create({
    experimentId: experiment.id as number,
    conclusionType: "SUPPORTED",
    title: "首板回踩 — 自动结论（SUPPORTED）",
    conclusion: "正文",
    evidence: {
      disclaimer: "免责声明",
      primaryAnalysis: { analysisId: analysis.id as number, analysisType: "CONDITIONAL" },
      contributingAnalyses: [],
      ruleTrace: [],
      confidenceIsNotPValue: true,
    },
    confidence: 0.8,
  });
  const superseded = await repos.conclusions.create({
    experimentId: experiment.id as number,
    conclusionType: "REJECTED",
    title: "已被取代",
    conclusion: "正文",
    status: "SUPERSEDED",
  });

  const router = buildStrategyCandidateRouter({
    service: createStrategyCandidateService({ repos, datasetVersions: datasetPort }),
  });
  const caller = router.createCaller({ req: {} as never, res: {} as never, user: adminUser });
  const anonCaller = router.createCaller({ req: {} as never, res: {} as never, user: null });

  return {
    repos,
    router,
    caller,
    anonCaller,
    conclusionId: conclusion.id as number,
    supersededId: superseded.id as number,
  };
}

async function expectTrpcError(promise: Promise<unknown>, code: string): Promise<TRPCError> {
  try {
    await promise;
  } catch (err) {
    expect(err, `期望 TRPCError(${code})，实际抛出：${String(err)}`).toBeInstanceOf(TRPCError);
    const e = err as TRPCError;
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`期望抛出 TRPCError(${code})，但调用成功返回`);
}

/** tRPC v11 的 `_def.procedures` 是**扁平点分路径**表；用它做「端点存在性」断言可避免触发 caller 代理。 */
function procedurePaths(r: unknown): string[] {
  return Object.keys((r as { _def: { procedures: Record<string, unknown> } })._def.procedures);
}

describe("RESEARCH-006.2 · Router 端点与偷跑检查", () => {
  it("只暴露 4 个端点，且**不存在** promote（§29）", async () => {
    const f = await buildFixture();
    expect(procedurePaths(f.router).sort()).toEqual([
      "createFromConclusion",
      "get",
      "transition",
      "update",
    ]);
    expect(procedurePaths(f.router).some((p) => /promote|clone|strategy/i.test(p))).toBe(false);
  });

  it("已注册进 appRouter（research.strategyCandidate.*）—— 只读路由表，不触库", () => {
    const paths = procedurePaths(appRouter);
    expect(paths.filter((p) => p.startsWith("research.strategyCandidate.")).sort()).toEqual([
      "research.strategyCandidate.createFromConclusion",
      "research.strategyCandidate.get",
      "research.strategyCandidate.transition",
      "research.strategyCandidate.update",
    ]);
    expect(paths).not.toContain("research.strategyCandidate.promote");
  });
});

describe("RESEARCH-006.2 · Router 权限", () => {
  it("createFromConclusion / update / transition 需 admin（未登录 → FORBIDDEN）", async () => {
    const f = await buildFixture();
    await expectTrpcError(
      f.anonCaller.createFromConclusion({ conclusionId: f.conclusionId }),
      "FORBIDDEN",
    );
    await expectTrpcError(f.anonCaller.update({ candidateId: 1, patch: { name: "x" } }), "FORBIDDEN");
    await expectTrpcError(f.anonCaller.transition({ candidateId: 1, to: "REVIEW" }), "FORBIDDEN");
  });

  it("get 是只读端点（未登录可读）", async () => {
    const f = await buildFixture();
    const created = await f.caller.createFromConclusion({ conclusionId: f.conclusionId });
    const view = await f.anonCaller.get({ candidateId: created.candidate.id as number });
    expect(view.candidate.status).toBe("DRAFT");
  });
});

describe("RESEARCH-006.2 · Router 入参校验（zod strictObject）", () => {
  it("未知顶层字段 → BAD_REQUEST", async () => {
    const f = await buildFixture();
    await expectTrpcError(
      f.caller.createFromConclusion({ conclusionId: f.conclusionId, datasetVersionId: 390001 } as never),
      "BAD_REQUEST",
    );
  });

  it("conclusionId 非正整数 → BAD_REQUEST", async () => {
    const f = await buildFixture();
    await expectTrpcError(f.caller.createFromConclusion({ conclusionId: 0 }), "BAD_REQUEST");
    await expectTrpcError(
      f.caller.createFromConclusion({ conclusionId: 1.5 } as never),
      "BAD_REQUEST",
    );
  });

  it("update 的 patch 带 status / 未知字段 → BAD_REQUEST（传输层即挡）", async () => {
    const f = await buildFixture();
    const created = await f.caller.createFromConclusion({ conclusionId: f.conclusionId });
    const candidateId = created.candidate.id as number;
    await expectTrpcError(
      f.caller.update({ candidateId, patch: { status: "REVIEW" } } as never),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      f.caller.update({ candidateId, patch: { sourceResearchRunId: 1 } } as never),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      f.caller.update({ candidateId, patch: { branchNew: 1 } } as never),
      "BAD_REQUEST",
    );
  });

  it("transition 的 to 非法枚举 → BAD_REQUEST；CONVERTED 留给 Service 的架构拒绝", async () => {
    const f = await buildFixture();
    const created = await f.caller.createFromConclusion({ conclusionId: f.conclusionId });
    const candidateId = created.candidate.id as number;
    await expectTrpcError(
      f.caller.transition({ candidateId, to: "PUBLISHED" } as never),
      "BAD_REQUEST",
    );
    const err = await expectTrpcError(
      f.caller.transition({ candidateId, to: "CONVERTED" }),
      "CONFLICT",
    );
    expect(err.message).toContain("promote");
  });
});

describe("RESEARCH-006.2 · Router 领域错误映射 + 端到端效果", () => {
  it("createFromConclusion：Conclusion 不存在 → NOT_FOUND；被取代 → PRECONDITION_FAILED", async () => {
    const f = await buildFixture();
    await expectTrpcError(
      f.caller.createFromConclusion({ conclusionId: 999999999 }),
      "NOT_FOUND",
    );
    await expectTrpcError(
      f.caller.createFromConclusion({ conclusionId: f.supersededId }),
      "PRECONDITION_FAILED",
    );
  });

  it("重复登记 → CONFLICT", async () => {
    const f = await buildFixture();
    await f.caller.createFromConclusion({ conclusionId: f.conclusionId });
    await expectTrpcError(
      f.caller.createFromConclusion({ conclusionId: f.conclusionId }),
      "CONFLICT",
    );
  });

  it("createFromConclusion → update → transition → get 全链效果可见", async () => {
    const f = await buildFixture();
    const created = await f.caller.createFromConclusion({
      conclusionId: f.conclusionId,
      overrides: { entryRule: { event: "FIRST_LIMIT_UP", timing: "NEXT_OPEN" } },
    });
    const candidateId = created.candidate.id as number;
    expect(created.candidate.status).toBe("DRAFT");
    expect(created.candidate.sourceDatasetVersionId).toBe(DATASET_VERSION_ID);
    expect(created.dataset?.label).toBe("v2");

    const updated = await f.caller.update({
      candidateId,
      patch: { name: "首板回踩不破开盘价", description: "人的描述" },
    });
    expect(updated.name).toBe("首板回踩不破开盘价");

    const moved = await f.caller.transition({ candidateId, to: "REVIEW" });
    expect(moved.status).toBe("REVIEW");

    const view = await f.caller.get({ candidateId });
    expect(view.candidate.name).toBe("首板回踩不破开盘价");
    expect(view.candidate.status).toBe("REVIEW");
    expect(view.candidate.strategyDefinitionId).toBeNull();
    // 真实落库（不是内存里假装）
    expect(await f.repos.candidates.list()).toHaveLength(1);
  });

  it("get 不存在 → NOT_FOUND", async () => {
    const f = await buildFixture();
    await expectTrpcError(f.caller.get({ candidateId: 424242 }), "NOT_FOUND");
  });
});
