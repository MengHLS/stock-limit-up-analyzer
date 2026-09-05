/**
 * STEP 7.3 — Rate Limiter。
 *
 * 明确、集中的限速器，禁止 setTimeout 散落在业务代码。默认生产间隔 6s（保守），
 * 可通过环境变量 TUSHARE_REQUEST_INTERVAL_MS 调整。STEP 7.2 的 3s/5s/10s 仅为
 * 小样本受控 probe，绝不解释为「3 秒无限制」。
 */

export interface RateLimiter {
  /** 等待直到允许下一次请求。 */
  wait(): Promise<void>;
}

/** 默认最小请求间隔（ms）。 */
export const DEFAULT_REQUEST_INTERVAL_MS = 6_000;

/** 从环境变量读取请求间隔（非法/缺失时回退默认值）。 */
export function resolveRequestIntervalMs(env = process.env): number {
  const raw = env.TUSHARE_REQUEST_INTERVAL_MS;
  if (raw === undefined || raw === "") return DEFAULT_REQUEST_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_REQUEST_INTERVAL_MS;
}

type Clock = () => number;
type Sleeper = (ms: number) => Promise<void>;

const defaultClock: Clock = () => Date.now();
const defaultSleeper: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 固定最小间隔限速器：保证任意两次 `wait()` 返回之间至少间隔 minIntervalMs。
 * 时钟与睡眠可注入，便于测试用 fake timer / 手动时钟验证间隔强制。
 */
export class IntervalRateLimiter implements RateLimiter {
  private readonly minIntervalMs: number;
  private readonly now: Clock;
  private readonly sleep: Sleeper;
  private last: number;

  constructor(
    minIntervalMs: number,
    options: { now?: Clock; sleep?: Sleeper } = {},
  ) {
    this.minIntervalMs = Math.max(0, minIntervalMs);
    this.now = options.now ?? defaultClock;
    this.sleep = options.sleep ?? defaultSleeper;
    this.last = -Infinity;
  }

  async wait(): Promise<void> {
    const now = this.now();
    const remaining = this.last + this.minIntervalMs - now;
    if (remaining > 0) {
      await this.sleep(remaining);
    }
    this.last = this.now();
  }
}

/** 空限速器（测试 / dry-run 用）。 */
export class NoopRateLimiter implements RateLimiter {
  async wait(): Promise<void> {}
}
