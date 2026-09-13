/**
 * 诊断：结论 510001（SUPPORTED, future_return_5d）的上游分析配置（只读）。
 *
 * 目的：确认该结论对应的是哪一组「有效条件」，以便把同一组条件搬进候选草稿。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);

const [cols] = await conn.query("SHOW COLUMNS FROM research_analysis");
console.log("=== research_analysis 列 ===");
console.log((cols as Array<{ Field: string }>).map(r => r.Field).join(", "));

const [rows] = await conn.query(
  "SELECT id, runId, analysisType, name, target, configJson, status, createdAt FROM research_analysis ORDER BY id DESC LIMIT 15",
);
console.log("\n=== 最近分析（15） ===");
for (const r of rows as Array<Record<string, unknown>>) {
  const row = r as Record<string, unknown>;
  const cfg = typeof row.configJson === "string" ? row.configJson : JSON.stringify(row.configJson);
  console.log(`#${row.id} run=${row.runId} type=${row.analysisType} status=${row.status} name=${JSON.stringify(row.name)}`);
  console.log(`   target=${JSON.stringify(row.target)}`);
  console.log(`   config=${cfg}`);
}

await conn.end();
process.exit(0);
