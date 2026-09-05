/**
 * STEP 7.3 — Rate Limiter 测试（§11 / §34.D）。
 */

import { describe, expect, it } from "vitest";
import { IntervalRateLimiter, NoopRateLimiter, resolveRequestIntervalMs } from "./rateLimiter";

describe("resolveRequestIntervalMs", () => {
  it("环境变量缺失 → 默认 6000", () => {
    expect(resolveRequestIntervalMs({})).toBe(6000);
  });
  it("环境变量合法 → 使用其值", () => {
    expect(resolveRequestIntervalMs({ TUSHARE_REQUEST_INTERVAL_MS: "1000" })).toBe(1000);
  });
  it("环境变量非法 → 回退默认", () => {
    expect(resolveRequestIntervalMs({ TUSHARE_REQUEST_INTERVAL_MS: "abc" })).toBe(6000);
  });
});

describe("IntervalRateLimiter（间隔强制）", () => {
  it("第一次 wait 不等待，后续在间隔内等待", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new IntervalRateLimiter(6000, {
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });

    await limiter.wait(); // t=0，不等待
    expect(slept).toEqual([]);

    await limiter.wait(); // 立即再 wait，应等待 6000
    expect(slept).toEqual([6000]);
  });

  it("间隔已过则不再等待", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new IntervalRateLimiter(6000, {
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });

    await limiter.wait(); // t=0
    now += 10_000; // 时间前进 10s
    await limiter.wait(); // 已过间隔，不等待
    expect(slept).toEqual([]);
  });

  it("负间隔被钳制为 0（不等待）", async () => {
    const limiter = new IntervalRateLimiter(-5, { now: () => 0, sleep: async () => {} });
    await limiter.wait();
    await limiter.wait();
  });
});

describe("NoopRateLimiter", () => {
  it("永不等待", async () => {
    const limiter = new NoopRateLimiter();
    await limiter.wait();
    await limiter.wait();
  });
});
