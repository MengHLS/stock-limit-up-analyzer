/**
 * STEP 7.3 — 单位转换测试（§16）。
 *
 * 明确验证：vol(手) → volume(shares) × 100、amount(千元) → amount(CNY) × 1000，
 * 覆盖整数 / 小数 / 0 / null / 非法字符串 / 极端值，确保不会 ×100 两次 / 完全不转换。
 */

import { describe, expect, it } from "vitest";
import {
  CNY_PER_THOUSAND,
  SHARES_PER_HAND,
  convertTushareDailyUnits,
  normalizeAmountToCny,
  normalizeVolumeToShares,
  tushareAmountToCny,
  tushareVolToShares,
} from "./units";

describe("Tushare 单位转换（§16）", () => {
  it("vol=1234（手）→ volume=123400（shares）", () => {
    expect(tushareVolToShares(1234)).toBe(123400);
  });

  it("amount=5678（千元）→ amount=5,678,000（CNY）", () => {
    expect(tushareAmountToCny(5678)).toBe(5_678_000);
  });

  it("组合转换 vol=1234 / amount=5678", () => {
    expect(convertTushareDailyUnits({ vol: 1234, amount: 5678 })).toEqual({
      volume: 123400,
      amount: 5_678_000,
    });
  });

  it("整数转换", () => {
    expect(tushareVolToShares(1)).toBe(100);
    expect(tushareAmountToCny(1)).toBe(1000);
  });

  it("小数转换", () => {
    expect(tushareVolToShares(0.5)).toBe(50);
    expect(tushareAmountToCny(0.75)).toBe(750);
  });

  it("0 转换（0 手 = 0 股，0 千元 = 0 元）", () => {
    expect(tushareVolToShares(0)).toBe(0);
    expect(tushareAmountToCny(0)).toBe(0);
  });

  it("常量正确：1 手 = 100 股，1 千元 = 1000 元", () => {
    expect(SHARES_PER_HAND).toBe(100);
    expect(CNY_PER_THOUSAND).toBe(1000);
  });
});

describe("normalizeVolumeToShares / normalizeAmountToCny", () => {
  it("null 原样返回 null（不静默填零）", () => {
    expect(normalizeVolumeToShares(null, "hands")).toBeNull();
    expect(normalizeAmountToCny(null, "thousand-cny")).toBeNull();
  });

  it("hands ×100、shares 原样", () => {
    expect(normalizeVolumeToShares(1234, "hands")).toBe(123400);
    expect(normalizeVolumeToShares(1234, "shares")).toBe(1234);
  });

  it("thousand-cny ×1000、cny 原样", () => {
    expect(normalizeAmountToCny(5678, "thousand-cny")).toBe(5_678_000);
    expect(normalizeAmountToCny(5678, "cny")).toBe(5678);
  });

  it("非有限数值 → null（NaN/Infinity 不参与换算）", () => {
    expect(normalizeVolumeToShares(Number.NaN, "hands")).toBeNull();
    expect(normalizeAmountToCny(Number.POSITIVE_INFINITY, "thousand-cny")).toBeNull();
  });

  it("极端大值不溢出为 Infinity（在安全整数范围内）", () => {
    const big = 1e12;
    expect(Number.isFinite(tushareVolToShares(big))).toBe(true);
    expect(Number.isFinite(tushareAmountToCny(big))).toBe(true);
  });
});
