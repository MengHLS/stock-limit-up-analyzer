import { and, asc, desc, eq, gt, gte, lt, lte } from "drizzle-orm";
import { stockDailyPrices } from "../drizzle/schema";
import { getDb } from "./db";

export interface StockDailySeriesPoint {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  preClose: number | null;
  changePct: number | null;
  volume: number | null;
  amount: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
}

type StockDailyRow = {
  tradeDate: string;
  openPrice: string | null;
  closePrice: string | null;
  highPrice: string | null;
  lowPrice: string | null;
  preClosePrice: string | null;
  volume: string | null;
  amount: string | null;
};

const MA5_WINDOW = 5;
const MA10_WINDOW = 10;
const MA20_WINDOW = 20;
const MAX_LOOKBACK_ROWS = MA20_WINDOW - 1;

function parsePositiveNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverageAt(
  closes: readonly number[],
  index: number,
  window: number
): number | null {
  if (index + 1 < window) return null;
  return average(closes.slice(index + 1 - window, index + 1));
}

/**
 * Pure projection used by the router and tests. The input may include lookback rows
 * before `startDate`; only rows inside the requested range are returned.
 */
export function buildStockDailySeries(
  rows: readonly StockDailyRow[],
  startDate: string,
  endDate: string
): StockDailySeriesPoint[] {
  const parsed = rows
    .map(row => ({
      tradeDate: row.tradeDate,
      open: parsePositiveNumber(row.openPrice),
      high: parsePositiveNumber(row.highPrice),
      low: parsePositiveNumber(row.lowPrice),
      close: parsePositiveNumber(row.closePrice),
      preClose: parsePositiveNumber(row.preClosePrice),
      volume: parseNonNegativeNumber(row.volume),
      amount: parseNonNegativeNumber(row.amount),
    }))
    .filter(
      (
        row
      ): row is {
        tradeDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        preClose: number | null;
        volume: number | null;
        amount: number | null;
      } =>
        row.open !== null &&
        row.high !== null &&
        row.low !== null &&
        row.close !== null
    )
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));

  const closes = parsed.map(row => row.close);
  return parsed
    .map((row, index) => {
      const previousClose =
        row.preClose ?? (index > 0 ? parsed[index - 1]!.close : null);
      return {
        ...row,
        changePct:
          previousClose === null || previousClose <= 0
            ? null
            : Number(((row.close / previousClose - 1) * 100).toFixed(4)),
        ma5: movingAverageAt(closes, index, MA5_WINDOW),
        ma10: movingAverageAt(closes, index, MA10_WINDOW),
        ma20: movingAverageAt(closes, index, MA20_WINDOW),
      };
    })
    .filter(
      point => point.tradeDate >= startDate && point.tradeDate <= endDate
    );
}

/**
 * Load one stock's daily bars for a bounded display range. Nineteen preceding rows
 * are fetched so MA5/MA10/MA20 remain correct at the left edge of the returned range.
 */
export async function getStockDailySeries(
  stockCode: string,
  startDate: string,
  endDate: string
): Promise<StockDailySeriesPoint[]> {
  const db = await getDb();
  if (!db) return [];

  const columns = {
    tradeDate: stockDailyPrices.tradeDate,
    openPrice: stockDailyPrices.openPrice,
    closePrice: stockDailyPrices.closePrice,
    highPrice: stockDailyPrices.highPrice,
    lowPrice: stockDailyPrices.lowPrice,
    preClosePrice: stockDailyPrices.preClosePrice,
    volume: stockDailyPrices.volume,
    amount: stockDailyPrices.amount,
  } as const;

  const [lookbackDesc, rangeRows] = await Promise.all([
    db
      .select(columns)
      .from(stockDailyPrices)
      .where(
        and(
          eq(stockDailyPrices.stockCode, stockCode),
          lt(stockDailyPrices.tradeDate, startDate)
        )
      )
      .orderBy(desc(stockDailyPrices.tradeDate))
      .limit(MAX_LOOKBACK_ROWS),
    db
      .select(columns)
      .from(stockDailyPrices)
      .where(
        and(
          eq(stockDailyPrices.stockCode, stockCode),
          gte(stockDailyPrices.tradeDate, startDate),
          lte(stockDailyPrices.tradeDate, endDate)
        )
      )
      .orderBy(asc(stockDailyPrices.tradeDate)),
  ]);

  return buildStockDailySeries(
    [...lookbackDesc.reverse(), ...rangeRows],
    startDate,
    endDate
  );
}

/**
 * Resolve a window by actual trading bars rather than calendar days.
 * `beforeTradingDays` bars precede entryDate and `afterTradingDays` bars follow exitDate.
 */
export async function getStockDailySeriesForTradeWindow(
  stockCode: string,
  entryDate: string,
  exitDate: string,
  beforeTradingDays: number,
  afterTradingDays: number
): Promise<StockDailySeriesPoint[]> {
  const db = await getDb();
  if (!db) return [];

  const columns = {
    tradeDate: stockDailyPrices.tradeDate,
    openPrice: stockDailyPrices.openPrice,
    closePrice: stockDailyPrices.closePrice,
    highPrice: stockDailyPrices.highPrice,
    lowPrice: stockDailyPrices.lowPrice,
    preClosePrice: stockDailyPrices.preClosePrice,
    volume: stockDailyPrices.volume,
    amount: stockDailyPrices.amount,
  } as const;

  const [beforeRows, afterRows] = await Promise.all([
    db
      .select(columns)
      .from(stockDailyPrices)
      .where(
        and(
          eq(stockDailyPrices.stockCode, stockCode),
          lt(stockDailyPrices.tradeDate, entryDate)
        )
      )
      .orderBy(desc(stockDailyPrices.tradeDate))
      .limit(beforeTradingDays),
    db
      .select(columns)
      .from(stockDailyPrices)
      .where(
        and(
          eq(stockDailyPrices.stockCode, stockCode),
          gt(stockDailyPrices.tradeDate, exitDate)
        )
      )
      .orderBy(asc(stockDailyPrices.tradeDate))
      .limit(afterTradingDays),
  ]);

  const startDate = beforeRows.at(-1)?.tradeDate ?? entryDate;
  const endDate = afterRows.at(-1)?.tradeDate ?? exitDate;
  return getStockDailySeries(stockCode, startDate, endDate);
}
