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

  // 完整 SELECT（8 字段，194 万行），测查询 + 传输 + 反序列化
  const t0 = Date.now();
  const [rows] = await conn.query(
    `SELECT stockCode, DATE_FORMAT(tradeDate, '%Y-%m-%d') AS tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice
     FROM stock_daily_prices WHERE stockCode IN (${inAll}) AND tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  const t1 = Date.now();
  console.log(`[1] full SELECT ${rows.length} rows: ${t1 - t0}ms`);

  // 应用层过滤：只保留涨停日 ± 44 自然日内的行（精确窗口）
  const [limitUpRows] = await conn.query(
    `SELECT stockCode, DATE_FORMAT(limitUpDate, '%Y-%m-%d') AS limitUpDate FROM limit_up_records WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'`,
  );
  const t2 = Date.now();
  const daysByStock = new Map();
  for (const r of limitUpRows) {
    const l = daysByStock.get(r.stockCode) ?? [];
    l.push(r.limitUpDate);
    daysByStock.set(r.stockCode, l);
  }
  // 每股涨停日排序
  for (const [, days] of daysByStock) days.sort();

  const dayMs = 86400000;
  const lookback = 30, forward = 14;
  let kept = 0;
  const t3 = Date.now();
  for (const row of rows) {
    const days = daysByStock.get(row.stockCode);
    if (!days) continue;
    const td = Date.parse(`${row.tradeDate}T00:00:00Z`);
    // 找最近的涨停窗口（简化：判断是否落在任一涨停日 ± 窗口内）
    let inWindow = false;
    for (const d of days) {
      const dd = Date.parse(`${d}T00:00:00Z`);
      if (td >= dd - lookback * dayMs && td <= dd + forward * dayMs) { inWindow = true; break; }
    }
    if (inWindow) kept++;
  }
  const t4 = Date.now();
  console.log(`[2] app filter -> ${kept} rows kept (from ${rows.length}), filter ${t4 - t3}ms`);
  console.log(`TOTAL query+transfer+filter: ${t4 - t0}ms`);

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
