/**
 * 诊断探针：「历史候选池回测」为何不随时间更新。
 * 只读。输出落 stdout（调用方重定向到日志）。
 *
 * 判据链：
 *  ① limit_up_records 最新日（信号来源）
 *  ② index_daily 最新日（回测观察日 T+N 的**唯一来源**，loadBacktestTradingDates）
 *  ③ stock_daily_prices 最新日（溢价 / 成交价来源）
 *  ④ 快照里 historicalRows 的最新 date（= 页面当前看到的最新样本日）
 *  ⑤ 最近若干交易日「被排除出样本」的原因归类
 */
import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const lines: string[] = [];
const log = (s = "") => lines.push(s);

/** 统计「日历末端 −1/+0」范围内、因缺 T+N 而进不了样本的涨停日个数（obs=1 视角）。 */
function obsNote(limitUpDates: string[], calDates: string[]): number {
  const lastCal = calDates[calDates.length - 1];
  return limitUpDates.filter((d) => !calDates.includes(d) || d === lastCal).length;
}

function fmt(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "(空)";
  const cols = Object.keys(rows[0]);
  const head = cols.join(" | ");
  const body = rows.map((r) => cols.map((c) => String(r[c] ?? "NULL")).join(" | ")).join("\n");
  return `${head}\n${body}`;
}

async function main() {
  log("=== A. 快照（页面当前看到的东西） ===");
  const dir = resolve(process.cwd(), ".cache", "leader-candidate-backtest");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const p = resolve(dir, f);
    const raw = JSON.parse(await readFile(p, "utf8")) as {
      version: number;
      createdAt?: string;
      payload?: {
        totalSamples?: number;
        historicalRows?: Array<{ date: string; nextDate?: string | null; signalClosePrice?: unknown; nextClosePrice?: unknown }>;
        calibrationPeriod?: { startDate?: string; endDate?: string };
        outOfSample?: { sampleSize?: number };
      };
    };
    const rows = raw.payload?.historicalRows ?? [];
    const dates = Array.from(new Set(rows.map((r) => r.date))).sort();
    const byDate = new Map<string, { total: number; noPrev: number; noNext: number; noPrice: number }>();
    for (const r of rows) {
      const b = byDate.get(r.date) ?? { total: 0, noPrev: 0, noNext: 0, noPrice: 0 };
      b.total += 1;
      if (!r.nextDate) b.noNext += 1;
      if (r.signalClosePrice === null || r.signalClosePrice === undefined) b.noPrev += 1;
      if (r.nextClosePrice === null || r.nextClosePrice === undefined) b.noPrice += 1;
      byDate.set(r.date, b);
    }
    log(`文件: ${f}  version=${raw.version}  createdAt=${raw.createdAt ?? "(无)"}`);
    log(`historicalRows=${rows.length}  totalSamples=${raw.payload?.totalSamples}`);
    log(`最新样本日(max date)=${dates[dates.length - 1] ?? "-"}  最早=${dates[0] ?? "-"}  覆盖交易日数=${dates.length}`);
    log(`校准区间=${raw.payload?.calibrationPeriod?.startDate} ~ ${raw.payload?.calibrationPeriod?.endDate}`);
    log("最近 12 个样本日：[日期 | 候选数 | 无T+N | 无信号收盘 | 无T+1收盘]");
    for (const d of dates.slice(-12)) {
      const b = byDate.get(d)!;
      log(`  ${d} | ${b.total} | ${b.noNext} | ${b.noPrev} | ${b.noPrice}`);
    }
  }

  log("");
  log("=== B. 真库三个时间轴末端 ===");
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    dateStrings: true,
  });

  const q = async (label: string, sql: string) => {
    const [rows] = await conn.query(sql);
    log(`-- ${label}`);
    log(fmt(rows as Array<Record<string, unknown>>));
  };

  await q(
    "① limit_up_records 末端 + 最近 15 个交易日",
    `SELECT DATE_FORMAT(limitUpDate,'%Y-%m-%d') AS d, COUNT(*) AS n
     FROM limit_up_records GROUP BY d ORDER BY d DESC LIMIT 15`,
  );
  await q(
    "② index_daily 末端",
    `SELECT DATE_FORMAT(MAX(tradeDate),'%Y-%m-%d') AS maxDate, COUNT(DISTINCT tradeDate) AS days FROM index_daily`,
  );
  await q(
    "③ stock_daily_prices 末端",
    `SELECT DATE_FORMAT(MAX(tradeDate),'%Y-%m-%d') AS maxDate FROM stock_daily_prices`,
  );
  await q(
    "④ 最近 15 个 index_daily 交易日",
    `SELECT DATE_FORMAT(tradeDate,'%Y-%m-%d') AS d FROM index_daily GROUP BY d ORDER BY d DESC LIMIT 15`,
  );
  await q(
    "⑤ 最近 15 个 stock_daily_prices 交易日（每日覆盖只数）",
    `SELECT DATE_FORMAT(tradeDate,'%Y-%m-%d') AS d, COUNT(DISTINCT stockCode) AS n
     FROM stock_daily_prices GROUP BY d ORDER BY d DESC LIMIT 15`,
  );
  await q(
    "⑥ 涨停日是否落在 index_daily 日历内（最近 15 个涨停日）",
    `SELECT DATE_FORMAT(r.d,'%Y-%m-%d') AS limitUpDate,
            (SELECT COUNT(*) FROM index_daily i WHERE i.tradeDate = r.d) AS inCalendar
     FROM (SELECT DISTINCT limitUpDate AS d FROM limit_up_records ORDER BY d DESC LIMIT 15) r
     ORDER BY r.d DESC`,
  );

  log("");
  log("=== C. 写入时间（库内为 UTC，+8 = 北京时） ===");
  await q(
    "① limit_up_records 按涨停日的写入时间（最近 10 个交易日）",
    `SELECT DATE_FORMAT(limitUpDate,'%Y-%m-%d') AS d, COUNT(*) AS n,
            DATE_FORMAT(MIN(createdAt),'%Y-%m-%d %H:%i:%s') AS minCreated,
            DATE_FORMAT(MAX(createdAt),'%Y-%m-%d %H:%i:%s') AS maxCreated
     FROM limit_up_records GROUP BY d ORDER BY d DESC LIMIT 10`,
  );
  await q(
    "② index_daily 末端若干交易日的写入时间",
    `SELECT DATE_FORMAT(tradeDate,'%Y-%m-%d') AS d, COUNT(*) AS n,
            DATE_FORMAT(MAX(retrievedAt),'%Y-%m-%d %H:%i:%s') AS maxRetrieved
     FROM index_daily GROUP BY d ORDER BY d DESC LIMIT 8`,
  );
  await q(
    "③ stock_daily_prices 末端若干交易日的写入时间",
    `SELECT DATE_FORMAT(tradeDate,'%Y-%m-%d') AS d, COUNT(DISTINCT stockCode) AS n,
            DATE_FORMAT(MAX(sourceUpdatedAt),'%Y-%m-%d %H:%i:%s') AS maxSourceUpdated,
            DATE_FORMAT(MAX(updatedAt),'%Y-%m-%d %H:%i:%s') AS maxUpdated
     FROM stock_daily_prices GROUP BY d ORDER BY d DESC LIMIT 8`,
  );

  log("");
  log("=== D. 离线复算「哪些涨停日能进样本」（复刻 buildLeaderCandidateBacktest 的排除规则） ===");
  const [luRows] = await conn.query(
    `SELECT DISTINCT DATE_FORMAT(limitUpDate,'%Y-%m-%d') AS d FROM limit_up_records ORDER BY d`,
  );
  const [calRows] = await conn.query(
    `SELECT DISTINCT DATE_FORMAT(tradeDate,'%Y-%m-%d') AS d FROM index_daily ORDER BY d`,
  );
  const limitUpDates = (luRows as Array<{ d: string }>).map((r) => r.d);
  const calDates = (calRows as Array<{ d: string }>).map((r) => r.d);
  const calIndex = new Map(calDates.map((d, i) => [d, i]));
  for (const obs of [1, 2] as const) {
    const usable = limitUpDates.filter((d) => {
      const mi = calIndex.get(d);
      const next = mi === undefined ? undefined : calDates[mi + obs];
      return Boolean(next);
    });
    log(`observationDays=${obs}: 可用样本交易日 ${usable.length} 个，最新 = ${usable[usable.length - 1] ?? "-"}`);
    log(`  最近 6 个可用日: ${usable.slice(-6).join(", ")}`);
  }
  const lastCal = calDates[calDates.length - 1];
  const lastLu = limitUpDates[limitUpDates.length - 1];
  log(`日历末端(index_daily)=${lastCal}  涨停记录末端=${lastLu}`);
  log(`→ 理论上「日历末端」之后 + 末端自身共 ${obsNote(limitUpDates, calDates)} 个涨停日无法进样本（需 T+N 已存在）。`);

  await conn.end();
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(0);
}

main().catch((err) => {
  const chain: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i += 1) {
    const e = cur as { constructor?: { name?: string }; message?: string; code?: string; sqlMessage?: string; cause?: unknown };
    chain.push(`[${i}] ${e.constructor?.name ?? "?"} code=${e.code ?? "-"} msg=${e.message ?? "-"} sql=${e.sqlMessage ?? "-"}`);
    cur = e.cause;
  }
  process.stdout.write(`${lines.join("\n")}\n!!! FAILED\n${chain.join("\n")}\n`);
  process.exit(1);
});
