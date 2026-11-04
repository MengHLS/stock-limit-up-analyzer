/**
 * STEP 22 / C-22.1 — Market Regime：七维阈值配置与默认值（**默认不得隐藏假设**）。
 *
 * 纪律：
 *   - 每个默认值必须写明「是什么」+「为什么是它（依据/性质）」+「不是什么（避免误读）」；
 *   - 阈值均为**研究约定**（便于横向比较与复现），**不是市场真值、不是盈利保证**；
 *     使用者可显式覆盖（resolve*Config），覆盖值进入记录（Run.configs）自描述；
 *   - 配置非法（非有限、回看窗 < 2、低阈值 >= 高阈值、年化因子 <= 0 等）→ 响亮抛错
 *     REGIME_CONFIG_INVALID，绝不静默 clamp（clamp 会把非法假设伪装成合法口径）。
 *
 * 默认依据速查（详见各常量注释）：
 *   趋势           20 日 / ±5%
 *   波动率         20 日 / 年化（×√252）/ 低<15% · 高>=30%
 *   流动性         60 日 / 当日÷窗口均值 / 缩量<=0.8 · 放量>=1.2
 *   市场宽度        5 日平滑 / 普涨>=0.6 · 普跌<=0.4
 *   市场情绪        5 日平滑 / 净占比 ±0.3（**数据源缺失默认 unassessed**）
 *   指数状态       60 日均线 / 噪声缓冲带 ±3%
 *   涨停环境        5 日平滑 / 涨停占比 火热>=2% · 低迷<=0.5%
 */

import { RegimeAnalysisError } from "./errors";
import type {
  RegimeConfigSet,
  RegimeLiquidityMetric,
  RegimeTrendConfig,
  RegimeVolatilityConfig,
  RegimeLiquidityConfig,
  RegimeBreadthConfig,
  RegimeSentimentConfig,
  RegimeIndexStateConfig,
  RegimeLimitUpEnvConfig,
  ResolvedRegimeConfigSet,
  ResolvedRegimeTrendConfig,
  ResolvedRegimeVolatilityConfig,
  ResolvedRegimeLiquidityConfig,
  ResolvedRegimeBreadthConfig,
  ResolvedRegimeSentimentConfig,
  ResolvedRegimeIndexStateConfig,
  ResolvedRegimeLimitUpEnvConfig,
} from "./types";

// ---------------------------------------------------------------------------
// 全局默认
// ---------------------------------------------------------------------------

/**
 * 年化交易日数（缺省 252）。
 * 依据：A 股一年约 242~244 个交易日，252 是国际通行口径（与 C-16.2 Sharpe/
 * Sortino 的 annualizationFactor 及 shared/quant-stats sharpeRatio 默认一致），
 * 便于跨模块结果可比。不是「A 股真实交易天数」。
 */
export const MARKET_REGIME_DEFAULT_ANNUALIZATION_FACTOR = 252;

/**
 * 默认基准指数：沪深300（000300.SH）。
 * 依据：server/historicalState/db.ts DEFAULT_CORE_INDEX_CODES 四核心指数之一；
 * 沪深300 覆盖沪深两市大盘蓝筹，是 A 股最常用的趋势/波动/均线状态基准。
 * 不是「唯一正确基准」——小盘策略应显式改为 000905.SH（中证500）等。
 */
export const MARKET_REGIME_DEFAULT_BENCHMARK_INDEX_CODE = "000300.SH";

// ---------------------------------------------------------------------------
// 趋势
// ---------------------------------------------------------------------------

/** 趋势回看交易日数（缺省 20 ≈ 1 个自然月）。 */
export const REGIME_TREND_DEFAULT_LOOKBACK = 20;

/**
 * 趋势上涨阈值（缺省 5%）：窗口总收益 >= +5% 记为 up。
 * 依据：沪深300 月度收益标准差约 5%~7%，取 5% 作为「一个月内方向显著」的研究分档；
 * 不是统计显著性检验（未做 t 检验），只是可复现的分档约定。
 */
export const REGIME_TREND_DEFAULT_UP_THRESHOLD_PCT = 5;

/** 趋势下跌阈值（缺省 5%，绝对值）：窗口总收益 <= −5% 记为 down。与上涨阈值对称。 */
export const REGIME_TREND_DEFAULT_DOWN_THRESHOLD_PCT = 5;

// ---------------------------------------------------------------------------
// 波动率
// ---------------------------------------------------------------------------

/** 波动率回看交易日数（缺省 20）。 */
export const REGIME_VOLATILITY_DEFAULT_LOOKBACK = 20;

/**
 * 低波动上界（缺省 15%，年化）：年化波动率 <= 15% 记为 low。
 * 依据：沪深300 长期年化波动率区间大致 15%~30%，15% 以下属相对平静期。
 * 口径：日收益**样本**标准差（n−1，quant-stats sampleStandardDeviation）× √252。
 */
export const REGIME_VOLATILITY_DEFAULT_LOW_THRESHOLD_PCT = 15;

/** 高波动下界（缺省 30%，年化）：>= 30% 记为 high（压力/恐慌区常见水平）。 */
export const REGIME_VOLATILITY_DEFAULT_HIGH_THRESHOLD_PCT = 30;

/** 波动率最少日收益样本数（缺省 5）：不足则 unassessed（样本标准差在小样本下不可信）。 */
export const REGIME_VOLATILITY_DEFAULT_MIN_SAMPLE_SIZE = 5;

// ---------------------------------------------------------------------------
// 流动性
// ---------------------------------------------------------------------------

/** 流动性回看交易日数（缺省 60 ≈ 1 个季度；量能基准需比趋势窗更长才稳定）。 */
export const REGIME_LIQUIDITY_DEFAULT_LOOKBACK = 60;

/** 流动性度量口径（缺省 amount = 全市场成交额合计）。 */
export const REGIME_LIQUIDITY_DEFAULT_METRIC: RegimeLiquidityMetric = "amount";

/**
 * 放量倍数（缺省 1.2）：当日度量值 / 窗口均值 >= 1.2 记为 high。
 * 依据：A 股常用「量能较均量放大两成」作为放量经验阈值（±20% 是量能异动的常见分档）。
 * 注意：这是**相对自身历史**的口径，不是绝对成交额门槛（绝对门槛会随市场扩容漂移）。
 */
export const REGIME_LIQUIDITY_DEFAULT_HIGH_RATIO = 1.2;

/** 缩量倍数（缺省 0.8）：<= 0.8 记为 low。 */
export const REGIME_LIQUIDITY_DEFAULT_LOW_RATIO = 0.8;

// ---------------------------------------------------------------------------
// 市场宽度
// ---------------------------------------------------------------------------

/** 宽度平滑窗口（缺省 5 ≈ 1 周）：逐日上涨家数占比的均值，避免单日噪声。 */
export const REGIME_BREADTH_DEFAULT_LOOKBACK = 5;

/**
 * 普涨阈值（缺省 0.6）：窗口平均上涨家数占比 >= 60% 记为 broad。
 * 依据：全市场等权视角下 60/40 是常用的「普涨/普跌」经验分界线（对称、易解释）。
 */
export const REGIME_BREADTH_DEFAULT_BROAD_THRESHOLD = 0.6;

/** 普跌阈值（缺省 0.4）：<= 40% 记为 narrow。 */
export const REGIME_BREADTH_DEFAULT_NARROW_THRESHOLD = 0.4;

/** 单日最小可判定家数（缺省 10）：样本过少的交易日不参与平滑（防小样本污染）。 */
export const REGIME_BREADTH_DEFAULT_MIN_DAILY_SAMPLE_SIZE = 10;

// ---------------------------------------------------------------------------
// 市场情绪
// ---------------------------------------------------------------------------

/** 情绪平滑窗口（缺省 5）。 */
export const REGIME_SENTIMENT_DEFAULT_LOOKBACK = 5;

/**
 * risk_on 阈值（缺省 0.3）：情绪得分 >= 0.3 记为 risk_on。
 * 得分口径（唯一）：净占比 = (涨停家数 − 跌停家数) / (涨停家数 + 跌停家数) ∈ [−1, 1]。
 * 依据：涨停家数显著多于跌停家数（净占比 ≥ 三成）通常对应赚钱效应扩散期；
 * 0.3 为研究约定分档，非统计检验结论。
 */
export const REGIME_SENTIMENT_DEFAULT_RISK_ON_THRESHOLD = 0.3;

/** risk_off 阈值（缺省 0.3，绝对值）：<= −0.3 记为 risk_off。 */
export const REGIME_SENTIMENT_DEFAULT_RISK_OFF_THRESHOLD = 0.3;

/**
 * 是否允许用涨跌停家数代理情绪（缺省 **false**）。
 *
 * 为什么默认关闭：项目当前**无情绪类数据源**（连板高度/炸板率等，见 ROADMAP §44.1
 * 无对应表），而「涨停环境」已是独立维度；用涨停家数代理情绪会造成两维高度共线，
 * 并让「情绪」看起来已评估。默认关闭 → 缺失即 unassessed
 * （reasonCode=REGIME_SENTIMENT_SOURCE_MISSING），诚实反映数据缺口。
 */
export const REGIME_SENTIMENT_DEFAULT_ALLOW_LIMIT_UP_PROXY = false;

// ---------------------------------------------------------------------------
// 指数状态
// ---------------------------------------------------------------------------

/** 指数状态均线回看交易日数（缺省 60 ≈ 1 季度）。 */
export const REGIME_INDEX_STATE_DEFAULT_LOOKBACK = 60;

/**
 * 均线噪声缓冲带（缺省 3%，绝对值）：偏离 |x| < 3% 记为 near_ma。
 * 依据：指数在均线附近 ±3% 内震荡通常无方向信息，用缓冲带避免标签在临界处频繁翻转；
 * 3% 为研究约定（约等于沪深300 两周波动幅度量级）。
 */
export const REGIME_INDEX_STATE_DEFAULT_BAND_PCT = 3;

// ---------------------------------------------------------------------------
// 涨停环境
// ---------------------------------------------------------------------------

/** 涨停环境平滑窗口（缺省 5）。 */
export const REGIME_LIMIT_UP_ENV_DEFAULT_LOOKBACK = 5;

/**
 * 涨停环境火热阈值（缺省 2%）：窗口平均「涨停家数 / 可判定家数」>= 2% 记为 hot。
 * 依据：A 股全市场约 5000 只股票，日常涨停占比约 1% 上下；≥2% 通常对应情绪高涨/
 * 赚钱效应强（研究约定，非市场真值）。
 */
export const REGIME_LIMIT_UP_ENV_DEFAULT_HOT_THRESHOLD_PCT = 2;

/** 涨停环境低迷阈值（缺省 0.5%）：<= 0.5% 记为 cold。 */
export const REGIME_LIMIT_UP_ENV_DEFAULT_COLD_THRESHOLD_PCT = 0.5;

/** 涨停环境单日最小可判定家数（缺省 10）。 */
export const REGIME_LIMIT_UP_ENV_DEFAULT_MIN_DAILY_SAMPLE_SIZE = 10;

// ---------------------------------------------------------------------------
// 校验工具
// ---------------------------------------------------------------------------

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 ${label} 必须是有限数字，实际 ${String(value)}`,
    );
  }
}

function assertPositiveInt(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 ${label} 必须是 >= ${min} 的整数，实际 ${String(value)}`,
    );
  }
}

function assertOrder(low: number, high: number, label: string): void {
  if (!(low < high)) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 ${label} 低阈值必须严格小于高阈值，实际 low=${String(low)} high=${String(high)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 各维解析（缺省补齐 + 非法响亮拒绝）
// ---------------------------------------------------------------------------

/** 解析趋势配置。 */
export function resolveRegimeTrendConfig(config?: RegimeTrendConfig): ResolvedRegimeTrendConfig {
  const resolved: ResolvedRegimeTrendConfig = {
    lookbackTradingDays: config?.lookbackTradingDays ?? REGIME_TREND_DEFAULT_LOOKBACK,
    upThresholdPct: config?.upThresholdPct ?? REGIME_TREND_DEFAULT_UP_THRESHOLD_PCT,
    downThresholdPct: config?.downThresholdPct ?? REGIME_TREND_DEFAULT_DOWN_THRESHOLD_PCT,
  };
  assertPositiveInt(resolved.lookbackTradingDays, "trend.lookbackTradingDays", 2);
  assertFiniteNumber(resolved.upThresholdPct, "trend.upThresholdPct");
  assertFiniteNumber(resolved.downThresholdPct, "trend.downThresholdPct");
  if (resolved.upThresholdPct < 0 || resolved.downThresholdPct < 0) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      "marketRegime: 配置 trend 阈值必须 >= 0（方向由符号决定，阈值取绝对值）",
    );
  }
  return resolved;
}

/** 解析波动率配置（annualizationFactor 缺省继承全局年化因子）。 */
export function resolveRegimeVolatilityConfig(
  config?: RegimeVolatilityConfig,
  annualizationFactor: number = MARKET_REGIME_DEFAULT_ANNUALIZATION_FACTOR,
): ResolvedRegimeVolatilityConfig {
  const resolved: ResolvedRegimeVolatilityConfig = {
    lookbackTradingDays: config?.lookbackTradingDays ?? REGIME_VOLATILITY_DEFAULT_LOOKBACK,
    annualizationFactor: config?.annualizationFactor ?? annualizationFactor,
    lowThresholdPct: config?.lowThresholdPct ?? REGIME_VOLATILITY_DEFAULT_LOW_THRESHOLD_PCT,
    highThresholdPct: config?.highThresholdPct ?? REGIME_VOLATILITY_DEFAULT_HIGH_THRESHOLD_PCT,
    minSampleSize: config?.minSampleSize ?? REGIME_VOLATILITY_DEFAULT_MIN_SAMPLE_SIZE,
  };
  assertPositiveInt(resolved.lookbackTradingDays, "volatility.lookbackTradingDays", 2);
  assertPositiveInt(resolved.minSampleSize, "volatility.minSampleSize", 2);
  assertFiniteNumber(resolved.annualizationFactor, "volatility.annualizationFactor");
  assertFiniteNumber(resolved.lowThresholdPct, "volatility.lowThresholdPct");
  assertFiniteNumber(resolved.highThresholdPct, "volatility.highThresholdPct");
  if (resolved.annualizationFactor <= 0) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 volatility.annualizationFactor 必须 > 0，实际 ${String(resolved.annualizationFactor)}`,
    );
  }
  assertOrder(resolved.lowThresholdPct, resolved.highThresholdPct, "volatility 波动分档");
  return resolved;
}

/** 解析流动性配置。 */
export function resolveRegimeLiquidityConfig(
  config?: RegimeLiquidityConfig,
): ResolvedRegimeLiquidityConfig {
  const resolved: ResolvedRegimeLiquidityConfig = {
    lookbackTradingDays: config?.lookbackTradingDays ?? REGIME_LIQUIDITY_DEFAULT_LOOKBACK,
    metric: config?.metric ?? REGIME_LIQUIDITY_DEFAULT_METRIC,
    highRatio: config?.highRatio ?? REGIME_LIQUIDITY_DEFAULT_HIGH_RATIO,
    lowRatio: config?.lowRatio ?? REGIME_LIQUIDITY_DEFAULT_LOW_RATIO,
  };
  assertPositiveInt(resolved.lookbackTradingDays, "liquidity.lookbackTradingDays", 2);
  assertFiniteNumber(resolved.highRatio, "liquidity.highRatio");
  assertFiniteNumber(resolved.lowRatio, "liquidity.lowRatio");
  if (resolved.metric !== "amount" && resolved.metric !== "turnoverRate") {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 liquidity.metric 必须是 amount | turnoverRate，实际 ${String(resolved.metric)}`,
    );
  }
  if (resolved.lowRatio <= 0) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 liquidity.lowRatio 必须 > 0，实际 ${String(resolved.lowRatio)}`,
    );
  }
  assertOrder(resolved.lowRatio, resolved.highRatio, "liquidity 量能分档");
  return resolved;
}

/** 解析市场宽度配置。 */
export function resolveRegimeBreadthConfig(config?: RegimeBreadthConfig): ResolvedRegimeBreadthConfig {
  const resolved: ResolvedRegimeBreadthConfig = {
    lookbackTradingDays: config?.lookbackTradingDays ?? REGIME_BREADTH_DEFAULT_LOOKBACK,
    broadThreshold: config?.broadThreshold ?? REGIME_BREADTH_DEFAULT_BROAD_THRESHOLD,
    narrowThreshold: config?.narrowThreshold ?? REGIME_BREADTH_DEFAULT_NARROW_THRESHOLD,
    minDailySampleSize: config?.minDailySampleSize ?? REGIME_BREADTH_DEFAULT_MIN_DAILY_SAMPLE_SIZE,
  };
  assertPositiveInt(resolved.lookbackTradingDays, "breadth.lookbackTradingDays", 1);
  assertPositiveInt(resolved.minDailySampleSize, "breadth.minDailySampleSize", 1);
  assertFiniteNumber(resolved.broadThreshold, "breadth.broadThreshold");
  assertFiniteNumber(resolved.narrowThreshold, "breadth.narrowThreshold");
  assertOrder(resolved.narrowThreshold, resolved.broadThreshold, "breadth 宽度分档");
  if (resolved.narrowThreshold < 0 || resolved.broadThreshold > 1) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      "marketRegime: 配置 breadth 占比阈值必须落在 [0, 1]",
    );
  }
  return resolved;
}

/** 解析市场情绪配置。 */
export function resolveRegimeSentimentConfig(
  config?: RegimeSentimentConfig,
): ResolvedRegimeSentimentConfig {
  const resolved: ResolvedRegimeSentimentConfig = {
    lookbackTradingDays: config?.lookbackTradingDays ?? REGIME_SENTIMENT_DEFAULT_LOOKBACK,
    riskOnThreshold: config?.riskOnThreshold ?? REGIME_SENTIMENT_DEFAULT_RISK_ON_THRESHOLD,
    riskOffThreshold: config?.riskOffThreshold ?? REGIME_SENTIMENT_DEFAULT_RISK_OFF_THRESHOLD,
    allowSentimentLimitUpProxy:
      config?.allowSentimentLimitUpProxy ?? REGIME_SENTIMENT_DEFAULT_ALLOW_LIMIT_UP_PROXY,
  };
  assertPositiveInt(resolved.lookbackTradingDays, "sentiment.lookbackTradingDays", 1);
  assertFiniteNumber(resolved.riskOnThreshold, "sentiment.riskOnThreshold");
  assertFiniteNumber(resolved.riskOffThreshold, "sentiment.riskOffThreshold");
  if (resolved.riskOnThreshold < 0 || resolved.riskOnThreshold > 1) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 sentiment.riskOnThreshold 必须落在 [0, 1]，实际 ${String(resolved.riskOnThreshold)}`,
    );
  }
  if (resolved.riskOffThreshold < 0 || resolved.riskOffThreshold > 1) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 sentiment.riskOffThreshold 必须落在 [0, 1]，实际 ${String(resolved.riskOffThreshold)}`,
    );
  }
  return resolved;
}

/** 解析指数状态配置。 */
export function resolveRegimeIndexStateConfig(
  config?: RegimeIndexStateConfig,
): ResolvedRegimeIndexStateConfig {
  const resolved: ResolvedRegimeIndexStateConfig = {
    lookbackTradingDays: config?.lookbackTradingDays ?? REGIME_INDEX_STATE_DEFAULT_LOOKBACK,
    bandPct: config?.bandPct ?? REGIME_INDEX_STATE_DEFAULT_BAND_PCT,
  };
  assertPositiveInt(resolved.lookbackTradingDays, "indexState.lookbackTradingDays", 2);
  assertFiniteNumber(resolved.bandPct, "indexState.bandPct");
  if (resolved.bandPct < 0) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 indexState.bandPct 必须 >= 0，实际 ${String(resolved.bandPct)}`,
    );
  }
  return resolved;
}

/** 解析涨停环境配置。 */
export function resolveRegimeLimitUpEnvConfig(
  config?: RegimeLimitUpEnvConfig,
): ResolvedRegimeLimitUpEnvConfig {
  const resolved: ResolvedRegimeLimitUpEnvConfig = {
    lookbackTradingDays: config?.lookbackTradingDays ?? REGIME_LIMIT_UP_ENV_DEFAULT_LOOKBACK,
    hotThresholdPct: config?.hotThresholdPct ?? REGIME_LIMIT_UP_ENV_DEFAULT_HOT_THRESHOLD_PCT,
    coldThresholdPct: config?.coldThresholdPct ?? REGIME_LIMIT_UP_ENV_DEFAULT_COLD_THRESHOLD_PCT,
    minDailySampleSize:
      config?.minDailySampleSize ?? REGIME_LIMIT_UP_ENV_DEFAULT_MIN_DAILY_SAMPLE_SIZE,
  };
  assertPositiveInt(resolved.lookbackTradingDays, "limitUpEnv.lookbackTradingDays", 1);
  assertPositiveInt(resolved.minDailySampleSize, "limitUpEnv.minDailySampleSize", 1);
  assertFiniteNumber(resolved.hotThresholdPct, "limitUpEnv.hotThresholdPct");
  assertFiniteNumber(resolved.coldThresholdPct, "limitUpEnv.coldThresholdPct");
  assertOrder(resolved.coldThresholdPct, resolved.hotThresholdPct, "limitUpEnv 涨停占比分档");
  return resolved;
}

// ---------------------------------------------------------------------------
// 配置集解析
// ---------------------------------------------------------------------------

/** 解析后的默认配置集（冻结；DEFAULT 常量供测试与文档对照）。 */
export const MARKET_REGIME_DEFAULT_CONFIGS: Readonly<ResolvedRegimeConfigSet> = Object.freeze({
  annualizationFactor: MARKET_REGIME_DEFAULT_ANNUALIZATION_FACTOR,
  benchmarkIndexCode: MARKET_REGIME_DEFAULT_BENCHMARK_INDEX_CODE,
  trend: Object.freeze({
    lookbackTradingDays: REGIME_TREND_DEFAULT_LOOKBACK,
    upThresholdPct: REGIME_TREND_DEFAULT_UP_THRESHOLD_PCT,
    downThresholdPct: REGIME_TREND_DEFAULT_DOWN_THRESHOLD_PCT,
  }),
  volatility: Object.freeze({
    lookbackTradingDays: REGIME_VOLATILITY_DEFAULT_LOOKBACK,
    annualizationFactor: MARKET_REGIME_DEFAULT_ANNUALIZATION_FACTOR,
    lowThresholdPct: REGIME_VOLATILITY_DEFAULT_LOW_THRESHOLD_PCT,
    highThresholdPct: REGIME_VOLATILITY_DEFAULT_HIGH_THRESHOLD_PCT,
    minSampleSize: REGIME_VOLATILITY_DEFAULT_MIN_SAMPLE_SIZE,
  }),
  liquidity: Object.freeze({
    lookbackTradingDays: REGIME_LIQUIDITY_DEFAULT_LOOKBACK,
    metric: REGIME_LIQUIDITY_DEFAULT_METRIC,
    highRatio: REGIME_LIQUIDITY_DEFAULT_HIGH_RATIO,
    lowRatio: REGIME_LIQUIDITY_DEFAULT_LOW_RATIO,
  }),
  breadth: Object.freeze({
    lookbackTradingDays: REGIME_BREADTH_DEFAULT_LOOKBACK,
    broadThreshold: REGIME_BREADTH_DEFAULT_BROAD_THRESHOLD,
    narrowThreshold: REGIME_BREADTH_DEFAULT_NARROW_THRESHOLD,
    minDailySampleSize: REGIME_BREADTH_DEFAULT_MIN_DAILY_SAMPLE_SIZE,
  }),
  sentiment: Object.freeze({
    lookbackTradingDays: REGIME_SENTIMENT_DEFAULT_LOOKBACK,
    riskOnThreshold: REGIME_SENTIMENT_DEFAULT_RISK_ON_THRESHOLD,
    riskOffThreshold: REGIME_SENTIMENT_DEFAULT_RISK_OFF_THRESHOLD,
    allowSentimentLimitUpProxy: REGIME_SENTIMENT_DEFAULT_ALLOW_LIMIT_UP_PROXY,
  }),
  indexState: Object.freeze({
    lookbackTradingDays: REGIME_INDEX_STATE_DEFAULT_LOOKBACK,
    bandPct: REGIME_INDEX_STATE_DEFAULT_BAND_PCT,
  }),
  limitUpEnv: Object.freeze({
    lookbackTradingDays: REGIME_LIMIT_UP_ENV_DEFAULT_LOOKBACK,
    hotThresholdPct: REGIME_LIMIT_UP_ENV_DEFAULT_HOT_THRESHOLD_PCT,
    coldThresholdPct: REGIME_LIMIT_UP_ENV_DEFAULT_COLD_THRESHOLD_PCT,
    minDailySampleSize: REGIME_LIMIT_UP_ENV_DEFAULT_MIN_DAILY_SAMPLE_SIZE,
  }),
});

/**
 * 解析完整配置集（缺省补齐 + 非法响亮拒绝）。
 *
 * benchmarkIndexCode 缺省 = 沪深300（000300.SH）。空字符串视为非法（不得用空值
 * 冒充「已指定基准」）。
 */
export function resolveRegimeConfigSet(config?: RegimeConfigSet): ResolvedRegimeConfigSet {
  const annualizationFactor =
    config?.annualizationFactor ?? MARKET_REGIME_DEFAULT_ANNUALIZATION_FACTOR;
  assertFiniteNumber(annualizationFactor, "annualizationFactor");
  if (annualizationFactor <= 0) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      `marketRegime: 配置 annualizationFactor 必须 > 0，实际 ${String(annualizationFactor)}`,
    );
  }
  const benchmarkIndexCode = config?.benchmarkIndexCode ?? MARKET_REGIME_DEFAULT_BENCHMARK_INDEX_CODE;
  if (typeof benchmarkIndexCode !== "string" || benchmarkIndexCode.trim().length === 0) {
    throw new RegimeAnalysisError(
      "REGIME_CONFIG_INVALID",
      "marketRegime: 配置 benchmarkIndexCode 必须是非空字符串（不得用空值冒充已指定基准）",
    );
  }
  return {
    annualizationFactor,
    benchmarkIndexCode,
    trend: resolveRegimeTrendConfig(config?.trend),
    volatility: resolveRegimeVolatilityConfig(config?.volatility, annualizationFactor),
    liquidity: resolveRegimeLiquidityConfig(config?.liquidity),
    breadth: resolveRegimeBreadthConfig(config?.breadth),
    sentiment: resolveRegimeSentimentConfig(config?.sentiment),
    indexState: resolveRegimeIndexStateConfig(config?.indexState),
    limitUpEnv: resolveRegimeLimitUpEnvConfig(config?.limitUpEnv),
  };
}
