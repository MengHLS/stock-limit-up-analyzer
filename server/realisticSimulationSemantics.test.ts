/**
 * STEP 5 P2-1 —— realisticSimulation 回测结果语义回归测试。
 *
 * 生产 realisticSimulation 由 Strategy Engine 产出：
 *   T 收盘信号 → T+1 开盘买入 → Risk 准入 → 持有 → 回测期末按市价估值。
 * leader-candidate-baseline 为 long-only、不产生 SELL，因此 completedCount 通常为 0。
 *
 * 本测试锁定语义约定（不因后续重构漂移）：
 *   1. completedCount = 0      → winRate = null（绝不为 0%）、winningTrades = 0；
 *   2. openPositionCount > 0   → 未平仓持仓不被计为失败交易（winningTrades/losingTrades 都不含它）；
 *   3. totalReturn / maxDrawdown / equityCurve / trades 仍然保持 Engine 语义（与引擎原始结果一致）；
 *   4. 同一 Data / Config / asOf 重复执行结果完全一致（Determinism）。
 */

import { describe, expect, it } from "vitest";
import type { RawDailyPriceRow } from "./data";
import { runLeaderCandidateEngineProbe } from "./leaderCandidateStrategyBacktest";
import type { LeaderCandidateBacktestContext, LeaderCandidateBacktestOptions } from "./leaderCandidates";

const D0 = "2026-01-05";
const D1 = "2026-01-06";
const D2 = "2026-01-07";
const D3 = "2026-01-08";
const CALENDAR = [D0, D1, D2, D3];

const A = "600001.SH"; // D1 价格库确认涨停 → 被纳入
const B = "600002.SH"; // D1 未确认
const C = "600003.SH"; // D1 未确认

function sourceRecords() {
  return [
    { stockCode: A, stockName: "中科蓝海", limitUpDate: D1, limitUpTime: "09:31:00", sector: "半导体", turnover: "12", circulationValue: "80" },
    { stockCode: B, stockName: "东方华电", limitUpDate: D1, limitUpTime: "09:45:00", sector: "半导体", turnover: "12", circulationValue: "80" },
    { stockCode: C, stockName: "天启智能", limitUpDate: D1, limitUpTime: "10:20:00", sector: "半导体", turnover: "12", circulationValue: "80" },
  ];
}

function bar(stockCode: string, tradeDate: string, open: number, close: number, preClose: number): RawDailyPriceRow {
  return {
    stockCode,
    tradeDate,
    openPrice: String(open),
    closePrice: String(close),
    highPrice: String(Math.max(open, close) + 0.1),
    lowPrice: String(Math.min(open, close) - 0.1),
    preClosePrice: String(preClose),
    volume: "150000",
    amount: "88000",
  };
}

/** A 在 D1 收盘涨停（10.00 → 11.00）；B/C 未确认。 */
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

function contextOf(): LeaderCandidateBacktestContext {
  const priceByStockDate = new Map<string, { openPrice: number | null; closePrice: number | null }>();
  for (const row of priceRows()) {
    priceByStockDate.set(`${row.stockCode}::${row.tradeDate}`, {
      openPrice: Number(row.openPrice),
      closePrice: Number(row.closePrice),
    });
  }
  return { tradingDates: CALENDAR, priceByStockDate };
}

const baseOptions: LeaderCandidateBacktestOptions = {
  realistic: {
    initialCapital: 100_000,
    maxPositions: 5,
    commissionRate: 0.0003,
    stampDutyRate: 0.0005,
    transferFeeRate: 0.00001,
    slippageBps: 10,
    lotSize: 100,
  },
};

function run() {
  return runLeaderCandidateEngineProbe(sourceRecords(), priceRows(), contextOf(), baseOptions);
}

describe("P2-1 生产 realisticSimulation 语义（long-only buy-and-hold）", () => {
  it("T 信号 → T+1 开盘成交 → 期末持仓：completedCount = 0 且 openPositionCount > 0", () => {
    const { realisticSimulation: sim } = run();
    expect(sim.trades).toHaveLength(1);
    expect(sim.trades[0]).toMatchObject({ stockCode: A, signalDate: D1, entryDate: D2, status: "filled" });
    // long-only、无 SELL → 回测期末仍持有，没有平仓事件。
    expect(sim.completedCount).toBe(0);
    expect(sim.openPositionCount).toBe(1);
    expect(sim.filledCount).toBe(1);
  });

  it("completedCount = 0 → winRate = null（不是 0），winningTrades = 0", () => {
    const { realisticSimulation: sim } = run();
    expect(sim.completedCount).toBe(0);
    expect(sim.winRate).toBeNull();
    expect(sim.winRate).not.toBe(0);
    expect(sim.winningTrades).toBe(0);
    // 平均收益基于已平仓交易，无已平仓交易时为 null（引擎 adapter 保持 null）。
    expect(sim.averageReturn).toBeNull();
  });

  it("openPositionCount > 0 的未平仓持仓不被计为失败交易", () => {
    const { realisticSimulation: sim, probe } = run();
    expect(sim.openPositionCount).toBeGreaterThan(0);
    // 引擎侧：所有成交均为 openAtEnd，closed 集合为空 → 不存在「失败交易」计数。
    const closedTrades = probe.result.trades.filter((trade) => !trade.openAtEnd && trade.netPnl !== null);
    expect(closedTrades).toHaveLength(0);
    expect(sim.trades.every((trade) => trade.exitDate === null && trade.netPnl === null)).toBe(true);
    // 未平仓持仓仍贡献权益：期末权益应偏离初始资金（按期末市价估值）。
    expect(sim.finalCapital).not.toBe(sim.initialCapital);
  });

  it("totalReturn / maxDrawdown / equityCurve / trades 保持 Engine 语义", () => {
    const { realisticSimulation: sim, probe } = run();
    const perf = probe.result.performance;
    expect(sim.totalReturn).toBe(Number(perf.totalReturnPct.toFixed(2)));
    expect(sim.maxDrawdown).toBe(Number(perf.maxDrawdownPct.toFixed(2)));
    expect(sim.finalCapital).toBe(Number(probe.result.finalPortfolio.equity.toFixed(2)));
    expect(sim.equityCurve).toHaveLength(probe.result.equityCurve.length);
    expect(sim.equityCurve.map((point) => point.date)).toEqual(probe.result.equityCurve.map((point) => point.timestamp));
    expect(sim.equityCurve.map((point) => point.equity)).toEqual(probe.result.equityCurve.map((point) => Number(point.equity.toFixed(2))));
    expect(sim.trades).toHaveLength(probe.result.trades.length);
    expect(sim.trades.map((trade) => trade.stockCode)).toEqual(probe.result.trades.map((trade) => trade.symbol));
    // tradeCount / filledCount 只统计成交，openPositionCount 统计期末持仓。
    expect(sim.tradeCount).toBe(probe.result.trades.length);
    expect(sim.filledCount).toBe(probe.result.trades.length);
    expect(sim.openPositionCount).toBe(probe.result.finalPortfolio.positions.length);
  });

  it("Determinism：同一 Data/Config/asOf 重复执行语义字段完全一致", () => {
    const first = run().realisticSimulation;
    for (let index = 0; index < 20; index += 1) {
      const again = run().realisticSimulation;
      expect({
        completedCount: again.completedCount,
        openPositionCount: again.openPositionCount,
        winRate: again.winRate,
        winningTrades: again.winningTrades,
        totalReturn: again.totalReturn,
        maxDrawdown: again.maxDrawdown,
        equityCurve: again.equityCurve,
        trades: again.trades,
      }).toEqual({
        completedCount: first.completedCount,
        openPositionCount: first.openPositionCount,
        winRate: first.winRate,
        winningTrades: first.winningTrades,
        totalReturn: first.totalReturn,
        maxDrawdown: first.maxDrawdown,
        equityCurve: first.equityCurve,
        trades: first.trades,
      });
    }
  });
});
