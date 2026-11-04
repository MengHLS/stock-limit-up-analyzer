/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录：PostReview 快照 + 人工标注修订（工厂，注入式）。
 *
 * 职责：
 *   - createPostReviewRecord：把人工复盘输入装配为不可变 PostReviewRecord（单笔/批量
 *     scope；planned 质量 / 执行质量 / 规则遵守 / 下次改进点全部注入式）+ 引用评价
 *     （可挂 C-16.3 TradeQualityEvaluationRun 引用，**不重算**、不内嵌指标数值）；
 *   - withJournalAnnotation：给既有日志条目生成「标注修订」（entryVersion+1 挂
 *     supersedes 链）——reason/emotion/ruleViolation 是人工注入，本模块零生成；
 *   - annotateJournalEntry：账本便捷入口（读取最新 → 修订 → append，链校验由账本承担）。
 *
 * 铁律：纯函数；无 IO / Date.now / Math.random；时间戳注入式；未做主观内容判定。
 * PIT：annotation 的 annotatedAt / 修订 createdAt 不得早于成交时点（validate 复核）。
 */

import type {
  JournalAnnotationBlock,
  JournalEmotionCode,
  JournalMetricsReference,
  JournalReasonCode,
  JournalReviewRating,
  JournalReviewRatingValue,
  JournalRuleViolationDeclaration,
  JournalRuleViolationSeverity,
  PostReviewRecord,
  TradeJournalEntry,
} from "./types";
import { POST_REVIEW_RECORD_KIND, POST_REVIEW_RECORD_VERSION } from "./types";
import { computePostReviewRecordFingerprint, computeTradeJournalEntryFingerprint } from "./serialize";
import { assertValidPostReviewRecord, assertValidTradeJournalEntry } from "./validate";
import { journalEntryIdOf } from "./drafts";
import type { TradeJournalLedger } from "./ledger";
import { TJ_ERROR_CODES, TradeJournalError } from "./errors";

// ---------------------------------------------------------------------------
// PostReviewRecord 工厂
// ---------------------------------------------------------------------------

/** PostReview 输入（rating 缺省 null = 未评；字段人工注入）。 */
export interface PostReviewInput {
  readonly reviewId: string;
  /** 复盘时点（注入式 ISO-8601 UTC）。 */
  readonly createdAt: string;
  /** 复盘者身份（注入式；可空）。 */
  readonly reviewerId?: string | null;
  /** 被复盘条目逻辑身份（journalId）清单（去重升序由本函数归一化）。 */
  readonly journalIds: readonly string[];
  /** planned 质量评级（1-5；缺省 null）。 */
  readonly plannedQualityRating?: JournalReviewRatingValue | null;
  readonly plannedQualityNote?: string | null;
  /** 执行质量评级（1-5；缺省 null）。 */
  readonly executionQualityRating?: JournalReviewRatingValue | null;
  readonly executionQualityNote?: string | null;
  /** 规则遵守评级（1-5；缺省 null）。 */
  readonly ruleAdherenceRating?: JournalReviewRatingValue | null;
  readonly ruleAdherenceNote?: string | null;
  /** 下次改进点（逐条自由文本）。 */
  readonly nextImprovements?: readonly string[];
  /** 引用评价（C-16.3 TradeQualityEvaluationRun 等；不重算）。 */
  readonly metricsReferences?: readonly JournalMetricsReference[];
}

function rating(
  ratingValue: JournalReviewRatingValue | null | undefined,
  note: string | null | undefined
): JournalReviewRating {
  return { rating: ratingValue ?? null, note: note ?? null };
}

/**
 * 装配一条不可变 PostReviewRecord（scope 归一化：journalIds 去重升序；
 * SINGLE_ENTRY = 1 个 journalId；ENTRY_BATCH = ≥1 个）。
 * 装配后立即自校验（FAIL FAST），再计算指纹返回。
 */
export function createPostReviewRecord(input: PostReviewInput): PostReviewRecord {
  const journalIds = Array.from(new Set(input.journalIds)).sort((a, b) => a.localeCompare(b));
  if (journalIds.length === 0) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.REVIEW_INVALID,
      "createPostReviewRecord：journalIds 必须至少 1 个（复盘对象缺失）"
    );
  }
  const body: Omit<PostReviewRecord, "fingerprint"> = {
    recordKind: POST_REVIEW_RECORD_KIND,
    recordVersion: POST_REVIEW_RECORD_VERSION,
    reviewId: input.reviewId,
    createdAt: input.createdAt,
    reviewerId: input.reviewerId ?? null,
    scope: {
      scopeType: journalIds.length === 1 ? "SINGLE_ENTRY" : "ENTRY_BATCH",
      journalIds,
    },
    plannedQuality: rating(input.plannedQualityRating, input.plannedQualityNote),
    executionQuality: rating(input.executionQualityRating, input.executionQualityNote),
    ruleAdherence: rating(input.ruleAdherenceRating, input.ruleAdherenceNote),
    nextImprovements: input.nextImprovements ? [...input.nextImprovements] : [],
    metricsReferences: input.metricsReferences ? [...input.metricsReferences] : [],
  };
  const fingerprint = computePostReviewRecordFingerprint(body);
  const record: PostReviewRecord = { ...body, fingerprint };
  assertValidPostReviewRecord(record);
  return record;
}

/** 构造 C-16.3 指标引用（不重算——只存 runId/指纹锚点）。 */
export function createTradeQualityMetricsReference(
  recordId: string,
  recordFingerprint?: string | null
): JournalMetricsReference {
  return {
    kind: "TRADE_QUALITY_EVALUATION_RUN",
    recordId,
    recordFingerprint: recordFingerprint ?? null,
  };
}

// ---------------------------------------------------------------------------
// 人工标注（AnnotationBlock）修订工厂
// ---------------------------------------------------------------------------

/** 人工标注输入（全部可选 + annotatedAt 必填；词表/时间序由 validate 复核）。 */
export interface JournalAnnotationInput {
  readonly reasonCode?: JournalReasonCode | null;
  readonly reasonNote?: string | null;
  readonly emotionCode?: JournalEmotionCode | null;
  readonly emotionNote?: string | null;
  readonly ruleViolation?: JournalRuleViolationDeclaration | null;
  readonly reviewNote?: string | null;
  readonly annotator?: string | null;
  /** 标注时点（注入式 ISO-8601 UTC；不得早于成交时点——事后标注不伪装成当时决策）。 */
  readonly annotatedAt: string;
}

/**
 * 生成人工标注修订（当前条目 → entryVersion+1，supersedesEntryId = 当前 entryId）。
 * 本函数只做装配；链/时间序校验由账本 appendEntry（或 assertValidTradeJournalEntry）承担。
 */
export function withJournalAnnotation(
  current: TradeJournalEntry,
  input: JournalAnnotationInput,
  options: { readonly createdAt: string }
): TradeJournalEntry {
  const annotation: JournalAnnotationBlock = {
    reasonCode: input.reasonCode ?? null,
    reasonNote: input.reasonNote ?? null,
    emotionCode: input.emotionCode ?? null,
    emotionNote: input.emotionNote ?? null,
    ruleViolation: input.ruleViolation ?? null,
    reviewNote: input.reviewNote ?? null,
    annotator: input.annotator ?? null,
    annotatedAt: input.annotatedAt,
  };
  const version = current.entryVersion + 1;
  const body: Omit<TradeJournalEntry, "fingerprint"> = {
    ...current,
    entryId: journalEntryIdOf(current.journalId, version),
    entryVersion: version,
    supersedesEntryId: current.entryId,
    createdAt: options.createdAt,
    annotation,
  };
  const fingerprint = computeTradeJournalEntryFingerprint(body);
  const record: TradeJournalEntry = { ...body, fingerprint };
  assertValidTradeJournalEntry(record);
  return record;
}

/**
 * 账本便捷入口：读取 journalId 最新条目 → 生成标注修订 → append（链校验由账本承担）。
 * 返回新落账的修订条目。
 */
export function annotateJournalEntry(
  ledger: TradeJournalLedger,
  journalId: string,
  input: JournalAnnotationInput,
  options: { readonly createdAt: string }
): TradeJournalEntry {
  const latest = ledger.getLatestEntry(journalId);
  const revision = withJournalAnnotation(latest, input, options);
  return ledger.appendEntry(revision);
}

// 类型级自检引用（避免未使用告警）
const _severityRef: JournalRuleViolationSeverity | null = null;
void _severityRef;
