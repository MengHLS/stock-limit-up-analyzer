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
  key: "baseline" | "riskPenalty" | "hardFilter";
  label: string;
  description: string;
  inputCandidateCount: number;
  excludedCandidateCount: number;
  realisticSimulation: RealisticBacktestResult;
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
};

export type DownsideRiskWalkForwardResult = {
  definition: string;
  startDate: string | null;
  endDate: string | null;
  validationWindowCount: number;
  experiments: DownsideRiskWalkForwardExperiment[];
  equityCurve: Array<{ date: string; baseline: number | null; riskPenalty: number | null; hardFilter: number | null }>;
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
  hardFilterExcluded: boolean;
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
  riskTiers: DownsideRiskTierSummary[];
  experiments: DownsideRiskExperimentItem[];
  rollingWindows: DownsideRiskRollingWindow[];
  walkForward: DownsideRiskWalkForwardResult | null;
  fullCycle: DownsideRiskFullCycleResult;
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
];

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const ratio = (numerator: number, denominator: number) => denominator === 0 ? null : round((numerator / denominator) * 100, 1);
const penaltyWeightGrid = [0, 0.15, 0.35, 0.55, 0.75, 1];

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

function calculateRiskScore(row: LeaderCandidateBacktestRow, context: LeaderCandidateBacktestContext) {
  let score = 0;
  score += row.boards >= 4 ? 20 : row.boards === 3 ? 12 : row.boards === 2 ? 5 : 0;
  score += (row.sectorCount ?? 0) <= 1 ? 16 : (row.sectorCount ?? 0) === 2 ? 8 : 0;
  const time = row.limitUpTime ?? "";
  score += !time ? 5 : time >= "14:30:00" ? 16 : time >= "13:30:00" ? 9 : 0;
  const amount = readSignalPrice(row, context)?.amount ?? null;
  score += amount === null ? 7 : amount < 10_000 ? 12 : amount < 50_000 ? 6 : 0;
  score += row.marketCapScore <= 4 ? 10 : row.marketCapScore <= 5 ? 6 : 0;
  score += row.phase === "高位退潮" ? 24 : row.phase === "高位亢奋" ? 16 : row.phase === "高位分歧" ? 9 : 0;
  score += (row.maxBoards ?? 0) >= 6 ? 10 : (row.maxBoards ?? 0) >= 5 ? 6 : 0;
  score += row.score < 50 ? 8 : row.score < 60 ? 3 : 0;
  return Math.min(100, score);
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

function applyRiskPenalty(profile: DownsideRiskProfile, penaltyWeight: number): LeaderCandidateBacktestRow {
  return { ...profile.row, score: Math.max(0, round(profile.row.score - profile.riskScore * penaltyWeight)) };
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
  const run = (key: DownsideRiskExperimentItem["key"], label: string, description: string, experimentRows: LeaderCandidateBacktestRow[], excludedCandidateCount: number): DownsideRiskExperimentItem => ({
    key,
    label,
    description,
    inputCandidateCount: experimentRows.length,
    excludedCandidateCount,
    realisticSimulation: simulateRealisticTPlus1ToTPlus2(experimentRows, realisticOptions, context.priceByStockDate, context.tradingDates),
  });
  const riskPenaltyRows = profiles.map((profile) => applyRiskPenalty(profile, penaltyWeight));
  const hardFilterRows = profiles.filter((profile) => profile.riskScore < hardRiskThreshold).map((profile) => profile.row);
  return [
    run("baseline", "原始策略", "保留原始候选评分与完整观察期样本。", rows, 0),
    run("riskPenalty", "风险扣分策略", `${descriptionPrefix}候选分扣减 风险分 × ${penaltyWeight}，不删除候选。`, riskPenaltyRows, 0),
    run("hardFilter", "高风险硬过滤", `剔除风险分 ≥ ${hardRiskThreshold} 的候选。`, hardFilterRows, rows.length - hardFilterRows.length),
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
  const run = (key: DownsideRiskExperimentItem["key"], label: string, description: string, experimentRows: LeaderCandidateBacktestRow[], excludedCandidateCount: number): DownsideRiskExperimentItem => ({
    key,
    label,
    description,
    inputCandidateCount: experimentRows.length,
    excludedCandidateCount,
    realisticSimulation: simulateRealisticTPlus1ToTPlus2(experimentRows, realisticOptions, context.priceByStockDate, context.tradingDates),
  });
  const riskPenaltyRows = profiles.map((profile) => applyRiskPenalty(profile, penaltyWeightByDate.get(profile.row.date) ?? fallbackPenaltyWeight));
  const hardFilterRows = profiles.filter((profile) => profile.riskScore < hardRiskThreshold).map((profile) => profile.row);
  return [
    run("baseline", "原始策略", "保留原始候选评分与完整观察期样本。", rows, 0),
    run("riskPenalty", "风险扣分策略", "每个验证窗口仅使用其前置训练窗口自动选出的风险扣分权重。", riskPenaltyRows, 0),
    run("hardFilter", "高风险硬过滤", `剔除风险分 ≥ ${hardRiskThreshold} 的候选。`, hardFilterRows, rows.length - hardFilterRows.length),
  ];
}

function buildTradeDifferences(
  profiles: DownsideRiskProfile[],
  experiments: DownsideRiskExperimentItem[],
  penaltyWeightByDate: Map<string, number>,
  fallbackPenaltyWeight: number,
  hardRiskThreshold: number,
): DownsideRiskTradeDifferenceRow[] {
  const profileByKey = new Map(profiles.map((profile) => [`${profile.row.date}::${profile.row.stockCode}`, profile]));
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
      hardFilterExcluded: profile.riskScore >= hardRiskThreshold,
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
  const returnAt = (key: DownsideRiskExperimentItem["key"], date: string) => {
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
    })),
    equityCurve: dates.map((date) => ({
      date,
      baseline: returnAt("baseline", date),
      riskPenalty: returnAt("riskPenalty", date),
      hardFilter: returnAt("hardFilter", date),
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
  const rollingTrainTradingDays = Math.min(150, Math.max(30, Math.floor(options?.rollingTrainTradingDays ?? 90)));
  const rollingValidationTradingDays = Math.min(60, Math.max(10, Math.floor(options?.rollingValidationTradingDays ?? 30)));
  const profiles = rows.map((row) => {
    const label = adverseReturnLabel(row, context, observationDays);
    const { riskScore, riskTier: profileRiskTier } = scoreDownsideRiskSignal(row, context);
    return {
      row,
      riskScore,
      riskTier: profileRiskTier,
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

  const experiments = autoTunePenaltyWeight && rollingWindows.length > 0
    ? buildExperimentsWithWindowWeights(evaluationProfiles, rollingResult.penaltyWeightByDate, penaltyWeight, hardRiskThreshold, realisticOptions, context)
    : buildExperiments(evaluationProfiles, penaltyWeight, hardRiskThreshold, realisticOptions, context, "手动设定；");
  const fullCycleExperiments = autoTunePenaltyWeight && rollingWindows.length > 0
    ? buildExperimentsWithWindowWeights(profiles, rollingResult.penaltyWeightByDate, penaltyWeight, hardRiskThreshold, realisticOptions, context)
    : buildExperiments(profiles, penaltyWeight, hardRiskThreshold, realisticOptions, context, "手动设定；");
  const fullCycleDates = Array.from(new Set(profiles.map((profile) => profile.row.date))).sort();
  const fullCycleTradeDifferences = buildTradeDifferences(profiles, fullCycleExperiments, rollingResult.penaltyWeightByDate, penaltyWeight, hardRiskThreshold);
  const fullCycleRiskPenaltyAttribution = buildRiskPenaltyAttribution(profiles, fullCycleExperiments, rollingResult.penaltyWeightByDate);

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
    riskTiers,
    experiments,
    rollingWindows,
    walkForward: buildWalkForwardResult(experiments, rollingWindows),
    fullCycle: {
      definition: autoTunePenaltyWeight && rollingWindows.length > 0
        ? "三版策略使用全部主板1–4板历史候选、相同资金、成本、仓位、入场和唯一退出约束连续回测。风险扣分在有前置训练窗口的日期使用该窗口选出的权重；首个训练段及未覆盖尾段使用手动回退权重，不以未来数据选权。"
        : "三版策略使用全部主板1–4板历史候选、相同资金、成本、仓位、入场和唯一退出约束连续回测；风险扣分使用手动设定权重。",
      startDate: fullCycleDates[0] ?? null,
      endDate: fullCycleDates.at(-1) ?? null,
      experiments: fullCycleExperiments,
      tradeDifferences: fullCycleTradeDifferences,
      riskPenaltyAttribution: fullCycleRiskPenaltyAttribution,
    },
  };
}
