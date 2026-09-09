// STEP STRATEGY-002 — 策略持久化 migration 应用脚本（幂等）。
// 读取 drizzle/0026_strategy_persistence.sql，按 statement-breakpoint 分割后逐条执行。
// 表用 CREATE TABLE IF NOT EXISTS，重复运行无副作用。
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(\S+)/)[1].replace(/["']/g, "");
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: +u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

const sqlText = readFileSync(new URL("../drizzle/0026_strategy_persistence.sql", import.meta.url), "utf8");
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const stmt of statements) {
  await conn.query(stmt);
}

// 验证表已创建 + 唯一约束存在
const [tables] = await conn.query(
  "SHOW TABLES LIKE 'strategies'",
);
const [vtables] = await conn.query(
  "SHOW TABLES LIKE 'strategy_versions'",
);
const [uniq] = await conn.query(
  `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'strategy_versions' AND INDEX_NAME = 'uq_strategy_versions_id_version'`,
);

console.log(JSON.stringify({
  statementsExecuted: statements.length,
  strategiesTable: tables.length > 0,
  strategyVersionsTable: vtables.length > 0,
  uniqueIndexPresent: Number(uniq[0].n) > 0,
}, null, 2));

await conn.end();
