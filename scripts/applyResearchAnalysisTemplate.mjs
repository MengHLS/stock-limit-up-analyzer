// RESEARCH-002C — 分析模板两表 migration 应用 + 验证脚本（幂等）。
//
// 流程：
//   ① 读 drizzle/0033_research_analysis_template.sql，按 "--> statement-breakpoint" 切分逐条执行
//      （DDL 全为 CREATE TABLE/INDEX IF NOT EXISTS，TiDB 可重复执行）；
//   ② 记录执行前后**既有 research_* 表**的行数，逐表比对 —— 证明确实是纯新增，
//      没有碰过任何已落库的研究产物；
//   ③ 实查 information_schema 断言两张表的列、`name` 唯一约束、索引。
//
// 设计口径：
//   - DDL 唯一权威 = drizzle/0033_research_analysis_template.sql（本脚本不另写一份 DDL）；
//   - 不写 drizzle/meta/_journal.json —— 项目自 0024 起已停止维护该 journal
//     （见 docs/research/RESEARCH-001-AUDIT.md §1.2），手工补写 journal 属于伪造，明确禁止。
//
// 用法：
//   node scripts/applyResearchAnalysisTemplate.mjs            # apply + verify
//   node scripts/applyResearchAnalysisTemplate.mjs --dry-run   # 只打印将执行的 DDL
//   node scripts/applyResearchAnalysisTemplate.mjs --check     # 只断言，不改库
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CHECK_ONLY = args.includes("--check");

const TABLE_HEAD = "research_analysis_template";
const TABLE_ITEM = "research_analysis_template_item";

/** 本 migration 之前就存在的 research 表 —— 用于证明「纯新增、零改动」。 */
const PREEXISTING_RESEARCH_TABLES = [
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

const checks = [];
const failures = [];
function check(ok, label, detail) {
  checks.push(label);
  if (!ok) failures.push(detail ? `${label}：${detail}` : label);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// ① 读取并执行 DDL
// ---------------------------------------------------------------------------
const sqlPath = new URL("../drizzle/0033_research_analysis_template.sql", import.meta.url);
const raw = readFileSync(sqlPath, "utf8");
const statements = raw
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
console.log(`[apply] 从 0033_research_analysis_template.sql 读到 ${statements.length} 条语句`);

if (DRY_RUN) {
  for (const s of statements) console.log(`\n--- DDL ---\n${s}`);
  await conn.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// ② 执行前快照（既有 research 表行数）
// ---------------------------------------------------------------------------
async function rowCounts() {
  const out = {};
  for (const t of PREEXISTING_RESEARCH_TABLES) {
    const [[row]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    out[t] = Number(row.c);
  }
  return out;
}
const beforeCounts = await rowCounts();
console.log(
  `[pre] 既有 research 表行数：${PREEXISTING_RESEARCH_TABLES.map((t) => `${t}=${beforeCounts[t]}`).join(", ")}`,
);

const [tablesBefore] = await conn.query(
  `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`,
  [TABLE_HEAD, TABLE_ITEM],
);
console.log(
  `[pre] 目标表 ${TABLE_HEAD}/${TABLE_ITEM} ${
    tablesBefore.length === 2 ? "均已存在（本次为幂等重放）" : `已存在 ${tablesBefore.length}/2（将新建）`
  }`,
);

// ---------------------------------------------------------------------------
// ③ 应用
// ---------------------------------------------------------------------------
if (!CHECK_ONLY) {
  for (const stmt of statements) {
    await conn.query(stmt);
  }
  console.log(`[apply] 已执行 ${statements.length} 条语句`);
} else {
  console.log("[apply] --check 模式：跳过 DDL");
}

// ---------------------------------------------------------------------------
// ④ 表结构断言
// ---------------------------------------------------------------------------
console.log("\n[verify] 表结构断言");

async function columnsOf(table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, ORDINAL_POSITION, CHARACTER_MAXIMUM_LENGTH
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table],
  );
  return rows;
}

const headCols = await columnsOf(TABLE_HEAD);
check(headCols.length > 0, `${TABLE_HEAD} 表存在`);
{
  const names = new Set(headCols.map((c) => c.COLUMN_NAME));
  for (const required of ["id", "name", "description", "sourceExperimentId", "createdAt", "updatedAt"]) {
    check(names.has(required), `${TABLE_HEAD}.${required} 存在`);
  }
  const nameCol = headCols.find((c) => c.COLUMN_NAME === "name");
  check(nameCol?.IS_NULLABLE === "NO", `${TABLE_HEAD}.name 非空`, String(nameCol?.IS_NULLABLE));
  check(
    String(nameCol?.DATA_TYPE) === "varchar" && Number(nameCol?.CHARACTER_MAXIMUM_LENGTH) === 120,
    `${TABLE_HEAD}.name 为 varchar(120)`,
    `${nameCol?.DATA_TYPE}(${nameCol?.CHARACTER_MAXIMUM_LENGTH})`,
  );
}

const itemCols = await columnsOf(TABLE_ITEM);
check(itemCols.length > 0, `${TABLE_ITEM} 表存在`);
{
  const names = new Set(itemCols.map((c) => c.COLUMN_NAME));
  for (const required of [
    "id",
    "templateId",
    "sortOrder",
    "analysisType",
    "name",
    "target",
    "configJson",
    "conditionsJson",
    "createdAt",
  ]) {
    check(names.has(required), `${TABLE_ITEM}.${required} 存在`);
  }
  const jsonCols = new Map(itemCols.map((c) => [c.COLUMN_NAME, c]));
  check(
    String(jsonCols.get("configJson")?.DATA_TYPE).toLowerCase() === "longtext",
    `${TABLE_ITEM}.configJson 为 longtext`,
    String(jsonCols.get("configJson")?.DATA_TYPE),
  );
  check(
    String(jsonCols.get("conditionsJson")?.DATA_TYPE).toLowerCase() === "longtext",
    `${TABLE_ITEM}.conditionsJson 为 longtext`,
    String(jsonCols.get("conditionsJson")?.DATA_TYPE),
  );
}

// 唯一约束：模板名全局唯一（「一键铺开」的不歧义引用基础）
const [uniq] = await conn.query(
  `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
     FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
  [TABLE_HEAD],
);
const nameUniq = uniq.some((r) => r.COLUMN_NAME === "name" && Number(r.NON_UNIQUE) === 0);
check(nameUniq, `${TABLE_HEAD}.name 有唯一约束`, JSON.stringify(uniq.map((r) => [r.INDEX_NAME, r.COLUMN_NAME, r.NON_UNIQUE])));

const [itemIdx] = await conn.query(
  `SELECT INDEX_NAME, COLUMN_NAME
     FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
  [TABLE_ITEM],
);
check(
  itemIdx.some((r) => r.COLUMN_NAME === "templateId"),
  `${TABLE_ITEM}.templateId 有索引`,
  JSON.stringify(itemIdx.map((r) => [r.INDEX_NAME, r.COLUMN_NAME])),
);

// 零外键（沿用项目 soft reference 纪律）
const [fks] = await conn.query(
  `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?) AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
  [TABLE_HEAD, TABLE_ITEM],
);
check(fks.length === 0, "两张新表零外键（沿用 soft reference 纪律）", `${fks.length} 个 FK`);

// ---------------------------------------------------------------------------
// ⑤ 既有表零改动断言
// ---------------------------------------------------------------------------
console.log("\n[verify] 既有 research 表零改动断言");
const afterCounts = await rowCounts();
for (const t of PREEXISTING_RESEARCH_TABLES) {
  check(
    afterCounts[t] === beforeCounts[t],
    `${t} 行数不变（${beforeCounts[t]} → ${afterCounts[t]}）`,
    `${beforeCounts[t]} → ${afterCounts[t]}`,
  );
}

if (tablesBefore.length === 2) {
  const [[cnt]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${TABLE_HEAD}\``);
  console.log(`[info] 幂等重放：模板已有 ${cnt.c} 条`);
}

// ---------------------------------------------------------------------------
// ⑥ 汇总
// ---------------------------------------------------------------------------
console.log("");
console.log(`RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} — 检查 ${checks.length} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`);
}
await conn.end();
process.exit(failures.length === 0 ? 0 : 1);
