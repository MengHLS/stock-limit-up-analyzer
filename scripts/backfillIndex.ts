/**
 * STEP 12 WORK F — 指数主数据 + 指数日线回填 CLI。
 *
 * 用法：
 *   npx tsx scripts/backfillIndex.ts --dry-run
 *   npx tsx scripts/backfillIndex.ts --index=000001.SH,399001.SZ,000300.SH,000905.SH
 *   npx tsx scripts/backfillIndex.ts --provider=sina --index=000001.SH,399001.SZ
 *   npx tsx scripts/backfillIndex.ts --provider=baostock --start=2019-01-01 --end=2026-09-04
 *   npx tsx scripts/backfillIndex.ts --provider=tushare --index=000001.SH --start=2019-01-01 --end=2026-09-06
 *
 * 参数：
 *   --index=code1,code2   指数列表（默认核心 4 只：000001.SH,399001.SZ,000300.SH,000905.SH）
 *   --provider=name       数据源 tushare | sina | baostock（默认 tushare）
 *   --start=YYYY-MM-DD    回填起始日（默认 2019-01-01）
 *   --end=YYYY-MM-DD      回填结束日（默认今天）
 *   --dry-run             只探测 + 估算，不写库
 *   --force               跳过 resume 检查，强制重拉并覆盖（如 BaoStock 全量覆盖 Sina）
 *   --interval=ms         指数间请求间隔（默认 0；tushare 建议 >=65000 以避免 1/min 限频）
 *   --allow-unknown       允许回填不在核心指数参考表的指数（默认拒绝）
 *
 * resume 语义：指数日线一次请求覆盖全区间，upsert 幂等（uq_index_daily_code_date）；
 * 已覆盖整个 [--start, --end] 区间的指数自动跳过（Checkpoint），中断后重跑即可续；
 * 缺口（如 Sina 仅 2022 起）不会被误判为已回填。
 *
 * 已知配额（Tushare index_daily）：5 次/天 + 1 次/分钟，限频会 40203。
 * 限频严重时应改用 --provider=sina（HTTP，宽松限频；但仅最近约 1023 个交易日、amount 恒 null）
 * 或 --provider=baostock（免费无配额，可拉全历史；需 MARKETDATA_PYTHON 指向已装 baostock 的 Python）。
 */

import "dotenv/config";
import { CORE_INDEX_IDENTITY, verifyIndexIdentity } from "../server/marketData/indexes";
import {
  buildIndexMasterEntry,
  getIndexDailyCoverage,
  upsertIndexDaily,
  upsertIndexMaster,
} from "../server/marketData/indexStorage";
import { indexProviders } from "../server/marketData/providers";
import { toBaostockCode } from "../server/marketData/providers/baostock";
import { toSinaSymbol } from "../server/marketData/providers/sina";
import { normalizeIndexCode } from "../server/marketData/indexes";
import type { IndexDailyBar, IndexMasterEntry } from "../server/marketData/types";

const DEFAULT_INDEXES = ["000001.SH", "399001.SZ", "000300.SH", "000905.SH"];
const DEFAULT_START = "2019-01-01";

interface CliArgs {
  indexes: string[];
  provider: string;
  start: string;
  end: string;
  dryRun: boolean;
  force: boolean;
  intervalMs: number;
  allowUnknown: boolean;
}

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** provider 原生代码（tushare 直接使用规范化代码，sina/baostock 各有独立映射）。 */
function providerCodeFor(providerName: string, indexCode: string): string {
  if (providerName === "sina") return toSinaSymbol(indexCode);
  if (providerName === "baostock") return toBaostockCode(indexCode);
  return indexCode;
}

/** provider 数据来源描述（写入 index_master.source）。 */
function providerSource(providerName: string): string {
  if (providerName === "sina") return "sina getKLineData";
  if (providerName === "baostock") return "baostock query_history_k_data_plus (index)";
  return "tushare index_daily";
}

function parseArgs(args: string[]): CliArgs {
  const raw = readFlag(args, "index");
  return {
    indexes: raw
      ? raw.split(",").map((s) => s.trim()).filter(Boolean).map(normalizeIndexCode)
      : DEFAULT_INDEXES,
    provider: readFlag(args, "provider") ?? "tushare",
    start: readFlag(args, "start") ?? DEFAULT_START,
    end: readFlag(args, "end") ?? todayIso(),
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    intervalMs: Number(readFlag(args, "interval") ?? 0),
    allowUnknown: args.includes("--allow-unknown"),
  };
}

function usage(): string {
  return [
    "用法：npx tsx scripts/backfillIndex.ts [--index=...] [--provider=tushare|sina|baostock] [--dry-run]",
    "  --index=code1,code2   指数列表（默认 000001.SH,399001.SZ,000300.SH,000905.SH）",
    "  --provider=name       数据源 tushare | sina | baostock（默认 tushare）",
    "  --start=YYYY-MM-DD    回填起始日（默认 2019-01-01）",
    "  --end=YYYY-MM-DD      回填结束日（默认今天）",
    "  --dry-run             只探测 + 估算，不写库",
    "  --force               跳过 resume 检查，强制重拉并覆盖（如 BaoStock 全量覆盖 Sina）",
    "  --interval=ms         指数间请求间隔（默认 0；tushare 建议 >=65000）",
    "  --allow-unknown       允许回填不在核心指数参考表的指数",
  ].join("\n");
}

type IndexBackfillOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "persisted"; bars: IndexDailyBar[]; entry: IndexMasterEntry }
  | { kind: "rejected"; reason: string }
  | { kind: "failed"; message: string };

/** 判断已有覆盖是否「够新」：最后交易日与 end 相差 <= 30 天（覆盖周末/长假），视为最新可跳过。 */
function isCoverageFresh(lastDate: string | null, end: string): boolean {
  if (!lastDate) return false;
  const lastMs = new Date(`${lastDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T00:00:00Z`).getTime();
  if (Number.isNaN(lastMs) || Number.isNaN(endMs)) return false;
  return (endMs - lastMs) / 86_400_000 <= 30;
}

/**
 * 判断已有覆盖是否已覆盖请求区间 [start, end]：
 *   - 首日不晚于 start 超过 30 天（容忍 start 落在节假日，如 2019-01-01 首个交易日为 2019-01-02）；
 *   - 末日距 end <= 30 天（isCoverageFresh）。
 * 用于 resume：只有区间真正覆盖时才跳过，缺口（如 Sina 仅 2022 起）不会被误判为「已回填」。
 */
function isCoverageComplete(
  coverage: { firstDate: string | null; lastDate: string | null },
  start: string,
  end: string,
): boolean {
  const { firstDate, lastDate } = coverage;
  if (!firstDate || !lastDate) return false;
  const firstMs = new Date(`${firstDate}T00:00:00Z`).getTime();
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  if (Number.isNaN(firstMs) || Number.isNaN(startMs)) return false;
  return firstMs - startMs <= 30 * 86_400_000 && isCoverageFresh(lastDate, end);
}

interface RunStats {
  requested: number;
  received: number;
  persisted: number;
  rejected: number;
  failed: number;
  checkpoint: number;
}

async function backfillOne(
  indexCode: string,
  providerName: string,
  start: string,
  end: string,
  allowUnknown: boolean,
  force: boolean,
): Promise<IndexBackfillOutcome> {
  const provider = indexProviders[providerName];
  if (!provider) {
    return { kind: "rejected", reason: `未知 provider：${providerName}（可选 ${Object.keys(indexProviders).join("|")}）` };
  }

  const reference = CORE_INDEX_IDENTITY[indexCode];
  if (!reference && !allowUnknown) {
    return { kind: "rejected", reason: `指数 ${indexCode} 不在核心指数参考表，身份无法确认（--allow-unknown 可覆盖）` };
  }

  // resume：已回填且覆盖整个请求区间 [start, end] 的指数跳过请求（幂等 upsert 保证重复跑不产生重复行）。
  // --force 跳过检查（如 BaoStock 全量覆盖 Sina，即使区间已覆盖也重拉）。
  const coverage = await getIndexDailyCoverage(indexCode);
  if (!force && coverage.rowCount > 0 && isCoverageComplete(coverage, start, end)) {
    return { kind: "skipped", reason: `已回填 ${coverage.rowCount} 行（${coverage.firstDate} ~ ${coverage.lastDate}），覆盖请求区间，无需重复拉取` };
  }

  let bars: IndexDailyBar[];
  try {
    bars = await provider.fetchDaily(indexCode, start, end);
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
  }

  if (bars.length === 0) {
    return { kind: "rejected", reason: "provider 返回空数据" };
  }

  const indexName = reference?.indexName ?? "";
  const providerCode = providerCodeFor(providerName, indexCode);
  const entry = buildIndexMasterEntry({
    indexCode,
    indexName,
    provider: providerName,
    providerCode,
    bars,
    source: providerSource(providerName),
  });

  // 身份校验（CONCERN 记录告警、BLOCKED 拒绝；核心指数不会被 BLOCKED）。
  const verdict = verifyIndexIdentity(entry);
  if (verdict.verdict === "BLOCKED" && !allowUnknown) {
    return { kind: "rejected", reason: verdict.issues.map((i) => i.message).join("; ") };
  }

  return { kind: "persisted", bars, entry };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.start > args.end) {
    console.error("错误：--start 不能晚于 --end");
    process.exit(1);
  }
  if (!indexProviders[args.provider]) {
    console.error(`错误：未知 provider "${args.provider}"，可选 ${Object.keys(indexProviders).join("|")}`);
    console.error(usage());
    process.exit(1);
  }

  console.log(`[dry-run=${args.dryRun}] 指数回填 provider=${args.provider} 区间 ${args.start} ~ ${args.end}`);
  console.log(`  指数：${args.indexes.join(", ")}`);

  const stats: RunStats = { requested: 0, received: 0, persisted: 0, rejected: 0, failed: 0, checkpoint: 0 };
  const toPersistMaster: IndexMasterEntry[] = [];
  const toPersistDaily: IndexDailyBar[] = [];
  const details: Array<{ indexCode: string; outcome: IndexBackfillOutcome }> = [];

  for (let i = 0; i < args.indexes.length; i += 1) {
    const indexCode = args.indexes[i]!;
    stats.requested += 1;
    const outcome = await backfillOne(indexCode, args.provider, args.start, args.end, args.allowUnknown, args.force);
    details.push({ indexCode, outcome });

    switch (outcome.kind) {
      case "skipped":
        stats.checkpoint += 1;
        console.log(`  [skip] ${indexCode}: ${outcome.reason}`);
        break;
      case "rejected":
        stats.rejected += 1;
        console.log(`  [reject] ${indexCode}: ${outcome.reason}`);
        break;
      case "failed":
        stats.failed += 1;
        console.log(`  [fail] ${indexCode}: ${outcome.message}`);
        break;
      case "persisted": {
        stats.received += 1;
        const { firstDate, lastDate } = (() => {
          const dates = outcome.bars.map((b) => b.tradeDate).sort();
          return { firstDate: dates[0], lastDate: dates[dates.length - 1] };
        })();
        console.log(`  [ok] ${indexCode}: ${outcome.bars.length} bars (${firstDate} ~ ${lastDate}) name=${outcome.entry.indexName || "-"}`);
        toPersistMaster.push(outcome.entry);
        toPersistDaily.push(...outcome.bars);
        break;
      }
    }

    // 指数间节流（tushare 1/min 限频需要 >=65000ms）。
    if (args.intervalMs > 0 && i < args.indexes.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
    }
  }

  console.log(`\n统计：Requested=${stats.requested} Received=${stats.received} Rejected=${stats.rejected} Failed=${stats.failed} Checkpoint=${stats.checkpoint}`);

  if (args.dryRun) {
    console.log("dry-run 结束，未写库。");
    return;
  }

  const persistedMaster = await upsertIndexMaster(toPersistMaster);
  const persistedDaily = await upsertIndexDaily(toPersistDaily);
  stats.persisted = persistedDaily;

  console.log(`落库：index_master=${persistedMaster} index_daily=${persistedDaily}`);
  console.log(`\n最终统计：Requested=${stats.requested} Received=${stats.received} Persisted=${stats.persisted} Rejected=${stats.rejected} Failed=${stats.failed} Checkpoint=${stats.checkpoint}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("回填失败：", error);
    process.exit(1);
  });
