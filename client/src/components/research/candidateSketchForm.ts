/**
 * candidateSketchForm — 候选**研究草图**的草稿状态与 JSON 互转（纯函数，可单测）。
 *
 * 定位：把「用手写 JSON 表达规则」换成「用表单表达规则」，同时**不改变任何后端契约**。
 *
 * 三条纪律（与 `candidateForm.ts` / `promoteForm.ts` 同一约定）：
 *   1. **草稿 → JSON 只产出后端认得的键**。服务端 `definitionBuild.ts` 是权威：
 *      `entryRule.extra` 是**闭集七键**，出现未定义键即 `PROMOTE_SKETCH_INVALID`。
 *   2. **绝不静默丢数据**。若既有 JSON 里出现表单无法表达的内容（未知键、转正不支持的
 *      运算符、非法类型），该字段**整块降级为只读**并说明原因，**不**把它「就地改写」成
 *      表单能表达的样子后再提交 —— 那等于替用户删字段。
 *   3. **往返幂等**。`JSON → 草稿 → JSON` 对同一份可表达输入必须逐字段一致，
 *      这样「打开编辑、什么都不改、点保存」不会产生任何写入。
 */

import type { ResearchConditionOperator } from "../../../../server/researchCore";
import {
  CANDIDATE_CONDITION_OPERATOR_OPTIONS,
  CANDIDATE_COST_MODEL_OPTIONS,
  CANDIDATE_ENTRY_TIMING_OPTIONS,
  CANDIDATE_EVENT_OPTIONS,
  CANDIDATE_PARAMETER_TYPE_OPTIONS,
  CANDIDATE_QUANTITY_METHOD_OPTIONS,
  CANDIDATE_SIZING_METHOD_OPTIONS,
  CANDIDATE_SKETCH_EXTENSION_KEYS,
  CANDIDATE_TRIGGER_OPTIONS,
  CANDIDATE_WINDOW_UNIT_OPTIONS,
  candidateOptionLabel,
  describeCandidateCondition,
  parseCandidateFieldReference,
} from "./candidateSketchVocabulary";
import {
  isCostAssumptionComplete,
  matchCostPreset,
} from "./candidateSketchCostPreset";
import {
  conditionGroupsToPayload,
  conditionPayloadToDraftGroups,
  createEmptyConditionGroup,
  type AnalysisConditionInput,
  type ConditionDraft,
  type ConditionGroupDraft,
} from "./createAnalysisForm";

// ---------------------------------------------------------------------------
// 通用小工具（不引 lodash：仓库零新增依赖）
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

/** 稳定序列化（对象键排序）—— 只用于「值是否变了」的比较，不用于落库。 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 两个 JSON 值是否语义相等（键序无关）。 */
export function sketchValuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a ?? null) === stableStringify(b ?? null);
}

/** 数值/字符串 → 输入框文本。非有限数字 / 非标量 ⇒ `null`（不可表达）。 */
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

function textToScalar(text: string, type: "string" | "number" | "boolean"): string | number | boolean | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (type === "string") return text;
  if (type === "boolean") return trimmed === "true" || trimmed === "1";
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function csvToList(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// 草稿状态：三态包（未填写 / 可结构化 / 无法表达）
// ---------------------------------------------------------------------------

/**
 * 单个草图字段的状态。
 *   - `empty`：字段为 `null` / 缺失 —— 提交时写 `null`（= 未填写）；
 *   - `structured`：可被表单表达 ⇒ 正常编辑；
 *   - `raw`：既有值里含表单无法表达的内容 ⇒ **只读**展示，除非用户显式「清空」。
 */
export type SketchFieldState<T> =
  | { readonly kind: "empty" }
  | { readonly kind: "structured"; readonly draft: T }
  | { readonly kind: "raw"; readonly rawText: string; readonly reason: string };

/**
 * `raw` 分支单独取出来 —— 组件里经常要「先把只读块接住，其余照常渲染」，
 * 用 `Extract` 取分支比到处写 `state.kind === "raw" ? state : null` 更不容易写错。
 */
export type SketchRawState = Extract<SketchFieldState<unknown>, { kind: "raw" }>;

export type KeyValueRowType = "string" | "number" | "boolean";

export interface KeyValueRowDraft {
  key: string;
  valueType: KeyValueRowType;
  value: string;
}

export interface EntryRuleDraft {
  event: string;
  timing: string;
  observationWindow: { start: string; end: string; unit: string };
  trigger: string;
  eventParams: KeyValueRowDraft[];
  execution: {
    quantityMethod: string;
    lotSize: string;
    slippageModel: string;
    commissionModel: string;
    constraintsText: string;
  };
  position: {
    sizingMethod: string;
    positionRatio: string;
    fixedAmount: string;
    maxExposure: string;
    maxSinglePosition: string;
  };
  risk: {
    stopLoss: string;
    maxDrawdown: string;
    maxExposure: string;
    maxSinglePosition: string;
    maxPositions: string;
    dailyLossLimit: string;
    concentrationLimit: string;
    extensions: KeyValueRowDraft[];
  };
  document: {
    initialCapital: string;
    maxPositions: string;
    commissionRate: string;
    stampDutyRate: string;
    transferFeeRate: string;
    slippageBps: string;
    lotSize: string;
    minCommission: string;
  };
}

export interface ExitRuleDraft {
  stopLoss: string;
  takeProfit: string;
  holdingDays: string;
}

export interface RiskRuleDraft {
  maxPositions: string;
  maxPositionWeight: string;
}

export interface ParameterRowDraft {
  code: string;
  type: string;
  min: string;
  max: string;
  step: string;
  allowedValuesText: string;
}

export interface CandidateSketchDrafts {
  entryRule: SketchFieldState<EntryRuleDraft>;
  filterRule: SketchFieldState<ConditionGroupDraft[]>;
  exitRule: SketchFieldState<ExitRuleDraft>;
  riskRule: SketchFieldState<RiskRuleDraft>;
  parameterSpace: SketchFieldState<ParameterRowDraft[]>;
}

// ---------------------------------------------------------------------------
// 空草稿工厂
// ---------------------------------------------------------------------------

export function emptyKeyValueRow(): KeyValueRowDraft {
  return { key: "", valueType: "string", value: "" };
}

export function emptyEntryRuleDraft(): EntryRuleDraft {
  return {
    event: "",
    timing: "",
    observationWindow: { start: "", end: "", unit: "" },
    trigger: "",
    eventParams: [],
    execution: { quantityMethod: "", lotSize: "", slippageModel: "", commissionModel: "", constraintsText: "" },
    position: { sizingMethod: "", positionRatio: "", fixedAmount: "", maxExposure: "", maxSinglePosition: "" },
    risk: {
      stopLoss: "",
      maxDrawdown: "",
      maxExposure: "",
      maxSinglePosition: "",
      maxPositions: "",
      dailyLossLimit: "",
      concentrationLimit: "",
      extensions: [],
    },
    document: {
      initialCapital: "",
      maxPositions: "",
      commissionRate: "",
      stampDutyRate: "",
      transferFeeRate: "",
      slippageBps: "",
      lotSize: "",
      minCommission: "",
    },
  };
}

export function emptyExitRuleDraft(): ExitRuleDraft {
  return { stopLoss: "", takeProfit: "", holdingDays: "" };
}

export function emptyRiskRuleDraft(): RiskRuleDraft {
  return { maxPositions: "", maxPositionWeight: "" };
}

export function emptyParameterRow(): ParameterRowDraft {
  return { code: "", type: "number", min: "", max: "", step: "", allowedValuesText: "" };
}

/** 全部片段为空 ⇒ 该块视为「未填写」，JSON 里直接省略（而不是写一堆空对象）。 */
function entryRuleDraftIsBlank(draft: EntryRuleDraft): boolean {
  const window_ = draft.observationWindow;
  const exec = draft.execution;
  const position = draft.position;
  const risk = draft.risk;
  const doc = draft.document;
  const riskNonEmpty = [
    risk.stopLoss, risk.maxDrawdown, risk.maxExposure, risk.maxSinglePosition,
    risk.maxPositions, risk.dailyLossLimit, risk.concentrationLimit,
  ].some((t) => t.trim() !== "") || risk.extensions.some((r) => r.key.trim() !== "");
  const docNonEmpty = Object.values(doc).some((t) => t.trim() !== "");
  return (
    draft.event.trim() === ""
    && draft.timing.trim() === ""
    && draft.trigger.trim() === ""
    && draft.eventParams.every((r) => r.key.trim() === "")
    && [window_.start, window_.end, window_.unit].every((t) => t.trim() === "")
    && [exec.quantityMethod, exec.lotSize, exec.slippageModel, exec.commissionModel, exec.constraintsText]
      .every((t) => t.trim() === "")
    && [position.sizingMethod, position.positionRatio, position.fixedAmount, position.maxExposure, position.maxSinglePosition]
      .every((t) => t.trim() === "")
    && !riskNonEmpty
    && !docNonEmpty
  );
}

// ---------------------------------------------------------------------------
// JSON → 草稿
// ---------------------------------------------------------------------------

function unknownKeysOf(record: JsonRecord, allowed: readonly string[]): string[] {
  return Object.keys(record).filter((k) => record[k] !== undefined && !allowed.includes(k));
}

const ENTRY_RULE_KEYS = ["event", "timing", "extra"] as const;
const WINDOW_KEYS = ["start", "end", "unit"] as const;
const EXECUTION_KEYS = ["quantityMethod", "lotSize", "slippageModel", "commissionModel", "executionConstraints"] as const;
const POSITION_KEYS = ["sizingMethod", "positionRatio", "fixedAmount", "maxExposure", "maxSinglePosition"] as const;
/** risk 里「文本框承载数值」的那批键（不含 extensions —— 那是键值行）。 */
const RISK_NUMBER_KEYS = [
  "stopLoss", "maxDrawdown", "maxExposure", "maxSinglePosition", "maxPositions",
  "dailyLossLimit", "concentrationLimit",
] as const;
const RISK_KEYS = [...RISK_NUMBER_KEYS, "extensions"] as const;
const DOCUMENT_KEYS = ["backtestConfig", "costModel"] as const;
const BACKTEST_KEYS = ["initialCapital", "maxPositions"] as const;
const COST_MODEL_KEYS = [
  "commissionRate", "stampDutyRate", "transferFeeRate", "slippageBps", "lotSize", "minCommission",
] as const;

const FILTER_RULE_KEYS = ["groups"] as const;
const CONDITION_GROUP_KEYS = ["groupNo", "groupLogicalOperator", "conditions"] as const;
const CONDITION_ROW_KEYS = [
  "groupNo", "sortOrder", "fieldName", "operator", "value", "logicalOperator", "groupLogicalOperator",
] as const;
const EXIT_RULE_KEYS = ["stopLoss", "takeProfit", "holdingDays"] as const;
const RISK_RULE_KEYS = ["maxPositions", "maxPositionWeight"] as const;
const PARAMETER_SPACE_ROW_KEYS = ["type", "min", "max", "step", "allowedValues"] as const;

const OPERATOR_VALUES: readonly string[] = CANDIDATE_CONDITION_OPERATOR_OPTIONS.map((o) => o.value);
const EVENT_VALUES: readonly string[] = CANDIDATE_EVENT_OPTIONS.map((o) => o.value);
const TIMING_VALUES: readonly string[] = CANDIDATE_ENTRY_TIMING_OPTIONS.map((o) => o.value);
const WINDOW_UNIT_VALUES: readonly string[] = CANDIDATE_WINDOW_UNIT_OPTIONS.map((o) => o.value);
const TRIGGER_VALUES: readonly string[] = CANDIDATE_TRIGGER_OPTIONS.map((o) => o.value);
const QUANTITY_VALUES: readonly string[] = CANDIDATE_QUANTITY_METHOD_OPTIONS.map((o) => o.value);
const SIZING_VALUES: readonly string[] = CANDIDATE_SIZING_METHOD_OPTIONS.map((o) => o.value);
const PARAMETER_TYPE_VALUES: readonly string[] = CANDIDATE_PARAMETER_TYPE_OPTIONS.map((o) => o.value);
/** 滑点 / 佣金模型的可选值（`STRATEGY_COST_MODELS`）。 */
const COST_MODEL_VALUES: readonly string[] = CANDIDATE_COST_MODEL_OPTIONS.map((o) => o.value);

function enumDraft(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function keyValueRowsFromJson(record: JsonRecord, path: string): { ok: true; rows: KeyValueRowDraft[] } | { ok: false; reason: string } {
  const rows: KeyValueRowDraft[] = [];
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "boolean") rows.push({ key, valueType: "boolean", value: String(value) });
    else if (typeof value === "number") {
      if (!Number.isFinite(value)) return { ok: false, reason: `${path}.${key} 不是有限数字` };
      rows.push({ key, valueType: "number", value: String(value) });
    } else if (typeof value === "string") rows.push({ key, valueType: "string", value });
    else return { ok: false, reason: `${path}.${key} 既不是字符串也不是数字/布尔（表单无法表达）` };
  }
  return { ok: true, rows };
}

function numberText(value: unknown, path: string): { ok: true; text: string } | { ok: false; reason: string } {
  const text = scalarText(value);
  if (text === null) return { ok: false, reason: `${path} 不是可编辑的标量` };
  return { ok: true, text };
}

/** `entryRule` → 草稿。任何无法表达的内容都会让它整块变成只读。 */
export function toEntryRuleState(value: unknown): SketchFieldState<EntryRuleDraft> {
  if (value === undefined || value === null) return { kind: "empty" };
  if (!isPlainObject(value)) {
    return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: "entryRule 不是对象" };
  }
  const bad: string[] = [];
  const offenders = unknownKeysOf(value, ENTRY_RULE_KEYS);
  if (offenders.length > 0) bad.push(`顶层出现未收录的键：${offenders.join("、")}`);

  const draft = emptyEntryRuleDraft();
  draft.event = enumDraft(value.event);
  if (value.event !== undefined && value.event !== null && draft.event === "") {
    bad.push("event 不是字符串");
  }
  draft.timing = enumDraft(value.timing);
  if (value.timing !== undefined && value.timing !== null && draft.timing === "") {
    bad.push("timing 不是字符串");
  }

  const extraRaw = value.extra;
  if (extraRaw !== undefined && extraRaw !== null) {
    if (!isPlainObject(extraRaw)) {
      bad.push("entryRule.extra 不是对象");
    } else {
      const extraOffenders = unknownKeysOf(extraRaw, CANDIDATE_SKETCH_EXTENSION_KEYS);
      if (extraOffenders.length > 0) {
        bad.push(`extra 出现未收录的扩展键：${extraOffenders.join("、")}`);
      }

      // observationWindow
      const win = extraRaw.observationWindow;
      if (win !== undefined && win !== null) {
        if (!isPlainObject(win)) bad.push("extra.observationWindow 不是对象");
        else {
          const off = unknownKeysOf(win, WINDOW_KEYS);
          if (off.length > 0) bad.push(`extra.observationWindow 出现未收录的键：${off.join("、")}`);
          for (const [key, target] of [["start", "start"], ["end", "end"], ["unit", "unit"]] as const) {
            const parsed = numberText(win[key], `extra.observationWindow.${key}`);
            if (!parsed.ok) bad.push(parsed.reason);
            else if (target === "unit") draft.observationWindow.unit = parsed.text;
            else draft.observationWindow[target] = parsed.text;
          }
        }
      }

      // trigger：字符串简写或 { type }
      const trigger = extraRaw.trigger;
      if (trigger !== undefined && trigger !== null) {
        if (typeof trigger === "string") draft.trigger = trigger;
        else if (isPlainObject(trigger)) {
          const off = unknownKeysOf(trigger, ["type"]);
          if (off.length > 0) bad.push(`extra.trigger 出现未收录的键：${off.join("、")}`);
          draft.trigger = enumDraft(trigger.type);
        } else bad.push("extra.trigger 既不是字符串也不是对象");
      }

      // eventParams
      if (extraRaw.eventParams !== undefined && extraRaw.eventParams !== null) {
        if (!isPlainObject(extraRaw.eventParams)) bad.push("extra.eventParams 不是对象");
        else {
          const parsed = keyValueRowsFromJson(extraRaw.eventParams, "extra.eventParams");
          if (!parsed.ok) bad.push(parsed.reason);
          else draft.eventParams = parsed.rows;
        }
      }

      // execution
      const exec = extraRaw.execution;
      if (exec !== undefined && exec !== null) {
        if (!isPlainObject(exec)) bad.push("extra.execution 不是对象");
        else {
          const off = unknownKeysOf(exec, EXECUTION_KEYS);
          if (off.length > 0) bad.push(`extra.execution 出现未收录的键：${off.join("、")}`);
          draft.execution.quantityMethod = enumDraft(exec.quantityMethod);
          draft.execution.slippageModel = enumDraft(exec.slippageModel);
          draft.execution.commissionModel = enumDraft(exec.commissionModel);
          const lot = numberText(exec.lotSize, "extra.execution.lotSize");
          if (!lot.ok) bad.push(lot.reason);
          else draft.execution.lotSize = lot.text;
          const constraints = exec.executionConstraints;
          if (constraints !== undefined && constraints !== null) {
            if (!Array.isArray(constraints) || constraints.some((c) => typeof c !== "string")) {
              bad.push("extra.execution.executionConstraints 不是字符串数组");
            } else {
              draft.execution.constraintsText = (constraints as string[]).join(",");
            }
          }
        }
      }

      // position
      const position = extraRaw.position;
      if (position !== undefined && position !== null) {
        if (!isPlainObject(position)) bad.push("extra.position 不是对象");
        else {
          const off = unknownKeysOf(position, POSITION_KEYS);
          if (off.length > 0) {
            // maxPositions 在这里出现是**服务端明令禁止**的（唯一权威是 riskRule.maxPositions）
            bad.push(`extra.position 出现未收录的键：${off.join("、")}`);
          }
          draft.position.sizingMethod = enumDraft(position.sizingMethod);
          for (const key of ["positionRatio", "fixedAmount", "maxExposure", "maxSinglePosition"] as const) {
            const parsed = numberText(position[key], `extra.position.${key}`);
            if (!parsed.ok) bad.push(parsed.reason);
            else draft.position[key] = parsed.text;
          }
        }
      }

      // risk
      const risk = extraRaw.risk;
      if (risk !== undefined && risk !== null) {
        if (!isPlainObject(risk)) bad.push("extra.risk 不是对象");
        else {
          const off = unknownKeysOf(risk, RISK_KEYS);
          if (off.length > 0) bad.push(`extra.risk 出现未收录的键：${off.join("、")}`);
          for (const key of [
            "stopLoss", "maxDrawdown", "maxExposure", "maxSinglePosition",
            "maxPositions", "dailyLossLimit", "concentrationLimit",
          ] as const) {
            const parsed = numberText(risk[key], `extra.risk.${key}`);
            if (!parsed.ok) bad.push(parsed.reason);
            else draft.risk[key] = parsed.text;
          }
          if (risk.extensions !== undefined && risk.extensions !== null) {
            if (!isPlainObject(risk.extensions)) bad.push("extra.risk.extensions 不是对象");
            else {
              const parsed = keyValueRowsFromJson(risk.extensions, "extra.risk.extensions");
              if (!parsed.ok) bad.push(parsed.reason);
              else draft.risk.extensions = parsed.rows;
            }
          }
        }
      }

      // document
      const document_ = extraRaw.document;
      if (document_ !== undefined && document_ !== null) {
        if (!isPlainObject(document_)) bad.push("extra.document 不是对象");
        else {
          const off = unknownKeysOf(document_, DOCUMENT_KEYS);
          if (off.length > 0) bad.push(`extra.document 出现未收录的键：${off.join("、")}`);
          const backtest = document_.backtestConfig;
          if (backtest !== undefined && backtest !== null) {
            if (!isPlainObject(backtest)) bad.push("extra.document.backtestConfig 不是对象");
            else {
              const bo = unknownKeysOf(backtest, BACKTEST_KEYS);
              if (bo.length > 0) bad.push(`extra.document.backtestConfig 出现未收录的键：${bo.join("、")}`);
              const capital = numberText(backtest.initialCapital, "extra.document.backtestConfig.initialCapital");
              if (!capital.ok) bad.push(capital.reason);
              else draft.document.initialCapital = capital.text;
              const maxPositions = numberText(backtest.maxPositions, "extra.document.backtestConfig.maxPositions");
              if (!maxPositions.ok) bad.push(maxPositions.reason);
              else draft.document.maxPositions = maxPositions.text;
            }
          }
          const cost = document_.costModel;
          if (cost !== undefined && cost !== null) {
            if (!isPlainObject(cost)) bad.push("extra.document.costModel 不是对象");
            else {
              const co = unknownKeysOf(cost, COST_MODEL_KEYS);
              if (co.length > 0) bad.push(`extra.document.costModel 出现未收录的键：${co.join("、")}`);
              for (const key of COST_MODEL_KEYS) {
                const parsed = numberText(cost[key], `extra.document.costModel.${key}`);
                if (!parsed.ok) bad.push(parsed.reason);
                else draft.document[key] = parsed.text;
              }
            }
          }
        }
      }
    }
  }

  if (bad.length > 0) {
    return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: bad.join("；") };
  }
  if (entryRuleDraftIsBlank(draft)) return { kind: "empty" };
  return { kind: "structured", draft };
}

/** `exitRule` → 草稿。 */
export function toExitRuleState(value: unknown): SketchFieldState<ExitRuleDraft> {
  if (value === undefined || value === null) return { kind: "empty" };
  if (!isPlainObject(value)) {
    return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: "exitRule 不是对象" };
  }
  const bad: string[] = [];
  const off = unknownKeysOf(value, EXIT_RULE_KEYS);
  if (off.length > 0) {
    bad.push(
      off.includes("extra")
        ? "exitRule.extra 非空 —— 服务端未定义该扩展槽的语义，转正时会直接失败（避免两处扩展槽造成歧义）"
        : `exitRule 出现未收录的键：${off.join("、")}`,
    );
  }
  const draft = emptyExitRuleDraft();
  for (const key of EXIT_RULE_KEYS) {
    const parsed = numberText(value[key], `exitRule.${key}`);
    if (!parsed.ok) bad.push(parsed.reason);
    else draft[key] = parsed.text;
  }
  if (bad.length > 0) return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: bad.join("；") };
  if (Object.values(draft).every((t) => t.trim() === "")) return { kind: "empty" };
  return { kind: "structured", draft };
}

/** `riskRule` → 草稿。 */
export function toRiskRuleState(value: unknown): SketchFieldState<RiskRuleDraft> {
  if (value === undefined || value === null) return { kind: "empty" };
  if (!isPlainObject(value)) {
    return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: "riskRule 不是对象" };
  }
  const bad: string[] = [];
  const off = unknownKeysOf(value, RISK_RULE_KEYS);
  if (off.length > 0) {
    bad.push(
      off.includes("regimeGate")
        ? "riskRule.regimeGate —— Strategy 的 risk 段没有条件组字段，转正时会被明确拒绝（不会被静默丢弃）"
        : off.includes("extra")
          ? "riskRule.extra 非空 —— 服务端未定义该扩展槽的语义，转正时会直接失败"
          : `riskRule 出现未收录的键：${off.join("、")}`,
    );
  }
  const draft = emptyRiskRuleDraft();
  for (const key of RISK_RULE_KEYS) {
    const parsed = numberText(value[key], `riskRule.${key}`);
    if (!parsed.ok) bad.push(parsed.reason);
    else draft[key] = parsed.text;
  }
  if (bad.length > 0) return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: bad.join("；") };
  if (Object.values(draft).every((t) => t.trim() === "")) return { kind: "empty" };
  return { kind: "structured", draft };
}

/** `parameterSpace` → 草稿。 */
export function toParameterSpaceState(value: unknown): SketchFieldState<ParameterRowDraft[]> {
  if (value === undefined || value === null) return { kind: "empty" };
  if (!isPlainObject(value)) {
    return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: "parameterSpace 不是对象" };
  }
  const rows: ParameterRowDraft[] = [];
  for (const code of Object.keys(value)) {
    const spec = value[code];
    if (!isPlainObject(spec)) {
      return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: `parameterSpace.${code} 不是对象` };
    }
    const off = unknownKeysOf(spec, PARAMETER_SPACE_ROW_KEYS);
    if (off.length > 0) {
      return {
        kind: "raw",
        rawText: JSON.stringify(value, null, 2),
        reason: `parameterSpace.${code} 出现未收录的键：${off.join("、")}`,
      };
    }
    const row = emptyParameterRow();
    row.code = code;
    row.type = enumDraft(spec.type);
    for (const key of ["min", "max", "step"] as const) {
      const parsed = numberText(spec[key], `parameterSpace.${code}.${key}`);
      if (!parsed.ok) {
        return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: parsed.reason };
      }
      row[key] = parsed.text;
    }
    if (spec.allowedValues !== undefined && spec.allowedValues !== null) {
      if (!Array.isArray(spec.allowedValues) || spec.allowedValues.some((v) => typeof v !== "string")) {
        return {
          kind: "raw",
          rawText: JSON.stringify(value, null, 2),
          reason: `parameterSpace.${code}.allowedValues 只接受字符串数组（数值范围请用 min / max）`,
        };
      }
      row.allowedValuesText = (spec.allowedValues as string[]).join(",");
    }
    rows.push(row);
  }
  if (rows.length === 0) return { kind: "empty" };
  return { kind: "structured", draft: rows };
}

/** `filterRule` → 草稿（复用分析条件编辑器的草稿模型与值解析）。 */
export function toFilterRuleState(value: unknown): SketchFieldState<ConditionGroupDraft[]> {
  if (value === undefined || value === null) return { kind: "empty" };
  if (!isPlainObject(value)) {
    return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: "filterRule 不是对象" };
  }
  const off = unknownKeysOf(value, FILTER_RULE_KEYS);
  if (off.length > 0) {
    return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: `filterRule 出现未收录的键：${off.join("、")}` };
  }
  const groups = value.groups;
  if (groups === undefined || groups === null) return { kind: "empty" };
  if (!Array.isArray(groups)) {
    return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: "filterRule.groups 不是数组" };
  }

  const flat: AnalysisConditionInput[] = [];
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi];
    if (!isPlainObject(group)) {
      return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: `filterRule.groups[${gi}] 不是对象` };
    }
    const groupOff = unknownKeysOf(group, CONDITION_GROUP_KEYS);
    if (groupOff.length > 0) {
      return {
        kind: "raw",
        rawText: JSON.stringify(value, null, 2),
        reason: `filterRule.groups[${gi}] 出现未收录的键：${groupOff.join("、")}`,
      };
    }
    const rows = group.conditions;
    if (!Array.isArray(rows)) {
      return {
        kind: "raw",
        rawText: JSON.stringify(value, null, 2),
        reason: `filterRule.groups[${gi}].conditions 不是数组`,
      };
    }
    const groupLogicalOperator = group.groupLogicalOperator === "OR" ? "OR" : "AND";
    const groupNo = typeof group.groupNo === "number" ? group.groupNo : gi;
    for (let ri = 0; ri < rows.length; ri += 1) {
      const row = rows[ri];
      const path = `filterRule.groups[${gi}].conditions[${ri}]`;
      if (!isPlainObject(row)) {
        return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: `${path} 不是对象` };
      }
      const rowOff = unknownKeysOf(row, CONDITION_ROW_KEYS);
      if (rowOff.length > 0) {
        return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: `${path} 出现未收录的键：${rowOff.join("、")}` };
      }
      const operator = typeof row.operator === "string" ? row.operator : "";
      if (!OPERATOR_VALUES.includes(operator)) {
        return {
          kind: "raw",
          rawText: JSON.stringify(value, null, 2),
          reason: `${path}.operator = ${JSON.stringify(operator)} 不在转正支持的 8 个运算符内`
            + `（${OPERATOR_VALUES.join(" / ")}）；Strategy 词表没有 BETWEEN / IS_NULL 这类值`,
        };
      }
      const fieldName = typeof row.fieldName === "string" ? row.fieldName : "";
      const valueRaw = row.value;
      const allowedValue =
        isScalar(valueRaw)
        || (Array.isArray(valueRaw) && valueRaw.every((v) => isScalar(v)));
      if (!allowedValue) {
        return { kind: "raw", rawText: JSON.stringify(value, null, 2), reason: `${path}.value 不是标量或标量数组` };
      }
      flat.push({
        groupNo,
        sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : ri,
        fieldName,
        operator: operator as ResearchConditionOperator,
        value: valueRaw,
        logicalOperator: row.logicalOperator === "OR" || row.logicalOperator === "NOT"
          ? row.logicalOperator
          : "AND",
        groupLogicalOperator,
      });
    }
  }

  if (flat.length === 0) return { kind: "empty" };
  const drafts = conditionPayloadToDraftGroups(flat);
  return { kind: "structured", draft: drafts };
}

/** 候选草稿原始 JSON（来自 `strategyCandidate.get`）→ 五块状态。 */
export function toSketchDrafts(raw: {
  entryRule?: unknown;
  filterRule?: unknown;
  exitRule?: unknown;
  riskRule?: unknown;
  parameterSpace?: unknown;
}): CandidateSketchDrafts {
  return {
    entryRule: toEntryRuleState(raw.entryRule),
    filterRule: toFilterRuleState(raw.filterRule),
    exitRule: toExitRuleState(raw.exitRule),
    riskRule: toRiskRuleState(raw.riskRule),
    parameterSpace: toParameterSpaceState(raw.parameterSpace),
  };
}

/** 空五块（新建 / 全部未填写时用）。 */
export function emptySketchDrafts(): CandidateSketchDrafts {
  return {
    entryRule: { kind: "empty" },
    filterRule: { kind: "empty" },
    exitRule: { kind: "empty" },
    riskRule: { kind: "empty" },
    parameterSpace: { kind: "empty" },
  };
}

// ---------------------------------------------------------------------------
// 草稿 → JSON（只产出后端认得的键）
// ---------------------------------------------------------------------------

function rowsToJson(rows: readonly KeyValueRowDraft[]): JsonRecord | undefined {
  const out: JsonRecord = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "") continue;
    const value = textToScalar(row.value, row.valueType);
    if (value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function entryRuleDraftToJson(draft: EntryRuleDraft): JsonRecord {
  const out: JsonRecord = {};
  if (draft.event.trim() !== "") out.event = draft.event;
  if (draft.timing.trim() !== "") out.timing = draft.timing;

  const extra: JsonRecord = {};
  const window_ = draft.observationWindow;
  if ([window_.start, window_.end, window_.unit].some((t) => t.trim() !== "")) {
    extra.observationWindow = {
      ...(textToOptionalNumber(window_.start) === undefined ? {} : { start: textToOptionalNumber(window_.start) }),
      ...(textToOptionalNumber(window_.end) === undefined ? {} : { end: textToOptionalNumber(window_.end) }),
      ...(window_.unit.trim() === "" ? {} : { unit: window_.unit }),
    };
  }
  if (draft.trigger.trim() !== "") extra.trigger = draft.trigger;
  const eventParams = rowsToJson(draft.eventParams);
  if (eventParams !== undefined) extra.eventParams = eventParams;

  const exec = draft.execution;
  if ([exec.quantityMethod, exec.lotSize, exec.slippageModel, exec.commissionModel, exec.constraintsText]
    .some((t) => t.trim() !== "")) {
    const constraints = csvToList(exec.constraintsText);
    extra.execution = {
      ...(exec.quantityMethod.trim() === "" ? {} : { quantityMethod: exec.quantityMethod }),
      ...(textToOptionalNumber(exec.lotSize) === undefined ? {} : { lotSize: textToOptionalNumber(exec.lotSize) }),
      ...(exec.slippageModel.trim() === "" ? {} : { slippageModel: exec.slippageModel }),
      ...(exec.commissionModel.trim() === "" ? {} : { commissionModel: exec.commissionModel }),
      ...(constraints.length === 0 ? {} : { executionConstraints: constraints }),
    };
  }

  const position = draft.position;
  if ([position.sizingMethod, position.positionRatio, position.fixedAmount, position.maxExposure, position.maxSinglePosition]
    .some((t) => t.trim() !== "")) {
    extra.position = {
      ...(position.sizingMethod.trim() === "" ? {} : { sizingMethod: position.sizingMethod }),
      ...(textToOptionalNumber(position.positionRatio) === undefined ? {} : { positionRatio: textToOptionalNumber(position.positionRatio) }),
      ...(textToOptionalNumber(position.fixedAmount) === undefined ? {} : { fixedAmount: textToOptionalNumber(position.fixedAmount) }),
      ...(textToOptionalNumber(position.maxExposure) === undefined ? {} : { maxExposure: textToOptionalNumber(position.maxExposure) }),
      ...(textToOptionalNumber(position.maxSinglePosition) === undefined ? {} : { maxSinglePosition: textToOptionalNumber(position.maxSinglePosition) }),
    };
  }

  const risk = draft.risk;
  const riskNumbers = RISK_NUMBER_KEYS;
  const riskExtensions = rowsToJson(risk.extensions);
  if (riskNumbers.some((key) => risk[key].trim() !== "") || riskExtensions !== undefined) {
    const riskJson: JsonRecord = {};
    for (const key of riskNumbers) {
      const value = textToOptionalNumber(risk[key]);
      if (value !== undefined) riskJson[key] = value;
    }
    if (riskExtensions !== undefined) riskJson.extensions = riskExtensions;
    extra.risk = riskJson;
  }

  const doc = draft.document;
  if (Object.values(doc).some((t) => t.trim() !== "")) {
    const backtest: JsonRecord = {};
    const capital = textToOptionalNumber(doc.initialCapital);
    if (capital !== undefined) backtest.initialCapital = capital;
    const docMaxPositions = textToOptionalNumber(doc.maxPositions);
    if (docMaxPositions !== undefined) backtest.maxPositions = docMaxPositions;
    const cost: JsonRecord = {};
    for (const key of ["commissionRate", "stampDutyRate", "transferFeeRate", "slippageBps", "lotSize", "minCommission"] as const) {
      const value = textToOptionalNumber(doc[key]);
      if (value !== undefined) cost[key] = value;
    }
    extra.document = { backtestConfig: backtest, costModel: cost };
  }

  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}

export function exitRuleDraftToJson(draft: ExitRuleDraft): JsonRecord {
  const out: JsonRecord = {};
  for (const key of EXIT_RULE_KEYS) {
    const value = textToOptionalNumber(draft[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function riskRuleDraftToJson(draft: RiskRuleDraft): JsonRecord {
  const out: JsonRecord = {};
  for (const key of RISK_RULE_KEYS) {
    const value = textToOptionalNumber(draft[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function parameterSpaceDraftToJson(rows: readonly ParameterRowDraft[]): JsonRecord {
  const out: JsonRecord = {};
  for (const row of rows) {
    const code = row.code.trim();
    if (code === "") continue;
    const spec: JsonRecord = { type: row.type };
    const min = textToOptionalNumber(row.min);
    const max = textToOptionalNumber(row.max);
    const step = textToOptionalNumber(row.step);
    if (min !== undefined) spec.min = min;
    if (max !== undefined) spec.max = max;
    if (step !== undefined) spec.step = step;
    const allowed = csvToList(row.allowedValuesText);
    if (allowed.length > 0) spec.allowedValues = allowed;
    out[code] = spec;
  }
  return out;
}

/**
 * 条件组草稿 → `filterRule` 的**嵌套**形态。
 *
 * 复用 `conditionGroupsToPayload`（与分析条件同一条载荷构造路径：组号重排为 0..n-1、
 * 组内 sortOrder 紧凑编号、值由运算符元数决定），再按 groupNo 聚回 `ResearchConditionSet`。
 * 两条路径共用同一个构造器 ⇒ 不会出现「分析能过、候选过不了」的口径分叉。
 */
export function filterRuleDraftToJson(groups: readonly ConditionGroupDraft[]): JsonRecord {
  const flat = conditionGroupsToPayload(groups);
  const byGroup = new Map<number, AnalysisConditionInput[]>();
  for (const row of flat) {
    const list = byGroup.get(row.groupNo) ?? [];
    list.push(row);
    byGroup.set(row.groupNo, list);
  }
  const groupNos = [...byGroup.keys()].sort((a, b) => a - b);
  return {
    groups: groupNos.map((groupNo) => {
      const rows = [...(byGroup.get(groupNo) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        groupNo,
        groupLogicalOperator: rows[0]?.groupLogicalOperator ?? "AND",
        conditions: rows.map((row, index) => ({
          groupNo,
          sortOrder: index,
          fieldName: row.fieldName,
          operator: row.operator,
          value: row.value ?? null,
          logicalOperator: row.logicalOperator,
          groupLogicalOperator: row.groupLogicalOperator,
        })),
      };
    }),
  };
}

/** 「这个 JSON 里什么都没有」——空对象、空数组、以及只含它们的容器都算空。 */
function isEmptySketchJson(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.every(isEmptySketchJson);
  if (isPlainObject(value)) return Object.keys(value).every((key) => isEmptySketchJson(value[key]));
  return false;
}

/** 五块草图字段键（顺序固定，因此补丁键序也是确定的）。 */
const SKETCH_KEYS = ["entryRule", "filterRule", "exitRule", "riskRule", "parameterSpace"] as const;

/** 五块各自的「草稿 → JSON」构造器 —— **唯一**一份映射（补丁与展示共用，不会分叉）。 */
const SKETCH_JSON_BUILDERS = {
  entryRule: entryRuleDraftToJson,
  filterRule: filterRuleDraftToJson,
  exitRule: exitRuleDraftToJson,
  riskRule: riskRuleDraftToJson,
  parameterSpace: parameterSpaceDraftToJson,
} as const satisfies Record<SketchBlockKey, unknown>;

function buildSketchJson(key: SketchBlockKey, draft: unknown): unknown {
  const builder = SKETCH_JSON_BUILDERS[key] as unknown as (draft: unknown) => unknown;
  return builder(draft);
}

/**
 * 单块状态的**规范 JSON 值**。
 *
 *   - `null` = 未填写 / 清空（空对象与空数组也归到 `null`：`extra: {}` 与「没有 extra」是同一件事）；
 *   - `undefined` = **只读块**，表示「不参与提交」，由调用方跳过。
 *
 * 「规范」这件事很重要：它让「打开编辑、什么都不改、点保存」与「改回原样」都不会产生写入
 * （否则 `extra: {}` 这种写法差异会被误判成一次改动）。
 */
export function canonicalSketchJson(key: SketchBlockKey, state: SketchFieldState<unknown>): unknown {
  if (state.kind === "empty") return null;
  if (state.kind === "raw") return undefined;
  const value = buildSketchJson(key, state.draft);
  return isEmptySketchJson(value) ? null : value;
}

/** 五块状态 → 完整草图 JSON（只含可提交的块；`raw` 块被跳过）。 */
export function sketchDraftsToJson(drafts: CandidateSketchDrafts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SKETCH_KEYS) {
    const value = canonicalSketchJson(key, drafts[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** 五块里是否至少有一块可编辑（全部 `raw` ⇒ 表单没有可提交内容）。 */
export function hasEditableSketchBlock(drafts: CandidateSketchDrafts): boolean {
  return Object.values(drafts).some((state) => state.kind !== "raw");
}

/** 每块状态的中文名（错误信息与「还缺什么」清单共用）。 */
export const SKETCH_BLOCK_LABELS = {
  entryRule: "入场规则",
  /**
   * ⚠️ 中文标签从「过滤条件」改成「**买入条件**」不是措辞偏好，是**语义纠正**：
   * 该块的唯一去向是 `entry.conditions`（`definitionBuild.ts:506-508`），
   * 而 `entry.conditions` 的语义是「**全部满足才产生买入信号**」，**不是「剔掉什么」**。
   * 沿用「剔除」这个词会让用户写出方向相反的条件（见文件头纪律 4）。
   */
  filterRule: "买入条件",
  exitRule: "出场规则",
  riskRule: "风控规则",
  parameterSpace: "参数空间",
} as const;
export type SketchBlockKey = keyof typeof SKETCH_BLOCK_LABELS;

// ---------------------------------------------------------------------------
// 界面段：按「交易决策顺序」组织（与后端 5 块是「多段共享一块」的关系）
// ---------------------------------------------------------------------------

/**
 * 界面段。**按人下单时的思路排序**，而不是按后端字段名排序。
 *
 * 为什么要有这一层：后端只有 5 个 `*Json` 列 —— 那是**存储**边界，不是给人看的目录。
 * 人想的是「买什么 → 什么价买 → 怎么卖 → 买多少 → 成本」。直接拿列名当标题，
 * 用户面对的就是一堆 `entryRule.extra.position.maxExposure` 级别的选择。
 *
 * 🔴 段**不是**第二套存储语义：它只是 5 块草图上的一个视图，写入仍然只落那 5 列。
 *    特别注意 `entryRule` 一块同时承载 ①②④⑤ 四段（事件 / 窗口与时点 / 仓位执行 / 文档成本），
 *    所以「某一块变成只读」会同时影响多段。
 */
export const SKETCH_SEGMENTS = [
  {
    key: "what",
    title: "买什么",
    hint: "先定「什么样的机会值得看」。事件类型是转正必填。",
    blocks: ["entryRule"],
    initBlocks: ["entryRule"],
  },
  {
    key: "when",
    title: "什么价买",
    hint:
      "「什么条件买」+「什么时候买」两件事："
      + "买入条件决定「哪一天算满足」，入场时点 / 观察窗口 / 触发时点决定「满足之后在哪根 bar 成交」。",
    blocks: ["entryRule", "filterRule"],
    initBlocks: ["entryRule"],
  },
  {
    key: "exit",
    title: "怎么卖",
    hint: "止损 / 止盈 / 持有交易日数；三者都可留空（留空 = 持有到回测期末）",
    blocks: ["exitRule"],
    initBlocks: ["exitRule"],
  },
  {
    key: "sizing",
    title: "买多少 · 最多持几只",
    hint: "仓位方式、下单口径、每手股数与最大同时持仓数",
    blocks: ["entryRule", "riskRule"],
    initBlocks: ["entryRule", "riskRule"],
  },
  {
    key: "cost",
    title: "成本与资金",
    hint: "初始资金与六项成本费率；可用「A 股标准」一键套用",
    blocks: ["entryRule"],
    initBlocks: ["entryRule"],
  },
  {
    key: "parameters",
    title: "参数搜索空间",
    hint: "留给后续参数搜索的取值域（可选；不填就不做参数搜索）",
    blocks: ["parameterSpace"],
    initBlocks: ["parameterSpace"],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  title: string;
  hint: string;
  blocks: readonly SketchBlockKey[];
  initBlocks: readonly SketchBlockKey[];
}>;

export type SketchSegmentKey = (typeof SKETCH_SEGMENTS)[number]["key"];

/** 段的界面顺序（与 `SKETCH_SEGMENTS` 同序，供遍历用）。 */
export const SKETCH_SEGMENT_KEYS: readonly SketchSegmentKey[] = SKETCH_SEGMENTS.map((s) => s.key);

export function sketchSegmentTitle(segment: SketchSegmentKey): string {
  return SKETCH_SEGMENTS.find((s) => s.key === segment)?.title ?? segment;
}

/**
 * 该段是否承担**转正必填**项。决定折叠态徽标是「还差 N 项 / 齐了 / 可选」。
 *
 * 单列成表而不是塞进 `SKETCH_SEGMENTS` 的字面量里：`Record<SketchSegmentKey, boolean>`
 * 能给出**穷尽性检查** —— 将来加一段忘了定性，这里先红。
 */
export const SKETCH_SEGMENT_REQUIRED: Record<SketchSegmentKey, boolean> = {
  what: true,
  when: true,
  exit: false,
  sizing: true,
  cost: true,
  parameters: false,
};

/** 段 → 它读写的草图块（同一块可被多段共享）。 */
export function sketchSegmentBlocks(segment: SketchSegmentKey): readonly SketchBlockKey[] {
  return SKETCH_SEGMENTS.find((s) => s.key === segment)?.blocks ?? [];
}

/** 段 → 「开始填写」时要初始化的块（只含必填载体；可选块不主动初始化）。 */
export function sketchSegmentInitBlocks(segment: SketchSegmentKey): readonly SketchBlockKey[] {
  return SKETCH_SEGMENTS.find((s) => s.key === segment)?.initBlocks ?? [];
}

/**
 * 块 → 它**首次**出现的段（只读块的原始内容挂在这里显示一次，不重复四遍）。
 *
 * ⚠️ `filterRule` 的归属段是 **`when`（什么价买）** 而不是 `what`（买什么）——
 * 因为它表达的是「满足什么条件才买」，与「观察哪类事件」不是一件事。
 * 这个归属同时决定只读时原始 JSON 挂在哪一段。
 */
export const SKETCH_BLOCK_HOME_SEGMENT: Record<SketchBlockKey, SketchSegmentKey> = {
  entryRule: "what",
  filterRule: "when",
  exitRule: "exit",
  riskRule: "sizing",
  parameterSpace: "parameters",
};

/**
 * 缺口的**机器可读落点**：填平这条缺口要动哪个输入框。
 *
 * 为什么非要有它：编辑器此前在段上只显示「还差 N 项」这个**数量**，
 * 用户看得到「差一项」却看不到「差哪一项」—— 于是把段里看得见的都填完，
 * 徽标仍然停在「还差 1 项」，只能靠猜。（真实案例：`when` 段缺 `entryRule.timing`。）
 *
 * 🔴 锚点与 `label` **在同一个 `gap(...)` 调用点产生**，因此不存在
 * 「清单说 A、高亮落在 B」的第二套说法 —— 这正是 `gaps` / `gapDetails` 同源纪律的延伸。
 */
export const SKETCH_FIELD_ANCHORS = [
  "entryRule.event",
  "entryRule.timing",
  "entryRule.observationWindow",
  "entryRule.trigger",
  "entryRule.execution.quantityMethod",
  "entryRule.execution.lotSize",
  "entryRule.position.sizingMethod",
  "entryRule.document.initialCapital",
  "entryRule.document.costModel",
  "riskRule.maxPositions",
] as const;
export type SketchFieldAnchor = (typeof SKETCH_FIELD_ANCHORS)[number];

/**
 * 结构化缺口：与 `SketchValidation.gaps`（字符串）**同源**，额外带上归属段与落点，
 * 好让界面把「还差什么」既做成可点击跳转、又能把琥珀标记直接落到那个输入框上。
 */
export interface SketchGap {
  readonly segment: SketchSegmentKey;
  readonly label: string;
  /**
   * 能填平它的输入框集合。用数组而不是单值：**「入场规则整块未填」时一条缺口同时
   * 对应三个输入框**（时点 / 窗口 / 触发），拆成三条会让段上的计数虚高。
   * 整块级缺口（如 `raw` 块提示）没有单一落点 ⇒ 空数组。
   */
  readonly anchors: readonly SketchFieldAnchor[];
}

// ---------------------------------------------------------------------------
// 段摘要（折叠态的一行中文）与段状态
// ---------------------------------------------------------------------------

function textOf(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 数字文本 → 人话比例（`0.05` → `5%`）；空 / 非数字 ⇒ `null`。 */
function rateText(text: string): string | null {
  const trimmed = textOf(text);
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return `${Number((n * 100).toFixed(4))}%`;
}

/** 数字文本 → 人话金额；空 / 非数字 ⇒ `null`。 */
function capitalText(text: string): string | null {
  const trimmed = textOf(text);
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (n >= 10000 && n % 10000 === 0) return `${Number((n / 10000).toFixed(6))} 万`;
  return n.toLocaleString("zh-CN");
}

function countText(text: string, unit: string): string | null {
  const trimmed = textOf(text);
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return `${n} ${unit}`;
}

function joinSummary(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

const RAW_SUMMARY = "原始 JSON（只读）";

function summarizeWhat(drafts: CandidateSketchDrafts): string {
  const parts: Array<string | null> = [];
  const entry = drafts.entryRule;
  if (entry.kind === "structured") {
    parts.push(
      entry.draft.event.trim() === ""
        ? null
        : candidateOptionLabel(CANDIDATE_EVENT_OPTIONS, entry.draft.event),
    );
    const params = entry.draft.eventParams.filter((row) => row.key.trim() !== "");
    if (params.length > 0) parts.push(`${params.length} 个事件参数`);
  } else if (entry.kind === "raw") {
    parts.push("入场规则（只读）");
  }
  // ⚠️ 条件**不在这里**：`filterRule` 表达的是「买入条件（满足才买）」，归属「什么价买」段。
  //    第 ① 段（买什么）只讲「观察哪一类事件」，这样两段的折叠摘要各自回答一个问题。
  return joinSummary(parts);
}

/**
 * 把条件组翻成**人话整句**（段摘要与只读卡片共用，不各写一份）。
 *
 * 逻辑连接符照实翻：`AND` → 「且」、`OR` → 「或」、`NOT` → 「且非」。
 * ⚠️ 这不是装饰 —— 转正会把 `OR`/`NOT` **静默压成 AND**（见 `conditionsUseNonConjunction`），
 * 所以这里必须照实显示草稿的**原意**，由调用方在别处给出警告。
 */
export function describeFilterGroups(groups: readonly ConditionGroupDraft[]): string {
  const LOGICAL: Record<string, string> = { AND: " 且 ", OR: " 或 ", NOT: " 且非 " };
  const groupTexts: string[] = [];
  for (const group of groups) {
    const rows = group.conditions.filter((condition) => condition.fieldName.trim() !== "");
    if (rows.length === 0) continue;
    const text = rows
      .map((condition, index) => {
        const sentence = describeCandidateCondition(condition.fieldName, condition.operator, condition.value);
        return index === 0 ? sentence : `${LOGICAL[condition.logicalOperator] ?? " 且 "}${sentence}`;
      })
      .join("");
    groupTexts.push(groupTexts.length === 0 || group.logicalOperator !== "OR" ? text : `或者${text}`);
  }
  return groupTexts.join(" 且 ");
}

/**
 * 条件里是否用了 `OR` / `NOT`（⇒ 转正时会被**静默压成 AND**）。
 *
 * 🔴 依据：转正转换器 `definitionBuild.ts#buildConditions` 把**所有条件组扁平化**成
 * `ConditionDefinition[]`，而该结构**没有逻辑运算符字段** ⇒ `entry.conditions` 实际是
 * **全部 AND**。所以草稿里的 `OR` / `NOT` 转正后**不报错、不留痕迹**，策略却被改成另一个意思
 * —— 这类「静默改变语义」必须在界面上说出来，而不是让用户以为自己写对了。
 *
 * 只看 `index > 0`：Research 条件模型里首个组 / 组内首条的连接符**无前序、不参与求值**
 * （`researchCore/conditions.ts` 注释），界面也不给首条显示运算符下拉。
 */
export function conditionsUseNonConjunction(groups: readonly ConditionGroupDraft[]): boolean {
  return groups.some(
    (group, groupIndex) =>
      (groupIndex > 0 && group.logicalOperator === "OR")
      || group.conditions.some(
        (condition, conditionIndex) =>
          conditionIndex > 0 && (condition.logicalOperator === "OR" || condition.logicalOperator === "NOT"),
      ),
  );
}

function summarizeWhen(drafts: CandidateSketchDrafts): string {
  const filter = drafts.filterRule;
  let conditionsText: string | null = null;
  if (filter.kind === "structured") {
    const text = describeFilterGroups(filter.draft);
    conditionsText = text === "" ? null : `买入条件：${text}`;
  } else if (filter.kind === "raw") {
    conditionsText = "买入条件（只读，表单表达不了）";
  }

  const entry = drafts.entryRule;
  if (entry.kind === "raw") return joinSummary([RAW_SUMMARY, conditionsText]);
  if (entry.kind !== "structured") return joinSummary([conditionsText]);
  const draft = entry.draft;
  const win = draft.observationWindow;
  const windowText =
    win.start.trim() !== "" && win.end.trim() !== "" && win.unit.trim() !== ""
      ? `观察第 ${Number(win.start)}–${Number(win.end)} ${candidateOptionLabel(CANDIDATE_WINDOW_UNIT_OPTIONS, win.unit)}`
      : null;
  return joinSummary([
    draft.timing.trim() === "" ? null : candidateOptionLabel(CANDIDATE_ENTRY_TIMING_OPTIONS, draft.timing),
    windowText,
    draft.trigger.trim() === ""
      ? null
      : `${candidateOptionLabel(CANDIDATE_TRIGGER_OPTIONS, draft.trigger)}触发`,
    conditionsText,
  ]);
}

const NO_EXIT_SUMMARY = "未设置 —— 会持有到回测期末";

function summarizeExit(drafts: CandidateSketchDrafts): string {
  const state = drafts.exitRule;
  if (state.kind === "raw") return RAW_SUMMARY;
  if (state.kind !== "structured") return NO_EXIT_SUMMARY;
  const draft = state.draft;
  const stopLoss = rateText(draft.stopLoss);
  const takeProfit = rateText(draft.takeProfit);
  const summary = joinSummary([
    stopLoss === null ? null : `止损 ${stopLoss}`,
    takeProfit === null ? null : `止盈 ${takeProfit}`,
    countText(draft.holdingDays, "个交易日后卖出"),
  ]);
  return summary === "" ? NO_EXIT_SUMMARY : summary;
}

function summarizeSizing(drafts: CandidateSketchDrafts): string {
  const parts: Array<string | null> = [];
  const risk = drafts.riskRule;
  if (risk.kind === "structured") {
    const maxPositions = countText(risk.draft.maxPositions, "只");
    if (maxPositions !== null) parts.push(`最多 ${maxPositions}`);
    const weight = rateText(risk.draft.maxPositionWeight);
    if (weight !== null) parts.push(`单标的 ≤ ${weight}`);
  } else if (risk.kind === "raw") {
    parts.push("风控规则（只读）");
  }
  const entry = drafts.entryRule;
  if (entry.kind === "structured") {
    const draft = entry.draft;
    parts.push(
      draft.position.sizingMethod.trim() === ""
        ? null
        : candidateOptionLabel(CANDIDATE_SIZING_METHOD_OPTIONS, draft.position.sizingMethod),
      draft.execution.quantityMethod.trim() === ""
        ? null
        : candidateOptionLabel(CANDIDATE_QUANTITY_METHOD_OPTIONS, draft.execution.quantityMethod),
      countText(draft.execution.lotSize, "股/手"),
    );
  } else if (entry.kind === "raw") {
    parts.push("仓位与执行（只读）");
  }
  return joinSummary(parts);
}

function summarizeCost(drafts: CandidateSketchDrafts): string {
  const entry = drafts.entryRule;
  if (entry.kind === "raw") return RAW_SUMMARY;
  if (entry.kind !== "structured") return "";
  const document = entry.draft.document;
  const capital = capitalText(document.initialCapital);
  const preset = matchCostPreset(document);
  return joinSummary([
    capital === null ? null : `本金 ${capital}`,
    preset === null ? (isCostAssumptionComplete(document) ? "自定义成本" : null) : `${preset.name}成本`,
  ]);
}

function summarizeParameters(drafts: CandidateSketchDrafts): string {
  const state = drafts.parameterSpace;
  if (state.kind === "raw") return RAW_SUMMARY;
  if (state.kind !== "structured") return "";
  const codes = state.draft.map((row) => row.code.trim()).filter((code) => code !== "");
  return codes.length === 0 ? "" : `${codes.length} 个参数：${codes.join("、")}`;
}

/** 某段折叠态的一行中文摘要（不产生任何新统计量，只是把已有草稿读成一句话）。 */
export function summarizeSketchSegment(
  drafts: CandidateSketchDrafts,
  segment: SketchSegmentKey,
): string {
  switch (segment) {
    case "what":
      return summarizeWhat(drafts);
    case "when":
      return summarizeWhen(drafts);
    case "exit":
      return summarizeExit(drafts);
    case "sizing":
      return summarizeSizing(drafts);
    case "cost":
      return summarizeCost(drafts);
    case "parameters":
      return summarizeParameters(drafts);
  }
}

/** 段的折叠态状态（界面只读这份，不自己去数缺口）。 */
export interface SketchSegmentStatus {
  readonly segment: SketchSegmentKey;
  readonly title: string;
  readonly blocks: readonly SketchBlockKey[];
  /** 本段覆盖到的**只读**块（非空 ⇒ 这些部分不可编辑）。 */
  readonly rawBlocks: readonly SketchBlockKey[];
  /** 本段承担的「转正还差」条数（≡ `gaps.length`）。 */
  readonly gapCount: number;
  /**
   * 本段缺口的**逐条明细**（`label` + 落点 `anchors`）。
   *
   * 只给 `gapCount` 是不够的：徽标说「还差 1 项」而段内每件事看起来都填了的时候，
   * 用户没有任何办法知道那 1 项是什么。编辑器把这份明细原样列在段内，并据此高亮输入框。
   */
  readonly gaps: readonly SketchGap[];
  /** 本段是否承担转正必填项（`false` ⇒ 整段都是可选的）。 */
  readonly required: boolean;
  /** 一行中文摘要（空串 = 还没填任何东西）。 */
  readonly summary: string;
  /** 覆盖块全部为「未填写」。 */
  readonly empty: boolean;
}

function segmentStatus(
  drafts: CandidateSketchDrafts,
  segment: SketchSegmentKey,
  gaps: readonly SketchGap[],
): SketchSegmentStatus {
  const blocks = sketchSegmentBlocks(segment);
  const segmentGaps = gaps.filter((item) => item.segment === segment);
  return {
    segment,
    title: sketchSegmentTitle(segment),
    blocks,
    rawBlocks: blocks.filter((block) => drafts[block].kind === "raw"),
    gapCount: segmentGaps.length,
    gaps: segmentGaps,
    required: SKETCH_SEGMENT_REQUIRED[segment],
    summary: summarizeSketchSegment(drafts, segment),
    empty: blocks.every((block) => drafts[block].kind === "empty"),
  };
}

export function sketchSegmentStatus(
  drafts: CandidateSketchDrafts,
  segment: SketchSegmentKey,
): SketchSegmentStatus {
  return segmentStatus(drafts, segment, validateSketchDrafts(drafts).gapDetails);
}

/** 一次算齐六段（缺口只算一次），界面按这个顺序渲染折叠面板。 */
export function sketchSegmentStatuses(
  drafts: CandidateSketchDrafts,
): ReadonlyArray<SketchSegmentStatus> {
  const gaps = validateSketchDrafts(drafts).gapDetails;
  return SKETCH_SEGMENTS.map((segment) => segmentStatus(drafts, segment.key, gaps));
}

// ---------------------------------------------------------------------------
// 校验：错误（填了但不合法）与缺口（转正必填但没填）
// ---------------------------------------------------------------------------

export interface SketchValidation {
  /** 填了但不合法 —— 阻止保存。 */
  errors: string[];
  /** 转正要求的必填项尚未填写 —— 不阻止保存（草稿本来就是渐进填写的）。 */
  gaps: string[];
  /** `gaps` 的结构化版本（多一个「归属哪一段」）；**与 `gaps` 同源同序**，不会各说各话。 */
  gapDetails: SketchGap[];
  /**
   * 内容合法、转正也能过，但**结果可能与你的意图不同** —— 既不阻止保存也不阻止转正。
   *
   * 目前只有一类：条件里用了 `OR` / `NOT`，而转正会把它们**静默压成 AND**
   * （见 `conditionsUseNonConjunction`）。这类「能过但意思变了」必须让用户看见。
   */
  warnings: string[];
}

/**
 * 缺口构造助手：段归属 + 中文说明 + **落点**（`label` 与 `anchors` 只在这里配对，
 * 因此界面上的「缺口清单」与「输入框高亮」不可能各说各话）。
 */
function gap(segment: SketchSegmentKey, label: string, ...anchors: SketchFieldAnchor[]): SketchGap {
  return { segment, label, anchors };
}

function requireInt(text: string, label: string, errors: string[], min = 1): void {
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    errors.push(`${label} 必须是 ≥ ${min} 的整数（当前：${JSON.stringify(text)}）`);
  }
}

function checkFiniteIfPresent(text: string, label: string, errors: string[]): void {
  if (text.trim() === "") return;
  const n = Number(text);
  if (!Number.isFinite(n)) errors.push(`${label} 必须是有限数字（当前：${JSON.stringify(text)}）`);
}

function checkEnumIfPresent(text: string, label: string, allowed: readonly string[], errors: string[]): void {
  if (text.trim() === "") return;
  if (!allowed.includes(text)) {
    errors.push(`${label} 只能是 ${allowed.join(" / ")}（当前：${JSON.stringify(text)}）`);
  }
}

function validateEntryRule(draft: EntryRuleDraft, errors: string[], gaps: SketchGap[]): void {
  if (draft.event.trim() === "") gaps.push(gap("what", "入场事件类型（转正必填）", "entryRule.event"));
  else checkEnumIfPresent(draft.event, "入场事件类型", EVENT_VALUES, errors);
  if (draft.timing.trim() === "") {
    gaps.push(
      gap("when", "入场时点（转正必填 —— 决定信号 bar / 成交 bar / 成交价）", "entryRule.timing"),
    );
  } else {
    checkEnumIfPresent(draft.timing, "入场时点", TIMING_VALUES, errors);
  }

  const win = draft.observationWindow;
  if ([win.start, win.end, win.unit].some((t) => t.trim() !== "")) {
    if (win.start.trim() === "" || win.end.trim() === "" || win.unit.trim() === "") {
      gaps.push(
        gap(
          "when",
          "观察窗口：起始 / 结束 / 单位要一起填（单位不会替你默认）",
          "entryRule.observationWindow",
        ),
      );
    } else {
      requireInt(win.start, "观察窗口起始（相对事件日的第几根）", errors, 1);
      requireInt(win.end, "观察窗口结束（相对事件日的第几根）", errors, 1);
      const start = Number(win.start);
      const end = Number(win.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
        errors.push(`观察窗口结束（${end}）不得早于起始（${start}）`);
      }
      checkEnumIfPresent(win.unit, "观察窗口单位", WINDOW_UNIT_VALUES, errors);
    }
  } else {
    gaps.push(gap("when", "观察窗口（起始 / 结束 / 单位）", "entryRule.observationWindow"));
  }

  if (draft.trigger.trim() === "") gaps.push(gap("when", "触发时点（条件满足后何时出信号）", "entryRule.trigger"));
  else checkEnumIfPresent(draft.trigger, "触发时点", TRIGGER_VALUES, errors);

  for (const row of draft.eventParams) {
    if (row.key.trim() === "") continue;
    if (row.value.trim() === "") errors.push(`事件参数「${row.key}」没填值（留空的行请删掉）`);
  }

  const exec = draft.execution;
  if (exec.quantityMethod.trim() === "") {
    gaps.push(gap("sizing", "下单口径 quantityMethod（转正必填）", "entryRule.execution.quantityMethod"));
  } else {
    checkEnumIfPresent(exec.quantityMethod, "执行方式", QUANTITY_VALUES, errors);
  }
  if (exec.lotSize.trim() === "") {
    gaps.push(gap("sizing", "每手股数 lotSize（转正必填）", "entryRule.execution.lotSize"));
  } else {
    requireInt(exec.lotSize, "每手股数 lotSize", errors);
  }
  checkEnumIfPresent(exec.slippageModel, "滑点模型", COST_MODEL_VALUES, errors);
  checkEnumIfPresent(exec.commissionModel, "佣金模型", COST_MODEL_VALUES, errors);
  for (const item of csvToList(exec.constraintsText)) {
    if (item.trim() === "") errors.push("执行约束里有空项");
  }

  const position = draft.position;
  if (position.sizingMethod.trim() === "") {
    gaps.push(gap("sizing", "仓位方式 sizingMethod（转正必填）", "entryRule.position.sizingMethod"));
  } else {
    checkEnumIfPresent(position.sizingMethod, "仓位方式", SIZING_VALUES, errors);
  }
  for (const key of ["positionRatio", "fixedAmount", "maxExposure", "maxSinglePosition"] as const) {
    checkFiniteIfPresent(position[key], `仓位.${key}`, errors);
  }

  const risk = draft.risk;
  for (const key of [
    "stopLoss", "maxDrawdown", "maxExposure", "maxSinglePosition",
    "maxPositions", "dailyLossLimit", "concentrationLimit",
  ] as const) {
    checkFiniteIfPresent(risk[key], `扩展风控.${key}`, errors);
  }
  if (risk.stopLoss.trim() !== "") {
    const v = Number(risk.stopLoss);
    if (Number.isFinite(v) && (v <= 0 || v >= 1)) errors.push("扩展风控.stopLoss 必须是 (0,1) 的比例");
  }
  if (risk.maxPositions.trim() !== "") requireInt(risk.maxPositions, "扩展风控.maxPositions", errors);
  for (const row of risk.extensions) {
    if (row.key.trim() === "") continue;
    if (row.value.trim() === "") errors.push(`扩展风控「${row.key}」没填值（留空的行请删掉）`);
  }

  const doc = draft.document;
  if (doc.initialCapital.trim() === "") {
    gaps.push(gap("cost", "初始资金 initialCapital（转正必填）", "entryRule.document.initialCapital"));
  } else {
    const v = Number(doc.initialCapital);
    if (!Number.isFinite(v) || v <= 0) errors.push("回测初始资金必须是 > 0 的数字");
  }
  if (doc.maxPositions.trim() !== "") requireInt(doc.maxPositions, "回测.maxPositions", errors);
  const costKeys = ["commissionRate", "stampDutyRate", "transferFeeRate", "slippageBps", "lotSize", "minCommission"] as const;
  const missingCost = costKeys.filter((k) => doc[k].trim() === "");
  if (missingCost.length === costKeys.length) {
    gaps.push(
      gap(
        "cost",
        "成本假设六项（佣金 / 印花税 / 过户费 / 滑点基点 / 每手股数 / 最低佣金）",
        "entryRule.document.costModel",
      ),
    );
  } else if (missingCost.length > 0) {
    gaps.push(
      gap(
        "cost",
        `成本假设还差：${missingCost.join(" / ")}（六项必须齐全）`,
        "entryRule.document.costModel",
      ),
    );
  }
  for (const key of costKeys) checkFiniteIfPresent(doc[key], `成本模型.${key}`, errors);
  if (doc.lotSize.trim() !== "") requireInt(doc.lotSize, "成本模型.lotSize", errors);
}

function validateFilterRule(
  groups: readonly ConditionGroupDraft[],
  errors: string[],
  warnings: string[],
): void {
  /**
   * 🔴 `OR` / `NOT` 警告（**不是错误**：草稿合法、转正也会通过，只是结果会变）。
   *
   * 转正转换器 `definitionBuild#buildConditions` 把所有条件组扁平化成 `ConditionDefinition[]`，
   * 该结构没有逻辑运算符字段 ⇒ `entry.conditions` 实际是**全部 AND**。
   * 用户写了「或」却得到「且」，策略方向可能完全相反 —— 必须说出来。
   */
  if (conditionsUseNonConjunction(groups)) {
    warnings.push(
      "买入条件里用了「或 / 且非」：转正时会**把所有条件当成「且」**（Strategy 的条件模型没有"
        + "逻辑运算符位），也就是「或」会变成「且」，含义会变。若这不是你想要的，请拆成多条独立条件"
        + "或改为只用「并且」。",
    );
  }
  groups.forEach((group, gi) => {
    group.conditions.forEach((condition, ci) => {
      const at = `买入条件 第 ${gi + 1} 组第 ${ci + 1} 条`;
      const field = condition.fieldName.trim();
      /**
       * 整行空白 =「界面上有一行、其实什么都没填」⇒ **静默跳过**。
       *
       * 这与 `conditionGroupsToPayload` 的既有口径同向（字段名空白的行「不落库也不占位」），
       * 也是「点了加一行但还没想好」的正常中间态 —— 不能拿它拦住保存。
       */
      if (field === "" && condition.value.trim() === "") return;
      if (field === "") {
        errors.push(`${at}：填了比较值但没选字段（空行请删掉）`);
        return;
      }
      if (parseCandidateFieldReference(field).kind === "unknown") {
        errors.push(
          `${at}：字段必须是 Strategy 字段引用（如 prefix.rd0.close / bar.close / event.turnover），`
            + `当前 ${JSON.stringify(field)} 无法解析；转正时不会被猜成某个时间域`,
        );
      }
      if (!OPERATOR_VALUES.includes(condition.operator)) {
        errors.push(`${at}：运算符 ${condition.operator} 不在转正支持的 8 个之内`);
        return;
      }
      const option = CANDIDATE_CONDITION_OPERATOR_OPTIONS.find((o) => o.value === condition.operator);
      if (option?.arity === "ONE" && condition.value.trim() === "") {
        errors.push(`${at}：缺比较值`);
      }
      if (option?.arity === "LIST" && csvToList(condition.value).length === 0) {
        errors.push(`${at}：属于 / 不属于 需要至少一个候选值（逗号分隔）`);
      }
    });
  });
}

function validateExitRule(draft: ExitRuleDraft, errors: string[]): void {
  checkFiniteIfPresent(draft.stopLoss, "止损比例", errors);
  if (draft.stopLoss.trim() !== "") {
    const v = Number(draft.stopLoss);
    if (Number.isFinite(v) && (v <= 0 || v >= 1)) errors.push("止损比例必须是 (0,1) 之间的比例（如 0.05）");
  }
  checkFiniteIfPresent(draft.takeProfit, "止盈比例", errors);
  if (draft.takeProfit.trim() !== "") {
    const v = Number(draft.takeProfit);
    if (Number.isFinite(v) && v <= 0) errors.push("止盈比例必须 > 0（如 0.10）");
  }
  if (draft.holdingDays.trim() !== "") requireInt(draft.holdingDays, "持有交易日数", errors);
}

function validateRiskRule(draft: RiskRuleDraft, errors: string[], gaps: SketchGap[]): void {
  if (draft.maxPositions.trim() === "") {
    gaps.push(
      gap(
        "sizing",
        "最大同时持仓数（转正必填，StrategyDefinition 的 position.maxPositions 只能来自这里）",
        "riskRule.maxPositions",
      ),
    );
  } else {
    requireInt(draft.maxPositions, "最大同时持仓数 maxPositions", errors);
  }
  checkFiniteIfPresent(draft.maxPositionWeight, "单标的仓位上限 maxPositionWeight", errors);
  if (draft.maxPositionWeight.trim() !== "") {
    const v = Number(draft.maxPositionWeight);
    if (Number.isFinite(v) && (v <= 0 || v > 1)) errors.push("单标的仓位上限应在 (0,1] 之间（占总资金比例）");
  }
}

function validateParameterSpace(rows: readonly ParameterRowDraft[], errors: string[]): void {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const at = `参数第 ${index + 1} 行`;
    const code = row.code.trim();
    /**
     * 整行空白（刚点「加参数」还没开始写）⇒ **静默跳过**。
     * `type` 有出厂值（`number`），因此不参与「是否空白」的判定。
     */
    const blank =
      code === "" && [row.min, row.max, row.step, row.allowedValuesText].every((t) => t.trim() === "");
    if (blank) return;
    if (code === "") {
      errors.push(`${at}：填了取值域但还没写参数名（空行请删掉）`);
      return;
    }
    if (seen.has(code)) errors.push(`${at}：参数名 ${code} 重复`);
    seen.add(code);
    checkEnumIfPresent(row.type, `${at} 类型`, PARAMETER_TYPE_VALUES, errors);
    checkFiniteIfPresent(row.min, `${at} min`, errors);
    checkFiniteIfPresent(row.max, `${at} max`, errors);
    checkFiniteIfPresent(row.step, `${at} step`, errors);
    if (row.type === "number") {
      if (row.min.trim() === "" || row.max.trim() === "") {
        errors.push(`${at}：数值参数的 min 与 max 都要给（参数角色恒为 TUNABLE，转正不会替你定界）`);
      } else {
        const min = Number(row.min);
        const max = Number(row.max);
        if (Number.isFinite(min) && Number.isFinite(max) && min >= max) {
          errors.push(`${at}：min 必须小于 max`);
        }
      }
    } else if (csvToList(row.allowedValuesText).length === 0) {
      errors.push(`${at}：${row.type} 参数必须给出非空候选集合（逗号分隔）`);
    }
  });
}

/**
 * 五块草稿的整体校验。
 *
 * 分工（**不越权**）：这里只做「能不能提交」与「离转正还差什么」的**提示**；
 * 权威判定仍在服务端 `definitionBuild` + `validateCanonicalStrategyDefinition`。
 */
export function validateSketchDrafts(drafts: CandidateSketchDrafts): SketchValidation {
  const errors: string[] = [];
  const gapDetails: SketchGap[] = [];
  const warnings: string[] = [];

  const entry = drafts.entryRule;
  if (entry.kind === "empty") {
    /**
     * 「入场规则整块没填」按**段**拆成四句。
     *
     * 后端只有 `entryRule` 一个列，但界面上它被切成 ①买什么 / ②什么价买 / ④买多少 / ⑤成本
     * 四段；一句笼统的「入场规则整块还没填」在分段界面里没法定位到任何一段。
     */
    gapDetails.push(
      gap("what", "入场事件类型（转正必填）", "entryRule.event"),
      gap(
        "when",
        "入场时点 / 观察窗口 / 触发时点（转正必填）",
        "entryRule.timing",
        "entryRule.observationWindow",
        "entryRule.trigger",
      ),
      gap(
        "sizing",
        "下单口径 / 每手股数 / 仓位方式（转正必填）",
        "entryRule.execution.quantityMethod",
        "entryRule.execution.lotSize",
        "entryRule.position.sizingMethod",
      ),
      gap(
        "cost",
        "初始资金与成本假设六项（转正必填）",
        "entryRule.document.initialCapital",
        "entryRule.document.costModel",
      ),
    );
  } else if (entry.kind === "structured") {
    validateEntryRule(entry.draft, errors, gapDetails);
  }

  if (drafts.filterRule.kind === "structured") validateFilterRule(drafts.filterRule.draft, errors, warnings);

  /**
   * ⚠️ `exitRule` **不是**转正必填 —— 这是一处此前被我写错的地方，已核实纠正：
   * `definitionBuild` 允许 `exit.rules` 为空数组（草稿为空 ⇒ 不 push 任何 rule），
   * 既有校验器 `definitionValidation` 对它也**只检查「是数组」**，没有「至少一条」的约束。
   * 因此这里只做非法性校验、**不产出缺口**；「没设出场规则」由该段摘要与展开态提示表达，
   * 既不阻断保存也不阻断转正。
   */
  if (drafts.exitRule.kind === "structured") validateExitRule(drafts.exitRule.draft, errors);

  const risk = drafts.riskRule;
  if (risk.kind === "empty") {
    gapDetails.push(gap("sizing", "最大同时持仓数（转正必填）", "riskRule.maxPositions"));
  } else if (risk.kind === "structured") {
    validateRiskRule(risk.draft, errors, gapDetails);
  }

  if (drafts.parameterSpace.kind === "structured") {
    validateParameterSpace(drafts.parameterSpace.draft, errors);
  }

  for (const [key, state] of Object.entries(drafts) as Array<[SketchBlockKey, SketchFieldState<unknown>]>) {
    if (state.kind === "raw") {
      gapDetails.push(
        gap(
          SKETCH_BLOCK_HOME_SEGMENT[key],
          `${SKETCH_BLOCK_LABELS[key]}含表单无法表达的内容，本次不会被提交（原因见该块提示）`,
        ),
      );
    }
  }

  // `gaps` 与 `gapDetails` **同源同序**（前者是后者的投影），不会出现两套说法。
  return { errors, gaps: gapDetails.map((item) => item.label), gapDetails, warnings };
}

/** 「还差什么才能转正」的纯缺口清单（给界面做清单用，不含错误）。 */
export function promotionGaps(drafts: CandidateSketchDrafts): string[] {
  return validateSketchDrafts(drafts).gaps;
}

// ---------------------------------------------------------------------------
// patch 构造
// ---------------------------------------------------------------------------

export interface SketchPatchResult {
  ok: boolean;
  /** 只含**改动过**的键；`null` = 显式清空。 */
  patch: Record<string, unknown>;
  errors: string[];
}

const SKETCH_PATCH_KEYS = SKETCH_KEYS;

/**
 * 原始草图 JSON + 五块草稿 → `research.strategyCandidate.update` 的草图部分补丁。
 *
 * 规则：
 *   - 比较基准是**规范形**（`canonicalSketchJson`），因此 `extra: {}` 这类写法差异
 *     不会被误判成改动 —— 「打开编辑、什么都不改、点保存」不产生任何写入；
 *   - **只提交改动过的块**；
 *   - `raw` 块**永不提交**（其内容表单表达不了，提交等于替用户删字段）；
 *     原值不可表达时按**字面原值**比，所以「清空一个 raw 块」仍能被识别为一次真实改动；
 *   - 空草稿 → `null`（显式清空），而不是省略键；
 *   - 全部没改 → 空补丁（调用方会连同空补丁一起拒绝，后端亦拒绝「成功但没变」）。
 */
export function buildSketchPatch(
  original: Record<string, unknown>,
  drafts: CandidateSketchDrafts,
): SketchPatchResult {
  const errors = validateSketchDrafts(drafts).errors;
  if (errors.length > 0) return { ok: false, patch: {}, errors };

  const originalStates = toSketchDrafts(original);
  const patch: Record<string, unknown> = {};
  for (const key of SKETCH_PATCH_KEYS) {
    const state = drafts[key];
    if (state.kind === "raw") continue;
    const originalState = originalStates[key];
    const before = originalState.kind === "raw"
      ? (original[key] ?? null)
      : canonicalSketchJson(key, originalState);
    const after = canonicalSketchJson(key, state);
    if (!sketchValuesEqual(before, after)) patch[key] = after;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, patch: {}, errors: ["草图没有任何字段被修改（后端会拒绝空补丁）。"] };
  }
  return { ok: true, patch, errors: [] };
}

// ---------------------------------------------------------------------------
// 视图辅助
// ---------------------------------------------------------------------------

/** 条件草稿的空白组（供「加一组」）。 */
export function emptyFilterRuleGroups(): ConditionGroupDraft[] {
  return [createEmptyConditionGroup()];
}

export type { ConditionDraft, ConditionGroupDraft };
