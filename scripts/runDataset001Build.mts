/**
 * STEP DATASET-001 — 首板回踩 Dataset 真实 DB 构建 CLI。
 *
 * 编排链：DatasetRegistryService（定义/版本/作业）→ FirstLimitPullbackDatasetBuilder
 * （events 逐日 keyset + paths/outcomes 按 event cursor）→ DbDatasetBuildIO（push-down + 幂等 upsert）。
 *
 * 用法（需项目根 .env 的 DATABASE_URL）：
 *   # 冒烟（小窗口）：
 *   npx tsx scripts/runDataset001Build.mts --from=2024-01-02 --to=2024-01-10 --version=v1
 *   # 正式 benchmark（全历史）：
 *   npx tsx scripts/runDataset001Build.mts --from=2019-01-02 --to=2026-09-04 --version=v1 \
 *     --path-horizon=20 --outcome-horizons=5,10,20 --batch-size=1000
 *   # resume（崩溃续跑，jobId 见上次输出）：
 *   npx tsx scripts/runDataset001Build.mts --from=... --to=... --version=v1 --resume=<jobId>
 *   # 只查看状态：
 *   npx tsx scripts/runDataset001Build.mts --list
 *
 * 幂等：Build(v1) 重复执行走 ON DUPLICATE KEY，不产生重复行；
 * 版本隔离：所有行带 datasetVersionId，v1/v2 物理同表、逻辑隔离。
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getDb } from "../server/db";
import {
  DbDatasetBuildIO,
  DbDatasetRegistry,
  DatasetRegistryService,
  FirstLimitPullbackDatasetBuilder,
} from "../server/datasetRegistry";
import type { DatasetBuildCheckpoint } from "../server/datasetRegistry";

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

interface CliArgs {
  from: string;
  to: string;
  version: string;
  pathHorizon: number;
  outcomeHorizons: number[];
  batchSize: number;
  resumeJobId: string | null;
  list: boolean;
  out: string;
}

function parseArgs(args: string[]): CliArgs {
  const horizonRaw = readFlag(args, "outcome-horizons") ?? "5,10,20";
  return {
    from: readFlag(args, "from") ?? "",
    to: readFlag(args, "to") ?? "",
    version: readFlag(args, "version") ?? "v1",
    pathHorizon: Number(readFlag(args, "path-horizon") ?? "20"),
    outcomeHorizons: horizonRaw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0),
    batchSize: Number(readFlag(args, "batch-size") ?? "1000"),
    resumeJobId: readFlag(args, "resume") ?? null,
    list: args.includes("--list"),
    out: resolve(readFlag(args, "out") ?? "docs/dataset001/report.json"),
  };
}

const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}

const registry = new DbDatasetRegistry();
const service = new DatasetRegistryService(registry);

async function listStatus(): Promise<void> {
  const definitions = await registry.listDefinitions();
  console.log("=== Dataset Definitions ===");
  for (const d of definitions) {
    console.log(`  id=${d.id} code=${d.datasetCode} type=${d.datasetType} status=${d.status}`);
    console.log(`     tables: ${d.eventTableName} / ${d.pathTableName} / ${d.outcomeTableName}`);
    const versions = await registry.listVersions(d.id!);
    for (const v of versions) {
      console.log(`     version=${v.version} id=${v.id} status=${v.status} events=${v.totalEvents ?? "-"} rows=${v.totalRows ?? "-"} [${v.startDate}..${v.endDate}]`);
      const jobs = await registry.listJobs(v.id!);
      for (const j of jobs) {
        console.log(`       job=${j.jobId} status=${j.status} processed=${j.processedRows ?? 0} chunks=${j.completedChunks ?? 0}`);
      }
    }
  }
}

if (args.list) {
  await listStatus();
  process.exit(0);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
  console.error("必须提供 --from 与 --to（YYYY-MM-DD）");
  process.exit(1);
}

const DATASET_CODE = "first_limit_pullback";

// 1. 确保 Definition 存在（幂等）。
let definition = await registry.getDefinitionByCode(DATASET_CODE);
if (!definition) {
  definition = await service.createDefinition({
    datasetCode: DATASET_CODE,
    name: "首板回踩事件数据集",
    description: "A 股首板（首次涨停）事件 + 未来 N 交易日路径 + horizon 结果；事件只描述客观事实，不绑定策略。",
    datasetType: "EVENT",
    storageType: "DATABASE",
  });
  console.log("已创建 Dataset 定义 id=%s", definition.id);
}

// 2. 确保 Version 存在（幂等；已存在则复用，不重建）。
let version = await registry.getVersion(definition.id!, args.version);
if (!version) {
  version = await service.createVersion({
    datasetId: definition.id!,
    version: args.version,
    startDate: args.from,
    endDate: args.to,
    universeDefinition: { universe: "all-a-shares", source: "stock_daily_prices" },
    filterDefinition: { board: "first-limit-pullback", rules: "boardRules" },
    featureVersion: "1",
    sourceVersion: "1",
  });
  console.log("已创建 Dataset Version id=%s version=%s", version.id, args.version);
} else {
  console.log("复用已有 Version id=%s version=%s status=%s", version.id, version.version, version.status);
}

// 3. 构建作业（新 job 或 resume）。
const jobId = args.resumeJobId ?? `ds001-${args.version}-${Date.now()}`;
let job = args.resumeJobId ? await registry.getJob(args.resumeJobId) : undefined;
if (!job) {
  job = await service.startJob({ datasetVersionId: version.id!, jobId });
}
await service.markBuilding(version.id!);

// resume checkpoint：从 job.lastCursor 反序列化。
let resumeCheckpoint: DatasetBuildCheckpoint | null = null;
if (args.resumeJobId && job.lastCursor) {
  try {
    resumeCheckpoint = JSON.parse(job.lastCursor) as DatasetBuildCheckpoint;
    console.log("resume checkpoint：phase=%s lastTradeDate=%s lastEventId=%s processedRows=%s",
      resumeCheckpoint.phase, resumeCheckpoint.lastTradeDate, resumeCheckpoint.lastEventId, resumeCheckpoint.processedRows);
  } catch {
    resumeCheckpoint = null;
  }
}

// 4. 构建。
const io = new DbDatasetBuildIO();
const builder = new FirstLimitPullbackDatasetBuilder(io, { batchSize: args.batchSize });

const startedAt = Date.now();
let lastLog = Date.now();

const reportProgress = async (checkpoint: DatasetBuildCheckpoint): Promise<void> => {
  await service.updateJobProgress(jobId, {
    status: "RUNNING",
    lastTradeDate: checkpoint.lastTradeDate,
    lastSymbol: checkpoint.lastSymbol,
    lastCursor: JSON.stringify(checkpoint),
    processedRows: checkpoint.processedRows,
    completedChunks: checkpoint.completedChunks,
    totalChunks: null,
  });
  // 每 2s 打一次进度。
  if (Date.now() - lastLog > 2000) {
    lastLog = Date.now();
    console.log("  [%s] %s tradeDate=%s eventId=%s processedRows=%s chunks=%s",
      ((Date.now() - startedAt) / 1000).toFixed(1) + "s",
      checkpoint.phase,
      checkpoint.lastTradeDate ?? "-",
      checkpoint.lastEventId ?? "-",
      checkpoint.processedRows,
      checkpoint.completedChunks);
  }
};

let result;
try {
  result = await builder.build({
    datasetVersionId: version.id!,
    startDate: args.from,
    endDate: args.to,
    pathHorizon: args.pathHorizon,
    outcomeHorizons: args.outcomeHorizons,
    batchSize: args.batchSize,
    resumeCheckpoint,
  }, reportProgress);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  await service.failJob(jobId, msg);
  await service.markFailed(version.id!);
  console.error("构建失败：%s", msg);
  process.exit(1);
}

// 5. 完成。
const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
const totalRows = result.paths + result.outcomes;
await service.completeJob(jobId);
await service.markReady(version.id!, { totalEvents: result.events, totalRows: totalRows });

// 6. 报告。
const report = {
  datasetCode: DATASET_CODE,
  version: args.version,
  versionId: version.id,
  jobId,
  status: result.status,
  window: { from: args.from, to: args.to },
  pathHorizon: args.pathHorizon,
  outcomeHorizons: args.outcomeHorizons,
  counts: { events: result.events, paths: result.paths, outcomes: result.outcomes, totalRows },
  processedRows: result.processedRows,
  failedRows: result.failedRows,
  chunks: result.chunks,
  elapsedSec: Number(elapsedSec),
  throughput: {
    rowsPerSec: Number((totalRows / Math.max(0.001, Number(elapsedSec))).toFixed(1)),
    eventsPerSec: Number((result.events / Math.max(0.001, Number(elapsedSec))).toFixed(1)),
  },
};

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify(report, null, 2), "utf8");

console.log("");
console.log("=== STEP DATASET-001 构建完成（%ss）===", elapsedSec);
console.log("  定义      : %s (id=%s)", DATASET_CODE, definition.id);
console.log("  版本      : %s (id=%s) -> READY", args.version, version.id);
console.log("  作业      : %s -> COMPLETED", jobId);
console.log("  事件      : %d", result.events);
console.log("  路径      : %d", result.paths);
console.log("  结果      : %d", result.outcomes);
console.log("  总行数    : %d（processedRows=%s）", totalRows, result.processedRows);
console.log("  吞吐      : %s rows/s，%s events/s", report.throughput.rowsPerSec, report.throughput.eventsPerSec);
console.log("  报告输出  : %s", args.out);

process.exit(0);
