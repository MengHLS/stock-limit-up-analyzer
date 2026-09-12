/**
 * STEP STRATEGY-003 — Strategy Definition 富领域模型（类型权威源 + 词表 + 字段时间域目录）。
 *
 * 定位（SPEC §9 / §22 / §24）：StrategyDefinition 是「一个 StrategyVersion 的完整可复现规则快照」。
 * 它**嵌入 `StrategyDocument.definition`**（最终落到 `strategy_versions.strategyDocumentJson`），
 * 而不是另建并行领域模块或第二套 Source of Truth（用户裁定 D1）。
 *
 *   StrategyDefinition
 *   ├── schemaVersion   ← Definition 自身结构版本（≠ strategy version，SPEC §30）
 *   ├── entry           ← 研究什么事件 / 观察多久 / 满足什么条件 / 何时产生 Signal
 *   ├── exit            ← 什么时候卖（rules[]）
 *   ├── position        ← 买多少
 *   ├── risk            ← 如何控制风险（规则，不是风险评价结果）
 *   ├── execution       ← Signal 之后如何成交（signalTiming 与 executionTiming 严格分离）
 *   ├── parameters      ← 参数定义（FIXED / TUNABLE / DERIVED）
 *   └── datasets        ← Dataset **引用**（PRIMARY / VALIDATION / OOS），不复制任何 Dataset 数据
 *
 * 与 v1 既有字段的关系（SPEC §六：新模型增加能力，不一次性砍掉旧模型）：
 *   本文件**不修改** StrategyDocument 的任何一个既有字段。`map.ts` 提供 `deriveLegacyViews()`，
 *   由 Definition **单向派生** entryRules / exitRules / riskRules / positionSizing / parameters /
 *   executionModel，作为既有消费者的兼容视图（派生是有损的，映射表见 map.ts 注释与本目录报告）。
 *
 * 🔴 字段时间域目录（SPEC §十一 / §十二 / §二十六）——本文件是**唯一权威**：
 *   字段引用必须能判定「属于哪个时间域」。目录完全对齐本项目 Dataset 的真实五层语义
 *   （`server/datasetRegistry/naming.ts:11-16` 与 `shared/datasetRegistryContracts.ts:658-696`）：
 *
 *     event    时点身份（**不含逐日行情**）               → EVENT_DAY（事件日已公开信息）
 *     prefix   原始行情 relativeDay ∈ [-preWindowDays,0]  → PRE_EVENT（后视，PIT 安全）
 *     post     原始行情 relativeDay ∈ [1, postWindowDays] → FORWARD_BAR（前视：仅**信号日及之前**可用）
 *     path     衍生指标 relativeDay ∈ [1, postWindowDays] → LABEL_ONLY（文档明示「前视，仅打标签」）
 *     outcome  按 horizon 聚合结果                       → LABEL_ONLY（标签/未来结果）
 *
 *   注意：**T 日 OHLCV 在 `prefix.relativeDay = 0`，不在 `event` 表**（event 表无 OHLCV 列）。
 *   首板回踩的「首板日开盘价」因此写作 `prefix.rd0.open`，而不是 `event.open`。
 *
 *   无法判定时间域的引用（未知根、未知字段）→ `unknown` → Validation **默认拒绝**（默认拒绝白名单，
 *   而不是「黑名单里包含 future 就拒绝」这种可绕过的方案）。
 *
 * 铁律：纯模块（无 DB / 无 IO / 无 Date.now / 无 Math.random）；全部字段 readonly；可 JSON 序列化；
 * 禁用 NaN / Infinity；确定性；失败响亮。本模块**不含校验逻辑**（见 definitionValidation.ts），
 * 也**不含持久化**（见 strategyPersistence/）。
 */

import type { ResearchParameterValue } from "../types";

// ---------------------------------------------------------------------------
// Definition 自身结构版本（≠ strategy version，SPEC §30）
// ---------------------------------------------------------------------------

/**
 * StrategyDefinition **结构**版本。与 `StrategyDocument.version`（策略版本 major.minor.patch）
 * 完全不是一个概念：本字段描述「Definition 的 JSON 结构长什么样」，未来结构演进时递增
 * （1.0 → 1.1 → 2.0），供迁移/兼容判定。
 */
export const STRATEGY_DEFINITION_SCHEMA_VERSION = "1.0" as const;

/** 当前支持的 Definition 结构版本白名单（Migration 时按此白名单做兼容转换）。 */
export const STRATEGY_DEFINITION_SCHEMA_VERSIONS = ["1.0"] as const;

export type StrategyDefinitionSchemaVersion = (typeof STRATEGY_DEFINITION_SCHEMA_VERSIONS)[number];

// ---------------------------------------------------------------------------
// 词表白名单（SPEC §10.1「不要把事件类型永久写死成少数几个」→ 白名单 + 扩展位）
// ---------------------------------------------------------------------------

/** 事件类型白名单。`CUSTOM_EVENT` 为扩展位：具体语义由 `event.params.eventCode` 表达。 */
export const STRATEGY_EVENT_TYPES = [
  "FIRST_LIMIT_UP",
  "LIMIT_UP",
  "BREAKOUT",
  "PRICE_PATTERN",
  "CUSTOM_EVENT",
] as const;
export type StrategyEventType = (typeof STRATEGY_EVENT_TYPES)[number];

/** 观察窗口单位。量化系统默认 `TRADING_DAY`（SPEC §10.2）。 */
export const STRATEGY_WINDOW_UNITS = ["TRADING_DAY", "CALENDAR_DAY"] as const;
export type StrategyWindowUnit = (typeof STRATEGY_WINDOW_UNITS)[number];

/** 触发时点（条件满足后何时产生 Signal）。 */
export const STRATEGY_TRIGGER_TYPES = [
  "FIRST_VALID_DAY",
  "LAST_VALID_DAY",
  "EVERY_VALID_DAY",
  "NEXT_TRADING_DAY",
] as const;
export type StrategyTriggerType = (typeof STRATEGY_TRIGGER_TYPES)[number];

/** 条件比较操作符。 */
export const STRATEGY_CONDITION_OPERATORS = [
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "EQUAL",
  "NOT_EQUAL",
  "IN",
  "NOT_IN",
] as const;
export type StrategyConditionOperator = (typeof STRATEGY_CONDITION_OPERATORS)[number];

/** 条件右值类型（SPEC §10.3：CONSTANT / FIELD_REFERENCE / PARAMETER_REFERENCE，保留扩展能力）。 */
export const STRATEGY_CONDITION_VALUE_TYPES = [
  "CONSTANT",
  "FIELD_REFERENCE",
  "PARAMETER_REFERENCE",
] as const;
export type StrategyConditionValueType = (typeof STRATEGY_CONDITION_VALUE_TYPES)[number];

/** 出场规则类型（SPEC §12）。 */
export const STRATEGY_EXIT_RULE_TYPES = [
  "TAKE_PROFIT",
  "STOP_LOSS",
  "TIME_EXIT",
  "SIGNAL_EXIT",
  "FORCED_EXIT",
] as const;
export type StrategyExitRuleType = (typeof STRATEGY_EXIT_RULE_TYPES)[number];

/** 出场规则触发时点。 */
export const STRATEGY_EXIT_TRIGGERS = ["ON_ENTRY", "ON_OPEN", "ON_CLOSE", "INTRADAY"] as const;
export type StrategyExitTrigger = (typeof STRATEGY_EXIT_TRIGGERS)[number];

/** 出场阈值单位。 */
export const STRATEGY_EXIT_THRESHOLD_UNITS = ["RATIO", "PERCENT", "TRADING_DAY", "PRICE"] as const;
export type StrategyExitThresholdUnit = (typeof STRATEGY_EXIT_THRESHOLD_UNITS)[number];

/** 仓位规模方法（SPEC §13，四种全量保留）。 */
export const STRATEGY_POSITION_SIZING_METHODS = [
  "FIXED_AMOUNT",
  "FIXED_RATIO",
  "EQUAL_WEIGHT",
  "RISK_BASED",
] as const;
export type StrategyPositionSizingMethod = (typeof STRATEGY_POSITION_SIZING_METHODS)[number];

/** 信号产生时点（**与成交时点严格分离**，SPEC §15）。 */
export const STRATEGY_SIGNAL_TIMINGS = ["T_OPEN", "T_CLOSE"] as const;
export type StrategySignalTiming = (typeof STRATEGY_SIGNAL_TIMINGS)[number];

/** 成交时点（相对信号 bar 的 T）。本项目 T+1 模型的关键：`T_CLOSE` 出信号 → `T_PLUS_1_OPEN` 成交。 */
export const STRATEGY_EXECUTION_TIMINGS = [
  "T_CLOSE",
  "T_PLUS_1_OPEN",
  "T_PLUS_1_CLOSE",
  "T_PLUS_2_OPEN",
] as const;
export type StrategyExecutionTiming = (typeof STRATEGY_EXECUTION_TIMINGS)[number];

/** 成交价类型。 */
export const STRATEGY_PRICE_TYPES = ["OPEN", "CLOSE", "HIGH", "LOW", "VWAP"] as const;
export type StrategyPriceType = (typeof STRATEGY_PRICE_TYPES)[number];

/** 数量决定方式。 */
export const STRATEGY_QUANTITY_METHODS = ["FIXED_SHARES", "TARGET_WEIGHT", "AMOUNT"] as const;
export type StrategyQuantityMethod = (typeof STRATEGY_QUANTITY_METHODS)[number];

/** 滑点 / 佣金模型标识（具体费率仍在 `executionAssumptions.costModel`，本层只声明模型种类）。 */
export const STRATEGY_COST_MODELS = ["NONE", "BPS", "FIXED"] as const;
export type StrategyCostModelId = (typeof STRATEGY_COST_MODELS)[number];

/** 参数角色（SPEC §16 / §17：未来 Parameter Search 直接读 `TUNABLE`）。 */
export const STRATEGY_PARAMETER_ROLES = ["FIXED", "TUNABLE", "DERIVED"] as const;
export type StrategyParameterRole = (typeof STRATEGY_PARAMETER_ROLES)[number];

/** 参数数据类型（与 `ResearchParameterType` 对齐，保证可复用既有参数校验器）。 */
export const STRATEGY_PARAMETER_DATA_TYPES = ["number", "string", "boolean"] as const;
export type StrategyParameterDataType = (typeof STRATEGY_PARAMETER_DATA_TYPES)[number];

/** Dataset 绑定角色（SPEC §21）。 */
export const STRATEGY_DATASET_ROLES = ["PRIMARY", "VALIDATION", "OOS"] as const;
export type StrategyDatasetRole = (typeof STRATEGY_DATASET_ROLES)[number];

/**
 * Dataset Version 的显示 / 快照 label 形态（Dataset Registry 的 `dataset_version.version`，如 `v1` / `v2`）。
 * 只用于展示与快照，**不是**跨模块唯一引用（唯一引用是 `datasetVersionId`）。
 */
export const STRATEGY_DATASET_VERSION_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/**
 * 是否为合法的 Dataset Registry 权威坐标（`dataset_version.id`：正整数）。
 *
 * 纯形态判定（不查库）；「存在 / READY / datasetId 一致」属引用完整性，
 * 只能在持久化层查真实 `dataset_version` 判定（见 strategyPersistence/datasetBindingValidation.ts）。
 */
export function isValidDatasetVersionId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// ---------------------------------------------------------------------------
// 字段引用解析：时间域目录（唯一权威）
// ---------------------------------------------------------------------------

/** 字段引用的时间域。 */
export const STRATEGY_FIELD_TIME_DOMAINS = [
  /** `prefix.rd{n}`（n ≤ 0）：事件日之前 / 事件日当根的后视行情，PIT 安全。 */
  "PRE_EVENT",
  /** `event.<field>`：事件日的时点身份信息（无逐日行情），事件日收盘即可知。 */
  "EVENT_DAY",
  /** `bar.<field>`：观察窗口内**当前正在评估的那根 bar** —— 按构造不含前视。 */
  "CURRENT_BAR",
  /** `post.rd{n}`（n ≥ 1）：事件日之后的原始行情 —— 只有 n ≤ 最早信号偏移才可用。 */
  "FORWARD_BAR",
  /** `path.*` / `outcome.*`：Dataset 明示的「前视，仅打标签」层 —— 禁止作为信号条件输入。 */
  "LABEL_ONLY",
  /** 无法判定时间域 —— Validation 默认拒绝（SPEC §二十六）。 */
  "UNKNOWN",
] as const;
export type StrategyFieldTimeDomain = (typeof STRATEGY_FIELD_TIME_DOMAINS)[number];

/** `event` 层字段白名单（对齐 `DatasetEventItem`，**不含 OHLCV**）。 */
export const STRATEGY_EVENT_FIELDS = [
  "symbol",
  "tradeDate",
  "market",
  "industryCode",
  "boardType",
  "previousClose",
  "limitUpPrice",
  "turnover",
  "isFirstLimit",
  "previousLimitDate",
  "daysSincePreviousLimit",
  "historicalLimitCount",
  "marketCap",
  "floatMarketCap",
] as const;

/** 原始行情 bar 字段白名单（对齐 `DatasetRawBarItem` 的纯日线列，prefix / post 同构）。 */
export const STRATEGY_BAR_FIELDS = [
  "open",
  "high",
  "low",
  "close",
  "volume",
  "amount",
  "tradeDate",
  "relativeDay",
] as const;

/** 字段引用的解析结果（判别联合）。 */
export type StrategyFieldReference =
  | { readonly kind: "preEvent"; readonly relativeDay: number; readonly field: string }
  | { readonly kind: "eventDay"; readonly field: string }
  | { readonly kind: "currentBar"; readonly field: string }
  | { readonly kind: "forwardBar"; readonly relativeDay: number; readonly field: string }
  | { readonly kind: "labelOnly"; readonly root: "path" | "outcome"; readonly field: string }
  | { readonly kind: "unknown"; readonly raw: string };

const PRE_EVENT_RE = /^prefix\.rd(-?\d+)\.([A-Za-z][A-Za-z0-9_]*)$/;
const FORWARD_BAR_RE = /^post\.rd(\d+)\.([A-Za-z][A-Za-z0-9_]*)$/;
const EVENT_RE = /^event\.([A-Za-z][A-Za-z0-9_]*)$/;
const CURRENT_BAR_RE = /^bar\.([A-Za-z][A-Za-z0-9_]*)$/;
const LABEL_ONLY_RE = /^(path|outcome)\.(.+)$/;

/**
 * 解析字段引用（唯一权威实现；Validation 与未来运行时 Adapter 必须共用本函数）。
 *
 * 不支持「模糊匹配」：任何无法被上述前缀精确解析的引用一律返回 `unknown`，
 * 由 Validation 默认拒绝。这样新增 Dataset 列时不会静默放宽 PIT 边界。
 */
export function parseStrategyFieldReference(field: string): StrategyFieldReference {
  if (typeof field !== "string" || field.trim() === "") {
    return { kind: "unknown", raw: String(field) };
  }
  const raw = field.trim();
  const preEvent = PRE_EVENT_RE.exec(raw);
  if (preEvent !== null) {
    return { kind: "preEvent", relativeDay: Number(preEvent[1]), field: preEvent[2] };
  }
  const forward = FORWARD_BAR_RE.exec(raw);
  if (forward !== null) {
    return { kind: "forwardBar", relativeDay: Number(forward[1]), field: forward[2] };
  }
  const event = EVENT_RE.exec(raw);
  if (event !== null) {
    return { kind: "eventDay", field: event[1] };
  }
  const currentBar = CURRENT_BAR_RE.exec(raw);
  if (currentBar !== null) {
    return { kind: "currentBar", field: currentBar[1] };
  }
  const labelOnly = LABEL_ONLY_RE.exec(raw);
  if (labelOnly !== null) {
    return { kind: "labelOnly", root: labelOnly[1] as "path" | "outcome", field: labelOnly[2] };
  }
  return { kind: "unknown", raw };
}

/** 字段引用所属时间域（供 Validation 分层判定与文档化）。 */
export function resolveFieldTimeDomain(reference: StrategyFieldReference): StrategyFieldTimeDomain {
  switch (reference.kind) {
    case "preEvent":
      return reference.relativeDay <= 0 ? "PRE_EVENT" : "UNKNOWN";
    case "eventDay":
      return "EVENT_DAY";
    case "currentBar":
      return "CURRENT_BAR";
    case "forwardBar":
      return reference.relativeDay >= 1 ? "FORWARD_BAR" : "UNKNOWN";
    case "labelOnly":
      return "LABEL_ONLY";
    case "unknown":
      return "UNKNOWN";
  }
}

/** 字段是否在对应层的白名单内（未知字段 → false，由 Validation 报 UNKNOWN_FIELD_REFERENCE）。 */
export function isKnownFieldReference(reference: StrategyFieldReference): boolean {
  switch (reference.kind) {
    case "preEvent":
    case "forwardBar":
      return (STRATEGY_BAR_FIELDS as readonly string[]).includes(reference.field);
    case "eventDay":
      return (STRATEGY_EVENT_FIELDS as readonly string[]).includes(reference.field);
    case "currentBar":
      return (STRATEGY_BAR_FIELDS as readonly string[]).includes(reference.field);
    case "labelOnly":
    case "unknown":
      return false;
  }
}

// ---------------------------------------------------------------------------
// 信号时间线（Look-Ahead 静态判定的基础）
// ---------------------------------------------------------------------------

/**
 * 由 `trigger` + `observationWindow` 解出的静态信号时间线。
 *
 * 语义：观察窗口的 `relativeDay` 相对**事件日 T**（与 Dataset 的 `post.relativeDay` 同一坐标系）。
 * 信号在窗口内某个相对日 `k` 产生：
 *   - 判定第一个满足条件的 bar → `FIRST_VALID_DAY`，k 下界 = windowStart；
 *   - 每个满足条件的 bar 都出信号 → `EVERY_VALID_DAY`，k 下界 = windowStart；
 *   - 窗口内最后一个满足条件的 bar → `LAST_VALID_DAY`，k 下界 = windowEnd；
 *   - 条件满足后**再顺延一个交易日**才出信号 → `NEXT_TRADING_DAY`，k 下界 = windowStart + 1。
 *
 * ⇒ **允许在 entry condition 中引用的最大前视相对日 = earliestSignalOffset**。
 *   引用 `post.rd{n}` 当 `n > earliestSignalOffset` 时，条件在该 bar 上求值需要读取未来数据。
 */
export interface StrategySignalTimeline {
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly unit: StrategyWindowUnit;
  readonly earliestSignalOffset: number;
  /** 允许引用的最大前视相对日（= earliestSignalOffset）。 */
  readonly maxReferencableOffset: number;
  /**
   * 时间线是否可静态解析。`unit = CALENDAR_DAY` 时无法把自然日窗口映射到 Dataset 的
   * 交易日 `relativeDay` 坐标系 ⇒ false（前视引用一律拒绝，宁严不宽）。
   */
  readonly resolvable: boolean;
}

/** 由 trigger 与观察窗口解出静态信号时间线。 */
export function resolveSignalTimeline(
  trigger: StrategyTriggerType,
  window: ObservationWindow,
): StrategySignalTimeline {
  const windowStart = window.start;
  const windowEnd = window.end;
  let earliestSignalOffset: number;
  switch (trigger) {
    case "FIRST_VALID_DAY":
    case "EVERY_VALID_DAY":
      earliestSignalOffset = windowStart;
      break;
    case "LAST_VALID_DAY":
      earliestSignalOffset = windowEnd;
      break;
    case "NEXT_TRADING_DAY":
      earliestSignalOffset = windowStart + 1;
      break;
  }
  const resolvable = window.unit === "TRADING_DAY";
  return {
    windowStart,
    windowEnd,
    unit: window.unit,
    earliestSignalOffset,
    maxReferencableOffset: earliestSignalOffset,
    resolvable,
  };
}

// ---------------------------------------------------------------------------
// Domain 类型
// ---------------------------------------------------------------------------

/** 事件定义（研究什么事件）。 */
export interface EventDefinition {
  readonly type: StrategyEventType;
  /** 扩展参数（如 `CUSTOM_EVENT` 的 eventCode）；只允许标量值，保持可序列化与确定性。 */
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  readonly description?: string;
}

/** 观察窗口（观察多长时间；**必须明确单位**，SPEC §10.2）。 */
export interface ObservationWindow {
  /** 窗口起点（相对事件日的偏移；1 = T+1）。 */
  readonly start: number;
  /** 窗口终点（相对事件日的偏移；含端点）。 */
  readonly end: number;
  readonly unit: StrategyWindowUnit;
}

/** 条件定义（通用表达，不做成大量固定字段，SPEC §10.3）。 */
export interface ConditionDefinition {
  /** 条件 id（所在条件下标派生；缺省由规范化按 `cond-<n>` 补齐，n 从 1 起）。 */
  readonly id?: string;
  /** 左值：**必须**是字段引用（`prefix.rd0.open` / `event.limitUpPrice` / `bar.low` / `post.rd2.high`）。 */
  readonly field: string;
  readonly operator: StrategyConditionOperator;
  /** 右值；语义由 `valueType` 决定。 */
  readonly value: ResearchParameterValue | readonly ResearchParameterValue[];
  readonly valueType: StrategyConditionValueType;
  readonly description?: string;
  readonly enabled: boolean;
}

/** 触发定义（条件满足后何时产生 Signal，SPEC §11）。 */
export interface TriggerDefinition {
  readonly type: StrategyTriggerType;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  readonly description?: string;
}

/** 入场定义。 */
export interface EntryDefinition {
  readonly event: EventDefinition;
  readonly observationWindow: ObservationWindow;
  readonly conditions: readonly ConditionDefinition[];
  readonly trigger: TriggerDefinition;
}

/** 出场规则（SPEC §12：type / trigger / threshold / condition / priority / enabled）。 */
export interface ExitRuleDefinition {
  readonly id?: string;
  readonly type: StrategyExitRuleType;
  readonly trigger: StrategyExitTrigger;
  /** 数值阈值（与 `thresholdUnit` 配对）；由参数表达时改用 `parameter`。 */
  readonly threshold?: number;
  readonly thresholdUnit?: StrategyExitThresholdUnit;
  /** 阈值由参数表达时的参数 code（须存在于 `parameters`）。 */
  readonly parameter?: string;
  /** 附加条件（可选；同样受 Look-Ahead 约束）。 */
  readonly condition?: ConditionDefinition;
  /** 优先级（数值越小越优先；同一出场定义内必须唯一）。 */
  readonly priority: number;
  readonly enabled: boolean;
  readonly description?: string;
}

/** 出场定义。 */
export interface ExitDefinition {
  readonly rules: readonly ExitRuleDefinition[];
}

/** 仓位定义（SPEC §13）。 */
export interface PositionDefinition {
  readonly sizingMethod: StrategyPositionSizingMethod;
  /** 每仓占初始资金比例 (0, 1]，`FIXED_RATIO` 必填或由 `parameter` 表达。 */
  readonly positionRatio?: number;
  /** `FIXED_AMOUNT` 的固定金额（> 0）。 */
  readonly fixedAmount?: number;
  /** 最大同时持仓数（>= 1）。 */
  readonly maxPositions: number;
  /** 组合最大暴露 (0, 1]。 */
  readonly maxExposure?: number;
  /** 单标的最大占比 (0, 1]。 */
  readonly maxSinglePosition?: number;
  /** 比例由参数表达时的参数 code。 */
  readonly parameter?: string;
}

/**
 * 风险定义（SPEC §14）。
 * ⚠️ 这是**风险规则**，不是风险评价结果（不含 Sharpe / MaxDD 实测值等）。
 */
export interface RiskDefinition {
  /** 单笔止损比例 (0, 1)。 */
  readonly stopLoss?: number;
  /** 组合最大回撤闸门 (0, 1)。 */
  readonly maxDrawdown?: number;
  /** 组合最大暴露 (0, 1]。 */
  readonly maxExposure?: number;
  /** 单标的最大占比 (0, 1]。 */
  readonly maxSinglePosition?: number;
  /** 最大同时持仓数（>= 1）。 */
  readonly maxPositions?: number;
  /** 单日亏损上限 (0, 1]。 */
  readonly dailyLossLimit?: number;
  /** 集中度上限 (0, 1]。 */
  readonly concentrationLimit?: number;
  /** 扩展槽：未来风险维度（保持前向兼容，不因新增维度而递增 schemaVersion）。 */
  readonly extensions?: Readonly<Record<string, number | string | boolean>>;
}

/** 执行定义（SPEC §15：signalTiming 与 executionTiming **必须分离**）。 */
export interface ExecutionDefinition {
  readonly signalTiming: StrategySignalTiming;
  readonly executionTiming: StrategyExecutionTiming;
  readonly priceType: StrategyPriceType;
  readonly quantityMethod: StrategyQuantityMethod;
  readonly lotSize: number;
  readonly slippageModel?: StrategyCostModelId;
  readonly commissionModel?: StrategyCostModelId;
  /** 执行约束声明（如「一字板不可成交」「停牌顺延」）；只声明，不在本任务执行。 */
  readonly executionConstraints?: readonly string[];
}

/** 参数定义（SPEC §16 / §17）。 */
export interface ParameterDefinition {
  /** 参数 code（版本内唯一，须匹配 `[A-Za-z_][A-Za-z0-9_]*`）。 */
  readonly code: string;
  readonly name: string;
  readonly dataType: StrategyParameterDataType;
  readonly parameterRole: StrategyParameterRole;
  readonly defaultValue?: ResearchParameterValue;
  /** 是否允许 null（如「不设阈值 = null」）。 */
  readonly nullable?: boolean;
  /** 数值约束（仅 `dataType = number`）。 */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** 字符串白名单（仅 `dataType = string`）。 */
  readonly allowedValues?: readonly string[];
  readonly unit?: string;
  readonly description?: string;
  readonly required: boolean;
  /** `DERIVED` 参数的推导表达式（人类可读，如 `maxPositions * positionRatio`）；DERIVED 必填。 */
  readonly derivedFrom?: string;
}

/** Dataset 绑定**引用**（SPEC §21：只建立引用，不复制 Dataset 数据、不改 Dataset 结构）。 */
export interface StrategyDatasetBinding {
  /** Dataset Registry 业务码（`dataset_definition.datasetCode`，如 `first_limit_pullback`）；legacy 形态为 `ds_…`。 */
  readonly datasetId: string;
  /**
   * 🔴 STEP STRATEGY-004 — **Dataset Registry 权威坐标**：`dataset_version.id`（跨模块唯一 Dataset Version 引用）。
   *
   * - 提供时：引用完整性由持久化层查真实 `dataset_version` 校验
   *   （存在 / status=READY / datasetId 与 `datasetId` 一致 / label 与 `datasetVersion` 一致），
   *   任一不满足即拒绝保存（不自动创建、不自动补 Dataset、不绕过 Registry）；
   * - 缺省时：本绑定走 **legacy `rd-…` 兼容分支**，`datasetVersion` 必须是 `rd-…` 内容寻址串。
   */
  readonly datasetVersionId?: number;
  /**
   * Dataset Version 的 **label / 快照**（Dataset Registry 的 `dataset_version.version`，如 `v2`）。
   *
   * - `datasetVersionId` 存在时 = 该版本的显示 label，必须与 Registry 的 `version` 一致；
   * - `datasetVersionId` 缺省时 = legacy `rd-…` 内容寻址串（保留旧兼容分支，不删除）。
   */
  readonly datasetVersion: string;
  readonly role: StrategyDatasetRole;
  readonly note?: string;
}

/**
 * 完整策略定义（Canonical Definition 的领域形态）。
 *
 * 本对象随 `StrategyDocument.definition` 一起进入 `strategy_versions.strategyDocumentJson`，
 * 是该版本「可复现的核心规则快照」。5 张投影表全部由本对象单向派生。
 */
export interface StrategyDefinition {
  readonly schemaVersion: string;
  readonly entry: EntryDefinition;
  readonly exit: ExitDefinition;
  readonly position: PositionDefinition;
  readonly risk: RiskDefinition;
  readonly execution: ExecutionDefinition;
  readonly parameters: readonly ParameterDefinition[];
  readonly datasets: readonly StrategyDatasetBinding[];
}

/** `createStrategyDefinition` 输入（`schemaVersion` 缺省由组装层补 `1.0`）。 */
export type StrategyDefinitionInput = Omit<StrategyDefinition, "schemaVersion"> & {
  readonly schemaVersion?: string;
};

// ---------------------------------------------------------------------------
// 规范化（确定性顺序；与指纹稳定性直接相关）
// ---------------------------------------------------------------------------

/** `cond-<n>` / `exit-<n>` 风格 id 解析（缺省 id 由下标派生，保证同一输入必得同一 id）。 */
export function resolveConditionId(condition: ConditionDefinition, index: number): string {
  const id = condition.id;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : `cond-${index + 1}`;
}

/** 解析出场规则 id（缺省 `exit-<n>`）。 */
export function resolveExitRuleId(rule: ExitRuleDefinition, index: number): string {
  const id = rule.id;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : `exit-${index + 1}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 数值可选字段比较（缺省视为 -1，保证 legacy 绑定排在 new 绑定之前且顺序确定）。 */
function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  return (left ?? -1) - (right ?? -1);
}

/**
 * 规范化：补齐缺省 id、按确定性顺序整理数组，使「同一语义定义 → 同一 canonical 串 → 同一指纹」。
 *
 * 排序规则：
 *   - `parameters`：按 `code` 升序（参数顺序无语义）；
 *   - `datasets`：按 (role, datasetId, datasetVersion, datasetVersionId) 升序（绑定顺序无语义）；
 *   - `exit.rules`：按 (priority, id) 升序（priority 已表达优先级，数组顺序无语义）；
 *   - `entry.conditions`：**保持调用方顺序**（条件求值顺序可能承载语义，不重排）。
 * 输入为已隔离的深拷贝，本函数原地整理，绝不修改调用方对象。
 */
export function normalizeStrategyDefinition(input: StrategyDefinitionInput): StrategyDefinition {
  const clone = structuredClone(input) as Record<string, unknown>;

  const parameters = clone.parameters;
  if (Array.isArray(parameters)) {
    clone.parameters = (parameters as ParameterDefinition[])
      .map((item) => ({ ...item }))
      .sort((a, b) => compareText(a.code, b.code));
  }

  const datasets = clone.datasets;
  if (Array.isArray(datasets)) {
    const next = datasets as StrategyDatasetBinding[];
    clone.datasets = next
      .map((item) => ({ ...item }))
      .sort((a, b) =>
        compareText(a.role, b.role)
        || compareText(a.datasetId, b.datasetId)
        || compareText(a.datasetVersion, b.datasetVersion)
        || compareOptionalNumber(a.datasetVersionId, b.datasetVersionId));
  }

  const entry = clone.entry as EntryDefinition | undefined;
  if (entry !== undefined && entry !== null && Array.isArray(entry.conditions)) {
    clone.entry = {
      ...entry,
      conditions: entry.conditions.map((condition, index) => ({
        ...condition,
        id: resolveConditionId(condition, index),
      })),
    };
  }

  const exit = clone.exit as ExitDefinition | undefined;
  if (exit !== undefined && exit !== null && Array.isArray(exit.rules)) {
    const rules: ExitRuleDefinition[] = exit.rules.map((rule, index) => {
      const withId: ExitRuleDefinition = { ...rule, id: resolveExitRuleId(rule, index) };
      if (withId.condition === undefined || withId.condition === null) return withId;
      return {
        ...withId,
        condition: { ...withId.condition, id: resolveConditionId(withId.condition, 0) },
      };
    });
    rules.sort((a, b) => (a.priority - b.priority) || compareText(a.id as string, b.id as string));
    clone.exit = { ...exit, rules };
  }

  return clone as unknown as StrategyDefinition;
}

/** 观察窗口是否合法（`start >= 1`、`end >= start`）；供 Validation 与消费方复用。 */
export function isValidObservationWindow(window: ObservationWindow): boolean {
  return Number.isInteger(window.start)
    && Number.isInteger(window.end)
    && window.start >= 1
    && window.end >= window.start;
}
