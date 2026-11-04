/**
 * STEP 7.3 — 单位转换测试（§16）。
 *
 * 明确验证：vol(手) → volume(shares) × 100、amount(千元) → amount(CNY) × 1000，
 * 覆盖整数 / 小数 / 0 / null / 非法字符串 / 极端值，确保不会 ×100 两次 / 完全不转换。
 */

import { describe, expect, it } from "vitest";
import {
  CNY_PER_THOUSAND,
  HANDS_PER_SHARE,
  SHARES_PER_HAND,
  THOUSAND_CNY_PER_CNY,
  baostockAmountToThousandCny,
  baostockVolToHands,
  convertBaostockDailyUnits,
  convertTushareDailyUnits,
  normalizeAmountToCny,
  normalizeBaostockAmountToThousandCny,
  normalizeBaostockVolumeToHands,
  normalizeVolumeToShares,
  tushareAmountToCny,
  tushareVolToShares,
} from "../../../server/backfill/units";

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


describe("BaoStock daily 单位换算（股→手、元→千元）", () => {
  it("常量：1 股 = 0.01 手，1 元 = 0.001 千元", () => {
    expect(HANDS_PER_SHARE).toBe(0.01);
    expect(THOUSAND_CNY_PER_CNY).toBe(0.001);
  });

  it("股→手：×0.01（sh.600000 2026-09-30 volume=147484820 股 → 1474848.2 手）", () => {
    expect(baostockVolToHands(147_484_820)).toBeCloseTo(1_474_848.2, 6);
  });

  it("元→千元：×0.001（amount=1386209937.38 元 → 1386209.93738 千元）", () => {
    expect(baostockAmountToThousandCny(1_386_209_937.38)).toBeCloseTo(1_386_209.93738, 4);
  });

  it("0 与整数", () => {
    expect(baostockVolToHands(0)).toBe(0);
    expect(baostockAmountToThousandCny(1000)).toBe(1);
  });

  it("方向正确：100 股 = 1 手（绝不 ×100 两次）", () => {
    expect(baostockVolToHands(100)).toBe(1);
    expect(baostockAmountToThousandCny(1000)).toBe(1);
  });

  it("null / 非有限 → null（不静默填零）", () => {
    expect(normalizeBaostockVolumeToHands(null)).toBeNull();
    expect(normalizeBaostockVolumeToHands(Number.NaN)).toBeNull();
    expect(normalizeBaostockAmountToThousandCny(null)).toBeNull();
    expect(normalizeBaostockAmountToThousandCny(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("convertBaostockDailyUnits 组合换算", () => {
    const out = convertBaostockDailyUnits({ volume: 80_509_739, amount: 739_740_988.48 });
    expect(out.volume).toBeCloseTo(805_097.39, 4);
    expect(out.amount).toBeCloseTo(739_740.98848, 4);
  });
});