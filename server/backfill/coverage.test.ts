/**
 * STEP 7.3 — Coverage Detection 测试（§22 / §23 / §34.L）。
 */

import { describe, expect, it } from "vitest";
import { buildCoverageReport, isSuspiciousCoverage, median } from "./coverage";
import { toFinalCheckpoint } from "./checkpoint";

describe("median", () => {
  it("奇数个", () => {
    expect(median([1, 2, 3])).toBe(2);
  });
  it("偶数个", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("空 → null", () => {
    expect(median([])).toBeNull();
  });
});

describe("isSuspiciousCoverage", () => {
  it("低于 baseline × ratio → true", () => {
    expect(isSuspiciousCoverage(4000, 5000, 0.9)).toBe(true);
  });
  it("高于阈值 → false", () => {
    expect(isSuspiciousCoverage(5000, 5000, 0.9)).toBe(false);
  });
  it("baseline 无效 → false", () => {
    expect(isSuspiciousCoverage(4000, 0, 0.9)).toBe(false);
  });
});

describe("buildCoverageReport", () => {
  const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];

  it("目标日期 vs 已完成/缺失日期", () => {
    const checkpoints = [
      toFinalCheckpoint("2026-09-01", "SUCCESS", 1, { rowCount: 5500 }),
      toFinalCheckpoint("2026-09-02", "FAILED", 2),
      // 09-03 无 checkpoint → missing
      toFinalCheckpoint("2026-09-04", "SUCCESS", 1, { rowCount: 5400 }),
    ];
    const report = buildCoverageReport(dates, checkpoints);
    expect(report.targetTradingDates).toBe(4);
    expect(report.completedTradingDates).toBe(2);
    expect(report.failedTradingDates).toBe(1);
    expect(report.missingDates).toEqual(["2026-09-03"]);
    expect(report.failedDates).toEqual(["2026-09-02"]);
  });

  it("低行数日判 SUSPICIOUS", () => {
    const checkpoints = [
      toFinalCheckpoint("2026-09-01", "SUCCESS", 1, { rowCount: 5500 }),
      toFinalCheckpoint("2026-09-02", "SUCCESS", 1, { rowCount: 5400 }),
      toFinalCheckpoint("2026-09-03", "SUCCESS", 1, { rowCount: 5500 }),
      toFinalCheckpoint("2026-09-04", "SUCCESS", 1, { rowCount: 100 }), // 异常低
    ];
    const report = buildCoverageReport(dates, checkpoints, new Map(), 0.9);
    expect(report.suspiciousDates).toContain("2026-09-04");
  });

  it("min/max/avg 行数统计", () => {
    const checkpoints = [
      toFinalCheckpoint("2026-09-01", "SUCCESS", 1, { rowCount: 5000 }),
      toFinalCheckpoint("2026-09-02", "SUCCESS", 1, { rowCount: 6000 }),
    ];
    const report = buildCoverageReport(dates, checkpoints);
    expect(report.minRowsPerDay).toBe(5000);
    expect(report.maxRowsPerDay).toBe(6000);
    expect(report.avgRowsPerDay).toBe(5500);
  });

  it("按年份聚合", () => {
    const checkpoints = [
      toFinalCheckpoint("2019-06-14", "SUCCESS", 1, { rowCount: 3632 }),
      toFinalCheckpoint("2022-06-17", "SUCCESS", 1, { rowCount: 4851 }),
    ];
    const report = buildCoverageReport(["2019-06-14", "2022-06-17"], checkpoints);
    expect(report.perYear.map((y) => y.year)).toEqual([2019, 2022]);
    expect(report.perYear.find((y) => y.year === 2019)?.stockDayRows).toBe(3632);
  });
});
