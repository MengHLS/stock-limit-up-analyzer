/**
 * P6/P7 · 跨日候选池与当日重评分（selection-layer only）。
 *
 * 语义：
 *   - 每日 fresh 候选仍由 buildCompositeSourceRun 产出；
 *   - 前一日未进入“尝试买入名额”的 fresh 候选进入 pending；
 *   - pending 在下一决策日与 fresh 共同重排；
 *   - refresh 缺省 = 沿用原始 3F 分（P6 stale carry）；
 *   - refresh 给出时 = 对 union(fresh, carry) 在**同一决策日**统一计算
 *     CarryRefreshV1 分位，再与原始 3F 融合（P7 same-day re-score）；
 *   - 本函数只改 CandidateEvaluationRun.days[].selected / positionIntents，
 *     不触碰 simulator / Portfolio / Order / Fill。
 *
 * 关键边界：
 *   - “是否买到”是执行层事实，本层拿不到成交回执；按 fresh 排名中未进入
 *     attemptedPerDay 的候选进入 pending（intent-level）。
 *   - pending 只保存原始 3F 分；如果启用 refresh，每一天都重新计算当日状态分，
 *     不会把旧日 refresh 分带入下一日。
 *   - maxAgeDays=0 表示完全不启用 carry，只对 fresh 做当日重评分。
 */
import { rankSignals } from "../framework/ranking";
import { evaluateCandidateRun } from "../signalEngine/evaluate";
import { computeCandidateEvaluationRunFingerprint } from "../signalEngine/serialize";
import type { CandidateDayRecord, CandidateEvaluationRun } from "../signalEngine/types";
import {
  CARRY_REFRESH_COMPONENT_IDS,
  fuseCarryRefreshIntoBaseScore,
  type CarryRefreshComponents,
} from "../recipeFeatures/carryRefreshScoreFeatures";
import type { BuiltCompositeArm } from "./index";

export interface CompositeCarryoverRefreshPolicy {
  /** 评分口径版本（进入 sourceRun.parameters，必须显式版本化）。 */
  readonly version: string;
  /** CarryRefreshV1 分位在融合分中的权重；0 = 纯 3F，1 = 纯 refresh。 */
  readonly weight: number;
  /** 当日 as-of 的 CarryRefreshV1 分量（只读 rd0..当前决策日；缺失返回 null）。 */
  readonly componentsOf: (
    securityId: string,
    decisionDate: string,
  ) => CarryRefreshComponents | null;
}

export interface CompositeCarryoverPolicy {
  /** pending 最多跨多少个决策日；0 = 不启用 carry，只做 fresh refresh。 */
  readonly maxAgeDays: number;
  /** pending 评分至少高出某只 fresh 多少，才允许插到它前面。 */
  readonly replacementScoreMargin: number;
  /** 每日 fresh 中进入常规买入尝试的前 N 名；其余进入 pending。 */
  readonly attemptedPerDay: number;
  /** 可选：当日统一重评分（P7）。 */
  readonly refresh?: CompositeCarryoverRefreshPolicy | null;
}

export interface CompositeCarryoverAccounting {
  /** 新进入 pending 的候选累计数（按 fresh 排名截断）。 */
  readonly queuedCandidates: number;
  /** 每日参与重排的 pending 候选累计数（按天累计，不是去重证券数）。 */
  readonly consideredCarryCandidates: number;
  /** 进入最终 topN 的 pending 候选累计数。 */
  readonly selectedCarryCandidates: number;
  /** 进入前 attemptedPerDay 名、会被 simulator 尝试买入的 pending 候选累计数。 */
  readonly attemptedCarryCandidates: number;
  /** 因超过 maxAgeDays 被淘汰的 pending 候选累计数。 */
  readonly expiredCarryCandidates: number;
  /** P7：当日无有效 bar（停牌等）而无法重评分的 pending 候选累计数。 */
  readonly refreshUnscorableCarryCandidates: number;
}

interface PendingCandidate {
  readonly securityId: string;
  /** 只保存原始 3F 分；refresh 分不跨日缓存。 */
  readonly score: number;
  readonly originDate: string;
  readonly originRank: number;
  readonly ageDays: number;
}

interface RankedCandidate {
  readonly kind: "fresh" | "carry";
  readonly securityId: string;
  /** 当前决策日用于排序的分数（原始 3F 或融合 refresh 后的分数）。 */
  readonly score: number;
  readonly originDate: string;
  readonly originRank: number;
  readonly ageDays: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareId(left: RankedCandidate, right: RankedCandidate): number {
  const byScore = right.score - left.score;
  return byScore !== 0 ? byScore : left.securityId.localeCompare(right.securityId);
}

function asRankedCandidate(item: PendingCandidate): RankedCandidate {
  return { ...item, kind: "carry" };
}

function assertPolicy(policy: CompositeCarryoverPolicy): void {
  if (!Number.isInteger(policy.maxAgeDays) || policy.maxAgeDays < 0) {
    throw new Error("applyCompositeCarryover: maxAgeDays 必须是 >= 0 的整数。");
  }
  if (!finite(policy.replacementScoreMargin) || policy.replacementScoreMargin < 0) {
    throw new Error("applyCompositeCarryover: replacementScoreMargin 必须是非负有限数字。");
  }
  if (!Number.isInteger(policy.attemptedPerDay) || policy.attemptedPerDay < 0) {
    throw new Error("applyCompositeCarryover: attemptedPerDay 必须是 >= 0 的整数。");
  }
  const refresh = policy.refresh;
  if (refresh !== undefined && refresh !== null) {
    if (typeof refresh.version !== "string" || refresh.version.length === 0) {
      throw new Error("applyCompositeCarryover: refresh.version 必须是非空字符串。");
    }
    if (!finite(refresh.weight) || refresh.weight < 0 || refresh.weight > 1) {
      throw new Error("applyCompositeCarryover: refresh.weight 必须位于 [0,1]。");
    }
  }
}

function mergeFreshAndCarry(
  fresh: readonly RankedCandidate[],
  carry: readonly RankedCandidate[],
  replacementScoreMargin: number,
): RankedCandidate[] {
  const carries = [...carry].sort(compareId);
  if (replacementScoreMargin === 0) {
    return [...fresh, ...carries].sort(compareId);
  }

  // margin > 0 时，pending 必须先跨过“fresh 评分 + margin”的门槛，
  // 才允许插到该 fresh 之前；否则留在 fresh 之后，交由 topN 截断。
  const ordered: RankedCandidate[] = [...fresh];
  for (const candidate of carries) {
    const insertAt = ordered.findIndex(
      (current) =>
        current.kind === "fresh" && candidate.score >= current.score + replacementScoreMargin,
    );
    if (insertAt < 0) ordered.push(candidate);
    else ordered.splice(insertAt, 0, candidate);
  }
  return ordered;
}

function scoreWithRefresh(
  fresh: readonly RankedCandidate[],
  carry: readonly RankedCandidate[],
  refresh: CompositeCarryoverRefreshPolicy,
  decisionDate: string,
): { fresh: RankedCandidate[]; carry: RankedCandidate[]; missingCarry: number } {
  const componentsBySecurity = new Map<string, CarryRefreshComponents>();
  const scoreable: RankedCandidate[] = [];
  let missingCarry = 0;
  for (const item of [...fresh, ...carry]) {
    const components = refresh.componentsOf(item.securityId, decisionDate);
    if (components === null) {
      if (item.kind === "carry") {
        // 停牌 / 无有效 bar：当日不可评分、不可买入；本轮不插补，仍由 pending
        // 生命周期决定是否在后续有数据时再试。
        missingCarry += 1;
        continue;
      }
      throw new Error(
        "applyCompositeCarryover: " + decisionDate + " " + item.securityId
          + " 的 fresh 候选缺少 CarryRefreshV1 当日分量（不插补）。",
      );
    }
    componentsBySecurity.set(item.securityId, components);
    scoreable.push(item);
  }
  if (scoreable.length === 0) return { fresh: [], carry: [], missingCarry };

  const percentileByComponent = new Map<string, Map<string, number | null>>();
  for (const componentId of CARRY_REFRESH_COMPONENT_IDS) {
    const ranked = rankSignals(
      scoreable.map((item) => ({
        securityId: item.securityId,
        value: componentsBySecurity.get(item.securityId)![componentId],
      })),
      { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    );
    percentileByComponent.set(
      componentId,
      new Map(ranked.map((item) => [item.securityId, item.percentile])),
    );
  }

  const scored = scoreable.map((item): RankedCandidate => {
    let sum = 0;
    for (const componentId of CARRY_REFRESH_COMPONENT_IDS) {
      const percentile = percentileByComponent.get(componentId)!.get(item.securityId);
      if (percentile === null || percentile === undefined) {
        throw new Error(
          "applyCompositeCarryover: " + decisionDate + " " + item.securityId
            + " 的 CarryRefreshV1 分位不可算（不插补）。",
        );
      }
      sum += percentile;
    }
    const refreshPercentile = sum / CARRY_REFRESH_COMPONENT_IDS.length;
    return {
      ...item,
      score: fuseCarryRefreshIntoBaseScore(item.score, refreshPercentile, refresh.weight),
    };
  });

  return {
    fresh: scored.filter((item) => item.kind === "fresh"),
    carry: scored.filter((item) => item.kind === "carry"),
    missingCarry,
  };
}

/**
 * 把 base source run 转成跨日候选池 / 当日重评分版本。
 *
 * 控制臂不得调用；只有显式声明 carry / refresh 的实验臂才调用。
 */
export function applyCompositeCarryover(
  base: BuiltCompositeArm,
  policy: CompositeCarryoverPolicy,
): BuiltCompositeArm {
  assertPolicy(policy);
  const method = base.sourceRun.selectionConfig.method;
  if (method.kind !== "topN") {
    throw new Error("applyCompositeCarryover: 仅支持 selectionConfig.method.kind = topN。");
  }
  const topN = method.n;

  const pending: PendingCandidate[] = [];
  const days: CandidateDayRecord[] = [];
  const accounting = {
    queuedCandidates: 0,
    consideredCarryCandidates: 0,
    selectedCarryCandidates: 0,
    attemptedCarryCandidates: 0,
    expiredCarryCandidates: 0,
    refreshUnscorableCarryCandidates: 0,
  };

  for (const day of base.sourceRun.days) {
    const fresh: RankedCandidate[] = day.positionIntents
      .filter((intent) => intent.direction === "long")
      .slice()
      .sort((left, right) =>
        left.rank !== right.rank
          ? left.rank - right.rank
          : left.securityId.localeCompare(right.securityId),
      )
      .map((intent) => {
        if (!finite(intent.signalValue)) {
          throw new Error(
            "applyCompositeCarryover: " + day.date + " " + intent.securityId + " 的 signalValue 非有限值。",
          );
        }
        return {
          kind: "fresh" as const,
          securityId: intent.securityId,
          score: intent.signalValue,
          originDate: day.date,
          originRank: intent.rank,
          ageDays: 0,
        };
      });

    const activePending = policy.maxAgeDays === 0
      ? []
      : pending.filter((item) => item.ageDays <= policy.maxAgeDays);
    accounting.consideredCarryCandidates += activePending.length;

    const carryRanked = activePending.map(asRankedCandidate);
    const refresh = policy.refresh ?? null;
    const ranked = refresh === null
      ? { fresh, carry: carryRanked, missingCarry: 0 }
      : scoreWithRefresh(fresh, carryRanked, refresh, day.date);
    accounting.refreshUnscorableCarryCandidates += ranked.missingCarry;

    const combined = mergeFreshAndCarry(
      ranked.fresh,
      ranked.carry,
      policy.replacementScoreMargin,
    );
    const selectedRanked = combined.slice(0, topN);
    accounting.selectedCarryCandidates += selectedRanked.filter(
      (candidate) => candidate.kind === "carry",
    ).length;
    accounting.attemptedCarryCandidates += combined
      .slice(0, policy.attemptedPerDay)
      .filter((candidate) => candidate.kind === "carry").length;

    const selected = selectedRanked.map((candidate, index) => ({
      securityId: candidate.securityId,
      rank: index + 1,
      percentile: combined.length === 0 ? 0 : 1 - index / combined.length,
      value: candidate.score,
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
    const universeMembers = [
      ...new Set([
        ...day.universeMembers,
        ...activePending.map((item) => item.securityId),
      ]),
    ].sort();

    days.push({
      ...day,
      universeMembers,
      // fresh 候选 + 当日参与的 pending 都是本决策日的可见候选。
      signalCount: universeMembers.length,
      selected,
      positionIntents,
    });

    const carriedForward = policy.maxAgeDays === 0
      ? []
      : activePending
          .map((item) => ({ ...item, ageDays: item.ageDays + 1 }))
          .filter((item) => item.ageDays <= policy.maxAgeDays);
    accounting.expiredCarryCandidates +=
      activePending.length - carriedForward.length;

    const newPending: PendingCandidate[] = policy.maxAgeDays === 0
      ? []
      : fresh
          .slice(policy.attemptedPerDay)
          .map((item) => ({
            securityId: item.securityId,
            score: item.score,
            originDate: item.originDate,
            originRank: item.originRank,
            ageDays: 1,
          }));
    accounting.queuedCandidates += newPending.length;

    const bySecurity = new Map<string, PendingCandidate>();
    for (const item of carriedForward) bySecurity.set(item.securityId, item);
    for (const item of newPending) bySecurity.set(item.securityId, item);
    pending.length = 0;
    pending.push(...bySecurity.values());
  }

  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    ...base.sourceRun,
    parameters: {
      ...base.sourceRun.parameters,
      carryMaxAgeDays: policy.maxAgeDays,
      carryReplacementScoreMargin: policy.replacementScoreMargin,
      carryAttemptedPerDay: policy.attemptedPerDay,
      ...(policy.refresh === undefined || policy.refresh === null
        ? {}
        : {
            carryRefreshVersion: policy.refresh.version,
            carryRefreshWeight: policy.refresh.weight,
          }),
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
    carryAccounting: accounting,
  };
}
