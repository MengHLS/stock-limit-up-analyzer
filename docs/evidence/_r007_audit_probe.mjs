/**
 * RESEARCH-007 审计探针（**只读**）：回答三个问题
 *  ① Run 510001 的 T+1..T+5 × 深度档 是否完整
 *  ② segment_return_* 的实际取值口径（起点）
 *  ③ 是否存在同日晚于决策点的数据 / 样本选择阶段的未来信息（look-ahead）
 *
 * 只 SELECT，不写库、不改状态。
 */
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

// ---------------- ① Run 510001 的分析清单（类型 / 目标 / 配置） ----------------
await q(
  "Run 510001 全部分析（id/type/name/target/status）",
  `SELECT id, analysisType, name, target, status FROM research_analysis WHERE runId = 510001 ORDER BY id`,
);
await q(
  "分析数量按类型统计",
  `SELECT analysisType, COUNT(*) n FROM research_analysis WHERE runId = 510001 GROUP BY analysisType`,
);

// ---------------- ② segment_return_* 结果行 + 该分析的配置 ----------------
await q(
  "segment 类分析的实际窗配置（configJson）",
  `SELECT a.id, a.name, a.target, a.configJson
     FROM research_analysis a
    WHERE a.runId = 510001 AND a.analysisType = 'SEGMENT_RELATION'
    ORDER BY a.id`,
);
await q(
  "segment_return 目标分析的样本数 + 配对/缺失（detailsJson 关键字段）",
  `SELECT a.id, a.name, MIN(r.detailsJson) sampleDetail
     FROM research_analysis a JOIN research_result r ON r.analysisId = a.id
    WHERE a.runId = 510001 AND a.analysisType = 'SEGMENT_RELATION' AND a.target LIKE 'segment\\_return%'
    GROUP BY a.id, a.name ORDER BY a.id`,
);

// ---------------- ③ 数据集版本 390002 的契约（事件表口径 / 回踩条件） ----------------
await q(
  "dataset_version 390002",
  `SELECT id, datasetId, version, status, rowCount, configJson, createdAt
     FROM dataset_version WHERE id = 390002`,
);
await q(
  "dataset_definition code=first_limit_pullback",
  `SELECT id, code, name, status, configJson FROM dataset_definition WHERE code = 'first_limit_pullback'`,
);

// ---------------- ④ 首板回撤事件表列结构（是否存在 pullback 命中/窗口字段） ----------------
await q(
  "ds_first_limit_pullback_event 列",
  `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ds_first_limit_pullback_event'
    ORDER BY ORDINAL_POSITION`,
);
await q(
  "ds_first_limit_pullback_path 列",
  `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ds_first_limit_pullback_path'
    ORDER BY ORDINAL_POSITION`,
);
await q(
  "ds_first_limit_pullback_outcome 列",
  `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ds_first_limit_pullback_outcome'
    ORDER BY ORDINAL_POSITION`,
);

// ---------------- ⑤ 事件表样本量 + 路径相对日覆盖 ----------------
await q(
  "事件表样本量（390002）",
  `SELECT COUNT(*) events, COUNT(DISTINCT code) codes FROM ds_first_limit_pullback_event WHERE datasetVersionId = 390002`,
);
await q(
  "路径表相对日覆盖（390002）",
  `SELECT relativeDay, COUNT(*) n FROM ds_first_limit_pullback_path WHERE datasetVersionId = 390002 GROUP BY relativeDay ORDER BY relativeDay`,
);
await q(
  "结果表 horizon 覆盖（390002）",
  `SELECT horizon, COUNT(*) n FROM ds_first_limit_pullback_outcome WHERE datasetVersionId = 390002 GROUP BY horizon ORDER BY horizon`,
);

// ---------------- ⑥ 结论行 ----------------
await q(
  "本 Run 的结论",
  `SELECT id, runId, status, confidence, LEFT(conclusionJson, 400) head FROM research_conclusion WHERE runId = 510001`,
);

await conn.end();
writeFileSync("_r007_audit_probe_result.md", out.join("\n"));
console.log(`written _r007_audit_probe_result.md (${out.length} lines)`);
process.exit(0);
