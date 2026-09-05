/**
 * Step 2-FIX 回归测试 —— 针对验收 FAIL 的 4 项 P1/P2 修复。
 *
 * 覆盖：
 *  - P1-1 maxPositions 生效
 *  - P1-2 maxPositionAmountRatio 生效（容量足够 / 容量不足截断 / 不足一手）
 *  - P1-3 未来函数修复（滑点分层改用信号日 amount，不再用 T+1 当日 amount）
 *  - P2   lotSize 校验（50/150 拒绝，100/200 成交）
 *  - Portfolio 不变量（cash>=0 / quantity>=0 / 整手 / 持仓数<=maxPositions / 金额<=capacity / equity=cash+mv）
 */

import { describe, expect, it } from "vitest";
import { nextOpenExecutionModel, type CostModel, type MarketBar, type Signal } from "./execution";
import { Portfolio } from "./portfolio";
import { runBacktest } from "./engine";
import type { BacktestConfig, Fill } from "./domain";

const COST: CostModel = { commissionRate: 0.0003, stampDutyRate: 0.0005, transferFeeRate: 0.00001, slippageBps: 10, lotSize: 100, minCommission: 5 };

function bar(partial: Partial<MarketBar> & { date: string }): MarketBar {
  return { open: null, high: null, low: null, close: null, prevClose: null, amount: null, ...partial };
}

function cfg(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    strategyId: "fix",
    strategyVersion: "1.0.0",
    initialCapital: 100_000,
    startDate: "T1",
    endDate: "T2",
    cost: COST,
    maxPositions: 5,
    maxPositionAmountRatio: 0,
    ...overrides,
  };
}

function buyFill(symbol: string, quantity: number, price: number, basePrice: number, executedAt: string, amount?: number | null): Fill {
  return { symbol, side: "buy", quantity, price, basePrice, executedAt, fees: 0, slippageAmount: 0, amount };
}

// ---------------------------------------------------------------------------
// P1-1 maxPositions
// ---------------------------------------------------------------------------

describe("P1-1 maxPositions 生效", () => {
  it("maxPositions=1 时多个 BUY 信号只建仓一个 symbol", () => {
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([
      ["A", bar({ date: "T1", open: null, close: 10, prevClose: 9 })],
      ["B", bar({ date: "T1", open: null, close: 20, prevClose: 19 })],
    ]));
    bars.set("T2", new Map([
      ["A", bar({ date: "T2", open: 10, close: 10, prevClose: 10 })],
      ["B", bar({ date: "T2", open: 20, close: 20, prevClose: 20 })],
    ]));
    const result = runBacktest({
      config: cfg({ maxPositions: 1 }),
      tradingDates: ["T1", "T2"],
      barsByDate: bars,
      signalProvider: (d) => d === "T1" ? [
        { symbol: "A", side: "buy", quantity: 100, signalTime: d },
        { symbol: "B", side: "buy", quantity: 100, signalTime: d },
      ] : [],
    });
    // 期末只有一个持仓，只有一笔成交。
    expect(result.finalPortfolio.positions).toHaveLength(1);
    expect(result.trades).toHaveLength(1);
    expect(result.performance.openPositionCount).toBe(1);
  });

  it("Portfolio 层直接拒绝超限建仓", () => {
    const p = new Portfolio(100_000, [], { maxPositions: 1 });
    expect(p.buy(buyFill("A", 100, 10, 10, "T1"), COST).success).toBe(true);
    const res = p.buy(buyFill("B", 100, 20, 20, "T1"), COST);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("MAX_POSITIONS_REACHED");
    expect(p.openPositionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P1-2 maxPositionAmountRatio
// ---------------------------------------------------------------------------

describe("P1-2 maxPositionAmountRatio 生效（amount 单位千元）", () => {
  it("容量足够 → 不截断，正常交易", () => {
    const p = new Portfolio(100_000, [], { maxPositionAmountRatio: 0.1 });
    const fill = buyFill("A", 100, 10, 10, "T1", 100_000); // 100000千元=1亿 → 容量1千万，远大于100股
    const res = p.buy(fill, COST);
    expect(res.success).toBe(true);
    expect(p.snapshotPositions()[0]!.quantity).toBe(100);
  });

  it("容量不足 → 数量被截断到容量上限（向下取整到整手）", () => {
    const p = new Portfolio(100_000, [], { maxPositionAmountRatio: 0.1 });
    // amount=200千元(20万)，ratio=0.1 → capacityAmount=20000元，price=10 → 2000股
    const fill = buyFill("A", 5000, 10, 10, "T1", 200);
    const res = p.buy(fill, COST);
    expect(res.success).toBe(true);
    expect(p.snapshotPositions()[0]!.quantity).toBe(2000);
  });

  it("容量不足以成交一手 → 不成交", () => {
    const p = new Portfolio(100_000, [], { maxPositionAmountRatio: 0.1 });
    // amount=5千元(5000元)，ratio=0.1 → capacityAmount=500元，price=10 → 50股 < 1手
    const fill = buyFill("A", 100, 10, 10, "T1", 5);
    const res = p.buy(fill, COST);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("CAPACITY_INSUFFICIENT");
    expect(p.openPositionCount).toBe(0);
  });

  it("资金约束与容量约束同时存在时取较小值", () => {
    // 资金 100000，price=10，资金最多买 ~9990 股（含费用）；容量限制 2000 股。
    const p = new Portfolio(100_000, [], { maxPositionAmountRatio: 0.1 });
    const fill = buyFill("A", 9000, 10, 10, "T1", 200); // 容量 2000 股
    const res = p.buy(fill, COST);
    expect(res.success).toBe(true);
    // min(9000, 2000 容量, 资金上限) = 2000
    expect(p.snapshotPositions()[0]!.quantity).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// P1-3 Future Leakage（未来函数修复）
// ---------------------------------------------------------------------------

describe("P1-3 Future Leakage 修复", () => {
  it("bar.amount（T+1 当日）变化不影响成交价，成交价只由 referenceAmount 决定", () => {
    const m = nextOpenExecutionModel();
    const order = { symbol: "A", side: "buy" as const, quantity: 100, executionTime: "T2", orderType: "market" as const };
    const b1 = bar({ date: "T2", open: 10, prevClose: 9.5, amount: 1_000_000 });
    const b2 = bar({ date: "T2", open: 10, prevClose: 9.5, amount: 100_000_000 });
    const f1 = m.execute(order, b1, COST, 500_000);
    const f2 = m.execute(order, b2, COST, 500_000);
    expect(f1.price).toBe(f2.price);
    // 500000千元=5亿 → 滑点 +5bp → 10 * 1.0015 = 10.015
    expect(f1.price).toBeCloseTo(10.015, 4);
  });

  it("T+1 / T+2 的 amount 变化不影响 T+1 开盘成交价", () => {
    const mk = (t1Amount: number, t2Amount: number) => {
      const bars = new Map<string, Map<string, MarketBar>>();
      bars.set("T1", new Map([["S", bar({ date: "T1", open: null, close: 10, prevClose: 9.5, amount: 500_000 })]]));
      bars.set("T2", new Map([["S", bar({ date: "T2", open: 10, close: 10.5, prevClose: 10, amount: t1Amount })]]));
      bars.set("T3", new Map([["S", bar({ date: "T3", open: 11, close: 11.2, prevClose: 10.5, amount: t2Amount })]]));
      return bars;
    };
    const provider = (d: string): Signal[] => d === "T1" ? [{ symbol: "S", side: "buy", quantity: 100, signalTime: d }] : [];
    const rA = runBacktest({ config: cfg({ endDate: "T3" }), tradingDates: ["T1", "T2", "T3"], barsByDate: mk(1_000_000, 500), signalProvider: provider });
    const rB = runBacktest({ config: cfg({ endDate: "T3" }), tradingDates: ["T1", "T2", "T3"], barsByDate: mk(100_000_000, 999_999), signalProvider: provider });
    expect(rA.trades[0]!.entryPrice).toBe(rB.trades[0]!.entryPrice);
    expect(rA.trades[0]!.entryPrice).toBeCloseTo(10.015, 4);
  });

  it("容量约束（maxPositionAmountRatio>0）使用信号日 amount，成交日 amount 变化不影响买入数量", () => {
    // 信号日 T1 amount 固定 = 500 千元（50 万）；仅改变成交日 T2 的 amount。
    const mk = (t2amount: number) => {
      const bars = new Map<string, Map<string, MarketBar>>();
      bars.set("T1", new Map([["S", bar({ date: "T1", open: null, close: 10, prevClose: 9.5, amount: 500 })]]));
      bars.set("T2", new Map([["S", bar({ date: "T2", open: 10, close: 10.5, prevClose: 10, amount: t2amount })]]));
      return bars;
    };
    const provider = (d: string): Signal[] => d === "T1" ? [{ symbol: "S", side: "buy", quantity: 1000, signalTime: d }] : [];
    // 信号日 amount=500千元 → capacityAmount=500*1000*0.1=50000元，足够买 1000 股。
    // 成交日 amount 无论 500 还是 5 千元，买入数量都应相同（不依赖 T+1 当日全天成交额）。
    const rA = runBacktest({ config: cfg({ maxPositionAmountRatio: 0.1 }), tradingDates: ["T1", "T2"], barsByDate: mk(500), signalProvider: provider });
    const rB = runBacktest({ config: cfg({ maxPositionAmountRatio: 0.1 }), tradingDates: ["T1", "T2"], barsByDate: mk(5), signalProvider: provider });
    expect(rA.trades[0]!.quantity).toBe(1000);
    expect(rB.trades[0]!.quantity).toBe(1000);
    expect(rA.trades[0]!.quantity).toBe(rB.trades[0]!.quantity);
  });

  it("容量截断基于信号日 amount 而非成交日 amount", () => {
    // 信号日 T1 amount 较小 = 5 千元（5000 元），成交日 T2 amount 很大。
    const mk = (t2amount: number) => {
      const bars = new Map<string, Map<string, MarketBar>>();
      bars.set("T1", new Map([["S", bar({ date: "T1", open: null, close: 10, prevClose: 9.5, amount: 5 })]]));
      bars.set("T2", new Map([["S", bar({ date: "T2", open: 10, close: 10.5, prevClose: 10, amount: t2amount })]]));
      return bars;
    };
    const provider = (d: string): Signal[] => d === "T1" ? [{ symbol: "S", side: "buy", quantity: 1000, signalTime: d }] : [];
    // 信号日 amount=5千元 → capacityAmount=5*1000*0.1=500元 → 不足一手，应拒绝（不成交）。
    // 若错误地用成交日 amount（很大），则会成交 → 测试会失败。
    const rA = runBacktest({ config: cfg({ maxPositionAmountRatio: 0.1 }), tradingDates: ["T1", "T2"], barsByDate: mk(500), signalProvider: provider });
    const rB = runBacktest({ config: cfg({ maxPositionAmountRatio: 0.1 }), tradingDates: ["T1", "T2"], barsByDate: mk(100_000_000), signalProvider: provider });
    expect(rA.trades).toHaveLength(0);
    expect(rB.trades).toHaveLength(0);
    expect(rA.finalPortfolio.cash).toBe(rB.finalPortfolio.cash);
  });
});

// ---------------------------------------------------------------------------
// P2 lotSize 校验
// ---------------------------------------------------------------------------

describe("P2 lotSize 校验", () => {
  it("50 股 BUY → 拒绝 INVALID_LOT_SIZE", () => {
    const p = new Portfolio(100_000);
    const res = p.buy(buyFill("A", 50, 10, 10, "T1"), COST);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("INVALID_LOT_SIZE");
    expect(p.openPositionCount).toBe(0);
  });

  it("150 股 BUY → 拒绝 INVALID_LOT_SIZE", () => {
    const p = new Portfolio(100_000);
    const res = p.buy(buyFill("A", 150, 10, 10, "T1"), COST);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("INVALID_LOT_SIZE");
  });

  it("100 股 BUY → 成交", () => {
    const p = new Portfolio(100_000);
    expect(p.buy(buyFill("A", 100, 10, 10, "T1"), COST).success).toBe(true);
    expect(p.openPositionCount).toBe(1);
  });

  it("200 股 BUY → 成交", () => {
    const p = new Portfolio(100_000);
    expect(p.buy(buyFill("A", 200, 10, 10, "T1"), COST).success).toBe(true);
    expect(p.snapshotPositions()[0]!.quantity).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Portfolio 不变量
// ---------------------------------------------------------------------------

describe("Portfolio Invariants", () => {
  it("多约束场景下全部不变量成立", () => {
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([
      ["A", bar({ date: "T1", open: null, close: 10, prevClose: 9, amount: 500 })],
      ["B", bar({ date: "T1", open: null, close: 20, prevClose: 19, amount: 500 })],
      ["C", bar({ date: "T1", open: null, close: 30, prevClose: 29, amount: 500 })],
    ]));
    bars.set("T2", new Map([
      ["A", bar({ date: "T2", open: 10, close: 10.5, prevClose: 10, amount: 500 })],
      ["B", bar({ date: "T2", open: 20, close: 21, prevClose: 20, amount: 500 })],
      ["C", bar({ date: "T2", open: 30, close: 30, prevClose: 30, amount: 500 })],
    ]));
    const result = runBacktest({
      config: cfg({ maxPositions: 2, maxPositionAmountRatio: 0.05 }), // 容量：500千元=50万 × 0.05 = 25000元/股
      tradingDates: ["T1", "T2"],
      barsByDate: bars,
      signalProvider: (d) => d === "T1" ? [
        { symbol: "A", side: "buy", quantity: 1000, signalTime: d },
        { symbol: "B", side: "buy", quantity: 1000, signalTime: d },
        { symbol: "C", side: "buy", quantity: 1000, signalTime: d },
      ] : [],
    });

    // Invariant 6: equity = cash + marketValue（每个点）
    // Invariant 1: cash >= 0（每个点）
    for (const p of result.equityCurve) {
      expect(p.equity).toBeCloseTo(p.cash + p.marketValue, 6);
      expect(p.cash).toBeGreaterThanOrEqual(0);
    }
    // Invariant 4: openPositionCount <= maxPositions
    for (const p of result.equityCurve) {
      expect(p.openPositions).toBeLessThanOrEqual(2);
    }
    // Invariant 2 + 3: quantity >= 0 且为整手
    for (const t of result.trades) {
      expect(t.quantity).toBeGreaterThanOrEqual(0);
      expect(t.quantity % 100).toBe(0);
    }
    // 最终持仓数不超过 maxPositions
    expect(result.finalPortfolio.positions.length).toBeLessThanOrEqual(2);
  });

  it("Invariant 5: 单笔成交金额 <= 容量上限", () => {
    const p = new Portfolio(100_000, [], { maxPositionAmountRatio: 0.1 });
    const fill = buyFill("A", 5000, 10, 10, "T1", 200); // 容量 20000 元
    p.buy(fill, COST);
    const pos = p.snapshotPositions()[0]!;
    const tradedAmount = pos.averageEntryPrice * pos.quantity;
    expect(tradedAmount).toBeLessThanOrEqual(200 * 1000 * 0.1 + 1e-9);
    expect(tradedAmount).toBeCloseTo(20_000, 6);
  });
});
