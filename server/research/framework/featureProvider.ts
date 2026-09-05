/**
 * STEP 10 — FeatureProvider 构建工具。
 *
 * 提供：
 *   - makeBarFeatureProvider：把「bars 计算函数 + 可用性声明」包装为标准 FeatureProvider；
 *   - sameDayAvailability：便捷构造「同一决策日」的可用性声明（最常见场景）。
 *
 * 特征可用性声明是绝对时点（requiredDataThrough + availableAt），由调用方显式给出；
 * 框架不替调用方猜测「数据到底需要到哪天」，避免静默掩盖未来函数。
 */

import type { CanonicalMarketBar, DecisionPoint } from "../../data";
import type { FeatureComputeInput, FeatureProvider, ResearchSecurityData } from "./contract";
import type { DecisionTime, FeatureAvailability } from "./leakage";

/** bar 型特征描述。 */
export interface BarFeatureSpec {
  readonly featureId: string;
  readonly version: string;
  readonly availability: FeatureAvailability;
  /** 由（已 as-of 过滤的）bars 计算特征值；无法计算返回 null。 */
  readonly compute: (bars: readonly CanonicalMarketBar[], decisionTime: DecisionTime) => number | null;
}

/** 把 bar 型特征包装为 FeatureProvider（默认数据视图 ResearchSecurityData）。 */
export function makeBarFeatureProvider(spec: BarFeatureSpec): FeatureProvider<ResearchSecurityData> {
  return {
    featureId: spec.featureId,
    version: spec.version,
    availability: spec.availability,
    compute(input: FeatureComputeInput<ResearchSecurityData>): number | null {
      return spec.compute(input.data.bars, input.decisionTime);
    },
  };
}

/**
 * 便捷：构造「同一决策日」的可用性声明。
 * requiredDataThrough 与 availableAt 都落在 decisionTime 同一天，仅时点（open/close）不同。
 */
export function sameDayAvailability(decisionTime: DecisionTime, throughPoint: DecisionPoint, availablePoint: DecisionPoint): FeatureAvailability {
  return {
    requiredDataThrough: { date: decisionTime.date, point: throughPoint },
    availableAt: { date: decisionTime.date, point: availablePoint },
  };
}
