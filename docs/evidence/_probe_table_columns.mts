/**
 * 只读探针：列出 research_analysis_condition / research_analysis_metric 的真实列名。
 * 用途：写结果读取探针前对齐字段名（避免凭记忆写 SQL）。
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const m = /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL!);
if (!m) throw new Error("DATABASE_URL 解析失败");
const dbName = m[5].split("/")[0];

const conn = await mysql.createConnection({
  user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]),
  host: m[3],
  port: Number(m[4]),
  database: dbName,
  ssl: { rejectUnauthorized: false },
});

for (const t of [
  "research_analysis",
  "research_analysis_condition",
  "research_analysis_metric",
]) {
  const [rows] = await conn.query<any[]>(
    `SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    [dbName, t],
  );
  console.log(`${t} => ${rows.map((r) => r.c).join(", ")}`);
}

await conn.end();
