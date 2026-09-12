/**
 * STEP DATASET-001 — Dataset Builder 编排（可扩展 + 分片 + 定向取数 + 并发 + checkpoint + 幂等）。
 *
 * 抽象（§22）：DatasetBuilder / DatasetBuildContext / DatasetBuildCheckpoint / DatasetBuildResult，
 * 首板回踩由 FirstLimitPullbackDatasetBuilder 具体实现，不把全部逻辑硬编码进一个 God Service。
 *
 * 性能架构（2026-09-11 重构，实测见 `scripts/verifyDatasetBuildPerf.mts` 与 ROADMAP §47）：
 *
 *   瓶颈定位（跨境 TiDB，RTT ≈ 0.21s，属**延迟受限**而非算力受限）：
 *     ① 旧 Phase 1 逐日拉**全市场** bar（5349 行/日，796ms）——其中仅约 8% 可能封板；
 *     ② 旧 Phase 2 按「日期段」拉**全市场** bar（61 天片 21.9 万行/16.9s），而该片事件只涉及
 *        数百只标的 —— 13.4× 的纯浪费；
 *     ③ 逐日做富集 / 逐日落库 / 逐日写 checkpoint：一年 242 个交易日 ≈ 3×242 次往返；
 *     ④ 全程串行，连接池从未被用满（实测并发 8 可达 2.3× 吞吐）。
 *
 *   对策（只改「怎么取数、怎么落库」，不改任何判定口径）：
 *     ① Phase 1 改**一次范围下推**取「涨停候选 bar」（SQL 粗筛超集，见 detection.LIMIT_UP_CANDIDATE_SQL_PREDICATE），
 *        并在内存用 `isLimitUpClose` 精确判定 —— 阈值已证明为严格超集（零漏判），且由真实 DB 对照脚本守门；
 *     ② Phase 2 改**按片内事件 symbol 定向取数**（`fetchBarsForSymbolsInRange`），数据量压缩 13.4×；
 *     ③ 富集 / 落库 / checkpoint 一律按**分片**批量（`EVENT_CHUNK_DAYS` / `PATH_CHUNK_DAYS`），
 *        checkpoint 只上报**已落库**的日期，resume 语义不放松；
 *     ④ I/O 层有界并发（`mapWithConcurrency`）把连接池用满；写入按 `MAX_ROWS_PER_STATEMENT` 压片。
 *
 *   为什么不用 worker_threads：Node 无共享内存线程，构建状态（`limitUpDays` 等）必须单线程串行推进；
 *   且实测瓶颈是网络往返与传输量而非 CPU —— 有界异步并发才是这里的「多线程」等价物。
 *
 * 数据查询 Push Down（§23）：按交易日推进、索引命中，禁止全表物化 + 内存过滤；
 * 禁止巨大 OFFSET（§24）：跨日按交易日历 keyset 前进，日内按 symbol 升序有界拉取。
 *
 * 幂等（§28）：所有插入走 ON DUPLICATE KEY（唯一约束兜底），Build(v1) 重复执行不产生重复行。
 * Resume（§27）：checkpoint 记录 lastTradeDate（events）与 lastEventId（paths/outcomes），崩溃后续跑。
 * 版本隔离（§29）：所有行都带 datasetVersionId，v1/v2 物理同表、逻辑隔离。
 *
 * 反泄漏（§20/§21）：event/path 事实只用 D0 及之前；outcome 是研究结果，绝不进 Signal。
 */

import {
  boardTypeOf,
  computeEventId,
  isLimitUpClose,
  limitUpRatio,
  type DailyBar,
  type DayLimitClassification,
  type StStatus,
} from "./detection";
import { exchangeLimitUpPrice } from "../data/boardRules";
import { DATASET_LIFECYCLE_ERROR, DatasetLifecycleError } from "./lifecycle";
import {
  isBoardAllowed,
  isStExcluded,
  matchesEventSpec,
  maxLookbackDays,
} from "./filter";
import {
  buildDerivedRows,
  buildOutcomeRows,
  buildRawBars,
  eventReferenceFrom,
  partitionRawBars,
  type RelativeBar,
} from "./path";
import {
  chunkArray,
  EVENT_CHUNK_DAYS,
  forEachWithConcurrency,
  INSERT_CONCURRENCY,
  MAX_ROWS_PER_STATEMENT,
  PATH_CHUNK_DAYS,
} from "./concurrency";
import type {
  DatasetBoard,
  DatasetBuildCheckpoint,
  DatasetBuildResult,
  DatasetEventSpec,
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
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

/** 流动性富集查找键（`fetchLiquidityForSymbolsInRange` 的 Map 键）。 */
export function liquidityKey(symbol: string, tradeDate: string): string {
  return `${symbol}|${tradeDate}`;
}

/** 数据集构建 IO（只读 + 只写，全部可注入）。 */
export interface DatasetBuildIO {
  /** 全量交易日历（升序、去重）。 */
  loadTradingDays(): Promise<string[]>;
  /**
   * 预热证券索引（PIT ST 区间 + 行业归属区间）。
   *
   * 两者都是**小表全量**（ST 区间 / industry_assignments 实测 5,212 行、230ms），一次性载入内存后，
   * 逐 bar 解析退化为 O(1) 内存查表 —— 取代旧实现「逐日一次 IN 查询」（一年 242 次往返 ×0.77s）。
   * 必须在任何 `resolveStSync` / `resolveIndustrySync` 之前调用一次。
   */
  loadSecurityIndexes(): Promise<void>;
  /** 同步 PIT ST 解析（须先 `loadSecurityIndexes`；不再有网络往返）。 */
  resolveStSync(symbol: string, tradeDate: string): StStatus;
  /** 异步 PIT ST 解析（等价于先 `loadSecurityIndexes` 再 `resolveStSync`；供验证脚本复用）。 */
  resolveSt(symbol: string, tradeDate: string): Promise<StStatus>;
  /** 同步 PIT 行业归属解析（须先 `loadSecurityIndexes`）。 */
  resolveIndustrySync(symbol: string, tradeDate: string): string | null;
  /**
   * `[startDate, endDate]` 内**涨停候选** bar（按 tradeDate, symbol 升序）。
   *
   * 契约：返回**粗筛超集** —— 必须包含该区间内所有 `isLimitUpClose` 为真的 bar，
   * 允许包含更多（如涨幅 5%~涨停之间的 bar）。调用方仍须用 `isLimitUpClose` 精确判定。
   * 生产实现走 SQL 谓词下推（`detection.LIMIT_UP_CANDIDATE_SQL_PREDICATE`），按月分片并发。
   */
  fetchLimitUpCandidateBars(startDate: string, endDate: string): Promise<DailyBar[]>;
  /**
   * 给定 symbol 集合在 `[startDate, endDate]` 内的 bar（按 tradeDate, symbol 升序）。
   *
   * 这是 Phase 2 的定向取数入口：只取片内事件涉及的标的，而不是整段日期的全市场。
   * 空集合 → 空数组（不发 SQL）。
   */
  fetchBarsForSymbolsInRange(symbols: readonly string[], startDate: string, endDate: string): Promise<DailyBar[]>;
  /**
   * 给定 symbol 集合在 `[startDate, endDate]` 内的流动性富集。
   * 键 = `liquidityKey(symbol, tradeDate)`；缺失的 (symbol, date) 不出现在 Map 中。
   */
  fetchLiquidityForSymbolsInRange(
    symbols: readonly string[],
    startDate: string,
    endDate: string,
  ): Promise<Map<string, LiquidityEnrichment>>;
  /** 读取某版本已落库的全部事件（供窗口构建阶段，支持 resume 重跑）。 */
  listEvents(datasetVersionId: number): Promise<FirstLimitPullbackEvent[]>;
  /** 幂等批量 upsert。 */
  insertEvents(rows: FirstLimitPullbackEvent[]): Promise<void>;
  /** 幂等批量 upsert 原始行情窗口（prefix：rd ≤ 0）。 */
  insertPrefixes(rows: FirstLimitPullbackRawBar[]): Promise<void>;
  /** 幂等批量 upsert 原始行情窗口（post：rd ≥ 1）。 */
  insertPosts(rows: FirstLimitPullbackRawBar[]): Promise<void>;
  insertPaths(rows: FirstLimitPullbackPath[]): Promise<void>;
  insertOutcomes(rows: FirstLimitPullbackOutcome[]): Promise<void>;
}

/**
 * 构建配置（DATASET-003B：筛选口径 + 窗口 + 执行参数）。
 *
 * 筛选语义（权威实现在 ./filter，此处只声明「构建需要哪些输入」）：
 *   - `boards`：仅保留这些板块（空 = 全板块含 unknown）；
 *   - `excludeSt`：排除 ST/*ST（PIT st 维度）；
 *   - `events`：事件维度（相对日 × 事件类型，OR 语义），relativeDay ≤ 0 表示锚点在事件日或之前；
 *   - `preWindowDays` / `postWindowDays`：path 物化的相对日区间 = [-preWindowDays, +postWindowDays]。
 */
export interface FirstLimitPullbackBuildConfig {
  datasetVersionId: number;
  startDate: string;
  endDate: string;
  /** 板块（空 = 不过滤）。 */
  boards: readonly DatasetBoard[];
  /** 排除 ST/*ST。 */
  excludeSt: boolean;
  /** 事件维度（至少 1 条）。 */
  events: readonly DatasetEventSpec[];
  /** t 日之前的数据天数。 */
  preWindowDays: number;
  /** t 日之后的数据天数。 */
  postWindowDays: number;
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

/**
 * 从 bar + ST + 分类 + 富集装配**事件行**（身份 + 时点属性）。
 *
 * 不含逐日行情：`open`/`high`/`low`/`close`/`volume`/`amount` 由 `prefix`（rd = 0 行）承载。
 */
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
    previousClose: bar.preClose,
    limitUpPrice:
      ratio !== null && bar.preClose !== null && bar.preClose > 0
        ? exchangeLimitUpPrice(bar.preClose, ratio)
        : null,
    turnover: liquidity?.turnover ?? null,
    isFirstLimit,
    previousLimitDate,
    daysSincePreviousLimit,
    historicalLimitCount,
    marketCap: liquidity?.marketCap ?? null,
    floatMarketCap: liquidity?.floatMarketCap ?? null,
  };
}

/**
 * 由一个事件 + 相对 bars 装配全部窗口行（prefix / post / path / outcome）。
 *
 * `EventReference` 改道（DATABASE_REDESIGN §3.3）：参考价从**入参 `relativeBars`** 提取
 * （`relativeDay = 0` 行，与 `prefix` 表同源），不再从 event 行读取 —— 零 DB 往返。
 * D0 无行情（无 `rd = 0` 行）→ 事件不成立，**不产出任何窗口行**（C3）。
 */
function buildEventWindows(
  datasetVersionId: number,
  event: FirstLimitPullbackEvent,
  relativeBars: readonly RelativeBar[],
  outcomeHorizons: readonly number[],
): {
  prefix: FirstLimitPullbackRawBar[];
  post: FirstLimitPullbackRawBar[];
  paths: FirstLimitPullbackPath[];
  outcomes: FirstLimitPullbackOutcome[];
} {
  const ref = eventReferenceFrom(relativeBars);
  if (ref === null) return { prefix: [], post: [], paths: [], outcomes: [] };
  const { prefix, post } = partitionRawBars(
    buildRawBars(datasetVersionId, event.eventId, event.symbol, relativeBars),
  );
  const paths = buildDerivedRows(datasetVersionId, event.eventId, event.symbol, relativeBars, ref);
  const outcomes = buildOutcomeRows(datasetVersionId, event.eventId, outcomeHorizons, relativeBars, ref);
  return { prefix, post, paths, outcomes };
}

/**
 * 把交易日历 + bar 映射为相对 bars（`relativeDay ∈ [-preWindowDays, +postWindowDays]`）。
 *
 * - `relativeDay = 0` = 事件日（t）；负数 = t 之前（前置窗口，DATASET-003B 新增）；
 *   正数 = t 之后（后置窗口，等价旧 pathHorizon）。
 * - 缺失日 null 填充以保持相对日连续性（日历边界处截断，不越界取未来）；
 * - 事件日之前越过窗口左边界的相对日**不产生行**（tradingDays[-1] === undefined 即 break）。
 */
export function buildRelativeBarsFull(
  eventTradeDate: string,
  preWindowDays: number,
  postWindowDays: number,
  tradingDayIndex: ReadonlyMap<string, number>,
  tradingDays: readonly string[],
  barByDate: ReadonlyMap<string, DailyBar>,
): RelativeBar[] {
  const eventIdx = tradingDayIndex.get(eventTradeDate);
  const bars: RelativeBar[] = [];
  if (eventIdx === undefined) return bars;

  const pre = Math.max(0, Math.trunc(preWindowDays));
  const post = Math.max(0, Math.trunc(postWindowDays));
  // 索引夹取到窗口合法区间：左边界不足前置天数时只物化可得部分（诚实，不臆造缺失历史）。
  const firstIdx = Math.max(0, eventIdx - pre);
  const lastIdx = Math.min(tradingDays.length - 1, eventIdx + post);
  for (let idx = firstIdx; idx <= lastIdx; idx += 1) {
    const date = tradingDays[idx]!;
    const bar = barByDate.get(date);
    bars.push({
      relativeDay: idx - eventIdx,
      tradeDate: date,
      open: bar?.open ?? null,
      high: bar?.high ?? null,
      low: bar?.low ?? null,
      close: bar?.close ?? null,
      volume: bar?.volume ?? null,
      amount: bar?.amount ?? null,
    });
  }
  return bars;
}

// ---------------------------------------------------------------------------
// 首板回踩 Dataset Builder
// ---------------------------------------------------------------------------

const EMPTY_ENRICHMENT: LiquidityEnrichment = { turnover: null, marketCap: null, floatMarketCap: null };

/** Phase 1 片内候选（尚未富集/装配）。 */
interface CandidateRow {
  dayIdx: number;
  bar: DailyBar;
  ratio: number | null;
  classification: DayLimitClassification;
}

export class FirstLimitPullbackDatasetBuilder implements DatasetBuilder {
  readonly datasetCode = "first_limit_pullback";

  private readonly io: DatasetBuildIO;
  private readonly batchSize: number;

  constructor(io: DatasetBuildIO, options: { batchSize?: number } = {}) {
    this.io = io;
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? 1000));
  }

  async build(config: FirstLimitPullbackBuildConfig, reportProgress: ProgressReporter): Promise<DatasetBuildResult> {
    // 索引基准 = **完整交易日历**（不是裁剪后的构建窗口）：
    //   1) 事件锚点相对日可为负（如 T-1 日事件），需要回看到构建窗口**之前**的交易日；
    //   2) preWindowDays 需要物化 t 之前的相对行，同样要越出构建窗口左边界。
    // 构建范围本身由 [windowStartIdx, windowEndIdx] 表达，与索引基准解耦。
    const tradingDays = await this.io.loadTradingDays();
    const tradingDayIndex = new Map(tradingDays.map((d, i) => [d, i]));
    let windowStartIdx = tradingDays.findIndex((d) => d >= config.startDate);
    if (windowStartIdx < 0) windowStartIdx = tradingDays.length; // 窗口完全落在日历之后 → 空构建
    let windowEndIdx = -1;
    for (let i = tradingDays.length - 1; i >= 0; i -= 1) {
      if (tradingDays[i]! <= config.endDate) {
        windowEndIdx = i;
        break;
      }
    }

    const checkpoint = config.resumeCheckpoint ?? {
      phase: "events" as const,
      lastTradeDate: null,
      lastSymbol: null,
      lastEventId: null,
      processedRows: 0,
      completedChunks: 0,
    };

    // ---------- Phase 1：events ----------
    const eventCount = await this.buildEvents(
      config,
      tradingDays,
      tradingDayIndex,
      windowStartIdx,
      windowEndIdx,
      checkpoint,
      reportProgress,
    );

    // ---------- Phase 2：prefix + post + path + outcome ----------
    const { prefixCount, postCount, pathCount, outcomeCount, processedRows, failedRows, completedChunks } =
      await this.buildWindowsAndOutcomes(
        config,
        tradingDayIndex,
        tradingDays,
        checkpoint,
        reportProgress,
      );

    return {
      status: "COMPLETED",
      events: eventCount,
      prefixes: prefixCount,
      posts: postCount,
      paths: pathCount,
      outcomes: outcomeCount,
      chunks: completedChunks,
      processedRows,
      failedRows,
    };
  }

  // ===========================================================================
  // Phase 1：涨停事实（一次范围下推 + 内存精确判定）→ 事件分片富集落库
  // ===========================================================================

  /**
   * Phase 1：检测事件（按筛选口径）并 upsert。
   *
   * 结构（三段，全部有界）：
   *   A. **一次**范围下推取涨停候选 bar → 内存精确判定 → 得到全窗口（含预热段）的 `limitUpDays`；
   *      （存在负锚点规格时额外定向补取「事件日 bar」，见下）
   *   B. 按 `EVENT_CHUNK_DAYS` 分片，片内逐日做**纯内存**筛选得到候选事件；
   *   C. 片内一次性按 symbol 批量富集（流动性 + 行业）→ 装配 → 批量落库 → 上报 checkpoint。
   *
   * 返回本次新建事件数。
   */
  private async buildEvents(
    config: FirstLimitPullbackBuildConfig,
    tradingDays: readonly string[],
    tradingDayIndex: ReadonlyMap<string, number>,
    windowStartIdx: number,
    windowEndIdx: number,
    checkpoint: DatasetBuildCheckpoint,
    reportProgress: ProgressReporter,
  ): Promise<number> {
    const io = this.io;
    if (windowStartIdx > windowEndIdx) return 0;

    const resumeFrom = checkpoint.phase === "events" && checkpoint.lastTradeDate !== null
      ? checkpoint.lastTradeDate
      : null;
    const resumeIdx = resumeFrom === null ? windowStartIdx : (tradingDayIndex.get(resumeFrom) ?? windowStartIdx - 1) + 1;
    const startDayIdx = Math.max(windowStartIdx, resumeIdx);
    if (startDayIdx > windowEndIdx) return 0;

    if (checkpoint.limitUpDays === undefined && checkpoint.completedChunks > 0) {
      // 旧版 checkpoint（DATASET-001/002 无 limitUpDays）：无法精确回看锚点日涨停状态。
      // 明确失败而非静默用不完整状态续跑（否则会产出错误样本且无人察觉）。
      throw new DatasetLifecycleError(
        DATASET_LIFECYCLE_ERROR.CHECKPOINT_INCOMPATIBLE,
        `构建 checkpoint 结构版本不兼容（缺少 limitUpDays，completedChunks=${checkpoint.completedChunks}）；` +
          `请从头重建该版本，不要从旧断点续跑`,
      );
    }

    // 证券索引（PIT ST + 行业）一次性预热：之后逐 bar 解析零往返。
    await io.loadSecurityIndexes();

    // 涨停日序号历史（symbol → Set<绝对交易日序号>，最终转为升序数组）。
    //
    // 这是唯一能精确回答「锚点日 / 锚点前一日是否涨停」的状态：prevLimitUp 只覆盖昨天，
    // cumulative 只保留「截至今日」的标量，均无法回看任意相对日。
    //
    // 用 Set 而非数组：resume 时「checkpoint 已有的事实」与「本轮重新分类的事实」会重叠，
    // Set 天然去重（数组会累积重复项，令 countLimitUpBefore 多计）。
    const limitUpDaySets = new Map<string, Set<number>>();
    for (const [sym, days] of Object.entries(checkpoint.limitUpDays ?? {})) {
      limitUpDaySets.set(sym, new Set(days));
    }

    // 涨停事实取数左边界：
    //   - 首轮：预热 max(|负锚点|, 1) 个交易日 —— 窗口首日的「上一交易日是否涨停」必须已知，
    //     否则会把连板误判成首板；负锚点（T-1 / T-n）同样需要回看窗口之前；
    //   - resume：断点前的涨停事实已在 checkpoint 中，只需回看 maxLookback 天以覆盖
    //     「锚点落在断点前、事件日在断点后」的情形。
    const lookback = Math.max(maxLookbackDays(config.events), 1);
    const factStartIdx = Math.max(0, startDayIdx - lookback);

    // ---- A. 一次范围下推：涨停候选 bar（SQL 粗筛超集，按月分片并发）----
    const candidateBars = await io.fetchLimitUpCandidateBars(
      tradingDays[factStartIdx]!,
      tradingDays[windowEndIdx]!,
    );

    const candidateByDate = new Map<string, DailyBar[]>();
    for (const bar of candidateBars) {
      const idx = tradingDayIndex.get(bar.tradeDate);
      if (idx === undefined) continue;
      // 精确判定（粗筛只是超集，命中仍需 exchangeLimitUpPrice 口径确认）。
      const st = io.resolveStSync(bar.symbol, bar.tradeDate);
      if (isLimitUpClose(bar.close, bar.preClose, limitUpRatio(bar.symbol, st))) {
        const set = limitUpDaySets.get(bar.symbol);
        if (set) set.add(idx);
        else limitUpDaySets.set(bar.symbol, new Set([idx]));
      }
      // 候选 bar 全量保留在按日表中：负锚点规格下「事件日 bar」可能不是涨停 bar，
      // 但它同样满足粗筛谓词（其符号在锚点日涨停，而事件日 bar 由下方定向补取覆盖）。
      const list = candidateByDate.get(bar.tradeDate);
      if (list) list.push(bar);
      else candidateByDate.set(bar.tradeDate, [bar]);
    }

    // 升序数组（连板/首板判定走二分，见 wasLimitUpOn）。
    const limitUpDays = new Map<string, number[]>();
    for (const [sym, set] of limitUpDaySets) limitUpDays.set(sym, Array.from(set).sort((a, b) => a - b));

    /** 某 symbol 在第 dayIdx 个交易日是否收盘涨停（只用已知历史，绝无未来）。 */
    const wasLimitUpOn = (symbol: string, dayIdx: number): boolean => {
      const days = limitUpDays.get(symbol);
      if (!days || days.length === 0) return false;
      // days 升序：二分查找命中。
      let lo = 0;
      let hi = days.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (days[mid] === dayIdx) return true;
        if (days[mid]! < dayIdx) lo = mid + 1;
        else hi = mid - 1;
      }
      return false;
    };

    /** 锚点日前最后一个涨停交易日序号（不含锚点日）；无 → null。 */
    const lastLimitUpBefore = (symbol: string, dayIdx: number): number | null => {
      const days = limitUpDays.get(symbol);
      if (!days) return null;
      let found: number | null = null;
      for (const d of days) {
        if (d >= dayIdx) break;
        found = d;
      }
      return found;
    };

    /** 锚点日前累计涨停次数（不含锚点日）。 */
    const countLimitUpBefore = (symbol: string, dayIdx: number): number => {
      const days = limitUpDays.get(symbol);
      if (!days) return 0;
      let n = 0;
      for (const d of days) {
        if (d >= dayIdx) break;
        n += 1;
      }
      return n;
    };

    // ---- A2. 负锚点规格：定向补取「事件日 bar」----
    //
    // 锚点相对日为负时（如「T-1 首板，T 日观察」），事件日 T 当天可以完全不涨停 ——
    // 它的 bar 不在涨停候选里，必须补。需要的 (symbol, dayIdx) 对 = {锚点日涨停的 symbol} × {T = d - rd}，
    // 故按「窗口内所有曾涨停的 symbol」定向取数一次即可覆盖（负锚点上限 10 天，lookback 已覆盖）。
    const needsEventDaySupplement = config.events.some((e) => Math.trunc(e.relativeDay) < 0);
    const barsByDate = new Map<string, DailyBar[]>(candidateByDate);
    if (needsEventDaySupplement) {
      const symbols = Array.from(limitUpDaySets.keys()).sort();
      const supplement = await io.fetchBarsForSymbolsInRange(
        symbols,
        tradingDays[startDayIdx]!,
        tradingDays[windowEndIdx]!,
      );
      for (const bar of supplement) {
        const list = barsByDate.get(bar.tradeDate);
        if (!list) {
          barsByDate.set(bar.tradeDate, [bar]);
          continue;
        }
        // 与候选 bar 去重（同一 (symbol, tradeDate) 至多一条）。
        const existing = list.find((b) => b.symbol === bar.symbol);
        if (existing) Object.assign(existing, bar);
        else list.push(bar);
      }
    }

    // ---- B + C. 分片：逐日纯内存筛选 → 片内批量富集 → 装配 → 落库 ----
    let processedRows = checkpoint.processedRows;
    let completedChunks = checkpoint.completedChunks;
    let eventCount = 0;
    const pendingEvents: FirstLimitPullbackEvent[] = [];

    /**
     * 落库 + 上报 checkpoint。
     *
     * **只上报已落库的日期**（`throughDayIdx`）：崩溃后从该日续跑即可，不会漏数据也不会重复产出
     * （重复也走幂等 upsert）。`limitUpDays` 快照只含 ≤ throughDayIdx 的涨停事实，
     * 保持「checkpoint = 截至 lastTradeDate 的真实状态」这一语义。
     */
    const flush = async (throughDayIdx: number): Promise<void> => {
      if (pendingEvents.length > 0) {
        await this.insertInBatches(pendingEvents, (batch) => io.insertEvents(batch));
        pendingEvents.length = 0;
      }
      const snapshot: Record<string, number[]> = {};
      for (const [sym, days] of limitUpDays) {
        const upto = days.filter((d) => d <= throughDayIdx);
        if (upto.length > 0) snapshot[sym] = upto;
      }
      await reportProgress({
        phase: "events",
        lastTradeDate: tradingDays[throughDayIdx]!,
        lastSymbol: null,
        lastEventId: null,
        processedRows,
        completedChunks,
        schemaVersion: 2,
        limitUpDays: snapshot,
      });
    };

    for (let chunkStart = startDayIdx; chunkStart <= windowEndIdx; chunkStart += EVENT_CHUNK_DAYS) {
      const chunkEnd = Math.min(windowEndIdx, chunkStart + EVENT_CHUNK_DAYS - 1);
      const candidates: CandidateRow[] = [];

      for (let dayIdx = chunkStart; dayIdx <= chunkEnd; dayIdx += 1) {
        const tradeDate = tradingDays[dayIdx]!;
        const bars = barsByDate.get(tradeDate) ?? [];

        // **不能只遍历涨停 bar** —— 锚点相对日为负时（如「T-1 日首板，T 日观察」），
        // 事件日 T 当天可以完全不涨停。因此对（候选 ∪ 补取的）bar 全量判定条件，命中与否由锚点日决定。
        for (const bar of bars) {
          const st = io.resolveStSync(bar.symbol, tradeDate);

          // ---- Universe 层筛选：板块 + 排除 ST（在信号判定之前，省掉无谓的富集开销）----
          if (!isBoardAllowed(config.boards, boardTypeOf(bar.symbol))) continue;
          if (isStExcluded(config.excludeSt, st)) continue;

          // ---- Signal 层筛选：事件维度（相对日 × 事件类型，OR 语义）----
          // 锚点日 = 事件日(dayIdx) + relativeDay（≤ dayIdx，永远不越到现在之后）。
          // 命中即用该锚点日的口径描述事件行元数据（确定性：按 config.events 顺序取首个命中）。
          let anchorIdx: number | null = null;
          for (const spec of config.events) {
            const a = dayIdx + spec.relativeDay;
            if (a < 0 || a > dayIdx) continue;
            if (matchesEventSpec(spec, wasLimitUpOn(bar.symbol, a), wasLimitUpOn(bar.symbol, a - 1))) {
              anchorIdx = a;
              break;
            }
          }
          if (anchorIdx === null) continue;

          // ---- 事件行的元数据一律以「锚点日」的口径描述（非事件日），保持自洽 ----
          const prevLimitIdx = lastLimitUpBefore(bar.symbol, anchorIdx);
          const anchorIsLimitUp = wasLimitUpOn(bar.symbol, anchorIdx);
          const anchorPrevIsLimitUp = wasLimitUpOn(bar.symbol, anchorIdx - 1);
          candidates.push({
            dayIdx,
            bar,
            ratio: limitUpRatio(bar.symbol, st),
            classification: {
              isFirstLimit: anchorIsLimitUp && !anchorPrevIsLimitUp,
              previousLimitDate: prevLimitIdx === null ? null : tradingDays[prevLimitIdx]!,
              daysSincePreviousLimit: prevLimitIdx === null ? null : anchorIdx - prevLimitIdx,
              historicalLimitCount: countLimitUpBefore(bar.symbol, anchorIdx),
            },
          });
        }
        processedRows += bars.length;
      }

      // 片内批量富集：一次性按 symbol 取流动性（行业走内存索引，零往返）。
      const symbols: string[] = [];
      const seen = new Set<string>();
      for (const row of candidates) {
        if (seen.has(row.bar.symbol)) continue;
        seen.add(row.bar.symbol);
        symbols.push(row.bar.symbol);
      }
      const liquidityMap = symbols.length > 0
        ? await io.fetchLiquidityForSymbolsInRange(symbols, tradingDays[chunkStart]!, tradingDays[chunkEnd]!)
        : new Map<string, LiquidityEnrichment>();

      for (const row of candidates) {
        pendingEvents.push(
          assembleEventRow(
            config.datasetVersionId,
            row.bar,
            io.resolveStSync(row.bar.symbol, row.bar.tradeDate),
            row.ratio,
            row.classification.isFirstLimit,
            row.classification.previousLimitDate,
            row.classification.daysSincePreviousLimit,
            row.classification.historicalLimitCount,
            liquidityMap.get(liquidityKey(row.bar.symbol, row.bar.tradeDate)) ?? EMPTY_ENRICHMENT,
            io.resolveIndustrySync(row.bar.symbol, row.bar.tradeDate),
          ),
        );
      }
      eventCount += pendingEvents.length;
      // completedChunks 的分母由 runner 给出（`窗口交易日数 + 事件数`），故此处必须沿用**同一单位**：
      // Phase 1 每完成一个交易日记 1（而非每片记 1），否则进度百分比会被压成近乎 0。
      completedChunks += chunkEnd - chunkStart + 1;
      await flush(chunkEnd);
    }

    return eventCount;
  }

  // ===========================================================================
  // Phase 2：按片内事件 symbol 定向取数 → prefix / post / path / outcome
  // ===========================================================================

  /**
   * Phase 2：按交易日分组构建 prefix / post / path / outcome 并 upsert。
   *
   * 关键改动（性能）：取数从「整段日期的全市场 bar」改为「本片事件涉及的 symbol 集合」
   * （`fetchBarsForSymbolsInRange`）。片内事件只涉及数百只标的，而整段日期的全市场有 5000+ 只 ——
   * 实测 61 天片 21.9 万行/16.9s → 1.6 万行/1.46s（13.4× 压缩）。
   * 语义等价：装配只按 `event.symbol` 查表，未涉及的标的本来就不会被读取。
   */
  private async buildWindowsAndOutcomes(
    config: FirstLimitPullbackBuildConfig,
    tradingDayIndex: ReadonlyMap<string, number>,
    tradingDays: readonly string[],
    checkpoint: DatasetBuildCheckpoint,
    reportProgress: ProgressReporter,
  ): Promise<{
    prefixCount: number;
    postCount: number;
    pathCount: number;
    outcomeCount: number;
    processedRows: number;
    failedRows: number;
    completedChunks: number;
  }> {
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

    let prefixCount = 0;
    let postCount = 0;
    let pathCount = 0;
    let outcomeCount = 0;
    let processedRows = checkpoint.processedRows;
    let completedChunks = checkpoint.completedChunks;

    const pendingPrefixes: FirstLimitPullbackRawBar[] = [];
    const pendingPosts: FirstLimitPullbackRawBar[] = [];
    const pendingPaths: FirstLimitPullbackPath[] = [];
    const pendingOutcomes: FirstLimitPullbackOutcome[] = [];
    const flushThreshold = Math.max(this.batchSize, 1000);
    let lastEventId = checkpoint.lastEventId ?? null;

    const flush = async (): Promise<void> => {
      const jobs: Array<Promise<void>> = [];
      if (pendingPrefixes.length > 0) jobs.push(this.insertInBatches(pendingPrefixes, (b) => this.io.insertPrefixes(b)));
      if (pendingPosts.length > 0) jobs.push(this.insertInBatches(pendingPosts, (b) => this.io.insertPosts(b)));
      if (pendingPaths.length > 0) jobs.push(this.insertInBatches(pendingPaths, (b) => this.io.insertPaths(b)));
      if (pendingOutcomes.length > 0) jobs.push(this.insertInBatches(pendingOutcomes, (b) => this.io.insertOutcomes(b)));
      pendingPrefixes.length = 0;
      pendingPosts.length = 0;
      pendingPaths.length = 0;
      pendingOutcomes.length = 0;
      if (jobs.length === 0) return;
      // 四张表相互独立 → 并发写入（把连接池用满）；等全部收敛后再抛首个错误，不留悬挂请求。
      const results = await Promise.allSettled(jobs);
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;
    };

    const pre = Math.max(0, Math.trunc(config.preWindowDays));
    const post = Math.max(0, Math.trunc(config.postWindowDays));
    for (let i = 0; i < sortedDates.length; i += PATH_CHUNK_DAYS) {
      const dateChunk = sortedDates.slice(i, i + PATH_CHUNK_DAYS);
      const chunkStart = dateChunk[0]!;
      const chunkEnd = dateChunk[dateChunk.length - 1]!;
      const chunkStartIdx = tradingDayIndex.get(chunkStart);
      const chunkEndIdx = tradingDayIndex.get(chunkEnd);
      // 前置窗口向左扩展（夹取到窗口左边界），后置窗口向右扩展（夹取到右边界）。
      const rangeStartDate = chunkStartIdx === undefined
        ? chunkStart
        : tradingDays[Math.max(0, chunkStartIdx - pre)] ?? chunkStart;
      const rangeEndDate = chunkEndIdx === undefined
        ? chunkEnd
        : tradingDays[Math.min(tradingDays.length - 1, chunkEndIdx + post)] ?? chunkEnd;

      // 本片事件涉及的 symbol 集合（定向取数的输入；只取一次，供片内所有事件复用）。
      const symbols: string[] = [];
      const seen = new Set<string>();
      for (const tradeDate of dateChunk) {
        for (const event of eventsByDate.get(tradeDate)!) {
          if (seen.has(event.symbol)) continue;
          seen.add(event.symbol);
          symbols.push(event.symbol);
        }
      }

      const rangeBars = await this.io.fetchBarsForSymbolsInRange(symbols, rangeStartDate, rangeEndDate);
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
          const relativeBars = buildRelativeBarsFull(
            event.tradeDate,
            pre,
            post,
            tradingDayIndex,
            tradingDays,
            barByDate,
          );
          const windows = buildEventWindows(
            config.datasetVersionId,
            event,
            relativeBars,
            config.outcomeHorizons,
          );
          for (const row of windows.prefix) pendingPrefixes.push(row);
          for (const row of windows.post) pendingPosts.push(row);
          for (const row of windows.paths) pendingPaths.push(row);
          for (const row of windows.outcomes) pendingOutcomes.push(row);
          prefixCount += windows.prefix.length;
          postCount += windows.post.length;
          pathCount += windows.paths.length;
          outcomeCount += windows.outcomes.length;
          processedRows += windows.prefix.length + windows.post.length + windows.paths.length + windows.outcomes.length;
          lastEventId = event.eventId;
        }
      }
      // 同上：Phase 2 的单位是「事件数」（runner 的 phase2Total = 窗口交易日数 + 事件数）。
      for (const tradeDate of dateChunk) completedChunks += eventsByDate.get(tradeDate)!.length;

      if (
        pendingPrefixes.length + pendingPosts.length + pendingPaths.length + pendingOutcomes.length >=
        flushThreshold
      ) {
        await flush();
      }

      await reportProgress({
        phase: "windows",
        lastTradeDate: chunkEnd,
        lastSymbol: null,
        lastEventId,
        processedRows,
        completedChunks,
      });
    }

    await flush();

    return { prefixCount, postCount, pathCount, outcomeCount, processedRows, failedRows: 0, completedChunks };
  }

  /**
   * 分批插入：语句规模取 `max(batchSize, MAX_ROWS_PER_STATEMENT)`，并有界并发发出。
   *
   * 依据（实测）：5000 行/语句的「每行成本」显著低于 1000 行/语句，但单语句占位符上限 65535
   * 卡住了无限放大 —— 故语句规模固定在 2000 行，改用**并发**把往返叠加掉（池上限 10，
   * 4 张表并发 + 每表 2 并发 = 最多 8 条在飞）。
   */
  private async insertInBatches<T>(rows: T[], insert: (batch: T[]) => Promise<void>): Promise<void> {
    const statementSize = Math.max(this.batchSize, MAX_ROWS_PER_STATEMENT);
    const batches = chunkArray(rows, statementSize);
    await forEachWithConcurrency(batches, insert, INSERT_CONCURRENCY);
  }
}
