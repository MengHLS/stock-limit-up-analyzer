/**
 * 用新的补缺引擎补齐窗口外的历史缺口（真实写库）。等价于网页「立即同步」按钮走的同一条代码路径。
 *
 * 用法：npx tsx docs/evidence/_run_market_sync_backfill.mts [lookbackDays]
 */
import "dotenv/config";
import { getMarketDataGapStatus, syncMarketDataGap } from "../../server/marketSync";

const lookbackDays = Number.parseInt(process.argv[2] ?? "20", 10);

const before = await getMarketDataGapStatus();
console.log("[before]", JSON.stringify({ latestDataDate: before.latestDataDate, pendingDates: before.pendingDates }));

const result = await syncMarketDataGap(new Date(), Number.isFinite(lookbackDays) ? lookbackDays : 20);

const after = await getMarketDataGapStatus();
console.log(
  JSON.stringify(
    {
      lookbackDays,
      filledDates: result.filledDates ?? [],
      failedDates: result.failedDates ?? [],
      abortedReason: result.abortedReason ?? null,
      latestDataDateBefore: before.latestDataDate,
      latestDataDateAfter: after.latestDataDate,
      pendingDatesAfter: after.pendingDates,
    },
    null,
    2,
  ),
);
process.exit((result.filledDates?.length ?? 0) > 0 ? 0 : 1);
