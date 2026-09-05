/**
 * STEP 8 — Backtest Engine 2.0 测试套件。
 *
 * 覆盖任务要求的 20 类场景：次日成交 / 同日未来函数拒绝 / T+1 / 佣金 / 印花税 / 滑点 /
 * 现金不足 / 停牌 / 涨跌停拒绝接口 / 部分成交接口 / 确定性 / 序列化 / 空数据集 /
 * 单股 / 多股 / 多笔交易 / 持仓会计 / 已实现盈亏 / 未实现盈亏 / 成本核算。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../data/types";
import { createSignalDataView, InMemoryBarStore } from "./dataSource";
import { runBacktestEngine2 } from "./engine";
import { PositionBook } from "./position";
import { Portfolio } from "./portfolio";
import { commissionFee, computeTradeCost, stampDutyFee, transferFee } from "./cost";
import { NextOpenExecutionModel } from "./execution";
import { deserializeBacktestResult, serializeBacktestResult } from "./serialization";
import type { BacktestSpec, Security, Signal } from "./types";
import type { CostModel } from "../engine/domain";

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
};

const SEC: Security = { securityId: "600001.SH", board: "main" };

function bar(symbol: string, date: string, overrides: Partial<CanonicalMarketBar> = {}): CanonicalMarketBar {
  return {
    symbol,
    timestamp: date,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    preClose: 10,
    volume: null,
    amount: null,
    turnoverRate: null,
    adjustment: "raw",
    ...overrides,
  };
}

function makeSpec(overrides: Partial<BacktestSpec> = {}): BacktestSpec {
  return {
    strategyId: "test",
    strategyVersion: "1.0.0",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    initialCapital: 100_000,
    cost: COST,
    executionModel: "NEXT_OPEN",
    universe: { id: "U", securities: [SEC] },
    signalGenerator: () => [],
    ...overrides,
  };
}

const buySignal = (securityId: string, date: string, quantity = 100, extra: Partial<Signal> = {}): Signal => ({
  securityId, signalTime: date, side: "buy", quantity, ...extra,
});
const sellSignal = (securityId: string, date: string, quantity = 100, extra: Partial<Signal> = {}): Signal => ({
  securityId, signalTime: date, side: "sell", quantity, ...extra,
});

// ---------------------------------------------------------------------------
// 1. 次日成交
// ---------------------------------------------------------------------------
describe("次日成交（next-day execution）", () => {
  it("T 日收盘信号在 T+1 开盘成交，不在 T 日成交", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01", { open: 10, close: 10 }),
      bar(SEC.securityId, "2026-01-02", { open: 10.5, close: 11, preClose: 10 }),
      bar(SEC.securityId, "2026-01-03", { open: 11, close: 11.5, preClose: 10.5 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date)] : []),
    });
    const result = await runBacktestEngine2(store, spec);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.entryTime).toBe("2026-01-02"); // 信号日 01-01，成交日 01-02
    // 成交价 = 01-02 开盘 10.5 上浮 10bps = 10.5105
    expect(result.trades[0]!.entryPrice).toBeCloseTo(10.5105, 4);
  });
});

// ---------------------------------------------------------------------------
// 2. 同日未来函数拒绝（look-ahead）
// ---------------------------------------------------------------------------
describe("同日未来函数拒绝（look-ahead prevention）", () => {
  it("信号数据视图只暴露 <= decisionDate 的 bar", () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01"),
      bar(SEC.securityId, "2026-01-02"),
      bar(SEC.securityId, "2026-01-03"),
    ];
    const history = new Map([[SEC.securityId, bars as readonly CanonicalMarketBar[]]]);
    const view = createSignalDataView("2026-01-02", [SEC], history);
    const visible = view.bars(SEC.securityId)!;
    expect(visible.map((b) => b.timestamp)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(visible.map((b) => b.timestamp)).not.toContain("2026-01-03");
  });

  it("结构性保证：成交日严格晚于信号日（同一 close 不能成交）", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01"),
      bar(SEC.securityId, "2026-01-02"),
      bar(SEC.securityId, "2026-01-03"),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    for (const trade of result.trades) {
      expect(trade.entryTime > "2026-01-01").toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. T+1
// ---------------------------------------------------------------------------
describe("T+1 约束", () => {
  it("当日买入冻结，次日才可卖（PositionBook 三态）", () => {
    const book = new PositionBook();
    book.increase(SEC.securityId, 100, 10, 5);
    expect(book.quantity(SEC.securityId)).toBe(100);
    expect(book.frozen(SEC.securityId)).toBe(100);
    expect(book.available(SEC.securityId)).toBe(0);

    // 当日卖出应失败（冻结不可卖）。
    expect(() => book.decrease(SEC.securityId, 100, 11, 5)).toThrow();

    book.settle();
    expect(book.available(SEC.securityId)).toBe(100);
    expect(book.frozen(SEC.securityId)).toBe(0);
    const result = book.decrease(SEC.securityId, 100, 11, 5);
    expect(result.closed).toBe(true);
  });

  it("Portfolio 卖出冻结份额被 T_PLUS_1 拒绝", () => {
    const portfolio = new Portfolio(100_000, ["2026-01-01", "2026-01-02"]);
    const buyResult = portfolio.buy(
      { fillId: "f1", orderId: "o1", securityId: SEC.securityId, side: "buy", quantity: 100, price: 10, basePrice: 10, timestamp: "2026-01-01", cost: { commission: 5, stampDuty: 0, transferFee: 0, otherFees: 0, total: 5 }, slippageAmount: 0 },
      COST,
      false,
    );
    expect(buyResult.success).toBe(true);

    // 当日（未 settle）卖出 → T_PLUS_1 拒绝。
    const sellResult = portfolio.sell(
      { fillId: "f2", orderId: "o2", securityId: SEC.securityId, side: "sell", quantity: 100, price: 11, basePrice: 11, timestamp: "2026-01-01", cost: { commission: 5, stampDuty: 0, transferFee: 0, otherFees: 0, total: 5 }, slippageAmount: 0 },
      COST,
      false,
    );
    expect(sellResult.success).toBe(false);
    expect(sellResult.rejectionReason).toBe("T_PLUS_1");
  });
});

// ---------------------------------------------------------------------------
// 4/5/6. 佣金 / 印花税 / 滑点
// ---------------------------------------------------------------------------
describe("交易成本（佣金 / 印花税 / 滑点）", () => {
  it("佣金不低于最低佣金", () => {
    expect(commissionFee(10_000, COST)).toBe(5);
    expect(commissionFee(100_000, COST)).toBeCloseTo(30, 6);
  });

  it("印花税仅卖出收取", () => {
    expect(stampDutyFee(100_000, COST, "buy")).toBe(0);
    expect(stampDutyFee(100_000, COST, "sell")).toBeCloseTo(50, 6);
  });

  it("过户费双边收取", () => {
    expect(transferFee(100_000, COST)).toBeCloseTo(1, 6);
  });

  it("买入滑点上浮、卖出滑点下浮", () => {
    const model = new NextOpenExecutionModel();
    const rules = { limitUpRatio: 0.1, limitDownRatio: 0.1, blockLimitUpBuy: false, blockLimitDownSell: false };
    const b = bar(SEC.securityId, "2026-01-02", { open: 10, preClose: 10 });
    const buyQuote = model.quote(
      { orderId: "o1", securityId: SEC.securityId, tradeDate: "2026-01-01", side: "buy", quantity: 100, orderType: "market", requestedPrice: null, status: "SUBMITTED", executionTime: "2026-01-02", filledQuantity: 0, averageFillPrice: null, rejectionReason: null, createdAt: "t" },
      b, rules, COST, null,
    );
    const sellQuote = model.quote(
      { orderId: "o2", securityId: SEC.securityId, tradeDate: "2026-01-01", side: "sell", quantity: 100, orderType: "market", requestedPrice: null, status: "SUBMITTED", executionTime: "2026-01-02", filledQuantity: 0, averageFillPrice: null, rejectionReason: null, createdAt: "t" },
      b, rules, COST, null,
    );
    expect(buyQuote.kind).toBe("filled");
    expect(sellQuote.kind).toBe("filled");
    expect(buyQuote.price!).toBeGreaterThan(buyQuote.basePrice!);
    expect(sellQuote.price!).toBeLessThan(sellQuote.basePrice!);
  });
});

// ---------------------------------------------------------------------------
// 7. 现金不足
// ---------------------------------------------------------------------------
describe("现金不足", () => {
  it("现金不足全额买入时拒绝（INSUFFICIENT_CASH）", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01", { open: 100, close: 100 }),
      bar(SEC.securityId, "2026-01-02", { open: 100, close: 100, preClose: 100 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      initialCapital: 5_000,
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date, 1000)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    expect(result.trades).toHaveLength(0);
    const rejected = result.audit.orders.filter((o) => o.status === "REJECTED");
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0]!.rejectionReason).toBe("INSUFFICIENT_CASH");
    expect(result.executionStats.byReason["INSUFFICIENT_CASH"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. 停牌
// ---------------------------------------------------------------------------
describe("停牌（suspended）", () => {
  it("成交日无 bar 视为停牌，拒绝成交", async () => {
    const other = "000001.SZ";
    const bars = [
      bar(other, "2026-01-01"),
      bar(other, "2026-01-02"),
      bar(other, "2026-01-03"),
      bar(SEC.securityId, "2026-01-01"),
      // 600001.SH 在 01-02 无 bar（停牌）。
      bar(SEC.securityId, "2026-01-03"),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    expect(result.trades).toHaveLength(0);
    const rejected = result.audit.orders.find((o) => o.status === "REJECTED");
    expect(rejected).toBeDefined();
    expect(rejected!.rejectionReason).toBe("SUSPENDED");
    expect(result.executionStats.byReason["SUSPENDED"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. 涨跌停拒绝接口
// ---------------------------------------------------------------------------
describe("涨跌停拒绝接口", () => {
  it("涨停买入被 LIMIT_UP 拒绝", () => {
    const model = new NextOpenExecutionModel();
    const rules = { limitUpRatio: 0.1, limitDownRatio: 0.1, blockLimitUpBuy: true, blockLimitDownSell: false };
    const b = bar(SEC.securityId, "2026-01-02", { open: 11, preClose: 10 }); // 11 = 10×1.1 涨停
    const quote = model.quote(
      { orderId: "o1", securityId: SEC.securityId, tradeDate: "2026-01-01", side: "buy", quantity: 100, orderType: "market", requestedPrice: null, status: "SUBMITTED", executionTime: "2026-01-02", filledQuantity: 0, averageFillPrice: null, rejectionReason: null, createdAt: "t" },
      b, rules, COST, null,
    );
    expect(quote.kind).toBe("rejected");
    expect(quote.rejectionReason).toBe("LIMIT_UP");
  });

  it("跌停卖出被 LIMIT_DOWN 拒绝", () => {
    const model = new NextOpenExecutionModel();
    const rules = { limitUpRatio: 0.1, limitDownRatio: 0.1, blockLimitUpBuy: false, blockLimitDownSell: true };
    const b = bar(SEC.securityId, "2026-01-02", { open: 9, preClose: 10 }); // 9 = 10×0.9 跌停
    const quote = model.quote(
      { orderId: "o2", securityId: SEC.securityId, tradeDate: "2026-01-01", side: "sell", quantity: 100, orderType: "market", requestedPrice: null, status: "SUBMITTED", executionTime: "2026-01-02", filledQuantity: 0, averageFillPrice: null, rejectionReason: null, createdAt: "t" },
      b, rules, COST, null,
    );
    expect(quote.kind).toBe("rejected");
    expect(quote.rejectionReason).toBe("LIMIT_DOWN");
  });
});

// ---------------------------------------------------------------------------
// 10. 部分成交接口
// ---------------------------------------------------------------------------
describe("部分成交接口", () => {
  it("allowPartialFill 开启时现金不足按最大可行数量部分成交", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01", { open: 10, close: 10 }),
      bar(SEC.securityId, "2026-01-02", { open: 10, close: 10, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      initialCapital: 5_000,
      allowPartialFill: true,
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date, 1000)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    expect(result.trades).toHaveLength(1);
    const filled = result.trades[0]!.quantity;
    expect(filled).toBeGreaterThanOrEqual(100);
    expect(filled).toBeLessThan(1000);
    expect(filled % 100).toBe(0);
    expect(result.executionStats.partialFills).toBe(1);
    const partialOrder = result.audit.orders.find((o) => o.status === "PARTIALLY_FILLED");
    expect(partialOrder).toBeDefined();
  });

  it("allowPartialFill 关闭时同一场景全额拒绝", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01", { open: 10, close: 10 }),
      bar(SEC.securityId, "2026-01-02", { open: 10, close: 10, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      initialCapital: 5_000,
      allowPartialFill: false,
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date, 1000)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    expect(result.trades).toHaveLength(0);
    expect(result.executionStats.byReason["INSUFFICIENT_CASH"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 11. 确定性
// ---------------------------------------------------------------------------
describe("确定性（determinism）", () => {
  it("相同规范两次回测结果 deepEqual", async () => {
    const symbols = ["600001.SH", "600002.SH"];
    const bars: CanonicalMarketBar[] = [];
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
    for (const d of dates) for (const s of symbols) bars.push(bar(s, d, { open: 10, close: 10.2, preClose: 10 }));

    const store = new InMemoryBarStore({ bars, securities: symbols.map((s) => ({ securityId: s, board: "main" as const })) });
    const universe = { id: "U", securities: symbols.map((s) => ({ securityId: s, board: "main" as const })) };
    const buildSpec = (): BacktestSpec => makeSpec({
      universe,
      signalGenerator: (date) => (date === "2026-01-01" ? symbols.map((s) => buySignal(s, date)) : []),
    });

    const r1 = await runBacktestEngine2(store, buildSpec());
    const r2 = await runBacktestEngine2(store, buildSpec());
    expect(r1).toEqual(r2);
    expect(r1.runId).toBe(r2.runId);
  });
});

// ---------------------------------------------------------------------------
// 12. 序列化
// ---------------------------------------------------------------------------
describe("序列化（serialization）", () => {
  it("serialize → deserialize 语义一致", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01"),
      bar(SEC.securityId, "2026-01-02", { open: 11, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    const json = serializeBacktestResult(result);
    expect(json).not.toContain("NaN");
    expect(json).not.toContain("Infinity");
    expect(deserializeBacktestResult(json)).toEqual(result);
  });
});

// ---------------------------------------------------------------------------
// 13. 空数据集
// ---------------------------------------------------------------------------
describe("空数据集", () => {
  it("空 store 返回空结果不崩溃", async () => {
    const store = new InMemoryBarStore({ bars: [] });
    const spec = makeSpec({});
    const result = await runBacktestEngine2(store, spec);
    expect(result.trades).toHaveLength(0);
    expect(result.equityCurve).toHaveLength(0);
    expect(result.finalEquity).toBe(spec.initialCapital);
  });
});

// ---------------------------------------------------------------------------
// 14. 单股 / 15. 多股
// ---------------------------------------------------------------------------
describe("单股与多股", () => {
  it("单股回测产生一笔交易", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01"),
      bar(SEC.securityId, "2026-01-02", { open: 11, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.securityId).toBe(SEC.securityId);
  });

  it("多股回测产生多笔交易", async () => {
    const a = "600001.SH";
    const b = "600002.SH";
    const bars = [
      bar(a, "2026-01-01"), bar(a, "2026-01-02", { open: 11, preClose: 10 }),
      bar(b, "2026-01-01"), bar(b, "2026-01-02", { open: 11, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars, securities: [a, b].map((s) => ({ securityId: s, board: "main" as const })) });
    const spec = makeSpec({
      universe: { id: "U", securities: [a, b].map((s) => ({ securityId: s, board: "main" as const })) },
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(a, date), buySignal(b, date)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    expect(result.trades).toHaveLength(2);
    expect(result.trades.map((t) => t.securityId).sort()).toEqual([a, b].sort());
  });
});

// ---------------------------------------------------------------------------
// 16. 多笔交易（买→卖→买→卖）
// ---------------------------------------------------------------------------
describe("多笔交易", () => {
  it("两次完整买卖产生 2 笔已平仓交易", async () => {
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
    const bars = dates.map((d) => bar(SEC.securityId, d, { open: 10, close: 10.5, preClose: 10 }));
    const store = new InMemoryBarStore({ bars });
    const plan: Record<string, Signal[]> = {
      "2026-01-01": [buySignal(SEC.securityId, "2026-01-01")],
      "2026-01-03": [sellSignal(SEC.securityId, "2026-01-03")],
      "2026-01-05": [buySignal(SEC.securityId, "2026-01-05")],
      "2026-01-07": [sellSignal(SEC.securityId, "2026-01-07")],
    };
    const spec = makeSpec({ signalGenerator: (date) => plan[date] ?? [] });
    const result = await runBacktestEngine2(store, spec);
    const closed = result.trades.filter((t) => !t.openAtEnd);
    expect(closed).toHaveLength(2);
    expect(result.metrics.completedTradeCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 17. 持仓会计
// ---------------------------------------------------------------------------
describe("持仓会计（quantity / available / frozen）", () => {
  it("期末持仓三态正确", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01"),
      bar(SEC.securityId, "2026-01-02", { open: 11, preClose: 10 }),
      bar(SEC.securityId, "2026-01-03", { open: 11, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    expect(result.positions).toHaveLength(1);
    const pos = result.positions[0]!;
    expect(pos.quantity).toBe(100);
    expect(pos.availableQuantity).toBe(100); // 已结算（次日）
    expect(pos.frozenQuantity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 18. 已实现盈亏 / 19. 未实现盈亏
// ---------------------------------------------------------------------------
describe("已实现 / 未实现盈亏", () => {
  it("买入后未卖：未实现盈亏 = 市值 − 成本基，已实现为 0", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01"),
      bar(SEC.securityId, "2026-01-02", { open: 11, close: 12, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const spec = makeSpec({
      signalGenerator: (date) => (date === "2026-01-01" ? [buySignal(SEC.securityId, date)] : []),
    });
    const result = await runBacktestEngine2(store, spec);
    const pos = result.positions[0]!;
    expect(pos.realizedPnL).toBe(0);
    expect(pos.unrealizedPnL).toBeGreaterThan(0);
  });

  it("买入后卖出：产生已实现盈亏，满足 Net = Gross − Fees − Slippage", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01"),
      bar(SEC.securityId, "2026-01-02", { open: 11, preClose: 10 }),
      bar(SEC.securityId, "2026-01-03", { open: 12, preClose: 10 }),
      bar(SEC.securityId, "2026-01-04", { open: 12, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const plan: Record<string, Signal[]> = {
      "2026-01-01": [buySignal(SEC.securityId, "2026-01-01")],
      "2026-01-03": [sellSignal(SEC.securityId, "2026-01-03")],
    };
    const spec = makeSpec({ signalGenerator: (date) => plan[date] ?? [] });
    const result = await runBacktestEngine2(store, spec);
    const closed = result.trades.filter((t) => !t.openAtEnd);
    expect(closed).toHaveLength(1);
    const trade = closed[0]!;
    expect(trade.netPnl).not.toBeNull();
    // 不变量：Net = Gross − Fees − Slippage
    expect(trade.netPnl!).toBeCloseTo(trade.grossPnL! - trade.fees - trade.slippageAmount, 6);
  });
});

// ---------------------------------------------------------------------------
// 20. 成本核算
// ---------------------------------------------------------------------------
describe("成本核算", () => {
  it("费用分解合计正确（佣金 + 印花税 + 过户费）", () => {
    const cost = computeTradeCost("sell", 100_000, COST);
    expect(cost.commission).toBeCloseTo(30, 6);
    expect(cost.stampDuty).toBeCloseTo(50, 6);
    expect(cost.transferFee).toBeCloseTo(1, 6);
    expect(cost.otherFees).toBe(0);
    expect(cost.total).toBeCloseTo(81, 6);
  });

  it("回测成本汇总 = 各成交费用之和", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01"),
      bar(SEC.securityId, "2026-01-02", { open: 11, preClose: 10 }),
      bar(SEC.securityId, "2026-01-03", { open: 12, preClose: 10 }),
      bar(SEC.securityId, "2026-01-04", { open: 12, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const plan: Record<string, Signal[]> = {
      "2026-01-01": [buySignal(SEC.securityId, "2026-01-01")],
      "2026-01-03": [sellSignal(SEC.securityId, "2026-01-03")],
    };
    const spec = makeSpec({ signalGenerator: (date) => plan[date] ?? [] });
    const result = await runBacktestEngine2(store, spec);
    expect(result.costs.stampDuty).toBeGreaterThan(0); // 卖出印花税
    expect(result.costs.buyCommission).toBeGreaterThan(0);
    expect(result.costs.sellCommission).toBeGreaterThan(0);
    expect(result.costs.totalCost).toBeCloseTo(
      result.costs.totalFees + result.costs.slippage, 6,
    );
  });
});
