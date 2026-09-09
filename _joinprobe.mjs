import "dotenv/config";
import { createConnection } from "mysql2/promise";

function mergeLimitUpWindows(rows, gapDays) {
  const byStock = new Map();
  for (const r of rows) {
    const list = byStock.get(r.stockCode) ?? [];
    list.push(r.limitUpDate);
    byStock.set(r.stockCode, list);
  }
  const ranges = [];
  const dayMs = 86400000;
  for (const [code, dates] of byStock.entries()) {
    dates.sort();
    let start = dates[0], end = dates[0];
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
  const lookbackDays = 30, forwardDays = 14;

  const t0 = Date.now();
  const [limitUpRows] = await conn.query(
    `SELECT stockCode, DATE_FORMAT(limitUpDate, '%Y-%m-%d') AS limitUpDate FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09' ORDER BY stockCode, limitUpDate`,
  );
  console.log(`[1] query limit-up days (2y): ${limitUpRows.length} rows, ${Date.now() - t0}ms`);

  const t1 = Date.now();
  const ranges = mergeLimitUpWindows(limitUpRows, lookbackDays + forwardDays);
  console.log(`[2] merge windows: ${ranges.length} windows, ${Date.now() - t1}ms`);

  const t2 = Date.now();
  await conn.query("DROP TEMPORARY TABLE IF EXISTS tmp_limitup_window");
  await conn.query("CREATE TEMPORARY TABLE tmp_limitup_window (stockCode VARCHAR(20), startDate DATE, endDate DATE, KEY idx_win (stockCode, startDate))");
  const values = ranges.map((r) => `(${conn.escape(r.stockCode)},${conn.escape(r.startDate)},${conn.escape(r.endDate)})`).join(",");
  await conn.query(`INSERT INTO tmp_limitup_window (stockCode, startDate, endDate) VALUES ${values}`);
  console.log(`[3] build temp table: ${Date.now() - t2}ms`);

  const t3 = Date.now();
  const [priceRows] = await conn.query(
    `SELECT p.stockCode, DATE_FORMAT(p.tradeDate, '%Y-%m-%d') AS tradeDate, p.openPrice, p.closePrice, p.highPrice, p.lowPrice, p.amount, p.volume, p.preClosePrice
     FROM stock_daily_prices p
     JOIN tmp_limitup_window w ON w.stockCode = p.stockCode
       AND p.tradeDate >= DATE_SUB(w.startDate, INTERVAL ${lookbackDays} DAY)
       AND p.tradeDate <= DATE_ADD(w.endDate, INTERVAL ${forwardDays} DAY)`,
  );
  console.log(`[4] JOIN price rows: ${priceRows.length} rows, ${Date.now() - t3}ms`);

  // 检查索引
  const [idx] = await conn.query("SHOW INDEX FROM stock_daily_prices");
  console.log(`[5] stock_daily_prices indexes:`, idx.map((i) => `${i.Key_name}(${i.Column_name})`).join(", "));

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
