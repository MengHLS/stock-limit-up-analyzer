/**
 * STEP DATASET-001 — Builder 测试（§38.7 Idempotency / §38.8 Resume / §38.4 Version Isolation）。
 *
 * 用注入式内存 IO 验证 chunk/游标/批插/checkpoint/幂等/续跑，不依赖真实 DB。
 */

import { describe, expect, it } from "vitest";
import { FirstLimitPullbackDatasetBuilder } from "./builder";
import type { DatasetBuildIO, FirstLimitPullbackBuildConfig, LiquidityEnrichment } from "./builder";
import type { DailyBar, StStatus } from "./detection";
import { isLimitUpCandidateBar } from "./detection";
import type {
  DatasetBoard,
  DatasetEventSpec,
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "./types";

// ---------------------------------------------------------------------------
// 内存 IO（模拟 ON DUPLICATE KEY 幂等去重）
// ---------------------------------------------------------------------------

class MemIO implements DatasetBuildIO {
  tradingDays: string[] = [];
  bars: DailyBar[] = [];
  stBySymbol = new Map<string, StStatus>();
  events: FirstLimitPullbackEvent[] = [];
  prefixes: FirstLimitPullbackRawBar[] = [];
  posts: FirstLimitPullbackRawBar[] = [];
  paths: FirstLimitPullbackPath[] = [];
  outcomes: FirstLimitPullbackOutcome[] = [];
  insertEventsCalls = 0;
  insertPrefixCalls = 0;
  insertPostCalls = 0;
  insertPathsCalls = 0;
  insertOutcomesCalls = 0;

  async loadTradingDays(): Promise<string[]> {
    return [...this.tradingDays];
  }
  async loadSecurityIndexes(): Promise<void> {
    // 内存 IO：ST / 行业索引本就是内存 Map，无需预热。
  }
  resolveStSync(symbol: string): StStatus {
    return this.stBySymbol.get(symbol) ?? "NORMAL";
  }
  async resolveSt(symbol: string): Promise<StStatus> {
    return this.resolveStSync(symbol);
  }
  resolveIndustrySync(): string | null {
    return null;
  }
  /**
   * 涨停候选（粗筛超集）：必须与生产 SQL 谓词同语义 —— 复用 `detection.isLimitUpCandidateBar`，
   * 保证「漏判」这类错误在单测里也会暴露（而不是被宽松的 mock 掩盖）。
   */
  async fetchLimitUpCandidateBars(startDate: string, endDate: string): Promise<DailyBar[]> {
    return this.bars
      .filter((b) => b.tradeDate >= startDate && b.tradeDate <= endDate && isLimitUpCandidateBar(b.close, b.preClose))
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.symbol.localeCompare(b.symbol));
  }
  async fetchBarsForSymbolsInRange(symbols: string[], startDate: string, endDate: string): Promise<DailyBar[]> {
    const wanted = new Set(symbols);
    return this.bars
      .filter((b) => wanted.has(b.symbol) && b.tradeDate >= startDate && b.tradeDate <= endDate)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.symbol.localeCompare(b.symbol));
  }
  async fetchLiquidityForSymbolsInRange(): Promise<Map<string, LiquidityEnrichment>> {
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
  private upsertRaw(target: FirstLimitPullbackRawBar[], rows: FirstLimitPullbackRawBar[]): void {
    for (const r of rows) {
      if (!target.some((x) => x.datasetVersionId === r.datasetVersionId && x.eventId === r.eventId && x.relativeDay === r.relativeDay)) target.push(r);
    }
  }
  async insertPrefixes(rows: FirstLimitPullbackRawBar[]): Promise<void> {
    this.insertPrefixCalls += 1;
    this.upsertRaw(this.prefixes, rows);
  }
  async insertPosts(rows: FirstLimitPullbackRawBar[]): Promise<void> {
    this.insertPostCalls += 1;
    this.upsertRaw(this.posts, rows);
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
  return {
    datasetVersionId: versionId,
    startDate: "2024-01-02",
    endDate: "2024-01-10",
    boards: [],
    excludeSt: false,
    events: [{ relativeDay: 0, kind: "firstBoard" as const }],
    preWindowDays: 0,
    postWindowDays: 3,
    outcomeHorizons: [5, 10],
    batchSize: 10,
  };
}

describe("FirstLimitPullbackDatasetBuilder", () => {
  it("完整构建产出 2 个首板事件 + path/outcome", async () => {
    const { io } = makeFixture();
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    const cps: unknown[] = [];
    const result = await builder.build(config(1), async (cp) => { cps.push(cp); });
    expect(result.status).toBe("COMPLETED");
    expect(result.events).toBe(2);
    // 每个事件：prefix 1 行（D0）+ post 3 行（D+1..D+3）+ path 3 行（衍生，只 rd ≥ 1）
    expect(result.prefixes).toBe(2 * 1);
    expect(result.posts).toBe(2 * 3);
    expect(result.paths).toBe(2 * 3);
    expect(result.outcomes).toBe(2 * 2); // 每个事件 horizon [5,10] = 2 行
    expect(io.events.filter((e) => e.datasetVersionId === 1).length).toBe(2);
    expect(io.prefixes.filter((p) => p.datasetVersionId === 1).length).toBe(2);
    expect(io.posts.filter((p) => p.datasetVersionId === 1).length).toBe(6);
    expect(io.paths.filter((p) => p.datasetVersionId === 1).length).toBe(6);
    expect(io.outcomes.filter((o) => o.datasetVersionId === 1).length).toBe(4);
    // 原始行情与衍生量分离：D0 行情在 prefix，path 只含 rd ≥ 1
    expect(io.prefixes.some((p) => p.relativeDay === 0 && p.close !== null)).toBe(true);
    expect(io.paths.every((p) => p.relativeDay >= 1)).toBe(true);
    // 首板事件日期：01-02 与 01-04
    expect(new Set(io.events.map((e) => e.tradeDate))).toEqual(new Set(["2024-01-02", "2024-01-04"]));
  });

  it("幂等：Build(v1) 重复执行不产生重复行（§38.7）", async () => {
    const { io } = makeFixture();
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    await builder.build(config(1), async () => {});
    const eventsAfter1 = io.events.length;
    const prefixesAfter1 = io.prefixes.length;
    const postsAfter1 = io.posts.length;
    const pathsAfter1 = io.paths.length;
    const outcomesAfter1 = io.outcomes.length;
    await builder.build(config(1), async () => {});
    expect(io.events.length).toBe(eventsAfter1);
    expect(io.prefixes.length).toBe(prefixesAfter1);
    expect(io.posts.length).toBe(postsAfter1);
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
    expect(io.prefixes.filter((p) => p.datasetVersionId === 1).length).toBe(2);
    expect(io.paths.filter((p) => p.datasetVersionId === 1).length).toBe(6);
    expect(io.paths.filter((p) => p.datasetVersionId === 2).length).toBe(6);
    expect(io.posts.filter((p) => p.datasetVersionId === 1).length).toBe(6);
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
    await builder.build({
      datasetVersionId: 1,
      startDate: "2024-01-05",
      endDate: "2024-01-09",
      boards: [],
      excludeSt: false,
      events: [{ relativeDay: 0, kind: "firstBoard" as const }],
      preWindowDays: 0,
      postWindowDays: 2,
      outcomeHorizons: [5],
    }, async () => {});
    const path = io.paths.find((p) => p.relativeDay === 1)!;
    expect(path.tradeDate).toBe("2024-01-08"); // D+1 = 下周一，不是 01-06（周六）
  });
});

// ---------------------------------------------------------------------------
// DATASET-003B — 筛选口径在构建中真实生效
// ---------------------------------------------------------------------------

/** 构造一个「筛选可观测」的最小构建配置。 */
function filterConfig(
  versionId: number,
  overrides: {
    startDate?: string;
    endDate?: string;
    boards?: DatasetBoard[];
    excludeSt?: boolean;
    events?: DatasetEventSpec[];
    preWindowDays?: number;
    postWindowDays?: number;
    outcomeHorizons?: number[];
    batchSize?: number;
  } = {},
): FirstLimitPullbackBuildConfig {
  return {
    datasetVersionId: versionId,
    startDate: "2024-01-02",
    endDate: "2024-01-05",
    boards: [],
    excludeSt: false,
    events: [{ relativeDay: 0, kind: "firstBoard" }],
    preWindowDays: 0,
    postWindowDays: 1,
    outcomeHorizons: [5],
    batchSize: 10,
    ...overrides,
  };
}

/** 主板 10% 首板：close = preClose * 1.1 即涨停。 */
function mkLimitUp(symbol: string, tradeDate: string, preClose: number): DailyBar {
  const close = Math.round(preClose * 1.1 * 100) / 100;
  return mkBar(symbol, tradeDate, close, preClose, close, preClose);
}

/** 创业板/科创板 20% 首板。 */
function mkLimitUp20(symbol: string, tradeDate: string, preClose: number): DailyBar {
  const close = Math.round(preClose * 1.2 * 100) / 100;
  return mkBar(symbol, tradeDate, close, preClose, close, preClose);
}

describe("筛选口径真实生效（DATASET-003B）", () => {
  it("板块筛选：只收录所选交易所板块的事件", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    io.bars.push(
      mkLimitUp("600001.SH", "2024-01-02", 10), // 主板首板
      mkBar("600001.SH", "2024-01-03", 11.1, 11, 11.2, 11),
      mkLimitUp20("300001.SZ", "2024-01-02", 10), // 创业板首板
      mkBar("300001.SZ", "2024-01-03", 12.1, 12, 12.2, 12),
      mkLimitUp20("688001.SH", "2024-01-03", 10), // 科创板首板
      mkBar("688001.SH", "2024-01-04", 12.1, 12, 12.2, 12),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);

    // 空数组 = 不过滤 → 3 个板块样本全收
    await builder.build(filterConfig(1), async () => {});
    expect(io.events.filter((e) => e.datasetVersionId === 1).length).toBe(3);

    // 只选创业板 → 仅 300001.SZ
    await builder.build(filterConfig(2, { boards: ["chinext"] }), async () => {});
    const v2 = io.events.filter((e) => e.datasetVersionId === 2);
    expect(v2.map((e) => e.symbol)).toEqual(["300001.SZ"]);
    expect(v2[0]!.boardType).toBe("chinext");

    // 多选「主板 + 科创板」→ 600001.SH 与 688001.SH，排除创业板
    await builder.build(filterConfig(3, { boards: ["main", "star"] }), async () => {});
    const v3 = io.events.filter((e) => e.datasetVersionId === 3);
    expect(new Set(v3.map((e) => e.symbol))).toEqual(new Set(["600001.SH", "688001.SH"]));
    expect(v3.every((e) => e.boardType === "main" || e.boardType === "star")).toBe(true);
  });

  it("排除 ST：excludeSt=true 剔除 PIT 状态为 ST 的事件，false 则保留", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    // 600002.SH 为 ST → 涨停比例 5%（limitUpPrice(10, 0.05) = 10.5）
    io.stBySymbol.set("600002.SH", "ST");
    io.bars.push(
      mkBar("600002.SH", "2024-01-02", 10.5, 10, 10.5, 10), // ST 首板（5%）
      mkBar("600002.SH", "2024-01-03", 10.6, 10.5, 10.7, 10.5),
      mkLimitUp("600001.SH", "2024-01-02", 10), // 普通主板首板
      mkBar("600001.SH", "2024-01-03", 11.1, 11, 11.2, 11),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);

    await builder.build(filterConfig(1, { excludeSt: false }), async () => {});
    expect(io.events.filter((e) => e.datasetVersionId === 1).length).toBe(2);

    await builder.build(filterConfig(2, { excludeSt: true }), async () => {});
    const v2 = io.events.filter((e) => e.datasetVersionId === 2);
    expect(v2.map((e) => e.symbol)).toEqual(["600001.SH"]);
  });

  it("事件维度 = T-1 日首板：事件日 T 当天不涨停也照样收录，且元数据取锚点日口径", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    io.bars.push(
      mkBar("600001.SH", "2024-01-02", 10.2, 10, 10.3, 10), // 不涨停（10.2 < 11）
      mkLimitUp("600001.SH", "2024-01-03", 10.2), // T-1：首板
      mkBar("600001.SH", "2024-01-04", 11.0, 11.22, 11.1, 11.0), // 事件日：不涨停
      mkBar("600001.SH", "2024-01-05", 11.1, 11.0, 11.2, 11.0),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);

    // 对照组：默认 T 日首板 → 事件落在 01-03（证明 01-04 当天确实不涨停）
    await builder.build(filterConfig(1), async () => {});
    const v1 = io.events.filter((e) => e.datasetVersionId === 1);
    expect(v1.map((e) => e.tradeDate)).toEqual(["2024-01-03"]);

    // 实验组：T-1 日首板 → 事件落在 01-04（事件日不涨停仍命中）
    await builder.build(
      filterConfig(2, { events: [{ relativeDay: -1, kind: "firstBoard" }] }),
      async () => {},
    );
    const v2 = io.events.filter((e) => e.datasetVersionId === 2);
    expect(v2).toHaveLength(1);
    expect(v2[0]!.tradeDate).toBe("2024-01-04");
    // 元数据以锚点日（01-03 首板）口径描述，而非事件日（01-04 不涨停）
    expect(v2[0]!.isFirstLimit).toBe(true);
    expect(v2[0]!.previousLimitDate).toBeNull();
    expect(v2[0]!.daysSincePreviousLimit).toBeNull();
    expect(v2[0]!.historicalLimitCount).toBe(0);
  });

  it("事件维度 OR 叠加：T 日首板 ∪ T-1 日连板 = 并集", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    io.bars.push(
      mkLimitUp("600001.SH", "2024-01-02", 10), // 首板
      mkLimitUp("600001.SH", "2024-01-03", 11), // 连板
      mkBar("600001.SH", "2024-01-04", 12.2, 12.1, 12.3, 12.1), // 不涨停
      mkLimitUp("600001.SH", "2024-01-05", 12.2), // 首板（前一日未涨停）
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);

    // 对照 1：仅 T 日首板 → 01-02、01-05（01-03 是连板，不入选）
    await builder.build(filterConfig(1), async () => {});
    expect(io.events.filter((e) => e.datasetVersionId === 1).map((e) => e.tradeDate)).toEqual([
      "2024-01-02", "2024-01-05",
    ]);

    // 对照 2：仅 T-1 日连板 → 只有 01-04（其锚点 01-03 为连板）
    await builder.build(
      filterConfig(2, { events: [{ relativeDay: -1, kind: "consecutiveBoard" }] }),
      async () => {},
    );
    expect(io.events.filter((e) => e.datasetVersionId === 2).map((e) => e.tradeDate)).toEqual([
      "2024-01-04",
    ]);

    // OR 叠加 → 并集（严格多于任一条单独规格）
    await builder.build(
      filterConfig(3, {
        events: [
          { relativeDay: 0, kind: "firstBoard" },
          { relativeDay: -1, kind: "consecutiveBoard" },
        ],
      }),
      async () => {},
    );
    expect(io.events.filter((e) => e.datasetVersionId === 3).map((e) => e.tradeDate)).toEqual([
      "2024-01-02", "2024-01-04", "2024-01-05",
    ]);
  });

  it("封板收盘价恰为四舍五入涨停价时不会漏判（真实数据口径回归）", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03"];
    // 前收 11.61 → 涨停价 12.77；原始乘积 12.771 > 12.77（旧实现会漏判）
    io.bars.push(
      mkBar("600001.SH", "2024-01-02", 12.77, 11.61, 12.77, 11.61),
      mkBar("600001.SH", "2024-01-03", 12.8, 12.77, 12.9, 12.7),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    await builder.build(filterConfig(1, { endDate: "2024-01-03" }), async () => {});
    const events = io.events.filter((e) => e.datasetVersionId === 1);
    expect(events.map((e) => e.tradeDate)).toEqual(["2024-01-02"]);
    // 事实列记录的涨停价同样是交易所口径（12.77，而非 12.771）
    expect(events[0]!.limitUpPrice).toBeCloseTo(12.77, 10);
  });

  it("t 前窗口：preWindowDays 真实物化负相对日路径行（含真实 OHLC）", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"];
    io.bars.push(
      mkBar("600001.SH", "2024-01-02", 10.1, 10, 10.2, 10),
      mkBar("600001.SH", "2024-01-03", 10.4, 10.1, 10.5, 10.1),
      mkLimitUp("600001.SH", "2024-01-04", 10.5), // 事件日（首板）
      mkBar("600001.SH", "2024-01-05", 11.6, 11.55, 11.7, 11.5),
      mkBar("600001.SH", "2024-01-08", 11.7, 11.6, 11.8, 11.6),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    await builder.build(
      filterConfig(1, {
        startDate: "2024-01-04",
        endDate: "2024-01-05",
        preWindowDays: 2,
        postWindowDays: 1,
      }),
      async () => {},
    );

    // 前置窗口落在 prefix（rd ≤ 0），后置原始行情落在 post（rd ≥ 1）
    const prefixes = io.prefixes
      .filter((p) => p.datasetVersionId === 1)
      .sort((a, b) => a.relativeDay - b.relativeDay);
    expect(prefixes.map((p) => p.relativeDay)).toEqual([-2, -1, 0]);
    expect(prefixes.map((p) => p.tradeDate)).toEqual(["2024-01-02", "2024-01-03", "2024-01-04"]);
    // 负相对日行不是占位：前置窗口的 OHLC 真实物化
    expect(prefixes[0]!.close).toBeCloseTo(10.1, 6);
    expect(prefixes[1]!.close).toBeCloseTo(10.4, 6);

    // post 只含 rd ≥ 1 的原始行情；path 只含 rd ≥ 1 的衍生量
    const posts = io.posts.filter((p) => p.datasetVersionId === 1);
    expect(posts.map((p) => p.relativeDay)).toEqual([1]);
    expect(posts[0]!.close).toBeCloseTo(11.6, 6);
    const paths = io.paths.filter((p) => p.datasetVersionId === 1);
    expect(paths.map((p) => p.relativeDay)).toEqual([1]);
    // 单源校验（C1）：path 的收益基准恰等于 prefix 的 D0 close（同源，不分裂）
    const d0Close = prefixes.find((p) => p.relativeDay === 0)!.close!;
    expect(paths[0]!.closeFromEventClose).toBeCloseTo(posts[0]!.close! / d0Close - 1, 10);
  });

  it("preWindowDays=0（默认）不产生负相对日行", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    io.bars.push(
      mkLimitUp("600001.SH", "2024-01-04", 10),
      mkBar("600001.SH", "2024-01-05", 11.1, 11, 11.2, 11),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    await builder.build(filterConfig(1, { preWindowDays: 0, postWindowDays: 1 }), async () => {});
    // prefix 只含 D0（无负相对日行）
    const prefixRels = io.prefixes.filter((p) => p.datasetVersionId === 1).map((p) => p.relativeDay);
    expect(new Set(prefixRels)).toEqual(new Set([0]));
    // path / post 只含 rd ≥ 1
    const pathRels = io.paths.filter((p) => p.datasetVersionId === 1).map((p) => p.relativeDay);
    const postRels = io.posts.filter((p) => p.datasetVersionId === 1).map((p) => p.relativeDay);
    expect(new Set(pathRels)).toEqual(new Set([1]));
    expect(new Set(postRels)).toEqual(new Set([1]));
    expect([...prefixRels, ...postRels].every((r) => Number.isInteger(r))).toBe(true);
  });

  it("左边界预热：窗口首日的连板不被误判为首板（回看窗口之前一天）", async () => {
    const io = new MemIO();
    // 01-02 首板 → 01-03 连板；构建窗口从 01-03 开始。
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    io.bars.push(
      mkLimitUp("600001.SH", "2024-01-02", 10),
      mkLimitUp("600001.SH", "2024-01-03", 11), // 11 * 1.1 = 12.1
      mkBar("600001.SH", "2024-01-04", 12.2, 12.1, 12.3, 12.1),
      mkBar("600001.SH", "2024-01-05", 12.3, 12.2, 12.4, 12.2),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);

    // T 日首板：01-03 是连板 → 不得收录（若缺预热会被误判为首板）
    await builder.build(
      filterConfig(1, { startDate: "2024-01-03", endDate: "2024-01-05" }),
      async () => {},
    );
    expect(io.events.filter((e) => e.datasetVersionId === 1)).toHaveLength(0);

    // 同一窗口改判「连板」→ 恰好收录 01-03（证明预热确实把 01-02 的涨停纳入了回看）
    await builder.build(
      filterConfig(2, {
        startDate: "2024-01-03",
        endDate: "2024-01-05",
        events: [{ relativeDay: 0, kind: "consecutiveBoard" }],
      }),
      async () => {},
    );
    const v2 = io.events.filter((e) => e.datasetVersionId === 2);
    expect(v2.map((e) => e.tradeDate)).toEqual(["2024-01-03"]);
  });

  it("预热深度由负锚点决定：T-3 锚点可在窗口起点前 3 个交易日取到", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09"];
    io.bars.push(
      mkLimitUp("600001.SH", "2024-01-04", 10), // T-3 锚点：首板
      mkBar("600001.SH", "2024-01-05", 11.1, 11, 11.2, 11),
      mkBar("600001.SH", "2024-01-08", 11.0, 11.1, 11.1, 10.9),
      mkBar("600001.SH", "2024-01-09", 10.9, 11.0, 11.0, 10.8), // 事件日（不涨停）
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    // 窗口从 01-08 开始，锚点为 01-04（窗口起点前 2 个交易日）→ 必须在预热范围内
    await builder.build(
      filterConfig(1, {
        startDate: "2024-01-08",
        endDate: "2024-01-09",
        events: [{ relativeDay: -3, kind: "firstBoard" }],
      }),
      async () => {},
    );
    const events = io.events.filter((e) => e.datasetVersionId === 1);
    expect(events.map((e) => e.tradeDate)).toEqual(["2024-01-09"]);
    expect(events[0]!.isFirstLimit).toBe(true);
  });

  it("Universe + Signal 两层叠加：板块过滤与事件维度同时生效", async () => {
    const io = new MemIO();
    io.tradingDays = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    io.stBySymbol.set("300002.SZ", "ST");
    io.bars.push(
      mkLimitUp("600001.SH", "2024-01-02", 10), // 主板非 ST → 入选
      mkBar("600001.SH", "2024-01-03", 11.1, 11, 11.2, 11),
      mkLimitUp20("300001.SZ", "2024-01-02", 10), // 创业板非 ST，但板块被排除
      mkBar("300001.SZ", "2024-01-03", 12.1, 12, 12.2, 12),
      mkBar("300002.SZ", "2024-01-02", 10.3, 10, 10.4, 10), // 创业板 ST，不在所选板块内
      mkBar("300002.SZ", "2024-01-03", 10.4, 10.3, 10.5, 10.3),
    );
    const builder = new FirstLimitPullbackDatasetBuilder(io);
    await builder.build(
      filterConfig(1, { boards: ["main"], excludeSt: true }),
      async () => {},
    );
    const events = io.events.filter((e) => e.datasetVersionId === 1);
    expect(events.map((e) => e.symbol)).toEqual(["600001.SH"]);
  });
});

