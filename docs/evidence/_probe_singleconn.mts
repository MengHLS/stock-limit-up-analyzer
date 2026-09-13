/**
 * 诊断 4：把「跨境链路反并行」结论钉死，并量化「关闭连接池/单连接」的真实收益。
 *
 * 上一探针（`_probe_bandwidth.mts`）结论：
 *   concurrency 1/2/4/8 → 3692 / 6250 / 9211 / 12751 ms（并发越高**越慢**，3.45×）
 *   5 列 → 2 列 只从 11313 → 9872ms（列数几乎不影响）
 *   ⇒ 瓶颈不在带宽、不在服务端，在「多连接并行本身有惩罚」。
 *
 * 本探针补齐三个关键对照：
 *   A. 同一**单连接**串行 vs 多连接：确认「单连接串行」是最优（这是本环境的核心事实）；
 *   B. `compress` on/off 对照：确认压缩协议在这条链路上是净收益还是净开销；
 *   C. 真实 Dataset 构建窗口（390002 的 2024-09 起）走 `fetchLimitUpCandidateBars` 真实代价，
 *      给出「现在运行一次大约多久」的可引用数字。
 *
 * 只读。
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL!;
const u = new URL(url);
const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];
const mk = (compress: boolean) => ({
  host: u.hostname, port: Number(u.port || 4000),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl: sslRaw ? JSON.parse(sslRaw) : undefined,
  compress, connectTimeout: 20_000,
});

const fmt = (ms: number) => `${ms}ms`;
const inClause = Array.from({ length: 400 }, () => '?').join(',');

async function main() {
  const probe = await mysql.createConnection(mk(true));
  const codes = ((await probe.query<any[]>(
    "select distinct securityCode from liquidity_daily where tradeDate = '2026-05-29' limit 3200"))[0] as any[])
    .map((r) => r.securityCode as string);
  const batches: string[][] = [];
  for (let i = 0; i < codes.length; i += 400) batches.push(codes.slice(i, i + 400));
  const sql5 = `select \`securityCode\`,\`tradeDate\`,\`turnoverRate\`,\`totalMarketCap\`,\`circulationMarketCap\` from \`liquidity_daily\` where (\`securityCode\` in (${inClause}) and \`tradeDate\` >= ? and \`tradeDate\` <= ?)`;
  const args = (b: string[]) => [...b, '2026-05-25', '2026-05-30'];
  const load = 3200 * 5;

  // ---- A. 单连接串行（基线最优）+ compress 对照 ----
  console.log(`[A] 固定负载 ${load} 只·日，单连接串行：`);
  for (const compress of [true, false]) {
    const c = await mysql.createConnection(mk(compress));
    const t = Date.now();
    let rows = 0;
    for (const b of batches) { const [r] = await c.query<any[]>(sql5, args(b)); rows += (r as any[]).length; }
    console.log(`    compress=${compress}：${fmt(Date.now() - t)}  行=${rows}`);
    await c.end();
  }

  // ---- A2. 单连接 vs 4 连接（同一负载，各跑一次取较好值）----
  console.log('\n[A2] 同一负载：1 连接 vs 4 连接：');
  {
    const c = await mysql.createConnection(mk(true));
    const t = Date.now();
    for (const b of batches) await c.query(sql5, args(b));
    console.log(`    1 连接串行：${fmt(Date.now() - t)}`);
    await c.end();
  }
  {
    const cs = await Promise.all([0, 1, 2, 3].map(() => mysql.createConnection(mk(true))));
    const t = Date.now();
    for (const [i, b] of batches.entries()) await cs[i % 4]!.query(sql5, args(b));
    console.log(`    4 连接（每连接串行）：${fmt(Date.now() - t)}`);
    await Promise.all(cs.map((c) => c.end()));
  }

  // ---- C. 真实构建窗口：390002 从 2024-09 起，涨停候选按月分片 ----
  console.log('\n[C] 真实构建窗口的涨停候选（builder Phase1 入口，按月分片）：');
  const candSql = "select * from `stock_daily_prices` where (`tradeDate` >= ? and `tradeDate` <= ? and `openPrice` < `closePrice` and `closePrice` >= `preClosePrice` * 1.048) order by `tradeDate`, `stockCode`";
  const months: [string, string][] = [];
  for (let y = 2024, m = 9; ; ) {
    const s = `${y}-${String(m).padStart(2, '0')}-01`;
    const em = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    months.push([s, em]);
    if (y === 2025 && m === 12) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  const c2 = await mysql.createConnection(mk(true));
  // 串行（本环境最优）
  let tSer = 0, rSer = 0;
  for (const [s, e] of months.slice(0, 4)) {
    const t = Date.now();
    const [r] = await c2.query<any[]>(candSql, [s, e]);
    tSer += Date.now() - t; rSer += (r as any[]).length;
    console.log(`    串行 ${s}：${fmt(Date.now() - t)}  rows=${(r as any[]).length}`);
  }
  console.log(`    → 前 4 个月串行合计 ${fmt(tSer)}（${rSer} 行）⇒ 16 个月约 ${fmt(Math.round(tSer / 4 * 16))}`);
  // 并发 4（现状 defaultConcurrency=8）
  {
    const cs = await Promise.all([0, 1, 2, 3].map(() => mysql.createConnection(mk(true))));
    const t = Date.now();
    for (const [i, [s, e]] of months.slice(0, 4).entries()) await cs[i % 4]!.query(candSql, [s, e]);
    console.log(`    并发 4 同样 4 个月：${fmt(Date.now() - t)}`);
    await Promise.all(cs.map((c) => c.end()));
  }
  await c2.end();

  await probe.end();
  console.log('\n[done]');
}

await main();
