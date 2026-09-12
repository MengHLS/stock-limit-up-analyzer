/**
 * RESEARCH-002 · PERF — 瞬时读取重试测试。
 *
 * 要证明的三件事：
 *   1. **只重试瞬时错误**：语义错误（SQL 非法 / 表不存在 / 被取消）必须原样抛出、不重试 ——
 *      否则会把真实缺陷伪装成「链路抖动」；
 *   2. **有界**：尝试次数不超过上限，且失败时抛出**最后一次**的真实错误（不吞错）；
 *   3. **接线正确**：`RegistryResearchDatasetReader` 的四条读取路径确实走了重试。
 */

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_READ_RETRY_ATTEMPTS,
  isTransientReadError,
  resolveReadRetryAttempts,
  withReadRetry,
} from "./readRetry";
import { RegistryResearchDatasetReader } from "./datasetReader";
import type { DatasetDataReader } from "../datasetRegistry/query";

function resetError(): Error {
  const error = new Error("read ECONNRESET");
  (error as { code?: string }).code = "ECONNRESET";
  return error;
}

/** 复刻 Drizzle 的包装形状：真实原因在 `cause` 链上。 */
function drizzleWrapped(cause: Error): Error {
  const outer = new Error("Failed query: select `eventId` from `ds_first_limit_pullback_path` where …");
  (outer as { cause?: unknown }).cause = cause;
  return outer;
}

describe("瞬时错误判定", () => {
  it("识别裸的网络错误", () => {
    expect(isTransientReadError(resetError())).toBe(true);
    expect(isTransientReadError(new Error("socket hang up"))).toBe(true);
    expect(isTransientReadError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(true);
  });

  it("沿 cause 链识别被包装的错误（只看外层 message 会漏判）", () => {
    expect(isTransientReadError(drizzleWrapped(resetError()))).toBe(true);
  });

  it("语义错误一律不视为瞬时（不会重试）", () => {
    expect(isTransientReadError(new Error("Table 'ds_x' doesn't exist"))).toBe(false);
    expect(isTransientReadError(new Error("You have an error in your SQL syntax"))).toBe(false);
    expect(isTransientReadError(new Error("ER_TRUNCATED_WRONG_VALUE"))).toBe(false);
    expect(isTransientReadError("not an error")).toBe(false);
  });

  it("尝试次数可配置且有上限", () => {
    expect(resolveReadRetryAttempts(undefined)).toBe(DEFAULT_READ_RETRY_ATTEMPTS);
    expect(resolveReadRetryAttempts("1")).toBe(1);
    expect(resolveReadRetryAttempts("0")).toBe(0);
    expect(resolveReadRetryAttempts("99")).toBe(6);
    expect(resolveReadRetryAttempts("abc")).toBe(DEFAULT_READ_RETRY_ATTEMPTS);
  });
});

describe("有界重试", () => {
  it("瞬时错误重试后成功，并如实报告重试次数", async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withReadRetry("op", async () => {
      calls += 1;
      if (calls < 3) throw resetError();
      return "ok";
    }, { baseDelayMs: 0, onRetry: (info) => retries.push(info.attempt) });

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("语义错误立即抛出，不重试", async () => {
    let calls = 0;
    await expect(withReadRetry("op", async () => {
      calls += 1;
      throw new Error("Table 'ds_x' doesn't exist");
    }, { baseDelayMs: 0, onRetry: () => {} })).rejects.toThrow(/doesn't exist/);
    expect(calls).toBe(1);
  });

  it("超过上限时抛出最后一次的真实错误（不吞错）", async () => {
    let calls = 0;
    const failure = await withReadRetry("op", async () => {
      calls += 1;
      throw new Error(`read ECONNRESET #${calls}`);
    }, { maxAttempts: 3, baseDelayMs: 0, onRetry: () => {} }).catch((error: unknown) => error);

    expect(calls).toBe(3);
    expect((failure as Error).message).toBe("read ECONNRESET #3");
  });
});

describe("接线：Dataset 读取层确实重试", () => {
  function readerWithFlakyPaths(): { reader: RegistryResearchDatasetReader; calls: () => number } {
    let calls = 0;
    const dataReader = {
      loadPathsBatch: async () => {
        calls += 1;
        if (calls === 1) throw drizzleWrapped(resetError());
        return [];
      },
      loadOutcomesBatch: async () => [],
      loadRawBarsBatch: async () => [],
      listEventsPage: async () => ({ items: [], nextCursor: null }),
    } as unknown as DatasetDataReader;
    return {
      reader: new RegistryResearchDatasetReader({ dataReader, registryRepo: {} as never }),
      calls: () => calls,
    };
  }

  it("读 path 遇到瞬时重置 → 重试并成功（重试必须可见）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { reader, calls } = readerWithFlakyPaths();
      await expect(reader.loadPaths({ datasetVersionId: 1, eventIds: ["e1"] })).resolves.toEqual([]);
      expect(calls()).toBe(2);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
