/**
 * STRATEGY-3570001-PAPER-TRADING-001 —— 每日投影纯函数单测。
 *
 * 覆盖闭环链路：历史行情 → signal → order/fill → position → runner → exit → account equity。
 * 用**合成输入**（非伪造结果）：断言的是投影口径，不是收益数字。
 */
import { describe, expect, it } from "vitest";
import { derivePaperTradingDaily } from "../../../server/paperTrading3fTop3Runner/run";

const SEC = "sec_test::event:000001.SZ@2025-01-02";
function bar(date: string, close: number) {
  return { tradeDate: date, open: close, high: close + 1, low: close - 1, close, volume: 1000, amount: 1000, eligible: true, securityId: SEC };
}
const dates = ["2025-01-02","2025-01-03","2025-01-06","2025-01-07","2025-01-08","2025-01-09","2025-01-10","2025-01-13","2025-01-14"];
const dataset = {
  datasetVersion: "test", universeDefinition: { days: dates.map((d) => ({ tradeDate: d, isTradingDay: true, members: [SEC], excludedByReason: {} })) },
  policySet: {}, dataSnapshot: {}, gate: "PASS", gateNotes: [],
  rows: dates.map((d, i) => bar(d, 10 + i)),
} as never;
const run = {
  initialCapital: 100000, finalEquity: 110000, dateRange: { startDate: dates[0], endDate: dates.at(-1) },
  equityCurve: dates.map((d, i) => ({ date: d, equity: 100000 + i * 1250, cash: 50000, marketValue: 50000 + i * 1250, openPositions: 1 })),
  trades: [
    { securityId: SEC, entryTime: "2025-01-03", entryPrice: 10, exitTime: "2025-01-10", exitPrice: 20, quantity: 100, fees: 5, slippageAmount: 3, netPnl: 990, returnPct: 9.9, holdingPeriod: 5, openAtEnd: false, reason: "MA趋势止盈" },
    { securityId: SEC + "b", entryTime: "2025-01-07", entryPrice: 12, exitTime: "2025-01-14", exitPrice: 13, quantity: 100, fees: 5, slippageAmount: 3, netPnl: null, returnPct: null, holdingPeriod: null, openAtEnd: true, reason: "回测结束仍持仓" },
  ],
} as never;
const sourceRun = { days: [{ date: "2025-01-02", positionIntents: [{ securityId: SEC, rank: 1, percentile: 1, weight: 1, signalValue: 0.9, direction: "long", confidence: null }] }] } as never;

describe("derivePaperTradingDaily", () => {
  const out = derivePaperTradingDaily({ run, sourceRun, dataset, startDate: dates[0], endDate: dates.at(-1)!, strategyVersionId: 3570001 });

  it("signal 落在 T+5 收盘、计划入场价取次一交易日开盘", () => {
    const s = out.daily[0]!.signals[0]!;
    expect(s.tradeDate).toBe("2025-01-02");
    expect(s.strategyVersionId).toBe(3570001);
    expect(s.inTop3).toBe(true);
    expect(s.plannedEntryPrice).toBe(11); // 2025-01-03 的 open
    expect(s.signalTime).toContain("15:00:00");
  });

  it("order/fill：买入落在 entryTime，卖出落在 exitTime 且带成本/滑点", () => {
    const fill = out.daily.find((d) => d.tradeDate === "2025-01-03")!.fills[0]!;
    expect(fill.side).toBe("BUY");
    expect(fill.status).toBe("SIMULATED_FILLED");
    expect(fill.cost).toBe(8);
    const sell = out.daily.find((d) => d.tradeDate === "2025-01-10")!.fills.find((f) => f.side === "SELL")!;
    expect(sell.simulatedFillPrice).toBe(20);
  });

  it("position：持仓在窗口内逐日出现，且 runnerState 由同一判定函数给出", () => {
    const held = out.daily.find((d) => d.tradeDate === "2025-01-08")!;
    const first = held.positions.find((p) => p.entryDate === "2025-01-03");
    expect(first).toBeDefined();
    expect(["PENDING", "EXTENDED", "NOT_TRIGGERED"]).toContain(first!.runnerState);
  });

  it("exit：真实退出进入 exits 与 history；期末未平仓**不**被当成退出", () => {
    const exitDay = out.daily.find((d) => d.tradeDate === "2025-01-10")!;
    expect(exitDay.exits.length).toBe(1);
    expect(exitDay.exits[0]!.exitReason).toBe("MA趋势止盈");
    expect(out.history.some((h) => h.exitReason === "回测结束仍持仓")).toBe(false);
    const last = out.daily.at(-1)!;
    expect(last.positions.some((p) => p.entryDate === "2025-01-07")).toBe(true);
  });

  it("account equity：逐日 equity / 累计收益 / 回撤来自同一权益曲线", () => {
    expect(out.daily[0]!.equity).toBe(100000);
    expect(out.daily[0]!.cumulativeReturnPct).toBe(0);
    expect(out.daily.at(-1)!.cumulativeReturnPct).toBeCloseTo(10, 6);
    expect(out.daily[0]!.drawdownPct).toBe(0);
  });
});
