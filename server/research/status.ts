/**
 * STEP 6.2 — Experiment / Run 状态机。
 *
 * 禁止任意字符串状态（"done"/"finish"/"successed"/"running2" 等一律不允许）；
 * 状态迁移必须受约束。实验状态沿用 STEP 6.1 契约（created/running/completed/failed），
 * 本步骤不重构 6.1，仅在服务层强制合法迁移。
 */

import type { ResearchExperimentStatus } from "./types";
import type { ResearchRunStatus } from "./run";
import type { SweepBatchStatus } from "./sweep";

/** 实验状态合法迁移。completed/failed → running 属于「一个实验多次 Run」的显式重执行机制。 */
export const EXPERIMENT_STATUS_TRANSITIONS: Record<ResearchExperimentStatus, readonly ResearchExperimentStatus[]> = {
  created: ["running"],
  running: ["completed", "failed"],
  completed: ["running"],
  failed: ["running"],
};

/** Run 状态合法迁移（同步执行：running → succeeded | failed，无中间态）。 */
export const RUN_STATUS_TRANSITIONS: Record<ResearchRunStatus, readonly ResearchRunStatus[]> = {
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

/**
 * Batch 状态合法迁移。批次只运行一次（created → running → completed | failed）；
 * 重跑同一参数空间应新建 Sweep（见 idempotency），而非复用旧批次。
 * cancelled 为保留终态，本阶段顺序执行不实现主动取消。
 */
export const BATCH_STATUS_TRANSITIONS: Record<SweepBatchStatus, readonly SweepBatchStatus[]> = {
  created: ["running"],
  running: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

/** 断言实验状态迁移合法，否则抛错（不静默接受非法迁移）。 */
export function assertExperimentTransition(from: ResearchExperimentStatus, to: ResearchExperimentStatus): void {
  if (!EXPERIMENT_STATUS_TRANSITIONS[from].includes(to)) {
    throw new Error(`非法实验状态迁移：${from} → ${to}`);
  }
}

/** 断言 Run 状态迁移合法，否则抛错。 */
export function assertRunTransition(from: ResearchRunStatus, to: ResearchRunStatus): void {
  if (!RUN_STATUS_TRANSITIONS[from].includes(to)) {
    throw new Error(`非法 Run 状态迁移：${from} → ${to}`);
  }
}

/** 断言 Batch 状态迁移合法，否则抛错。 */
export function assertBatchTransition(from: SweepBatchStatus, to: SweepBatchStatus): void {
  if (!BATCH_STATUS_TRANSITIONS[from].includes(to)) {
    throw new Error(`非法 Batch 状态迁移：${from} → ${to}`);
  }
}
