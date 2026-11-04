/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Benchmark Calculator**（通用基础之四）。
 *
 * ## 基准的唯一口径
 *
 * ```
 * 基准 = 当日全部符合条件的候选股票（等权）
 * ```
 *
 * 「符合条件的候选股票」= 该决策日**全部可排名样本**（`DayCrossSection.pool`），
 * 与 Top-N 用的是**同一个池**（同一批事件、同一批成本、同一批入场退出）。
 * ⇒ 超额 = 组合 − 池，等价于回答「按这个因子取头部，比当日随机抽 N 个好不好」——
 *   因为**随机抽 N 个的期望恒等于当日池均值**。
 *
 * ⚠️ 基准**不是**指数（沪深 300 / 中证 1000 之类）。本模板不做指数基准：
 *    那需要额外一条指数行情链路，而研究问题是「因子能不能在**同一个池子里**挑出更好的」，
 *    用全市场指数会把「首板事件本身的整体表现」混进来，反而答不出这个问题。
 */

import { equalWeightMean, type PortfolioDayReturn } from "./positionCost";

export const BENCHMARK_DEFINITION =
  "当日全部符合条件的候选股票（= 该决策日全部可排名样本）等权";

export const BENCHMARK_DISCLOSURE =
  "基准为当日候选池等权，同一入场/退出/成本口径；随机抽 N 只的期望恒等于该值，" +
  "因此「正超额」等价于「平均意义上优于随机抽签」，而不是跑赢指数。";

/** 当日基准收益（净口径，等权）。 */
export function benchmarkDayNetReturnOf(
  pool: readonly { netReturn: number }[]
): number | null {
  return equalWeightMean(pool.map(sample => sample.netReturn));
}

/** 当日基准收益（毛口径，等权）——用于把成本拖累从超额里拆出来。 */
export function benchmarkDayGrossReturnOf(
  pool: readonly { grossReturn: number }[]
): number | null {
  return equalWeightMean(pool.map(sample => sample.grossReturn));
}

export type BenchmarkDayReturn = PortfolioDayReturn;
