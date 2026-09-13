/**
 * 只读探针：列出可用于承载「观察日条件分析」的 Experiment / Run / Analysis。
 * 运行：`npx tsx docs/evidence/_probe_research_runs.mts`
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const m = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL);
const c = await mysql.createConnection({
  host: m[3], port: Number(m[4]), user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]), database: m[5], ssl: { rejectUnauthorized: false },
});

const [exp] = await c.query(
  `SELECT id, datasetVersionId, name, researchType, status, createdAt
     FROM research_experiment ORDER BY id DESC LIMIT 20`,
);
console.log("=== research_experiment ===");
for (const r of exp) console.log(`  #${r.id} ds=${r.datasetVersionId} [${r.status}] ${r.name} (${r.researchType})`);

const [runs] = await c.query(
  `SELECT id, experimentId, status, errorCode, createdAt, completedAt
     FROM research_run ORDER BY id DESC LIMIT 25`,
);
console.log("\n=== research_run ===");
for (const r of runs) console.log(`  #${r.id} exp=${r.experimentId} [${r.status}] ${r.errorCode ?? ""} ${r.createdAt}`);

const [an] = await c.query(
  `SELECT id, runId, analysisType, name, status FROM research_analysis ORDER BY id DESC LIMIT 30`,
);
console.log("\n=== research_analysis ===");
for (const r of an) console.log(`  #${r.id} run=${r.runId} [${r.status}] ${r.analysisType} ${r.name}`);

const [cand] = await c.query(
  `SELECT id, experimentId, name, status, strategyDefinitionId FROM research_strategy_candidate ORDER BY id DESC LIMIT 20`,
);
console.log("\n=== research_strategy_candidate ===");
for (const r of cand) console.log(`  #${r.id} exp=${r.experimentId} [${r.status}] ${r.name} def=${r.strategyDefinitionId}`);

await c.end();
