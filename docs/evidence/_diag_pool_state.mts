/**
 * 诊断：默认网关 / 连接池 前置事实收集（只读）。
 *  ① research_runs 各状态计数（判断重启是否会杀死在途 Run）
 *  ② 池配置复现：maxIdle == connectionLimit ⇒ mysql2 空闲回收定时器不启动
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  try {
    const [runs] = await conn.query(
      "SELECT status, COUNT(*) AS c FROM research_runs GROUP BY status ORDER BY c DESC",
    );
    console.log("research_runs 状态分布：");
    for (const r of runs as Array<Record<string, unknown>>) console.log(`    ${r.status}: ${r.c}`);

    const [analyses] = await conn.query(
      "SELECT status, COUNT(*) AS c FROM research_analysis GROUP BY status ORDER BY c DESC",
    );
    console.log("research_analysis 状态分布：");
    for (const r of analyses as Array<Record<string, unknown>>) console.log(`    ${r.status}: ${r.c}`);

    const [candidates] = await conn.query(
      "SELECT status, COUNT(*) AS c FROM research_strategy_candidate GROUP BY status ORDER BY c DESC",
    );
    console.log("research_strategy_candidate 状态分布：");
    for (const r of candidates as Array<Record<string, unknown>>) console.log(`    ${r.status}: ${r.c}`);

    const [strategies] = await conn.query(
      "SELECT strategyId, currentVersionId, updatedAt FROM strategies ORDER BY updatedAt DESC LIMIT 5",
    );
    console.log("strategies 最近 5 条：");
    for (const r of strategies as Array<Record<string, unknown>>) {
      console.log(`    ${r.strategyId} currentVersionId=${r.currentVersionId} updatedAt=${r.updatedAt}`);
    }

    const [poolVars] = await conn.query(
      "SELECT @@wait_timeout AS wait_timeout, @@interactive_timeout AS interactive_timeout",
    );
    console.log("服务端超时：", JSON.stringify(poolVars));

    const [tls] = await conn.query("SELECT @@hostname AS host, @@port AS port");
    console.log("服务端：", JSON.stringify(tls));
  } finally {
    await conn.end();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
