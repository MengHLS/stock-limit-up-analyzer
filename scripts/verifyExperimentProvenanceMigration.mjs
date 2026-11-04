// RESEARCH-EXPERIMENT-002 — `drizzle/0045_experiment_provenance.sql` 的**只读**语义断言。
//
// 为什么单独一个断言脚本：通用执行器（`scripts/applySqlMigration.mjs`）只保证
// 「该执行的执行了、不该执行的没执行」；**migration 自身的语义**（列签名 / 可空性 /
// 历史行未被改写）仍必须额外断言 —— 这是既有 migration 的**统一纪律**。
//
// 本脚本**只读**：不执行任何 DDL / DML。跑法：
//   node scripts/verifyExperimentProvenanceMigration.mjs
// 判据（任一不成立即非 0 退出）：
//   1. 5 个新列存在，且**名称 / 类型 / 长度 / 可空性**逐列匹配；
//   2. 3 个旧来源锚已可空（IS_NULLABLE = YES）；
//   3. 既有列**签名逐列不变**（只放宽可空性，不改名 / 不改类型）；
//   4. `sourceKind` 对既有行的取值 = 'RESEARCH_CONCLUSION'（默认值语义正确，无需 backfill）；
//   5. 行数只**如实记录**（本 migration 零 DML；库内可能有并行会话在写 ⇒ 不作失败判据）；
//   6. 全库 FK 数 = 0（沿用既有原则，本 migration 不引入 FK）。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const TABLE = "strategy_research_provenance";

/** 新列期望签名（唯一权威 = drizzle/0045 + drizzle/schema.ts）。 */
const EXPECTED_NEW = [
  { column: "sourceKind", base: "varchar", len: 32, nullable: "NO" },
  { column: "experimentRef", base: "varchar", len: 96, nullable: "YES" },
  { column: "experimentVersion", base: "varchar", len: 32, nullable: "YES" },
  { column: "experimentParametersJson", base: "longtext", nullable: "YES" },
  { column: "experimentResultDigest", base: "varchar", len: 64, nullable: "YES" },
];

/** 被放宽为可空的旧来源锚。 */
const EXPECTED_NULLABLE = ["sourceCandidateId", "sourceConclusionId", "sourceExperimentId"];

/** 未受影响、签名必须**逐列不变**的既有列（类型 + 可空性）。 */
const EXPECTED_UNCHANGED = [
  { column: "id", base: "bigint", nullable: "NO" },
  { column: "strategyVersionId", base: "int", nullable: "NO" },
  { column: "strategyId", base: "varchar", len: 64, nullable: "NO" },
  { column: "strategyVersion", base: "varchar", len: 32, nullable: "NO" },
  { column: "sourceResearchRunId", base: "bigint", nullable: "YES" },
  { column: "sourceDatasetVersionId", base: "bigint", nullable: "YES" },
  { column: "sourceDatasetLabel", base: "varchar", len: 96, nullable: "YES" },
  { column: "sourceSnapshotJson", base: "longtext", nullable: "YES" },
  { column: "origin", base: "varchar", len: 16, nullable: "NO" },
  { column: "createdAt", base: "timestamp", nullable: "NO" },
];

const failures = [];
const notes = [];

function check(name, pass, detail) {
  if (pass) notes.push(`PASS  ${name}${detail ? ` :: ${JSON.stringify(detail)}` : ""}`);
  else failures.push(`${name}${detail ? ` :: ${JSON.stringify(detail)}` : ""}`);
}

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const urlMatch = env.match(/DATABASE_URL=(\S+)/);
if (!urlMatch) throw new Error(".env 中缺少 DATABASE_URL");
const u = new URL(urlMatch[1].replace(/["']/g, ""));

const conn = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 20_000,
});

try {
  const [columns] = await conn.query(
    "SELECT COLUMN_NAME AS name, DATA_TYPE AS base, CHARACTER_MAXIMUM_LENGTH AS len, IS_NULLABLE AS nullable " +
      "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [TABLE],
  );
  const byName = new Map(columns.map((row) => [row.name, row]));

  for (const expected of EXPECTED_NEW) {
    const actual = byName.get(expected.column);
    if (!actual) {
      check(`新列存在：${expected.column}`, false, "缺失");
      continue;
    }
    const lengthOk = expected.len === undefined || Number(actual.len) === expected.len;
    check(
      `新列签名：${expected.column}`,
      actual.base === expected.base && lengthOk && String(actual.nullable).toUpperCase() === expected.nullable,
      { base: actual.base, len: actual.len, nullable: actual.nullable },
    );
  }

  for (const column of EXPECTED_NULLABLE) {
    const actual = byName.get(column);
    check(`旧来源锚已放宽为可空：${column}`, actual !== undefined && String(actual.nullable).toUpperCase() === "YES", {
      nullable: actual?.nullable,
    });
  }

  for (const expected of EXPECTED_UNCHANGED) {
    const actual = byName.get(expected.column);
    if (!actual) {
      check(`既有列未受影响：${expected.column}`, false, "缺失");
      continue;
    }
    const lengthOk = expected.len === undefined || Number(actual.len) === expected.len;
    check(
      `既有列未受影响：${expected.column}`,
      actual.base === expected.base && lengthOk && String(actual.nullable).toUpperCase() === expected.nullable,
      { base: actual.base, len: actual.len, nullable: actual.nullable },
    );
  }

  const [kindRows] = await conn.query(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN \`sourceKind\` = 'RESEARCH_CONCLUSION' THEN 1 ELSE 0 END) AS legacy FROM \`${TABLE}\``,
  );
  const total = Number(kindRows[0].total);
  const legacy = Number(kindRows[0].legacy ?? 0);
  check(`sourceKind 默认值语义正确（既有行全部 RESEARCH_CONCLUSION）`, total === 0 || total === legacy, {
    total,
    legacy,
  });

  const [fkRows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL",
  );
  check("全库 FK 数 = 0（沿用既有原则）", Number(fkRows[0].n) === 0, { foreignKeyCount: Number(fkRows[0].n) });

  notes.push(`INFO  行数（如实记录，非失败判据）：${total}`);
} catch (error) {
  // 🔴 顶层摊开 cause 链（mysql2 会把根因包在外层）。
  let current = error;
  let depth = 0;
  while (current && depth < 5) {
    failures.push(
      `[${depth}] ${current.constructor?.name ?? typeof current} code=${current.code} errno=${current.errno} sqlState=${current.sqlState} msg=${String(current.message).slice(0, 300)}`,
    );
    current = current.cause;
    depth += 1;
  }
} finally {
  await conn.end();
}

for (const line of notes) process.stdout.write(line + "\n");
for (const line of failures) process.stdout.write("FAIL  " + line + "\n");
const pass = failures.length === 0;
process.stdout.write(
  `--- 结论：${pass ? "PASS" : `FAIL（${failures.length} 项）`}（检查项 ${notes.filter((l) => l.startsWith("PASS")).length} / 失败 ${failures.length}）---\n`,
);
process.exit(pass ? 0 : 1);
