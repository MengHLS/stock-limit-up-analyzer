/**
 * 核实（续）：两套「数据集」体系的关系，以及「运行策略」实际用哪一套。
 *
 * 前序（`_probe_dataset_overview.mts`）已查明：
 *   - `research_datasets`（7 行）：行数据落在 `rd_rows_<buildKey>` 物理表；只有 2 行有 rowsTableName
 *     （rd_rows_5dce9db1421bec38 = 800 行 / rd_rows_05809b1a6d97aa02 = 163 行），**且都是 2025-01 的玩具规模**；
 *   - `dataset_version`（2 行）：390002 = READY / 23,978 事件 / 1,543,082 行（2024-09~2026-08）；
 *   - `dataset_version.datasetId = 120001` —— **正好指向 research_datasets.id=120001**（那 163 行的玩具集）。
 *   - E 查询返回 0 行：`research_datasets` 里**没有** 390002（它是 dataset_version 体系）。
 *
 * 本探针回答：
 *   A. 390002 的「基础数据」在物理表 `ds_*` 里到底有多少（用户说"已经有了基础的数据"是否属实）；
 *   B. `ds_*` 表结构与行数；确认它就是「已落库、可直接读」的数据集。
 *   C. 用户设的数据集 = 390002 ⇒ 运行策略时理论上应直读 `ds_*`，不该回查 `stock_daily_prices`。
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

// ---- A. ds_* 物理表清单 ----
const tbls = await q('A 库内 ds_* 表',
  "select table_name, table_rows from information_schema.tables where table_schema = database() and table_name like 'ds\\_%' order by table_name");
for (const r of tbls) console.log(`   ${r.TABLE_NAME ?? r.table_name}  table_rows≈${r.TABLE_ROWS}`);

// ---- B. 逐表按 datasetVersionId 计数（390002 的真实底数）----
console.log('\n[B] 各 ds_* 表按 datasetVersionId = 390002 的真实计数：');
for (const r of tbls) {
  const nm = r.TABLE_NAME ?? r.table_name as string;
  const cols = (await c.query<any[]>(
    "select column_name from information_schema.columns where table_schema=database() and table_name=? and column_name='datasetVersionId'",
    [nm]))[0] as any[];
  if (cols.length === 0) { console.log(`   ${nm}：无 datasetVersionId 列（跳过）`); continue; }
  const [cnt] = await c.query<any[]>(`select count(*) as n from \`${nm}\` where \`datasetVersionId\`=390002`);
  console.log(`   ${nm}：${(cnt[0] as any).n} 行`);
}

// ---- C. event 表样本（证明底数真实可用）----
const [evSample] = await c.query<any[]>(
  "select * from `ds_first_limit_pullback_event` where `datasetVersionId`=390002 limit 2");
console.log('\n[C] ds_first_limit_pullback_event 样本：');
for (const r of evSample as any[]) console.log('   ', JSON.stringify(r).slice(0, 500));

// ---- D. prefix 表样本（日线行情已物化在这里？）----
const [pfSample] = await c.query<any[]>(
  "select * from `ds_first_limit_pullback_prefix` where `datasetVersionId`=390002 limit 1");
console.log('\n[D] ds_first_limit_pullback_prefix 样本（看是否已含 OHLCV）：');
for (const r of pfSample as any[]) console.log('   ', JSON.stringify(r).slice(0, 700));

await c.end();
console.log('\n[done]');
