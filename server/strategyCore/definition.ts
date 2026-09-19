/**
 * STRATEGY-ARCH-001 — StrategyCoreDefinition（规格 §3 的 Definition 段）。
 *
 * ```
 * StrategyCoreDefinition
 * ├── ruleGraph             入场规则图（RuleGraph）
 * ├── exitRuleGraph         出场规则图（null = 持有到期末）
 * ├── positionSpec          仓位规格（positionIntent 的来源）
 * ├── riskSpec              风险规格（声明，不是风险评价结果）
 * ├── featureRequirements   特征需求（只声明 id + version）
 * ├── parameterSchema       参数 schema（FIXED / TUNABLE / DERIVED）
 * ├── dataRequirements      数据需求（frequency / fields / lookback / horizon / events）
 * ├── executionSemantics    执行语义
 * └── capabilities          能力（**由结构推导并与声明比对**）
 * ```
 *
 * 与规格 §3 示意图的 3 处**显式偏离**（均为满足规格 §13 `StrategyDecision` 的必要条件，
 * 已在此登记、不藏）：
 *   ① 多一张 `exitRuleGraph`：入场与出场的**求值时点不同**（入场在事件窗口内、
 *      出场在持仓日），用一张图表达会迫使把两套语义混在一起；
 *   ② `positionSpec`：`positionIntents` 需要「怎么定仓位」的声明，规格 §3 的树里没有这一格；
 *   ③ `riskSpec`：风险规则同样需要落点。
 *   三者的**节点/词表/求值器**与 `ruleGraph` 完全共用，不引入第二套引擎。
 *
 * 纯模块：无 IO / 无 Date.now / 无 Math.random；返回对象被深度冻结。
 */

import {
  STRATEGY_CORE_SCHEMA_VERSION,
  STRATEGY_CORE_SCHEMA_VERSIONS,
  StrategyCoreError,
  validationIssue,
  type CoreValidationIssue,
  type StrategyCapability,
  type CoreValue,
} from "./types";
import { assertCapabilitiesConsistent, deriveCapabilities } from "./capabilities";
import {
  assertNoDatasetBindingInDefinition,
  findDatasetBindingLeaks,
  validateDataRequirements,
  type DataRequirements,
} from "./dataRequirements";
import { assertValidExecutionSemantics, validateExecutionSemantics, type ExecutionSemantics } from "./executionSemantics";
import type { FeatureRegistry, FeatureRequirement } from "./featureRegistry";
import {
  collectRuleFieldReferences,
  collectRuleFeatureReferences,
  collectRuleParameterReferences,
  collectRuleWindows,
  validateRuleGraph,
  type RuleNode,
} from "./ruleGraph";
import { isKnownCoreFieldReference } from "./fieldReference";
import {
  validateParameterSchema,
  type ParameterDefinition,
} from "./parameterResolver";

// ---------------------------------------------------------------------------
// 仓位 / 风险规格
// ---------------------------------------------------------------------------

/** 仓位规模方法（与既有策略域口径一致，保证 Adapter 可忠实地一对一映射）。 */
export const POSITION_SIZING_METHODS = [
  "FIXED_AMOUNT",
  "FIXED_RATIO",
  "EQUAL_WEIGHT",
  "RISK_BASED",
] as const;
export type PositionSizingMethod = (typeof POSITION_SIZING_METHODS)[number];

/** 仓位规格。 */
export interface PositionSpec {
  readonly sizingMethod: PositionSizingMethod;
  readonly positionRatio?: number;
  readonly fixedAmount?: number;
  readonly maxPositions: number;
  readonly maxExposure?: number;
  readonly maxSinglePosition?: number;
  /** 比例由参数表达时的参数 code（须存在于 `parameterSchema`）。 */
  readonly parameter?: string;
}

/** 风险规格（**规则**，不是风险评价结果）。 */
export interface RiskSpec {
  readonly stopLoss?: number;
  readonly maxDrawdown?: number;
  readonly maxExposure?: number;
  readonly maxSinglePosition?: number;
  readonly maxPositions?: number;
  readonly dailyLossLimit?: number;
  readonly concentrationLimit?: number;
  /** 扩展槽（未知风险维度进这里，**不要**因为新增维度而改 schemaVersion）。 */
  readonly extensions?: Readonly<Record<string, CoreValue>>;
}

/** 默认仓位规格（EQUAL_WEIGHT / 单仓）；仅作为**构造输入缺省**，不再被 Runtime 二次默认。 */
export const DEFAULT_POSITION_SPEC: PositionSpec = {
  sizingMethod: "EQUAL_WEIGHT",
  maxPositions: 1,
};

/** 默认（空）风险规格。 */
export const DEFAULT_RISK_SPEC: RiskSpec = {};

// ---------------------------------------------------------------------------
// 出场规则（声明）
// ---------------------------------------------------------------------------

/** 出场规则类型。 */
export const EXIT_RULE_TYPES = [
  "TAKE_PROFIT",
  "STOP_LOSS",
  "TIME_EXIT",
  "SIGNAL_EXIT",
  "FORCED_EXIT",
] as const;
export type ExitRuleType = (typeof EXIT_RULE_TYPES)[number];

/** 出场规则触发时点。 */
export const EXIT_TRIGGERS = ["ON_ENTRY", "ON_OPEN", "ON_CLOSE", "INTRADAY"] as const;
export type ExitTrigger = (typeof EXIT_TRIGGERS)[number];

/** 出场阈值单位。 */
export const EXIT_THRESHOLD_UNITS = ["RATIO", "PERCENT", "TRADING_DAY", "PRICE"] as const;
export type ExitThresholdUnit = (typeof EXIT_THRESHOLD_UNITS)[number];

/**
 * 出场规则（**声明**）。
 *
 * 🔴 为什么它是「声明」而不是「规则图节点」：阈值型出场（止盈 / 止损 / 持有 N 日）
 *   需要「入场价 / 入场日」这类**运行态**引用，而 Runtime 的字段目录只覆盖数据集字段与特征
 *   （不引入 `state.*` 根，避免与「策略不碰持仓」的边界打架，规格 §12）。
 *   ⇒ 这些规则**如实保留为声明**，由执行引擎消费；能在规则图里表达的（带 `condition` 的
 *   `SIGNAL_EXIT`）才进 `exitRuleGraph`。二者由 `exitRuleGraph` 是否为空如实区分，
 *   不靠「假装已经能执行」蒙混。
 */
export interface DeclaredExitRule {
  readonly id: string;
  readonly type: ExitRuleType;
  readonly trigger: ExitTrigger;
  readonly threshold: number | null;
  readonly thresholdUnit: ExitThresholdUnit | null;
  readonly parameter: string | null;
  /** 可选的附加条件（能在规则图里表达的那一类）。 */
  readonly condition: RuleNode | null;
  readonly priority: number;
  readonly enabled: boolean;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export interface StrategyCoreDefinition {
  readonly schemaVersion: string;
  readonly ruleGraph: RuleNode;
  readonly exitRuleGraph: RuleNode | null;
  /** 声明式出场规则（阈值型 / 信号型；见 `DeclaredExitRule` 的说明）。 */
  readonly exitRules: readonly DeclaredExitRule[];
  readonly positionSpec: PositionSpec;
  readonly riskSpec: RiskSpec;
  readonly featureRequirements: readonly FeatureRequirement[];
  readonly parameterSchema: readonly ParameterDefinition[];
  readonly dataRequirements: DataRequirements;
  readonly executionSemantics: ExecutionSemantics;
  readonly capabilities: readonly StrategyCapability[];
}

export type StrategyCoreDefinitionInput = Omit<StrategyCoreDefinition, "schemaVersion"> & {
  readonly schemaVersion?: string;
};

// ---------------------------------------------------------------------------
// 规范化（确定性顺序；与指纹稳定性直接相关）
// ---------------------------------------------------------------------------

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePositionSpec(spec: PositionSpec): PositionSpec {
  return {
    sizingMethod: spec.sizingMethod,
    maxPositions: spec.maxPositions,
    ...(spec.positionRatio === undefined ? {} : { positionRatio: spec.positionRatio }),
    ...(spec.fixedAmount === undefined ? {} : { fixedAmount: spec.fixedAmount }),
    ...(spec.maxExposure === undefined ? {} : { maxExposure: spec.maxExposure }),
    ...(spec.maxSinglePosition === undefined ? {} : { maxSinglePosition: spec.maxSinglePosition }),
    ...(spec.parameter === undefined ? {} : { parameter: spec.parameter }),
  };
}

function normalizeRiskSpec(spec: RiskSpec): RiskSpec {
  return {
    ...(spec.stopLoss === undefined ? {} : { stopLoss: spec.stopLoss }),
    ...(spec.maxDrawdown === undefined ? {} : { maxDrawdown: spec.maxDrawdown }),
    ...(spec.maxExposure === undefined ? {} : { maxExposure: spec.maxExposure }),
    ...(spec.maxSinglePosition === undefined ? {} : { maxSinglePosition: spec.maxSinglePosition }),
    ...(spec.maxPositions === undefined ? {} : { maxPositions: spec.maxPositions }),
    ...(spec.dailyLossLimit === undefined ? {} : { dailyLossLimit: spec.dailyLossLimit }),
    ...(spec.concentrationLimit === undefined ? {} : { concentrationLimit: spec.concentrationLimit }),
    ...(spec.extensions === undefined
      ? {}
      : {
          extensions: Object.fromEntries(
            Object.keys(spec.extensions)
              .sort()
              .map((key) => [key, (spec.extensions as Record<string, CoreValue>)[key] as CoreValue]),
          ),
        }),
  };
}

/** 规范化（数组按稳定键排序；对象键按固定顺序重建）。 */
export function normalizeCoreDefinition(input: StrategyCoreDefinitionInput): StrategyCoreDefinition {
  const parameterSchema = [...input.parameterSchema].sort((left, right) => compareText(left.code, right.code));
  const featureRequirements = [...input.featureRequirements].sort((left, right) =>
    compareText(left.featureId + "@" + left.version, right.featureId + "@" + right.version),
  );
  const requiredFeatures = [...input.dataRequirements.requiredFeatures].sort((left, right) =>
    compareText(left.featureId + "@" + left.version, right.featureId + "@" + right.version),
  );
  return {
    schemaVersion: input.schemaVersion ?? STRATEGY_CORE_SCHEMA_VERSION,
    ruleGraph: input.ruleGraph,
    exitRuleGraph: input.exitRuleGraph,
    exitRules: [...input.exitRules].sort((left, right) =>
      compareText(
        String(left.priority).padStart(6, "0") + "/" + left.id,
        String(right.priority).padStart(6, "0") + "/" + right.id,
      ),
    ),
    positionSpec: normalizePositionSpec(input.positionSpec),
    riskSpec: normalizeRiskSpec(input.riskSpec),
    featureRequirements,
    parameterSchema,
    dataRequirements: {
      ...input.dataRequirements,
      requiredFields: [...input.dataRequirements.requiredFields].sort(),
      requiredDomains: [...input.dataRequirements.requiredDomains].sort(),
      requiredFeatures,
      eventRequirements: [...input.dataRequirements.eventRequirements].sort((left, right) =>
        compareText(left.eventType, right.eventType),
      ),
    },
    executionSemantics: {
      ...input.executionSemantics,
      stateTransition: [...input.executionSemantics.stateTransition].sort((left, right) =>
        compareText(left.from + "/" + left.on + "/" + left.to, right.from + "/" + right.on + "/" + right.to),
      ),
    },
    capabilities: [...new Set(input.capabilities)].sort() as readonly StrategyCapability[],
  };
}

/** 深冻结（防止调用方事后篡改已发布会改变行为 —— 不可变性的进程内保障）。 */
export function deepFreezeCoreDefinition<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreezeCoreDefinition(child);
  return value;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export interface CoreDefinitionValidationOptions {
  readonly featureRegistry?: FeatureRegistry;
}

/** 逐项校验（返回**全部**问题，不只第一条 —— 便于一次修完）。 */
export function validateCoreDefinition(
  definition: StrategyCoreDefinition,
  options: CoreDefinitionValidationOptions = {},
): readonly CoreValidationIssue[] {
  const issues: CoreValidationIssue[] = [];

  if (!(STRATEGY_CORE_SCHEMA_VERSIONS as readonly string[]).includes(definition.schemaVersion)) {
    issues.push(
      validationIssue(
        "CORE_SCHEMA_VERSION_UNSUPPORTED",
        "schemaVersion",
        "不支持的结构版本 " + definition.schemaVersion + "（白名单：" + STRATEGY_CORE_SCHEMA_VERSIONS.join("、") + "）",
      ),
    );
  }

  // 参数 schema
  const parameterIssues = validateParameterSchema(definition.parameterSchema);
  issues.push(...parameterIssues);
  const knownParameters = new Set(definition.parameterSchema.map((item) => item.code));

  // 特征注册表可见性
  const knownFeatures = (featureId: string): boolean => {
    if (options.featureRegistry === undefined) return true; // 未注入注册表 ⇒ 不判定（由泄漏/需求检查负责）
    return options.featureRegistry.has(featureId);
  };

  // 入场 / 出场规则图
  issues.push(
    ...validateRuleGraph(definition.ruleGraph, {
      isKnownField: isKnownCoreFieldReference,
      isKnownFeature: knownFeatures,
      isKnownParameter: (code) => knownParameters.has(code),
    }),
  );
  if (definition.exitRuleGraph !== null) {
    issues.push(
      ...validateRuleGraph(definition.exitRuleGraph, {
        isKnownField: isKnownCoreFieldReference,
        isKnownFeature: knownFeatures,
        isKnownParameter: (code) => knownParameters.has(code),
      }),
    );
  }

  // 参数引用完整性（规则图里引用的参数必须已声明）
  for (const code of collectRuleParameterCodes(definition)) {
    if (!knownParameters.has(code)) {
      issues.push(validationIssue("PARAMETER_UNKNOWN", "ruleGraph", "规则图引用了未声明的参数 " + code));
    }
  }

  // featureRequirements 与规则图引用的一致性
  const declaredFeatures = new Set(definition.featureRequirements.map((item) => item.featureId));
  const usedFeatures = new Set<string>([
    ...collectRuleFeatureReferences(definition.ruleGraph),
    ...(definition.exitRuleGraph === null ? [] : collectRuleFeatureReferences(definition.exitRuleGraph)),
  ]);
  for (const featureId of usedFeatures) {
    if (!declaredFeatures.has(featureId)) {
      issues.push(
        validationIssue(
          "FEATURE_NOT_REGISTERED",
          "featureRequirements",
          "规则图使用了特征 " + featureId + "，但 featureRequirements 未声明（声明的面必须覆盖实现的面）",
        ),
      );
    }
  }
  if (options.featureRegistry !== undefined) {
    for (const requirement of definition.featureRequirements) {
      const found = options.featureRegistry.get(requirement.featureId);
      if (found === null) {
        issues.push(
          validationIssue("FEATURE_NOT_REGISTERED", "featureRequirements", "特征 " + requirement.featureId + " 未注册"),
        );
        continue;
      }
      if (found.version !== requirement.version) {
        issues.push(
          validationIssue(
            "FEATURE_VERSION_MISMATCH",
            "featureRequirements",
            "特征 " + requirement.featureId + " 版本不一致：声明 " + requirement.version + "，注册表 " + found.version,
          ),
        );
      }
    }
  }

  // 数据需求
  issues.push(...validateDataRequirements(definition.dataRequirements));
  const maxWindowEnd = [
    ...collectRuleWindows(definition.ruleGraph),
    ...(definition.exitRuleGraph === null ? [] : collectRuleWindows(definition.exitRuleGraph)),
  ].reduce((max, window) => Math.max(max, window.end), 0);
  if (definition.dataRequirements.forwardHorizon < maxWindowEnd) {
    issues.push(
      validationIssue(
        "DATA_REQUIREMENTS_UNSATISFIED",
        "dataRequirements.forwardHorizon",
        "forwardHorizon=" +
          String(definition.dataRequirements.forwardHorizon) +
          " 小于规则图里最大的窗口终点 T+" +
          String(maxWindowEnd) +
          "（会静默截断窗口 —— 拒绝）",
      ),
    );
  }
  // 规则图引用的**原始列**必须进 requiredFields（派生字段由特征承载，不计入原始列）
  const declaredFields = new Set(definition.dataRequirements.requiredFields);
  const usedColumns = new Set<string>();
  for (const field of [
    ...collectRuleFieldReferences(definition.ruleGraph),
    ...(definition.exitRuleGraph === null ? [] : collectRuleFieldReferences(definition.exitRuleGraph)),
  ]) {
    const parsed = /^(?:prefix\.rd-?\d+|post\.rd\d+|bar)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(field);
    if (parsed === null) continue;
    usedColumns.add(parsed[1] as string);
  }
  for (const column of [...usedColumns].sort()) {
    if (declaredFields.has(column)) continue;
    // 派生字段（volumeRatio / haircutFromEventLow / …）不属于原始列，跳过。
    if (["volumeRatio", "haircutFromEventLow", "isBullish", "momentumFromEventClose"].includes(column)) continue;
    issues.push(
      validationIssue(
        "DATA_REQUIREMENTS_UNSATISFIED",
        "dataRequirements.requiredFields",
        "规则图引用了原始列 " + column + "，但 requiredFields 未声明（声明的面必须覆盖实现的面）",
      ),
    );
  }

  // 执行语义
  issues.push(...validateExecutionSemantics(definition.executionSemantics));

  // 仓位 / 风险
  if (!(POSITION_SIZING_METHODS as readonly string[]).includes(definition.positionSpec.sizingMethod)) {
    issues.push(
      validationIssue("CORE_DEFINITION_INVALID", "positionSpec.sizingMethod", "未知仓位方法 " + String(definition.positionSpec.sizingMethod)),
    );
  }
  if (!Number.isInteger(definition.positionSpec.maxPositions) || definition.positionSpec.maxPositions < 1) {
    issues.push(validationIssue("CORE_DEFINITION_INVALID", "positionSpec.maxPositions", "maxPositions 必须是 >= 1 的整数"));
  }
  if (definition.positionSpec.parameter !== undefined && !knownParameters.has(definition.positionSpec.parameter)) {
    issues.push(
      validationIssue(
        "PARAMETER_UNKNOWN",
        "positionSpec.parameter",
        "仓位比例参数 " + definition.positionSpec.parameter + " 未在 parameterSchema 声明",
      ),
    );
  }

  // 出场规则声明
  const exitIds = new Set<string>();
  const exitPriorities = new Set<number>();
  for (let index = 0; index < definition.exitRules.length; index += 1) {
    const rule = definition.exitRules[index] as DeclaredExitRule;
    const at = "exitRules[" + String(index) + "]";
    if (rule.id.trim() === "") {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at + ".id", "出场规则 id 不能为空"));
    }
    if (exitIds.has(rule.id)) {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at + ".id", "出场规则 id 重复：" + rule.id));
    }
    exitIds.add(rule.id);
    if (!(EXIT_RULE_TYPES as readonly string[]).includes(rule.type)) {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at + ".type", "未知出场类型 " + String(rule.type)));
    }
    if (!(EXIT_TRIGGERS as readonly string[]).includes(rule.trigger)) {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at + ".trigger", "未知出场触发 " + String(rule.trigger)));
    }
    if (rule.thresholdUnit !== null && !(EXIT_THRESHOLD_UNITS as readonly string[]).includes(rule.thresholdUnit)) {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at + ".thresholdUnit", "未知阈值单位 " + String(rule.thresholdUnit)));
    }
    if (rule.threshold !== null && !Number.isFinite(rule.threshold)) {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at + ".threshold", "阈值必须是有限数字"));
    }
    if (rule.threshold !== null && rule.thresholdUnit === null) {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at, "声明了 threshold 却没有 thresholdUnit"));
    }
    if (rule.parameter !== null && !knownParameters.has(rule.parameter)) {
      issues.push(validationIssue("PARAMETER_UNKNOWN", at + ".parameter", "出场阈值参数 " + rule.parameter + " 未声明"));
    }
    if (!Number.isInteger(rule.priority)) {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at + ".priority", "priority 必须是整数"));
    }
    if (exitPriorities.has(rule.priority)) {
      issues.push(validationIssue("CORE_DEFINITION_INVALID", at + ".priority", "同一出场定义内 priority 必须唯一：" + String(rule.priority)));
    }
    exitPriorities.add(rule.priority);
    if (rule.condition !== null) {
      issues.push(
        ...validateRuleGraph(rule.condition, {
          isKnownField: isKnownCoreFieldReference,
          isKnownFeature: knownFeatures,
          isKnownParameter: (code) => knownParameters.has(code),
        }),
      );
    }
  }

  // 能力一致性（**声明 == 推导**）
  const derived = deriveCapabilities({
    ruleGraph: definition.ruleGraph,
    exitRuleGraph: definition.exitRuleGraph,
    positionSpec: { sizingMethod: definition.positionSpec.sizingMethod, maxPositions: definition.positionSpec.maxPositions },
  });
  const declaredSet = new Set(definition.capabilities);
  const derivedSet = new Set(derived);
  const missing = [...derivedSet].filter((capability) => !declaredSet.has(capability)).sort();
  const extra = [...declaredSet].filter((capability) => !derivedSet.has(capability)).sort();
  for (const capability of missing) {
    issues.push(
      validationIssue("CAPABILITIES_MISMATCH", "capabilities", "规则图实现了能力 " + capability + "，但 capabilities 未声明"),
    );
  }
  for (const capability of extra) {
    issues.push(
      validationIssue("CAPABILITIES_MISMATCH", "capabilities", "capabilities 声明了 " + capability + "，但规则图不产生它（死声明）"),
    );
  }

  // §10：Definition 内不得出现 Dataset / 引擎绑定坐标
  const leaks = collectDefinitionLeaks(definition);
  for (const hit of leaks) {
    issues.push(validationIssue("DATASET_BINDING_IN_DEFINITION_FORBIDDEN", "definition", hit));
  }

  return issues;
}

function collectRuleParameterCodes(definition: StrategyCoreDefinition): readonly string[] {
  const out: string[] = [];
  for (const code of collectRuleParameterReferences(definition.ruleGraph)) out.push(code);
  if (definition.exitRuleGraph !== null) {
    for (const code of collectRuleParameterReferences(definition.exitRuleGraph)) out.push(code);
  }
  for (const rule of definition.exitRules) {
    if (rule.parameter !== null) out.push(rule.parameter);
    if (rule.condition !== null) {
      for (const code of collectRuleParameterReferences(rule.condition)) out.push(code);
    }
  }
  return out;
}

/** 收集 Definition 内的 Dataset/引擎绑定泄漏（委托 dataRequirements 的唯一扫描器）。 */
function collectDefinitionLeaks(definition: StrategyCoreDefinition): readonly string[] {
  return findDatasetBindingLeaks(definition);
}

/** 非法即抛（唯一构造入口使用）。 */
export function assertValidCoreDefinition(
  definition: StrategyCoreDefinition,
  options: CoreDefinitionValidationOptions = {},
): void {
  const issues = validateCoreDefinition(definition, options);
  if (issues.length === 0) return;
  const first = issues[0] as CoreValidationIssue;
  throw new StrategyCoreError(
    issues.some((issue) => issue.code === "CAPABILITIES_MISMATCH") ? "CAPABILITIES_MISMATCH" : "CORE_DEFINITION_INVALID",
    issues.map((issue) => issue.path + ": " + issue.message).join(" | "),
    { issueCode: first.code, issueCount: issues.length },
  );
}

/**
 * 创建 canonical Definition（唯一入口）：规范化 → 校验 → 深冻结。
 *
 * 🔴 未通过校验 ⇒ 抛错。**不存在「宽容模式」** —— 半合法的定义会一路漂到回测里
 *   才以更难排查的方式爆炸。
 */
export function createCoreDefinition(
  input: StrategyCoreDefinitionInput,
  options: CoreDefinitionValidationOptions = {},
): StrategyCoreDefinition {
  const normalized = normalizeCoreDefinition(input);
  assertValidCoreDefinition(normalized, options);
  // 能力一致性：显式再跑一次（返回 void 或抛错），确保构造方不会漏掉这条
  assertCapabilitiesConsistent(
    normalized.capabilities,
    deriveCapabilities({
      ruleGraph: normalized.ruleGraph,
      exitRuleGraph: normalized.exitRuleGraph,
      positionSpec: {
        sizingMethod: normalized.positionSpec.sizingMethod,
        maxPositions: normalized.positionSpec.maxPositions,
      },
    }),
  );
  assertNoDatasetBindingInDefinition(normalized);
  assertValidExecutionSemantics(normalized.executionSemantics);
  return deepFreezeCoreDefinition(normalized);
}

/** Definition 的「内容摘要」（供报告/调试；不含指纹，指纹见 fingerprint.ts）。 */
export function summarizeCoreDefinition(definition: StrategyCoreDefinition): {
  readonly schemaVersion: string;
  readonly parameterCount: number;
  readonly searchableParameterCount: number;
  readonly featureRequirementCount: number;
  readonly capabilities: readonly string[];
  readonly forwardHorizon: number;
  readonly lookback: number;
  readonly hasExitGraph: boolean;
} {
  return {
    schemaVersion: definition.schemaVersion,
    parameterCount: definition.parameterSchema.length,
    searchableParameterCount: definition.parameterSchema.filter((item) => item.role === "TUNABLE").length,
    featureRequirementCount: definition.featureRequirements.length,
    capabilities: definition.capabilities,
    forwardHorizon: definition.dataRequirements.forwardHorizon,
    lookback: definition.dataRequirements.lookback,
    hasExitGraph: definition.exitRuleGraph !== null,
  };
}
