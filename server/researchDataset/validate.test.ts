/**
 * STEP 12.6 — Research Dataset：请求规范化与校验测试（C-12.6.1）。
 */

import { describe, expect, it } from "vitest";
import {
  normalizeResearchDatasetRequest,
  validateNormalizedResearchDatasetRequest,
} from "./validate";

describe("normalizeResearchDatasetRequest", () => {
  it("应用默认值：逐日 PIT + 4 大核心指数", () => {
    const normalized = normalizeResearchDatasetRequest({
      name: "tradable-daily",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    });
    expect(normalized.asOfPerTradeDate).toBe(true);
    expect(normalized.asOf).toBeNull();
    expect(normalized.coreIndexCodes).toContain("000300.SH");
    expect(normalized.coreIndexCodes).toHaveLength(4);
  });

  it("显式提供 fixed asOf 与 coreIndexCodes 时保留", () => {
    const normalized = normalizeResearchDatasetRequest({
      name: "frozen",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      asOfPerTradeDate: false,
      asOf: "2024-02-01",
      coreIndexCodes: ["000300.SH", "399006.SZ"],
    });
    expect(normalized.asOfPerTradeDate).toBe(false);
    expect(normalized.asOf).toBe("2024-02-01");
    expect(normalized.coreIndexCodes).toEqual(["000300.SH", "399006.SZ"]);
  });
});

describe("validateNormalizedResearchDatasetRequest", () => {
  it("合法请求 → 无问题", () => {
    const request = normalizeResearchDatasetRequest({
      name: "tradable-daily",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    });
    expect(validateNormalizedResearchDatasetRequest(request)).toEqual([]);
  });

  it("非法日期 / 倒序 / 空名 → 报错", () => {
    const request = normalizeResearchDatasetRequest({
      name: "  ",
      startDate: "2024-1-1", // 形态非法（需 YYYY-MM-DD）
      endDate: "not-a-date",
    });
    const issues = validateNormalizedResearchDatasetRequest(request);
    expect(issues.some((i) => i.code === "EMPTY_NAME")).toBe(true);
    expect(issues.some((i) => i.code === "INVALID_START_DATE")).toBe(true);
    expect(issues.some((i) => i.code === "INVALID_END_DATE")).toBe(true);
  });

  it("asOfPerTradeDate=false 缺 asOf → MISSING_AS_OF", () => {
    const request = normalizeResearchDatasetRequest({
      name: "frozen",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      asOfPerTradeDate: false,
    });
    expect(validateNormalizedResearchDatasetRequest(request).map((i) => i.code)).toContain("MISSING_AS_OF");
  });

  it("asOfPerTradeDate=true 且给了 asOf → CONFLICT_AS_OF", () => {
    const request = normalizeResearchDatasetRequest({
      name: "tradable-daily",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      asOf: "2024-02-01",
    });
    expect(validateNormalizedResearchDatasetRequest(request).map((i) => i.code)).toContain("CONFLICT_AS_OF");
  });
});
