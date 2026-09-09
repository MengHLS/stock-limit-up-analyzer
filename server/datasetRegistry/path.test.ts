/**
 * STEP DATASET-001 — path + outcome 构建测试（§16 交易日历 relative_day + 反泄漏）。
 */

import { describe, expect, it } from "vitest";
import {
  buildOutcomeRow,
  buildOutcomeRows,
  buildPathRow,
  buildPathRows,
  firstBreakoutRelativeDay,
  type EventReference,
  type RelativeBar,
} from "./path";

const ref: EventReference = { eventClose: 10, eventHigh: 11, eventVolume: 1000 };

function bar(relativeDay: number, overrides: Partial<RelativeBar> = {}): RelativeBar {
  return {
    relativeDay,
    tradeDate: `D${relativeDay}`,
    open: null,
    high: null,
    low: null,
    close: null,
    volume: null,
    amount: null,
    turnover: null,
    ...overrides,
  };
}

describe("path: relative_day 收益与回撤", () => {
  it("D+1 上涨：return/high/low 相对事件收盘", () => {
    const row = buildPathRow(1, "e1", "600001.SH", bar(1, { open: 10.5, high: 11.2, low: 10.1, close: 11.0 }), ref, 1);
    expect(row.returnFromEventClose).toBeCloseTo(0.1);
    expect(row.highFromEventClose).toBeCloseTo(0.12);
    expect(row.lowFromEventClose).toBeCloseTo(0.01);
    expect(row.closeFromEventClose).toBeCloseTo(0.1);
    expect(row.pullbackFromEventClose).toBeCloseTo(0.01);
  });

  it("D+2 回踩：pullback 为负（跌破事件收盘）", () => {
    const row = buildPathRow(1, "e1", "600001.SH", bar(2, { high: 10.0, low: 9.6, close: 9.8 }), ref, null);
    expect(row.pullbackFromEventClose).toBeCloseTo(-0.04);
    expect(row.pullbackFromEventHigh).toBeCloseTo(9.6 / 11 - 1);
  });

  it("量比 = volume / eventVolume；缺失/除零 → null", () => {
    expect(buildPathRow(1, "e1", "s", bar(1, { volume: 2000 }), ref, null).volumeRatio).toBeCloseTo(2);
    expect(buildPathRow(1, "e1", "s", bar(1, { volume: null }), ref, null).volumeRatio).toBeNull();
  });

  it("突破前高：high > eventHigh → isBreakout，daysToBreakout = 首个突破日", () => {
    const bars = [
      bar(0, { high: 11.0 }),
      bar(1, { high: 10.8 }),
      bar(2, { high: 11.5 }), // 首个突破
      bar(3, { high: 12.0 }),
    ];
    expect(firstBreakoutRelativeDay(bars, 11)).toBe(2);
    const rows = buildPathRows(1, "e1", "s", bars, ref);
    expect(rows[2]!.isBreakout).toBe(true);
    expect(rows[2]!.daysToBreakout).toBe(2);
    expect(rows[1]!.isBreakout).toBe(false);
  });
});

describe("outcome: 未来结果（研究结果，不进 Signal）", () => {
  it("horizon 5 的最大收益 / 最小收益 / 最大回撤", () => {
    const bars = [
      bar(1, { high: 10.5, low: 9.8, close: 10.0 }),
      bar(2, { high: 12.0, low: 10.5, close: 11.5 }),
      bar(3, { high: 11.8, low: 9.5, close: 9.6 }),
    ];
    const out = buildOutcomeRow(1, "e1", 5, bars, ref);
    expect(out.maxReturn).toBeCloseTo(12.0 / 10 - 1);
    expect(out.minReturn).toBeCloseTo(9.5 / 10 - 1);
    expect(out.maxDrawdown).toBeCloseTo(9.6 / 10 - 1);
  });

  it("多 horizon 产出确定性与唯一 (eventId, horizon)", () => {
    const bars = [bar(1, { high: 11.5, low: 10, close: 11 }), bar(2, { high: 12, low: 10.5, close: 11.8 })];
    const rows = buildOutcomeRows(1, "e1", [5, 10], bars, ref);
    expect(rows.map((r) => r.horizon)).toEqual([5, 10]);
    expect(rows.every((r) => r.eventId === "e1")).toBe(true);
  });

  it("窗口数据缺失 → null（不伪造）", () => {
    const out = buildOutcomeRow(1, "e1", 3, [bar(1, { high: null, low: null, close: null })], ref);
    expect(out.maxReturn).toBeNull();
    expect(out.maxDrawdown).toBeNull();
  });
});
