/**
 * STRATEGY-ARCH-001 · 规格 §23.1 RuleGraph + §23.2 Temporal
 *
 * 覆盖：ALL / ANY / NOT / CONDITION / EVENT / WINDOW / SEQUENCE / TRIGGER；
 *      `A AND (B OR C)`、`A AND NOT(B)`、`A → B → C`；
 *      T / T+1 / T+N / WINDOW / SEQUENCE 与 PIT 可见性。
 */

import { describe, expect, it } from "vitest";
import {
  Expr,
  Rule,
  StrategyCoreError,
  createDayScopedBarAccess,
  isBarVisibleAt,
  labelToOffset,
  makeTemporalWindow,
  offsetToLabel,
  resolveTriggerSatisfaction,
  triggerCandidateDays,
  validateRuleGraph,
  windowContains,
  windowLength,
  windowOffsets,
  type RuleNode,
} from "../../../server/strategyCore";
import { BAR_FIXTURE, barsFor, envFor, type HarnessOptions } from "./_graphHarness";

function run(root: RuleNode, options: HarnessOptions = {}) {
  return envFor(root, options);
}

const TRUE_COND = Rule.condition(Expr.constant(1), "EQ", Expr.constant(1), "c-true");
const FALSE_COND = Rule.condition(Expr.constant(1), "EQ", Expr.constant(2), "c-false");

// ---------------------------------------------------------------------------
// §23.2 Temporal
// ---------------------------------------------------------------------------

describe("§23.2 Temporal — 相对日代数", () => {
  it("T / T-1 / T+1 / T+N 标签与偏移互转", () => {
    expect(offsetToLabel(0)).toBe("T");
    expect(offsetToLabel(1)).toBe("T+1");
    expect(offsetToLabel(5)).toBe("T+5");
    expect(offsetToLabel(-1)).toBe("T-1");
    expect(labelToOffset("T")).toBe(0);
    expect(labelToOffset(" T+3 ")).toBe(3);
    expect(labelToOffset("t-2")).toBe(-2);
    expect(labelToOffset("T0")).toBe(0);
    expect(labelToOffset("X+1")).toBeNull();
  });

  it("WINDOW(T+1,T+5) 的偏移集 / 长度 / 包含判定", () => {
    const window = makeTemporalWindow(1, 5, "TRADING_DAY");
    expect(windowOffsets(window)).toEqual([1, 2, 3, 4, 5]);
    expect(windowLength(window)).toBe(5);
    expect(windowContains(window, 1)).toBe(true);
    expect(windowContains(window, 5)).toBe(true);
    expect(windowContains(window, 0)).toBe(false);
    expect(windowContains(window, 6)).toBe(false);
  });

  it("非法窗口（start > end / 非整数）响亮抛错", () => {
    expect(() => makeTemporalWindow(5, 1)).toThrow(StrategyCoreError);
    expect(() => makeTemporalWindow(0.5, 2)).toThrow(StrategyCoreError);
  });

  it("bar 可见性：同日 open 不可见、close 可见；未来日不可见", () => {
    expect(isBarVisibleAt("2026-09-09", { date: "2026-09-10", point: "open" })).toBe(true);
    expect(isBarVisibleAt("2026-09-10", { date: "2026-09-10", point: "open" })).toBe(false);
    expect(isBarVisibleAt("2026-09-10", { date: "2026-09-10", point: "close" })).toBe(true);
    expect(isBarVisibleAt("2026-09-11", { date: "2026-09-10", point: "close" })).toBe(false);
  });

  it("日范围访问关卡：在 rd 上决策只能读 ≤ rd 的 bar，越界**记录违规**而非静默", () => {
    const access = createDayScopedBarAccess(barsFor(5), 2);
    expect(access.barAt(0)).not.toBeNull();
    expect(access.barAt(2)).not.toBeNull();
    expect(access.barAt(3)).toBeNull();
    expect(access.violations().length).toBe(1);
    expect(access.violations()[0]?.reason).toBe("FUTURE_RELATIVE_DAY");
    expect(access.barsUpTo(2).map((item) => item.relativeDay)).toEqual([0, 1, 2]);
    expect(access.barsUpTo(4).map((item) => item.relativeDay)).toEqual([0, 1, 2]);
    expect(access.violations().length).toBe(2);
  });

  it("相对日重复的 bar 集被拒绝（不允许歧义）", () => {
    expect(() => createDayScopedBarAccess({ bars: [BAR_FIXTURE(0), BAR_FIXTURE(0)] }, 0)).toThrow(StrategyCoreError);
  });
});

// ---------------------------------------------------------------------------
// §23.1 RuleGraph
// ---------------------------------------------------------------------------

describe("§23.1 RuleGraph — 节点求值", () => {
  it("ALL：全真才真；ANY：一真即真", () => {
    expect(run(Rule.all([TRUE_COND, TRUE_COND])).evaluation.satisfied).toBe(true);
    expect(run(Rule.all([TRUE_COND, FALSE_COND])).evaluation.satisfied).toBe(false);
    expect(run(Rule.any([TRUE_COND, FALSE_COND])).evaluation.satisfied).toBe(true);
    expect(run(Rule.any([FALSE_COND, FALSE_COND])).evaluation.satisfied).toBe(false);
  });

  it("NOT：取反", () => {
    expect(run(Rule.not(TRUE_COND)).evaluation.satisfied).toBe(false);
    expect(run(Rule.not(FALSE_COND)).evaluation.satisfied).toBe(true);
  });

  it("CONDITION：8 个运算符**全部可执行**（不像 legacy 只映射 5 个）", () => {
    expect(run(Rule.condition(Expr.constant(3), "GT", Expr.constant(2))).evaluation.satisfied).toBe(true);
    expect(run(Rule.condition(Expr.constant(2), "GTE", Expr.constant(2))).evaluation.satisfied).toBe(true);
    expect(run(Rule.condition(Expr.constant(1), "LT", Expr.constant(2))).evaluation.satisfied).toBe(true);
    expect(run(Rule.condition(Expr.constant(2), "LTE", Expr.constant(2))).evaluation.satisfied).toBe(true);
    expect(run(Rule.condition(Expr.constant("a"), "EQ", Expr.constant("a"))).evaluation.satisfied).toBe(true);
    expect(run(Rule.condition(Expr.constant("a"), "NEQ", Expr.constant("b"))).evaluation.satisfied).toBe(true);
    expect(run(Rule.condition(Expr.constant("a"), "IN", Expr.array(["a", "b"]))).evaluation.satisfied).toBe(true);
    expect(run(Rule.condition(Expr.constant("c"), "NOT_IN", Expr.array(["a", "b"]))).evaluation.satisfied).toBe(true);
  });

  it("CONDITION：IN 的右值必须是 ARRAY（否则抛错，不静默）", () => {
    expect(() => run(Rule.condition(Expr.constant("a"), "IN", Expr.constant("a")))).toThrow(StrategyCoreError);
  });

  it("CONDITION：算术右值可表达（legacy 写不下 `volume > MA5Volume * 2`）", () => {
    const node = Rule.condition(
      Expr.field("bar.volume"),
      "GT",
      Expr.binary("*", Expr.feature("ma5"), Expr.constant(2)),
      "vol-breakout",
    );
    const ok = run(node, { currentDay: 1, featureValues: { ma5: 100 } });
    // bar.volume 默认 1_000_000 > 100*2
    expect(ok.evaluation.satisfied).toBe(true);
    const notOk = run(node, { currentDay: 1, featureValues: { ma5: 1_000_000 } });
    expect(notOk.evaluation.satisfied).toBe(false);
  });

  it("EVENT：事件判定器说了算", () => {
    const node = Rule.event("FIRST_LIMIT_UP", "e1");
    expect(run(node, { eventOccurred: true }).evaluation.satisfied).toBe(true);
    expect(run(node, { eventOccurred: false }).evaluation.satisfied).toBe(false);
    expect(run(node, { eventOccurred: (type) => type === "FIRST_LIMIT_UP" }).evaluation.satisfied).toBe(true);
  });

  it("WINDOW：ANY_DAY / ALL_DAYS 两种量化器语义可辨", () => {
    const window = makeTemporalWindow(1, 3, "TRADING_DAY");
    // 夹具默认 low = 10.2；构造「只有 T+3 守住 10.3」的混合数据
    const bars = barsFor(3, { 1: { low: 10.0 }, 2: { low: 10.0 }, 3: { low: 10.4 } });
    const anyDay = Rule.window(window, "ANY_DAY", Rule.condition(Expr.field("bar.low"), "GTE", Expr.constant(10.3), "hold"), "w-any");
    const allDaysStrict = Rule.window(window, "ALL_DAYS", Rule.condition(Expr.field("bar.low"), "GTE", Expr.constant(10.3), "hold2"), "w-all-strict");
    const allDaysLoose = Rule.window(window, "ALL_DAYS", Rule.condition(Expr.field("bar.low"), "GTE", Expr.constant(10.1), "hold3"), "w-all-loose");
    expect(run(anyDay, { bars, currentDay: 3 }).evaluation.satisfied).toBe(true);
    expect(run(allDaysStrict, { bars, currentDay: 3 }).evaluation.satisfied).toBe(false);
    expect(run(allDaysLoose, { bars: barsFor(3), currentDay: 3 }).evaluation.satisfied).toBe(true);
    expect(run(allDaysLoose, { bars, currentDay: 3 }).evaluation.satisfied).toBe(false);
  });

  it("WINDOW：只看**当前决策日及之前**的窗口日（未到的日子登记为 futureSkipped）", () => {
    const node = Rule.window(
      makeTemporalWindow(1, 5, "TRADING_DAY"),
      "ALL_DAYS",
      Rule.condition(Expr.constant(1), "EQ", Expr.constant(1)),
      "w-pit",
    );
    const at2 = run(node, { currentDay: 2 });
    const trace2 = at2.evaluation.traces.find((item) => item.nodeId === "w-pit");
    expect(trace2?.windowValidDays).toEqual([1, 2]);
    expect(trace2?.satisfied).toBe(false);
    expect(trace2?.detail).toContain("[3,4,5]");
    const at5 = run(node, { currentDay: 5 });
    expect(at5.evaluation.traces.find((item) => item.nodeId === "w-pit")?.satisfied).toBe(true);
  });

  it("SEQUENCE：A → B → C 有序发生（各步发生日必须非降）", () => {
    const stepA = Rule.event("BREAKOUT", "step-a");
    const stepB = Rule.window(
      makeTemporalWindow(1, 3, "TRADING_DAY"),
      "ANY_DAY",
      Rule.condition(Expr.field("bar.close"), "GTE", Expr.constant(10.4), "step-b-cond"),
      "step-b",
    );
    const stepC = Rule.window(
      makeTemporalWindow(2, 4, "TRADING_DAY"),
      "ANY_DAY",
      Rule.condition(Expr.field("bar.close"), "GTE", Expr.constant(10.4), "step-c-cond"),
      "step-c",
    );
    const node = Rule.sequence([stepA, stepB, stepC], "seq");
    const ok = run(node, { currentDay: 4, eventOccurred: true });
    expect(ok.evaluation.satisfied).toBe(true);
    const trace = ok.evaluation.traces.find((item) => item.nodeId === "seq");
    expect(trace?.sequenceDays?.[0]).toBe(0);
    expect(trace?.sequenceDays?.[1]).not.toBeNull();
    expect(trace?.sequenceDays?.[2]).not.toBeNull();
    expect(run(node, { currentDay: 4, eventOccurred: false }).evaluation.satisfied).toBe(false);
  });

  it("TRIGGER：四种触发类型的选日语义", () => {
    expect(resolveTriggerSatisfaction("FIRST_VALID_DAY", [2, 3, 4], 2)).toBe(true);
    expect(resolveTriggerSatisfaction("FIRST_VALID_DAY", [2, 3, 4], 3)).toBe(false);
    expect(resolveTriggerSatisfaction("LAST_VALID_DAY", [2, 3, 4], 4)).toBe(true);
    expect(resolveTriggerSatisfaction("EVERY_VALID_DAY", [2, 3, 4], 3)).toBe(true);
    expect(resolveTriggerSatisfaction("NEXT_TRADING_DAY", [2, 3, 4], 5)).toBe(true);
    expect(resolveTriggerSatisfaction("NEXT_TRADING_DAY", [2, 3, 4], 4)).toBe(false);
    expect(resolveTriggerSatisfaction("FIRST_VALID_DAY", [], 1)).toBe(false);
    expect(triggerCandidateDays("LAST_VALID_DAY", [2, 3, 4])).toEqual([4]);
  });

  it("组合表达：A AND (B OR C)", () => {
    expect(run(Rule.all([TRUE_COND, Rule.any([FALSE_COND, FALSE_COND])])).evaluation.satisfied).toBe(false);
    expect(run(Rule.all([TRUE_COND, Rule.any([FALSE_COND, TRUE_COND])])).evaluation.satisfied).toBe(true);
  });

  it("组合表达：A AND NOT(B)", () => {
    expect(run(Rule.all([TRUE_COND, Rule.not(FALSE_COND)])).evaluation.satisfied).toBe(true);
    expect(run(Rule.all([TRUE_COND, Rule.not(TRUE_COND)])).evaluation.satisfied).toBe(false);
  });

  it("数据缺失（操作数为 null）⇒ 条件视为不成立，并登记到 insufficiencies（不抛错、不臆造）", () => {
    const node = Rule.condition(Expr.field("bar.close"), "GT", Expr.constant(1), "missing");
    const result = run(node, { currentDay: 1, bars: { bars: [] } });
    expect(result.evaluation.satisfied).toBe(false);
    expect(result.insufficiencies.length).toBeGreaterThan(0);
  });
});

describe("§23.1 RuleGraph — 静态校验", () => {
  it("未知事件类型 / 未知运算符 / 空 ALL / 空 SEQUENCE / 未知触发全部被拒", () => {
    expect(validateRuleGraph(Rule.event("NOT_AN_EVENT", "e")).length).toBe(1);
    expect(validateRuleGraph(Rule.condition(Expr.constant(1), "WAT" as never, Expr.constant(1))).length).toBeGreaterThan(0);
    expect(validateRuleGraph(Rule.all([], "empty")).length).toBe(1);
    expect(validateRuleGraph(Rule.sequence([], "empty-seq")).length).toBe(1);
    expect(validateRuleGraph(Rule.trigger("WAT" as never)).length).toBe(1);
  });

  it("WINDOW 缺少量化器（undefined）被拒 —— **不编默认值**", () => {
    const node = { kind: "WINDOW", window: makeTemporalWindow(1, 3), child: TRUE_COND } as unknown as RuleNode;
    const issues = validateRuleGraph(node);
    expect(issues.some((issue) => issue.message.includes("量化器"))).toBe(true);
  });

  it("未知字段引用 / 未知参数被拒", () => {
    const node = Rule.condition(Expr.field("nope.rd0.close"), "GT", Expr.param("nope"), "bad");
    const issues = validateRuleGraph(node, {
      isKnownField: (field) => field === "bar.low",
      isKnownFeature: () => false,
      isKnownParameter: (code) => code === "max_volume_ratio",
    });
    expect(issues.some((issue) => issue.code === "FIELD_REFERENCE_UNKNOWN")).toBe(true);
    expect(issues.some((issue) => issue.code === "PARAMETER_UNKNOWN")).toBe(true);
  });

  it("嵌套深度上限生效（防病态图）", () => {
    let node: RuleNode = TRUE_COND;
    for (let index = 0; index < 6; index += 1) node = Rule.not(node);
    expect(validateRuleGraph(node, { maxDepth: 3 }).some((issue) => issue.message.includes("嵌套深度"))).toBe(true);
    expect(validateRuleGraph(node, { maxDepth: 32 }).length).toBe(0);
  });
});
