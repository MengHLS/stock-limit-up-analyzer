/**
 * STEP 7.3 — Retry 与 Quota Stop。
 *
 * 区分：
 *   - Transient（网络超时/5xx/连接重置）：短退避 1s/2.5s/5s，最多 3 次。
 *   - Rate Limit（40203 限频）：等待 60s 后仅再试一次，仍失败 → QUOTA_STOP（立即停止，
 *     不再消耗额度）。
 *   - 其余（授权/配额/数据/未知）：立即失败，不重试。
 * 睡眠可注入，测试用 fake timer，禁止真实等待 60s。
 */

import { BackfillError, classifyProviderError, isRateLimitError, isTransientError } from "./errors";

export type RetryPolicy = {
  /** 瞬态错误的重试退避（ms）。 */
  transientDelaysMs: number[];
  /** 限频错误的长退避（ms）。 */
  rateLimitBackoffMs: number;
  /** 限频错误额外重试次数（默认 1：即等待 60s 后再试一次）。 */
  maxRateLimitRetries: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  transientDelaysMs: [1_000, 2_500, 5_000],
  rateLimitBackoffMs: 60_000,
  maxRateLimitRetries: 1,
};

type Sleeper = (ms: number) => Promise<void>;

const defaultSleeper: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type RetryOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: BackfillError; attempts: number; quotaStopped: boolean };

export interface RetryOptions {
  policy?: RetryPolicy;
  sleep?: Sleeper;
  /** 自定义错误分类（默认 classifyProviderError）。 */
  classify?: (error: unknown) => BackfillError;
}

/**
 * 执行带重试 + 配额停止语义的任务。绝不无限重试。
 */
export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions = {}): Promise<RetryOutcome<T>> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? defaultSleeper;
  const classifyError = options.classify ?? classifyProviderError;

  let attempts = 0;
  let transientFailures = 0;
  let rateLimitRetries = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempts += 1;
    try {
      return { ok: true, value: await task(), attempts };
    } catch (rawError) {
      const error = classifyError(rawError);

      if (isTransientError(error)) {
        const delayIndex = transientFailures;
        transientFailures += 1;
        if (delayIndex < policy.transientDelaysMs.length) {
          await sleep(policy.transientDelaysMs[delayIndex]);
          continue;
        }
        return { ok: false, error, attempts, quotaStopped: false };
      }

      if (isRateLimitError(error)) {
        if (rateLimitRetries < policy.maxRateLimitRetries) {
          rateLimitRetries += 1;
          await sleep(policy.rateLimitBackoffMs);
          continue;
        }
        return { ok: false, error, attempts, quotaStopped: true };
      }

      // 授权 / 配额 / 数据 / 未知：不重试。
      return { ok: false, error, attempts, quotaStopped: false };
    }
  }
}
