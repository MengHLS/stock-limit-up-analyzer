/**
 * STEP 7.3 — 全市场日线回填 CLI（provider-aware）。
 *
 * 用法：
 *   npx tsx scripts/backfillDaily.ts --start=2019-01-01 --end=2019-12-31 --dry-run
 *   npx tsx scripts/backfillDaily.ts --start=2026-09-05 --end=2026-10-06
 *   npx tsx scripts/backfillDaily.ts --provider=baostock --start=2026-09-05 --end=2026-10-06
 *
 * 参数：
 *   --provider=tushare|baostock  取数 provider（默认 tushare）
 *   --start=YYYY-MM-DD   回填起始日（含）
 *   --end=YYYY-MM-DD     回填结束日（含）
 *   --dry-run            只计算目标交易日 / 已完成 / 剩余 / 预估请求数与耗时，不请求 provider
 *   --batch-size=N       单批写入行数（默认 1000）
 *   --interval=N         请求间隔 ms（tushare 默认读 TUSHARE_REQUEST_INTERVAL_MS，缺省 6000；
 *                        baostock 默认 350，贴近免费接口 ~1.4 req/s）
 *   --codes=a,b.cd       仅回填显式证券（provider-neutral 规范化代码，如 600000.SH）
 *   --limit=N            仅回填 universe 前 N 只（smoke / 试跑用）
 *   --progress-file=path baostock 逐票取数进度文件（默认 scripts/_scratch/ 下按区间命名）
 *
 * 默认不直接执行全量；必须显式给出 --start / --end。
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import {
  BackfillScheduler,
  BaoStockMarketDataProvider,
  DbCheckpointStore,
  IntervalRateLimiter,
  TushareMarketDataProvider,
  TushareTradingCalendarProvider,
  type BaoStockDailyRow,
  type MarketDataProvider,
  resolveRequestIntervalMs,
} from "../server/backfill";
import { fetchCanonicalTradingCalendar } from "../server/backfill/tradingCalendar";
import { getDb, upsertStockDailyPrices } from "../server/db";
import { researchSecurityIdentifierHistory } from "../drizzle/schema";
import { closeSharedBaostockSession, getSharedBaostockSession } from "../server/marketData/providers/baostockSession";

const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_BAOSTOCK_INTERVAL_MS = 350;

type ProviderName = "tushare" | "baostock";

interface CliArgs {
  provider: ProviderName;
  start?: string;
  end?: string;
  dryRun: boolean;
  batchSize: number;
  intervalMs: number;
  codes?: string[];
  limit: number;
  progressFile?: string;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function parseArgs(args: string[]): CliArgs {
  const providerRaw = readFlag(args, "provider") ?? "tushare";
  if (providerRaw !== "tushare" && providerRaw !== "baostock") {
    throw new Error(`未知 provider：${providerRaw}（仅支持 tushare / baostock）`);
  }
  const intervalRaw = readFlag(args, "interval");
  const codesRaw = readFlag(args, "codes");
  return {
    provider: providerRaw,
    start: readFlag(args, "start"),
    end: readFlag(args, "end"),
    dryRun: args.includes("--dry-run"),
    batchSize: Number(readFlag(args, "batch-size") ?? DEFAULT_BATCH_SIZE),
    intervalMs:
      intervalRaw === undefined
        ? providerRaw === "baostock"
          ? DEFAULT_BAOSTOCK_INTERVAL_MS
          : resolveRequestIntervalMs()
        : Number(intervalRaw),
    codes: codesRaw ? codesRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    limit: Number(readFlag(args, "limit") ?? 0),
    progressFile: readFlag(args, "progress-file"),
  };
}

function usage(): string {
  return [
    "用法：npx tsx scripts/backfillDaily.ts --start=YYYY-MM-DD --end=YYYY-MM-DD [--provider=tushare|baostock] [--dry-run]",
    "  --provider=tushare|baostock  取数 provider（默认 tushare）",
    "  --start=YYYY-MM-DD   回填起始日（含，必填）",
    "  --end=YYYY-MM-DD     回填结束日（含，必填）",
    "  --dry-run            只估算，不请求 provider",
    "  --batch-size=N       单批写入行数（默认 1000）",
    "  --interval=N         请求间隔 ms（tushare 默认 6000；baostock 默认 350）",
    "  --codes=a,b.cd       仅回填显式证券（规范化代码，如 600000.SH）",
    "  --limit=N            仅回填 universe 前 N 只（smoke / 试跑用）",
    "  --progress-file=path baostock 逐票取数进度文件（默认按区间命名）",
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

/** 从 research_security_identifier_history 读全市场 universe（规范化 600000.SH）。 */
async function loadSecurityUniverseFromDb(): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，无法读取证券 universe");
  const rows = await db
    .selectDistinct({
      exchange: researchSecurityIdentifierHistory.exchange,
      securityCode: researchSecurityIdentifierHistory.securityCode,
    })
    .from(researchSecurityIdentifierHistory);
  return rows
    .map((row) => `${row.securityCode}.${row.exchange}`)
    .sort((a, b) => a.localeCompare(b));
}

/** 驻留会话逐票取数（login 一次，stdin/stdout JSONL）。 */
function createSessionStockDailyFetcher() {
  const session = getSharedBaostockSession();
  return async (baostockCode: string, startDate: string, endDate: string): Promise<BaoStockDailyRow[]> => {
    const rows = await session.request<BaoStockDailyRow[]>({
      cmd: "stock_daily",
      code: baostockCode,
      start: startDate,
      end: endDate,
    });
    if (!Array.isArray(rows)) throw new Error(`baostock session 返回非数组：${baostockCode}`);
    return rows;
  };
}

function defaultProgressFile(provider: ProviderName, start: string, end: string): string | undefined {
  if (provider !== "baostock") return undefined;
  return fileURLToPath(new URL(`./_scratch/_baostock_daily_progress_${start}_${end}.jsonl`, import.meta.url));
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
  const calendarProvider = new TushareTradingCalendarProvider(fetchCanonicalTradingCalendar);

  let provider: MarketDataProvider;
  let baostockProvider: BaoStockMarketDataProvider | null = null;
  let estimatedRequests: number | null = null;

  if (args.provider === "baostock") {
    const universeRaw = args.codes ?? (await loadSecurityUniverseFromDb());
    const universe = args.limit > 0 ? universeRaw.slice(0, args.limit) : universeRaw;
    const progressFilePath = args.progressFile ?? defaultProgressFile(args.provider, start, end) ?? null;
    baostockProvider = new BaoStockMarketDataProvider({
      securityCodes: universe,
      startDate: start,
      endDate: end,
      fetchStockDaily: createSessionStockDailyFetcher(),
      rateLimiter: new IntervalRateLimiter(args.intervalMs),
      progressFilePath,
      logger: { info: (m) => console.log(m), warn: (m) => console.warn(m) },
    });
    provider = baostockProvider;
    // BaoStock 无「全市场单日」端点 ⇒ 逐票请求数 = universe 数（整段区间一次取完，按日分桶）。
    estimatedRequests = universe.length;
    console.log(`  provider=baostock universe=${universe.length}（逐票整段取数，按日分桶）`);
    console.log(`  progressFile=${progressFilePath ?? "(disabled)"}`);
    console.log(`  python=${process.env.MARKETDATA_PYTHON ?? process.env.BAOSTOCK_PYTHON ?? "python"}`);
  } else {
    provider = new TushareMarketDataProvider();
  }

  const scheduler = new BackfillScheduler({
    provider,
    calendarProvider,
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

  console.log(`[provider=${args.provider} dry-run=${args.dryRun}] 区间 ${start} ~ ${end}`);
  console.log(`  目标交易日：${tradingDates.length}`);
  console.log(`  已完成：${tradingDates.length - pendingDates.length}`);
  console.log(`  剩余：${pendingDates.length}`);
  console.log(`  预估请求数：${estimatedRequests ?? pendingDates.length}`);
  console.log(`  预估耗时（间隔 ${args.intervalMs}ms）：${formatDuration((estimatedRequests ?? pendingDates.length) * args.intervalMs)}`);

  if (args.dryRun) {
    console.log("dry-run 结束，未请求 provider。");
    return;
  }

  try {
    const result = await scheduler.run(start, end);
    console.log(`回填结束：processed=${result.processedDates} totalRows=${result.totalRows} quotaStopped=${result.quotaStopped}`);
    console.log(`manifest=${JSON.stringify(result.manifest, null, 2)}`);
    if (baostockProvider) {
      const failed = baostockProvider.getFailedSecurityCodes();
      console.log(
        `baostock 逐票：completed=${baostockProvider.getCompletedSecurityCodes().size} failed=${failed.length}` +
          (failed.length > 0 ? ` (${failed.slice(0, 20).join(",")}${failed.length > 20 ? ",…" : ""})` : ""),
      );
    }
  } finally {
    await closeSharedBaostockSession();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });