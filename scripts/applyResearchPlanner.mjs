// RESEARCH-PLANNER-001 — Research Question / Research Plan migration 应用脚本（幂等 + 真实库断言）。
//
// 与 applyResearchFinding.mjs / applyResearchStrategyBridge.mjs 同一引擎、同一纪律：
//   按 SQL 内的 `-- @guard: <kind> <target>` 指令**先查 information_schema 再执行**，
//   重复运行完全无副作用；不带 guard 的语句直接执行。
//
// 用法：
//   node scripts/applyResearchPlanner.mjs              # 应用（幂等）+ 前后对比断言
//   node scripts/applyResearchPlanner.mjs --dry-run    # 只报告将执行/将跳过的语句 + 当前断言
//   node scripts/applyResearchPlanner.mjs --check      # 只读断言，不执行任何 DDL
//
// guard 种类：column <table>.<column> | index <table>.<index> | table <table>
//
// 断言（真实 TiDB information_schema，不依赖 drizzle schema）：
//   A. research_analysis：+5 列（类型/nullable 逐个核对）+ 1 索引；列签名 == 基线 9 列 + 5 新列
//   B. research_question：表存在 + 13 列逐个核对 + 4 索引
//   C. research_plan：表存在 + 17 列逐个核对 + 4 索引
//   D. 零 FK：全库 FK 计数 = 0，且 3 张相关表各 0
//   E. 既有表零意外变化：**用 apply 前后的真实列签名对比**（不硬编码基线，避免脚本自身成为第二份口径）
//   F. 行数：apply 前后逐表比对（本 migration 只加列/加表，任何既有表行数变化都是失败）
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "apply";

const SQL_FILE = "../drizzle/0039_research_planner.sql";

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
// 基线（冻结在本 migration 之前；research_analysis 是**唯一**预期被改的既有表）
// ---------------------------------------------------------------------------

const ANALYSIS_BASELINE = [
  "id", "runId", "analysisType", "name", "target", "configJson", "status", "createdAt", "completedAt",
];
const ANALYSIS_NEW = [
  { column: "planId", type: "bigint", nullable: "YES" },
  { column: "moduleKey", type: "varchar(64)", nullable: "YES" },
  { column: "priority", type: "varchar(4)", nullable: "YES" },
  { column: "purpose", type: "varchar(300)", nullable: "YES" },
  { column: "requiredFlag", type: "tinyint", nullable: "YES" },
];
const ANALYSIS_NEW_INDEX = "idx_research_analysis_plan";

const QUESTION_TABLE = "research_question";
const QUESTION_COLUMNS = [
  { column: "id", type: "bigint", nullable: "NO", key: "PRI" },
  { column: "datasetVersionId", type: "bigint", nullable: "NO", key: "MUL" },
  { column: "questionText", type: "text", nullable: "NO", key: "" },
  { column: "researchType", type: "varchar(32)", nullable: "NO", key: "" },
  { column: "createdBy", type: "varchar(16)", nullable: "NO", key: "" },
  { column: "intentJson", type: "longtext", nullable: "YES", key: "" },
  { column: "status", type: "varchar(20)", nullable: "NO", key: "MUL" },
  { column: "experimentId", type: "bigint", nullable: "YES", key: "MUL" },
  { column: "planId", type: "bigint", nullable: "YES", key: "" },
  { column: "runId", type: "bigint", nullable: "YES", key: "" },
  { column: "conclusionId", type: "bigint", nullable: "YES", key: "" },
  // createdAt 是 `idx_research_question_created` 的首列 ⇒ MySQL/TiDB 会把 COLUMN_KEY 报成 MUL（预期）。
  { column: "createdAt", type: "timestamp", nullable: "NO", key: "MUL" },
  { column: "updatedAt", type: "timestamp", nullable: "NO", key: "" },
];
const QUESTION_INDEXES = [
  { name: "idx_research_question_dataset_version", unique: false, columns: "datasetVersionId" },
  { name: "idx_research_question_status", unique: false, columns: "status" },
  { name: "idx_research_question_experiment", unique: false, columns: "experimentId" },
  { name: "idx_research_question_created", unique: false, columns: "createdAt" },
];

const PLAN_TABLE = "research_plan";
const PLAN_COLUMNS = [
  { column: "id", type: "bigint", nullable: "NO", key: "PRI" },
  { column: "questionId", type: "bigint", nullable: "NO", key: "MUL" },
  { column: "experimentId", type: "bigint", nullable: "NO", key: "MUL" },
  { column: "runId", type: "bigint", nullable: "YES", key: "MUL" },
  { column: "datasetVersionId", type: "bigint", nullable: "NO", key: "" },
  { column: "moduleKeysJson", type: "longtext", nullable: "YES", key: "" },
  { column: "planJson", type: "longtext", nullable: "YES", key: "" },
  { column: "plannedCount", type: "int", nullable: "NO", key: "" },
  { column: "materializedCount", type: "int", nullable: "NO", key: "" },
  { column: "droppedCount", type: "int", nullable: "NO", key: "" },
  { column: "maxAnalysisPerPlan", type: "int", nullable: "NO", key: "" },
  { column: "capApplied", type: "tinyint", nullable: "NO", key: "" },
  { column: "generatedBy", type: "varchar(16)", nullable: "NO", key: "" },
  { column: "status", type: "varchar(20)", nullable: "NO", key: "MUL" },
  { column: "notesJson", type: "longtext", nullable: "YES", key: "" },
  { column: "createdAt", type: "timestamp", nullable: "NO", key: "" },
  { column: "updatedAt", type: "timestamp", nullable: "NO", key: "" },
];
const PLAN_INDEXES = [
  { name: "idx_research_plan_question", unique: false, columns: "questionId" },
  { name: "idx_research_plan_experiment", unique: false, columns: "experimentId" },
  { name: "idx_research_plan_run", unique: false, columns: "runId" },
  { name: "idx_research_plan_status", unique: false, columns: "status" },
];

/** 本 migration **不应**改动的既有表（列签名用 apply 前后对比证明，不硬编码）。 */
const UNTOUCHED_TABLES = [
  "research_experiment", "research_hypothesis", "research_run",
  "research_analysis_condition", "research_analysis_metric", "research_result",
  "research_conclusion", "research_strategy_candidate", "research_artifact",
  "research_analysis_template", "research_analysis_template_item", "research_finding",
  "dataset_version", "dataset_definition",
];

const ROWCOUNT_TABLES = [
  "research_experiment", "research_hypothesis", "research_run", "research_analysis",
  "research_analysis_condition", "research_analysis_metric", "research_result",
  "research_conclusion", "research_strategy_candidate", "research_artifact",
  "research_analysis_template", "research_analysis_template_item", "research_finding",
  "strategy_versions", "strategy_version_datasets", "strategy_research_provenance",
  "dataset_version", "dataset_definition",
  QUESTION_TABLE, PLAN_TABLE,
];

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
  try {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    return Number(rows[0].n);
  } catch {
    return null; // 表不存在（apply 前）
  }
}

async function snapshotRowCounts() {
  const out = {};
  for (const t of ROWCOUNT_TABLES) out[t] = await rowCount(t);
  return out;
}

/** 忽略 display width / unsigned 后缀的类型归一化（TiDB 与 MySQL 报法差异）。 */
function normType(t) {
  return String(t).toLowerCase().replace(/\s+unsigned$/, "").replace(/^tinyint\(1\)$/, "tinyint");
}

// ---------------------------------------------------------------------------
// 执行 migration（apply / dry-run）
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

const before = await snapshotRowCounts();
const beforeColumns = {};
for (const t of [...UNTOUCHED_TABLES, "research_analysis"]) beforeColumns[t] = await columnList(t);

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

// A. research_analysis 新列 + 索引 + 列签名
const analysisColumns = [];
for (const spec of ANALYSIS_NEW) {
  const info = await columnInfo("research_analysis", spec.column);
  const typeOk = info !== undefined && normType(info.COLUMN_TYPE) === spec.type;
  const nullOk = info !== undefined && info.IS_NULLABLE === spec.nullable;
  analysisColumns.push({
    name: spec.column,
    present: info !== undefined,
    type: info?.COLUMN_TYPE ?? null,
    expectedType: spec.type,
    nullable: info?.IS_NULLABLE ?? null,
    expectedNullable: spec.nullable,
    ok: typeOk && nullOk,
  });
  if (info === undefined) failures.push(`缺列：research_analysis.${spec.column}`);
  else if (!typeOk) failures.push(`列类型不符：research_analysis.${spec.column} 实际 ${info.COLUMN_TYPE}，期望 ${spec.type}`);
  else if (!nullOk) failures.push(`列可空性不符：research_analysis.${spec.column} 实际 ${info.IS_NULLABLE}，期望 ${spec.nullable}`);
}
const analysisIdx = await indexInfo("research_analysis", ANALYSIS_NEW_INDEX);
if (!analysisIdx) failures.push(`缺索引：research_analysis.${ANALYSIS_NEW_INDEX}`);
else if (analysisIdx.cols !== "planId") failures.push(`索引列不符：${ANALYSIS_NEW_INDEX} = (${analysisIdx.cols})，期望 (planId)`);

const analysisSignature = await columnList("research_analysis");
const expectedAnalysisSignature = [...ANALYSIS_BASELINE, ...ANALYSIS_NEW.map((c) => c.column)];
const analysisSignatureOk =
  analysisSignature.length === expectedAnalysisSignature.length
  && analysisSignature.every((c, i) => c === expectedAnalysisSignature[i]);
if (!analysisSignatureOk) {
  failures.push(
    `research_analysis 列签名不符（应为基线 ${ANALYSIS_BASELINE.length} 列 + ${ANALYSIS_NEW.length} 新列 = ${expectedAnalysisSignature.length}，实际 ${analysisSignature.length}）：${analysisSignature.join(",")}`,
  );
}

// B / C. 两张新表
async function checkTable(table, columns, indexes) {
  const exists = await tableExists(table);
  if (!exists) {
    failures.push(`缺表：${table}`);
    return { exists: false, columns: [], indexes: [] };
  }
  const colResults = [];
  for (const spec of columns) {
    const info = await columnInfo(table, spec.column);
    const typeOk = info !== undefined && normType(info.COLUMN_TYPE) === spec.type;
    const nullOk = info !== undefined && info.IS_NULLABLE === spec.nullable;
    const keyOk = info !== undefined && info.COLUMN_KEY === spec.key;
    colResults.push({
      name: spec.column,
      present: info !== undefined,
      type: info?.COLUMN_TYPE ?? null,
      expectedType: spec.type,
      nullable: info?.IS_NULLABLE ?? null,
      expectedNullable: spec.nullable,
      key: info?.COLUMN_KEY ?? null,
      expectedKey: spec.key,
      ok: typeOk && nullOk && keyOk,
    });
    if (info === undefined) failures.push(`缺列：${table}.${spec.column}`);
    else if (!typeOk) failures.push(`列类型不符：${table}.${spec.column} 实际 ${info.COLUMN_TYPE}，期望 ${spec.type}`);
    else if (!nullOk) failures.push(`列可空性不符：${table}.${spec.column} 实际 ${info.IS_NULLABLE}，期望 ${spec.nullable}`);
    else if (!keyOk) failures.push(`列键不符：${table}.${spec.column} 实际 "${info.COLUMN_KEY}"，期望 "${spec.key}"`);
  }
  const idxResults = [];
  for (const spec of indexes) {
    const info = await indexInfo(table, spec.name);
    const uniqueOk = info !== undefined && (Number(info.NON_UNIQUE) === 0) === spec.unique;
    const colsOk = info !== undefined && info.cols === spec.columns;
    idxResults.push({
      name: spec.name,
      present: info !== undefined,
      unique: info ? Number(info.NON_UNIQUE) === 0 : null,
      expectedUnique: spec.unique,
      columns: info?.cols ?? null,
      expectedColumns: spec.columns,
      ok: uniqueOk && colsOk,
    });
    if (info === undefined) failures.push(`缺索引：${table}.${spec.name}`);
    else if (!uniqueOk) failures.push(`唯一性不符：${spec.name}，期望 unique=${spec.unique}`);
    else if (!colsOk) failures.push(`索引列不符：${spec.name} = (${info.cols})，期望 (${spec.columns})`);
  }
  const signature = await columnList(table);
  const signatureOk =
    signature.length === columns.length && signature.every((c, i) => c === columns[i].column);
  if (!signatureOk) failures.push(`${table} 列签名不符（期望 ${columns.length} 列，实际 ${signature.length}）：${signature.join(",")}`);
  return { exists: true, columns: colResults, indexes: idxResults, signatureOk, signature };
}

const questionCheck = await checkTable(QUESTION_TABLE, QUESTION_COLUMNS, QUESTION_INDEXES);
const planCheck = await checkTable(PLAN_TABLE, PLAN_COLUMNS, PLAN_INDEXES);

// D. 零 FK
const fkTables = {
  research_analysis: await fkCount("research_analysis"),
  [QUESTION_TABLE]: questionCheck.exists ? await fkCount(QUESTION_TABLE) : 0,
  [PLAN_TABLE]: planCheck.exists ? await fkCount(PLAN_TABLE) : 0,
};
const fkTotal = await schemaFkTotal();
for (const [t, n] of Object.entries(fkTables)) if (n !== 0) failures.push(`${t} 出现 FK（应为 0）：${n}`);
if (fkTotal !== 0) failures.push(`全库出现 FK（应为 0）：${fkTotal}`);

// E. 既有表列签名（apply 前后真实对比；check 模式下无 before ⇒ 只如实登记，不作失败判据）
const schemaDiff = [];
for (const t of UNTOUCHED_TABLES) {
  const now = await columnList(t);
  const prev = beforeColumns[t];
  const same = prev !== undefined && prev.length === now.length && prev.every((c, i) => c === now[i]);
  schemaDiff.push({ table: t, beforeCount: prev?.length ?? null, afterCount: now.length, changed: prev !== undefined && !same });
  if (prev !== undefined && !same) failures.push(`既有表列签名变化：${t}（${prev.length} → ${now.length}）`);
}

// F. 行数
const after = await snapshotRowCounts();
const rowDiff = [];
for (const t of ROWCOUNT_TABLES) {
  // apply **之前该表就不存在**（before = null）且之后为 0 行 —— 这是「新建空表」的预期形态，不是数据变化。
  // 判据刻意分成两档：已存在的表要求行数**逐表不变**；新建表只要求「从无到有且为 0 行」。
  const createdEmpty = before[t] === null && after[t] === 0;
  const changed = !createdEmpty && before[t] !== after[t];
  rowDiff.push({ table: t, before: before[t], after: after[t], createdEmpty, changed });
  if (changed) failures.push(`行数变化：${t} ${before[t]} → ${after[t]}`);
}
notes.push(`research_question 行数 = ${after[QUESTION_TABLE]}`);
notes.push(`research_plan 行数 = ${after[PLAN_TABLE]}`);

console.log(JSON.stringify({
  mode: MODE,
  statementsTotal: chunks.length,
  executed,
  skipped,
  analysis: {
    newColumns: analysisColumns,
    newIndex: analysisIdx ? { name: ANALYSIS_NEW_INDEX, columns: analysisIdx.cols } : null,
    signatureOk: analysisSignatureOk,
    signature: analysisSignature,
  },
  question: questionCheck,
  plan: planCheck,
  fk: { ...fkTables, schemaTotal: fkTotal },
  untouchedTables: schemaDiff,
  rowCounts: { before, after, diff: rowDiff },
  notes,
  failures,
  pass: failures.length === 0,
}, null, 2));

await conn.end();
if (failures.length > 0) process.exit(1);
