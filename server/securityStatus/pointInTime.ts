/**
 * STEP 7.5 — Point-in-Time 语义。
 *
 * 关键区分（禁止把 retrieved_at 当作 effective_date）：
 *   - effectiveFrom/effectiveTo 描述「状态在真实世界何时为真」。
 *   - retrievedAt 描述「我们何时把这条状态写入系统」。
 *   - availability 描述「这条状态最早何时可被观察到」。
 *
 * 无未来泄漏：as-of 查询只能使用「在 asOf 时点已可知」的状态。
 */

import { compareDate } from "../security/dates";
import { intervalContains } from "../security/identifierHistory";
import type { TradingCalendar } from "../security/tradingCalendar";
import type { SecurityStatusInterval } from "./types";

/** 区间在 date 是否生效（[effectiveFrom, effectiveTo] 闭区间，null=+∞）。 */
export function isEffectiveOn(interval: SecurityStatusInterval, date: string): boolean {
  return intervalContains(interval.effectiveFrom, interval.effectiveTo, date);
}

/**
 * 该状态的「可知日」（knowledge date）：最早在哪一天起，这条状态才可被观察到。
 *   - IMMEDIATE → effectiveFrom 当日。
 *   - T_PLUS_1  → effectiveFrom 次一交易日（必须提供 calendar；否则 fail-safe 返回 null）。
 *   - UNKNOWN   → 若有 retrievedAt，取其日期；否则 null（不可用于 as-of 推理）。
 *
 * 铁律：T+1 是「下一交易日」，绝不用 calendar date + 1（自然日）近似——周五的 T+1 是周一，
 * 不是周六。因此无交易日历时返回 null（不确定），禁止退回自然日算术。
 */
export function statusKnowledgeDate(interval: SecurityStatusInterval, calendar?: TradingCalendar): string | null {
  switch (interval.availability) {
    case "IMMEDIATE":
      return interval.effectiveFrom;
    case "T_PLUS_1":
      if (!calendar) return null; // fail-safe：无日历无法判定下一交易日
      return calendar.nextTradingDay(interval.effectiveFrom);
    case "UNKNOWN":
      if (interval.retrievedAt === null) return null;
      return interval.retrievedAt.slice(0, 10);
  }
}

/** 该状态在 asOf 时点是否已可知（无未来泄漏）。 */
export function isKnowableBy(interval: SecurityStatusInterval, asOf: string, calendar?: TradingCalendar): boolean {
  const knowledgeDate = statusKnowledgeDate(interval, calendar);
  if (knowledgeDate === null) return false; // UNKNOWN 且无 retrievedAt → 不可用于 as-of
  return compareDate(knowledgeDate, asOf) <= 0;
}
