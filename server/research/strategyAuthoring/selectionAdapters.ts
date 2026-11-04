/**
 * SELECTION —— 通用 AuthoringSlot handler。
 *
 * 第一版按冻结裁定不拆 recipe 内部：
 *   - SIGNAL_RECIPE 只拥有 document-level `target.recipe`，option payload 就是 recipeRegistry 的规范投影；
 *   - EVENT / OBSERVATION / TRIGGER 只写 definition.entry 下各自 owned 字段；
 *   - apply 返回完整 target，且不把未拥有字段重建或复制到别处。
 */
import {
  STRATEGY_EVENT_TYPES,
  STRATEGY_TRIGGER_TYPES,
  STRATEGY_WINDOW_UNITS,
  type StrategyEventType,
  type StrategyTriggerType,
  type StrategyWindowUnit,
} from "../strategySchema/definition";
import {
  RECIPE_PRESETS,
  type StrategyPresetParameter,
  type StrategyPresetParameterValue,
} from "./presetRegistry";
import type {
  AuthoringApplyResult,
  AuthoringParameters,
  AuthoringRecognitionItem,
  AuthoringSlotHandler,
  AuthoringSlotOptionSummary,
  AuthoringSlotSummary,
  AuthoringTarget,
} from "./authoringSlotTypes";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (isRecord(value)) {
    const out: UnknownRecord = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) out[key] = canonicalize(item);
    }
    return out;
  }
  return value;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function numberParameter(input: {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly defaultValue: number;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}): StrategyPresetParameter {
  return {
    code: input.code,
    label: input.label,
    description: input.description,
    path: input.path,
    valueType: "number",
    required: true,
    defaultValue: input.defaultValue,
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    ...(input.min === undefined ? {} : { min: input.min }),
    ...(input.max === undefined ? {} : { max: input.max }),
    ...(input.step === undefined ? {} : { step: input.step }),
  };
}

function stringParameter(input: {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly defaultValue: string;
  readonly allowedValues?: readonly string[];
  readonly optionLabels?: Readonly<Record<string, string>>;
}): StrategyPresetParameter {
  return {
    code: input.code,
    label: input.label,
    description: input.description,
    path: input.path,
    valueType: "string",
    required: true,
    defaultValue: input.defaultValue,
    ...(input.allowedValues === undefined ? {} : { allowedValues: [...input.allowedValues] }),
    ...(input.optionLabels === undefined ? {} : { optionLabels: input.optionLabels }),
  };
}

function resolveParameterValues(
  declarations: readonly StrategyPresetParameter[],
  provided: AuthoringParameters,
  prefix: string,
): { readonly values: Readonly<Record<string, StrategyPresetParameterValue>>; readonly issues: readonly string[] } {
  const allowed = new Set(declarations.map((declaration) => declaration.code));
  const issues: string[] = [];
  for (const code of Object.keys(provided)) {
    if (!allowed.has(code)) issues.push(`AUTHORING_PARAMETER_UNKNOWN: ${prefix}/${code}`);
  }
  if (issues.length > 0) return { values: {}, issues };

  const values: Record<string, StrategyPresetParameterValue> = {};
  for (const declaration of declarations) {
    const value = hasOwn(provided, declaration.code) ? provided[declaration.code] : declaration.defaultValue;
    if (value === undefined) {
      issues.push(`AUTHORING_PARAMETER_REQUIRED: ${prefix}/${declaration.code}`);
      continue;
    }
    if (declaration.valueType === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(`AUTHORING_PARAMETER_TYPE: ${prefix}/${declaration.code} 必须是有限数字`);
        continue;
      }
      if (declaration.min !== undefined && value < declaration.min) {
        issues.push(`AUTHORING_PARAMETER_RANGE: ${prefix}/${declaration.code} < ${declaration.min}`);
        continue;
      }
      if (declaration.max !== undefined && value > declaration.max) {
        issues.push(`AUTHORING_PARAMETER_RANGE: ${prefix}/${declaration.code} > ${declaration.max}`);
        continue;
      }
      if (declaration.step !== undefined && declaration.step > 0) {
        const units = value / declaration.step;
        if (Math.abs(units - Math.round(units)) > 1e-8) {
          issues.push(`AUTHORING_PARAMETER_STEP: ${prefix}/${declaration.code}`);
          continue;
        }
      }
    } else if (declaration.valueType === "boolean") {
      if (typeof value !== "boolean") {
        issues.push(`AUTHORING_PARAMETER_TYPE: ${prefix}/${declaration.code} 必须是布尔值`);
        continue;
      }
    } else {
      if (typeof value !== "string") {
        issues.push(`AUTHORING_PARAMETER_TYPE: ${prefix}/${declaration.code} 必须是字符串`);
        continue;
      }
      if (declaration.allowedValues !== undefined && !declaration.allowedValues.includes(value)) {
        issues.push(`AUTHORING_PARAMETER_ALLOWED: ${prefix}/${declaration.code}=${value}`);
        continue;
      }
    }
    values[declaration.code] = value;
  }
  return { values, issues };
}

function defaultsMatch(
  values: Readonly<Record<string, StrategyPresetParameterValue>>,
  declarations: readonly StrategyPresetParameter[],
): boolean {
  return declarations.every((declaration) => values[declaration.code] === declaration.defaultValue);
}

function issueResult(target: AuthoringTarget, issues: readonly string[]): AuthoringApplyResult {
  return { ...target, issues: [...issues] };
}

function unknownRecognition(
  slotId: string,
  managedPaths?: readonly string[],
): AuthoringRecognitionItem {
  return {
    group: "SELECTION",
    slotId,
    optionId: null,
    parameters: {},
    atDefaults: false,
    ...(managedPaths === undefined ? {} : { managedPaths }),
  };
}

function optionSummary(option: {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly parameters: readonly StrategyPresetParameter[];
}): AuthoringSlotOptionSummary {
  return {
    optionId: option.optionId,
    displayName: option.displayName,
    summary: option.summary,
    parameters: option.parameters,
  };
}

// ---------------------------------------------------------------------------
// SIGNAL_RECIPE
// ---------------------------------------------------------------------------

const SIGNAL_RECIPE_OFF_OPTION_ID = "off";
const SIGNAL_RECIPE_MANAGED_PATHS = ["recipe"] as const;

interface SignalRecipeOptionSpec {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly parameters: readonly StrategyPresetParameter[];
  readonly kind: "recipe" | "off";
  readonly payload: unknown | null;
}

const SIGNAL_RECIPE_OPTIONS: readonly SignalRecipeOptionSpec[] = [
  ...RECIPE_PRESETS.map((preset): SignalRecipeOptionSpec => ({
    optionId: preset.presetId,
    displayName: preset.displayName,
    summary: preset.summary,
    parameters: preset.parameters,
    kind: "recipe",
    payload: preset.payload,
  })),
  {
    optionId: SIGNAL_RECIPE_OFF_OPTION_ID,
    displayName: "不设整包信号配方",
    summary: "清空 document-level recipe；是否进入声明式条件路径由后续执行装配裁定。",
    parameters: [],
    kind: "off",
    payload: null,
  },
];

const SIGNAL_RECIPE_SUMMARY: AuthoringSlotSummary = {
  slotId: "SIGNAL_RECIPE",
  label: "信号配方",
  question: "选股和信号用哪套已注册配方？",
  visibility: "PRIMARY",
  options: SIGNAL_RECIPE_OPTIONS.map(optionSummary),
};

function findSignalRecipeOption(optionId: string): SignalRecipeOptionSpec | null {
  return SIGNAL_RECIPE_OPTIONS.find((option) => option.optionId === optionId) ?? null;
}

function signalRecipeRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  if (target.recipe === null || target.recipe === undefined) {
    return {
      group: "SELECTION",
      slotId: "SIGNAL_RECIPE",
      optionId: SIGNAL_RECIPE_OFF_OPTION_ID,
      parameters: {},
      atDefaults: true,
      managedPaths: SIGNAL_RECIPE_MANAGED_PATHS,
    };
  }
  const matched = SIGNAL_RECIPE_OPTIONS.find((option) =>
    option.kind === "recipe" && canonicalEqual(target.recipe, option.payload));
  return matched === undefined
    ? unknownRecognition("SIGNAL_RECIPE", SIGNAL_RECIPE_MANAGED_PATHS)
    : {
      group: "SELECTION",
      slotId: "SIGNAL_RECIPE",
      optionId: matched.optionId,
      parameters: {},
      atDefaults: true,
      managedPaths: SIGNAL_RECIPE_MANAGED_PATHS,
    };
}

function applySignalRecipe(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "SIGNAL_RECIPE") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: SELECTION/${slotId}`]);
  }
  const option = findSignalRecipeOption(optionId);
  if (option === null) {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: SELECTION/${slotId}/${optionId}`]);
  }
  const resolved = resolveParameterValues(option.parameters, parameters, `SELECTION/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);
  return {
    ...target,
    recipe: option.kind === "off" ? null : cloneJson(option.payload),
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// EVENT
// ---------------------------------------------------------------------------

const EVENT_MANAGED_PATHS = [
  "definition.entry.event.type",
  "definition.entry.event.params",
] as const;
const EVENT_OWNED_PARAMETER_CODES = ["limitUpRatio", "eventCode"] as const;

interface EventOptionSpec {
  readonly optionId: StrategyEventType;
  readonly eventType: StrategyEventType;
  readonly displayName: string;
  readonly summary: string;
  readonly parameters: readonly StrategyPresetParameter[];
}

const LIMIT_UP_RATIO_PARAMETER = numberParameter({
  code: "limitUpRatio",
  label: "涨停比例",
  description: "仅 FIRST_LIMIT_UP / LIMIT_UP 使用；缺省参数时本表单不识别，不静默改写。",
  path: "entry.event.params.limitUpRatio",
  defaultValue: 0.1,
  unit: "RATIO",
  min: 0.01,
  max: 0.5,
  step: 0.01,
});

const CUSTOM_EVENT_CODE_PARAMETER = stringParameter({
  code: "eventCode",
  label: "自定义事件代码",
  description: "CUSTOM_EVENT 的具体事件代码。",
  path: "entry.event.params.eventCode",
  defaultValue: "custom-event",
});

const EVENT_OPTION_SPECS: readonly EventOptionSpec[] = STRATEGY_EVENT_TYPES.map((eventType) => {
  if (eventType === "FIRST_LIMIT_UP") {
    return {
      optionId: eventType,
      eventType,
      displayName: "首次涨停",
      summary: "首次涨停事件；limitUpRatio 默认 10%。",
      parameters: [LIMIT_UP_RATIO_PARAMETER],
    };
  }
  if (eventType === "LIMIT_UP") {
    return {
      optionId: eventType,
      eventType,
      displayName: "涨停",
      summary: "任一涨停事件；limitUpRatio 默认 10%。",
      parameters: [LIMIT_UP_RATIO_PARAMETER],
    };
  }
  if (eventType === "BREAKOUT") {
    return {
      optionId: eventType,
      eventType,
      displayName: "突破",
      summary: "突破事件；不声明额外 event.params。",
      parameters: [],
    };
  }
  if (eventType === "PRICE_PATTERN") {
    return {
      optionId: eventType,
      eventType,
      displayName: "价格形态",
      summary: "价格形态事件；不声明额外 event.params。",
      parameters: [],
    };
  }
  return {
    optionId: eventType,
    eventType,
    displayName: "自定义事件",
    summary: "自定义事件；必须显式声明 event.params.eventCode。",
    parameters: [CUSTOM_EVENT_CODE_PARAMETER],
  };
});

const EVENT_SUMMARY: AuthoringSlotSummary = {
  slotId: "EVENT",
  label: "事件",
  question: "什么事件触发观察窗口？",
  visibility: "PRIMARY",
  options: EVENT_OPTION_SPECS.map(optionSummary),
};

function findEventOption(optionId: string): EventOptionSpec | null {
  return EVENT_OPTION_SPECS.find((option) => option.optionId === optionId) ?? null;
}

function eventParameters(
  event: UnknownRecord,
  option: EventOptionSpec,
): Readonly<Record<string, StrategyPresetParameterValue>> | null {
  const params = isRecord(event.params) ? event.params : {};
  for (const declaration of option.parameters) {
    if (!hasOwn(params, declaration.code)) return null;
  }
  const provided: Record<string, StrategyPresetParameterValue> = {};
  for (const declaration of option.parameters) {
    const value = params[declaration.code];
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      provided[declaration.code] = value;
    } else {
      return null;
    }
  }
  const resolved = resolveParameterValues(option.parameters, provided, `EVENT/${option.optionId}`);
  return resolved.issues.length > 0 ? null : resolved.values;
}

function eventRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  if (!isRecord(target.definition) || !isRecord(target.definition.entry) || !isRecord(target.definition.entry.event)) {
    return unknownRecognition("EVENT", EVENT_MANAGED_PATHS);
  }
  const event = target.definition.entry.event;
  if (!isOneOf(event.type, STRATEGY_EVENT_TYPES)) return unknownRecognition("EVENT", EVENT_MANAGED_PATHS);
  const option = findEventOption(event.type);
  if (option === null) return unknownRecognition("EVENT", EVENT_MANAGED_PATHS);
  const parameters = eventParameters(event, option);
  if (parameters === null) return unknownRecognition("EVENT", EVENT_MANAGED_PATHS);
  return {
    group: "SELECTION",
    slotId: "EVENT",
    optionId: option.optionId,
    parameters,
    atDefaults: defaultsMatch(parameters, option.parameters),
    managedPaths: EVENT_MANAGED_PATHS,
  };
}

function applyEvent(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "EVENT") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: SELECTION/${slotId}`]);
  }
  const option = findEventOption(optionId);
  if (option === null) {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: SELECTION/${slotId}/${optionId}`]);
  }
  if (!isRecord(target.definition) || !isRecord(target.definition.entry) || !isRecord(target.definition.entry.event)) {
    return issueResult(target, ["AUTHORING_ENTRY_EVENT_INVALID: definition.entry.event 必须是对象"]);
  }
  const resolved = resolveParameterValues(option.parameters, parameters, `SELECTION/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);

  const event = target.definition.entry.event;
  const nextParams: UnknownRecord = isRecord(event.params) ? { ...event.params } : {};
  for (const code of EVENT_OWNED_PARAMETER_CODES) delete nextParams[code];
  for (const declaration of option.parameters) nextParams[declaration.code] = resolved.values[declaration.code];

  const nextEvent: UnknownRecord = { ...event, type: option.eventType };
  if (isRecord(event.params) || Object.keys(nextParams).length > 0) nextEvent.params = nextParams;
  else delete nextEvent.params;

  return {
    ...target,
    definition: {
      ...target.definition,
      entry: {
        ...target.definition.entry,
        event: nextEvent,
      },
    },
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// OBSERVATION
// ---------------------------------------------------------------------------

const OBSERVATION_MANAGED_PATHS = ["definition.entry.observationWindow"] as const;

interface ObservationOptionSpec {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly parameters: readonly StrategyPresetParameter[];
  readonly fixed: { readonly start: number; readonly end: number; readonly unit: StrategyWindowUnit } | null;
}

const CUSTOM_WINDOW_PARAMETERS: readonly StrategyPresetParameter[] = [
  numberParameter({
    code: "start",
    label: "窗口起点",
    description: "相对事件日的起点，1 = T+1。",
    path: "entry.observationWindow.start",
    defaultValue: 2,
    min: 1,
    max: 200,
    step: 1,
  }),
  numberParameter({
    code: "end",
    label: "窗口终点",
    description: "相对事件日的终点，含端点。",
    path: "entry.observationWindow.end",
    defaultValue: 8,
    min: 1,
    max: 200,
    step: 1,
  }),
  stringParameter({
    code: "unit",
    label: "窗口单位",
    description: "观察窗口按交易日或自然日计。",
    path: "entry.observationWindow.unit",
    defaultValue: "TRADING_DAY",
    allowedValues: STRATEGY_WINDOW_UNITS,
    optionLabels: { TRADING_DAY: "交易日", CALENDAR_DAY: "自然日" },
  }),
];

const OBSERVATION_OPTION_SPECS: readonly ObservationOptionSpec[] = [
  { optionId: "t-plus-1-to-5", displayName: "T+1 ~ T+5", summary: "观察事件后前 5 个交易日。", parameters: [], fixed: { start: 1, end: 5, unit: "TRADING_DAY" } },
  { optionId: "t-plus-1-to-10", displayName: "T+1 ~ T+10", summary: "观察事件后前 10 个交易日。", parameters: [], fixed: { start: 1, end: 10, unit: "TRADING_DAY" } },
  { optionId: "t-plus-2-to-5", displayName: "T+2 ~ T+5", summary: "跳过 T+1，观察 T+2 至 T+5。", parameters: [], fixed: { start: 2, end: 5, unit: "TRADING_DAY" } },
  { optionId: "custom", displayName: "自定义窗口", summary: "显式声明 start / end / unit。", parameters: CUSTOM_WINDOW_PARAMETERS, fixed: null },
];

const OBSERVATION_SUMMARY: AuthoringSlotSummary = {
  slotId: "OBSERVATION",
  label: "观察窗口",
  question: "事件后观察多久？",
  visibility: "PRIMARY",
  options: OBSERVATION_OPTION_SPECS.map(optionSummary),
};

function findObservationOption(optionId: string): ObservationOptionSpec | null {
  return OBSERVATION_OPTION_SPECS.find((option) => option.optionId === optionId) ?? null;
}

function isWindowUnit(value: unknown): value is StrategyWindowUnit {
  return isOneOf(value, STRATEGY_WINDOW_UNITS);
}

function isValidWindowShape(value: unknown): value is UnknownRecord & {
  readonly start: number;
  readonly end: number;
  readonly unit: StrategyWindowUnit;
} {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.start)
    && Number.isInteger(value.end)
    && typeof value.start === "number"
    && typeof value.end === "number"
    && value.start >= 1
    && value.end >= value.start
    && isWindowUnit(value.unit);
}

function observationRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  if (!isRecord(target.definition) || !isRecord(target.definition.entry)) {
    return unknownRecognition("OBSERVATION", OBSERVATION_MANAGED_PATHS);
  }
  const window = target.definition.entry.observationWindow;
  if (!isValidWindowShape(window)) return unknownRecognition("OBSERVATION", OBSERVATION_MANAGED_PATHS);
  const preset = OBSERVATION_OPTION_SPECS.find((option) =>
    option.fixed !== null
    && option.fixed.start === window.start
    && option.fixed.end === window.end
    && option.fixed.unit === window.unit);
  if (preset !== undefined) {
    return {
      group: "SELECTION",
      slotId: "OBSERVATION",
      optionId: preset.optionId,
      parameters: {},
      atDefaults: true,
      managedPaths: OBSERVATION_MANAGED_PATHS,
    };
  }
  return {
    group: "SELECTION",
    slotId: "OBSERVATION",
    optionId: "custom",
    parameters: { start: window.start, end: window.end, unit: window.unit },
    atDefaults: false,
    managedPaths: OBSERVATION_MANAGED_PATHS,
  };
}

function applyObservation(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "OBSERVATION") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: SELECTION/${slotId}`]);
  }
  const option = findObservationOption(optionId);
  if (option === null) {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: SELECTION/${slotId}/${optionId}`]);
  }
  if (!isRecord(target.definition) || !isRecord(target.definition.entry)) {
    return issueResult(target, ["AUTHORING_ENTRY_INVALID: definition.entry 必须是对象"]);
  }
  const resolved = resolveParameterValues(option.parameters, parameters, `SELECTION/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);

  const start = option.fixed?.start ?? resolved.values.start;
  const end = option.fixed?.end ?? resolved.values.end;
  const unit = option.fixed?.unit ?? resolved.values.unit;
  const nextWindow: UnknownRecord = {
    ...(isRecord(target.definition.entry.observationWindow) ? target.definition.entry.observationWindow : {}),
    start,
    end,
    unit,
  };
  if (!isValidWindowShape(nextWindow)) {
    return issueResult(target, [`AUTHORING_OBSERVATION_WINDOW_INVALID: SELECTION/${slotId}/${optionId}`]);
  }
  return {
    ...target,
    definition: {
      ...target.definition,
      entry: {
        ...target.definition.entry,
        observationWindow: nextWindow,
      },
    },
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// TRIGGER
// ---------------------------------------------------------------------------

const TRIGGER_MANAGED_PATHS = ["definition.entry.trigger.type"] as const;

const TRIGGER_DISPLAY_NAMES: Readonly<Record<StrategyTriggerType, string>> = {
  FIRST_VALID_DAY: "首个有效日",
  LAST_VALID_DAY: "最后有效日",
  EVERY_VALID_DAY: "每个有效日",
  NEXT_TRADING_DAY: "下一交易日",
  FIRST_LIMIT_POOL: "首板股票池",
};

const TRIGGER_OPTION_SPECS = STRATEGY_TRIGGER_TYPES.map((triggerType) => ({
  optionId: triggerType,
  triggerType,
  displayName: TRIGGER_DISPLAY_NAMES[triggerType],
  summary: `触发类型 ${triggerType}；不修改 trigger.params / description。`,
  parameters: [] as readonly StrategyPresetParameter[],
}));

const TRIGGER_SUMMARY: AuthoringSlotSummary = {
  slotId: "TRIGGER",
  label: "触发时点",
  question: "条件满足后何时产生信号？",
  visibility: "MORE",
  options: TRIGGER_OPTION_SPECS.map(optionSummary),
};

function findTriggerOption(optionId: string): (typeof TRIGGER_OPTION_SPECS)[number] | null {
  return TRIGGER_OPTION_SPECS.find((option) => option.optionId === optionId) ?? null;
}

function triggerRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  if (!isRecord(target.definition) || !isRecord(target.definition.entry) || !isRecord(target.definition.entry.trigger)) {
    return unknownRecognition("TRIGGER", TRIGGER_MANAGED_PATHS);
  }
  const trigger = target.definition.entry.trigger;
  if (!isOneOf(trigger.type, STRATEGY_TRIGGER_TYPES)) return unknownRecognition("TRIGGER", TRIGGER_MANAGED_PATHS);
  return {
    group: "SELECTION",
    slotId: "TRIGGER",
    optionId: trigger.type,
    parameters: {},
    atDefaults: true,
    managedPaths: TRIGGER_MANAGED_PATHS,
  };
}

function applyTrigger(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "TRIGGER") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: SELECTION/${slotId}`]);
  }
  const option = findTriggerOption(optionId);
  if (option === null) {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: SELECTION/${slotId}/${optionId}`]);
  }
  if (!isRecord(target.definition) || !isRecord(target.definition.entry) || !isRecord(target.definition.entry.trigger)) {
    return issueResult(target, ["AUTHORING_ENTRY_TRIGGER_INVALID: definition.entry.trigger 必须是对象"]);
  }
  const resolved = resolveParameterValues(option.parameters, parameters, `SELECTION/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);
  return {
    ...target,
    definition: {
      ...target.definition,
      entry: {
        ...target.definition.entry,
        trigger: { ...target.definition.entry.trigger, type: option.triggerType },
      },
    },
    issues: [],
  };
}

const SELECTION_SUMMARIES: readonly AuthoringSlotSummary[] = [
  SIGNAL_RECIPE_SUMMARY,
  EVENT_SUMMARY,
  OBSERVATION_SUMMARY,
  TRIGGER_SUMMARY,
];

const SELECTION_SLOT_IDS = SELECTION_SUMMARIES.map((slot) => slot.slotId);

function selectionRecognition(target: AuthoringTarget): readonly AuthoringRecognitionItem[] {
  return [
    signalRecipeRecognition(target),
    eventRecognition(target),
    observationRecognition(target),
    triggerRecognition(target),
  ];
}

function applySelectionSlot(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId === "SIGNAL_RECIPE") return applySignalRecipe(target, slotId, optionId, parameters);
  if (slotId === "EVENT") return applyEvent(target, slotId, optionId, parameters);
  if (slotId === "OBSERVATION") return applyObservation(target, slotId, optionId, parameters);
  if (slotId === "TRIGGER") return applyTrigger(target, slotId, optionId, parameters);
  return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: SELECTION/${slotId}`]);
}

export const selectionAuthoringSlotHandler: AuthoringSlotHandler = {
  group: "SELECTION",
  label: "选股",
  summaries: SELECTION_SUMMARIES,
  slotIds: SELECTION_SLOT_IDS,
  recognize: selectionRecognition,
  apply: applySelectionSlot,
};

export const SELECTION_AUTHORING_SLOT_HANDLERS: readonly AuthoringSlotHandler[] = [
  selectionAuthoringSlotHandler,
];
