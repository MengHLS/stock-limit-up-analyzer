/**
 * STEP 6.4 — OOS 隔离评估测试。
 *
 * 覆盖（对应验收 §19 / §31 / §32 + §18 可追溯性）：
 *   只接受 FrozenOosCandidate / split fingerprint 一致性 / succeeded 需 metrics / failed 需 error /
 *   NaN metrics 拒绝 / immutable（改结果不影响输入候选）/ 版本 + 成本模型冻结保留。
 */

import { describe, expect, it } from "vitest";
import { buildOosEvaluationResult } from "./oosEvaluation";
import { freezeOosCandidate } from "./validationSelection";
import { makePerformanceMetrics } from "./evaluationService";
import type { ResearchExperimentSnapshot } from "./types";

function snapshot(experimentId: string, strategyVersion = "1.0.0"): ResearchExperimentSnapshot {
  return {
    experimentId,
    strategyId: "leader-candidate-baseline",
    strategyVersion,
    parameterSet: { maxSignals: 5, minScore: null, featureMode: "off" },
    dataset: { startDate: "2024-01-01", endDate: "2024-12-31", universe: "limit-up" },
    backtestConfig: {
      initialCapital: 100_000,
      costModel: {
        commissionRate: 0.0001,
        stampDutyRate: 0.001,
        transferFeeRate: 0.00002,
        slippageBps: 20,
        lotSize: 100,
        minCommission: 1,
      },
    },
  };
}

function frozen(strategyVersion = "1.0.0") {
  return freezeOosCandidate({
    experimentId: "EXP-B",
    snapshot: snapshot("EXP-B", strategyVersion),
    validationMetric: "sharpeRatio",
    validationValue: 2.0,
    validationFingerprint: "fp-split-abc",
    frozenAt: "2026-09-06T00:00:00.000Z",
  });
}

describe("OOS Evaluation — 组装与可追溯性", () => {
  it("succeeded 结果携带完整冻结候选 + 版本 + 成本模型", () => {
    const result = buildOosEvaluationResult({
      candidate: frozen(),
      datasetSplitFingerprint: "fp-split-abc",
      oosRange: { start: "2025-01-01", end: "2025-12-31" },
      status: "succeeded",
      metrics: makePerformanceMetrics({ sharpeRatio: 1.5 }),
    });
    expect(result.status).toBe("succeeded");
    expect(result.frozenCandidate.strategyVersion).toBe("1.0.0");
    expect(result.frozenCandidate.snapshot.backtestConfig.costModel!.minCommission).toBe(1);
    expect(result.metrics!.sharpeRatio).toBe(1.5);
    expect(result.oosRange).toEqual({ start: "2025-01-01", end: "2025-12-31" });
  });

  it("failed 结果必须携带 error", () => {
    const result = buildOosEvaluationResult({
      candidate: frozen(),
      datasetSplitFingerprint: "fp-split-abc",
      oosRange: { start: "2025-01-01", end: "2025-12-31" },
      status: "failed",
      error: "模拟 OOS 崩溃",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("模拟 OOS 崩溃");
    expect(result.metrics).toBeUndefined();
  });
});

describe("OOS Evaluation — 隔离校验", () => {
  it("split fingerprint 与候选 validationFingerprint 不一致 → 抛错", () => {
    expect(() => buildOosEvaluationResult({
      candidate: frozen(),
      datasetSplitFingerprint: "fp-different",
      oosRange: { start: "2025-01-01", end: "2025-12-31" },
      status: "succeeded",
      metrics: makePerformanceMetrics({ sharpeRatio: 1.5 }),
    })).toThrow(/不一致/);
  });

  it("succeeded 缺 metrics → 抛错", () => {
    expect(() => buildOosEvaluationResult({
      candidate: frozen(),
      datasetSplitFingerprint: "fp-split-abc",
      oosRange: { start: "2025-01-01", end: "2025-12-31" },
      status: "succeeded",
    })).toThrow(/metrics/);
  });

  it("NaN metrics → 抛错（禁止 NaN 进入 OOS 结果）", () => {
    expect(() => buildOosEvaluationResult({
      candidate: frozen(),
      datasetSplitFingerprint: "fp-split-abc",
      oosRange: { start: "2025-01-01", end: "2025-12-31" },
      status: "succeeded",
      metrics: makePerformanceMetrics({ sharpeRatio: NaN }),
    })).toThrow(/有限数字|NaN/);
  });

  it("failed 缺 error → 抛错", () => {
    expect(() => buildOosEvaluationResult({
      candidate: frozen(),
      datasetSplitFingerprint: "fp-split-abc",
      oosRange: { start: "2025-01-01", end: "2025-12-31" },
      status: "failed",
    })).toThrow(/error/);
  });
});

describe("OOS Evaluation — 不可变性", () => {
  it("修改 result.frozenCandidate 不影响输入候选（mutation isolation）", () => {
    const candidate = frozen();
    const result = buildOosEvaluationResult({
      candidate,
      datasetSplitFingerprint: "fp-split-abc",
      oosRange: { start: "2025-01-01", end: "2025-12-31" },
      status: "succeeded",
      metrics: makePerformanceMetrics({ sharpeRatio: 1.5 }),
    });

    result.frozenCandidate.parameters.maxSignals = 999;
    result.frozenCandidate.snapshot.parameterSet.maxSignals = 999;
    result.metrics!.sharpeRatio = 999;

    expect(candidate.parameters.maxSignals).toBe(5);
    expect(candidate.snapshot.parameterSet.maxSignals).toBe(5);
  });
});
