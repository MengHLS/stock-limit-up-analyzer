/**
 * STRATEGY-3570001-LIVE-PAPER-TRADING-001 —— 持续向前推进的前向模拟盘。
 *
 * 与「历史回放」（`paper-3570001-2025-01-01-2026-09-04`）的分工：
 *   - 历史回放一次性投影整段窗口；
 *   - 本模块是**有状态的增量推进器**：只处理 `lastProcessedTradingDate` 之后**尚未处理**的交易日，
 *     把新交易日的记录**追加**到既有前向状态，并更新账户 / 峰值 / 回撤 / 统计。
 *
 * 复用（零第二套策略引擎）：选股 ← `buildFirstLimitPullback3FTop3SourceRun`；
 * 组合执行 ← `runCompositeRunnerBacktest`（唯一 `runTradeSimulation`）；每日投影 ← `derivePaperTradingDaily`。
 *
 * 数据边界：每一步只用 `<= 当前处理交易日` 的信息；尚未到达 `decisionHoldingDays=5` 的持仓
 * Runner 一律 `PENDING`（投影层已保证不读判定日之后的数据）。
 * 无新数据时**不制造模拟数据**，状态为 `WAITING_FOR_NEW_DATA`。
 */

import {
  buildPaperTrading3570001State, derivePaperTradingDaily,
  PAPER_TRADING_3570001_BASELINE_DATASET_VERSION_ID, PAPER_TRADING_3570001_DATASET_VERSION_ID,
  PAPER_TRADING_3570001_RUNNER, PAPER_TRADING_3570001_STRATEGY_ID, PAPER_TRADING_3570001_STRATEGY_VERSION,
  type PaperDailyRecord, type PaperExitRecord, type PaperPositionRecord,
} from "./run";
import {
  buildFirstLimitPullback3FTop3SourceRun, rebuildCompositeRun, runCompositeRunnerBacktest, COMPOSITE_RUNNER_TOP_N,
} from "../research/compositeRunner/index";
import { buildThreeFactorTopNStrategyDocument, THREE_FACTOR_TOPN_CREATED_AT } from "../research/patternLibrary/threeFactorTopNStrategy";
import { buildThreeFactorTopNFamilyArmInput } from "../research/patternLibrary/threeFactorTopNFamilies";
import { createDefaultCompositeDatasetProvider } from "../researchExperiments/compositeDatasetProvider";

export const PAPER_FORWARD_3570001_RUN_ID = "paper-3570001-forward";
export const PAPER_FORWARD_3570001_STATUSES = ["WAITING_FOR_NEW_DATA", "ADVANCED", "ERROR"] as const;
export type PaperForwardStatus = (typeof PAPER_FORWARD_3570001_STATUSES)[number];

export interface PaperForwardStats {
  readonly newTradeCount: number; readonly newSignalCount: number; readonly newRunnerCount: number;
  readonly forwardReturnPct: number | null; readonly forwardMaxDrawdownPct: number | null;
  readonly forwardProfitFactor: number | null; readonly forwardWinRatePct: number | null;
  readonly forwardAverageHoldingDays: number | null; readonly runnerDirectContribution: number;
}
export interface PaperForwardAccount {
  readonly cash: number; readonly marketValue: number; readonly equity: number; readonly peakEquity: number;
  readonly dailyReturnPct: number | null; readonly cumulativeReturnPct: number; readonly drawdownPct: number;
}
export interface PaperForwardState {
  readonly runId: string;
  readonly task: "STRATEGY-3570001-LIVE-PAPER-TRADING-001";
  readonly strategyVersionId: number; readonly strategyId: string; readonly strategyVersion: string;
  readonly datasetVersionId: number; readonly runner: typeof PAPER_TRADING_3570001_RUNNER;
  readonly provenanceId: number; readonly holdoutRunId: string;
  readonly baselineRunId: string; readonly baselineLastProcessedDate: string;
  readonly latestDataDate: string; readonly lastProcessedTradingDate: string;
  readonly nextTradingDate: string | null;
  readonly status: PaperForwardStatus; readonly lastRunAt: string; readonly lastError: string | null;
  readonly initialCapital: number; readonly maxPositions: number; readonly singlePositionRatio: number;
  readonly account: PaperForwardAccount;
  readonly carriedPositions: readonly PaperPositionRecord[];
  readonly forwardDaily: readonly PaperDailyRecord[];
  readonly forwardHistory: readonly PaperExitRecord[];
  readonly forwardStats: PaperForwardStats;
}

function pfOf(history: readonly PaperExitRecord[]): number | null {
  let p = 0; let n = 0;
  for (const h of history) { if (h.realizedPnL === null) continue; if (h.realizedPnL > 0) p += h.realizedPnL; else n += -h.realizedPnL; }
  return n > 0 ? p / n : null;
}
function maxDdOf(daily: readonly PaperDailyRecord[]): number | null {
  if (daily.length === 0) return null;
  return Math.abs(daily.reduce((m, d) => Math.min(m, d.drawdownPct), 0));
}
function meanOf(xs: readonly number[]): number | null { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

/** 纯函数：把新交易日的记录并入既有前向状态（幂等 —— 已处理的日期不会被重复追加）。 */
export function mergeForwardDays(input: {
  previous: PaperForwardState;
  newDaily: readonly PaperDailyRecord[];
  newHistory: readonly PaperExitRecord[];
  carriedPositions: readonly PaperPositionRecord[];
  latestDataDate: string;
  nextTradingDate: string | null;
  lastRunAt: string;
}): PaperForwardState {
  const { previous, newDaily, newHistory } = input;
  const processedDates = new Set(previous.forwardDaily.map((d) => d.tradeDate));
  const appended = newDaily.filter((d) => !processedDates.has(d.tradeDate));
  if (appended.length === 0) {
    return { ...previous, latestDataDate: input.latestDataDate, lastRunAt: input.lastRunAt, status: "WAITING_FOR_NEW_DATA", lastError: null };
  }
  const forwardDaily = [...previous.forwardDaily, ...appended];
  const existingHistoryKeys = new Set(previous.forwardHistory.map((h) => `${h.tradeDate}|${h.stock}|${h.exitPrice ?? ""}`));
  const appendedHistory = newHistory.filter((h) => !existingHistoryKeys.has(`${h.tradeDate}|${h.stock}|${h.exitPrice ?? ""}`));
  const forwardHistory = [...previous.forwardHistory, ...appendedHistory];
  const last = appended.at(-1)!;
  const first = forwardDaily[0]!;
  const peakEquity = forwardDaily.reduce((m, d) => Math.max(m, d.equity), previous.account.peakEquity);
  const newTrades = appended.reduce((s, d) => s + d.fills.filter((f) => f.side === "BUY").length, 0);
  const newSignals = appended.reduce((s, d) => s + d.signals.length, 0);
  const newRunnerCount = appendedHistory.filter((h) => h.usedRunner).length;
  const closed = forwardHistory.filter((h) => h.realizedPnL !== null);
  const wins = closed.filter((h) => (h.realizedPnL ?? 0) > 0).length;
  const holdings = closed.map((h) => h.holdingDays).filter((v): v is number => typeof v === "number");
  return {
    ...previous,
    latestDataDate: input.latestDataDate,
    lastProcessedTradingDate: last.tradeDate,
    nextTradingDate: input.nextTradingDate,
    status: "ADVANCED",
    lastRunAt: input.lastRunAt,
    lastError: null,
    account: {
      cash: last.cash, marketValue: last.marketValue, equity: last.equity, peakEquity,
      dailyReturnPct: last.dailyReturnPct,
      cumulativeReturnPct: (last.equity / previous.initialCapital - 1) * 100,
      drawdownPct: last.drawdownPct,
    },
    carriedPositions: input.carriedPositions,
    forwardDaily,
    forwardHistory,
    forwardStats: {
      newTradeCount: newTrades,
      newSignalCount: newSignals,
      newRunnerCount,
      forwardReturnPct: first.equity > 0 ? (last.equity / first.equity - 1) * 100 : null,
      forwardMaxDrawdownPct: maxDdOf(forwardDaily),
      forwardProfitFactor: pfOf(closed),
      forwardWinRatePct: closed.length ? (wins / closed.length) * 100 : null,
      forwardAverageHoldingDays: meanOf(holdings),
      runnerDirectContribution: forwardHistory.filter((h) => h.usedRunner).reduce((s, h) => s + (h.realizedPnL ?? 0), 0),
    },
  };
}

/** 建立初始前向状态（以历史回放为基线；不产生任何新交易日记录）。 */
export async function initForwardState(input: {
  baselineRunId: string; baselineLastProcessedDate: string; latestDataDate: string;
  strategyVersionId: number; provenanceId: number; holdoutRunId: string;
  /** 「历史回放」的账户快照 —— 前向账户必须**从这里继续**，不得重置为初始资金。 */
  baseline: {
    readonly initialCapital: number; readonly maxPositions: number; readonly singlePositionRatio: number;
    readonly account: { readonly cash: number; readonly marketValue: number; readonly equity: number; readonly cumulativeReturnPct: number; readonly currentDrawdownPct: number; readonly todayReturnPct: number | null };
    readonly openPositions: readonly PaperPositionRecord[];
  };
}): Promise<PaperForwardState> {
  const baseline = input.baseline;
  return {
    runId: PAPER_FORWARD_3570001_RUN_ID,
    task: "STRATEGY-3570001-LIVE-PAPER-TRADING-001",
    strategyVersionId: input.strategyVersionId,
    strategyId: PAPER_TRADING_3570001_STRATEGY_ID,
    strategyVersion: PAPER_TRADING_3570001_STRATEGY_VERSION,
    datasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID,
    runner: PAPER_TRADING_3570001_RUNNER,
    provenanceId: input.provenanceId, holdoutRunId: input.holdoutRunId,
    baselineRunId: input.baselineRunId, baselineLastProcessedDate: input.baselineLastProcessedDate,
    latestDataDate: input.latestDataDate,
    lastProcessedTradingDate: input.baselineLastProcessedDate,
    nextTradingDate: null,
    status: input.latestDataDate > input.baselineLastProcessedDate ? "ADVANCED" : "WAITING_FOR_NEW_DATA",
    lastRunAt: new Date().toISOString(), lastError: null,
    initialCapital: baseline.initialCapital, maxPositions: baseline.maxPositions, singlePositionRatio: baseline.singlePositionRatio,
    account: {
      cash: baseline.account.cash, marketValue: baseline.account.marketValue, equity: baseline.account.equity,
      peakEquity: baseline.account.equity, dailyReturnPct: baseline.account.todayReturnPct,
      cumulativeReturnPct: baseline.account.cumulativeReturnPct, drawdownPct: baseline.account.currentDrawdownPct,
    },
    carriedPositions: baseline.openPositions,
    forwardDaily: [], forwardHistory: [],
    forwardStats: { newTradeCount: 0, newSignalCount: 0, newRunnerCount: 0, forwardReturnPct: null, forwardMaxDrawdownPct: null, forwardProfitFactor: null, forwardWinRatePct: null, forwardAverageHoldingDays: null, runnerDirectContribution: 0 },
  };
}

/** 最新可用数据日（取数据集行内最大交易日；不猜、不造）。 */
export async function resolveLatestDataDate(): Promise<{ latestDataDate: string; tradingDates: string[] }> {
  const provider = createDefaultCompositeDatasetProvider();
  const surface = await provider.build({
    baselineDatasetVersionId: PAPER_TRADING_3570001_BASELINE_DATASET_VERSION_ID,
    extensionDatasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID,
    evaluationWindow: null,
  });
  // 🔴 只认**数据集声明的窗口**内的交易日。扩展投影里包含「事件相对日」的尾部行（日期可能晚于
  // 声明窗口末尾），那是事件窗口的尾巴、**不是新的市场数据**，绝不能当成新交易日。
  const declaredEnd = surface.executionDataset.dataSnapshot.request.endDate;
  const tradingDates = surface.executionDataset.universeDefinition.days
    .filter((d) => d.isTradingDay && d.tradeDate <= declaredEnd)
    .map((d) => d.tradeDate)
    .sort();
  const latest = tradingDates.at(-1);
  if (latest === undefined) throw new Error("resolveLatestDataDate: 数据集声明窗口内无交易日");
  return { latestDataDate: latest, tradingDates };
}

/**
 * 幂等推进一个「下一个可用交易日」。
 *
 * - 无新交易日 ⇒ `WAITING_FOR_NEW_DATA`，**不写入任何新记录**；
 * - 有新交易日 ⇒ 用正式 simulator 在新交易日区间上求值，把新日期记录并入前向状态；
 * - 单日失败 ⇒ 捕获并持久化 `status=ERROR` + `lastError`，**不破坏既有账户状态**。
 */
export async function advanceForwardOnce(previous: PaperForwardState): Promise<PaperForwardState> {
  const now = () => new Date().toISOString();
  try {
    const { latestDataDate, tradingDates } = await resolveLatestDataDate();
    const newDates = tradingDates.filter((d) => d > previous.lastProcessedTradingDate && d <= latestDataDate);
    if (newDates.length === 0) {
      return { ...previous, latestDataDate, nextTradingDate: null, status: "WAITING_FOR_NEW_DATA", lastRunAt: now(), lastError: null };
    }
    const from = newDates[0]!;
    const to = newDates.at(-1)!;
    const provider = createDefaultCompositeDatasetProvider();
    const surface = await provider.build({
      baselineDatasetVersionId: PAPER_TRADING_3570001_BASELINE_DATASET_VERSION_ID,
      extensionDatasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID,
      evaluationWindow: null,
    });
    const arm = buildFirstLimitPullback3FTop3SourceRun({ dataset: surface.baselineDataset, dateRange: surface.dateRange });
    const sourceRun = rebuildCompositeRun(arm.sourceRun, surface.executionDataset);
    const document = buildThreeFactorTopNStrategyDocument(buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", { topN: COMPOSITE_RUNNER_TOP_N, datasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID, datasetLabel: "v7" }));
    const { run } = await runCompositeRunnerBacktest({
      dataset: surface.executionDataset, sourceRun, strategyDocument: document,
      dateRange: { startDate: from, endDate: to },
      datasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID,
      codeVersion: "paper-3570001-forward", createdAt: THREE_FACTOR_TOPN_CREATED_AT,
      name: "paper-3570001-forward", runnerBridge: PAPER_TRADING_3570001_RUNNER,
    });
    const derived = derivePaperTradingDaily({ run, sourceRun, dataset: surface.executionDataset, startDate: from, endDate: to, strategyVersionId: previous.strategyVersionId });
    const nextTradingDate = tradingDates.find((d) => d > to) ?? null;
    return mergeForwardDays({ previous, newDaily: derived.daily, newHistory: derived.history, carriedPositions: derived.openPositions, latestDataDate, nextTradingDate, lastRunAt: now() });
  } catch (error) {
    return { ...previous, status: "ERROR", lastRunAt: now(), lastError: error instanceof Error ? error.message : String(error) };
  }
}


