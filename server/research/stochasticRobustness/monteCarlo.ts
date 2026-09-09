/**
 * STEP 18 / C-18.2 — Monte Carlo（seeded 重采样，产出分布 + 基准在分布中的位置）。
 *
 * 做什么：
 *   对基准收益序列做 **seeded 有放回重采样**（每次迭代抽 n 个，长度 = 原序列长度），
 *   得到一批「同分布、不同实现」的合成路径 → 统计总收益 / MaxDD / Sharpe 的经验
 *   分布，回答：
 *     - 基准结果落在分布的什么位置（百分位 / 是否在置信区间内 / 是否只是尾部幸运样本）；
 *     - P(收益 < 0)、P(MaxDD > 阈值) 有多大。
 *
 * 不做什么（诚实边界，禁止在报告中省略）：
 *   - **参数扰动型蒙特卡洛（扰动参数后重跑回测）未实现**：需要参数空间采样
 *     （C-17.1 parameterSpace 职责）+ 模拟重跑。本模块保留 `evaluator` 注入口，
 *     调用方传入即可支撑，但本目录不提供参数采样器、不跑回测。
 *   - 不建模自相关 / 波动率聚集（i.i.d. 假设），日收益模式的尾部风险估计偏乐观；
 *     block bootstrap / stationary bootstrap 未实现（unassessed）。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random（随机性来自 seedable PRNG）。
 */

import { generateStochasticResampleSpecimens } from "./sampling";
import type {
  StochasticMonteCarloMode,
  StochasticSourceKind,
  StochasticSpecimen,
} from "./types";
import { STOCHASTIC_METHOD_MONTE_CARLO } from "./types";

/** Monte Carlo 可选重采样对象（与 Bootstrap 的 trade 级口径区分）。 */
export const STOCHASTIC_MONTE_CARLO_MODES: readonly StochasticMonteCarloMode[] = Object.freeze([
  "dailyReturn",
  "tradeReturn",
]);

/**
 * 决定 MC 实际重采样对象：
 *   - 显式指定 monteCarloMode → 用它（对应序列缺失 → 抛错，不静默降级）；
 *   - 未指定 → 给了 dailyReturns 用 dailyReturn，否则 tradeReturn（二者都缺 → 抛错）。
 */
export function resolveStochasticMonteCarloSource(input: {
  readonly monteCarloMode?: StochasticMonteCarloMode;
  readonly dailyReturns?: readonly number[];
  readonly tradeReturns?: readonly number[];
}): { readonly sourceKind: StochasticSourceKind; readonly source: readonly number[] } {
  const hasDaily = Array.isArray(input.dailyReturns) && input.dailyReturns.length > 0;
  const hasTrade = Array.isArray(input.tradeReturns) && input.tradeReturns.length > 0;

  if (input.monteCarloMode === "dailyReturn") {
    if (!hasDaily) {
      throw new Error(
        "resolveStochasticMonteCarloSource: monteCarloMode=dailyReturn 但未提供非空 dailyReturns（拒绝静默降级到 trade 序列）"
      );
    }
    return { sourceKind: "dailyReturn", source: input.dailyReturns! };
  }
  if (input.monteCarloMode === "tradeReturn") {
    if (!hasTrade) {
      throw new Error(
        "resolveStochasticMonteCarloSource: monteCarloMode=tradeReturn 但未提供非空 tradeReturns"
      );
    }
    return { sourceKind: "tradeReturn", source: input.tradeReturns! };
  }
  if (hasDaily) return { sourceKind: "dailyReturn", source: input.dailyReturns! };
  if (hasTrade) return { sourceKind: "tradeReturn", source: input.tradeReturns! };
  throw new Error(
    "resolveStochasticMonteCarloSource: 缺少收益序列（dailyReturns 与 tradeReturns 均未提供的非空序列）"
  );
}

/**
 * 生成 Monte Carlo 样本（有放回重采样；与 Bootstrap 共用抽样核，
 * 差异在口径与结论焦点，见 sampling.ts 头注释）。
 */
export function generateMonteCarloSpecimens(input: {
  readonly seed: number;
  readonly iterations: number;
  readonly source: readonly number[];
  readonly sourceKind: StochasticSourceKind;
  readonly tradeCount: number | null;
}): readonly StochasticSpecimen[] {
  return generateStochasticResampleSpecimens({
    seed: input.seed,
    iterations: input.iterations,
    source: input.source,
    sourceKind: input.sourceKind,
    method: STOCHASTIC_METHOD_MONTE_CARLO,
    tradeCount: input.tradeCount,
  });
}
