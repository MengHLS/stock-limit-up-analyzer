import "dotenv/config";
import mysql from "mysql2/promise";

const m = /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(process.env.DATABASE_URL!);
if (!m) throw new Error("DATABASE_URL 解析失败");
const conn = await mysql.createConnection({
  user: decodeURIComponent(m[1]),
  password: decodeURIComponent(m[2]),
  host: m[3],
  port: Number(m[4]),
  database: m[5].split("/")[0],
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30_000,
});

const [cols] = await conn.query<any[]>("SHOW COLUMNS FROM research_analysis");
console.log("列:", cols.map((c) => c.Field).join(", "));

const [rows] = await conn.query<any[]>(
  "SELECT * FROM research_analysis WHERE status IN ('RUNNING','PENDING','QUEUED')",
);
console.log(`\n在途 = ${rows.length} 条:`);
console.log(JSON.stringify(rows, null, 2));

await conn.end();
