/**
 * STEP 11-FINAL-FIX — PositionIntent → Signal → Order → Fill → Portfolio 适配层测试。
 *
 * 覆盖：方向映射 / 等权换算 / 单意图映射 / 批量映射 / neutral 跳过 / 端到端链路
 * （PositionIntent 经 positionIntentSignalGenerator 进入 runBacktestEngine2，验证
 *   Order → Fill → Portfolio 真实成交、持仓与权益）。
 */

import { describe, expect, it } from "vitest";
import { InMemoryBarStore } from "../../backtest/dataSource";
import { runBacktestEngine2 } from "../../backtest/engine";
import type { BacktestSpec, Security } from "../../backtest/types";
import type { CostModel } from "../../engine/domain";
import type { CanonicalMarketBar } from "../../data/types";
import type { PositionIntent } from "./contract";
import {
  directionToSide,
  equalWeightSizer,
  positionIntentSignalGenerator,
  positionIntentToSignal,
  positionIntentsToSignals,
} from "./positionIntentAdapter";

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.0005,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 5,
};

function intent(overrides: Partial<PositionIntent> = {}): PositionIntent {
  return {
    securityId: "600001.SH",
    direction: "long",
    rank: 1,
    percentile: 1,
    weight: 0.5,
    signalValue: 12.5,
    confidence: null,
    ...overrides,
  };
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

describe("directionToSide — 方向映射", () => {
  it("long → buy；short → sell；neutral → null（跳过）", () => {
    expect(directionToSide("long")).toBe("buy");
    expect(directionToSide("short")).toBe("sell");
    expect(directionToSide("neutral")).toBeNull();
  });
});

describe("equalWeightSizer — 等权换算", () => {
  it("weight × equity → 目标现金 → 整手股数", () => {
    expect(equalWeightSizer(0.5, { equity: 100_000, price: 10, lotSize: 100 })).toBe(5000);
    expect(equalWeightSizer(0.5, { equity: 100_000, price: 10.5, lotSize: 100 })).toBe(4700);
  });

  it("无价/权重非正/权益非正 → 0（跳过，不静默填 1）", () => {
    expect(equalWeightSizer(0.5, { equity: 100_000, price: null, lotSize: 100 })).toBe(0);
    expect(equalWeightSizer(0, { equity: 100_000, price: 10, lotSize: 100 })).toBe(0);
    expect(equalWeightSizer(0.5, { equity: 0, price: 10, lotSize: 100 })).toBe(0);
  });
});

describe("positionIntentToSignal — 单意图映射", () => {
  it("long 意图 → buy Signal，携带 score 与可读 reason", () => {
    const signal = positionIntentToSignal(intent(), "2026-01-01", equalWeightSizer, {
      equity: 100_000,
      price: 10,
      lotSize: 100,
    });
    expect(signal).not.toBeNull();
    expect(signal!.securityId).toBe("600001.SH");
    expect(signal!.signalTime).toBe("2026-01-01");
    expect(signal!.side).toBe("buy");
    expect(signal!.quantity).toBe(5000);
    expect(signal!.score).toBe(12.5);
    expect(signal!.reason).toContain("rank#1");
  });

  it("neutral 意图 → null（无成交，跳过）", () => {
    expect(
      positionIntentToSignal(intent({ direction: "neutral" }), "2026-01-01", equalWeightSizer, {
        equity: 100_000,
        price: 10,
        lotSize: 100,
      }),
    ).toBeNull();
  });
});

describe("positionIntentsToSignals — 批量映射", () => {
  it("按 price 解析各证券收盘价，保持顺序与确定性", () => {
    const intents = [
      intent({ securityId: "A.SH", weight: 0.5, rank: 1 }),
      intent({ securityId: "B.SH", weight: 0.5, rank: 2 }),
    ];
    const prices = new Map<string, number>([["A.SH", 10], ["B.SH", 20]]);
    const signals = positionIntentsToSignals(intents, "2026-01-01", equalWeightSizer, (id) => prices.get(id) ?? null, {
      equity: 100_000,
    });
    expect(signals).toHaveLength(2);
    expect(signals[0]!.securityId).toBe("A.SH");
    expect(signals[0]!.quantity).toBe(5000); // 50000 / 10 / 100 → 50 手
    expect(signals[1]!.securityId).toBe("B.SH");
    expect(signals[1]!.quantity).toBe(2500); // 50000 / 20 / 100 → 25 手
  });
});

// ---------------------------------------------------------------------------
// 端到端：PositionIntent → Signal → Order → Fill → Portfolio
// ---------------------------------------------------------------------------
describe("端到端链路（STEP 10 → STEP 8）", () => {
  const SEC: Security = { securityId: "600001.SH", board: "main" };

  it("研究意图经引擎执行后真实成交并进入组合", async () => {
    const bars = [
      bar(SEC.securityId, "2026-01-01", { open: 10, close: 10 }),
      bar(SEC.securityId, "2026-01-02", { open: 10.5, close: 11, preClose: 10 }),
      bar(SEC.securityId, "2026-01-03", { open: 11, close: 11.5, preClose: 10.5 }),
    ];
    const store = new InMemoryBarStore({ bars });
    const generator = positionIntentSignalGenerator((date) => {
      // 仅在首个决策日产出买入意图（模拟 runResearchPipeline 的 positionIntents）。
      if (date !== "2026-01-01") return [];
      return [intent({ weight: 0.5 })];
    });
    const spec: BacktestSpec = {
      strategyId: "research-bridge",
      strategyVersion: "1.0.0",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      initialCapital: 100_000,
      cost: COST,
      executionModel: "NEXT_OPEN",
      universe: { id: "U", securities: [SEC] },
      signalGenerator: generator,
    };

    const result = await runBacktestEngine2(store, spec);

    // 信号 → 订单 → 成交链路被打通：1 个信号、1 个订单、1 笔成交。
    expect(result.executionStats.totalSignals).toBe(1);
    expect(result.executionStats.totalOrders).toBe(1);
    expect(result.executionStats.totalFills).toBe(1);

    // 成交进入组合：出现 1 笔交易，数量由等权换算确定（50000 / 10 / 100 × 100 = 5000）。
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.securityId).toBe("600001.SH");
    expect(result.trades[0]!.quantity).toBe(5000);

    // 组合会计：期末持有该证券。
    expect(result.positions.some((p) => p.securityId === "600001.SH" && p.quantity === 5000)).toBe(true);
  });
});
