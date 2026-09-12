// RESEARCH-006.2 — 前状态只读审计探针（真实 TiDB）。
// 只做 SELECT / information_schema，不写任何数据。
//
// 目的：
//   1) 行数基线（conclusion / candidate / strategy_versions / run 状态）—— 供 §27 行数守恒对比；
//   2) 找一条真实可用的 Conclusion→Experiment→Dataset Version(READY) 坐标 —— 供验收脚本使用；
//   3) 打印**真实 evidenceJson 形状** —— sourceTraceJson 的提取逻辑必须以真库结构为准，
//      不得按设计文档猜键名。
import mysql from "mysql2/promise";
import { readFileSync, writeFileSync } from "node:fs";

const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
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

const out = [];
const P = (s) => { out.push(s); console.log(s); };

async function count(t) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
  return Number(rows[0].n);
}

P("## 1. 行数基线（真实 TiDB）");
const COUNT_TABLES = [
  "research_experiment",
  "research_hypothesis",
  "research_run",
  "research_analysis",
  "research_result",
  "research_conclusion",
  "research_strategy_candidate",
  "strategy_research_provenance",
  "strategies",
  "strategy_versions",
  "strategy_version_datasets",
  "dataset_version",
];
const counts = {};
for (const t of COUNT_TABLES) counts[t] = await count(t);
P("```json\n" + JSON.stringify(counts, null, 2) + "\n```");

P("## 2. 是否有在途 Run（RUNNING / PENDING）—— 提示热重启风险");
const [running] = await conn.query(
  "SELECT id, experimentId, runNo, status FROM research_run WHERE status IN ('RUNNING','PENDING') ORDER BY id",
);
P("```json\n" + JSON.stringify(running, null, 2) + "\n```");

P("## 3. Conclusion → Experiment → Dataset Version 坐标（真实）");
const [coords] = await conn.query(
  "SELECT c.id AS conclusionId, c.status AS conclusionStatus, c.conclusionType, c.title, " +
    "c.hypothesisId, LEFT(c.conclusion, 120) AS conclusionHead, " +
    "e.id AS experimentId, e.name AS experimentName, e.status AS experimentStatus, e.datasetVersionId, " +
    "v.version AS datasetLabel, v.status AS datasetStatus, d.datasetCode " +
    "FROM research_conclusion c " +
    "JOIN research_experiment e ON e.id = c.experimentId " +
    "LEFT JOIN dataset_version v ON v.id = e.datasetVersionId " +
    "LEFT JOIN dataset_definition d ON d.id = v.datasetId " +
    "ORDER BY c.id",
);
P("```json\n" + JSON.stringify(coords, null, 2) + "\n```");

P("## 4. 真实 evidenceJson 形状（逐条：顶层键 + primaryAnalysis + contributingAnalyses 数量 + 旧键 analyses）");
for (const row of coords) {
  const [ev] = await conn.query("SELECT evidenceJson FROM research_conclusion WHERE id = ?", [row.conclusionId]);
  const raw = ev[0]?.evidenceJson ?? null;
  let parsed = null;
  let parseError = null;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch (err) {
    parseError = String(err.message ?? err);
  }
  const summary = parsed && typeof parsed === "object"
    ? {
        conclusionId: row.conclusionId,
        topLevelKeys: Object.keys(parsed),
        hasPrimaryAnalysis: Object.prototype.hasOwnProperty.call(parsed, "primaryAnalysis"),
        primaryAnalysis: parsed.primaryAnalysis ?? null,
        contributingAnalysesCount: Array.isArray(parsed.contributingAnalyses)
          ? parsed.contributingAnalyses.length
          : null,
        contributingAnalysesHead: Array.isArray(parsed.contributingAnalyses)
          ? parsed.contributingAnalyses.slice(0, 3)
          : null,
        legacyAnalysesKey: Array.isArray(parsed.analyses) ? parsed.analyses.length : null,
        ruleTraceCount: Array.isArray(parsed.ruleTrace) ? parsed.ruleTrace.length : null,
        policy: parsed.policy ?? null,
        confidenceIsNotPValue: parsed.confidenceIsNotPValue ?? null,
        disclaimerLen: typeof parsed.disclaimer === "string" ? parsed.disclaimer.length : null,
      }
    : { conclusionId: row.conclusionId, parsedNull: true, parseError };
  P("```json\n" + JSON.stringify(summary, null, 2) + "\n```");
}

P("## 5. evidence 里引用的 analysisId 是否真能反查到 runId（两跳解析可行性）");
const [analyses] = await conn.query(
  "SELECT a.id AS analysisId, a.runId, a.analysisType, r.experimentId, r.status AS runStatus " +
    "FROM research_analysis a JOIN research_run r ON r.id = a.runId ORDER BY a.id",
);
P("```json\n" + JSON.stringify(analyses, null, 2) + "\n```");

P("## 6. 真实结论正文长度（决定 description 是否会被截断）");
const [lens] = await conn.query(
  "SELECT id, CHAR_LENGTH(title) AS titleLen, CHAR_LENGTH(conclusion) AS bodyLen FROM research_conclusion ORDER BY id",
);
P("```json\n" + JSON.stringify(lens, null, 2) + "\n```");

writeFileSync(new URL("./_r0062_probe_result.md", import.meta.url), "# RESEARCH-006.2 前状态只读审计（真实 TiDB）\n\n" + out.join("\n\n") + "\n", "utf8");
await conn.end();
console.log("\n[probe] written _r0062_probe_result.md");
