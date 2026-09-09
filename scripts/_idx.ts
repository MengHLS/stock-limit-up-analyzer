import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
const db = await getDb();
if (!db) { console.error("no db"); process.exit(1); }
const idx: any = await db.execute(sql.raw(
  "SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, NON_UNIQUE FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('stock_daily_prices','limit_up_records') GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME"
));
console.log("索引:", JSON.stringify(idx?.[0] ?? idx));
process.exit(0);
