/**
 * STEP 9 — Portfolio Engine · 测试套件。
 *
 * 覆盖规范 §十一 要求的全部场景：
 *   buy / sell / partial fill / fees / tax / cash / position / average cost /
 *   realized PnL / unrealized PnL / exposure / T+1 / determinism。
 */

import { describe, expect, it } from "vitest";
import { PortfolioAccount, DEFAULT_FEE_SCHEDULE, buyFees, sellFees, stampDuty, computeFill } from "./index";

const SCHEDULE = DEFAULT_FEE_SCHEDULE;

/** 新建 10 万元账户。 */
function account(cash = 100_000, date = "2026-01-05"): PortfolioAccount {
  return new PortfolioAccount(cash, { feeSchedule: SCHEDULE, currentDate: date });
}

describe("Portfolio Engine · Buy", () => {
  it("买入扣减现金 = 成交额 + 买入费用，并建立持仓", () => {
    const acct = account();
    const res = acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    expect(res.success).toBe(true);

    // gross=10000, commission=max(5,3)=5, transferFee=0.10, fees=5.10, totalCost=10005.10
    expect(acct.cash).toBeCloseTo(100_000 - 10_005.1, 2);
    const snap = acct.snapshot("2026-01-05");
    expect(snap.positions).toHaveLength(1);
    const p = snap.positions[0]!;
    expect(p.quantity).toBe(1000);
    expect(p.averageCost).toBeCloseTo(10.0051, 4);
    expect(p.availableQuantity).toBe(0); // T+1：当日买入不可卖
  });

  it("非整手买入被拒绝且不改变状态", () => {
    const acct = account();
    const res = acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 150 }, 10);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("INVALID_ORDER");
    expect(acct.cash).toBe(100_000);
    expect(acct.openPositionCount).toBe(0);
  });

  it("资金不足被拒绝且不改变状态", () => {
    const acct = account(1000);
    const res = acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 10);
    expect(res.success).toBe(false);
    expect(res.reason).toBe("INSUFFICIENT_CASH");
    expect(acct.cash).toBe(1000);
    expect(acct.openPositionCount).toBe(0);
  });
});

describe("Portfolio Engine · Sell", () => {
  it("清仓：现金增加 = 卖出所得，realized PnL 精确", () => {
    const acct = account();
    acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    acct.rollover("2026-01-06");

    const res = acct.sell({ symbol: "000001.SZ", side: "sell", quantity: 1000 }, 11, "2026-01-06");
    expect(res.success).toBe(true);
    // gross=11000, commission=5, transferFee=0.11, stampDuty=5.50, proceeds=10989.39
    // realized = 10989.39 - 10005.10 = 984.29
    expect(acct.cash).toBeCloseTo(100_000 - 10_005.1 + 10_989.39, 2);
    expect(acct.realizedPnL()).toBeCloseTo(984.29, 2);
    expect(acct.openPositionCount).toBe(0);
  });

  it("T+1 锁定：当日买入不可卖出", () => {
    const acct = account();
    acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    const res = acct.sell({ symbol: "000001.SZ", side: "sell", quantity: 1000 }, 11, "2026-01-05");
    expect(res.success).toBe(false);
    expect(res.reason).toContain("T+1");
  });

  it("rollover 后 T+1 释放可卖数量", () => {
    const acct = account();
    acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    acct.rollover("2026-01-06");
    const p = acct.snapshot("2026-01-06").positions[0]!;
    expect(p.availableQuantity).toBe(1000);
    expect(acct.sell({ symbol: "000001.SZ", side: "sell", quantity: 1000 }, 11, "2026-01-06").success).toBe(true);
  });

  it("部分减仓：按比例结转成本基，剩余持仓成本不变", () => {
    const acct = account();
    acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    acct.rollover("2026-01-06");
    const res = acct.sell({ symbol: "000001.SZ", side: "sell", quantity: 400 }, 11, "2026-01-06");
    expect(res.success).toBe(true);

    // gross=4400, commission=5, transferFee=0.04, stampDuty=2.20, proceeds=4392.76
    // costBasisRemoved=10005.10*0.4=4002.04, realized=390.72
    expect(acct.realizedPnL()).toBeCloseTo(390.72, 2);
    const p = acct.snapshot("2026-01-06").positions[0]!;
    expect(p.quantity).toBe(600);
    expect(p.availableQuantity).toBe(600);
    expect(p.averageCost).toBeCloseTo(10.0051, 4); // 加权平均成本不变
  });

  it("卖出无持仓被拒绝", () => {
    const acct = account();
    const res = acct.sell({ symbol: "000001.SZ", side: "sell", quantity: 100 }, 10);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("无该股票持仓");
  });
});

describe("Portfolio Engine · Accounting（Fee/Tax/Cash）", () => {
  it("买入费用 = 佣金 + 过户费（无印花税）", () => {
    expect(buyFees(10_000, SCHEDULE)).toBeCloseTo(5.1, 2);
  });

  it("卖出费用含印花税，买入印花税为 0", () => {
    expect(sellFees(11_000, SCHEDULE)).toBeCloseTo(10.61, 2); // 5 + 0.11 + 5.50
    expect(stampDuty(11_000, "sell", SCHEDULE)).toBeCloseTo(5.5, 2);
    expect(stampDuty(11_000, "buy", SCHEDULE)).toBe(0);
  });

  it("computeFill 现金变动方向正确", () => {
    const buy = computeFill({ symbol: "A", side: "buy", quantity: 1000 }, 10, "D", SCHEDULE);
    expect(buy.netCash).toBeCloseTo(-10_005.1, 2);
    const sell = computeFill({ symbol: "A", side: "sell", quantity: 1000 }, 11, "D", SCHEDULE);
    expect(sell.netCash).toBeCloseTo(10_989.39, 2);
  });
});

describe("Portfolio Engine · Average Cost（加权平均）", () => {
  it("加仓后平均成本 = 总成本基 / 总股数", () => {
    const acct = account();
    acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    acct.rollover("2026-01-06");
    acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 12, "2026-01-06");
    const p = acct.snapshot("2026-01-06").positions[0]!;
    expect(p.quantity).toBe(2000);
    // costBasis = 10005.10 + 12005.12 = 22010.22 → avg = 11.00511 → round4 = 11.0051
    expect(p.averageCost).toBeCloseTo(11.0051, 4);
  });
});

describe("Portfolio Engine · Mark-to-Market & Exposure", () => {
  it("unrealized PnL 与 exposure 正确", () => {
    const acct = account();
    acct.buy({ symbol: "000001.SZ", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    const snap = acct.snapshot("2026-01-05", new Map([["000001.SZ", 12]]));
    // marketValue = 12*1000 = 12000, costBasis=10005.10, unrealized=1994.90
    expect(snap.marketValue).toBeCloseTo(12_000, 2);
    expect(snap.unrealizedPnL).toBeCloseTo(1994.9, 2);
    expect(snap.equity).toBeCloseTo(89994.9 + 12_000, 2);
    expect(snap.exposure).toBeCloseTo(12_000 / (89994.9 + 12_000), 6);
  });
});

describe("Portfolio Engine · Accounting Integrity（资金守恒）", () => {
  it("任意时点 equity − initialCash = realizedPnL + unrealizedPnL", () => {
    const acct = account();
    acct.buy({ symbol: "A", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    acct.buy({ symbol: "B", side: "buy", quantity: 500 }, 20, "2026-01-05");
    acct.rollover("2026-01-06");
    acct.sell({ symbol: "A", side: "sell", quantity: 400 }, 11, "2026-01-06");
    const snap = acct.snapshot("2026-01-06", new Map([["A", 11], ["B", 21]]));
    expect(snap.equity - acct.initialCash).toBeCloseTo(snap.realizedPnL + snap.unrealizedPnL, 2);
  });

  it("全清仓后 realizedPnL 仍保留（不随持仓删除归零）", () => {
    const acct = account();
    acct.buy({ symbol: "A", side: "buy", quantity: 1000 }, 10, "2026-01-05");
    acct.rollover("2026-01-06");
    acct.sell({ symbol: "A", side: "sell", quantity: 1000 }, 11, "2026-01-06");
    expect(acct.openPositionCount).toBe(0);
    expect(acct.realizedPnL()).toBeCloseTo(984.29, 2);
  });
});

describe("Portfolio Engine · Determinism", () => {
  it("相同操作序列产生完全一致的快照", () => {
    const run = (): unknown => {
      const a = account();
      a.buy({ symbol: "A", side: "buy", quantity: 1000 }, 10, "2026-01-05");
      a.buy({ symbol: "B", side: "buy", quantity: 500 }, 20, "2026-01-05");
      a.rollover("2026-01-06");
      a.sell({ symbol: "A", side: "sell", quantity: 400 }, 11, "2026-01-06");
      return a.snapshot("2026-01-06", new Map([["A", 11], ["B", 21]]));
    };
    expect(run()).toEqual(run());
  });

  it("独立实例互不污染", () => {
    const a = account();
    const b = account();
    a.buy({ symbol: "A", side: "buy", quantity: 1000 }, 10);
    expect(b.openPositionCount).toBe(0);
    expect(b.cash).toBe(100_000);
  });
});
