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
