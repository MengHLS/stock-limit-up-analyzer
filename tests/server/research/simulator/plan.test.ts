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
});
