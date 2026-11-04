/**
 * STEP 22 / C-22.1 — Market Regime：同一 regime 下的表现归因（**纯聚合，不跑回测**）。
 *
 * 定位：回答「策略到底在哪些市场环境有效」（ROADMAP §24）需要把「逐日 regime 标签」
 * 与「逐日策略表现」对齐后分组聚合。本模块**只做聚合**：
 *   - 表现数据（RegimePerformanceSample）由调用方注入（例如 C-14.1 TradeSimulationRun
 *     的 equityCurve 日收益、或 C-16.1 dailyReturnSeries 的产出）；
 *   - 本模块不执行回测、不读 DB、不产生任何策略结论，只给出可复核的分组统计。
 *
 * 诚实纪律：
 *   - 某交易日无 regime 标签 → 记入 unmatched（reasonCode=NO_REGIME_TAG）；
 *     某交易日该维 unassessed → 记入 unmatched（reasonCode=该维 reasonCode）；
 *     **绝不静默丢弃**（丢弃会把「数据不足日」伪装成不存在，虚增样本可信度）；
 *   - 复合分组时，含未评估维的 compositeKey 自带 `NA:<code>` 片段，与完整状态天然
 *     分成不同组，不会污染已评估组。
 *
 * 聚合口径（文档化，避免事后解释）：
 *   - cumulativeReturnPct = (Π(1 + r/100) − 1) × 100（复利，适合跨期比较）；
 *   - meanReturnPct = 日收益算术平均；medianReturnPct = 日收益中位数；
 *   - winRatePct = r > 0 的天数 / 总天数 × 100（r === 0 计入分母、不计胜）；
 *   - spreadPct = 最好组累计收益 − 最差组累计收益（组间分化度，>0 说明环境依赖）。
 */

import { mean, median } from "../../../shared/quant-stats";
import { RegimeAnalysisError } from "./errors";
import { assertRegimeIsoDate } from "./dates";
import { regimeGroupKeyForDimension } from "./composite";
import { REGIME_DIMENSION_IDS } from "./types";
import type {
  RegimeAttributionGroup,
  RegimeAttributionGroupBy,
  RegimeAttributionReport,
  RegimeDayTags,
  RegimePerformanceSample,
} from "./types";

/** 归因聚合选项。 */
export interface RegimeAttributionOptions {
  /** 分组维度：复合状态（默认）| 单维。 */
  readonly groupBy?: RegimeAttributionGroupBy;
}

/** 无标签/未评估的归因未匹配机器码。 */
export const REGIME_ATTRIBUTION_NO_TAG_REASON = "NO_REGIME_TAG" as const;

/** 复合状态未启用时的未匹配机器码。 */
export const REGIME_ATTRIBUTION_NO_COMPOSITE_REASON = "NO_COMPOSITE" as const;

/** 单日累计：把逐日收益按复利连乘（输入为 %）。 */
function compoundPct(returns: readonly number[]): number {
  let factor = 1;
  for (const value of returns) factor *= 1 + value / 100;
  return (factor - 1) * 100;
}

/**
 * 分组归因聚合（确定性、纯函数）。
 *
 * @param samples 逐日表现样本（调用方注入；可含 regime 未覆盖的日期）
 * @param tags    逐日 regime 标签（按 tradeDate 升序；同一 tradeDate 只允许一条）
 * @param options 分组维度
 */
export function aggregateRegimeAttribution(
  samples: readonly RegimePerformanceSample[],
  tags: readonly RegimeDayTags[],
  options?: RegimeAttributionOptions,
): RegimeAttributionReport {
  const groupBy: RegimeAttributionGroupBy = options?.groupBy ?? "composite";
  if (groupBy !== "composite" && !(REGIME_DIMENSION_IDS as readonly string[]).includes(groupBy)) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_PARAMETER",
      `marketRegime: 归因 groupBy 必须是 composite 或七维之一，实际 ${String(groupBy)}`,
    );
  }

  const tagByDate = new Map<string, RegimeDayTags>();
  for (const day of tags) {
    assertRegimeIsoDate(day.tradeDate, "tags[].tradeDate");
    if (tagByDate.has(day.tradeDate)) {
      throw new RegimeAnalysisError(
        "REGIME_INVALID_PARAMETER",
        `marketRegime: tags 含重复 tradeDate=${day.tradeDate}（归因对齐要求日期唯一）`,
      );
    }
    tagByDate.set(day.tradeDate, day);
  }

  const buckets = new Map<string, number[]>();
  const unmatchedByReasonCode: Record<string, number> = {};
  let matchedSampleCount = 0;
  let unmatchedSampleCount = 0;

  for (const sample of samples) {
    assertRegimeIsoDate(sample.tradeDate, "samples[].tradeDate");
    if (!Number.isFinite(sample.returnPct)) {
      throw new RegimeAnalysisError(
        "REGIME_INVALID_PARAMETER",
        `marketRegime: samples[${sample.tradeDate}].returnPct 必须是有限数字，实际 ${String(sample.returnPct)}`,
      );
    }
    const day = tagByDate.get(sample.tradeDate);
    if (day === undefined) {
      unmatchedSampleCount += 1;
      unmatchedByReasonCode[REGIME_ATTRIBUTION_NO_TAG_REASON] =
        (unmatchedByReasonCode[REGIME_ATTRIBUTION_NO_TAG_REASON] ?? 0) + 1;
      continue;
    }
    let key: string | null;
    let unmatchedReason: string | null = null;
    if (groupBy === "composite") {
      key = day.composite?.compositeKey ?? null;
      if (key === null) unmatchedReason = REGIME_ATTRIBUTION_NO_COMPOSITE_REASON;
    } else {
      const tag = day[groupBy];
      if (tag.kind === "unassessed") {
        unmatchedReason = tag.reasonCode;
        key = null;
      } else {
        key = regimeGroupKeyForDimension(day, groupBy);
      }
    }
    if (key === null) {
      unmatchedSampleCount += 1;
      const reason = unmatchedReason ?? REGIME_ATTRIBUTION_NO_TAG_REASON;
      unmatchedByReasonCode[reason] = (unmatchedByReasonCode[reason] ?? 0) + 1;
      continue;
    }
    matchedSampleCount += 1;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [sample.returnPct]);
    else bucket.push(sample.returnPct);
  }

  const groups: RegimeAttributionGroup[] = Array.from(buckets.keys()).sort().map((regimeKey) => {
    const returns = buckets.get(regimeKey)!;
    const wins = returns.filter((value) => value > 0).length;
    return {
      regimeKey,
      sampleCount: returns.length,
      cumulativeReturnPct: compoundPct(returns),
      meanReturnPct: mean(returns) ?? 0,
      medianReturnPct: median(returns),
      winRatePct: (wins / returns.length) * 100,
      bestReturnPct: Math.max(...returns),
      worstReturnPct: Math.min(...returns),
      shareOfSamplesPct:
        matchedSampleCount === 0 ? 0 : (returns.length / matchedSampleCount) * 100,
    };
  });

  let spreadPct: number | null = null;
  if (groups.length >= 2) {
    let best = -Infinity;
    let worst = Infinity;
    for (const group of groups) {
      best = Math.max(best, group.cumulativeReturnPct);
      worst = Math.min(worst, group.cumulativeReturnPct);
    }
    spreadPct = best - worst;
  }

  return {
    groupBy,
    totalSampleCount: samples.length,
    matchedSampleCount,
    unmatchedSampleCount,
    unmatchedByReasonCode,
    groups,
    spreadPct,
  };
}

/**
 * 按累计收益给分组排序（降序；并列按 regimeKey 升序，确定性）。
 * 供下游展示「哪些环境有效 / 哪些环境失效」，本模块不做任何结论判定。
 */
export function rankRegimeAttributionGroups(
  groups: readonly RegimeAttributionGroup[],
): readonly RegimeAttributionGroup[] {
  return [...groups].sort((left, right) => {
    if (right.cumulativeReturnPct !== left.cumulativeReturnPct) {
      return right.cumulativeReturnPct - left.cumulativeReturnPct;
    }
    return left.regimeKey < right.regimeKey ? -1 : left.regimeKey > right.regimeKey ? 1 : 0;
  });
}
