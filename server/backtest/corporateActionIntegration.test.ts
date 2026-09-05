/**
 * STEP 11-FINAL-FIX — Corporate Action → Portfolio 接线测试。
 *
 * 覆盖：PositionBook.applyCorporateAction（拆股份额/均价、分红现金）、
 * Portfolio.applyCorporateAction（现金分红入账、拆股后清仓经济等价）、
 * 引擎主循环在 ex-date 应用公司行为（份额与 open trade 同步缩放）。
 */

import { describe, expect, it } from "vitest";
import { InMemoryBarStore } from "./dataSource";
import { runBacktestEngine2 } from "./engine";
import { PositionBook } from "./position";
import { Portfolio } from "./portfolio";
import type { BacktestSpec, CorporateActionResolver, Fill, Security } from "./types";
import type { CostModel } from "../engine/domain";
import type { CanonicalMarketBar } from "../data/types";
import type { CorporateAction } from "../corporateActions/types";

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 5,
};

const SEC: Security = { securityId: "600001.SH", board: "main" };

function action(overrides: Partial<CorporateAction> = {}): CorporateAction {
  return {
    securityId: null,
    securityCode: "600001.SH",
    actionType: "split",
    effectiveDate: "2026-01-03",
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

function buyFill(securityId: string, quantity: number, price: number, date: string): Fill {
  return {
    fillId: "F-1",
    orderId: "O-1",
    securityId,
    side: "buy",
    quantity,
    price,
    basePrice: price,
    timestamp: date,
    cost: { commission: 0, stampDuty: 0, transferFee: 0, otherFees: 0, total: 0 },
    slippageAmount: 0,
    referenceAmount: null,
  };
}

function sellFill(securityId: string, quantity: number, price: number, date: string): Fill {
  return { ...buyFill(securityId, quantity, price, date), side: "sell" };
}

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

describe("PositionBook.applyCorporateAction — 份额/成本基变换", () => {
  it("拆股 1→2：股数×2、均价÷2、成本基不变", () => {
    const book = new PositionBook();
    book.increase("600001.SH", 100, 10, 0);
    const { cashDelta, ratio } = book.applyCorporateAction("600001.SH", [
      action({ actionType: "split", splitRatio: 2 }),
    ]);
    expect(ratio).toBe(2);
    expect(cashDelta).toBe(0);
    const snap = book.snapshot(new Map([["600001.SH", 5]]))[0]!;
    expect(snap.quantity).toBe(200);
    expect(snap.averageEntryPrice).toBeCloseTo(5, 10);
    expect(snap.marketValue).toBeCloseTo(1000, 10); // 200 × 5
  });

  it("现金分红：cashDelta = D×q，股数不变，成本基不变", () => {
    const book = new PositionBook();
    book.increase("600001.SH", 100, 10, 0);
    const { cashDelta, ratio } = book.applyCorporateAction("600001.SH", [
      action({ actionType: "dividend", cashAmount: 1 }),
    ]);
    expect(ratio).toBe(1);
    expect(cashDelta).toBeCloseTo(100, 10);
    expect(book.quantity("600001.SH")).toBe(100);
  });

  it("送股：股数×(1+b)，成本基不变 → 均价摊薄", () => {
    const book = new PositionBook();
    book.increase("600001.SH", 100, 10, 0);
    const { ratio } = book.applyCorporateAction("600001.SH", [
      action({ actionType: "bonus_issue", bonusRatio: 0.5 }),
    ]);
    expect(ratio).toBeCloseTo(1.5, 10);
    const snap = book.snapshot(new Map([["600001.SH", 10]]))[0]!;
    expect(snap.quantity).toBe(150);
    expect(snap.averageEntryPrice).toBeCloseTo(1000 / 150, 10);
  });
});

describe("Portfolio.applyCorporateAction — 现金与生命周期", () => {
  it("现金分红计入现金，股数不变", () => {
    const portfolio = new Portfolio(10_000, ["2026-01-01", "2026-01-02"]);
    portfolio.buy(buyFill("600001.SH", 100, 10, "2026-01-01"), COST, false);
    const beforeCash = portfolio.cash;
    portfolio.applyCorporateAction("600001.SH", [
      action({ actionType: "dividend", cashAmount: 1 }),
    ]);
    expect(portfolio.cash).toBeCloseTo(beforeCash + 100, 10);
    expect(portfolio.quantity("600001.SH")).toBe(100);
  });

  it("拆股后清仓：已实现盈亏与未拆基准经济等价", () => {
    // 拆股路径：100 股 @10 → 拆 1→2 → 200 股 @6 清仓（6 为拆后等价于拆前 12）。
    const splitPortfolio = new Portfolio(10_000, ["2026-01-01", "2026-01-02"]);
    splitPortfolio.buy(buyFill("600001.SH", 100, 10, "2026-01-01"), COST, false);
    splitPortfolio.applyCorporateAction("600001.SH", [
      action({ actionType: "split", splitRatio: 2, effectiveDate: "2026-01-02" }),
    ]);
    splitPortfolio.settle();
    splitPortfolio.sell(sellFill("600001.SH", 200, 6, "2026-01-02"), COST, false);

    // 基准：100 股 @10 → 12 元清仓（无拆股）。
    const baseline = new Portfolio(10_000, ["2026-01-01", "2026-01-02"]);
    baseline.buy(buyFill("600001.SH", 100, 10, "2026-01-01"), COST, false);
    baseline.settle();
    baseline.sell(sellFill("600001.SH", 100, 12, "2026-01-02"), COST, false);

    // 清仓后的已实现盈亏记录在 completedTrades 的 netPnl（closed 持仓已从账本移除）。
    const splitNet = splitPortfolio.allTrades()[0]!.netPnl!;
    const baselineNet = baseline.allTrades()[0]!.netPnl!;
    expect(splitNet).toBeCloseTo(baselineNet, 6);
    expect(splitNet).toBeGreaterThan(180); // ≈ 200 − 少量费用
    expect(splitNet).toBeLessThan(200);
  });
});

describe("引擎主循环 — ex-date 应用公司行为", () => {
  it("拆股在生效日应用，持仓与 open trade 同步缩放", async () => {
    const bars = [
      bar("600001.SH", "2026-01-01", { open: 10, close: 10 }),
      bar("600001.SH", "2026-01-02", { open: 10, close: 10, preClose: 10 }),
      bar("600001.SH", "2026-01-03", { open: 5, close: 5, preClose: 10 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const resolver: CorporateActionResolver = {
      actionsFor: (securityId, date) =>
        date === "2026-01-03"
          ? [action({ actionType: "split", splitRatio: 2, effectiveDate: "2026-01-03" })]
          : [],
    };
    const spec: BacktestSpec = {
      strategyId: "ca-bridge",
      strategyVersion: "1.0.0",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      initialCapital: 100_000,
      cost: COST,
      executionModel: "NEXT_OPEN",
      universe: { id: "U", securities: [SEC] },
      corporateActionResolver: resolver,
      signalGenerator: (date) =>
        date === "2026-01-01" ? [{ securityId: "600001.SH", signalTime: date, side: "buy", quantity: 100 }] : [],
    };
    const result = await runBacktestEngine2(store, spec);

    // 01-02 买入 100 股；01-03 拆股 1→2 → 期末持仓 200 股，open trade 数量同步 200。
    expect(result.executionStats.totalFills).toBe(1);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]!.quantity).toBe(200);
    expect(result.trades[0]!.quantity).toBe(200);
    expect(result.trades[0]!.entryPrice).toBeCloseTo(5, 6); // 10 / 2
  });
});
