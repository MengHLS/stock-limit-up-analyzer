/**
 * STRATEGY-ARCH-001 · 规格 §23.6 Runtime（+ §22 首板回踩可表达性 / §19 legacy 适配）
 *
 * 覆盖：StrategyVersion + ParameterSet + RuntimeContext → StrategyDecision 完整跑通；
 *      参数覆写改变结果；数据兼容性拒绝；legacy 定义 ⇄ Core 双向适配。
 */

import { describe, expect, it } from "vitest";
import {
  StrategyRuntime,
  computeDefinitionFingerprint,
  findDatasetBindingLeaks,
  fromLegacyStrategyDefinition,
  getDefaultFeatureRegistry,
  toLegacyStrategyDefinition,
  type RuntimeContext,
  type VisibleBar,
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

/** 首板回踩的真实行情样例：T+1 守住首板日开盘 + 缩量 + 红盘。 */
function pullbackBars(): { readonly bars: readonly VisibleBar[] } {
  const universe = barsThrough(5, {
    0: { open: 10, close: 11, low: 9.9, volume: 1_000_000 },
    1: { open: 10.5, low: 10.2, close: 10.8, volume: 300_000 },
  });
  return { bars: universe.bars };
}

function context(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    timestamp: { date: "2026-09-11", point: "close" },
    instrument: { securityId: "sec_test-600001", code: "600001.SH" },
    visibleData: pullbackBars(),
    currentRelativeDay: 1,
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
    ...overrides,
  };
}

describe("§23.6 Runtime — Version + ParameterSet + Context → Decision", () => {
  it("完整跑通：命中信号 + 入场意图 + 仓位意图（Event Study / Backtest 各取所需）", () => {
    const version = makeVersion(makePullbackDefinition());
    const detail = StrategyRuntime.evaluateWithDetail(version, { max_volume_ratio: 0.5 }, context(), {
      featureRegistry: TEST_REGISTRY,
    });
    const decision = detail.decision;
    expect(detail.compatibility.compatible).toBe(true);
    expect(decision.strategyId).toBe("first-limit-pullback");
    expect(decision.strategyVersion).toBe("1.0.0");
    expect(decision.definitionFingerprint).toBe(computeDefinitionFingerprint(version.definition));
    // 事件（Event Study 消费）
    expect(decision.events.map((event) => event.eventType)).toEqual(["FIRST_LIMIT_UP"]);
    // 信号 + 入场意图（Signal Backtest 消费）
    expect(decision.signals.length).toBe(1);
    expect(decision.signals[0]?.signalDay).toBe(1);
    expect(decision.entryIntents.length).toBe(1);
    expect(decision.entryIntents[0]?.resultingState).toBe("PENDING_ENTRY");
    // 仓位意图（Portfolio Backtest 消费）
    expect(decision.positionIntents.length).toBe(1);
    expect(decision.positionIntents[0]?.sizingMethod).toBe("EQUAL_WEIGHT");
    expect(decision.positionIntents[0]?.maxPositions).toBe(3);
    // 未持仓 ⇒ 不求值出场图（不凭空产出 exitIntent）
    expect(decision.exitIntents.length).toBe(0);
    expect(decision.insufficientData).toBe(false);
    expect(decision.explanation.length).toBeGreaterThan(0);
  });

  it("参数覆写真的改变结果（不是声明了却无效）", () => {
    const version = makeVersion(makePullbackDefinition());
    // 量能比 = 0.3；阈值 0.5 ⇒ 成立；阈值 0.2 ⇒ 不成立
    const loose = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.5 }, context(), { featureRegistry: TEST_REGISTRY });
    const strict = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.2 }, context(), { featureRegistry: TEST_REGISTRY });
    expect(loose.signals.length).toBe(1);
    expect(strict.signals.length).toBe(0);
  });

  it("条件不成立 ⇒ 无信号（不是「有信号但被后面丢掉」）", () => {
    const version = makeVersion(makePullbackDefinition());
    // 把 T+1 的最低价压到首板日开盘价之下 ⇒ 守线条件不成立 ⇒ 窗口内无有效日 ⇒ 无信号
    const brokenHold = barsThrough(5, {
      0: { open: 10, close: 11, low: 9.9, volume: 1_000_000 },
      1: { open: 9.9, low: 9.0, close: 9.6, volume: 300_000 },
    });
    const decision = StrategyRuntime.evaluate(
      version,
      { max_volume_ratio: 0.5 },
      context({ visibleData: brokenHold }),
      { featureRegistry: TEST_REGISTRY },
    );
    expect(decision.signals.length).toBe(0);
    expect(decision.entryIntents.length).toBe(0);
    // 事件仍然命中（Event Study 仍可消费「事件发生了」这一事实）
    expect(decision.events.length).toBe(1);
  });

  it("持有中 + 有出场图 ⇒ 产出出场意图（状态迁移到 PENDING_EXIT）", () => {
    const version = makeVersion(makePullbackDefinition({ exitRuleGraph: true }));
    const detail = StrategyRuntime.evaluateWithDetail(
      version,
      { max_volume_ratio: 1 },
      context({
        state: { positionState: "LONG", openPositions: 1 },
        visibleData: barsThrough(5, { 0: { open: 10, close: 11, volume: 1_000_000 }, 1: { open: 10.8, low: 10.5, close: 10.6, volume: 300_000 } }),
      }),
      { featureRegistry: TEST_REGISTRY },
    );
    // isBullish = 0（close 10.6 < open 10.8）⇒ 出场图（bar.isBullish == 0）成立
    expect(detail.exitEvaluation?.satisfied).toBe(true);
    expect(detail.decision.exitIntents.length).toBe(1);
    expect(detail.decision.exitIntents[0]?.resultingState).toBe("PENDING_EXIT");
  });

  it("数据能力不满足 ⇒ 抛 DATA_REQUIREMENTS_UNSATISFIED（逐项如实，不笼统）", () => {
    const version = makeVersion(makePullbackDefinition());
    const code = errorCode(() =>
      StrategyRuntime.evaluate(
        version,
        { max_volume_ratio: 0.5 },
        context({
          datasetCapability: {
            frequency: "1D",
            availableFields: ["close"],
            availableDomains: ["OHLCV"],
            eventTypes: ["FIRST_LIMIT_UP"],
          },
        }),
        { featureRegistry: TEST_REGISTRY },
      ),
    );
    expect(code).toBe("DATA_REQUIREMENTS_UNSATISFIED");
  });

  it("预检入口：checkCompatibility / auditLeakage 不执行规则也能用", () => {
    const version = makeVersion(makePullbackDefinition());
    const report = StrategyRuntime.checkCompatibility(version, {
      frequency: "1D",
      availableFields: ["open", "low"],
      availableDomains: ["OHLCV"],
      eventTypes: ["FIRST_LIMIT_UP"],
    });
    expect(report.compatible).toBe(true);
    expect(report.notes.length).toBeGreaterThan(0); // 未声明 availableHistory / maxRelativeDay ⇒ 如实提示
    expect(StrategyRuntime.auditLeakage(version, { featureRegistry: TEST_REGISTRY })).toEqual([]);
  });

  it("同一输入重复求值 ⇒ 结果逐字节一致（确定性）", () => {
    const version = makeVersion(makePullbackDefinition());
    const a = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.5 }, context(), { featureRegistry: TEST_REGISTRY });
    const b = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.5 }, context(), { featureRegistry: TEST_REGISTRY });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("决策对象被深冻结（消费者无法事后篡改）", () => {
    const version = makeVersion(makePullbackDefinition());
    const decision = StrategyRuntime.evaluate(version, { max_volume_ratio: 0.5 }, context(), { featureRegistry: TEST_REGISTRY });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.signals)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §22 / §19 legacy 适配
// ---------------------------------------------------------------------------

/** 一份 legacy `StrategyDefinition`（形态对齐 `strategySchema/definition.ts`）。 */
function legacyDefinition() {
  return {
    schemaVersion: "1.0",
    entry: {
      event: { type: "FIRST_LIMIT_UP" },
      observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
      conditions: [
        {
          id: "hold-line",
          field: "bar.low",
          operator: "GREATER_THAN_OR_EQUAL",
          value: "prefix.rd0.open",
          valueType: "FIELD_REFERENCE",
          enabled: true,
        },
        {
          id: "shrink-volume",
          field: "bar.volumeRatio",
          operator: "LESS_THAN_OR_EQUAL",
          value: "max_volume_ratio",
          valueType: "PARAMETER_REFERENCE",
          enabled: true,
        },
        {
          id: "disabled-one",
          field: "bar.isBullish",
          operator: "EQUAL",
          value: 1,
          valueType: "CONSTANT",
          enabled: false,
        },
      ],
      trigger: { type: "FIRST_VALID_DAY" },
    },
    exit: {
      rules: [
        { id: "exit-1", type: "STOP_LOSS", trigger: "ON_OPEN", threshold: 0.05, thresholdUnit: "RATIO", priority: 1, enabled: true },
        { id: "exit-2", type: "TAKE_PROFIT", trigger: "ON_OPEN", threshold: 0.1, thresholdUnit: "RATIO", priority: 2, enabled: true },
      ],
    },
    position: { sizingMethod: "EQUAL_WEIGHT", maxPositions: 3 },
    risk: {},
    execution: {
      signalTiming: "T_CLOSE",
      executionTiming: "T_PLUS_1_OPEN",
      priceType: "OPEN",
      quantityMethod: "FIXED_SHARES",
      lotSize: 100,
    },
    parameters: [
      {
        code: "max_volume_ratio",
        name: "缩量阈值",
        dataType: "number",
        parameterRole: "TUNABLE",
        defaultValue: 0.3,
        min: 0.1,
        max: 1,
        step: 0.1,
        required: true,
      },
    ],
    datasets: [
      { datasetId: "ds_first_limit_pullback", datasetVersionId: 390002, datasetVersion: "v2", role: "PRIMARY" },
    ],
  } as never;
}

describe("§22 / §19 legacy → Core 适配", () => {
  it("首板回踩语义（FIRST_LIMIT_UP → T+1~T+5 → LOW >= T0_OPEN → ENTRY）由 RuleGraph 表达并真实执行", () => {
    const adapted = fromLegacyStrategyDefinition(legacyDefinition(), { featureRegistry: TEST_REGISTRY });
    const version = makeVersion(adapted.definition, { strategyId: "adapted-pullback" });

    const decision = StrategyRuntime.evaluate(
      version,
      { max_volume_ratio: 0.5 },
      context({ datasetCapability: { frequency: "1D", availableFields: ["open", "low", "close", "volume"], availableDomains: ["OHLCV"], eventTypes: ["FIRST_LIMIT_UP"], maxRelativeDay: 5, availableHistory: 6 } }),
      { featureRegistry: TEST_REGISTRY },
    );

    expect(decision.events.map((event) => event.eventType)).toEqual(["FIRST_LIMIT_UP"]);
    expect(decision.signals.length).toBe(1);
    expect(decision.entryIntents.length).toBe(1);
    // 声明面：featureRequirements 由 `bar.volumeRatio` 桥接得到（不是空）
    expect(adapted.definition.featureRequirements.map((item) => item.featureId)).toEqual(["volumeRatio"]);
    // 量化器如实登记为 ANY_DAY，并显式说明 legacy 无法表达 ALL_DAYS
    expect(adapted.notes.some((note) => note.includes("ANY_DAY"))).toBe(true);
    expect(adapted.notes.some((note) => note.includes("ALL_DAYS"))).toBe(true);
  });

  it("Dataset 绑定被**分离**出 Definition（规格 §10）；Definition 内零绑定泄漏", () => {
    const adapted = fromLegacyStrategyDefinition(legacyDefinition(), { featureRegistry: TEST_REGISTRY });
    expect(adapted.datasetBinding.length).toBe(1);
    expect(adapted.datasetBinding[0]?.datasetVersionId).toBe(390002);
    expect(findDatasetBindingLeaks(adapted.definition)).toEqual([]);
    const serialized = JSON.stringify(adapted.definition);
    expect(serialized.includes("datasetVersionId")).toBe(false);
    expect(serialized.includes("390002")).toBe(false);
  });

  it("未进 RuleGraph 的出场规则被**如实登记**（不静默丢弃）；STOP_LOSS 映射进 riskSpec", () => {
    const adapted = fromLegacyStrategyDefinition(legacyDefinition(), { featureRegistry: TEST_REGISTRY });
    expect(adapted.unmappedExitRuleIds.sort()).toEqual(["exit-1", "exit-2"]);
    expect(adapted.definition.exitRules.length).toBe(2);
    expect(adapted.definition.riskSpec.stopLoss).toBeCloseTo(0.05, 10);
    expect(adapted.notes.some((note) => note.includes("阈值型"))).toBe(true);
  });

  it("disabled 条件不进规则图，且如实登记（不当成成立）", () => {
    const adapted = fromLegacyStrategyDefinition(legacyDefinition(), { featureRegistry: TEST_REGISTRY });
    expect(JSON.stringify(adapted.definition).includes("isBullish")).toBe(false);
    expect(adapted.notes.some((note) => note.includes("disabled"))).toBe(true);
  });

  it("双向适配：legacy → Core → legacy → Core 指纹保持一致（同义子集可逆）", () => {
    const first = fromLegacyStrategyDefinition(legacyDefinition(), { featureRegistry: TEST_REGISTRY });
    const back = toLegacyStrategyDefinition(first.definition, first.datasetBinding);
    const second = fromLegacyStrategyDefinition(back, { featureRegistry: TEST_REGISTRY });
    expect(computeDefinitionFingerprint(second.definition)).toBe(computeDefinitionFingerprint(first.definition));
  });

  it("逆映射拒绝 legacy 表达不了的构造（如 ALL_DAYS 量化器）", () => {
    const allDays = makePullbackDefinition({ quantifier: "ALL_DAYS" });
    expect(errorCode(() => toLegacyStrategyDefinition(allDays, []))).toBe("LEGACY_MAPPING_UNSUPPORTED");
  });

  it("未登记的运算符 / 右值类型 ⇒ 抛 LEGACY_MAPPING_UNSUPPORTED（不猜、不降级）", () => {
    const broken = {
      ...(legacyDefinition() as Record<string, unknown>),
      entry: {
        event: { type: "FIRST_LIMIT_UP" },
        observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
        conditions: [
          { id: "c1", field: "bar.low", operator: "BETWEEN", value: 1, valueType: "CONSTANT", enabled: true },
        ],
        trigger: { type: "FIRST_VALID_DAY" },
      },
    } as never;
    expect(errorCode(() => fromLegacyStrategyDefinition(broken, { featureRegistry: TEST_REGISTRY }))).toBe(
      "LEGACY_MAPPING_UNSUPPORTED",
    );
  });

  it("legacy 引用未注册特征 ⇒ 响亮拒绝（Core 不接受未登记特征）", () => {
    const registry = getDefaultFeatureRegistry();
    const broken = {
      ...(legacyDefinition() as Record<string, unknown>),
      entry: {
        event: { type: "FIRST_LIMIT_UP" },
        observationWindow: { start: 1, end: 5, unit: "TRADING_DAY" },
        conditions: [
          { id: "c1", field: "bar.mysteryFactor", operator: "GREATER_THAN", value: 0, valueType: "CONSTANT", enabled: true },
        ],
        trigger: { type: "FIRST_VALID_DAY" },
      },
    } as never;
    expect(errorCode(() => fromLegacyStrategyDefinition(broken, { featureRegistry: registry }))).toBe(
      "CORE_DEFINITION_INVALID",
    );
  });
});
