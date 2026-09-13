/**
 * 诊断 7：把「运行策略要等多久」算成可引用的数字。
 *
 * 已确认（`_probe_concurrency_interleaved.mts`，交错 5 轮）：
 *   并发无惩罚（c=4 : c=1 = 0.96×）；单条 400 只 × 5 天查询 ≈ 1.3s（该负载 16,000 只·日）。
 *   `compress` 净收益 2.57×（8039ms → 3130ms），必须保持开启。
 *
 * 本探针读**真实 390002 版本**的构建窗口与筛选配置，再用真实 SQL 测出各段的真实代价，
 * 给出「构建一次要多久」的可引用估算（不是拍脑袋）。
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

async function main() {
  const c = await mysql.createConnection(mk());

  // ---- 1. 真实版本窗口 ----
  const [ver] = await c.query<any[]>(
    "select `id`,`version`,`startDate`,`endDate`,`status`,`totalEvents`,`totalRows` from `dataset_version` where `id` = 390002");
  console.log('[1] dataset_version 390002：', JSON.stringify(ver[0] ?? null));

  const [cfg] = await c.query<any[]>(
    "select `batchSize`,`preWindowDays`,`postWindowDays`,`excludeSt` from `dataset_build_config` where `datasetVersionId` = 390002");
  console.log('[1] dataset_build_config：', JSON.stringify(cfg[0] ?? null));

  const [ev] = await c.query<any[]>(
    "select `eventKind`,`relativeDay` from `dataset_build_config_event` where `configId` in (select `id` from `dataset_build_config` where `datasetVersionId`=390002)");
  console.log('[1] events：', JSON.stringify(ev));

  const [boards] = await c.query<any[]>(
    "select `board` from `dataset_build_config_board` where `configId` in (select `id` from `dataset_build_config` where `datasetVersionId`=390002)");
  console.log('[1] boards：', JSON.stringify(boards));

  // ---- 2. 窗口内交易日数 ----
  const start = (ver[0] as any)?.startDate, end = (ver[0] as any)?.endDate;
  if (start && end) {
    const [dayCountRows] = await c.query<any[]>(
      "select count(distinct `tradeDate`) as n from `index_daily` where `tradeDate` >= ? and `tradeDate` <= ?", [start, end]);
    const n = (dayCountRows[0] as any).n as number;
    console.log(`\n[2] 窗口 ${start} ~ ${end}：${n} 个交易日`);

    // ---- 3. 涨停候选（按月分片，串行）真实总耗时 ----
    const candSql = "select * from `stock_daily_prices` where (`tradeDate` >= ? and `tradeDate` <= ? and `openPrice` < `closePrice` and `closePrice` >= `preClosePrice` * 1.048) order by `tradeDate`, `stockCode`";
    // 用「连续 30 天窗口」滑动采样，避免月份边界构造的复杂度（等价量级）。
    console.log('[3] 涨停候选：以连续 30 天窗口滑动采样 4 次…');
    let sum = 0, rows = 0, measured = 0;
    const allDays = (await c.query<any[]>(
      "select distinct `tradeDate` from `index_daily` where `tradeDate` >= ? and `tradeDate` <= ? order by `tradeDate`", [start, end]))[0] as any[];
    const days = allDays.map((r) => (typeof r.tradeDate === 'string' ? r.tradeDate : new Date(r.tradeDate).toISOString().slice(0, 10)));
    for (let k = 0; k < 4; k += 1) {
      const i0 = Math.floor((days.length - 30) * (k / 4));
      const s = days[i0]!, e = days[Math.min(days.length - 1, i0 + 29)]!;
      const t = Date.now();
      const [r] = await c.query<any[]>(candSql, [s, e]);
      const ms = Date.now() - t;
      sum += ms; rows += (r as any[]).length; measured += 1;
      console.log(`      ${s}~${e} (30 交易日) → ${ms}ms  ${(r as any[]).length} 行`);
    }
    const perMonth = sum / measured, rowsPerMonth = rows / measured;
    const monthCount = 484 / 21;
    console.log(`[3] 均值 ${Math.round(perMonth)}ms/30日、${Math.round(rowsPerMonth)} 行 ⇒ 全窗 ${monthCount.toFixed(1)} 个「30日」片 ≈ ${Math.round(perMonth * monthCount / 1000)}s`);

    // ---- 4. Phase2：定向取数（按 symbol 分批）真实代价 ----
    // builder Phase2 用 fetchBarsForSymbolsInRange(symbols, day0, dayN)：片内 symbol 集合 + 片内日期区间。
    // 用「400 只 × 30 天」这一真实单元测速，再乘批数。
    const [symCnt] = await c.query<any[]>("select count(distinct `stockCode`) as n from `stock_daily_prices` where `tradeDate` >= ? and `tradeDate` <= ?", [start, end]);
    const syms = (symCnt[0] as any).n as number;
    console.log(`\n[4] 窗口内标的数 = ${syms} ⇒ SYMBOL_BATCH_SIZE=400 时约 ${Math.ceil(syms / 400)} 批`);
    const [codes] = await c.query<any[]>(
      "select distinct `stockCode` from `stock_daily_prices` where `tradeDate` = ? limit 400", [days[days.length - 1]]);
    const list = (codes as any[]).map((r) => r.stockCode);
    const p2Sql = "select `stockCode`,`tradeDate`,`openPrice`,`closePrice`,`highPrice`,`lowPrice`,`volume`,`amount`,`preClosePrice` from `stock_daily_prices` where (`stockCode` in (" +
      list.map(() => '?').join(',') + ") and `tradeDate` >= ? and `tradeDate` <= ?)";
    for (let k = 0; k < 3; k += 1) {
      const i0 = Math.floor((days.length - 30) * (k / 3));
      const s = days[i0]!, e = days[Math.min(days.length - 1, i0 + 29)]!;
      const t = Date.now();
      const [r] = await c.query<any[]>(p2Sql, [...list, s, e]);
      console.log(`      400 只 × 30 日 → ${Date.now() - t}ms  ${(r as any[]).length} 行`);
    }
  }

  await c.end();
  console.log('\n[done]');
}

await main();
