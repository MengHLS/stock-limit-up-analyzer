/**
 * STEP 24 / C-24.2 — 纪律反馈分析：确定性公共工具（纯函数，无 IO/Date.now/Math.random）。
 *
 * 职责：
 *   - 校验 + 归并分析集合：assertFeedbackEntriesReadable（每条结构 + 指纹复核）与
 *     resolveFeedbackEntries（latest-per-journal 归并，修订重复歧义响亮拒绝）；
 *   - 纯日期工具（自然日差，日历日号转换——确定性，无 Date 对象副作用）；
 *   - 确定性排序键 / 稳定百分比 / 策略引用键。
 */

import { createHash } from "node:crypto";
import type { TradeJournalEntry } from "../tradeJournal/types";
import { assertValidTradeJournalEntry } from "../tradeJournal/validate";
import { computeTradeJournalEntryFingerprint } from "../tradeJournal/serialize";
import { canonicalStringify } from "../../researchDataset/version";
import { DFA_ERROR_CODES, DisciplineFeedbackError } from "./errors";

// ---------------------------------------------------------------------------
// entry 读取性校验（账本只读输入，绝不改写）
// ---------------------------------------------------------------------------

/**
 * 校验 entry 集可读：每条结构 + 指纹复核（防篡改）。输入 readonly、不修改。
 * 任一条非法 → 抛 DisciplineFeedbackError（FAIL FAST），不返回残缺视图。
 */
export function assertFeedbackEntriesReadable(entries: readonly TradeJournalEntry[]): void {
  if (!Array.isArray(entries)) {
    throw new DisciplineFeedbackError(DFA_ERROR_CODES.INPUT_INVALID, "entries 必须是数组");
  }
  entries.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.ENTRY_INVALID,
        `entries[${index}] 不是对象：纪律分析只消费 TradeJournalEntry`
      );
    }
    assertValidTradeJournalEntry(entry); // 结构 + 时间序（PIT）
    const recomputed = computeTradeJournalEntryFingerprint(entry);
    if (entry.fingerprint !== recomputed) {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.ENTRY_FINGERPRINT_MISMATCH,
        `entries[${index}]（entryId=${entry.entryId}）指纹不符（期望 ${recomputed}，实际 ${entry.fingerprint}），` +
          `输入账本疑似被篡改，拒绝分析`
      );
    }
  });
}

/**
 * 归并分析集合：给定任意版本集（可含 supersedes 修订链历史），返回
 * latest-per-journal 的最新版本（确定性：按 journalId 字典序输出）。
 *
 * 歧义拒绝：同一 journalId 出现两个相同最高 entryVersion → 数据矛盾（合法账本不可能），
 * 响亮抛错而非静默取其一。
 */
export function resolveFeedbackEntries(
  entries: readonly TradeJournalEntry[]
): { readonly resolved: readonly TradeJournalEntry[]; readonly rawCount: number } {
  assertFeedbackEntriesReadable(entries);
  const byJournal = new Map<string, TradeJournalEntry>();
  const maxVersion = new Map<string, number>();
  for (const entry of entries) {
    const journalId = entry.journalId;
    const currentMax = maxVersion.get(journalId) ?? 0;
    if (entry.entryVersion > currentMax) {
      maxVersion.set(journalId, entry.entryVersion);
      byJournal.set(journalId, entry);
    } else if (entry.entryVersion === currentMax) {
      // 相同 journalId 相同最高版本出现两次：若同一对象则幂等忽略；否则歧义拒绝。
      const kept = byJournal.get(journalId);
      if (kept !== undefined && kept.entryId !== entry.entryId) {
        throw new DisciplineFeedbackError(
          DFA_ERROR_CODES.ENTRY_DUPLICATE_AMBIGUOUS,
          `journalId=${journalId} 存在两个相同最高版本（entryId=${kept.entryId} 与 ${entry.entryId}），` +
            `无法判定最新版本，拒绝分析`
        );
      }
    }
  }
  const resolved = Array.from(byJournal.values()).sort((a, b) => a.journalId.localeCompare(b.journalId));
  return { resolved, rawCount: entries.length };
}

// ---------------------------------------------------------------------------
// 日期工具（确定性；YYYY-MM-DD → 日历日号 → 自然日差）
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): void {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.DATE_INVALID,
      `${label}（${String(value)}）必须是 YYYY-MM-DD`
    );
  }
}

/**
 * 日历日号（自 epoch 起天数；纯确定性计算，无 Date.now）。
 * Date.UTC 仅做数值换算（无 IO / 无随机），对 1900~2200 范围内安全。
 */
export function calendarDayNumber(isoDate: string): number {
  assertIsoDate(isoDate, "isoDate");
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** 两个 YYYY-MM-DD 的自然日差（b − a；均须合法日期字符串）。 */
export function calendarDaysBetween(a: string, b: string): number {
  return calendarDayNumber(b) - calendarDayNumber(a);
}

/** 给日期加自然日偏移返回 YYYY-MM-DD（用于窗口末日计算；纯确定性）。 */
export function calendarDatePlusDays(isoDate: string, days: number): string {
  const dayNum = calendarDayNumber(isoDate) + days;
  return new Date(dayNum * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 确定性聚合工具
// ---------------------------------------------------------------------------

/** 稳定百分比：numerator/denominator*100；denominator<=0 → null（不硬造）。 */
export function stablePercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

/** 稳定算术平均（空数组 → null）。 */
export function stableMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** 策略引用键（聚合/分组维度：信号来源的策略引用）。 */
export function strategyKeyOf(entry: TradeJournalEntry): string {
  return `${entry.runRef.strategyId}@${entry.runRef.strategyVersion}`;
}

/** canonical sha256（输入指纹/记录指纹共用的确定性摘要）。 */
export function sha256Digest(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

/** 递归检查非有限数字；发现即抛错（与既有 serialize 哲学一致，不静默转 null）。 */
export function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DisciplineFeedbackError(
        DFA_ERROR_CODES.INPUT_INVALID,
        `拒绝含非有限数字 ${String(value)}（${path}）；纪律反馈记录禁止 NaN / Infinity`
      );
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteRecord(item, `${path}[${index}]`));
    return;
  }
  for (const key of Object.keys(value as object)) {
    assertFiniteRecord((value as Record<string, unknown>)[key], path === "" ? key : `${path}.${key}`);
  }
}
