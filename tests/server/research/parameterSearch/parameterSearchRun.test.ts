/**
 * PARAMETER-001 — Parameter Search 单测（规格 §18 的四组）。
 *
 * | 组 | 覆盖 |
 * |----|------|
 * | Parameter Space | enum / integer range / decimal range / fixed / 非法 range / 重名 / 未知参数 / DERIVED |
 * | Combination     | Cartesian Product / hash 确定性 / 去重 |
 * | Search Run      | create（纯构造）/ 状态机 / 进度 / 快照指纹 |
 * | Integration     | 4 组合 → 评估 → Search Result（指标只投影、不重算） |
 *
 * 🔴 真机全链（真实策略文档 + 真实数据集 + 真实回测）由
 *   `docs/evidence/_e2e_parameter_search.mts` 承担 —— 单测与它互补，不重复。
 */

import { describe, expect, it } from "vitest";
import type { StrategyParameterProjectionRow } from "../../../../server/research/strategySchema/projection";
import type { ParameterSearchSpaceDefinition } from "../../../../shared/parameterSearchContracts";
import {
  applySearchDomainOverrides,
  compileParameterSearchDomain,
  compileSearchSpaceToParameterSpace,
  deriveParameterSearchSpaceFromProjection,
  describeParameterSearchDomain,
  deserializeParameterSearchSpace,
  isSearchableStrategyParameter,
  serializeParameterSearchSpace,
  summarizeParameterSearchSpace,
  validateParameterSearchSpace,
} from "../../../../server/research/parameterSearch/searchSpace";
import {
  buildParameterCombinations,
  computeCombinationSetFingerprint,
} from "../../../../server/research/parameterSearch/combination";
import {
  computeEvaluationConfigFingerprint,
  computeParameterHash,
  canonicalParameterSetString,
  sameParameterSearchCacheKey,
  strategyVersionCoordinate,
} from "../../../../server/research/parameterSearch/parameterHash";
import {
  assertSearchRunTransition,
  canTransitionSearchRun,
  computeRunProgress,
  computeRunSpaceSnapshotFingerprint,
  generateParameterSearchRunId,
  parseParameterSearchRunStatus,
} from "../../../../server/research/parameterSearch/searchRun";
import {
  buildParameterSearchResult,
  isMetricsFullyUnavailable,
  projectCanonicalMetrics,
} from "../../../../server/research/parameterSearch/searchResult";
import type { ClosedLoopEvaluationRef } from "../../../../server/research/closedLoop/types";
import { STRATEGY_EVALUATION_STAGE_IDS } from "../../../../server/research/strategyEvaluation/evaluate";
import { listSearchableParameters } from "../../../../server/strategyCore/parameterResolver";
import type { ParameterDefinition as CoreParameterDefinition } from "../../../../server/strategyCore/parameterResolver";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function projectionRow(overrides: Partial<StrategyParameterProjectionRow> & { code: string }): StrategyParameterProjectionRow {
  return {
    code: overrides.code,
    name: overrides.name ?? overrides.code,
    dataType: overrides.dataType ?? "number",
    parameterRole: overrides.parameterRole ?? "TUNABLE",
    defaultValueJson: overrides.defaultValueJson ?? "1",
    minValue: overrides.minValue === undefined ? 1 : overrides.minValue,
    maxValue: overrides.maxValue === undefined ? 3 : overrides.maxValue,
    stepValue: overrides.stepValue === undefined ? 1 : overrides.stepValue,
    unit: overrides.unit ?? null,
    description: overrides.description ?? null,
    required: overrides.required ?? true,
    ordinal: overrides.ordinal ?? 0,
  };
}

/** 规格 §3 示例用夹具：entryDay / pullbackDepth / holdingPeriod + FIXED + DERIVED。 */
const SAMPLE_ROWS: StrategyParameterProjectionRow[] = [
  projectionRow({ code: "entryDay", ordinal: 0, minValue: 1, maxValue: 5, stepValue: 1 }),
  projectionRow({ code: "pullbackDepth", ordinal: 1, minValue: 0, maxValue: 0.1, stepValue: 0.01 }),
  projectionRow({ code: "holdingPeriod", ordinal: 2, minValue: 1, maxValue: 10, stepValue: 1 }),
  projectionRow({
    code: "limitUpThreshold",
    ordinal: 3,
    parameterRole: "FIXED",
    defaultValueJson: "0.1",
    minValue: null,
    maxValue: null,
    stepValue: null,
  }),
  projectionRow({
    code: "maxNotional",
    ordinal: 4,
    parameterRole: "DERIVED",
    defaultValueJson: "20000",
    minValue: null,
    maxValue: null,
    stepValue: null,
  }),
];

function derive(rows: readonly StrategyParameterProjectionRow[] = SAMPLE_ROWS) {
  return deriveParameterSearchSpaceFromProjection({
    strategyId: "strat-1",
    strategyVersion: "1.0.0",
    parameters: rows,
  });
}

/** 与上面夹具同角色的 Core 参数（用于「与唯一权威判据等价」的守护断言）。 */
const CORE_SCHEMA_FIXTURE: CoreParameterDefinition[] = [
  { code: "entryDay", name: "entryDay", role: "TUNABLE", dataType: "number", min: 1, max: 5, step: 1, required: true },
  { code: "pullbackDepth", name: "pullbackDepth", role: "TUNABLE", dataType: "number", min: 0, max: 0.1, step: 0.01, required: true },
  { code: "holdingPeriod", name: "holdingPeriod", role: "TUNABLE", dataType: "number", min: 1, max: 10, step: 1, required: true },
  { code: "limitUpThreshold", name: "limitUpThreshold", role: "FIXED", dataType: "number", defaultValue: 0.1, required: true },
  { code: "maxNotional", name: "maxNotional", role: "DERIVED", dataType: "number", required: true },
];

function minimalEvaluationRef(overrides: {
  canonical?: Partial<NonNullable<ClosedLoopEvaluationRef["canonicalMetrics"]>> | null;
  performance?: ClosedLoopEvaluationRef["performance"];
  tradeQuality?: ClosedLoopEvaluationRef["tradeQuality"];
}): ClosedLoopEvaluationRef {
  return {
    kind: "evaluationRef",
    handoffVersion: 1,
    synthetic: false,
    source: { module: "test", runId: "test-run", createdAt: "2026-09-19T00:00:00.000Z" },
    backtestFingerprint: "btfp-0001",
    canonicalMetrics:
      overrides.canonical === null
        ? null
        : {
            totalReturnPct: overrides.canonical?.totalReturnPct ?? null,
            cagrPct: overrides.canonical?.cagrPct ?? null,
            maxDrawdownPct: overrides.canonical?.maxDrawdownPct ?? null,
            winRatePct: overrides.canonical?.winRatePct ?? null,
            profitFactor: overrides.canonical?.profitFactor ?? null,
            completedTradeCount: overrides.canonical?.completedTradeCount ?? null,
            annualizationBasis: { type: "TRADING_DAYS", daysPerYear: 252 },
          },
    metricsSource: overrides.canonical === null ? "evaluators" : "canonical",
    performance: overrides.performance ?? null,
    riskAdjusted: null,
    tradeQuality: overrides.tradeQuality ?? null,
    evaluatorsCovered: [],
  } as unknown as ClosedLoopEvaluationRef;
}

// ---------------------------------------------------------------------------
// §3 Parameter Space
// ---------------------------------------------------------------------------

describe("PARAMETER-001 §3/§4/§5 — Parameter Space（派生 / 分类 / 校验）", () => {
  it("派生：TUNABLE 进搜索空间并带搜索域，FIXED / DERIVED 原样登记但不带搜索域", () => {
    const { definition } = derive();
    const byName = new Map(definition.parameters.map((item) => [item.name, item]));
    expect(byName.get("entryDay")?.kind).toBe("TUNABLE");
    expect(byName.get("entryDay")?.search).toEqual({ mode: "INTEGER_RANGE", min: 1, max: 5, step: 1 });
    expect(byName.get("pullbackDepth")?.search).toEqual({
      mode: "DECIMAL_RANGE",
      min: 0,
      max: 0.1,
      step: 0.01,
    });
    // FIXED / DERIVED 一律不带搜索域，且 reason 非空（不静默丢弃）
    expect(byName.get("limitUpThreshold")?.search).toBeUndefined();
    expect(byName.get("limitUpThreshold")?.exclusionReason).toContain("FIXED");
    expect(byName.get("maxNotional")?.search).toBeUndefined();
    expect(byName.get("maxNotional")?.exclusionReason).toContain("DERIVED");
  });

  it("派生：枚举搜索域支持 integer / decimal / enum（布尔）三种形态", () => {
    const rows: StrategyParameterProjectionRow[] = [
      projectionRow({ code: "i", ordinal: 0, minValue: 1, maxValue: 2, stepValue: 1 }),
      projectionRow({ code: "d", ordinal: 1, minValue: 0, maxValue: 0.05, stepValue: 0.05 }),
      projectionRow({
        code: "b",
        ordinal: 2,
        dataType: "boolean",
        defaultValueJson: "true",
        minValue: null,
        maxValue: null,
        stepValue: null,
      }),
    ];
    const { definition } = derive(rows);
    const modes = definition.parameters.map((item) => item.search?.mode);
    expect(modes).toEqual(["INTEGER_RANGE", "DECIMAL_RANGE", "ENUM"]);
    expect(definition.parameters[2]?.search).toEqual({ mode: "ENUM", values: [true, false] });
  });

  it("派生：字符串参数的可选值白名单未投影 ⇒ 如实排除并写明原因（不猜取值集合）", () => {
    const rows: StrategyParameterProjectionRow[] = [
      projectionRow({
        code: "mode",
        ordinal: 0,
        dataType: "string",
        defaultValueJson: "\"fast\"",
        minValue: null,
        maxValue: null,
        stepValue: null,
      }),
    ];
    const { definition } = derive(rows);
    expect(definition.parameters[0]?.search).toBeUndefined();
    expect(definition.parameters[0]?.exclusionReason).toContain("allowedValues");
  });

  it("派生：数值参数缺 min/max/step ⇒ 如实排除并列出缺什么", () => {
    const rows: StrategyParameterProjectionRow[] = [
      projectionRow({ code: "x", ordinal: 0, minValue: null, maxValue: 5, stepValue: 1 }),
    ];
    const { definition } = derive(rows);
    expect(definition.parameters[0]?.search).toBeUndefined();
    expect(definition.parameters[0]?.exclusionReason).toContain("min");
  });

  it("🔴 守护：本层的「可搜索」判据与 Core 唯一权威 listSearchableParameters 逐参数等价", () => {
    const { definition } = derive();
    const mine = definition.parameters
      .filter((item) => isSearchableStrategyParameter({ parameterRole: item.kind }) && item.search !== undefined)
      .map((item) => item.name)
      .sort();
    const core = listSearchableParameters(CORE_SCHEMA_FIXTURE)
      .filter((item) => item.min !== undefined && item.max !== undefined && item.step !== undefined)
      .map((item) => item.code)
      .sort();
    expect(mine).toEqual(core);
    expect(mine).toEqual(["entryDay", "holdingPeriod", "pullbackDepth"]);
  });

  it("编译：搜索域 → 既有 Sweep 参数空间（复用 Cartesian Product 的唯一入口）", () => {
    const { definition } = derive();
    const space = compileSearchSpaceToParameterSpace(definition);
    expect(space.parameters.map((item) => item.name)).toEqual([
      "entryDay",
      "pullbackDepth",
      "holdingPeriod",
    ]);
    expect(space.parameters.map((item) => item.type)).toEqual(["integer", "number", "integer"]);
  });

  it("编译 fixed 搜索域：数值 / 布尔 / 字符串三种取值各得其形", () => {
    expect(
      compileParameterSearchDomain({
        name: "n",
        type: "number",
        domain: { mode: "FIXED", value: 3 },
      }).compiled?.sweep,
    ).toEqual({ type: "number", name: "n", min: 3, max: 3, step: 1 });
    expect(
      compileParameterSearchDomain({
        name: "b",
        type: "boolean",
        domain: { mode: "FIXED", value: true },
      }).compiled?.sweep,
    ).toEqual({ type: "boolean", name: "b", values: [true] });
    expect(
      compileParameterSearchDomain({
        name: "s",
        type: "string",
        domain: { mode: "FIXED", value: "fast" },
      }).compiled?.sweep,
    ).toEqual({ type: "enum", name: "s", values: ["fast"] });
  });

  it("编译 fixed 搜索域：null 被拒绝（null 表达不出「一个确定取值」）", () => {
    const result = compileParameterSearchDomain({
      name: "n",
      type: "number",
      domain: { mode: "FIXED", value: null },
    });
    expect(result.compiled).toBeUndefined();
    expect(result.issue?.code).toBe("PARAMETER_SEARCH_DOMAIN_UNCOMPILABLE");
  });

  it("校验：step <= 0 / range 倒挂 / enum 为空 / 重复参数名 / 未知参数 / 类型不符 全部被拒", () => {
    const base = derive().definition;
    const cases: Array<{ name: string; definition: ParameterSearchSpaceDefinition; code: string }> = [
      {
        name: "step <= 0",
        code: "PARAMETER_SEARCH_STEP_INVALID",
        definition: {
          ...base,
          parameters: [
            { name: "entryDay", type: "number", kind: "TUNABLE", required: true, search: { mode: "INTEGER_RANGE", min: 1, max: 5, step: 0 } },
          ],
        },
      },
      {
        name: "range 倒挂",
        code: "PARAMETER_SEARCH_RANGE_ORDER",
        definition: {
          ...base,
          parameters: [
            { name: "entryDay", type: "number", kind: "TUNABLE", required: true, search: { mode: "INTEGER_RANGE", min: 9, max: 5, step: 1 } },
          ],
        },
      },
      {
        name: "enum 为空",
        code: "PARAMETER_SEARCH_ENUM_EMPTY",
        definition: {
          ...base,
          parameters: [{ name: "entryDay", type: "string", kind: "TUNABLE", required: true, search: { mode: "ENUM", values: [] } }],
        },
      },
      {
        name: "重复参数名",
        code: "PARAMETER_SEARCH_PARAM_DUPLICATE",
        definition: {
          ...base,
          parameters: [
            { name: "entryDay", type: "number", kind: "TUNABLE", required: true, search: { mode: "INTEGER_RANGE", min: 1, max: 2, step: 1 } },
            { name: "entryDay", type: "number", kind: "TUNABLE", required: true, search: { mode: "INTEGER_RANGE", min: 1, max: 2, step: 1 } },
          ],
        },
      },
      {
        name: "未知参数（不在 Schema）",
        code: "PARAMETER_SEARCH_PARAM_UNKNOWN",
        definition: {
          ...base,
          parameters: [{ name: "notInSchema", type: "number", kind: "TUNABLE", required: true, search: { mode: "INTEGER_RANGE", min: 1, max: 2, step: 1 } }],
        },
      },
      {
        name: "类型不符",
        code: "PARAMETER_SEARCH_PARAM_TYPE_MISMATCH",
        definition: {
          ...base,
          parameters: [{ name: "entryDay", type: "string", kind: "TUNABLE", required: true, search: { mode: "ENUM", values: ["a"] } }],
        },
      },
    ];

    const declared = SAMPLE_ROWS.map((row) => ({
      code: row.code,
      dataType: row.dataType,
      parameterRole: row.parameterRole,
    }));

    for (const item of cases) {
      const result = validateParameterSearchSpace(item.definition, declared);
      expect(result.valid, `${item.name} 应被拒绝`).toBe(false);
      expect(
        result.issues.map((issue) => issue.code),
        `${item.name} 的领域码`,
      ).toContain(item.code);
    }
  });

  it("🔴 DERIVED 不得直接搜索 / FIXED 不得进搜索空间（各自独立领域码）", () => {
    const base = derive().definition;
    const derivedSearched = validateParameterSearchSpace({
      ...base,
      parameters: [
        { name: "maxNotional", type: "number", kind: "DERIVED", required: true, search: { mode: "INTEGER_RANGE", min: 1, max: 2, step: 1 } },
      ],
    });
    expect(derivedSearched.issues.map((issue) => issue.code)).toContain("PARAMETER_SEARCH_DERIVED_NOT_SEARCHABLE");

    const fixedSearched = validateParameterSearchSpace({
      ...base,
      parameters: [
        { name: "limitUpThreshold", type: "number", kind: "FIXED", required: true, search: { mode: "DECIMAL_RANGE", min: 0, max: 1, step: 0.1 } },
      ],
    });
    expect(fixedSearched.issues.map((issue) => issue.code)).toContain("PARAMETER_SEARCH_FIXED_NOT_SEARCHABLE");
  });

  it("🔴 覆盖搜索域：不存在的参数被拒；FIXED / DERIVED 被拒（不静默忽略）", () => {
    const definition = derive().definition;
    const unknown = applySearchDomainOverrides(definition, [
      { name: "nope", domain: { mode: "FIXED", value: 1 } },
    ]);
    expect(unknown.issues.map((issue) => issue.code)).toContain("PARAMETER_SEARCH_OVERRIDE_UNKNOWN_PARAM");

    const onFixed = applySearchDomainOverrides(definition, [
      { name: "limitUpThreshold", domain: { mode: "FIXED", value: 1 } },
    ]);
    expect(onFixed.issues.map((issue) => issue.code)).toContain("PARAMETER_SEARCH_FIXED_NOT_SEARCHABLE");

    const onDerived = applySearchDomainOverrides(definition, [
      { name: "maxNotional", domain: { mode: "FIXED", value: 1 } },
    ]);
    expect(onDerived.issues.map((issue) => issue.code)).toContain("PARAMETER_SEARCH_DERIVED_NOT_SEARCHABLE");
  });

  it("快照 round-trip：序列化 → 反序列化结构相等；非法快照响亮抛错", () => {
    const definition = derive().definition;
    const json = serializeParameterSearchSpace(definition);
    expect(deserializeParameterSearchSpace(json)).toEqual(definition);
    expect(() => deserializeParameterSearchSpace("[]")).toThrow();
    expect(() => deserializeParameterSearchSpace("not json")).toThrow();
  });

  it("摘要：如实分列 searchable / fixed / derived / excluded", () => {
    const summary = summarizeParameterSearchSpace(derive().definition);
    expect(summary.searchable).toEqual(["entryDay", "pullbackDepth", "holdingPeriod"]);
    expect(summary.fixed).toEqual(["limitUpThreshold"]);
    expect(summary.derived).toEqual(["maxNotional"]);
    expect(summary.excluded).toHaveLength(2);
  });

  it("搜索域描述可读（用于错误提示 / 前端展示）", () => {
    expect(describeParameterSearchDomain({ mode: "FIXED", value: 0.5 })).toContain("0.5");
    expect(describeParameterSearchDomain({ mode: "ENUM", values: ["a", "b"] })).toContain("a");
    expect(describeParameterSearchDomain({ mode: "INTEGER_RANGE", min: 1, max: 5, step: 1 })).toContain("整数区间");
    expect(describeParameterSearchDomain({ mode: "DECIMAL_RANGE", min: 0, max: 1, step: 0.1 })).toContain("小数区间");
  });
});

// ---------------------------------------------------------------------------
// §6 Combination
// ---------------------------------------------------------------------------

describe("PARAMETER-001 §6 — Combination（笛卡尔积 / hash 确定性 / 去重）", () => {
  /** 规格 §6 原文示例：entryDay = [1,2] × holdingPeriod = [1,3] ⇒ 4 组。 */
  function twoByTwo(): ParameterSearchSpaceDefinition {
    return {
      recordKind: "PARAMETER_SEARCH_SPACE",
      recordVersion: 1,
      strategyId: "strat-1",
      strategyVersion: "1.0.0",
      parameters: [
        { name: "entryDay", type: "number", kind: "TUNABLE", required: true, search: { mode: "INTEGER_RANGE", min: 1, max: 2, step: 1 } },
        { name: "holdingPeriod", type: "number", kind: "TUNABLE", required: true, search: { mode: "INTEGER_RANGE", min: 1, max: 3, step: 2 } },
      ],
    };
  }

  it("笛卡尔积：2 × 2 = 4 组，顺序稳定（定义越靠前变化越慢）", () => {
    const set = buildParameterCombinations(twoByTwo());
    expect(set.combinationCount).toBe(4);
    expect(set.combinations.map((item) => item.parameters)).toEqual([
      { entryDay: 1, holdingPeriod: 1 },
      { entryDay: 1, holdingPeriod: 3 },
      { entryDay: 2, holdingPeriod: 1 },
      { entryDay: 2, holdingPeriod: 3 },
    ]);
    expect(set.combinations.map((item) => item.combinationIndex)).toEqual([0, 1, 2, 3]);
  });

  it("hash 确定性：同一策略版本 + 同一参数 ⇒ 逐字节相等的 hash（跨调用）", () => {
    const [first, second] = buildParameterCombinations(twoByTwo()).combinations;
    const hashOf = (parameters: Record<string, number | string | boolean | null>) =>
      computeParameterHash({ strategyId: "strat-1", strategyVersion: "1.0.0", parameters });
    expect(hashOf(first!.parameters)).toBe(hashOf(first!.parameters));
    expect(hashOf(first!.parameters)).not.toBe(hashOf(second!.parameters));
    expect(hashOf(first!.parameters)).toHaveLength(64);
  });

  it("hash 区分策略版本：同参数、不同版本 ⇒ 不同 hash", () => {
    const parameters = { entryDay: 1, holdingPeriod: 1 };
    const a = computeParameterHash({ strategyId: "s", strategyVersion: "1.0.0", parameters });
    const b = computeParameterHash({ strategyId: "s", strategyVersion: "1.0.1", parameters });
    expect(a).not.toBe(b);
  });

  it("hash 规范化：键序无关 / -0 归一 / 缺省键不参与（缺省 ≠ null）", () => {
    const a = computeParameterHash({ strategyId: "s", strategyVersion: "1", parameters: { b: 2, a: 1 } });
    const b = computeParameterHash({ strategyId: "s", strategyVersion: "1", parameters: { a: 1, b: 2 } });
    expect(a).toBe(b);

    const negZero = computeParameterHash({ strategyId: "s", strategyVersion: "1", parameters: { x: -0 } });
    const zero = computeParameterHash({ strategyId: "s", strategyVersion: "1", parameters: { x: 0 } });
    expect(negZero).toBe(zero);

    const withNull = computeParameterHash({ strategyId: "s", strategyVersion: "1", parameters: { x: null } });
    const withoutKey = computeParameterHash({ strategyId: "s", strategyVersion: "1", parameters: {} });
    expect(withNull).not.toBe(withoutKey);

    expect(canonicalParameterSetString({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("hash 拒绝非有限数（NaN / Infinity 不得静默转 null 撞 hash）", () => {
    expect(() =>
      computeParameterHash({ strategyId: "s", strategyVersion: "1", parameters: { x: Number.NaN } }),
    ).toThrow();
    expect(() =>
      computeParameterHash({ strategyId: "s", strategyVersion: "1", parameters: { x: Number.POSITIVE_INFINITY } }),
    ).toThrow();
  });

  it("去重：4 组参数的 hash 两两不同（组合身份唯一）", () => {
    const set = buildParameterCombinations(twoByTwo());
    const hashes = set.combinations.map((item) => item.parameterHash);
    expect(new Set(hashes).size).toBe(4);
    expect(set.duplicateHashCount).toBe(0);
  });

  it("组合集合指纹确定性（同空间同指纹；换空间即变）", () => {
    const a = computeCombinationSetFingerprint(buildParameterCombinations(twoByTwo()).combinations);
    const b = computeCombinationSetFingerprint(buildParameterCombinations(twoByTwo()).combinations);
    expect(a).toBe(b);
    const other = twoByTwo();
    other.parameters[1] = {
      name: "holdingPeriod",
      type: "number",
      kind: "TUNABLE",
      required: true,
      search: { mode: "INTEGER_RANGE", min: 1, max: 5, step: 2 },
    };
    const c = computeCombinationSetFingerprint(buildParameterCombinations(other).combinations);
    expect(c).not.toBe(a);
  });

  it("超过上限 ⇒ 生成前响亮抛错（不截断）", () => {
    expect(() => buildParameterCombinations(twoByTwo(), { maxCombinations: 3 })).toThrow();
  });

  it("参数空间无 TUNABLE ⇒ 编译为空空间 ⇒ 1 个空参数集（「没有可搜参数 ≠ 没有组合」）", () => {
    const set = buildParameterCombinations({
      recordKind: "PARAMETER_SEARCH_SPACE",
      recordVersion: 1,
      strategyId: "s",
      strategyVersion: "1",
      parameters: [
        { name: "fixedOnly", type: "number", kind: "FIXED", required: true },
      ],
    });
    expect(set.combinationCount).toBe(1);
    expect(set.combinations[0]?.parameters).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// §7 Search Run
// ---------------------------------------------------------------------------

describe("PARAMETER-001 §7/§8 — Search Run（状态机 / 进度 / 快照）", () => {
  it("合法迁移全部被接受", () => {
    expect(canTransitionSearchRun("CREATED", "RUNNING")).toBe(true);
    expect(canTransitionSearchRun("CREATED", "CANCELLED")).toBe(true);
    expect(canTransitionSearchRun("RUNNING", "COMPLETED")).toBe(true);
    expect(canTransitionSearchRun("RUNNING", "FAILED")).toBe(true);
    expect(canTransitionSearchRun("RUNNING", "CANCELLED")).toBe(true);
    // §13 Retry / Resume 的两个入口
    expect(canTransitionSearchRun("FAILED", "RUNNING")).toBe(true);
    expect(canTransitionSearchRun("COMPLETED", "RUNNING")).toBe(true);
    expect(canTransitionSearchRun("CANCELLED", "RUNNING")).toBe(true);
  });

  it("同态重放视为幂等；非法迁移抛领域码 PARAMETER_SEARCH_STATUS_TRANSITION_INVALID", () => {
    expect(canTransitionSearchRun("COMPLETED", "COMPLETED")).toBe(true);
    expect(canTransitionSearchRun("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionSearchRun("CREATED", "FAILED")).toBe(false);
    expect(() => assertSearchRunTransition("CREATED", "FAILED")).toThrow(/PARAMETER_SEARCH_STATUS_TRANSITION_INVALID/);
    expect(() => assertSearchRunTransition("RUNNING", "COMPLETED")).not.toThrow();
  });

  it("非法状态值响亮抛错（不默认成 CREATED）", () => {
    expect(() => parseParameterSearchRunStatus("RUNNING")).not.toThrow();
    expect(() => parseParameterSearchRunStatus("WAT")).toThrow(/PARAMETER_SEARCH_STATUS_UNKNOWN/);
    expect(() => parseParameterSearchRunStatus(null)).toThrow(/PARAMETER_SEARCH_STATUS_UNKNOWN/);
  });

  it("进度口径：SKIPPED 不计入任一边；分母为 0 时进度 100", () => {
    expect(
      computeRunProgress({ combinationCount: 4, completedCount: 3, failedCount: 1 }),
    ).toMatchObject({ settledCount: 4, pendingCount: 0, progressPct: 100 });
    expect(
      computeRunProgress({ combinationCount: 4, completedCount: 1, failedCount: 0 }),
    ).toMatchObject({ settledCount: 1, pendingCount: 3, progressPct: 25 });
    expect(
      computeRunProgress({ combinationCount: 0, completedCount: 0, failedCount: 0 }),
    ).toMatchObject({ progressPct: 100 });
    // 计数越界（脏行）不得让 pendingCount 变负
    expect(
      computeRunProgress({ combinationCount: 2, completedCount: 5, failedCount: 5 }),
    ).toMatchObject({ settledCount: 2, pendingCount: 0 });
  });

  it("快照指纹：同内容同指纹；分类变化即变（证明快照真的覆盖了富定义）", () => {
    const base = derive().definition;
    const jsonA = serializeParameterSearchSpace(base);
    const jsonB = serializeParameterSearchSpace(derive().definition);
    expect(computeRunSpaceSnapshotFingerprint(jsonA)).toBe(computeRunSpaceSnapshotFingerprint(jsonB));

    const changed: ParameterSearchSpaceDefinition = {
      ...base,
      parameters: base.parameters.map((item) =>
        item.name === "entryDay" ? { ...item, kind: "FIXED" as const, search: undefined } : item,
      ),
    };
    const jsonC = serializeParameterSearchSpace(changed);
    expect(computeRunSpaceSnapshotFingerprint(jsonC)).not.toBe(
      computeRunSpaceSnapshotFingerprint(jsonA),
    );
  });

  it("Run ID 格式：PSRUN-YYYYMMDD-XXXXXXXX（注入 suffix 时确定）", () => {
    const id = generateParameterSearchRunId(new Date("2026-09-19T00:00:00.000Z"), "deadbeef");
    expect(id).toBe("PSRUN-20260919-deadbeef");
    expect(generateParameterSearchRunId()).toMatch(/^PSRUN-\d{8}-[0-9a-f]{8}$/);
  });

  it("cache 判据：五要素逐字段相等才算命中；任一不同即不命中", () => {
    const key = {
      strategyId: "s",
      strategyVersion: "1",
      datasetVersionId: 390002,
      parameterHash: "h",
      executionPolicyVersion: 1,
      evaluationConfigFingerprint: "e",
    };
    expect(sameParameterSearchCacheKey(key, { ...key })).toBe(true);
    expect(sameParameterSearchCacheKey(key, { ...key, parameterHash: "h2" })).toBe(false);
    expect(sameParameterSearchCacheKey(key, { ...key, datasetVersionId: null })).toBe(false);
    expect(sameParameterSearchCacheKey(key, { ...key, evaluationConfigFingerprint: "e2" })).toBe(false);
  });

  it("评估配置指纹：窗口属于评估配置（换窗口必须让 cache 失效）", () => {
    const a = computeEvaluationConfigFingerprint({ startDate: "2026-01-01", endDate: "2026-06-30" });
    const b = computeEvaluationConfigFingerprint({ startDate: "2026-01-01", endDate: "2026-07-31" });
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it("strategyVersionId 口径 = strategyId@strategyVersion（不另立 ID 体系）", () => {
    expect(strategyVersionCoordinate({ strategyId: "cand-360001", strategyVersion: "1.0.0" })).toBe(
      "cand-360001@1.0.0",
    );
  });

  it("评估子链与既有评估端口一致（禁自建第二套子链）", () => {
    expect([...STRATEGY_EVALUATION_STAGE_IDS]).toEqual([
      "data",
      "research",
      "strategy",
      "backtest",
      "evaluation",
    ]);
  });
});

// ---------------------------------------------------------------------------
// §9/§10 Search Result（指标只投影、不重算）
// ---------------------------------------------------------------------------

describe("PARAMETER-001 §9/§10 — Search Result（canonical metrics 只读数）", () => {
  it("canonicalMetrics 存在 ⇒ 六项一一对应，metricsSource = canonical", () => {
    const ref = minimalEvaluationRef({
      canonical: {
        totalReturnPct: 12.5,
        cagrPct: 5.3,
        maxDrawdownPct: 8.1,
        winRatePct: 55,
        profitFactor: 1.8,
        completedTradeCount: 33,
      },
    });
    const projected = projectCanonicalMetrics(ref);
    expect(projected.metrics).toEqual({
      totalReturnPct: 12.5,
      annualizedReturnPct: 5.3,
      maxDrawdownPct: 8.1,
      tradeCount: 33,
      winRatePct: 55,
      profitFactor: 1.8,
    });
    expect(projected.metricsSource).toBe("canonical");
    expect(projected.annualizationBasis).toEqual({ type: "TRADING_DAYS", daysPerYear: 252 });
  });

  it("canonicalMetrics 缺省 ⇒ 按既有语义回落 evaluators 面并如实标注来源", () => {
    const ref = minimalEvaluationRef({
      canonical: null,
      performance: { fingerprint: "p", inputFingerprint: null, totalReturnPct: 7, cagrPct: 3, maxDrawdownPct: 4 },
      tradeQuality: { fingerprint: "t", winRatePct: 40, profitFactor: 1.2, completedTradeCount: 9 },
    });
    const projected = projectCanonicalMetrics(ref);
    expect(projected.metrics).toEqual({
      totalReturnPct: 7,
      annualizedReturnPct: 3,
      maxDrawdownPct: 4,
      tradeCount: 9,
      winRatePct: 40,
      profitFactor: 1.2,
    });
    expect(projected.metricsSource).toBe("evaluators");
    expect(projected.annualizationBasis).toBeNull();
  });

  it("🔴 缺失值保持 null（禁编 0 / 1）；全不可用可被识别", () => {
    const ref = minimalEvaluationRef({ canonical: null });
    const projected = projectCanonicalMetrics(ref);
    expect(Object.values(projected.metrics).every((value) => value === null)).toBe(true);
    expect(isMetricsFullyUnavailable(projected.metrics)).toBe(true);
  });

  it("status 判据 = 评估引用是否存在（不看指标是否为 null）", () => {
    const succeeded = buildParameterSearchResult({
      searchRunId: "PSRUN-x",
      combinationIndex: 0,
      parameterHash: "h",
      parameters: { a: 1 },
      evaluationConfigFingerprint: "e",
      createdAt: "2026-09-19T00:00:00.000Z",
      evaluation: minimalEvaluationRef({ canonical: { totalReturnPct: 1 } }),
      experimentId: "exp-1",
      evaluationRunId: "prefix::exp-1",
      backtestFingerprint: "btfp",
      error: null,
    });
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(succeeded.metricsSource).toBe("canonical");
    expect(succeeded.backtestRunId).toBeNull(); // 本阶段不落 closed_loop_backtest_run 行 ⇒ 如实为 null
    expect(succeeded.recordKind).toBe("PARAMETER_SEARCH_RESULT");

    const failed = buildParameterSearchResult({
      searchRunId: "PSRUN-x",
      combinationIndex: 1,
      parameterHash: "h2",
      parameters: { a: 2 },
      evaluationConfigFingerprint: "e",
      createdAt: "2026-09-19T00:00:00.000Z",
      evaluation: null,
      experimentId: null,
      evaluationRunId: null,
      backtestFingerprint: null,
      error: "evaluation 阶段未执行",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("未执行");
    expect(failed.backtestFingerprint).toBeNull();
  });

  it("评估引用为 null ⇒ 六项全 null（不编造）", () => {
    expect(projectCanonicalMetrics(null).metrics).toEqual({
      totalReturnPct: null,
      annualizedReturnPct: null,
      maxDrawdownPct: null,
      tradeCount: null,
      winRatePct: null,
      profitFactor: null,
    });
  });
});
