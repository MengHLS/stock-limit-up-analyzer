/** P8 · 晚窗口滚动 3F 纯计算测试。 */
import { describe, expect, it } from "vitest";
import {
  LATE_ENTRY_WINDOW_BARS,
  computeLateEntryScore,
} from "../../../../server/research/recipeFeatures/lateEntryScoreFeatures";

function bars(closes: readonly number[]) {
  return closes.map((close, index) => {
    const half = close * 0.005;
    return {
      symbol: "TEST",
      timestamp: "2026-04-" + String(index + 1).padStart(2, "0"),
      open: close,
      high: close + half,
      low: close - half,
      close,
      preClose: close,
      volume: 1_000_000,
      amount: close * 1_000_000,
      turnoverRate: null,
      adjustment: "raw" as const,
    };
  });
}

describe("LateEntry3F", () => {
  it("固定 6 根 bar 可计算滚动 3F 分", () => {
    expect(LATE_ENTRY_WINDOW_BARS).toBe(6);
    const score = computeLateEntryScore(bars([10, 9.8, 9.7, 9.9, 10.1, 10.2]));
    expect(score).not.toBeNull();
    expect(Number.isFinite(score!.score)).toBe(true);
  });

  it("不足或超过 6 根返回 null，不读取未来数据", () => {
    expect(computeLateEntryScore(bars([10, 9.8, 9.7, 9.9, 10.1]))).toBeNull();
    expect(computeLateEntryScore(bars([10, 9.8, 9.7, 9.9, 10.1, 10.2, 10.3]))).toBeNull();
  });
});
