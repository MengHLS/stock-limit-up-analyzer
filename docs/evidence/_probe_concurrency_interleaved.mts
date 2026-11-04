/**
 * 诊断 6（订正）：并发惩罚的真伪 —— 用「交错重复 + 统计量」替代单次采样。
 *
 * 🔴 为什么重做：诊断 5 的三轮结果推翻了我基于单次采样得出的「并发必然更慢」结论。
 *    - `_probe_bandwidth.mts` 单次：c=1/2/4/8 → 3692/6250/9211/12751ms（看似 3.45× 惩罚）
 *    - `_probe_concurrency_penalty.mts` 三轮中位：c=1/2/4 → 2011/1369/1940ms（惩罚 0.96×）
 *    - 同一 c=1 在三次测量中 = 2847/2011/1850ms（自身波动 1.54×）
 *   ⇒ 单次采样不足以定论；本探针**交错**测量（c=1,2,4,1,2,4,… 重复 5 轮），
 *     消除「时段漂移」这一混杂因素，给出可信结论。
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
const inClause = Array.from({ length: 400 }, () => '?').join(',');

async function run(c: number, batches: string[][], sql: string, args: (b: string[]) => any[]) {
  const cs = await Promise.all(Array.from({ length: c }, () => mysql.createConnection(mk())));
  try {
    const t = Date.now();
    for (const [i, b] of batches.entries()) await cs[i % c]!.query(sql, args(b));
    return Date.now() - t;
  } finally { await Promise.all(cs.map((x) => x.end().catch(() => {}))); }
}

const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };

async function main() {
  const probe = await mysql.createConnection(mk());
  const codes = ((await probe.query<any[]>(
    "select distinct securityCode from liquidity_daily where tradeDate = '2026-05-29' limit 1600"))[0] as any[])
    .map((r) => r.securityCode as string);
  await probe.end();
  const batches: string[][] = [];
  for (let i = 0; i < codes.length; i += 400) batches.push(codes.slice(i, i + 400));

  const sql = `select \`securityCode\`,\`tradeDate\`,\`turnoverRate\`,\`totalMarketCap\`,\`circulationMarketCap\` from \`liquidity_daily\` where (\`securityCode\` in (${inClause}) and \`tradeDate\` >= ? and \`tradeDate\` <= ?)`;
  const args = (b: string[]) => [...b, '2026-05-25', '2026-05-30'];

  const concs = [1, 2, 4] as const;
  const acc: Record<number, number[]> = { 1: [], 2: [], 4: [] };

  console.log(`交错测量（每轮 c=1→2→4），固定负载 ${batches.length} 批 × 400 只 × 5 天：\n`);
  for (let round = 1; round <= 5; round += 1) {
    const parts: string[] = [];
    for (const c of concs) {
      const ms = await run(c, batches, sql, args);
      acc[c]!.push(ms);
      parts.push(`c=${c}:${ms}`);
    }
    console.log(`  轮 ${round}   ${parts.join('  ')}`);
  }

  console.log('\n统计（交错消除时段漂移）：');
  for (const c of concs) {
    const v = acc[c]!;
    console.log(`  c=${c}  中位=${median(v)}ms  min=${Math.min(...v)}  max=${Math.max(...v)}  全部=[${v.join(', ')}]`);
  }
  const m1 = median(acc[1]!), m4 = median(acc[4]!);
  console.log(`\n  ⇒ 并发 4 : 串行 = ${(m4 / m1).toFixed(2)}×`);

  console.log('\n[done]');
}

await main();
