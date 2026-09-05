/**
 * STEP 7.3 — Retry / Quota Stop 测试（§12 / §34.E-F）。
 *
 * 不真实等待 60s：注入 mock sleep 记录等待时长。
 */

import { describe, expect, it } from "vitest";
import { BackfillError } from "./errors";
import { withRetry } from "./retry";

function sleepRecording() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe("withRetry — 成功路径", () => {
  it("首次成功，无重试", async () => {
    const r = sleepRecording();
    let calls = 0;
    const outcome = await withRetry(async () => {
      calls += 1;
      return "ok";
    }, { sleep: r.sleep });
    expect(outcome.ok).toBe(true);
    expect(calls).toBe(1);
    expect(r.waits).toEqual([]);
  });
});

describe("withRetry — 瞬态重试（1s/2.5s/5s，最多 3 次）", () => {
  it("瞬态失败一次后成功", async () => {
    const r = sleepRecording();
    let calls = 0;
    const outcome = await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed: timeout");
      return "ok";
    }, { sleep: r.sleep });
    expect(outcome.ok).toBe(true);
    expect(calls).toBe(2);
    expect(r.waits).toEqual([1000]);
  });

  it("瞬态连续失败 3 次后放弃（等待 1s/2.5s/5s）", async () => {
    const r = sleepRecording();
    let calls = 0;
    const outcome = await withRetry(async () => {
      calls += 1;
      throw new Error("HTTP 503");
    }, { sleep: r.sleep });
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(4); // 1 + 3 次重试
    expect(r.waits).toEqual([1000, 2500, 5000]);
  });
});

describe("withRetry — 限频 60s 一次 + QUOTA_STOP", () => {
  it("限频一次后成功（等待 60s 一次）", async () => {
    const r = sleepRecording();
    let calls = 0;
    const outcome = await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw new Error("每分钟最多访问该接口（40203）");
      return "ok";
    }, { sleep: r.sleep });
    expect(outcome.ok).toBe(true);
    expect(calls).toBe(2);
    expect(r.waits).toEqual([60_000]);
  });

  it("限频两次 → QUOTA_STOP（不再无限重试）", async () => {
    const r = sleepRecording();
    let calls = 0;
    const outcome = await withRetry(async () => {
      calls += 1;
      throw new Error("频率超限（40203）");
    }, { sleep: r.sleep });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.quotaStopped).toBe(true);
    expect(calls).toBe(2); // 1 + 1 次限频重试
    expect(r.waits).toEqual([60_000]);
  });
});

describe("withRetry — 授权/未知错误不重试", () => {
  it("授权错误立即失败", async () => {
    const r = sleepRecording();
    let calls = 0;
    const outcome = await withRetry(async () => {
      calls += 1;
      throw new BackfillError("AUTHORIZATION", "token 无效");
    }, { sleep: r.sleep });
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(1);
    expect(r.waits).toEqual([]);
  });

  it("未知错误立即失败", async () => {
    const r = sleepRecording();
    let calls = 0;
    const outcome = await withRetry(async () => {
      calls += 1;
      throw new Error("weird");
    }, { sleep: r.sleep });
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(1);
  });
});
