import { describe, expect, it } from "vitest";
import { createPoolStIndexFromRows } from "../../../server/runWorkbenchAssembly/poolStIndex";

describe("createPoolStIndexFromRows · PIT ST 判定", () => {
  const index = createPoolStIndexFromRows([
    { securityId: "sec_a", statusValue: "ST", effectiveFrom: "2024-01-10", effectiveTo: "2024-03-05" },
    { securityId: "sec_a", statusValue: "*ST", effectiveFrom: "2024-03-06", effectiveTo: null },
    { securityId: "sec_b", statusValue: "NORMAL", effectiveFrom: "2024-01-01", effectiveTo: null },
  ]);

  it("区间内命中 ST / *ST，区间外与非 ST 取值都视为非 ST", () => {
    expect(index.resolve("sec_a", "2024-01-09")).toBe("NORMAL");
    expect(index.resolve("sec_a", "2024-01-10")).toBe("ST");
    expect(index.resolve("sec_a", "2024-03-05")).toBe("ST");
    expect(index.resolve("sec_a", "2024-03-06")).toBe("*ST");
    expect(index.resolve("sec_a", "2030-01-01")).toBe("*ST");
  });

  it("未知证券 / NORMAL 取值视为非 ST（与建库 filter#isStExcluded 同口径）", () => {
    expect(index.resolve("sec_unknown", "2024-02-01")).toBe("NORMAL");
    expect(index.resolve("sec_b", "2024-02-01")).toBe("NORMAL");
  });

  it("intervalCount 只统计可用的 ST/*ST 区间", () => {
    expect(index.intervalCount).toBe(2);
  });
});
