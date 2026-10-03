/**
 * STRATEGY-3570001-PAPER-TRADING-001 —— `3570001` 的每日模拟盘闭环。
 *
 * ## 纪律（为什么不是「第二套策略引擎」）
 *
 * 本模块**不实现任何选股 / 退出 / Runner 逻辑**：
 *   - 选股与 sourceRun ← `buildFirstLimitPullback3FTop3SourceRun`（唯一实现）
 *   - 组合执行 / 资金循环 / T+6 开盘 / 止损 / MA5-MA10 / strongHold / Runner ←
 *     `runCompositeRunnerBacktest`（内部唯一调用 `runTradeSimulation`）
 *   - NEW_HIGH_3 判定 ← 模拟器**同一函数** `evaluateRunnerHoldingBridgeState`（本任务仅将其导出）
 * 本模块只做一件事：把**同一次正式模拟**的结果按交易日**投影**成每日模拟盘记录
 * （signals / orders-fills / positions / exits / account），因此与历史评估口径逐字段一致。
 *
 * 投影而非逐日重跑：逐日重跑会在每一天重放一次完整模拟（O(交易日) 次），既昂贵又没有任何
 * 语义增量 —— 正式模拟本身已经是「只用 ≤ 该日信息」的逐日推进。
 */

import {
  buildFirstLimitPullback3FTop3SourceRun,
  rebuildCompositeRun,
  runCompositeRunnerBacktest,
  COMPOSITE_RUNNER_TOP_N,
} from "../research/compositeRunner/index";
import { buildThreeFactorTopNStrategyDocument, THREE_FACTOR_TOPN_CREATED_AT } from "../research/patternLibrary/threeFactorTopNStrategy";
import { buildThreeFactorTopNFamilyArmInput } from "../research/patternLibrary/threeFactorTopNFamilies";
import { evaluateRunnerHoldingBridgeState } from "../research/simulator/engine";
import { createDefaultCompositeDatasetProvider } from "../researchExperiments/compositeDatasetProvider";
import type { ResearchDataset } from "../researchDataset/types";
import type { CandidateEvaluationRun } from "../research/signalEngine/types";
import type { TradeSimulationRun } from "../research/simulator/types";
import type { Trade } from "../backtest/types";

export const PAPER_TRADING_3570001_EXPERIMENT_ID = "STRATEGY-3570001-PAPER-TRADING-001";
export const PAPER_TRADING_3570001_STRATEGY_ID = "first-limit-pullback-3f-top3-runner-hold20";
export const PAPER_TRADING_3570001_STRATEGY_VERSION = "1.0.0";
export const PAPER_TRADING_3570001_DATASET_VERSION_ID = 750001;
export const PAPER_TRADING_3570001_BASELINE_DATASET_VERSION_ID = 660001;
export const PAPER_TRADING_3570001_RUNNER = Object.freeze({
  kind: "PIT_RUNNER_HOLDING_BRIDGE" as const,
  state: "NEW_HIGH_3" as const,
  decisionHoldingDays: 5 as const,
  extendToHoldingDays: 20,
});

export interface PaperSignalRecord {
  readonly tradeDate: string; readonly stock: string; readonly strategyVersionId: number;
  readonly inTop3: boolean; readonly newHigh3: boolean; readonly signalTime: string;
  readonly plannedEntryPrice: number | null;
}
export interface PaperFillRecord {
  readonly tradeDate: string; readonly stock: string; readonly side: "BUY" | "SELL";
  readonly plannedPrice: number | null; readonly simulatedFillPrice: number | null;
  readonly quantity: number; readonly cost: number; readonly slippage: number; readonly status: string;
}
export interface PaperPositionRecord {
  readonly tradeDate: string; readonly stock: string; readonly entryDate: string;
  readonly entryPrice: number; readonly currentPrice: number | null;
  readonly holdingDays: number; readonly runnerState: "PENDING" | "EXTENDED" | "NOT_TRIGGERED";
  readonly peakPrice: number | null; readonly unrealizedPnL: number | null; readonly exitCondition: string | null;
}
export interface PaperExitRecord {
  readonly tradeDate: string; readonly stock: string; readonly exitPrice: number | null;
  readonly exitReason: string; readonly realizedPnL: number | null;
  readonly holdingDays: number | null; readonly usedRunner: boolean;
}
export interface PaperDailyRecord {
  readonly tradeDate: string; readonly equity: number; readonly cash: number; readonly marketValue: number;
  readonly dailyReturnPct: number | null; readonly cumulativeReturnPct: number | null; readonly drawdownPct: number;
  readonly signals: readonly PaperSignalRecord[]; readonly fills: readonly PaperFillRecord[];
  readonly positions: readonly PaperPositionRecord[]; readonly exits: readonly PaperExitRecord[];
}
export interface PaperTrading3570001State {
  readonly task: typeof PAPER_TRADING_3570001_EXPERIMENT_ID;
  readonly strategyVersionId: number; readonly strategyId: string; readonly strategyVersion: string;
  readonly datasetVersionId: number; readonly runner: typeof PAPER_TRADING_3570001_RUNNER;
  readonly window: { readonly startDate: string; readonly endDate: string };
  readonly provenanceId: number; readonly holdoutRunId: string;
  readonly initialCapital: number; readonly maxPositions: number; readonly singlePositionRatio: number;
  readonly daily: readonly PaperDailyRecord[];
  readonly account: {
    readonly equity: number; readonly cash: number; readonly marketValue: number;
    readonly cumulativeReturnPct: number; readonly maxDrawdownPct: number; readonly currentDrawdownPct: number;
    readonly todayReturnPct: number | null;
  };
  readonly openPositions: readonly PaperPositionRecord[];
  readonly history: readonly (PaperExitRecord & { readonly stock: string })[];
  readonly lastRunAt: string; readonly runStatus: "COMPLETED"; readonly dataIssue: string | null;
}

function keyOf(t: { securityId: string; entryTime: string }): string { return t.securityId + "|" + t.entryTime; }
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 纯投影：把一次正式模拟结果按交易日展开为每日模拟盘记录（可单测，无 IO）。 */
export function derivePaperTradingDaily(input: {
  run: TradeSimulationRun;
  sourceRun: CandidateEvaluationRun;
  dataset: ResearchDataset;
  startDate: string;
  endDate: string;
  strategyVersionId: number;
}): { daily: readonly PaperDailyRecord[]; openPositions: readonly PaperPositionRecord[]; history: readonly PaperExitRecord[] } {
  const { run, sourceRun, dataset } = input;
  const barsBySecurity = new Map<string, { tradeDate: string; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }[]>();
  for (const row of dataset.rows) {
    const list = barsBySecurity.get(row.securityId) ?? [];
    list.push({ tradeDate: row.tradeDate, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume });
    barsBySecurity.set(row.securityId, list);
  }
  for (const list of barsBySecurity.values()) list.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const trades = run.trades as unknown as Trade[];
  const tradingDates = run.equityCurve.map((p) => p.date).filter((d) => d >= input.startDate && d <= input.endDate);
  const indexOfDate = new Map(tradingDates.map((d, i) => [d, i]));

  // 每笔持仓的 Runner 判定日（第 5 个持有日收盘）与结果
  // 每笔持仓的 Runner 判定日与结果（**不含判**：判定日之前的日期一律显示 PENDING，杜绝未来信息）
  const runnerOutcomeByTrade = new Map<string, { decideDate: string; extended: boolean }>();
  const peakByTrade = new Map<string, number>();
  for (const t of trades) {
    const bars = barsBySecurity.get(t.securityId) ?? [];
    const entryIdx = bars.findIndex((b) => b.tradeDate === t.entryTime);
    if (entryIdx >= 0) {
      const decideIdx = entryIdx + 5;
      const decideBar = bars[decideIdx];
      if (decideBar !== undefined) {
        runnerOutcomeByTrade.set(keyOf(t), {
          decideDate: decideBar.tradeDate,
          extended: evaluateRunnerHoldingBridgeState(
            bars.map((b) => ({ symbol: t.securityId, timestamp: b.tradeDate, open: b.open, high: b.high, low: b.low, close: b.close, preClose: null, volume: b.volume, amount: null, turnoverRate: null, adjustment: "raw" })) as never,
            t.entryTime, decideBar.tradeDate, "NEW_HIGH_3",
          ),
        });
      }
      const window = bars.filter((b) => b.tradeDate >= t.entryTime && (t.exitTime === null || b.tradeDate <= t.exitTime));
      const highs = window.map((b) => b.high).filter(finite);
      peakByTrade.set(keyOf(t), highs.length ? Math.max(...highs) : t.entryPrice);
    }
  }

  const exitsByDate = new Map<string, PaperExitRecord[]>();
  const fillsByDate = new Map<string, PaperFillRecord[]>();
  for (const t of trades) {
    const totalCost = t.fees + t.slippageAmount;
    const buy = fillsByDate.get(t.entryTime) ?? [];
    buy.push({ tradeDate: t.entryTime, stock: t.securityId, side: "BUY", plannedPrice: t.entryPrice, simulatedFillPrice: t.entryPrice, quantity: t.quantity, cost: totalCost, slippage: t.slippageAmount, status: "SIMULATED_FILLED" });
    fillsByDate.set(t.entryTime, buy);
    if (t.exitTime !== null && t.openAtEnd !== true) {
      const sell = fillsByDate.get(t.exitTime) ?? [];
      sell.push({ tradeDate: t.exitTime, stock: t.securityId, side: "SELL", plannedPrice: t.exitPrice, simulatedFillPrice: t.exitPrice, quantity: t.quantity, cost: totalCost, slippage: t.slippageAmount, status: "SIMULATED_FILLED" });
      fillsByDate.set(t.exitTime, sell);
      const list = exitsByDate.get(t.exitTime) ?? [];
      list.push({ tradeDate: t.exitTime, stock: t.securityId, exitPrice: t.exitPrice, exitReason: t.reason ?? "UNKNOWN", realizedPnL: t.netPnl, holdingDays: t.holdingPeriod, usedRunner: runnerOutcomeByTrade.get(keyOf(t))?.extended === true });
      exitsByDate.set(t.exitTime, list);
    }
  }

  const signalsByDate = new Map<string, PaperSignalRecord[]>();
  for (const day of sourceRun.days) {
    if (day.date < input.startDate || day.date > input.endDate) continue;
    const barsDateIdx = indexOfDate.get(day.date);
    const nextDate = barsDateIdx === undefined ? undefined : tradingDates[barsDateIdx + 1];
    signalsByDate.set(day.date, day.positionIntents.map((intent) => {
      const bars = barsBySecurity.get(intent.securityId) ?? [];
      const nextBar = nextDate === undefined ? undefined : bars.find((b) => b.tradeDate === nextDate);
      return { tradeDate: day.date, stock: intent.securityId, strategyVersionId: input.strategyVersionId, inTop3: true, newHigh3: false, signalTime: day.date + "T15:00:00+08:00", plannedEntryPrice: nextBar?.open ?? null };
    }));
  }

  const initial = run.initialCapital;
  let peak = initial;
  const daily: PaperDailyRecord[] = [];
  let prevEquity: number | null = null;
  for (const point of run.equityCurve) {
    if (point.date < input.startDate || point.date > input.endDate) continue;
    peak = Math.max(peak, point.equity);
    const openTrades = trades.filter((t) => t.entryTime <= point.date && (t.openAtEnd === true || t.exitTime === null || t.exitTime > point.date));
    const positions: PaperPositionRecord[] = openTrades.map((t) => {
      const bars = barsBySecurity.get(t.securityId) ?? [];
      const bar = [...bars].reverse().find((b) => b.tradeDate <= point.date);
      const current = bar?.close ?? null;
      const holdingDays = indexOfDate.has(t.entryTime) && indexOfDate.has(point.date)
        ? (indexOfDate.get(point.date)! - indexOfDate.get(t.entryTime)!) : 0;
      return {
        tradeDate: point.date, stock: t.securityId, entryDate: t.entryTime, entryPrice: t.entryPrice,
        currentPrice: current, holdingDays: Math.max(0, holdingDays),
        runnerState: (() => { const ro = runnerOutcomeByTrade.get(keyOf(t)); return ro === undefined ? "PENDING" as const : (point.date < ro.decideDate ? "PENDING" as const : (ro.extended ? "EXTENDED" as const : "NOT_TRIGGERED" as const)); })(), peakPrice: peakByTrade.get(keyOf(t)) ?? null,
        unrealizedPnL: current === null ? null : (current - t.entryPrice) * t.quantity, exitCondition: null,
      };
    });
    daily.push({
      tradeDate: point.date, equity: point.equity, cash: point.cash, marketValue: point.marketValue,
      dailyReturnPct: prevEquity === null || prevEquity === 0 ? null : (point.equity / prevEquity - 1) * 100,
      cumulativeReturnPct: (point.equity / initial - 1) * 100,
      drawdownPct: peak > 0 ? (point.equity / peak - 1) * 100 : 0,
      signals: signalsByDate.get(point.date) ?? [], fills: fillsByDate.get(point.date) ?? [],
      positions, exits: exitsByDate.get(point.date) ?? [],
    });
    prevEquity = point.equity;
  }

  const last = daily.at(-1);
  const openPositions = last?.positions ?? [];
  const history = trades.filter((t) => t.exitTime !== null && t.openAtEnd !== true).map((t) => ({
    tradeDate: t.exitTime!, stock: t.securityId, exitPrice: t.exitPrice, exitReason: t.reason ?? "UNKNOWN",
    realizedPnL: t.netPnl, holdingDays: t.holdingPeriod,
    usedRunner: runnerOutcomeByTrade.get(keyOf(t))?.extended === true,
  }));
  return { daily, openPositions, history };
}

/** 真实执行一次模拟盘投影（复用唯一 simulator）。 */
export async function buildPaperTrading3570001State(input: {
  startDate: string; endDate: string; strategyVersionId: number; provenanceId: number; holdoutRunId: string;
}): Promise<PaperTrading3570001State> {
  const provider = createDefaultCompositeDatasetProvider();
  const surface = await provider.build({
    baselineDatasetVersionId: PAPER_TRADING_3570001_BASELINE_DATASET_VERSION_ID,
    extensionDatasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID,
    evaluationWindow: null,
  });
  const arm = buildFirstLimitPullback3FTop3SourceRun({ dataset: surface.baselineDataset, dateRange: surface.dateRange });
  const sourceRun = rebuildCompositeRun(arm.sourceRun, surface.executionDataset);
  const document = buildThreeFactorTopNStrategyDocument(
    buildThreeFactorTopNFamilyArmInput("c6-b4-14-best-combination", "c6b4-14", {
      topN: COMPOSITE_RUNNER_TOP_N, datasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID, datasetLabel: "v7",
    }),
  );
  const { run } = await runCompositeRunnerBacktest({
    dataset: surface.executionDataset, sourceRun, strategyDocument: document,
    dateRange: { startDate: input.startDate, endDate: surface.dateRange.endDate },
    datasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID,
    codeVersion: PAPER_TRADING_3570001_EXPERIMENT_ID, createdAt: THREE_FACTOR_TOPN_CREATED_AT,
    name: "paper-trading-3570001", runnerBridge: PAPER_TRADING_3570001_RUNNER,
  });
  const derived = derivePaperTradingDaily({ run, sourceRun, dataset: surface.executionDataset, startDate: input.startDate, endDate: input.endDate, strategyVersionId: input.strategyVersionId });
  const last = derived.daily.at(-1);
  const peak = derived.daily.reduce((m, d) => Math.max(m, d.equity), run.initialCapital);
  return {
    task: PAPER_TRADING_3570001_EXPERIMENT_ID,
    strategyVersionId: input.strategyVersionId,
    strategyId: PAPER_TRADING_3570001_STRATEGY_ID,
    strategyVersion: PAPER_TRADING_3570001_STRATEGY_VERSION,
    datasetVersionId: PAPER_TRADING_3570001_DATASET_VERSION_ID,
    runner: PAPER_TRADING_3570001_RUNNER,
    window: { startDate: input.startDate, endDate: input.endDate },
    provenanceId: input.provenanceId, holdoutRunId: input.holdoutRunId,
    initialCapital: run.initialCapital, maxPositions: 5, singlePositionRatio: 0.2,
    daily: derived.daily,
    account: {
      equity: last?.equity ?? run.initialCapital, cash: last?.cash ?? run.initialCapital,
      marketValue: last?.marketValue ?? 0,
      cumulativeReturnPct: last?.cumulativeReturnPct ?? 0,
      maxDrawdownPct: Math.abs(derived.daily.reduce((m, d) => Math.min(m, d.drawdownPct), 0)),
      currentDrawdownPct: last?.drawdownPct ?? 0,
      todayReturnPct: last?.dailyReturnPct ?? null,
    },
    openPositions: derived.openPositions, history: derived.history,
    lastRunAt: new Date().toISOString(), runStatus: "COMPLETED",
    dataIssue: derived.daily.length === 0 ? "窗口内无交易日数据" : null,
  };
}





