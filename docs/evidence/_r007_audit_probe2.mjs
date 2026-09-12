/** RESEARCH-007 审计探针 2（只读）：修正列名后取深度档完整性 + 数据集契约 + PIT 证据 */
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
  } catch (e) {
    log(`[ERROR] ${e.message}`);
  }
}

await q("research_result 列名", `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='research_result' ORDER BY ORDINAL_POSITION`);
await q("dataset_version 列名", `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dataset_version' ORDER BY ORDINAL_POSITION`);
await q("dataset_definition 列名", `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dataset_definition' ORDER BY ORDINAL_POSITION`);
await q("research_conclusion 列名", `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='research_conclusion' ORDER BY ORDINAL_POSITION`);

await q("dataset_version 390002 全字段", `SELECT * FROM dataset_version WHERE id = 390002`);
await q("dataset_definition 全部", `SELECT * FROM dataset_definition`);

await q("事件表样本量", `SELECT COUNT(*) events, COUNT(DISTINCT symbol) codes FROM ds_first_limit_pullback_event WHERE datasetVersionId = 390002`);

// 每档样本数（SEGMENT_RELATION 的 band / SAMPLE_COUNT）
await q(
  "各 segment 分析的档数与每档样本数",
  `SELECT analysisId, dimensionJson, metricValue
     FROM research_result
    WHERE analysisId BETWEEN 450001 AND 450024 AND metricCode = 'SAMPLE_COUNT'
    ORDER BY analysisId`,
);

// 结果为 SEGMENT_RELATION 的关键指标（均值/胜率）—— 用于核对口径
await q(
  "450002 (T+2) 每档 MEAN_RETURN",
  `SELECT dimensionJson, metricValue FROM research_result WHERE analysisId = 450002 AND metricCode IN ('MEAN_RETURN','WIN_RATE') ORDER BY metricCode, metricValue`,
);

// excludedForMissing：从 details 里的 meta 取
await q(
  "某分析 details 头部（配对/缺失/切点）",
  `SELECT analysisId, metricCode, LEFT(details, 700) d FROM research_result WHERE analysisId = 450002 AND metricCode='SAMPLE_COUNT' LIMIT 1`,
);

await conn.end();
writeFileSync("_r007_audit_probe2_result.md", out.join("\n"));
console.log("written _r007_audit_probe2_result.md");
process.exit(0);
