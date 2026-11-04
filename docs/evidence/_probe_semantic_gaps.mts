/**
 * _probe_semantic_gaps.mts —— 只读探针
 *
 * 目的：定义虽通过结构校验（valid=true），但 3 处语义偏差需要实查数据可行性：
 *   G1. 「回调期最低价 ≥ 首板日最低价」= 窗口内**累积**约束（min over T+1..T+k），
 *       而单条条件只能写 `bar.low >= prefix.rd0.low`（当前那一天）
 *   G2. 「首板日量 ≥ 前5日均量×1.5」= 需要 rd=-5..-1 的**均值**，单一字段引用表达不了
 *   G3. 「反包前一日实体」= 窗口内**相对**引用（T+k-1），框架无此能力
 *
 * 实查：用真实 ds_* 数据量化「逐日条件」与「累积条件」的样本差有多大
 *       —— 差距越小，用逐日近似越可接受。
 */
import mysql2 from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();
const url = process.env.DATABASE_URL!;
const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/)!;
const conn = await mysql2.createConnection({
  host: m[3],
  port: Number(m[4]),
  user: m[1],
  password: decodeURIComponent(m[2]),
  database: m[5],
  ssl: { rejectUnauthorized: false },
});

console.log("=== G1. 「不破首板日最低」：逐日 vs 累积 的样本差 ===");
// 逐日版：观察窗内第 k 日 low >= 首板日 low（当天检查）
// 累积版：观察窗 [1..k] 内 min(low) >= 首板日 low（历史未破）
const [g1] = await conn.query<any[]>(
  `select
     p.relativeDay as k,
     count(*) as eventsWithBar,
     sum(case when p.low >= e0.low then 1 else 0 end) as dayLevelPass,
     sum(case when acc.minLow >= e0.low then 1 else 0 end) as cumLevelPass
   from ds_first_limit_pullback_post p
   join ds_first_limit_pullback_event ev
     on ev.datasetVersionId = p.datasetVersionId and ev.eventId = p.eventId
   join ds_first_limit_pullback_prefix e0
     on e0.datasetVersionId = p.datasetVersionId and e0.eventId = p.eventId and e0.relativeDay = 0
   join (
     select datasetVersionId, eventId, relativeDay, min(low) over (
       partition by datasetVersionId, eventId order by relativeDay
       rows between unbounded preceding and current row
     ) as minLow
     from ds_first_limit_pullback_post
     where datasetVersionId = 390002 and relativeDay between 1 and 5
   ) acc
     on acc.datasetVersionId = p.datasetVersionId and acc.eventId = p.eventId and acc.relativeDay = p.relativeDay
  where p.datasetVersionId = 390002 and p.relativeDay between 1 and 5
  group by p.relativeDay
  order by p.relativeDay`,
);
for (const r of g1) {
  const day = Number(r.dayLevelPass);
  const cum = Number(r.cumLevelPass);
  const tot = Number(r.eventsWithBar);
  console.log(
    `  k=T+${r.k}  样本=${tot}  逐日通过=${day}(${((day / tot) * 100).toFixed(1)}%)  累积通过=${cum}(${((cum / tot) * 100).toFixed(1)}%)  差=${day - cum}`,
  );
}

console.log("\n=== G2. 「首板日量 ≥ 前5日均量×1.5」可用性 ===");
const [g2] = await conn.query<any[]>(
  `select
     count(*) as totalWithPrefix5,
     sum(case when v5.n = 5 then 1 else 0 end) as hasFull5Day
   from ds_first_limit_pullback_event ev
   left join (
     select datasetVersionId, eventId, count(*) as n
     from ds_first_limit_pullback_prefix
     where datasetVersionId = 390002 and relativeDay between -5 and -1
     group by datasetVersionId, eventId
   ) v5 on v5.datasetVersionId = ev.datasetVersionId and v5.eventId = ev.eventId
   where ev.datasetVersionId = 390002`,
);
console.log(`  事件总数=${g2[0].totalWithPrefix5}  其中前5日完整=${g2[0].hasFull5Day}`);

console.log("\n=== G3. 一字板占比（影响「实体涨停」条件的样本量） ===");
const [g3] = await conn.query<any[]>(
  `select
     count(*) as total,
     sum(case when close = high then 1 else 0 end) as closeEqHigh,
     sum(case when open = high and high = low then 1 else 0 end) as oneWord
   from ds_first_limit_pullback_prefix
   where datasetVersionId = 390002 and relativeDay = 0`,
);
console.log(
  `  rd=0 行数=${g3[0].total}  close=high（实体涨停）=${g3[0].closeEqHigh}  一字板=${g3[0].oneWord}`,
);

console.log("\n=== G4. event 表是否已有 marketCap / industryCode（误区条目要用） ===");
const [g4] = await conn.query<any[]>(
  `select
     count(*) as total,
     sum(case when marketCap is null then 1 else 0 end) as mcapNull,
     sum(case when floatMarketCap is null then 1 else 0 end) as fmcapNull,
     sum(case when industryCode is null or industryCode = '' then 1 else 0 end) as indNull
   from ds_first_limit_pullback_event where datasetVersionId = 390002`,
);
console.log(
  `  事件=${g4[0].total}  marketCap NULL=${g4[0].mcapNull}  floatMarketCap NULL=${g4[0].fmcapNull}  industryCode 空=${g4[0].indNull}`,
);

await conn.end();
