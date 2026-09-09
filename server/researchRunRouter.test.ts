/**
 * FE-0 扩展 — researchRun Router 契约单测（catalog + readiness，纯只读）。
 *
 * 覆盖：
 * 1. appRouter 注册守卫（researchRun.catalog.list / researchRun.readiness 已暴露）；
 * 2. catalog.list —— 内置策略（leader-candidate-baseline）已装配且元数据完整；
 * 3. run.readiness —— 读真实认证快照（docs/researchReadyGate/*.json 存在性为真），
 *    在 RESEARCH_READY=FALSE 期间 must 为 DATASET_NOT_READY 且 canRun=false；
 *    断言不写死 PENDING 清单（防认证快照演进导致测试漂移）；
 * 4. 就绪判定铁律：executorBound=false 恒定（v1），因此即使数据认证翻绿，
 *    verdict 也不会冒充 READY_TO_RUN。
 *
 * 不覆盖（诚实声明）：真实 run/backtest 执行 —— 执行器未绑定（CL_RUNNER_NOT_INJECTED），
 * 本 router 不发起执行；该链路由 P1 数据认证 + 执行链装配集成后另行验证。
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

const ctx = { req: {} as never, res: {} as never, user: null };
const caller = appRouter.createCaller(ctx);

describe("FE-0 · researchRun appRouter 注册守卫", () => {
  it("researchRun.catalog.list 与 researchRun.readiness 已暴露", () => {
    const keys = Object.keys((appRouter as any)._def.procedures) as string[];
    expect(keys).toContain("researchRun.catalog.list");
    expect(keys).toContain("researchRun.readiness");
  });
});

describe("FE-0 · researchRun.catalog.list", () => {
  it("返回已装配的内置研究策略（leader-candidate-baseline）", async () => {
    const items = await caller.researchRun.catalog.list();
    const baseline = items.find(
      item => item.strategyId === "leader-candidate-baseline"
    );
    expect(baseline).toBeDefined();
    expect(baseline?.version).toBe("1.0.0");
    expect(baseline?.name).toBe("龙头候选原始评分");
    expect(baseline?.decisionPoint).toBe("close");
    expect(baseline?.requiredData).toContain("leaderCandidateDataView");
    expect(baseline?.requiredFeatures).toContain("limitUpHit");
    expect(baseline?.parameterCount).toBeGreaterThanOrEqual(3);
  });

  it("全部条目过 output schema（经 caller 自动校验）", async () => {
    const items = await caller.researchRun.catalog.list();
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(typeof item.strategyId).toBe("string");
      expect(typeof item.version).toBe("string");
      expect(
        item.decisionPoint === "close" || item.decisionPoint === "open"
      ).toBe(true);
    }
  });
});

describe("FE-0 · researchRun.readiness", () => {
  it("认证快照可读且 RESEARCH_READY=FALSE 期间诚实 BLOCKED（DATASET_NOT_READY）", async () => {
    const r = await caller.researchRun.readiness();
    // v1 恒定：执行器未绑定 → 无论数据状态都不允许跑
    expect(r.executorBound).toBe(false);
    expect(r.canRun).toBe(false);
    // 证据文件在项目内存在（真实只读）→ evidenceAvailable=true；数据未认证 →
    // 主因 DATASET_NOT_READY
    expect(r.datasetGate?.evidenceAvailable).toBe(true);
    expect(r.verdict).toBe("DATASET_NOT_READY");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2); // 数据未认证 + 执行器未绑定
  });

  it("策略目录随 readiness 返回（与 catalog.list 一致）", async () => {
    const r = await caller.researchRun.readiness();
    expect(r.strategies.length).toBeGreaterThanOrEqual(1);
    expect(r.strategies[0]?.strategyId.length).toBeGreaterThan(0);
  });
});
