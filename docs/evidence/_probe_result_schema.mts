/** 只读：核对 research 相关表的真实列名（禁凭记忆推理）。 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log("db unavailable");
  process.exit(1);
}
const out: string[] = [];

const tables = (await db.execute(sql`
  select table_name from information_schema.tables
  where table_schema = database() and table_name like 'research%'
  order by table_name
`)) as unknown as [Array<{ table_name: string }>];
out.push("research* 表清单：");
for (const t of tables[0] ?? []) out.push(`  · ${t.table_name}`);

for (const name of ["research_result", "research_analysis_metric", "research_finding"]) {
  const cols = (await db.execute(sql`
    select column_name, data_type, is_nullable from information_schema.columns
    where table_schema = database() and table_name = ${name}
    order by ordinal_position
  `)) as unknown as [Array<{ column_name: string; data_type: string; is_nullable: string }>];
  out.push(`\n${name} 列（${(cols[0] ?? []).length} 个）：`);
  for (const c of cols[0] ?? []) out.push(`  ${c.column_name.padEnd(28)} ${c.data_type.padEnd(20)} nullable=${c.is_nullable}`);
}

const { writeFileSync } = await import("node:fs");
writeFileSync("docs/evidence/_probe_result_schema.out.txt", out.join("\n"), "utf8");
console.log(out.join("\n"));
process.exit(0);
