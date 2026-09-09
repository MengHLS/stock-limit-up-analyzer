/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录：结构化错误（稳定 code，FAIL FAST）。
 *
 * 铁律：任何非法输入 / 字段缺失 / 时间序颠倒（actual 早于 planned）/ 账本断链 /
 * 篡改 → 抛 TradeJournalError（稳定 code），绝不静默丢记录 / 静默回退 / 猜默认值。
 */

/** 稳定错误码表（禁止硬编码错误字符串散落各处）。 */
export const TJ_ERROR_CODES = {
  // ---- 通用输入 ----
  INPUT_INVALID: "TJ_INPUT_INVALID",
  // ---- 时间序（PIT） ----
  TIME_ORDER_INVERTED: "TJ_TIME_ORDER_INVERTED",
  ANNOTATION_TIME_BEFORE_TRADE: "TJ_ANNOTATION_TIME_BEFORE_TRADE",
  RECORD_TIME_BEFORE_TRADE: "TJ_RECORD_TIME_BEFORE_TRADE",
  // ---- reconcile ----
  RECONCILE_MISMATCH: "TJ_RECONCILE_MISMATCH",
  // ---- 结构与指纹 ----
  ENTRY_INVALID: "TJ_ENTRY_INVALID",
  ENTRY_FINGERPRINT_MISMATCH: "TJ_ENTRY_FINGERPRINT_MISMATCH",
  REVIEW_INVALID: "TJ_REVIEW_INVALID",
  REVIEW_FINGERPRINT_MISMATCH: "TJ_REVIEW_FINGERPRINT_MISMATCH",
  SERIALIZE_NON_FINITE: "TJ_SERIALIZE_NON_FINITE",
  // ---- ledger（append-only） ----
  LEDGER_ENTRY_EXISTS: "TJ_LEDGER_ENTRY_EXISTS",
  LEDGER_REVIEW_EXISTS: "TJ_LEDGER_REVIEW_EXISTS",
  LEDGER_VERSION_REGRESSION: "TJ_LEDGER_VERSION_REGRESSION",
  LEDGER_CHAIN_BROKEN: "TJ_LEDGER_CHAIN_BROKEN",
  LEDGER_ENTRY_NOT_FOUND: "TJ_LEDGER_ENTRY_NOT_FOUND",
  LEDGER_REVIEW_NOT_FOUND: "TJ_LEDGER_REVIEW_NOT_FOUND",
  LEDGER_INVALID: "TJ_LEDGER_INVALID",
  // ---- drafts（从 C-23.2 run 提取） ----
  DRAFTS_RUN_INVALID: "TJ_DRAFTS_RUN_INVALID",
  DRAFTS_RUN_FINGERPRINT_MISMATCH: "TJ_DRAFTS_RUN_FINGERPRINT_MISMATCH",
  DRAFTS_RUN_INCONSISTENT: "TJ_DRAFTS_RUN_INCONSISTENT",
  DRAFTS_ID_COLLISION: "TJ_DRAFTS_ID_COLLISION",
} as const;

export type TJErrorCode = (typeof TJ_ERROR_CODES)[keyof typeof TJ_ERROR_CODES];

/** Trade Journal 结构化错误（稳定 code + 中文信息）。 */
export class TradeJournalError extends Error {
  readonly code: TJErrorCode;

  constructor(code: TJErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "TradeJournalError";
    this.code = code;
  }
}
