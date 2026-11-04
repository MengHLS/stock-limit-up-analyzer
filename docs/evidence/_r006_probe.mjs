/**
 * RESEARCH-006.0 — 只读审计探针（不写任何数据）。
 *
 * 目的：确认「声明 ≠ 线上真实」原则下，Research / Strategy / Dataset Registry 相关表
 * 在真实 TiDB 中的**存在性、行数、真实索引/唯一约束**。
 *
 * 用法：node _r006_probe.mjs
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { writeFileSync } from "node:fs";

const TABLES = [
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
  "research_analysis_template",
  "research_analysis_template_item",
  "strategy_versions",
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_version_datasets",
  "dataset_definition",
  "dataset_version",
  "dataset_build_job",
];

const out = [];
const log = (s) => out.push(s);

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  log("# RESEARCH-006.0 只读审计探针结果\n");

  // 1) 表存在性 + 行数
  log("## 1. 表存在性与行数\n");
  log("| 表 | 存在 | 行数 |");
  log("| --- | --- | --- |");
  for (const t of TABLES) {
    let exists = "—";
    let cnt = "—";
    try {
      const [r] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
      exists = "YES";
      cnt = String(r[0].c);
    } catch (e) {
      exists = "NO";
      cnt = `(${String(e.code ?? e.message).slice(0, 60)})`;
    }
    log(`| ${t} | ${exists} | ${cnt} |`);
  }

  // 2) research_conclusion / research_strategy_candidate 全列
  for (const t of ["research_conclusion", "research_strategy_candidate"]) {
    log(`\n## 2. \`${t}\` 真实列\n`);
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [t],
    );
    log("| 列 | 类型 | 可空 | 默认 |");
    log("| --- | --- | --- | --- |");
    for (const c of cols) {
      log(`| ${c.COLUMN_NAME} | ${c.COLUMN_TYPE} | ${c.IS_NULLABLE} | ${c.COLUMN_DEFAULT ?? ""} |`);
    }
    const [idx] = await conn.query(
      `SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        GROUP BY INDEX_NAME, NON_UNIQUE
        ORDER BY INDEX_NAME`,
      [t],
    );
    log(`\n索引：`);
    for (const i of idx) {
      log(`- ${i.INDEX_NAME} (${i.NON_UNIQUE === 0 ? "UNIQUE" : "idx"}) → ${i.cols}`);
    }
    const [fks] = await conn.query(
      `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [t],
    );
    log(`外键数量：${fks.length}`);
  }

  // 3) Research 侧关键分布
  log("\n## 3. Research 侧状态分布\n");
  const queries = [
    ["research_experiment.status", "SELECT status, COUNT(*) AS c FROM research_experiment GROUP BY status"],
    ["research_run.status", "SELECT status, COUNT(*) AS c FROM research_run GROUP BY status"],
    ["research_analysis.status", "SELECT status, COUNT(*) AS c FROM research_analysis GROUP BY status"],
    ["research_conclusion.status", "SELECT status, COUNT(*) AS c FROM research_conclusion GROUP BY status"],
    ["research_conclusion.conclusionType", "SELECT conclusionType, COUNT(*) AS c FROM research_conclusion GROUP BY conclusionType"],
    ["research_strategy_candidate.status", "SELECT status, COUNT(*) AS c FROM research_strategy_candidate GROUP BY status"],
    ["strategy_versions.status", "SELECT status, COUNT(*) AS c FROM strategy_versions GROUP BY status"],
    ["dataset_version.status", "SELECT status, COUNT(*) AS c FROM dataset_version GROUP BY status"],
    ["dataset_definition.datasetCode", "SELECT datasetCode, COUNT(*) AS c FROM dataset_definition GROUP BY datasetCode"],
  ];
  for (const [label, q] of queries) {
    log(`\n### ${label}`);
    try {
      const [rows] = await conn.query(q);
      if (rows.length === 0) log("(空)");
      for (const r of rows) log(`- ${JSON.stringify(r)}`);
    } catch (e) {
      log(`ERROR: ${String(e.code ?? e.message)}`);
    }
  }

  // 4) strategy_versions 是否已有 Research 溯源列（预期：没有）
  log("\n## 4. strategy_versions 真实列（检查是否存在 research provenance 列）\n");
  const [sv] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'strategy_versions' ORDER BY ORDINAL_POSITION`,
  );
  log(sv.map((c) => c.COLUMN_NAME).join(", "));

  // 5) research_conclusion ↔ research_result/analysis 可追溯性抽样
  log("\n## 5. 结论 evidenceJson 抽样（是否含 analysisId）\n");
  const [ev] = await conn.query(
    `SELECT id, experimentId, hypothesisId, conclusionType, status,
            LEFT(COALESCE(evidenceJson, ''), 300) AS ev
       FROM research_conclusion ORDER BY id DESC LIMIT 5`,
  );
  if (ev.length === 0) log("(空)");
  for (const r of ev) log(`- #${r.id} exp=${r.experimentId} hyp=${r.hypothesisId} ${r.conclusionType}/${r.status} ev=${r.ev}`);

  // 6) research_analysis 是否保存 dataset 坐标（预期：只在 experiment）
  log("\n## 6. research_result / research_analysis 是否含 dataset 坐标列\n");
  for (const t of ["research_result", "research_analysis", "research_run"]) {
    const [c] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME LIKE '%ataset%'`,
      [t],
    );
    log(`- ${t}: ${c.length === 0 ? "无 dataset 相关列" : c.map((x) => x.COLUMN_NAME).join(", ")}`);
  }

  await conn.end();
  writeFileSync("_r006_probe_result.md", out.join("\n") + "\n", "utf8");
  console.log("written: _r006_probe_result.md");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
