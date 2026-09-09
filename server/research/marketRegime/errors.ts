/**
 * STEP 22 / C-22.1 — Market Regime：错误类型（单一事实来源）。
 *
 * 与 performanceMetrics/PerformanceEvaluationError 同哲学：失败响亮、带稳定机器码，
 * 便于调用方按 code 分类处理（而不是靠字符串匹配中文错误消息）。
 */

/** regime 分析错误码（稳定机器码）。 */
export type RegimeErrorCode =
  | "REGIME_INVALID_DATE"
  | "REGIME_INVALID_PARAMETER"
  | "REGIME_INVALID_SERIES"
  | "REGIME_SERIES_NOT_ORDERED"
  | "REGIME_ASOF_NOT_AVAILABLE"
  | "REGIME_ASOF_INVARIANT_VIOLATION"
  | "REGIME_LOOKAHEAD_VIOLATION"
  | "REGIME_CONFIG_INVALID"
  | "REGIME_RECORD_INVALID"
  | "REGIME_FINGERPRINT_MISMATCH"
  | "REGIME_NON_FINITE_NUMBER";

/** regime 分析错误（确定性、无 IO）。 */
export class RegimeAnalysisError extends Error {
  /** 稳定机器码。 */
  readonly code: RegimeErrorCode;

  constructor(code: RegimeErrorCode, message: string) {
    super(message);
    this.name = "RegimeAnalysisError";
    this.code = code;
  }
}

/** 递归检查非有限数字；发现即抛错（绝不静默把 NaN 写成 null）。 */
export function assertRegimeFiniteRecord(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RegimeAnalysisError(
        "REGIME_NON_FINITE_NUMBER",
        `marketRegime: 拒绝含非有限数字 ${String(value)}（${path}）；regime 记录禁止 NaN / Infinity`,
      );
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertRegimeFiniteRecord(item, `${path}[${index}]`));
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    assertRegimeFiniteRecord(child, path === "" ? key : `${path}.${key}`);
  }
}
