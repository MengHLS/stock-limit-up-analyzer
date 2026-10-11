/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` —— 指标与统计（规格 §5.2 / §5.3）。
 *
 * ## 纪律
 *
 * - 区间估计**一律**走 `../dateClusterBootstrap.ts` 的日期移动块原语
 *   （block 20 主 / block 40 敏感性 / 1000 次 / 固定种子）；
 *   **禁用 `sd/√n`**（`RESULT-EVENT-OVERLAP-CLUSTER-001` §8：同日依赖主导）。
 * - 两条**预声明主臂**用 Bonferroni 同时区间 ⇒ 每臂 **97.5% 双侧 CI**（`0.0125/0.9875`）。
 * - 差值必须**独立重采样**（不能由两条边际 CI 相减）。
 * - 尾识别力与经济代价**分别**读数（`rightTailMetrics.ts` 的口径）。
 */

import {
  movingBlockBootstrapMean,
  type BootstrapQuantiles,
  type DateClusterValue,
} from "../dateClusterBootstrap";
import {
  BOOTSTRAP_BLOCK_PRIMARY,
  BOOTSTRAP_BLOCK_SENSITIVITY,
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  CI_QUANTILES,
  CI_QUANTILES_95,
  LOSS_THRESHOLD,
  MIN_UNIQUE_OPPORTUNITY_SEGMENTS,
  PRIMARY_TAIL_THRESHOLD,
  TAIL_THRESHOLDS,
  type ArmId,
  type DailyArmStat,
  type ResearchVerdict,
} from "./types";

// ---------------------------------------------------------------------------
// 一、基础统计量（与既有实现同口径：`metrics.ts#quantileOf/medianOf`）
// ---------------------------------------------------------------------------

export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** 线性插值分位数（与 `dateClusterBootstrap.ts#quantile` 同式）。 */
export function quantileOf(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function medianOf(values: readonly number[]): number | null {
  return quantileOf(values, 0.5);
}

function rateOf(values: readonly number[], threshold: number): number | null {
  if (values.length === 0) return null;
  let hits = 0;
  for (const value of values) if (value >= threshold) hits += 1;
  return hits / values.length;
}

function lossRateOf(values: readonly number[], threshold: number): number | null {
  if (values.length === 0) return null;
  let hits = 0;
  for (const value of values) if (value <= threshold) hits += 1;
  return hits / values.length;
}

// ---------------------------------------------------------------------------
// 二、逐日臂统计
// ---------------------------------------------------------------------------

/** 一天中一条信号的可用读数。 */
export interface DaySignalReadout {
  /** 决策槽位效用（`NO_FILL` 记 0）；右删失为 `null`（**不当作 0**）。 */
  readonly slotNet20: number | null;
  readonly slotNet50: number | null;
  /** 可成交子集净收益（`NO_FILL` / 右删失剔除）。 */
  readonly fillNet20: number | null;
  readonly fillNet50: number | null;
  /** 标签 B（路径最高价）。 */
  readonly pathMax: number | null;
  readonly noFill: boolean;
}

export function summarizeDay(args: {
  readonly date: string;
  readonly poolSize: number;
  readonly signals: readonly DaySignalReadout[];
}): DailyArmStat {
  const slot20 = args.signals
    .map((item) => item.slotNet20)
    .filter((value): value is number => value !== null);
  const path = args.signals
    .map((item) => item.pathMax)
    .filter((value): value is number => value !== null);
  const slot50 = args.signals
    .map((item) => item.slotNet50)
    .filter((value): value is number => value !== null);
  const noFillCount = args.signals.filter((item) => item.noFill).length;
  const wins = slot20.filter((value) => value > 0).length;
  return {
    date: args.date,
    year: Number(args.date.slice(0, 4)),
    poolSize: args.poolSize,
    signalCount: args.signals.length,
    meanNetReturn: meanOf(slot20),
    meanNetReturn50: meanOf(slot50),
    medianNetReturn: medianOf(slot20),
    winRate: slot20.length === 0 ? null : wins / slot20.length,
    loss10Rate: lossRateOf(slot20, LOSS_THRESHOLD),
    q05: quantileOf(slot20, 0.05),
    tail20Rate: rateOf(slot20, TAIL_THRESHOLDS[0]),
    tail50Rate: rateOf(slot20, TAIL_THRESHOLDS[1]),
    tail100Rate: rateOf(slot20, TAIL_THRESHOLDS[2]),
    tail20Rate50: rateOf(slot50, TAIL_THRESHOLDS[0]),
    pathTail20Rate: rateOf(path, PRIMARY_TAIL_THRESHOLD),
    noFillRate: args.signals.length === 0 ? null : noFillCount / args.signals.length,
  };
}

/** 把若干次随机抽样的当日统计**逐字段取平均**（200 次抽样只为压低 Monte-Carlo 噪声）。 */
export function averageDayStats(args: {
  readonly date: string;
  readonly poolSize: number;
  readonly draws: readonly DailyArmStat[];
}): DailyArmStat {
  const average = (
    pick: (stat: DailyArmStat) => number | null,
  ): number | null => {
    const values = args.draws
      .map(pick)
      .filter((value): value is number => value !== null);
    return meanOf(values);
  };
  const first = args.draws[0];
  return {
    date: args.date,
    year: Number(args.date.slice(0, 4)),
    poolSize: args.poolSize,
    signalCount: first === undefined ? 0 : average((stat) => stat.signalCount) ?? 0,
    meanNetReturn: average((stat) => stat.meanNetReturn),
    meanNetReturn50: average((stat) => stat.meanNetReturn50),
    medianNetReturn: average((stat) => stat.medianNetReturn),
    winRate: average((stat) => stat.winRate),
    loss10Rate: average((stat) => stat.loss10Rate),
    q05: average((stat) => stat.q05),
    tail20Rate: average((stat) => stat.tail20Rate),
    tail50Rate: average((stat) => stat.tail50Rate),
    tail100Rate: average((stat) => stat.tail100Rate),
    tail20Rate50: average((stat) => stat.tail20Rate50),
    pathTail20Rate: average((stat) => stat.pathTail20Rate),
    noFillRate: average((stat) => stat.noFillRate),
  };
}

// ---------------------------------------------------------------------------
// 三、配对差与区间
// ---------------------------------------------------------------------------

export type PairedField =
  | "meanNetReturn"
  | "meanNetReturn50"
  | "medianNetReturn"
  | "winRate"
  | "loss10Rate"
  | "q05"
  | "tail20Rate"
  | "tail20Rate50"
  | "tail50Rate"
  | "tail100Rate"
  | "pathTail20Rate"
  | "noFillRate";

/** 逐日配对差（`臂 − Random`），日期即聚类单位。 */
export function pairedSeries(args: {
  readonly armDays: readonly DailyArmStat[];
  readonly randomDays: readonly DailyArmStat[];
  readonly field: PairedField;
}): readonly DateClusterValue[] {
  const randomByDate = new Map(args.randomDays.map((day) => [day.date, day]));
  const out: DateClusterValue[] = [];
  for (const armDay of args.armDays) {
    const randomDay = randomByDate.get(armDay.date);
    if (randomDay === undefined) continue;
    const left = armDay[args.field];
    const right = randomDay[args.field];
    if (left === null || right === null) continue;
    if (armDay.signalCount === 0) continue;
    out.push({ eventDate: armDay.date, value: left - right });
  }
  return out;
}

export interface DifferenceInterval {
  readonly pointEstimate: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly dayCount: number;
  readonly iterations: number | null;
  readonly blockLength: number | null;
  readonly clusterCount: number | null;
}

/**
 * 配对差的区间：**逐日先配对求差，再对日序列做日期移动块 bootstrap**。
 *
 * 🔴 为什么是单样本 bootstrap 而不是 `movingBlockBootstrapDifference`：
 *    这里比较的是**同一聚类结构下的配对差**（同一天、同一可评估池、同人数），
 *    正确做法就是「先配对成一条日序列，再对它重采样」——
 *    这正是 `rightTailMetrics.ts#summarizeAgainstRandomTopK` 的既有口径。
 *    两条边际 CI 相减是错的；而把差值序列喂给 `movingBlockBootstrapMean` 即可，
 *    **不复制第二套统计实现**。
 */
export function pairedDifferenceInterval(args: {
  readonly armDays: readonly DailyArmStat[];
  readonly randomDays: readonly DailyArmStat[];
  readonly field: PairedField;
  readonly blockLength: number;
  readonly quantiles?: BootstrapQuantiles;
}): DifferenceInterval {
  const series = pairedSeries(args);
  const pointEstimate = meanOf(series.map((item) => item.value));
  const result = movingBlockBootstrapMean({
    samples: series,
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: args.blockLength,
    seed: BOOTSTRAP_SEED,
    quantiles: args.quantiles ?? CI_QUANTILES,
  });
  return {
    pointEstimate,
    low: result?.low ?? null,
    high: result?.high ?? null,
    dayCount: series.length,
    iterations: result?.iterations ?? null,
    blockLength: result?.blockLength ?? null,
    clusterCount: result?.clusterCount ?? null,
  };
}

/** 逐臂边际统计的 95% 区间（仅作参照，不作为主判据）。 */
export function armMeanInterval(args: {
  readonly days: readonly DailyArmStat[];
  readonly field: PairedField;
}): { mean: number | null; low: number | null; high: number | null } {
  const samples: DateClusterValue[] = args.days
    .map((day) => ({ eventDate: day.date, value: day[args.field] }))
    .filter((item): item is DateClusterValue => item.value !== null);
  const result = movingBlockBootstrapMean({
    samples,
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_PRIMARY,
    seed: BOOTSTRAP_SEED,
    quantiles: CI_QUANTILES_95,
  });
  return {
    mean: meanOf(samples.map((item) => item.value)),
    low: result?.low ?? null,
    high: result?.high ?? null,
  };
}

// ---------------------------------------------------------------------------
// 四、年度片段与收口判定（规格 §5.3）
// ---------------------------------------------------------------------------

export interface YearSlice {
  readonly year: number;
  readonly dayCount: number;
  readonly signalCount: number;
  readonly armPointEstimate: number | null;
  readonly randomPointEstimate: number | null;
  readonly difference: number | null;
}

export function yearSlices(args: {
  readonly armDays: readonly DailyArmStat[];
  readonly randomDays: readonly DailyArmStat[];
  readonly field: PairedField;
}): readonly YearSlice[] {
  const randomByDate = new Map(args.randomDays.map((day) => [day.date, day]));
  const years = [...new Set(args.armDays.map((day) => day.year))].sort();
  const out: YearSlice[] = [];
  for (const year of years) {
    const armValues: number[] = [];
    const randomValues: number[] = [];
    let signalCount = 0;
    for (const armDay of args.armDays) {
      if (armDay.year !== year) continue;
      const randomDay = randomByDate.get(armDay.date);
      if (randomDay === undefined) continue;
      const left = armDay[args.field];
      const right = randomDay[args.field];
      if (left === null || right === null) continue;
      signalCount += armDay.signalCount;
      armValues.push(left);
      randomValues.push(right);
    }
    const armPoint = meanOf(armValues);
    const randomPoint = meanOf(randomValues);
    out.push({
      year,
      dayCount: armValues.length,
      signalCount,
      armPointEstimate: armPoint,
      randomPointEstimate: randomPoint,
      difference: armPoint === null || randomPoint === null ? null : armPoint - randomPoint,
    });
  }
  return out;
}

export interface VerdictInput {
  /** 主右尾判据（20bps，slot 效用）block20 的 97.5% 区间。 */
  readonly primary: DifferenceInterval;
  /** 同一判据 block40 的 97.5% 区间。 */
  readonly primaryBlock40: DifferenceInterval;
  /** 年度片段（按 20bps 主判据）。 */
  readonly yearly: readonly YearSlice[];
  /** 该臂命中主右尾的唯一机会段数。 */
  readonly uniqueOpportunitySegmentsWithTailHit: number;
  /** `≤−10%` 概率的配对差区间（97.5%）。 */
  readonly loss10: DifferenceInterval;
  /** 净均值的配对差区间（97.5%）。 */
  readonly mean: DifferenceInterval;
  /** 覆盖 / 依赖是否足够（决策日数、池大小、右删失比例等）。 */
  readonly coverageSufficient: boolean;
}

export interface VerdictResult {
  readonly verdict: ResearchVerdict;
  readonly reasons: readonly string[];
  readonly rightTailEvidence: boolean;
  readonly riskTradeoff: boolean;
}

/**
 * 事前收口规则（规格 §5.3）。
 *
 * | 判定 | 条件 |
 * |---|---|
 * | `RIGHT_TAIL_EVIDENCE` | 主差值 97.5% CI 下界 > 0 ∧ 年度同向 ∧ block40 CI 下界 > 0 ∧ 唯一机会段命中 ≥ 50 |
 * | `RISK_TRADEOFF` | 满足右尾证据，但 `≤−10%` 概率显著增加（CI 下界 > 0）或净均值显著更差（CI 上界 < 0） |
 * | `NO_SUPPORT` | 主差值 CI **上界 ≤ 0** |
 * | `INSUFFICIENT_EVIDENCE` | 其余（CI 跨 0 / 年度反向 / 机会段不足 / 覆盖不足） |
 */
export function judgeVerdict(input: VerdictInput): VerdictResult {
  const reasons: string[] = [];
  const primaryLow = input.primary.low;
  const primaryHigh = input.primary.high;
  if (primaryLow === null || primaryHigh === null) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: ["主右尾判据无法估计区间（决策日 < 2 或全部日期被剔除）"],
      rightTailEvidence: false,
      riskTradeoff: false,
    };
  }
  if (primaryHigh <= 0) {
    return {
      verdict: "NO_SUPPORT",
      reasons: [
        `主右尾差值 97.5% CI 上界 ${primaryHigh.toFixed(6)} ≤ 0 ⇒ 本配置无支持`,
      ],
      rightTailEvidence: false,
      riskTradeoff: false,
    };
  }

  const block40Ok = input.primaryBlock40.low !== null && input.primaryBlock40.low > 0;
  if (!block40Ok) reasons.push("block40 敏感性区间下界 ≤ 0 或不可估");
  if (primaryLow <= 0) reasons.push(`主区间下界 ${primaryLow.toFixed(6)} ≤ 0（CI 跨 0）`);

  const significantYears = input.yearly.filter((slice) => slice.difference !== null);
  const signs = new Set(
    significantYears.map((slice) => (slice.difference! > 0 ? 1 : slice.difference! < 0 ? -1 : 0)),
  );
  const yearlySameDirection = signs.size === 1 && !signs.has(0);
  const yearlyPositive = yearlySameDirection && signs.has(1);
  if (!yearlySameDirection) reasons.push("年度片段点估计不同向");
  else if (!yearlyPositive) reasons.push("年度片段点估计同向但为负");

  if (input.uniqueOpportunitySegmentsWithTailHit < MIN_UNIQUE_OPPORTUNITY_SEGMENTS) {
    reasons.push(
      `唯一机会段命中 ${input.uniqueOpportunitySegmentsWithTailHit} < ${MIN_UNIQUE_OPPORTUNITY_SEGMENTS}`,
    );
  }
  if (!input.coverageSufficient) reasons.push("数据覆盖 / 依赖敏感性不足");

  const rightTailEvidence =
    primaryLow > 0 &&
    block40Ok &&
    yearlyPositive &&
    input.uniqueOpportunitySegmentsWithTailHit >= MIN_UNIQUE_OPPORTUNITY_SEGMENTS &&
    input.coverageSufficient;

  if (!rightTailEvidence) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      reasons: reasons.length === 0 ? ["未满足右尾证据的全部条件"] : reasons,
      rightTailEvidence: false,
      riskTradeoff: false,
    };
  }

  const loss10Worse = input.loss10.low !== null && input.loss10.high !== null && input.loss10.low > 0;
  const meanWorse = input.mean.low !== null && input.mean.high !== null && input.mean.high < 0;
  const riskTradeoff = loss10Worse || meanWorse;
  const riskReasons = [...reasons];
  if (loss10Worse) {
    riskReasons.push(
      `≤−10% 概率相对 Random 显著增加（差值 97.5% CI = [${input.loss10.low!.toFixed(6)}, ${input.loss10.high!.toFixed(6)}]）`,
    );
  }
  if (meanWorse) {
    riskReasons.push(
      `净均值相对 Random 显著更差（差值 97.5% CI = [${input.mean.low!.toFixed(6)}, ${input.mean.high!.toFixed(6)}]）`,
    );
  }
  return {
    verdict: riskTradeoff ? "RISK_TRADEOFF" : "RIGHT_TAIL_EVIDENCE",
    reasons:
      riskReasons.length === 0
        ? ["全部事前条件满足（仍不构成可交易资格）"]
        : riskReasons,
    rightTailEvidence: true,
    riskTradeoff,
  };
}

export {
  BOOTSTRAP_BLOCK_PRIMARY,
  BOOTSTRAP_BLOCK_SENSITIVITY,
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  CI_QUANTILES,
  CI_QUANTILES_95,
};

export type { ArmId, DailyArmStat };
