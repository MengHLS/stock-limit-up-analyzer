import "dotenv/config";
import { createConnection } from "mysql2/promise";

function mergeLimitUpWindows(rows, gapDays) {
  const byStock = new Map();
  for (const r of rows) { const l = byStock.get(r.stockCode) ?? []; l.push(r.limitUpDate); byStock.set(r.stockCode, l); }
  const ranges = []; const dayMs = 86400000;
  for (const [code, dates] of byStock.entries()) {
    dates.sort(); let start = dates[0], end = dates[0];
    for (let i = 1; i < dates.length; i++) {
      const d = dates[i];
      if (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`) <= gapDays * dayMs) end = d;
      else { ranges.push({ stockCode: code, startDate: start, endDate: end }); start = d; end = d; }
    }
    ranges.push({ stockCode: code, startDate: start, endDate: end });
  }
  return ranges;
}

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);

  console.log("=== indexes on stock_daily_prices ===");
  const [idx] = await conn.query("SHOW INDEX FROM stock_daily_prices");
  console.log(idx.map((i) => `${i.Key_name}(${i.Column_name})`).join(", "));

  console.log("\n=== indexes on limit_up_records ===");
  const [idx2] = await conn.query("SHOW INDEX FROM limit_up_records");
  console.log(idx2.map((i) => `${i.Key_name}(${i.Column_name})`).join(", "));

  const [rows] = await conn.query(
    `SELECT stockCode, DATE_FORMAT(limitUpDate, '%Y-%m-%d') AS limitUpDate FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09' ORDER BY stockCode, limitUpDate`,
  );
  console.log(`\n=== 2y limit-up days: ${rows.length} ===`);
  const ranges = mergeLimitUpWindows(rows, 44);
  console.log(`=== merged windows: ${ranges.length} ===`);
  const distinctStocks = new Set(rows.map((r) => r.stockCode)).size;
  console.log(`=== distinct stocks: ${distinctStocks} ===`);

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
