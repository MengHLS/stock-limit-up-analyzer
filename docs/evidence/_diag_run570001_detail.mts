/**
 * 诊断：run 570001 的 13 个 CONDITIONAL 分析 + 其 condition / metric（只读）。
 *
 * 目的：读出「四组条件」的真实统计结果，挑出有信号的组作为策略候选。
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);

for (const table of ["research_analysis_condition", "research_analysis_metric"]) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM ${table}`);
  console.log(`\n=== ${table} 列 ===`);
  console.log((cols as Array<{ Field: string }>).map(r => r.Field).join(", "));
}

const [conds] = await conn.query(
  "SELECT * FROM research_analysis_condition WHERE analysisId BETWEEN 540001 AND 540013 ORDER BY analysisId, id",
);
console.log(`\n=== 条件（${(conds as unknown[]).length} 行） ===`);
for (const r of conds as Array<Record<string, unknown>>) {
  console.log(JSON.stringify(r));
}

const [mets] = await conn.query(
  "SELECT * FROM research_analysis_metric WHERE analysisId BETWEEN 540001 AND 540013 ORDER BY analysisId, id",
);
console.log(`\n=== 指标（${(mets as unknown[]).length} 行） ===`);
for (const r of mets as Array<Record<string, unknown>>) {
  const row = r as Record<string, unknown>;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === "string" && v.length > 200) row[k] = `${v.slice(0, 200)}…`;
  }
  console.log(JSON.stringify(row));
}

await conn.end();
process.exit(0);
