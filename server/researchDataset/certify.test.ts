/**
 * STEP DS-V2 — Research Dataset Certification 决策树测试（C-12.6.3）。
 * 纯函数、确定性：无 DB、无 IO。
 */

import { describe, expect, it } from "vitest";
import { certifyResearchDataset } from "./certify";
import type { DatasetCapabilityFacts } from "./certify";
import type { ResearchDataset, ResearchDatasetPolicy } from "./types";

/** 最小 policySet（certify 只依赖 pit + survivorship 存在性）。 */
function policy(id: string, value: Record<string, unknown>): ResearchDatasetPolicy {
  return {
    policyId: id as ResearchDatasetPolicy["policyId"],
    class: id as ResearchDatasetPolicy["class"],
    name: id,
    description: "",
    value,
    evidence: [],
  };
}

const FACTS: DatasetCapabilityFacts = {
  industryHistoricalPit: "CONDITIONAL",
  liquidityHistoricalCoverage: "CONDITIONAL",
  corporateActionPit: "CONDITIONAL",
};

function makeDataset(
  gate: ResearchDataset["gate"],
  asOfPerTradeDate: boolean,
  gateNotes: string[] = [],
): ResearchDataset {
  const policySet: ResearchDatasetPolicy[] = [
    policy("pit", {
      mode: asOfPerTradeDate ? "asOfPerTradeDate" : "fixed",
      asOf: asOfPerTradeDate ? null : "2026-09-04",
    }),
    policy("survivorship", {
      membershipIsPointInTime: true,
      masterIncludesDelistedSecurities: true,
      delistedNotRenderedAsEligibleRows: true,
    }),
  ];
  return {
    datasetVersion: "rd-1.0.0-1-abcdef0123456789",
    universeDefinition: { rule: "", asOfDescription: "", days: [] },
    policySet,
    dataSnapshot: {
      capturedAt: "",
      request: {
        name: "test",
        startDate: "2024-01-02",
        endDate: "2024-01-05",
        asOfPerTradeDate,
        asOf: asOfPerTradeDate ? null : "2026-09-04",
        coreIndexCodes: [],
      },
      calendarName: "test",
      calendarFirstDate: "",
      calendarLastDate: "",
      tradingDays: 1,
      domains: [],
      coverageGaps: [],
    },
    rows: [],
    gate,
    gateNotes,
  } as unknown as ResearchDataset;
}

describe("certifyResearchDataset 决策树", () => {
  it("gate=FAIL → REJECTED", () => {
    const result = certifyResearchDataset(makeDataset("FAIL", true, ["缺数据"]), {}, FACTS);
    expect(result.status).toBe("REJECTED");
    expect(result.researchSafe).toBe(false);
  });

  it("gate=INCONCLUSIVE → CONDITIONAL", () => {
    const result = certifyResearchDataset(makeDataset("INCONCLUSIVE", true, ["证据不足"]), {}, FACTS);
    expect(result.status).toBe("CONDITIONAL");
    expect(result.researchSafe).toBe(false);
  });

  it("gate=PASS 且固定快照 → CONDITIONAL（NON_RESEARCH_SAFE）", () => {
    const result = certifyResearchDataset(makeDataset("PASS", false), {}, FACTS);
    expect(result.status).toBe("CONDITIONAL");
    expect(result.researchSafe).toBe(false);
    expect(result.reasons.some((r) => r.includes("固定快照"))).toBe(true);
  });

  it("gate=PASS + 逐日 PIT + 不依赖 Industry → CERTIFIED", () => {
    const result = certifyResearchDataset(makeDataset("PASS", true), {}, FACTS);
    expect(result.status).toBe("CERTIFIED");
    expect(result.researchSafe).toBe(true);
  });

  it("gate=PASS + 逐日 PIT + 依赖 Industry（历史 PIT CONDITIONAL）→ CONDITIONAL", () => {
    const result = certifyResearchDataset(
      makeDataset("PASS", true),
      { industry: true },
      { ...FACTS, industryHistoricalPit: "CONDITIONAL" },
    );
    expect(result.status).toBe("CONDITIONAL");
    expect(result.reasons.some((r) => r.includes("行业"))).toBe(true);
  });

  it("gate=PASS + 依赖 Industry 但历史 PIT AVAILABLE → CERTIFIED", () => {
    const result = certifyResearchDataset(
      makeDataset("PASS", true),
      { industry: true },
      { ...FACTS, industryHistoricalPit: "AVAILABLE" },
    );
    expect(result.status).toBe("CERTIFIED");
  });

  it("gate=PASS + 依赖 Liquidity（覆盖 CONDITIONAL）→ CONDITIONAL", () => {
    const result = certifyResearchDataset(
      makeDataset("PASS", true),
      { liquidity: true },
      FACTS,
    );
    expect(result.status).toBe("CONDITIONAL");
    expect(result.reasons.some((r) => r.includes("流动性"))).toBe(true);
  });

  it("policySet 缺失 pit/survivorship → CONDITIONAL（防篡改护栏）", () => {
    const ds = makeDataset("PASS", true);
    ds.policySet = [];
    const result = certifyResearchDataset(ds, {}, FACTS);
    expect(result.status).toBe("CONDITIONAL");
  });

  it("确定性：同输入两次结果深相等", () => {
    const ds = makeDataset("PASS", true);
    const a = certifyResearchDataset(ds, { industry: true }, FACTS);
    const b = certifyResearchDataset(ds, { industry: true }, FACTS);
    expect(a).toEqual(b);
  });
});
