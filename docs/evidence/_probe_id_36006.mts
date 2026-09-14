/**
 * 探针（只读）：全库扫描 `id = 36006` 落在哪张表（用于定位用户口中的「回测 36006」），
 * 并 dump 两张回测相关表的内容与自增现状。
 *
 * 用法（项目根目录）：
 *   npx tsx docs/evidence/_probe_id_36006.mts > docs/evidence/_probe_id_36006.log 2>&1
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const TARGET = 36006;

const db = await getDb();
if (!db) {
  console.log("数据库不可用（DATABASE_URL 未配置）");
  process.exit(1);
}

/** db.execute 在 mysql2 驱动下返回 [rows, fields]，这里统一取 rows。 */
async function q(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const res = (await db!.execute(query)) as unknown as [
    Record<string, unknown>[],
    unknown,
  ];
  return Array.isArray(res[0]) ? res[0] : (res as unknown as Record<string, unknown>[]);
}

// 1. 列出所有基表
const tables = await q(sql`
  SELECT table_name AS t
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
  ORDER BY table_name
`);
console.log(`=== 基表总数: ${tables.length} ===`);

// 2. 逐个表尝试 SELECT ... WHERE id = TARGET
const hits: string[] = [];
for (const row of tables) {
  const t = String(row.t);
  try {
    const r = await q(
      sql`SELECT id FROM ${sql.raw(`\`${t}\``)} WHERE id = ${TARGET} LIMIT 1`,
    );
    if (r.length > 0) hits.push(t);
  } catch {
    // 没有 id 列 / 类型不兼容 ⇒ 跳过（只读扫描，不关心原因）
  }
}
console.log(`=== id=${TARGET} 命中的表: ${hits.length ? hits.join(", ") : "（无）"} ===`);

// 3. 两张回测表的真实内容
console.log(`\n=== backtest_runs（legacy 龙头候选）===`);
try {
  const legacy = await q(sql`
    SELECT id, paramsHash, CHAR_LENGTH(COALESCE(resultJson,'')) AS resultLen, createdAt
    FROM backtest_runs ORDER BY id
  `);
  for (const r of legacy) console.log(JSON.stringify(r));
} catch (err) {
  console.log(`查询失败: ${String(err)}`);
}

console.log(`\n=== closed_loop_backtest_run（闭环留档）===`);
const clbr = await q(sql`
  SELECT id, runId, experimentId, strategyId, startDate, endDate,
         datasetVersionId, datasetSource, status, tradeCount, finalEquity, createdAt
  FROM closed_loop_backtest_run ORDER BY id
`);
for (const r of clbr) console.log(JSON.stringify(r));

// 4. 自增现状（TiDB 步长通常为 30000）
console.log(`\n=== AUTO_INCREMENT 现状 ===`);
for (const t of ["closed_loop_backtest_run", "backtest_runs"]) {
  try {
    const info = await q(sql`
      SELECT table_name AS t, auto_increment AS next
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ${t}
    `);
    for (const r of info) console.log(JSON.stringify(r));
  } catch (err) {
    console.log(`${t}: ${String(err)}`);
  }
}

process.exit(0);
