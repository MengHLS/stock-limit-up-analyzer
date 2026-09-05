/**
 * STEP 11 / Work D — PIT Full-Chain Audit 对抗性测试（Adversarial Tests）。
 *
 * 目标：用「未来数据 + 历史 decisionTime」验证系统是否 REJECT / EXCLUDE。
 *
 * 本文件分两部分：
 *   1. GUARD 验证（系统当前已正确拒绝/排除未来数据的守卫）—— 应当 PASS。
 *   2. LEAK 暴露（系统当前违反 PIT 的漏洞，断言正确语义，当前 FAIL 即证据）—— 记录 Finding。
 *
 * 禁止：修改 migration / 数据库 / 为测试改变业务语义 / 删除失败测试。
 * 本文件为独立审计产物，不改动任何生产代码。
 */

import { describe, expect, it } from "vitest";
import { visibleBars, type CanonicalMarketBar } from "./data";
import { resolveLimitRules } from "./data/boardRules";
import { LeakageGuard, LookAheadError, type DecisionTime } from "./research/framework/leakage";
import { sameDayAvailability } from "./research/framework/featureProvider";
import { isKnowableBy, statusKnowledgeDate } from "./securityStatus/pointInTime";
import type { SecurityStatusInterval } from "./securityStatus/types";
import { buildTradingCalendar } from "./security/tradingCalendar";
import { getIndustryAt } from "./marketData/industry";
import type { IndustryAssignment } from "./marketData/types";
import { buildFactorSeriesFromActions } from "./corporateActions/engine";
import { filterActionsKnownAt, isCorporateActionKnownAt } from "./corporateActions/integration";
import type { CorporateAction } from "./corporateActions/types";
import { buildAsOfStockNameMap } from "../shared/stockDataNormalization";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function rawBar(symbol: string, timestamp: string, close: number): CanonicalMarketBar {
  return {
    symbol,
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 100,
    amount: 1000,
    turnoverRate: null,
    adjustment: "raw",
  };
}

function statusInterval(overrides: Partial<SecurityStatusInterval> = {}): SecurityStatusInterval {
  return {
    securityId: "sec_00000000-0000-0000-0000-000000000001",
    statusType: "ST",
    statusValue: "ST",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    source: "test",
    retrievedAt: null,
    confidence: "high",
    availability: "IMMEDIATE",
    ...overrides,
  };
}

function industryAssignment(overrides: Partial<IndustryAssignment> = {}): IndustryAssignment {
  return {
    securityId: "600000.SH",
    industryCode: "801010",
    industryName: "农林牧渔",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    source: "test",
    retrievedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function dividend(overrides: Partial<CorporateAction> = {}): CorporateAction {
  return {
    securityId: null,
    securityCode: "600000.SH",
    actionType: "dividend",
    effectiveDate: "2026-01-05",
    recordDate: null,
    announcementDate: null,
    cashAmount: 0.5,
    bonusRatio: null,
    transferRatio: null,
    rightsRatio: null,
    rightsPrice: null,
    splitRatio: null,
    source: "test",
    retrievedAt: "2026-01-06T00:00:00.000Z",
    description: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. GUARD 验证（正确守卫，应 PASS）
// ---------------------------------------------------------------------------

describe("GUARD — visibleBars as-of 过滤（未来 bar 必须排除）", () => {
  it("close 决策：timestamp > decisionDate 的未来 bar 不可见", () => {
    const bars = [rawBar("X", "2026-01-02", 10), rawBar("X", "2026-01-03", 999)];
    const visible = visibleBars(bars, "2026-01-02", "close");
    expect(visible.map((b) => b.timestamp)).toEqual(["2026-01-02"]);
    expect(visible.some((b) => b.close === 999)).toBe(false);
  });

  it("open 决策：decisionDate 当日的完整 bar 亦不可见", () => {
    const bars = [rawBar("X", "2026-01-01", 9), rawBar("X", "2026-01-02", 10)];
    const visible = visibleBars(bars, "2026-01-02", "open");
    expect(visible.map((b) => b.timestamp)).toEqual(["2026-01-01"]);
  });
});

describe("GUARD — LeakageGuard（availableAt / requiredDataThrough 晚于 decisionTime 必须 REJECT）", () => {
  const decisionTime: DecisionTime = { date: "2026-01-02", point: "close" };

  it("availableAt > decisionTime → LookAheadError", () => {
    const availability = {
      requiredDataThrough: decisionTime,
      availableAt: { date: "2026-01-03", point: "open" } as DecisionTime,
    };
    expect(() => LeakageGuard.assertNoLookAhead("f", availability, decisionTime)).toThrow(LookAheadError);
  });

  it("requiredDataThrough > decisionTime → LookAheadError", () => {
    const availability = {
      requiredDataThrough: { date: "2026-01-03", point: "close" } as DecisionTime,
      availableAt: decisionTime,
    };
    expect(() => LeakageGuard.assertNoLookAhead("f", availability, decisionTime)).toThrow(LookAheadError);
  });

  it("同 decisionTime 的 availability 通过守卫", () => {
    const availability = sameDayAvailability(decisionTime, "close", "close");
    expect(() => LeakageGuard.assertNoLookAhead("f", availability, decisionTime)).not.toThrow();
  });
});

describe("GUARD — isKnowableBy 对 UNKNOWN 且无 retrievedAt 的状态 fail-safe", () => {
  it("UNKNOWN + 无 retrievedAt → 任何 asOf 均不可知（不当作 immediately available）", () => {
    const i = statusInterval({ availability: "UNKNOWN", retrievedAt: null });
    expect(isKnowableBy(i, "2099-01-01")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. PIT 修复验证（断言正确语义；已修复，应 PASS）
// ---------------------------------------------------------------------------

describe("PIT 修复 #10 — T_PLUS_1 用交易日而非自然日", () => {
  it("周五生效、T+1 可知日 = 下一交易日（周一），非周六", () => {
    // 2026-01-02 是周五；次一自然日 01-03 是周六（非交易日）；次一交易日是 01-05 周一。
    const cal = buildTradingCalendar(["2026-01-02", "2026-01-05", "2026-01-06"]);
    const i = statusInterval({ effectiveFrom: "2026-01-02", availability: "T_PLUS_1" });
    expect(statusKnowledgeDate(i, cal)).toBe("2026-01-05");
  });

  it("无交易日历时 T_PLUS_1 fail-safe 返回 null（不退回自然日）", () => {
    const i = statusInterval({ effectiveFrom: "2026-01-02", availability: "T_PLUS_1" });
    expect(statusKnowledgeDate(i)).toBeNull();
  });
});

describe("PIT 修复 #8/#2 — 行业归属 as-of 过滤（晚于查询日才获取的行业不可见）", () => {
  it("行业 retrievedAt 晚于 asOf → 该时点不可知（返回 null）", () => {
    const assignment = industryAssignment({
      effectiveFrom: "2025-01-01",
      retrievedAt: "2025-06-01T00:00:00.000Z",
    });
    expect(getIndustryAt([assignment], "600000.SH", "2025-01-10", { asOf: "2025-01-10" })).toBeNull();
  });

  it("行业 retrievedAt 早于或等于 asOf → 可知（返回归属）", () => {
    const assignment = industryAssignment({
      effectiveFrom: "2025-01-01",
      retrievedAt: "2025-06-01T00:00:00.000Z",
    });
    expect(getIndustryAt([assignment], "600000.SH", "2025-06-10", { asOf: "2025-06-10" })?.industryCode).toBe("801010");
  });
});

describe("PIT 修复 #7 — 历史时点用当时名称判 ST（不用最新名称回填）", () => {
  it("历史时点应使用当时名称（非 ST → 10%）", () => {
    const records = [
      { stockCode: "600000.SH", stockName: "平安银行", limitUpDate: "2025-01-10" },
      { stockCode: "600000.SH", stockName: "ST 平安", limitUpDate: "2025-06-01" },
    ];
    // as-of 早期：名称应为「平安银行」；as-of 晚期：名称变为「ST 平安」。
    expect(buildAsOfStockNameMap(records, "2025-01-10").get("600000.SH")).toBe("平安银行");
    expect(buildAsOfStockNameMap(records, "2025-06-01").get("600000.SH")).toBe("ST 平安");
  });

  it("ST 判定影响主板涨跌停比例（5% vs 10%）", () => {
    expect(resolveLimitRules("600000.SH", "平安银行").limitUpRatio).toBe(0.1);
    expect(resolveLimitRules("600000.SH", "ST 平安").limitUpRatio).toBe(0.05);
  });
});

describe("PIT 修复 #4/#5 — 未来公司行为不进入历史决策（announcementDate 可用性）", () => {
  it("announcementDate 晚于 decisionTime → 不可知", () => {
    const futureAction = dividend({ effectiveDate: "2026-01-05", announcementDate: "2026-01-04" });
    expect(isCorporateActionKnownAt(futureAction, "2026-01-02")).toBe(false);
    expect(isCorporateActionKnownAt(futureAction, "2026-01-04")).toBe(true);
  });

  it("filterActionsKnownAt 排除尚未公告的未来分红", () => {
    const futureAction = dividend({ effectiveDate: "2026-01-05", announcementDate: "2026-01-04" });
    expect(filterActionsKnownAt([futureAction], "2026-01-02")).toHaveLength(0);
    expect(filterActionsKnownAt([futureAction], "2026-01-05")).toHaveLength(1);
  });

  it("前复权因子天然包含未来事件 → 禁止用于信号/成交（文档化证据）", () => {
    // 前复权 fore(d) = ∏ f(e) for e.effectiveDate > d，天然把未来事件乘进历史价。
    const futureAction = dividend({ effectiveDate: "2026-01-05", announcementDate: "2026-01-04" });
    const bars = [rawBar("600000.SH", "2026-01-02", 10)];
    const factors = buildFactorSeriesFromActions([futureAction], bars);
    expect(factors[0]!.fore).toBeLessThan(1); // 前复权含未来函数 → 不得进入 SignalDataView / ExecutionModel
  });
});
