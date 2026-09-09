import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const [stocks] = await conn.query(
    `SELECT DISTINCT stockCode FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'`,
  );
  const codes = stocks.map((r) => r.stockCode);
  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";
  const COLS = "stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice";

  // IN(100) + FORCE INDEX 9 列
  const in100 = codes.slice(0, 100).map((c) => conn.escape(c)).join(",");
  let t = Date.now();
  const [r] = await conn.query(
    `SELECT ${COLS} FROM stock_daily_prices FORCE INDEX (idx_stock_daily_price_stock_date)
     WHERE stockCode IN (${in100}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log(`IN(100) 9cols FORCE INDEX: ${r.length} rows, ${Date.now() - t}ms`);

  // EXPLAIN IN(100) FORCE INDEX
  const [p] = await conn.query(
    `EXPLAIN SELECT ${COLS} FROM stock_daily_prices FORCE INDEX (idx_stock_daily_price_stock_date)
     WHERE stockCode IN (${in100}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log("EXPLAIN:");
  for (const row of p) {
    console.log(`${String(row.id).padEnd(4)} | ${String(row.task).padEnd(8)} | ${(row.accessObject || row["access object"] || "").slice(0, 120)} | ${(row.operatorInfo || row["operator info"] || "").slice(0, 60)}`);
  }

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
