// WALK-FORWARD-001 — Walk-Forward 验证 migration 应用脚本。
//
// 与 applyOosValidation.mjs / applySearchRobustness.mjs 同一引擎、同一纪律：
//   按 SQL 内的 `-- @guard: <kind> <target>` 指令**先查 information_schema 再执行**，
//   重复运行完全无副作用。
//
// 用法：
//   node scripts/applyWalkForward.mjs              # 应用（幂等）+ 前后对比断言
//   node scripts/applyWalkForward.mjs --dry-run    # 只报告将执行/将跳过的语句 + 当前断言
//   node scripts/applyWalkForward.mjs --check      # 只读断言，不执行任何 DDL
//
// guard 种类：column <table>.<column> | index <table>.<index> | table <table>
//
// 断言（真实 TiDB information_schema，不依赖 drizzle schema）：
//   0. **零 DML（静态）**：剥掉注释后全文不得出现 INSERT/UPDATE/DELETE/REPLACE/TRUNCATE/DROP
//      ⇒ 「不改历史行」是可静态断言的事实，而不是承诺；
//   1. 两张新表存在 + 逐列**名称/顺序/基础类型/长度/可空性/键**比对；
//   2. 各表索引存在且列序正确（含 UNIQUE）；
//   3. 零 FK：两张新表各 0 + 全库 0；
//   4. 其余既有表列签名**逐表完全一致**（本 migration 只新建表，不动任何既有表）；
//   5. 行数：只**如实记录**（本 migration 零 DML，且库内可能有并行会话在写 ⇒ 不作失败判据）。
//
// 🔴 顶层 catch 必须摊开 cause 链（mysql2 会把根因包在外层）—— 见 PROJECT_RULES。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "apply";

const SQL_FILE = "../drizzle/0044_walk_forward.sql";

// ---------------------------------------------------------------------------
// 期望结构（唯一权威 = drizzle/schema.ts#walkForward*；此处冻结一份用于真库比对）
// ---------------------------------------------------------------------------

const NONE = { key: "" };

const EXPECTED = {
  walk_forward_run: {
    columns: [
      { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
      { column: "walkForwardRunId", base: "varchar", len: 80, nullable: "NO", key: "UNI" },
      // idx_walk_forward_run_strategy 的**首列** ⇒ MUL
      { column: "strategyId", base: "varchar", len: 64, nullable: "NO", key: "MUL" },
      { column: "strategyVersion", base: "varchar", len: 32, nullable: "NO", ...NONE },
      { column: "strategyVersionId", base: "varchar", len: 96, nullable: "NO", ...NONE },
      { column: "strategyFingerprint", base: "varchar", len: 64, nullable: "YES", ...NONE },
      { column: "datasetVersionId", base: "bigint", nullable: "YES", ...NONE },
      { column: "datasetVersionLabel", base: "varchar", len: 96, nullable: "YES", ...NONE },
      { column: "scheduleJson", base: "longtext", nullable: "NO", ...NONE },
      { column: "scheduleFingerprint", base: "varchar", len: 64, nullable: "NO", ...NONE },
      { column: "selectionPolicyJson", base: "text", nullable: "NO", ...NONE },
      { column: "searchMethod", base: "varchar", len: 32, nullable: "NO", ...NONE },
      { column: "maxCombinationsPerFold", base: "int", nullable: "YES", ...NONE },
      { column: "totalFoldCount", base: "int", nullable: "NO", ...NONE },
      { column: "completedFoldCount", base: "int", nullable: "NO", ...NONE },
      { column: "failedFoldCount", base: "int", nullable: "NO", ...NONE },
      { column: "currentFoldIndex", base: "int", nullable: "YES", ...NONE },
      { column: "metricsVersion", base: "varchar", len: 48, nullable: "NO", ...NONE },
      { column: "engineVersion", base: "varchar", len: 48, nullable: "NO", ...NONE },
      { column: "status", base: "varchar", len: 16, nullable: "NO", key: "MUL" },
      { column: "runFingerprint", base: "varchar", len: 64, nullable: "NO", ...NONE },
      { column: "aggregateJson", base: "longtext", nullable: "YES", ...NONE },
      { column: "notesJson", base: "text", nullable: "YES", ...NONE },
      { column: "errorCode", base: "varchar", len: 64, nullable: "YES", ...NONE },
      { column: "errorMessage", base: "text", nullable: "YES", ...NONE },
      { column: "createdAt", base: "timestamp", nullable: "NO", key: "MUL" },
      { column: "startedAt", base: "timestamp", nullable: "YES", ...NONE },
      { column: "completedAt", base: "timestamp", nullable: "YES", ...NONE },
      { column: "updatedAt", base: "timestamp", nullable: "NO", ...NONE },
    ],
    indexes: [
      { name: "uq_walk_forward_run_id", unique: true, columns: "walkForwardRunId" },
      { name: "idx_walk_forward_run_strategy", unique: false, columns: "strategyId,strategyVersion" },
      { name: "idx_walk_forward_run_created", unique: false, columns: "createdAt" },
      { name: "idx_walk_forward_run_status", unique: false, columns: "status" },
    ],
  },
  walk_forward_fold: {
    columns: [
      { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
      // ⚠️ 复合 UNIQUE `(walkForwardRunId, foldIndex)` 的**首列**在 information_schema 里
      // 报 `MUL` 而非 `UNI`（0041/0042/0043 实测同款）。
      { column: "walkForwardRunId", base: "varchar", len: 80, nullable: "NO", key: "MUL" },
      // 只出现在复合索引的**第二列** ⇒ 键为空
      { column: "foldIndex", base: "int", nullable: "NO", ...NONE },
      { column: "isStart", base: "date", nullable: "NO", ...NONE },
      { column: "isEnd", base: "date", nullable: "NO", ...NONE },
      { column: "oosStart", base: "date", nullable: "NO", ...NONE },
      { column: "oosEnd", base: "date", nullable: "NO", ...NONE },
      { column: "sourceSearchRunId", base: "varchar", len: 80, nullable: "YES", key: "MUL" },
      { column: "searchStartDate", base: "date", nullable: "YES", ...NONE },
      { column: "searchEndDate", base: "date", nullable: "YES", ...NONE },
      { column: "sourceCombinationIndex", base: "int", nullable: "YES", ...NONE },
      { column: "parameterHash", base: "varchar", len: 64, nullable: "YES", ...NONE },
      { column: "resolvedParameterSetJson", base: "longtext", nullable: "YES", ...NONE },
      { column: "strategyVersionId", base: "varchar", len: 96, nullable: "NO", ...NONE },
      { column: "strategyFingerprint", base: "varchar", len: 64, nullable: "YES", ...NONE },
      { column: "datasetVersionId", base: "bigint", nullable: "YES", ...NONE },
      { column: "oosRunId", base: "varchar", len: 80, nullable: "YES", key: "MUL" },
      { column: "oosWindowStartDate", base: "date", nullable: "YES", ...NONE },
      { column: "oosWindowEndDate", base: "date", nullable: "YES", ...NONE },
      { column: "status", base: "varchar", len: 24, nullable: "NO", ...NONE },
      { column: "outcome", base: "varchar", len: 32, nullable: "NO", ...NONE },
      { column: "isMetricsJson", base: "longtext", nullable: "YES", ...NONE },
      { column: "isMetricsSource", base: "varchar", len: 16, nullable: "YES", ...NONE },
      { column: "oosMetricsJson", base: "longtext", nullable: "YES", ...NONE },
      { column: "oosMetricsSource", base: "varchar", len: 16, nullable: "YES", ...NONE },
      { column: "comparisonJson", base: "longtext", nullable: "YES", ...NONE },
      { column: "oosBacktestFingerprint", base: "varchar", len: 64, nullable: "YES", ...NONE },
      { column: "executionFingerprint", base: "varchar", len: 64, nullable: "NO", ...NONE },
      { column: "errorCode", base: "varchar", len: 64, nullable: "YES", ...NONE },
      { column: "errorMessage", base: "text", nullable: "YES", ...NONE },
      { column: "notesJson", base: "text", nullable: "YES", ...NONE },
      { column: "createdAt", base: "timestamp", nullable: "NO", ...NONE },
      { column: "completedAt", base: "timestamp", nullable: "YES", ...NONE },
      { column: "updatedAt", base: "timestamp", nullable: "NO", ...NONE },
    ],
    indexes: [
      { name: "uq_walk_forward_fold_index", unique: true, columns: "walkForwardRunId,foldIndex" },
      { name: "idx_walk_forward_fold_run", unique: false, columns: "walkForwardRunId,foldIndex" },
      { name: "idx_walk_forward_fold_status", unique: false, columns: "walkForwardRunId,status" },
      { name: "idx_walk_forward_fold_search", unique: false, columns: "sourceSearchRunId" },
      { name: "idx_walk_forward_fold_oos", unique: false, columns: "oosRunId" },
    ],
  },
};

const NEW_TABLES = Object.keys(EXPECTED);

/** 本 migration **不新增列**（只建两张新表）；保留该表以便断言「一个都没改」。 */
const ALTERED_TABLES = {};

/** 既有表：本 migration 不得改动它们的列签名（本链路可能触及 + 绝不能被碰的邻接表）。 */
const FROZEN_TABLES = [
  "parameter_search_run", "parameter_search_combination", "parameter_search_result",
  "oos_validation_run", "oos_validation_result",
  "search_robustness_run", "search_robustness_result", "search_robustness_parameter_analysis",
  "closed_loop_backtest_run", "backtest_runs", "strategies", "strategy_versions",
  "strategy_parameters", "research_experiment", "research_run", "research_result",
  "research_strategy_candidate", "dataset_definition", "dataset_version",
  "research_finding", "research_plan", "users",
];

/** 只观察、不作判据（本 migration 零 DML；库内可能有并行会话在写）。 */
const OBSERVED_TABLES = ["parameter_search_run", "oos_validation_run", "closed_loop_backtest_run"];

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
// 静态断言 0：本 migration 必须零 DML
// ---------------------------------------------------------------------------

const sqlText = readFileSync(new URL(SQL_FILE, import.meta.url), "utf8");

/**
 * 剥注释：先按 `--> statement-breakpoint` 切，再逐行去掉 `--` 起的行内 / 行尾注释。
 * ⚠️ 必须去**行内**注释：`ON UPDATE CURRENT_TIMESTAMP` 这类正经 DDL 片段里带 `UPDATE`
 *   字样，只按「行首是否 `--`」过滤会把它误判成 DML。
 */
const statementsWithComments = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const statementsSql = statementsWithComments.map((chunk) =>
  chunk
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .trim(),
);

const ALLOWED_HEAD = [/^CREATE TABLE IF NOT EXISTS\b/i, /^ALTER TABLE\b/i];
const FORBIDDEN_ANYWHERE = [/\bDROP\b/i, /\bMODIFY\b/i, /\bCHANGE\s+COLUMN\b/i, /\bRENAME\b/i, /\bTRUNCATE\b/i];

const invalidStatements = [];
statementsSql.forEach((sql, index) => {
  if (sql.length === 0) return;
  if (!ALLOWED_HEAD.some((re) => re.test(sql))) {
    invalidStatements.push({ index, reason: "语句头不是 CREATE TABLE IF NOT EXISTS / ALTER TABLE", head: sql.split("\n")[0].slice(0, 60) });
    return;
  }
  if (/^ALTER TABLE\b/i.test(sql) && !/\bADD COLUMN\b/i.test(sql)) {
    invalidStatements.push({ index, reason: "ALTER TABLE 里没有 ADD COLUMN", head: sql.split("\n")[0].slice(0, 60) });
    return;
  }
  const bad = FORBIDDEN_ANYWHERE.find((re) => re.test(sql));
  if (bad !== undefined) {
    invalidStatements.push({ index, reason: `出现破坏性子句 ${String(bad)}`, head: sql.split("\n")[0].slice(0, 60) });
  }
});

const chunks = statementsWithComments;

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

const failures = [];
const notes = [];
for (const item of invalidStatements) {
  failures.push(`语句 #${item.index + 1} 非法（${item.reason}）：${item.head}`);
}

const executed = [];
const skipped = [];

const beforeColumns = {};
const beforeRowCounts = {};
for (const t of [...FROZEN_TABLES, ...OBSERVED_TABLES]) {
  beforeColumns[t] = await columnList(t);
  beforeRowCounts[t] = await rowCount(t);
}

if (MODE !== "check" && failures.length === 0) {
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
// 断言 1/2/3：两张新表
// ---------------------------------------------------------------------------

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
    failures.push(
      `列集/顺序不符：${table} 期望 ${expectedList.length} 列（${expectedList.slice(0, 4).join(",")}…），`
        + `实际 ${actualList.length} 列（${actualList.slice(0, 4).join(",")}…）`,
    );
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
  notes.push(`${table}：当前 ${rows} 行（新表应为 0；非 0 说明已被本会话 / 并行会话写入）。`);

  tableReports.push({ table, exists: true, rows, columns: columnReports, indexes: indexReports, fk });
}

const fkTotal = await schemaFkTotal();
if (fkTotal !== 0) failures.push(`全库出现 FK（应为 0）：${fkTotal}`);

// ---------------------------------------------------------------------------
// 断言 4：ALTERED_TABLES（本 migration 为空 —— 断言「一条 ALTER 都没有」）
// ---------------------------------------------------------------------------

const alteredReports = [];
for (const [table, additions] of Object.entries(ALTERED_TABLES)) {
  const before = beforeColumns[table];
  const after = await columnList(table);
  const missing = additions.filter((c) => !before.includes(c));
  const expected = [...before, ...missing];
  const same = after.length === expected.length && after.every((c, i) => c === expected[i]);
  if (!same) {
    failures.push(`${table} 列签名不符：期望 原${before.length}列${missing.length === 0 ? "" : ` + [${missing.join(",")}]`}，实际 ${after.length} 列`);
  }
  const removed = before.filter((c) => !after.includes(c));
  if (removed.length > 0) failures.push(`${table} 丢列：${removed.join(",")}`);
  alteredReports.push({
    table,
    ok: same,
    beforeColumns: before.length,
    afterColumns: after.length,
    added: after.filter((c) => !before.includes(c)),
    removed,
  });
}
if (Object.keys(ALTERED_TABLES).length === 0) {
  notes.push("本 migration 刻意零 ALTER：只新建两张表，不动任何既有表（断言 5 逐表复核）。");
}

// ---------------------------------------------------------------------------
// 断言 5：FROZEN_TABLES 列签名必须逐表完全一致
// ---------------------------------------------------------------------------

const frozenReports = [];
for (const table of FROZEN_TABLES) {
  const now = await columnList(table);
  const base = beforeColumns[table];
  const same = now.length === base.length && now.every((c, i) => c === base[i]);
  frozenReports.push({ table, ok: same, columns: now.length });
  if (!same) failures.push(`既有表列签名变化：${table}（迁移前 ${base.length} 列 → 迁移后 ${now.length} 列）`);
}

// ---------------------------------------------------------------------------
// 观察 6：行数只如实记录（本 migration 零 DML）
// ---------------------------------------------------------------------------

const rowDiff = [];
for (const table of OBSERVED_TABLES) {
  const after = await rowCount(table);
  rowDiff.push({ table, before: beforeRowCounts[table], after, changed: beforeRowCounts[table] !== after });
}

console.log(
  JSON.stringify(
    {
      mode: MODE,
      zeroDml: invalidStatements.length === 0,
      invalidStatements,
      statementsTotal: chunks.length,
      executed,
      skipped,
      tables: tableReports,
      altered: alteredReports,
      frozen: frozenReports,
      fk: { schemaTotal: fkTotal },
      rowCountsObservedOnly: rowDiff,
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
