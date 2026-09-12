// RESEARCH-001 — Research 核心持久层 migration 应用 + 验证脚本（幂等）。
//
// 流程：
//   ① 读 drizzle/0031_research_core.sql，按 "--> statement-breakpoint" 切分逐条执行
//      （全部 CREATE TABLE / CREATE INDEX 均为 IF NOT EXISTS 语义或可安全重复执行的幂等 DDL）；
//   ② 实查 information_schema 断言：10 张表存在 / 列数 / 关键列类型 / 索引 / 唯一约束。
//
// 设计口径：
//   - DDL 唯一权威 = drizzle/0031_research_core.sql（本脚本不另写一份 DDL）；
//   - 本脚本内的 EXPECTED 仅作**断言清单**（migration 后的验收预期），与 drizzle/schema.ts 同步；
//   - 不写 drizzle/meta/_journal.json —— 项目自 0024 起已停止维护该 journal（见
//     docs/research/RESEARCH-001-AUDIT.md §1.2），手工补写 journal 属于伪造，明确禁止。
//
// 用法：node scripts/applyResearchCore.mjs
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
  connectTimeout: 20000,
  multipleStatements: false,
});

// ---------------------------------------------------------------------------
// 断言清单（与 drizzle/schema.ts 同步；仅用于验证，不用于建表）
// ---------------------------------------------------------------------------
const EXPECTED_TABLES = [
  "research_experiment",
  "research_hypothesis",
  "research_run",
  "research_analysis",
  "research_analysis_condition",
  "research_analysis_metric",
  "research_result",
  "research_conclusion",
  "research_strategy_candidate",
  "research_artifact",
];

const EXPECTED_INDEXES = {
  research_experiment: [
    "idx_research_experiment_dataset_version",
    "idx_research_experiment_status",
    "idx_research_experiment_created",
  ],
  research_hypothesis: ["idx_research_hypothesis_experiment", "idx_research_hypothesis_status"],
  research_run: [
    "uq_research_run_experiment_run_no",
    "idx_research_run_experiment",
    "idx_research_run_status",
    "idx_research_run_created",
  ],
  research_analysis: [
    "idx_research_analysis_run",
    "idx_research_analysis_type",
    "idx_research_analysis_status",
  ],
  research_analysis_condition: ["idx_research_condition_analysis", "idx_research_condition_field"],
  research_analysis_metric: [
    "uq_research_analysis_metric_analysis_code",
    "idx_research_metric_analysis",
    "idx_research_metric_code",
  ],
  research_result: [
    "idx_research_result_analysis_metric",
    "idx_research_result_analysis",
    "idx_research_result_metric",
  ],
  research_conclusion: [
    "idx_research_conclusion_experiment",
    "idx_research_conclusion_hypothesis",
    "idx_research_conclusion_status",
  ],
  research_strategy_candidate: [
    "idx_research_candidate_experiment",
    "idx_research_candidate_conclusion",
    "idx_research_candidate_status",
    "idx_research_candidate_strategy",
  ],
  research_artifact: [
    "idx_research_artifact_experiment",
    "idx_research_artifact_run",
    "idx_research_artifact_type",
  ],
};

// 唯一约束 → 期望列集合（顺序敏感：与 DDL 声明顺序一致）
const EXPECTED_UNIQUE = {
  "uq_research_run_experiment_run_no": { table: "research_run", columns: ["experimentId", "runNo"] },
  "uq_research_analysis_metric_analysis_code": {
    table: "research_analysis_metric",
    columns: ["analysisId", "metricCode"],
  },
};

// 关键列类型断言（列名 → 期望 DATA_TYPE）
const EXPECTED_KEY_COLUMNS = {
  "research_experiment.datasetVersionId": "bigint",
  "research_experiment.researchType": "varchar",
  "research_hypothesis.experimentId": "bigint",
  "research_run.experimentId": "bigint",
  "research_run.inputSnapshotJson": "longtext",
  "research_analysis.runId": "bigint",
  "research_analysis_condition.valueJson": "longtext",
  "research_analysis_condition.groupLogicalOperator": "varchar",
  "research_analysis_metric.metricCode": "varchar",
  "research_result.metricValue": "double",
  "research_result.dimensionJson": "longtext",
  "research_conclusion.hypothesisId": "bigint",
  "research_conclusion.confidence": "double",
  "research_strategy_candidate.strategyDefinitionId": "varchar",
  "research_artifact.uri": "text",
};

// ---------------------------------------------------------------------------
// ① 应用 DDL
// ---------------------------------------------------------------------------
const sqlText = readFileSync(new URL("../drizzle/0031_research_core.sql", import.meta.url), "utf8");
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.length > 0);

console.log(`[apply] 语句数 = ${statements.length}`);
let applied = 0;
let skipped = 0;
for (const stmt of statements) {
  try {
    await conn.query(stmt);
    applied++;
  } catch (err) {
    // 幂等：MySQL/TiDB 无 `CREATE INDEX IF NOT EXISTS` 时，重复执行报 1061（Duplicate key name）。
    // 仅对该错误码放行（表已存在由 CREATE TABLE IF NOT EXISTS 覆盖）。
    if (err?.errno === 1061 || /Duplicate key name/i.test(err?.message ?? "")) {
      skipped++;
      continue;
    }
    throw err;
  }
}
console.log(`[apply] 执行完成 ${applied}/${statements.length}（幂等跳过 ${skipped}）`);

// ---------------------------------------------------------------------------
// ② 验证
// ---------------------------------------------------------------------------
const failures = [];
let checks = 0;

function check(ok, label, detail) {
  checks++;
  if (!ok) failures.push(`${label}${detail ? " :: " + detail : ""}`);
}

const [tableRows] = await conn.query(
  `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${EXPECTED_TABLES.map(() => "?").join(",")})`,
  EXPECTED_TABLES,
);
const presentTables = new Set(tableRows.map((r) => r.TABLE_NAME));
for (const t of EXPECTED_TABLES) check(presentTables.has(t), `表存在`, t);
console.log(`[verify] 表存在 ${presentTables.size}/${EXPECTED_TABLES.length}`);

// 每表列数
const [colRows] = await conn.query(
  `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${EXPECTED_TABLES.map(() => "?").join(",")})`,
  EXPECTED_TABLES,
);
const colByTable = new Map();
for (const r of colRows) {
  if (!colByTable.has(r.TABLE_NAME)) colByTable.set(r.TABLE_NAME, []);
  colByTable.get(r.TABLE_NAME).push(r);
}
for (const t of EXPECTED_TABLES) {
  const cols = colByTable.get(t) ?? [];
  check(cols.length > 0, `表有列`, t);
  check(cols.some((c) => c.COLUMN_KEY === "PRI" && c.COLUMN_NAME === "id"), `主键 id`, t);
}
const totalColumns = colRows.length;
console.log(`[verify] 列总数 = ${totalColumns}`);

// 关键列类型
for (const [key, expectedType] of Object.entries(EXPECTED_KEY_COLUMNS)) {
  const [table, col] = key.split(".");
  const found = (colByTable.get(table) ?? []).find((c) => c.COLUMN_NAME === col);
  check(found !== undefined, `关键列存在`, key);
  if (found) check(found.DATA_TYPE === expectedType, `关键列类型`, `${key} 期望 ${expectedType} 实得 ${found.DATA_TYPE}`);
}
console.log(`[verify] 关键列类型断言 ${Object.keys(EXPECTED_KEY_COLUMNS).length} 项`);

// 索引
const [idxRows] = await conn.query(
  `SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
     FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${EXPECTED_TABLES.map(() => "?").join(",")})
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  EXPECTED_TABLES,
);
const idxMap = new Map();
for (const r of idxRows) {
  const k = `${r.TABLE_NAME}.${r.INDEX_NAME}`;
  if (!idxMap.has(k)) idxMap.set(k, []);
  idxMap.get(k).push(r.COLUMN_NAME);
}
let idxChecked = 0;
for (const [table, names] of Object.entries(EXPECTED_INDEXES)) {
  for (const n of names) {
    idxChecked++;
    check(idxMap.has(`${table}.${n}`), `索引存在`, `${table}.${n}`);
  }
}
console.log(`[verify] 索引断言 ${idxChecked} 项（实际索引条目 ${idxMap.size}）`);

// 唯一约束（列序列）
for (const [uqName, spec] of Object.entries(EXPECTED_UNIQUE)) {
  const actual = idxMap.get(`${spec.table}.${uqName}`);
  check(actual !== undefined, `唯一约束存在`, uqName);
  if (actual) {
    check(
      actual.join(",") === spec.columns.join(","),
      `唯一约束列序列`,
      `${uqName} 期望 [${spec.columns.join(",")}] 实得 [${actual.join(",")}]`,
    );
  }
}

// 反模式断言：不得出现 Research 侧 Dataset 复制表
const [bannedRows] = await conn.query(
  `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND (TABLE_NAME LIKE 'research%price%' OR TABLE_NAME LIKE 'research%daily%'
           OR TABLE_NAME LIKE 'research%event%' OR TABLE_NAME LIKE 'research%prefix%'
           OR TABLE_NAME LIKE 'research%path%' OR TABLE_NAME LIKE 'research%outcome%')`,
);
check(bannedRows.length === 0, `无 Dataset 复制表`, JSON.stringify(bannedRows.map((r) => r.TABLE_NAME)));
console.log(`[verify] 反模式扫描（Research 侧 Dataset 复制表）= ${bannedRows.length} 张`);

// ---------------------------------------------------------------------------
// ③ 汇总
// ---------------------------------------------------------------------------
console.log("");
console.log(`RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} — 检查 ${checks} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
}
await conn.end();
process.exit(failures.length === 0 ? 0 : 1);
