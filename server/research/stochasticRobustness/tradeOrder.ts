/**
 * STEP 18 / C-18.2 — Trade Order Randomization（成交顺序随机化：路径依赖 vs 集合依赖）。
 *
 * 做什么：
 *   在**保持交易集合不变**的前提下（无放回置换，seed 驱动 Fisher–Yates），随机化
 *   trade 级收益的成交顺序，逐条重算路径统计，检验结果对「执行顺序」的依赖程度：
 *     - **总收益对顺序数学不变**（Π(1 + r) 满足乘法交换律）→ 集合依赖量；
 *     - **最大回撤 / Sharpe 依赖顺序** → 路径依赖量。
 *   因此本方法的判读重点是「回撤与风险指标的排序敏感性」，而不是收益。
 *
 * 不变性守卫（hand-checkable，测试锁定）：
 *   由于 IEEE-754 乘法不满足结合律，复利结果在不同顺序下可能有 ULP 级差异，
 *   故不变性用容差判定（`STOCHASTIC_ORDER_INVARIANCE_TOLERANCE_PCT`，默认 1e-6 个百分点）。
 *   若实测 spread 超过容差 → 说明路径重建口径被破坏（例如 evaluator 未按纯复利实现），
 *   断言响亮失败，绝不静默。
 *
 * 不做什么（诚实边界）：
 *   路径由 trade 级收益按给定顺序复利重建，不含现金、并发持仓与资金约束；
 *   真实并发持仓的顺序依赖需调用方注入 `evaluator` 重跑模拟（本目录不跑回测）。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random。
 */

import { generateStochasticPermutationSpecimens } from "./sampling";
import type { StochasticMetricsView, StochasticSpecimen } from "./types";
import { STOCHASTIC_METHOD_ORDER_RANDOMIZATION } from "./types";

/** 总收益顺序不变性容差（百分点；仅用于吸收浮点乘法结合的 ULP 误差）。 */
export const STOCHASTIC_ORDER_INVARIANCE_TOLERANCE_PCT = 1e-6;

/**
 * 生成成交顺序随机化样本（无放回置换，交易集合不变）。
 */
export function generateTradeOrderSpecimens(input: {
  readonly seed: number;
  readonly iterations: number;
  readonly tradeReturns: readonly number[];
  readonly tradeCount: number | null;
}): readonly StochasticSpecimen[] {
  return generateStochasticPermutationSpecimens({
    seed: input.seed,
    iterations: input.iterations,
    source: input.tradeReturns,
    sourceKind: "tradeReturn",
    method: STOCHASTIC_METHOD_ORDER_RANDOMIZATION,
    tradeCount: input.tradeCount,
  });
}

/** 总收益跨顺序的极差（百分点）。 */
export interface StochasticTotalReturnSpread {
  readonly minPct: number | null;
  readonly maxPct: number | null;
  readonly spreadPct: number | null;
}

/**
 * 统计一组顺序随机化样本的总收益极差（用于集合依赖不变性守卫）。
 * 无成功样本 → 全 null（不伪造 0）。
 */
export function computeStochasticTotalReturnSpreadPct(
  metrics: readonly StochasticMetricsView[]
): StochasticTotalReturnSpread {
  const values = metrics
    .map((item) => item.totalReturnPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return { minPct: null, maxPct: null, spreadPct: null };
  }
  let min = values[0]!;
  let max = values[0]!;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { minPct: min, maxPct: max, spreadPct: max - min };
}

/**
 * 断言「总收益对成交顺序不变」（集合依赖不变量）。
 * 超出容差 → 抛错（路径重建口径被破坏，禁止静默）。
 */
export function assertStochasticOrderTotalReturnInvariant(
  metrics: readonly StochasticMetricsView[],
  tolerancePct: number = STOCHASTIC_ORDER_INVARIANCE_TOLERANCE_PCT
): void {
  const spread = computeStochasticTotalReturnSpreadPct(metrics);
  if (spread.spreadPct === null) {
    throw new Error(
      "assertStochasticOrderTotalReturnInvariant: 无成功样本，无法校验顺序不变性（拒绝静默通过）"
    );
  }
  if (spread.spreadPct > tolerancePct) {
    throw new Error(
      `assertStochasticOrderTotalReturnInvariant: 总收益跨顺序极差 ${spread.spreadPct}pp ` +
        `超过容差 ${tolerancePct}pp（顺序不变性被破坏：路径重建口径与「集合不变」语义不符）`
    );
  }
}
