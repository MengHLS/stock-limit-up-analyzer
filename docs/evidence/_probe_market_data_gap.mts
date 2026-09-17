/**
 * 大盘数据（成交额 / 两融余额）覆盖对账（只读）。
 *
 * 回答三个问题：
 *  1. market_data 最近有哪些行（date / turnover / marginBalance / note / createdAt / updatedAt）
 *  2. limit_up_records 最近交易日里，哪些日期在 market_data 中**没有**对应行（图上会画成 0）
 *  3. 涨停记录末端 vs market_data 末端
 *
 * 用法：npx tsx docs/evidence/_probe_market_data_gap.mts
 */
import "dotenv/config";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const take = <T,>(r: unknown): T[] => ((r as unknown as [T[]])[0] ?? []);

const marketRecent = take<Record<string, unknown>>(
  await db.execute(
    sql`select dataDate, turnover, marginBalance, note,
               DATE_FORMAT(createdAt,'%Y-%m-%d %H:%i:%s') as createdAtUtc,
               DATE_FORMAT(updatedAt,'%Y-%m-%d %H:%i:%s') as updatedAtUtc
        from market_data order by dataDate desc limit 40`,
  ),
);

const marketStats = take<Record<string, unknown>>(
  await db.execute(
    sql`select count(*) as rowsTotal, min(dataDate) as minDate, max(dataDate) as maxDate from market_data`,
  ),
);

const luRecent = take<Record<string, unknown>>(
  await db.execute(
    sql`select limitUpDate as d, count(*) as c from limit_up_records
        group by limitUpDate order by limitUpDate desc limit 40`,
  ),
);

// 涨停记录日 vs market_data 日 的差集（近 40 个涨停日）
const marketDates = new Set(marketRecent.map((r) => String(r["dataDate"])));
const missingOnLimitUpDays = luRecent
  .map((r) => String(r["d"]))
  .filter((d) => !marketDates.has(d));

// 反向：market_data 里有、涨停记录里没有的日子（非交易日 / 空仓日）
const luDates = new Set(luRecent.map((r) => String(r["d"])));
const marketOnlyDates = [...marketDates].filter((d) => !luDates.has(d));

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      beijingNow: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date()),
      marketStats: marketStats[0] ?? null,
      marketRecent,
      limitUpDatesRecent: luRecent,
      limitUpDaysMissingMarketData: missingOnLimitUpDays,
      marketDataDatesWithoutLimitUp: marketOnlyDates,
    },
    null,
    2,
  ),
);
process.exit(0);
