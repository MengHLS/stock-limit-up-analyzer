/**
 * STRATEGY-ARCH-001 — legacy ⇄ Core 适配（规格 §4 / §19 / §22）。
 *
 * 方向说明（**这决定了迁移策略**）：
 *
 *   legacy `StrategyDefinition`（已落库 11 个版本的编码）
 *        ──fromLegacyStrategyDefinition()──▶  Core `StrategyCoreDefinition`（语义权威）
 *        ◀──toLegacyStrategyDefinition()────  仅对**可表达子集**可逆
 *
 * ⇒ Core 是**语义**的唯一权威；legacy 定义降级为**存储编码 + 兼容视图**。
 *   两者不会各自演化出两套语义，因为 Core 的构造只有一条路：由 legacy 机械翻译（或手工构造），
 *   翻译表未登记的构造**一律抛错**（不猜）。
 *
 * 🔴 三条纪律（全部来自本仓库踩过的坑）：
 *   ① **映射表必须登记方向**：`GREATER_THAN → GT` 是**同向**映射（左值仍是左值）。
 *      本仓库曾在「条件 → 特征门槛」的改写里把 `bar.low >= prefix.rd0.open` 译成
 *      `haircut >= 0`（**方向恰好相反**）⇒ 本适配器**不做任何算术改写**，
 *      原样保留左值/右值，方向正确性由 Core 的比较器承担。
 *   ② **未登记即抛错**：映射表外的值抛 `LEGACY_MAPPING_UNSUPPORTED`，
 *      不禁用、不降级、不静默丢弃。
 *   ③ **Dataset 绑定不进 Definition**（规格 §10）：`legacy.datasets` 被**分离**返回，
 *      由调用方放进 RunSnapshot。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random。
 */

import { StrategyCoreError, type ComparisonOperator, type CoreValue, type StrategyCapability } from "../types";
import { Expr, parseExpression, type ValueExpression } from "../expression";
import { Rule, type RuleNode } from "../ruleGraph";
import {
  createCoreDefinition,
  EXIT_RULE_TYPES,
  EXIT_THRESHOLD_UNITS,
  EXIT_TRIGGERS,
  POSITION_SIZING_METHODS,
  type DeclaredExitRule,
  type ExitRuleType,
  type ExitThresholdUnit,
  type ExitTrigger,
  type PositionSizingMethod,
  type PositionSpec,
  type RiskSpec,
  type StrategyCoreDefinition,
  type StrategyCoreDefinitionInput,
} from "../definition";
import { deriveCapabilities } from "../capabilities";
import { deriveDataRequirementsFromRuleGraph } from "../dataRequirements";
import {
  DEFAULT_LONG_ONLY_TRANSITIONS,
  type ExecutionSemantics,
} from "../executionSemantics";
import { collectRuleFeatureReferences } from "../ruleGraph";
import { getDefaultFeatureRegistry, type FeatureRegistry, type FeatureRequirement } from "../featureRegistry";
import {
  resolveParameters,
  type ParameterDefinition as CoreParameterDefinition,
} from "../parameterResolver";
import type { ParameterRole } from "../types";
import { makeTemporalWindow, type TemporalWindow } from "../temporal";
import type {
  ConditionDefinition,
  ExitRuleDefinition,
  ParameterDefinition as LegacyParameterDefinition,
  StrategyDefinition as LegacyStrategyDefinition,
  StrategyDatasetBinding,
} from "../../research/strategySchema/definition";

// ---------------------------------------------------------------------------
// 映射表（未登记即抛错）
// ---------------------------------------------------------------------------

/** legacy 运算符 → Core 运算符（**同向**；不做取反、不做算术改写）。 */
export const LEGACY_OPERATOR_TO_CORE: Readonly<Record<string, ComparisonOperator>> = Object.freeze({
  GREATER_THAN: "GT",
  GREATER_THAN_OR_EQUAL: "GTE",
  LESS_THAN: "LT",
  LESS_THAN_OR_EQUAL: "LTE",
  EQUAL: "EQ",
  NOT_EQUAL: "NEQ",
  IN: "IN",
  NOT_IN: "NOT_IN",
});

/**
 * legacy 触发类型 → Core 窗口量化器。
 *
 * ⚠️ **如实登记**：legacy 的观察窗口语义恒为「逐日求值条件、由 trigger 决定哪天出信号」
 * ⇒ 一律译为 `ANY_DAY`。legacy **无法表达** `ALL_DAYS`（「整段窗口每天都守住」）——
 * 这正是审计里登记的 4.4「路径型策略不可表达」。需要 `ALL_DAYS` 时必须显式构造 Core 定义，
 * **不能**让适配器替它选。
 */
export const LEGACY_TRIGGER_TO_QUANTIFIER: Readonly<Record<string, "ANY_DAY">> = Object.freeze({
  FIRST_VALID_DAY: "ANY_DAY",
  LAST_VALID_DAY: "ANY_DAY",
  EVERY_VALID_DAY: "ANY_DAY",
  NEXT_TRADING_DAY: "ANY_DAY",
});

/** legacy 仓位方法 → Core 仓位方法（同名同义，仍显式登记）。 */
export const LEGACY_POSITION_SIZING_TO_CORE: Readonly<Record<string, PositionSizingMethod>> = Object.freeze({
  FIXED_AMOUNT: "FIXED_AMOUNT",
  FIXED_RATIO: "FIXED_RATIO",
  EQUAL_WEIGHT: "EQUAL_WEIGHT",
  RISK_BASED: "RISK_BASED",
});

/**
 * legacy 出场规则 → Core **可执行** 的映射（只有带 `condition` 的规则才进 `exitRuleGraph`）。
 *
 * ⚠️ 阈值型出场（TAKE_PROFIT / STOP_LOSS / TIME_EXIT 的数值阈值）需要「入场价 / 入场日」
 * 这类运行态引用，超出 Core 的字段目录（只覆盖数据集字段与特征）⇒ **保留为声明**
 * （`exitRules`），并如实登记为未映射项。
 */
export const LEGACY_EXIT_EXECUTABLE_TYPES: readonly ExitRuleType[] = Object.freeze(["SIGNAL_EXIT"]);

/** legacy STOP_LOSS（RATIO / PERCENT）→ Core `riskSpec.stopLoss` 的映射（唯一登记的降级）。 */
export const LEGACY_STOP_LOSS_TO_RISK_SPEC = true;

// ---------------------------------------------------------------------------
// 适配结果
// ---------------------------------------------------------------------------

/** 适配结果：Definition（语义）+ 分离出来的 Dataset 绑定 + 如实登记的映射说明。 */
export interface LegacyAdaptationResult {
  readonly definition: StrategyCoreDefinition;
  /** Dataset 绑定（**不进 Definition**；由调用方写入 RunSnapshot）。 */
  readonly datasetBinding: readonly StrategyDatasetBinding[];
  /** 映射说明（进了什么 / 没进什么 / 为什么）。 */
  readonly notes: readonly string[];
  /** 未能映射进 RuleGraph 的出场规则 id（如实登记，不静默丢弃）。 */
  readonly unmappedExitRuleIds: readonly string[];
}

export interface LegacyAdaptationOptions {
  readonly featureRegistry?: FeatureRegistry;
}

function unsupported(what: string, detail: string): never {
  throw new StrategyCoreError("LEGACY_MAPPING_UNSUPPORTED", what + "：" + detail + "（映射表未登记 ⇒ 拒绝翻译，不猜语义）");
}

// ---------------------------------------------------------------------------
// 条件
// ---------------------------------------------------------------------------

/**
 * 判断「`valueType=CONSTANT` 但值其实是**表达式文本**」。
 *
 * 🔴 为什么需要这条（STRATEGY-ARCH-002 实测阻塞项）：库里真实的策略文档里，
 * `definition.entry.conditions` 有一条
 * `{ field: "bar.volume", operator: "LESS_THAN_OR_EQUAL", valueType: "CONSTANT",
 *    value: "prefix.rd0.volume * 0.3" }` —— 值被标成 CONSTANT，实际是**算术表达式**。
 * 按字面翻译会得到「数字与字符串比较」，语义完全丢失。
 *
 * 判定规则**保守且显式**（不是「试着解析一下看行不行」）：
 *   - 数值 / 布尔字面量 ⇒ 常量（不变）；
 *   - 字符串里出现 `prefix.` / `post.` / `bar.` / `event.` 这类**字段根**，
 *     或出现算术运算符 `+ - * /`，或出现括号 ⇒ 交给 `parseExpression` 解析（Core 既有实现）；
 *   - 其余字符串 ⇒ 保持**字符串常量**（枚举名之类）。
 */
function looksLikeExpressionText(value: string): boolean {
  const text = value.trim();
  if (text === "") return false;
  if (/^(true|false|null)$/i.test(text)) return false;
  if (Number.isFinite(Number(text))) return false;
  return /(?:^|[^A-Za-z0-9_])(prefix|post|bar|event)\./.test(text) || /[+\-*/()]/.test(text);
}

function mapValueExpression(
  condition: ConditionDefinition,
  notes?: string[],
): ValueExpression {
  const value = condition.value;
  switch (condition.valueType) {
    case "CONSTANT": {
      if (Array.isArray(value)) {
        return Expr.array(value as readonly CoreValue[]);
      }
      if (typeof value === "string" && looksLikeExpressionText(value)) {
        // legacy 把算术表达式写进了 CONSTANT ⇒ 用 Core 既有解析器还原。
        // 不猜、不降级：解析失败即抛（原来的行为是「悄悄比字符串」，更糟）。
        const expression = parseExpression(value);
        notes?.push(
          "条件 " + (condition.id ?? condition.field) + "：valueType=CONSTANT 的值是表达式文本 " +
            JSON.stringify(value) + " ⇒ 已按 Core 表达式解析（不是字符串常量）",
        );
        return expression;
      }
      return Expr.constant((value ?? null) as CoreValue);
    }
    case "FIELD_REFERENCE": {
      if (typeof value !== "string") {
        unsupported("字段引用右值", "valueType=FIELD_REFERENCE 时 value 必须是字符串，实际 " + JSON.stringify(value));
      }
      return Expr.field(value);
    }
    case "PARAMETER_REFERENCE": {
      if (typeof value !== "string") {
        unsupported("参数引用右值", "valueType=PARAMETER_REFERENCE 时 value 必须是字符串，实际 " + JSON.stringify(value));
      }
      return Expr.param(value);
    }
    default:
      unsupported("条件右值类型", "未知 valueType " + String(condition.valueType));
  }
}

/** legacy 条件 → Core CONDITION 节点（**不做算术改写、不翻转方向**）。 */
export function conditionToRuleNode(
  condition: ConditionDefinition,
  id: string,
  notes?: string[],
): RuleNode {
  const operator = LEGACY_OPERATOR_TO_CORE[condition.operator];
  if (operator === undefined) {
    unsupported("条件运算符", "未知或未登记的运算符 " + String(condition.operator));
  }
  const right = mapValueExpression(condition, notes);
  if ((operator === "IN" || operator === "NOT_IN") && right.kind !== "ARRAY") {
    unsupported("IN / NOT_IN 的右值", "必须是常量数组（legacy 的 value 数组形态）");
  }
  return Rule.condition(
    Expr.field(condition.field),
    operator,
    right,
    id,
    condition.description ?? "legacy 条件 " + condition.field + " " + condition.operator,
  );
}

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function mapParameter(parameter: LegacyParameterDefinition): CoreParameterDefinition {
  const role = (parameter.parameterRole ?? "FIXED") as ParameterRole;
  const shared = {
    code: parameter.code,
    name: parameter.name,
    role,
    ...(parameter.defaultValue === undefined ? {} : { defaultValue: parameter.defaultValue as CoreValue }),
    ...(parameter.nullable === undefined ? {} : { nullable: parameter.nullable }),
    ...(parameter.unit === undefined ? {} : { unit: parameter.unit }),
    ...(parameter.description === undefined ? {} : { description: parameter.description }),
    required: parameter.required,
  };
  if (role === "DERIVED") {
    const text = parameter.derivedFrom;
    if (typeof text !== "string" || text.trim() === "") {
      unsupported("DERIVED 参数 " + parameter.code, "缺少 derivedFrom 表达式（legacy 允许自由文本，Core 要求可解析）");
    }
    let expression: ValueExpression;
    try {
      expression = parseExpression(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StrategyCoreError(
        "PARAMETER_DERIVED_UNPARSEABLE",
        "参数 " + parameter.code + " 的 derivedFrom 无法解析为 Core 表达式（原文 " + JSON.stringify(text) + "）：" + message,
        { code: parameter.code },
      );
    }
    return { ...shared, dataType: parameter.dataType, derivedFrom: expression } as CoreParameterDefinition;
  }
  if (parameter.dataType === "number") {
    return {
      ...shared,
      dataType: "number",
      ...(parameter.min === undefined ? {} : { min: parameter.min }),
      ...(parameter.max === undefined ? {} : { max: parameter.max }),
      ...(parameter.step === undefined ? {} : { step: parameter.step }),
    };
  }
  if (parameter.dataType === "string") {
    return {
      ...shared,
      dataType: "string",
      ...(parameter.allowedValues === undefined ? {} : { allowedValues: [...parameter.allowedValues] }),
    };
  }
  return { ...shared, dataType: "boolean" };
}

// ---------------------------------------------------------------------------
// 出场规则
// ---------------------------------------------------------------------------

function mapExitRule(rule: ExitRuleDefinition, index: number, notes?: string[]): DeclaredExitRule {
  const type = rule.type;
  if (!(EXIT_RULE_TYPES as readonly string[]).includes(type)) {
    unsupported("出场规则类型", "未知类型 " + String(type));
  }
  const trigger = rule.trigger as ExitTrigger;
  if (!(EXIT_TRIGGERS as readonly string[]).includes(trigger)) {
    unsupported("出场触发", "未知触发 " + String(trigger));
  }
  const unit = (rule.thresholdUnit ?? null) as ExitThresholdUnit | null;
  if (unit !== null && !(EXIT_THRESHOLD_UNITS as readonly string[]).includes(unit)) {
    unsupported("出场阈值单位", "未知单位 " + String(unit));
  }
  const resolvedId = typeof rule.id === "string" && rule.id.trim() !== "" ? rule.id.trim() : "exit-" + String(index + 1);
  return {
    id: resolvedId,
    type: type as ExitRuleType,
    trigger,
    threshold: rule.threshold ?? null,
    thresholdUnit: unit,
    parameter: rule.parameter ?? null,
    condition: rule.condition === undefined ? null : conditionToRuleNode(rule.condition, resolvedId + ".condition", notes),
    priority: rule.priority,
    enabled: rule.enabled,
    ...(rule.description === undefined ? {} : { description: rule.description }),
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** legacy 定义 → Core 定义（唯一翻译入口）。 */
export function fromLegacyStrategyDefinition(
  legacy: LegacyStrategyDefinition,
  options: LegacyAdaptationOptions = {},
): LegacyAdaptationResult {
  const registry = options.featureRegistry ?? getDefaultFeatureRegistry();
  const notes: string[] = [];
  const unmappedExitRuleIds: string[] = [];

  // ---- 入场规则图：SEQUENCE[ EVENT, WINDOW(ANY_DAY, ALL[conditions]), TRIGGER ] ----
  const entry = legacy.entry;
  const window: TemporalWindow = makeTemporalWindow(entry.observationWindow.start, entry.observationWindow.end, entry.observationWindow.unit);
  const enabledConditions = entry.conditions.filter((condition) => condition.enabled);
  const disabledCount = entry.conditions.length - enabledConditions.length;
  if (disabledCount > 0) {
    notes.push("legacy 有 " + String(disabledCount) + " 条 disabled 条件未进规则图（如实跳过，不静默当成成立）");
  }
  const conditionNodes = enabledConditions.map((condition, index) =>
    conditionToRuleNode(condition, condition.id ?? "cond-" + String(index + 1), notes),
  );

  const quantifier = LEGACY_TRIGGER_TO_QUANTIFIER[entry.trigger.type];
  if (quantifier === undefined) {
    unsupported("观察窗口量化器", "legacy trigger " + String(entry.trigger.type) + " 未登记");
  }
  notes.push(
    "观察窗口量化器按 legacy 语义登记为 " +
      quantifier +
      "（legacy 无法表达 ALL_DAYS「整段窗口每日都守住」；需要该语义请显式构造 Core 定义）",
  );

  const steps: RuleNode[] = [
    Rule.event(entry.event.type, "entry.event", entry.event.params as Readonly<Record<string, CoreValue>> | undefined),
  ];
  if (conditionNodes.length > 0) {
    steps.push(Rule.window(window, quantifier, Rule.all(conditionNodes, "entry.conditions"), "entry.window"));
  } else {
    notes.push("legacy 入场没有 enabled 条件 ⇒ 规则图不含 WINDOW 节点（窗口不参与判定）");
  }
  steps.push(Rule.trigger(entry.trigger.type, "entry.trigger"));
  const ruleGraph = steps.length === 1 ? (steps[0] as RuleNode) : Rule.sequence(steps, "entry");

  // ---- 参数 ----
  const parameterSchema = legacy.parameters.map(mapParameter);

  // ---- 出场 ----
  const exitRules = legacy.exit.rules.map((rule, index) => mapExitRule(rule, index, notes));
  const executableConditions: RuleNode[] = [];
  for (const rule of exitRules) {
    if (!rule.enabled || rule.condition === null) continue;
    if (!LEGACY_EXIT_EXECUTABLE_TYPES.includes(rule.type)) {
      unmappedExitRuleIds.push(rule.id);
      continue;
    }
    executableConditions.push(rule.condition);
  }
  for (const rule of exitRules) {
    if (!rule.enabled || rule.condition !== null) continue;
    if (!unmappedExitRuleIds.includes(rule.id)) unmappedExitRuleIds.push(rule.id);
  }
  const exitRuleGraph = executableConditions.length === 0 ? null : Rule.any(executableConditions, "exit");
  if (unmappedExitRuleIds.length > 0) {
    notes.push(
      "有 " +
        String(unmappedExitRuleIds.length) +
        " 条出场规则（" +
        unmappedExitRuleIds.join("、") +
        "）为阈值型 / 无附加条件 ⇒ 保留为**声明**（exitRules），未进 RuleGraph：" +
        "阈值型出场需要「入场价 / 入场日」这类运行态引用，超出 Core 的字段目录（规格 §12 边界）",
    );
  }

  // ---- 风险规格（登记的唯一降级：STOP_LOSS RATIO/PERCENT → riskSpec.stopLoss）----
  let stopLossFromExitRule: number | null = null;
  if (LEGACY_STOP_LOSS_TO_RISK_SPEC && legacy.risk.stopLoss === undefined) {
    const stopLossRule = exitRules.find(
      (rule) => rule.type === "STOP_LOSS" && rule.threshold !== null && (rule.thresholdUnit === "RATIO" || rule.thresholdUnit === "PERCENT"),
    );
    if (stopLossRule !== undefined && stopLossRule.threshold !== null) {
      stopLossFromExitRule = stopLossRule.thresholdUnit === "PERCENT" ? stopLossRule.threshold / 100 : stopLossRule.threshold;
      notes.push("出场规则 " + stopLossRule.id + "（STOP_LOSS）已登记映射为 riskSpec.stopLoss=" + String(stopLossFromExitRule));
    }
  }
  const riskSpec: RiskSpec = {
    ...(legacy.risk.stopLoss === undefined
      ? stopLossFromExitRule === null
        ? {}
        : { stopLoss: stopLossFromExitRule }
      : { stopLoss: legacy.risk.stopLoss }),
    ...(legacy.risk.maxDrawdown === undefined ? {} : { maxDrawdown: legacy.risk.maxDrawdown }),
    ...(legacy.risk.maxExposure === undefined ? {} : { maxExposure: legacy.risk.maxExposure }),
    ...(legacy.risk.maxSinglePosition === undefined ? {} : { maxSinglePosition: legacy.risk.maxSinglePosition }),
    ...(legacy.risk.maxPositions === undefined ? {} : { maxPositions: legacy.risk.maxPositions }),
    ...(legacy.risk.dailyLossLimit === undefined ? {} : { dailyLossLimit: legacy.risk.dailyLossLimit }),
    ...(legacy.risk.concentrationLimit === undefined ? {} : { concentrationLimit: legacy.risk.concentrationLimit }),
    ...(legacy.risk.extensions === undefined ? {} : { extensions: legacy.risk.extensions as Readonly<Record<string, CoreValue>> }),
  };

  // ---- 仓位 ----
  const sizingMethod = LEGACY_POSITION_SIZING_TO_CORE[legacy.position.sizingMethod];
  if (sizingMethod === undefined) {
    unsupported("仓位方法", "未登记 " + String(legacy.position.sizingMethod));
  }
  const positionSpec: PositionSpec = {
    sizingMethod: sizingMethod as PositionSizingMethod,
    maxPositions: legacy.position.maxPositions,
    ...(legacy.position.positionRatio === undefined ? {} : { positionRatio: legacy.position.positionRatio }),
    ...(legacy.position.fixedAmount === undefined ? {} : { fixedAmount: legacy.position.fixedAmount }),
    ...(legacy.position.maxExposure === undefined ? {} : { maxExposure: legacy.position.maxExposure }),
    ...(legacy.position.maxSinglePosition === undefined ? {} : { maxSinglePosition: legacy.position.maxSinglePosition }),
    ...(legacy.position.parameter === undefined ? {} : { parameter: legacy.position.parameter }),
  };
  if (positionSpec.sizingMethod !== "FIXED_AMOUNT" && positionSpec.positionRatio === undefined && positionSpec.parameter === undefined) {
    notes.push("legacy 仓位方法 " + positionSpec.sizingMethod + " 未给 positionRatio / parameter ⇒ Core 保留声明，不做默认填充");
  }

  // ---- 执行语义 ----
  const executionSemantics: ExecutionSemantics = {
    signalTiming: legacy.execution.signalTiming,
    // E1：确认时点必须与信号时点同类（Core 的硬规则，这里显式推导而不是留给校验器报错）
    confirmationTiming: legacy.execution.signalTiming === "T_OPEN" ? "ON_BAR_OPEN" : "ON_BAR_CLOSE",
    executionTiming: legacy.execution.executionTiming,
    priceReference: legacy.execution.priceType,
    stateTransition: DEFAULT_LONG_ONLY_TRANSITIONS,
  };

  // ---- 特征需求 / 数据需求 ----
  const featureIds = new Set<string>([...collectRuleFeatureReferences(ruleGraph)]);
  if (exitRuleGraph !== null) {
    for (const featureId of collectRuleFeatureReferences(exitRuleGraph)) featureIds.add(featureId);
  }
  const requirements: FeatureRequirement[] = [];
  for (const featureId of [...featureIds].sort()) {
    const found = registry.get(featureId);
    if (found === null) {
      throw new StrategyCoreError(
        "FEATURE_NOT_REGISTERED",
        "legacy 定义引用了特征 " + featureId + "，但注册表里没有：请先在 FeatureRegistry 注册（Core 不再接受未登记特征）",
        { featureId },
      );
    }
    requirements.push({ featureId: found.featureId, version: found.version });
  }

  const dataRequirements = deriveDataRequirementsFromRuleGraph(ruleGraph, {
    frequency: "1D",
    featureRegistry: registry,
    eventRequirements: [{ eventType: entry.event.type, required: true }],
  });

  // ---- 能力（由结构推导；声明面直接用推导值 ⇒ 构造必然一致）----
  const capabilities: readonly StrategyCapability[] = deriveCapabilities({
    ruleGraph,
    exitRuleGraph,
    positionSpec: { sizingMethod: positionSpec.sizingMethod, maxPositions: positionSpec.maxPositions },
  });

  const input: StrategyCoreDefinitionInput = {
    ruleGraph,
    exitRuleGraph,
    exitRules,
    positionSpec,
    riskSpec,
    featureRequirements: requirements,
    parameterSchema,
    dataRequirements,
    executionSemantics,
    capabilities,
  };
  const definition = createCoreDefinition(input, { featureRegistry: registry });

  notes.push("legacy datasets（" + String(legacy.datasets.length) + " 条）**未**进 Definition（规格 §10）；已单独返回供 RunSnapshot 使用");

  return {
    definition,
    datasetBinding: legacy.datasets,
    notes,
    unmappedExitRuleIds,
  };
}

// ---------------------------------------------------------------------------
// 逆映射（仅可表达子集；其余抛错）
// ---------------------------------------------------------------------------

/** Core 定义 → legacy 定义（**仅当构造落在可表达子集内**）。 */
export function toLegacyStrategyDefinition(
  definition: StrategyCoreDefinition,
  datasetBinding: readonly StrategyDatasetBinding[],
): LegacyStrategyDefinition {
  const entry = extractLegacyEntry(definition.ruleGraph);
  const exitRules: ExitRuleDefinition[] = definition.exitRules.map((rule, index) => ({
    id: rule.id,
    type: rule.type,
    trigger: rule.trigger,
    ...(rule.threshold === null ? {} : { threshold: rule.threshold }),
    ...(rule.thresholdUnit === null ? {} : { thresholdUnit: rule.thresholdUnit }),
    ...(rule.parameter === null ? {} : { parameter: rule.parameter }),
    priority: rule.priority,
    enabled: rule.enabled,
    ...(rule.description === undefined ? {} : { description: rule.description }),
    ...(index >= 0 ? {} : {}),
  }));
  return {
    schemaVersion: "1.0",
    entry,
    exit: { rules: exitRules },
    position: {
      sizingMethod: definition.positionSpec.sizingMethod,
      maxPositions: definition.positionSpec.maxPositions,
      ...(definition.positionSpec.positionRatio === undefined ? {} : { positionRatio: definition.positionSpec.positionRatio }),
      ...(definition.positionSpec.fixedAmount === undefined ? {} : { fixedAmount: definition.positionSpec.fixedAmount }),
      ...(definition.positionSpec.maxExposure === undefined ? {} : { maxExposure: definition.positionSpec.maxExposure }),
      ...(definition.positionSpec.maxSinglePosition === undefined ? {} : { maxSinglePosition: definition.positionSpec.maxSinglePosition }),
      ...(definition.positionSpec.parameter === undefined ? {} : { parameter: definition.positionSpec.parameter }),
    },
    risk: {
      ...(definition.riskSpec.stopLoss === undefined ? {} : { stopLoss: definition.riskSpec.stopLoss }),
      ...(definition.riskSpec.maxDrawdown === undefined ? {} : { maxDrawdown: definition.riskSpec.maxDrawdown }),
      ...(definition.riskSpec.maxExposure === undefined ? {} : { maxExposure: definition.riskSpec.maxExposure }),
      ...(definition.riskSpec.maxSinglePosition === undefined ? {} : { maxSinglePosition: definition.riskSpec.maxSinglePosition }),
      ...(definition.riskSpec.maxPositions === undefined ? {} : { maxPositions: definition.riskSpec.maxPositions }),
      ...(definition.riskSpec.dailyLossLimit === undefined ? {} : { dailyLossLimit: definition.riskSpec.dailyLossLimit }),
      ...(definition.riskSpec.concentrationLimit === undefined ? {} : { concentrationLimit: definition.riskSpec.concentrationLimit }),
      ...(definition.riskSpec.extensions === undefined
        ? {}
        : { extensions: definition.riskSpec.extensions as Readonly<Record<string, number | string | boolean>> }),
    },
    execution: {
      signalTiming: definition.executionSemantics.signalTiming,
      executionTiming: definition.executionSemantics.executionTiming,
      priceType: definition.executionSemantics.priceReference,
      quantityMethod: "FIXED_SHARES",
      lotSize: 100,
    },
    parameters: definition.parameterSchema.map((parameter) => ({
      code: parameter.code,
      name: parameter.name,
      dataType: parameter.dataType,
      parameterRole: parameter.role,
      ...(parameter.defaultValue === undefined ? {} : { defaultValue: parameter.defaultValue }),
      ...(parameter.nullable === undefined ? {} : { nullable: parameter.nullable }),
      ...("min" in parameter && parameter.min !== undefined ? { min: parameter.min } : {}),
      ...("max" in parameter && parameter.max !== undefined ? { max: parameter.max } : {}),
      ...("step" in parameter && parameter.step !== undefined ? { step: parameter.step } : {}),
      ...("allowedValues" in parameter && parameter.allowedValues !== undefined
        ? { allowedValues: [...parameter.allowedValues] }
        : {}),
      ...(parameter.unit === undefined ? {} : { unit: parameter.unit }),
      ...(parameter.description === undefined ? {} : { description: parameter.description }),
      required: parameter.required,
      ...(parameter.role === "DERIVED" && parameter.derivedFrom !== undefined
        ? { derivedFrom: renderExpression(parameter.derivedFrom) }
        : {}),
    })),
    datasets: [...datasetBinding],
  };
}

/** 表达式 → 文本（逆映射用；只支持可逆的四种形态）。 */
export function renderExpression(expression: ValueExpression): string {
  switch (expression.kind) {
    case "CONSTANT":
      return JSON.stringify(expression.value);
    case "PARAMETER_REFERENCE":
      return expression.code;
    case "BINARY":
      return "(" + renderExpression(expression.left) + " " + expression.operator + " " + renderExpression(expression.right) + ")";
    case "NEGATE":
      return "(-" + renderExpression(expression.operand) + ")";
    default:
      unsupported("表达式逆映射", "Core 表达式形态 " + expression.kind + " 在 legacy derivedFrom 文本里无法表达");
  }
}

/** 从 Core 入场图提取 legacy `EntryDefinition`（仅接受适配器产出的形状）。 */
function extractLegacyEntry(root: RuleNode): LegacyStrategyDefinition["entry"] {
  const steps: RuleNode[] = root.kind === "SEQUENCE" ? [...root.steps] : [root];
  const eventNode = steps.find((step) => step.kind === "EVENT");
  if (eventNode === undefined || eventNode.kind !== "EVENT") {
    unsupported("逆映射入场图", "找不到 EVENT 节点（Core 允许无事件的纯条件策略，legacy 不支持）");
  }
  const windowNode = steps.find((step) => step.kind === "WINDOW");
  const triggerNode = steps.find((step) => step.kind === "TRIGGER");
  if (triggerNode === undefined || triggerNode.kind !== "TRIGGER") {
    unsupported("逆映射入场图", "找不到 TRIGGER 节点（legacy 的 entry 必须声明 trigger）");
  }
  const conditions: ConditionDefinition[] = [];
  if (windowNode !== undefined && windowNode.kind === "WINDOW") {
    if (windowNode.quantifier !== "ANY_DAY") {
      unsupported("逆映射观察窗口", "量化器 " + windowNode.quantifier + " 在 legacy 里无法表达（legacy 恒为逐日 + trigger 选日）");
    }
    const inner = windowNode.child;
    const conditionNodes = inner.kind === "ALL" ? inner.children : [inner];
    for (let index = 0; index < conditionNodes.length; index += 1) {
      conditions.push(renderCondition(conditionNodes[index] as RuleNode, index));
    }
  }
  const window: TemporalWindow =
    windowNode !== undefined && windowNode.kind === "WINDOW"
      ? windowNode.window
      : { start: 1, end: 1, unit: "TRADING_DAY" };
  return {
    event: {
      type: eventNode.eventType as LegacyStrategyDefinition["entry"]["event"]["type"],
      ...(eventNode.params === undefined ? {} : { params: eventNode.params as Readonly<Record<string, string | number | boolean>> }),
    },
    observationWindow: { start: window.start, end: window.end, unit: window.unit },
    conditions,
    trigger: { type: triggerNode.triggerType as LegacyStrategyDefinition["entry"]["trigger"]["type"] },
  };
}

/** CONDITION 节点 → legacy `ConditionDefinition`（**只接受同向映射表内的形态**）。 */
export function renderCondition(node: RuleNode, index: number): ConditionDefinition {
  if (node.kind !== "CONDITION") {
    unsupported("逆映射条件", "节点 " + node.kind + " 在 legacy conditions 里无法表达（legacy 只有扁平字段比较）");
  }
  const operatorEntry = (Object.entries(LEGACY_OPERATOR_TO_CORE) as readonly (readonly [string, ComparisonOperator])[]).find(
    ([, core]) => core === node.operator,
  );
  if (operatorEntry === undefined) {
    unsupported("逆映射运算符", "Core 运算符 " + node.operator + " 在映射表里没有 legacy 对应项");
  }
  if (node.left.kind !== "FIELD_REFERENCE") {
    unsupported("逆映射左值", "legacy 条件左值必须是字段引用（Core 左值为 " + node.left.kind + "）");
  }
  let valueType: ConditionDefinition["valueType"];
  let value: ConditionDefinition["value"];
  switch (node.right.kind) {
    case "CONSTANT":
      valueType = "CONSTANT";
      value = node.right.value;
      break;
    case "ARRAY":
      valueType = "CONSTANT";
      value = [...node.right.items];
      break;
    case "FIELD_REFERENCE":
      valueType = "FIELD_REFERENCE";
      value = node.right.field;
      break;
    case "PARAMETER_REFERENCE":
      valueType = "PARAMETER_REFERENCE";
      value = node.right.code;
      break;
    default:
      unsupported("逆映射右值", "Core 右值形态 " + node.right.kind + " 在 legacy 里无法表达（legacy 无算术形态）");
  }
  return {
    id: node.id ?? "cond-" + String(index + 1),
    field: node.left.field,
    operator: operatorEntry[0] as ConditionDefinition["operator"],
    value,
    valueType,
    ...(node.description === undefined ? {} : { description: node.description }),
    enabled: true,
  };
}

/** 便捷：由 legacy 定义直接得到「可直接解析参数」的已解析参数集。 */
export function resolveLegacyParameters(
  definition: StrategyCoreDefinition,
  overrides: Readonly<Record<string, CoreValue>> = {},
) {
  return resolveParameters(definition.parameterSchema, overrides);
}
