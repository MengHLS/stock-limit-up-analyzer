/**
 * RESEARCH-007 — 只读探针（不写任何数据）。
 * 目的：确认 Dataset Registry 上「首板回踩」Dataset 的 READY 版本、Research 侧现有实体、
 * 以及 research_analysis 表结构（是否存在分析编码列）。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { writeFileSync } from "node:fs";

const out = [];
const log = (s) => { out.push(s); };

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  const q = async (label, sql, params = []) => {
    try {
      const [rows] = await conn.query(sql, params);
      log(`\n### ${label}  (rows=${rows.length})\n` + JSON.stringify(rows, null, 2));
      return rows;
    } catch (e) {
      log(`\n### ${label}  [ERROR] ${e.code} ${e.sqlMessage}`);
      return [];
    }
  };
  const colsOf = async (table) => {
    const [rows] = await conn.query(
      "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
      [table],
    );
    log(`\n### columns: ${table}\n` + rows.map((r) => `${r.COLUMN_NAME} | ${r.COLUMN_TYPE} | ${r.IS_NULLABLE}`).join("\n"));
    return rows.map((r) => r.COLUMN_NAME);
  };

  await q("dataset_definition", "SELECT * FROM dataset_definition");
  await colsOf("dataset_version");
  await q("dataset_version", "SELECT * FROM dataset_version ORDER BY id");
  await colsOf("research_experiment");
  await q("research_experiment", "SELECT * FROM research_experiment ORDER BY id");
  await colsOf("research_run");
  await q("research_run", "SELECT * FROM research_run ORDER BY id");
  await colsOf("research_analysis");
  await q("research_analysis", "SELECT * FROM research_analysis ORDER BY id");
  await colsOf("research_result");
  await q("research_result count", "SELECT analysisId, COUNT(*) AS n FROM research_result GROUP BY analysisId");
  await q("research_conclusion", "SELECT * FROM research_conclusion ORDER BY id LIMIT 20");
  await q("research_hypothesis", "SELECT * FROM research_hypothesis ORDER BY id LIMIT 20");
  await q("researchAnalysis_templates", "SELECT * FROM research_analysis_template ORDER BY id LIMIT 20");

  await conn.end();
  writeFileSync("_r007_probe_result.md", out.join("\n"));
  console.log("written _r007_probe_result.md");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
