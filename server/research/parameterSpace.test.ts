/**
 * STEP 6.3 — Parameter Space 校验 + 确定性组合生成 测试。
 *
 * 覆盖（对应验收 §38 1-10、§23-31）：
 *   单/多参数组合、稳定顺序、mutation isolation、非法 step/range、重复参数名/枚举值、
 *   maxCombinations 上限、浮点稳定性、空参数空间、单参数 sweep、边界（min=max、step>range）、
 *   整数精度、布尔顺序、枚举顺序保持。
 */

import { describe, expect, it } from "vitest";
import {
  calculateCombinationCount,
  computeParameterSpaceFingerprint,
  DEFAULT_MAX_COMBINATIONS,
  generateParameterCombinations,
  serializeParameterSpace,
  deserializeParameterSpace,
  validateParameterSpace,
  type ParameterSpace,
} from "./index";

// ---------------------------------------------------------------------------
// 1. 单参数组合
// ---------------------------------------------------------------------------

describe("单参数组合", () => {
  it("integer [5, 10, 15] → 3 组合", () => {
    const space: ParameterSpace = { parameters: [{ type: "integer", name: "lookback", min: 5, max: 15, step: 5 }] };
    const combos = generateParameterCombinations(space);
    expect(combos).toHaveLength(3);
    expect(combos).toEqual([{ lookback: 5 }, { lookback: 10 }, { lookback: 15 }]);
  });
});

// ---------------------------------------------------------------------------
// 2. 多参数笛卡尔积
// ---------------------------------------------------------------------------

describe("多参数笛卡尔积", () => {
  it("A=[1,2] × B=[10,20,30] → 6 组合，顺序稳定", () => {
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "A", min: 1, max: 2, step: 1 },
        { type: "integer", name: "B", min: 10, max: 30, step: 10 },
      ],
    };
    const combos = generateParameterCombinations(space);
    expect(combos).toHaveLength(6);
    expect(combos).toEqual([
      { A: 1, B: 10 },
      { A: 1, B: 20 },
      { A: 1, B: 30 },
      { A: 2, B: 10 },
      { A: 2, B: 20 },
      { A: 2, B: 30 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. 稳定顺序（Determinism）
// ---------------------------------------------------------------------------

describe("稳定顺序", () => {
  it("同一 ParameterSpace 连续生成两次结果 deepEqual（数量/顺序/值）", () => {
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "A", min: 1, max: 3, step: 1 },
        { type: "boolean", name: "flag" },
        { type: "enum", name: "mode", values: ["strict", "normal", "loose"] },
      ],
    };
    const result1 = generateParameterCombinations(space);
    const result2 = generateParameterCombinations(space);
    expect(result2).toEqual(result1);
    expect(result1).toHaveLength(3 * 2 * 3);
  });
});

// ---------------------------------------------------------------------------
// 4. Mutation Isolation
// ---------------------------------------------------------------------------

describe("Mutation Isolation", () => {
  it("修改生成后的 combination 不影响兄弟组合与原始 ParameterSpace", () => {
    const space: ParameterSpace = { parameters: [{ type: "number", name: "foo", min: 1, max: 3, step: 1 }] };
    const combos = generateParameterCombinations(space);

    (combos[0] as Record<string, unknown>).foo = 999;

    expect(combos[1]).toEqual({ foo: 2 });
    expect(space.parameters[0]).toEqual({ type: "number", name: "foo", min: 1, max: 3, step: 1 });
    expect(generateParameterCombinations(space)[0]).toEqual({ foo: 1 });
  });
});

// ---------------------------------------------------------------------------
// 5. Invalid step
// ---------------------------------------------------------------------------

describe("Invalid step", () => {
  it("step=0 / 负数 / NaN / Infinity 全部拒绝", () => {
    expect(validateParameterSpace({ parameters: [{ type: "number", name: "a", min: 0, max: 1, step: 0 }] }).valid).toBe(false);
    expect(validateParameterSpace({ parameters: [{ type: "number", name: "a", min: 0, max: 1, step: -1 }] }).valid).toBe(false);
    expect(validateParameterSpace({ parameters: [{ type: "number", name: "a", min: 0, max: 1, step: Number.NaN }] }).valid).toBe(false);
    expect(validateParameterSpace({ parameters: [{ type: "number", name: "a", min: 0, max: 1, step: Number.POSITIVE_INFINITY }] }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Invalid range
// ---------------------------------------------------------------------------

describe("Invalid range", () => {
  it("min > max 拒绝", () => {
    expect(validateParameterSpace({ parameters: [{ type: "number", name: "a", min: 5, max: 1, step: 1 }] }).valid).toBe(false);
  });

  it("NaN / Infinity min/max 拒绝", () => {
    expect(validateParameterSpace({ parameters: [{ type: "number", name: "a", min: Number.NaN, max: 1, step: 1 }] }).valid).toBe(false);
    expect(validateParameterSpace({ parameters: [{ type: "number", name: "a", min: 0, max: Number.POSITIVE_INFINITY, step: 1 }] }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Duplicate parameter name
// ---------------------------------------------------------------------------

describe("Duplicate parameter name", () => {
  it("同一参数名出现多个 definition 拒绝", () => {
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "a", min: 1, max: 2, step: 1 },
        { type: "integer", name: "a", min: 3, max: 4, step: 1 },
      ],
    };
    const result = validateParameterSpace(space);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "SWEEP_PARAM_NAME_DUPLICATE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Duplicate enum value
// ---------------------------------------------------------------------------

describe("Duplicate enum value", () => {
  it("枚举值重复拒绝", () => {
    const result = validateParameterSpace({ parameters: [{ type: "enum", name: "mode", values: ["strict", "strict"] }] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "SWEEP_PARAM_VALUES_DUPLICATE")).toBe(true);
  });

  it("空枚举值拒绝", () => {
    expect(validateParameterSpace({ parameters: [{ type: "enum", name: "mode", values: [] }] }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. maxCombinations
// ---------------------------------------------------------------------------

describe("maxCombinations", () => {
  it("100 × 100 超过 1000 上限 → 生成前失败（不截断）", () => {
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "x", min: 0, max: 99, step: 1 },
        { type: "integer", name: "y", min: 0, max: 99, step: 1 },
      ],
    };
    expect(calculateCombinationCount(space)).toBe(10_000);
    expect(() => generateParameterCombinations(space, { maxCombinations: 1_000 })).toThrow(/超过上限/);
  });

  it("默认上限 DEFAULT_MAX_COMBINATIONS = 10_000", () => {
    expect(DEFAULT_MAX_COMBINATIONS).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// 10. Floating-point stability
// ---------------------------------------------------------------------------

describe("Floating-point stability", () => {
  it("0.1 → 0.5 step 0.1 精确产出 0.1/0.2/0.3/0.4/0.5（无 0.30000000000000004）", () => {
    const space: ParameterSpace = { parameters: [{ type: "number", name: "threshold", min: 0.1, max: 0.5, step: 0.1 }] };
    const combos = generateParameterCombinations(space);
    expect(combos).toEqual([
      { threshold: 0.1 },
      { threshold: 0.2 },
      { threshold: 0.3 },
      { threshold: 0.4 },
      { threshold: 0.5 },
    ]);
    expect(combos[2].threshold).toBe(0.3);
    expect(String(combos[2].threshold)).toBe("0.3");
  });
});

// ---------------------------------------------------------------------------
// 24. 空参数空间
// ---------------------------------------------------------------------------

describe("空参数空间", () => {
  it("parameters.length === 0 → 1 个空 parameterSet", () => {
    const combos = generateParameterCombinations({ parameters: [] });
    expect(combos).toEqual([{}]);
  });
});

// ---------------------------------------------------------------------------
// 25. 单参数 Sweep
// ---------------------------------------------------------------------------

describe("单参数 Sweep", () => {
  it("lookback 取 3 个值（min=5,max=15,step=5 → [5,10,15]）→ 3 组合", () => {
    const space: ParameterSpace = { parameters: [{ type: "integer", name: "lookback", min: 5, max: 15, step: 5 }] };
    expect(generateParameterCombinations(space)).toHaveLength(3);
    expect(generateParameterCombinations(space)).toEqual([{ lookback: 5 }, { lookback: 10 }, { lookback: 15 }]);
  });
});

// ---------------------------------------------------------------------------
// 26. 多参数 Sweep
// ---------------------------------------------------------------------------

describe("多参数 Sweep", () => {
  it("lookback 3 值 × threshold 2 值 → 6 组合且顺序稳定", () => {
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "lookback", min: 5, max: 15, step: 5 },
        { type: "number", name: "threshold", min: 0.05, max: 0.1, step: 0.05 },
      ],
    };
    const combos = generateParameterCombinations(space);
    expect(combos).toHaveLength(6);
    expect(combos).toEqual(generateParameterCombinations(space));
  });
});

// ---------------------------------------------------------------------------
// 27. 边界测试
// ---------------------------------------------------------------------------

describe("边界测试", () => {
  it("min=max → 单值", () => {
    const space: ParameterSpace = { parameters: [{ type: "integer", name: "x", min: 10, max: 10, step: 1 }] };
    expect(generateParameterCombinations(space)).toEqual([{ x: 10 }]);
  });

  it("step > range（min=10 max=12 step=5）→ 仅 [10]（不自动补 12）", () => {
    const space: ParameterSpace = { parameters: [{ type: "integer", name: "x", min: 10, max: 12, step: 5 }] };
    expect(generateParameterCombinations(space)).toEqual([{ x: 10 }]);
  });
});

// ---------------------------------------------------------------------------
// 29. 整数参数
// ---------------------------------------------------------------------------

describe("整数参数", () => {
  it("lookback 5..20 step 5 → 5/10/15/20（无 20.000000001）", () => {
    const space: ParameterSpace = { parameters: [{ type: "integer", name: "lookback", min: 5, max: 20, step: 5 }] };
    const combos = generateParameterCombinations(space);
    expect(combos.map((combo) => combo.lookback)).toEqual([5, 10, 15, 20]);
    for (const combo of combos) {
      expect(Number.isInteger(combo.lookback)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 30. 布尔参数
// ---------------------------------------------------------------------------

describe("布尔参数", () => {
  it("useTrendFilter=[true,false] → true/false 顺序稳定", () => {
    const space: ParameterSpace = { parameters: [{ type: "boolean", name: "useTrendFilter", values: [true, false] }] };
    expect(generateParameterCombinations(space)).toEqual([{ useTrendFilter: true }, { useTrendFilter: false }]);
  });

  it("缺省 values → [true, false]", () => {
    const space: ParameterSpace = { parameters: [{ type: "boolean", name: "flag" }] };
    expect(generateParameterCombinations(space)).toEqual([{ flag: true }, { flag: false }]);
  });
});

// ---------------------------------------------------------------------------
// 31. Enum 参数
// ---------------------------------------------------------------------------

describe("Enum 参数", () => {
  it("mode=[strict,normal,loose] 保持定义顺序（不 sort）", () => {
    const space: ParameterSpace = { parameters: [{ type: "enum", name: "mode", values: ["strict", "normal", "loose"] }] };
    expect(generateParameterCombinations(space)).toEqual([{ mode: "strict" }, { mode: "normal" }, { mode: "loose" }]);
  });
});

// ---------------------------------------------------------------------------
// Fingerprint / Serialization
// ---------------------------------------------------------------------------

describe("Fingerprint / Serialization", () => {
  it("fingerprint 确定性：同一空间两次结果一致", () => {
    const space: ParameterSpace = { parameters: [{ type: "number", name: "t", min: 0.1, max: 0.3, step: 0.1 }] };
    expect(computeParameterSpaceFingerprint(space)).toBe(computeParameterSpaceFingerprint(space));
  });

  it("不同空间 fingerprint 不同", () => {
    const a: ParameterSpace = { parameters: [{ type: "number", name: "t", min: 0.1, max: 0.3, step: 0.1 }] };
    const b: ParameterSpace = { parameters: [{ type: "number", name: "t", min: 0.1, max: 0.4, step: 0.1 }] };
    expect(computeParameterSpaceFingerprint(a)).not.toBe(computeParameterSpaceFingerprint(b));
  });

  it("参数空间 serialize → deserialize 语义一致", () => {
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "lookback", min: 5, max: 20, step: 5 },
        { type: "enum", name: "mode", values: ["strict", "normal"] },
      ],
    };
    expect(deserializeParameterSpace(serializeParameterSpace(space))).toEqual(space);
  });
});
