/**
 * PARAMETER-001 §6 — Parameter Combination（笛卡尔积 · 稳定 `parameterHash` · 去重）。
 *
 * ```text
 * Parameter Space ──Cartesian Product──▶ Parameter Combinations（每组带稳定 parameterHash）
 * ```
 *
 * ## 复用（**禁第二套**）
 *
 * 组合枚举本身**不重写**：直接调既有唯一实现
 * `server/research/combinationGenerator.ts#generateParameterCombinations`
 * （它已保证「顺序稳定 + 生成前强制上限 + mutation isolation + 浮点稳定化」）。
 * 本模块只加两件既有实现没有的事：
 *   1. 为每组组合算 **稳定 `parameterHash`**（`parameterHash.ts`）；
 *   2. **哈希去重**（同一 Run 内宣称两组不同组合必须给出不同 hash ⇒ 撞 hash 即响亮抛错，
 *      因为那意味着「两个不同参数得到同一身份」，会让 resume / retry / cache 全部错位）。
 *
 * ## 为什么必须去重
 *
 * `parameterHash` 是 Result / Combination / cache 的**身份**。若两组不同参数撞成同一 hash，
 * 落库会「静默合并成一行」⇒ 用户看到 4 个组合只有 3 行结果，且**没有任何错误**。
 * ⇒ 撞 hash 视为**响亮缺陷**（`PARAMETER_SEARCH_HASH_COLLISION`），不合并、不覆盖、不跳过。
 */

import { createHash } from "node:crypto";
import type { ParameterSearchSpaceDefinition } from "../../../shared/parameterSearchContracts";
import { generateParameterCombinations, DEFAULT_MAX_COMBINATIONS } from "../combinationGenerator";
import { ResearchValidationError } from "../experimentValidation";
import type { ResearchParameterSet } from "../types";
import { computeParameterHash } from "./parameterHash";
import { compileSearchSpaceToParameterSpace, type ParameterSearchDeclaredParameter } from "./searchSpace";

/** 一个参数组合（笛卡尔积成员 + 稳定身份）。 */
export interface ParameterCombination {
  /** 组合序号（生成顺序，从 0 起；**仅用于展示与稳定排序，不作身份**）。 */
  readonly combinationIndex: number;
  /** 稳定参数哈希（**身份**；见 `parameterHash.ts`）。 */
  readonly parameterHash: string;
  /** 参数取值（与 `ResearchParameterSet` 同域）。 */
  readonly parameters: ResearchParameterSet;
}

/** 生成结果：组合列表 + 如实统计。 */
export interface ParameterCombinationSet {
  readonly combinations: readonly ParameterCombination[];
  /** 笛卡尔积基数（= combinations.length；保留字段以对齐既有 `calculateCombinationCount` 口径）。 */
  readonly combinationCount: number;
  /** 去重时被发现的重复 hash 数（正常恒为 0；非 0 即抛错，此字段只在抛错消息里用到）。 */
  readonly duplicateHashCount: number;
}

/** 生成选项。 */
export interface BuildParameterCombinationsOptions {
  /** 组合数上限（生成前强制；缺省对齐既有 `DEFAULT_MAX_COMBINATIONS`）。 */
  readonly maxCombinations?: number;
  /** 策略 Schema 声明面（用于「参数必须存在于 Strategy Schema」校验；缺省则跳过该项）。 */
  readonly declared?: readonly ParameterSearchDeclaredParameter[];
}

/**
 * 生成参数组合（确定性、带稳定 hash、撞 hash 即抛）。
 *
 * 纯函数：无 IO / 无 Date.now / 无 Math.random。
 */
export function buildParameterCombinations(
  definition: ParameterSearchSpaceDefinition,
  options: BuildParameterCombinationsOptions = {},
): ParameterCombinationSet {
  const space = compileSearchSpaceToParameterSpace(definition, options.declared);
  const sets = generateParameterCombinations(space, {
    maxCombinations: options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS,
  });

  const seen = new Map<string, number>();
  const combinations: ParameterCombination[] = [];
  let duplicateHashCount = 0;

  sets.forEach((parameters, combinationIndex) => {
    const parameterHash = computeParameterHash({
      strategyId: definition.strategyId,
      strategyVersion: definition.strategyVersion,
      parameters,
    });
    const previous = seen.get(parameterHash);
    if (previous !== undefined) {
      duplicateHashCount += 1;
      throw new ResearchValidationError([
        {
          code: "PARAMETER_SEARCH_HASH_COLLISION",
          path: `parameterSearchSpace`,
          message:
            `参数组合 #${String(previous)} 与 #${String(combinationIndex)} 得到同一 parameterHash`
            + `（${parameterHash}）：两个不同参数不允许共享身份，否则 resume / retry / cache 会静默错位。`,
        },
      ]);
    }
    seen.set(parameterHash, combinationIndex);
    combinations.push({ combinationIndex, parameterHash, parameters });
  });

  return { combinations, combinationCount: combinations.length, duplicateHashCount };
}

/** 组合集合的内容指纹（落库前的自述；用途 = 证明「这次生成的组合集没变」）。 */
export function computeCombinationSetFingerprint(
  combinations: readonly ParameterCombination[],
): string {
  const payload = combinations
    .map((combination) => `${String(combination.combinationIndex)}:${combination.parameterHash}`)
    .join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export { DEFAULT_MAX_COMBINATIONS };
