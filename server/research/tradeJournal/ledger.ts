/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录：in-memory append-only 日志账本（可选容器）。
 *
 * 用途：给未来 runner / 复盘 UI / C-24.2 一个「日志条目与复盘记录的唯一入口」示例容器。
 * 范式对齐 C-21.1 `StrategyLifecycleLedger` / C-19.2 `OosIsolationLedger`（纯内存、无 DB、无 IO）。
 *
 * 账本语义（append-only）：
 *   - 一条 TradeJournalEntry 一旦落账不可改（entryId 全局唯一，重复 append 拒绝）；
 *   - 修订（如人工标注、信息更正）= bump 新版本（entryVersion+1）挂 supersedes 链
 *     （supersedesEntryId → 前一版本 entryId），历史版本永不改写——对齐 lifecycle
 *     「Retired 复活 = bump 新版本」哲学；
 *   - append 时校验：结构 + 指纹（防篡改）+ supersedes 链衔接 + 版本严格递增；
 *   - PostReviewRecord 同样 append-only（reviewId 唯一）。
 *
 * 设计纪律：
 *   - 纯内存、无 DB、无 IO；进程内隔离，不做持久化（持久化属未来 DB 层职责）；
 *   - 存取的永远是深拷贝（structuredClone），绝不把内部对象引用交给调用方改写；
 *   - 确定性：list() 按 journalId/entryVersion 升序返回；失败响亮（稳定 code）。
 */

import type { PostReviewRecord, TradeJournalEntry } from "./types";
import {
  TJ_ERROR_CODES,
  TradeJournalError,
} from "./errors";
import {
  computePostReviewRecordFingerprint,
  computeTradeJournalEntryFingerprint,
  deserializeTradeJournalLedgerSnapshot,
  serializeTradeJournalLedgerSnapshot,
  type JournalLedgerSnapshot,
} from "./serialize";
import { assertValidPostReviewRecord, assertValidTradeJournalEntry } from "./validate";

export class TradeJournalLedger {
  /** entryId → 条目（所有 journalId 的所有版本；append-only）。 */
  private readonly entries = new Map<string, TradeJournalEntry>();
  /** reviewId → 复盘记录。 */
  private readonly reviews = new Map<string, PostReviewRecord>();

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  hasEntry(entryId: string): boolean {
    return this.entries.has(entryId);
  }

  hasJournal(journalId: string): boolean {
    return Array.from(this.entries.values()).some((entry) => entry.journalId === journalId);
  }

  hasReview(reviewId: string): boolean {
    return this.reviews.has(reviewId);
  }

  /** 取单条条目（深拷贝；未知 entryId 抛错）。 */
  getEntry(entryId: string): TradeJournalEntry {
    const raw = this.entries.get(entryId);
    if (raw === undefined) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.LEDGER_ENTRY_NOT_FOUND,
        `日志账本：entryId ${entryId} 无记录`
      );
    }
    return structuredClone(raw);
  }

  /** 取某 journalId 的最新（最高版本）条目；无记录抛错。 */
  getLatestEntry(journalId: string): TradeJournalEntry {
    const group = this.journalHistory(journalId);
    const latest = group[group.length - 1];
    if (latest === undefined) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.LEDGER_ENTRY_NOT_FOUND,
        `日志账本：journalId ${journalId} 无任何版本记录`
      );
    }
    return structuredClone(latest);
  }

  /** 取某 journalId 的完整修订史（按 entryVersion 升序；深拷贝）。 */
  journalHistory(journalId: string): TradeJournalEntry[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.journalId === journalId)
      .sort((a, b) => a.entryVersion - b.entryVersion)
      .map((entry) => structuredClone(entry));
  }

  /** 列出全部条目（按 journalId 字典序 + entryVersion 升序；深拷贝）。 */
  listEntries(): TradeJournalEntry[] {
    return Array.from(this.entries.values())
      .sort((a, b) =>
        a.journalId !== b.journalId
          ? a.journalId.localeCompare(b.journalId)
          : a.entryVersion - b.entryVersion
      )
      .map((entry) => structuredClone(entry));
  }

  /** 列出全部复盘记录（按 reviewId 字典序；深拷贝）。 */
  listReviews(): PostReviewRecord[] {
    return Array.from(this.reviews.keys())
      .sort()
      .map((id) => structuredClone(this.reviews.get(id) as PostReviewRecord));
  }

  getReview(reviewId: string): PostReviewRecord {
    const raw = this.reviews.get(reviewId);
    if (raw === undefined) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.LEDGER_REVIEW_NOT_FOUND,
        `日志账本：reviewId ${reviewId} 无记录`
      );
    }
    return structuredClone(raw);
  }

  countEntries(): number {
    return this.entries.size;
  }

  countReviews(): number {
    return this.reviews.size;
  }

  // -------------------------------------------------------------------------
  // append-only 写入
  // -------------------------------------------------------------------------

  /**
   * 落账一条日志条目（append-only）。
   * 校验：结构 + 指纹 + 版本链（首次 v1 / 后续严格递增衔接 supersedes）。
   * 失败（重复 entryId / 版本回退 / 断链 / 篡改）时账本保持原状并抛稳定 code。
   */
  appendEntry(entry: TradeJournalEntry): TradeJournalEntry {
    assertValidTradeJournalEntry(entry);
    const recomputed = computeTradeJournalEntryFingerprint(entry);
    if (entry.fingerprint !== recomputed) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.ENTRY_FINGERPRINT_MISMATCH,
        `日志账本：条目 ${entry.entryId} 指纹不匹配（期望 ${recomputed}，实际 ${entry.fingerprint}），拒绝落账`
      );
    }
    if (this.entries.has(entry.entryId)) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.LEDGER_ENTRY_EXISTS,
        `日志账本：entryId ${entry.entryId} 已存在，禁止重复落账（append-only，entryId 不可复用）`
      );
    }
    const history = this.journalHistory(entry.journalId);
    const latest = history[history.length - 1];
    if (latest === undefined) {
      // 该 journalId 首次落账：必须是 v1 且无 supersedes。
      if (entry.entryVersion !== 1) {
        throw new TradeJournalError(
          TJ_ERROR_CODES.LEDGER_CHAIN_BROKEN,
          `日志账本：journalId ${entry.journalId} 尚无任何版本，新条目必须是 v1（收到 v${entry.entryVersion}）`
        );
      }
      if (entry.supersedesEntryId !== null) {
        throw new TradeJournalError(
          TJ_ERROR_CODES.LEDGER_CHAIN_BROKEN,
          `日志账本：journalId ${entry.journalId} 的 v1 条目 supersedesEntryId 必须为 null`
        );
      }
    } else {
      if (entry.entryVersion <= latest.entryVersion) {
        throw new TradeJournalError(
          TJ_ERROR_CODES.LEDGER_VERSION_REGRESSION,
          `日志账本：journalId ${entry.journalId} 已有 v${latest.entryVersion}，` +
            `拒绝 v${entry.entryVersion}（版本必须严格递增，历史不可改写/回退）`
        );
      }
      if (entry.entryVersion !== latest.entryVersion + 1) {
        throw new TradeJournalError(
          TJ_ERROR_CODES.LEDGER_CHAIN_BROKEN,
          `日志账本：journalId ${entry.journalId} 修订版本必须连续（期望 v${latest.entryVersion + 1}，收到 v${entry.entryVersion}）`
        );
      }
      if (entry.supersedesEntryId !== latest.entryId) {
        throw new TradeJournalError(
          TJ_ERROR_CODES.LEDGER_CHAIN_BROKEN,
          `日志账本：修订链断裂——条目 ${entry.entryId} 的 supersedesEntryId=${String(entry.supersedesEntryId)}` +
            ` 不等于该 journalId 最新版本 entryId=${latest.entryId}`
        );
      }
    }
    this.entries.set(entry.entryId, structuredClone(entry));
    return structuredClone(entry);
  }

  /**
   * 落账一条复盘记录（append-only）。reviewId 重复 / 结构非法 / 指纹不符 → 拒绝。
   */
  appendReview(review: PostReviewRecord): PostReviewRecord {
    assertValidPostReviewRecord(review);
    const recomputed = computePostReviewRecordFingerprint(review);
    if (review.fingerprint !== recomputed) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.REVIEW_FINGERPRINT_MISMATCH,
        `日志账本：复盘 ${review.reviewId} 指纹不匹配（期望 ${recomputed}，实际 ${review.fingerprint}），拒绝落账`
      );
    }
    if (this.reviews.has(review.reviewId)) {
      throw new TradeJournalError(
        TJ_ERROR_CODES.LEDGER_REVIEW_EXISTS,
        `日志账本：reviewId ${review.reviewId} 已存在，禁止重复落账（append-only）`
      );
    }
    this.reviews.set(review.reviewId, structuredClone(review));
    return structuredClone(review);
  }

  // -------------------------------------------------------------------------
  // 快照 / round-trip（断链检测）
  // -------------------------------------------------------------------------

  /** 账本快照（确定性有序数组）。 */
  toSnapshot(): JournalLedgerSnapshot {
    return {
      entries: this.listEntries(),
      reviews: this.listReviews(),
    };
  }

  /** 序列化账本（canonical JSON；含全部条目与复盘记录）。 */
  serialize(): string {
    return serializeTradeJournalLedgerSnapshot(this.toSnapshot());
  }

  /**
   * 从 JSON 还原账本：整体校验（逐条结构 + 指纹 + supersedes 链）通过才重建。
   * 任一条篡改 / 断链 → 抛 TradeJournalError（LEDGER_INVALID），不返回半残缺账本。
   */
  static deserialize(json: string): TradeJournalLedger {
    const snapshot = deserializeTradeJournalLedgerSnapshot(json);
    const ledger = new TradeJournalLedger();
    for (const entry of snapshot.entries) {
      ledger.entries.set(entry.entryId, structuredClone(entry));
    }
    for (const review of snapshot.reviews) {
      ledger.reviews.set(review.reviewId, structuredClone(review));
    }
    return ledger;
  }
}
