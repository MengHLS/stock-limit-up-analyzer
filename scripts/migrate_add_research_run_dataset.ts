import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

/**
 * 幂等迁移：research_runs 增加 datasetId / datasetVersion / datasetFingerprint 三列（STEP DS-V2）。
 * 项目历史采用 push 而非 migrate 日志，直接执行增量 DDL 更安全。
 * 三列可空：legacy 路径 Run 保持 NULL。
 */
async function main() {
  const db = await getDb();
  if (!db) throw new Error("无法连接数据库（DATABASE_URL 未配置或连接失败）");

  // MySQL/TiDB 的 ADD COLUMN IF NOT EXISTS 支持有限，逐列探测后按需添加。
  const [cols] = await db.execute(sql.raw(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'research_runs'`
  ));
  const existing = new Set((cols as { COLUMN_NAME: string }[]).map((c) => c.COLUMN_NAME));

  const addIfMissing = async (column: string, ddl: string) => {
    if (!existing.has(column)) {
      await db.execute(sql.raw(ddl));
      console.log(`OK：已添加 research_runs.${column}`);
    } else {
      console.log(`SKIP：research_runs.${column} 已存在`);
    }
  };

  await addIfMissing("datasetId", `ALTER TABLE research_runs ADD COLUMN datasetId VARCHAR(128) NULL`);
  await addIfMissing("datasetVersion", `ALTER TABLE research_runs ADD COLUMN datasetVersion VARCHAR(96) NULL`);
  await addIfMissing("datasetFingerprint", `ALTER TABLE research_runs ADD COLUMN datasetFingerprint VARCHAR(64) NULL`);

  // 索引（幂等：存在则跳过）。
  const [idx] = await db.execute(sql.raw(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'research_runs' AND INDEX_NAME = 'idx_research_runs_dataset_version'`
  ));
  const idxCount = Number((idx as { c: number | string }[])[0]?.c ?? 0);
  if (idxCount === 0) {
    await db.execute(sql.raw(`CREATE INDEX idx_research_runs_dataset_version ON research_runs (datasetVersion)`));
    console.log("OK：已创建 idx_research_runs_dataset_version");
  } else {
    console.log("SKIP：idx_research_runs_dataset_version 已存在");
  }

  console.log("完成：research_runs Dataset 绑定三列已就绪");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("迁移失败：", error);
    process.exit(1);
  });
