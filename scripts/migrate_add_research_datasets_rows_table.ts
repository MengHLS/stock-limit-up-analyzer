import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

/**
 * 幂等迁移：research_datasets 增加 rowsTableName 列（STEP DS-V2-FINAL 分区构建）。
 * 记录该数据集对应的分片行表名（rd_rows_<buildKey>）；NULL = 非分片（内存）构建。
 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库（DATABASE_URL 未配置或连接失败）");

  const [cols] = await db.execute(sql.raw(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'research_datasets'`
  ));
  const existing = new Set((cols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME));

  if (!existing.has("rowsTableName")) {
    await db.execute(sql.raw(`ALTER TABLE research_datasets ADD COLUMN rowsTableName VARCHAR(64) NULL`));
    console.log("OK：已添加 research_datasets.rowsTableName");
  } else {
    console.log("SKIP：research_datasets.rowsTableName 已存在");
  }

  console.log("完成：research_datasets 分片行表关联列已就绪");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("迁移失败：", error);
    process.exit(1);
  });
