/**
 * STRATEGY-ARCH-001 — StrategyRuntime（规格 §12）。
 *
 * 统一执行入口：
 *
 *   StrategyVersion + ParameterSet + RuntimeContext
 *        ↓
 *   StrategyRuntime.evaluate(...)
 *        ↓
 *   StrategyDecision
 *
 * RuntimeContext（规格 §12）：
 *   timestamp   决策时点
 *   instrument  标的（securityId + code）
 *   visibleData 可见 bar（PIT 由 `createDayScopedBarAccess` 把关）
 *   features    特征值（缺省由 FeatureRegistry 现场计算；可注入已算好的值以便确定性测试）
 *   parameters  已解析参数（或原始参数，由 Runtime 解析）
 *   state       持仓状态
 *
 * Runtime **做**：读上下文 → 执行 RuleGraph → 计算特征 → 解析条件 → 产出 StrategyDecision。
 * Runtime **不做**：撮合 / 滑点 / 手续费 / 现金 / 组合 / PnL / 券商（规格 §12 明文禁止）。
 *
 * 三条前置关卡（任一不过 ⇒ 响亮抛错，绝不降级跑）：
 *   ① `assertNoDatasetBindingInDefinition`（规格 §10）
 *   ② `assertNoDefinitionLeakage`（静态）→ 经 `LeakageGuard.assertFeatureUsable` 兜住特征面
 *   ③ `assertDataCompatible`（规格 §10 的兼容性契约）
 * 产出前还有第 ④ 关：`LeakageGuard.assertNoViolations`（运行期实际越界读取）。
 *
 * 纯模块：无 IO / 无 Date.now（时间来自 context.timestamp）/ 无 Math.random。
 */

import {
  StrategyCoreError,
  type CoreValue,
  type EvaluationTime,
  type PositionState,
  type RelativeDay,
} from "./types";
import {
  assertDataCompatible,
  checkDataCompatibility,
  type DataCompatibilityReport,
  type DatasetCapabilityDescriptor,
} from "./dataRequirements";
import { deepFreezeCoreDefinition, type StrategyCoreDefinition } from "./definition";
import {
  extractDecisionParts,
  freezeDecision,
  type DecisionCondition,
  type DecisionEvent,
  type DecisionSignal,
  type EntryIntent,
  type ExitIntent,
  type PositionIntent,
  type StrategyDecision,
} from "./decision";
import { nextPositionState } from "./executionSemantics";
import { parseCoreFieldReference } from "./fieldReference";
import { getDefaultFeatureRegistry, type FeatureRegistry } from "./featureRegistry";
import { assertNoDefinitionLeakage, auditDefinitionLeakage, LeakageGuard } from "./leakageGuard";
import type { ExpressionScope } from "./expression";
import {
  resolveParameters,
  type ParameterSet,
  type ResolvedParameterSet,
} from "./parameterResolver";
import { evaluateRuleGraph, type RuleEvaluationEnv, type RuleGraphEvaluation } from "./ruleGraph";
import {
  createDayScopedBarAccess,
  type BarUniverse,
  type DayScopedBarAccess,
  type VisibilityViolation,
  type VisibleBar,
} from "./temporal";
import { computeDefinitionFingerprint } from "./fingerprint";
import type { StrategyVersion } from "./version";

// ---------------------------------------------------------------------------
// 上下文
// ---------------------------------------------------------------------------

/** 标的（身份 + 当时生效代码）。 */
export interface RuntimeInstrument {
  /** canonical 证券身份。 */
  readonly securityId: string;
  /** 该交易日生效的代码。 */
  readonly code: string;
}

/** 持仓状态（Runtime 只读；不修改）。 */
export interface RuntimeState {
  readonly positionState: PositionState;
  /** 当前持仓数（供 Portfolio 侧解释，不影响决策本身）。 */
  readonly openPositions: number;
}

/** 运行时上下文（规格 §12）。 */
export interface RuntimeContext {
  /** 决策时点。 */
  readonly timestamp: EvaluationTime;
  readonly instrument: RuntimeInstrument;
  /** 可见数据（**全量 bar 由访问关卡收窄**）。 */
  readonly visibleData: BarUniverse;
  /** 🔴 本次评估的**当前相对日**（决定「哪些未来 bar 已变成现在」）。缺省 = bar 集里的最大相对日。 */
  readonly currentRelativeDay?: RelativeDay;
  /** 事件日字段（`event.limitUpPrice` 等；事件日不可见时应留空）。 */
  readonly eventFields?: Readonly<Record<string, CoreValue>>;
  /** 已算好的特征值（可注入；缺省由注册表现场计算）。 */
  readonly featureOverrides?: Readonly<Record<string, CoreValue>>;
  readonly state: RuntimeState;
  /** 本数据集的能力声明（运行方**如实**填写；缺省 = 只声明频率，其余未知）。 */
  readonly datasetCapability?: DatasetCapabilityDescriptor;
  /** 事件判定器（优先于全局注入；Core 不猜事件语义）。 */
  readonly resolveEvent?: EventOccurrenceResolver;
}

/** Runtime 选项。 */
export interface RuntimeOptions {
  /** 特征注册表（缺省 = 内置默认注册表）。 */
  readonly featureRegistry?: FeatureRegistry;
  /** 是否跳过数据兼容性校验（**仅供单测**构造紧凑夹具；生产必须为 false）。 */
  readonly skipDataCompatibilityCheck?: boolean;
}

/** 本次评估的完整内部产物（供高级消费者 / 测试取用，不改变 Decision 语义）。 */
export interface RuntimeEvaluationDetail {
  readonly decision: StrategyDecision;
  readonly compatibility: DataCompatibilityReport;
  readonly ruleEvaluation: RuleGraphEvaluation;
  readonly exitEvaluation: RuleGraphEvaluation | null;
  readonly violations: readonly VisibilityViolation[];
  readonly insufficiencies: readonly string[];
  readonly resolvedParameters: ResolvedParameterSet;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function isResolvedSet(value: ParameterSet | ResolvedParameterSet): value is ResolvedParameterSet {
  return (value as ResolvedParameterSet).resolved === true && typeof (value as ResolvedParameterSet).values === "object";
}

/**
 * PARAMETER-001-PRE（P0）— **定义指纹的进程内缓存**。
 *
 * ## 为什么必须有（实测，不是推断）
 *
 * `computeDefinitionFingerprint(definition)` = `sha256(canonicalJson(整个定义的行为面))` ——
 * 它是对**整份策略定义**做一次完整 canonical 序列化 + SHA-256。而 `evaluateWithDetail` 原先在
 * **每一次求值**里调用它**两次**（`explanation` 里一次、`decision.definitionFingerprint` 一次）。
 *
 * 真实 Run 实测（`docs/evidence/_probe_param001_pre_profile.before.cpuprofile.json`，657.8 s）：
 * `server/strategyCore/canonical.ts` 独占 **44.3% 的 CPU self time**（291.4 s / 657.9 s），
 * 按 1,707,054 次求值 × 2 次指纹 ≈ 341 万次「canonical 序列化 + sha256」。
 * ⇒ 这是全链路的**第一热点**，而且它是**纯重复计算**。
 *
 * ## 为什么这样做是「逐字节等价」而不是「优化近似」
 *
 * 1. `computeDefinitionFingerprint` 是**纯函数**：`definition` 之外不读任何东西
 *    （无 IO / 无 `Date.now` / 无随机 —— 见 `canonical.ts` 头注释）；
 * 2. Core 的 `StrategyCoreDefinition` 是**不可变**的（`deepFreezeCoreDefinition`；
 *    `StrategyVersion` 内容永不可变，改内容只能产出新版本）；
 * 3. 因此「同一个 definition 对象 ⇒ 同一个指纹字符串」是**函数性质**，不是假设。
 *    缓存只是省掉重复求值，返回值与原实现**逐字节相同**（同一函数的同一输出）。
 *
 * 用 `WeakMap` 而不是带 TTL 的 Map：键是对象身份，**不阻止 GC**、不会跨定义串味、
 * 也不需要失效逻辑（定义不可变 ⇒ 不存在「过期」）。一次进程内只会有个位数条目
 * （一次 Run 里主链 1 份定义 + 每个参数搜索样本 1 份）。
 */
const definitionFingerprintCache = new WeakMap<StrategyCoreDefinition, string>();

function computeDefinitionFingerprintCached(definition: StrategyCoreDefinition): string {
  const cached = definitionFingerprintCache.get(definition);
  if (cached !== undefined) return cached;
  const computed = computeDefinitionFingerprint(definition);
  definitionFingerprintCache.set(definition, computed);
  return computed;
}

/** 读取 bar 的某一列（不支持的列 ⇒ null，不抛错：列缺失属数据问题，由「不足」上报）。 */
export function readBarColumnValue(bar: VisibleBar, column: string): CoreValue {
  switch (column) {
    case "open":
      return bar.open;
    case "high":
      return bar.high;
    case "low":
      return bar.low;
    case "close":
      return bar.close;
    case "volume":
      return bar.volume;
    case "amount":
      return bar.amount;
    case "preClose":
      return bar.preClose ?? null;
    case "tradeDate":
      return bar.date;
    case "relativeDay":
      return bar.relativeDay;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 内部实现
// ---------------------------------------------------------------------------

function evaluateWithDetail(
  version: StrategyVersion,
  parameterSet: ParameterSet | ResolvedParameterSet,
  context: RuntimeContext,
  options: RuntimeOptions,
): RuntimeEvaluationDetail {
  const definition: StrategyCoreDefinition = version.definition;
  const registry = options.featureRegistry ?? getDefaultFeatureRegistry();

  // 关卡 ①：Definition 不得绑定 Dataset / 引擎坐标
  const leakHits = auditDefinitionLeakage(definition, { featureRegistry: registry });
  assertNoDefinitionLeakage(leakHits);

  // 参数：已解析则直接用；否则现场解析（两条路径都得到 ResolvedParameterSet）
  const resolved = isResolvedSet(parameterSet)
    ? parameterSet
    : resolveParameters(definition.parameterSchema, parameterSet);

  // 关卡 ③：数据兼容性
  const capability: DatasetCapabilityDescriptor =
    context.datasetCapability ?? { frequency: definition.dataRequirements.frequency, availableFields: [], availableDomains: [], eventTypes: [] };
  const compatibility = checkDataCompatibility(definition.dataRequirements, capability);
  if (options.skipDataCompatibilityCheck !== true) assertDataCompatible(compatibility);

  // 关卡 ②/④：访问关卡 + 共享收集器
  const violations: VisibilityViolation[] = [];
  const insufficiencies: string[] = [];
  const accesses: DayScopedBarAccess[] = [];
  const accessFor = (day: RelativeDay): DayScopedBarAccess => {
    const access = createDayScopedBarAccess(context.visibleData, day);
    accesses.push(access);
    return access;
  };
  const eventFields = context.eventFields ?? {};
  const featureOverrides = context.featureOverrides ?? {};
  const featureCache = new Map<string, CoreValue>();
  const requirementByFeatureId = new Map(definition.featureRequirements.map((item) => [item.featureId, item]));

  const readEventField = (field: string): CoreValue => {
    if (!Object.prototype.hasOwnProperty.call(eventFields, field)) {
      insufficiencies.push("事件字段 " + field + " 未提供（数据集未给出该列）");
      return null;
    }
    return eventFields[field] as CoreValue;
  };

  const featureValueAt = (day: RelativeDay, featureId: string): CoreValue => {
    const key = featureId + "@" + String(day);
    if (featureCache.has(key)) return featureCache.get(key) as CoreValue;
    if (Object.prototype.hasOwnProperty.call(featureOverrides, featureId)) {
      const injected = featureOverrides[featureId] as CoreValue;
      featureCache.set(key, injected);
      return injected;
    }
    const requirement = requirementByFeatureId.get(featureId);
    if (requirement === undefined) {
      throw new StrategyCoreError(
        "FEATURE_NOT_REGISTERED",
        "规则图引用了特征 " + featureId + "，但 version.definition.featureRequirements 未声明（先声明再使用）",
        { featureId },
      );
    }
    const featureDefinition = registry.resolve(requirement);
    LeakageGuard.assertFeatureUsable(featureDefinition.featureId, featureDefinition.leakage, context.timestamp);
    const access = accessFor(day);
    const bars = access.barsUpTo(day).slice(-featureDefinition.lookback);
    if (bars.length < featureDefinition.lookback) {
      insufficiencies.push(
        "特征 " + featureId + " 需要 " + String(featureDefinition.lookback) + " 根 bar，在 " + String(day) + " 日只有 " + String(bars.length) + " 根",
      );
      featureCache.set(key, null);
      return null;
    }
    const value = featureDefinition.compute({
      asOf: context.timestamp,
      bars,
      eventDayBar: access.eventDayBar(),
      eventField: readEventField,
      parameters: resolved.values,
    });
    featureCache.set(key, value);
    return value;
  };

  const fieldValueAt = (day: RelativeDay, field: string): CoreValue => {
    const parsed = parseCoreFieldReference(field);
    switch (parsed.kind) {
      case "PRE_EVENT":
      case "FORWARD_BAR": {
        LeakageGuard.assertFieldReadable(field, day, "fieldValue");
        const bar = accessFor(day).barAt(parsed.relativeDay ?? 0);
        if (bar === null) {
          insufficiencies.push("字段 " + field + " 对应的 bar 在 " + String(day) + " 日不可见 / 不存在");
          return null;
        }
        return readBarColumnValue(bar, parsed.field);
      }
      case "CURRENT_BAR": {
        const bar = accessFor(day).currentBar();
        if (bar === null) {
          insufficiencies.push("当前 bar 在 " + String(day) + " 日不存在");
          return null;
        }
        return readBarColumnValue(bar, parsed.field);
      }
      case "EVENT_DAY":
        return readEventField(parsed.field);
      case "DERIVED_BAR_FEATURE": {
        const featureId = parsed.featureId as string;
        return featureValueAt(day, featureId);
      }
      default:
        throw new StrategyCoreError(
          "LEAKAGE_LOOK_AHEAD",
          "字段 " + field + " 不可作为策略条件（kind=" + parsed.kind + "）：前视标签层 / 未知时间域一律拒绝",
          { raw: field },
        );
    }
  };

  const currentDay =
    context.currentRelativeDay ??
    (context.visibleData.bars.length === 0
      ? 0
      : Math.max(...context.visibleData.bars.map((bar) => bar.relativeDay)));
  const currentDayCap = currentDay;

  const buildEnv = (day: RelativeDay): RuleEvaluationEnv => {
    const scope: ExpressionScope = {
      fieldValue: (field: string) => fieldValueAt(day, field),
      featureValue: (featureId: string) => featureValueAt(day, featureId),
      parameterValue: (code: string) => {
        if (!Object.prototype.hasOwnProperty.call(resolved.values, code)) {
          throw new StrategyCoreError("PARAMETER_UNKNOWN", "表达式引用了未解析的参数 " + code, { code });
        }
        return resolved.values[code] as CoreValue;
      },
    };
    return {
      asOf: context.timestamp,
      currentDay: day,
      maxRelativeDay: context.visibleData.maxRelativeDay ?? currentDayCap,
      eventOccurred: (eventType: string, params: Readonly<Record<string, CoreValue>>) =>
        evaluateEventOccurrence(eventType, params, context),
      fieldValue: (field: string) => scope.fieldValue(field),
      featureValue: (featureId: string) => scope.featureValue(featureId),
      parameterValue: (code: string) => scope.parameterValue(code),
      violations,
      insufficiencies,
      withDay: (next: RelativeDay) => buildEnv(next),
    };
  };

  const rootEnv = buildEnv(currentDay);
  const ruleEvaluation = evaluateRuleGraph(definition.ruleGraph, rootEnv);

  // 出场图：只在**持仓中**求值（空仓时「出场」没有语义，避免凭空产出 exitIntent）
  let exitEvaluation: RuleGraphEvaluation | null = null;
  const holding = context.state.positionState === "LONG" || context.state.positionState === "PENDING_EXIT";
  if (definition.exitRuleGraph !== null && holding) {
    exitEvaluation = evaluateRuleGraph(definition.exitRuleGraph, rootEnv);
  }

  // 关卡 ④：产出前检查实际越界读取
  for (const access of accesses) {
    for (const violation of access.violations()) violations.push(violation);
  }
  LeakageGuard.assertNoViolations(violations);

  // -------------------------------------------------------------------------
  // 组装决策
  // -------------------------------------------------------------------------
  const parts = extractDecisionParts(ruleEvaluation.traces);
  const events: DecisionEvent[] = [];
  for (const trace of ruleEvaluation.traces) {
    if (trace.kind !== "EVENT" || trace.satisfied !== true) continue;
    events.push({
      nodeId: trace.nodeId,
      eventType: trace.eventType ?? "UNKNOWN",
      params: trace.eventParams ?? {},
      occurredAtDay: 0,
    });
  }

  const signals: DecisionSignal[] = [];
  for (const trace of ruleEvaluation.traces) {
    if (trace.kind !== "TRIGGER" || trace.satisfied !== true) continue;
    signals.push({
      nodeId: trace.nodeId,
      signalTime: context.timestamp,
      signalDay: currentDay,
      triggerType: trace.triggerType ?? "UNKNOWN",
      reason: trace.detail,
    });
  }

  const entryIntents: EntryIntent[] = [];
  if (signals.length > 0 && definition.capabilities.includes("entryIntent")) {
    const resultingState = nextPositionState(definition.executionSemantics, context.state.positionState, "OPEN");
    entryIntents.push({
      signalNodeId: signals[0]?.nodeId ?? "ruleGraph",
      intent: "OPEN",
      resultingState,
      reasoning:
        "信号在 " +
        context.timestamp.date +
        ":" +
        context.timestamp.point +
        " 产生（" +
        String(signals.length) +
        " 个触发节点），按执行语义 " +
        definition.executionSemantics.executionTiming +
        " 以 " +
        definition.executionSemantics.priceReference +
        " 价成交意图入场",
    });
  }

  const exitIntents: ExitIntent[] = [];
  if (exitEvaluation !== null && exitEvaluation.satisfied) {
    const resultingState = nextPositionState(definition.executionSemantics, context.state.positionState, "CLOSE");
    const satisfiedNodes = exitEvaluation.traces.filter((trace) => trace.satisfied === true).map((trace) => trace.nodeId);
    exitIntents.push({
      nodeId: satisfiedNodes[0] ?? "exitRuleGraph",
      intent: "CLOSE",
      resultingState,
      reasoning:
        "出场图在 " +
        context.timestamp.date +
        ":" +
        context.timestamp.point +
        " 成立（节点 " +
        satisfiedNodes.join("、") +
        "）⇒ 转入 " +
        resultingState,
    });
  }

  const positionIntents: PositionIntent[] = definition.capabilities.includes("positionIntent")
    ? [
        {
          sizingMethod: definition.positionSpec.sizingMethod,
          maxPositions: definition.positionSpec.maxPositions,
          positionRatio: definition.positionSpec.positionRatio ?? null,
          fixedAmount: definition.positionSpec.fixedAmount ?? null,
          parameter: definition.positionSpec.parameter ?? null,
        },
      ]
    : [];

  const conditions: DecisionCondition[] = parts.conditionResults.map((condition) => ({ ...condition }));

  /**
   * PARAMETER-001-PRE（P0）— 定义指纹**每次求值只取一次**（原实现取两次）。
   *
   * 同一份 `definition` 对象 ⇒ 同一字符串（纯函数 + 不可变对象），故这两处引用同一个值
   * 与分别调用 `computeDefinitionFingerprint(definition)` **逐字节相同**；
   * 差别只是把「每求值 2 次全量 canonical 序列化 + sha256」降为「每定义 1 次」。
   */
  const fingerprintOfDefinition = computeDefinitionFingerprintCached(definition);

  const explanation: string[] = [];
  explanation.push(
    "在 " +
      context.timestamp.date +
      ":" +
      context.timestamp.point +
      " 评估 " +
      version.strategyId +
      "@" +
      version.version +
      "（定义指纹 " +
      fingerprintOfDefinition.slice(0, 12) +
      "…）",
  );
  explanation.push("持仓状态 " + context.state.positionState + "（持仓数 " + String(context.state.openPositions) + "）");
  explanation.push("入场规则图成立 = " + String(ruleEvaluation.satisfied) + "；事件命中 " + String(events.length) + " 个；条件求值 " + String(conditions.length) + " 条");
  if (exitEvaluation !== null) {
    explanation.push("出场规则图成立 = " + String(exitEvaluation.satisfied));
  } else if (definition.exitRuleGraph === null) {
    explanation.push("未声明出场规则图 ⇒ 持有至期末");
  } else {
    explanation.push("当前未持仓 ⇒ 不求值出场规则图");
  }
  for (const note of insufficiencies.slice(0, 8)) explanation.push("数据不足：" + note);
  if (insufficiencies.length > 8) explanation.push("数据不足：另有 " + String(insufficiencies.length - 8) + " 条未列出");

  const decision = freezeDecision({
    decisionTime: context.timestamp,
    strategyId: version.strategyId,
    strategyVersion: version.version,
    definitionFingerprint: fingerprintOfDefinition,
    events: events.map((event) => ({ ...event, params: { ...event.params } })),
    conditions,
    signals,
    entryIntents,
    exitIntents,
    positionIntents,
    ruleTrace: ruleEvaluation.traces.map((trace) => ({ ...trace })),
    insufficientData: insufficiencies.length > 0,
    explanation,
  });

  return {
    decision,
    compatibility,
    ruleEvaluation,
    exitEvaluation,
    violations,
    insufficiencies,
    resolvedParameters: resolved,
  };
}

/** 事件发生的判据（**由上下文显式提供** —— Core 不猜事件语义，也不查库）。 */
export type EventOccurrenceResolver = (
  eventType: string,
  params: Readonly<Record<string, CoreValue>>,
  context: RuntimeContext,
) => boolean;

let eventOccurrenceResolver: EventOccurrenceResolver | null = null;

/**
 * 注入事件判定器（唯一注入点）。
 *
 * 为什么需要注入：事件（如 `FIRST_LIMIT_UP`）的判定依赖 Dataset 的具体形态，
 * 而 Core **不绑定 Dataset** ⇒ 由运行方注入判定函数。未注入时**响亮抛错**
 * （不静默返回 false —— 那会让「没接事件源」看起来像「今天没有事件」）。
 */
export function setEventOccurrenceResolver(resolver: EventOccurrenceResolver | null): void {
  eventOccurrenceResolver = resolver;
}

function evaluateEventOccurrence(
  eventType: string,
  params: Readonly<Record<string, CoreValue>>,
  context: RuntimeContext,
): boolean {
  const resolver = context.resolveEvent ?? eventOccurrenceResolver;
  if (resolver === null || resolver === undefined) {
    throw new StrategyCoreError(
      "CORE_DEFINITION_INVALID",
      "尚未注入事件判定器（context.resolveEvent 或 setEventOccurrenceResolver）：Core 不绑定 Dataset，事件语义必须由运行方提供。" +
        "拒绝静默返回 false —— 那会把「没接事件源」伪装成「当日无事件」。",
      { eventType },
    );
  }
  return resolver(eventType, params, context);
}

// ---------------------------------------------------------------------------
// 公共入口
// ---------------------------------------------------------------------------

/** 统一执行入口（规格 §12）。 */
export const StrategyRuntime = {
  /** 求值并返回决策（只消费自己需要的部分）。 */
  evaluate(
    version: StrategyVersion,
    parameterSet: ParameterSet | ResolvedParameterSet,
    context: RuntimeContext,
    options: RuntimeOptions = {},
  ): StrategyDecision {
    return evaluateWithDetail(version, parameterSet, context, options).decision;
  },

  /** 求值并返回**全部内部产物**（兼容性报告 / 规则轨迹 / 泄漏违规 / 数据不足清单）。 */
  evaluateWithDetail,

  /** 仅做数据兼容性检查（不执行规则）——供运行方在「选数据集」阶段预检。 */
  checkCompatibility(version: StrategyVersion, capability: DatasetCapabilityDescriptor): DataCompatibilityReport {
    return checkDataCompatibility(version.definition.dataRequirements, capability);
  },

  /** 仅做静态泄漏审计（不执行规则）。 */
  auditLeakage(version: StrategyVersion, options: RuntimeOptions = {}) {
    return auditDefinitionLeakage(version.definition, {
      featureRegistry: options.featureRegistry ?? getDefaultFeatureRegistry(),
    });
  },
};

/** 便捷：把 Definition 冻结（对外暴露，保持与 `createCoreDefinition` 一致的不可变保证）。 */
export { deepFreezeCoreDefinition };
