/**
 * 首页（HOMEPAGE）改造前的数据源对账探针（**只读**）。
 *
 * 事项 `rKRNzQ`「大盘日线走势图」5 条要求落地前，先确认数据层到底有什么：
 *  1. `index_daily` 里实际存在哪些指数代码、各自覆盖区间与最新交易日（需求1「展示数据库中四条指数」）；
 *  2. `limit_up_records` 最近记录交易日与家数（连板梯队分组版式的基础）；
 *  3. `limit_up_records.keywords` 是否含「一字板」等标记（附件图片里的一字板标签）；
 *  4. `stock_daily_prices` 在最近记录交易日的覆盖率（断板股要显示当日涨跌幅）；
 *  5. `market_data` 覆盖（成交额 / 两融余额）。
 *
 * 用法：npx tsx docs/evidence/_probe_homepage_data_sources.mts
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

const out: Record<string, unknown> = {};

out.indexDailyByCode = take(
  await db.execute(
    sql`select indexCode, count(*) as rowsCnt, min(tradeDate) as minDate, max(tradeDate) as maxDate,
               sum(case when close is null then 1 else 0 end) as nullClose
        from index_daily group by indexCode order by rowsCnt desc`,
  ),
);

out.indexMaster = take(await db.execute(sql`select indexCode, indexName, provider, firstDate, lastDate from index_master order by indexCode`));

out.limitUpRecent20 = take(
  await db.execute(
    sql`select limitUpDate as d, count(*) as c, count(distinct stockCode) as stocks
        from limit_up_records group by limitUpDate order by limitUpDate desc limit 20`,
  ),
);

out.keywordsSample = take(
  await db.execute(
    sql`select keywords, count(*) as c from limit_up_records
        where limitUpDate >= (select max(limitUpDate) from limit_up_records) - interval 20 day
        group by keywords order by c desc limit 40`,
  ),
);

out.keywordNullStats = take(
  await db.execute(
    sql`select count(*) as total, sum(case when keywords is null or keywords = '' then 1 else 0 end) as emptyKeywords
        from limit_up_records where limitUpDate >= (select max(limitUpDate) from limit_up_records) - interval 20 day`,
  ),
);

out.boardCountSample = take(
  await db.execute(
    sql`select boardCount, count(*) as c from limit_up_records
        where limitUpDate = (select max(limitUpDate) from limit_up_records)
        group by boardCount order by c desc limit 25`,
  ),
);

out.stockDailyPriceCoverage = take(
  await db.execute(
    sql`select tradeDate, count(*) as rowsCnt from stock_daily_prices
        where tradeDate >= (select max(limitUpDate) from limit_up_records) - interval 20 day
        group by tradeDate order by tradeDate desc limit 20`,
  ),
);

out.marketDataRecent = take(
  await db.execute(sql`select dataDate, turnover, marginBalance, note from market_data order by dataDate desc limit 15`),
);

out.marketDataStats = take(
  await db.execute(sql`select count(*) as rowsTotal, min(dataDate) as minDate, max(dataDate) as maxDate from market_data`),
);

// 断板股当日涨跌幅可行性：取最新记录日与上一记录日，检查上一日涨停股在最新日的行情是否齐全
out.brokenQuoteFeasibility = take(
  await db.execute(
    sql`select r.limitUpDate, count(distinct r.stockCode) as limitUpStocks,
               sum(case when p.stockCode is null then 1 else 0 end) as missingQuote
        from limit_up_records r
        left join stock_daily_prices p
          on p.stockCode = r.stockCode
         and p.tradeDate = (select max(tradeDate) from stock_daily_prices)
        where r.limitUpDate = (select max(tradeDate) from stock_daily_prices) - interval 7 day
        group by r.limitUpDate`,
  ),
);

console.log(JSON.stringify(out, null, 2));
process.exit(0);
