/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Time-slice Analyzer**（通用基础之六）。
 *
 * ## 口径
 *
 * 时间片 = **决策日所在自然年**（决策日 = 首板日 `T`）。
 *
 * 每个切片上重算**同一套**指标与判据（把全期算法原封不动地施加到切片上），
 * 而不是「把全期结果按年份拆开相加」—— 后者对复利口径是错的。
 *
 * ⚠️ 年切片是**描述性**的：每个切片单独做 Bootstrap 判定 ⇒ 又一批多重比较，
 *    只用于看「这个因子是不是只在某几年有效」，不构成确认性证据。
 */

import {
  bootstrapOf,
  computeMetrics,
  verdictOf,
  type ComboMetricsResult,
} from "./metrics";
import type {
  SingleFactorMetrics,
  SingleFactorSample,
  SingleFactorTrade,
  SingleFactorVerdict,
} from "./types";

export interface TimeSliceInput {
  trades: readonly SingleFactorTrade[];
  grossDaily: readonly { eventDate: string; value: number }[];
  netDaily: readonly { eventDate: string; value: number }[];
  benchmarkDaily: readonly { eventDate: string; value: number }[];
  /** 每（组合 × 年份）一个确定性种子（由装配层按公式给出，见 resultWriter）。 */
  seedOf: (year: number) => number;
}

export interface TimeSliceResult {
  year: number;
  dayCount: number;
  tradeCount: number;
  metrics: SingleFactorMetrics;
  /** 该切片内配对日度超额的均值。 */
  excessMean: number | null;
  excessCi95Low: number | null;
  excessCi95High: number | null;
  excessVerdict: SingleFactorVerdict;
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * 逐笔的年份：优先用 `decisionDate`（= 首板日 `T`，与日度序列同一日历），
 * 缺省回落到 `signalDate`（= `T+5`，真正的决策时点）。两者只可能在**跨年边界**
 * （`T` 在年末、`T+5` 在次年初，6 年里个位数次）上不同年。
 */
function tradeYearOf(trade: SingleFactorTrade): number {
  return yearOf(trade.decisionDate ?? trade.signalDate);
}

function filterByYear<T extends { eventDate: string }>(
  rows: readonly T[],
  year: number
): readonly T[] {
  return rows.filter(row => yearOf(row.eventDate) === year);
}

/** 按决策日年份切时间片。 */
export function sliceByYear(input: TimeSliceInput): readonly TimeSliceResult[] {
  if (input.trades.length === 0) return [];
  const years = [
    ...new Set(input.trades.map(trade => tradeYearOf(trade))),
  ].sort((left, right) => left - right);

  const results: TimeSliceResult[] = [];
  for (const year of years) {
    const trades = input.trades.filter(trade => tradeYearOf(trade) === year);
    const grossDaily = filterByYear(input.grossDaily, year);
    const netDaily = filterByYear(input.netDaily, year);
    const benchmarkDaily = filterByYear(input.benchmarkDaily, year);
    if (netDaily.length === 0) continue;

    const computed: ComboMetricsResult = computeMetrics({
      trades,
      grossDaily,
      netDaily,
      benchmarkDaily,
    });
    const ci = bootstrapOf(computed.excessDaily, input.seedOf(year));
    const excessMean =
      computed.excessDaily.length === 0
        ? null
        : computed.excessDaily.reduce((sum, point) => sum + point.value, 0) /
          computed.excessDaily.length;

    results.push({
      year,
      dayCount: netDaily.length,
      tradeCount: trades.length,
      metrics: computed.metrics,
      excessMean,
      excessCi95Low: ci?.low ?? null,
      excessCi95High: ci?.high ?? null,
      excessVerdict: verdictOf({
        dayCount: computed.excessDaily.length,
        ciLow: ci?.low ?? null,
        ciHigh: ci?.high ?? null,
      }),
    });
  }
  return results;
}

/** 供装配层使用：把样本按决策日年份统计笔数（用于「该年有没有样本」的诊断）。 */
export function sampleCountByYear(
  samples: readonly SingleFactorSample[]
): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const sample of samples) {
    const year = yearOf(sample.eventDate);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return counts;
}
