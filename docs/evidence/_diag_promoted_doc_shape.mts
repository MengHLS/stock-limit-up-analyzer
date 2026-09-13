/** 诊断：新转正文档的真实 JSON 形状（只读）—— 确认 parameters / entry.conditions / execution 的真实路径。 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);
const [rows] = await conn.query(
  "SELECT id AS versionId, strategyId, strategyDocumentJson FROM strategy_versions "
  + "WHERE strategyId IN ('cand-360001', 'cand-360002') ORDER BY id",
);
for (const r of rows as Array<Record<string, unknown>>) {
  const row = r as Record<string, unknown>;
  const doc = typeof row.strategyDocumentJson === "string"
    ? JSON.parse(row.strategyDocumentJson) : row.strategyDocumentJson;
  console.log(`\n=== ${row.strategyId} (versionId=${row.versionId}) ===`);
  console.log("顶层键:", Object.keys(doc).join(", "));
  console.log("definition 键:", Object.keys((doc as Record<string, unknown>).definition ?? {}).join(", "));
  console.log("parameters:", JSON.stringify((doc as Record<string, unknown>).parameters));
  console.log("recipe:", JSON.stringify((doc as Record<string, unknown>).recipe));
  const def = ((doc as Record<string, unknown>).definition ?? {}) as Record<string, unknown>;
  console.log("definition.execution:", JSON.stringify(def.execution));
  console.log("definition.entry:", JSON.stringify(def.entry)?.slice(0, 700));
}
await conn.end();
process.exit(0);
