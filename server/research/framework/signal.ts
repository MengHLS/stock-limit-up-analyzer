/**
 * STEP 10 — Signal 构造。
 *
 * Signal 至少：securityId / date / value / direction / confidence（confidence 可选/可空）。
 * 框架不强制策略必须输出 confidence；SignalBuilder 是纯函数、确定性。
 */

import type { CanonicalMarketBar, DecisionPoint } from "../../data";
import type { Direction, ResearchSignal } from "./contract";

/** SignalBuilder 输入。 */
export interface SignalBuilderInput {
  readonly securityId: string;
  readonly date: string;
  readonly features: Readonly<Record<string, number | null>>;
  /**
   * 本次决策的**已 as-of 过滤** bar 序列（升序）。
   *
   * 加它的理由（STRATEGY-ARCH-002）：Strategy Core 的判定需要读 `bar.*` /
   * `prefix.rd{n}.*` 这类**原始行情字段**，而 `features` 只是标量投影、还原不出字段。
   * 只把 `features` 给构造器 ⇒ Core 只能靠「猜一个同名特征」，那是第二套口径。
   *
   * 兼容性：**可选**。既有构造器（`makeWeightedSignalBuilder` / `makeGatedSignalBuilder`）
   * 不读它，行为逐字不变。
   */
  readonly bars?: readonly CanonicalMarketBar[];
  /** 决策时点（`close` / `open`）。缺省 = 框架不告诉构造器，构造器自决。 */
  readonly point?: DecisionPoint;
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
 * 取特征值的**有限值**（不存在 / `null` / 非有限 ⇒ `null`）。
 *
 * **唯一实现**：本条取值规则有三个消费者——`makeWeightedSignalBuilder`（信号值）、
 * `makeGatedSignalBuilder`（排序特征值）、以及 `recipeRegistry` 下发给 Core 的
 * `rankValueOf`（排序值）。若各写一份「三连判断」，任一处漏掉
 * `Number.isFinite` 都会让 `NaN` 通过；而 `NaN` 混进横截面排序会静默污染 `rank`
 * 次序（`NaN` 的比较恒为 false，排到哪里取决于实现），而这种漂移在结果里
 * 完全不可见。
 */
export function featureValueOf(
  features: Readonly<Record<string, number | null>>,
  featureId: string,
): number | null {
  const value = features[featureId];
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  return value;
}

/**
 * 线性加权值 `Σ wᵢ·fᵢ`；任一权重特征不可用 ⇒ `null`（禁止静默填零）。
 *
 * 🔴 这是加权语义的**唯一实现**：`makeWeightedSignalBuilder`（信号值）与
 * `recipeRegistry` 下发的 `rankValueOf`（Core 的排序值）**共用它**。若两处各写一遍，
 * 信号值与排序值就有漂移的可能 —— 而 Core 的判据是「`rankValue` 非空才发信号」
 * ⇒ 漂移会表现为「出了信号但排序取不到值」，症状是**静默少选**，不是报错。
 */
export function weightedValueOf(
  weights: Readonly<Record<string, number>>,
  features: Readonly<Record<string, number | null>>,
): number | null {
  let value = 0;
  for (const [featureId, weight] of Object.entries(weights)) {
    const featureValue = featureValueOf(features, featureId);
    if (featureValue === null) return null;
    value += weight * featureValue;
  }
  return Number.isFinite(value) ? value : null;
}

/**
 * 加权线性信号构造器：value = Σ w_i · f_i。
 * 任一权重特征缺失/非有限 → 返回 null（该证券不参与，禁止静默填零）。
 */
export function makeWeightedSignalBuilder(weights: Readonly<Record<string, number>>): SignalBuilder {
  return ({ securityId, date, features }) => {
    const value = weightedValueOf(weights, features);
    if (value === null) return null;
    return { securityId, date, value, direction: directionFromValue(value) };
  };
}
