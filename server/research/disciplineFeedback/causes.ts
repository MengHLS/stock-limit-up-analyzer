/**
 * STEP 24 / C-24.2 — ① 违规原因统计（aggregateViolationCauses）。
 *
 * 对 ruleViolation.declared=true 的已标注 entry 按 reasonCode 聚合频次/占比，
 * severity 以列呈现（countBySeverity + severityUnassignedCount 显式不猜），
 * 可选按机器偏差维度过滤（如只看 UNFILLED/PRICE 类违规）。
 *
 * 诚实边界：
 *   - 只消费已落账人工标注；annotation=null 的 draft **不计入**任何违规统计；
 *   - 已声明违规但 reasonCode=null → 显式 counted（reasonUnassignedCount），不猜原因；
 *   - 已声明违规但 severity=null → severityUnassignedCount，不猜严重度；
 *   - 规则违反声明只认 annotation.ruleViolation.declared=true（人工显式）。
 *
 * 铁律：纯函数、readonly、先排序后聚合；输出确定性。
 */

import type { TradeJournalEntry } from "../tradeJournal/types";
import { isJournalDeviationDimension, JOURNAL_DEVIATION_DIMENSIONS } from "../tradeJournal/types";
import { DFA_ERROR_CODES, DisciplineFeedbackError } from "./errors";
import type {
  ViolationCauseConfig,
  ViolationCauseConfigInput,
  ViolationCauseReport,
  ViolationReasonCountRow,
} from "./types";
import { resolveFeedbackEntries, stablePercent } from "./common";

/** 解析① 配置（非法值响亮拒绝，不 clamp）。 */
export function resolveViolationCauseConfig(config?: ViolationCauseConfigInput): ViolationCauseConfig {
  const filter = config?.filterDeviationDimension ?? null;
  if (filter !== null && !isJournalDeviationDimension(filter)) {
    throw new DisciplineFeedbackError(
      DFA_ERROR_CODES.CONFIG_INVALID,
      `filterDeviationDimension（${String(filter)}）不在受控维度 ${JOURNAL_DEVIATION_DIMENSIONS.join("/")}`
    );
  }
  return { filterDeviationDimension: filter };
}

/** 单 entry 是否计入「违规声明」（annotation 存在且 ruleViolation.declared=true）。 */
export function declaresRuleViolation(entry: TradeJournalEntry): boolean {
  const rv = entry.annotation?.ruleViolation ?? null;
  return rv !== null && rv.declared === true;
}

/** ① 违规原因统计（确定性输出）。 */
export function aggregateViolationCauses(
  entries: readonly TradeJournalEntry[],
  config?: ViolationCauseConfigInput
): ViolationCauseReport {
  const resolvedConfig = resolveViolationCauseConfig(config);
  const { resolved } = resolveFeedbackEntries(entries);
  const filter = resolvedConfig.filterDeviationDimension;

  let scopeViolationCount = 0;
  let reasonUnassignedCount = 0;
  let severityUnassignedCount = 0;

  // reasonCode → 计数（聚合后再排序，杜绝遍历顺序进结果）
  const reasonCounter = new Map<string, { count: number; severityMissing: number }>();
  const severityCounter = new Map<
    string,
    { MINOR: number; MAJOR: number; CRITICAL: number }
  >();

  for (const entry of resolved) {
    if (entry.annotation === null) continue;
    const rv = entry.annotation.ruleViolation;
    if (rv === null || rv.declared !== true) continue;
    if (filter !== null && !entry.deviation.machineDeviationDimensions.includes(filter)) {
      continue; // 维度过滤：不进入统计 scope
    }
    scopeViolationCount += 1;
    const reasonCode = entry.annotation.reasonCode;
    if (reasonCode === null) {
      reasonUnassignedCount += 1;
    } else {
      const agg = reasonCounter.get(reasonCode) ?? { count: 0, severityMissing: 0 };
      agg.count += 1;
      reasonCounter.set(reasonCode, agg);
      if (rv.severity === null) {
        agg.severityMissing += 1;
        severityUnassignedCount += 1;
      } else {
        const sevAgg = severityCounter.get(reasonCode) ?? { MINOR: 0, MAJOR: 0, CRITICAL: 0 };
        sevAgg[rv.severity] += 1;
        severityCounter.set(reasonCode, sevAgg);
      }
    }
  }

  const rows: ViolationReasonCountRow[] = Array.from(reasonCounter.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reasonCode, agg]) => {
      const sev = severityCounter.get(reasonCode) ?? { MINOR: 0, MAJOR: 0, CRITICAL: 0 };
      return {
        reasonCode: reasonCode as ViolationReasonCountRow["reasonCode"],
        count: agg.count,
        shareOfViolationsPct: stablePercent(agg.count, scopeViolationCount) ?? 0,
        countBySeverity: sev,
        severityUnassignedCount: agg.severityMissing,
      };
    })
    .sort((a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode));

  const note =
    filter === null
      ? "统计全部已声明规则违反（ruleViolation.declared=true）的已标注 entry；reasonCode 为人工归因，" +
        "null 一律计入 reasonUnassignedCount 不猜测；annotation=null 的 draft 不计入违规统计。"
      : `统计范围收窄为机器偏差维度含 ${filter} 的已声明违规；reasonCode=null 计入 reasonUnassignedCount 不猜测。`;

  return {
    config: resolvedConfig,
    scopeViolationCount,
    reasonUnassignedCount,
    severityUnassignedCount,
    rows,
    note,
  };
}
