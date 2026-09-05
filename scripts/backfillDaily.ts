/**
 * STEP 7.3 — 全市场日线回填 CLI。
 *
 * 用法：
 *   npx tsx scripts/backfillDaily.ts --start=2019-01-01 --end=2019-12-31 --dry-run
 *   npx tsx scripts/backfillDaily.ts --start=2019-01-01 --end=2019-12-31
 *
 * 参数：
 *   --start=YYYY-MM-DD   回填起始日（含）
 *   --end=YYYY-MM-DD     回填结束日（含）
 *   --dry-run            只计算目标交易日 / 已完成 / 剩余 / 预估请求数与耗时，不请求 provider
 *   --batch-size=N       单批写入行数（默认 1000）
 *   --interval=N         provider 请求间隔 ms（默认读 TUSHARE_REQUEST_INTERVAL_MS，缺省 6000）
 *
 * 默认不直接执行全量；必须显式给出 --start / --end。
 */

import "dotenv/config";
import {
  BackfillScheduler,
  DbCheckpointStore,
  IntervalRateLimiter,
  resolveRequestIntervalMs,
  TushareMarketDataProvider,
  TushareTradingCalendarProvider,
} from "../server/backfill";
import { fetchTushareTradeCalendar } from "../server/backfill/tradingCalendar";
import { upsertStockDailyPrices } from "../server/db";

const DEFAULT_BATCH_SIZE = 1_000;

interface CliArgs {
  start?: string;
  end?: string;
  dryRun: boolean;
  batchSize: number;
  intervalMs: number;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  return {
    start: readFlag(args, "start"),
    end: readFlag(args, "end"),
    dryRun: args.includes("--dry-run"),
    batchSize: Number(readFlag(args, "batch-size") ?? DEFAULT_BATCH_SIZE),
    intervalMs: Number(readFlag(args, "interval") ?? resolveRequestIntervalMs()),
  };
}

function usage(): string {
  return [
    "用法：npx tsx scripts/backfillDaily.ts --start=YYYY-MM-DD --end=YYYY-MM-DD [--dry-run]",
    "  --start=YYYY-MM-DD   回填起始日（含，必填）",
    "  --end=YYYY-MM-DD     回填结束日（含，必填）",
    "  --dry-run            只估算，不请求 provider",
    "  --batch-size=N       单批写入行数（默认 1000）",
    "  --interval=N         provider 请求间隔 ms（默认 6000，可被 TUSHARE_REQUEST_INTERVAL_MS 覆盖）",
  ].join("\n");
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.start || !args.end) {
    console.error(usage());
    process.exit(1);
  }
  const { start, end } = args;
  if (start > end) {
    console.error("错误：--start 不能晚于 --end");
    process.exit(1);
  }

  const checkpointStore = new DbCheckpointStore();
  const scheduler = new BackfillScheduler({
    provider: new TushareMarketDataProvider(),
    calendarProvider: new TushareTradingCalendarProvider(fetchTushareTradeCalendar),
    checkpointStore,
    rateLimiter: new IntervalRateLimiter(args.intervalMs),
    upsertFn: (rows) => upsertStockDailyPrices(rows),
    config: {
      requestIntervalMs: args.intervalMs,
      batchSize: args.batchSize,
      concurrency: 1,
      suspiciousCoverageRatio: 0.9,
    },
  });

  const tradingDates = await scheduler.resolveTargetDates(start, end);
  const checkpoints = await checkpointStore.list(start, end);
  const doneStatuses = new Set(["SUCCESS", "SUSPICIOUS"]);
  const doneByDate = new Set(checkpoints.filter((cp) => doneStatuses.has(cp.status)).map((cp) => cp.tradeDate));
  const pendingDates = tradingDates.filter((date) => !doneByDate.has(date));

  console.log(`[dry-run=${args.dryRun}] 区间 ${start} ~ ${end}`);
  console.log(`  目标交易日：${tradingDates.length}`);
  console.log(`  已完成：${tradingDates.length - pendingDates.length}`);
  console.log(`  剩余：${pendingDates.length}`);
  console.log(`  预估请求数：${pendingDates.length}`);
  console.log(`  预估耗时（间隔 ${args.intervalMs}ms）：${formatDuration(pendingDates.length * args.intervalMs)}`);

  if (args.dryRun) {
    console.log("dry-run 结束，未请求 provider。");
    return;
  }

  const result = await scheduler.run(start, end);
  console.log(`回填结束：processed=${result.processedDates} totalRows=${result.totalRows} quotaStopped=${result.quotaStopped}`);
  console.log(`manifest=${JSON.stringify(result.manifest, null, 2)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
