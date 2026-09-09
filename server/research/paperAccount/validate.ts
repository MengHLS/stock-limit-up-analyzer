/**
 * STEP 23 / C-23.1 — 模拟账户：PaperAccountRun 结构校验（反序列化复核）。
 *
 * 防篡改主体是 fingerprint 复核（serialize.ts），本文件只做「轻量形态复核」：
 * 保证 JSON → 对象不回退类型边界（recordKind/recordVersion/关键数组/数值有限）。
 * 任何字段内容被篡改都会导致 fingerprint 不匹配而在 deserialize 抛错。
 */

import type { PaperAccountRun } from "./types";
import {
  PAPER_ACCOUNT_RUN_KIND,
  PAPER_ACCOUNT_RUN_RECORD_VERSION,
} from "./types";
import { PAPER_ACCOUNT_ERROR_CODES, PaperAccountError } from "./errors";

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.RUN_INVALID,
      `paperAccount: 反序列化结果不是对象：${label}`
    );
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.RUN_INVALID,
      `paperAccount: ${label} 必须是非空字符串`
    );
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.RUN_INVALID,
      `paperAccount: ${label} 必须是数组`
    );
  }
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.RUN_INVALID,
      `paperAccount: ${label} 必须是有限数字`
    );
  }
}

/**
 * 校验 PaperAccountRun 形态（recordKind / recordVersion / 关键数组 / 数值有限）。
 * 反序列化时先经此复核，再经 fingerprint 复核（见 serialize.ts）。
 */
export function assertValidPaperAccountRun(
  value: unknown
): asserts value is PaperAccountRun {
  assertObject(value, "paperAccountRun");
  if (value.recordKind !== PAPER_ACCOUNT_RUN_KIND) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.RUN_INVALID,
      `paperAccount: recordKind=${String(value.recordKind)} 不是 ${PAPER_ACCOUNT_RUN_KIND}`
    );
  }
  if (value.recordVersion !== PAPER_ACCOUNT_RUN_RECORD_VERSION) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.RUN_INVALID,
      `paperAccount: recordVersion=${String(value.recordVersion)} 不受支持（期望 ${PAPER_ACCOUNT_RUN_RECORD_VERSION}）`
    );
  }
  assertString(value.runId, "runId");
  assertString(value.createdAt, "createdAt");
  assertFiniteNumber(value.initialCapital, "initialCapital");
  if (value.initialCapital <= 0) {
    throw new PaperAccountError(
      PAPER_ACCOUNT_ERROR_CODES.RUN_INVALID,
      `paperAccount: initialCapital 必须为正`
    );
  }
  assertString(value.costDeclarationFingerprint, "costDeclarationFingerprint");
  assertString(value.executionDeclarationFingerprint, "executionDeclarationFingerprint");
  assertArray(value.executionCoverage, "executionCoverage");
  assertArray(value.orders, "orders");
  assertArray(value.fills, "fills");
  assertArray(value.positionSnapshots, "positionSnapshots");
  assertArray(value.cashLedger, "cashLedger");
  assertArray(value.equityCurve, "equityCurve");
  assertObject(value.pnlBreakdown, "pnlBreakdown");
  assertString(value.fingerprint, "fingerprint");

  // 权益曲线日期严格升序 + 数值非负有限。
  for (let i = 0; i < value.equityCurve.length; i += 1) {
    const point = value.equityCurve[i] as Record<string, unknown>;
    assertObject(point, `equityCurve[${i}]`);
    assertString(point.date, `equityCurve[${i}].date`);
    assertFiniteNumber(point.equity, `equityCurve[${i}].equity`);
    if (i > 0) {
      const prev = value.equityCurve[i - 1] as Record<string, unknown>;
      if ((point.date as string) <= (prev.date as string)) {
        throw new PaperAccountError(
          PAPER_ACCOUNT_ERROR_CODES.RUN_INVALID,
          `paperAccount: equityCurve 日期必须严格升序（${prev.date} -> ${point.date}）`
        );
      }
    }
  }
}
