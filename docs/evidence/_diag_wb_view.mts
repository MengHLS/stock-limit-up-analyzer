/**
 * 诊断：策略工作台（/strategy-editor）**能看到什么**（只读）。
 *  ① strategies / strategy_versions：页面上「已保存策略」列表的数据源
 *  ② strategy_research_provenance：溯源面板的数据源（空 ⇒ 面板只会显示「没有溯源记录」）
 *  ③ research_strategy_candidate：promote 的来源（空 ⇒ 从研究侧看不到任何「转正」产物）
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  try {
    const [strategies] = await conn.query(
      "SELECT id, strategyId, name, status, currentVersionId, createdAt, updatedAt FROM strategies ORDER BY updatedAt DESC",
    );
    console.log(`strategies 共 ${(strategies as unknown[]).length} 行：`);
    for (const r of strategies as Array<Record<string, unknown>>) {
      console.log(
        `    id=${r.id} strategyId=${r.strategyId} name=${r.name} status=${r.status} currentVersionId=${r.currentVersionId}`,
      );
      console.log(`        createdAt=${r.createdAt} updatedAt=${r.updatedAt}`);
    }

    const [versions] = await conn.query(
      "SELECT id, strategyId, version, status, createdAt FROM strategy_versions ORDER BY id",
    );
    console.log(`\nstrategy_versions 共 ${(versions as unknown[]).length} 行：`);
    for (const r of versions as Array<Record<string, unknown>>) {
      console.log(`    id=${r.id} ${r.strategyId}@${r.version} status=${r.status} createdAt=${r.createdAt}`);
    }

    const [prov] = await conn.query(
      "SELECT strategyId, strategyVersionId, sourceCandidateId, sourceConclusionId, sourceDatasetVersionId FROM strategy_research_provenance",
    );
    console.log(`\nstrategy_research_provenance 共 ${(prov as unknown[]).length} 行：`);
    for (const r of prov as Array<Record<string, unknown>>) console.log("   ", JSON.stringify(r));

    const [cands] = await conn.query(
      "SELECT id, status, name, createdAt FROM research_strategy_candidate ORDER BY id DESC LIMIT 10",
    );
    console.log(`\nresearch_strategy_candidate 共 ${(cands as unknown[]).length} 行（最近 10）：`);
    for (const r of cands as Array<Record<string, unknown>>) console.log("   ", JSON.stringify(r));

    const [runs] = await conn.query(
      "SELECT id, status, experimentId, createdAt FROM research_runs ORDER BY id DESC LIMIT 5",
    );
    console.log("\nresearch_runs 最近 5 行：");
    for (const r of runs as Array<Record<string, unknown>>) console.log("   ", JSON.stringify(r));
  } finally {
    await conn.end();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
