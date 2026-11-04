/**
 * STEP 22 / C-22.1 — Market Regime：七维标签计算器（纯函数、PIT 安全、确定性）。
 *
 * 七维（ROADMAP §24）：trend / volatility / liquidity / breadth / sentiment /
 * indexState / limitUpEnv。每维：
 *   - 只消费**回看窗** [T−N+1 .. T]（含 T，绝不居中 / 绝不前向）的日级事实；
 *   - 窗口不足 / 数据缺失 → 显式 unassessed + reasonCode（**绝不默认中性**）；
 *   - 输出附 asOf / lookbackWindow / sampleSize / metrics（可人工复核）。
 *
 * PIT 实证（测试见 marketRegime.test.ts）：
 *   1. buildRegimeLookbackWindow 对窗口逐日断言 tradeDate <= asOf 且 asOf === tradeDate
 *      （REGIME_LOOKAHEAD_VIOLATION / REGIME_ASOF_INVARIANT_VIOLATION）；
 *   2. 对同一 asOf，喂「截断到 T 的序列」与「含未来数据的完整序列」标签必须逐位相同
 *      （无泄漏）；
 *   3. asOf 不在序列中（例如只有 T−1 及之前的数据却要 T 的标签）→ 响亮抛错
 *      REGIME_ASOF_NOT_AVAILABLE，绝不就近取值。
 *
 * 复用：quant-stats（mean / sampleStandardDeviation）与 boardRules（涨停家数已在
 * facts.ts 统计好）；本文件不重复实现统计与涨停规则。
 */

import { mean, sampleStandardDeviation } from "../../../shared/quant-stats";
import { RegimeAnalysisError } from "./errors";
import { assertRegimeWindowPit, regimeCompareDate } from "./dates";
import { deriveRegimeSentimentFromLimitUp } from "./facts";
import type {
  RegimeBreadthLabel,
  RegimeDayFacts,
  RegimeDimensionId,
  RegimeDimensionTag,
  RegimeIndexStateLabel,
  RegimeLimitUpEnvLabel,
  RegimeLiquidityLabel,
  RegimeLookbackWindow,
  RegimeSentimentLabel,
  RegimeTrendLabel,
  RegimeUnassessedReasonCode,
  RegimeUnassessedTag,
  RegimeVolatilityLabel,
  ResolvedRegimeBreadthConfig,
  ResolvedRegimeIndexStateConfig,
  ResolvedRegimeLimitUpEnvConfig,
  ResolvedRegimeLiquidityConfig,
  ResolvedRegimeSentimentConfig,
  ResolvedRegimeTrendConfig,
  ResolvedRegimeVolatilityConfig,
} from "./types";

// ---------------------------------------------------------------------------
// 回看窗（PIT 核心：只回看，含 T，不居中不前向）
// ---------------------------------------------------------------------------

/** 回看窗解析结果。 */
export interface RegimeWindowResolution {
  /** 窗口内日级事实（升序，末项 tradeDate === asOf）。 */
  readonly window: readonly RegimeDayFacts[];
  readonly lookbackWindow: RegimeLookbackWindow;
  /** 实际交易日数是否满足配置要求（不足 → 各维 unassessed INSUFFICIENT_HISTORY）。 */
  readonly sufficient: boolean;
}

/**
 * 取回看窗 [asOf − (N−1) .. asOf]（按**交易日**计数，含 asOf 日，共 N 个）。
 *
 * - asOf 必须存在于序列中，否则抛 REGIME_ASOF_NOT_AVAILABLE（FAIL FAST：
 *   「T 日标签在 T−1 日不可得」由此保证——没有 T 的数据就没有 T 的标签）；
 * - 窗口逐日断言 PIT（tradeDate <= asOf 且 asOf === tradeDate）。
 *
 * 前置条件：series 按 tradeDate 严格升序且无重复（由 run.ts 的
 * assertRegimeSeriesOrdered 一次性校验；本函数用二分查找定位）。
 */
export function buildRegimeLookbackWindow(
  series: readonly RegimeDayFacts[],
  asOf: string,
  lookbackTradingDays: number,
): RegimeWindowResolution {
  if (!Number.isInteger(lookbackTradingDays) || lookbackTradingDays < 1) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_PARAMETER",
      `marketRegime: lookbackTradingDays 必须是 >= 1 的整数，实际 ${String(lookbackTradingDays)}`,
    );
  }
  let low = 0;
  let high = series.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const comparison = regimeCompareDate(series[mid]!.tradeDate, asOf);
    if (comparison === 0) {
      found = mid;
      break;
    }
    if (comparison < 0) low = mid + 1;
    else high = mid - 1;
  }
  if (found < 0) {
    throw new RegimeAnalysisError(
      "REGIME_ASOF_NOT_AVAILABLE",
      `marketRegime: asOf=${asOf} 不在日级事实序列中（序列 ${series.length} 个交易日）；` +
        `regime 标签只能由 asOf 当日及之前的数据计算，禁止就近取值或推断未来`,
    );
  }
  const start = Math.max(0, found - lookbackTradingDays + 1);
  const window = series.slice(start, found + 1);
  assertRegimeWindowPit(window, asOf);
  const lookbackWindow: RegimeLookbackWindow = {
    startDate: window[0]!.tradeDate,
    endDate: asOf,
    tradingDayCount: window.length,
    requiredTradingDayCount: lookbackTradingDays,
  };
  return { window, lookbackWindow, sufficient: window.length >= lookbackTradingDays };
}

// ---------------------------------------------------------------------------
// 标签构造工具
// ---------------------------------------------------------------------------

function unassessedTag(
  dimension: RegimeDimensionId,
  tradeDate: string,
  reasonCode: RegimeUnassessedReasonCode,
  reason: string,
  lookbackWindow: RegimeLookbackWindow | null,
  sampleSize = 0,
): RegimeUnassessedTag {
  return {
    kind: "unassessed",
    dimension,
    reasonCode,
    reason,
    tradeDate,
    asOf: tradeDate,
    lookbackWindow,
    sampleSize,
  };
}

function insufficientHistoryTag(
  dimension: RegimeDimensionId,
  tradeDate: string,
  lookbackWindow: RegimeLookbackWindow,
): RegimeUnassessedTag {
  return unassessedTag(
    dimension,
    tradeDate,
    "REGIME_INSUFFICIENT_HISTORY",
    `回看窗交易日数不足：实际 ${lookbackWindow.tradingDayCount} < 要求 ${lookbackWindow.requiredTradingDayCount}` +
      `（regime 标签禁止用不足窗口的数据推断，故本维未评估）`,
    lookbackWindow,
    lookbackWindow.tradingDayCount,
  );
}

/** 取窗口内基准指数的有效收盘序列（按交易日升序；缺失日跳过）。 */
function benchmarkCloses(
  window: readonly RegimeDayFacts[],
  benchmarkIndexCode: string,
): number[] {
  const closes: number[] = [];
  for (const day of window) {
    const close = day.indexCloses[benchmarkIndexCode];
    if (typeof close === "number" && Number.isFinite(close) && close > 0) closes.push(close);
  }
  return closes;
}

/** asOf 当日是否缺少基准收盘。 */
function benchmarkMissingAtAsOf(day: RegimeDayFacts | undefined, benchmarkIndexCode: string): boolean {
  if (day === undefined) return true;
  const close = day.indexCloses[benchmarkIndexCode];
  return !(typeof close === "number" && Number.isFinite(close) && close > 0);
}

// ---------------------------------------------------------------------------
// 1. Trend（趋势）
// ---------------------------------------------------------------------------

/**
 * 趋势：窗口总收益（收盘 T / 收盘 窗口首日 − 1）。
 * 阈值：>= +upThresholdPct → up；<= −downThresholdPct → down；否则 sideways。
 */
export function classifyRegimeTrend(
  series: readonly RegimeDayFacts[],
  asOf: string,
  config: ResolvedRegimeTrendConfig,
  benchmarkIndexCode: string,
): RegimeDimensionTag<RegimeTrendLabel> {
  const { window, lookbackWindow, sufficient } = buildRegimeLookbackWindow(
    series,
    asOf,
    config.lookbackTradingDays,
  );
  if (!sufficient) return insufficientHistoryTag("trend", asOf, lookbackWindow);
  if (benchmarkMissingAtAsOf(window[window.length - 1], benchmarkIndexCode)) {
    return unassessedTag(
      "trend",
      asOf,
      "REGIME_BENCHMARK_MISSING",
      `基准指数 ${benchmarkIndexCode} 在 asOf=${asOf} 无有效收盘价，无法定位当前点位`,
      lookbackWindow,
    );
  }
  const closes = benchmarkCloses(window, benchmarkIndexCode);
  if (closes.length < 2) {
    return unassessedTag(
      "trend",
      asOf,
      "REGIME_DATA_MISSING",
      `窗口内基准 ${benchmarkIndexCode} 有效收盘价 ${closes.length} 个（需 >= 2 才能算区间收益）`,
      lookbackWindow,
      closes.length,
    );
  }
  const startClose = closes[0]!;
  const endClose = closes[closes.length - 1]!;
  const windowReturnPct = (endClose / startClose - 1) * 100;
  const maValue = mean(closes);
  const maRatioPct = maValue === null || maValue === 0 ? null : (endClose / maValue - 1) * 100;
  let label: RegimeTrendLabel = "sideways";
  if (windowReturnPct >= config.upThresholdPct) label = "up";
  else if (windowReturnPct <= -config.downThresholdPct) label = "down";
  return {
    kind: "assessed",
    dimension: "trend",
    label,
    tradeDate: asOf,
    asOf,
    lookbackWindow,
    sampleSize: closes.length,
    metrics: {
      windowReturnPct,
      startClose,
      endClose,
      deviationFromWindowMeanPct: maRatioPct,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Volatility（波动率）
// ---------------------------------------------------------------------------

/**
 * 波动率：窗口内日收益的**样本**标准差（n−1）× √年化因子。
 * 阈值（年化 %）：<= low → low；>= high → high；否则 mid。
 */
export function classifyRegimeVolatility(
  series: readonly RegimeDayFacts[],
  asOf: string,
  config: ResolvedRegimeVolatilityConfig,
  benchmarkIndexCode: string,
): RegimeDimensionTag<RegimeVolatilityLabel> {
  const { window, lookbackWindow, sufficient } = buildRegimeLookbackWindow(
    series,
    asOf,
    config.lookbackTradingDays,
  );
  if (!sufficient) return insufficientHistoryTag("volatility", asOf, lookbackWindow);
  if (benchmarkMissingAtAsOf(window[window.length - 1], benchmarkIndexCode)) {
    return unassessedTag(
      "volatility",
      asOf,
      "REGIME_BENCHMARK_MISSING",
      `基准指数 ${benchmarkIndexCode} 在 asOf=${asOf} 无有效收盘价`,
      lookbackWindow,
    );
  }
  const closes = benchmarkCloses(window, benchmarkIndexCode);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    returns.push((closes[i]! / closes[i - 1]! - 1) * 100);
  }
  if (returns.length < config.minSampleSize) {
    return unassessedTag(
      "volatility",
      asOf,
      "REGIME_INSUFFICIENT_HISTORY",
      `日收益样本 ${returns.length} 个 < 配置最小样本 ${config.minSampleSize}（样本标准差在小样本下不可信）`,
      lookbackWindow,
      returns.length,
    );
  }
  const dailyStdPct = sampleStandardDeviation(returns);
  if (dailyStdPct === null) {
    return unassessedTag(
      "volatility",
      asOf,
      "REGIME_DATA_MISSING",
      "日收益序列无法计算样本标准差（全为非有限值）",
      lookbackWindow,
      returns.length,
    );
  }
  const annualizedVolPct = dailyStdPct * Math.sqrt(config.annualizationFactor);
  let label: RegimeVolatilityLabel = "mid";
  if (annualizedVolPct <= config.lowThresholdPct) label = "low";
  else if (annualizedVolPct >= config.highThresholdPct) label = "high";
  return {
    kind: "assessed",
    dimension: "volatility",
    label,
    tradeDate: asOf,
    asOf,
    lookbackWindow,
    sampleSize: returns.length,
    metrics: {
      dailyStdPct,
      annualizedVolPct,
      meanDailyReturnPct: mean(returns),
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Liquidity（流动性）
// ---------------------------------------------------------------------------

/** 取某日的流动性度量值（amount = 全市场成交额；turnoverRate = 换手率均值）。 */
function liquidityValueOf(day: RegimeDayFacts, metric: "amount" | "turnoverRate"): number | null {
  const value = metric === "amount" ? day.totalAmount : day.meanTurnoverRate;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * 流动性：当日度量值 ÷ 窗口均值（**相对自身历史**的量能口径）。
 * 阈值：>= highRatio → high（放量）；<= lowRatio → low（缩量）；否则 mid。
 */
export function classifyRegimeLiquidity(
  series: readonly RegimeDayFacts[],
  asOf: string,
  config: ResolvedRegimeLiquidityConfig,
): RegimeDimensionTag<RegimeLiquidityLabel> {
  const { window, lookbackWindow, sufficient } = buildRegimeLookbackWindow(
    series,
    asOf,
    config.lookbackTradingDays,
  );
  if (!sufficient) return insufficientHistoryTag("liquidity", asOf, lookbackWindow);
  const current = liquidityValueOf(window[window.length - 1]!, config.metric);
  if (current === null) {
    return unassessedTag(
      "liquidity",
      asOf,
      "REGIME_DATA_MISSING",
      `asOf=${asOf} 的流动性度量（${config.metric}）缺失或非正，无法计算相对量能`,
      lookbackWindow,
    );
  }
  const values: number[] = [];
  for (const day of window) {
    const value = liquidityValueOf(day, config.metric);
    if (value !== null) values.push(value);
  }
  const baseline = mean(values);
  if (baseline === null || baseline <= 0) {
    return unassessedTag(
      "liquidity",
      asOf,
      "REGIME_DATA_MISSING",
      `窗口内流动性度量（${config.metric}）无可用的正数基准均值，无法计算比值`,
      lookbackWindow,
      values.length,
    );
  }
  const ratio = current / baseline;
  let label: RegimeLiquidityLabel = "mid";
  if (ratio >= config.highRatio) label = "high";
  else if (ratio <= config.lowRatio) label = "low";
  return {
    kind: "assessed",
    dimension: "liquidity",
    label,
    tradeDate: asOf,
    asOf,
    lookbackWindow,
    sampleSize: values.length,
    metrics: {
      currentValue: current,
      windowMeanValue: baseline,
      relativeRatio: ratio,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Breadth（市场宽度）
// ---------------------------------------------------------------------------

/**
 * 宽度：窗口内逐日「上涨家数 / 可判定家数」的均值（平滑，抗单日噪声）。
 * 阈值：>= broadThreshold → broad；<= narrowThreshold → narrow；否则 mixed。
 */
export function classifyRegimeBreadth(
  series: readonly RegimeDayFacts[],
  asOf: string,
  config: ResolvedRegimeBreadthConfig,
): RegimeDimensionTag<RegimeBreadthLabel> {
  const { window, lookbackWindow, sufficient } = buildRegimeLookbackWindow(
    series,
    asOf,
    config.lookbackTradingDays,
  );
  if (!sufficient) return insufficientHistoryTag("breadth", asOf, lookbackWindow);

  const ratios: number[] = [];
  let anyCrossSection = false;
  for (const day of window) {
    const validCount = day.advancingCount + day.decliningCount + day.unchangedCount;
    if (validCount > 0) anyCrossSection = true;
    if (validCount < config.minDailySampleSize) continue;
    ratios.push(day.advancingCount / validCount);
  }
  if (!anyCrossSection) {
    return unassessedTag(
      "breadth",
      asOf,
      "REGIME_NO_CROSS_SECTION",
      "窗口内无任何可判定涨跌的证券（横截面为空），宽度不可计算",
      lookbackWindow,
    );
  }
  if (ratios.length === 0) {
    return unassessedTag(
      "breadth",
      asOf,
      "REGIME_DATA_MISSING",
      `窗口内所有交易日的可判定家数均 < 最小样本 ${config.minDailySampleSize}，宽度不可计算`,
      lookbackWindow,
    );
  }
  const meanRatio = mean(ratios)!;
  let label: RegimeBreadthLabel = "mixed";
  if (meanRatio >= config.broadThreshold) label = "broad";
  else if (meanRatio <= config.narrowThreshold) label = "narrow";

  const currentDay = window[window.length - 1]!;
  const currentValid =
    currentDay.advancingCount + currentDay.decliningCount + currentDay.unchangedCount;
  return {
    kind: "assessed",
    dimension: "breadth",
    label,
    tradeDate: asOf,
    asOf,
    lookbackWindow,
    sampleSize: ratios.length,
    metrics: {
      meanAdvanceRatio: meanRatio,
      eligibleDayCount: ratios.length,
      currentAdvanceRatio: currentValid > 0 ? currentDay.advancingCount / currentValid : null,
      currentValidCount: currentValid,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Sentiment（市场情绪）
// ---------------------------------------------------------------------------

/**
 * 情绪：窗口内逐日「净占比 = (涨停 − 跌停) / (涨停 + 跌停)」的均值。
 * 阈值：>= riskOnThreshold → risk_on；<= −riskOffThreshold → risk_off；否则 neutral。
 *
 * 数据源纪律：情绪事实（RegimeSentimentFacts）项目当前**未回填**；默认
 * allowSentimentLimitUpProxy=false → 无事实即 unassessed（SENTIMENT_SOURCE_MISSING），
 * 绝不拿涨停环境冒充情绪数据。
 */
export function classifyRegimeSentiment(
  series: readonly RegimeDayFacts[],
  asOf: string,
  config: ResolvedRegimeSentimentConfig,
): RegimeDimensionTag<RegimeSentimentLabel> {
  const { window, lookbackWindow, sufficient } = buildRegimeLookbackWindow(
    series,
    asOf,
    config.lookbackTradingDays,
  );
  if (!sufficient) return insufficientHistoryTag("sentiment", asOf, lookbackWindow);

  const scores: number[] = [];
  let hadSource = false;
  let hadDenominator = false;
  for (const day of window) {
    const source =
      day.sentiment ?? (config.allowSentimentLimitUpProxy ? deriveRegimeSentimentFromLimitUp(day) : null);
    if (source === null) continue;
    hadSource = true;
    const denominator = source.limitUpCount + source.limitDownCount;
    if (denominator > 0) {
      hadDenominator = true;
      scores.push((source.limitUpCount - source.limitDownCount) / denominator);
    }
  }
  if (!hadSource) {
    return unassessedTag(
      "sentiment",
      asOf,
      "REGIME_SENTIMENT_SOURCE_MISSING",
      "情绪数据源缺失（项目未回填连板高度/炸板率等情绪类数据；" +
        "allowSentimentLimitUpProxy=false 时禁止用涨跌停家数代理，故本维未评估）",
      lookbackWindow,
    );
  }
  if (!hadDenominator || scores.length === 0) {
    return unassessedTag(
      "sentiment",
      asOf,
      "REGIME_DATA_MISSING",
      "窗口内涨跌停家数合计恒为 0，情绪净占比无分母（不可计算，不等于中性）",
      lookbackWindow,
    );
  }
  const meanScore = mean(scores)!;
  let label: RegimeSentimentLabel = "neutral";
  if (meanScore >= config.riskOnThreshold) label = "risk_on";
  else if (meanScore <= -config.riskOffThreshold) label = "risk_off";

  const currentDay = window[window.length - 1]!;
  const currentSource =
    currentDay.sentiment ??
    (config.allowSentimentLimitUpProxy ? deriveRegimeSentimentFromLimitUp(currentDay) : null);
  return {
    kind: "assessed",
    dimension: "sentiment",
    label,
    tradeDate: asOf,
    asOf,
    lookbackWindow,
    sampleSize: scores.length,
    metrics: {
      meanNetRatio: meanScore,
      eligibleDayCount: scores.length,
      currentLimitUpCount: currentSource?.limitUpCount ?? null,
      currentLimitDownCount: currentSource?.limitDownCount ?? null,
      currentMaxConsecutiveBoard: currentSource?.maxConsecutiveBoard ?? null,
      currentBrokenBoardCount: currentSource?.brokenBoardCount ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Index State（指数状态）
// ---------------------------------------------------------------------------

/**
 * 指数状态：asOf 收盘相对窗口均线的偏离（%）。
 * 阈值：>= +bandPct → above_ma；<= −bandPct → below_ma；否则 near_ma（噪声缓冲带）。
 */
export function classifyRegimeIndexState(
  series: readonly RegimeDayFacts[],
  asOf: string,
  config: ResolvedRegimeIndexStateConfig,
  benchmarkIndexCode: string,
): RegimeDimensionTag<RegimeIndexStateLabel> {
  const { window, lookbackWindow, sufficient } = buildRegimeLookbackWindow(
    series,
    asOf,
    config.lookbackTradingDays,
  );
  if (!sufficient) return insufficientHistoryTag("indexState", asOf, lookbackWindow);
  if (benchmarkMissingAtAsOf(window[window.length - 1], benchmarkIndexCode)) {
    return unassessedTag(
      "indexState",
      asOf,
      "REGIME_BENCHMARK_MISSING",
      `基准指数 ${benchmarkIndexCode} 在 asOf=${asOf} 无有效收盘价`,
      lookbackWindow,
    );
  }
  const closes = benchmarkCloses(window, benchmarkIndexCode);
  if (closes.length < 2) {
    return unassessedTag(
      "indexState",
      asOf,
      "REGIME_DATA_MISSING",
      `窗口内基准 ${benchmarkIndexCode} 有效收盘价 ${closes.length} 个（需 >= 2 才能算均线）`,
      lookbackWindow,
      closes.length,
    );
  }
  const last = closes[closes.length - 1]!;
  const movingAverage = mean(closes)!;
  const deviationFromMaPct = (last / movingAverage - 1) * 100;
  const windowHigh = Math.max(...closes);
  let label: RegimeIndexStateLabel = "near_ma";
  if (deviationFromMaPct >= config.bandPct) label = "above_ma";
  else if (deviationFromMaPct <= -config.bandPct) label = "below_ma";
  return {
    kind: "assessed",
    dimension: "indexState",
    label,
    tradeDate: asOf,
    asOf,
    lookbackWindow,
    sampleSize: closes.length,
    metrics: {
      close: last,
      movingAverage,
      deviationFromMaPct,
      drawdownFromWindowHighPct: (last / windowHigh - 1) * 100,
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Limit-up Environment（涨停环境）
// ---------------------------------------------------------------------------

/**
 * 涨停环境：窗口内逐日「涨停家数 / 涨跌停可判定家数」（%）的均值。
 * 阈值：>= hotThresholdPct → hot；<= coldThresholdPct → cold；否则 normal。
 */
export function classifyRegimeLimitUpEnv(
  series: readonly RegimeDayFacts[],
  asOf: string,
  config: ResolvedRegimeLimitUpEnvConfig,
): RegimeDimensionTag<RegimeLimitUpEnvLabel> {
  const { window, lookbackWindow, sufficient } = buildRegimeLookbackWindow(
    series,
    asOf,
    config.lookbackTradingDays,
  );
  if (!sufficient) return insufficientHistoryTag("limitUpEnv", asOf, lookbackWindow);

  const ratios: number[] = [];
  let anyClassifiable = false;
  for (const day of window) {
    if (day.limitClassifiableCount > 0) anyClassifiable = true;
    if (day.limitClassifiableCount < config.minDailySampleSize) continue;
    ratios.push((day.limitUpCount / day.limitClassifiableCount) * 100);
  }
  if (!anyClassifiable) {
    return unassessedTag(
      "limitUpEnv",
      asOf,
      "REGIME_NO_CROSS_SECTION",
      "窗口内无任何可判定涨跌停的证券（代码缺失或板块不可识别），涨停环境不可计算",
      lookbackWindow,
    );
  }
  if (ratios.length === 0) {
    return unassessedTag(
      "limitUpEnv",
      asOf,
      "REGIME_DATA_MISSING",
      `窗口内所有交易日的涨跌停可判定家数均 < 最小样本 ${config.minDailySampleSize}`,
      lookbackWindow,
    );
  }
  const meanRatioPct = mean(ratios)!;
  let label: RegimeLimitUpEnvLabel = "normal";
  if (meanRatioPct >= config.hotThresholdPct) label = "hot";
  else if (meanRatioPct <= config.coldThresholdPct) label = "cold";

  const currentDay = window[window.length - 1]!;
  return {
    kind: "assessed",
    dimension: "limitUpEnv",
    label,
    tradeDate: asOf,
    asOf,
    lookbackWindow,
    sampleSize: ratios.length,
    metrics: {
      meanLimitUpRatioPct: meanRatioPct,
      eligibleDayCount: ratios.length,
      currentLimitUpCount: currentDay.limitUpCount,
      currentLimitDownCount: currentDay.limitDownCount,
      currentClassifiableCount: currentDay.limitClassifiableCount,
    },
  };
}
