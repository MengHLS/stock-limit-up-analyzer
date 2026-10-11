/**
 * RIGHT-TAIL-RESEARCH-002 — **Tail Metrics MVP**：排序键 / 右尾指标 / Rank IC（纯函数，零 IO）。
 *
 * ## 为什么破平键必须三个都算
 *
 * P3 已证：research-experiments 的 `eventId` 形如 `<symbol>@<date>`（实测 100%），
 * 因此「按 `symbol` 升序」与「按 `eventId` 升序」在**同一交易日内等价** ⇒ 单一键的自检会退化成
 * 恒等（Jaccard = 1.00）。本模块因此固定输出 `ASC` / `DESC` / `RAND` 三个键。
 *
 * ## 🔴 Tail Recognition 与 Economic Return 分开评价
 *
 * 本模块只产出指标，**不做判定**。`Mean` 为负**不构成**因子无效的理由 ——
 * 尾识别力（`Tail Capture Rate` / `Tail Lift` / `Top-K Tail Precision`）与经济收益
 * （`Mean` / `Median` / `WinRate`）必须**分别**读数；两者的背离是已知的**结构性**尾–均值张力。
 */

import {
  movingBlockBootstrapMean,
  type DateClusterValue,
} from "../dateClusterBootstrap";
import {
  RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS,
  RIGHT_TAIL_BOOTSTRAP_ITERATIONS,
  RIGHT_TAIL_BOOTSTRAP_SEED,
  RIGHT_TAIL_PERMUTATION_ITERATIONS,
  RIGHT_TAIL_TIE_BREAK_SEED,
  type RightTailFactorCode,
  type RightTailRankingDirection,
  type RightTailTieBreakKey,
} from "./rightTailTypes";

// ---------------------------------------------------------------------------
// 一、确定性伪随机（与既有 `dateClusterBootstrap` 同构；不跨模块复用以免扰动既有实验数字）
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 稳定字符串 → 32 位种子（FNV-1a），保证同日同因子的 `RAND` 键可复现。 */
export function seedOf(...parts: readonly (string | number)[]): number {
  let hash = 2_166_136_261;
  const text = parts.join("|");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash ^ RIGHT_TAIL_TIE_BREAK_SEED) >>> 0;
}

// ---------------------------------------------------------------------------
// 二、排序与破平键
// ---------------------------------------------------------------------------

export interface ScoredCandidate {
  readonly eventId: string;
  readonly value: number;
  /** 预先生成的 `RAND` 键（同一 (日期, 因子) 内固定）。 */
  readonly randomKey: number;
}

export interface RankedCandidate extends ScoredCandidate {
  /** 1 = 该方向下的第一名。 */
  readonly rank: number;
}

function compareByKey(
  left: ScoredCandidate,
  right: ScoredCandidate,
  key: RightTailTieBreakKey
): number {
  if (key === "ASC") return left.eventId.localeCompare(right.eventId);
  if (key === "DESC") return right.eventId.localeCompare(left.eventId);
  return left.randomKey - right.randomKey;
}

/**
 * 按方向排序候选集（best first），同值按指定破平键。
 *
 * `HIGH` = 值大在前；`LOW` = 值小在前。返回的数组**始终**是「该方向下从最好到最差」⇒
 * `Top-K` = `slice(0, K)`，`Bottom3` = `slice(-3)`（末尾 3 个 = 该方向下最差）。
 */
export function rankCandidates(
  candidates: readonly ScoredCandidate[],
  direction: RightTailRankingDirection,
  key: RightTailTieBreakKey
): RankedCandidate[] {
  const ordered = [...candidates].sort((left, right) => {
    if (left.value !== right.value) {
      return direction === "HIGH" ? right.value - left.value : left.value - right.value;
    }
    return compareByKey(left, right, key);
  });
  return ordered.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/** Jaccard 相似度（空集视为完全相同）。 */
export function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  for (const id of a) if (b.has(id)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * 净值曲线的最大回撤（**≤ 0**），按**决策日顺序**复利。
 *
 * 🔴 定义与 `shared/singleFactor/metrics.ts#maxDrawdownOf` **逐字一致**
 * （`E_0 = 1`；`E_d = E_{d−1} × (1 + r_d)`；`min_d(E_d / peak_{≤d} − 1)`）。
 * 在本模块内联实现是为了让本组纯函数**不引入 zod 依赖链**（保持可独立编译运行）；
 * **不是**第二套口径。
 */
export function maxDrawdownOf(returns: readonly number[]): number | null {
  if (returns.length === 0) return null;
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity / peak - 1);
  }
  return worst;
}

// ---------------------------------------------------------------------------
// 三、秩与 Rank IC
// ---------------------------------------------------------------------------

/** 平均秩（并列取平均）。 */
export function averageRanks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length).fill(0);
  let position = 0;
  while (position < order.length) {
    let end = position;
    while (end + 1 < order.length && order[end + 1]!.value === order[position]!.value) end += 1;
    const average = (position + end) / 2 + 1;
    for (let cursor = position; cursor <= end; cursor += 1) ranks[order[cursor]!.index] = average;
    position = end + 1;
  }
  return ranks;
}

/** Spearman 秩相关；任一侧无秩方差或样本 < 3 ⇒ `null`（不伪造）。 */
export function spearman(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const leftRanks = averageRanks(left);
  const rightRanks = averageRanks(right);
  const n = left.length;
  const leftMean = leftRanks.reduce((sum, value) => sum + value, 0) / n;
  const rightMean = rightRanks.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < n; index += 1) {
    const dl = leftRanks[index]! - leftMean;
    const dr = rightRanks[index]! - rightMean;
    covariance += dl * dr;
    leftVariance += dl * dl;
    rightVariance += dr * dr;
  }
  if (leftVariance === 0 || rightVariance === 0) return null;
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

export interface RankIcSummary {
  /** 有定义的决策日数。 */
  readonly dayCount: number;
  readonly meanIc: number | null;
  readonly medianIc: number | null;
  /** `IC > 0` 的决策日占比。 */
  readonly sharePositive: number | null;
  /** `meanIc / std(IC)`（日度 IC 序列；std 为 0 或日数 < 2 ⇒ `null`）。 */
  readonly icir: number | null;
  readonly ci95Low: number | null;
  readonly ci95High: number | null;
}

/** 逐日 Rank IC 汇总（日均 + 日期聚类 Bootstrap + ICIR）。 */
export function summarizeRankIc(
  daily: readonly DateClusterValue[],
  seed: number
): RankIcSummary {
  const values = daily.map((point) => point.value);
  if (values.length === 0) {
    return { dayCount: 0, meanIc: null, medianIc: null, sharePositive: null, icir: null, ci95Low: null, ci95High: null };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
      : 0;
  const std = Math.sqrt(variance);
  const bootstrap = movingBlockBootstrapMean({
    samples: daily,
    iterations: RIGHT_TAIL_BOOTSTRAP_ITERATIONS,
    blockLength: RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS,
    seed,
  });
  return {
    dayCount: values.length,
    meanIc: mean,
    medianIc: median,
    sharePositive: values.filter((value) => value > 0).length / values.length,
    icir: values.length > 1 && std > 0 ? mean / std : null,
    ci95Low: bootstrap?.low ?? null,
    ci95High: bootstrap?.high ?? null,
  };
}

// ---------------------------------------------------------------------------
// 四、随机 K 子集基线（**与因子无关**，每 (K, 期限, 阈值) 只算一次）
// ---------------------------------------------------------------------------

export interface RandomBaselineDay {
  readonly date: string;
  /** 当日「All」池规模（有该期限有效收益的候选数）。 */
  readonly poolSize: number;
  /** 当日池内尾事件数。 */
  readonly tailCount: number;
}

export interface RandomBaseline {
  /** 池基线 `THR(All)`（样本加权）。 */
  readonly poolThr: number;
  readonly poolTailCount: number;
  readonly poolCount: number;
  readonly iterations: number;
  /** 置换得到的「随机 K 子集 `THR`」分布分位。 */
  readonly thrP2_5: number;
  readonly thrP97_5: number;
  readonly thrMean: number;
  /** 观测统计量的单侧 p 值。 */
  readonly pValueOf: (observedThr: number) => number;
}

/**
 * 「随机抽 K 只」的置换基线。
 *
 * 关键点：随机 K 子集的 `THR` **期望恰等于池基线**，因此该基线只需按
 * `(K, 期限, 阈值)` 算一次，与因子无关。逐日按超几何方式抽 K 只（无放回）。
 */
export function buildRandomBaseline(
  days: readonly RandomBaselineDay[],
  size: number,
  seed: number,
  iterations: number = RIGHT_TAIL_PERMUTATION_ITERATIONS
): RandomBaseline {
  const usable = days.filter((day) => day.poolSize >= size);
  const poolCount = usable.reduce((sum, day) => sum + day.poolSize, 0);
  const poolTailCount = usable.reduce((sum, day) => sum + day.tailCount, 0);
  const poolThr = poolCount === 0 ? 0 : poolTailCount / poolCount;

  const random = mulberry32(seed);
  const thrSamples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let tailPicked = 0;
    let picked = 0;
    for (const day of usable) {
      // 无放回抽 K 个：逐个判断，命中概率按剩余池的尾占比递推（等价超几何）。
      let remaining = day.poolSize;
      let remainingTail = day.tailCount;
      for (let draw = 0; draw < size && remaining > 0; draw += 1) {
        const isTail = random() < remainingTail / remaining;
        if (isTail) {
          remainingTail -= 1;
          tailPicked += 1;
        }
        remaining -= 1;
        picked += 1;
      }
    }
    thrSamples.push(picked === 0 ? 0 : tailPicked / picked);
  }
  const sorted = [...thrSamples].sort((a, b) => a - b);
  const quantile = (q: number): number => {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0]!;
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower]!;
    const weight = position - lower;
    return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
  };
  return {
    poolThr,
    poolTailCount,
    poolCount,
    iterations,
    thrP2_5: quantile(0.025),
    thrP97_5: quantile(0.975),
    thrMean: sorted.length === 0 ? 0 : sorted.reduce((s, v) => s + v, 0) / sorted.length,
    pValueOf: (observedThr: number) => {
      if (sorted.length === 0) return null as unknown as number;
      const atLeast = sorted.filter((value) => value >= observedThr).length;
      return (atLeast + 1) / (sorted.length + 1);
    },
  };
}

// ---------------------------------------------------------------------------
// 五、Tail Lift 的比值型区间（零假设 = 1，**不能**套用「下界 > 0」）
// ---------------------------------------------------------------------------

export interface LiftEstimate {
  /** `THR(Top-K) / THR(All)`；池基线为 0 ⇒ `null`（不伪造）。 */
  readonly lift: number | null;
  readonly ci95Low: number | null;
  readonly ci95High: number | null;
  /** 区间是否整体 > 1（= 优于池基线）。 */
  readonly aboveOne: boolean | null;
}

/**
 * 日期聚类 Bootstrap 下的 **比值** 区间。
 *
 * 逐日聚合成 `(pickedCount, tailPicked)` 与 `(poolCount, poolTail)`，按交易日块重采样后
 * 重算 `Σtail_picked / Σpicked ÷ Σtail_pool / Σpool`。刻意**不**把两个边际 CI 相除。
 */
export function bootstrapLift(args: {
  /** 每日被选中且该期限有有效收益的样本数。 */
  readonly pickedByDay: readonly { date: string; picked: number; tailPicked: number }[];
  /** 每日池规模与池内尾事件数。 */
  readonly poolByDay: readonly RandomBaselineDay[];
  readonly iterations?: number;
  readonly blockLength?: number;
  readonly seed?: number;
}): LiftEstimate {
  const poolMap = new Map(args.poolByDay.map((day) => [day.date, day]));
  const days = args.pickedByDay
    .map((day) => {
      const pool = poolMap.get(day.date);
      return pool === undefined || pool.poolSize === 0
        ? null
        : { date: day.date, picked: day.picked, tailPicked: day.tailPicked, poolSize: pool.poolSize, tailCount: pool.tailCount };
    })
    .filter((day): day is NonNullable<typeof day> => day !== null)
    .sort((left, right) => left.date.localeCompare(right.date));

  const sumPicked = days.reduce((sum, day) => sum + day.picked, 0);
  const sumTailPicked = days.reduce((sum, day) => sum + day.tailPicked, 0);
  const sumPool = days.reduce((sum, day) => sum + day.poolSize, 0);
  const sumTailPool = days.reduce((sum, day) => sum + day.tailCount, 0);
  const baseThr = sumPool === 0 ? 0 : sumTailPool / sumPool;
  const pickThr = sumPicked === 0 ? 0 : sumTailPicked / sumPicked;
  const lift = baseThr === 0 || sumPicked === 0 ? null : pickThr / baseThr;

  if (days.length < 2 || lift === null) {
    return { lift, ci95Low: null, ci95High: null, aboveOne: null };
  }

  const iterations = Math.max(100, Math.trunc(args.iterations ?? RIGHT_TAIL_BOOTSTRAP_ITERATIONS));
  const blockLength = Math.max(1, Math.trunc(args.blockLength ?? RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS));
  const random = mulberry32(args.seed ?? RIGHT_TAIL_BOOTSTRAP_SEED);
  const lifts: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let picked = 0;
    let tailPicked = 0;
    let pool = 0;
    let tailPool = 0;
    let sampled = 0;
    while (sampled < days.length) {
      const start = Math.floor(random() * days.length);
      for (let offset = 0; offset < blockLength && sampled < days.length; offset += 1) {
        const day = days[(start + offset) % days.length]!;
        picked += day.picked;
        tailPicked += day.tailPicked;
        pool += day.poolSize;
        tailPool += day.tailCount;
        sampled += 1;
      }
    }
    const base = pool === 0 ? 0 : tailPool / pool;
    const pick = picked === 0 ? 0 : tailPicked / picked;
    if (base > 0) lifts.push(pick / base);
  }
  if (lifts.length === 0) return { lift, ci95Low: null, ci95High: null, aboveOne: null };
  lifts.sort((a, b) => a - b);
  const quantile = (q: number): number => {
    const position = (lifts.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return lifts[lower]!;
    const weight = position - lower;
    return lifts[lower]! * (1 - weight) + lifts[upper]! * weight;
  };
  const low = quantile(0.025);
  const high = quantile(0.975);
  return { lift, ci95Low: low, ci95High: high, aboveOne: low > 1 };
}

// ---------------------------------------------------------------------------
// 六、选择集指标（Tail Recognition 与 Economic Return 分开）
// ---------------------------------------------------------------------------

export interface TailRecognition {
  readonly selectionKind: string;
  readonly size: number | null;
  /** 被选中且该期限有有效收益的样本数。 */
  readonly pickedCount: number;
  readonly tailPickedCount: number;
  /** `THR`（样本加权）。 */
  readonly tailHitRate: number | null;
  /** `TCR`（池内全部尾事件中被抓到的比例）。 */
  readonly tailCaptureRate: number | null;
  readonly lift: LiftEstimate;
  /** `Top-K Tail Precision`（**逐日等权**；`K` 依赖档位 ⇒ `All`/`Random3` 为 `null`）。 */
  readonly topKTailPrecision: number | null;
  readonly precisionCi95Low: number | null;
  readonly precisionCi95High: number | null;
  /** `THR(sel) − THR(All)`（百分点差，同日配对）。 */
  readonly vsAllDelta: number | null;
  readonly vsAllCi95Low: number | null;
  readonly vsAllCi95High: number | null;
}

export interface EconomicReturn {
  readonly pickedCount: number;
  readonly meanReturn: number | null;
  readonly medianReturn: number | null;
  readonly winRate: number | null;
  /** 毛收益均值（**未扣 20 bps**）；未提供毛序列时为 `null`。 */
  readonly grossMeanReturn: number | null;
  readonly grossMedianReturn: number | null;
}

export interface SelectionDayStat {
  readonly date: string;
  readonly pickedEventIds: readonly string[];
  readonly pickedReturns: readonly number[];
  /** 与 `pickedReturns` 逐位对应的**毛**收益（可选）。 */
  readonly pickedGrossReturns?: readonly number[];
  readonly poolReturns: readonly number[];
  readonly tailPickedCount: number;
  readonly poolTailCount: number;
  readonly poolSize: number;
  readonly pickSizeForPrecision: number | null;
}

function meanOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantileOf(values: readonly number[], q: number): number | null {
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

/**
 * 汇总一个选择集（`Top3` / `Top5` / `All` / `Bottom3` / `Random3`）在**一个期限×阈值**下的指标。
 *
 * 🔴 `poolThr` 与 `poolByDay` 必须来自**同一期限**的池（All），保证逐日配对。
 */
export function summarizeSelection(args: {
  readonly selectionKind: string;
  readonly size: number | null;
  readonly dayStats: readonly SelectionDayStat[];
  readonly poolBaseline: RandomBaseline;
  readonly seed: number;
  /**
   * 是否计算区间（默认 `true`）。
   *
   * 🔴 设 `false` 只影响**区间**，点估计（`THR` / `TCR` / `Lift` / `Precision` / `vsAll` /
   * `Mean` / `Median` / `WinRate`）**逐位不变** —— 供全矩阵扫描时省掉 3 次重采样。
   */
  readonly withConfidenceIntervals?: boolean;
}): { recognition: TailRecognition; economic: EconomicReturn } {
  const allPickedReturns: number[] = [];
  const allPickedGross: number[] = [];
  let pickedCount = 0;
  let tailPickedCount = 0;
  let poolCount = 0;
  let poolTailCount = 0;
  const perDayThr: DateClusterValue[] = [];
  const perDayDelta: DateClusterValue[] = [];
  const precisionValues: number[] = [];
  const pickedByDay: { date: string; picked: number; tailPicked: number }[] = [];

  for (const day of args.dayStats) {
    const picked = day.pickedReturns.length;
    const dayPickedAll = day.pickedEventIds.length;
    if (dayPickedAll > 0) {
      pickedByDay.push({ date: day.date, picked: dayPickedAll, tailPicked: day.tailPickedCount });
    }
    if (picked > 0) {
      allPickedReturns.push(...day.pickedReturns);
      if (day.pickedGrossReturns) allPickedGross.push(...day.pickedGrossReturns);
      pickedCount += picked;
      tailPickedCount += day.tailPickedCount;
      const dayThr = day.tailPickedCount / picked;
      perDayThr.push({ eventDate: day.date, value: dayThr });
      const poolThrDay = day.poolSize === 0 ? null : day.poolTailCount / day.poolSize;
      if (poolThrDay !== null) perDayDelta.push({ eventDate: day.date, value: dayThr - poolThrDay });
      if (day.pickSizeForPrecision !== null && day.pickSizeForPrecision > 0) {
        precisionValues.push(day.tailPickedCount / day.pickSizeForPrecision);
      }
    }
    poolCount += day.poolSize;
    poolTailCount += day.poolTailCount;
  }

  const tailHitRate = pickedCount === 0 ? null : tailPickedCount / pickedCount;
  const tailCaptureRate = poolTailCount === 0 ? null : tailPickedCount / poolTailCount;
  const withCi = args.withConfidenceIntervals !== false;
  const pooledBaseThr = poolCount === 0 ? 0 : poolTailCount / poolCount;
  const pooledPickThr = pickedCount === 0 ? 0 : tailPickedCount / pickedCount;
  const liftPoint =
    pooledBaseThr === 0 || pickedCount === 0 ? null : pooledPickThr / pooledBaseThr;
  const lift: LiftEstimate = withCi
    ? bootstrapLift({
        pickedByDay,
        poolByDay: args.dayStats.map((day) => ({
          date: day.date,
          poolSize: day.poolSize,
          tailCount: day.poolTailCount,
        })),
        seed: args.seed,
      })
    : { lift: liftPoint, ci95Low: null, ci95High: null, aboveOne: null };

  const precisionBootstrap = withCi
    ? movingBlockBootstrapMean({
        samples: precisionValues.map((value, index) => ({
          eventDate: args.dayStats[index]?.date ?? String(index),
          value,
        })),
        iterations: RIGHT_TAIL_BOOTSTRAP_ITERATIONS,
        blockLength: RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS,
        seed: args.seed + 11,
      })
    : null;
  const deltaBootstrap = withCi
    ? movingBlockBootstrapMean({
        samples: perDayDelta,
        iterations: RIGHT_TAIL_BOOTSTRAP_ITERATIONS,
        blockLength: RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS,
        seed: args.seed + 22,
      })
    : null;

  return {
    recognition: {
      selectionKind: args.selectionKind,
      size: args.size,
      pickedCount,
      tailPickedCount,
      tailHitRate,
      tailCaptureRate,
      lift,
      topKTailPrecision: meanOf(precisionValues),
      precisionCi95Low: precisionBootstrap?.low ?? null,
      precisionCi95High: precisionBootstrap?.high ?? null,
      vsAllDelta: tailHitRate === null || args.poolBaseline.poolThr === 0 ? null : tailHitRate - args.poolBaseline.poolThr,
      vsAllCi95Low: deltaBootstrap?.low ?? null,
      vsAllCi95High: deltaBootstrap?.high ?? null,
    },
    economic: {
      pickedCount: allPickedReturns.length,
      meanReturn: meanOf(allPickedReturns),
      medianReturn: quantileOf(allPickedReturns, 0.5),
      winRate: allPickedReturns.length === 0 ? null : allPickedReturns.filter((value) => value > 0).length / allPickedReturns.length,
      grossMeanReturn: meanOf(allPickedGross),
      grossMedianReturn: quantileOf(allPickedGross, 0.5),
    },
  };
}

// ---------------------------------------------------------------------------
// 七、`RIGHT-TAIL-CROSS-SECTIONAL-EXCESS-001`：**同日配对横截面超额**
// ---------------------------------------------------------------------------

/** 一个决策日的同日配对原始收益（池 vs 选中）。 */
export interface CrossSectionalDayStat {
  readonly date: string;
  /** 当日池内**有有效收益**的全部候选。 */
  readonly poolReturns: readonly number[];
  /** 当日被选中且**有有效收益**的股票。 */
  readonly pickReturns: readonly number[];
}

/** 日等权的超额点估计 + 日期聚类 Bootstrap 区间。 */
export interface ExcessEstimate {
  /** 逐日配对的**日等权均值**（`mean_d(excess_d)`），非池化差值。 */
  readonly value: number | null;
  readonly ci95Low: number | null;
  readonly ci95High: number | null;
  readonly dayCount: number;
  /** 区间是否整体 > 0。 */
  readonly aboveZero: boolean | null;
}

export interface CrossSectionalExcessResult {
  readonly dayCount: number;
  readonly poolCount: number;
  readonly pickCount: number;
  /** 池的**事件加权**均值（仅作展示；判定一律用日等权超额）。 */
  readonly poolMean: number | null;
  readonly pickMean: number | null;
  /** 逐日中位数的日等权均值（与 `poolMedian` 同口径）。 */
  readonly pickMedian: number | null;
  readonly poolMedian: number | null;
  readonly pickWinRate: number | null;
  /** 池化的（事件加权）尾率绝对值。 */
  readonly pickTcr20: number | null;
  readonly pickTcr50: number | null;
  readonly pickTcr100: number | null;
  readonly poolTcr20: number | null;
  readonly poolTcr50: number | null;
  readonly poolTcr100: number | null;
  readonly excessMean: ExcessEstimate;
  readonly excessMedian: ExcessEstimate;
  readonly excessTcr20: ExcessEstimate;
  readonly excessTcr50: ExcessEstimate;
  readonly excessTcr100: ExcessEstimate;
  /** 池化的 `THR(Top-K) / THR(All)` 及其日期聚类比值区间。 */
  readonly lift: LiftEstimate;
  /** 池化的（事件加权）尾率，供与 `lift` 一起读数。 */
  readonly pickTailRate: number | null;
  readonly poolTailRate: number | null;
  /**
   * 池尾率为 0 的交易日数（`θ=+100%` 下很常见）。
   *
   * 🔴 **逐日比值在这些日上无定义**，因此本模块**只**给池化比值区间；
   * 逐日比较一律用**差值**（`excessTcr*`），差值在池尾率为 0 时依然良定义。
   */
  readonly zeroBaseDayCount: number;
}

function excessOf(
  dayValues: readonly { date: string; value: number }[],
  seed: number
): ExcessEstimate {
  if (dayValues.length === 0) {
    return { value: null, ci95Low: null, ci95High: null, dayCount: 0, aboveZero: null };
  }
  const value = dayValues.reduce((sum, day) => sum + day.value, 0) / dayValues.length;
  const boot = movingBlockBootstrapMean({
    // 每个交易日恰一条记录 ⇒ 重采样后的 `sum/count` 即**日等权**均值。
    samples: dayValues.map((day) => ({ eventDate: day.date, value: day.value })),
    iterations: RIGHT_TAIL_BOOTSTRAP_ITERATIONS,
    blockLength: RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS,
    seed,
  });
  return {
    value,
    ci95Low: boot?.low ?? null,
    ci95High: boot?.high ?? null,
    dayCount: dayValues.length,
    aboveZero: boot ? boot.low > 0 : null,
  };
}

/**
 * 同日配对横截面超额。
 *
 * 🔴 **绝不允许把全部交易混在一起直接比较**：本函数先在**每个决策日内**算
 * `TopK − AllPool`，再对**日序列**取日等权均值并做日期聚类 Bootstrap。
 * 这样得到的 `ExcessMean` 与「池化差」是两个不同的量；前者才是横截面能力的度量
 * （池化差会被「哪一天有行情」这个时间序列成分污染）。
 */
export function summarizeCrossSectionalExcess(args: {
  readonly days: readonly CrossSectionalDayStat[];
  readonly seed: number;
  /** 三个尾阈值（默认 `[0.2, 0.5, 1.0]`）。 */
  readonly thetas?: readonly number[];
}): CrossSectionalExcessResult {
  const thetas = args.thetas ?? [0.2, 0.5, 1];
  const [t20, t50, t100] = [thetas[0] ?? 0.2, thetas[1] ?? 0.5, thetas[2] ?? 1];

  const excessMeanDays: { date: string; value: number }[] = [];
  const excessMedianDays: { date: string; value: number }[] = [];
  const excess20Days: { date: string; value: number }[] = [];
  const excess50Days: { date: string; value: number }[] = [];
  const excess100Days: { date: string; value: number }[] = [];
  const pickedByDay: { date: string; picked: number; tailPicked: number }[] = [];
  const poolByDay: RandomBaselineDay[] = [];

  const allPool: number[] = [];
  const allPick: number[] = [];
  const poolMedianDays: number[] = [];
  const pickMedianDays: number[] = [];
  let poolTail50 = 0;
  let pickTail50 = 0;
  let poolTail20 = 0;
  let pickTail20 = 0;
  let poolTail100 = 0;
  let pickTail100 = 0;
  let zeroBaseDayCount = 0;

  for (const day of args.days) {
    if (day.poolReturns.length === 0 || day.pickReturns.length === 0) continue;
    allPool.push(...day.poolReturns);
    allPick.push(...day.pickReturns);
    poolMedianDays.push(quantileOf(day.poolReturns, 0.5) ?? 0);
    pickMedianDays.push(quantileOf(day.pickReturns, 0.5) ?? 0);
    poolTail20 += day.poolReturns.filter((v) => v >= t20).length;
    pickTail20 += day.pickReturns.filter((v) => v >= t20).length;
    poolTail100 += day.poolReturns.filter((v) => v >= t100).length;
    pickTail100 += day.pickReturns.filter((v) => v >= t100).length;

    const poolMean = day.poolReturns.reduce((s, v) => s + v, 0) / day.poolReturns.length;
    const pickMean = day.pickReturns.reduce((s, v) => s + v, 0) / day.pickReturns.length;
    const poolMedian = quantileOf(day.poolReturns, 0.5) ?? 0;
    const pickMedian = quantileOf(day.pickReturns, 0.5) ?? 0;
    const poolTcr = (theta: number): number =>
      day.poolReturns.filter((v) => v >= theta).length / day.poolReturns.length;
    const pickTcr = (theta: number): number =>
      day.pickReturns.filter((v) => v >= theta).length / day.pickReturns.length;

    const pool50 = poolTcr(t50);
    if (pool50 === 0) zeroBaseDayCount += 1;
    poolTail50 += day.poolReturns.filter((v) => v >= t50).length;
    pickTail50 += day.pickReturns.filter((v) => v >= t50).length;

    excessMeanDays.push({ date: day.date, value: pickMean - poolMean });
    excessMedianDays.push({ date: day.date, value: pickMedian - poolMedian });
    excess20Days.push({ date: day.date, value: pickTcr(t20) - poolTcr(t20) });
    excess50Days.push({ date: day.date, value: pickTcr(t50) - poolTcr(t50) });
    excess100Days.push({ date: day.date, value: pickTcr(t100) - poolTcr(t100) });

    pickedByDay.push({
      date: day.date,
      picked: day.pickReturns.length,
      tailPicked: day.pickReturns.filter((v) => v >= t50).length,
    });
    poolByDay.push({ date: day.date, poolSize: day.poolReturns.length, tailCount: day.poolReturns.filter((v) => v >= t50).length });
  }

  return {
    dayCount: excessMeanDays.length,
    poolCount: allPool.length,
    pickCount: allPick.length,
    poolMean: meanOf(allPool),
    pickMean: meanOf(allPick),
    pickMedian: meanOf(pickMedianDays),
    poolMedian: meanOf(poolMedianDays),
    pickWinRate: allPick.length === 0 ? null : allPick.filter((v) => v > 0).length / allPick.length,
    pickTcr20: allPick.length === 0 ? null : pickTail20 / allPick.length,
    pickTcr50: allPick.length === 0 ? null : pickTail50 / allPick.length,
    pickTcr100: allPick.length === 0 ? null : pickTail100 / allPick.length,
    poolTcr20: allPool.length === 0 ? null : poolTail20 / allPool.length,
    poolTcr50: allPool.length === 0 ? null : poolTail50 / allPool.length,
    poolTcr100: allPool.length === 0 ? null : poolTail100 / allPool.length,
    excessMean: excessOf(excessMeanDays, args.seed + 1),
    excessMedian: excessOf(excessMedianDays, args.seed + 2),
    excessTcr20: excessOf(excess20Days, args.seed + 3),
    excessTcr50: excessOf(excess50Days, args.seed + 4),
    excessTcr100: excessOf(excess100Days, args.seed + 5),
    lift: bootstrapLift({
      pickedByDay,
      poolByDay,
      iterations: RIGHT_TAIL_BOOTSTRAP_ITERATIONS,
      blockLength: RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS,
      seed: args.seed + 6,
    }),
    pickTailRate: allPick.length === 0 ? null : pickTail50 / allPick.length,
    poolTailRate: allPool.length === 0 ? null : poolTail50 / allPool.length,
    zeroBaseDayCount,
  };
}

// ---------------------------------------------------------------------------
// 八、`RIGHT-TAIL-SELECTION-RULE-001`：**选股规则引擎** + **同日配对比较**
// ---------------------------------------------------------------------------

/**
 * 规则类型（**本实验只允许这三种，不搜索阈值、不搜索组合**）。
 *
 * - `SINGLE` —— 单因子基准：按主因子排名取 Top-K。
 * - `CO_EXTREME_TOP20` —— **共同极端**：候选须**同时**进入主因子与次因子各自的 `Top 20%`，
 *   再按**主因子**排名取 Top-K。
 * - `EXCLUDE_TOP20` —— **风险约束**：从主因子排名中**剔除**落入次因子 `Top 20%` 者，再取 Top-K。
 */
export type RightTailRuleKind = "SINGLE" | "CO_EXTREME_TOP20" | "EXCLUDE_TOP20";

/** 分位切点（**固定，不搜索**）：`cut = max(1, ceil(q × n))`，即升序排名 `1..cut` 为「Top q」。 */
export const RIGHT_TAIL_RULE_QUANTILE = 0.2;

export interface SelectionRuleSpec {
  readonly kind: RightTailRuleKind;
  readonly primary: RightTailFactorCode;
  readonly primaryDirection: RightTailRankingDirection;
  /** `CO_EXTREME_TOP20` / `EXCLUDE_TOP20` 的次因子。 */
  readonly secondary?: RightTailFactorCode;
  readonly secondaryDirection?: RightTailRankingDirection;
  readonly topK: number;
  /** 分位阈值；**默认 0.20，本实验不得改动**。 */
  readonly quantile?: number;
}

export interface RuleCandidateInput {
  readonly eventId: string;
  /** 该日该股票的因子原始值（`null` = 不可评估）。 */
  readonly factorValue: Readonly<Record<string, number | null>>;
  readonly randomKey: number;
}

export interface RuleSelectionResult {
  /** 通过全部过滤、保持**主因子排名顺序**的候选（= 规则的「实际可选池」）。 */
  readonly eligible: readonly string[];
  /** `eligible` 的前 `topK` 个。 */
  readonly picked: readonly string[];
  /** 当日主因子有效值候选数。 */
  readonly poolSize: number;
  /** 被次因子条件剔除的主因子候选数。 */
  readonly filteredOut: number;
  /** 次因子 `Top q` 的规模（无次因子时为 0）。 */
  readonly secondaryCut: number;
}

/**
 * 按规则在**单个决策日内**选股（纯函数、无 IO）。
 *
 * 🔴 **只在当日横截面内排名**，不使用任何跨日信息，无前视。
 * 🔴 主/次因子的缺失值（`null`）一律**不进排名**；`limitGap` 的 `null` 不是插补值。
 * 🔴 破平键固定 `ASC`（`eventId` 升序），与既有实验一致 —— **不使用 `RAND` 键**。
 */
export function selectByRule(args: {
  readonly day: readonly RuleCandidateInput[];
  readonly spec: SelectionRuleSpec;
}): RuleSelectionResult {
  const { spec } = args;
  const quantile = spec.quantile ?? RIGHT_TAIL_RULE_QUANTILE;

  const primaryScored: ScoredCandidate[] = [];
  const secondaryScored: ScoredCandidate[] = [];
  for (const candidate of args.day) {
    const primaryValue = candidate.factorValue[spec.primary];
    if (primaryValue !== null && primaryValue !== undefined && Number.isFinite(primaryValue)) {
      primaryScored.push({ eventId: candidate.eventId, value: primaryValue, randomKey: candidate.randomKey });
    }
    if (spec.secondary !== undefined) {
      const secondaryValue = candidate.factorValue[spec.secondary];
      if (secondaryValue !== null && secondaryValue !== undefined && Number.isFinite(secondaryValue)) {
        secondaryScored.push({ eventId: candidate.eventId, value: secondaryValue, randomKey: candidate.randomKey });
      }
    }
  }

  const primaryRanked = rankCandidates(primaryScored, spec.primaryDirection, "ASC");
  const poolSize = primaryRanked.length;

  if (spec.kind === "SINGLE" || spec.secondary === undefined || spec.secondaryDirection === undefined) {
    return {
      eligible: primaryRanked.map((c) => c.eventId),
      picked: primaryRanked.slice(0, spec.topK).map((c) => c.eventId),
      poolSize,
      filteredOut: 0,
      secondaryCut: 0,
    };
  }

  const secondaryRanked = rankCandidates(secondaryScored, spec.secondaryDirection, "ASC");
  const cut = Math.max(1, Math.ceil(quantile * secondaryRanked.length));
  const topSet = new Set(secondaryRanked.slice(0, cut).map((c) => c.eventId));

  const eligible =
    spec.kind === "CO_EXTREME_TOP20"
      ? primaryRanked.filter((c) => topSet.has(c.eventId))
      : primaryRanked.filter((c) => !topSet.has(c.eventId));

  return {
    eligible: eligible.map((c) => c.eventId),
    picked: eligible.slice(0, spec.topK).map((c) => c.eventId),
    poolSize,
    filteredOut: poolSize - eligible.length,
    secondaryCut: cut,
  };
}

/** 同日配对比较的原始输入（`a` = 规则臂，`b` = 对照臂）。 */
export interface PairedArmDay {
  readonly date: string;
  readonly aReturns: readonly number[];
  readonly bReturns: readonly number[];
}

export interface PairedArmDiff {
  readonly dayCount: number;
  /** `mean(a) − mean(b)` 的日等权均值 + 日簇区间。 */
  readonly meanDiff: ExcessEstimate;
  readonly medianDiff: ExcessEstimate;
  readonly tcr50Diff: ExcessEstimate;
  readonly tcr100Diff: ExcessEstimate;
}

/**
 * **同日配对**的两臂差值（规则 vs 其对应单因子）。
 *
 * 🔴 逐日先求差、再对日序列取日等权均值 + 日簇 Bootstrap。
 * 🔴 注意：两臂共享**同一天的同一个 All-Pool** ⇒
 * `ΔExcessMean ≡ ΔMean`（数学恒等）。本函数只输出 `ΔMean`，
 * 报告中如同时列出两者，须显式声明该恒等关系，不得当作两个独立证据。
 */
export function summarizePairedArms(args: {
  readonly days: readonly PairedArmDay[];
  readonly seed: number;
}): PairedArmDiff {
  const meanDays: { date: string; value: number }[] = [];
  const medianDays: { date: string; value: number }[] = [];
  const tcr50Days: { date: string; value: number }[] = [];
  const tcr100Days: { date: string; value: number }[] = [];

  for (const day of args.days) {
    if (day.aReturns.length === 0 || day.bReturns.length === 0) continue;
    const aMean = day.aReturns.reduce((s, v) => s + v, 0) / day.aReturns.length;
    const bMean = day.bReturns.reduce((s, v) => s + v, 0) / day.bReturns.length;
    const aMedian = quantileOf(day.aReturns, 0.5) ?? 0;
    const bMedian = quantileOf(day.bReturns, 0.5) ?? 0;
    const aT50 = day.aReturns.filter((v) => v >= 0.5).length / day.aReturns.length;
    const bT50 = day.bReturns.filter((v) => v >= 0.5).length / day.bReturns.length;
    const aT100 = day.aReturns.filter((v) => v >= 1).length / day.aReturns.length;
    const bT100 = day.bReturns.filter((v) => v >= 1).length / day.bReturns.length;
    meanDays.push({ date: day.date, value: aMean - bMean });
    medianDays.push({ date: day.date, value: aMedian - bMedian });
    tcr50Days.push({ date: day.date, value: aT50 - bT50 });
    tcr100Days.push({ date: day.date, value: aT100 - bT100 });
  }

  return {
    dayCount: meanDays.length,
    meanDiff: excessOf(meanDays, args.seed + 1),
    medianDiff: excessOf(medianDays, args.seed + 2),
    tcr50Diff: excessOf(tcr50Days, args.seed + 3),
    tcr100Diff: excessOf(tcr100Days, args.seed + 4),
  };
}

/**
 * **逐日均匀随机无放回 K 子集**（`RIGHT-TAIL-CROSS-SECTIONAL-EXCESS-001` 修正后的正确对照）。
 *
 * 🔴 **禁止**用 `rankCandidates(..., "RAND")` 当随机对照 —— 该 `key` 只是**同值破平键**，
 * 连续因子上它与 `ASC` 选出**完全相同**的集合（是复制，不是对照）。
 * 本函数在每个决策日内对当日池做与因子取值**无关**的均匀抽样。
 * 🔴 为保证逐日可复现，种子由 `seedOf("uniform-random", seedIndex, date)` 派生。
 */
export function pickUniformRandomSubset(args: {
  readonly eventIds: readonly string[];
  readonly topK: number;
  readonly seedIndex: number;
  readonly date: string;
}): readonly string[] {
  const n = args.eventIds.length;
  if (n === 0) return [];
  const random = mulberry32(seedOf("uniform-random", args.seedIndex, args.date));
  const index = Array.from({ length: n }, (_, i) => i);
  const k = Math.min(args.topK, n);
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(random() * (n - i));
    const swap = index[i]!;
    index[i] = index[j]!;
    index[j] = swap;
  }
  return index.slice(0, k).map((i) => args.eventIds[i]!);
}

// ---------------------------------------------------------------------------
// 九、`MEAN-FACTOR-RESEARCH-001`：**vs 同日随机 TopK**（固定 200 个种子）
// ---------------------------------------------------------------------------

/** 一个交易日的「随机 Top-K」参考统计量（对该日 `draws` 次独立均匀抽样取平均）。 */
export interface RandomTopKReferenceDay {
  readonly date: string;
  readonly poolSize: number;
  readonly draws: number;
  readonly mean: number;
  readonly median: number;
  readonly tcr20: number;
  readonly tcr50: number;
  readonly tcr100: number;
  readonly winRate: number;
  /** 左尾命中率：`P(return ≤ −10% / −20% / −30%)`。 */
  readonly loss10: number;
  readonly loss20: number;
  readonly loss30: number;
  /** 最差 5% / 10% 分位（越低越差）。 */
  readonly q05: number;
  readonly q10: number;
}

/**
 * 构建逐日「随机 Top-K」参考（`draws` 个**固定种子**的均匀无放回 K 子集，取其统计量的平均）。
 *
 * 🔴 参考**只依赖 `(day, topK)`**，与因子/方向无关 ⇒ **每个 (持有期, K) 只需构建一次并复用**。
 * 🔴 均匀随机 K 子集的均值/尾率是当日池的**无偏**估计 ⇒ 该参考在期望上等于当日池，
 * 200 次抽样仅用于压低 Monte-Carlo 噪声（**不是**第二套基线口径）。
 */
export function buildRandomTopKReference(args: {
  readonly days: readonly { readonly date: string; readonly returns: readonly number[] }[];
  readonly topK: number;
  readonly draws?: number;
  readonly seedBase: number;
  readonly thetas?: readonly number[];
}): RandomTopKReferenceDay[] {
  const draws = Math.max(1, Math.trunc(args.draws ?? 200));
  const thetas = args.thetas ?? [0.2, 0.5, 1];
  const [t20, t50, t100] = [thetas[0] ?? 0.2, thetas[1] ?? 0.5, thetas[2] ?? 1];
  const out: RandomTopKReferenceDay[] = [];
  for (const day of args.days) {
    if (day.returns.length === 0) continue;
    const ids = day.returns.map((_, index) => String(index));
    let sumMean = 0;
    let sumMedian = 0;
    let sum20 = 0;
    let sum50 = 0;
    let sum100 = 0;
    let sumWin = 0;
    let sumL10 = 0;
    let sumL20 = 0;
    let sumL30 = 0;
    let sumQ05 = 0;
    let sumQ10 = 0;
    for (let draw = 0; draw < draws; draw += 1) {
      const picked = pickUniformRandomSubset({ eventIds: ids, topK: args.topK, seedIndex: draw + args.seedBase, date: day.date });
      const values = picked.map((id) => day.returns[Number(id)]!);
      sumMean += values.reduce((s, v) => s + v, 0) / values.length;
      sumMedian += quantileOf(values, 0.5) ?? 0;
      sum20 += values.filter((v) => v >= t20).length / values.length;
      sum50 += values.filter((v) => v >= t50).length / values.length;
      sum100 += values.filter((v) => v >= t100).length / values.length;
      sumWin += values.filter((v) => v > 0).length / values.length;
      sumL10 += values.filter((v) => v <= -0.1).length / values.length;
      sumL20 += values.filter((v) => v <= -0.2).length / values.length;
      sumL30 += values.filter((v) => v <= -0.3).length / values.length;
      sumQ05 += quantileOf(values, 0.05) ?? 0;
      sumQ10 += quantileOf(values, 0.1) ?? 0;
    }
    out.push({
      date: day.date,
      poolSize: day.returns.length,
      draws,
      mean: sumMean / draws,
      median: sumMedian / draws,
      tcr20: sum20 / draws,
      tcr50: sum50 / draws,
      tcr100: sum100 / draws,
      winRate: sumWin / draws,
      loss10: sumL10 / draws,
      loss20: sumL20 / draws,
      loss30: sumL30 / draws,
      q05: sumQ05 / draws,
      q10: sumQ10 / draws,
    });
  }
  return out;
}

export interface AgainstRandomTopKDay {
  readonly date: string;
  readonly pickReturns: readonly number[];
  readonly reference: RandomTopKReferenceDay;
}

export interface AgainstRandomTopKResult {
  readonly dayCount: number;
  readonly pickCount: number;
  readonly pickMean: number | null;
  readonly pickMedian: number | null;
  readonly pickWinRate: number | null;
  readonly pickTcr20: number | null;
  readonly pickTcr50: number | null;
  readonly pickTcr100: number | null;
  readonly refMean: number | null;
  readonly refMedian: number | null;
  readonly refTcr20: number | null;
  readonly refTcr50: number | null;
  readonly refTcr100: number | null;
  /** 随机参考的日等权胜率（与 `pickWinRate` 口径对齐，供展示）。 */
  readonly refWinRate: number | null;
  /** 左尾绝对量（`P(return ≤ −10% / −20% / −30%)`、最差 5% / 10% 分位）。 */
  readonly pickLoss10: number | null;
  readonly pickLoss20: number | null;
  readonly pickLoss30: number | null;
  readonly pickQ05: number | null;
  readonly pickQ10: number | null;
  readonly refLoss10: number | null;
  readonly refLoss20: number | null;
  readonly refLoss30: number | null;
  readonly refQ05: number | null;
  readonly refQ10: number | null;
  /** `TopKMean − 同日随机 TopK Mean`（日等权）+ 日簇 95% CI。 */
  readonly excessMean: ExcessEstimate;
  readonly excessMedian: ExcessEstimate;
  readonly excessTcr20: ExcessEstimate;
  readonly excessTcr50: ExcessEstimate;
  readonly excessTcr100: ExcessEstimate;
  /** 左尾超额（**正 = 比随机更差**，`excessQ05/Q10` 正 = 比随机更好）。 */
  readonly excessWinRate: ExcessEstimate;
  readonly excessLoss10: ExcessEstimate;
  readonly excessLoss20: ExcessEstimate;
  readonly excessLoss30: ExcessEstimate;
  readonly excessQ05: ExcessEstimate;
  readonly excessQ10: ExcessEstimate;
  /** `THR(Top-K) / THR(随机 Top-K)` 的池化比值 + 日簇区间。 */
  readonly lift: LiftEstimate;
}

/**
 * 与**同日随机 TopK** 的配对比较（`MEAN-FACTOR-RESEARCH-001` 的核心指标口径）。
 *
 * 🔴 逐日先配对求差（`TopK − 随机 TopK`），再对日序列取日等权均值 + 日簇 Moving-Block Bootstrap。
 * 🔴 只有 `excessMean` 与 `excessTcr50` 给区间（任务要求）；其余为点估计。
 * 🔴 比值型 `lift` 复用既有 `bootstrapLift`：把「随机 TopK」当作比值分母臂
 * （每日分母规模 = 当日实际入选数，尾部计数 = `refTcr50 × 入选数`）—— 这是**比值型区间**，
 * 不是第二套 Lift 口径。
 */
export function summarizeAgainstRandomTopK(args: {
  readonly days: readonly AgainstRandomTopKDay[];
  readonly seed: number;
}): AgainstRandomTopKResult {
  const excessMeanDays: { date: string; value: number }[] = [];
  const excessMedianDays: { date: string; value: number }[] = [];
  const excess20Days: { date: string; value: number }[] = [];
  const excess50Days: { date: string; value: number }[] = [];
  const excess100Days: { date: string; value: number }[] = [];
  const excessWinDays: { date: string; value: number }[] = [];
  const excessL10Days: { date: string; value: number }[] = [];
  const excessL20Days: { date: string; value: number }[] = [];
  const excessL30Days: { date: string; value: number }[] = [];
  const excessQ05Days: { date: string; value: number }[] = [];
  const excessQ10Days: { date: string; value: number }[] = [];
  const pickedByDay: { date: string; picked: number; tailPicked: number }[] = [];
  const refAsPool: RandomBaselineDay[] = [];

  const allPick: number[] = [];
  let pickMedianSum = 0;
  let refMeanSum = 0;
  let refMedianSum = 0;
  let ref20Sum = 0;
  let ref50Sum = 0;
  let ref100Sum = 0;
  let refWinSum = 0;
  let refL10Sum = 0;
  let refL20Sum = 0;
  let refL30Sum = 0;
  let refQ05Sum = 0;
  let refQ10Sum = 0;
  let pick20 = 0;
  let pick50 = 0;
  let pick100 = 0;
  let pickWin = 0;
  let pickL10Sum = 0;
  let pickL20Sum = 0;
  let pickL30Sum = 0;
  let pickQ05Sum = 0;
  let pickQ10Sum = 0;

  for (const day of args.days) {
    if (day.pickReturns.length === 0) continue;
    const pickMean = day.pickReturns.reduce((s, v) => s + v, 0) / day.pickReturns.length;
    const pickMedian = quantileOf(day.pickReturns, 0.5) ?? 0;
    const p20 = day.pickReturns.filter((v) => v >= 0.2).length / day.pickReturns.length;
    const p50 = day.pickReturns.filter((v) => v >= 0.5).length / day.pickReturns.length;
    const p100 = day.pickReturns.filter((v) => v >= 1).length / day.pickReturns.length;
    const pWin = day.pickReturns.filter((v) => v > 0).length / day.pickReturns.length;
    const l10 = day.pickReturns.filter((v) => v <= -0.1).length / day.pickReturns.length;
    const l20 = day.pickReturns.filter((v) => v <= -0.2).length / day.pickReturns.length;
    const l30 = day.pickReturns.filter((v) => v <= -0.3).length / day.pickReturns.length;
    const pickQ05 = quantileOf(day.pickReturns, 0.05) ?? 0;
    const pickQ10 = quantileOf(day.pickReturns, 0.1) ?? 0;

    allPick.push(...day.pickReturns);
    pickMedianSum += pickMedian;
    refMeanSum += day.reference.mean;
    refMedianSum += day.reference.median;
    ref20Sum += day.reference.tcr20;
    ref50Sum += day.reference.tcr50;
    ref100Sum += day.reference.tcr100;
    refWinSum += day.reference.winRate;
    refL10Sum += day.reference.loss10;
    refL20Sum += day.reference.loss20;
    refL30Sum += day.reference.loss30;
    refQ05Sum += day.reference.q05;
    refQ10Sum += day.reference.q10;
    pick20 += day.pickReturns.filter((v) => v >= 0.2).length;
    pick50 += day.pickReturns.filter((v) => v >= 0.5).length;
    pick100 += day.pickReturns.filter((v) => v >= 1).length;
    pickWin += day.pickReturns.filter((v) => v > 0).length;
    pickL10Sum += l10;
    pickL20Sum += l20;
    pickL30Sum += l30;
    pickQ05Sum += pickQ05;
    pickQ10Sum += pickQ10;

    excessMeanDays.push({ date: day.date, value: pickMean - day.reference.mean });
    excessMedianDays.push({ date: day.date, value: pickMedian - day.reference.median });
    excess20Days.push({ date: day.date, value: p20 - day.reference.tcr20 });
    excess50Days.push({ date: day.date, value: p50 - day.reference.tcr50 });
    excess100Days.push({ date: day.date, value: p100 - day.reference.tcr100 });
    excessWinDays.push({ date: day.date, value: pWin - day.reference.winRate });
    excessL10Days.push({ date: day.date, value: l10 - day.reference.loss10 });
    excessL20Days.push({ date: day.date, value: l20 - day.reference.loss20 });
    excessL30Days.push({ date: day.date, value: l30 - day.reference.loss30 });
    excessQ05Days.push({ date: day.date, value: pickQ05 - day.reference.q05 });
    excessQ10Days.push({ date: day.date, value: pickQ10 - day.reference.q10 });

    const picked = day.pickReturns.length;
    pickedByDay.push({ date: day.date, picked, tailPicked: day.pickReturns.filter((v) => v >= 0.5).length });
    refAsPool.push({ date: day.date, poolSize: picked, tailCount: day.reference.tcr50 * picked });
  }

  const dayCount = excessMeanDays.length;
  const div = dayCount === 0 ? 1 : dayCount;
  return {
    dayCount,
    pickCount: allPick.length,
    pickMean: meanOf(allPick),
    pickMedian: dayCount === 0 ? null : pickMedianSum / div,
    pickWinRate: allPick.length === 0 ? null : allPick.filter((v) => v > 0).length / allPick.length,
    pickTcr20: allPick.length === 0 ? null : pick20 / allPick.length,
    pickTcr50: allPick.length === 0 ? null : pick50 / allPick.length,
    pickTcr100: allPick.length === 0 ? null : pick100 / allPick.length,
    refMean: dayCount === 0 ? null : refMeanSum / div,
    refMedian: dayCount === 0 ? null : refMedianSum / div,
    refTcr20: dayCount === 0 ? null : ref20Sum / div,
    refTcr50: dayCount === 0 ? null : ref50Sum / div,
    refTcr100: dayCount === 0 ? null : ref100Sum / div,
    refWinRate: dayCount === 0 ? null : refWinSum / div,
    pickLoss10: dayCount === 0 ? null : pickL10Sum / div,
    pickLoss20: dayCount === 0 ? null : pickL20Sum / div,
    pickLoss30: dayCount === 0 ? null : pickL30Sum / div,
    pickQ05: dayCount === 0 ? null : pickQ05Sum / div,
    pickQ10: dayCount === 0 ? null : pickQ10Sum / div,
    refLoss10: dayCount === 0 ? null : refL10Sum / div,
    refLoss20: dayCount === 0 ? null : refL20Sum / div,
    refLoss30: dayCount === 0 ? null : refL30Sum / div,
    refQ05: dayCount === 0 ? null : refQ05Sum / div,
    refQ10: dayCount === 0 ? null : refQ10Sum / div,
    excessMean: excessOf(excessMeanDays, args.seed + 1),
    excessMedian: excessOf(excessMedianDays, args.seed + 2),
    excessTcr20: excessOf(excess20Days, args.seed + 3),
    excessTcr50: excessOf(excess50Days, args.seed + 4),
    excessTcr100: excessOf(excess100Days, args.seed + 5),
    excessWinRate: excessOf(excessWinDays, args.seed + 6),
    excessLoss10: excessOf(excessL10Days, args.seed + 7),
    excessLoss20: excessOf(excessL20Days, args.seed + 8),
    excessLoss30: excessOf(excessL30Days, args.seed + 9),
    excessQ05: excessOf(excessQ05Days, args.seed + 10),
    excessQ10: excessOf(excessQ10Days, args.seed + 11),
    lift: bootstrapLift({
      pickedByDay,
      poolByDay: refAsPool,
      iterations: RIGHT_TAIL_BOOTSTRAP_ITERATIONS,
      blockLength: RIGHT_TAIL_BOOTSTRAP_BLOCK_DAYS,
      seed: args.seed + 6,
    }),
  };
}
