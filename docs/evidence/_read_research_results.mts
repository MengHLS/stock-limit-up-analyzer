/**
 * 只读探针：读取 research_result 表，验证 Run #570001 的 13 条分析是否真有结果。
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const RUN_ID = 570001;

const m = /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL!);
if (!m) throw new Error("DATABASE_URL 解析失败");
const cfg = {
  user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]),
  host: m[3],
  port: Number(m[4]),
  database: m[5].split("/")[0],
};

const conn = await mysql.createConnection({
  ...cfg,
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30_000,
});

const [cols] = await conn.query<any[]>(
  `SELECT column_name AS c FROM information_schema.columns
    WHERE table_schema = ? AND table_name = 'research_result' ORDER BY ordinal_position`,
  [cfg.database],
);
console.log(`research_result columns => ${cols.map((r) => r.c).join(", ")}\n`);

const [rows] = await conn.query<any[]>(
  `SELECT * FROM research_result WHERE runId = ? OR analysisId IN (
      SELECT id FROM research_analysis WHERE runId = ?
   ) ORDER BY id LIMIT 80`,
  [RUN_ID, RUN_ID],
).catch(async () => {
  const [r] = await conn.query<any[]>(
    `SELECT * FROM research_result ORDER BY id DESC LIMIT 20`,
  );
  return [r];
});

console.log(`result rows = ${rows.length}`);
for (const r of rows.slice(0, 40)) {
  console.log(JSON.stringify(r));
}

await conn.end();
