import "dotenv/config";
import mysql from "mysql2/promise";
const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, dateStrings: true });
const out: string[] = [];
const [rows] = await conn.query(
  `SELECT DATE_FORMAT(limitUpDate,'%Y-%m-%d') AS d, COUNT(*) AS n FROM limit_up_records
   WHERE limitUpDate IN ('2026-09-11','2026-09-14') GROUP BY d ORDER BY d`,
);
out.push("信号日 | 涨停数");
for (const r of rows as Array<Record<string, unknown>>) out.push(`${r.d} | ${r.n}`);

const [m] = await conn.query(
  `SELECT DATE_FORMAT(r.limitUpDate,'%Y-%m-%d') AS signalDate,
          COUNT(*) AS candidates,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM stock_daily_prices p WHERE p.stockCode=r.stockCode AND p.tradeDate='2026-09-15') THEN 1 ELSE 0 END) AS priceOn0915,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM stock_daily_prices p WHERE p.stockCode=r.stockCode AND p.tradeDate='2026-09-16') THEN 1 ELSE 0 END) AS priceOn0916
   FROM limit_up_records r
   WHERE r.limitUpDate = '2026-09-14'
   GROUP BY signalDate`,
);
out.push("09-14 候选的行情就绪度（09-15 = 其后第一个交易日，09-16 = 尚不存在）:");
for (const r of m as Array<Record<string, unknown>>) out.push(JSON.stringify(r));
await conn.end();
process.stdout.write(out.join("\n") + "\n");
process.exit(0);
