/**
 * STEP DATASET-002.2 — 真实 TiDB 只读验证脚本（非 mock，只读）。
 *
 * 走真实代码路径：buildDatasetRegistryRouter(DbDatasetRegistry, DbDatasetDataReader)
 * 对 first_limit_pullback 的 READY 版本（v2, id=90001）做：
 *   - Definition / Version / Statistics（经 tRPC caller，证明 router + zod + DB 全链路）
 *   - Event / Outcome 全量 keyset walk（对照 aggregate COUNT，证分页连续、无重复、严格有序）
 *   - Path 抽样 3 页（证连续性 + 有序，总数对照 aggregate）
 *
 * 用法：npx tsx scripts/verifyDataset0022.mts
 */

import "dotenv/config";
import { DbDatasetRegistry } from "../server/datasetRegistry/db";
import {
  DbDatasetDataReader,
  comparePathKeys,
  decodeEventCursor,
  decodeOutcomeCursor,
  decodePathCursor,
} from "../server/datasetRegistry/query";
import { buildDatasetRegistryRouter } from "../server/datasetRegistry/router";
import { getDb } from "../server/db";

const tConnect = Date.now();
const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}
console.log(`[verify] DB 连接就绪，耗时 ${Date.now() - tConnect}ms`);

const repo = new DbDatasetRegistry();
const reader = new DbDatasetDataReader();
const router = buildDatasetRegistryRouter({ repo, reader });
const caller = router.createCaller({ req: {} as never, res: {} as never, user: null });

const report: Record<string, unknown> = {};

// 1. Definition（经 tRPC）
const t0 = Date.now();
const definitions = await caller.listDefinitions();
const def = definitions.find((d) => d.datasetCode === "first_limit_pullback");
report.definition = {
  elapsedMs: Date.now() - t0,
  count: definitions.length,
  first_limit_pullback: def
    ? { id: def.id, name: def.name, type: def.datasetType, status: def.status, eventTable: def.eventTableName, pathTable: def.pathTableName, outcomeTable: def.outcomeTableName }
    : null,
};
if (!def) {
  console.error("未找到 first_limit_pullback 定义");
  process.exit(1);
}

// 2. Version（经 tRPC）
const versions = await caller.listVersions({ datasetId: def.id });
const v2 = versions.find((v) => v.version === "v2") ?? versions.find((v) => v.status === "READY") ?? versions[0];
report.versions = versions.map((v) => ({ id: v.id, version: v.version, status: v.status, totalEvents: v.totalEvents, totalRows: v.totalRows, range: [v.startDate, v.endDate] }));
if (!v2) {
  console.error("未找到可验证的版本");
  process.exit(1);
}

// 3. Statistics（经 tRPC，COUNT/MIN/MAX/GROUP BY 聚合）
const t1 = Date.now();
const stats = await caller.getStatistics({ datasetVersionId: v2.id });
report.statistics = { elapsedMs: Date.now() - t1, ...stats };

// ---- 全量 walk（经 reader，绕开 tRPC 序列化开销，语义与 router 完全一致）----
async function walkEvents(limit: number) {
  const collected: Array<{ tradeDate: string; eventId: string }> = [];
  let cursor: { tradeDate: string; eventId: string } | null = null;
  let pages = 0;
  const started = Date.now();
  for (;;) {
    const page = await reader.listEventsPage({ datasetVersionId: v2!.id!, limit, cursor });
    pages += 1;
    for (const e of page.items) collected.push({ tradeDate: e.tradeDate, eventId: e.eventId });
    if (page.nextCursor === null) break;
    cursor = decodeEventCursor(page.nextCursor);
    if (pages > 1000) throw new Error("event 分页未收敛");
  }
  return { collected, pages, elapsedMs: Date.now() - started };
}

async function walkOutcomes(limit: number) {
  const collected: Array<{ eventId: string; horizon: number }> = [];
  let cursor: { eventId: string; horizon: number } | null = null;
  let pages = 0;
  const started = Date.now();
  for (;;) {
    const page = await reader.listOutcomesPage({ datasetVersionId: v2!.id!, limit, cursor });
    pages += 1;
    for (const o of page.items) collected.push({ eventId: o.eventId, horizon: o.horizon });
    if (page.nextCursor === null) break;
    cursor = decodeOutcomeCursor(page.nextCursor);
    if (pages > 1000) throw new Error("outcome 分页未收敛");
  }
  return { collected, pages, elapsedMs: Date.now() - started };
}

// 复用 query.ts 的解码（避免脚本内重复实现）

// 4. Event 全量 walk
console.log("[verify] 开始 Event 全量 walk...");
const ev = await walkEvents(200);
const evIds = ev.collected.map((e) => e.eventId);
const evUnique = new Set(evIds);
const evOrdered = ev.collected.every((e, i) => i === 0 || ev.collected[i - 1]!.tradeDate < e.tradeDate || (ev.collected[i - 1]!.tradeDate === e.tradeDate && ev.collected[i - 1]!.eventId < e.eventId));
report.events = {
  pages: ev.pages,
  collected: ev.collected.length,
  aggregate: stats.actual.eventCount,
  match: ev.collected.length === stats.actual.eventCount,
  unique: evUnique.size === evIds.length,
  ordered: evOrdered,
  elapsedMs: ev.elapsedMs,
  first: ev.collected[0] ?? null,
  last: ev.collected[ev.collected.length - 1] ?? null,
};
console.log(`[verify] Event walk 完成：${ev.pages} 页 / ${ev.collected.length} 条 / ${ev.elapsedMs}ms，match=${ev.collected.length === stats.actual.eventCount}`);

// 5. Outcome 全量 walk
console.log("[verify] 开始 Outcome 全量 walk...");
const oc = await walkOutcomes(200);
const ocKeys = oc.collected.map((o) => `${o.eventId}#${o.horizon}`);
const ocUnique = new Set(ocKeys);
const ocOrdered = oc.collected.every((o, i) => i === 0 || oc.collected[i - 1]!.eventId < o.eventId || (oc.collected[i - 1]!.eventId === o.eventId && oc.collected[i - 1]!.horizon < o.horizon));
report.outcomes = {
  pages: oc.pages,
  collected: oc.collected.length,
  aggregate: stats.actual.outcomeCount,
  match: oc.collected.length === stats.actual.outcomeCount,
  unique: ocUnique.size === ocKeys.length,
  ordered: ocOrdered,
  elapsedMs: oc.elapsedMs,
  first: oc.collected[0] ?? null,
  last: oc.collected[oc.collected.length - 1] ?? null,
};
console.log(`[verify] Outcome walk 完成：${oc.pages} 页 / ${oc.collected.length} 条 / ${oc.elapsedMs}ms，match=${oc.collected.length === stats.actual.outcomeCount}`);

// 6. Path 抽样 3 页（证连续 + 有序，总数对照 aggregate）
console.log("[verify] 开始 Path 抽样 3 页...");
const pathStarted = Date.now();
let pathCursor: { eventId: string; relativeDay: number } | null = null;
const pathTuples: Array<{ eventId: string; relativeDay: number }> = [];
for (let i = 0; i < 3; i += 1) {
  const page = await reader.listPathsPage({ datasetVersionId: v2!.id!, limit: 200, cursor: pathCursor });
  for (const p of page.items) pathTuples.push({ eventId: p.eventId, relativeDay: p.relativeDay });
  if (page.nextCursor === null) break;
  pathCursor = decodePathCursor(page.nextCursor);
}
const pathOrdered = pathTuples.every((k, i) => i === 0 || comparePathKeys(pathTuples[i - 1]!, k) < 0);
const pathKeyOf = (t: { eventId: string; relativeDay: number }) => `${t.eventId}#${t.relativeDay}`;
report.paths = {
  sampledPages: 3,
  sampledRows: pathTuples.length,
  aggregate: stats.actual.pathCount,
  sampledUnique: new Set(pathTuples.map(pathKeyOf)).size === pathTuples.length,
  ordered: pathOrdered,
  elapsedMs: Date.now() - pathStarted,
  firstKey: pathTuples[0] ? pathKeyOf(pathTuples[0]) : null,
  lastKey: pathTuples[pathTuples.length - 1] ? pathKeyOf(pathTuples[pathTuples.length - 1]) : null,
};
console.log(`[verify] Path 抽样完成：${pathTuples.length} 条 / ${Date.now() - pathStarted}ms，aggregate=${stats.actual.pathCount}`);

report.totalElapsedMs = Date.now() - tConnect;
console.log("\n=== VERIFY RESULT (JSON) ===");
console.log(JSON.stringify(report, null, 2));
