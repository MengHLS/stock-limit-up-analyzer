/**
 * STRATEGY-ARCH-001 · 规格 §23.3 Parameter
 *
 * 覆盖：FIXED / TUNABLE / DERIVED；default / validation / dependency / cycle detection / resolution。
 */

import { describe, expect, it } from "vitest";
import {
  Expr,
  StrategyCoreError,
  detectParameterCycles,
  evaluateExpression,
  listSearchableParameters,
  parameterDependencyGraph,
  parameterResolutionOrder,
  parseExpression,
  resolveParameters,
  validateParameterSchema,
  type ParameterDefinition,
  type ResolvedParameterSet,
} from "../../../server/strategyCore";

function errorCode(fn: () => unknown): string {
  try {
    fn();
    return "NO_ERROR";
  } catch (error) {
    return (error as { code?: string }).code ?? "NO_CODE";
  }
}

function errorMessage(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const SCHEMA: readonly ParameterDefinition[] = [
  {
    code: "entry_day",
    name: "买入时点（T+N）",
    dataType: "number",
    role: "TUNABLE",
    defaultValue: 3,
    min: 1,
    max: 5,
    step: 1,
    required: true,
  },
  {
    code: "max_volume_ratio",
    name: "缩量阈值",
    dataType: "number",
    role: "TUNABLE",
    defaultValue: 0.3,
    min: 0.1,
    max: 1,
    step: 0.1,
    required: true,
  },
  {
    code: "stop_loss",
    name: "止损比例",
    dataType: "number",
    role: "FIXED",
    defaultValue: 0.05,
    min: 0,
    max: 0.5,
    step: 0.01,
    required: false,
  },
  {
    code: "regime",
    name: "市场状态",
    dataType: "string",
    role: "TUNABLE",
    defaultValue: "ANY",
    allowedValues: ["BULL", "BEAR", "ANY"],
    required: false,
  },
  {
    code: "require_bullish",
    name: "要求红盘",
    dataType: "boolean",
    role: "FIXED",
    defaultValue: true,
    required: false,
  },
  {
    code: "max_drawdown_tolerance",
    name: "容忍回撤（派生）",
    dataType: "number",
    role: "DERIVED",
    derivedFrom: Expr.binary("-", Expr.constant(1), Expr.param("stop_loss")),
    required: false,
  },
];

describe("§23.3 Parameter — FIXED / TUNABLE / DERIVED", () => {
  it("FIXED 用 defaultValue，TUNABLE 可覆写，DERIVED 由表达式求值", () => {
    const resolved = resolveParameters(SCHEMA, { entry_day: 2, max_volume_ratio: 0.5 });
    expect(resolved.resolved).toBe(true);
    expect(resolved.values.entry_day).toBe(2);
    expect(resolved.values.max_volume_ratio).toBe(0.5);
    expect(resolved.values.stop_loss).toBe(0.05);
    expect(resolved.values.require_bullish).toBe(true);
    // DERIVED：1 - 0.05 = 0.95（**真正求值**，不是文本声明）
    expect(resolved.values.max_drawdown_tolerance).toBeCloseTo(0.95, 10);
  });

  it("DERIVED 随被依赖参数变化（依赖链真的生效）", () => {
    const resolved = resolveParameters(SCHEMA, { stop_loss: 0.2 });
    expect(resolved.values.max_drawdown_tolerance).toBeCloseTo(0.8, 10);
  });

  it("DERIVED 多级依赖按拓扑序解析", () => {
    const schema: readonly ParameterDefinition[] = [
      { code: "a", name: "a", dataType: "number", role: "FIXED", defaultValue: 2, required: true },
      {
        code: "b",
        name: "b",
        dataType: "number",
        role: "DERIVED",
        derivedFrom: Expr.binary("*", Expr.param("a"), Expr.constant(3)),
        required: false,
      },
      {
        code: "c",
        name: "c",
        dataType: "number",
        role: "DERIVED",
        derivedFrom: Expr.binary("+", Expr.param("b"), Expr.constant(1)),
        required: false,
      },
    ];
    expect(parameterResolutionOrder(schema)).toEqual(["a", "b", "c"]);
    const resolved = resolveParameters(schema, {});
    expect(resolved.values.b).toBe(6);
    expect(resolved.values.c).toBe(7);
  });

  it("缺少 defaultValue 且无覆写 ⇒ 抛 PARAMETER_MISSING_DEFAULT（不静默取 0）", () => {
    const schema: readonly ParameterDefinition[] = [
      { code: "needed", name: "needed", dataType: "number", role: "FIXED", required: true },
    ];
    expect(errorCode(() => resolveParameters(schema, {}))).toBe("PARAMETER_MISSING_DEFAULT");
  });

  it("未知参数键 ⇒ 抛 PARAMETER_UNKNOWN（不静默忽略）", () => {
    expect(errorCode(() => resolveParameters(SCHEMA, { nope: 1 }))).toBe("PARAMETER_UNKNOWN");
  });

  it("类型 / 范围 / 枚举 / nullable 校验全部生效", () => {
    expect(errorCode(() => resolveParameters(SCHEMA, { entry_day: 9 }))).toBe("PARAMETER_OUT_OF_RANGE");
    expect(errorCode(() => resolveParameters(SCHEMA, { entry_day: "x" as never }))).toBe("PARAMETER_TYPE_MISMATCH");
    expect(errorCode(() => resolveParameters(SCHEMA, { regime: "SIDEWAYS" }))).toBe("PARAMETER_NOT_ALLOWED_VALUE");
    const nullableSchema: readonly ParameterDefinition[] = [
      { code: "threshold", name: "阈值", dataType: "number", role: "FIXED", defaultValue: 1, required: false },
    ];
    expect(errorCode(() => resolveParameters(nullableSchema, { threshold: null }))).toBe("PARAMETER_NULL_NOT_ALLOWED");
    const nullableOk: readonly ParameterDefinition[] = [
      { code: "threshold", name: "阈值", dataType: "number", role: "FIXED", defaultValue: null, nullable: true, required: false },
    ];
    expect(resolveParameters(nullableOk, {}).values.threshold).toBeNull();
  });

  it("TUNABLE 的约束规则：数值必须给 min/max；字符串必须给 allowedValues；boolean 不允许 TUNABLE", () => {
    const noBounds: readonly ParameterDefinition[] = [
      { code: "x", name: "x", dataType: "number", role: "TUNABLE", defaultValue: 1, required: true },
    ];
    expect(errorMessage(() => resolveParameters(noBounds, {}))).toContain("min");
    const noEnum: readonly ParameterDefinition[] = [
      { code: "s", name: "s", dataType: "string", role: "TUNABLE", defaultValue: "a", required: true },
    ];
    expect(errorCode(() => resolveParameters(noEnum, {}))).toBe("CORE_DEFINITION_INVALID");
    const boolTunable: readonly ParameterDefinition[] = [
      { code: "b", name: "b", dataType: "boolean", role: "TUNABLE", defaultValue: true, required: true },
    ];
    expect(errorMessage(() => resolveParameters(boolTunable, {}))).toContain("boolean");
  });

  it("DERIVED 不允许调用方直接赋值（抛 PARAMETER_DERIVED_OVERRIDE_FORBIDDEN）", () => {
    expect(errorCode(() => resolveParameters(SCHEMA, { max_drawdown_tolerance: 0.5 }))).toBe(
      "PARAMETER_DERIVED_OVERRIDE_FORBIDDEN",
    );
  });

  it("DERIVED 缺少表达式 / 非 DERIVED 声明 derivedFrom 都被拒", () => {
    const missing: readonly ParameterDefinition[] = [
      { code: "d", name: "d", dataType: "number", role: "DERIVED", required: false },
    ];
    expect(errorCode(() => resolveParameters(missing, {}))).toBe("CORE_DEFINITION_INVALID");
    const wrongRole = [
      {
        code: "f",
        name: "f",
        dataType: "number",
        role: "FIXED",
        defaultValue: 1,
        required: true,
        derivedFrom: Expr.constant(1),
      },
    ] as unknown as readonly ParameterDefinition[];
    expect(errorMessage(() => resolveParameters(wrongRole, {}))).toContain("只有 DERIVED");
  });

  it("循环依赖：detectParameterCycles 直接给出环，resolveParameters 响亮拒绝", () => {
    const cyclic: readonly ParameterDefinition[] = [
      {
        code: "a",
        name: "a",
        dataType: "number",
        role: "DERIVED",
        derivedFrom: Expr.binary("+", Expr.param("b"), Expr.constant(1)),
        required: false,
      },
      {
        code: "b",
        name: "b",
        dataType: "number",
        role: "DERIVED",
        derivedFrom: Expr.binary("+", Expr.param("a"), Expr.constant(1)),
        required: false,
      },
    ];
    const cycles = detectParameterCycles(cyclic);
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toEqual(["a", "b", "a"]);
    expect(errorMessage(() => resolveParameters(cyclic, {}))).toContain("循环依赖");
    expect(errorMessage(() => parameterResolutionOrder(cyclic))).toContain("循环依赖");
  });

  it("依赖图：只有 DERIVED 有出边", () => {
    const graph = parameterDependencyGraph(SCHEMA);
    expect(graph.get("max_drawdown_tolerance")).toEqual(["stop_loss"]);
    expect(graph.get("stop_loss")).toEqual([]);
    expect(graph.get("entry_day")).toEqual([]);
  });

  it("validateParameterSchema 报出重复 code / 引用未声明参数", () => {
    const duplicated = [
      { code: "x", name: "x", dataType: "number", role: "FIXED", defaultValue: 1, required: true },
      { code: "x", name: "x2", dataType: "number", role: "FIXED", defaultValue: 2, required: true },
    ] as unknown as readonly ParameterDefinition[];
    expect(validateParameterSchema(duplicated).some((issue) => issue.code === "PARAMETER_SCHEMA_DUPLICATE_CODE")).toBe(true);
    const dangling: readonly ParameterDefinition[] = [
      {
        code: "y",
        name: "y",
        dataType: "number",
        role: "DERIVED",
        derivedFrom: Expr.param("not_declared"),
        required: false,
      },
    ];
    expect(validateParameterSchema(dangling).some((issue) => issue.code === "PARAMETER_UNKNOWN")).toBe(true);
  });

  it("只有 TUNABLE 参数可被 Parameter Search 搜索（唯一权威；不按 min/max 猜）", () => {
    const searchable = listSearchableParameters(SCHEMA).map((item) => item.code).sort();
    expect(searchable).toEqual(["entry_day", "max_volume_ratio", "regime"]);
    expect(searchable).not.toContain("stop_loss");
    expect(searchable).not.toContain("max_drawdown_tolerance");
  });

  it("解析结果键序稳定（指纹/复现依赖这一点）", () => {
    const resolved: ResolvedParameterSet = resolveParameters(SCHEMA, {});
    expect(Object.keys(resolved.values)).toEqual([...Object.keys(resolved.values)].sort());
  });
});

describe("§23.3 Parameter — 文本表达式解析（legacy derivedFrom 兼容）", () => {
  it("可解析 算术 / 括号 / 一元负号 / 常量", () => {
    expect(evaluateExpression(parseExpression("a * (1 - b)"), {
      fieldValue: () => null,
      featureValue: () => null,
      parameterValue: (code) => (code === "a" ? 10 : code === "b" ? 0.2 : null),
    })).toBeCloseTo(8, 10);
    expect(evaluateExpression(parseExpression("-x + 1"), {
      fieldValue: () => null,
      featureValue: () => null,
      parameterValue: (code) => (code === "x" ? 3 : null),
    })).toBeCloseTo(-2, 10);
    expect(evaluateExpression(parseExpression("null"), {
      fieldValue: () => null,
      featureValue: () => null,
      parameterValue: () => null,
    })).toBeNull();
  });

  it("除零 ⇒ 抛 EXPRESSION_DIVISION_BY_ZERO（不返回 Infinity）", () => {
    expect(errorCode(() => evaluateExpression(parseExpression("1 / 0"), {
      fieldValue: () => null,
      featureValue: () => null,
      parameterValue: () => null,
    }))).toBe("EXPRESSION_DIVISION_BY_ZERO");
  });

  it("不支持函数调用 / 属性访问 ⇒ 抛 PARAMETER_DERIVED_UNPARSEABLE（不猜）", () => {
    for (const text of ["max(a, b)", "a.b", "[1,2]", "a >= b"]) {
      expect(() => parseExpression(text)).toThrow(StrategyCoreError);
    }
  });

  it("空表达式 / 括号不匹配 / 末尾多余记号都被拒", () => {
    for (const text of ["", "   ", "(a + b", "a + b)"]) {
      expect(() => parseExpression(text)).toThrow(StrategyCoreError);
    }
  });
});
