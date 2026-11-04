/**
 * 筛选 3F TopN 某版本中 T+5 跌停的事件，并比较后续收益。
 *
 * 用法：
 *   npx tsx scripts/analyze3FTopNT5LimitDown.mts --version 1.14.0
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

type RawTrade = {
  securityId: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  quantity: number;
  netPnl: number | null;
  returnPct: number | null;
  holdingPeriod: number | null;
  openAtEnd: boolean;
  reason: string | null;
};

type PostRow = {
  eventId: string;
  tradeDate: string;
  relativeDay: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  limitDownPrice: number | null;
};

type Evaluated = {
  trade: RawTrade;
  eventId: string;
  code: string;
  eventDate: string;
  rows: Map<number, PostRow>;
  touchedLimitDown: boolean;
  closeAtLimitDown: boolean;
  oneWordLimitDown: boolean;
  returnToT10Pct: number | null;
  returnToT15Pct: number | null;
  returnToT20Pct: number | null;
  maxDrawdownT6ToT20Pct: number | null;
};

function argOf(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1]!;
  return fallback;
}

function dateText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function pct(value: number, base: number): number {
  return (value / base - 1) * 100;
}

function metrics(items: readonly Evaluated[]) {
  const returns = items
    .map(item => item.trade.returnPct)
    .filter((value): value is number => value !== null);
  const netPnls = items
    .map(item => item.trade.netPnl)
    .filter((value): value is number => value !== null);
  const wins = netPnls.filter(value => value > 0);
  const losses = netPnls.filter(value => value < 0);
  const totalWin = wins.reduce((sum, value) => sum + value, 0);
  const totalLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const fixed = (key: "returnToT10Pct" | "returnToT15Pct" | "returnToT20Pct") =>
    mean(
      items
        .map(item => item[key])
        .filter((value): value is number => value !== null),
    );
  return {
    count: items.length,
    sharePct: null as number | null,
    avgActualReturnPct: mean(returns),
    medianActualReturnPct: median(returns),
    avgNetPnl: mean(netPnls),
    winRatePct:
      items.length === 0 ? null : (wins.length / items.length) * 100,
    profitFactor:
      totalLoss === 0 ? (totalWin > 0 ? null : 0) : totalWin / totalLoss,
    avgReturnToT10Pct: fixed("returnToT10Pct"),
    avgReturnToT15Pct: fixed("returnToT15Pct"),
    avgReturnToT20Pct: fixed("returnToT20Pct"),
    avgMaxDrawdownT6ToT20Pct: mean(
      items
        .map(item => item.maxDrawdownT6ToT20Pct)
        .filter((value): value is number => value !== null),
    ),
    stopCount: items.filter(item => item.trade.reason?.includes("止损")).length,
    trailingCount: items.filter(item =>
      item.trade.reason?.includes("回撤止盈"),
    ).length,
    timeExitCount: items.filter(item => item.trade.reason?.includes("持有满"))
      .length,
  };
}

function printMetrics(label: string, value: ReturnType<typeof metrics>): void {
  const fmt = (number: number | null, digits = 2, suffix = "") =>
    number === null ? "—" : `${number.toFixed(digits)}${suffix}`;
  console.log(
    `${label}: 样本 ${value.count}，实际平均收益 ${fmt(value.avgActualReturnPct, 2, "%")}，` +
      `实际中位 ${fmt(value.medianActualReturnPct, 2, "%")}，胜率 ${fmt(value.winRatePct, 2, "%")}，` +
      `PF ${fmt(value.profitFactor, 4)}，平均净盈亏 ${fmt(value.avgNetPnl)} 元`,
  );
  console.log(
    `  T+10 ${fmt(value.avgReturnToT10Pct, 2, "%")}，` +
      `T+15 ${fmt(value.avgReturnToT15Pct, 2, "%")}，` +
      `T+20 ${fmt(value.avgReturnToT20Pct, 2, "%")}，` +
      `T6~T20最大不利波动 ${fmt(value.avgMaxDrawdownT6ToT20Pct, 2, "%")}；` +
      `止损 ${value.stopCount} / 回撤止盈 ${value.trailingCount} / 时间退出 ${value.timeExitCount}`,
  );
}

async function main(): Promise<void> {
  const strategyId = argOf("strategy-id", "first-limit-pullback-3f-top3");
  const version = argOf("version", "1.14.0");
  const out = argOf(
    "out",
    `docs/evidence/_analysis_3f_top3_v${version.replaceAll(".", "_")}_t5_limit_down.csv`,
  );

  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const url = new URL(raw);
  const sslMatch = raw.match(/[?&]ssl=(\{[^&]*\})/);
  const ssl = sslMatch ? JSON.parse(sslMatch[1]) : undefined;
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 4000),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl,
    connectTimeout: 20_000,
  });

  const [runRows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id,runId,strategyVersion,datasetVersionId,resultJson FROM closed_loop_backtest_run WHERE strategyId=? AND strategyVersion=? ORDER BY createdAt DESC LIMIT 1",
    [strategyId, version],
  );
  const run = runRows[0];
  if (!run) throw new Error(`未找到 ${strategyId}@${version}`);
  const result = JSON.parse(String(run.resultJson)) as {
    stages: Array<{ stageId: string; output?: { trades?: RawTrade[] } }>;
  };
  const trades = result.stages.find(stage => stage.stageId === "backtest")
    ?.output?.trades;
  if (!Array.isArray(trades)) throw new Error("留档没有 trades");
  const completed = trades.filter(trade => !trade.openAtEnd && trade.returnPct !== null);

  const eventIdByTrade = new Map<RawTrade, string>();
  for (const trade of completed) {
    const match = String(trade.securityId).match(/::event:(.+)$/);
    if (match?.[1]) eventIdByTrade.set(trade, match[1]);
  }
  const eventIds = [...new Set(eventIdByTrade.values())];
  const rowsByEvent = new Map<string, Map<number, PostRow>>();
  const batchSize = 300;
  for (let index = 0; index < eventIds.length; index += batchSize) {
    const batch = eventIds.slice(index, index + batchSize);
    const placeholders = batch.map(() => "?").join(",");
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT eventId,tradeDate,relativeDay,open,high,low,close,limitDownPrice
       FROM ds_first_limit_pullback_post
       WHERE datasetVersionId=? AND relativeDay BETWEEN 5 AND 20 AND eventId IN (${placeholders})`,
      [run.datasetVersionId, ...batch],
    );
    for (const rawRow of rows) {
      const eventId = String(rawRow.eventId);
      const day = Number(rawRow.relativeDay);
      const map = rowsByEvent.get(eventId) ?? new Map<number, PostRow>();
      map.set(day, {
        eventId,
        tradeDate: dateText(rawRow.tradeDate),
        relativeDay: day,
        open: finite(rawRow.open),
        high: finite(rawRow.high),
        low: finite(rawRow.low),
        close: finite(rawRow.close),
        limitDownPrice: finite(rawRow.limitDownPrice),
      });
      rowsByEvent.set(eventId, map);
    }
  }

  const evaluated: Evaluated[] = [];
  for (const trade of completed) {
    const eventId = eventIdByTrade.get(trade);
    if (!eventId) continue;
    const rows = rowsByEvent.get(eventId);
    if (!rows) continue;
    const day5 = rows.get(5);
    const day6 = rows.get(6);
    if (!day5 || !day6?.open) continue;
    const limitDownPrice = day5.limitDownPrice;
    if (limitDownPrice === null) continue;
    const tolerance = 1e-5;
    const touchedLimitDown =
      day5.low !== null && day5.low <= limitDownPrice + tolerance;
    const closeAtLimitDown =
      day5.close !== null && day5.close <= limitDownPrice + tolerance;
    const oneWordLimitDown =
      day5.open !== null &&
      day5.high !== null &&
      day5.low !== null &&
      day5.close !== null &&
      Math.abs(day5.open - limitDownPrice) <= tolerance &&
      Math.abs(day5.high - limitDownPrice) <= tolerance &&
      Math.abs(day5.low - limitDownPrice) <= tolerance &&
      Math.abs(day5.close - limitDownPrice) <= tolerance;
    const entry = day6.open;
    const closeAt = (day: number) => rows.get(day)?.close ?? null;
    const lowDays = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
      .map(day => rows.get(day)?.low ?? null)
      .filter((value): value is number => value !== null);
    const minimumLow = lowDays.length === 0 ? null : Math.min(...lowDays);
    evaluated.push({
      trade,
      eventId,
      code: eventId.split("@")[0] ?? eventId,
      eventDate: eventId.split("@")[1] ?? "",
      rows,
      touchedLimitDown,
      closeAtLimitDown,
      oneWordLimitDown,
      returnToT10Pct:
        closeAt(10) === null ? null : pct(closeAt(10)!, entry),
      returnToT15Pct:
        closeAt(15) === null ? null : pct(closeAt(15)!, entry),
      returnToT20Pct:
        closeAt(20) === null ? null : pct(closeAt(20)!, entry),
      maxDrawdownT6ToT20Pct:
        minimumLow === null ? null : pct(minimumLow, entry),
    });
  }

  const groups = [
    { label: "全部完成交易", items: evaluated },
    {
      label: "T+5盘中触及跌停",
      items: evaluated.filter(item => item.touchedLimitDown),
    },
    {
      label: "T+5收盘跌停",
      items: evaluated.filter(item => item.closeAtLimitDown),
    },
    {
      label: "T+5一字跌停",
      items: evaluated.filter(item => item.oneWordLimitDown),
    },
    {
      label: "T+5未触及跌停",
      items: evaluated.filter(item => !item.touchedLimitDown),
    },
  ].map(group => ({
    ...group,
    metrics: {
      ...metrics(group.items),
      sharePct:
        evaluated.length === 0 ? null : (group.items.length / evaluated.length) * 100,
    },
  }));

  console.log(`runId=${run.runId}`);
  console.log(`版本=v${run.strategyVersion}，完成交易=${completed.length}，可判定=${evaluated.length}`);
  for (const group of groups) {
    console.log(`\n[${group.label}] 占比 ${group.metrics.sharePct?.toFixed(2) ?? "—"}%`);
    printMetrics(group.label, group.metrics);
  }

  const headers = [
    "eventId",
    "code",
    "eventDate",
    "entryTime",
    "touchedLimitDown",
    "closeAtLimitDown",
    "oneWordLimitDown",
    "actualReturnPct",
    "netPnl",
    "exitReason",
    "returnToT10Pct",
    "returnToT15Pct",
    "returnToT20Pct",
    "maxDrawdownT6ToT20Pct",
  ];
  const csvRows = evaluated.map(item => [
    item.eventId,
    item.code,
    item.eventDate,
    item.trade.entryTime,
    item.touchedLimitDown,
    item.closeAtLimitDown,
    item.oneWordLimitDown,
    item.trade.returnPct,
    item.trade.netPnl,
    item.trade.reason,
    item.returnToT10Pct,
    item.returnToT15Pct,
    item.returnToT20Pct,
    item.maxDrawdownT6ToT20Pct,
  ]);
  const csv = [headers, ...csvRows]
    .map(row =>
      row
        .map(value => {
          const text = value === null || value === undefined ? "" : String(value);
          return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(","),
    )
    .join("\r\n");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${csv}\r\n`, "utf8");
  console.log(`\nCSV=${path.resolve(out)}`);
  await connection.end();
}

await main();
