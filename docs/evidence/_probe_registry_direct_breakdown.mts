/**
 * 定位直读桥耗时构成：事件分页 vs rd=0 行情批量读 vs 投影。
 * 只读。运行：项目根目录 `npx tsx docs/evidence/_probe_registry_direct_breakdown.mts`
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { DbDatasetDataReader } from '../../server/datasetRegistry/query';
import { mapWithConcurrency, defaultConcurrency } from '../../server/datasetRegistry/concurrency';
import type { FirstLimitPullbackEvent, FirstLimitPullbackRawBar } from '../../server/datasetRegistry/types';

const VERSION = 390002;

async function main(): Promise<void> {
  const reader = new DbDatasetDataReader();

  // --- 事件分页（当前 EVENT_PAGE_LIMIT=2000，串行）---
  for (const limit of [2000, 5000, 10000]) {
    const t0 = Date.now();
    const all: FirstLimitPullbackEvent[] = [];
    let cursor: { tradeDate: string; eventId: string } | null = null;
    let pages = 0;
    for (;;) {
      const page = await reader.listEventsPage({
        datasetVersionId: VERSION,
        ...(cursor !== null ? { cursor } : {}),
        limit,
      });
      pages += 1;
      all.push(...page.items);
      if (page.nextCursor === null || page.items.length === 0) break;
      const last = page.items[page.items.length - 1]!;
      cursor = { tradeDate: last.tradeDate, eventId: last.eventId };
    }
    console.log(`事件分页 limit=${limit}: ${Date.now() - t0}ms  pages=${pages}  events=${all.length}`);
  }

  // --- 取全量 eventIds 用于下一段 ---
  const events: FirstLimitPullbackEvent[] = [];
  let cursor: { tradeDate: string; eventId: string } | null = null;
  for (;;) {
    const page = await reader.listEventsPage({
      datasetVersionId: VERSION,
      ...(cursor !== null ? { cursor } : {}),
      limit: 5000,
    });
    events.push(...page.items);
    if (page.nextCursor === null || page.items.length === 0) break;
    const last = page.items[page.items.length - 1]!;
    cursor = { tradeDate: last.tradeDate, eventId: last.eventId };
  }
  const eventIds = events.map((e) => e.eventId);

  // --- rd=0 行情批读：batchSize × concurrency 网格 ---
  for (const batchSize of [400, 1000, 2000]) {
    for (const conc of [4, 8, 16]) {
      const batches: string[][] = [];
      for (let i = 0; i < eventIds.length; i += batchSize) batches.push(eventIds.slice(i, i + batchSize));
      const t0 = Date.now();
      const results = await mapWithConcurrency(
        batches,
        (batch) =>
          reader.loadRawBarsBatch('prefix', {
            datasetVersionId: VERSION,
            eventIds: batch,
            relativeDays: [0],
          }) as Promise<FirstLimitPullbackRawBar[]>,
        conc,
      );
      const n = results.reduce((s, r) => s + r.length, 0);
      console.log(
        `rd=0 批读 batch=${batchSize} conc=${conc}: ${Date.now() - t0}ms  batches=${batches.length}  bars=${n}`,
      );
    }
  }
  void defaultConcurrency;
}

main().catch((e) => {
  console.log('异常:', (e as Error).message, '\n', (e as Error).stack?.slice(0, 800));
  process.exitCode = 3;
});
