/**
 * STEP 6.5 — Parameter Stability Analysis（参数跨窗口稳定性统计）。
 *
 * 职责边界（Research Analysis Layer）：
 *   - 只对「每个 WFO 窗口的 Frozen Candidate 参数」做描述性统计，不做任何回测 / 交易；
 *   - **只能使用参数本身**，禁止使用 OOS Return / Sharpe / Drawdown / PBO 重新挑选参数
 *     （§十五铁律：Stability 输入只有参数值）；
 *   - 不实现 stabilityScore（§十六：若无法给出有明确统计依据的加权评分，只输出参数分布即可）。
 *
 * 类型推断（ResearchParameterValue = number | string | boolean | null）：
 *   - 全部（非 null）为 boolean → "boolean"；
 *   - 全部（非 null）为 number  → 全部整数为 "integer"，否则 "number"；
 *   - 全部（非 null）为 string  → "enum"；
 *   - 全部为 null → 视作 "enum"（唯一取值 null）；
 *   - 类型跨窗口不一致 → fail fast（抛 ResearchValidationError）。
 *
 * 确定性（§三十五）：参数名按字典序输出；uniqueValues 按类型确定排序；frequency 键为稳定
 * 字符串表示（null → "null"）。不依赖对象键插入顺序 / Map / Set 迭代顺序。
 */

import { ResearchValidationError } from "./experimentValidation";
import type { ResearchParameterSet, ResearchParameterValue } from "./types";

/** 稳定性统计所区分的参数类型。 */
export type ParameterStabilityType = "number" | "integer" | "enum" | "boolean";

/** 单个参数的跨窗口统计。 */
export interface ParameterStabilityStat {
  parameterName: string;
  parameterType: ParameterStabilityType;
  /** 按窗口顺序的取值（含 null，保留时间顺序）。 */
  windowValues: ResearchParameterValue[];
  /** 去重后的取值（类型确定排序；null 恒排最后）。 */
  uniqueValues: ResearchParameterValue[];
  /** 每个唯一取值的出现次数（key 为稳定字符串表示；null → "null"）。 */
  frequency: Record<string, number>;
  /** 最常见值（tie 时按 uniqueValues 顺序取第一个）。 */
  mostCommonValue: ResearchParameterValue | null;
  /** 最常见值出现次数。 */
  mostCommonCount: number;
  /** 唯一取值数。 */
  uniqueCount: number;
  /** 离散度（类型确定定义；见下）。 */
  dispersion: number | null;

  // number / integer 专属
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  standardDeviation?: number;
  range?: number;

  // boolean 专属
  trueCount?: number;
  falseCount?: number;
  trueRatio?: number | null;
}

/** 参数稳定性报告。 */
export interface ParameterStabilityReport {
  windowCount: number;
  parameters: ParameterStabilityStat[];
}

function stabilityKey(value: ResearchParameterValue): string {
  return value === null ? "null" : String(value);
}

/** 推断单个参数的类型（跨窗口取值）。 */
function inferType(values: readonly ResearchParameterValue[]): ParameterStabilityType {
  const nonNull = values.filter((value): value is Exclude<ResearchParameterValue, null> => value !== null);
  if (nonNull.length === 0) return "enum";
  if (nonNull.every((value) => typeof value === "boolean")) return "boolean";
  if (nonNull.every((value) => typeof value === "number")) {
    return nonNull.every((value) => Number.isInteger(value)) ? "integer" : "number";
  }
  if (nonNull.every((value) => typeof value === "string")) return "enum";
  throw new ResearchValidationError([
    { code: "STABILITY_TYPE_MIXED", path: "parameterStability", message: "参数跨窗口取值类型不一致（混用 number/string/boolean），无法做稳定性统计" },
  ]);
}

/** 计算数值数组的标准差（总体标准差，n 为样本数）。 */
function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 数值中位数。 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** 按类型确定排序并去重 uniqueValues（null 恒排最后）。 */
function sortUniqueValues(values: readonly ResearchParameterValue[], type: ParameterStabilityType): ResearchParameterValue[] {
  const hasNull = values.some((value) => value === null);
  const deduped: Exclude<ResearchParameterValue, null>[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value === null) continue;
    const key = stabilityKey(value);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(value);
    }
  }
  let sorted: Exclude<ResearchParameterValue, null>[];
  if (type === "number" || type === "integer") {
    sorted = (deduped as number[]).sort((left, right) => left - right);
  } else if (type === "boolean") {
    sorted = (deduped as boolean[]).sort((left, right) => Number(left) - Number(right)); // false 前 true 后
  } else {
    sorted = (deduped as string[]).sort((left, right) => left.localeCompare(right));
  }
  const result: ResearchParameterValue[] = [...sorted];
  if (hasNull) result.push(null);
  return result;
}

/** 计算单个参数的稳定性统计（纯函数、确定性）。 */
function analyzeOne(name: string, values: readonly ResearchParameterValue[]): ParameterStabilityStat {
  const type = inferType(values);
  const frequency: Record<string, number> = {};
  for (const value of values) {
    const key = stabilityKey(value);
    frequency[key] = (frequency[key] ?? 0) + 1;
  }

  const uniqueValues = sortUniqueValues(values, type);
  let mostCommonValue: ResearchParameterValue | null = null;
  let mostCommonCount = 0;
  for (const value of uniqueValues) {
    const count = frequency[stabilityKey(value)]!;
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonValue = value;
    }
  }

  const stat: ParameterStabilityStat = {
    parameterName: name,
    parameterType: type,
    windowValues: [...values],
    uniqueValues,
    frequency,
    mostCommonValue,
    mostCommonCount,
    uniqueCount: uniqueValues.length,
    dispersion: null,
  };

  if (type === "number" || type === "integer") {
    const nums = values.filter((value): value is number => typeof value === "number");
    if (nums.length > 0) {
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
      const std = standardDeviation(nums);
      stat.min = min;
      stat.max = max;
      stat.mean = mean;
      stat.median = median(nums);
      stat.standardDeviation = std;
      stat.range = max - min;
      // dispersion = 变异系数 std/|mean|；mean === 0 时若 std === 0 取 0，否则不可用（null）。
      stat.dispersion = mean === 0 ? (std === 0 ? 0 : null) : std / Math.abs(mean);
    }
  } else if (type === "boolean") {
    const trueCount = values.filter((value) => value === true).length;
    const falseCount = values.filter((value) => value === false).length;
    const total = trueCount + falseCount;
    stat.trueCount = trueCount;
    stat.falseCount = falseCount;
    stat.trueRatio = total === 0 ? null : trueCount / total;
    // dispersion = 类别离散度 1 - maxCount/total（0 = 全部相同，趋向 1 = 均匀分散）。
    stat.dispersion = total === 0 ? null : 1 - Math.max(trueCount, falseCount) / total;
  } else {
    // enum（含全 null 情形）
    const total = values.length;
    // dispersion = 类别离散度 1 - mostCommonCount/total。
    stat.dispersion = total === 0 ? null : 1 - mostCommonCount / total;
  }

  return stat;
}

/**
 * 参数跨窗口稳定性分析（§十五）。
 *
 * 输入为「每个 WFO 窗口的 Frozen Candidate.parameters」（按窗口时间顺序）。参数名按字典序
 * 输出（确定性，不依赖对象键插入顺序）。返回独立副本（mutation isolation）。
 */
export function analyzeParameterStability(parameterSets: readonly ResearchParameterSet[]): ParameterStabilityReport {
  if (!Array.isArray(parameterSets)) {
    throw new ResearchValidationError([
      { code: "STABILITY_INPUT_INVALID", path: "parameterSets", message: "parameterSets 必须是数组" },
    ]);
  }

  const names = new Set<string>();
  for (const set of parameterSets) {
    if (set === null || typeof set !== "object" || Array.isArray(set)) {
      throw new ResearchValidationError([
        { code: "STABILITY_PARAMETER_SET_INVALID", path: "parameterSets", message: "每个参数集合必须是对象" },
      ]);
    }
    for (const name of Object.keys(set)) names.add(name);
  }

  const sortedNames = Array.from(names).sort((left, right) => left.localeCompare(right));
  const parameters = sortedNames.map((name) =>
    analyzeOne(name, parameterSets.map((set) => set[name] ?? null)),
  );

  return { windowCount: parameterSets.length, parameters };
}
