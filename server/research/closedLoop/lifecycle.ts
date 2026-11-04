/**
 * STEP 25 / C-25.1 — Closed Loop：生命周期整合（finalize 阶段）——复用 C-21.1，零改写。
 *
 * 职责：
 *   - attemptClosedLoopLifecycleAdvance：对 C-21.1 StrategyLifecycleRecord 尝试一次迁移
 *     （复用 applyLifecycleTransition 作为唯一状态变更入口）；
 *   - 证据门槛诚实化：preflight 用 C-21.1 collectTransitionRequirementIssues（import 只读）
 *     收集 issue——仅含 LIFECYCLE_THRESHOLD_*（evidence/experiment 缺失档位门槛）→ 判定为
 *     合法 BLOCKED（CL_GATE_EVIDENCE_MISSING，无证据不推进）；含跳级/时间戳非法等其它
 *     issue → 视为调用方错误响亮抛 ClosedLoopError（CL_LIFECYCLE_TRANSITION_INVALID）；
 *   - 合成边界：链上 dataset 为 synthetic 时，若 evidence 携带 datasetGate PASS 并用于
 *     →Validated/→Production 推进，除非调用方显式 allowSyntheticEvidence（仅测试），否则
 *     一律按 CL_GATE_EVIDENCE_MISSING 阻塞——防「合成结果冒充真实数据链认证」。
 *
 * 铁律：不自动 promotion（production 决策留人工 + gate）；本模块只执行调用方声明的
 * transition 意图，绝不替调用方决定迁移目标。
 */

import { ClosedLoopError, CLOSED_LOOP_ERROR_CODES } from "./errors";
import { CLOSED_LOOP_GATE_THRESHOLD_ISSUE_PREFIX, type ClosedLoopBlockedReasonCode } from "./blockers";
import type {
  ClosedLoopFinalizeRef,
  ClosedLoopLifecycleConfig,
  ClosedLoopSourceRef,
} from "./types";
import { applyLifecycleTransition } from "../lifecycle/map";
import { collectTransitionRequirementIssues } from "../lifecycle/gates";
import type {
  LifecycleEvidenceRef,
  LifecycleTransition,
  LifecycleTransitionInput,
  StrategyLifecycleRecord,
} from "../lifecycle/types";

// ---------------------------------------------------------------------------
// 生命周期推进 outcome
// ---------------------------------------------------------------------------

/** 推进结果：advanced（已迁移并产出新记录）| blocked（证据门槛未满足）。 */
export type ClosedLoopLifecycleAdvanceOutcome =
  | {
      readonly status: "advanced";
      readonly record: StrategyLifecycleRecord;
      readonly transition: LifecycleTransition;
      readonly evidenceIsSynthetic: boolean;
    }
  | {
      readonly status: "blocked";
      readonly reasonCode: ClosedLoopBlockedReasonCode;
      readonly detail: string;
      readonly evidenceIsSynthetic: boolean;
    };

/** issue code 是否属 evidence 门槛类（LIFECYCLE_THRESHOLD_*）。 */
export function isClosedLoopEvidenceThresholdIssueCode(code: string): boolean {
  return code.startsWith(CLOSED_LOOP_GATE_THRESHOLD_ISSUE_PREFIX);
}

/** evidence 中是否存在 datasetGate PASS 引用。 */
export function hasClosedLoopDatasetGatePassEvidence(evidence: readonly LifecycleEvidenceRef[]): boolean {
  return evidence.some((ref) => ref.kind === "datasetGate" && ref.gate === "PASS");
}

function lastTransition(record: StrategyLifecycleRecord): LifecycleTransition {
  const tail = record.transitions[record.transitions.length - 1];
  if (tail === undefined) {
    throw new ClosedLoopError(
      CLOSED_LOOP_ERROR_CODES.CL_LIFECYCLE_TRANSITION_INVALID,
      `closedLoop: 生命周期壳 ${record.strategyId}@${record.strategyVersion} 的 transitions 为空（应至少含 genesis 首跳）`,
    );
  }
  return tail;
}

/**
 * 尝试一次生命周期推进（纯函数、确定性；失败语义见文件头）。
 *
 * @param syntheticDataset 闭环链 dataset 是否 synthetic（真实数据链就绪前为 true；
 *         阻止用合成 dataset gate 声明的 evidence 推进到 Validated/Production）。
 * @param allowSyntheticEvidence 显式放行合成 evidence（仅测试；生产路径禁止）。
 */
export function attemptClosedLoopLifecycleAdvance(
  record: StrategyLifecycleRecord,
  transition: LifecycleTransitionInput,
  options?: { readonly syntheticDataset?: boolean; readonly allowSyntheticEvidence?: boolean },
): ClosedLoopLifecycleAdvanceOutcome {
  const syntheticDataset = options?.syntheticDataset ?? false;
  const allowSyntheticEvidence = options?.allowSyntheticEvidence ?? false;
  const experimentId = transition.experimentId ?? null;
  const evidence = transition.evidence ?? [];
  const actor = transition.actor ?? null;

  // preflight：复用 C-21.1 门槛收集（不吞异常；只分类）。
  const issues = collectTransitionRequirementIssues(
    record.status,
    transition.to,
    transition.timestamp,
    transition.reason,
    experimentId,
    evidence,
    actor,
    "closedLoop.finalize.lifecycle",
  );

  const syntheticGateClaim =
    syntheticDataset && hasClosedLoopDatasetGatePassEvidence(evidence);

  if (issues.length === 0) {
    if (syntheticGateClaim && !allowSyntheticEvidence) {
      return {
        status: "blocked",
        reasonCode: "CL_GATE_EVIDENCE_MISSING",
        detail:
          "闭环链 dataset 为 synthetic（无真实数据 gate PASS 认证）；evidence 携带的 datasetGate PASS " +
          "属合成声明——禁止据此推进生命周期（→Validated/→Production 需真实数据链证据；仅测试可显式 allowSyntheticEvidence）",
        evidenceIsSynthetic: true,
      };
    }
    const next = applyLifecycleTransition(record, transition);
    return {
      status: "advanced",
      record: next,
      transition: lastTransition(next),
      evidenceIsSynthetic: syntheticGateClaim,
    };
  }

  const allThreshold = issues.every((it) => isClosedLoopEvidenceThresholdIssueCode(it.code));
  if (allThreshold) {
    const detail =
      issues.length <= 3
        ? issues.map((it) => it.message).join("；")
        : `${issues.length} 项 evidence 门槛未满足（首项：${issues[0]!.message}）`;
    return {
      status: "blocked",
      reasonCode: "CL_GATE_EVIDENCE_MISSING",
      detail,
      evidenceIsSynthetic: false,
    };
  }

  // 非门槛 issue（跳级 / 时间戳 / reason 非法 / 引用形态错）→ 调用方错误，响亮抛错。
  throw new ClosedLoopError(
    CLOSED_LOOP_ERROR_CODES.CL_LIFECYCLE_TRANSITION_INVALID,
    `closedLoop: 生命周期迁移请求非法（${issues.length} 项非门槛问题）：${issues.map((it) => it.message).join("；")}`,
    { issues: issues.map((it) => ({ code: it.code, path: it.path, message: it.message })) },
  );
}

// ---------------------------------------------------------------------------
// finalizeRef 装配（生命周期推进的交接摘要）
// ---------------------------------------------------------------------------

/** assembleClosedLoopFinalizeRef 的纯输入（不依赖编排上下文，纯映射）。 */
export interface ClosedLoopAssemblyFinalizePure {
  readonly config: ClosedLoopLifecycleConfig;
  readonly outcome: ClosedLoopLifecycleAdvanceOutcome;
  readonly source: ClosedLoopSourceRef;
  readonly runSummary: ClosedLoopFinalizeRef["runSummary"];
  readonly promotion: {
    readonly considered: boolean;
    readonly applied: boolean;
    readonly detail: string;
  };
  readonly strategyKey: { readonly strategyId: string; readonly strategyVersion: string };
}

/** 装配 finalize 交接摘要（纯映射；只读 config，不外泄整份 lifecycle record）。 */
export function assembleClosedLoopFinalizeRef(input: ClosedLoopAssemblyFinalizePure): ClosedLoopFinalizeRef {
  const { config, outcome, source, runSummary, promotion, strategyKey } = input;
  const record = outcome.status === "advanced" ? outcome.record : config.lifecycleRecord;
  return {
    kind: "finalizeRef",
    handoffVersion: 1,
    synthetic: outcome.evidenceIsSynthetic || runSummary.synthetic,
    source,
    lifecycle: {
      strategyId: strategyKey.strategyId,
      strategyVersion: strategyKey.strategyVersion,
      from: config.lifecycleRecord.status,
      to: record.status,
      advanced: outcome.status === "advanced",
      transitionSeq: outcome.status === "advanced" ? outcome.transition.seq : null,
      recordFingerprint: record.fingerprint,
      blockedReasonCode: outcome.status === "blocked" ? outcome.reasonCode : null,
    },
    promotion: {
      considered: promotion.considered,
      applied: promotion.applied,
      evidenceIsSynthetic: outcome.evidenceIsSynthetic,
      detail: promotion.detail,
    },
    runSummary,
  };
}

/** assemble 的纯输入（strategyKey 便于函数无关 ctx）。 */
export interface ClosedLoopAssemblyFinalizePure {
  readonly config: ClosedLoopLifecycleConfig;
  readonly outcome: ClosedLoopLifecycleAdvanceOutcome;
  readonly source: ClosedLoopSourceRef;
  readonly runSummary: ClosedLoopFinalizeRef["runSummary"];
  readonly promotion: {
    readonly considered: boolean;
    readonly applied: boolean;
    readonly detail: string;
  };
  readonly strategyKey: { readonly strategyId: string; readonly strategyVersion: string };
}
