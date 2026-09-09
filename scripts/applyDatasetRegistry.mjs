// STEP DATASET-001 — Dataset Registry + 首板回踩独立物理表 migration 应用脚本（幂等）。
// 读取 drizzle/0028_dataset_registry.sql：
//   1) 剥离纯注释行（-- 开头）；
//   2) 按分号切分为单条语句（本 migration 无存储过程/触发器，语句内不含分号）；
//   3) 逐条执行。表用 CREATE TABLE IF NOT EXISTS；索引重复创建（Duplicate key name）被捕获并忽略，
// 重复运行无副作用。TiDB 默认关闭 multi-statement，故逐条单发。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

const sqlText = readFileSync(new URL("../drizzle/0028_dataset_registry.sql", import.meta.url), "utf8");

// 剥离注释行（含行内以 -- 起始的块注释内容），保留真实 DDL。
const lines = sqlText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("--"));
const cleaned = lines.join("\n");

// 按分号切分；去掉 statement-breakpoint 残留（本文件纯 DDL，无 breakpoint 依赖）。
const statements = cleaned
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

let executed = 0;
let skippedDuplicateIndex = 0;
const errors = [];

for (const stmt of statements) {
  try {
    await conn.query(stmt);
    executed += 1;
  } catch (err) {
    const msg = String(err?.message ?? err);
    // CREATE INDEX 幂等：索引已存在（Duplicate key name / Duplicate index）→ 忽略。
    if (/Duplicate key name|Duplicate index|already exists/i.test(msg)) {
      skippedDuplicateIndex += 1;
    } else {
      errors.push({ statement: stmt.slice(0, 80), message: msg });
    }
  }
}

// 验证：6 张表 + 关键唯一约束。
const expectedTables = [
  "dataset_definition",
  "dataset_version",
  "dataset_build_job",
  "ds_first_limit_pullback_event",
  "ds_first_limit_pullback_path",
  "ds_first_limit_pullback_outcome",
];
const tableChecks = {};
for (const t of expectedTables) {
  const [rows] = await conn.query("SHOW TABLES LIKE ?", [t]);
  tableChecks[t] = rows.length > 0;
}

const uniqueIndexes = [
  ["dataset_definition", "dataset_definition_dataset_code_unique"],
  ["dataset_version", "uq_dataset_version_dataset_version"],
  ["dataset_build_job", "dataset_build_job_job_id_unique"],
  ["ds_first_limit_pullback_event", "uq_ds_flp_event_version_event"],
  ["ds_first_limit_pullback_path", "uq_ds_flp_path_version_event_day"],
  ["ds_first_limit_pullback_outcome", "uq_ds_flp_outcome_version_event_horizon"],
];
const uniqueChecks = {};
for (const [table, indexName] of uniqueIndexes) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  );
  uniqueChecks[`${table}.${indexName}`] = Number(rows[0].n) > 0;
}

console.log(JSON.stringify({
  statementsTotal: statements.length,
  statementsExecuted: executed,
  skippedDuplicateIndex,
  errors,
  tables: tableChecks,
  uniqueIndexes: uniqueChecks,
}, null, 2));

await conn.end();

if (errors.length > 0 || Object.values(tableChecks).some((v) => !v)) {
  process.exit(1);
}
