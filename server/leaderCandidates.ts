export type LeaderCandidateSourceRecord = {
  stockCode: string;
  stockName: string;
  limitUpDate: string;
  limitUpTime: string | null;
  sector: string | null;
  turnover: string | null;
  circulationValue: string | null;
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
  reasons: string[];
  riskTags: string[];
};

export type LeaderCandidateResult = {
  date: string | null;
  totalMainBoardLimitUps: number;
  maxBoards: number;
  strongSectors: Array<{ sector: string; count: number }>;
  candidates: LeaderCandidate[];
};

function isMainBoardStock(stockCode: string) {
  return !/^(300|301|688|920)/.test(stockCode);
}

function normalizeSector(sector: string | null) {
  return sector?.trim() || "其他";
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

/**
 * 用全量涨停记录构建最新交易日的主板龙头候选池。
 * 评分仅用于收盘后排序与复盘，所有得分来源和风险项均随候选结果返回。
 */
export function buildLeaderCandidates(records: LeaderCandidateSourceRecord[]): LeaderCandidateResult {
  if (records.length === 0) {
    return { date: null, totalMainBoardLimitUps: 0, maxBoards: 0, strongSectors: [], candidates: [] };
  }

  const tradingDates = Array.from(new Set(records.map((record) => record.limitUpDate)))
    .sort((left, right) => right.localeCompare(left));
  const latestDate = tradingDates[0] ?? null;
  if (!latestDate) {
    return { date: null, totalMainBoardLimitUps: 0, maxBoards: 0, strongSectors: [], candidates: [] };
  }

  const tradingDateIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const stockDates = new Map<string, Set<string>>();
  for (const record of records) {
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

  // 同一股票同日若存在重复记录，保留涨停时间更早的一条，避免重复计数。
  const currentRecordsByCode = new Map<string, LeaderCandidateSourceRecord>();
  for (const record of records) {
    if (record.limitUpDate !== latestDate || !isMainBoardStock(record.stockCode)) continue;
    const existing = currentRecordsByCode.get(record.stockCode);
    if (!existing || (record.limitUpTime ?? "99:99:99") < (existing.limitUpTime ?? "99:99:99")) {
      currentRecordsByCode.set(record.stockCode, record);
    }
  }
  const currentRecords = Array.from(currentRecordsByCode.values());
  const sectorCounts = new Map<string, number>();
  for (const record of currentRecords) {
    const sector = normalizeSector(record.sector);
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
  }

  const strongSectors = Array.from(sectorCounts.entries())
    .map(([sector, count]) => ({ sector, count }))
    .sort((left, right) => right.count - left.count || left.sector.localeCompare(right.sector))
    .slice(0, 5);

  const candidates = currentRecords
    .map((record) => {
      const sector = normalizeSector(record.sector);
      const boards = calculateBoards(record.stockCode, latestDate);
      const sectorCount = sectorCounts.get(sector) ?? 0;
      const limitUpMinutes = timeToMinutes(record.limitUpTime);
      const turnover = parseNumeric(record.turnover);
      const boardScore = Math.min(boards, 6) * 8;
      const sectorScore = Math.min(sectorCount, 6) * 5;
      const timeScore = limitUpMinutes === null ? 2
        : limitUpMinutes <= 10 * 60 ? 12
          : limitUpMinutes <= 11 * 60 + 30 ? 9
            : limitUpMinutes <= 13 * 60 + 30 ? 6
              : limitUpMinutes <= 14 * 60 + 30 ? 3
                : 0;
      const turnoverScore = turnover >= 20 ? 10 : turnover >= 10 ? 8 : turnover >= 5 ? 6 : turnover >= 2 ? 3 : 1;
      const score = Math.min(100, boardScore + sectorScore + timeScore + turnoverScore);

      const reasons = [
        `${boards}板高度`,
        `${sector} ${sectorCount}只涨停`,
      ];
      if (record.limitUpTime) reasons.push(`${record.limitUpTime.slice(0, 5)} 封板`);
      const formattedTurnover = formatTurnover(record.turnover);
      if (formattedTurnover) reasons.push(`成交额 ${formattedTurnover}`);

      const riskTags: string[] = [];
      if (boards === 1) riskTags.push("首板待晋级确认");
      if (sectorCount <= 1) riskTags.push("题材支撑偏弱");
      if (limitUpMinutes !== null && limitUpMinutes > 14 * 60 + 30) riskTags.push("封板偏晚");
      if (boards >= 4 && sectorCount <= 2) riskTags.push("高位题材支撑弱");

      return {
        rank: 0,
        stockCode: record.stockCode,
        stockName: record.stockName,
        sector,
        boards,
        sectorCount,
        score,
        limitUpTime: record.limitUpTime,
        turnover: record.turnover,
        circulationValue: record.circulationValue,
        reasons,
        riskTags,
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
    ))
    .slice(0, 20)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  return {
    date: latestDate,
    totalMainBoardLimitUps: currentRecords.length,
    maxBoards: currentRecords.length > 0 ? Math.max(...currentRecords.map((record) => calculateBoards(record.stockCode, latestDate))) : 0,
    strongSectors,
    candidates,
  };
}
