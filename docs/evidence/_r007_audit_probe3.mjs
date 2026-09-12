/** RESEARCH-007 审计探针 3（只读）：切点 / 配对 / 缺失 + 条件组均值 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { writeFileSync } from "node:fs";

const out = [];
const log = (...a) => { out.push(a.map(String).join(" ")); };
const conn = await createConnection(process.env.DATABASE_URL);
async function q(title, sql, params = []) {
  log(`\n### ${title}`);
  try {
    const [rows] = await conn.query(sql, params);
    if (rows.length === 0) log("(空)");
    for (const r of rows) log(JSON.stringify(r));
  } catch (e) { log(`[ERROR] ${e.message}`); }
}

// 取 band1 的 resultJson（含 cutPoints / pairCount / excludedForMissing / valueWindow）
await q(
  "各 segment 分析 SAMPLE_COUNT 行的 resultJson（切点与配对）",
  `SELECT analysisId, dimensionJson, resultJson
     FROM research_result
    WHERE analysisId IN (450001,450002,450003,450004,450005) AND metricCode='SAMPLE_COUNT'
    ORDER BY analysisId, dimensionJson`,
);
await q(
  "450021 / 450022 的 resultJson（口径与切点）",
  `SELECT analysisId, dimensionJson, resultJson FROM research_result
    WHERE analysisId IN (450021,450022) AND metricCode='SAMPLE_COUNT'
    ORDER BY analysisId, dimensionJson LIMIT 2`,
);
await q(
  "C 组条件分析：ALL / CONDITION 的样本数与 5 日均值",
  `SELECT analysisId, dimensionJson, metricCode, metricValue, sampleCount FROM research_result
    WHERE analysisId BETWEEN 450011 AND 450020 AND metricCode IN ('MEAN_RETURN','MEDIAN_RETURN','WIN_RATE')
    ORDER BY analysisId, metricCode, dimensionJson`,
);
await q(
  "E 组量比分析：样本数与均值",
  `SELECT analysisId, dimensionJson, metricCode, metricValue, sampleCount FROM research_result
    WHERE analysisId BETWEEN 450025 AND 450029 AND metricCode IN ('SAMPLE_COUNT','MEAN_RETURN','WIN_RATE')
    ORDER BY analysisId, metricCode, dimensionJson`,
);
await q(
  "本 Run 结论（按 experimentId）",
  `SELECT id, experimentId, title, conclusionType, confidence, status FROM research_conclusion WHERE experimentId = 240002`,
);
await conn.end();
writeFileSync("_r007_audit_probe3_result.md", out.join("\n"));
console.log("written _r007_audit_probe3_result.md");
process.exit(0);
