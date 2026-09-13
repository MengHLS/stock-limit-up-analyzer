/**
 * 诊断：run 570001 的 13 个 CONDIITONAL 分析的**真实结果**（只读）。
 *
 * 目的：为「四组条件 → 策略候选」挑选有统计信号的那几组，并把条件口径读出来。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);

const [cols] = await conn.query("SHOW COLUMNS FROM research_analysis_result");
console.log("=== research_analysis_result 列 ===");
console.log((cols as Array<{ Field: string }>).map(r => r.Field).join(", "));

const [rows] = await conn.query(
  "SELECT * FROM research_analysis_result WHERE analysisId BETWEEN 540001 AND 540013 ORDER BY analysisId",
);
console.log(`\n=== run 570001 结果（${(rows as unknown[]).length} 行） ===`);
for (const r of rows as Array<Record<string, unknown>>) {
  const row = r as Record<string, unknown>;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === "string" && v.length > 300) row[k] = `${v.slice(0, 300)}…(len=${v.length})`;
  }
  console.log(JSON.stringify(row));
}

await conn.end();
process.exit(0);
