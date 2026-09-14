/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 留档摘要纯函数测试。
 *
 * 关注的是**留档会不会说谎**，而不是「能不能跑」：
 *   A. 完整结果 ⇒ 摘要逐字段正确（与结果同源，不漂移）；
 *   B. `assembly` 为 null（未走真实装配）⇒ 数据来源类字段**全 null**，且**不抛错**；
 *   C. backtest 阶段未 EXECUTED / 产出 kind 不符 ⇒ 成交与权益字段为 **null**（不是 0）；
 *   D. 真实 0 与「取不到」必须区分：0 笔成交要如实记 0，不能与 null 混为一谈；
 *   E. 类型不合法（字符串数字 / 缺失）⇒ 一律 null（不做隐式转换）。
 */

import { describe, expect, it } from "vitest";
import {
  buildClosedLoopBacktestRunSummary,
  readBacktestStageOutput,
} from "../../../server/closedLoopBacktestRun/summary";
import type { ClosedLoopRunResult } from "../../../shared/researchContracts";

type StageInput = { stageId: string; state: string; output?: unknown };

function makeResult(overrides?: {
  overall?: Record<string, unknown>;
  stages?: StageInput[];
  assembly?: unknown;
}): ClosedLoopRunResult {
  const stages = (overrides?.stages ?? []).map((s) => ({
    stageId: s.stageId,
    state: s.state,
    outputKind: "",
    outputHandoffFingerprint: null,
    output: s.output ?? null,
    blocked: null,
  }));
  return {
    runId: "clrun-test",
    createdAt: "2025-01-01T00:00:00.000Z",
    chainFingerprint: "chain",
    fingerprint: "fp",
    overall: {
      status: "ALL_EXECUTED",
      executedStageCount: 6,
      blockedStageCount: 0,
      skippedStageCount: 8,
      firstBlockedReasonCode: null,
      synthetic: false,
      note: "",
      ...(overrides?.overall ?? {}),
    },
    runnerInjected: [],
    stages,
    blockedSummary: [],
    wiring: { wiredStages: [], unwiredStages: [], coveredStages: [], executorBound: false },
    assembly: overrides?.assembly ?? null,
  } as unknown as ClosedLoopRunResult;
}

const BACKTEST_OUTPUT = {
  kind: "backtestSummary",
  initialCapital: 100000,
  finalEquity: 112169.43,
  decisionDayCount: 57,
  equityCurvePointCount: 57,
  tradeCount: 133,
};

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

describe("buildClosedLoopBacktestRunSummary", () => {
  it("A. 完整结果 ⇒ 摘要逐字段正确，且与结果同源", () => {
    const result = makeResult({
      stages: [{ stageId: "backtest", state: "EXECUTED", output: BACKTEST_OUTPUT }],
      assembly: FULL_ASSEMBLY,
    });
    const summary = buildClosedLoopBacktestRunSummary(result);

    expect(summary.runId).toBe("clrun-test");
    expect(summary.status).toBe("ALL_EXECUTED");
    expect(summary.executedStageCount).toBe(6);
    expect(summary.blockedStageCount).toBe(0);
    expect(summary.skippedStageCount).toBe(8);
    expect(summary.datasetVersion).toBe("v2");
    expect(summary.datasetVersionId).toBe(390003);
    expect(summary.datasetSource).toBe("rebuild");
    expect(summary.datasetSourceNote).toBe("直读数据集不可撮合，已回落重建");
    expect(summary.recipeId).toBe("first-limit-pullback-hold-shrink");
    expect(summary.initialCapital).toBe(100000);
    expect(summary.finalEquity).toBe(112169.43);
    expect(summary.tradeCount).toBe(133);
    expect(summary.equityCurvePointCount).toBe(57);
  });

  it("B. assembly 为 null ⇒ 数据来源类字段全 null，且不抛错", () => {
    const result = makeResult({
      stages: [{ stageId: "backtest", state: "EXECUTED", output: BACKTEST_OUTPUT }],
      assembly: null,
    });
    const summary = buildClosedLoopBacktestRunSummary(result);

    expect(summary.datasetVersion).toBeNull();
    expect(summary.datasetVersionId).toBeNull();
    expect(summary.datasetSource).toBeNull();
    expect(summary.datasetSourceNote).toBeNull();
    expect(summary.recipeId).toBeNull();
    expect(summary.initialCapital).toBeNull();
    // backtest 产出仍在（与 assembly 无关），应照实保留
    expect(summary.finalEquity).toBe(112169.43);
    expect(summary.tradeCount).toBe(133);
  });

  it("C. backtest 阶段未 EXECUTED ⇒ 成交与权益为 null（不是 0）", () => {
    const blocked = makeResult({
      overall: { status: "PARTIAL_BLOCKED", firstBlockedReasonCode: "CL_UPSTREAM_BLOCKED" },
      stages: [{ stageId: "backtest", state: "BLOCKED" }],
      assembly: FULL_ASSEMBLY,
    });
    const summary = buildClosedLoopBacktestRunSummary(blocked);

    expect(summary.status).toBe("PARTIAL_BLOCKED");
    expect(summary.firstBlockedReasonCode).toBe("CL_UPSTREAM_BLOCKED");
    expect(summary.finalEquity).toBeNull();
    expect(summary.tradeCount).toBeNull();
    expect(summary.equityCurvePointCount).toBeNull();
  });

  it("C2. 产出 kind 不是 backtestSummary ⇒ 同样取不到（不误读其它阶段的产出）", () => {
    const result = makeResult({
      stages: [
        { stageId: "backtest", state: "EXECUTED", output: { kind: "researchDataset", finalEquity: 1 } },
      ],
    });
    expect(readBacktestStageOutput(result)).toBeNull();
    expect(buildClosedLoopBacktestRunSummary(result).finalEquity).toBeNull();
  });

  it("D. 真实 0 与「取不到」必须区分：0 笔成交如实记 0", () => {
    const result = makeResult({
      stages: [
        {
          stageId: "backtest",
          state: "EXECUTED",
          output: { kind: "backtestSummary", tradeCount: 0, finalEquity: 100000, equityCurvePointCount: 0 },
        },
      ],
    });
    const summary = buildClosedLoopBacktestRunSummary(result);

    expect(summary.tradeCount).toBe(0);
    expect(summary.finalEquity).toBe(100000);
    expect(summary.equityCurvePointCount).toBe(0);
  });

  it("E. 类型不合法（字符串数字 / NaN）⇒ 一律 null，不做隐式转换不猜测", () => {
    const result = makeResult({
      stages: [
        {
          stageId: "backtest",
          state: "EXECUTED",
          output: { kind: "backtestSummary", tradeCount: "133", finalEquity: Number.NaN },
        },
      ],
      assembly: { datasetVersionId: "390003", recipeId: 42, initialCapital: "100000" },
    });
    const summary = buildClosedLoopBacktestRunSummary(result);

    // 字符串 "390003" 是能转成数字的，但**不转** —— 静默转换会把「字段类型错了」
    // 伪装成「一切正常」，那正是留档最不该有的行为。
    expect(summary.datasetVersionId).toBeNull();
    expect(summary.recipeId).toBeNull();
    expect(summary.initialCapital).toBeNull();
    expect(summary.finalEquity).toBeNull();
    expect(summary.tradeCount).toBeNull();
  });
});
