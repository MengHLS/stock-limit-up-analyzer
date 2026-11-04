/**
 * POOL-ST-001 — 池化读取侧的 PIT ST 索引（**唯一实现**）。
 *
 * 背景：建库阶段的 `excludeSt` 只能排除「事件日当天是 ST」的事件；池期内转 ST 的成员此前
 * 无人处理（池化行的 `st` 恒为 `"UNKNOWN"`）。本模块把 `research_security_status_history`
 * 里的 ST 区间一次性载入内存（小表，万行级），供读取侧做：
 *   - 事件日 PIT 排除（口径与 v5 的 `excludeSt: true` 完全一致）；
 *   - 池期逐日 PIT 判定（转 ST 当日移池）。
 *
 * 纪律：**缺区间 = 非 ST**（与 `filter.ts#isStExcluded` 同口径：只有 ST/*ST 才排除）；
 * DB 不可用 ⇒ 抛错（绝不静默降级成"没有 ST 数据"那会把口径偷偷放宽）。
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { researchSecurityStatusHistory } from "../../drizzle/schema";
import type { PooledStStatus } from "./pooledDatasetCursor";

interface StInterval {
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: "ST" | "*ST";
}

export interface PoolStIndex {
  /** 载入的 ST 区间条数（审计用）。 */
  readonly intervalCount: number;
  /** PIT 判定：该证券在该交易日是否 ST/*ST，以及具体取值。 */
  resolve(securityId: string, tradeDate: string): PooledStStatus;
}

function normalizeStatusValue(value: string): "ST" | "*ST" | null {
  if (value === "ST") return "ST";
  if (value === "*ST") return "*ST";
  return null;
}

function toDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/** 区间行（DB 行或测试夹具的通用形态）。 */
export interface PoolStIntervalRow {
  readonly securityId: string;
  readonly statusValue: string;
  readonly effectiveFrom: string | Date;
  readonly effectiveTo: string | Date | null;
}

/** 由区间行构造索引（纯函数，供 DB 载入与单测共用同一实现）。 */
export function createPoolStIndexFromRows(rows: readonly PoolStIntervalRow[]): PoolStIndex {
  const bySecurity = new Map<string, StInterval[]>();
  let intervalCount = 0;
  for (const row of rows) {
    const status = normalizeStatusValue(row.statusValue);
    if (status === null) continue;
    const effectiveFrom = toDateOnly(row.effectiveFrom) ?? "";
    if (effectiveFrom === "") continue;
    intervalCount += 1;
    const interval: StInterval = { effectiveFrom, effectiveTo: toDateOnly(row.effectiveTo), status };
    const list = bySecurity.get(row.securityId);
    if (list === undefined) bySecurity.set(row.securityId, [interval]);
    else list.push(interval);
  }
  return {
    intervalCount,
    resolve(securityId: string, tradeDate: string): PooledStStatus {
      const intervals = bySecurity.get(securityId);
      if (intervals === undefined) return "NORMAL";
      for (const interval of intervals) {
        if (tradeDate < interval.effectiveFrom) continue;
        if (interval.effectiveTo !== null && tradeDate > interval.effectiveTo) continue;
        return interval.status;
      }
      return "NORMAL";
    },
  };
}

let cached: Promise<PoolStIndex> | null = null;

/** 载入（并进程内缓存）ST 区间索引。 */
export function loadPoolStIndex(): Promise<PoolStIndex> {
  cached ??= (async (): Promise<PoolStIndex> => {
    const db = await getDb();
    if (!db) {
      throw new Error("池化 ST 排除：数据库不可用，无法载入 PIT ST 区间（拒绝静默放宽口径）。");
    }
    const rows = await db
      .select({
        securityId: researchSecurityStatusHistory.securityId,
        statusValue: researchSecurityStatusHistory.statusValue,
        effectiveFrom: researchSecurityStatusHistory.effectiveFrom,
        effectiveTo: researchSecurityStatusHistory.effectiveTo,
      })
      .from(researchSecurityStatusHistory)
      .where(eq(researchSecurityStatusHistory.statusType, "ST"));

    return createPoolStIndexFromRows(rows);
  })();
  return cached;
}

/** 仅供测试：清空进程内缓存。 */
export function resetPoolStIndexCacheForTest(): void {
  cached = null;
}
