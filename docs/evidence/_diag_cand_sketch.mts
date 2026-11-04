/** 诊断：候选草稿 5 个 *Json 列的真实存储形态（只读）—— 用于判断「JSON 文本框」到底要人写什么 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(
  "SELECT id, name, description, entryRuleJson, filterRuleJson, exitRuleJson, riskRuleJson, parameterSpaceJson FROM research_strategy_candidate ORDER BY id",
);
for (const r of rows as Array<Record<string, unknown>>) {
  console.log(`\n=== candidate ${r.id} —— ${r.name} ===`);
  console.log(`description: ${JSON.stringify(r.description)}`);
  for (const key of ["entryRuleJson", "filterRuleJson", "exitRuleJson", "riskRuleJson", "parameterSpaceJson"]) {
    const raw = r[key];
    if (raw === null || raw === undefined) {
      console.log(`${key}: <NULL>`);
      continue;
    }
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    console.log(`${key} (${text.length} chars): ${text.length > 700 ? text.slice(0, 700) + " …" : text}`);
  }
}
await conn.end();
process.exit(0);
