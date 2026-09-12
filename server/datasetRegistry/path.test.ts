/**
 * STEP DATASET-001 / DATABASE_REDESIGN §3.3 — path + outcome 构建测试
 * （交易日历 relative_day、反泄漏、原始/衍生分层、参考价单源与 null 语义）。
 */

import { describe, expect, it } from "vitest";
import {
  buildDerivedRow,
  buildDerivedRows,
  buildOutcomeRow,
  buildOutcomeRows,
  buildRawBars,
  eventReferenceFrom,
  firstBreakoutRelativeDay,
  partitionRawBars,
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
    ...overrides,
  };
}

describe("eventReferenceFrom: 事件参考价单源（C1/C2）", () => {
  it("从 relativeDay = 0 行提取 close / high / volume", () => {
    const bars = [bar(-1, { close: 9 }), bar(0, { close: 10, high: 11, volume: 1000 }), bar(1, { close: 12 })];
    expect(eventReferenceFrom(bars)).toEqual({ eventClose: 10, eventHigh: 11, eventVolume: 1000 });
  });

  it("无 relativeDay = 0 行 → null（不产出任何窗口行）", () => {
    expect(eventReferenceFrom([bar(1, { close: 12 })])).toBeNull();
  });

  it("D0 行情缺失时参考价可为 null（禁止 ?? 0 兜底）", () => {
    expect(eventReferenceFrom([bar(0, { close: null, high: null, volume: null })])).toEqual({
      eventClose: null,
      eventHigh: null,
      eventVolume: null,
    });
  });
});

describe("原始行情窗口：prefix / post 同构切分（I1/I10）", () => {
  it("buildRawBars 只含原始列，不含任何衍生列", () => {
    const rows = buildRawBars(7, "e1", "600001.SH", [bar(0, { close: 10, volume: 1000, amount: 1e7 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      datasetVersionId: 7,
      eventId: "e1",
      symbol: "600001.SH",
      tradeDate: "D0",
      relativeDay: 0,
      open: null,
      high: null,
      low: null,
      close: 10,
      volume: 1000,
      amount: 1e7,
    });
    expect(Object.keys(rows[0]!)).not.toContain("isBreakout");
  });

  it("partitionRawBars：relativeDay ≤ 0 → prefix，≥ 1 → post", () => {
    const rows = buildRawBars(7, "e1", "s", [bar(-2), bar(-1), bar(0), bar(1), bar(2)]);
    const { prefix, post } = partitionRawBars(rows);
    expect(prefix.map((r) => r.relativeDay)).toEqual([-2, -1, 0]);
    expect(post.map((r) => r.relativeDay)).toEqual([1, 2]);
  });
});

describe("path: relative_day 衍生量与回撤", () => {
  it("D+1 上涨：high/low/close 相对事件收盘", () => {
    const row = buildDerivedRow(1, "e1", "600001.SH", bar(1, { open: 10.5, high: 11.2, low: 10.1, close: 11.0 }), ref, 1);
    expect(row.highFromEventClose).toBeCloseTo(0.12);
    expect(row.lowFromEventClose).toBeCloseTo(0.01);
    expect(row.closeFromEventClose).toBeCloseTo(0.1);
  });

  it("D+2 回踩：lowFromEventClose 为负（跌破事件收盘），pullbackFromEventHigh 相对事件最高价", () => {
    const row = buildDerivedRow(1, "e1", "600001.SH", bar(2, { high: 10.0, low: 9.6, close: 9.8 }), ref, null);
    expect(row.lowFromEventClose).toBeCloseTo(-0.04);
    expect(row.pullbackFromEventHigh).toBeCloseTo(9.6 / 11 - 1);
  });

  it("量比 = volume / eventVolume；缺失/除零 → null", () => {
    expect(buildDerivedRow(1, "e1", "s", bar(1, { volume: 2000 }), ref, null).volumeRatio).toBeCloseTo(2);
    expect(buildDerivedRow(1, "e1", "s", bar(1, { volume: null }), ref, null).volumeRatio).toBeNull();
  });

  it("参考价缺失 → 全部衍生量为 null（诚实 null，不伪造）", () => {
    const row = buildDerivedRow(
      1,
      "e1",
      "s",
      bar(1, { high: 11, low: 9, close: 10 }),
      { eventClose: null, eventHigh: null, eventVolume: 1000 },
      null,
    );
    expect(row.closeFromEventClose).toBeNull();
    expect(row.highFromEventClose).toBeNull();
    expect(row.lowFromEventClose).toBeNull();
    expect(row.pullbackFromEventHigh).toBeNull();
    expect(row.isBreakout).toBe(false);
  });

  it("突破前高：high > eventHigh → isBreakout，daysToBreakout = 首个突破日；只产出 rd ≥ 1 行", () => {
    const bars = [
      bar(0, { high: 11.0 }),
      bar(1, { high: 10.8 }),
      bar(2, { high: 11.5 }), // 首个突破
      bar(3, { high: 12.0 }),
    ];
    expect(firstBreakoutRelativeDay(bars, 11)).toBe(2);
    const rows = buildDerivedRows(1, "e1", "s", bars, ref);
    expect(rows.map((r) => r.relativeDay)).toEqual([1, 2, 3]);
    expect(rows[1]!.isBreakout).toBe(true);
    expect(rows[1]!.daysToBreakout).toBe(2);
    expect(rows[0]!.isBreakout).toBe(false);
  });

  it("eventHigh 为 null → 突破判定短路为 null / false（不做假设性比较）", () => {
    expect(firstBreakoutRelativeDay([bar(1, { high: 99 })], null)).toBeNull();
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

  it("参考价缺失 → 全部结果为 null（不产生 0 假值）", () => {
    const out = buildOutcomeRow(1, "e1", 3, [bar(1, { high: 12, low: 9, close: 11 })], {
      eventClose: null,
      eventHigh: null,
      eventVolume: null,
    });
    expect(out.maxReturn).toBeNull();
    expect(out.minReturn).toBeNull();
    expect(out.maxDrawdown).toBeNull();
  });
});
