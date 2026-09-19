/**
 * STRATEGY-ARCH-001 — Strategy Core：canonical 类型与词表（唯一权威）。
 *
 * 定位（规格 §3 / §13 / §14）：本模块是 **Strategy 语义的唯一事实来源**。
 * 它与任何 Backtest 类型 / 任何 Dataset / 任何执行引擎**解耦**：
 *
 *   Strategy（身份）
 *   └── StrategyVersion（不可变版本）
 *       ├── StrategyCoreDefinition
 *       │   ├── ruleGraph           RuleGraph（ALL/ANY/NOT/CONDITION/EVENT/WINDOW/SEQUENCE/TRIGGER）
 *       │   ├── featureRequirements 特征需求（只声明 id + 版本，不内联实现）
 *       │   ├── parameterSchema     参数定义（FIXED / TUNABLE / DERIVED）
 *       │   ├── dataRequirements    数据需求（frequency / fields / lookback / horizon / events）
 *       │   ├── executionSemantics  执行语义（signal / confirmation / execution / price / state）
 *       │   └── capabilities        能力（eventObservation / signalGeneration / entry / exit / position）
 *       ├── fingerprint            行为级指纹
 *       └── metadata               人类可读元数据（不进指纹）
 *
 * 铁律（沿用本项目策略域既有纪律）：
 *   - 纯模块：**无 DB / 无 IO / 无网络 / 无 Date.now / 无 Math.random**；时间一律注入；
 *   - 全部字段 `readonly`；可 canonical JSON 序列化；禁用 NaN / Infinity；
 *   - 确定性：同一输入 ⇒ 同一输出（含同一指纹）；
 *   - 失败响亮：非法输入抛带稳定 `code` 的领域错误，**绝不静默降级 / 绝不编默认值**；
 *   - **Strategy 不绑定 Dataset**（规格 §10）：Definition 里不得出现 datasetVersionId / 表名 / 引擎名；
 *     数据集坐标只允许出现在 `StrategyRunSnapshot`（规格 §16）。
 */

// ---------------------------------------------------------------------------
// 结构版本
// ---------------------------------------------------------------------------

/** Strategy Core Definition 的**结构**版本（与策略版本号无关；结构演进时递增）。 */
export const STRATEGY_CORE_SCHEMA_VERSION = "1.0" as const;

/** 支持的结构版本白名单（迁移时按此做兼容转换）。 */
export const STRATEGY_CORE_SCHEMA_VERSIONS = ["1.0"] as const;
export type StrategyCoreSchemaVersion = (typeof STRATEGY_CORE_SCHEMA_VERSIONS)[number];

// ---------------------------------------------------------------------------
// 基础标量
// ---------------------------------------------------------------------------

/** 参数 / 表达式可携带的标量值（可 JSON 序列化）。 */
export type CoreValue = number | string | boolean | null;

/** 决策时点（交易日 + 时点）。与 Backtest / Dataset 无关，只是「信息可见性」的坐标。 */
export interface EvaluationTime {
  /** 交易日（YYYY-MM-DD）。 */
  readonly date: string;
  /** 时点：open = 开盘后可见当日开盘；close = 收盘后可见当日完整 bar。 */
  readonly point: "open" | "close";
}

/** 相对日偏移：T = 0 / T-1 = -1 / T+1 = 1。 */
export type RelativeDay = number;

// ---------------------------------------------------------------------------
// RuleGraph 词表（规格 §5 / §7）
// ---------------------------------------------------------------------------

/** RuleGraph 节点种类（规格 §5 要求的最小闭集 + 规格 §7 的事件/条件/触发分层）。 */
export const RULE_NODE_KINDS = [
  "ALL",
  "ANY",
  "NOT",
  "CONDITION",
  "EVENT",
  "WINDOW",
  "SEQUENCE",
  "TRIGGER",
] as const;
export type RuleNodeKind = (typeof RULE_NODE_KINDS)[number];

/**
 * 比较运算符（**执行语义完整**：8 个全部可实现，不像 legacy `FeatureGate` 只有 5 个）。
 * `IN` / `NOT_IN` 的右值必须是常量数组或 `BINARY`/引用求值得到的数组。
 */
export const COMPARISON_OPERATORS = [
  "GT",
  "GTE",
  "LT",
  "LTE",
  "EQ",
  "NEQ",
  "IN",
  "NOT_IN",
] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/** 窗口量化器（规格 §5：`WINDOW` 必须显式声明「窗口内如何归约」，**不给默认值**）。 */
export const WINDOW_QUANTIFIERS = ["ALL_DAYS", "ANY_DAY"] as const;
export type WindowQuantifier = (typeof WINDOW_QUANTIFIERS)[number];

/** 事件类型（闭集 + `CUSTOM_EVENT` 扩展位；语义由 `params` 表达）。 */
export const CORE_EVENT_TYPES = [
  "FIRST_LIMIT_UP",
  "LIMIT_UP",
  "BREAKOUT",
  "PRICE_PATTERN",
  "CUSTOM_EVENT",
] as const;
export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

/** 触发时点（规格 §7 `Trigger`）：决定窗口内**哪一天**产出决策。 */
export const CORE_TRIGGER_TYPES = [
  "FIRST_VALID_DAY",
  "LAST_VALID_DAY",
  "EVERY_VALID_DAY",
  "NEXT_TRADING_DAY",
] as const;
export type CoreTriggerType = (typeof CORE_TRIGGER_TYPES)[number];

/** 时间单位（规格 §6）。 */
export const TEMPORAL_UNITS = ["TRADING_DAY", "CALENDAR_DAY"] as const;
export type TemporalUnit = (typeof TEMPORAL_UNITS)[number];

// ---------------------------------------------------------------------------
// 路径 / 状态机（规格 §11 state transition）
// ---------------------------------------------------------------------------

/** 持仓状态（执行语义声明的状态迁移图的节点）。 */
export const POSITION_STATES = ["FLAT", "PENDING_ENTRY", "LONG", "PENDING_EXIT"] as const;
export type PositionState = (typeof POSITION_STATES)[number];

/** 意图种类（状态迁移的边标签）。 */
export const INTENT_KINDS = ["OPEN", "CLOSE", "HOLD"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

// ---------------------------------------------------------------------------
// 参数词表（规格 §9）
// ---------------------------------------------------------------------------

/** 参数角色：`FIXED` 固定 / `TUNABLE` 可被 Parameter Search 搜索 / `DERIVED` 由其他参数推导。 */
export const PARAMETER_ROLES = ["FIXED", "TUNABLE", "DERIVED"] as const;
export type ParameterRole = (typeof PARAMETER_ROLES)[number];

/** 参数数据类型（规格 §9「类型校验」）。 */
export const PARAMETER_DATA_TYPES = ["number", "string", "boolean"] as const;
export type ParameterDataType = (typeof PARAMETER_DATA_TYPES)[number];

/** 参数 code 形态（与既有策略域一致，保证可复用既有参数校验器口径）。 */
export const PARAMETER_CODE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// 能力词表（规格 §14）
// ---------------------------------------------------------------------------

/**
 * 能力（规格 §14）：**取代 `backtestType`**。一个策略可同时具备多种能力，
 * 不同执行引擎只消费自己需要的那部分 StrategyDecision。
 */
export const STRATEGY_CAPABILITIES = [
  "eventObservation",
  "signalGeneration",
  "entryIntent",
  "exitIntent",
  "positionIntent",
] as const;
export type StrategyCapability = (typeof STRATEGY_CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// 数据需求词表（规格 §10）
// ---------------------------------------------------------------------------

/** 数据频率。 */
export const DATA_FREQUENCIES = ["1D", "5m", "30m"] as const;
export type DataFrequency = (typeof DATA_FREQUENCIES)[number];

/** 数据域（对齐既有 `requiredData` 口径，保持可复用）。 */
export const DATA_DOMAINS = ["OHLCV", "Turnover", "Status", "Industry", "Index", "CorpActions"] as const;
export type DataDomain = (typeof DATA_DOMAINS)[number];

// ---------------------------------------------------------------------------
// 执行语义词表（规格 §11）
// ---------------------------------------------------------------------------

/** 信号产生时点（相对信号 bar 的 T）。 */
export const SIGNAL_TIMINGS = ["T_OPEN", "T_CLOSE"] as const;
export type SignalTiming = (typeof SIGNAL_TIMINGS)[number];

/** 确认时点（信号在 bar 内何时被确认；规格 §11 confirmation timing）。 */
export const CONFIRMATION_TIMINGS = ["ON_BAR_OPEN", "ON_BAR_CLOSE"] as const;
export type ConfirmationTiming = (typeof CONFIRMATION_TIMINGS)[number];

/** 成交时点（相对信号 bar 的 T；本项目 T+1 模型的关键）。 */
export const EXECUTION_TIMINGS = ["T_CLOSE", "T_PLUS_1_OPEN", "T_PLUS_1_CLOSE", "T_PLUS_2_OPEN"] as const;
export type ExecutionTiming = (typeof EXECUTION_TIMINGS)[number];

/** 价格参考。 */
export const PRICE_REFERENCES = ["OPEN", "CLOSE", "HIGH", "LOW", "VWAP"] as const;
export type PriceReference = (typeof PRICE_REFERENCES)[number];

// ---------------------------------------------------------------------------
// 版本状态
// ---------------------------------------------------------------------------

/** StrategyVersion 生命周期（最小集：本模块只负责「不可变 + 发布闸门」，不实现完整治理状态机）。 */
export const STRATEGY_VERSION_STATUSES = ["DRAFT", "PUBLISHED", "DEPRECATED"] as const;
export type StrategyVersionStatus = (typeof STRATEGY_VERSION_STATUSES)[number];

// ---------------------------------------------------------------------------
// 领域错误
// ---------------------------------------------------------------------------

/** 领域错误码（跨层唯一；跨 tRPC 边界时须原样写进 message 前缀）。 */
export const STRATEGY_CORE_ERROR_CODES = [
  "CORE_DEFINITION_INVALID",
  "CORE_SCHEMA_VERSION_UNSUPPORTED",
  "RULE_NODE_INVALID",
  "RULE_GRAPH_INVALID",
  "EXPRESSION_INVALID",
  "EXPRESSION_DIVISION_BY_ZERO",
  "FIELD_REFERENCE_UNKNOWN",
  "FIELD_REFERENCE_FUTURE",
  "FEATURE_NOT_REGISTERED",
  "FEATURE_VERSION_MISMATCH",
  "FEATURE_LOOKBACK_INSUFFICIENT",
  "PARAMETER_UNKNOWN",
  "PARAMETER_MISSING_DEFAULT",
  "PARAMETER_TYPE_MISMATCH",
  "PARAMETER_OUT_OF_RANGE",
  "PARAMETER_NOT_ALLOWED_VALUE",
  "PARAMETER_NULL_NOT_ALLOWED",
  "PARAMETER_TUNABLE_REQUIRES_BOUNDS",
  "PARAMETER_DERIVED_MISSING_EXPRESSION",
  "PARAMETER_DERIVED_CYCLE",
  "PARAMETER_DERIVED_INVALID_RESULT",
  "PARAMETER_DERIVED_OVERRIDE_FORBIDDEN",
  "PARAMETER_DERIVED_UNPARSEABLE",
  "PARAMETER_SCHEMA_DUPLICATE_CODE",
  "DATA_REQUIREMENTS_UNSATISFIED",
  "DATASET_BINDING_IN_DEFINITION_FORBIDDEN",
  "EXECUTION_SEMANTICS_INVALID",
  "CAPABILITIES_MISMATCH",
  "VERSION_IMMUTABLE",
  "VERSION_NOT_FOUND",
  "SNAPSHOT_INVALID",
  "SNAPSHOT_FINGERPRINT_MISMATCH",
  "SNAPSHOT_VERSION_MISMATCH",
  "LEAKAGE_LOOK_AHEAD",
  "LEAKAGE_UNKNOWN_TIME_DOMAIN",
  "LEGACY_MAPPING_UNSUPPORTED",
  "LEGACY_DEFINITION_INVALID",
] as const;
export type StrategyCoreErrorCode = (typeof STRATEGY_CORE_ERROR_CODES)[number];

/** Strategy Core 领域错误（带稳定 code + 可选 detail）。 */
export class StrategyCoreError extends Error {
  readonly code: StrategyCoreErrorCode;
  readonly detail: Readonly<Record<string, CoreValue | readonly CoreValue[]>> | null;

  constructor(
    code: StrategyCoreErrorCode,
    message: string,
    detail?: Readonly<Record<string, CoreValue | readonly CoreValue[]>>,
  ) {
    super("[" + code + "] " + message);
    this.name = "StrategyCoreError";
    this.code = code;
    this.detail = detail ?? null;
  }
}

/** 结构化校验结果（不抛错；供审计与 UI 展示）。 */
export interface CoreValidationIssue {
  readonly code: StrategyCoreErrorCode | string;
  /** 以 **Definition 根** 为基准的路径（如 `ruleGraph.children[0]`）。 */
  readonly path: string;
  readonly message: string;
}

export interface CoreValidationResult {
  readonly valid: boolean;
  readonly issues: readonly CoreValidationIssue[];
}

export function validationIssue(
  code: CoreValidationIssue["code"],
  path: string,
  message: string,
): CoreValidationIssue {
  return { code, path, message };
}

export function validationResult(issues: readonly CoreValidationIssue[]): CoreValidationResult {
  return { valid: issues.length === 0, issues };
}

/** 非法即抛（响亮失败）。 */
export function assertValidCore(result: CoreValidationResult, code: StrategyCoreErrorCode): void {
  if (result.valid) return;
  const first = result.issues[0];
  throw new StrategyCoreError(
    code,
    result.issues.map((issue) => issue.path + ": " + issue.message).join(" | "),
    first === undefined ? undefined : { issueCode: first.code, issueCount: result.issues.length },
  );
}
