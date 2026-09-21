
import {
  CANDIDATE_CONDITION_VALUE_TYPE_OPTIONS,
  CANDIDATE_COST_MODEL_OPTIONS,
  CANDIDATE_ENTRY_TIMING_OPTIONS,
  CANDIDATE_EVENT_OPTIONS,
  CANDIDATE_PARAMETER_TYPE_OPTIONS,
  CANDIDATE_QUANTITY_METHOD_OPTIONS,
  CANDIDATE_SIZING_METHOD_OPTIONS,
  CANDIDATE_TRIGGER_OPTIONS,
  CANDIDATE_WINDOW_UNIT_OPTIONS,
  candidateOptionLabel,
  type SketchOption,
} from "../research/candidateSketchVocabulary";

// ---------------------------------------------------------------------------
// 与草图共用的表（同一批服务端词表，这里只做「定义侧命名」的再导出）
// ---------------------------------------------------------------------------

/** `definition.entry.event.type` ← 服务端 `STRATEGY_EVENT_TYPES`。 */
export const DEFINITION_EVENT_OPTIONS: readonly SketchOption[] = CANDIDATE_EVENT_OPTIONS;

/** `definition.entry.observationWindow.unit` ← `STRATEGY_WINDOW_UNITS`。 */
export const DEFINITION_WINDOW_UNIT_OPTIONS: readonly SketchOption[] = CANDIDATE_WINDOW_UNIT_OPTIONS;

/** `definition.entry.trigger.type` ← `STRATEGY_TRIGGER_TYPES`。 */
export const DEFINITION_TRIGGER_OPTIONS: readonly SketchOption[] = CANDIDATE_TRIGGER_OPTIONS;

/** `definition.position.sizingMethod` ← `STRATEGY_POSITION_SIZING_METHODS`。 */
export const DEFINITION_SIZING_METHOD_OPTIONS: readonly SketchOption[] = CANDIDATE_SIZING_METHOD_OPTIONS;

/** `definition.execution.quantityMethod` ← `STRATEGY_QUANTITY_METHODS`。 */
export const DEFINITION_QUANTITY_METHOD_OPTIONS: readonly SketchOption[] = CANDIDATE_QUANTITY_METHOD_OPTIONS;

/** `definition.execution.slippageModel` / `commissionModel` ← `STRATEGY_COST_MODELS`。 */
export const DEFINITION_COST_MODEL_OPTIONS: readonly SketchOption[] = CANDIDATE_COST_MODEL_OPTIONS;

/**
 * `definition.entry.conditions[].operator` —— 🔴 **服务端名称形**（`GREATER_THAN_OR_EQUAL`），
 * **不是**符号形（`>=`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这是一个真实的坑，不是风格问题
 * ═══════════════════════════════════════════════════════════════════════════
 * 「同一个运算符在两处词表里是两种写法」：
 *   - **研究草图的 `filterRule.operator`** 用**符号**（`>` / `>=` / `IN` …），
 *     由 `strategyCandidate/definitionBuild.ts#CONDITION_OPERATOR_MAP` 在转正时翻成名称；
 *   - **Canonical `definition.entry.conditions[].operator`** 直接存**名称**。
 *
 * 真实库里 8 个带定义的策略，条件的 `operator` 逐字是
 * `GREATER_THAN_OR_EQUAL` / `LESS_THAN_OR_EQUAL` / `LESS_THAN`
 * （见 `docs/evidence/_probe_strategy_definition_shape.json`）。
 * 若在这里复用草图的**符号表**，用户一改运算符就会写出
 * `{ operator: ">=" }` —— 一个 `STRATEGY_CONDITION_OPERATORS` 里不存在的值，
 * 服务端当场拒绝。因此这张表**必须**是名称形，且**不能**与草图那张共用。
 *
 * `SYMBOL_TO_OPERATOR_NAME` 是「草图符号 → 服务端名称」的唯一翻译入口，用于把草图的
 * **条件预设**搬进定义编辑器（预设本身是符号形的）；它与服务端
 * `definitionBuild.ts#CONDITION_OPERATOR_MAP` **逐字对应**，由对表测试锁住。
 */
export interface DefinitionConditionOperatorOption extends SketchOption {
  /** 需要几个值：1 = 单值，LIST = 逗号分隔的候选集合。 */
  readonly arity: "ONE" | "LIST";
  /** 写进人话句子的符号形（**只用于显示**，绝不写回文档）。 */
  readonly symbol: string;
}

export const DEFINITION_CONDITION_OPERATOR_OPTIONS: readonly DefinitionConditionOperatorOption[] = [
  { value: "GREATER_THAN", symbol: " 大于 ", arity: "ONE", label: "大于（>）" },
  { value: "GREATER_THAN_OR_EQUAL", symbol: " 大于等于 ", arity: "ONE", label: "大于等于（≥）" },
  { value: "LESS_THAN", symbol: " 小于 ", arity: "ONE", label: "小于（<）" },
  { value: "LESS_THAN_OR_EQUAL", symbol: " 小于等于 ", arity: "ONE", label: "小于等于（≤）" },
  { value: "EQUAL", symbol: " 等于 ", arity: "ONE", label: "等于（=）" },
  { value: "NOT_EQUAL", symbol: " 不等于 ", arity: "ONE", label: "不等于（≠）" },
  { value: "IN", symbol: " 属于 ", arity: "LIST", label: "属于（逗号分隔）" },
  { value: "NOT_IN", symbol: " 不属于 ", arity: "LIST", label: "不属于（逗号分隔）" },
];

/** 符号 → 服务端名称（≡ 服务端 `definitionBuild.ts#CONDITION_OPERATOR_MAP`）。 */
export const SYMBOL_TO_OPERATOR_NAME: Readonly<Record<string, string>> = {
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  "==": "EQUAL",
  "!=": "NOT_EQUAL",
  IN: "IN",
  NOT_IN: "NOT_IN",
};

/**
 * 草图的**符号形**运算符 → 定义侧名称。认不出来 ⇒ 返回 `""`。
 *
 * 返回空串而不是原样透传：把 `>=` 当名称写进定义会被服务端拒绝，
 * 调用方（预设按钮）据此**不插入**该条件，而不是插一条必错的行。
 */
export function symbolToDefinitionOperator(symbol: string): string {
  return SYMBOL_TO_OPERATOR_NAME[symbol.trim()] ?? "";
}

export function definitionConditionOperatorOf(
  operator: string,
): DefinitionConditionOperatorOption | undefined {
  return DEFINITION_CONDITION_OPERATOR_OPTIONS.find((option) => option.value === operator);
}

/** 运算符的人话符号形；未知取值原样返回（不猜）。 */
export function definitionOperatorSymbol(operator: string): string {
  const found = definitionConditionOperatorOf(operator);
  return found === undefined ? ` ${operator} ` : found.symbol;
}

/** `definition.entry.conditions[].valueType` ← `STRATEGY_CONDITION_VALUE_TYPES`。 */
export const DEFINITION_CONDITION_VALUE_TYPE_OPTIONS: readonly SketchOption[] =
  CANDIDATE_CONDITION_VALUE_TYPE_OPTIONS;

/** `definition.parameters[].dataType` ← `STRATEGY_PARAMETER_DATA_TYPES`。 */
export const DEFINITION_PARAMETER_TYPE_OPTIONS: readonly SketchOption[] = CANDIDATE_PARAMETER_TYPE_OPTIONS;

/**
 * `definition.execution.signalTiming` ← `STRATEGY_SIGNAL_TIMINGS`。
 *
 * ⚠️ 信号时点与成交时点**必须分开表达**（SPEC §15）。草图把这一对藏在一个 `timing` 下拉后面，
 * 定义侧则各自成字段 —— 因为定义里它们本来就是两个字段，且组合有硬约束（见 L6 警告）。
 */
export const DEFINITION_SIGNAL_TIMING_OPTIONS: readonly SketchOption[] = [
  {
    value: "T_CLOSE",
    label: "T 日收盘",
    note: "信号在事件/观察 bar 的收盘价上判定 —— 本项目 T+1 模型的常规选择",
  },
  {
    value: "T_OPEN",
    label: "T 日开盘",
    note: "信号在开盘价上判定（需要盘中/开盘可得的信息，前视风险更高）",
  },
];

/** `definition.execution.executionTiming` ← `STRATEGY_EXECUTION_TIMINGS`。 */
export const DEFINITION_EXECUTION_TIMING_OPTIONS: readonly SketchOption[] = [
  { value: "T_PLUS_1_OPEN", label: "T+1 开盘成交", note: "出信号后的次一交易日开盘价成交（默认口径）" },
  { value: "T_PLUS_1_CLOSE", label: "T+1 收盘成交", note: "出信号后的次一交易日收盘价成交" },
  { value: "T_PLUS_2_OPEN", label: "T+2 开盘成交", note: "隔两个交易日才成交（极端保守口径）" },
  {
    value: "T_CLOSE",
    label: "T 日收盘成交",
    note:
      "⚠️ 与「信号时点 = T 日收盘」同时使用会被后端 L6 直接拒绝"
      + "（SIGNAL_EXECUTION_TIMING_CONFLICT：成交不得早于或等于信号时点）。",
  },
];

/** `definition.execution.priceType` ← `STRATEGY_PRICE_TYPES`。 */
export const DEFINITION_PRICE_TYPE_OPTIONS: readonly SketchOption[] = [
  { value: "OPEN", label: "开盘价" },
  { value: "CLOSE", label: "收盘价" },
  { value: "HIGH", label: "最高价" },
  { value: "LOW", label: "最低价" },
  { value: "VWAP", label: "均价（VWAP）" },
];

/** `definition.exit.rules[].type` ← `STRATEGY_EXIT_RULE_TYPES`。 */
export const DEFINITION_EXIT_RULE_TYPE_OPTIONS: readonly SketchOption[] = [
  { value: "STOP_LOSS", label: "止损", note: "亏损达到阈值即离场（阈值通常是 RATIO，如 0.05 = -5%）" },
  { value: "TAKE_PROFIT", label: "止盈", note: "盈利达到阈值即离场" },
  { value: "TIME_EXIT", label: "到期离场", note: "持有满 N 个交易日离场（阈值单位用 TRADING_DAY）" },
  { value: "SIGNAL_EXIT", label: "信号离场", note: "出现反向信号时离场" },
  { value: "FORCED_EXIT", label: "强制离场", note: "外部条件强制平仓（如触及风控闸门）" },
];

/** `definition.exit.rules[].trigger` ← `STRATEGY_EXIT_TRIGGERS`。 */
export const DEFINITION_EXIT_TRIGGER_OPTIONS: readonly SketchOption[] = [
  { value: "ON_ENTRY", label: "入场时即判定" },
  { value: "ON_OPEN", label: "开盘时判定" },
  { value: "ON_CLOSE", label: "收盘时判定", note: "按收盘价判定，最不容易引入盘中前视" },
  { value: "INTRADAY", label: "盘中实时判定", note: "盘中触发（止损常用；需要日内数据）" },
];

/** `definition.exit.rules[].thresholdUnit` ← `STRATEGY_EXIT_THRESHOLD_UNITS`。 */
export const DEFINITION_EXIT_THRESHOLD_UNIT_OPTIONS: readonly SketchOption[] = [
  { value: "RATIO", label: "比例（0.05 = 5%）" },
  { value: "PERCENT", label: "百分数（5 = 5%）" },
  { value: "TRADING_DAY", label: "交易日数（整数）" },
  { value: "PRICE", label: "价格（元）" },
];

/** `definition.parameters[].parameterRole` ← `STRATEGY_PARAMETER_ROLES`。 */
export const DEFINITION_PARAMETER_ROLE_OPTIONS: readonly SketchOption[] = [
  { value: "FIXED", label: "固定值", note: "不参与参数搜索" },
  { value: "TUNABLE", label: "待搜索", note: "参数搜索会读这一批；数值参数必须给 min / max" },
  { value: "DERIVED", label: "推导值", note: "由其他参数推导（必须同时给 derivedFrom 表达式）" },
];

/** `definition.datasets[].role` ← `STRATEGY_DATASET_ROLES`。 */
export const DEFINITION_DATASET_ROLE_OPTIONS: readonly SketchOption[] = [
  { value: "PRIMARY", label: "主数据集" },
  { value: "VALIDATION", label: "验证集" },
  { value: "OOS", label: "样本外" },
];

// ---------------------------------------------------------------------------
// 标签查询
// ---------------------------------------------------------------------------

/**
 * 词表标签查询。找不到取值时**原样返回 value**，绝不编造一个像样的中文名
 * —— 否则界面上会出现「看着对、保存时被拒」的假标签。空串返回 `""`。
 */
export function definitionOptionLabel(options: readonly SketchOption[], value: string): string {
  return candidateOptionLabel(options, value);
}

/** 枚举值是否在词表内（保存前自检用；权威判定仍在服务端）。 */
export function isKnownDefinitionOption(options: readonly SketchOption[], value: string): boolean {
  return options.some((option) => option.value === value);
}
