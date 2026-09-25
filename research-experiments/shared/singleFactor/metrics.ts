/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Metrics Calculator**（通用基础之五）。
 *
 * ## 逐笔指标（等权交易口径）
 *
 * `meanTradeReturn` / `medianTradeReturn` / `winRate` / `profitFactor` /
 * `tradeCount` / `averageHoldingDays`
 *
 * ## 组合指标（净值口径）
 *
 * ```
 * 每个决策日 d：组合净收益 r_d = 当日选中样本净收益的等权平均
 * 净值：E_0 = 1，E_{d} = E_{d−1} × (1 + r_d)     ← 决策日顺序，不做资金管理等
 * totalReturn     = E_last − 1
 * maxDrawdown     = min_d (E_d / peak_{≤d} − 1)  （**≤ 0**）
 * benchmarkReturn = 同一构造施加在当日池上
 * excessReturn    = totalReturn − benchmarkReturn
 * costDrag        = grossTotalReturn − totalReturn
 * ```
 *
 * ⚠️ **为什么复利而不是简单相加**：决策日之间不可累加（持有期重叠、日数上千），
 *    简单相加会得到「+300%」这类没有资金含义的数字。复利构造给出一条可解释的净值曲线，
 *    也正是 `maxDrawdown` 唯一能被定义出来的地方。
 *
 * ## 显著性
 *
 * 主判据 = **配对日度超额**（`r_d − b_d`，同一天、同一批成本、同一批事件）的
 * 日期聚类 Moving-Block Bootstrap 95% 区间（复用 `shared/dateClusterBootstrap.ts`）。
 * 判定阈值与 12F / Top-N 一致：日数 < 100 ⇒ `INSUFFICIENT`。
 */

import {
  movingBlockBootstrapMean,
  type DateClusterValue,
} from "../dateClusterBootstrap";
import { ROUND_TRIP_COST_BPS, SLIPPAGE_BPS_PER_SIDE } from "./coordinate";
import type { SingleFactorMetrics, SingleFactorVerdict, SingleFactorSample, SingleFactorTrade } from "./types";

/** 判定所需的最少**决策日**数（与 12F / Top-N 同阈值）。 */
export const MIN_DECISION_DAY_COUNT = 100;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;

export function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** 分位数（线性插值）；调用方保证 `sorted` 升序。 */
export function quantileOf(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function medianOf(values: readonly number[]): number | null {
  return quantileOf([...values].sort((left, right) => left - right), 0.5);
}

/** 复利累计：`Π(1 + r) − 1`。空集返回 `null`。 */
export function compoundOf(returns: readonly number[]): number | null {
  if (returns.length === 0) return null;
  let equity = 1;
  for (const value of returns) equity *= 1 + value;
  return equity - 1;
}

/** 净值曲线的最大回撤（**≤ 0**）。空集返回 `null`。 */
export function maxDrawdownOf(returns: readonly number[]): number | null {
  if (returns.length === 0) return null;
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity / peak - 1);
  }
  return worst;
}

export function winRateOf(netReturns: readonly number[]): number | null {
  if (netReturns.length === 0) return null;
  const wins = netReturns.filter(value => value > 0).length;
  return wins / netReturns.length;
}

/**
 * 盈亏比 = Σ正 ÷ |Σ负|。
 *
 * 无亏损交易时返回 `null`（**不写 Infinity**）：`null` 表示「分母不存在」，
 * 而 Infinity 会被页面渲染成一个看起来像结论的数字。
 */
export function profitFactorOf(netReturns: readonly number[]): number | null {
  if (netReturns.length === 0) return null;
  let positive = 0;
  let negative = 0;
  for (const value of netReturns) {
    if (value > 0) positive += value;
    else negative += -value;
  }
  if (negative === 0) return null;
  return positive / negative;
}

/** 三态判定（日数门槛把关）。 */
export function verdictOf(args: {
  dayCount: number;
  ciLow: number | null;
  ciHigh: number | null;
}): SingleFactorVerdict {
  if (args.dayCount < MIN_DECISION_DAY_COUNT) return "INSUFFICIENT";
  if (args.ciLow === null || args.ciHigh === null) return "INSUFFICIENT";
  if (args.ciLow > 0) return "POSITIVE";
  if (args.ciHigh < 0) return "NEGATIVE";
  return "INCONCLUSIVE";
}

export function bootstrapOf(
  values: readonly DateClusterValue[],
  seed: number
): { low: number; high: number; clusterCount: number } | null {
  const result = movingBlockBootstrapMean({
    samples: values,
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_DAYS,
    seed,
  });
  if (result === null) return null;
  return {
    low: result.low,
    high: result.high,
    clusterCount: result.clusterCount,
  };
}

export interface MetricsInput {
  trades: readonly SingleFactorTrade[];
  /** 决策日 → 组合等权**毛**收益（升序）。 */
  grossDaily: readonly DateClusterValue[];
  /** 决策日 → 组合等权**净**收益（升序）。 */
  netDaily: readonly DateClusterValue[];
  /** 决策日 → 当日池等权**净**收益（升序，与 `netDaily` 同日历）。 */
  benchmarkDaily: readonly DateClusterValue[];
}

export interface ComboMetricsResult {
  metrics: SingleFactorMetrics;
  /** 配对日度超额（净，`组合 − 池`）。 */
  excessDaily: readonly DateClusterValue[];
}

/**
 * 核心指标。
 *
 * 🔴 `grossDaily` / `netDaily` / `benchmarkDaily` 必须**逐日对齐**（同一天同一条）：
 *    「超额」是**配对**量，错了日历就会把不同天的东西相减。
 */
export function computeMetrics(input: MetricsInput): ComboMetricsResult {
  const netReturns = input.trades.map(trade => trade.netReturn);
  const grossTotal = compoundOf(input.grossDaily.map(point => point.value));
  const netTotal = compoundOf(input.netDaily.map(point => point.value));
  const benchmarkTotal = compoundOf(input.benchmarkDaily.map(point => point.value));

  const benchmarkByDate = new Map(
    input.benchmarkDaily.map(point => [point.eventDate, point.value])
  );
  const excessDaily: DateClusterValue[] = [];
  for (const point of input.netDaily) {
    const benchmark = benchmarkByDate.get(point.eventDate);
    if (benchmark === undefined) continue;
    excessDaily.push({ eventDate: point.eventDate, value: point.value - benchmark });
  }

  const metrics: SingleFactorMetrics = {
    totalReturn: netTotal === null ? null : round(netTotal, 10),
    grossTotalReturn: grossTotal === null ? null : round(grossTotal, 10),
    meanTradeReturn: meanOf(netReturns) === null ? null : round(meanOf(netReturns)!, 10),
    medianTradeReturn:
      medianOf(netReturns) === null ? null : round(medianOf(netReturns)!, 10),
    winRate: winRateOf(netReturns) === null ? null : round(winRateOf(netReturns)!, 10),
    profitFactor:
      profitFactorOf(netReturns) === null ? null : round(profitFactorOf(netReturns)!, 10),
    maxDrawdown:
      maxDrawdownOf(input.netDaily.map(point => point.value)) === null
        ? null
        : round(maxDrawdownOf(input.netDaily.map(point => point.value))!, 10),
    tradeCount: input.trades.length,
    benchmarkReturn: benchmarkTotal === null ? null : round(benchmarkTotal, 10),
    excessReturn:
      netTotal === null || benchmarkTotal === null
        ? null
        : round(netTotal - benchmarkTotal, 10),
    averageHoldingDays:
      meanOf(input.trades.map(trade => trade.holdingDays)) === null
        ? null
        : round(meanOf(input.trades.map(trade => trade.holdingDays))!, 10),
    costBps: ROUND_TRIP_COST_BPS,
    slippageBpsPerSide: SLIPPAGE_BPS_PER_SIDE,
    costDrag:
      grossTotal === null || netTotal === null ? null : round(grossTotal - netTotal, 10),
  };

  return { metrics, excessDaily };
}

/** 组合成员 → 当日等权组合收益（毛/净）。 */
export function dailyPortfolioReturnsOf(
  members: readonly SingleFactorSample[]
): { gross: number | null; net: number | null } {
  if (members.length === 0) return { gross: null, net: null };
  let gross = 0;
  let net = 0;
  for (const member of members) {
    gross += member.grossReturn;
    net += member.netReturn;
  }
  return { gross: gross / members.length, net: net / members.length };
}
