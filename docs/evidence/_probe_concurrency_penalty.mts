/**
 * 诊断 5（收尾）：确认「并发惩罚」的稳定性 —— 是否是偶发/瞬时现象。
 *
 * 前序证据：
 *   `_probe_bandwidth.mts`   concurrency 1/2/4/8 → 3692 / 6250 / 9211 / 12751 ms
 *   `_probe_singleconn.mts`  1 连接 vs 4 连接 → 3143 vs 3782ms；compress 净收益 2.57×
 *
 * 本探针把「并发惩罚」重复测 3 轮（每轮都重新建连），确认它不是一次性的网络抖动，
 * 而是一条稳定可复现的链路特征 —— 只有这样才够格写进 PROJECT_RULES 当硬约束。
 *
 * 只读。
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL!;
const u = new URL(url);
const sslRaw = /ssl=(\{.*\})/.exec(url)?.[1];
const mk = () => ({
  host: u.hostname, port: Number(u.port || 4000),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl: sslRaw ? JSON.parse(sslRaw) : undefined,
  compress: true, connectTimeout: 20_000,
});
const fmt = (ms: number) => `${ms}ms`;
const inClause = Array.from({ length: 400 }, () => '?').join(',');

async function run(concurrency: number, batches: string[][], sql: string, args: (b: string[]) => any[]) {
  const cs = await Promise.all(Array.from({ length: concurrency }, () => mysql.createConnection(mk())));
  try {
    const t = Date.now();
    for (const [i, b] of batches.entries()) await cs[i % concurrency]!.query(sql, args(b));
    return Date.now() - t;
  } finally { await Promise.all(cs.map((c) => c.end().catch(() => {}))); }
}

async function main() {
  const probe = await mysql.createConnection(mk());
  const codes = ((await probe.query<any[]>(
    "select distinct securityCode from liquidity_daily where tradeDate = '2026-05-29' limit 1600"))[0] as any[])
    .map((r) => r.securityCode as string);
  const batches: string[][] = [];
  for (let i = 0; i < codes.length; i += 400) batches.push(codes.slice(i, i + 400));
  const sql = `select \`securityCode\`,\`tradeDate\`,\`turnoverRate\`,\`totalMarketCap\`,\`circulationMarketCap\` from \`liquidity_daily\` where (\`securityCode\` in (${inClause}) and \`tradeDate\` >= ? and \`tradeDate\` <= ?)`;
  const args = (b: string[]) => [...b, '2026-05-25', '2026-05-30'];
  await probe.end();

  console.log(`固定负载 = ${batches.length} 批 × 400 只 × 5 天，重复 3 轮：\n`);
  const rows: Record<number, number[]> = { 1: [], 2: [], 4: [] };
  for (let round = 1; round <= 3; round += 1) {
    const line: string[] = [];
    for (const n of [1, 2, 4] as const) {
      const ms = await run(n, batches, sql, args);
      rows[n]!.push(ms);
      line.push(`c=${n}: ${fmt(ms)}`);
    }
    console.log(`  第 ${round} 轮   ${line.join('   ')}`);
  }

  console.log('\n汇总（中位数）：');
  for (const n of [1, 2, 4] as const) {
    const s = rows[n]!.slice().sort((a, b) => a - b);
    const med = s[Math.floor(s.length / 2)]!;
    console.log(`  concurrency=${n}  中位 ${fmt(med)}  明细 [${rows[n]!.map(fmt).join(', ')}]`);
  }
  const m1 = rows[1]!.slice().sort((a, b) => a - b)[1]!;
  const m4 = rows[4]!.slice().sort((a, b) => a - b)[1]!;
  console.log(`\n  ⇒ 并发 4 相对串行的惩罚倍数 = ${(m4 / m1).toFixed(2)}×`);

  console.log('\n[done]');
}

await main();
