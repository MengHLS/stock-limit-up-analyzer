/**
 * 统计 3F TopN 留档交易中，收盘价同时低于 MA5 / MA10 的样本。
 *
 * 默认主口径：买入日前一交易日收盘同时低于 MA5 与 MA10。
 * 同时输出买入日收盘、持仓期内首次、持仓期内任意一次等口径，避免时点歧义。
 *
 * 用法：
 *   npx tsx scripts/analyze3FTopNMaBreakStats.mts
 *   npx tsx scripts/analyze3FTopNMaBreakStats.mts --topn 5
 *   npx tsx scripts/analyze3FTopNMaBreakStats.mts --run-id clrun-...
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

type DailyPoint = {
  tradeDate: string;
  close: number | null;
  ma5: number | null;
  ma10: number | null;
};

type Criterion =
  | "decisionClose"
  | "entryClose"
  | "holdingCross"
  | "holdingAny"
  | "exitClose";

type BreakKind = "ma5" | "ma10" | "both";

type TimingFlags = Record<BreakKind, boolean>;

type EvaluatedTrade = Trade & {
  result: "MATCH" | "NOT_MATCH" | "MISSING_DATA";
  decisionDate: string | null;
  decisionClose: number | null;
  decisionMa5: number | null;
  decisionMa10: number | null;
  entryMa5: number | null;
  entryMa10: number | null;
  decisionBelowBoth: boolean;
  entryBelowBoth: boolean;
  holdingCrossDown: boolean;
  holdingAnyBelowBoth: boolean;
  exitBelowBoth: boolean;
  crossDownDate: string | null;
  firstBreakDate: string | null;
  matchingDates: string[];
  timingFlags: Record<Criterion, TimingFlags>;
};

const CRITERIA: readonly Criterion[] = [
  "decisionClose",
  "entryClose",
  "holdingCross",
  "holdingAny",
  "exitClose",
];

const CRITERION_LABELS: Record<Criterion, string> = {
  decisionClose: "买入日前一交易日收盘同时低于 MA5/MA10",
  entryClose: "买入日收盘同时低于 MA5/MA10",
  holdingCross: "持仓期内首次同时向下穿越 MA5/MA10",
  holdingAny: "持仓期内任一收盘同时低于 MA5/MA10",
  exitClose: "卖出日收盘同时低于 MA5/MA10",
};

const BREAK_KINDS: readonly BreakKind[] = ["ma5", "ma10", "both"];

const BREAK_KIND_LABELS: Record<BreakKind, string> = {
  ma5: "跌破 MA5",
  ma10: "跌破 MA10",
  both: "同时跌破 MA5/MA10",
};

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function formatPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
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

function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
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
  let seed = 0x3f7a9b2d;
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

function belowBoth(point: DailyPoint): boolean {
  return (
    point.close !== null &&
    point.ma5 !== null &&
    point.ma10 !== null &&
    point.close < point.ma5 &&
    point.close < point.ma10
  );
}

function belowMa5(point: DailyPoint): boolean {
  return (
    point.close !== null && point.ma5 !== null && point.close < point.ma5
  );
}

function belowMa10(point: DailyPoint): boolean {
  return (
    point.close !== null && point.ma10 !== null && point.close < point.ma10
  );
}

function timingFlagsAt(point: DailyPoint | null): TimingFlags {
  return {
    ma5: point !== null && belowMa5(point),
    ma10: point !== null && belowMa10(point),
    both: point !== null && belowBoth(point),
  };
}

function pointByDate(points: readonly DailyPoint[]): Map<string, DailyPoint> {
  return new Map(points.map((point) => [point.tradeDate, point]));
}

function previousPoint(
  points: readonly DailyPoint[],
  date: string,
): DailyPoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    if (point.tradeDate < date) return point;
  }
  return null;
}

function shiftCalendarDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function movingAverageAt(
  closes: readonly number[],
  index: number,
  window: number,
): number | null {
  if (index + 1 < window) return null;
  let sum = 0;
  for (let offset = index + 1 - window; offset <= index; offset += 1) {
    sum += closes[offset]!;
  }
  return sum / window;
}

function buildDailyPoints(
  rows: readonly { tradeDate: string; closePrice: string | null }[],
): DailyPoint[] {
  const parsed = rows
    .map((row) => ({
      tradeDate: row.tradeDate,
      close:
        row.closePrice === null || row.closePrice.trim() === ""
          ? null
          : Number(row.closePrice),
    }))
    .filter(
      (row): row is { tradeDate: string; close: number } =>
        row.close !== null && Number.isFinite(row.close) && row.close > 0,
    )
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const closes = parsed.map((row) => row.close);
  return parsed.map((row, index) => ({
    ...row,
    ma5: movingAverageAt(closes, index, 5),
    ma10: movingAverageAt(closes, index, 10),
  }));
}

function evaluateTrade(
  trade: Trade,
  points: readonly DailyPoint[],
): EvaluatedTrade {
  const byDate = pointByDate(points);
  const decision = previousPoint(points, trade.entryTime);
  const entry = byDate.get(trade.entryTime) ?? null;
  const exit = byDate.get(trade.exitTime) ?? null;
  const holdingPoints = points.filter(
    (point) =>
      point.tradeDate >= trade.entryTime && point.tradeDate < trade.exitTime,
  );
  const matchingDates = holdingPoints
    .filter(belowBoth)
    .map((point) => point.tradeDate);
  const firstBreakDate = matchingDates[0] ?? null;
  let crossDownDate: string | null = null;
  let crossDownMa5Date: string | null = null;
  let crossDownMa10Date: string | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    if (point.tradeDate < trade.entryTime || point.tradeDate >= trade.exitTime) {
      continue;
    }
    const previous = points[index - 1]!;
    if (
      crossDownMa5Date === null &&
      previous.ma5 !== null &&
      belowMa5(point) &&
      !belowMa5(previous)
    ) {
      crossDownMa5Date = point.tradeDate;
    }
    if (
      crossDownMa10Date === null &&
      previous.ma10 !== null &&
      belowMa10(point) &&
      !belowMa10(previous)
    ) {
      crossDownMa10Date = point.tradeDate;
    }
    if (
      crossDownDate === null &&
      previous.close !== null &&
      previous.ma5 !== null &&
      previous.ma10 !== null &&
      belowBoth(point) &&
      !belowBoth(previous)
    ) {
      crossDownDate = point.tradeDate;
    }
    if (
      crossDownMa5Date !== null &&
      crossDownMa10Date !== null &&
      crossDownDate !== null
    ) {
      break;
    }
  }
  const decisionBelowBoth = decision !== null && belowBoth(decision);
  const entryBelowBoth = entry !== null && belowBoth(entry);
  const holdingCrossDown = crossDownDate !== null;
  const holdingAnyBelowBoth = matchingDates.length > 0;
  const exitBelowBoth = exit !== null && belowBoth(exit);
  const hasDecisionData =
    decision?.close !== null &&
    decision?.ma5 !== null &&
    decision?.ma10 !== null;

  return {
    ...trade,
    result: !hasDecisionData
      ? "MISSING_DATA"
      : decisionBelowBoth
        ? "MATCH"
        : "NOT_MATCH",
    decisionDate: decision?.tradeDate ?? null,
    decisionClose: decision?.close ?? null,
    decisionMa5: decision?.ma5 ?? null,
    decisionMa10: decision?.ma10 ?? null,
    entryMa5: entry?.ma5 ?? null,
    entryMa10: entry?.ma10 ?? null,
    decisionBelowBoth,
    entryBelowBoth,
    holdingCrossDown,
    holdingAnyBelowBoth,
    exitBelowBoth,
    crossDownDate,
    firstBreakDate,
    matchingDates,
    timingFlags: {
      decisionClose: timingFlagsAt(decision),
      entryClose: timingFlagsAt(entry),
      holdingCross: {
        ma5: crossDownMa5Date !== null,
        ma10: crossDownMa10Date !== null,
        both: crossDownDate !== null,
      },
      holdingAny: {
        ma5: holdingPoints.some(belowMa5),
        ma10: holdingPoints.some(belowMa10),
        both: matchingDates.length > 0,
      },
      exitClose: timingFlagsAt(exit),
    },
  };
}

type Aggregate = {
  count: number;
  meanNetPnl: number | null;
  medianNetPnl: number | null;
  sumNetPnl: number;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  returnStdDevPct: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
  meanHoldingPeriod: number | null;
};

type ComparisonRow = {
  criterion: Criterion;
  timingLabel: string;
  kind: BreakKind;
  kindLabel: string;
  stats: Aggregate;
  netPnlDifference: number | null;
  returnDifference: number | null;
  netPnlCi: { lower: number; upper: number } | null;
  returnCi: { lower: number; upper: number } | null;
};

function aggregate(trades: readonly EvaluatedTrade[]): Aggregate {
  const netPnls = trades.map((trade) => trade.netPnl);
  const returns = trades.map((trade) => trade.returnPct);
  const wins = netPnls.filter((value) => value > 0);
  const losses = netPnls.filter((value) => value < 0);
  const totalProfit = wins.reduce((sum, value) => sum + value, 0);
  const totalLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return {
    count: trades.length,
    meanNetPnl: mean(netPnls),
    medianNetPnl: median(netPnls),
    sumNetPnl: netPnls.reduce((sum, value) => sum + value, 0),
    meanReturnPct: mean(returns),
    medianReturnPct: median(returns),
    returnStdDevPct: standardDeviation(returns),
    winRatePct: trades.length === 0 ? null : (wins.length / trades.length) * 100,
    profitFactor:
      totalLoss === 0 ? (totalProfit > 0 ? null : 0) : totalProfit / totalLoss,
    meanHoldingPeriod: mean(trades.map((trade) => trade.holdingPeriod)),
  };
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

function writeCsv(filePath: string, trades: readonly EvaluatedTrade[]): void {
  const headers = [
    "code",
    "name",
    "entryTime",
    "exitTime",
    "reason",
    "holdingPeriod",
    "openAtEnd",
    "netPnl",
    "returnPct",
    "decisionDate",
    "decisionClose",
    "decisionMa5",
    "decisionMa10",
    "decisionCloseBelowBoth",
    "entryCloseBelowBoth",
    "holdingCrossDown",
    "crossDownDate",
    "holdingAnyCloseBelowBoth",
    "firstBreakDate",
    "exitCloseBelowBoth",
    "matchingDates",
  ];
  const rows = trades.map((trade) => [
    trade.code,
    trade.name,
    trade.entryTime,
    trade.exitTime,
    trade.reason,
    trade.holdingPeriod,
    trade.openAtEnd,
    trade.netPnl,
    trade.returnPct,
    trade.decisionDate,
    trade.decisionClose,
    trade.decisionMa5,
    trade.decisionMa10,
    trade.decisionBelowBoth,
    trade.entryBelowBoth,
    trade.holdingCrossDown,
    trade.crossDownDate,
    trade.holdingAnyBelowBoth,
    trade.firstBreakDate,
    trade.exitBelowBoth,
    trade.matchingDates.join("|"),
  ]);
  const content = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\r\n`, "utf8");
}

function writeSummaryCsv(
  filePath: string,
  rows: readonly ComparisonRow[],
): void {
  const headers = [
    "timing",
    "breakKind",
    "count",
    "meanNetPnl",
    "netPnlVsAll",
    "meanReturnPct",
    "returnPctVsAll",
    "medianNetPnl",
    "winRatePct",
    "profitFactor",
    "meanHoldingPeriod",
    "netPnlDiffCiLower",
    "netPnlDiffCiUpper",
    "returnDiffCiLowerPct",
    "returnDiffCiUpperPct",
  ];
  const data = rows.map((row) => [
    row.timingLabel,
    row.kindLabel,
    row.stats.count,
    row.stats.meanNetPnl,
    row.netPnlDifference,
    row.stats.meanReturnPct,
    row.returnDifference,
    row.stats.medianNetPnl,
    row.stats.winRatePct,
    row.stats.profitFactor,
    row.stats.meanHoldingPeriod,
    row.netPnlCi?.lower ?? null,
    row.netPnlCi?.upper ?? null,
    row.returnCi?.lower ?? null,
    row.returnCi?.upper ?? null,
  ]);
  const content = [headers, ...data]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\r\n`, "utf8");
}

async function main(): Promise<void> {
  const topN = Number(optionValue("--topn") ?? "3");
  const strategyId = `first-limit-pullback-3f-top${topN}`;
  const requestedRunId = optionValue("--run-id");
  const list = await listClosedLoopBacktestRuns({ strategyId, limit: 100 });
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
  const detail = await getClosedLoopBacktestRun(selected.id);
  if (!detail?.result) throw new Error(`留档 ${selected.id} 没有完整结果`);

  const allTrades = parseTrades(detail.result);
  const completedTrades = allTrades.filter((trade) => !trade.openAtEnd);
  const byCode = new Map<string, Trade[]>();
  for (const trade of completedTrades) {
    if (!trade.code) continue;
    const group = byCode.get(trade.code) ?? [];
    group.push(trade);
    byCode.set(trade.code, group);
  }

  const pointsByCode = new Map<string, DailyPoint[]>();
  const failures: Array<{ code: string; error: string }> = [];
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  await mapLimit([...byCode.entries()], 8, async ([code, codeTrades]) => {
    const firstEntry = codeTrades
      .map((trade) => trade.entryTime)
      .sort()[0]!;
    const startDate = shiftCalendarDays(firstEntry, -60);
    const endDate = codeTrades
      .map((trade) => trade.exitTime)
      .sort()
      .at(-1)!;
    try {
      const rows = await withReadRetry(
        `3f-top${topN}.ma.${code}`,
        async () =>
          await db
            .select({
              tradeDate: stockDailyPrices.tradeDate,
              closePrice: stockDailyPrices.closePrice,
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
      pointsByCode.set(code, buildDailyPoints(rows));
    } catch (error) {
      failures.push({
        code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const evaluated = completedTrades
    .map((trade) => {
      if (!trade.code) return null;
      const points = pointsByCode.get(trade.code);
      return points ? evaluateTrade(trade, points) : null;
    })
    .filter((trade): trade is EvaluatedTrade => trade !== null);

  const missingData = evaluated.filter((trade) => trade.result === "MISSING_DATA");
  const baseline = evaluated.filter(
    (trade) => trade.result === "MATCH" || trade.result === "NOT_MATCH",
  );
  const allStats = aggregate(baseline);
  const comparisonRows: ComparisonRow[] = CRITERIA.flatMap((criterion) =>
    BREAK_KINDS.map((kind) => {
      const matches = baseline.filter(
        (trade) => trade.timingFlags[criterion][kind],
      );
      const complement = baseline.filter(
        (trade) => !trade.timingFlags[criterion][kind],
      );
      const stats = aggregate(matches);
      const netPnlDifference =
        stats.meanNetPnl === null || allStats.meanNetPnl === null
          ? null
          : stats.meanNetPnl - allStats.meanNetPnl;
      const returnDifference =
        stats.meanReturnPct === null || allStats.meanReturnPct === null
          ? null
          : stats.meanReturnPct - allStats.meanReturnPct;
      return {
        criterion,
        timingLabel: CRITERION_LABELS[criterion],
        kind,
        kindLabel: BREAK_KIND_LABELS[kind],
        stats,
        netPnlDifference,
        returnDifference,
        netPnlCi: bootstrapMeanDifferenceCi(
          matches.map((trade) => trade.netPnl),
          complement.map((trade) => trade.netPnl),
        ),
        returnCi: bootstrapMeanDifferenceCi(
          matches.map((trade) => trade.returnPct),
          complement.map((trade) => trade.returnPct),
        ),
      };
    }),
  );

  console.log(`\n3F Top${topN} 交易均线统计分析`);
  console.log(`runId: ${selected.runId}`);
  console.log(`strategyVersion: ${selected.strategyVersion}`);
  console.log(`留档范围: ${selected.startDate.slice(0, 10)} ~ ${selected.endDate.slice(0, 10)}`);
  console.log(
    `成交明细 ${allTrades.length} 笔，完成交易 ${completedTrades.length} 笔，` +
      `期末未平仓 ${allTrades.length - completedTrades.length} 笔`,
  );
  if (missingData.length > 0) {
    console.log(
      `完成交易中均线数据不足，排除统计: ${missingData.length} 笔；` +
        `有效样本 ${baseline.length} 笔`,
    );
  }
  console.log(`证券代码数: ${byCode.size}，行情读取失败: ${failures.length}`);
  console.log(
    `全样本: 平均净盈亏 ${formatNumber(allStats.meanNetPnl)} 元/笔，` +
      `平均收益率 ${formatPct(allStats.meanReturnPct)}，` +
      `胜率 ${formatPct(allStats.winRatePct)}，盈亏比 ${formatNumber(allStats.profitFactor, 4)}`,
  );

  for (const criterion of CRITERIA) {
    console.log(`\n[${CRITERION_LABELS[criterion]}]`);
    for (const item of comparisonRows.filter(
      (row) => row.criterion === criterion,
    )) {
      console.log(
        `${item.kindLabel}: 样本 ${item.stats.count}/${allStats.count}，` +
          `平均净盈亏 ${formatNumber(item.stats.meanNetPnl)} 元/笔，` +
          `较全样本 ${formatNumber(item.netPnlDifference)} 元/笔，` +
          `平均收益率 ${formatPct(item.stats.meanReturnPct)}，` +
          `较全样本 ${formatPct(item.returnDifference)}，` +
          `胜率 ${formatPct(item.stats.winRatePct)}，` +
          `盈亏比 ${formatNumber(item.stats.profitFactor, 4)}`,
      );
      console.log(
        `  相对未匹配组 95% CI：净盈亏 ` +
          `[${formatNumber(item.netPnlCi?.lower)}, ${formatNumber(item.netPnlCi?.upper)}] 元；` +
          `收益率 [${formatPct(item.returnCi?.lower)}, ${formatPct(item.returnCi?.upper)}]`,
      );
    }
  }

  const outCsv = optionValue("--out-csv");
  if (outCsv !== null) {
    writeCsv(outCsv, evaluated);
    console.log(`\nCSV: ${path.resolve(outCsv)}`);
  }
  const outSummaryCsv = optionValue("--out-summary-csv");
  if (outSummaryCsv !== null) {
    writeSummaryCsv(outSummaryCsv, comparisonRows);
    console.log(`汇总 CSV: ${path.resolve(outSummaryCsv)}`);
  }
  if (failures.length > 0) {
    console.log("\n行情读取失败明细:");
    for (const failure of failures) console.log(`${failure.code}: ${failure.error}`);
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
