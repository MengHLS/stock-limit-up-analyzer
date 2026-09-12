/**
 * FE-0 / FE-4 — researchRun Router 契约单测（catalog + readiness + loopRun）。
 *
 * 覆盖：
 * 1. appRouter 注册守卫（catalog.list / readiness / loopRun 已暴露）；
 * 2. catalog.list —— 内置策略（leader-candidate-baseline）已装配且元数据完整；
 * 3. run.readiness —— **真实装配探测**（executorBound 来自 closedLoopWiring 覆盖率，
 *    不再硬编码）+ 认证快照数据侧分支；
 * 4. run.loopRun —— 闭环真实执行：入参齐备的阶段真跑并给出可复算数字，缺入参/无执行器
 *    的阶段如实 BLOCKED（绝不返回占位产物），同输入 → 同链指纹。
 *
 * 边界声明（诚实）：`data` 阶段的真实数据注入（ResearchDataset builder）属 Dataset 侧
 * 集成范围，本 router 不构建数据集——因此 loopRun 的 data 阶段恒为「未注入」。
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { CLOSED_LOOP_STAGE_IDS } from "./research/closedLoop/types";
import { evaluatePerformance } from "./research/performanceMetrics/evaluate";
import { CLOSED_LOOP_STAGE_ID_VALUES } from "../shared/researchContracts";

const ctx = { req: {} as never, res: {} as never, user: null };
const caller = appRouter.createCaller(ctx);

// ---------------------------------------------------------------------------
// 夹具（与 closedLoopWiring.test.ts 同构：结构性真实，不放宽）
// ---------------------------------------------------------------------------

const HEX64 = "c".repeat(64);
const RUN_ID = "clrun-fe4-0001";
const CREATED_AT = "2026-09-11T00:00:00.000Z";
const DATE_RANGE = { startDate: "2026-08-03", endDate: "2026-08-31" };

function equityCurve() {
  const equity = [100000, 101200, 99500, 103400, 102100, 105300];
  return equity.map((value, i) => ({
    date: `2026-08-${String(i + 3).padStart(2, "0")}`,
    cash: value,
    marketValue: 0,
    equity: value,
    openPositions: 0,
  }));
}

function baseRunInput(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    createdAt: CREATED_AT,
    experimentId: "EXP-20260911-FE400001",
    strategyId: "limit-up-baseline",
    strategyVersion: "1.0.0",
    dateRange: { ...DATE_RANGE },
    ...overrides,
  };
}

function backtestSummarySeed(overrides: Record<string, unknown> = {}) {
  return {
    fingerprint: HEX64,
    datasetVersion: "rd-1.0.0-1-0123456789abcdef",
    datasetGate: "PASS",
    dateRange: { ...DATE_RANGE },
    initialCapital: 100000,
    finalEquity: 105300,
    decisionDayCount: 6,
    equityCurvePointCount: 6,
    tradeCount: 0,
    ...overrides,
  };
}

describe("FE-0 · researchRun appRouter 注册守卫", () => {
  it("researchRun.catalog.list / readiness / loopRun 已暴露", () => {
    const keys = Object.keys((appRouter as any)._def.procedures) as string[];
    expect(keys).toContain("researchRun.catalog.list");
    expect(keys).toContain("researchRun.readiness");
    expect(keys).toContain("researchRun.loopRun");
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

describe("FE-4 · 闭环阶段 id 传输契约", () => {
  it("shared 字面量与后端 canonical 阶段链逐项一致（防双份漂移）", () => {
    expect([...CLOSED_LOOP_STAGE_ID_VALUES]).toEqual([...CLOSED_LOOP_STAGE_IDS]);
  });
});

describe("FE-0 · researchRun.readiness（真实装配探测）", () => {
  it("executorBound 来自覆盖率探测，不再硬编码：14 阶段中 6 装配 / 8 无执行器", async () => {
    const r = await caller.researchRun.readiness();
    // 静态装配能力（与后端 wiredClosedLoopStages 同源）
    expect(r.wiring.requestedStages).toHaveLength(14);
    expect(r.wiring.wiredStages).toEqual([
      "data",
      "research",
      "strategy",
      "backtest",
      "evaluation",
      "finalize",
    ]);
    expect(r.wiring.unwiredStages).toEqual([
      "optimization",
      "robustness",
      "oos",
      "overfitting",
      "regime",
      "paper",
      "review",
      "discipline",
    ]);
    // 整链不可覆盖 → 不允许跑（不冒充 READY）
    expect(r.wiring.coveredStages).toEqual([]);
    expect(r.wiring.executorBound).toBe(false);
    expect(r.executorBound).toBe(r.wiring.executorBound);
    expect(r.canRun).toBe(false);
    // 未就绪措辞必须点明「尚无执行器」而非含糊的「尚未实现」
    expect(r.reasons.some(t => t.includes("尚无执行器"))).toBe(true);
    expect(r.reasons.some(t => t.includes("optimization"))).toBe(true);
  });

  it("认证证据真实可读（只读快照，不重算 gate）", async () => {
    const r = await caller.researchRun.readiness();
    expect(r.datasetGate?.evidenceAvailable).toBe(true);
    expect(r.datasetGate?.evidenceError).toBeNull();
  });

  /**
   * ⚠️ 漂移探测器（请勿为了让测试变绿而改回断言）：
   * 当前认证快照 `docs/researchReadyGate/research_ready_gate.json`（capturedAt
   * 2026-09-09T15:07:48Z）判定 researchReady=true（G4 PASS），与 ROADMAP §44 早前
   * 「RESEARCH_READY=FALSE」的表述**不一致**。该快照由认证脚本生成，属数据域治理范围，
   * 本 router 只如实转述。若此断言失败 → 说明快照已被重新生成，请同步更新 ROADMAP §44
   * 表述与 dataHealth 侧期望，而不是修改本断言。
   */
  it("认证快照 researchReady=true → 数据侧放行，主因落到 EXECUTOR_NOT_BOUND", async () => {
    const r = await caller.researchRun.readiness();
    expect(r.datasetGate?.researchReady).toBe(true);
    expect(r.verdict).toBe("EXECUTOR_NOT_BOUND");
    expect(r.reasons.some(t => t.includes("真实执行链未完整绑定"))).toBe(true);
  });

  it("策略目录随 readiness 返回（与 catalog.list 一致）", async () => {
    const r = await caller.researchRun.readiness();
    expect(r.strategies.length).toBeGreaterThanOrEqual(1);
    expect(r.strategies[0]?.strategyId.length).toBeGreaterThan(0);
  });
});

describe("FE-4 · researchRun.loopRun — 真实执行", () => {
  it("零入参全 14 阶段：首阻塞 data（CL_DATA_NOT_INJECTED），无任何执行、无合成产物", async () => {
    const r = await caller.researchRun.loopRun(baseRunInput());
    expect(r.runId).toBe(RUN_ID);
    expect(r.stages).toHaveLength(14);
    expect(r.runnerInjected).toEqual([]);
    expect(r.overall.status).toBe("NO_STAGE_EXECUTED");
    expect(r.overall.executedStageCount).toBe(0);
    expect(r.overall.blockedStageCount).toBe(14);
    expect(r.overall.firstBlockedReasonCode).toBe("CL_DATA_NOT_INJECTED");
    expect(r.overall.synthetic).toBe(false);
    // 未执行阶段不得留下任何产出
    for (const stage of r.stages) {
      expect(stage.state).toBe("BLOCKED");
      expect(stage.output).toBeNull();
      expect(stage.outputHandoffFingerprint).toBeNull();
      expect(stage.blocked?.reasonCode).toBeTruthy();
    }
  });

  it("只跑 evaluation（seed + 直供权益曲线）：EXECUTED 且数字等于真实评估器独立复算", async () => {
    const curve = equityCurve();
    const expected = evaluatePerformance({ equityCurve: curve });

    const r = await caller.researchRun.loopRun(
      baseRunInput({
        stageIds: ["evaluation"],
        evaluationInput: { equityCurve: curve },
        backtestSummarySeed: backtestSummarySeed(),
      })
    );

    expect(r.runnerInjected).toEqual(["evaluation"]);
    const row = r.stages.find(s => s.stageId === "evaluation")!;
    expect(row.state).toBe("EXECUTED");
    expect(row.outputKind).toBe("evaluationRef");

    const ref = row.output as Record<string, any>;
    expect(ref.kind).toBe("evaluationRef");
    expect(ref.backtestFingerprint).toBe(HEX64); // 指纹来自 seed，不由本层推算
    expect(ref.evaluatorsCovered).toEqual([
      "performanceMetrics",
      "riskAdjustedMetrics",
      "tradeQualityMetrics",
    ]);
    // 关键：数字逐位等于真实模块输出
    expect(ref.performance.totalReturnPct).toBe(
      expected.metrics.returns.totalReturnPct
    );
    expect(ref.performance.maxDrawdownPct).toBe(
      expected.metrics.drawdown.maxDrawdownPct
    );
    expect(ref.performance.fingerprint).toBe(expected.fingerprint);
    expect(r.overall.executedStageCount).toBe(1);
    expect(r.overall.synthetic).toBe(false);

    // 覆盖率与注入表一致（探针不说假话）
    expect(r.wiring.coveredStages).toEqual(["evaluation"]);
    expect([...r.runnerInjected]).toEqual([...r.wiring.coveredStages]);
  });

  /**
   * 无任何评估入参 → 执行器未注册 → 编排器报 CL_RUNNER_NOT_INJECTED（而不是
   * CL_MISSING_UPSTREAM_HANDOFF）：因为「没有评估器」比「缺上游交接」更靠前、更准确。
   * 注意 CL_MISSING_UPSTREAM_HANDOFF 在本 API 下**不可达**——只要给了 evaluationInput，
   * 上面的成对校验就强制要求 backtestSummarySeed 同时存在。
   */
  it("evaluation 无任何入参时如实 BLOCKED（CL_RUNNER_NOT_INJECTED），不产出占位评估", async () => {
    const r = await caller.researchRun.loopRun(
      baseRunInput({ stageIds: ["evaluation"] })
    );
    const row = r.stages.find(s => s.stageId === "evaluation")!;
    expect(row.state).toBe("BLOCKED");
    expect(row.output).toBeNull();
    expect(row.outputHandoffFingerprint).toBeNull();
    expect(row.blocked?.reasonCode).toBe("CL_RUNNER_NOT_INJECTED");
    expect(r.runnerInjected).toEqual([]);
  });

  it("evaluationInput 未与 backtestSummarySeed 成对提供 → BAD_REQUEST（拒绝伪绑定）", async () => {
    await expect(
      caller.researchRun.loopRun(
        baseRunInput({
          stageIds: ["evaluation"],
          evaluationInput: { equityCurve: equityCurve() },
        })
      )
    ).rejects.toThrow(/必须与 backtestSummarySeed 一并提供/);
  });

  it("seed 与链内 backtest 阶段冲突 → BAD_REQUEST（不静默丢种子）", async () => {
    await expect(
      caller.researchRun.loopRun(
        baseRunInput({ backtestSummarySeed: backtestSummarySeed() })
      )
    ).rejects.toThrow(/只适用于不含 backtest 阶段的链/);
  });

  it("stageIds 乱序输入归一为拓扑序，且未请求阶段为 SKIPPED", async () => {
    const r = await caller.researchRun.loopRun(
      baseRunInput({
        stageIds: ["evaluation", "finalize", "strategy"],
        evaluationInput: { equityCurve: equityCurve() },
        backtestSummarySeed: backtestSummarySeed(),
      })
    );
    expect(r.wiring.requestedStages).toEqual(["strategy", "evaluation", "finalize"]);
    expect(r.overall.skippedStageCount).toBe(11);
    for (const stage of r.stages) {
      if (["strategy", "evaluation", "finalize"].includes(stage.stageId)) continue;
      expect(stage.state).toBe("SKIPPED");
    }
  });

  it("同输入两次运行 → 链指纹逐位一致（可复现）", async () => {
    const run = () =>
      caller.researchRun.loopRun(
        baseRunInput({
          stageIds: ["evaluation"],
          evaluationInput: { equityCurve: equityCurve() },
          backtestSummarySeed: backtestSummarySeed(),
        })
      );
    const a = await run();
    const b = await run();
    expect(a.chainFingerprint).toBe(b.chainFingerprint);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("runId 缺省时由 createdAt 派生（同 createdAt → 同 runId）", async () => {
    const first = await caller.researchRun.loopRun(
      baseRunInput({
        runId: undefined,
        stageIds: ["evaluation"],
        evaluationInput: { equityCurve: equityCurve() },
        backtestSummarySeed: backtestSummarySeed(),
      })
    );
    const second = await caller.researchRun.loopRun(
      baseRunInput({
        runId: undefined,
        stageIds: ["evaluation"],
        evaluationInput: { equityCurve: equityCurve() },
        backtestSummarySeed: backtestSummarySeed(),
      })
    );
    expect(first.runId).toBe(second.runId);
    expect(first.runId).toMatch(/^clrun-/);
    expect(first.chainFingerprint).toBe(second.chainFingerprint);
  });

  it("非法阶段名被 input schema 拒绝（不静默忽略）", async () => {
    await expect(
      caller.researchRun.loopRun(baseRunInput({ stageIds: ["not-a-stage"] }))
    ).rejects.toThrow();
  });
});
