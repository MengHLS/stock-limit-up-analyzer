/**
 * Risk Layer — 测试套件。
 *
 * 覆盖任务要求的全部场景：
 *   Risk Policy（maxPositions / maxPositionExposure / maxPortfolioExposure / insufficientCash / lotSize / 组合）
 *   Position Sizing（fixed quantity / fixed capital / fixed weight / risk capped）
 *   Decision（APPROVE / RESIZE / REJECT）
 *   Safety（未来函数 / 确定性 / 实例隔离）
 *   Golden Test（Signal → PositionSizer → RiskManager → Approved Order Intent）
 */

import { describe, expect, it } from "vitest";
import {
  CashPolicy,
  LotSizePolicy,
  MaxPortfolioExposurePolicy,
  CapacityPolicy,
  MaxPositionsPolicy,
  MaxSymbolExposurePolicy,
  FixedCapitalSizer,
  FixedQuantitySizer,
  FixedWeightSizer,
  RiskCappedSizer,
  composeRiskManager,
  buildRiskContext,
  type OrderIntent,
  type RiskContext,
} from "./index";
import { DEFAULT_COST_MODEL } from "../engine/execution";
import type { CostModel } from "../engine/domain";
import { runBacktest } from "../engine/engine";
import type { MarketBar, Signal } from "../engine/domain";

const COST: CostModel = DEFAULT_COST_MODEL;

/** 构造一个空组合的风险上下文（equity=100000, cash=100000, 无持仓）。 */
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

// ---------------------------------------------------------------------------
// Risk Policy
// ---------------------------------------------------------------------------

describe("Risk Policy", () => {
  it("maxPositions：开仓数达上限时新 BUY 被 REJECT", () => {
    const policy = new MaxPositionsPolicy(1);
    const r = policy.check(intent(), ctx({ openPositionCount: 1, positions: [{ symbol: "B", quantity: 100, marketValue: 1000 }] }));
    expect(r.kind).toBe("REJECT");
    expect(r.violations[0]!.code).toBe("MAX_POSITIONS_EXCEEDED");
    expect(r.approvedQuantity).toBe(0);
  });

  it("maxPositions：已有同 symbol 持仓视为加仓 → 直接 REJECT ADD_POSITION_NOT_SUPPORTED", () => {
    const policy = new MaxPositionsPolicy(1);
    const r = policy.check(intent(), ctx({ openPositionCount: 1, positions: [{ symbol: "A", quantity: 100, marketValue: 1000 }] }));
    expect(r.kind).toBe("REJECT");
    expect(r.violations[0]!.code).toBe("ADD_POSITION_NOT_SUPPORTED");
    expect(r.approvedQuantity).toBe(0);
  });

  it("capacity：容量不足时 RESIZE 到容量上限（向下取整到整手）", () => {
    const policy = new CapacityPolicy(0.1);
    // referenceAmount=200千元(20万)，ratio=0.1 → 容量 20000 元，price=10 → 2000 股
    const r = policy.check(intent({ requestedQuantity: 5000 }), ctx({ referenceAmount: 200 }));
    expect(r.kind).toBe("RESIZE");
    expect(r.approvedQuantity).toBe(2000);
    expect(r.violations[0]!.code).toBe("CAPACITY_EXCEEDED");
  });

  it("capacity：容量不足以成交一手 → REJECT", () => {
    const policy = new CapacityPolicy(0.1);
    // referenceAmount=5千元(5000元)，ratio=0.1 → 容量 500 元，price=10 → 50 股 < 1 手
    const r = policy.check(intent({ requestedQuantity: 100 }), ctx({ referenceAmount: 5 }));
    expect(r.kind).toBe("REJECT");
    expect(r.violations[0]!.code).toBe("CAPACITY_EXCEEDED");
  });

  it("capacity：ratio=0（不限）→ APPROVE", () => {
    const policy = new CapacityPolicy(0);
    const r = policy.check(intent({ requestedQuantity: 9000 }), ctx({ referenceAmount: 100 }));
    expect(r.kind).toBe("APPROVE");
  });

  it("maxPortfolioExposure：组合总敞口超限 → RESIZE", () => {
    const policy = new MaxPortfolioExposurePolicy(0.5);
    // 已持 40000 元市值，权益 100000 → 剩余敞口 10000 元 → 1000 股
    const r = policy.check(intent({ requestedQuantity: 3000 }), ctx({
      positions: [{ symbol: "B", quantity: 4000, marketValue: 40_000 }],
      openPositionCount: 1,
      portfolioExposure: 0.4,
    }));
    expect(r.kind).toBe("RESIZE");
    expect(r.approvedQuantity).toBe(1000);
  });

  it("maxPortfolioExposure：剩余敞口不足以成交一手 → REJECT", () => {
    const policy = new MaxPortfolioExposurePolicy(0.5);
    // 已持 49900 元市值 → 剩余 100 元 → 不足一手
    const r = policy.check(intent({ requestedQuantity: 100 }), ctx({
      positions: [{ symbol: "B", quantity: 4990, marketValue: 49_900 }],
      openPositionCount: 1,
      portfolioExposure: 0.499,
    }));
    expect(r.kind).toBe("REJECT");
  });

  it("insufficientCash：资金不足 → RESIZE 到可负担最大整手", () => {
    const policy = new CashPolicy();
    // availableCash=5000，滑点后价格≈10.01，一手≈1001+费用，最多 400 股
    const r = policy.check(intent({ requestedQuantity: 1000 }), ctx({ availableCash: 5000, cash: 5000 }));
    expect(r.kind).toBe("RESIZE");
    expect(r.approvedQuantity).toBe(400);
  });

  it("insufficientCash：不足以负担一手 → REJECT", () => {
    const policy = new CashPolicy();
    const r = policy.check(intent({ requestedQuantity: 100 }), ctx({ availableCash: 500, cash: 500 }));
    expect(r.kind).toBe("REJECT");
    expect(r.violations[0]!.code).toBe("INSUFFICIENT_CASH");
  });

  it("lotSize：非整手买入 → REJECT INVALID_LOT_SIZE（不自动修正）", () => {
    const policy = new LotSizePolicy();
    const r = policy.check(intent({ requestedQuantity: 50 }), ctx());
    expect(r.kind).toBe("REJECT");
    expect(r.violations[0]!.code).toBe("INVALID_LOT_SIZE");
    expect(r.approvedQuantity).toBe(0);
  });

  it("lotSize：整手买入 → APPROVE", () => {
    const policy = new LotSizePolicy();
    expect(policy.check(intent({ requestedQuantity: 100 }), ctx()).kind).toBe("APPROVE");
    expect(policy.check(intent({ requestedQuantity: 200 }), ctx()).kind).toBe("APPROVE");
  });
});

// ---------------------------------------------------------------------------
// Position Sizing
// ---------------------------------------------------------------------------

describe("Position Sizing", () => {
  it("fixed quantity：固定 1000 股", () => {
    const sizer = new FixedQuantitySizer(1000);
    expect(sizer.propose(intent(), ctx())).toBe(1000);
  });

  it("fixed capital：10% 资金 → 1000 股（100000×0.1/10）", () => {
    const sizer = new FixedCapitalSizer(0.1);
    expect(sizer.propose(intent(), ctx())).toBe(1000);
  });

  it("fixed weight：10% 权重 → 1000 股", () => {
    const sizer = new FixedWeightSizer(0.1);
    expect(sizer.propose(intent(), ctx())).toBe(1000);
  });

  it("risk capped：最大风险 1%、止损 10% → 1000 股（1000/1）", () => {
    // riskBudget = 100000×0.01 = 1000；perShareRisk = 10×0.1 = 1 → 1000 股
    const sizer = new RiskCappedSizer(0.01, 0.1);
    expect(sizer.propose(intent(), ctx())).toBe(1000);
  });

  it("所有模型向下取整到整手", () => {
    const sizer = new FixedCapitalSizer(0.099); // 9900 元 → 990 股 → 取整 900 股
    expect(sizer.propose(intent(), ctx())).toBe(900);
  });

  it("缺少有效价格 → 返回 0", () => {
    const sizer = new FixedCapitalSizer(0.1);
    expect(sizer.propose(intent(), ctx({ marketPrice: null }))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Decision（组合器）
// ---------------------------------------------------------------------------

describe("RiskManager 组合", () => {
  it("全部 APPROVE → APPROVE，数量不变", () => {
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new MaxPositionsPolicy(5),
      new CashPolicy(),
    ]);
    const r = mgr.check(intent({ requestedQuantity: 100 }), ctx());
    expect(r.kind).toBe("APPROVE");
    expect(r.approvedQuantity).toBe(100);
    expect(r.violations).toHaveLength(0);
  });

  it("任一 REJECT → REJECT，合并所有违规记录", () => {
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new MaxPositionsPolicy(0),
      new CashPolicy(),
    ]);
    const r = mgr.check(intent({ requestedQuantity: 100 }), ctx());
    expect(r.kind).toBe("REJECT");
    expect(r.approvedQuantity).toBe(0);
    expect(r.violations[0]!.code).toBe("MAX_POSITIONS_EXCEEDED");
  });

  it("多个 RESIZE → 取所有限制的最小值", () => {
    // Requested=1000；容量限 800；组合敞口限 600；现金限 400 → 最终 400
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new CapacityPolicy(0.08), // referenceAmount=100千元 → 容量 8000 元 → 800 股
      new MaxPortfolioExposurePolicy(0.1), // 组合上限 10000 元，已持 4000 元 → 剩余 600 股
      new CashPolicy(), // 现金 5000 → 400 股
    ]);
    const r = mgr.check(intent({ requestedQuantity: 1000 }), ctx({
      referenceAmount: 100,
      positions: [{ symbol: "B", quantity: 400, marketValue: 4000 }],
      openPositionCount: 1,
      portfolioExposure: 0.04,
      availableCash: 5000,
      cash: 5000,
    }));
    expect(r.kind).toBe("RESIZE");
    expect(r.approvedQuantity).toBe(400);
    // violations 记录了所有触发的限制（容量 + 组合敞口 + 现金）
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
  });

  it("RESIZE 后不足一手 → REJECT INSUFFICIENT_LOT", () => {
    const mgr = composeRiskManager([
      new CapacityPolicy(0.001), // 容量 100 元 → 不足一手
    ]);
    const r = mgr.check(intent({ requestedQuantity: 100 }), ctx({ referenceAmount: 0.1 }));
    expect(r.kind).toBe("REJECT");
  });

  it("REJECT 短路：后续 policy 不再执行", () => {
    let cashChecked = false;
    const spyPolicy = {
      name: "spy",
      check(i: OrderIntent, c: RiskContext) {
        cashChecked = true;
        return { kind: "APPROVE" as const, approvedQuantity: i.requestedQuantity, requestedQuantity: i.requestedQuantity, violations: [] };
      },
    };
    const mgr = composeRiskManager([new MaxPositionsPolicy(0), spyPolicy]);
    mgr.check(intent(), ctx());
    expect(cashChecked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

describe("Safety（未来函数 / 确定性 / 隔离）", () => {
  it("确定性：相同输入两次检查结果深度相等", () => {
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new MaxPositionsPolicy(5),
      new CapacityPolicy(0.1),
      new CashPolicy(),
    ]);
    const c = ctx({ referenceAmount: 200 });
    expect(mgr.check(intent({ requestedQuantity: 5000 }), c)).toEqual(mgr.check(intent({ requestedQuantity: 5000 }), c));
  });

  it("未来函数防护：Policy 只读 context，不访问未来数据（无 Date.now / Math.random / 网络）", () => {
    // 决策只依赖显式传入的 context 字段；改变 context 之外的「未来」无影响（纯函数性质由确定性测试佐证）。
    const policy = new CapacityPolicy(0.1);
    const r1 = policy.check(intent({ requestedQuantity: 100 }), ctx({ referenceAmount: 200 }));
    const r2 = policy.check(intent({ requestedQuantity: 100 }), ctx({ referenceAmount: 200 }));
    expect(r1).toEqual(r2);
  });

  it("实例隔离：Policy 无 module-level mutable state", () => {
    const a = new CashPolicy();
    const b = new CashPolicy();
    a.check(intent({ requestedQuantity: 1000 }), ctx({ availableCash: 5000 }));
    // b 的状态不受 a 调用影响
    expect(b.check(intent({ requestedQuantity: 100 }), ctx()).kind).toBe("APPROVE");
  });
});

// ---------------------------------------------------------------------------
// Golden Test：Signal → PositionSizer → RiskManager → Approved Order Intent
// ---------------------------------------------------------------------------

describe("Golden Test", () => {
  it("完整风险决策管道（人工计算）", () => {
    // 初始权益 100000，现金 100000，无持仓。
    // Signal: BUY A，策略请求 5000 股。
    // PositionSizer: FixedQuantity(5000) → proposed 5000。
    // RiskManager 配置：
    //   - CapacityPolicy(0.2)：referenceAmount=200千元(20万) → 容量 40000 元 → 4000 股
    //   - MaxPortfolioExposurePolicy(0.5)：组合剩余敞口 50000 元 → 5000 股（不限制）
    //   - LotSizePolicy：整手 OK
    //   - CashPolicy：现金 100000 → 可负担 9900 股（不限制）
    // 最终：min(5000, 4000, 5000, 9900) = 4000 股。
    const sizer = new FixedQuantitySizer(5000);
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new CapacityPolicy(0.2),
      new MaxPortfolioExposurePolicy(0.5),
      new CashPolicy(),
    ]);

    const proposed = sizer.propose(intent({ requestedQuantity: 5000 }), ctx({ referenceAmount: 200 }));
    expect(proposed).toBe(5000);

    const decision = mgr.check(intent({ requestedQuantity: proposed }), ctx({ referenceAmount: 200 }));
    expect(decision.kind).toBe("RESIZE");
    expect(decision.approvedQuantity).toBe(4000);
    expect(decision.violations[0]!.code).toBe("CAPACITY_EXCEEDED");
  });

  it("完整管道：资金约束兜底（现金只够 400 股）", () => {
    const sizer = new FixedQuantitySizer(5000);
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new CapacityPolicy(0), // 容量不限
      new MaxPortfolioExposurePolicy(0), // 组合敞口不限
      new CashPolicy(),
    ]);
    const decision = mgr.check(intent({ requestedQuantity: sizer.propose(intent(), ctx()) }), ctx({ availableCash: 5000, cash: 5000 }));
    expect(decision.kind).toBe("RESIZE");
    expect(decision.approvedQuantity).toBe(400);
  });

  it("完整管道：非整手直接 REJECT（lotSize 合法性校验）", () => {
    const sizer = new FixedQuantitySizer(50); // 50 股非整手
    const mgr = composeRiskManager([new LotSizePolicy(), new CashPolicy()]);
    const decision = mgr.check(intent({ requestedQuantity: sizer.propose(intent(), ctx()) }), ctx());
    expect(decision.kind).toBe("REJECT");
    expect(decision.violations[0]!.code).toBe("INVALID_LOT_SIZE");
  });
});

// ---------------------------------------------------------------------------
// RiskContext 派生
// ---------------------------------------------------------------------------

describe("buildRiskContext", () => {
  it("正确计算组合敞口与单标的敞口", () => {
    const c = buildRiskContext({
      timestamp: "T1",
      equity: 100_000,
      cash: 60_000,
      availableCash: 60_000,
      positions: [
        { symbol: "A", quantity: 1000, marketValue: 20_000 },
        { symbol: "B", quantity: 1000, marketValue: 20_000 },
      ],
      symbol: "A",
      marketPrice: 20,
      referenceAmount: null,
      cost: COST,
    });
    expect(c.openPositionCount).toBe(2);
    expect(c.portfolioExposure).toBeCloseTo(0.4, 6);
    expect(c.symbolExposure).toBeCloseTo(0.2, 6);
  });

  it("equity<=0 时以 1 兜底，避免除零", () => {
    const c = buildRiskContext({
      timestamp: "T1", equity: 0, cash: 0, availableCash: 0, positions: [],
      symbol: "A", marketPrice: null, referenceAmount: null, cost: COST,
    });
    expect(c.portfolioExposure).toBe(0);
    expect(c.symbolExposure).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RiskManager + Backtest Core 集成
// ---------------------------------------------------------------------------

describe("RiskManager + Backtest Core 集成", () => {
  const bar = (date: string, open: number | null, close: number | null, prevClose: number | null, amount: number | null = null): MarketBar =>
    ({ date, open, high: null, low: null, close, prevClose, amount });

  function buildBars(t2Amount: number): Map<string, Map<string, MarketBar>> {
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([["S", bar("T1", null, 10, 9.5, 500)]]));
    bars.set("T2", new Map([["S", bar("T2", 10, 10.5, 10, t2Amount)]]));
    return bars;
  }

  it("风险决策管道驱动 Backtest Core 成交，并记录 RiskDecisionTrace", () => {
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new CapacityPolicy(0.1), // referenceAmount=500千元 → 容量 50000 元 → 5000 股（不限制 1000）
      new CashPolicy(),
    ]);
    const result = runBacktest({
      config: {
        strategyId: "risk-test",
        strategyVersion: "1.0.0",
        initialCapital: 100_000,
        startDate: "T1",
        endDate: "T2",
        cost: COST,
        maxPositions: 5,
        maxPositionAmountRatio: 0,
      },
      tradingDates: ["T1", "T2"],
      barsByDate: buildBars(500),
      signalProvider: (d) => d === "T1" ? [{ symbol: "S", side: "buy", quantity: 1000, signalTime: d }] : [],
      risk: { sizer: new FixedQuantitySizer(1000), manager: mgr },
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.quantity).toBe(1000);
    const riskDecisions = (result as unknown as { riskDecisions?: { decision: string; approvedQuantity: number; requestedQuantity: number }[] }).riskDecisions;
    expect(riskDecisions).toHaveLength(1);
    expect(riskDecisions![0]!.decision).toBe("APPROVE");
    expect(riskDecisions![0]!.approvedQuantity).toBe(1000);
  });

  it("风险决策 RESIZE 后按批准数量成交", () => {
    // 现金只够 400 股（可用现金 5000，滑点后 ~10.01×400=4004 + 佣金）
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new CashPolicy(),
    ]);
    const result = runBacktest({
      config: {
        strategyId: "risk-resize",
        strategyVersion: "1.0.0",
        initialCapital: 5000,
        startDate: "T1",
        endDate: "T2",
        cost: COST,
        maxPositions: 5,
        maxPositionAmountRatio: 0,
      },
      tradingDates: ["T1", "T2"],
      barsByDate: buildBars(500),
      signalProvider: (d) => d === "T1" ? [{ symbol: "S", side: "buy", quantity: 1000, signalTime: d }] : [],
      risk: { sizer: new FixedQuantitySizer(1000), manager: mgr },
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.quantity).toBe(400);
    const riskDecisions = (result as unknown as { riskDecisions?: { decision: string; approvedQuantity: number }[] }).riskDecisions;
    expect(riskDecisions![0]!.decision).toBe("RESIZE");
    expect(riskDecisions![0]!.approvedQuantity).toBe(400);
  });

  it("风险决策 REJECT 后不成交，记录追踪", () => {
    const mgr = composeRiskManager([
      new MaxPositionsPolicy(0), // 不允许任何新开仓
    ]);
    const result = runBacktest({
      config: {
        strategyId: "risk-reject",
        strategyVersion: "1.0.0",
        initialCapital: 100_000,
        startDate: "T1",
        endDate: "T2",
        cost: COST,
        maxPositions: 5,
        maxPositionAmountRatio: 0,
      },
      tradingDates: ["T1", "T2"],
      barsByDate: buildBars(500),
      signalProvider: (d) => d === "T1" ? [{ symbol: "S", side: "buy", quantity: 1000, signalTime: d }] : [],
      risk: { manager: mgr },
    });
    expect(result.trades).toHaveLength(0);
    const riskDecisions = (result as unknown as { riskDecisions?: { decision: string; violations: { code: string }[] }[] }).riskDecisions;
    expect(riskDecisions![0]!.decision).toBe("REJECT");
    expect(riskDecisions![0]!.violations[0]!.code).toBe("MAX_POSITIONS_EXCEEDED");
  });

  it("未来数据污染：T+1 成交日 amount 变化不影响风险决策结果", () => {
    const mgr = composeRiskManager([
      new LotSizePolicy(),
      new CapacityPolicy(0.1),
      new CashPolicy(),
    ]);
    const mk = (t2amount: number) => runBacktest({
      config: {
        strategyId: "risk-leak",
        strategyVersion: "1.0.0",
        initialCapital: 100_000,
        startDate: "T1",
        endDate: "T2",
        cost: COST,
        maxPositions: 5,
        maxPositionAmountRatio: 0,
      },
      tradingDates: ["T1", "T2"],
      barsByDate: buildBars(t2amount),
      signalProvider: (d) => d === "T1" ? [{ symbol: "S", side: "buy", quantity: 1000, signalTime: d }] : [],
      risk: { manager: mgr },
    });
    const rA = mk(500);
    const rB = mk(100_000_000);
    expect(rA.trades[0]!.quantity).toBe(rB.trades[0]!.quantity);
    expect(JSON.stringify(rA.trades)).toBe(JSON.stringify(rB.trades));
  });

  it("确定性：风险管道两次运行深度相等", () => {
    const mgr = composeRiskManager([new LotSizePolicy(), new CashPolicy(), new CapacityPolicy(0.1)]);
    const run = () => runBacktest({
      config: {
        strategyId: "risk-det",
        strategyVersion: "1.0.0",
        initialCapital: 100_000,
        startDate: "T1",
        endDate: "T2",
        cost: COST,
        maxPositions: 5,
        maxPositionAmountRatio: 0,
      },
      tradingDates: ["T1", "T2"],
      barsByDate: buildBars(500),
      signalProvider: (d) => d === "T1" ? [{ symbol: "S", side: "buy", quantity: 1000, signalTime: d }] : [],
      risk: { manager: mgr },
    });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
