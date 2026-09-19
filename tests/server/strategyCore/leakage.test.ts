/**
 * STRATEGY-ARCH-001 · 规格 §23.5 Leakage
 *
 * 必须有明确测试：`evaluate(T)` 不能访问 T+1 / T+2 / future outcome。
 */

import { describe, expect, it } from "vitest";
import {
  Expr,
  LeakageGuard,
  Rule,
  StrategyCoreError,
  StrategyRuntime,
  auditDefinitionLeakage,
  auditFeatureLeakage,
  futureOutcomeLeakage,
  sameBarLeakage,
  setEventOccurrenceResolver,
  type RuntimeContext,
} from "../../../server/strategyCore";
import { TEST_REGISTRY, barsThrough, eventFields, makePullbackDefinition, makeVersion } from "./_fixtures";

function errorCode(fn: () => unknown): string {
  try {
    fn();
    return "NO_ERROR";
  } catch (error) {
    return (error as { code?: string }).code ?? "NO_CODE";
  }
}

function runtimeContext(currentRelativeDay: number): RuntimeContext {
  return {
    timestamp: { date: "2026-09-11", point: "close" },
    instrument: { securityId: "sec_test", code: "600001.SH" },
    visibleData: barsThrough(5),
    currentRelativeDay,
    eventFields: eventFields(),
    state: { positionState: "FLAT", openPositions: 0 },
    datasetCapability: {
      frequency: "1D",
      availableFields: ["open", "low", "close", "volume"],
      availableDomains: ["OHLCV"],
      eventTypes: ["FIRST_LIMIT_UP"],
      maxRelativeDay: 5,
      availableHistory: 6,
    },
    resolveEvent: () => true,
  };
}

/** 把「引用了未来 bar」的条件塞进规则图（用于证明守卫真的拦得住）。 */
function definitionWithFutureCondition(field: string) {
  const base = makePullbackDefinition({ window: { start: 1, end: 1 } });
  return {
    ...base,
    ruleGraph: Rule.sequence(
      [
        Rule.event("FIRST_LIMIT_UP", "e"),
        Rule.all([Rule.condition(Expr.field(field), "GT", Expr.constant(1), "peek")], "body"),
        Rule.trigger("EVERY_VALID_DAY", "t"),
      ],
      "graph",
    ),
  };
}

describe("§23.5 Leakage — 静态审计（图结构层）", () => {
  it("path.* / outcome.*（前视标签层）一律拒绝", () => {
    const findings = auditDefinitionLeakage(
      { ...makePullbackDefinition(), ruleGraph: Rule.all([Rule.condition(Expr.field("outcome.return5d"), "GT", Expr.constant(0.1), "leak")]) },
      { featureRegistry: TEST_REGISTRY },
    );
    expect(findings.some((finding) => finding.message.includes("A1"))).toBe(true);
    expect(findings.some((finding) => finding.code === "LEAKAGE_LOOK_AHEAD")).toBe(true);
  });

  it("prefix.rd{n}（n > 0）虽形态像「前缀」，但值是未来 ⇒ 拒绝", () => {
    const findings = auditDefinitionLeakage(
      { ...makePullbackDefinition(), ruleGraph: Rule.all([Rule.condition(Expr.field("prefix.rd3.close"), "GT", Expr.constant(1), "fake-prefix")]) },
      { featureRegistry: TEST_REGISTRY },
    );
    expect(findings.some((finding) => finding.message.includes("A3"))).toBe(true);
  });

  it("post.rd{n} 超出「最早可引用偏移」⇒ 拒绝", () => {
    // makePullbackDefinition 的窗口是 T+1..T+5 ⇒ 最早可引用偏移 = 1；post.rd2 越界。
    // ⚠️ 判据必须保留 WINDOW 节点：**没有观察窗口时静态层不设界**（它证不出最早信号偏移），
    //    那种情况由运行时关卡负责（见下方「T+3 决策可读 post.rd2」用例）。
    const definition = makePullbackDefinition();
    const findings = auditDefinitionLeakage(
      {
        ...definition,
        ruleGraph: Rule.sequence(
          [definition.ruleGraph, Rule.all([Rule.condition(Expr.field("post.rd2.close"), "GT", Expr.constant(1), "future")], "extra")],
          "graph",
        ),
      },
      { featureRegistry: TEST_REGISTRY },
    );
    expect(findings.some((finding) => finding.message.includes("A4"))).toBe(true);
  });

  it("无 WINDOW 的纯条件策略：静态层不设 A4 界（不误杀），交由运行时判定", () => {
    const findings = auditDefinitionLeakage(
      {
        ...makePullbackDefinition(),
        ruleGraph: Rule.all([
          Rule.condition(Expr.field("bar.low"), "GTE", Expr.field("prefix.rd0.open"), "hold"),
          Rule.condition(Expr.field("post.rd2.close"), "GT", Expr.constant(1), "later"),
        ]),
      },
      { featureRegistry: TEST_REGISTRY },
    );
    expect(findings.some((finding) => finding.message.includes("A4"))).toBe(false);
  });

  it("未知时间域（未知根 / 未知字段）⇒ 默认拒绝", () => {
    const findings = auditDefinitionLeakage(
      { ...makePullbackDefinition(), ruleGraph: Rule.all([Rule.condition(Expr.field("mystery.field"), "GT", Expr.constant(1), "unknown")]) },
      { featureRegistry: TEST_REGISTRY },
    );
    expect(findings.some((finding) => finding.code === "LEAKAGE_UNKNOWN_TIME_DOMAIN")).toBe(true);
  });

  it("特征声明：future outcome / 需要未来数据 / 时点矛盾 全部被抓", () => {
    expect(auditFeatureLeakage("x", futureOutcomeLeakage(), "p", "close").length).toBe(2);
    expect(auditFeatureLeakage("x", sameBarLeakage("close", 0), "p", "close").length).toBe(0);
    const pointMismatch = auditFeatureLeakage("x", sameBarLeakage("close", 0), "p", "open");
    expect(pointMismatch.length).toBe(1);
    expect(pointMismatch[0]?.message).toContain("A7");
  });

  it("决策时点为 open + 特征声明 close 可得 ⇒ 由 executionSemantics 推出并拒绝", () => {
    const definition = makePullbackDefinition();
    const findings = auditDefinitionLeakage(
      {
        ...definition,
        executionSemantics: { ...definition.executionSemantics, signalTiming: "T_OPEN", confirmationTiming: "ON_BAR_OPEN" },
      },
      { featureRegistry: TEST_REGISTRY },
    );
    expect(findings.some((finding) => finding.message.includes("A7"))).toBe(true);
  });

  it("干净的定义：静态审计零发现", () => {
    expect(auditDefinitionLeakage(makePullbackDefinition(), { featureRegistry: TEST_REGISTRY })).toEqual([]);
  });
});

describe("§23.5 Leakage — 运行时关卡（evaluate(T) 不得读 T+1 / T+2 / future outcome）", () => {
  it("在 T+1 决策却引用 post.rd2 ⇒ 抛 LEAKAGE_LOOK_AHEAD（不是静默 null）", () => {
    setEventOccurrenceResolver(null);
    const version = makeVersion(definitionWithFutureCondition("post.rd2.close") as never);
    const code = errorCode(() =>
      StrategyRuntime.evaluate(version, { max_volume_ratio: 0.3 }, runtimeContext(1), {
        featureRegistry: TEST_REGISTRY,
        skipDataCompatibilityCheck: true,
      }),
    );
    expect(code).toBe("LEAKAGE_LOOK_AHEAD");
  });

  it("引用 T+2 的未来结果列（outcome.*）同样被拦", () => {
    const version = makeVersion(definitionWithFutureCondition("outcome.return5d") as never);
    const code = errorCode(() =>
      StrategyRuntime.evaluate(version, { max_volume_ratio: 0.3 }, runtimeContext(3), {
        featureRegistry: TEST_REGISTRY,
        skipDataCompatibilityCheck: true,
      }),
    );
    expect(code).toBe("LEAKAGE_LOOK_AHEAD");
  });

  it("同一图在 T+3 决策时可正常读到 post.rd2（T+2 已成为历史）", () => {
    const version = makeVersion(definitionWithFutureCondition("post.rd2.close") as never);
    const decision = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.3 }, runtimeContext(3), {
      featureRegistry: TEST_REGISTRY,
      skipDataCompatibilityCheck: true,
    });
    expect(decision.strategyVersion).toBe("1.0.0");
    expect(decision.signals.length).toBe(1);
    expect(decision.signals[0]?.signalDay).toBe(3);
  });

  it("LeakageGuard.assertNoViolations：非空即抛；空数组通过", () => {
    expect(() =>
      LeakageGuard.assertNoViolations([{ relativeDay: 3, requestedAtDay: 1, reason: "FUTURE_RELATIVE_DAY" }]),
    ).toThrow(StrategyCoreError);
    expect(() => LeakageGuard.assertNoViolations([])).not.toThrow();
  });

  it("LeakageGuard.assertFieldReadable：在 rd=1 读 post.rd2 抛错；读 prefix.rd0 通过；path.* 抛错", () => {
    expect(() => LeakageGuard.assertFieldReadable("post.rd2.close", 1, "p")).toThrow(StrategyCoreError);
    expect(() => LeakageGuard.assertFieldReadable("prefix.rd0.open", 1, "p")).not.toThrow();
    expect(() => LeakageGuard.assertFieldReadable("path.drawdown", 1, "p")).toThrow(StrategyCoreError);
  });

  it("LeakageGuard.assertFeatureUsable：open 决策点不可用 close 特征", () => {
    expect(() =>
      LeakageGuard.assertFeatureUsable("f", sameBarLeakage("close", 0), { date: "2026-09-11", point: "open" }),
    ).toThrow(StrategyCoreError);
    expect(() =>
      LeakageGuard.assertFeatureUsable("f", sameBarLeakage("close", 0), { date: "2026-09-11", point: "close" }),
    ).not.toThrow();
  });

  it("「未注入事件判定器」与「当日无事件」被区分开（不静默返回 false）", () => {
    setEventOccurrenceResolver(null);
    const version = makeVersion(makePullbackDefinition());
    const contextNoResolver: RuntimeContext = { ...runtimeContext(2), resolveEvent: undefined };
    const code = errorCode(() =>
      StrategyRuntime.evaluate(version, { max_volume_ratio: 0.3 }, contextNoResolver, {
        featureRegistry: TEST_REGISTRY,
        skipDataCompatibilityCheck: true,
      }),
    );
    expect(code).toBe("CORE_DEFINITION_INVALID");

    // 注入「当日无事件」的判定器 ⇒ 正常产出「无信号」的决策，而不是抛错
    const decision = StrategyRuntime.evaluate(
      version,
      { max_volume_ratio: 0.3 },
      { ...runtimeContext(2), resolveEvent: () => false },
      { featureRegistry: TEST_REGISTRY, skipDataCompatibilityCheck: true },
    );
    expect(decision.signals.length).toBe(0);
  });
});
