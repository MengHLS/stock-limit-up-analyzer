/**
 * STEP 6.5-FIX-1 — Train Evaluation + Candidate Eligibility 测试。
 *
 * 覆盖验收（§二十七）：
 *   Test A — Train 真正执行（train/validation/oos 三种调用均 > 0）；
 *   Test B — Train Range 正确（executor 收到 TRAIN 区间，而非 validation/oos）；
 *   Test C — Train 与 Validation 隔离（Train 评估只能看到 Train dataset）；
 *   Test D — Validation 仍是唯一 Selection Authority（Train 优但 Validation 差 → 不被选）；
 *   Test E — OOS 不影响 Selection（Validation 优 OOS 差 → 仍被选）；
 *   附加 — Strategy Version Freeze / CostModel Freeze 覆盖 Train 阶段；
 *   Test J — Determinism（同一 Plan 执行两次结果一致）。
 */

import { describe, expect, it } from "vitest";
import type { BacktestResult, CostModel } from "../engine/domain";
import { makePerformanceMetrics, ResearchEvaluationService } from "./evaluationService";
import { ResearchStrategyRegistry } from "./registry";
import type { ResearchStrategyDefinition } from "./strategyContract";
import { filterEligibleTrainCandidates, type TrainCandidateResult } from "./trainEvaluation";
import type { ResearchExperimentSnapshot } from "./types";
import type { ResearchBacktestExecutor } from "./runService";
import { WalkForwardService } from "./walkForwardService";
import type { WalkForwardConfig } from "./walkForward";

// 单窗口配置：train 2024-01-01..01-10 / validation 01-11..01-15 / oos 01-16..01-20。
const CONFIG: WalkForwardConfig = {
  mode: "rolling",
  trainSize: 10,
  validationSize: 5,
  oosSize: 5,
  stepSize: 10,
  datasetRange: { start: "2024-01-01", end: "2024-01-20" },
  selectionMetric: "sharpeRatio",
  selectionDirection: "maximize",
};

const TRAIN_RANGE = { start: "2024-01-01", end: "2024-01-10" };
const VALIDATION_RANGE = { start: "2024-01-11", end: "2024-01-15" };
const OOS_RANGE = { start: "2024-01-16", end: "2024-01-20" };

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
    dataset: { startDate: "2024-01-01", endDate: "2024-01-20" },
    backtestConfig: { initialCapital: 100_000, costModel: COST_MODEL },
  };
}

const CANDIDATES = [snapshot("E1", 1), snapshot("E2", 2), snapshot("E3", 3)];

type Stage = "train" | "validation" | "oos";

interface ExecCall {
  stage: Stage;
  startDate: string;
  endDate: string;
  k: number;
  version: string;
  minCommission: number;
}

function stageOf(startDate: string): Stage {
  if (startDate === TRAIN_RANGE.start) return "train";
  if (startDate === VALIDATION_RANGE.start) return "validation";
  if (startDate === OOS_RANGE.start) return "oos";
  throw new Error(`unexpected startDate: ${startDate}`);
}

/** 按 stage 分派 sharpe 的执行器，并记录每次调用。 */
function executorByStage(
  sharpeByStage: (stage: Stage, k: number) => number,
  calls: ExecCall[],
): ResearchBacktestExecutor {
  return async (snap, definition) => {
    const stage = stageOf(snap.dataset.startDate);
    const k = Number(snap.parameterSet.k);
    calls.push({
      stage,
      startDate: snap.dataset.startDate,
      endDate: snap.dataset.endDate,
      k,
      version: definition.version,
      minCommission: snap.backtestConfig.costModel!.minCommission,
    });
    return { performance: makePerformanceMetrics({ sharpeRatio: sharpeByStage(stage, k) }) } as unknown as BacktestResult;
  };
}

async function runWfo(executor: ResearchBacktestExecutor, registry = new ResearchStrategyRegistry()) {
  registry.register(DEFINITION);
  const evalService = new ResearchEvaluationService({ strategyRegistry: registry, executor });
  const wfo = new WalkForwardService({ evaluationService: evalService });
  return wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });
}

describe("filterEligibleTrainCandidates — 纯函数语义", () => {
  const mk = (experimentId: string, status: "succeeded" | "failed", sharpe?: number, error?: string): TrainCandidateResult => ({
    experimentId,
    parameterSet: { k: 1 },
    status,
    metrics: status === "succeeded" ? makePerformanceMetrics({ sharpeRatio: sharpe }) : undefined,
    error,
  });

  it("succeeded 且 metric 有限 → eligible；失败 → ineligible；null/NaN → ineligible", () => {
    const results = [
      mk("A", "succeeded", 1.5),
      mk("B", "failed", undefined, "boom"),
      mk("C", "succeeded", undefined), // sharpe = null
    ];
    const eligibility = filterEligibleTrainCandidates(results, "sharpeRatio");
    expect(eligibility.eligibleExperimentIds).toEqual(["A"]);
    expect(eligibility.entries.find((e) => e.experimentId === "B")!.eligible).toBe(false);
    expect(eligibility.entries.find((e) => e.experimentId === "B")!.reason).toContain("boom");
    expect(eligibility.entries.find((e) => e.experimentId === "C")!.eligible).toBe(false);
  });

  it("保持输入顺序（确定性，不依赖 Map/DB 顺序）", () => {
    const results = [mk("Z", "succeeded", 1), mk("A", "succeeded", 2), mk("M", "succeeded", 3)];
    expect(filterEligibleTrainCandidates(results, "sharpeRatio").eligibleExperimentIds).toEqual(["Z", "A", "M"]);
  });

  it("非法 selectionMetric 抛错", () => {
    expect(() => filterEligibleTrainCandidates([mk("A", "succeeded", 1)], "bogus" as never)).toThrow();
  });
});

describe("STEP 6.5-FIX-1 — Test A/B/C：Train 真正执行且只看到 Train 区间", () => {
  it("A：train / validation / oos 三种调用均 > 0", async () => {
    const calls: ExecCall[] = [];
    await runWfo(executorByStage((_s, k) => k, calls));
    const byStage = (s: Stage) => calls.filter((c) => c.stage === s).length;
    expect(byStage("train")).toBeGreaterThan(0);
    expect(byStage("validation")).toBeGreaterThan(0);
    expect(byStage("oos")).toBeGreaterThan(0);
    // 3 候选全部 eligible → train 3 次、validation 3 次、oos 1 次（仅冻结候选）。
    expect(byStage("train")).toBe(3);
    expect(byStage("validation")).toBe(3);
    expect(byStage("oos")).toBe(1);
  });

  it("B：Train 阶段收到的是 TRAIN 区间，而非 validation/oos 区间", async () => {
    const calls: ExecCall[] = [];
    await runWfo(executorByStage((_s, k) => k, calls));
    const trainCalls = calls.filter((c) => c.stage === "train");
    expect(trainCalls.length).toBeGreaterThan(0);
    for (const call of trainCalls) {
      expect(call.startDate).toBe(TRAIN_RANGE.start);
      expect(call.endDate).toBe(TRAIN_RANGE.end);
    }
    expect(trainCalls.every((c) => c.startDate !== VALIDATION_RANGE.start && c.startDate !== OOS_RANGE.start)).toBe(true);
  });

  it("C：Train 评估只能看到 Train dataset（不读 validation/oos 数据）", async () => {
    const calls: ExecCall[] = [];
    await runWfo(executorByStage((_s, k) => k, calls));
    const trainCalls = calls.filter((c) => c.stage === "train");
    // 关键：Train 阶段的 dataset 端点是 train range，绝不落在 validation / oos 区间内。
    for (const call of trainCalls) {
      expect(call.startDate >= TRAIN_RANGE.start && call.endDate <= TRAIN_RANGE.end).toBe(true);
      expect(call.endDate < VALIDATION_RANGE.start).toBe(true);
    }
    // 且 validation 阶段从未收到 train 区间。
    const validationCalls = calls.filter((c) => c.stage === "validation");
    expect(validationCalls.every((c) => c.startDate === VALIDATION_RANGE.start)).toBe(true);
  });
});

describe("STEP 6.5-FIX-1 — Test D/E：Train 不越权、OOS 不参与选择", () => {
  it("D：Train 优但 Validation 差 → 不被选；Validation 才是唯一 Selection Authority", async () => {
    const calls: ExecCall[] = [];
    // E1: train=10（优）validation=1（差）；E2: train=2（中）validation=5（最优）。
    const sharpe = (stage: Stage, k: number): number => {
      if (stage === "train") return k === 1 ? 10 : k === 2 ? 2 : 0;
      if (stage === "validation") return k === 1 ? 1 : k === 2 ? 5 : 0;
      return 0;
    };
    const result = await runWfo(executorByStage(sharpe, calls));
    expect(result.windows).toHaveLength(1);
    // Train 优的 E1 不能越权成为 Winner，最终由 Validation 选 E2。
    expect(result.windows[0]!.experimentId).toBe("E2");
    expect(result.windows[0]!.validationMetricValue).toBe(5);
  });

  it("E：Validation 最优但 OOS 差 → 仍被选；OOS 结果不参与 Selection", async () => {
    const calls: ExecCall[] = [];
    // E1: validation=5（最优）oos=0（差）；E2: validation=1（差）oos=99（极好）。
    const sharpe = (stage: Stage, k: number): number => {
      if (stage === "train") return k;
      if (stage === "validation") return k === 1 ? 5 : k === 2 ? 1 : 0;
      return k === 1 ? 0 : k === 2 ? 99 : 0; // oos
    };
    const result = await runWfo(executorByStage(sharpe, calls));
    // Selection 只看 Validation → E1；OOS 极好的 E2 不能被选。
    expect(result.windows[0]!.experimentId).toBe("E1");
    // OOS 只运行冻结的 E1（sharpe=0），而非 E2 的 99。
    const oosCalls = calls.filter((c) => c.stage === "oos");
    expect(oosCalls.map((c) => c.k)).toEqual([1]);
    expect(result.windows[0]!.oosMetrics!.sharpeRatio).toBe(0);
  });
});

describe("STEP 6.5-FIX-1 — Train 阶段 Strategy Version / CostModel Freeze", () => {
  it("Strategy Version Freeze：register v2 后 Train/Validation/OOS 全部用 v1", async () => {
    const registry = new ResearchStrategyRegistry();
    registry.register(DEFINITION);
    const calls: ExecCall[] = [];
    const evalService = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: executorByStage((_s, k) => k, calls),
    });
    const wfo = new WalkForwardService({ evaluationService: evalService });
    await wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });
    // 注册 v2（模拟未来版本出现）。
    registry.register({ ...DEFINITION, version: "2.0.0" });
    await wfo.runWalkForward({ config: CONFIG, candidates: CANDIDATES });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.version === "1.0.0")).toBe(true);
  });

  it("CostModel Freeze：Train/Validation/OOS 使用同一 Frozen CostModel", async () => {
    const calls: ExecCall[] = [];
    await runWfo(executorByStage((_s, k) => k, calls));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.minCommission === 1)).toBe(true);
    // 三个阶段的 costModel 一致（minCommission 全为冻结值 1）。
    const stages = new Set(calls.map((c) => c.stage));
    expect(stages).toEqual(new Set(["train", "validation", "oos"]));
  });
});

describe("STEP 6.5-FIX-1 — Test J：Determinism", () => {
  it("同一 Plan 连续执行两次 → selected id / parameters / train·validation·oos 指标 / fingerprint 一致", async () => {
    const runOnce = async () => {
      const calls: ExecCall[] = [];
      const result = await runWfo(executorByStage((_s, k) => k, calls));
      const w = result.windows[0]!;
      return {
        planFingerprint: result.planFingerprint,
        windowFingerprint: w.windowFingerprint,
        experimentId: w.experimentId,
        parameters: w.parameters,
        trainSharpeByExp: Object.fromEntries(w.trainResults.map((t) => [t.experimentId, t.metrics?.sharpeRatio])),
        validationValue: w.validationMetricValue,
        oosSharpe: w.oosMetrics?.sharpeRatio,
        eligibleCandidateIds: w.eligibleCandidateIds,
      };
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(second).toEqual(first);
    expect(second.experimentId).toBe("E3"); // maximize sharpe → k=3 最优
    expect(second.eligibleCandidateIds).toEqual(["E1", "E2", "E3"]);
  });
});

describe("STEP 6.5-FIX-1 — Train 无 eligible 候选时窗口显式失败（不产生空结果）", () => {
  it("所有候选 Train 失败 → 窗口 failed，error 明确（非静默 empty / 非 pbo=0）", async () => {
    const executor: ResearchBacktestExecutor = async (snap) => {
      if (snap.dataset.startDate === TRAIN_RANGE.start) {
        throw new Error("train data unavailable");
      }
      return { performance: makePerformanceMetrics({ sharpeRatio: 1 }) } as unknown as BacktestResult;
    };
    const result = await runWfo(executor);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]!.status).toBe("failed");
    expect(result.windows[0]!.error).toMatch(/WFO_TRAIN_NO_ELIGIBLE_CANDIDATE|无候选通过/);
    expect(result.windows[0]!.experimentId).toBeNull();
  });
});
