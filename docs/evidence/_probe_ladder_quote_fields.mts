/**
 * 连板梯队「附件图片版式」所需字段可行性对账（**只读**）。
 *
 * 附件图片里每格股票需要三样东西：
 *   ① 涨停股 → 首次封板时间（`limit_up_records.limitUpTime`，已有）
 *   ② 断板股 → **当日涨跌幅**（只能来自 `stock_daily_prices` 的 close / preClosePrice）
 *   ③ 一字板标签（图片里 2 板行的「一字板」红标）
 *
 * 本探针对最新记录交易日逐条核对：行情是否齐全、涨跌幅分布、以及
 * 「一字板」判据（open == high == low，即开盘即封死全天未打开）在真库里的命中情况。
 *
 * 用法：npx tsx docs/evidence/_probe_ladder_quote_fields.mts
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

// 最新记录交易日
const latest = take<{ d: string }>(await db.execute(sql`select max(limitUpDate) as d from limit_up_records`))[0]?.d ?? "";
out.latestLimitUpDate = latest;

// ① 行情覆盖：最新记录日涨停股在当日的行情条数
out.quoteCoverageOnLatest = take(
  await db.execute(
    sql`select
          count(distinct r.stockCode) as limitUpStocks,
          count(distinct p.stockCode) as withQuote,
          count(distinct case when p.closePrice is not null and p.preClosePrice is not null then p.stockCode end) as withChangeable
        from limit_up_records r
        left join stock_daily_prices p on p.stockCode = r.stockCode and p.tradeDate = r.limitUpDate
        where r.limitUpDate = ${latest}`,
  ),
);

// ② 断板股场景：上一记录日的涨停股，在「最新记录日」的行情覆盖率（涨跌幅来源）
out.brokenScenarioCoverage = take(
  await db.execute(
    sql`select
          prev.d as prevDate,
          count(distinct r.stockCode) as prevLimitUpStocks,
          count(distinct p.stockCode) as prevStocksWithQuoteOnLatest
        from (select distinct limitUpDate as d from limit_up_records order by limitUpDate desc limit 2 offset 1) prev
        join limit_up_records r on r.limitUpDate = prev.d
        left join stock_daily_prices p on p.stockCode = r.stockCode and p.tradeDate = ${latest}
        group by prev.d`,
  ),
);

// ③ 一字板判据命中：最新记录日涨停股里 open==high==low 的名单
out.oneWordBoardCandidates = take(
  await db.execute(
    sql`select r.stockCode, r.stockName, p.openPrice, p.highPrice, p.lowPrice, p.closePrice, p.preClosePrice,
               round((cast(p.closePrice as double) - cast(p.preClosePrice as double)) / cast(p.preClosePrice as double) * 100, 2) as pct
        from limit_up_records r
        join stock_daily_prices p on p.stockCode = r.stockCode and p.tradeDate = r.limitUpDate
        where r.limitUpDate = ${latest}
          and p.openPrice = p.highPrice and p.highPrice = p.lowPrice
        order by r.stockCode`,
  ),
);

// ④ 涨停股当日涨跌幅分布（供参考：涨停股应为 ~+10%/20%）
out.latestPctDistribution = take(
  await db.execute(
    sql`select round((cast(p.closePrice as double) - cast(p.preClosePrice as double)) / cast(p.preClosePrice as double) * 100, 1) as pct,
               count(*) as c
        from limit_up_records r
        join stock_daily_prices p on p.stockCode = r.stockCode and p.tradeDate = r.limitUpDate
        where r.limitUpDate = ${latest}
        group by pct order by c desc limit 15`,
  ),
);

console.log(JSON.stringify(out, null, 2));
process.exit(0);
