import "dotenv/config";
import { createConnection } from "mysql2";

async function main() {
  const conn = createConnection({ uri: process.env.DATABASE_URL, dateStrings: true });
  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";

  // stream + DATE_FORMAT 字符串 + dateStrings
  let count = 0;
  const t0 = Date.now();
  const q = conn.query(
    `SELECT stockCode, DATE_FORMAT(tradeDate, '%Y-%m-%d') AS tradeDate FROM stock_daily_prices WHERE tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  q.on("result", () => {
    count++;
    if (count % 300000 === 0) console.log(`stream: ${count} rows @ ${Date.now() - t0}ms`);
  });
  q.on("end", () => {
    console.log(`stream END: ${count} rows, ${Date.now() - t0}ms`);
    conn.end();
    process.exit(0);
  });
  q.on("error", (e) => { console.error(e); process.exit(1); });
}
main().catch((e) => { console.error(e); process.exit(1); });
