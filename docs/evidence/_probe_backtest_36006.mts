/**
 * 探针（只读）：定位「回测 36006」指的是哪张表的记录，并列出闭环留档表现状。
 *
 * 用法（必须在项目根目录执行）：
 *   npx tsx docs/evidence/_probe_backtest_36006.mts > docs/evidence/_probe_backtest_36006.log 2>&1
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

function dump(label: string, rows: unknown[]) {
  console.log(`\n=== ${label} (${rows.length} 行) ===`);
  for (const r of rows) console.log(JSON.stringify(r));
}

try {
  // 1. closed_loop_backtest_run 全表
  const clbr = await db.execute(sql`
    SELECT id, runId, experimentId, strategyId, strategyVersion,
           startDate, endDate, datasetVersionId, datasetSource, status,
           executedStageCount, blockedStageCount, skippedStageCount,
           tradeCount, finalEquity, CHAR_LENGTH(COALESCE(resultJson,'')) AS len,
           createdAt
    FROM closed_loop_backtest_run ORDER BY id
  `);
  dump("closed_loop_backtest_run 全表", clbr as unknown[]);

  // 2. 该表 id 最大值 / 是否含 TARGET
  const hitClbr = await db.execute(sql`
    SELECT id, runId, experimentId, status, createdAt
    FROM closed_loop_backtest_run WHERE id = ${TARGET}
  `);
  dump(`closed_loop_backtest_run where id=${TARGET}`, hitClbr as unknown[]);

  // 3. legacy backtest_runs
  const legacy = await db.execute(sql`
    SELECT id, strategyId, version, startDate, endDate,
           CHAR_LENGTH(COALESCE(resultJson,'')) AS len, createdAt
    FROM backtest_runs ORDER BY id
  `);
  dump("backtest_runs 全表(legacy)", legacy as unknown[]);

  const hitLegacy = await db.execute(sql`
    SELECT id, strategyId, version, startDate, endDate, createdAt
    FROM backtest_runs WHERE id = ${TARGET}
  `);
  dump(`backtest_runs where id=${TARGET}`, hitLegacy as unknown[]);

  // 4. research_experiment / research_run 是否命中
  for (const t of ["research_experiment", "research_run"] as const) {
    const hit = await db.execute(
      sql`SELECT id FROM ${sql.raw(t)} WHERE id = ${TARGET}`,
    );
    dump(`${t} where id=${TARGET}`, hit as unknown[]);
  }
} catch (err) {
  // 顶层 catch 必须摊开 cause 链
  let e: unknown = err;
  let depth = 0;
  while (e && depth < 6) {
    const anyE = e as Record<string, unknown>;
    console.log(
      `[cause ${depth}] ${(e as object).constructor?.name} code=${anyE.code} errno=${anyE.errno} sqlState=${anyE.sqlState} msg=${anyE.sqlMessage ?? anyE.message}`,
    );
    e = anyE.cause;
    depth += 1;
  }
  process.exit(1);
}

process.exit(0);
