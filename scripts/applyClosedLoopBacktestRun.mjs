// CLOSED-LOOP-BACKTEST-PERSIST-001 — 闭环回测结果留档表 migration 应用脚本。
//
// 与 applyResearchStrategyBridge.mjs / applyStrategyDomainModel.mjs 同一引擎、同一纪律：
//   按 SQL 内的 `-- @guard: <kind> <target>` 指令**先查 information_schema 再执行**，
//   重复运行完全无副作用；不带 guard 的语句直接执行。
//
// 用法：
//   node scripts/applyClosedLoopBacktestRun.mjs              # 应用（幂等）+ 前后对比断言
//   node scripts/applyClosedLoopBacktestRun.mjs --dry-run    # 只报告将执行/将跳过的语句 + 当前断言
//   node scripts/applyClosedLoopBacktestRun.mjs --check      # 只读断言，不执行任何 DDL
//
// guard 种类：column <table>.<column> | index <table>.<index> | table <table>
//
// 断言（真实 TiDB information_schema，不依赖 drizzle schema）：
//   A. closed_loop_backtest_run：表存在 + 23 列**名称/顺序/基础类型/可空性/键**逐列比对
//   B. 3 个索引存在：1 UNIQUE(runId) + 2 普通（createdAt / strategyId,createdAt）
//   C. 零 FK：本表 0 + 全库 0
//   D. 既有表**零意外变化**：23 张既有表列签名 apply 前后逐表自比对
//   E. 行数：apply 前后逐表比对（必须完全一致）；新表必须 0 行
//
// 🔴 顶层 catch 必须摊开 cause 链（Drizzle/mysql2 会把根因包在外层）—— 见 PROJECT_RULES。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "apply";

const SQL_FILE = "../drizzle/0037_closed_loop_backtest_run.sql";
const NEW_TABLE = "closed_loop_backtest_run";

// ---------------------------------------------------------------------------
// 期望结构（唯一权威 = drizzle/schema.ts#closedLoopBacktestRun；此处冻结一份用于真库比对）
// ---------------------------------------------------------------------------

const EXPECTED_COLUMNS = [
  { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
  { column: "runId", base: "varchar", len: 80, nullable: "NO", key: "UNI" },
  { column: "experimentId", base: "varchar", len: 80, nullable: "NO", key: "" },
  { column: "strategyId", base: "varchar", len: 64, nullable: "NO", key: "MUL" },
  { column: "strategyVersion", base: "varchar", len: 32, nullable: "NO", key: "" },
  { column: "startDate", base: "date", nullable: "NO", key: "" },
  { column: "endDate", base: "date", nullable: "NO", key: "" },
  { column: "datasetVersion", base: "varchar", len: 96, nullable: "YES", key: "" },
  { column: "datasetVersionId", base: "bigint", nullable: "YES", key: "" },
  { column: "datasetSource", base: "varchar", len: 16, nullable: "YES", key: "" },
  { column: "recipeId", base: "varchar", len: 96, nullable: "YES", key: "" },
  { column: "status", base: "varchar", len: 24, nullable: "NO", key: "" },
  { column: "executedStageCount", base: "int", nullable: "NO", key: "" },
  { column: "blockedStageCount", base: "int", nullable: "NO", key: "" },
  { column: "skippedStageCount", base: "int", nullable: "NO", key: "" },
  { column: "firstBlockedReasonCode", base: "varchar", len: 64, nullable: "YES", key: "" },
  { column: "initialCapital", base: "double", nullable: "YES", key: "" },
  { column: "finalEquity", base: "double", nullable: "YES", key: "" },
  { column: "tradeCount", base: "int", nullable: "YES", key: "" },
  { column: "equityCurvePointCount", base: "int", nullable: "YES", key: "" },
  { column: "summaryJson", base: "text", nullable: "YES", key: "" },
  { column: "resultJson", base: "longtext", nullable: "YES", key: "" },
  // createdAt 是 idx_closed_loop_backtest_run_created 的首列 ⇒ TiDB 标 MUL（非空 key）
  { column: "createdAt", base: "timestamp", nullable: "NO", key: "MUL" },
];

const EXPECTED_INDEXES = [
  { name: "uq_closed_loop_backtest_run_run", unique: true, columns: "runId" },
  { name: "idx_closed_loop_backtest_run_created", unique: false, columns: "createdAt" },
  { name: "idx_closed_loop_backtest_run_strategy", unique: false, columns: "strategyId,createdAt" },
];

/** 既有表：证明本 migration 没有意外改动它们（apply 前后自比对列签名 + 行数）。 */
const EXISTING_TABLES = [
  "backtest_runs", "paper_trading_runs", "strategies", "strategy_versions",
  "strategy_version_datasets", "strategy_research_provenance",
  "research_experiment", "research_run", "research_analysis", "research_result",
  "research_conclusion", "research_strategy_candidate", "research_artifact",
  "dataset_definition", "dataset_version", "dataset_build_job",
  "ds_first_limit_pullback_event", "ds_first_limit_pullback_prefix",
  "ds_first_limit_pullback_post", "ds_first_limit_pullback_path",
  "ds_first_limit_pullback_outcome", "users", "stock_daily_prices",
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

// A. 新表 23 列
const tableOk = await tableExists(NEW_TABLE);
if (!tableOk) {
  failures.push(`缺表：${NEW_TABLE}`);
}
const columnReports = [];
if (tableOk) {
  const actualList = await columnList(NEW_TABLE);
  const expectedList = EXPECTED_COLUMNS.map((c) => c.column);
  const orderOk =
    actualList.length === expectedList.length && actualList.every((c, i) => c === expectedList[i]);
  if (!orderOk) {
    failures.push(
      `列集/顺序不符：期望 ${expectedList.length} 列，实际 ${actualList.length} 列`,
    );
  }
  for (const spec of EXPECTED_COLUMNS) {
    const info = await columnInfo(NEW_TABLE, spec.column);
    if (info === undefined) {
      failures.push(`缺列：${NEW_TABLE}.${spec.column}`);
      columnReports.push({ column: spec.column, present: false, ok: false });
      continue;
    }
    const pt = parseType(info.COLUMN_TYPE);
    const baseOk = pt.base === spec.base;
    const lenOk = spec.len === undefined ? true : pt.len === spec.len;
    const nullOk = info.IS_NULLABLE === spec.nullable;
    const keyOk = info.COLUMN_KEY === spec.key;
    const ok = baseOk && lenOk && nullOk && keyOk;
    if (!baseOk) failures.push(`列基础类型不符：${spec.column} 实际 ${info.COLUMN_TYPE}，期望 ${spec.base}`);
    else if (!lenOk) failures.push(`列长度不符：${spec.column} 实际 ${info.COLUMN_TYPE}，期望长度 ${spec.len}`);
    else if (!nullOk) failures.push(`列可空性不符：${spec.column} 实际 ${info.IS_NULLABLE}，期望 ${spec.nullable}`);
    else if (!keyOk) failures.push(`列键不符：${spec.column} 实际 ${info.COLUMN_KEY}，期望 ${spec.key}`);
    columnReports.push({
      column: spec.column,
      present: true,
      type: info.COLUMN_TYPE,
      nullable: info.IS_NULLABLE,
      key: info.COLUMN_KEY,
      ok,
    });
  }
}

// B. 索引
const indexReports = [];
if (tableOk) {
  for (const spec of EXPECTED_INDEXES) {
    const info = await indexInfo(NEW_TABLE, spec.name);
    const uniqueOk = info !== undefined && (Number(info.NON_UNIQUE) === 0) === spec.unique;
    const colsOk = info !== undefined && info.cols === spec.columns;
    if (info === undefined) failures.push(`缺索引/约束：${NEW_TABLE}.${spec.name}`);
    else if (!uniqueOk) failures.push(`唯一性不符：${spec.name} unique=${Number(info.NON_UNIQUE) === 0}，期望 ${spec.unique}`);
    else if (!colsOk) failures.push(`索引列不符：${spec.name} = (${info.cols})，期望 (${spec.columns})`);
    indexReports.push({
      name: spec.name,
      present: info !== undefined,
      unique: info ? Number(info.NON_UNIQUE) === 0 : null,
      columns: info?.cols ?? null,
      ok: uniqueOk && colsOk,
    });
  }
}

// C. 零 FK
const fkNew = tableOk ? await fkCount(NEW_TABLE) : 0;
const fkTotal = await schemaFkTotal();
if (fkNew !== 0) failures.push(`${NEW_TABLE} 出现 FK（应为 0）：${fkNew}`);
if (fkTotal !== 0) failures.push(`全库出现 FK（应为 0）：${fkTotal}`);

// D. 既有表零意外变化（列签名前后自比对）
const schemaDiff = [];
for (const t of EXISTING_TABLES) {
  const now = await columnList(t);
  const base = beforeColumns[t];
  const same = now.length === base.length && now.every((c, i) => c === base[i]);
  schemaDiff.push({ table: t, ok: same, columns: now.length });
  if (!same) {
    failures.push(`既有表列签名变化：${t}（迁移前 ${base.length} 列 → 迁移后 ${now.length} 列）`);
  }
}

// E. 行数
const afterRowCounts = {};
const rowDiff = [];
for (const t of EXISTING_TABLES) {
  afterRowCounts[t] = await rowCount(t);
  rowDiff.push({
    table: t,
    before: beforeRowCounts[t],
    after: afterRowCounts[t],
    changed: beforeRowCounts[t] !== afterRowCounts[t],
  });
  if (beforeRowCounts[t] !== afterRowCounts[t]) {
    failures.push(`行数变化：${t} ${beforeRowCounts[t]} → ${afterRowCounts[t]}`);
  }
}
const newTableRows = tableOk ? await rowCount(NEW_TABLE) : null;
if (newTableRows !== null && MODE === "apply" && newTableRows !== 0) {
  notes.push(`注意：${NEW_TABLE} 已有 ${newTableRows} 行（非本次 migration 写入）`);
}

console.log(
  JSON.stringify(
    {
      mode: MODE,
      statementsTotal: chunks.length,
      executed,
      skipped,
      newTable: {
        exists: tableOk,
        rows: newTableRows,
        columns: columnReports,
        indexes: indexReports,
      },
      fk: { newTable: fkNew, schemaTotal: fkTotal },
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
