// ROBUSTNESS-001 — Search-Result Robustness Analysis migration 应用脚本。
//
// 与 applyParameterSearch.mjs / applyClosedLoopBacktestRun.mjs 同一引擎、同一纪律：
//   按 SQL 内的 `-- @guard: <kind> <target>` 指令**先查 information_schema 再执行**，
//   重复运行完全无副作用。
//
// 用法：
//   node scripts/applySearchRobustness.mjs              # 应用（幂等）+ 前后对比断言
//   node scripts/applySearchRobustness.mjs --dry-run    # 只报告将执行/将跳过的语句 + 当前断言
//   node scripts/applySearchRobustness.mjs --check      # 只读断言，不执行任何 DDL
//
// guard 种类：column <table>.<column> | index <table>.<index> | table <table>
//
// 断言（真实 TiDB information_schema，不依赖 drizzle schema）：
//   0. **零 DML（静态）**：剥掉注释后全文不得出现 INSERT/UPDATE/DELETE/REPLACE/TRUNCATE/DROP
//      ⇒ 「不改历史行」是可静态断言的事实，而不是承诺；
//   1. 三张新表存在 + 逐列**名称/顺序/基础类型/长度/可空性/键**比对；
//   2. 各表索引存在且列序正确（含 UNIQUE）；
//   3. 零 FK：三张新表各 0 + 全库 0；
//   4. `parameter_search_run` 只**新增**两列且列签名 = 原签名 + 预期新增（顺序为物理追加）；
//   5. 其余既有表列签名**逐表完全一致**（本 migration 不得动它们）；
//   6. 行数：只**如实记录**（本 migration 零 DML，且库内可能有并行会话在写 ⇒ 不作失败判据）。
//
// 🔴 顶层 catch 必须摊开 cause 链（mysql2 会把根因包在外层）—— 见 PROJECT_RULES。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "apply";

const SQL_FILE = "../drizzle/0042_search_robustness.sql";

/** boolean → tinyint(1)（实测：drizzle `boolean()` 在 TiDB 落成 `tinyint(1)`，见 dataset_build_config.excludeSt）。 */
const BOOL = { base: "tinyint", len: 1 };

// ---------------------------------------------------------------------------
// 期望结构（唯一权威 = drizzle/schema.ts#searchRobustness*；此处冻结一份用于真库比对）
// ---------------------------------------------------------------------------

const EXPECTED = {
  search_robustness_run: {
    columns: [
      { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
      { column: "robustnessRunId", base: "varchar", len: 80, nullable: "NO", key: "UNI" },
      { column: "sourceSearchRunId", base: "varchar", len: 80, nullable: "NO", key: "MUL" },
      { column: "strategyId", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "strategyVersion", base: "varchar", len: 32, nullable: "NO", key: "" },
      { column: "datasetVersionId", base: "bigint", nullable: "YES", key: "" },
      { column: "datasetVersionLabel", base: "varchar", len: 96, nullable: "YES", key: "" },
      { column: "startDate", base: "date", nullable: "NO", key: "" },
      { column: "endDate", base: "date", nullable: "NO", key: "" },
      { column: "searchMethod", base: "varchar", len: 24, nullable: "NO", key: "" },
      { column: "searchSnapshotJson", base: "longtext", nullable: "NO", key: "" },
      { column: "searchSnapshotFingerprint", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "fixedCoordinatesJson", base: "text", nullable: "NO", key: "" },
      { column: "executionPolicyVersion", base: "int", nullable: "NO", key: "" },
      { column: "evaluationConfigFingerprint", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "sourceReferenceCheckApplied", ...BOOL, nullable: "YES", key: "" },
      { column: "sourceUnreferencedCodesJson", base: "text", nullable: "YES", key: "" },
      { column: "analysisConfigJson", base: "text", nullable: "NO", key: "" },
      { column: "status", base: "varchar", len: 16, nullable: "NO", key: "MUL" },
      { column: "summaryJson", base: "longtext", nullable: "YES", key: "" },
      { column: "analyzedCount", base: "int", nullable: "NO", key: "" },
      { column: "stableCount", base: "int", nullable: "NO", key: "" },
      { column: "unstableCount", base: "int", nullable: "NO", key: "" },
      { column: "insufficientCount", base: "int", nullable: "NO", key: "" },
      { column: "neighborhoodIncompleteCount", base: "int", nullable: "NO", key: "" },
      { column: "parameterReferenceUnverified", ...BOOL, nullable: "NO", key: "" },
      { column: "notesJson", base: "longtext", nullable: "YES", key: "" },
      { column: "errorCode", base: "varchar", len: 64, nullable: "YES", key: "" },
      { column: "errorMessage", base: "text", nullable: "YES", key: "" },
      { column: "createdAt", base: "timestamp", nullable: "NO", key: "MUL" },
      { column: "startedAt", base: "timestamp", nullable: "YES", key: "" },
      { column: "completedAt", base: "timestamp", nullable: "YES", key: "" },
      { column: "updatedAt", base: "timestamp", nullable: "NO", key: "" },
    ],
    indexes: [
      { name: "uq_search_robustness_run_id", unique: true, columns: "robustnessRunId" },
      { name: "idx_search_robustness_run_source", unique: false, columns: "sourceSearchRunId" },
      { name: "idx_search_robustness_run_created", unique: false, columns: "createdAt" },
      { name: "idx_search_robustness_run_status", unique: false, columns: "status" },
    ],
  },
  search_robustness_result: {
    columns: [
      { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
      // ⚠️ 复合 UNIQUE `(robustnessRunId, parameterHash)` 的**首列**在 information_schema 里
      // 报 `MUL` 而非 `UNI`（0041 实测同款：parameter_search_combination.searchRunId = MUL）。
      { column: "robustnessRunId", base: "varchar", len: 80, nullable: "NO", key: "MUL" },
      { column: "sourceSearchRunId", base: "varchar", len: 80, nullable: "NO", key: "" },
      { column: "parameterHash", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "combinationIndex", base: "int", nullable: "NO", key: "" },
      { column: "parametersJson", base: "longtext", nullable: "NO", key: "" },
      { column: "totalReturnPct", base: "double", nullable: "YES", key: "" },
      { column: "annualizedReturnPct", base: "double", nullable: "YES", key: "" },
      { column: "maxDrawdownPct", base: "double", nullable: "YES", key: "" },
      { column: "tradeCount", base: "int", nullable: "YES", key: "" },
      { column: "winRatePct", base: "double", nullable: "YES", key: "" },
      { column: "profitFactor", base: "double", nullable: "YES", key: "" },
      { column: "metricsSource", base: "varchar", len: 16, nullable: "NO", key: "" },
      // ⚠️ 同 0041：`status` 只是复合索引 `(robustnessRunId, status)` 的**第二列**
      // ⇒ COLUMN_KEY 为空串（只有索引首列才标 MUL）。
      { column: "status", base: "varchar", len: 32, nullable: "NO", key: "" },
      { column: "stable", ...BOOL, nullable: "NO", key: "" },
      { column: "stabilityRatio", base: "double", nullable: "YES", key: "" },
      { column: "stableNeighborCount", base: "int", nullable: "NO", key: "" },
      { column: "validNeighborCount", base: "int", nullable: "NO", key: "" },
      { column: "expectedNeighborCount", base: "int", nullable: "NO", key: "" },
      { column: "presentNeighborCount", base: "int", nullable: "NO", key: "" },
      { column: "neighborhoodIncomplete", ...BOOL, nullable: "NO", key: "" },
      { column: "statusReason", base: "text", nullable: "YES", key: "" },
      { column: "neighborsJson", base: "longtext", nullable: "NO", key: "" },
      { column: "dispersionJson", base: "longtext", nullable: "NO", key: "" },
      { column: "sensitivityJson", base: "longtext", nullable: "NO", key: "" },
      { column: "fingerprint", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "createdAt", base: "timestamp", nullable: "NO", key: "" },
      { column: "updatedAt", base: "timestamp", nullable: "NO", key: "" },
    ],
    indexes: [
      { name: "uq_search_robustness_result_hash", unique: true, columns: "robustnessRunId,parameterHash" },
      { name: "idx_search_robustness_result_run", unique: false, columns: "robustnessRunId,combinationIndex" },
      { name: "idx_search_robustness_result_status", unique: false, columns: "robustnessRunId,status" },
    ],
  },
  search_robustness_parameter_analysis: {
    columns: [
      { column: "id", base: "bigint", nullable: "NO", key: "PRI" },
      { column: "robustnessRunId", base: "varchar", len: 80, nullable: "NO", key: "MUL" },
      { column: "sourceSearchRunId", base: "varchar", len: 80, nullable: "NO", key: "" },
      { column: "parameterName", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "domainMode", base: "varchar", len: 24, nullable: "NO", key: "" },
      { column: "domainValueCount", base: "int", nullable: "NO", key: "" },
      { column: "numeric", ...BOOL, nullable: "NO", key: "" },
      { column: "analyzedValueCount", base: "int", nullable: "NO", key: "" },
      { column: "stableCombinationCount", base: "int", nullable: "NO", key: "" },
      { column: "unstableCombinationCount", base: "int", nullable: "NO", key: "" },
      { column: "verdict", base: "varchar", len: 16, nullable: "NO", key: "" },
      { column: "sensitivityJson", base: "longtext", nullable: "NO", key: "" },
      { column: "valueDispersionJson", base: "longtext", nullable: "NO", key: "" },
      { column: "fingerprint", base: "varchar", len: 64, nullable: "NO", key: "" },
      { column: "createdAt", base: "timestamp", nullable: "NO", key: "" },
      { column: "updatedAt", base: "timestamp", nullable: "NO", key: "" },
    ],
    indexes: [
      { name: "uq_search_robustness_parameter_name", unique: true, columns: "robustnessRunId,parameterName" },
      { name: "idx_search_robustness_parameter_run", unique: false, columns: "robustnessRunId" },
    ],
  },
};

const NEW_TABLES = Object.keys(EXPECTED);

/** 本 migration **只允许追加**列的既有表（列签名 = 原签名 + 预期新增项，物理顺序为追加）。 */
const ALTERED_TABLES = {
  parameter_search_run: ["referenceCheckApplied", "unreferencedTunableCodesJson"],
};

/** 既有表：本 migration 不得改动它们的列签名（全库邻接表）。 */
const FROZEN_TABLES = [
  "parameter_search_combination", "parameter_search_result",
  "closed_loop_backtest_run", "backtest_runs", "strategies", "strategy_versions",
  "strategy_parameters", "research_experiment", "research_run", "research_result",
  "research_strategy_candidate", "dataset_definition", "dataset_version",
  "research_finding", "research_plan", "users",
];

/** 只观察、不作判据（本 migration 零 DML；库内可能有并行会话在写）。 */
const OBSERVED_TABLES = ["parameter_search_run"];

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
 *   字样，只按「行首是否 `--`」过滤会把它误判成 DML（首版实测正是这么假失败的）。
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
// 断言 1/2/3：三张新表
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
// 断言 4：ALTERED_TABLES 只追加了预期列，且**原列顺序完全不变**
// ---------------------------------------------------------------------------

const alteredReports = [];
for (const [table, additions] of Object.entries(ALTERED_TABLES)) {
  const before = beforeColumns[table];
  const after = await columnList(table);
  // 🔴 幂等判据：只要求「**尚未存在的**预期列被追加到末尾」。已应用过一轮时，
  //    两列都已存在 ⇒ 期望就是「原签名不变」（首版写成恒定追加 ⇒ 第二次必然假失败）。
  const missing = additions.filter((c) => !before.includes(c));
  const expected = [...before, ...missing];
  const same = after.length === expected.length && after.every((c, i) => c === expected[i]);
  if (!same) {
    failures.push(
      `${table} 列签名不符：期望 原${before.length}列${missing.length === 0 ? "" : ` + [${missing.join(",")}]`}，`
        + `实际 ${after.length} 列（新增项：${after.filter((c) => !before.includes(c)).join(",") || "无"}）`,
    );
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
