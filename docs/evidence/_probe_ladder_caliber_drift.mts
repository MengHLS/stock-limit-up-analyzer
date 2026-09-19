/**
 * 连板口径对拍（**只读**）—— 回答「为什么库里算出的高度比附件图片低」。
 *
 * 附件 `QQ20260918-230855.png` 里：澳弘电子 = 6 板（断板）、中晶科技 = 4 板（断板）、
 * 华瓷股份 / 锡华科技 = 4 板（涨停）、世联行 / 内蒙新华 = 3 板（涨停）。
 * 而库里按「连续记录交易日涨停」算出 maxBoards = 4。本探针逐只列出这些股票的
 * `limit_up_records` 明细，判断是「记录缺口」还是「口径差异」。
 *
 * 用法：npx tsx docs/evidence/_probe_ladder_caliber_drift.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

const NAMES = ["澳弘电子", "中晶科技", "华瓷股份", "锡华科技", "世联行", "内蒙新华", "共达电声", "万向德农", "经纬股份"];

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

const take = <T,>(r: unknown): T[] => ((r as unknown as [T[]])[0] ?? []);

const rows = take(
  await db.execute(
    sql`select stockName, stockCode, limitUpDate, limitUpTime, boardCount, sector
        from limit_up_records
        where stockName in (${sql.join(
          NAMES.map((name) => sql`${name}`),
          sql`, `,
        )})
          and limitUpDate >= '2026-08-20'
        order by stockName, limitUpDate`,
  ),
);

// 全库最近 15 个记录交易日（判断连续性的分母）
const dates = take<{ d: string }>(
  await db.execute(sql`select distinct limitUpDate as d from limit_up_records order by limitUpDate desc limit 15`),
).map((row) => row.d);

// 当日 boardCount 原始字段（图片下方的「6板/4板/3板」很可能直接来自这里）
const rawBoardCount = take(
  await db.execute(
    sql`select stockName, boardCount from limit_up_records
        where limitUpDate = '2026-09-17' and stockName in (${sql.join(
          NAMES.map((name) => sql`${name}`),
          sql`, `,
        )}) order by stockName`,
  ),
);

console.log(JSON.stringify({ recentTradingDates: dates, records: rows, boardCountOn0917: rawBoardCount }, null, 2));
process.exit(0);
