/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录：序列化 / 指纹 / 账本断链检测（纯函数、确定性）。
 *
 * 对齐既有范式（lifecycle/serialize.ts 等）：
 *   - serialize / fingerprint 使用按键字典序的 canonical JSON（canonicalStringify，
 *     来自 researchDataset/version 只读复用），同内容必同串；
 *   - 任何 NaN / Infinity 进入指纹前直接抛错（绝不静默转 null）；
 *   - record fingerprint = sha256（除 fingerprint 字段外全部字段的 canonical 摘要）；
 *   - 账本内容校验 verifyTradeJournalLedgerContent：逐条结构 + 指纹复核 +
 *     supersedes 修订链校验（append-only：同 journalId 版本严格递增衔接、v1 无 supersedes、
 *     修订指向前一版本）——篡改任何历史版本或插入/删除/重排都会检出。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import type { ResearchValidationIssue } from "../experimentValidation";
import type { PostReviewRecord, TradeJournalEntry } from "./types";
import { TJ_ERROR_CODES, TradeJournalError } from "./errors";
import { assertValidPostReviewRecord, assertValidTradeJournalEntry } from "./validate";

/** 账本快照（可序列化形态）。 */
export interface JournalLedgerSnapshot {
  readonly entries: readonly TradeJournalEntry[];
  readonly reviews: readonly PostReviewRecord[];
}

// ---------------------------------------------------------------------------
// 指纹与单记录 round-trip
// ---------------------------------------------------------------------------

/** 递归检查非有限数字；发现即抛错（失败响亮，不静默）。 */
function assertFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.SERIALIZE_NON_FINITE,
        `拒绝含非有限数字 ${String(value)}（${path}）；日志/复盘记录禁止 NaN / Infinity`
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

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

/** 计算日志条目指纹：除 fingerprint 字段外全部字段的 canonical 摘要。 */
export function computeTradeJournalEntryFingerprint(
  entry: TradeJournalEntry | Omit<TradeJournalEntry, "fingerprint">
): string {
  assertFiniteRecord(entry, "entry");
  const body: Record<string, unknown> = { ...(entry as object) };
  delete body.fingerprint;
  return digest(body);
}

/** 计算复盘记录指纹：除 fingerprint 字段外全部字段的 canonical 摘要。 */
export function computePostReviewRecordFingerprint(
  review: PostReviewRecord | Omit<PostReviewRecord, "fingerprint">
): string {
  assertFiniteRecord(review, "review");
  const body: Record<string, unknown> = { ...(review as object) };
  delete body.fingerprint;
  return digest(body);
}

/** 序列化日志条目（canonical JSON；拒绝 NaN/Infinity）。 */
export function serializeTradeJournalEntry(entry: TradeJournalEntry): string {
  assertFiniteRecord(entry, "entry");
  return canonicalStringify(entry);
}

/** 序列化复盘记录。 */
export function serializePostReviewRecord(review: PostReviewRecord): string {
  assertFiniteRecord(review, "review");
  return canonicalStringify(review);
}

/** 解析顶层对象（失败响亮）。 */
function parseTopLevelObject(json: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.INPUT_INVALID,
      `${label}反序列化失败：JSON 解析错误（${(error as Error).message}）`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TradeJournalError(TJ_ERROR_CODES.INPUT_INVALID, `${label}反序列化失败：顶层必须是对象`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * 反序列化日志条目：结构 + 语义校验（validate）→ 指纹复核。任一步失败即抛错。
 */
export function deserializeTradeJournalEntry(json: string): TradeJournalEntry {
  const parsed = parseTopLevelObject(json, "日志条目");
  const entry = parsed as unknown as TradeJournalEntry;
  assertValidTradeJournalEntry(entry);
  const recomputed = computeTradeJournalEntryFingerprint(entry);
  if (entry.fingerprint !== recomputed) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.ENTRY_FINGERPRINT_MISMATCH,
      `日志条目指纹不匹配：内容已被篡改或退化（期望 ${recomputed}，实际 ${entry.fingerprint}）`
    );
  }
  return entry;
}

/** 反序列化复盘记录：结构校验 + 指纹复核。 */
export function deserializePostReviewRecord(json: string): PostReviewRecord {
  const parsed = parseTopLevelObject(json, "复盘记录");
  const review = parsed as unknown as PostReviewRecord;
  assertValidPostReviewRecord(review);
  const recomputed = computePostReviewRecordFingerprint(review);
  if (review.fingerprint !== recomputed) {
    throw new TradeJournalError(
      TJ_ERROR_CODES.REVIEW_FINGERPRINT_MISMATCH,
      `复盘记录指纹不匹配：内容已被篡改或退化（期望 ${recomputed}，实际 ${review.fingerprint}）`
    );
  }
  return review;
}

// ---------------------------------------------------------------------------
// 账本内容校验（supersedes 修订链 + 指纹 + 结构；append-only 断链检测）
// ---------------------------------------------------------------------------

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

/**
 * 校验账本内容整体（逐条结构 + 指纹 + supersedes 链）。
 * 返回 issue 清单；空 = 账本完整。
 *
 * supersedes 链规则（append-only）：
 *   - 同 journalId 的条目按 entryVersion 升序排列必须是 1..n 连续递增；
 *   - v1 的 supersedesEntryId = null；
 *   - 非 v1 的 supersedesEntryId 必须等于上一版本的 entryId；
 *   - entryId 全局唯一、reviewId 全局唯一。
 */
export function verifyTradeJournalLedgerContent(
  entries: readonly TradeJournalEntry[],
  reviews: readonly PostReviewRecord[]
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];

  // ---- 单条结构 + 指纹 ----
  const entryIds = new Set<string>();
  entries.forEach((entry, index) => {
    const path = `entries[${index}]`;
    const structural = validateEntryLight(entry);
    structural.forEach((s) => issues.push({ ...s, path: `${path}.${s.path}` }));
    if (entryIds.has(entry.entryId)) {
      issues.push(issue("TJ_LEDGER_ENTRY_ID_DUPLICATE", `${path}.entryId`, `entryId ${entry.entryId} 重复（账本内 entryId 必须唯一）`));
    }
    entryIds.add(entry.entryId);
    const recomputed = computeTradeJournalEntryFingerprint(entry);
    if (entry.fingerprint !== recomputed) {
      issues.push(
        issue("TJ_LEDGER_ENTRY_FINGERPRINT_MISMATCH", `${path}.fingerprint`,
          `日志条目指纹不匹配：entryId=${entry.entryId} 内容已被篡改（期望 ${recomputed}，实际 ${entry.fingerprint}）`)
      );
    }
  });

  const reviewIds = new Set<string>();
  reviews.forEach((review, index) => {
    const path = `reviews[${index}]`;
    const structural = validateReviewLight(review);
    structural.forEach((s) => issues.push({ ...s, path: `${path}.${s.path}` }));
    if (reviewIds.has(review.reviewId)) {
      issues.push(issue("TJ_LEDGER_REVIEW_ID_DUPLICATE", `${path}.reviewId`, `reviewId ${review.reviewId} 重复（账本内 reviewId 必须唯一）`));
    }
    reviewIds.add(review.reviewId);
    const recomputed = computePostReviewRecordFingerprint(review);
    if (review.fingerprint !== recomputed) {
      issues.push(
        issue("TJ_LEDGER_REVIEW_FINGERPRINT_MISMATCH", `${path}.fingerprint`,
          `复盘记录指纹不匹配：reviewId=${review.reviewId} 内容已被篡改（期望 ${recomputed}，实际 ${review.fingerprint}）`)
      );
    }
  });

  // ---- supersedes 修订链 ----
  const byJournal = new Map<string, TradeJournalEntry[]>();
  for (const entry of entries) {
    const list = byJournal.get(entry.journalId);
    if (list === undefined) byJournal.set(entry.journalId, [entry]);
    else list.push(entry);
  }
  for (const [journalId, group] of Array.from(byJournal.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = group.slice().sort((a, b) => a.entryVersion - b.entryVersion);
    const versions = sorted.map((e) => e.entryVersion);
    for (let i = 0; i < versions.length; i += 1) {
      if (versions[i] !== i + 1) {
        issues.push(issue("TJ_LEDGER_CHAIN_VERSION_GAP", `entries[journalId=${journalId}]`,
          `修订链版本不连续：期望 1..${versions.length} 连续递增，实际第 ${i} 位 = ${String(versions[i])}`));
        break;
      }
    }
    const first = sorted[0]!;
    if (first.entryVersion === 1 && first.supersedesEntryId !== null) {
      issues.push(issue("TJ_LEDGER_CHAIN_V1_SUPERSEDES", `entries[journalId=${journalId}]`,
        `v1 条目的 supersedesEntryId 必须为 null（entryId=${first.entryId}）`));
    }
    for (let i = 1; i < sorted.length; i += 1) {
      const current = sorted[i]!;
      const previous = sorted[i - 1]!;
      if (current.supersedesEntryId !== previous.entryId) {
        issues.push(issue("TJ_LEDGER_CHAIN_BROKEN", `entries[journalId=${journalId}]`,
          `修订链断裂：版本 ${current.entryVersion}（entryId=${current.entryId}）的 supersedesEntryId=${String(current.supersedesEntryId)}` +
          ` 不等于前一版本 entryId=${previous.entryId}。账本 append-only：禁止插入 / 删除 / 重排历史版本`));
      }
    }
  }

  return issues;
}

/** 轻量结构校验（复用 validate 的 assert 语义，返回 issue 而非抛错）。 */
function validateEntryLight(entry: unknown): ResearchValidationIssue[] {
  try {
    assertValidTradeJournalEntry(entry);
    return [];
  } catch (error) {
    if (error instanceof TradeJournalError) {
      // assert 抛出的是拼好行的单条 issue 形态；为结构化，这里做尽力拆分。
      return [{ code: error.code, path: "entry", message: error.message }];
    }
    return [{ code: "TJ_ENTRY_INVALID", path: "entry", message: String((error as Error).message) }];
  }
}

/** 轻量结构校验（PostReviewRecord）。 */
function validateReviewLight(review: unknown): ResearchValidationIssue[] {
  try {
    assertValidPostReviewRecord(review);
    return [];
  } catch (error) {
    if (error instanceof TradeJournalError) {
      return [{ code: error.code, path: "review", message: error.message }];
    }
    return [{ code: "TJ_REVIEW_INVALID", path: "review", message: String((error as Error).message) }];
  }
}

// ---------------------------------------------------------------------------
// 账本快照 round-trip
// ---------------------------------------------------------------------------

/** 序列化账本快照（canonical JSON；拒绝 NaN/Infinity）。 */
export function serializeTradeJournalLedgerSnapshot(snapshot: JournalLedgerSnapshot): string {
  assertFiniteRecord(snapshot, "ledgerSnapshot");
  return canonicalStringify(snapshot);
}

/**
 * 反序列化账本快照：整体内容校验（结构 + 指纹 + supersedes 链）任一步失败即抛错，
 * 绝不返回被篡改 / 断链的账本。
 */
export function deserializeTradeJournalLedgerSnapshot(json: string): JournalLedgerSnapshot {
  const parsed = parseTopLevelObject(json, "账本快照");
  const entries = parsed.entries;
  const reviews = parsed.reviews;
  if (!Array.isArray(entries)) {
    throw new TradeJournalError(TJ_ERROR_CODES.LEDGER_INVALID, "账本快照反序列化失败：entries 必须是数组");
  }
  if (!Array.isArray(reviews)) {
    throw new TradeJournalError(TJ_ERROR_CODES.LEDGER_INVALID, "账本快照反序列化失败：reviews 必须是数组");
  }
  const issues = verifyTradeJournalLedgerContent(
    entries as unknown as TradeJournalEntry[],
    reviews as unknown as PostReviewRecord[]
  );
  if (issues.length > 0) {
    const lines = issues.map((i) => `  [${i.code}] ${i.path}: ${i.message}`).join("\n");
    throw new TradeJournalError(TJ_ERROR_CODES.LEDGER_INVALID, `账本快照校验失败（append-only 断链/篡改检出）：\n${lines}`);
  }
  return {
    entries: entries as unknown as TradeJournalEntry[],
    reviews: reviews as unknown as PostReviewRecord[],
  };
}
