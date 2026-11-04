/**
 * STEP 18 / C-18.2 — 确定性 seedable PRNG + 抽样核（纯函数、无 Math.random）。
 *
 * 实现说明（纪律：不跨模块 import 私有实现）：
 *   - 与 C-17.1 `parameterSearch/prng.ts` 同为 **mulberry32 标准算法**的目录内
 *     自实现（同 seed 必得同序列，IEEE-754 double 运算确定性）。此处不 import 其
 *     私有模块，避免跨目录耦合；全部顶层符号带 `Stochastic` 域前缀，避免与
 *     `parameterSearch` 导出（`createMulberry32` / `nextRandomInt` /
 *     `sampleDistinctInts` / `RandomGenerator`）在统一出口 barrel 冲突。
 *
 * 抽样核（MC / Bootstrap / Trade Order 共用，见 types.ts 头注释的方法学声明）：
 *   - `resampleStochasticIndexesWithReplacement`：有放回重抽样（长度 = n），
 *     Monte Carlo 与 Bootstrap 共用同一核；
 *   - `permuteStochasticIndexes`：无放回置换（Fisher–Yates 自上而下），
 *     Trade Order Randomization 专用。
 *
 * 铁律：纯函数、无 IO / Date.now / Math.random；state 由闭包持有，仅随调用推进。
 */

/** 随机源：每次调用返回 [0, 1) 的确定性伪随机数。 */
export type StochasticRandomGenerator = () => number;

/**
 * 构造 mulberry32 PRNG。
 * seed 先无符号化（允许任意 32 位内整数；超出自动 >>>0 折叠，确定性不受影响）。
 */
export function createStochasticPrng(seed: number): StochasticRandomGenerator {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从 PRNG 取 [0, upper) 均匀整数（upper >= 1）。 */
export function stochasticRandomInt(rng: StochasticRandomGenerator, upper: number): number {
  if (!Number.isInteger(upper) || upper < 1) {
    throw new Error(`stochasticRandomInt: upper 必须是 >= 1 的整数，实际 ${String(upper)}`);
  }
  return Math.floor(rng() * upper);
}

/**
 * 有放回均匀抽取 n 个下标（每个独立取自 [0, n)），长度 = n。
 * Monte Carlo / Bootstrap 共用核（i.i.d. 重抽样）。
 */
export function resampleStochasticIndexesWithReplacement(
  rng: StochasticRandomGenerator,
  n: number,
): number[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`resampleStochasticIndexesWithReplacement: n 必须是 >= 1 的整数，实际 ${String(n)}`);
  }
  const draws: number[] = [];
  for (let i = 0; i < n; i += 1) {
    draws.push(stochasticRandomInt(rng, n));
  }
  return draws;
}

/**
 * 生成 0..n-1 的一个随机排列（Fisher–Yates 自上而下，n >= 1）。
 * Trade Order Randomization 专用：保持「集合不变、顺序改变」。
 */
export function permuteStochasticIndexes(rng: StochasticRandomGenerator, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`permuteStochasticIndexes: n 必须是 >= 1 的整数，实际 ${String(n)}`);
  }
  const order: number[] = [];
  for (let i = 0; i < n; i += 1) order.push(i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = stochasticRandomInt(rng, i + 1);
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  return order;
}
