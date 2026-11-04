/**
 * DATASET-002.3 — Dataset Registry 真实 API 验证探针（只读，不改数据）。
 *
 * 走真实查询层（DatasetQueryService + DbDatasetRegistry + DbDatasetDataReader），
 * 即 tRPC router 的实际执行路径，验证：
 *   - listDefinitions 返回 first_limit_pullback；
 *   - getDefinition 返回 smoke / v1 / v2 三版本；
 *   - getStatistics(v2) 实测 COUNT = 10,240 事件 / 206,408 路径 / 30,720 结果；
 *   - listEvents / listPaths / listOutcomes keyset 分页读真实 TiDB（无 OFFSET / 全量）。
 *
 * 用法：DATABASE_URL 来自 .env（dotenv/config）。npx tsx scripts/verifyDatasetRegistryRead.mts
 */

import "dotenv/config";
import { DbDatasetRegistry } from "../server/datasetRegistry/db";
import {
  DbDatasetDataReader,
  DatasetQueryService,
  decodeEventCursor,
} from "../server/datasetRegistry/query";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const repo = new DbDatasetRegistry();
  const reader = new DbDatasetDataReader();
  const q = new DatasetQueryService(repo, reader);

  // 1. listDefinitions
  const defs = await q.listDefinitions();
  console.log(`[1] listDefinitions: ${defs.length} 个定义`);
  for (const d of defs) {
    console.log(`    - ${d.datasetCode} (id=${d.id}, ${d.status}, ${d.datasetType})`);
  }
  assert(defs.length >= 1, "应至少有一个 Dataset 定义");
  const target = defs.find((d) => d.datasetCode === "first_limit_pullback");
  assert(target, "应存在 first_limit_pullback 定义");

  // 2. getDefinition → versions
  const detail = await q.getDefinition(target.id!);
  assert(detail, "getDefinition 应命中");
  console.log(`[2] getDefinition(${target.datasetCode}) 版本:`, detail.versions.map((v) => `${v.version}(${v.status})`).join(", "));

  // 3. 最新版本（最高 id）统计
  const latest = detail.versions[detail.versions.length - 1];
  assert(latest, "应有版本");
  const stats = await q.getStatistics(latest.id);
  assert(stats, "getStatistics 应命中");
  console.log(`[3] getStatistics(${latest.version}) 实测:`, JSON.stringify(stats.actual, null, 2));
  assert(stats.actual.eventCount === 10240, `v2 eventCount 应为 10240，实际 ${stats.actual.eventCount}`);
  assert(stats.actual.pathCount === 206408, `v2 pathCount 应为 206408，实际 ${stats.actual.pathCount}`);
  assert(stats.actual.outcomeCount === 30720, `v2 outcomeCount 应为 30720，实际 ${stats.actual.outcomeCount}`);

  // 4. keyset 分页：event 两页无重叠、顺序正确
  const page1 = await q.listEvents({ datasetVersionId: latest.id, limit: 20 });
  console.log(`[4] listEvents page1: ${page1.items.length} 行, hasNext=${page1.nextCursor !== null}`);
  assert(page1.items.length === 20, "page1 应为 20 行");
  assert(page1.nextCursor !== null, "page1 应有 nextCursor");

  const cursor2 = decodeEventCursor(page1.nextCursor!);
  assert(cursor2, "nextCursor 应可解码");
  const page2 = await q.listEvents({ datasetVersionId: latest.id, limit: 20, cursor: cursor2 });
  console.log(`    listEvents page2: ${page2.items.length} 行, hasNext=${page2.nextCursor !== null}`);
  assert(page2.items.length === 20, "page2 应为 20 行");
  const page1Ids = new Set(page1.items.map((e) => e.eventId));
  const overlap = page2.items.filter((e) => page1Ids.has(e.eventId));
  assert(overlap.length === 0, `两页不应重叠，实际重叠 ${overlap.length} 条`);
  const last1 = page1.items[page1.items.length - 1]!;
  const first2 = page2.items[0]!;
  assert(
    last1.tradeDate < first2.tradeDate ||
      (last1.tradeDate === first2.tradeDate && last1.eventId < first2.eventId),
    "keyset 顺序应严格递增",
  );

  // 5. path / outcome 首屏
  const paths = await q.listPaths({ datasetVersionId: latest.id, limit: 20 });
  const outcomes = await q.listOutcomes({ datasetVersionId: latest.id, limit: 20 });
  console.log(`[5] listPaths page1: ${paths.items.length} 行 · listOutcomes page1: ${outcomes.items.length} 行`);
  assert(paths.items.length === 20 && outcomes.items.length === 20, "path/outcome 首屏各 20 行");

  // 6. jobs
  const jobs = await q.listJobs(latest.id);
  console.log(`[6] listJobs(${latest.version}): ${jobs.length} 个作业`, jobs.map((j) => `${j.jobId}(${j.status})`).join(", "));

  console.log("\n✅ 真实 API 验证全部通过（first_limit_pullback / v2）。");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ 验证失败:", e);
    process.exit(1);
  });
