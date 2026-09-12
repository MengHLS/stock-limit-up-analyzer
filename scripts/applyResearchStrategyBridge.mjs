// RESEARCH-006.1 — Research → Strategy Candidate 桥 migration 应用脚本（幂等 + 真实库断言）。
//
// 与 applyStrategyDomainModel.mjs / applyStrategyDatasetBindingVersionId.mjs 同一引擎、同一纪律：
//   按 SQL 内的 `-- @guard: <kind> <target>` 指令**先查 information_schema 再执行**，
//   重复运行完全无副作用；不带 guard 的语句直接执行。
//
// 用法：
//   node scripts/applyResearchStrategyBridge.mjs              # 应用（幂等）+ 前后对比断言
//   node scripts/applyResearchStrategyBridge.mjs --dry-run    # 只报告将执行/将跳过的语句 + 当前断言
//   node scripts/applyResearchStrategyBridge.mjs --check      # 只读断言，不执行任何 DDL
//
// guard 种类：column <table>.<column> | index <table>.<index> | table <table>
//
// 断言（真实 TiDB information_schema，不依赖 drizzle schema）：
//   A. research_strategy_candidate：4 个新列存在 + 类型 + nullable 正确 + 1 个新索引存在
//   B. strategy_research_provenance：表存在 + 12 列类型/nullable 正确 + UNIQUE(strategyVersionId)
//      + 3 个索引存在
//   C. 零 FK：全库 FK 计数 = 0，且两表各 0
//   D. 既有 research_* 表零意外变化：11 张非 Candidate 表列签名逐列比对基线；
//      Candidate = 基线 14 列 + 恰好 4 个新列（不多不少、顺序追加）
//   E. Strategy 零污染：strategy_versions / strategy_version_datasets 无任何含 research 的列
//   F. 行数：apply 前后逐表比对（必须完全一致）；candidate 必须仍为 0；provenance 必须为 0
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "apply";

const SQL_FILE = "../drizzle/0036_research_strategy_bridge.sql";

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
// 基线（2026-09-12 实查冻结；用于证明 migration 未意外改动既有表）
// ---------------------------------------------------------------------------

const RESEARCH_TABLE_BASELINE = {
  research_experiment: ["id", "datasetVersionId", "name", "description", "researchType", "status", "configJson", "sampleCount", "startedAt", "completedAt", "createdAt", "updatedAt"],
  research_hypothesis: ["id", "experimentId", "name", "statement", "nullHypothesis", "alternativeHypothesis", "status", "conclusion", "createdAt", "updatedAt"],
  research_run: ["id", "experimentId", "runNo", "status", "configJson", "inputSnapshotJson", "sampleCount", "startedAt", "completedAt", "errorCode", "errorMessage", "createdAt", "executionLogJson"],
  research_analysis: ["id", "runId", "analysisType", "name", "target", "configJson", "status", "createdAt", "completedAt"],
  research_analysis_condition: ["id", "analysisId", "groupNo", "sortOrder", "fieldName", "operator", "valueJson", "logicalOperator", "groupLogicalOperator", "createdAt"],
  research_analysis_metric: ["id", "analysisId", "metricCode", "metricName", "configJson", "displayOrder", "createdAt"],
  research_result: ["id", "analysisId", "resultType", "dimensionJson", "metricCode", "metricValue", "sampleCount", "resultJson", "createdAt"],
  research_conclusion: ["id", "experimentId", "hypothesisId", "conclusionType", "title", "conclusion", "evidenceJson", "confidence", "status", "createdAt", "updatedAt"],
  research_artifact: ["id", "experimentId", "runId", "artifactType", "storageType", "uri", "checksum", "metadataJson", "createdAt"],
  research_analysis_template: ["id", "name", "description", "sourceExperimentId", "createdAt", "updatedAt"],
  research_analysis_template_item: ["id", "templateId", "sortOrder", "analysisType", "name", "target", "configJson", "conditionsJson", "createdAt"],
};

const CANDIDATE_BASELINE_COLUMNS = [
  "id", "experimentId", "conclusionId", "strategyDefinitionId", "name", "description",
  "entryRuleJson", "filterRuleJson", "exitRuleJson", "riskRuleJson", "parameterSpaceJson",
  "status", "createdAt", "updatedAt",
];

const CANDIDATE_NEW_COLUMNS = [
  { column: "sourceDatasetVersionId", type: "bigint", nullable: "YES" },
  { column: "sourceResearchRunId", type: "bigint", nullable: "YES" },
  { column: "sourceTraceJson", type: "longtext", nullable: "YES" },
  { column: "sourceDatasetDivergenceReason", type: "varchar(512)", nullable: "YES" },
];

const CANDIDATE_NEW_INDEX = "idx_research_candidate_source_dataset_version";

const PROVENANCE_TABLE = "strategy_research_provenance";

const PROVENANCE_COLUMNS = [
  { column: "id", type: "bigint", nullable: "NO", key: "PRI" },
  { column: "strategyVersionId", type: "int", nullable: "NO", key: "UNI" },
  { column: "strategyId", type: "varchar(64)", nullable: "NO", key: "MUL" },
  { column: "strategyVersion", type: "varchar(32)", nullable: "NO", key: "" },
  { column: "sourceCandidateId", type: "bigint", nullable: "NO", key: "MUL" },
  { column: "sourceConclusionId", type: "bigint", nullable: "NO", key: "MUL" },
  { column: "sourceExperimentId", type: "bigint", nullable: "NO", key: "" },
  { column: "sourceResearchRunId", type: "bigint", nullable: "YES", key: "" },
  { column: "sourceDatasetVersionId", type: "bigint", nullable: "YES", key: "" },
  { column: "sourceDatasetLabel", type: "varchar(96)", nullable: "YES", key: "" },
  { column: "sourceSnapshotJson", type: "longtext", nullable: "YES", key: "" },
  { column: "origin", type: "varchar(16)", nullable: "NO", key: "" },
  { column: "createdAt", type: "timestamp", nullable: "NO", key: "" },
];

const PROVENANCE_INDEXES = [
  { name: "uq_strategy_research_provenance_version", unique: true, columns: "strategyVersionId" },
  { name: "idx_strategy_research_provenance_strategy", unique: false, columns: "strategyId" },
  { name: "idx_strategy_research_provenance_conclusion", unique: false, columns: "sourceConclusionId" },
  { name: "idx_strategy_research_provenance_candidate", unique: false, columns: "sourceCandidateId" },
];

const ROWCOUNT_TABLES = [
  "research_experiment", "research_hypothesis", "research_run", "research_analysis",
  "research_analysis_condition", "research_analysis_metric", "research_result",
  "research_conclusion", "research_strategy_candidate", "research_artifact",
  "research_analysis_template", "research_analysis_template_item",
  "strategy_versions", "strategy_version_datasets", "strategy_parameters",
  "strategy_entry_rules", "strategy_exit_rules", "strategy_execution_rules",
  "dataset_version", "dataset_definition",
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
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return Number(rows[0].n);
}

async function snapshotRowCounts() {
  const out = {};
  for (const t of ROWCOUNT_TABLES) out[t] = await rowCount(t);
  return out;
}

/** 忽略 display width / unsigned 后缀的列类型归一化（TiDB 与 MySQL 报法差异）。 */
function normType(t) {
  return String(t).toLowerCase().replace(/\s+unsigned$/, "").replace(/\(\d+\)$/, (m) => m);
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
for (const t of Object.keys(RESEARCH_TABLE_BASELINE)) beforeColumns[t] = await columnList(t);
beforeColumns.research_strategy_candidate = await columnList("research_strategy_candidate");

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

// A. Candidate 4 列 + 1 索引
const candidateColumns = [];
for (const spec of CANDIDATE_NEW_COLUMNS) {
  const info = await columnInfo("research_strategy_candidate", spec.column);
  const typeOk = info !== undefined && normType(info.COLUMN_TYPE) === spec.type;
  const nullOk = info !== undefined && info.IS_NULLABLE === spec.nullable;
  candidateColumns.push({
    name: `research_strategy_candidate.${spec.column}`,
    present: info !== undefined,
    type: info?.COLUMN_TYPE ?? null,
    expectedType: spec.type,
    nullable: info?.IS_NULLABLE ?? null,
    expectedNullable: spec.nullable,
    ok: typeOk && nullOk,
  });
  if (info === undefined) failures.push(`缺列：research_strategy_candidate.${spec.column}`);
  else if (!typeOk) failures.push(`列类型不符：${spec.column} 实际 ${info.COLUMN_TYPE}，期望 ${spec.type}`);
  else if (!nullOk) failures.push(`列可空性不符：${spec.column} 实际 ${info.IS_NULLABLE}，期望 ${spec.nullable}`);
}
const candidateIdx = await indexInfo("research_strategy_candidate", CANDIDATE_NEW_INDEX);
if (!candidateIdx) failures.push(`缺索引：${CANDIDATE_NEW_INDEX}`);

// B. Provenance 表
const provenanceExists = await tableExists(PROVENANCE_TABLE);
const provenanceColumns = [];
const provenanceIndexes = [];
if (!provenanceExists) {
  failures.push(`缺表：${PROVENANCE_TABLE}`);
} else {
  for (const spec of PROVENANCE_COLUMNS) {
    const info = await columnInfo(PROVENANCE_TABLE, spec.column);
    const typeOk = info !== undefined && normType(info.COLUMN_TYPE) === spec.type;
    const nullOk = info !== undefined && info.IS_NULLABLE === spec.nullable;
    const keyOk = info !== undefined && info.COLUMN_KEY === spec.key;
    provenanceColumns.push({
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
    if (info === undefined) failures.push(`缺列：${PROVENANCE_TABLE}.${spec.column}`);
    else if (!typeOk) failures.push(`列类型不符：${spec.column} 实际 ${info.COLUMN_TYPE}，期望 ${spec.type}`);
    else if (!nullOk) failures.push(`列可空性不符：${spec.column} 实际 ${info.IS_NULLABLE}，期望 ${spec.nullable}`);
    else if (!keyOk) failures.push(`列键不符：${spec.column} 实际 ${info.COLUMN_KEY}，期望 ${spec.key}`);
  }
  for (const spec of PROVENANCE_INDEXES) {
    const info = await indexInfo(PROVENANCE_TABLE, spec.name);
    const uniqueOk = info !== undefined && (Number(info.NON_UNIQUE) === 0) === spec.unique;
    const colsOk = info !== undefined && info.cols === spec.columns;
    provenanceIndexes.push({
      name: spec.name,
      present: info !== undefined,
      unique: info ? Number(info.NON_UNIQUE) === 0 : null,
      expectedUnique: spec.unique,
      columns: info?.cols ?? null,
      expectedColumns: spec.columns,
      ok: uniqueOk && colsOk,
    });
    if (info === undefined) failures.push(`缺索引/约束：${PROVENANCE_TABLE}.${spec.name}`);
    else if (!uniqueOk) failures.push(`唯一性不符：${spec.name} unique=${Number(info.NON_UNIQUE) === 0}，期望 ${spec.unique}`);
    else if (!colsOk) failures.push(`索引列不符：${spec.name} = (${info.cols})，期望 (${spec.columns})`);
  }
}

// C. 零 FK
const fkCandidate = await fkCount("research_strategy_candidate");
const fkProvenance = provenanceExists ? await fkCount(PROVENANCE_TABLE) : 0;
const fkTotal = await schemaFkTotal();
if (fkCandidate !== 0) failures.push(`research_strategy_candidate 出现 FK（应为 0）：${fkCandidate}`);
if (fkProvenance !== 0) failures.push(`${PROVENANCE_TABLE} 出现 FK（应为 0）：${fkProvenance}`);
if (fkTotal !== 0) failures.push(`全库出现 FK（应为 0）：${fkTotal}`);

// D. 既有 research_* 表零意外变化
const schemaDiff = [];
for (const [table, base] of Object.entries(RESEARCH_TABLE_BASELINE)) {
  const now = await columnList(table);
  const same = now.length === base.length && now.every((c, i) => c === base[i]);
  schemaDiff.push({ table, ok: same, expected: base.length, actual: now.length, actualColumns: same ? undefined : now });
  if (!same) failures.push(`既有表列签名变化：${table}（期望 ${base.length} 列，实际 ${now.length}）`);
}
const candNow = await columnList("research_strategy_candidate");
const expectedCand = [...CANDIDATE_BASELINE_COLUMNS, ...CANDIDATE_NEW_COLUMNS.map((c) => c.column)];
const candOk = candNow.length === expectedCand.length && candNow.every((c, i) => c === expectedCand[i]);
schemaDiff.push({
  table: "research_strategy_candidate",
  ok: candOk,
  expected: expectedCand.length,
  actual: candNow.length,
  actualColumns: candOk ? undefined : candNow,
});
if (!candOk) failures.push(`research_strategy_candidate 列签名不符（应为基线 14 列 + 4 新列，实际 ${candNow.length} 列）`);

// E. Strategy 零污染
for (const t of ["strategy_versions", "strategy_version_datasets"]) {
  const cols = await columnList(t);
  const polluted = cols.filter((c) => /research|candidate|conclusion/i.test(c));
  if (polluted.length > 0) failures.push(`Strategy Canonical 污染：${t} 出现 research 相关列 ${JSON.stringify(polluted)}`);
}

// F. 行数
const after = await snapshotRowCounts();
const rowDiff = [];
for (const t of ROWCOUNT_TABLES) {
  rowDiff.push({ table: t, before: before[t], after: after[t], changed: before[t] !== after[t] });
  if (before[t] !== after[t]) failures.push(`行数变化：${t} ${before[t]} → ${after[t]}`);
}
if (after.research_strategy_candidate !== 0) failures.push(`research_strategy_candidate 应为 0 行，实际 ${after.research_strategy_candidate}`);
if (provenanceExists && after[PROVENANCE_TABLE] !== undefined && after[PROVENANCE_TABLE] !== 0) {
  failures.push(`${PROVENANCE_TABLE} 应为 0 行，实际 ${after[PROVENANCE_TABLE]}`);
}
const provenanceRows = provenanceExists ? await rowCount(PROVENANCE_TABLE) : null;
if (provenanceRows !== null && provenanceRows !== 0) failures.push(`${PROVENANCE_TABLE} 应为 0 行，实际 ${provenanceRows}`);
notes.push(`provenance 行数 = ${provenanceRows}`);

console.log(JSON.stringify({
  mode: MODE,
  statementsTotal: chunks.length,
  executed,
  skipped,
  candidateColumns,
  candidateIndex: candidateIdx ? { name: CANDIDATE_NEW_INDEX, columns: candidateIdx.cols, present: true } : null,
  provenance: { exists: provenanceExists, rows: provenanceRows, columns: provenanceColumns, indexes: provenanceIndexes },
  fk: { candidate: fkCandidate, provenance: fkProvenance, schemaTotal: fkTotal },
  schemaUnchanged: schemaDiff,
  rowCounts: { before, after, diff: rowDiff },
  notes,
  failures,
  pass: failures.length === 0,
}, null, 2));

await conn.end();
if (failures.length > 0) process.exit(1);
