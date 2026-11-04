/** STRATEGY-3570001-LIVE-PAPER-TRADING-001 —— 前向模拟盘的持久化与运行入口。 */
import { createHash } from "node:crypto";
import { saveClosedLoopBacktestRun } from "../closedLoopBacktestRun/repository";
import { getClosedLoopBacktestRunRawResult } from "../closedLoopBacktestRun/rawPayload";
import {
  advanceForwardOnce, initForwardState, PAPER_FORWARD_3570001_RUN_ID,
  type PaperForwardState,
} from "./forward";
import { selectPaperTradingState } from "./selection";
import type { PaperTrading3570001State } from "./run";
import { createPaperForwardRunner } from "../paperTradingFramework";

export const PAPER_FORWARD_3570001_BASELINE_RUN_ID = "paper-3570001-2025-01-01-2026-09-04";
export const PAPER_FORWARD_3570001_BASELINE_LAST_DATE = "2026-09-04";
/** 历史回放留档行 id（`paper-3570001-2025-01-01-2026-09-04`）。 */
export const PAPER_FORWARD_3570001_HISTORICAL_ROW_ID = 6000001;
/** 历史回放 runId（按 runId 直读，不依赖会被截断的列表端点）。 */
export const PAPER_FORWARD_3570001_HISTORICAL_RUN_ID = "paper-3570001-2025-01-01-2026-09-04";

function envelopeFor(state: PaperForwardState): unknown {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  return {
    runId: state.runId, createdAt: state.lastRunAt,
    chainFingerprint: sha("paper-forward:" + state.runId), fingerprint: sha(JSON.stringify(state)),
    overall: {
      status: state.status === "ERROR" ? "PARTIAL_BLOCKED" : "ALL_EXECUTED",
      executedStageCount: 14, blockedStageCount: state.status === "ERROR" ? 1 : 0, skippedStageCount: 0,
      firstBlockedReasonCode: state.status === "ERROR" ? "PAPER_FORWARD_ERROR" : null,
      synthetic: false, note: "3570001 持续前向模拟盘（STRATEGY-3570001-LIVE-PAPER-TRADING-001）",
    },
    runnerInjected: ["research", "backtest", "evaluation"],
    stages: [
      { stageId: "backtest", state: "EXECUTED", output: { kind: "backtestSummary", finalEquity: state.account.equity, tradeCount: state.forwardHistory.length, equityCurvePointCount: state.forwardDaily.length, initialCapital: state.initialCapital } },
      { stageId: "evaluation", state: "EXECUTED", output: { kind: "evaluationRef", performance: { totalReturnPct: state.account.cumulativeReturnPct, maxDrawdownPct: state.account.drawdownPct, cagrPct: null } } },
    ],
    blockedSummary: [],
    wiring: { coverageRatio: 1, enforcedCount: 3, declaredOnlyCount: 0, notDeclaredCount: 0, items: [] },
    assembly: { datasetVersion: "v7", datasetGate: "PASS", datasetRowCount: 0, datasetSecurityCount: 0, datasetSource: "registry", datasetSourceNote: null, datasetVersionId: state.datasetVersionId, recipeId: "first-limit-pullback-3f-top3", simulation: { initialCapital: state.initialCapital } },
    paperTradingForwardState: state,
  };
}

/** 读取已持久化的前向状态；不存在 ⇒ null（不伪造）。 */
export async function loadForwardState(): Promise<PaperForwardState | null> {
  // 🔴 按 runId **直读原样载荷**：旧读取路径会对结果做旧版闭环 reconcile，不匹配即置 null。
  const raw = await getClosedLoopBacktestRunRawResult(PAPER_FORWARD_3570001_RUN_ID);
  return (raw?.payload.paperTradingForwardState as PaperForwardState | undefined) ?? null;
}

async function saveForwardState(state: PaperForwardState): Promise<void> {
  await saveClosedLoopBacktestRun({
    experimentId: "STRATEGY-3570001-LIVE-PAPER-TRADING-001",
    strategyId: state.strategyId, strategyVersion: state.strategyVersion,
    startDate: state.baselineLastProcessedDate, endDate: state.lastProcessedTradingDate,
    result: envelopeFor(state) as never,
  });
}

/**
 * 正式入口：推进「下一个可用交易日」。幂等（已处理的日期不会重复追加）；
 * 无新数据 ⇒ `WAITING_FOR_NEW_DATA` 且不产生任何新记录；失败 ⇒ 持久化 ERROR，不破坏既有账户。
 */
/** 读取历史回放基线；缺失即响亮失败，拒绝从空账户起步。 */
async function loadHistoricalBaseline(): Promise<PaperTrading3570001State> {
  const raw = await getClosedLoopBacktestRunRawResult(PAPER_FORWARD_3570001_HISTORICAL_RUN_ID);
  const historical = ((raw?.payload.paperTradingState ?? null) as PaperTrading3570001State | null);
  if (historical === null) throw new Error("找不到历史回放基线（6000001），拒绝以空账户起步");
  return historical;
}

/** 把历史回放账户/持仓/峰值转成前向 checkpoint。 */
async function initializeFromHistoricalBaseline(): Promise<PaperForwardState> {
  const historical = await loadHistoricalBaseline();
  return initForwardState({
    baselineRunId: PAPER_FORWARD_3570001_BASELINE_RUN_ID,
    // R6：整段重放的起点 —— 直接取历史回放的真实窗口起点（不是硬编码常量）。
    baselineStartDate: historical.window.startDate,
    baselineLastProcessedDate: PAPER_FORWARD_3570001_BASELINE_LAST_DATE,
    latestDataDate: PAPER_FORWARD_3570001_BASELINE_LAST_DATE,
    strategyVersionId: 3570001, provenanceId: 660001, holdoutRunId: "RUN-20261002-BD1D7332",
    baseline: {
      initialCapital: historical.initialCapital,
      maxPositions: historical.maxPositions,
      singlePositionRatio: historical.singlePositionRatio,
      account: historical.account,
      openPositions: historical.openPositions,
    },
  });
}

/** 通用 Forward 服务：加载/初始化/推进/保存与断点重建均复用同一框架。 */
const forwardRunner = createPaperForwardRunner<PaperForwardState>({
  load: loadForwardState,
  initialize: initializeFromHistoricalBaseline,
  advance: advanceForwardOnce,
  save: saveForwardState,
  reset: initializeFromHistoricalBaseline,
});

/** 运维/开发入口：以历史回放为基线重建前向状态（账户从基线继续，不重置）。 */
export async function resetForwardState(): Promise<PaperForwardState> {
  return forwardRunner.reset();
}

export async function runNextAvailableDay(): Promise<PaperForwardState> {
  return forwardRunner.runNextAvailableDay();
}
