/**
 * STEP 7.5 — 状态时间线解析 + getSecurityStatus/isTradable 核心测试。
 * 覆盖 §九 10 项必需用例：historical ST / status interval / suspension / resume /
 * listing / delisting / unknown / current≠historical / as-of / no-future-leakage。
 */

import { describe, expect, it } from "vitest";
import { isTradableFromIntervals, isTradableFromSnapshot, resolveSecurityStatus } from "./timeline";
import { suspensionWindowsToStatusIntervals } from "./suspensionAdapter";
import { buildTradingCalendar } from "../security/tradingCalendar";
import type { SecurityStatusInterval } from "./types";

const S1 = "sec_00000000-0000-0000-0000-000000000001";
const S2 = "sec_00000000-0000-0000-0000-000000000002";

function st(
  securityId: string,
  statusType: SecurityStatusInterval["statusType"],
  statusValue: string,
  effectiveFrom: string,
  effectiveTo: string | null,
  overrides: Partial<SecurityStatusInterval> = {},
): SecurityStatusInterval {
  return {
    securityId,
    statusType,
    statusValue,
    effectiveFrom,
    effectiveTo,
    source: "test",
    retrievedAt: null,
    confidence: "high",
    availability: "IMMEDIATE",
    ...overrides,
  };
}

describe("resolveSecurityStatus — as-of 查询", () => {
  it("案例1+8：历史 ST 不回填当前 ST；显式历史区间正确", () => {
    // 当前是 ST（从 2025-07-01 起），历史（2025-03-01）无记录 → 应 unknown，而非 ST。
    const currentOnly = [st(S1, "ST", "ST", "2025-07-01", null)];
    const historical = resolveSecurityStatus(currentOnly, S1, "2025-03-01");
    expect(historical.resolved.ST).toBeUndefined();
    expect(historical.unknownDimensions).toContain("ST");

    // 显式历史区间：NORMAL [01-01, 06-30] → ST [07-01, null]。
    const withHistory = [
      st(S1, "ST", "NORMAL", "2025-01-01", "2025-06-30"),
      st(S1, "ST", "ST", "2025-07-01", null),
    ];
    expect(resolveSecurityStatus(withHistory, S1, "2025-03-01").resolved.ST?.statusValue).toBe("NORMAL");
    expect(resolveSecurityStatus(withHistory, S1, "2025-08-01").resolved.ST?.statusValue).toBe("ST");
  });

  it("案例2：status interval 边界（effectiveFrom/effectiveTo 闭区间）", () => {
    const intervals = [st(S1, "TRADING", "SUSPENDED", "2025-05-01", "2025-05-03")];
    expect(resolveSecurityStatus(intervals, S1, "2025-05-01").resolved.TRADING?.statusValue).toBe("SUSPENDED");
    expect(resolveSecurityStatus(intervals, S1, "2025-05-03").resolved.TRADING?.statusValue).toBe("SUSPENDED");
    expect(resolveSecurityStatus(intervals, S1, "2025-05-04").resolved.TRADING).toBeUndefined();
  });

  it("案例5：listing（上市）与 案例6：delisting（退市）", () => {
    const intervals = [
      st(S1, "LISTING", "NOT_YET_LISTED", "2024-01-01", "2025-01-14"),
      st(S1, "LISTING", "LISTED", "2025-01-15", "2026-01-31"),
      st(S1, "LISTING", "DELISTED", "2026-02-01", null),
    ];
    expect(resolveSecurityStatus(intervals, S1, "2025-01-14").resolved.LISTING?.statusValue).toBe("NOT_YET_LISTED");
    expect(resolveSecurityStatus(intervals, S1, "2025-01-15").resolved.LISTING?.statusValue).toBe("LISTED");
    expect(resolveSecurityStatus(intervals, S1, "2026-02-01").resolved.LISTING?.statusValue).toBe("DELISTED");
  });

  it("案例7：unknown — 无数据维度不默认填充", () => {
    const snapshot = resolveSecurityStatus([], S1, "2025-01-01");
    expect(snapshot.resolved).toEqual({});
    expect(snapshot.unknownDimensions).toHaveLength(5);
  });

  it("案例9：as-of 只解析指定日期；不同日期得不同状态", () => {
    const intervals = [st(S1, "ST", "ST", "2025-07-01", null)];
    expect(resolveSecurityStatus(intervals, S1, "2025-06-30").resolved.ST).toBeUndefined();
    expect(resolveSecurityStatus(intervals, S1, "2025-07-01").resolved.ST?.statusValue).toBe("ST");
  });

  it("案例10：no future leakage — point-in-time asOf 排除未来才可知的状态", () => {
    // T+1 状态：生效 2025-06-01，次一交易日才可知。
    const cal = buildTradingCalendar(["2025-06-01", "2025-06-02", "2025-06-03"]);
    const intervals = [st(S1, "ST", "ST", "2025-06-01", null, { availability: "T_PLUS_1" })];
    const atEffective = resolveSecurityStatus(intervals, S1, "2025-06-01", { asOf: "2025-06-01", calendar: cal });
    expect(atEffective.resolved.ST).toBeUndefined(); // 生效当日尚不可知
    const nextDay = resolveSecurityStatus(intervals, S1, "2025-06-01", { asOf: "2025-06-02", calendar: cal });
    expect(nextDay.resolved.ST?.statusValue).toBe("ST");
  });

  it("asOf=null（全知视角）不排除未来可知状态", () => {
    const intervals = [st(S1, "ST", "ST", "2025-06-01", null, { availability: "T_PLUS_1" })];
    expect(resolveSecurityStatus(intervals, S1, "2025-06-01").resolved.ST?.statusValue).toBe("ST");
  });

  it("多区间重叠：挑最新 effectiveFrom（确定性）", () => {
    const intervals = [
      st(S1, "ST", "ST", "2025-01-01", null, { confidence: "low" }),
      st(S1, "ST", "NORMAL", "2025-02-01", null, { confidence: "high" }),
    ];
    expect(resolveSecurityStatus(intervals, S1, "2025-03-01").resolved.ST?.statusValue).toBe("NORMAL");
  });
});

describe("isTradable（UNKNOWN 不默认 TRADING）", () => {
  it("TRADING=TRADING + LISTED + 无停牌 → true", () => {
    const intervals = [
      st(S1, "LISTING", "LISTED", "2020-01-01", null),
      st(S1, "TRADING", "TRADING", "2020-01-01", null),
    ];
    expect(isTradableFromIntervals(intervals, S1, "2025-01-01")).toBe(true);
  });

  it("TRADING=SUSPENDED → false", () => {
    expect(isTradableFromIntervals([st(S1, "TRADING", "SUSPENDED", "2025-01-01", null)], S1, "2025-01-01")).toBe(false);
  });

  it("TRADING=UNKNOWN → false（不默认 TRADING）", () => {
    expect(isTradableFromIntervals([st(S1, "TRADING", "UNKNOWN", "2025-01-01", null)], S1, "2025-01-01")).toBe(false);
  });

  it("TRADING 缺失 → false", () => {
    expect(isTradableFromIntervals([], S1, "2025-01-01")).toBe(false);
  });

  it("案例3/4：suspension 停牌 + resume 复牌", () => {
    const intervals = [
      st(S1, "LISTING", "LISTED", "2020-01-01", null),
      st(S1, "TRADING", "TRADING", "2020-01-01", null),
      st(S1, "SUSPENSION", "SUSPENDED", "2025-05-01", "2025-05-10"),
    ];
    // 停牌区间内不可交易
    expect(isTradableFromIntervals(intervals, S1, "2025-05-05")).toBe(false);
    // 复牌（区间结束后）可交易
    expect(isTradableFromIntervals(intervals, S1, "2025-05-11")).toBe(true);
  });

  it("LISTING=DELISTED 即使 TRADING=TRADING 也不可交易", () => {
    const intervals = [
      st(S1, "LISTING", "DELISTED", "2026-02-01", null),
      st(S1, "TRADING", "TRADING", "2020-01-01", null),
    ];
    expect(isTradableFromIntervals(intervals, S1, "2026-02-01")).toBe(false);
  });

  it("isTradableFromSnapshot 与 isTradableFromIntervals 一致", () => {
    const intervals = [st(S1, "TRADING", "TRADING", "2020-01-01", null)];
    const snapshot = resolveSecurityStatus(intervals, S1, "2025-01-01");
    expect(isTradableFromSnapshot(snapshot)).toBe(isTradableFromIntervals(intervals, S1, "2025-01-01"));
  });

  it("按 securityId 隔离（不串其它证券的状态）", () => {
    const intervals = [st(S1, "TRADING", "TRADING", "2020-01-01", null)];
    expect(isTradableFromIntervals(intervals, S2, "2025-01-01")).toBe(false);
  });
});

describe("suspensionWindowsToStatusIntervals（停牌适配器）", () => {
  it("解析成功 → SUSPENSION/SUSPENDED；manual 高置信 / 反推中置信", () => {
    const resolver = () => S1;
    const { intervals, unresolvedStockCodes } = suspensionWindowsToStatusIntervals(
      [
        { stockCode: "600984.SH", startDate: "2025-01-01", endDate: "2025-01-10", source: "tushare-daily-infer" },
        { stockCode: "000001.SZ", startDate: "2025-02-01", endDate: "2025-02-05", source: "manual" },
      ],
      resolver,
    );
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toMatchObject({ securityId: S1, statusType: "SUSPENSION", statusValue: "SUSPENDED", confidence: "medium", availability: "UNKNOWN" });
    expect(intervals[1]).toMatchObject({ confidence: "high" });
    expect(unresolvedStockCodes).toEqual([]);
  });

  it("无法解析 code → 跳过并上报，绝不把 stockCode 当 security_id", () => {
    const resolver = (code: string) => (code === "000001.SZ" ? S1 : null);
    const { intervals, unresolvedStockCodes } = suspensionWindowsToStatusIntervals(
      [{ stockCode: "999999.SH", startDate: "2025-01-01", endDate: "2025-01-10", source: "manual" }],
      resolver,
    );
    expect(intervals).toEqual([]);
    expect(unresolvedStockCodes).toEqual(["999999.SH"]);
  });
});
