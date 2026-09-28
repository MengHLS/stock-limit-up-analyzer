/**
 * 3F TopN 交易后验统计：T+1..T+5 观察窗口内是否出现单日下跌 >= 5%。
 *
 * 时间轴：
 *   - T0 = 首板事件日；
 *   - T+1..T+5 = 决策观察窗口；
 *   - T+6 = 策略买入日（trade.entryTime）。
 *
 * 用法：
 *   npx tsx scripts/analyze3FTopNObservationDropStats.mts
 *   npx tsx scripts/analyze3FTopNObservationDropStats.mts --topn 5
 *   npx tsx scripts/analyze3FTopNObservationDropStats.mts --run-id clrun-...
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { stockDailyPrices } from "../drizzle/schema";
import {
  getClosedLoopBacktestRun,
  listClosedLoopBacktestRuns,
} from "../server/closedLoopBacktestRun/repository";
import { getDb } from "../server/db";
import { withReadRetry } from "../server/readRetry";
import { buildTradingCalendar, type TradingCalendar } from "../server/security/tradingCalendar";

type Trade = {
  securityId: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  quantity: number;
  netPnl: number | null;
  returnPct: number | null;
  holdingPeriod: number;
  openAtEnd: boolean;
  reason: string | null;
  code?: string | null;
  name?: string | null;
};

type DailyRow = {
  tradeDate: string;
  openPrice: string | null;
  closePrice: string | null;
  lowPrice: string | null;
  preClosePrice: string | null;
  volume: string | null;
};

type EvaluatedTrade = Trade & {
  t0Date: string | null;
  observationDates: string[];
  observedDayCount: number;
  dailyChanges: Array<{
    date: string;
    closeChangePct: number | null;
    openCloseChangePct: number | null;
    intradayDropPct: number | null;
    expandedDown: boolean;
    volume: number | null;
    volumeRatioVsPriorAvg: number | null;
  }>;
  maxCloseDropPct: number | null;
  closeDown5DayCount: number;
  closeDown5Dates: string[];
  firstCloseDown5Date: string | null;
  firstCloseDown5Day: number | null;
  firstDropVolume: number | null;
  firstDropVolumeRatio: number | null;
  windowVolumeVsT0Ratio: number | null;
  t0Volume: number | null;
  t2Volume: number | null;
  t2VolumeRatioVsT0: number | null;
  t2CloseChangePct: number | null;
  closeDown5: boolean;
  intradayDown5: boolean;
  expandedDownDates: string[];
  expandedDownDayCount: number;
  expandedDown: boolean;
  bigLoss: boolean;
};

type Aggregate = {
  count: number;
  distinctCodes: number;
  meanNetPnl: number | null;
  medianNetPnl: number | null;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
  stopLossRatePct: number | null;
  meanHoldingPeriod: number | null;
  meanObservedDays: number | null;
  meanMaxCloseDropPct: number | null;
  meanCloseDown5Days: number | null;
  meanFirstDropVolumeRatio: number | null;
  medianFirstDropVolumeRatio: number | null;
  volumeUpRatePct: number | null;
  volumeUp1_5RatePct: number | null;
  volumeUp2RatePct: number | null;
  meanWindowVolumeVsT0Ratio: number | null;
  bigLossRatePct: number | null;
};

type DownEvent = {
  trade: EvaluatedTrade;
  date: string;
  day: number;
  closeChangePct: number;
  volume: number | null;
  volumeRatio: number | null;
};

type ExpandedDownEvent = DownEvent & {
  openCloseChangePct: number | null;
  closeTrigger: boolean;
  openCloseTrigger: boolean;
  trigger:
    | "收盘跌幅"
    | "开盘至收盘跌幅"
    | "两项同时满足";
};

const BIG_LOSS_THRESHOLD_PCT = -5;
const SINGLE_DAY_DROP_THRESHOLD_PCT = -5;

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

function formatPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "-" : `${value.toFixed(2)}%`;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function percentile(sortedValues: readonly number[], ratio: number): number | null {
  if (sortedValues.length === 0) return null;
  const position = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower]!;
  const weight = position - lower;
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

function bootstrapMeanDifferenceCi(
  selected: readonly number[],
  baseline: readonly number[],
  iterations = 10_000,
): { lower: number; upper: number } | null {
  if (selected.length === 0 || baseline.length === 0) return null;
  let seed = 0x5f37c1a9;
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const sampleMean = (values: readonly number[]): number => {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)]!;
    }
    return sum / values.length;
  };
  const differences: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    differences.push(sampleMean(selected) - sampleMean(baseline));
  }
  differences.sort((left, right) => left - right);
  return {
    lower: percentile(differences, 0.025)!,
    upper: percentile(differences, 0.975)!,
  };
}

function parseTrades(result: unknown): Trade[] {
  if (result === null || typeof result !== "object") return [];
  const stages = (result as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];
  const backtest = stages.find(
    (stage) =>
      stage !== null &&
      typeof stage === "object" &&
      (stage as { stageId?: unknown }).stageId === "backtest",
  );
  const output =
    backtest !== null && typeof backtest === "object"
      ? (backtest as { output?: unknown }).output
      : null;
  const trades =
    output !== null && typeof output === "object"
      ? (output as { trades?: unknown }).trades
      : null;
  if (!Array.isArray(trades)) return [];
  return trades.filter(
    (trade): trade is Trade =>
      trade !== null &&
      typeof trade === "object" &&
      typeof (trade as Trade).entryTime === "string" &&
      typeof (trade as Trade).exitTime === "string" &&
      !!(trade as Trade).code,
  );
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseVolume(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function observationDates(
  calendar: TradingCalendar,
  entryTime: string,
): { t0Date: string | null; dates: string[] } {
  const t0Date = calendar.addTradingDays(entryTime, -6);
  const dates: string[] = [];
  for (let offset = -5; offset <= -1; offset += 1) {
    const date = calendar.addTradingDays(entryTime, offset);
    if (date !== null) dates.push(date);
  }
  return { t0Date, dates };
}

function changePct(
  close: number | null,
  preClose: number | null,
): number | null {
  if (close === null || preClose === null || preClose <= 0) return null;
  return (close / preClose - 1) * 100;
}

function intradayDropPct(
  low: number | null,
  preClose: number | null,
): number | null {
  if (low === null || preClose === null || preClose <= 0) return null;
  return (low / preClose - 1) * 100;
}

function aggregate(trades: readonly EvaluatedTrade[]): Aggregate {
  const netPnls = trades
    .map((trade) => trade.netPnl)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const returns = trades
    .map((trade) => trade.returnPct)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const maxDrops = trades
    .map((trade) => trade.maxCloseDropPct)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const firstDropVolumeRatios = trades
    .map((trade) => trade.firstDropVolumeRatio)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const windowVolumeRatios = trades
    .map((trade) => trade.windowVolumeVsT0Ratio)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const wins = netPnls.filter((value) => value > 0);
  const losses = netPnls.filter((value) => value < 0);
  const totalProfit = wins.reduce((sum, value) => sum + value, 0);
  const totalLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const stopLossCount = trades.filter((trade) =>
    trade.reason?.includes("止损"),
  ).length;
  return {
    count: trades.length,
    distinctCodes: new Set(trades.map((trade) => trade.code).filter(Boolean)).size,
    meanNetPnl: mean(netPnls),
    medianNetPnl: median(netPnls),
    meanReturnPct: mean(returns),
    medianReturnPct: median(returns),
    winRatePct: trades.length === 0 ? null : (wins.length / trades.length) * 100,
    profitFactor:
      totalLoss === 0 ? (totalProfit > 0 ? null : 0) : totalProfit / totalLoss,
    stopLossRatePct:
      trades.length === 0 ? null : (stopLossCount / trades.length) * 100,
    meanHoldingPeriod: mean(trades.map((trade) => trade.holdingPeriod)),
    meanObservedDays: mean(trades.map((trade) => trade.observedDayCount)),
    meanMaxCloseDropPct: mean(maxDrops),
    meanCloseDown5Days: mean(trades.map((trade) => trade.closeDown5DayCount)),
    meanFirstDropVolumeRatio: mean(firstDropVolumeRatios),
    medianFirstDropVolumeRatio: median(firstDropVolumeRatios),
    volumeUpRatePct:
      firstDropVolumeRatios.length === 0
        ? null
        : (firstDropVolumeRatios.filter((value) => value >= 1).length /
            firstDropVolumeRatios.length) *
          100,
    volumeUp1_5RatePct:
      firstDropVolumeRatios.length === 0
        ? null
        : (firstDropVolumeRatios.filter((value) => value >= 1.5).length /
            firstDropVolumeRatios.length) *
          100,
    volumeUp2RatePct:
      firstDropVolumeRatios.length === 0
        ? null
        : (firstDropVolumeRatios.filter((value) => value >= 2).length /
            firstDropVolumeRatios.length) *
          100,
    meanWindowVolumeVsT0Ratio: mean(windowVolumeRatios),
    bigLossRatePct:
      trades.length === 0
        ? null
        : (trades.filter((trade) => trade.bigLoss).length / trades.length) * 100,
  };
}

function firstDayCounts(trades: readonly EvaluatedTrade[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const trade of trades) {
    if (trade.firstCloseDown5Day !== null) {
      counts[trade.firstCloseDown5Day] += 1;
    }
  }
  return counts;
}

function allDayCounts(trades: readonly EvaluatedTrade[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const trade of trades) {
    for (const day of trade.closeDown5Dates) {
      const index = trade.observationDates.indexOf(day) + 1;
      if (index >= 1 && index <= 5) counts[index] += 1;
    }
  }
  return counts;
}

function countDistribution(
  trades: readonly EvaluatedTrade[],
  selector: (trade: EvaluatedTrade) => number,
): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const trade of trades) {
    const count = selector(trade);
    if (count >= 0 && count <= 5) counts[count] += 1;
  }
  return counts;
}

type EventVolumeAggregate = {
  count: number;
  distinctTrades: number;
  meanVolumeRatio: number | null;
  medianVolumeRatio: number | null;
  volumeUpRatePct: number | null;
  volumeUp1_5RatePct: number | null;
  volumeUp2RatePct: number | null;
};

function aggregateEvents(events: readonly DownEvent[]): EventVolumeAggregate {
  const ratios = events
    .map((event) => event.volumeRatio)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    count: events.length,
    distinctTrades: new Set(events.map((event) => event.trade.securityId)).size,
    meanVolumeRatio: mean(ratios),
    medianVolumeRatio: median(ratios),
    volumeUpRatePct:
      ratios.length === 0
        ? null
        : (ratios.filter((value) => value >= 1).length / ratios.length) * 100,
    volumeUp1_5RatePct:
      ratios.length === 0
        ? null
        : (ratios.filter((value) => value >= 1.5).length / ratios.length) * 100,
    volumeUp2RatePct:
      ratios.length === 0
        ? null
        : (ratios.filter((value) => value >= 2).length / ratios.length) * 100,
  };
}

function eventDayRows(events: readonly DownEvent[]): Array<{
  day: number;
  count: number;
  meanVolumeRatio: number | null;
  medianVolumeRatio: number | null;
  volumeUp1_5RatePct: number | null;
}> {
  return [1, 2, 3, 4, 5].map((day) => {
    const dayEvents = events.filter((event) => event.day === day);
    const ratios = dayEvents
      .map((event) => event.volumeRatio)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    return {
      day,
      count: dayEvents.length,
      meanVolumeRatio: mean(ratios),
      medianVolumeRatio: median(ratios),
      volumeUp1_5RatePct:
        ratios.length === 0
          ? null
          : (ratios.filter((value) => value >= 1.5).length / ratios.length) * 100,
    };
  });
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  callback: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        output[index] = await callback(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeDetailCsv(
  filePath: string,
  trades: readonly EvaluatedTrade[],
): void {
  const headers = [
    "code",
    "name",
    "entryTime",
    "exitTime",
    "reason",
    "holdingPeriod",
    "netPnl",
    "returnPct",
    "bigLossOver5Pct",
    "t0Date",
    "observationDates",
    "observedDayCount",
    "maxCloseDropPct",
    "closeDown5DayCount",
    "closeDown5Dates",
    "firstCloseDown5Date",
    "firstCloseDown5Day",
    "firstDropVolume",
    "firstDropVolumeRatio",
    "windowVolumeVsT0Ratio",
    "t0Volume",
    "t2Volume",
    "t2VolumeRatioVsT0",
    "t2CloseChangePct",
    "closeDown5",
    "intradayDown5",
  ];
  const rows = trades.map((trade) => [
    trade.code,
    trade.name,
    trade.entryTime,
    trade.exitTime,
    trade.reason,
    trade.holdingPeriod,
    trade.netPnl,
    trade.returnPct,
    trade.bigLoss,
    trade.t0Date,
    trade.observationDates.join("|"),
    trade.observedDayCount,
    trade.maxCloseDropPct,
    trade.closeDown5DayCount,
    trade.closeDown5Dates.join("|"),
    trade.firstCloseDown5Date,
    trade.firstCloseDown5Day,
    trade.firstDropVolume,
    trade.firstDropVolumeRatio,
    trade.windowVolumeVsT0Ratio,
    trade.t0Volume,
    trade.t2Volume,
    trade.t2VolumeRatioVsT0,
    trade.t2CloseChangePct,
    trade.closeDown5,
    trade.intradayDown5,
  ]);
  const content = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\r\n`, "utf8");
}

function writeEventCsv(
  filePath: string,
  events: readonly DownEvent[],
): void {
  const headers = [
    "code",
    "name",
    "entryTime",
    "exitTime",
    "tradeReturnPct",
    "tradeNetPnl",
    "bigLossOver5Pct",
    "observationDay",
    "tradeDate",
    "closeChangePct",
    "volume",
    "volumeRatioVsPriorAvg",
  ];
  const rows = events.map((event) => [
    event.trade.code,
    event.trade.name,
    event.trade.entryTime,
    event.trade.exitTime,
    event.trade.returnPct,
    event.trade.netPnl,
    event.trade.bigLoss,
    `T+${event.day}`,
    event.date,
    event.closeChangePct,
    event.volume,
    event.volumeRatio,
  ]);
  const content = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\r\n`, "utf8");
}

function writeExpandedEventCsv(
  filePath: string,
  events: readonly ExpandedDownEvent[],
): void {
  const headers = [
    "code",
    "name",
    "entryTime",
    "exitTime",
    "tradeReturnPct",
    "tradeNetPnl",
    "bigLossOver5Pct",
    "observationDay",
    "tradeDate",
    "closeVsPreClosePct",
    "openToClosePct",
    "trigger",
    "closeTrigger",
    "openCloseTrigger",
    "volume",
    "volumeRatioVsPriorAvg",
  ];
  const rows = events.map((event) => [
    event.trade.code,
    event.trade.name,
    event.trade.entryTime,
    event.trade.exitTime,
    event.trade.returnPct,
    event.trade.netPnl,
    event.trade.bigLoss,
    `T+${event.day}`,
    event.date,
    event.closeChangePct,
    event.openCloseChangePct,
    event.trigger,
    event.closeTrigger,
    event.openCloseTrigger,
    event.volume,
    event.volumeRatio,
  ]);
  const content = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\r\n`, "utf8");
}

async function main(): Promise<void> {
  const topN = Number(optionValue("--topn") ?? "3");
  const strategyId = `first-limit-pullback-3f-top${topN}`;
  const requestedRunId = optionValue("--run-id");
  const list = await withReadRetry(
    `3f-top${topN}.backtest-list`,
    async () => await listClosedLoopBacktestRuns({ strategyId, limit: 100 }),
  );
  const selected =
    requestedRunId === null
      ? list[0]
      : list.find((record) => record.runId === requestedRunId);
  if (!selected) {
    throw new Error(
      requestedRunId === null
        ? `未找到 ${strategyId} 的回测留档`
        : `未找到 runId=${requestedRunId} 的 ${strategyId} 回测留档`,
    );
  }
  const detail = await withReadRetry(
    `3f-top${topN}.backtest-detail`,
    async () => await getClosedLoopBacktestRun(selected.id),
  );
  if (!detail?.result) throw new Error(`留档 ${selected.id} 没有完整结果`);

  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const allTrades = parseTrades(detail.result);
  const completed = allTrades.filter(
    (trade) =>
      !trade.openAtEnd &&
      trade.returnPct !== null &&
      Number.isFinite(trade.returnPct),
  );
  const minEntry = completed.map((trade) => trade.entryTime).sort()[0]!;
  const maxEntry = completed.map((trade) => trade.entryTime).sort().at(-1)!;
  const calendarStart = new Date(`${minEntry}T00:00:00.000Z`);
  calendarStart.setUTCDate(calendarStart.getUTCDate() - 40);
  const calendarEnd = new Date(`${maxEntry}T00:00:00.000Z`);
  calendarEnd.setUTCDate(calendarEnd.getUTCDate() + 5);

  const marketDates = await withReadRetry(
    `3f-top${topN}.observation-calendar`,
    async () =>
      await db
        .selectDistinct({ tradeDate: stockDailyPrices.tradeDate })
        .from(stockDailyPrices)
        .where(
          and(
            gte(stockDailyPrices.tradeDate, calendarStart.toISOString().slice(0, 10)),
            lte(stockDailyPrices.tradeDate, calendarEnd.toISOString().slice(0, 10)),
          ),
        )
        .orderBy(asc(stockDailyPrices.tradeDate)),
  );
  const calendar = buildTradingCalendar(marketDates.map((row) => row.tradeDate), "3f-observation");

  const byCode = new Map<string, Array<{ trade: Trade; dates: string[]; t0Date: string | null }>>();
  for (const trade of completed) {
    if (!trade.code) continue;
    const observation = observationDates(calendar, trade.entryTime);
    const group = byCode.get(trade.code) ?? [];
    group.push({ trade, dates: observation.dates, t0Date: observation.t0Date });
    byCode.set(trade.code, group);
  }

  const rowsByCode = new Map<string, Map<string, DailyRow>>();
  const failures: Array<{ code: string; error: string }> = [];
  await mapLimit([...byCode.entries()], 8, async ([code, items]) => {
    const allDates = items.flatMap((item) => [
      ...(item.t0Date === null ? [] : [item.t0Date]),
      ...item.dates,
    ]);
    const startDate = allDates.sort()[0];
    const endDate = allDates.sort().at(-1);
    if (!startDate || !endDate) return;
    try {
      const rows = await withReadRetry(
        `3f-top${topN}.observation.${code}`,
        async () =>
          await db
            .select({
              tradeDate: stockDailyPrices.tradeDate,
              openPrice: stockDailyPrices.openPrice,
              closePrice: stockDailyPrices.closePrice,
              lowPrice: stockDailyPrices.lowPrice,
              preClosePrice: stockDailyPrices.preClosePrice,
              volume: stockDailyPrices.volume,
            })
            .from(stockDailyPrices)
            .where(
              and(
                eq(stockDailyPrices.stockCode, code),
                gte(stockDailyPrices.tradeDate, startDate),
                lte(stockDailyPrices.tradeDate, endDate),
              ),
            )
            .orderBy(asc(stockDailyPrices.tradeDate)),
      );
      rowsByCode.set(code, new Map(rows.map((row) => [row.tradeDate, row])));
    } catch (error) {
      failures.push({
        code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const evaluated: EvaluatedTrade[] = [];
  for (const trade of completed) {
    if (!trade.code) continue;
    const observation = observationDates(calendar, trade.entryTime);
    const rows = rowsByCode.get(trade.code);
    if (!rows) continue;
    const t0Row =
      observation.t0Date === null ? null : rows.get(observation.t0Date) ?? null;
    const t0Volume = t0Row ? parseVolume(t0Row.volume) : null;
    const priorVolumes: number[] = t0Volume === null ? [] : [t0Volume];
    const observationVolumes: number[] = [];
    const dailyChanges = observation.dates.map((date) => {
      const row = rows.get(date);
      const open = row ? parseNumber(row.openPrice) : null;
      const close = row ? parseNumber(row.closePrice) : null;
      const low = row ? parseNumber(row.lowPrice) : null;
      const preClose = row ? parseNumber(row.preClosePrice) : null;
      const volume = row ? parseVolume(row.volume) : null;
      const closeChangePct = changePct(close, preClose);
      const openCloseChangePct = changePct(close, open);
      const priorAverageVolume = mean(priorVolumes);
      const volumeRatioVsPriorAvg =
        volume === null || priorAverageVolume === null || priorAverageVolume <= 0
          ? null
          : volume / priorAverageVolume;
      if (volume !== null) {
        priorVolumes.push(volume);
        observationVolumes.push(volume);
      }
      return {
        date,
        closeChangePct,
        openCloseChangePct,
        intradayDropPct: intradayDropPct(low, preClose),
        expandedDown:
          (closeChangePct !== null &&
            closeChangePct <= SINGLE_DAY_DROP_THRESHOLD_PCT) ||
          (openCloseChangePct !== null &&
            openCloseChangePct <= SINGLE_DAY_DROP_THRESHOLD_PCT),
        volume,
        volumeRatioVsPriorAvg,
      };
    });
    const closeChanges = dailyChanges
      .map((item) => item.closeChangePct)
      .filter((value): value is number => value !== null);
    const maxCloseDropPct =
      closeChanges.length === 0 ? null : Math.min(...closeChanges);
    const closeDown5DayCount = closeChanges.filter(
      (value) => value <= SINGLE_DAY_DROP_THRESHOLD_PCT,
    ).length;
    const expandedDownDates = dailyChanges
      .filter((item) => item.expandedDown)
      .map((item) => item.date);
    const closeDown5Dates = dailyChanges
      .filter(
        (item) =>
          item.closeChangePct !== null &&
          item.closeChangePct <= SINGLE_DAY_DROP_THRESHOLD_PCT,
      )
      .map((item) => item.date);
    const firstCloseDown5Date = closeDown5Dates[0] ?? null;
    const firstCloseDown5Day =
      firstCloseDown5Date === null
        ? null
        : observation.dates.indexOf(firstCloseDown5Date) + 1;
    const firstDrop = dailyChanges.find(
      (item) => item.date === firstCloseDown5Date,
    );
    const averageObservationVolume = mean(observationVolumes);
    const windowVolumeVsT0Ratio =
      t0Volume === null ||
      t0Volume <= 0 ||
      averageObservationVolume === null
        ? null
        : averageObservationVolume / t0Volume;
    const t2Point = dailyChanges[1] ?? null;
    const t2VolumeRatioVsT0 =
      t0Volume === null ||
      t0Volume <= 0 ||
      t2Point?.volume === null ||
      t2Point?.volume === undefined
        ? null
        : t2Point.volume / t0Volume;
    const returnPct = trade.returnPct!;
    evaluated.push({
      ...trade,
      t0Date: observation.t0Date,
      observationDates: observation.dates,
      observedDayCount: closeChanges.length,
      dailyChanges,
      maxCloseDropPct,
      closeDown5DayCount,
      closeDown5Dates,
      firstCloseDown5Date,
      firstCloseDown5Day,
      firstDropVolume: firstDrop?.volume ?? null,
      firstDropVolumeRatio: firstDrop?.volumeRatioVsPriorAvg ?? null,
      windowVolumeVsT0Ratio,
      t0Volume,
      t2Volume: t2Point?.volume ?? null,
      t2VolumeRatioVsT0,
      t2CloseChangePct: t2Point?.closeChangePct ?? null,
      closeDown5: closeDown5DayCount > 0,
      expandedDownDates,
      expandedDownDayCount: expandedDownDates.length,
      expandedDown: expandedDownDates.length > 0,
      intradayDown5: dailyChanges.some(
        (item) =>
          item.intradayDropPct !== null &&
          item.intradayDropPct <= SINGLE_DAY_DROP_THRESHOLD_PCT,
      ),
      bigLoss: returnPct < BIG_LOSS_THRESHOLD_PCT,
    });
  }

  const all = evaluated;
  const bigLoss = evaluated.filter((trade) => trade.bigLoss);
  const bigLossCloseDown5 = bigLoss.filter((trade) => trade.closeDown5);
  const bigLossNoCloseDown5 = bigLoss.filter((trade) => !trade.closeDown5);
  const bigLossIntradayDown5 = bigLoss.filter((trade) => trade.intradayDown5);
  const noneBigLossCloseDown5 = all.filter((trade) => !trade.bigLoss && trade.closeDown5);
  const allDownEvents: DownEvent[] = evaluated.flatMap((trade) =>
    trade.dailyChanges.flatMap((item) =>
      item.closeChangePct !== null &&
      item.closeChangePct <= SINGLE_DAY_DROP_THRESHOLD_PCT
        ? [{
            trade,
            date: item.date,
            day: trade.observationDates.indexOf(item.date) + 1,
            closeChangePct: item.closeChangePct,
            volume: item.volume,
            volumeRatio: item.volumeRatioVsPriorAvg,
          }]
        : [],
    ),
  );
  const bigLossEvents = allDownEvents.filter((event) => event.trade.bigLoss);
  const nonBigLossEvents = allDownEvents.filter((event) => !event.trade.bigLoss);
  const allExpandedDownEvents: ExpandedDownEvent[] = evaluated.flatMap((trade) =>
    trade.dailyChanges.flatMap((item) => {
      if (!item.expandedDown) return [];
      const closeTrigger =
        item.closeChangePct !== null &&
        item.closeChangePct <= SINGLE_DAY_DROP_THRESHOLD_PCT;
      const openCloseTrigger =
        item.openCloseChangePct !== null &&
        item.openCloseChangePct <= SINGLE_DAY_DROP_THRESHOLD_PCT;
      return [{
        trade,
        date: item.date,
        day: trade.observationDates.indexOf(item.date) + 1,
        closeChangePct: item.closeChangePct ?? 0,
        openCloseChangePct: item.openCloseChangePct,
        volume: item.volume,
        volumeRatio: item.volumeRatioVsPriorAvg,
        closeTrigger,
        openCloseTrigger,
        trigger:
          closeTrigger && openCloseTrigger
            ? "两项同时满足"
            : openCloseTrigger
              ? "开盘至收盘跌幅"
              : "收盘跌幅",
      }];
    }),
  );
  const expandedBigLossEvents = allExpandedDownEvents.filter(
    (event) => event.trade.bigLoss,
  );
  const expandedNonBigLossEvents = allExpandedDownEvents.filter(
    (event) => !event.trade.bigLoss,
  );

  const groups = [
    { key: "ALL", label: "总体有效交易", trades: all },
    { key: "BIG_LOSS", label: "亏损超过5%", trades: bigLoss },
    {
      key: "BIG_LOSS_CLOSE_DROP5",
      label: "亏损超过5%且T+1~T+5收盘单日跌幅>=5%",
      trades: bigLossCloseDown5,
    },
    {
      key: "BIG_LOSS_NO_CLOSE_DROP5",
      label: "亏损超过5%但观察期无收盘单日跌幅>=5%",
      trades: bigLossNoCloseDown5,
    },
    {
      key: "BIG_LOSS_INTRADAY_DROP5",
      label: "亏损超过5%且T+1~T+5盘中最低价跌幅>=5%",
      trades: bigLossIntradayDown5,
    },
    {
      key: "NON_BIG_LOSS_CLOSE_DROP5",
      label: "非大亏交易但T+1~T+5收盘单日跌幅>=5%",
      trades: noneBigLossCloseDown5,
    },
  ].map((group) => ({
    ...group,
    stats: aggregate(group.trades),
  }));

  const byKey = new Map(groups.map((group) => [group.key, group]));
  const allStats = byKey.get("ALL")!.stats;
  const bigLossStats = byKey.get("BIG_LOSS")!.stats;
  const target = byKey.get("BIG_LOSS_CLOSE_DROP5")!;
  const targetStats = target.stats;
  const control = byKey.get("BIG_LOSS_NO_CLOSE_DROP5")!;
  const bigLossNoDropCount = bigLoss.length - bigLossCloseDown5.length;
  const nonBigLossNoDropCount =
    all.length - bigLoss.length - noneBigLossCloseDown5.length;
  const dayComparison = [
    {
      label: "大亏且有5%单日下跌",
      trades: bigLossCloseDown5,
      noDropCount: bigLossNoDropCount,
    },
    {
      label: "非大亏但有5%单日下跌",
      trades: noneBigLossCloseDown5,
      noDropCount: nonBigLossNoDropCount,
    },
  ].map((group) => ({
    ...group,
    firstDayCounts: firstDayCounts(group.trades),
    allDayCounts: allDayCounts(group.trades),
  }));
  const eventComparison = [
    {
      label: "大亏组全部5%下跌事件",
      events: bigLossEvents,
      stats: aggregateEvents(bigLossEvents),
    },
    {
      label: "非大亏组全部5%下跌事件",
      events: nonBigLossEvents,
      stats: aggregateEvents(nonBigLossEvents),
    },
  ];
  const eventDayComparison = [
    { label: "大亏组", rows: eventDayRows(bigLossEvents) },
    { label: "非大亏组", rows: eventDayRows(nonBigLossEvents) },
  ];
  const eventVolumeBuckets = [
    {
      label: "缩量 <1x",
      events: allDownEvents.filter(
        (event) => event.volumeRatio !== null && event.volumeRatio < 1,
      ),
    },
    {
      label: "温和放量 1~1.5x",
      events: allDownEvents.filter(
        (event) =>
          event.volumeRatio !== null &&
          event.volumeRatio >= 1 &&
          event.volumeRatio < 1.5,
      ),
    },
    {
      label: "明显放量 >=1.5x",
      events: allDownEvents.filter(
        (event) => event.volumeRatio !== null && event.volumeRatio >= 1.5,
      ),
    },
  ].map((bucket) => ({
    ...bucket,
    stats: aggregateEvents(bucket.events),
    bigLossEventSharePct:
      bucket.events.length === 0
        ? null
        : (bucket.events.filter((event) => event.trade.bigLoss).length /
            bucket.events.length) *
          100,
  }));
  const expandedEventComparison = [
    {
      label: "大亏组扩展下跌事件",
      events: expandedBigLossEvents,
      stats: aggregateEvents(expandedBigLossEvents),
    },
    {
      label: "非大亏组扩展下跌事件",
      events: expandedNonBigLossEvents,
      stats: aggregateEvents(expandedNonBigLossEvents),
    },
  ];
  const expandedTriggerCounts = (
    ["收盘跌幅", "开盘至收盘跌幅", "两项同时满足"] as const
  ).map((trigger) => ({
    trigger,
    count: allExpandedDownEvents.filter((event) => event.trigger === trigger)
      .length,
  }));
  const expandedBigLossDistribution = countDistribution(
    bigLoss,
    (trade) => trade.expandedDownDayCount,
  );
  const expandedNonBigLossDistribution = countDistribution(
    all.filter((trade) => !trade.bigLoss),
    (trade) => trade.expandedDownDayCount,
  );
  const expandedBigLossMultiCount = expandedBigLossDistribution
    .slice(2)
    .reduce((sum, count) => sum + count, 0);
  const expandedNonBigLossMultiCount = expandedNonBigLossDistribution
    .slice(2)
    .reduce((sum, count) => sum + count, 0);
  const expandedAllMultiCount =
    expandedBigLossMultiCount + expandedNonBigLossMultiCount;
  const t2RatioValid = all.filter(
    (trade) =>
      trade.t2VolumeRatioVsT0 !== null &&
      Number.isFinite(trade.t2VolumeRatioVsT0),
  );
  const t2Shrunk = t2RatioValid.filter(
    (trade) => trade.t2VolumeRatioVsT0! < 1,
  );
  const t2NotShrunk = t2RatioValid.filter(
    (trade) => trade.t2VolumeRatioVsT0! >= 1,
  );
  const t2BucketDefinitions = [
    { label: "<0.5x", min: 0, max: 0.5, maxInclusive: false },
    { label: "0.5~0.8x", min: 0.5, max: 0.8, maxInclusive: false },
    { label: "0.8~1.0x", min: 0.8, max: 1, maxInclusive: false },
    { label: "1.0~1.2x", min: 1, max: 1.2, maxInclusive: false },
    { label: "1.2~1.5x", min: 1.2, max: 1.5, maxInclusive: false },
    { label: ">=1.5x", min: 1.5, max: Number.POSITIVE_INFINITY, maxInclusive: true },
  ] as const;
  const t2VolumeRows = t2BucketDefinitions.map((bucket) => {
    const trades = t2RatioValid.filter((trade) => {
      const ratio = trade.t2VolumeRatioVsT0!;
      return bucket.maxInclusive
        ? ratio >= bucket.min
        : ratio >= bucket.min && ratio < bucket.max;
    });
    return { label: bucket.label, trades, stats: aggregate(trades) };
  });
  const t2InteractionGroups = [
    {
      label: "T+2缩量且下跌",
      trades: t2RatioValid.filter(
        (trade) =>
          trade.t2VolumeRatioVsT0! < 1 &&
          trade.t2CloseChangePct !== null &&
          trade.t2CloseChangePct < 0,
      ),
    },
    {
      label: "T+2缩量且上涨/平盘",
      trades: t2RatioValid.filter(
        (trade) =>
          trade.t2VolumeRatioVsT0! < 1 &&
          trade.t2CloseChangePct !== null &&
          trade.t2CloseChangePct >= 0,
      ),
    },
    {
      label: "T+2不缩量且下跌",
      trades: t2RatioValid.filter(
        (trade) =>
          trade.t2VolumeRatioVsT0! >= 1 &&
          trade.t2CloseChangePct !== null &&
          trade.t2CloseChangePct < 0,
      ),
    },
    {
      label: "T+2不缩量且上涨/平盘",
      trades: t2RatioValid.filter(
        (trade) =>
          trade.t2VolumeRatioVsT0! >= 1 &&
          trade.t2CloseChangePct !== null &&
          trade.t2CloseChangePct >= 0,
      ),
    },
  ].map((group) => ({ ...group, stats: aggregate(group.trades) }));

  console.log(`\n3F Top${topN} T+1~T+5 单日下跌 >= 5% 统计`);
  console.log(`runId: ${selected.runId}`);
  console.log(`strategyVersion: ${selected.strategyVersion}`);
  console.log(
    `成交明细 ${allTrades.length} 笔，完成交易 ${completed.length} 笔，` +
      `可计算观察窗 ${all.length} 笔，行情读取失败代码 ${failures.length} 个`,
  );
  console.log(
    `亏损阈值: 收益率 < ${BIG_LOSS_THRESHOLD_PCT}%；单日下跌阈值: 收盘涨跌幅 <= ${SINGLE_DAY_DROP_THRESHOLD_PCT}%`,
  );

  for (const group of groups) {
    console.log(`\n[${group.label}]`);
    console.log(
      `交易 ${group.stats.count} 笔 / 股票 ${group.stats.distinctCodes} 只，` +
        `平均净盈亏 ${formatNumber(group.stats.meanNetPnl)} 元，` +
        `平均收益率 ${formatPct(group.stats.meanReturnPct)}，` +
        `中位收益率 ${formatPct(group.stats.medianReturnPct)}，` +
        `胜率 ${formatPct(group.stats.winRatePct)}，` +
        `盈亏比 ${formatNumber(group.stats.profitFactor, 4)}`,
    );
    console.log(
      `止损退出 ${formatPct(group.stats.stopLossRatePct)}，` +
        `平均最大单日收盘跌幅 ${formatPct(group.stats.meanMaxCloseDropPct)}，` +
        `平均下跌>=5%天数 ${formatNumber(group.stats.meanCloseDown5Days)}，` +
        `有效观察日 ${formatNumber(group.stats.meanObservedDays)} 天，` +
        `观察窗平均量比(T0基准) ${formatNumber(group.stats.meanWindowVolumeVsT0Ratio, 2)}`,
    );
    console.log(
      `首次5%下跌量比: 平均 ${formatNumber(group.stats.meanFirstDropVolumeRatio, 2)}，` +
        `中位 ${formatNumber(group.stats.medianFirstDropVolumeRatio, 2)}，` +
        `>=1x ${formatPct(group.stats.volumeUpRatePct)}，` +
        `>=1.5x ${formatPct(group.stats.volumeUp1_5RatePct)}，` +
        `>=2x ${formatPct(group.stats.volumeUp2RatePct)}`,
    );
  }

  console.log(`\n[目标组 vs 总体]`);
  console.log(
    `平均收益率差 ${formatPct(
      targetStats.meanReturnPct === null || allStats.meanReturnPct === null
        ? null
        : targetStats.meanReturnPct - allStats.meanReturnPct,
    )}；平均净盈亏差 ${formatNumber(
      targetStats.meanNetPnl === null || allStats.meanNetPnl === null
        ? null
        : targetStats.meanNetPnl - allStats.meanNetPnl,
    )} 元`,
  );
  console.log(
    `占全部交易 ${formatPct((targetStats.count / allStats.count) * 100)}；` +
      `占亏损超过5%交易 ${formatPct((targetStats.count / bigLossStats.count) * 100)}`,
  );
  const targetVsControlReturnCi = bootstrapMeanDifferenceCi(
    target.trades.map((trade) => trade.returnPct!),
    control.trades.map((trade) => trade.returnPct!),
  );
  const targetVsControlNetPnlCi = bootstrapMeanDifferenceCi(
    target.trades.map((trade) => trade.netPnl!),
    control.trades.map((trade) => trade.netPnl!),
  );
  console.log(
    `目标组相对“大亏但无单日跌幅>=5%”对照组：收益率差 95% CI ` +
      `[${formatPct(targetVsControlReturnCi?.lower)}, ${formatPct(targetVsControlReturnCi?.upper)}]；` +
      `净盈亏差 95% CI ` +
      `[${formatNumber(targetVsControlNetPnlCi?.lower)}, ${formatNumber(targetVsControlNetPnlCi?.upper)}] 元`,
  );

  const t2ShrunkStats = aggregate(t2Shrunk);
  const t2NotShrunkStats = aggregate(t2NotShrunk);
  const t2ReturnCi = bootstrapMeanDifferenceCi(
    t2NotShrunk.map((trade) => trade.returnPct!),
    t2Shrunk.map((trade) => trade.returnPct!),
  );
  const t2NetPnlCi = bootstrapMeanDifferenceCi(
    t2NotShrunk.map((trade) => trade.netPnl!),
    t2Shrunk.map((trade) => trade.netPnl!),
  );
  const t2BigLossCi = bootstrapMeanDifferenceCi(
    t2NotShrunk.map((trade) => (trade.bigLoss ? 1 : 0)),
    t2Shrunk.map((trade) => (trade.bigLoss ? 1 : 0)),
  );
  console.log(`\n[T+2成交量 / T0成交量]`);
  console.log(
    `缩量 <1x: ${t2ShrunkStats.count} 笔，平均收益率 ${formatPct(t2ShrunkStats.meanReturnPct)}，` +
      `中位 ${formatPct(t2ShrunkStats.medianReturnPct)}，平均净盈亏 ${formatNumber(t2ShrunkStats.meanNetPnl)} 元，` +
      `胜率 ${formatPct(t2ShrunkStats.winRatePct)}，大亏率 ${formatPct(t2ShrunkStats.bigLossRatePct)}，` +
      `止损率 ${formatPct(t2ShrunkStats.stopLossRatePct)}`,
  );
  console.log(
    `不缩量 >=1x: ${t2NotShrunkStats.count} 笔，平均收益率 ${formatPct(t2NotShrunkStats.meanReturnPct)}，` +
      `中位 ${formatPct(t2NotShrunkStats.medianReturnPct)}，平均净盈亏 ${formatNumber(t2NotShrunkStats.meanNetPnl)} 元，` +
      `胜率 ${formatPct(t2NotShrunkStats.winRatePct)}，大亏率 ${formatPct(t2NotShrunkStats.bigLossRatePct)}，` +
      `止损率 ${formatPct(t2NotShrunkStats.stopLossRatePct)}`,
  );
  console.log(
    `不缩量相对缩量：收益率差 ${formatPct(
      (t2NotShrunkStats.meanReturnPct ?? 0) -
        (t2ShrunkStats.meanReturnPct ?? 0),
    )}，95% CI [${formatPct(t2ReturnCi?.lower)}, ${formatPct(t2ReturnCi?.upper)}]；` +
      `大亏率差 ${formatPct(
        (t2NotShrunkStats.bigLossRatePct ?? 0) -
          (t2ShrunkStats.bigLossRatePct ?? 0),
      )}，95% CI [${formatPct((t2BigLossCi?.lower ?? 0) * 100)}, ${formatPct((t2BigLossCi?.upper ?? 0) * 100)}]；` +
      `净盈亏差 ${formatNumber(
        (t2NotShrunkStats.meanNetPnl ?? 0) - (t2ShrunkStats.meanNetPnl ?? 0),
      )} 元，95% CI [${formatNumber(t2NetPnlCi?.lower)}, ${formatNumber(t2NetPnlCi?.upper)}]`,
  );
  console.log(`\n[T+2量比分档后的最终结果]`);
  for (const row of t2VolumeRows) {
    console.log(
      `${row.label}: ${row.stats.count} 笔，平均收益率 ${formatPct(row.stats.meanReturnPct)}，` +
        `中位 ${formatPct(row.stats.medianReturnPct)}，胜率 ${formatPct(row.stats.winRatePct)}，` +
        `大亏率 ${formatPct(row.stats.bigLossRatePct)}，平均净盈亏 ${formatNumber(row.stats.meanNetPnl)} 元`,
    );
  }
  console.log(`\n[T+2量能与当日涨跌交叉]`);
  for (const group of t2InteractionGroups) {
    console.log(
      `${group.label}: ${group.stats.count} 笔，平均收益率 ${formatPct(group.stats.meanReturnPct)}，` +
        `胜率 ${formatPct(group.stats.winRatePct)}，大亏率 ${formatPct(group.stats.bigLossRatePct)}，` +
        `止损率 ${formatPct(group.stats.stopLossRatePct)}`,
    );
  }

  console.log(`\n[全部5%单日下跌事件汇总]`);
  for (const group of eventComparison) {
    console.log(
      `${group.label}: 事件 ${group.stats.count} 次 / 交易 ${group.stats.distinctTrades} 笔，` +
        `平均量比 ${formatNumber(group.stats.meanVolumeRatio, 2)}x，` +
        `中位量比 ${formatNumber(group.stats.medianVolumeRatio, 2)}x，` +
        `>=1x ${formatPct(group.stats.volumeUpRatePct)}，` +
        `>=1.5x ${formatPct(group.stats.volumeUp1_5RatePct)}，` +
        `>=2x ${formatPct(group.stats.volumeUp2RatePct)}`,
    );
  }

  console.log(`\n[全部5%下跌事件按观察日汇总]`);
  for (let index = 0; index < 5; index += 1) {
    const bigRow = eventDayComparison[0]!.rows[index]!;
    const nonBigRow = eventDayComparison[1]!.rows[index]!;
    console.log(
      `T+${bigRow.day}: ` +
        `大亏事件 ${bigRow.count} 次，平均量比 ${formatNumber(bigRow.meanVolumeRatio, 2)}x，` +
        `中位 ${formatNumber(bigRow.medianVolumeRatio, 2)}x，>=1.5x ${formatPct(bigRow.volumeUp1_5RatePct)}；` +
        `非大亏事件 ${nonBigRow.count} 次，平均量比 ${formatNumber(nonBigRow.meanVolumeRatio, 2)}x，` +
        `中位 ${formatNumber(nonBigRow.medianVolumeRatio, 2)}x，>=1.5x ${formatPct(nonBigRow.volumeUp1_5RatePct)}`,
    );
  }

  console.log(`\n[全部5%下跌事件按量能分档]`);
  for (const bucket of eventVolumeBuckets) {
    console.log(
      `${bucket.label}: 事件 ${bucket.events.length} 次，` +
        `其中大亏事件占比 ${formatPct(bucket.bigLossEventSharePct)}，` +
        `涉及交易 ${bucket.stats.distinctTrades} 笔`,
    );
  }

  console.log(`\n[扩展口径：收盘跌幅或开盘至收盘跌幅 <= -5%]`);
  console.log(
    `扩展事件合计 ${allExpandedDownEvents.length} 次；` +
      expandedTriggerCounts
        .map((item) => `${item.trigger} ${item.count} 次`)
        .join("，"),
  );
  for (const group of expandedEventComparison) {
    console.log(
      `${group.label}: 事件 ${group.stats.count} 次 / 交易 ${group.stats.distinctTrades} 笔，` +
        `平均量比 ${formatNumber(group.stats.meanVolumeRatio, 2)}x，` +
        `中位 ${formatNumber(group.stats.medianVolumeRatio, 2)}x，` +
        `>=1.5x ${formatPct(group.stats.volumeUp1_5RatePct)}`,
    );
  }

  console.log(`\n[扩展口径下每笔交易的下跌天数分布]`);
  console.log(
    `大亏组: ` +
      expandedBigLossDistribution
        .map((count, day) => `${day}次 ${count}`)
        .join("，") +
      `；多次(>=2次) ${expandedBigLossMultiCount} 笔，` +
      `占大亏组 ${formatPct((expandedBigLossMultiCount / bigLoss.length) * 100)}`,
  );
  console.log(
    `非大亏组: ` +
      expandedNonBigLossDistribution
        .map((count, day) => `${day}次 ${count}`)
        .join("，") +
      `；多次(>=2次) ${expandedNonBigLossMultiCount} 笔，` +
      `占非大亏组 ${formatPct((expandedNonBigLossMultiCount / all.filter((trade) => !trade.bigLoss).length) * 100)}`,
  );
  console.log(
    `全部多次下跌交易 ${expandedAllMultiCount} 笔，其中大亏 ` +
      `${formatPct((expandedBigLossMultiCount / expandedAllMultiCount) * 100)}，` +
      `非大亏 ${formatPct((expandedNonBigLossMultiCount / expandedAllMultiCount) * 100)}`,
  );

  console.log(`\n[首次出现5%单日下跌的观察日]`);
  for (const group of dayComparison) {
    console.log(
      `${group.label}: ` +
        `T+1 ${group.firstDayCounts[1]}，T+2 ${group.firstDayCounts[2]}，` +
        `T+3 ${group.firstDayCounts[3]}，T+4 ${group.firstDayCounts[4]}，` +
        `T+5 ${group.firstDayCounts[5]}；无该信号 ${group.noDropCount}`,
    );
    const ratiosByDay = [1, 2, 3, 4, 5].map((day) => {
      const ratios = group.trades
        .filter((trade) => trade.firstCloseDown5Day === day)
        .map((trade) => trade.firstDropVolumeRatio)
        .filter(
          (value): value is number => value !== null && Number.isFinite(value),
        );
      return mean(ratios);
    });
    console.log(
      `  首次下跌量比均值: ` +
        `T+1 ${formatNumber(ratiosByDay[0], 2)}x，` +
        `T+2 ${formatNumber(ratiosByDay[1], 2)}x，` +
        `T+3 ${formatNumber(ratiosByDay[2], 2)}x，` +
        `T+4 ${formatNumber(ratiosByDay[3], 2)}x，` +
        `T+5 ${formatNumber(ratiosByDay[4], 2)}x`,
    );
  }
  console.log(`\n[所有5%单日下跌事件次数，含同日/多次]`);
  for (const group of dayComparison) {
    console.log(
      `${group.label}: ` +
        `T+1 ${group.allDayCounts[1]}，T+2 ${group.allDayCounts[2]}，` +
        `T+3 ${group.allDayCounts[3]}，T+4 ${group.allDayCounts[4]}，` +
        `T+5 ${group.allDayCounts[5]}`,
    );
  }

  const detailCsv = optionValue("--out-csv");
  if (detailCsv !== null) {
    writeDetailCsv(detailCsv, evaluated);
    console.log(`\n明细 CSV: ${path.resolve(detailCsv)}`);
  }
  const eventCsv = optionValue("--out-events-csv");
  if (eventCsv !== null) {
    writeEventCsv(eventCsv, allDownEvents);
    console.log(`逐事件 CSV: ${path.resolve(eventCsv)}`);
  }
  const expandedEventCsv = optionValue("--out-expanded-events-csv");
  if (expandedEventCsv !== null) {
    writeExpandedEventCsv(expandedEventCsv, allExpandedDownEvents);
    console.log(`扩展逐事件 CSV: ${path.resolve(expandedEventCsv)}`);
  }
  if (failures.length > 0) {
    console.log("\n行情读取失败代码:");
    for (const failure of failures) {
      console.log(`${failure.code}: ${failure.error}`);
    }
  }
}

try {
  await main();
} finally {
  const db = await getDb();
  const client = (db as unknown as { $client?: { end?: () => Promise<void> } } | null)
    ?.$client;
  if (client?.end) await client.end();
}
