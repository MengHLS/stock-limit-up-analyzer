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

  // 覆盖索引 2 列，LIMIT 分档测传输速率
  for (const lim of [100000, 500000, 1000000, 2000000]) {
    const t = Date.now();
    const [r] = await conn.query(
      `SELECT stockCode, tradeDate FROM stock_daily_prices
       WHERE stockCode IN (${inAll}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}' LIMIT ${lim}`,
    );
    console.log(`2-col covering LIMIT ${lim}: ${r.length} rows, ${Date.now() - t}ms`);
  }

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
