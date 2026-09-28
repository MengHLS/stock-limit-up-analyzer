/**
 * 3F TopN 留档权益曲线 vs 基准指数：只读市场敏感度分析。
 *
 * 回答三个问题：
 *   1. 策略是否整体高 beta；
 *   2. 指数下跌日是否跌得更多（down capture / downside beta）；
 *   3. 最大回撤期间，指数跌了多少、策略仓位是否仍近满仓。
 *
 * 用法：
 *   npx tsx scripts/analyze3FTopNMarketRegime.mts --topn 3
 *   npx tsx scripts/analyze3FTopNMarketRegime.mts --topn 5 --benchmark 000300.SH
 *   npx tsx scripts/analyze3FTopNMarketRegime.mts --run-id clrun-...
 */

import "dotenv/config";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { indexDaily, indexMaster } from "../drizzle/schema";
import {
  getClosedLoopBacktestRun,
  listClosedLoopBacktestRuns,
} from "../server/closedLoopBacktestRun/repository";
import { getDb } from "../server/db";
import { withReadRetry } from "../server/readRetry";

type EquityPoint = {
  date: string;
  equity: number;
  cash: number | null;
  marketValue: number | null;
  openPositions: number | null;
};

type IndexPoint = {
  tradeDate: string;
  close: number;
};

type AlignedPoint = {
  date: string;
  strategyReturnPct: number;
  indexReturnPct: number;
  equity: number;
  marketValue: number | null;
  openPositions: number | null;
};

type Trade = {
  entryTime: string;
  exitTime: string | null;
  netPnl: number | null;
  returnPct: number | null;
  openAtEnd: boolean;
};

type CaptureStats = {
  count: number;
  strategyMeanPct: number | null;
  indexMeanPct: number | null;
  captureRatio: number | null;
  strategyWinRatePct: number | null;
  averageOpenPositions: number | null;
  averageExposurePct: number | null;
};

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return (
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1)
  );
}

function sampleStandardDeviation(values: readonly number[]): number | null {
  const variance = sampleVariance(values);
  return variance === null ? null : Math.sqrt(variance);
}

function covariance(
  left: readonly number[],
  right: readonly number[]
): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left)!;
  const rightMean = mean(right)!;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += (left[index]! - leftMean) * (right[index]! - rightMean);
  }
  return sum / (left.length - 1);
}

function correlation(
  left: readonly number[],
  right: readonly number[]
): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftStd = sampleStandardDeviation(left);
  const rightStd = sampleStandardDeviation(right);
  if (leftStd === null || rightStd === null || leftStd === 0 || rightStd === 0)
    return null;
  return covariance(left, right)! / (leftStd * rightStd);
}

function beta(
  strategy: readonly number[],
  benchmark: readonly number[]
): number | null {
  if (strategy.length !== benchmark.length || strategy.length < 2) return null;
  const benchmarkVariance = sampleVariance(benchmark);
  if (benchmarkVariance === null || benchmarkVariance === 0) return null;
  return covariance(strategy, benchmark)! / benchmarkVariance;
}

function fmt(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value)
    ? "-"
    : value.toFixed(digits);
}

function fmtPct(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value)
    ? "-"
    : `${value.toFixed(digits)}%`;
}

function cumulativePct(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let factor = 1;
  for (const value of values) factor *= 1 + value / 100;
  return (factor - 1) * 100;
}

function parseEquityCurve(result: unknown): EquityPoint[] {
  if (result === null || typeof result !== "object") return [];
  const stages = (result as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];
  const backtest = stages.find(
    stage =>
      stage !== null &&
      typeof stage === "object" &&
      (stage as { stageId?: unknown }).stageId === "backtest"
  );
  const output =
    backtest !== null && typeof backtest === "object"
      ? (backtest as { output?: unknown }).output
      : null;
  const curve =
    output !== null && typeof output === "object"
      ? (output as { equityCurve?: unknown }).equityCurve
      : null;
  if (!Array.isArray(curve)) return [];

  return curve
    .filter(
      (point): point is EquityPoint =>
        point !== null &&
        typeof point === "object" &&
        typeof (point as EquityPoint).date === "string" &&
        typeof (point as EquityPoint).equity === "number" &&
        Number.isFinite((point as EquityPoint).equity) &&
        (point as EquityPoint).equity > 0
    )
    .map(point => ({
      date: point.date,
      equity: point.equity,
      cash:
        typeof point.cash === "number" && Number.isFinite(point.cash)
          ? point.cash
          : null,
      marketValue:
        typeof point.marketValue === "number" &&
        Number.isFinite(point.marketValue)
          ? point.marketValue
          : null,
      openPositions:
        typeof point.openPositions === "number" &&
        Number.isFinite(point.openPositions)
          ? point.openPositions
          : null,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function parseTrades(result: unknown): Trade[] {
  if (result === null || typeof result !== "object") return [];
  const stages = (result as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [];
  const backtest = stages.find(
    stage =>
      stage !== null &&
      typeof stage === "object" &&
      (stage as { stageId?: unknown }).stageId === "backtest"
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
  return trades
    .filter(
      (trade): trade is Trade =>
        trade !== null &&
        typeof trade === "object" &&
        typeof (trade as Trade).entryTime === "string" &&
        ((trade as Trade).exitTime === null ||
          typeof (trade as Trade).exitTime === "string")
    )
    .map(trade => ({
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      netPnl:
        typeof trade.netPnl === "number" && Number.isFinite(trade.netPnl)
          ? trade.netPnl
          : null,
      returnPct:
        typeof trade.returnPct === "number" && Number.isFinite(trade.returnPct)
          ? trade.returnPct
          : null,
      openAtEnd: trade.openAtEnd === true,
    }));
}

async function loadBenchmark(
  indexCode: string,
  startDate: string,
  endDate: string
): Promise<{ indexName: string | null; points: IndexPoint[] }> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const [master] = await db
    .select({ indexName: indexMaster.indexName })
    .from(indexMaster)
    .where(eq(indexMaster.indexCode, indexCode))
    .limit(1);
  const rows = await db
    .select({
      tradeDate: indexDaily.tradeDate,
      close: indexDaily.close,
    })
    .from(indexDaily)
    .where(
      and(
        eq(indexDaily.indexCode, indexCode),
        gte(indexDaily.tradeDate, startDate),
        lte(indexDaily.tradeDate, endDate)
      )
    )
    .orderBy(asc(indexDaily.tradeDate));

  const points = rows
    .filter(
      (row): row is { tradeDate: string; close: number } =>
        typeof row.close === "number" &&
        Number.isFinite(row.close) &&
        row.close > 0
    )
    .map(row => ({ tradeDate: row.tradeDate, close: row.close }));

  return {
    indexName: master?.indexName ?? null,
    points,
  };
}

function alignSeries(
  equityCurve: readonly EquityPoint[],
  benchmark: readonly IndexPoint[]
): AlignedPoint[] {
  const benchmarkByDate = new Map(
    benchmark.map(point => [point.tradeDate, point.close])
  );
  const aligned: AlignedPoint[] = [];
  for (let index = 1; index < equityCurve.length; index += 1) {
    const previous = equityCurve[index - 1]!;
    const current = equityCurve[index]!;
    const indexPreviousClose = benchmarkByDate.get(previous.date);
    const indexCurrentClose = benchmarkByDate.get(current.date);
    if (
      indexPreviousClose === undefined ||
      indexCurrentClose === undefined ||
      indexPreviousClose <= 0
    ) {
      continue;
    }
    aligned.push({
      date: current.date,
      strategyReturnPct: (current.equity / previous.equity - 1) * 100,
      indexReturnPct: (indexCurrentClose / indexPreviousClose - 1) * 100,
      equity: current.equity,
      marketValue: current.marketValue,
      openPositions: current.openPositions,
    });
  }
  return aligned;
}

function captureStats(
  points: readonly AlignedPoint[],
  predicate: (point: AlignedPoint) => boolean
): CaptureStats {
  const selected = points.filter(predicate);
  const strategy = selected.map(point => point.strategyReturnPct);
  const index = selected.map(point => point.indexReturnPct);
  const strategyMean = mean(strategy);
  const indexMean = mean(index);
  const exposures = selected
    .filter(point => point.marketValue !== null && point.equity > 0)
    .map(point => (point.marketValue! / point.equity) * 100);
  return {
    count: selected.length,
    strategyMeanPct: strategyMean,
    indexMeanPct: indexMean,
    captureRatio:
      strategyMean === null || indexMean === null || indexMean === 0
        ? null
        : strategyMean / indexMean,
    strategyWinRatePct:
      selected.length === 0
        ? null
        : (selected.filter(point => point.strategyReturnPct > 0).length /
            selected.length) *
          100,
    averageOpenPositions: mean(
      selected
        .map(point => point.openPositions)
        .filter((value): value is number => value !== null)
    ),
    averageExposurePct: mean(exposures),
  };
}

function rollingReturn(
  series: readonly { date: string; value: number }[],
  index: number,
  lookback: number
): number | null {
  if (index < lookback) return null;
  const previous = series[index - lookback]!;
  const current = series[index]!;
  if (previous.value <= 0) return null;
  return (current.value / previous.value - 1) * 100;
}

function maxDrawdown(
  equityCurve: readonly EquityPoint[]
): { peakDate: string; troughDate: string; drawdownPct: number } | null {
  if (equityCurve.length < 2) return null;
  let peak = equityCurve[0]!;
  let bestPeak = peak;
  let bestTrough = peak;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    if (point.equity > peak.equity) peak = point;
    const drawdownPct = (point.equity / peak.equity - 1) * 100;
    if (drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      bestPeak = peak;
      bestTrough = point;
    }
  }
  if (maxDrawdownPct === 0) return null;
  return {
    peakDate: bestPeak.date,
    troughDate: bestTrough.date,
    drawdownPct: maxDrawdownPct,
  };
}

function indexDrawdownEpisodes(
  points: readonly IndexPoint[],
  minimumDrawdownPct = 10
): Array<{ peakDate: string; troughDate: string; indexReturnPct: number }> {
  if (points.length < 2) return [];
  const episodes: Array<{
    peakDate: string;
    troughDate: string;
    indexReturnPct: number;
  }> = [];
  let peak = points[0]!;
  let trough = points[0]!;
  for (const point of points) {
    if (point.close > peak.close) {
      const drawdownPct = (trough.close / peak.close - 1) * 100;
      if (drawdownPct <= -minimumDrawdownPct) {
        episodes.push({
          peakDate: peak.tradeDate,
          troughDate: trough.tradeDate,
          indexReturnPct: drawdownPct,
        });
      }
      peak = point;
      trough = point;
      continue;
    }
    if (point.close < trough.close) trough = point;
  }
  const drawdownPct = (trough.close / peak.close - 1) * 100;
  if (drawdownPct <= -minimumDrawdownPct) {
    episodes.push({
      peakDate: peak.tradeDate,
      troughDate: trough.tradeDate,
      indexReturnPct: drawdownPct,
    });
  }
  return episodes;
}

function pointAtOrAfter<T extends { date?: string; tradeDate?: string }>(
  points: readonly T[],
  targetDate: string
): T | null {
  return (
    points.find(point => (point.date ?? point.tradeDate ?? "") >= targetDate) ??
    null
  );
}

function printBucketTable(
  title: string,
  points: readonly AlignedPoint[],
  bucket: (point: AlignedPoint) => string | null
): void {
  const groups = new Map<string, AlignedPoint[]>();
  for (const point of points) {
    const key = bucket(point);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }
  console.log(`\n${title}`);
  console.log(
    "桶 | 样本 | 策略日均 | 指数日均 | 策略/指数 | 策略胜率 | 平均持仓数 | 平均仓位"
  );
  console.log("--- | ---: | ---: | ---: | ---: | ---: | ---: | ---:");
  for (const [key, group] of groups) {
    const stats = captureStats(group, () => true);
    console.log(
      `${key} | ${stats.count} | ${fmtPct(stats.strategyMeanPct)} | ` +
        `${fmtPct(stats.indexMeanPct)} | ${fmt(stats.captureRatio)} | ` +
        `${fmtPct(stats.strategyWinRatePct, 2)} | ${fmt(stats.averageOpenPositions, 2)} | ` +
        `${fmtPct(stats.averageExposurePct, 2)}`
    );
  }
}

function benchmarkMovingAverage(
  points: readonly IndexPoint[],
  date: string,
  lookback: number
): number | null {
  const endIndex = points.findIndex(point => point.tradeDate > date);
  const boundedEnd = endIndex < 0 ? points.length : endIndex;
  if (boundedEnd < lookback) return null;
  const window = points.slice(boundedEnd - lookback, boundedEnd);
  return mean(window.map(point => point.close));
}

function benchmarkPointBefore(
  points: readonly IndexPoint[],
  date: string
): IndexPoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    if (point.tradeDate < date) return point;
  }
  return null;
}

function printEntryRegimeTable(
  title: string,
  trades: readonly Trade[],
  benchmark: readonly IndexPoint[],
  bucket: (trade: Trade) => string | null
): void {
  const groups = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = bucket(trade);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(trade);
    groups.set(key, group);
  }
  console.log(`\n${title}`);
  console.log("状态 | 完成交易 | 平均收益率 | 胜率 | 平均净盈亏 | 净盈亏合计");
  console.log("--- | ---: | ---: | ---: | ---: | ---:");
  for (const [key, group] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const completed = group.filter(trade => !trade.openAtEnd);
    const returns = completed
      .map(trade => trade.returnPct)
      .filter((value): value is number => value !== null);
    const netPnls = completed
      .map(trade => trade.netPnl)
      .filter((value): value is number => value !== null);
    const wins = returns.filter(value => value > 0);
    console.log(
      `${key} | ${completed.length} | ${fmtPct(mean(returns))} | ` +
        `${fmtPct(completed.length === 0 ? null : (wins.length / completed.length) * 100, 2)} | ` +
        `${fmt(mean(netPnls), 2)} | ${fmt(
          netPnls.reduce((sum, value) => sum + value, 0),
          2
        )}`
    );
  }
}

async function main(): Promise<void> {
  const topN = Number(optionValue("--topn") ?? "3");
  const strategyId = `first-limit-pullback-3f-top${topN}`;
  const requestedRunId = optionValue("--run-id");
  const requestedBacktestId = Number(optionValue("--backtest-id") ?? "0");
  const benchmarkIndexCode = optionValue("--benchmark") ?? "000300.SH";
  const selected =
    Number.isInteger(requestedBacktestId) && requestedBacktestId > 0
      ? await withReadRetry(
          `3F Top${topN} 回测留档 #${requestedBacktestId}`,
          () => getClosedLoopBacktestRun(requestedBacktestId)
        )
      : (() => {
          return null;
        })();
  let selectedId: number;
  let selectedRunId: string;
  let selectedStrategyVersion: string;
  if (selected) {
    selectedId = selected.id;
    selectedRunId = selected.runId;
    selectedStrategyVersion = selected.strategyVersion;
  } else {
    const history = await withReadRetry(`3F Top${topN} 回测留档列表`, () =>
      listClosedLoopBacktestRuns({ strategyId, limit: 100 })
    );
    const listed =
      requestedRunId === null
        ? history[0]
        : history.find(record => record.runId === requestedRunId);
    if (!listed) {
      throw new Error(
        requestedRunId === null
          ? `未找到 ${strategyId} 的回测留档`
          : `未找到 runId=${requestedRunId} 的 ${strategyId} 回测留档`
      );
    }
    selectedId = listed.id;
    selectedRunId = listed.runId;
    selectedStrategyVersion = listed.strategyVersion;
  }
  const detail =
    selected ??
    (await withReadRetry(`3F Top${topN} 回测留档 #${selectedId}`, () =>
      getClosedLoopBacktestRun(selectedId)
    ));
  if (!detail?.result) throw new Error(`留档 ${selectedId} 没有完整结果`);
  if (detail.strategyId !== strategyId) {
    throw new Error(
      `留档 ${selectedId} 的策略是 ${detail.strategyId}，不是请求的 ${strategyId}`
    );
  }

  const equityCurve = parseEquityCurve(detail.result);
  if (equityCurve.length < 2)
    throw new Error(`留档 ${selectedId} 的权益曲线不足 2 点`);
  const trades = parseTrades(detail.result);
  const startDate = equityCurve[0]!.date;
  const endDate = equityCurve[equityCurve.length - 1]!.date;
  const benchmark = await loadBenchmark(benchmarkIndexCode, startDate, endDate);
  if (benchmark.points.length < 2) {
    throw new Error(
      `${benchmarkIndexCode} 在 ${startDate}..${endDate} 没有足够指数日线`
    );
  }

  const aligned = alignSeries(equityCurve, benchmark.points);
  if (aligned.length < 30) {
    throw new Error(`对齐后样本不足 30 日，实际 ${aligned.length}`);
  }
  const strategyReturns = aligned.map(point => point.strategyReturnPct);
  const indexReturns = aligned.map(point => point.indexReturnPct);
  const downDays = aligned.filter(point => point.indexReturnPct < 0);
  const flatOrUpDays = aligned.filter(point => point.indexReturnPct >= 0);
  const significantDownDays = aligned.filter(
    point => point.indexReturnPct <= -1
  );

  console.log(`3F Top${topN} 市场敏感度分析`);
  console.log(`backtestId: ${selectedId}`);
  console.log(`runId: ${detail.runId}`);
  console.log(`strategyVersion: ${detail.strategyVersion}`);
  console.log(
    `基准: ${benchmarkIndexCode}${benchmark.indexName ? ` (${benchmark.indexName})` : ""}`
  );
  console.log(
    `权益曲线: ${startDate} ~ ${endDate}，${equityCurve.length} 点；` +
      `与指数对齐 ${aligned.length} 个交易日`
  );

  const totalStrategyReturn = cumulativePct(strategyReturns);
  const totalIndexReturn = cumulativePct(indexReturns);
  console.log(
    `\n全期累计（对齐子样本）: 策略 ${fmtPct(totalStrategyReturn, 2)}，` +
      `指数 ${fmtPct(totalIndexReturn, 2)}，差 ${fmtPct(
        totalStrategyReturn === null || totalIndexReturn === null
          ? null
          : totalStrategyReturn - totalIndexReturn,
        2
      )}`
  );
  console.log(
    `日收益相关 ${fmt(correlation(strategyReturns, indexReturns), 4)}，` +
      `beta ${fmt(beta(strategyReturns, indexReturns), 4)}，` +
      `日波动率 ${fmtPct(sampleStandardDeviation(strategyReturns), 3)}`
  );

  const downsideStrategy = significantDownDays.map(
    point => point.strategyReturnPct
  );
  const downsideIndex = significantDownDays.map(point => point.indexReturnPct);
  console.log(
    `指数 <= -1% 日: ${significantDownDays.length} 天，` +
      `策略均值 ${fmtPct(mean(downsideStrategy))}，` +
      `指数均值 ${fmtPct(mean(downsideIndex))}，` +
      `down beta ${fmt(beta(downsideStrategy, downsideIndex), 4)}`
  );

  const downCapture = captureStats(aligned, point => point.indexReturnPct < 0);
  const upCapture = captureStats(flatOrUpDays, () => true);
  console.log(
    `\n下跌日捕获: 策略 ${fmtPct(downCapture.strategyMeanPct)} / ` +
      `指数 ${fmtPct(downCapture.indexMeanPct)} = ${fmt(downCapture.captureRatio)}，` +
      `平均仓位 ${fmtPct(downCapture.averageExposurePct, 2)}`
  );
  console.log(
    `非下跌日捕获: 策略 ${fmtPct(upCapture.strategyMeanPct)} / ` +
      `指数 ${fmtPct(upCapture.indexMeanPct)} = ${fmt(upCapture.captureRatio)}，` +
      `平均仓位 ${fmtPct(upCapture.averageExposurePct, 2)}`
  );

  printBucketTable("按指数当日收益分桶", aligned, point =>
    point.indexReturnPct <= -2
      ? "<= -2%"
      : point.indexReturnPct <= -1
        ? "(-2%, -1%]"
        : point.indexReturnPct < 0
          ? "(-1%, 0%)"
          : point.indexReturnPct < 1
            ? "[0%, 1%)"
            : point.indexReturnPct < 2
              ? "[1%, 2%)"
              : ">= 2%"
  );

  const indexSeries = benchmark.points.map(point => ({
    date: point.tradeDate,
    value: point.close,
  }));
  const strategySeries = equityCurve.map(point => ({
    date: point.date,
    value: point.equity,
  }));
  const indexByDate = new Map(indexSeries.map(point => [point.date, point]));
  const strategyByDate = new Map(
    strategySeries.map(point => [point.date, point])
  );
  const rolling20: Array<{
    date: string;
    strategy20: number;
    index20: number;
  }> = [];
  for (let index = 20; index < equityCurve.length; index += 1) {
    const current = equityCurve[index]!;
    const strategyIndex = strategySeries.findIndex(
      point => point.date === current.date
    );
    const benchmarkIndex = indexSeries.findIndex(
      point => point.date === current.date
    );
    if (strategyIndex < 0 || benchmarkIndex < 0) continue;
    const strategy20 = rollingReturn(strategySeries, strategyIndex, 20);
    const index20 = rollingReturn(indexSeries, benchmarkIndex, 20);
    if (strategy20 === null || index20 === null) continue;
    if (!indexByDate.has(current.date) || !strategyByDate.has(current.date))
      continue;
    rolling20.push({ date: current.date, strategy20, index20 });
  }

  console.log(`\n指数滚动 20 个交易日收益的尾部样本`);
  console.log("区间 | 样本 | 策略 20 日收益均值 | 指数 20 日收益均值 | 差值");
  console.log("--- | ---: | ---: | ---: | ---:");
  for (const [label, filter] of [
    ["指数 <= -10%", (point: { index20: number }) => point.index20 <= -10],
    [
      "指数 (-10%, -5%]",
      (point: { index20: number }) =>
        point.index20 > -10 && point.index20 <= -5,
    ],
    [
      "指数 (-5%, 0%)",
      (point: { index20: number }) => point.index20 > -5 && point.index20 < 0,
    ],
    ["指数 >= 0%", (point: { index20: number }) => point.index20 >= 0],
  ] as const) {
    const selectedRolling = rolling20.filter(filter);
    const strategyMean = mean(selectedRolling.map(point => point.strategy20));
    const indexMean = mean(selectedRolling.map(point => point.index20));
    console.log(
      `${label} | ${selectedRolling.length} | ${fmtPct(strategyMean, 2)} | ` +
        `${fmtPct(indexMean, 2)} | ${fmtPct(
          strategyMean === null || indexMean === null
            ? null
            : strategyMean - indexMean,
          2
        )}`
    );
  }

  const drawdown = maxDrawdown(equityCurve);
  if (drawdown) {
    const peakIndex = benchmark.points.find(
      point => point.tradeDate >= drawdown.peakDate
    );
    const troughIndex = [...benchmark.points]
      .reverse()
      .find(point => point.tradeDate <= drawdown.troughDate);
    const indexDrawdownPct =
      peakIndex === undefined ||
      troughIndex === undefined ||
      peakIndex.close <= 0
        ? null
        : (troughIndex.close / peakIndex.close - 1) * 100;
    console.log(
      `\n最大回撤: ${drawdown.peakDate} -> ${drawdown.troughDate}，` +
        `策略 ${fmtPct(drawdown.drawdownPct, 2)}，` +
        `${benchmarkIndexCode} ${fmtPct(indexDrawdownPct, 2)}`
    );
  }

  const episodes = indexDrawdownEpisodes(benchmark.points, 10);
  console.log(`\n${benchmarkIndexCode} 下跌超过 10% 的阶段`);
  console.log("区间 | 指数跌幅 | 策略区间收益 | 策略/指数 | 终点平均仓位");
  console.log("--- | ---: | ---: | ---: | ---:");
  for (const episode of episodes) {
    const strategyPeak = pointAtOrAfter(equityCurve, episode.peakDate);
    const strategyTrough = pointAtOrAfter(equityCurve, episode.troughDate);
    const strategyReturnPct =
      strategyPeak === null ||
      strategyTrough === null ||
      strategyPeak.equity <= 0
        ? null
        : (strategyTrough.equity / strategyPeak.equity - 1) * 100;
    const exposurePct =
      strategyTrough === null ||
      strategyTrough.marketValue === null ||
      strategyTrough.equity <= 0
        ? null
        : (strategyTrough.marketValue / strategyTrough.equity) * 100;
    console.log(
      `${episode.peakDate} -> ${episode.troughDate} | ` +
        `${fmtPct(episode.indexReturnPct, 2)} | ${fmtPct(strategyReturnPct, 2)} | ` +
        `${fmt(
          strategyReturnPct === null || episode.indexReturnPct === 0
            ? null
            : strategyReturnPct / episode.indexReturnPct
        )} | ${fmtPct(exposurePct, 2)}`
    );
  }

  printEntryRegimeTable(
    `${benchmarkIndexCode} 买入前趋势状态（T+5 收盘，PIT）`,
    trades,
    benchmark.points,
    trade => {
      const point = benchmarkPointBefore(benchmark.points, trade.entryTime);
      if (point === null) return null;
      const ma20 = benchmarkMovingAverage(
        benchmark.points,
        point.tradeDate,
        20
      );
      const ma60 = benchmarkMovingAverage(
        benchmark.points,
        point.tradeDate,
        60
      );
      if (ma20 === null || ma60 === null) return null;
      if (point.close > ma20 && point.close > ma60)
        return "close > MA20 & MA60";
      if (point.close > ma20) return "MA60 < close <= MA20";
      if (point.close > ma60) return "MA20 < close <= MA60";
      return "close <= MA20 & MA60";
    }
  );
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
);
