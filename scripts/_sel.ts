import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
const db = await getDb();
if (!db) { console.error("no db"); process.exit(1); }
let t = Date.now();
const a: any = await db.execute(sql.raw(
  "SELECT stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice FROM stock_daily_prices WHERE tradeDate >= '2024-11-16' AND tradeDate <= '2026-09-15' AND stockCode IN (SELECT DISTINCT stockCode FROM limit_up_records)"
));
console.log("SELECT 全字段 行数:", (a?.[0] ?? []).length, "耗时(ms):", Date.now() - t);
process.exit(0);
