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
    low: quantile(means, 0.025),
    high: quantile(means, 0.975),
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
}): MovingBlockBootstrapResult | null {
  const positive = clusterize(args.positive);
  const negative = clusterize(args.negative);
  if (!positive || !negative) return null;

  const iterations = Math.max(100, Math.trunc(args.iterations ?? 1_000));
  const blockLength = Math.max(1, Math.trunc(args.blockLength ?? 20));
  const seed = args.seed ?? 20_260_922;
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
    low: quantile(differences, 0.025),
    high: quantile(differences, 0.975),
    iterations,
    blockLength,
    clusterCount: Math.min(positive.dates.length, negative.dates.length),
    seed,
  };
}
