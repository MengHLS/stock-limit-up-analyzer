/**
 * 直读桥「不可撮合」根因核实（2026-09-14）。
 *
 * 用户命题：「策略运行的时候是需要从数据集中取数据啊」。
 * 现状：`datasetFromRegistry.ts` 只把 `prefix(rd=0)` 投影进 rows ⇒ `executionBarsAvailable=false`
 * ⇒ `assemble.ts#resolveDataset` 回落 `buildResearchDataset` 从 `stock_daily_prices` 重建。
 *
 * 本探针只回答一个问题：**数据集里到底有没有撮合所需的行情？**
 * 若 `ds_*_post`（rd≥1）确实带 OHLCV，则「不可撮合」是**投影口径**造成的，不是数据缺失。
 *
 * 断言项：
 *   A. prefix / post 的 relativeDay 取值范围与行数
 *   B. post 逐 relativeDay 覆盖行数（判断「观察窗口 + 执行日」是否落在 post 内）
 *   C. 每个事件是否有 post 行、最少几天
 *   D. 若按 rd ∈ [0, +maxPost] 投影为逐日面板，是否会产生 (symbol, tradeDate) 重复；
 *      若有，重复对的 OHLCV 是否一致（决定能否无损去重）
 *
 * 只读。用法（项目根目录）：npx tsx docs/evidence/_probe_dataset_window_coverage.mts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const VERSION_ID = 390002;

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

async function q<T = any>(label: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const t = Date.now();
  const [rows] = await c.query<any[]>(sql, params as any[]);
  console.log(`\n[${label}] ${Date.now() - t}ms  rows=${rows.length}`);
  return rows as T[];
}

const out: Record<string, unknown> = { versionId: VERSION_ID };

// ---- A. prefix / post 的 relativeDay 边界 ----
const bounds = await q(
  "A rd 边界",
  `select 'prefix' as tbl, min(relativeDay) as minRd, max(relativeDay) as maxRd, count(*) as n,
          count(distinct symbol) as symbols, count(distinct tradeDate) as dates,
          sum(open is null) as openNull, sum(close is null) as closeNull
     from ds_first_limit_pullback_prefix where datasetVersionId=?
   union all
   select 'post', min(relativeDay), max(relativeDay), count(*),
          count(distinct symbol), count(distinct tradeDate),
          sum(open is null), sum(close is null)
     from ds_first_limit_pullback_post where datasetVersionId=?`,
  [VERSION_ID, VERSION_ID],
);
for (const r of bounds) {
  console.log(
    `   ${r.tbl}: rd ∈ [${r.minRd}, ${r.maxRd}]  rows=${r.n}  symbols=${r.symbols}  dates=${r.dates}` +
      `  openNull=${r.openNull}  closeNull=${r.closeNull}`,
  );
}
out.bounds = bounds;

// ---- B. post 逐 relativeDay 覆盖 ----
const byDay = await q(
  "B post 逐 rd 覆盖",
  `select relativeDay, count(*) as n, count(distinct eventId) as events,
          sum(close is null) as closeNull
     from ds_first_limit_pullback_post where datasetVersionId=?
     group by relativeDay order by relativeDay`,
  [VERSION_ID],
);
for (const r of byDay) {
  console.log(`   rd=+${r.relativeDay}: rows=${r.n}  events=${r.events}  closeNull=${r.closeNull}`);
}
out.postByRelativeDay = byDay;

// ---- C. 每个事件的 post 天数分布 ----
const perEvent = await q(
  "C 每事件 post 天数分布",
  `select postDays, count(*) as events from (
      select eventId, count(*) as postDays
        from ds_first_limit_pullback_post where datasetVersionId=?
        group by eventId
    ) t group by postDays order by postDays`,
  [VERSION_ID],
);
for (const r of perEvent) console.log(`   ${r.postDays} 天: ${r.events} 个事件`);
const evTotal = await q("C2 事件总数", `select count(*) as n from ds_first_limit_pullback_event where datasetVersionId=?`, [
  VERSION_ID,
]);
console.log(`   事件总数 = ${(evTotal[0] as any).n}`);
out.perEventPostDays = perEvent;
out.eventTotal = (evTotal[0] as any).n;

// ---- D. rd ∈ [0, +maxPost] 投影的重复性 ----
// 口径：rows 的 (tradeDate, symbol) 必须唯一。prefix rd=0 与 post rd>=1 合并后，
// 同一 symbol 的多个事件窗口可能在同一交易日产生两行。
const maxPost = Math.max(...byDay.map((r: any) => Number(r.relativeDay)));
const dup = await q(
  "D 合并投影重复对",
  `select count(*) as dupPairs, sum(absDiff) as absDiffSum from (
      select symbol, tradeDate, count(*) as c,
             (max(close) - min(close)) as absDiff
        from (
          select symbol, tradeDate, close, open, high, low, volume, amount
            from ds_first_limit_pullback_prefix where datasetVersionId=? and relativeDay=0
          union all
          select symbol, tradeDate, close, open, high, low, volume, amount
            from ds_first_limit_pullback_post where datasetVersionId=? and relativeDay<=?
        ) x
        group by symbol, tradeDate
        having count(*) > 1
    ) y`,
  [VERSION_ID, VERSION_ID, maxPost],
);
console.log(`\n[D] rd∈[0,+${maxPost}] 合并后 (symbol, tradeDate) 重复组 = ${(dup[0] as any).dupPairs}`);
console.log(`   其中 close 极差合计 = ${(dup[0] as any).absDiffSum}（0 ⇒ 完全一致，可无损去重）`);
out.dupPairs = (dup[0] as any).dupPairs;
out.dupAbsDiffSum = (dup[0] as any).absDiffSum;

// 合并后的面板规模
const panel = await q(
  "D2 合并面板规模",
  `select count(*) as panelRows,
          count(distinct symbol) as symbols,
          count(distinct tradeDate) as dates
     from (
       select symbol, tradeDate from ds_first_limit_pullback_prefix
         where datasetVersionId=? and relativeDay=0
       union
       select symbol, tradeDate from ds_first_limit_pullback_post
         where datasetVersionId=? and relativeDay<=?
     ) z`,
  [VERSION_ID, VERSION_ID, maxPost],
);
console.log(
  `   去重面板 = ${(panel[0] as any).panelRows} 行 / ${(panel[0] as any).symbols} 证券 / ${(panel[0] as any).dates} 交易日`,
);
out.panel = panel[0];

// ---- E. 具体样本：某事件 rd=0..+6 的行情是否齐 ----
const pick = await q(
  "E0 挑一个 post 充足的事件",
  `select eventId, symbol from ds_first_limit_pullback_post
     where datasetVersionId=? group by eventId, symbol having count(*) >= 6
     order by eventId limit 1`,
  [VERSION_ID],
);
const sampleEventId = (pick[0] as any)?.eventId ?? null;
out.sampleEventId = sampleEventId;
out.sampleSymbol = (pick[0] as any)?.symbol ?? null;

const sample = await q(
  "E 单事件 rd=0..6 行情",
  `select relativeDay, tradeDate, open, high, low, close, volume, amount
     from ds_first_limit_pullback_prefix
     where datasetVersionId=? and eventId=? and relativeDay=0
   union all
   select relativeDay, tradeDate, open, high, low, close, volume, amount
     from ds_first_limit_pullback_post
     where datasetVersionId=? and eventId=? and relativeDay between 1 and 6
   order by tradeDate`,
  [VERSION_ID, sampleEventId, VERSION_ID, sampleEventId],
);
for (const r of sample) {
  console.log(
    `   rd=${r.relativeDay >= 0 ? "+" : ""}${r.relativeDay}  ${String(r.tradeDate).slice(0, 10)}  O=${r.open} H=${r.high} L=${r.low} C=${r.close} V=${r.volume}`,
  );
}
out.sampleSeries = sample;

console.log("\nsummary=" + JSON.stringify(out));
await c.end();
process.exit(0);
