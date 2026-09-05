import type { LeaderCandidateBacktestRow } from "./leaderCandidates";
import type { RealisticBacktestOptions, RealisticBacktestResult } from "./realisticBacktest";
import { RESEARCH_LEGACY_SIMULATION_SOURCE } from "./research/legacyTransactionSimulator";
import type { LeaderCandidateDailyPrice } from "./leaderCandidates";
import { mean, quantile, normalCdf, normalQuantile, sharpeRatio, skewness, excessKurtosis } from "../shared/quant-stats";

// 保持既有调用方（technicalFactors 等）兼容：正态分布基础函数已统一迁移到 shared/quant-stats。
export { normalCdf, normalQuantile } from "../shared/quant-stats";

/**
 * 过拟合防护（三-P0）：打地鼠基准（随机策略对照）与 Deflated Sharpe Ratio（多重检验校正）。
 * 用于判断样本外表现是否显著优于"在相同参数空间随机选股"的基准，并对多次搜索后的最优夏普做校正。
 */

const EULER_MASCHERONI = 0.5772156649015329;
const E = Math.E;

/** mulberry32 可复现伪随机数生成器。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SharpeMoments = {
  sharpeRatio: number;
  skewness: number;
  kurtosis: number;
  sampleLength: number;
};

/** 由日收益率序列计算夏普、偏度、峰度（excess kurtosis，统一 sample-adjusted Fisher-Pearson）。 */
export function calculateSharpeMoments(dailyReturns: number[], annualizationTradingDays = 252): SharpeMoments | null {
  const valid = dailyReturns.filter((value) => Number.isFinite(value));
  if (valid.length < 3) return null;
  const sharpe = sharpeRatio(valid, annualizationTradingDays);
  const skew = skewness(valid);
  const kurt = excessKurtosis(valid);
  if (sharpe === null || skew === null || kurt === null) return null;
  return { sharpeRatio: sharpe, skewness: skew, kurtosis: kurt, sampleLength: valid.length };
}

/** 多重检验下的期望最优夏普 E[SR_max]（Bailey & López de Prado 2014）。 */
export function expectedMaximumSharpe(numTrials: number, sharpeRatio: number, skewness: number, kurtosis: number, sampleLength: number): number {
  const safeTrials = Math.max(1, numTrials);
  const varianceOfSharpe = (1 - skewness * sharpeRatio + (kurtosis + 2) / 4 * sharpeRatio ** 2) / (sampleLength - 1);
  const stdOfSharpe = Math.sqrt(Math.max(0, varianceOfSharpe));
  // safeTrials >= 1 → 入参落在 [0,1)，normalQuantile 仅在 NaN 入参时返回 null，此处恒为有限值。
  const z1 = normalQuantile(1 - 1 / safeTrials)!;
  const z2 = normalQuantile(1 - 1 / (safeTrials * E))!;
  return stdOfSharpe * ((1 - EULER_MASCHERONI) * z1 + EULER_MASCHERONI * z2);
}

/** Deflated Sharpe Ratio：DSR = Φ( (SR - E[SR_max]) √(T-1) / √(1 - γ3·SR + (γ4-1)/4·SR²) )。 */
export function deflatedSharpeRatio(sharpeRatio: number, numTrials: number, skewness: number, kurtosis: number, sampleLength: number): number {
  const expected = expectedMaximumSharpe(numTrials, sharpeRatio, skewness, kurtosis, sampleLength);
  const denominator = Math.sqrt(Math.max(1e-12, 1 - skewness * sharpeRatio + (kurtosis + 2) / 4 * sharpeRatio ** 2));
  const z = ((sharpeRatio - expected) * Math.sqrt(sampleLength - 1)) / denominator;
  // z 由有限入参计算得到，normalCdf 仅在 NaN 入参时返回 null，此处恒为有限值。
  return normalCdf(z)!;
}

/**
 * Probabilistic Sharpe Ratio（Bailey & López de Prado）：策略夏普显著高于基准夏普 SR* 的概率。
 * PSR(SR*) = Φ( (SR - SR*) √(T-1) / √(1 - γ3·SR + (γ4-1)/4·SR²) )。
 * 与 DSR 的区别：DSR 以 E[SR_max]（多次搜索后的期望最优）为基准，PSR 以显式基准（如 0 或市场）为基准。
 */
export function probabilisticSharpeRatio(sharpeRatio: number, benchmarkSharpe: number, skewness: number, kurtosis: number, sampleLength: number): number {
  const denominator = Math.sqrt(Math.max(1e-12, 1 - skewness * sharpeRatio + (kurtosis + 2) / 4 * sharpeRatio ** 2));
  const z = ((sharpeRatio - benchmarkSharpe) * Math.sqrt(sampleLength - 1)) / denominator;
  // z 由有限入参计算得到，normalCdf 仅在 NaN 入参时返回 null，此处恒为有限值。
  return normalCdf(z)!;
}

export type MonkeyBenchmarkResult = {
  trialCount: number;
  realTotalReturn: number;
  realSharpe: number | null;
  randomReturns: number[];
  randomSharpeMoments: SharpeMoments | null;
  randomMean: number | null;
  random95Quantile: number | null;
  percentileRank: number | null;
  exceededRandom95: boolean | null;
  deflatedSharpe: number | null;
  expectedMaximumSharpe: number | null;
  definition: string;
};

type Simulate = (rows: LeaderCandidateBacktestRow[], options: RealisticBacktestOptions | undefined, priceByStockDate: Map<string, LeaderCandidateDailyPrice>, tradingDates: string[]) => RealisticBacktestResult;

function dailyReturnsFromSimulation(simulation: RealisticBacktestResult): number[] {
  return simulation.equityCurve.map((point) => point.equity).filter((equity) => Number.isFinite(equity) && equity > 0)
    .slice(1)
    .map((equity, index) => equity / (simulation.equityCurve[index]?.equity ?? equity) - 1)
    .filter((value) => Number.isFinite(value));
}

export type ReturnBootstrapResult = {
  numTrials: number;
  /** 自助重抽样夏普均值。 */
  sharpeMean: number | null;
  /** 夏普 95% 置信区间下界。 */
  sharpeLower95: number | null;
  /** 夏普 95% 置信区间上界。 */
  sharpeUpper95: number | null;
  /** 最大回撤均值（%）。 */
  maxDrawdownMean: number | null;
  /** 最大回撤 95 分位（%）。 */
  maxDrawdownP95: number | null;
  /** CAGR 均值（%）。 */
  cagrMean: number | null;
  /** 破产概率：最大回撤 ≥ 阈值的自助样本占比（默认阈值 30%）。 */
  ruinProbability: number | null;
  definition: string;
};

export type OverfittingGuardReport = {
  realSharpe: number | null;
  numTrials: number;
  deflatedSharpe: number | null;
  expectedMaximumSharpe: number | null;
  /** Probabilistic Sharpe Ratio（基准夏普 = 0，即"夏普显著为正"的概率）。 */
  psr: number | null;
  /** 日收益蒙特卡洛自助（夏普置信区间、回撤分布、破产概率）。 */
  bootstrap: ReturnBootstrapResult | null;
  definition: string;
};

/** 基于一次真实回测，计算夏普并按参数搜索次数做 Deflated Sharpe 校正，同时输出 PSR 与蒙特卡洛自助。 */
export function buildOverfittingGuardReport(simulation: RealisticBacktestResult, numTrials: number): OverfittingGuardReport {
  const returns = dailyReturnsFromSimulation(simulation);
  const moments = calculateSharpeMoments(returns);
  const realSharpe = moments?.sharpeRatio ?? null;
  let deflatedSharpe: number | null = null;
  let expectedMaximumSharpeValue: number | null = null;
  let psr: number | null = null;
  if (moments) {
    expectedMaximumSharpeValue = expectedMaximumSharpe(numTrials, moments.sharpeRatio, moments.skewness, moments.kurtosis, moments.sampleLength);
    deflatedSharpe = deflatedSharpeRatio(moments.sharpeRatio, numTrials, moments.skewness, moments.kurtosis, moments.sampleLength);
    psr = probabilisticSharpeRatio(moments.sharpeRatio, 0, moments.skewness, moments.kurtosis, moments.sampleLength);
  }
  return {
    realSharpe: realSharpe === null ? null : Number(realSharpe.toFixed(3)),
    numTrials,
    deflatedSharpe: deflatedSharpe === null ? null : Number(deflatedSharpe.toFixed(4)),
    expectedMaximumSharpe: expectedMaximumSharpeValue === null ? null : Number(expectedMaximumSharpeValue.toFixed(4)),
    psr: psr === null ? null : Number(psr.toFixed(4)),
    bootstrap: runReturnBootstrap(returns),
    definition: `Deflated Sharpe 校正 ${numTrials} 组参数搜索后的最优夏普（期望最优夏普 E[SR_max]）。DSR 越接近 1 越可信；低于 0.95 提示存在过拟合风险。PSR 为"夏普显著为正"的概率；蒙特卡洛自助给出夏普置信区间与最大回撤分布。`,
  };
}

/**
 * 日收益蒙特卡洛自助（Bootstrap）：有放回重抽样日收益，重构权益曲线，
 * 得到夏普、最大回撤、CAGR 的经验分布，输出 95% 置信区间与破产概率。
 * 不依赖新模拟，仅对已有收益序列重抽样，成本低。
 */
export function runReturnBootstrap(dailyReturns: number[], numTrials = 2000, seed = 20260905, ruinThreshold = 0.3): ReturnBootstrapResult {
  const definition = `对 ${dailyReturns.length} 个日收益做 ${numTrials} 次有放回重抽样，重构权益曲线得到夏普/最大回撤/CAGR 经验分布；破产概率 = 最大回撤 ≥ ${ruinThreshold * 100}% 的自助样本占比。`;
  if (dailyReturns.length < 3) {
    return { numTrials, sharpeMean: null, sharpeLower95: null, sharpeUpper95: null, maxDrawdownMean: null, maxDrawdownP95: null, cagrMean: null, ruinProbability: null, definition };
  }
  const rng = mulberry32(seed);
  const n = dailyReturns.length;
  const sharpes: number[] = [];
  const drawdowns: number[] = [];
  const cagrs: number[] = [];
  for (let trial = 0; trial < numTrials; trial += 1) {
    const resampled: number[] = [];
    for (let i = 0; i < n; i += 1) resampled.push(dailyReturns[Math.floor(rng() * n)]!);
    const moments = calculateSharpeMoments(resampled);
    if (moments) sharpes.push(moments.sharpeRatio);
    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    for (const r of resampled) {
      equity *= 1 + r;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
    }
    drawdowns.push(maxDrawdown);
    cagrs.push(Math.pow(equity, 252 / n) - 1);
  }
  const sortedSharpe = [...sharpes].sort((a, b) => a - b);
  const sortedDrawdown = [...drawdowns].sort((a, b) => a - b);
  const meanOf = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const sharpeLower = quantile(sortedSharpe, 0.025);
  const sharpeUpper = quantile(sortedSharpe, 0.975);
  return {
    numTrials,
    sharpeMean: meanOf(sharpes) === null ? null : Number((meanOf(sharpes)!).toFixed(3)),
    sharpeLower95: sharpeLower === null ? null : Number(sharpeLower.toFixed(3)),
    sharpeUpper95: sharpeUpper === null ? null : Number(sharpeUpper.toFixed(3)),
    maxDrawdownMean: meanOf(drawdowns) === null ? null : Number((meanOf(drawdowns)! * 100).toFixed(1)),
    maxDrawdownP95: quantile(sortedDrawdown, 0.95) === null ? null : Number((quantile(sortedDrawdown, 0.95)! * 100).toFixed(1)),
    cagrMean: meanOf(cagrs) === null ? null : Number((meanOf(cagrs)! * 100).toFixed(1)),
    ruinProbability: drawdowns.length === 0 ? null : Number((drawdowns.filter((value) => value >= ruinThreshold).length / drawdowns.length).toFixed(4)),
    definition,
  };
}

export type CostSensitivityPoint = {
  /** 成本倍数（0 为无成本，1 为基础成本）。 */
  costMultiplier: number;
  totalReturn: number;
  sharpe: number | null;
  tradeCount: number;
};

export type CostSensitivityResult = {
  points: CostSensitivityPoint[];
  definition: string;
};

/**
 * 交易成本敏感性：在 0 / 1 / 1.5 / 2 / 3 倍成本下重复回测，判断策略是否仅在"理想无成本"环境成立。
 * 成本包括佣金、印花税、过户费与滑点，统一按倍数缩放。多次重跑回测，成本较高，按需触发。
 */
export function runCostSensitivity(
  rows: LeaderCandidateBacktestRow[],
  options: RealisticBacktestOptions | undefined,
  priceByStockDate: Map<string, LeaderCandidateDailyPrice>,
  tradingDates: string[],
  multipliers: number[] = [0, 1, 1.5, 2, 3],
  simulate: Simulate = RESEARCH_LEGACY_SIMULATION_SOURCE.simulate,
): CostSensitivityResult {
  const points: CostSensitivityPoint[] = [];
  for (const multiplier of multipliers) {
    const scaledOptions: RealisticBacktestOptions = {
      ...(options ?? {}),
      commissionRate: (options?.commissionRate ?? 0.0003) * multiplier,
      stampDutyRate: (options?.stampDutyRate ?? 0.0005) * multiplier,
      transferFeeRate: (options?.transferFeeRate ?? 0.00001) * multiplier,
      slippageBps: (options?.slippageBps ?? 10) * multiplier,
    };
    const simulation = simulate(rows, scaledOptions, priceByStockDate, tradingDates);
    const returns = dailyReturnsFromSimulation(simulation);
    const sharpe = calculateSharpeMoments(returns)?.sharpeRatio ?? null;
    points.push({
      costMultiplier: multiplier,
      totalReturn: simulation.totalReturn,
      sharpe: sharpe === null ? null : Number(sharpe.toFixed(3)),
      tradeCount: simulation.completedCount,
    });
  }
  return {
    points,
    definition: `在 0/1/1.5/2/3 倍交易成本（佣金+印花税+过户费+滑点）下重复回测；若收益/夏普随成本快速转负，说明策略依赖理想无成本环境，可交易性差。`,
  };
}

/**
 * 打地鼠基准：固定候选池、资金、成本与退出约束，随机打乱评分排序模拟"随机选股"，
 * 重复 trialCount 次得到随机策略收益分布；真实策略收益若超过该分布的 95 分位，则显著优于随机。
 */
export function runMonkeyBenchmark(
  rows: LeaderCandidateBacktestRow[],
  options: RealisticBacktestOptions | undefined,
  priceByStockDate: Map<string, LeaderCandidateDailyPrice>,
  tradingDates: string[],
  trialCount = 200,
  seed = 20260905,
  simulate: Simulate = RESEARCH_LEGACY_SIMULATION_SOURCE.simulate,
): MonkeyBenchmarkResult {
  const real = simulate(rows, options, priceByStockDate, tradingDates);
  const realReturns = dailyReturnsFromSimulation(real);
  const realMoments = calculateSharpeMoments(realReturns);
  const realSharpe = realMoments?.sharpeRatio ?? null;
  const random = mulberry32(seed);
  const randomReturns: number[] = [];
  for (let trial = 0; trial < trialCount; trial += 1) {
    const shuffled = rows.map((row) => ({ ...row, score: random() * 100 }));
    const simulation = simulate(shuffled, options, priceByStockDate, tradingDates);
    randomReturns.push(simulation.totalReturn);
  }
  const sorted = [...randomReturns].sort((a, b) => a - b);
  const quantileAt = (p: number) => sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
  const random95Quantile = quantileAt(0.95);
  const randomMean = randomReturns.length === 0 ? null : mean(randomReturns);
  const rank = sorted.filter((value) => value < real.totalReturn).length;
  const percentileRank = randomReturns.length === 0 ? null : rank / randomReturns.length;

  let deflatedSharpe: number | null = null;
  let expectedMaximumSharpeValue: number | null = null;
  if (realMoments) {
    expectedMaximumSharpeValue = expectedMaximumSharpe(trialCount, realMoments.sharpeRatio, realMoments.skewness, realMoments.kurtosis, realMoments.sampleLength);
    deflatedSharpe = deflatedSharpeRatio(realMoments.sharpeRatio, trialCount, realMoments.skewness, realMoments.kurtosis, realMoments.sampleLength);
  }

  return {
    trialCount,
    realTotalReturn: real.totalReturn,
    realSharpe,
    randomReturns,
    randomSharpeMoments: realMoments,
    randomMean: randomMean === null ? null : Number(randomMean.toFixed(2)),
    random95Quantile: random95Quantile === null ? null : Number(random95Quantile.toFixed(2)),
    percentileRank: percentileRank === null ? null : Number((percentileRank * 100).toFixed(1)),
    exceededRandom95: random95Quantile === null ? null : real.totalReturn > random95Quantile,
    deflatedSharpe: deflatedSharpe === null ? null : Number(deflatedSharpe.toFixed(4)),
    expectedMaximumSharpe: expectedMaximumSharpeValue === null ? null : Number(expectedMaximumSharpeValue.toFixed(4)),
    definition: `打地鼠基准固定候选池与全部交易约束，仅随机打乱评分排序模拟随机选股，重复 ${trialCount} 次；真实策略收益超过随机分布 95 分位即显著优于随机。Deflated Sharpe 校正多次搜索后的最优夏普（期望最优夏普 E[SR_max]）。`,
  };
}
