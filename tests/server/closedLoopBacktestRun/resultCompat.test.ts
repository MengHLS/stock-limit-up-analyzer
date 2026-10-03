/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 留档**读时兼容层**纯函数测试。
 *
 * 关注的是「留档会不会被静默吞掉 / 会不会被编造」，而不是「能不能跑」：
 *   A. 对得上当前契约 ⇒ 原样通过，`upgradedFrom === null`，字段一个不动；
 *   B. pre-STRATEGY-ARCH-002 形态（缺 `assembly.strategyDecisionEngine*`）⇒ 走已登记的
 *      升级路径，补出的值必须是 `legacy-recipe` + **写明依据的非空说明**（不许静默补）；
 *   C. 与旧契约无关的**自造最小结果**（STRATEGY-3570001 脚本形态）⇒ 判 `unreadable`，
 *      **不得**被误当成「旧版契约」升级，且原因要能指到具体字段；
 *   D. 非对象 ⇒ `unreadable`（由仓库层负责把「文本都解析不了」升级成响亮抛错）。
 */

import { describe, expect, it } from "vitest";
import {
  PRE_STRATEGY_ARCH_002_NOTE,
  reconcileArchivedClosedLoopResult,
} from "../../../server/closedLoopBacktestRun/resultCompat";

/** 当前契约下的完整 `assembly`（写死形状，不用 any，schema 一改就会红）。 */
const FULL_ASSEMBLY = {
  datasetVersion: "v2",
  datasetGate: "PASS",
  datasetRowCount: 292489,
  datasetSecurityCount: 1200,
  datasetSource: "rebuild",
  datasetSourceNote: "直读数据集不可撮合，已回落重建",
  datasetVersionId: 390003,
  dateRange: { startDate: "2025-01-02", endDate: "2025-03-31" },
  strategyId: "cand-360001",
  strategyVersion: "1.0.0",
  recipeId: "first-limit-pullback-hold-shrink",
  recipeSource: "strategy-document",
  recipeFeatureIds: ["f1"],
  selectionSummary: "",
  simulation: {
    initialCapital: 100000,
    maxPositions: 5,
    maxDailyBuys: null,
    executionModel: "NEXT_OPEN",
    costModel: {
      commissionRate: 0.00025,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      slippageBps: 5,
      lotSize: 100,
      minCommission: 5,
    },
  },
};

/** 一次合法的闭环结果；`withEngine=false` 时**去掉** Strategy Core 那两个字段。 */
function makeResult(withEngine: boolean): Record<string, unknown> {
  const { simulation, ...assemblyRest } = FULL_ASSEMBLY;
  return {
    runId: "clrun-test",
    createdAt: "2025-01-01T00:00:00.000Z",
    chainFingerprint: "chain",
    fingerprint: "fp",
    overall: {
      status: "ALL_EXECUTED",
      executedStageCount: 1,
      blockedStageCount: 0,
      skippedStageCount: 0,
      firstBlockedReasonCode: null,
      synthetic: false,
      note: "",
    },
    runnerInjected: ["backtest"],
    stages: [
      {
        stageId: "backtest",
        state: "EXECUTED",
        outputKind: "backtestSummary",
        outputHandoffFingerprint: null,
        output: { kind: "backtestSummary" },
        blocked: null,
      },
    ],
    blockedSummary: [],
    wiring: {
      requestedStages: ["backtest"],
      wiredStages: ["backtest"],
      unwiredStages: [],
      coveredStages: ["backtest"],
      uncoveredStages: [],
      executorBound: true,
    },
    assembly: {
      ...assemblyRest,
      simulation,
      ...(withEngine
        ? {
            strategyDecisionEngine: "strategy-core",
            strategyDecisionEngineNote: "Core 定义可构造，判定由 StrategyRuntime.evaluate 产出。",
          }
        : {}),
    },
  };
}

/** STRATEGY-3570001 脚本自造的最小结果（`scripts/_createPaperTrading3570001.mts` 的形状）。 */
function makeFabricatedMinimalResult(): Record<string, unknown> {
  return {
    runId: "paper-3570001-2025-01-01-2026-09-04",
    createdAt: "2026-10-03T01:44:09.000Z",
    chainFingerprint: "chain",
    fingerprint: "fp",
    overall: {
      status: "ALL_EXECUTED",
      executedStageCount: 14,
      blockedStageCount: 0,
      skippedStageCount: 0,
      firstBlockedReasonCode: null,
      synthetic: false,
      note: "3570001 每日模拟盘",
    },
    runnerInjected: ["research", "backtest", "evaluation"],
    stages: [
      {
        stageId: "backtest",
        state: "EXECUTED",
        output: { kind: "backtestSummary" },
      },
    ],
    blockedSummary: [],
    wiring: { coverageRatio: 1, enforcedCount: 3, declaredOnlyCount: 0, notDeclaredCount: 0, items: [] },
    assembly: { datasetVersion: "v7", datasetSource: "registry", recipeId: "x", simulation: {} },
  };
}

describe("reconcileArchivedClosedLoopResult", () => {
  it("A. 对得上当前契约 ⇒ 原样通过，不做任何升级", () => {
    const raw = makeResult(true);
    const out = reconcileArchivedClosedLoopResult(raw);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.upgradedFrom).toBeNull();
    expect(out.result.runId).toBe("clrun-test");
    expect((out.result.assembly as { strategyDecisionEngine: string }).strategyDecisionEngine).toBe(
      "strategy-core",
    );
  });

  it("B. pre-STRATEGY-ARCH-002 形态 ⇒ 走已登记升级，且补出的值写明依据", () => {
    const out = reconcileArchivedClosedLoopResult(makeResult(false));
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.upgradedFrom).toBe("pre-strategy-arch-002");
    const assembly = out.result.assembly as {
      strategyDecisionEngine: string;
      strategyDecisionEngineNote: string;
      strategyVersion: string;
    };
    // 只补 Strategy Core 接线之前就不可能存在的两个字段；其余字段原样。
    expect(assembly.strategyDecisionEngine).toBe("legacy-recipe");
    expect(assembly.strategyDecisionEngineNote).toBe(PRE_STRATEGY_ARCH_002_NOTE);
    expect(assembly.strategyVersion).toBe("1.0.0");
  });

  it("C. 自造最小结果 ⇒ 如实判 unreadable，且**不**被误当成旧版契约升级", () => {
    const out = reconcileArchivedClosedLoopResult(makeFabricatedMinimalResult());
    expect(out.status).toBe("unreadable");
    if (out.status !== "unreadable") throw new Error("unreachable");
    // 原因必须能指到具体缺失字段 + 报出总处数，而不是一句含糊的「格式错误」。
    expect(out.reason).toContain("wiring.requestedStages");
    expect(out.reason).toContain("处不符");
  });

  it("C2. 根本没有 assembly 的自造结果 ⇒ 不套用旧版升级（guard 只认「只差那两项」）", () => {
    const raw = makeResult(false);
    delete raw.assembly;
    const out = reconcileArchivedClosedLoopResult(raw);
    expect(out.status).toBe("unreadable");
  });

  it("D. 非对象 ⇒ unreadable", () => {
    for (const bad of [null, 42, "{}", []]) {
      const out = reconcileArchivedClosedLoopResult(bad);
      expect(out.status).toBe("unreadable");
    }
  });
});
