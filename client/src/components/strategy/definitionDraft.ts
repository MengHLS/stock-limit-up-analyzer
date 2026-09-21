/**
 * definitionDraft — 策略 **Canonical 定义**（`StrategyDocument.definition`）⇄ 七段草稿的纯函数层。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 定位：把「编辑 v1 兼容视图」换成「编辑 Canonical 定义」，并与研究草图**对齐**
 * ═══════════════════════════════════════════════════════════════════════════
 * 结构照抄研究候选的草图（`research/candidateSketchForm.ts`），因为 `definition` 本来就是
 * 「草图转正后的产物」—— 两者说的是同一件事，界面就没有理由长得不一样：
 *
 *   ① 买什么 → ② 什么条件买 → ③ 什么时候买 → ④ 怎么卖 → ⑤ 买多少 · 最多持几只
 *   → ⑥ 成本与资金 → ⑦ 参数搜索空间
 *
 * 与草图的**唯一**结构差异：草图把 ③⑤⑥ 的内容都塞在 `entryRule.extra` 一个块里，
 * 而定义侧它们本来就是独立字段（`entry` / `position` / `risk` / `execution`）。
 *
 * ## 三条纪律（与草图同源）
 *
 * 1. **草稿 → JSON 只产出后端认得的键**；枚举取值全部来自 `definitionVocabulary`
 *    （本地表 + 对表测试），保存时被拒的取值在这里根本不出现。
 * 2. 🔴 **绝不静默丢数据**。这是本文件与草图**实现方式不同**的地方，值得说清楚：
 *    草图用「整块降级只读 + 原始 JSON 展示」兜底，因为它的块是**整块替换**语义（补丁里
 *    一格 `entryRule` 换一格）。定义侧不是 —— 我们**逐行携带原对象**
 *    （每行草稿都有 `original`，重建时 `{...original, ...本次编辑的键}`）。
 *    ⇒ 表单不编辑的键（`exit.rules[].condition`、`position.parameter`、
 *    `parameters[].derivedFrom`、`conditions[].id`、`description` …）**原样穿过**，
 *    既不用降级成只读，也不可能被静默改写。只有**形状**不是预期的
 *    （如 `entry` 不是对象、`conditions` 不是数组）才整块降级只读。
 * 3. **往返幂等**：`definition → 草稿 → definition` 对同一份可表达输入必须逐字段一致
 *    —— 否则「打开什么都不改就点保存」会平白产生一次写入（后端指纹随之变化）。
 */

import {
  DEFINITION_CONDITION_OPERATOR_OPTIONS,
  DEFINITION_CONDITION_VALUE_TYPE_OPTIONS,
  DEFINITION_COST_MODEL_OPTIONS,
  DEFINITION_EVENT_OPTIONS,
  DEFINITION_EXECUTION_TIMING_OPTIONS,
  DEFINITION_EXIT_RULE_TYPE_OPTIONS,
  DEFINITION_EXIT_THRESHOLD_UNIT_OPTIONS,
  DEFINITION_EXIT_TRIGGER_OPTIONS,
  DEFINITION_PARAMETER_ROLE_OPTIONS,
  DEFINITION_PARAMETER_TYPE_OPTIONS,
  DEFINITION_PRICE_TYPE_OPTIONS,
  DEFINITION_QUANTITY_METHOD_OPTIONS,
  DEFINITION_SIGNAL_TIMING_OPTIONS,
  DEFINITION_SIZING_METHOD_OPTIONS,
  DEFINITION_TRIGGER_OPTIONS,
  DEFINITION_WINDOW_UNIT_OPTIONS,
  definitionOperatorSymbol,
  definitionOptionLabel,
} from "./definitionVocabulary";
import {
  describeCandidateFieldReference,
  parseCandidateFieldReference,
} from "../research/candidateSketchVocabulary";

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** 数值 / 布尔 / 字符串 → 输入框文本；不可表达 ⇒ `null`。 */
function scalarText(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return null;
}

function textToOptionalNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function csvToList(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

// ---------------------------------------------------------------------------
// 枚举白名单（保存前自检；权威判定仍在服务端）
// ---------------------------------------------------------------------------

const OP_VALUES = DEFINITION_CONDITION_OPERATOR_OPTIONS.map((o) => o.value);
const OPERATOR_WITH_LIST = DEFINITION_CONDITION_OPERATOR_OPTIONS.filter((o) => o.arity === "LIST").map(
  (o) => o.value,
);

// ---------------------------------------------------------------------------
// 草稿形态
// ---------------------------------------------------------------------------

export type KeyValueRowType = "string" | "number" | "boolean";

export interface KeyValueRowDraft {
  key: string;
  valueType: KeyValueRowType;
  value: string;
}

/**
 * 一行买入条件。
 *
 * `original` 是**服务端那一行的原对象**：`id` / `description` / 以及本次不编辑的任何键
 * 都靠它原样穿过（见文件头纪律 2）。
 */
export interface ConditionRowDraft {
  original: JsonRecord;
  /** 左值字段引用（`bar.low` / `prefix.rd0.open` / `event.turnover` …）。 */
  field: string;
  operator: string;
  /** 右值的**文本形态**；`IN` / `NOT_IN` 逗号分隔。 */
  value: string;
  valueType: string;
  enabled: boolean;
}

export interface ExitRuleRowDraft {
  original: JsonRecord;
  type: string;
  trigger: string;
  threshold: string;
  thresholdUnit: string;
  priority: string;
  enabled: boolean;
}

export interface ParameterRowDraft {
  original: JsonRecord;
  code: string;
  name: string;
  dataType: string;
  parameterRole: string;
  required: boolean;
  hasDefaultValue: boolean;
  defaultValue: string;
  min: string;
  max: string;
  step: string;
  allowedValuesText: string;
}

/**
 * 只读的数据集绑定行（绑定由 promote / 持久化层写入，本页**不编辑**）。
 *
 * `original` 是那一行的原对象：重建时**原样放回** ⇒ 页面上看不到的键（`note` 等）也不会丢。
 */
export interface DatasetRowDraft {
  original: JsonRecord;
  role: string;
  datasetId: string;
  datasetVersion: string;
  datasetVersionId: string;
}

export interface EventDraft {
  original: JsonRecord;
  type: string;
  params: KeyValueRowDraft[];
  /** `event.params` 不是「标量值对象」时为 `false`（⇒ 参数区只读，避免丢键）。 */
  paramsExpressible: boolean;
}

export interface WindowDraft {
  original: JsonRecord;
  start: string;
  end: string;
  unit: string;
}

export interface TriggerDraft {
  original: JsonRecord;
  type: string;
  params: KeyValueRowDraft[];
  paramsExpressible: boolean;
}

export interface PositionDraft {
  original: JsonRecord;
  sizingMethod: string;
  maxPositions: string;
  positionRatio: string;
  fixedAmount: string;
  maxExposure: string;
  maxSinglePosition: string;
}

export interface RiskDraft {
  original: JsonRecord;
  stopLoss: string;
  maxDrawdown: string;
  maxExposure: string;
  maxSinglePosition: string;
  maxPositions: string;
  dailyLossLimit: string;
  concentrationLimit: string;
  extensions: KeyValueRowDraft[];
  extensionsExpressible: boolean;
}

export interface ExecutionDraft {
  original: JsonRecord;
  signalTiming: string;
  executionTiming: string;
  priceType: string;
  quantityMethod: string;
  lotSize: string;
  slippageModel: string;
  commissionModel: string;
  constraintsText: string;
}

/**
 * 「成本与资金」草稿 —— 文档级两个对象合在一个块里编辑：
 *   - `costModel`（六项费率）→ `original`
 *   - `backtestConfig`（初始资金 / 回测最大持仓数）→ `backtestOriginal`
 *
 * 🔑 字段**故意与 `research/candidateSketchCostPreset.ts#CostAssumptionValues` 结构同形**
 * （`initialCapital` + `maxPositions` + 六项费率，全是字符串）⇒ 那里的「A 股标准 / 上次用的这套」
 * 一键预设、`matchCostPreset` 命中判定、`formatCostRate` 人话格式化可以**原样复用**
 * （研究草图与策略定义说的是同一套费率，没有理由各写一份）。
 */
export interface CostDraft {
  original: JsonRecord;
  backtestOriginal: JsonRecord;
  initialCapital: string;
  /** ⚠️ 回测配置的 maxPositions，与 `position.maxPositions` **不是**同一个字段。 */
  maxPositions: string;
  commissionRate: string;
  stampDutyRate: string;
  transferFeeRate: string;
  slippageBps: string;
  lotSize: string;
  minCommission: string;
}

export interface DefinitionDrafts {
  /** `definition.schemaVersion`（定义自身结构版本，**不是**策略版本号）。 */
  schemaVersion: string;
  event: EventDraft;
  window: WindowDraft;
  trigger: TriggerDraft;
  conditions: ConditionRowDraft[];
  exitRules: ExitRuleRowDraft[];
  position: PositionDraft;
  risk: RiskDraft;
  execution: ExecutionDraft;
  parameters: ParameterRowDraft[];
  datasets: DatasetRowDraft[];
  cost: CostDraft;
}

/** 整份定义的两种状态：可结构化编辑，或（形状不符）降级只读。 */
export type DefinitionDraftState =
  | { readonly kind: "structured"; readonly drafts: DefinitionDrafts }
  | { readonly kind: "raw"; readonly rawText: string; readonly reason: string };

// ---------------------------------------------------------------------------
// 键白名单（用于识别「表单表达不了的多余键」——只用于提示，不用于删除）
// ---------------------------------------------------------------------------

const EVENT_KEYS = ["type", "params", "description"] as const;
const RISK_EXTENSION_KEYS = [
  "stopLoss",
  "maxDrawdown",
  "maxExposure",
  "maxSinglePosition",
  "maxPositions",
  "dailyLossLimit",
  "concentrationLimit",
  "extensions",
] as const;

/** 该对象里是否存在「表单不编辑的键」（只在界面上提示，绝不删除）。 */
function extraKeysOf(record: JsonRecord, allowed: readonly string[]): string[] {
  return Object.keys(record).filter((key) => record[key] !== undefined && !allowed.includes(key));
}

/** 标量值映射 → 键值行；出现非标量 ⇒ 不可表达。 */
function rowsFromScalarMap(
  value: unknown,
  path: string,
): { ok: true; rows: KeyValueRowDraft[] } | { ok: false; reason: string } {
  const rows: KeyValueRowDraft[] = [];
  for (const key of Object.keys(asRecord(value))) {
    const item = asRecord(value)[key];
    if (item === undefined || item === null) continue;
    if (typeof item === "boolean") rows.push({ key, valueType: "boolean", value: String(item) });
    else if (typeof item === "number") {
      if (!Number.isFinite(item)) return { ok: false, reason: `${path}.${key} 不是有限数字` };
      rows.push({ key, valueType: "number", value: String(item) });
    } else if (typeof item === "string") rows.push({ key, valueType: "string", value: item });
    else return { ok: false, reason: `${path}.${key} 既不是字符串也不是数字/布尔（表单无法表达）` };
  }
  return { ok: true, rows };
}

/** 键值行 → 标量映射（空键行整行丢弃；值留空的行也丢弃）。 */
function scalarMapFromRows(rows: readonly KeyValueRowDraft[]): JsonRecord | undefined {
  const out: JsonRecord = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "") continue;
    const text = row.value.trim();
    if (text === "") continue;
    if (row.valueType === "string") out[key] = row.value;
    else if (row.valueType === "boolean") out[key] = text === "true" || text === "1";
    else {
      const n = Number(text);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

// ---------------------------------------------------------------------------
// definition → 草稿
// ---------------------------------------------------------------------------

const RAW_REASON_PREFIX = "定义的结构与编辑器预期不符";

/** 整份定义 → 草稿；形状不符时返回 `raw`（界面据此只读展示并说明原因）。 */
export function definitionToDrafts(definition: unknown): DefinitionDraftState {
  if (definition === undefined || definition === null) {
    return { kind: "raw", rawText: "", reason: "该版本没有 Canonical 定义（definition 缺失）。" };
  }
  if (!isRecord(definition)) {
    return {
      kind: "raw",
      rawText: JSON.stringify(definition, null, 2),
      reason: `${RAW_REASON_PREFIX}：definition 不是对象。`,
    };
  }
  const entry = definition.entry;
  if (!isRecord(entry)) {
    return {
      kind: "raw",
      rawText: JSON.stringify(definition, null, 2),
      reason: `${RAW_REASON_PREFIX}：definition.entry 不是对象。`,
    };
  }
  if (entry.conditions !== undefined && entry.conditions !== null && !Array.isArray(entry.conditions)) {
    return {
      kind: "raw",
      rawText: JSON.stringify(definition, null, 2),
      reason: `${RAW_REASON_PREFIX}：definition.entry.conditions 不是数组。`,
    };
  }
  const exit = definition.exit;
  if (exit !== undefined && exit !== null && !isRecord(exit)) {
    return {
      kind: "raw",
      rawText: JSON.stringify(definition, null, 2),
      reason: `${RAW_REASON_PREFIX}：definition.exit 不是对象。`,
    };
  }
  if (isRecord(exit) && exit.rules !== undefined && exit.rules !== null && !Array.isArray(exit.rules)) {
    return {
      kind: "raw",
      rawText: JSON.stringify(definition, null, 2),
      reason: `${RAW_REASON_PREFIX}：definition.exit.rules 不是数组。`,
    };
  }
  const parameters = definition.parameters;
  if (parameters !== undefined && parameters !== null && !Array.isArray(parameters)) {
    return {
      kind: "raw",
      rawText: JSON.stringify(definition, null, 2),
      reason: `${RAW_REASON_PREFIX}：definition.parameters 不是数组。`,
    };
  }

  const eventRaw = asRecord(entry.event);
  const eventParams = rowsFromScalarMap(eventRaw.params, "entry.event.params");
  const triggerRaw = asRecord(entry.trigger);
  const triggerParams = rowsFromScalarMap(triggerRaw.params, "entry.trigger.params");
  const position = asRecord(definition.position);
  const risk = asRecord(definition.risk);
  const riskExtensionsParsed = rowsFromScalarMap(risk.extensions, "risk.extensions");
  const execution = asRecord(definition.execution);

  const drafts: DefinitionDrafts = {
    schemaVersion: typeof definition.schemaVersion === "string" ? definition.schemaVersion : "1.0",
    event: {
      original: eventRaw,
      type: typeof eventRaw.type === "string" ? eventRaw.type : "",
      params: eventParams.ok ? eventParams.rows : [],
      paramsExpressible: eventParams.ok,
    },
    window: {
      original: asRecord(entry.observationWindow),
      start: scalarText(asRecord(entry.observationWindow).start) ?? "",
      end: scalarText(asRecord(entry.observationWindow).end) ?? "",
      unit:
        typeof asRecord(entry.observationWindow).unit === "string"
          ? (asRecord(entry.observationWindow).unit as string)
          : "",
    },
    trigger: {
      original: triggerRaw,
      type: typeof triggerRaw.type === "string" ? triggerRaw.type : "",
      params: triggerParams.ok ? triggerParams.rows : [],
      paramsExpressible: triggerParams.ok,
    },
    conditions: asRecords(entry.conditions).map((row) => ({
      original: row,
      field: typeof row.field === "string" ? row.field : "",
      operator: typeof row.operator === "string" ? row.operator : "",
      value: conditionValueText(row.value),
      valueType: typeof row.valueType === "string" ? row.valueType : "CONSTANT",
      enabled: row.enabled !== false,
    })),
    exitRules: asRecords(isRecord(exit) ? exit.rules : []).map((row) => ({
      original: row,
      type: typeof row.type === "string" ? row.type : "",
      trigger: typeof row.trigger === "string" ? row.trigger : "",
      threshold: scalarText(row.threshold) ?? "",
      thresholdUnit: typeof row.thresholdUnit === "string" ? row.thresholdUnit : "",
      priority: scalarText(row.priority) ?? "",
      enabled: row.enabled !== false,
    })),
    position: {
      original: position,
      sizingMethod: typeof position.sizingMethod === "string" ? position.sizingMethod : "",
      maxPositions: scalarText(position.maxPositions) ?? "",
      positionRatio: scalarText(position.positionRatio) ?? "",
      fixedAmount: scalarText(position.fixedAmount) ?? "",
      maxExposure: scalarText(position.maxExposure) ?? "",
      maxSinglePosition: scalarText(position.maxSinglePosition) ?? "",
    },
    risk: {
      original: risk,
      stopLoss: scalarText(risk.stopLoss) ?? "",
      maxDrawdown: scalarText(risk.maxDrawdown) ?? "",
      maxExposure: scalarText(risk.maxExposure) ?? "",
      maxSinglePosition: scalarText(risk.maxSinglePosition) ?? "",
      maxPositions: scalarText(risk.maxPositions) ?? "",
      dailyLossLimit: scalarText(risk.dailyLossLimit) ?? "",
      concentrationLimit: scalarText(risk.concentrationLimit) ?? "",
      extensions: riskExtensionsParsed.ok ? riskExtensionsParsed.rows : [],
      extensionsExpressible: riskExtensionsParsed.ok,
    },
    execution: {
      original: execution,
      signalTiming: typeof execution.signalTiming === "string" ? execution.signalTiming : "",
      executionTiming: typeof execution.executionTiming === "string" ? execution.executionTiming : "",
      priceType: typeof execution.priceType === "string" ? execution.priceType : "",
      quantityMethod: typeof execution.quantityMethod === "string" ? execution.quantityMethod : "",
      lotSize: scalarText(execution.lotSize) ?? "",
      slippageModel: typeof execution.slippageModel === "string" ? execution.slippageModel : "",
      commissionModel: typeof execution.commissionModel === "string" ? execution.commissionModel : "",
      constraintsText: Array.isArray(execution.executionConstraints)
        ? execution.executionConstraints.filter((c): c is string => typeof c === "string").join(",")
        : "",
    },
    parameters: asRecords(parameters).map((row) => ({
      original: row,
      code: typeof row.code === "string" ? row.code : "",
      name: typeof row.name === "string" ? row.name : "",
      dataType: typeof row.dataType === "string" ? row.dataType : "number",
      parameterRole: typeof row.parameterRole === "string" ? row.parameterRole : "TUNABLE",
      required: row.required === true,
      hasDefaultValue: Object.prototype.hasOwnProperty.call(row, "defaultValue"),
      defaultValue: scalarText(row.defaultValue) ?? "",
      min: scalarText(row.min) ?? "",
      max: scalarText(row.max) ?? "",
      step: scalarText(row.step) ?? "",
      allowedValuesText: Array.isArray(row.allowedValues)
        ? row.allowedValues.filter((v): v is string => typeof v === "string").join(",")
        : "",
    })),
    datasets: asRecords(definition.datasets).map((row) => ({
      original: row,
      role: typeof row.role === "string" ? row.role : "",
      datasetId: typeof row.datasetId === "string" ? row.datasetId : "",
      datasetVersion: typeof row.datasetVersion === "string" ? row.datasetVersion : "",
      datasetVersionId: scalarText(row.datasetVersionId) ?? "",
    })),
    // 文档级（`executionAssumptions`）—— 不进 definition，由 withDocumentLevelDrafts 填。
    cost: emptyCostDraft(),
  };

  return { kind: "structured", drafts };
}

/**
 * 成本 / 资金的空草稿。
 *
 * 🔴 字段形状**故意与草图侧的 `CostAssumptionValues` 保持一致**（8 个字符串），
 * 这样 A 股成本预设（`candidateSketchCostPreset.ts`）的 `applyCostPreset` / `matchCostPreset`
 * / `formatCostRate` 可以原样复用，不必为定义编辑器再写一套。
 */
export function emptyCostDraft(): CostDraft {
  return {
    original: {},
    backtestOriginal: {},
    initialCapital: "",
    maxPositions: "",
    commissionRate: "",
    stampDutyRate: "",
    transferFeeRate: "",
    slippageBps: "",
    lotSize: "",
    minCommission: "",
  };
}

// ---------------------------------------------------------------------------
// 空行工厂（编辑器「+ 添加」用）
//
// 纪律与草图一致：**不做语义默认值** —— 留空就是留空，后端会响亮拒绝缺必填。
// 例外只有一个：`operator` / `priority` / `valueType` 这类**结构性**取值必须给合法初值，
// 否则用户刚点「添加」就得到一个立刻报错的行（不是「还没填」，而是「填错了」）。
// ---------------------------------------------------------------------------

/**
 * 一行新的买入条件。
 *
 * `operator` 给的是**服务端名称形**（`GREATER_THAN_OR_EQUAL`）而不是符号 `>=`
 * —— 它是要写进 `definition` 的值，不是一个给人看的标签（见 `definitionVocabulary`）。
 */
export function emptyConditionRow(): ConditionRowDraft {
  return {
    original: {},
    field: "",
    operator: "GREATER_THAN_OR_EQUAL",
    value: "",
    valueType: "CONSTANT",
    enabled: true,
  };
}

/**
 * 一行新的出场规则。
 *
 * 🔴 `priority` 由调用方按「当前已用的最大优先级 + 1」传入 —— 后端要求它是
 * **>= 0 的整数且在同一出场定义内唯一**（`SCHEMA_DEFINITION_EXIT_RULE_PRIORITY_DUPLICATE`），
 * 给一个固定的 0 会让「加第二条出场规则」必然冲突。
 */
export function emptyExitRuleRow(priority: number): ExitRuleRowDraft {
  return {
    original: {},
    type: "",
    trigger: "",
    threshold: "",
    thresholdUnit: "",
    priority: String(priority),
    enabled: true,
  };
}

/** 一行新的待搜索参数。`dataType` 默认 `number`（与草图的参数类型表同一套取值）。 */
export function emptyParameterRow(): ParameterRowDraft {
  return {
    original: {},
    code: "",
    name: "",
    dataType: "number",
    parameterRole: "TUNABLE",
    required: false,
    hasDefaultValue: false,
    defaultValue: "",
    min: "",
    max: "",
    step: "",
    allowedValuesText: "",
  };
}

/** 一行新的键值对（事件参数 / 触发参数 / 风控具名阈值共用）。 */
export function emptyKeyValueRowDraft(): KeyValueRowDraft {
  return { key: "", valueType: "string", value: "" };
}

/** 条件右值 → 文本。数组用逗号连接；非标量 ⇒ `""`（保守，不编造）。 */
function conditionValueText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? String(item) : ""))
      .join(",");
  }
  return scalarText(value) ?? "";
}

/** 文档级成本模型 + 回测配置 → 草稿（与 definition 无关，单独喂给同一份 drafts）。 */
export function withDocumentLevelDrafts(
  state: DefinitionDraftState,
  executionAssumptions: unknown,
): DefinitionDraftState {
  if (state.kind !== "structured") return state;
  const exec = asRecord(executionAssumptions);
  const cost = asRecord(exec.costModel);
  const backtest = asRecord(exec.backtestConfig);
  return {
    kind: "structured",
    drafts: {
      ...state.drafts,
      cost: {
        original: cost,
        backtestOriginal: backtest,
        initialCapital: scalarText(backtest.initialCapital) ?? "",
        maxPositions: scalarText(backtest.maxPositions) ?? "",
        commissionRate: scalarText(cost.commissionRate) ?? "",
        stampDutyRate: scalarText(cost.stampDutyRate) ?? "",
        transferFeeRate: scalarText(cost.transferFeeRate) ?? "",
        slippageBps: scalarText(cost.slippageBps) ?? "",
        lotSize: scalarText(cost.lotSize) ?? "",
        minCommission: scalarText(cost.minCommission) ?? "",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 草稿 → definition
// ---------------------------------------------------------------------------

function optionalNumberField(target: JsonRecord, key: string, text: string): void {
  const value = textToOptionalNumber(text);
  if (value !== undefined) target[key] = value;
}

/** 条件右值：按 `valueType` + 运算符元数把文本还原成后端认得的标量 / 标量数组 / 字符串。 */
export function conditionValueFromText(text: string, valueType: string, operator: string): unknown {
  if (OPERATOR_WITH_LIST.includes(operator)) {
    return csvToList(text);
  }
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (valueType === "FIELD_REFERENCE" || valueType === "PARAMETER_REFERENCE") return text;
  // CONSTANT：先试数字，再试布尔，最后当字符串 —— 与草图 textToScalar 同口径。
  const n = Number(trimmed);
  if (Number.isFinite(n)) return n;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return text;
}

/**
 * 草稿 → `StrategyDefinition`（只产出后端认得的键）。
 *
 * 每行都从 `original` 出发再覆盖本次编辑的键 ⇒ 表单不编辑的键原样穿过（纪律 2）。
 */
export function draftsToDefinition(drafts: DefinitionDrafts): JsonRecord {
  const event: JsonRecord = { ...drafts.event.original, type: drafts.event.type };
  /**
   * 🔴 仅在**可表达**时才覆盖 `params`。
   *
   * 早期写法是无条件 `if (eventParams === undefined) delete event.params` —— 那会在
   * `paramsExpressible === false`（参数里有数组 / 嵌套对象等表单表达不了的值）时
   * **把原始 params 整块抹掉**，而界面上那一区显示的正是「只读，保存时会原样保留
   * （不会丢键）」。即：说明与行为相反，且丢的是用户看不见的数据。
   * `risk.extensions` 一直有这个判断，`event` / `trigger` 的 params 漏了，这里补齐。
   */
  if (drafts.event.paramsExpressible) {
    const eventParams = scalarMapFromRows(drafts.event.params);
    if (eventParams === undefined) delete event.params;
    else event.params = eventParams;
  }

  const window_: JsonRecord = { ...drafts.window.original };
  window_.start = textToOptionalNumber(drafts.window.start) ?? drafts.window.original.start;
  window_.end = textToOptionalNumber(drafts.window.end) ?? drafts.window.original.end;
  window_.unit = drafts.window.unit;

  const trigger: JsonRecord = { ...drafts.trigger.original, type: drafts.trigger.type };
  if (drafts.trigger.paramsExpressible) {
    const triggerParams = scalarMapFromRows(drafts.trigger.params);
    if (triggerParams === undefined) delete trigger.params;
    else trigger.params = triggerParams;
  }

  const conditions = drafts.conditions.map((row) => ({
    ...row.original,
    field: row.field,
    operator: row.operator,
    value: conditionValueFromText(row.value, row.valueType, row.operator),
    valueType: row.valueType,
    enabled: row.enabled,
  }));

  const exitRules = drafts.exitRules.map((row) => {
    const next: JsonRecord = { ...row.original, type: row.type, trigger: row.trigger, enabled: row.enabled };
    const threshold = textToOptionalNumber(row.threshold);
    if (threshold === undefined) delete next.threshold;
    else next.threshold = threshold;
    if (row.thresholdUnit.trim() === "") delete next.thresholdUnit;
    else next.thresholdUnit = row.thresholdUnit;
    next.priority = textToOptionalNumber(row.priority) ?? row.original.priority ?? 1;
    return next;
  });

  const position: JsonRecord = { ...drafts.position.original, sizingMethod: drafts.position.sizingMethod };
  position.maxPositions = textToOptionalNumber(drafts.position.maxPositions) ?? drafts.position.original.maxPositions;
  for (const key of ["positionRatio", "fixedAmount", "maxExposure", "maxSinglePosition"] as const) {
    const text = drafts.position[key];
    if (text.trim() === "") delete position[key];
    else optionalNumberField(position, key, text);
  }

  const risk: JsonRecord = { ...drafts.risk.original };
  for (const key of [
    "stopLoss",
    "maxDrawdown",
    "maxExposure",
    "maxSinglePosition",
    "maxPositions",
    "dailyLossLimit",
    "concentrationLimit",
  ] as const) {
    const text = drafts.risk[key];
    if (text.trim() === "") delete risk[key];
    else optionalNumberField(risk, key, text);
  }
  const extensions = scalarMapFromRows(drafts.risk.extensions);
  if (drafts.risk.extensionsExpressible) {
    if (extensions === undefined) delete risk.extensions;
    else risk.extensions = extensions;
  }

  const execution: JsonRecord = { ...drafts.execution.original };
  execution.signalTiming = drafts.execution.signalTiming;
  execution.executionTiming = drafts.execution.executionTiming;
  execution.priceType = drafts.execution.priceType;
  execution.quantityMethod = drafts.execution.quantityMethod;
  execution.lotSize = textToOptionalNumber(drafts.execution.lotSize) ?? drafts.execution.original.lotSize;
  if (drafts.execution.slippageModel.trim() === "") delete execution.slippageModel;
  else execution.slippageModel = drafts.execution.slippageModel;
  if (drafts.execution.commissionModel.trim() === "") delete execution.commissionModel;
  else execution.commissionModel = drafts.execution.commissionModel;
  const constraints = csvToList(drafts.execution.constraintsText);
  if (constraints.length === 0) delete execution.executionConstraints;
  else execution.executionConstraints = constraints;

  const parameters = drafts.parameters.map((row) => {
    const next: JsonRecord = { ...row.original, code: row.code, dataType: row.dataType };
    if (row.name.trim() === "") delete next.name;
    else next.name = row.name;
    next.parameterRole = row.parameterRole;
    next.required = row.required;
    if (row.hasDefaultValue || row.defaultValue.trim() !== "") {
      next.defaultValue = conditionValueFromText(row.defaultValue, "CONSTANT", "==");
    } else {
      delete next.defaultValue;
    }
    for (const key of ["min", "max", "step"] as const) {
      const text = row[key];
      if (text.trim() === "") delete next[key];
      else optionalNumberField(next, key, text);
    }
    const allowed = csvToList(row.allowedValuesText);
    if (allowed.length === 0) delete next.allowedValues;
    else next.allowedValues = allowed;
    return next;
  });

  return {
    // 定义自身结构版本（≠ 策略版本号）：原样带回，缺省补 "1.0"（后端当前唯一白名单值）。
    schemaVersion: drafts.schemaVersion.trim() === "" ? "1.0" : drafts.schemaVersion,
    entry: { event, observationWindow: window_, conditions, trigger },
    exit: { rules: exitRules },
    position,
    risk,
    execution,
    parameters,
    // 数据集绑定**只读**：原对象原样放回（`note` 等键不会因为「没显示」而丢失）。
    datasets: drafts.datasets.map((row) => ({ ...row.original })),
  };
}

/**
 * 文档级成本模型（`executionAssumptions.costModel`）—— 从草稿重建。
 *
 * ⚠️ 它在 `executionAssumptions` 下、**不是** definition 的字段，也**不是** v1 派生视图
 * ⇒ 与它相邻的 `entryRules` 等不同，它可以直接编辑、直接下发（无 `fillOrCheck` 冲突）。
 */
export function costModelFromDrafts(drafts: DefinitionDrafts): JsonRecord {
  const out: JsonRecord = { ...drafts.cost.original };
  for (const key of [
    "commissionRate",
    "stampDutyRate",
    "transferFeeRate",
    "slippageBps",
    "lotSize",
    "minCommission",
  ] as const) {
    const text = drafts.cost[key];
    if (text.trim() === "") continue;
    const n = Number(text);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/**
 * 文档级回测配置（`executionAssumptions.backtestConfig`）—— 从草稿重建。
 *
 * ⚠️ 这里的 `maxPositions` 是**回测撮合器的并发持仓上限**，与 `definition.position.maxPositions`
 * （策略语义上的最多持仓数）不是同一个字段；两者不一致会给 warning，但不由客户端强行对齐。
 */
export function backtestConfigFromDrafts(drafts: DefinitionDrafts): JsonRecord {
  const out: JsonRecord = { ...drafts.cost.backtestOriginal };
  const capital = textToOptionalNumber(drafts.cost.initialCapital);
  if (capital !== undefined) out.initialCapital = capital;
  const maxPositions = textToOptionalNumber(drafts.cost.maxPositions);
  if (maxPositions === undefined) delete out.maxPositions;
  else out.maxPositions = maxPositions;
  return out;
}

/**
 * 把「基础信息」里选中的数据集坐标**同步进 `definition.datasets` 的 PRIMARY 绑定**。
 *
 * 🔴 为什么必须有这个函数：服务端 `map.ts#alignDefinitionViews` 在 `definition` 存在时会
 * **双向对账**：
 *   - doc 级 `datasetVersion` 必须等于 PRIMARY 绑定的 `datasetVersion`，否则
 *     `SCHEMA_DEFINITION_DATASET_VERSION_MISMATCH`；
 *   - doc 级 `datasetVersionId` 必须等于 PRIMARY 绑定的 `datasetVersionId`，否则
 *     `SCHEMA_DEFINITION_DATASET_VERSION_ID_MISMATCH`。
 * 而 `definition.datasets` 在本编辑器里是**只读**（它由 promote / 持久化层写入）。若用户在
 * 「基础信息」换了数据集版本却不联动这里，保存就会撞上面两个错 —— 一个用户从界面上
 * 完全看不出来原因的错。
 *
 * 因此：**基础信息是唯一入口，绑定行是它的镜像**。本函数是纯函数，不改输入对象；
 * 没有绑定行 / 坐标为空时原样返回（那种情况下 doc 级坐标必须缺省，见 `map.ts:168-176`）。
 *
 * 刻意**不**做：不新增绑定行、不删绑定行、不碰非 PRIMARY 行、不动 `note` 之外的键。
 */
export function syncPrimaryDatasetBinding(
  drafts: DefinitionDrafts,
  coordinate: { readonly datasetVersionId: number | null; readonly datasetVersion: string },
): DefinitionDrafts {
  if (coordinate.datasetVersionId === null) return drafts;
  if (drafts.datasets.length === 0) return drafts;

  const primaryIndex = drafts.datasets.findIndex((row) => row.role === "PRIMARY");
  const at = primaryIndex >= 0 ? primaryIndex : 0;
  const row = drafts.datasets[at];
  if (row === undefined) return drafts;

  const nextId = String(coordinate.datasetVersionId);
  const nextLabel = coordinate.datasetVersion.trim() === "" ? row.datasetVersion : coordinate.datasetVersion;
  if (row.datasetVersionId === nextId && row.datasetVersion === nextLabel) return drafts;

  return {
    ...drafts,
    datasets: drafts.datasets.map((item, index) =>
      index === at
        ? {
            ...item,
            datasetVersionId: nextId,
            datasetVersion: nextLabel,
            // `original` 才是重建时被原样放回的东西 ⇒ 坐标必须写在这里，不然改了等于没改。
            original: {
              ...item.original,
              datasetVersionId: coordinate.datasetVersionId,
              datasetVersion: nextLabel,
            },
          }
        : item,
    ),
  };
}

// ---------------------------------------------------------------------------
// 段：标题 / 顺序 / 必填性（与研究草图**同序同标题**，用测试锁住）
// ---------------------------------------------------------------------------

export const DEFINITION_SEGMENTS = [
  { key: "what", title: "买什么", hint: "观察哪一类事件。", required: true },
  { key: "condition", title: "什么条件买", hint: "可留空；留空 = 出现事件即产生买入信号。", required: false },
  { key: "when", title: "什么时候买", hint: "观察窗口 + 触发时点：信号在哪根 bar 产生。", required: true },
  { key: "exit", title: "怎么卖", hint: "可留空；留空 = 持有到回测期末。", required: false },
  { key: "sizing", title: "买多少 · 最多持几只", hint: "仓位方式、下单口径与风控落点。", required: true },
  { key: "cost", title: "成本与资金", hint: "成交时点 / 价格类型 / 费率与初始资金。", required: true },
  { key: "parameters", title: "参数搜索空间", hint: "可选；不填就不做参数搜索。", required: false },
] as const;

export type DefinitionSegmentKey = (typeof DEFINITION_SEGMENTS)[number]["key"];

export const DEFINITION_SEGMENT_KEYS: readonly DefinitionSegmentKey[] = DEFINITION_SEGMENTS.map((s) => s.key);

export function definitionSegmentTitle(segment: DefinitionSegmentKey): string {
  return DEFINITION_SEGMENTS.find((s) => s.key === segment)?.title ?? segment;
}

export type DefinitionFieldAnchor =
  | "event.type"
  | "window"
  | "trigger"
  | "position.sizingMethod"
  | "position.maxPositions"
  | "risk.maxPositions"
  | "execution.quantityMethod"
  | "execution.lotSize"
  | "execution.signalTiming"
  | "execution.executionTiming"
  | "execution.priceType"
  | "cost.initialCapital"
  | "cost.rates";

/**
 * 缺口文案 → 锚点。
 *
 * 放在**锚点这一侧**而不是给每个 `gaps.push` 挂一个字段：缺口是「校验的输出」，
 * 锚点是「界面的落点」，两者分离才不会让校验函数被迫知道 UI 长什么样。
 * 代价是文案必须逐字对上 —— 由 `definitionDraft.test.ts` 断言
 * 「`validateDefinitionDrafts` 可能产出的每条 label 都能查到锚点」，
 * 所以将来改了文案却忘了改这里，测试会红，而不是安静地少一个高亮。
 */
export const DEFINITION_GAP_ANCHORS: Readonly<Record<string, readonly DefinitionFieldAnchor[]>> = {
  "事件类型（必填）": ["event.type"],
  "观察窗口：起始 / 结束 / 单位": ["window"],
  "触发时点（必填）": ["trigger"],
  "仓位方式（必填）": ["position.sizingMethod"],
  "最大同时持仓数（必填）": ["position.maxPositions", "risk.maxPositions"],
  "下单口径（必填）": ["execution.quantityMethod"],
  "每手股数（必填）": ["execution.lotSize"],
  "信号时点（必填）": ["execution.signalTiming"],
  "成交时点（必填）": ["execution.executionTiming"],
  "成交价格类型（必填）": ["execution.priceType"],
  "回测初始资金（必填）": ["cost.initialCapital"],
  "成本假设六项：佣金 / 印花税 / 过户费 / 滑点基点 / 每手股数 / 最低佣金": ["cost.rates"],
  // 「成本假设还差：A / B」是动态文案 ⇒ 见下面的前缀兜底。
  "成本假设还差：": ["cost.rates"],
};

/** 查缺口对应的界面锚点；查不到返回空数组（渲染层退化成「只亮清单、不亮输入框」）。 */
export function definitionGapAnchors(label: string): readonly DefinitionFieldAnchor[] {
  const exact = DEFINITION_GAP_ANCHORS[label];
  if (exact !== undefined) return exact;
  const prefixed = Object.entries(DEFINITION_GAP_ANCHORS).find(([key]) => label.startsWith(key));
  return prefixed?.[1] ?? [];
}

export interface DefinitionGap {
  readonly segment: DefinitionSegmentKey;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// 信号时间线（**复刻**服务端 `resolveSignalTimeline` 的口径，用于前视提示）
// ---------------------------------------------------------------------------

/**
 * 允许在买入条件里引用的**最大前视相对日**。
 *
 * 依据（服务端 `strategySchema/definition.ts#resolveSignalTimeline`）：
 *   FIRST_VALID_DAY / EVERY_VALID_DAY → 窗口起点；LAST_VALID_DAY → 窗口终点；
 *   NEXT_TRADING_DAY → 窗口起点 + 1；`CALENDAR_DAY` 窗口无法映射到交易日 ⇒ 不可解析。
 */
export function resolveEarliestSignalOffset(
  trigger: string,
  start: number,
  end: number,
  unit: string,
): { maxOffset: number | null; resolvable: boolean } {
  switch (trigger) {
    case "FIRST_VALID_DAY":
    case "EVERY_VALID_DAY":
      return { maxOffset: start, resolvable: unit === "TRADING_DAY" };
    case "LAST_VALID_DAY":
      return { maxOffset: end, resolvable: unit === "TRADING_DAY" };
    case "NEXT_TRADING_DAY":
      return { maxOffset: start + 1, resolvable: unit === "TRADING_DAY" };
    default:
      return { maxOffset: null, resolvable: false };
  }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export interface DefinitionValidation {
  /** 填了但不合法 —— 阻止保存。 */
  errors: string[];
  /** 必填未填 —— 只是提示（服务端才会拒），不阻止本地保存该草稿。 */
  gaps: DefinitionGap[];
  /** 能过但**含义会变 / 必被后端拒绝**的组合，必须让用户看见。 */
  warnings: string[];
}

function requireIntText(text: string, label: string, errors: string[], min = 1): void {
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    errors.push(`${label} 必须是 ≥ ${min} 的整数（当前：${JSON.stringify(text)}）`);
  }
}

function checkEnumText(
  text: string,
  label: string,
  allowed: readonly string[],
  errors: string[],
): void {
  if (text.trim() === "") return;
  if (!allowed.includes(text)) {
    errors.push(`${label} 只能是 ${allowed.join(" / ")}（当前：${JSON.stringify(text)}）`);
  }
}

function checkRatio(text: string, label: string, errors: string[], allowZero = false): void {
  if (text.trim() === "") return;
  const n = Number(text);
  if (!Number.isFinite(n)) {
    errors.push(`${label} 必须是有限数字（当前：${JSON.stringify(text)}）`);
    return;
  }
  if (allowZero ? n < 0 || n > 1 : n <= 0 || n > 1) {
    errors.push(`${label} 应在 ${allowZero ? "[0,1]" : "(0,1]"} 之间（当前：${n}）`);
  }
}

export function validateDefinitionDrafts(drafts: DefinitionDrafts): DefinitionValidation {
  const errors: string[] = [];
  const gaps: DefinitionGap[] = [];
  const warnings: string[] = [];

  // ---- ① 买什么 ----
  if (drafts.event.type.trim() === "") {
    gaps.push({ segment: "what", label: "事件类型（必填）" });
  } else {
    checkEnumText(drafts.event.type, "事件类型", DEFINITION_EVENT_OPTIONS.map((o) => o.value), errors);
  }
  if (!drafts.event.paramsExpressible) {
    warnings.push("事件参数含表单表达不了的值：该区只读，保存时会**原样保留**（不会丢键）。");
  }
  for (const row of drafts.event.params) {
    if (row.key.trim() === "" && row.value.trim() === "") continue;
    if (row.key.trim() === "") errors.push("事件参数：填了值但没写键名（留空的行请删掉）");
    else if (row.value.trim() === "") errors.push(`事件参数「${row.key}」没填值（留空的行请删掉）`);
  }

  // ---- ② 什么条件买 ----
  const startNum = Number(drafts.window.start);
  const endNum = Number(drafts.window.end);
  const { maxOffset, resolvable } = resolveEarliestSignalOffset(
    drafts.trigger.type,
    Number.isFinite(startNum) ? startNum : 0,
    Number.isFinite(endNum) ? endNum : 0,
    drafts.window.unit,
  );

  const checkFieldReference = (field: string, at: string, blocking: boolean): void => {
    if (field.trim() === "") return;
    const reference = parseCandidateFieldReference(field);
    const push = (message: string) => (blocking ? errors.push(message) : warnings.push(message));
    switch (reference.kind) {
      case "unknown":
        push(
          `${at}：${JSON.stringify(field)} 不是合法的字段引用`
            + "（只认 prefix.rd{n}.* / event.* / bar.* / post.rd{n}.*）",
        );
        return;
      case "labelOnly":
        push(`${at}：${field} 属于「前视标签层」（path./outcome.），不能作为买入条件 —— 后端会直接拒绝。`);
        return;
      case "forwardBar": {
        const offset = reference.relativeDay ?? 1;
        if (maxOffset === null || !resolvable) {
          push(
            `${at}：${field} 是前视引用，而当前观察窗口（单位 ${drafts.window.unit || "未设"}）无法解析出`
              + "允许的信号偏移 ⇒ 后端会按「不可解析」拒绝。",
          );
        } else if (offset > maxOffset) {
          push(
            `${at}：${field} 引用了事件后第 ${offset} 根，而当前触发时点最早只能在第 ${maxOffset} 根出信号`
              + "（前视，后端 Look-Ahead 规则会拒绝）。",
          );
        }
        return;
      }
      default:
        return;
    }
  };

  drafts.conditions.forEach((row, index) => {
    const at = `买入条件第 ${index + 1} 条`;
    const field = row.field.trim();
    if (field === "" && row.value.trim() === "") return; // 空白行静默跳过（正常中间态）
    if (field === "") {
      errors.push(`${at}：填了比较值但没选字段（空行请删掉）`);
      return;
    }
    checkFieldReference(field, at, true);
    if (!OP_VALUES.includes(row.operator)) {
      errors.push(`${at}：运算符 ${JSON.stringify(row.operator)} 不在后端支持的 8 个之内`);
      return;
    }
    const arity = DEFINITION_CONDITION_OPERATOR_OPTIONS.find((o) => o.value === row.operator)?.arity;
    if (arity === "ONE" && row.value.trim() === "") errors.push(`${at}：缺比较值`);
    if (arity === "LIST" && csvToList(row.value).length === 0) {
      errors.push(`${at}：属于 / 不属于 需要至少一个候选值（逗号分隔）`);
    }
    if (!DEFINITION_CONDITION_VALUE_TYPE_OPTIONS.some((o) => o.value === row.valueType)) {
      errors.push(`${at}：比较值类型 ${JSON.stringify(row.valueType)} 不是后端认得的三种之一`);
    }
    // 右值也可能是字段引用 ⇒ 同样受前视约束。**降级为警告**：服务端是否逐字校验右值未经实测，
    // 宁可不误拦用户保存。
    if (row.valueType === "FIELD_REFERENCE") {
      checkFieldReference(row.value, `${at}（比较值）`, false);
    }
  });

  // ---- ③ 什么时候买 ----
  if (drafts.window.start.trim() === "" || drafts.window.end.trim() === "" || drafts.window.unit.trim() === "") {
    gaps.push({ segment: "when", label: "观察窗口：起始 / 结束 / 单位" });
  } else {
    requireIntText(drafts.window.start, "观察窗口起始", errors, 1);
    requireIntText(drafts.window.end, "观察窗口结束", errors, 1);
    if (Number.isFinite(startNum) && Number.isFinite(endNum) && endNum < startNum) {
      errors.push(`观察窗口结束（${endNum}）不得早于起始（${startNum}）`);
    }
    checkEnumText(drafts.window.unit, "观察窗口单位", DEFINITION_WINDOW_UNIT_OPTIONS.map((o) => o.value), errors);
  }
  if (drafts.trigger.type.trim() === "") gaps.push({ segment: "when", label: "触发时点（必填）" });
  else checkEnumText(drafts.trigger.type, "触发时点", DEFINITION_TRIGGER_OPTIONS.map((o) => o.value), errors);

  // ---- ④ 怎么卖 ----
  const priorities = new Set<number>();
  drafts.exitRules.forEach((row, index) => {
    const at = `出场规则第 ${index + 1} 条`;
    if (row.type.trim() === "") {
      errors.push(`${at}：没选类型（空行请删掉）`);
      return;
    }
    checkEnumText(row.type, `${at} 类型`, DEFINITION_EXIT_RULE_TYPE_OPTIONS.map((o) => o.value), errors);
    checkEnumText(row.trigger, `${at} 触发时点`, DEFINITION_EXIT_TRIGGER_OPTIONS.map((o) => o.value), errors);
    if (row.thresholdUnit.trim() !== "") {
      checkEnumText(
        row.thresholdUnit,
        `${at} 阈值单位`,
        DEFINITION_EXIT_THRESHOLD_UNIT_OPTIONS.map((o) => o.value),
        errors,
      );
    }
    /**
     * 🔴 「除条件外必须给 threshold 或 parameter」——`ExitRuleDefinition` 的硬约束
     * （见 `PROJECT_RULES` 里凭记忆必错的那一条）。`parameter` 属本次不编辑的键，
     * 因此只从 `original` 里读，不凭空判它有。
     */
    const hasParameter = typeof row.original.parameter === "string" && row.original.parameter.trim() !== "";
    const hasCondition = isRecord(row.original.condition) && row.original.condition !== null;
    if (row.threshold.trim() === "" && !hasParameter && !hasCondition) {
      errors.push(`${at}：既没有阈值也没有参数/条件 —— 后端要求三者至少给一个`);
    }
    if (row.threshold.trim() !== "") {
      const n = Number(row.threshold);
      if (!Number.isFinite(n)) errors.push(`${at}：阈值必须是有限数字（当前：${JSON.stringify(row.threshold)}）`);
      else if (row.type === "TIME_EXIT") {
        if (!Number.isInteger(n) || n < 1) errors.push(`${at}：到期离场的阈值必须是 ≥ 1 的整数交易日`);
      } else if (row.thresholdUnit === "RATIO" || row.thresholdUnit === "") {
        if (n <= 0 || n >= 1) errors.push(`${at}：按比例表达时阈值必须在 (0,1)（如 0.05 = 5%）`);
      } else if (n <= 0) {
        errors.push(`${at}：阈值必须 > 0`);
      }
    }
    if (row.priority.trim() === "") {
      errors.push(`${at}：优先级必填（数值越小越先判定，同一定义内不得重复）`);
    } else {
      const p = Number(row.priority);
      if (!Number.isInteger(p) || p < 0) errors.push(`${at}：优先级必须是非负整数`);
      else if (priorities.has(p)) errors.push(`${at}：优先级 ${p} 与前面的规则重复`);
      else priorities.add(p);
    }
    if (hasCondition) {
      warnings.push(`${at}：附带条件（condition）不在本表单的编辑范围内，保存时**原样保留**。`);
    }
  });

  // ---- ⑤ 买多少 · 最多持几只 ----
  if (drafts.position.sizingMethod.trim() === "") {
    gaps.push({ segment: "sizing", label: "仓位方式（必填）" });
  } else {
    checkEnumText(
      drafts.position.sizingMethod,
      "仓位方式",
      DEFINITION_SIZING_METHOD_OPTIONS.map((o) => o.value),
      errors,
    );
  }
  if (drafts.position.maxPositions.trim() === "") gaps.push({ segment: "sizing", label: "最大同时持仓数（必填）" });
  else requireIntText(drafts.position.maxPositions, "最大同时持仓数", errors, 1);

  checkRatio(drafts.position.positionRatio, "单笔比例 positionRatio", errors);
  checkRatio(drafts.position.maxExposure, "最大暴露 position.maxExposure", errors, true);
  checkRatio(drafts.position.maxSinglePosition, "单标的上限 position.maxSinglePosition", errors, true);
  if (drafts.position.fixedAmount.trim() !== "") {
    const n = Number(drafts.position.fixedAmount);
    if (!Number.isFinite(n) || n <= 0) errors.push("固定金额 fixedAmount 必须 > 0");
  }

  checkRatio(drafts.risk.stopLoss, "风控 stopLoss", errors);
  checkRatio(drafts.risk.maxDrawdown, "风控 maxDrawdown", errors);
  checkRatio(drafts.risk.maxExposure, "风控 maxExposure", errors, true);
  checkRatio(drafts.risk.maxSinglePosition, "风控 maxSinglePosition", errors, true);
  checkRatio(drafts.risk.dailyLossLimit, "风控 dailyLossLimit", errors, true);
  checkRatio(drafts.risk.concentrationLimit, "风控 concentrationLimit", errors, true);
  if (drafts.risk.maxPositions.trim() !== "") requireIntText(drafts.risk.maxPositions, "风控 maxPositions", errors, 1);
  for (const row of drafts.risk.extensions) {
    if (row.key.trim() === "" && row.value.trim() === "") continue;
    if (row.key.trim() === "") errors.push("扩展风控：填了值但没写键名（留空的行请删掉）");
    else if (row.value.trim() === "") errors.push(`扩展风控「${row.key}」没填值（留空的行请删掉）`);
  }
  const riskPositions = textToOptionalNumber(drafts.risk.maxPositions);
  const positionMax = textToOptionalNumber(drafts.position.maxPositions);
  if (riskPositions !== undefined && positionMax !== undefined && riskPositions !== positionMax) {
    warnings.push(
      `风控里的 maxPositions（${riskPositions}）与仓位的 maxPositions（${positionMax}）不一致 —— `
        + "两者都会被写入定义，执行侧取哪一个是后端口径，建议保持相同。",
    );
  }

  // ---- ⑥ 成本与资金（成交口径 + 费用）----
  if (drafts.execution.signalTiming.trim() === "") gaps.push({ segment: "cost", label: "信号时点（必填）" });
  else checkEnumText(drafts.execution.signalTiming, "信号时点", DEFINITION_SIGNAL_TIMING_OPTIONS.map((o) => o.value), errors);
  if (drafts.execution.executionTiming.trim() === "") gaps.push({ segment: "cost", label: "成交时点（必填）" });
  else checkEnumText(drafts.execution.executionTiming, "成交时点", DEFINITION_EXECUTION_TIMING_OPTIONS.map((o) => o.value), errors);
  if (drafts.execution.priceType.trim() === "") gaps.push({ segment: "cost", label: "成交价格类型（必填）" });
  else checkEnumText(drafts.execution.priceType, "成交价格类型", DEFINITION_PRICE_TYPE_OPTIONS.map((o) => o.value), errors);
  if (drafts.execution.quantityMethod.trim() === "") gaps.push({ segment: "sizing", label: "下单口径（必填）" });
  else checkEnumText(drafts.execution.quantityMethod, "下单口径", DEFINITION_QUANTITY_METHOD_OPTIONS.map((o) => o.value), errors);
  if (drafts.execution.lotSize.trim() === "") gaps.push({ segment: "sizing", label: "每手股数（必填）" });
  else requireIntText(drafts.execution.lotSize, "每手股数 lotSize", errors, 1);
  checkEnumText(drafts.execution.slippageModel, "滑点模型", DEFINITION_COST_MODEL_OPTIONS.map((o) => o.value), errors);
  checkEnumText(drafts.execution.commissionModel, "佣金模型", DEFINITION_COST_MODEL_OPTIONS.map((o) => o.value), errors);

  /**
   * 🔴 后端的两个硬约束（**照抄服务端规则名，不自己发明**）：
   *   - **L6** `SIGNAL_EXECUTION_TIMING_CONFLICT`：成交不得早于或等于信号时点
   *     ⇒ `signalTiming = T_CLOSE` 且 `executionTiming = T_CLOSE` 属**同 bar 组合**，必被拒。
   *   - **L7** `TRIGGER_EXECUTION_INCONSISTENT`：触发时点为「次一交易日」时不能选同 bar 成交。
   */
  if (drafts.execution.signalTiming === "T_CLOSE" && drafts.execution.executionTiming === "T_CLOSE") {
    errors.push(
      "信号时点与成交时点都是 T 日收盘 —— 后端 L6（SIGNAL_EXECUTION_TIMING_CONFLICT）会直接拒绝。"
        + "请把成交时点改成 T+1 开盘或 T+1 收盘。",
    );
  } else if (drafts.execution.executionTiming === "T_CLOSE") {
    warnings.push("成交时点 = T 日收盘：只有当信号在 T 日开盘产生时才成立，请确认这是你要的口径。");
  }
  if (drafts.trigger.type === "NEXT_TRADING_DAY" && drafts.execution.executionTiming === "T_CLOSE") {
    errors.push(
      "触发时点是「次一交易日」而成交时点是 T 日收盘 —— 后端 L7（TRIGGER_EXECUTION_INCONSISTENT）会拒绝。",
    );
  }

  if (drafts.cost.initialCapital.trim() === "") {
    gaps.push({ segment: "cost", label: "回测初始资金（必填）" });
  } else {
    const n = Number(drafts.cost.initialCapital);
    if (!Number.isFinite(n) || n <= 0) errors.push("回测初始资金必须 > 0");
  }
  if (drafts.cost.maxPositions.trim() !== "") {
    requireIntText(drafts.cost.maxPositions, "回测配置 maxPositions", errors, 1);
    const backtestMax = Number(drafts.cost.maxPositions);
    const positionMax = drafts.position.maxPositions.trim() === "" ? null : Number(drafts.position.maxPositions);
    if (positionMax !== null && Number.isFinite(positionMax) && positionMax !== backtestMax) {
      warnings.push(
        `回测配置 maxPositions = ${backtestMax}，而策略定义 position.maxPositions = ${positionMax}：`
          + "两者含义不同（前者是回测撮合的并发上限，后者是策略语义），不一致时以回测配置为准，请确认这是你要的。",
      );
    }
  }
  const costKeys = ["commissionRate", "stampDutyRate", "transferFeeRate", "slippageBps", "lotSize", "minCommission"] as const;
  const missingCost = costKeys.filter((key) => drafts.cost[key].trim() === "");
  if (missingCost.length === costKeys.length) {
    gaps.push({ segment: "cost", label: "成本假设六项：佣金 / 印花税 / 过户费 / 滑点基点 / 每手股数 / 最低佣金" });
  } else if (missingCost.length > 0) {
    gaps.push({ segment: "cost", label: `成本假设还差：${missingCost.join(" / ")}` });
  }
  for (const key of costKeys) {
    const text = drafts.cost[key];
    if (text.trim() === "") continue;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) errors.push(`成本模型.${key} 必须是非负有限数字（当前：${JSON.stringify(text)}）`);
  }
  if (drafts.cost.lotSize.trim() !== "") requireIntText(drafts.cost.lotSize, "成本模型.lotSize", errors, 1);

  // ---- ⑦ 参数搜索空间 ----
  const seenCodes = new Set<string>();
  drafts.parameters.forEach((row, index) => {
    const at = `参数第 ${index + 1} 行`;
    const code = row.code.trim();
    const blank =
      code === "" && [row.name, row.min, row.max, row.step, row.allowedValuesText, row.defaultValue].every(
        (text) => text.trim() === "",
      );
    if (blank) return;
    if (code === "") {
      errors.push(`${at}：填了取值域但还没写参数名（空行请删掉）`);
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(code)) {
      errors.push(`${at}：参数名必须是 [A-Za-z_][A-Za-z0-9_]*（当前：${JSON.stringify(code)}）`);
    }
    if (seenCodes.has(code)) errors.push(`${at}：参数名 ${code} 重复`);
    seenCodes.add(code);
    checkEnumText(row.dataType, `${at} 数据类型`, DEFINITION_PARAMETER_TYPE_OPTIONS.map((o) => o.value), errors);
    checkEnumText(row.parameterRole, `${at} 参数角色`, DEFINITION_PARAMETER_ROLE_OPTIONS.map((o) => o.value), errors);
    if (row.parameterRole === "DERIVED") {
      const derivedFrom = row.original.derivedFrom;
      if (typeof derivedFrom !== "string" || derivedFrom.trim() === "") {
        errors.push(`${at}：角色是「推导值」但没有推导表达式（derivedFrom）—— 后端要求必填`);
      }
    }
    for (const key of ["min", "max", "step"] as const) {
      const text = row[key];
      if (text.trim() === "") continue;
      const n = Number(text);
      if (!Number.isFinite(n)) errors.push(`${at} ${key} 必须是有限数字`);
    }
    if (row.dataType === "number") {
      if (row.parameterRole === "TUNABLE" && (row.min.trim() === "" || row.max.trim() === "")) {
        errors.push(`${at}：待搜索的数值参数必须同时给 min 与 max（搜索不会替你定界）`);
      } else if (row.min.trim() !== "" && row.max.trim() !== "") {
        const min = Number(row.min);
        const max = Number(row.max);
        if (Number.isFinite(min) && Number.isFinite(max) && min >= max) errors.push(`${at}：min 必须小于 max`);
      }
    } else if (row.dataType === "string" || row.dataType === "boolean") {
      if (csvToList(row.allowedValuesText).length === 0) {
        errors.push(`${at}：${row.dataType} 参数必须给出非空候选集合（逗号分隔）`);
      }
    }
    if (row.defaultValue.trim() !== "" && row.dataType === "number" && !Number.isFinite(Number(row.defaultValue))) {
      errors.push(`${at}：默认值与数据类型 number 不符（当前：${JSON.stringify(row.defaultValue)}）`);
    }
  });

  return { errors, gaps, warnings };
}

// ---------------------------------------------------------------------------
// 段摘要（折叠态一行中文）
// ---------------------------------------------------------------------------

function textOf(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function rateText(text: string): string | null {
  const trimmed = textOf(text);
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return `${Number((n * 100).toFixed(4))}%`;
}

function joinSummary(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

function summarizeConditions(drafts: DefinitionDrafts): string {
  const rows = drafts.conditions.filter((row) => row.field.trim() !== "");
  if (rows.length === 0) return "";
  return `${rows.length} 条：` + rows
    .map((row) => describeConditionRow(row))
    .join(" 且 ");
}

/** 一条条件的人话整句（字段引用描述复用草图那一套；运算符符号取**定义侧**词表）。 */
export function describeConditionRow(row: ConditionRowDraft): string {
  const left = describeCandidateFieldReference(row.field);
  const symbol = definitionOperatorSymbol(row.operator);
  const value = row.value.trim();
  if (value === "") return `${left}${symbol}（比较值还没填）`;
  const parsed = parseCandidateFieldReference(value);
  const right = parsed.kind === "unknown" ? value : describeCandidateFieldReference(value);
  return `${left}${symbol}${right}`;
}

export function summarizeDefinitionSegment(drafts: DefinitionDrafts, segment: DefinitionSegmentKey): string {
  switch (segment) {
    case "what":
      return joinSummary([
        drafts.event.type.trim() === ""
          ? null
          : definitionOptionLabel(DEFINITION_EVENT_OPTIONS, drafts.event.type),
        drafts.event.params.filter((row) => row.key.trim() !== "").length === 0
          ? null
          : `${drafts.event.params.filter((row) => row.key.trim() !== "").length} 个事件参数`,
      ]);
    case "condition":
      return summarizeConditions(drafts);
    case "when": {
      const win = drafts.window;
      const windowText =
        textOf(win.start) !== "" && textOf(win.end) !== "" && textOf(win.unit) !== ""
          ? `观察第 ${Number(win.start)}–${Number(win.end)} ${definitionOptionLabel(DEFINITION_WINDOW_UNIT_OPTIONS, win.unit)}`
          : null;
      return joinSummary([
        windowText,
        drafts.trigger.type.trim() === ""
          ? null
          : `${definitionOptionLabel(DEFINITION_TRIGGER_OPTIONS, drafts.trigger.type)}触发`,
      ]);
    }
    case "exit": {
      const rows = drafts.exitRules.filter((row) => row.type.trim() !== "");
      if (rows.length === 0) return "未设置 —— 会持有到回测期末";
      return rows
        .map((row) => {
          const label = definitionOptionLabel(DEFINITION_EXIT_RULE_TYPE_OPTIONS, row.type);
          const unit = row.thresholdUnit.trim() === ""
            ? ""
            : definitionOptionLabel(DEFINITION_EXIT_THRESHOLD_UNIT_OPTIONS, row.thresholdUnit);
          if (row.type === "TIME_EXIT") return `${label} ${textOf(row.threshold)} 个交易日`;
          const asRate = row.thresholdUnit === "RATIO" ? rateText(row.threshold) : null;
          return `${label} ${asRate ?? `${textOf(row.threshold)} ${unit}`.trim()}`;
        })
        .join(" · ");
    }
    case "sizing":
      return joinSummary([
        drafts.risk.maxPositions.trim() === "" ? null : `最多 ${Number(drafts.risk.maxPositions)} 只`,
        (() => {
          const weight = rateText(drafts.position.maxSinglePosition) ?? rateText(drafts.risk.maxSinglePosition);
          return weight === null ? null : `单标的 ≤ ${weight}`;
        })(),
        drafts.position.sizingMethod.trim() === ""
          ? null
          : definitionOptionLabel(DEFINITION_SIZING_METHOD_OPTIONS, drafts.position.sizingMethod),
        drafts.execution.quantityMethod.trim() === ""
          ? null
          : definitionOptionLabel(DEFINITION_QUANTITY_METHOD_OPTIONS, drafts.execution.quantityMethod),
        drafts.execution.lotSize.trim() === "" ? null : `${Number(drafts.execution.lotSize)} 股/手`,
      ]);
    case "cost": {
      const capital = textOf(drafts.cost.initialCapital);
      return joinSummary([
        capital === "" ? null : `本金 ${Number(capital).toLocaleString("zh-CN")}`,
        drafts.execution.signalTiming.trim() === "" || drafts.execution.executionTiming.trim() === ""
          ? null
          : `${definitionOptionLabel(DEFINITION_SIGNAL_TIMING_OPTIONS, drafts.execution.signalTiming)}出信号`
            + `→${definitionOptionLabel(DEFINITION_EXECUTION_TIMING_OPTIONS, drafts.execution.executionTiming)}成交`,
        drafts.execution.priceType.trim() === ""
          ? null
          : `${definitionOptionLabel(DEFINITION_PRICE_TYPE_OPTIONS, drafts.execution.priceType)}`,
      ]);
    }
    case "parameters": {
      const codes = drafts.parameters.map((row) => row.code.trim()).filter((code) => code !== "");
      return codes.length === 0 ? "" : `${codes.length} 个参数：${codes.join("、")}`;
    }
  }
}

/** 一条缺口 + 它在界面上的落点（锚点由 `DEFINITION_GAP_ANCHORS` 查得）。 */
export interface DefinitionGapWithAnchors extends DefinitionGap {
  readonly anchors: readonly DefinitionFieldAnchor[];
}

export interface DefinitionSegmentStatus {
  readonly segment: DefinitionSegmentKey;
  readonly title: string;
  readonly hint: string;
  readonly required: boolean;
  readonly gapCount: number;
  readonly gaps: readonly DefinitionGapWithAnchors[];
  readonly summary: string;
  readonly empty: boolean;
}

export function definitionSegmentStatuses(
  drafts: DefinitionDrafts,
): ReadonlyArray<DefinitionSegmentStatus> {
  const { gaps } = validateDefinitionDrafts(drafts);
  return DEFINITION_SEGMENTS.map((segment) => {
    const segmentGaps = gaps
      .filter((gap) => gap.segment === segment.key)
      .map((gap) => ({ ...gap, anchors: definitionGapAnchors(gap.label) }));
    const summary = summarizeDefinitionSegment(drafts, segment.key);
    const empty = summary === "" || summary === "未设置 —— 会持有到回测期末";
    return {
      segment: segment.key,
      title: segment.title,
      hint: segment.hint,
      required: segment.required,
      gapCount: segmentGaps.length,
      gaps: segmentGaps,
      summary,
      empty,
    };
  });
}

/** 该定义里是否存在「本表单不编辑的额外键」（仅用于提示，绝不删除）。 */
export function uneditedKeysOf(drafts: DefinitionDrafts): string[] {
  const found: string[] = [];
  const push = (path: string, extra: string[]) => {
    for (const key of extra) found.push(`${path}.${key}`);
  };
  push("entry.event", extraKeysOf(drafts.event.original, EVENT_KEYS));
  push("entry.trigger", extraKeysOf(drafts.trigger.original, ["type", "params", "description"]));
  push("risk", extraKeysOf(drafts.risk.original, RISK_EXTENSION_KEYS));
  for (const row of drafts.exitRules) {
    push("exit.rules", extraKeysOf(row.original, ["type", "trigger", "threshold", "thresholdUnit", "priority", "enabled"]));
  }
  for (const row of drafts.conditions) {
    push("entry.conditions", extraKeysOf(row.original, ["field", "operator", "value", "valueType", "enabled"]));
  }
  for (const row of drafts.parameters) {
    push("parameters", extraKeysOf(row.original, ["code", "name", "dataType", "parameterRole", "required", "defaultValue", "min", "max", "step", "allowedValues"]));
  }
  return [...new Set(found)];
}
