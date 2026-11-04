/**
 * STEP 13 / C-13.2 — Signal 与 Candidate 框架：候选层确定性统计评价（evaluate）。
 *
 * Evaluation 语义（见 types.ts 文件头）：只统计「候选集合本身」的确定性记录性指标，
 * 不含收益回测 / 成交模拟 / 持仓会计。输入只有逐决策日候选产物（CandidateDayRecord[]）。
 *
 * 铁律：
 *   - 纯函数、确定性：遍历顺序固定（日期升序 / securityId 升序），同输入必同输出；
 *   - 禁止 NaN/Infinity 进入统计（遇非有限入选 value 直接抛错，绝不静默计入）；
 *   - 不修改输入；返回全新对象。
 */

import type {
  CandidateDayRecord,
  CandidateRunEvaluation,
  DirectionCounts,
  SecuritySelectionStat,
} from "./types";

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`CandidateEvaluation: ${label} 出现非有限值（${String(value)}），候选产物违反确定性不变量`);
  }
}

/** 由逐决策日候选产物计算确定性统计评价（纯函数）。 */
export function evaluateCandidateRun(days: readonly CandidateDayRecord[]): CandidateRunEvaluation {
  if (days.length === 0) {
    throw new Error("CandidateEvaluation: days 为空，无法评价（引擎保证至少一个决策日）");
  }

  // -- 逐日聚合（日期按入参顺序即升序，引擎保证）--
  const selectedValues: number[] = [];
  let totalSelectedSlots = 0;
  let minSelectedPerDay = Infinity;
  let maxSelectedPerDay = -Infinity;
  let longCount = 0;
  let shortCount = 0;
  let neutralCount = 0;
  const selectedByDate = new Set<string>();
  const universeByDate = new Set<string>();
  const selectionDaysBySecurity = new Map<string, number>();

  for (const day of days) {
    totalSelectedSlots += day.selected.length;
    if (day.selected.length < minSelectedPerDay) minSelectedPerDay = day.selected.length;
    if (day.selected.length > maxSelectedPerDay) maxSelectedPerDay = day.selected.length;
    for (const member of day.universeMembers) universeByDate.add(member);
    for (const selected of day.selected) {
      selectedByDate.add(selected.securityId);
      assertFinite(selected.value, `day=${day.date} security=${selected.securityId} value`);
      selectedValues.push(selected.value);
      selectionDaysBySecurity.set(selected.securityId, (selectionDaysBySecurity.get(selected.securityId) ?? 0) + 1);
    }
    for (const intent of day.positionIntents) {
      if (intent.direction === "long") longCount += 1;
      else if (intent.direction === "short") shortCount += 1;
      else neutralCount += 1;
    }
  }

  // -- 派生聚合（确定性排序）--
  const decisionDayCount = days.length;
  const dates = days.map((day) => day.date);
  const distinctUniverseSecurities = Array.from(universeByDate).sort();
  const distinctSelectedSecurities = Array.from(selectedByDate).sort();
  const universeCoveragePct =
    distinctUniverseSecurities.length > 0
      ? (distinctSelectedSecurities.length / distinctUniverseSecurities.length) * 100
      : 0;

  // 每日都入选的证券（入选天数 == 决策日数）。
  const entries = Array.from(selectionDaysBySecurity.entries());
  const alwaysSelected = entries
    .filter(([, selectionDays]) => selectionDays === decisionDayCount)
    .map(([securityId]) => securityId)
    .sort();
  const selectionStats: SecuritySelectionStat[] = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([securityId, selectionDays]) => ({
      securityId,
      selectionDays,
      selectionFrequency: decisionDayCount > 0 ? selectionDays / decisionDayCount : 0,
    }));

  // -- 入选 value 分布 --
  let meanSelectedValue = 0;
  let minSelectedValue = Infinity;
  let maxSelectedValue = -Infinity;
  if (selectedValues.length > 0) {
    let sum = 0;
    for (const value of selectedValues) {
      sum += value;
      if (value < minSelectedValue) minSelectedValue = value;
      if (value > maxSelectedValue) maxSelectedValue = value;
    }
    meanSelectedValue = sum / selectedValues.length;
  } else {
    minSelectedValue = 0;
    maxSelectedValue = 0;
  }

  const meanSelectedPerDay = totalSelectedSlots / decisionDayCount;

  // 空横截面时 min/max 无候选：用 0 表达「无」而非 Infinity/-Infinity。
  const resolvedMinPerDay = totalSelectedSlots === 0 ? 0 : minSelectedPerDay;
  const resolvedMaxPerDay = totalSelectedSlots === 0 ? 0 : maxSelectedPerDay;

  const selectedDirectionCounts: DirectionCounts = { long: longCount, short: shortCount, neutral: neutralCount };

  return {
    decisionDayCount,
    dates,
    totalSelectedSlots,
    meanSelectedPerDay,
    minSelectedPerDay: resolvedMinPerDay,
    maxSelectedPerDay: resolvedMaxPerDay,
    distinctUniverseSecurities,
    distinctSelectedSecurities,
    universeCoveragePct,
    selectionStats,
    alwaysSelectedSecurities: alwaysSelected,
    selectedDirectionCounts,
    meanSelectedValue,
    minSelectedValue,
    maxSelectedValue,
  };
}
