/**
 * POSITION / COST —— 通用 AuthoringSlot handler。
 *
 * 本模块只把已经存在的 `POSITION_PRESETS` / `COST_SLOT_PRESETS` 语义暴露为服务端槽：
 *   - 前端只提交 slotId / optionId / parameters；
 *   - 本模块负责校验、精确识别和服务端物化；
 *   - apply 只覆盖该槽拥有的字段，其余 definition / executionAssumptions 原样保留。
 *
 * 🔴 这里不使用客户端 FIELD_PATCH 路径，也不把 maxExposure / maxSinglePosition /
 *    slippageModel / commissionModel 等无真实执行消费者字段暴露为可编辑槽。
 */
import {
  STRATEGY_EXECUTION_TIMINGS,
  STRATEGY_POSITION_SIZING_METHODS,
  STRATEGY_PRICE_TYPES,
  STRATEGY_SIGNAL_TIMINGS,
  type StrategyExecutionTiming,
  type StrategyPositionSizingMethod,
  type StrategyPriceType,
  type StrategySignalTiming,
} from "../strategySchema/definition";
import {
  COST_SLOT_PRESETS,
  POSITION_PRESETS,
  type FieldPatchStrategyPreset,
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

function requiredNumber(record: Readonly<Record<string, unknown>>, key: string, context: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`AUTHORING_PRESET_INVALID: ${context}.${key} 必须是有限数字`);
  }
  return value;
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`AUTHORING_PRESET_INVALID: ${context}.${key} 必须是非空字符串`);
  }
  return value;
}

function payloadSection(
  preset: FieldPatchStrategyPreset,
  section: string,
): Readonly<Record<string, unknown>> {
  const value = preset.payload[section];
  if (!isRecord(value)) {
    throw new Error(`AUTHORING_PRESET_INVALID: ${preset.presetId} 缺少 ${section} 段`);
  }
  return value;
}

function presetById(presetId: string, pool: readonly FieldPatchStrategyPreset[]): FieldPatchStrategyPreset {
  const found = pool.find((preset) => preset.presetId === presetId);
  if (found === undefined) throw new Error(`AUTHORING_PRESET_MISSING: ${presetId}`);
  return found;
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
  readonly allowedValues: readonly string[];
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
    allowedValues: [...input.allowedValues],
    ...(input.optionLabels === undefined ? {} : { optionLabels: input.optionLabels }),
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
// POSITION 槽
// ---------------------------------------------------------------------------

interface PositionSizingOptionSpec {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly sizingMethod: StrategyPositionSizingMethod;
  readonly parameters: readonly StrategyPresetParameter[];
}

const POSITION_SIZING_PRESET_IDS: readonly { readonly optionId: string; readonly presetId: string }[] = [
  { optionId: "fixed-ratio-20", presetId: "position:fixed-ratio-20-max5" },
  { optionId: "equal-weight", presetId: "position:equal-weight-max5" },
  { optionId: "fixed-amount-100k", presetId: "position:fixed-amount-100k-max3" },
  { optionId: "equity-ratio-10", presetId: "position:equity-ratio-10-max10" },
];

const POSITION_SIZING_OPTION_SPECS: readonly PositionSizingOptionSpec[] = POSITION_SIZING_PRESET_IDS.map((ref) => {
  const preset = presetById(ref.presetId, POSITION_PRESETS);
  const position = payloadSection(preset, "position");
  const sizingMethod = requiredString(position, "sizingMethod", preset.presetId);
  if (!isOneOf(sizingMethod, STRATEGY_POSITION_SIZING_METHODS)) {
    throw new Error(`AUTHORING_PRESET_INVALID: ${preset.presetId}.position.sizingMethod=${sizingMethod}`);
  }
  return {
    optionId: ref.optionId,
    displayName: preset.displayName,
    summary: preset.summary,
    sizingMethod,
    parameters: preset.parameters.filter((parameter) =>
      parameter.code === "positionRatio" || parameter.code === "fixedAmount"),
  };
});
const POSITION_SLOT_SUMMARIES: readonly AuthoringSlotSummary[] = [
  {
    slotId: "POSITION_SIZING",
    label: "仓位方式",
    question: "每笔买多少？",
    visibility: "PRIMARY",
    options: POSITION_SIZING_OPTION_SPECS.map(optionSummary),
  },
  {
    slotId: "MAX_POSITIONS",
    label: "最多同时持有",
    question: "最多同时持有多只？",
    visibility: "MORE",
    options: [{
      optionId: "max-positions",
      displayName: "最多同时持有",
      summary: "只写 definition.position.maxPositions 与回测配置 maxPositions，两者保持一致。",
      parameters: [numberParameter({
        code: "maxPositions",
        label: "最多同时持有",
        description: "最多同时拿几只；会双写到策略定义与回测配置。",
        path: "position.maxPositions",
        defaultValue: 5,
        unit: "COUNT",
        min: 1,
        max: 50,
        step: 1,
      })],
    }],
  },
];

// ---------------------------------------------------------------------------
// COST 槽
// ---------------------------------------------------------------------------

const COST_MODEL_PARAMETER_CODES = [
  "initialCapital",
  "commissionRate",
  "stampDutyRate",
  "transferFeeRate",
  "slippageBps",
  "lotSize",
  "minCommission",
] as const;

const COST_SIGNATURE_CODES = [
  "commissionRate",
  "stampDutyRate",
  "transferFeeRate",
  "slippageBps",
  "lotSize",
  "minCommission",
] as const;

interface CostModelOptionSpec {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly parameters: readonly StrategyPresetParameter[];
  readonly costValues: Readonly<Record<string, number>>;
  readonly executionTiming: string;
}

const COST_MODEL_PRESET_IDS: readonly { readonly optionId: string; readonly presetId: string }[] = [
  { optionId: "a-share-standard-open-1m", presetId: "cost:a-share-standard-open-1m" },
  { optionId: "a-share-standard-close-1m", presetId: "cost:a-share-standard-close-1m" },
  { optionId: "zero-cost-open-1m", presetId: "cost:zero-cost-open-1m" },
  { optionId: "high-slippage-30bp-1m", presetId: "cost:high-slippage-30bp-1m" },
];

const COST_MODEL_OPTION_SPECS: readonly CostModelOptionSpec[] = COST_MODEL_PRESET_IDS.map((ref) => {
  const preset = presetById(ref.presetId, COST_SLOT_PRESETS);
  const cost = payloadSection(preset, "cost");
  const execution = payloadSection(preset, "execution");
  const costValues: Record<string, number> = {};
  for (const code of COST_MODEL_PARAMETER_CODES) {
    costValues[code] = requiredNumber(cost, code, `${preset.presetId}.cost`);
  }
  return {
    optionId: ref.optionId,
    displayName: preset.displayName,
    summary: preset.summary,
    parameters: preset.parameters.filter((parameter) =>
      (COST_MODEL_PARAMETER_CODES as readonly string[]).includes(parameter.code)),
    costValues,
    executionTiming: requiredString(execution, "executionTiming", `${preset.presetId}.execution`),
  };
});

interface ExecutionTimingOptionSpec {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly defaults: Readonly<{ signalTiming: StrategySignalTiming; executionTiming: StrategyExecutionTiming }>;
  readonly parameters: readonly StrategyPresetParameter[];
}

function executionTimingParameters(
  defaults: Readonly<{ signalTiming: StrategySignalTiming; executionTiming: StrategyExecutionTiming }>,
): readonly StrategyPresetParameter[] {
  return [
    stringParameter({
      code: "signalTiming",
      label: "信号时点",
      description: "信号在哪个 bar 判定。",
      path: "execution.signalTiming",
      defaultValue: defaults.signalTiming,
      allowedValues: STRATEGY_SIGNAL_TIMINGS,
      optionLabels: { T_OPEN: "T 日开盘", T_CLOSE: "T 日收盘" },
    }),
    stringParameter({
      code: "executionTiming",
      label: "成交时点",
      description: "相对信号 bar 的哪一根成交。",
      path: "execution.executionTiming",
      defaultValue: defaults.executionTiming,
      allowedValues: STRATEGY_EXECUTION_TIMINGS,
      optionLabels: {
        T_CLOSE: "T 日收盘",
        T_PLUS_1_OPEN: "T+1 开盘",
        T_PLUS_1_CLOSE: "T+1 收盘",
        T_PLUS_2_OPEN: "T+2 开盘",
      },
    }),
  ];
}

const EXECUTION_TIMING_OPTION_SPECS: readonly ExecutionTimingOptionSpec[] = [
  {
    optionId: "t-close-to-t-plus-1-open",
    displayName: "T 日收盘 → T+1 开盘",
    summary: "T 日收盘出信号，下一交易日开盘成交。",
    defaults: { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN" },
    parameters: executionTimingParameters({ signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_OPEN" }),
  },
  {
    optionId: "t-close-to-t-plus-1-close",
    displayName: "T 日收盘 → T+1 收盘",
    summary: "T 日收盘出信号，下一交易日收盘成交。",
    defaults: { signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_CLOSE" },
    parameters: executionTimingParameters({ signalTiming: "T_CLOSE", executionTiming: "T_PLUS_1_CLOSE" }),
  },
];

const PRICE_TYPE_PARAMETERS: readonly StrategyPresetParameter[] = [
  stringParameter({
    code: "priceType",
    label: "成交价格类型",
    description: "用哪根 bar 的哪个价成交。",
    path: "execution.priceType",
    defaultValue: "OPEN",
    allowedValues: STRATEGY_PRICE_TYPES,
    optionLabels: {
      OPEN: "开盘价",
      CLOSE: "收盘价",
      HIGH: "最高价",
      LOW: "最低价",
      VWAP: "均价（VWAP）",
    },
  }),
];

const COST_SLOT_SUMMARIES: readonly AuthoringSlotSummary[] = [
  {
    slotId: "COST_MODEL",
    label: "成本模型",
    question: "手续费、滑点和初始资金是多少？",
    visibility: "PRIMARY",
    options: COST_MODEL_OPTION_SPECS.map(optionSummary),
  },
  {
    slotId: "EXECUTION_TIMING",
    label: "信号与成交时点",
    question: "什么时候出信号、什么时候成交？",
    visibility: "MORE",
    options: EXECUTION_TIMING_OPTION_SPECS.map(optionSummary),
  },
  {
    slotId: "PRICE_TYPE",
    label: "成交价格类型",
    question: "用哪根价格成交？",
    visibility: "MORE",
    options: [{
      optionId: "price-type",
      displayName: "按价格类型成交",
      summary: "只修改 definition.execution.priceType；其它执行字段保持原样。",
      parameters: PRICE_TYPE_PARAMETERS,
    }],
  },
];

const POSITION_SLOT_IDS = ["POSITION_SIZING", "MAX_POSITIONS"] as const;
const COST_SLOT_IDS = ["COST_MODEL", "EXECUTION_TIMING", "PRICE_TYPE"] as const;
// ---------------------------------------------------------------------------
// 识别
// ---------------------------------------------------------------------------

function unknownRecognition(
  group: "POSITION" | "COST",
  slotId: string,
  managedPaths: readonly string[],
): AuthoringRecognitionItem {
  return { group, slotId, optionId: null, parameters: {}, atDefaults: false, managedPaths };
}

function positionRecord(target: AuthoringTarget): UnknownRecord | null {
  if (!isRecord(target.definition) || !isRecord(target.definition.position)) return null;
  return target.definition.position;
}

function executionRecord(target: AuthoringTarget): UnknownRecord | null {
  if (!isRecord(target.definition) || !isRecord(target.definition.execution)) return null;
  return target.definition.execution;
}

function defaultParametersMatch(
  parameters: Readonly<Record<string, StrategyPresetParameterValue>>,
  declarations: readonly StrategyPresetParameter[],
): boolean {
  return declarations.every((declaration) =>
    parameters[declaration.code] === undefined || parameters[declaration.code] === declaration.defaultValue);
}

function positionSizingRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  const managedPaths = ["position.sizingMethod", "position.positionRatio", "position.fixedAmount"] as const;
  const position = positionRecord(target);
  if (position === null || typeof position.sizingMethod !== "string") {
    return unknownRecognition("POSITION", "POSITION_SIZING", managedPaths);
  }
  const option = POSITION_SIZING_OPTION_SPECS.find((candidate) => candidate.sizingMethod === position.sizingMethod);
  if (option === undefined) return unknownRecognition("POSITION", "POSITION_SIZING", managedPaths);

  const parameters: Record<string, StrategyPresetParameterValue> = {};
  for (const declaration of option.parameters) {
    const value = position[declaration.code];
    if (declaration.valueType === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return unknownRecognition("POSITION", "POSITION_SIZING", managedPaths);
      }
      parameters[declaration.code] = value;
    }
  }
  return {
    group: "POSITION",
    slotId: "POSITION_SIZING",
    optionId: option.optionId,
    parameters,
    atDefaults: defaultParametersMatch(parameters, option.parameters),
    managedPaths,
  };
}

function maxPositionsRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  const managedPaths = ["definition.position.maxPositions", "executionAssumptions.backtestConfig.maxPositions"] as const;
  const position = positionRecord(target);
  const execution = isRecord(target.executionAssumptions) ? target.executionAssumptions : null;
  const backtest = execution !== null && isRecord(execution.backtestConfig) ? execution.backtestConfig : null;
  const positionValue = position?.maxPositions;
  const backtestValue = backtest?.maxPositions;
  if (
    typeof positionValue !== "number"
    || typeof backtestValue !== "number"
    || !Number.isInteger(positionValue)
    || !Number.isInteger(backtestValue)
    || positionValue < 1
    || positionValue > 50
    || positionValue !== backtestValue
  ) {
    return unknownRecognition("POSITION", "MAX_POSITIONS", managedPaths);
  }
  const parameters: Record<string, StrategyPresetParameterValue> = { maxPositions: positionValue };
  return {
    group: "POSITION",
    slotId: "MAX_POSITIONS",
    optionId: "max-positions",
    parameters,
    atDefaults: positionValue === 5,
    managedPaths,
  };
}

function costOptionMatches(
  option: CostModelOptionSpec,
  snapshot: Readonly<Record<string, number>>,
): boolean {
  return COST_SIGNATURE_CODES.every((code) => snapshot[code] === option.costValues[code]);
}

function costModelRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  const managedPaths = COST_MODEL_PARAMETER_CODES.map((code) =>
    code === "initialCapital" ? "executionAssumptions.backtestConfig.initialCapital" : `executionAssumptions.costModel.${code}`);
  const executionAssumptions = isRecord(target.executionAssumptions) ? target.executionAssumptions : null;
  const costModel = executionAssumptions !== null && isRecord(executionAssumptions.costModel)
    ? executionAssumptions.costModel : null;
  const backtestConfig = executionAssumptions !== null && isRecord(executionAssumptions.backtestConfig)
    ? executionAssumptions.backtestConfig : null;
  if (costModel === null || backtestConfig === null) {
    return unknownRecognition("COST", "COST_MODEL", managedPaths);
  }

  const snapshot: Record<string, number> = {};
  for (const code of COST_MODEL_PARAMETER_CODES) {
    const source = code === "initialCapital" ? backtestConfig : costModel;
    const value = source[code];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return unknownRecognition("COST", "COST_MODEL", managedPaths);
    }
    snapshot[code] = value;
  }
  if (snapshot.initialCapital <= 0 || snapshot.lotSize <= 0) {
    return unknownRecognition("COST", "COST_MODEL", managedPaths);
  }

  const execution = executionRecord(target);
  const executionTiming = execution !== null && typeof execution.executionTiming === "string"
    ? execution.executionTiming : undefined;
  const candidates = COST_MODEL_OPTION_SPECS.filter((option) => costOptionMatches(option, snapshot));
  if (candidates.length === 0) return unknownRecognition("COST", "COST_MODEL", managedPaths);
  const option = candidates.find((candidate) => candidate.executionTiming === executionTiming) ?? candidates[0];

  return {
    group: "COST",
    slotId: "COST_MODEL",
    optionId: option.optionId,
    parameters: snapshot,
    atDefaults: defaultParametersMatch(snapshot, option.parameters),
    managedPaths,
  };
}

function executionTimingRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  const managedPaths = ["definition.execution.signalTiming", "definition.execution.executionTiming"] as const;
  const execution = executionRecord(target);
  if (execution === null) return unknownRecognition("COST", "EXECUTION_TIMING", managedPaths);
  const signalTiming = execution.signalTiming;
  const executionTiming = execution.executionTiming;
  if (!isOneOf(signalTiming, STRATEGY_SIGNAL_TIMINGS) || !isOneOf(executionTiming, STRATEGY_EXECUTION_TIMINGS)) {
    return unknownRecognition("COST", "EXECUTION_TIMING", managedPaths);
  }
  const option = EXECUTION_TIMING_OPTION_SPECS.find((candidate) => candidate.defaults.executionTiming === executionTiming);
  if (option === undefined) return unknownRecognition("COST", "EXECUTION_TIMING", managedPaths);
  const parameters: Record<string, StrategyPresetParameterValue> = { signalTiming, executionTiming };
  return {
    group: "COST",
    slotId: "EXECUTION_TIMING",
    optionId: option.optionId,
    parameters,
    atDefaults: defaultParametersMatch(parameters, option.parameters),
    managedPaths,
  };
}

function priceTypeRecognition(target: AuthoringTarget): AuthoringRecognitionItem {
  const managedPaths = ["definition.execution.priceType"] as const;
  const execution = executionRecord(target);
  const priceType = execution?.priceType;
  if (!isOneOf(priceType, STRATEGY_PRICE_TYPES)) {
    return unknownRecognition("COST", "PRICE_TYPE", managedPaths);
  }
  const parameters: Record<string, StrategyPresetParameterValue> = { priceType };
  return {
    group: "COST",
    slotId: "PRICE_TYPE",
    optionId: "price-type",
    parameters,
    atDefaults: priceType === "OPEN",
    managedPaths,
  };
}

function positionRecognition(target: AuthoringTarget): readonly AuthoringRecognitionItem[] {
  return [positionSizingRecognition(target), maxPositionsRecognition(target)];
}

function costRecognition(target: AuthoringTarget): readonly AuthoringRecognitionItem[] {
  return [costModelRecognition(target), executionTimingRecognition(target), priceTypeRecognition(target)];
}
// ---------------------------------------------------------------------------
// 应用
// ---------------------------------------------------------------------------

function issueResult(target: AuthoringTarget, issues: readonly string[]): AuthoringApplyResult {
  return { ...target, issues: [...issues] };
}

function findPositionSizingOption(optionId: string): PositionSizingOptionSpec | null {
  return POSITION_SIZING_OPTION_SPECS.find((option) => option.optionId === optionId) ?? null;
}

function findCostModelOption(optionId: string): CostModelOptionSpec | null {
  return COST_MODEL_OPTION_SPECS.find((option) => option.optionId === optionId) ?? null;
}

function findExecutionTimingOption(optionId: string): ExecutionTimingOptionSpec | null {
  return EXECUTION_TIMING_OPTION_SPECS.find((option) => option.optionId === optionId) ?? null;
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
    const hasProvided = Object.prototype.hasOwnProperty.call(provided, declaration.code);
    const value = hasProvided ? provided[declaration.code] : declaration.defaultValue;
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

function applyPositionSizing(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "POSITION_SIZING") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: POSITION/${slotId}`]);
  }
  const option = findPositionSizingOption(optionId);
  if (option === null) {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: POSITION/${slotId}/${optionId}`]);
  }
  if (!isRecord(target.definition) || !isRecord(target.definition.position)) {
    return issueResult(target, ["AUTHORING_POSITION_INVALID: definition.position 必须是对象"]);
  }
  const resolved = resolveParameterValues(option.parameters, parameters, `POSITION/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);

  const nextPosition: UnknownRecord = { ...target.definition.position };
  nextPosition.sizingMethod = option.sizingMethod;
  if (option.sizingMethod === "FIXED_AMOUNT") {
    nextPosition.fixedAmount = resolved.values.fixedAmount;
    delete nextPosition.positionRatio;
  } else if (option.sizingMethod === "FIXED_RATIO" || option.sizingMethod === "EQUITY_RATIO") {
    nextPosition.positionRatio = resolved.values.positionRatio;
    delete nextPosition.fixedAmount;
  } else {
    delete nextPosition.positionRatio;
    delete nextPosition.fixedAmount;
  }
  return {
    ...target,
    definition: { ...target.definition, position: nextPosition },
    issues: [],
  };
}

function applyMaxPositions(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "MAX_POSITIONS") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: POSITION/${slotId}`]);
  }
  if (optionId !== "max-positions") {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: POSITION/${slotId}/${optionId}`]);
  }
  if (!isRecord(target.definition) || !isRecord(target.definition.position)) {
    return issueResult(target, ["AUTHORING_POSITION_INVALID: definition.position 必须是对象"]);
  }
  const executionAssumptions = target.executionAssumptions === null || target.executionAssumptions === undefined
    ? {}
    : isRecord(target.executionAssumptions) ? target.executionAssumptions : null;
  if (executionAssumptions === null) {
    return issueResult(target, ["AUTHORING_EXECUTION_ASSUMPTIONS_INVALID: executionAssumptions 必须是对象"]);
  }
  const backtestConfig = isRecord(executionAssumptions.backtestConfig) ? executionAssumptions.backtestConfig : {};
  const declarations = POSITION_SLOT_SUMMARIES[1]!.options[0]!.parameters;
  const resolved = resolveParameterValues(declarations, parameters, `POSITION/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);
  const maxPositions = resolved.values.maxPositions;
  if (typeof maxPositions !== "number" || !Number.isInteger(maxPositions)) {
    return issueResult(target, [`AUTHORING_PARAMETER_TYPE: POSITION/${slotId}/${optionId}/maxPositions 必须是整数`]);
  }

  return {
    ...target,
    definition: {
      ...target.definition,
      position: { ...target.definition.position, maxPositions },
    },
    executionAssumptions: {
      ...executionAssumptions,
      backtestConfig: { ...backtestConfig, maxPositions },
    },
    issues: [],
  };
}

function applyCostModel(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "COST_MODEL") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: COST/${slotId}`]);
  }
  const option = findCostModelOption(optionId);
  if (option === null) {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: COST/${slotId}/${optionId}`]);
  }
  const executionAssumptions = target.executionAssumptions === null || target.executionAssumptions === undefined
    ? {}
    : isRecord(target.executionAssumptions) ? target.executionAssumptions : null;
  if (executionAssumptions === null) {
    return issueResult(target, ["AUTHORING_EXECUTION_ASSUMPTIONS_INVALID: executionAssumptions 必须是对象"]);
  }
  const resolved = resolveParameterValues(option.parameters, parameters, `COST/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);

  const nextCostModel: UnknownRecord = isRecord(executionAssumptions.costModel)
    ? { ...executionAssumptions.costModel }
    : {};
  for (const code of COST_MODEL_PARAMETER_CODES) {
    if (code === "initialCapital") continue;
    nextCostModel[code] = resolved.values[code];
  }
  const backtestConfig = isRecord(executionAssumptions.backtestConfig)
    ? { ...executionAssumptions.backtestConfig }
    : {};
  backtestConfig.initialCapital = resolved.values.initialCapital;
  return {
    ...target,
    executionAssumptions: {
      ...executionAssumptions,
      costModel: nextCostModel,
      backtestConfig,
    },
    issues: [],
  };
}

function applyExecutionTiming(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "EXECUTION_TIMING") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: COST/${slotId}`]);
  }
  const option = findExecutionTimingOption(optionId);
  if (option === null) {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: COST/${slotId}/${optionId}`]);
  }
  if (!isRecord(target.definition) || !isRecord(target.definition.execution)) {
    return issueResult(target, ["AUTHORING_EXECUTION_INVALID: definition.execution 必须是对象"]);
  }
  const resolved = resolveParameterValues(option.parameters, parameters, `COST/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);
  const signalTiming = resolved.values.signalTiming;
  const executionTiming = resolved.values.executionTiming;
  if (signalTiming === "T_CLOSE" && executionTiming === "T_CLOSE") {
    return issueResult(target, ["SIGNAL_EXECUTION_TIMING_CONFLICT: signalTiming=T_CLOSE 时不得同 bar 收盘成交"]);
  }
  return {
    ...target,
    definition: {
      ...target.definition,
      execution: { ...target.definition.execution, signalTiming, executionTiming },
    },
    issues: [],
  };
}

function applyPriceType(
  target: AuthoringTarget,
  slotId: string,
  optionId: string,
  parameters: AuthoringParameters,
): AuthoringApplyResult {
  if (slotId !== "PRICE_TYPE") {
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: COST/${slotId}`]);
  }
  if (optionId !== "price-type") {
    return issueResult(target, [`AUTHORING_OPTION_UNKNOWN: COST/${slotId}/${optionId}`]);
  }
  if (!isRecord(target.definition) || !isRecord(target.definition.execution)) {
    return issueResult(target, ["AUTHORING_EXECUTION_INVALID: definition.execution 必须是对象"]);
  }
  const resolved = resolveParameterValues(PRICE_TYPE_PARAMETERS, parameters, `COST/${slotId}/${optionId}`);
  if (resolved.issues.length > 0) return issueResult(target, resolved.issues);
  return {
    ...target,
    definition: {
      ...target.definition,
      execution: { ...target.definition.execution, priceType: resolved.values.priceType },
    },
    issues: [],
  };
}

export const positionAuthoringSlotHandler: AuthoringSlotHandler = {
  group: "POSITION",
  label: "仓位",
  summaries: POSITION_SLOT_SUMMARIES,
  slotIds: [...POSITION_SLOT_IDS],
  recognize: positionRecognition,
  apply(target, slotId, optionId, parameters) {
    if (slotId === "POSITION_SIZING") return applyPositionSizing(target, slotId, optionId, parameters);
    if (slotId === "MAX_POSITIONS") return applyMaxPositions(target, slotId, optionId, parameters);
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: POSITION/${slotId}`]);
  },
};

export const costAuthoringSlotHandler: AuthoringSlotHandler = {
  group: "COST",
  label: "成本与成交",
  summaries: COST_SLOT_SUMMARIES,
  slotIds: [...COST_SLOT_IDS],
  recognize: costRecognition,
  apply(target, slotId, optionId, parameters) {
    if (slotId === "COST_MODEL") return applyCostModel(target, slotId, optionId, parameters);
    if (slotId === "EXECUTION_TIMING") return applyExecutionTiming(target, slotId, optionId, parameters);
    if (slotId === "PRICE_TYPE") return applyPriceType(target, slotId, optionId, parameters);
    return issueResult(target, [`AUTHORING_SLOT_UNKNOWN: COST/${slotId}`]);
  },
};

export const POSITION_COST_AUTHORING_SLOT_HANDLERS: readonly AuthoringSlotHandler[] = [
  positionAuthoringSlotHandler,
  costAuthoringSlotHandler,
];