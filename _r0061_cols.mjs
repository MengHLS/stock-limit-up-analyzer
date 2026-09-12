// 一次性：抓取 11 张非 Candidate 的 research_* 表列签名（作为 006.1 冻结基线）
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
const u = new URL(env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, ""));
const conn = await mysql.createConnection({
  host: u.hostname, port: +u.port, user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password), database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true }, connectTimeout: 15000,
});
const T = [
  "research_experiment", "research_hypothesis", "research_run", "research_analysis",
  "research_analysis_condition", "research_analysis_metric", "research_result",
  "research_conclusion", "research_artifact", "research_analysis_template",
  "research_analysis_template_item",
];
for (const t of T) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
    [t],
  );
  console.log(`  "${t}": [${rows.map((r) => `"${r.COLUMN_NAME}"`).join(", ")}],`);
}
await conn.end();
