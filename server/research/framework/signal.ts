/**
 * STEP 10 — Signal 构造。
 *
 * Signal 至少：securityId / date / value / direction / confidence（confidence 可选/可空）。
 * 框架不强制策略必须输出 confidence；SignalBuilder 是纯函数、确定性。
 */

import type { Direction, ResearchSignal } from "./contract";

/** SignalBuilder 输入。 */
export interface SignalBuilderInput {
  readonly securityId: string;
  readonly date: string;
  readonly features: Readonly<Record<string, number | null>>;
}

/** 由特征值产生研究信号；返回 null 表示该证券因特征不足被剔除（由 pipeline 记录）。 */
export type SignalBuilder = (input: SignalBuilderInput) => ResearchSignal | null;

/** 由符号/值推断方向（>0 long / <0 short / =0 neutral）。 */
export function directionFromValue(value: number): Direction {
  if (value > 0) return "long";
  if (value < 0) return "short";
  return "neutral";
}

/**
 * 加权线性信号构造器：value = Σ w_i · f_i。
 * 任一权重特征缺失/非有限 → 返回 null（该证券不参与，禁止静默填零）。
 */
export function makeWeightedSignalBuilder(weights: Readonly<Record<string, number>>): SignalBuilder {
  const entries = Object.entries(weights);
  return ({ securityId, date, features }) => {
    let value = 0;
    for (const [featureId, weight] of entries) {
      const featureValue = features[featureId];
      if (featureValue === undefined || featureValue === null || !Number.isFinite(featureValue)) {
        return null;
      }
      value += weight * featureValue;
    }
    if (!Number.isFinite(value)) return null;
    return { securityId, date, value, direction: directionFromValue(value) };
  };
}
