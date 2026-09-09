import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const [stocks] = await conn.query(
    `SELECT DISTINCT stockCode FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'`,
  );
  const codes = stocks.map((r) => r.stockCode);
  const inAll = codes.map((c) => conn.escape(c)).join(",");

  for (const [label, cols] of [
    ["9 cols", "stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice"],
    ["2 cols", "stockCode, tradeDate"],
  ]) {
    const [p] = await conn.query(
      `EXPLAIN SELECT ${cols} FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '2024-08-09' AND tradeDate <= '2026-09-23'`,
    );
    console.log(`\n=== ${label} ===`);
    for (const r of p) {
      const op = (r.operatorInfo || r["operator info"] || "").slice(0, 80);
      const acc = (r.accessObject || r["access object"] || "").slice(0, 120);
      console.log(`${String(r.id).padEnd(4)} | ${String(r.task).padEnd(8)} | ${acc} | ${op}`);
    }
  }

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
