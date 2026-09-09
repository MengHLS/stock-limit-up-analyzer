import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const [stocks] = await conn.query(
    `SELECT DISTINCT stockCode FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'`,
  );
  const codes = stocks.map((r) => r.stockCode);
  const inAll = codes.map((c) => conn.escape(c)).join(",");
  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";

  // A. 覆盖索引（只选 stockCode, tradeDate）
  const t0 = Date.now();
  const [a] = await conn.query(
    `SELECT stockCode, tradeDate FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log(`[A] covering-index SELECT (2 cols): ${a.length} rows, ${Date.now() - t0}ms`);

  // B. 回表（9 列）但 LIMIT
  const t1 = Date.now();
  const [b] = await conn.query(
    `SELECT stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice
     FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}' LIMIT 200000`,
  );
  console.log(`[B] full cols LIMIT 200000: ${b.length} rows, ${Date.now() - t1}ms`);

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
