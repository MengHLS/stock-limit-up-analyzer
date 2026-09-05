/**
 * STEP 7.3 — Keyset Pagination（内存安全）。
 *
 * 全市场回填后 `stock_daily_prices` 约 9M 行，禁止一次性加载进 Node.js 内存。
 * 读取采用 keyset pagination（优于 OFFSET：OFFSET 在百万级数据上性能逐渐恶化）。
 *
 * keyset 顺序：(trade_date ASC, stock_code ASC)。游标为「上一页最后一行」的 (tradeDate, stockCode)。
 */

/** stock_daily_prices 的一行主键游标。 */
export interface StockDailyPriceKey {
  tradeDate: string;
  stockCode: string;
}

/** 游标（null = 从头开始）。 */
export type StockDailyPriceCursor = StockDailyPriceKey | null;

/** 按 (tradeDate, stockCode) 字典序比较。 */
export function compareStockDailyPriceKey(a: StockDailyPriceKey, b: StockDailyPriceKey): number {
  const byDate = a.tradeDate.localeCompare(b.tradeDate);
  if (byDate !== 0) return byDate;
  return a.stockCode.localeCompare(b.stockCode);
}

/**
 * 判断 row 是否位于游标之后（严格大于，用于 keyset 过滤谓词）。
 */
export function isAfterStockDailyPriceCursor(row: StockDailyPriceKey, cursor: StockDailyPriceCursor): boolean {
  if (cursor === null) return true;
  return compareStockDailyPriceKey(row, cursor) > 0;
}

/**
 * 从一页行（按 keyset 顺序升序）计算下一页游标。
 * 页非空 → 最后一行的 key；页空 → 返回 current（表示无可继续，由调用方判断终止）。
 */
export function nextStockDailyPriceCursor(
  rows: ReadonlyArray<StockDailyPriceKey>,
  current: StockDailyPriceCursor,
): StockDailyPriceCursor {
  if (rows.length === 0) return current;
  const last = rows[rows.length - 1];
  return { tradeDate: last.tradeDate, stockCode: last.stockCode };
}

/**
 * 通用 keyset 分页迭代器：给定「按游标取一页」的 fetchPage 函数与 batchSize，
 * 依次 yield 每一页（保持内存有界）。空页即终止。
 * fetchPage 返回的行必须已按 (tradeDate, stockCode) 升序排序。
 */
export async function* iterateKeysetPages<T extends StockDailyPriceKey>(
  fetchPage: (cursor: StockDailyPriceCursor, limit: number) => Promise<T[]>,
  batchSize: number,
): AsyncGenerator<T[], void, unknown> {
  const limit = Math.max(1, Math.floor(batchSize));
  let cursor: StockDailyPriceCursor = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await fetchPage(cursor, limit);
    if (page.length === 0) return;
    yield page;
    const next = nextStockDailyPriceCursor(page, cursor);
    // 若游标未前进（防死循环），终止。
    if (next === null || (cursor !== null && compareStockDailyPriceKey(next, cursor) <= 0)) return;
    cursor = next;
  }
}

/** 默认读取页大小（keyset 流式读取）。 */
export const DEFAULT_PAGE_SIZE = 10_000;
