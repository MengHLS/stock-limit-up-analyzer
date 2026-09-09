import "dotenv/config";
import { createConnection } from "mysql2";

async function main() {
  const conn = createConnection(process.env.DATABASE_URL);
  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";

  // 正确用法：mysql2 非 promise 连接的 query 返回 Query 对象，可 stream
  let count = 0;
  const t0 = Date.now();
  const q = conn.query(
    `SELECT stockCode, tradeDate FROM stock_daily_prices WHERE tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  q.on("result", () => {
    count++;
    if (count % 200000 === 0) console.log(`stream: ${count} rows @ ${Date.now() - t0}ms`);
  });
  q.on("end", () => {
    console.log(`stream END: ${count} rows, ${Date.now() - t0}ms`);
    conn.end();
    process.exit(0);
  });
  q.on("error", (e) => { console.error(e); process.exit(1); });
}
main().catch((e) => { console.error(e); process.exit(1); });
