/**
 * 诊断 3：并发反而更慢 —— 瓶颈是「链路带宽」还是「服务端并发」？
 *
 * 上一探针结论（`_probe_run_timing.mts`）：
 *   - 单条 liquidity_daily 查询（400 只 × 5 天）= 234ms（P50）
 *   - 8 批**并发** 7041ms  vs  8 批**串行** 4210ms  ⇒ 并发慢 1.67×
 *   - 单月涨停候选（11,377 行）= 4.1s；三月（29,247 行）= 23.1s
 *
 * 并发反而更慢，只可能是：把「RTT 受限」的负载变成了「带宽/服务端并发受限」的负载。
 * 本探针做三组对照，把结论钉死：
 *   A. 同样 8 批、同样总行数，但**每批只取 2 列 vs 全 5 列**（测带宽敏感度）；
 *   B. 不同并发度 1/2/4/8/16 跑**同一固定负载**（找拐点，为调参提供依据）；
 *   C. `select *` vs 显式列表（stock_daily_prices 全列 vs 9 列）的差异。
 *
 * 只读。
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL!;
const u = new URL(url);
const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];
const baseCfg = {
  host: u.hostname, port: Number(u.port || 4000),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl: sslRaw ? JSON.parse(sslRaw) : undefined,
  compress: true, connectTimeout: 20_000,
};

const fmt = (ms: number) => `${ms}ms`;

async function withConns<T>(n: number, fn: (cs: mysql.Connection[]) => Promise<T>): Promise<T> {
  const cs: mysql.Connection[] = [];
  for (let i = 0; i < n; i += 1) cs.push(await mysql.createConnection(baseCfg));
  try { return await fn(cs); } finally { for (const c of cs) await c.end().catch(() => {}); }
}

async function main() {
  const probe = await mysql.createConnection(baseCfg);
  const codes = ((await probe.query<any[]>(
    "select distinct securityCode from liquidity_daily where tradeDate = '2026-05-29' limit 3200"))[0] as any[])
    .map((r) => r.securityCode as string);
  const batches: string[][] = [];
  for (let i = 0; i < codes.length; i += 400) batches.push(codes.slice(i, i + 400));

  const inClause = Array.from({ length: 400 }, () => '?').join(',');
  const sql5 = `select \`securityCode\`,\`tradeDate\`,\`turnoverRate\`,\`totalMarketCap\`,\`circulationMarketCap\` from \`liquidity_daily\` where (\`securityCode\` in (${inClause}) and \`tradeDate\` >= ? and \`tradeDate\` <= ?)`;
  const sql2 = `select \`securityCode\`,\`tradeDate\` from \`liquidity_daily\` where (\`securityCode\` in (${inClause}) and \`tradeDate\` >= ? and \`tradeDate\` <= ?)`;
  const args = (b: string[]) => [...b, '2026-05-25', '2026-05-30'];

  // ---- A. 列数敏感度（同一 8 批负载，5 列 vs 2 列） ----
  console.log('[A] 8 批固定负载（3200 只 × 2026-05-25~30），并列并发：');
  for (const [label, sql] of [['5 列', sql5], ['2 列', sql2]] as const) {
    const t = Date.now();
    await withConns(8, (cs) => Promise.all(batches.map((b, i) => cs[i % cs.length]!.query(sql, args(b)))));
    console.log(`    ${label}：${fmt(Date.now() - t)}`);
  }

  // ---- B. 并发度扫描（同负载） ----
  console.log('\n[B] 同负载、不同并发度（每连接串行处理自己的批次）：');
  for (const n of [1, 2, 4, 8]) {
    const t = Date.now();
    await withConns(n, async (cs) => {
      for (const [i, b] of batches.entries()) await cs[i % cs.length]!.query(sql5, args(b));
    });
    console.log(`    concurrency=${n}：${fmt(Date.now() - t)}`);
  }

  // ---- C. select * vs 显式列（涨停候选形状，单月） ----
  console.log('\n[C] stock_daily_prices 2024-09 单月涨停粗筛：');
  for (const [label, sql] of [
    ['select *', "select * from `stock_daily_prices` where (`tradeDate` >= ? and `tradeDate` <= ? and `openPrice` < `closePrice` and `closePrice` >= `preClosePrice` * 1.048)"],
    ['显式 9 列', "select `stockCode`,`tradeDate`,`openPrice`,`closePrice`,`highPrice`,`lowPrice`,`volume`,`amount`,`preClosePrice` from `stock_daily_prices` where (`tradeDate` >= ? and `tradeDate` <= ? and `openPrice` < `closePrice` and `closePrice` >= `preClosePrice` * 1.048)"],
  ] as const) {
    const t = Date.now();
    const [r] = await probe.query<any[]>(sql, ['2024-09-01', '2024-09-30']);
    console.log(`    ${label}：${fmt(Date.now() - t)}  rows=${(r as any[]).length}`);
  }

  await probe.end();
  console.log('\n[done]');
}

await main();
