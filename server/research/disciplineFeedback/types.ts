/**
 * STEP 24 / C-24.2 — 纪律反馈分析（Discipline Feedback Analysis）：类型契约（权威源）。
 *
 * 定位与边界（对齐 TASK_TRACKING §3.8 C-24.2，依赖 C-24.1 tradeJournal）：
 *   本目录对 tradeJournal 中**已标注的多笔交易日志**做**跨交易聚合**，回答四个问题：
 *     ① 违规原因统计（为什么违反规则）            → aggregateViolationCauses；
 *     ② 重复错误识别（哪些错误反复出现）          → detectRepeatMistakes；
 *     ③ 最差执行策略排序（哪类信号/策略执行偏差大）→ rankExecutionQuality；
 *     ④ 易错环境识别（什么环境/品种/时段违规密集） → identifyErrorProneEnvironments。
 *   产出 = **描述性聚合报告 + 机器可读模式清单**，供 C-25.1 闭环整合与人工消费。
 *
 * 不属于本任务（诚实边界，留给 C-25.1 或人工）：
 *   - 端到端编排 / 生产结论 / promotion（C-25.1）；
 *   - 交易决策建议 / 处方式「必须改什么纪律」结论（只提供候选模式排序供人审）；
 *   - 因果推断：本模块全部为「已落账事实的描述性聚合」，不推断谁导致谁。
 *
 * 铁律（ROADMAP §0/§2 与项目纪律）：
 *   - PIT 安全：聚合**只消费记录中已带时间戳的事实**，禁止事后回填、禁止编造当时
 *     不存在的标注/原因/环境标签。环境标签一律由调用方经 environmentAssignments
 *     注入（本模块不自己算 regime）；无标签 entry 显式归 ENV_UNLABELED。
 *   - 确定性：纯函数、readonly 入参、无 Date.now() / Math.random() / IO；时间戳注入；
 *     一切聚合先排序再输出（对象遍历顺序不进入结果）。
 *   - 指纹防篡改：canonicalStringify（researchDataset/version 只读复用）+ sha256；
 *     输入账本只读不改写；记录 serialize/deserialize/validate round-trip。
 *   - FAIL FAST：非法输入 / 未知字段 / 时间序颠倒 / 账本指纹不符 → 响亮抛错
 *     （DFA_* 稳定码）；禁止静默丢数据、禁止用空集合冒充结论。
 *   - 诚实差距：aggregation 只消费已落账事实；annotation=null 的 draft 不计入
 *     原因统计（单列 count）；空账本 / 单 entry / 无标注 → 显式 inconclusive +
 *     reasonCode，不硬出结论。
 *
 * 复用（只读 import，不复制不重写）：
 *   - C-24.1 tradeJournal：TradeJournalEntry / AnnotationBlock / DeviationDimension /
 *     JournalReasonCode / JournalRuleViolationSeverity / JOURNAL_REASON_CODES /
 *     JOURNAL_RULE_VIOLATION_SEVERITIES / JOURNAL_DEVIATION_DIMENSIONS /
 *     assertValidTradeJournalEntry（校验）+ TJ_UNASSESSED_REASON_CODES（显式缺省码哲学）；
 *   - researchDataset/version：canonicalStringify（指纹序列化）。
 */

import type {
  JournalDeviationDimension,
  JournalReasonCode,
  JournalRuleViolationSeverity,
  TradeJournalEntry,
} from "../tradeJournal/types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 纪律反馈分析运行记录种类标签。 */
export const DISCIPLINE_FEEDBACK_RUN_KIND = "DISCIPLINE_FEEDBACK_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增。 */
export const DISCIPLINE_FEEDBACK_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 域前缀：本目录全部顶层符号以 Discipline*/Feedback*/DFA_*/Violation*/Repeat*/
// ExecutionQuality*/Environment* 为前缀（全库查重零冲突，见 index.ts 头注）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 结论（描述性判定，非处方）
// ---------------------------------------------------------------------------

/** 结论判定值：stable / patternsFound / inconclusive（描述性，不构成交易建议）。 */
export type DisciplineFeedbackVerdict = "stable" | "patternsFound" | "inconclusive";

/**
 * 结论 reasonCode 白名单（稳定机器码；validate 校验其合法性）。语义全部为
 * 「基于已落账事实的描述性判定」，不包含任何因果/建议含义。
 */
export const DFA_REASON_CODES = {
  /** 输入账本为空：无任何日志条目可聚合。 */
  NO_ENTRIES: "DFA_NO_ENTRIES",
  /** 全部为待标注 draft（annotation=null）：无人工标注可做纪律聚合。 */
  NO_ANNOTATIONS: "DFA_NO_ANNOTATIONS",
  /** 仅 1 笔日志：跨交易模式判定样本不足。 */
  SINGLE_ENTRY: "DFA_SINGLE_ENTRY",
  /** 有标注但覆盖不完整（存在未复盘 draft）：纪律评估只能基于已标注子集。 */
  PARTIAL_ANNOTATION_COVERAGE: "DFA_PARTIAL_ANNOTATION_COVERAGE",
  /** 覆盖内已标注条目均未声明规则违反（人工复盘口径）。 */
  NO_VIOLATIONS_DECLARED: "DFA_NO_VIOLATIONS_DECLARED",
  /** 存在规则违反声明但仅 1 笔孤立：不足以判定「形成模式」。 */
  ISOLATED_VIOLATION: "DFA_ISOLATED_VIOLATION",
  /** 检出同因重复错误序列（见 repeatPatterns）。 */
  REPEAT_MISTAKES_FOUND: "DFA_REPEAT_MISTAKES_FOUND",
  /** 存在多笔违规但无同因重复：违规原因统计供人工复核。 */
  VIOLATIONS_PRESENT_NO_REPEAT: "DFA_VIOLATIONS_PRESENT_NO_REPEAT",
} as const;

export type DfaReasonCode = (typeof DFA_REASON_CODES)[keyof typeof DFA_REASON_CODES];

/** 值是否为合法结论 reasonCode。 */
export function isDfaReasonCode(value: string): value is DfaReasonCode {
  return (Object.values(DFA_REASON_CODES) as string[]).includes(value);
}

/** 纪律反馈结论摘要（描述性判定；不下处方式结论）。 */
export interface DisciplineFeedbackConclusion {
  readonly verdict: DisciplineFeedbackVerdict;
  readonly reasonCode: DfaReasonCode;
  /** 人类可读的理由（取自「有重复模式 / 样本不足 / 无标注」等描述性判定）。 */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// 环境标签注入（调用方提供，本模块不自己算 regime）
// ---------------------------------------------------------------------------

/**
 * 单条 entry 的环境/regime 标签挂接（调用方注入；**本模块绝不自行计算 regime**）。
 *
 * 语义：环境标签属于「该笔交易发生的环境事实」，跟随 trade（journalId 跨修订稳定）。
 * 标签为不透明字符串（如 "trend=up" / "board=cyb" / "limitUpEnv=hot"），由调用方
 * （如 C-22.1 marketRegime 的标签或人工归纳）提供；本模块只做确定性挂接与聚合。
 * 无任何标签的 entry 归入显式缺省桶 ENV_UNLABELED（对齐 TJ 显式缺省码哲学，不编造）。
 */
export interface JournalEnvironmentAssignment {
  /** 挂接的日志逻辑身份（journalId，跨修订稳定）。 */
  readonly journalId: string;
  /** 该笔交易命中的环境标签清单（非空、去重、按字典序归一化）。 */
  readonly environmentKeys: readonly string[];
}

/** 无环境标签 entry 的显式缺省桶键（不猜测环境）。 */
export const DFA_ENV_UNLABELED_KEY = "ENV_UNLABELED" as const;

/** 严重度数值化（供平均 severity 计算；MINOR=1 MAJOR=2 CRITICAL=3）。 */
export const DFA_SEVERITY_INDEX: Readonly<Record<JournalRuleViolationSeverity, number>> = Object.freeze({
  MINOR: 1,
  MAJOR: 2,
  CRITICAL: 3,
});

// ---------------------------------------------------------------------------
// ① 违规原因统计（aggregateViolationCauses）
// ---------------------------------------------------------------------------

/** ① 配置（可选 filter 维度；全可缺省）。 */
export interface ViolationCauseConfig {
  /**
   * 可选过滤：只统计 machineDeviationDimensions 含该维度的违规声明。
   * null（缺省）= 全部已声明违规。用于「只看未成交类 / 只看价格突破类」等切面。
   */
  readonly filterDeviationDimension: JournalDeviationDimension | null;
}

/** ① 配置输入（可选）。 */
export interface ViolationCauseConfigInput {
  readonly filterDeviationDimension?: JournalDeviationDimension | null;
}

/** 单 reasonCode 聚合行（severity 列 + 显式未填计数；确定性排序）。 */
export interface ViolationReasonCountRow {
  readonly reasonCode: JournalReasonCode;
  /** 该 reasonCode 下的违规声明条数。 */
  readonly count: number;
  /** 占 scopeViolationCount 的比例（%）。 */
  readonly shareOfViolationsPct: number;
  /** 按严重度分布（MINOR/MAJOR/CRITICAL；未声明 severity 不进该分布）。 */
  readonly countBySeverity: Readonly<Record<JournalRuleViolationSeverity, number>>;
  /** 该 reasonCode 下违规声明但 severity 为 null 的条数（不猜严重度）。 */
  readonly severityUnassignedCount: number;
}

/** ① 违规原因统计报告。 */
export interface ViolationCauseReport {
  readonly config: ViolationCauseConfig;
  /** 纳入统计的违规声明条数（= 全部已声明违规，或过滤维度后的子集）。 */
  readonly scopeViolationCount: number;
  /** 已声明违规但 reasonCode=null 的条数（显式 counted-unannotated，不猜原因）。 */
  readonly reasonUnassignedCount: number;
  /** 已声明违规但 ruleViolation.severity=null 的条数（不猜严重度）。 */
  readonly severityUnassignedCount: number;
  /** reasonCode 聚合行（count 降序，平局 reasonCode 升序；确定性）。 */
  readonly rows: readonly ViolationReasonCountRow[];
  /** 口径附注（人类可读）。 */
  readonly note: string;
}

// ---------------------------------------------------------------------------
// ② 重复错误识别（detectRepeatMistakes）
// ---------------------------------------------------------------------------

/** ② 重复事件范围：只统计规则违反声明 / 全部人工归因。 */
export type RepeatMistakeScope = "ruleViolations" | "allAttributed";

/** ② 分组维度：同一 reasonCode / +securityId / +信号来源(策略引用)。 */
export type RepeatMistakeGroupBy =
  | "reasonCode"
  | "reasonCodeAndSecurityId"
  | "reasonCodeAndSignalSource";

/** ② 配置。 */
export interface RepeatMistakeConfig {
  /** 重复判定阈值（总出现次数 >= 该值记为 repeat pattern）。缺省 2。 */
  readonly minRepeatThreshold: number;
  /** 重复事件范围。缺省 ruleViolations。 */
  readonly scope: RepeatMistakeScope;
  /** 分组维度。缺省 reasonCode。 */
  readonly groupBy: RepeatMistakeGroupBy;
  /**
   * 可选滑动窗口（自然日长度，>0 整数）。null = 不启用窗口信息。
   * 启用时报告每个 pattern 的「窗口内最大密度」（窗口内最高同时出现次数），
   * 作为描述性强度指标，不改变 pattern 入选门槛（门槛 = minRepeatThreshold）。
   */
  readonly windowSizeDays: number | null;
}

/** ② 配置输入（可选）。 */
export interface RepeatMistakeConfigInput {
  readonly minRepeatThreshold?: number;
  readonly scope?: RepeatMistakeScope;
  readonly groupBy?: RepeatMistakeGroupBy;
  readonly windowSizeDays?: number | null;
}

/** ② 单次重复错误出现（一次违规/归因事件）。 */
export interface RepeatOccurrence {
  readonly journalId: string;
  readonly entryId: string;
  /** 事件日期 = 决策日（YYYY-MM-DD；纪律失败发生的时点）。 */
  readonly decisionDate: string;
  readonly reasonCode: JournalReasonCode;
  readonly securityId: string;
  /** 策略引用键（strategyId@strategyVersion）。 */
  readonly strategyKey: string;
}

/** ② 单组 repeat pattern 摘要。 */
export interface RepeatPatternSummary {
  /** 稳定分组键（reasonCode 或复合）。 */
  readonly groupKey: string;
  readonly reasonCode: JournalReasonCode;
  /** groupBy=reasonCodeAndSecurityId 时携带；否则 null。 */
  readonly securityId: string | null;
  /** groupBy=reasonCodeAndSignalSource 时携带；否则 null。 */
  readonly strategyKey: string | null;
  readonly occurrenceCount: number;
  readonly firstOccurrenceDate: string;
  readonly lastOccurrenceDate: string;
  /** 相邻出现间隔（自然日，length = occurrenceCount-1）。 */
  readonly intervalDays: readonly number[];
  /** 逐次出现（按 decisionDate 升序；同日平局按 journalId 升序）。 */
  readonly occurrences: readonly RepeatOccurrence[];
  /** 窗口内最大密度（config.windowSizeDays=null 时为 null）。 */
  readonly peakWindow: RepeatWindowPeak | null;
}

/** ② 窗口内最大密度（描述性；含实现该密度的最窄窗区间）。 */
export interface RepeatWindowPeak {
  readonly windowSizeDays: number;
  readonly maxOccurrenceCount: number;
  /** 达到 max 的窗首日（首个达到该值的窗口起点）。 */
  readonly windowStartDate: string;
  /** 窗末日（= start + windowSizeDays - 1，自然日）。 */
  readonly windowEndDate: string;
}

/** ② 重复错误识别报告。 */
export interface RepeatMistakeReport {
  readonly config: RepeatMistakeConfig;
  /** 进入候选的错误事件数（范围过滤后、且携带 reasonCode 的已标注 entry）。 */
  readonly candidateEventCount: number;
  /** 候选中无 reasonCode 被排除的事件数（显式计数，不猜原因）。 */
  readonly excludedNoReasonCodeCount: number;
  /** repeat patterns（occurrenceCount 降序，平局按 firstOccurrenceDate 升序，再按 groupKey）。 */
  readonly patterns: readonly RepeatPatternSummary[];
  /** 描述性声明：本报告只报告重复现象，不下「形成习惯」结论。 */
  readonly note: string;
}

// ---------------------------------------------------------------------------
// ③ 最差执行策略排序（rankExecutionQuality）
// ---------------------------------------------------------------------------

/** ③ 排序主指标。 */
export type ExecutionQualityRankMetric =
  | "meanAbsPriceDeviationPct" // 平均绝对价格偏差率（|实际 − 参考| / 参考）
  | "nonFullFillRatePct"       // 未成交 + 部分成交占比
  | "timingLateRatePct";        // 窗口外成交占比（executedInPlannedWindow=false）

/** ③ 配置。 */
export interface ExecutionQualityConfig {
  /** 排序主指标。缺省 meanAbsPriceDeviationPct。 */
  readonly rankBy: ExecutionQualityRankMetric;
  /** 样本数门槛（entry 级）；不足该门槛的策略维度不参与排序。缺省 3。 */
  readonly minSamples: number;
}

/** ③ 配置输入。 */
export interface ExecutionQualityConfigInput {
  readonly rankBy?: ExecutionQualityRankMetric;
  readonly minSamples?: number;
}

/** ③ 单策略执行偏差聚合行。 */
export interface ExecutionQualityGroup {
  /** 策略引用键（runRef.strategyId@runRef.strategyVersion）。 */
  readonly strategyKey: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly entryCount: number;
  readonly fullFillCount: number;
  readonly partialFillCount: number;
  readonly unfilledCount: number;
  /** 未成交率（% = unfilledCount/entryCount）。 */
  readonly unfilledRatePct: number;
  /** 部分成交率（% = partialFillCount/entryCount）。 */
  readonly partialFillRatePct: number;
  /** 未成交+部分成交占比（%）。 */
  readonly nonFullFillRatePct: number;
  /** 参与价格偏差统计的样本数（有成交且 planned 参考价齐备）。 */
  readonly priceDeviationSampleCount: number;
  /** 平均绝对价格偏差率（%）。样本不足时为 null。 */
  readonly meanAbsPriceDeviationPct: number | null;
  /** 平均带符号价格偏差率（%：实际 − 参考；机械符号，方向口径见附注）。 */
  readonly meanSignedPriceDeviationPct: number | null;
  /** 参与时机统计的样本数（executedInPlannedWindow 可判定）。 */
  readonly timingSampleCount: number;
  /** 窗口外成交率（% = 晚于计划窗口成交 / 时机可判定样本）。 */
  readonly timingLateRatePct: number | null;
  /** 无任何机器偏差维度的 entry 数（完全按计划成交）。 */
  readonly deviationFreeCount: number;
  /** 排序状态：RANKED / INSUFFICIENT_SAMPLES（样本不足不强行排名）。 */
  readonly status: "RANKED" | "INSUFFICIENT_SAMPLES";
  /** 在 RANKED 行中的排序位（1-based；INSUFFICIENT_SAMPLES 为 null）。 */
  readonly rank: number | null;
  /** 主指标值（rankBy 对应的聚合值；供排序复核）。 */
  readonly primaryMetricValue: number | null;
}

/** ③ 最差执行策略排序报告。 */
export interface ExecutionQualityReport {
  readonly config: ExecutionQualityConfig;
  /** 全部行：RANKED 在前（主指标降序，平局 strategyKey 升序），INSUFFICIENT_SAMPLES 在后。 */
  readonly rows: readonly ExecutionQualityGroup[];
  /** 参与排序的行数（RANKED）。 */
  readonly rankedCount: number;
  /** 样本不足未参与排序的行数。 */
  readonly insufficientSampleCount: number;
  /** 口径附注。 */
  readonly note: string;
}

// ---------------------------------------------------------------------------
// ④ 易错环境识别（identifyErrorProneEnvironments）
// ---------------------------------------------------------------------------

/** ④ 配置。 */
export interface EnvironmentAnalysisConfig {
  /** 单环境桶样本数门槛；低于该值标记 INSUFFICIENT_SAMPLES（仍展示不隐藏）。缺省 3。 */
  readonly minSamples: number;
}

/** ④ 配置输入。 */
export interface EnvironmentAnalysisConfigInput {
  readonly minSamples?: number;
}

/** ④ 单环境标签桶（每 entry 可命中多个环境标签 → 计入其命中的每个桶）。 */
export interface EnvironmentViolationDensityRow {
  readonly environmentKey: string;
  /** 落入该环境标签的交易数（entry 级）。 */
  readonly taggedEntryCount: number;
  /** 其中声明规则违反的笔数。 */
  readonly violationCount: number;
  /** 违规密度（% = violationCount / taggedEntryCount）。 */
  readonly violationDensityPct: number;
  /** 违规声明平均 severity（MINOR=1..CRITICAL=3；无违规或全未声明 → null）。 */
  readonly meanSeverity: number | null;
  /** 违规 severity 分布（未声明 severity 不计入；全 0 桶恒定出现）。 */
  readonly severityDistribution: Readonly<Record<JournalRuleViolationSeverity, number>>;
  /** 违规但 severity 未声明的笔数。 */
  readonly severityUnassignedCount: number;
  /** 样本不足标记（taggedEntryCount < minSamples；仍展示不隐藏）。 */
  readonly insufficientSamples: boolean;
}

/** ④ 易错环境识别报告。 */
export interface ErrorProneEnvironmentReport {
  readonly config: EnvironmentAnalysisConfig;
  /** 成功挂接环境标签的 assignment 数（journalId 去重）。 */
  readonly matchedAssignmentCount: number;
  /** 有标签 entry 数。 */
  readonly labeledEntryCount: number;
  /** 无标签 entry 数（归入 ENV_UNLABELED，不编造环境）。 */
  readonly unlabeledEntryCount: number;
  /** 行按违规密度降序，平局按 environmentKey 升序（ENV_UNLABELED 作为普通桶参与）。 */
  readonly rows: readonly EnvironmentViolationDensityRow[];
  /** 口径附注。 */
  readonly note: string;
}

// ---------------------------------------------------------------------------
// 机器可读模式清单 + 描述性结论
// ---------------------------------------------------------------------------

/** 候选模式种类（全部描述性，供人审；非结论）。 */
export type DisciplineFeedbackPatternKind =
  | "repeatMistake"          // 同因重复错误序列
  | "errorProneEnvironment"  // 违规密度高的环境桶
  | "worstExecutionCandidate"; // 排序最差执行策略候选（按主指标）

/** 机器可读候选模式（不下「必须改什么」结论，只给候选供 C-25.1 与人工消费）。 */
export interface DisciplineFeedbackPattern {
  readonly kind: DisciplineFeedbackPatternKind;
  /** 稳定机器键（如 repeatMistake|IMPULSIVE）。 */
  readonly key: string;
  /** 人类可读标签。 */
  readonly label: string;
  /** 证据量（出现次数 / 违规笔数 / 样本数）。 */
  readonly evidenceCount: number;
  /** 描述性限定说明。 */
  readonly qualifier: string;
}

/** 描述性汇总（供快速浏览）。 */
export interface DisciplineFeedbackSummary {
  readonly analyzedEntryCount: number;
  readonly unannotatedEntryCount: number;
  readonly annotationCount: number;
  readonly violationDeclaredCount: number;
  readonly noViolationDeclaredCount: number;
  /** 覆盖区间（decisionDate 最小/最大；空集 → null）。 */
  readonly coverageStartDate: string | null;
  readonly coverageEndDate: string | null;
}

// ---------------------------------------------------------------------------
// DisciplineFeedbackRun（一次纪律反馈分析的完整不可变记录）
// ---------------------------------------------------------------------------

/**
 * 一次纪律反馈分析的完整记录（不可变、可 JSON 序列化、带指纹）。
 * 只消费已落账事实；不产生交易/纪律建议。
 */
export interface DisciplineFeedbackRun {
  readonly recordKind: typeof DISCIPLINE_FEEDBACK_RUN_KIND;
  readonly recordVersion: typeof DISCIPLINE_FEEDBACK_RUN_RECORD_VERSION;

  /** 分析运行 ID（调用方注入）。 */
  readonly runId: string;
  /** 记录创建时间（ISO-8601 UTC；调用方注入，非复现输入）。 */
  readonly createdAt: string;

  /** 输入账本指纹：resolved 分析集合（latest-per-journal）内容 canonical 摘要。 */
  readonly inputLedgerFingerprint: string;
  /** 输入中被归并的原始 entry 数（含历史修订；> analyzedEntryCount 即存在修订链）。 */
  readonly rawEntryCount: number;

  readonly summary: DisciplineFeedbackSummary;

  // 四类聚合结果
  readonly violationCauses: ViolationCauseReport;
  readonly repeatMistakes: RepeatMistakeReport;
  readonly executionQuality: ExecutionQualityReport;
  readonly errorProneEnvironments: ErrorProneEnvironmentReport;

  /** 环境挂接（按 journalId 排序；纳入记录保证可复核可复现）。 */
  readonly environmentAssignments: readonly JournalEnvironmentAssignment[];

  /** 机器可读候选模式清单（描述性，供 C-25.1 / 人工消费）。 */
  readonly patterns: readonly DisciplineFeedbackPattern[];
  /** 结论摘要（stable/patternsFound/inconclusive + reasonCode）。 */
  readonly conclusion: DisciplineFeedbackConclusion;

  /** 内容指纹（sha256 hex）：除本字段外全部字段 canonical 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 构建入口（buildDisciplineFeedbackRun）
// ---------------------------------------------------------------------------

/** 各子分析的可选配置（全可缺省 → 默认）。 */
export interface DisciplineFeedbackAnalysisOptions {
  readonly violationCauses?: ViolationCauseConfigInput;
  readonly repeatMistakes?: RepeatMistakeConfigInput;
  readonly executionQuality?: ExecutionQualityConfigInput;
  readonly errorProneEnvironments?: EnvironmentAnalysisConfigInput;
}

/** buildDisciplineFeedbackRun 入参。 */
export interface BuildDisciplineFeedbackRunInput {
  readonly runId: string;
  /** 记录创建时间（ISO-8601 UTC；注入式）。 */
  readonly createdAt: string;
  /** 账本条目（可含全部修订版本；内部归并为 latest-per-journal 再聚合）。 */
  readonly entries: readonly TradeJournalEntry[];
  /** 环境标签挂接（journalId → environmentKeys；可选）。 */
  readonly environmentAssignments?: readonly JournalEnvironmentAssignment[];
  /** 各子分析配置（可选）。 */
  readonly options?: DisciplineFeedbackAnalysisOptions;
}
