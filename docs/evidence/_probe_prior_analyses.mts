/**
 * RESEARCH-PLANNER-001 — 找「既有手工分析」做 E2E 对照（只读）。
 * 用法：npx tsx docs/evidence/_probe_prior_analyses.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) process.exit(1);

const rows = (await db.execute(sql`
  select a.id, a.runId, a.analysisType, a.status, a.target, a.name, a.planId
  from research_analysis a
  where a.name like '%开盘价%' or a.name like '%holds_event%' or a.name like '%回踩%'
     or exists (select 1 from research_analysis_condition c where c.analysisId = a.id)
  order by a.id desc limit 30`)) as unknown as [Array<Record<string, unknown>>];
console.log("=== 候选对照分析（按 id 降序，最多 30）===");
for (const r of rows[0] ?? []) {
  console.log(
    `  #${r["id"]} run=${r["runId"]} plan=${r["planId"] ?? "-"} ${r["analysisType"]} ${r["status"]} target=${r["target"] ?? "-"} :: ${String(r["name"]).slice(0, 80)}`,
  );
}

const condRows = (await db.execute(sql`
  select c.analysisId, c.groupNo, c.sortOrder, c.fieldName, c.operator, c.valueJson
  from research_analysis_condition c
  where c.analysisId in (select id from research_analysis order by id desc limit 30)
  order by c.analysisId desc, c.groupNo, c.sortOrder`)) as unknown as [Array<Record<string, unknown>>];
console.log("\n=== 最近 30 条分析的条件 ===");
for (const r of condRows[0] ?? []) {
  console.log(`  #${r["analysisId"]} g${r["groupNo"]}.${r["sortOrder"]} ${r["fieldName"]} ${r["operator"]} ${r["valueJson"]}`);
}

const runRows = (await db.execute(sql`
  select r.id, r.experimentId, r.runNo, r.status, r.sampleCount, r.createdAt
  from research_run r order by r.id desc limit 12`)) as unknown as [Array<Record<string, unknown>>];
console.log("\n=== 最近 12 个 Run ===");
for (const r of runRows[0] ?? []) {
  console.log(`  run=${r["id"]} exp=${r["experimentId"]} no=${r["runNo"]} ${r["status"]} n=${r["sampleCount"]} ${r["createdAt"]}`);
}
process.exit(0);
