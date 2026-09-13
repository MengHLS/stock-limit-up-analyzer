/**
 * 探针：验证「连接池把死连接发出去」—— 复跑 `stock_daily_prices` 按日查询
 * （报错形状 = server/db.ts:1934-1944 的 9 列 select）。
 *
 * 判据：
 *   1. 单次查询能否成功（排除「数据/权限/SQL 本身有问题」）；
 *   2. 空置 > idleTimeout 后再查，是否复现 `ECONNRESET`（证明是池里的死连接）；
 *   3. 打印池配置，确认 maxIdle >= connectionLimit 会让 idle 回收定时器失效。
 *
 * 🚫 只读；不写任何表。
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_pool_stale.mts`
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const OUT = "docs/evidence/_probe_pool_stale.json";
const report: Record<string, unknown> = {};

const loginDate = "2024-09-02";

/** 与 db.ts:1934-1944 同形状的查询（9 列，逐字一致）。 */
async function probeQuery(label: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    report[label] = { ok: false, error: "getDb() 返回 null" };
    return;
  }
  const started = Date.now();
  try {
    const rows = await db.execute(
      sql`select \`stockCode\`, \`tradeDate\`, \`openPrice\`, \`closePrice\`, \`highPrice\`, \`lowPrice\`, \`preClosePrice\`, \`volume\`, \`amount\` from \`stock_daily_prices\` where \`stock_daily_prices\`.\`tradeDate\` = ${loginDate}`,
    );
    const list = (rows as unknown as [unknown[]])[0] ?? [];
    report[label] = {
      ok: true,
      elapsedMs: Date.now() - started,
      rowCount: Array.isArray(list) ? list.length : null,
    };
    console.log(`  ${label}: OK (${Date.now() - started}ms, rows=${Array.isArray(list) ? list.length : "?"})`);
  } catch (error) {
    const e = error as { message?: string; code?: string; errno?: number };
    report[label] = {
      ok: false,
      elapsedMs: Date.now() - started,
      message: e.message,
      code: e.code,
      errno: e.errno,
    };
    console.log(`  ${label}: FAIL (${Date.now() - started}ms) ${e.code ?? ""} ${e.message}`);
  }
}

/** 池配置可观测性（mysql2 私有字段，尽力读取，读不到就记 null）。 */
async function poolConfig(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const pool = (db as unknown as { session?: { client?: unknown } }).session?.client;
  const p = pool as { config?: Record<string, unknown>; pool?: { _freeConnections?: unknown[]; _allConnections?: unknown[] } };
  const cfg = p?.config ?? {};
  report.poolConfig = {
    connectionLimit: cfg.connectionLimit ?? null,
    maxIdle: cfg.maxIdle ?? null,
    idleTimeout: cfg.idleTimeout ?? null,
    enableKeepAlive: cfg.enableKeepAlive ?? null,
    connectTimeout: cfg.connectTimeout ?? null,
  };
  report.poolState = {
    freeConnections: Array.isArray(p?.pool?._freeConnections) ? p.pool._freeConnections.length : null,
    allConnections: Array.isArray(p?.pool?._allConnections) ? p.pool._allConnections.length : null,
  };
  console.log(`  池配置 = ${JSON.stringify(report.poolConfig)}`);
  console.log(`  池状态 = ${JSON.stringify(report.poolState)}`);
}

console.log(`探针起点：复跑 stock_daily_prices 按日查询（tradeDate=${loginDate}）`);
await poolConfig();
await probeQuery("firstQuery");

const IDLE_WAIT_MS = 70_000; // 略超 idleTimeout(60s)
console.log(`  空置 ${IDLE_WAIT_MS / 1000}s（> idleTimeout 60s）后复跑……`);
await new Promise((r) => setTimeout(r, IDLE_WAIT_MS));
await poolConfig();
await probeQuery("afterIdle");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(`报告 → ${OUT}`);
process.exit(0);
