/**
 * RESEARCH-EXPERIMENT-001 — 独立研究实验体系：领域错误。
 *
 * 纪律（对齐 `server/research/strategyCandidate/router.ts#withDomainCode` 与
 * `server/researchEngine/errors.ts`）：
 *   - 领域码是**稳定机器可读**的（`EXPERIMENT_ERROR_CODES` 闭集，定义在 shared 契约里）；
 *   - 跨 tRPC 边界时把领域码写进 message（`[CODE] …`）—— `toTrpcError` 不带 `cause`，
 *     消费端（`client/src/adapters/*#readRpcDomainCode`）只认这一套协议；
 *   - **不吞错**：Runner 捕获后既落 `error`，也把事实如实返回给调用方。
 */

import { EXPERIMENT_ERROR_CODES, type ExperimentErrorCode } from "@shared/researchExperimentsContracts";

export { EXPERIMENT_ERROR_CODES };
export type { ExperimentErrorCode };

/** 领域错误。`detail` 只放可序列化的诊断信息（会随执行结果下发给前端）。 */
export class ExperimentError extends Error {
  readonly code: ExperimentErrorCode;
  readonly detail: unknown;

  constructor(code: ExperimentErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "ExperimentError";
    this.code = code;
    this.detail = detail;
  }
}

/** 断言辅助：条件不成立即抛领域错误（不返回 undefined 让调用方猜）。 */
export function experimentAssert(
  condition: unknown,
  code: ExperimentErrorCode,
  message: string,
  detail?: unknown,
): asserts condition {
  if (!condition) {
    throw new ExperimentError(code, message, detail);
  }
}

/** 把任意抛出物归一成领域错误（未知异常 → `EXPERIMENT_RUN_FAILED`）。 */
export function toExperimentError(error: unknown): ExperimentError {
  if (error instanceof ExperimentError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ExperimentError("EXPERIMENT_RUN_FAILED", message, {
    rawName: error instanceof Error ? error.name : typeof error,
  });
}
