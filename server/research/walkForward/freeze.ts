/**
 * WALK-FORWARD-001 — Candidate Freeze + 不可变性复核（规格 §6 Step C / §10 / §16）。
 *
 * ## 冻结什么、为什么必须复核
 *
 * 一个 Fold 在执行到「候选冻结」之后、进入 OOS 之前，中间可能被外部改动：
 * 策略版本被替换、数据集版本被换、参数被改、窗口被改。任何一条发生，
 * 这次滚动验证的结论就不再对应它声称的那份配置。
 *
 * 做法（与 OOS-001 同一套纪律）：
 *   1. **参数身份用 hash**：`parameterHash` 从「源组合行读出的参数快照」**重算**并逐字节比对；
 *      不一致 ⇒ 行被篡改或哈希口径漂移过 ⇒ 响亮拒绝（`WALK_FORWARD_PARAMETER_HASH_MISMATCH`）；
 *   2. **策略身份用定义指纹**：执行前用**当前文档**重算指纹，与冻结值比对，
 *      不一致 ⇒ `WALK_FORWARD_STRATEGY_DEFINITION_DRIFT`；
 *   3. **数据集坐标逐值比对**；
 *   4. **窗口逐值比对**（创建时冻结的 4 个端点）；
 *   5. **执行指纹**：把「窗口 + 冻结坐标 + 两个子 Run 身份」做 canonical sha256，
 *      写进 Fold 行 ⇒ 同一份配置重跑得到逐字节相同的指纹（规格 §16）。
 *
 * 🔴 全部判定都是 **FAIL LOUDLY**（规格 §10）：发现不一致就抛错，**绝不自动修复、
 *   绝不回落到「当前」的版本 / 参数继续跑**。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { ResearchValidationError } from "../experimentValidation";
import { computeParameterHash } from "../parameterSearch/parameterHash";
import type {
  WalkForwardCandidateSelection,
  WalkForwardFoldSchedule,
} from "./types";

// ---------------------------------------------------------------------------
// 参数 hash 重算复核
// ---------------------------------------------------------------------------

/** 重算参数 hash（唯一权威 = `parameterSearch/parameterHash.ts#computeParameterHash`）。 */
export function recomputeParameterHash(input: {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly parameters: Readonly<Record<string, number | string | boolean | null>>;
}): string {
  return computeParameterHash({
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    parameters: input.parameters,
  });
}

/**
 * 断言「库里那条组合行的参数快照」与「它的 hash」仍然自洽。
 *
 * 这是「参数冻结可复核」的唯一落点：hash 不是被信任的，而是被**重算**出来的。
 */
export function assertParameterHashRecomputes(input: {
  readonly foldIndex: number;
  readonly searchRunId: string;
  readonly combinationIndex: number;
  readonly parameterHash: string;
  readonly parameters: Readonly<Record<string, number | string | boolean | null>>;
  readonly strategyId: string;
  readonly strategyVersion: string;
}): string {
  const recomputed = recomputeParameterHash({
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    parameters: input.parameters,
  });
  if (recomputed !== input.parameterHash) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_PARAMETER_HASH_MISMATCH",
        path: `folds[${String(input.foldIndex)}].parameterHash`,
        message:
          `候选参数 hash 与重算结果不一致（组合 #${String(input.combinationIndex)}，`
          + `源 Run ${input.searchRunId}）：库内=${input.parameterHash}，重算=${recomputed}。`
          + "说明该组合行被外部改写、或 hash 口径变过；拒绝继续（规格 §10 FAIL LOUDLY）。",
      },
    ]);
  }
  return recomputed;
}

// ---------------------------------------------------------------------------
// 不可变性复核（策略 / 数据集 / 窗口）
// ---------------------------------------------------------------------------

/** 策略定义指纹漂移。 */
export function assertStrategyFingerprintUnchanged(input: {
  readonly label: string;
  readonly frozen: string | null;
  readonly current: string | null;
}): void {
  if (input.frozen === null || input.current === null) return; // 无指纹可比（如实跳过，不假装查过）
  if (input.frozen === input.current) return;
  throw new ResearchValidationError([
    {
      code: "WALK_FORWARD_STRATEGY_DEFINITION_DRIFT",
      path: `${input.label}.strategyFingerprint`,
      message:
        `策略定义指纹已漂移：冻结=${input.frozen}，当前=${input.current}。`
        + "策略版本在创建后被改动过 ⇒ 拒绝执行（规格 §10：不自动修复）。",
    },
  ]);
}

/** 数据集坐标漂移。 */
export function assertDatasetVersionUnchanged(input: {
  readonly label: string;
  readonly frozen: number | null;
  readonly current: number | null;
}): void {
  if (input.frozen === input.current) return;
  throw new ResearchValidationError([
    {
      code: "WALK_FORWARD_DATASET_VERSION_DRIFT",
      path: `${input.label}.datasetVersionId`,
      message:
        `绑定数据集版本已漂移：冻结=${String(input.frozen)}，当前=${String(input.current)}。`
        + "拒绝执行（规格 §10：不自动修复）。",
    },
  ]);
}

/** 窗口被改动（冻结的 4 端点必须逐字相等）。 */
export function assertFoldWindowUnchanged(input: {
  readonly foldIndex: number;
  readonly frozen: WalkForwardFoldSchedule;
  readonly current: { readonly isStart: string; readonly isEnd: string; readonly oosStart: string; readonly oosEnd: string };
}): void {
  const frozen = input.frozen;
  const drifted = (
    frozen.isStart !== input.current.isStart
    || frozen.isEnd !== input.current.isEnd
    || frozen.oosStart !== input.current.oosStart
    || frozen.oosEnd !== input.current.oosEnd
  );
  if (!drifted) return;
  throw new ResearchValidationError([
    {
      code: "WALK_FORWARD_FOLD_WINDOW_MODIFIED",
      path: `folds[${String(input.foldIndex)}]`,
      message:
        `Fold 窗口在创建后被改动：冻结 IS ${frozen.isStart}..${frozen.isEnd} / `
        + `OOS ${frozen.oosStart}..${frozen.oosEnd}；当前 IS ${input.current.isStart}..`
        + `${input.current.isEnd} / OOS ${input.current.oosStart}..${input.current.oosEnd}。`
        + "拒绝执行（规格 §10：不自动修复）。",
    },
  ]);
}

// ---------------------------------------------------------------------------
// 候选冻结（组装 Fold 行要写的快照）
// ---------------------------------------------------------------------------

/** 冻结一个 Fold 的候选（参数快照 + hash 复核结论 + 策略一句话）。 */
export function freezeFoldCandidate(input: {
  readonly foldIndex: number;
  readonly searchRunId: string;
  readonly combinationIndex: number;
  readonly parameterHash: string;
  readonly parameters: Readonly<Record<string, number | string | boolean | null>>;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly selection: WalkForwardCandidateSelection["policy"];
  readonly note: string;
}): WalkForwardCandidateSelection {
  const hashRecomputed = assertParameterHashRecomputes(input);
  return {
    foldIndex: input.foldIndex,
    sourceSearchRunId: input.searchRunId,
    combinationIndex: input.combinationIndex,
    parameterHash: input.parameterHash,
    parameters: input.parameters,
    hashRecomputed,
    policy: input.selection,
    note: input.note,
  };
}

// ---------------------------------------------------------------------------
// 执行指纹（规格 §16）
// ---------------------------------------------------------------------------

/**
 * Fold 级执行指纹：覆盖**窗口 4 端点 + 冻结坐标 + 两个子 Run 身份**。
 *
 * 🔴 不含时间戳 / notes ⇒ 同一份配置（哪怕重跑得到新的 Run id）在**同一次运行内**
 *   逐字节稳定；跨运行如需比对，比对的是不含子 Run id 的那部分
 *   （`scheduleFingerprint` + `parameterHash`）。
 */
export function buildFoldExecutionFingerprint(input: {
  readonly foldIndex: number;
  readonly isStart: string;
  readonly isEnd: string;
  readonly oosStart: string;
  readonly oosEnd: string;
  readonly strategyVersionId: string;
  readonly strategyFingerprint: string | null;
  readonly datasetVersionId: number | null;
  readonly sourceSearchRunId: string | null;
  readonly parameterHash: string | null;
  readonly oosRunId: string | null;
}): string {
  return createHash("sha256")
    .update(
      canonicalStringify({
        foldIndex: input.foldIndex,
        isStart: input.isStart,
        isEnd: input.isEnd,
        oosStart: input.oosStart,
        oosEnd: input.oosEnd,
        strategyVersionId: input.strategyVersionId,
        strategyFingerprint: input.strategyFingerprint,
        datasetVersionId: input.datasetVersionId,
        sourceSearchRunId: input.sourceSearchRunId,
        parameterHash: input.parameterHash,
        oosRunId: input.oosRunId,
      }),
      "utf8",
    )
    .digest("hex");
}
