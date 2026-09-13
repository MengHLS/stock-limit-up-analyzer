/** 诊断：run 570001 分析结果的落点表（research_result / research_artifact）（只读）。 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const conn = await createConnection(process.env.DATABASE_URL as string);

for (const table of ["research_result", "research_artifact"]) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM ${table}`);
  console.log(`\n=== ${table} 列 ===`);
  console.log((cols as Array<{ Field: string }>).map(r => r.Field).join(", "));
}

for (const table of ["research_result", "research_artifact"]) {
  const [rows] = await conn.query(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 30`);
  console.log(`\n=== ${table} 最近 30 行（共 ${(rows as unknown[]).length}） ===`);
  for (const r of rows as Array<Record<string, unknown>>) {
    const row = { ...(r as Record<string, unknown>) };
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (typeof v === "string" && v.length > 400) row[k] = `${v.slice(0, 400)}…(len=${v.length})`;
    }
    console.log(JSON.stringify(row));
  }
}

await conn.end();
process.exit(0);
