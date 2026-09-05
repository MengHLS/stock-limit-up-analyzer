/**
 * Step 4-FIX 回归测试 —— 针对独立验收 FAIL 的全部 P1/P2/P3 修复。
 *
 * 覆盖：
 *  - P1-F1 敞口估值价格口径不一致（已有持仓用上一收盘价而非决策时点开盘价 → 敞口被低估、上限被突破）
 *  - P2-F2 CashPolicy 滑点口径与执行层不一致（base 滑点 vs amount-adjusted 滑点）
 *  - P2-F3 风险层可选/Strategy 未接入引擎（buildDefaultRiskManager + runBacktestWithRisk 统一入口）
 *  - P3-F4 MaxPositionExposurePolicy → CapacityPolicy 重命名，统一 violation code CAPACITY_EXCEEDED
 *  - P3-F5 MaxPositionsPolicy 对同 symbol 加仓直接 REJECT（ADD_POSITION_NOT_SUPPORTED），与 Portfolio 兜底语义对齐
 */

import { describe, expect, it } from "vitest";
import {
  CashPolicy,
  LotSizePolicy,
  MaxPositionsPolicy,
  MaxPortfolioExposurePolicy,
  MaxSymbolExposurePolicy,
  CapacityPolicy,
  buildDefaultRiskManager,
  buildRiskContext,
  composeRiskManager,
  type OrderIntent,
  type RiskContext,
} from "./index";
import { DEFAULT_COST_MODEL, slippedBuyPrice, slippedBuyPriceAdjusted } from "../engine/execution";
import type { BacktestConfig, CostModel, MarketBar } from "../engine/domain";
import { runBacktest, runBacktestWithRisk } from "../engine/engine";
import { Portfolio } from "../engine/portfolio";

const COST: CostModel = DEFAULT_COST_MODEL;

function ctx(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    timestamp: "T1",
    equity: 100_000,
    cash: 100_000,
    availableCash: 100_000,
    positions: [],
    openPositionCount: 0,
    marketPrice: 10,
    portfolioExposure: 0,
    symbolExposure: 0,
    referenceAmount: null,
    cost: COST,
    ...overrides,
  };
}

function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return { symbol: "A", side: "buy", requestedQuantity: 1000, signalTime: "T1", ...overrides };
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

function bar(date: string, open: number | null, close: number | null, prevClose: number | null, amount: number | null = null): MarketBar {
  return { date, open, high: null, low: null, close, prevClose, amount };
}

// ---------------------------------------------------------------------------
// P1-F1：敞口估值价格口径一致
// ---------------------------------------------------------------------------

describe("P1-F1 敞口估值价格口径一致", () => {
  it("已有持仓敞口按决策时点开盘价估值，组合敞口不突破上限", () => {
    // 时间线：
    //  T1 收盘：产生 S 买入信号
    //  T2 开盘：S 成交 @10；T2 收盘 S=20
    //  T2 收盘：产生 X 买入信号
    //  T3 开盘：处理 X 信号，此时 S 开盘价 = 30（真实市值 3000，而非上一收盘价 20 的 2000）
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([["S", bar("T1", null, 10, 9.5, 500_000)]]));
    bars.set("T2", new Map([
      ["S", bar("T2", 10, 20, 10, 500_000)],
      ["X", bar("T2", null, 20, 20, 500_000)],
    ]));
    bars.set("T3", new Map([
      ["S", bar("T3", 30, 30, 20, 500_000)],
      ["X", bar("T3", 20, 20, 20, 500_000)],
    ]));

    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new MaxPositionsPolicy(2),
      new MaxPortfolioExposurePolicy(0.5),
      new CashPolicy(),
    ]);
    const result = runBacktest({
      config: cfg({ endDate: "T3" }),
      tradingDates: ["T1", "T2", "T3"],
      barsByDate: bars,
      signalProvider: (d) => {
        if (d === "T1") return [{ symbol: "S", side: "buy", quantity: 100, signalTime: d }];
        if (d === "T2") return [{ symbol: "X", side: "buy", quantity: 3000, signalTime: d }];
        return [];
      },
      risk: { manager: mgr },
    });

    const rd = (result as unknown as { riskDecisions?: { symbol: string; approvedQuantity: number; decision: string }[] }).riskDecisions ?? [];
    const x = rd.find((r) => r.symbol === "X");
    // S 真实市值 3000（T3 开盘 30），剩余敞口 = 0.5*equity - 3000 ≈ 47996 → X 可买 floor(47996/20/100)*100 = 2300 股。
    // 修复前（S 按 T2 收盘 20 估值 2000）会放行 2400 股。
    expect(x).toBeDefined();
    expect(x!.approvedQuantity).toBe(2300);

    // 期末组合敞口（市值/权益）不得超过 50%。
    const final = result.finalPortfolio;
    expect(final.equity).toBeGreaterThan(0);
    expect(final.marketValue / final.equity).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("snapshotPositionsAt 与 equityAt 共用同一价格口径", () => {
    const p = new Portfolio(100_000);
    const fill = { symbol: "S", side: "buy" as const, quantity: 100, price: 10, basePrice: 10, executedAt: "T1", fees: 0, slippageAmount: 0, amount: null };
    p.buy(fill, COST);
    // 按开盘价 30 估值：持仓市值 3000，equity = 100000 - 买入成本 + 3000。
    const prices = new Map([["S", 30]]);
    const positions = p.snapshotPositionsAt(prices);
    expect(positions[0]!.marketValue).toBe(3000);
    const equity = p.equityAt(prices);
    const mv = positions.reduce((s, pos) => s + pos.marketValue, 0);
    expect(equity).toBeCloseTo(p.cash + mv, 6);
  });
});

// ---------------------------------------------------------------------------
// P2-F2：CashPolicy 滑点口径与执行层一致
// ---------------------------------------------------------------------------

describe("P2-F2 CashPolicy 滑点口径", () => {
  it("slippedBuyPriceAdjusted 按参考成交额做流动性分层，与 base 滑点区分", () => {
    expect(slippedBuyPrice(10, COST)).toBeCloseTo(10.01, 4);
    // referenceAmount=500 千元（<1 亿）→ +20bp → 30bp → 10.03
    expect(slippedBuyPriceAdjusted(10, COST, 500)).toBeCloseTo(10.03, 4);
    // 无参考成交额 → 回落 base 滑点 → 10.01
    expect(slippedBuyPriceAdjusted(10, COST, null)).toBeCloseTo(10.01, 4);
  });

  it("CashPolicy 用 amount-adjusted 滑点，不再高估可成交数量", () => {
    const policy = new CashPolicy();
    // cash=10020，price=10，requested=1000。
    // 修复前（base 10.01）：1000 股成本 10010 + 5.10 = 10015.10 ≤ 10020 → APPROVE 1000
    // 修复后（adjusted 10.03）：1000 股成本 10030 + 5.10 = 10035.10 > 10020 → 只能买 900 股
    const r = policy.check(intent({ requestedQuantity: 1000 }), ctx({ cash: 10020, availableCash: 10020, referenceAmount: 500 }));
    expect(r.kind).toBe("RESIZE");
    expect(r.approvedQuantity).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// P2-F3：风险层默认启用 + Strategy 桥接固化
// ---------------------------------------------------------------------------

describe("P2-F3 风险层统一入口", () => {
  it("buildDefaultRiskManager 从 config 对齐构建（maxPositions 生效）", () => {
    const mgr = buildDefaultRiskManager(cfg({ maxPositions: 1 }));
    const r = mgr.check(intent({ requestedQuantity: 100 }), ctx({ openPositionCount: 1, positions: [{ symbol: "B", quantity: 100, marketValue: 1000 }] }));
    expect(r.kind).toBe("REJECT");
    expect(r.violations[0]!.code).toBe("MAX_POSITIONS_EXCEEDED");
  });

  it("buildDefaultRiskManager 对齐容量约束（maxPositionAmountRatio）", () => {
    const mgr = buildDefaultRiskManager(cfg({ maxPositionAmountRatio: 0.1 }));
    // referenceAmount=200 千元 → 容量 20000 元 → 2000 股
    const r = mgr.check(intent({ requestedQuantity: 5000 }), ctx({ referenceAmount: 200 }));
    expect(r.kind).toBe("RESIZE");
    expect(r.approvedQuantity).toBe(2000);
  });

  it("runBacktestWithRisk 默认注入 RiskManager，产生可解释的 riskDecisions", () => {
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([["S", bar("T1", null, 10, 9.5, 500_000)]]));
    bars.set("T2", new Map([["S", bar("T2", 10, 10.5, 10, 500_000)]]));
    const result = runBacktestWithRisk({
      config: cfg(),
      tradingDates: ["T1", "T2"],
      barsByDate: bars,
      signalProvider: (d) => (d === "T1" ? [{ symbol: "S", side: "buy", quantity: 100, signalTime: d }] : []),
    });
    const rd = (result as unknown as { riskDecisions?: { decision: string; approvedQuantity: number; violations: { code: string }[] }[] }).riskDecisions;
    expect(rd).toHaveLength(1);
    expect(rd![0]!.decision).toBe("APPROVE");
    expect(rd![0]!.approvedQuantity).toBe(100);
  });

  it("runBacktestWithRisk 缺省 manager 会执行容量/资金约束（不静默绕过风险层）", () => {
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([["S", bar("T1", null, 10, 9.5, 500_000)]]));
    bars.set("T2", new Map([["S", bar("T2", 10, 10.5, 10, 500_000)]]));
    // 现金只够 400 股（initialCapital=5000）
    const result = runBacktestWithRisk({
      config: cfg({ initialCapital: 5000 }),
      tradingDates: ["T1", "T2"],
      barsByDate: bars,
      signalProvider: (d) => (d === "T1" ? [{ symbol: "S", side: "buy", quantity: 1000, signalTime: d }] : []),
    });
    const rd = (result as unknown as { riskDecisions?: { decision: string; approvedQuantity: number; violations: { code: string }[] }[] }).riskDecisions;
    expect(rd![0]!.decision).toBe("RESIZE");
    expect(rd![0]!.approvedQuantity).toBe(400);
    expect(result.trades[0]!.quantity).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// buildRiskContext 快照口径辅助（确认 portfolioExposure 与 positions 一致）
// ---------------------------------------------------------------------------

describe("buildRiskContext 快照口径", () => {
  it("positions 按传入价格估值，portfolioExposure 与之同源", () => {
    const c = buildRiskContext({
      timestamp: "T3",
      equity: 101_000,
      cash: 98_000,
      availableCash: 98_000,
      positions: [{ symbol: "S", quantity: 100, marketValue: 3000 }],
      symbol: "X",
      marketPrice: 20,
      referenceAmount: null,
      cost: COST,
    });
    expect(c.portfolioExposure).toBeCloseTo(3000 / 101_000, 6);
  });
});

// ---------------------------------------------------------------------------
// P3-F5 同 symbol 加仓：风险层与 Portfolio 行为对齐
// ---------------------------------------------------------------------------

describe("P3-F5 同 symbol 加仓语义对齐", () => {
  it("Policy 层：MaxPositionsPolicy 对已持仓 symbol 的 BUY 返回 ADD_POSITION_NOT_SUPPORTED", () => {
    const policy = new MaxPositionsPolicy(5);
    const r = policy.check(
      intent({ symbol: "S", requestedQuantity: 100 }),
      ctx({ openPositionCount: 1, positions: [{ symbol: "S", quantity: 100, marketValue: 1000 }] }),
    );
    expect(r.kind).toBe("REJECT");
    expect(r.approvedQuantity).toBe(0);
    expect(r.violations[0]!.code).toBe("ADD_POSITION_NOT_SUPPORTED");
    expect(r.violations[0]!.policy).toBe("max-positions");
  });

  it("Policy 层：加仓拦截优先于开仓数上限检查（同 symbol + 持仓数满 → 仍报 ADD_POSITION_NOT_SUPPORTED）", () => {
    const policy = new MaxPositionsPolicy(1);
    const r = policy.check(
      intent({ symbol: "S", requestedQuantity: 100 }),
      ctx({ openPositionCount: 1, positions: [{ symbol: "S", quantity: 100, marketValue: 1000 }] }),
    );
    expect(r.kind).toBe("REJECT");
    expect(r.violations[0]!.code).toBe("ADD_POSITION_NOT_SUPPORTED");
  });

  it("集成层：同 symbol 加仓 → 风险 REJECT 且最终无成交，风险层与 Portfolio 兜底一致", () => {
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([
      ["S", bar("T1", null, 10, 9.5, 500_000)],
      ["X", bar("T1", null, 10, 9.5, 500_000)],
    ]));
    bars.set("T2", new Map([
      ["S", bar("T2", 10, 11, 10, 500_000)],
      ["X", bar("T2", 10, 11, 10, 500_000)],
    ]));
    bars.set("T3", new Map([
      ["S", bar("T3", 12, 12, 11, 500_000)],
      ["X", bar("X", 12, 12, 11, 500_000)],
    ]));
    // T1 建仓 S、T2 收盘后再发 S 加仓信号 → T3 开盘应被 MaxPositionsPolicy REJECT。
    const result = runBacktest({
      config: cfg({ endDate: "T3", maxPositions: 5 }),
      tradingDates: ["T1", "T2", "T3"],
      barsByDate: bars,
      signalProvider: (d) => {
        if (d === "T1") return [{ symbol: "S", side: "buy", quantity: 100, signalTime: d }];
        if (d === "T2") return [{ symbol: "S", side: "buy", quantity: 200, signalTime: d }]; // 同 symbol 加仓
        return [];
      },
      risk: { manager: composeRiskManager([new LotSizePolicy(), new MaxPositionsPolicy(5), new CashPolicy()]) },
    });

    // 仅 T1 一笔成交（T2 的加仓被风险层 REJECT），追溯链完整记录。
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.symbol).toBe("S");
    expect(result.trades[0]!.quantity).toBe(100);

    const rd = (result as unknown as { riskDecisions?: { symbol: string; decision: string; approvedQuantity: number; violations: { code: string }[] }[] }).riskDecisions ?? [];
    // 2 条 riskDecision：T1 建仓 APPROVE + T2 加仓 REJECT（ADD_POSITION_NOT_SUPPORTED）
    expect(rd).toHaveLength(2);
    const addAttempt = rd.find((r) => r.symbol === "S" && r.decision === "REJECT");
    expect(addAttempt).toBeDefined();
    expect(addAttempt!.approvedQuantity).toBe(0);
    expect(addAttempt!.violations[0]!.code).toBe("ADD_POSITION_NOT_SUPPORTED");

    // 期末 S 持仓仍是 T1 建仓的 100 股（加仓被拦截）。
    expect(result.finalPortfolio.positions.find((p) => p.symbol === "S")?.quantity).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// P3-F4 命名错位修复：CapacityPolicy 与 CAPACITY_EXCEEDED violation code
// ---------------------------------------------------------------------------

describe("P3-F4 CapacityPolicy 命名修复", () => {
  it("类名 CapacityPolicy 已替换 MaxPositionExposurePolicy，name=\"capacity\"", () => {
    const policy = new CapacityPolicy(0.1);
    expect(policy.name).toBe("capacity");
  });

  it("所有 violation 统一使用 CAPACITY_EXCEEDED（含 REJECT 与 RESIZE 两个分支）", () => {
    // 容量不足一手 → REJECT
    const rej = new CapacityPolicy(0.1).check(intent({ requestedQuantity: 100 }), ctx({ referenceAmount: 5 }));
    expect(rej.kind).toBe("REJECT");
    expect(rej.violations[0]!.code).toBe("CAPACITY_EXCEEDED");

    // 容量超限 → RESIZE
    const resize = new CapacityPolicy(0.1).check(intent({ requestedQuantity: 5000 }), ctx({ referenceAmount: 200 }));
    expect(resize.kind).toBe("RESIZE");
    expect(resize.violations[0]!.code).toBe("CAPACITY_EXCEEDED");
  });

  it("容量约束与敞口约束语义清晰分离（capacity/symbol-exposure/portfolio-exposure 互不混用）", () => {
    // CapacityPolicy name = "capacity" → 限流动性
    expect(new CapacityPolicy(0.1).name).toBe("capacity");
    // MaxSymbolExposurePolicy name = "max-symbol-exposure" → 限单标的市值占比
    expect(new MaxSymbolExposurePolicy(0.2).name).toBe("max-symbol-exposure");
    // MaxPortfolioExposurePolicy name = "max-portfolio-exposure" → 限组合总市值占比
    expect(new MaxPortfolioExposurePolicy(0.5).name).toBe("max-portfolio-exposure");
  });
});
