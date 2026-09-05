/**
 * STEP 6.3 — Sweep（Experiment Batch + Runner + Result）测试。
 *
 * 覆盖（对应验收 §38 11-19）：
 *   Batch persistence / Experiment creation / Snapshot isolation / Run success / Run failure /
 *   Partial failure / Result traceability / Production boundary / Legacy boundary。
 * 附：createSweep 参数空间校验、maxCombinations 强制、排序（排序 ≠ 自动优化）、Batch 状态机。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { registerBuiltInResearchStrategies } from "./adapter";
import { ExperimentRegistry } from "./experimentRegistry";
import { ExperimentService } from "./experimentService";
import { runResearchBacktest, type ResearchDataLoader } from "./engineAdapter";
import {
  InMemoryExperimentRepository,
  InMemoryResearchRunRepository,
  InMemorySweepBatchRepository,
} from "./persistence/inMemory";
import type { ExperimentRepository, SweepBatchRepository } from "./persistence/contract";
import { ResearchStrategyRegistry } from "./registry";
import { createDefaultExecutor, ResearchRunService, type ResearchBacktestExecutor } from "./runService";
import { sortSweepResults, type ExperimentBatch } from "./sweep";
import { SweepService, type CreateSweepInput } from "./sweepService";
import type { RawDailyPriceRow } from "../data";
import type { LeaderCandidateSourceRecord } from "../leaderCandidates";
import type { ParameterSpace } from "./parameterSpace";
import type { SweepResult } from "./sweep";
import type { ResearchExperiment } from "./types";

// ---------------------------------------------------------------------------
// Fixtures（与 researchRun 同构：A/B/C 三候选，仅 A 价格库确认涨停）
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

const maxSignalsSpace: ParameterSpace = { parameters: [{ type: "integer", name: "maxSignals", min: 1, max: 2, step: 1 }] };

function makeSweepInput(space: ParameterSpace = maxSignalsSpace, extra: Partial<CreateSweepInput> = {}): CreateSweepInput {
  return {
    strategyId: "leader-candidate-baseline",
    strategyVersion: "1.0.0",
    parameterSpace: space,
    dataset: { startDate: D1, endDate: D3, universe: "limit-up" },
    backtestConfig: {
      initialCapital: 100_000,
      maxPositions: 5,
      commissionRate: 0.0003,
      slippageRate: 0.001,
      lotSize: 100,
      executionModel: "next-open",
    },
    ...extra,
  };
}

function buildSweepStack(
  executor?: ResearchBacktestExecutor,
  repos: { experimentRepository?: ExperimentRepository; batchRepository?: SweepBatchRepository } = {},
) {
  const strategyRegistry = new ResearchStrategyRegistry();
  registerBuiltInResearchStrategies(strategyRegistry);
  const experimentRegistry = new ExperimentRegistry();
  const experimentRepository = repos.experimentRepository ?? new InMemoryExperimentRepository();
  const runRepository = new InMemoryResearchRunRepository();
  const batchRepository = repos.batchRepository ?? new InMemorySweepBatchRepository();
  const experimentService = new ExperimentService({ strategyRegistry, experimentRegistry, experimentRepository });
  const runService = new ResearchRunService({
    strategyRegistry,
    experimentRepository,
    runRepository,
    executor: executor ?? createDefaultExecutor(loader),
  });
  const sweepService = new SweepService({ strategyRegistry, experimentService, runService, batchRepository });
  return { sweepService, experimentService, runService, batchRepository, experimentRepository, experimentRegistry, runRepository };
}

// ---------------------------------------------------------------------------
// Failure-injection fakes（回滚测试专用；只覆写目标方法，其余走真实内存实现）
// ---------------------------------------------------------------------------

/** 第 N 次实验持久化（create）抛错；之前 / 之后的调用正常。 */
class FailOnNthExperimentCreateRepository extends InMemoryExperimentRepository {
  private createCall = 0;
  constructor(private readonly failOnCall: number) {
    super();
  }

  override async create(experiment: ResearchExperiment): Promise<void> {
    this.createCall += 1;
    if (this.createCall === this.failOnCall) {
      throw new Error(`模拟实验持久化失败（第 ${this.failOnCall} 次 create）`);
    }
    await super.create(experiment);
  }
}

/** Batch 持久化（create）总是抛错。 */
class AlwaysFailBatchCreateRepository extends InMemorySweepBatchRepository {
  override async create(batch: ExperimentBatch): Promise<void> {
    throw new Error(`模拟 Batch 持久化失败：${batch.batchId}`);
  }
}

/** 实验删除（delete）总是抛错，用于验证「回滚自身失败可观察」。 */
class AlwaysFailExperimentDeleteRepository extends InMemoryExperimentRepository {
  override async delete(experimentId: string): Promise<void> {
    throw new Error(`模拟实验删除失败：${experimentId}`);
  }
}

// ---------------------------------------------------------------------------
// 11. Batch persistence
// ---------------------------------------------------------------------------

describe("Batch persistence", () => {
  it("createSweep → persist → reload：parameterSpace / strategyId / strategyVersion / status 一致", async () => {
    const { sweepService, batchRepository } = buildSweepStack();
    const created = await sweepService.createSweep(makeSweepInput(maxSignalsSpace, { batchId: "BATCH-20260906-TEST0001" }));

    expect(created.status).toBe("created");
    expect(created.strategyId).toBe("leader-candidate-baseline");
    expect(created.strategyVersion).toBe("1.0.0");
    expect(created.experimentIds).toHaveLength(2);

    const reloaded = await batchRepository.get("BATCH-20260906-TEST0001");
    expect(reloaded).toEqual(created);
    expect(reloaded!.parameterSpace).toEqual(maxSignalsSpace);
    expect(reloaded!.parameterSpaceFingerprint).toBe(created.parameterSpaceFingerprint);
  });
});

// ---------------------------------------------------------------------------
// 12. Experiment creation
// ---------------------------------------------------------------------------

describe("Experiment creation", () => {
  it("每个 combination 都创建独立 Experiment（参数集正确）", async () => {
    const { sweepService, experimentService } = buildSweepStack();
    const batch = await sweepService.createSweep(makeSweepInput(maxSignalsSpace));

    expect(batch.experimentIds).toHaveLength(2);

    const experiments = await Promise.all(batch.experimentIds.map((id) => experimentService.getExperiment(id)));
    const maxSignalsValues = experiments.map((experiment) => experiment.parameterSet.maxSignals).sort((a, b) => Number(a) - Number(b));
    expect(maxSignalsValues).toEqual([1, 2]);
    // 独立实验：每个实验有独立 experimentId。
    expect(new Set(experiments.map((experiment) => experiment.experimentId)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 13. Snapshot isolation
// ---------------------------------------------------------------------------

describe("Snapshot isolation", () => {
  it("修改 Batch ParameterSpace 不影响 Experiment Snapshot", async () => {
    const { sweepService, experimentService } = buildSweepStack();
    const batch = await sweepService.createSweep(makeSweepInput(maxSignalsSpace));

    // 修改 batch.parameterSpace（模拟未来参数空间被改动）。
    batch.parameterSpace.parameters[0] = { type: "integer", name: "maxSignals", min: 99, max: 100, step: 1 };

    const experiments = await Promise.all(batch.experimentIds.map((id) => experimentService.getExperiment(id)));
    const maxSignalsValues = experiments.map((experiment) => experiment.parameterSet.maxSignals).sort((a, b) => Number(a) - Number(b));
    expect(maxSignalsValues).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// 14. Run success
// ---------------------------------------------------------------------------

describe("Run success", () => {
  it("Batch → Experiment → ResearchRun → Backtest Core：成功结果正确保存", async () => {
    const { sweepService } = buildSweepStack();
    const batch = await sweepService.createSweep(makeSweepInput(maxSignalsSpace));
    const summary = await sweepService.runSweep(batch.batchId);

    expect(summary).toEqual({ batchId: batch.batchId, total: 2, succeeded: 2, failed: 0, cancelled: 0 });

    const results = await sweepService.getSweepResults(batch.batchId);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "succeeded")).toBe(true);
    expect(results.every((result) => result.metrics !== undefined)).toBe(true);

    const reloaded = await sweepService.getBatch(batch.batchId);
    expect(reloaded.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// 15. Run failure
// ---------------------------------------------------------------------------

describe("Run failure", () => {
  it("可控失败 → ResearchRun FAILED：error + finishedAt 保存，batch failed", async () => {
    const failing: ResearchBacktestExecutor = async () => {
      throw new Error("模拟执行崩溃");
    };
    const { sweepService, runService } = buildSweepStack(failing);
    const batch = await sweepService.createSweep(makeSweepInput(maxSignalsSpace));
    const summary = await sweepService.runSweep(batch.batchId);

    expect(summary).toEqual({ batchId: batch.batchId, total: 2, succeeded: 0, failed: 2, cancelled: 0 });

    const results = await sweepService.getSweepResults(batch.batchId);
    expect(results.every((result) => result.status === "failed")).toBe(true);
    expect(results.every((result) => result.error !== undefined && result.error.includes("模拟执行崩溃"))).toBe(true);

    // Run 记录 error + finishedAt 已持久化。
    const runs = await runService.listRuns();
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "failed" && run.finishedAt !== undefined)).toBe(true);

    const reloaded = await sweepService.getBatch(batch.batchId);
    expect(reloaded.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 16. Partial failure
// ---------------------------------------------------------------------------

describe("Partial failure", () => {
  it("5 experiments 中 1 失败 → total=5 / succeeded=4 / failed=1", async () => {
    const partialExecutor: ResearchBacktestExecutor = async (snapshot, definition) => {
      if (snapshot.parameterSet.maxSignals === 3) {
        throw new Error("模拟 maxSignals=3 执行崩溃");
      }
      const data = await loader(snapshot.dataset);
      return runResearchBacktest(snapshot, definition, data);
    };
    const { sweepService } = buildSweepStack(partialExecutor);
    const space: ParameterSpace = { parameters: [{ type: "integer", name: "maxSignals", min: 1, max: 5, step: 1 }] };
    const batch = await sweepService.createSweep(makeSweepInput(space));
    const summary = await sweepService.runSweep(batch.batchId);

    expect(summary).toEqual({ batchId: batch.batchId, total: 5, succeeded: 4, failed: 1, cancelled: 0 });
    expect((await sweepService.getBatch(batch.batchId)).status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 17. Result parameter traceability
// ---------------------------------------------------------------------------

describe("Result parameter traceability", () => {
  it("每个结果都能找到 experimentId / runId / parameterSet", async () => {
    const { sweepService } = buildSweepStack();
    const batch = await sweepService.createSweep(makeSweepInput(maxSignalsSpace));
    await sweepService.runSweep(batch.batchId);

    const results = await sweepService.getSweepResults(batch.batchId);
    for (const result of results) {
      expect(result.experimentId).toBeTruthy();
      expect(result.runId).toBeTruthy();
      expect(result.parameterSet).toBeTruthy();
      expect(result.parameterSet.maxSignals).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// createSweep 防护
// ---------------------------------------------------------------------------

describe("createSweep 防护", () => {
  it("非法参数空间在创建任何 Experiment 之前抛错（无孤儿实验）", async () => {
    const { sweepService, experimentService } = buildSweepStack();
    const badSpace: ParameterSpace = {
      parameters: [
        { type: "number", name: "maxSignals", min: 1, max: 2, step: 0 }, // step 非法
      ],
    };
    await expect(sweepService.createSweep(makeSweepInput(badSpace))).rejects.toThrow();
    expect(await experimentService.listExperiments()).toHaveLength(0);
  });

  it("超过 maxCombinations 上限在创建前失败", async () => {
    const { sweepService, experimentService } = buildSweepStack();
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "x", min: 0, max: 99, step: 1 },
        { type: "integer", name: "y", min: 0, max: 99, step: 1 },
      ],
    };
    await expect(sweepService.createSweep(makeSweepInput(space, { maxCombinations: 100 }))).rejects.toThrow(/超过上限/);
    expect(await experimentService.listExperiments()).toHaveLength(0);
  });

  it("未知策略版本在创建前抛错", async () => {
    const { sweepService } = buildSweepStack();
    await expect(sweepService.createSweep(makeSweepInput(maxSignalsSpace, { strategyVersion: "9.9.9" }))).rejects.toThrow(/未注册/);
  });

  it("参数空间含 schema 未定义参数 → 预校验 FAIL FAST（无孤儿实验）", async () => {
    const { sweepService, experimentService } = buildSweepStack();
    const space: ParameterSpace = { parameters: [{ type: "integer", name: "bogusParam", min: 1, max: 2, step: 1 }] };
    await expect(sweepService.createSweep(makeSweepInput(space))).rejects.toThrow(/未在 schema 中定义/);
    expect(await experimentService.listExperiments()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// STEP 6.3-FIX-1 — createSweep 失败回滚（孤儿 Experiment 清理）
// ---------------------------------------------------------------------------

describe("createSweep 回滚", () => {
  /** 3 个组合（maxSignals = 1 / 2 / 3）。 */
  const threeCombosSpace: ParameterSpace = { parameters: [{ type: "integer", name: "maxSignals", min: 1, max: 3, step: 1 }] };

  // A. Experiment 中途失败：A/B success、C failed → A/B/C 全部不存在、Batch 不存在
  it("实验中途持久化失败 → 已创建实验全部回滚，Batch 不存在", async () => {
    const failingRepo = new FailOnNthExperimentCreateRepository(3);
    const { sweepService, experimentService, batchRepository, experimentRepository, experimentRegistry } =
      buildSweepStack(undefined, { experimentRepository: failingRepo });

    await expect(sweepService.createSweep(makeSweepInput(threeCombosSpace))).rejects.toThrow(/模拟实验持久化失败/);

    expect(await experimentRepository.list()).toHaveLength(0);
    expect(experimentRegistry.list()).toHaveLength(0);
    expect(await batchRepository.list()).toHaveLength(0);
    expect(await experimentService.listExperiments()).toHaveLength(0);
  });

  // B. Batch 持久化失败：A/B/C success、Batch failed → A/B/C 全部回滚、Batch 不存在
  it("Batch 持久化失败 → 已创建实验全部回滚，Batch 不存在", async () => {
    const failingBatch = new AlwaysFailBatchCreateRepository();
    const { sweepService, experimentService, batchRepository, experimentRepository, experimentRegistry } =
      buildSweepStack(undefined, { batchRepository: failingBatch });

    await expect(sweepService.createSweep(makeSweepInput(threeCombosSpace))).rejects.toThrow(/模拟 Batch 持久化失败/);

    expect(await experimentRepository.list()).toHaveLength(0);
    expect(experimentRegistry.list()).toHaveLength(0);
    expect(await batchRepository.list()).toHaveLength(0);
    expect(await experimentService.listExperiments()).toHaveLength(0);
  });

  // C. 回滚不删除历史 Experiment：Existing X 在失败 Sweep 后仍然存在
  it("失败回滚不影响历史 Experiment", async () => {
    const { sweepService, experimentService, batchRepository, experimentRepository } =
      buildSweepStack(undefined, { batchRepository: new AlwaysFailBatchCreateRepository() });

    // 预先通过标准流程创建一个历史实验 X（独立于本次 sweep）。
    const historical = await experimentService.createExperiment({
      experimentId: "EXP-KEEP-20260906-X0001",
      strategyId: "leader-candidate-baseline",
      strategyVersion: "1.0.0",
      parameterSet: { maxSignals: 1 },
      dataset: { startDate: D1, endDate: D3, universe: "limit-up" },
      backtestConfig: makeSweepInput().backtestConfig,
    });

    await expect(sweepService.createSweep(makeSweepInput(threeCombosSpace))).rejects.toThrow(/模拟 Batch 持久化失败/);

    // X 仍在；sweep 自己创建的全部被回滚。
    expect(await experimentService.getExperiment(historical.experimentId)).toEqual(historical);
    const remaining = await experimentRepository.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].experimentId).toBe(historical.experimentId);
    expect(await batchRepository.list()).toHaveLength(0);
  });

  // D. Rollback 自身失败：原始异常仍抛出、rollback failure 可观察
  it("回滚删除自身失败 → 原始异常仍抛出，且回滚失败被记录", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deleteFailingRepo = new AlwaysFailExperimentDeleteRepository();
      const { sweepService, batchRepository, experimentRepository, experimentRegistry } =
        buildSweepStack(undefined, { experimentRepository: deleteFailingRepo, batchRepository: new AlwaysFailBatchCreateRepository() });

      // 原始异常是 Batch 持久化失败；delete 失败不得掩盖它，也不得伪装成功。
      await expect(sweepService.createSweep(makeSweepInput(threeCombosSpace))).rejects.toThrow(/模拟 Batch 持久化失败/);

      // 回滚失败可观察：逐条 + 汇总记录均已输出；实验因删除失败而残留（可审计，非伪装成功）。
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[createSweep] 回滚删除实验失败"), expect.anything());
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[createSweep] 回滚不完整"), expect.anything());

      const remaining = await experimentRepository.list();
      expect(remaining).toHaveLength(3);
      expect(experimentRegistry.list()).toHaveLength(3);
      expect(await batchRepository.list()).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  // 正常成功路径：Experiments + Batch 全部存在（回滚逻辑不得影响成功路径）
  it("正常成功路径不受影响：Experiments + Batch 全部存在", async () => {
    const { sweepService, experimentService, batchRepository } = buildSweepStack();
    const batch = await sweepService.createSweep(makeSweepInput(maxSignalsSpace));

    expect(batch.status).toBe("created");
    const experiments = await experimentService.listExperiments();
    expect(experiments).toHaveLength(batch.experimentIds.length);
    expect(new Set(experiments.map((e) => e.experimentId))).toEqual(new Set(batch.experimentIds));
    expect(await batchRepository.get(batch.batchId)).toEqual(batch);
  });
});

// ---------------------------------------------------------------------------
// 排序（排序 ≠ 自动优化）
// ---------------------------------------------------------------------------

describe("sortSweepResults", () => {
  const makeResult = (id: string, sharpe: number | null): SweepResult => ({
    experimentId: id,
    runId: `RUN-${id}-1`,
    parameterSet: {},
    status: "succeeded",
    metrics: {
      totalReturnPct: 0,
      annualizedReturnPct: null,
      annualizedVolatilityPct: null,
      sharpeRatio: sharpe,
      maxDrawdownPct: 0,
      tradeCount: 0,
      completedTradeCount: 0,
      winRatePct: null,
      profitFactor: null,
      averageWin: null,
      averageLoss: null,
      expectancy: null,
      openPositionCount: 0,
    },
  });

  it("按 sharpeRatio 降序排序，null 排末尾，稳定", () => {
    const results = [makeResult("A", 1.0), makeResult("B", 2.0), makeResult("C", null), makeResult("D", 0.5)];
    const sorted = sortSweepResults(results, { metric: "sharpeRatio", direction: "desc" });
    expect(sorted.map((result) => result.experimentId)).toEqual(["B", "A", "D", "C"]);
  });

  it("返回新数组，不修改入参", () => {
    const results = [makeResult("A", 1.0), makeResult("B", 2.0)];
    const before = results.map((result) => result.experimentId);
    sortSweepResults(results, { metric: "sharpeRatio" });
    expect(results.map((result) => result.experimentId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 18. Production boundary + 19. Legacy boundary
// ---------------------------------------------------------------------------

describe("Production / Legacy boundary", () => {
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

  it("生产核心不反向依赖 research sweep/experiment", () => {
    for (const file of productionCoreFiles) {
      const content = read(file);
      expect(content, `${file} 不应依赖 research`).not.toMatch(/from\s+["'][^"']*research[^"']*["']/);
    }
  });

  it("Sweep 层不引用 legacy 模拟器（research-only 边界保持）", () => {
    const sweepFiles = [
      "server/research/sweep.ts",
      "server/research/sweepService.ts",
      "server/research/combinationGenerator.ts",
      "server/research/parameterSpace.ts",
    ];
    for (const file of sweepFiles) {
      expect(read(file), `${file} 不应引用 legacy 模拟器`).not.toContain("simulateRealisticTPlus1ToTPlus2");
    }
  });
});
