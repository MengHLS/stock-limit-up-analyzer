/**
 * 回答「组合回测跟数据集到底有没有关系 / 为什么跑不出今天」。
 *
 * 背景（用户 2026-09-15 追问）：
 *   诊断曾断言「`dataset_version` 的 `startDate/endDate` 是组合回测的**硬边界**」，
 *   用户质疑「组合回测这个应该跟数据集没关系」。
 *
 * 实查结论（本探针即为该结论的取证）：
 *   ① 用户说法**部分成立**：`server/runWorkbenchAssembly/assemble.ts` 全程用
 *      `request.startDate/endDate` 装配（`experimentConfig.dateRange` /
 *      `simulationConfig.dateRange` / `rebuildDataset`），**装配层没有任何
 *      「dateRange ⊆ 数据集窗口」校验**。
 *   ② 但**边界真实存在**，且是 FAIL FAST（不是静默截断），共两处：
 *      · `server/research/datasetAccess/session.ts:52-57` ——
 *        `range.start < handle.startDate || range.end > handle.endDate` ⇒ throw；
 *      · `server/research/simulator/engine.ts:303-312` —— 同上，错误码
 *        `SIM_RANGE_OUT_OF_DATASET`（「越界日期无行，禁止以部分数据集冒充全窗口」）。
 *   ③ `handle.startDate/endDate` 的来源**分两条路**（这是判定的关键）：
 *      · **直读**（策略绑定了 datasetVersionId 且直读成功）⇒
 *        `datasetFromRegistry.ts:1046-1047` 取 `version.startDate / version.endDate`
 *        ⇒ handle 窗口 = **数据集声明的窗口**，与用户选的区间无关 ⇒ 越界即抛错；
 *      · **从零重建**（未绑定 / 直读回落）⇒ handle 窗口 = **用户选的决策窗口**
 *        ⇒ 不可能越界，但内容受 `stock_daily_prices` 覆盖面限制。
 *   ④ 于是「能不能跑到今天」= 先看该策略走哪条路：
 *      `researchRunRouter.ts:488-490` 的 `primaryDatasetVersionIdOf(document)` 有值 ⇒ 直读。
 *
 * 只读：不写库、不发外部请求、不构建数据集。
 * 用法：npx tsx docs/evidence/_probe_dataset_vs_today.mts
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

const TODAY = '2026-09-15';

async function q(label: string, sql: string, params: any[] = []): Promise<any[]> {
  const t = Date.now();
  try {
    const [rows] = await c.query<any[]>(sql, params);
    console.log(`\n[${label}] ${Date.now() - t}ms  rows=${rows.length}`);
    for (const r of rows) console.log('   ' + JSON.stringify(r));
    return rows as any[];
  } catch (error) {
    console.log(`\n[${label}] ERROR ${(error as Error).message.slice(0, 200)}`);
    return [];
  }
}

console.log(`=== 目标日 ${TODAY}：组合回测的数据来源判定 ===`);
console.log('注：DATE 列一律用 DATE_FORMAT 输出，避免 mysql2 时区偏移（UTC+8 的 09-01 会显示成 08-31T16:00Z）');

// ---- 1. 数据集版本清单：窗口 + 状态 ----
await q('1 dataset_version 清单', `
  select id, datasetId, version, status,
         DATE_FORMAT(startDate,'%Y-%m-%d') dsStart,
         DATE_FORMAT(endDate,'%Y-%m-%d') dsEnd,
         totalEvents, totalRows,
         DATE_FORMAT(completedAt,'%Y-%m-%d %H:%i') completed
  from dataset_version order by id desc limit 12`);

// ---- 2. event（首板日=rd0）覆盖 ----
await q('2 event 覆盖（首板日 rd=0）', `
  select datasetVersionId, count(*) events, count(distinct tradeDate) dates,
         DATE_FORMAT(min(tradeDate),'%Y-%m-%d') firstDate,
         DATE_FORMAT(max(tradeDate),'%Y-%m-%d') lastDate
  from ds_first_limit_pullback_event
  group by datasetVersionId order by datasetVersionId`);

// ---- 3. post（观察日 rd>=1）覆盖 ----
await q('3 post 覆盖（观察日 rd>=1）', `
  select datasetVersionId, count(*) posts, count(distinct tradeDate) dates,
         DATE_FORMAT(min(tradeDate),'%Y-%m-%d') firstDate,
         DATE_FORMAT(max(tradeDate),'%Y-%m-%d') lastDate
  from ds_first_limit_pullback_post
  group by datasetVersionId order by datasetVersionId`);

// ---- 4. 决定性：09-01 起的 post 行 ----
await q('4 post 在 2026-09-01 起的行数', `
  select datasetVersionId, count(*) posts,
         DATE_FORMAT(min(tradeDate),'%Y-%m-%d') firstDate,
         DATE_FORMAT(max(tradeDate),'%Y-%m-%d') lastDate
  from ds_first_limit_pullback_post
  where tradeDate >= '2026-09-01'
  group by datasetVersionId order by datasetVersionId`);

// ---- 5. 决定性：目标日当天有无 post 行 ----
await q(`5 post 在 ${TODAY} 当天的行数`, `
  select datasetVersionId, count(*) posts, count(distinct symbol) symbols
  from ds_first_limit_pullback_post
  where tradeDate = ?
  group by datasetVersionId order by datasetVersionId`, [TODAY]);

// ---- 6. 策略绑定（决定走直读还是重建）+ 观察窗口声明 ----
await q('6 strategy_versions 绑定与文档声明', `
  select sv.id svId, sv.strategyId, sv.version,
         sv.datasetVersion label, sv.datasetVersionId,
         JSON_EXTRACT(sv.strategyDocumentJson, '$.definition.entry.observationWindow') obsWindow,
         JSON_EXTRACT(sv.strategyDocumentJson, '$.datasetVersionId') docMirror
  from strategy_versions sv
  order by sv.id desc limit 15`);

// ---- 7. 🔴 判定表：dateRange 终点 = 目标日 时各策略的走向 ----
//
// 🔴 两个回落分支必须先判，否则会误报「越界」：
//   ① 未绑定 datasetVersionId       ⇒ 装配层直接 rebuild（assemble.ts:311-326）；
//   ② 已绑定但文档未声明 observationWindow
//      ⇒ 直读被 `REGISTRY_OBSERVATION_WINDOW_UNDECLARED` 拒绝（assemble.ts:296-308）
//      ⇒ 回落 rebuild ⇒ handle 窗口 = **用户窗口** ⇒ 同样不越界。
//   只有「已绑定且声明了观察窗口」才会真走直读，handle 窗口才等于数据集窗口。
await q('7 判定：dateRange 终点=2026-09-15 各策略走向', `
  select sv.id svId, sv.strategyId, sv.datasetVersionId, sv.obsWindowDeclared,
         DATE_FORMAT(dv.startDate,'%Y-%m-%d') dsStart,
         DATE_FORMAT(dv.endDate,'%Y-%m-%d') dsEnd,
         case
           when sv.datasetVersionId is null
             then 'REBUILD（策略未绑定数据集）⇒ handle 窗口=用户窗口 ⇒ 不越界'
           when sv.obsWindowDeclared = 0
             then 'REBUILD 回落（直读被 OBSERVATION_WINDOW_UNDECLARED 拒绝）⇒ 窗口=用户窗口 ⇒ 不越界'
           when ? > DATE_FORMAT(dv.endDate,'%Y-%m-%d')
             then 'DIRECT-READ ⇒ handle 窗口=数据集窗口 ⇒ 目标日越界 ⇒ SIM_RANGE_OUT_OF_DATASET'
           else 'DIRECT-READ ⇒ 目标日在数据集窗口内'
         end verdict
  from (
    select id, strategyId, datasetVersionId,
           case when JSON_EXTRACT(strategyDocumentJson,'$.definition.entry.observationWindow') is null
                then 0 else 1 end obsWindowDeclared
    from strategy_versions
  ) sv
  left join dataset_version dv on dv.id = sv.datasetVersionId
  order by sv.id desc limit 15`, [TODAY]);

// ---- 8. 数据集构建作业进度 ----
await q('8 dataset_build_job 最近', `
  select id, datasetVersionId, status, processedRows, lastSymbol,
         DATE_FORMAT(lastTradeDate,'%Y-%m-%d') lastTradeDate,
         DATE_FORMAT(completedAt,'%Y-%m-%d %H:%i') completed
  from dataset_build_job order by id desc limit 8`);

// ---- 9. 对照：从零重建真正读的 stock_daily_prices 近期覆盖 ----
await q('9 stock_daily_prices 近期覆盖（重建路径的来源）', `
  select DATE_FORMAT(tradeDate,'%Y-%m-%d') d, count(*) bars, count(distinct stockCode) codes
  from stock_daily_prices
  where tradeDate >= '2026-09-08'
  group by tradeDate order by tradeDate desc limit 10`);

// ---- 10. 🔴 留档全量：`datasetSource` 直接记录每次回测实际走的是 registry 还是 rebuild ----
await q('10 closed_loop_backtest_run 留档（含 datasetSource）', `
  select id, strategyId, strategyVersion,
         DATE_FORMAT(startDate,'%Y-%m-%d') startDate,
         DATE_FORMAT(endDate,'%Y-%m-%d') endDate,
         datasetVersion, datasetVersionId, datasetSource, recipeId, status,
         tradeCount, equityCurvePointCount, firstBlockedReasonCode,
         DATE_FORMAT(createdAt,'%Y-%m-%d %H:%i') created
  from closed_loop_backtest_run order by id desc limit 12`);

// ---- 11. 留档涉及的策略：绑定了什么 / 声明了观察窗口没 ----
await q('11 留档涉及的策略绑定情况', `
  select distinct sv.strategyId, sv.version, sv.datasetVersionId,
         DATE_FORMAT(dv.startDate,'%Y-%m-%d') dsStart,
         DATE_FORMAT(dv.endDate,'%Y-%m-%d') dsEnd,
         case when JSON_EXTRACT(sv.strategyDocumentJson,'$.definition.entry.observationWindow') is null
              then 0 else 1 end obsWindowDeclared
  from strategy_versions sv
  left join dataset_version dv on dv.id = sv.datasetVersionId
  where sv.strategyId in (select distinct strategyId from closed_loop_backtest_run)
  order by sv.strategyId`);

console.log('\n=== 完成（只读） ===');
await c.end();
process.exit(0);
