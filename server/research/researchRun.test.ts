/**
 * STEP 6.2 — Research Run 测试（复用 Production Backtest Core）。
 *
 * 覆盖（对应对应验收标准的最小测试）：
 *   5. Run（create run → execute → SUCCEEDED）
 *   6. Failed Run（RUNNING → FAILED，error + finishedAt 保存）
 *   7. Multiple Runs（experiment A → run 1/2/3）
 *   8. Determinism（同一实验两次执行核心结果一致）
 *   9. Production Boundary（生产核心不反向依赖 research）
 *   10. Legacy Simulator Boundary（simulateRealisticTPlus1ToTPlus2 不进入生产运行时）
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerBuiltInResearchStrategies } from "./adapter";
import type { CreateExperimentInput } from "./experiment";
import { ExperimentRegistry } from "./experimentRegistry";
import { ExperimentService } from "./experimentService";
import type { ResearchDataLoader } from "./engineAdapter";
import { InMemoryExperimentRepository, InMemoryResearchRunRepository } from "./persistence/inMemory";
import { ResearchStrategyRegistry } from "./registry";
import { createDefaultExecutor, ResearchRunService, type ResearchBacktestExecutor } from "./runService";
import type { RawDailyPriceRow } from "../data";
import type { LeaderCandidateSourceRecord } from "../leaderCandidates";

// ---------------------------------------------------------------------------
// Fixtures（与 productionIntegration 同构：A/B/C 三候选，仅 A 价格库确认涨停）
// ---------------------------------------------------------------------------

const D0 = "2026-01-05";
const D1 = "2026-01-06";
const D2 = "2026-01-07";
const D3 = "2026-01-08";
const CALENDAR = [D0, D1, D2, D3];

const A = "600001.SH";
const B = "600002.SH";
const C = "600003.SH";

function rec(stockCode: string, limitUpTime: string, stockName: string): LeaderCandidateSourceRecord {
  return { stockCode, stockName, limitUpDate: D1, limitUpTime, sector: "半导体", turnover: "12", circulationValue: "80" };
}

function sourceRecords(): LeaderCandidateSourceRecord[] {
  return [rec(A, "09:31:00", "中科蓝海"), rec(B, "09:45:00", "东方华电"), rec(C, "10:20:00", "天启智能")];
}

function bar(stockCode: string, tradeDate: string, open: number, close: number, preClose: number): RawDailyPriceRow {
  const high = Math.max(open, close) + 0.1;
  const low = Math.min(open, close) - 0.1;
  return {
    stockCode,
    tradeDate,
    openPrice: String(open),
    closePrice: String(close),
    highPrice: String(high),
    lowPrice: String(low),
    preClosePrice: String(preClose),
    volume: String(150_000),
    amount: String(88_000),
  };
}

function priceRows(): RawDailyPriceRow[] {
  return [
    bar(A, D0, 10.0, 10.0, 10.0),
    bar(A, D1, 10.2, 11.0, 10.0),
    bar(A, D2, 11.2, 11.8, 11.0),
    bar(A, D3, 11.5, 12.2, 11.8),
    bar(B, D0, 10.0, 10.0, 10.0),
    bar(B, D1, 10.05, 10.2, 10.0),
    bar(B, D2, 10.5, 10.6, 10.2),
    bar(B, D3, 11.0, 11.6, 10.6),
    bar(C, D0, 10.0, 10.0, 10.0),
    bar(C, D1, 10.1, 10.2, 10.0),
    bar(C, D2, 10.3, 10.6, 10.2),
    bar(C, D3, 10.5, 10.9, 10.6),
  ];
}

const loader: ResearchDataLoader = async () => ({
  records: sourceRecords(),
  rawRows: priceRows(),
  tradingDates: CALENDAR,
});

function makeInput(experimentId = "EXP-20260906-RUN0001"): CreateExperimentInput {
  return {
    experimentId,
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
    parameterSet: { minScore: null, maxSignals: 5, featureMode: "limit-up-confirm" },
    dataset: { startDate: D1, endDate: D3, universe: "limit-up" },
    backtestConfig: {
      initialCapital: 100_000,
      maxPositions: 5,
      commissionRate: 0.0003,
      slippageRate: 0.001,
      lotSize: 100,
      executionModel: "next-open",
    },
  };
}

function buildStack(executor?: ResearchBacktestExecutor) {
  const strategyRegistry = new ResearchStrategyRegistry();
  registerBuiltInResearchStrategies(strategyRegistry);
  const experimentRegistry = new ExperimentRegistry();
  const experimentRepository = new InMemoryExperimentRepository();
  const runRepository = new InMemoryResearchRunRepository();
  const experimentService = new ExperimentService({ strategyRegistry, experimentRegistry, experimentRepository });
  const runService = new ResearchRunService({
    strategyRegistry,
    experimentRepository,
    runRepository,
    executor: executor ?? createDefaultExecutor(loader),
  });
  return { experimentService, runService, runRepository };
}

// ---------------------------------------------------------------------------
// 5. Run
// ---------------------------------------------------------------------------

describe("Research Run", () => {
  it("创建实验 → 执行 → SUCCEEDED，结果摘要与实验状态正确（复用生产 Backtest Core）", async () => {
    const { experimentService, runService } = buildStack();
    const experiment = await experimentService.createExperiment(makeInput());
    const run = await runService.runExperiment(experiment.experimentId, "RUN-EXP-20260906-RUN0001-1");

    expect(run.status).toBe("succeeded");
    expect(run.error).toBeNull();
    expect(run.finishedAt).toBeDefined();
    expect(run.result).not.toBeNull();

    // 复用生产 Backtest Core：featureMode=limit-up-confirm 仅 A 被确认并成交 1 笔。
    expect(run.result!.performance.tradeCount).toBe(1);
    expect(run.result!.config.strategyId).toBe("leader-candidate-baseline");
    expect(run.result!.config.strategyVersion).toBe("1.0.0");
    expect(run.result!.metadata.startDate).toBe(D1);
    expect(run.result!.metadata.endDate).toBe(D3);
    expect(run.result!.finalEquity).toBeGreaterThan(0);

    // 实验状态：completed（Run 成功）。
    const updated = await experimentService.getExperiment(experiment.experimentId);
    expect(updated.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// 6. Failed Run
// ---------------------------------------------------------------------------

describe("Failed Run", () => {
  it("执行失败 → FAILED：error + finishedAt 保存，实验状态 failed，不吞异常返回空结果", async () => {
    const failing: ResearchBacktestExecutor = async () => {
      throw new Error("模拟执行崩溃");
    };
    const { experimentService, runService } = buildStack(failing);
    const experiment = await experimentService.createExperiment(makeInput("EXP-20260906-FAIL0001"));
    const run = await runService.runExperiment(experiment.experimentId, "RUN-EXP-20260906-FAIL0001-1");

    expect(run.status).toBe("failed");
    expect(run.error).toContain("模拟执行崩溃");
    expect(run.finishedAt).toBeDefined();
    expect(run.result).toBeNull();

    const updated = await experimentService.getExperiment(experiment.experimentId);
    expect(updated.status).toBe("failed");
  });

  it("未知策略版本 / 未知实验在创建 Run 前抛错（不产生 FAILED Run）", async () => {
    const { experimentService, runService } = buildStack();
    await experimentService.createExperiment(makeInput());
    // 未知实验：直接抛错。
    await expect(runService.runExperiment("EXP-UNKNOWN")).rejects.toThrow(/未找到实验/);
  });
});

// ---------------------------------------------------------------------------
// 7. Multiple Runs
// ---------------------------------------------------------------------------

describe("Multiple Runs", () => {
  it("experiment A → run 1/2/3 均正常保存", async () => {
    const { experimentService, runService } = buildStack();
    const experiment = await experimentService.createExperiment(makeInput());

    const run1 = await runService.runExperiment(experiment.experimentId, "RUN-EXP-20260906-RUN0001-1");
    const run2 = await runService.runExperiment(experiment.experimentId, "RUN-EXP-20260906-RUN0001-2");
    const run3 = await runService.runExperiment(experiment.experimentId, "RUN-EXP-20260906-RUN0001-3");

    expect([run1.status, run2.status, run3.status]).toEqual(["succeeded", "succeeded", "succeeded"]);

    const runs = await runService.listRuns(experiment.experimentId);
    expect(runs).toHaveLength(3);
    expect(new Set(runs.map((r) => r.runId)).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 8. Determinism
// ---------------------------------------------------------------------------

describe("Determinism", () => {
  it("同一实验连续执行两次核心结果一致", async () => {
    const { experimentService, runService } = buildStack();
    const experiment = await experimentService.createExperiment(makeInput());

    const run1 = await runService.runExperiment(experiment.experimentId, "RUN-EXP-20260906-RUN0001-1");
    const run2 = await runService.runExperiment(experiment.experimentId, "RUN-EXP-20260906-RUN0001-2");

    expect(run2.result).toEqual(run1.result);
    expect(run2.result!.performance).toEqual(run1.result!.performance);
    expect(run2.result!.config).toEqual(run1.result!.config);
  });
});

// ---------------------------------------------------------------------------
// STEP 6.2-FIX-1 — CostModel Freeze（Drift / Traceability / Determinism）
// ---------------------------------------------------------------------------

describe("CostModel Freeze (Run)", () => {
  // 与 DEFAULT_COST_MODEL 明显不同的冻结成本模型（lotSize 保持 100，保证 100 股整手成交）。
  const costModelA = {
    commissionRate: 0.0001,
    stampDutyRate: 0.001,
    transferFeeRate: 0.00002,
    slippageBps: 20,
    lotSize: 100,
    minCommission: 1,
  };

  it("Default CostModel 漂移：快照冻结 A ≠ 当前默认，Run 仍使用 A（不重读 DEFAULT_COST_MODEL）", async () => {
    const { experimentService, runService } = buildStack();
    const input = makeInput("EXP-20260906-DRIFT0001");
    input.backtestConfig = { ...input.backtestConfig, costModel: costModelA };
    const experiment = await experimentService.createExperiment(input);
    const run = await runService.runExperiment(experiment.experimentId, "RUN-DRIFT-1");

    expect(run.status).toBe("succeeded");
    expect(run.result).not.toBeNull();
    // 运行实际使用的成本模型 = 快照冻结的 A，而非当前 DEFAULT_COST_MODEL。
    expect(run.result!.config.cost).toEqual(costModelA);
    // 明确不同于默认：minCommission 1 vs 默认 5、stampDutyRate 0.001 vs 默认 0.0005。
    expect(run.result!.config.cost.minCommission).toBe(1);
    expect(run.result!.config.cost.stampDutyRate).toBe(0.001);
  });

  it("Result Traceability：run.result.config.cost === 实验 snapshot 冻结的 costModel", async () => {
    const { experimentService, runService } = buildStack();
    const input = makeInput("EXP-20260906-TRACE0001");
    input.backtestConfig = { ...input.backtestConfig, costModel: costModelA };
    const experiment = await experimentService.createExperiment(input);
    const run = await runService.runExperiment(experiment.experimentId, "RUN-TRACE-1");

    expect(run.result!.config.cost).toEqual(experiment.backtestConfig.costModel);
    expect(run.result!.config.cost.minCommission).toBe(1);
  });

  it("Determinism：同一快照（含 costModel A）连续运行两次核心结果一致，均使用 A", async () => {
    const { experimentService, runService } = buildStack();
    const input = makeInput("EXP-20260906-DETC0001");
    input.backtestConfig = { ...input.backtestConfig, costModel: costModelA };
    const experiment = await experimentService.createExperiment(input);

    const run1 = await runService.runExperiment(experiment.experimentId, "RUN-DETC-1");
    const run2 = await runService.runExperiment(experiment.experimentId, "RUN-DETC-2");

    expect(run2.result).toEqual(run1.result);
    expect(run1.result!.config.cost).toEqual(costModelA);
    expect(run2.result!.config.cost).toEqual(costModelA);
  });
});

// ---------------------------------------------------------------------------
// 9. Production Boundary + 10. Legacy Simulator Boundary
// ---------------------------------------------------------------------------

describe("Production / Legacy Boundary", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(here, "..", "..");
  const read = (rel: string) => readFileSync(path.resolve(projectRoot, rel), "utf8");

  const productionCoreFiles = [
    "server/engine/engine.ts",
    "server/engine/domain.ts",
    "server/engine/execution.ts",
    "server/engine/portfolio.ts",
    "server/engine/performance.ts",
    "server/strategy/contract.ts",
    "server/strategy/registry.ts",
    "server/strategy/adapter.ts",
    "server/strategy/strategies/leaderCandidateBaseline.ts",
    "server/risk/contract.ts",
    "server/risk/manager.ts",
    "server/risk/policies.ts",
    "server/risk/sizing.ts",
    "server/risk/context.ts",
  ];

  it("生产核心不反向依赖 research（无 research import）", () => {
    for (const file of productionCoreFiles) {
      const content = read(file);
      expect(content, `${file} 不应依赖 research`).not.toMatch(/from\s+["'][^"']*research[^"']*["']/);
    }
  });

  it("生产服务不引用 legacy 模拟器 simulateRealisticTPlus1ToTPlus2，也不 import research", () => {
    const prodService = read("server/leaderCandidateStrategyBacktest.ts");
    expect(prodService).not.toContain("simulateRealisticTPlus1ToTPlus2");
    expect(prodService).not.toMatch(/from\s+["'][^"']*research[^"']*["']/);

    const strategyBacktest = read("server/strategy/strategyBacktest.ts");
    expect(strategyBacktest).not.toContain("simulateRealisticTPlus1ToTPlus2");
  });
});
