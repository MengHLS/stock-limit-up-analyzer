/**
 * OOS-001 §5 / §8 — 候选参数**冻结**与复核（纯函数，零 IO）。
 *
 * ## 为什么「冻结」必须是一条可断言的判定
 *
 * 规格 §5 给了五条**明禁**：
 *   1. 搜索新参数；2. 调整参数；3. 根据 OOS 表现重新选择参数；
 *   4. 使用当前 StrategyVersion 重新解释历史 Search 参数；
 *   5. 从当前 Parameter Schema 重新推导历史 Search Result。
 *
 * 把这条纪律做成**接口形态**比写成注释有用得多：
 *   - `createOosValidation` 的入参**只有 `parameterHash`**，没有参数值位置
 *     ⇒ 「顺手传一组更好的参数」在类型层面就做不到（防 1 / 2 / 3）；
 *   - 参数值一律从**源 Run 的组合行**读出，并**重算 hash 比对**（下面的 `freezeCandidate`）
 *     ⇒ 行被外部篡改 / 哈希口径变过 ⇒ 响亮拒绝，而不是拿着错位的身份去跑（防 4 / 5）；
 *   - `assertFrozenParameterSetUnchanged` 在**执行时**再核对一次落库快照与内存值
 *     ⇒ 执行期间被并发改写也能被抓住。
 *
 * ## 与「从当前策略版本补全」的界线（规格 §5 末句）
 *
 * 冻结信息不足时**显式失败**（`OOS_SOURCE_COMBINATION_NOT_FOUND` /
 * `OOS_PARAMETER_FREEZE_HASH_MISMATCH` / `OOS_FROZEN_PARAMETER_SET_MISSING`），
 * **绝不**回读当前策略版本「补全」缺的参数 —— 那正是规格明禁的第 5 条。
 *
 * ⚠️ 唯一允许读当前策略版本的地方是「**执行回测**」：回测必须有一份策略文档，
 *   而 `strategy_versions` 是**不可变**的（`updateVersionDefinition()` 恒抛
 *   `VERSION_IMMUTABLE`）⇒ 读到的就是**当时那一份**。为此本域额外冻结
 *   `strategyDefinitionFingerprint`，并在 start 时复核：指纹变了即
 *   `OOS_STRATEGY_DEFINITION_DRIFT`（把「不可变」从承诺变成可检测的事实）。
 */

import type { ParameterSearchCombinationRow, ParameterSearchResultRow } from "../parameterSearch/persistence";
import { computeParameterHash } from "../parameterSearch/parameterHash";
import { ResearchValidationError } from "../experimentValidation";
import type { ResearchParameterSet } from "../types";
import type { FrozenCandidateSnapshot } from "./types";

/** 读取冻结候选所需的最小行集（本层零 IO，行由调用方读入）。 */
export interface FreezeCandidateInput {
  readonly searchRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameterHash: string;
  readonly combinations: readonly ParameterSearchCombinationRow[];
  readonly results: readonly ParameterSearchResultRow[];
}

/** 只保留有限数与合法标量 —— 坏值**不得**静默进参数集。 */
function parseParametersJson(text: string): ResearchParameterSet {
  const parsed: unknown = JSON.parse(text === "" ? "{}" : text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ResearchValidationError([
      {
        code: "OOS_FROZEN_PARAMETER_SET_MISSING",
        path: "parametersJson",
        message: "源组合行的 parametersJson 不是 JSON object ⇒ 冻结参数集不可用，拒绝继续。",
      },
    ]);
  }
  return parsed as ResearchParameterSet;
}

/**
 * 从源 Run 的行里**冻结**一个候选（唯一落点）。
 *
 * 判定顺序（顺序即语义）：
 *   ① 组合行存在                                    ⇒ `OOS_SOURCE_COMBINATION_NOT_FOUND`
 *   ② 组合行 hash 与入参 hash 一致（防串行拿错行）
 *   ③ 参数值重算 hash == 落库 hash（防篡改 / 口径漂移）  ⇒ `OOS_PARAMETER_FREEZE_HASH_MISMATCH`
 *   ④ 该组合在源 Run 里有成功结果（IS 基线存在）        ⇒ `OOS_SOURCE_RESULT_MISSING`
 */
export function freezeCandidate(input: FreezeCandidateInput): FrozenCandidateSnapshot {
  const combination = input.combinations.find((row) => row.parameterHash === input.parameterHash);
  if (combination === undefined) {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_COMBINATION_NOT_FOUND",
        path: "parameterHash",
        message:
          `源 Search Run ${input.searchRunId} 内不存在组合 ${input.parameterHash}`
          + `（可用组合 ${String(input.combinations.length)} 个）—— `
          + `冻结信息不足时**显式失败**，不回读当前策略版本补全（规格 §5）。`,
      },
    ]);
  }
  if (combination.searchRunId !== input.searchRunId) {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_COMBINATION_NOT_FOUND",
        path: "parameterHash",
        message:
          `读到的组合行属于 ${combination.searchRunId}，不属于 ${input.searchRunId} ⇒ 拒绝跨 Run 取参（规格 §16 T7）。`,
      },
    ]);
  }

  const parameters = parseParametersJson(combination.parametersJson);
  const recomputed = computeParameterHash({
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    parameters,
  });
  if (recomputed !== combination.parameterHash) {
    throw new ResearchValidationError([
      {
        code: "OOS_PARAMETER_FREEZE_HASH_MISMATCH",
        path: "parameterHash",
        message:
          `组合行参数重算 hash 与落库 hash 不一致（落库 ${combination.parameterHash}，重算 ${recomputed}）`
          + `—— 落库行被外部篡改，或哈希口径已变。拒绝在错位的身份上执行 OOS。`,
      },
    ]);
  }

  const result = input.results.find((row) => row.parameterHash === combination.parameterHash);
  if (result === undefined || result.status !== "SUCCEEDED") {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_RESULT_MISSING",
        path: "parameterHash",
        message:
          `源 Search Run ${input.searchRunId} 内组合 ${combination.parameterHash} 没有成功结果`
          + `（${result === undefined ? "无结果行" : `结果状态 = ${result.status}`}）`
          + `⇒ 没有 IS 基线就谈不上「样本外对照」，拒绝创建 OOS 验证。`,
      },
    ]);
  }

  return {
    sourceSearchRunId: input.searchRunId,
    combinationIndex: combination.combinationIndex,
    parameterHash: combination.parameterHash,
    parameters,
    hasSucceededResult: true,
  };
}

/**
 * 执行时复核：**落库的冻结快照**必须与本次要跑的参数集逐键相等。
 *
 * 这是防「创建之后被并发改写」的最后一道闸（规格 §5：禁止使用与冻结不同的参数执行）。
 */
export function assertFrozenParameterSetUnchanged(input: {
  readonly frozenFromRunRow: Readonly<Record<string, unknown>>;
  readonly frozenFromCombinationRow: Readonly<Record<string, unknown>>;
}): void {
  const a = canonicalParameterKey(input.frozenFromRunRow);
  const b = canonicalParameterKey(input.frozenFromCombinationRow);
  if (a !== b) {
    throw new ResearchValidationError([
      {
        code: "OOS_FROZEN_PARAMETER_SET_CHANGED",
        path: "resolvedParameterSet",
        message:
          "OOS Run 上冻结的参数快照与源组合行当前取值不一致"
          + `（Run ${a} vs 组合 ${b}）⇒ 冻结被破坏，拒绝执行（规格 §5：OOS 执行不允许使用与冻结不同的参数）。`,
      },
    ]);
  }
}

/**
 * 参数集的**稳定字符串**（键排序 + JSON 值）。
 *
 * 与 `parameterSearch/parameterHash.ts` 的规范化口径同族但不复用其内部实现：
 * 那个函数对整份「策略身份 + 参数」求 hash，本函数只做**逐键相等性**判定。
 * 两者用途不同，不构成第二套身份（身份唯一权威仍是 `parameterHash`）。
 */
export function canonicalParameterKey(
  parameters: Readonly<Record<string, unknown>>,
): string {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${JSON.stringify(key)}=${JSON.stringify(parameters[key])}`)
    .join("|");
}
