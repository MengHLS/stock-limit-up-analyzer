/**
 * 连板「高度」口径对拍探针（**只读**，不清库、不写库）。
 *
 * 背景：首页连板梯队改版后，断板股的「高度」比参考工具（附件图）少 1。
 * 两种可能必须先分开，才能决定改哪里：
 *   (A) 口径差异：参考工具把断板股放在「昨日连板数 + 1」那一行（= 若今日涨停能达到的高度）；
 *   (B) 数据/算法差异：本页算出的板数本身就偏低（例如窗口内缺某天记录把连板链截断）。
 *
 * 本探针做三件事：
 *   1. 打印 `limit_up_records` 的实际列名（确认 vendor 的 `boardCount` 列是否存在）；
 *   2. 打印最近 25 个记录交易日的**每日记录条数 / 去重股票数**（看数据完整性与断档）；
 *   3. 用与 `server/boardRoster.ts` **同一算法**重算每只股票在每个记录日的连板数，
 *      与库内 vendor 的 `boardCount` 逐行对拍 —— 若两者一致 ⇒ 排除 (B)，是纯口径问题。
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const db = await getDb();
if (!db) {
  console.error("未配置 DATABASE_URL");
  process.exit(1);
}
const take = <T,>(result: unknown): T[] => ((result as unknown as [T[]])[0] ?? []);

const DATE = "2026-09-18";
const WINDOW_START = "2026-07-19";

// ---------- 1. 列名 ----------
const columns = take<{ Field: string; Type: string }>(
  await db.execute(sql`show columns from limit_up_records`),
);

// ---------- 2. 每日条数 ----------
const daily = take<{ d: string; c: number }>(
  await db.execute(sql`
    select limitUpDate as d, count(*) as c
    from limit_up_records
    group by limitUpDate
    order by limitUpDate desc
    limit 25`),
);

// ---------- 3. 取窗口内全量记录，重算连板数 ----------
const raw = take<{ stockCode: string; stockName: string; limitUpDate: string; limitUpTime: string | null }>(
  await db.execute(sql`
    select stockCode, stockName, limitUpDate, limitUpTime
    from limit_up_records
    where limitUpDate >= ${WINDOW_START} and limitUpDate <= ${DATE}
    order by limitUpDate desc, stockCode`),
);

const tradingDates = Array.from(new Set(raw.map((r) => r.limitUpDate))).sort((a, b) => b.localeCompare(a));
const dateIndex = new Map(tradingDates.map((d, i) => [d, i]));
const stockDates = new Map<string, Set<string>>();
for (const r of raw) {
  const set = stockDates.get(r.stockCode) ?? new Set<string>();
  set.add(r.limitUpDate);
  stockDates.set(r.stockCode, set);
}
/** 与 boardRoster.ts#boardsAt 完全同构：从目标日往前数「连续记录交易日」。 */
function boardsAt(stockCode: string, date: string): number {
  const set = stockDates.get(stockCode);
  const start = dateIndex.get(date);
  if (!set || start === undefined) return 1;
  let n = 1;
  for (let i = start + 1; i < tradingDates.length; i += 1) {
    if (!set.has(tradingDates[i])) break;
    n += 1;
  }
  return n;
}

/** vendor 字段对拍：同一天同一股，vendor boardCount vs 本算法。 */
let vendorColumn = columns.some((c) => c.Field === "boardCount") ? "boardCount" : null;
const vendorRows = vendorColumn
  ? take<{ stockCode: string; stockName: string; limitUpDate: string; boardCount: number | null }>(
      await db.execute(sql`
        select stockCode, stockName, limitUpDate, boardCount
        from limit_up_records
        where limitUpDate >= ${WINDOW_START} and limitUpDate <= ${DATE}`),
    )
  : [];

const mismatches: unknown[] = [];
for (const v of vendorRows) {
  const mine = boardsAt(v.stockCode, v.limitUpDate);
  const vendor = v.boardCount === null ? null : Number(v.boardCount);
  if (vendor !== null && vendor !== mine) {
    mismatches.push({ code: v.stockCode, name: v.stockName, date: v.limitUpDate, vendor, mine, delta: vendor - mine });
  }
}

// ---------- 4. 关注个股的逐日明细 ----------
const WATCH = ["澳弘电子", "中晶科技", "共达电声", "中岩大地", "万向德农", "华瓷股份", "锡华科技", "世联行", "内蒙新华"];
const watchRows = vendorColumn
  ? take<{ stockCode: string; stockName: string; limitUpDate: string; limitUpTime: string | null; boardCount: number | null }>(
      await db.execute(sql`
        select stockCode, stockName, limitUpDate, limitUpTime, boardCount
        from limit_up_records
        where stockName in ('澳弘电子','中晶科技','共达电声','中岩大地','万向德农','华瓷股份','锡华科技','世联行','内蒙新华')
          and limitUpDate >= '2026-08-20'
        order by stockName, limitUpDate`),
    )
  : [];

// ---------- 5. 目标日 / 上一记录日的名录快照 ----------
const targetIdx = dateIndex.get(DATE);
const prevDate = targetIdx === undefined ? null : (tradingDates[targetIdx + 1] ?? null);
const rowsOnDate = new Map<string, { code: string; name: string; time: string | null }>();
for (const r of raw.filter((r) => r.limitUpDate === DATE)) {
  if (!rowsOnDate.has(r.stockCode)) rowsOnDate.set(r.stockCode, { code: r.stockCode, name: r.stockName, time: r.limitUpTime });
}
const broken = raw
  .filter((r) => r.limitUpDate === prevDate && !rowsOnDate.has(r.stockCode))
  .map((r) => {
    const boards = boardsAt(r.stockCode, prevDate as string);
    return { code: r.stockCode, name: r.stockName, boardsPrevDate: boards, heightPlusOne: boards + 1 };
  })
  .sort((a, b) => b.boardsPrevDate - a.boardsPrevDate || a.code.localeCompare(b.code));

const watchDetail = WATCH.map((name) => {
  const rows = watchRows.filter((r) => r.stockName === name);
  return {
    name,
    code: rows[0]?.stockCode ?? null,
    rows: rows.map((r) => ({ date: r.limitUpDate, time: r.limitUpTime, vendor: r.boardCount === null ? null : Number(r.boardCount), mine: boardsAt(r.stockCode, r.limitUpDate) })),
  };
});

console.log(
  JSON.stringify(
    {
      columns: columns.map((c) => `${c.Field}:${c.Type}`),
      vendorColumn,
      tradingDatesInWindow: tradingDates.length,
      daily: daily.map((d) => `${d.d}:${d.c}`),
      prevDate,
      vendorVsMineMismatchCount: mismatches.length,
      vendorVsMineMismatches: mismatches.slice(0, 40),
      watchDetail,
      brokenCount: broken.length,
      brokenByHeight: broken.reduce<Record<string, number>>((acc, b) => {
        acc[String(b.heightPlusOne)] = (acc[String(b.heightPlusOne)] ?? 0) + 1;
        return acc;
      }, {}),
      brokenTop: broken.slice(0, 12),
    },
    null,
    2,
  ),
);
process.exit(0);
