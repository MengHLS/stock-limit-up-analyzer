import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

/**
 * 幂等迁移：创建 research_datasets 研究数据集持久化表（P2-T1 / G2）。
 * 项目历史采用 push 而非 migrate 日志，直接执行增量 DDL 更安全。
 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库（DATABASE_URL 未配置或连接失败）");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS research_datasets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      datasetId VARCHAR(128) NOT NULL UNIQUE,
      datasetVersion VARCHAR(96) NOT NULL,
      name VARCHAR(128) NOT NULL,
      startDate DATE NOT NULL,
      endDate DATE NOT NULL,
      asOfPerTradeDate ENUM('true','false') NOT NULL DEFAULT 'true',
      asOf DATE NULL,
      rowsFingerprint VARCHAR(64) NOT NULL,
      policySetFingerprint VARCHAR(64) NOT NULL,
      versionSnapshotFingerprint VARCHAR(64) NOT NULL,
      versionSnapshotJson LONGTEXT NOT NULL,
      dataSnapshotJson LONGTEXT NOT NULL,
      universeDefinitionJson LONGTEXT NOT NULL,
      rowCount INT NOT NULL,
      gate VARCHAR(16) NOT NULL,
      gateNotesJson LONGTEXT NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_research_datasets_version (datasetVersion),
      INDEX idx_research_datasets_name (name),
      INDEX idx_research_datasets_created (createdAt)
    )
  `));
  console.log("OK：research_datasets 表已就绪（已存在则跳过）");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("迁移失败：", error);
    process.exit(1);
  });
