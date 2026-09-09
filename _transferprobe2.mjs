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

  const t0 = Date.now();
  const [rows] = await conn.query(
    `SELECT stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice
     FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  const t1 = Date.now();
  console.log(`[1] full SELECT (no DATE_FORMAT) ${rows.length} rows: ${t1 - t0}ms`);
  console.log(`    sample:`, JSON.stringify(rows[0]), `|`, JSON.stringify(rows[Math.floor(rows.length/2)]));

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
