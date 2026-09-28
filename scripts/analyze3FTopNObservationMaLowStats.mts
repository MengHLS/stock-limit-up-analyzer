/**
 * 3F Top3 v1.11.0：统计 T+1..T+5 观察窗内连续收盘低于 MA5、MA10 的成交样本。
 *
 * 主口径：
 *   - 每天使用的 MA5 / MA10 均包含当日收盘；
 *   - “连续低于 MA5” = T+1..T+5 五个交易日每天都满足 close < MA5；
 *   - “连续低于 MA10” = T+1..T+5 五个交易日每天都满足 close < MA10；
 *   - “连续同时低于” = T+1..T+5 五个交易日每天都满足 close < MA5 且 close < MA10。
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { stockDailyPrices } from "../drizzle/schema";
import {
  getClosedLoopBacktestRun,
  listClosedLoopBacktestRuns,
} from "../server/closedLoopBacktestRun/repository";
import { getDb } from "../server/db";

type Trade = {
  securityId: string;
  code: string | null;
  name: string | null;
  entryTime: string;
  returnPct: number | null;
  netPnl: number | null;
  reason: string | null;
  openAtEnd: boolean;
};

type DailyBar = {
  tradeDate: string;
  open: number;
  close: number;
};

type ObservationDay = {
  day: number;
  bar: DailyBar;
  ma5: number | null;
  ma10: number | null;
  belowMa5: boolean;
  belowMa10: boolean;
  belowBoth: boolean;
};

type ProfitTier =
  | "WIN_GE_10"
  | "WIN_5_TO_10"
  | "WIN_0_TO_5"
  | "FLAT"
  | "LOSS_0_TO_5"
  | "LOSS_5_TO_10"
  | "LOSS_GE_10"
  | "OPEN_AT_END";

type EvaluatedTrade = Trade & {
  eventDate: string;
  days: ObservationDay[];
  continuousBelowMa5: boolean;
  continuousBelowMa10: boolean;
  continuousBelowBoth: boolean;
  lowDayCountBoth: number;
  maxConsecutiveBelowBoth: number;
  tail3LowDayCountBoth: number;
  tail3MaxConsecutiveBelowBoth: number;
  t6Date: string | null;
  t6Open: number | null;
  entryMa5: number | null;
  entryMa10: number | null;
  entryBelowMa5: boolean;
  entryBelowMa10: boolean;
  entryBelowBoth: boolean;
  tier: ProfitTier;
  netPnlValue: number;
};

const PROFIT_TIERS: readonly ProfitTier[] = [
  "WIN_GE_10",
  "WIN_5_TO_10",
  "WIN_0_TO_5",
  "FLAT",
  "LOSS_0_TO_5",
  "LOSS_5_TO_10",
  "LOSS_GE_10",
  "OPEN_AT_END",
];

function argOf(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function round(value: number | null, digits = 4): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : (numerator / denominator) * 100;
}

function shiftCalendarDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function parseEventDate(securityId: string): string | null {
  return securityId.match(/@(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null;
}

function tierOf(value: number | null, openAtEnd: boolean): ProfitTier {
  if (openAtEnd || value === null) return "OPEN_AT_END";
  if (value >= 10) return "WIN_GE_10";
  if (value >= 5) return "WIN_5_TO_10";
  if (value > 0) return "WIN_0_TO_5";
  if (value === 0) return "FLAT";
  if (value > -5) return "LOSS_0_TO_5";
  if (value > -10) return "LOSS_5_TO_10";
  return "LOSS_GE_10";
}

function tradeFromUnknown(value: unknown): Trade | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.securityId !== "string" || typeof row.entryTime !== "string") return null;
  return {
    securityId: row.securityId,
    code: typeof row.code === "string" ? row.code : null,
    name: typeof row.name === "string" ? row.name : null,
    entryTime: row.entryTime,
    returnPct: typeof row.returnPct === "number" ? row.returnPct : null,
    netPnl: typeof row.netPnl === "number" ? row.netPnl : null,
    reason: typeof row.reason === "string" ? row.reason : null,
    openAtEnd: row.openAtEnd === true,
  };
}

function tradesOfResult(result: unknown): Trade[] {
  if (result === null || typeof result !== "object") return [];
  const stages = (result as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];
  const backtest = stages.find(
    stage => stage !== null
      && typeof stage === "object"
      && (stage as { stageId?: unknown }).stageId === "backtest",
  );
  const output = backtest !== null && typeof backtest === "object"
    ? (backtest as { output?: unknown }).output
    : null;
  const trades = output !== null && typeof output === "object"
    ? (output as { trades?: unknown }).trades
    : null;
  return Array.isArray(trades)
    ? trades.map(tradeFromUnknown).filter((trade): trade is Trade => trade !== null)
    : [];
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function summarizeGroup(label: string, rows: readonly EvaluatedTrade[]) {
  const completed = rows.filter(row => row.tier !== "OPEN_AT_END");
  const returns = completed.map(row => row.returnPct!);
  const wins = returns.filter(value => value > 0);
  const losses = returns.filter(value => value < 0);
  const stops = completed.filter(row => row.reason?.includes("止损") === true);
  const totalWin = completed
    .filter(row => row.returnPct! > 0)
    .reduce((sum, row) => sum + row.netPnlValue, 0);
  const totalLoss = Math.abs(completed
    .filter(row => row.returnPct! < 0)
    .reduce((sum, row) => sum + row.netPnlValue, 0));
  return {
    label,
    tradeCount: rows.length,
    completedCount: completed.length,
    openAtEndCount: rows.length - completed.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: round(percent(wins.length, completed.length)),
    stopCount: stops.length,
    stopRatePct: round(percent(stops.length, completed.length)),
    meanReturnPct: round(mean(returns)),
    medianReturnPct: round(median(returns)),
    profitFactor: totalLoss === 0 ? null : round(totalWin / totalLoss),
    totalNetPnl: round(completed.reduce((sum, row) => sum + row.netPnlValue, 0), 2),
    byTier: Object.fromEntries(
      PROFIT_TIERS.map(tier => {
        const count = rows.filter(row => row.tier === tier).length;
        return [tier, {
          count,
          sharePct: round(percent(count, rows.length)),
        }];
      }),
    ),
  };
}

const requestedRunId = argOf("run-id");
const history = await listClosedLoopBacktestRuns({
  strategyId: "first-limit-pullback-3f-top3",
  limit: 50,
});
const run = requestedRunId === null
  ? history.find(item => item.strategyVersion === "1.11.0")
  : history.find(item => item.runId === requestedRunId);
if (run === undefined) throw new Error("未找到 3F Top3 v1.11.0 留档。");
const detail = await getClosedLoopBacktestRun(run.id);
const trades = tradesOfResult(detail?.result);
if (trades.length === 0) throw new Error(`留档 ${run.id} 没有可读成交。`);

const codes = [...new Set(trades.map(trade => trade.code).filter((code): code is string => code !== null))];
const eventDates = trades
  .map(trade => parseEventDate(trade.securityId))
  .filter((date): date is string => date !== null)
  .sort();
const minDate = shiftCalendarDays(eventDates[0]!, -30);
const maxDate = shiftCalendarDays(eventDates.at(-1)!, 30);

const db = await getDb();
if (!db) throw new Error("数据库不可用。");
const barsByCode = new Map<string, DailyBar[]>();
for (let index = 0; index < codes.length; index += 200) {
  const rows = await db
    .select({
      stockCode: stockDailyPrices.stockCode,
      tradeDate: stockDailyPrices.tradeDate,
      openPrice: stockDailyPrices.openPrice,
      closePrice: stockDailyPrices.closePrice,
    })
    .from(stockDailyPrices)
    .where(and(
      inArray(stockDailyPrices.stockCode, codes.slice(index, index + 200)),
      gte(stockDailyPrices.tradeDate, minDate),
      lte(stockDailyPrices.tradeDate, maxDate),
    ))
    .orderBy(asc(stockDailyPrices.stockCode), asc(stockDailyPrices.tradeDate));
  for (const row of rows) {
    if (row.openPrice === null || row.closePrice === null) continue;
    const open = Number(row.openPrice);
    const close = Number(row.closePrice);
    if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0 || close <= 0) continue;
    const bar = { tradeDate: row.tradeDate, open, close };
    const bucket = barsByCode.get(row.stockCode);
    if (bucket === undefined) barsByCode.set(row.stockCode, [bar]);
    else bucket.push(bar);
  }
}

function movingAverage(bars: readonly DailyBar[], endIndex: number, window: number): number | null {
  if (endIndex + 1 < window) return null;
  return mean(bars.slice(endIndex + 1 - window, endIndex + 1).map(bar => bar.close));
}

const evaluated: EvaluatedTrade[] = trades.map(trade => {
  const eventDate = parseEventDate(trade.securityId) ?? "";
  const bars = trade.code === null ? undefined : barsByCode.get(trade.code);
  const eventIndex = bars === undefined ? -1 : bars.findIndex(bar => bar.tradeDate === eventDate);
  const days: ObservationDay[] = [];
  for (let day = 1; day <= 5; day += 1) {
    const dayIndex = eventIndex < 0 ? -1 : eventIndex + day;
    const bar = bars?.[dayIndex];
    if (bar === undefined) continue;
    const ma5 = movingAverage(bars!, dayIndex, 5);
    const ma10 = movingAverage(bars!, dayIndex, 10);
    const belowMa5 = ma5 !== null && bar.close < ma5;
    const belowMa10 = ma10 !== null && bar.close < ma10;
    days.push({
      day,
      bar,
      ma5,
      ma10,
      belowMa5,
      belowMa10,
      belowBoth: belowMa5 && belowMa10,
    });
  }
  const lowDayCountBoth = days.filter(day => day.belowBoth).length;
  let maxConsecutiveBelowBoth = 0;
  let currentConsecutiveBelowBoth = 0;
  for (const day of days) {
    currentConsecutiveBelowBoth = day.belowBoth ? currentConsecutiveBelowBoth + 1 : 0;
    maxConsecutiveBelowBoth = Math.max(maxConsecutiveBelowBoth, currentConsecutiveBelowBoth);
  }
  const tail3Days = days.filter(day => day.day >= 3);
  const tail3LowDayCountBoth = tail3Days.filter(day => day.belowBoth).length;
  let tail3MaxConsecutiveBelowBoth = 0;
  let currentTail3ConsecutiveBelowBoth = 0;
  for (const day of tail3Days) {
    currentTail3ConsecutiveBelowBoth = day.belowBoth
      ? currentTail3ConsecutiveBelowBoth + 1
      : 0;
    tail3MaxConsecutiveBelowBoth = Math.max(
      tail3MaxConsecutiveBelowBoth,
      currentTail3ConsecutiveBelowBoth,
    );
  }
  const t6 = eventIndex < 0 ? null : bars?.[eventIndex + 6] ?? null;
  const entryMa5 = eventIndex < 0 ? null : movingAverage(bars!, eventIndex + 5, 5);
  const entryMa10 = eventIndex < 0 ? null : movingAverage(bars!, eventIndex + 5, 10);
  const t6Open = t6?.open ?? null;
  const entryBelowMa5 = t6Open !== null && entryMa5 !== null && t6Open < entryMa5;
  const entryBelowMa10 = t6Open !== null && entryMa10 !== null && t6Open < entryMa10;
  return {
    ...trade,
    eventDate,
    days,
    continuousBelowMa5: days.length === 5 && days.every(day => day.belowMa5),
    continuousBelowMa10: days.length === 5 && days.every(day => day.belowMa10),
    continuousBelowBoth: days.length === 5 && days.every(day => day.belowBoth),
    lowDayCountBoth,
    maxConsecutiveBelowBoth,
    tail3LowDayCountBoth,
    tail3MaxConsecutiveBelowBoth,
    t6Date: t6?.tradeDate ?? null,
    t6Open,
    entryMa5,
    entryMa10,
    entryBelowMa5,
    entryBelowMa10,
    entryBelowBoth: entryBelowMa5 && entryBelowMa10,
    tier: tierOf(trade.returnPct, trade.openAtEnd),
    netPnlValue: trade.netPnl ?? 0,
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  archiveId: run.id,
  runId: run.runId,
  strategyVersion: run.strategyVersion,
  definition: {
    window: "T+1..T+5",
    maBasis: "每日 MA5 / MA10 均包含当日收盘",
    continuousBelowMa5: "T+1..T+5 每日收盘 < 当日 MA5",
    continuousBelowMa10: "T+1..T+5 每日收盘 < 当日 MA10",
    continuousBelowBoth: "T+1..T+5 每日收盘同时 < 当日 MA5 与 MA10",
  },
  total: summarizeGroup("总体实际成交", evaluated),
  continuousBelowMa5: summarizeGroup(
    "观察窗内连续低于 MA5",
    evaluated.filter(row => row.continuousBelowMa5),
  ),
  continuousBelowMa10: summarizeGroup(
    "观察窗内连续低于 MA10",
    evaluated.filter(row => row.continuousBelowMa10),
  ),
  continuousBelowBoth: summarizeGroup(
    "观察窗内连续同时低于 MA5、MA10",
    evaluated.filter(row => row.continuousBelowBoth),
  ),
  byLowDayCountBoth: [0, 1, 2, 3, 4, 5].map(count => summarizeGroup(
    `观察窗内同时低于 MA5、MA10 共 ${count} 天`,
    evaluated.filter(row => row.lowDayCountBoth === count),
  )),
  byMaxConsecutiveBelowBoth: [0, 1, 2, 3, 4, 5].map(count => summarizeGroup(
    `观察窗内最长连续同时低于 MA5、MA10 共 ${count} 天`,
    evaluated.filter(row => row.maxConsecutiveBelowBoth === count),
  )),
  tail3ByLowDayCountBoth: [0, 1, 2, 3].map(count => {
    const base = evaluated.filter(row => row.tail3LowDayCountBoth === count);
    return {
      count,
      all: summarizeGroup(`T+3..T+5 共 ${count} 天低于 MA5、MA10`, base),
      entryBelowMa5: summarizeGroup(
        `T+3..T+5 共 ${count} 天 + T+6 开盘 < MA5`,
        base.filter(row => row.entryBelowMa5),
      ),
      entryBelowMa10: summarizeGroup(
        `T+3..T+5 共 ${count} 天 + T+6 开盘 < MA10`,
        base.filter(row => row.entryBelowMa10),
      ),
      entryBelowBoth: summarizeGroup(
        `T+3..T+5 共 ${count} 天 + T+6 开盘 < MA5、MA10`,
        base.filter(row => row.entryBelowBoth),
      ),
    };
  }),
  tail3ByMaxConsecutiveBelowBoth: [0, 1, 2, 3].map(count => {
    const base = evaluated.filter(row => row.tail3MaxConsecutiveBelowBoth === count);
    return {
      count,
      all: summarizeGroup(`T+3..T+5 最长连续 ${count} 天低于 MA5、MA10`, base),
      entryBelowMa5: summarizeGroup(
        `T+3..T+5 最长连续 ${count} 天 + T+6 开盘 < MA5`,
        base.filter(row => row.entryBelowMa5),
      ),
      entryBelowMa10: summarizeGroup(
        `T+3..T+5 最长连续 ${count} 天 + T+6 开盘 < MA10`,
        base.filter(row => row.entryBelowMa10),
      ),
      entryBelowBoth: summarizeGroup(
        `T+3..T+5 最长连续 ${count} 天 + T+6 开盘 < MA5、MA10`,
        base.filter(row => row.entryBelowBoth),
      ),
    };
  }),
  controlNotContinuousBoth: summarizeGroup(
    "对照：未连续同时低于 MA5、MA10",
    evaluated.filter(row => !row.continuousBelowBoth),
  ),
  dailyBelowRates: [1, 2, 3, 4, 5].map(day => {
    const rows = evaluated.map(row => row.days.find(item => item.day === day)).filter((item): item is ObservationDay => item !== undefined);
    return {
      relativeDay: `T+${day}`,
      sampleCount: rows.length,
      belowMa5Count: rows.filter(row => row.belowMa5).length,
      belowMa5RatePct: round(percent(rows.filter(row => row.belowMa5).length, rows.length)),
      belowMa10Count: rows.filter(row => row.belowMa10).length,
      belowMa10RatePct: round(percent(rows.filter(row => row.belowMa10).length, rows.length)),
      belowBothCount: rows.filter(row => row.belowBoth).length,
      belowBothRatePct: round(percent(rows.filter(row => row.belowBoth).length, rows.length)),
    };
  }),
};

const evidenceDir = path.resolve("docs/evidence");
mkdirSync(evidenceDir, { recursive: true });
const outputBase = "_analysis_3f_top3_v111_observation_low_ma";
const summaryPath = path.join(evidenceDir, `${outputBase}_summary.json`);
const csvPath = path.join(evidenceDir, `${outputBase}_trades.csv`);
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const headers = [
  "code", "name", "eventDate", "entryDate",
  ...Array.from({ length: 5 }, (_, index) => [
    `t${index + 1}Date`,
    `t${index + 1}Open`,
    `t${index + 1}Close`,
    `t${index + 1}Ma5`,
    `t${index + 1}Ma10`,
    `t${index + 1}BelowMa5`,
    `t${index + 1}BelowMa10`,
    `t${index + 1}BelowBoth`,
  ]).flat(),
  "continuousBelowMa5", "continuousBelowMa10", "continuousBelowBoth",
  "lowDayCountBoth", "maxConsecutiveBelowBoth",
  "tail3LowDayCountBoth", "tail3MaxConsecutiveBelowBoth",
  "t6Date", "t6Open", "entryMa5", "entryMa10",
  "entryBelowMa5", "entryBelowMa10", "entryBelowBoth",
  "returnPct", "tier", "reason", "openAtEnd",
];
const csvRows = evaluated.map(row => [
  row.code, row.name, row.eventDate, row.entryTime,
  ...Array.from({ length: 5 }, (_, index) => {
    const day = row.days.find(item => item.day === index + 1);
    return [
      day?.bar.tradeDate,
      day?.bar.open,
      day?.bar.close,
      day?.ma5,
      day?.ma10,
      day?.belowMa5,
      day?.belowMa10,
      day?.belowBoth,
    ];
  }).flat(),
  row.continuousBelowMa5,
  row.continuousBelowMa10,
  row.continuousBelowBoth,
  row.lowDayCountBoth,
  row.maxConsecutiveBelowBoth,
  row.tail3LowDayCountBoth,
  row.tail3MaxConsecutiveBelowBoth,
  row.t6Date,
  row.t6Open,
  row.entryMa5,
  row.entryMa10,
  row.entryBelowMa5,
  row.entryBelowMa10,
  row.entryBelowBoth,
  row.returnPct,
  row.tier,
  row.reason,
  row.openAtEnd,
].map(csvValue).join(","));
writeFileSync(csvPath, `${headers.join(",")}\n${csvRows.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  archiveId: summary.archiveId,
  runId: summary.runId,
  total: summary.total,
  continuousBelowMa5: summary.continuousBelowMa5,
  continuousBelowMa10: summary.continuousBelowMa10,
  continuousBelowBoth: summary.continuousBelowBoth,
  byLowDayCountBoth: summary.byLowDayCountBoth,
  byMaxConsecutiveBelowBoth: summary.byMaxConsecutiveBelowBoth,
  tail3ByLowDayCountBoth: summary.tail3ByLowDayCountBoth,
  tail3ByMaxConsecutiveBelowBoth: summary.tail3ByMaxConsecutiveBelowBoth,
  controlNotContinuousBoth: summary.controlNotContinuousBoth,
  dailyBelowRates: summary.dailyBelowRates,
  summaryPath,
  csvPath,
}, null, 2));
process.exit(0);
