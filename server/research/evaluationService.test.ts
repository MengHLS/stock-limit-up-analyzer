/**
 * STEP 6.4 — Research Evaluation Service 集成测试（编排层）。
 *
 * 用可控 mock executor（复用 ResearchBacktestExecutor 签名）证明端到端链：
 *   Validation → Validation-only Selection → Frozen Candidate → OOS，且：
 *   - §44 OOS 隔离：OOS 结果再好（C=20）也不参与选择，仍运行 Validation 选中的 B；
 *   - §47 策略版本冻结：registry 出现 v2 后 OOS 仍用 v1；
 *   - §48 成本模型冻结：OOS 用候选冻结 costModel，不重读默认；
 *   - §49 确定性：相同输入两次执行结果一致。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLeaderCandidateBaselineResearchDefinition, registerBuiltInResearchStrategies } from "./adapter";
import { ResearchEvaluationService } from "./evaluationService";
import type { ResearchBacktestExecutor } from "./runService";
import { ResearchStrategyRegistry } from "./registry";
import { createResearchEvaluationPlan, type ResearchEvaluationPlan } from "./trainValidationOos";
import type { ResearchDatasetSplit } from "./datasetSplit";
import type { ResearchExperimentSnapshot } from "./types";
import type { BacktestResult, CostModel, PerformanceMetrics } from "../engine/domain";
import { makePerformanceMetrics } from "./evaluationService";

const SPLIT: ResearchDatasetSplit = {
  trainStart: "2020-01-01",
  trainEnd: "2023-12-31",
  validationStart: "2024-01-01",
  validationEnd: "2024-12-31",
  oosStart: "2025-01-01",
  oosEnd: "2025-12-31",
};

const FROZEN_COST: CostModel = {
  commissionRate: 0.0001,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00002,
  slippageBps: 20,
  lotSize: 100,
  minCommission: 1,
};

function candidateSnapshot(experimentId: string, maxSignals: number, strategyVersion = "1.0.0"): ResearchExperimentSnapshot {
  return {
    experimentId,
    strategyId: "leader-candidate-baseline",
    strategyVersion,
    parameterSet: { maxSignals, minScore: null, featureMode: "off" },
    dataset: { startDate: "2024-01-01", endDate: "2024-12-31", universe: "limit-up" },
    backtestConfig: { initialCapital: 100_000, costModel: FROZEN_COST },
  };
}

function makeResult(sharpe: number, startDate: string, endDate: string, strategyVersion: string, cost: CostModel): BacktestResult {
  const performance = makePerformanceMetrics({ sharpeRatio: sharpe, tradeCount: 1 });
  return {
    metadata: {
      strategyId: "leader-candidate-baseline",
      strategyVersion,
      startDate,
      endDate,
      initialCapital: 100_000,
      generatedAt: "2026-09-06T00:00:00.000Z",
    },
    config: {
      strategyId: "leader-candidate-baseline",
      strategyVersion,
      initialCapital: 100_000,
      startDate,
      endDate,
      cost,
      maxPositions: 5,
      maxPositionAmountRatio: 0,
    },
    trades: [],
    equityCurve: [],
    finalPortfolio: { cash: 100_000, marketValue: 0, equity: 100_000, positions: [] },
    performance,
  };
}

interface ExecCall {
  startDate: string;
  maxSignals: number;
  version: string;
  minCommission: number;
}

/** 构造 mock executor：validation 区用 validationSharpe，oos 区用 oosSharpe；记录每次调用。 */
function makeMockExecutor(
  validationSharpe: Record<number, number>,
  oosSharpe: Record<number, number>,
  calls: ExecCall[],
): ResearchBacktestExecutor {
  return async (snapshot, definition) => {
    const maxSignals = Number(snapshot.parameterSet.maxSignals);
    const isValidation = snapshot.dataset.startDate.startsWith("2024");
    const sharpe = isValidation ? validationSharpe[maxSignals] : oosSharpe[maxSignals];
    calls.push({
      startDate: snapshot.dataset.startDate,
      maxSignals,
      version: definition.version,
      minCommission: snapshot.backtestConfig.costModel!.minCommission,
    });
    return makeResult(sharpe, snapshot.dataset.startDate, snapshot.dataset.endDate, definition.version, snapshot.backtestConfig.costModel!);
  };
}

function makePlan(strategyVersion = "1.0.0"): ResearchEvaluationPlan {
  return createResearchEvaluationPlan({
    strategyId: "leader-candidate-baseline",
    strategyVersion,
    split: SPLIT,
    selectionMetric: "sharpeRatio",
    selectionDirection: "maximize",
    parameterSpaceFingerprint: "fp-param-space",
    backtestConfig: { initialCapital: 100_000, costModel: FROZEN_COST },
  });
}

const CANDIDATES = [
  candidateSnapshot("EXP-A", 1),
  candidateSnapshot("EXP-B", 2),
  candidateSnapshot("EXP-C", 3),
];

describe("Research Evaluation Service — 端到端链 + OOS 隔离", () => {
  it("Validation 选 B；OOS 即使 C=20 仍运行冻结的 B（§44）", async () => {
    const registry = new ResearchStrategyRegistry();
    registerBuiltInResearchStrategies(registry);
    const calls: ExecCall[] = [];
    const service = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: makeMockExecutor({ 1: 1.0, 2: 2.0, 3: 1.5 }, { 1: 10, 2: 1, 3: 20 }, calls),
    });
    const plan = makePlan();

    const validationResults = await service.evaluateValidation(CANDIDATES, plan);
    const selection = service.selectValidationCandidate(validationResults, plan);
    expect(selection.selectedExperimentId).toBe("EXP-B");
    expect(selection.selectionValue).toBe(2.0);

    const frozen = service.freezeSelectedCandidate(selection, CANDIDATES);
    expect(frozen.parameters.maxSignals).toBe(2);

    const oos = await service.evaluateOos(frozen, plan);
    expect(oos.status).toBe("succeeded");
    // OOS 结果 = 冻结候选 B（maxSignals=2）在 OOS 区的 sharpe=1，而非 C 的 20。
    expect(oos.frozenCandidate.experimentId).toBe("EXP-B");
    expect(oos.metrics!.sharpeRatio).toBe(1);

    // OOS 区只对 B（maxSignals=2）执行过，从未执行 C（maxSignals=3）。
    const oosCalls = calls.filter((c) => c.startDate.startsWith("2025"));
    expect(oosCalls.map((c) => c.maxSignals)).toEqual([2]);
    expect(oosCalls.some((c) => c.maxSignals === 3)).toBe(false);
  });

  it("反向污染：Validation 选 C（1.0/2.0/3.0 → C），OOS A=100/B=200/C=1 也不重选 A/B（§45）", async () => {
    const registry = new ResearchStrategyRegistry();
    registerBuiltInResearchStrategies(registry);
    const calls: ExecCall[] = [];
    const service = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: makeMockExecutor({ 1: 1.0, 2: 2.0, 3: 3.0 }, { 1: 100, 2: 200, 3: 1 }, calls),
    });
    const plan = makePlan();

    const selection = service.selectValidationCandidate(await service.evaluateValidation(CANDIDATES, plan), plan);
    expect(selection.selectedExperimentId).toBe("EXP-C");

    const frozen = service.freezeSelectedCandidate(selection, CANDIDATES);
    const oos = await service.evaluateOos(frozen, plan);
    expect(oos.frozenCandidate.experimentId).toBe("EXP-C");
    expect(oos.metrics!.sharpeRatio).toBe(1);
    expect(calls.filter((c) => c.startDate.startsWith("2025")).map((c) => c.maxSignals)).toEqual([3]);
  });
});

describe("Research Evaluation Service — 版本 / 成本模型 / 确定性", () => {
  it("策略版本冻结：registry 出现 v2 后 OOS 仍用 v1（§47）", async () => {
    const registry = new ResearchStrategyRegistry();
    registerBuiltInResearchStrategies(registry);
    const calls: ExecCall[] = [];
    const service = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: makeMockExecutor({ 1: 1.0, 2: 2.0, 3: 1.5 }, { 1: 10, 2: 1, 3: 20 }, calls),
    });
    const plan = makePlan("1.0.0");

    const selection = service.selectValidationCandidate(await service.evaluateValidation(CANDIDATES, plan), plan);
    const frozen = service.freezeSelectedCandidate(selection, CANDIDATES);

    // 之后 registry 注册 v2（模拟未来版本出现）。
    const v2 = buildLeaderCandidateBaselineResearchDefinition();
    v2.version = "2.0.0";
    registry.register(v2);

    const oos = await service.evaluateOos(frozen, plan);
    // OOS 仍用 v1（frozen 精确版本），不 getLatest。
    const oosCalls = calls.filter((c) => c.startDate.startsWith("2025"));
    expect(oosCalls.every((c) => c.version === "1.0.0")).toBe(true);
    expect(oos.frozenCandidate.strategyVersion).toBe("1.0.0");
  });

  it("成本模型冻结：OOS 用候选冻结 costModel（minCommission=1），不重读默认（§48）", async () => {
    const registry = new ResearchStrategyRegistry();
    registerBuiltInResearchStrategies(registry);
    const calls: ExecCall[] = [];
    const service = new ResearchEvaluationService({
      strategyRegistry: registry,
      executor: makeMockExecutor({ 1: 1.0, 2: 2.0, 3: 1.5 }, { 1: 10, 2: 1, 3: 20 }, calls),
    });
    const plan = makePlan();

    const selection = service.selectValidationCandidate(await service.evaluateValidation(CANDIDATES, plan), plan);
    const frozen = service.freezeSelectedCandidate(selection, CANDIDATES);
    await service.evaluateOos(frozen, plan);

    const oosCalls = calls.filter((c) => c.startDate.startsWith("2025"));
    expect(oosCalls.every((c) => c.minCommission === 1)).toBe(true);
  });

  it("确定性：相同输入两次执行 selectedExperimentId / parameters / OOS metrics 一致（§49）", async () => {
    const runOnce = async () => {
      const registry = new ResearchStrategyRegistry();
      registerBuiltInResearchStrategies(registry);
      const service = new ResearchEvaluationService({
        strategyRegistry: registry,
        executor: makeMockExecutor({ 1: 1.0, 2: 2.0, 3: 1.5 }, { 1: 10, 2: 1, 3: 20 }, []),
      });
      const plan = makePlan();
      const selection = service.selectValidationCandidate(await service.evaluateValidation(CANDIDATES, plan), plan);
      const frozen = service.freezeSelectedCandidate(selection, CANDIDATES);
      const oos = await service.evaluateOos(frozen, plan);
      return {
        selectedExperimentId: selection.selectedExperimentId,
        parameters: selection.selectedParameters,
        fingerprint: plan.datasetSplitFingerprint,
        oosSharpe: oos.metrics!.sharpeRatio,
      };
    };

    const first = await runOnce();
    const second = await runOnce();
    expect(second).toEqual(first);
    expect(second.selectedExperimentId).toBe("EXP-B");
  });
});

// ---------------------------------------------------------------------------
// Production / Legacy Boundary（验收 §56 / §57 / §58 / G / H）
// ---------------------------------------------------------------------------

describe("STEP 6.4 Boundary — 不复制引擎 / 不反向依赖", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(here, "..", "..");
  const read = (rel: string) => readFileSync(path.resolve(projectRoot, rel), "utf8");

  const step64Modules = [
    "server/research/datasetSplit.ts",
    "server/research/trainValidationOos.ts",
    "server/research/validationSelection.ts",
    "server/research/oosEvaluation.ts",
    "server/research/evaluationService.ts",
  ];

  it("STEP 6.4 模块不直接 import 生产引擎实现（仅类型 + 研究层适配器）", () => {
    const forbidden = [
      /from\s+["'][^"']*engine\/engine["']/,
      /from\s+["'][^"']*engine\/execution["']/,
      /from\s+["'][^"']*engine\/portfolio["']/,
      /from\s+["'][^"']*engine\/performance["']/,
      /from\s+["'][^"']*strategy\/strategyBacktest["']/,
      /from\s+["'][^"']*strategy\/strategies["']/,
    ];
    for (const file of step64Modules) {
      const content = read(file);
      for (const pattern of forbidden) {
        expect(content, `${file} 不应直接依赖生产引擎实现`).not.toMatch(pattern);
      }
    }
  });

  it("STEP 6.4 模块不重新实现引擎 / 交易（无 ResearchBacktestEngine / simulateRealisticTPlus1ToTPlus2）", () => {
    for (const file of step64Modules) {
      const content = read(file);
      expect(content, `${file} 不应含重复引擎实现`).not.toContain("ResearchBacktestEngine");
      expect(content, `${file} 不应含 legacy 模拟器`).not.toContain("simulateRealisticTPlus1ToTPlus2");
    }
  });

  it("生产核心仍不反向依赖 research（STEP 6.4 新增后边界保持）", () => {
    const productionFiles = [
      "server/engine/engine.ts",
      "server/engine/domain.ts",
      "server/engine/execution.ts",
      "server/engine/portfolio.ts",
      "server/engine/performance.ts",
      "server/strategy/strategyBacktest.ts",
    ];
    for (const file of productionFiles) {
      const content = read(file);
      expect(content, `${file} 不应依赖 research`).not.toMatch(/from\s+["'][^"']*research[^"']*["']/);
    }
  });
});
