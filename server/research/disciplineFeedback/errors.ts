/**
 * STEP 24 / C-24.2 — 纪律反馈分析：结构化错误（稳定 code，FAIL FAST）。
 *
 * 铁律：任何非法输入 / 字段缺失 / 时间序颠倒 / 账本指纹不符 / 未知环境挂接 →
 * 抛 DisciplineFeedbackError（稳定 code），绝不静默丢数据、绝不用空集合冒充结论。
 */

/** 稳定错误码表（禁止硬编码错误字符串散落各处）。 */
export const DFA_ERROR_CODES = {
  // ---- 通用输入 ----
  INPUT_INVALID: "DFA_INPUT_INVALID",
  // ---- 日期 ----
  DATE_INVALID: "DFA_DATE_INVALID",
  // ---- entry / 账本 ----
  ENTRY_INVALID: "DFA_ENTRY_INVALID",
  ENTRY_FINGERPRINT_MISMATCH: "DFA_ENTRY_FINGERPRINT_MISMATCH",
  ENTRY_DUPLICATE_AMBIGUOUS: "DFA_ENTRY_DUPLICATE_AMBIGUOUS",
  // ---- 环境挂接 ----
  ASSIGNMENT_UNKNOWN_JOURNAL: "DFA_ASSIGNMENT_UNKNOWN_JOURNAL",
  ASSIGNMENT_INVALID: "DFA_ASSIGNMENT_INVALID",
  // ---- 配置 ----
  CONFIG_INVALID: "DFA_CONFIG_INVALID",
  // ---- 记录结构/指纹 ----
  RUN_INVALID: "DFA_RUN_INVALID",
  RUN_FINGERPRINT_MISMATCH: "DFA_RUN_FINGERPRINT_MISMATCH",
  RUN_ID_MISSING: "DFA_RUN_ID_MISSING",
  CREATED_AT_INVALID: "DFA_CREATED_AT_INVALID",
} as const;

export type DfaErrorCode = (typeof DFA_ERROR_CODES)[keyof typeof DFA_ERROR_CODES];

/** 纪律反馈分析结构化错误（稳定 code + 中文信息）。 */
export class DisciplineFeedbackError extends Error {
  readonly code: DfaErrorCode;

  constructor(code: DfaErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DisciplineFeedbackError";
    this.code = code;
  }
}
