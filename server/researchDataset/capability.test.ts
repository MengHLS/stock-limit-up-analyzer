/**
 * STEP DS-V2 — Research Dataset Capability Matrix 派生测试（C-12.6.4）。
 * 只测纯函数派生（buildCapabilityMatrix / deriveCapabilityFacts），不碰 DB。
 */

import { describe, expect, it } from "vitest";
import { buildCapabilityMatrix, deriveCapabilityFacts } from "./capability";
import type { DatasetDomainMetadata } from "./capability";

function metadata(overrides: Partial<DatasetDomainMetadata> = {}): DatasetDomainMetadata {
  return {
    securitiesTotal: 5000,
    securitiesDelisted: 337,
    statusIntervals: 100_000,
    statusSecurities: 5000,
    industryRows: 5212,
    industrySecurities: 5212,
    industryEarliestEffectiveFrom: "2026-08-31",
    industryLatestEffectiveFrom: "2026-08-31",
    industryDistinctEffectiveFrom: 1,
    liquidityEarliestDate: "2025-01-02",
    liquidityLatestDate: "2026-09-04",
    corporateActionRows: 8000,
    corporateActionMissingAnnouncement: 500,
    indexEarliestDate: "2019-01-02",
    indexLatestDate: "2026-09-04",
    priceEarliestDate: "2019-01-02",
    priceLatestDate: "2026-09-04",
    ...overrides,
  };
}

describe("deriveCapabilityFacts", () => {
  it("Industry 单期快照 → CONDITIONAL", () => {
    const facts = deriveCapabilityFacts(metadata());
    expect(facts.industryHistoricalPit).toBe("CONDITIONAL");
  });

  it("Industry 多期历史序列 → AVAILABLE", () => {
    const facts = deriveCapabilityFacts(
      metadata({ industryDistinctEffectiveFrom: 120, industryEarliestEffectiveFrom: "2019-01-02" }),
    );
    expect(facts.industryHistoricalPit).toBe("AVAILABLE");
  });

  it("Industry 无数据 → UNAVAILABLE", () => {
    const facts = deriveCapabilityFacts(metadata({ industryRows: 0, industrySecurities: 0 }));
    expect(facts.industryHistoricalPit).toBe("UNAVAILABLE");
  });

  it("Liquidity 未覆盖 OHLCV 全窗口 → CONDITIONAL", () => {
    const facts = deriveCapabilityFacts(metadata());
    expect(facts.liquidityHistoricalCoverage).toBe("CONDITIONAL");
  });

  it("Liquidity 覆盖 OHLCV 全窗口 → AVAILABLE", () => {
    const facts = deriveCapabilityFacts(
      metadata({ liquidityEarliestDate: "2019-01-02", liquidityLatestDate: "2026-09-04" }),
    );
    expect(facts.liquidityHistoricalCoverage).toBe("AVAILABLE");
  });

  it("Corporate Action 有缺失 announcementDate → CONDITIONAL", () => {
    const facts = deriveCapabilityFacts(metadata());
    expect(facts.corporateActionPit).toBe("CONDITIONAL");
  });

  it("Corporate Action announcementDate 齐备 → AVAILABLE", () => {
    const facts = deriveCapabilityFacts(metadata({ corporateActionMissingAnnouncement: 0 }));
    expect(facts.corporateActionPit).toBe("AVAILABLE");
  });
});

describe("buildCapabilityMatrix", () => {
  it("矩阵含 10 个维度，顺序稳定", () => {
    const matrix = buildCapabilityMatrix(metadata());
    expect(matrix.entries).toHaveLength(10);
    expect(matrix.entries.map((e) => e.key)).toEqual([
      "basic",
      "dateRange",
      "universe",
      "historicalState",
      "marketBoardIndustry",
      "liquidityMarketCap",
      "priceCorporateAction",
      "pitSurvivorship",
      "executionCost",
      "marketContext",
    ]);
  });

  it("行业维度诚实标记 CONDITIONAL（不伪造 READY）", () => {
    const matrix = buildCapabilityMatrix(metadata());
    const industry = matrix.entries.find((e) => e.key === "marketBoardIndustry")!;
    expect(industry.status).toBe("CONDITIONAL");
    expect(industry.researchSafe).toBe(false);
  });

  it("PIT/Survivorship 结构性 AVAILABLE", () => {
    const matrix = buildCapabilityMatrix(metadata());
    const pit = matrix.entries.find((e) => e.key === "pitSurvivorship")!;
    expect(pit.status).toBe("AVAILABLE");
    expect(pit.researchSafe).toBe(true);
  });

  it("DB 不可用（全 0）→ 保守降级，无 AVAILABLE 冒名", () => {
    const matrix = buildCapabilityMatrix(metadata({ securitiesTotal: 0, indexEarliestDate: null, priceEarliestDate: null }));
    const dateRange = matrix.entries.find((e) => e.key === "dateRange")!;
    expect(dateRange.status).toBe("UNAVAILABLE");
    const universe = matrix.entries.find((e) => e.key === "universe")!;
    expect(universe.status).toBe("CONDITIONAL");
  });
});
