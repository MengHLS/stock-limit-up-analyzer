import { describe, expect, it } from "vitest";
import { mapDeclaredMarketRegimeGate } from "../../../server/runWorkbenchAssembly/marketRegimeGate";

describe("mapDeclaredMarketRegimeGate", () => {
  it("未声明 / null / 空对象 ⇒ undefined（行为逐字节不变）", () => {
    expect(mapDeclaredMarketRegimeGate(undefined)).toBeUndefined();
    expect(mapDeclaredMarketRegimeGate(null)).toBeUndefined();
    expect(mapDeclaredMarketRegimeGate({})).toBeUndefined();
  });

  it("合法声明按升序规范化返回，并保留 label", () => {
    const mapped = mapDeclaredMarketRegimeGate({
      blockedDecisionDates: ["2026-01-05", "2025-12-31", "2026-01-02"],
      label: "指数 ≤ MA20",
    });
    expect(mapped).toEqual({
      blockedDecisionDates: ["2025-12-31", "2026-01-02", "2026-01-05"],
      label: "指数 ≤ MA20",
    });
  });

  it("非法形态响亮抛错（不静默降级成「不限制」）", () => {
    expect(() => mapDeclaredMarketRegimeGate([])).toThrow(/必须是对象/);
    expect(() => mapDeclaredMarketRegimeGate({ blockedDecisionDates: [] })).toThrow(/必须是非空数组/);
    expect(() => mapDeclaredMarketRegimeGate({ blockedDecisionDates: ["2026-1-5"] })).toThrow(/YYYY-MM-DD/);
    expect(() =>
      mapDeclaredMarketRegimeGate({ blockedDecisionDates: ["2026-01-05", "2026-01-05"] }),
    ).toThrow(/重复日期/);
    expect(() =>
      mapDeclaredMarketRegimeGate({ blockedDecisionDates: ["2026-01-05"], label: "  " }),
    ).toThrow(/label/);
  });
});
