export interface DateClusterValue {
  eventDate: string;
  value: number;
}

export interface MovingBlockBootstrapResult {
  low: number;
  high: number;
  iterations: number;
  blockLength: number;
  clusterCount: number;
  seed: number;
}

/**
 * 区间分位点（**可选**，缺省 = 既有 95% 双侧）。
 *
 * 🔴 为什么加它：`FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` 规定两条**预声明主臂**
 *    用 Bonferroni 同时区间 ⇒ 每臂需要 **97.5% 双侧**（`0.0125` / `0.9875`）。
 *    既有实现的 `0.025` / `0.975` 是**写死**的。按规格 §5.2「复用统计原语，
 *    若不支持置信水平做最小有测试的扩展，**不复制第二套统计实现**」，
 *    这里只加一个**有缺省值**的可选参数：不传时与既有行为逐字节相同
 *    （既有 22 个已注册实验的 Bootstrap 数字不发生任何漂移）。
 */
export interface BootstrapQuantiles {
  readonly low: number;
  readonly high: number;
}

/** 缺省分位点 = 既有 95% 双侧区间（改动即为行为变更，禁止）。 */
export const DEFAULT_BOOTSTRAP_QUANTILES: BootstrapQuantiles = Object.freeze({
  low: 0.025,
  high: 0.975,
});

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

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/**
 * Moving-block date cluster bootstrap for a mean.
 *
 * All event values on the same trade date remain together; consecutive trade dates
 * are resampled in blocks so overlapping forward-return windows are not treated as
 * independent observations.
 */
export function movingBlockBootstrapMean(args: {
  samples: readonly DateClusterValue[];
  iterations?: number;
  blockLength?: number;
  seed?: number;
  quantiles?: BootstrapQuantiles;
}): MovingBlockBootstrapResult | null {
  const byDate = new Map<string, { sum: number; count: number }>();
  for (const sample of args.samples) {
    const current = byDate.get(sample.eventDate) ?? { sum: 0, count: 0 };
    current.sum += sample.value;
    current.count += 1;
    byDate.set(sample.eventDate, current);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return null;

  const iterations = Math.max(100, Math.trunc(args.iterations ?? 1_000));
  const blockLength = Math.max(1, Math.trunc(args.blockLength ?? 20));
  const seed = args.seed ?? 20_260_922;
  const quantiles = args.quantiles ?? DEFAULT_BOOTSTRAP_QUANTILES;
  const random = mulberry32(seed);
  const means: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    let count = 0;
    let sampledClusters = 0;
    while (sampledClusters < dates.length) {
      const start = Math.floor(random() * dates.length);
      for (
        let offset = 0;
        offset < blockLength && sampledClusters < dates.length;
        offset += 1
      ) {
        const date = dates[(start + offset) % dates.length]!;
        const aggregate = byDate.get(date)!;
        sum += aggregate.sum;
        count += aggregate.count;
        sampledClusters += 1;
      }
    }
    means.push(sum / count);
  }
  means.sort((a, b) => a - b);
  return {
    low: quantile(means, quantiles.low),
    high: quantile(means, quantiles.high),
    iterations,
    blockLength,
    clusterCount: dates.length,
    seed,
  };
}

interface DateClusters {
  dates: readonly string[];
  byDate: ReadonlyMap<string, { sum: number; count: number }>;
}

/**
 * 把事件聚到交易日上（同一天的事件不拆开）。
 *
 * 刻意与 `movingBlockBootstrapMean` 内部保持同样的聚合动作、不从那边抽公共函数，
 * 避免改动既有实现后 22 个已注册实验的 Bootstrap 数字发生静默漂移。
 */
function clusterize(samples: readonly DateClusterValue[]): DateClusters | null {
  const byDate = new Map<string, { sum: number; count: number }>();
  for (const sample of samples) {
    const current = byDate.get(sample.eventDate) ?? { sum: 0, count: 0 };
    current.sum += sample.value;
    current.count += 1;
    byDate.set(sample.eventDate, current);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return null;
  return { dates, byDate };
}

function resampleMean(
  clusters: DateClusters,
  random: () => number,
  blockLength: number
): number {
  const total = clusters.dates.length;
  let sum = 0;
  let count = 0;
  let sampledClusters = 0;
  while (sampledClusters < total) {
    const start = Math.floor(random() * total);
    for (
      let offset = 0;
      offset < blockLength && sampledClusters < total;
      offset += 1
    ) {
      const aggregate = clusters.byDate.get(
        clusters.dates[(start + offset) % total]!
      )!;
      sum += aggregate.sum;
      count += aggregate.count;
      sampledClusters += 1;
    }
  }
  return sum / count;
}

/**
 * Moving-block date cluster bootstrap for a **difference of two means**.
 *
 * 两个臂各自独立重采样交易日块，逐次迭代计算 `mean(positive) − mean(negative)`。
 * 用于「头部档 − 尾部档」「最优桶 − 最差桶」这类对比的区间估计 ——
 * 这类差值**不能**由两个边际 CI 相减得到，必须单独重采样。
 */
export function movingBlockBootstrapDifference(args: {
  positive: readonly DateClusterValue[];
  negative: readonly DateClusterValue[];
  iterations?: number;
  blockLength?: number;
  seed?: number;
  quantiles?: BootstrapQuantiles;
}): MovingBlockBootstrapResult | null {
  const positive = clusterize(args.positive);
  const negative = clusterize(args.negative);
  if (!positive || !negative) return null;

  const iterations = Math.max(100, Math.trunc(args.iterations ?? 1_000));
  const blockLength = Math.max(1, Math.trunc(args.blockLength ?? 20));
  const seed = args.seed ?? 20_260_922;
  const quantiles = args.quantiles ?? DEFAULT_BOOTSTRAP_QUANTILES;
  const random = mulberry32(seed);
  const differences: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    differences.push(
      resampleMean(positive, random, blockLength) -
        resampleMean(negative, random, blockLength)
    );
  }
  differences.sort((a, b) => a - b);
  return {
    low: quantile(differences, quantiles.low),
    high: quantile(differences, quantiles.high),
    iterations,
    blockLength,
    clusterCount: Math.min(positive.dates.length, negative.dates.length),
    seed,
  };
}

// ---------------------------------------------------------------------------
// 配对（paired）日期聚类移动块 bootstrap —— `OBSERVATION-WINDOW-003` 新增
//
// 🔴 与上面 `movingBlockBootstrapDifference` 的**根本差别**：后者两个臂各自独立
//    抽样（各画各的块起点），本节的配对版本每轮迭代**只抽一次**块索引序列，
//    同一条序列**同步**索引所有比较臂的**分子（hits）/ 分母（completed）/
//    收益和（sumReturn）**。既有函数的语义与数字保持逐字节不变。
// ---------------------------------------------------------------------------

/** 单个「臂 × 交易日」的聚类观测（分子/分母同时被重采样）。 */
export interface PairedClusterObservation {
  /** 聚类键 = 真实入场交易日（YYYY-MM-DD）。 */
  readonly date: string;
  /** 分子：该日完成的 ≥阈值命中笔数。 */
  readonly hits: number;
  /** 分母：该日完成的交易笔数。 */
  readonly completed: number;
  /** 该日已完成交易的净收益之和（用于均值型配对差）。 */
  readonly sumReturn: number;
}

export interface PairedBootstrapResult {
  readonly pointEstimate: number;
  readonly low: number;
  readonly high: number;
  readonly iterations: number;
  readonly blockLength: number;
  readonly clusterCount: number;
  readonly seed: number;
  /** 🔴 必须回写实际使用的分位，使置信水平**自证**（旧函数缺这个字段）。 */
  readonly quantiles: BootstrapQuantiles;
  /** 重采样后**分母为 0** 的迭代次数（必须单列，不得静默丢弃）。 */
  readonly zeroDenominatorIterations: number;
  /** 参与共同抽样的交易日总数（= calendar 长度）。 */
  readonly calendarLength: number;
  /** 日期不在 `calendar` 内而被忽略的观测条数（不得静默丢弃）。 */
  readonly ignoredObservationCount: number;
}

/** 单臂在一个交易日索引上的聚合（分子/分母/收益和一体）。 */
interface PairedArmAggregate {
  hits: number;
  completed: number;
  sumReturn: number;
}

interface PairedArmClusterized {
  /** 交易日索引 → 该臂在该日的聚合。 */
  readonly byIndex: ReadonlyMap<number, PairedArmAggregate>;
  /** 未抽样（全量数据）口径的合计。 */
  readonly totals: PairedArmAggregate;
  /** 该臂有观测的交易日索引集合（用于 clusterCount 的并集口径）。 */
  readonly clusterIndexes: ReadonlySet<number>;
  /** 日期不在 calendar 内的观测条数。 */
  readonly ignored: number;
}

/** 有效迭代（两臂分母均 > 0）不足此数 ⇒ 区间不可信，返回 `null`。 */
const PAIRED_BOOTSTRAP_MIN_VALID_ITERATIONS = 50;

/**
 * 把单臂观测聚合到 **calendar 索引**上；日期不在 calendar 内的观测被忽略并计数
 * （与 `clusterize` 不同：聚类键是完整日历的位置，而不是观测里出现过的日期）。
 */
function clusterizePairedArm(
  observations: readonly PairedClusterObservation[],
  indexByDate: ReadonlyMap<string, number>
): PairedArmClusterized {
  const byIndex = new Map<number, PairedArmAggregate>();
  const totals: PairedArmAggregate = { hits: 0, completed: 0, sumReturn: 0 };
  let ignored = 0;
  for (const observation of observations) {
    const index = indexByDate.get(observation.date);
    if (index === undefined) {
      ignored += 1;
      continue;
    }
    const current = byIndex.get(index) ?? { hits: 0, completed: 0, sumReturn: 0 };
    current.hits += observation.hits;
    current.completed += observation.completed;
    current.sumReturn += observation.sumReturn;
    byIndex.set(index, current);
    totals.hits += observation.hits;
    totals.completed += observation.completed;
    totals.sumReturn += observation.sumReturn;
  }
  return { byIndex, totals, clusterIndexes: new Set(byIndex.keys()), ignored };
}

/**
 * 配对日期移动块 bootstrap 的公共核心（两个导出函数只差一个分子选择器）。
 *
 * 算法（`OBSERVATION-WINDOW-003` 规格）：
 * 1. 由 `calendar` 建日期 → 索引表；`calendar` 为空、或 `compare` 两个臂名在
 *    `arms` 里缺失 ⇒ `null`。
 * 2. 每臂聚合成 `Map<交易日索引, {hits, completed, sumReturn}>`；日期不在
 *    `calendar` 内的观测被忽略并计入 `ignoredObservationCount`。
 * 3. 每轮迭代**只抽一次**块起点序列（起点在 `[0, calendar.length)` 上均匀，
 *    取 `blockLength` 个**环绕**连续索引，累计到 `calendar.length` 个聚类为止），
 *    同一条序列**同步**索引两个臂的分子与分母。
 * 4. 任一侧累计 `completed === 0` ⇒ `zeroDenominatorIterations += 1` 并**跳过**
 *    （不推入值，也不静默丢弃计数）。
 * 5. `delta = 分子(A)/分母(A) − 分子(B)/分母(B)`。
 * 6. `pointEstimate` **不是**迭代均值，而是同一统计量在**未抽样全量数据**上的取值。
 * 7. 区间 = 有效 delta 排序后复用本文件既有 `quantile()` 取 `quantiles.low/high`；
 *    有效迭代 < 50 ⇒ `null`。
 * 8. 确定性：复用本文件既有 `mulberry32`，绝不使用 `Math.random`。
 */
function pairedBootstrapCore(
  args: {
    readonly calendar: readonly string[];
    readonly arms: Readonly<Record<string, readonly PairedClusterObservation[]>>;
    readonly compare: readonly [string, string];
    readonly iterations?: number;
    readonly blockLength?: number;
    readonly seed?: number;
    readonly quantiles?: BootstrapQuantiles;
  },
  numerator: (aggregate: PairedArmAggregate) => number
): PairedBootstrapResult | null {
  if (args.calendar.length === 0) return null;
  const leftName = args.compare[0];
  const rightName = args.compare[1];
  if (leftName === undefined || rightName === undefined) return null;
  const leftObservations = args.arms[leftName];
  const rightObservations = args.arms[rightName];
  if (!leftObservations || !rightObservations) return null;

  const indexByDate = new Map<string, number>();
  for (let index = 0; index < args.calendar.length; index += 1) {
    const date = args.calendar[index]!;
    if (!indexByDate.has(date)) indexByDate.set(date, index);
  }
  const calendarLength = args.calendar.length;

  const left = clusterizePairedArm(leftObservations, indexByDate);
  const right = clusterizePairedArm(rightObservations, indexByDate);
  if (left.totals.completed <= 0 || right.totals.completed <= 0) return null;

  const iterations = Math.max(100, Math.trunc(args.iterations ?? 1_000));
  const blockLength = Math.max(1, Math.trunc(args.blockLength ?? 20));
  const seed = args.seed ?? 20_260_922;
  const quantiles = args.quantiles ?? DEFAULT_BOOTSTRAP_QUANTILES;
  const random = mulberry32(seed);

  const ratio = (aggregate: PairedArmAggregate): number =>
    numerator(aggregate) / aggregate.completed;
  const pointEstimate = ratio(left.totals) - ratio(right.totals);

  const deltas: number[] = [];
  let zeroDenominatorIterations = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let leftHits = 0;
    let leftCompleted = 0;
    let leftSumReturn = 0;
    let rightHits = 0;
    let rightCompleted = 0;
    let rightSumReturn = 0;
    let sampledClusters = 0;
    while (sampledClusters < calendarLength) {
      const start = Math.floor(random() * calendarLength);
      for (
        let offset = 0;
        offset < blockLength && sampledClusters < calendarLength;
        offset += 1
      ) {
        const index = (start + offset) % calendarLength;
        const leftAt = left.byIndex.get(index);
        if (leftAt) {
          leftHits += leftAt.hits;
          leftCompleted += leftAt.completed;
          leftSumReturn += leftAt.sumReturn;
        }
        const rightAt = right.byIndex.get(index);
        if (rightAt) {
          rightHits += rightAt.hits;
          rightCompleted += rightAt.completed;
          rightSumReturn += rightAt.sumReturn;
        }
        sampledClusters += 1;
      }
    }
    if (leftCompleted === 0 || rightCompleted === 0) {
      zeroDenominatorIterations += 1;
      continue;
    }
    deltas.push(
      numerator({ hits: leftHits, completed: leftCompleted, sumReturn: leftSumReturn }) /
        leftCompleted -
        numerator({
          hits: rightHits,
          completed: rightCompleted,
          sumReturn: rightSumReturn,
        }) /
          rightCompleted
    );
  }

  if (deltas.length < PAIRED_BOOTSTRAP_MIN_VALID_ITERATIONS) return null;
  deltas.sort((a, b) => a - b);

  const unionIndexes = new Set<number>(left.clusterIndexes);
  for (const index of right.clusterIndexes) unionIndexes.add(index);

  return {
    pointEstimate,
    low: quantile(deltas, quantiles.low),
    high: quantile(deltas, quantiles.high),
    iterations,
    blockLength,
    clusterCount: unionIndexes.size,
    seed,
    quantiles,
    zeroDenominatorIterations,
    calendarLength,
    ignoredObservationCount: left.ignored + right.ignored,
  };
}

/**
 * 配对日期移动块 bootstrap：**同一次块索引抽样**下，各臂的分子与分母同步重采样。
 * `compare` 给出 [A, B]，点估计与区间均为 A − B。
 *
 * 点估计 = `hits(A)/completed(A) − hits(B)/completed(B)`，在**未抽样的全量数据**上
 * 直接计算（**不是**迭代均值）；区间 = 各轮迭代 delta 的 `quantiles.low/high`
 * 分位（复用本文件既有 `quantile()`），因此 `quantiles` 会原样回写到结果里。
 *
 * 返回 `null`：`calendar` 为空 · `compare` 臂名缺失 · 任一侧全量 `completed <= 0` ·
 * 有效迭代（两侧分母均 > 0）< 50。
 */
export function movingBlockBootstrapPairedRatioDifference(args: {
  readonly calendar: readonly string[];
  readonly arms: Readonly<Record<string, readonly PairedClusterObservation[]>>;
  readonly compare: readonly [string, string];
  readonly iterations?: number;
  readonly blockLength?: number;
  readonly seed?: number;
  readonly quantiles?: BootstrapQuantiles;
}): PairedBootstrapResult | null {
  return pairedBootstrapCore(args, (aggregate) => aggregate.hits);
}

/**
 * 同上，但比较「已完成交易净收益均值」之差（分子 `sumReturn` / 分母 `completed`）。
 *
 * 点估计 = `sumReturn(A)/completed(A) − sumReturn(B)/completed(B)`，同样在**未抽样的
 * 全量数据**上计算；区间与 `zeroDenominatorIterations` 语义与
 * `movingBlockBootstrapPairedRatioDifference` 完全一致。
 */
export function movingBlockBootstrapPairedMeanDifference(args: {
  readonly calendar: readonly string[];
  readonly arms: Readonly<Record<string, readonly PairedClusterObservation[]>>;
  readonly compare: readonly [string, string];
  readonly iterations?: number;
  readonly blockLength?: number;
  readonly seed?: number;
  readonly quantiles?: BootstrapQuantiles;
}): PairedBootstrapResult | null {
  return pairedBootstrapCore(args, (aggregate) => aggregate.sumReturn);
}
