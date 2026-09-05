/**
 * STEP 5 — 基础特征库（Basic Features）。
 *
 * 范围说明：仅实现「项目真实使用或审计明确要求」的基础指标，不为数量而造因子。
 *   - return1d / returnNd、avgAmountNd、amplitude1d：对应 legacy 溢价研究与
 *     technicalFactors 量比/振幅的底层基础口径（详见 development report）。
 *   - smaNd / avgVolumeNd / volatilityNd：通用时间序列基础，供审计要求覆盖
 *     （future-leakage / warm-up 破坏性测试）。
 *   - limitUpHit：涨停规则统一（boardRules 权威 + engine execution 价格纯函数）。
 *
 * 统计函数一律复用 shared/quant-stats，Feature 层禁止重新实现 mean/std。
 * 所有计算要求窗口内字段值完整（null 即 INVALID_DATA），不足即 INSUFFICIENT_DATA，
 * 绝不静默补零或用未来数据补足。
 */

import { mean, sampleStandardDeviation } from "../../shared/quant-stats";
import { isLimitUpBar } from "../data/boardRules";
import type { CanonicalMarketBar } from "../data/types";
import type { FeatureContext, FeatureFactory, FeatureInstance, FeatureMetadata, FeatureParams, FeatureResult } from "./contract";

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

type FieldName = "open" | "high" | "low" | "close" | "preClose" | "volume" | "amount";

function fieldOf(bar: CanonicalMarketBar, field: FieldName): number | null {
  return bar[field];
}

/** 解析正整数参数（period 等）；非法回落 default。 */
function toPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored >= 1 ? floored : fallback;
}

/** 构造结果。 */
function ready(value: number, requiredBars: number, availableBars: number): FeatureResult {
  return { value, status: "READY", requiredBars, availableBars };
}
function insufficient(requiredBars: number, availableBars: number): FeatureResult {
  return { value: null, status: "INSUFFICIENT_DATA", requiredBars, availableBars, note: `可用 bar ${availableBars} < 需要 ${requiredBars}` };
}
function invalid(requiredBars: number, availableBars: number, note: string): FeatureResult {
  return { value: null, status: "INVALID_DATA", requiredBars, availableBars, note };
}

/** 取最近 count 根 bar 的指定字段值；任一 null → 返回 null（无法静默使用）。 */
function lastFieldValues(series: FeatureContext["series"], count: number, field: FieldName): number[] | null {
  const bars = series.window(count);
  if (bars.length < count) return null;
  const values: number[] = [];
  for (const bar of bars) {
    const value = fieldOf(bar, field);
    if (value === null || !Number.isFinite(value)) return null;
    values.push(value);
  }
  return values;
}

/** 通用「窗口均值」feature（SMA / avgAmount / avgVolume）。 */
function makeWindowMeanFeature(
  metadata: FeatureMetadata,
  field: FieldName,
  periodDefault: number,
  requiredBarsDelta = 0, // 若为 1：需要 period+1 根（例如收益序列前移）
  compute?: (values: number[], period: number) => number | null,
): FeatureFactory {
  const requiredBarsOf = (period: number) => period + requiredBarsDelta;
  return {
    metadata,
    defaultParams: { period: periodDefault } as FeatureParams,
    create(rawParams?: Partial<FeatureParams>): FeatureInstance {
      const period = toPositiveInt(rawParams?.period, periodDefault);
      const requiredBars = requiredBarsOf(period);
      return {
        metadata,
        params: { period },
        requiredBars,
        calculate(ctx: FeatureContext): FeatureResult {
          if (ctx.series.length < requiredBars) return insufficient(requiredBars, ctx.series.length);
          const values = lastFieldValues(ctx.series, requiredBars, field);
          if (values === null) return invalid(requiredBars, ctx.series.length, `${field} 字段缺失，无法计算 ${metadata.id}`);
          if (compute) {
            const computed = compute(values, period);
            return computed === null ? invalid(requiredBars, ctx.series.length, `${field} 数据不足以保证统计有效`) : ready(computed, requiredBars, ctx.series.length);
          }
          const avg = mean(values);
          return avg === null ? invalid(requiredBars, ctx.series.length, `${field} 无可计算均值`) : ready(avg, requiredBars, ctx.series.length);
        },
      };
    },
  };
}

/** 序列收益辅助：由收盘价序列计算日收益序列（内部无 Math.random / Date 依赖）。 */
function dailySimpleReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const prev = closes[index - 1]!;
    if (prev <= 0) continue;
    returns.push(closes[index]! / prev - 1);
  }
  return returns;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/** N 日简单移动平均（closes）。 */
export function smaFeatureFactory(periodDefault = 20): FeatureFactory {
  return makeWindowMeanFeature(
    { id: "sma", version: "1.0.0", description: "N 日简单移动平均（收盘价，元/股）。", inputFields: ["close"], availability: "close" },
    "close",
    periodDefault,
  );
}

/** N 日累计简单收益：close[T] / close[T−N] − 1。需要 N+1 根收盘价。 */
export function returnNFeatureFactory(periodDefault = 5): FeatureFactory {
  return makeWindowMeanFeature(
    { id: "return", version: "1.0.0", description: "N 日简单收益（收盘价序列，小数）。", inputFields: ["close"], availability: "close" },
    "close",
    periodDefault,
    1,
    (values) => {
      const period = values.length - 1;
      if (period <= 0) return null;
      const base = values[0]!;
      if (base <= 0) return null;
      return values[period]! / base - 1;
    },
  );
}

/** N 日平均成交额（amount，千元）。 */
export function avgAmountFeatureFactory(periodDefault = 20): FeatureFactory {
  return makeWindowMeanFeature(
    { id: "avgAmount", version: "1.0.0", description: "N 日平均成交额（amount，千元）。", inputFields: ["amount"], availability: "close" },
    "amount",
    periodDefault,
  );
}

/** N 日平均成交量（volume，手）。 */
export function avgVolumeFeatureFactory(periodDefault = 20): FeatureFactory {
  return makeWindowMeanFeature(
    { id: "avgVolume", version: "1.0.0", description: "N 日平均成交量（volume，手）。", inputFields: ["volume"], availability: "close" },
    "volume",
    periodDefault,
  );
}

/** N 日收益波动率（日收益样本标准差，未年化）。需要 N+1 根收盘价，且窗口内收益数 >= 2。 */
export function volatilityFeatureFactory(periodDefault = 20): FeatureFactory {
  const metadata: FeatureMetadata = {
    id: "volatility",
    version: "1.0.0",
    description: "滚动日收益样本标准差（近 N 个日收益，未年化，小数）。",
    inputFields: ["close"],
    availability: "close",
  };
  return {
    metadata,
    defaultParams: { period: periodDefault } as FeatureParams,
    create(rawParams?: Partial<FeatureParams>): FeatureInstance {
      const period = toPositiveInt(rawParams?.period, periodDefault);
      const requiredBars = period + 1; // N 个收益需要 N+1 根收盘价
      return {
        metadata,
        params: { period },
        requiredBars,
        calculate(ctx: FeatureContext): FeatureResult {
          if (ctx.series.length < requiredBars) return insufficient(requiredBars, ctx.series.length);
          const closes = lastFieldValues(ctx.series, requiredBars, "close");
          if (closes === null) return invalid(requiredBars, ctx.series.length, "close 字段缺失，无法计算 volatility");
          const returns = dailySimpleReturns(closes);
          if (returns.length < 2) return invalid(requiredBars, ctx.series.length, "收益样本不足 2 个");
          const std = sampleStandardDeviation(returns);
          return std === null ? invalid(requiredBars, ctx.series.length, "波动率不可计算") : ready(std, requiredBars, ctx.series.length);
        },
      };
    },
  };
}

/** 当日振幅：(high − low) / preClose × 100（%），与 legacy technicalFactors.amplitude 同口径。 */
export function amplitudeFeatureFactory(): FeatureFactory {
  const metadata: FeatureMetadata = {
    id: "amplitude",
    version: "1.0.0",
    description: "当日振幅 (high−low)/preClose×100（%）。需当日收盘后可见的 high/low/preClose。",
    inputFields: ["high", "low", "preClose"],
    availability: "close",
  };
  return {
    metadata,
    defaultParams: {},
    create(): FeatureInstance {
      const requiredBars = 1;
      return {
        metadata,
        params: {},
        requiredBars,
        calculate(ctx: FeatureContext): FeatureResult {
          if (ctx.series.length < requiredBars) return insufficient(requiredBars, ctx.series.length);
          const bar = ctx.series.current();
          if (!bar) return insufficient(requiredBars, ctx.series.length);
          const { high, low, preClose } = bar;
          if (high === null || low === null || preClose === null) return invalid(requiredBars, ctx.series.length, "high/low/preClose 缺失");
          if (high <= 0 || low <= 0 || preClose <= 0) return invalid(requiredBars, ctx.series.length, "high/low/preClose 非正");
          return ready(((high - low) / preClose) * 100, requiredBars, ctx.series.length);
        },
      };
    },
  };
}

/** 涨停命中：最近一根完整可见 bar 的收盘价是否触及涨停价（按板块规则），是=1 否=0；不可判定=null。 */
export function limitUpHitFeatureFactory(): FeatureFactory {
  const metadata: FeatureMetadata = {
    id: "limitUpHit",
    version: "1.0.0",
    description: "最近可见完整 bar 是否收盘涨停（按板块规则与复权前收判定；ST 需 stockName）。是=1/否=0/无法判定=null。",
    inputFields: ["close", "preClose"],
    availability: "close",
  };
  return {
    metadata,
    defaultParams: {},
    create(): FeatureInstance {
      const requiredBars = 1;
      return {
        metadata,
        params: {},
        requiredBars,
        calculate(ctx: FeatureContext): FeatureResult {
          if (ctx.series.length < requiredBars) return insufficient(requiredBars, ctx.series.length);
          const bar = ctx.series.current();
          if (!bar) return insufficient(requiredBars, ctx.series.length);
          const hit = isLimitUpBar(bar, ctx.stockName);
          if (hit === null) return invalid(requiredBars, ctx.series.length, "涨停规则不可判定或缺少 close/preClose");
          return ready(hit ? 1 : 0, requiredBars, ctx.series.length);
        },
      };
    },
  };
}

/**
 * 注册基础特征到 registry（幂等：已注册的跳过）。
 * 不保存任何可变状态；依赖 registry.has 判重。
 */
export function registerBasicFeatures(registry: { has(id: string): boolean; register(factory: FeatureFactory): void }): void {
  const factories: FeatureFactory[] = [
    smaFeatureFactory(),
    returnNFeatureFactory(),
    avgAmountFeatureFactory(),
    avgVolumeFeatureFactory(),
    volatilityFeatureFactory(),
    amplitudeFeatureFactory(),
    limitUpHitFeatureFactory(),
  ];
  for (const factory of factories) {
    if (!registry.has(factory.metadata.id)) registry.register(factory);
  }
}
