import type { SentimentCyclePhase } from "./sentimentCycle";
import { buildLatestStockNameMap, normalizeSectorName } from "../shared/stockDataNormalization";

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
  candidates: LeaderCandidate[];
};

export type LeaderCandidateBacktestRow = Pick<LeaderCandidate, "stockCode" | "stockName" | "sector" | "boards" | "score" | "circulationValue" | "marketCapScore"> & {
  date: string;
  nextDate: string;
  nextDayDate: string;
  success: boolean;
  signalClosePrice: number | null;
  nextOpenPrice: number | null;
  nextClosePrice: number | null;
  nextOpenPremium: number | null;
  nextClosePremium: number | null;
  phase: SentimentCyclePhase | null;
  maxBoards: number | null;
};

export type LeaderCandidateScoreBand = {
  label: string;
  minScore: number;
  maxScore: number | null;
  sampleSize: number;
  successCount: number;
  successRate: number | null;
  premium: LeaderCandidatePremiumSummary;
};

export type LeaderCandidatePremiumSummary = {
  sampleSize: number;
  averageOpenPremium: number | null;
  averageClosePremium: number | null;
  openPremiumPositiveCount: number;
  openPremiumPositiveRate: number | null;
  closePremiumPositiveCount: number;
  closePremiumPositiveRate: number | null;
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
  outOfSampleScoreBands: LeaderCandidateScoreBand[];
  phaseFunnel: LeaderCandidatePhaseFunnelItem[];
  historicalRows: LeaderCandidateBacktestRow[];
};

export type LeaderCandidateBacktestOptions = {
  observationDays?: 1 | 2;
  minScore?: number;
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
};

export type LeaderCandidateDailyPrice = {
  openPrice: number;
  closePrice: number;
};

type LeaderCandidateBuildOptions = {
  candidateLimit?: number | null;
  stockNameByCode?: Map<string, string>;
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

function premiumPercent(baseClosePrice: number | undefined, laterPrice: number | undefined) {
  if (!baseClosePrice || !laterPrice || baseClosePrice <= 0 || laterPrice <= 0) return null;
  return Number((((laterPrice - baseClosePrice) / baseClosePrice) * 100).toFixed(2));
}

function calculatePremiumSummary(rows: LeaderCandidateBacktestRow[]): LeaderCandidatePremiumSummary {
  const premiumRows = rows.filter((row) => row.nextOpenPremium !== null && row.nextClosePremium !== null);
  const openPremiums = premiumRows.map((row) => row.nextOpenPremium!);
  const closePremiums = premiumRows.map((row) => row.nextClosePremium!);
  const openPremiumPositiveCount = openPremiums.filter((value) => value > 0).length;
  const closePremiumPositiveCount = closePremiums.filter((value) => value > 0).length;
  const average = (values: number[]) => values.length === 0
    ? null
    : Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));

  return {
    sampleSize: premiumRows.length,
    averageOpenPremium: average(openPremiums),
    averageClosePremium: average(closePremiums),
    openPremiumPositiveCount,
    openPremiumPositiveRate: percent(openPremiumPositiveCount, premiumRows.length),
    closePremiumPositiveCount,
    closePremiumPositiveRate: percent(closePremiumPositiveCount, premiumRows.length),
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
    return { date: null, totalMainBoardLimitUps: 0, maxBoards: 0, strongSectors: [], candidates: [] };
  }

  const tradingDates = Array.from(new Set(recordsAsOfDate.map((record) => record.limitUpDate)))
    .sort((left, right) => right.localeCompare(left));
  if (!tradingDates.includes(targetDate)) {
    return { date: null, totalMainBoardLimitUps: 0, maxBoards: 0, strongSectors: [], candidates: [] };
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
  const rankedCandidates = currentRecords
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

      return {
        rank: 0,
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
        marketCapLabel: marketCap.label,
        reasons,
        riskTags,
        trajectory: trajectoryDates.map((date) => ({
          date,
          boards: stockDates.get(record.stockCode)?.has(date) ? calculateBoards(record.stockCode, date) : 0,
        })),
      };
    })
    .filter((candidate) => (
      candidate.boards >= 2
      || (candidate.sectorCount >= 3 && candidate.limitUpTime !== null && timeToMinutes(candidate.limitUpTime)! <= 13 * 60 + 30)
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
    candidates,
  };
}

/** 构建数据库最新交易日的主板龙头候选池。 */
export function buildLeaderCandidates(records: LeaderCandidateSourceRecord[]): LeaderCandidateResult {
  const latestDate = Array.from(new Set(records.map((record) => record.limitUpDate)))
    .sort((left, right) => right.localeCompare(left))[0];
  if (!latestDate) {
    return { date: null, totalMainBoardLimitUps: 0, maxBoards: 0, strongSectors: [], candidates: [] };
  }
  return buildLeaderCandidatesForDate(records, latestDate, { stockNameByCode: buildLatestStockNameMap(records) });
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
  const tradingDates = Array.from(new Set(records.map((record) => record.limitUpDate)))
    .sort((left, right) => left.localeCompare(right));
  const recordsByDate = new Map<string, Set<string>>();
  for (const record of records) {
    const codes = recordsByDate.get(record.limitUpDate) ?? new Set<string>();
    codes.add(record.stockCode);
    recordsByDate.set(record.limitUpDate, codes);
  }

  const stockNameByCode = buildLatestStockNameMap(records);
  const rows: LeaderCandidateBacktestRow[] = [];
  // 最后 observationDays 个交易日缺少完整观察结果，主动排除，确保结果位于信号日之后。
  for (let index = 0; index < tradingDates.length - observationDays; index += 1) {
    const date = tradingDates[index];
    const nextDate = tradingDates[index + observationDays];
    const nextDayDate = tradingDates[index + 1];
    // 回测须覆盖T日所有满足规则的主板候选，不能沿用当前页面每日期20只的展示上限。
    const candidateResult = buildLeaderCandidatesForDate(records, date, { candidateLimit: null, stockNameByCode });
    const nextDayCodes = recordsByDate.get(nextDate) ?? new Set<string>();
    const phaseContext = context.phaseByDate?.get(date);

    for (const candidate of candidateResult.candidates) {
      const signalPrice = context.priceByStockDate?.get(`${candidate.stockCode}::${date}`);
      const nextDayPrice = context.priceByStockDate?.get(`${candidate.stockCode}::${nextDayDate}`);
      rows.push({
        date,
        nextDate,
        nextDayDate,
        stockCode: candidate.stockCode,
        stockName: candidate.stockName,
        sector: candidate.sector,
        boards: candidate.boards,
        score: candidate.score,
        circulationValue: candidate.circulationValue,
        marketCapScore: candidate.marketCapScore,
        success: nextDayCodes.has(candidate.stockCode),
        signalClosePrice: signalPrice?.closePrice ?? null,
        nextOpenPrice: nextDayPrice?.openPrice ?? null,
        nextClosePrice: nextDayPrice?.closePrice ?? null,
        nextOpenPremium: premiumPercent(signalPrice?.closePrice, nextDayPrice?.openPrice),
        nextClosePremium: premiumPercent(signalPrice?.closePrice, nextDayPrice?.closePrice),
        phase: phaseContext?.phase ?? null,
        maxBoards: phaseContext?.maxBoards ?? null,
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
    };
  };
  // 评分阈值仅用较早70%的日期校准，再在较晚30%的日期做样本外验证，避免将同一批样本既用于选阈值又用于评估。
  const calibrationDateCount = Math.max(0, Math.floor(tradingDates.length * 0.7));
  const calibrationDates = new Set(tradingDates.slice(0, calibrationDateCount));
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

  return {
    definition: `成功=候选在T日收盘后入池，且在第${observationDays}个后续已记录交易日T+${observationDays}仍为涨停；最后${observationDays}个交易日因缺少完整结果不纳入样本。`,
    observationDays,
    appliedMinScore,
    totalSamples: appliedRows.length,
    successCount,
    successRate: percent(successCount, appliedRows.length),
    scoreBands,
    recommendedMinScore: recommended?.threshold ?? null,
    calibrationSampleSize: recommended?.sampleSize ?? 0,
    calibrationPeriod: {
      startDate: calibrationDateCount > 0 ? tradingDates[0] : null,
      endDate: calibrationDateCount > 0 ? tradingDates[calibrationDateCount - 1] : null,
    },
    outOfSample: {
      sampleSize: outOfSampleAtThreshold.length,
      successCount: outOfSampleSuccessCount,
      successRate: percent(outOfSampleSuccessCount, outOfSampleAtThreshold.length),
    },
    premium,
    outOfSamplePremium,
    // 该分层始终以所有样本外行计算，不受当前手动阈值影响，用于比较各评分区间的独立样本外表现。
    outOfSampleScoreBands: scoreBandDefinitions.map((definition) => calculateBand(outOfSampleRows, definition)),
    // 阶段漏斗使用当前评分阈值下的独立样本外行；每行的阶段仅来自候选信号日，不读取后续验证日。
    phaseFunnel,
    historicalRows: appliedRows.slice().sort((left, right) => right.date.localeCompare(left.date) || right.score - left.score),
  };
}
