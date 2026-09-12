import { describe, expect, it } from "vitest";
import {
  FIELD_COVERAGE_READY_RATIO,
  buildFieldCoverage,
  buildFieldCoverageByDate,
  buildFieldCoverageReport,
  hasFieldValue,
  isFieldCoverageReady,
  resolveThemeWithFallback,
  type FieldAvailabilityRecord,
} from "./fieldAvailability";

const record = (overrides: Partial<FieldAvailabilityRecord> = {}): FieldAvailabilityRecord => ({
  limitUpDate: "2025-08-18",
  limitUpTime: "10:20:00",
  sector: "算力",
  keywords: "算力+液冷",
  ...overrides,
});

describe("字段可用性识别", () => {
  it("空值与纯空白视为缺失", () => {
    expect(hasFieldValue(null)).toBe(false);
    expect(hasFieldValue(undefined)).toBe(false);
    expect(hasFieldValue("")).toBe(false);
    expect(hasFieldValue("   ")).toBe(false);
    expect(hasFieldValue("算力")).toBe(true);
  });

  it("整日缺失（历史未采集）时该字段判定为不可用", () => {
    const records = [record({ limitUpTime: null, sector: null, keywords: null }), record({ limitUpTime: null, sector: null, keywords: null })];
    const coverage = buildFieldCoverage(records, "2025-08-18");
    expect(coverage).toMatchObject({
      date: "2025-08-18",
      totalRecords: 2,
      limitUpTimeRatio: 0,
      sectorRatio: 0,
      keywordsRatio: 0,
      limitUpTimeAvailable: false,
      sectorAvailable: false,
      keywordsAvailable: false,
    });
  });

  it("字段完整时判定为可用，覆盖率 1", () => {
    const coverage = buildFieldCoverage([record(), record()], "2025-08-18");
    expect(coverage.sectorRatio).toBe(1);
    expect(coverage.sectorAvailable).toBe(true);
    expect(coverage.limitUpTimeAvailable).toBe(true);
    expect(coverage.keywordsAvailable).toBe(true);
  });

  it("覆盖率阈值边界：达到阈值算可用，低于阈值算整段缺失", () => {
    expect(FIELD_COVERAGE_READY_RATIO).toBe(0.6);
    expect(isFieldCoverageReady(3, 5)).toBe(true);
    expect(isFieldCoverageReady(2, 5)).toBe(false);
    // 无样本时不构成降级证据。
    expect(isFieldCoverageReady(0, 0)).toBe(true);
    const partial = buildFieldCoverage([
      record({ sector: "算力" }), record({ sector: "算力" }), record({ sector: "算力" }),
      record({ sector: null, limitUpTime: null, keywords: null }), record({ sector: null, limitUpTime: null, keywords: null }),
    ], "2025-08-18");
    expect(partial.sectorRatio).toBe(0.6);
    expect(partial.sectorAvailable).toBe(true);
  });

  it("逐日覆盖表按信号日分组，互不串扰", () => {
    const byDate = buildFieldCoverageByDate([
      record({ limitUpDate: "2025-08-18" }),
      record({ limitUpDate: "2025-08-19", sector: null, keywords: null }),
      record({ limitUpDate: "2025-08-19", sector: null, keywords: null }),
    ]);
    expect(byDate.get("2025-08-18")!.sectorAvailable).toBe(true);
    expect(byDate.get("2025-08-19")!.sectorAvailable).toBe(false);
    expect(byDate.size).toBe(2);
  });
});

describe("字段覆盖报告", () => {
  it("按月聚合降级月份，并给出降级说明", () => {
    const records: FieldAvailabilityRecord[] = [
      record({ limitUpDate: "2025-08-01", limitUpTime: null, sector: null, keywords: null }),
      record({ limitUpDate: "2025-08-02", limitUpTime: null, sector: null, keywords: null }),
      record({ limitUpDate: "2025-11-03" }),
      record({ limitUpDate: "2025-11-04" }),
    ];
    const report = buildFieldCoverageReport(records);
    expect(report.startDate).toBe("2025-08-01");
    expect(report.endDate).toBe("2025-11-04");
    expect(report.totalRecords).toBe(4);
    expect(report.degradedFields).toEqual(["keywords", "limitUpTime", "sector"]);
    expect(report.degradedMonths).toEqual(["2025-08"]);
    expect(report.degradedBuckets).toHaveLength(1);
    expect(report.degradedBuckets[0]!.bucket).toBe("2025-08");
    expect(report.degradedBuckets[0]!.degradedFields).toEqual(["keywords", "limitUpTime", "sector"]);
    expect(report.degradationNotes.length).toBeGreaterThanOrEqual(2);
  });

  it("字段完整时不产生降级月份与说明", () => {
    const report = buildFieldCoverageReport([record({ limitUpDate: "2025-12-01" }), record({ limitUpDate: "2025-12-02" })]);
    expect(report.degradedFields).toEqual([]);
    expect(report.degradedMonths).toEqual([]);
    expect(report.degradationNotes).toEqual([]);
  });
});

describe("题材降级解析", () => {
  it("优先使用 sector", () => {
    expect(resolveThemeWithFallback({ sector: "算力", keywords: "军工+碳纤维" })).toEqual({ theme: "算力", source: "sector" });
  });

  it("sector 缺失时用 keywords 的首个主题词兜底，并去除 OCR 计数后缀", () => {
    expect(resolveThemeWithFallback({ sector: null, keywords: "商业航天*3+军工" })).toEqual({ theme: "商业航天", source: "keywords" });
    expect(resolveThemeWithFallback({ sector: "  ", keywords: "液冷、算力" })).toEqual({ theme: "液冷", source: "keywords" });
  });

  it("sector 与 keywords 都缺失时返回 missing，绝不伪造题材名", () => {
    expect(resolveThemeWithFallback({ sector: null, keywords: null })).toEqual({ theme: null, source: "missing" });
    expect(resolveThemeWithFallback({ sector: "", keywords: "  " })).toEqual({ theme: null, source: "missing" });
  });
});
