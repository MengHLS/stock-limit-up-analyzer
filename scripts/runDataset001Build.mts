/**
 * STEP DATASET-001 — 首板回踩 Dataset 真实 DB 构建 CLI。
 *
 * 编排链：DatasetRegistryService（定义/版本/作业）→ FirstLimitPullbackDatasetBuilder
 * （events 逐日 keyset + paths/outcomes 按 event cursor）→ DbDatasetBuildIO（push-down + 幂等 upsert）。
 *
 * 用法（需项目根 .env 的 DATABASE_URL）：
 *   # 冒烟（小窗口，默认口径 = 全板块 / 含 ST / T 日首板 / t-0..t+20）：
 *   npx tsx scripts/runDataset001Build.mts --from=2024-01-02 --to=2024-01-10 --version=v1
 *   # 正式 benchmark（全历史 + 自定义筛选口径）：
 *   npx tsx scripts/runDataset001Build.mts --from=2019-01-02 --to=2026-09-04 --version=v1 \
 *     --boards=main,chinext --exclude-st --events=0:firstBoard,-1:consecutiveBoard \
 *     --pre=5 --post=20 --outcome-horizons=5,10,20 --batch-size=1000
 *   # 兼容旧名：--path-horizon=N 等价于 --post=N
 *   # resume（崩溃续跑，jobId 见上次输出）：
 *   npx tsx scripts/runDataset001Build.mts --from=... --to=... --version=v1 --resume=<jobId>
 *   # 只查看状态：
 *   npx tsx scripts/runDataset001Build.mts --list
 *
 * 重要（DATASET-003B）：构建配置**不在本脚本内手工拼装**，一律从「该版本已固化的筛选配置」
 * 解析（`service.resolveBuildConfigForVersion`），保证 CLI 与产品路径（runner）永不分叉。
 * 因此对已存在的版本改 flag 不会改变其口径 —— 需要新口径请用新的 version 标签。
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
  /** 板块筛选（逗号分隔；空 = 全板块）。 */
  boards: string[];
  /** 排除 ST/*ST（PIT 状态）。 */
  excludeSt: boolean;
  /** 事件维度（`相对日:类型` 逗号分隔，如 `0:firstBoard,-1:consecutiveBoard`）。 */
  events: { relativeDay: number; kind: string }[];
  preWindowDays: number;
  postWindowDays: number;
  outcomeHorizons: number[];
  batchSize: number;
  resumeJobId: string | null;
  list: boolean;
  out: string;
}

function parseArgs(args: string[]): CliArgs {
  const horizonRaw = readFlag(args, "outcome-horizons") ?? "5,10,20";
  const boardsRaw = readFlag(args, "boards") ?? "";
  // 事件维度：缺省 = T 日首板（与权威默认一致）；`--events=0:firstBoard,-1:limitUp`
  const eventsRaw = readFlag(args, "events") ?? "0:firstBoard";
  // `--path-horizon` 为 DATASET-003B 之前的旧名，保留为 `--post` 的兼容别名。
  const postRaw = readFlag(args, "post") ?? readFlag(args, "path-horizon") ?? "20";
  return {
    from: readFlag(args, "from") ?? "",
    to: readFlag(args, "to") ?? "",
    version: readFlag(args, "version") ?? "v1",
    boards: boardsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    excludeSt: readFlag(args, "exclude-st") === "true" || args.includes("--exclude-st"),
    events: eventsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const [day, kind] = s.split(":");
        return { relativeDay: Number(day), kind: (kind ?? "firstBoard").trim() };
      }),
    preWindowDays: Number(readFlag(args, "pre") ?? "0"),
    postWindowDays: Number(postRaw),
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
    // DATASET-003B：筛选 + 执行参数以单一 `filter` 固化（不再写 universeDefinition/filterDefinition 手拼 JSON）。
    filter: {
      boards: args.boards,
      excludeSt: args.excludeSt,
      events: args.events,
      preWindowDays: args.preWindowDays,
      postWindowDays: args.postWindowDays,
      outcomeHorizons: args.outcomeHorizons,
      batchSize: args.batchSize,
    },
  });
  console.log("已创建 Dataset Version id=%s version=%s", version.id, args.version);
} else {
  console.log("复用已有 Version id=%s version=%s status=%s", version.id, version.version, version.status);
}

// 3. 构建作业（新 job 或 resume）。
let job = args.resumeJobId ? await registry.getJob(args.resumeJobId) : undefined;
if (!job) {
  job = await service.createJob(version.id!); // PENDING
}
if (job.status === "PENDING") {
  job = await service.startJob(job.jobId); // RUNNING
  await service.markBuilding(version.id!); // version → BUILDING
} else if (job.status !== "RUNNING") {
  console.error("无法启动构建作业 %s（status=%s）", job.jobId, job.status);
  process.exit(1);
}
const jobId = job.jobId;

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
  // DATASET-003B：**不再手工拼装构建配置**，一律从「已固化的版本筛选配置」解析
  // （配置行 → legacy 镜像 → 权威默认）。这样 CLI 与产品路径（runner）不可能漂移。
  const resolved = await service.resolveBuildConfigForVersion(version.id!);
  console.log(
    "  已固化筛选口径: boards=[%s] excludeSt=%s events=[%s] t-%d..t+%d horizons=%s batchSize=%s",
    resolved.boards.join(",") || "全板块",
    resolved.excludeSt,
    resolved.events.map((e) => `${e.relativeDay}:${e.kind}`).join(","),
    resolved.preWindowDays,
    resolved.postWindowDays,
    resolved.outcomeHorizons.join(","),
    resolved.batchSize,
  );
  result = await builder.build({
    datasetVersionId: version.id!,
    startDate: resolved.startDate,
    endDate: resolved.endDate,
    boards: resolved.boards,
    excludeSt: resolved.excludeSt,
    events: resolved.events,
    preWindowDays: resolved.preWindowDays,
    postWindowDays: resolved.postWindowDays,
    outcomeHorizons: resolved.outcomeHorizons,
    batchSize: resolved.batchSize,
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
// 行数口径 = 五张物理表之和（与 DatasetVersionCounts.rowCount / 前端「实际行数」一致）。
const totalRows = result.events + result.prefixes + result.posts + result.paths + result.outcomes;
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
  filter: {
    boards: args.boards,
    excludeSt: args.excludeSt,
    events: args.events,
    preWindowDays: args.preWindowDays,
    postWindowDays: args.postWindowDays,
    outcomeHorizons: args.outcomeHorizons,
    batchSize: args.batchSize,
  },
  counts: {
    events: result.events,
    prefixes: result.prefixes,
    posts: result.posts,
    paths: result.paths,
    outcomes: result.outcomes,
    totalRows,
  },
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
console.log("  前置行情  : %d", result.prefixes);
console.log("  后置行情  : %d", result.posts);
console.log("  路径衍生  : %d", result.paths);
console.log("  未来结果  : %d", result.outcomes);
console.log("  总行数    : %d（processedRows=%s）", totalRows, result.processedRows);
console.log("  吞吐      : %s rows/s，%s events/s", report.throughput.rowsPerSec, report.throughput.eventsPerSec);
console.log("  报告输出  : %s", args.out);

process.exit(0);
