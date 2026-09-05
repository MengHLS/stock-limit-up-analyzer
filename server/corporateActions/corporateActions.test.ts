/**
 * STEP 7.7 — Corporate Action & Adjustment 层测试。
 *
 * 覆盖场景（对应规格第九节）：
 *   1. no action           2. dividend         3. split           4. bonus
 *   5. rights issue        6. multiple actions 7. reverse split   8. same-day action
 *   9. historical chain    10. determinism     11. raw preservation
 * 另含：adjusted output / provider 解析 / 校验 / 直接因子复权路径 / 缺 preClose 确定性失败。
 */

import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../data/types";
import {
  adjustSeriesFromActions,
  adjustSeriesFromFactors,
  buildFactorSeriesFromActions,
  computeBackwardFactor,
  computeForwardFactor,
  groupActionsByEffectiveDate,
  AdjustmentError,
  parseBaoStockAdjustFactors,
  parseBaoStockDividendActions,
  toSecurityCode,
  validateAdjustmentFactor,
  validateCorporateAction,
  type AdjustmentFactor,
  type CorporateAction,
} from "./index";

function rawBar(
  overrides: Partial<CanonicalMarketBar> = {}
): CanonicalMarketBar {
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

describe("复权引擎 — 单事件前向因子", () => {
  it("no action → 因子恒 1，adjusted == raw", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05" }),
      rawBar({ timestamp: "2026-01-06", close: 10 }),
    ];
    const factors = buildFactorSeriesFromActions([], bars);
    expect(factors).toHaveLength(2);
    expect(factors.every(f => f.fore === 1 && f.back === 1)).toBe(true);
    const fwd = adjustSeriesFromActions(bars, [], "forward");
    expect(fwd[0]!.close).toBe(10);
    expect(fwd[0]!.adjustment).toBe("forward");
  });

  it("dividend → forward = (P0 - D) / P0", () => {
    const a = action({ actionType: "dividend", cashAmount: 1 });
    expect(computeForwardFactor(a, 10)).toBeCloseTo(0.9, 10);
    expect(computeBackwardFactor(a, 10)).toBeCloseTo(1 / 0.9, 10);
  });

  it("split → forward = 1 / N", () => {
    const a = action({ actionType: "split", splitRatio: 2, cashAmount: null });
    expect(computeForwardFactor(a, 10)).toBeCloseTo(0.5, 10);
  });

  it("bonus（送股）→ forward = 1 / (1 + b)", () => {
    const a = action({
      actionType: "bonus_issue",
      bonusRatio: 0.5,
      cashAmount: null,
    });
    expect(computeForwardFactor(a, 10)).toBeCloseTo(1 / 1.5, 10);
  });

  it("rights issue（配股）→ (P0 + s*Pr) / (P0*(1+s))", () => {
    const a = action({
      actionType: "rights_issue",
      rightsRatio: 0.3,
      rightsPrice: 5,
      cashAmount: null,
    });
    expect(computeForwardFactor(a, 10)).toBeCloseTo(11.5 / 13, 10);
  });

  it("reverse split（合股）→ forward = N", () => {
    const a = action({
      actionType: "reverse_split",
      splitRatio: 2,
      cashAmount: null,
    });
    expect(computeForwardFactor(a, 10)).toBeCloseTo(2, 10);
  });

  it("缺 preClose 的现金分红事件 → 确定性抛错", () => {
    const a = action({ actionType: "dividend", cashAmount: 1 });
    expect(() => computeForwardFactor(a, 0)).toThrow(AdjustmentError);
  });
});

describe("复权引擎 — 序列级累计因子与 adjusted 输出", () => {
  it("dividend 序列：前复权消跳空、后复权锚定最早", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10, preClose: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 9, preClose: 10 }),
    ];
    const a = action({
      actionType: "dividend",
      cashAmount: 1,
      effectiveDate: "2026-01-06",
    });
    const fwd = adjustSeriesFromActions(bars, [a], "forward");
    expect(fwd[0]!.close).toBeCloseTo(9, 10); // 10 × 0.9
    expect(fwd[1]!.close).toBeCloseTo(9, 10); // 9 × 1
    const bwd = adjustSeriesFromActions(bars, [a], "backward");
    expect(bwd[0]!.close).toBeCloseTo(10, 10); // 10 × 1
    expect(bwd[1]!.close).toBeCloseTo(10, 10); // 9 × (1/0.9)
  });

  it("multiple actions（分红+拆股）→ 累计链，前复权/后复权均连续", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 9 }),
      rawBar({ timestamp: "2026-01-07", close: 9 }),
      rawBar({ timestamp: "2026-01-08", close: 4.5 }),
    ];
    const events = [
      action({
        actionType: "dividend",
        cashAmount: 1,
        effectiveDate: "2026-01-06",
      }),
      action({
        actionType: "split",
        splitRatio: 2,
        effectiveDate: "2026-01-08",
      }),
    ];
    const factors = buildFactorSeriesFromActions(events, bars);
    // fore: 01-05=0.45, 01-06=0.5, 01-07=0.5, 01-08=1
    expect(factors[0]!.fore).toBeCloseTo(0.45, 10);
    expect(factors[1]!.fore).toBeCloseTo(0.5, 10);
    expect(factors[2]!.fore).toBeCloseTo(0.5, 10);
    expect(factors[3]!.fore).toBeCloseTo(1, 10);
    const fwd = adjustSeriesFromActions(bars, events, "forward");
    for (const b of fwd) expect(b.close).toBeCloseTo(4.5, 10); // 全程连续 4.5
    const bwd = adjustSeriesFromActions(bars, events, "backward");
    for (const b of bwd) expect(b.close).toBeCloseTo(10, 10); // 全程连续 10
  });

  it("same-day action（同日分红+转增）→ 合并为一次除权", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 4.5 }), // (10-1)/2
    ];
    const events = [
      action({
        actionType: "dividend",
        cashAmount: 1,
        effectiveDate: "2026-01-06",
      }),
      action({
        actionType: "transfer",
        transferRatio: 1,
        effectiveDate: "2026-01-06",
      }),
    ];
    // 合并：cash=1, transfer=1 → f=(10-1)/(10*2)=0.45
    const groups = groupActionsByEffectiveDate(events);
    expect(groups).toHaveLength(1);
    const fwd = adjustSeriesFromActions(bars, events, "forward");
    expect(fwd[0]!.close).toBeCloseTo(4.5, 10);
    expect(fwd[1]!.close).toBeCloseTo(4.5, 10);
  });

  it("historical chain：fore 单调趋近 1，back 单调递增", () => {
    const bars = Array.from({ length: 6 }, (_, i) => {
      const d = `2026-01-${String(5 + i).padStart(2, "0")}`;
      return rawBar({ timestamp: d, close: 10 });
    });
    const events = [
      action({
        actionType: "bonus_issue",
        bonusRatio: 1,
        effectiveDate: "2026-01-06",
      }), // f=0.5
      action({
        actionType: "bonus_issue",
        bonusRatio: 1,
        effectiveDate: "2026-01-08",
      }), // f=0.5
    ];
    const factors = buildFactorSeriesFromActions(events, bars);
    const fore = factors.map(f => f.fore);
    const back = factors.map(f => f.back);
    expect(fore).toEqual([...fore].sort((a, b) => a - b)); // 非降
    expect(back).toEqual([...back].sort((a, b) => a - b)); // 非降
    expect(fore[fore.length - 1]).toBe(1);
  });

  it("adjusted output：OHLC 同因子缩放、volume/amount 不变、adjustment 标记正确", () => {
    const bars = [
      rawBar({
        timestamp: "2026-01-05",
        close: 10,
        high: 11,
        low: 9.5,
        open: 10,
        preClose: 10,
      }),
      rawBar({ timestamp: "2026-01-06", close: 5 }),
    ];
    const a = action({
      actionType: "split",
      splitRatio: 2,
      effectiveDate: "2026-01-06",
    });
    const fwd = adjustSeriesFromActions(bars, [a], "forward");
    const first = fwd[0]!;
    expect(first.adjustment).toBe("forward");
    expect(first.close).toBeCloseTo(5, 10);
    expect(first.high).toBeCloseTo(5.5, 10);
    expect(first.low).toBeCloseTo(4.75, 10);
    expect(first.volume).toBe(1200); // 未调整
    expect(first.amount).toBe(15000); // 未调整
  });

  it("determinism：100 次执行结果完全一致", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 9 }),
      rawBar({ timestamp: "2026-01-07", close: 4.5 }),
    ];
    const events = [
      action({
        actionType: "dividend",
        cashAmount: 1,
        effectiveDate: "2026-01-06",
      }),
      action({
        actionType: "split",
        splitRatio: 2,
        effectiveDate: "2026-01-07",
      }),
    ];
    const firstRun = JSON.stringify(
      adjustSeriesFromActions(bars, events, "forward")
    );
    for (let i = 0; i < 100; i += 1) {
      expect(
        JSON.stringify(adjustSeriesFromActions(bars, events, "forward"))
      ).toBe(firstRun);
    }
  });

  it("raw preservation：复权不改动原始 raw bar 对象", () => {
    const bars = [
      rawBar({ timestamp: "2026-01-05", close: 10 }),
      rawBar({ timestamp: "2026-01-06", close: 9 }),
    ];
    const snapshot = JSON.stringify(bars);
    adjustSeriesFromActions(
      bars,
      [
        action({
          actionType: "dividend",
          cashAmount: 1,
          effectiveDate: "2026-01-06",
        }),
      ],
      "forward"
    );
    expect(JSON.stringify(bars)).toBe(snapshot);
    expect(bars[0]!.adjustment).toBe("raw");
    expect(bars[0]!.close).toBe(10);
  });
});

describe("复权引擎 — provider 累计因子直接复权路径", () => {
  const factors: AdjustmentFactor[] = [
    {
      securityId: null,
      securityCode: "600519.SH",
      effectiveDate: "2015-07-17",
      foreFactor: 0.8,
      backFactor: 1.25,
      source: "baostock",
      retrievedAt: "2026-09-06T00:00:00.000Z",
    },
    {
      securityId: null,
      securityCode: "600519.SH",
      effectiveDate: "2016-07-01",
      foreFactor: 1.0,
      backFactor: 1.5625,
      source: "baostock",
      retrievedAt: "2026-09-06T00:00:00.000Z",
    },
  ];

  it("前复权：最新锚定 1，历史按台阶缩放", () => {
    const bars = [
      rawBar({ timestamp: "2015-06-01", close: 10 }), // 早于最早生效日
      rawBar({ timestamp: "2015-08-01", close: 10 }), // 两事件之间
      rawBar({ timestamp: "2017-01-01", close: 10 }), // 晚于最晚生效日
    ];
    const fwd = adjustSeriesFromFactors(bars, factors, "forward");
    // 早于最早：fore = foreFactor(最早)/backFactor(最早) = 0.8/1.25 = 0.64
    expect(fwd[0]!.close).toBeCloseTo(10 * 0.64, 10);
    // 之间：fore = 0.8
    expect(fwd[1]!.close).toBeCloseTo(8, 10);
    // 晚于最晚：fore = 1
    expect(fwd[2]!.close).toBeCloseTo(10, 10);
  });

  it("后复权：最早锚定 1，之后按台阶缩放", () => {
    const bars = [
      rawBar({ timestamp: "2015-06-01", close: 10 }),
      rawBar({ timestamp: "2015-08-01", close: 10 }),
      rawBar({ timestamp: "2017-01-01", close: 10 }),
    ];
    const bwd = adjustSeriesFromFactors(bars, factors, "backward");
    expect(bwd[0]!.close).toBeCloseTo(10, 10); // back = 1
    expect(bwd[1]!.close).toBeCloseTo(12.5, 10); // back = 1.25
    expect(bwd[2]!.close).toBeCloseTo(15.625, 10); // back = 1.5625
  });
});

describe("BaoStock Provider 归一化", () => {
  it("toSecurityCode 转换交易所后缀", () => {
    expect(toSecurityCode("sh.600519")).toBe("600519.SH");
    expect(toSecurityCode("sz.000001")).toBe("000001.SZ");
    expect(toSecurityCode("bj.920001")).toBe("920001.BJ");
    expect(() => toSecurityCode("xx.123")).toThrow();
  });

  it("parseBaoStockAdjustFactors 解析累计因子", () => {
    const { factors, skipped } = parseBaoStockAdjustFactors(
      [["sh.600519", "2015-07-17", "0.792993", "6.081667", "6.081667"]],
      { retrievedAt: "2026-09-06T00:00:00.000Z" }
    );
    expect(skipped).toBe(0);
    expect(factors).toHaveLength(1);
    expect(factors[0]!.securityCode).toBe("600519.SH");
    expect(factors[0]!.securityId).toBeNull();
    expect(factors[0]!.foreFactor).toBeCloseTo(0.792993, 6);
    expect(factors[0]!.backFactor).toBeCloseTo(6.081667, 6);
  });

  it("parseBaoStockDividendActions 拆分组合事件（转增+分红）", () => {
    // "10转10派30元" → cash=3.0, reserve=1.0, stocks=0
    const row = [
      "sz.000651",
      "",
      "",
      "2015-04-28",
      "2015-06-25",
      "2015-07-02",
      "2015-07-03",
      "2015-07-03",
      "",
      "3",
      "2.7或2.85",
      "0.000000",
      "10转10派30元",
      "1.000000",
    ];
    const { actions, skipped } = parseBaoStockDividendActions([row], {
      retrievedAt: "2026-09-06T00:00:00.000Z",
    });
    expect(skipped).toBe(0);
    expect(actions).toHaveLength(2);
    const dividend = actions.find(a => a.actionType === "dividend")!;
    const transfer = actions.find(a => a.actionType === "transfer")!;
    expect(dividend.cashAmount).toBeCloseTo(3, 10);
    expect(dividend.effectiveDate).toBe("2015-07-03");
    expect(transfer.transferRatio).toBeCloseTo(1, 10);
    expect(dividend.announcementDate).toBe("2015-04-28");
  });

  it("parseBaoStockDividendActions 拆分送股+分红（10送1派43.74）", () => {
    const row = [
      "sh.600519",
      "",
      "",
      "2015-04-21",
      "2015-07-10",
      "2015-07-16",
      "2015-07-17",
      "2015-07-17",
      "",
      "4.374",
      "3.9266",
      "0.100000",
      "10送1派43.74元",
      "",
    ];
    const { actions } = parseBaoStockDividendActions([row], {
      retrievedAt: "2026-09-06T00:00:00.000Z",
    });
    expect(actions).toHaveLength(2);
    expect(
      actions.find(a => a.actionType === "bonus_issue")!.bonusRatio
    ).toBeCloseTo(0.1, 10);
    expect(
      actions.find(a => a.actionType === "dividend")!.cashAmount
    ).toBeCloseTo(4.374, 10);
  });
});

describe("数据校验", () => {
  it("合法事件 → VALID", () => {
    expect(
      validateCorporateAction(action({ actionType: "dividend", cashAmount: 1 }))
        .status
    ).toBe("VALID");
  });

  it("非法日期 / 负金额 → INVALID", () => {
    expect(
      validateCorporateAction(action({ effectiveDate: "bad" })).status
    ).toBe("INVALID");
    expect(validateCorporateAction(action({ cashAmount: -1 })).status).toBe(
      "INVALID"
    );
  });

  it("拆分缺 splitRatio → WARNING", () => {
    expect(
      validateCorporateAction(action({ actionType: "split", splitRatio: null }))
        .status
    ).toBe("WARNING");
  });

  it("非法复权因子 → INVALID", () => {
    const f: AdjustmentFactor = {
      securityId: null,
      securityCode: "600519.SH",
      effectiveDate: "2015-07-17",
      foreFactor: 0,
      backFactor: 1,
      source: "baostock",
      retrievedAt: "x",
    };
    expect(validateAdjustmentFactor(f).status).toBe("INVALID");
  });
});
