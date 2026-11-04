/**
 * 量化 `ds_*`(390002) 内部的一处**真实数据矛盾**（2026-09-14 由直读桥投影严检抓出）：
 * 同一 `(symbol, tradeDate)` 的「前收」在不同来源下不一致 ——
 *   · rd=0 行：`event.previousClose`（事件表）；
 *   · rd≥1 行：同事件 `rd-1` 行的 `close`（原始行情链）。
 * 样例（`601236.SH` / 2024-10-11）：event.previousClose=8.33（且 limitUpPrice=9.16=8.33×1.1 自洽），
 * 而原始行情链给出前一交易日收盘 8.38（9.16/8.38 = +9.31%，与「涨停」不符）。
 *
 * 本探针只统计规模，不改数据。只读。
 * 用法（项目根目录）：npx tsx docs/evidence/_probe_preclose_source_mismatch.mts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const V = 390002;
const url = process.env.DATABASE_URL!;
const u = new URL(url);
const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];
const c = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port || 4000),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ""),
  ssl: sslRaw ? JSON.parse(sslRaw) : undefined,
  compress: true,
  connectTimeout: 20_000,
});

const CANDIDATES = `
  select e.symbol as symbol, p.tradeDate as tradeDate, e.previousClose as preClose
    from ds_first_limit_pullback_prefix p
    join ds_first_limit_pullback_event e
      on e.datasetVersionId = p.datasetVersionId and e.eventId = p.eventId
   where p.datasetVersionId = ${V} and p.relativeDay = 0
  union all
  select po.symbol, po.tradeDate, pv.close
    from ds_first_limit_pullback_post po
    join ds_first_limit_pullback_prefix pv
      on pv.datasetVersionId = po.datasetVersionId and pv.eventId = po.eventId and pv.relativeDay = 0
   where po.datasetVersionId = ${V} and po.relativeDay = 1
  union all
  select po.symbol, po.tradeDate, pv.close
    from ds_first_limit_pullback_post po
    join ds_first_limit_pullback_post pv
      on pv.datasetVersionId = po.datasetVersionId and pv.eventId = po.eventId and pv.relativeDay = po.relativeDay - 1
   where po.datasetVersionId = ${V} and po.relativeDay between 2 and 4
`;

async function q(label: string, sql: string): Promise<any[]> {
  const t = Date.now();
  const [rows] = await c.query<any[]>(sql);
  console.log(`\n[${label}] ${Date.now() - t}ms`);
  return rows as any[];
}

const total = await q("A. rd∈[0,4] 投影的总 (symbol, tradeDate) 键数", `
  select count(*) as n from (
    select symbol, tradeDate from ds_first_limit_pullback_prefix
      where datasetVersionId = ${V} and relativeDay = 0
    union
    select symbol, tradeDate from ds_first_limit_pullback_post
      where datasetVersionId = ${V} and relativeDay between 1 and 4
  ) z`);
console.log(`   总键数 = ${total[0].n}`);

const mismatch = await q("B. preClose 取值不一致的键数", `
  select count(*) as n from (
    select symbol, tradeDate from (${CANDIDATES}) x
     group by symbol, tradeDate having count(distinct preClose) > 1
  ) y`);
console.log(`   preClose 冲突键数 = ${mismatch[0].n}（占 ${((mismatch[0].n / total[0].n) * 100).toFixed(4)}%）`);

const samples = await q("C. 冲突样例（前 10）", `
  select symbol, tradeDate, group_concat(distinct preClose order by preClose) as closes, count(*) as rowsInvolved
    from (${CANDIDATES}) x
   group by symbol, tradeDate having count(distinct preClose) > 1
   order by symbol, tradeDate limit 10`);
for (const r of samples) {
  console.log(`   ${r.symbol} ${String(r.tradeDate).slice(0, 10)}  closes=[${r.closes}]  rows=${r.rowsInvolved}`);
}

await c.end();
process.exit(0);
