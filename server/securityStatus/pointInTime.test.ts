/**
 * STEP 7.5 — Point-in-Time 语义 + 校验 测试。
 */

import { describe, expect, it } from "vitest";
import { isEffectiveOn, isKnowableBy, statusKnowledgeDate } from "./pointInTime";
import { buildTradingCalendar } from "../security/tradingCalendar";
import { isValidStatusValue, validateStatusInterval } from "./validation";
import type { SecurityStatusInterval } from "./types";

const S1 = "sec_00000000-0000-0000-0000-000000000001";

function interval(overrides: Partial<SecurityStatusInterval> = {}): SecurityStatusInterval {
  return {
    securityId: S1,
    statusType: "ST",
    statusValue: "ST",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    source: "test",
    retrievedAt: null,
    confidence: "high",
    availability: "IMMEDIATE",
    ...overrides,
  };
}

describe("isEffectiveOn（区间生效，闭区间）", () => {
  it("闭区间端点生效（from/to 均含）", () => {
    const i = interval({ effectiveFrom: "2025-01-01", effectiveTo: "2025-01-10" });
    expect(isEffectiveOn(i, "2025-01-01")).toBe(true);
    expect(isEffectiveOn(i, "2025-01-10")).toBe(true);
    expect(isEffectiveOn(i, "2025-01-05")).toBe(true);
    expect(isEffectiveOn(i, "2024-12-31")).toBe(false);
    expect(isEffectiveOn(i, "2025-01-11")).toBe(false);
  });

  it("effectiveTo=null 为开放区间（至今）", () => {
    const i = interval({ effectiveFrom: "2025-01-01", effectiveTo: null });
    expect(isEffectiveOn(i, "2025-01-01")).toBe(true);
    expect(isEffectiveOn(i, "2099-12-31")).toBe(true);
  });
});

describe("statusKnowledgeDate（effective 与 retrieved 分离）", () => {
  it("IMMEDIATE → effectiveFrom 当日", () => {
    expect(statusKnowledgeDate(interval({ effectiveFrom: "2025-06-01", availability: "IMMEDIATE" }))).toBe("2025-06-01");
  });

  it("T_PLUS_1 无交易日历 → null（fail-safe，禁止退回自然日）", () => {
    expect(statusKnowledgeDate(interval({ effectiveFrom: "2025-06-30", availability: "T_PLUS_1" }))).toBeNull();
    expect(statusKnowledgeDate(interval({ effectiveFrom: "2025-12-31", availability: "T_PLUS_1" }))).toBeNull();
  });

  it("UNKNOWN + retrievedAt → 取 retrievedAt 日期", () => {
    expect(
      statusKnowledgeDate(interval({ availability: "UNKNOWN", retrievedAt: "2025-06-05T12:00:00.000Z" })),
    ).toBe("2025-06-05");
  });

  it("UNKNOWN 且无 retrievedAt → null（不可用于 as-of 推理）", () => {
    expect(statusKnowledgeDate(interval({ availability: "UNKNOWN", retrievedAt: null }))).toBe(null);
  });
});

describe("isKnowableBy（无未来泄漏）", () => {
  it("asOf 早于可知日 → 不可知；晚于/等于 → 可知", () => {
    const cal = buildTradingCalendar(["2025-06-01", "2025-06-02", "2025-06-03"]);
    const i = interval({ effectiveFrom: "2025-06-01", availability: "T_PLUS_1" }); // 可知日 = 次一交易日 2025-06-02
    expect(isKnowableBy(i, "2025-06-01", cal)).toBe(false);
    expect(isKnowableBy(i, "2025-06-02", cal)).toBe(true);
    expect(isKnowableBy(i, "2025-06-03", cal)).toBe(true);
  });

  it("T_PLUS_1 无交易日历 → 永不可知（fail-safe）", () => {
    const i = interval({ effectiveFrom: "2025-06-01", availability: "T_PLUS_1" });
    expect(isKnowableBy(i, "2025-06-03")).toBe(false);
  });

  it("UNKNOWN 且无 retrievedAt → 任何 asOf 均不可知", () => {
    const i = interval({ availability: "UNKNOWN", retrievedAt: null });
    expect(isKnowableBy(i, "2099-01-01")).toBe(false);
  });
});

describe("validateStatusInterval（校验）", () => {
  it("合法区间 → 无问题", () => {
    expect(validateStatusInterval(interval())).toEqual([]);
  });

  it("非法 security_id / statusType / statusValue / 倒置区间 均报告", () => {
    const issues = validateStatusInterval(
      interval({
        securityId: "not-a-valid-id",
        statusType: "FOO" as never,
        statusValue: "BOGUS",
        effectiveFrom: "2025-02-01",
        effectiveTo: "2025-01-01",
      }),
    );
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain("INVALID_SECURITY_ID");
    expect(codes).toContain("INVALID_STATUS_TYPE");
    expect(codes).toContain("INVERTED_INTERVAL");
  });

  it("isValidStatusValue：ST 维度接受 NORMAL/ST/*ST，拒绝其它", () => {
    expect(isValidStatusValue("ST", "NORMAL")).toBe(true);
    expect(isValidStatusValue("ST", "ST")).toBe(true);
    expect(isValidStatusValue("ST", "*ST")).toBe(true);
    expect(isValidStatusValue("ST", "TRADING")).toBe(false);
  });
});
