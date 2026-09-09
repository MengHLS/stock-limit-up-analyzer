/**
 * STEP 12.6 — Research Dataset：universe_definition 纯函数（逐日可交易成员决议）。
 *
 * 语义（C-12.6.1，禁止越权发明新语义）：
 *   - 每一交易日复用 STEP 11 `resolveHistoricalUniverse`（canonical 默认拒绝语义：
 *     LISTING/TRADING 正向确认、SUSPENSION/DELISTING 负向阻断、ST 信息维度），
 *     PIT asOf 由请求决定（逐日 PIT：asOf = tradeDate；固定快照：asOf = 请求 asOf）；
 *   - 成员排序沿用 STEP 11 确定性排序（exchange → code → securityId）；
 *   - excludedByReason 按稳定 reason code 汇总（升序输出），供 data_snapshot/gate 审计。
 *
 * 纯函数、无 IO、确定性；DB 层一次性加载 securities/identifiers/statusIntervals 后传入。
 */

import { resolveHistoricalUniverse } from "../security/historicalUniverse";
import type { TradingCalendar } from "../security/tradingCalendar";
import type { Security } from "../security/types";
import type { SecurityIdentifier } from "../security/types";
import type { SecurityStatusInterval } from "../securityStatus/types";
import type {
  NormalizedResearchDatasetRequest,
  UniverseDayResult,
  UniverseDefinition,
} from "./types";

/** 请求 → asOf 决议：逐日 PIT 返回 null（每行用 tradeDate），否则返回固定 asOf。 */
export function resolveAsOfForRequest(request: NormalizedResearchDatasetRequest): string | null {
  return request.asOfPerTradeDate ? null : request.asOf;
}

function excludedCounts(rows: readonly { reason: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
}

/**
 * 对若干交易日逐日决议 universe。
 *
 * @param input 全市场 securities/identifiers/statusIntervals（DB 层已加载）。
 * @param calendar 交易日历（T+1 语义）。
 * @param tradeDates 目标交易日（升序；应为 calendar.tradingDaysBetween 的输出）。
 * @param request 规范化请求（决定 asOf 口径）。
 * @returns UniverseDefinition（days 按 tradeDate 升序）。
 */
export function resolveUniverseDefinition(
  input: {
    securities: readonly Security[];
    identifiers: readonly SecurityIdentifier[];
    statusIntervals: readonly SecurityStatusInterval[];
  },
  calendar: TradingCalendar,
  tradeDates: readonly string[],
  request: NormalizedResearchDatasetRequest,
): UniverseDefinition {
  const perDayAsOf = request.asOfPerTradeDate;
  const fixedAsOf = request.asOf;
  const days: UniverseDayResult[] = tradeDates.map((tradeDate) => {
    const asOf = perDayAsOf ? tradeDate : fixedAsOf;
    const result = resolveHistoricalUniverse(
      {
        securities: input.securities,
        identifiers: input.identifiers,
        statusIntervals: input.statusIntervals,
        calendar,
      },
      tradeDate,
      { asOf, includeExcluded: true },
    );
    const excluded = excludedCounts(result.excluded);
    const sortedReasonKeys = Object.keys(excluded).sort();
    const excludedByReason: Record<string, number> = {};
    for (const key of sortedReasonKeys) excludedByReason[key] = excluded[key]!;
    return {
      tradeDate,
      isTradingDay: result.isTradingDay ?? false,
      members: result.members.map((member) => member.securityId),
      excludedByReason,
    };
  });

  return {
    rule: "STEP 11 resolveHistoricalUniverse：LISTING/TRADING 正向确认，SUSPENSION/DELISTING 显式阻断，UNKNOWN 默认拒绝",
    asOfDescription: perDayAsOf
      ? `逐日 PIT（每交易日 asOf = 该日 tradeDate）`
      : `固定快照 asOf = ${fixedAsOf ?? "（未提供，非法请求）"}`,
    days,
  };
}
