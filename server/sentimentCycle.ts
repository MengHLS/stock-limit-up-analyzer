import { buildLeaderCandidatesForDate, type LeaderCandidateSourceRecord } from "./leaderCandidates";

export type SentimentCyclePhase = "冰点试错" | "修复上升" | "上升发酵" | "高位分歧" | "高位亢奋" | "高位退潮";

export type SentimentCycleSourceRecord = LeaderCandidateSourceRecord;

type DailyLeader = {
  date: string;
  maxBoards: number;
  stockCodes: string[];
  stockNames: string[];
};

export type SentimentCycleDay = DailyLeader & {
  phase: SentimentCyclePhase;
  phaseReason: string;
};

export type SentimentCycleSegment = {
  phase: SentimentCyclePhase;
  startDate: string;
  endDate: string;
  maxBoards: number;
  leaderNames: string[];
};

export type NewCycleCandidate = {
  stockCode: string;
  stockName: string;
  sector: string;
  boards: number;
  score: number;
  reasons: string[];
  followUpReady: boolean;
  followUpHighestBoards: number | null;
  becameHighestBoardLeader: boolean | null;
};

export type LeaderBreakEvent = {
  breakDate: string;
  previousDate: string;
  originalLeaderNames: string[];
  originalMaxBoards: number;
  breakDayMaxBoards: number;
  newCycleCandidates: NewCycleCandidate[];
};

export type SentimentCycleAnalysis = {
  days: SentimentCycleDay[];
  segments: SentimentCycleSegment[];
  breakEvents: LeaderBreakEvent[];
  definition: string;
};

function isMainBoardStock(stockCode: string) {
  return !/^(300|301|688|920)/.test(stockCode);
}

function phaseFor(maxBoards: number, previousMaxBoards: number | null): Pick<SentimentCycleDay, "phase" | "phaseReason"> {
  if (previousMaxBoards === null) {
    return maxBoards <= 2
      ? { phase: "冰点试错", phaseReason: "样本起点且最高连板不超过2板" }
      : { phase: "修复上升", phaseReason: "样本起点已出现3板及以上高度" };
  }
  if (maxBoards >= 6) return { phase: "高位亢奋", phaseReason: "最高连板达到6板及以上" };
  if (maxBoards < previousMaxBoards && previousMaxBoards >= 4) return { phase: "高位退潮", phaseReason: `最高连板由${previousMaxBoards}板回落至${maxBoards}板` };
  if (maxBoards >= 4 && maxBoards === previousMaxBoards) return { phase: "高位分歧", phaseReason: `最高连板维持${maxBoards}板` };
  if (maxBoards > previousMaxBoards && maxBoards >= 3) return { phase: "上升发酵", phaseReason: `最高连板由${previousMaxBoards}板抬升至${maxBoards}板` };
  if (maxBoards > previousMaxBoards) return { phase: "修复上升", phaseReason: `最高连板由${previousMaxBoards}板抬升至${maxBoards}板` };
  if (maxBoards <= 2) return { phase: "冰点试错", phaseReason: "最高连板不超过2板" };
  return { phase: "修复上升", phaseReason: `最高连板维持${maxBoards}板` };
}

function buildDailyLeaders(records: SentimentCycleSourceRecord[]) {
  const tradingDates = Array.from(new Set(records.map((record) => record.limitUpDate))).sort();
  const mainRecords = records.filter((record) => isMainBoardStock(record.stockCode));
  const recordsByDate = new Map<string, SentimentCycleSourceRecord[]>();
  const stockDates = new Map<string, Set<string>>();

  for (const record of mainRecords) {
    const sameDateRecords = recordsByDate.get(record.limitUpDate) ?? [];
    sameDateRecords.push(record);
    recordsByDate.set(record.limitUpDate, sameDateRecords);
    const dates = stockDates.get(record.stockCode) ?? new Set<string>();
    dates.add(record.limitUpDate);
    stockDates.set(record.stockCode, dates);
  }

  const dateIndex = new Map(tradingDates.map((date, index) => [date, index]));
  const boardsAt = (stockCode: string, date: string) => {
    const dates = stockDates.get(stockCode);
    const index = dateIndex.get(date);
    if (!dates || index === undefined) return 0;
    let boards = 1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (!dates.has(tradingDates[cursor])) break;
      boards += 1;
    }
    return boards;
  };

  const leaders = tradingDates.flatMap((date) => {
    const namesByCode = new Map<string, string>();
    let maxBoards = 0;
    for (const record of recordsByDate.get(date) ?? []) {
      const boards = boardsAt(record.stockCode, date);
      if (boards > maxBoards) {
        maxBoards = boards;
        namesByCode.clear();
      }
      if (boards === maxBoards) namesByCode.set(record.stockCode, record.stockName);
    }
    if (maxBoards === 0) return [];
    return [{ date, maxBoards, stockCodes: Array.from(namesByCode.keys()), stockNames: Array.from(namesByCode.values()) }];
  });

  return { leaders, tradingDates, recordsByDate, boardsAt };
}

function buildSegments(days: SentimentCycleDay[]): SentimentCycleSegment[] {
  const segments: SentimentCycleSegment[] = [];
  for (const day of days) {
    const previous = segments.at(-1);
    if (!previous || previous.phase !== day.phase) {
      segments.push({ phase: day.phase, startDate: day.date, endDate: day.date, maxBoards: day.maxBoards, leaderNames: [...day.stockNames] });
      continue;
    }
    previous.endDate = day.date;
    previous.maxBoards = Math.max(previous.maxBoards, day.maxBoards);
    previous.leaderNames = Array.from(new Set([...previous.leaderNames, ...day.stockNames]));
  }
  return segments;
}

/**
 * 每日阶段和断板候选信号只使用断板日及之前数据。后续三交易日表现仅对历史事件回顾展示，
 * 与断板日的候选生成分离，避免向信号输入未来信息。
 */
export function buildSentimentCycleAnalysis(records: SentimentCycleSourceRecord[]): SentimentCycleAnalysis {
  const { leaders, tradingDates, recordsByDate, boardsAt } = buildDailyLeaders(records);
  const days = leaders.map((leader, index) => ({
    ...leader,
    ...phaseFor(leader.maxBoards, index > 0 ? leaders[index - 1].maxBoards : null),
  }));
  const breakEvents: LeaderBreakEvent[] = [];

  for (let index = 1; index < leaders.length; index += 1) {
    const previous = leaders[index - 1];
    const current = leaders[index];
    if (previous.maxBoards < 3) continue;
    const currentCodes = new Set((recordsByDate.get(current.date) ?? []).map((record) => record.stockCode));
    const allOriginalLeadersBroken = previous.stockCodes.length > 0 && previous.stockCodes.every((code) => !currentCodes.has(code));
    if (!allOriginalLeadersBroken) continue;

    const originalCodes = new Set(previous.stockCodes);
    const candidates = buildLeaderCandidatesForDate(records, current.date).candidates
      .filter((candidate) => !originalCodes.has(candidate.stockCode))
      .slice(0, 5);
    const followUpDates = tradingDates.slice(index + 1, index + 4);
    const followUpReady = followUpDates.length === 3;
    const newCycleCandidates = candidates.map((candidate) => {
      const followUpHighestBoards = followUpDates.length === 0
        ? null
        : Math.max(...followUpDates.map((date) => (recordsByDate.get(date) ?? []).some((record) => record.stockCode === candidate.stockCode)
          ? boardsAt(candidate.stockCode, date)
          : 0));
      const becameHighestBoardLeader = followUpReady
        ? followUpDates.some((date) => {
          const dailyLeader = leaders.find((leader) => leader.date === date);
          return dailyLeader?.stockCodes.includes(candidate.stockCode) ?? false;
        })
        : null;
      return {
        stockCode: candidate.stockCode,
        stockName: candidate.stockName,
        sector: candidate.sector,
        boards: candidate.boards,
        score: candidate.score,
        reasons: candidate.reasons.slice(0, 3),
        followUpReady,
        followUpHighestBoards,
        becameHighestBoardLeader,
      };
    });
    breakEvents.push({
      breakDate: current.date,
      previousDate: previous.date,
      originalLeaderNames: previous.stockNames,
      originalMaxBoards: previous.maxBoards,
      breakDayMaxBoards: current.maxBoards,
      newCycleCandidates,
    });
  }

  return {
    days,
    segments: buildSegments(days),
    breakEvents: breakEvents.sort((left, right) => right.breakDate.localeCompare(left.breakDate)).slice(0, 12),
    definition: "周期仅由主板每日最高连板及相邻已记录交易日的高度变化划分。原龙头断板定义为前一交易日全部最高连板股票在当日均未涨停；断板日新周期候选仅使用当日及以前数据生成，后3交易日表现仅作历史回顾。",
  };
}
