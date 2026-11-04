/**
 * STEP 17 / C-17.1 — 确定性 seedable PRNG（mulberry32）。
 *
 * 项目既有实现参考：server/historicalState/audit/db.ts 内私有 mulberry32（同标准算法）。
 * 该实现为模块私有，按纪律不在跨模块 import 私有函数；本文件在自目录内以纯函数形式
 * 提供同一确定性 PRNG（同 seed 必得同序列），供 random sampler 使用。
 *
 * 确定性语义：
 *   - 同 seed 构造的 PRNG 调用序列完全一致（IEEE-754 double 运算，确定性）；
 *   - 搜索器只需同 seed + 同参数空间 → 同采样结果（与运行平台无关的运算顺序）。
 *
 * 铁律：纯函数、无 IO / Date.now / Math.random；state 由闭包持有，仅随调用推进。
 */

/** mulberry32 生成器：每次调用返回 [0, 1) 的确定性伪随机数。 */
export type RandomGenerator = () => number;

/**
 * 构造 mulberry32 PRNG（seed 先无符号化，允许任意 32 位内整数 seed；
 * 超出 32 位自动 >>>0 折叠，确定性不受影响）。
 */
export function createMulberry32(seed: number): RandomGenerator {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从 PRNG 取 [0, upper) 均匀整数（upper >= 1）。
 * 基于 r ∈ [0,1) 的 floor(r × upper) 缩放。存在极小的浮点缩放偏置（研究采样可接受，
 * 非加密用途）；同 seed 确定性不受影响。
 */
export function nextRandomInt(rng: RandomGenerator, upper: number): number {
  if (!Number.isInteger(upper) || upper < 1) {
    throw new Error(`nextRandomInt: upper 必须是 >= 1 的整数，实际 ${String(upper)}`);
  }
  return Math.floor(rng() * upper);
}

/**
 * 从 [0, n) 无放回均匀抽取 k 个不同整数（Floyd's algorithm）。
 * 算法确定性、O(k) 时间/内存；k = min(budget, n) 由调用方保证 <= n。
 * 返回升序数组（顺序稳定，便于记录）。
 */
export function sampleDistinctInts(
  rng: RandomGenerator,
  n: number,
  k: number,
): number[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`sampleDistinctInts: n 必须是 >= 1 的整数，实际 ${String(n)}`);
  }
  if (!Number.isInteger(k) || k < 0) {
    throw new Error(`sampleDistinctInts: k 必须是 >= 0 的整数，实际 ${String(k)}`);
  }
  if (k > n) {
    throw new Error(`sampleDistinctInts: k(${k}) 不能大于 n(${n})`);
  }
  if (k === 0) return [];

  const selected = new Set<number>();
  for (let j = n - k; j < n; j++) {
    const t = nextRandomInt(rng, j + 1);
    if (selected.has(t)) {
      selected.add(j);
    } else {
      selected.add(t);
    }
  }
  return Array.from(selected).sort((left, right) => left - right);
}
