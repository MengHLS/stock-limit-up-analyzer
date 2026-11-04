/**
 * STEP 18 / C-18.2 — Bootstrap（trade 级收益有放回重抽样 → 经验分布与置信区间）。
 *
 * 做什么：
 *   对 **trade 级收益**做 seeded 有放回重抽样（B 次，每次抽 n = trade 数个），
 *   产出总收益 / Sharpe / MaxDD 的经验分布与百分位置信区间，并给出
 *   「基准统计量相对随机重排的位置」判定：
 *     - 基准总收益百分位 > 100 − alpha/2×100 → above_resample_distribution；
 *     - 落在 [alpha/2×100, 100 − alpha/2×100] → within_resample_distribution；
 *     - 低于下界 → below_resample_distribution。
 *
 * **描述性判定，不是假设检验承诺**（纪律：不得伪造成果）：
 *   - 百分位 CI 未做 BCa / bootstrap-t 偏差校正；
 *   - 不产出 p 值、不声称「在 5% 水平显著」；
 *   - i.i.d. 重抽样假设 trade 级收益可交换（无仓位重叠 / 无资金约束 / 无市场状态
 *     切换），违反该假设时结论只作描述性参考。
 *
 * 为什么只支持 trade 级（不做日收益 i.i.d. bootstrap）：
 *   日收益序列存在自相关与波动率聚集，i.i.d. bootstrap 会系统性破坏结构、低估
 *   连续回撤风险。正确的日收益重抽样需要 block / stationary bootstrap —— **未实现**，
 *   显式标记 unassessed，由调用方改用 `monteCarlo`（并知悉同一 i.i.d. 警告）。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random。
 */

import { generateStochasticResampleSpecimens } from "./sampling";
import type {
  StochasticBootstrapSignificance,
  StochasticMetricInference,
  StochasticSpecimen,
} from "./types";
import { STOCHASTIC_METHOD_BOOTSTRAP } from "./types";

/**
 * 生成 Bootstrap 样本（trade 级有放回重抽样；与 Monte Carlo 共用抽样核）。
 */
export function generateBootstrapSpecimens(input: {
  readonly seed: number;
  readonly iterations: number;
  readonly tradeReturns: readonly number[];
  readonly tradeCount: number | null;
}): readonly StochasticSpecimen[] {
  return generateStochasticResampleSpecimens({
    seed: input.seed,
    iterations: input.iterations,
    source: input.tradeReturns,
    sourceKind: "tradeReturn",
    method: STOCHASTIC_METHOD_BOOTSTRAP,
    tradeCount: input.tradeCount,
  });
}

/**
 * Bootstrap 描述性显著性判定（不是假设检验；无 p 值语义）。
 * 基准总收益缺失（null）→ descriptiveVerdict="unassessed"。
 */
export function assessStochasticBootstrapSignificance(input: {
  readonly totalReturn: StochasticMetricInference;
  readonly alpha: number;
  readonly baselineTotalReturnPct: number | null;
}): StochasticBootstrapSignificance {
  const { totalReturn, alpha } = input;
  const percentile = totalReturn.baselinePercentile;
  const lowerTail = (alpha / 2) * 100;
  const upperTail = 100 - lowerTail;

  let descriptiveVerdict: StochasticBootstrapSignificance["descriptiveVerdict"];
  if (percentile === null) {
    descriptiveVerdict = "unassessed";
  } else if (percentile > upperTail) {
    descriptiveVerdict = "above_resample_distribution";
  } else if (percentile < lowerTail) {
    descriptiveVerdict = "below_resample_distribution";
  } else {
    descriptiveVerdict = "within_resample_distribution";
  }

  const positiveReturnCiAboveZero = totalReturn.confidenceInterval.lower > 0;
  const note =
    `Bootstrap 描述性判定：基准总收益位于重抽样分布第 ` +
    `${percentile === null ? "N/A" : percentile.toFixed(2)} 百分位（${descriptiveVerdict}）；` +
    `总收益 ${(100 - alpha * 100).toFixed(0)}% 置信区间 [` +
    `${totalReturn.confidenceInterval.lower.toFixed(4)}, ${totalReturn.confidenceInterval.upper.toFixed(4)}]` +
    `${positiveReturnCiAboveZero ? "（下界 > 0）" : "（下界 <= 0，区间跨 0 或为负）"}。` +
    `这是描述性口径，非假设检验承诺：无 p 值、未做 BCa/bootstrap-t 偏差校正，` +
    `且假设 trade 级收益可交换（无仓位重叠/资金约束/状态切换）。`;

  return {
    positiveReturnCiAboveZero,
    baselineTotalReturnPercentile: percentile,
    descriptiveVerdict,
    note,
  };
}
