/**
 * RESEARCH-006.1 — 真实 TiDB 上的「桥」领域层验收（**自建自清**，不污染既有数据）。
 *
 * 目的（006.0 §12 / 006.1 §25）：
 *   - 证明 **DB Repository 与 InMemory Repository 语义一致**：把**同一份**契约用例
 *     （`provenanceContract.ts`）在两个实现上各跑一遍，要求「全通过 ∧ 用例名集合完全相同」；
 *   - 证明 `UNIQUE(strategyVersionId)` 是**真实数据库约束**，不是靠应用层先查后插装出来的；
 *   - 证明全过程**行数守恒**：跑完 20 张相关表的行数必须与跑之前逐表一致。
 *
 * 纪律：
 *   - 只 INSERT / DELETE **本脚本自己创建**的行（候选名 / strategyId 带 0061 标记）；
 *   - 绝不触碰用户既有数据（experiment / conclusion / dataset_version 仅只读引用）；
 *   - 不自建 Strategy Version（`strategy_versions` 保持 0 行），溯源行的 `strategyVersionId`
 *     用哨兵值并在结束时删除 —— 因为溯源零 FK、且本 STEP 不实现 promote。
 *
 * 用法：npx tsx scripts/verifyResearchStrategyBridge.mts
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { createDbResearchRepositories } from "../server/researchCore/repository/db";
import { createInMemoryResearchRepositories } from "../server/researchCore/repository/inMemory";
import { DbStrategyResearchProvenanceRepository } from "../server/research/strategyCandidate/provenance";
import { createInMemoryStrategyResearchProvenanceRepository } from "../server/research/strategyCandidate/provenance";
import {
  runCandidateSourceContract,
  runProvenanceContract,
  type ContractCheck,
} from "../server/research/strategyCandidate/provenanceContract";

const SENTINEL_STRATEGY_ID = "c-0061-verify";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)![1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

const TABLES = [
  "research_experiment", "research_hypothesis", "research_run", "research_analysis",
  "research_analysis_condition", "research_analysis_metric", "research_result",
  "research_conclusion", "research_strategy_candidate", "research_artifact",
  "research_analysis_template", "research_analysis_template_item",
  "strategy_versions", "strategy_version_datasets", "strategy_parameters",
  "strategy_entry_rules", "strategy_exit_rules", "strategy_execution_rules",
  "strategy_research_provenance", "dataset_version",
];

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    out[t] = Number((rows as Array<{ n: number }>)[0].n);
  }
  return out;
}

function report(label: string, checks: ContractCheck[]): boolean {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n### ${label} —— ${failed.length === 0 ? "PASS" : "FAIL"}（${checks.length} 项）`);
  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` —— ${c.detail}` : ""}`);
  }
  return failed.length === 0;
}

const failures: string[] = [];
const before = await snapshot();

// 1. 取只读引用（既有数据，不修改）
const [expRows] = await conn.query("SELECT id FROM research_experiment ORDER BY id LIMIT 1");
const experimentId = Number((expRows as Array<{ id: number }>)[0]?.id);
const [conRows] = await conn.query("SELECT id FROM research_conclusion ORDER BY id LIMIT 1");
const conclusionId = (conRows as Array<{ id: number }>)[0]?.id ?? null;
console.log(`只读引用：experimentId=${experimentId} conclusionId=${String(conclusionId)}`);
if (!Number.isFinite(experimentId)) {
  console.error("缺少可引用的 research_experiment 行，无法验证候选仓储");
  process.exit(2);
}

// 2. 真实 DB 契约
const dbProv = new DbStrategyResearchProvenanceRepository();
const dbProvChecks = await runProvenanceContract(dbProv);
if (!report("真实 TiDB · Provenance 契约", dbProvChecks)) failures.push("DB Provenance 契约未全通过");

const dbCandChecks = await runCandidateSourceContract(createDbResearchRepositories(), {
  experimentId,
  conclusionId,
});
if (!report("真实 TiDB · Candidate 来源字段契约", dbCandChecks)) {
  failures.push("DB Candidate 契约未全通过");
}

// 3. UNIQUE(strategyVersionId) 必须是**真实数据库约束**（绕开应用层先查后插）
//    自建自清：本段用自己的哨兵版本号，不依赖契约用例留下的行。
const RAW_V = 9006103;
const RAW_INSERT =
  "INSERT INTO strategy_research_provenance (strategyVersionId, strategyId, strategyVersion, " +
  "sourceCandidateId, sourceConclusionId, sourceExperimentId, origin) VALUES (?, ?, '1.0.0', 1, 1, 1, 'DIRECT')";
await conn.query("DELETE FROM strategy_research_provenance WHERE strategyVersionId = ?", [RAW_V]);
await conn.query(RAW_INSERT, [RAW_V, SENTINEL_STRATEGY_ID]);
let dupCode = "NO_ERROR";
try {
  await conn.query(RAW_INSERT, [RAW_V, SENTINEL_STRATEGY_ID]);
} catch (err) {
  dupCode = (err as { code?: string }).code ?? "UNKNOWN";
}
const dupOk = dupCode === "ER_DUP_ENTRY";
console.log(`\n### 裸 SQL UNIQUE(strategyVersionId) 复核 —— ${dupOk ? "PASS" : "FAIL"}（重复插入错误码 ${dupCode}）`);
if (!dupOk) failures.push(`UNIQUE(strategyVersionId) 未由数据库强制：${dupCode}`);
await conn.query("DELETE FROM strategy_research_provenance WHERE strategyVersionId = ?", [RAW_V]);

// 4. InMemory 契约（同一份用例）
const memProvChecks = await runProvenanceContract(createInMemoryStrategyResearchProvenanceRepository());
if (!report("InMemory · Provenance 契约", memProvChecks)) failures.push("InMemory Provenance 契约未全通过");

const memCandRepos = createInMemoryResearchRepositories({
  datasetVersionExists: async () => true,
  now: () => new Date("2026-09-12T10:00:00.000Z"),
});
const memExperiment = await memCandRepos.experiments.create({
  datasetVersionId: 390002,
  name: "0061-verify-experiment",
  researchType: "CONDITIONAL",
});
const memConclusion = await memCandRepos.conclusions.create({
  experimentId: memExperiment.id as number,
  conclusionType: "SUPPORTED",
  title: "首板回踩不破开盘价",
  conclusion: "回踩不破组未来收益分布与跌破组存在方向性差异",
});
const memCandChecks = await runCandidateSourceContract(memCandRepos, {
  experimentId: memExperiment.id as number,
  conclusionId: memConclusion.id as number,
});
if (!report("InMemory · Candidate 来源字段契约", memCandChecks)) {
  failures.push("InMemory Candidate 契约未全通过");
}

// 5. 语义一致性：用例名集合必须逐字相同（否则「两边各测各的」）
const namesOf = (checks: ContractCheck[]) => checks.map((c) => c.name).join(" | ");
for (const [label, dbChecks, memChecks] of [
  ["Provenance", dbProvChecks, memProvChecks],
  ["Candidate 来源字段", dbCandChecks, memCandChecks],
] as const) {
  const same = namesOf(dbChecks) === namesOf(memChecks);
  console.log(`\n### DB / InMemory 语义一致（${label}）—— ${same ? "PASS" : "FAIL"}`);
  if (!same) {
    failures.push(`${label}：DB 与 InMemory 用例集合不一致`);
    console.log(`  DB : ${namesOf(dbChecks)}`);
    console.log(`  MEM: ${namesOf(memChecks)}`);
  }
}

// 6. 收尾：清掉哨兵（若上一步失败残留）
await conn.query("DELETE FROM strategy_research_provenance WHERE strategyId = ?", [SENTINEL_STRATEGY_ID]);

// 7. 行数守恒
const after = await snapshot();
let conserved = true;
console.log("\n### 行数守恒（前后逐表比对）");
for (const t of TABLES) {
  const same = before[t] === after[t];
  if (!same) conserved = false;
  console.log(`  ${same ? "✓" : "✗"} ${t}: ${before[t]} → ${after[t]}`);
}
if (!conserved) failures.push("行数未守恒（自建自清失败）");
const provRows = after.strategy_research_provenance;
const candRows = after.research_strategy_candidate;
if (provRows !== 0) failures.push(`strategy_research_provenance 应回到 0 行，实际 ${provRows}`);
if (candRows !== 0) failures.push(`research_strategy_candidate 应回到 0 行，实际 ${candRows}`);

console.log("\n" + JSON.stringify({ failures, pass: failures.length === 0 }, null, 2));
await conn.end();
// 真实 DB 断言可能已让 `getDb()` 建起连接池，池会拖住 event loop ⇒ 显式收尾（否则脚本「跑完不退」）。
process.exit(failures.length > 0 ? 1 : 0);
