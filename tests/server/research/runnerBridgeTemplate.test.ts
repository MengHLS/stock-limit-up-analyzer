import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNNER_EVALUATION_CONTEXT,
  exitPolicyDefinitionErrors,
  runnerBridgePolicyErrors,
  type RunnerHoldingBridgePolicyDefinition,
} from "../../../server/research/exitPolicyCommon";
import {
  evaluateRunnerHoldingBridgeStateByRegistry,
  evaluateRunnerStateCondition,
  runnerBridgeLifecycleState,
} from "../../../server/research/stateFactorRegistry";
import {
  createStrategyDefinition,
  validateCanonicalStrategyDefinition,
  type StrategyDefinitionInput,
} from "../../../server/research/strategySchema";
import { FIRST_BOARD_PULLBACK_DEFINITION } from "../../../server/research/strategySchema/goldenSample";

const legacyBridge: RunnerHoldingBridgePolicyDefinition = {
  kind: "PIT_RUNNER_HOLDING_BRIDGE",
  state: "NEW_HIGH_3",
  decisionHoldingDays: 5,
  extendToHoldingDays: 20,
};

describe("RunnerBridge 泛化", () => {
  it("legacy 3570001 形状继续通过，且决策日不再固定为 5", () => {
    expect(runnerBridgePolicyErrors(legacyBridge)).toEqual([]);
    expect(runnerBridgePolicyErrors({ ...legacyBridge, decisionHoldingDays: 3, extendToHoldingDays: 8 })).toEqual([]);
    expect(exitPolicyDefinitionErrors({
      stop: { anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 }, confirmation: "INTRADAY" },
      takeProfit: null,
      timeExit: { kind: "FIXED_HOLDING_DAYS", holdingDays: 3 },
      strongHold: null,
      capitalRecycle: null,
      runnerBridge: { ...legacyBridge, decisionHoldingDays: 3, extendToHoldingDays: 8 },
    })).toEqual([]);
  });

  it("stateCondition 与 state 恰有其一，evaluationContext 必须是 PIT", () => {
    const declared: RunnerHoldingBridgePolicyDefinition = {
      kind: "PIT_RUNNER_HOLDING_BRIDGE",
      stateCondition: { stateId: "MA10_SLOPE_POSITIVE", version: "1" },
      decisionHoldingDays: 4,
      extendToHoldingDays: 10,
      evaluationContext: DEFAULT_RUNNER_EVALUATION_CONTEXT,
    };
    expect(runnerBridgePolicyErrors(declared)).toEqual([]);
    expect(runnerBridgePolicyErrors({ ...legacyBridge, stateCondition: declared.stateCondition })).not.toEqual([]);
    expect(runnerBridgePolicyErrors({ kind: "PIT_RUNNER_HOLDING_BRIDGE", decisionHoldingDays: 5, extendToHoldingDays: 20 })).not.toEqual([]);
    expect(runnerBridgePolicyErrors({ ...declared, evaluationContext: { ...DEFAULT_RUNNER_EVALUATION_CONTEXT, usesForwardData: true } })).not.toEqual([]);
  });

  it("状态注册表执行 NEW_HIGH_3，且生命周期覆盖 PENDING → STATE_EVALUATION → EXTEND / NORMAL_EXIT", () => {
    const bars = [
      { timestamp: "2025-01-02", high: 10, low: 9, close: 9.5, volume: 100 },
      { timestamp: "2025-01-03", high: 11, low: 9, close: 10.5, volume: 100 },
      { timestamp: "2025-01-06", high: 12, low: 10, close: 11.5, volume: 100 },
      { timestamp: "2025-01-07", high: 13, low: 11, close: 12.5, volume: 100 },
    ] as never;
    expect(evaluateRunnerHoldingBridgeStateByRegistry("NEW_HIGH_3", bars, "2025-01-02", "2025-01-07")).toBe(true);
    expect(evaluateRunnerStateCondition({ stateId: "NEW_HIGH_3", version: "1" }, { bars, entryTime: "2025-01-02", currentDate: "2025-01-07" })).toBe(true);
    expect(runnerBridgeLifecycleState({ holdingDays: 2, decisionHoldingDays: 5 })).toBe("PENDING");
    expect(runnerBridgeLifecycleState({ holdingDays: 5, decisionHoldingDays: 5 })).toBe("STATE_EVALUATION");
    expect(runnerBridgeLifecycleState({ holdingDays: 5, decisionHoldingDays: 5, stateMatched: true })).toBe("EXTEND");
    expect(runnerBridgeLifecycleState({ holdingDays: 5, decisionHoldingDays: 5, stateMatched: false })).toBe("NORMAL_EXIT");
  });
});

describe("StrategyDefinition State / Factor 声明", () => {
  const base = structuredClone(FIRST_BOARD_PULLBACK_DEFINITION) as StrategyDefinitionInput;
  const withStateFactors: StrategyDefinitionInput = {
    ...base,
    stateFactors: {
      states: [
        {
          id: "runner-state",
          stateId: "NEW_HIGH_3",
          version: "1",
          enabled: true,
          evaluationContext: DEFAULT_RUNNER_EVALUATION_CONTEXT,
        },
      ],
      factors: [
        {
          id: "ma10-slope",
          featureId: "ma10Slope",
          featureVersion: "1",
          operator: "GREATER_THAN",
          value: 0,
          valueType: "CONSTANT",
          enabled: true,
        },
      ],
    },
  };

  it("状态 / 因子成为定义声明，而不是通用层硬编码", () => {
    expect(validateCanonicalStrategyDefinition(withStateFactors).valid).toBe(true);
    const created = createStrategyDefinition(withStateFactors);
    expect(created.stateFactors?.states?.[0]?.stateId).toBe("NEW_HIGH_3");
    expect(created.stateFactors?.factors?.[0]?.featureId).toBe("ma10Slope");
  });

  it("重复声明 id 响亮拒绝", () => {
    const invalid = structuredClone(withStateFactors);
    invalid.stateFactors = {
      states: [
        { id: "dup", stateId: "NEW_HIGH_3", version: "1", enabled: true },
        { id: "dup", stateId: "MA10_SLOPE_POSITIVE", version: "1", enabled: true },
      ],
    };
    expect(validateCanonicalStrategyDefinition(invalid).valid).toBe(false);
  });
});
