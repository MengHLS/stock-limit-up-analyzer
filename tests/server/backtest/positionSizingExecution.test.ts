/**
 * BACKTEST-002 — 仓位口径真正生效（B-02）与执行政策（B-01/B-05）。
 *
 * 🔴 判据落在**执行层**（`planDecisionDay` 产出的真实下单股数），不是 helper 单测：
 * 规格 §27 明确禁止「只做 helper + unit test 就报完成」。
 *
 * 本文件证明的唯一一件事：**改仓位参数 ⇒ 实际下单数量真的变** ——
 * 这是「Backtest 可以安全作为参数搜索底座」的前提（规格 §29）。
 */

import { describe, expect, it } from "vitest";
import { planDecisionDay } from "../../../server/research/simulator/plan";
import type { PositionIntent } from "../../../server/research/framework/contract";
import type { CostModel } from "../../../server/engine/domain";
import {
  BACKTEST_EXECUTION_POLICY_VERSION,
  DEFAULT_BACKTEST_EXECUTION_POLICY,
  describeExecutionPolicy,
} from "../../../server/backtest/context";

const COST: CostModel = {
  commissionRate: 0.0003,
  stampDutyRate: 0.001,
  transferFeeRate: 0.00001,
  slippageBps: 10,
  lotSize: 100,
  minCommission: 5,
} as CostModel;

const INITIAL_CAPITAL = 100_000;
const PRICE = 10; // 决策日收盘价 → 一手 1000 元（不含费）

function intent(securityId: string, weight: number): PositionIntent {
  return {
    securityId,
    direction: "long",
    rank: 1,
    percentile: 1,
    weight,
    signalValue: 1,
    confidence: null,
  } as PositionIntent;
}

/** 单候选（weight=1）⇒ 等权现金预算 = 全部可用现金 —— 便于观测仓位口径的上限。 */
function plan(input: {
  readonly positionSizing?: {
    readonly sizingMethod: "EQUAL_WEIGHT" | "FIXED_FRACTION" | "RANK_WEIGHTED" | "FIXED_AMOUNT" | "FIXED_RATIO";
    readonly fraction: number | null;
    readonly fixedAmount: number | null;
  };
  readonly cash?: number;
  readonly candidates?: readonly PositionIntent[];
}) {
  return planDecisionDay({
    decisionDate: "2026-09-12",
    intents: input.candidates ?? [intent("600001.SH", 1)],
    holdings: [],
    availableBySecurity: new Map<string, number>(),
    cash: input.cash ?? INITIAL_CAPITAL,
    maxPositions: 5,
    hasNextTradingDay: true,
    closePriceBySecurity: new Map([["600001.SH", PRICE]]),
    amountBySecurity: new Map<string, number | null>([["600001.SH", 500_000]]),
    cost: COST,
    directionPolicy: "longOnly",
    ...(input.positionSizing !== undefined ? { positionSizing: input.positionSizing } : {}),
    initialCapital: INITIAL_CAPITAL,
  });
}

function buyQuantity(result: ReturnType<typeof plan>): number {
  const order = result.orders.find((item) => item.kind === "buy");
  return order === undefined ? 0 : order.quantity;
}

describe("B-02 — Test A：未声明仓位口径 = 等权现金预算（既有行为逐字不变）", () => {
  it("10 万现金 / 10 元 / 一手 100 股 ⇒ 下单 9900~10000 股（等权全仓，含费估算）", () => {
    const qty = buyQuantity(plan({}));
    expect(qty).toBeGreaterThan(0);
    expect(qty % 100).toBe(0);
    // 等权预算 = 全部现金 ⇒ 约为 100000/10 = 10000 股（费估算使其略低）
    expect(qty).toBeGreaterThanOrEqual(9900);
    expect(qty).toBeLessThanOrEqual(10_000);
  });

  it("显式声明 EQUAL_WEIGHT ⇒ 与未声明逐字段相同", () => {
    const none = plan({});
    const equal = plan({ positionSizing: { sizingMethod: "EQUAL_WEIGHT", fraction: null, fixedAmount: null } });
    expect(JSON.stringify(equal)).toBe(JSON.stringify(none));
  });
});

describe("B-02 — Test B：FIXED_FRACTION 50% ⇒ 成交金额约为基准的一半", () => {
  it("fraction=0.5 ⇒ 目标资金 5 万 ⇒ 下单约 5000 股（基准的一半）", () => {
    const baseline = buyQuantity(plan({}));
    const half = buyQuantity(plan({ positionSizing: { sizingMethod: "FIXED_FRACTION", fraction: 0.5, fixedAmount: null } }));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(baseline);
    // 约一半（整手取整 ⇒ 允许 ±1 手误差）
    expect(Math.abs(half * 2 - baseline)).toBeLessThanOrEqual(200);
  });

  it("fraction=1.0 ⇒ 与基准一致（100% 不产生额外约束）", () => {
    const baseline = buyQuantity(plan({}));
    const full = buyQuantity(plan({ positionSizing: { sizingMethod: "FIXED_FRACTION", fraction: 1, fixedAmount: null } }));
    expect(full).toBe(baseline);
  });
});

describe("B-02 — Test C：FIXED_AMOUNT 真正受金额限制", () => {
  it("fixedAmount=30000 ⇒ 目标 3 万 ⇒ 下单约 3000 股（而非 10000 股）", () => {
    const qty = buyQuantity(plan({ positionSizing: { sizingMethod: "FIXED_AMOUNT", fraction: null, fixedAmount: 30_000 } }));
    expect(qty).toBeGreaterThan(0);
    expect(qty).toBeLessThanOrEqual(3000);
    expect(qty).toBeGreaterThanOrEqual(2900);
  });

  it("fixedAmount 小于一手 ⇒ 不建仓，并给出可辨的 skip 原因", () => {
    const result = plan({ positionSizing: { sizingMethod: "FIXED_AMOUNT", fraction: null, fixedAmount: 500 } });
    expect(result.orders).toHaveLength(0);
    const codes = result.skipped.map((item) => item.code);
    expect(codes.some((code) => code === "BUDGET_BELOW_MIN_LOT" || code === "POSITION_SIZING_ZERO_BUDGET")).toBe(true);
  });

  it("fixedAmount 超过可分配现金 ⇒ 只收窄不放大（仍受现金约束）", () => {
    const qty = buyQuantity(plan({ positionSizing: { sizingMethod: "FIXED_AMOUNT", fraction: null, fixedAmount: 10_000_000 } }));
    const baseline = buyQuantity(plan({}));
    expect(qty).toBe(baseline);
  });
});

describe("§29 — Parameter Sensitivity：0.3 → 0.6 必须改变真实下单数量", () => {
  it("同一决策日、同一候选，仅改 fraction ⇒ 下单股数不同（这是参数搜索可信度的前提）", () => {
    const a = plan({ positionSizing: { sizingMethod: "FIXED_FRACTION", fraction: 0.3, fixedAmount: null } });
    const b = plan({ positionSizing: { sizingMethod: "FIXED_FRACTION", fraction: 0.6, fixedAmount: null } });
    const qa = buyQuantity(a);
    const qb = buyQuantity(b);
    expect(qa).toBeGreaterThan(0);
    expect(qb).toBeGreaterThan(qa);
    // 0.6 的目标资金恰好是 0.3 的两倍 ⇒ 股数应约为两倍（整手取整允许 ±1 手）
    expect(Math.abs(qb - qa * 2)).toBeLessThanOrEqual(200);
    // 结果对象**确实不同**（不是「参数变了但结果一样」）
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("改造前的缺陷形态（改参数结果不变）不再复现：多档 fraction 得到单调递增的股数", () => {
    const quantities = [0.1, 0.3, 0.6, 1].map((fraction) =>
      buyQuantity(plan({ positionSizing: { sizingMethod: "FIXED_FRACTION", fraction, fixedAmount: null } })),
    );
    for (let index = 1; index < quantities.length; index += 1) {
      expect(quantities[index]!).toBeGreaterThanOrEqual(quantities[index - 1]!);
    }
    expect(quantities[3]!).toBeGreaterThan(quantities[0]!);
  });

  it("fraction 缺失 / 非法 ⇒ 响亮抛错（不静默回落等权）", () => {
    expect(() => plan({ positionSizing: { sizingMethod: "FIXED_FRACTION", fraction: null, fixedAmount: null } })).toThrowError(
      /缺有效 fraction/,
    );
    expect(() => plan({ positionSizing: { sizingMethod: "FIXED_FRACTION", fraction: 0, fixedAmount: null } })).toThrowError(
      /缺有效 fraction/,
    );
  });

  it("RISK_BASED ⇒ 未实现即拒绝（不静默按等权）", () => {
    expect(() => plan({ positionSizing: { sizingMethod: "RISK_BASED", fraction: null, fixedAmount: null } })).toThrowError(
      /RISK_BASED 未实现/,
    );
  });
});

describe("确定性 — 同输入两次 ⇒ 逐字节相同", () => {
  it("同仓位口径重复调用 ⇒ 计划完全相同", () => {
    const sizing = { sizingMethod: "FIXED_FRACTION" as const, fraction: 0.4, fixedAmount: null };
    expect(JSON.stringify(plan({ positionSizing: sizing }))).toBe(JSON.stringify(plan({ positionSizing: sizing })));
  });
});

describe("B-01 / B-05 — 执行政策版本与零成交量政策", () => {
  it("政策版本常量存在且为 v1；默认政策含零成交量 REJECT", () => {
    expect(BACKTEST_EXECUTION_POLICY_VERSION).toBe(1);
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY.zeroVolumePolicy).toBe("REJECT");
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY.blockLimitUpBuys).toBe(true);
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY.blockLimitDownSells).toBe(true);
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY.tPlus1).toBe(true);
    expect(DEFAULT_BACKTEST_EXECUTION_POLICY.suspensionPolicy).toBe("REJECT");
  });

  it("政策说明文案必须同时含「涨停不可买」「跌停不可卖」「成交量为 0」「版本号」", () => {
    const text = describeExecutionPolicy(DEFAULT_BACKTEST_EXECUTION_POLICY).join(" ");
    expect(text).toContain("涨停不可买");
    expect(text).toContain("跌停不可卖");
    expect(text).toContain("成交量为 0");
    expect(text).toContain("执行政策版本 = v1");
  });

  it("把零成交量政策改成 IGNORE 时文案必须带警告（防静默宽松）", () => {
    const text = describeExecutionPolicy({ ...DEFAULT_BACKTEST_EXECUTION_POLICY, zeroVolumePolicy: "IGNORE" }).join(" ");
    expect(text).toContain("⚠️");
  });
});
