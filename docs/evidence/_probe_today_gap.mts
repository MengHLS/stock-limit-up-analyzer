/**
 * 诊断探针 —— 「已同步指数，为何前向/组合回测仍无今天数据」。
 *
 * 本探针把「为什么某天不出现」的**全部判据**一次读齐，供一条命令定位：
 *
 *   口径分工（本项目硬事实）：
 *     1. `index_daily`          = 纸面交易推进的**交易日历**唯一来源（仅 4 只指数）；
 *     2. `stock_daily_prices`   = 前向与组合回测**真正的 bar 来源**，且它**不是全市场快照**
 *                                 —— 由 `stockPriceSync` 按「涨停记录 × 信号日+T+N 观察窗」
 *                                 增量写入，故近端每日只覆盖约 400~600 只；
 *     3. `dataset_version`      = 组合回测**直读路径**的窗口来源。其 `startDate/endDate`
 *                                 经 `handle` 成为「数据集窗口」，**越界即 FAIL FAST**
 *                                 （`research/datasetAccess/session.ts:52-57`；
 *                                 `research/simulator/engine.ts:303-312`，码
 *                                 `SIM_RANGE_OUT_OF_DATASET`：「禁止以部分数据集冒充全窗口」）。
 *                                 ⚠️ 但**只有直读路径**如此：未绑定数据集 / 直读回落时
 *                                 （`runWorkbenchAssembly/assemble.ts:296-326`）handle 窗口
 *                                 = **用户选的决策窗口** ⇒ 此时组合回测与数据集**无关**。
 *                                 ⇒ 先判该次运行走 `registry` 还是 `rebuild`
 *                                 （`closed_loop_backtest_run.datasetSource` 直接记录，无需推算）。
 *
 *   判据链（任一环节为 0 即「没有那天的数据」）：
 *     日历末端 ≥ 目标日 → bar / ds 覆盖含目标日 → 数据集窗口含目标日（**仅直读路径**）
 *     → 运行已推进到目标日。
 *
 *   ⚠️ 「数据集**声明窗口**」与「数据集**内容**」是两个不同上限，**更小的那个**才是有效上限：
 *      实测 dataset_version.id=390002 声明 `2024-09-01 ~ 2026-09-01`，
 *      而内容 max(tradeDate)：event（首板日）= 2026-09-01、post（观察日）= 2026-09-04
 *      ⇒ 声明窗口先触顶，故有效上限 = **2026-09-01**（09-15 无论怎么看都进不去）。
 *
 * 只读：不写库、不发外部请求。
 * 用法：npx tsx docs/evidence/_probe_today_gap.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { getIndexCalendarLastDate, getMarketLastDate, getIndexSyncOverview } from "../../server/marketData/indexSync";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

type Row = Record<string, unknown>;

const q = async (text: string): Promise<Row[]> => {
  try {
    return (((await db.execute(sql.raw(text))) as unknown as [Row[]])[0] ?? []) as Row[];
  } catch (error) {
    return [{ __error: String((error as Error).message).slice(0, 300) }];
  }
};

const j = (label: string, value: unknown) => {
  console.log(`=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
};

console.log(`今天(系统) : ${new Date().toISOString().slice(0, 10)}`);

// ── 环节 1：交易日历与行情末端 ────────────────────────────────
j("1) 两个末端", {
  marketLastDate_stockDailyPrices: await getMarketLastDate(),
  calendarLastDate_indexDaily: await getIndexCalendarLastDate(),
});

j("2) DB 时区校准（表内 timestamp 为 UTC；+8 得北京时）", await q(
  `select now() as db_now, @@global.time_zone as glob_tz, @@system_time_zone as sys_tz`,
));

j("3) index_daily 逐只覆盖 + 写盘时间", await q(
  `select indexCode, count(*) as n_rows, min(tradeDate) as d_first, max(tradeDate) as d_last,
          max(retrievedAt) as last_retrieved, group_concat(distinct source) as sources
   from index_daily group by indexCode order by indexCode`,
));

// ── 环节 2：bar 覆盖（且它不是全市场快照）────────────────────
j("4) stock_daily_prices 最近 30 个交易日覆盖", await q(
  `select tradeDate, count(distinct stockCode) as n_codes
   from stock_daily_prices group by tradeDate order by tradeDate desc limit 30`,
));

j("5) 写入来源分布", await q(
  `select source, count(*) as n_rows, count(distinct tradeDate) as n_dates,
          min(tradeDate) as d_first, max(tradeDate) as d_last
   from stock_daily_prices group by source order by n_rows desc`,
));

j("6) 涨停记录驱动验证（上一交易日涨停股是否已落到今日行情）", await q(
  `select
     (select count(distinct stockCode) from limit_up_records where limitUpDate='2026-09-14') as lu_0914_codes,
     (select count(*) from (select distinct stockCode from limit_up_records where limitUpDate='2026-09-14') t
        where stockCode in (select stockCode from stock_daily_prices where tradeDate='2026-09-15')) as lu_0914_in_today,
     (select count(distinct stockCode) from stock_daily_prices where tradeDate='2026-09-15') as today_total`,
));

// ── 环节 3：数据集窗口（组合回测硬边界）──────────────────────
j("7) dataset_version 窗口", await q(
  `select id, version, status, startDate, endDate, totalEvents, totalRows, createdAt, completedAt
   from dataset_version order by id`,
));

j("8) 最近构建任务游标", await q(
  `select id, datasetVersionId, status, completedChunks, totalChunks, lastTradeDate, completedAt, errorMessage
   from dataset_build_job order by id desc limit 5`,
));

// ── 环节 4：运行是否已推进到目标日 ──────────────────────────
j("9) 前向纸面运行进度", await q(
  `select id, label, strategyKey, status, lastProcessedDate, createdAt, updatedAt
   from paper_trading_runs order by id`,
));

j("10) 组合回测留档窗口（最近 12 次）", await q(
  `select id, runId, strategyId, startDate, endDate, datasetVersionId, datasetSource,
          status, tradeCount, equityCurvePointCount, createdAt
   from closed_loop_backtest_run order by id desc limit 12`,
));

// ── 汇总：页面口径读数 ──────────────────────────────────────
try {
  const overview = await getIndexSyncOverview({});
  j("11) getIndexSyncOverview()", {
    marketLastDate: overview.marketLastDate,
    calendarLastDate: overview.calendarLastDate,
    lagDays: overview.lagDays,
    lagTradingDays: overview.lagTradingDays,
    calendarStale: overview.calendarStale,
    pendingIndexCount: overview.pendingIndexCount,
    targets: overview.targets.map((t) => ({
      indexCode: t.indexCode, rowCount: t.rowCount, lastDate: t.lastDate, action: t.plan.action,
    })),
  });
} catch (error) {
  console.log("=== 11) getIndexSyncOverview() 抛错 ===");
  console.log(String(error).slice(0, 400));
}

// ── 环节 5：legacy「原来的」回测（/backtest）覆盖链 ─────────────
//   与组合回测**完全不同**的数据源：信号源 = `limit_up_records`（涨停记录），
//   价格源 = `stock_daily_prices`（按每只候选股自身涨停窗 ±30/14 天 JOIN），
//   交易日历 = `index_daily`。⇒ 它**不受 `dataset_version` 约束**，
//   其「覆盖区间」= 区间内涨停记录的 min/max `limitUpDate`
//   （`shared/fieldAvailability.ts#buildFieldCoverageReport:173/219-220`）。
j("12) limit_up_records 末端与近端条数（legacy 回测的信号源）", await q(
  `select limitUpDate, count(*) as n_rows, count(distinct stockCode) as n_codes,
          max(DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s')) as last_created_utc,
          max(createdBy) as created_by
   from limit_up_records group by limitUpDate order by limitUpDate desc limit 15`,
));

j("13) legacy backtest_runs 留档（paramsJson 里的区间）", await q(
  `select id, createdAt,
          json_unquote(json_extract(paramsJson,'$.startDate')) as p_start,
          json_unquote(json_extract(paramsJson,'$.endDate')) as p_end,
          char_length(resultJson) as result_bytes
   from backtest_runs order by id desc limit 8`,
));

// ── 环节 5 续：legacy 回测「能回到哪天」的资格规则复刻 ──────────
//   规则（`server/leaderCandidates.ts:951-958`）：
//     candidateTradingDates = 区间内 distinct limitUpDate（信号日只来自涨停记录）
//     marketTradingDates    = index_daily 在 [minLimitUpDate-45, maxLimitUpDate+7] 的 distinct tradeDate
//     nextDate = marketTradingDates[idx(信号日) + observationDays]
//     `if (!nextDate) continue;`  ⇒ **最后 observationDays 个交易日永远不能当信号日**
//   ⇒ legacy 回测的可回测末日 = **日历倒数第 (observationDays+1) 个交易日**，
//      即今天（日历末端）**必然缺席**，与「数据是否同步」无关。
j("14) legacy 回测信号日资格（复刻 leaderCandidates.ts:951-958）", await q(
  `with lu as (
     select distinct limitUpDate as d from limit_up_records
      where limitUpDate >= '2025-09-01' and limitUpDate <= '2026-09-15'
   ),
   cal as (
     select distinct tradeDate as d from index_daily
      where tradeDate >= DATE_SUB('2025-09-01', INTERVAL 45 DAY)
        and tradeDate <= DATE_ADD('2026-09-15', INTERVAL 7 DAY)
   )
   select lu.d as signalDate,
          (select min(c2.d) from cal c2 where c2.d > lu.d) as nextTradingDay_obs1,
          (select count(*) from cal c3 where c3.d > lu.d) as remainingTradingDays,
          case when (select min(c2.d) from cal c2 where c2.d > lu.d) is null
               then 'EXCLUDED —— 无 T+1 观察日，if (!nextDate) continue 主动排除'
               else 'INCLUDED —— 可作信号日' end as verdict
   from lu order by lu.d desc limit 6`,
));

j("15) 09-14 信号的 T+1（= 09-15）观察数据是否就位", await q(
  `select
     (select count(distinct stockCode) from limit_up_records where limitUpDate='2026-09-14') as sig_0914_codes,
     (select count(*) from (select distinct stockCode, stockCode as c from limit_up_records where limitUpDate='2026-09-14') t
        where exists (select 1 from stock_daily_prices p where p.stockCode=t.stockCode and p.tradeDate='2026-09-15')) as sig_0914_has_obs_price,
     (select count(distinct stockCode) from limit_up_records where limitUpDate='2026-09-15') as sig_0915_codes`,
));

process.exit(0);
