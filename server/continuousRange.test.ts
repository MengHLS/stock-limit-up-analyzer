import { describe, expect, it } from "vitest";
import {
  continuousIndexFromClientX,
  moveContinuousRange,
  resizeContinuousRange,
  snapContinuousRange,
} from "../client/src/lib/continuousRange";

describe("continuous range helpers", () => {
  it("将像素位置连续换算为数据索引", () => {
    expect(continuousIndexFromClientX(50, 0, 100, 101)).toBe(50);
    expect(continuousIndexFromClientX(-10, 0, 100, 101)).toBe(0);
    expect(continuousIndexFromClientX(120, 0, 100, 101)).toBe(100);
  });

  it("移动选区时保持窗口宽度并限制在历史范围内", () => {
    expect(moveContinuousRange({ startIndex: 40, endIndex: 80 }, 10.5, 120)).toEqual({
      startIndex: 50.5,
      endIndex: 90.5,
    });
    expect(moveContinuousRange({ startIndex: 80, endIndex: 119 }, 8, 120)).toEqual({
      startIndex: 80,
      endIndex: 119,
    });
  });

  it("拖动两侧手柄时支持连续范围并在松手后对齐交易日", () => {
    const resized = resizeContinuousRange({ startIndex: 20, endIndex: 80 }, 35.6, "start", 120);
    expect(resized).toEqual({ startIndex: 35.6, endIndex: 80 });
    expect(snapContinuousRange(resized, 120, { startIndex: 30, endIndex: 90 })).toEqual({
      startIndex: 36,
      endIndex: 80,
    });
  });
});
