/**
 * STEP 24 / C-24.2 — 纪律反馈分析：记录结构校验（纯函数，返回结构化 issue）。
 *
 * 校验 DisciplineFeedbackRun 结构与值域（受控词表/计数自洽/结论码），
 * 与 serialize.ts 配合完成「反序列化 → validate → 指纹复核」的篡改拒绝 round-trip。
 * assert* 入口在非法时抛 DisciplineFeedbackError（DFA_RUN_INVALID，稳定 code）。
 */

import type { ResearchValidationIssue, ResearchValidationResult } from "../experimentValidation";
import type {
  DisciplineFeedbackPatternKind,
  DisciplineFeedbackRun,
  DisciplineFeedbackVerdict,
} from "./types";
import {
  isDfaReasonCode,
  DISCIPLINE_FEEDBACK_RUN_KIND,
  DISCIPLINE_FEEDBACK_RUN_RECORD_VERSION,
} from "./types";
import {
  isJournalDeviationDimension,
  isJournalReasonCode,
  JOURNAL_RULE_VIOLATION_SEVERITIES,
} from "../tradeJournal/types";
import { DFA_ERROR_CODES, DisciplineFeedbackError } from "./errors";
import { calendarDatePlusDays } from "./common";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkNonEmptyString(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue("DFA_REQUIRED", path, `${path} 必须是非空字符串`));
  }
}

function checkDate(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (value !== null && value !== undefined && (typeof value !== "string" || !ISO_DATE_RE.test(value))) {
    issues.push(issue("DFA_DATE_INVALID", path, `${path}（${String(value)}）必须是 YYYY-MM-DD 或 null`));
  }
}

function checkDateTime(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "string" || !ISO_DATETIME_RE.test(value)) {
    issues.push(issue("DFA_DATETIME_INVALID", path, `${path}（${String(value)}）必须是 ISO-8601 UTC`));
  }
}

function checkNonNegativeInt(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    issues.push(issue("DFA_COUNT_INVALID", path, `${path}（${String(value)}）必须是非负整数`));
  }
}

function checkFinite(value: unknown, path: string, issues: ResearchValidationIssue[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue("DFA_NUMBER_INVALID", path, `${path}（${String(value)}）必须是有限数字`));
  }
}

// ---------------------------------------------------------------------------
// 各报告轻量校验
// ---------------------------------------------------------------------------

function validateViolationCauseReport(report: unknown, issues: ResearchValidationIssue[], path: string): void {
  const record = requireRecord(report, issues, path);
  if (record === null) return;
  const config = record.config;
  if (isRecord(config)) {
    if (config.filterDeviationDimension !== null && config.filterDeviationDimension !== undefined &&
        (typeof config.filterDeviationDimension !== "string" || !isJournalDeviationDimension(config.filterDeviationDimension))) {
      issues.push(issue("DFA_DIM_INVALID", `${path}.config.filterDeviationDimension`, "维度非法"));
    }
  }
  checkNonNegativeInt(record.scopeViolationCount, `${path}.scopeViolationCount`, issues);
  checkNonNegativeInt(record.reasonUnassignedCount, `${path}.reasonUnassignedCount`, issues);
  checkNonNegativeInt(record.severityUnassignedCount, `${path}.severityUnassignedCount`, issues);
  if (typeof record.note !== "string") issues.push(issue("DFA_STRING_INVALID", `${path}.note`, "note 必须是字符串"));
  if (!Array.isArray(record.rows)) {
    issues.push(issue("DFA_ARRAY_INVALID", `${path}.rows`, "rows 必须是数组"));
    return;
  }
  record.rows.forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    const r = requireRecord(row, issues, rowPath);
    if (r === null) return;
    if (typeof r.reasonCode !== "string" || !isJournalReasonCode(r.reasonCode)) {
      issues.push(issue("DFA_REASON_CODE_INVALID", `${rowPath}.reasonCode`, `reasonCode（${String(r.reasonCode)}）不在受控词表`));
    }
    checkNonNegativeInt(r.count, `${rowPath}.count`, issues);
    checkFinite(r.shareOfViolationsPct, `${rowPath}.shareOfViolationsPct`, issues);
    checkNonNegativeInt(r.severityUnassignedCount, `${rowPath}.severityUnassignedCount`, issues);
    const bySeverity = r.countBySeverity;
    if (isRecord(bySeverity)) {
      for (const severity of JOURNAL_RULE_VIOLATION_SEVERITIES) {
        checkNonNegativeInt(bySeverity[severity], `${rowPath}.countBySeverity.${severity}`, issues);
      }
    }
  });
}

function validateRepeatReport(report: unknown, issues: ResearchValidationIssue[], path: string): void {
  const record = requireRecord(report, issues, path);
  if (record === null) return;
  const config = record.config;
  if (isRecord(config)) {
    const threshold = config.minRepeatThreshold;
    if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1) {
      issues.push(issue("DFA_COUNT_INVALID", `${path}.config.minRepeatThreshold`, "必须 ≥1 整数"));
    }
    const scope = config.scope;
    if (scope !== "ruleViolations" && scope !== "allAttributed") {
      issues.push(issue("DFA_VALUE_INVALID", `${path}.config.scope`, `scope（${String(scope)}）非法`));
    }
    const groupBy = config.groupBy;
    if (groupBy !== "reasonCode" && groupBy !== "reasonCodeAndSecurityId" && groupBy !== "reasonCodeAndSignalSource") {
      issues.push(issue("DFA_VALUE_INVALID", `${path}.config.groupBy`, `groupBy（${String(groupBy)}）非法`));
    }
    const windowSize = config.windowSizeDays;
    if (windowSize !== null && (typeof windowSize !== "number" || !Number.isInteger(windowSize) || windowSize < 1)) {
      issues.push(issue("DFA_COUNT_INVALID", `${path}.config.windowSizeDays`, "必须 ≥1 整数或 null"));
    }
  }
  checkNonNegativeInt(record.candidateEventCount, `${path}.candidateEventCount`, issues);
  checkNonNegativeInt(record.excludedNoReasonCodeCount, `${path}.excludedNoReasonCodeCount`, issues);
  if (!Array.isArray(record.patterns)) {
    issues.push(issue("DFA_ARRAY_INVALID", `${path}.patterns`, "patterns 必须是数组"));
    return;
  }
  record.patterns.forEach((pattern, index) => {
    const p = requireRecord(pattern, issues, `${path}.patterns[${index}]`);
    if (p === null) return;
    checkNonEmptyString(p.groupKey, `${path}.patterns[${index}].groupKey`, issues);
    if (typeof p.reasonCode !== "string" || !isJournalReasonCode(p.reasonCode)) {
      issues.push(issue("DFA_REASON_CODE_INVALID", `${path}.patterns[${index}].reasonCode`, "reasonCode 非法"));
    }
    const occurrenceCount = p.occurrenceCount;
    checkNonNegativeInt(occurrenceCount, `${path}.patterns[${index}].occurrenceCount`, issues);
    checkDate(p.firstOccurrenceDate, `${path}.patterns[${index}].firstOccurrenceDate`, issues);
    checkDate(p.lastOccurrenceDate, `${path}.patterns[${index}].lastOccurrenceDate`, issues);
    if (Array.isArray(p.occurrences) && typeof occurrenceCount === "number") {
      if (p.occurrences.length !== occurrenceCount) {
        issues.push(issue("DFA_CONSISTENCY", `${path}.patterns[${index}].occurrences`, "occurrences 长度必须等于 occurrenceCount"));
      }
      p.occurrences.forEach((occ, oi) => {
        const o = requireRecord(occ, issues, `${path}.patterns[${index}].occurrences[${oi}]`);
        if (o === null) return;
        checkNonEmptyString(o.journalId, `${path}.patterns[${index}].occurrences[${oi}].journalId`, issues);
        checkNonEmptyString(o.entryId, `${path}.patterns[${index}].occurrences[${oi}].entryId`, issues);
        checkDate(o.decisionDate, `${path}.patterns[${index}].occurrences[${oi}].decisionDate`, issues);
        checkNonEmptyString(o.securityId, `${path}.patterns[${index}].occurrences[${oi}].securityId`, issues);
        checkNonEmptyString(o.strategyKey, `${path}.patterns[${index}].occurrences[${oi}].strategyKey`, issues);
      });
    }
    if (Array.isArray(p.intervalDays) && typeof occurrenceCount === "number") {
      if (p.intervalDays.length !== occurrenceCount - 1) {
        issues.push(issue("DFA_CONSISTENCY", `${path}.patterns[${index}].intervalDays`, `intervalDays 长度必须等于 occurrenceCount-1（${occurrenceCount - 1}）`));
      }
      p.intervalDays.forEach((v, di) => checkNonNegativeInt(v, `${path}.patterns[${index}].intervalDays[${di}]`, issues));
    }
    const peak = p.peakWindow;
    if (peak !== null) {
      const pw = requireRecord(peak, issues, `${path}.patterns[${index}].peakWindow`);
      if (pw !== null) {
        checkNonNegativeInt(pw.maxOccurrenceCount, `${path}.patterns[${index}].peakWindow.maxOccurrenceCount`, issues);
        checkDate(pw.windowStartDate, `${path}.patterns[${index}].peakWindow.windowStartDate`, issues);
        checkDate(pw.windowEndDate, `${path}.patterns[${index}].peakWindow.windowEndDate`, issues);
        if (isRecord(config) && typeof pw.windowSizeDays === "number" && typeof pw.windowStartDate === "string") {
          const expectEnd = calendarDatePlusDays(pw.windowStartDate, pw.windowSizeDays - 1);
          if (pw.windowEndDate !== expectEnd) {
            issues.push(issue("DFA_CONSISTENCY", `${path}.patterns[${index}].peakWindow.windowEndDate`,
              `窗口末日应为 ${expectEnd}（start + size − 1），实际 ${String(pw.windowEndDate)}`));
          }
        }
      }
    }
  });
}

function validateExecutionQualityReport(report: unknown, issues: ResearchValidationIssue[], path: string): void {
  const record = requireRecord(report, issues, path);
  if (record === null) return;
  const config = record.config;
  if (isRecord(config)) {
    const rankBy = config.rankBy;
    if (rankBy !== "meanAbsPriceDeviationPct" && rankBy !== "nonFullFillRatePct" && rankBy !== "timingLateRatePct") {
      issues.push(issue("DFA_VALUE_INVALID", `${path}.config.rankBy`, `rankBy（${String(rankBy)}）非法`));
    }
    const minSamples = config.minSamples;
    if (typeof minSamples !== "number" || !Number.isInteger(minSamples) || minSamples < 1) {
      issues.push(issue("DFA_COUNT_INVALID", `${path}.config.minSamples`, "必须 ≥1 整数"));
    }
  }
  checkNonNegativeInt(record.rankedCount, `${path}.rankedCount`, issues);
  checkNonNegativeInt(record.insufficientSampleCount, `${path}.insufficientSampleCount`, issues);
  if (!Array.isArray(record.rows)) {
    issues.push(issue("DFA_ARRAY_INVALID", `${path}.rows`, "rows 必须是数组"));
    return;
  }
  let rankCursor = 1;
  record.rows.forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    const r = requireRecord(row, issues, rowPath);
    if (r === null) return;
    checkNonEmptyString(r.strategyKey, `${rowPath}.strategyKey`, issues);
    checkNonNegativeInt(r.entryCount, `${rowPath}.entryCount`, issues);
    checkNonNegativeInt(r.fullFillCount, `${rowPath}.fullFillCount`, issues);
    checkNonNegativeInt(r.partialFillCount, `${rowPath}.partialFillCount`, issues);
    checkNonNegativeInt(r.unfilledCount, `${rowPath}.unfilledCount`, issues);
    checkFinite(r.unfilledRatePct, `${rowPath}.unfilledRatePct`, issues);
    checkFinite(r.partialFillRatePct, `${rowPath}.partialFillRatePct`, issues);
    checkFinite(r.nonFullFillRatePct, `${rowPath}.nonFullFillRatePct`, issues);
    checkNonNegativeInt(r.priceDeviationSampleCount, `${rowPath}.priceDeviationSampleCount`, issues);
    if (r.meanAbsPriceDeviationPct !== null) {
      checkFinite(r.meanAbsPriceDeviationPct, `${rowPath}.meanAbsPriceDeviationPct`, issues);
    }
    if (r.meanSignedPriceDeviationPct !== null) {
      checkFinite(r.meanSignedPriceDeviationPct, `${rowPath}.meanSignedPriceDeviationPct`, issues);
    }
    checkNonNegativeInt(r.timingSampleCount, `${rowPath}.timingSampleCount`, issues);
    if (r.timingLateRatePct !== null) {
      checkFinite(r.timingLateRatePct, `${rowPath}.timingLateRatePct`, issues);
    }
    checkNonNegativeInt(r.deviationFreeCount, `${rowPath}.deviationFreeCount`, issues);
    const status = r.status;
    if (status !== "RANKED" && status !== "INSUFFICIENT_SAMPLES") {
      issues.push(issue("DFA_VALUE_INVALID", `${rowPath}.status`, `status（${String(status)}）非法`));
    }
    if (status === "RANKED") {
      if (r.rank !== rankCursor) {
        issues.push(issue("DFA_CONSISTENCY", `${rowPath}.rank`, `RANKED 行 rank 必须连续（期望 ${rankCursor}，实际 ${String(r.rank)}）`));
      }
      rankCursor += 1;
    } else if (r.rank !== null) {
      issues.push(issue("DFA_CONSISTENCY", `${rowPath}.rank`, "INSUFFICIENT_SAMPLES 行 rank 必须为 null"));
    }
    const primary = r.primaryMetricValue;
    if (primary !== null) checkFinite(primary, `${rowPath}.primaryMetricValue`, issues);
  });
  if (rankCursor - 1 !== (record.rankedCount as number | undefined)) {
    if (typeof record.rankedCount === "number") {
      issues.push(issue("DFA_CONSISTENCY", `${path}.rankedCount`, `rankedCount 与 RANKED 行数（${rankCursor - 1}）不一致`));
    }
  }
}

function validateEnvironmentReport(report: unknown, issues: ResearchValidationIssue[], path: string): void {
  const record = requireRecord(report, issues, path);
  if (record === null) return;
  if (isRecord(record.config)) {
    const minSamples = (record.config as Record<string, unknown>).minSamples;
    if (typeof minSamples !== "number" || !Number.isInteger(minSamples) || minSamples < 1) {
      issues.push(issue("DFA_COUNT_INVALID", `${path}.config.minSamples`, "必须 ≥1 整数"));
    }
  }
  checkNonNegativeInt(record.matchedAssignmentCount, `${path}.matchedAssignmentCount`, issues);
  checkNonNegativeInt(record.labeledEntryCount, `${path}.labeledEntryCount`, issues);
  checkNonNegativeInt(record.unlabeledEntryCount, `${path}.unlabeledEntryCount`, issues);
  if (!Array.isArray(record.rows)) {
    issues.push(issue("DFA_ARRAY_INVALID", `${path}.rows`, "rows 必须是数组"));
    return;
  }
  record.rows.forEach((row, index) => {
    const rowPath = `${path}.rows[${index}]`;
    const r = requireRecord(row, issues, rowPath);
    if (r === null) return;
    checkNonEmptyString(r.environmentKey, `${rowPath}.environmentKey`, issues);
    checkNonNegativeInt(r.taggedEntryCount, `${rowPath}.taggedEntryCount`, issues);
    checkNonNegativeInt(r.violationCount, `${rowPath}.violationCount`, issues);
    if (typeof r.taggedEntryCount === "number" && typeof r.violationCount === "number" &&
        r.violationCount > r.taggedEntryCount) {
      issues.push(issue("DFA_CONSISTENCY", `${rowPath}.violationCount`, "violationCount 不得大于 taggedEntryCount"));
    }
    checkFinite(r.violationDensityPct, `${rowPath}.violationDensityPct`, issues);
    if (r.meanSeverity !== null) checkFinite(r.meanSeverity, `${rowPath}.meanSeverity`, issues);
    checkNonNegativeInt(r.severityUnassignedCount, `${rowPath}.severityUnassignedCount`, issues);
    if (typeof r.insufficientSamples !== "boolean") {
      issues.push(issue("DFA_BOOL_INVALID", `${rowPath}.insufficientSamples`, "insufficientSamples 必须是布尔"));
    }
    const dist = r.severityDistribution;
    if (isRecord(dist)) {
      for (const severity of JOURNAL_RULE_VIOLATION_SEVERITIES) {
        checkNonNegativeInt(dist[severity], `${rowPath}.severityDistribution.${severity}`, issues);
      }
    }
  });
}

/** 校验 DisciplineFeedbackRun（纯函数）。 */
export function validateDisciplineFeedbackRun(run: unknown): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  const record = requireRecord(run, issues, "run");
  if (record === null) return { valid: false, issues };

  if (record.recordKind !== DISCIPLINE_FEEDBACK_RUN_KIND) {
    issues.push(issue("DFA_RECORD_KIND", "recordKind", `recordKind=${String(record.recordKind)} 不是 ${DISCIPLINE_FEEDBACK_RUN_KIND}`));
  }
  if (record.recordVersion !== DISCIPLINE_FEEDBACK_RUN_RECORD_VERSION) {
    issues.push(issue("DFA_RECORD_VERSION", "recordVersion", `recordVersion=${String(record.recordVersion)} 非法`));
  }
  checkNonEmptyString(record.runId, "runId", issues);
  checkDateTime(record.createdAt, "createdAt", issues);
  const fingerprint = record.fingerprint;
  if (typeof fingerprint !== "string" || !SHA256_HEX_RE.test(fingerprint)) {
    issues.push(issue("DFA_FINGERPRINT_FORMAT", "fingerprint", "fingerprint 必须是 sha256 hex（64 位）"));
  }
  if (typeof record.inputLedgerFingerprint !== "string" || !SHA256_HEX_RE.test(record.inputLedgerFingerprint)) {
    issues.push(issue("DFA_FINGERPRINT_FORMAT", "inputLedgerFingerprint", "inputLedgerFingerprint 必须是 sha256 hex"));
  }
  checkNonNegativeInt(record.rawEntryCount, "rawEntryCount", issues);

  const summary = requireRecord(record.summary, issues, "summary");
  if (summary !== null) {
    checkNonNegativeInt(summary.analyzedEntryCount, "summary.analyzedEntryCount", issues);
    checkNonNegativeInt(summary.unannotatedEntryCount, "summary.unannotatedEntryCount", issues);
    checkNonNegativeInt(summary.annotationCount, "summary.annotationCount", issues);
    checkNonNegativeInt(summary.violationDeclaredCount, "summary.violationDeclaredCount", issues);
    checkNonNegativeInt(summary.noViolationDeclaredCount, "summary.noViolationDeclaredCount", issues);
    checkDate(summary.coverageStartDate, "summary.coverageStartDate", issues);
    checkDate(summary.coverageEndDate, "summary.coverageEndDate", issues);
    if (typeof summary.analyzedEntryCount === "number" && typeof summary.annotationCount === "number" &&
        typeof summary.unannotatedEntryCount === "number" &&
        summary.analyzedEntryCount !== summary.annotationCount + summary.unannotatedEntryCount) {
      issues.push(issue("DFA_CONSISTENCY", "summary", "analyzedEntryCount 必须 = annotationCount + unannotatedEntryCount"));
    }
  }

  validateViolationCauseReport(record.violationCauses, issues, "violationCauses");
  validateRepeatReport(record.repeatMistakes, issues, "repeatMistakes");
  validateExecutionQualityReport(record.executionQuality, issues, "executionQuality");
  validateEnvironmentReport(record.errorProneEnvironments, issues, "errorProneEnvironments");

  // environmentAssignments
  if (!Array.isArray(record.environmentAssignments)) {
    issues.push(issue("DFA_ARRAY_INVALID", "environmentAssignments", "environmentAssignments 必须是数组"));
  } else {
    record.environmentAssignments.forEach((assignment, index) => {
      const a = requireRecord(assignment, issues, `environmentAssignments[${index}]`);
      if (a === null) return;
      checkNonEmptyString(a.journalId, `environmentAssignments[${index}].journalId`, issues);
      if (!Array.isArray(a.environmentKeys) || a.environmentKeys.length === 0) {
        issues.push(issue("DFA_ARRAY_INVALID", `environmentAssignments[${index}].environmentKeys`, "environmentKeys 必须是非空数组"));
      } else {
        a.environmentKeys.forEach((key, ki) => {
          if (typeof key !== "string" || key.trim() === "") {
            issues.push(issue("DFA_REQUIRED", `environmentAssignments[${index}].environmentKeys[${ki}]`, "环境键必须是非空字符串"));
          }
        });
      }
    });
  }

  // patterns
  if (!Array.isArray(record.patterns)) {
    issues.push(issue("DFA_ARRAY_INVALID", "patterns", "patterns 必须是数组"));
  } else {
    record.patterns.forEach((pattern, index) => {
      const p = requireRecord(pattern, issues, `patterns[${index}]`);
      if (p === null) return;
      const kinds: readonly DisciplineFeedbackPatternKind[] = [
        "repeatMistake",
        "errorProneEnvironment",
        "worstExecutionCandidate",
      ];
      if (typeof p.kind !== "string" || !kinds.includes(p.kind as never)) {
        issues.push(issue("DFA_VALUE_INVALID", `patterns[${index}].kind`, `kind（${String(p.kind)}）非法`));
      }
      checkNonEmptyString(p.key, `patterns[${index}].key`, issues);
      checkNonEmptyString(p.label, `patterns[${index}].label`, issues);
      checkNonNegativeInt(p.evidenceCount, `patterns[${index}].evidenceCount`, issues);
      checkNonEmptyString(p.qualifier, `patterns[${index}].qualifier`, issues);
    });
  }

  // conclusion
  const conclusion = requireRecord(record.conclusion, issues, "conclusion");
  if (conclusion !== null) {
    const verdicts: readonly DisciplineFeedbackVerdict[] = ["stable", "patternsFound", "inconclusive"];
    if (typeof conclusion.verdict !== "string" || !verdicts.includes(conclusion.verdict as never)) {
      issues.push(issue("DFA_VALUE_INVALID", "conclusion.verdict", `verdict（${String(conclusion.verdict)}）非法`));
    }
    if (typeof conclusion.reasonCode !== "string" || !isDfaReasonCode(conclusion.reasonCode)) {
      issues.push(issue("DFA_REASON_CODE_INVALID", "conclusion.reasonCode", `reasonCode（${String(conclusion.reasonCode)}）不在 DFA_REASON_CODES`));
    }
    if (typeof conclusion.reason !== "string" || conclusion.reason.trim() === "") {
      issues.push(issue("DFA_REQUIRED", "conclusion.reason", "reason 必须是非空字符串"));
    }
  }

  return { valid: issues.length === 0, issues };
}

/** assert 版本：非法即抛 DisciplineFeedbackError。 */
export function assertValidDisciplineFeedbackRun(run: unknown): asserts run is DisciplineFeedbackRun {
  const result = validateDisciplineFeedbackRun(run);
  if (!result.valid) {
    const lines = result.issues.map((i) => `  [${i.code}] ${i.path}: ${i.message}`).join("\n");
    throw new DisciplineFeedbackError(DFA_ERROR_CODES.RUN_INVALID, `纪律反馈分析记录校验失败：\n${lines}`);
  }
}

/** requireRecord 本地重载（供以上校验器使用）。 */
function requireRecord(value: unknown, issues: ResearchValidationIssue[], path: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    issues.push(issue("DFA_STRUCT_NOT_OBJECT", path, `${path} 必须是对象`));
    return null;
  }
  return value;
}
