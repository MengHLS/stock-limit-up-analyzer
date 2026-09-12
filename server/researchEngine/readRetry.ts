/**
 * RESEARCH-002 · PERF — 跨境 Dataset 读取的**有界瞬时错误重试**。
 *
 * ## 为什么需要
 *
 * 研究装配是「几十次跨境大查询」的长任务：实测 12 批 × 3 条批量语句 = 36 次大数据量往返，
 * 而跨境链路偶发 `ECONNRESET`（实测 ~14 次运行中出现 1 次）。没有重试时，
 * **一次瞬时重置会让整轮装配作废**（用户已经等了数十秒到数分钟），代价与「慢」等价。
 *
 * ## 语义安全（为什么重试是正确的而非「掩盖错误」）
 *
 *   - 本模块**只用于读**：Dataset 读取层（`datasetRegistry/query.ts`）对研究侧全程只读，
 *     重试一次读操作返回的是同一份数据，不产生任何副作用；
 *   - **只重试瞬时网络/连接类错误**：`ECONNRESET` / `ETIMEDOUT` / `EPIPE` / `PROTOCOL_CONNECTION_LOST`
 *     等；语义错误（表不存在、SQL 非法、参数错误、被取消）**一律不重试，原样抛出**；
 *   - **有界**：默认最多 3 次尝试、退避 300ms → 900ms（总计额外等待 ≤ 1.2s），
 *     绝不无限重试、不在链路真断时把请求挂死；
 *   - **不静默**：每次重试都会打出告警（`onRetry`），重试次数因此是可观测的，
 *     不会把「链路在抖」伪装成「一切正常」。
 *
 * 边界：本模块**不**用于写路径。写操作重试可能造成重复写入，语义由各自的上层负责。
 */

/** 判定为「瞬时、可安全重读」的错误特征。 */
const TRANSIENT_ERROR_PATTERNS: readonly RegExp[] = [
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
  /EHOSTUNREACH/i,
  /ENETUNREACH/i,
  /EAI_AGAIN/i,
  /PROTOCOL_CONNECTION_LOST/i,
  /PROTOCOL_SEQUENCE_TIMEOUT/i,
  /socket hang up/i,
  /connection lost/i,
  /this socket has been ended/i,
  /server has gone away/i,
];

/** 默认最大尝试次数（含首次）。 */
export const DEFAULT_READ_RETRY_ATTEMPTS = 3;

/** 默认退避基数（毫秒）；第 n 次重试等待 `base × 3^(n-1)`。 */
export const DEFAULT_READ_RETRY_BASE_DELAY_MS = 300;

export interface ReadRetryOptions {
  /** 最大尝试次数（含首次）；≤1 表示不重试。 */
  maxAttempts?: number;
  baseDelayMs?: number;
  /** 每次重试前的回调（默认打印告警；传 no-op 可静音，仅测试用）。 */
  onRetry?: (info: { label: string; attempt: number; nextDelayMs: number; error: unknown }) => void;
}

/** 从环境变量读取最大尝试次数（`RESEARCH_READ_RETRY_ATTEMPTS`，默认 3，上限 6）。 */
export function resolveReadRetryAttempts(raw: string | undefined = process.env.RESEARCH_READ_RETRY_ATTEMPTS): number {
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) return Math.min(Math.floor(value), 6);
  return DEFAULT_READ_RETRY_ATTEMPTS;
}

/**
 * 是否为「瞬时、可安全重读」的错误。
 *
 * 会沿 `cause` 链逐层检查：Drizzle 把真实原因包在 `cause` 里（如
 * `DrizzleQueryError: Failed query: select … / cause: Error: read ECONNRESET`），
 * 只看最外层 message 会漏判。
 */
export function isTransientReadError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    const text = `${current.name} ${current.message} ${typeof code === "string" ? code : ""}`;
    if (TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(text))) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 默认告警：重试必须可见（不静默）。 */
function warnRetry(info: { label: string; attempt: number; nextDelayMs: number; error: unknown }): void {
  const message = info.error instanceof Error ? info.error.message : String(info.error);
  console.warn(
    `[ResearchRead] 瞬时读取失败，${info.nextDelayMs}ms 后重试（第 ${info.attempt} 次尝试）：${info.label} —— ${message.slice(0, 200)}`,
  );
}

/**
 * 执行一次**只读**操作，遇瞬时错误有界重试。
 *
 * @param label 人可读的操作名（进告警，便于定位是哪一条读在抖）
 * @param fn 真正发起的读操作（每次尝试都会重新调用，因此不要在其中做副作用）
 */
export async function withReadRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options: ReadRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? resolveReadRetryAttempts()));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_READ_RETRY_BASE_DELAY_MS);
  const onRetry = options.onRetry ?? warnRetry;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientReadError(error)) throw error;
      const nextDelayMs = baseDelayMs * 3 ** (attempt - 1);
      onRetry({ label, attempt, nextDelayMs, error });
      if (nextDelayMs > 0) await delay(nextDelayMs);
    }
  }
}
