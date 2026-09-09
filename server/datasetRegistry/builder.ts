/**
 * STEP DATASET-001 — Dataset Builder 编排（可扩展 + 分块 + 游标 + 批插 + checkpoint + 幂等）。
 *
 * 抽象（§22）：DatasetBuilder / DatasetBuildContext / DatasetBuildCheckpoint / DatasetBuildResult，
 * 首板回踩由 FirstLimitPullbackDatasetBuilder 具体实现，不把全部逻辑硬编码进一个 God Service。
 *
 * 数据查询 Push Down（§23）：按交易日逐日下推（trade_date = ?，索引命中），禁止全表物化 + 内存过滤；
 * 分块 = 整交易日对齐（chunk 不拆开单个交易日，保证「首板 vs 连板」的日级滚动状态正确）；
 * 禁止巨大 OFFSET（§24）：跨日按交易日历 keyset 前进，日内按 symbol 升序单次有界拉取。
 *
 * 幂等（§28）：所有插入走 ON DUPLICATE KEY（唯一约束兜底），Build(v1) 重复执行不产生重复行。
 * Resume（§27）：checkpoint 记录 lastTradeDate（events）与 lastEventId（paths/outcomes），崩溃后续跑。
 * 版本隔离（§29）：所有行都带 datasetVersionId，v1/v2 物理同表、逻辑隔离。
 *
 * 反泄漏（§20/§21）：event/path 事实只用 D0 及之前；outcome 是研究结果，绝不进 Signal。
 */

import {
  advanceSymbolLimitState,
  boardTypeOf,
  classifyLimitDay,
  computeEventId,
  INITIAL_SYMBOL_LIMIT_STATE,
  isLimitUpClose,
  limitUpRatio,
  type DailyBar,
  type DayLimitClassification,
  type StStatus,
} from "./detection";
import { limitUpPrice } from "../data/boardRules";
import {
  buildOutcomeRows,
  buildPathRows,
  type EventReference,
  type RelativeBar,
} from "./path";
import type {
  DatasetBuildCheckpoint,
  DatasetBuildResult,
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
} from "./types";

// ---------------------------------------------------------------------------
// IO 抽象（注入式，测试用内存实现，生产用 db.ts）
// ---------------------------------------------------------------------------

/** 流动性富集（turnover % / 流通市值 / 总市值）。 */
export interface LiquidityEnrichment {
  turnover: number | null;
  marketCap: number | null;
  floatMarketCap: number | null;
}

/** 数据集构建 IO（只读 + 只写，全部可注入）。 */
export interface DatasetBuildIO {
  /** 全量交易日历（升序、去重）。 */
  loadTradingDays(): Promise<string[]>;
  /** 某交易日全市场 bar（按 symbol 升序）。 */
  fetchBarsForDay(tradeDate: string): Promise<DailyBar[]>;
  /** [startDate, endDate] 全市场 bar（按 tradeDate 升序，供 paths/outcomes 按日下推，避免逐 symbol 往返）。 */
  fetchBarsRange(startDate: string, endDate: string): Promise<DailyBar[]>;
  /** 解析 (symbol, tradeDate) 的 PIT ST 状态。 */
  resolveSt(symbol: string, tradeDate: string): Promise<StStatus>;
  /** 某 symbol 在 [startDate, endDate] 内的 bar（按 tradeDate 升序，仅交易日）。 */
  fetchSymbolBars(symbol: string, startDate: string, endDate: string): Promise<DailyBar[]>;
  /** 流动性富集（可返回 null 表示无数据）。 */
  fetchLiquidity(symbol: string, tradeDate: string): Promise<LiquidityEnrichment | null>;
  /** 批量流动性（symbol → enrichment），events 阶段一次 IN 查询取代逐事件查询。 */
  fetchLiquidityForSymbols(symbols: string[], tradeDate: string): Promise<Map<string, LiquidityEnrichment>>;
  /** 行业代码（可返回 null 表示无数据）。 */
  fetchIndustry(symbol: string, tradeDate: string): Promise<string | null>;
  /** 批量行业（symbol → industryCode），events 阶段一次 IN 查询取代逐事件查询。 */
  fetchIndustryForSymbols(symbols: string[], tradeDate: string): Promise<Map<string, string>>;
  /** 读取某版本已落库的全部事件（供 paths/outcomes 阶段，支持 resume 重跑）。 */
  listEvents(datasetVersionId: number): Promise<FirstLimitPullbackEvent[]>;
  /** 幂等批量 upsert。 */
  insertEvents(rows: FirstLimitPullbackEvent[]): Promise<void>;
  insertPaths(rows: FirstLimitPullbackPath[]): Promise<void>;
  insertOutcomes(rows: FirstLimitPullbackOutcome[]): Promise<void>;
}

/** 构建配置。 */
export interface FirstLimitPullbackBuildConfig {
  datasetVersionId: number;
  startDate: string;
  endDate: string;
  /** 观察窗口交易日数 N（path relative_day 0..N）。 */
  pathHorizon: number;
  /** outcome 未来窗口（交易日），如 [5, 10]。 */
  outcomeHorizons: number[];
  /** 批插入大小。 */
  batchSize?: number;
  /** resume 断点（缺省 = 从头构建）。 */
  resumeCheckpoint?: DatasetBuildCheckpoint | null;
}

/** 构建进度/断点上报（builder 每完成一个 chunk 回调一次，供落库 checkpoint）。 */
export type ProgressReporter = (checkpoint: DatasetBuildCheckpoint) => Promise<void>;

/** Dataset Builder 抽象（§22）。 */
export interface DatasetBuilder {
  readonly datasetCode: string;
  build(config: FirstLimitPullbackBuildConfig, reportProgress: ProgressReporter): Promise<DatasetBuildResult>;
}

// ---------------------------------------------------------------------------
// 事件行装配（纯函数）
// ---------------------------------------------------------------------------

/** 从 bar + ST + 分类 + 富集装配事件行。 */
export function assembleEventRow(
  datasetVersionId: number,
  bar: DailyBar,
  st: StStatus,
  ratio: number | null,
  isFirstLimit: boolean,
  previousLimitDate: string | null,
  daysSincePreviousLimit: number | null,
  historicalLimitCount: number,
  liquidity: LiquidityEnrichment | null,
  industryCode: string | null,
): FirstLimitPullbackEvent {
  const market = bar.symbol.includes(".") ? bar.symbol.split(".")[1]! : null;
  return {
    datasetVersionId,
    eventId: computeEventId(bar.symbol, bar.tradeDate),
    symbol: bar.symbol,
    tradeDate: bar.tradeDate,
    market,
    industryCode,
    boardType: boardTypeOf(bar.symbol),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    previousClose: bar.preClose,
    limitUpPrice: ratio !== null && bar.preClose !== null && bar.preClose > 0 ? limitUpPrice(bar.preClose, ratio) : null,
    volume: bar.volume,
    amount: bar.amount,
    turnover: liquidity?.turnover ?? null,
    isFirstLimit,
    previousLimitDate,
    daysSincePreviousLimit,
    historicalLimitCount,
    marketCap: liquidity?.marketCap ?? null,
    floatMarketCap: liquidity?.floatMarketCap ?? null,
  };
}

/** 由事件 + 相对 bars 装配 path/outcome（相对事件参考价）。 */
function buildEventPathsAndOutcomes(
  datasetVersionId: number,
  event: FirstLimitPullbackEvent,
  relativeBars: readonly RelativeBar[],
  outcomeHorizons: readonly number[],
): { paths: FirstLimitPullbackPath[]; outcomes: FirstLimitPullbackOutcome[] } {
  const ref: EventReference = {
    eventClose: event.close ?? 0,
    eventHigh: event.high ?? 0,
    eventVolume: event.volume,
  };
  const paths = buildPathRows(datasetVersionId, event.eventId, event.symbol, relativeBars, ref);
  const outcomes = buildOutcomeRows(datasetVersionId, event.eventId, outcomeHorizons, relativeBars, ref);
  return { paths, outcomes };
}

/** 把 [startDate, endDate] 内的 bar 列表 + 交易日历映射为 0..N 的相对 bars（缺失日 null 填充，保持连续性）。 */
export function buildRelativeBarsFull(
  eventTradeDate: string,
  pathHorizon: number,
  tradingDayIndex: ReadonlyMap<string, number>,
  tradingDays: readonly string[],
  barByDate: ReadonlyMap<string, DailyBar>,
): RelativeBar[] {
  const startIdx = tradingDayIndex.get(eventTradeDate);
  const bars: RelativeBar[] = [];
  if (startIdx === undefined) return bars;
  for (let d = 0; d <= pathHorizon; d += 1) {
    const date = tradingDays[startIdx + d];
    if (date === undefined) break; // 日历边界
    const bar = barByDate.get(date);
    bars.push({
      relativeDay: d,
      tradeDate: date,
      open: bar?.open ?? null,
      high: bar?.high ?? null,
      low: bar?.low ?? null,
      close: bar?.close ?? null,
      volume: bar?.volume ?? null,
      amount: bar?.amount ?? null,
      turnover: null, // 路径换手率由 db 层可选富集（当前 null，诚实不伪造）
    });
  }
  return bars;
}

// ---------------------------------------------------------------------------
// 首板回踩 Dataset Builder
// ---------------------------------------------------------------------------

const EMPTY_ENRICHMENT: LiquidityEnrichment = { turnover: null, marketCap: null, floatMarketCap: null };

export class FirstLimitPullbackDatasetBuilder implements DatasetBuilder {
  readonly datasetCode = "first_limit_pullback";

  private readonly io: DatasetBuildIO;
  private readonly batchSize: number;

  constructor(io: DatasetBuildIO, options: { batchSize?: number } = {}) {
    this.io = io;
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? 1000));
  }

  async build(config: FirstLimitPullbackBuildConfig, reportProgress: ProgressReporter): Promise<DatasetBuildResult> {
    const tradingDays = (await this.io.loadTradingDays()).filter((d) => d >= config.startDate && d <= config.endDate);
    const tradingDayIndex = new Map(tradingDays.map((d, i) => [d, i]));

    const checkpoint = config.resumeCheckpoint ?? {
      phase: "events" as const,
      lastTradeDate: null,
      lastSymbol: null,
      lastEventId: null,
      processedRows: 0,
      completedChunks: 0,
    };

    // ---------- Phase 1：events ----------
    const events = await this.buildEvents(config, tradingDays, tradingDayIndex, checkpoint, reportProgress);

    // ---------- Phase 2：paths + outcomes ----------
    const { pathCount, outcomeCount, processedRows, failedRows, completedChunks } = await this.buildPathsAndOutcomes(
      config,
      tradingDayIndex,
      tradingDays,
      checkpoint,
      reportProgress,
    );

    return {
      status: "COMPLETED",
      events: events.length,
      paths: pathCount,
      outcomes: outcomeCount,
      chunks: completedChunks,
      processedRows,
      failedRows,
    };
  }

  /** Phase 1：逐日检测首板事件并 upsert。 */
  private async buildEvents(
    config: FirstLimitPullbackBuildConfig,
    tradingDays: readonly string[],
    tradingDayIndex: ReadonlyMap<string, number>,
    checkpoint: DatasetBuildCheckpoint,
    reportProgress: ProgressReporter,
  ): Promise<FirstLimitPullbackEvent[]> {
    const resumeFrom = checkpoint.phase === "events" && checkpoint.lastTradeDate !== null
      ? checkpoint.lastTradeDate
      : null;
    const startDayIdx = resumeFrom === null ? 0 : (tradingDayIndex.get(resumeFrom) ?? -1) + 1;

    // 跨日滚动状态：上一交易日涨停集合（日级重置）+ 累计涨停历史（持久）。
    // resume 时从 checkpoint 精确恢复（避免崩溃后首板判定丢失历史涨停上下文）。
    let prevLimitUp = new Set<string>(checkpoint.prevLimitUp ?? []);
    const cumulative = new Map<string, { previousLimitDate: string | null; historicalLimitCount: number }>(
      Object.entries(checkpoint.cumulative ?? {}),
    );

    const allEvents: FirstLimitPullbackEvent[] = [];
    let processedRows = checkpoint.processedRows;

    for (let dayIdx = startDayIdx; dayIdx < tradingDays.length; dayIdx += 1) {
      const tradeDate = tradingDays[dayIdx]!;
      const bars = await this.io.fetchBarsForDay(tradeDate);
      const todayLimitUp = new Set<string>();

      // Pass 1：逐 bar 分类（纯内存，含 PIT ST），收集首板候选。
      const firstLimitRows: { bar: DailyBar; st: StStatus; ratio: number | null; classification: DayLimitClassification }[] = [];

      for (const bar of bars) {
        const st = await this.io.resolveSt(bar.symbol, tradeDate);
        const ratio = limitUpRatio(bar.symbol, st);
        const isLimitUp = isLimitUpClose(bar.close, bar.preClose, ratio);
        if (isLimitUp) todayLimitUp.add(bar.symbol);

        if (!isLimitUp) continue;

        const cum = cumulative.get(bar.symbol) ?? { previousLimitDate: null, historicalLimitCount: 0 };
        const classification = classifyLimitDay(
          { ...INITIAL_SYMBOL_LIMIT_STATE, prevTradingDayLimitUp: prevLimitUp.has(bar.symbol), previousLimitDate: cum.previousLimitDate, historicalLimitCount: cum.historicalLimitCount },
          tradeDate,
          true,
          tradingDayIndex,
        );
        if (classification.isFirstLimit) {
          firstLimitRows.push({ bar, st, ratio, classification });
        }

        // 更新累计涨停历史（含今日）。
        cumulative.set(bar.symbol, {
          previousLimitDate: tradeDate,
          historicalLimitCount: cum.historicalLimitCount + 1,
        });
      }

      // Pass 2：批量富集流动性 + 行业（一次 IN 查询取代逐事件往返）。
      const firstLimitSymbols = firstLimitRows.map((r) => r.bar.symbol);
      const liquidityMap = firstLimitSymbols.length > 0
        ? await this.io.fetchLiquidityForSymbols(firstLimitSymbols, tradeDate)
        : new Map<string, LiquidityEnrichment>();
      const industryMap = firstLimitSymbols.length > 0
        ? await this.io.fetchIndustryForSymbols(firstLimitSymbols, tradeDate)
        : new Map<string, string>();

      // Pass 3：装配事件行。
      const eventsToday: FirstLimitPullbackEvent[] = firstLimitRows.map(({ bar, st, ratio, classification }) =>
        assembleEventRow(
          config.datasetVersionId,
          bar,
          st,
          ratio,
          classification.isFirstLimit,
          classification.previousLimitDate,
          classification.daysSincePreviousLimit,
          classification.historicalLimitCount,
          liquidityMap.get(bar.symbol) ?? EMPTY_ENRICHMENT,
          industryMap.get(bar.symbol) ?? null,
        ),
      );

      // 批插事件（幂等 upsert）。
      if (eventsToday.length > 0) {
        await this.insertInBatches(eventsToday, (batch) => this.io.insertEvents(batch));
        allEvents.push(...eventsToday);
      }
      processedRows += bars.length;
      prevLimitUp = todayLimitUp; // 日级重置：明日 prev = 今日涨停集

      const next: DatasetBuildCheckpoint = {
        phase: "events",
        lastTradeDate: tradeDate,
        lastSymbol: bars.length > 0 ? bars[bars.length - 1]!.symbol : checkpoint.lastSymbol,
        lastEventId: null,
        processedRows,
        completedChunks: checkpoint.completedChunks + 1,
        prevLimitUp: Array.from(todayLimitUp),
        cumulative: Object.fromEntries(cumulative),
      };
      await reportProgress(next);
    }

    return allEvents;
  }

  /** Phase 2：按交易日分组构建 path + outcome 并 upsert（一次范围下推 + 批插，去 chatty 逐事件往返）。 */
  private async buildPathsAndOutcomes(
    config: FirstLimitPullbackBuildConfig,
    tradingDayIndex: ReadonlyMap<string, number>,
    tradingDays: readonly string[],
    checkpoint: DatasetBuildCheckpoint,
    reportProgress: ProgressReporter,
  ): Promise<{ pathCount: number; outcomeCount: number; processedRows: number; failedRows: number; completedChunks: number }> {
    const events = await this.io.listEvents(config.datasetVersionId);
    const resumeTradeDate = checkpoint.phase !== "events" && checkpoint.lastTradeDate !== null
      ? checkpoint.lastTradeDate
      : null;

    // 按 tradeDate 分组（升序），组内按 eventId 升序（确定性）。
    const eventsByDate = new Map<string, FirstLimitPullbackEvent[]>();
    for (const event of events) {
      if (resumeTradeDate !== null && event.tradeDate <= resumeTradeDate) continue;
      const list = eventsByDate.get(event.tradeDate);
      if (list) list.push(event);
      else eventsByDate.set(event.tradeDate, [event]);
    }
    for (const list of eventsByDate.values()) list.sort((a, b) => a.eventId.localeCompare(b.eventId));
    const sortedDates = Array.from(eventsByDate.keys()).sort();

    let pathCount = 0;
    let outcomeCount = 0;
    let processedRows = checkpoint.processedRows;
    let completedChunks = checkpoint.completedChunks;

    const pendingPaths: FirstLimitPullbackPath[] = [];
    const pendingOutcomes: FirstLimitPullbackOutcome[] = [];
    const flushThreshold = Math.max(this.batchSize, 1000);
    let lastEventId = checkpoint.lastEventId ?? null;

    const flush = async (): Promise<void> => {
      if (pendingPaths.length > 0) {
        await this.insertInBatches(pendingPaths, (batch) => this.io.insertPaths(batch));
        pendingPaths.length = 0;
      }
      if (pendingOutcomes.length > 0) {
        await this.insertInBatches(pendingOutcomes, (batch) => this.io.insertOutcomes(batch));
        pendingOutcomes.length = 0;
      }
    };

    // 按交易日分块（chunk = N 个交易日），块内一次范围下推拉取 [chunkStart, chunkEnd+horizon]，
    // 后续事件从内存构建，避免逐日重复拉取 ~95% 重叠 bar（§23 Push-down + §24 无巨大 OFFSET）。
    const PATH_CHUNK_DAYS = 30;
    for (let i = 0; i < sortedDates.length; i += PATH_CHUNK_DAYS) {
      const dateChunk = sortedDates.slice(i, i + PATH_CHUNK_DAYS);
      const chunkStart = dateChunk[0]!;
      const chunkEnd = dateChunk[dateChunk.length - 1]!;
      const chunkEndIdx = tradingDayIndex.get(chunkEnd);
      const rangeEndDate = chunkEndIdx === undefined
        ? chunkEnd
        : tradingDays[Math.min(tradingDays.length - 1, chunkEndIdx + config.pathHorizon)] ?? chunkEnd;

      const rangeBars = await this.io.fetchBarsRange(chunkStart, rangeEndDate);
      const barsBySymbol = new Map<string, Map<string, DailyBar>>();
      for (const b of rangeBars) {
        let byDate = barsBySymbol.get(b.symbol);
        if (!byDate) {
          byDate = new Map();
          barsBySymbol.set(b.symbol, byDate);
        }
        byDate.set(b.tradeDate, b);
      }

      for (const tradeDate of dateChunk) {
        const dayEvents = eventsByDate.get(tradeDate)!;
        for (const event of dayEvents) {
          const barByDate = barsBySymbol.get(event.symbol) ?? new Map<string, DailyBar>();
          const relativeBars = buildRelativeBarsFull(event.tradeDate, config.pathHorizon, tradingDayIndex, tradingDays, barByDate);
          const { paths, outcomes } = buildEventPathsAndOutcomes(config.datasetVersionId, event, relativeBars, config.outcomeHorizons);
          pendingPaths.push(...paths);
          pendingOutcomes.push(...outcomes);
          pathCount += paths.length;
          outcomeCount += outcomes.length;
          processedRows += paths.length + outcomes.length;
          completedChunks += 1;
          lastEventId = event.eventId;
        }
      }

      if (pendingPaths.length + pendingOutcomes.length >= flushThreshold) {
        await flush();
      }

      await reportProgress({
        phase: "paths",
        lastTradeDate: chunkEnd,
        lastSymbol: null,
        lastEventId,
        processedRows,
        completedChunks,
      });
    }

    await flush();

    return { pathCount, outcomeCount, processedRows, failedRows: 0, completedChunks };
  }

  /** 按 batchSize 分批插入。 */
  private async insertInBatches<T>(rows: T[], insert: (batch: T[]) => Promise<void>): Promise<void> {
    for (let i = 0; i < rows.length; i += this.batchSize) {
      await insert(rows.slice(i, i + this.batchSize));
    }
  }
}
