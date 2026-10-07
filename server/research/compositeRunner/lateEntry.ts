/**
 * P8 · 延迟入场 / 晚窗口滚动 3F 重评分（selection-layer only）。
 *
 * 两种模式：
 *   - delay：原 T+5 topN 排名不变，只把 intent 移到目标决策日 D=T+k；
 *   - rescore：原 T+5 topN 作为候选门槛，在 D 用最近 5 日滚动 3F 重排后取前 N。
 *
 * 只改 CandidateEvaluationRun.days[].selected / positionIntents；
 * 不触碰 simulator / Portfolio / Order / Fill。
 */
import { evaluateCandidateRun } from "../signalEngine/evaluate";
import { computeCandidateEvaluationRunFingerprint } from "../signalEngine/serialize";
import type { CandidateDayRecord, CandidateEvaluationRun } from "../signalEngine/types";
import type { LateEntryScore } from "../recipeFeatures/lateEntryScoreFeatures";
import type { BuiltCompositeArm } from "./index";

export interface CompositeLateEntryPolicy {
  readonly mode: "delay" | "rescore";
  /** 目标事件相对日：7 / 8 / 10。 */
  readonly decisionRelativeDay: number;
  /** 原 T+5 候选门槛：delay 用 3，rescore 用 5。 */
  readonly sourceTopN: number;
  /** 目标日输出给 simulator 的候选数；本轮固定 3。 */
  readonly outputTopN: number;
  /** rescore 模式必须提供；delay 模式忽略。 */
  readonly scoreOf?: (
    securityId: string,
    decisionDate: string,
  ) => LateEntryScore | null;
  /** delay 模式可选：目标日是否可交易；返回 false 则丢弃该候选。 */
  readonly targetAvailableOf?: (
    securityId: string,
    decisionDate: string,
  ) => boolean;
}

export interface CompositeLateEntryAccounting {
  readonly sourceCandidates: number;
  readonly shiftedCandidates: number;
  readonly droppedMissingTargetDate: number;
  readonly droppedUnavailableTarget: number;
  readonly droppedUnscorable: number;
  readonly selectedCandidates: number;
}

interface LateCandidate {
  readonly securityId: string;
  readonly sourceRank: number;
  readonly targetDate: string;
  readonly score: number | null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertPolicy(policy: CompositeLateEntryPolicy): void {
  if (policy.mode !== "delay" && policy.mode !== "rescore") {
    throw new Error("applyCompositeLateEntry: mode 必须是 delay 或 rescore。");
  }
  if (!Number.isInteger(policy.decisionRelativeDay) || policy.decisionRelativeDay < 6) {
    throw new Error("applyCompositeLateEntry: decisionRelativeDay 必须是 >= 6 的整数。");
  }
  if (!Number.isInteger(policy.sourceTopN) || policy.sourceTopN < 1) {
    throw new Error("applyCompositeLateEntry: sourceTopN 必须是正整数。");
  }
  if (!Number.isInteger(policy.outputTopN) || policy.outputTopN < 1) {
    throw new Error("applyCompositeLateEntry: outputTopN 必须是正整数。");
  }
  if (policy.outputTopN > policy.sourceTopN) {
    throw new Error("applyCompositeLateEntry: outputTopN 不得大于 sourceTopN。");
  }
  if (policy.mode === "rescore" && policy.scoreOf === undefined) {
    throw new Error("applyCompositeLateEntry: rescore 模式必须提供 scoreOf。");
  }
}

/** 把 base source run 转成延迟入场版本。控制臂不得调用。 */
export function applyCompositeLateEntry(
  base: BuiltCompositeArm,
  policy: CompositeLateEntryPolicy,
  targetDateOf: (securityId: string, decisionRelativeDay: number) => string | null,
): BuiltCompositeArm {
  assertPolicy(policy);
  const candidates: LateCandidate[] = [];
  const accounting = {
    sourceCandidates: 0,
    shiftedCandidates: 0,
    droppedMissingTargetDate: 0,
    droppedUnavailableTarget: 0,
    droppedUnscorable: 0,
    selectedCandidates: 0,
  };

  for (const day of base.sourceRun.days) {
    for (const intent of day.positionIntents) {
      if (intent.direction !== "long" || intent.rank > policy.sourceTopN) continue;
      accounting.sourceCandidates += 1;
      const targetDate = targetDateOf(intent.securityId, policy.decisionRelativeDay);
      if (targetDate === null) {
        accounting.droppedMissingTargetDate += 1;
        continue;
      }
      if (policy.mode === "delay") {
        if (policy.targetAvailableOf !== undefined
          && !policy.targetAvailableOf(intent.securityId, targetDate)) {
          accounting.droppedUnavailableTarget += 1;
          continue;
        }
        candidates.push({
          securityId: intent.securityId,
          sourceRank: intent.rank,
          targetDate,
          score: null,
        });
        accounting.shiftedCandidates += 1;
        continue;
      }

      const lateScore = policy.scoreOf!(intent.securityId, targetDate);
      if (lateScore === null || !finite(lateScore.score)) {
        accounting.droppedUnscorable += 1;
        continue;
      }
      candidates.push({
        securityId: intent.securityId,
        sourceRank: intent.rank,
        targetDate,
        score: lateScore.score,
      });
      accounting.shiftedCandidates += 1;
    }
  }

  const byDate = new Map<string, LateCandidate[]>();
  for (const candidate of candidates) {
    const list = byDate.get(candidate.targetDate) ?? [];
    list.push(candidate);
    byDate.set(candidate.targetDate, list);
  }

  const days: CandidateDayRecord[] = [];
  for (const [date, list] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const ranked = [...list].sort((left, right) => {
      if (policy.mode === "rescore") {
        const byScore = (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY);
        if (byScore !== 0) return byScore;
      }
      return left.sourceRank !== right.sourceRank
        ? left.sourceRank - right.sourceRank
        : left.securityId.localeCompare(right.securityId);
    });
    const selectedRanked = ranked.slice(0, policy.outputTopN);
    accounting.selectedCandidates += selectedRanked.length;
    const selected = selectedRanked.map((candidate, index) => ({
      securityId: candidate.securityId,
      rank: index + 1,
      percentile: ranked.length === 0 ? 0 : 1 - index / ranked.length,
      value: policy.mode === "rescore" ? candidate.score! : 1 - index / ranked.length,
    }));
    const positionIntents = selected.map((candidate) => ({
      securityId: candidate.securityId,
      direction: "long" as const,
      rank: candidate.rank,
      percentile: candidate.percentile,
      weight: selected.length === 0 ? 0 : 1 / selected.length,
      signalValue: candidate.value,
      confidence: null,
    }));
    days.push({
      date,
      universeMembers: ranked.map((candidate) => candidate.securityId).sort(),
      signalCount: ranked.length,
      dropped: [],
      selected,
      positionIntents,
    });
  }

  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    ...base.sourceRun,
    parameters: {
      ...base.sourceRun.parameters,
      lateEntryMode: policy.mode,
      lateEntryDecisionRelativeDay: policy.decisionRelativeDay,
      lateEntrySourceTopN: policy.sourceTopN,
      lateEntryOutputTopN: policy.outputTopN,
      ...(policy.mode === "rescore" ? { lateEntryScoreVersion: "late-entry-3f-rolling-5-v1.0.0" } : {}),
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
    lateEntryAccounting: accounting,
  };
}
