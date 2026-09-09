/**
 * STEP 23 / C-23.1 — 模拟账户与持仓：单测。
 *
 * 覆盖：账户状态机（开仓/加仓/减仓/清仓/T+1 冻结解冻/现金与冻结资金守恒/权益手算）、
 * 订单→成交约束检查（100 整数倍/涨跌停拒单/资金不足拒单/费用五维分解）、六维贴近实盘
 * 关键断言、确定性（同输入深比较）、round-trip 与篡改拒绝、退化输入、与 C-14.3 约束
 * 映射的复用对照。
 */

import { describe, expect, it } from "vitest";
import type { Side } from "../../backtest/types";
import {
  A_SHARE_DEFAULT_COST_DECLARATION,
  computeFillCostBreakdown,
} from "../costModel";
import type { CostModelDeclaration } from "../costModel/types";
import {
  createExecutionConstraintDeclaration,
  describeExecutionConstraintCoverage,
  DEFAULT_LOT_SIZE,
} from "../executionConstraints";
import type { ExecutionConstraintDeclaration } from "../executionConstraints/types";
import {
  applyPaperBuyFill,
  applyPaperSellFill,
  assertValidPaperAccount,
  createPaperAccount,
  freezePaperCash,
  markPaperAccountToMarket,
  settlePaperAccountT1,
  snapshotPaperAccount,
  unfreezePaperCash,
} from "./account";
import {
  checkPaperOrder,
  describePaperAccountConstraintEnforcement,
} from "./constraints";
import { PAPER_ACCOUNT_ERROR_CODES, PaperAccountError } from "./errors";
import {
  assemblePaperAccountRun,
  computePaperPnlBreakdown,
  toTradeQualityEvaluationInput,
} from "./run";
import {
  deserializePaperAccountRun,
  serializePaperAccountRun,
} from "./serialize";
import type {
  PaperAccount,
  PaperAccountFill,
  PaperAccountOrder,
} from "./types";

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

/** 零费用成本声明（方便账户状态机手算）。 */
function zeroCostDeclaration(): CostModelDeclaration {
  return {
    name: "ZERO",
    commissionRate: 0,
    stampDutyRate: 0,
    transferFeeRate: 0,
    slippageBps: 0,
    lotSize: 100,
    minCommission: 0,
    marketImpact: {
      enabled: false,
      coefficient: 40,
      exponent: 0.5,
      maxBps: 200,
      maxParticipation: 1,
    },
  };
}

/** 默认执行约束声明（无风险约束，便于逐项覆盖）。 */
function baseDeclaration(overrides?: Partial<Parameters<typeof createExecutionConstraintDeclaration>[0]>): ExecutionConstraintDeclaration {
  return createExecutionConstraintDeclaration({
    initialCapital: 100000,
    ...overrides,
  });
}

/** 构造成交（复用 C-14.2 computeFillCostBreakdown 算五维成本）。 */
function makeFill(
  costDeclaration: CostModelDeclaration,
  overrides: {
    fillId?: string;
    orderId?: string;
    securityId?: string;
    side?: Side;
    quantity?: number;
    price?: number;
    basePrice?: number;
    timestamp?: string;
  } = {}
): PaperAccountFill {
  const side = overrides.side ?? "buy";
  const quantity = overrides.quantity ?? 100;
  const price = overrides.price ?? 10;
  const basePrice = overrides.basePrice ?? price;
  const cost = computeFillCostBreakdown({
    side,
    price,
    basePrice,
    quantity,
    referenceAmountKqian: null,
    declaration: costDeclaration,
  });
  return {
    fillId: overrides.fillId ?? "f",
    orderId: overrides.orderId ?? "o",
    securityId: overrides.securityId ?? "S",
    side,
    quantity,
    price,
    basePrice,
    timestamp: overrides.timestamp ?? "2024-01-02",
    cost,
    constraintHits: { enforced: [], recordedOnly: [] },
  };
}

/** 构造订单。 */
function makeOrder(overrides: Partial<PaperAccountOrder> = {}): PaperAccountOrder {
  return {
    orderId: "o1",
    securityId: "S",
    side: "buy",
    quantity: 100,
    orderType: "market",
    requestedPrice: null,
    tradeDate: "2024-01-01",
    executionTime: "2024-01-02",
    status: "SUBMITTED",
    createdAt: "2024-01-01",
    ...overrides,
  };
}

const zero = zeroCostDeclaration();

// ---------------------------------------------------------------------------
// A. 账户状态机
// ---------------------------------------------------------------------------

describe("账户状态机：开仓 / 加仓 / 减仓 / 清仓 / T+1 / 现金守恒", () => {
  it("创建空账户：cash=initialCapital、frozen=0、equity=initialCapital、空持仓", () => {
    const account = createPaperAccount({
      accountId: "A",
      initialCapital: 100000,
      asOf: "2024-01-01",
    });
    expect(account.cash).toBe(100000);
    expect(account.frozen).toBe(0);
    expect(account.equity).toBe(100000);
    expect(account.positions).toEqual([]);
    expect(account.realizedPnL).toBe(0);
  });

  it("初始资金非法（0/负/NaN）响亮抛错", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createPaperAccount({ accountId: "A", initialCapital: bad, asOf: "2024-01-01" })
      ).toThrowError(PaperAccountError);
    }
  });

  it("开仓：买入 100 股@10（零费用），现金减少 1000，持仓冻结=100 可卖=0", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const { account: next } = applyPaperBuyFill(
      account,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    );
    expect(next.cash).toBe(99000);
    expect(next.positions).toHaveLength(1);
    const p = next.positions[0]!;
    expect(p.quantity).toBe(100);
    expect(p.availableQuantity).toBe(0);
    expect(p.frozenQuantity).toBe(100);
    expect(p.averageEntryPrice).toBe(10);
    expect(next.realizedPnL).toBe(0);
  });

  it("T+1 解冻：settle 后 frozen 转为 available", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const bought = applyPaperBuyFill(
      account,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    ).account;
    const settled = settlePaperAccountT1(bought, "2024-01-03");
    const p = settled.positions[0]!;
    expect(p.availableQuantity).toBe(100);
    expect(p.frozenQuantity).toBe(0);
  });

  it("T+1 冻结拒卖：未解冻即卖出抛错", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const bought = applyPaperBuyFill(
      account,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    ).account;
    expect(() =>
      applyPaperSellFill(
        bought,
        makeFill(zero, { securityId: "S", side: "sell", quantity: 100, price: 11, timestamp: "2024-01-02" }),
        zero,
        "e2",
        "卖出"
      )
    ).toThrowError(PaperAccountError);
  });

  it("清仓：解冻后卖出，现金回收 + 已实现盈亏结转", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const bought = applyPaperBuyFill(
      account,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    ).account;
    const settled = settlePaperAccountT1(bought, "2024-01-03");
    const sold = applyPaperSellFill(
      settled,
      makeFill(zero, { securityId: "S", side: "sell", quantity: 100, price: 11, timestamp: "2024-01-03" }),
      zero,
      "e2",
      "卖出"
    ).account;
    expect(sold.cash).toBe(100100);
    expect(sold.positions).toHaveLength(0);
    expect(sold.realizedPnL).toBeCloseTo(100, 10);
  });

  it("加仓：两次买入后数量=200、均价加权、冻结累计", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const b1 = applyPaperBuyFill(
      account,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入1"
    ).account;
    const b2 = applyPaperBuyFill(
      b1,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 12, timestamp: "2024-01-02" }),
      zero,
      "e2",
      "买入2"
    ).account;
    const p = b2.positions[0]!;
    expect(p.quantity).toBe(200);
    expect(p.frozenQuantity).toBe(200);
    expect(p.averageEntryPrice).toBeCloseTo(11, 10);
    expect(p.totalCostBasis).toBeCloseTo(2200, 10);
  });

  it("减仓：部分卖出结转按比例已实现盈亏", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const b1 = applyPaperBuyFill(
      account,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入1"
    ).account;
    const b2 = applyPaperBuyFill(
      b1,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 12, timestamp: "2024-01-02" }),
      zero,
      "e2",
      "买入2"
    ).account;
    const settled = settlePaperAccountT1(b2, "2024-01-03");
    const sold = applyPaperSellFill(
      settled,
      makeFill(zero, { securityId: "S", side: "sell", quantity: 100, price: 13, timestamp: "2024-01-03" }),
      zero,
      "e3",
      "减仓"
    ).account;
    const p = sold.positions[0]!;
    expect(p.quantity).toBe(100);
    expect(p.availableQuantity).toBe(100);
    // realizedPnL = 13*100 - 2200*(100/200) = 1300 - 1100 = 200
    expect(sold.realizedPnL).toBeCloseTo(200, 10);
    expect(p.totalCostBasis).toBeCloseTo(1100, 10);
  });

  it("现金与冻结资金守恒：freeze/unfreeze 不改变权益", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const frozen = freezePaperCash(account, 30000, "e1", "2024-01-02", "冻结买入预留", "o1");
    expect(frozen.account.cash).toBe(70000);
    expect(frozen.account.frozen).toBe(30000);
    expect(frozen.account.equity).toBe(100000);
    const unfrozen = unfreezePaperCash(frozen.account, 30000, "e2", "2024-01-02", "解冻");
    expect(unfrozen.account.cash).toBe(100000);
    expect(unfrozen.account.frozen).toBe(0);
    expect(unfrozen.account.equity).toBe(100000);
  });

  it("冻结超过可用现金响亮抛错", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 1000, asOf: "2024-01-01" });
    expect(() =>
      freezePaperCash(account, 2000, "e1", "2024-01-02", "超额冻结")
    ).toThrowError(PaperAccountError);
  });

  it("权益计算手算：mark-to-market 后 equity = cash + frozen + marketValue", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const bought = applyPaperBuyFill(
      account,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    ).account;
    // 估值价 15：marketValue = 1500，equity = 99000 + 1500 = 100500
    const marked = markPaperAccountToMarket(bought, new Map([["S", 15]]), "2024-01-02");
    expect(marked.equity).toBeCloseTo(100500, 10);
    expect(marked.positions[0]!.marketValue).toBeCloseTo(1500, 10);
    expect(marked.positions[0]!.unrealizedPnL).toBeCloseTo(500, 10);
  });

  it("资金不足买入响亮抛错（负现金拒绝）", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 500, asOf: "2024-01-01" });
    expect(() =>
      applyPaperBuyFill(
        account,
        makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
        zero,
        "e1",
        "买入"
      )
    ).toThrowError(PaperAccountError);
  });

  it("非整手成交响亮抛错", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    expect(() =>
      applyPaperBuyFill(
        account,
        makeFill(zero, { securityId: "S", side: "buy", quantity: 150, price: 10, timestamp: "2024-01-02" }),
        zero,
        "e1",
        "买入"
      )
    ).toThrowError(PaperAccountError);
  });

  it("快照与不变量：空账户与单点持仓均可 snapshot + assert", () => {
    const empty = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    expect(() => assertValidPaperAccount(empty)).not.toThrow();
    const snap = snapshotPaperAccount(empty);
    expect(snap.equity).toBe(100000);
    expect(snap.positions).toEqual([]);

    const bought = applyPaperBuyFill(
      empty,
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    ).account;
    expect(() => assertValidPaperAccount(bought)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B. 订单 → 成交约束检查
// ---------------------------------------------------------------------------

describe("订单 → 成交约束检查", () => {
  const market = { open: 10, prevClose: 10 };
  const prices = new Map<string, number>([["S", 10]]);

  function freshAccount(): PaperAccount {
    return createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
  }

  it("100 整数倍：150 股被拒", () => {
    const result = checkPaperOrder({
      order: makeOrder({ quantity: 150 }),
      account: freshAccount(),
      declaration: baseDeclaration(),
      costDeclaration: zero,
      market,
      prices,
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.ORDER_QUANTITY_NOT_LOT);
  });

  it("资金不足拒单", () => {
    const result = checkPaperOrder({
      order: makeOrder({ quantity: 100 }),
      account: createPaperAccount({ accountId: "A", initialCapital: 50, asOf: "2024-01-01" }),
      declaration: baseDeclaration(),
      costDeclaration: zero,
      market: { open: 10, prevClose: 10 },
      prices,
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_INSUFFICIENT_CASH);
  });

  it("开盘涨停禁买拒单（blockLimitUpBuy）", () => {
    const result = checkPaperOrder({
      order: makeOrder({ side: "buy", quantity: 100 }),
      account: freshAccount(),
      declaration: baseDeclaration({ restrictions: { blockLimitUpBuy: true } }),
      costDeclaration: zero,
      market: { open: 11, prevClose: 10 }, // 11 >= 10*1.1 = 11 涨停
      prices,
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_LIMIT_UP);
  });

  it("开盘跌停禁卖拒单（blockLimitDownSell）", () => {
    // 需要先有持仓。
    const account = applyPaperBuyFill(
      freshAccount(),
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    ).account;
    const settled = settlePaperAccountT1(account, "2024-01-03");
    const result = checkPaperOrder({
      order: makeOrder({ side: "sell", quantity: 100 }),
      account: settled,
      declaration: baseDeclaration({ restrictions: { blockLimitDownSell: true } }),
      costDeclaration: zero,
      market: { open: 9, prevClose: 10 }, // 9 <= 10*0.9 = 9 跌停
      prices,
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_LIMIT_DOWN);
  });

  it("停牌拒单（无有效开盘/前收）", () => {
    const result = checkPaperOrder({
      order: makeOrder({ side: "buy", quantity: 100 }),
      account: freshAccount(),
      declaration: baseDeclaration(),
      costDeclaration: zero,
      market: { open: null, prevClose: 10 },
      prices,
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_SUSPENDED);
  });

  it("禁买/禁卖标的集拒单（账户层强制执行）", () => {
    const buyResult = checkPaperOrder({
      order: makeOrder({ side: "buy", quantity: 100, securityId: "BANNED" }),
      account: freshAccount(),
      declaration: baseDeclaration({ restrictions: { buyBanned: ["BANNED"] } }),
      costDeclaration: zero,
      market,
      prices,
    });
    expect(buyResult.ok).toBe(false);
    expect(buyResult.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_BUY_BANNED);
  });

  it("并发持仓数上限拒单", () => {
    const account = applyPaperBuyFill(
      freshAccount(),
      makeFill(zero, { securityId: "S1", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    ).account;
    const result = checkPaperOrder({
      order: makeOrder({ side: "buy", quantity: 100, securityId: "S2" }),
      account,
      declaration: baseDeclaration({ positions: { maxPositionCount: 1 } }),
      costDeclaration: zero,
      market,
      prices,
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_MAX_POSITIONS_REACHED);
  });

  it("单票权益占比上限拒单（账户层可执行）", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const result = checkPaperOrder({
      order: makeOrder({ side: "buy", quantity: 200 }), // 200*100=20000 > 0.1*100000
      account,
      declaration: baseDeclaration({ positions: { perSecurityEquityCap: 0.1 } }),
      costDeclaration: zero,
      market: { open: 100, prevClose: 100 },
      prices: new Map([["S", 100]]),
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_PER_SECURITY_CAP_EXCEEDED);
  });

  it("总仓位权益占比上限拒单（账户层可执行）", () => {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const result = checkPaperOrder({
      order: makeOrder({ side: "buy", quantity: 200 }),
      account,
      declaration: baseDeclaration({ positions: { totalEquityCap: 0.1 } }),
      costDeclaration: zero,
      market: { open: 100, prevClose: 100 },
      prices: new Map([["S", 100]]),
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_TOTAL_CAP_EXCEEDED);
  });

  it("T+1 可卖不足卖出拒单", () => {
    const account = applyPaperBuyFill(
      freshAccount(),
      makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" }),
      zero,
      "e1",
      "买入"
    ).account;
    // 未 settle，available=0。
    const result = checkPaperOrder({
      order: makeOrder({ side: "sell", quantity: 100 }),
      account,
      declaration: baseDeclaration(),
      costDeclaration: zero,
      market,
      prices,
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCode).toBe(PAPER_ACCOUNT_ERROR_CODES.CHECK_INSUFFICIENT_AVAILABLE);
  });

  it("合法订单通过全部约束检查", () => {
    const result = checkPaperOrder({
      order: makeOrder({ side: "buy", quantity: 100 }),
      account: freshAccount(),
      declaration: baseDeclaration(),
      costDeclaration: zero,
      market,
      prices,
    });
    expect(result.ok).toBe(true);
    expect(result.rejectionCode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C. 六维贴近实盘 + C-14.3 复用对照
// ---------------------------------------------------------------------------

describe("六维贴近实盘 + C-14.3 能力对照", () => {
  it("账户层能力矩阵：perSecurityEquityCap/totalEquityCap/buyBanned/sellBanned 可强制执行", () => {
    const declaration = baseDeclaration({
      positions: { maxPositionCount: 3, perSecurityEquityCap: 0.2, totalEquityCap: 0.8 },
      restrictions: { buyBanned: ["X"], sellBanned: ["Y"] },
    });
    const matrix = describePaperAccountConstraintEnforcement(declaration);
    const byKey = new Map(matrix.map((item) => [item.key, item]));

    expect(byKey.get("risk.perSecurityEquityCap")!.enforcement).toBe("ENFORCED");
    expect(byKey.get("risk.totalEquityCap")!.enforcement).toBe("ENFORCED");
    expect(byKey.get("risk.buyBanned")!.enforcement).toBe("ENFORCED");
    expect(byKey.get("risk.sellBanned")!.enforcement).toBe("ENFORCED");
    expect(byKey.get("risk.maxPositionCount")!.enforcement).toBe("ENFORCED");
  });

  it("账户层能力矩阵：LIMIT_PRICE / executionModel 仅记录不强制执行（诚实 blocker）", () => {
    const declaration = baseDeclaration({ timing: { executionModel: "LIMIT_PRICE" } });
    const matrix = describePaperAccountConstraintEnforcement(declaration);
    const byKey = new Map(matrix.map((item) => [item.key, item]));

    expect(byKey.get("execution.executionModel")!.enforcement).toBe("RECORDED_ONLY");
    expect(byKey.get("execution.limitPrice")!.enforcement).toBe("RECORDED_ONLY");
    expect(byKey.get("signal.source")!.enforcement).toBe("RECORDED_ONLY");
  });

  it("与 C-14.3 对照：C-14.1 plan 层标 blocker 的单票占比，账户层标 ENFORCED（能力差异）", () => {
    const declaration = baseDeclaration({ positions: { perSecurityEquityCap: 0.2 } });
    const c143Coverage = describeExecutionConstraintCoverage(declaration);
    const c143PerSecurity = c143Coverage.find((i) => i.key === "positions.perSecurityEquityCap")!;
    expect(c143PerSecurity.enforcement).toBe("DECLARED_ONLY"); // C-14.1 链 blocker

    const accountMatrix = describePaperAccountConstraintEnforcement(declaration);
    const accountPerSecurity = accountMatrix.find((i) => i.key === "risk.perSecurityEquityCap")!;
    expect(accountPerSecurity.enforcement).toBe("ENFORCED"); // 账户层有市值，可执行
  });

  it("DEFAULT_LOT_SIZE 复用 C-14.3 唯一来源（100）", () => {
    expect(DEFAULT_LOT_SIZE).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// D. 费用五维分解（复用 C-14.2）进入会计 + PnL 恒等式
// ---------------------------------------------------------------------------

describe("费用五维分解复用 C-14.2 + PnL 恒等式", () => {
  it("非零费用清仓：PnL 恒等式 grossPnl = realized + unrealized + totalCostDrag", () => {
    const cost: CostModelDeclaration = {
      name: "TEST",
      commissionRate: 0.00025,
      stampDutyRate: 0.0005,
      transferFeeRate: 0.00001,
      slippageBps: 10,
      lotSize: 100,
      minCommission: 5,
      marketImpact: { enabled: false, coefficient: 40, exponent: 0.5, maxBps: 200, maxParticipation: 1 },
    };
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const buyFill = makeFill(cost, {
      securityId: "S", side: "buy", quantity: 100, price: 10.01, basePrice: 10, timestamp: "2024-01-02",
    });
    const bought = applyPaperBuyFill(account, buyFill, cost, "e1", "买入").account;
    const settled = settlePaperAccountT1(bought, "2024-01-03");
    const sellFill = makeFill(cost, {
      securityId: "S", side: "sell", quantity: 100, price: 10.989, basePrice: 11, timestamp: "2024-01-03",
    });
    const sold = applyPaperSellFill(settled, sellFill, cost, "e2", "卖出").account;

    // 五维分解字段与 fill.cost 一致。
    expect(buyFill.cost.commission).toBeCloseTo(5, 10); // max(5, 1001*0.00025)
    expect(buyFill.cost.stampDuty).toBeCloseTo(0, 10);
    expect(buyFill.cost.transferFee).toBeCloseTo(0.01001, 10);
    expect(buyFill.cost.slippage).toBeCloseTo(1, 10);
    expect(buyFill.cost.marketImpact).toBeCloseTo(0, 10);

    const pnl = computePaperPnlBreakdown([buyFill, sellFill], sold.positions, sold.realizedPnL);
    // 恒等式。
    expect(pnl.grossPnl).toBeCloseTo(pnl.realizedPnL + pnl.unrealizedPnL + pnl.totalCostDrag, 8);
    // totalFees 恒非负。
    expect(pnl.totalFees).toBeGreaterThanOrEqual(0);
    expect(pnl.totalCostDrag).toBeGreaterThanOrEqual(0);
  });

  it("A 股默认声明可被 computeFillCostBreakdown 消费（复用不重写）", () => {
    const breakdown = computeFillCostBreakdown({
      side: "buy",
      price: 10,
      basePrice: 10,
      quantity: 100,
      referenceAmountKqian: 100000, // 提供流动性以避免冲击启用报错
      declaration: A_SHARE_DEFAULT_COST_DECLARATION,
    });
    expect(breakdown.commission).toBeGreaterThan(0);
    expect(breakdown.cashFees).toBeGreaterThan(0);
    expect(breakdown.impactApplied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. PaperAccountRun 记录 + 确定性 + round-trip + 篡改拒绝 + C-16.3 适配
// ---------------------------------------------------------------------------

describe("PaperAccountRun 记录 / 确定性 / round-trip / 篡改 / C-16.3 适配", () => {
  function buildRunInput() {
    const account = createPaperAccount({ accountId: "A", initialCapital: 100000, asOf: "2024-01-01" });
    const buyFill = makeFill(zero, { securityId: "S", side: "buy", quantity: 100, price: 10, timestamp: "2024-01-02" });
    const bought = applyPaperBuyFill(account, buyFill, zero, "e1", "买入").account;
    const settled = settlePaperAccountT1(bought, "2024-01-03");
    const sellFill = makeFill(zero, { securityId: "S", side: "sell", quantity: 100, price: 11, timestamp: "2024-01-03" });
    const sold = applyPaperSellFill(settled, sellFill, zero, "e2", "卖出").account;

    const order: PaperAccountOrder = makeOrder({ side: "buy", quantity: 100 });
    return {
      order,
      fills: [buyFill, sellFill],
      finalPositions: sold.positions,
      realizedPnL: sold.realizedPnL,
      snapshots: [
        snapshotPaperAccount(account),
        snapshotPaperAccount(bought),
        snapshotPaperAccount(settled),
        snapshotPaperAccount(sold),
      ],
      cashLedger: [
        { entryId: "e1", asOf: "2024-01-02", kind: "BUY_CASH_OUT" as const, amount: -1000, balanceAfter: 99000, fillId: "f1", description: "买入" },
        { entryId: "e2", asOf: "2024-01-03", kind: "SELL_CASH_IN" as const, amount: 1100, balanceAfter: 100100, fillId: "f2", description: "卖出" },
      ],
      equityCurve: [
        { date: "2024-01-01", cash: 100000, marketValue: 0, equity: 100000, openPositions: 0 },
        { date: "2024-01-02", cash: 99000, marketValue: 1000, equity: 100000, openPositions: 1 },
        { date: "2024-01-03", cash: 100100, marketValue: 0, equity: 100100, openPositions: 0 },
      ],
    };
  }

  it("确定性：同输入两次装配产出深比较相等", () => {
    const input1 = buildRunInput();
    const input2 = buildRunInput();
    const decl = baseDeclaration();
    const cost = zero;
    const run1 = assemblePaperAccountRun({
      runId: "r1",
      createdAt: "2024-01-04",
      initialCapital: 100000,
      costDeclaration: cost,
      executionDeclaration: decl,
      orders: [input1.order],
      fills: input1.fills,
      positionSnapshots: input1.snapshots,
      cashLedger: input1.cashLedger,
      equityCurve: input1.equityCurve,
      finalPositions: input1.finalPositions,
      realizedPnL: input1.realizedPnL,
    });
    const run2 = assemblePaperAccountRun({
      runId: "r1",
      createdAt: "2024-01-04",
      initialCapital: 100000,
      costDeclaration: cost,
      executionDeclaration: decl,
      orders: [input2.order],
      fills: input2.fills,
      positionSnapshots: input2.snapshots,
      cashLedger: input2.cashLedger,
      equityCurve: input2.equityCurve,
      finalPositions: input2.finalPositions,
      realizedPnL: input2.realizedPnL,
    });
    expect(run1).toEqual(run2);
    expect(run1.fingerprint).toBe(run2.fingerprint);
  });

  it("round-trip：serialize → deserialize 语义保真（重序列化相等 + 指纹一致）", () => {
    const input = buildRunInput();
    const run = assemblePaperAccountRun({
      runId: "r1",
      createdAt: "2024-01-04",
      initialCapital: 100000,
      costDeclaration: zero,
      executionDeclaration: baseDeclaration(),
      orders: [input.order],
      fills: input.fills,
      positionSnapshots: input.snapshots,
      cashLedger: input.cashLedger,
      equityCurve: input.equityCurve,
      finalPositions: input.finalPositions,
      realizedPnL: input.realizedPnL,
    });
    const json = serializePaperAccountRun(run);
    const restored = deserializePaperAccountRun(json);
    // 重序列化相等（-0 与 0 在 JSON 层语义等价且等价序列化），指纹一致。
    expect(serializePaperAccountRun(restored)).toBe(json);
    expect(restored.fingerprint).toBe(run.fingerprint);
    expect(restored.runId).toBe(run.runId);
    expect(restored.equityCurve).toEqual(run.equityCurve);
    expect(restored.pnlBreakdown).toEqual(run.pnlBreakdown);
  });

  it("篡改拒绝：改任意字段后 deserialize 抛指纹不匹配", () => {
    const input = buildRunInput();
    const run = assemblePaperAccountRun({
      runId: "r1",
      createdAt: "2024-01-04",
      initialCapital: 100000,
      costDeclaration: zero,
      executionDeclaration: baseDeclaration(),
      orders: [input.order],
      fills: input.fills,
      positionSnapshots: input.snapshots,
      cashLedger: input.cashLedger,
      equityCurve: input.equityCurve,
      finalPositions: input.finalPositions,
      realizedPnL: input.realizedPnL,
    });
    const parsed = JSON.parse(serializePaperAccountRun(run)) as Record<string, unknown>;
    parsed.pnlBreakdown = { ...(parsed.pnlBreakdown as object), realizedPnL: 999999 };
    expect(() => deserializePaperAccountRun(JSON.stringify(parsed))).toThrowError(PaperAccountError);
  });

  it("C-16.3 适配：equityCurve 纯映射、trades 省略、annualizationFactor 透传", () => {
    const input = buildRunInput();
    const run = assemblePaperAccountRun({
      runId: "r1",
      createdAt: "2024-01-04",
      initialCapital: 100000,
      costDeclaration: zero,
      executionDeclaration: baseDeclaration(),
      orders: [input.order],
      fills: input.fills,
      positionSnapshots: input.snapshots,
      cashLedger: input.cashLedger,
      equityCurve: input.equityCurve,
      finalPositions: input.finalPositions,
      realizedPnL: input.realizedPnL,
    });
    const mapped = toTradeQualityEvaluationInput(run, 252);
    expect(mapped.equityCurve).toEqual(run.equityCurve);
    expect(mapped.trades).toBeUndefined();
    expect(mapped.annualizationFactor).toBe(252);
  });
});
