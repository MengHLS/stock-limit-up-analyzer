import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../../server/engine/domain";
import { planDecisionDay } from "../../../../server/research/simulator/plan";

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 5,
};

describe("planDecisionDay · 强制退出与候选退出隔离", () => {
  it("无候选意图时只卖被强制退出的持仓，不受影响持仓继续持有", () => {
    const plan = planDecisionDay({
      decisionDate: "2026-01-03",
      intents: [],
      holdings: ["A", "B"],
      availableBySecurity: new Map([["A", 100], ["B", 100]]),
      cash: 0,
      maxPositions: 2,
      hasNextTradingDay: true,
      closePriceBySecurity: new Map([["A", 10], ["B", 10]]),
      amountBySecurity: new Map([["A", null], ["B", null]]),
      cost: COST,
      directionPolicy: "longOnly",
      forcedExitReasons: new Map([["A", "持有满2个交易日"]]),
    });

    expect(plan.orders).toEqual([
      { kind: "sell", securityId: "A", quantity: 100, reason: "持有满2个交易日" },
    ]);
  });

  it("关闭候选退出后，持仓不因不在当日候选中而卖出，但仍执行显式退出", () => {
    const intent = {
      securityId: "B",
      direction: "long" as const,
      rank: 1,
      percentile: 1,
      weight: 1,
      signalValue: 1,
      confidence: null,
    };
    const plan = planDecisionDay({
      decisionDate: "2026-01-04",
      intents: [intent],
      holdings: ["A", "B"],
      candidateExitEnabled: false,
      availableBySecurity: new Map([["A", 100], ["B", 100]]),
      cash: 0,
      maxPositions: 2,
      hasNextTradingDay: true,
      closePriceBySecurity: new Map([["A", 10], ["B", 10]]),
      amountBySecurity: new Map([["A", null], ["B", null]]),
      cost: COST,
      directionPolicy: "longOnly",
      forcedExitReasons: new Map([["A", "持有满5个交易日"]]),
    });

    expect(plan.orders).toEqual([
      { kind: "sell", securityId: "A", quantity: 100, reason: "持有满5个交易日" },
    ]);
  });
});

describe("planDecisionDay · 单日新建仓上限", () => {
  it("按排名只保留前 maxDailyBuys 个买入，其余显式记录跳过原因", () => {
    const intent = (securityId: string, rank: number) => ({
      securityId,
      direction: "long" as const,
      rank,
      percentile: 1,
      weight: 1 / 3,
      signalValue: 1,
      confidence: null,
    });
    const plan = planDecisionDay({
      decisionDate: "2026-01-05",
      intents: [intent("A", 1), intent("B", 2), intent("C", 3)],
      holdings: [],
      availableBySecurity: new Map(),
      cash: 100_000,
      maxPositions: 5,
      maxDailyBuys: 2,
      hasNextTradingDay: true,
      closePriceBySecurity: new Map([
        ["A", 10],
        ["B", 10],
        ["C", 10],
      ]),
      amountBySecurity: new Map([
        ["A", null],
        ["B", null],
        ["C", null],
      ]),
      cost: COST,
      directionPolicy: "longOnly",
    });

    expect(plan.orders).toEqual([
      expect.objectContaining({ kind: "buy", securityId: "A" }),
      expect.objectContaining({ kind: "buy", securityId: "B" }),
    ]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        securityId: "C",
        side: "buy",
        code: "MAX_DAILY_BUYS_REACHED",
      }),
    ]);
  });
});

describe("planDecisionDay · runner 分批退出", () => {
  it("部分卖出只释放对应仓位槽，并允许新候选补入剩余槽", () => {
    const intent = {
      securityId: "B",
      direction: "long" as const,
      rank: 1,
      percentile: 1,
      weight: 1,
      signalValue: 1,
      confidence: null,
    };
    const plan = planDecisionDay({
      decisionDate: "2026-01-06",
      intents: [intent],
      holdings: ["A"],
      availableBySecurity: new Map([["A", 1000]]),
      partialExitOrders: new Map([[
        "A",
        {
          quantity: 500,
          reason: "强势续持第10日减仓50%（剩余仓位转趋势止盈）",
          runnerSlotUsage: 0.5,
        },
      ]]),
      positionSlotUsageBySecurity: new Map([["A", 0.5]]),
      cash: 10_000,
      maxPositions: 1,
      maxDailyBuys: 1,
      hasNextTradingDay: true,
      closePriceBySecurity: new Map([["A", 10], ["B", 10]]),
      amountBySecurity: new Map([["A", null], ["B", null]]),
      cost: COST,
      directionPolicy: "longOnly",
    });

    expect(plan.orders).toEqual([
      {
        kind: "sell",
        securityId: "A",
        quantity: 500,
        reason: "强势续持第10日减仓50%（剩余仓位转趋势止盈）",
        runnerSlotUsage: 0.5,
      },
      expect.objectContaining({ kind: "buy", securityId: "B" }),
    ]);
  });
});
