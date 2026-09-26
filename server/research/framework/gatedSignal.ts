/**
 * 运行工作台 — 「条件门控」信号构造器。
 *
 * ## 为什么需要它（与 `makeWeightedSignalBuilder` 的分工）
 *
 * `framework/signal.ts` 的 `makeWeightedSignalBuilder` 是**线性加权**：`value = Σ wᵢ·fᵢ`，
 * 任何特征缺失即返回 `null`。它表达的语义是「按综合分排序择优」，**不能表达**「必须同时满足
 * 若干硬门槛」——因为线性加权里「守线」失败只是让分数变小，而不是把该证券**剔除**。
 *
 * 而本项目的「守线 + 缩量 + 红盘」是**硬门槛**（AND 语义）：不满足即**不进候选**。
 * 用加权和近似硬门槛是口径错误 —— 它会放行「守线失败但其他特征极高」的证券。
 *
 * ⇒ 本文件提供 `makeGatedSignalBuilder`：逐个条件检查，任一不满足即返回 `null`
 *    （`null` 在 pipeline 里 = 该证券被剔除、不进候选，见 framework 的 `SignalBuilder` 契约）。
 *    全部满足时，信号值 = **排序特征值**（供横截面排序取 topN），direction 由排序值符号决定。
 *
 * ## 纯函数 / 确定性
 *
 * 无 IO、无 `Date.now`、无 `Math.random`；同一输入必得同一输出。
 * 条件求值顺序即数组顺序（短路求值），因此**条件顺序是语义的一部分** —— 调用方需固定顺序。
 */

import type { ResearchSignal } from "./contract";
import type { SignalBuilder } from "./signal";
import { directionFromValue, featureValueOf } from "./signal";

/** 单个门槛条件：作用于**特征值**的谓词（非数值型约束）。 */
export type FeatureGate =
  | { readonly kind: "lte"; readonly featureId: string; readonly bound: number; readonly label: string }
  | { readonly kind: "lt"; readonly featureId: string; readonly bound: number; readonly label: string }
  | { readonly kind: "gte"; readonly featureId: string; readonly bound: number; readonly label: string }
  | { readonly kind: "gt"; readonly featureId: string; readonly bound: number; readonly label: string }
  | { readonly kind: "eq"; readonly featureId: string; readonly bound: number; readonly label: string };

export interface GatedSignalBuilderSpec {
  /**
   * 全部必须满足的门槛（**AND** 语义）。空数组 = 无门槛（退化为「只要排序特征可用即入选」）。
   * ⚠️ 顺序即短路求值顺序，属语义一部分。
   */
  readonly gates: readonly FeatureGate[];
  /**
   * 排序特征 id：门槛全过后，信号值取它的值（横截面排序据此取 topN）。
   * 该特征缺失/非有限 ⇒ 返回 null（不参与）。
   */
  readonly rankFeatureId: string;
}

/**
 * 单条件判定。返回 `null` 表示**无法判定**（特征缺失/非有限）。
 *
 * 为什么要区分 `false` 与 `null`：两者在门控结果上等价（都剔除），但语义不同 ——
 * 「数据不足」与「明确不满足」在审计上必须可辨（否则会把数据缺口误读成策略过滤强度）。
 */
function evaluateGate(gate: FeatureGate, features: Readonly<Record<string, number | null>>): boolean | null {
  const value = featureValueOf(features, gate.featureId);
  if (value === null) return null;
  switch (gate.kind) {
    case "lte":
      return value <= gate.bound;
    case "lt":
      return value < gate.bound;
    case "gte":
      return value >= gate.bound;
    case "gt":
      return value > gate.bound;
    case "eq":
      return value === gate.bound;
  }
}

/**
 * 条件门控信号构造器。
 *
 * 语义：**全部门槛通过** ⇒ 产出信号（value = 排序特征值，direction 由符号决定）；
 * 任一门槛不通过 / 无法判定 ⇒ 返回 `null`（该证券被剔除，不进候选）。
 */
export function makeGatedSignalBuilder(spec: GatedSignalBuilderSpec): SignalBuilder {
  const { gates, rankFeatureId } = spec;
  return ({ securityId, date, features }): ResearchSignal | null => {
    for (const gate of gates) {
      // 条件短路：任一门槛未通过（或无法判定）⇒ 该证券不进候选。
      if (evaluateGate(gate, features) !== true) return null;
    }

    const value = featureValueOf(features, rankFeatureId);
    if (value === null) return null;

    return {
      securityId,
      date,
      value,
      direction: directionFromValue(value),
    };
  };
}
