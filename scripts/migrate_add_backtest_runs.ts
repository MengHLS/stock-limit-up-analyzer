import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

/**
 * 幂等迁移：创建 backtest_runs 回测结果持久化表。
 * 项目历史采用 push 而非 migrate 日志，直接执行增量 DDL 更安全。
 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库（DATABASE_URL 未配置或连接失败）");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      paramsHash VARCHAR(64) NOT NULL,
      paramsJson TEXT NOT NULL,
      summaryJson TEXT NULL,
      resultJson LONGTEXT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_backtest_runs_hash (paramsHash),
      INDEX idx_backtest_runs_created (createdAt)
    )
  `));
  console.log("OK：backtest_runs 表已就绪（已存在则跳过）");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("迁移失败：", error);
    process.exit(1);
  });
