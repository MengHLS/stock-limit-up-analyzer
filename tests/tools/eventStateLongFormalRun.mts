/**
 * EVENT-STATE-LONG-EXECUTION-PARITY-001 · S4 正式复现工具（**版本管理内的可复现资产**）。
 *
 * 目的：把 §3 固定配置经**正式装配入口**跑完整闭环，并用**既有持久化端口**留档，
 * 使其他机器能凭本文件 + 库内记录重建同一次运行。
 *
 * 用法（需 DATABASE_URL）：
 *   pnpm exec tsx tests/tools/eventStateLongFormalRun.mts --dataset 780005
 *   pnpm exec tsx tests/tools/eventStateLongFormalRun.mts --dataset 780004
 *
 * 纪律：
 *   - 只读策略文档 / 数据集；写入**仅**经 `persistClosedLoopBacktestRun`（既有端口）；
 *   - 不开展参数变体；不修改历史记录；
 *   - 长任务日志由调用方落盘（本文件只在 **stdout** 输出进度，不自行重定向）。
 */

import 'dotenv/config';
import fs from 'node:fs';
import { assembleRunWorkbenchInputs } from '../../server/runWorkbenchAssembly/assemble';
import { createClosedLoopWiring, createStreamingClosedLoopWiring } from '../../server/research/closedLoopWiring/executors';
import { runClosedLoop } from '../../server/research/closedLoop/orchestrator';
import { persistClosedLoopBacktestRun, toWiringSummary } from '../../server/researchRunRouter';
import { composeCodeVersion } from '../../server/research/experimentLineage/codeVersion';
import { StrategyService } from '../../server/research/strategyPersistence/service';
import { DbStrategyRepository } from '../../server/research/strategyPersistence/db';

const STRATEGY_ID = 'event-state-long-maxamp5-top3';
/** 允许 `--version` 指定臂版本（缺省 2.0.0 = 控制臂）。 */
const STRATEGY_VERSION = argValue('--version') ?? '2.0.0';
/**
 * 运行身份（`runClosedLoop` 强制 §28 形态 `EXP-YYYYMMDD-XXXXXXXX`）。
 *
 * 🔴 说明：这是**工程复现运行的身份**，不是独立实验体系里的一条 `research_experiment_run`
 * （后者由 `ExperimentRunService` 维护）。本 Run 是**真实执行**的闭环留档；
 * 若要接 `strategy_research_provenance` 的 `INDEPENDENT_EXPERIMENT` 证据桥，
 * 需另经 `defaultExperimentRunService().execute(...)` 产生真实实验 Run —— 属未完成项，绝不伪造。
 */
const EXPERIMENT_ID = 'EXP-20261010-PARITY01';
/** 与 §3 固定区间一致。 */
const WINDOWS: Record<string, { startDate: string; endDate: string }> = {
  '780004': { startDate: '2019-01-03', endDate: '2026-01-28' },
  '780005': { startDate: '2026-01-29', endDate: '2026-10-09' },
};

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : null;
}

const datasetKey = argValue('--dataset') ?? '780005';
const baseWindow = WINDOWS[datasetKey];
if (baseWindow === undefined) {
  console.error(`未知数据集 ${datasetKey}（支持 780004 / 780005）`);
  process.exit(2);
}
/**
 * 允许显式覆盖区间（`--start` / `--end`）。
 *
 * 🔴 用途与纪律：平台在 `research/datasetAccess/session.ts` 强制「实验日期范围 ⊆ 数据集窗口
 *   （`dataSnapshot.request.startDate/endDate`）」。**物化直读路径**把该窗口取为
 *   `dataset_version` 的事件窗（`datasetFromRegistry.ts` 内 `version.startDate/endDate`），
 *   因此**超出最后一个事件日**的运行区间会被拒绝；**流式游标路径**的窗口是
 *   `cursorStart..cursorEnd`（含执行尾窗）⇒ 能接受同一区间。
 *   覆盖区间时必须**如实登记差异**，不得把裁剪后的结果冒充全区间结果。
 */
const window = {
  startDate: argValue('--start') ?? baseWindow.startDate,
  endDate: argValue('--end') ?? baseWindow.endDate,
};
const windowOverridden = window.startDate !== baseWindow.startDate || window.endDate !== baseWindow.endDate;
if (windowOverridden) {
  console.log(`[parity] WINDOW_OVERRIDDEN base=${baseWindow.startDate}~${baseWindow.endDate} actual=${window.startDate}~${window.endDate}`);
}
const datasetVersionId = Number(datasetKey);

/** 真实代码坐标：由 canonical 纯函数组合（dirty 如实反映未提交工作区）。 */
const CODE_VERSION = composeCodeVersion({
  packageVersion: '1.0.0',
  git: { commitShortHash: 'f8b6810', dirty: true },
});
const CREATED_AT = new Date().toISOString();
const RUN_ID = `clrun-parity-${datasetKey}-v${STRATEGY_VERSION.replace(/\./g, '')}-${CREATED_AT.replace(/[^0-9]/g, '').slice(0, 17)}`;
const STAGES = ['data', 'research', 'strategy', 'backtest', 'evaluation'] as const;

console.log(`[parity] dataset=${datasetKey} window=${window.startDate}~${window.endDate} codeVersion=${CODE_VERSION}`);
console.log(`[parity] runId=${RUN_ID}`);

// 1) 读回真实策略版本（只用既有服务端口；不构造内存文档）
const repo = new DbStrategyRepository();
const service = new StrategyService(repo, { codeVersion: CODE_VERSION });
const record = await service.loadVersion(STRATEGY_ID, STRATEGY_VERSION);
const document = record.strategy;
console.log(`[parity] strategyDocument fingerprint=${document.fingerprint}`);

// 2) 正式装配（唯一入口；含配方解析 / 仓位映射 / 执行尾窗派生）
const t0 = Date.now();
const built = await assembleRunWorkbenchInputs({
  strategyDocument: document,
  strategyId: STRATEGY_ID,
  strategyVersion: STRATEGY_VERSION,
  startDate: window.startDate,
  endDate: window.endDate,
  datasetVersionId,
  dataReady: true,
  codeVersion: CODE_VERSION,
  createdAt: CREATED_AT,
} as never);
console.log(`[parity] assembled in ${((Date.now() - t0) / 1000).toFixed(1)}s source=${built.assembly.datasetSource} rows=${built.assembly.datasetRowCount} tail=${String(built.assembly.eventWindowExitTailTradingDays)}`);

// 3) 闭环（与 `executeClosedLoopRun` 同一调用序列）
const wiringInputs = built.inputs;
const requested = [...STAGES] as never;
const wiring = wiringInputs.researchDatasetCursor !== undefined
  ? await createStreamingClosedLoopWiring(wiringInputs, { requested } as never)
  : createClosedLoopWiring(wiringInputs, { requested } as never);
const { stageRunners, artifacts } = wiring;

const metadata = {
  experimentId: EXPERIMENT_ID,
  strategyId: STRATEGY_ID,
  strategyVersion: STRATEGY_VERSION,
  dateRange: { ...window },
  datasetVersion: built.dataset.datasetVersion ?? null,
  universeVersion: null,
  codeVersion: CODE_VERSION,
  costModel: null,
  executionModel: built.side.executionModel ?? null,
  parameterSet: {} as never,
};
const run = runClosedLoop({
  runId: RUN_ID,
  createdAt: CREATED_AT,
  metadata: metadata as never,
  stageIds: requested,
  stageRunners,
} as never);
console.log(`[parity] closedLoop stages=${run.stages.map((s) => s.stageId + ':' + s.state).join(',')}`);

const sim = artifacts.tradeSimulationRun as unknown as
  | {
      trades?: readonly Record<string, unknown>[];
      equityCurve?: readonly Record<string, unknown>[];
      positions?: readonly Record<string, unknown>[];
      executionStats?: unknown;
      skipped?: readonly { code?: string; reason?: string }[];
      costs?: unknown;
      fingerprint?: string;
      finalEquity?: number;
      decisionDayCount?: number;
      config?: unknown;
      datasetVersion?: string;
    }
  | undefined;
const candidateRun = artifacts.candidateRun as unknown as { days?: readonly Record<string, unknown>[]; fingerprint?: string } | undefined;

const trades = sim?.trades ?? [];
const equityCurve = (sim?.equityCurve ?? []) as readonly Record<string, unknown>[];
const skippedByReason = new Map<string, number>();
for (const entry of sim?.skipped ?? []) {
  const key = String(entry.code ?? entry.reason ?? 'UNKNOWN');
  skippedByReason.set(key, (skippedByReason.get(key) ?? 0) + 1);
}
let lotViolations = 0;
const lotViolationExamples: unknown[] = [];
for (const t of trades) {
  const qty = Number(t.quantity ?? NaN);
  if (Number.isFinite(qty) && qty % 100 !== 0) {
    lotViolations += 1;
    if (lotViolationExamples.length < 5) {
      lotViolationExamples.push({
        securityId: t.securityId, quantity: t.quantity, entryTime: t.entryTime, exitTime: t.exitTime,
        entryPrice: t.entryPrice, exitPrice: t.exitPrice, reason: t.reason, openAtEnd: t.openAtEnd,
      });
    }
  }
}
/** `--no-persist`：只做诊断/复算，不写库（避免产生重复 Run 行）。 */
const NO_PERSIST = process.argv.includes('--no-persist');

// 4) 既有持久化端口留档
/** 装配摘要（可序列化面；进 Run Record，供界面与审计复读「这次到底按什么跑的」）。 */
const assemblySummaryOut = {
  datasetVersion: built.assembly.datasetVersion,
  datasetGate: built.assembly.datasetGate,
  datasetRowCount: built.assembly.datasetRowCount,
  datasetSecurityCount: built.assembly.datasetSecretCount,
  datasetSource: built.assembly.datasetSource,
  datasetSourceNote: built.assembly.datasetSourceNote,
  datasetVersionId: built.assembly.datasetVersionId,
  dateRange: { ...built.assembly.dateRange },
  strategyId: built.assembly.strategyId,
  strategyVersion: built.assembly.strategyVersion,
  recipeId: built.assembly.recipeId,
  recipeSource: built.assembly.recipeSource,
  recipeFeatureIds: [...built.assembly.recipeFeatureIds],
  selectionSummary: built.assembly.selectionSummary,
  strategyDecisionEngine: built.assembly.strategyDecisionEngine,
  strategyDecisionEngineNote: built.assembly.strategyDecisionEngineNote,
  runtimeOverrides: [...built.assembly.runtimeOverrides],
  eventWindowExitTailTradingDays: built.assembly.eventWindowExitTailTradingDays ?? null,
  simulation: {
    initialCapital: built.assembly.simulation.initialCapital,
    maxPositions: built.assembly.simulation.maxPositions,
    maxDailyBuys: built.assembly.simulation.maxDailyBuys,
    executionModel: built.assembly.simulation.executionModel,
    costModel: { ...built.assembly.simulation.costModel },
  },
};
const resultOut = {
  runId: run.runId,
  createdAt: run.createdAt,
  chainFingerprint: run.chainFingerprint,
  fingerprint: run.fingerprint,
  overall: { ...run.overall },
  runnerInjected: [...run.request.runnerInjected],
  stages: run.stages.map((stage) => ({
    stageId: stage.stageId,
    state: stage.state,
    outputKind: stage.producedHandoffKind,
    outputHandoffFingerprint: stage.outputHandoffFingerprint,
    output: stage.output ?? null,
    blocked: stage.blocked === null
      ? null
      : {
          reasonCode: stage.blocked.reasonCode,
          detail: stage.blocked.detail,
          upstreamStageId: stage.blocked.upstreamStageId,
          errorCode: stage.blocked.errorCode,
          errorMessage: stage.blocked.errorMessage,
        },
  })),
  blockedSummary: run.blockedSummary.map((item) => ({
    stageId: item.stageId,
    reasonCode: item.reasonCode,
    detail: item.detail,
    upstreamStageId: item.upstreamStageId,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
  })),
  // 🔴 必须用**平台自己的**装配覆盖率投影：`getBacktests`（读路径）会校验该形状，
  //    自己拼 `{requested, streaming}` 会写出「落库成功但读不出来」的记录（实测）。
  wiring: toWiringSummary(wiringInputs, requested),
  assembly: assemblySummaryOut,
} as never;

const persistence = NO_PERSIST
  ? { persisted: false, skippedReason: '--no-persist', archiveId: null }
  : await persistClosedLoopBacktestRun({
  experimentId: EXPERIMENT_ID,
  strategyId: STRATEGY_ID,
  strategyVersion: STRATEGY_VERSION,
  startDate: window.startDate,
  endDate: window.endDate,
  ...(document !== undefined ? { strategyDocument: document } : {}),
  result: resultOut,
} as never);
console.log(`[parity] persisted=${JSON.stringify(persistence)}`);

// 5) 复现证据摘要（落盘到 _scratch；同时打印以便落日志）
const evidence = {
  runId: RUN_ID,
  experimentId: EXPERIMENT_ID,
  datasetVersionId,
  datasetVersion: built.dataset.datasetVersion,
  dateRange: window,
  requestedWindow: baseWindow,
  windowOverridden,
  actualEquityRange: {
    startDate: equityCurve[0]?.date ?? null,
    endDate: equityCurve[equityCurve.length - 1]?.date ?? null,
    points: equityCurve.length,
  },
  strategy: { strategyId: STRATEGY_ID, version: STRATEGY_VERSION, documentFingerprint: document.fingerprint },
  codeVersion: CODE_VERSION,
  assembly: assemblySummaryOut,
  closedLoop: {
    chainFingerprint: run.chainFingerprint,
    fingerprint: run.fingerprint,
    overall: run.overall,
    stageStates: run.stages.map((s) => ({ stageId: s.stageId, state: s.state })),
  },
  candidate: { days: candidateRun?.days?.length ?? null, fingerprint: candidateRun?.fingerprint ?? null },
  simulation: {
    fingerprint: sim?.fingerprint ?? null,
    finalEquity: sim?.finalEquity ?? null,
    decisionDayCount: sim?.decisionDayCount ?? null,
    tradeCount: trades.length,
    openPositionsAtEnd: sim?.positions?.length ?? null,
    equityStart: equityCurve[0] ?? null,
    equityEnd: equityCurve[equityCurve.length - 1] ?? null,
    executionStats: sim?.executionStats ?? null,
    skippedByReason: [...skippedByReason.entries()],
    lotViolations,
    lotViolationExamples,
    costs: sim?.costs ?? null,
  },
  persistence,
};
const outPath = `_scratch/goalParityS4-${datasetKey}.json`;
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n');
console.log('[parity] evidence => ' + outPath);
console.log(JSON.stringify(evidence, null, 1));
process.exit(0);
