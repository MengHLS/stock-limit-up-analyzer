import { pickUniformRandomSubset } from "./rightTailMetrics";

/**
 * 排序分辨力（P3）诊断 —— **纯函数，无 I/O、无 Dataset 依赖**。
 *
 * 目的（`SKILL.md` §3.5 前置闸门）：离散因子（分桶/计数/布尔）在横截面上会产生**大量并列值**，
 * 而 `rankCandidates` 的破平键**不是排序信号**。若不先测「入选边界是否被并列组跨越」，
 * 就会把**破平键噪声**当成因子效应。
 *
 * 🔴 本模块**不是**因子、**不产生**任何选择信号；它只回答「这台仪器有没有分辨力」。
 * 🔴 随机列使用**逐日无放回均匀 K 子集**（复用既有 `pickUniformRandomSubset`），
 *    **不是** tie-break `RAND` —— 后者只是同值破平键，在连续因子上与 `ASC` 选出完全相同的集合。
 */

/** 一个交易日内的一只候选（值已按 `orientation` 定向或未定向，本模块不关心方向语义）。 */
export interface ResolutionCandidate {
  readonly eventId: string;
  readonly value: number;
}

export interface ResolutionDay {
  readonly date: string;
  readonly candidates: readonly ResolutionCandidate[];
}

export interface DayResolution {
  readonly date: string;
  readonly candidateCount: number;
  /** 不同取值个数。 */
  readonly distinctCount: number;
  /** `distinctCount / candidateCount`。 */
  readonly uniqueRatio: number;
  /** 最大并列组的大小。 */
  readonly modalTieSize: number;
  /** 最大并列组 / 候选数。 */
  readonly modalShare: number;
  /** 跨越「第 `topK` 名入选边界」的并列组大小；`0` = 边界恰好落在两个不同值之间。 */
  readonly boundaryTieSize: number;
  /** 边界并列组是否**真的**影响入选集合（组内部分入选、部分落选）。 */
  readonly boundaryStraddles: boolean;
}

export interface RankResolutionSummary {
  readonly topK: number;
  readonly dayCount: number;
  readonly candidateCountMedian: number;
  readonly distinctCountMedian: number;
  readonly uniqueRatioMedian: number;
  readonly modalShareMedian: number;
  /** 「单一取值占比 ≥ `modalDominanceShare`」的交易日占比。 */
  readonly modalDominatedDayShare: number;
  /** 「边界并列组 ≥ `topK`」的交易日占比（= 入选集合基本由破平键决定）。 */
  readonly boundaryStraddleDayShare: number;
  /** 「`distinctCount < topK`」的交易日占比（= 连凑满 K 个不同取值都做不到）。 */
  readonly insufficientDistinctDayShare: number;
  readonly modalDominanceShare: number;
  readonly days: readonly DayResolution[];
}

export interface TieBreakSensitivity {
  readonly topK: number;
  readonly dayCount: number;
  /** `J(ASC 键选出, DESC 键选出)` 的日中位数。 */
  readonly jaccardAscDescMedian: number;
  /** `J(ASC 键选出, 逐日无放回均匀 K 子集)` 的日中位数（随机列**不是** tie-break 键）。 */
  readonly jaccardAscUniformMedian: number;
  /** ASC 与 DESC 选出集合**不完全相同**的交易日占比。 */
  readonly selectionChangedDayShare: number;
}

export const RANK_RESOLUTION_VERDICTS = ["RESOLUTION_OK", "TIE_BREAK_DOMINATED"] as const;
export type RankResolutionVerdict = (typeof RANK_RESOLUTION_VERDICTS)[number];

export interface RankResolutionThresholds {
  /** `distinctCountMedian` 必须 **≥** 此值。 */
  readonly minDistinctCount: number;
  /** `modalShareMedian` 必须 **≤** 此值。 */
  readonly maxModalShareMedian: number;
  /** `modalDominatedDayShare` 必须 **≤** 此值。 */
  readonly maxModalDominatedDayShare: number;
  /** `jaccardAscDescMedian` 必须 **≥** 此值。 */
  readonly minJaccardAscDesc: number;
}

/**
 * 预注册阈值 —— **先定后用**，不得在看到结果后调整。
 * 取值使本模块在**已知的 `holdStreak` 反例**上给出 `TIE_BREAK_DOMINATED`、
 * 在连续因子上给出 `RESOLUTION_OK`（见同目录测试的合成夹具）。
 */
export const DEFAULT_RANK_RESOLUTION_THRESHOLDS: RankResolutionThresholds = {
  minDistinctCount: 5,
  maxModalShareMedian: 0.5,
  maxModalDominatedDayShare: 0.5,
  minJaccardAscDesc: 0.9,
};

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted.length % 2 === 0 ? (sorted[mid]! + sorted[mid + 1]!) / 2 : sorted[mid]!;
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const id of a) if (b.has(id)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** 单日诊断：在 `direction = "DESC"`（值大者优先）下，按第 `topK` 名切分。 */
export function diagnoseDay(day: ResolutionDay, topK: number): DayResolution {
  const values = day.candidates.map((candidate) => candidate.value);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const distinctCount = counts.size;
  let modalTieSize = 0;
  for (const size of counts.values()) if (size > modalTieSize) modalTieSize = size;

  // 按值降序（并列内按 eventId 升序）排序，找跨越第 topK 名的并列组。
  const ranked = [...day.candidates].sort((left, right) =>
    right.value - left.value || (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0));
  let boundaryTieSize = 0;
  let boundaryStraddles = false;
  if (ranked.length > topK && topK > 0) {
    const boundaryValue = ranked[topK - 1]!.value;
    const nextValue = ranked[topK]!.value;
    if (boundaryValue === nextValue) {
      boundaryTieSize = counts.get(boundaryValue) ?? 0;
      boundaryStraddles = true;
    }
  }

  return {
    date: day.date,
    candidateCount: day.candidates.length,
    distinctCount,
    uniqueRatio: day.candidates.length === 0 ? 0 : distinctCount / day.candidates.length,
    modalTieSize,
    modalShare: day.candidates.length === 0 ? 0 : modalTieSize / day.candidates.length,
    boundaryTieSize,
    boundaryStraddles,
  };
}

export function summarizeRankResolution(args: {
  readonly days: readonly ResolutionDay[];
  readonly topK: number;
  readonly modalDominanceShare?: number;
}): RankResolutionSummary {
  const modalDominanceShare = args.modalDominanceShare ?? 0.5;
  const usable = args.days.filter((day) => day.candidates.length > 0);
  const days = usable.map((day) => diagnoseDay(day, args.topK));
  return {
    topK: args.topK,
    dayCount: days.length,
    candidateCountMedian: medianOf(days.map((day) => day.candidateCount)),
    distinctCountMedian: medianOf(days.map((day) => day.distinctCount)),
    uniqueRatioMedian: medianOf(days.map((day) => day.uniqueRatio)),
    modalShareMedian: medianOf(days.map((day) => day.modalShare)),
    modalDominatedDayShare: days.length === 0 ? 0 : days.filter((day) => day.modalShare >= modalDominanceShare).length / days.length,
    boundaryStraddleDayShare: days.length === 0 ? 0 : days.filter((day) => day.boundaryStraddles && day.boundaryTieSize >= args.topK).length / days.length,
    insufficientDistinctDayShare: days.length === 0 ? 0 : days.filter((day) => day.distinctCount < args.topK).length / days.length,
    modalDominanceShare,
    days,
  };
}

function topKByKey(candidates: readonly ResolutionCandidate[], topK: number, key: "ASC" | "DESC"): string[] {
  const ranked = [...candidates].sort((left, right) =>
    right.value - left.value || (key === "ASC"
      ? (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0)
      : (left.eventId > right.eventId ? -1 : left.eventId < right.eventId ? 1 : 0)));
  return ranked.slice(0, topK).map((candidate) => candidate.eventId);
}

export function summarizeTieBreakSensitivity(args: {
  readonly days: readonly ResolutionDay[];
  readonly topK: number;
}): TieBreakSensitivity {
  const usable = args.days.filter((day) => day.candidates.length >= args.topK && args.topK > 0);
  const ascDesc: number[] = [];
  const ascUniform: number[] = [];
  let changed = 0;
  usable.forEach((day, index) => {
    const asc = topKByKey(day.candidates, args.topK, "ASC");
    const desc = topKByKey(day.candidates, args.topK, "DESC");
    ascDesc.push(jaccard(asc, desc));
    if (asc.length !== desc.length || asc.some((id, position) => id !== desc[position])) changed += 1;
    const uniform = pickUniformRandomSubset({
      eventIds: day.candidates.map((candidate) => candidate.eventId),
      topK: args.topK,
      seedIndex: index,
      date: day.date,
    });
    ascUniform.push(jaccard(asc, uniform));
  });
  return {
    topK: args.topK,
    dayCount: usable.length,
    jaccardAscDescMedian: medianOf(ascDesc),
    jaccardAscUniformMedian: medianOf(ascUniform),
    selectionChangedDayShare: usable.length === 0 ? 0 : changed / usable.length,
  };
}

export interface RankResolutionJudgement {
  readonly verdict: RankResolutionVerdict;
  readonly reasons: readonly string[];
  readonly summary: RankResolutionSummary;
  readonly sensitivity: TieBreakSensitivity;
}

/**
 * 预注册判定：**任一**条件命中即 `TIE_BREAK_DOMINATED`
 * （⇒ 该因子不得进入任何排序类真实 Run，直至仪器修复）。
 */
export function judgeRankResolution(args: {
  readonly summary: RankResolutionSummary;
  readonly sensitivity: TieBreakSensitivity;
  readonly thresholds?: RankResolutionThresholds;
}): RankResolutionJudgement {
  const thresholds = args.thresholds ?? DEFAULT_RANK_RESOLUTION_THRESHOLDS;
  const { summary, sensitivity } = args;
  const reasons: string[] = [];
  if (summary.distinctCountMedian < thresholds.minDistinctCount) {
    reasons.push(`distinctCountMedian ${summary.distinctCountMedian} < ${thresholds.minDistinctCount}`);
  }
  if (summary.modalShareMedian > thresholds.maxModalShareMedian) {
    reasons.push(`modalShareMedian ${summary.modalShareMedian.toFixed(3)} > ${thresholds.maxModalShareMedian}`);
  }
  if (summary.modalDominatedDayShare > thresholds.maxModalDominatedDayShare) {
    reasons.push(`modalDominatedDayShare ${summary.modalDominatedDayShare.toFixed(3)} > ${thresholds.maxModalDominatedDayShare}`);
  }
  if (sensitivity.jaccardAscDescMedian < thresholds.minJaccardAscDesc) {
    reasons.push(`jaccardAscDescMedian ${sensitivity.jaccardAscDescMedian.toFixed(3)} < ${thresholds.minJaccardAscDesc}`);
  }
  return {
    verdict: reasons.length === 0 ? "RESOLUTION_OK" : "TIE_BREAK_DOMINATED",
    reasons,
    summary,
    sensitivity,
  };
}

/** 供报告使用的可读摘要（不参与判定）。 */
export function describeRankResolution(judgement: RankResolutionJudgement): string {
  const { summary, sensitivity, verdict } = judgement;
  return `${verdict} · 日数 ${summary.dayCount} · distinct 中位 ${summary.distinctCountMedian}`
    + ` · 众数占比中位 ${summary.modalShareMedian.toFixed(3)}`
    + ` · 众数主导日占比 ${summary.modalDominatedDayShare.toFixed(3)}`
    + ` · 边界并列日占比 ${summary.boundaryStraddleDayShare.toFixed(3)}`
    + ` · J(ASC,DESC) 中位 ${sensitivity.jaccardAscDescMedian.toFixed(3)}`
    + ` · J(ASC,均匀随机) 中位 ${sensitivity.jaccardAscUniformMedian.toFixed(3)}`
    + ` · 换键改选日占比 ${sensitivity.selectionChangedDayShare.toFixed(3)}`;
}
