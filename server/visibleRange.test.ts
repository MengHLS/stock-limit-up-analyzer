import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBLE_TRADING_DAYS,
  getDefaultVisibleRange,
  normalizeVisibleRange,
} from "../client/src/lib/visibleRange";

describe("visible range helpers", () => {
  it("默认选择最近90个交易日", () => {
    expect(DEFAULT_VISIBLE_TRADING_DAYS).toBe(90);
    expect(getDefaultVisibleRange(179)).toEqual({ startIndex: 89, endIndex: 178 });
  });

  it("交易日不足90天时展示全部数据", () => {
    expect(getDefaultVisibleRange(42)).toEqual({ startIndex: 0, endIndex: 41 });
    expect(getDefaultVisibleRange(0)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it("将拖动范围限制在有效索引内并保持起止顺序", () => {
    const fallback = { startIndex: 20, endIndex: 109 };
    expect(normalizeVisibleRange({ startIndex: -3, endIndex: 999 }, 110, fallback)).toEqual({
      startIndex: 0,
      endIndex: 109,
    });
    expect(normalizeVisibleRange({ startIndex: 90, endIndex: 20 }, 110, fallback)).toEqual({
      startIndex: 90,
      endIndex: 90,
    });
  });
});
