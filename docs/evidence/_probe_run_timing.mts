/**
 * 诊断 2：运行策略「等很久」+ `Failed query: ... liquidity_daily ...` 的真实耗时分布。
 *
 * 上一探针（`_probe_liquidity_scale.mts`）已证明：单条 liquidity_daily 查询本身只需 ~250ms
 * （走 `uq_liquidity_daily_security_date` 唯一键 Batch_Point_Get）。
 *
 * 因此 7.9s 只能是**排队**。本探针量化各段的真实耗时，用来判断：
 *   1. `fetchLimitUpCandidateBars` 走 `db.select()`（全列 + 谓词）到底多快 / 多慢；
 *   2. `loadTradingDays` 多快（`indexDaily` 的 distinct）；
 *   3. 池满时并发 8 条「同一语句」的真实墙钟（对比串行的 8×250ms）。
 *
 * 只读。
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL!;
const u = new URL(url);
const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];

function fmt(ms: number) { return `${ms}ms`; }

async function main() {
  const t0 = Date.now();
  const conn = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 4000),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    ssl: sslRaw ? JSON.parse(sslRaw) : undefined,
    compress: true, connectTimeout: 20_000,
  });
  console.log(`[connect] ${fmt(Date.now() - t0)}`);

  // ---- 1. 涨停候选粗筛（builder Phase1 的真实入口，按月分片）----
  // 谓词来自 detection.LIMIT_UP_CANDIDATE_SQL_PREDICATE，这里用等价近似复现其**形状**：
  // 全列 select + 日期区间 + 涨幅粗筛。真实耗时才是关键。
  const candSql = "select * from `stock_daily_prices` where (`tradeDate` >= ? and `tradeDate` <= ? and `openPrice` < `closePrice` and `closePrice` >= `preClosePrice` * 1.048) order by `tradeDate`, `stockCode`";
  for (const [s, e, label] of [["2024-09-01", "2024-09-30", "2024-09 单月"],
                               ["2024-09-01", "2024-11-30", "2024-09~11 三月"]] as const) {
    const t = Date.now();
    const [rows] = await conn.query<any[]>(candSql, [s, e]);
    console.log(`[1.candidate ${label}] ${fmt(Date.now() - t)}  rows=${(rows as any[]).length}`);
  }

  // ---- 2. 交易日历 ----
  {
    const t = Date.now();
    const [rows] = await conn.query<any[]>("select distinct `tradeDate` from `index_daily` order by `tradeDate`");
    console.log(`[2.loadTradingDays] ${fmt(Date.now() - t)}  rows=${(rows as any[]).length}`);
  }

  // ---- 3. 并发 8 条同语句（模拟 builder 的 defaultConcurrency=8）----
  const codes = (await conn.query<any[]>(
    "select distinct securityCode from liquidity_daily where tradeDate = '2026-05-29' limit 3200"))[0] as any[];
  const list: string[] = codes.map((r) => r.securityCode);
  console.log(`\n[3] 用 ${list.length} 只标的切 8 批（每批 400）并发，模拟 defaultConcurrency=8：`);

  const batches: string[][] = [];
  for (let i = 0; i < list.length; i += 400) batches.push(list.slice(i, i + 400));
  const liqSql = "select `securityCode`,`tradeDate`,`turnoverRate`,`totalMarketCap`,`circulationMarketCap` from `liquidity_daily` where (`securityCode` in (" +
    Array.from({ length: 400 }, () => '?').join(',') + ") and `tradeDate` >= ? and `tradeDate` <= ?)";

  // 3a 并发
  {
    const t = Date.now();
    const rs = await Promise.all(batches.map((b) => conn.query<any[]>(liqSql, [...b, '2026-05-25', '2026-05-30'])));
    const total = rs.reduce((s, [r]) => s + (r as any[]).length, 0);
    console.log(`    [3a 并发 8 批] 墙钟 ${fmt(Date.now() - t)}  总行=${total}`);
  }
  // 3b 串行（对照）
  {
    const t = Date.now();
    let total = 0;
    for (const b of batches) {
      const [r] = await conn.query<any[]>(liqSql, [...b, '2026-05-25', '2026-05-30']);
      total += (r as any[]).length;
    }
    console.log(`    [3b 串行 8 批] 墙钟 ${fmt(Date.now() - t)}  总行=${total}`);
  }

  // ---- 4. 单连接 vs 池：连接池 maxIdle 的边际影响（测连发 20 次的 P50/P95）----
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t = Date.now();
      await conn.query<any[]>("select count(*) as c from `liquidity_daily` where `tradeDate` = '2026-05-29'");
      times.push(Date.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(`\n[4] 同连接连发 20 次单日 count：P50=${fmt(times[10]!)} P95=${fmt(times[19]!)} min=${fmt(times[0]!)} max=${fmt(times[times.length - 1]!)}`);
  }

  await conn.end();
  console.log('\n[done]');
}

await main();
