/**
 * STEP 7.5 — 历史状态时间线解析 + 统一查询接口（纯函数核心）。
 *
 * getSecurityStatus(securityId, date) 的纯函数内核：
 *   - as-of 查询：某证券在历史某一天的真实状态。
 *   - point-in-time：可选 asOf 截止点，无未来泄漏。
 *   - 禁止用当前状态回填历史；无数据维度 = unknownDimensions（不默认填充）。
 */

import { compareDate } from "../security/dates";
import type { TradingCalendar } from "../security/tradingCalendar";
import { isEffectiveOn, isKnowableBy } from "./pointInTime";
import { STATUS_TYPES } from "./types";
import type {
  ConfidenceLevel,
  ResolvedStatusValue,
  SecurityStatusInterval,
  SecurityStatusSnapshot,
  StatusType,
} from "./types";

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 };

/**
 * 解析某证券在 date 的状态快照。
 * @param intervals 该证券相关的状态区间集（可含其它证券，内部按 securityId 过滤）。
 * @param securityId 永久身份（sec_<uuid>）。
 * @param date 生效日（YYYY-MM-DD）。
 * @param options.asOf point-in-time 截止点（YYYY-MM-DD）；null = 全知视角（不排除未来可知的状态）。
 * @param options.calendar 可选交易日历；T+1 可知日用「下一交易日」而非 calendar+1。
 */
export function resolveSecurityStatus(
  intervals: readonly SecurityStatusInterval[],
  securityId: string,
  date: string,
  options?: { asOf?: string | null; calendar?: TradingCalendar },
): SecurityStatusSnapshot {
  const asOf = options?.asOf ?? null;
  const calendar = options?.calendar;
  const resolved: Partial<Record<StatusType, ResolvedStatusValue>> = {};
  const unknownDimensions: StatusType[] = [];

  const byType = new Map<StatusType, SecurityStatusInterval[]>();
  for (const interval of intervals) {
    if (interval.securityId !== securityId) continue;
    if (!isEffectiveOn(interval, date)) continue;
    if (asOf !== null && !isKnowableBy(interval, asOf, calendar)) continue;
    const list = byType.get(interval.statusType);
    if (list) list.push(interval);
    else byType.set(interval.statusType, [interval]);
  }

  for (const statusType of STATUS_TYPES) {
    const candidates = byType.get(statusType);
    if (!candidates || candidates.length === 0) {
      unknownDimensions.push(statusType);
      continue;
    }
    resolved[statusType] = pickLatest(candidates);
  }

  return { securityId, date, asOf, resolved, unknownDimensions };
}

/** 在多个同时生效的区间中挑「最新且最可信」者（确定性排序）。 */
function pickLatest(candidates: readonly SecurityStatusInterval[]): ResolvedStatusValue {
  const sorted = [...candidates].sort((a, b) => {
    const byFrom = compareDate(b.effectiveFrom, a.effectiveFrom); // 越新越靠前
    if (byFrom !== 0) return byFrom;
    const byConf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (byConf !== 0) return byConf;
    const aRetrieved = a.retrievedAt ?? "";
    const bRetrieved = b.retrievedAt ?? "";
    if (aRetrieved !== bRetrieved) return bRetrieved < aRetrieved ? -1 : 1;
    return a.source.localeCompare(b.source);
  });
  const top = sorted[0]!;
  return {
    statusType: top.statusType,
    statusValue: top.statusValue,
    effectiveFrom: top.effectiveFrom,
    effectiveTo: top.effectiveTo,
    source: top.source,
    confidence: top.confidence,
  };
}

/**
 * 判定可交易：仅当 TRADING 维度明确解析为 "TRADING"，且未被停牌、未退市/未上市。
 * 关键约束：UNKNOWN（或 TRADING 维度缺失）【不得】默认回退为 TRADING → 返回 false。
 */
export function isTradableFromSnapshot(snapshot: SecurityStatusSnapshot): boolean {
  const trading = snapshot.resolved.TRADING;
  if (trading === undefined || trading.statusValue !== "TRADING") return false;

  const listing = snapshot.resolved.LISTING;
  if (listing !== undefined && listing.statusValue !== "LISTED") return false;

  const suspension = snapshot.resolved.SUSPENSION;
  if (suspension !== undefined && suspension.statusValue === "SUSPENDED") return false;

  return true;
}

/** 便捷纯函数：给定区间集，判定某证券在 date 是否可交易。 */
export function isTradableFromIntervals(
  intervals: readonly SecurityStatusInterval[],
  securityId: string,
  date: string,
  options?: { asOf?: string | null; calendar?: TradingCalendar },
): boolean {
  return isTradableFromSnapshot(resolveSecurityStatus(intervals, securityId, date, options));
}
