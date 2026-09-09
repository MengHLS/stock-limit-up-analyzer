/**
 * FE-0 — 研究链路 tRPC 契约单测。
 *
 * 覆盖范围（**纯契约层，不触真实 DB**）：
 * 1. shared 契约与后端常量的**一致性守卫**（防静默漂移）；
 * 2. appRouter 注册守卫（R6「研究能力未通过 tRPC 暴露」的回归锁）；
 * 3. 入参 schema 的形态校验；
 * 4. 纯函数端点（strategy.validate / bump / compare、lifecycle.describe / transition）经 caller 走通。
 *
 * 不覆盖范围（诚实声明）：
 * - `historicalState.asOf` 与 `researchDataset.build` **依赖真实 DB**，
 *   按 §0.2「禁止 mock 冒充真实数据」不在单测中伪造；其真实链路验证由既有 CLI smoke
 *   （scripts/runStep125PitAudit.mts / runStep126BuildDataset.mts）与 P1 认证阶段承担。
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import {
  STRATEGY_LIFECYCLE_STATUS_VALUES,
  historicalStateAsOfInputSchema,
  researchDatasetBuildInputSchema,
  lifecycleTransitionInputSchema,
  isoDateSchema,
} from "../shared/researchContracts";
import {
  STRATEGY_LIFECYCLE_STATUSES,
  createStrategyLifecycleRecord,
} from "./research";

/** 最小 ctx（publicProcedure 不需要 user）。 */
const ctx = { req: {} as never, res: {} as never, user: null };
const caller = appRouter.createCaller(ctx);

/** 64 位 hex 指纹（测试夹具入参，非伪造结果）。 */
const FINGERPRINT = "a".repeat(64);

describe("FE-0 · 契约一致性守卫", () => {
  it("shared 生命周期状态枚举与后端 STRATEGY_LIFECYCLE_STATUSES 完全一致", () => {
    // 防 shared 复制后端枚举后静默漂移：顺序与内容都必须相同。
    expect([...STRATEGY_LIFECYCLE_STATUS_VALUES]).toEqual([...STRATEGY_LIFECYCLE_STATUSES]);
  });
});

describe("FE-0 · appRouter 注册（R6 回归锁）", () => {
  it("historicalState / researchDataset / research 三个 router 均已暴露", () => {
    expect(appRouter).toHaveProperty("historicalState");
    expect(appRouter).toHaveProperty("researchDataset");
    expect(appRouter).toHaveProperty("research");
  });

  it("research 下含 strategy 与 lifecycle 子路由", () => {
    expect((appRouter as unknown as Record<string, unknown>).research).toBeDefined();
    const researchShape = (appRouter as any)._def.procedures;
    expect(Object.keys(researchShape)).toContain("research.strategy.validate");
    expect(Object.keys(researchShape)).toContain("research.lifecycle.describe");
    expect(Object.keys(researchShape)).toContain("historicalState.asOf");
    expect(Object.keys(researchShape)).toContain("researchDataset.build");
  });
});

describe("FE-0 · 入参 schema 校验", () => {
  it("isoDateSchema 拒绝非 YYYY-MM-DD", () => {
    expect(isoDateSchema.safeParse("2026-09-07").success).toBe(true);
    expect(isoDateSchema.safeParse("2026/09/07").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-9-7").success).toBe(false);
  });

  it("historicalState.asOf 入参：缺 securityId 或非法日期被拒", () => {
    expect(historicalStateAsOfInputSchema.safeParse({ securityId: "", tradeDate: "2026-09-07" }).success).toBe(false);
    expect(historicalStateAsOfInputSchema.safeParse({ securityId: "sec_1", tradeDate: "20260907" }).success).toBe(false);
    expect(historicalStateAsOfInputSchema.safeParse({ securityId: "sec_1", tradeDate: "2026-09-07" }).success).toBe(true);
  });

  it("researchDataset.build 入参：名称/日期校验 + 限流字段为正整数", () => {
    expect(researchDatasetBuildInputSchema.safeParse({ name: "", startDate: "2026-09-01", endDate: "2026-09-04" }).success).toBe(false);
    expect(researchDatasetBuildInputSchema.safeParse({ name: "ds", startDate: "2026-09-01", endDate: "2026-09-04", maxTradingDays: 0 }).success).toBe(false);
    expect(researchDatasetBuildInputSchema.safeParse({ name: "ds", startDate: "2026-09-01", endDate: "2026-09-04", maxTradingDays: 5 }).success).toBe(true);
  });

  it("lifecycle.transition 入参：reason 非空（§23 四要素）", () => {
    const ok = lifecycleTransitionInputSchema.safeParse({ to: "Research", timestamp: "2026-09-07T00:00:00Z", reason: "进入研究" });
    expect(ok.success).toBe(true);
    expect(lifecycleTransitionInputSchema.safeParse({ to: "Research", timestamp: "t", reason: "" }).success).toBe(false);
    expect(lifecycleTransitionInputSchema.safeParse({ to: "Nope", timestamp: "t", reason: "r" }).success).toBe(false);
  });
});

describe("FE-0 · 纯函数端点（经 tRPC caller）", () => {
  it("research.strategy.validate：非法本体返回 valid=false 且不抛异常", async () => {
    const result = await caller.research.strategy.validate({ document: { recordKind: "WRONG" } });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("research.strategy.bump：semver 推进语义正确", async () => {
    expect(await caller.research.strategy.bump({ version: "1.2.3", bump: "patch" })).toEqual({ version: "1.2.4" });
    expect(await caller.research.strategy.bump({ version: "1.2.3", bump: "minor" })).toEqual({ version: "1.3.0" });
    expect(await caller.research.strategy.bump({ version: "1.2.3", bump: "major" })).toEqual({ version: "2.0.0" });
  });

  it("research.lifecycle.describe：返回后端权威 8 态与迁移表", async () => {
    const described = await caller.research.lifecycle.describe();
    expect(described.statuses).toEqual([...STRATEGY_LIFECYCLE_STATUSES]);
    expect(described.statuses).toHaveLength(8);
    expect(described.transitions).toBeDefined();
  });

  it("research.lifecycle.transition：合法相邻迁移返回新记录（append-only，不改原记录）", async () => {
    const record = createStrategyLifecycleRecord({
      strategyId: "STRAT-0001",
      strategyVersion: "1.0.0",
      versionRecordFingerprint: FINGERPRINT,
      timestamp: "2026-09-07T00:00:00.000Z",
      reason: "FE-0 契约单测建壳",
    });

    const next = await caller.research.lifecycle.transition({
      record: record as unknown as Record<string, unknown>,
      input: { to: "Research", timestamp: "2026-09-07T01:00:00.000Z", reason: "进入研究态" },
    });

    expect(next.status).toBe("Research");
    expect(next.transitions.length).toBe(record.transitions.length + 1);
    // 原记录不可变（append-only 语义）。
    expect(record.status).toBe("Draft");
  });

  it("research.lifecycle.transition：跳级迁移被拒绝（不静默成功）", async () => {
    const record = createStrategyLifecycleRecord({
      strategyId: "STRAT-0002",
      strategyVersion: "1.0.0",
      versionRecordFingerprint: FINGERPRINT,
      timestamp: "2026-09-07T00:00:00.000Z",
      reason: "FE-0 契约单测建壳",
    });

    await expect(
      caller.research.lifecycle.transition({
        record: record as unknown as Record<string, unknown>,
        input: { to: "Production", timestamp: "2026-09-07T01:00:00.000Z", reason: "试图跳级" },
      }),
    ).rejects.toThrow();
  });
});
