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
import { createInMemoryResearchRepositories, type ResearchRepositories } from "../../researchCore";
import { InMemoryStrategyRepository } from "../strategyPersistence/inMemory";
import { buildStrategyCandidateRouter } from "./router";
import { createStrategyCandidateService, type DatasetVersionReadPort } from "./service";
import { createInMemoryStrategyResearchProvenanceRepository } from "./provenance";
import { StrategyServicePromotionPort } from "./strategyPromotionPort";

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

describe("RESEARCH-006.2 / 006.3 · Router 端点与偷跑检查", () => {
  it("恰好暴露 5 个端点；006.3 起 promote 是**唯一**新增入口（§33）", async () => {
    const f = await buildFixture();
    expect(procedurePaths(f.router).sort()).toEqual([
      "createFromConclusion",
      "get",
      // RESEARCH-006.4.1-B：只读溯源端点（§20/§22）。它不是第二个转正入口 ——
      // 只读 `strategy_research_provenance`，不写任何表、不构造 StrategyDefinition。
      "getVersionProvenance",
      "promote",
      "transition",
      "update",
    ]);
    // 除了 promote，不允许出现任何别的「策略化 / 克隆 / 转正」入口
    const suspicious = procedurePaths(f.router).filter((p) => /clone|inherit|strategy|publish|convert/i.test(p));
    expect(suspicious).toEqual([]);
  });

  it("已注册进 appRouter（research.strategyCandidate.*）—— 只读路由表，不触库", () => {
    const paths = procedurePaths(appRouter);
    expect(paths.filter((p) => p.startsWith("research.strategyCandidate.")).sort()).toEqual([
      "research.strategyCandidate.createFromConclusion",
      "research.strategyCandidate.get",
      "research.strategyCandidate.getVersionProvenance",
      "research.strategyCandidate.promote",
      "research.strategyCandidate.transition",
      "research.strategyCandidate.update",
    ]);
  });
});

// ---------------------------------------------------------------------------
// RESEARCH-006.3 — promote 端点
// ---------------------------------------------------------------------------

const PROMOTE_DATASET_CODE = "first_limit_pullback";
const NOW_ISO = "2026-09-12T10:00:00.000Z";

/** promote 需要装配 Strategy 侧（端口 + 溯源）；Dataset 端口也要能解出 datasetCode。 */
const promoteDatasetPort: DatasetVersionReadPort = {
  async getVersionById(id) {
    return id === DATASET_VERSION_ID
      ? {
          datasetVersionId: id,
          label: "v2",
          status: "READY",
          datasetId: 120001,
          datasetCode: PROMOTE_DATASET_CODE,
        }
      : undefined;
  },
};

function promoteDraft() {
  return {
    entryRule: {
      event: "FIRST_LIMIT_UP",
      timing: "NEXT_OPEN",
      extra: {
        observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
        trigger: "FIRST_VALID_DAY",
        execution: { quantityMethod: "TARGET_WEIGHT", lotSize: 100 },
        position: { sizingMethod: "FIXED_RATIO", positionRatio: 0.2 },
        document: {
          backtestConfig: { initialCapital: 1_000_000 },
          costModel: {
            commissionRate: 0.00025,
            stampDutyRate: 0.0005,
            transferFeeRate: 0.00001,
            slippageBps: 5,
            lotSize: 100,
            minCommission: 5,
          },
        },
      },
    },
    riskRule: { maxPositions: 5 },
    parameterSpace: { holdingDays: { type: "number", min: 1, max: 20, step: 1 } },
  };
}

async function buildPromoteFixture() {
  const repos: ResearchRepositories = createInMemoryResearchRepositories({
    datasetVersionExists: async (id) => id === DATASET_VERSION_ID,
    now: () => new Date(NOW_ISO),
  });
  const experiment = await repos.experiments.create({
    datasetVersionId: DATASET_VERSION_ID,
    name: "E",
    researchType: "EVENT_STUDY",
    status: "COMPLETED",
  });
  const conclusion = await repos.conclusions.create({
    experimentId: experiment.id as number,
    conclusionType: "SUPPORTED",
    title: "T",
    conclusion: "C",
    confidence: 0.8,
  });
  const strategyRepo = new InMemoryStrategyRepository(() => NOW_ISO, {
    datasetRegistry: {
      async getVersionById(id: number) {
        return id === DATASET_VERSION_ID
          ? { id, datasetId: 120001, version: "v2", status: "READY" }
          : undefined;
      },
      async getDefinitionById(datasetId: number) {
        return { id: datasetId, datasetCode: PROMOTE_DATASET_CODE };
      },
    },
  });
  const provenance = createInMemoryStrategyResearchProvenanceRepository({
    now: () => new Date(NOW_ISO),
  });

  const router = buildStrategyCandidateRouter({
    service: createStrategyCandidateService({
      repos,
      datasetVersions: promoteDatasetPort,
      strategies: new StrategyServicePromotionPort(strategyRepo, { codeVersion: "test-1.0.0" }),
      provenance,
    }),
  });
  const caller = router.createCaller({ req: {} as never, res: {} as never, user: adminUser });
  const anonCaller = router.createCaller({ req: {} as never, res: {} as never, user: null });

  return { repos, strategyRepo, provenance, router, caller, anonCaller, conclusionId: conclusion.id as number };
}

/** 走「登记 → 填草稿 → ACCEPTED」所需的最小调用面（结构类型，避免把 tRPC caller 的完整类型摊开）。 */
interface CandidateCaller {
  createFromConclusion(input: { conclusionId: number }): Promise<{ candidate: { id?: number } }>;
  update(input: { candidateId: number; patch: unknown }): Promise<unknown>;
  transition(input: { candidateId: number; to: "REVIEW" | "ACCEPTED" }): Promise<unknown>;
}

/** 走完「登记 → 填草稿 → ACCEPTED」，返回 candidateId。 */
async function acceptedVia(caller: CandidateCaller, conclusionId: number): Promise<number> {
  const created = await caller.createFromConclusion({ conclusionId });
  const candidateId = created.candidate.id as number;
  await caller.update({ candidateId, patch: promoteDraft() as never });
  await caller.transition({ candidateId, to: "REVIEW" });
  await caller.transition({ candidateId, to: "ACCEPTED" });
  return candidateId;
}

describe("RESEARCH-006.3 · Router `promote`（§33 / §34 / §35）", () => {
  it("权限：写端点，未登录 → FORBIDDEN（**不开放 public**）", async () => {
    const f = await buildPromoteFixture();
    await expectTrpcError(f.anonCaller.promote({ candidateId: 1 }), "FORBIDDEN");
  });

  it("入参：未知顶层键 / overrides 里的完整 definition → 传输层 BAD_REQUEST", async () => {
    const f = await buildPromoteFixture();
    await expectTrpcError(
      f.caller.promote({ candidateId: 1, strategyId: "hack" } as never),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      f.caller.promote({ candidateId: 1, overrides: { definition: { entry: {} } } } as never),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      f.caller.promote({ candidateId: 1, overrides: { datasetBinding: { datasetId: 1 } } } as never),
      "BAD_REQUEST",
    );
  });

  it("领域错误 → 稳定 code：不存在 NOT_FOUND / 非 ACCEPTED PRECONDITION_FAILED", async () => {
    const f = await buildPromoteFixture();
    await expectTrpcError(f.caller.promote({ candidateId: 999999999 }), "NOT_FOUND");

    const created = await f.caller.createFromConclusion({ conclusionId: f.conclusionId });
    await expectTrpcError(
      f.caller.promote({ candidateId: created.candidate.id as number }),
      "PRECONDITION_FAILED",
    );
  });

  it("端到端：ACCEPTED → promote → CONVERTED，DTO 五键齐备；再次 promote 幂等", async () => {
    const f = await buildPromoteFixture();
    const candidateId = await acceptedVia(f.caller, f.conclusionId);

    const result = await f.caller.promote({ candidateId });
    expect(result.candidateId).toBe(candidateId);
    expect(result.strategyId).toBe(`cand-${candidateId}`);
    expect(typeof result.strategyVersionId).toBe("number");
    expect(result.strategyVersion).toBe("1.0.0");
    expect(typeof result.provenanceId).toBe("number");
    expect(result.candidateStatus).toBe("CONVERTED");
    expect(result.origin).toBe("DIRECT");
    expect(result.idempotent).toBe(false);

    const view = await f.caller.get({ candidateId });
    expect(view.candidate.status).toBe("CONVERTED");
    expect(view.candidate.strategyDefinitionId).toBe(result.strategyId);

    const again = await f.caller.promote({ candidateId });
    expect(again.idempotent).toBe(true);
    expect(again.strategyVersionId).toBe(result.strategyVersionId);
    expect(await f.strategyRepo.listVersions(result.strategyId)).toHaveLength(1);
    expect(await f.provenance.listByStrategyId(result.strategyId)).toHaveLength(1);
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
