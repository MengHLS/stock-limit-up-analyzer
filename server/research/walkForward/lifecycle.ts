/**
 * WALK-FORWARD-001 — 生命周期状态机（规格 §5 / §12）。
 *
 * 分两层，且**唯一权威各不相同**：
 *
 * | 层 | 状态词表 | 迁移表唯一权威 |
 * | --- | --- | --- |
 * | **Run** | `PARAMETER_SEARCH_RUN_STATUSES`（复用，不另立） | `parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS` |
 * | **Fold** | 本域独有（比 Run 多，因为一个 Fold 要走搜索 + 冻结 + 样本外三段） | **本文件** |
 *
 * 🔴 Run 层有一条**本域特有的收紧**：PS 的迁移表允许 `COMPLETED → RUNNING`（为了重试失败组合），
 *   但 Walk-Forward 的语义是「一条已完成的滚动验证**不允许再执行**」（规格 §12 / §17.11）——
 *   重复 `start` 必须是**幂等返回**（`executed=false`），既不重跑也不重算。
 *   ⇒ 执行资格判定**不能**直接用 `canTransitionSearchRun`，必须走本文件的
 *   `assertWalkForwardRunCanExecute`（它是这一条语义的唯一落点）。
 */

import { ResearchValidationError } from "../experimentValidation";
import {
  assertSearchRunTransition,
  canTransitionSearchRun,
} from "../parameterSearch/searchRun";
import type { WalkForwardFoldStatus, WalkForwardRunStatus } from "./types";

// ---------------------------------------------------------------------------
// Fold 层状态机
// ---------------------------------------------------------------------------

/**
 * Fold 迁移表：`from → 允许到达的集合`（唯一权威；断言与测试共用）。
 *
 * ```text
 * WINDOW_CREATED  → SEARCH_RUNNING | FAILED
 * SEARCH_RUNNING  → SEARCH_COMPLETED | FAILED
 * SEARCH_COMPLETED→ CANDIDATE_FROZEN | FAILED
 * CANDIDATE_FROZEN→ OOS_RUNNING | FAILED
 * OOS_RUNNING     → OOS_COMPLETED | FAILED
 * OOS_COMPLETED   → （终态，无出边）
 * FAILED          → （终态；本域不做 Fold 级重跑 —— 重跑走「整条 Run 重执行」，见下）
 * ```
 *
 * 🔴 为什么 `FAILED` 没有出边：规格 §9/§12 要求「失败必须能明确记录、不得伪造成功」。
 *   单 Fold 的中间态重试会让 Fold 行出现「SEARCH_RUNNING 之后又回到 WINDOW_CREATED」这类
 *   难以审计的历史；本域的做法是**整条 Run 重执行**（`FAILED → RUNNING`，全部 Fold 重建行）,
 *   这样每个 Fold 行永远只有一条单调向前的时间线。
 */
export const WALK_FORWARD_FOLD_TRANSITIONS: Readonly<
  Record<WalkForwardFoldStatus, readonly WalkForwardFoldStatus[]>
> = {
  WINDOW_CREATED: ["SEARCH_RUNNING", "FAILED"],
  SEARCH_RUNNING: ["SEARCH_COMPLETED", "FAILED"],
  SEARCH_COMPLETED: ["CANDIDATE_FROZEN", "FAILED"],
  CANDIDATE_FROZEN: ["OOS_RUNNING", "FAILED"],
  OOS_RUNNING: ["OOS_COMPLETED", "FAILED"],
  OOS_COMPLETED: [],
  FAILED: [],
};

/** Fold 终态。 */
export const WALK_FORWARD_FOLD_TERMINAL_STATUSES: readonly WalkForwardFoldStatus[] = [
  "OOS_COMPLETED",
  "FAILED",
];

/** 是否允许该 Fold 迁移（同态视为幂等重放，与 PS 口径一致）。 */
export function canTransitionWalkForwardFold(
  from: WalkForwardFoldStatus,
  to: WalkForwardFoldStatus,
): boolean {
  if (from === to) return true;
  return WALK_FORWARD_FOLD_TRANSITIONS[from].includes(to);
}

/** 断言 Fold 迁移合法（领域码 `WALK_FORWARD_FOLD_STATUS_TRANSITION_INVALID`）。 */
export function assertWalkForwardFoldTransition(
  from: WalkForwardFoldStatus,
  to: WalkForwardFoldStatus,
  label = "fold",
): void {
  if (canTransitionWalkForwardFold(from, to)) return;
  const allowed = WALK_FORWARD_FOLD_TRANSITIONS[from];
  throw new ResearchValidationError([
    {
      code: "WALK_FORWARD_FOLD_STATUS_TRANSITION_INVALID",
      path: `${label}.status`,
      message:
        `Fold 状态迁移非法：${from} → ${to}；`
        + (allowed.length === 0
          ? `${from} 是终态，无合法出边。`
          : `允许：${allowed.join(" / ")}（同态重放视为幂等）。`),
    },
  ]);
}

/** 是否为合法 Fold 状态（读库行校验用；非法值**响亮报错**，不默认成 WINDOW_CREATED）。 */
export function isWalkForwardFoldStatus(value: unknown): value is WalkForwardFoldStatus {
  return typeof value === "string" && value in WALK_FORWARD_FOLD_TRANSITIONS;
}

/** 解析 Fold 状态；非法值抛错（不静默回落）。 */
export function parseWalkForwardFoldStatus(value: unknown, label = "fold"): WalkForwardFoldStatus {
  if (!isWalkForwardFoldStatus(value)) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_FOLD_STATUS_INVALID",
        path: `${label}.status`,
        message:
          `非法的 Fold 状态：${String(value)}；`
          + `合法取值：${Object.keys(WALK_FORWARD_FOLD_TRANSITIONS).join(" / ")}`,
      },
    ]);
  }
  return value;
}

/** Fold 是否已到终态（`OOS_COMPLETED` / `FAILED`）。 */
export function isWalkForwardFoldTerminal(status: WalkForwardFoldStatus): boolean {
  return WALK_FORWARD_FOLD_TERMINAL_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Run 层状态机（迁移表复用 PS；「能否执行」本域收紧）
// ---------------------------------------------------------------------------

/** Run 迁移（委托 PS 唯一权威；同态幂等）。 */
export function canTransitionWalkForwardRun(
  from: WalkForwardRunStatus,
  to: WalkForwardRunStatus,
): boolean {
  return canTransitionSearchRun(from, to);
}

/** Run 迁移断言（委托 PS 唯一权威，因此错误码仍是 `PARAMETER_SEARCH_STATUS_TRANSITION_INVALID`）。 */
export function assertWalkForwardRunTransition(
  from: WalkForwardRunStatus,
  to: WalkForwardRunStatus,
): void {
  assertSearchRunTransition(from, to);
}

/**
 * 断言该 Run **现在可以执行**（规格 §12：`COMPLETED` 不允许再次执行）。
 *
 * 🔴 这是本域对 PS 迁移表的**唯一一处收紧**：
 *   - `CREATED` / `FAILED` / `CANCELLED` ⇒ 可执行；
 *   - `COMPLETED` ⇒ **不可执行**（调用方应走幂等返回：`executed=false`）；
 *   - `RUNNING` ⇒ 不可执行（已有在途执行；避免两个执行体并发推进同一批 Fold）。
 */
export function assertWalkForwardRunCanExecute(status: WalkForwardRunStatus): void {
  if (status === "CREATED" || status === "FAILED" || status === "CANCELLED") return;
  const reason = status === "COMPLETED"
    ? "已完成的 Walk-Forward Run **不允许再次执行**（规格 §12）；重复 start 应走幂等返回 executed=false，既不重跑也不重算。"
    : "该 Run 正在执行中（status=RUNNING），不得并发启动第二个执行体。";
  throw new ResearchValidationError([
    {
      code: "WALK_FORWARD_RUN_NOT_EXECUTABLE",
      path: "status",
      message: `Walk-Forward Run 当前状态 ${status} 不可执行：${reason}`,
    },
  ]);
}

/** 是否可执行（不抛错的版本，供视图 `canExecute` 字段使用）。 */
export function canExecuteWalkForwardRun(status: WalkForwardRunStatus): boolean {
  return status === "CREATED" || status === "FAILED" || status === "CANCELLED";
}

// ---------------------------------------------------------------------------
// Fold 顺序纪律（规格 §11：后一 Fold 不得被当前 Fold 使用）
// ---------------------------------------------------------------------------

/**
 * 断言「要开始第 index 个 Fold 时，它之前的所有 Fold 都已是终态」。
 *
 * 为什么必须有：Fold 之间虽然窗口不重叠，但**执行顺序**一旦乱掉，
 * 「当前 Fold 的 Search 只使用自己的 IS」这条纪律就无法靠数据面证明 ——
 * 一个前序 Fold 还在 SEARCH_RUNNING 时启动后序 Fold，会让「哪个搜索读了哪段数据」
 * 的审计结论失效（两个搜索在时间上交错）。⇒ 本域强制**串行推进**。
 */
export function assertFoldExecutionOrder(input: {
  readonly foldIndex: number;
  readonly statuses: readonly WalkForwardFoldStatus[];
}): void {
  const issues: { code: string; path: string; message: string }[] = [];
  for (let index = 0; index < input.foldIndex; index += 1) {
    const status = input.statuses[index];
    if (status === undefined) {
      issues.push({
        code: "WALK_FORWARD_FOLD_ORDER_INVALID",
        path: `folds[${String(index)}]`,
        message: `排程序号不连续：要执行 folds[${String(input.foldIndex)}]，但 folds[${String(index)}] 缺失。`,
      });
      continue;
    }
    if (!isWalkForwardFoldTerminal(status)) {
      issues.push({
        code: "WALK_FORWARD_FOLD_ORDER_INVALID",
        path: `folds[${String(index)}].status`,
        message:
          `Fold 必须**串行推进**：要执行 folds[${String(input.foldIndex)}]，`
          + `但更早的 folds[${String(index)}] 仍处于非终态 ${status}。`,
      });
    }
  }
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}
