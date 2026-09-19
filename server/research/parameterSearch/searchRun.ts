/**
 * PARAMETER-001 §7/§8 — Search Run 状态机 + 进度 + 创建（纯域层）。
 *
 * ## 状态机（规格 §7）
 *
 * ```text
 *   CREATED ──start──▶ RUNNING ──┬─▶ COMPLETED
 *      │                  │      ├─▶ FAILED ──retry/resume──▶ RUNNING
 *      │                  │      └─▶ CANCELLED ──resume──▶ RUNNING
 *      └──cancel──────────┴─▶ CANCELLED
 *
 *   COMPLETED ──retry（对失败组合重试）──▶ RUNNING
 * ```
 *
 * 🔴 允许回 `RUNNING` 的两个入口都**只**为「重试失败组合 / 继续未完成组合」而存在
 *   （规格 §13 Retry / Resume）。除此之外**没有任何**改历史状态的理由；
 *   本模块不提供任何修改已完成 Run 的**结果**的入口。
 *
 * ## 进度口径（唯一）
 *
 * `completedCount` = **评估成功**的组合数（结果行 status = SUCCEEDED）；
 * `failedCount` = **评估失败**的组合数（组合行 status = FAILED）；
 * 二者互斥、并集 ⊆ `combinationCount`。**不把 SKIPPED 计入任何一边**
 * （SKIPPED = 本 Run 未计划执行该组合），避免「进度看起来 100% 但结果不全」。
 *
 * ## 快照纪律（规格 §7 末句）
 *
 * `parameterSpaceSnapshot` 必须**随 Run 落库**：未来策略版本被修改后，
 * 历史 Run 的搜索空间**不得**被重新解释。本模块只负责把快照与指纹一起投影进 Run 视图。
 */

import { createHash, randomBytes } from "node:crypto";
import {
  PARAMETER_SEARCH_RUN_STATUSES,
  type ParameterSearchRunStatus,
  type ParameterSearchRunView,
} from "../../../shared/parameterSearchContracts";
import { ResearchValidationError } from "../experimentValidation";
import { canonicalStringify } from "../../researchDataset/version";

/** Search Run ID 前缀（风格对齐既有 `SEARCH` 前缀，便于人工辨认）。 */
export const PARAMETER_SEARCH_RUN_ID_PREFIX = "PSRUN";

/** 状态迁移表：`from → 允许到达的集合`（唯一权威；`assertTransition` 与测试共用）。 */
export const PARAMETER_SEARCH_RUN_TRANSITIONS: Readonly<
  Record<ParameterSearchRunStatus, readonly ParameterSearchRunStatus[]>
> = {
  CREATED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED"],
  // 重试失败组合 / 继续未完成组合（规格 §13）
  FAILED: ["RUNNING", "CANCELLED"],
  COMPLETED: ["RUNNING"],
  CANCELLED: ["RUNNING"],
};

/** 终态（没有「必然继续」的状态；`COMPLETED` 仍可因 retry 回到 RUNNING，故这里只是语义标注）。 */
export const PARAMETER_SEARCH_RUN_TERMINAL_STATUSES: readonly ParameterSearchRunStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

/** 是否允许该迁移。 */
export function canTransitionSearchRun(
  from: ParameterSearchRunStatus,
  to: ParameterSearchRunStatus,
): boolean {
  if (from === to) return true; // 幂等重放：同态不视为非法
  return PARAMETER_SEARCH_RUN_TRANSITIONS[from].includes(to);
}

/** 断言迁移合法，否则抛 `ResearchValidationError`（领域码 `PARAMETER_SEARCH_STATUS_TRANSITION_INVALID`）。 */
export function assertSearchRunTransition(
  from: ParameterSearchRunStatus,
  to: ParameterSearchRunStatus,
): void {
  if (canTransitionSearchRun(from, to)) return;
  throw new ResearchValidationError([
    {
      code: "PARAMETER_SEARCH_STATUS_TRANSITION_INVALID",
      path: "status",
      message:
        `Search Run 状态迁移非法：${from} → ${to}；`
        + `允许：${PARAMETER_SEARCH_RUN_TRANSITIONS[from].join(" / ")}（同态重放视为幂等）。`,
    },
  ]);
}

/** 判断取值是否为合法状态（读库行校验用；非法值**响亮报错**，不默认成 CREATED）。 */
export function isParameterSearchRunStatus(value: unknown): value is ParameterSearchRunStatus {
  return typeof value === "string" && (PARAMETER_SEARCH_RUN_STATUSES as readonly string[]).includes(value);
}

/** 解析状态（非法即抛；不静默回落）。 */
export function parseParameterSearchRunStatus(value: unknown): ParameterSearchRunStatus {
  if (!isParameterSearchRunStatus(value)) {
    throw new ResearchValidationError([
      {
        code: "PARAMETER_SEARCH_STATUS_UNKNOWN",
        path: "status",
        message: `未知 Search Run 状态：${String(value)}（合法：${PARAMETER_SEARCH_RUN_STATUSES.join(" / ")}）`,
      },
    ]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// 进度
// ---------------------------------------------------------------------------

/** 进度快照（列表 / 详情共用；**唯一**进度算法）。 */
export interface ParameterSearchRunProgress {
  readonly combinationCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  /** 已终结（成功 + 失败）的组合数。 */
  readonly settledCount: number;
  /** 尚未终结的组合数（= combinationCount − settledCount，不小于 0）。 */
  readonly pendingCount: number;
  /** 进度百分比（0~100；`combinationCount = 0` 时 100，因为「没有组合要跑 = 已跑完」）。 */
  readonly progressPct: number;
}

/** 计算进度（纯函数；不读库）。 */
export function computeRunProgress(input: {
  readonly combinationCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
}): ParameterSearchRunProgress {
  const total = Math.max(0, input.combinationCount);
  const completed = Math.max(0, input.completedCount);
  const failed = Math.max(0, input.failedCount);
  const settled = Math.min(total, completed + failed);
  const pending = Math.max(0, total - settled);
  const progressPct = total === 0 ? 100 : Math.round((settled / total) * 10000) / 100;
  return {
    combinationCount: total,
    completedCount: completed,
    failedCount: failed,
    settledCount: settled,
    pendingCount: pending,
    progressPct,
  };
}

// ---------------------------------------------------------------------------
// ID
// ---------------------------------------------------------------------------

/** 生成 Search Run ID：`PSRUN-YYYYMMDD-XXXXXXXX`（UTC 日期 + 4 字节随机十六进制）。 */
export function generateParameterSearchRunId(now: Date = new Date(), suffix?: string): string {
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const tail = (suffix ?? randomBytes(4).toString("hex")).toLowerCase();
  return `${PARAMETER_SEARCH_RUN_ID_PREFIX}-${date}-${tail}`;
}

// ---------------------------------------------------------------------------
// 参数空间指纹 / 快照
// ---------------------------------------------------------------------------

/**
 * 参数空间快照指纹（sha256）。
 *
 * 🔴 与既有 `sweep.ts#computeParameterSpaceFingerprint` **刻意不同**：
 *   那个只对 `SweepParameterSpace` 求指纹（不含 strategyId / strategyVersion）；
 *   本 Run 的快照必须覆盖**富定义**（含 kind / defaultValue / exclusionReason）与策略身份，
 *   否则「同一策略换了分类（TUNABLE→FIXED）」不会让指纹变化 ⇒ 快照失去意义。
 *   ⇒ 本函数是 **Run 快照的指纹**，不是第二套「参数空间指纹」；两者用途不同，各自唯一。
 */
export function computeRunSpaceSnapshotFingerprint(
  snapshotJson: string,
): string {
  return createHash("sha256").update(snapshotJson, "utf8").digest("hex");
}

/** FIXED 坐标快照（回答「这次搜索固定了什么」）。 */
export interface ParameterSearchFixedCoordinates {
  readonly strategyVersionId: string;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly executionPolicyVersion: number;
  readonly evaluationConfigFingerprint: string;
}

/** FIXED 坐标的稳定字符串（落库 `fixedCoordinatesJson`）。 */
export function serializeFixedCoordinates(coordinates: ParameterSearchFixedCoordinates): string {
  return canonicalStringify(coordinates);
}

// ---------------------------------------------------------------------------
// Run 视图投影（读库行 → wire 视图；唯一落点）
// ---------------------------------------------------------------------------

/** 校验 Run 视图的计数自洽（读库后立刻验，防止脏行被当成正常数据渲染）。 */
export function assertRunCountersConsistent(view: {
  readonly combinationCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly status: ParameterSearchRunStatus;
}): readonly string[] {
  const notes: string[] = [];
  if (view.completedCount + view.failedCount > view.combinationCount) {
    notes.push(
      `计数不自洽：completed(${String(view.completedCount)}) + failed(${String(view.failedCount)})`
      + ` > combinationCount(${String(view.combinationCount)})`,
    );
  }
  if (view.status === "COMPLETED" && view.completedCount + view.failedCount !== view.combinationCount) {
    notes.push(
      `状态为 COMPLETED 但组合未全部终结（${String(view.completedCount + view.failedCount)} / ${String(view.combinationCount)}）`,
    );
  }
  if (view.status === "CREATED" && (view.completedCount !== 0 || view.failedCount !== 0)) {
    notes.push("状态为 CREATED 但已有终结组合（应为 0）");
  }
  return notes;
}

/** Run 视图的最小输入约束（供仓储层与测试共用；只做结构核对，不做 IO）。 */
export function isParameterSearchRunViewLike(value: unknown): value is ParameterSearchRunView {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["searchRunId"] === "string"
    && typeof record["strategyId"] === "string"
    && typeof record["strategyVersion"] === "string"
    && isParameterSearchRunStatus(record["status"])
    && typeof record["combinationCount"] === "number"
  );
}
