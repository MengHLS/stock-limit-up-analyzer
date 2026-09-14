/**
 * 探针（只读）：列出策略清单，用于定位用户口中的「回测 36006」。
 *
 * 用法（项目根目录）：
 *   npx tsx docs/evidence/_probe_strategy_list.mts > docs/evidence/_probe_strategy_list.log 2>&1
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const db = await getDb();
if (!db) {
  console.log("数据库不可用");
  process.exit(1);
}

async function q(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const res = (await db!.execute(query)) as unknown as [
    Record<string, unknown>[],
    unknown,
  ];
  return Array.isArray(res[0]) ? res[0] : (res as unknown as Record<string, unknown>[]);
}

try {
  console.log("=== strategies（策略身份）===");
  const list = await q(sql`
    SELECT id, strategyId, name, latestVersion, status, createdAt
    FROM strategies ORDER BY id
  `);
  for (const r of list) console.log(JSON.stringify(r));

  console.log("\n=== 含 '360' 的策略 ===");
  const hit = await q(sql`
    SELECT id, strategyId, name, latestVersion FROM strategies
    WHERE strategyId LIKE '%360%' OR CAST(id AS CHAR) LIKE '%3600%'
  `);
  for (const r of hit) console.log(JSON.stringify(r));

  console.log("\n=== strategy_versions（版本数按策略）===");
  const vers = await q(sql`
    SELECT strategyId, COUNT(*) AS versions, MAX(version) AS maxVersion,
           MAX(createdAt) AS lastCreated
    FROM strategy_versions GROUP BY strategyId ORDER BY strategyId
  `);
  for (const r of vers) console.log(JSON.stringify(r));

  console.log("\n=== research_strategy_candidate 状态分布 ===");
  const cands = await q(sql`
    SELECT status, COUNT(*) AS n FROM research_strategy_candidate GROUP BY status
  `);
  for (const r of cands) console.log(JSON.stringify(r));
} catch (err) {
  let e: unknown = err;
  let d = 0;
  while (e && d < 6) {
    const a = e as Record<string, unknown>;
    console.log(
      `[cause ${d}] ${(e as object).constructor?.name} code=${a.code} msg=${a.sqlMessage ?? a.message}`,
    );
    e = a.cause;
    d += 1;
  }
  process.exit(1);
}

process.exit(0);
