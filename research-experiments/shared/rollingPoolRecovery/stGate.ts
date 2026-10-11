/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` §4 —— **每日 ST 硬闸门**（两时点检查）。
 *
 * ## 这个模块回答什么
 *
 * 「在**某个可获知时刻**，某只股票在**某个交易日**是否处于非 ST 状态？」
 * —— 只有答案是**可核验的 NORMAL** 才允许买入；`ST` 拒绝；**其他一切（含缺失）都是 `UNKNOWN` ⇒ 拒绝**。
 *
 * ## 🔴 三条不可协商的纪律
 *
 * 1. **缺席 ≠ NORMAL**。`statusAt()` 返回 `null` 就是「无结论 ⇒ UNKNOWN」；
 *    本模块**没有**任何把缺失/不可核验当成 NORMAL 的缺省分支（S1 审计 E3：
 *    2,378/2,827（84%）symbol 在窗口内没有任何 ST 行 —— absence 不构成 NORMAL 证据）。
 * 2. **单点事实不够，必须是区间且带可获知时间**。`effectiveFrom/To` 决定「当日是否处于该状态」，
 *    `availableAsOf` 决定「在检查时刻是否**已经可知**」。`availableAsOf > effectiveAt` 的事实
 *    一律记 UNKNOWN（= 事后补录，不能拿来做当时的判决）。
 *    `status = NORMAL` 且 `effectiveTo === null`（无界阳性区间）同样记 UNKNOWN：
 *    无界区间无法证伪「中间被 ST 过」。
 * 3. **契约版本显式**。provider 的 `contractVersion` 与本模块的 `CONTRACT_VERSION` 不一致时
 *    **按 UNKNOWN 处理**（拒绝），而不是「尽力解释一个不认识的结构」。
 *
 * ## 两个检查时点（目标 §4）
 *
 * | 时点 | 何时 | 语义 |
 * |---|---|---|
 * | `CONFIRM_CLOSE_ELIGIBILITY` | 确认日**收盘** | 候选资格：当日非 ST 才允许进入次日买入计划 |
 * | `PRE_FILL` | **真实成交前**（成交日开盘前） | 隔夜转 ST 必须**取消订单** |
 *
 * 首次买入、重试、再次入场、R 臂与 Random 臂**全部**走同一对检查
 * （`evaluateStGateForCandidate` 是唯一的两时点组合器）。
 *
 * ## 🔴 FIX-005 / F2：区间有效性用**真正的检查时刻**（不是午夜）
 *
 * 修正前 `evaluateStGate` 用 `instantKey(query.tradeDate)`（= 该日 **00:00**）判区间是否覆盖
 * 交易日，而可知性比较却用 `query.effectiveAt`。于是**日内**生效/失效的区间在 09:15 的
 * `PRE_FILL` 检查上给出错误判决（AUDIT-FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004 §9.3 已复现）：
 * 「09:00 失效」被误判放行、「08:00 生效」被误判拒绝、「09:15 精确端点」两侧都被误判拒绝。
 *
 * 现在**区间有效性与可知性都用 `query.effectiveAt`**，并保持既有契约
 * **生效含、失效含**（闭区间：`from <= checkedAt <= to`）。时间归一化规则**显式冻结**：
 *
 * | 写法 | 开始（`effectiveFrom`） | 结束（`effectiveTo`） |
 * |---|---|---|
 * | `YYYY-MM-DD` | 当地 **00:00:00** | 覆盖**该完整日期** ⇒ 当地 **23:59:59**（闭区间含端点） |
 * | `YYYY-MM-DDTHH:mm:ss` | 原样 | 原样（**精确时间不得扩展到整日**） |
 * | 其它 / 无效日历日 | **拒收** ⇒ `UNKNOWN`（`INVALID_STATUS_TIME_FORMAT`） | 同左 |
 *
 * - 时区统一为**中国市场当地时间**；比较的是字面量（不解析 `Date`、不做时区换算），
 *   因此 `YYYY-MM-DDTHH:mm:ss` 的字典序就是当地时间的先后序。
 * - 「日期形式 `effectiveTo` 覆盖整日」是**必须**的：否则 15:00 的
 *   `CONFIRM_CLOSE_ELIGIBILITY` 检查会把当日仍在生效的 NORMAL 区间误判为「已失效」。
 * - `UNKNOWN` 依旧失败关闭，且**任何**路径都不会伪造 `NORMAL`。
 *
 * ## 缺省（目标 §4「缺失时记录 UNKNOWN，不伪造」）
 *
 * `ABSENT_STATUS_PROVIDER` 是**唯一**的缺省 provider：它恒返回 `null` ⇒ 每个候选、
 * 每个时点都是 `UNKNOWN_BLOCKED`。因此「没有已核验的 provider」直接等价于
 * **收益矩阵不得产出**（`summarizeStCoverage().blocked === true`）。
 */

// ---------------------------------------------------------------------------
// 一、契约与常量
// ---------------------------------------------------------------------------

/**
 * ST 闸门契约版本。provider 必须声明**同一个**版本，否则按 UNKNOWN 处理。
 *
 * 🔴 `1.1.0`（FIX-005 / F2）：provider 事实的**形状未变**，但区间的**时间归一化与
 *    有效性判定语义**变了（改用真正的检查时刻 + 日期形式 `effectiveTo` 覆盖整日）。
 *    语义变更必须显式 ⇒ 仍声明 `1.0.0` 的 provider 一律记 `PROVIDER_CONTRACT_MISMATCH`
 *    （= UNKNOWN，失败关闭），而不是被「尽力解释成新语义」。
 */
export const ST_GATE_CONTRACT_VERSION = "1.1.0";

/** 两个检查时点（**顺序 = 执行顺序**，不可增删）。 */
export const ST_CHECK_TIMEPOINTS = ["CONFIRM_CLOSE_ELIGIBILITY", "PRE_FILL"] as const;
export type StCheckTimepoint = (typeof ST_CHECK_TIMEPOINTS)[number];

/** 闸门三态（**只有 NORMAL 放行**）。 */
export const ST_GATE_OUTCOMES = ["NORMAL", "ST", "UNKNOWN"] as const;
export type StGateOutcome = (typeof ST_GATE_OUTCOMES)[number];

/** 买入资格（研究侧三态，与 `priceState` 正交 —— ST 不得抹掉价格观察历史）。 */
export const BUY_ELIGIBILITIES = ["NORMAL", "ST_BLOCKED", "UNKNOWN_BLOCKED"] as const;
export type BuyEligibility = (typeof BUY_ELIGIBILITIES)[number];

/** 拒单原因码（**只增不改**；每个被拒候选都必须能归因）。 */
export const ST_GATE_REASONS = [
  "VERIFIED_NORMAL",
  "VERIFIED_ST",
  "NO_STATUS_PROVIDER",
  "PROVIDER_CONTRACT_MISMATCH",
  "NO_STATUS_FACT",
  "UNVERIFIED_STATUS_EVIDENCE",
  "NOT_AVAILABLE_AS_OF",
  "NOT_EFFECTIVE_ON_TRADE_DATE",
  "NORMAL_INTERVAL_UNBOUNDED",
  "SYMBOL_MISMATCH",
  "OUTSIDE_PLANNED_WINDOW",
  /**
   * FIX-005 / F2：`effectiveFrom` / `effectiveTo` / `availableAsOf` / `effectiveAt`
   * 不是可识别的当地日期时间（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ss`）或不是合法日历日。
   * 🔴 无效值**绝不允许**靠字典序「恰好排在区间内」而放行。
   */
  "INVALID_STATUS_TIME_FORMAT",
] as const;
export type StGateReason = (typeof ST_GATE_REASONS)[number];

/**
 * 缺省（内置）provider 的标识：**没有**任何可核验状态源。
 *
 * 名字刻意和「真的查了但查不到」区分开：看到 `NO_STATUS_PROVIDER` 就知道
 * 本轮**根本没有**接入 ST 源，而不是「源接错了」。
 */
export const ABSENT_STATUS_PROVIDER_ID = "ABSENT_STATUS_PROVIDER";

/** 确认日收盘检查的**检查时刻**（该交易日的收盘）。
 *
 * 收盘价在收盘时点才成立，因此这一格代表「当日收盘时已经可以知道的状态」。
 */
export const CONFIRM_CLOSE_EFFECTIVE_TIME = "15:00:00";
/**
 * 成交前检查的**检查时刻**（成交日开盘前的集合竞价之前）。
 *
 * 🔴 这是「隔夜转 ST 取消订单」的时点：前一交易日收盘之后公告、当日生效的 ST
 *    必须在这里被看见。
 */
export const PRE_FILL_EFFECTIVE_TIME = "09:15:00";

/** 某时点在某个交易日对应的检查时刻（`YYYY-MM-DDTHH:mm:ss`）。 */
export function effectiveAtOf(tradeDate: string, timepoint: StCheckTimepoint): string {
  return timepoint === "PRE_FILL"
    ? `${tradeDate}T${PRE_FILL_EFFECTIVE_TIME}`
    : `${tradeDate}T${CONFIRM_CLOSE_EFFECTIVE_TIME}`;
}

/**
 * **执行资格政策版本**（FIX-005 / F1）。
 *
 * 成交前检查的**策略身份**：研究装配层把它注入执行层（`SimulationConfig.executionEligibilityGate`），
 * 逐笔执行资格审计与拒单产物都带上它 ⇒「这一笔是按哪一版政策被放行 / 拒绝的」可追溯。
 * 政策本体 = 在**真实成交时刻**用同一个 `evaluateStGate` 判 `PRE_FILL`：
 * 只有 `NORMAL` 放行，`ST` / `UNKNOWN` 一律拒单（失败关闭）。
 */
export const ST_EXECUTION_ELIGIBILITY_POLICY_VERSION = "recovery-st-execution-eligibility/1.0.0";

// ---------------------------------------------------------------------------
// 二、事实与 provider 契约
// ---------------------------------------------------------------------------

/** 状态来源的**可核验证据**（区间 + 可获知时间 + 证据指纹）。 */
export interface SecurityStatusFact {
  /** 股票代码（必须与查询的 symbol 逐字一致）。 */
  readonly symbol: string;
  /** 该状态适用的交易日（`YYYY-MM-DD`）。 */
  readonly tradeDate: string;
  readonly status: "NORMAL" | "ST";
  /** 生效时刻（含）；`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ss`。 */
  readonly effectiveFrom: string;
  /**
   * 失效时刻（含）；`null` = 无界。
   *
   * 🔴 `status = "NORMAL"` 时 `null` 会被记 `NORMAL_INTERVAL_UNBOUNDED` ⇒ UNKNOWN
   *    （无界阳性区间不可证伪）。
   */
  readonly effectiveTo: string | null;
  /** 市场**可知**该状态的时刻（公告 / 数据可得时间），不是采集时间。 */
  readonly availableAsOf: string;
  /** 来源标识（如 `SSE_ST_LIST` / `SZSE_ST_LIST` / 平台契约名）。 */
  readonly source: string;
  /** 证据强度：只有 `VERIFIED` 才可能放行。 */
  readonly confidence: "VERIFIED" | "UNVERIFIED";
  /** 证据指纹（可追溯到具体公告 / 采集批次）。 */
  readonly evidenceFingerprint: string;
}

/** provider 查询入参。 */
export interface SecurityStatusQuery {
  readonly symbol: string;
  readonly tradeDate: string;
  readonly timepoint: StCheckTimepoint;
  /** 检查时刻（`YYYY-MM-DDTHH:mm:ss`）；`availableAsOf` 必须 **早于或等于** 它。 */
  readonly effectiveAt: string;
}

/**
 * ST 状态 provider（**唯一**的状态入口）。
 *
 * 🔴 实现方**必须**在无结论时返回 `null`，**不得**用 NORMAL 兜底。
 * 🔴 实现方**不得**直连 SQL：状态必须经平台数据服务/契约供给（目标 §4），
 *    本模块只声明形状。
 */
export interface SecurityStatusProvider {
  readonly providerId: string;
  readonly contractVersion: string;
  statusAt(query: SecurityStatusQuery): SecurityStatusFact | null;
}

/** 缺省 provider：恒无结论 ⇒ 每个候选都是 `UNKNOWN_BLOCKED`。 */
export const ABSENT_STATUS_PROVIDER: SecurityStatusProvider = Object.freeze({
  providerId: ABSENT_STATUS_PROVIDER_ID,
  contractVersion: ST_GATE_CONTRACT_VERSION,
  statusAt: (): SecurityStatusFact | null => null,
});

// ---------------------------------------------------------------------------
// 三、单时点闸门
// ---------------------------------------------------------------------------

/** 单时点闸门判决（含全部证据，可直接进审计产物）。 */
export interface StGateDecision {
  readonly outcome: StGateOutcome;
  readonly buyEligibility: BuyEligibility;
  readonly reason: StGateReason;
  readonly symbol: string;
  readonly tradeDate: string;
  readonly timepoint: StCheckTimepoint;
  readonly effectiveAt: string;
  readonly providerId: string;
  readonly providerContractVersion: string | null;
  /** 命中的原始事实（UNKNOWN 时通常为 null）。 */
  readonly fact: SecurityStatusFact | null;
}

function buyEligibilityOf(outcome: StGateOutcome): BuyEligibility {
  if (outcome === "NORMAL") return "NORMAL";
  return outcome === "ST" ? "ST_BLOCKED" : "UNKNOWN_BLOCKED";
}

function decision(input: {
  readonly outcome: StGateOutcome;
  readonly reason: StGateReason;
  readonly query: SecurityStatusQuery;
  readonly providerId: string;
  readonly providerContractVersion: string | null;
  readonly fact?: SecurityStatusFact | null;
}): StGateDecision {
  return {
    outcome: input.outcome,
    buyEligibility: buyEligibilityOf(input.outcome),
    reason: input.reason,
    symbol: input.query.symbol,
    tradeDate: input.query.tradeDate,
    timepoint: input.query.timepoint,
    effectiveAt: input.query.effectiveAt,
    providerId: input.providerId,
    providerContractVersion: input.providerContractVersion,
    fact: input.fact ?? null,
  };
}

/**
 * 时间归一化（FIX-005 / F2）。
 *
 * 🔴 时区统一为**中国市场当地时间**：本模块只做**字面量**比较（不 `new Date()`、
 *    不做时区换算），因此 `YYYY-MM-DDTHH:mm:ss` 的字典序就是当地时间的先后序。
 * 🔴 只接受两种写法；其它写法（含 `2024-1-04` 这类「看起来像日期」的写法）与
 *    非法日历日（如 `2024-13-45`）一律**拒收** ⇒ `INVALID_STATUS_TIME_FORMAT`(UNKNOWN)。
 *    修正前它们会因字典序恰好落在区间内而被当成有效证据。
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function isValidLocalDateTimeText(value: string): boolean {
  if (!isValidCalendarDate(Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10)))) {
    return false;
  }
  if (value.length === 10) return true;
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

/**
 * **开始**时刻归一化：日期形式 ⇒ 当地 `00:00:00`；带时间形式 ⇒ 原样；不可识别 ⇒ `null`。
 */
function normalizedIntervalStart(value: string): string | null {
  if (DATE_ONLY_RE.test(value)) return isValidLocalDateTimeText(value) ? `${value}T00:00:00` : null;
  if (DATE_TIME_RE.test(value)) return isValidLocalDateTimeText(value) ? value : null;
  return null;
}

/**
 * **结束**时刻归一化：日期形式 ⇒ 覆盖**该完整日期**（当地 `23:59:59`，闭区间含端点）；
 * 带时间形式 ⇒ 原样（**精确时间不得扩展到整日**）；不可识别 ⇒ `null`。
 */
function normalizedIntervalEnd(value: string): string | null {
  if (DATE_ONLY_RE.test(value)) return isValidLocalDateTimeText(value) ? `${value}T23:59:59` : null;
  if (DATE_TIME_RE.test(value)) return isValidLocalDateTimeText(value) ? value : null;
  return null;
}

/**
 * 单时点闸门。
 *
 * 顺序（**先拒后放**，任何一步不满足即 UNKNOWN）：
 *  1. 没有 provider ⇒ `NO_STATUS_PROVIDER`；
 *  2. provider 契约版本不一致 ⇒ `PROVIDER_CONTRACT_MISMATCH`；
 *  3. `statusAt` 返回 null ⇒ `NO_STATUS_FACT`；
 *  4. `confidence !== "VERIFIED"` ⇒ `UNVERIFIED_STATUS_EVIDENCE`；
 *  5. symbol 不一致 ⇒ `SYMBOL_MISMATCH`；
 *  6. 时间写法不可识别 / 非法日历日 ⇒ `INVALID_STATUS_TIME_FORMAT`；
 *  7. `availableAsOf > effectiveAt`（当时还不可知）⇒ `NOT_AVAILABLE_AS_OF`；
 *  8. 区间不覆盖**检查时刻** `effectiveAt` ⇒ `NOT_EFFECTIVE_ON_TRADE_DATE`；
 *  9. `status = "NORMAL"` 且 `effectiveTo === null` ⇒ `NORMAL_INTERVAL_UNBOUNDED`；
 * 10. 否则 `NORMAL` / `ST`。
 *
 * 🔴 第 6–9 步专门对付 S1 审计的三条证据：只有 `effectiveFrom/To` 而没有可获知时间的事实
 *    （E1）无法通过第 7 步；无界区间无法通过第 9 步；而 F2 修正后，日内生效/失效的区间
 *    按**真正的检查时刻**（第 8 步）判定，不再被午夜或字典序误放行/误拒绝。
 */
export function evaluateStGate(input: {
  readonly provider: SecurityStatusProvider | null | undefined;
  readonly query: SecurityStatusQuery;
}): StGateDecision {
  const { provider, query } = input;
  if (provider === null || provider === undefined) {
    return decision({
      outcome: "UNKNOWN",
      reason: "NO_STATUS_PROVIDER",
      query,
      providerId: ABSENT_STATUS_PROVIDER_ID,
      providerContractVersion: null,
    });
  }
  if (provider.contractVersion !== ST_GATE_CONTRACT_VERSION) {
    return decision({
      outcome: "UNKNOWN",
      reason: "PROVIDER_CONTRACT_MISMATCH",
      query,
      providerId: provider.providerId,
      providerContractVersion: provider.contractVersion,
    });
  }
  const fact = provider.statusAt(query);
  if (fact === null) {
    return decision({
      outcome: "UNKNOWN",
      reason: "NO_STATUS_FACT",
      query,
      providerId: provider.providerId,
      providerContractVersion: provider.contractVersion,
    });
  }
  const common = {
    query,
    providerId: provider.providerId,
    providerContractVersion: provider.contractVersion,
    fact,
  } as const;
  if (fact.confidence !== "VERIFIED") {
    return decision({ ...common, outcome: "UNKNOWN", reason: "UNVERIFIED_STATUS_EVIDENCE" });
  }
  if (fact.symbol !== query.symbol) {
    return decision({ ...common, outcome: "UNKNOWN", reason: "SYMBOL_MISMATCH" });
  }
  // 检查时刻必须是可识别的当地日期时间（`effectiveAtOf` 的产物天然合法；这里防的是调用方直传）。
  const checkedAt = normalizedIntervalStart(query.effectiveAt);
  if (checkedAt === null) {
    return decision({ ...common, outcome: "UNKNOWN", reason: "INVALID_STATUS_TIME_FORMAT" });
  }
  const knownAt = normalizedIntervalStart(fact.availableAsOf);
  if (knownAt === null) {
    return decision({ ...common, outcome: "UNKNOWN", reason: "INVALID_STATUS_TIME_FORMAT" });
  }
  if (knownAt > checkedAt) {
    return decision({ ...common, outcome: "UNKNOWN", reason: "NOT_AVAILABLE_AS_OF" });
  }
  const from = normalizedIntervalStart(fact.effectiveFrom);
  if (from === null) {
    return decision({ ...common, outcome: "UNKNOWN", reason: "INVALID_STATUS_TIME_FORMAT" });
  }
  const to = fact.effectiveTo === null ? null : normalizedIntervalEnd(fact.effectiveTo);
  if (fact.effectiveTo !== null && to === null) {
    return decision({ ...common, outcome: "UNKNOWN", reason: "INVALID_STATUS_TIME_FORMAT" });
  }
  // 🔴 F2：区间有效性与可知性用**同一个**检查时刻（`effectiveAt`），不再是午夜。
  const covered = from <= checkedAt && (to === null || checkedAt <= to);
  if (!covered) {
    return decision({ ...common, outcome: "UNKNOWN", reason: "NOT_EFFECTIVE_ON_TRADE_DATE" });
  }
  if (fact.status === "NORMAL" && fact.effectiveTo === null) {
    return decision({ ...common, outcome: "UNKNOWN", reason: "NORMAL_INTERVAL_UNBOUNDED" });
  }
  return decision({
    ...common,
    outcome: fact.status === "NORMAL" ? "NORMAL" : "ST",
    reason: fact.status === "NORMAL" ? "VERIFIED_NORMAL" : "VERIFIED_ST",
  });
}

// ---------------------------------------------------------------------------
// 四、两时点组合（确认日收盘资格 + 成交前复查）
// ---------------------------------------------------------------------------

/** 候选的两时点检查结果。 */
export interface StCandidateGate {
  readonly symbol: string;
  readonly confirmDate: string;
  readonly fillDate: string;
  readonly confirmClose: StGateDecision;
  readonly preFill: StGateDecision;
  /** **两格都为 NORMAL** 才为 true。 */
  readonly buyAllowed: boolean;
  /** 首个失败时点的原因（两格都通过时为 `VERIFIED_NORMAL`）。 */
  readonly rejectionReason: StGateReason;
  /** 失败发生在哪个时点（都通过时 = `CONFIRM_CLOSE_ELIGIBILITY`，仅作占位）。 */
  readonly rejectionTimepoint: StCheckTimepoint;
}

/**
 * 两时点闸门（**唯一**的组合器）。
 *
 * 🔴 确认日收盘检查用于**候选资格**（当日非 ST 才能进次日买单计划）；
 *    成交前检查用于**取消订单**（隔夜转 ST）。
 *    两者都通过（= NORMAL）才允许真实成交；任一为 `ST` / `UNKNOWN` 即拒绝。
 * 🔴 首次买入、重试、再次入场、R 臂、Random 臂**共用本函数**，不得各写一套。
 */
export function evaluateStGateForCandidate(input: {
  readonly provider: SecurityStatusProvider | null | undefined;
  readonly symbol: string;
  readonly confirmDate: string;
  readonly fillDate: string;
}): StCandidateGate {
  const confirmClose = evaluateStGate({
    provider: input.provider,
    query: {
      symbol: input.symbol,
      tradeDate: input.confirmDate,
      timepoint: "CONFIRM_CLOSE_ELIGIBILITY",
      effectiveAt: effectiveAtOf(input.confirmDate, "CONFIRM_CLOSE_ELIGIBILITY"),
    },
  });
  const preFill = evaluateStGate({
    provider: input.provider,
    query: {
      symbol: input.symbol,
      tradeDate: input.fillDate,
      timepoint: "PRE_FILL",
      effectiveAt: effectiveAtOf(input.fillDate, "PRE_FILL"),
    },
  });
  const buyAllowed = confirmClose.outcome === "NORMAL" && preFill.outcome === "NORMAL";
  if (confirmClose.outcome !== "NORMAL") {
    return {
      symbol: input.symbol,
      confirmDate: input.confirmDate,
      fillDate: input.fillDate,
      confirmClose,
      preFill,
      buyAllowed: false,
      rejectionReason: confirmClose.reason,
      rejectionTimepoint: "CONFIRM_CLOSE_ELIGIBILITY",
    };
  }
  return {
    symbol: input.symbol,
    confirmDate: input.confirmDate,
    fillDate: input.fillDate,
    confirmClose,
    preFill,
    buyAllowed,
    rejectionReason: preFill.outcome === "NORMAL" ? "VERIFIED_NORMAL" : preFill.reason,
    rejectionTimepoint: "PRE_FILL",
  };
}

// ---------------------------------------------------------------------------
// 五、覆盖缺口与 `ST_COVERAGE_BLOCKED` 闸门
// ---------------------------------------------------------------------------

/** `ST_COVERAGE_BLOCKED` 状态码（实验结果与异常的**唯一**状态字面量）。 */
export const ST_COVERAGE_BLOCKED = "ST_COVERAGE_BLOCKED" as const;

/** 一条计划内的候选检查点（结果来自 `evaluateStGateForCandidate`）。 */
export interface StCoverageCheckpoint {
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly group: string;
  readonly confirmDate: string;
  readonly fillDate: string;
  readonly gate: StCandidateGate;
}

/** 覆盖缺口汇总（**可核验 NORMAL / ST / UNKNOWN** 三分账 + 逐时点/逐原因明细）。 */
export interface StCoverageGapSummary {
  readonly status: typeof ST_COVERAGE_BLOCKED | "ST_COVERAGE_VERIFIED";
  /** 计划内的候选检查点数（一个候选 = 两格检查点 ⇒ `timepointChecks = 2 × candidates`）。 */
  readonly candidateCount: number;
  readonly timepointChecks: number;
  readonly verifiedNormalCount: number;
  readonly stRejectedCount: number;
  readonly unknownCount: number;
  readonly unknownByTimepoint: Readonly<Record<StCheckTimepoint, number>>;
  readonly unknownByReason: Readonly<Record<string, number>>;
  /** 缺口样例（**封顶**，避免把结果信封撑爆）；按输入顺序取前 `gapSampleLimit` 条。 */
  readonly gapSamples: readonly {
    readonly anchorEventId: string;
    readonly symbol: string;
    readonly group: string;
    readonly tradeDate: string;
    readonly timepoint: StCheckTimepoint;
    readonly reason: StGateReason;
  }[];
  /** 🔴 任一计划时点缺少可核验结论 ⇒ true ⇒ **不得产出收益矩阵**。 */
  readonly blocked: boolean;
  readonly note: string;
}

/** 缺口样例上限（进结果信封，必须封顶）。 */
export const ST_COVERAGE_GAP_SAMPLE_LIMIT = 50;

/**
 * 汇总覆盖缺口。
 *
 * 🔴 `blocked === unknownCount > 0`：目标 §4 「若任一计划候选资格/潜在成交检查时点缺少
 *    可验证 NORMAL 或 ST 结论，默认暂停收益矩阵」。这里**没有**「少量 UNKNOWN 可以放行」的
 *    容错分支 —— 容错会把「大面积 UNKNOWN 拒单导致的空仓」当成结论。
 */
export function summarizeStCoverage(
  checkpoints: readonly StCoverageCheckpoint[],
  options: { readonly gapSampleLimit?: number } = {},
): StCoverageGapSummary {
  const limit = options.gapSampleLimit ?? ST_COVERAGE_GAP_SAMPLE_LIMIT;
  const unknownByTimepoint: Record<StCheckTimepoint, number> = {
    CONFIRM_CLOSE_ELIGIBILITY: 0,
    PRE_FILL: 0,
  };
  const unknownByReason: Record<string, number> = {};
  const gapSamples: StCoverageGapSummary["gapSamples"][number][] = [];
  let verifiedNormalCount = 0;
  let stRejectedCount = 0;
  let unknownCount = 0;
  let timepointChecks = 0;

  for (const checkpoint of checkpoints) {
    for (const side of [checkpoint.gate.confirmClose, checkpoint.gate.preFill]) {
      timepointChecks += 1;
      if (side.outcome === "NORMAL") {
        verifiedNormalCount += 1;
        continue;
      }
      if (side.outcome === "ST") {
        stRejectedCount += 1;
        continue;
      }
      unknownCount += 1;
      unknownByTimepoint[side.timepoint] += 1;
      unknownByReason[side.reason] = (unknownByReason[side.reason] ?? 0) + 1;
      if (gapSamples.length < limit) {
        gapSamples.push({
          anchorEventId: checkpoint.anchorEventId,
          symbol: checkpoint.symbol,
          group: checkpoint.group,
          tradeDate: side.tradeDate,
          timepoint: side.timepoint,
          reason: side.reason,
        });
      }
    }
  }

  const blocked = unknownCount > 0;
  return {
    status: blocked ? ST_COVERAGE_BLOCKED : "ST_COVERAGE_VERIFIED",
    candidateCount: checkpoints.length,
    timepointChecks,
    verifiedNormalCount,
    stRejectedCount,
    unknownCount,
    unknownByTimepoint,
    unknownByReason,
    gapSamples,
    blocked,
    note: blocked
      ? "存在缺少可核验 NORMAL/ST 结论的计划检查时点 ⇒ 按目标 §4 默认条款**暂停收益矩阵**，"
        + "只交付覆盖缺口。**不得**用「大面积 UNKNOWN 拒单后的空仓结果」评价新买点。"
      : "全部计划检查时点都有可核验结论 ⇒ ST 闸门可在真实数据上通过验收。",
  };
}

/** `ST_COVERAGE_BLOCKED` 的异常形态（实验 `run()` 用它**显式退出**，不产出矩阵）。 */
export class StCoverageBlockedError extends Error {
  readonly code = ST_COVERAGE_BLOCKED;
  readonly summary: StCoverageGapSummary;
  constructor(summary: StCoverageGapSummary) {
    super(formatStCoverageGapSummary(summary));
    this.name = "StCoverageBlockedError";
    this.summary = summary;
  }
}

/** 人读的缺口摘要（进日志与异常消息）。 */
export function formatStCoverageGapSummary(summary: StCoverageGapSummary): string {
  const byTimepoint = ST_CHECK_TIMEPOINTS
    .map((timepoint) => `${timepoint}=${summary.unknownByTimepoint[timepoint]}`)
    .join(", ");
  const byReason = Object.entries(summary.unknownByReason)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");
  return `${ST_COVERAGE_BLOCKED}：候选 ${summary.candidateCount}、检查点 ${summary.timepointChecks} `
    + `（NORMAL ${summary.verifiedNormalCount} / ST ${summary.stRejectedCount} / UNKNOWN ${summary.unknownCount}）；`
    + `逐时点缺口 ${byTimepoint}；逐原因 ${byReason || "无"}。收益矩阵暂停。`;
}
