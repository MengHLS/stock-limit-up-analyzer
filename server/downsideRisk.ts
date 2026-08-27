import type { LeaderCandidateBacktestContext, LeaderCandidateBacktestRow } from "./leaderCandidates";
import { simulateRealisticTPlus1ToTPlus2, type RealisticBacktestOptions, type RealisticBacktestResult, type RealisticTrade } from "./realisticBacktest";

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
  marketLimitUpCountSampleSize: number;
  twoMarketTurnoverSampleSize: number;
  marginBalanceSampleSize: number;
  marginBalanceComparableSampleSize: number;
  riskTiers: DownsideRiskTierSummary[];
  experiments: DownsideRiskExperimentItem[];
  rollingWindows: DownsideRiskRollingWindow[];
  walkForward: DownsideRiskWalkForwardResult | null;
  fullCycle: DownsideRiskFullCycleResult;
  factorAblations: DownsideRiskFactorAblation[];
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
  { key: "phase", label: "情绪周期", definition: "信号日最高连板趋势所属阶段；高位退潮与亢奋阶段增加风险扣分。", timing: "信号日" },
  { key: "marketHeight", label: "市场高度", definition: "信号日主板最高连板数；高度拥挤时增加风险扣分。", timing: "信号日" },
  { key: "candidateScore", label: "原始候选分", definition: "原有龙头候选强度分；较低分增加风险扣分。", timing: "信号日" },
  { key: "marketLimitUpCount", label: "项目涨停数", definition: "信号日项目已录入的全表涨停记录数；≤40或≥120时轻度增加风险扣分，非交易所官方全市场口径。", timing: "信号日" },
  { key: "twoMarketTurnover", label: "沪深两市成交额", definition: "信号日Tushare daily汇总沪市与深市证券成交额（亿元）；<10000或≥25000时轻度增加风险扣分，不代表资金净流入。", timing: "信号日" },
  { key: "marginBalanceTrend", label: "两融余额偏离", definition: "信号日上交所与深交所公开文件汇总的两融余额，相对前20个已验证市场日期的中位数偏离超过2%时轻度增加风险扣分。", timing: "信号日" },
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
  const annualizedReturn = dailyReturns.length === 0 || simulation.initialCapital <= 0 || simulation.finalCapital <= 0
    ? null
    : (simulation.finalCapital / simulation.initialCapital) ** (riskAnnualizationTradingDays / dailyReturns.length) - 1;
  let peak = simulation.initialCapital;
  const drawdowns = equities.map((equity) => {
    peak = Math.max(peak, equity);
    return peak === 0 ? 0 : (equity / peak) - 1;
  });
  const ulcerIndex = drawdowns.length === 0 ? null : Math.sqrt(drawdowns.reduce((sum, drawdown) => sum + drawdown ** 2, 0) / drawdowns.length);
  const annualizedVolatility = dailyVolatility === null ? null : dailyVolatility * Math.sqrt(riskAnnualizationTradingDays);
  const annualizedDownsideDeviation = downsideDeviation === null ? null : downsideDeviation * Math.sqrt(riskAnnualizationTradingDays);
  const maxDrawdown = simulation.maxDrawdown / 100;
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
    sharpeRatio: annualizedReturn === null || !annualizedVolatility ? null : round(annualizedReturn / annualizedVolatility, 3),
    sortinoRatio: annualizedReturn === null || !annualizedDownsideDeviation ? null : round(annualizedReturn / annualizedDownsideDeviation, 3),
    calmarRatio: annualizedReturn === null || !maxDrawdown ? null : round(annualizedReturn / maxDrawdown, 3),
    ulcerIndex: ulcerIndex === null ? null : round(ulcerIndex * 100, 2),
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

function median(values: number[]) {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/** 仅以信号日前已验证的两融数据为基准，避免将后续两融余额带入当日评分。 */
function calculateMarginBalanceTrendContribution(row: LeaderCandidateBacktestRow, context: LeaderCandidateBacktestContext) {
  const currentFactor = context.marketFactorsByDate?.get(row.date);
  const current = currentFactor?.sourceIsVerified ? currentFactor.marginBalanceYi : null;
  if (current === null || current === undefined || current <= 0) return 0;
  const historical = Array.from(context.marketFactorsByDate?.entries() ?? [])
    .filter(([date, factor]) => date < row.date && factor.sourceIsVerified && factor.marginBalanceYi !== null && factor.marginBalanceYi !== undefined && factor.marginBalanceYi > 0)
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 20)
    .map(([, factor]) => factor.marginBalanceYi!);
  if (historical.length < 5) return 0;
  const baseline = median(historical);
  const deviation = (current - baseline) / baseline;
  return Math.abs(deviation) >= 0.02 ? 4 : 0;
}

function calculateRiskContributions(row: LeaderCandidateBacktestRow, context: LeaderCandidateBacktestContext) {
  const time = row.limitUpTime ?? "";
  const amount = readSignalPrice(row, context)?.amount ?? null;
  const marketFactor = context.marketFactorsByDate?.get(row.date);
  const limitUpCount = marketFactor?.limitUpCount ?? null;
  const turnoverYi = marketFactor?.sourceIsVerified ? marketFactor.turnoverYi : null;
  return {
    boards: row.boards >= 4 ? 20 : row.boards === 3 ? 12 : row.boards === 2 ? 5 : 0,
    sectorCount: (row.sectorCount ?? 0) <= 1 ? 16 : (row.sectorCount ?? 0) === 2 ? 8 : 0,
    limitUpTime: !time ? 5 : time >= "14:30:00" ? 16 : time >= "13:30:00" ? 9 : 0,
    signalAmount: amount === null ? 7 : amount < 10_000 ? 12 : amount < 50_000 ? 6 : 0,
    marketCap: row.marketCapScore <= 4 ? 10 : row.marketCapScore <= 5 ? 6 : 0,
    phase: row.phase === "高位退潮" ? 24 : row.phase === "高位亢奋" ? 16 : row.phase === "高位分歧" ? 9 : 0,
    marketHeight: (row.maxBoards ?? 0) >= 6 ? 10 : (row.maxBoards ?? 0) >= 5 ? 6 : 0,
    candidateScore: row.score < 50 ? 8 : row.score < 60 ? 3 : 0,
    marketLimitUpCount: limitUpCount === null ? 0 : limitUpCount <= 40 ? 5 : limitUpCount >= 120 ? 4 : 0,
    twoMarketTurnover: turnoverYi === null ? 0 : turnoverYi < 10_000 ? 4 : turnoverYi >= 25_000 ? 3 : 0,
    marginBalanceTrend: calculateMarginBalanceTrendContribution(row, context),
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
      if (profile.riskScore < hardRiskThreshold && calculateQualityBlendScore(profile, context) >= threshold) {
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
      if (riskScore < hardRiskThreshold && calculateQualityBlendScoreForRisk(row, riskScore, context) >= threshold) {
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
  descriptionPrefix = "",
): DownsideRiskExperimentItem[] {
  const rows = profiles.map((profile) => profile.row);
  const run = (key: DownsideRiskStrategyKey, label: string, description: string, experimentRows: LeaderCandidateBacktestRow[], excludedCandidateCount: number): DownsideRiskExperimentItem => {
    const realisticSimulation = simulateRealisticTPlus1ToTPlus2(experimentRows, realisticOptions, context.priceByStockDate, context.tradingDates);
    return { key, label, description, inputCandidateCount: experimentRows.length, excludedCandidateCount, realisticSimulation, riskAdjustedPerformance: calculateRiskAdjustedPerformance(realisticSimulation) };
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
): DownsideRiskExperimentItem[] {
  const rows = profiles.map((profile) => profile.row);
  const run = (key: DownsideRiskStrategyKey, label: string, description: string, experimentRows: LeaderCandidateBacktestRow[], excludedCandidateCount: number): DownsideRiskExperimentItem => {
    const realisticSimulation = simulateRealisticTPlus1ToTPlus2(experimentRows, realisticOptions, context.priceByStockDate, context.tradingDates);
    return { key, label, description, inputCandidateCount: experimentRows.length, excludedCandidateCount, realisticSimulation, riskAdjustedPerformance: calculateRiskAdjustedPerformance(realisticSimulation) };
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
): DownsideRiskFactorAblation[] {
  const weightedRows = (profiles: DownsideRiskProfile[], omittedFeatureKey: string) => profiles.map((profile) => applyRiskPenalty(profile, penaltyWeightByDate.get(profile.row.date) ?? fallbackPenaltyWeight, omittedFeatureKey));
  return riskFeatures.map((feature) => {
    const fullCycleSimulation = simulateRealisticTPlus1ToTPlus2(weightedRows(fullCycleProfiles, feature.key), realisticOptions, context.priceByStockDate, context.tradingDates);
    const walkForwardSimulation = simulateRealisticTPlus1ToTPlus2(weightedRows(validationProfiles, feature.key), realisticOptions, context.priceByStockDate, context.tradingDates);
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
) {
  const trials = penaltyWeightGrid.map((weight) => {
    const simulation = simulateRealisticTPlus1ToTPlus2(
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
      ? selectPenaltyWeight(trainingProfiles, realisticOptions, context)
      : { selected: { penaltyWeight, objectiveValue: 0, totalReturn: 0, maxDrawdown: 0, completedCount: 0 }, trials: [] as DownsideRiskWeightTrial[] };
    validationDateSet.forEach((date) => penaltyWeightByDate.set(date, selection.selected.penaltyWeight));
    const experiments = buildExperiments(
      validationProfiles,
      selection.selected.penaltyWeight,
      hardRiskThreshold,
      realisticOptions,
      context,
      autoTunePenaltyWeight ? "训练窗口自动寻优后；" : "手动设定；",
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

/**
 * 风险分只读取候选信号日字段；买入后日内最低价路径只用于事后标签。滚动验证窗口的测试段严格位于校准段之后。
 */
export function buildDownsideRiskResearch(
  rows: LeaderCandidateBacktestRow[],
  options: DownsideRiskOptions | undefined,
  realisticOptions: RealisticBacktestOptions | undefined,
  context: LeaderCandidateBacktestContext,
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
  const rollingResult = buildRollingWindows(profiles, rollingTrainTradingDays, rollingValidationTradingDays, mediumDownsidePercent, penaltyWeight, autoTunePenaltyWeight, hardRiskThreshold, realisticOptions, context);
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
  const marketLimitUpCountSampleSize = evaluationProfiles.filter((profile) => {
    const value = context.marketFactorsByDate?.get(profile.row.date)?.limitUpCount;
    return value !== null && value !== undefined;
  }).length;
  const twoMarketTurnoverSampleSize = evaluationProfiles.filter((profile) => {
    const value = context.marketFactorsByDate?.get(profile.row.date)?.turnoverYi;
    return value !== null && value !== undefined;
  }).length;
  const marginBalanceSampleSize = evaluationProfiles.filter((profile) => {
    const value = context.marketFactorsByDate?.get(profile.row.date)?.marginBalanceYi;
    return value !== null && value !== undefined;
  }).length;
  const marginBalanceComparableSampleSize = evaluationProfiles.filter((profile) => calculateMarginBalanceTrendContribution(profile.row, context) > 0 || Array.from(context.marketFactorsByDate?.entries() ?? []).filter(([date, factor]) => date < profile.row.date && factor.sourceIsVerified && factor.marginBalanceYi !== null && factor.marginBalanceYi !== undefined).length >= 5).length;

  const experiments = autoTunePenaltyWeight && rollingWindows.length > 0
    ? buildExperimentsWithWindowWeights(evaluationProfiles, rollingResult.penaltyWeightByDate, penaltyWeight, hardRiskThreshold, realisticOptions, context)
    : buildExperiments(evaluationProfiles, penaltyWeight, hardRiskThreshold, realisticOptions, context, "手动设定；");
  const fullCycleExperiments = autoTunePenaltyWeight && rollingWindows.length > 0
    ? buildExperimentsWithWindowWeights(profiles, rollingResult.penaltyWeightByDate, penaltyWeight, hardRiskThreshold, realisticOptions, context)
    : buildExperiments(profiles, penaltyWeight, hardRiskThreshold, realisticOptions, context, "手动设定；");
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
  );

  return {
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
    marketLimitUpCountSampleSize,
    twoMarketTurnoverSampleSize,
    marginBalanceSampleSize,
    marginBalanceComparableSampleSize,
    riskTiers,
    experiments,
    rollingWindows,
    walkForward: buildWalkForwardResult(experiments, rollingWindows),
    factorAblations,
    fullCycle: {
      definition: autoTunePenaltyWeight && rollingWindows.length > 0
        ? "五种策略使用全部主板1–4板历史候选、相同资金、成本、仓位、入场和唯一退出约束连续回测。风险扣分在有前置训练窗口的日期使用该窗口选出的权重；首个训练段及未覆盖尾段使用手动回退权重，不以未来数据选权。质量复合与质量门控均只读取信号日数据。"
        : "五种策略使用全部主板1–4板历史候选、相同资金、成本、仓位、入场和唯一退出约束连续回测；风险扣分使用手动设定权重，质量复合与质量门控只读取信号日数据。",
      startDate: fullCycleDates[0] ?? null,
      endDate: fullCycleDates.at(-1) ?? null,
      experiments: fullCycleExperiments,
      tradeDifferences: fullCycleTradeDifferences,
      riskPenaltyAttribution: fullCycleRiskPenaltyAttribution,
    },
  };
}
