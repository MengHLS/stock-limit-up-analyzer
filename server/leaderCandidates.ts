import type { SentimentCyclePhase } from "./sentimentCycle";
import { buildLatestStockNameMap, normalizeSectorName } from "../shared/stockDataNormalization";
import { buildDownsideRiskResearch, calculateQualityBlendScoreForRisk, defaultDownsideRiskPenaltyWeight, scoreDownsideRiskSignal, type DownsideRiskExperimentItem, type DownsideRiskOptions, type DownsideRiskResearchResult, type DownsideRiskStrategyKey } from "./downsideRisk";
import { simulateRealisticTPlus1ToTPlus2, type RealisticBacktestOptions, type RealisticBacktestResult } from "./realisticBacktest";
import { computeTechnicalFactorValues, evaluateFactorEffectiveness } from "./technicalFactors";
import type { FactorEffectivenessReport, TechnicalFactorKey } from "./technicalFactors";
import { buildFactorNeutralizationReport } from "./factorCombination";
import type { FactorNeutralizationReport } from "./factorCombination";
import { buildOverfittingGuardReport } from "./overfittingGuard";
import type { OverfittingGuardReport } from "./overfittingGuard";
import { buildFinalVerdict } from "./factorScore";
import type { FinalVerdict } from "./factorScore";

export type LeaderCandidateSourceRecord = {
  stockCode: string;
  stockName: string;
  limitUpDate: string;
  limitUpTime: string | null;
  sector: string | null;
  turnover: string | null;
  circulationValue: string | null;
};

export type LeaderCandidateTrajectoryPoint = {
  date: string;
  boards: number;
};

export type LeaderCandidate = {
  rank: number;
  stockCode: string;
  stockName: string;
  sector: string;
  boards: number;
  sectorCount: number;
  score: number;
  riskScore: number;
  riskTier: "低风险" | "中风险" | "高风险";
  riskPenalty: number;
  netScore: number;
  limitUpTime: string | null;
  turnover: string | null;
  circulationValue: string | null;
  marketCapScore: number;
  marketCapLabel: string;
  reasons: string[];
  riskTags: string[];
  trajectory: LeaderCandidateTrajectoryPoint[];
};

export type LeaderCandidateResult = {
  date: string | null;
  totalMainBoardLimitUps: number;
  maxBoards: number;
  strongSectors: Array<{ sector: string; count: number }>;
  /** 当日全部可评分主板涨停股（不限连板高度，含首板与四板以上），不受重点候选准入或展示上限影响。 */
  allScoredStocks: LeaderCandidate[];
  candidates: LeaderCandidate[];
};

export type LeaderCandidateBacktestRow = Pick<LeaderCandidate, "stockCode" | "stockName" | "sector" | "boards" | "score" | "circulationValue" | "marketCapScore"> & {
  sectorCount?: number;
  limitUpTime?: string | null;
  turnover?: string | null;
  /** 信号日可见的下行风险字段；不参与既有原始评分阈值与排序。 */
  riskScore?: number;
  riskTier?: "低风险" | "中风险" | "高风险";
  riskPenalty?: number;
  netScore?: number;
  date: string;
  nextDate: string;
  nextDayDate: string;
  secondDayDate: string | null;
  success: boolean;
  signalClosePrice: number | null;
  nextOpenPrice: number | null;
  nextClosePrice: number | null;
  nextOpenPremium: number | null;
  nextClosePremium: number | null;
  secondDayOpenPrice: number | null;
  secondDayClosePrice: number | null;
  secondDayOpenPremium: number | null;
  secondDayClosePremium: number | null;
  tPlus1CloseToTPlus2CloseReturn: number | null;
  tPlus1CloseToTPlus2CloseSuccess: boolean | null;
  phase: SentimentCyclePhase | null;
  maxBoards: number | null;
  /** 信号日次一市场交易日即停牌（当日无法卖出），T+1/T+2 溢价不可用。 */
  suspendedAfterSignal?: boolean;
  /** 复牌后首个可交易日（涨停后停牌样本的有效离场观察日）。 */
  resumeDate?: string | null;
  /** 复牌首日相对信号日收盘的开盘溢价（%）。 */
  resumeOpenPremium?: number | null;
  /** 复牌首日相对信号日收盘的收盘溢价（%）。 */
  resumeClosePremium?: number | null;
  /** 信号日技术面因子值（换手率/量比/振幅），严格 point-in-time，缺失时为 null。 */
  technicalFactors?: Record<TechnicalFactorKey, number | null>;
};

export type LeaderCandidateScoreBand = {
  label: string;
  minScore: number;
  maxScore: number | null;
  sampleSize: number;
  successCount: number;
  successRate: number | null;
  premium: LeaderCandidatePremiumSummary;
  tPlus2Premium: LeaderCandidatePremiumSummary;
};

export type LeaderCandidatePremiumSummary = {
  /** 至少有开盘或收盘一项价格的去重样本数。 */
  sampleSize: number;
  openSampleSize: number;
  closeSampleSize: number;
  averageOpenPremium: number | null;
  averageClosePremium: number | null;
  openPremiumPositiveCount: number;
  openPremiumPositiveRate: number | null;
  closePremiumPositiveCount: number;
  closePremiumPositiveRate: number | null;
};

export type LeaderCandidateExitSummary = {
  sampleSize: number;
  successCount: number;
  successRate: number | null;
  averageReturn: number | null;
  positiveReturnCount: number;
  positiveReturnRate: number | null;
};

export type LeaderCandidateBacktestResult = {
  definition: string;
  observationDays: 1 | 2;
  appliedMinScore: number | null;
  totalSamples: number;
  successCount: number;
  successRate: number | null;
  scoreBands: LeaderCandidateScoreBand[];
  recommendedMinScore: number | null;
  calibrationSampleSize: number;
  calibrationPeriod: { startDate: string | null; endDate: string | null };
  outOfSample: { sampleSize: number; successCount: number; successRate: number | null };
  premium: LeaderCandidatePremiumSummary;
  outOfSamplePremium: LeaderCandidatePremiumSummary;
  tPlus2Premium: LeaderCandidatePremiumSummary;
  outOfSampleTPlus2Premium: LeaderCandidatePremiumSummary;
  tPlus1CloseToTPlus2Close: LeaderCandidateExitSummary;
  outOfSampleTPlus1CloseToTPlus2Close: LeaderCandidateExitSummary;
  resumeDayExit: LeaderCandidateExitSummary;
  outOfSampleResumeDayExit: LeaderCandidateExitSummary;
  outOfSampleScoreBands: LeaderCandidateScoreBand[];
  phaseFunnel: LeaderCandidatePhaseFunnelItem[];
  historicalRows: LeaderCandidateBacktestRow[];
  realisticSimulation: RealisticBacktestResult;
  downsideRiskResearch: DownsideRiskResearchResult;
  dailyPriceCoverage: LeaderCandidateDailyPriceCoverage;
  marketFactorCoverage: LeaderCandidateMarketFactorCoverage;
  strategyPortfolioSnapshot: LeaderCandidateStrategyPortfolioSnapshot;
  /** 技术面因子有效性三件套评估（RankIC/IC_IR、分位数分层单调性、阶段 IC 稳定性）。 */
  factorEvaluation: FactorEffectivenessReport;
  /** 因子组合与筛选：相关性矩阵、高相关去重建议、标准化+市值中性化后的技术因子。 */
  factorCombination: FactorNeutralizationReport;
  /** 过拟合防护：Deflated Sharpe（按参数搜索次数校正）。 */
  overfittingGuard: OverfittingGuardReport;
  /** 最终结论：逐因子评分与评级 + 策略过拟合风险 + 策略质量（可配置权重）。 */
  finalVerdict: FinalVerdict;
};

export type LeaderCandidatePortfolioHolding = {
  stockCode: string;
  stockName: string;
  sector: string;
  signalDate: string;
  entryDate: string | null;
  entryPrice: number | null;
  shares: number;
  score: number;
  valuationDate: string | null;
  valuationPrice: number | null;
  priceChangePercent: number | null;
  reason: string | null;
};

export type LeaderCandidatePreparedBuy = {
  rank: number;
  stockCode: string;
  stockName: string;
  sector: string;
  boards: number;
  signalDate: string;
  score: number;
  riskScore: number;
  riskTier: "低风险" | "中风险" | "高风险";
  strategyScore: number;
  reasons: string[];
  conditions: string[];
};

export type LeaderCandidateStrategyPortfolio = {
  key: DownsideRiskStrategyKey;
  label: string;
  description: string;
  asOfDate: string | null;
  availableCash: number;
  maxPositions: number;
  openPositionCount: number;
  availableSlots: number;
  currentHoldings: LeaderCandidatePortfolioHolding[];
  preparedBuys: LeaderCandidatePreparedBuy[];
  candidateCount: number;
  excludedHighRiskCount: number;
  note: string;
};

export type LeaderCandidateStrategyPortfolioSnapshot = {
  asOfDate: string | null;
  latestSignalDate: string | null;
  nextEntryTiming: string;
  definition: string;
  strategies: LeaderCandidateStrategyPortfolio[];
};

export type LeaderCandidateBacktestOptions = {
  observationDays?: 1 | 2;
  minScore?: number;
  realistic?: RealisticBacktestOptions;
  downsideRisk?: DownsideRiskOptions;
};

export type LeaderCandidatePhaseFunnelItem = {
  phase: SentimentCyclePhase;
  sampleSize: number;
  successCount: number;
  successRate: number | null;
  maxBoards: number | null;
};

export type LeaderCandidateBacktestContext = {
  phaseByDate?: Map<string, { phase: SentimentCyclePhase; maxBoards: number }>;
  priceByStockDate?: Map<string, LeaderCandidateDailyPrice>;
  dailyPriceCoverage?: LeaderCandidateDailyPriceCoverage;
  /** 每个候选仅读取自身信号日对应的市场记录，不能以T+1或后续记录代替。 */
  marketFactorsByDate?: Map<string, LeaderCandidateMarketFactors>;
  /** 由日线行情提供的完整实际交易日序列；价格回测不使用自然日推算。 */
  tradingDates?: string[];
  /** 股票代码 → 停牌交易日集合，用于识别涨停后停牌样本并改以复牌首日计算离场收益。 */
  suspendedDatesByStock?: Map<string, Set<string>>;
};

export type LeaderCandidateMarketFactors = {
  /** 项目已录入的当日涨停记录数，并非交易所官方口径。 */
  limitUpCount: number | null;
  /** 仅接受Tushare daily聚合得到的沪深两市成交额（亿元）。 */
  turnoverYi: number | null;
  /** 仅接受上交所和深交所公开文件汇总得到的两融余额（亿元）。 */
  marginBalanceYi: number | null;
  sourceIsVerified: boolean;
};

export type LeaderCandidateMarketFactorCoverage = {
  signalDateCount: number;
  limitUpCountDateCount: number;
  turnoverDateCount: number;
  marginBalanceDateCount: number;
  verifiedMarketDataDateCount: number;
  startDate: string | null;
  endDate: string | null;
};

export type LeaderCandidateDailyPrice = {
  openPrice: number | null;
  closePrice: number | null;
  highPrice?: number | null;
  lowPrice?: number | null;
  amount?: number | null;
  volume?: number | null;
  preClosePrice?: number | null;
};

export type LeaderCandidateDailyPriceCoverage = {
  rowCount: number;
  stockCount: number;
  startDate: string | null;
  endDate: string | null;
  highPriceCount: number;
  lowPriceCount: number;
  amountCount: number;
  volumeCount: number;
};

export type LeaderCandidateDailyPriceRow = {
  stockCode: string;
  tradeDate: string;
  openPrice: string | number | null;
  closePrice: string | number | null;
  highPrice?: string | number | null;
  lowPrice?: string | number | null;
  amount?: string | number | null;
  volume?: string | number | null;
  preClosePrice?: string | number | null;
};

/** 保留开盘或收盘任一有效价格；只有两项都无效时才丢弃该交易日记录。 */
export function buildLeaderCandidateDailyPriceMap(rows: LeaderCandidateDailyPriceRow[]): Map<string, LeaderCandidateDailyPrice> {
  const map = new Map<string, LeaderCandidateDailyPrice>();
  const toPositiveNumber = (value: string | number | null | undefined) => {
    const parsed = value === null || value === undefined ? null : Number(value);
    return parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const toNonNegativeNumber = (value: string | number | null | undefined) => {
    const parsed = value === null || value === undefined ? null : Number(value);
    return parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  for (const row of rows) {
    const openPrice = toPositiveNumber(row.openPrice);
    const closePrice = toPositiveNumber(row.closePrice);
    if (openPrice === null && closePrice === null) continue;
    map.set(`${row.stockCode}::${row.tradeDate}`, {
      openPrice,
      closePrice,
      highPrice: toPositiveNumber(row.highPrice),
      lowPrice: toPositiveNumber(row.lowPrice),
      amount: toNonNegativeNumber(row.amount),
      volume: toNonNegativeNumber(row.volume),
      preClosePrice: toPositiveNumber(row.preClosePrice),
    });
  }
  return map;
}

type LeaderCandidateBuildOptions = {
  candidateLimit?: number | null;
  stockNameByCode?: Map<string, string>;
  phaseByDate?: Map<string, { phase: SentimentCyclePhase; maxBoards: number }>;
  priceByStockDate?: Map<string, LeaderCandidateDailyPrice>;
  marketFactorsByDate?: Map<string, LeaderCandidateMarketFactors>;
  riskPenaltyWeight?: number;
};

function isMainBoardStock(stockCode: string) {
  return !/^(300|301|688|920)/.test(stockCode);
}

function parseNumeric(value: string | null) {
  if (!value) return 0;
  const parsed = Number.parseFloat(value.replace(/[亿元,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeToMinutes(time: string | null) {
  if (!time) return null;
  const match = time.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTurnover(turnover: string | null) {
  return turnover?.trim() ? `${turnover}亿元` : null;
}

/** 流通市值以亿元计；中等市值兼具承接容量与弹性，因此给予较高权重。 */
function calculateMarketCapScore(circulationValue: string | null) {
  const marketCap = parseNumeric(circulationValue);
  if (marketCap <= 0) return { score: 0, label: "市值缺失" };
  if (marketCap < 20) return { score: 4, label: "小盘弹性" };
  if (marketCap < 80) return { score: 12, label: "弹性容量均衡" };
  if (marketCap <= 200) return { score: 16, label: "容量最优区间" };
  if (marketCap <= 500) return { score: 10, label: "大盘承接" };
  return { score: 5, label: "超大盘弹性偏低" };
}

function percent(successCount: number, sampleSize: number) {
  if (sampleSize === 0) return null;
  return Number(((successCount / sampleSize) * 100).toFixed(1));
}

function premiumPercent(baseClosePrice: number | null | undefined, laterPrice: number | null | undefined) {
  if (!baseClosePrice || !laterPrice || baseClosePrice <= 0 || laterPrice <= 0) return null;
  return Number((((laterPrice - baseClosePrice) / baseClosePrice) * 100).toFixed(2));
}

function calculatePremiumSummary(rows: LeaderCandidateBacktestRow[], openField: "nextOpenPremium" | "secondDayOpenPremium" = "nextOpenPremium", closeField: "nextClosePremium" | "secondDayClosePremium" = "nextClosePremium"): LeaderCandidatePremiumSummary {
  const openPremiums = rows.map((row) => row[openField]).filter((value): value is number => value !== null);
  const closePremiums = rows.map((row) => row[closeField]).filter((value): value is number => value !== null);
  const sampleRows = rows.filter((row) => row[openField] !== null || row[closeField] !== null);
  const openPremiumPositiveCount = openPremiums.filter((value) => value > 0).length;
  const closePremiumPositiveCount = closePremiums.filter((value) => value > 0).length;
  const average = (values: number[]) => values.length === 0
    ? null
    : Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));

  return {
    sampleSize: sampleRows.length,
    openSampleSize: openPremiums.length,
    closeSampleSize: closePremiums.length,
    averageOpenPremium: average(openPremiums),
    averageClosePremium: average(closePremiums),
    openPremiumPositiveCount,
    openPremiumPositiveRate: percent(openPremiumPositiveCount, openPremiums.length),
    closePremiumPositiveCount,
    closePremiumPositiveRate: percent(closePremiumPositiveCount, closePremiums.length),
  };
}

function calculateExitSummary(rows: LeaderCandidateBacktestRow[]): LeaderCandidateExitSummary {
  const exitRows = rows.filter((row) => row.tPlus1CloseToTPlus2CloseReturn !== null);
  const returns = exitRows.map((row) => row.tPlus1CloseToTPlus2CloseReturn!);
  const positiveReturnCount = returns.filter((value) => value > 0).length;
  const averageReturn = returns.length === 0
    ? null
    : Number((returns.reduce((total, value) => total + value, 0) / returns.length).toFixed(2));
  return {
    sampleSize: exitRows.length,
    successCount: positiveReturnCount,
    successRate: percent(positiveReturnCount, exitRows.length),
    averageReturn,
    positiveReturnCount,
    positiveReturnRate: percent(positiveReturnCount, exitRows.length),
  };
}

/** 仅统计「涨停后停牌」样本的复牌首日离场收益。 */
function calculateResumeExitSummary(rows: LeaderCandidateBacktestRow[]): LeaderCandidateExitSummary {
  const resumeRows = rows.filter((row) => row.suspendedAfterSignal && row.resumeClosePremium !== null);
  const returns = resumeRows.map((row) => row.resumeClosePremium!);
  const positiveReturnCount = returns.filter((value) => value > 0).length;
  const averageReturn = returns.length === 0
    ? null
    : Number((returns.reduce((total, value) => total + value, 0) / returns.length).toFixed(2));
  return {
    sampleSize: resumeRows.length,
    successCount: positiveReturnCount,
    successRate: percent(positiveReturnCount, resumeRows.length),
    averageReturn,
    positiveReturnCount,
    positiveReturnRate: percent(positiveReturnCount, resumeRows.length),
  };
}

/**
 * 仅使用 targetDate 当日及以前的记录构建候选，确保历史回测的每个信号不读取未来数据。
 */
export function buildLeaderCandidatesForDate(
  records: LeaderCandidateSourceRecord[],
  targetDate: string,
  options: LeaderCandidateBuildOptions = {},
): LeaderCandidateResult {
  const recordsAsOfDate = records.filter((record) => record.limitUpDate <= targetDate);
  const stockNameByCode = options.stockNameByCode ?? buildLatestStockNameMap(records);
  if (recordsAsOfDate.length === 0) {
    return { date: null, totalMainBoardLimitUps: 0, maxBoards: 0, strongSectors: [], allScoredStocks: [], candidates: [] };
  }

  const tradingDates = Array.from(new Set(recordsAsOfDate.map((record) => record.limitUpDate)))
    .sort((left, right) => right.localeCompare(left));
  if (!tradingDates.includes(targetDate)) {
    return { date: null, totalMainBoardLimitUps: 0, maxBoards: 0, strongSectors: [], allScoredStocks: [], candidates: [] };
  }

  const tradingDateIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const stockDates = new Map<string, Set<string>>();
  for (const record of recordsAsOfDate) {
    if (!isMainBoardStock(record.stockCode)) continue;
    const dates = stockDates.get(record.stockCode) ?? new Set<string>();
    dates.add(record.limitUpDate);
    stockDates.set(record.stockCode, dates);
  }

  const calculateBoards = (stockCode: string, date: string) => {
    const dates = stockDates.get(stockCode);
    const targetIndex = tradingDateIndex.get(date);
    if (!dates || targetIndex === undefined) return 1;

    let boards = 1;
    for (let index = targetIndex + 1; index < tradingDates.length; index += 1) {
      if (!dates.has(tradingDates[index])) break;
      boards += 1;
    }
    return boards;
  };

  // 同一股票同日有重复记录时，只保留封板更早的一条，避免重复计数。
  const currentRecordsByCode = new Map<string, LeaderCandidateSourceRecord>();
  for (const record of recordsAsOfDate) {
    if (record.limitUpDate !== targetDate || !isMainBoardStock(record.stockCode)) continue;
    const existing = currentRecordsByCode.get(record.stockCode);
    if (!existing || (record.limitUpTime ?? "99:99:99") < (existing.limitUpTime ?? "99:99:99")) {
      currentRecordsByCode.set(record.stockCode, record);
    }
  }

  const currentRecords = Array.from(currentRecordsByCode.values());
  const sectorCounts = new Map<string, number>();
  for (const record of currentRecords) {
    const sector = normalizeSectorName(record.sector);
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
  }

  const strongSectors = Array.from(sectorCounts.entries())
    .map(([sector, count]) => ({ sector, count }))
    .sort((left, right) => right.count - left.count || left.sector.localeCompare(right.sector))
    .slice(0, 5);

  const currentDateIndex = tradingDateIndex.get(targetDate) ?? 0;
  const trajectoryDates = tradingDates.slice(currentDateIndex, currentDateIndex + 7).reverse();
  // 覆盖全市场、任意连板高度的主板涨停股（含首板与四板以上），不再按连板数量截断评分范围。
  const scorableRecords = currentRecords;
  const rankedAllScoredStocks = scorableRecords
    .map((record) => {
      const sector = normalizeSectorName(record.sector);
      const boards = calculateBoards(record.stockCode, targetDate);
      const sectorCount = sectorCounts.get(sector) ?? 0;
      const limitUpMinutes = timeToMinutes(record.limitUpTime);
      const turnover = parseNumeric(record.turnover);
      const marketCap = calculateMarketCapScore(record.circulationValue);
      const boardScore = Math.min(boards, 6) * 7;
      const sectorScore = Math.min(sectorCount, 6) * 4;
      const timeScore = limitUpMinutes === null ? 2
        : limitUpMinutes <= 10 * 60 ? 10
          : limitUpMinutes <= 11 * 60 + 30 ? 8
            : limitUpMinutes <= 13 * 60 + 30 ? 5
              : limitUpMinutes <= 14 * 60 + 30 ? 2
                : 0;
      const turnoverScore = turnover >= 20 ? 8 : turnover >= 10 ? 6 : turnover >= 5 ? 4 : turnover >= 2 ? 2 : 1;
      const score = Math.min(100, boardScore + sectorScore + timeScore + turnoverScore + marketCap.score);
      const signalPhase = options.phaseByDate?.get(targetDate);
      const risk = scoreDownsideRiskSignal({
        stockCode: record.stockCode,
        stockName: stockNameByCode.get(record.stockCode) ?? record.stockName,
        sector,
        boards,
        sectorCount,
        score,
        limitUpTime: record.limitUpTime,
        turnover: record.turnover,
        circulationValue: record.circulationValue,
        marketCapScore: marketCap.score,
        date: targetDate,
        nextDate: targetDate,
        nextDayDate: targetDate,
        secondDayDate: null,
        success: false,
        signalClosePrice: null,
        nextOpenPrice: null,
        nextClosePrice: null,
        nextOpenPremium: null,
        nextClosePremium: null,
        secondDayOpenPrice: null,
        secondDayClosePrice: null,
        secondDayOpenPremium: null,
        secondDayClosePremium: null,
        tPlus1CloseToTPlus2CloseReturn: null,
        tPlus1CloseToTPlus2CloseSuccess: null,
        phase: signalPhase?.phase ?? null,
        maxBoards: signalPhase?.maxBoards ?? null,
      }, { priceByStockDate: options.priceByStockDate, marketFactorsByDate: options.marketFactorsByDate });
      const riskPenalty = Number((risk.riskScore * (options.riskPenaltyWeight ?? defaultDownsideRiskPenaltyWeight)).toFixed(2));
      const netScore = Number(Math.max(0, score - riskPenalty).toFixed(2));

      const reasons = [`${boards}板高度`, `${sector} ${sectorCount}只涨停`];
      if (record.limitUpTime) reasons.push(`${record.limitUpTime.slice(0, 5)} 封板`);
      const formattedTurnover = formatTurnover(record.turnover);
      if (formattedTurnover) reasons.push(`成交额 ${formattedTurnover}`);
      if (record.circulationValue) reasons.push(`流通市值 ${record.circulationValue}亿元 · ${marketCap.label} ${marketCap.score}分`);

      const riskTags: string[] = [];
      if (boards === 1) riskTags.push("首板待晋级确认");
      if (sectorCount <= 1) riskTags.push("题材支撑偏弱");
      if (limitUpMinutes !== null && limitUpMinutes > 14 * 60 + 30) riskTags.push("封板偏晚");
      if (boards >= 4 && sectorCount <= 2) riskTags.push("高位题材支撑弱");
      if (marketCap.score === 0) riskTags.push("流通市值缺失");
      if (marketCap.label === "小盘弹性") riskTags.push("小盘波动较大");
      if (marketCap.label === "超大盘弹性偏低") riskTags.push("超大盘弹性偏低");
      if (risk.riskTier === "高风险") riskTags.push("下行风险偏高");
      if (risk.riskTier === "中风险") riskTags.push("下行风险中等");

      return {
        rank: 0,
        stockCode: record.stockCode,
        stockName: stockNameByCode.get(record.stockCode) ?? record.stockName,
        sector,
        boards,
        sectorCount,
        score,
        riskScore: risk.riskScore,
        riskTier: risk.riskTier,
        riskPenalty,
        netScore,
        limitUpTime: record.limitUpTime,
        turnover: record.turnover,
        circulationValue: record.circulationValue,
        marketCapScore: marketCap.score,
        marketCapLabel: marketCap.label,
        reasons,
        riskTags,
        trajectory: trajectoryDates.map((date) => ({
          date,
          boards: stockDates.get(record.stockCode)?.has(date) ? calculateBoards(record.stockCode, date) : 0,
        })),
      };
    })
    .sort((left, right) => (
      right.score - left.score
      || right.boards - left.boards
      || right.sectorCount - left.sectorCount
      || (left.limitUpTime ?? "99:99:99").localeCompare(right.limitUpTime ?? "99:99:99")
    ));
  const allScoredStocks = rankedAllScoredStocks.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const rankedCandidates = allScoredStocks
    .filter((candidate) => (
      (candidate.sectorCount >= 3 && candidate.limitUpTime !== null && timeToMinutes(candidate.limitUpTime)! <= 13 * 60 + 30)
      || candidate.score >= 52
    ))
    .sort((left, right) => (
      right.score - left.score
      || right.boards - left.boards
      || right.sectorCount - left.sectorCount
      || (left.limitUpTime ?? "99:99:99").localeCompare(right.limitUpTime ?? "99:99:99")
    ));
  const candidatesForResult = options.candidateLimit === null
    ? rankedCandidates
    : rankedCandidates.slice(0, options.candidateLimit ?? 20);
  const candidates = candidatesForResult.map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  return {
    date: targetDate,
    totalMainBoardLimitUps: currentRecords.length,
    maxBoards: currentRecords.length > 0 ? Math.max(...currentRecords.map((record) => calculateBoards(record.stockCode, targetDate))) : 0,
    strongSectors,
    allScoredStocks,
    candidates,
  };
}

/** 构建数据库最新交易日的主板龙头候选池。 */
export function buildLeaderCandidates(records: LeaderCandidateSourceRecord[], options: LeaderCandidateBuildOptions = {}): LeaderCandidateResult {
  const latestDate = Array.from(new Set(records.map((record) => record.limitUpDate)))
    .sort((left, right) => right.localeCompare(left))[0];
  if (!latestDate) {
    return { date: null, totalMainBoardLimitUps: 0, maxBoards: 0, strongSectors: [], allScoredStocks: [], candidates: [] };
  }
  return buildLeaderCandidatesForDate(records, latestDate, { ...options, stockNameByCode: options.stockNameByCode ?? buildLatestStockNameMap(records) });
}

const snapshotRound = (value: number, digits = 2) => Number(value.toFixed(digits));

/**
 * 将全周期五策略回测的期末未出清订单与最新信号日候选组合成展示快照。
 * 准备买入只代表下一实际交易日开盘前的模型优先级，绝不假定未知的开盘价、成交或资金分配结果。
 */
export function buildLeaderCandidateStrategyPortfolioSnapshot(
  latestCandidates: LeaderCandidateResult,
  fullCycleExperiments: DownsideRiskExperimentItem[],
  options: {
    appliedMinScore: number | null;
    penaltyWeight: number;
    autoTunePenaltyWeight: boolean;
    hardRiskThreshold: number;
    rollingWindows: Array<Pick<DownsideRiskResearchResult["rollingWindows"][number], "validationStartDate" | "validationEndDate" | "autoTunedPenaltyWeight">>;
    priceByStockDate?: Map<string, LeaderCandidateDailyPrice>;
    historicalRows: LeaderCandidateBacktestRow[];
  },
): LeaderCandidateStrategyPortfolioSnapshot {
  const latestSignalDate = latestCandidates.date;
  const candidatePool = latestCandidates.candidates.filter((candidate) => (
    options.appliedMinScore === null || candidate.score >= options.appliedMinScore
  ));
  const experimentByKey = new Map(fullCycleExperiments.map((experiment) => [experiment.key, experiment]));
  const appliedPenaltyWeight = latestSignalDate && options.autoTunePenaltyWeight
    ? options.rollingWindows.find((window) => latestSignalDate >= window.validationStartDate && latestSignalDate <= window.validationEndDate)?.autoTunedPenaltyWeight ?? options.penaltyWeight
    : options.penaltyWeight;

  const latestRowByStockCode = new Map(options.historicalRows
    .filter((row) => row.date === latestSignalDate)
    .map((row) => [row.stockCode, row]));
  const qualityScoringContext = { priceByStockDate: options.priceByStockDate };
  const scoredCandidatePool = candidatePool.map((candidate) => {
    const historicalRow = latestRowByStockCode.get(candidate.stockCode);
    const signalRow = historicalRow ? { ...historicalRow, score: candidate.score } : null;
    const qualityScore = signalRow
      ? calculateQualityBlendScoreForRisk(signalRow, candidate.riskScore, qualityScoringContext)
      : candidate.score;
    return { candidate, qualityScore };
  });
  const sortedQualityScores = scoredCandidatePool.map(({ qualityScore }) => qualityScore).sort((left, right) => left - right);
  const qualityMedianIndex = Math.floor(sortedQualityScores.length / 2);
  const qualityGateThreshold = sortedQualityScores.length === 0
    ? null
    : sortedQualityScores.length % 2 === 0
      ? (sortedQualityScores[qualityMedianIndex - 1]! + sortedQualityScores[qualityMedianIndex]!) / 2
      : sortedQualityScores[qualityMedianIndex]!;

  const strategies: LeaderCandidateStrategyPortfolio[] = (["baseline", "riskPenalty", "hardFilter", "qualityBlend", "qualityGate"] as const).map((key) => {
    const experiment = experimentByKey.get(key);
    const simulation = experiment?.realisticSimulation;
    const asOfDate = simulation?.equityCurve.at(-1)?.date ?? null;
    const holdings = (simulation?.trades ?? [])
      .filter((trade) => trade.status === "filled" && trade.exitPrice === null)
      .map((trade) => {
        const valuationPrice = asOfDate
          ? options.priceByStockDate?.get(`${trade.stockCode}::${asOfDate}`)?.closePrice ?? null
          : null;
        const priceChangePercent = valuationPrice !== null && trade.entryPrice !== null && trade.entryPrice > 0
          ? snapshotRound(((valuationPrice - trade.entryPrice) / trade.entryPrice) * 100)
          : null;
        const source = options.historicalRows.find((row) => row.date === trade.signalDate && row.stockCode === trade.stockCode);
        return {
          stockCode: trade.stockCode,
          stockName: trade.stockName,
          sector: source?.sector ?? "-",
          signalDate: trade.signalDate,
          entryDate: trade.entryDate,
          entryPrice: trade.entryPrice,
          shares: trade.shares,
          score: trade.score,
          valuationDate: asOfDate,
          valuationPrice,
          priceChangePercent,
          reason: trade.reason,
        } satisfies LeaderCandidatePortfolioHolding;
      });
    const heldCodes = new Set(holdings.map((holding) => holding.stockCode));
    const maxPositions = simulation?.assumptions.maxPositions ?? 0;
    const availableSlots = Math.max(0, maxPositions - holdings.length);
    const candidateWithScore = scoredCandidatePool.map(({ candidate, qualityScore }) => ({
      candidate,
      strategyScore: key === "riskPenalty"
        ? Math.max(0, snapshotRound(candidate.score - candidate.riskScore * appliedPenaltyWeight))
        : key === "qualityBlend" || key === "qualityGate"
          ? qualityScore
        : candidate.score,
    }));
    const excludedHighRiskCount = key === "hardFilter"
      ? candidateWithScore.filter(({ candidate }) => candidate.riskScore >= options.hardRiskThreshold).length
      : key === "qualityGate"
        ? candidateWithScore.filter(({ candidate, strategyScore }) => candidate.riskScore >= options.hardRiskThreshold || strategyScore < (qualityGateThreshold ?? Number.NEGATIVE_INFINITY)).length
      : 0;
    const strategyCandidates = candidateWithScore
      .filter(({ candidate, strategyScore }) => (
        key === "hardFilter"
          ? candidate.riskScore < options.hardRiskThreshold
          : key === "qualityGate"
            ? candidate.riskScore < options.hardRiskThreshold && strategyScore >= (qualityGateThreshold ?? Number.POSITIVE_INFINITY)
            : true
      ))
      .sort((left, right) => (
        right.strategyScore - left.strategyScore
        || right.candidate.boards - left.candidate.boards
        || right.candidate.sectorCount - left.candidate.sectorCount
        || (left.candidate.limitUpTime ?? "99:99:99").localeCompare(right.candidate.limitUpTime ?? "99:99:99")
        || left.candidate.stockCode.localeCompare(right.candidate.stockCode)
      ));
    const preparedBuys = strategyCandidates
      .filter(({ candidate }) => !heldCodes.has(candidate.stockCode))
      .slice(0, availableSlots)
      .map(({ candidate, strategyScore }, index) => ({
        rank: index + 1,
        stockCode: candidate.stockCode,
        stockName: candidate.stockName,
        sector: candidate.sector,
        boards: candidate.boards,
        signalDate: latestSignalDate ?? "",
        score: candidate.score,
        riskScore: candidate.riskScore,
        riskTier: candidate.riskTier,
        strategyScore,
        reasons: candidate.reasons,
        conditions: [
          `下一实际交易日开盘涨幅不低于${simulation?.assumptions.minimumExpectedOpenChangePercent ?? -2}%`,
          simulation?.assumptions.blockLimitUpBuys ? "开盘接近涨停时按保守规则不追买" : "需按实际开盘价与整手资金约束核算",
          "以开盘时可用资金、最大持仓与策略排序为准，未承诺成交",
        ],
      } satisfies LeaderCandidatePreparedBuy));

    return {
      key,
      label: experiment?.label ?? (key === "baseline" ? "原始策略" : key === "riskPenalty" ? "风险扣分策略" : key === "hardFilter" ? "高风险硬过滤" : key === "qualityBlend" ? "质量复合评分" : "质量门控策略"),
      description: experiment?.description ?? "暂无策略回测数据。",
      asOfDate,
      availableCash: simulation?.equityCurve.at(-1)?.cash ?? simulation?.initialCapital ?? 0,
      maxPositions,
      openPositionCount: holdings.length,
      availableSlots,
      currentHoldings: holdings,
      preparedBuys,
      candidateCount: strategyCandidates.length,
      excludedHighRiskCount,
      note: key === "riskPenalty"
        ? `最新信号日使用风险扣分权重 ${appliedPenaltyWeight}；若该日不在已完成验证窗口内，则使用手动回退权重。`
        : key === "hardFilter"
          ? `风险分不低于 ${options.hardRiskThreshold} 的候选不纳入该策略准备清单。`
          : key === "qualityBlend"
            ? "固定质量复合分：68%原始候选强度、32%信号日安全度，加早封、题材共振与充足成交额奖励。"
            : key === "qualityGate"
              ? `仅保留质量复合分不低于当日中位数 ${qualityGateThreshold ?? "-"} 且风险分低于 ${options.hardRiskThreshold} 的候选。`
              : "按原始候选评分排序。",
    } satisfies LeaderCandidateStrategyPortfolio;
  });

  return {
    asOfDate: strategies[0]?.asOfDate ?? null,
    latestSignalDate,
    nextEntryTiming: "下一实际交易日开盘",
    definition: "当前持仓为全周期模拟截止日尚未出清的订单；准备买入为最新信号日后、在已知信号日信息下的模型优先级。未知的下一开盘价格、成交限制和当日资金变动不会被预先假定。此处仅作历史规则的模拟展示，不构成交易建议。",
    strategies,
  };
}

/**
 * 回测口径：在T日收盘后，严格使用T日及以前数据生成候选；
 * 成功定义为该股票在下一已记录交易日（T+1）仍出现在涨停记录中。
 */
export function buildLeaderCandidateBacktest(
  records: LeaderCandidateSourceRecord[],
  options: LeaderCandidateBacktestOptions = {},
  context: LeaderCandidateBacktestContext = {},
): LeaderCandidateBacktestResult {
  const observationDays = options.observationDays ?? 1;
  const candidateTradingDates = Array.from(new Set(records.map((record) => record.limitUpDate)))
    .sort((left, right) => left.localeCompare(right));
  const marketTradingDates = Array.from(new Set(context.tradingDates ?? candidateTradingDates))
    .sort((left, right) => left.localeCompare(right));
  const marketTradingDateIndex = new Map(marketTradingDates.map((date, index) => [date, index]));
  const recordsByDate = new Map<string, Set<string>>();
  for (const record of records) {
    const codes = recordsByDate.get(record.limitUpDate) ?? new Set<string>();
    codes.add(record.stockCode);
    recordsByDate.set(record.limitUpDate, codes);
  }

  const stockNameByCode = buildLatestStockNameMap(records);
  const rows: LeaderCandidateBacktestRow[] = [];
  // 信号日只来自涨停记录；观察日优先来自完整市场交易日历，避免无涨停日被误跳过。
  for (let index = 0; index < candidateTradingDates.length; index += 1) {
    const date = candidateTradingDates[index];
    const marketIndex = marketTradingDateIndex.get(date);
    const nextDate = marketIndex === undefined
      ? candidateTradingDates[index + observationDays]
      : marketTradingDates[marketIndex + observationDays];
    // 最后 observationDays 个实际交易日缺少完整观察结果，主动排除，确保结果位于信号日之后。
    if (!nextDate) continue;
    const nextDayDate = marketIndex === undefined
      ? candidateTradingDates[index + 1]
      : marketTradingDates[marketIndex + 1] ?? candidateTradingDates[index + 1];
    const secondDayDate = marketIndex === undefined
      ? candidateTradingDates[index + 2] ?? null
      : marketTradingDates[marketIndex + 2] ?? null;
    // 回测须覆盖T日所有满足规则的主板候选，不能沿用当前页面每日期20只的展示上限。
    const candidateResult = buildLeaderCandidatesForDate(records, date, {
      candidateLimit: null,
      stockNameByCode,
      phaseByDate: context.phaseByDate,
      priceByStockDate: context.priceByStockDate,
      marketFactorsByDate: context.marketFactorsByDate,
    });
    const nextDayCodes = recordsByDate.get(nextDate) ?? new Set<string>();
    const phaseContext = context.phaseByDate?.get(date);

    for (const candidate of candidateResult.candidates) {
      const signalPrice = context.priceByStockDate?.get(`${candidate.stockCode}::${date}`);
      const nextDayPrice = context.priceByStockDate?.get(`${candidate.stockCode}::${nextDayDate}`);
      const secondDayPrice = secondDayDate
        ? context.priceByStockDate?.get(`${candidate.stockCode}::${secondDayDate}`)
        : undefined;
      const suspendedSet = context.suspendedDatesByStock?.get(candidate.stockCode);
      const isSuspendedOn = (d: string | null | undefined) => (d ? (suspendedSet?.has(d) ?? false) : false);
      const suspendedAfterSignal = isSuspendedOn(nextDayDate);
      // 复牌首日 = 信号日后第一个非停牌市场交易日；涨停后停牌样本以此作为可离场观察日。
      let resumeDate: string | null = null;
      if (suspendedAfterSignal && marketIndex !== undefined) {
        for (let offset = 1; ; offset += 1) {
          const candidateResumeDate = marketTradingDates[marketIndex + offset];
          if (!candidateResumeDate) break;
          if (!isSuspendedOn(candidateResumeDate)) {
            resumeDate = candidateResumeDate;
            break;
          }
        }
      } else if (!suspendedAfterSignal) {
        resumeDate = nextDayDate;
      }
      const resumePrice = resumeDate
        ? context.priceByStockDate?.get(`${candidate.stockCode}::${resumeDate}`)
        : undefined;
      const tPlus1CloseToTPlus2CloseReturn = premiumPercent(nextDayPrice?.closePrice, secondDayPrice?.closePrice);
      const technicalFactors = computeTechnicalFactorValues(
        candidate.stockCode,
        date,
        candidate.circulationValue,
        signalPrice,
        context,
      );
      rows.push({
        date,
        nextDate,
        nextDayDate,
        secondDayDate,
        stockCode: candidate.stockCode,
        stockName: candidate.stockName,
        sector: candidate.sector,
        boards: candidate.boards,
        sectorCount: candidate.sectorCount,
        score: candidate.score,
        riskScore: candidate.riskScore,
        riskTier: candidate.riskTier,
        riskPenalty: candidate.riskPenalty,
        netScore: candidate.netScore,
        limitUpTime: candidate.limitUpTime,
        turnover: candidate.turnover,
        circulationValue: candidate.circulationValue,
        marketCapScore: candidate.marketCapScore,
        success: nextDayCodes.has(candidate.stockCode),
        signalClosePrice: signalPrice?.closePrice ?? null,
        nextOpenPrice: nextDayPrice?.openPrice ?? null,
        nextClosePrice: nextDayPrice?.closePrice ?? null,
        nextOpenPremium: premiumPercent(signalPrice?.closePrice, nextDayPrice?.openPrice),
        nextClosePremium: premiumPercent(signalPrice?.closePrice, nextDayPrice?.closePrice),
        secondDayOpenPrice: secondDayPrice?.openPrice ?? null,
        secondDayClosePrice: secondDayPrice?.closePrice ?? null,
        secondDayOpenPremium: premiumPercent(signalPrice?.closePrice, secondDayPrice?.openPrice),
        secondDayClosePremium: premiumPercent(signalPrice?.closePrice, secondDayPrice?.closePrice),
        tPlus1CloseToTPlus2CloseReturn,
        tPlus1CloseToTPlus2CloseSuccess: tPlus1CloseToTPlus2CloseReturn === null ? null : tPlus1CloseToTPlus2CloseReturn > 0,
        phase: phaseContext?.phase ?? null,
        maxBoards: phaseContext?.maxBoards ?? null,
        suspendedAfterSignal,
        resumeDate,
        resumeOpenPremium: premiumPercent(signalPrice?.closePrice, resumePrice?.openPrice),
        resumeClosePremium: premiumPercent(signalPrice?.closePrice, resumePrice?.closePrice),
        technicalFactors,
      });
    }
  }

  const scoreBandDefinitions = [
    { label: "65分及以上", minScore: 65, maxScore: null },
    { label: "55–64分", minScore: 55, maxScore: 64 },
    { label: "45–54分", minScore: 45, maxScore: 54 },
    { label: "45分以下", minScore: 0, maxScore: 44 },
  ] as const;
  const calculateBand = (
    sourceRows: LeaderCandidateBacktestRow[],
    definition: typeof scoreBandDefinitions[number],
  ): LeaderCandidateScoreBand => {
    const bandRows = sourceRows.filter((row) => (
      row.score >= definition.minScore
      && (definition.maxScore === null || row.score <= definition.maxScore)
    ));
    const successCount = bandRows.filter((row) => row.success).length;
    return {
      ...definition,
      sampleSize: bandRows.length,
      successCount,
      successRate: percent(successCount, bandRows.length),
      premium: calculatePremiumSummary(bandRows),
      tPlus2Premium: calculatePremiumSummary(bandRows, "secondDayOpenPremium", "secondDayClosePremium"),
    };
  };
  // 评分阈值仅用较早70%的日期校准，再在较晚30%的日期做样本外验证，避免将同一批样本既用于选阈值又用于评估。
  const calibrationDateCount = Math.max(0, Math.floor(candidateTradingDates.length * 0.7));
  const calibrationDates = new Set(candidateTradingDates.slice(0, calibrationDateCount));
  const calibrationRows = rows.filter((row) => calibrationDates.has(row.date));
  const outOfSampleRows = rows.filter((row) => !calibrationDates.has(row.date));
  const thresholdOptions = [45, 50, 55, 60, 65]
    .map((threshold) => {
      const thresholdRows = calibrationRows.filter((row) => row.score >= threshold);
      const thresholdSuccesses = thresholdRows.filter((row) => row.success).length;
      return { threshold, sampleSize: thresholdRows.length, successRate: percent(thresholdSuccesses, thresholdRows.length) };
    })
    .filter((item) => item.sampleSize >= 20 && item.successRate !== null)
    .sort((left, right) => (
      (right.successRate ?? 0) - (left.successRate ?? 0)
      || right.sampleSize - left.sampleSize
      || left.threshold - right.threshold
    ));
  const recommended = thresholdOptions[0] ?? null;
  const appliedMinScore = options.minScore ?? recommended?.threshold ?? null;
  const appliedRows = appliedMinScore === null
    ? rows
    : rows.filter((row) => row.score >= appliedMinScore);
  const successCount = appliedRows.filter((row) => row.success).length;
  const scoreBands = scoreBandDefinitions.map((definition) => calculateBand(appliedRows, definition));
  const outOfSampleAtThreshold = recommended
    ? outOfSampleRows.filter((row) => appliedMinScore === null || row.score >= appliedMinScore)
    : appliedMinScore === null ? outOfSampleRows : outOfSampleRows.filter((row) => row.score >= appliedMinScore);
  const outOfSampleSuccessCount = outOfSampleAtThreshold.filter((row) => row.success).length;
  const premium = calculatePremiumSummary(appliedRows);
  const outOfSamplePremium = calculatePremiumSummary(outOfSampleAtThreshold);
  const tPlus2Premium = calculatePremiumSummary(appliedRows, "secondDayOpenPremium", "secondDayClosePremium");
  const outOfSampleTPlus2Premium = calculatePremiumSummary(outOfSampleAtThreshold, "secondDayOpenPremium", "secondDayClosePremium");
  const tPlus1CloseToTPlus2Close = calculateExitSummary(appliedRows);
  const outOfSampleTPlus1CloseToTPlus2Close = calculateExitSummary(outOfSampleAtThreshold);
  const resumeDayExit = calculateResumeExitSummary(appliedRows);
  const outOfSampleResumeDayExit = calculateResumeExitSummary(outOfSampleAtThreshold);
  const realisticSimulation = simulateRealisticTPlus1ToTPlus2(
    appliedRows,
    options.realistic,
    context.priceByStockDate,
    marketTradingDates,
  );
  // 风险研究使用全历史候选生成多个滚动窗口；每个窗口的验证段严格位于前置训练段之后，避免固定70/30切分限制可验证样本量。
  const downsideRiskResearch = buildDownsideRiskResearch(appliedRows, options.downsideRisk, options.realistic, {
    priceByStockDate: context.priceByStockDate,
    tradingDates: marketTradingDates,
    marketFactorsByDate: context.marketFactorsByDate,
  });
  const latestSignalDate = candidateTradingDates.at(-1) ?? null;
  const latestCandidateResult = latestSignalDate
    ? buildLeaderCandidatesForDate(records, latestSignalDate, {
      candidateLimit: null,
      stockNameByCode,
      phaseByDate: context.phaseByDate,
      priceByStockDate: context.priceByStockDate,
      marketFactorsByDate: context.marketFactorsByDate,
    })
    : buildLeaderCandidates([]);
  const strategyPortfolioSnapshot = buildLeaderCandidateStrategyPortfolioSnapshot(
    latestCandidateResult,
    downsideRiskResearch.fullCycle.experiments,
    {
      appliedMinScore,
      penaltyWeight: downsideRiskResearch.penaltyWeight,
      autoTunePenaltyWeight: downsideRiskResearch.autoTunePenaltyWeight,
      hardRiskThreshold: downsideRiskResearch.hardRiskThreshold,
      rollingWindows: downsideRiskResearch.rollingWindows,
      priceByStockDate: context.priceByStockDate,
      historicalRows: appliedRows,
    },
  );
  const signalDates = Array.from(new Set(appliedRows.map((row) => row.date))).sort();
  const marketFactorRows = signalDates.map((date) => context.marketFactorsByDate?.get(date));
  const marketFactorCoverage: LeaderCandidateMarketFactorCoverage = {
    signalDateCount: signalDates.length,
    limitUpCountDateCount: marketFactorRows.filter((item) => item?.limitUpCount !== null && item?.limitUpCount !== undefined).length,
    turnoverDateCount: marketFactorRows.filter((item) => item?.turnoverYi !== null && item?.turnoverYi !== undefined).length,
    marginBalanceDateCount: marketFactorRows.filter((item) => item?.marginBalanceYi !== null && item?.marginBalanceYi !== undefined).length,
    verifiedMarketDataDateCount: marketFactorRows.filter((item) => item?.sourceIsVerified).length,
    startDate: signalDates[0] ?? null,
    endDate: signalDates.at(-1) ?? null,
  };
  const phaseOrder: SentimentCyclePhase[] = ["冰点试错", "修复上升", "上升发酵", "高位分歧", "高位亢奋", "高位退潮"];
  const phaseFunnel = phaseOrder.map((phase) => {
    const phaseRows = outOfSampleAtThreshold.filter((row) => row.phase === phase);
    const successCount = phaseRows.filter((row) => row.success).length;
    const knownMaxBoards = phaseRows.map((row) => row.maxBoards).filter((value): value is number => value !== null);
    return {
      phase,
      sampleSize: phaseRows.length,
      successCount,
      successRate: percent(successCount, phaseRows.length),
      maxBoards: knownMaxBoards.length > 0 ? Math.max(...knownMaxBoards) : null,
    };
  });

  const factorEvaluationReport = evaluateFactorEffectiveness(rows);
  const factorCombinationReport = buildFactorNeutralizationReport(rows);
  const overfittingGuardReport = buildOverfittingGuardReport(realisticSimulation, 30);
  const riskPenaltyRobustness = downsideRiskResearch.strategyRobustness.find((item) => item.key === "riskPenalty");
  const finalVerdict = buildFinalVerdict(
    factorEvaluationReport,
    factorCombinationReport,
    overfittingGuardReport,
    riskPenaltyRobustness?.walkForwardOosSharpe ?? null,
    overfittingGuardReport.realSharpe,
  );

  return {
    definition: `候选覆盖全市场主板涨停股（不限连板高度，含首板与四板以上）；成功=候选在T日收盘后入池，且在第${observationDays}个后续已记录交易日T+${observationDays}仍为涨停；最后${observationDays}个交易日因缺少完整结果不纳入样本。`,
    observationDays,
    appliedMinScore,
    totalSamples: appliedRows.length,
    successCount,
    successRate: percent(successCount, appliedRows.length),
    scoreBands,
    recommendedMinScore: recommended?.threshold ?? null,
    calibrationSampleSize: recommended?.sampleSize ?? 0,
    calibrationPeriod: {
      startDate: calibrationDateCount > 0 ? candidateTradingDates[0] : null,
      endDate: calibrationDateCount > 0 ? candidateTradingDates[calibrationDateCount - 1] : null,
    },
    outOfSample: {
      sampleSize: outOfSampleAtThreshold.length,
      successCount: outOfSampleSuccessCount,
      successRate: percent(outOfSampleSuccessCount, outOfSampleAtThreshold.length),
    },
    premium,
    outOfSamplePremium,
    tPlus2Premium,
    outOfSampleTPlus2Premium,
    tPlus1CloseToTPlus2Close,
    outOfSampleTPlus1CloseToTPlus2Close,
    resumeDayExit,
    outOfSampleResumeDayExit,
    // 该分层始终以所有样本外行计算，不受当前手动阈值影响，用于比较各评分区间的独立样本外表现。
    outOfSampleScoreBands: scoreBandDefinitions.map((definition) => calculateBand(outOfSampleRows, definition)),
    // 阶段漏斗使用当前评分阈值下的独立样本外行；每行的阶段仅来自候选信号日，不读取后续验证日。
    phaseFunnel,
    historicalRows: appliedRows.slice().sort((left, right) => right.date.localeCompare(left.date) || right.score - left.score),
    realisticSimulation,
    downsideRiskResearch,
    dailyPriceCoverage: context.dailyPriceCoverage ?? {
      rowCount: 0,
      stockCount: 0,
      startDate: null,
      endDate: null,
      highPriceCount: 0,
      lowPriceCount: 0,
      amountCount: 0,
      volumeCount: 0,
    },
    marketFactorCoverage,
    strategyPortfolioSnapshot,
    factorEvaluation: factorEvaluationReport,
    factorCombination: factorCombinationReport,
    overfittingGuard: overfittingGuardReport,
    finalVerdict,
  };
}
