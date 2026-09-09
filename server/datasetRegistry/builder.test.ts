/**
 * STEP DATASET-001 — Builder 测试（§38.7 Idempotency / §38.8 Resume / §38.4 Version Isolation）。
 *
 * 用注入式内存 IO 验证 chunk/游标/批插/checkpoint/幂等/续跑，不依赖真实 DB。
 */

import { describe, expect, it } from "vitest";
import { FirstLimitPullbackDatasetBuilder } from "./builder";
import type { DatasetBuildIO, LiquidityEnrichment } from "./builder";
import type { DailyBar, StStatus } from "./detection";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
} from "./types";

// ---------------------------------------------------------------------------
// 内存 IO（模拟 ON DUPLICATE KEY 幂等去重）
// ---------------------------------------------------------------------------

class MemIO implements DatasetBuildIO {
  tradingDays: string[] = [];
  bars: DailyBar[] = [];
  stBySymbol = new Map<string, StStatus>();
  events: FirstLimitPullbackEvent[] = [];
  paths: FirstLimitPullbackPath[] = [];
  outcomes: FirstLimitPullbackOutcome[] = [];
  insertEventsCalls = 0;
  insertPathsCalls = 0;
  insertOutcomesCalls = 0;

  async loadTradingDays(): Promise<string[]> {
    return [...this.tradingDays];
  }
  async fetchBarsForDay(tradeDate: string): Promise<DailyBar[]> {
    return this.bars.filter((b) => b.tradeDate === tradeDate).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  async resolveSt(symbol: string): Promise<StStatus> {
    return this.stBySymbol.get(symbol) ?? "NORMAL";
  }
  async fetchSymbolBars(symbol: string, startDate: string, endDate: string): Promise<DailyBar[]> {
    return this.bars
      .filter((b) => b.symbol === symbol && b.tradeDate >= startDate && b.tradeDate <= endDate)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  }
  async fetchBarsRange(startDate: string, endDate: string): Promise<DailyBar[]> {
    return this.bars
      .filter((b) => b.tradeDate >= startDate && b.tradeDate <= endDate)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.symbol.localeCompare(b.symbol));
  }
  async fetchLiquidity(): Promise<LiquidityEnrichment | null> {
    return null;
  }
  async fetchLiquidityForSymbols(): Promise<Map<string, LiquidityEnrichment>> {
    return new Map();
  }
  async fetchIndustry(): Promise<string | null> {
    return null;
  }
  async fetchIndustryForSymbols(): Promise<Map<string, string>> {
    return new Map();
  }
  async listEvents(datasetVersionId: number): Promise<FirstLimitPullbackEvent[]> {
    return this.events.filter((e) => e.datasetVersionId === datasetVersionId).sort((a, b) => a.eventId.localeCompare(b.eventId));
  }
  async insertEvents(rows: FirstLimitPullbackEvent[]): Promise<void> {
    this.insertEventsCalls += 1;
    for (const r of rows) {
      if (!this.events.some((e) => e.datasetVersionId === r.datasetVersionId && e.eventId === r.eventId)) this.events.push(r);
    }
  }
  async insertPaths(rows: FirstLimitPullbackPath[]): Promise<void> {
    this.insertPathsCalls += 1;
    for (const r of rows) {
      if (!this.paths.some((p) => p.datasetVersionId === r.datasetVersionId && p.eventId === r.eventId && p.relativeDay === r.relativeDay)) this.paths.push(r);
    }
  }
  async insertOutcomes(rows: FirstLimitPullbackOutcome[]): Promise<void> {
    this.insertOutcomesCalls += 1;
    for (const r of rows) {
      if (!this.outcomes.some((o) => o.datasetVersionId === r.datasetVersionId && o.eventId === r.eventId && o.horizon === r.horizon)) this.outcomes.push(r);
    }
  }
}

function mkBar(symbol: string, tradeDate: string, close: number, preClose: number, high: number, low: number): DailyBar {
  return { symbol, tradeDate, open: preClose, high, low, close, preClose, volume: 1000, amount: 100000 };
}

/** 构造一个含 2 个首板事件的 fixture（01-02 首板、01-04 首板，01-03 非涨停隔断；含充足前向交易日）。 */
function makeFixture(): { io: MemIO; days: string[] } {
  const io = new MemIO();
  const days = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09", "2024-01-10"];
  io.tradingDays = days;
  // 600001.SH：01-02 涨停(10→11)，01-03 不涨停(11→10.5)，01-04 涨停(10.5→11.55 首板)，之后不涨停
  io.bars.push(
    mkBar("600001.SH", "2024-01-02", 11.0, 10.0, 11.2, 10.8),
    mkBar("600001.SH", "2024-01-03", 10.5, 11.0, 10.9, 10.3),
    mkBar("600001.SH", "2024-01-04", 11.55, 10.5, 11.7, 10.5),
    mkBar("600001.SH", "2024-01-05", 11.6, 11.55, 11.8, 11.2),
    mkBar("600001.SH", "2024-01-08", 11.0, 11.6, 11.3, 10.9),
    mkBar("600001.SH", "2024-01-09", 11.2, 11.0, 11.4, 10.8),
    mkBar("600001.SH", "2024-01-10", 11.3, 11.2, 11.5, 11.0),
  );
  return { io, days };
}

function config(versionId: number) {
  return { datasetVersionId: versionId, startDate: "2024-01-02", endDate: "2024-01-10", pathHorizon: 3, outcomeHorizons: [5, 10], batchSize: 10 };
}

describe("FirstLimitPullbackDatasetBuilder", () => {
  it("完整构建产出 2 个首板事件 + path/outcome", async () => {
    const { io } = makeFixture();
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    const cps: unknown[] = [];
    const result = await builder.build(config(1), async (cp) => { cps.push(cp); });
    expect(result.status).toBe("COMPLETED");
    expect(result.events).toBe(2);
    expect(result.paths).toBe(2 * 4); // 每个事件 relative 0..3 = 4 行
    expect(result.outcomes).toBe(2 * 2); // 每个事件 horizon [5,10] = 2 行
    expect(io.events.filter((e) => e.datasetVersionId === 1).length).toBe(2);
    expect(io.paths.filter((p) => p.datasetVersionId === 1).length).toBe(8);
    expect(io.outcomes.filter((o) => o.datasetVersionId === 1).length).toBe(4);
    // 首板事件日期：01-02 与 01-04
    expect(new Set(io.events.map((e) => e.tradeDate))).toEqual(new Set(["2024-01-02", "2024-01-04"]));
  });

  it("幂等：Build(v1) 重复执行不产生重复行（§38.7）", async () => {
    const { io } = makeFixture();
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    await builder.build(config(1), async () => {});
    const eventsAfter1 = io.events.length;
    const pathsAfter1 = io.paths.length;
    const outcomesAfter1 = io.outcomes.length;
    await builder.build(config(1), async () => {});
    expect(io.events.length).toBe(eventsAfter1);
    expect(io.paths.length).toBe(pathsAfter1);
    expect(io.outcomes.length).toBe(outcomesAfter1);
  });

  it("Resume：从 checkpoint 续跑不重复已完成的 chunk（§38.8）", async () => {
    const { io } = makeFixture();
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    // 模拟：已完成到 01-02（事件已落库），从 01-03 续跑。
    await builder.build(config(1), async () => {});
    const fullEvents = io.events.length;
    // 重新构建，但带一个「已完成 01-03」的 checkpoint（含滚动状态），验证事件不重复且结果一致。
    const resumeCheckpoint = {
      phase: "events" as const,
      lastTradeDate: "2024-01-03",
      lastSymbol: null,
      lastEventId: null,
      processedRows: 0,
      completedChunks: 0,
      prevLimitUp: [] as string[],
      cumulative: { "600001.SH": { previousLimitDate: "2024-01-02", historicalLimitCount: 1 } },
    };
    const io2 = makeFixture().io;
    // 预置已完成的 01-02 事件（模拟 chunk 已完成落库）。
    io2.events.push({
      datasetVersionId: 1, eventId: "600001.SH@2024-01-02", symbol: "600001.SH", tradeDate: "2024-01-02",
      market: "SH", industryCode: null, boardType: "main", open: 10, high: 11.2, low: 10.8, close: 11,
      previousClose: 10, limitUpPrice: 11, volume: 1000, amount: 100000, turnover: null,
      isFirstLimit: true, previousLimitDate: null, daysSincePreviousLimit: null, historicalLimitCount: 0,
      marketCap: null, floatMarketCap: null,
    });
    const builder2 = new FirstLimitPullbackDatasetBuilder(io2);
    await builder2.build({ ...config(1), resumeCheckpoint }, async () => {});
    const eventIds = new Set(io2.events.filter((e) => e.datasetVersionId === 1).map((e) => e.eventId));
    expect(eventIds.size).toBe(2); // 01-02（预置）+ 01-04（续跑新检出），无重复
    expect(eventIds.has("600001.SH@2024-01-04")).toBe(true);
    expect(fullEvents).toBe(2);
  });

  it("Version 隔离：v1 / v2 数据用 datasetVersionId 隔离（§38.4）", async () => {
    const { io } = makeFixture();
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    await builder.build(config(1), async () => {});
    await builder.build(config(2), async () => {});
    const v1Events = io.events.filter((e) => e.datasetVersionId === 1);
    const v2Events = io.events.filter((e) => e.datasetVersionId === 2);
    expect(v1Events.length).toBe(2);
    expect(v2Events.length).toBe(2);
    expect(v1Events.every((e) => e.datasetVersionId === 1)).toBe(true);
    expect(v2Events.every((e) => e.datasetVersionId === 2)).toBe(true);
    expect(io.paths.filter((p) => p.datasetVersionId === 1).length).toBe(8);
    expect(io.paths.filter((p) => p.datasetVersionId === 2).length).toBe(8);
  });

  it("相对交易日用交易日历（周五 D0 → 下周一 D+1，无自然日跳变）", async () => {
    const io = new MemIO();
    // 2024-01-05 是周五；下一个交易日 2024-01-08 是周一。
    io.tradingDays = ["2024-01-05", "2024-01-08", "2024-01-09"];
    io.bars.push(
      mkBar("600001.SH", "2024-01-05", 11.0, 10.0, 11.2, 10.8), // 首板
      mkBar("600001.SH", "2024-01-08", 10.8, 11.0, 11.0, 10.5),
      mkBar("600001.SH", "2024-01-09", 11.2, 10.8, 11.3, 10.7),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    await builder.build({ datasetVersionId: 1, startDate: "2024-01-05", endDate: "2024-01-09", pathHorizon: 2, outcomeHorizons: [5] }, async () => {});
    const path = io.paths.find((p) => p.relativeDay === 1)!;
    expect(path.tradeDate).toBe("2024-01-08"); // D+1 = 下周一，不是 01-06（周六）
  });
});
