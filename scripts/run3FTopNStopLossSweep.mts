/**
 * 3F Top3 止损阈值单变量实验。
 *
 * 冻结全部正式条件，只扫描 STOP_LOSS：
 *   Top3 / T+5 决策 / T+6 开盘 / 观察窗 [5,15] / maxPositions=5 /
 *   maxDailyBuys=2 / 20% 单仓 / trailing drawdown=5% / TIME_EXIT=5。
 *
 * 用法：
 *   npx tsx scripts/run3FTopNStopLossSweep.mts --stops 3,4,5,6,8,10
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { assembleRunWorkbenchInputs } from "../server/runWorkbenchAssembly/assemble";
import { createClosedLoopWiring } from "../server/research/closedLoopWiring/executors";
import { runClosedLoop } from "../server/research/closedLoop/orchestrator";
import { saveClosedLoopBacktestRun } from "../server/closedLoopBacktestRun/repository";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import { isTransientReadError } from "../server/readRetry";
import {
  STRATEGY_EVALUATION_STAGE_IDS,
} from "../server/research/strategyEvaluation/evaluate";
import {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_CREATED_AT,
  THREE_FACTOR_TOPN_STRATEGY_VERSION,
  threeFactorTopNStrategyId,
} from "../server/research/patternLibrary/threeFactorTopNStrategy";
import type { ClosedLoopRunMetadata, ClosedLoopEvaluationRef } from "../server/research/closedLoop/types";
import type { Trade } from "../server/research/simulator/types";
import type { ClosedLoopRunResult } from "../shared/researchContracts";

function argOf(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1]!;
  return fallback;
}

function fnv1a8(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, "0");
}

async function persistClosedLoopWithRetry(
  input: Parameters<typeof saveClosedLoopBacktestRun>[0],
): Promise<number> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await saveClosedLoopBacktestRun(input);
    } catch (error) {
      lastError = error;
      if (!isTransientReadError(error) || attempt === 6) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

function toClosedLoopRunResultDto(input: {
  run: ReturnType<typeof runClosedLoop>;
  assembled: Awaited<ReturnType<typeof assembleRunWorkbenchInputs>>;
}): ClosedLoopRunResult {
  const { run, assembled } = input;
  const requested = [...STRATEGY_EVALUATION_STAGE_IDS];
  return {
    runId: run.runId,
    createdAt: run.createdAt,
    chainFingerprint: run.chainFingerprint,
    fingerprint: run.fingerprint,
    overall: { ...run.overall },
    runnerInjected: [...run.request.runnerInjected],
    stages: run.stages.map(stage => ({
      stageId: stage.stageId,
      state: stage.state,
      outputKind: stage.producedHandoffKind,
      outputHandoffFingerprint: stage.outputHandoffFingerprint,
      output: stage.output ?? null,
      blocked:
        stage.blocked === null
          ? null
          : {
              reasonCode: stage.blocked.reasonCode,
              detail: stage.blocked.detail,
              upstreamStageId: stage.blocked.upstreamStageId,
              errorCode: stage.blocked.errorCode,
              errorMessage: stage.blocked.errorMessage,
            },
    })),
    blockedSummary: run.blockedSummary.map(item => ({ ...item })),
    wiring: {
      requestedStages: requested,
      wiredStages: [...requested],
      unwiredStages: [],
      coveredStages: [...requested],
      uncoveredStages: [],
      executorBound: true,
    },
    assembly: {
      datasetVersion: assembled.assembly.datasetVersion,
      datasetGate: assembled.assembly.datasetGate,
      datasetRowCount: assembled.assembly.datasetRowCount,
      datasetSecurityCount: assembled.assembly.datasetSecretCount,
      datasetSource: assembled.assembly.datasetSource,
      datasetSourceNote: assembled.assembly.datasetSourceNote,
      datasetVersionId: assembled.assembly.datasetVersionId,
      dateRange: { ...assembled.assembly.dateRange },
      strategyId: assembled.assembly.strategyId,
      strategyVersion: assembled.assembly.strategyVersion,
      recipeId: assembled.assembly.recipeId,
      recipeSource: assembled.assembly.recipeSource,
      recipeFeatureIds: [...assembled.assembly.recipeFeatureIds],
      selectionSummary: assembled.assembly.selectionSummary,
      strategyDecisionEngine: assembled.assembly.strategyDecisionEngine,
      strategyDecisionEngineNote: assembled.assembly.strategyDecisionEngineNote,
      simulation: {
        initialCapital: assembled.assembly.simulation.initialCapital,
        maxPositions: assembled.assembly.simulation.maxPositions,
        maxDailyBuys: assembled.assembly.simulation.maxDailyBuys,
        executionModel: assembled.assembly.simulation.executionModel,
        costModel: { ...assembled.assembly.simulation.costModel },
      },
    },
  };
}

const TOP_N = Number(argOf("topn", "3"));
const DATASET_VERSION_ID = Number(argOf("dataset-version-id", "660001"));
const DATASET_LABEL = argOf("dataset-label", "v5");
const START = argOf("start", "2019-01-01");
const END = argOf("end", "2026-09-04");
const OUT = argOf("out", "docs/evidence/_probe_3f_top3_stop_loss_sweep.json");
const STRATEGY_VERSION_OVERRIDE = argOf("strategy-version", "");
const PERSIST = argOf("persist", "false") === "true";
const STOPS = argOf("stops", "3,4,5,6,8,10")
  .split(",")
  .map(value => Number(value.trim()) / 100);
const STRONG_MIN_RETURN_RAW = argOf("strong-min-return", "");
const STRONG_EXTEND_TO = Number(argOf("strong-extend-to", "10"));
const STRONG_HOLD =
  STRONG_MIN_RETURN_RAW === ""
    ? null
    : {
        atHoldingDays: 5,
        minReturnRatio: Number(STRONG_MIN_RETURN_RAW) / 100,
        requireAboveMa5: argOf("require-above-ma5", "true") !== "false",
        requireAboveMa10: argOf("require-above-ma10", "true") !== "false",
        extendToHoldingDays: STRONG_EXTEND_TO,
      };
const strategyVersion =
  STRATEGY_VERSION_OVERRIDE === ""
    ? THREE_FACTOR_TOPN_STRATEGY_VERSION
    : STRATEGY_VERSION_OVERRIDE;

const strategyId = threeFactorTopNStrategyId(TOP_N);
const baseDocument = buildThreeFactorTopNStrategyDocument({
  topN: TOP_N,
  datasetVersionId: DATASET_VERSION_ID,
  datasetLabel: DATASET_LABEL,
});

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeTrades(trades: readonly Trade[]) {
  const completed = trades.filter(trade => !trade.openAtEnd && trade.returnPct !== null);
  const wins = completed.filter(trade => trade.returnPct! > 0);
  const losses = completed.filter(trade => trade.returnPct! < 0);
  const avgWin = mean(wins.map(trade => trade.returnPct!));
  const avgLoss = mean(losses.map(trade => trade.returnPct!));
  const totalWin = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const totalLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const stop = completed.filter(trade => trade.reason?.includes("止损"));
  const trailing = completed.filter(trade => trade.reason?.includes("回撤止盈"));
  const time = completed.filter(trade => trade.reason?.includes("持有满"));
  const other = completed.filter(
    trade => !stop.includes(trade) && !trailing.includes(trade) && !time.includes(trade),
  );
  const byReason = (label: string, rows: readonly Trade[]) => ({
    label,
    count: rows.length,
    sharePct: completed.length === 0 ? null : (rows.length / completed.length) * 100,
    meanReturnPct: mean(rows.map(trade => trade.returnPct!)),
    netPnl: rows.reduce((sum, trade) => sum + trade.netPnl, 0),
  });
  return {
    completedCount: completed.length,
    winRatePct: completed.length === 0 ? null : (wins.length / completed.length) * 100,
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    payoffRatio:
      avgWin === null || avgLoss === null ? null : avgWin / Math.abs(avgLoss),
    breakEvenWinRatePct:
      avgWin === null || avgLoss === null
        ? null
        : (Math.abs(avgLoss) / (avgWin + Math.abs(avgLoss))) * 100,
    profitFactor:
      totalLoss === 0 ? null : totalWin / totalLoss,
    totalNetPnl: completed.reduce((sum, trade) => sum + trade.netPnl, 0),
    exits: [
      byReason("STOP_LOSS", stop),
      byReason("TRAILING_TAKE_PROFIT", trailing),
      byReason("TIME_EXIT", time),
      byReason("OTHER", other),
    ],
  };
}

const bootstrap = await assembleRunWorkbenchInputs({
  strategyId,
  strategyVersion: THREE_FACTOR_TOPN_STRATEGY_VERSION,
  startDate: START,
  endDate: END,
  createdAt: THREE_FACTOR_TOPN_CREATED_AT,
  codeVersion: "stop-loss-sweep",
  strategyDocument: baseDocument,
  datasetVersionId: DATASET_VERSION_ID,
  dataReady: true,
  datasetSourcePolicy: "prefer-registry",
});
const corporateActionResolver =
  bootstrap.inputs.simulationConfig?.corporateActionResolver;
if (corporateActionResolver === undefined) {
  throw new Error("[stop-sweep] 首次装配未产出 corporateActionResolver，无法复用。");
}
console.log(
  `[stop-sweep] dataset ready: source=${bootstrap.assembly.datasetSource} rows=${bootstrap.assembly.datasetRowCount}`,
);

const rows = [];
for (const stopLossRatio of STOPS) {
  if (
    !Number.isFinite(stopLossRatio) ||
    stopLossRatio <= 0 ||
    stopLossRatio >= 1
  ) {
    throw new Error(`非法止损比例：${String(stopLossRatio)}`);
  }
  const stopPct = Math.round(stopLossRatio * 100);
  const document = buildThreeFactorTopNStrategyDocument({
    topN: TOP_N,
    datasetVersionId: DATASET_VERSION_ID,
    datasetLabel: DATASET_LABEL,
    strategyVersion,
    stopLossRatio,
    strongHold: STRONG_HOLD,
  });
  if (PERSIST) {
    const strategyService = new StrategyService(new DbStrategyRepository(), {
      codeVersion: "stop-loss-sweep",
      now: () => THREE_FACTOR_TOPN_CREATED_AT,
    });
    await strategyService.save({
      document: document as unknown as Record<string, unknown>,
    });
  }
  const assembled = await assembleRunWorkbenchInputs({
    strategyId,
    strategyVersion,
    startDate: START,
    endDate: END,
    createdAt: THREE_FACTOR_TOPN_CREATED_AT,
    codeVersion: "stop-loss-sweep",
    strategyDocument: document,
    datasetVersionId: DATASET_VERSION_ID,
    dataReady: true,
    researchDataset: bootstrap.dataset,
    corporateActionResolver,
  });
  const metadata: ClosedLoopRunMetadata = {
    experimentId:
      "EXP-20260927-" +
      fnv1a8(
        `${strategyId}|${strategyVersion}|${stopPct}|${JSON.stringify(STRONG_HOLD)}`,
      ),
    strategyId,
    strategyVersion,
    dateRange: { startDate: START, endDate: END },
    datasetVersion: assembled.dataset.datasetVersion,
    universeVersion: null,
    codeVersion: "stop-loss-sweep",
    costModel: assembled.assembly.simulation.costModel,
    executionModel: assembled.assembly.simulation.executionModel,
    parameterSet: {},
  };
  const { artifacts, stageRunners } = createClosedLoopWiring(assembled.inputs, {
    requested: STRATEGY_EVALUATION_STAGE_IDS,
  });
  const run = runClosedLoop({
    runId:
      `STOP-LOSS-SWEEP-${stopPct}-v${strategyVersion.replaceAll(".", "_")}` +
      (STRONG_HOLD === null ? "" : `-strong${STRONG_EXTEND_TO}`),
    createdAt: THREE_FACTOR_TOPN_CREATED_AT,
    metadata,
    stageIds: STRATEGY_EVALUATION_STAGE_IDS,
    stageRunners,
  });
  const simulation = artifacts.tradeSimulationRun;
  if (simulation === undefined) {
    throw new Error(
      `止损 ${stopPct}%：backtest 未产出 tradeSimulationRun；` +
        run.stages.map(stage => `${stage.stageId}=${stage.state}`).join(", "),
    );
  }
  const evaluationStage = run.stages.find(stage => stage.stageId === "evaluation");
  const evaluation =
    evaluationStage?.state === "EXECUTED"
      ? (evaluationStage.output as ClosedLoopEvaluationRef | null)
      : null;
  const persistedId =
    PERSIST
      ? await persistClosedLoopWithRetry({
          experimentId: metadata.experimentId,
          strategyId,
          strategyVersion,
          startDate: START,
          endDate: END,
          result: toClosedLoopRunResultDto({ run, assembled }),
        })
      : null;
  const row = {
    strategyVersion,
    stopLossRatio,
    stopLossPct: stopPct,
    persistedId,
    finalEquity: simulation.finalEquity,
    tradeCount: simulation.trades.length,
    openAtEndCount: simulation.positions.length,
    evaluation,
    tradeSummary: summarizeTrades(simulation.trades),
    trades: simulation.trades,
    positions: simulation.positions,
    skippedByCode: [...simulation.skipped.reduce((map, item) => {
      map.set(item.code, (map.get(item.code) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([code, count]) => ({ code, count })),
  };
  rows.push(row);
  console.log(
    `[stop-sweep] stop=${stopPct}% final=${simulation.finalEquity.toFixed(2)} ` +
      `trades=${row.tradeCount} win=${row.tradeSummary.winRatePct?.toFixed(2)}% ` +
      `PF=${row.tradeSummary.profitFactor?.toFixed(4)} ` +
      `payoff=${row.tradeSummary.payoffRatio?.toFixed(3)}`,
  );
}

const payload = {
  generatedAt: new Date().toISOString(),
  frozen: {
    topN: TOP_N,
    strategyId,
    strategyVersion,
    datasetVersionId: DATASET_VERSION_ID,
    datasetLabel: DATASET_LABEL,
    dateRange: { startDate: START, endDate: END },
    observationWindow: { start: 5, end: 15, unit: "TRADING_DAY" },
    maxPositions: 5,
    maxDailyBuys: TOP_N === 3 ? 2 : 3,
    positionRatio: 0.2,
    trailingTakeProfitDrawdownRatio: 0.05,
    maxHoldingDays: 5,
    varied: "stopLossRatio",
  },
  rows,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(`[stop-sweep] output=${path.resolve(OUT)}`);
