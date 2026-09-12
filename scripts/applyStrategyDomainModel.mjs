// STEP STRATEGY-003 — Strategy Domain Model migration 应用脚本（幂等 + 可断言）。
//
// 与既有 applyStrategyPersistence.mjs 的差异：
//   本 migration 以 ALTER TABLE ADD COLUMN / CREATE INDEX 为主（`IF NOT EXISTS` 在 MySQL/TiDB 上
//   支持不一致），因此脚本按 SQL 内的 `-- @guard: <kind> <target>` 指令**先查 information_schema
//   再执行**，重复运行完全无副作用；不带 guard 的语句（如 CREATE TABLE IF NOT EXISTS）直接执行。
//
// 用法：
//   node scripts/applyStrategyDomainModel.mjs              # 应用（幂等）
//   node scripts/applyStrategyDomainModel.mjs --dry-run    # 只报告将执行/将跳过的语句，不执行 DDL
//   node scripts/applyStrategyDomainModel.mjs --check      # 只读断言（7 表 / 列 / 索引），不执行 DDL
//
// guard 种类：
//   column <table>.<column>   → information_schema.COLUMNS
//   index  <table>.<index>    → information_schema.STATISTICS
//   table  <table>            → information_schema.TABLES
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "apply";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const urlMatch = env.match(/DATABASE_URL=(\S+)/);
if (!urlMatch) throw new Error(".env 中缺少 DATABASE_URL");
const url = urlMatch[1].replace(/["']/g, "");
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

const sqlText = readFileSync(new URL("../drizzle/0034_strategy_domain_model.sql", import.meta.url), "utf8");
const chunks = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** 从语句块中提取 `-- @guard: kind target`；返回 { kind, target, sql }。 */
function parseChunk(chunk) {
  const guardMatch = chunk.match(/^--\s*@guard:\s*(\w+)\s+(\S+)\s*$/m);
  const sql = chunk
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
  if (sql.length === 0) {
    return { kind: null, target: null, sql: "" };
  }
  if (!guardMatch) {
    return { kind: null, target: null, sql };
  }
  return { kind: guardMatch[1], target: guardMatch[2], sql };
}

async function exists(kind, target) {
  if (kind === "table") {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [target],
    );
    return Number(rows[0].n) > 0;
  }
  const [table, name] = target.split(".");
  if (!table || !name) throw new Error(`@guard 目标格式非法（应为 table.column 或 table.index）：${target}`);
  if (kind === "column") {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [table, name],
    );
    return Number(rows[0].n) > 0;
  }
  if (kind === "index") {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
      [table, name],
    );
    return Number(rows[0].n) > 0;
  }
  throw new Error(`未知 @guard 种类：${kind}`);
}

const executed = [];
const skipped = [];

if (MODE !== "check") {
  for (const chunk of chunks) {
    const { kind, target, sql } = parseChunk(chunk);
    if (sql.length === 0) continue;
    let needed = true;
    if (kind !== null) {
      needed = !(await exists(kind, target));
    }
    if (!needed) {
      skipped.push(`${kind}:${target}`);
      continue;
    }
    if (MODE === "apply") {
      await conn.query(sql);
    }
    executed.push(kind === null ? sql.split("\n")[0].slice(0, 70) : `${kind}:${target}`);
  }
}

// ---------------------------------------------------------------------------
// 断言（SPEC §42：真实 DB 必须验 7 张 Strategy Domain 表 + 关键列 + 关键约束）
// ---------------------------------------------------------------------------

const EXPECTED_TABLES = [
  "strategies",
  "strategy_versions",
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_version_datasets",
];

const EXPECTED_COLUMNS = [
  "strategies.description",
  "strategies.strategyType",
  "strategies.currentVersionId",
  "strategy_versions.parentVersionId",
  "strategy_versions.status",
  "strategy_versions.description",
  "strategy_versions.updatedAt",
];

const EXPECTED_INDEXES = [
  "strategy_versions.uq_strategy_versions_id_version",
  "strategy_versions.idx_strategy_versions_parent",
  "strategy_versions.idx_strategy_versions_status",
  "strategy_parameters.uq_strategy_parameters_version_code",
  "strategy_entry_rules.uq_strategy_entry_rules_version_rule",
  "strategy_exit_rules.uq_strategy_exit_rules_version_rule",
  "strategy_execution_rules.uq_strategy_execution_rules_version",
  "strategy_version_datasets.uq_strategy_version_datasets_binding",
];

const tableResults = [];
for (const t of EXPECTED_TABLES) {
  tableResults.push({ name: t, present: await exists("table", t) });
}
const columnResults = [];
for (const c of EXPECTED_COLUMNS) {
  columnResults.push({ name: c, present: await exists("column", c) });
}
const indexResults = [];
for (const i of EXPECTED_INDEXES) {
  indexResults.push({ name: i, present: await exists("index", i) });
}

const failures = [
  ...tableResults.filter((r) => !r.present).map((r) => `缺表：${r.name}`),
  ...columnResults.filter((r) => !r.present).map((r) => `缺列：${r.name}`),
  ...indexResults.filter((r) => !r.present).map((r) => `缺索引/约束：${r.name}`),
];

// 行数（迁移前必须为 0，迁移后由业务写入；此处只报告，不判定）
const counts = {};
for (const t of EXPECTED_TABLES) {
  if (!tableResults.find((r) => r.name === t)?.present) {
    counts[t] = null;
    continue;
  }
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
  counts[t] = Number(rows[0].n);
}

console.log(JSON.stringify({
  mode: MODE,
  statementsTotal: chunks.length,
  executed,
  skipped,
  tables: tableResults,
  columns: columnResults,
  indexes: indexResults,
  rowCounts: counts,
  failures,
  pass: failures.length === 0,
}, null, 2));

await conn.end();
if (failures.length > 0) process.exit(1);
