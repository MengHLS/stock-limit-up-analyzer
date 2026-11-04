/**
 * RESEARCH-PLANNER-001 — 库表存在性核对（只读）。
 *
 * E2E 要往 `research_question` / `research_plan` 写行，所以先确认这两张表真的存在、
 * 列齐、且 `research_strategy_candidate.sourceResearchPlanId` 已生效。
 * 用法：npx tsx docs/evidence/_probe_plan_tables.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const names = ["research_question", "research_plan", "research_strategy_candidate"];
for (const t of names) {
  const r = (await db.execute(sql`
    select column_name, column_type, is_nullable
    from information_schema.columns
    where table_schema = database() and table_name = ${t}
    order by ordinal_position`)) as unknown as [Array<Record<string, unknown>>];
  const cols = r[0] ?? [];
  console.log(`--- ${t} (${cols.length} columns) ---`);
  console.log(
    cols
      .map((c) => `${c["column_name"]}:${String(c["column_type"]).slice(0, 24)}${c["is_nullable"] === "YES" ? "?" : ""}`)
      .join("  "),
  );
}

const fk = (await db.execute(sql`
  select count(*) n from information_schema.table_constraints
  where table_schema = database() and constraint_type = 'FOREIGN KEY'`)) as unknown as [Array<Record<string, unknown>>];
console.log("FK count in schema =", fk[0]?.[0]?.["n"]);

const cnt = (await db.execute(sql`
  select (select count(*) from research_question) q,
         (select count(*) from research_plan) p,
         (select count(*) from research_analysis where planId is not null) pa`)) as unknown as [
  Array<Record<string, unknown>>,
];
console.log("rows:", JSON.stringify(cnt[0]?.[0]));
process.exit(0);
