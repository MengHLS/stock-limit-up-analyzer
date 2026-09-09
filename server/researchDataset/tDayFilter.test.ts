/**
 * STEP 12.6 — Research Dataset：T 日条件过滤纯函数测试（无 IO）。
 */

import { describe, expect, it } from "vitest";
import {
  isRowLimitUp,
  limitUpRatioForRow,
  matchesTDayCondition,
} from "./tDayFilter";
import type { ResearchDatasetRow, TDayCondition } from "./types";

function rowLike(overrides: Partial<Pick<ResearchDatasetRow, "code" | "st" | "close" | "preClose">> = {}): {
  code: string | null;
  st: "NORMAL" | "ST" | "*ST" | "UNKNOWN";
  close: number | null;
  preClose: number | null;
} {
  return {
    code: "600000.SH",
    st: "NORMAL",
    close: 11,
    preClose: 10,
    ...overrides,
  };
}

describe("limitUpRatioForRow", () => {
  it("主板 10%、创业板/科创板 20%、北交所 30%、ST 主板 5%", () => {
    expect(limitUpRatioForRow(rowLike({ code: "600000.SH", st: "NORMAL" }))).toBe(0.1);
    expect(limitUpRatioForRow(rowLike({ code: "000001.SZ", st: "NORMAL" }))).toBe(0.1);
    expect(limitUpRatioForRow(rowLike({ code: "300001.SZ", st: "NORMAL" }))).toBe(0.2);
    expect(limitUpRatioForRow(rowLike({ code: "688001.SH", st: "NORMAL" }))).toBe(0.2);
    expect(limitUpRatioForRow(rowLike({ code: "920001.BJ", st: "NORMAL" }))).toBe(0.3);
    expect(limitUpRatioForRow(rowLike({ code: "600000.SH", st: "ST" }))).toBe(0.05);
    expect(limitUpRatioForRow(rowLike({ code: "600000.SH", st: "*ST" }))).toBe(0.05);
  });

  it("unknown 板块 / 无代码 → null（不可判，不伪造）", () => {
    expect(limitUpRatioForRow(rowLike({ code: null }))).toBeNull();
    expect(limitUpRatioForRow(rowLike({ code: "999999.SH" }))).toBeNull();
  });
});

describe("isRowLimitUp", () => {
  it("close ≥ 涨停价 → 涨停（主板 10%）", () => {
    expect(isRowLimitUp(rowLike({ code: "600000.SH", st: "NORMAL", close: 11, preClose: 10 }))).toBe(true);
    expect(isRowLimitUp(rowLike({ code: "600000.SH", st: "NORMAL", close: 10.99, preClose: 10 }))).toBe(false);
  });

  it("ST 主板按 5% 判定", () => {
    expect(isRowLimitUp(rowLike({ code: "600000.SH", st: "ST", close: 10.5, preClose: 10 }))).toBe(true);
    expect(isRowLimitUp(rowLike({ code: "600000.SH", st: "ST", close: 10.4, preClose: 10 }))).toBe(false);
  });

  it("价格缺失 / 板块不可判 → false（保守不入选）", () => {
    expect(isRowLimitUp(rowLike({ close: null }))).toBe(false);
    expect(isRowLimitUp(rowLike({ preClose: null }))).toBe(false);
    expect(isRowLimitUp(rowLike({ preClose: 0 }))).toBe(false);
    expect(isRowLimitUp(rowLike({ code: "999999.SH", close: 11, preClose: 10 }))).toBe(false);
  });
});

describe("matchesTDayCondition", () => {
  const cases: { condition: TDayCondition; limitUp: boolean; prev: boolean | null; want: boolean }[] = [
    // none：无条件，恒真
    { condition: "none", limitUp: false, prev: null, want: true },
    { condition: "none", limitUp: true, prev: true, want: true },
    // limitUp：只看 T 日涨停
    { condition: "limitUp", limitUp: true, prev: true, want: true },
    { condition: "limitUp", limitUp: false, prev: null, want: false },
    // firstBoard：T 日涨停且 T-1 未涨停（无前日/窗口首日视为「非连板」→ 首板）
    { condition: "firstBoard", limitUp: true, prev: null, want: true },
    { condition: "firstBoard", limitUp: true, prev: false, want: true },
    { condition: "firstBoard", limitUp: true, prev: true, want: false },
    { condition: "firstBoard", limitUp: false, prev: null, want: false },
    // consecutiveBoard：T 日涨停且 T-1 也涨停
    { condition: "consecutiveBoard", limitUp: true, prev: true, want: true },
    { condition: "consecutiveBoard", limitUp: true, prev: null, want: false },
    { condition: "consecutiveBoard", limitUp: true, prev: false, want: false },
  ];

  it("四种口径判定表（首板/连板按 T-1 涨停状态区分）", () => {
    for (const c of cases) {
      expect(matchesTDayCondition(c.condition, c.limitUp, c.prev)).toBe(c.want);
    }
  });
});
