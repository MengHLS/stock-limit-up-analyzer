/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录：结构 + 语义校验（纯函数，返回结构化 issue）。
 *
 * 对齐既有范式（lifecycle/validate.ts 等）：校验纯函数返回 { valid, issues }，
 * assert* 入口在非法时抛 TradeJournalError（稳定 code）；issue 结构复用
 * experimentValidation 的 ResearchValidationIssue 单一形态。
 *
 * 覆盖：
 *   - TradeJournalEntry：身份/版本/时间序（PIT：决策日 ≤ 执行日 ≤ 成交时点 ≤
 *     标注/入账时点）/ planned·actual·deviation 三节自洽 / 受控词表 / 交叉一致性；
 *   - PostReviewRecord：身份/作用域/评级值域/词表/引用形状。
 *
 * 时间序口径：
 *   - decisionDate（YYYY-MM-DD）、expectedExecutionDate（YYYY-MM-DD）：执行窗口 ≥ 决策日；
 *   - actual.fillTimestamp（YYYY-MM-DD）：≥ decisionDate（actual 早于 planned = 拒绝）；
 *   - createdAt / annotatedAt（ISO-8601 UTC）：date 部分 ≥ decisionDate 且 ≥ 成交时点——
 *     事后补录 / 事后标注不会伪装成当时决策（PIT 信息边界）。
 */

import type { ResearchValidationIssue, ResearchValidationResult } from "../experimentValidation";
import type {
  JournalActualFacts,
  JournalAnnotationBlock,
  JournalDeviation,
  JournalPlannedFacts,
  PostReviewRecord,
  TJUnassessedReasonCode,
  TradeJournalEntry,
} from "./types";
import {
  isJournalDeviationDimension,
  isJournalEmotionCode,
  isJournalReasonCode,
  isJournalReviewRatingValue,
  isTJUnassessedReasonCode,
  JOURNAL_DEVIATION_DIMENSIONS,
  JOURNAL_DEVIATION_DIMENSION_ORDER,
  JOURNAL_FILL_STATES,
  JOURNAL_RULE_VIOLATION_SEVERITIES,
  POST_REVIEW_RECORD_KIND,
  POST_REVIEW_RECORD_VERSION,
  TRADE_JOURNAL_ENTRY_KIND,
  TRADE_JOURNAL_ENTRY_RECORD_VERSION,
} from "./types";
import { TJ_ERROR_CODES, TradeJournalError } from "./errors";

// ---------------------------------------------------------------------------
// 基础断言
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, issues: ResearchValidationIssue[], path: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    issues.push(issue("TJ_STRUCT_NOT_OBJECT", path, `${path} 必须是对象`));
    return null;
  }
  return value;
}

function checkIsoDate(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    issues.push(issue("TJ_DATE_INVALID", path, `${path}（${String(value)}）必须是 YYYY-MM-DD`));
  }
}

function checkIsoDateTime(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || !ISO_DATETIME_RE.test(value)) {
    issues.push(
      issue("TJ_DATETIME_INVALID", path, `${path}（${String(value)}）必须是 ISO-8601 UTC（YYYY-MM-DDTHH:mm:ssZ）`)
    );
  }
}

function checkNonEmptyString(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue("TJ_REQUIRED", path, `${path} 必须是非空字符串`));
  }
}

function checkFiniteNumber(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue("TJ_NUMBER_INVALID", path, `${path}（${String(value)}）必须是有限数字`));
  }
}

/** ISO datetime 的 date 部分。 */
function datePartOf(iso: string): string {
  return iso.slice(0, 10);
}

/** 时间序检查：a 不得晚于 b（字符串比较）；违反 → issue。 */
function checkNotAfter(a: string, b: string, path: string, issues: ResearchValidationIssue[]): void {
  if (a > b) {
    issues.push(issue("TJ_PIT_ORDER_VIOLATION", path, `${path}：${a} 不得晚于 ${b}`));
  }
}

// ---------------------------------------------------------------------------
// 受控词表
// ---------------------------------------------------------------------------

function checkTJUnassessed(
  value: unknown,
  path: string,
  issues: ResearchValidationIssue[],
  required: boolean
): void {
  if (value === null || value === undefined) {
    if (required) issues.push(issue("TJ_UNASSESSED_MISSING", path, `${path} 显式缺省码缺失`));
    return;
  }
  if (typeof value !== "string" || !isTJUnassessedReasonCode(value)) {
    issues.push(issue("TJ_UNASSESSED_CODE_INVALID", path, `${path}（${String(value)}）不是合法 unassessed 原因码`));
  }
}

// ---------------------------------------------------------------------------
// 各节校验
// ---------------------------------------------------------------------------

function validateActualFacts(
  actual: unknown,
  issues: ResearchValidationIssue[],
  path = "actual"
): void {
  const record = requireRecord(actual, issues, path);
  if (record === null) return;
  checkFiniteNumber(record.quantity, `${path}.quantity`, issues);
  checkFiniteNumber(record.price, `${path}.price`, issues);
  if (typeof record.quantity === "number" && record.quantity <= 0) {
    issues.push(issue("TJ_QUANTITY_NONPOSITIVE", `${path}.quantity`, "actual 成交股数必须为正"));
  }
  if (typeof record.price === "number" && record.price <= 0) {
    issues.push(issue("TJ_PRICE_NONPOSITIVE", `${path}.price`, "actual 成交价必须为正"));
  }
  checkIsoDate(record.fillTimestamp, `${path}.fillTimestamp`, issues);
  if (record.basePrice !== null && record.basePrice !== undefined) {
    checkFiniteNumber(record.basePrice, `${path}.basePrice`, issues);
  }
  const fillRefs = record.fillRefs;
  if (!Array.isArray(fillRefs) || fillRefs.length === 0) {
    issues.push(issue("TJ_FILL_REFS_REQUIRED", `${path}.fillRefs`, "actual.fillRefs 必须是非空数组"));
  } else {
    fillRefs.forEach((ref, index) => {
      const refRecord = requireRecord(ref, issues, `${path}.fillRefs[${index}]`);
      if (refRecord === null) return;
      checkNonEmptyString(refRecord.fillId, `${path}.fillRefs[${index}].fillId`, issues);
      checkFiniteNumber(refRecord.quantity, `${path}.fillRefs[${index}].quantity`, issues);
      checkFiniteNumber(refRecord.price, `${path}.fillRefs[${index}].price`, issues);
      checkIsoDate(refRecord.timestamp, `${path}.fillRefs[${index}].timestamp`, issues);
    });
  }
}

function validateDeviation(
  deviation: unknown,
  decisionDate: string | null,
  issues: ResearchValidationIssue[],
  path = "deviation"
): void {
  const record = requireRecord(deviation, issues, path);
  if (record === null) return;
  if (typeof record.fillState !== "string" || !JOURNAL_FILL_STATES.includes(record.fillState as never)) {
    issues.push(issue("TJ_FILL_STATE_INVALID", `${path}.fillState`, `fillState（${String(record.fillState)}）非法`));
  }
  const fillState = record.fillState as JournalDeviation["fillState"] | undefined;
  const hasActual = record.actualQuantity !== null && record.actualQuantity !== undefined;
  if (fillState === "NONE" && hasActual) {
    issues.push(issue("TJ_DEVIATION_NONE_WITH_ACTUAL", `${path}.actualQuantity`, "fillState=NONE 时 actualQuantity 必须为 null"));
  }
  if (fillState !== "NONE" && !hasActual) {
    issues.push(issue("TJ_DEVIATION_REQUIRES_ACTUAL", `${path}.actualQuantity`, "fillState≠NONE 时 actualQuantity 不得为 null"));
  }
  if (record.actualQuantity !== null && record.actualQuantity !== undefined) {
    checkFiniteNumber(record.actualQuantity, `${path}.actualQuantity`, issues);
  }
  if (record.quantityDeviation !== null && record.quantityDeviation !== undefined) {
    checkFiniteNumber(record.quantityDeviation, `${path}.quantityDeviation`, issues);
  }
  if (record.actualFillTimestamp !== null && record.actualFillTimestamp !== undefined) {
    checkIsoDate(record.actualFillTimestamp, `${path}.actualFillTimestamp`, issues);
  }
  if (record.priceDeviation !== null && record.priceDeviation !== undefined) {
    checkFiniteNumber(record.priceDeviation, `${path}.priceDeviation`, issues);
  }
  if (record.unfilledReasonCode !== null && record.unfilledReasonCode !== undefined) {
    if (typeof record.unfilledReasonCode !== "string" || record.unfilledReasonCode.trim() === "") {
      issues.push(issue("TJ_REQUIRED", `${path}.unfilledReasonCode`, "unfilledReasonCode 必须是非空字符串"));
    }
  }
  if (record.executionOffsetTradingDays !== null && record.executionOffsetTradingDays !== undefined) {
    checkFiniteNumber(record.executionOffsetTradingDays, `${path}.executionOffsetTradingDays`, issues);
  }
  // 维度词表 + 无重复
  const dims = record.machineDeviationDimensions;
  if (dims !== undefined && !Array.isArray(dims)) {
    issues.push(issue("TJ_DIMS_NOT_ARRAY", `${path}.machineDeviationDimensions`, "machineDeviationDimensions 必须是数组"));
  } else if (Array.isArray(dims)) {
    const seen = new Set<string>();
    dims.forEach((dim, index) => {
      if (typeof dim !== "string" || !isJournalDeviationDimension(dim)) {
        issues.push(issue("TJ_DIM_INVALID", `${path}.machineDeviationDimensions[${index}]`, `维度（${String(dim)}）非法`));
      } else {
        if (seen.has(dim)) {
          issues.push(issue("TJ_DIM_DUPLICATE", `${path}.machineDeviationDimensions[${index}]`, `维度 ${dim} 重复`));
        }
        seen.add(dim);
      }
    });
    const inOrder = [...dims].every((dim, index) =>
      index === 0 || JOURNAL_DEVIATION_DIMENSION_ORDER.indexOf(dim) >= JOURNAL_DEVIATION_DIMENSION_ORDER.indexOf(dims[index - 1] as never)
    );
    if (!inOrder) {
      issues.push(issue("TJ_DIMS_NOT_SORTED", `${path}.machineDeviationDimensions`, "machineDeviationDimensions 必须按稳定顺序排列"));
    }
  }
  // 交叉：UNFILLED 维度 ⇔ fillState=NONE
  const dimSet = new Set(Array.isArray(dims) ? (dims as string[]) : []);
  if (fillState === "NONE" && !dimSet.has("UNFILLED")) {
    issues.push(issue("TJ_DIM_UNFILLED_MISSING", `${path}.machineDeviationDimensions`, "fillState=NONE 时必须含 UNFILLED 维度"));
  }
  if (fillState !== "NONE" && dimSet.has("UNFILLED")) {
    issues.push(issue("TJ_DIM_UNFILLED_CONTRADICT", `${path}.machineDeviationDimensions`, "fillState≠NONE 时不得含 UNFILLED 维度"));
  }
  if (fillState === "PARTIAL") {
    if (!dimSet.has("PARTIAL_FILL") || !dimSet.has("QUANTITY")) {
      issues.push(issue("TJ_DIM_PARTIAL_INCOMPLETE", `${path}.machineDeviationDimensions`, "fillState=PARTIAL 时必须含 PARTIAL_FILL 与 QUANTITY 维度"));
    }
  }
  if (fillState !== "PARTIAL" && dimSet.has("PARTIAL_FILL")) {
    issues.push(issue("TJ_DIM_PARTIAL_CONTRADICT", `${path}.machineDeviationDimensions`, "fillState≠PARTIAL 时不得含 PARTIAL_FILL 维度"));
  }
  // PIT：actual 时点不得早于决策日（decisionDate ≤ actualFillTimestamp）。
  if (decisionDate !== null && record.actualFillTimestamp !== null && record.actualFillTimestamp !== undefined) {
    checkNotAfter(decisionDate, record.actualFillTimestamp as string, `${path}.actualFillTimestamp`, issues);
  }
}

function validatePlannedFacts(
  planned: unknown,
  expectedExecutionDate: string | null,
  issues: ResearchValidationIssue[],
  path = "planned"
): void {
  const record = requireRecord(planned, issues, path);
  if (record === null) return;
  checkFiniteNumber(record.quantity, `${path}.quantity`, issues);
  if (typeof record.quantity === "number" && record.quantity <= 0) {
    issues.push(issue("TJ_QUANTITY_NONPOSITIVE", `${path}.quantity`, "planned 数量必须为正"));
  }
  if (record.executionWindowDays !== undefined) {
    checkFiniteNumber(record.executionWindowDays, `${path}.executionWindowDays`, issues);
    if (typeof record.executionWindowDays === "number" && (!Number.isInteger(record.executionWindowDays) || record.executionWindowDays < 1)) {
      issues.push(issue("TJ_WINDOW_INVALID", `${path}.executionWindowDays`, "executionWindowDays 必须是 ≥1 的整数"));
    }
  }
  if (record.referencePrice !== null && record.referencePrice !== undefined) {
    checkFiniteNumber(record.referencePrice, `${path}.referencePrice`, issues);
  }
  if (record.referencePriceUnassessedReasonCode !== null && record.referencePriceUnassessedReasonCode !== undefined) {
    checkTJUnassessed(record.referencePriceUnassessedReasonCode, `${path}.referencePriceUnassessedReasonCode`, issues, false);
  }
  const low = record.priceRangeLow;
  const high = record.priceRangeHigh;
  if (low !== null && low !== undefined) checkFiniteNumber(low, `${path}.priceRangeLow`, issues);
  if (high !== null && high !== undefined) checkFiniteNumber(high, `${path}.priceRangeHigh`, issues);
  if (typeof low === "number" && typeof high === "number" && low > high) {
    issues.push(issue("TJ_RANGE_INVERTED", `${path}.priceRangeLow`, "planned 价格带下界不得高于上界"));
  }
  if (record.priceRangeUnassessedReasonCode !== null && record.priceRangeUnassessedReasonCode !== undefined) {
    checkTJUnassessed(record.priceRangeUnassessedReasonCode, `${path}.priceRangeUnassessedReasonCode`, issues, false);
  }
}

// ---------------------------------------------------------------------------
// AnnotationBlock
// ---------------------------------------------------------------------------

function validateAnnotation(
  annotation: unknown,
  decisionDate: string | null,
  fillTimestamp: string | null,
  issues: ResearchValidationIssue[],
  path = "annotation"
): void {
  const record = requireRecord(annotation, issues, path);
  if (record === null) return;
  if (record.reasonCode !== null && record.reasonCode !== undefined) {
    if (typeof record.reasonCode !== "string" || !isJournalReasonCode(record.reasonCode)) {
      issues.push(issue("TJ_REASON_CODE_INVALID", `${path}.reasonCode`, `reasonCode（${String(record.reasonCode)}）不在受控词表`));
    } else if (record.reasonCode === "OTHER" && (typeof record.reasonNote !== "string" || record.reasonNote.trim() === "")) {
      issues.push(issue("TJ_REASON_NOTE_REQUIRED", `${path}.reasonNote`, "reasonCode=OTHER 时 reasonNote 必填"));
    }
  }
  if (record.emotionCode !== null && record.emotionCode !== undefined) {
    if (typeof record.emotionCode !== "string" || !isJournalEmotionCode(record.emotionCode)) {
      issues.push(issue("TJ_EMOTION_CODE_INVALID", `${path}.emotionCode`, `emotionCode（${String(record.emotionCode)}）不在受控词表`));
    } else if (record.emotionCode === "OTHER" && (typeof record.emotionNote !== "string" || record.emotionNote.trim() === "")) {
      issues.push(issue("TJ_EMOTION_NOTE_REQUIRED", `${path}.emotionNote`, "emotionCode=OTHER 时 emotionNote 必填"));
    }
  }
  if (record.reasonNote !== null && record.reasonNote !== undefined && typeof record.reasonNote !== "string") {
    issues.push(issue("TJ_STRING_INVALID", `${path}.reasonNote`, "reasonNote 必须是字符串"));
  }
  if (record.ruleViolation !== null && record.ruleViolation !== undefined) {
    const rv = requireRecord(record.ruleViolation, issues, `${path}.ruleViolation`);
    if (rv !== null) {
      if (typeof rv.declared !== "boolean") {
        issues.push(issue("TJ_RULE_VIOLATION_FLAG", `${path}.ruleViolation.declared`, "declared 必须是布尔（人工显式声明）"));
      }
      if (rv.severity !== null && rv.severity !== undefined &&
          (typeof rv.severity !== "string" || !JOURNAL_RULE_VIOLATION_SEVERITIES.includes(rv.severity as never))) {
        issues.push(issue("TJ_SEVERITY_INVALID", `${path}.ruleViolation.severity`, `severity（${String(rv.severity)}）非法`));
      }
    }
  }
  if (record.annotator !== null && record.annotator !== undefined && typeof record.annotator !== "string") {
    issues.push(issue("TJ_STRING_INVALID", `${path}.annotator`, "annotator 必须是字符串"));
  }
  checkIsoDateTime(record.annotatedAt, `${path}.annotatedAt`, issues);
  // PIT：事后标注不得早于决策 / 成交时点（decisionDate ≤ annotation 日，fill ≤ annotation 日）。
  if (decisionDate !== null && typeof record.annotatedAt === "string") {
    checkNotAfter(decisionDate, datePartOf(record.annotatedAt), `${path}.annotatedAt`, issues);
  }
  if (fillTimestamp !== null && typeof record.annotatedAt === "string") {
    checkNotAfter(fillTimestamp, datePartOf(record.annotatedAt), `${path}.annotatedAt`, issues);
  }
}

// ---------------------------------------------------------------------------
// 顶层：TradeJournalEntry
// ---------------------------------------------------------------------------

/**
 * 校验 TradeJournalEntry 结构 + 语义（纯函数）。返回 issue 清单；空 = 有效。
 * 指纹复核（防篡改）在 serialize.ts 做，本函数只做结构/时间序/自洽。
 */
export function validateTradeJournalEntry(entry: unknown): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  const record = requireRecord(entry, issues, "entry");
  if (record === null) return { valid: false, issues };

  if (record.recordKind !== TRADE_JOURNAL_ENTRY_KIND) {
    issues.push(issue("TJ_RECORD_KIND", "recordKind", `recordKind=${String(record.recordKind)} 不是 ${TRADE_JOURNAL_ENTRY_KIND}`));
  }
  if (record.recordVersion !== TRADE_JOURNAL_ENTRY_RECORD_VERSION) {
    issues.push(issue("TJ_RECORD_VERSION", "recordVersion", `recordVersion=${String(record.recordVersion)} 不是 ${TRADE_JOURNAL_ENTRY_RECORD_VERSION}`));
  }
  checkNonEmptyString(record.entryId, "entryId", issues);
  checkNonEmptyString(record.journalId, "journalId", issues);
  if (typeof record.entryVersion !== "number" || !Number.isInteger(record.entryVersion) || record.entryVersion < 1) {
    issues.push(issue("TJ_VERSION_INVALID", "entryVersion", "entryVersion 必须是 ≥1 的整数"));
  }
  if (record.entryVersion === 1 && record.supersedesEntryId !== null) {
    issues.push(issue("TJ_SUPERSEDES_ON_V1", "supersedesEntryId", "v1 条目的 supersedesEntryId 必须为 null"));
  }
  if (record.entryVersion !== 1 && (typeof record.supersedesEntryId !== "string" || record.supersedesEntryId === "")) {
    issues.push(issue("TJ_SUPERSEDES_REQUIRED", "supersedesEntryId", "非 v1 条目必须携带 supersedesEntryId"));
  }
  checkIsoDateTime(record.createdAt, "createdAt", issues);

  // 关联
  const runRef = requireRecord(record.runRef, issues, "runRef");
  if (runRef !== null) {
    if (runRef.kind !== "SIGNAL_TO_PNL_RUN") {
      issues.push(issue("TJ_RUN_REF_KIND", "runRef.kind", `runRef.kind=${String(runRef.kind)} 不是 SIGNAL_TO_PNL_RUN`));
    }
    checkNonEmptyString(runRef.runId, "runRef.runId", issues);
    checkNonEmptyString(runRef.accountId, "runRef.accountId", issues);
    checkNonEmptyString(runRef.datasetVersion, "runRef.datasetVersion", issues);
    checkNonEmptyString(runRef.strategyId, "runRef.strategyId", issues);
    checkNonEmptyString(runRef.strategyVersion, "runRef.strategyVersion", issues);
    checkNonEmptyString(runRef.sourceCandidateFingerprint, "runRef.sourceCandidateFingerprint", issues);
  }
  const orderRef = requireRecord(record.orderRef, issues, "orderRef");
  if (orderRef !== null) {
    checkNonEmptyString(orderRef.orderId, "orderRef.orderId", issues);
    checkNonEmptyString(orderRef.status, "orderRef.status", issues);
    if (orderRef.orderType !== "market" && orderRef.orderType !== "limit") {
      issues.push(issue("TJ_ORDER_TYPE", "orderRef.orderType", `orderType=${String(orderRef.orderType)} 非法`));
    }
    if (orderRef.requestedPrice !== null && orderRef.requestedPrice !== undefined) {
      checkFiniteNumber(orderRef.requestedPrice, "orderRef.requestedPrice", issues);
    }
  }

  // 交易身份
  checkNonEmptyString(record.securityId, "securityId", issues);
  if (record.side !== "buy" && record.side !== "sell") {
    issues.push(issue("TJ_SIDE_INVALID", "side", `side=${String(record.side)} 非法`));
  }
  const decisionDate = typeof record.decisionDate === "string" ? record.decisionDate : null;
  const expectedExecutionDate = typeof record.expectedExecutionDate === "string" ? record.expectedExecutionDate : null;
  checkIsoDate(record.decisionDate, "decisionDate", issues);
  checkIsoDate(record.expectedExecutionDate, "expectedExecutionDate", issues);
  if (decisionDate !== null && expectedExecutionDate !== null && decisionDate > expectedExecutionDate) {
    issues.push(issue("TJ_PIT_ORDER_VIOLATION", "expectedExecutionDate", `执行窗口 ${expectedExecutionDate} 早于决策日 ${decisionDate}`));
  }

  validatePlannedFacts(record.planned, expectedExecutionDate, issues, "planned");
  validateActualFacts(record.actual, issues, "actual");

  // actual vs deviation 交叉一致
  const deviationRecord = requireRecord(record.deviation, issues, "deviation");
  if (deviationRecord !== null) {
    validateDeviation(record.deviation, decisionDate, issues, "deviation");
    const actualRecord = isRecord(record.actual) ? record.actual : null;
    const fillState = deviationRecord.fillState;
    if (actualRecord === null && fillState !== "NONE") {
      issues.push(issue("TJ_ACTUAL_MISSING", "actual", "deviation.fillState≠NONE 时 actual 不得为 null"));
    }
    if (actualRecord !== null) {
      if (fillState === "NONE") {
        issues.push(issue("TJ_ACTUAL_CONTRADICT", "actual", "deviation.fillState=NONE 时 actual 必须为 null"));
      }
      // actual 成交股数与 deviation.actualQuantity 一致
      const actualQty = typeof actualRecord.quantity === "number" ? actualRecord.quantity : null;
      const devQty = typeof deviationRecord.actualQuantity === "number" ? deviationRecord.actualQuantity : null;
      if (actualQty !== null && devQty !== null && Math.abs(actualQty - devQty) > 1e-9) {
        issues.push(issue("TJ_ACTUAL_DEVIATION_QTY_MISMATCH", "actual.quantity", `actual.quantity=${actualQty} 与 deviation.actualQuantity=${devQty} 不一致`));
      }
      // actual 成交价与 deviation.actualFillPrice 一致
      const actualPrice = typeof actualRecord.price === "number" ? actualRecord.price : null;
      const devPrice = typeof deviationRecord.actualFillPrice === "number" ? deviationRecord.actualFillPrice : null;
      if (actualPrice !== null && devPrice !== null && Math.abs(actualPrice - devPrice) > 1e-6) {
        issues.push(issue("TJ_ACTUAL_DEVIATION_PRICE_MISMATCH", "actual.price", `actual.price=${actualPrice} 与 deviation.actualFillPrice=${devPrice} 不一致`));
      }
      // PIT：成交时点 ≥ 决策日
      const fillTs = typeof actualRecord.fillTimestamp === "string" ? actualRecord.fillTimestamp : null;
      if (fillTs !== null && decisionDate !== null && fillTs < decisionDate) {
        issues.push(issue("TJ_PIT_ORDER_VIOLATION", "actual.fillTimestamp", `成交时点 ${fillTs} 早于决策日 ${decisionDate}（actual 早于 planned）`));
      }
      // 备注未成交码：有成交时不允许携带未成交审计码
      if (deviationRecord.unfilledReasonCode !== null && deviationRecord.unfilledReasonCode !== undefined) {
        issues.push(issue("TJ_UNFILLED_CODE_WITH_FILL", "deviation.unfilledReasonCode", "有成交时不得携带 unfilledReasonCode"));
      }
    } else if (deviationRecord.unfilledReasonCode === null || deviationRecord.unfilledReasonCode === undefined) {
      issues.push(issue("TJ_UNFILLED_CODE_REQUIRED", "deviation.unfilledReasonCode", "fillState=NONE 时应携带 unfilledReasonCode（引用 C-23.2 审计 reasonCode）或显式说明"));
    }
  }

  // PIT：入账时点（createdAt）不得早于决策日 / 成交时点
  if (typeof record.createdAt === "string") {
    if (decisionDate !== null) checkNotAfter(decisionDate, datePartOf(record.createdAt), "createdAt", issues);
    const actualRecord = isRecord(record.actual) ? record.actual : null;
    if (actualRecord !== null && typeof actualRecord.fillTimestamp === "string") {
      checkNotAfter(actualRecord.fillTimestamp as string, datePartOf(record.createdAt), "createdAt", issues);
    }
  }

  // Annotation：时间序（标注不早于决策/成交）
  if (record.annotation !== null && record.annotation !== undefined) {
    const actualRecord = isRecord(record.actual) ? record.actual : null;
    const fillTs = actualRecord !== null && typeof actualRecord.fillTimestamp === "string"
      ? (actualRecord.fillTimestamp as string)
      : null;
    validateAnnotation(record.annotation, decisionDate, fillTs, issues, "annotation");
  }

  return { valid: issues.length === 0, issues };
}

/** assert 版本：非法即抛 TradeJournalError（稳定 code）。 */
export function assertValidTradeJournalEntry(entry: unknown): asserts entry is TradeJournalEntry {
  const result = validateTradeJournalEntry(entry);
  if (!result.valid) {
    const lines = result.issues.map((i) => `  [${i.code}] ${i.path}: ${i.message}`).join("\n");
    throw new TradeJournalError(TJ_ERROR_CODES.ENTRY_INVALID, `日志条目校验失败：\n${lines}`);
  }
}

// ---------------------------------------------------------------------------
// PostReviewRecord
// ---------------------------------------------------------------------------

/** 校验 PostReviewRecord（纯函数）。 */
export function validatePostReviewRecord(review: unknown): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  const record = requireRecord(review, issues, "review");
  if (record === null) return { valid: false, issues };

  if (record.recordKind !== POST_REVIEW_RECORD_KIND) {
    issues.push(issue("TJ_RECORD_KIND", "recordKind", `recordKind=${String(record.recordKind)} 不是 ${POST_REVIEW_RECORD_KIND}`));
  }
  if (record.recordVersion !== POST_REVIEW_RECORD_VERSION) {
    issues.push(issue("TJ_RECORD_VERSION", "recordVersion", `recordVersion=${String(record.recordVersion)} 不是 ${POST_REVIEW_RECORD_VERSION}`));
  }
  checkNonEmptyString(record.reviewId, "reviewId", issues);
  checkIsoDateTime(record.createdAt, "createdAt", issues);
  if (record.reviewerId !== null && record.reviewerId !== undefined && typeof record.reviewerId !== "string") {
    issues.push(issue("TJ_STRING_INVALID", "reviewerId", "reviewerId 必须是字符串"));
  }

  const scope = requireRecord(record.scope, issues, "scope");
  if (scope !== null) {
    if (scope.scopeType !== "SINGLE_ENTRY" && scope.scopeType !== "ENTRY_BATCH") {
      issues.push(issue("TJ_SCOPE_TYPE", "scope.scopeType", `scopeType=${String(scope.scopeType)} 非法`));
    }
    const journalIds = scope.journalIds;
    if (!Array.isArray(journalIds) || journalIds.length === 0) {
      issues.push(issue("TJ_SCOPE_EMPTY", "scope.journalIds", "scope.journalIds 必须是非空数组"));
    } else {
      journalIds.forEach((id, index) => {
        if (typeof id !== "string" || id.trim() === "") {
          issues.push(issue("TJ_REQUIRED", `scope.journalIds[${index}]`, "journalId 必须是非空字符串"));
        }
      });
      if (scope.scopeType === "SINGLE_ENTRY" && journalIds.length !== 1) {
        issues.push(issue("TJ_SINGLE_SCOPE_COUNT", "scope.journalIds", "SINGLE_ENTRY 作用域必须恰好 1 个 journalId"));
      }
      const sorted = [...(journalIds as string[])].sort((a, b) => a.localeCompare(b));
      if (JSON.stringify(sorted) !== JSON.stringify(journalIds)) {
        issues.push(issue("TJ_SCOPE_NOT_SORTED", "scope.journalIds", "scope.journalIds 必须去重升序"));
      }
      if (new Set(journalIds).size !== journalIds.length) {
        issues.push(issue("TJ_SCOPE_DUPLICATE", "scope.journalIds", "scope.journalIds 不得重复"));
      }
    }
  }

  const checkRating = (value: unknown, path: string): void => {
    if (value === null || value === undefined) return;
    if (typeof value !== "number" || !isJournalReviewRatingValue(value)) {
      issues.push(issue("TJ_RATING_INVALID", path, `${path}（${String(value)}）必须是 1-5 整数或 null`));
    }
  };
  const checkRatingNote = (value: unknown, path: string): void => {
    if (value !== null && value !== undefined && typeof value !== "string") {
      issues.push(issue("TJ_STRING_INVALID", path, `${path} 必须是字符串`));
    }
  };
  for (const section of ["plannedQuality", "executionQuality", "ruleAdherence"] as const) {
    const ratingRecord = requireRecord(record[section], issues, section);
    if (ratingRecord !== null) {
      checkRating(ratingRecord.rating, `${section}.rating`);
      checkRatingNote(ratingRecord.note, `${section}.note`);
    }
  }
  const nextImprovements = record.nextImprovements;
  if (nextImprovements !== undefined && !Array.isArray(nextImprovements)) {
    issues.push(issue("TJ_ARRAY_INVALID", "nextImprovements", "nextImprovements 必须是数组"));
  } else if (Array.isArray(nextImprovements)) {
    nextImprovements.forEach((item, index) => {
      if (typeof item !== "string") {
        issues.push(issue("TJ_STRING_INVALID", `nextImprovements[${index}]`, "改进点必须是字符串"));
      }
    });
  }
  const metricsRefs = record.metricsReferences;
  if (metricsRefs !== undefined && !Array.isArray(metricsRefs)) {
    issues.push(issue("TJ_ARRAY_INVALID", "metricsReferences", "metricsReferences 必须是数组"));
  } else if (Array.isArray(metricsRefs)) {
    metricsRefs.forEach((ref, index) => {
      const refRecord = requireRecord(ref, issues, `metricsReferences[${index}]`);
      if (refRecord === null) return;
      if (refRecord.kind !== "TRADE_QUALITY_EVALUATION_RUN") {
        issues.push(issue("TJ_METRICS_REF_KIND", `metricsReferences[${index}].kind`, `引用 kind=${String(refRecord.kind)} 非法（当前仅支持 C-16.3 TRADE_QUALITY_EVALUATION_RUN）`));
      }
      checkNonEmptyString(refRecord.recordId, `metricsReferences[${index}].recordId`, issues);
      if (refRecord.recordFingerprint !== null && refRecord.recordFingerprint !== undefined &&
          typeof refRecord.recordFingerprint !== "string") {
        issues.push(issue("TJ_STRING_INVALID", `metricsReferences[${index}].recordFingerprint`, "recordFingerprint 必须是字符串"));
      }
    });
  }

  return { valid: issues.length === 0, issues };
}

/** assert 版本：非法即抛 TradeJournalError。 */
export function assertValidPostReviewRecord(review: unknown): asserts review is PostReviewRecord {
  const result = validatePostReviewRecord(review);
  if (!result.valid) {
    const lines = result.issues.map((i) => `  [${i.code}] ${i.path}: ${i.message}`).join("\n");
    throw new TradeJournalError(TJ_ERROR_CODES.REVIEW_INVALID, `复盘记录校验失败：\n${lines}`);
  }
}

// ---------------------------------------------------------------------------
// 便捷谓词（供 serialize / ledger 复用）
// ---------------------------------------------------------------------------

/** 判断 entry 是否为 draft（v1 且 annotation=null）。 */
export function isJournalDraftEntry(entry: TradeJournalEntry): boolean {
  return entry.entryVersion === 1 && entry.annotation === null;
}

/** 取 entry 的成交时点（无成交 → null），供 PIT 比较。 */
export function entryFillTimestampOf(entry: TradeJournalEntry): string | null {
  return entry.actual !== null ? entry.actual.fillTimestamp : null;
}

// 类型级自检引用（避免未使用告警）：确保各节类型与校验对齐。
const _typeRefs: {
  planned: JournalPlannedFacts;
  actual: JournalActualFacts | null;
  deviation: JournalDeviation;
  annotation: JournalAnnotationBlock | null;
  unassessed: TJUnassessedReasonCode;
} = null as never;
void _typeRefs;
void (JOURNAL_DEVIATION_DIMENSIONS);
void (JOURNAL_FILL_STATES);
