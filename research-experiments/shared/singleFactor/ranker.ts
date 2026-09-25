/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Cross-sectional Ranker + TopN Selector**（通用基础之二）。
 *
 * ## 口径
 *
 * - **横截面 = 决策日**（决策日就是首板日 `T`：同一天可能有多个首板事件）；
 * - 每个决策日里，把**当日全部可排名样本**作为基准池（`pool`）；
 * - 按 `direction` 排序：`HIGH` = 因子值**降序**，`LOW` = 因子值**升序**；
 * - 名次 `rank` 从 1 开始，排序稳定（同值时按 `eventId` 升序，**确定性** ⇒ 可复现）；
 * - `TopN` = 取 `rank ≤ N` 的前 N 个；当日 `pool` 长度 < N 时**该日整天不纳入**该档
 *   （记 `daysExcludedSmall`）——不允许「不足 N 个就凑合」，
 *   那会让不同档位的日集不同却假装可比。
 */

import type { RankingDirection, SingleFactorSample, TopNSize } from "./types";

export interface RankedSample {
  sample: SingleFactorSample;
  /** 1 = 该方向下的第一名。 */
  rank: number;
}

export interface DayCrossSection {
  /** 决策日（= 首板日 T，YYYY-MM-DD）。 */
  date: string;
  year: number;
  /** 当日全部可排名样本（**基准池**：等权）。 */
  pool: readonly SingleFactorSample[];
  /** 按方向排序后的样本。 */
  ranked: readonly RankedSample[];
}

function compareByDirection(
  direction: RankingDirection
): (left: SingleFactorSample, right: SingleFactorSample) => number {
  return (left, right) => {
    if (left.factorValue !== right.factorValue) {
      return direction === "HIGH"
        ? right.factorValue - left.factorValue
        : left.factorValue - right.factorValue;
    }
    // 同名次必须可复现 ⇒ 同值一律按 eventId 升序，不依赖输入顺序。
    return left.eventId.localeCompare(right.eventId);
  };
}

/**
 * 按决策日切横截面并排名。
 *
 * 返回的 `Map` 按日期升序（`Map` 保持插入顺序 ⇒ 上游遍历即按时间推进）。
 */
export function buildCrossSections(
  samples: readonly SingleFactorSample[],
  direction: RankingDirection
): Map<string, DayCrossSection> {
  const grouped = new Map<string, SingleFactorSample[]>();
  for (const sample of samples) {
    const bucket = grouped.get(sample.eventDate);
    if (bucket === undefined) grouped.set(sample.eventDate, [sample]);
    else bucket.push(sample);
  }
  const compare = compareByDirection(direction);
  const sections = new Map<string, DayCrossSection>();
  for (const date of [...grouped.keys()].sort()) {
    const pool = grouped.get(date)!;
    const ordered = [...pool].sort(compare);
    sections.set(date, {
      date,
      year: Number(date.slice(0, 4)),
      pool,
      ranked: ordered.map((sample, index) => ({ sample, rank: index + 1 })),
    });
  }
  return sections;
}

export interface TopNSelection {
  /** 选中的样本（带名次），按名次升序。 */
  picks: readonly RankedSample[];
  /** 该日是否被纳入（`false` ⇒ 当日池不足 N）。 */
  included: boolean;
}

/** 取当日前 N 名。`pool.length < size` ⇒ 不纳入该日（不是「有几只算几只」）。 */
export function selectTopN(section: DayCrossSection, size: TopNSize): TopNSelection {
  if (section.ranked.length < size) return { picks: [], included: false };
  return { picks: section.ranked.slice(0, size), included: true };
}
