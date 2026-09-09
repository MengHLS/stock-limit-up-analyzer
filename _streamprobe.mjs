import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const rangeStart = "2024-08-09", rangeEnd = "2026-09-23";

  // EXPLAIN 日期范围
  const [p] = await conn.query(
    `EXPLAIN SELECT stockCode, tradeDate FROM stock_daily_prices WHERE tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`,
  );
  console.log("EXPLAIN date-range:");
  for (const row of p) console.log(`${String(row.id).padEnd(4)} | ${String(row.task).padEnd(8)} | ${(row.accessObject || row["access object"] || "").slice(0, 100)} | ${(row.operatorInfo || row["operator info"] || "").slice(0, 60)}`);

  // stream 读取（边收边数，不缓冲）
  let count = 0;
  const t0 = Date.now();
  const q = conn.query(`SELECT stockCode, tradeDate FROM stock_daily_prices WHERE tradeDate >= '${rangeStart}' AND tradeDate <= '${rangeEnd}'`);
  q.stream({ highWaterMark: 50000 })
    .on("data", () => { count++; if (count % 100000 === 0) console.log(`stream: ${count} rows @ ${Date.now() - t0}ms`); })
    .on("end", () => { console.log(`stream END: ${count} rows total, ${Date.now() - t0}ms`); process.exit(0); })
    .on("error", (e) => { console.error(e); process.exit(1); });
}
main().catch((e) => { console.error(e); process.exit(1); });
