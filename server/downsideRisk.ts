import type { LeaderCandidateBacktestContext, LeaderCandidateBacktestRow } from "./leaderCandidates";
import type { RealisticBacktestOptions, RealisticBacktestResult, RealisticTrade } from "./realisticBacktest";
import {
  RESEARCH_LEGACY_SIMULATION_SOURCE,
  type ResearchSimulationProvenance,
  type ResearchSimulationSource,
} from "./research/legacyTransactionSimulator";
import { mean, sampleStandardDeviation, quantile, median, skewness, excessKurtosis, sharpeRatio, annualizedReturnFromEquityCurve } from "../shared/quant-stats";

export type DownsideRiskOptions = {
  observationDays?: number;
  mediumDownsidePercent?: number;
  highDownsidePercent?: number;
  penaltyWeight?: number;
  autoTunePenaltyWeight?: boolean;
  hardRiskThreshold?: number;
  rollingTrainTradingDays?: number;
  rollingValidationTradingDays?: number;
};

export type DownsideRiskSignalScore = {
  riskScore: number;
  riskTier: "低风险" | "中风险" | "高风险";
};

export type DownsideRiskStrategyKey = "baseline" | "riskPenalty" | "hardFilter" | "qualityBlend" | "qualityGate";

export const defaultDownsideRiskPenaltyWeight = 0.35;

export type DownsideRiskFeature = {
  key: string;
  label: string;
  definition: string;
  timing: "信号日";
};

export type DownsideRiskProfile = {
  row: LeaderCandidateBacktestRow;
  riskScore: number;
  riskTier: "低风险" | "中风险" | "高风险";
  riskContributions: Record<string, number>;
  maxAdverseReturn: number | null;
  observedTradingDays: number;
  usedLowPriceForLabel: boolean;
  mediumDownside: boolean | null;
  highDownside: boolean | null;
};

export type DownsideRiskTierSummary = {
  tier: "低风险" | "中风险" | "高风险";
  sampleSize: number;
  averageMaxAdverseReturn: number | null;
  mediumDownsideCount: number;
  mediumDownsideRate: number | null;
  highDownsideCount: number;
  highDownsideRate: number | null;
};

export type DownsideRiskExperimentItem = {
  key: DownsideRiskStrategyKey;
  label: string;
  description: string;
  inputCandidateCount: number;
  excludedCandidateCount: number;
  realisticSimulation: RealisticBacktestResult;
  riskAdjustedPerformance: DownsideRiskAdjustedPerformance;
  strategyEvaluation: DownsideRiskStrategyEvaluation;
};

/**
 * 以同一连续资金曲线的相邻交易日权益变动计算；无风险收益率固定为0，
 * 因回测不模拟现金管理收益。年化系数采用市场通行的252个交易日。
 */
export type DownsideRiskAdjustedPerformance = {
  returnSampling: "相邻交易日收盘权益";
  riskFreeAnnualRate: number;
  annualizationTradingDays: number;
  equityPointCount: number;
  dailyReturnCount: number;
  annualizedReturn: number | null;
  dailyVolatility: number | null;
  annualizedVolatility: number | null;
  annualizedDownsideDeviation: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  ulcerIndex: number | null;
};

export type DownsideRiskStrategyEvaluation = {
  core: {
    cagr: number | null;
    totalReturn: number;
    maxDrawdown: number;
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    calmarRatio: number | null;
    ulcerIndex: number | null;
  };
  tradeQuality: {
    winRate: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    averageWin: number | null;
    averageLoss: number | null;
    payoffRatio: number | null;
    maxConsecutiveLosses: number;
    tradeCount: number;
  };
  tailRisk: {
    valueAtRisk95: number | null;
    conditionalValueAtRisk95: number | null;
    valueAtRisk99: number | null;
    conditionalValueAtRisk99: number | null;
    skewness: number | null;
    excessKurtosis: number | null;
    worstDay: number | null;
    worstTrade: number | null;
  };
  stability: {
    profitableMonthRate: number | null;
    profitableYearRate: number | null;
    latestRollingSharpe: number | null;
    latestRollingCalmar: number | null;
    latestRollingCagr: number | null;
    rollingWindowTradingDays: number;
    maxDrawdownDurationTradingDays: number | null;
    longestRecoveryTradingDays: number | null;
    topFivePositiveDayReturnContribution: number | null;
  };
  tradingRealism: {
    totalFees: number;
    modeledOneWaySlippageBps: number;
    periodTurnoverToInitialCapital: number | null;
    averageHoldingTradingDays: number | null;
    averageCapitalUtilization: number | null;
    averageOpenPositions: number | null;
    maxOpenPositions: number;
    averageEntryParticipationBps: number | null;
    entryParticipationCoverageCount: number;
  };
};

export type DownsideRiskStrategyRobustness = {
  key: DownsideRiskStrategyKey;
  label: string;
  walkForwardOosSharpe: number | null;
  walkForwardOosCagr: number | null;
  sharpeDecayRate: number | null;
  cagrDecayRate: number | null;
  parameterStability: { kind: "fixed" | "rollingPenaltyWeight"; distinctValueCount: number; standardDeviation: number | null };
  parameterSensitivity: { minimumTrainingObjective: number | null; maximumTrainingObjective: number | null; range: number | null };
  marketEnvironments: Array<{ phase: string; completedTradeCount: number; averageTradeReturn: number | null }>;
};

export type DownsideRiskWeightTrial = {
  penaltyWeight: number;
  objectiveValue: number;
  totalReturn: number;
  maxDrawdown: number;
  completedCount: number;
};

export type DownsideRiskRollingWindow = {
  index: number;
  calibrationStartDate: string;
  calibrationEndDate: string;
  validationStartDate: string;
  validationEndDate: string;
  labeledSampleSize: number;
  highDownsideRate: number | null;
  autoTunedPenaltyWeight: number;
  trainingSampleSize: number;
  trainingObjectiveValue: number;
  trainingTotalReturn: number;
  trainingMaxDrawdown: number;
  weightTrials: DownsideRiskWeightTrial[];
  experiments: Array<Pick<DownsideRiskExperimentItem, "key" | "inputCandidateCount" | "excludedCandidateCount" | "realisticSimulation">>;
};

export type DownsideRiskWalkForwardExperiment = {
  key: DownsideRiskExperimentItem["key"];
  label: string;
  totalReturn: number;
  maxDrawdown: number;
  finalCapital: number;
  filledCount: number;
  completedCount: number;
  riskAdjustedPerformance: DownsideRiskAdjustedPerformance;
  strategyEvaluation: DownsideRiskStrategyEvaluation;
};

export type DownsideRiskWalkForwardResult = {
  definition: string;
  startDate: string | null;
  endDate: string | null;
  validationWindowCount: number;
  experiments: DownsideRiskWalkForwardExperiment[];
  equityCurve: Array<{ date: string; baseline: number | null; riskPenalty: number | null; hardFilter: number | null; qualityBlend: number | null; qualityGate: number | null }>;
};

export type DownsideRiskFullCycleResult = {
  definition: string;
  startDate: string | null;
  endDate: string | null;
  experiments: DownsideRiskExperimentItem[];
  tradeDifferences: DownsideRiskTradeDifferenceRow[];
  riskPenaltyAttribution: DownsideRiskPenaltyAttribution;
};

export type DownsideRiskPenaltyAttribution = {
  baselineOnlyFilledCount: number;
  riskPenaltyOnlyFilledCount: number;
  commonFilledCount: number;
  commonFilledDifferentReturnCount: number;
  baselineOnlyNetPnl: number;
  riskPenaltyOnlyNetPnl: number;
  autoTunedSignalCount: number;
  fallbackWeightSignalCount: number;
};

export type DownsideRiskTradeSnapshot = Pick<RealisticTrade,
  "status" | "score" | "shares" | "entryDate" | "exitDate" | "entryPrice" | "exitPrice" | "netReturn" | "reason"
>;

export type DownsideRiskTradeDifferenceRow = {
  signalDate: string;
  stockCode: string;
  stockName: string;
  riskScore: number;
  appliedPenaltyWeight: number;
  baseline: DownsideRiskTradeSnapshot | null;
  riskPenalty: DownsideRiskTradeSnapshot | null;
  hardFilter: DownsideRiskTradeSnapshot | null;
  qualityBlend: DownsideRiskTradeSnapshot | null;
  qualityGate: DownsideRiskTradeSnapshot | null;
  hardFilterExcluded: boolean;
  qualityGateExcluded: boolean;
};

export type DownsideRiskResearchResult = {
  /**
   * 模拟来源 provenance（STEP 5 P2-2）：研究报表使用的交易模拟器标识。
   * `productionRuntime` 恒为 false —— 研究报表不得被当作生产交易引擎的结果消费。
   */
  simulator: ResearchSimulationProvenance;
  definition: string;
  observationDays: number;
  mediumDownsidePercent: number;
  highDownsidePercent: number;
  penaltyWeight: number;
  autoTunePenaltyWeight: boolean;
  penaltyWeightGrid: number[];
  hardRiskThreshold: number;
  rollingTrainTradingDays: number;
  rollingValidationTradingDays: number;
  featureMatrix: DownsideRiskFeature[];
  labeledSampleSize: number;
  lowPriceLabelSampleSize: number;
  signalAmountSampleSize: number;
  riskTiers: DownsideRiskTierSummary[];
  experiments: DownsideRiskExperimentItem[];
  rollingWindows: DownsideRiskRollingWindow[];
  walkForward: DownsideRiskWalkForwardResult | null;
  fullCycle: DownsideRiskFullCycleResult;
  factorAblations: DownsideRiskFactorAblation[];
  strategyRobustness: DownsideRiskStrategyRobustness[];
};

export type DownsideRiskAblationMetric = {
  totalReturn: number;
  maxDrawdown: number;
  returnDelta: number;
  drawdownDelta: number;
  filledCount: number;
};

export type DownsideRiskFactorAblation = {
  key: string;
  label: string;
  affectedSignalCount: number;
  averageContribution: number;
  fullCycle: DownsideRiskAblationMetric;
  walkForward: DownsideRiskAblationMetric;
};

const riskFeatures: DownsideRiskFeature[] = [
  { key: "boards", label: "连板高度", definition: "信号日连续涨停板数；高板相对增加风险扣分。", timing: "信号日" },
  { key: "sectorCount", label: "题材支撑", definition: "信号日同题材涨停数量；题材支撑不足增加风险扣分。", timing: "信号日" },
  { key: "limitUpTime", label: "封板时间", definition: "信号日封板时间；封板偏晚增加风险扣分。", timing: "信号日" },
  { key: "signalAmount", label: "日线成交额", definition: "信号日Tushare日线成交额（千元）；成交额不足或缺失增加风险扣分。", timing: "信号日" },
  { key: "marketCap", label: "流通市值评分", definition: "信号日可得流通市值分层；极小盘、超大盘或缺失增加风险扣分。", timing: "信号日" },
];

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const ratio = (numerator: number, denominator: number) => denominator === 0 ? null : round((numerator / denominator) * 100, 1);
const penaltyWeightGrid = [0, 0.15, 0.35, 0.55, 0.75, 1];

const riskAnnualizationTradingDays = 252;

/**
 * 夏普、索提诺和卡玛均基于同一连续账户的相邻交易日收盘权益。
 * 无风险收益率设为0，因为模拟器未配置现金管理收益；不以未来价格筛选或改写策略。
 */
export function calculateRiskAdjustedPerformance(simulation: RealisticBacktestResult): DownsideRiskAdjustedPerformance {
  const equities = simulation.equityCurve.map((point) => point.equity).filter((equity) => Number.isFinite(equity) && equity > 0);
  const dailyReturns = equities.slice(1).map((equity, index) => equity / equities[index]! - 1).filter((value) => Number.isFinite(value));
  const meanReturn = dailyReturns.length === 0 ? null : dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
  const dailyVolatility = meanReturn === null || dailyReturns.length < 2 ? null : Math.sqrt(dailyReturns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / (dailyReturns.length - 1));
  const downsideDeviation = dailyReturns.length === 0 ? null : Math.sqrt(dailyReturns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / dailyReturns.length);
  const annualizedReturn = annualizedReturnFromEquityCurve(simulation.initialCapital, simulation.finalCapital, dailyReturns.length, riskAnnualizationTradingDays);
  let peak = simulation.initialCapital;
  const drawdowns = equities.map((equity) => {
    peak = Math.max(peak, equity);
    return peak === 0 ? 0 : (equity / peak) - 1;
  });
  const ulcerIndex = drawdowns.length === 0 ? null : Math.sqrt(drawdowns.reduce((sum, drawdown) => sum + drawdown ** 2, 0) / drawdowns.length);
  const annualizedVolatility = dailyVolatility === null ? null : dailyVolatility * Math.sqrt(riskAnnualizationTradingDays);
  const annualizedDownsideDeviation = downsideDeviation === null ? null : downsideDeviation * Math.sqrt(riskAnnualizationTradingDays);
  const maxDrawdown = simulation.maxDrawdown / 100;
  // 标准算术年化夏普（全系统唯一定义）：mean(dailyReturn)/sampleStd(dailyReturn)·√252。
  const sharpeRatioValue = sharpeRatio(dailyReturns);
  return {
    returnSampling: "相邻交易日收盘权益",
    riskFreeAnnualRate: 0,
    annualizationTradingDays: riskAnnualizationTradingDays,
    equityPointCount: equities.length,
    dailyReturnCount: dailyReturns.length,
    annualizedReturn: annualizedReturn === null ? null : round(annualizedReturn * 100, 2),
    dailyVolatility: dailyVolatility === null ? null : round(dailyVolatility * 100, 4),
    annualizedVolatility: annualizedVolatility === null ? null : round(annualizedVolatility * 100, 2),
    annualizedDownsideDeviation: annualizedDownsideDeviation === null ? null : round(annualizedDownsideDeviation * 100, 2),
    sharpeRatio: sharpeRatioValue === null ? null : round(sharpeRatioValue, 3),
    sortinoRatio: annualizedReturn === null || !annualizedDownsideDeviation ? null : round(annualizedReturn / annualizedDownsideDeviation, 3),
    calmarRatio: annualizedReturn === null || !maxDrawdown ? null : round(annualizedReturn / maxDrawdown, 3),
    ulcerIndex: ulcerIndex === null ? null : round(ulcerIndex * 100, 2),
  };
}

function maxDrawdownFromEquities(equities: number[]) {
  let peak = equities[0] ?? 0;
  let maxDrawdown = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak === 0 ? 0 : (peak - equity) / peak);
  }
  return maxDrawdown;
}

function calculatePeriodProfitability(equityPoints: RealisticBacktestResult["equityCurve"], initialCapital: number, period: "month" | "year") {
  const grouped = new Map<string, { baseEquity: number; endEquity: number }>();
  let previousEquity = initialCapital;
  let previousKey: string | null = null;
  for (const point of equityPoints) {
    const key = period === "month" ? point.date.slice(0, 7) : point.date.slice(0, 4);
    const entry = grouped.get(key);
    if (entry) entry.endEquity = point.equity;
    else grouped.set(key, { baseEquity: previousKey === null ? initialCapital : previousEquity, endEquity: point.equity });
    previousEquity = point.equity;
    previousKey = key;
  }
  const returns = Array.from(grouped.values()).map((item) => item.baseEquity <= 0 ? null : item.endEquity / item.baseEquity - 1).filter((value): value is number => value !== null && Number.isFinite(value));
  return ratio(returns.filter((value) => value > 0).length, returns.length);
}

function calculateDrawdownDurations(equities: number[]) {
  if (equities.length === 0) return { maxDrawdownDurationTradingDays: null, longestRecoveryTradingDays: null };
  let peak = equities[0]!;
  let drawdownStart: number | null = null;
  let maxDuration = 0;
  let longestRecovery = 0;
  equities.forEach((equity, index) => {
    if (equity >= peak) {
      if (drawdownStart !== null) longestRecovery = Math.max(longestRecovery, index - drawdownStart);
      peak = equity;
      drawdownStart = null;
      return;
    }
    if (drawdownStart === null) drawdownStart = index;
    maxDuration = Math.max(maxDuration, index - drawdownStart + 1);
  });
  if (drawdownStart !== null) longestRecovery = Math.max(longestRecovery, equities.length - 1 - drawdownStart);
  return { maxDrawdownDurationTradingDays: maxDuration || null, longestRecoveryTradingDays: longestRecovery || null };
}

export function calculateStrategyEvaluation(
  simulation: RealisticBacktestResult,
  context: LeaderCandidateBacktestContext,
  candidateRows: LeaderCandidateBacktestRow[],
): DownsideRiskStrategyEvaluation {
  const riskAdjusted = calculateRiskAdjustedPerformance(simulation);
  const equityPoints = simulation.equityCurve.filter((point) => Number.isFinite(point.equity) && point.equity > 0);
  const equities = equityPoints.map((point) => point.equity);
  const dailyReturns = equities.slice(1).map((equity, index) => equity / equities[index]! - 1).filter((value) => Number.isFinite(value));
  const completedTrades = simulation.trades.filter((trade) => trade.status === "filled" && trade.netReturn !== null);
  const tradeReturns = completedTrades.map((trade) => trade.netReturn!);
  const winningReturns = tradeReturns.filter((value) => value > 0);
  const losingReturns = tradeReturns.filter((value) => value < 0);
  const tradeReturnMean = mean(tradeReturns);
  const averageWin = mean(winningReturns);
  const averageLoss = mean(losingReturns);
  const orderedTrades = completedTrades.slice().sort((left, right) => (left.exitDate ?? left.entryDate ?? left.signalDate).localeCompare(right.exitDate ?? right.entryDate ?? right.signalDate));
  let maximumConsecutiveLosses = 0;
  let consecutiveLosses = 0;
  for (const trade of orderedTrades) {
    if ((trade.netReturn ?? 0) < 0) {
      consecutiveLosses += 1;
      maximumConsecutiveLosses = Math.max(maximumConsecutiveLosses, consecutiveLosses);
    } else consecutiveLosses = 0;
  }
  const valueAtRisk95 = quantile(dailyReturns, 0.05);
  const valueAtRisk99 = quantile(dailyReturns, 0.01);
  const conditionalValueAtRisk95 = valueAtRisk95 === null ? null : mean(dailyReturns.filter((value) => value <= valueAtRisk95));
  const conditionalValueAtRisk99 = valueAtRisk99 === null ? null : mean(dailyReturns.filter((value) => value <= valueAtRisk99));
  const skewnessValue = skewness(dailyReturns);
  const excessKurtosisValue = excessKurtosis(dailyReturns);
  const rollingWindowTradingDays = 63;
  const rollingPoints = equityPoints.slice(-(rollingWindowTradingDays + 1));
  const rollingEquities = rollingPoints.map((point) => point.equity);
  const rollingRisk = rollingEquities.length < 2 ? null : calculateRiskAdjustedPerformance({
    ...simulation,
    initialCapital: rollingEquities[0]!,
    finalCapital: rollingEquities.at(-1)!,
    maxDrawdown: round(maxDrawdownFromEquities(rollingEquities) * 100),
    equityCurve: rollingPoints,
  });
  const positiveDailyReturns = dailyReturns.filter((value) => value > 0);
  const topFivePositiveDayReturnContribution = positiveDailyReturns.length === 0 ? null : ratio(
    positiveDailyReturns.slice().sort((left, right) => right - left).slice(0, 5).reduce((sum, value) => sum + value, 0),
    positiveDailyReturns.reduce((sum, value) => sum + value, 0),
  );
  const tradingDateIndex = new Map((context.tradingDates ?? []).map((date, index) => [date, index]));
  const holdingDays = completedTrades.map((trade) => {
    const entry = trade.entryDate ? tradingDateIndex.get(trade.entryDate) : undefined;
    const exit = trade.exitDate ? tradingDateIndex.get(trade.exitDate) : undefined;
    return entry === undefined || exit === undefined ? null : Math.max(1, exit - entry + 1);
  }).filter((value): value is number => value !== null);
  const rowByKey = new Map(candidateRows.map((row) => [`${row.date}::${row.stockCode}`, row]));
  const entryParticipationBps = simulation.trades.filter((trade) => trade.status === "filled" && trade.entryPrice !== null && trade.shares > 0).map((trade) => {
    const row = rowByKey.get(`${trade.signalDate}::${trade.stockCode}`);
    const amount = row?.nextDayDate ? context.priceByStockDate?.get(`${trade.stockCode}::${row.nextDayDate}`)?.amount ?? null : null;
    return amount === null || amount <= 0 ? null : (trade.entryPrice! * trade.shares) / (amount * 1_000) * 10_000;
  }).filter((value): value is number => value !== null && Number.isFinite(value));
  const totalTradedValue = simulation.trades.filter((trade) => trade.status === "filled").reduce((sum, trade) => sum + (trade.entryPrice ?? 0) * trade.shares + (trade.exitPrice ?? 0) * trade.shares, 0);
  const totalFees = simulation.trades.filter((trade) => trade.status === "filled").reduce((sum, trade) => sum + trade.totalFees, 0);
  const averageCapitalUtilization = mean(equityPoints.map((point) => point.equity <= 0 ? 0 : Math.max(0, (point.equity - point.cash) / point.equity)));
  const { maxDrawdownDurationTradingDays, longestRecoveryTradingDays } = calculateDrawdownDurations(equities);
  return {
    core: { cagr: riskAdjusted.annualizedReturn, totalReturn: simulation.totalReturn, maxDrawdown: simulation.maxDrawdown, sharpeRatio: riskAdjusted.sharpeRatio, sortinoRatio: riskAdjusted.sortinoRatio, calmarRatio: riskAdjusted.calmarRatio, ulcerIndex: riskAdjusted.ulcerIndex },
    tradeQuality: { winRate: simulation.winRate, profitFactor: simulation.profitFactor, expectancy: tradeReturnMean === null ? null : round(tradeReturnMean), averageWin: averageWin === null ? null : round(averageWin), averageLoss: averageLoss === null ? null : round(averageLoss), payoffRatio: averageWin === null || averageLoss === null || averageLoss === 0 ? null : round(Math.abs(averageWin / averageLoss), 3), maxConsecutiveLosses: maximumConsecutiveLosses, tradeCount: completedTrades.length },
    tailRisk: { valueAtRisk95: valueAtRisk95 === null ? null : round(valueAtRisk95 * 100, 2), conditionalValueAtRisk95: conditionalValueAtRisk95 === null ? null : round(conditionalValueAtRisk95 * 100, 2), valueAtRisk99: valueAtRisk99 === null ? null : round(valueAtRisk99 * 100, 2), conditionalValueAtRisk99: conditionalValueAtRisk99 === null ? null : round(conditionalValueAtRisk99 * 100, 2), skewness: skewnessValue === null ? null : round(skewnessValue, 3), excessKurtosis: excessKurtosisValue === null ? null : round(excessKurtosisValue, 3), worstDay: dailyReturns.length === 0 ? null : round(Math.min(...dailyReturns) * 100, 2), worstTrade: tradeReturns.length === 0 ? null : round(Math.min(...tradeReturns), 2) },
    stability: { profitableMonthRate: calculatePeriodProfitability(equityPoints, simulation.initialCapital, "month"), profitableYearRate: calculatePeriodProfitability(equityPoints, simulation.initialCapital, "year"), latestRollingSharpe: rollingRisk?.sharpeRatio ?? null, latestRollingCalmar: rollingRisk?.calmarRatio ?? null, latestRollingCagr: rollingRisk?.annualizedReturn ?? null, rollingWindowTradingDays, maxDrawdownDurationTradingDays, longestRecoveryTradingDays, topFivePositiveDayReturnContribution },
    tradingRealism: { totalFees: round(totalFees), modeledOneWaySlippageBps: simulation.assumptions.slippageBps, periodTurnoverToInitialCapital: simulation.initialCapital <= 0 ? null : round(totalTradedValue / simulation.initialCapital * 100, 1), averageHoldingTradingDays: mean(holdingDays) === null ? null : round(mean(holdingDays)!), averageCapitalUtilization: averageCapitalUtilization === null ? null : round(averageCapitalUtilization * 100, 1), averageOpenPositions: mean(equityPoints.map((point) => point.openPositions)) === null ? null : round(mean(equityPoints.map((point) => point.openPositions))!, 2), maxOpenPositions: simulation.peakOpenPositionCount, averageEntryParticipationBps: mean(entryParticipationBps) === null ? null : round(mean(entryParticipationBps)!), entryParticipationCoverageCount: entryParticipationBps.length },
  };
}

function readSignalPrice(row: LeaderCandidateBacktestRow, context: LeaderCandidateBacktestContext) {
  return context.priceByStockDate?.get(`${row.stockCode}::${row.date}`);
}

function adverseReturnLabel(row: LeaderCandidateBacktestRow, context: LeaderCandidateBacktestContext, observationDays: number) {
  const entryPrice = row.nextOpenPrice;
  const tradingDates = context.tradingDates ?? [];
  const startIndex = tradingDates.indexOf(row.nextDayDate);
  if (!entryPrice || entryPrice <= 0 || startIndex < 0) return { maxAdverseReturn: null, observedTradingDays: 0, usedLowPriceForLabel: false };

  let minObservedPrice = entryPrice;
  let observedTradingDays = 0;
  let usedLowPriceForLabel = true;
  for (let offset = 0; offset < observationDays; offset += 1) {
    const date = tradingDates[startIndex + offset];
    if (!date) return { maxAdverseReturn: null, observedTradingDays, usedLowPriceForLabel: false };
    const dailyPrice = context.priceByStockDate?.get(`${row.stockCode}::${date}`);
    const fallbackClose = dailyPrice?.closePrice ?? null;
    const observedPrice = dailyPrice?.lowPrice ?? fallbackClose;
    if (!observedPrice || observedPrice <= 0) return { maxAdverseReturn: null, observedTradingDays, usedLowPriceForLabel: false };
    if (!dailyPrice?.lowPrice) usedLowPriceForLabel = false;
    minObservedPrice = Math.min(minObservedPrice, observedPrice);
    observedTradingDays += 1;
  }

  return {
    maxAdverseReturn: round(((minObservedPrice - entryPrice) / entryPrice) * 100),
    observedTradingDays,
    usedLowPriceForLabel,
  };
}

function calculateRiskContributions(row: LeaderCandidateBacktestRow, context: LeaderCandidateBacktestContext) {  const time = row.limitUpTime ?? "";
  const amount = readSignalPrice(row, context)?.amount ?? null;
  return {
    boards: row.boards >= 4 ? 20 : row.boards === 3 ? 12 : row.boards === 2 ? 5 : 0,
    sectorCount: (row.sectorCount ?? 0) <= 1 ? 16 : (row.sectorCount ?? 0) === 2 ? 8 : 0,
    limitUpTime: !time ? 5 : time >= "14:30:00" ? 16 : time >= "13:30:00" ? 9 : 0,
    signalAmount: amount === null ? 7 : amount < 10_000 ? 12 : amount < 50_000 ? 6 : 0,
    marketCap: row.marketCapScore <= 4 ? 10 : row.marketCapScore <= 5 ? 6 : 0,
  } satisfies Record<string, number>;
}

function calculateRiskScore(row: LeaderCandidateBacktestRow, context: LeaderCandidateBacktestContext) {
  return Math.min(100, Object.values(calculateRiskContributions(row, context)).reduce((sum, value) => sum + value, 0));
}

function riskTier(riskScore: number): DownsideRiskProfile["riskTier"] {
  if (riskScore >= 65) return "高风险";
  if (riskScore >= 35) return "中风险";
  return "低风险";
}

/** 实时候选池与历史研究共用的信号日风险分；买入后行情仅用于事后标签，不参与本函数。 */
export function scoreDownsideRiskSignal(
  row: LeaderCandidateBacktestRow,
  context: LeaderCandidateBacktestContext,
): DownsideRiskSignalScore {
  const riskScore = calculateRiskScore(row, context);
  return { riskScore, riskTier: riskTier(riskScore) };
}

function applyRiskPenalty(profile: DownsideRiskProfile, penaltyWeight: number, omittedFeatureKey?: string): LeaderCandidateBacktestRow {
  const effectiveRiskScore = Math.max(0, profile.riskScore - (omittedFeatureKey ? profile.riskContributions[omittedFeatureKey] ?? 0 : 0));
  return { ...profile.row, score: Math.max(0, round(profile.row.score - effectiveRiskScore * penaltyWeight)) };
}

/**
 * 质量复合评分采用预先固定的信号日规则：候选强度68%、安全度32%，并为早封、题材共振和充足成交额提供小幅奖励。
 * 该分不读取T+1及后续价格，也不根据验证期结果调整系数。
 */
export function calculateQualityBlendScoreForRisk(row: LeaderCandidateBacktestRow, riskScore: number, context: LeaderCandidateBacktestContext) {
  const amount = readSignalPrice(row, context)?.amount ?? null;
  const earlySealBonus = row.limitUpTime !== null && row.limitUpTime !== undefined && row.limitUpTime <= "10:30:00" ? 2 : 0;
  const sectorBonus = (row.sectorCount ?? 0) >= 3 ? 2 : 0;
  const liquidityBonus = amount !== null && amount >= 50_000 ? 2 : 0;
  return Math.max(0, round(row.score * 0.68 + (100 - riskScore) * 0.32 + earlySealBonus + sectorBonus + liquidityBonus));
}

export function scoreQualityBlendSignal(row: LeaderCandidateBacktestRow, context: LeaderCandidateBacktestContext) {
  const { riskScore } = scoreDownsideRiskSignal(row, context);
  return { qualityScore: calculateQualityBlendScoreForRisk(row, riskScore, context), riskScore };
}

function calculateQualityBlendScore(profile: DownsideRiskProfile, context: LeaderCandidateBacktestContext) {
  return calculateQualityBlendScoreForRisk(profile.row, profile.riskScore, context);
}

function applyQualityBlend(profile: DownsideRiskProfile, context: LeaderCandidateBacktestContext): LeaderCandidateBacktestRow {
  return { ...profile.row, score: calculateQualityBlendScore(profile, context) };
}

/** 质量门控仅与同一信号日其他候选横向比较，所用中位数、风险分及字段均在信号日收盘后可知。 */
export function selectQualityGateProfileKeys(
  profiles: DownsideRiskProfile[],
  hardRiskThreshold: number,
  context: LeaderCandidateBacktestContext,
) {
  const profilesByDate = new Map<string, DownsideRiskProfile[]>();
  for (const profile of profiles) {
    const items = profilesByDate.get(profile.row.date) ?? [];
    items.push(profile);
    profilesByDate.set(profile.row.date, items);
  }
  const selected = new Set<string>();
  for (const items of Array.from(profilesByDate.values())) {
    const qualityScores = items.map((profile) => calculateQualityBlendScore(profile, context));
    const threshold = median(qualityScores);
    for (const profile of items) {
      if (threshold !== null && profile.riskScore < hardRiskThreshold && calculateQualityBlendScore(profile, context) >= threshold) {
        selected.add(`${profile.row.date}::${profile.row.stockCode}`);
      }
    }
  }
  return selected;
}

/** 供最新候选计划复用的质量门控：仅基于同一信号日已知字段及此前市场上下文。 */
export function selectQualityGateRowKeys(
  rows: LeaderCandidateBacktestRow[],
  hardRiskThreshold: number,
  context: LeaderCandidateBacktestContext,
) {
  const profiles = rows.map((row) => ({
    row,
    riskScore: scoreDownsideRiskSignal(row, context).riskScore,
  }));
  const profilesByDate = new Map<string, Array<{ row: LeaderCandidateBacktestRow; riskScore: number }>>();
  for (const profile of profiles) {
    const items = profilesByDate.get(profile.row.date) ?? [];
    items.push(profile);
    profilesByDate.set(profile.row.date, items);
  }
  const selected = new Set<string>();
  for (const items of Array.from(profilesByDate.values())) {
    const qualityScores = items.map(({ row, riskScore }) => calculateQualityBlendScoreForRisk(row, riskScore, context));
    const threshold = median(qualityScores);
    for (const { row, riskScore } of items) {
      if (threshold !== null && riskScore < hardRiskThreshold && calculateQualityBlendScoreForRisk(row, riskScore, context) >= threshold) {
        selected.add(`${row.date}::${row.stockCode}`);
      }
    }
  }
  return selected;
}

function buildExperiments(
  profiles: DownsideRiskProfile[],
  penaltyWeight: number,
  hardRiskThreshold: number,
  realisticOptions: RealisticBacktestOptions | undefined,
  context: LeaderCandidateBacktestContext,
  descriptionPrefix = "", // 手动权重路径
  source: ResearchSimulationSource = RESEARCH_LEGACY_SIMULATION_SOURCE,
): DownsideRiskExperimentItem[] {
  const rows = profiles.map((profile) => profile.row);
  const run = (key: DownsideRiskStrategyKey, label: string, description: string, experimentRows: LeaderCandidateBacktestRow[], excludedCandidateCount: number): DownsideRiskExperimentItem => {
    const realisticSimulation = source.simulate(experimentRows, realisticOptions, context.priceByStockDate, context.tradingDates);
    return { key, label, description, inputCandidateCount: experimentRows.length, excludedCandidateCount, realisticSimulation, riskAdjustedPerformance: calculateRiskAdjustedPerformance(realisticSimulation), strategyEvaluation: calculateStrategyEvaluation(realisticSimulation, context, experimentRows) };
  };
  const riskPenaltyRows = profiles.map((profile) => applyRiskPenalty(profile, penaltyWeight));
  const hardFilterRows = profiles.filter((profile) => profile.riskScore < hardRiskThreshold).map((profile) => profile.row);
  const qualityBlendRows = profiles.map((profile) => applyQualityBlend(profile, context));
  const qualityGateKeys = selectQualityGateProfileKeys(profiles, hardRiskThreshold, context);
  const qualityGateRows = profiles.filter((profile) => qualityGateKeys.has(`${profile.row.date}::${profile.row.stockCode}`)).map((profile) => applyQualityBlend(profile, context));
  return [
    run("baseline", "原始策略", "保留原始候选评分与完整观察期样本。", rows, 0),
    run("riskPenalty", "风险扣分策略", `${descriptionPrefix}候选分扣减 风险分 × ${penaltyWeight}，不删除候选。`, riskPenaltyRows, 0),
    run("hardFilter", "高风险硬过滤", `剔除风险分 ≥ ${hardRiskThreshold} 的候选。`, hardFilterRows, rows.length - hardFilterRows.length),
    run("qualityBlend", "质量复合评分", "预设68%原始候选强度 + 32%信号日安全度，并对早封、题材共振和充足成交额小幅奖励；不使用未来行情。", qualityBlendRows, 0),
    run("qualityGate", "质量门控策略", `仅保留质量复合分不低于当日中位数且风险分 < ${hardRiskThreshold} 的候选；门槛只使用同日横截面。`, qualityGateRows, rows.length - qualityGateRows.length),
  ];
}

function buildExperimentsWithWindowWeights(
  profiles: DownsideRiskProfile[],
  penaltyWeightByDate: Map<string, number>,
  fallbackPenaltyWeight: number,
  hardRiskThreshold: number,
  realisticOptions: RealisticBacktestOptions | undefined,
  context: LeaderCandidateBacktestContext,
  source: ResearchSimulationSource = RESEARCH_LEGACY_SIMULATION_SOURCE,
): DownsideRiskExperimentItem[] {
  const rows = profiles.map((profile) => profile.row);
  const run = (key: DownsideRiskStrategyKey, label: string, description: string, experimentRows: LeaderCandidateBacktestRow[], excludedCandidateCount: number): DownsideRiskExperimentItem => {
    const realisticSimulation = source.simulate(experimentRows, realisticOptions, context.priceByStockDate, context.tradingDates);
    return { key, label, description, inputCandidateCount: experimentRows.length, excludedCandidateCount, realisticSimulation, riskAdjustedPerformance: calculateRiskAdjustedPerformance(realisticSimulation), strategyEvaluation: calculateStrategyEvaluation(realisticSimulation, context, experimentRows) };
  };
  const riskPenaltyRows = profiles.map((profile) => applyRiskPenalty(profile, penaltyWeightByDate.get(profile.row.date) ?? fallbackPenaltyWeight));
  const hardFilterRows = profiles.filter((profile) => profile.riskScore < hardRiskThreshold).map((profile) => profile.row);
  const qualityBlendRows = profiles.map((profile) => applyQualityBlend(profile, context));
  const qualityGateKeys = selectQualityGateProfileKeys(profiles, hardRiskThreshold, context);
  const qualityGateRows = profiles.filter((profile) => qualityGateKeys.has(`${profile.row.date}::${profile.row.stockCode}`)).map((profile) => applyQualityBlend(profile, context));
  return [
    run("baseline", "原始策略", "保留原始候选评分与完整观察期样本。", rows, 0),
    run("riskPenalty", "风险扣分策略", "每个验证窗口仅使用其前置训练窗口自动选出的风险扣分权重。", riskPenaltyRows, 0),
    run("hardFilter", "高风险硬过滤", `剔除风险分 ≥ ${hardRiskThreshold} 的候选。`, hardFilterRows, rows.length - hardFilterRows.length),
    run("qualityBlend", "质量复合评分", "预设68%原始候选强度 + 32%信号日安全度，并对早封、题材共振和充足成交额小幅奖励；不使用未来行情。", qualityBlendRows, 0),
    run("qualityGate", "质量门控策略", `仅保留质量复合分不低于当日中位数且风险分 < ${hardRiskThreshold} 的候选；门槛只使用同日横截面。`, qualityGateRows, rows.length - qualityGateRows.length),
  ];
}

function toAblationMetric(simulation: RealisticBacktestResult, reference: RealisticBacktestResult): DownsideRiskAblationMetric {
  return {
    totalReturn: simulation.totalReturn,
    maxDrawdown: simulation.maxDrawdown,
    returnDelta: round(simulation.totalReturn - reference.totalReturn),
    drawdownDelta: round(simulation.maxDrawdown - reference.maxDrawdown),
    filledCount: simulation.filledCount,
  };
}

function buildFactorAblations(
  fullCycleProfiles: DownsideRiskProfile[],
  validationProfiles: DownsideRiskProfile[],
  fullCycleRiskPenalty: RealisticBacktestResult,
  validationRiskPenalty: RealisticBacktestResult,
  penaltyWeightByDate: Map<string, number>,
  fallbackPenaltyWeight: number,
  realisticOptions: RealisticBacktestOptions | undefined,
  context: LeaderCandidateBacktestContext,
  source: ResearchSimulationSource = RESEARCH_LEGACY_SIMULATION_SOURCE,
): DownsideRiskFactorAblation[] {
  const weightedRows = (profiles: DownsideRiskProfile[], omittedFeatureKey: string) => profiles.map((profile) => applyRiskPenalty(profile, penaltyWeightByDate.get(profile.row.date) ?? fallbackPenaltyWeight, omittedFeatureKey));
  return riskFeatures.map((feature) => {
    const fullCycleSimulation = source.simulate(weightedRows(fullCycleProfiles, feature.key), realisticOptions, context.priceByStockDate, context.tradingDates);
    const walkForwardSimulation = source.simulate(weightedRows(validationProfiles, feature.key), realisticOptions, context.priceByStockDate, context.tradingDates);
    const contributions = fullCycleProfiles.map((profile) => profile.riskContributions[feature.key] ?? 0).filter((value) => value > 0);
    return {
      key: feature.key,
      label: feature.label,
      affectedSignalCount: contributions.length,
      averageContribution: contributions.length === 0 ? 0 : round(contributions.reduce((sum, value) => sum + value, 0) / contributions.length),
      fullCycle: toAblationMetric(fullCycleSimulation, fullCycleRiskPenalty),
      walkForward: toAblationMetric(walkForwardSimulation, validationRiskPenalty),
    } satisfies DownsideRiskFactorAblation;
  });
}

function buildTradeDifferences(
  profiles: DownsideRiskProfile[],
  experiments: DownsideRiskExperimentItem[],
  penaltyWeightByDate: Map<string, number>,
  fallbackPenaltyWeight: number,
  hardRiskThreshold: number,
  context: LeaderCandidateBacktestContext,
): DownsideRiskTradeDifferenceRow[] {
  const profileByKey = new Map(profiles.map((profile) => [`${profile.row.date}::${profile.row.stockCode}`, profile]));
  const qualityGateKeys = selectQualityGateProfileKeys(profiles, hardRiskThreshold, context);
  const tradesByExperiment = new Map(experiments.map((experiment) => [
    experiment.key,
    new Map(experiment.realisticSimulation.trades.map((trade) => [`${trade.signalDate}::${trade.stockCode}`, trade])),
  ]));
  const snapshot = (trade: RealisticTrade | undefined): DownsideRiskTradeSnapshot | null => trade ? {
    status: trade.status,
    score: trade.score,
    shares: trade.shares,
    entryDate: trade.entryDate,
    exitDate: trade.exitDate,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    netReturn: trade.netReturn,
    reason: trade.reason,
  } : null;
  return Array.from(profileByKey.keys()).sort((left, right) => right.localeCompare(left)).map((key) => {
    const profile = profileByKey.get(key)!;
    return {
      signalDate: profile.row.date,
      stockCode: profile.row.stockCode,
      stockName: profile.row.stockName,
      riskScore: profile.riskScore,
      appliedPenaltyWeight: penaltyWeightByDate.get(profile.row.date) ?? fallbackPenaltyWeight,
      baseline: snapshot(tradesByExperiment.get("baseline")?.get(key)),
      riskPenalty: snapshot(tradesByExperiment.get("riskPenalty")?.get(key)),
      hardFilter: snapshot(tradesByExperiment.get("hardFilter")?.get(key)),
      qualityBlend: snapshot(tradesByExperiment.get("qualityBlend")?.get(key)),
      qualityGate: snapshot(tradesByExperiment.get("qualityGate")?.get(key)),
      hardFilterExcluded: profile.riskScore >= hardRiskThreshold,
      qualityGateExcluded: !qualityGateKeys.has(key),
    } satisfies DownsideRiskTradeDifferenceRow;
  });
}

function buildRiskPenaltyAttribution(
  profiles: DownsideRiskProfile[],
  experiments: DownsideRiskExperimentItem[],
  penaltyWeightByDate: Map<string, number>,
): DownsideRiskPenaltyAttribution {
  const tradesByExperiment = new Map(experiments.map((experiment) => [
    experiment.key,
    new Map(experiment.realisticSimulation.trades.map((trade) => [`${trade.signalDate}::${trade.stockCode}`, trade])),
  ]));
  const baselineTrades = tradesByExperiment.get("baseline")!;
  const riskPenaltyTrades = tradesByExperiment.get("riskPenalty")!;
  const keys = Array.from(new Set([...Array.from(baselineTrades.keys()), ...Array.from(riskPenaltyTrades.keys())]));
  const baselineOnly = keys.map((key) => baselineTrades.get(key)).filter((trade): trade is RealisticTrade => Boolean(trade && trade.status === "filled" && riskPenaltyTrades.get(`${trade.signalDate}::${trade.stockCode}`)?.status === "skipped"));
  const riskOnly = keys.map((key) => riskPenaltyTrades.get(key)).filter((trade): trade is RealisticTrade => Boolean(trade && trade.status === "filled" && baselineTrades.get(`${trade.signalDate}::${trade.stockCode}`)?.status === "skipped"));
  const common = keys.map((key) => ({ baseline: baselineTrades.get(key), riskPenalty: riskPenaltyTrades.get(key) })).filter((pair): pair is { baseline: RealisticTrade; riskPenalty: RealisticTrade } => pair.baseline?.status === "filled" && pair.riskPenalty?.status === "filled");
  return {
    baselineOnlyFilledCount: baselineOnly.length,
    riskPenaltyOnlyFilledCount: riskOnly.length,
    commonFilledCount: common.length,
    commonFilledDifferentReturnCount: common.filter(({ baseline, riskPenalty }) => baseline.netReturn !== riskPenalty.netReturn).length,
    baselineOnlyNetPnl: round(baselineOnly.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0)),
    riskPenaltyOnlyNetPnl: round(riskOnly.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0)),
    autoTunedSignalCount: profiles.filter((profile) => penaltyWeightByDate.has(profile.row.date)).length,
    fallbackWeightSignalCount: profiles.filter((profile) => !penaltyWeightByDate.has(profile.row.date)).length,
  };
}

function selectPenaltyWeight(
  trainingProfiles: DownsideRiskProfile[],
  realisticOptions: RealisticBacktestOptions | undefined,
  context: LeaderCandidateBacktestContext,
  source: ResearchSimulationSource = RESEARCH_LEGACY_SIMULATION_SOURCE,
) {
  const trials = penaltyWeightGrid.map((weight) => {
    const simulation = source.simulate(
      trainingProfiles.map((profile) => applyRiskPenalty(profile, weight)),
      realisticOptions,
      context.priceByStockDate,
      context.tradingDates,
    );
    return {
      penaltyWeight: weight,
      objectiveValue: round(simulation.totalReturn - simulation.maxDrawdown * 0.5, 4),
      totalReturn: simulation.totalReturn,
      maxDrawdown: simulation.maxDrawdown,
      completedCount: simulation.completedCount,
    } satisfies DownsideRiskWeightTrial;
  });
  const selected = [...trials].sort((left, right) => (
    right.objectiveValue - left.objectiveValue
    || right.totalReturn - left.totalReturn
    || left.maxDrawdown - right.maxDrawdown
    || right.completedCount - left.completedCount
    || left.penaltyWeight - right.penaltyWeight
  ))[0]!;
  return { selected, trials };
}

function buildRollingWindows(
  profiles: DownsideRiskProfile[],
  trainDays: number,
  validationDays: number,
  mediumDownsidePercent: number,
  penaltyWeight: number,
  autoTunePenaltyWeight: boolean,
  hardRiskThreshold: number,
  realisticOptions: RealisticBacktestOptions | undefined,
  context: LeaderCandidateBacktestContext,
  source: ResearchSimulationSource = RESEARCH_LEGACY_SIMULATION_SOURCE,
): { windows: DownsideRiskRollingWindow[]; penaltyWeightByDate: Map<string, number> } {
  const dates = Array.from(new Set(profiles.map((profile) => profile.row.date))).sort();
  const windows: DownsideRiskRollingWindow[] = [];
  const penaltyWeightByDate = new Map<string, number>();
  for (let validationStart = trainDays; validationStart + validationDays <= dates.length; validationStart += validationDays) {
    const calibrationDateSet = new Set(dates.slice(validationStart - trainDays, validationStart));
    const validationDateSet = new Set(dates.slice(validationStart, validationStart + validationDays));
    const trainingProfiles = profiles.filter((profile) => calibrationDateSet.has(profile.row.date) && profile.maxAdverseReturn !== null);
    const validationProfiles = profiles.filter((profile) => validationDateSet.has(profile.row.date) && profile.maxAdverseReturn !== null);
    const selection = autoTunePenaltyWeight
      ? selectPenaltyWeight(trainingProfiles, realisticOptions, context, source)
      : { selected: { penaltyWeight, objectiveValue: 0, totalReturn: 0, maxDrawdown: 0, completedCount: 0 }, trials: [] as DownsideRiskWeightTrial[] };
    validationDateSet.forEach((date) => penaltyWeightByDate.set(date, selection.selected.penaltyWeight));
    const experiments = buildExperiments(
      validationProfiles,
      selection.selected.penaltyWeight,
      hardRiskThreshold,
      realisticOptions,
      context,
      autoTunePenaltyWeight ? "训练窗口自动寻优后；" : "手动设定；",
      source,
    );
    const highDownsideCount = validationProfiles.filter((profile) => profile.maxAdverseReturn! <= -mediumDownsidePercent).length;
    windows.push({
      index: windows.length + 1,
      calibrationStartDate: dates[validationStart - trainDays],
      calibrationEndDate: dates[validationStart - 1],
      validationStartDate: dates[validationStart],
      validationEndDate: dates[validationStart + validationDays - 1],
      labeledSampleSize: validationProfiles.length,
      highDownsideRate: ratio(highDownsideCount, validationProfiles.length),
      autoTunedPenaltyWeight: selection.selected.penaltyWeight,
      trainingSampleSize: trainingProfiles.length,
      trainingObjectiveValue: selection.selected.objectiveValue,
      trainingTotalReturn: selection.selected.totalReturn,
      trainingMaxDrawdown: selection.selected.maxDrawdown,
      weightTrials: selection.trials,
      experiments: experiments.map(({ key, inputCandidateCount, excludedCandidateCount, realisticSimulation }) => ({ key, inputCandidateCount, excludedCandidateCount, realisticSimulation })),
    });
  }
  return { windows, penaltyWeightByDate };
}

function buildWalkForwardResult(
  experiments: DownsideRiskExperimentItem[],
  rollingWindows: DownsideRiskRollingWindow[],
): DownsideRiskWalkForwardResult | null {
  if (rollingWindows.length === 0 || experiments.length === 0) return null;
  const startDate = rollingWindows[0]!.validationStartDate;
  const completedExitDates = experiments.flatMap((experiment) => experiment.realisticSimulation.trades
    .filter((trade) => trade.status === "filled" && trade.netPnl !== null && trade.exitDate !== null)
    .map((trade) => trade.exitDate!));
  const endDate = [...completedExitDates, rollingWindows.at(-1)!.validationEndDate].sort().at(-1)!;
  const curveByExperiment = new Map(experiments.map((experiment) => [
    experiment.key,
    new Map(experiment.realisticSimulation.equityCurve
      .filter((point) => point.date >= startDate && point.date <= endDate)
      .map((point) => [point.date, point.equity])),
  ]));
  const dates = Array.from(new Set(experiments.flatMap((experiment) => experiment.realisticSimulation.equityCurve
    .filter((point) => point.date >= startDate && point.date <= endDate)
    .map((point) => point.date)))).sort();
  const initialCapitalByKey = new Map(experiments.map((experiment) => [experiment.key, experiment.realisticSimulation.initialCapital]));
  const returnAt = (key: DownsideRiskStrategyKey, date: string) => {
    const equity = curveByExperiment.get(key)?.get(date);
    const initialCapital = initialCapitalByKey.get(key);
    return equity === undefined || !initialCapital ? null : round(((equity / initialCapital) - 1) * 100);
  };

  return {
    definition: "按时间顺序合并各无重叠验证窗口的候选，并在同一连续资金账户内重新执行；每个信号日只使用其前置训练窗口选出的权重。窗口边界不重置资金或持仓，因此曲线为复利口径的整体样本外表现。",
    startDate,
    endDate,
    validationWindowCount: rollingWindows.length,
    experiments: experiments.map((experiment) => ({
      key: experiment.key,
      label: experiment.label,
      totalReturn: experiment.realisticSimulation.totalReturn,
      maxDrawdown: experiment.realisticSimulation.maxDrawdown,
      finalCapital: experiment.realisticSimulation.finalCapital,
      filledCount: experiment.realisticSimulation.filledCount,
      completedCount: experiment.realisticSimulation.completedCount,
      riskAdjustedPerformance: experiment.riskAdjustedPerformance,
      strategyEvaluation: experiment.strategyEvaluation,
    })),
    equityCurve: dates.map((date) => ({
      date,
      baseline: returnAt("baseline", date),
      riskPenalty: returnAt("riskPenalty", date),
      hardFilter: returnAt("hardFilter", date),
      qualityBlend: returnAt("qualityBlend", date),
      qualityGate: returnAt("qualityGate", date),
    })),
  };
}

function buildStrategyRobustness(
  fullCycleExperiments: DownsideRiskExperimentItem[],
  walkForward: DownsideRiskWalkForwardResult | null,
  rollingWindows: DownsideRiskRollingWindow[],
  profiles: DownsideRiskProfile[],
): DownsideRiskStrategyRobustness[] {
  const walkForwardByKey = new Map((walkForward?.experiments ?? []).map((experiment) => [experiment.key, experiment]));
  const profileByTradeKey = new Map(profiles.map((profile) => [`${profile.row.date}::${profile.row.stockCode}`, profile]));
  const selectedWeights = rollingWindows.map((window) => window.autoTunedPenaltyWeight);
  const trialObjectives = rollingWindows.flatMap((window) => window.weightTrials.map((trial) => trial.objectiveValue));
  return fullCycleExperiments.map((experiment) => {
    const outOfSample = walkForwardByKey.get(experiment.key);
    const fullCagr = experiment.strategyEvaluation.core.cagr;
    const outOfSampleCagr = outOfSample?.strategyEvaluation.core.cagr ?? null;
    const fullSharpe = experiment.strategyEvaluation.core.sharpeRatio;
    const outOfSampleSharpe = outOfSample?.strategyEvaluation.core.sharpeRatio ?? null;
    const environmentMap = new Map<string, number[]>();
    for (const trade of experiment.realisticSimulation.trades) {
      if (trade.status !== "filled" || trade.netReturn === null) continue;
      const phase = profileByTradeKey.get(`${trade.signalDate}::${trade.stockCode}`)?.row.phase ?? "未标注周期";
      environmentMap.set(phase, [...(environmentMap.get(phase) ?? []), trade.netReturn]);
    }
    const usesRollingPenaltyWeight = experiment.key === "riskPenalty";
    return {
      key: experiment.key,
      label: experiment.label,
      walkForwardOosSharpe: outOfSampleSharpe,
      walkForwardOosCagr: outOfSampleCagr,
      sharpeDecayRate: fullSharpe === null || fullSharpe === 0 || outOfSampleSharpe === null ? null : round((fullSharpe - outOfSampleSharpe) / Math.abs(fullSharpe) * 100, 1),
      cagrDecayRate: fullCagr === null || fullCagr === 0 || outOfSampleCagr === null ? null : round((fullCagr - outOfSampleCagr) / Math.abs(fullCagr) * 100, 1),
      parameterStability: {
        kind: usesRollingPenaltyWeight ? "rollingPenaltyWeight" : "fixed",
        distinctValueCount: usesRollingPenaltyWeight ? new Set(selectedWeights).size : 1,
        standardDeviation: usesRollingPenaltyWeight ? (sampleStandardDeviation(selectedWeights) === null ? null : round(sampleStandardDeviation(selectedWeights)! , 3)) : 0,
      },
      parameterSensitivity: usesRollingPenaltyWeight && trialObjectives.length > 0 ? {
        minimumTrainingObjective: round(Math.min(...trialObjectives), 4),
        maximumTrainingObjective: round(Math.max(...trialObjectives), 4),
        range: round(Math.max(...trialObjectives) - Math.min(...trialObjectives), 4),
      } : { minimumTrainingObjective: null, maximumTrainingObjective: null, range: null },
      marketEnvironments: Array.from(environmentMap.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([phase, returns]) => ({ phase, completedTradeCount: returns.length, averageTradeReturn: mean(returns) === null ? null : round(mean(returns)!) })),
    } satisfies DownsideRiskStrategyRobustness;
  });
}

/**
 * 风险分只读取候选信号日字段；买入后日内最低价路径只用于事后标签。滚动验证窗口的测试段严格位于校准段之后。
 */
export function buildDownsideRiskResearch(
  rows: LeaderCandidateBacktestRow[],
  options: DownsideRiskOptions | undefined,
  realisticOptions: RealisticBacktestOptions | undefined,
  context: LeaderCandidateBacktestContext,
  source: ResearchSimulationSource = RESEARCH_LEGACY_SIMULATION_SOURCE,
): DownsideRiskResearchResult {
  const observationDays = Math.min(10, Math.max(2, Math.floor(options?.observationDays ?? 5)));
  const mediumDownsidePercent = Math.min(50, Math.max(1, options?.mediumDownsidePercent ?? 4));
  const highDownsidePercent = Math.min(50, Math.max(mediumDownsidePercent, options?.highDownsidePercent ?? 8));
  const penaltyWeight = Math.min(1, Math.max(0, options?.penaltyWeight ?? defaultDownsideRiskPenaltyWeight));
  const autoTunePenaltyWeight = options?.autoTunePenaltyWeight ?? true;
  const hardRiskThreshold = Math.min(100, Math.max(0, options?.hardRiskThreshold ?? 65));
  const rollingTrainTradingDays = Math.min(150, Math.max(30, Math.floor(options?.rollingTrainTradingDays ?? 45)));
  const rollingValidationTradingDays = Math.min(60, Math.max(10, Math.floor(options?.rollingValidationTradingDays ?? 14)));
  const profiles = rows.map((row) => {
    const label = adverseReturnLabel(row, context, observationDays);
    const riskContributions = calculateRiskContributions(row, context);
    const riskScore = Math.min(100, Object.values(riskContributions).reduce((sum, value) => sum + value, 0));
    const profileRiskTier = riskTier(riskScore);
    return {
      row,
      riskScore,
      riskTier: profileRiskTier,
      riskContributions,
      ...label,
      mediumDownside: label.maxAdverseReturn === null ? null : label.maxAdverseReturn <= -mediumDownsidePercent,
      highDownside: label.maxAdverseReturn === null ? null : label.maxAdverseReturn <= -highDownsidePercent,
    } satisfies DownsideRiskProfile;
  });
  const rollingResult = buildRollingWindows(profiles, rollingTrainTradingDays, rollingValidationTradingDays, mediumDownsidePercent, penaltyWeight, autoTunePenaltyWeight, hardRiskThreshold, realisticOptions, context, source);
  const rollingWindows = rollingResult.windows;
  const evaluationDates = new Set(rollingWindows.flatMap((window) => {
    const allDates = context.tradingDates ?? [];
    return allDates.filter((date) => date >= window.validationStartDate && date <= window.validationEndDate);
  }));
  const labeledProfiles = profiles.filter((profile) => profile.maxAdverseReturn !== null && evaluationDates.has(profile.row.date));
  const fallbackProfiles = profiles.filter((profile) => profile.maxAdverseReturn !== null);
  const evaluationProfiles = labeledProfiles.length > 0 ? labeledProfiles : fallbackProfiles;
  const tiers: DownsideRiskProfile["riskTier"][] = ["低风险", "中风险", "高风险"];
  const riskTiers = tiers.map((tier) => {
    const tierProfiles = evaluationProfiles.filter((profile) => profile.riskTier === tier);
    const returns = tierProfiles.map((profile) => profile.maxAdverseReturn!);
    const mediumDownsideCount = tierProfiles.filter((profile) => profile.mediumDownside).length;
    const highDownsideCount = tierProfiles.filter((profile) => profile.highDownside).length;
    return {
      tier,
      sampleSize: tierProfiles.length,
      averageMaxAdverseReturn: returns.length === 0 ? null : round(returns.reduce((sum, value) => sum + value, 0) / returns.length),
      mediumDownsideCount,
      mediumDownsideRate: ratio(mediumDownsideCount, tierProfiles.length),
      highDownsideCount,
      highDownsideRate: ratio(highDownsideCount, tierProfiles.length),
    };
  });
  const lowPriceLabelSampleSize = evaluationProfiles.filter((profile) => profile.usedLowPriceForLabel).length;
  const signalAmountSampleSize = evaluationProfiles.filter((profile) => readSignalPrice(profile.row, context)?.amount !== null && readSignalPrice(profile.row, context)?.amount !== undefined).length;

  const experiments = autoTunePenaltyWeight && rollingWindows.length > 0
    ? buildExperimentsWithWindowWeights(evaluationProfiles, rollingResult.penaltyWeightByDate, penaltyWeight, hardRiskThreshold, realisticOptions, context, source)
    : buildExperiments(evaluationProfiles, penaltyWeight, hardRiskThreshold, realisticOptions, context, "手动设定；", source);
  const fullCycleExperiments = autoTunePenaltyWeight && rollingWindows.length > 0
    ? buildExperimentsWithWindowWeights(profiles, rollingResult.penaltyWeightByDate, penaltyWeight, hardRiskThreshold, realisticOptions, context, source)
    : buildExperiments(profiles, penaltyWeight, hardRiskThreshold, realisticOptions, context, "手动设定；", source);
  const fullCycleDates = Array.from(new Set(profiles.map((profile) => profile.row.date))).sort();
  const fullCycleTradeDifferences = buildTradeDifferences(profiles, fullCycleExperiments, rollingResult.penaltyWeightByDate, penaltyWeight, hardRiskThreshold, context);
  const fullCycleRiskPenaltyAttribution = buildRiskPenaltyAttribution(profiles, fullCycleExperiments, rollingResult.penaltyWeightByDate);
  const factorAblations = buildFactorAblations(
    profiles,
    evaluationProfiles,
    fullCycleExperiments.find((experiment) => experiment.key === "riskPenalty")!.realisticSimulation,
    experiments.find((experiment) => experiment.key === "riskPenalty")!.realisticSimulation,
    rollingResult.penaltyWeightByDate,
    penaltyWeight,
    realisticOptions,
    context,
    source,
  );
  const walkForward = buildWalkForwardResult(experiments, rollingWindows);
  const strategyRobustness = buildStrategyRobustness(fullCycleExperiments, walkForward, rollingWindows, profiles);

  return {
    simulator: {
      id: source.id,
      label: source.label,
      productionRuntime: source.productionRuntime,
      semantics: source.semantics,
    },
    definition: `风险分仅使用信号日可见字段；下行标签为T+1开盘后连续${observationDays}个实际交易日中最低价（缺失时降级为收盘价）相对T+1开盘价的最大不利波动。滚动验证的测试段严格位于前置${rollingTrainTradingDays}个交易日校准段之后。${autoTunePenaltyWeight ? "每个校准段在固定权重网格内按训练期收益减0.5倍最大回撤寻优，选中权重只用于其后验证段。" : "风险扣分权重使用手动设定值。"}`,
    observationDays,
    mediumDownsidePercent,
    highDownsidePercent,
    penaltyWeight,
    autoTunePenaltyWeight,
    penaltyWeightGrid,
    hardRiskThreshold,
    rollingTrainTradingDays,
    rollingValidationTradingDays,
    featureMatrix: riskFeatures,
    labeledSampleSize: evaluationProfiles.length,
    lowPriceLabelSampleSize,
    signalAmountSampleSize,
    riskTiers,
    experiments,
    rollingWindows,
    walkForward,
    factorAblations,
    strategyRobustness,
    fullCycle: {
      definition: autoTunePenaltyWeight && rollingWindows.length > 0
        ? "五种策略使用全部主板涨停股历史候选（不限连板高度）、相同资金、成本、仓位、入场和唯一退出约束连续回测。风险扣分在有前置训练窗口的日期使用该窗口选出的权重；首个训练段及未覆盖尾段使用手动回退权重，不以未来数据选权。质量复合与质量门控均只读取信号日数据。"
        : "五种策略使用全部主板涨停股历史候选（不限连板高度）、相同资金、成本、仓位、入场和唯一退出约束连续回测；风险扣分使用手动设定权重，质量复合与质量门控只读取信号日数据。",
      startDate: fullCycleDates[0] ?? null,
      endDate: fullCycleDates.at(-1) ?? null,
      experiments: fullCycleExperiments,
      tradeDifferences: fullCycleTradeDifferences,
      riskPenaltyAttribution: fullCycleRiskPenaltyAttribution,
    },
  };
}
