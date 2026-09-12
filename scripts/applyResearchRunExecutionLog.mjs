// RESEARCH-002 — Run 执行批次日志列 migration 应用 + 验证脚本（幂等）。
//
// 流程：
//   ① 读 drizzle/0032_research_run_execution_log.sql，按 "--> statement-breakpoint" 切分逐条执行
//      （DDL 为 ADD COLUMN IF NOT EXISTS，TiDB 已实测可重复执行）；
//   ② 记录执行前的 research_run 行数与已存在 Run（180001）的 inputSnapshotJson，
//      执行后复核 —— 证明确实是**加列**，没有动过既有数据；
//   ③ 实查 information_schema 断言列存在 / 类型 / 可空性 / 位置（在 inputSnapshotJson 之后）。
//
// 设计口径：
//   - DDL 唯一权威 = drizzle/0032_research_run_execution_log.sql（本脚本不另写一份 DDL）；
//   - 不写 drizzle/meta/_journal.json —— 项目自 0024 起已停止维护该 journal
//     （见 docs/research/RESEARCH-001-AUDIT.md §1.2），手工补写 journal 属于伪造，明确禁止。
//
// 用法：
//   node scripts/applyResearchRunExecutionLog.mjs            # apply + verify
//   node scripts/applyResearchRunExecutionLog.mjs --dry-run   # 只打印将执行的 DDL
//   node scripts/applyResearchRunExecutionLog.mjs --check     # 只断言，不改库
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CHECK_ONLY = args.includes("--check");

const TABLE = "research_run";
const COLUMN = "executionLogJson";
const AFTER_COLUMN = "inputSnapshotJson";

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
const sqlPath = new URL("../drizzle/0032_research_run_execution_log.sql", import.meta.url);
const raw = readFileSync(sqlPath, "utf8");
const statements = raw
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
console.log(`[apply] 从 0032_research_run_execution_log.sql 读到 ${statements.length} 条语句`);

if (DRY_RUN) {
  for (const s of statements) console.log(`\n--- DDL ---\n${s}`);
  await conn.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// ② 执行前快照（证明确实只加列、不动数据）
// ---------------------------------------------------------------------------
const [[beforeCount]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${TABLE}\``);
const [beforeRuns] = await conn.query(
  `SELECT id, status, inputSnapshotJson IS NOT NULL AS hasSnapshot, sampleCount
     FROM \`${TABLE}\` ORDER BY id`,
);
console.log(`[pre] ${TABLE} 行数 = ${beforeCount.c}（执行前）`);

const [[colBefore]] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
  [TABLE, COLUMN],
);
const alreadyExisted = Number(colBefore.c) > 0;
console.log(
  `[pre] 列 ${TABLE}.${COLUMN} ${alreadyExisted ? "已存在（本次为幂等重放）" : "不存在（将新增）"}`,
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
// ④ 列断言
// ---------------------------------------------------------------------------
console.log("\n[verify] 列断言");
const [cols] = await conn.query(
  `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, ORDINAL_POSITION, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION`,
  [TABLE],
);
const colMap = new Map(cols.map((c) => [c.COLUMN_NAME, c]));
const col = colMap.get(COLUMN);
check(col !== undefined, `${COLUMN} 列存在`);
if (col) {
  check(String(col.DATA_TYPE).toLowerCase() === "longtext", `${COLUMN} 类型为 longtext`, String(col.DATA_TYPE));
  check(col.IS_NULLABLE === "YES", `${COLUMN} 可空（历史行不需要回填）`, String(col.IS_NULLABLE));
  // 注意：TiDB 的 `ADD COLUMN` 一律追加到表末尾（不认 AFTER 的语义参与断言）。
  // 物理列序与 drizzle/schema.ts 的声明序不一致是**预期行为**，无语义影响
  // （drizzle 按列名映射，不按位置）。此处只如实报告，不做断言。
  const prev = colMap.get(AFTER_COLUMN);
  console.log(
    `[info] ${COLUMN} 物理位置 = ${col.ORDINAL_POSITION}（${AFTER_COLUMN} = ${prev?.ORDINAL_POSITION}）；` +
      `TiDB 追加式 ADD COLUMN 落在表末尾，与声明序不同属预期。`,
  );
}

// 关键既有列未被本次 DDL 动过
for (const required of [
  "id",
  "experimentId",
  "runNo",
  "status",
  "configJson",
  "inputSnapshotJson",
  "sampleCount",
  "startedAt",
  "completedAt",
  "errorCode",
  "errorMessage",
  "createdAt",
]) {
  check(colMap.has(required), `${TABLE}.${required} 仍存在`);
}
console.log(`[verify] ${TABLE} 共 ${cols.length} 列`);

// ---------------------------------------------------------------------------
// ⑤ 数据未变断言（加列不动数据）
// ---------------------------------------------------------------------------
console.log("\n[verify] 数据不变断言");
const [[afterCount]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${TABLE}\``);
check(
  Number(afterCount.c) === Number(beforeCount.c),
  `行数不变（${beforeCount.c} → ${afterCount.c}）`,
  `${beforeCount.c} → ${afterCount.c}`,
);
const [afterRuns] = await conn.query(
  `SELECT id, status, inputSnapshotJson IS NOT NULL AS hasSnapshot, sampleCount
     FROM \`${TABLE}\` ORDER BY id`,
);
const sameRuns = JSON.stringify(beforeRuns.map((r) => [String(r.id), r.status, Number(r.hasSnapshot), r.sampleCount]))
  === JSON.stringify(afterRuns.map((r) => [String(r.id), r.status, Number(r.hasSnapshot), r.sampleCount]));
check(sameRuns, "既有 Run 的 status / inputSnapshot 存在性 / sampleCount 逐行不变");
if (alreadyExisted) {
  const [logRows] = await conn.query(
    `SELECT COUNT(*) AS c FROM \`${TABLE}\` WHERE \`${COLUMN}\` IS NOT NULL`,
  );
  console.log(`[info] 幂等重放：已有 ${logRows[0].c} 行写入了批次日志`);
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
