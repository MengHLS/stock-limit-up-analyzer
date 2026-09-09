import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
const db = await getDb();
if (!db) { console.error("no db"); process.exit(1); }

let t = Date.now();
const c1: any = await db.execute(sql.raw("SELECT COUNT(*) n FROM stock_daily_prices WHERE tradeDate >= '2024-11-16' AND tradeDate <= '2026-09-15'"));
console.log("C1 仅日期范围行数:", JSON.stringify(c1?.[0]?.[0] ?? c1?.[0]), "耗时(ms):", Date.now() - t);

t = Date.now();
const c2: any = await db.execute(sql.raw("SELECT COUNT(*) n FROM stock_daily_prices WHERE tradeDate >= '2024-11-16' AND tradeDate <= '2026-09-15' AND stockCode IN (SELECT DISTINCT stockCode FROM limit_up_records)"));
console.log("C2 子查询COUNT行数:", JSON.stringify(c2?.[0]?.[0] ?? c2?.[0]), "耗时(ms):", Date.now() - t);

t = Date.now();
const ex: any = await db.execute(sql.raw("EXPLAIN SELECT stockCode FROM stock_daily_prices WHERE tradeDate >= '2024-11-16' AND tradeDate <= '2026-09-15' AND stockCode IN (SELECT DISTINCT stockCode FROM limit_up_records)"));
console.log("EXPLAIN:", JSON.stringify(ex?.[0] ?? ex));
process.exit(0);
