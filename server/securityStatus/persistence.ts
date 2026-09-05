/**
 * STEP 7.5 — 状态历史持久化 + 统一 DB 查询接口。
 *
 * getSecurityStatus(securityId, date) / isTradable(securityId, date) 的 DB 版：
 * 从 research_security_status_history 读取区间，交给纯函数内核解析。
 * DB 不可用或表未迁移时返回「全未知」快照（isTradable=false），不抛错、不伪造。
 */

import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../db";
import { researchSecurityStatusHistory } from "../../drizzle/schema";
import { resolveSecurityStatus, isTradableFromSnapshot } from "./timeline";
import type { SecurityStatusInterval, SecurityStatusSnapshot } from "./types";

type StatusRow = typeof researchSecurityStatusHistory.$inferSelect;

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function rowToInterval(row: StatusRow): SecurityStatusInterval {
  return {
    securityId: row.securityId,
    statusType: row.statusType,
    statusValue: row.statusValue,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    source: row.source,
    retrievedAt: toIso(row.retrievedAt),
    confidence: row.confidence,
    availability: row.availability,
  };
}

/** 写入一批状态区间（幂等不保证；重复区间由上层去重）。返回写入行数。 */
export async function upsertSecurityStatusIntervals(
  intervals: readonly SecurityStatusInterval[],
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  if (intervals.length === 0) return 0;
  const rows = intervals.map((interval) => ({
    securityId: interval.securityId,
    statusType: interval.statusType,
    statusValue: interval.statusValue,
    effectiveFrom: interval.effectiveFrom,
    effectiveTo: interval.effectiveTo,
    source: interval.source,
    retrievedAt: interval.retrievedAt === null ? null : new Date(interval.retrievedAt),
    confidence: interval.confidence,
    availability: interval.availability,
  }));
  const result = await db.insert(researchSecurityStatusHistory).values(rows);
  return Number(result[0].affectedRows);
}

/** 读取某证券的全部状态区间（升序）。 */
export async function getSecurityStatusIntervals(securityId: string): Promise<SecurityStatusInterval[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(researchSecurityStatusHistory)
    .where(eq(researchSecurityStatusHistory.securityId, securityId))
    .orderBy(
      researchSecurityStatusHistory.statusType,
      researchSecurityStatusHistory.effectiveFrom,
    );
  return rows.map(rowToInterval);
}

/** 统一接口：某证券在 date 的历史状态快照（point-in-time）。 */
export async function getSecurityStatus(
  securityId: string,
  date: string,
  options?: { asOf?: string | null },
): Promise<SecurityStatusSnapshot> {
  const intervals = await getSecurityStatusIntervals(securityId);
  return resolveSecurityStatus(intervals, securityId, date, options);
}

/** 统一接口：某证券在 date 是否可交易（UNKNOWN 不默认 TRADING → false）。 */
export async function isTradable(
  securityId: string,
  date: string,
  options?: { asOf?: string | null },
): Promise<boolean> {
  const snapshot = await getSecurityStatus(securityId, date, options);
  return isTradableFromSnapshot(snapshot);
}

/** 只读区间过滤：供未来 as-of 高效查询复用（DB 侧先按 securityId 收窄）。 */
export async function getSecurityStatusIntervalsInRange(
  securityId: string,
  from: string,
  to: string,
): Promise<SecurityStatusInterval[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(researchSecurityStatusHistory)
    .where(
      and(
        eq(researchSecurityStatusHistory.securityId, securityId),
        lte(researchSecurityStatusHistory.effectiveFrom, to),
        or(isNull(researchSecurityStatusHistory.effectiveTo), gte(researchSecurityStatusHistory.effectiveTo, from)),
      ),
    );
  return rows.map(rowToInterval);
}
