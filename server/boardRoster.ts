/**
 * 连板梯队名录（连板股 + 断板股）—— 大盘分析页「连板梯队」大表格的**唯一数据源**。
 *
 * 为什么另起一个模块、而不是继续用 `db.ts#getConnectionBoardStats`：
 *   后者第一步是 `db.select().from(limitUpRecords)`（**全表 99,918 行**），
 *   2026-09-18 实测单次 **68.3s**（`docs/evidence/_probe_market_page_timing.out.json`）。
 *   该成本藏在 Tab 里尚可忍受，一旦把连板梯队摊平为常显区块就会直接拖死首屏。
 *   本模块改用**有界窗口**取数：只读 [date - lookbackDays, date] 区间内的涨停记录，
 *   实测约 4~5s，且**连板判定规则与既有实现逐字一致**：
 *   「该股票在目标交易日之前、连续若干个**记录交易日**上都涨停 ⇒ 板数 = 连续个数」。
 *
 * 窗口安全性（不静默给错数）：
 *   只有当某只股票的连板数**顶满整个窗口**（`boards === 窗口内记录交易日数`）时结果才可能被截断，
 *   此时 `window.exhausted = true` 显式上报；默认 60 自然日 ≈ 40 个记录交易日，
 *   远大于实测最长连板（见 `docs/evidence/_probe_board_roster_verify.out.json` 的口径对拍）。
 *
 * 断板口径：
 *   `brokenStocks` = **上一记录交易日涨停、当日未再涨停**的股票，其 `boards` 取「上一记录交易日」口径
 *   （`boardsAsOfDate === prevDate`）。2 板及以上标 `brokenKind = "connection"`（连板中断），
 *   1 板标 `"first"`（首板未续）—— 两者含义不同，前端分开呈现，不做合并。
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { limitUpRecords, stockDailyPrices } from "../drizzle/schema";
import { computeBoardEmotionScore } from "../shared/boardEmotionScore";
import { normalizeSectorName } from "../shared/stockDataNormalization";
import { getDb } from "./db";

/** 默认回看窗口（自然日）：≈ 40 个记录交易日，远大于窗口内实测最长连板。 */
export const BOARD_ROSTER_LOOKBACK_DAYS = 60;

/** 窗口内的原始涨停记录（只取连板判定与展示真正需要的列）。 */
export interface BoardRosterRecord {
  stockCode: string;
  stockName: string;
  sector: string | null;
  limitUpDate: string;
  limitUpTime: string | null;
}

/** 名录里的一行（连板股 / 断板股 / 首板股共用同一形状）。 */
export interface BoardRosterRow {
  stockCode: string;
  stockName: string;
  /** 已归一化题材（缺失走 `normalizeSectorName` 的兜底值）。 */
  sector: string;
  /** 原始涨停时间（HH:MM:SS，可能为空串）；展示侧用 `@shared/limitUpTime` 归一。 */
  limitUpTime: string;
  /** 板数。 */
  boards: number;
  /** `boards` 对应的日期：连板股 = `date`；断板股 = `prevDate`。 */
  boardsAsOfDate: string;
  /** 仅断板股有值：`connection` = 2 板及以上中断；`first` = 首板未续。 */
  brokenKind?: "connection" | "first";
  /**
   * 目标交易日涨跌幅（%），保留 2 位。
   * 只在传入 `quotes`（`getBoardRoster` 会查当日行情）时有值，否则 null；
   * 行情缺失同样为 null —— **不推算、不插值**。
   */
  changePct: number | null;
  /**
   * 一字板标记：当日「开盘 = 最高 = 最低」（开盘即封死、全天未打开）。
   * 只在传入 `quotes` 且有完整 OHLC 时有值，否则 null。
   */
  oneWordBoard: boolean | null;
}

/** 单只股票在目标交易日的行情补充字段（来自 `stock_daily_prices`）。 */
export interface BoardRosterQuote {
  changePct: number | null;
  oneWordBoard: boolean | null;
}

/** stockCode → 当日行情补充字段。 */
export type BoardRosterQuoteMap = Map<string, BoardRosterQuote>;

export interface BoardRosterMetrics {
  /** 当日涨停家数（同一股票同日重复记录只算一只）。 */
  totalLimitUp: number;
  /** 当日 2 板及以上家数。 */
  connectionBoards: number;
  /** 当日首板家数。 */
  firstBoards: number;
  /** 当日最高板。 */
  maxBoards: number;
  /** 当日 3 板及以上家数（情绪评分输入项）。 */
  board3Plus: number;
  /** 情绪评分（与 `db.ts#getConnectionBoardStats` 同一公式）。 */
  emotionScore: number;
  /** 断板股家数（上一记录交易日涨停、当日未涨停）。 */
  brokenCount: number;
  /** 其中连板中断（上一记录交易日 ≥ 2 板）的家数。 */
  brokenConnectionCount: number;
  /** 上一记录交易日涨停家数（断板率分母）。 */
  prevTotalLimitUp: number;
}

export interface BoardRoster {
  date: string;
  /** 上一记录交易日；窗口内没有更早的记录时为 null。 */
  prevDate: string | null;
  /** 连板股（当日在榜且 2 板及以上），板数降序。 */
  connectionStocks: BoardRosterRow[];
  /** 首板股（当日在榜且 1 板），封板时间升序 —— 「首板(N)」梯队的单元格来源。 */
  firstBoardStocks: BoardRosterRow[];
  /** 断板股（上一记录交易日涨停、当日未涨停），板数降序。 */
  brokenStocks: BoardRosterRow[];
  metrics: BoardRosterMetrics;
  window: {
    lookbackDays: number;
    /** 窗口起点（自然日）。 */
    startDate: string;
    /** 窗口内实际取到的记录交易日数量。 */
    tradingDateCount: number;
    /** true = 有股票的连板数顶满窗口、可能被截断（正常数据下恒为 false）。 */
    exhausted: boolean;
  };
}

/** ISO 日期平移（UTC 基准，不受本机时区影响）。 */
export function shiftIsoDate(isoDate: string, days: number): string {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) throw new Error(`无效日期：${isoDate}`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/** 同一股票同日多条记录时只保留封板更早的一条（与 `leaderCandidates` 的处理一致）。 */
function dedupeByStock(records: BoardRosterRecord[]): BoardRosterRecord[] {
  const byCode = new Map<string, BoardRosterRecord>();
  for (const record of records) {
    const existing = byCode.get(record.stockCode);
    if (!existing || (record.limitUpTime ?? "99:99:99") < (existing.limitUpTime ?? "99:99:99")) {
      byCode.set(record.stockCode, record);
    }
  }
  return Array.from(byCode.values());
}

/** 排序：板数降序 → 封板时间升序（早封更强）→ 代码升序（稳定）。 */
function compareRows(left: BoardRosterRow, right: BoardRosterRow): number {
  if (right.boards !== left.boards) return right.boards - left.boards;
  const leftTime = left.limitUpTime || "99:99:99";
  const rightTime = right.limitUpTime || "99:99:99";
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  return left.stockCode.localeCompare(right.stockCode);
}

/**
 * 纯函数核心：由**一段有界窗口内的涨停记录**算出连板股与断板股名录。
 * 不碰数据库，便于单测与口径对拍。
 */
export function buildBoardRoster(
  records: BoardRosterRecord[],
  date: string,
  window: { lookbackDays: number; startDate: string },
  quotes: BoardRosterQuoteMap = new Map(),
): BoardRoster {
  // 窗口内的记录交易日（降序：新 → 旧）
  const tradingDates = Array.from(new Set(records.map((record) => record.limitUpDate))).sort((a, b) =>
    b.localeCompare(a),
  );
  const tradingDateIndex = new Map(tradingDates.map((d, index) => [d, index]));

  const stockDates = new Map<string, Set<string>>();
  for (const record of records) {
    const dates = stockDates.get(record.stockCode) ?? new Set<string>();
    dates.add(record.limitUpDate);
    stockDates.set(record.stockCode, dates);
  }

  let exhausted = false;
  /** 板数：从目标交易日往前数「连续记录交易日」，遇空档即止。 */
  const boardsAt = (stockCode: string, targetDate: string): number => {
    const dates = stockDates.get(stockCode);
    const start = tradingDateIndex.get(targetDate);
    if (!dates || start === undefined) return 1;
    let boards = 1;
    for (let index = start + 1; index < tradingDates.length; index += 1) {
      if (!dates.has(tradingDates[index])) break;
      boards += 1;
    }
    // 顶满窗口 ⇒ 无法判断是否还有更早的连板（不静默给错数）
    if (tradingDates.length > 0 && boards === tradingDates.length) exhausted = true;
    return boards;
  };

  const dateIndex = tradingDateIndex.get(date);
  const hasTargetDate = dateIndex !== undefined;
  const rowsOnDate = hasTargetDate
    ? dedupeByStock(records.filter((r) => r.limitUpDate === date))
    : [];

  /** 当日行情补充字段（缺行情 ⇒ 两个字段都为 null，不推算）。 */
  const quoteOf = (stockCode: string): BoardRosterQuote => quotes.get(stockCode) ?? { changePct: null, oneWordBoard: null };

  const allRows: BoardRosterRow[] = rowsOnDate.map((record) => ({
    stockCode: record.stockCode,
    stockName: record.stockName,
    sector: normalizeSectorName(record.sector),
    limitUpTime: record.limitUpTime ?? "",
    boards: boardsAt(record.stockCode, date),
    boardsAsOfDate: date,
    ...quoteOf(record.stockCode),
  }));

  const connectionStocks = allRows.filter((row) => row.boards >= 2).sort(compareRows);
  const firstBoardStocks = allRows.filter((row) => row.boards === 1).sort(compareRows);
  const currentCodes = new Set(allRows.map((row) => row.stockCode));

  // ⚠️ 目标日**没有涨停记录**时（dateIndex 未命中）：不推断「上一记录日」，
  //    否则会把上一记录日的全部涨停股误判成「断板股」。此时名录整体留空。
  const prevDate = hasTargetDate ? (tradingDates[dateIndex + 1] ?? null) : null;
  const brokenStocks: BoardRosterRow[] = prevDate
    ? dedupeByStock(records.filter((r) => r.limitUpDate === prevDate))
        .filter((record) => !currentCodes.has(record.stockCode))
        .map((record) => {
          const boards = boardsAt(record.stockCode, prevDate);
          return {
            stockCode: record.stockCode,
            stockName: record.stockName,
            sector: normalizeSectorName(record.sector),
            limitUpTime: record.limitUpTime ?? "",
            boards,
            boardsAsOfDate: prevDate,
            brokenKind: boards >= 2 ? ("connection" as const) : ("first" as const),
            ...quoteOf(record.stockCode),
          };
        })
        .sort(compareRows)
    : [];

  const prevTotalLimitUp = prevDate
    ? dedupeByStock(records.filter((r) => r.limitUpDate === prevDate)).length
    : 0;
  const totalLimitUp = allRows.length;
  const connectionBoards = allRows.filter((row) => row.boards >= 2).length;
  const board3Plus = allRows.filter((row) => row.boards >= 3).length;
  const maxBoards = allRows.reduce((max, row) => Math.max(max, row.boards), 0);

  return {
    date,
    prevDate,
    connectionStocks,
    firstBoardStocks,
    brokenStocks,
    metrics: {
      totalLimitUp,
      connectionBoards,
      firstBoards: totalLimitUp - connectionBoards,
      maxBoards,
      board3Plus,
      emotionScore: computeBoardEmotionScore({ totalLimitUp, connectionBoards, maxBoards, board3Plus }),
      brokenCount: brokenStocks.length,
      brokenConnectionCount: brokenStocks.filter((row) => row.boards >= 2).length,
      prevTotalLimitUp,
    },
    window: {
      lookbackDays: window.lookbackDays,
      startDate: window.startDate,
      tradingDateCount: tradingDates.length,
      exhausted,
    },
  };
}

/**
 * 取目标交易日的行情补充字段（涨跌幅 / 一字板），供梯队单元格展示。
 *
 * 口径：
 *   · `changePct` = (closePrice - preClosePrice) / preClosePrice × 100，保留 2 位；
 *   · `oneWordBoard` = 开盘 = 最高 = 最低（开盘即封死、全天未打开）；
 *   · 任一价格缺失 ⇒ 对应字段为 null（**不推算、不插值**）。
 * 有界查询：只取目标日 + 名录内代码，实测 ≤ 100 行。
 */
async function loadBoardRosterQuotes(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  date: string,
  codes: string[],
): Promise<BoardRosterQuoteMap> {
  const quotes: BoardRosterQuoteMap = new Map();
  if (codes.length === 0) return quotes;

  const rows = await db
    .select({
      stockCode: stockDailyPrices.stockCode,
      openPrice: stockDailyPrices.openPrice,
      highPrice: stockDailyPrices.highPrice,
      lowPrice: stockDailyPrices.lowPrice,
      closePrice: stockDailyPrices.closePrice,
      preClosePrice: stockDailyPrices.preClosePrice,
    })
    .from(stockDailyPrices)
    .where(and(eq(stockDailyPrices.tradeDate, date), inArray(stockDailyPrices.stockCode, codes)));

  for (const row of rows) {
    const open = Number.parseFloat(row.openPrice);
    const high = Number.parseFloat(row.highPrice ?? "");
    const low = Number.parseFloat(row.lowPrice ?? "");
    const close = Number.parseFloat(row.closePrice);
    const preClose = Number.parseFloat(row.preClosePrice);

    const changePct =
      Number.isFinite(close) && Number.isFinite(preClose) && preClose !== 0
        ? Number((((close - preClose) / preClose) * 100).toFixed(2))
        : null;
    const oneWordBoard =
      Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low) ? open === high && high === low : null;

    quotes.set(row.stockCode, { changePct, oneWordBoard });
  }

  return quotes;
}

/**
 * 读库入口：**只读**，有界窗口（默认 60 自然日）。
 * 无库（未配置 DATABASE_URL）时返回 null，由上层决定如何降级，不编造数据。
 *
 * 两遍构造：先算出名录、拿到「当日需要行情的股票代码」，再去 `stock_daily_prices`
 * 取一次有界行情，最后重建名录 —— 纯函数开销可忽略，换来**只查一次行情**。
 */
export async function getBoardRoster(
  date: string,
  options: { lookbackDays?: number } = {},
): Promise<BoardRoster | null> {
  const db = await getDb();
  if (!db) return null;

  const lookbackDays = options.lookbackDays ?? BOARD_ROSTER_LOOKBACK_DAYS;
  const startDate = shiftIsoDate(date, -lookbackDays);

  const records = await db
    .select({
      stockCode: limitUpRecords.stockCode,
      stockName: limitUpRecords.stockName,
      sector: limitUpRecords.sector,
      limitUpDate: limitUpRecords.limitUpDate,
      limitUpTime: limitUpRecords.limitUpTime,
    })
    .from(limitUpRecords)
    .where(and(gte(limitUpRecords.limitUpDate, startDate), lte(limitUpRecords.limitUpDate, date)));

  const draft = buildBoardRoster(records, date, { lookbackDays, startDate });
  const codes = Array.from(
    new Set(
      [...draft.connectionStocks, ...draft.firstBoardStocks, ...draft.brokenStocks].map((row) => row.stockCode),
    ),
  );
  const quotes = await loadBoardRosterQuotes(db, date, codes);

  return buildBoardRoster(records, date, { lookbackDays, startDate }, quotes);
}
