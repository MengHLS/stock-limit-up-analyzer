/**
 * 指数行情同步 —— 服务层验收探针（真库只读）。
 *
 * 用途：
 *   1. 直接调用 `getIndexSyncOverview()`，验证「落后量 / 计划 / 待请求数」在真库上的真实取值；
 *   2. 打印 `index_daily` 原始覆盖与 provider 可用性，供人工核对口径；
 *   3. 复核「日历末端 vs 行情末端」—— index_daily 是纸面交易推进的交易日历唯一来源，
 *      落后即为推进空转的触发条件（PAPER-TRADING-ADVANCE-NOOP-001）。
 *
 * 只读：不写库、不发外部请求（不调用 provider.fetchDaily）。
 * 用法：npx tsx docs/evidence/_probe_index_coverage.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { CORE_INDEX_IDENTITY } from "../../server/marketData/indexes";
import { describeIndexSyncProviders, getIndexSyncOverview } from "../../server/marketData/indexSync";

const db = await getDb();
if (!db) {
  console.log(JSON.stringify({ dbAvailable: false }));
  process.exit(1);
}

type Row = Record<string, unknown>;

const master = ((await db.execute(
  sql`select indexCode, indexName, provider, providerCode, firstDate, lastDate, source, retrievedAt
      from index_master order by indexCode, provider`,
)) as unknown as [Row[]])[0] ?? [];

const daily = ((await db.execute(
  sql`select indexCode, count(*) as c, min(tradeDate) as f, max(tradeDate) as l
      from index_daily group by indexCode order by indexCode`,
)) as unknown as [Row[]])[0] ?? [];

const priceEnd = ((await db.execute(
  sql`select max(tradeDate) as lastDate, count(distinct tradeDate) as c from stock_daily_prices`,
)) as unknown as [Row[]])[0] ?? [];

console.log("=== 1) index_daily 原始覆盖 ===");
console.log(JSON.stringify(daily, null, 2));
console.log("=== 2) index_master ===");
console.log(JSON.stringify(master.map((row) => ({
  indexCode: row.indexCode, provider: row.provider, firstDate: row.firstDate, lastDate: row.lastDate,
})), null, 2));
console.log("=== 3) stock_daily_prices 末端（行情真实末端）===");
console.log(JSON.stringify(priceEnd, null, 2));

console.log("=== 4) 服务层 getIndexSyncOverview()（默认 4 只 / 默认 provider）===");
const overview = await getIndexSyncOverview({});
console.log(JSON.stringify({
  provider: overview.provider,
  marketLastDate: overview.marketLastDate,
  calendarLastDate: overview.calendarLastDate,
  lagDays: overview.lagDays,
  lagTradingDays: overview.lagTradingDays,
  calendarStale: overview.calendarStale,
  pendingIndexCount: overview.pendingIndexCount,
  window: overview.window,
  targets: overview.targets.map((target) => ({
    indexCode: target.indexCode,
    indexName: target.indexName,
    rowCount: target.rowCount,
    firstDate: target.firstDate,
    lastDate: target.lastDate,
    lagDays: target.lagDays,
    action: target.plan.action,
    range: target.plan.range,
    reason: target.plan.reason,
  })),
}, null, 2));

console.log("=== 5) provider 可用性 ===");
console.log(JSON.stringify(describeIndexSyncProviders(), null, 2));

console.log("=== 6) 核心指数参考表 ===");
console.log(JSON.stringify(Object.keys(CORE_INDEX_IDENTITY), null, 2));
process.exit(0);
