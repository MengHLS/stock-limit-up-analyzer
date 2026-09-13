/**
 * 诊断：`fetchLiquidityForSymbolsInRange`（datasetRegistry/db.ts:804）为什么单批 7.9s。
 *
 * 报错（用户实测）：
 *   Failed query: select `securityCode`,`tradeDate`,`turnoverRate`,`totalMarketCap`,`circulationMarketCap`
 *   from `liquidity_daily` where (`securityCode` in (...) and `tradeDate` >= ? and `tradeDate` <= ?)
 *   params: ...,2026-05-30,2026-05-30 ; query: 7.969s
 *
 * 要回答：
 *   A. 表有多大、单日有多少行（判断 `securityCode in (400个)` 的单日查询本应多快）；
 *   B. 该表有哪些索引 / 唯一键（`securityCode` 是否唯一列，决定 IN 列表能否走索引）；
 *   C. 单日 400 只的真跑耗时（复现用户路径）；
 *   D. 是否「偶发」还是「稳定慢」（同一语句连跑 3 次）。
 *
 * 只读，不改任何数据。
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL!;
const u = new URL(url);
const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];
const ssl = sslRaw ? JSON.parse(sslRaw) : undefined;

const t0 = Date.now();
const conn = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port || 4000),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl,
  compress: true,
  connectTimeout: 20_000,
});
console.log(`[connect] ${Date.now() - t0}ms`);

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const s = Date.now();
  const r = await fn();
  console.log(`[${label}] ${Date.now() - s}ms`);
  return r;
}

// ---- A. 表规模 ----
const [cnt] = await timed('A.count', () =>
  conn.query<any[]>('select count(*) as c from liquidity_daily'));
console.log('  liquidity_daily 总行数 =', (cnt[0] as any).c);

const [perDay] = await timed('A.perDay', () =>
  conn.query<any[]>(
    "select tradeDate, count(*) as c from liquidity_daily where tradeDate >= '2026-05-25' and tradeDate <= '2026-06-03' group by tradeDate order by tradeDate"));
console.log('  近端单日行数：');
for (const r of perDay as any[]) console.log(`    ${r.tradeDate}  ${r.c}`);

const [span] = await timed('A.span', () =>
  conn.query<any[]>('select min(tradeDate) as lo, max(tradeDate) as hi from liquidity_daily'));
console.log('  日期范围 =', JSON.stringify(span[0]));

// ---- B. 索引 / 唯一键 ----
const [idx] = await timed('B.index', () =>
  conn.query<any[]>('show index from liquidity_daily'));
console.log('  索引：');
for (const r of idx as any[]) {
  console.log(`    ${r.Key_name}  seq=${r.Seq_in_index}  col=${r.Column_name}  unique=${r.Non_unique === 0 ? 'YES' : 'no'}`);
}

const [ddl] = await timed('B.ddl', () =>
  conn.query<any[]>('show create table liquidity_daily'));
console.log('  DDL:\n' + String((ddl[0] as any)['Create Table']).split('\n').map((l) => '    ' + l).join('\n'));

// ---- C. 复现用户路径：单日 + 400 只 ----
const [codes] = await conn.query<any[]>(
  "select distinct securityCode from liquidity_daily where tradeDate = '2026-05-29' limit 400");
const list: string[] = (codes as any[]).map((r) => r.securityCode);
console.log(`\n[C] 取到 ${list.length} 只标的（以 2026-05-29 的存在性筛选），复现单日 IN 查询：`);

const sql = "select `securityCode`,`tradeDate`,`turnoverRate`,`totalMarketCap`,`circulationMarketCap` from `liquidity_daily` where (`securityCode` in (" +
  list.map(() => '?').join(',') + ") and `tradeDate` >= ? and `tradeDate` <= ?)";
const paramsAll = [...list, '2026-05-30', '2026-05-30'];

for (let i = 1; i <= 3; i += 1) {
  const s = Date.now();
  const [rows] = await conn.query<any[]>(sql, paramsAll);
  console.log(`    第 ${i} 次：${Date.now() - s}ms，返回 ${(rows as any[]).length} 行`);
}

// ---- C2. EXPLAIN ----
const [plan] = await conn.query<any[]>('explain ' + sql, paramsAll);
console.log('  EXPLAIN：');
for (const r of plan as any[]) console.log('   ', JSON.stringify(r));

// ---- D. 对照：全量单日（不限定 IN） ----
const s4 = Date.now();
const [all] = await conn.query<any[]>(sql.replace(/`securityCode` in \([?,\s]*\)/, '1=1'), ['2026-05-30', '2026-05-30']);
console.log(`\n[D] 2026-05-30 全表该日（无 IN 限制）：${Date.now() - s4}ms，${(all as any[]).length} 行`);

const s5 = Date.now();
const [count30] = await conn.query<any[]>("select count(*) as c from liquidity_daily where tradeDate = '2026-05-30'");
console.log(`[D] 该日真实行数 = ${(count30[0] as any).c}（${Date.now() - s5}ms）`);

await conn.end();
console.log('\n[done]');
