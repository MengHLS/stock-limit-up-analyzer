/**
 * STEP 12 WORK D — Tushare Corporate Action / Adjustment Factor Provider 单测。
 *
 * 只测纯解析器（parseTushareDividend / parseTushareAdjFactor），不发网络。
 * 覆盖：
 *   1. dividend 现金分红字段解析 + 每股换算（每10股 → 每股 /10）
 *   2. 送股/转增拆分（组合事件拆为多 actionType）
 *   3. PIT 字段映射（ann_date→announcementDate、record_date→recordDate、ex_date→effectiveDate）
 *   4. div_proc 非「实施」行跳过；ex_date 缺失计 missingExDate
 *   5. adj_factor 逐日 → 除权除息日级别（仅变化点，fore=adj/latest、back=adj）
 */

import { describe, expect, it } from "vitest";
import {
  isTusharePermissionLimited,
  parseTushareAdjFactor,
  parseTushareDividend,
  type TusharePayload,
} from "./tushareProvider";

const RETRIEVED = "2026-09-06T00:00:00.000Z";

function dividendPayload(
  items: unknown[][],
  fields: string[] = [
    "ts_code",
    "end_date",
    "ann_date",
    "div_proc",
    "stk_div",
    "stk_bo_rate",
    "stk_co_rate",
    "cash_div",
    "cash_div_tax",
    "record_date",
    "ex_date",
  ]
): TusharePayload {
  return { code: 0, data: { fields, items } };
}

function adjFactorPayload(items: unknown[][]): TusharePayload {
  return {
    code: 0,
    data: { fields: ["ts_code", "trade_date", "adj_factor"], items },
  };
}

describe("parseTushareDividend", () => {
  it("现金分红：每10股派28.02423 → 每股2.802423，PIT 三字段严格区分", () => {
    const payload = dividendPayload([
      // ts_code, end_date, ann_date, div_proc, stk_div, stk_bo_rate, stk_co_rate, cash_div, cash_div_tax, record_date, ex_date
      ["600519.SH", "20251231", "20260417", "实施", 0.0, null, null, 28.02423, 28.02423, "20260625", "20260626"],
      ["600519.SH", "20251231", "20260417", "预案", 0.0, null, null, 0.0, 0.0, null, null],
    ]);
    const { actions, skipped, missingExDate } = parseTushareDividend(payload, {
      retrievedAt: RETRIEVED,
    });
    expect(actions).toHaveLength(1);
    expect(skipped).toBe(1); // 预案 行
    expect(missingExDate).toBe(0);
    const a = actions[0]!;
    expect(a.actionType).toBe("dividend");
    expect(a.cashAmount).toBeCloseTo(2.802423, 10);
    expect(a.securityCode).toBe("600519.SH");
    expect(a.securityId).toBeNull();
    // PIT：公告日 ≠ 登记日 ≠ 除权除息日
    expect(a.announcementDate).toBe("2026-04-17");
    expect(a.recordDate).toBe("2026-06-25");
    expect(a.effectiveDate).toBe("2026-06-26");
    expect(a.announcementDate).not.toBe(a.effectiveDate);
    expect(a.source).toBe("tushare");
  });

  it("组合事件：10送3转7派2 → 拆为 bonus_issue + transfer + dividend 三事件，各持单一 actionType", () => {
    const payload = dividendPayload([
      ["000651.SZ", "20251231", "20260401", "实施", 3.0, 3.0, 7.0, 2.0, 2.0, "20260601", "20260602"],
    ]);
    const { actions } = parseTushareDividend(payload, { retrievedAt: RETRIEVED });
    expect(actions).toHaveLength(3);
    const byType = new Map(actions.map((a) => [a.actionType, a]));
    expect(byType.get("dividend")!.cashAmount).toBeCloseTo(0.2, 10);
    expect(byType.get("bonus_issue")!.bonusRatio).toBeCloseTo(0.3, 10);
    expect(byType.get("transfer")!.transferRatio).toBeCloseTo(0.7, 10);
    // 三事件共享同一 effectiveDate
    expect(new Set(actions.map((a) => a.effectiveDate))).toEqual(new Set(["2026-06-02"]));
  });

  it("送股字段缺失时用 stk_bo_rate 兜底，且不与 stk_div 重复计数", () => {
    const payload = dividendPayload([
      ["000001.SZ", "20251231", "20260401", "实施", null, 2.0, null, null, null, "20260601", "20260602"],
    ]);
    const { actions } = parseTushareDividend(payload, { retrievedAt: RETRIEVED });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.actionType).toBe("bonus_issue");
    expect(actions[0]!.bonusRatio).toBeCloseTo(0.2, 10);
  });

  it("ex_date 缺失：计 missingExDate，不产出事件（禁止假设 effectiveDate）", () => {
    const payload = dividendPayload([
      ["600036.SH", "20251231", "20260401", "实施", 0.0, null, null, 10.0, 10.0, "20260601", null],
    ]);
    const { actions, missingExDate } = parseTushareDividend(payload, {
      retrievedAt: RETRIEVED,
    });
    expect(actions).toHaveLength(0);
    expect(missingExDate).toBe(1);
  });

  it("同批内同 (effectiveDate, actionType) 去重，保留公告日更早者", () => {
    const payload = dividendPayload([
      ["600519.SH", "20241231", "20250520", "实施", 0.0, null, null, 27.673, 27.673, "20250625", "20250626"],
      ["600519.SH", "20241231", "20250403", "实施", 0.0, null, null, 27.673, 27.673, "20250625", "20250626"],
    ]);
    const { actions } = parseTushareDividend(payload, { retrievedAt: RETRIEVED });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.announcementDate).toBe("2025-04-03");
  });
});

describe("parseTushareAdjFactor", () => {
  it("逐日因子只保留变化点；back=adj、fore=adj/latest；首行基线不产出", () => {
    // 升序输入：基线 1.0 → 变化 1.25 → 1.25 → 变化 1.5625
    const payload = adjFactorPayload([
      ["600519.SH", "20200102", 1.0],
      ["600519.SH", "20200103", 1.0],
      ["600519.SH", "20200624", 1.25],
      ["600519.SH", "20200625", 1.25],
      ["600519.SH", "20210625", 1.5625],
      ["600519.SH", "20210626", 1.5625],
    ]);
    const { factors, skipped } = parseTushareAdjFactor(payload, {
      retrievedAt: RETRIEVED,
    });
    expect(skipped).toBe(0);
    expect(factors).toHaveLength(2);
    // 最新因子 = 1.5625
    expect(factors[0]!.effectiveDate).toBe("2020-06-24");
    expect(factors[0]!.backFactor).toBeCloseTo(1.25, 10);
    expect(factors[0]!.foreFactor).toBeCloseTo(1.25 / 1.5625, 10);
    expect(factors[1]!.effectiveDate).toBe("2021-06-25");
    expect(factors[1]!.backFactor).toBeCloseTo(1.5625, 10);
    expect(factors[1]!.foreFactor).toBeCloseTo(1.0, 10);
    expect(factors[1]!.securityCode).toBe("600519.SH");
    expect(factors[1]!.securityId).toBeNull();
    expect(factors[1]!.source).toBe("tushare");
  });

  it("因子非正或日期非法 → 跳过", () => {
    const payload = adjFactorPayload([
      ["600519.SH", "20200102", 0],
      ["600519.SH", "bad-date", 1.5],
      ["600519.SH", "20200624", 1.25],
      ["600519.SH", "20200625", 1.25],
    ]);
    const { factors, skipped } = parseTushareAdjFactor(payload, {
      retrievedAt: RETRIEVED,
    });
    expect(skipped).toBe(2);
    // 20200624 相对 20200625(最新 1.25) 无变化，故无变化点
    expect(factors).toHaveLength(0);
  });
});

describe("isTusharePermissionLimited", () => {
  it("识别 40203/频率超限", () => {
    expect(isTusharePermissionLimited(new Error("40203 频率超限(1次/分钟)"))).toBe(true);
    expect(isTusharePermissionLimited(new Error("普通错误"))).toBe(false);
  });
});
