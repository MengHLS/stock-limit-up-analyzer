/**
 * IMPACT-NETPNL-SIGN-001 — `Portfolio` 逐笔净盈亏口径测试锁。
 *
 * ## 锁的是什么
 *
 * 唯一不变量：**已清仓交易的 `netPnl` 必须等于该笔的真实现金损益**
 * （`(exitPrice − entryPrice) × qty + 现金分红 − 费用`），
 * 且组合层必须闭合：**无未平仓时 `cash − initialCapital === Σ netPnl`**。
 *
 * ## 为什么需要这些锁（缺陷史）
 *
 * 修复前 `portfolio.ts` 用「无滑点基准价」算 `grossPnL`，又减去**有符号**的
 * `slippageAmount`（`cost.ts:50` = `(price − basePrice) × qty`）。由于卖出成交价
 * 由 `slippedSellPriceAdjusted`（`execution.ts:39-42`）以 `base × (1 − bps)` 构造
 * ⇒ 卖出侧滑点**结构性为负** ⇒ 「减负数」= 把卖出滑点又加回来一次
 * ⇒ `netPnl` 高估 `2 × |卖出侧滑点|`（实测隐含 5.10bp vs 配置 5bp）。
 *
 * 因此**下面的断言在修复前必然失败** —— 这是本文件的用途：让口径可证伪，
 * 而不是「改完再补一个跟着实现走的测试」。
 *
 * 详见 `docs/research/IMPACT-NETPNL-SIGN-001.md`。
 */

import { describe, expect, it } from "vitest";
import { Portfolio } from "../../../server/backtest/portfolio";
import type { Fill } from "../../../server/backtest/types";
import type { CostModel } from "../../../server/engine/domain";
import type { CorporateAction } from "../../../server/corporateActions/types";

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 5,
};

const DATES = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"];

function mkFill(o: {
  securityId?: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  basePrice?: number;
  timestamp: string;
}): Fill {
  return {
    fillId: `F-${o.side}-${o.timestamp}`,
    orderId: `O-${o.side}`,
    securityId: o.securityId ?? "600001.SH",
    side: o.side,
    quantity: o.quantity,
    price: o.price,
    basePrice: o.basePrice ?? o.price,
    timestamp: o.timestamp,
    cost: { commission: 0, stampDuty: 0, transferFee: 0, otherFees: 0, total: 0 },
    slippageAmount: 0,
    referenceAmount: null,
  };
}

function mkAction(overrides: Partial<CorporateAction> = {}): CorporateAction {
  return {
    securityId: null,
    securityCode: "600001.SH",
    actionType: "split",
    effectiveDate: "2026-01-05",
    recordDate: null,
    announcementDate: null,
    cashAmount: null,
    bonusRatio: null,
    transferRatio: null,
    rightsRatio: null,
    rightsPrice: null,
    splitRatio: 2,
    source: "test",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    description: null,
    ...overrides,
  };
}

const sumNetPnl = (p: Portfolio): number =>
  p.allTrades().reduce((sum, t) => sum + (t.netPnl ?? 0), 0);

describe("IMPACT-NETPNL-SIGN-001 · 单笔口径", () => {
  it("已清仓一笔：netPnl = (exitPrice − entryPrice) × qty − fees（成交价口径）", () => {
    const p = new Portfolio(100_000, DATES, { maxPositions: 5 });
    // 买入：基准 10，成交价含 5bp 上滑 = 10.005
    const buy = p.buy(
      mkFill({ side: "buy", quantity: 1000, price: 10.005, basePrice: 10, timestamp: "2026-01-02" }),
      COST,
      true,
    );
    expect(buy.success).toBe(true);
    p.settle();
    // 卖出：基准 11，成交价含 5bp 下滑 = 10.9945
    const sell = p.sell(
      mkFill({ side: "sell", quantity: 1000, price: 10.9945, basePrice: 11, timestamp: "2026-01-05" }),
      COST,
      true,
    );
    expect(sell.success).toBe(true);

    const t = p.allTrades()[0]!;
    expect(t.openAtEnd).toBe(false);
    const cashPnl = (10.9945 - 10.005) * 1000 - t.fees;
    expect(t.netPnl).toBeCloseTo(cashPnl, 9);
    expect(t.grossPnL).toBeCloseTo((10.9945 - 10.005) * 1000, 9);
  });

  it("滑点不变量：买卖两侧滑点的任意符号组合都满足 netPnl = 现金损益", () => {
    const cases: ReadonlyArray<{ buy: [number, number]; sell: [number, number] }> = [
      { buy: [10.005, 10], sell: [10.9945, 11] }, // 买上滑 / 卖下滑（常态）
      { buy: [10.005, 10], sell: [11.005, 11] }, // 买上滑 / 卖上滑（有利）
      { buy: [9.995, 10], sell: [10.9945, 11] }, // 买下滑 / 卖下滑
      { buy: [9.995, 10], sell: [11.005, 11] }, // 买下滑 / 卖上滑
    ];
    for (const c of cases) {
      const p = new Portfolio(100_000, DATES, { maxPositions: 5 });
      p.buy(
        mkFill({ side: "buy", quantity: 1000, price: c.buy[0], basePrice: c.buy[1], timestamp: "2026-01-02" }),
        COST,
        true,
      );
      p.settle();
      p.sell(
        mkFill({ side: "sell", quantity: 1000, price: c.sell[0], basePrice: c.sell[1], timestamp: "2026-01-05" }),
        COST,
        true,
      );
      const t = p.allTrades()[0]!;
      const cashPnl = (c.sell[0] - c.buy[0]) * 1000 - t.fees;
      expect(t.netPnl).toBeCloseTo(cashPnl, 9);
    }
  });

  it("slippageAmount 仍是**有符号诊断量**（买正卖负），本次修复不改动它", () => {
    const p = new Portfolio(100_000, DATES, { maxPositions: 5 });
    p.buy(
      mkFill({ side: "buy", quantity: 1000, price: 10.005, basePrice: 10, timestamp: "2026-01-02" }),
      COST,
      true,
    );
    p.settle();
    p.sell(
      mkFill({ side: "sell", quantity: 1000, price: 10.9945, basePrice: 11, timestamp: "2026-01-05" }),
      COST,
      true,
    );
    const t = p.allTrades()[0]!;
    // 买 +5.0，卖 −5.5 ⇒ 合计 −0.5（刻意保留：cost = fees + slippageAmount 的口径依赖它）
    expect(t.slippageAmount).toBeCloseTo((10.005 - 10) * 1000 + (10.9945 - 11) * 1000, 9);
    expect(t.slippageAmount).toBeCloseTo(-0.5, 9);
  });
});

describe("IMPACT-NETPNL-SIGN-001 · 组合层闭合", () => {
  it("无未平仓时：cash − initialCapital ≡ Σ netPnl（多笔、双边滑点）", () => {
    const p = new Portfolio(100_000, DATES, { maxPositions: 5 });
    for (const [symbol, buyPrice, buyBase, sellPrice, sellBase] of [
      ["600001.SH", 10.005, 10, 10.9945, 11],
      ["600002.SH", 20.01, 20, 19.9802, 20],
      ["600003.SH", 5.0025, 5, 5.4973, 5.5],
    ] as const) {
      p.buy(
        mkFill({ securityId: symbol, side: "buy", quantity: 1000, price: buyPrice, basePrice: buyBase, timestamp: "2026-01-02" }),
        COST,
        true,
      );
    }
    p.settle();
    for (const [symbol, sellPrice, sellBase] of [
      ["600001.SH", 10.9945, 11],
      ["600002.SH", 19.9802, 20],
      ["600003.SH", 5.4973, 5.5],
    ] as const) {
      p.sell(
        mkFill({ securityId: symbol, side: "sell", quantity: 1000, price: sellPrice, basePrice: sellBase, timestamp: "2026-01-05" }),
        COST,
        true,
      );
    }
    expect(p.openPositionCount).toBe(0);
    expect(p.cash - 100_000).toBeCloseTo(sumNetPnl(p), 9);
  });

  it("含现金分红时闭合仍成立", () => {
    const p = new Portfolio(100_000, DATES, { maxPositions: 5 });
    p.buy(mkFill({ side: "buy", quantity: 1000, price: 10, timestamp: "2026-01-02" }), COST, true);
    const { cashDelta } = p.applyCorporateAction("600001.SH", [
      mkAction({ actionType: "dividend", cashAmount: 0.5, effectiveDate: "2026-01-05" }),
    ]);
    expect(cashDelta).toBeCloseTo(500, 9);
    p.settle();
    p.sell(mkFill({ side: "sell", quantity: 1000, price: 10.2, timestamp: "2026-01-06" }), COST, true);
    const t = p.allTrades()[0]!;
    expect(t.netPnl).toBeCloseTo((10.2 - 10) * 1000 + 500 - t.fees, 9);
    expect(p.cash - 100_000).toBeCloseTo(sumNetPnl(p), 9);
  });
});

describe("IMPACT-NETPNL-SIGN-001 · 公司行为", () => {
  it("拆股 1→2 后清仓与未拆股路径经济等价", () => {
    // 路径 A：买 1000@10 → 卖 1000@11
    const a = new Portfolio(100_000, DATES, { maxPositions: 5 });
    a.buy(mkFill({ side: "buy", quantity: 1000, price: 10, timestamp: "2026-01-02" }), COST, true);
    a.settle();
    a.sell(mkFill({ side: "sell", quantity: 1000, price: 11, timestamp: "2026-01-05" }), COST, true);

    // 路径 B：买 1000@10 → 拆 1→2（价折半、量翻倍）→ 卖 2000@5.5
    const b = new Portfolio(100_000, DATES, { maxPositions: 5 });
    b.buy(mkFill({ side: "buy", quantity: 1000, price: 10, timestamp: "2026-01-02" }), COST, true);
    b.applyCorporateAction("600001.SH", [mkAction({ actionType: "split", splitRatio: 2 })]);
    b.settle();
    b.sell(mkFill({ side: "sell", quantity: 2000, price: 5.5, timestamp: "2026-01-05" }), COST, true);

    const ta = a.allTrades()[0]!;
    const tb = b.allTrades()[0]!;
    expect(tb.quantity).toBe(2000);
    expect(tb.entryPrice).toBeCloseTo(5, 9);
    expect(tb.netPnl).toBeCloseTo(ta.netPnl!, 6);
    expect(tb.grossPnL).toBeCloseTo(ta.grossPnL!, 6);
  });
});

describe("IMPACT-NETPNL-SIGN-001 · 部分成交与未平仓", () => {
  it("部分成交：netPnl 按**实际**成交量计价", () => {
    const p = new Portfolio(10_000, DATES, { maxPositions: 5 });
    const r = p.buy(
      mkFill({ side: "buy", quantity: 2000, price: 10, timestamp: "2026-01-02" }),
      COST,
      true,
    );
    expect(r.status).toBe("PARTIALLY_FILLED");
    const filled = r.filledQuantity;
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThan(2000);
    p.settle();
    p.sell(mkFill({ side: "sell", quantity: filled, price: 10.5, timestamp: "2026-01-05" }), COST, true);
    const t = p.allTrades()[0]!;
    expect(t.quantity).toBe(filled);
    expect(t.netPnl).toBeCloseTo((10.5 - 10) * filled - t.fees, 9);
  });

  it("期末未平仓：netPnl / grossPnL / returnPct 一律 null（不得当 0 计入）", () => {
    const p = new Portfolio(100_000, DATES, { maxPositions: 5 });
    p.buy(mkFill({ side: "buy", quantity: 1000, price: 10, timestamp: "2026-01-02" }), COST, true);
    p.finalizeOpenTrades(new Map([["600001.SH", 10.5]]));
    const t = p.allTrades()[0]!;
    expect(t.openAtEnd).toBe(true);
    expect(t.netPnl).toBeNull();
    expect(t.grossPnL).toBeNull();
    expect(t.returnPct).toBeNull();
    expect(t.exitPrice).toBeCloseTo(10.5, 9);
  });
});
