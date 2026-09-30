import { describe, expect, it } from "vitest";
import { computeBreadthMetrics } from "../../../server/closedLoopBacktestRun/breadthMetrics";

const CALENDAR = [
  "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05",
  "2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12",
];

function trade(securityId: string, entryTime: string, exitTime: string | null) {
  return { securityId, entryTime, exitTime };
}

describe("computeBreadthMetrics", () => {
  it("截断的成交明细一律返回 null（绝不低报重复）", () => {
    const metrics = computeBreadthMetrics({
      trades: [trade("sec_a::pool:002805.SZ@2023-06-30", "2024-01-02", "2024-01-03")],
      tradingDates: CALENDAR,
      tradesTruncated: true,
    });
    expect(metrics.tradedInstrumentCount).toBeNull();
    expect(metrics.repeatTradeRatioPct).toBeNull();
    expect(metrics.longestReentryChainLength).toBeNull();
  });

  it("无成交时全 null", () => {
    const metrics = computeBreadthMetrics({ trades: [], tradingDates: CALENDAR, tradesTruncated: false });
    expect(metrics.tradedInstrumentCount).toBeNull();
    expect(metrics.maxTradesPerInstrument).toBeNull();
  });

  it("按底层代码去重，而不是按池身份", () => {
    const metrics = computeBreadthMetrics({
      trades: [
        trade("sec_a::pool:002805.SZ@2023-06-30", "2024-01-02", "2024-01-05"),
        trade("sec_b::pool:002805.SZ@2023-10-20", "2024-01-08", "2024-01-10"),
        trade("sec_c::pool:600000.SH@2024-01-01", "2024-01-03", "2024-01-05"),
      ],
      tradingDates: CALENDAR,
      tradesTruncated: false,
    });
    expect(metrics.tradedInstrumentCount).toBe(2);
    expect(metrics.tradedIdentityCount).toBe(3);
    expect(metrics.repeatTradeCount).toBe(1);
    expect(metrics.maxTradesPerInstrument).toBe(2);
  });

  it("再入场间隔按交易日计数（跨周末 1 个交易日）", () => {
    const metrics = computeBreadthMetrics({
      trades: [
        trade("sec_a::pool:002805.SZ@2023-06-30", "2024-01-04", "2024-01-05"),
        trade("sec_a::pool:002805.SZ@2023-06-30", "2024-01-08", "2024-01-10"),
      ],
      tradingDates: CALENDAR,
      tradesTruncated: false,
    });
    expect(metrics.immediateReentryCount).toBe(1);
    expect(metrics.medianReentryGapTradingDays).toBe(1);
    expect(metrics.maxReentryGapTradingDays).toBe(1);
  });

  it("链长与链内成交占比：出场次日买回连续 3 笔即入链", () => {
    const metrics = computeBreadthMetrics({
      trades: [
        trade("sec_a::pool:002805.SZ@2023-06-30", "2024-01-02", "2024-01-03"),
        trade("sec_a::pool:002805.SZ@2023-06-30", "2024-01-04", "2024-01-05"),
        trade("sec_a::pool:002805.SZ@2023-06-30", "2024-01-08", "2024-01-09"),
        trade("sec_b::pool:600000.SH@2024-01-01", "2024-01-02", "2024-01-03"),
      ],
      tradingDates: CALENDAR,
      tradesTruncated: false,
    });
    expect(metrics.immediateReentryCount).toBe(2);
    expect(metrics.longestReentryChainLength).toBe(3);
    expect(metrics.chainTradeRatioPct).toBe(75);
  });

  it("同代码并行持仓对数（并行区间有交集）", () => {
    const metrics = computeBreadthMetrics({
      trades: [
        trade("sec_a::pool:002805.SZ@2023-06-30", "2024-01-02", "2024-01-11"),
        trade("sec_b::pool:002805.SZ@2023-10-20", "2024-01-02", "2024-01-11"),
        trade("sec_c::pool:002805.SZ@2024-01-05", "2024-01-09", "2024-01-10"),
      ],
      tradingDates: CALENDAR,
      tradesTruncated: false,
    });
    expect(metrics.sameCodeOverlapPairCount).toBe(3);
  });

  it("解析不到的纯 canonical 身份按自身计数，不误合并", () => {
    const metrics = computeBreadthMetrics({
      trades: [
        trade("sec_aaa", "2024-01-02", "2024-01-03"),
        trade("sec_bbb", "2024-01-04", "2024-01-05"),
      ],
      tradingDates: CALENDAR,
      tradesTruncated: false,
    });
    expect(metrics.tradedInstrumentCount).toBe(2);
  });
});
