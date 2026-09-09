import { describe, expect, it } from "vitest";
import {
  buildWindowBars,
  computeMa5FromFacts,
  screenFirstBoardRow,
  screenPullback,
  screenSingleTarget,
} from "./pullback";
import type { FirstBoardEvent, WindowBar } from "./pullback";
import type { CanonicalMarketBar } from "../data/types";

function event(partial: Partial<FirstBoardEvent>): FirstBoardEvent {
  return {
    securityCode: "600001.SH",
    eventDate: "2026-01-06",
    t0Open: 11.0,
    t0Low: 10.9,
    t0Close: 11.0,
    preClose: 10.5,
    limitPrice: 11.55,
    board: "main",
    ma5: 10.8,
    ...partial,
  };
}

function bar(partial: Partial<CanonicalMarketBar> & { symbol: string; timestamp: string }): CanonicalMarketBar {
  return {
    open: null,
    high: null,
    low: null,
    close: null,
    preClose: null,
    volume: null,
    amount: null,
    turnoverRate: null,
    adjustment: "raw",
    ...partial,
  };
}

describe("screenSingleTarget（触及且不破）", () => {
  it("最低价回踩到目标位上方容差带内 → 命中", () => {
    const e = event({ limitPrice: 10.0 });
    const window = [
      { tradeDate: "2026-01-07", low: 10.1 },
      { tradeDate: "2026-01-08", low: 10.0 },
      { tradeDate: "2026-01-09", low: 10.3 },
    ];
    const result = screenSingleTarget(e, window, "limitPrice", 2);
    expect(result.hit).toBe(true);
    expect(result.hitLow).toBe(10.0);
    expect(result.hitDate).toBe("2026-01-08");
    expect(result.broken).toBe(false);
  });

  it("跌破目标位 → 失败（broken）", () => {
    const e = event({ limitPrice: 10.0 });
    const window = [
      { tradeDate: "2026-01-07", low: 10.1 },
      { tradeDate: "2026-01-08", low: 9.8 },
    ];
    const result = screenSingleTarget(e, window, "limitPrice", 2);
    expect(result.hit).toBe(false);
    expect(result.broken).toBe(true);
  });

  it("未回踩（最低价远高于目标位）→ 不命中", () => {
    const e = event({ limitPrice: 10.0 });
    const window = [
      { tradeDate: "2026-01-07", low: 10.5 },
      { tradeDate: "2026-01-08", low: 10.8 },
    ];
    const result = screenSingleTarget(e, window, "limitPrice", 2);
    expect(result.hit).toBe(false);
    expect(result.broken).toBe(false);
  });

  it("目标位数据缺失 → 不可判定", () => {
    const e = event({ limitPrice: null });
    const result = screenSingleTarget(e, [], "limitPrice", 2);
    expect(result.targetPrice).toBeNull();
    expect(result.hit).toBe(false);
  });
});

describe("screenPullback（多目标位）", () => {
  it("对每个目标位分别判定并支持任一命中", () => {
    const e = event({ limitPrice: 10.0, t0Low: 10.9, ma5: 10.8 });
    const window = [
      { tradeDate: "2026-01-07", low: 10.0 },
      { tradeDate: "2026-01-08", low: 10.2 },
    ];
    const results = screenPullback(e, window, ["limitPrice", "t0Low", "ma5"], 2);
    expect(results).toHaveLength(3);
    const byType = new Map(results.map((r) => [r.targetType, r]));
    expect(byType.get("limitPrice")!.hit).toBe(true);
    expect(byType.get("t0Low")!.broken).toBe(true);
    expect(byType.get("ma5")!.broken).toBe(true);
  });
});

describe("computeMa5FromFacts", () => {
  const calendar = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"];
  const makeFacts = (closes: Array<[string, number]>) => {
    const m = new Map<string, Map<string, CanonicalMarketBar>>();
    for (const [date, close] of closes) {
      const byCode = m.get(date) ?? new Map<string, CanonicalMarketBar>();
      byCode.set("600001.SH", bar({ symbol: "600001.SH", timestamp: date, close, preClose: close - 0.1 }));
      m.set(date, byCode);
    }
    return m;
  };

  it("含 T0 的最近 5 日收盘均值", () => {
    const facts = makeFacts([
      ["2026-01-01", 10],
      ["2026-01-02", 10.2],
      ["2026-01-05", 10.4],
      ["2026-01-06", 10.6],
      ["2026-01-07", 10.8],
    ]);
    expect(computeMa5FromFacts("600001.SH", "2026-01-07", facts, calendar)).toBeCloseTo(10.4, 5);
  });

  it("不足 5 日返回 null", () => {
    const facts = makeFacts([
      ["2026-01-05", 10.4],
      ["2026-01-06", 10.6],
      ["2026-01-07", 10.8],
    ]);
    expect(computeMa5FromFacts("600001.SH", "2026-01-07", facts, calendar)).toBeNull();
  });
});

describe("buildWindowBars", () => {
  const calendar = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
  it("取 T0 之后 N 个交易日", () => {
    const facts = new Map<string, Map<string, CanonicalMarketBar>>();
    for (const [date, low] of [
      ["2026-01-07", 10.1],
      ["2026-01-08", 10.0],
      ["2026-01-09", 10.2],
    ] as Array<[string, number]>) {
      const byCode = new Map<string, CanonicalMarketBar>();
      byCode.set("600001.SH", bar({ symbol: "600001.SH", timestamp: date, low }));
      facts.set(date, byCode);
    }
    const bars: WindowBar[] = buildWindowBars("600001.SH", "2026-01-06", facts, calendar, 3);
    expect(bars.map((b) => b.tradeDate)).toEqual(["2026-01-07", "2026-01-08", "2026-01-09"]);
    expect(bars.map((b) => b.low)).toEqual([10.1, 10.0, 10.2]);
  });
});

describe("screenFirstBoardRow（通用回踩筛选）", () => {
  const calendar = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];

  it("首板后回踩到涨停价容差带内（触及且不破）→ matched", () => {
    const facts = new Map<string, Map<string, CanonicalMarketBar>>();
    // 仅回踩窗口（T+1/T+2）与 T0 需要数据；MA5 因前 5 日不足返回 null，不影响 limitPrice 目标。
    const bars: Array<[string, number, number, number]> = [
      ["2026-01-06", 11.55, 10.5, 11.0], // T0 close=11.55, preClose=10.5 → limitPrice 11.55
      ["2026-01-07", 11.80, 11.55, 11.80], // T+1 low 11.80
      ["2026-01-08", 11.58, 11.80, 11.58], // T+2 low 11.58（回踩到涨停价附近）
    ];
    for (const [date, close, preClose, low] of bars) {
      const byCode = facts.get(date) ?? new Map<string, CanonicalMarketBar>();
      byCode.set("600001.SH", bar({ symbol: "600001.SH", timestamp: date, close, preClose, low, open: close, high: close }));
      facts.set(date, byCode);
    }
    const row = {
      code: "600001.SH",
      tradeDate: "2026-01-06",
      open: 11.0,
      high: 11.55,
      low: 11.0,
      close: 11.55,
      preClose: 10.5,
    };
    const verdict = screenFirstBoardRow(row, facts, calendar, {
      targetTypes: ["limitPrice"],
      tolerancePercent: 5,
      observationWindowDays: 2,
    });
    expect(verdict.windowComplete).toBe(true);
    expect(verdict.matched).toBe(true);
    expect(verdict.results[0]!.hit).toBe(true);
    expect(verdict.results[0]!.hitLow).toBe(11.58);
  });

  it("窗口缺交易日 → 不完整，保守排除", () => {
    const facts = new Map<string, Map<string, CanonicalMarketBar>>();
    // 只有 T+1 有数据，T+2 缺失
    const byCode = new Map<string, CanonicalMarketBar>();
    byCode.set("600001.SH", bar({ symbol: "600001.SH", timestamp: "2026-01-07", low: 11.0, close: 11.0, preClose: 11.55 }));
    facts.set("2026-01-07", byCode);
    const row = {
      code: "600001.SH",
      tradeDate: "2026-01-06",
      open: 11.0,
      high: 11.55,
      low: 11.0,
      close: 11.55,
      preClose: 10.5,
    };
    const verdict = screenFirstBoardRow(row, facts, calendar, {
      targetTypes: ["limitPrice"],
      tolerancePercent: 5,
      observationWindowDays: 2,
    });
    expect(verdict.windowComplete).toBe(false);
    expect(verdict.matched).toBe(false);
  });
});
