/**
 * ENTRY_CONDITION —— 服务端权威的入场规则槽。
 *
 * 本模块只做三件事：
 *   1. 声明入场方案（option）的 canonical `entry.conditions` + `parameters` 模板；
 *   2. 从已有定义精确识别当前槽的方案与参数（认不出返回 null，绝不就近匹配）；
 *   3. 只替换本槽命名空间内的条件与参数，保留其它手工条件 / 参数。
 *
 * 槽的语义边界：
 *   - option 物化后仍写现有 `StrategyDefinition.entry.conditions` 与
 *     `StrategyDefinition.parameters`，不新增任何 StrategyDefinition 字段；
 *   - `condition.id` 使用稳定命名空间 `entry.<slotKey>.<conditionKey>`；
 *   - 参数 code 使用稳定命名空间 `entry_...`；
 *   - 本模块不计算特征，也不实现第二套执行引擎；特征由 Strategy Core / Research
 *     双链按固定字段名注册。
 */

import type {
  ConditionDefinition,
  ParameterDefinition,
} from "../strategySchema/definition";
import type {
  StrategyPresetParameter,
  StrategyPresetParameterValue,
} from "./presetRegistry";

// ---------------------------------------------------------------------------
// 类型与常量
// ---------------------------------------------------------------------------

export const ENTRY_CONDITION_SLOT_IDS = [
  "TREND_PULLBACK_AFTER_FIRST_LIMIT_UP",
] as const;
export type EntryConditionSlotId = (typeof ENTRY_CONDITION_SLOT_IDS)[number];

export type EntryConditionSlotVisibility = "PRIMARY" | "MORE" | "RESEARCH";

export interface EntryConditionSlotOption {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly conditions: readonly ConditionDefinition[];
  readonly parameters: readonly ParameterDefinition[];
  /** 该 option 拥有的 condition.id 前缀。 */
  readonly conditionIdPrefix: string;
  /** 该 option 声明并拥有的参数 code。 */
  readonly parameterCodes: readonly string[];
}

export interface EntryConditionSlotDefinition {
  readonly slotId: EntryConditionSlotId;
  readonly label: string;
  readonly question: string;
  readonly visibility: EntryConditionSlotVisibility;
  readonly conditionIdPrefix: string;
  readonly parameterCodes: readonly string[];
  readonly options: readonly EntryConditionSlotOption[];
}

export interface MaterializeEntryConditionSlotOptionResult {
  readonly conditions: readonly ConditionDefinition[];
  readonly parameters: readonly ParameterDefinition[];
  readonly issues: readonly string[];
}

export interface RecognizeEntryConditionSlotResult {
  readonly optionId: string;
  readonly parameters: Readonly<Record<string, StrategyPresetParameterValue>>;
  /** 该槽稳定拥有的 condition.id；前端用它把槽管理条件从手动条件列表中隐藏。 */
  readonly managedConditionIds: readonly string[];
}

export interface EntryConditionSlotApplyResult {
  readonly conditions: readonly ConditionDefinition[];
  readonly parameters: readonly ParameterDefinition[];
  readonly issues: readonly string[];
}

/** apply / recognize 所需的最小定义载体；完整 StrategyDefinition 自动满足该结构。 */
export interface EntryConditionSlotDefinitionCarrier {
  readonly entry: {
    readonly conditions: readonly ConditionDefinition[];
  };
  readonly parameters: readonly ParameterDefinition[];
}

const ENTRY_CONDITION_SLOT_ID = ENTRY_CONDITION_SLOT_IDS[0];
const TREND_PULLBACK_PREFIX = "entry.trend_pullback.";
const TREND_PULLBACK_OPTION_ID = "trend-pullback-after-first-limit-up";
const OFF_OPTION_ID = "off";

const ENTRY_PEAK_PULLBACK_MIN = "entry_peak_pullback_min";
const ENTRY_PEAK_PULLBACK_MAX = "entry_peak_pullback_max";
const ENTRY_MAX_VOLUME_RATIO = "entry_max_volume_ratio";
const ENTRY_REQUIRE_BULLISH = "entry_require_bullish";

const TREND_PULLBACK_PARAMETER_CODES = [
  ENTRY_PEAK_PULLBACK_MIN,
  ENTRY_PEAK_PULLBACK_MAX,
  ENTRY_MAX_VOLUME_RATIO,
  ENTRY_REQUIRE_BULLISH,
] as const;

const TREND_PULLBACK_CONDITION_KEYS = ["min", "max", "trend", "volume", "bullish"] as const;
type TrendPullbackConditionKey = (typeof TREND_PULLBACK_CONDITION_KEYS)[number];

// ---------------------------------------------------------------------------
// 参数模板
// ---------------------------------------------------------------------------

function numberParameter(input: {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly role: "FIXED" | "TUNABLE";
  readonly defaultValue: number;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}): ParameterDefinition {
  return {
    code: input.code,
    name: input.name,
    dataType: "number",
    parameterRole: input.role,
    defaultValue: input.defaultValue,
    min: input.min,
    max: input.max,
    step: input.step,
    unit: input.unit,
    description: input.description,
    required: true,
  };
}

const ENTRY_TREND_PULLBACK_PARAMETERS: readonly ParameterDefinition[] = [
  numberParameter({
    code: ENTRY_PEAK_PULLBACK_MIN,
    name: "首板后峰值回撤下限",
    description: "至少从事件后收盘峰值回撤多少才进入买点观察带；0.03 = 3%。",
    role: "FIXED",
    defaultValue: 0.03,
    unit: "RATIO",
    min: 0,
    max: 0.5,
    step: 0.005,
  }),
  numberParameter({
    code: ENTRY_PEAK_PULLBACK_MAX,
    name: "首板后峰值回撤上限",
    description: "回撤超过该比例视为趋势破坏；0.08 = 8%。",
    role: "TUNABLE",
    defaultValue: 0.08,
    unit: "RATIO",
    min: 0.05,
    max: 0.15,
    step: 0.01,
  }),
  numberParameter({
    code: ENTRY_MAX_VOLUME_RATIO,
    name: "最大量能比",
    description: "当前 bar 成交量 / 事件日成交量的上限；0.50 = 缩量到一半以内。",
    role: "TUNABLE",
    defaultValue: 0.5,
    unit: "RATIO",
    min: 0.1,
    max: 1,
    step: 0.05,
  }),
  numberParameter({
    code: ENTRY_REQUIRE_BULLISH,
    name: "要求红盘",
    description: "0 = 不要求红盘，1 = 要求当前 bar 为红盘。",
    role: "TUNABLE",
    defaultValue: 0,
    unit: "BOOLEAN_0_1",
    min: 0,
    max: 1,
    step: 1,
  }),
];

function condition(input: {
  readonly key: TrendPullbackConditionKey;
  readonly field: string;
  readonly operator: ConditionDefinition["operator"];
  readonly value: ConditionDefinition["value"];
  readonly valueType: ConditionDefinition["valueType"];
  readonly description: string;
}): ConditionDefinition {
  return {
    id: `${TREND_PULLBACK_PREFIX}${input.key}`,
    field: input.field,
    operator: input.operator,
    value: input.value,
    valueType: input.valueType,
    description: input.description,
    enabled: true,
  };
}

const ENTRY_TREND_PULLBACK_CONDITIONS: readonly ConditionDefinition[] = [
  condition({
    key: "min",
    field: "bar.pullbackFromEventPeakClose",
    operator: "GREATER_THAN_OR_EQUAL",
    value: ENTRY_PEAK_PULLBACK_MIN,
    valueType: "PARAMETER_REFERENCE",
    description: "当前收盘距事件后收盘峰值的回撤不低于下限。",
  }),
  condition({
    key: "max",
    field: "bar.pullbackFromEventPeakClose",
    operator: "LESS_THAN_OR_EQUAL",
    value: ENTRY_PEAK_PULLBACK_MAX,
    valueType: "PARAMETER_REFERENCE",
    description: "当前收盘距事件后收盘峰值的回撤不高于上限。",
  }),
  condition({
    key: "trend",
    field: "bar.trendHoldsMa5Ma10",
    operator: "GREATER_THAN_OR_EQUAL",
    value: 1,
    valueType: "CONSTANT",
    description: "趋势未破：收盘在 MA10 上且 MA5 在 MA10 上。",
  }),
  condition({
    key: "volume",
    field: "bar.volumeRatio",
    operator: "LESS_THAN_OR_EQUAL",
    value: ENTRY_MAX_VOLUME_RATIO,
    valueType: "PARAMETER_REFERENCE",
    description: "回踩量能不高于事件日成交量的指定比例。",
  }),
  condition({
    key: "bullish",
    field: "bar.isBullish",
    operator: "GREATER_THAN_OR_EQUAL",
    value: ENTRY_REQUIRE_BULLISH,
    valueType: "PARAMETER_REFERENCE",
    description: "按参数决定是否要求当前 bar 为红盘（0 = 不要求）。",
  }),
];

const TREND_PULLBACK_OPTION: EntryConditionSlotOption = {
  optionId: TREND_PULLBACK_OPTION_ID,
  displayName: "首板后趋势回撤买点",
  summary: "首板后从收盘峰值回撤到设定区间，且收盘在 MA10 上、MA5 在 MA10 上时买入（可叠加缩量与红盘约束）。",
  conditions: ENTRY_TREND_PULLBACK_CONDITIONS,
  parameters: ENTRY_TREND_PULLBACK_PARAMETERS,
  conditionIdPrefix: TREND_PULLBACK_PREFIX,
  parameterCodes: TREND_PULLBACK_PARAMETER_CODES,
};

const OFF_OPTION: EntryConditionSlotOption = {
  optionId: OFF_OPTION_ID,
  displayName: "不设置入场条件",
  summary: "本槽不产生任何入场条件；已有手工条件保持不变。",
  conditions: [],
  parameters: [],
  conditionIdPrefix: TREND_PULLBACK_PREFIX,
  parameterCodes: [],
};

export const ENTRY_CONDITION_SLOTS: readonly EntryConditionSlotDefinition[] = [
  {
    slotId: ENTRY_CONDITION_SLOT_ID,
    label: "入场条件",
    question: "首板涨停后，满足什么条件才允许买入？",
    visibility: "PRIMARY",
    conditionIdPrefix: TREND_PULLBACK_PREFIX,
    parameterCodes: TREND_PULLBACK_PARAMETER_CODES,
    options: [TREND_PULLBACK_OPTION, OFF_OPTION],
  },
];

// ---------------------------------------------------------------------------
// 查找
// ---------------------------------------------------------------------------

export function findEntryConditionSlot(slotId: string): EntryConditionSlotDefinition {
  const slot = ENTRY_CONDITION_SLOTS.find((candidate) => candidate.slotId === slotId);
  if (slot === undefined) throw new Error(`ENTRY_CONDITION_SLOT_UNKNOWN: ${slotId}`);
  return slot;
}

export function findEntryConditionSlotOption(
  slotId: string,
  optionId: string,
): EntryConditionSlotOption | null {
  return findEntryConditionSlot(slotId).options.find((option) => option.optionId === optionId) ?? null;
}

// ---------------------------------------------------------------------------
// 参数校验与物化
// ---------------------------------------------------------------------------

function isPresetParameterValue(value: unknown): value is StrategyPresetParameterValue {
  return typeof value === "number" || typeof value === "boolean" || typeof value === "string";
}

function parameterIssue(parameter: StrategyPresetParameter, message: string): string {
  return `ENTRY_CONDITION_PARAMETER_INVALID: ${parameter.code}: ${message}`;
}

function validateResolvedParameter(
  parameter: StrategyPresetParameter,
  raw: unknown,
): { readonly value: StrategyPresetParameterValue; readonly issues: readonly string[] } {
  if (!isPresetParameterValue(raw)) {
    return { value: parameter.defaultValue, issues: [parameterIssue(parameter, "必须是 number / boolean / string")] };
  }
  const issues: string[] = [];
  if (parameter.valueType === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return { value: parameter.defaultValue, issues: [parameterIssue(parameter, "必须是有限数值")] };
    }
    if (parameter.min !== undefined && raw < parameter.min) {
      issues.push(parameterIssue(parameter, `不得小于 ${parameter.min}`));
    }
    if (parameter.max !== undefined && raw > parameter.max) {
      issues.push(parameterIssue(parameter, `不得大于 ${parameter.max}`));
    }
    if (parameter.step !== undefined && parameter.step > 0) {
      const steps = (raw - (parameter.min ?? 0)) / parameter.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        issues.push(parameterIssue(parameter, `必须按步长 ${parameter.step} 取值`));
      }
    }
  } else if (parameter.valueType === "boolean") {
    if (typeof raw !== "boolean") issues.push(parameterIssue(parameter, "必须是 boolean"));
  } else if (parameter.valueType === "string") {
    if (typeof raw !== "string") issues.push(parameterIssue(parameter, "必须是 string"));
    if (parameter.allowedValues !== undefined && !parameter.allowedValues.includes(String(raw))) {
      issues.push(parameterIssue(parameter, `必须是 ${parameter.allowedValues.join(" | ")} 之一`));
    }
  }
  return { value: raw, issues };
}

function resolveOptionParameters(
  option: EntryConditionSlotOption,
  supplied: Readonly<Record<string, StrategyPresetParameterValue>>,
): {
  readonly parameters: readonly ParameterDefinition[];
  readonly values: Readonly<Record<string, StrategyPresetParameterValue>>;
  readonly issues: readonly string[];
} {
  const declaredCodes = new Set(option.parameters.map((parameter) => parameter.code));
  const issues: string[] = [];
  for (const code of Object.keys(supplied)) {
    if (!declaredCodes.has(code)) issues.push(`ENTRY_CONDITION_PARAMETER_UNKNOWN: ${code}`);
  }

  const values: Record<string, StrategyPresetParameterValue> = {};
  const resolvedByCode = new Map<string, ParameterDefinition>();
  for (const parameter of option.parameters) {
    const raw = Object.prototype.hasOwnProperty.call(supplied, parameter.code)
      ? supplied[parameter.code]
      : parameter.defaultValue;
    const presetParameter: StrategyPresetParameter = {
      code: parameter.code,
      label: parameter.name,
      description: parameter.description ?? "",
      path: parameter.code,
      valueType: parameter.dataType === "number" ? "number" : parameter.dataType === "boolean" ? "boolean" : "string",
      ...(parameter.unit !== undefined ? { unit: parameter.unit } : {}),
      ...(parameter.min !== undefined ? { min: parameter.min } : {}),
      ...(parameter.max !== undefined ? { max: parameter.max } : {}),
      ...(parameter.step !== undefined ? { step: parameter.step } : {}),
      ...(parameter.allowedValues !== undefined ? { allowedValues: parameter.allowedValues } : {}),
      required: parameter.required,
      defaultValue: (parameter.defaultValue ?? 0) as StrategyPresetParameterValue,
    };
    const validated = validateResolvedParameter(presetParameter, raw);
    issues.push(...validated.issues);
    values[parameter.code] = validated.value;
    resolvedByCode.set(parameter.code, {
      ...parameter,
      defaultValue: validated.value,
    });
  }

  const min = values[ENTRY_PEAK_PULLBACK_MIN];
  const max = values[ENTRY_PEAK_PULLBACK_MAX];
  if (typeof min === "number" && typeof max === "number" && min > max) {
    issues.push(`ENTRY_CONDITION_PARAMETER_RANGE_INVALID: ${ENTRY_PEAK_PULLBACK_MIN} (${min}) > ${ENTRY_PEAK_PULLBACK_MAX} (${max})`);
  }

  return {
    parameters: option.parameters.map((parameter) => resolvedByCode.get(parameter.code) ?? parameter),
    values,
    issues,
  };
}

export function materializeEntryConditionSlotOption(
  slotId: string,
  optionId: string,
  parameters: Readonly<Record<string, StrategyPresetParameterValue>> = {},
): MaterializeEntryConditionSlotOptionResult {
  let option: EntryConditionSlotOption | null;
  try {
    option = findEntryConditionSlotOption(slotId, optionId);
  } catch (error) {
    return { conditions: [], parameters: [], issues: [error instanceof Error ? error.message : String(error)] };
  }
  if (option === null) {
    return { conditions: [], parameters: [], issues: [`ENTRY_CONDITION_OPTION_UNKNOWN: ${slotId}/${optionId}`] };
  }
  if (option.optionId === OFF_OPTION_ID) {
    if (Object.keys(parameters).length > 0) {
      return { conditions: [], parameters: [], issues: ["ENTRY_CONDITION_OFF_PARAMETERS_FORBIDDEN: off 不接受参数"] };
    }
    return { conditions: [], parameters: [], issues: [] };
  }

  const resolved = resolveOptionParameters(option, parameters);
  if (resolved.issues.length > 0) {
    return { conditions: [], parameters: [], issues: resolved.issues };
  }
  return {
    conditions: option.conditions.map((condition) => ({ ...condition })),
    parameters: resolved.parameters.map((parameter) => ({ ...parameter })),
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// 识别
// ---------------------------------------------------------------------------

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function conditionsMatch(expected: ConditionDefinition, actual: ConditionDefinition): boolean {
  return expected.id === actual.id
    && expected.field === actual.field
    && expected.operator === actual.operator
    && expected.valueType === actual.valueType
    && expected.enabled === actual.enabled
    && canonicalValue(expected.value) === canonicalValue(actual.value);
}

function parameterDeclarationMatches(expected: ParameterDefinition, actual: ParameterDefinition): boolean {
  return expected.code === actual.code
    && expected.name === actual.name
    && expected.dataType === actual.dataType
    && expected.parameterRole === actual.parameterRole
    && expected.required === actual.required
    && expected.min === actual.min
    && expected.max === actual.max
    && expected.step === actual.step
    && expected.unit === actual.unit
    && canonicalValue(expected.allowedValues) === canonicalValue(actual.allowedValues);
}

function ownConditions(
  conditions: readonly ConditionDefinition[],
  prefix: string,
): readonly ConditionDefinition[] {
  return conditions.filter((condition) => typeof condition.id === "string" && condition.id.startsWith(prefix));
}

function ownParameters(
  parameters: readonly ParameterDefinition[],
  parameterCodes: readonly string[],
): readonly ParameterDefinition[] {
  const codes = new Set(parameterCodes);
  return parameters.filter((parameter) => codes.has(parameter.code));
}

function conditionSetMatches(
  option: EntryConditionSlotOption,
  owned: readonly ConditionDefinition[],
): boolean {
  const expectedById = new Map(option.conditions.map((condition) => [condition.id, condition] as const));
  if (owned.length !== expectedById.size) return false;
  const seen = new Set<string>();
  for (const condition of owned) {
    if (condition.id === undefined || seen.has(condition.id)) return false;
    const expected = expectedById.get(condition.id);
    if (expected === undefined || !conditionsMatch(expected, condition)) return false;
    seen.add(condition.id);
  }
  return seen.size === expectedById.size;
}

function readRecognizedParameters(
  option: EntryConditionSlotOption,
  parameters: readonly ParameterDefinition[],
): Readonly<Record<string, StrategyPresetParameterValue>> | null {
  const byCode = new Map(parameters.map((parameter) => [parameter.code, parameter] as const));
  const values: Record<string, StrategyPresetParameterValue> = {};
  for (const expected of option.parameters) {
    const actual = byCode.get(expected.code);
    if (actual === undefined || !parameterDeclarationMatches(expected, actual)) return null;
    const value = actual.defaultValue;
    if (!isPresetParameterValue(value)) return null;
    values[expected.code] = value;
  }
  return values;
}

export function recognizeEntryConditionSlot(
  definition: EntryConditionSlotDefinitionCarrier,
  slotId: string,
): RecognizeEntryConditionSlotResult | null {
  const slot = findEntryConditionSlot(slotId);
  const conditions = definition.entry.conditions;
  const ownedConditions = ownConditions(conditions, slot.conditionIdPrefix);
  const ownedParameters = ownParameters(definition.parameters, slot.parameterCodes);

  if (ownedConditions.length === 0 && ownedParameters.length === 0) {
    return { optionId: OFF_OPTION_ID, parameters: {}, managedConditionIds: [] };
  }

  for (const option of slot.options) {
    if (option.optionId === OFF_OPTION_ID) continue;
    if (!conditionSetMatches(option, ownedConditions)) continue;
    const parameterValues = readRecognizedParameters(option, ownedParameters);
    if (parameterValues === null) continue;
    if (ownedParameters.length !== option.parameters.length) continue;
    return {
      optionId: option.optionId,
      parameters: parameterValues,
      managedConditionIds: ownedConditions
        .map((condition) => condition.id)
        .filter((id): id is string => typeof id === "string"),
    };
  }
  return null;
}

export function entryConditionSlotIsAtDefaults(
  recognized: RecognizeEntryConditionSlotResult,
  slotId: string,
): boolean {
  const option = findEntryConditionSlotOption(slotId, recognized.optionId);
  if (option === null) return false;
  return option.parameters.every((parameter) => recognized.parameters[parameter.code] === parameter.defaultValue);
}

/**
 * 判断一份定义是否声明了 ENTRY_CONDITION 命名空间下的条件。
 *
 * 装配层用它做 fail-closed 守卫：只要声明了入场槽，就不能在 Core 构造失败时
 * 静默回落到 legacy recipe。
 */
export function hasEntryConditionSlotConditions(
  definition: {
    readonly entry?: {
      readonly conditions?: readonly ConditionDefinition[];
    };
  } | null | undefined,
  slotId?: string,
): boolean {
  const prefixes = slotId === undefined
    ? ENTRY_CONDITION_SLOTS.map((slot) => slot.conditionIdPrefix)
    : [findEntryConditionSlot(slotId).conditionIdPrefix];
  return (definition?.entry?.conditions ?? []).some((condition) =>
    typeof condition.id === "string" && prefixes.some((prefix) => condition.id!.startsWith(prefix)));
}

// ---------------------------------------------------------------------------
// 参数引用扫描（用于删除前的安全闸门）
// ---------------------------------------------------------------------------

function conditionReferencesParameter(
  condition: ConditionDefinition,
  codes: ReadonlySet<string>,
): boolean {
  if (condition.valueType !== "PARAMETER_REFERENCE") return false;
  if (Array.isArray(condition.value)) {
    return condition.value.some((value) => typeof value === "string" && codes.has(value));
  }
  return typeof condition.value === "string" && codes.has(condition.value);
}

function valueContainsParameterReference(value: unknown, codes: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some((item) => valueContainsParameterReference(item, codes));
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.valueType === "PARAMETER_REFERENCE") {
    const referenced = record.value;
    if (typeof referenced === "string" && codes.has(referenced)) return true;
    if (Array.isArray(referenced) && referenced.some((item) => typeof item === "string" && codes.has(item))) {
      return true;
    }
  }
  if (typeof record.parameter === "string" && codes.has(record.parameter)) return true;
  return Object.values(record).some((item) => valueContainsParameterReference(item, codes));
}

function hasExternalParameterReference(
  definition: EntryConditionSlotDefinitionCarrier,
  slot: EntryConditionSlotDefinition,
  codes: ReadonlySet<string>,
): boolean {
  const ownedConditionIds = new Set(
    ownConditions(definition.entry.conditions, slot.conditionIdPrefix)
      .map((condition) => condition.id)
      .filter((id): id is string => typeof id === "string"),
  );
  if (definition.entry.conditions.some((condition) =>
    (condition.id === undefined || !ownedConditionIds.has(condition.id))
    && conditionReferencesParameter(condition, codes))) {
    return true;
  }

  const full = definition as unknown as Record<string, unknown>;
  const ignoredKeys = new Set(["entry", "parameters"]);
  return Object.entries(full).some(([key, value]) =>
    !ignoredKeys.has(key) && valueContainsParameterReference(value, codes));
}

// ---------------------------------------------------------------------------
// 应用
// ---------------------------------------------------------------------------

export function applyEntryConditionSlot(
  definition: EntryConditionSlotDefinitionCarrier,
  slotId: string,
  optionId: string,
  parameters: Readonly<Record<string, StrategyPresetParameterValue>> = {},
): EntryConditionSlotApplyResult {
  let slot: EntryConditionSlotDefinition;
  try {
    slot = findEntryConditionSlot(slotId);
  } catch (error) {
    return {
      conditions: definition.entry.conditions,
      parameters: definition.parameters,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }

  const materialized = materializeEntryConditionSlotOption(slotId, optionId, parameters);
  if (materialized.issues.length > 0) {
    return {
      conditions: definition.entry.conditions,
      parameters: definition.parameters,
      issues: materialized.issues,
    };
  }

  const ownedParameters = ownParameters(definition.parameters, slot.parameterCodes);
  const desiredCodes = new Set(materialized.parameters.map((parameter) => parameter.code));
  const parameterCodesToRemove = new Set(
    ownedParameters
      .filter((parameter) => !desiredCodes.has(parameter.code))
      .map((parameter) => parameter.code),
  );
  const parameterCodesToWrite = new Set(materialized.parameters.map((parameter) => parameter.code));

  const existingByCode = new Map(definition.parameters.map((parameter) => [parameter.code, parameter] as const));
  const issues: string[] = [];
  for (const desired of materialized.parameters) {
    const existing = existingByCode.get(desired.code);
    if (existing !== undefined && !parameterDeclarationMatches(desired, existing)) {
      issues.push(`ENTRY_CONDITION_PARAMETER_CONFLICT: ${desired.code} 已存在且定义不一致`);
    }
  }
  if (parameterCodesToRemove.size > 0 && hasExternalParameterReference(definition, slot, parameterCodesToRemove)) {
    issues.push(`ENTRY_CONDITION_PARAMETER_REFERENCED: ${[...parameterCodesToRemove].join(", ")} 仍被本槽以外的条件引用，拒绝删除`);
  }
  if (parameterCodesToWrite.size > 0 && hasExternalParameterReference(definition, slot, parameterCodesToWrite)) {
    issues.push(`ENTRY_CONDITION_PARAMETER_REFERENCED: ${[...parameterCodesToWrite].join(", ")} 被本槽以外的条件引用，拒绝改写`);
  }
  if (issues.length > 0) {
    return { conditions: definition.entry.conditions, parameters: definition.parameters, issues };
  }

  const ownedConditionIds = new Set(
    ownConditions(definition.entry.conditions, slot.conditionIdPrefix)
      .map((condition) => condition.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const firstOwnedIndex = definition.entry.conditions.findIndex((condition) =>
    condition.id !== undefined && ownedConditionIds.has(condition.id));
  const retainedConditions = definition.entry.conditions.filter((condition) =>
    condition.id === undefined || !ownedConditionIds.has(condition.id));
  const conditions = [...retainedConditions];
  if (materialized.conditions.length > 0) {
    const insertAt = firstOwnedIndex >= 0 ? Math.min(firstOwnedIndex, conditions.length) : conditions.length;
    conditions.splice(insertAt, 0, ...materialized.conditions.map((condition) => ({ ...condition })));
  }

  const nextParameters: ParameterDefinition[] = [];
  for (const existing of definition.parameters) {
    const desired = materialized.parameters.find((candidate) => candidate.code === existing.code);
    if (desired !== undefined) {
      nextParameters.push({ ...existing, ...desired });
      continue;
    }
    if (parameterCodesToRemove.has(existing.code)) continue;
    nextParameters.push(existing);
  }
  for (const desired of materialized.parameters) {
    if (!nextParameters.some((parameter) => parameter.code === desired.code)) {
      nextParameters.push({ ...desired });
    }
  }

  return { conditions, parameters: nextParameters, issues: [] };
}