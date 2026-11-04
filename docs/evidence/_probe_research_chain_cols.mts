/**
 * 只读：确认研究链各表的外键列真实列名（**禁凭记忆写 SQL**）。
 * 用途：STEP 0-3「研究链体检」端点的计数查询要按真实列名写。
 * 用法：node --import tsx docs/evidence/_probe_research_chain_cols.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const OUT = "docs/evidence/_probe_research_chain_cols.out.txt";
const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  process.stdout.write(s + "\n");
};

const db = await getDb();
if (!db) {
  say(JSON.stringify({ dbAvailable: false }));
  writeFileSync(OUT, lines.join("\n"), "utf8");
  process.exit(1);
}

const tables = [
  "research_experiment",
  "research_hypothesis",
  "research_question",
  "research_plan",
  "research_run",
  "research_analysis",
  "research_result",
  "research_finding",
  "research_conclusion",
  "research_strategy_candidate",
];

const res = await db.execute(sql`
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema = database()
    and table_name in (${sql.join(
      tables.map((t) => sql`${t}`),
      sql`, `,
    )})
  order by table_name, ordinal_position`);

const rows = ((res as unknown as unknown[])[0] ?? []) as Array<Record<string, unknown>>;
const byTable = new Map<string, string[]>();
for (const r of rows) {
  const t = String(r["table_name"]);
  if (!byTable.has(t)) byTable.set(t, []);
  byTable.get(t)!.push(String(r["column_name"]));
}

for (const t of tables) {
  const cols = byTable.get(t);
  say(`--- ${t} ---`);
  say(cols ? cols.join(", ") : "(表不存在)");
}

/** 关键：哪些表带 experimentId / runId（跨表聚合的锚点）。 */
say("=== 外键锚点速查 ===");
for (const t of tables) {
  const cols = byTable.get(t) ?? [];
  const anchors = ["experimentId", "runId", "analysisId", "hypothesisId", "questionId", "planId"].filter((c) =>
    cols.includes(c),
  );
  say(`${t}: ${anchors.length > 0 ? anchors.join(" / ") : "(无跨表锚点列)"}`);
}

writeFileSync(OUT, lines.join("\n"), "utf8");
process.exit(0);
