// STEP DATASET-001 — Dataset Registry + 首板回踩独立物理表 migration 应用脚本（幂等）。
// 读取 drizzle/0028_dataset_registry.sql：
//   1) 剥离纯注释行（-- 开头）；
//   2) 按分号切分为单条语句（本 migration 无存储过程/触发器，语句内不含分号）；
//   3) 逐条执行。表用 CREATE TABLE IF NOT EXISTS；索引重复创建（Duplicate key name）被捕获并忽略，
// 重复运行无副作用。TiDB 默认关闭 multi-statement，故逐条单发。
//
// ⚠ 本脚本只负责 **Registry 三表**（dataset_definition / dataset_version / dataset_build_job）。
//    数据集物理表（event / prefix / post / path / outcome）的**权威 DDL 在
//    `server/datasetRegistry/plugins.ts`**（每个数据集自带表结构，声明式），
//    由 `scripts/applyDatasetWindowLayering.mts` 统一建表 / 就地迁移（DATABASE_REDESIGN §3.5 S4）。
//    0028 中的 legacy 三表 DDL 仅为历史留档，CREATE IF NOT EXISTS 不会覆盖既有表。
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

// 验证：3 张 Registry 表为**硬要求**；5 张物理表由 applyDatasetWindowLayering.mts 负责（缺失只告警）。
const requiredTables = [
  "dataset_definition",
  "dataset_version",
  "dataset_build_job",
];
const physicalTables = [
  "ds_first_limit_pullback_event",
  "ds_first_limit_pullback_prefix",
  "ds_first_limit_pullback_post",
  "ds_first_limit_pullback_path",
  "ds_first_limit_pullback_outcome",
];
const tableChecks = {};
for (const t of [...requiredTables, ...physicalTables]) {
  const [rows] = await conn.query("SHOW TABLES LIKE ?", [t]);
  tableChecks[t] = rows.length > 0;
}

// 唯一约束检查：按「列序列」断言（不依赖索引名，兼容 0028 legacy 命名与插件 DDL 命名）。
const uniqueSpecs = [
  ["dataset_definition", "datasetCode"],
  ["dataset_version", "datasetId,version"],
  ["dataset_build_job", "jobId"],
  ["ds_first_limit_pullback_event", "datasetVersionId,eventId"],
  ["ds_first_limit_pullback_prefix", "datasetVersionId,eventId,relativeDay"],
  ["ds_first_limit_pullback_post", "datasetVersionId,eventId,relativeDay"],
  ["ds_first_limit_pullback_path", "datasetVersionId,eventId,relativeDay"],
  ["ds_first_limit_pullback_outcome", "datasetVersionId,eventId,horizon"],
];
const uniqueChecks = {};
for (const [table, cols] of uniqueSpecs) {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, MAX(NON_UNIQUE) AS nonUnique
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      GROUP BY INDEX_NAME`,
    [table],
  );
  const hit = rows.find((r) => r.cols === cols && Number(r.nonUnique) === 0);
  uniqueChecks[`${table}(${cols})`] = hit ? hit.INDEX_NAME : false;
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

const missingRequired = requiredTables.filter((t) => !tableChecks[t]);
const missingPhysical = physicalTables.filter((t) => !tableChecks[t]);
const badUnique = Object.entries(uniqueChecks).filter(([, v]) => !v).map(([k]) => k);

if (missingPhysical.length > 0) {
  console.warn(
    `⚠ 物理表缺失（请运行 npx tsx scripts/applyDatasetWindowLayering.mts）：${missingPhysical.join(", ")}`,
  );
}

if (errors.length > 0 || missingRequired.length > 0 || badUnique.length > 0) {
  if (badUnique.length > 0) console.error(`❌ 唯一约束缺失：${badUnique.join(" | ")}`);
  process.exit(1);
}
