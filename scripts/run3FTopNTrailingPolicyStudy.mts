/**
 * 3F Top3 advanced trailing-policy single-arm runner.
 *
 * One process runs one arm only. All non-exit conditions remain aligned with
 * the v1.11.0 closed-loop baseline.
 *
 * Usage:
 *   node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
 *     scripts/run3FTopNTrailingPolicyStudy.mts --arm ma
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { assembleRunWorkbenchInputs } from "../server/runWorkbenchAssembly/assemble";
import { createClosedLoopWiring } from "../server/research/closedLoopWiring/executors";
import { runClosedLoop } from "../server/research/closedLoop/orchestrator";
import { STRATEGY_EVALUATION_STAGE_IDS } from "../server/research/strategyEvaluation/evaluate";
import { saveClosedLoopBacktestRun } from "../server/closedLoopBacktestRun/repository";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import { isTransientReadError } from "../server/readRetry";
import {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_CREATED_AT,
  threeFactorTopNStrategyId,
} from "../server/research/patternLibrary/threeFactorTopNStrategy";
import {
  buildThreeFactorTopNFamilyArmDocument,
  resolveThreeFactorTopNStudyMembers,
} from "../server/research/patternLibrary/threeFactorTopNFamilies";
import type { ResearchTrailingPolicyDefinition } from "../server/research/trailingPolicy";
import type { ExitPolicyDefinition } from "../server/research/exitPolicyCommon";
import { getExitPolicyExperiment } from "../server/research/exitPolicyExperiments";
import type {
  ClosedLoopEvaluationRef,
  ClosedLoopRunMetadata,
} from "../server/research/closedLoop/types";
import type {
  EquityPoint,
  Trade,
} from "../server/research/simulator/types";
import type { ClosedLoopRunResult } from "../shared/researchContracts";

interface ArmDefinition {
  readonly id: string;
  readonly strategyVersion: string;
  readonly label: string;
  readonly familyId: string | null;
  readonly policy: ResearchTrailingPolicyDefinition | null;
  readonly exitPolicy?: ExitPolicyDefinition;
  readonly observationWindowEnd?: number;
  readonly strongHoldAfterExtendedHold?: "TIME_EXIT" | "TREND";
  readonly strongHoldScaleOutRatio?: number;
  readonly strongHoldRunnerExitAtHoldingDays?: number;
  readonly strongHoldMaxConcurrentRunners?: number;
  readonly strongHoldReplacementScoreMargin?: number;
}

/**
 * 移动止盈/趋势 runner 族的臂定义已迁移到模式族注册表；脚本改从注册表读取
 * strategyVersion 与执行补丁。别名与顺序来自 `trailing-policy-study` 集合。
 * control（1.21.0）是无移动止盈的历史控制臂，仍显式声明在脚本里，
 * 因为它不属于任何「移动止盈维度」族。
 */
const NAMED_ARMS: ReadonlyMap<
  string,
  { readonly familyId: string; readonly armId: string }
> = new Map(
  resolveThreeFactorTopNStudyMembers("trailing-policy-study").map(member => [
    member.alias,
    { familyId: member.familyId, armId: member.arm.armId },
  ]),
);

const CONTROL_ARM: ArmDefinition = {
  id: "control",
  strategyVersion: "1.21.0",
  label: "control-v111-fixed-close-5pct",
  familyId: null,
  policy: null,
};

/** 从注册表 arm 补丁里读回脚本展示/落档需要的强续持字段。 */
function armFromRegistry(familyId: string, armId: string): ArmDefinition {
  const arm = resolveThreeFactorTopNFamilyArm(familyId, armId);
  if (arm === null) {
    throw new Error(`模式族注册表缺少 ${familyId}/${armId}。`);
  }
  const patch = arm.inputPatch;
  return {
    id: arm.armId,
    strategyVersion: arm.strategyVersion,
    label: arm.label,
    familyId,
    policy: patch.trailingPolicy ?? null,
    observationWindowEnd: patch.observationWindow?.end,
    strongHoldAfterExtendedHold: patch.strongHold?.afterExtendedHold,
    strongHoldScaleOutRatio: patch.strongHold?.scaleOutRatio ?? undefined,
    strongHoldRunnerExitAtHoldingDays:
      patch.strongHold?.runnerExitAtHoldingDays ?? undefined,
    strongHoldMaxConcurrentRunners:
      patch.strongHold?.maxConcurrentRunners ?? undefined,
    strongHoldReplacementScoreMargin:
      patch.strongHold?.replacementScoreMargin ?? undefined,
  };
}

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

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxDrawdownPct(equityCurve: readonly EquityPoint[], initialCapital: number): number {
  let peak = equityCurve[0]?.equity ?? initialCapital;
  let maximum = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) maximum = Math.max(maximum, ((peak - point.equity) / peak) * 100);
  }
  return maximum;
}

function summarizeTrades(trades: readonly Trade[]) {
  const completed = trades.filter(trade => !trade.openAtEnd && trade.returnPct !== null);
  const wins = completed.filter(trade => trade.returnPct! > 0);
  const losses = completed.filter(trade => trade.returnPct! < 0);
  const totalWin = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const totalLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const avgWin = mean(wins.map(trade => trade.returnPct!));
  const avgLoss = mean(losses.map(trade => trade.returnPct!));
  const holdingDays = completed.map(trade => trade.holdingPeriod);
  const reasonCounts = new Map<string, number>();
  for (const trade of completed) {
    const reason = trade.reason ?? "UNKNOWN";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  return {
    tradeCount: trades.length,
    completedCount: completed.length,
    openAtEndCount: trades.filter(trade => trade.openAtEnd).length,
    winRatePct: completed.length === 0 ? null : (wins.length / completed.length) * 100,
    averageWinPct: avgWin,
    averageLossPct: avgLoss,
    payoffRatio:
      avgWin === null || avgLoss === null
        ? null
        : avgWin / Math.abs(avgLoss),
    profitFactor: totalLoss === 0 ? null : totalWin / totalLoss,
    averageHoldingPeriod:
      holdingDays.length === 0
        ? null
        : holdingDays.reduce((sum, value) => sum + value, 0) / holdingDays.length,
    exitReasonCounts: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
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

const armArg = argOf("arm", "");
const slId = argOf("sl", "");
const slExperiment = slId === "" ? null : getExitPolicyExperiment(slId);
if (slExperiment === null && armArg !== "control" && !NAMED_ARMS.has(armArg)) {
  throw new Error(
    `--arm 必须是 control | ${[...NAMED_ARMS.keys()].join(" | ")}，或使用 --sl SL-xx；实际 --arm=${armArg} --sl=${slId}`,
  );
}
const namedArm = NAMED_ARMS.get(armArg);
const arm: ArmDefinition = slExperiment === null
  ? armArg === "control"
    ? CONTROL_ARM
    : armFromRegistry(namedArm!.familyId, namedArm!.armId)
  : {
      id: slExperiment.id,
      strategyVersion: slExperiment.version,
      label: slExperiment.name,
      familyId: null,
      policy: null,
      exitPolicy: slExperiment.policy,
    };
const TOP_N = 3;
const DATASET_VERSION_ID = Number(argOf("dataset-version-id", "660001"));
const DATASET_LABEL = argOf("dataset-label", "v5");
const START = argOf("start", "2019-01-01");
const END = argOf("end", "2026-09-04");
const AS_OF = argOf("as-of", "20260927");
const PERSIST = argOf("persist", "true") !== "false";
const OUT = argOf(
  "out",
  `docs/evidence/_probe_3f_top3_${slExperiment === null ? "trailing" : "exit"}_${arm.id}.json`,
);
const STOP_LOSS_RATIO = 0.06;
const STRONG_HOLD = {
  atHoldingDays: 5,
  minReturnRatio: 0.03,
  requireAboveMa5: true,
  requireAboveMa10: true,
  extendToHoldingDays: 10,
} as const;

if (!/^\d{8}$/u.test(AS_OF)) {
  throw new Error(`--as-of 必须是 YYYYMMDD，实际 ${AS_OF}`);
}

const strategyId = threeFactorTopNStrategyId(TOP_N);
const runId =
  `clrun-3f-top3-v5-v${arm.strategyVersion.replaceAll(".", "_")}-${arm.label}-${AS_OF}`;
const codeVersion = "3f-topn-exit-policy-study-20260927";
const experimentId = `EXP-${AS_OF}-${fnv1a8(
  `${strategyId}|${arm.strategyVersion}|${START}|${END}|${arm.label}|STOP=6|STRONG=3-10`,
)}`;
const strategyDocument = arm.familyId === null
  ? buildThreeFactorTopNStrategyDocument({
      topN: TOP_N,
      datasetVersionId: DATASET_VERSION_ID,
      datasetLabel: DATASET_LABEL,
      strategyVersion: arm.strategyVersion,
      stopLossRatio: STOP_LOSS_RATIO,
      strongHold: { ...STRONG_HOLD },
      excludeEventDayOpenAtLimit: true,
      observationWindow: { start: 5, end: 15, unit: "TRADING_DAY" },
      ...(arm.policy === null ? {} : { trailingPolicy: arm.policy }),
      ...(arm.exitPolicy === undefined ? {} : { exitPolicy: arm.exitPolicy }),
    })
  : buildThreeFactorTopNFamilyArmDocument(arm.familyId, arm.id, {
      topN: TOP_N,
      datasetVersionId: DATASET_VERSION_ID,
      datasetLabel: DATASET_LABEL,
    });

if (PERSIST) {
  const strategyService = new StrategyService(new DbStrategyRepository(), {
    codeVersion,
    now: () => THREE_FACTOR_TOPN_CREATED_AT,
  });
  await strategyService.save({
    document: strategyDocument as unknown as Record<string, unknown>,
  });
}

console.log(
  `[exit-study] arm=${arm.id} strategy=${strategyId}@${arm.strategyVersion} `
  + `dataset=${DATASET_VERSION_ID} window=${START}~${END}`,
);
const assembled = await assembleRunWorkbenchInputs({
  strategyId,
  strategyVersion: arm.strategyVersion,
  startDate: START,
  endDate: END,
  createdAt: THREE_FACTOR_TOPN_CREATED_AT,
  codeVersion,
  strategyDocument,
  datasetVersionId: DATASET_VERSION_ID,
  dataReady: true,
  datasetSourcePolicy: "prefer-registry",
});
const metadata: ClosedLoopRunMetadata = {
  experimentId,
  strategyId,
  strategyVersion: arm.strategyVersion,
  dateRange: { startDate: START, endDate: END },
  datasetVersion: assembled.dataset.datasetVersion,
  universeVersion: null,
  codeVersion,
  costModel: assembled.assembly.simulation.costModel,
  executionModel: assembled.assembly.simulation.executionModel,
  parameterSet: {},
};
const { artifacts, stageRunners } = createClosedLoopWiring(assembled.inputs, {
  requested: STRATEGY_EVALUATION_STAGE_IDS,
});
const startedAt = Date.now();
const run = runClosedLoop({
  runId,
  createdAt: THREE_FACTOR_TOPN_CREATED_AT,
  metadata,
  stageIds: STRATEGY_EVALUATION_STAGE_IDS,
  stageRunners,
});
const elapsedMs = Date.now() - startedAt;
const simulation = artifacts.tradeSimulationRun;
if (simulation === undefined) {
  throw new Error(
    `arm=${arm.id} 未产出 tradeSimulationRun：`
    + run.stages.map(stage => `${stage.stageId}=${stage.state}`).join(", "),
  );
}
const evaluationStage = run.stages.find(stage => stage.stageId === "evaluation");
const evaluation =
  evaluationStage?.state === "EXECUTED"
    ? (evaluationStage.output as ClosedLoopEvaluationRef | null)
    : null;
const persistedId = PERSIST
  ? await persistClosedLoopWithRetry({
      experimentId,
      strategyId,
      strategyVersion: arm.strategyVersion,
      startDate: START,
      endDate: END,
      result: toClosedLoopRunResultDto({ run, assembled }),
    })
  : null;
const tradeSummary = summarizeTrades(simulation.trades);
const payload = {
  generatedAt: new Date().toISOString(),
  arm,
  runId,
  experimentId,
  persistedId,
  elapsedMs,
  frozen: {
    topN: TOP_N,
    strategyId,
    strategyVersion: arm.strategyVersion,
    datasetVersionId: DATASET_VERSION_ID,
    datasetLabel: DATASET_LABEL,
    dateRange: { startDate: START, endDate: END },
    decision: "T+5_CLOSE",
    execution: "T+6_OPEN",
    stopLossRatio: STOP_LOSS_RATIO,
    strongHold: STRONG_HOLD,
    strongHoldAfterExtendedHold: arm.strongHoldAfterExtendedHold ?? "TIME_EXIT",
    strongHoldScaleOutRatio: arm.strongHoldScaleOutRatio ?? null,
    strongHoldRunnerExitAtHoldingDays:
      arm.strongHoldRunnerExitAtHoldingDays ?? null,
    strongHoldMaxConcurrentRunners:
      arm.strongHoldMaxConcurrentRunners ?? null,
    strongHoldReplacementScoreMargin:
      arm.strongHoldReplacementScoreMargin ?? null,
    observationWindowEnd: arm.observationWindowEnd ?? 15,
    excludeEventDayOpenAtLimit: true,
  },
  assembly: assembled.assembly,
  evaluation,
  performance: {
    initialCapital: simulation.initialCapital,
    finalEquity: simulation.finalEquity,
    totalReturnPct:
      ((simulation.finalEquity / simulation.initialCapital) - 1) * 100,
    maxDrawdownPct: maxDrawdownPct(simulation.equityCurve, simulation.initialCapital),
  },
  tradeSummary,
  trades: simulation.trades,
  positions: simulation.positions,
  skipped: simulation.skipped,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(
  `[exit-study] arm=${arm.id} final=${simulation.finalEquity.toFixed(2)} `
  + `return=${payload.performance.totalReturnPct.toFixed(4)}% `
  + `maxDD=${payload.performance.maxDrawdownPct.toFixed(4)}% `
  + `trades=${tradeSummary.tradeCount} PF=${tradeSummary.profitFactor?.toFixed(4)}`,
);
console.log(`[exit-study] output=${path.resolve(OUT)}`);
process.exit(0);
