/**
 * STEP 11 / Work G — Corporate Action → Adjustment → Backtest 集成审计测试。
 *
 * 覆盖任务要求的全部必须场景：
 *   dividend / split / bonus / rights / multiple same-day events / missing event /
 *   factor mismatch / PIT / raw price immutability / portfolio quantity transformation /
 *   portfolio cash transformation / cost basis / realized PnL。
 *
 * 本测试只**新增**，不删除、不修改既有测试；不修改 migration；不修改 raw 历史价格。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../data/types";
import {
  adjustSeriesFromActions,
  buildFactorSeriesFromActions,
  computeGroupForwardFactor,
  AdjustmentError,
  type CorporateAction,
} from "./engine";
import {
  actionsEffectiveOnOrBefore,
  filterActionsKnownAt,
  isCorporateActionKnownAt,
  reconcileForwardFactor,
} from "./integration";
import {
  applyCorporateActionToPosition,
  applyCorporateActionsToPosition,
  type PositionState,
} from "./portfolioTransform";

function rawBar(overrides: Partial<CanonicalMarketBar> = {}): CanonicalMarketBar {
  return {
    symbol: "600519.SH",
    timestamp: "2026-01-05",
    open: 10,
    high: 10.5,
    low: 9.9,
    close: 10,
    preClose: 10,
    volume: 1200,
    amount: 15000,
    turnoverRate: null,
    adjustment: "raw",
    ...overrides,
  };
}

function action(overrides: Partial<CorporateAction> = {}): CorporateAction {
  return {
    securityId: null,
    securityCode: "600519.SH",
    actionType: "dividend",
    effectiveDate: "2026-01-06",
    recordDate: "2026-01-05",
    announcementDate: "2025-12-20",
    cashAmount: null,
    bonusRatio: null,
    transferRatio: null,
    rightsRatio: null,
    rightsPrice: null,
    splitRatio: null,
    source: "baostock",
    retrievedAt: "2026-09-06T00:00:00.000Z",
    description: null,
    ...overrides,
  };
}

function pos(overrides: Partial<PositionState> = {}): PositionState {
  return { quantity: 1000, costBasis: 10000, averageCost: 10, realizedPnL: 0, ...overrides };
}

// ---------------------------------------------------------------------------
// 1. PIT 审计 — 未来公司行为不得提前影响 decisionTime
// ---------------------------------------------------------------------------
describe("PIT 审计 — 未来公司行为不得提前影响 decisionTime", () => {
  it("forward 复权在事件生效前就已反映未来事件（前复权天然含未来函数，需禁用）", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 10 }),
      rawBar({ timestamp: "2026-01-07", close: 5 }), // split 1→2 生效
    ];
    const split = action({ actionType: "split", splitRatio: 2, effectiveDate: "2026-01-07" });
    const factors = buildFactorSeriesFromActions([split], bars);
    // fore(01-05) = 0.5：事件尚未发生（effectiveDate=01-07 未到），但前复权因子已含未来事件。
    expect(factors[0]!.fore).toBeCloseTo(0.5, 10);
    // 这正是「前复权 = look-ahead」的铁证：decisionTime=01-05 时不该知道 01-07 的拆股。
  });

  it("backward 复权在事件生效前不含未来事件（后复权 PIT-safe）", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 10 }),
      rawBar({ timestamp: "2026-01-07", close: 5 }),
    ];
    const split = action({ actionType: "split", splitRatio: 2, effectiveDate: "2026-01-07" });
    const factors = buildFactorSeriesFromActions([split], bars);
    // back(01-05) = 1：生效前不含未来事件。
    expect(factors[0]!.back).toBe(1);
    expect(factors[1]!.back).toBe(1);
    // back(01-07) = 2：事件生效后才反映。
    expect(factors[2]!.back).toBeCloseTo(2, 10);
  });

  it("isCorporateActionKnownAt：announcementDate 决定可知性，而非 effectiveDate", () => {
    const a = action({ effectiveDate: "2026-01-06", announcementDate: "2026-01-03" });
    expect(isCorporateActionKnownAt(a, "2026-01-02")).toBe(false); // 公告未到
    expect(isCorporateActionKnownAt(a, "2026-01-03")).toBe(true); // 公告日当天可知
    expect(isCorporateActionKnownAt(a, "2026-01-05")).toBe(true);
  });

  it("isCorporateActionKnownAt：announcementDate 缺失（null）→ 保守不可知，杜绝 look-ahead", () => {
    const a = action({ effectiveDate: "2026-01-06", announcementDate: null });
    expect(isCorporateActionKnownAt(a, "2026-01-05")).toBe(false);
    expect(isCorporateActionKnownAt(a, "2026-01-10")).toBe(false);
  });

  it("filterActionsKnownAt：未来公告事件被过滤，不泄漏进 decisionTime", () => {
    const known = action({ effectiveDate: "2026-01-05", announcementDate: "2025-12-20" });
    const future = action({
      effectiveDate: "2026-01-08",
      announcementDate: "2026-01-06",
      actionType: "bonus_issue",
      bonusRatio: 1,
    });
    const visible = filterActionsKnownAt([known, future], "2026-01-05");
    expect(visible.map((a) => a.effectiveDate)).toEqual(["2026-01-05"]);
  });

  it("actionsEffectiveOnOrBefore：backward 复权只取已生效事件", () => {
    const past = action({ effectiveDate: "2026-01-05" });
    const future = action({ effectiveDate: "2026-01-08", actionType: "split", splitRatio: 2 });
    const effective = actionsEffectiveOnOrBefore([past, future], "2026-01-06");
    expect(effective.map((a) => a.effectiveDate)).toEqual(["2026-01-05"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Reconciliation — provider 因子 vs semantic 事件反推因子
// ---------------------------------------------------------------------------
describe("Reconciliation — provider 因子 vs semantic 因子", () => {
  it("一致（误差 < 1e-3）→ matches", () => {
    // dividend 1 元，preClose 10 → f = 0.9
    const a = action({ actionType: "dividend", cashAmount: 1 });
    const semantic = computeGroupForwardFactor([a], 10);
    const r = reconcileForwardFactor(semantic, 0.90004); // 模拟 provider 因子
    expect(semantic).toBeCloseTo(0.9, 10);
    expect(r.matches).toBe(true);
    expect(r.relativeError).toBeLessThan(1e-3);
  });

  it("不一致（误差 > 容差）→ 不匹配，可检测 factor mismatch", () => {
    const a = action({ actionType: "dividend", cashAmount: 1 });
    const semantic = computeGroupForwardFactor([a], 10); // 0.9
    const r = reconcileForwardFactor(semantic, 1.0); // provider 认为无事件
    expect(r.matches).toBe(false);
    expect(r.relativeError).toBeGreaterThan(1e-3);
  });

  it("provider 因子非法（0/NaN）→ 不匹配", () => {
    const r = reconcileForwardFactor(0.9, 0);
    expect(r.matches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Missing event — 缺失事件不静默伪造、可检测
// ---------------------------------------------------------------------------
describe("Missing event — 缺失事件不静默伪造", () => {
  it("事件缺失时 adjusted == raw（不崩溃、不发明因子）", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 9 }), // 本应有一次分红，但事件缺失
    ];
    const fwd = adjustSeriesFromActions(bars, [], "forward");
    expect(fwd[0]!.close).toBe(10);
    expect(fwd[1]!.close).toBe(9); // 未复权 → 存在跳空缺口
  });

  it("事件缺失 → 与 provider 因子对账可检测到缺口", () => {
    // provider 因子含一次分红 f=0.9；semantic 侧事件缺失 → semantic f=1。
    const r = reconcileForwardFactor(1.0, 0.9);
    expect(r.matches).toBe(false);
  });

  it("含现金分红的事件早于 raw 序列起点 → 确定性抛错（不静默跳过）", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 9 }),
    ];
    const early = action({
      actionType: "dividend",
      cashAmount: 1,
      effectiveDate: "2025-12-30", // 早于序列起点，无 preClose
    });
    expect(() => buildFactorSeriesFromActions([early], bars)).toThrow(AdjustmentError);
  });
});

// ---------------------------------------------------------------------------
// 4. Raw price immutability — raw 历史价格不可变
// ---------------------------------------------------------------------------
describe("Raw price immutability — raw 历史价格不可变", () => {
  it("复权后 raw OHLCV 逐字节不变，且 adjustment 标记保持 raw", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10, high: 11, low: 9.5 }),
      rawBar({ timestamp: "2026-01-06", close: 9 }),
      rawBar({ timestamp: "2026-01-07", close: 4.5 }),
    ];
    const snapshot = JSON.stringify(bars);
    adjustSeriesFromActions(
      bars,
      [
        action({ actionType: "dividend", cashAmount: 1, effectiveDate: "2026-01-06" }),
        action({ actionType: "split", splitRatio: 2, effectiveDate: "2026-01-07" }),
      ],
      "forward",
    );
    // raw 对象未被原地修改。
    expect(JSON.stringify(bars)).toBe(snapshot);
    for (const b of bars) expect(b.adjustment).toBe("raw");
    // 明确断言 OHLCV 字段值未被改动。
    expect(bars[0]!.open).toBe(10);
    expect(bars[0]!.high).toBe(11);
    expect(bars[0]!.low).toBe(9.5);
    expect(bars[0]!.close).toBe(10);
    expect(bars[0]!.preClose).toBe(10);
    expect(bars[0]!.volume).toBe(1200);
    expect(bars[0]!.amount).toBe(15000);
  });
});

// ---------------------------------------------------------------------------
// 5. Portfolio Corporate Action Transformation（最小设计参考）
// ---------------------------------------------------------------------------
describe("Portfolio Corporate Action Transformation — 数量变换", () => {
  it("split（1 拆 N）→ 股数 ×N、成本基不变、均价 ÷N", () => {
    const r = applyCorporateActionToPosition(pos(), action({ actionType: "split", splitRatio: 2 }));
    expect(r.position.quantity).toBe(2000);
    expect(r.shareDelta).toBe(1000);
    expect(r.cashDelta).toBe(0);
    expect(r.position.costBasis).toBe(10000); // 不变
    expect(r.position.averageCost).toBeCloseTo(5, 10);
    expect(r.realizedPnLDelta).toBe(0);
  });

  it("bonus（送股）→ 股数 ×(1+b)、成本基不变、均价摊薄", () => {
    const r = applyCorporateActionToPosition(pos(), action({ actionType: "bonus_issue", bonusRatio: 0.5 }));
    expect(r.position.quantity).toBe(1500);
    expect(r.shareDelta).toBe(500);
    expect(r.cashDelta).toBe(0);
    expect(r.position.costBasis).toBe(10000);
    expect(r.position.averageCost).toBeCloseTo(10000 / 1500, 10);
  });

  it("transfer（转增）→ 与送股同语义", () => {
    const r = applyCorporateActionToPosition(pos(), action({ actionType: "transfer", transferRatio: 1 }));
    expect(r.position.quantity).toBe(2000);
    expect(r.position.costBasis).toBe(10000);
    expect(r.position.averageCost).toBeCloseTo(5, 10);
  });

  it("reverse_split（N 合 1）→ 股数 ÷N、均价 ×N、成本基不变", () => {
    const r = applyCorporateActionToPosition(pos(), action({ actionType: "reverse_split", splitRatio: 10 }));
    expect(r.position.quantity).toBe(100);
    expect(r.shareDelta).toBe(-900);
    expect(r.position.costBasis).toBe(10000);
    expect(r.position.averageCost).toBeCloseTo(100, 10);
  });
});

describe("Portfolio Corporate Action Transformation — 现金变换", () => {
  it("cash dividend → 现金 += D×q，股数不变，成本基不变", () => {
    const r = applyCorporateActionToPosition(pos(), action({ actionType: "dividend", cashAmount: 1 }));
    expect(r.cashDelta).toBeCloseTo(1000, 10);
    expect(r.position.quantity).toBe(1000);
    expect(r.shareDelta).toBe(0);
    expect(r.position.costBasis).toBe(10000);
    expect(r.position.averageCost).toBeCloseTo(10, 10);
  });

  it("rights issue → 现金 -= s×q×rightsPrice，股数 ×(1+s)，成本基 += 认购支出", () => {
    const r = applyCorporateActionToPosition(
      pos(),
      action({ actionType: "rights_issue", rightsRatio: 0.3, rightsPrice: 5 }),
    );
    expect(r.cashDelta).toBeCloseTo(-0.3 * 1000 * 5, 10); // -1500
    expect(r.position.quantity).toBe(1300);
    expect(r.shareDelta).toBe(300);
    expect(r.position.costBasis).toBeCloseTo(10000 + 1500, 10);
    expect(r.position.averageCost).toBeCloseTo(11500 / 1300, 10);
  });
});

describe("Portfolio Corporate Action Transformation — 成本基与已实现盈亏", () => {
  it("成本基不变量：拆股后按复权价卖出，已实现盈亏与经济等价", () => {
    const before = pos({ quantity: 100, costBasis: 1000, averageCost: 10 });
    // 未拆基准：以 20 元卖出 → 已实现盈亏 = 20×100 - 1000 = 1000
    const baselinePnL = 20 * 100 - 1000;

    // 拆股 1→2 后：股数 200，成本基 1000，均价 5；复权后卖出价 10。
    const r = applyCorporateActionToPosition(before, action({ actionType: "split", splitRatio: 2 }));
    expect(r.position.quantity).toBe(200);
    expect(r.position.costBasis).toBe(1000); // 成本基不因拆股变化
    const splitPnL = 10 * r.position.quantity - r.position.costBasis; // 10×200 - 1000
    expect(splitPnL).toBeCloseTo(baselinePnL, 10);
  });

  it("现金分红计入现金、成本基不变 → 总收益正确（除权后卖出）", () => {
    const before = pos({ quantity: 100, costBasis: 1000, averageCost: 10 });
    // 分红 1 元/股：现金 +100，成本基不变。
    const r = applyCorporateActionToPosition(before, action({ actionType: "dividend", cashAmount: 1 }));
    expect(r.cashDelta).toBeCloseTo(100, 10);
    expect(r.position.costBasis).toBe(1000); // 分红不返还资本
    // 除权后价格 9，卖出：交易盈亏 = 9×100 - 1000 = -100；加分红 +100 → 总收益 0。
    const tradePnL = 9 * r.position.quantity - r.position.costBasis;
    const total = r.cashDelta + tradePnL;
    expect(total).toBeCloseTo(0, 10);
  });

  it("公司行为本身不产生已实现盈亏（realizedPnLDelta 恒 0）", () => {
    for (const a of [
      action({ actionType: "dividend", cashAmount: 1 }),
      action({ actionType: "bonus_issue", bonusRatio: 0.5 }),
      action({ actionType: "rights_issue", rightsRatio: 0.3, rightsPrice: 5 }),
      action({ actionType: "split", splitRatio: 2 }),
      action({ actionType: "reverse_split", splitRatio: 10 }),
    ]) {
      expect(applyCorporateActionToPosition(pos(), a).realizedPnLDelta).toBe(0);
    }
  });
});

describe("Portfolio Corporate Action Transformation — 同日多事件合并", () => {
  it("同日 分红 + 转增 + 配股 → 合并为一次除权（同一 base 股数）", () => {
    // base 1000 股：派 1 元、转 0.5、配 0.2 @5 元。
    const events = [
      action({ actionType: "dividend", cashAmount: 1, effectiveDate: "2026-01-06" }),
      action({ actionType: "transfer", transferRatio: 0.5, effectiveDate: "2026-01-06" }),
      action({ actionType: "rights_issue", rightsRatio: 0.2, rightsPrice: 5, effectiveDate: "2026-01-06" }),
    ];
    const r = applyCorporateActionsToPosition(pos(), events);
    // 股数 = 1000 × (1 + 0.5 + 0.2) = 1700
    expect(r.position.quantity).toBe(1700);
    // 现金 = 分红 +1000 − 配股认购 0.2×1000×5=1000 → 0
    expect(r.cashDelta).toBeCloseTo(0, 10);
    // 成本基 = 10000 + 1000 = 11000
    expect(r.position.costBasis).toBeCloseTo(11000, 10);
    expect(r.position.averageCost).toBeCloseTo(11000 / 1700, 10);
  });

  it("跨日多事件 → 逐日顺序应用，确定性一致", () => {
    const events = [
      action({ actionType: "split", splitRatio: 2, effectiveDate: "2026-01-06" }),
      action({ actionType: "dividend", cashAmount: 1, effectiveDate: "2026-01-08" }),
    ];
    const r1 = applyCorporateActionsToPosition(pos(), events);
    const r2 = applyCorporateActionsToPosition(pos(), events);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2)); // 确定性
    // 拆股后 2000 股，再分红 1 元/股 → 现金 +2000
    expect(r1.position.quantity).toBe(2000);
    expect(r1.cashDelta).toBeCloseTo(2000, 10);
    expect(r1.position.costBasis).toBe(10000);
  });
});
