/**
 * 统计 3F Top3 v1.11.0 实际成交在 T+6 开盘时相对 MA5 / MA10 的位置及收益分层。
 *
 * PIT 口径：
 *   - T+6 开盘价 = 策略真实 entryPrice 对应的行情开盘价；
 *   - MA5 = T+1..T+5 收盘均值；
 *   - MA10 = 截至 T+5 的最近 10 个收盘均值；
 *   - 不使用 T+6 收盘，因为策略在 T+6 开盘决策时不可见。
 *
 * 用法：
 *   npx tsx scripts/analyze3FTopNEntryMaOpenStats.mts
 *   npx tsx scripts/analyze3FTopNEntryMaOpenStats.mts --run-id clrun-...
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
  entryPrice: number;
  netPnl: number | null;
  returnPct: number | null;
  reason: string | null;
  openAtEnd: boolean;
};

type DailyBar = {
  tradeDate: string;
  open: number;
  close: number;
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
  if (
    typeof row.securityId !== "string"
    || typeof row.entryTime !== "string"
    || typeof row.entryPrice !== "number"
  ) {
    return null;
  }
  return {
    securityId: row.securityId,
    code: typeof row.code === "string" ? row.code : null,
    name: typeof row.name === "string" ? row.name : null,
    entryTime: row.entryTime,
    entryPrice: row.entryPrice,
    netPnl: typeof row.netPnl === "number" ? row.netPnl : null,
    returnPct: typeof row.returnPct === "number" ? row.returnPct : null,
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

function summarizeGroup(
  label: string,
  rows: readonly EvaluatedTrade[],
) {
  const completed = rows.filter(row => row.tier !== "OPEN_AT_END");
  const returns = completed.map(row => row.returnPct!);
  const wins = returns.filter(value => value > 0);
  const losses = returns.filter(value => value < 0);
  const totalWin = completed
    .filter(row => row.returnPct! > 0)
    .reduce((sum, row) => sum + row.netPnl, 0);
  const totalLoss = Math.abs(completed
    .filter(row => row.returnPct! < 0)
    .reduce((sum, row) => sum + row.netPnl, 0));
  const byTier = Object.fromEntries(
    PROFIT_TIERS.map(tier => {
      const count = rows.filter(row => row.tier === tier).length;
      return [tier, {
        count,
        sharePct: round(percent(count, rows.length)),
      }];
    }),
  );
  return {
    label,
    tradeCount: rows.length,
    completedCount: completed.length,
    openAtEndCount: rows.length - completed.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: round(percent(wins.length, completed.length)),
    meanReturnPct: round(mean(returns)),
    medianReturnPct: round(median(returns)),
    profitFactor: totalLoss === 0 ? null : round(totalWin / totalLoss),
    byTier,
  };
}

type EvaluatedTrade = Trade & {
  eventDate: string;
  t1: DailyBar | null;
  t2: DailyBar | null;
  t3: DailyBar | null;
  t4: DailyBar | null;
  t5: DailyBar | null;
  t6Date: string | null;
  t6Open: number | null;
  ma5: number | null;
  ma10: number | null;
  belowMa5: boolean;
  belowMa10: boolean;
  belowBoth: boolean;
  belowEither: boolean;
  tier: ProfitTier;
  netPnl: number;
};

const requestedRunId = argOf("run-id");
const history = await listClosedLoopBacktestRuns({
  strategyId: "first-limit-pullback-3f-top3",
  limit: 50,
});
const run =
  requestedRunId === null
    ? history.find(item => item.strategyVersion === "1.11.0")
    : history.find(item => item.runId === requestedRunId);
if (run === undefined) {
  throw new Error(
    requestedRunId === null
      ? "未找到 3F Top3 v1.11.0 留档。"
      : `未找到 runId=${requestedRunId}。`,
  );
}
const detail = await getClosedLoopBacktestRun(run.id);
const trades = tradesOfResult(detail?.result);
if (trades.length === 0) throw new Error(`留档 ${run.id} 没有可读成交。`);

const eventDates = new Map<string, string>();
for (const trade of trades) {
  const eventDate = parseEventDate(trade.securityId);
  if (trade.code !== null && eventDate !== null) {
    eventDates.set(`${trade.code}\u0000${eventDate}`, eventDate);
  }
}
const codes = [...new Set(trades.map(trade => trade.code).filter((code): code is string => code !== null))];
const allEventDates = [...eventDates.values()].sort();
const minDate = shiftCalendarDays(allEventDates[0]!, -30);
const maxDate = shiftCalendarDays(allEventDates.at(-1)!, 30);

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
    const bucket = barsByCode.get(row.stockCode);
    const bar = { tradeDate: row.tradeDate, open, close };
    if (bucket === undefined) barsByCode.set(row.stockCode, [bar]);
    else bucket.push(bar);
  }
}

const evaluated: EvaluatedTrade[] = [];
for (const trade of trades) {
  const eventDate = parseEventDate(trade.securityId);
  const bars = trade.code === null ? undefined : barsByCode.get(trade.code);
  const eventIndex = eventDate === null || bars === undefined
    ? -1
    : bars.findIndex(bar => bar.tradeDate === eventDate);
  const t1 = eventIndex < 0 ? null : bars![eventIndex + 1] ?? null;
  const t2 = eventIndex < 0 ? null : bars![eventIndex + 2] ?? null;
  const t3 = eventIndex < 0 ? null : bars![eventIndex + 3] ?? null;
  const t4 = eventIndex < 0 ? null : bars![eventIndex + 4] ?? null;
  const t5 = eventIndex < 0 ? null : bars![eventIndex + 5] ?? null;
  const t6 = eventIndex < 0 ? null : bars![eventIndex + 6] ?? null;
  const ma5Closes = [t1, t2, t3, t4, t5]
    .map(bar => bar?.close)
    .filter((value): value is number => value !== undefined);
  const ma10Window = eventIndex < 0
    ? []
    : bars!.slice(Math.max(0, eventIndex + 5 - 9), eventIndex + 6);
  const ma10Closes = ma10Window.map(bar => bar.close);
  const ma5 = ma5Closes.length === 5 ? mean(ma5Closes) : null;
  const ma10 = ma10Closes.length === 10 ? mean(ma10Closes) : null;
  const t6Open = t6?.open ?? null;
  const belowMa5 = t6Open !== null && ma5 !== null && t6Open < ma5;
  const belowMa10 = t6Open !== null && ma10 !== null && t6Open < ma10;
  const tier = tierOf(trade.returnPct, trade.openAtEnd);
  evaluated.push({
    ...trade,
    eventDate: eventDate ?? "",
    t1,
    t2,
    t3,
    t4,
    t5,
    t6Date: t6?.tradeDate ?? null,
    t6Open,
    ma5,
    ma10,
    belowMa5,
    belowMa10,
    belowBoth: belowMa5 && belowMa10,
    belowEither: belowMa5 || belowMa10,
    tier,
    netPnl: trade.netPnl ?? 0,
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  archiveId: run.id,
  runId: run.runId,
  strategyVersion: run.strategyVersion,
  pitDefinition: {
    ma5: "T+1..T+5 收盘均值",
    ma10: "截至 T+5 的最近 10 个收盘均值",
    comparison: "T+6 开盘价",
  },
  total: summarizeGroup("全部实际成交", evaluated),
  belowMa5: summarizeGroup("T+6 开盘 < MA5", evaluated.filter(row => row.belowMa5)),
  belowMa10: summarizeGroup("T+6 开盘 < MA10", evaluated.filter(row => row.belowMa10)),
  belowBoth: summarizeGroup("T+6 开盘同时 < MA5 和 MA10", evaluated.filter(row => row.belowBoth)),
  belowEither: summarizeGroup("T+6 开盘低于 MA5 或 MA10", evaluated.filter(row => row.belowEither)),
  missing: summarizeGroup(
    "T+1..T+6 或 MA 数据不足",
    evaluated.filter(row => row.t6Open === null || row.ma5 === null || row.ma10 === null),
  ),
  dayPriceStats: [1, 2, 3, 4, 5].map(day => {
    const rows = evaluated
      .map(row => day === 1 ? row.t1 : day === 2 ? row.t2 : day === 3 ? row.t3 : day === 4 ? row.t4 : row.t5)
      .filter((bar): bar is DailyBar => bar !== null);
    const openToClose = rows.map(bar => ((bar.close / bar.open) - 1) * 100);
    return {
      relativeDay: `T+${day}`,
      count: rows.length,
      meanOpen: round(mean(rows.map(bar => bar.open)), 4),
      meanClose: round(mean(rows.map(bar => bar.close)), 4),
      medianOpenToClosePct: round(median(openToClose)),
      meanOpenToClosePct: round(mean(openToClose)),
    };
  }),
};

const evidenceDir = path.resolve("docs/evidence");
mkdirSync(evidenceDir, { recursive: true });
const outputBase = "_analysis_3f_top3_v111_entry_ma_open";
const summaryPath = path.join(evidenceDir, `${outputBase}_summary.json`);
const csvPath = path.join(evidenceDir, `${outputBase}_trades.csv`);
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const headers = [
  "code", "name", "eventDate", "entryDate", "entryPrice",
  "t1Date", "t1Open", "t1Close",
  "t2Date", "t2Open", "t2Close",
  "t3Date", "t3Open", "t3Close",
  "t4Date", "t4Open", "t4Close",
  "t5Date", "t5Open", "t5Close",
  "t6Date", "t6Open", "ma5", "ma10",
  "belowMa5", "belowMa10", "belowBoth", "belowEither",
  "returnPct", "tier", "reason", "openAtEnd",
];
const csvRows = evaluated.map(row => [
  row.code, row.name, row.eventDate, row.entryTime, row.entryPrice,
  row.t1?.tradeDate, row.t1?.open, row.t1?.close,
  row.t2?.tradeDate, row.t2?.open, row.t2?.close,
  row.t3?.tradeDate, row.t3?.open, row.t3?.close,
  row.t4?.tradeDate, row.t4?.open, row.t4?.close,
  row.t5?.tradeDate, row.t5?.open, row.t5?.close,
  row.t6Date, row.t6Open, row.ma5, row.ma10,
  row.belowMa5, row.belowMa10, row.belowBoth, row.belowEither,
  row.returnPct, row.tier, row.reason, row.openAtEnd,
].map(csvValue).join(","));
writeFileSync(csvPath, `${headers.join(",")}\n${csvRows.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  archiveId: summary.archiveId,
  runId: summary.runId,
  total: summary.total,
  belowMa5: summary.belowMa5,
  belowMa10: summary.belowMa10,
  belowBoth: summary.belowBoth,
  belowEither: summary.belowEither,
  missing: summary.missing,
  dayPriceStats: summary.dayPriceStats,
  summaryPath,
  csvPath,
}, null, 2));
process.exit(0);
