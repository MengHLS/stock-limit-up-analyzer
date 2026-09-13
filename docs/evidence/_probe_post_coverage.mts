/**
 * 回答「T+N 窗口撮合是否需要重新设计数据集表」。
 *
 * 背景：`server/runWorkbenchAssembly/datasetFromRegistry.ts` 只把 `prefix` 的 rd=0 行投影进
 * `ResearchDataset.rows`，`post`（rd≥1）不并入，因此标 `POST_WINDOW_NOT_PROJECTED`。
 *
 * 用户追问：「那这个是不是需要重新设计数据集表」。
 *
 * 本探针只读，回答三个事实问题：
 *   A. `prefix` / `post` 各自的 relativeDay 区间与行数、每事件覆盖的窗口长度；
 *   B. `post` 是否「每个事件都覆盖满窗口」；以及 (tradeDate, symbol) 上是否唯一
 *     （决定直读能否支撑 T+N 撮合、以及「补进 rows」在结构上是否可能）；
 *   C. `outcome` 的 horizon 取值集合（决定「研究标签」口径与撮合窗口是否一致）。
 *
 * 🔴 关键区分：模拟器读的是 `(tradeDate, securityId)` 日前切片
 *   （`server/research/simulator/engine.ts:437-441` 的 `dateRowRange` → `dayBars`），
 *   即「某交易日该证券的一根 bar」。`post` 的行是 `(eventId, relativeDay)` ⇒
 *   同一天可能有多行（多个事件各自的 T+k），**不一定满足 (tradeDate, securityId) 唯一**。
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL!;
const u = new URL(url);
const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];
const c = await mysql.createConnection({
  host: u.hostname, port: Number(u.port || 4000),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl: sslRaw ? JSON.parse(sslRaw) : undefined,
  compress: true, connectTimeout: 20_000,
});

const V = 390002;

async function q(label: string, sql: string, params: any[] = []): Promise<any[]> {
  const t = Date.now();
  const [rows] = await c.query<any[]>(sql, params);
  console.log(`\n[${label}] ${Date.now() - t}ms  rows=${rows.length}`);
  for (const r of rows) console.log('   ' + JSON.stringify(r));
  return rows as any[];
}

console.log(`=== 数据集版本 ${V} 的窗口形态 ===`);

// ---- A. prefix / post 窗口区间与行数 ----
await q('A1 prefix 窗口', `
  select min(relativeDay) mn, max(relativeDay) mx, count(*) c,
         count(distinct relativeDay) days,
         count(distinct eventId) events
  from ds_first_limit_pullback_prefix where datasetVersionId = ?`, [V]);

await q('A2 post 窗口', `
  select min(relativeDay) mn, max(relativeDay) mx, count(*) c,
         count(distinct relativeDay) days,
         count(distinct eventId) events
  from ds_first_limit_pullback_post where datasetVersionId = ?`, [V]);

// ---- B. post 每事件行数分布 + (tradeDate,symbol) 唯一性 ----
await q('B1 post 每事件行数分布', `
  select cnt, count(*) as events
  from (select eventId, count(*) cnt from ds_first_limit_pullback_post
        where datasetVersionId = ? group by eventId) t
  group by cnt order by cnt`, [V]);

await q('B2 post 在 (tradeDate,symbol) 上是否多行', `
  select max(n) maxRowsPerSymbolDay, sum(n > 1) collisions, count(*) symbolDays
  from (select tradeDate, symbol, count(*) n from ds_first_limit_pullback_post
        where datasetVersionId = ? group by tradeDate, symbol) t`, [V]);

await q('B3 prefix rd=0 在 (tradeDate,symbol) 上是否唯一', `
  select max(n) maxRowsPerSymbolDay, sum(n > 1) collisions, count(*) symbolDays
  from (select tradeDate, symbol, count(*) n from ds_first_limit_pullback_prefix
        where datasetVersionId = ? and relativeDay = 0 group by tradeDate, symbol) t`, [V]);

// ---- C. outcome horizon ----
await q('C1 outcome horizon 取值', `
  select horizon, count(*) c from ds_first_limit_pullback_outcome
  where datasetVersionId = ? group by horizon order by horizon`, [V]);

// ---- D. 事件覆盖的交易日跨度 ----
await q('D1 event 覆盖', `
  select count(*) events, count(distinct tradeDate) dates,
         min(tradeDate) firstDate, max(tradeDate) lastDate
  from ds_first_limit_pullback_event where datasetVersionId = ?`, [V]);

console.log('\n=== 完成（只读） ===');
await c.end();
process.exit(0);
