/**
 * 把已验证的 3F TopN 证据 JSON 回放为 closed_loop_backtest_run 留档。
 *
 * 这不是重新计算：脚本先校验 evidenceRun.fingerprintMatchesOfficial，
 * 再用既有 ClosedLoop 契约重建完整 run/stages，最后经既有重试写入数据库。
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { appRouter } from "../server/routers";
import { runClosedLoop } from "../server/research/closedLoop/orchestrator";
import {
  CLOSED_LOOP_STAGE_IDS,
  type ClosedLoopRunMetadata,
} from "../server/research/closedLoop/types";
import { computeFingerprintOfBody } from "../server/research/closedLoop/serialize";
import {
  wiredClosedLoopStages,
} from "../server/research/closedLoopWiring/coverage";
import { buildBacktestResult, buildBacktestRunPayload } from "../server/backtest/backtestResult";
import { persistClosedLoopBacktestRun } from "../server/researchRunRouter";
import { withPersistedSecurityLabels } from "../server/closedLoopBacktestRun/securityLabels";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import {
  buildThreeFactorTopNStrategyDocument,
  THREE_FACTOR_TOPN_COST_MODEL,
  THREE_FACTOR_TOPN_CREATED_AT,
  THREE_FACTOR_TOPN_STRATEGY_VERSION,
  threeFactorTopNStrategyId,
} from "../server/research/patternLibrary/threeFactorTopNStrategy";
import { THREE_FACTOR_TOPN_STOP_LOSS_RATIO } from "../server/research/patternLibrary/patterns/firstLimitPullback3FTopN";

function argOf(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1]!;
  return fallback;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TOP_N = Number(argOf("topn", "3"));
const DATASET_VERSION_ID = Number(argOf("dataset-version-id", "660001"));
const DATASET_LABEL = argOf("dataset-label", "v5");
const EVIDENCE = argOf("evidence", `docs/evidence/_probe_3f_topn_v5_top${TOP_N}.json`);
const STRATEGY_VERSION_TAG = THREE_FACTOR_TOPN_STRATEGY_VERSION.replaceAll(".", "_");
const STOP_LOSS_PERCENT = Math.round(THREE_FACTOR_TOPN_STOP_LOSS_RATIO * 100);
const RUN_ID = argOf(
  "run-id",
  `clrun-3f-top${TOP_N}-v5-v${STRATEGY_VERSION_TAG}-sl${STOP_LOSS_PERCENT}-20260926`,
);

if (!Number.isInteger(TOP_N) || (TOP_N !== 3 && TOP_N !== 5)) {
  throw new Error(`--topn 只能是 3 或 5，实际 ${String(TOP_N)}`);
}

type Evidence = {
  inputs: {
    topN: number;
    recipeId: string;
    strategyId: string;
    strategyVersion: string;
    datasetVersionId: number;
    datasetLabel: string;
    dateRange: { startDate: string; endDate: string };
    stopLossRatio: number;
    maxPositions: number;
    initialCapital: number;
    costModel: typeof THREE_FACTOR_TOPN_COST_MODEL;
  };
  official: {
    experimentId: string;
    datasetVersion: string;
    datasetSource: string;
    datasetRowCount: number;
    backtestFingerprint: string;
    evaluation: Record<string, unknown>;
    equityCurve: Array<{ date: string; equity: number; cash: number; marketValue: number; openPositions: number }>;
  };
  evidenceRun: {
    fingerprint: string;
    fingerprintMatchesOfficial: boolean;
    decisionDayCount: number;
    initialCapital: number;
    finalEquity: number;
    costs: Record<string, number>;
    executionStats: Record<string, unknown>;
    trades: Array<{
      securityId: string;
      entryTime: string;
      entryPrice: number;
      exitTime: string | null;
      exitPrice: number | null;
      quantity: number;
      grossPnL: number | null;
      fees: number;
      slippageAmount: number;
      netPnl: number | null;
      returnPct: number | null;
      holdingPeriod: number | null;
      openAtEnd: boolean;
      reason?: string | null;
    }>;
    skippedByCode: Record<string, number>;
  };
  candidateLayer: {
    decisionDays: number;
    signalTotal: number;
    selectedTotal: number;
    droppedReasons: Record<string, number>;
  };
  executionPanelAudit: {
    panelSecurityCount: number;
  };
};

const evidence = JSON.parse(readFileSync(EVIDENCE, "utf8")) as Evidence;
assertCondition(evidence.inputs.topN === TOP_N, `证据 topN=${evidence.inputs.topN}，请求 topN=${TOP_N}`);
assertCondition(
  evidence.inputs.datasetVersionId === DATASET_VERSION_ID,
  `证据 datasetVersionId=${evidence.inputs.datasetVersionId}，请求 ${DATASET_VERSION_ID}`,
);
assertCondition(
  evidence.inputs.strategyVersion === THREE_FACTOR_TOPN_STRATEGY_VERSION,
  `证据 strategyVersion=${evidence.inputs.strategyVersion}，当前装配版本=${THREE_FACTOR_TOPN_STRATEGY_VERSION}；旧证据不得冒充新版本回放。`,
);
assertCondition(
  evidence.inputs.stopLossRatio === THREE_FACTOR_TOPN_STOP_LOSS_RATIO,
  `证据 stopLossRatio=${String(evidence.inputs.stopLossRatio)}，当前=${THREE_FACTOR_TOPN_STOP_LOSS_RATIO}；缺少止损口径的旧证据不得回放。`,
);
assertCondition(
  evidence.evidenceRun.fingerprintMatchesOfficial,
  "证据未通过「官方标量 vs 注入证据」双跑指纹一致性校验。",
);

const strategyId = threeFactorTopNStrategyId(TOP_N);
const strategyDocument = buildThreeFactorTopNStrategyDocument({
  topN: TOP_N,
  datasetVersionId: DATASET_VERSION_ID,
  datasetLabel: DATASET_LABEL,
});
const strategyService = new StrategyService(new DbStrategyRepository(), {
  codeVersion: "1.0.0+gunknown",
  now: () => THREE_FACTOR_TOPN_CREATED_AT,
});
await strategyService.save({ document: strategyDocument as unknown as Record<string, unknown> });
const savedVersion = await strategyService.loadVersion(strategyId, THREE_FACTOR_TOPN_STRATEGY_VERSION);

const dateRange = evidence.inputs.dateRange;
const metadata: ClosedLoopRunMetadata = {
  experimentId: evidence.official.experimentId,
  strategyId,
  strategyVersion: THREE_FACTOR_TOPN_STRATEGY_VERSION,
  dateRange,
  datasetVersion: evidence.official.datasetVersion,
  universeVersion: null,
  codeVersion: "1.0.0+gunknown",
  costModel: THREE_FACTOR_TOPN_COST_MODEL,
  executionModel: "NEXT_OPEN",
  parameterSet: {},
};

const source = (module: string, moduleRunKind: string | null, fingerprint: string | null) => ({
  module,
  moduleRunKind,
  runId: null,
  fingerprint,
});

const dataSummary = {
  kind: "datasetSummary",
  handoffVersion: 1,
  synthetic: false,
  source: source("researchDataset", "RESEARCH_DATASET", evidence.official.datasetVersion),
  datasetVersion: evidence.official.datasetVersion,
  gate: "PASS",
  dateRange,
  builderVersion: "1.0.0",
  rowSchemaVersion: "1",
  rowCount: evidence.official.datasetRowCount,
  universeCount: evidence.executionPanelAudit.panelSecurityCount,
  coverageGaps: ["由已验证证据 JSON 回放落库；原始执行证据见 docs/research/RESULT-3F-TOPN-STRATEGY-001.md"],
};

const candidateFingerprint = computeFingerprintOfBody(evidence.candidateLayer);
const researchSummary = {
  kind: "researchSummary",
  handoffVersion: 1,
  synthetic: false,
  source: source("signalEngine", "CANDIDATE_EVALUATION_RUN", candidateFingerprint),
  datasetVersion: evidence.official.datasetVersion,
  candidateRunFingerprint: candidateFingerprint,
  evaluated: {
    candidateCount: evidence.candidateLayer.selectedTotal,
    decisionDateRange: dateRange,
  },
  notes: [
    `决策日数 = ${evidence.candidateLayer.decisionDays}`,
    `信号 = ${evidence.candidateLayer.signalTotal}；入选 = ${evidence.candidateLayer.selectedTotal}`,
  ],
};

const strategySummary = {
  kind: "strategyDocRef",
  handoffVersion: 1,
  synthetic: false,
  source: source("strategySchema", "STRATEGY_DOCUMENT", savedVersion.strategy.fingerprint),
  strategyId,
  strategyVersion: THREE_FACTOR_TOPN_STRATEGY_VERSION,
  docFingerprint: savedVersion.strategy.fingerprint,
  versionRecordFingerprint: savedVersion.fingerprint,
  rules: {
    entryRuleCount: savedVersion.strategy.entryRules.length,
    exitRuleCount: savedVersion.strategy.exitRules.length,
    sizingRuleCount: 1,
    riskRuleCount: savedVersion.strategy.riskRules.length,
  },
};

const backtestSummary = {
  kind: "backtestSummary",
  handoffVersion: 1,
  synthetic: false,
  source: source("simulator", "TRADE_SIMULATION_RUN", evidence.evidenceRun.fingerprint),
  datasetVersion: evidence.official.datasetVersion,
  datasetGate: "PASS",
  dateRange: {
    startDate: evidence.official.equityCurve[0]?.date ?? dateRange.startDate,
    endDate: evidence.official.equityCurve.at(-1)?.date ?? dateRange.endDate,
  },
  initialCapital: evidence.evidenceRun.initialCapital,
  finalEquity: evidence.evidenceRun.finalEquity,
  decisionDayCount: evidence.evidenceRun.decisionDayCount,
  equityCurvePointCount: evidence.official.equityCurve.length,
  tradeCount: evidence.evidenceRun.trades.length,
  equityCurve: evidence.official.equityCurve,
  executionStats: evidence.evidenceRun.executionStats,
  skippedCounts: Object.entries(evidence.evidenceRun.skippedByCode)
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count),
  trades: evidence.evidenceRun.trades.slice(0, 1_000),
  tradesTruncated: evidence.evidenceRun.trades.length > 1_000,
  costs: evidence.evidenceRun.costs,
};

const run = runClosedLoop({
  runId: RUN_ID,
  createdAt: THREE_FACTOR_TOPN_CREATED_AT,
  metadata,
  stageIds: ["data", "research", "strategy", "backtest", "evaluation"],
  stageRunners: {
    data: () => dataSummary,
    research: () => researchSummary,
    strategy: () => strategySummary,
    backtest: () => backtestSummary,
    evaluation: () => evidence.official.evaluation,
  } as never,
});

const wired = new Set<string>(wiredClosedLoopStages());
const requested = [...run.request.stageIds];
const coveredStages = run.stages.filter(stage => stage.state === "EXECUTED").map(stage => stage.stageId);
const uncoveredStages = requested.filter(stageId => !coveredStages.includes(stageId));

const backtestResult = buildBacktestResult({
  runId: run.runId,
  strategyVersionId: `${strategyId}@${THREE_FACTOR_TOPN_STRATEGY_VERSION}`,
  datasetVersionId: DATASET_VERSION_ID,
  parameterSet: {},
  initialCapital: evidence.evidenceRun.initialCapital,
  equityCurve: evidence.official.equityCurve,
  tradeLedger: evidence.evidenceRun.trades,
  notes: [
    "由已验证证据 JSON 回放落库；未在本次落库过程中重新取数或重新撮合。",
    `原始结果文档：docs/research/RESULT-3F-TOPN-STRATEGY-001.md`,
  ],
});
const backtestPayload = buildBacktestRunPayload({ result: backtestResult });

const expected = evidence.official.evaluation.canonicalMetrics as Record<string, unknown> | undefined;
if (expected !== undefined) {
  const actual = backtestPayload.canonicalMetrics;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (typeof expectedValue === "number") {
      const actualValue = actual[key as keyof typeof actual];
      if (typeof actualValue === "number" && Math.abs(actualValue - expectedValue) > 1e-8) {
        throw new Error(`证据回放指标漂移：${key} 期望 ${expectedValue}，实际 ${actualValue}`);
      }
    }
  }
}

let result = {
  runId: run.runId,
  createdAt: run.createdAt,
  chainFingerprint: run.chainFingerprint,
  fingerprint: run.fingerprint,
  overall: {
    status: run.overall.status,
    executedStageCount: run.overall.executedStageCount,
    blockedStageCount: run.overall.blockedStageCount,
    skippedStageCount: run.overall.skippedStageCount,
    firstBlockedReasonCode: run.overall.firstBlockedReasonCode,
    synthetic: run.overall.synthetic,
    note: run.overall.note,
  },
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
    wiredStages: CLOSED_LOOP_STAGE_IDS.filter(stageId => wired.has(stageId)),
    unwiredStages: CLOSED_LOOP_STAGE_IDS.filter(stageId => !wired.has(stageId)),
    coveredStages,
    uncoveredStages,
    executorBound: requested.length > 0 && uncoveredStages.length === 0,
  },
  assembly: {
    datasetVersion: evidence.official.datasetVersion,
    datasetGate: "PASS",
    datasetRowCount: evidence.official.datasetRowCount,
    datasetSecurityCount: evidence.executionPanelAudit.panelSecurityCount,
    datasetSource: "registry",
    datasetSourceNote: "由已验证证据 JSON 回放落库；未重新读取数据集。",
    datasetVersionId: DATASET_VERSION_ID,
    dateRange,
    strategyId,
    strategyVersion: THREE_FACTOR_TOPN_STRATEGY_VERSION,
    recipeId: strategyId,
    recipeSource: "strategy-document",
    recipeFeatureIds: ["threeFactorCompositeScore"],
    selectionSummary: `按 3F 合成分降序取前 ${TOP_N} 名`,
    strategyDecisionEngine: "strategy-core",
    strategyDecisionEngineNote: "证据回放：决策/撮合/评估均取自原始真实回测证据，本次不重新计算。",
    simulation: {
      initialCapital: evidence.inputs.initialCapital,
      maxPositions: evidence.inputs.maxPositions,
      executionModel: "NEXT_OPEN",
      costModel: evidence.inputs.costModel,
    },
  },
  backtest: backtestPayload,
} as never;

result = await withPersistedSecurityLabels(result);

const persistence = await persistClosedLoopBacktestRun({
  experimentId: evidence.official.experimentId,
  strategyId,
  strategyVersion: THREE_FACTOR_TOPN_STRATEGY_VERSION,
  startDate: dateRange.startDate,
  endDate: dateRange.endDate,
  result,
});
assertCondition(persistence.persisted, `留档失败：${JSON.stringify(persistence)}`);

const caller = appRouter.createCaller({
  user: { id: 1, role: "admin", openId: "3f-import", name: "3f-import" },
  req: { protocol: "http", headers: {} },
  res: { clearCookie: () => {} },
} as never);
const history = await caller.researchRun.listBacktests({ strategyId, limit: 10 });
const saved = history.find(item => item.runId === RUN_ID);
assertCondition(saved !== undefined, `留档回读失败：未找到 ${RUN_ID}`);
const detail = await caller.researchRun.getBacktest({ id: saved.id });
assertCondition(detail?.result?.runId === RUN_ID, `留档详情回读失败：id=${saved.id}`);

console.log(
  JSON.stringify(
    {
      topN: TOP_N,
      runId: RUN_ID,
      archiveId: saved.id,
      persisted: persistence,
      fingerprintMatchesOfficial: evidence.evidenceRun.fingerprintMatchesOfficial,
      finalEquity: saved.finalEquity,
      tradeCount: saved.tradeCount,
      equityCurvePointCount: saved.equityCurvePointCount,
      canonicalMetrics: backtestPayload.canonicalMetrics,
    },
    null,
    2,
  ),
);

process.exit(0);
