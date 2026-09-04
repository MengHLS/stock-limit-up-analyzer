import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, upsertStockDailyPrices, type StockDailyPriceUpsert } from "../server/db";
import { fetchTushareDailyPricesByDate, isTushareRateLimitError } from "../server/tushare";

/**
 * 存量回填：为 stock_daily_prices 已有行补齐 highPrice、volume（其余字段幂等覆盖）。
 * 可断点续传：只处理仍有 highPrice 缺失的交易日；触发限频自动停止，可稍后重跑。
 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库");

  const datesResult = await db.execute(
    sql`SELECT DISTINCT tradeDate FROM stock_daily_prices WHERE highPrice IS NULL ORDER BY tradeDate`,
  );
  const dates = (datesResult[0] as Array<{ tradeDate: string }>).map((row) => row.tradeDate);
  console.log(`待回填 ${dates.length} 个交易日`);

  const CONCURRENCY = 2;
  let done = 0;
  let saved = 0;
  let rateLimited = false;

  for (let index = 0; index < dates.length && !rateLimited; index += CONCURRENCY) {
    const batch = dates.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map(async (tradeDate) => {
      try {
        const prices = await fetchTushareDailyPricesByDate(tradeDate);
        const codeResult = await db.execute(
          sql`SELECT DISTINCT stockCode FROM stock_daily_prices WHERE tradeDate = ${tradeDate}`,
        );
        const codeSet = new Set((codeResult[0] as Array<{ stockCode: string }>).map((row) => row.stockCode));
        const rows: StockDailyPriceUpsert[] = prices
          .filter((price) => codeSet.has(price.stockCode))
          .map((price) => ({
            stockCode: price.stockCode,
            tradeDate: price.tradeDate,
            openPrice: String(price.openPrice),
            closePrice: String(price.closePrice),
            highPrice: String(price.highPrice),
            lowPrice: String(price.lowPrice),
            amount: String(price.amount),
            volume: String(price.volume),
            preClosePrice: String(price.preClosePrice),
            source: "tushare",
          }));
        const count = await upsertStockDailyPrices(rows);
        return { tradeDate, saved: count, rateLimited: false };
      } catch (error) {
        if (isTushareRateLimitError(error)) return { tradeDate, saved: 0, rateLimited: true };
        console.warn(`跳过 ${tradeDate}：`, error instanceof Error ? error.message : String(error));
        return { tradeDate, saved: 0, rateLimited: false };
      }
    }));

    for (const result of results) {
      done += 1;
      saved += result.saved;
      if (result.rateLimited) rateLimited = true;
    }
    if (done % 10 === 0 || done === dates.length) console.log(`进度 ${done}/${dates.length}，累计写入 ${saved} 行`);
  }

  console.log(`完成：${done}/${dates.length} 个交易日，累计写入 ${saved} 行${rateLimited ? "（触发限频，可重跑续传）" : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
