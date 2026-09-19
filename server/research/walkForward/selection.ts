/**
 * WALK-FORWARD-001 — Candidate Selection Policy（规格 §7）。
 *
 * ## 为什么这一层必须单独存在，且必须「无聊」
 *
 * Walk-Forward 需要一个「每 Fold 用哪组参数」的机制，但**绝不能**借机引入
 * 「自动最佳策略 / 最佳参数 / 推荐参数 / 最优 Fold」这类不可解释的业务结论（规格 §7 / §22）。
 *
 * ⇒ 本域只提供**两种显式、可审计、零指标语义**的策略：
 *
 * | 策略 | 规则 | 为什么它不含「最优」 |
 * | --- | --- | --- |
 * | `FIRST_ELIGIBLE_COMBINATION` | 按 `combinationIndex` **升序**取第一个「有成功结果行」的组合 | 纯**位置**规则，与收益 / 回撤 / 胜率**完全无关** |
 * | `EXPLICIT_PARAMETER_HASH` | 调用方显式给出 `parameterHash`，在该 Fold 的搜索结果里查找 | 参数由**人**指定；找不到即**显式失败**，不回落、不代选 |
 *
 * 🔴 **本域刻意不提供「按指标排序取极值」的策略** —— 那正是规格 §7 点名要防的
 *   「把内部测试里的 `tradeCount DESC` 之类逻辑偷偷变成生产默认策略」。
 *   如果将来确实需要，必须先形成正式的领域能力，而不是在这里加一个排序键。
 *
 * ## 确定性（规格 §16）
 *
 * - 调用方传入的行**必须**先按 `combinationIndex` 升序排好（本文件会**再断言一次单调**，
 *   而不是被动信任：数据库不保证返回顺序）；
 * - 策略里没有任何「取最新的 / 取随机的」成分 ⇒ 同输入 ⇒ 同选择。
 */

import { ResearchValidationError } from "../experimentValidation";
import type { WalkForwardCandidateSelection, WalkForwardSelectionPolicy } from "./types";
import { freezeFoldCandidate } from "./freeze";

/** 一个组合行（只取本层用得到的字段 —— 保持纯函数、可无 DB 单测）。 */
export interface CandidateCombinationRow {
  readonly combinationIndex: number;
  readonly parameterHash: string;
  /** 参数取值 JSON（`longtext` 读回来是**字符串**，本层负责解析两种形态）。 */
  readonly parametersJson: string | Record<string, unknown>;
}

/** 一个结果行（只取本层用得到的字段）。 */
export interface CandidateResultRow {
  readonly combinationIndex: number;
  readonly parameterHash: string;
  /** SUCCEEDED / FAILED。 */
  readonly status: string;
}

/** 解析参数 JSON（容忍 `longtext` 读回的字符串形态与已解析对象两种）。 */
export function parseParameterJson(
  value: string | Record<string, unknown>,
  label: string,
): Record<string, number | string | boolean | null> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new ResearchValidationError([
        {
          code: "WALK_FORWARD_PARAMETER_SNAPSHOT_UNREADABLE",
          path: label,
          message:
            `参数快照不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_PARAMETER_SNAPSHOT_UNREADABLE",
        path: label,
        message: `参数快照必须是 JSON object，实际 ${parsed === null ? "null" : typeof parsed}`,
      },
    ]);
  }
  const out: Record<string, number | string | boolean | null> = {};
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    if (item === null || typeof item === "number" || typeof item === "string" || typeof item === "boolean") {
      out[key] = item;
      continue;
    }
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_PARAMETER_SNAPSHOT_UNREADABLE",
        path: `${label}.${key}`,
        message: `参数 ${key} 的取值必须是标量或 null，实际 ${Array.isArray(item) ? "array" : typeof item}`,
      },
    ]);
  }
  return out;
}

/** 断言行按 `combinationIndex` 严格升序（数据库不保证顺序 ⇒ 必须显式排序 + 断言）。 */
export function assertCombinationRowsOrdered(
  combinations: readonly CandidateCombinationRow[],
  label: string,
): void {
  for (let index = 1; index < combinations.length; index += 1) {
    const previous = combinations[index - 1]!;
    const current = combinations[index]!;
    if (current.combinationIndex <= previous.combinationIndex) {
      throw new ResearchValidationError([
        {
          code: "WALK_FORWARD_COMBINATION_ORDER_UNSTABLE",
          path: `${label}[${String(index)}].combinationIndex`,
          message:
            `组合行未按 combinationIndex 严格升序（${String(previous.combinationIndex)} → `
            + `${String(current.combinationIndex)}）⇒ 选择结果会随数据库返回顺序漂移。`
            + "调用方必须显式 ORDER BY combinationIndex 后再传入（规格 §16）。",
        },
      ]);
    }
  }
}

/** 策略的人类可读自述（写进 Run / Fold 快照；不静默）。 */
export function describeSelectionPolicy(policy: WalkForwardSelectionPolicy): string {
  return policy.kind === "FIRST_ELIGIBLE_COMBINATION"
    ? "候选选择策略 = FIRST_ELIGIBLE_COMBINATION（按 combinationIndex 升序取第一个有成功结果的组合；"
      + "纯位置规则，不读取任何指标 ⇒ 不存在按表现挑选的语义）。"
    : `候选选择策略 = EXPLICIT_PARAMETER_HASH（调用方显式指定 parameterHash=${policy.parameterHash}；`
      + "在该 Fold 的搜索结果里查找，找不到即该 Fold 显式失败，不回落、不代选）。";
}

/**
 * 按策略从该 Fold 自己的搜索结果里选出候选（**纯函数**，无 IO）。
 *
 * 失败形态（全部**响亮抛错**，绝不「随便挑一个」）：
 *   - 组合行为空 ⇒ `WALK_FORWARD_SEARCH_HAS_NO_COMBINATION`（搜索没产出计划）；
 *   - `FIRST_ELIGIBLE_COMBINATION` 但无任何成功结果 ⇒ `WALK_FORWARD_NO_ELIGIBLE_CANDIDATE`；
 *   - `EXPLICIT_PARAMETER_HASH` 但该 hash 不在本 Fold 的组合里 ⇒ `WALK_FORWARD_EXPLICIT_CANDIDATE_NOT_FOUND`；
 *   - 指定了 hash 但那条结果不是 SUCCEEDED ⇒ `WALK_FORWARD_EXPLICIT_CANDIDATE_NOT_ELIGIBLE`。
 */
export function selectFoldCandidate(input: {
  readonly foldIndex: number;
  readonly searchRunId: string;
  readonly policy: WalkForwardSelectionPolicy;
  readonly combinations: readonly CandidateCombinationRow[];
  readonly results: readonly CandidateResultRow[];
  readonly strategyId: string;
  readonly strategyVersion: string;
}): WalkForwardCandidateSelection {
  assertCombinationRowsOrdered(input.combinations, `folds[${String(input.foldIndex)}].combinations`);
  if (input.combinations.length === 0) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_SEARCH_HAS_NO_COMBINATION",
        path: `folds[${String(input.foldIndex)}].sourceSearchRunId`,
        message: `该 Fold 的搜索 Run ${input.searchRunId} 没有任何组合行 ⇒ 无从冻结候选。`,
      },
    ]);
  }

  const resultByHash = new Map(input.results.map((row) => [row.parameterHash, row]));
  const succeededHashes = new Set(
    input.results.filter((row) => row.status === "SUCCEEDED").map((row) => row.parameterHash),
  );

  if (input.policy.kind === "EXPLICIT_PARAMETER_HASH") {
    const wanted = input.policy.parameterHash;
    const row = input.combinations.find((item) => item.parameterHash === wanted);
    if (row === undefined) {
      throw new ResearchValidationError([
        {
          code: "WALK_FORWARD_EXPLICIT_CANDIDATE_NOT_FOUND",
          path: `folds[${String(input.foldIndex)}].parameterHash`,
          message:
            `显式指定的 parameterHash=${wanted} 不在该 Fold 的搜索结果里`
            + `（源 Run ${input.searchRunId}，组合 ${String(input.combinations.length)} 个）。`
            + "拒绝代选、拒绝回落到其它组合。",
        },
      ]);
    }
    const result = resultByHash.get(wanted);
    if (result === undefined || result.status !== "SUCCEEDED") {
      throw new ResearchValidationError([
        {
          code: "WALK_FORWARD_EXPLICIT_CANDIDATE_NOT_ELIGIBLE",
          path: `folds[${String(input.foldIndex)}].parameterHash`,
          message:
            `显式指定的 parameterHash=${wanted} 在该 Fold 的结果行不存在或状态非 SUCCEEDED`
            + `（实际 ${result === undefined ? "无结果行" : result.status}）⇒ 该 Fold 显式失败。`,
        },
      ]);
    }
    return freezeFoldCandidate({
      foldIndex: input.foldIndex,
      searchRunId: input.searchRunId,
      combinationIndex: row.combinationIndex,
      parameterHash: row.parameterHash,
      parameters: parseParameterJson(row.parametersJson, `folds[${String(input.foldIndex)}].parameters`),
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      selection: input.policy,
      note:
        `按 EXPLICIT_PARAMETER_HASH 选定组合 #${String(row.combinationIndex)}`
        + `（显式指定，非算法挑选）。`,
    });
  }

  // FIRST_ELIGIBLE_COMBINATION：升序取第一个有成功结果的组合（零指标参与）
  const eligible = input.combinations.find((row) => succeededHashes.has(row.parameterHash));
  if (eligible === undefined) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_NO_ELIGIBLE_CANDIDATE",
        path: `folds[${String(input.foldIndex)}].sourceSearchRunId`,
        message:
          `该 Fold 的搜索 Run ${input.searchRunId} 有 ${String(input.combinations.length)} 个组合，`
          + "但没有任何 SUCCEEDED 结果行 ⇒ 无从冻结候选（不代选、不降级）。",
      },
    ]);
  }
  return freezeFoldCandidate({
    foldIndex: input.foldIndex,
    searchRunId: input.searchRunId,
    combinationIndex: eligible.combinationIndex,
    parameterHash: eligible.parameterHash,
    parameters: parseParameterJson(
      eligible.parametersJson,
      `folds[${String(input.foldIndex)}].parameters`,
    ),
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    selection: input.policy,
    note:
      `按 FIRST_ELIGIBLE_COMBINATION 选定组合 #${String(eligible.combinationIndex)}`
      + `（该 Fold 内**编号最小**且有成功结果的组合；规则不读取任何收益 / 风险指标）。`,
  });
}
