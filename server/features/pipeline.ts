/**
 * STEP 5 — Feature Pipeline。
 *
 * 数据流（确定性、无副作用、无未来数据）：
 *
 *   Market Data(raw) → visibleBars(asOf 过滤) → MarketBarSeries → per-feature calculate
 *      → FeatureSnapshot
 *
 * 铁律：
 *   - deterministic：不依赖 Date.now / Math.random / 全局状态；
 *   - side-effect free：不修改原始数据、不访问 Portfolio、不创建 Order/Fill、
 *     不访问 DB/Network；
 *   - future-safe：窗口先经 visibleBars 按 decisionDate/point 过滤，未来 bar 不可能进入。
 */

import { MarketBarSeries, visibleBars, type CanonicalMarketBar, type DecisionPoint } from "../data";
import { registerBasicFeatures } from "./basic";
import { featureRegistry } from "./registry";
import type { FeatureAsOf, FeatureSnapshot } from "./snapshot";

/** 一次快照计算请求。 */
export interface RunFeaturePipelineInput {
  symbol: string;
  /** 可选：股票名称（ST 涨停判定需要）。 */
  stockName?: string | null;
  /** 该 symbol 的原始 bar 列表（无序可；按 timestamp 去重/排序由 MarketBarSeries 负责）。 */
  bars: readonly CanonicalMarketBar[];
  /** 决策日（YYYY-MM-DD）。 */
  decisionDate: string;
  /** 决策时点："open" 当日完整 bar 不可见；"close" 当日整根可见。 */
  decisionPoint: DecisionPoint;
  /** 需要计算的 feature 与参数。 */
  features: ReadonlyArray<{ id: string; params?: Record<string, number> }>;
}

/**
 * 执行 feature pipeline，产出绑定统一 asOf 的 FeatureSnapshot。
 * 内部先注册基础特征（幂等）。
 */
export function runFeaturePipeline(input: RunFeaturePipelineInput): FeatureSnapshot {
  registerBasicFeatures(featureRegistry);

  const visible = visibleBars(input.bars, input.decisionDate, input.decisionPoint);
  const series = new MarketBarSeries(input.symbol, visible);

  const asOf: FeatureAsOf = { decisionDate: input.decisionDate, decisionPoint: input.decisionPoint };
  const features: FeatureSnapshot["features"] = {};

  for (const spec of input.features) {
    const factory = featureRegistry.get(spec.id);
    const instance = factory.create(spec.params);
    const result = instance.calculate({ symbol: input.symbol, stockName: input.stockName ?? null, series, decisionDate: input.decisionDate, decisionPoint: input.decisionPoint });
    features[spec.id] = {
      value: result.value,
      status: result.status,
      requiredBars: result.requiredBars,
      availableBars: result.availableBars,
      note: result.note ?? null,
    };
  }

  return { symbol: input.symbol, asOf, features };
}
