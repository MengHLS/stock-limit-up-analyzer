/**
 * 只读探针：读取既有「首板后回撤」分析的**条件写法**与**结果形态**，
 * 用于在新的观察日分析中沿用同一口径。
 * 运行：`npx tsx docs/evidence/_probe_existing_conditions.mts`
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const m = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL);
const c = await mysql.createConnection({
  host: m[3], port: Number(m[4]), user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]), database: m[5], ssl: { rejectUnauthorized: false },
});

const ANALYSIS_ID = Number(process.env.PROBE_ANALYSIS_ID ?? 510025);

const [a] = await c.query(`SELECT * FROM research_analysis WHERE id = ?`, [ANALYSIS_ID]);
console.log("=== analysis ===");
console.log(JSON.stringify(a[0], null, 2));

const [cond] = await c.query(
  `SELECT groupNo, sortOrder, fieldName, operator, valueJson, logicalOperator, groupLogicalOperator
     FROM research_analysis_condition WHERE analysisId = ? ORDER BY groupNo, sortOrder`,
  [ANALYSIS_ID],
);
console.log("\n=== conditions ===");
for (const r of cond) {
  console.log(`  g${r.groupNo}[${r.sortOrder}] ${r.fieldName} ${r.operator} ${r.valueJson}  (${r.logicalOperator}/${r.groupLogicalOperator})`);
}

const [res] = await c.query(
  `SELECT metricCode, metricValue, sampleCount, dimensionJson
     FROM research_result WHERE analysisId = ? ORDER BY id`,
  [ANALYSIS_ID],
);
console.log("\n=== results ===");
for (const r of res) {
  console.log(`  ${r.metricCode} = ${r.metricValue}  n=${r.sampleCount}  dim=${r.dimensionJson}`);
}

const [concl] = await c.query(
  `SELECT id, conclusionType, title, confidence, status FROM research_conclusion WHERE id IN (
     SELECT JSON_EXTRACT(evidence, '$.primaryAnalysis.analysisId') FROM research_conclusion WHERE evidence IS NOT NULL
   ) LIMIT 5`,
);
console.log("\n=== conclusion sample ===");
for (const r of concl) console.log(`  #${r.id} [${r.conclusionType}/${r.status}] ${r.title}`);

await c.end();
