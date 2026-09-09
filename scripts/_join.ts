import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
const db = await getDb();
if (!db) { console.error("no db"); process.exit(1); }
let t = Date.now();
const a: any = await db.execute(sql.raw(
  "SELECT COUNT(*) n FROM stock_daily_prices p JOIN (SELECT stockCode, MIN(limitUpDate) mn, MAX(limitUpDate) mx FROM limit_up_records GROUP BY stockCode) w ON w.stockCode = p.stockCode WHERE p.tradeDate >= DATE_SUB(w.mn, INTERVAL 25 DAY) AND p.tradeDate <= DATE_ADD(w.mx, INTERVAL 3 DAY)"
));
console.log("候选股涨停窗口行数:", JSON.stringify(a?.[0]?.[0] ?? a?.[0]), "耗时(ms):", Date.now() - t);
process.exit(0);
