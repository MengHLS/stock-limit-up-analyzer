/**
 * 只读探查：index_daily（交易日历的唯一来源）的新鲜度。
 *
 * 背景：`db.ts#loadBacktestTradingDates` 用 `index_daily` 的 distinct tradeDate 作为
 * 前向纸面交易推进的交易日历；日历一旦滞后于 `limit_up_records` / `stock_daily_prices`，
 * 「推进」当天就永远无事可做（静默 no-op）。
 *
 * 用法：npx tsx docs/evidence/_probe_index_daily_freshness.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

function unwrap<T>(res: unknown): T[] {
  if (Array.isArray(res)) return (Array.isArray(res[0]) ? res[0] : res) as T[];
  return [];
}

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }, null, 2));
  process.exit(1);
}

const summary = unwrap<Record<string, unknown>>(
  await db.execute(sql`
    select count(*) as rows_, count(distinct tradeDate) as distinctDates,
           count(distinct indexCode) as distinctCodes,
           min(tradeDate) as minD, max(tradeDate) as maxD,
           max(retrievedAt) as lastRetrievedAt
    from index_daily
  `),
);

const tail = unwrap<Record<string, unknown>>(
  await db.execute(sql`
    select tradeDate, count(*) as codes, max(retrievedAt) as lastRetrievedAt, group_concat(distinct source) as sources
    from index_daily
    where tradeDate >= date_sub((select max(tradeDate) from index_daily), interval 20 day)
    group by tradeDate order by tradeDate desc
  `),
);

const codes = unwrap<Record<string, unknown>>(
  await db.execute(sql`
    select indexCode, source, min(tradeDate) as minD, max(tradeDate) as maxD, count(*) as c
    from index_daily group by indexCode, source order by indexCode, source
  `),
);

const calendars = unwrap<Record<string, unknown>>(
  await db.execute(sql`
    select 'index_daily' as src, max(tradeDate) as maxD, count(distinct tradeDate) as c from index_daily
    union all
    select 'stock_daily_prices', max(tradeDate), count(distinct tradeDate) from stock_daily_prices
    union all
    select 'limit_up_records', max(limitUpDate), count(distinct limitUpDate) from limit_up_records
  `),
);

console.log(JSON.stringify({ summary, calendars, tail, codes }, null, 2));
process.exit(0);
