/**
 * STEP 22 / C-22.1 — Market Regime：复合状态 + 逐日标签装配。
 *
 * 复合状态（compositeKey）把七维组合成一个可读、可分组、可进指纹的稳定键：
 *   - 顺序固定（REGIME_DIMENSION_IDS），保证跨运行可比；
 *   - assessed 维 → `<dim>=<label>`；unassessed 维 → `<dim>=NA:<reasonCode>`
 *     （**缺维显式可见**，绝不把缺失折叠成某个具体状态，否则归因会被静默污染）；
 *   - 可用 options.dimensions 裁剪为子集（如只看 trend+volatility 的二维复合）。
 *
 * 纯函数、确定性、无 IO；不跑回测。
 */

import { RegimeAnalysisError } from "./errors";
import {
  classifyRegimeBreadth,
  classifyRegimeIndexState,
  classifyRegimeLimitUpEnv,
  classifyRegimeLiquidity,
  classifyRegimeSentiment,
  classifyRegimeTrend,
  classifyRegimeVolatility,
} from "./dimensions";
import { REGIME_DIMENSION_IDS } from "./types";
import type {
  RegimeAnyDimensionTag,
  RegimeCompositeState,
  RegimeDayFacts,
  RegimeDayTags,
  RegimeDimensionId,
  RegimeDimensionTagMap,
  RegimeUnassessedReasonCode,
  ResolvedRegimeConfigSet,
} from "./types";

// ---------------------------------------------------------------------------
// 键拼装
// ---------------------------------------------------------------------------

/** 单维在 compositeKey 中的片段（unassessed 显式编码为 NA:<reasonCode>）。 */
export function regimeDimensionKeyPart(tag: RegimeAnyDimensionTag): string {
  return tag.kind === "assessed"
    ? `${tag.dimension}=${tag.label}`
    : `${tag.dimension}=NA:${tag.reasonCode as RegimeUnassessedReasonCode}`;
}

/** 按维度取分组键（供归因按单维分组；unassessed 日归入 `NA:<reasonCode>` 桶）。 */
export function regimeGroupKeyForDimension(
  tags: RegimeDayTags,
  dimension: RegimeDimensionId,
): string {
  return regimeDimensionKeyPart(tags[dimension]);
}

/** 复合状态键拼装选项。 */
export interface RegimeCompositeOptions {
  /** 参与拼装的维度（默认全七维，顺序按 REGIME_DIMENSION_IDS 固定）。 */
  readonly dimensions?: readonly RegimeDimensionId[];
}

/** 校验维度子集（非空、无重复、均为合法维度）。 */
function resolveDimensions(dimensions?: readonly RegimeDimensionId[]): readonly RegimeDimensionId[] {
  if (dimensions === undefined) return REGIME_DIMENSION_IDS;
  if (dimensions.length === 0) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_PARAMETER",
      "marketRegime: 复合状态维度子集不可为空（空集等于没有 regime 信息）",
    );
  }
  const seen = new Set<string>();
  for (const dimension of dimensions) {
    if (!(REGIME_DIMENSION_IDS as readonly string[]).includes(dimension)) {
      throw new RegimeAnalysisError(
        "REGIME_INVALID_PARAMETER",
        `marketRegime: 非法 regime 维度 ${String(dimension)}`,
      );
    }
    if (seen.has(dimension)) {
      throw new RegimeAnalysisError(
        "REGIME_INVALID_PARAMETER",
        `marketRegime: 复合状态维度子集含重复项 ${String(dimension)}`,
      );
    }
    seen.add(dimension);
  }
  return [...dimensions];
}

/** 由七维标签构造复合状态。 */
export function buildRegimeCompositeState(
  tags: RegimeDimensionTagMap,
  options?: RegimeCompositeOptions,
): RegimeCompositeState {
  const dimensions = resolveDimensions(options?.dimensions);
  const parts: string[] = [];
  let assessedDimensionCount = 0;
  let unassessedDimensionCount = 0;
  for (const dimension of dimensions) {
    const tag = tags[dimension] as RegimeAnyDimensionTag;
    parts.push(regimeDimensionKeyPart(tag));
    if (tag.kind === "assessed") assessedDimensionCount += 1;
    else unassessedDimensionCount += 1;
  }
  return {
    compositeKey: parts.join("|"),
    dimensionOrder: dimensions,
    assessedDimensionCount,
    unassessedDimensionCount,
  };
}

// ---------------------------------------------------------------------------
// 逐日标签装配
// ---------------------------------------------------------------------------

/** 逐日标签装配选项。 */
export interface ComputeRegimeDayTagsOptions extends RegimeCompositeOptions {
  /** 是否产出复合状态（默认 true；false 时 RegimeDayTags.composite = null）。 */
  readonly enableComposite?: boolean;
}

/**
 * 计算单个交易日（asOf）的七维标签 + 复合状态。
 *
 * PIT：全部七个分类器共用同一「回看窗」语义（含 asOf、只回看），且均在 asOf 不在
 * 序列中时响亮抛错——「T 日标签在 T−1 日不可得」由此成立。
 */
export function computeRegimeDayTags(
  series: readonly RegimeDayFacts[],
  asOf: string,
  configs: ResolvedRegimeConfigSet,
  options?: ComputeRegimeDayTagsOptions,
): RegimeDayTags {
  const tagMap: RegimeDimensionTagMap = {
    trend: classifyRegimeTrend(series, asOf, configs.trend, configs.benchmarkIndexCode),
    volatility: classifyRegimeVolatility(series, asOf, configs.volatility, configs.benchmarkIndexCode),
    liquidity: classifyRegimeLiquidity(series, asOf, configs.liquidity),
    breadth: classifyRegimeBreadth(series, asOf, configs.breadth),
    sentiment: classifyRegimeSentiment(series, asOf, configs.sentiment),
    indexState: classifyRegimeIndexState(series, asOf, configs.indexState, configs.benchmarkIndexCode),
    limitUpEnv: classifyRegimeLimitUpEnv(series, asOf, configs.limitUpEnv),
  };
  const enableComposite = options?.enableComposite ?? true;
  return {
    tradeDate: asOf,
    asOf,
    ...tagMap,
    composite: enableComposite
      ? buildRegimeCompositeState(tagMap, { dimensions: options?.dimensions })
      : null,
  };
}

// ---------------------------------------------------------------------------
// 序列级辅助
// ---------------------------------------------------------------------------

/**
 * 取一段 regime 标签序列的**主导复合状态**（出现天数最多的 compositeKey）。
 * 并列时按 compositeKey 字典序取前者（确定性，不依赖遍历顺序）。
 * 无任何已评估日（composite 全 null）时返回 null。
 */
export function dominantRegimeCompositeKey(tags: readonly RegimeDayTags[]): string | null {
  const counts = new Map<string, number>();
  for (const day of tags) {
    const key = day.composite?.compositeKey;
    if (key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestKey: string | null = null;
  let bestCount = -1;
  for (const key of Array.from(counts.keys()).sort()) {
    const count = counts.get(key)!;
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  return bestKey;
}

/** 统计一段标签序列中「七维全部已评估」的交易日数。 */
export function countFullyAssessedDays(tags: readonly RegimeDayTags[]): number {
  let count = 0;
  for (const day of tags) {
    if ((day.composite?.unassessedDimensionCount ?? 7) === 0) count += 1;
  }
  return count;
}
