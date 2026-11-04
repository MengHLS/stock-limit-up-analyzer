/**
 * STEP 18 / C-18.2 — 样本生成核（Monte Carlo / Bootstrap / Trade Order 共用）。
 *
 * 两种抽样形态（对应统计口径差异，见 types.ts 头注释）：
 *   - 有放回重抽样（长度 = n）：Monte Carlo 与 Bootstrap **共用同一核**（i.i.d.
 *     resampling），差异在结论焦点（MC 重分布位置与尾部概率、Bootstrap 重置信区间
 *     与描述性显著性），不是两套算法重复实现；
 *   - 无放回置换：Trade Order Randomization 专用，保持交易集合不变、只改顺序。
 *
 * 确定性语义：给定 (seed, iterations, source) 必得同一批样本——单条 PRNG 流按
 * 迭代顺序推进（不在每次迭代重建 PRNG，否则不同迭代会拿到相同子序列）。
 *
 * 铁律：纯函数、无 IO / Date.now / Math.random；序列合法性由调用方先行校验
 * （run.ts 在生成前调用 validateStochasticSeries），本层对退化长度直接抛错。
 */

import {
  createStochasticPrng,
  permuteStochasticIndexes,
  resampleStochasticIndexesWithReplacement,
} from "./prng";
import type { StochasticMethod, StochasticSourceKind, StochasticSpecimen } from "./types";

/** 样本生成输入。 */
export interface StochasticSpecimenInput {
  readonly seed: number;
  /** 迭代次数（>= 1）。 */
  readonly iterations: number;
  /** 源序列（逐步收益，小数）。 */
  readonly source: readonly number[];
  readonly sourceKind: StochasticSourceKind;
  readonly method: StochasticMethod;
  /** 成交笔数回显（写进 specimen，供 evaluator 使用）。 */
  readonly tradeCount: number | null;
}

function assertUsableSource(source: readonly number[], iterations: number): void {
  if (!Array.isArray(source)) {
    throw new Error("generateStochastic*Specimens: source 必须是数组");
  }
  if (source.length < 2) {
    throw new Error(
      `generateStochastic*Specimens: source 长度 ${source.length} < 2（拒绝为退化序列生成样本）`
    );
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(
      `generateStochastic*Specimens: iterations 必须是 >= 1 的整数，实际 ${String(iterations)}`
    );
  }
}

function toSpecimen(
  input: StochasticSpecimenInput,
  iteration: number,
  drawIndexes: readonly number[]
): StochasticSpecimen {
  const stepReturns: number[] = [];
  for (const index of drawIndexes) {
    stepReturns.push(input.source[index]!);
  }
  return {
    iteration,
    method: input.method,
    stepReturns,
    drawIndexes,
    tradeCount: input.tradeCount,
  };
}

/**
 * 有放回重抽样样本（i.i.d. resample，长度 = 源序列长度）。
 * Monte Carlo（dailyReturn / tradeReturn）与 Bootstrap（tradeReturn）共用。
 */
export function generateStochasticResampleSpecimens(
  input: StochasticSpecimenInput
): readonly StochasticSpecimen[] {
  assertUsableSource(input.source, input.iterations);
  const rng = createStochasticPrng(input.seed);
  const n = input.source.length;
  const specimens: StochasticSpecimen[] = [];
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    const draws = resampleStochasticIndexesWithReplacement(rng, n);
    specimens.push(toSpecimen(input, iteration, draws));
  }
  return specimens;
}

/**
 * 无放回置换样本（保持集合不变，只改顺序）。
 * Trade Order Randomization 专用：total return 对顺序数学不变（乘法交换律），
 * 本方法因此只检验回撤 / Sharpe 等**路径依赖**量。
 */
export function generateStochasticPermutationSpecimens(
  input: StochasticSpecimenInput
): readonly StochasticSpecimen[] {
  assertUsableSource(input.source, input.iterations);
  const rng = createStochasticPrng(input.seed);
  const n = input.source.length;
  const specimens: StochasticSpecimen[] = [];
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    const draws = permuteStochasticIndexes(rng, n);
    specimens.push(toSpecimen(input, iteration, draws));
  }
  return specimens;
}
