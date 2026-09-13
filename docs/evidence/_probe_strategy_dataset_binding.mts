/**
 * 核实（收尾）：策略到底绑定了哪个数据集？运行工作台是否无视了它？
 *
 * 已查明事实：
 *   1. `ds_first_limit_pullback_*` 5 张表已完整落库 390002 的 **1,543,082 行**（含 prefix 的 503,538 行 OHLCV）；
 *   2. 运行面板（`RunConfigPanel.tsx`）**只有**「加载真实数据 / 数据链已就绪」两个开关，
 *      **没有「选择数据集」的入口** —— 打开后走 `assembleRunWorkbenchInputs` → 现场 `buildResearchDataset`；
 *   3. `assemble.ts` 的 `startDate/endDate` 直接取自**用户在前端填的日期**，与任何已落库数据集无关。
 *
 * 本探针确认第 4 点：**策略文档里是否声明了 datasetVersion 绑定**（若有，则运行时无视它就是明确的语义断裂）。
 *
 * 只读。
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

async function q(label: string, sql: string, params: any[] = []): Promise<any[]> {
  const t = Date.now();
  const [rows] = await c.query<any[]>(sql, params);
  console.log(`\n[${label}] ${Date.now() - t}ms  rows=${rows.length}`);
  return rows as any[];
}

// ---- A. 策略版本与其数据集绑定 ----
const sv = await q('A strategy_versions',
  "select `strategyId`,`version`,`createdAt`, left(`strategyDocumentJson`, 400) as doc_head from `strategy_versions` order by `createdAt` desc limit 5");
for (const r of sv) console.log(`   ${r.strategyId}@${r.version}\n      ${String(r.doc_head).replace(/\n/g, ' ')}`);

// ---- B. 数据集绑定表 ----
const b1 = await q('B dataset_bindings（若存在）',
  "select table_name from information_schema.tables where table_schema=database() and table_name like '%binding%'");
for (const r of b1) console.log(`   ${r.TABLE_NAME ?? r.table_name}`);

// ---- C. 策略文档里搜 dataset 关键字 ----
const hits = await q('C strategy_versions 中含 datasetVersion 的文档',
  "select `strategyId`,`version`, `strategyDocumentJson` like '%datasetVersion%' as has_dsv, `strategyDocumentJson` like '%390002%' as has_390002 from `strategy_versions`");
for (const r of hits) console.log(`   ${r.strategyId}@${r.version}  has_datasetVersion=${r.has_dsv}  mentions_390002=${r.has_390002}`);

// ---- D. 若有绑定表，列出内容 ----
for (const r of b1) {
  const nm = (r.TABLE_NAME ?? r.table_name) as string;
  const rows = await q(`D ${nm} 内容`, `select * from \`${nm}\` limit 10`);
  for (const x of rows) console.log('   ', JSON.stringify(x).slice(0, 300));
}

await c.end();
console.log('\n[done]');
