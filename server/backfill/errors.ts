/**
 * STEP 7.3 — 错误分类。
 *
 * 明确区分瞬态网络 / 限频 / 配额 / 授权 / 数据格式 / 校验 / 持久化错误，
 * 不同错误不同策略。禁止 `catch(error) { retryEverything(); }`。
 */

export type BackfillErrorCode =
  | "TRANSIENT_NETWORK"
  | "RATE_LIMIT"
  | "QUOTA_EXCEEDED"
  | "AUTHORIZATION"
  | "MALFORMED_DATA"
  | "VALIDATION_ERROR"
  | "PERSISTENCE_ERROR"
  | "UNKNOWN";

const BACKFILL_ERROR_NAME = "BackfillError";

/** 分类后的回填错误。 */
export class BackfillError extends Error {
  readonly code: BackfillErrorCode;
  constructor(code: BackfillErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = BACKFILL_ERROR_NAME;
    this.code = code;
  }
}

/** 是否为分类后的回填错误。 */
export function isBackfillError(error: unknown): error is BackfillError {
  return error instanceof Error && error.name === BACKFILL_ERROR_NAME;
}

const RATE_LIMIT_PATTERN = /频率超限|限频|rate\s?limit|每分钟最多访问|访问频率|过于频繁|40203/i;
const QUOTA_PATTERN = /配额|quota|次数已达上限|积分不足|无权限访问该接口|40203/i;
const AUTH_PATTERN = /权限|鉴权|授权|token|unauthorized|forbidden|401|40201|40202/i;
const NETWORK_PATTERN = /network|网络|timeout|超时|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|5\d\d|connect|reset|aborted/i;

/**
 * 将 provider 抛出的原始错误分类为 BackfillError。
 * 注意：Tushare 40203 属于「接口调用频率超限」——既是限频也是配额信号；
 * 按 STEP 7.3 语义归为 RATE_LIMIT，由上层 retry 策略决定是否升级为 QUOTA_STOP。
 * （不再额外暴露 QUOTA_EXCEEDED 于 provider 层，避免同一错误双重分类歧义。）
 */
export function classifyProviderError(error: unknown): BackfillError {
  if (isBackfillError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (RATE_LIMIT_PATTERN.test(message)) {
    return new BackfillError("RATE_LIMIT", `provider 频率限制：${message}`, { cause: error });
  }
  if (AUTH_PATTERN.test(message)) {
    return new BackfillError("AUTHORIZATION", `provider 授权/权限错误：${message}`, { cause: error });
  }
  if (QUOTA_PATTERN.test(message)) {
    return new BackfillError("QUOTA_EXCEEDED", `provider 配额/积分错误：${message}`, { cause: error });
  }
  if (NETWORK_PATTERN.test(message)) {
    return new BackfillError("TRANSIENT_NETWORK", `provider 网络错误：${message}`, { cause: error });
  }
  return new BackfillError("UNKNOWN", `未知 provider 错误：${message}`, { cause: error });
}

/** 是否为瞬态错误（允许短退避重试）。 */
export function isTransientError(error: BackfillError): boolean {
  return error.code === "TRANSIENT_NETWORK";
}

/** 是否为限频错误（触发 60s 长退避，重试一次后仍失败则 QUOTA_STOP）。 */
export function isRateLimitError(error: BackfillError): boolean {
  return error.code === "RATE_LIMIT";
}
