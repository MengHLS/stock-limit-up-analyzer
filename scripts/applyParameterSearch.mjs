// PARAMETER-001 — Parameter Search 三表 migration 应用脚本。
//
// 与 applyClosedLoopBacktestRun.mjs / applyResearchStrategyBridge.mjs 同一引擎、同一纪律：
//   按 SQL 内的 `-- @guard: <kind> <target>` 指令**先查 information_schema 再执行**，
//   重复运行完全无副作用；不带 guard 的语句直接执行。
//
// 用法：
//   node scripts/applyParameterSearch.mjs              # 应用（幂等）+ 前后对比断言
//   node scripts/applyParameterSearch.mjs --dry-run    # 只报告将执行/将跳过的语句 + 当前断言
//   node scripts/applyParameterSearch.mjs --check      # 只读断言，不执行任何 DDL
//
// guard 种类：column <table>.<column> | index <table>.<index> | table <table>
//
// 断言（真实 TiDB information_schema，不依赖 drizzle schema）：
//   A. 三张新表存在 + 逐列**名称/顺序/基础类型/长度/可空性**比对
//   B. 各表索引存在且列序正确（含 UNIQUE）
//   C. 零 FK：三张新表各 0 + 全库 0
//   D. 既有表**零意外变化**：列签名 apply 前后逐表自比对
//   E. 行数：既有表 apply 前后逐表比对（必须完全一致）；三张新表必须 0 行
//
// 🔴 顶层 catch 必须摊开 cause 链（Drizzle/mysql2 会把根因包在外层）—— 见 PROJECT_RULES。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "apply";

const SQL_FILE = "../drizzle/0041_parameter_search.sql";

// ---------------------------------------------------------------------------
// 期望结构（唯一权威 = drizzle/schema.ts#parameterSearch*；此处冻结一份用于真库比对）
// ---------------------------------------------------------------------------

const EXPECTED = {
  parameter_search_run: {
    columns: [
      { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
      { column: "searchRunId", base: "varchar", len: 80, nullable: "NO", key: "UNI" },
      { column: "strategyId", base: "varchar", len: 64, nullable: "NO", key: "MUL" },
      { column: "strategyVersion", base: "varchar", len: 32, nullable: "NO", key: "" },
      { column: "datasetVersionId", base: "bigint", nullable: "YES", key: "" },
      { column: "datasetVersionLabel", base: "varchar", len: 96, nullable: "YES", key: "" },
      { column: "startDate", base: "date", nullable: "NO", key: "" },
      { column: "endDate", base: "date", nullable: "NO", key: "" },
      { column: "searchMethod", base: "varchar", len: 24, nullable: "NO", key: "" },
      { column: "status", base: "varchar", len: 16, nullable: "NO", key: "MUL" },
      { column: "parameterSpaceJson", base: "longtext", nullable: "NO", key: "" },
      { column: "parameterSpaceFingerprint", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "fixedCoordinatesJson", base: "text", nullable: "NO", key: "" },
      { column: "executionPolicyVersion", base: "int", nullable: "NO", key: "" },
      { column: "evaluationConfigFingerprint", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "combinationCount", base: "int", nullable: "NO", key: "" },
      { column: "completedCount", base: "int", nullable: "NO", key: "" },
      { column: "failedCount", base: "int", nullable: "NO", key: "" },
      { column: "combinationSetFingerprint", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "notesJson", base: "longtext", nullable: "YES", key: "" },
      { column: "errorCode", base: "varchar", len: 64, nullable: "YES", key: "" },
      { column: "errorMessage", base: "text", nullable: "YES", key: "" },
      { column: "createdAt", base: "timestamp", nullable: "NO", key: "MUL" },
      { column: "startedAt", base: "timestamp", nullable: "YES", key: "" },
      { column: "completedAt", base: "timestamp", nullable: "YES", key: "" },
      { column: "updatedAt", base: "timestamp", nullable: "NO", key: "" },
    ],
    indexes: [
      { name: "uq_parameter_search_run_id", unique: true, columns: "searchRunId" },
      { name: "idx_parameter_search_run_created", unique: false, columns: "createdAt" },
      { name: "idx_parameter_search_run_strategy", unique: false, columns: "strategyId,createdAt" },
      { name: "idx_parameter_search_run_status", unique: false, columns: "status" },
    ],
  },
  parameter_search_combination: {
    columns: [
      { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
      { column: "searchRunId", base: "varchar", len: 80, nullable: "NO", key: "MUL" },
      { column: "combinationIndex", base: "int", nullable: "NO", key: "" },
      { column: "parameterHash", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "parametersJson", base: "longtext", nullable: "NO", key: "" },
      // ⚠️ 判据订正（首次运行实测）：`status` 只是复合索引 `(searchRunId, status)` 的**第二列**
      // ⇒ information_schema.COLUMN_KEY 为空串（只有索引首列才标 MUL）。不是表结构问题。
      { column: "status", base: "varchar", len: 16, nullable: "NO", key: "" },
      { column: "attemptCount", base: "int", nullable: "NO", key: "" },
      { column: "lastError", base: "text", nullable: "YES", key: "" },
      { column: "createdAt", base: "timestamp", nullable: "NO", key: "" },
      { column: "updatedAt", base: "timestamp", nullable: "NO", key: "" },
    ],
    indexes: [
      { name: "uq_parameter_search_combination_hash", unique: true, columns: "searchRunId,parameterHash" },
      { name: "idx_parameter_search_combination_run", unique: false, columns: "searchRunId,combinationIndex" },
      { name: "idx_parameter_search_combination_status", unique: false, columns: "searchRunId,status" },
    ],
  },
  parameter_search_result: {
    columns: [
      { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
      { column: "searchRunId", base: "varchar", len: 80, nullable: "NO", key: "MUL" },
      { column: "combinationIndex", base: "int", nullable: "NO", key: "" },
      { column: "parameterHash", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "parametersJson", base: "longtext", nullable: "NO", key: "" },
      // ⚠️ 判据订正（首次运行实测）：`status` 只是复合索引 `(searchRunId, status)` 的**第二列**
      // ⇒ information_schema.COLUMN_KEY 为空串（只有索引首列才标 MUL）。不是表结构问题。
      { column: "status", base: "varchar", len: 16, nullable: "NO", key: "" },
      { column: "error", base: "text", nullable: "YES", key: "" },
      { column: "totalReturnPct", base: "double", nullable: "YES", key: "" },
      { column: "annualizedReturnPct", base: "double", nullable: "YES", key: "" },
      { column: "maxDrawdownPct", base: "double", nullable: "YES", key: "" },
      { column: "tradeCount", base: "int", nullable: "YES", key: "" },
      { column: "winRatePct", base: "double", nullable: "YES", key: "" },
      { column: "profitFactor", base: "double", nullable: "YES", key: "" },
      { column: "metricsSource", base: "varchar", len: 16, nullable: "NO", key: "" },
      { column: "annualizationBasisJson", base: "text", nullable: "YES", key: "" },
      { column: "backtestFingerprint", base: "varchar", len: 64, nullable: "YES", key: "" },
      { column: "backtestRunId", base: "varchar", len: 80, nullable: "YES", key: "" },
      { column: "evaluationId", base: "varchar", len: 80, nullable: "YES", key: "" },
      { column: "evaluationRunId", base: "varchar", len: 160, nullable: "YES", key: "" },
      { column: "evaluationJson", base: "longtext", nullable: "YES", key: "" },
      { column: "reproductionJson", base: "text", nullable: "YES", key: "" },
      { column: "createdAt", base: "timestamp", nullable: "NO", key: "" },
      { column: "updatedAt", base: "timestamp", nullable: "NO", key: "" },
    ],
    indexes: [
      { name: "uq_parameter_search_result_hash", unique: true, columns: "searchRunId,parameterHash" },
      { name: "idx_parameter_search_result_run", unique: false, columns: "searchRunId,combinationIndex" },
      { name: "idx_parameter_search_result_status", unique: false, columns: "searchRunId,status" },
    ],
  },
};

const NEW_TABLES = Object.keys(EXPECTED);

/** 既有表：证明本 migration 没有意外改动它们（apply 前后自比对列签名 + 行数）。 */
const EXISTING_TABLES = [
  "closed_loop_backtest_run", "backtest_runs", "strategies", "strategy_versions",
  "strategy_parameters", "research_experiment", "research_run", "research_result",
  "research_strategy_candidate", "dataset_definition", "dataset_version",
  "research_finding", "research_plan", "users",
];

// ---------------------------------------------------------------------------
// 连接（.env 的 DATABASE_URL；TiDB Cloud 需 ssl）
// ---------------------------------------------------------------------------

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
  connectTimeout: 15000,
});

// ---------------------------------------------------------------------------
// 只读探针
// ---------------------------------------------------------------------------

async function tableExists(table) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  );
  return Number(rows[0].n) > 0;
}

async function columnInfo(table, column) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  return rows[0];
}

async function columnList(table) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? " +
      "ORDER BY ORDINAL_POSITION",
    [table],
  );
  return rows.map((r) => r.COLUMN_NAME);
}

async function indexInfo(table, index) {
  const [rows] = await conn.query(
    "SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols " +
      "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? " +
      "GROUP BY INDEX_NAME, NON_UNIQUE",
    [table, index],
  );
  return rows[0];
}

async function fkCount(table) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
    [table],
  );
  return Number(rows[0].n);
}

async function schemaFkTotal() {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
  );
  return Number(rows[0].n);
}

async function rowCount(table) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return Number(rows[0].n);
}

/** 拆出基础类型与长度（TiDB 会把 int 报成 int(11)，需要宽松归一化）。 */
function parseType(t) {
  const s = String(t).toLowerCase().trim();
  const m = s.match(/^([a-z]+)(?:\((\d+)(?:,(\d+))?\))?/);
  if (!m) return { base: s, len: null };
  return { base: m[1], len: m[2] ? Number(m[2]) : null };
}

// ---------------------------------------------------------------------------
// 执行 migration
// ---------------------------------------------------------------------------

const sqlText = readFileSync(new URL(SQL_FILE, import.meta.url), "utf8");
const chunks = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

function parseChunk(chunk) {
  const guardMatch = chunk.match(/^--\s*@guard:\s*(\w+)\s+(\S+)\s*$/m);
  const sql = chunk
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
  if (sql.length === 0) return { kind: null, target: null, sql: "" };
  if (!guardMatch) return { kind: null, target: null, sql };
  return { kind: guardMatch[1], target: guardMatch[2], sql };
}

async function guardExists(kind, target) {
  if (kind === "table") return tableExists(target);
  const [table, name] = target.split(".");
  if (!table || !name) throw new Error(`@guard 目标格式非法：${target}`);
  if (kind === "column") return (await columnInfo(table, name)) !== undefined;
  if (kind === "index") return (await indexInfo(table, name)) !== undefined;
  throw new Error(`未知 @guard 种类：${kind}`);
}

const executed = [];
const skipped = [];

const beforeRowCounts = {};
const beforeColumns = {};
for (const t of EXISTING_TABLES) {
  beforeRowCounts[t] = await rowCount(t);
  beforeColumns[t] = await columnList(t);
}

if (MODE !== "check") {
  for (const chunk of chunks) {
    const { kind, target, sql } = parseChunk(chunk);
    if (sql.length === 0) continue;
    const needed = kind === null ? true : !(await guardExists(kind, target));
    if (!needed) {
      skipped.push(`${kind}:${target}`);
      continue;
    }
    if (MODE === "apply") await conn.query(sql);
    executed.push(kind === null ? sql.split("\n")[0].slice(0, 70) : `${kind}:${target}`);
  }
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

const failures = [];
const notes = [];
const tableReports = [];

for (const table of NEW_TABLES) {
  const spec = EXPECTED[table];
  const exists = await tableExists(table);
  if (!exists) {
    failures.push(`缺表：${table}`);
    tableReports.push({ table, exists: false });
    continue;
  }

  const actualList = await columnList(table);
  const expectedList = spec.columns.map((c) => c.column);
  const orderOk =
    actualList.length === expectedList.length && actualList.every((c, i) => c === expectedList[i]);
  if (!orderOk) {
    failures.push(`列集/顺序不符：${table} 期望 ${expectedList.length} 列，实际 ${actualList.length} 列`);
  }

  const columnReports = [];
  for (const columnSpec of spec.columns) {
    const info = await columnInfo(table, columnSpec.column);
    if (info === undefined) {
      failures.push(`缺列：${table}.${columnSpec.column}`);
      columnReports.push({ column: columnSpec.column, present: false, ok: false });
      continue;
    }
    const pt = parseType(info.COLUMN_TYPE);
    const baseOk = pt.base === columnSpec.base;
    const lenOk = columnSpec.len === undefined ? true : pt.len === columnSpec.len;
    const nullOk = info.IS_NULLABLE === columnSpec.nullable;
    const keyOk = columnSpec.key === undefined ? true : info.COLUMN_KEY === columnSpec.key;
    const ok = baseOk && lenOk && nullOk && keyOk;
    if (!baseOk) failures.push(`列基础类型不符：${table}.${columnSpec.column} 实际 ${info.COLUMN_TYPE}，期望 ${columnSpec.base}`);
    else if (!lenOk) failures.push(`列长度不符：${table}.${columnSpec.column} 实际 ${info.COLUMN_TYPE}，期望长度 ${columnSpec.len}`);
    else if (!nullOk) failures.push(`列可空性不符：${table}.${columnSpec.column} 实际 ${info.IS_NULLABLE}，期望 ${columnSpec.nullable}`);
    else if (!keyOk) failures.push(`列键不符：${table}.${columnSpec.column} 实际 ${info.COLUMN_KEY}，期望 ${columnSpec.key}`);
    columnReports.push({
      column: columnSpec.column,
      present: true,
      type: info.COLUMN_TYPE,
      nullable: info.IS_NULLABLE,
      key: info.COLUMN_KEY,
      ok,
    });
  }

  const indexReports = [];
  for (const indexSpec of spec.indexes) {
    const info = await indexInfo(table, indexSpec.name);
    const uniqueOk = info !== undefined && (Number(info.NON_UNIQUE) === 0) === indexSpec.unique;
    const colsOk = info !== undefined && info.cols === indexSpec.columns;
    if (info === undefined) failures.push(`缺索引/约束：${table}.${indexSpec.name}`);
    else if (!uniqueOk) failures.push(`唯一性不符：${indexSpec.name} unique=${Number(info.NON_UNIQUE) === 0}，期望 ${indexSpec.unique}`);
    else if (!colsOk) failures.push(`索引列不符：${indexSpec.name} = (${info.cols})，期望 (${indexSpec.columns})`);
    indexReports.push({
      name: indexSpec.name,
      present: info !== undefined,
      unique: info ? Number(info.NON_UNIQUE) === 0 : null,
      columns: info?.cols ?? null,
      ok: uniqueOk && colsOk,
    });
  }

  const fk = await fkCount(table);
  if (fk !== 0) failures.push(`${table} 出现 FK（应为 0）：${fk}`);
  const rows = await rowCount(table);
  if (rows !== 0) notes.push(`注意：${table} 已有 ${rows} 行（非本次 migration 写入）`);

  tableReports.push({
    table,
    exists: true,
    rows,
    columns: columnReports,
    indexes: indexReports,
    fk,
  });
}

const fkTotal = await schemaFkTotal();
if (fkTotal !== 0) failures.push(`全库出现 FK（应为 0）：${fkTotal}`);

const schemaDiff = [];
for (const t of EXISTING_TABLES) {
  const now = await columnList(t);
  const base = beforeColumns[t];
  const same = now.length === base.length && now.every((c, i) => c === base[i]);
  schemaDiff.push({ table: t, ok: same, columns: now.length });
  if (!same) failures.push(`既有表列签名变化：${t}（迁移前 ${base.length} 列 → 迁移后 ${now.length} 列）`);
}

const rowDiff = [];
for (const t of EXISTING_TABLES) {
  const after = await rowCount(t);
  rowDiff.push({ table: t, before: beforeRowCounts[t], after, changed: beforeRowCounts[t] !== after });
  if (beforeRowCounts[t] !== after) {
    failures.push(`行数变化：${t} ${beforeRowCounts[t]} → ${after}`);
  }
}

console.log(
  JSON.stringify(
    {
      mode: MODE,
      statementsTotal: chunks.length,
      executed,
      skipped,
      tables: tableReports,
      fk: { schemaTotal: fkTotal },
      existingTablesUnchanged: schemaDiff,
      rowCounts: { diff: rowDiff },
      notes,
      failures,
      pass: failures.length === 0,
    },
    null,
    2,
  ),
);

await conn.end();
if (failures.length > 0) process.exit(1);
