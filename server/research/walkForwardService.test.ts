/**
 * STEP 6.5 — WalkForwardService 编排测试。
 *
 * 覆盖（§三十八 WFO Isolation / Strategy Freeze / Cost Freeze）：
 *   窗口独立性（Window 1 OOS 极好/极差不影响 Window 2 选择，Selection 只依赖对应 Validation）、
 *   策略版本冻结（v1 → v2 后仍用 v1）、成本模型冻结（frozen minCommission=1 不被默认 5 覆盖）、
 *   结果聚合 + 序列化 round-trip。
 */

import { describe, expect, it } from "vitest";
import type { BacktestResult, CostModel } from "../engine/domain";
import { makePerformanceMetrics, ResearchEvaluationService } from "./evaluationService";
import { ResearchStrategyRegistry } from "./registry";
import type { ResearchStrategyDefinition } from "./strategyContract";
import type { ResearchExperimentSnapshot } from "./types";
import { deserializeWalkForwardResult, serializeWalkForwardResult, WalkForwardService } from "./walkForwardService";
import type { ResearchBacktestExecutor } from "./runService";
import type { WalkForwardConfig } from "./walkForward";

const CONFIG: WalkForwardConfig = {
  mode: "rolling",
  trainSize: 10,
  validationSize: 5,
  oosSize: 5,
  stepSize: 10,
  datasetRange: { start: "2024-01-01", end: "2024-02-09" },
  selectionMetric: "sharpeRatio",
  selectionDirection: "maximize",
};

const DEFINITION: ResearchStrategyDefinition = {
  strategyId: "strategy-a",
  version: "1.0.0",
  name: "Test Strategy",
  requiredFeatures: [],
  requiredData: [],
  decisionPoint: "open",
  parameterSchema: { parameters: [{ name: "k", type: "number", required: true }] },
};

const COST_MODEL: CostModel = {
  commissionRate: 0.0001,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00002,
  slippageBps: 20,
  lotSize: 100,
  minCommission: 1,
};

function snapshot(experimentId: string, k: number): ResearchExperimentSnapshot {
  return {
    experimentId,
    strategyId: "strategy-a",
    strategyVersion: "1.0.0",
    parameterSet: { k },
    dataset: { startDate: "2024-01-01", endDate: "2024-02-09" },
    backtestConfig: { initialCapital: 100_000, costModel: COST_MODEL },
  };
}

const CANDIDATES = [snapshot("E1", 1), snapshot("E2", 2), snapshot("E3", 3)];

/** 构造一个按 range.start 决定 sharpe 的执行器（用于隔离测试）。 */
function executorByRule(rule: (rangeStart: string, k: number) => number): ResearchBacktestExecutor {
  return async (snap, _definition) => {
    const k = snap.parameterSet.k as number;
    const sharpe = rule(snap.dataset.startDate, k);
    return { performance: makePerformanceMetrics({ sharpeRatio: sharpe }) } as unknown as BacktestResult;
  };
}

describe("WalkForwardService — 窗口独立性（OOS 不影响 Selection）", () => {
  // 验证规则：V0 E1 胜、V1 E3 胜、V2 E1 胜；O0/O1/O2 的 E1 好坏在两轮中相反。
  const validationRule = (start: string, k: number): number => {
    if (start === "2024-01-11") return 4 - k; // V0 → E1(3) 胜
    if (start === "2024-01-21") return k;     // V1 → E3(3) 胜
    if (start === "2024-01-31") return 4 - k; // V2 → E1 胜
    return 0;
  };
  const oosRuleA = (start: string, k: number): number => {
    if (start === "2024-01-16") return k === 1 ? 999 : 0;  // O0: E1 极好
    if (start === "2024-01-26") return k === 1 ? -999 : 0; // O1: E1 极差
    if (start === "2024-02-05") return k === 1 ? 999 : 0;  // O2: E1 极好
    return 0;
  };
  const oosRuleB = (start: string, k: number): number => {
    if (start === "2024-01-16") return k === 1 ? -999 : 0; // O0: E1 极差
    if (start === "2024-01-26") return k === 1 ? 999 : 0;  // O1: E1 极好
    if (start === "2024-02-05") return k === 1 ? -999 : 0; // O2: E1 极差
    return 0;
  };
  const combine = (validation: typeof validationRule, oos: (s: string, k: number) => number) =>
    (start: string, k: number): number => (oos(start, k) !== 0 ? oos(start, k) : validation(start, k));

  async function run(oosRule: (s: string, k: number) => number) {
    const registry = new ResearchStrategyRegistry();
    registry.register(DEFINITION);
    const evalService = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: executorByRule(combine(validationRule, oosRule)),
    });
    const wfo = new WalkForwardService({ evaluationService: evalService });
    return wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });
  }

  it("Window 1 OOS 极好 / Window 2 OOS 极差 → Window 2 选择仍只依赖其 Validation", async () => {
    const result = await run(oosRuleA);
    // Selection 只依赖各窗口 Validation：V0→E1、V1→E3、V2→E1
    expect(result.windows.map((w) => w.experimentId)).toEqual(["E1", "E3", "E1"]);
    // E1 在 W0/W2 被选中，其 OOS 结果确为「极好」（E3 在 W1 的 OOS 为 0，不参与隔离判定）
    expect(result.windows[0]!.oosMetrics!.sharpeRatio).toBe(999);
    expect(result.windows[2]!.oosMetrics!.sharpeRatio).toBe(999);
  });

  it("反向构造（Window 1 OOS 极差 / Window 2 OOS 极好）→ Selection 不变", async () => {
    const result = await run(oosRuleB);
    expect(result.windows.map((w) => w.experimentId)).toEqual(["E1", "E3", "E1"]);
    expect(result.windows[0]!.oosMetrics!.sharpeRatio).toBe(-999);
    expect(result.windows[2]!.oosMetrics!.sharpeRatio).toBe(-999);
  });
});

describe("WalkForwardService — Strategy Version Freeze", () => {
  it("v1 → v2 后重跑，历史候选仍用 v1", async () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(DEFINITION);
    const capturedVersions: string[] = [];
    const executor: ResearchBacktestExecutor = async (snap, definition) => {
      capturedVersions.push(definition.version);
      return { performance: makePerformanceMetrics({ sharpeRatio: 1 }) } as unknown as BacktestResult;
    };
    const evalService = new ResearchEvaluationService({ strategyRegistry: registry, executor });
    const wfo = new WalkForwardService({ evaluationService: evalService });

    await wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });
    // Registry 增加 v2
    registry.register({ ...DEFINITION, version: "2.0.0" });
    const result = await wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });

    expect(capturedVersions.length).toBeGreaterThan(0);
    expect(capturedVersions.every((v) => v === "1.0.0")).toBe(true);
    expect(result.windows.every((w) => w.strategyVersion === "1.0.0")).toBe(true);
  });
});

describe("WalkForwardService — CostModel Freeze", () => {
  it("frozen minCommission=1 不被默认 5 覆盖（WFO/OOS 均用 1）", async () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(DEFINITION);
    const captured: CostModel[] = [];
    const executor: ResearchBacktestExecutor = async (snap) => {
      captured.push(structuredClone(snap.backtestConfig.costModel!));
      return { performance: makePerformanceMetrics({ sharpeRatio: 1 }) } as unknown as BacktestResult;
    };
    const evalService = new ResearchEvaluationService({ strategyRegistry: registry, executor });
    const wfo = new WalkForwardService({ evaluationService: evalService });
    await wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.every((c) => c.minCommission === 1)).toBe(true);
  });
});

describe("WalkForwardService — 结果组装 + 序列化", () => {
  it("结果字段完整（planFingerprint / aggregate / stability / degradation / assessment）", async () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(DEFINITION);
    const evalService = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: executorByRule((_start, k) => k),
    });
    const wfo = new WalkForwardService({ evaluationService: evalService });
    const result = await wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });

    expect(result.planFingerprint).toBeTruthy();
    expect(result.windows.length).toBeGreaterThan(0);
    expect(result.aggregateMetrics.oosWindowCount).toBe(result.windows.length);
    expect(result.aggregateMetrics.oosSucceededCount).toBe(result.windows.length);
    expect(result.parameterStability.windowCount).toBe(result.windows.length);
    expect(result.validationOosAnalysis.evaluatedWindowCount).toBe(result.windows.length);
    expect(result.pbo).toBeNull(); // 未提供 pboInput
    expect(result.overfittingAssessment.status).not.toBe("insufficient_data");
  });

  it("提供 pboInput 时 PBO 被计算并纳入 assessment", async () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(DEFINITION);
    const evalService = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: executorByRule((_start, k) => k),
    });
    const wfo = new WalkForwardService({ evaluationService: evalService });
    const result = await wfo.runWalkForward({
      config: CONFIG,
      candidates: CANDIDATES,
      pboInput: {
        numPartitions: 4,
        selectionMetric: "sharpeRatio",
        selectionDirection: "maximize",
        candidates: [
          { experimentId: "A", parameterSet: { k: 1 }, partitionMetrics: [100, -1, -1, -1] },
          { experimentId: "B", parameterSet: { k: 2 }, partitionMetrics: [1, 1, 1, 1] },
          { experimentId: "C", parameterSet: { k: 3 }, partitionMetrics: [0, 0, 0, 0] },
        ],
      },
    });
    expect(result.pbo).not.toBeNull();
    expect(result.pbo!.pbo).toBe(1);
  });

  it("serialize → deserialize round-trip 语义一致", async () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(DEFINITION);
    const evalService = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: executorByRule((_start, k) => k),
    });
    const wfo = new WalkForwardService({ evaluationService: evalService });
    const result = await wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });
    const restored = deserializeWalkForwardResult(serializeWalkForwardResult(result));
    expect(restored).toEqual(result);
  });
});
