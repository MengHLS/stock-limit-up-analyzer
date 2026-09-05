/**
 * STEP 6.4 — Validation Selection 测试。
 *
 * 覆盖（对应验收 §42 / §43 / §44 / §46 + §11 / §12 / §13 / §40）：
 *   最高 Sharpe 被选 / 最低 MaxDrawdown 被选 / null·NaN·Infinity 不中选 / 全 invalid 失败 /
 *   tie-break 确定性（重复 100 次一致）/ selectedParameters mutation isolation /
 *   OOS 隔离（selection 签名不接收 OOS）/ 参数冻结（修改 candidate 不影响 snapshot）。
 */

import { describe, expect, it } from "vitest";
import { makePerformanceMetrics } from "./evaluationService";
import type { ResearchExperimentSnapshot } from "./types";
import {
  freezeOosCandidate,
  selectBestValidationResult,
  type SelectionMetric,
  type ValidationCandidateResult,
  type ValidationSelectionInput,
} from "./validationSelection";

function candidate(
  experimentId: string,
  metricValue: number | null,
  metric: "sharpeRatio" | "maxDrawdownPct" | "annualizedReturnPct" = "sharpeRatio",
): ValidationCandidateResult {
  return {
    experimentId,
    parameterSet: { maxSignals: Number(experimentId.slice(-1)) % 3 + 1 },
    status: "succeeded",
    metrics: makePerformanceMetrics({ [metric]: metricValue } as Partial<Record<string, number | null>>),
  };
}

function input(candidates: ValidationCandidateResult[], overrides: Partial<ValidationSelectionInput> = {}): ValidationSelectionInput {
  return {
    candidates,
    selectionMetric: "sharpeRatio",
    selectionDirection: "maximize",
    validationFingerprint: "fp-validation-123",
    ...overrides,
  };
}

describe("Validation Selection — 基本选择", () => {
  it("最高 Sharpe 被选（maximize）", () => {
    const result = selectBestValidationResult(input([
      candidate("EXP-A", 1.0),
      candidate("EXP-B", 2.0),
      candidate("EXP-C", 1.5),
    ]));
    expect(result.selectedExperimentId).toBe("EXP-B");
    expect(result.selectionValue).toBe(2.0);
    expect(result.direction).toBe("maximize");
    expect(result.candidateExperimentIds).toEqual(["EXP-A", "EXP-B", "EXP-C"]);
  });

  it("最低 MaxDrawdown 被选（minimize）", () => {
    const result = selectBestValidationResult(input(
      [
        candidate("EXP-A", 10, "maxDrawdownPct"),
        candidate("EXP-B", 5, "maxDrawdownPct"),
        candidate("EXP-C", 8, "maxDrawdownPct"),
      ],
      { selectionMetric: "maxDrawdownPct", selectionDirection: "minimize" },
    ));
    expect(result.selectedExperimentId).toBe("EXP-B");
    expect(result.selectionValue).toBe(5);
  });
});

describe("Validation Selection — 非法 metric 不中选", () => {
  it("null / NaN / Infinity 候选不会被选择", () => {
    const result = selectBestValidationResult(input([
      candidate("EXP-A", null),
      candidate("EXP-B", NaN),
      candidate("EXP-C", Infinity),
      candidate("EXP-D", 1.0),
    ]));
    expect(result.selectedExperimentId).toBe("EXP-D");
    expect(result.selectionValue).toBe(1.0);
  });

  it("failed 候选不中选", () => {
    const failed: ValidationCandidateResult = {
      experimentId: "EXP-FAIL",
      parameterSet: {},
      status: "failed",
      error: "boom",
    };
    const result = selectBestValidationResult(input([failed, candidate("EXP-OK", 1.0)]));
    expect(result.selectedExperimentId).toBe("EXP-OK");
  });

  it("所有候选 invalid → selection 失败（不偷偷选第一个）", () => {
    expect(() => selectBestValidationResult(input([
      candidate("EXP-A", null),
      candidate("EXP-B", NaN),
      candidate("EXP-C", Infinity),
    ]))).toThrow(/selection 失败|NO_VALID_CANDIDATE/);
  });

  it("非法 selectionMetric → 抛错", () => {
    expect(() => selectBestValidationResult(input([candidate("EXP-A", 1.0)], {
      selectionMetric: "bogusMetric" as unknown as SelectionMetric,
    }))).toThrow(/非法选择指标/);
  });
});

describe("Validation Selection — tie-break 确定性", () => {
  it("相同 metric 按 experimentId 字典序稳定决定（重复 100 次一致）", () => {
    const candidates = [candidate("EXP-C", 1.5), candidate("EXP-A", 1.5), candidate("EXP-B", 1.5)];
    const first = selectBestValidationResult(input(candidates));
    for (let i = 0; i < 100; i++) {
      const result = selectBestValidationResult(input([...candidates].reverse()));
      expect(result.selectedExperimentId).toBe("EXP-A");
    }
    expect(first.selectedExperimentId).toBe("EXP-A");
  });
});

describe("Validation Selection — mutation isolation", () => {
  it("selectedParameters 是独立副本，修改不影响候选", () => {
    const candidates = [candidate("EXP-A", 1.0), candidate("EXP-B", 2.0)];
    const result = selectBestValidationResult(input(candidates));
    result.selectedParameters.maxSignals = 999;
    expect(candidates[1].parameterSet.maxSignals).not.toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Frozen OOS Candidate（§46 / §47 / §48）
// ---------------------------------------------------------------------------

function snapshot(experimentId: string, overrides: Partial<ResearchExperimentSnapshot> = {}): ResearchExperimentSnapshot {
  return {
    experimentId,
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
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
    ...overrides,
  };
}

describe("Frozen OOS Candidate — 参数 / 版本 / 成本模型冻结", () => {
  it("修改 candidate.parameters 不影响原 snapshot（参数冻结）", () => {
    const snap = snapshot("EXP-B");
    const frozen = freezeOosCandidate({
      experimentId: "EXP-B",
      snapshot: snap,
      validationMetric: "sharpeRatio",
      validationValue: 2.0,
      validationFingerprint: "fp-123",
      frozenAt: "2026-09-06T00:00:00.000Z",
    });

    frozen.parameters.maxSignals = 999;
    frozen.snapshot.parameterSet.maxSignals = 999;

    expect(snap.parameterSet.maxSignals).toBe(5);
    expect(frozen.strategyId).toBe("leader-candidate-baseline");
    expect(frozen.strategyVersion).toBe("1.0.0");
  });

  it("策略版本由 snapshot 派生并冻结（v1），不随 registry 漂移", () => {
    const frozen = freezeOosCandidate({
      experimentId: "EXP-B",
      snapshot: snapshot("EXP-B", { strategyVersion: "1.0.0" }),
      validationMetric: "sharpeRatio",
      validationValue: 2.0,
      validationFingerprint: "fp-123",
    });
    expect(frozen.strategyVersion).toBe("1.0.0");
  });

  it("冻结候选保留冻结 costModel（不重读默认成本模型）", () => {
    const frozen = freezeOosCandidate({
      experimentId: "EXP-B",
      snapshot: snapshot("EXP-B"),
      validationMetric: "sharpeRatio",
      validationValue: 2.0,
      validationFingerprint: "fp-123",
    });
    expect(frozen.snapshot.backtestConfig.costModel!.minCommission).toBe(1);
    expect(frozen.snapshot.backtestConfig.costModel!.stampDutyRate).toBe(0.001);
  });

  it("snapshot.experimentId 与 experimentId 不一致 → 抛错", () => {
    expect(() => freezeOosCandidate({
      experimentId: "EXP-OTHER",
      snapshot: snapshot("EXP-B"),
      validationMetric: "sharpeRatio",
      validationValue: 2.0,
      validationFingerprint: "fp-123",
    })).toThrow(/不一致/);
  });

  it("validationValue 非有限 → 抛错", () => {
    expect(() => freezeOosCandidate({
      experimentId: "EXP-B",
      snapshot: snapshot("EXP-B"),
      validationMetric: "sharpeRatio",
      validationValue: NaN,
      validationFingerprint: "fp-123",
    })).toThrow(/有限数字/);
  });
});
