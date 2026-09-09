/**
 * STEP 12 WORK F — Index Master / Index Daily 持久化（integration 层）。
 *
 * 职责：把 provider-neutral 的 IndexMasterEntry / IndexDailyBar 幂等写入
 * index_master / index_daily 表（ON DUPLICATE KEY UPDATE）。
 *
 * 唯一约束（drizzle/schema.ts）：
 *   - index_master: uq_index_master_code_provider (indexCode, provider)
 *   - index_daily:  uq_index_daily_code_date     (indexCode, tradeDate)
 *
 * 本层需要真实 DB；upsert 函数在无库环境下静默返回 0（ENVIRONMENTAL 降级），
 * 纯函数（转换 / 幂等键 / 日期范围推导）不依赖 DB，可独立单测。
 */

import { sql } from "drizzle-orm";
import {
  indexDaily,
  indexMaster,
  type InsertIndexDaily,
  type InsertIndexMaster,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { IndexDailyBar, IndexMasterEntry } from "./types";

/** 幂等键（与 uq_index_daily_code_date 对齐）。纯函数。 */
export function indexDailyIdempotencyKey(indexCode: string, tradeDate: string): string {
  return `${indexCode}|${tradeDate}`;
}

/** 幂等键（与 uq_index_master_code_provider 对齐）。纯函数。 */
export function indexMasterIdempotencyKey(indexCode: string, provider: string): string {
  return `${indexCode}|${provider}`;
}

/** 纯函数：IndexDailyBar → InsertIndexDaily（canonical → DB 行，单位不变）。 */
export function indexDailyBarToInsert(bar: IndexDailyBar): InsertIndexDaily {
  return {
    indexCode: bar.indexCode,
    tradeDate: bar.tradeDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    amount: bar.amount,
    volume: bar.volume,
    source: bar.source,
  };
}

/** 纯函数：从日线 bars 推导数据首日 / 末日（升序取 min/max）。空序列返回 null。 */
export function deriveIndexDateRange(
  bars: readonly Pick<IndexDailyBar, "tradeDate">[],
): { firstDate: string | null; lastDate: string | null } {
  if (bars.length === 0) return { firstDate: null, lastDate: null };
  const dates = bars.map((bar) => bar.tradeDate).sort();
  return { firstDate: dates[0]!, lastDate: dates[dates.length - 1]! };
}

/** 纯函数：IndexMasterEntry → InsertIndexMaster（retrievedAt ISO string → Date）。 */
export function indexMasterEntryToInsert(entry: IndexMasterEntry): InsertIndexMaster {
  return {
    indexCode: entry.indexCode,
    indexName: entry.indexName,
    provider: entry.provider,
    providerCode: entry.providerCode,
    firstDate: entry.firstDate,
    lastDate: entry.lastDate,
    source: entry.source,
    retrievedAt: new Date(entry.retrievedAt),
  };
}

/** 纯函数：从日线 bars + 参考信息构建完整 IndexMasterEntry（firstDate/lastDate 由 bars 推导）。 */
export function buildIndexMasterEntry(params: {
  indexCode: string;
  indexName: string;
  provider: string;
  providerCode: string;
  bars: readonly Pick<IndexDailyBar, "tradeDate">[];
  source: string;
  retrievedAt?: string;
}): IndexMasterEntry {
  const { firstDate, lastDate } = deriveIndexDateRange(params.bars);
  return {
    indexCode: params.indexCode,
    indexName: params.indexName,
    provider: params.provider,
    providerCode: params.providerCode,
    firstDate,
    lastDate,
    source: params.source,
    retrievedAt: params.retrievedAt ?? new Date().toISOString(),
  };
}

/** 幂等写入指数主数据（同 indexCode+provider 覆盖更新）。 */
export async function upsertIndexMaster(entries: IndexMasterEntry[]): Promise<number> {
  const db = await getDb();
  if (!db || entries.length === 0) return 0;
  const BATCH_SIZE = 200;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE).map(indexMasterEntryToInsert);
    await db.insert(indexMaster).values(batch).onDuplicateKeyUpdate({
      set: {
        indexName: sql`VALUES(\`indexName\`)`,
        providerCode: sql`VALUES(\`providerCode\`)`,
        firstDate: sql`VALUES(\`firstDate\`)`,
        lastDate: sql`VALUES(\`lastDate\`)`,
        source: sql`VALUES(\`source\`)`,
        retrievedAt: sql`VALUES(\`retrievedAt\`)`,
      },
    });
  }
  return entries.length;
}

/** 幂等写入指数日线（同 indexCode+tradeDate 覆盖更新）。 */
export async function upsertIndexDaily(bars: IndexDailyBar[]): Promise<number> {
  const db = await getDb();
  if (!db || bars.length === 0) return 0;
  const BATCH_SIZE = 500;
  for (let i = 0; i < bars.length; i += BATCH_SIZE) {
    const batch = bars.slice(i, i + BATCH_SIZE).map(indexDailyBarToInsert);
    await db.insert(indexDaily).values(batch).onDuplicateKeyUpdate({
      set: {
        open: sql`VALUES(\`open\`)`,
        high: sql`VALUES(\`high\`)`,
        low: sql`VALUES(\`low\`)`,
        close: sql`VALUES(\`close\`)`,
        amount: sql`VALUES(\`amount\`)`,
        volume: sql`VALUES(\`volume\`)`,
        source: sql`VALUES(\`source\`)`,
      },
    });
  }
  return bars.length;
}

/** 查询某指数在 index_daily 中的已有覆盖（供 resume 判断，无库返回空）。 */
export async function getIndexDailyCoverage(
  indexCode: string,
): Promise<{ rowCount: number; firstDate: string | null; lastDate: string | null }> {
  const db = await getDb();
  if (!db) return { rowCount: 0, firstDate: null, lastDate: null };
  const rows = await db
    .select({
      rowCount: sql<number>`COUNT(*)`,
      firstDate: sql<string | null>`MIN(${indexDaily.tradeDate})`,
      lastDate: sql<string | null>`MAX(${indexDaily.tradeDate})`,
    })
    .from(indexDaily)
    .where(sql`${indexDaily.indexCode} = ${indexCode}`);
  const row = rows[0];
  return {
    rowCount: Number(row?.rowCount ?? 0),
    firstDate: row?.firstDate ?? null,
    lastDate: row?.lastDate ?? null,
  };
}
