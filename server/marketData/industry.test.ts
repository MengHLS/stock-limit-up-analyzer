import { describe, it, expect } from "vitest";
import {
  getIndustryAt,
  getIndustryIntervals,
  hasCurrentIndustry,
  industryIntervalsOverlap,
  validateIndustryIntervals,
  type IndustryAssignment,
} from "./industry";

function row(overrides: Partial<IndustryAssignment> = {}): IndustryAssignment {
  return {
    securityId: "002361.SZ",
    industryCode: "801010",
    industryName: "农林牧渔",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    source: "akshare-sw",
    retrievedAt: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("getIndustryAt (as-of)", () => {
  it("命中生效区间返回该行业", () => {
    const assignments = [row({ effectiveFrom: "2020-01-01", effectiveTo: "2022-12-31" })];
    expect(getIndustryAt(assignments, "002361.SZ", "2021-06-15")?.industryCode).toBe("801010");
  });

  it("无归属（日期早于起始）返回 null", () => {
    const assignments = [row({ effectiveFrom: "2020-01-01", effectiveTo: "2022-12-31" })];
    expect(getIndustryAt(assignments, "002361.SZ", "2019-12-31")).toBeNull();
  });

  it("无归属（日期晚于截止）返回 null", () => {
    const assignments = [row({ effectiveFrom: "2020-01-01", effectiveTo: "2022-12-31" })];
    expect(getIndustryAt(assignments, "002361.SZ", "2023-01-01")).toBeNull();
  });

  it("区间边界含端点：effectiveTo 当天仍命中", () => {
    const assignments = [row({ effectiveFrom: "2020-01-01", effectiveTo: "2022-12-31" })];
    expect(getIndustryAt(assignments, "002361.SZ", "2022-12-31")?.industryCode).toBe("801010");
  });

  it("null effectiveTo 视为至今仍有效", () => {
    const assignments = [row({ effectiveFrom: "2020-01-01", effectiveTo: null })];
    expect(getIndustryAt(assignments, "002361.SZ", "2026-09-01")?.industryCode).toBe("801010");
  });

  it("重叠区间命中多个 → 抛错（禁止静默挑一个）", () => {
    const assignments = [
      row({ effectiveFrom: "2020-01-01", effectiveTo: "2022-12-31", industryCode: "801010" }),
      row({ effectiveFrom: "2022-01-01", effectiveTo: null, industryCode: "801020", industryName: "采掘" }),
    ];
    expect(() => getIndustryAt(assignments, "002361.SZ", "2022-06-01")).toThrow(/重叠/);
  });

  it("非法日期 → 抛错", () => {
    expect(() => getIndustryAt([row()], "002361.SZ", "bad")).toThrow(/非法日期/);
  });

  it("不同证券互不干扰", () => {
    const assignments = [row({ securityId: "600000.SH", effectiveFrom: "2020-01-01" })];
    expect(getIndustryAt(assignments, "002361.SZ", "2021-01-01")).toBeNull();
  });
});

describe("industry interval", () => {
  it("按 effectiveFrom 升序返回该证券全部区间", () => {
    const assignments = [
      row({ effectiveFrom: "2021-01-01", effectiveTo: "2022-12-31", industryCode: "801020" }),
      row({ effectiveFrom: "2019-01-01", effectiveTo: "2020-12-31", industryCode: "801010" }),
      row({ securityId: "600000.SH" }),
    ];
    const intervals = getIndustryIntervals(assignments, "002361.SZ");
    expect(intervals.map((r) => r.industryCode)).toEqual(["801010", "801020"]);
  });

  it("industryIntervalsOverlap 判定闭区间重叠", () => {
    const a = row({ effectiveFrom: "2020-01-01", effectiveTo: "2020-12-31" });
    const b = row({ effectiveFrom: "2020-12-31", effectiveTo: "2021-06-01" });
    expect(industryIntervalsOverlap(a, b)).toBe(true);
  });

  it("validateIndustryIntervals 检出重叠", () => {
    const assignments = [
      row({ effectiveFrom: "2020-01-01", effectiveTo: "2022-12-31" }),
      row({ effectiveFrom: "2022-06-01", effectiveTo: null, industryCode: "801020" }),
    ];
    const result = validateIndustryIntervals(assignments, "002361.SZ");
    expect(result.issues.some((issue) => issue.code === "OVERLAPPING_INTERVALS")).toBe(true);
  });

  it("validateIndustryIntervals 检出 from > to", () => {
    const assignments = [row({ effectiveFrom: "2022-12-31", effectiveTo: "2022-01-01" })];
    const result = validateIndustryIntervals(assignments, "002361.SZ");
    expect(result.issues.some((issue) => issue.code === "FROM_AFTER_TO")).toBe(true);
  });

  it("hasCurrentIndustry 识别 effectiveTo=null 的当前行业", () => {
    expect(hasCurrentIndustry([row({ effectiveTo: null })], "002361.SZ")).toBe(true);
    expect(hasCurrentIndustry([row({ effectiveTo: "2022-12-31" })], "002361.SZ")).toBe(false);
  });
});
