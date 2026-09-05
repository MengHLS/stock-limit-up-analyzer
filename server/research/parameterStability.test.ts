/**
 * STEP 6.5 — Parameter Stability 测试。
 *
 * 覆盖（§三十八 Parameter Stability）：number / integer / enum / boolean / 多窗口 / 单一参数 /
 * 参数变化 / deterministic。
 */

import { describe, expect, it } from "vitest";
import { analyzeParameterStability } from "./parameterStability";
import type { ResearchParameterSet } from "./types";

describe("Parameter Stability — number / integer", () => {
  it("integer 类型：min/max/mean/median/std/range/dispersion", () => {
    const report = analyzeParameterStability([
      { a: 1 }, { a: 2 }, { a: 3 }, { a: 4 },
    ]);
    const stat = report.parameters.find((p) => p.parameterName === "a")!;
    expect(stat.parameterType).toBe("integer");
    expect(stat.min).toBe(1);
    expect(stat.max).toBe(4);
    expect(stat.mean).toBe(2.5);
    expect(stat.median).toBe(2.5);
    expect(stat.range).toBe(3);
    expect(stat.standardDeviation).toBeCloseTo(Math.sqrt(1.25), 6);
    expect(stat.dispersion).toBeCloseTo(Math.sqrt(1.25) / 2.5, 6);
  });

  it("number（浮点）类型识别", () => {
    const report = analyzeParameterStability([{ a: 1.5 }, { a: 2.5 }, { a: 3.5 }]);
    expect(report.parameters[0]!.parameterType).toBe("number");
    expect(report.parameters[0]!.min).toBe(1.5);
    expect(report.parameters[0]!.max).toBe(3.5);
  });
});

describe("Parameter Stability — enum", () => {
  it("enum：每个值出现次数 / 最常见值 / dispersion", () => {
    const report = analyzeParameterStability([
      { mode: "a" }, { mode: "a" }, { mode: "b" }, { mode: "c" },
    ]);
    const stat = report.parameters[0]!;
    expect(stat.parameterType).toBe("enum");
    expect(stat.uniqueCount).toBe(3);
    expect(stat.frequency).toEqual({ a: 2, b: 1, c: 1 });
    expect(stat.mostCommonValue).toBe("a");
    expect(stat.mostCommonCount).toBe(2);
    expect(stat.dispersion).toBeCloseTo(0.5, 6);
  });
});

describe("Parameter Stability — boolean", () => {
  it("boolean：true/false count / trueRatio / dispersion", () => {
    const report = analyzeParameterStability([
      { useFilter: true }, { useFilter: true }, { useFilter: false },
    ]);
    const stat = report.parameters[0]!;
    expect(stat.parameterType).toBe("boolean");
    expect(stat.trueCount).toBe(2);
    expect(stat.falseCount).toBe(1);
    expect(stat.trueRatio).toBeCloseTo(2 / 3, 6);
    expect(stat.dispersion).toBeCloseTo(1 / 3, 6);
  });
});

describe("Parameter Stability — 多参数 / null / 边界", () => {
  it("多参数：参数名按字典序输出", () => {
    const report = analyzeParameterStability([
      { z: 1, a: "x" },
      { z: 2, a: "y" },
    ]);
    expect(report.parameters.map((p) => p.parameterName)).toEqual(["a", "z"]);
  });

  it("null 值：全 null 视为 enum、唯一取值 null", () => {
    const report = analyzeParameterStability([{ threshold: null }, { threshold: null }]);
    const stat = report.parameters[0]!;
    expect(stat.parameterType).toBe("enum");
    expect(stat.uniqueValues).toEqual([null]);
    expect(stat.mostCommonValue).toBe(null);
    expect(stat.dispersion).toBe(0);
  });

  it("单一参数 / 单窗口", () => {
    const report = analyzeParameterStability([{ k: 7 }]);
    expect(report.windowCount).toBe(1);
    expect(report.parameters[0]!.min).toBe(7);
    expect(report.parameters[0]!.max).toBe(7);
    expect(report.parameters[0]!.dispersion).toBe(0);
  });

  it("参数变化（跨窗口变化）被正确统计", () => {
    const report = analyzeParameterStability([{ k: 1 }, { k: 2 }, { k: 100 }]);
    const stat = report.parameters[0]!;
    expect(stat.min).toBe(1);
    expect(stat.max).toBe(100);
    expect(stat.range).toBe(99);
  });
});

describe("Parameter Stability — 非法输入 / 确定性", () => {
  it("类型跨窗口不一致 → 抛错", () => {
    expect(() => analyzeParameterStability([{ a: 1 }, { a: "x" }])).toThrow(/类型.*不一致|STABILITY_TYPE_MIXED/);
  });

  it("相同输入产生相同输出（deterministic）", () => {
    const input: ResearchParameterSet[] = [
      { k: 1, mode: "a", flag: true },
      { k: 2, mode: "b", flag: false },
      { k: 3, mode: "a", flag: true },
    ];
    expect(analyzeParameterStability(input)).toEqual(analyzeParameterStability(input));
  });

  it("不修改输入（返回独立副本）", () => {
    const input: ResearchParameterSet[] = [{ k: 1 }, { k: 2 }];
    const report = analyzeParameterStability(input);
    report.parameters[0]!.windowValues[0] = 999 as unknown as number;
    expect(input[0]!.k).toBe(1);
  });
});
