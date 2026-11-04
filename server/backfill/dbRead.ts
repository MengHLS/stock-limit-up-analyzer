/**
 * STEP 7.3 — 有界读取（keyset pagination）与 DB 聚合审计。
 *
 * 全市场回填后 `stock_daily_prices` 约 9M 行。本模块提供两种无全表物化的读取方式：
 *   1) keyset 流式分页（逐页读取，内存有界）——用于需要逐行访问的场景；
 *   2) SQL 聚合审计（COUNT / GROUP BY 在 DB 侧完成）——用于 coverage / integrity 审计，
 *      避免把 9M 行拉回 Node.js。
 */

import { and, asc, count, eq, gt, gte, lte, or, sql } from "drizzle-orm";
import { stockDailyPrices } from "../../drizzle/schema";
import type { StockDailyPriceCursor } from "./pagination";
import { nextStockDailyPriceCursor, compareStockDailyPriceKey } from "./pagination";

export interface StockDailyPriceKeyRow {
  tradeDate: string;
  stockCode: string;
}

type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

/** keyset 取一页（tradeDate, stockCode）。 */
export async function fetchStockDailyPriceKeyPage(
  db: Db,
  cursor: StockDailyPriceCursor,
  limit: number,
  endDate?: string,
): Promise<StockDailyPriceKeyRow[]> {
  const conditions = [];
  if (cursor) {
    conditions.push(or(
      gt(stockDailyPrices.tradeDate, cursor.tradeDate),
      and(eq(stockDailyPrices.tradeDate, cursor.tradeDate), gt(stockDailyPrices.stockCode, cursor.stockCode)),
    ));
  }
  if (endDate) conditions.push(lte(stockDailyPrices.tradeDate, endDate));
  const base = db.select({
    tradeDate: stockDailyPrices.tradeDate,
    stockCode: stockDailyPrices.stockCode,
  }).from(stockDailyPrices);
  const scoped = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return scoped
    .orderBy(asc(stockDailyPrices.tradeDate), asc(stockDailyPrices.stockCode))
    .limit(limit);
}

/** keyset 流式分页（内存有界，逐页 yield）。 */
export async function* iterateStockDailyPriceKeys(
  db: Db,
  options: { batchSize: number; endDate?: string } = { batchSize: 10_000 },
): AsyncGenerator<StockDailyPriceKeyRow[], void, unknown> {
  let cursor: StockDailyPriceCursor = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await fetchStockDailyPriceKeyPage(db, cursor, options.batchSize, options.endDate);
    if (page.length === 0) return;
    yield page;
    const next = nextStockDailyPriceCursor(page, cursor);
    if (next === null || (cursor !== null && compareStockDailyPriceKey(next, cursor) <= 0)) return;
    cursor = next;
  }
}

/** 每日行数 + distinct 股票数聚合（DB 侧 GROUP BY）。 */
export interface DailyAggregateRow {
  tradeDate: string;
  rowCount: number;
  distinctSymbols: number;
}

export async function queryDailyAggregates(db: Db, startDate?: string, endDate?: string): Promise<DailyAggregateRow[]> {
  const conditions = [];
  if (startDate) conditions.push(gte(stockDailyPrices.tradeDate, startDate));
  if (endDate) conditions.push(lte(stockDailyPrices.tradeDate, endDate));
  const base = db.select({
    tradeDate: stockDailyPrices.tradeDate,
    rowCount: count(),
    distinctSymbols: sql<number>`COUNT(DISTINCT ${stockDailyPrices.stockCode})`,
  }).from(stockDailyPrices);
  const scoped = conditions.length > 0 ? base.where(and(...conditions)) : base;
  const rows = await scoped.groupBy(stockDailyPrices.tradeDate).orderBy(asc(stockDailyPrices.tradeDate));
  return rows.map((row) => ({
    tradeDate: row.tradeDate,
    rowCount: Number(row.rowCount),
    distinctSymbols: Number(row.distinctSymbols),
  }));
}

/** 按年份聚合（DB 侧 GROUP BY YEAR）。 */
export interface YearAggregateRow {
  year: number;
  tradingDays: number;
  stockDayRows: number;
  distinctSymbols: number;
}

export async function queryYearlyAggregates(db: Db, startDate?: string, endDate?: string): Promise<YearAggregateRow[]> {
  const conditions = [];
  if (startDate) conditions.push(gte(stockDailyPrices.tradeDate, startDate));
  if (endDate) conditions.push(lte(stockDailyPrices.tradeDate, endDate));
  const base = db.select({
    year: sql<number>`YEAR(${stockDailyPrices.tradeDate})`,
    tradingDays: sql<number>`COUNT(DISTINCT ${stockDailyPrices.tradeDate})`,
    stockDayRows: count(),
    distinctSymbols: sql<number>`COUNT(DISTINCT ${stockDailyPrices.stockCode})`,
  }).from(stockDailyPrices);
  const scoped = conditions.length > 0 ? base.where(and(...conditions)) : base;
  const rows = await scoped
    .groupBy(sql`YEAR(${stockDailyPrices.tradeDate})`)
    .orderBy(sql`YEAR(${stockDailyPrices.tradeDate})`);
  return rows.map((row) => ({
    year: Number(row.year),
    tradingDays: Number(row.tradingDays),
    stockDayRows: Number(row.stockDayRows),
    distinctSymbols: Number(row.distinctSymbols),
  }));
}

/** 重复检测：返回 (stockCode, tradeDate) 重复计数（应为 0）。 */
export async function queryDuplicateCount(db: Db, startDate?: string, endDate?: string): Promise<number> {
  const conditions = [];
  if (startDate) conditions.push(gte(stockDailyPrices.tradeDate, startDate));
  if (endDate) conditions.push(lte(stockDailyPrices.tradeDate, endDate));
  const base = db.select({
    dup: sql<number>`COUNT(*) - COUNT(DISTINCT ${stockDailyPrices.stockCode}, ${stockDailyPrices.tradeDate})`,
  }).from(stockDailyPrices);
  const scoped = conditions.length > 0 ? base.where(and(...conditions)) : base;
  const rows = await scoped;
  return Number(rows[0]?.dup ?? 0);
}

/** 全局 distinct 股票数。 */
export async function queryDistinctSymbolCount(db: Db, startDate?: string, endDate?: string): Promise<number> {
  const conditions = [];
  if (startDate) conditions.push(gte(stockDailyPrices.tradeDate, startDate));
  if (endDate) conditions.push(lte(stockDailyPrices.tradeDate, endDate));
  const base = db.select({
    distinctSymbols: sql<number>`COUNT(DISTINCT ${stockDailyPrices.stockCode})`,
  }).from(stockDailyPrices);
  const scoped = conditions.length > 0 ? base.where(and(...conditions)) : base;
  const rows = await scoped;
  return Number(rows[0]?.distinctSymbols ?? 0);
}
