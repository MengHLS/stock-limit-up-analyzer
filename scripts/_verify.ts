import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
const db = await getDb();
if (!db) { console.error("no db"); process.exit(1); }

// 1. JOIN 查询行数
let t = Date.now();
const rows: any = await db.execute(sql.raw(
  "SELECT p.stockCode, p.tradeDate FROM stock_daily_prices p JOIN (SELECT stockCode, MIN(limitUpDate) mn, MAX(limitUpDate) mx FROM limit_up_records GROUP BY stockCode) w ON w.stockCode = p.stockCode WHERE p.tradeDate >= DATE_SUB(w.mn, INTERVAL 30 DAY) AND p.tradeDate <= DATE_ADD(w.mx, INTERVAL 7 DAY)"
));
const rr = rows?.[0] ?? [];
console.log("JOIN 行数:", rr.length, "耗时(ms):", Date.now() - t);

// 2. 关键验证：每个涨停记录 (stockCode, limitUpDate) 的当日 bar 是否都在 JOIN 结果里
t = Date.now();
const missing: any = await db.execute(sql.raw(
  "SELECT COUNT(*) n FROM limit_up_records l LEFT JOIN stock_daily_prices p ON p.stockCode = l.stockCode AND p.tradeDate = l.limitUpDate WHERE p.stockCode IS NULL"
));
console.log("涨停日缺 bar 的记录数:", JSON.stringify(missing?.[0]?.[0] ?? missing?.[0]), "耗时(ms):", Date.now() - t);

// 3. 总涨停记录数 + 主板涨停记录数
const lu: any = await db.execute(sql.raw("SELECT COUNT(*) n FROM limit_up_records"));
console.log("总涨停记录数:", JSON.stringify(lu?.[0]?.[0] ?? lu?.[0]));

// 4. 每日候选数抽样（最近 3 个涨停日各多少候选）
const days: any = await db.execute(sql.raw("SELECT DISTINCT limitUpDate FROM limit_up_records ORDER BY limitUpDate DESC LIMIT 3"));
for (const d of (days?.[0] ?? [])) {
  const c: any = await db.execute(sql.raw("SELECT COUNT(*) n FROM limit_up_records WHERE limitUpDate = '" + d.limitUpDate + "'"));
  console.log("涨停日", d.limitUpDate, "候选数:", c?.[0]?.[0]?.n);
}

process.exit(0);
