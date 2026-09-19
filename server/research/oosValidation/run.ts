/**
 * OOS-001 §12 — OOS Run 状态机 · ID · 指纹 · 进度（纯域层，零 IO）。
 *
 * ## 状态机（**复用** Parameter Search 的唯一权威迁移表）
 *
 * ```text
 *   CREATED ──start──▶ RUNNING ──┬─▶ COMPLETED
 *      │                  │      └─▶ FAILED ──retry──▶ RUNNING
 *      └──cancel──────────┴─▶ CANCELLED ──resume──▶ RUNNING
 * ```
 *
 * 🔴 迁移表唯一权威 = `server/research/parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS`。
 *   规格 §12 明确要求「不要新建与 Parameter Search 完全不同的状态语义」，因此本域**不另立**一张表，
 *   只复用它在失败时抛本域领域码（`OOS_STATUS_TRANSITION_INVALID`），
 *   与 `searchRobustness/run.ts` 的做法**逐字一致**（两处状态机漂移在结构上不可能发生）。
 *
 * ## 与 PS 的一处**必要差异**（规格 §12：「COMPLETED 不允许再次执行」）
 *
 * PS 的迁移表允许 `COMPLETED → RUNNING`（那是为**重试失败组合 / 续跑未完成组合**而存在的）。
 * 本域是「1 个 Run = 1 个冻结候选」：`COMPLETED` 意味着那个候选已经**跑完并落档**，
 * 再跑一次只会覆盖同一行、得不到新信息。⇒ 本域在 `assertOosRunCanExecute` 里**额外收紧**：
 * `COMPLETED` ⇒ 幂等返回既有结果（`executed = false`），**不进入 RUNNING**。
 * 这不是第二张迁移表，而是对同一张表的**更严调用**（表允许 ⊃ 本域允许）。
 */

import { createHash, randomBytes } from "node:crypto";
import { PARAMETER_SEARCH_RUN_STATUSES } from "../../../shared/parameterSearchContracts";
import { ResearchValidationError } from "../experimentValidation";
import { canTransitionSearchRun } from "../parameterSearch/searchRun";
import { canonicalStringify } from "../../researchDataset/version";
import {
  OOS_VALIDATION_RUN_ID_PREFIX,
  type OosValidationRunStatus,
} from "./types";

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

/** 是否允许该迁移（同一权威 `canTransitionSearchRun`；同态视为幂等重放）。 */
export function canTransitionOosRun(
  from: OosValidationRunStatus,
  to: OosValidationRunStatus,
): boolean {
  return canTransitionSearchRun(from, to);
}

/** 断言迁移合法，否则抛本域领域码 `OOS_STATUS_TRANSITION_INVALID`。 */
export function assertOosRunTransition(
  from: OosValidationRunStatus,
  to: OosValidationRunStatus,
): void {
  if (canTransitionOosRun(from, to)) return;
  throw new ResearchValidationError([
    {
      code: "OOS_STATUS_TRANSITION_INVALID",
      path: "status",
      message:
        `OOS Run 状态迁移非法：${from} → ${to}；`
        + "唯一权威迁移表见 parameterSearch/searchRun.ts#PARAMETER_SEARCH_RUN_TRANSITIONS"
        + "（同态重放视为幂等）。",
    },
  ]);
}

/** 判断取值是否为合法状态（读库行校验；非法值**响亮报错**，不默认成 CREATED）。 */
export function isOosRunStatus(value: unknown): value is OosValidationRunStatus {
  return (
    typeof value === "string"
    && (PARAMETER_SEARCH_RUN_STATUSES as readonly string[]).includes(value)
  );
}

/** 解析状态（非法即抛；不静默回落）。 */
export function parseOosRunStatus(value: unknown): OosValidationRunStatus {
  if (!isOosRunStatus(value)) {
    throw new ResearchValidationError([
      {
        code: "OOS_STATUS_UNKNOWN",
        path: "status",
        message:
          `未知 OOS Run 状态：${String(value)}`
          + "（合法：CREATED / RUNNING / COMPLETED / FAILED / CANCELLED）。",
      },
    ]);
  }
  return value;
}

/**
 * 本域的**执行准入**（比迁移表更严，见文件头）。
 *
 * - `CREATED` / `FAILED` / `CANCELLED` ⇒ 允许执行（首次执行 / 重试）；
 * - `COMPLETED` ⇒ **不允许**（幂等：调用方直接读既有结果并回报 `executed = false`）；
 * - `RUNNING` ⇒ 不允许（同 Run 的单飞；并发 start 会被拒，避免两份重跑互相覆盖）。
 */
export function assertOosRunCanExecute(status: OosValidationRunStatus): void {
  if (status === "COMPLETED") {
    throw new ResearchValidationError([
      {
        code: "OOS_RUN_ALREADY_COMPLETED",
        path: "status",
        message:
          "OOS Run 已 COMPLETED ⇒ 不允许再次执行（规格 §12）。"
          + "同一份冻结候选重复执行不会产出新信息；如需重跑请新建一次 OOS 验证。",
      },
    ]);
  }
  if (status === "RUNNING") {
    throw new ResearchValidationError([
      {
        code: "OOS_RUN_ALREADY_RUNNING",
        path: "status",
        message: "OOS Run 正在 RUNNING ⇒ 拒绝并发执行（单飞），避免两份重跑互相覆盖。",
      },
    ]);
  }
}

// ---------------------------------------------------------------------------
// ID
// ---------------------------------------------------------------------------

/** 生成 OOS Run ID：`OOSV-YYYYMMDD-XXXXXXXX`（UTC 日期 + 后缀）。 */
export function generateOosValidationRunId(now: Date, suffix?: string): string {
  const date =
    `${now.getUTCFullYear()}`
    + `${String(now.getUTCMonth() + 1).padStart(2, "0")}`
    + `${String(now.getUTCDate()).padStart(2, "0")}`;
  const tail = suffix ?? randomSuffix();
  return `${OOS_VALIDATION_RUN_ID_PREFIX}-${date}-${tail.toLowerCase()}`;
}

function randomSuffix(): string {
  // 用 crypto 而非 Math.random：ID 会进 URL 深链，需足够的碰撞裕度。
  return randomBytes(4).toString("hex");
}

// ---------------------------------------------------------------------------
// 指纹（确定性判据：同内容 ⇒ 同指纹）
// ---------------------------------------------------------------------------

/** 剥掉指纹与时间戳后的 canonical 序列化（时间戳不参与内容身份）。 */
function stablePayload(record: Record<string, unknown>): string {
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (key === "fingerprint" || key === "runFingerprint") continue;
    if (key === "createdAt" || key === "updatedAt" || key === "startedAt" || key === "completedAt") {
      continue;
    }
    clone[key] = record[key];
  }
  return canonicalStringify(clone);
}

/**
 * 内容指纹 sha256。
 *
 * ⚠️ 带 `oos` 前缀是因为仓库里已有两个同名 `fingerprintOf`
 *   （`searchRobustness/canonical.ts`、`strategyCore/canonical.ts`）——
 *   去掉前缀会在 `export *` 聚合时发生**静默遮蔽**。
 */
export function oosFingerprintOf(record: Record<string, unknown>): string {
  return createHash("sha256").update(stablePayload(record), "utf8").digest("hex");
}

/** OOS Run 内容指纹。 */
export function computeOosRunFingerprint(record: Record<string, unknown>): string {
  return oosFingerprintOf(record);
}

/** OOS Result 内容指纹（**确定性判据**：规格 §16 T6 用它与 `backtestFingerprint` 判定重跑一致）。 */
export function computeOosResultFingerprint(record: Record<string, unknown>): string {
  return oosFingerprintOf(record);
}
