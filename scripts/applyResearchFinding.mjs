// RESEARCH-FINDING-001 — Research Finding & Hypothesis Engine migration 应用脚本（幂等 + 真实库断言）。
//
// 与 applyResearchStrategyBridge.mjs / applyResearchCore.mjs 同一引擎、同一纪律：
//   按 SQL 内的 `-- @guard: <kind> <target>` 指令**先查 information_schema 再执行**，
//   重复运行完全无副作用；不带 guard 的语句直接执行。
//
// 用法：
//   node scripts/applyResearchFinding.mjs              # 应用（幂等）+ 前后对比断言
//   node scripts/applyResearchFinding.mjs --dry-run    # 只报告将执行/将跳过的语句 + 当前断言
//   node scripts/applyResearchFinding.mjs --check      # 只读断言，不执行任何 DDL
//
// guard 种类：column <table>.<column> | index <table>.<index> | table <table>
//
// 断言（真实 TiDB information_schema，不依赖 drizzle schema）：
//   A. research_finding：表存在 + 30 列类型/nullable 正确 + 1 UNIQUE(fingerprint) + 6 索引
//   B. research_hypothesis：+9 列 + 1 索引；列签名 = 基线 10 列 + 9 新列（不多不少、顺序追加）
//   C. research_conclusion：+5 列；列签名 = 基线 11 列 + 5 新列
//   D. research_strategy_candidate：+2 列 + 1 索引；列签名 = 基线 18 列 + 2 新列
//   E. 零 FK：全库 FK 计数 = 0，且 4 张相关表各 0
//   F. 既有 research_* 表零意外变化：其余 8 表列签名逐列比对基线
//   G. 行数：apply 前后逐表比对（必须完全一致）；research_finding 必须为 0 行
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : "apply";

const SQL_FILE = "../drizzle/0038_research_finding.sql";

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
// 基线（2026-09-16 实查冻结；用于证明 migration 未意外改动既有表）
// ---------------------------------------------------------------------------

const HYPOTHESIS_BASELINE = [
  "id", "experimentId", "name", "statement", "nullHypothesis", "alternativeHypothesis",
  "status", "conclusion", "createdAt", "updatedAt",
];
const HYPOTHESIS_NEW = [
  "runId", "researchQuestion", "conditionsJson", "target", "horizon",
  "expectedDirection", "expectedEffect", "sourceFindingIdsJson", "sourceConclusionId",
];

const CONCLUSION_BASELINE = [
  "id", "experimentId", "hypothesisId", "conclusionType", "title", "conclusion",
  "evidenceJson", "confidence", "status", "createdAt", "updatedAt",
];
const CONCLUSION_NEW = [
  "researchQuestion", "evidenceSummary", "findingIdsJson", "limitationsJson", "nextQuestionsJson",
];

const CANDIDATE_BASELINE = [
  "id", "experimentId", "conclusionId", "strategyDefinitionId", "name", "description",
  "entryRuleJson", "filterRuleJson", "exitRuleJson", "riskRuleJson", "parameterSpaceJson",
  "status", "createdAt", "updatedAt",
  "sourceDatasetVersionId", "sourceResearchRunId", "sourceTraceJson", "sourceDatasetDivergenceReason",
];
const CANDIDATE_NEW = [
  { column: "sourceHypothesisId", type: "bigint", nullable: "YES" },
  { column: "sourceFindingIdsJson", type: "longtext", nullable: "YES" },
];
const CANDIDATE_NEW_INDEX = "idx_research_candidate_hypothesis";

/** 其余既有表（本 migration 不应触碰）。 */
const UNTOUCHED_BASELINE = {
  research_experiment: ["id", "datasetVersionId", "name", "description", "researchType", "status", "configJson", "sampleCount", "startedAt", "completedAt", "createdAt", "updatedAt"],
  research_run: ["id", "experimentId", "runNo", "status", "configJson", "inputSnapshotJson", "sampleCount", "startedAt", "completedAt", "errorCode", "errorMessage", "createdAt", "executionLogJson"],
  research_analysis: ["id", "runId", "analysisType", "name", "target", "configJson", "status", "createdAt", "completedAt"],
  research_analysis_condition: ["id", "analysisId", "groupNo", "sortOrder", "fieldName", "operator", "valueJson", "logicalOperator", "groupLogicalOperator", "createdAt"],
  research_analysis_metric: ["id", "analysisId", "metricCode", "metricName", "configJson", "displayOrder", "createdAt"],
  research_result: ["id", "analysisId", "resultType", "dimensionJson", "metricCode", "metricValue", "sampleCount", "resultJson", "createdAt"],
  research_artifact: ["id", "experimentId", "runId", "artifactType", "storageType", "uri", "checksum", "metadataJson", "createdAt"],
  research_analysis_template: ["id", "name", "description", "sourceExperimentId", "createdAt", "updatedAt"],
  research_analysis_template_item: ["id", "templateId", "sortOrder", "analysisType", "name", "target", "configJson", "conditionsJson", "createdAt"],
};

const FINDING_TABLE = "research_finding";

/** age = 列序（便于人工核对，不参与断言）；断言只看名称/类型/nullable。 */
const FINDING_COLUMNS = [
  { column: "id", type: "bigint", nullable: "NO", key: "PRI" },
  { column: "experimentId", type: "bigint", nullable: "NO", key: "MUL" },
  { column: "runId", type: "bigint", nullable: "YES", key: "MUL" },
  { column: "primaryAnalysisId", type: "bigint", nullable: "YES", key: "MUL" },
  { column: "findingType", type: "varchar(32)", nullable: "NO", key: "MUL" },
  { column: "title", type: "varchar(300)", nullable: "NO", key: "" },
  { column: "summary", type: "text", nullable: "YES", key: "" },
  { column: "status", type: "varchar(20)", nullable: "NO", key: "MUL" },
  { column: "target", type: "varchar(200)", nullable: "YES", key: "" },
  { column: "dimensionJson", type: "longtext", nullable: "YES", key: "" },
  { column: "sourceResultIdsJson", type: "longtext", nullable: "YES", key: "" },
  { column: "effectJson", type: "longtext", nullable: "YES", key: "" },
  { column: "sampleJson", type: "longtext", nullable: "YES", key: "" },
  { column: "horizonJson", type: "longtext", nullable: "YES", key: "" },
  { column: "stabilityJson", type: "longtext", nullable: "YES", key: "" },
  { column: "monotonicityJson", type: "longtext", nullable: "YES", key: "" },
  { column: "interactionJson", type: "longtext", nullable: "YES", key: "" },
  { column: "effectStrength", type: "double", nullable: "YES", key: "" },
  { column: "sampleStrength", type: "double", nullable: "YES", key: "" },
  { column: "stabilityStrength", type: "double", nullable: "YES", key: "" },
  { column: "horizonConsistency", type: "double", nullable: "YES", key: "" },
  { column: "monotonicityStrength", type: "double", nullable: "YES", key: "" },
  { column: "researchStrength", type: "double", nullable: "YES", key: "MUL" },
  { column: "researchStrengthGrade", type: "varchar(16)", nullable: "YES", key: "" },
  { column: "policyJson", type: "longtext", nullable: "YES", key: "" },
  { column: "limitationsJson", type: "longtext", nullable: "YES", key: "" },
  { column: "evidenceJson", type: "longtext", nullable: "YES", key: "" },
  { column: "fingerprint", type: "varchar(64)", nullable: "YES", key: "UNI" },
  { column: "createdAt", type: "timestamp", nullable: "NO", key: "" },
  { column: "updatedAt", type: "timestamp", nullable: "NO", key: "" },
];

const FINDING_INDEXES = [
  { name: "uq_research_finding_fingerprint", unique: true, columns: "fingerprint" },
  { name: "idx_research_finding_experiment", unique: false, columns: "experimentId" },
  { name: "idx_research_finding_run", unique: false, columns: "runId" },
  { name: "idx_research_finding_status", unique: false, columns: "status" },
  { name: "idx_research_finding_type", unique: false, columns: "findingType" },
  { name: "idx_research_finding_strength", unique: false, columns: "researchStrength" },
  { name: "idx_research_finding_analysis", unique: false, columns: "primaryAnalysisId" },
];

const ROWCOUNT_TABLES = [
  "research_experiment", "research_hypothesis", "research_run", "research_analysis",
  "research_analysis_condition", "research_analysis_metric", "research_result",
  "research_conclusion", "research_strategy_candidate", "research_artifact",
  "research_analysis_template", "research_analysis_template_item",
  "strategy_versions", "strategy_version_datasets", "strategy_parameters",
  "strategy_entry_rules", "strategy_exit_rules", "strategy_execution_rules",
  "strategy_research_provenance", "dataset_version", "dataset_definition",
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
  return String(t).toLowerCase().replace(/\s+unsigned$/, "");
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
for (const t of Object.keys(UNTOUCHED_BASELINE)) beforeColumns[t] = await columnList(t);

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

// A. research_finding 表
const findingExists = await tableExists(FINDING_TABLE);
const findingColumns = [];
const findingIndexes = [];
if (!findingExists) {
  failures.push(`缺表：${FINDING_TABLE}`);
} else {
  for (const spec of FINDING_COLUMNS) {
    const info = await columnInfo(FINDING_TABLE, spec.column);
    const typeOk = info !== undefined && normType(info.COLUMN_TYPE) === spec.type;
    const nullOk = info !== undefined && info.IS_NULLABLE === spec.nullable;
    findingColumns.push({
      name: spec.column,
      present: info !== undefined,
      type: info?.COLUMN_TYPE ?? null,
      expectedType: spec.type,
      nullable: info?.IS_NULLABLE ?? null,
      expectedNullable: spec.nullable,
      ok: typeOk && nullOk,
    });
    if (info === undefined) failures.push(`缺列：${FINDING_TABLE}.${spec.column}`);
    else if (!typeOk) failures.push(`列类型不符：${FINDING_TABLE}.${spec.column} 实际 ${info.COLUMN_TYPE}，期望 ${spec.type}`);
    else if (!nullOk) failures.push(`列可空性不符：${FINDING_TABLE}.${spec.column} 实际 ${info.IS_NULLABLE}，期望 ${spec.nullable}`);
  }
  for (const spec of FINDING_INDEXES) {
    const info = await indexInfo(FINDING_TABLE, spec.name);
    const uniqueOk = info !== undefined && (Number(info.NON_UNIQUE) === 0) === spec.unique;
    const colsOk = info !== undefined && info.cols === spec.columns;
    findingIndexes.push({
      name: spec.name,
      present: info !== undefined,
      unique: info ? Number(info.NON_UNIQUE) === 0 : null,
      expectedUnique: spec.unique,
      columns: info?.cols ?? null,
      expectedColumns: spec.columns,
      ok: uniqueOk && colsOk,
    });
    if (info === undefined) failures.push(`缺索引：${FINDING_TABLE}.${spec.name}`);
    else if (!uniqueOk) failures.push(`唯一性不符：${spec.name}，期望 unique=${spec.unique}`);
    else if (!colsOk) failures.push(`索引列不符：${spec.name} = (${info.cols})，期望 (${spec.columns})`);
  }
}

// B/C/D. 三表新列
const hypothesisColumns = [];
for (const col of HYPOTHESIS_NEW) {
  const info = await columnInfo("research_hypothesis", col);
  const ok = info !== undefined && info.IS_NULLABLE === "YES";
  hypothesisColumns.push({ name: col, present: info !== undefined, type: info?.COLUMN_TYPE ?? null, nullable: info?.IS_NULLABLE ?? null, ok });
  if (info === undefined) failures.push(`缺列：research_hypothesis.${col}`);
  else if (!ok) failures.push(`research_hypothesis.${col} 期望 nullable=YES，实际 ${info.IS_NULLABLE}`);
}
const hypothesisIdx = await indexInfo("research_hypothesis", "idx_research_hypothesis_run");
if (!hypothesisIdx) failures.push("缺索引：research_hypothesis.idx_research_hypothesis_run");

const conclusionColumns = [];
for (const col of CONCLUSION_NEW) {
  const info = await columnInfo("research_conclusion", col);
  const ok = info !== undefined && info.IS_NULLABLE === "YES";
  conclusionColumns.push({ name: col, present: info !== undefined, type: info?.COLUMN_TYPE ?? null, nullable: info?.IS_NULLABLE ?? null, ok });
  if (info === undefined) failures.push(`缺列：research_conclusion.${col}`);
  else if (!ok) failures.push(`research_conclusion.${col} 期望 nullable=YES，实际 ${info.IS_NULLABLE}`);
}

const candidateColumns = [];
for (const spec of CANDIDATE_NEW) {
  const info = await columnInfo("research_strategy_candidate", spec.column);
  const typeOk = info !== undefined && normType(info.COLUMN_TYPE) === spec.type;
  const nullOk = info !== undefined && info.IS_NULLABLE === spec.nullable;
  candidateColumns.push({ name: spec.column, present: info !== undefined, type: info?.COLUMN_TYPE ?? null, expectedType: spec.type, nullable: info?.IS_NULLABLE ?? null, expectedNullable: spec.nullable, ok: typeOk && nullOk });
  if (info === undefined) failures.push(`缺列：research_strategy_candidate.${spec.column}`);
  else if (!typeOk) failures.push(`列类型不符：${spec.column} 实际 ${info.COLUMN_TYPE}，期望 ${spec.type}`);
  else if (!nullOk) failures.push(`列可空性不符：${spec.column} 实际 ${info.IS_NULLABLE}，期望 ${spec.nullable}`);
}
const candidateIdx = await indexInfo("research_strategy_candidate", CANDIDATE_NEW_INDEX);
if (!candidateIdx) failures.push(`缺索引：research_strategy_candidate.${CANDIDATE_NEW_INDEX}`);

// E. 零 FK
const fkTables = { research_finding: findingExists ? await fkCount(FINDING_TABLE) : 0 };
for (const t of ["research_hypothesis", "research_conclusion", "research_strategy_candidate"]) {
  fkTables[t] = await fkCount(t);
}
const fkTotal = await schemaFkTotal();
for (const [t, n] of Object.entries(fkTables)) if (n !== 0) failures.push(`${t} 出现 FK（应为 0）：${n}`);
if (fkTotal !== 0) failures.push(`全库出现 FK（应为 0）：${fkTotal}`);

// F/G. 列签名 & 行数
const schemaDiff = [];
for (const [table, base] of Object.entries(UNTOUCHED_BASELINE)) {
  const now = await columnList(table);
  const same = now.length === base.length && now.every((c, i) => c === base[i]);
  schemaDiff.push({ table, ok: same, expected: base.length, actual: now.length, actualColumns: same ? undefined : now });
  if (!same) failures.push(`既有表列签名变化：${table}（期望 ${base.length} 列，实际 ${now.length}）`);
}

const signatureChecks = [
  { table: "research_hypothesis", base: HYPOTHESIS_BASELINE, added: HYPOTHESIS_NEW },
  { table: "research_conclusion", base: CONCLUSION_BASELINE, added: CONCLUSION_NEW },
  { table: "research_strategy_candidate", base: CANDIDATE_BASELINE, added: CANDIDATE_NEW.map((c) => c.column) },
];
for (const chk of signatureChecks) {
  const now = await columnList(chk.table);
  const expected = [...chk.base, ...chk.added];
  const same = now.length === expected.length && now.every((c, i) => c === expected[i]);
  schemaDiff.push({ table: chk.table, ok: same, expected: expected.length, actual: now.length, actualColumns: same ? undefined : now });
  if (!same) failures.push(`${chk.table} 列签名不符（应为基线 ${chk.base.length} 列 + ${chk.added.length} 新列，实际 ${now.length} 列）`);
}

const after = await snapshotRowCounts();
const rowDiff = [];
for (const t of ROWCOUNT_TABLES) {
  rowDiff.push({ table: t, before: before[t], after: after[t], changed: before[t] !== after[t] });
  if (before[t] !== after[t]) failures.push(`行数变化：${t} ${before[t]} → ${after[t]}`);
}
const findingRows = findingExists ? await rowCount(FINDING_TABLE) : null;
if (findingRows !== null && findingRows !== 0) failures.push(`${FINDING_TABLE} 应为 0 行，实际 ${findingRows}`);
notes.push(`${FINDING_TABLE} 行数 = ${findingRows}`);

console.log(JSON.stringify({
  mode: MODE,
  statementsTotal: chunks.length,
  executed,
  skipped,
  finding: { exists: findingExists, rows: findingRows, columns: findingColumns, indexes: findingIndexes },
  hypothesisColumns,
  hypothesisIndex: hypothesisIdx ? { name: "idx_research_hypothesis_run", columns: hypothesisIdx.cols, present: true } : null,
  conclusionColumns,
  candidateColumns,
  candidateIndex: candidateIdx ? { name: CANDIDATE_NEW_INDEX, columns: candidateIdx.cols, present: true } : null,
  fk: { ...fkTables, schemaTotal: fkTotal },
  schemaUnchanged: schemaDiff,
  rowCounts: { before, after, diff: rowDiff },
  notes,
  failures,
  pass: failures.length === 0,
}, null, 2));

await conn.end();
if (failures.length > 0) process.exit(1);
