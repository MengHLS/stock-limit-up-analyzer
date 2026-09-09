/**
 * STEP 22 / C-22.1 — Market Regime：适配接口（填充既有 unassessed 占位）。
 *
 * 背景（真实差距，先实查后编码）：
 *   - `server/research/tradeQualityMetrics/types.ts` 的 `TradeQualityRegimePerformance`
 *     当前只有 unassessed 分支产出（reasonCode=`REGIME_NOT_ASSESSED`），assessed 分支
 *     （含 `TradeQualityRegimeSegmentPerformance`）是留给 C-22.1 的扩展槽；
 *   - `server/research/experimentLineage/types.ts` 的 §28 `regime` 字段同样恒为
 *     unassessed（reasonCode 同上）。
 *
 * 本文件提供**纯函数映射**把 C-22.1 的标签序列填进这两个扩展槽；**不修改**既有文件
 * （协调者只需在 C-16.3 / C-13.3 的装配处调用本文件的函数即可，见下方接线说明）。
 *
 * 接线建议（写给协调者 / 后续 C-16.3 / C-13.3 维护者）：
 *   1. **C-16.3（tradeQualityMetrics）**：`evaluateTradeQualityMetrics` 目前调用
 *      `unassessedRegimePerformance()` 恒产出占位。建议在评估入口增加一个可选入参
 *      `regime?: readonly RegimeDayTags[]`（由 C-22.1 先算好标签序列，按评估区间切片），
 *      有值时改用 `buildTradeQualityRegimePerformance(tags, { monthlyProvider })`，
 *      无值时保持 `unassessedRegimePerformance()`（不得因为「看起来能算」就编造标签）。
 *      monthlyProvider 可由 C-16.3 已算好的 `MonthlyConsistencyMetrics.entries`
 *      按 tradeDate 前缀（YYYY-MM）索引提供，保证月度收益口径与 C-16.3 一致。
 *   2. **C-13.3（experimentLineage）**：`createExperimentLineageRecord` 的 ctx 增加
 *      可选 `regimeTags?: readonly RegimeDayTags[]`，映射时改用
 *      `toExperimentLineageRegime(regimeTags)`；无值时仍走既有
 *      `DEFAULT_REGIME_UNASSESSED_REASON` 占位。注意 §28 regime 是**单值**字段，
 *      故本映射取「主导复合状态」（出现天数最多），并在 note 中写明覆盖区间与
 *      未评估维计数，避免单值掩盖区间内的状态切换。
 *   3. 两者都**必须**保留 unassessed 回落：标签缺失 / 全维 unassessed 时返回
 *      unassessed（reasonCode 仍用 `REGIME_NOT_ASSESSED`），不伪造 assessed。
 *
 * 纯函数、确定性、无 IO；不跑回测。
 */

import { dominantRegimeCompositeKey } from "./composite";
import { regimeGroupKeyForDimension } from "./composite";
import {
  DEFAULT_REGIME_UNASSESSED_REASON,
  REGIME_UNASSESSED_REASON_CODE,
} from "../experimentLineage/types";
import type { ExperimentLineageRegime } from "../experimentLineage/types";
import type {
  MonthlyReturnEntry,
  TradeQualityRegimePerformance,
  TradeQualityRegimeSegmentPerformance,
} from "../tradeQualityMetrics/types";
import type {
  MarketRegimeRun,
  RegimeAttributionGroupBy,
  RegimeContiguousSegment,
  RegimeDayTags,
  RegimeMonthlyReturnProvider,
} from "./types";

// ---------------------------------------------------------------------------
// 连续区间切分
// ---------------------------------------------------------------------------

/** 区间切分选项。 */
export interface RegimeSegmentOptions {
  /** 分组维度：复合状态（默认）| 单维。 */
  readonly groupBy?: RegimeAttributionGroupBy;
}

/**
 * 把逐日标签切分为「连续同状态区间」。
 *
 * 「连续」= 在给定**交易日历序列**中相邻（不是自然日相邻）；序列顺序由调用方保证
 * （MarketRegimeRun.tags 恒按 tradeDate 升序）。unassessed 日按其 `<dim>=NA:<code>`
 * 键参与分组，因此不会与已评估状态混为同一段。
 */
export function buildRegimeContiguousSegments(
  tags: readonly RegimeDayTags[],
  options?: RegimeSegmentOptions,
): readonly RegimeContiguousSegment[] {
  const groupBy = options?.groupBy ?? "composite";
  const segments: RegimeContiguousSegment[] = [];
  let current: { regimeId: string; startDate: string; endDate: string; count: number } | null = null;
  for (const day of tags) {
    const regimeId =
      groupBy === "composite"
        ? day.composite?.compositeKey ?? null
        : regimeGroupKeyForDimension(day, groupBy);
    if (regimeId === null) continue; // 复合未启用 → 该日不入段（不编造段）
    if (current !== null && current.regimeId === regimeId) {
      current.endDate = day.tradeDate;
      current.count += 1;
      continue;
    }
    if (current !== null) {
      segments.push({
        regimeId: current.regimeId,
        startDate: current.startDate,
        endDate: current.endDate,
        tradingDayCount: current.count,
      });
    }
    current = { regimeId, startDate: day.tradeDate, endDate: day.tradeDate, count: 1 };
  }
  if (current !== null) {
    segments.push({
      regimeId: current.regimeId,
      startDate: current.startDate,
      endDate: current.endDate,
      tradingDayCount: current.count,
    });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// C-16.3 适配：TradeQualityRegimePerformance
// ---------------------------------------------------------------------------

/** C-16.3 适配选项。 */
export interface TradeQualityRegimePerformanceOptions extends RegimeSegmentOptions {
  /**
   * 月度收益提供者（tradeDate → 该日所属月的月度收益条目）。
   * 未提供时段的 monthlyReturns 为**空数组**（不编造收益数据）。
   */
  readonly monthlyProvider?: RegimeMonthlyReturnProvider;
}

/** 月度收益去重（同一月在同一段内只保留一条，按 monthKey 升序）。 */
function dedupeMonthly(entries: readonly MonthlyReturnEntry[]): readonly MonthlyReturnEntry[] {
  const byKey = new Map<string, MonthlyReturnEntry>();
  for (const entry of entries) {
    if (!byKey.has(entry.monthKey)) byKey.set(entry.monthKey, entry);
  }
  return Array.from(byKey.keys()).sort().map((key) => byKey.get(key)!);
}

/**
 * 填充 C-16.3 的 `TradeQualityRegimePerformance`（assessed 形态）。
 *
 * 回落纪律：tags 为空 或 无任何可成段的状态（如全维 unassessed 且 groupBy=单维）→
 * 返回 unassessed（reasonCode=`REGIME_NOT_ASSESSED`），**绝不产出空 assessed 假装已评估**。
 */
export function buildTradeQualityRegimePerformance(
  tags: readonly RegimeDayTags[],
  options?: TradeQualityRegimePerformanceOptions,
): TradeQualityRegimePerformance {
  const segments = buildRegimeContiguousSegments(tags, { groupBy: options?.groupBy });
  if (segments.length === 0) {
    return {
      kind: "unassessed",
      reasonCode: REGIME_UNASSESSED_REASON_CODE,
      reason:
        "C-22.1 regime 标签序列为空或未启用复合状态，无法产出分段表现" +
        `（入参 ${tags.length} 个交易日）`,
    };
  }
  const provider = options?.monthlyProvider;
  const mapped: TradeQualityRegimeSegmentPerformance[] = segments.map((segment) => ({
    regimeId: segment.regimeId,
    startDate: segment.startDate,
    endDate: segment.endDate,
    monthlyReturns:
      provider === undefined
        ? []
        : dedupeMonthly(
            collectMonthlyReturns(tags, segment.startDate, segment.endDate, provider),
          ),
  }));
  return { kind: "assessed", segments: mapped };
}

/** 收集区间内各交易日所属月的月度收益（按提供者返回，去重前）。 */
function collectMonthlyReturns(
  tags: readonly RegimeDayTags[],
  startDate: string,
  endDate: string,
  provider: RegimeMonthlyReturnProvider,
): readonly MonthlyReturnEntry[] {
  const collected: MonthlyReturnEntry[] = [];
  for (const day of tags) {
    if (day.tradeDate < startDate || day.tradeDate > endDate) continue;
    const entries = provider(day.tradeDate);
    if (entries === undefined) continue;
    collected.push(...entries);
  }
  return collected;
}

// ---------------------------------------------------------------------------
// C-13.3 适配：ExperimentLineageRegime（§28 regime 单值字段）
// ---------------------------------------------------------------------------

/** C-13.3 适配选项。 */
export interface ExperimentLineageRegimeOptions {
  /** 附加说明（会拼进 note；不得用于承载机器语义）。 */
  readonly note?: string;
}

/**
 * 填充 C-13.3 §28 的 `regime` 字段。
 *
 * 语义：§28 regime 是**单值**字段，故取区间主导复合状态（出现天数最多的
 * compositeKey，并列按字典序取前者），并在 note 中写明：覆盖交易日数、主导状态
 * 占比、未评估标签总数——**单值不得掩盖区间内的状态切换**。
 *
 * 回落：无复合状态（tags 空 / composite 全 null）→ unassessed（REGIME_NOT_ASSESSED）。
 */
export function toExperimentLineageRegime(
  tags: readonly RegimeDayTags[],
  options?: ExperimentLineageRegimeOptions,
): ExperimentLineageRegime {
  const dominant = dominantRegimeCompositeKey(tags);
  if (dominant === null) {
    return {
      kind: "unassessed",
      reasonCode: REGIME_UNASSESSED_REASON_CODE,
      reason:
        "C-22.1 未产出可用的 regime 标签（序列为空或未启用复合状态），§28 regime 字段保持未评估",
    };
  }
  let dominantDays = 0;
  let unassessedTags = 0;
  for (const day of tags) {
    if (day.composite?.compositeKey === dominant) dominantDays += 1;
    unassessedTags += day.composite?.unassessedDimensionCount ?? 0;
  }
  const noteParts = [
    `C-22.1 主导复合状态（${dominantDays}/${tags.length} 交易日）`,
    `未评估标签数=${unassessedTags}`,
  ];
  if (options?.note !== undefined && options.note.length > 0) noteParts.push(options.note);
  return { kind: "assessed", regimeId: dominant, note: noteParts.join("；") };
}

/** 直接由 MarketRegimeRun 映射 §28 regime（等价 toExperimentLineageRegime(run.tags)）。 */
export function toExperimentLineageRegimeFromRun(
  run: MarketRegimeRun,
  options?: ExperimentLineageRegimeOptions,
): ExperimentLineageRegime {
  return toExperimentLineageRegime(run.tags, options);
}

/**
 * C-13.3 既有占位原因常量（透出，便于调用方在无标签时保持与既有记录文案一致）。
 * 注意：本模块在「标签缺失」场景也使用该常量文案的默认语义，但 reasonCode 恒为
 * REGIME_UNASSESSED_REASON_CODE（与既有占位一致，避免引入第二套机器码）。
 */
export const REGIME_LEGACY_UNASSESSED_REASON = DEFAULT_REGIME_UNASSESSED_REASON;
