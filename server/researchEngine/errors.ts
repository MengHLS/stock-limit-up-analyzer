/**
 * RESEARCH-002 — Research Engine 错误类型与稳定错误码。
 *
 * 纪律：
 *   - 错误码是**机器可读 + 稳定**的（落 `research_run.errorCode`），不得随手改字符串；
 *   - 失败必须**具名 + 可定位**，禁止用 `throw new Error("failed")` 吞掉上游语义；
 *   - 引擎失败时 Run 必须进入 FAILED 并保存 errorCode / errorMessage（指令 §4）。
 */

import type { ResearchEngineErrorCode } from "./types";

export class ResearchEngineError extends Error {
  readonly code: ResearchEngineErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(code: ResearchEngineErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ResearchEngineError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** 断言辅助：条件不满足即抛具名错误。 */
export function engineAssert(
  condition: unknown,
  code: ResearchEngineErrorCode,
  message: string,
  detail?: Record<string, unknown>,
): asserts condition {
  if (!condition) throw new ResearchEngineError(code, message, detail);
}

/** 把任意异常归一化为 ResearchEngineError（保留原始信息，不吞错）。 */
export function toResearchEngineError(error: unknown): ResearchEngineError {
  if (error instanceof ResearchEngineError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ResearchEngineError("INTERNAL_ERROR", message);
}
