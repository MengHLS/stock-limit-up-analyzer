import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const lookbackDays = 30, forwardDays = 14;

  // 方案 B：每股连续窗口（GROUP BY 聚合，窗口数 = 股票数）
  console.log("=== 方案 B：每股连续窗口 GROUP BY JOIN ===");
  const tb0 = Date.now();
  const [rowsB] = await conn.query(
    `SELECT p.stockCode, DATE_FORMAT(p.tradeDate, '%Y-%m-%d') AS tradeDate, p.openPrice, p.closePrice, p.highPrice, p.lowPrice, p.amount, p.volume, p.preClosePrice
     FROM stock_daily_prices p
     JOIN (
       SELECT stockCode, MIN(limitUpDate) AS minDate, MAX(limitUpDate) AS maxDate
       FROM limit_up_records
       WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'
       GROUP BY stockCode
     ) w ON p.stockCode = w.stockCode
       AND p.tradeDate >= DATE_SUB(w.minDate, INTERVAL ${lookbackDays} DAY)
       AND p.tradeDate <= DATE_ADD(w.maxDate, INTERVAL ${forwardDays} DAY)`,
  );
  console.log(`   rows=${rowsB.length} time=${Date.now() - tb0}ms`);
  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
