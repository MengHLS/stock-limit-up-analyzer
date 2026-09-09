/**
 * STEP 17 / C-17.1 — 参数采样器：Grid（桥接 STEP 6.3）+ Random（seedable 确定性）。
 *
 * Grid：
 *   - 直接复用 combinationGenerator.generateParameterCombinations / calculateCombinationCount
 *     （import 只读，不重写）：ParameterSpace → 全组合（ResearchParameterSet[]），
 *     确定性顺序 = 定义越靠前的参数变化越慢（外层）。
 *
 * Random（设计决策）：
 *   - 采样 **无放回** 的确定性子集：先在 [0, combinationCount) 上用 Floyd 算法抽取
 *     sampleCount 个不同组合下标（uniform over the index lattice），再按 mixed-radix
 *     （LSD 分解，与 grid 排列同序）把下标解码为参数集；
 *   - 因此 random 样本落在与 grid 相同的离散取值格点上（同值域、可直接对照），
 *     且样本互不重复；budget 超过空间基数时自动收敛为全组合（sampleCount < budget，
 *     结构化可见，不抛错）；
 *   - 组合下标 → 参数集：组合数组的第 i 个元素，i = Σ_p digit_p × Π_{q>p} c_q，
 *     故 LSD 分解（自末参数向前 digit = i % c_p; i = ⌊i / c_p⌋）与 grid 顺序一致。
 *
 * 铁律：纯函数、确定性（同 seed + 同空间 → 同样本）；无 IO / Date.now / Math.random；
 * mutation isolation（返回全新对象）；退化输入（非法空间 / 非法 budget / 非整数 seed）
 * 结构化抛错。
 */

import {
  calculateCombinationCount,
  generateParameterCombinations,
  parameterValues,
} from "../combinationGenerator";
import {
  assertValidParameterSpace,
  type ParameterSpace,
  type SweepParameterDefinition,
} from "../parameterSpace";
import type { ResearchParameterSet, ResearchParameterValue } from "../types";
import { createMulberry32, sampleDistinctInts } from "./prng";

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/** Grid 采样：全组合（桥接 combinationGenerator；maxCombinations 缺省由生成器内置上限把关）。 */
export function gridParameterSets(
  space: ParameterSpace,
  options: { readonly maxCombinations?: number } = {},
): ResearchParameterSet[] {
  return generateParameterCombinations(
    space,
    options.maxCombinations === undefined ? {} : { maxCombinations: options.maxCombinations },
  );
}

/** 组合基数（桥接 calculateCombinationCount；空参数空间为 1）。 */
export function combinationCount(space: ParameterSpace): number {
  return calculateCombinationCount(space);
}

// ---------------------------------------------------------------------------
// Random
// ---------------------------------------------------------------------------

/** Random 采样结果。 */
export interface RandomParameterSamplingResult {
  /** 参数空间全组合基数。 */
  readonly combinationCount: number;
  /** 实际采样数（<= min(budget, combinationCount)）。 */
  readonly sampleCount: number;
  /** 采样参数集（升序下标对应 grid 排列序；无重复）。 */
  readonly parameterSets: ResearchParameterSet[];
}

/**
 * Random 采样：确定性、无放回。seed 必须为整数；budget 必须为 >= 1 整数。
 * 非法输入抛 ResearchValidationError（风格见 combinationGenerator 断言）。
 */
export function sampleRandomParameterSets(
  space: ParameterSpace,
  seed: number,
  budget: number,
): RandomParameterSamplingResult {
  assertValidParameterSpace(space);
  if (!Number.isInteger(seed)) {
    throw new Error(`sampleRandomParameterSets: seed 必须是整数，实际 ${String(seed)}`);
  }
  if (!Number.isInteger(budget) || budget < 1) {
    throw new Error(`sampleRandomParameterSets: budget 必须是 >= 1 的整数，实际 ${String(budget)}`);
  }

  const total = calculateCombinationCount(space);
  const sampleCount = Math.min(budget, total);
  const rng = createMulberry32(seed);
  const indices = sampleDistinctInts(rng, total, sampleCount);
  const valuesByParam = space.parameters.map((param) => parameterValues(param));

  return {
    combinationCount: total,
    sampleCount,
    parameterSets: indices.map((index) => parameterSetAt(space.parameters, valuesByParam, index)),
  };
}

/** 组合下标 → 参数集（LSD mixed-radix 分解，与 grid 组合顺序同序）。 */
function parameterSetAt(
  parameters: readonly SweepParameterDefinition[],
  valuesByParam: readonly (readonly ResearchParameterValue[])[],
  index: number,
): ResearchParameterSet {
  let remaining = index;
  const set: ResearchParameterSet = {};
  for (let p = parameters.length - 1; p >= 0; p--) {
    const values = valuesByParam[p]!;
    const digit = remaining % values.length;
    remaining = Math.floor(remaining / values.length);
    set[parameters[p]!.name] = values[digit]!;
  }
  return set;
}
