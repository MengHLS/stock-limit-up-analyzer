import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no db"); process.exit(1); }

// 1. 索引结构
const idx: any = await db.execute(sql.raw(
  "SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, NON_UNIQUE FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('stock_daily_prices','limit_up_records') GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME"
));
console.log("索引:", JSON.stringify(idx?.[0] ?? idx, null, 0));

// 2. 有界 SELECT 纯查询耗时（只取一行，测 DB 扫描成本）
let t = Date.now();
const one: any = await db.execute(sql.raw(
  "SELECT stockCode FROM stock_daily_prices WHERE tradeDate >= '2024-11-16' AND tradeDate <= '2026-09-15' AND stockCode IN (SELECT DISTINCT stockCode FROM limit_up_records) LIMIT 1"
));
console.log("有界查询 LIMIT 1 耗时(ms):", Date.now() - t);

// 3. 有界 SELECT 全部字段 + 行数（真实回测查询，测完整成本）
t = Date.now();
const all: any = await db.execute(sql.raw(
  "SELECT stockCode, tradeDate, openPrice, closePrice, highPrice, lowPrice, amount, volume, preClosePrice FROM stock_daily_prices WHERE tradeDate >= '2024-11-16' AND tradeDate <= '2026-09-15' AND stockCode IN (SELECT DISTINCT stockCode FROM limit_up_records)"
));
const rows = all?.[0] ?? [];
console.log("有界全字段 SELECT 行数:", rows.length, "耗时(ms):", Date.now() - t);

// 4. 范围（tradeDate only，无 code 过滤）行数
t = Date.now();
const rng: any = await db.execute(sql.raw(
  "SELECT COUNT(*) n FROM stock_daily_prices WHERE tradeDate >= '2024-11-16' AND tradeDate <= '2026-09-15'"
));
console.log("仅 tradeDate 范围行数:", JSON.stringify(rng?.[0]?.[0] ?? rng?.[0]), "耗时(ms):", Date.now() - t);

process.exit(0);
