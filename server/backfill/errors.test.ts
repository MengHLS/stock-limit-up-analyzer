/**
 * STEP 7.3 — 错误分类测试（§37）。
 */

import { describe, expect, it } from "vitest";
import { BackfillError, classifyProviderError, isRateLimitError, isTransientError } from "./errors";

describe("classifyProviderError", () => {
  it("限频（40203）→ RATE_LIMIT", () => {
    const err = classifyProviderError(new Error("每分钟最多访问该接口 20 次，请稍后再试（40203）"));
    expect(err.code).toBe("RATE_LIMIT");
    expect(isRateLimitError(err)).toBe(true);
  });

  it("网络超时 → TRANSIENT_NETWORK", () => {
    const err = classifyProviderError(new Error("fetch failed: network timeout"));
    expect(err.code).toBe("TRANSIENT_NETWORK");
    expect(isTransientError(err)).toBe(true);
  });

  it("5xx → TRANSIENT_NETWORK", () => {
    expect(classifyProviderError(new Error("HTTP 503")).code).toBe("TRANSIENT_NETWORK");
  });

  it("授权错误 → AUTHORIZATION", () => {
    expect(classifyProviderError(new Error("token 无效，鉴权失败")).code).toBe("AUTHORIZATION");
  });

  it("未知错误 → UNKNOWN", () => {
    expect(classifyProviderError(new Error("something weird")).code).toBe("UNKNOWN");
  });

  it("已分类的 BackfillError 原样返回", () => {
    const err = new BackfillError("RATE_LIMIT", "x");
    expect(classifyProviderError(err)).toBe(err);
  });

  it("非 Error 输入 → UNKNOWN", () => {
    expect(classifyProviderError("plain string")).toBeInstanceOf(BackfillError);
    expect(classifyProviderError("plain string").code).toBe("UNKNOWN");
  });
});
