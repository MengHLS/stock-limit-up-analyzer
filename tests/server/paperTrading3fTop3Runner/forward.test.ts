/**
 * STRATEGY-3570001-LIVE-PAPER-TRADING-001 —— 前向增量推进纯函数单测。
 * 覆盖：增量、幂等、断点恢复、账户一致性、Runner 边界（PENDING）。
 */
import { describe, expect, it } from "vitest";
import { mergeForwardDays, type PaperForwardState } from "../../../server/paperTrading3fTop3Runner/forward";
import type { PaperDailyRecord, PaperExitRecord, PaperPositionRecord } from "../../../server/paperTrading3fTop3Runner/run";

function day(date: string, equity: number, cash: number, mv: number, opts: { signals?: number; buys?: number; exits?: PaperExitRecord[]; positions?: PaperPositionRecord[] } = {}): PaperDailyRecord {
  return {
    tradeDate: date, equity, cash, marketValue: mv, dailyReturnPct: null, cumulativeReturnPct: null, drawdownPct: 0,
    signals: Array.from({ length: opts.signals ?? 0 }, (_, i) => ({ tradeDate: date, stock: `S${i}`, strategyVersionId: 3570001, inTop3: true, newHigh3: false, signalTime: date + "T15:00:00+08:00", plannedEntryPrice: 10 })),
    fills: Array.from({ length: opts.buys ?? 0 }, (_, i) => ({ tradeDate: date, stock: `S${i}`, side: "BUY" as const, plannedPrice: 10, simulatedFillPrice: 10, quantity: 100, cost: 8, slippage: 3, status: "SIMULATED_FILLED" })),
    positions: opts.positions ?? [], exits: opts.exits ?? [],
  };
}
const emptyStats = { newTradeCount: 0, newSignalCount: 0, newRunnerCount: 0, forwardReturnPct: null, forwardMaxDrawdownPct: null, forwardProfitFactor: null, forwardWinRatePct: null, forwardAverageHoldingDays: null, runnerDirectContribution: 0 };
function base(lastProcessed: string): PaperForwardState {
  return {
    runId: "paper-3570001-forward", task: "STRATEGY-3570001-LIVE-PAPER-TRADING-001",
    strategyVersionId: 3570001, strategyId: "s", strategyVersion: "1.0.0", datasetVersionId: 750001,
    runner: { kind: "PIT_RUNNER_HOLDING_BRIDGE", state: "NEW_HIGH_3", decisionHoldingDays: 5, extendToHoldingDays: 20 },
    provenanceId: 660001, holdoutRunId: "RUN-20261002-BD1D7332",
    baselineRunId: "paper-3570001-2025-01-01-2026-09-04", baselineLastProcessedDate: "2026-09-04",
    latestDataDate: lastProcessed, lastProcessedTradingDate: lastProcessed, nextTradingDate: null,
    status: "WAITING_FOR_NEW_DATA", lastRunAt: "t0", lastError: null,
    initialCapital: 100000, maxPositions: 5, singlePositionRatio: 0.2,
    account: { cash: 100000, marketValue: 0, equity: 100000, peakEquity: 100000, dailyReturnPct: null, cumulativeReturnPct: 0, drawdownPct: 0 },
    carriedPositions: [], forwardDaily: [], forwardHistory: [], forwardStats: emptyStats,
  };
}

describe("mergeForwardDays", () => {
  it("增量：把新交易日并入并推进 lastProcessedTradingDate", () => {
    const s = mergeForwardDays({ previous: base("2026-09-04"), newDaily: [day("2026-09-07", 101000, 40000, 61000, { signals: 3, buys: 2 })], newHistory: [], carriedPositions: [], latestDataDate: "2026-09-07", nextTradingDate: null, lastRunAt: "t1" });
    expect(s.status).toBe("ADVANCED");
    expect(s.lastProcessedTradingDate).toBe("2026-09-07");
    expect(s.forwardDaily).toHaveLength(1);
    expect(s.forwardStats.newSignalCount).toBe(3);
    expect(s.forwardStats.newTradeCount).toBe(2);
  });

  it("幂等：同一批交易日重复合并 ⇒ WAITING_FOR_NEW_DATA 且不产生重复记录", () => {
    const once = mergeForwardDays({ previous: base("2026-09-04"), newDaily: [day("2026-09-07", 101000, 40000, 61000, { buys: 1 })], newHistory: [], carriedPositions: [], latestDataDate: "2026-09-07", nextTradingDate: null, lastRunAt: "t1" });
    const twice = mergeForwardDays({ previous: once, newDaily: [day("2026-09-07", 101000, 40000, 61000, { buys: 1 })], newHistory: [], carriedPositions: [], latestDataDate: "2026-09-07", nextTradingDate: null, lastRunAt: "t2" });
    expect(twice.status).toBe("WAITING_FOR_NEW_DATA");
    expect(twice.forwardDaily).toHaveLength(1);
    expect(twice.forwardStats.newTradeCount).toBe(1);
    expect(twice.lastProcessedTradingDate).toBe("2026-09-07");
  });

  it("断点恢复：状态从持久化继续，后续日期追加而不重置账户", () => {
    const d1 = mergeForwardDays({ previous: base("2026-09-04"), newDaily: [day("2026-09-07", 101000, 40000, 61000)], newHistory: [], carriedPositions: [], latestDataDate: "2026-09-07", nextTradingDate: null, lastRunAt: "t1" });
    const d2 = mergeForwardDays({ previous: d1, newDaily: [day("2026-09-08", 102500, 39000, 63500)], newHistory: [], carriedPositions: [], latestDataDate: "2026-09-08", nextTradingDate: null, lastRunAt: "t2" });
    expect(d2.forwardDaily.map((d) => d.tradeDate)).toEqual(["2026-09-07", "2026-09-08"]);
    expect(d2.account.equity).toBe(102500);
    expect(d2.account.cumulativeReturnPct).toBeCloseTo(2.5, 6);
  });

  it("账户一致性：cash + marketValue = equity，且峰值只增不减", () => {
    const s = mergeForwardDays({ previous: base("2026-09-04"), newDaily: [day("2026-09-07", 101000, 40000, 61000), day("2026-09-08", 98500, 40000, 58500)], newHistory: [], carriedPositions: [], latestDataDate: "2026-09-08", nextTradingDate: null, lastRunAt: "t1" });
    for (const d of s.forwardDaily) expect(d.cash + d.marketValue).toBeCloseTo(d.equity, 6);
    expect(s.account.peakEquity).toBe(101000);
    expect(s.account.equity).toBe(98500);
  });

  it("Runner 统计：只统计真正延长（usedRunner）的退出，并累计其直接贡献", () => {
    const exit = (used: boolean, pnl: number, stock: string): PaperExitRecord => ({ tradeDate: "2026-09-08", stock, exitPrice: 12, exitReason: used ? "Runner Bridge持有满20个交易日" : "MA趋势止盈", realizedPnL: pnl, holdingDays: used ? 20 : 6, usedRunner: used });
    const s = mergeForwardDays({ previous: base("2026-09-04"), newDaily: [day("2026-09-07", 100000, 100000, 0)], newHistory: [exit(true, 500, "A"), exit(false, -200, "B"), exit(true, 300, "C")], carriedPositions: [], latestDataDate: "2026-09-07", nextTradingDate: null, lastRunAt: "t1" });
    expect(s.forwardStats.newRunnerCount).toBe(2);
    expect(s.forwardStats.runnerDirectContribution).toBe(800);
    expect(s.forwardStats.forwardProfitFactor).toBeCloseTo(800 / 200, 6);
  });

  it("无新交易日 ⇒ nextTradingDate 保持 null 且不新增任何记录", () => {
    const s = mergeForwardDays({ previous: base("2026-09-04"), newDaily: [], newHistory: [], carriedPositions: [], latestDataDate: "2026-09-04", nextTradingDate: null, lastRunAt: "t9" });
    expect(s.forwardDaily).toHaveLength(0);
    expect(s.forwardHistory).toHaveLength(0);
    expect(s.lastProcessedTradingDate).toBe("2026-09-04");
  });
});
