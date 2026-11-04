// RESEARCH-PLANNER-001 — 通用**幂等** SQL migration 执行器（真实 TiDB，按 information_schema 守卫）。
//
// 为什么要有它：本项目已有 4 个「一个 migration 一个脚本」的 bespoke 脚本，每个都把
// 「解析 guard / 查 information_schema / 执行 / 前后对比」重写一遍。重写 4 遍意味着
// 4 个地方可能出现同一种 bug（例如 guard 判断写歪导致重复 ALTER）。
// 本脚本把这层抽成**一个**通用执行器；migration 自身的语义断言（列类型 / 索引链 / 行数）
// 仍建议在 migration 专属脚本里做 —— 通用执行器只保证「该执行的执行了、不该执行的没执行」。
//
// 用法：
//   node scripts/applySqlMigration.mjs drizzle/0040_xxx.sql             # 应用（幂等）
//   node scripts/applySqlMigration.mjs drizzle/0040_xxx.sql --dry-run   # 只报告将执行 / 将跳过
//   node scripts/applySqlMigration.mjs drizzle/0040_xxx.sql --check     # 只读：断言全部已应用，不执行 DDL
//
// SQL 文件约定（与既有 migration 完全一致）：
//   - 语句之间用 `--> statement-breakpoint` 分隔；
//   - 语句前可放 `-- @guard: <kind> <target>`（同一语句的守卫）：
//       column <table>.<column>   —— 列已存在则跳过
//       index  <table>.<index>    —— 索引已存在则跳过
//       table  <table>            —— 表已存在则跳过
//   - 无 guard 的语句**总是**执行（迁移文件里应避免无 guard 语句，除非它本身幂等，如 CREATE TABLE IF NOT EXISTS）。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const MODE = args.includes("--check") ? "check" : args.includes("--dry-run") ? "dry-run" : "apply";
const sqlPathRaw = args.find((a) => !a.startsWith("--"));
if (!sqlPathRaw) {
  console.error("用法：node scripts/applySqlMigration.mjs <sql-file> [--dry-run|--check]");
  process.exit(2);
}
const SQL_PATH = resolve(process.cwd(), sqlPathRaw);
const sqlText = readFileSync(SQL_PATH, "utf8");

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const urlMatch = env.match(/DATABASE_URL=(\S+)/);
if (!urlMatch) throw new Error(".env 中缺少 DATABASE_URL");
const u = new URL(urlMatch[1].replace(/["']/g, ""));

const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 20000,
});

// ---------------------------------------------------------------------------
// guard 查询
// ---------------------------------------------------------------------------

async function tableExists(table) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  );
  return Number(rows[0].n) > 0;
}

async function columnExists(table, column) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  return Number(rows[0].n) > 0;
}

async function indexExists(table, index) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [table, index],
  );
  return Number(rows[0].n) > 0;
}

/**
 * 列是否**已经可空**（`IS_NULLABLE = 'YES'`）。
 *
 * RESEARCH-EXPERIMENT-002 新增的 guard 种类，用于 `MODIFY COLUMN … NULL` 这类
 * **放宽约束**的 DDL：重复执行的**效果**幂等，但 `--check` 需要能判定「已经放宽过了」，
 * 否则该语句在 check 模式下会被当成「无 guard 语句」而总是执行。
 */
async function columnNullable(table, column) {
  const [rows] = await conn.query(
    "SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  if (rows.length === 0) throw new Error(`@guard nullable 的列不存在：${table}.${column}`);
  return String(rows[0].n).toUpperCase() === "YES";
}

/** 守卫判定：返回 true 表示**已经满足**（⇒ 跳过）。 */
async function guardSatisfied(kind, target) {
  if (kind === "table") return tableExists(target);
  const dot = target.indexOf(".");
  if (dot <= 0) throw new Error(`@guard 目标格式非法（应为 <table>.<name>）：${target}`);
  const table = target.slice(0, dot);
  const name = target.slice(dot + 1);
  if (kind === "column") return columnExists(table, name);
  if (kind === "index") return indexExists(table, name);
  if (kind === "nullable") return columnNullable(table, name);
  throw new Error(`未知 @guard 种类：${kind}`);
}

// ---------------------------------------------------------------------------
// 语句解析
// ---------------------------------------------------------------------------

const GUARD_RE = /^--\s*@guard:\s*(\w+)\s+(\S+)\s*$/m;

const statements = sqlText
  .split(/-->\s*statement-breakpoint/)
  .map((chunk) => {
    const guard = GUARD_RE.exec(chunk);
    // 去掉全部纯注释行，得到真正要执行的 SQL。
    const body = chunk
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    return {
      guardKind: guard ? guard[1] : null,
      guardTarget: guard ? guard[2] : null,
      body,
    };
  })
  .filter((s) => s.body !== "");

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

const report = [];
let executed = 0;
let skipped = 0;
let alreadyApplied = 0;

for (const stmt of statements) {
  const label = stmt.guardTarget ? `${stmt.guardKind} ${stmt.guardTarget}` : "(no guard)";
  if (stmt.guardKind !== null) {
    const exists = await guardSatisfied(stmt.guardKind, stmt.guardTarget);
    if (exists) {
      alreadyApplied += 1;
      if (MODE !== "check") skipped += 1;
      report.push({ label, action: "skip-exists" });
      continue;
    }
  }
  if (MODE === "check") {
    report.push({ label, action: "MISSING" });
    continue;
  }
  if (MODE === "dry-run") {
    report.push({ label, action: "would-execute" });
    continue;
  }
  await conn.query(stmt.body);
  executed += 1;
  report.push({ label, action: "executed" });
}

// ---------------------------------------------------------------------------
// 只读复核：migration 涉及的对象现在是否齐备
// ---------------------------------------------------------------------------

const verify = [];
for (const stmt of statements) {
  if (stmt.guardKind === null) continue;
  const ok = await guardSatisfied(stmt.guardKind, stmt.guardTarget);
  verify.push({ label: `${stmt.guardKind} ${stmt.guardTarget}`, present: ok });
}
const missing = verify.filter((v) => !v.present);

const [fkRow] = await conn.query(
  "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
);

const out = {
  mode: MODE,
  sqlFile: sqlPathRaw,
  statementCount: statements.length,
  executed,
  skippedExisting: alreadyApplied,
  missingAfterRun: missing.map((m) => m.label),
  pass: missing.length === 0,
  foreignKeyCountInSchema: Number(fkRow[0].n),
  statements: report,
};

console.log(JSON.stringify(out, null, 2));
await conn.end();
process.exit(out.pass ? 0 : 1);
