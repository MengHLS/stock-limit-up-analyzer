/**
 * STEP 23 / C-23.2 — 信号→订单→成交→PnL 闭环编排：SignalToPnlRun 结构校验。
 *
 * 防篡改主体是 fingerprint 复核（serialize.ts），本文件只做「轻量形态复核」：
 * 保证 JSON → 对象不回退类型边界（recordKind/recordVersion/关键数组/数值有限）。
 * 任何字段内容被篡改都会导致 fingerprint 不匹配而在 deserialize 抛错。
 */

import type {
  PnlLoopDayDecision,
  PnlLoopDayExecution,
  PnlLoopDayMark,
  PnlLoopRejectionEntry,
  SignalToPnlRun,
} from "./types";
import {
  SIGNAL_TO_PNL_RUN_KIND,
  SIGNAL_TO_PNL_RUN_RECORD_VERSION,
} from "./types";
import { SIGNAL_TO_PNL_ERROR_CODES, SignalToPnlError } from "./errors";

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: 反序列化结果不是对象：${label}`
    );
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: ${label} 必须是非空字符串`
    );
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: ${label} 必须是数组`
    );
  }
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: ${label} 必须是有限数字`
    );
  }
}

function assertNonNegativeFiniteNumber(
  value: unknown,
  label: string
): asserts value is number {
  assertFiniteNumber(value, label);
  if ((value as number) < 0) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: ${label} 必须是非负数字（收到 ${String(value)}）`
    );
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 校验 SignalToPnlRun 形态（recordKind / recordVersion / 关键数组 / 数值有限 / 日期升序）。
 * 反序列化时先经此复核，再经 fingerprint 复核（见 serialize.ts）。
 */
export function assertValidSignalToPnlRun(
  value: unknown
): asserts value is SignalToPnlRun {
  assertObject(value, "signalToPnlRun");
  if (value.recordKind !== SIGNAL_TO_PNL_RUN_KIND) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: recordKind=${String(value.recordKind)} 不是 ${SIGNAL_TO_PNL_RUN_KIND}`
    );
  }
  if (value.recordVersion !== SIGNAL_TO_PNL_RUN_RECORD_VERSION) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: recordVersion=${String(value.recordVersion)} 不受支持（期望 ${SIGNAL_TO_PNL_RUN_RECORD_VERSION}）`
    );
  }
  assertString(value.runId, "runId");
  assertString(value.accountId, "accountId");
  assertString(value.createdAt, "createdAt");

  // sourceRef
  assertObject(value.sourceRef, "sourceRef");
  assertString(value.sourceRef.sourceCandidateFingerprint, "sourceRef.sourceCandidateFingerprint");
  assertString(value.sourceRef.datasetVersion, "sourceRef.datasetVersion");
  assertString(value.sourceRef.strategyId, "sourceRef.strategyId");
  assertString(value.sourceRef.strategyVersion, "sourceRef.strategyVersion");
  assertObject(value.sourceRef.sourceDateRange, "sourceRef.sourceDateRange");
  assertString(value.sourceRef.sourceDateRange.startDate, "sourceRef.sourceDateRange.startDate");
  assertString(value.sourceRef.sourceDateRange.endDate, "sourceRef.sourceDateRange.endDate");
  assertFiniteNumber(value.sourceRef.sourceDecisionDayCount, "sourceRef.sourceDecisionDayCount");
  if (value.sourceRef.sourceDecisionDayCount < 0) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: sourceRef.sourceDecisionDayCount 不能为负`
    );
  }

  assertString(value.sourceFingerprint, "sourceFingerprint");
  assertString(value.costDeclarationFingerprint, "costDeclarationFingerprint");
  assertString(value.executionDeclarationFingerprint, "executionDeclarationFingerprint");

  assertArray(value.executionCoverage, "executionCoverage");
  assertFiniteNumber(value.initialCapital, "initialCapital");
  if (value.initialCapital <= 0) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: initialCapital 必须为正`
    );
  }
  assertString(value.initialAsOf, "initialAsOf");
  if (!ISO_DATE_RE.test(value.initialAsOf)) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: initialAsOf 不是 YYYY-MM-DD`
    );
  }

  assertArray(value.tradingCalendar, "tradingCalendar");
  const tradingCalendarTyped = value.tradingCalendar as readonly string[];
  for (let i = 0; i < tradingCalendarTyped.length; i += 1) {
    const date = tradingCalendarTyped[i]!;
    if (!ISO_DATE_RE.test(date)) {
      throw new SignalToPnlError(
        SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
        `signalToPnl: tradingCalendar[${i}] 不是 YYYY-MM-DD`
      );
    }
    if (i > 0 && date <= tradingCalendarTyped[i - 1]!) {
      throw new SignalToPnlError(
        SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
        `signalToPnl: tradingCalendar 必须严格升序`
      );
    }
  }

  assertFiniteNumber(value.tradingDayCount, "tradingDayCount");
  if (value.tradingDayCount !== value.tradingCalendar.length) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: tradingDayCount(${value.tradingDayCount}) ≠ tradingCalendar.length(${value.tradingCalendar.length})`
    );
  }
  assertNonNegativeFiniteNumber(value.decisionDayCount, "decisionDayCount");

  assertArray(value.days, "days");
  assertArray(value.executions, "executions");
  assertArray(value.dailyMarks, "dailyMarks");

  assertArray(value.orders, "orders");
  assertArray(value.fills, "fills");
  assertArray(value.positionSnapshots, "positionSnapshots");
  assertArray(value.cashLedger, "cashLedger");
  assertArray(value.equityCurve, "equityCurve");
  assertObject(value.pnlBreakdown, "pnlBreakdown");

  assertArray(value.frozenTimeline, "frozenTimeline");
  for (let i = 0; i < value.frozenTimeline.length; i += 1) {
    const entry = value.frozenTimeline[i] as Record<string, unknown>;
    assertObject(entry, `frozenTimeline[${i}]`);
    assertString(entry.tradeDate, `frozenTimeline[${i}].tradeDate`);
    assertNonNegativeFiniteNumber(entry.frozen, `frozenTimeline[${i}].frozen`);
  }

  assertObject(value.rejectionSummary, "rejectionSummary");
  for (const [code, count] of Object.entries(value.rejectionSummary)) {
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
      throw new SignalToPnlError(
        SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
        `signalToPnl: rejectionSummary.${code} 必须是非负有限数字`
      );
    }
  }

  assertArray(value.rejectionLedger, "rejectionLedger");
  assertObject(value.stats, "stats");
  assertString(value.fingerprint, "fingerprint");

  // equityCurve 日期升序 + 数值非负有限
  for (let i = 0; i < value.equityCurve.length; i += 1) {
    const point = value.equityCurve[i] as Record<string, unknown>;
    assertObject(point, `equityCurve[${i}]`);
    assertString(point.date, `equityCurve[${i}].date`);
    assertFiniteNumber(point.equity, `equityCurve[${i}].equity`);
    if (i > 0) {
      const prev = value.equityCurve[i - 1] as Record<string, unknown>;
      if ((point.date as string) <= (prev.date as string)) {
        throw new SignalToPnlError(
          SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
          `signalToPnl: equityCurve 日期必须严格升序（${prev.date} -> ${point.date}）`
        );
      }
    }
  }

  // dailyMarks 与 tradingCalendar 一致性
  if (value.dailyMarks.length !== value.tradingCalendar.length) {
    throw new SignalToPnlError(
      SIGNAL_TO_PNL_ERROR_CODES.RUN_INVALID,
      `signalToPnl: dailyMarks.length(${value.dailyMarks.length}) ≠ tradingCalendar.length(${value.tradingCalendar.length})`
    );
  }
  for (let i = 0; i < value.dailyMarks.length; i += 1) {
    const mark = value.dailyMarks[i] as Record<string, unknown>;
    assertObject(mark, `dailyMarks[${i}]`);
    assertString(mark.tradeDate, `dailyMarks[${i}].tradeDate`);
    assertFiniteNumber(mark.equity, `dailyMarks[${i}].equity`);
    assertNonNegativeFiniteNumber(mark.cash, `dailyMarks[${i}].cash`);
    assertNonNegativeFiniteNumber(mark.frozen, `dailyMarks[${i}].frozen`);
    assertNonNegativeFiniteNumber(mark.marketValue, `dailyMarks[${i}].marketValue`);
    assertFiniteNumber(mark.realizedPnL, `dailyMarks[${i}].realizedPnL`);
  }
}

// 工具类型守卫（导出供后续单测使用，避开未使用告警）
export type {
  PnlLoopDayDecision,
  PnlLoopDayExecution,
  PnlLoopDayMark,
  PnlLoopRejectionEntry,
  SignalToPnlRun,
};