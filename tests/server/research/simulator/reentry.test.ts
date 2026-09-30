import { describe, expect, it } from "vitest";
import { createReentryBlocker, panelCodeOf } from "../../../../server/research/simulator/reentry";
import { planDecisionDay } from "../../../../server/research/simulator/plan";
import type { CostModel } from "../../../../server/engine/domain";

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 5,
};

const CALENDAR = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12"];
const INDEX = new Map(CALENDAR.map((date, index) => [date, index]));

function trade(securityId: string, exitTime: string | null, openAtEnd = false) {
  return { securityId, exitTime, openAtEnd };
}

describe("panelCodeOf", () => {
  it("从池化 / 事件窗身份解析底层代码", () => {
    expect(panelCodeOf("sec_abc::pool:002805.SZ@2023-06-30")).toBe("002805.SZ");
    expect(panelCodeOf("sec_abc::event:600000.SH@2024-12-25")).toBe("600000.SH");
  });

  it("解析不到后缀时以自身身份兜底（绝不误合并）", () => {
    expect(panelCodeOf("sec_plain")).toBe("sec_plain");
  });
});

describe("createReentryBlocker · 代码冷却", () => {
  const policy = { securityCooldownTradingDays: 2 };

  it("出场当日与冷却窗口内阻断，第 K+1 个交易日放开", () => {
    const trades = [trade("sec_a::pool:002805.SZ@2023-06-30", "2026-01-05")];
    const mk = (date: string) =>
      createReentryBlocker({
        policy,
        decisionDate: date,
        tradingDayIndex: INDEX,
        openSecurityIds: [],
        trades,
      })("sec_b::pool:002805.SZ@2023-10-20");

    expect(mk("2026-01-05")).toBe("REENTRY_COOLDOWN_ACTIVE");
    expect(mk("2026-01-06")).toBe("REENTRY_COOLDOWN_ACTIVE");
    expect(mk("2026-01-07")).toBe("REENTRY_COOLDOWN_ACTIVE");
    expect(mk("2026-01-08")).toBeUndefined();
  });

  it("冷却按交易日计数：跨周末不会提前放开", () => {
    const trades = [trade("sec_a::pool:002805.SZ@2023-06-30", "2026-01-09")];
    const mk = (date: string) =>
      createReentryBlocker({
        policy: { securityCooldownTradingDays: 1 },
        decisionDate: date,
        tradingDayIndex: INDEX,
        openSecurityIds: [],
        trades,
      })("sec_b::pool:002805.SZ@2023-10-20");
    expect(mk("2026-01-09")).toBe("REENTRY_COOLDOWN_ACTIVE");
    expect(mk("2026-01-12")).toBe("REENTRY_COOLDOWN_ACTIVE");
    expect(mk("2026-01-13")).toBeUndefined();
  });

  it("不同代码互不影响", () => {
    const trades = [trade("sec_a::pool:002805.SZ@2023-06-30", "2026-01-05")];
    const blocker = createReentryBlocker({
      policy,
      decisionDate: "2026-01-06",
      tradingDayIndex: INDEX,
      openSecurityIds: [],
      trades,
    });
    expect(blocker("sec_c::pool:600000.SH@2024-01-02")).toBeUndefined();
  });
});

describe("createReentryBlocker · 成员限次与并发上限", () => {
  it("成员买入次数达上限即阻断（1 = 一次性成员）", () => {
    const trades = [
      trade("sec_a::pool:002805.SZ@2023-06-30", "2026-01-05"),
      trade("sec_a::pool:002805.SZ@2023-06-30", "2026-02-02"),
    ];
    const blocker = createReentryBlocker({
      policy: { maxEntriesPerMember: 1 },
      decisionDate: "2026-03-02",
      tradingDayIndex: new Map([["2026-01-05", 0], ["2026-02-02", 1], ["2026-03-02", 2]]),
      openSecurityIds: [],
      trades,
    });
    expect(blocker("sec_a::pool:002805.SZ@2023-06-30")).toBe("MEMBER_ENTRY_LIMIT_REACHED");
    // 同一代码的另一个池身份不受该成员计数影响。
    expect(blocker("sec_b::pool:002805.SZ@2023-10-20")).toBeUndefined();
  });

  it("同代码并发上限：已有在仓成员即阻断新成员", () => {
    const blocker = createReentryBlocker({
      policy: { maxConcurrentOpenPerCode: 1 },
      decisionDate: "2026-01-06",
      tradingDayIndex: INDEX,
      openSecurityIds: ["sec_a::pool:002805.SZ@2023-06-30"],
      trades: [],
    });
    expect(blocker("sec_b::pool:002805.SZ@2023-10-20")).toBe("CONCURRENT_CODE_POSITION_LIMIT");
    expect(blocker("sec_c::pool:600000.SH@2024-01-02")).toBeUndefined();
  });

  it("判定顺序：并发上限优先于冷却与成员限次", () => {
    const blocker = createReentryBlocker({
      policy: {
        maxConcurrentOpenPerCode: 1,
        securityCooldownTradingDays: 5,
        maxEntriesPerMember: 1,
      },
      decisionDate: "2026-01-06",
      tradingDayIndex: INDEX,
      openSecurityIds: ["sec_a::pool:002805.SZ@2023-06-30"],
      trades: [trade("sec_a::pool:002805.SZ@2023-06-30", "2026-01-05")],
    });
    expect(blocker("sec_a::pool:002805.SZ@2023-06-30")).toBe("CONCURRENT_CODE_POSITION_LIMIT");
  });

  it("缺省策略（undefined / 全 null）不阻断任何候选", () => {
    for (const policy of [undefined, {}, { securityCooldownTradingDays: null }]) {
      const blocker = createReentryBlocker({
        policy: policy as never,
        decisionDate: "2026-01-06",
        tradingDayIndex: INDEX,
        openSecurityIds: ["sec_a::pool:002805.SZ@2023-06-30"],
        trades: [trade("sec_a::pool:002805.SZ@2023-06-30", "2026-01-05")],
      });
      expect(blocker("sec_a::pool:002805.SZ@2023-06-30")).toBeUndefined();
    }
  });
});

describe("planDecisionDay · 再入场阻断记账", () => {
  const intent = (securityId: string) => ({
    securityId,
    direction: "long" as const,
    rank: 1,
    percentile: 1,
    weight: 1,
    signalValue: 1,
    confidence: null,
  });

  it("命中阻断时不建仓，并写入对应 skip 码（不静默丢弃）", () => {
    const plan = planDecisionDay({
      decisionDate: "2026-01-06",
      intents: [intent("sec_b::pool:002805.SZ@2023-10-20")],
      holdings: [],
      availableBySecurity: new Map(),
      cash: 100000,
      maxPositions: 5,
      hasNextTradingDay: true,
      closePriceBySecurity: new Map([["sec_b::pool:002805.SZ@2023-10-20", 10]]),
      amountBySecurity: new Map(),
      cost: COST,
      directionPolicy: "longOnly",
      reentryBlocked: new Map([["sec_b::pool:002805.SZ@2023-10-20", "REENTRY_COOLDOWN_ACTIVE"]]),
    });

    expect(plan.orders).toEqual([]);
    expect(plan.skipped.map(entry => entry.code)).toEqual(["REENTRY_COOLDOWN_ACTIVE"]);
  });

  it("未提供 reentryBlocked 时行为与既有实现一致（正常建仓）", () => {
    const plan = planDecisionDay({
      decisionDate: "2026-01-06",
      intents: [intent("sec_b::pool:002805.SZ@2023-10-20")],
      holdings: [],
      availableBySecurity: new Map(),
      cash: 100000,
      maxPositions: 5,
      hasNextTradingDay: true,
      closePriceBySecurity: new Map([["sec_b::pool:002805.SZ@2023-10-20", 10]]),
      amountBySecurity: new Map(),
      cost: COST,
      directionPolicy: "longOnly",
    });
    expect(plan.skipped).toEqual([]);
    expect(plan.orders.length).toBe(1);
  });

  it("被阻断的候选仍算当日 desired：已持仓不因此被卖出", () => {
    const id = "sec_b::pool:002805.SZ@2023-10-20";
    const plan = planDecisionDay({
      decisionDate: "2026-01-06",
      intents: [intent(id)],
      holdings: [id],
      availableBySecurity: new Map([[id, 100]]),
      cash: 0,
      maxPositions: 5,
      hasNextTradingDay: true,
      closePriceBySecurity: new Map([[id, 10]]),
      amountBySecurity: new Map(),
      cost: COST,
      directionPolicy: "longOnly",
      reentryBlocked: new Map([[id, "MEMBER_ENTRY_LIMIT_REACHED"]]),
    });
    expect(plan.orders).toEqual([]);
  });
});
