/**
 * P9 · 事件事实 gate（只减少新开仓候选，不改排序、不替换成 rank4/5）。
 *
 * 约束：
 *   - 只过滤 sourceRun 的 positionIntents / selected；
 *   - 保留原始 rank / percentile，不重新排名；
 *   - 不触碰 simulator / Portfolio / Order / Fill；
 *   - 被过滤掉的事件如果已在持仓（该策略通常不会），candidateExitPolicy=DISABLED
 *     仍由原策略决定是否退出；本 gate 只影响后续新开仓意图。
 */
import { evaluateCandidateRun } from "../signalEngine/evaluate";
import { computeCandidateEvaluationRunFingerprint } from "../signalEngine/serialize";
import type { CandidateDayRecord, CandidateEvaluationRun } from "../signalEngine/types";
import type { BuiltCompositeArm } from "./index";

export interface CompositeEventGatePolicy {
  readonly version: string;
  readonly label: string;
  readonly keepOf: (securityId: string, decisionDate: string) => boolean;
}

export interface CompositeEventGateAccounting {
  readonly inputIntents: number;
  readonly keptIntents: number;
  readonly removedIntents: number;
  readonly daysWithRemoval: number;
}

export function applyCompositeEventGate(
  base: BuiltCompositeArm,
  policy: CompositeEventGatePolicy,
): BuiltCompositeArm {
  if (policy.version.trim() === "" || policy.label.trim() === "") {
    throw new Error("applyCompositeEventGate: version / label 不能为空。");
  }
  const accounting = {
    inputIntents: 0,
    keptIntents: 0,
    removedIntents: 0,
    daysWithRemoval: 0,
  };
  const days: CandidateDayRecord[] = base.sourceRun.days.map((day) => {
    const keptIntents = day.positionIntents.filter((intent) => policy.keepOf(intent.securityId, day.date));
    const keptIds = new Set(keptIntents.map((intent) => intent.securityId));
    const selected = day.selected.filter((candidate) => keptIds.has(candidate.securityId));
    accounting.inputIntents += day.positionIntents.length;
    accounting.keptIntents += keptIntents.length;
    accounting.removedIntents += day.positionIntents.length - keptIntents.length;
    if (keptIntents.length !== day.positionIntents.length) accounting.daysWithRemoval += 1;
    return { ...day, selected, positionIntents: keptIntents };
  });
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    ...base.sourceRun,
    parameters: {
      ...base.sourceRun.parameters,
      eventGateVersion: policy.version,
      eventGateLabel: policy.label,
    },
    days,
    evaluation: evaluateCandidateRun(days),
  };
  return {
    ...base,
    sourceRun: {
      ...body,
      fingerprint: computeCandidateEvaluationRunFingerprint(body),
    },
    eventGateAccounting: accounting,
  };
}
