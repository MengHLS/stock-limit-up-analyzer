/**
 * STEP 6.3 — 确定性参数组合生成器（纯函数）。
 *
 *   ParameterSpace ──▶ Parameter Combinations（ResearchParameterSet[]）
 *
 * 铁律：
 *   - 确定性：同一 ParameterSpace 必须始终产生相同数量 / 顺序 / 值的组合（纯函数）；
 *   - 禁止 Math.random / shuffle / 时间相关排序 / 对象不稳定遍历；
 *   - 笛卡尔积顺序稳定：定义越靠前的参数变化越慢（外层）；
 *   - 组合之间、组合与原始 ParameterSpace 之间不共享可变对象（mutation isolation）；
 *   - 浮点参数基于 index 生成并稳定化，避免 0.30000000000000004 之类误差；
 *   - 整数参数保持精确整数（禁止 20.000000001）；
 *   - 生成前必须计算组合数量并强制 maxCombinations 上限（禁止生成后再截断）。
 */

import { ResearchValidationError } from "./experimentValidation";
import { assertValidParameterSpace, type ParameterSpace, type SweepParameterDefinition } from "./parameterSpace";
import type { ResearchParameterSet, ResearchParameterValue } from "./types";

/** 默认组合数量上限（生成前强制；超过即失败，不截断）。 */
export const DEFAULT_MAX_COMBINATIONS = 10_000;

/** 浮点稳定化最多保留的小数位数（超出视为极端/科学计数法场景，回退到该精度）。 */
const MAX_FLOAT_DECIMALS = 12;

/** 组合生成选项。 */
export interface CombinationGenerationOptions {
  /** 组合数量上限；缺省 DEFAULT_MAX_COMBINATIONS。 */
  maxCombinations?: number;
}

/** 提取数值的小数位数（科学计数法字符串回退到 MAX_FLOAT_DECIMALS）。 */
function decimalPlaces(value: number): number {
  const text = String(value);
  if (text.includes("e") || text.includes("E")) return MAX_FLOAT_DECIMALS;
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** 浮点参数取值数量：floor((max-min)/step + ε) + 1，ε 吸收浮点除法误差。 */
function numberValueCount(min: number, max: number, step: number): number {
  return Math.floor((max - min) / step + 1e-9) + 1;
}

/** 浮点参数取值：基于 index 生成，并按 min/max/step 的最大小数位数稳定化。 */
function numberValues(min: number, max: number, step: number): number[] {
  const count = numberValueCount(min, max, step);
  const decimals = Math.min(MAX_FLOAT_DECIMALS, Math.max(decimalPlaces(min), decimalPlaces(max), decimalPlaces(step)));
  const values: number[] = [];
  for (let index = 0; index < count; index++) {
    values.push(Number((min + index * step).toFixed(decimals)));
  }
  return values;
}

/** 整数参数取值：min/max/step 均已校验为整数，加乘为精确整数。 */
function integerValues(min: number, max: number, step: number): number[] {
  const count = Math.floor((max - min) / step) + 1;
  const values: number[] = [];
  for (let index = 0; index < count; index++) {
    values.push(min + index * step);
  }
  return values;
}

/** 单个参数的全部取值（确定性、顺序稳定）。 */
export function parameterValues(param: SweepParameterDefinition): ResearchParameterValue[] {
  switch (param.type) {
    case "number":
      return numberValues(param.min, param.max, param.step);
    case "integer":
      return integerValues(param.min, param.max, param.step);
    case "boolean":
      return param.values === undefined ? [true, false] : [...param.values];
    case "enum":
      return [...param.values];
  }
}

/** 单个参数的取值数量。 */
export function countParameterValues(param: SweepParameterDefinition): number {
  switch (param.type) {
    case "number":
      return numberValueCount(param.min, param.max, param.step);
    case "integer":
      return Math.floor((param.max - param.min) / param.step) + 1;
    case "boolean":
      return param.values === undefined ? 2 : param.values.length;
    case "enum":
      return param.values.length;
  }
}

/** 组合总数 = 各参数取值数量之积（空参数空间为 1）。 */
export function calculateCombinationCount(space: ParameterSpace): number {
  let count = 1;
  for (const param of space.parameters) {
    count *= countParameterValues(param);
    if (!Number.isFinite(count)) return Number.MAX_SAFE_INTEGER;
  }
  return count;
}

/**
 * 生成确定性参数组合（ResearchParameterSet[]）。
 * 生成前先校验参数空间，再计算数量并强制 maxCombinations 上限；超过即抛错，绝不先膨胀再截断。
 */
export function generateParameterCombinations(
  space: ParameterSpace,
  options: CombinationGenerationOptions = {},
): ResearchParameterSet[] {
  assertValidParameterSpace(space);

  const maxCombinations = options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS;
  if (maxCombinations < 1) {
    throw new ResearchValidationError([
      { code: "MAX_COMBINATIONS_INVALID", path: "maxCombinations", message: "maxCombinations 必须是 >= 1 的整数" },
    ]);
  }

  const combinationCount = calculateCombinationCount(space);
  if (combinationCount > maxCombinations) {
    throw new ResearchValidationError([
      {
        code: "MAX_COMBINATIONS_EXCEEDED",
        path: "parameterSpace",
        message: `组合数量 ${combinationCount} 超过上限 ${maxCombinations}（禁止截断，需缩小参数空间或提高上限）`,
      },
    ]);
  }

  // 空参数空间 → 1 个空 parameterSet（「没有 Sweep 参数 ≠ 没有 Experiment」）。
  let combinations: ResearchParameterSet[] = [{}];
  for (const param of space.parameters) {
    const values = parameterValues(param);
    const next: ResearchParameterSet[] = [];
    for (const combination of combinations) {
      for (const value of values) {
        next.push({ ...combination, [param.name]: value });
      }
    }
    combinations = next;
  }

  return combinations;
}
