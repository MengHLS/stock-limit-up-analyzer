/**
 * candidateSketchVocabulary — 候选**研究草图**的词表与标签（纯数据 + 纯函数）。
 *
 * 为什么这份文件必须存在：候选草图的五个字段其实全是**强类型、词表有界**的结构
 * （权威 = `server/research/strategyCandidate/definitionBuild.ts`），把它们当作自由 JSON
 * 让人手写，等于把「选一个枚举」变成「背一遍后端词表」。
 *
 * 🔴 客户端**不能** import 服务端的运行时值（仓库铁律：跨端只允许 `import type`，
 * 否则服务端模块会被打进浏览器包）⇒ 本地表是唯一可落地的形式，
 * **唯一的防漂移手段是 `candidateSketchForm.test.ts` 里与服务端常量逐字对表**。
 *
 * 本文件的纪律：
 *   - 只放**词表与标签**，不放判定与拼装（那些在 `candidateSketchForm.ts`）；
 *   - 枚举值必须与服务端**逐字相同**（大小写、下划线），中文只进 `label` / `note`；
 *   - 不收录服务端不认的值 —— 宁可表单里少一个选项，也不给一个转正时必被拒的选项。
 */

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

export interface SketchOption {
  readonly value: string;
  readonly label: string;
  /** 一句补充说明（为什么这么选 / 它会落到哪）。 */
  readonly note?: string;
  /**
   * 该取值**当前不可选**（下拉里出现但置灰）。
   *
   * 用途**只有一个**：服务端映射表里存在某个键，但由它**派生出的必填字段组合必然被
   * 下游校验拒绝** —— 这种键既不能从表里删（`ENTRY_TIMING_TO_EXECUTION` 的对表断言会红，
   * 那是对漂移的哨兵），也不能当作正常选项给用户（他会一路填到转正才吃一个错）。
   * 置灰 + `note` 写明原因，是这两者唯一的交集。
   */
  readonly disabled?: boolean;
}

/**
 * 词表标签查询。
 *
 * 找不到取值时**原样返回 value**，绝不编造一个像样的中文名 —— 否则界面上会出现
 * 「看着对、实际转正会被拒」的假标签。空值返回 `""`（调用方自己决定怎么显示「未选」）。
 */
export function candidateOptionLabel(options: readonly SketchOption[], value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const found = options.find((option) => option.value === trimmed);
  return found === undefined ? trimmed : found.label;
}

// ---------------------------------------------------------------------------
// entryRule：顶层两个枚举
// ---------------------------------------------------------------------------

/** `entryRule.event` → `definition.entry.event.type`（服务端 `STRATEGY_EVENT_TYPES`）。 */
export const CANDIDATE_EVENT_OPTIONS: readonly SketchOption[] = [
  { value: "FIRST_LIMIT_UP", label: "首个涨停（首板）" },
  { value: "LIMIT_UP", label: "涨停" },
  { value: "BREAKOUT", label: "突破" },
  { value: "PRICE_PATTERN", label: "价格形态" },
  {
    value: "CUSTOM_EVENT",
    label: "自定义事件",
    note: "具体语义用「事件参数」里的 eventCode 表达",
  },
];

/**
 * `entryRule.timing` —— 服务端 `ENTRY_TIMING_TO_EXECUTION` 的**三个**键（闭集）。
 *
 * `note` 写的是它落到 `StrategyDefinition.execution` 的三元组，因为这三个值决定了
 * 「信号在哪个 bar、成交在哪个 bar、用什么价」—— 用户必须看得见这件事。
 *
 * 🔴 **`SAME_CLOSE` 被置灰**（不是删掉）：它的三元组是
 * `{ signalTiming: "T_CLOSE", executionTiming: "T_CLOSE" }`，而
 * `strategySchema/definitionValidation.ts:710-715` 的 **L6** 明确拒绝「成交不晚于信号」的
 * 同 bar 组合（`SIGNAL_EXECUTION_TIMING_CONFLICT`，现成用例 `strategyDefinition.test.ts:903-909`）
 * ⇒ **选了它转正必然失败**，属于文件头明令禁止的「转正时必被拒的选项」。
 * 之所以不从表里删：`ENTRY_TIMING_TO_EXECUTION` 的对表断言（`candidateSketchForm.test.ts`）
 * 靠**逐字相等**做漂移哨兵，删一项就等于把哨兵关掉；置灰 + 说明是两者唯一的交集。
 * 根因在服务端映射表 ⇒ 已登记 ROADMAP，须单独排期（改 `server/**` 会热重启杀死在途 Run）。
 */
export const CANDIDATE_ENTRY_TIMING_OPTIONS: readonly SketchOption[] = [
  { value: "NEXT_OPEN", label: "次一交易日开盘买入", note: "T 日收盘出信号 → T+1 开盘成交（开盘价）" },
  { value: "NEXT_CLOSE", label: "次一交易日收盘买入", note: "T 日收盘出信号 → T+1 收盘成交（收盘价）" },
  {
    value: "SAME_CLOSE",
    label: "事件日收盘买入",
    disabled: true,
    note:
      "⛔ 当前不可选：它映射成 signalTiming=T_CLOSE + executionTiming=T_CLOSE，"
      + "被后端 L6 直接拒绝（SIGNAL_EXECUTION_TIMING_CONFLICT）—— 选了会在转正时才失败。"
      + "请改用「次一交易日开盘买入」或「次一交易日收盘买入」。",
  },
];

/**
 * `entryRule.extra.observationWindow.unit`（服务端 `STRATEGY_WINDOW_UNITS`）。
 */
export const CANDIDATE_WINDOW_UNIT_OPTIONS: readonly SketchOption[] = [
  { value: "TRADING_DAY", label: "交易日" },
  { value: "CALENDAR_DAY", label: "自然日" },
];

/**
 * `entryRule.extra.trigger`（服务端 `STRATEGY_TRIGGER_TYPES`）。**必填**。
 *
 * `note` 的四种语义**逐条取自** `strategySchema/definition.ts:333-336`
 * （`resolveSignalTimeline` 的注释即权威定义），不是我自己解释的：
 * 判定第一个满足条件的 bar / 每个满足条件的 bar / 窗口内最后一个满足条件的 bar /
 * 条件满足后再顺延一个交易日。
 */
export const CANDIDATE_TRIGGER_OPTIONS: readonly SketchOption[] = [
  {
    value: "FIRST_VALID_DAY",
    label: "首个有效日",
    note:
      "观察窗口内**第一个**满足全部买入条件的交易日出信号 —— "
      + "「T 日涨停 → 观察 5 日 → 回踩到位才买」这条策略就该选它（买入条件就是「满足」的判据）",
  },
  {
    value: "LAST_VALID_DAY",
    label: "最后一个有效日",
    note: "窗口内**最后一个**满足条件的交易日出信号（等于要等到窗口末尾才肯下手）",
  },
  {
    value: "EVERY_VALID_DAY",
    label: "每个有效日",
    note: "窗口内**每一个**满足条件的交易日出一次信号 —— 会重复入场，一般不是你想要的",
  },
  {
    value: "NEXT_TRADING_DAY",
    label: "次一交易日",
    note:
      "第一个满足条件的交易日**再顺延一个交易日**才出信号（信号被推迟一天）；"
      + "配合它时「入场时点」不能选同 bar 成交，后端 L7 会拒绝（TRIGGER_EXECUTION_INCONSISTENT）",
  },
];

/** `entryRule.extra.execution.quantityMethod`（服务端 `STRATEGY_QUANTITY_METHODS`）。**必填**。 */
export const CANDIDATE_QUANTITY_METHOD_OPTIONS: readonly SketchOption[] = [
  { value: "FIXED_SHARES", label: "固定股数" },
  { value: "TARGET_WEIGHT", label: "目标权重" },
  { value: "AMOUNT", label: "固定金额" },
];

/** 滑点 / 佣金模型标识（服务端 `STRATEGY_COST_MODELS`）。 */
export const CANDIDATE_COST_MODEL_OPTIONS: readonly SketchOption[] = [
  { value: "NONE", label: "不计" },
  { value: "BPS", label: "按万分比" },
  { value: "FIXED", label: "按固定值" },
];

/** `entryRule.extra.position.sizingMethod`（服务端 `STRATEGY_POSITION_SIZING_METHODS`）。**必填**。 */
export const CANDIDATE_SIZING_METHOD_OPTIONS: readonly SketchOption[] = [
  { value: "FIXED_AMOUNT", label: "固定金额" },
  { value: "FIXED_RATIO", label: "固定比例" },
  { value: "EQUAL_WEIGHT", label: "等权" },
  { value: "RISK_BASED", label: "按风险" },
];

/**
 * `entryRule.extra` 允许出现的键（服务端 `CANDIDATE_SKETCH_EXTENSION_KEYS`，**闭集**）。
 * 表单据此把「多出来的键」明确标成无法表达 —— 而**不是**静默丢掉。
 */
export const CANDIDATE_SKETCH_EXTENSION_KEYS = [
  "observationWindow",
  "trigger",
  "eventParams",
  "execution",
  "position",
  "risk",
  "document",
] as const;
export type CandidateSketchExtensionKey = (typeof CANDIDATE_SKETCH_EXTENSION_KEYS)[number];

// ---------------------------------------------------------------------------
// filterRule：条件运算符（**只收录 Strategy 词表认得的那 8 个**）
// ---------------------------------------------------------------------------

export interface CandidateConditionOperatorOption extends SketchOption {
  /** 需要几个值：1 = 单值，LIST = 逗号分隔的候选集合。 */
  readonly arity: "ONE" | "LIST";
}

/**
 * 🔴 只有 8 个 —— 服务端 `CONDITION_OPERATOR_MAP` 的全部覆盖面。
 *
 * 研究侧条件编辑器里的 `BETWEEN` / `IS_NULL` / `IS_NOT_NULL` **不在**此列：
 * `StrategyDefinition` 词表没有对应值，写进去只会在转正时得到 `PROMOTE_SKETCH_INVALID`。
 * 提前不提供，比让人填完再被拒更有用。
 */
export const CANDIDATE_CONDITION_OPERATOR_OPTIONS: readonly CandidateConditionOperatorOption[] = [
  { value: ">", label: "大于", arity: "ONE" },
  { value: ">=", label: "大于等于", arity: "ONE" },
  { value: "<", label: "小于", arity: "ONE" },
  { value: "<=", label: "小于等于", arity: "ONE" },
  { value: "==", label: "等于", arity: "ONE" },
  { value: "!=", label: "不等于", arity: "ONE" },
  { value: "IN", label: "属于（逗号分隔）", arity: "LIST" },
  { value: "NOT_IN", label: "不属于（逗号分隔）", arity: "LIST" },
];

export function candidateConditionOperatorOf(
  operator: string,
): CandidateConditionOperatorOption | undefined {
  return CANDIDATE_CONDITION_OPERATOR_OPTIONS.find((o) => o.value === operator);
}

// ---------------------------------------------------------------------------
// parameterSpace
// ---------------------------------------------------------------------------

/** `parameterSpace.<code>.type`（服务端只接受这三个）。 */
export const CANDIDATE_PARAMETER_TYPE_OPTIONS: readonly SketchOption[] = [
  { value: "number", label: "数值", note: "必须同时给出 min 与 max" },
  { value: "string", label: "字符串", note: "必须给出非空候选集合" },
  { value: "boolean", label: "布尔", note: "必须给出非空候选集合" },
];

// ---------------------------------------------------------------------------
// 字段引用文法（`filterRule` 的 fieldName 必须写成的形状）
// ---------------------------------------------------------------------------

/**
 * 字段引用的时间域 —— 与服务端 `STRATEGY_FIELD_TIME_DOMAINS` **逐字相同**。
 *
 * 为什么客户端要自己实现一遍解析：`filterRule.fieldName` 必须是 Strategy 字段引用，
 * 服务端在转正时会用 `parseStrategyFieldReference` 卡住；前端若只会说「不是合法引用」，
 * 用户没有任何线索。这里复刻同一套正则，**并由对表测试逐例断言与后端一致**。
 */
export const CANDIDATE_FIELD_TIME_DOMAINS = [
  "PRE_EVENT",
  "EVENT_DAY",
  "CURRENT_BAR",
  "FORWARD_BAR",
  "LABEL_ONLY",
  "UNKNOWN",
] as const;
export type CandidateFieldTimeDomain = (typeof CANDIDATE_FIELD_TIME_DOMAINS)[number];

export interface CandidateFieldReference {
  readonly kind: "preEvent" | "eventDay" | "currentBar" | "forwardBar" | "labelOnly" | "unknown";
  readonly relativeDay?: number;
  readonly field?: string;
  readonly raw: string;
}

const PRE_EVENT_RE = /^prefix\.rd(-?\d+)\.([A-Za-z][A-Za-z0-9_]*)$/;
const FORWARD_BAR_RE = /^post\.rd(\d+)\.([A-Za-z][A-Za-z0-9_]*)$/;
const EVENT_RE = /^event\.([A-Za-z][A-Za-z0-9_]*)$/;
const CURRENT_BAR_RE = /^bar\.([A-Za-z][A-Za-z0-9_]*)$/;
const LABEL_ONLY_RE = /^(path|outcome)\.(.+)$/;

/** 与服务端 `parseStrategyFieldReference` **同口径**（对表测试逐例断言）。 */
export function parseCandidateFieldReference(field: string): CandidateFieldReference {
  if (typeof field !== "string" || field.trim() === "") {
    return { kind: "unknown", raw: String(field) };
  }
  const raw = field.trim();
  const preEvent = PRE_EVENT_RE.exec(raw);
  if (preEvent !== null) {
    return { kind: "preEvent", relativeDay: Number(preEvent[1]), field: preEvent[2], raw };
  }
  const forward = FORWARD_BAR_RE.exec(raw);
  if (forward !== null) {
    return { kind: "forwardBar", relativeDay: Number(forward[1]), field: forward[2], raw };
  }
  const event = EVENT_RE.exec(raw);
  if (event !== null) return { kind: "eventDay", field: event[1], raw };
  const currentBar = CURRENT_BAR_RE.exec(raw);
  if (currentBar !== null) return { kind: "currentBar", field: currentBar[1], raw };
  const labelOnly = LABEL_ONLY_RE.exec(raw);
  if (labelOnly !== null) return { kind: "labelOnly", field: labelOnly[2], raw };
  return { kind: "unknown", raw };
}

export function candidateFieldTimeDomainOf(reference: CandidateFieldReference): CandidateFieldTimeDomain {
  switch (reference.kind) {
    case "preEvent":
      return (reference.relativeDay ?? 1) <= 0 ? "PRE_EVENT" : "UNKNOWN";
    case "eventDay":
      return "EVENT_DAY";
    case "currentBar":
      return "CURRENT_BAR";
    case "forwardBar":
      return (reference.relativeDay ?? 0) >= 1 ? "FORWARD_BAR" : "UNKNOWN";
    case "labelOnly":
      return "LABEL_ONLY";
    default:
      return "UNKNOWN";
  }
}

/** `event.*` 字段白名单（服务端 `STRATEGY_EVENT_FIELDS`），供输入联想。 */
export const CANDIDATE_EVENT_FIELD_OPTIONS: readonly string[] = [
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
];

/** bar 字段白名单（服务端 `STRATEGY_BAR_FIELDS`），`prefix.*` / `bar.*` / `post.*` 共用。 */
export const CANDIDATE_BAR_FIELD_OPTIONS: readonly string[] = [
  "open",
  "high",
  "low",
  "close",
  "volume",
  "amount",
  "tradeDate",
  "relativeDay",
];

// ---------------------------------------------------------------------------
// 字段引用的**中文名**（让 `prefix.rd0.close` 不再是一串抽象代码）
// ---------------------------------------------------------------------------

const CANDIDATE_EVENT_FIELD_LABELS: Readonly<Record<string, string>> = {
  symbol: "股票代码",
  tradeDate: "交易日",
  market: "市场",
  industryCode: "行业代码",
  boardType: "板块",
  previousClose: "昨收价",
  limitUpPrice: "涨停价",
  turnover: "换手率",
  isFirstLimit: "是否首板",
  previousLimitDate: "上一次涨停日",
  daysSincePreviousLimit: "距上次涨停的天数",
  historicalLimitCount: "历史涨停次数",
  marketCap: "总市值",
  floatMarketCap: "流通市值",
};

const CANDIDATE_BAR_FIELD_LABELS: Readonly<Record<string, string>> = {
  open: "开盘价",
  high: "最高价",
  low: "最低价",
  close: "收盘价",
  volume: "成交量",
  amount: "成交额",
  tradeDate: "交易日",
  relativeDay: "相对第几根",
};

/**
 * `bar.*` / `prefix.*` / `post.*` 的字段下拉（**值集与 `CANDIDATE_BAR_FIELD_OPTIONS` 同源**，
 * 由它派生 ⇒ 不可能漂移；对表测试另锁一层）。
 */
export const CANDIDATE_BAR_FIELD_CHOICES: readonly SketchOption[] = CANDIDATE_BAR_FIELD_OPTIONS.map(
  (value) => ({ value, label: CANDIDATE_BAR_FIELD_LABELS[value] ?? value }),
);

/** `event.*` 的字段下拉（值集与 `CANDIDATE_EVENT_FIELD_OPTIONS` 同源）。 */
export const CANDIDATE_EVENT_FIELD_CHOICES: readonly SketchOption[] = CANDIDATE_EVENT_FIELD_OPTIONS.map(
  (value) => ({ value, label: CANDIDATE_EVENT_FIELD_LABELS[value] ?? value }),
);

/** 某个部位下该取哪张字段表。 */
export function candidateFieldChoicesOf(kind: string): readonly SketchOption[] {
  return kind === "eventDay" ? CANDIDATE_EVENT_FIELD_CHOICES : CANDIDATE_BAR_FIELD_CHOICES;
}

/**
 * 字段引用的**人话说明**。
 *
 * `path.*` / `outcome.*` 是 Dataset 明示的「前视、仅打标签」层，**不得**作为信号条件输入 ——
 * 在这里就说清楚，而不是等转正时被 Look-Ahead 规则拦下。
 */
export function describeCandidateFieldReference(field: string): string {
  const reference = parseCandidateFieldReference(field);
  switch (reference.kind) {
    case "preEvent": {
      const name = CANDIDATE_BAR_FIELD_LABELS[reference.field ?? ""] ?? reference.field ?? "";
      const day = reference.relativeDay ?? 0;
      return day === 0
        ? `事件日当天（rd0）的${name}`
        : `事件日前 ${Math.abs(day)} 根的${name}`;
    }
    case "eventDay":
      return `事件日的${CANDIDATE_EVENT_FIELD_LABELS[reference.field ?? ""] ?? reference.field ?? ""}`;
    case "currentBar":
      return `观察窗口内当天的${CANDIDATE_BAR_FIELD_LABELS[reference.field ?? ""] ?? reference.field ?? ""}`;
    case "forwardBar": {
      const name = CANDIDATE_BAR_FIELD_LABELS[reference.field ?? ""] ?? reference.field ?? "";
      return `事件后第 ${reference.relativeDay} 根的${name}（前视层，作为买入条件会被前视规则拒绝）`;
    }
    case "labelOnly":
      return `${reference.raw} —— 前视标签层，不能当买入条件`;
    default:
      return `不是合法字段引用：${JSON.stringify(reference.raw)}`;
  }
}

// ---------------------------------------------------------------------------
// 买入条件：部位（用户不需要知道 `prefix.` / `bar.` / `post.` 是谁）
// ---------------------------------------------------------------------------

/**
 * 字段引用的「部位」选项。
 *
 * 这四个值一一对应服务端 `parseStrategyFieldReference` 的四个具名分支
 * （`labelOnly` / `unknown` 不提供 —— 前者是标签层、后者根本不是合法引用）。
 */
export interface CandidateFieldRootOption extends SketchOption {
  readonly kind: "preEvent" | "eventDay" | "currentBar" | "forwardBar";
  /** 该部位是否需要用户再给一个「相对第几根」。 */
  readonly takesRelativeDay: boolean;
  /** 相对日的取值范围说明（仅 `takesRelativeDay` 为真时有意义）。 */
  readonly dayHint?: string;
  /** 相对日留空时的默认值（仅 `takesRelativeDay` 为真时有意义）。 */
  readonly dayDefault?: string;
}

export const CANDIDATE_FIELD_ROOT_OPTIONS: readonly CandidateFieldRootOption[] = [
  {
    value: "currentBar",
    kind: "currentBar",
    takesRelativeDay: false,
    label: "观察窗口内的当天",
    note: "`bar.*` —— 买入条件最常用：「今天这根」是否满足（按构造不含前视）",
  },
  {
    value: "eventDay",
    kind: "eventDay",
    takesRelativeDay: false,
    label: "事件（首板）当天",
    note: "`event.*` —— 事件当天的身份信息，**不含当日 OHLCV**；当日行情在下面「事件当天或之前」的 rd0",
  },
  {
    value: "preEvent",
    kind: "preEvent",
    takesRelativeDay: true,
    dayDefault: "0",
    dayHint: "0 = 事件当天，-1 = 前一根；只能是 0 或负数",
    label: "事件当天或之前",
    note: "`prefix.rd{n}` —— 后视，PIT 安全。**首板日的开/高/低/收价都在这里（rd0）**",
  },
  {
    value: "forwardBar",
    kind: "forwardBar",
    takesRelativeDay: true,
    dayDefault: "1",
    dayHint: "1 = 事件后第一根；必须 ≥ 1",
    label: "事件之后第 N 根",
    note: "`post.rd{n}` —— 前视层，**作为买入条件会被前视规则拒绝**，一般不要用",
  },
];

export function candidateFieldRootOptionOf(value: string): CandidateFieldRootOption | undefined {
  return CANDIDATE_FIELD_ROOT_OPTIONS.find((option) => option.value === value);
}

/**
 * 由「部位 + 相对日 + 字段」拼出字段引用 —— 与 `parseCandidateFieldReference` **互逆**
 * （对表测试逐例断言 `build → parse` 回到同一组输入）。
 *
 * 字段名留空 ⇒ 返回空串（调用方据此显示「还没选字段」），**不拼出一个半成品引用**。
 */
export function buildCandidateFieldReference(
  kind: string,
  relativeDay: string,
  field: string,
): string {
  const name = field.trim();
  if (name === "") return "";
  const option = candidateFieldRootOptionOf(kind);
  if (option === undefined) return "";
  switch (option.kind) {
    case "eventDay":
      return `event.${name}`;
    case "currentBar":
      return `bar.${name}`;
    case "preEvent": {
      const day = relativeDay.trim() === "" ? (option.dayDefault ?? "0") : relativeDay.trim();
      return `prefix.rd${day}.${name}`;
    }
    default: {
      const day = relativeDay.trim() === "" ? (option.dayDefault ?? "1") : relativeDay.trim();
      return `post.rd${day}.${name}`;
    }
  }
}

/** 把一条引用的「部位 / 相对日 / 字段」拆回来（不可解析 ⇒ `null`，调用方退回自由文本）。 */
export function splitCandidateFieldReference(
  field: string,
): { kind: CandidateFieldRootOption["kind"]; relativeDay: string; field: string } | null {
  const reference = parseCandidateFieldReference(field);
  switch (reference.kind) {
    case "eventDay":
      return { kind: "eventDay", relativeDay: "", field: reference.field ?? "" };
    case "currentBar":
      return { kind: "currentBar", relativeDay: "", field: reference.field ?? "" };
    case "preEvent":
      return { kind: "preEvent", relativeDay: String(reference.relativeDay ?? 0), field: reference.field ?? "" };
    case "forwardBar":
      return { kind: "forwardBar", relativeDay: String(reference.relativeDay ?? 1), field: reference.field ?? "" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 买入条件：右值类型 与 常用模板
// ---------------------------------------------------------------------------

/**
 * 条件右值的三种语法种类 —— **逐字对应**服务端 `STRATEGY_CONDITION_VALUE_TYPES`。
 *
 * ⚠️ 这不是「格式偏好」：转正时 `definitionBuild#inferValueType` 会按
 * 「能当字段引用解析 ⇒ FIELD_REFERENCE；命中参数名 ⇒ PARAMETER_REFERENCE；其余 ⇒ CONSTANT」
 * **自动判定**。让用户自己声明，是为了让他知道「我这句话会变成哪种比较」。
 */
export const CANDIDATE_CONDITION_VALUE_TYPE_OPTIONS: readonly SketchOption[] = [
  { value: "CONSTANT", label: "一个固定值", note: "直接给数值或文本，如 0.1 / main" },
  { value: "FIELD_REFERENCE", label: "另外某一处的行情值", note: "如「首板日收盘价」—— 两条数据互相比较" },
  { value: "PARAMETER_REFERENCE", label: "参数搜索空间里的参数", note: "右值写参数名，具体值由参数搜索决定" },
];

export function candidateConditionValueTypeLabel(value: string): string {
  return candidateOptionLabel(CANDIDATE_CONDITION_VALUE_TYPE_OPTIONS, value);
}

/**
 * 运算符的**符号形**（写进人话句子用）。`IN` / `NOT_IN` 没有数学符号，用中文。
 *
 * 只覆盖 Strategy 词表认得的那 8 个；未知值原样返回（不猜）。
 */
export function candidateConditionOperatorSymbol(operator: string): string {
  switch (operator) {
    case ">":
      return " 大于 ";
    case ">=":
      return " 大于等于 ";
    case "<":
      return " 小于 ";
    case "<=":
      return " 小于等于 ";
    case "==":
      return " 等于 ";
    case "!=":
      return " 不等于 ";
    case "IN":
      return " 属于 ";
    case "NOT_IN":
      return " 不属于 ";
    default:
      return ` ${operator} `;
  }
}

/**
 * 一条买入条件的**人话整句**。
 *
 * 例：`bar.close` `<` `prefix.rd0.close` ⇒「观察窗口内当天的收盘价 小于 事件日当天（rd0）的收盘价」。
 */
export function describeCandidateCondition(field: string, operator: string, value: string): string {
  const left = describeCandidateFieldReference(field);
  const trimmed = value.trim();
  if (trimmed === "") return `${left}${candidateConditionOperatorSymbol(operator)}（比较值还没填）`;
  const parsed = parseCandidateFieldReference(trimmed);
  const right = parsed.kind === "unknown" ? trimmed : describeCandidateFieldReference(trimmed);
  return `${left}${candidateConditionOperatorSymbol(operator)}${right}`;
}

/** 常用买入条件模板（一键插入一行）。 */
export interface CandidateConditionPreset {
  readonly id: string;
  readonly name: string;
  readonly field: string;
  readonly operator: string;
  readonly value: string;
  /** 这个模板**是什么语义**（写给人看，也是测试断言的锚点）。 */
  readonly description: string;
}

/**
 * 常用买入条件模板。
 *
 * 🔴 **每一条都有后端出处，不是我编的**：
 *   - 前两条直接摘自后端 golden sample（`server/research/strategySchema/goldenSample.ts`
 *     的 `FIRST_BOARD_PULLBACK_DEFINITION`）—— 那是仓库里**唯一**一份「首板回踩」的权威表达；
 *   - 其余各条的字段都落在 `STRATEGY_BAR_FIELDS` 白名单内、引用文法合法、无前视；
 *   - ⚠️ **不带任何「百分比回撤」条目**：见文件末尾关于算术缺口的说明。
 */
export const CANDIDATE_CONDITION_PRESETS: readonly CandidateConditionPreset[] = [
  {
    id: "pullback-not-break-event-open",
    name: "回踩不破首板日开盘价",
    field: "bar.low",
    operator: ">=",
    value: "prefix.rd0.open",
    description: "观察窗口内当天的最低价不低于首板日开盘价（后端 golden sample 原文）",
  },
  {
    id: "pullback-volume-shrink",
    name: "回踩当日缩量",
    field: "bar.volume",
    operator: "<",
    value: "prefix.rd0.volume",
    description: "观察窗口内当天的成交量小于首板日成交量（后端 golden sample 原文）",
  },
  {
    id: "pullback-not-break-event-low",
    name: "回踩不破首板日最低价",
    field: "bar.low",
    operator: ">=",
    value: "prefix.rd0.low",
    description: "比「不破开盘价」更宽的一种回踩判定（跌到首板日最低价即算破位）",
  },
  {
    id: "pullback-below-event-close",
    name: "收盘跌破首板日收盘价",
    field: "bar.close",
    operator: "<",
    value: "prefix.rd0.close",
    description: "回撤到首板日收盘价之下 —— 现有词表里最接近「回撤」的价格锚点",
  },
  {
    id: "pullback-touch-event-open",
    name: "回踩触及首板日开盘价",
    field: "bar.low",
    operator: "<=",
    value: "prefix.rd0.open",
    description: "当天最低价摸到首板日开盘价或更低（要求真的回踩到位，而不是随便哪天都算）",
  },
];

// ---------------------------------------------------------------------------
// 事件参数的常见键（**不是白名单**，见下）
// ---------------------------------------------------------------------------

/**
 * 常见事件参数键。
 *
 * 🔴 **这不是白名单** —— 服务端 `definitionBuild` 对 `entryRule.extra.eventParams` 的**键名不做任何限制**
 * （只要求值是字符串 / 数字 / 布尔），键会**原样透传**到 `definition.entry.event.params`。
 * 因此这里只是「常见写法」的提示，写别的键不会被拒。
 */
export const CANDIDATE_EVENT_PARAM_HINTS = [
  {
    key: "limitUpRatio",
    label: "涨停判定比例",
    valueType: "number" as const,
    example: "0.1",
    note: "0.1 = 10%；ST 股是 0.05。后端 golden sample 用的就是这个键（`{ limitUpRatio: 0.1 }`）",
  },
  {
    key: "eventCode",
    label: "自定义事件标识",
    valueType: "string" as const,
    example: "first_board_pullback",
    note: "`event = CUSTOM_EVENT` 时**必须**给，否则转正后是一个没有任何语义的空事件",
  },
] as const;

/**
 * ⚠️ **已知表达能力边界（如实告知，不在界面上造假选项）**：
 *
 * 「相对事件日回撤 **X%**」这种**带算术**的比较，用当前的 `ConditionDefinition` **表达不了** ——
 * 它的右值只有三种语法种类（常量 / 字段引用 / 参数引用），**没有表达式**，所以写不出
 * `bar.close <= prefix.rd0.close * (1 - 0.05)`。
 *
 * 现有词表能表达的等价物是**价格锚点**（首板日的开 / 高 / 低 / 收，即上面 5 个模板），
 * 或者把「幅度」做成一个**参数**去搜索 —— 但参数是全局常量，无法表达「每个标的名自 ×0.95」。
 *
 * 要真正支持百分比回撤，需要给后端加「条件右值表达式」或一个形如
 * `bar.drawdownFromEventClose` 的**派生字段**；两条路都要改 `server/**`，属后续排期项。
 */
export const CANDIDATE_CONDITION_ARITHMETIC_NOTE =
  "⚠️ 「回撤 X%」这种带乘法的比较当前表达不了：条件的比较值只能是「一个固定值 / 另一处行情值 / 参数」，没有算式。"
  + "请用上面的价格锚点模板（首板日的开/高/低/收）代替，或把幅度做成参数。";

/**
 * 条件字段的**示例**（`datalist` 联想用，不是白名单 —— 白名单在服务端）。
 * 真正的判据是「能不能被字段引用文法解析」，所以这里只给常见写法作种子。
 */
export const CANDIDATE_CONDITION_FIELD_EXAMPLES: readonly string[] = [
  "prefix.rd0.close",
  "prefix.rd-1.close",
  "prefix.rd-1.volume",
  "prefix.rd0.turnover",
  "prefix.rd-1.marketCap",
  "bar.close",
  "bar.volume",
  "event.turnover",
  "event.isFirstLimit",
  "event.boardType",
  "event.marketCap",
];
