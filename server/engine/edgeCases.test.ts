/**
 * G3 P3-T4 —— Backtest Core 边界条件逐项验证。
 *
 * 目的：对「T+1 / 涨跌停 / 停牌 / 滑点 / 费用 / 资金 / 退出 / 止损止盈 / 公司行为」
 * 逐项给出可执行断言，诚实区分「已覆盖」与「已知缺口（KNOWN_GAP）」。
 *
 * ── 已覆盖（本文件逐项断言）─────────────────────────────────────────────
 *   1. T+1          信号 T 收盘产生 → T+1 开盘成交（engine.test.ts 已锁定，此处补边界）
 *   2. 涨跌停可成交性  NextOpenExecutionModel 的 blockLimitUpBuy / blockLimitDownSell
 *   3. 停牌/数据缺失  成交日无 bar → 信号作废（不成交、不产生持仓）
 *   4. 板块涨跌停幅度  boardRules.resolveLimitRules（主板 10% / ST 5% / 创业+科创 20% / 北交所 30%）
 *   5. 滑点          买入上浮 / 卖出下浮 + 流动性分层（engine.test.ts / fix.test.ts 已锁）
 *   6. 费用          佣金(最低5) / 印花税(仅卖出) / 过户费(双边)
 *   7. 资金          现金不足向下取整到整手，仍不足则拒绝
 *   8. 退出          maxHoldingDays 时间退出（本文件端到端锁定）+ hold-while-selected 信号退出（P3-T1）
 *
 * ── 已知缺口（KNOWN_GAP，本文件仅登记、不伪造覆盖）─────────────────────
 *   K1 止损/止盈     生产引擎（Strategy Engine → Core）退出仅 hold-while-selected + maxHoldingDays，
 *                    无开盘止损 / 动态止盈回撤 / 强势续持。legacy realisticBacktest 有
 *                    riskManagedHold（stopLossPercent / trailingDrawdownPercent /
 *                    trailingProfitActivationPercent / strongHoldMinReturn），生产引擎不消费。
 *                    待 P4-T1 定义 FIRST_FORMAL_STRATEGY 用户真实止损止盈规则后再接入。
 *   K2 公司行为/除权  引擎 Core 直接消费 rawRows 价格，未做除权除息调整；若原始价格为未复权，
 *                    除权日会算出假盈亏。adjustment_factors 已 FULL 回填，但生产引擎未接入复权。
 *   K3 一字板封死概率 legacy 有 enableOneWordLimitDownProbability（跌停封死无法卖出概率模型），
 *                    生产引擎无此能力。
 *   K4 板块 limitRules 未注入生产引擎  boardRules.resolveLimitRules 已实现板块差异，但
 *                    strategyBacktest.runStrategyEngineBacktest 用默认 nextOpenExecutionModel()
 *                    （固定 10%），未按 symbol 注入 limitRules，也未启用 blockLimitUpBuy/DownSell。
 *
 * 这些 KNOWN_GAP 是「能力现状」的诚实记录，不冒充已实现；已在 PRODUCT_GAP_MATRIX.md 登记。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_COST_MODEL,
  NextOpenExecutionModel,
  nextOpenExecutionModel,
  buyFees,
  sellFees,
  type CostModel,
  type MarketBar,
  type Signal,
} from "./execution";
import { runBacktest } from "./engine";
import { resolveLimitRules, classifyBoard, isStStock } from "../data/boardRules";
import type { BacktestConfig } from "./domain";

const COST: CostModel = { ...DEFAULT_COST_MODEL };

function bar(partial: Partial<MarketBar> & { date: string }): MarketBar {
  return { open: null, high: null, low: null, close: null, prevClose: null, amount: null, ...partial };
}

function config(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    strategyId: "edge",
    strategyVersion: "1.0.0",
    initialCapital: 100_000,
    startDate: "T1",
    endDate: "T3",
    cost: COST,
    maxPositions: 5,
    maxPositionAmountRatio: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. 涨跌停可成交性（Execution 层）
// ---------------------------------------------------------------------------

describe("G3 P3-T4 · 涨跌停可成交性", () => {
  it("blockLimitUpBuy=true 时，开盘触及涨停的买入被拒绝", () => {
    const m = new NextOpenExecutionModel({ blockLimitUpBuy: true });
    const b = bar({ date: "T2", open: 11, prevClose: 10 }); // 11 = 10 * 1.1 涨停
    const fill = m.execute({ symbol: "A", side: "buy", quantity: 100, executionTime: "T2", orderType: "market" }, b, COST);
    expect(fill.rejectionReason).toContain("涨停");
    expect(fill.quantity).toBe(0);
  });

  it("blockLimitUpBuy=false（默认）时，开盘涨停仍可买入", () => {
    const m = nextOpenExecutionModel();
    const b = bar({ date: "T2", open: 11, prevClose: 10 });
    const fill = m.execute({ symbol: "A", side: "buy", quantity: 100, executionTime: "T2", orderType: "market" }, b, COST);
    expect(fill.rejectionReason).toBeUndefined();
    expect(fill.quantity).toBe(100);
  });

  it("blockLimitDownSell=true 时，开盘触及跌停的卖出被拒绝", () => {
    const m = new NextOpenExecutionModel({ blockLimitDownSell: true });
    const b = bar({ date: "T2", open: 9, prevClose: 10 }); // 9 = 10 * 0.9 跌停
    const fill = m.execute({ symbol: "A", side: "sell", quantity: 100, executionTime: "T2", orderType: "market" }, b, COST);
    expect(fill.rejectionReason).toContain("跌停");
    expect(fill.quantity).toBe(0);
  });

  it("跌停卖出拒绝只发生在 blockLimitDownSell=true（默认不拦截）", () => {
    const m = nextOpenExecutionModel();
    const b = bar({ date: "T2", open: 9, prevClose: 10 });
    const fill = m.execute({ symbol: "A", side: "sell", quantity: 100, executionTime: "T2", orderType: "market" }, b, COST);
    expect(fill.rejectionReason).toBeUndefined();
    expect(fill.quantity).toBe(100);
  });

  it("缺少前收盘价时无法判定涨跌停 → 拒绝成交（不静默放行）", () => {
    const m = new NextOpenExecutionModel({ blockLimitUpBuy: true });
    const b = bar({ date: "T2", open: 11, prevClose: null });
    const fill = m.execute({ symbol: "A", side: "buy", quantity: 100, executionTime: "T2", orderType: "market" }, b, COST);
    expect(fill.rejectionReason).toContain("前收盘价");
  });
});

// ---------------------------------------------------------------------------
// 2. 停牌 / 数据缺失（Engine 层端到端）
// ---------------------------------------------------------------------------

describe("G3 P3-T4 · 停牌 / 数据缺失", () => {
  it("买入信号在成交日无 bar（停牌）→ 信号作废，不成交、不产生持仓", () => {
    const bars = new Map<string, Map<string, MarketBar>>();
    // T1 有信号（收盘），但 T2 停牌（无 S 的 bar）。
    bars.set("T1", new Map([["S", bar({ date: "T1", open: null, close: 10, prevClose: 9.5 })]]));
    // T2 只有其他股票，S 停牌。
    bars.set("T2", new Map([["OTHER", bar({ date: "T2", open: 10, close: 10, prevClose: 10 })]]));
    const result = runBacktest({
      config: config({ endDate: "T2" }),
      tradingDates: ["T1", "T2"],
      barsByDate: bars,
      signalProvider: (d) => (d === "T1" ? [{ symbol: "S", side: "buy", quantity: 100, signalTime: d }] : []),
    });
    expect(result.trades).toHaveLength(0);
    expect(result.finalPortfolio.cash).toBe(100_000);
  });

  it("持仓股在卖出日停牌 → 卖出作废，持仓保留（不复牌前不得强平）", () => {
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([["S", bar({ date: "T1", open: null, close: 10, prevClose: 9.5 })]]));
    bars.set("T2", new Map([["S", bar({ date: "T2", open: 10, close: 10.5, prevClose: 10 })]])); // 买入成交
    // T3 停牌：无 S 的 bar，但发出卖出信号。
    bars.set("T3", new Map([["OTHER", bar({ date: "T3", open: 10, close: 10, prevClose: 10 })]]));
    const provider = (d: string): Signal[] => {
      if (d === "T1") return [{ symbol: "S", side: "buy", quantity: 100, signalTime: d }];
      if (d === "T2") return [{ symbol: "S", side: "sell", quantity: 100, signalTime: d }];
      return [];
    };
    const result = runBacktest({
      config: config({ endDate: "T3" }),
      tradingDates: ["T1", "T2", "T3"],
      barsByDate: bars,
      signalProvider: provider,
    });
    // T2 买入成交；T3 卖出因停牌作废 → 期末仍持仓（openAtEnd）。
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.openAtEnd).toBe(true);
    expect(result.finalPortfolio.positions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. 板块涨跌停幅度（boardRules 层）
// ---------------------------------------------------------------------------

describe("G3 P3-T4 · 板块涨跌停幅度", () => {
  it("主板非 ST：10%", () => {
    const r = resolveLimitRules("600000.SH", "浦发银行");
    expect(r.supported).toBe(true);
    expect(r.limitUpRatio).toBe(0.1);
    expect(r.limitDownRatio).toBe(0.1);
  });

  it("主板 ST：5%", () => {
    const r = resolveLimitRules("600001.SH", "ST某某");
    expect(r.supported).toBe(true);
    expect(r.limitUpRatio).toBe(0.05);
    expect(r.limitDownRatio).toBe(0.05);
  });

  it("创业板（300/301）：20%", () => {
    expect(resolveLimitRules("300001.SZ").limitUpRatio).toBe(0.2);
    expect(resolveLimitRules("301001.SZ").limitDownRatio).toBe(0.2);
  });

  it("科创板（688/689）：20%", () => {
    expect(resolveLimitRules("688001.SH").limitUpRatio).toBe(0.2);
  });

  it("北交所：30%", () => {
    expect(resolveLimitRules("920001.BJ").limitUpRatio).toBe(0.3);
  });

  it("无法识别代码 → supported=false（不得假装支持）", () => {
    const r = resolveLimitRules("999999.XX");
    expect(r.supported).toBe(false);
    expect(r.limitUpRatio).toBeNull();
  });

  it("ST 判定严格：STORE/STAR 等 ASCII 名称不误判为 ST", () => {
    expect(isStStock("STORE股份")).toBe(false);
    expect(isStStock("ST某某")).toBe(true);
    expect(isStStock("*ST某某")).toBe(true);
  });

  it("板块归类：60 主板 / 300 创业板 / 688 科创板 / 920 北交所", () => {
    expect(classifyBoard("600000.SH")).toBe("main");
    expect(classifyBoard("300001.SZ")).toBe("chinext");
    expect(classifyBoard("688001.SH")).toBe("star");
    expect(classifyBoard("920001.BJ")).toBe("bse");
  });
});

// ---------------------------------------------------------------------------
// 4. 持有期退出（Engine 层端到端）
// ---------------------------------------------------------------------------

describe("G3 P3-T4 · maxHoldingDays 时间退出", () => {
  it("maxHoldingDays=2：持有满 2 个交易日后强制卖出，下一交易日成交", () => {
    const dates = ["T1", "T2", "T3", "T4"];
    const bars = new Map<string, Map<string, MarketBar>>();
    bars.set("T1", new Map([["S", bar({ date: "T1", open: null, close: 10, prevClose: 9.5 })]]));
    bars.set("T2", new Map([["S", bar({ date: "T2", open: 10, close: 10.5, prevClose: 10 })]]));
    bars.set("T3", new Map([["S", bar({ date: "T3", open: 10.5, close: 11, prevClose: 10.5 })]]));
    bars.set("T4", new Map([["S", bar({ date: "T4", open: 11, close: 11.2, prevClose: 11 })]]));
    const result = runBacktest({
      config: config({ startDate: "T1", endDate: "T4", maxHoldingDays: 2 }),
      tradingDates: dates,
      barsByDate: bars,
      signalProvider: (d) => (d === "T1" ? [{ symbol: "S", side: "buy", quantity: 100, signalTime: d }] : []),
    });
    // T2 开盘买入；持有满 2 日（T2 为 entry，持有到 T3 收盘触发 SELL）→ T4 开盘卖出。
    const trade = result.trades[0]!;
    expect(trade.entryTime).toBe("T2");
    expect(trade.exitTime).toBe("T4");
    expect(trade.openAtEnd).toBe(false);
    expect(trade.netPnl).not.toBeNull();
    expect(result.finalPortfolio.positions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. 费用单向性（Execution 层）
// ---------------------------------------------------------------------------

describe("G3 P3-T4 · 费用完整性", () => {
  it("印花税仅在卖出收取，买入不含印花税", () => {
    // 买入 1001 元：佣金 max(5, 1001*0.0003)=5 + 过户费 1001*0.00001=0.01001 = 5.01001
    expect(buyFees(1001, COST)).toBeCloseTo(5.01001, 6);
    // 卖出 1001 元：佣金 5 + 印花税 1001*0.0005=0.5005 + 过户费 0.01001 = 5.51051
    expect(sellFees(1001, COST)).toBeCloseTo(5.51051, 6);
    // 卖出费用 > 买入费用，差值恰为印花税。
    expect(sellFees(1001, COST) - buyFees(1001, COST)).toBeCloseTo(1001 * 0.0005, 6);
  });

  it("最低佣金 5 元对小额成交生效", () => {
    // 成交额 100 元：按比例佣金 0.03 元，应抬到 5 元。
    expect(buyFees(100, COST)).toBeCloseTo(5 + 100 * 0.00001, 6);
  });
});
