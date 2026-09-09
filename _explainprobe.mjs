import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);

  // 1. 单股票范围查询（测索引是否生效）
  const t0 = Date.now();
  const [s] = await conn.query(
    `SELECT COUNT(*) AS c FROM stock_daily_prices WHERE stockCode = '600000' AND tradeDate >= '2024-01-01' AND tradeDate <= '2026-09-09'`,
  );
  console.log(`[1] single-stock range COUNT: ${s[0].c} rows, ${Date.now() - t0}ms`);

  // 2. EXPLAIN 每股连续窗口 JOIN
  console.log("\n[2] EXPLAIN per-stock GROUP BY JOIN:");
  const [plan] = await conn.query(
    `EXPLAIN SELECT p.stockCode
     FROM stock_daily_prices p
     JOIN (
       SELECT stockCode, MIN(limitUpDate) AS minDate, MAX(limitUpDate) AS maxDate
       FROM limit_up_records
       WHERE limitUpDate >= '2024-09-09' AND limitUpDate <= '2026-09-09'
       GROUP BY stockCode
     ) w ON p.stockCode = w.stockCode
       AND p.tradeDate >= DATE_SUB(w.minDate, INTERVAL 30 DAY)
       AND p.tradeDate <= DATE_ADD(w.maxDate, INTERVAL 14 DAY)`,
  );
  console.log(plan.map((r) => JSON.stringify(r)).join("\n"));

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
