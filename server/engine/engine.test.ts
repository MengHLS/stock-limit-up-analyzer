/**
 * Backtest Core — 测试套件。
 *
 * 覆盖：领域模型、成本模型、成交模型、组合引擎、绩效分析、回测引擎，
 * 以及任务要求的 24 类场景 + 人工计算 Golden Test。
 *
 * 核心断言：
 *  - Net PnL = Gross PnL − Fees − Slippage 严格成立。
 *  - 确定性：相同输入恒产生相同输出。
 *  - 状态隔离：连续回测互不污染。
 *  - 未来函数：增加未来数据不改变历史结果。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_COST_MODEL,
  NextOpenExecutionModel,
  buyFees,
  sellFees,
  slippedBuyPrice,
  slippedSellPrice,
  nextOpenExecutionModel,
  type CostModel,
  type MarketBar,
  type Signal,
} from "./execution";
import { Portfolio } from "./portfolio";
import { completedTrades, computePerformance, dailyReturnsFromEquity, maxDrawdownFromEquity } from "./performance";
import { runBacktest } from "./engine";
import type { BacktestConfig, Fill } from "./domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COST: CostModel = { commissionRate: 0.0003, stampDutyRate: 0.0005, transferFeeRate: 0.00001, slippageBps: 10, lotSize: 100, minCommission: 5 };

function bar(partial: Partial<MarketBar> & { date: string }): MarketBar {
  return { open: null, high: null, low: null, close: null, prevClose: null, amount: null, ...partial };
}

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    strategyId: "test",
    strategyVersion: "1.0.0",
    initialCapital: 100_000,
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    cost: COST,
    maxPositions: 5,
    maxPositionAmountRatio: 0,
    ...overrides,
  };
}

function buyFill(symbol: string, quantity: number, price: number, basePrice: number, executedAt: string): Fill {
  return { symbol, side: "buy", quantity, price, basePrice, executedAt, fees: 0, slippageAmount: 0 };
}
function sellFill(symbol: string, quantity: number, price: number, basePrice: number, executedAt: string): Fill {
  return { symbol, side: "sell", quantity, price, basePrice, executedAt, fees: 0, slippageAmount: 0 };
}

// ---------------------------------------------------------------------------
// 成本模型
// ---------------------------------------------------------------------------

describe("成本模型（手续费 / 滑点）", () => {
  it("买入滑点上浮、卖出滑点下浮", () => {
    expect(slippedBuyPrice(10, COST)).toBeCloseTo(10.01, 4);
    expect(slippedSellPrice(10, COST)).toBeCloseTo(9.99, 4);
  });

  it("买入费用 = 佣金 + 过户费（无印花税）", () => {
    expect(buyFees(1001, COST)).toBeCloseTo(5.01001, 6);
  });

  it("卖出费用 = 佣金 + 印花税 + 过户费", () => {
    expect(sellFees(1098.9, COST)).toBeCloseTo(5.560439, 6);
  });

  it("最低佣金生效", () => {
    const cheap = { ...COST, minCommission: 5 };
    // 成交额很小，佣金按比例只有 0.03 元，应抬高到 5 元。
    expect(buyFees(100, cheap)).toBeCloseTo(5 + 100 * 0.00001, 6);
  });
});

// ---------------------------------------------------------------------------
// 组合引擎（Portfolio）
// ---------------------------------------------------------------------------

describe("Portfolio 引擎", () => {
  it("初始资金", () => {
    const p = new Portfolio(100_000);
    expect(p.cash).toBe(100_000);
    expect(p.openPositionCount).toBe(0);
  });

  it("单次买入扣减现金并建立持仓", () => {
    const p = new Portfolio(100_000);
    const res = p.buy(buyFill("A", 100, 10.01, 10, "T1"), COST);
    expect(res.success).toBe(true);
    expect(p.cash).toBeLessThan(100_000);
    expect(p.openPositionCount).toBe(1);
    const pos = p.snapshotPositions()[0]!;
    expect(pos.symbol).toBe("A");
    expect(pos.quantity).toBe(100);
  });

  it("资金不足拒绝买入且不改变状态", () => {
    const p = new Portfolio(1_000);
    const before = p.cash;
    const res = p.buy(buyFill("A", 200, 100, 100, "T1"), COST);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("资金不足");
    expect(p.cash).toBe(before);
    expect(p.openPositionCount).toBe(0);
  });

  it("单次卖出清仓并结转已实现收益", () => {
    const p = new Portfolio(100_000);
    p.buy(buyFill("A", 100, 10.01, 10, "T1"), COST);
    const res = p.sell(sellFill("A", 100, 10.989, 11, "T2"), COST);
    expect(res.success).toBe(true);
    expect(p.openPositionCount).toBe(0);
    const trades = p.allTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0]!.netPnl).not.toBeNull();
  });

  it("持仓不足拒绝卖出", () => {
    const p = new Portfolio(100_000);
    p.buy(buyFill("A", 100, 10, 10, "T1"), COST);
    const res = p.sell(sellFill("A", 200, 11, 11, "T2"), COST);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("持仓不足");
    expect(p.openPositionCount).toBe(1);
  });

  it("卖出无持仓股票被拒绝", () => {
    const p = new Portfolio(100_000);
    const res = p.sell(sellFill("X", 100, 11, 11, "T2"), COST);
    expect(res.success).toBe(false);
  });

  it("持仓市值与未实现收益", () => {
    const p = new Portfolio(100_000, ["T1", "T2"]);
    p.buy(buyFill("A", 100, 10, 10, "T1"), COST);
    const equity = p.markToMarket(new Map([["A", 12]]));
    const pos = p.snapshotPositions()[0]!;
    expect(pos.marketValue).toBeCloseTo(1200, 4);
    expect(pos.unrealizedPnL).toBeGreaterThan(0);
    expect(equity).toBe(p.cash + 1200);
  });

  it("同一股票已有持仓不支持加仓", () => {
    const p = new Portfolio(100_000);
    p.buy(buyFill("A", 100, 10, 10, "T1"), COST);
    const res = p.buy(buyFill("A", 100, 11, 11, "T2"), COST);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("已有持仓");
  });

  it("状态隔离：两个 Portfolio 互不影响", () => {
    const a = new Portfolio(100_000);
    const b = new Portfolio(50_000);
    a.buy(buyFill("A", 100, 10, 10, "T1"), COST);
    expect(a.openPositionCount).toBe(1);
    expect(b.openPositionCount).toBe(0);
    expect(b.cash).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// 成交模型
// ---------------------------------------------------------------------------

describe("ExecutionModel", () => {
  it("正常买入以开盘价 + 滑点成交", () => {
    const m = nextOpenExecutionModel();
    const b = bar({ date: "T2", open: 10, prevClose: 9.5 });
    const fill = m.execute({ symbol: "A", side: "buy", quantity: 100, executionTime: "T2", orderType: "market" }, b, COST);
    expect(fill.rejectionReason).toBeUndefined();
    expect(fill.price).toBeCloseTo(10.01, 4);
    expect(fill.basePrice).toBe(10);
  });

  it("缺少开盘价拒绝成交", () => {
    const m = nextOpenExecutionModel();
    const b = bar({ date: "T2", open: null, prevClose: 9.5 });
    const fill = m.execute({ symbol: "A", side: "buy", quantity: 100, executionTime: "T2", orderType: "market" }, b, COST);
    expect(fill.rejectionReason).toContain("开盘价");
  });

  it("可配置禁止追涨停买入", () => {
    const m = new NextOpenExecutionModel({ blockLimitUpBuy: true });
    const b = bar({ date: "T2", open: 11, prevClose: 10 }); // 11 = 10 * 1.1 涨停
    const fill = m.execute({ symbol: "A", side: "buy", quantity: 100, executionTime: "T2", orderType: "market" }, b, COST);
    expect(fill.rejectionReason).toContain("涨停");
  });
});

// ---------------------------------------------------------------------------
// 绩效分析
// ---------------------------------------------------------------------------

describe("Performance Analytics", () => {
  it("最大回撤", () => {
    expect(maxDrawdownFromEquity([100, 120, 90, 130])).toBeCloseTo(0.25, 6); // (120-90)/120
    expect(maxDrawdownFromEquity([100, 100, 100])).toBe(0);
  });

  it("日收益率序列", () => {
    const r = dailyReturnsFromEquity([
      { timestamp: "T1", cash: 0, marketValue: 0, equity: 100, openPositions: 0 },
      { timestamp: "T2", cash: 0, marketValue: 0, equity: 110, openPositions: 0 },
      { timestamp: "T3", cash: 0, marketValue: 0, equity: 99, openPositions: 0 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 6);
    expect(r[1]).toBeCloseTo(-0.1, 6);
  });

  it("胜率 / Profit Factor / 平均盈亏 / Trade Count", () => {
    const trades = [
      { symbol: "A", entryTime: "T1", entryPrice: 10, exitTime: "T2", exitPrice: 12, quantity: 100, grossPnL: 200, fees: 1, slippageAmount: 0, netPnl: 190, returnPct: 19, holdingPeriod: 1, openAtEnd: false, reason: null },
      { symbol: "B", entryTime: "T1", entryPrice: 10, exitTime: "T2", exitPrice: 9, quantity: 100, grossPnL: -100, fees: 1, slippageAmount: 0, netPnl: -110, returnPct: -11, holdingPeriod: 1, openAtEnd: false, reason: null },
      { symbol: "C", entryTime: "T1", entryPrice: 10, exitTime: "T2", exitPrice: 11, quantity: 100, grossPnL: 100, fees: 1, slippageAmount: 0, netPnl: 90, returnPct: 9, holdingPeriod: 1, openAtEnd: false, reason: null },
    ];
    const perf = computePerformance({
      equityCurve: [{ timestamp: "T0", cash: 100_000, marketValue: 0, equity: 100_000, openPositions: 0 }],
      trades,
      initialCapital: 100_000,
    });
    expect(perf.tradeCount).toBe(3);
    expect(perf.completedTradeCount).toBe(3);
    expect(perf.winRatePct).toBeCloseTo(66.67, 1);
    expect(perf.profitFactor).toBeCloseTo((190 + 90) / 110, 4);
    expect(perf.averageWin).toBeCloseTo((190 + 90) / 2, 4);
    expect(perf.averageLoss).toBeCloseTo(-110, 4);
  });

  it("Sharpe 与 CAGR 分离（CAGR 用几何年化，Sharpe 用算术年化）", () => {
    const perf = computePerformance({
      equityCurve: [
        { timestamp: "T0", cash: 0, marketValue: 0, equity: 100, openPositions: 0 },
        { timestamp: "T1", cash: 0, marketValue: 0, equity: 101, openPositions: 0 },
        { timestamp: "T2", cash: 0, marketValue: 0, equity: 103, openPositions: 0 },
        { timestamp: "T3", cash: 0, marketValue: 0, equity: 106, openPositions: 0 },
      ],
      trades: [],
      initialCapital: 100,
    });
    expect(perf.annualizedReturnPct).not.toBeNull();
    expect(perf.sharpeRatio).not.toBeNull();
    // CAGR 为几何年化，不是简单 (期末-期初)/期初。
    expect(perf.annualizedReturnPct).toBeGreaterThan(perf.totalReturnPct);
  });

  it("无交易时指标为空/安全默认值", () => {
    const perf = computePerformance({ equityCurve: [], trades: [], initialCapital: 100_000 });
    expect(perf.tradeCount).toBe(0);
    expect(perf.winRatePct).toBeNull();
    expect(perf.sharpeRatio).toBeNull();
    expect(perf.maxDrawdownPct).toBe(0);
  });

  it("completedTrades 只统计已平仓且净盈亏非空的", () => {
    const open = { symbol: "A", entryTime: "T1", entryPrice: 10, exitTime: null, exitPrice: null, quantity: 100, grossPnL: null, fees: 0, slippageAmount: 0, netPnl: null, returnPct: null, holdingPeriod: null, openAtEnd: true, reason: null };
    const closed = { ...open, openAtEnd: false, netPnl: 50, exitTime: "T2", exitPrice: 10.5 };
    expect(completedTrades([open, closed])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 回测引擎 + Golden Test
// ---------------------------------------------------------------------------

describe("Backtest Engine", () => {
  const tradingDates = ["2026-01-01", "2026-01-02", "2026-01-03"];

  const barsByDate = new Map<string, Map<string, MarketBar>>();
  barsByDate.set("2026-01-01", new Map([["600000", bar({ date: "2026-01-01", open: null, close: 10, prevClose: 9.5 })]]));
  barsByDate.set("2026-01-02", new Map([["600000", bar({ date: "2026-01-02", open: 10, close: 10.5, prevClose: 10 })]]));
  barsByDate.set("2026-01-03", new Map([["600000", bar({ date: "2026-01-03", open: 11, close: 11.2, prevClose: 10.5 })]]));

  it("Golden Test：人工计算确定的一买一卖", () => {
    const config = makeConfig({ startDate: "2026-01-01", endDate: "2026-01-03" });
    const signals: Record<string, Signal[]> = {
      "2026-01-01": [{ symbol: "600000", side: "buy", quantity: 100, signalTime: "2026-01-01" }],
      "2026-01-02": [{ symbol: "600000", side: "sell", quantity: 100, signalTime: "2026-01-02" }],
      "2026-01-03": [],
    };
    const result = runBacktest({ config, tradingDates, barsByDate, signalProvider: (date) => signals[date] ?? [] });

    // 现金：100000 − 1006.01001 + 1093.339561 = 100087.329551
    expect(result.finalPortfolio.cash).toBeCloseTo(100_087.329551, 3);
    expect(result.finalPortfolio.equity).toBeCloseTo(100_087.329551, 3);

    const trade = result.trades[0]!;
    expect(result.trades).toHaveLength(1);
    expect(trade.grossPnL).toBeCloseTo(100, 6); // (11-10)*100 纯价格差
    expect(trade.fees).toBeCloseTo(10.570449, 4); // 买入 5.01001 + 卖出 5.560439
    expect(trade.slippageAmount).toBeCloseTo(2.1, 4); // 买入 1.0 + 卖出 1.1
    expect(trade.netPnl).toBeCloseTo(87.329551, 3);

    // 关键恒等式：Net PnL = Gross PnL − Fees − Slippage
    expect(trade.netPnl!).toBeCloseTo(trade.grossPnL! - trade.fees - trade.slippageAmount, 6);
    expect(trade.returnPct).toBeCloseTo(8.6808, 2);
    expect(trade.holdingPeriod).toBe(2); // 买入日(01-02)至卖出日(01-03)跨 2 个交易日
    expect(trade.openAtEnd).toBe(false);

    // 权益曲线 3 个时点。
    expect(result.equityCurve).toHaveLength(3);
    expect(result.performance.totalReturnPct).toBeCloseTo(0.0873, 3);
  });

  it("空交易：无信号返回安全结果", () => {
    const config = makeConfig({ startDate: "2026-01-01", endDate: "2026-01-03" });
    const result = runBacktest({ config, tradingDates, barsByDate, signalProvider: () => [] });
    expect(result.trades).toHaveLength(0);
    expect(result.finalPortfolio.cash).toBe(100_000);
    expect(result.performance.tradeCount).toBe(0);
    expect(result.performance.sharpeRatio).toBeNull();
  });

  it("确定性：相同输入产生相同输出", () => {
    const config = makeConfig({ startDate: "2026-01-01", endDate: "2026-01-03" });
    const provider = (date: string): Signal[] =>
      date === "2026-01-01" ? [{ symbol: "600000", side: "buy", quantity: 100, signalTime: date }] : date === "2026-01-02" ? [{ symbol: "600000", side: "sell", quantity: 100, signalTime: date }] : [];
    const r1 = runBacktest({ config, tradingDates, barsByDate, signalProvider: provider });
    const r2 = runBacktest({ config, tradingDates, barsByDate, signalProvider: provider });
    expect(r1.finalPortfolio.cash).toBe(r2.finalPortfolio.cash);
    expect(r1.performance).toEqual(r2.performance);
    expect(JSON.stringify(r1.trades)).toBe(JSON.stringify(r2.trades));
  });

  it("状态隔离：连续回测互不污染", () => {
    const config = makeConfig({ startDate: "2026-01-01", endDate: "2026-01-03" });
    const a = runBacktest({
      config,
      tradingDates,
      barsByDate,
      signalProvider: (date) => (date === "2026-01-01" ? [{ symbol: "600000", side: "buy", quantity: 100, signalTime: date }] : []),
    });
    const b = runBacktest({ config, tradingDates, barsByDate, signalProvider: () => [] });
    expect(a.trades).toHaveLength(1);
    expect(b.trades).toHaveLength(0);
    expect(b.finalPortfolio.cash).toBe(100_000);
  });

  it("日期边界：endDate 之后的数据不参与回测", () => {
    const config = makeConfig({ startDate: "2026-01-01", endDate: "2026-01-02" });
    // 信号在 01-01 买入，01-02 是最后一个交易日（买入成交），01-03 被 endDate 排除。
    const result = runBacktest({
      config,
      tradingDates,
      barsByDate,
      signalProvider: (date) => (date === "2026-01-01" ? [{ symbol: "600000", side: "buy", quantity: 100, signalTime: date }] : []),
    });
    // 买入已成交（01-02），但 01-03 的卖出信号不会被处理。
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.openAtEnd).toBe(true);
    expect(result.equityCurve).toHaveLength(2);
  });

  it("未来数据不影响历史结果：增加 endDate 之后的 bar 不改变结果", () => {
    const config = makeConfig({ startDate: "2026-01-01", endDate: "2026-01-02" });
    const provider = (date: string): Signal[] => (date === "2026-01-01" ? [{ symbol: "600000", side: "buy", quantity: 100, signalTime: date }] : []);

    const withExtra = new Map(barsByDate);
    withExtra.set("2026-01-04", new Map([["600000", bar({ date: "2026-01-04", open: 999, close: 999, prevClose: 999 })]]));

    const r1 = runBacktest({ config, tradingDates, barsByDate, signalProvider: provider });
    const r2 = runBacktest({ config, tradingDates, barsByDate: withExtra, signalProvider: provider });
    expect(r1.finalPortfolio.cash).toBe(r2.finalPortfolio.cash);
    expect(JSON.stringify(r1.trades)).toBe(JSON.stringify(r2.trades));
  });

  it("T+1 规则：信号日收盘后产生，下一交易日开盘成交", () => {
    const config = makeConfig({ startDate: "2026-01-01", endDate: "2026-01-03" });
    const result = runBacktest({
      config,
      tradingDates,
      barsByDate,
      signalProvider: (date) => (date === "2026-01-01" ? [{ symbol: "600000", side: "buy", quantity: 100, signalTime: date }] : []),
    });
    // 信号在 01-01 收盘产生，买入在 01-02 开盘成交（价格 10 + 滑点）。
    const trade = result.trades[0]!;
    expect(trade.entryTime).toBe("2026-01-02");
    expect(trade.entryPrice).toBeCloseTo(10.01, 4);
  });
});
