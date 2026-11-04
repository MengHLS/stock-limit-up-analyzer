/** P7 · CarryRefreshV1 纯计算测试。 */
import { describe, expect, it } from "vitest";
import {
  CARRY_REFRESH_COMPONENT_IDS,
  computeCarryRefreshComponents,
  fuseCarryRefreshIntoBaseScore,
} from "../../../../server/research/recipeFeatures/carryRefreshScoreFeatures";

function bars(closes: readonly number[]) {
  return closes.map((close, index) => ({
    symbol: "TEST",
    timestamp: "2026-03-" + String(index + 1).padStart(2, "0"),
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 1,
    amount: close,
    turnoverRate: null,
    adjustment: "raw" as const,
  }));
}

describe("CarryRefreshV1", () => {
  it("6 根 bar 的三分量方向与 v2 一致", () => {
    const components = computeCarryRefreshComponents(bars([10, 9.8, 9.7, 9.9, 10.1, 10.2]));
    expect(components).not.toBeNull();
    expect(CARRY_REFRESH_COMPONENT_IDS).toEqual(["pullbackDepth", "negMomentum", "negWindowGap"]);
    expect(components!.pullbackDepth).toBeCloseTo(0, 12);
    expect(components!.negMomentum).toBeCloseTo(-0.02, 12);
    expect(components!.negWindowGap).toBeCloseTo(-0.0251256281, 9);
  });

  it("7/8 根 bar 允许当日延长窗口；超过 8 根响亮抛错", () => {
    const seven = computeCarryRefreshComponents(bars([10, 9.8, 9.7, 9.9, 10.1, 10.2, 10.3]));
    const eight = computeCarryRefreshComponents(bars([10, 9.8, 9.7, 9.9, 10.1, 10.2, 10.3, 10.4]));
    expect(seven).not.toBeNull();
    expect(eight).not.toBeNull();
    expect(() => computeCarryRefreshComponents(bars([10, 9.8, 9.7, 9.9, 10.1, 10.2, 10.3, 10.4, 10.5]))).toThrow(
      "CarryRefreshV1",
    );
  });

  it("少于 6 根返回 null；缺失 close 返回 null", () => {
    expect(computeCarryRefreshComponents(bars([10, 9.9, 9.8, 9.7, 9.6]))).toBeNull();
    const missing = [...bars([10, 9.8, 9.7, 9.9, 10.1, 10.2])];
    missing[3] = { ...missing[3]!, close: null };
    expect(computeCarryRefreshComponents(missing)).toBeNull();
  });

  it("融合权重 0/1 与 [0,1] 校验", () => {
    expect(fuseCarryRefreshIntoBaseScore(0.8, 0.2, 0)).toBe(0.8);
    expect(fuseCarryRefreshIntoBaseScore(0.8, 0.2, 1)).toBe(0.2);
    expect(() => fuseCarryRefreshIntoBaseScore(0.8, 0.2, 1.1)).toThrow("[0,1]");
  });
});
