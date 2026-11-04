/**
 * 基于冻结的 6% 止损基准，校准“第5个持有日仍强势”的续持标准。
 *
 * 第5个持有日 = 买入日之后第 4 个交易日收盘（事件 T+10）。
 * 原策略在下一交易日开盘卖出；本脚本比较继续持有到 T+20 后的简化退出结果。
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { stockDailyPrices } from "../drizzle/schema";
import { getDb } from "../server/db";
import { withReadRetry } from "../server/readRetry";
import {
  buildTradingCalendar,
  type TradingCalendar,
} from "../server/security/tradingCalendar";

const BASE_JSON = "docs/evidence/_probe_3f_top3_stop6_baseline.json";
const OUT_JSON = "docs/evidence/_probe_3f_top3_strong_hold_calibration.json";
const STOP_LOSS_RATIO = 0.06;
const TRAILING_DRAWDOWN_RATIO = 0.05;

type Trade = {
  securityId: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  returnPct: number | null;
  holdingPeriod: number | null;
  openAtEnd: boolean;
  reason: string | null;
  code?: string | null;
  name?: string | null;
};

type BarRow = {
  tradeDate: string;
  openPrice: string | null;
  closePrice: string | null;
  highPrice: string | null;
  lowPrice: string | null;
  preClosePrice: string | null;
  volume: string | null;
};

type Bar = {
  tradeDate: string;
  open: number;
  close: number;
  high: number;
  low: number;
  preClose: number | null;
  volume: number | null;
};

type Evaluated = {
  trade: Trade;
  eventDate: string;
  day5Date: string;
  baseExitDate: string;
  baseExitPrice: number;
  baseReturnPct: number;
  altExitDate: string;
  altExitPrice: number;
  altReturnPct: number;
  upliftPct: number;
  altStopped: boolean;
  futureMaxCloseReturnPct: number | null;
  returnAtDay5Pct: number;
  day5ChangePct: number | null;
  day5VolumeRatioVsT0: number | null;
  aboveMa5: boolean;
  aboveMa10: boolean;
  peakDrawdownAtDay5Pct: number;
  year: number;
};

type Condition = {
  id: string;
  label: string;
  test: (item: Evaluated) => boolean;
};

const CONDITIONS: readonly Condition[] = [
  { id: "RET_GE_0", label: "第5日收益 >= 0%", test: item => item.returnAtDay5Pct >= 0 },
  { id: "RET_GE_2", label: "第5日收益 >= 2%", test: item => item.returnAtDay5Pct >= 2 },
  { id: "RET_GE_3", label: "第5日收益 >= 3%", test: item => item.returnAtDay5Pct >= 3 },
  { id: "RET_GE_5", label: "第5日收益 >= 5%", test: item => item.returnAtDay5Pct >= 5 },
  { id: "MA5_MA10", label: "第5日收盘 > MA5 且 > MA10", test: item => item.aboveMa5 && item.aboveMa10 },
  {
    id: "RET_GE_2_MA",
    label: "第5日收益 >= 2% 且收盘 > MA5/MA10",
    test: item => item.returnAtDay5Pct >= 2 && item.aboveMa5 && item.aboveMa10,
  },
  {
    id: "RET_GE_3_MA",
    label: "第5日收益 >= 3% 且收盘 > MA5/MA10",
    test: item => item.returnAtDay5Pct >= 3 && item.aboveMa5 && item.aboveMa10,
  },
  {
    id: "RET_GE_3_DD_3",
    label: "第5日收益 >= 3% 且峰值回撤不超过3%",
    test: item => item.returnAtDay5Pct >= 3 && item.peakDrawdownAtDay5Pct >= -3,
  },
  {
    id: "RET_GE_2_MA_DD_3",
    label: "收益>=2%、收盘>MA5/MA10、峰值回撤<=3%",
    test: item =>
      item.returnAtDay5Pct >= 2 &&
      item.aboveMa5 &&
      item.aboveMa10 &&
      item.peakDrawdownAtDay5Pct >= -3,
  },
  {
    id: "RET_GE_3_MA_DD_5",
    label: "收益>=3%、收盘>MA5/MA10、峰值回撤<=5%",
    test: item =>
      item.returnAtDay5Pct >= 3 &&
      item.aboveMa5 &&
      item.aboveMa10 &&
      item.peakDrawdownAtDay5Pct >= -5,
  },
];

function parsePositive(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegative(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function pct(close: number, base: number): number {
  return (close / base - 1) * 100;
}

function movingAverage(
  bars: readonly Bar[],
  index: number,
  window: number,
): number | null {
  if (index + 1 < window) return null;
  let sum = 0;
  for (let offset = index + 1 - window; offset <= index; offset += 1) {
    sum += bars[offset]!.close;
  }
  return sum / window;
}

function eventDateOf(trade: Trade): string | null {
  const match = String(trade.securityId).match(/::event:[^@]+@(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function codeOf(trade: Trade): string | null {
  if (trade.code) return trade.code;
  const match = String(trade.securityId).match(/::event:([^@]+)@/);
  return match?.[1] ?? null;
}

function simulateContinuedExit(
  bars: readonly Bar[],
  entryIndex: number,
  entryPrice: number,
  day5Index: number,
): { date: string; price: number; stopped: boolean; maxCloseReturnPct: number | null } | null {
  let peakClose = Math.max(
    entryPrice,
    ...bars.slice(entryIndex, day5Index + 1).map(bar => bar.close),
  );
  let maxCloseReturnPct: number | null = null;
  for (
    let index = day5Index + 1;
    index < bars.length && index <= day5Index + 10;
    index += 1
  ) {
    const bar = bars[index]!;
    maxCloseReturnPct = Math.max(
      maxCloseReturnPct ?? Number.NEGATIVE_INFINITY,
      pct(bar.close, entryPrice),
    );
    const stopPrice = entryPrice * (1 - STOP_LOSS_RATIO);
    if (bar.low <= stopPrice) {
      return {
        date: bar.tradeDate,
        price: Math.min(bar.open, stopPrice),
        stopped: true,
        maxCloseReturnPct,
      };
    }
    peakClose = Math.max(peakClose, bar.close);
    const drawdown = (bar.close - peakClose) / peakClose;
    if (peakClose / entryPrice - 1 > 0 && drawdown <= -TRAILING_DRAWDOWN_RATIO) {
      const next = bars[index + 1] ?? null;
      return {
        date: next?.tradeDate ?? bar.tradeDate,
        price: next?.open ?? bar.close,
        stopped: false,
        maxCloseReturnPct,
      };
    }
  }
  const finalBar = bars[Math.min(day5Index + 10, bars.length - 1)]!;
  return {
    date: finalBar.tradeDate,
    price: finalBar.close,
    stopped: false,
    maxCloseReturnPct,
  };
}

function buildMetrics(items: readonly Evaluated[]) {
  const baseReturns = items.map(item => item.baseReturnPct);
  const altReturns = items.map(item => item.altReturnPct);
  const uplift = items.map(item => item.upliftPct);
  const futureMax = items
    .map(item => item.futureMaxCloseReturnPct)
    .filter((value): value is number => value !== null);
  return {
    count: items.length,
    baseAvgReturnPct: mean(baseReturns),
    baseMedianReturnPct: median(baseReturns),
    altAvgReturnPct: mean(altReturns),
    altMedianReturnPct: median(altReturns),
    altWinRatePct:
      items.length === 0
        ? null
        : (altReturns.filter(value => value > 0).length / items.length) * 100,
    upliftAvgPct: mean(uplift),
    upliftMedianPct: median(uplift),
    improvedRatePct:
      items.length === 0
        ? null
        : (uplift.filter(value => value > 0).length / items.length) * 100,
    stopRatePct:
      items.length === 0
        ? null
        : (items.filter(item => item.altStopped).length / items.length) * 100,
    futureMaxCloseAvgPct: mean(futureMax),
  };
}

async function main(): Promise<void> {
  const base = JSON.parse(fs.readFileSync(BASE_JSON, "utf8")) as {
    rows: Array<{ stopLossPct: number; trades: Trade[] }>;
  };
  const baseline = base.rows.find(row => row.stopLossPct === 6);
  if (!baseline) throw new Error("6% 基准缺少 trades");
  const reachedDay5 = baseline.trades.filter(
    trade =>
      !trade.openAtEnd &&
      trade.reason?.includes("持有满5个交易日") &&
      codeOf(trade),
  );
  if (reachedDay5.length === 0) throw new Error("没有达到第5日的交易");

  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const minEntry = reachedDay5.map(trade => trade.entryTime).sort()[0]!;
  const maxEntry = reachedDay5.map(trade => trade.entryTime).sort().at(-1)!;
  const calendarStart = new Date(`${minEntry}T00:00:00.000Z`);
  calendarStart.setUTCDate(calendarStart.getUTCDate() - 45);
  const calendarEnd = new Date(`${maxEntry}T00:00:00.000Z`);
  calendarEnd.setUTCDate(calendarEnd.getUTCDate() + 60);
  const marketDates = await withReadRetry("strong-hold.calendar", async () =>
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
  const calendar: TradingCalendar = buildTradingCalendar(
    marketDates.map(row => row.tradeDate),
    "strong-hold",
  );

  const byCode = new Map<string, Trade[]>();
  for (const trade of reachedDay5) {
    const code = codeOf(trade)!;
    const list = byCode.get(code) ?? [];
    list.push(trade);
    byCode.set(code, list);
  }

  const barsByCode = new Map<string, Bar[]>();
  const failures: string[] = [];
  const entries = [...byCode.entries()];
  let cursor = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= entries.length) return;
      const [code, trades] = entries[index]!;
      const dates: string[] = [];
      for (const trade of trades) {
        const eventDate = eventDateOf(trade);
        if (!eventDate) continue;
        const start = calendar.addTradingDays(eventDate, -10) ?? eventDate;
        const day20 = calendar.addTradingDays(trade.entryTime, 14) ?? trade.entryTime;
        dates.push(start, day20);
      }
      const startDate = dates.sort()[0]!;
      const endDate = dates.sort().at(-1)!;
      try {
        const rows = await withReadRetry(`strong-hold.${code}`, async () =>
          await db
            .select({
              tradeDate: stockDailyPrices.tradeDate,
              openPrice: stockDailyPrices.openPrice,
              closePrice: stockDailyPrices.closePrice,
              highPrice: stockDailyPrices.highPrice,
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
        const bars = rows
          .map(row => ({
            tradeDate: row.tradeDate,
            open: parsePositive(row.openPrice),
            close: parsePositive(row.closePrice),
            high: parsePositive(row.highPrice),
            low: parsePositive(row.lowPrice),
            preClose: parsePositive(row.preClosePrice),
            volume: parseNonNegative(row.volume),
          }))
          .filter(
            (bar): bar is Bar =>
              bar.open !== null &&
              bar.close !== null &&
              bar.high !== null &&
              bar.low !== null,
          );
        barsByCode.set(code, bars);
      } catch (error) {
        failures.push(`${code}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  await Promise.all(workers);

  const evaluated: Evaluated[] = [];
  for (const trade of reachedDay5) {
    const code = codeOf(trade)!;
    const eventDate = eventDateOf(trade);
    const bars = barsByCode.get(code);
    if (!eventDate || !bars) continue;
    const day5Date = calendar.addTradingDays(trade.entryTime, 4);
    const baseExitDate = calendar.addTradingDays(trade.entryTime, 5);
    if (!day5Date || !baseExitDate) continue;
    const entryIndex = bars.findIndex(bar => bar.tradeDate === trade.entryTime);
    const day5Index = bars.findIndex(bar => bar.tradeDate === day5Date);
    const baseExitIndex = bars.findIndex(bar => bar.tradeDate === baseExitDate);
    if (entryIndex < 0 || day5Index < 0 || baseExitIndex < 0) continue;
    const eventIndex = bars.findIndex(bar => bar.tradeDate === eventDate);
    const day5 = bars[day5Index]!;
    const baseExit = bars[baseExitIndex]!;
    const priorCloses = bars.slice(entryIndex, day5Index + 1).map(bar => bar.close);
    const peakAtDay5 = Math.max(...priorCloses);
    const ma5 = movingAverage(bars, day5Index, 5);
    const ma10 = movingAverage(bars, day5Index, 10);
    const t0Volume = eventIndex < 0 ? null : bars[eventIndex]!.volume;
    const continuation = simulateContinuedExit(
      bars,
      entryIndex,
      trade.entryPrice,
      day5Index,
    );
    if (!continuation) continue;
    const baseReturnPct = pct(baseExit.open, trade.entryPrice);
    const altReturnPct = pct(continuation.price, trade.entryPrice);
    evaluated.push({
      trade,
      eventDate,
      day5Date,
      baseExitDate,
      baseExitPrice: baseExit.open,
      baseReturnPct,
      altExitDate: continuation.date,
      altExitPrice: continuation.price,
      altReturnPct,
      upliftPct: altReturnPct - baseReturnPct,
      altStopped: continuation.stopped,
      futureMaxCloseReturnPct: continuation.maxCloseReturnPct,
      returnAtDay5Pct: pct(day5.close, trade.entryPrice),
      day5ChangePct:
        day5.preClose === null ? null : pct(day5.close, day5.preClose),
      day5VolumeRatioVsT0:
        t0Volume === null || t0Volume <= 0 || day5.volume === null
          ? null
          : day5.volume / t0Volume,
      aboveMa5: ma5 !== null && day5.close > ma5,
      aboveMa10: ma10 !== null && day5.close > ma10,
      peakDrawdownAtDay5Pct: pct(day5.close, peakAtDay5),
      year: Number(trade.entryTime.slice(0, 4)),
    });
  }

  const periods = [
    { id: "ALL", label: "全样本", items: evaluated },
    {
      id: "OBS",
      label: "2019-2023",
      items: evaluated.filter(item => item.year <= 2023),
    },
    {
      id: "HOLDOUT",
      label: "2024-2026",
      items: evaluated.filter(item => item.year >= 2024),
    },
  ];
  const rows = periods.map(period => ({
    period: period.id,
    label: period.label,
    baseline: buildMetrics(period.items),
    conditions: CONDITIONS.map(condition => ({
      id: condition.id,
      label: condition.label,
      metrics: buildMetrics(period.items.filter(condition.test)),
    })),
  }));
  const payload = {
    generatedAt: new Date().toISOString(),
    source: BASE_JSON,
    stopLossRatio: STOP_LOSS_RATIO,
    reachedDay5Count: reachedDay5.length,
    evaluatedCount: evaluated.length,
    failures,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  for (const row of rows) {
    console.log(`\n[${row.label}] base=${row.baseline.count}`);
    for (const condition of row.conditions) {
      const m = condition.metrics;
      console.log(
        `${condition.label}: n=${m.count} alt=${m.altAvgReturnPct?.toFixed(2)}% ` +
          `uplift=${m.upliftAvgPct?.toFixed(2)}pp improve=${m.improvedRatePct?.toFixed(1)}% ` +
          `stop=${m.stopRatePct?.toFixed(1)}%`,
      );
    }
  }
  console.log(`\noutput=${path.resolve(OUT_JSON)}`);
}

await main();
