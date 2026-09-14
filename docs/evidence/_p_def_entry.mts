import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";
const db = await getDb();
const res = await db.execute(sql`select strategyId, version, strategyDocumentJson from strategy_versions where strategyId='cand-360004' order by version`);
const rows = (res as unknown as [Array<Record<string, unknown>>])[0] ?? [];
for (const r of rows) {
  const doc: any = JSON.parse(String(r["strategyDocumentJson"]));
  console.log("=== entry ===");
  console.log(JSON.stringify(doc.definition.entry, null, 2));
  console.log("=== exit ===");
  console.log(JSON.stringify(doc.definition.exit, null, 2));
  console.log("=== execution/parameters ===");
  console.log(JSON.stringify({ execution: doc.definition.execution, parameters: doc.parameters, recipe: doc.recipe }, null, 2));
  console.log("=== entryRules(v1 view) ===");
  console.log(JSON.stringify(doc.entryRules, null, 2));
}
process.exit(0);
