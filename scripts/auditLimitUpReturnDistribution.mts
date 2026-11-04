import "dotenv/config";
import { and, eq, max } from "drizzle-orm";
import { getDb } from "../server/db";
import {
  firstLimitPullbackEvents,
  firstLimitPullbackPrefixes,
  limitUpRecords,
  stockDailyPrices,
} from "../drizzle/schema";
import { classifyBoard, isStStock } from "../server/data/boardRules";

function readNumberFlag(args: string[], name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

interface AuditRow {
  symbol: string;
  tradeDate: string;
  previousClose: number | null;
  limitUpPrice: number | null;
  close: number | null;
  boardType?: string | null;
  stockName?: string | null;
}

function summarize(label: string, rows: readonly AuditRow[]): void {
  const usable = rows
    .map(row => {
      const previousClose = row.previousClose;
      const close = row.close;
      const limitUpPrice = row.limitUpPrice;
      if (
        previousClose === null ||
        previousClose <= 0 ||
        close === null ||
        close <= 0 ||
        limitUpPrice === null
      ) {
        return null;
      }
      return {
        ...row,
        previousClose,
        close,
        limitUpPrice,
        pct: (close / previousClose - 1) * 100,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (usable.length === 0) {
    console.log(`\n=== ${label} ===\n无可用行情行`);
    return;
  }

  const pcts = usable.map(row => row.pct).sort((a, b) => a - b);
  const countBelow = (threshold: number): number =>
    usable.filter(row => row.pct < threshold).length;
  const exactLimit = usable.filter(
    row => Math.abs(row.close - row.limitUpPrice) <= 1e-9
  ).length;
  const aboveLimit = usable.filter(
    row => row.close > row.limitUpPrice + 1e-9
  ).length;
  const overLimitRows = usable
    .map(row => ({
      ...row,
      excessRatio: row.close / row.limitUpPrice - 1,
    }))
    .filter(row => row.excessRatio > 1e-9)
    .sort((a, b) => b.excessRatio - a.excessRatio);

  console.log(`\n=== ${label} ===`);
  console.log(`样本：${usable.length}`);
  console.log(
    `收盘恰等于涨停价：${exactLimit} (${round((exactLimit / usable.length) * 100, 2)}%)`
  );
  console.log(
    `收盘高于涨停价：${aboveLimit} (${round((aboveLimit / usable.length) * 100, 2)}%)`
  );
  console.log(
    `高于涨停价幅度：>0.1%=${overLimitRows.filter(row => row.excessRatio > 0.001).length} ` +
      `>1%=${overLimitRows.filter(row => row.excessRatio > 0.01).length} ` +
      `>5%=${overLimitRows.filter(row => row.excessRatio > 0.05).length} ` +
      `>10%=${overLimitRows.filter(row => row.excessRatio > 0.1).length} ` +
      `>100%=${overLimitRows.filter(row => row.excessRatio > 1).length}`
  );
  console.log(
    `实际涨幅：min=${round(pcts[0]!, 4)}% p1=${round(quantile(pcts, 0.01), 4)}% ` +
      `p5=${round(quantile(pcts, 0.05), 4)}% median=${round(quantile(pcts, 0.5), 4)}% ` +
      `p95=${round(quantile(pcts, 0.95), 4)}% max=${round(pcts[pcts.length - 1]!, 4)}%`
  );
  console.log(
    `低于阈值：<10%=${countBelow(10)} <9.95%=${countBelow(9.95)} ` +
      `<9.9%=${countBelow(9.9)} <9.8%=${countBelow(9.8)} <9.5%=${countBelow(9.5)} ` +
      `<9%=${countBelow(9)}`
  );

  const boardCounts = new Map<string, number>();
  for (const row of usable) {
    const board = row.boardType ?? classifyBoard(row.symbol);
    boardCounts.set(board, (boardCounts.get(board) ?? 0) + 1);
  }
  console.log(
    `板块：${[...boardCounts.entries()]
      .map(([board, count]) => `${board}=${count}`)
      .join(" ")}`
  );

  console.log("涨幅最低样例：");
  for (const row of [...usable].sort((a, b) => a.pct - b.pct).slice(0, 15)) {
    const name = row.stockName ? ` ${row.stockName}` : "";
    console.log(
      `  ${row.symbol}${name} ${row.tradeDate} ` +
        `preClose=${row.previousClose} close=${row.close} limit=${row.limitUpPrice} ` +
        `pct=${round(row.pct, 4)}%`
    );
  }

  if (overLimitRows.length > 0) {
    console.log("收盘高于涨停价样例：");
    for (const row of overLimitRows.slice(0, 15)) {
      const name = row.stockName ? ` ${row.stockName}` : "";
      console.log(
        `  ${row.symbol}${name} ${row.tradeDate} ` +
          `preClose=${row.previousClose} close=${row.close} limit=${row.limitUpPrice} ` +
          `pct=${round(row.pct, 4)}% aboveLimit=${round(row.excessRatio * 100, 4)}%`
      );
    }
  }
}

const args = process.argv.slice(2);
const versionIds = [570001, 540002];
const explicitVersionId = readNumberFlag(args, "version");
if (explicitVersionId !== undefined)
  versionIds.splice(0, versionIds.length, explicitVersionId);

const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}

for (const versionId of versionIds) {
  const rows = await db
    .select({
      symbol: firstLimitPullbackEvents.symbol,
      tradeDate: firstLimitPullbackEvents.tradeDate,
      previousClose: firstLimitPullbackEvents.previousClose,
      limitUpPrice: firstLimitPullbackEvents.limitUpPrice,
      boardType: firstLimitPullbackEvents.boardType,
      daysSincePreviousLimit: firstLimitPullbackEvents.daysSincePreviousLimit,
      close: firstLimitPullbackPrefixes.close,
    })
    .from(firstLimitPullbackEvents)
    .innerJoin(
      firstLimitPullbackPrefixes,
      and(
        eq(
          firstLimitPullbackPrefixes.datasetVersionId,
          firstLimitPullbackEvents.datasetVersionId
        ),
        eq(
          firstLimitPullbackPrefixes.eventId,
          firstLimitPullbackEvents.eventId
        ),
        eq(firstLimitPullbackPrefixes.relativeDay, 0)
      )
    )
    .where(eq(firstLimitPullbackEvents.datasetVersionId, versionId));
  summarize(`Dataset version ${versionId}`, rows);

  const featureRows = await db
    .select({
      eventId: firstLimitPullbackPrefixes.eventId,
      relativeDay: firstLimitPullbackPrefixes.relativeDay,
      close: firstLimitPullbackPrefixes.close,
    })
    .from(firstLimitPullbackPrefixes)
    .where(eq(firstLimitPullbackPrefixes.datasetVersionId, versionId));
  const minus11ByEvent = new Map(
    featureRows
      .filter(row => row.relativeDay === -11 && row.close !== null)
      .map(row => [row.eventId, row.close!] as const)
  );
  const minus1ByEvent = new Map(
    featureRows
      .filter(row => row.relativeDay === -1 && row.close !== null)
      .map(row => [row.eventId, row.close!] as const)
  );
  const eventIdRows = await db
    .select({
      eventId: firstLimitPullbackEvents.eventId,
      tradeDate: firstLimitPullbackEvents.tradeDate,
    })
    .from(firstLimitPullbackEvents)
    .where(eq(firstLimitPullbackEvents.datasetVersionId, versionId));
  const eventDateById = new Map(
    eventIdRows.map(row => [row.eventId, row.tradeDate] as const)
  );

  const signalAudit = rows.map(row => {
    const closeMinus11 = minus11ByEvent.get(`${row.symbol}@${row.tradeDate}`);
    const closeMinus1 = minus1ByEvent.get(`${row.symbol}@${row.tradeDate}`);
    const preReturn =
      closeMinus11 === undefined ||
      closeMinus1 === undefined ||
      closeMinus11 <= 0
        ? null
        : closeMinus1 / closeMinus11 - 1;
    const days =
      "daysSincePreviousLimit" in row ? row.daysSincePreviousLimit : null;
    const isSignal =
      days !== null &&
      days !== undefined &&
      days > 20 &&
      preReturn !== null &&
      preReturn < -0.1;
    const aboveLimit =
      row.close !== null &&
      row.limitUpPrice !== null &&
      row.close > row.limitUpPrice + 1e-9;
    return {
      tradeDate:
        eventDateById.get(`${row.symbol}@${row.tradeDate}`) ?? row.tradeDate,
      isSignal,
      aboveLimit,
    };
  });
  for (const [label, startDate, endDate] of [
    ["Observation", "2024-09-01", "2025-12-31"],
    ["Holdout", "2026-01-01", "2026-09-04"],
  ] as const) {
    const inWindow = signalAudit.filter(
      row => row.tradeDate >= startDate && row.tradeDate <= endDate
    );
    console.log(
      `冻结条件 ${label}：事件=${inWindow.length} 信号=${inWindow.filter(row => row.isSignal).length} ` +
        `事件中高于涨停价=${inWindow.filter(row => row.aboveLimit).length} ` +
        `信号中高于涨停价=${inWindow.filter(row => row.isSignal && row.aboveLimit).length}`
    );
  }
}

const latestDateRow = await db
  .select({ latestDate: max(limitUpRecords.limitUpDate) })
  .from(limitUpRecords);
const latestDate = latestDateRow[0]?.latestDate;
if (latestDate) {
  const legacyRows = await db
    .select({
      symbol: limitUpRecords.stockCode,
      stockName: limitUpRecords.stockName,
      tradeDate: limitUpRecords.limitUpDate,
      previousClose: stockDailyPrices.preClosePrice,
      close: stockDailyPrices.closePrice,
    })
    .from(limitUpRecords)
    .leftJoin(
      stockDailyPrices,
      and(
        eq(stockDailyPrices.stockCode, limitUpRecords.stockCode),
        eq(stockDailyPrices.tradeDate, limitUpRecords.limitUpDate)
      )
    )
    .where(eq(limitUpRecords.limitUpDate, latestDate));

  const auditRows: AuditRow[] = legacyRows.map(row => {
    const previousClose =
      row.previousClose === null ? null : Number(row.previousClose);
    const close = row.close === null ? null : Number(row.close);
    const board = classifyBoard(row.symbol);
    const st = isStStock(row.stockName) ? "ST" : "NORMAL";
    const ratio =
      board === "main"
        ? st === "ST"
          ? 0.05
          : 0.1
        : board === "chinext" || board === "star"
          ? 0.2
          : board === "bse"
            ? 0.3
            : null;
    return {
      symbol: row.symbol,
      stockName: row.stockName,
      tradeDate: row.tradeDate,
      previousClose,
      close,
      limitUpPrice:
        ratio !== null && previousClose !== null
          ? Math.round(previousClose * (1 + ratio) * 100) / 100
          : null,
    };
  });
  summarize(`Legacy limit_up_records latest ${latestDate}`, auditRows);
}

process.exit(0);
