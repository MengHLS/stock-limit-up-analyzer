import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const [stocks] = await conn.query(
    `SELECT DISTINCT stockCode FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'`,
  );
  const codes = stocks.map((r) => r.stockCode);
  const inAll = codes.map((c) => conn.escape(c)).join(",");

  console.log("=== EXPLAIN IN(3936) SELECT (9 cols) ===");
  const [p1] = await conn.query(
    `EXPLAIN SELECT stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice
     FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '2024-08-09' AND tradeDate <= '2026-09-23'`,
  );
  console.log(p1.map((r) => `${r.id} | ${r.task} | ${r.accessObject || r["access object"] || ""} | ${r.operatorInfo || r["operator info"] || ""}`).join("\n"));

  console.log("\n=== EXPLAIN IN(3936) SELECT (2 cols, covering) ===");
  const [p2] = await conn.query(
    `EXPLAIN SELECT stockCode, tradeDate
     FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '2024-08-09' AND tradeDate <= '2026-09-23'`,
  );
  console.log(p2.map((r) => `${r.id} | ${r.task} | ${r.accessObject || r["access object"] || ""} | ${r.operatorInfo || r["operator info"] || ""}`).join("\n"));

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
