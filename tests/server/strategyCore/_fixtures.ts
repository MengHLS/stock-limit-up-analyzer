/**
 * STRATEGY-ARCH-001 测试夹具（**非测试文件**：不被 vitest 的 include 收集）。
 *
 * 只放「构造」不放「断言」，避免各测试文件各自手搓业务样例导致口径漂移。
 */

import {
  createCoreDefinition,
  createDefaultFeatureRegistry,
  createStrategyVersion,
  Expr,
  getDefaultFeatureRegistry,
  Rule,
  makeTemporalWindow,
  deriveCapabilities,
  deriveDataRequirementsFromRuleGraph,
  DEFAULT_LONG_ONLY_TRANSITIONS,
  type BarUniverse,
  type CoreValue,
  type DeclaredExitRule,
  type FeatureRequirement,
  type PositionSpec,
  type RiskSpec,
  type StrategyCoreDefinition,
  type StrategyVersion,
  type VisibleBar,
  type WindowQuantifier,
  type CoreTriggerType,
} from "../../../server/strategyCore";

export const FIXED_CREATED_AT = "2026-09-19T00:00:00.000Z";

/** 构造一根 bar（日期由相对日派生，保证确定性）。 */
export function bar(
  relativeDay: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  preClose?: number,
): VisibleBar {
  const day = String(10 + relativeDay).padStart(2, "0");
  return {
    date: "2026-09-" + day,
    relativeDay,
    open,
    high,
    low,
    close,
    volume,
    amount: volume * close,
    ...(preClose === undefined ? {} : { preClose }),
  };
}

/** 构造 bar 集（相对日 0..maxRelativeDay）。 */
export function barsThrough(maxRelativeDay: number, overrides: Partial<Record<number, Partial<VisibleBar>>> = {}): BarUniverse {
  const bars: VisibleBar[] = [];
  for (let rd = 0; rd <= maxRelativeDay; rd += 1) {
    const base = bar(rd, 10 + rd * 0.1, 10.6 + rd * 0.1, 10.2 + rd * 0.1, 10.4 + rd * 0.1, 1_000_000 - rd * 200_000, 10 + (rd - 1) * 0.1);
    bars.push({ ...base, ...(overrides[rd] ?? {}) });
  }
  return { bars };
}

/** 事件日（rd=0）bar：打开价 10.00，成交量 1,000,000。 */
export const EVENT_BAR = bar(0, 10, 10.6, 9.9, 10.5, 1_000_000);

/**
 * 「首板回踩 · 守线 + 缩量」的 Core 定义（规格 §22 的验证样例）。
 *
 * 语义：
 *   FIRST_LIMIT_UP
 *     → WINDOW(T+1..T+5, ANY_DAY, ALL[ bar.low >= prefix.rd0.open,
 *                                      bar.volumeRatio <= param(max_volume_ratio),
 *                                      bar.isBullish == 1 ])
 *     → TRIGGER(FIRST_VALID_DAY)
 */
export interface PullbackFixtureOptions {
  readonly quantifier?: WindowQuantifier;
  readonly window?: { readonly start: number; readonly end: number };
  readonly trigger?: CoreTriggerType;
  readonly includeBullishCondition?: boolean;
  readonly maxVolumeRatioDefault?: number;
  readonly exitRuleGraph?: boolean;
}

export function makePullbackDefinition(options: PullbackFixtureOptions = {}): StrategyCoreDefinition {
  const registry = getDefaultFeatureRegistry();
  const window = options.window ?? { start: 1, end: 5 };
  const conditions = [
    Rule.condition(Expr.field("bar.low"), "GTE", Expr.field("prefix.rd0.open"), "hold-line", "回踩不破首板日开盘价"),
    Rule.condition(
      Expr.field("bar.volumeRatio"),
      "LTE",
      Expr.param("max_volume_ratio"),
      "shrink-volume",
      "量能比不超过阈值（缩量）",
    ),
  ];
  if (options.includeBullishCondition !== false) {
    conditions.push(Rule.condition(Expr.field("bar.isBullish"), "EQ", Expr.constant(1), "bullish", "当日阳线"));
  }

  const steps = [
    Rule.event("FIRST_LIMIT_UP", "entry.event"),
    Rule.window(
      makeTemporalWindow(window.start, window.end, "TRADING_DAY"),
      options.quantifier ?? "ANY_DAY",
      Rule.all(conditions, "entry.conditions"),
      "entry.window",
    ),
    Rule.trigger(options.trigger ?? "FIRST_VALID_DAY", "entry.trigger"),
  ];
  const ruleGraph = Rule.sequence(steps, "entry");
  const exitRuleGraph = options.exitRuleGraph === true
    ? Rule.any([Rule.condition(Expr.field("bar.isBullish"), "EQ", Expr.constant(0), "exit.bearish")], "exit")
    : null;

  const exitRules: DeclaredExitRule[] = [
    { id: "exit-1", type: "TAKE_PROFIT", trigger: "ON_OPEN", threshold: 0.1, thresholdUnit: "RATIO", parameter: null, condition: null, priority: 1, enabled: true },
    { id: "exit-2", type: "STOP_LOSS", trigger: "ON_OPEN", threshold: 0.05, thresholdUnit: "RATIO", parameter: null, condition: null, priority: 2, enabled: true },
  ];

  const positionSpec: PositionSpec = { sizingMethod: "EQUAL_WEIGHT", maxPositions: 3 };
  const riskSpec: RiskSpec = { stopLoss: 0.05, maxDrawdown: 0.2 };

  const featureRequirements: FeatureRequirement[] = [
    { featureId: "volumeRatio", version: "1.0.0" },
    { featureId: "isBullish", version: "1.0.0" },
  ];

  const capabilities = deriveCapabilities({ ruleGraph, exitRuleGraph, positionSpec });

  return createCoreDefinition(
    {
      ruleGraph,
      exitRuleGraph,
      exitRules,
      positionSpec,
      riskSpec,
      featureRequirements,
      parameterSchema: [
        {
          code: "max_volume_ratio",
          name: "缩量阈值",
          dataType: "number",
          role: "TUNABLE",
          defaultValue: options.maxVolumeRatioDefault ?? 0.3,
          min: 0.1,
          max: 1,
          step: 0.1,
          unit: "ratio",
          required: true,
        },
        {
          code: "require_bullish",
          name: "是否要求红盘",
          dataType: "boolean",
          role: "FIXED",
          defaultValue: true,
          required: false,
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
          code: "max_drawdown_tolerance",
          name: "容忍的回撤上限（派生）",
          dataType: "number",
          role: "DERIVED",
          derivedFrom: Expr.binary("-", Expr.constant(1), Expr.param("stop_loss")),
          required: false,
        },
      ],
      dataRequirements: deriveDataRequirementsFromRuleGraph(ruleGraph, {
        frequency: "1D",
        featureRegistry: registry,
        eventRequirements: [{ eventType: "FIRST_LIMIT_UP", required: true }],
      }),
      executionSemantics: {
        signalTiming: "T_CLOSE",
        confirmationTiming: "ON_BAR_CLOSE",
        executionTiming: "T_PLUS_1_OPEN",
        priceReference: "OPEN",
        stateTransition: DEFAULT_LONG_ONLY_TRANSITIONS,
      },
      capabilities,
    },
    { featureRegistry: registry },
  );
}

/** 由定义构造版本（默认已发布）。 */
export function makeVersion(
  definition: StrategyCoreDefinition,
  overrides: Partial<{ strategyId: string; version: string; createdAt: string; name: string; status: "DRAFT" | "PUBLISHED" | "DEPRECATED" }> = {},
): StrategyVersion {
  return createStrategyVersion({
    strategyId: overrides.strategyId ?? "first-limit-pullback",
    version: overrides.version ?? "1.0.0",
    definition,
    metadata: { name: overrides.name ?? "首板回踩（守线 + 缩量）", description: "STRATEGY-ARCH-001 测试样例" },
    createdAt: overrides.createdAt ?? FIXED_CREATED_AT,
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
  });
}

/** 默认特征注册表（测试里共用同一实例，避免重复构造）。 */
export const TEST_REGISTRY = createDefaultFeatureRegistry();

/** 快捷：构造「事件字段」记录（首板日身份信息）。 */
export function eventFields(overrides: Readonly<Record<string, CoreValue>> = {}): Readonly<Record<string, CoreValue>> {
  return {
    symbol: "600001.SH",
    tradeDate: "2026-09-10",
    previousClose: 9.09,
    limitUpPrice: 10.0,
    isFirstLimit: true,
    ...overrides,
  };
}

/** 快捷：从条件节点数推断「事件是否发生」的判定器。 */
export function alwaysEvent(): boolean {
  return true;
}
