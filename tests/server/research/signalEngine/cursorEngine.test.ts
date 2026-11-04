import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import type { CostModel } from "../../../../server/engine/domain";
import {
  RESEARCH_DATASET_BUILDER_VERSION,
  RESEARCH_DATASET_ROW_SCHEMA_VERSION,
  type DataSnapshot,
  type ResearchDataset,
  type ResearchDatasetRow,
  type UniverseDayResult,
} from "../../../../server/researchDataset/types";
import {
  makeBarFeatureProvider,
  makeWeightedSignalBuilder,
  type ExperimentConfig,
  type FeatureProvider,
  type StrategyContract,
} from "../../../../server/research/framework";
import { deriveDatasetUniverseId } from "../../../../server/research/datasetAccess/handle";
import { createInMemoryResearchDatasetCursor } from "../../../../server/research/datasetAccess/cursor";
import { runCandidateEngine } from "../../../../server/research/signalEngine/engine";
import { runCandidateEngineFromCursor } from "../../../../server/research/signalEngine/cursorEngine";
import { runTradeSimulation } from "../../../../server/research/simulator/engine";
import { runTradeSimulationFromCursor, buildCompactResearchDatasetFromCursor } from "../../../../server/research/simulator/cursorEngine";
import { runClosedLoop } from "../../../../server/research/closedLoop/orchestrator";
import { createStreamingClosedLoopWiring } from "../../../../server/research/closedLoopWiring/executors";
import type { ClosedLoopWiringInputs } from "../../../../server/research/closedLoopWiring/types";
import { buildFirstLimitPoolDailyScoreDocument } from "../../../../server/research/patternLibrary/firstLimitPoolDailyScore";

const D1 = "2026-01-05";
const D2 = "2026-01-06";
const D3 = "2026-01-07";
const DATASET_VERSION = "rd-1.0.0-1-aaaaaaaaaaaaaaaa";

const COST_MODEL: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

function makeRow(date: string, securityId: string, close: number, preClose: number): ResearchDatasetRow {
  return {
    tradeDate: date,
    asOf: date,
    securityId,
    code: `${securityId}.SH`,
    securityType: "stock",
    exchange: "SH",
    lifecycleVerdict: "LISTED",
    eligible: true,
    exclusionReason: null,
    st: "NORMAL",
    industryCode: "801780",
    industryName: "测试行业",
    turnoverRate: 2.5,
    circulationMarketCap: 1_000_000_000,
    totalMarketCap: 1_200_000_000,
    liquidityAmount: 500_000,
    liquidityVolume: 100_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    preClose,
    volume: 100_000,
    amount: 500_000,
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,
    indexClose: { "000300.SH": 4000 },
    knowledge: {
      policy: "PIT",
      listing: "KNOWN",
      delisting: "KNOWN",
      tradability: "KNOWN",
      industry: "KNOWN",
      liquidity: "KNOWN",
      price: "KNOWN",
      corporateActions: "KNOWN",
      marketState: "KNOWN",
    },
  };
}

function makeDataset(): ResearchDataset {
  const rows = [
    makeRow(D1, "A", 10, 9.5),
    makeRow(D1, "B", 10, 10),
    makeRow(D2, "A", 10.5, 10),
    makeRow(D2, "B", 10.5, 10),
    makeRow(D3, "A", 11, 10.5),
    makeRow(D3, "B", 10.6, 10.5),
  ];
  const days: UniverseDayResult[] = [
    { tradeDate: D1, isTradingDay: true, members: ["A", "B"], excludedByReason: {} },
    { tradeDate: D2, isTradingDay: true, members: ["A", "B"], excludedByReason: {} },
    { tradeDate: D3, isTradingDay: true, members: ["A", "B"], excludedByReason: {} },
  ];
  const snapshot: DataSnapshot = {
    capturedAt: "2026-01-07T00:00:00.000Z",
    request: {
      name: "cursor-engine-test",
      startDate: D1,
      endDate: D3,
      asOfPerTradeDate: true,
      asOf: null,
      coreIndexCodes: ["000300.SH"],
    },
    calendarName: "test-calendar",
    calendarFirstDate: D1,
    calendarLastDate: D3,
    tradingDays: 3,
    domains: [],
    coverageGaps: [],
  };
  return {
    datasetVersion: DATASET_VERSION,
    universeDefinition: { rule: "test", asOfDescription: "PIT", days },
    policySet: [],
    dataSnapshot: snapshot,
    rows,
    gate: "PASS",
    gateNotes: [],
  };
}

function makeStrategy(): StrategyContract {
  return {
    strategyId: "test-strategy",
    strategyVersion: "1.0.0",
    name: "cursor-engine-test",
    parameters: { parameters: [{ name: "topN", type: "number", required: true, min: 1 }] },
    requiredData: ["OHLCV"],
    signalFrequency: "daily",
  };
}

function makeConfig(datasetVersion = DATASET_VERSION): ExperimentConfig {
  return {
    datasetVersion,
    strategyId: "test-strategy",
    strategyVersion: "1.0.0",
    parameters: { topN: 1 },
    universe: { universeId: deriveDatasetUniverseId(datasetVersion) },
    dateRange: { startDate: D1, endDate: D3 },
    costModel: COST_MODEL,
    randomSeed: 7,
  };
}

function makeFeature(): FeatureProvider {
  return makeBarFeatureProvider({
    featureId: "pctChange",
    version: "1.0.0",
    availability: { requiredDataThrough: { date: D1, point: "close" }, availableAt: { date: D1, point: "close" } },
    compute: (bars: readonly CanonicalMarketBar[]) => {
      const last = bars[bars.length - 1];
      if (last === undefined || last.close === null || last.preClose === null || last.preClose === 0) return null;
      return last.close / last.preClose - 1;
    },
  });
}

const strategy = makeStrategy();
const config = makeConfig();
const strategy13 = {
  point: "close" as const,
  features: [makeFeature()],
  signalBuilder: makeWeightedSignalBuilder({ pctChange: 1 }),
  rankingConfig: { higherIsBetter: true },
  selectionConfig: { method: { kind: "topN" as const, n: 1 } },
};

describe("流式 cursor 引擎等价性", () => {
  it("候选 run 与内存 ResearchDataset 路径逐日一致", async () => {
    const dataset = makeDataset();
    const cursor = createInMemoryResearchDatasetCursor(dataset);
    const expected = runCandidateEngine({ dataset, config, strategy, strategy13 });
    const actual = await runCandidateEngineFromCursor({ cursor, config, strategy, strategy13 });
    expect(actual.days).toEqual(expected.days);
    expect(actual.evaluation).toEqual(expected.evaluation);
    expect(actual.fingerprint).toBe(expected.fingerprint);
  });

  it("交易模拟从 cursor 重放后与内存路径成交/权益一致", async () => {
    const dataset = makeDataset();
    const expectedCandidate = runCandidateEngine({ dataset, config, strategy, strategy13 });
    const simConfig = {
      name: "cursor-engine-test",
      dateRange: { startDate: D1, endDate: D3 },
      initialCapital: 100_000,
      cost: COST_MODEL,
      executionModel: "NEXT_OPEN" as const,
      maxPositions: 1,
      maxDailyBuys: 1,
      zeroVolumePolicy: "REJECT" as const,
      securityBoards: { A: "main" as const, B: "main" as const },
    };
    const expected = runTradeSimulation({ dataset, sourceRun: expectedCandidate, simConfig });
    const cursor = createInMemoryResearchDatasetCursor(dataset);
    await runCandidateEngineFromCursor({ cursor, config, strategy, strategy13 });
    const actual = await runTradeSimulationFromCursor({ cursor, sourceRun: expectedCandidate, simConfig });
    expect(actual.trades).toEqual(expected.trades);
    expect(actual.equityCurve).toEqual(expected.equityCurve);
    expect(actual.fingerprint).toBe(expected.fingerprint);
  });

  it("有 retained rows 时 backtest 不再 restart/replay cursor", async () => {
    const dataset = makeDataset();
    const sourceRun = runCandidateEngine({ dataset, config, strategy, strategy13 });
    const simConfig = {
      name: "retained-cursor-test",
      dateRange: { startDate: D1, endDate: D3 },
      initialCapital: 100_000,
      cost: COST_MODEL,
      executionModel: "NEXT_OPEN" as const,
      maxPositions: 1,
      maxDailyBuys: 1,
      positionSizing: { sizingMethod: "FIXED_FRACTION" as const, fraction: 0.5, fixedAmount: null },
      zeroVolumePolicy: "REJECT" as const,
    };
    const base = createInMemoryResearchDatasetCursor(dataset);
    const compact = await buildCompactResearchDatasetFromCursor(base, sourceRun);
    const retainedCursor = {
      ...base,
      async restart(): Promise<void> {
        throw new Error("retained rows 存在时不得 restart/replay");
      },
      takeRetainedRows: () => compact.rows,
    };
    const actual = await runTradeSimulationFromCursor({ cursor: retainedCursor, sourceRun, simConfig });
    expect(actual.trades.length).toBeGreaterThan(0);
  });
});

describe("池化流式闭环接线", () => {
  it("data/research/strategy/backtest/evaluation 五阶段全部由 cursor 路径执行", async () => {
    const dataset = makeDataset();
    const cursor = createInMemoryResearchDatasetCursor(dataset);
    const document = buildFirstLimitPoolDailyScoreDocument({
      datasetVersionId: 1,
      datasetLabel: "cursor-test",
      poolAgeCapTradingDays: 5,
    });
    const { recordKind: _recordKind, recordVersion: _recordVersion, fingerprint: _fingerprint, ...documentInput } = document;
    const inputs = {
      researchDatasetCursor: cursor,
      experimentConfig: config,
      strategyContract: strategy,
      strategy13,
      simulationConfig: {
        name: "cursor-closed-loop-test",
        dateRange: { startDate: D1, endDate: D3 },
        initialCapital: 100_000,
        cost: COST_MODEL,
        executionModel: "NEXT_OPEN",
        maxPositions: 1,
        maxDailyBuys: 1,
        positionSizing: { sizingMethod: "FIXED_FRACTION", fraction: 0.5, fixedAmount: null },
        zeroVolumePolicy: "REJECT",
      },
      strategyDocumentInput: {
        ...documentInput,
        strategyId: strategy.strategyId,
        version: strategy.strategyVersion,
        name: strategy.name,
        ...(documentInput.definition?.firstLimitPool !== undefined
          ? {
              definition: {
                ...documentInput.definition,
                firstLimitPool: { ...documentInput.definition.firstLimitPool, minimumScore: 0 },
              },
            }
          : {}),
      },
    } as ClosedLoopWiringInputs;
    const requested = ["data", "research", "strategy", "backtest", "evaluation"] as const;
    const wiring = await createStreamingClosedLoopWiring(inputs, { requested });
    const run = runClosedLoop({
      runId: "clrun-cursor-engine-test",
      createdAt: "2026-01-08T00:00:00.000Z",
      metadata: {
        experimentId: "EXP-20260108-CURSOR01",
        strategyId: strategy.strategyId,
        strategyVersion: strategy.strategyVersion,
        dateRange: { startDate: D1, endDate: D3 },
        datasetVersion: DATASET_VERSION,
        universeVersion: null,
        codeVersion: null,
        costModel: COST_MODEL,
        executionModel: "NEXT_OPEN",
        parameterSet: config.parameters,
      },
      stageIds: requested,
      stageRunners: wiring.stageRunners,
    });
    expect(run.overall.status).toBe("ALL_EXECUTED");
    expect(wiring.artifacts.datasetCursor).toBe(cursor);
    expect(wiring.artifacts.candidateRun?.days).toHaveLength(3);
    expect(wiring.artifacts.tradeSimulationRun?.trades.length).toBeGreaterThan(0);
  });
});
