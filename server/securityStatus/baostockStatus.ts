/**
 * STEP 12 WORK C — BaoStock 逐股日线 → 历史交易状态区间（停牌 / ST）推断。
 *
 * 权威性铁律（provider-authoritative vs inferred 严格区分）：
 *   - `tradestatus`（1=交易 0=停牌）与 `isST`（1=ST 0=正常）是 BaoStock 日线
 *     `query_history_k_data_plus` 返回的【provider 权威字段】，不是本模块从缺口反推的。
 *   - 但把它们从「逐日观测」合并成「区间 effectiveFrom~effectiveTo」是【gap inference】：
 *     区间边界取自连续交易日序列的首/末日，停牌/ST 的真实起止（含非交易日的自然日边界、
 *     公告生效日）无法仅凭日线确定。因此：
 *       source      = "baostock-daily"（标明 provider，区别于 tushare-daily-infer 的缺口反推）
 *       confidence  = "medium"（逐日观测权威，但区间合并/边界存在推断成分）
 *       availability= "UNKNOWN"（日线是收盘后发布，精确公告时间未知，不擅自假设 T+1）
 *
 * 本模块是纯函数，不依赖 DB、不依赖身份解析；securityId 由调用方注入。
 */

import type { SecurityStatusInterval } from "./types";

/** BaoStock 逐股日线中用于状态推断的最小字段子集。 */
export interface BaostockDailyStatusPoint {
  /** 交易日（YYYY-MM-DD）。 */
  date: string;
  /** 1=交易 0=停牌（BaoStock 权威字段；null = 缺失，跳过）。 */
  tradestatus: number | null;
  /** 1=ST 0=正常（BaoStock 权威字段；null = 缺失，跳过）。 */
  isST: number | null;
}

/** 一个合并后的连续区间（闭区间）。 */
export interface MergedRun {
  from: string;
  to: string;
}

/**
 * 把满足 predicate 的连续日期段合并为区间。
 * 输入 points 按 date 升序（BaoStock 日线本身有序）；相邻行即相邻交易日。
 * predicate 为 true 的行构成一段 run；相邻 run 之间必然隔着一个 false 行。
 */
export function mergeConsecutiveRuns(
  points: readonly BaostockDailyStatusPoint[],
  predicate: (point: BaostockDailyStatusPoint) => boolean,
): MergedRun[] {
  const runs: MergedRun[] = [];
  let current: MergedRun | null = null;
  for (const point of points) {
    if (predicate(point)) {
      if (current === null) {
        current = { from: point.date, to: point.date };
        runs.push(current);
      } else {
        current.to = point.date;
      }
    } else {
      current = null;
    }
  }
  return runs;
}

/** 由合并区间构造 SUSPENSION/SUSPENDED 状态区间。 */
export function inferSuspensionIntervals(
  securityId: string,
  points: readonly BaostockDailyStatusPoint[],
  retrievedAt: string,
): SecurityStatusInterval[] {
  const runs = mergeConsecutiveRuns(points, (p) => p.tradestatus === 0);
  return runs.map((run) => ({
    securityId,
    statusType: "SUSPENSION",
    statusValue: "SUSPENDED",
    effectiveFrom: run.from,
    effectiveTo: run.to,
    source: "baostock-daily",
    retrievedAt,
    confidence: "medium",
    availability: "UNKNOWN",
  }));
}

/** 由合并区间构造 ST/ST 状态区间（isST 为二进制，无法区分 ST 与 *ST，统一记 ST）。 */
export function inferStIntervals(
  securityId: string,
  points: readonly BaostockDailyStatusPoint[],
  retrievedAt: string,
): SecurityStatusInterval[] {
  const runs = mergeConsecutiveRuns(points, (p) => p.isST === 1);
  return runs.map((run) => ({
    securityId,
    statusType: "ST",
    statusValue: "ST",
    effectiveFrom: run.from,
    effectiveTo: run.to,
    source: "baostock-daily",
    retrievedAt,
    confidence: "medium",
    availability: "UNKNOWN",
  }));
}

/** 一次推断停牌 + ST 两类区间（WORK C 合并回填的纯函数入口）。 */
export function inferBaostockStatusIntervals(
  securityId: string,
  points: readonly BaostockDailyStatusPoint[],
  retrievedAt: string,
): SecurityStatusInterval[] {
  return [
    ...inferSuspensionIntervals(securityId, points, retrievedAt),
    ...inferStIntervals(securityId, points, retrievedAt),
  ];
}
