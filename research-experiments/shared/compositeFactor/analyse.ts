/**
 * COMPOSITE_FACTOR_EXPERIMENT_V1 —— **评估层**（把合成分交给单因子引擎的交易/统计基础能力）。
 *
 * 本文件**不实现**任何交易、成本、基准、指标或显著性逻辑 —— 它们全部来自
 * `shared/singleFactor/**`：
 *
 * | 做的事 | 复用的能力 |
 * | --- | --- |
 * | 按决策日切横截面 + 取前 N | `singleFactor/ranker.ts`（`buildCrossSections` / `selectTopN`） |
 * | 当日等权组合收益 | `singleFactor/metrics.ts`（`dailyPortfolioReturnsOf`） |
 * | 当日池等权基准 | `singleFactor/benchmark.ts`（`benchmarkDayNetReturnOf`） |
 * | 复利净值 / 回撤 / 盈亏比 / 胜率 / 配对日度超额 | `singleFactor/metrics.ts`（`computeMetrics`） |
 * | 日期聚类 Moving-Block Bootstrap + 三态判定 | `singleFactor/metrics.ts`（`bootstrapOf` / `verdictOf`） |
 * | 逐笔成本恒等式 | `singleFactor/positionCost.ts`（`assertTradeCostReconciles`） |
 *
 * 本文件只新增三件组合模板独有的事：
 * ① 把「合成分」当作排序键交给 `ranker`（没有任何新排序逻辑）；
 * ② 按 `OWN` / `FIXED` 两种日集口径跑 4 档 TopN；
 * ③ 时间切片（按年）与随机 N 的 Monte-Carlo 分布（后者用于回答「这点优势是不是抽签运气」）。
 */

import type { DateClusterValue } from "../dateClusterBootstrap";
import { benchmarkDayNetReturnOf } from "../singleFactor/benchmark";
import {
  bootstrapOf,
  computeMetrics,
  dailyPortfolioReturnsOf,
  quantileOf,
  round,
  verdictOf,
  type ComboMetricsResult,
} from "../singleFactor/metrics";
import { assertTradeCostReconciles } from "../singleFactor/positionCost";
import {
  buildCrossSections,
  selectTopN,
  type DayCrossSection,
} from "../singleFactor/ranker";
import type {
  SingleFactorComboResult,
  SingleFactorMetrics,
  SingleFactorSample,
  SingleFactorTrade,
} from "../singleFactor/types";
import { compositeBootstrapSeed } from "./hash";
import {
  COMPOSITE_FACTOR_CONTRACT_ID,
  type CompositeBenchmarkRow,
  type CompositeCombo,
  type CompositeComboRow,
  type CompositeDayDiagnostics,
  type CompositeDayScope,
  type CompositeExcessRow,
  type CompositeOverallSummary,
  type CompositeTimeSliceRow,
} from "./types";

/** 随机 N 基准的模拟次数与基数种子（与既有 Top-N 实验同量级）。 */
export const RANDOM_SIMULATIONS = 1_000;
export const RANDOM_SEED_BASE = 20_260_927;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function meanOfValues(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function meanOfSeries(series: readonly DateClusterValue[]): number | null {
  const value = meanOfValues(series.map(point => point.value));
  return value === null ? null : round(value, 10);
}

function tradeOf(
  sample: SingleFactorSample,
  rank: number,
  poolSize: number
): SingleFactorTrade {
  const trade: SingleFactorTrade = {
    stockCode: sample.stockCode,
    eventId: sample.eventId,
    factorValue: sample.factorValue,
    rank,
    poolSize,
    signalDate: sample.signalDate,
    entryDate: sample.entryDate,
    entryPrice: sample.entryPrice,
    exitDate: sample.exitDate,
    exitPrice: sample.exitPrice,
    exitRelativeDay: sample.exitRelativeDay,
    holdingDays: sample.holdingDays,
    grossReturn: sample.grossReturn,
    cost: sample.cost,
    costBps: sample.costBps,
    netReturn: sample.netReturn,
  };
  // 逐笔成本恒等式（gross − cost === net）在这里强制 ⇒ 成本口径一旦漂移，Run 立刻失败。
  assertTradeCostReconciles(trade);
  return trade;
}

export interface ComboEvaluation {
  readonly comboId: string;
  readonly size: CompositeCombo["size"];
  readonly sizeLabel: string;
  readonly scope: CompositeDayScope;
  /** 单因子档位结果（`direction` 恒为 HIGH —— 方向已进入成员的贡献）。 */
  readonly result: SingleFactorComboResult;
  readonly portfolioMean: number | null;
  readonly benchmarkMean: number | null;
  readonly excessMean: number | null;
  /** 该档的组合 / 基准 / 超额日收益序列（供时间切片与 CSV 产物）。 */
  readonly netDaily: readonly DateClusterValue[];
  readonly grossDaily: readonly DateClusterValue[];
  readonly benchmarkDaily: readonly DateClusterValue[];
  readonly excessDaily: readonly DateClusterValue[];
}

function evaluateCombo(args: {
  sections: readonly DayCrossSection[];
  comboId: string;
  size: CompositeCombo["size"];
  sizeLabel: string;
  scope: CompositeDayScope;
  /** 纳入门槛：当日可用样本 ≥ 该值。 */
  minDaySize: number;
  seedKey: string;
}): ComboEvaluation {
  const trades: SingleFactorTrade[] = [];
  const netDaily: DateClusterValue[] = [];
  const grossDaily: DateClusterValue[] = [];
  const benchmarkDaily: DateClusterValue[] = [];
  let daysExcludedSmall = 0;

  for (const section of args.sections) {
    if (section.pool.length < args.minDaySize) {
      daysExcludedSmall += 1;
      continue;
    }
    const selection = selectTopN(section, args.size);
    if (!selection.included) {
      daysExcludedSmall += 1;
      continue;
    }
    const members = selection.picks.map(pick => pick.sample);
    const portfolio = dailyPortfolioReturnsOf(members);
    const benchmarkNet = benchmarkDayNetReturnOf(section.pool);
    if (portfolio.net === null || benchmarkNet === null) {
      daysExcludedSmall += 1;
      continue;
    }
    for (const pick of selection.picks) {
      trades.push(tradeOf(pick.sample, pick.rank, section.pool.length));
    }
    netDaily.push({ eventDate: section.date, value: portfolio.net });
    grossDaily.push({
      eventDate: section.date,
      value: portfolio.gross ?? portfolio.net,
    });
    benchmarkDaily.push({ eventDate: section.date, value: benchmarkNet });
  }

  const metricsResult: ComboMetricsResult = computeMetrics({
    trades,
    grossDaily,
    netDaily,
    benchmarkDaily,
  });

  const portfolioCi = bootstrapOf(
    netDaily,
    compositeBootstrapSeed({
      contractId: COMPOSITE_FACTOR_CONTRACT_ID,
      comboId: args.seedKey,
      purpose: "portfolio",
    })
  );
  const excessCi = bootstrapOf(
    metricsResult.excessDaily,
    compositeBootstrapSeed({
      contractId: COMPOSITE_FACTOR_CONTRACT_ID,
      comboId: args.seedKey,
      purpose: "excess",
    })
  );
  const dayWins = metricsResult.excessDaily.filter(point => point.value > 0).length;
  const result: SingleFactorComboResult = {
    comboId: args.comboId,
    direction: "HIGH",
    size: args.size,
    label: args.sizeLabel,
    daysIncluded: netDaily.length,
    daysExcludedSmall,
    metrics: metricsResult.metrics,
    excessCi95Low: excessCi === null ? null : round(excessCi.low),
    excessCi95High: excessCi === null ? null : round(excessCi.high),
    excessVerdict: verdictOf({
      dayCount: netDaily.length,
      ciLow: excessCi?.low ?? null,
      ciHigh: excessCi?.high ?? null,
    }),
    portfolioCi95Low: portfolioCi === null ? null : round(portfolioCi.low),
    portfolioCi95High: portfolioCi === null ? null : round(portfolioCi.high),
    portfolioVerdict: verdictOf({
      dayCount: netDaily.length,
      ciLow: portfolioCi?.low ?? null,
      ciHigh: portfolioCi?.high ?? null,
    }),
    dayWinRate:
      netDaily.length === 0 ? null : round(dayWins / netDaily.length, 10),
    trades,
  };

  return {
    comboId: args.comboId,
    size: args.size,
    sizeLabel: args.sizeLabel,
    scope: args.scope,
    result,
    portfolioMean: meanOfSeries(netDaily),
    benchmarkMean: meanOfSeries(benchmarkDaily),
    excessMean: meanOfSeries(metricsResult.excessDaily),
    netDaily,
    grossDaily,
    benchmarkDaily,
    excessDaily: metricsResult.excessDaily,
  };
}

/** Overall：全样本（不做任何选择）的等权组合 —— 即「什么也不挑」的参考线。 */
function overallOf(sections: readonly DayCrossSection[]): CompositeOverallSummary {
  const trades: SingleFactorTrade[] = [];
  const netDaily: DateClusterValue[] = [];
  const grossDaily: DateClusterValue[] = [];
  const benchmarkDaily: DateClusterValue[] = [];
  for (const section of sections) {
    if (section.pool.length === 0) continue;
    const portfolio = dailyPortfolioReturnsOf(section.pool);
    const benchmarkNet = benchmarkDayNetReturnOf(section.pool);
    if (portfolio.net === null || benchmarkNet === null) continue;
    for (const sample of section.pool) {
      trades.push(tradeOf(sample, 0, section.pool.length));
    }
    netDaily.push({ eventDate: section.date, value: portfolio.net });
    grossDaily.push({
      eventDate: section.date,
      value: portfolio.gross ?? portfolio.net,
    });
    benchmarkDaily.push({ eventDate: section.date, value: benchmarkNet });
  }
  const metrics: SingleFactorMetrics = computeMetrics({
    trades,
    grossDaily,
    netDaily,
    benchmarkDaily,
  }).metrics;
  return { daysIncluded: netDaily.length, trades: trades.length, metrics };
}

/**
 * 随机 N 的 Monte-Carlo 分布。
 *
 * ⚠️ 口径披露：随机抽 N 只的**期望**恒等于当日池均值（因此「超额」本身就是
 *    「相对随机抽签的平均优势」）；这里的分布只是把**抽样运气**展开，用来回答
 *    「观测到的那点优势会不会只是抽签」。它是**条件于已实现样本**的置换型检验，
 *    不处理时间相关性（时间相关性由主指标的日期聚类 Bootstrap 处理）。
 */
function randomBenchmarkOf(args: {
  sections: readonly DayCrossSection[];
  combo: CompositeCombo;
  scope: CompositeDayScope;
  minDaySize: number;
  observed: number | null;
}): {
  daysIncluded: number;
  randomMean: number | null;
  randomP50: number | null;
  observedPercentile: number | null;
  impliedPValue: number | null;
  simulations: number;
} {
  const included = args.sections.filter(
    section => section.pool.length >= args.minDaySize
  );
  const returnsByDay = included.map(section =>
    section.pool.map(sample => sample.netReturn)
  );
  const sizes = included.map(section => Math.min(args.combo.size, section.pool.length));
  const maxDaySize = returnsByDay.reduce(
    (max, values) => Math.max(max, values.length),
    0
  );
  const random = mulberry32(
    RANDOM_SEED_BASE +
      (compositeBootstrapSeed({
        contractId: COMPOSITE_FACTOR_CONTRACT_ID,
        comboId: `${args.combo.id}/${args.scope}`,
        purpose: "random",
      }) %
        1_000)
  );
  const scratch = new Int32Array(Math.max(1, maxDaySize));
  const simulated: number[] = [];

  for (let simulation = 0; simulation < RANDOM_SIMULATIONS; simulation += 1) {
    let total = 0;
    let counted = 0;
    for (let dayIndex = 0; dayIndex < returnsByDay.length; dayIndex += 1) {
      const values = returnsByDay[dayIndex]!;
      const size = sizes[dayIndex]!;
      const length = values.length;
      if (size >= length) {
        let sum = 0;
        for (const value of values) sum += value;
        total += sum / length;
        counted += 1;
        continue;
      }
      for (let index = 0; index < length; index += 1) scratch[index] = index;
      for (let index = 0; index < size; index += 1) {
        const swap = index + Math.floor(random() * (length - index));
        const held = scratch[index]!;
        scratch[index] = scratch[swap]!;
        scratch[swap] = held;
      }
      let sum = 0;
      for (let index = 0; index < size; index += 1) {
        sum += values[scratch[index]!]!;
      }
      total += sum / size;
      counted += 1;
    }
    simulated.push(counted === 0 ? 0 : total / counted);
  }

  simulated.sort((left, right) => left - right);
  const observed = args.observed;
  let below = 0;
  let atOrAbove = 0;
  if (observed !== null) {
    for (const value of simulated) {
      if (value < observed) below += 1;
      else atOrAbove += 1;
    }
  }
  const randomMean = meanOfValues(simulated);
  const p50 = quantileOf(simulated, 0.5);
  return {
    daysIncluded: included.length,
    randomMean: randomMean === null ? null : round(randomMean, 10),
    randomP50: p50 === null ? null : round(p50, 10),
    observedPercentile:
      observed === null || simulated.length === 0
        ? null
        : round(below / simulated.length, 10),
    impliedPValue:
      observed === null || simulated.length === 0
        ? null
        : round(atOrAbove / simulated.length, 10),
    simulations: simulated.length,
  };
}

export interface CompositeAnalysisResult {
  readonly sections: readonly DayCrossSection[];
  readonly dayDiagnostics: CompositeDayDiagnostics;
  readonly overall: CompositeOverallSummary;
  readonly evaluations: readonly ComboEvaluation[];
  readonly comboRows: readonly CompositeComboRow[];
  readonly excessRows: readonly CompositeExcessRow[];
  readonly benchmarkRows: readonly CompositeBenchmarkRow[];
  readonly timeSlices: readonly CompositeTimeSliceRow[];
}

export function analyseComposite(args: {
  rankable: readonly SingleFactorSample[];
  combos: readonly CompositeCombo[];
  dayScopes: readonly CompositeDayScope[];
  /** `FIXED` 日集的统一门槛 = 最大档 N。 */
  fixedDayMinSize: number;
}): CompositeAnalysisResult {
  const sections = [...buildCrossSections(args.rankable, "HIGH").values()];

  const daySizes = sections.map(section => section.pool.length);
  const sortedDaySizes = [...daySizes].sort((left, right) => left - right);
  const atLeast = (threshold: number): number =>
    daySizes.filter(size => size >= threshold).length;
  const q = (value: number): number | null => {
    const result = quantileOf(sortedDaySizes, value);
    return result === null ? null : round(result, 10);
  };
  const dayDiagnostics: CompositeDayDiagnostics = {
    daysTotal: daySizes.length,
    daysAtLeast3: atLeast(3),
    daysAtLeast5: atLeast(5),
    daysAtLeast10: atLeast(10),
    daysAtLeast20: atLeast(20),
    daySizeP50: q(0.5),
    daySizeMean: (() => {
      const value = meanOfValues(daySizes);
      return value === null ? null : round(value, 10);
    })(),
    daySizeMax: q(1),
  };

  const evaluations: ComboEvaluation[] = [];
  for (const combo of args.combos) {
    for (const scope of args.dayScopes) {
      evaluations.push(
        evaluateCombo({
          sections,
          comboId: combo.id,
          size: combo.size,
          sizeLabel: combo.label,
          scope,
          minDaySize:
            scope === "FIXED" ? args.fixedDayMinSize : (combo.size as number),
          seedKey: `${combo.id}/${scope}`,
        })
      );
    }
  }

  // ---- 时间切片（按年 × 各档 × OWN 日集）----
  const years = [...new Set(sections.map(section => section.year))].sort(
    (left, right) => left - right
  );
  const timeSlices: CompositeTimeSliceRow[] = [];
  for (const year of years) {
    const yearSections = sections.filter(section => section.year === year);
    const benchmarkMean = benchmarkDayNetReturnOf(
      yearSections.flatMap(section => [...section.pool])
    );
    for (const combo of args.combos) {
      const evaluation = evaluateCombo({
        sections: yearSections,
        comboId: combo.id,
        size: combo.size,
        sizeLabel: combo.label,
        scope: "OWN",
        minDaySize: combo.size,
        seedKey: `${combo.id}/YEAR/${year}`,
      });
      timeSlices.push({
        year,
        comboId: combo.id,
        sizeLabel: combo.label,
        daysIncluded: evaluation.result.daysIncluded,
        portfolioMean: evaluation.portfolioMean,
        benchmarkMean: benchmarkMean === null ? null : round(benchmarkMean, 10),
        excessMean: evaluation.excessMean,
        excessCi95Low: evaluation.result.excessCi95Low,
        excessCi95High: evaluation.result.excessCi95High,
        verdict: evaluation.result.excessVerdict,
      });
    }
  }

  // ---- 配对基准 + 随机 N 分位 ----
  const benchmarkRows: CompositeBenchmarkRow[] = evaluations.map(evaluation => {
    const random = randomBenchmarkOf({
      sections,
      combo: args.combos.find(combo => combo.id === evaluation.comboId)!,
      scope: evaluation.scope,
      minDaySize:
        evaluation.scope === "FIXED"
          ? args.fixedDayMinSize
          : (evaluation.size as number),
      observed: evaluation.portfolioMean,
    });
    return {
      comboId: evaluation.comboId,
      sizeLabel: evaluation.sizeLabel,
      scope: evaluation.scope,
      daysIncluded: random.daysIncluded,
      benchmarkMean: evaluation.benchmarkMean,
      benchmarkTotalReturn: evaluation.result.metrics.benchmarkReturn,
      randomPercentile: random.observedPercentile,
      randomP50: random.randomP50,
      impliedPValue: random.impliedPValue,
      simulations: random.simulations,
    };
  });

  const excessRows: CompositeExcessRow[] = evaluations.map(evaluation => ({
    comboId: evaluation.comboId,
    sizeLabel: evaluation.sizeLabel,
    scope: evaluation.scope,
    daysIncluded: evaluation.result.daysIncluded,
    excessMean: evaluation.excessMean,
    excessCi95Low: evaluation.result.excessCi95Low,
    excessCi95High: evaluation.result.excessCi95High,
    verdict: evaluation.result.excessVerdict,
    dayWinRate: evaluation.result.dayWinRate,
  }));

  const comboRows: CompositeComboRow[] = evaluations.map(evaluation => {
    const row: SingleFactorComboResult = evaluation.result;
    return {
      comboId: row.comboId,
      direction: row.direction,
      size: row.size,
      label: row.label,
      daysIncluded: row.daysIncluded,
      daysExcludedSmall: row.daysExcludedSmall,
      metrics: row.metrics,
      excessCi95Low: row.excessCi95Low,
      excessCi95High: row.excessCi95High,
      excessVerdict: row.excessVerdict,
      portfolioCi95Low: row.portfolioCi95Low,
      portfolioCi95High: row.portfolioCi95High,
      portfolioVerdict: row.portfolioVerdict,
      dayWinRate: row.dayWinRate,
    };
  });

  return {
    sections,
    dayDiagnostics,
    overall: overallOf(sections),
    evaluations,
    comboRows,
    excessRows,
    benchmarkRows,
    timeSlices,
  };
}

/** 供上层生成「逐档日度序列」CSV 产物时复用。 */
export function dailySeriesCsvOf(
  series: readonly DateClusterValue[],
  valueColumn: string
): string {
  const lines = [`event_date,${valueColumn}\n`];
  for (const point of series) lines.push(`${point.eventDate},${point.value}\n`);
  return lines.join("");
}

export { MIN_DECISION_DAY_COUNT } from "../singleFactor/metrics";
