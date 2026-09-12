/**
 * PERF-DIAG-001 → 实施验证：研究装配（`buildSampleSet`）真实链路基准。
 *
 * 目的：在同一台机器、同一个 Dataset Version、同一份变量需求下，对三个杠杆做**受控 A/B**：
 *   ① MySQL 压缩协议（连接池 `compress`）
 *   ② 列裁剪（`columnProjection`：自动派生 vs 全列）
 *   ③ 流水线并发（`pageConcurrency`）
 * 并输出真实传输行数，作为「少搬了多少数据」的证据。
 *
 * 用法（每个配置必须**独立进程**：连接池在首次 `getDb()` 时固化 compress 设置）：
 *   DB_COMPRESS=0 PERF_PRUNE=0 PERF_CONCURRENCY=1 npx tsx scripts/perfResearchAssembly.mts
 *   DB_COMPRESS=1 PERF_PRUNE=1 PERF_CONCURRENCY=3 npx tsx scripts/perfResearchAssembly.mts
 *
 * 环境变量：
 *   PERF_VERSION    指定 datasetVersionId（缺省：自动挑 READY 版本中事件数最多的）
 *   PERF_PRUNE      1 = 列裁剪（默认），0 = 全列（`SELECT *`）
 *   PERF_CONCURRENCY 流水线深度（默认 1，便于与串行基线对照）
 *   PERF_PROFILE    full（全变量目录，最坏情况）/ minimal（turnover → future_return_5d）
 *   PERF_MAX_PAGES  限制事件分页批数（0 = 全量）；用于快速扫参
 *   PERF_GUARD      列投影守卫：off（默认，排除守卫开销）/first-chunk/all
 *
 * 只读：本脚本不写任何表（只做 SELECT）。
 */

import "dotenv/config";
import { DbDatasetRegistry } from "../server/datasetRegistry/db";
import { RegistryResearchDatasetReader, type ResearchDatasetReader } from "../server/researchEngine/datasetReader";
import { ResearchVariableCatalog } from "../server/researchEngine/variables";
import { buildSampleSet } from "../server/researchEngine/sampleSet";
import type { ProjectionGuardMode } from "../server/researchEngine/columnProjection";

const DATASET_CODE = "first_limit_pullback";

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}
const PRUNE = process.env.PERF_PRUNE !== "0";
const CONCURRENCY = Math.max(1, envNumber("PERF_CONCURRENCY", 1));
const MAX_PAGES = Math.max(0, envNumber("PERF_MAX_PAGES", 0));
const PROFILE = (process.env.PERF_PROFILE ?? "full").toLowerCase();
const GUARD = (process.env.PERF_GUARD ?? "off") as ProjectionGuardMode;
const VERSION_ARG = Number(process.env.PERF_VERSION) || undefined;
const COMPRESS = process.env.DB_COMPRESS !== "0";

interface TransferStats {
  eventPages: number;
  eventRows: number;
  prefixRows: number;
  pathRows: number;
  outcomeRows: number;
}

/** 包一层统计 + 页数上限；`maxPages` 用于把长跑压成可扫参的短跑（不改变生产代码）。 */
function instrument(inner: ResearchDatasetReader, maxPages: number): { reader: ResearchDatasetReader; stats: TransferStats } {
  const stats: TransferStats = { eventPages: 0, eventRows: 0, prefixRows: 0, pathRows: 0, outcomeRows: 0 };
  const reader: ResearchDatasetReader = {
    getVersionContext: (id) => inner.getVersionContext(id),
    loadEventPage: async (query) => {
      if (maxPages > 0 && stats.eventPages >= maxPages) return { items: [], nextCursor: null };
      stats.eventPages += 1;
      const page = await inner.loadEventPage(query);
      stats.eventRows += page.items.length;
      return page;
    },
    loadOutcomes: async (query) => {
      const rows = await inner.loadOutcomes(query);
      stats.outcomeRows += rows.length;
      return rows;
    },
    loadPaths: async (query) => {
      const rows = await inner.loadPaths(query);
      stats.pathRows += rows.length;
      return rows;
    },
    loadPrefixBars: async (query) => {
      const rows = await inner.loadPrefixBars(query);
      stats.prefixRows += rows.length;
      return rows;
    },
  };
  return { reader, stats };
}

async function resolveVersionId(registry: DbDatasetRegistry): Promise<number> {
  if (VERSION_ARG) return VERSION_ARG;
  const definitions = await registry.listDefinitions();
  const target = definitions.find((d) => d.datasetCode === DATASET_CODE);
  if (!target?.id) throw new Error(`未找到 datasetCode=${DATASET_CODE} 的定义`);
  const versions = await registry.listVersions(target.id);
  const ready = versions.filter((v) => v.status === "READY");
  if (ready.length === 0) throw new Error(`datasetCode=${DATASET_CODE} 没有 READY 版本`);
  ready.sort((a, b) => (b.totalEvents ?? 0) - (a.totalEvents ?? 0));
  return ready[0]!.id!;
}

async function main(): Promise<void> {
  const registry = new DbDatasetRegistry();
  const datasetVersionId = await resolveVersionId(registry);
  const baseReader = new RegistryResearchDatasetReader({ registryRepo: registry });

  // 版本上下文（含真实视界）——装配本身不调用它，故计时从它之后开始。
  const context = await baseReader.getVersionContext(datasetVersionId);
  if (!context) throw new Error(`Dataset Version ${datasetVersionId} 不存在`);
  const pathHorizons = context.pathRelativeDayRange
    ? Array.from({ length: context.pathRelativeDayRange.max }, (_, i) => i + 1)
    : [];
  const catalog = new ResearchVariableCatalog(context.horizons, pathHorizons);

  const requirement = PROFILE === "minimal"
    ? { features: ["turnover"], outcomes: ["future_return_5d"], dimensions: [] as string[] }
    : { features: catalog.listFeatures(), outcomes: catalog.listOutcomes(), dimensions: ["year", "board"] };

  const { reader, stats } = instrument(baseReader, MAX_PAGES);

  const startedAt = Date.now();
  const result = await buildSampleSet({
    reader,
    datasetVersionId,
    catalog,
    requirement,
    dimensionKeys: requirement.dimensions,
    pageConcurrency: CONCURRENCY,
    projectionGuard: GUARD,
    ...(PRUNE ? {} : { columnProjection: "all" as const }),
  });
  const wallMs = Date.now() - startedAt;

  const totalRows = stats.prefixRows + stats.pathRows + stats.outcomeRows + stats.eventRows;
  console.log(JSON.stringify({
    label: `${COMPRESS ? "compress" : "raw"}/prune=${PRUNE ? "on" : "off"}/conc=${CONCURRENCY}`,
    compress: COMPRESS,
    prune: PRUNE,
    concurrency: CONCURRENCY,
    guard: GUARD,
    profile: PROFILE,
    maxPages: MAX_PAGES,
    datasetVersionId,
    datasetVersionLabel: context.versionLabel,
    datasetDeclaredEvents: context.totalEvents,
    requirement: {
      features: requirement.features.length,
      outcomes: requirement.outcomes.length,
      pathDays: requirement.outcomes.length,
    },
    projection: {
      event: result.columnProjection.event.length,
      prefix: result.columnProjection.prefix.length,
      path: result.columnProjection.path.length,
      outcome: result.columnProjection.outcome.length,
      prefixColumns: result.columnProjection.prefix,
      pathColumns: result.columnProjection.path,
    },
    transfer: stats,
    totalRows,
    result: {
      eventCount: result.eventCount,
      chunkCount: result.chunkCount,
      sampleCount: result.samples.length,
      buildMs: result.buildMs,
      wallMs,
      rowsPerSecond: Math.round(totalRows / (wallMs / 1000)),
    },
  }, null, 2));

  // 硬约束：装配结果必须非空（否则「快」没有意义）
  if (result.samples.length === 0) {
    console.error("[perf] 警告：装配结果为空，此基准无意义");
    process.exit(2);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("[perf] 失败：", error);
  process.exit(1);
});
