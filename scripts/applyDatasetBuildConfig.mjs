// STEP DATASET-003B — Dataset 构建 / 筛选配置表 migration 应用脚本（幂等）。
//
// 读取 drizzle/0029_dataset_build_config.sql：
//   1) 剥离纯注释行（-- 开头，含 drizzle 生成的 --> statement-breakpoint 标记）；
//   2) 按分号切分为单条语句（本 migration 纯 DDL，语句内不含分号）；
//   3) 逐条执行。表用 CREATE TABLE IF NOT EXISTS；索引重复创建（Duplicate key name）被捕获并忽略，
//      重复运行无副作用。TiDB 默认关闭 multi-statement，故逐条单发。
//
// 验证：3 张表存在 + 3 个唯一约束存在；任一缺失 → exit 1（不静默成功）。
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

const sqlText = readFileSync(new URL("../drizzle/0029_dataset_build_config.sql", import.meta.url), "utf8");

// 剥离注释行（含行内以 -- 起始的块注释内容），保留真实 DDL。
const lines = sqlText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("--"));
const cleaned = lines.join("\n");

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

const expectedTables = [
  "dataset_build_config",
  "dataset_build_config_event",
  "dataset_build_config_board",
];
const tableChecks = {};
for (const t of expectedTables) {
  const [rows] = await conn.query("SHOW TABLES LIKE ?", [t]);
  tableChecks[t] = rows.length > 0;
}

const uniqueIndexes = [
  ["dataset_build_config", "uq_dataset_build_config_version"],
  ["dataset_build_config_event", "uq_dbc_event_config_day_kind"],
  ["dataset_build_config_board", "uq_dbc_board_config_board"],
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

if (errors.length > 0 || Object.values(tableChecks).some((v) => !v) || Object.values(uniqueChecks).some((v) => !v)) {
  process.exit(1);
}
