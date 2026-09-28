/**
 * 3F TopN 重复首板事件诊断（只读留档）。
 *
 * 回答：
 *   1. 同一证券的第 1 / 第 2 / 第 3+ 次事件，交易结果是否明显不同；
 *   2. 逐年交易质量是否衰减；
 *   3. 策略实际只取到多少事件，和因子研究的事件池不是同一统计总体。
 *
 * 用法：
 *   npx tsx scripts/analyze3FTopNRepeatedEvents.mts --topn 3 --backtest-id 930001
 */

import "dotenv/config";
import {
  getClosedLoopBacktestRun,
  listClosedLoopBacktestRuns,
} from "../server/closedLoopBacktestRun/repository";
import { withReadRetry } from "../server/readRetry";

type Trade = {
  securityId: string;
  code: string | null;
  entryTime: string;
  exitTime: string | null;
  netPnl: number | null;
  returnPct: number | null;
  holdingPeriod: number | null;
  openAtEnd: boolean;
};

type EquityPoint = {
  date: string;
  equity: number;
};

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseResult(result: unknown): {
  trades: Trade[];
  equity: EquityPoint[];
} {
  if (!isRecord(result) || !Array.isArray(result.stages)) {
    return { trades: [], equity: [] };
  }
  const backtest = result.stages.find(
    stage => isRecord(stage) && stage.stageId === "backtest"
  );
  const output =
    isRecord(backtest) && isRecord(backtest.output) ? backtest.output : null;
  if (output === null) return { trades: [], equity: [] };

  const trades = (Array.isArray(output.trades) ? output.trades : [])
    .filter(
      (trade): trade is Trade =>
        isRecord(trade) &&
        typeof trade.securityId === "string" &&
        typeof trade.entryTime === "string" &&
        (trade.exitTime === null || typeof trade.exitTime === "string")
    )
    .map(trade => ({
      securityId: trade.securityId,
      code: typeof trade.code === "string" ? trade.code : null,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      netPnl: numberOrNull(trade.netPnl),
      returnPct: numberOrNull(trade.returnPct),
      holdingPeriod: numberOrNull(trade.holdingPeriod),
      openAtEnd: trade.openAtEnd === true,
    }));

  const equity = (Array.isArray(output.equityCurve) ? output.equityCurve : [])
    .filter(
      (point): point is EquityPoint =>
        isRecord(point) &&
        typeof point.date === "string" &&
        typeof point.equity === "number" &&
        Number.isFinite(point.equity) &&
        point.equity > 0
    )
    .map(point => ({ date: point.date, equity: point.equity }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return { trades, equity };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fmt(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value)
    ? "-"
    : value.toFixed(digits);
}

function fmtPct(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value)
    ? "-"
    : `${value.toFixed(digits)}%`;
}

function summarize(trades: readonly Trade[]): {
  count: number;
  meanReturnPct: number | null;
  winRatePct: number | null;
  totalNetPnl: number;
  meanHoldingPeriod: number | null;
} {
  const completed = trades.filter(
    trade => !trade.openAtEnd && trade.returnPct !== null
  );
  const returns = completed.map(trade => trade.returnPct!);
  const netPnls = completed
    .map(trade => trade.netPnl)
    .filter((value): value is number => value !== null);
  return {
    count: completed.length,
    meanReturnPct: mean(returns),
    winRatePct:
      completed.length === 0
        ? null
        : (returns.filter(value => value > 0).length / completed.length) * 100,
    totalNetPnl: netPnls.reduce((sum, value) => sum + value, 0),
    meanHoldingPeriod: mean(
      completed
        .map(trade => trade.holdingPeriod)
        .filter((value): value is number => value !== null)
    ),
  };
}

function printGroup(label: string, trades: readonly Trade[]): void {
  const stats = summarize(trades);
  console.log(
    `${label} | ${stats.count} | ${fmtPct(stats.meanReturnPct)} | ` +
      `${fmtPct(stats.winRatePct)} | ${fmt(stats.totalNetPnl)} | ` +
      `${fmt(stats.meanHoldingPeriod)}`
  );
}

async function main(): Promise<void> {
  const topN = Number(optionValue("--topn") ?? "3");
  const backtestId = Number(optionValue("--backtest-id") ?? "0");
  const strategyId = `first-limit-pullback-3f-top${topN}`;

  let detail =
    Number.isInteger(backtestId) && backtestId > 0
      ? await withReadRetry(`3F Top${topN} 留档 #${backtestId}`, () =>
          getClosedLoopBacktestRun(backtestId)
        )
      : null;
  if (detail === null) {
    const history = await withReadRetry(`3F Top${topN} 留档列表`, () =>
      listClosedLoopBacktestRuns({ strategyId, limit: 100 })
    );
    const latest = history[0];
    if (latest === undefined) throw new Error(`未找到 ${strategyId} 留档`);
    detail = await withReadRetry(`3F Top${topN} 留档 #${latest.id}`, () =>
      getClosedLoopBacktestRun(latest.id)
    );
  }
  if (detail === null || detail.result === null)
    throw new Error("留档无完整结果");
  if (detail.strategyId !== strategyId) {
    throw new Error(`留档策略是 ${detail.strategyId}，不是 ${strategyId}`);
  }

  const { trades, equity } = parseResult(detail.result);
  const completed = trades.filter(
    trade => !trade.openAtEnd && trade.returnPct !== null
  );
  const byCode = new Map<string, Trade[]>();
  for (const trade of completed) {
    const key = trade.code ?? trade.securityId;
    const bucket = byCode.get(key) ?? [];
    bucket.push(trade);
    byCode.set(key, bucket);
  }
  const ordinalBuckets = new Map<string, Trade[]>([
    ["第1次", []],
    ["第2次", []],
    ["第3-5次", []],
    ["第6次及以上", []],
  ]);
  for (const codeTrades of byCode.values()) {
    codeTrades
      .sort((left, right) => left.entryTime.localeCompare(right.entryTime))
      .forEach((trade, index) => {
        const ordinal = index + 1;
        const bucket =
          ordinal === 1
            ? "第1次"
            : ordinal === 2
              ? "第2次"
              : ordinal <= 5
                ? "第3-5次"
                : "第6次及以上";
        ordinalBuckets.get(bucket)!.push(trade);
      });
  }

  console.log(`3F Top${topN} 重复事件诊断`);
  console.log(`backtestId: ${detail.id}`);
  console.log(`runId: ${detail.runId}`);
  console.log(`strategyVersion: ${detail.strategyVersion}`);
  console.log(
    `完成交易 ${completed.length} 笔；涉及证券 ${byCode.size} 只；` +
      `平均每只 ${(completed.length / Math.max(1, byCode.size)).toFixed(2)} 笔`
  );

  console.log("\n同一证券的事件次序");
  console.log("次序 | 完成交易 | 平均收益率 | 胜率 | 净盈亏合计 | 平均持有日");
  console.log("--- | ---: | ---: | ---: | ---: | ---:");
  for (const [label, bucket] of ordinalBuckets) printGroup(label, bucket);

  console.log("\n按首次交易年份");
  console.log("年份 | 完成交易 | 平均收益率 | 胜率 | 净盈亏合计 | 平均持有日");
  console.log("--- | ---: | ---: | ---: | ---: | ---:");
  const byYear = new Map<string, Trade[]>();
  for (const trade of completed) {
    const year = trade.entryTime.slice(0, 4);
    const bucket = byYear.get(year) ?? [];
    bucket.push(trade);
    byYear.set(year, bucket);
  }
  for (const [year, bucket] of [...byYear.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    printGroup(year, bucket);
  }

  console.log("\n权益曲线年度变化");
  console.log("年份 | 年初权益 | 年末权益 | 年度变化");
  console.log("--- | ---: | ---: | ---:");
  const equityByYear = new Map<string, EquityPoint[]>();
  for (const point of equity) {
    const year = point.date.slice(0, 4);
    const bucket = equityByYear.get(year) ?? [];
    bucket.push(point);
    equityByYear.set(year, bucket);
  }
  for (const [year, bucket] of [...equityByYear.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    console.log(
      `${year} | ${first.equity.toFixed(2)} | ${last.equity.toFixed(2)} | ` +
        `${((last.equity / first.equity - 1) * 100).toFixed(2)}%`
    );
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
);
