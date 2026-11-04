import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

/**
 * 幂等迁移：为 stock_daily_prices 增加 highPrice、volume 两列。
 * 项目历史采用 push 而非 migrate 日志，直接执行增量 DDL 更安全。
 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库（DATABASE_URL 未配置或连接失败）");

  const columns = await db.execute(
    sql`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_daily_prices'`,
  );
  const existing = new Set((columns[0] as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME));

  const additions: string[] = [];
  if (!existing.has("highPrice")) additions.push("ADD COLUMN \`highPrice\` VARCHAR(24) NULL");
  if (!existing.has("volume")) additions.push("ADD COLUMN \`volume\` VARCHAR(32) NULL");

  if (additions.length === 0) {
    console.log("SKIP：highPrice、volume 列均已存在");
    return;
  }

  await db.execute(sql.raw(`ALTER TABLE stock_daily_prices ${additions.join(", ")}`));
  console.log(`OK：已新增列 ${additions.map((item) => item.match(/ADD COLUMN `([^`]+)`/)?.[1]).join("、")}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("迁移失败：", error);
    process.exit(1);
  });
