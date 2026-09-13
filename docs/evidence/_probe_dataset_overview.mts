/**
 * 核实：用户「已经设了数据集」的那个数据集，在库里到底存了什么？
 *
 * 用户质疑（原话）：「这个策略运行不合理，我明明是设置了数据集，并且数据集中已经有了基础的数据
 * 可以支持策略运行，为什么又要去日线行情表中去查，这是完全不合理的」
 *
 * 要回答：
 *   A. 前端「选数据集」选的到底是哪个实体？（`dataset_version` / `research_datasets` / 两者？）
 *   B. `research_datasets` 里有哪些行？有无 `rowsTableName`（= 行数据是否已落库）？
 *   C. 若有行表，表里有多少行、能否流式读回（`rowJson` 形状）？
 *   D. `dataset_version` 390002 与 `research_datasets` 是什么关系？
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

async function q<T = any>(label: string, sql: string, params: any[] = []): Promise<T[]> {
  const t = Date.now();
  const [rows] = await c.query<any[]>(sql, params);
  console.log(`\n[${label}] ${Date.now() - t}ms  rows=${rows.length}`);
  return rows as T[];
}

// ---- A. research_datasets 全貌 ----
const rds = await q('A research_datasets 全部',
  "select `id`,`datasetId`,`datasetVersion`,`name`,`startDate`,`endDate`,`asOfPerTradeDate`,`rowCount`,`gate`,`rowsTableName`,`createdAt` from `research_datasets` order by `id` desc limit 30");
for (const r of rds) {
  console.log(`   id=${r.id} ver=${r.datasetVersion} name=${r.name}`);
  console.log(`      ${r.startDate}~${r.endDate} rowCount=${r.rowCount} gate=${r.gate} rowsTableName=${r.rowsTableName ?? '(null = 未落库)'}`);
}

// ---- B. dataset_version 全貌（前端"选数据集"可能是这个）----
const dvs = await q('B dataset_version 全部',
  "select `id`,`datasetId`,`version`,`startDate`,`endDate`,`status`,`totalEvents`,`totalRows` from `dataset_version` order by `id` desc limit 20");
for (const r of dvs) {
  console.log(`   id=${r.id} ver=${r.version} status=${r.status} events=${r.totalEvents} rows=${r.totalRows}`);
}

// ---- C. 有没有 rd_rows_* 物理表 ----
const tbls = await q('C 库内 rd_rows_* 表',
  "select table_name, table_rows from information_schema.tables where table_schema = database() and table_name like 'rd\\_rows\\_%'");
if (tbls.length === 0) console.log('   （无 —— 说明从未做过分片构建，行数据从未落库）');
for (const r of tbls) console.log(`   ${r.TABLE_NAME ?? r.table_name}  table_rows≈${r.TABLE_ROWS ?? r.table_rows}`);

// ---- D. 390002 是什么 ----
const d390 = await q('D 390002 详情',
  "select `id`,`datasetId`,`version`,`status`,`startDate`,`endDate`,`totalEvents`,`totalRows` from `dataset_version` where `id`=390002");
console.log('   ', JSON.stringify(d390[0] ?? null));

// ---- E. research_datasets 与 390002 的关系 ----
const rel = await q('E research_datasets 中是否有对应 390002 的行',
  "select `id`,`datasetId`,`datasetVersion`,`name`,`rowCount`,`gate`,`rowsTableName` from `research_datasets` where `datasetId` like '%390002%'");
console.log('   ', JSON.stringify(rel));

// ---- F. 首板回踩表（另一套数据集体系）----
const fpe = await q('F first_limit_pullback_events 按版本',
  "select `datasetVersionId`, count(*) as n, min(`tradeDate`) as lo, max(`tradeDate`) as hi from `first_limit_pullback_events` group by `datasetVersionId` order by `datasetVersionId` desc limit 10");
for (const r of fpe) console.log(`   datasetVersionId=${r.datasetVersionId}  events=${r.n}  ${r.lo}~${r.hi}`);

// ---- G. 行表真实内容（若有）----
for (const t of tbls) {
  const nm = (t.TABLE_NAME ?? t.table_name) as string;
  const [cnt] = await c.query<any[]>(`select count(*) as n from \`${nm}\``);
  console.log(`\n[G ${nm}] 实际行数 = ${(cnt[0] as any).n}`);
  const [sample] = await c.query<any[]>(`select * from \`${nm}\` limit 1`);
  if (sample[0]) {
    const keys = Object.keys(sample[0]);
    console.log(`   列 = [${keys.join(', ')}]`);
    const rj = (sample[0] as any).rowJson;
    if (typeof rj === 'string') {
      const parsed = JSON.parse(rj);
      console.log(`   rowJson 键 = [${Object.keys(parsed).join(', ')}]`);
      console.log(`   rowJson 样本 = ${rj.slice(0, 600)}`);
    }
  }
}

await c.end();
console.log('\n[done]');
