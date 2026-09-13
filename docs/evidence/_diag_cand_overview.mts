/**
 * 诊断：候选全貌（只读）—— 状态 / 来源结论 / 草稿五列是否齐备。
 *
 * 为什么另建而不改 `_diag_cand_sketch.mts`：后者只打前 700 字符，看不到 `parameterSpace`
 * 是否 NULL 之外的细节；本探针把「来源坐标」也一并打出，用于判断能否直接补草稿改走 promote。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);

const [cols] = await conn.query("SHOW COLUMNS FROM research_strategy_candidate");
console.log("=== 列 ===");
console.log((cols as Array<{ Field: string }>).map(r => r.Field).join(", "));

const [rows] = await conn.query(
  "SELECT id, name, status, conclusionId, experimentId, sourceResearchRunId, "
  + "sourceDatasetVersionId, sourceDatasetDivergenceReason, LENGTH(entryRuleJson) AS entryLen, "
  + "LENGTH(filterRuleJson) AS filterLen, LENGTH(exitRuleJson) AS exitLen, "
  + "LENGTH(riskRuleJson) AS riskLen, LENGTH(parameterSpaceJson) AS paramLen, createdAt, status "
  + "FROM research_strategy_candidate ORDER BY id",
);
console.log("\n=== 候选行 ===");
for (const r of rows as Array<Record<string, unknown>>) {
  console.log(JSON.stringify(r));
}

const [conclCols] = await conn.query("SHOW COLUMNS FROM research_conclusion");
console.log("\n=== research_conclusion 列 ===");
console.log((conclCols as Array<{ Field: string }>).map(r => r.Field).join(", "));

const [concl] = await conn.query("SELECT * FROM research_conclusion ORDER BY id DESC LIMIT 20");
console.log("\n=== 最近结论（前 20） ===");
for (const r of concl as Array<Record<string, unknown>>) {
  const row = r as Record<string, unknown>;
  const brief: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (k === "description" || k === "summaryJson" || k === "evidenceJson") continue;
    brief[k] = row[k];
  }
  console.log(JSON.stringify(brief));
}

await conn.end();
process.exit(0);
