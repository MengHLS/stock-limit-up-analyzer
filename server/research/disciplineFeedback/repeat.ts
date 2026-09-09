/**
 * STEP 24 / C-24.2 — ② 重复错误识别（detectRepeatMistakes）。
 *
 * 检测「同一 reasonCode /（reasonCode+securityId）/（reasonCode+信号来源）」在
 * 已标注 entry 序列中重复出现的 pattern，输出首现/末现/次数/间隔 + 可选窗口内
 * 最大密度（peakWindow，描述性强度指标）。
 *
 * 纯描述性声明：报告只呈现「同因重复现象」，不下「形成习惯/需要纠正」结论
 * （候选模式供 C-25.1 与人工复核）。
 *
 * 诚实边界：
 *   - 只消费已落账、携带 reasonCode 的人工归因事件；
 *   - scope=ruleViolations（缺省）：只在声明规则违反的 entry 内找重复；
 *   - scope=allAttributed：任何带 reasonCode 的已标注 entry 都计入（含非违规偏差）；
 *   - 无 reasonCode 的候选（已标注但未归因 / 违规未归因）显式计数 excludedNoReasonCodeCount；
 *   - 事件日期取决策日（纪律失败发生的时点）；间隔为自然日（确定性日历日号差）。
 *
 * 铁律：纯函数、readonly、先排序后聚合；无 Date.now/Math.random/IO。
 */

import type { JournalReasonCode, TradeJournalEntry } from "../tradeJournal/types";
import { isJournalReasonCode } from "../tradeJournal/types";
import { DFA_ERROR_CODES, DisciplineFeedbackError } from "./errors";
import type {
  RepeatMistakeConfig,
  RepeatMistakeConfigInput,
  RepeatMistakeGroupBy,
  RepeatMistakeReport,
  RepeatMistakeScope,
  RepeatOccurrence,
  RepeatPatternSummary,
  RepeatWindowPeak,
} from "./types";
import {
  calendarDatePlusDays,
  calendarDaysBetween,
  resolveFeedbackEntries,
  strategyKeyOf,
} from "./common";

/** ② 默认值（唯一权威来源）。 */
export const DFA_DEFAULT_MIN_REPEAT_THRESHOLD = 2 as const;
export const DFA_DEFAULT_REPEAT_SCOPE: RepeatMistakeScope = "ruleViolations";
export const DFA_DEFAULT_REPEAT_GROUP_BY: RepeatMistakeGroupBy = "reasonCode";

function isRepeatScope(value: unknown): value is RepeatMistakeScope {
  return value === "ruleViolations" || value === "allAttributed";
}

function isRepeatGroupBy(value: unknown): value is RepeatMistakeGroupBy {
  return value === "reasonCode" || value === "reasonCodeAndSecurityId" || value === "reasonCodeAndSignalSource";
}

/** 解析② 配置（非法值响亮拒绝，不 clamp）。 */
export function resolveRepeatMistakeConfig(config?: RepeatMistakeConfigInput): RepeatMistakeConfig {
  const minRepeatThreshold = config?.minRepeatThreshold ?? DFA_DEFAULT_MIN_REPEAT_THRESHOLD;
  if (!Number.isInteger(minRepeatThreshold) || minRepeatThreshold < 1) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.CONFIG_INVALID,
      `minRepeatThreshold（${String(minRepeatThreshold)}）必须是 ≥1 的整数`
    );
  }
  const scope = config?.scope ?? DFA_DEFAULT_REPEAT_SCOPE;
  if (!isRepeatScope(scope)) {
    throw new DisciplineFeedbackError(DFA_ERROR_CODES.CONFIG_INVALID, `repeat scope（${String(scope)}）非法`);
  }
  const groupBy = config?.groupBy ?? DFA_DEFAULT_REPEAT_GROUP_BY;
  if (!isRepeatGroupBy(groupBy)) {
    throw new DisciplineFeedbackError(DFA_ERROR_CODES.CONFIG_INVALID, `repeat groupBy（${String(groupBy)}）非法`);
  }
  let windowSizeDays = config?.windowSizeDays ?? null;
  if (windowSizeDays === null || windowSizeDays === undefined) {
    windowSizeDays = null;
  } else if (!Number.isInteger(windowSizeDays) || windowSizeDays < 1) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.CONFIG_INVALID,
      `windowSizeDays（${String(windowSizeDays)}）必须是 ≥1 的整数或 null`
    );
  }
  return { minRepeatThreshold, scope, groupBy, windowSizeDays };
}

/** 候选事件（重复事件 = 已标注且携带 reasonCode 的 entry）。 */
interface CandidateEvent {
  readonly entry: TradeJournalEntry;
  readonly reasonCode: JournalReasonCode;
}

/** 判定 entry 是否在 scope 内。 */
function inScope(entry: TradeJournalEntry, scope: RepeatMistakeScope): boolean {
  const annotation = entry.annotation;
  if (annotation === null) return false;
  if (scope === "ruleViolations") {
    const rv = annotation.ruleViolation;
    return rv !== null && rv.declared === true;
  }
  return true; // allAttributed：任何已标注 entry
}

/** 分组键（reasonCode / reasonCode+securityId / reasonCode+信号来源）。 */
function groupKeyOf(event: CandidateEvent, groupBy: RepeatMistakeGroupBy): string {
  const code = event.reasonCode;
  if (groupBy === "reasonCodeAndSecurityId") return `${code}|sec=${event.entry.securityId}`;
  if (groupBy === "reasonCodeAndSignalSource") return `${code}|strat=${strategyKeyOf(event.entry)}`;
  return code;
}

/** 计算窗口内最大密度（两指针，确定性；要求 occurrences 已按 decisionDate 升序）。 */
function computePeakWindow(occurrences: readonly RepeatOccurrence[], windowSizeDays: number): RepeatWindowPeak {
  const starts = occurrences.map((o) => o.decisionDate);
  const days = starts.map((d) => calendarDaysBetween(starts[0]!, d));
  let bestCount = 0;
  let bestIndex = 0;
  let right = 0;
  for (let left = 0; left < days.length; left += 1) {
    const windowEndOffset = days[left]! + windowSizeDays - 1;
    while (right < days.length && days[right]! <= windowEndOffset) right += 1;
    const count = right - left;
    if (count > bestCount) {
      bestCount = count;
      bestIndex = left;
    }
  }
  const startDate = occurrences[bestIndex]!.decisionDate;
  const endDate = calendarDatePlusDays(startDate, windowSizeDays - 1);
  return { windowSizeDays, maxOccurrenceCount: bestCount, windowStartDate: startDate, windowEndDate: endDate };
}

/** ② 重复错误识别（确定性输出）。 */
export function detectRepeatMistakes(
  entries: readonly TradeJournalEntry[],
  config?: RepeatMistakeConfigInput
): RepeatMistakeReport {
  const resolvedConfig = resolveRepeatMistakeConfig(config);
  const { resolved } = resolveFeedbackEntries(entries);

  const events: CandidateEvent[] = [];
  let excludedNoReasonCodeCount = 0;
  for (const entry of resolved) {
    if (!inScope(entry, resolvedConfig.scope)) continue;
    const annotation = entry.annotation!;
    if (annotation.reasonCode === null || !isJournalReasonCode(annotation.reasonCode)) {
      excludedNoReasonCodeCount += 1; // 在 scope 内但未归因（不猜原因）
      continue;
    }
    events.push({ entry, reasonCode: annotation.reasonCode });
  }

  // 按 (decisionDate, journalId) 确定性排序后聚合
  const sortedEvents = events
    .slice()
    .sort((a, b) => {
      const dateCmp = a.entry.decisionDate.localeCompare(b.entry.decisionDate);
      if (dateCmp !== 0) return dateCmp;
      return a.entry.journalId.localeCompare(b.entry.journalId);
    });

  const groupMap = new Map<string, RepeatOccurrence[]>();
  for (const event of sortedEvents) {
    const key = groupKeyOf(event, resolvedConfig.groupBy);
    const list = groupMap.get(key);
    const occurrence: RepeatOccurrence = {
      journalId: event.entry.journalId,
      entryId: event.entry.entryId,
      decisionDate: event.entry.decisionDate,
      reasonCode: event.reasonCode,
      securityId: event.entry.securityId,
      strategyKey: strategyKeyOf(event.entry),
    };
    if (list === undefined) groupMap.set(key, [occurrence]);
    else list.push(occurrence);
  }

  const patterns: RepeatPatternSummary[] = [];
  for (const [key, occurrences] of Array.from(groupMap.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (occurrences.length < resolvedConfig.minRepeatThreshold) continue;
    const first = occurrences[0]!;
    const last = occurrences[occurrences.length - 1]!;
    const intervalDays: number[] = [];
    for (let i = 1; i < occurrences.length; i += 1) {
      intervalDays.push(calendarDaysBetween(occurrences[i - 1]!.decisionDate, occurrences[i]!.decisionDate));
    }
    patterns.push({
      groupKey: key,
      reasonCode: first.reasonCode,
      securityId: resolvedConfig.groupBy === "reasonCodeAndSecurityId" ? first.securityId : null,
      strategyKey: resolvedConfig.groupBy === "reasonCodeAndSignalSource" ? first.strategyKey : null,
      occurrenceCount: occurrences.length,
      firstOccurrenceDate: first.decisionDate,
      lastOccurrenceDate: last.decisionDate,
      intervalDays,
      occurrences,
      peakWindow:
        resolvedConfig.windowSizeDays !== null
          ? computePeakWindow(occurrences, resolvedConfig.windowSizeDays)
          : null,
    });
  }

  patterns.sort(
    (a, b) =>
      b.occurrenceCount - a.occurrenceCount ||
      a.firstOccurrenceDate.localeCompare(b.firstOccurrenceDate) ||
      a.groupKey.localeCompare(b.groupKey)
  );

  return {
    config: resolvedConfig,
    candidateEventCount: sortedEvents.length,
    excludedNoReasonCodeCount,
    patterns,
    note:
      "本报告只报告同因重复出现的现象（次数/间隔/窗口密度），" +
      "为描述性候选模式，不下「形成习惯」或「需要纠正」结论，供人工复核与 C-25.1 消费。",
  };
}
