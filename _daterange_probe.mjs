import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";

  // 按日期顺序扫描（全市场 2 年），测查询速度（先 COUNT 再 LIMIT 分档）
  const t0 = Date.now();
  const [c] = await conn.query(
    `SELECT COUNT(*) AS c FROM stock_daily_prices WHERE tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log(`[date-range] COUNT: ${c[0].c} rows, ${Date.now() - t0}ms`);

  // 按日期顺序 SELECT 2 列（覆盖 tradeDate 索引）
  for (const lim of [100000, 500000, 1000000]) {
    const t = Date.now();
    const [r] = await conn.query(
      `SELECT stockCode, tradeDate FROM stock_daily_prices
       WHERE tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}' LIMIT ${lim}`,
    );
    console.log(`[date-range] 2-col LIMIT ${lim}: ${r.length} rows, ${Date.now() - t}ms`);
  }

  await conn.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
