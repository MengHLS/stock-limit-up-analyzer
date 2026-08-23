import { buildLeaderCandidatesForDate, type LeaderCandidateSourceRecord } from "./leaderCandidates";

export type SentimentCyclePhase = "冰点试错" | "修复上升" | "上升发酵" | "高位分歧" | "高位亢奋" | "高位退潮";
export type MarketCycleType = "混沌周期" | "龙头周期";
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
  marketCycle: MarketCycleType;
  cycleLeaderNames: string[];
};

export type SentimentCycleSegment = {
  marketCycle: MarketCycleType;
  phases: SentimentCyclePhase[];
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

export type PostBreakLeader = {
  stockCode: string;
  stockName: string;
  sector: string;
  breakDayBoards: number;
  score: number | null;
  highestBoardsAfterBreak: number;
  breakthroughDate: string | null;
  validationStatus: "已验证" | "观察中" | "未达标";
};

export type LeaderBreakEvent = {
  breakDate: string;
  previousDate: string;
  originalLeaderNames: string[];
  originalMaxBoards: number;
  breakDayMaxBoards: number;
  newCycleCandidates: NewCycleCandidate[];
  throughCycleLeaders: PostBreakLeader[];
  reboundLeaders: PostBreakLeader[];
  postBreakObservations: PostBreakLeader[];
};

export type NativeLeader = {
  stockCode: string;
  stockName: string;
  sector: string;
  startDate: string;
  startDayMaxBoards: number;
  confirmationDate: string;
};

export type SentimentCycleAnalysis = {
  days: SentimentCycleDay[];
  segments: SentimentCycleSegment[];
  breakEvents: LeaderBreakEvent[];
  nativeLeaders: NativeLeader[];
  definition: string;
};

const CYCLE_LEADER_MIN_BOARDS = 6;
const MID_LEVEL_MIN_BOARDS = 3;
const LOW_LEVEL_MAX_BOARDS = 2;

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
    if (!previous || previous.marketCycle !== day.marketCycle) {
      segments.push({
        marketCycle: day.marketCycle,
        phases: [day.phase],
        startDate: day.date,
        endDate: day.date,
        maxBoards: day.maxBoards,
        leaderNames: [...day.cycleLeaderNames],
      });
      continue;
    }
    previous.endDate = day.date;
    previous.maxBoards = Math.max(previous.maxBoards, day.maxBoards);
    previous.phases = Array.from(new Set([...previous.phases, day.phase]));
    previous.leaderNames = Array.from(new Set([...previous.leaderNames, ...day.cycleLeaderNames]));
  }
  return segments;
}

function buildNativeLeaders(
  tradingDates: string[],
  recordsByDate: Map<string, SentimentCycleSourceRecord[]>,
  boardsAt: (stockCode: string, date: string) => number,
  leaders: DailyLeader[],
): NativeLeader[] {
  const dailyMaxBoards = new Map(leaders.map((leader) => [leader.date, leader.maxBoards]));
  const nativeLeaders = new Map<string, NativeLeader>();

  for (let index = 0; index < tradingDates.length; index += 1) {
    const date = tradingDates[index];
    const previousDate = tradingDates[index - 1];
    const startDayMaxBoards = dailyMaxBoards.get(date) ?? 0;
    // 低位混沌：起涨日市场最高连板不超过2板，因此当日不存在6板及以上既有周期龙头。
    if (startDayMaxBoards > LOW_LEVEL_MAX_BOARDS) continue;
    const previousCodes = new Set((previousDate ? recordsByDate.get(previousDate) : [])?.map((record) => record.stockCode) ?? []);
    const uniqueTodayRecords = Array.from(new Map((recordsByDate.get(date) ?? []).map((record) => [record.stockCode, record])).values());

    for (const record of uniqueTodayRecords) {
      if (previousCodes.has(record.stockCode) || boardsAt(record.stockCode, date) !== 1 || nativeLeaders.has(record.stockCode)) continue;
      let confirmationDate: string | undefined;
      for (let cursor = index + 1; cursor < tradingDates.length; cursor += 1) {
        const futureDate = tradingDates[cursor];
        const remainsInSameRun = (recordsByDate.get(futureDate) ?? []).some((item) => item.stockCode === record.stockCode);
        if (!remainsInSameRun) break;
        if (boardsAt(record.stockCode, futureDate) >= CYCLE_LEADER_MIN_BOARDS) {
          confirmationDate = futureDate;
          break;
        }
      }
      if (!confirmationDate) continue;
      nativeLeaders.set(record.stockCode, {
        stockCode: record.stockCode,
        stockName: record.stockName,
        sector: record.sector ?? "未分类",
        startDate: date,
        startDayMaxBoards,
        confirmationDate,
      });
    }
  }

  return Array.from(nativeLeaders.values()).sort((left, right) => right.confirmationDate.localeCompare(left.confirmationDate));
}

/**
 * 周期龙头信号：主板股票达到6板（高于5板）。没有任何6板及以上主板股票的交易日为混沌周期。
 * 原龙头断板后，任何断板日涨停股票只要在后续交易日严格突破老龙头高度，即为穿越周期龙；
 * 未突破老龙头高度但达到6板的股票，统一为补涨龙。分类结果仅用于历史回顾，
 * 断板日信号与候选评分均严格截至断板日生成，不读取未来记录。
 */
export function buildSentimentCycleAnalysis(records: SentimentCycleSourceRecord[]): SentimentCycleAnalysis {
  const { leaders, tradingDates, recordsByDate, boardsAt } = buildDailyLeaders(records);
  const days = leaders.map((leader, index) => {
    const marketCycle: MarketCycleType = leader.maxBoards >= CYCLE_LEADER_MIN_BOARDS ? "龙头周期" : "混沌周期";
    return {
      ...leader,
      ...phaseFor(leader.maxBoards, index > 0 ? leaders[index - 1].maxBoards : null),
      marketCycle,
      cycleLeaderNames: marketCycle === "龙头周期" ? leader.stockNames : [],
    };
  });
  const nativeLeaders = buildNativeLeaders(tradingDates, recordsByDate, boardsAt, leaders);
  const breakEvents: LeaderBreakEvent[] = [];

  for (let index = 1; index < leaders.length; index += 1) {
    const previous = leaders[index - 1];
    const current = leaders[index];
    if (previous.maxBoards < CYCLE_LEADER_MIN_BOARDS) continue;
    const currentCodes = new Set((recordsByDate.get(current.date) ?? []).map((record) => record.stockCode));
    const allOriginalLeadersBroken = previous.stockCodes.length > 0 && previous.stockCodes.every((code) => !currentCodes.has(code));
    if (!allOriginalLeadersBroken) continue;

    const originalCodes = new Set(previous.stockCodes);
    const scoreByCode = new Map(buildLeaderCandidatesForDate(records, current.date).candidates
      .filter((candidate) => !originalCodes.has(candidate.stockCode))
      .map((candidate) => [candidate.stockCode, candidate]));
    const candidates = Array.from(scoreByCode.values()).slice(0, 5);
    const followUpDates = tradingDates.slice(index + 1, index + 4);
    const followUpReady = followUpDates.length === 3;
    const newCycleCandidates = candidates.map((candidate) => {
      const followUpHighestBoards = followUpDates.length === 0
        ? null
        : Math.max(...followUpDates.map((date) => (recordsByDate.get(date) ?? []).some((record) => record.stockCode === candidate.stockCode)
          ? boardsAt(candidate.stockCode, date)
          : 0));
      const becameHighestBoardLeader = followUpReady
        ? followUpDates.some((date) => leaders.find((leader) => leader.date === date)?.stockCodes.includes(candidate.stockCode) ?? false)
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

    const lastTradingDate = tradingDates.at(-1) ?? current.date;
    const breakDayStocks = Array.from(new Map((recordsByDate.get(current.date) ?? [])
      .filter((record) => !originalCodes.has(record.stockCode))
      .map((record) => [record.stockCode, record])).values());
    const inspected = breakDayStocks.map((record): PostBreakLeader => {
      const candidate = scoreByCode.get(record.stockCode);
      const futureDates = tradingDates.slice(index + 1);
      const subsequentDays = futureDates.filter((date) => (recordsByDate.get(date) ?? []).some((item) => item.stockCode === record.stockCode));
      const highestBoardsAfterBreak = Math.max(boardsAt(record.stockCode, current.date), ...subsequentDays.map((date) => boardsAt(record.stockCode, date)));
      const sourceBoards = boardsAt(record.stockCode, current.date);
      const strictBreakthroughDate = subsequentDays.find((date) => boardsAt(record.stockCode, date) > previous.maxBoards) ?? null;
      const reachedCycleLeaderDate = subsequentDays.find((date) => boardsAt(record.stockCode, date) >= CYCLE_LEADER_MIN_BOARDS) ?? null;
      const breakthroughDate = strictBreakthroughDate ?? reachedCycleLeaderDate;
      const validationStatus = breakthroughDate
        ? "已验证"
        : (lastTradingDate === current.date || subsequentDays.at(-1) === lastTradingDate ? "观察中" : "未达标");
      return {
        stockCode: record.stockCode,
        stockName: record.stockName,
        sector: record.sector ?? "未分类",
        breakDayBoards: sourceBoards,
        score: candidate?.score ?? null,
        highestBoardsAfterBreak,
        breakthroughDate,
        validationStatus,
      };
    });
    const throughCycleLeaders = inspected
      .filter((item) => item.highestBoardsAfterBreak > previous.maxBoards)
      .sort((left, right) => right.highestBoardsAfterBreak - left.highestBoardsAfterBreak);
    const reboundLeaders = inspected
      .filter((item) => item.breakthroughDate !== null && item.highestBoardsAfterBreak >= CYCLE_LEADER_MIN_BOARDS && item.highestBoardsAfterBreak <= previous.maxBoards)
      .sort((left, right) => right.highestBoardsAfterBreak - left.highestBoardsAfterBreak);
    const classifiedCodes = new Set([...throughCycleLeaders, ...reboundLeaders].map((item) => item.stockCode));
    const postBreakObservations = inspected
      .filter((item) => !classifiedCodes.has(item.stockCode) && (item.breakDayBoards >= MID_LEVEL_MIN_BOARDS || item.breakDayBoards <= LOW_LEVEL_MAX_BOARDS))
      .sort((left, right) => right.breakDayBoards - left.breakDayBoards || (right.score ?? 0) - (left.score ?? 0))
      .slice(0, 5);

    breakEvents.push({
      breakDate: current.date,
      previousDate: previous.date,
      originalLeaderNames: previous.stockNames,
      originalMaxBoards: previous.maxBoards,
      breakDayMaxBoards: current.maxBoards,
      newCycleCandidates,
      throughCycleLeaders,
      reboundLeaders,
      postBreakObservations,
    });
  }

  return {
    days,
    segments: buildSegments(days),
    breakEvents: breakEvents.sort((left, right) => right.breakDate.localeCompare(left.breakDate)).slice(0, 12),
    nativeLeaders,
    definition: "周期龙头定义为主板6板及以上；当日没有主板6板及以上股票即为混沌周期。原生龙为本轮连板首日处于最高连板不超过2板的低位混沌期、当日没有既有周期龙头，且后续成长至6板的主板股票。原龙头断板仅以6板及以上前日最高标为对象。断板日涨停股票后续严格突破老龙头高度的为穿越周期龙；未突破老龙头高度但达到6板的统一为补涨龙。起涨或断板日信号只使用当日及以前数据，后续结果只作历史回顾。",
  };
}
