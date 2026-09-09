import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);

  // 1. 最近 2 年的 id 范围
  const t0 = Date.now();
  const [r] = await conn.query(
    `SELECT MIN(id) AS mn, MAX(id) AS mx, COUNT(*) AS c FROM stock_daily_prices WHERE tradeDate >= '2024-09-09' AND tradeDate <= '2026-09-09'`,
  );
  console.log(`[1] 2y id range: min=${r[0].mn} max=${r[0].mx} count=${r[0].c} (${Date.now() - t0}ms)`);

  // 2. 全表 id 范围
  const [r2] = await conn.query(`SELECT MIN(id) AS mn, MAX(id) AS mx, COUNT(*) AS c FROM stock_daily_prices`);
  console.log(`[2] full id range: min=${r2[0].mn} max=${r2[0].mx} count=${r2[0].c}`);

  // 3. 主键范围扫描：id >= min(2y) 全部拉（应该 ~277 万行），测速度
  const mn = r[0].mn;
  const t1 = Date.now();
  const [rows] = await conn.query(
    `SELECT stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice
     FROM stock_daily_prices WHERE id >= ${mn}`,
  );
  console.log(`[3] PK range scan (id >= ${mn}): ${rows.length} rows, ${Date.now() - t1}ms`);

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
