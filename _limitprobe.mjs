import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { appendFileSync } from "node:fs";

const LOG = "C:/work/sourcecode/stock-limit-up-analyzer/_perflog.txt";
const log = (s) => appendFileSync(LOG, s + "\n");

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const [stocks] = await conn.query(
    `SELECT DISTINCT stockCode FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'`,
  );
  const codes = stocks.map((r) => r.stockCode);
  const inAll = codes.map((c) => conn.escape(c)).join(",");
  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";
  log(`stocks=${codes.length}`);

  for (const lim of [100, 10000, 100000, 500000, 1000000]) {
    const t = Date.now();
    const [r] = await conn.query(
      `SELECT stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice
       FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}' LIMIT ${lim}`,
    );
    log(`LIMIT ${lim}: got ${r.length} rows in ${Date.now() - t}ms`);
  }

  await conn.end();
  log("DONE");
}
main().then(() => process.exit(0)).catch((e) => { log("ERR " + e.message); process.exit(1); });
