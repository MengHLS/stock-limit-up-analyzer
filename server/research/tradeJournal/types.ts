/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录（Trade Journal）：类型契约（权威源）。
 *
 * 定位与边界（对齐 TASK_TRACKING §3.8 C-24.1，依赖 C-23.2）：
 *   本目录为每一笔模拟交易（来自 C-23.2 signalToPnl 闭环的 SignalToPnlRun）建立
 *   「计划 vs 实际」对照日志（TradeJournalEntry）：
 *     - planned 事实来源 = 决策日生成的订单意图（SignalToPnlRun.orders 及其来源信号）；
 *     - actual 事实来源   = executionTime 的成交流（SignalToPnlRun.fills）；
 *     - 未成交事实来源    = C-23.2 编排审计（rejectionLedger 的约束违反 reasonCode）。
 *   并交付：机器核对（reconcilePlanVsActual，纯函数）、人工标注承载（AnnotationBlock，
 *   模块零生成）、append-only 日志账本（TradeJournalLedger，修订 = bump 新版本挂
 *   supersedes 链）、PostReviewRecord（对单笔/批量的复盘快照 + C-16.3 指标引用不重算）。
 *
 * 不属于本任务（诚实边界，留给下游消费）：
 *   - C-24.2 纪律反馈分析：违规原因统计 / 重复错误识别 / 最差执行策略排序 /
 *     易错环境识别等**跨交易的聚合分析**。本目录只产出单笔/逐笔的结构化记录。
 *   - 不做任何「纪律得分」自动打分；reason/emotion/rule violation 是**人工注入**字段，
 *     本模块绝不编造主观内容；不做任何策略结论；不做 planned 决策前的信号质量评价。
 *
 * 复用（只读 import，不复制不重写）：
 *   - C-23.2 signalToPnl：SignalToPnlRun / orders / fills / rejectionLedger（事实来源）
 *     + assertValidSignalToPnlRun / computeSignalToPnlRunFingerprint（来源可信复核）；
 *   - C-23.1 paperAccount：PaperAccountOrder / PaperAccountFill（字段形态）；
 *   - C-16.3 tradeQualityMetrics：TradeQualityEvaluationRun 记录仅作**引用**（不重算）；
 *   - C-21.1 lifecycle：append-only 账本 + 防篡改断链哲学（本目录 ledger.ts 参照）；
 *   - C-13.3 experimentLineage：显式缺失码（LINEAGE_MISSING_CODES）哲学 → 本目录
 *     TJ_UNASSESSED_REASON_CODES（unassessed + reasonCode，禁止猜测）；
 *   - researchDataset/version：canonicalStringify（指纹序列化）。
 *
 * 铁律：
 *   - PIT 安全：日志在 T 时刻只能引用 T 及之前已知信息；planned（决策日 D 时点）与
 *     actual（成交时点 D+1 及之后）各自保留时间戳与信息边界；annotatedAt/createdAt
 *     （人工标注/入账时点）必须不早于该笔交易的成交时点——事后补录不会伪装成当时决策。
 *   - 确定性：纯函数、readonly 入参、无 Date.now/Math.random/IO；时间戳一律注入式。
 *   - 指纹防篡改：canonicalStringify + sha256 + serialize/deserialize/validate round-trip；
 *     账本 append-only，修订 = bump 新版本挂 supersedes 链（对齐 lifecycle 复活哲学）。
 *   - FAIL FAST：非法输入 / 字段缺失 / 时间序颠倒（actual 早于 planned）→ 响亮抛错
 *     （稳定 error code），禁止静默丢记录。
 *   - 字段缺失处显式 unassessed + reasonCode，不猜。
 */

import type { OrderStatus, Side } from "../../backtest/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 交易日志条目记录种类标签（供序列化/反序列化判别，防止类型混淆）。 */
export const TRADE_JOURNAL_ENTRY_KIND = "TRADE_JOURNAL_ENTRY" as const;

/** 日志条目 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const TRADE_JOURNAL_ENTRY_RECORD_VERSION = 1 as const;

/** 复盘记录（PostReview）记录种类标签。 */
export const POST_REVIEW_RECORD_KIND = "POST_REVIEW_RECORD" as const;

/** 复盘记录 schema 版本。 */
export const POST_REVIEW_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Journal 域前缀：本目录所有顶层符号以 Journal*/TJ_*/Reconcile* 为前缀（全库查重零冲突）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 显式缺省 / unassessed 原因码（字段缺失处使用，禁止猜测默认值）
// ---------------------------------------------------------------------------

/**
 * 显式缺省码白名单（稳定机器码，validate 校验其合法性）。
 * 语义对齐 experimentLineage.LINEAGE_MISSING_CODES：当 planned/actual 载体中
 * 某字段不可解析/不存在时，用「unassessed + reasonCode」显式占位，绝不静默兜底。
 */
export const TJ_UNASSESSED_REASON_CODES = {
  /** planned 参考价在 run 记录中不可得（如该单未成交、无决策日 close 载体）。 */
  PLANNED_PRICE_REFERENCE_MISSING: "TJ_PLANNED_PRICE_REFERENCE_MISSING",
  /** 市价单计划本身未定义价格区间（非限价单）——信息性 unassessed，非缺失。 */
  PLANNED_PRICE_RANGE_NOT_DEFINED: "TJ_PLANNED_PRICE_RANGE_NOT_DEFINED",
  /** 无成交记录可核对价格。 */
  NO_FILL_RECORDED: "TJ_NO_FILL_RECORDED",
  /** 执行偏移需交易日历（tradingCalendar）计算而调用方未提供。 */
  EXECUTION_OFFSET_CALENDAR_MISSING: "TJ_EXECUTION_OFFSET_CALENDAR_MISSING",
  /** 决策日与执行日在 run 交易日历中非相邻，无法用 basePrice 推断决策日 close。 */
  EXECUTION_DAY_NON_ADJACENT: "TJ_EXECUTION_DAY_NON_ADJACENT",
  /** 有成交但无 planned 参考价，价格偏差不可算。 */
  PRICE_DEVIATION_NO_REFERENCE: "TJ_PRICE_DEVIATION_NO_REFERENCE",
} as const;

export type TJUnassessedReasonCode =
  (typeof TJ_UNASSESSED_REASON_CODES)[keyof typeof TJ_UNASSESSED_REASON_CODES];

/** 值是否为合法 unassessed 原因码。 */
export function isTJUnassessedReasonCode(value: string): value is TJUnassessedReasonCode {
  return (Object.values(TJ_UNASSESSED_REASON_CODES) as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 偏差维度（DeviationDimension：机器可计算维度 vs 人工归因维度分开）
// ---------------------------------------------------------------------------

/**
 * 机器可计算偏差维度（由 reconcilePlanVsActual 自动判定，模块零人工干预）。
 *   - QUANTITY     数量偏差：已成交但成交股数 ≠ planned 股数（部分成交/超额成交）；
 *   - PRICE        价格偏差：成交价超出计划价格约束（限价/价格带）——市价单计划
 *                   未定义价格带时此维度不判定（数值价格偏差仍记录供人工复盘）；
 *   - TIMING       时机偏差：成交时点 ≠ planned 执行窗口（早于/晚于 D+1）；
 *   - UNFILLED     未执行：订单被拒/未成交（引用 C-23.2 rejectionLedger 的 reasonCode）；
 *   - PARTIAL_FILL 部分成交：订单仅成交部分股数。
 */
export const JOURNAL_DEVIATION_DIMENSIONS = [
  "QUANTITY",
  "PRICE",
  "TIMING",
  "UNFILLED",
  "PARTIAL_FILL",
] as const;

export type JournalDeviationDimension =
  (typeof JOURNAL_DEVIATION_DIMENSIONS)[number];

/**
 * 偏差维度的来源分类：机器可计算 vs 人工归因（两类分开，禁止混淆）。
 *   - MACHINE_CALCULABLE：由计划/成交数据自动计算；
 *   - HUMAN_ATTRIBUTION：只能由人工事后归因（reason/emotion/rule violation 等主观
 *     维度不进入本枚举，统一承载于 AnnotationBlock，模块零生成）。
 */
export type JournalDeviationDimensionOrigin =
  | "MACHINE_CALCULABLE"
  | "HUMAN_ATTRIBUTION";

/** 各偏差维度 → 来源分类（机器维度可计算；本枚举不含人工归因维度，人工维度见 AnnotationBlock）。 */
export const JOURNAL_DEVIATION_DIMENSION_ORIGINS: Readonly<
  Record<JournalDeviationDimension, JournalDeviationDimensionOrigin>
> = {
  QUANTITY: "MACHINE_CALCULABLE",
  PRICE: "MACHINE_CALCULABLE",
  TIMING: "MACHINE_CALCULABLE",
  UNFILLED: "MACHINE_CALCULABLE",
  PARTIAL_FILL: "MACHINE_CALCULABLE",
};

/** 值是否为合法偏差维度。 */
export function isJournalDeviationDimension(value: string): value is JournalDeviationDimension {
  return (JOURNAL_DEVIATION_DIMENSIONS as readonly string[]).includes(value);
}

/** 偏差维度排序（供确定性序列化/展示）。 */
export const JOURNAL_DEVIATION_DIMENSION_ORDER: readonly JournalDeviationDimension[] = [
  "UNFILLED",
  "PARTIAL_FILL",
  "QUANTITY",
  "PRICE",
  "TIMING",
];

// ---------------------------------------------------------------------------
// 成交状态（机器核对输出：全部成交 / 部分成交 / 未成交）
// ---------------------------------------------------------------------------

export const JOURNAL_FILL_STATES = ["FULL", "PARTIAL", "NONE"] as const;
export type JournalFillState = (typeof JOURNAL_FILL_STATES)[number];

// ---------------------------------------------------------------------------
// 人工归因受控词表（reasonCode / emotionCode / rule violation——全部人工注入）
// ---------------------------------------------------------------------------

/**
 * 偏差原因受控词表（human attribution，人工标注时选用；C-24.2 按码聚合消费）。
 * 每个码的含义必须稳定，禁止复用/混用：
 *   - OMISSION             规则记得但操作遗漏（该做未做）；
 *   - MISUNDERSTANDING     对规则的理解/应用错误；
 *   - IMPULSIVE            冲动下单，未按计划执行；
 *   - JUDGMENT_OVERRIDE    明知规则但判断性覆盖（有意偏离）；
 *   - EXECUTION_TECHNICAL  执行技术问题（系统/延迟/手数/路径）；
 *   - MARKET_EVENT         突发市场事件导致的偏离（涨跌停/停牌/流动性等客观事件）；
 *   - INFORMATION_SHORTAGE 决策时信息不足（事后认定）；
 *   - OTHER                其它人工归因（reasonNote 必填）。
 */
export const JOURNAL_REASON_CODES = [
  "OMISSION",
  "MISUNDERSTANDING",
  "IMPULSIVE",
  "JUDGMENT_OVERRIDE",
  "EXECUTION_TECHNICAL",
  "MARKET_EVENT",
  "INFORMATION_SHORTAGE",
  "OTHER",
] as const;

export type JournalReasonCode = (typeof JOURNAL_REASON_CODES)[number];

/** 值是否为合法 reasonCode。 */
export function isJournalReasonCode(value: string): value is JournalReasonCode {
  return (JOURNAL_REASON_CODES as readonly string[]).includes(value);
}

/**
 * 情绪受控词表（human attribution；标注时选用，C-24.2 可按码聚合）。
 */
export const JOURNAL_EMOTION_CODES = [
  "FEAR", // 恐惧（怕亏损/怕踏空后回撤）
  "GREED", // 贪婪（期望更高收益而过度持仓/追高）
  "FOMO", // 害怕错过（看到上涨冲动跟进）
  "HOPE", // 期望回本而扛单/延迟止损
  "PANIC", // 恐慌（急跌时非计划离场）
  "REGRET", // 悔恨（因错过/止损后反弹而冲动纠错）
  "OVERCONFIDENCE", // 过度自信（连续盈利后放松风控）
  "FRUSTRATION", // 沮丧/烦躁
  "CALM", // 平静（遵守纪律时的中性情绪）
  "OTHER", // 其它（emotionNote 必填）
] as const;

export type JournalEmotionCode = (typeof JOURNAL_EMOTION_CODES)[number];

/** 值是否为合法 emotionCode。 */
export function isJournalEmotionCode(value: string): value is JournalEmotionCode {
  return (JOURNAL_EMOTION_CODES as readonly string[]).includes(value);
}

/** 规则违反严重程度（人工声明）。 */
export const JOURNAL_RULE_VIOLATION_SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;
export type JournalRuleViolationSeverity =
  (typeof JOURNAL_RULE_VIOLATION_SEVERITIES)[number];

// ---------------------------------------------------------------------------
// 复盘评级（人工注入，1-5；null = 该项未评）
// ---------------------------------------------------------------------------

export const JOURNAL_REVIEW_RATING_MIN = 1 as const;
export const JOURNAL_REVIEW_RATING_MAX = 5 as const;

export type JournalReviewRatingValue =
  | 1 | 2 | 3 | 4 | 5;

/** 值是否为合法评级（1-5）。 */
export function isJournalReviewRatingValue(value: number): value is JournalReviewRatingValue {
  return Number.isInteger(value) && value >= JOURNAL_REVIEW_RATING_MIN && value <= JOURNAL_REVIEW_RATING_MAX;
}

// ---------------------------------------------------------------------------
// 来源引用（关联 C-23.2 run / 订单 / 成交）
// ---------------------------------------------------------------------------

/**
 * 交易日志条目的 run 级引用（对齐 SignalToPnlRun 的身份/追溯字段，纯引用不内嵌整份 run）。
 */
export interface JournalRunRef {
  readonly kind: "SIGNAL_TO_PNL_RUN";
  readonly runId: string;
  readonly accountId: string;
  readonly datasetVersion: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 来源候选记录指纹（= run.sourceFingerprint；对账用）。 */
  readonly sourceCandidateFingerprint: string;
}

/** 订单引用（planned 载体）。 */
export interface JournalOrderRef {
  readonly orderId: string;
  /** 订单终态（复用 STEP 8 OrderStatus 单一来源）。 */
  readonly status: OrderStatus;
  readonly orderType: "market" | "limit";
  /** 限价单委托价；市价单为 null。 */
  readonly requestedPrice: number | null;
}

/** 成交流引用（actual 载体；一笔订单在 run 内通常恰一笔成交）。 */
export interface JournalFillRef {
  readonly fillId: string;
  readonly quantity: number;
  readonly price: number;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Planned / Actual / Deviation 三节
// ---------------------------------------------------------------------------

/**
 * planned 事实（决策日 D 时点已知；数量 + 价格口径见 reconcile.ts 文件头）。
 * 不做任何未来信息推断：参考价/价格带缺失 → null + unassessed 原因码。
 */
export interface JournalPlannedFacts {
  /** planned 股数（= 订单目标股数，100 整数倍）。 */
  readonly quantity: number;
  /**
   * planned 执行窗口长度（交易日数）。C-23.2 订单 executionTime=D+1 → 窗口 = 1。
   * 成交在该窗口内 = 按时执行；早于窗口首日 = 早于计划；晚于 = 延迟执行。
   */
  readonly executionWindowDays: number;
  /**
   * planned 参考价（决策日已知价格，机器核对价格偏差的口径基准），可为 null。
   * 口径 = 决策日 D 收盘价（已知于 D 时点，PIT 安全；不是 D+1 的 open）。
   */
  readonly referencePrice: number | null;
  /** referencePrice 的口径说明（人类可读；如「决策日 close（由成交记录 basePrice 给出）」）。 */
  readonly referencePriceBasis: string | null;
  /** referencePrice 不可得时显式缺省原因；null = 无缺省。 */
  readonly referencePriceUnassessedReasonCode: TJUnassessedReasonCode | null;
  /**
   * planned 价格带（计划对该笔成交的价格约束；限价单 = 单点带）。市价单计划
   * 未定义价格带 → null + PLANNED_PRICE_RANGE_NOT_DEFINED（信息性，非数据缺失）。
   */
  readonly priceRangeLow: number | null;
  readonly priceRangeHigh: number | null;
  readonly priceRangeUnassessedReasonCode: TJUnassessedReasonCode | null;
}

/**
 * actual 事实（成交记录聚合；未成交 → null，由 deviation.fillState=NONE 表达）。
 */
export interface JournalActualFacts {
  /** 成交引用清单（升序 by fillId，确定性）。 */
  readonly fillRefs: readonly JournalFillRef[];
  /** 实际成交股数合计。 */
  readonly quantity: number;
  /** 实际成交价 = 数量加权平均价（多笔部分成交时）。 */
  readonly price: number;
  /** 末笔成交时点（YYYY-MM-DD）。 */
  readonly fillTimestamp: string;
  /** 实际成交的基准价（= 该单首笔成交的 basePrice；run 中 = 执行日前一交易日收盘价）。 */
  readonly basePrice: number | null;
}

/**
 * 机器核对输出（deviation 节；由 reconcilePlanVsActual 产出，本结构同时承载
 * reconcile 的入参/出参契约——见 reconcile.ts）。
 *
 * 全部字段机器可计算；缺失处显式 unassessed + reasonCode，不猜。
 */
export interface JournalDeviation {
  /** 成交状态：FULL 全部成交 / PARTIAL 部分成交 / NONE 未成交。 */
  readonly fillState: JournalFillState;
  /** 实际成交股数（NONE 时 null）。 */
  readonly actualQuantity: number | null;
  /** 数量偏差 = actualQuantity − plannedQuantity（NONE 时 null）。 */
  readonly quantityDeviation: number | null;
  /** 未成交的剩余数量（PARTIAL 时 = planned − actual；否则 null）。 */
  readonly partialFillRemainingQuantity: number | null;
  /** 实际成交价（VWAP；NONE 时 null）。 */
  readonly actualFillPrice: number | null;
  /** 实际成交时点（末笔；NONE 时 null）。 */
  readonly actualFillTimestamp: string | null;
  /**
   * 价格偏差 = 实际成交价 − planned 参考价（口径：与 planned 参考价 vs 实际成交价）。
   * 市价单且未提供 planned 参考价 → null + PRICE_DEVIATION_NO_REFERENCE。
   */
  readonly priceDeviation: number | null;
  /** 价格偏差口径（人类可读；如「实际成交价 − 决策日 close」）。 */
  readonly priceDeviationBasis: string | null;
  /** 价格偏差不可算的显式缺省原因。 */
  readonly priceDeviationUnassessedReasonCode: TJUnassessedReasonCode | null;
  /** 是否在 planned 执行窗口内成交（fill 时点 == expectedExecutionDate）；NONE 时 null。 */
  readonly executedInPlannedWindow: boolean | null;
  /** 执行偏移（交易日数，相对 expectedExecutionDate；0 = D+1 准时；需 tradingCalendar）。 */
  readonly executionOffsetTradingDays: number | null;
  /** 执行偏移不可算的显式缺省原因。 */
  readonly executionOffsetUnassessedReasonCode: TJUnassessedReasonCode | null;
  /** 未成交原因码（引用 C-23.2 编排审计 rejectionLedger 的 reasonCode，原样保留）；有成交时 null。 */
  readonly unfilledReasonCode: string | null;
  /** 未成交原因文本（引用 C-23.2 rejectionLedger.reason）。 */
  readonly unfilledReasonText: string | null;
  /** 机器判定的偏差维度清单（升序 by JOURNAL_DEVIATION_DIMENSION_ORDER，确定性）。 */
  readonly machineDeviationDimensions: readonly JournalDeviationDimension[];
  /** 机器核对附注（口径/推断说明；可为 null）。 */
  readonly reconcileNote: string | null;
}

// ---------------------------------------------------------------------------
// 人工标注（AnnotationBlock：reason/emotion/rule violation 声明——全部人工注入）
// ---------------------------------------------------------------------------

/**
 * 规则违反声明（人工注入；declared=false 即「经复盘未发现规则违反」，非模块默认）。
 */
export interface JournalRuleViolationDeclaration {
  /** 是否声明存在规则违反（人工判断，默认必须显式声明 true/false）。 */
  readonly declared: boolean;
  /** 被违反规则引用（规则 id / label；可选）。 */
  readonly violatedRuleRef: string | null;
  /** 严重程度（人工声明；可选）。 */
  readonly severity: JournalRuleViolationSeverity | null;
  /** 违反详情（自由文本，可选）。 */
  readonly violationNote: string | null;
}

/**
 * 人工标注块（AnnotationBlock）——承载事后人工复盘的主观归因。
 * 本模块零生成：draft entry 的 annotation = null；只有人工通过标注修订写入。
 * annotatedAt 必须不早于成交/决策时点（PIT：事后补录不得伪装成当时决策）。
 */
export interface JournalAnnotationBlock {
  /** 偏差归因（reasonCode 受控词表；null = 未归因）。 */
  readonly reasonCode: JournalReasonCode | null;
  /** reason 自由文本（reasonCode=OTHER 时必填）。 */
  readonly reasonNote: string | null;
  /** 情绪归因（emotionCode 受控词表；null = 未归因）。 */
  readonly emotionCode: JournalEmotionCode | null;
  /** emotion 自由文本（emotionCode=OTHER 时必填）。 */
  readonly emotionNote: string | null;
  /** 规则违反声明（人工；null = 尚未复盘该维度）。 */
  readonly ruleViolation: JournalRuleViolationDeclaration | null;
  /** 复盘自由文本。 */
  readonly reviewNote: string | null;
  /** 标注者身份（注入式；可空）。 */
  readonly annotator: string | null;
  /** 标注时点（注入式 ISO-8601 UTC；必须不早于该笔交易成交时点）。 */
  readonly annotatedAt: string;
}

// ---------------------------------------------------------------------------
// 主记录：TradeJournalEntry
// ---------------------------------------------------------------------------

/**
 * 单笔模拟交易的计划 vs 实际对照日志条目（不可变；修订 = bump entryVersion 挂 supersedes 链）。
 *
 * 关联（对应任务规格）：run id / securityId / 决策日 D / 执行日 D+1 / 订单 ref /
 * 成交 ref / 方向 / planned 数量与价格区间 / actual 数量与价格 / deviation 结构化。
 */
export interface TradeJournalEntry {
  readonly recordKind: typeof TRADE_JOURNAL_ENTRY_KIND;
  readonly recordVersion: typeof TRADE_JOURNAL_ENTRY_RECORD_VERSION;

  /** 条目身份（唯一；跨版本不重复）。 */
  readonly entryId: string;
  /** 逻辑日志身份（跨修订稳定，如 `${runId}#${orderId}`）。 */
  readonly journalId: string;
  /** 修订版本（1-based；同一 journalId 下递增）。 */
  readonly entryVersion: number;
  /** 被本条修订取代的上一个条目 entryId；v1 = null。 */
  readonly supersedesEntryId: string | null;
  /** 条目入账时点（注入式 ISO-8601 UTC；不得早于成交时点——事后记录不伪装成当时决策）。 */
  readonly createdAt: string;

  // 关联
  readonly runRef: JournalRunRef;
  readonly orderRef: JournalOrderRef;

  // 交易身份（条目级，便于查询）
  readonly securityId: string;
  readonly side: Side;
  /** 决策日 D（YYYY-MM-DD；planned 时点，PIT 上界）。 */
  readonly decisionDate: string;
  /** 执行日 D+1（订单 executionTime；planned 允许成交的最早交易日）。 */
  readonly expectedExecutionDate: string;

  // planned / actual / deviation
  readonly planned: JournalPlannedFacts;
  readonly actual: JournalActualFacts | null;
  readonly deviation: JournalDeviation;

  /** 人工标注（人工注入；draft 为 null，标注修订时写入）。 */
  readonly annotation: JournalAnnotationBlock | null;

  /** 内容指纹（sha256 hex）：除本字段外全部字段的确定性 JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 复盘记录（PostReviewRecord：单笔/批量复盘快照 + C-16.3 指标引用不重算）
// ---------------------------------------------------------------------------

/** 复盘评级（人工注入；rating 1-5，null = 该项未评）。 */
export interface JournalReviewRating {
  readonly rating: JournalReviewRatingValue | null;
  readonly note: string | null;
}

/**
 * 指标引用（引用既有评估记录，**不重算**、不内嵌指标数值——展示/消费由被引记录承担）。
 * 目前唯一支持引用 C-16.3 TradeQualityEvaluationRun（evaluateTradeQualityMetrics 产出）。
 */
export interface JournalMetricsReference {
  readonly kind: "TRADE_QUALITY_EVALUATION_RUN";
  /** 被引记录标识（runId）。 */
  readonly recordId: string;
  /** 被引记录指纹（可选；便于对账防串引）。 */
  readonly recordFingerprint: string | null;
}

/** PostReview 作用域（单笔 = 1 个 journalId；批量 = ≥1 个 journalId）。 */
export interface JournalReviewScope {
  /** 作用域类型（SINGLE_ENTRY：恰好 1 个 journalId；ENTRY_BATCH：≥1 个）。 */
  readonly scopeType: "SINGLE_ENTRY" | "ENTRY_BATCH";
  /** 被复盘条目逻辑身份（journalId）清单（去重升序，确定性）。 */
  readonly journalIds: readonly string[];
}

/**
 * Post-review 快照：对单笔或一批日志条目的人工复盘。
 * 各评级/改进点/规则遵守为人工注入；机器只做结构承载与指纹防篡改。
 */
export interface PostReviewRecord {
  readonly recordKind: typeof POST_REVIEW_RECORD_KIND;
  readonly recordVersion: typeof POST_REVIEW_RECORD_VERSION;

  /** 复盘身份（唯一）。 */
  readonly reviewId: string;
  /** 复盘时点（注入式 ISO-8601 UTC）。 */
  readonly createdAt: string;
  /** 复盘者身份（注入式；可空）。 */
  readonly reviewerId: string | null;

  /** 复盘范围。 */
  readonly scope: JournalReviewScope;

  /** planned 质量复盘（回顾 planned 阶段决策质量：信号/预算/价格带设定）。 */
  readonly plannedQuality: JournalReviewRating;
  /** 执行质量复盘（回顾 actual 执行阶段：成交价/时机/手数）。 */
  readonly executionQuality: JournalReviewRating;
  /** 规则遵守复盘（人工评级 + 备注）。 */
  readonly ruleAdherence: JournalReviewRating;
  /** 下次改进点（人工注入，逐条自由文本）。 */
  readonly nextImprovements: readonly string[];
  /** 引用评价（C-16.3 等评估记录引用，不重算）。 */
  readonly metricsReferences: readonly JournalMetricsReference[];

  /** 内容指纹（sha256 hex）：除本字段外全部字段的确定性 JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// reconcile 的入参/出参契约（纯函数 reconcilePlanVsActual，见 reconcile.ts）
// ---------------------------------------------------------------------------

/**
 * reconcilePlanVsActual 的 planned 侧入参（从 TradeJournalEntry.planned + 交易身份 + 订单 ref 抽取，
 * 或由调用方手工装配）。referencePrice = 决策日已知参考价；价格偏差基于它计算。
 */
export interface ReconcilePlannedIntent {
  readonly securityId: string;
  readonly side: Side;
  /** planned 股数（100 整数倍）。 */
  readonly quantity: number;
  /** 决策日（YYYY-MM-DD）。 */
  readonly decisionDate: string;
  /** 计划最早执行日（订单 executionTime = D+1）。 */
  readonly expectedExecutionDate: string;
  /** planned 执行窗口长度（交易日数）；C-23.2 = 1。 */
  readonly executionWindowDays: number;
  /** planned 参考价（决策日已知）；null = 未提供（价格偏差 unassessed）。 */
  readonly referencePrice: number | null;
  /** referencePrice 口径（人类可读）。 */
  readonly referencePriceBasis: string | null;
  /** 计划价格带（限价/区间约束；市价单 = null）。 */
  readonly priceRangeLow: number | null;
  readonly priceRangeHigh: number | null;
}

/** reconcilePlanVsActual 的单笔成交入参。 */
export interface ReconcileActualFill {
  readonly fillId: string;
  readonly securityId: string;
  readonly side: Side;
  /** 成交股数。 */
  readonly quantity: number;
  /** 实际成交价。 */
  readonly price: number;
  /** 成交时点（YYYY-MM-DD）。 */
  readonly timestamp: string;
  /** 成交基准价（执行日前一交易日收盘价；供 planned 参考价推断，可为 null）。 */
  readonly basePrice?: number | null;
}

/**
 * reconcilePlanVsActual 主入参：planned + 成交流（可空）+ 未成交审计 + 可选交易日历。
 * fills 空且 rejectionCode 空 = 无成交记录（如订单仍在途/记录缺失）→ fillState=NONE，
 * 由调用方承担语义；C-23.2 终态 run 的每笔订单必有成交或拒绝审计，二选一。
 */
export interface ReconcilePlanVsActualInput {
  readonly planned: ReconcilePlannedIntent;
  /** 成交流（一笔订单可有多笔部分成交；空数组 = 未成交）。 */
  readonly fills: readonly ReconcileActualFill[];
  /** 未成交原因码（引用 C-23.2 rejectionLedger.rejectionCode，原样保留）。 */
  readonly unfilledReasonCode?: string | null;
  /** 未成交原因文本。 */
  readonly unfilledReasonText?: string | null;
  /** 可选交易日历（升序 YYYY-MM-DD）：用于计算执行偏移（交易日数）。缺省时偏移 unassessed。 */
  readonly tradingCalendar?: readonly string[] | null;
}

// ---------------------------------------------------------------------------
// draft 提取（buildJournalDraftsFromRun）计数与跳过记录
// ---------------------------------------------------------------------------

/** draft 提取跳过原因码（run 内与订单/成交对齐时的异常/非日志项）。 */
export const JOURNAL_DRAFT_SKIP_REASON_CODES = {
  /** 订单终态非 FILLED/PARTIALLY_FILLED/REJECTED（如在途），本构建器不为其建日志。 */
  ORDER_NON_TERMINAL: "TJ_DRAFT_SKIP_ORDER_NON_TERMINAL",
  /** 订单终态成交但 run 无对应成交流（记录不一致）。 */
  ORDER_FILL_RECORD_MISSING: "TJ_DRAFT_SKIP_ORDER_FILL_RECORD_MISSING",
  /** 订单终态 REJECTED 但 run 无对应拒绝审计（记录不一致）。 */
  ORDER_REJECT_RECORD_MISSING: "TJ_DRAFT_SKIP_ORDER_REJECT_RECORD_MISSING",
  /** 成交记录无对应订单（孤儿成交，不进入日志）。 */
  ORPHAN_FILL: "TJ_DRAFT_SKIP_ORPHAN_FILL",
} as const;

export type JournalDraftSkipReasonCode =
  (typeof JOURNAL_DRAFT_SKIP_REASON_CODES)[keyof typeof JOURNAL_DRAFT_SKIP_REASON_CODES];

/** 单条跳过记录。 */
export interface JournalDraftSkipRecord {
  /** 被跳过对象引用（orderId / fillId）。 */
  readonly ref: string;
  readonly reasonCode: JournalDraftSkipReasonCode;
  readonly reason: string;
}

/** draft 提取汇总。 */
export interface JournalDraftCounts {
  readonly ordersInRun: number;
  readonly fillsInRun: number;
  readonly entriesBuilt: number;
  readonly skippedOrders: number;
  /** 孤儿成交（run.fills 无对应订单）数量。 */
  readonly orphanFills: number;
  /** 计划层跳过的意图（run.days[].skipped 累计；未成订单，不建日志条目）。 */
  readonly unJournaledIntents: number;
}

/** buildJournalDraftsFromRun 产出：待标注 draft entry + 诚实跳过计数。 */
export interface JournalDraftExtraction {
  /** 每笔订单 → 一条 draft（entryVersion=1、annotation=null、机器核对自动填）。 */
  readonly entries: readonly TradeJournalEntry[];
  readonly skipped: readonly JournalDraftSkipRecord[];
  readonly counts: JournalDraftCounts;
}
