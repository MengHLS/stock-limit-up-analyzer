/**
 * 只读探针：检查是否有**在途**研究 Run / 分析。
 *
 * 用途：跑重型真实库脚本（含完整回归里的 DB 用例）**之前**确认没有正在跑的研究任务 ——
 * 免得把别人在途的 Run 拖坏（见 PROJECT_RULES「动手前三门」第 2 条）。
 * 本脚本只读，不写任何数据。
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

async function q(label: string, sql: string) {
  try {
    const [rows] = await conn.query<any[]>(sql);
    console.log(`${label}: ${JSON.stringify(rows)}`);
  } catch (e) {
    console.log(`${label}: 查询失败 — ${(e as Error).message.split("\n")[0]}`);
  }
}

await q("research_runs 状态分布", "SELECT status, COUNT(*) AS c FROM research_runs GROUP BY status");
await q("research_analysis 行数", "SELECT COUNT(*) AS c FROM research_analysis");

await conn.end();
