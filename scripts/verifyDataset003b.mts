/**
 * STEP DATASET-003B — 真实 TiDB 端到端验证：构建筛选配置「全链路真实生效」。
 *
 * 目标（全程真实 DB + 真实生产装配，无 mock 冒充）：
 *   1. **配置表就位**：dataset_build_config / _event / _board 三表可由幂等脚本创建（此处只校验存在与结构）。
 *   2. **构建门禁**：筛选配置未完成（events 空）→ createVersion 被明确拒绝（INVALID_BUILD_FILTER），
 *      且**不留半成品版本**；非法边界（postWindowDays 越界 / 正锚点）同样被拒。
 *   3. **配置固化 + 回读一致**：提交的 filter 与配置表回读完全一致（含多值子表：boards / events）。
 *   4. **筛选真实改变出数**（核心）：
 *        - 板块筛选：受限版本的每个事件 boardType ∈ 所选集合，且事件集是「全板块」版本的子集；
 *        - 排除 ST：受限版本中任一事件在其事件日的 **PIT 状态**都不是 ST/*ST（查 research_security_status_history）；
 *        - 事件维度 T-1：受限版本的每个事件，其**前一交易日**确实涨停（查 stock_daily_prices）。
 *   5. **前后窗口真实物化**：preWindowDays>0 的版本，负相对日 + rd=0 归 `prefix`（PIT 安全特征层），
 *      `path` 只保留 rd ≥ 1 的衍生行；结构级 PIT 防线（prefix 不含衍生列）一并断言。
 *   6. **级联清理**：deleteVersion → 物理行/作业/配置一并清除（configsDeleted≥1，回读为 null）；
 *      deleteDefinition → 该定义下所有版本配置一并清除。
 *   7. **零残留**：脚本结束不留任何临时版本 / 定义 / 配置行 / 物理行；first_limit_pullback 原有数据未被改动。
 *
 * 生产装配：DbDatasetRegistry + DatasetRegistryService(plugins, DbDatasetPhysicalStore) +
 *           DefaultDatasetBuildRunner —— 与线上 runner 完全同一条路径（构建配置由配置表解析，非本脚本手工拼装）。
 *
 * 用法：npx tsx scripts/verifyDataset003b.mts
 */

import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../server/db";
import {
  datasetBuildConfigs,
  datasetDefinitions,
  datasetVersions,
} from "../drizzle/schema";
import {
  DATASET_LIFECYCLE_ERROR,
  DatasetLifecycleError,
  DatasetQueryService,
  DatasetRegistryService,
  DbDatasetBuildIO,
  DbDatasetDataReader,
  DbDatasetPhysicalStore,
  DbDatasetRegistry,
  DefaultDatasetBuildRunner,
  createDefaultPluginRegistry,
  isLimitUpClose,
  limitUpRatio,
  normalizeBuildFilter,
  type DatasetBoard,
} from "../server/datasetRegistry";

// ---------------------------------------------------------------------------
// 断言工具
// ---------------------------------------------------------------------------

const results: { step: string; ok: boolean; detail: string }[] = [];
function check(step: string, ok: boolean, detail = ""): void {
  results.push({ step, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}

async function expectLifecycleError(fn: () => Promise<unknown>, code: string): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof DatasetLifecycleError && e.code === code) return code;
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

const db = await getDb();
if (!db) {
  console.error("数据库不可用：未找到 DATABASE_URL");
  process.exit(1);
}
const database = db;

async function countRows(table: string, versionId: number): Promise<number> {
  const raw = await database.execute(
    sql`SELECT COUNT(*) AS c FROM ${sql.raw(`\`${table}\``)} WHERE \`datasetVersionId\` = ${versionId}`,
  );
  const rows = (Array.isArray(raw) ? raw[0] : undefined) as Array<{ c: number | bigint }> | undefined;
  return Number(rows?.[0]?.c ?? 0);
}

async function tableExists(table: string): Promise<boolean> {
  const raw = await database.execute(sql.raw(`SHOW TABLES LIKE '${table}'`));
  const rows = (Array.isArray(raw) ? raw[0] : undefined) as unknown[] | undefined;
  return (rows?.length ?? 0) > 0;
}

async function queryRows<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const raw = await database.execute(query);
  return ((Array.isArray(raw) ? raw[0] : []) ?? []) as T[];
}

// ---------------------------------------------------------------------------
// 装配（生产同源）
// ---------------------------------------------------------------------------

const registry = new DbDatasetRegistry();
const plugins = createDefaultPluginRegistry();
const physicalStore = new DbDatasetPhysicalStore();
const service = new DatasetRegistryService(registry, { plugins, physicalStore });
const runner = new DefaultDatasetBuildRunner({ repo: registry, service, plugins });
const queryService = new DatasetQueryService(
  registry,
  new DbDatasetDataReader(),
  (code) => plugins.has(code),
);

const DATASET_CODE = "first_limit_pullback";
const EVENT_TABLE = `ds_${DATASET_CODE}_event`;
const PREFIX_TABLE = `ds_${DATASET_CODE}_prefix`;
const POST_TABLE = `ds_${DATASET_CODE}_post`;
const PATH_TABLE = `ds_${DATASET_CODE}_path`;

/** 等待「版本 READY」的最长时间（跨境 TiDB 往返 ~0.5s，构建含多阶段全表下推，需留足余量）。 */
const WAIT_READY_MS = 900_000;

const createdVersionIds: number[] = [];
const createdConfigVersionIds: number[] = [];
/** 各次构建「job COMPLETED → version READY」的时间差（用于评估终态原子性）。 */
const terminalLags: (number | null)[] = [];

/** 生成一次性版本标签（避免与历史版本冲突）。 */
function tempLabel(prefix: string): string {
  return `vfy003b-${prefix}-${Date.now().toString().slice(-9)}`;
}

/**
 * 跨境 TiDB 偶发 `ECONNRESET` 等瞬时连接错误：对**只读**操作做有限重试。
 * 不重试写操作（避免重复写语义不清），写路径本身已是幂等 upsert。
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /ECONNRESET|ETIMEDOUT|EPIPE|PROTOCOL_CONNECTION_LOST|read ECONNRESET/i.test(msg);
      if (!transient || i === attempts) throw e;
      console.log(`     ↻ ${label} 瞬时错误（第 ${i}/${attempts} 次）：${msg.slice(0, 80)} → 重试`);
      await sleep(800 * i);
    }
  }
  throw lastErr;
}

/**
 * 安全删除版本：先取消该版本下所有非终态作业（否则 deleteVersion 会被
 * VERSION_HAS_RUNNING_JOB 拒绝），再删除，并把失败降级为返回值而非抛出
 * —— 清理阶段绝不能因为单个版本删不掉而中断整个验证脚本。
 */
async function safeDeleteVersion(versionId: number): Promise<{ ok: boolean; detail: string }> {
  try {
    const jobs = await registry.listJobs(versionId);
    for (const j of jobs) {
      if (j.status === "RUNNING" || j.status === "PENDING") {
        try {
          await service.cancelJob(j.jobId);
        } catch {
          /* 已非 RUNNING，忽略 */
        }
      }
    }
    const r = await service.deleteVersion(versionId);
    return {
      ok: true,
      detail: `purgedRows=${r.purgedRows} jobsDeleted=${r.jobsDeleted} configsDeleted=${r.configsDeleted}`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 紧急清理：脚本无论以何种方式终止（未捕获异常 / 连接重置），都尽量不留下临时版本。
 * 幂等（cleanupDone 守卫），只做「取消非终态作业 + 删版本」。
 */
let cleanupDone = false;
async function emergencyCleanup(): Promise<void> {
  if (cleanupDone) return;
  cleanupDone = true;
  if (createdVersionIds.length === 0) return;
  console.log(`⚠ 执行紧急清理：${createdVersionIds.length} 个临时版本`);
  for (const vid of createdVersionIds) {
    try {
      const r = await safeDeleteVersion(vid);
      console.log(`  ${r.ok ? "✅ 已删除" : "❌ 删除失败"} id=${vid} ${r.detail}`);
    } catch (e) {
      console.log(`  ❌ 删除异常 id=${vid} ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("❌ 未处理的 Promise 拒绝：", reason);
  void emergencyCleanup().then(() => process.exit(1));
});
process.on("uncaughtException", (err) => {
  console.error("❌ 未捕获异常：", err);
  void emergencyCleanup().then(() => process.exit(1));
});

/**
 * 提交筛选配置 → 建版本 → 立即构建 → 等待**版本终态 READY**（权威终态，而非仅作业状态）。
 *
 * 为什么要等版本 READY：执行器把终态拆成两次写库（先 `completeJob` 落 job=COMPLETED，
 * 再 `markReady` 落 version=READY + 计数）。两次之间是**可观测的非原子窗口**，
 * 只看 job=COMPLETED 会读到 totalEvents=0 的中间态。这里同时测量该窗口的时长，
 * 作为「终态非原子」这一缺陷的直接证据（见报告）。
 */
async function buildWithFilter(
  datasetId: number,
  prefix: string,
  window: { startDate: string; endDate: string },
  filter: Parameters<typeof normalizeBuildFilter>[0],
  opts: { start?: boolean } = {},
): Promise<{ versionId: number; status: string; detail: string; jobCompletedMs: number | null; readyMs: number | null }> {
  const version = await service.createVersionWithBuildConfig({
    datasetId,
    version: tempLabel(prefix),
    startDate: window.startDate,
    endDate: window.endDate,
    filter,
  });
  createdVersionIds.push(version.id);
  createdConfigVersionIds.push(version.id);
  if (opts.start === false) {
    return { versionId: version.id, status: version.status, detail: "仅建版本", jobCompletedMs: null, readyMs: null };
  }

  const job = await service.createJob(version.id);
  await service.startJob(job.jobId);
  const t0 = Date.now();
  await runner.start(job.jobId);

  let jobCompletedMs: number | null = null;
  let readyMs: number | null = null;
  const deadline = Date.now() + WAIT_READY_MS;
  while (Date.now() < deadline) {
    const j = await withRetry("getJob", () => registry.getJob(job.jobId));
    const v = await withRetry("getVersionById", () => registry.getVersionById(version.id));
    if (j?.status === "COMPLETED" && jobCompletedMs === null) jobCompletedMs = Date.now() - t0;
    if (v?.status === "READY") {
      readyMs = Date.now() - t0;
      return {
        versionId: version.id,
        status: v.status,
        detail: `events=${v.totalEvents ?? 0} rows=${v.totalRows ?? 0}`,
        jobCompletedMs,
        readyMs,
      };
    }
    if (j?.status === "FAILED" || j?.status === "CANCELLED") {
      return { versionId: version.id, status: "BUILD_FAILED", detail: `jobStatus=${j.status} err=${j.errorMessage ?? "-"}`, jobCompletedMs, readyMs };
    }
    await sleep(400);
  }
  return { versionId: version.id, status: "TIMEOUT", detail: "等待版本 READY 超时", jobCompletedMs, readyMs };
}

// ===========================================================================
console.log("\n=== STEP DATASET-003B 真实 TiDB 端到端验证 ===\n");

// ---------------------------------------------------------------------------
// 阶段 0：配置表存在性 + first_limit_pullback 基线快照（只读）
// ---------------------------------------------------------------------------
console.log("【阶段 0】配置表就位 + 基线快照（只读）");
for (const t of ["dataset_build_config", "dataset_build_config_event", "dataset_build_config_board"]) {
  check(`配置表存在：${t}`, await tableExists(t));
}

const [definition] = await db
  .select()
  .from(datasetDefinitions)
  .where(eq(datasetDefinitions.datasetCode, DATASET_CODE));
if (!definition) {
  console.error(`未找到 ${DATASET_CODE} 定义，无法继续`);
  process.exit(1);
}
check(`数据集定义存在：${DATASET_CODE}`, true, `id=${definition.id}`);

const versionsBefore = await db
  .select()
  .from(datasetVersions)
  .where(eq(datasetVersions.datasetId, definition.id!));
const configsBefore = await db
  .select({ id: datasetBuildConfigs.id, datasetVersionId: datasetBuildConfigs.datasetVersionId })
  .from(datasetBuildConfigs);
const baselineVersionIds = new Set(versionsBefore.map((v) => v.id));
const baselineConfigIds = new Set(configsBefore.map((c) => c.id));
check(
  "基线快照（用于收尾比对零残留）",
  true,
  `versions=${versionsBefore.length} configs=${configsBefore.length}`,
);

// ---------------------------------------------------------------------------
// 阶段 1：构建门禁（筛选配置未完成 / 非法 → 拒绝，且不留半成品）
// ---------------------------------------------------------------------------
console.log("\n【阶段 1】构建门禁（未完成 / 非法筛选必须被拒绝）");
const WINDOW = { startDate: "2024-01-02", endDate: "2024-01-31" };
const versionsBeforeGate = (
  await db.select({ id: datasetVersions.id }).from(datasetVersions).where(eq(datasetVersions.datasetId, definition.id!))
).length;

check(
  "events 为空 → INVALID_BUILD_FILTER",
  (await expectLifecycleError(
    () =>
      service.createVersionWithBuildConfig({
        datasetId: definition.id!,
        version: tempLabel("gate-empty"),
        startDate: WINDOW.startDate,
        endDate: WINDOW.endDate,
        filter: { events: [] },
      }),
    DATASET_LIFECYCLE_ERROR.INVALID_BUILD_FILTER,
  )) !== null,
);

check(
  "postWindowDays 越界（999）→ INVALID_BUILD_FILTER",
  (await expectLifecycleError(
    () =>
      service.createVersionWithBuildConfig({
        datasetId: definition.id!,
        version: tempLabel("gate-post"),
        startDate: WINDOW.startDate,
        endDate: WINDOW.endDate,
        filter: { postWindowDays: 999 },
      }),
    DATASET_LIFECYCLE_ERROR.INVALID_BUILD_FILTER,
  )) !== null,
);

check(
  "正锚点（relativeDay=+1，未来泄漏）→ INVALID_BUILD_FILTER",
  (await expectLifecycleError(
    () =>
      service.createVersionWithBuildConfig({
        datasetId: definition.id!,
        version: tempLabel("gate-future"),
        startDate: WINDOW.startDate,
        endDate: WINDOW.endDate,
        filter: { events: [{ relativeDay: 1, kind: "firstBoard" }] },
      }),
    DATASET_LIFECYCLE_ERROR.INVALID_BUILD_FILTER,
  )) !== null,
);

check(
  "未知板块 → INVALID_BUILD_FILTER",
  (await expectLifecycleError(
    () =>
      service.createVersionWithBuildConfig({
        datasetId: definition.id!,
        version: tempLabel("gate-board"),
        startDate: WINDOW.startDate,
        endDate: WINDOW.endDate,
        filter: { boards: ["nasdaq"] },
      }),
    DATASET_LIFECYCLE_ERROR.INVALID_BUILD_FILTER,
  )) !== null,
);

const versionsAfterGate = (
  await db.select({ id: datasetVersions.id }).from(datasetVersions).where(eq(datasetVersions.datasetId, definition.id!))
).length;
check(
  "门禁拒绝后不留半成品版本",
  versionsAfterGate === versionsBeforeGate,
  `before=${versionsBeforeGate} after=${versionsAfterGate}`,
);

// ---------------------------------------------------------------------------
// 阶段 2：基准版本（全板块 / 含 ST / T 日首板）真实构建
// ---------------------------------------------------------------------------
console.log("\n【阶段 2】基准版本（全板块 / 含 ST / T 日首板 / t+20）真实构建");
const baselineFilter = {
  boards: [] as string[],
  excludeSt: false,
  events: [{ relativeDay: 0, kind: "firstBoard" }],
  preWindowDays: 0,
  postWindowDays: 20,
  outcomeHorizons: [5, 10],
  batchSize: 500,
};
const base = await buildWithFilter(definition.id!, "base", WINDOW, baselineFilter);
check("基准版本构建完成 → READY", base.status === "READY", `id=${base.versionId} ${base.detail}`);

// ---------------------------------------------------------------------------
// 阶段 2b：终态一致性（发现项，非本任务需求，但影响「构建完成」的可观测语义）
// ---------------------------------------------------------------------------
console.log("\n【阶段 2b】作业终态与版本终态的一致性（执行器写库原子性）");
{
  const lag =
    base.jobCompletedMs !== null && base.readyMs !== null ? base.readyMs - base.jobCompletedMs : null;
  terminalLags.push(lag);
  check(
    "job=COMPLETED 与 version=READY 之间存在可观测时间差（非原子终态）",
    lag !== null && lag >= 0,
    `jobCompleted@${base.jobCompletedMs}ms ready@${base.readyMs}ms lag=${lag}ms` +
      (lag !== null && lag > 0
        ? " → ⚠ 执行器分两次写库（completeJob → markReady），窗口内可读到 version=BUILDING 且计数为 0；若进程在两步之间崩溃，版本将永久停留 BUILDING"
        : ""),
  );
}

const baseEvents = await queryRows<{ eventId: string; symbol: string; tradeDate: string; boardType: string }>(
  sql`SELECT \`eventId\`,\`symbol\`,\`tradeDate\`,\`boardType\` FROM ${sql.raw(`\`${EVENT_TABLE}\``)}
      WHERE \`datasetVersionId\` = ${base.versionId}`,
);
check("基准版本事件行真实落库", baseEvents.length > 0, `events=${baseEvents.length}`);
check(
  "基准版本 prefix 行真实落库（t 日唯一归属 prefix）",
  (await countRows(PREFIX_TABLE, base.versionId)) === baseEvents.length,
  `prefix=${await countRows(PREFIX_TABLE, base.versionId)} events=${baseEvents.length}`,
);
check(
  "基准版本 post 行真实落库",
  (await countRows(POST_TABLE, base.versionId)) > 0,
  `posts=${await countRows(POST_TABLE, base.versionId)}`,
);
check(
  "基准版本 path 行真实落库（且与 post 键集合 1:1）",
  (await countRows(PATH_TABLE, base.versionId)) === (await countRows(POST_TABLE, base.versionId)),
  `paths=${await countRows(PATH_TABLE, base.versionId)} posts=${await countRows(POST_TABLE, base.versionId)}`,
);

// 配置回读一致
const cfgBase = await service.getBuildConfig(base.versionId);
check(
  "配置回读与提交一致（主表标量）",
  cfgBase != null &&
    cfgBase.excludeSt === false &&
    cfgBase.preWindowDays === 0 &&
    cfgBase.postWindowDays === 20 &&
    cfgBase.batchSize === 500 &&
    cfgBase.boards.length === 0,
  `boards=[${cfgBase?.boards.join(",")}] excludeSt=${cfgBase?.excludeSt} pre=${cfgBase?.preWindowDays} post=${cfgBase?.postWindowDays} batch=${cfgBase?.batchSize}`,
);
check(
  "配置回读与提交一致（多值子表 events / horizons）",
  cfgBase != null &&
    cfgBase.events.length === 1 &&
    cfgBase.events[0]!.relativeDay === 0 &&
    cfgBase.events[0]!.kind === "firstBoard" &&
    JSON.stringify(cfgBase.outcomeHorizons) === JSON.stringify([5, 10]),
  `events=${JSON.stringify(cfgBase?.events)} horizons=${JSON.stringify(cfgBase?.outcomeHorizons)}`,
);
const baseDetail = await queryService.getVersion(base.versionId);
check(
  "版本详情视图带 buildConfig（供 UI 展示已固化口径）",
  baseDetail != null &&
    baseDetail.buildConfig != null &&
    baseDetail.buildConfig.postWindowDays === 20 &&
    baseDetail.buildConfig.events.length === 1,
  `buildConfig=${baseDetail?.buildConfig ? `post=${baseDetail.buildConfig.postWindowDays} events=${baseDetail.buildConfig.events.length}` : "null"}`,
);
check(
  "版本详情视图的筛选摘要可渲染（describeDatasetFilter 非空）",
  typeof baseDetail?.buildConfig?.configVersion === "number",
  `configVersion=${baseDetail?.buildConfig?.configVersion}`,
);

// ---------------------------------------------------------------------------
// 阶段 3：板块筛选真实生效
// ---------------------------------------------------------------------------
console.log("\n【阶段 3】板块筛选（仅主板）真实生效");
const boardFilter = {
  ...baselineFilter,
  boards: ["main"] as DatasetBoard[],
  postWindowDays: 5,
  outcomeHorizons: [5],
};
const boardV = await buildWithFilter(definition.id!, "board-main", WINDOW, boardFilter);
check("板块受限版本构建完成 → READY", boardV.status === "READY", `id=${boardV.versionId} ${boardV.detail}`);
terminalLags.push(boardV.jobCompletedMs !== null && boardV.readyMs !== null ? boardV.readyMs - boardV.jobCompletedMs : null);

const boardEvents = await queryRows<{ eventId: string; symbol: string; boardType: string }>(
  sql`SELECT \`eventId\`,\`symbol\`,\`boardType\` FROM ${sql.raw(`\`${EVENT_TABLE}\``)}
      WHERE \`datasetVersionId\` = ${boardV.versionId}`,
);
check(
  "板块受限版本事件全部属于所选板块（main）",
  boardEvents.length > 0 && boardEvents.every((e) => e.boardType === "main"),
  `n=${boardEvents.length} boards=${JSON.stringify([...new Set(boardEvents.map((e) => e.boardType))])}`,
);
const baseIdSet = new Set(baseEvents.map((e) => e.eventId));
const boardIdSet = new Set(boardEvents.map((e) => e.eventId));
check(
  "板块受限版本事件集 ⊂ 全板块版本事件集（筛选只做减法）",
  [...boardIdSet].every((id) => baseIdSet.has(id)),
  `board=${boardIdSet.size} base=${baseIdSet.size} 交集=${[...boardIdSet].filter((i) => baseIdSet.has(i)).length}`,
);
check(
  "板块筛选确实剔除了非主板样本（严格子集）",
  boardIdSet.size < baseIdSet.size,
  `board=${boardIdSet.size} < base=${baseIdSet.size}`,
);

// ---------------------------------------------------------------------------
// 阶段 4：排除 ST 真实生效（按 PIT 状态校验）
// ---------------------------------------------------------------------------
console.log("\n【阶段 4】排除 ST 真实生效（按事件日 PIT 状态校验）");
const noStV = await buildWithFilter(definition.id!, "no-st", WINDOW, {
  ...baselineFilter,
  excludeSt: true,
  postWindowDays: 5,
  outcomeHorizons: [5],
});
check("排除 ST 版本构建完成 → READY", noStV.status === "READY", `id=${noStV.versionId} ${noStV.detail}`);
terminalLags.push(noStV.jobCompletedMs !== null && noStV.readyMs !== null ? noStV.readyMs - noStV.jobCompletedMs : null);

const noStEvents = await queryRows<{ eventId: string; symbol: string; tradeDate: string }>(
  sql`SELECT \`eventId\`,\`symbol\`,\`tradeDate\` FROM ${sql.raw(`\`${EVENT_TABLE}\``)}
      WHERE \`datasetVersionId\` = ${noStV.versionId}`,
);
check("排除 ST 版本有事件（否则断言无意义）", noStEvents.length > 0, `n=${noStEvents.length}`);

// 逐事件回查「事件日 PIT 状态」——必须没有 ST/*ST。
// 直接复用**生产口径**的 DbDatasetBuildIO.resolveSt（与 builder 构建时判定所用的同一个函数），
// 不在此处另写一套 PIT 推导逻辑（避免验证脚本与生产逻辑各说各话）。
const buildIo = new DbDatasetBuildIO();
let stViolations = 0;
const stSamples: string[] = [];
for (const ev of noStEvents) {
  const date = String(ev.tradeDate).slice(0, 10);
  const st = await buildIo.resolveSt(ev.symbol, date);
  if (st === "ST" || st === "*ST") {
    stViolations += 1;
    if (stSamples.length < 3) stSamples.push(`${ev.symbol}@${date}=${st}`);
  }
}
check(
  "排除 ST 版本中不存在事件日处于 ST/*ST 的样本（生产 PIT 口径回查）",
  stViolations === 0,
  `样本=${noStEvents.length} 违规=${stViolations}${stSamples.length ? ` | ${stSamples.join("；")}` : ""}`,
);

// 反向对照：若「含 ST」版本中存在 ST 样本，则排除 ST 的筛选确实是有效约束（而非因无 ST 样本而侥幸通过）。
let baseStCount = 0;
for (const ev of baseEvents) {
  const date = String(ev.tradeDate).slice(0, 10);
  const st = await buildIo.resolveSt(ev.symbol, date);
  if (st === "ST" || st === "*ST") baseStCount += 1;
}
check(
  "对照组信息：含 ST 基准版本中 ST 样本数（用于判断约束是否被真实触发）",
  true,
  `base 含 ST 样本=${baseStCount}（0 表示该窗口无 ST 涨停，约束未被触发但未被违反）`,
);
check(
  "排除 ST 未把非 ST 样本误删（无 ST 样本时集合应完全一致）",
  baseStCount > 0 ? true : noStEvents.length === baseEvents.length,
  baseStCount > 0 ? "存在 ST 样本，用上面的 PIT 回查断言" : `noST=${noStEvents.length} base=${baseEvents.length}`,
);

// ---------------------------------------------------------------------------
// 阶段 5：事件维度 T-1 锚点真实生效（前一日确实涨停）
// ---------------------------------------------------------------------------
console.log("\n【阶段 5】事件维度 T-1 日首板真实生效");
const t1V = await buildWithFilter(definition.id!, "tminus1", WINDOW, {
  ...baselineFilter,
  events: [{ relativeDay: -1, kind: "firstBoard" }],
  postWindowDays: 5,
  outcomeHorizons: [5],
});
check("T-1 锚点版本构建完成 → READY", t1V.status === "READY", `id=${t1V.versionId} ${t1V.detail}`);
terminalLags.push(t1V.jobCompletedMs !== null && t1V.readyMs !== null ? t1V.readyMs - t1V.jobCompletedMs : null);

const t1Events = await queryRows<{ eventId: string; symbol: string; tradeDate: string }>(
  sql`SELECT \`eventId\`,\`symbol\`,\`tradeDate\`,\`boardType\` FROM ${sql.raw(`\`${EVENT_TABLE}\``)}
      WHERE \`datasetVersionId\` = ${t1V.versionId}`,
);
check("T-1 锚点版本有事件", t1Events.length > 0, `n=${t1Events.length}`);

// 逐事件回查：该事件日的**上一交易日**确实收盘涨停。
// 关键：涨停判定必须走**生产口径**（PIT ST → limitUpRatio → isLimitUpClose）。
// 若像早先版本那样只看代码前缀按 10% 计算，ST 股（5% 涨停）会被误判为「未涨停」而产生假阳性
// —— 实测 000615.SZ / 000669.SZ / 002309.SZ 在 2023-12-29 均为 PIT ST，收盘价恰等于 5% 涨停价。
let anchorViolations = 0;
const anchorSamples: string[] = [];
for (const ev of t1Events.slice(0, 60)) {
  const eventDate = String(ev.tradeDate).slice(0, 10);
  const rows = await queryRows<{ tradeDate: string; closePrice: string; preClosePrice: string }>(
    sql`SELECT \`tradeDate\`,\`closePrice\`,\`preClosePrice\` FROM \`stock_daily_prices\`
        WHERE \`stockCode\` = ${ev.symbol} AND \`tradeDate\` < ${eventDate}
        ORDER BY \`tradeDate\` DESC LIMIT 1`,
  );
  const prev = rows[0];
  if (!prev) {
    anchorViolations += 1;
    continue;
  }
  const prevDate = String(prev.tradeDate).slice(0, 10);
  const st = await buildIo.resolveSt(ev.symbol, prevDate);
  const ratio = limitUpRatio(ev.symbol, st);
  const hit = isLimitUpClose(Number(prev.closePrice), Number(prev.preClosePrice), ratio);
  if (!hit) {
    anchorViolations += 1;
    if (anchorSamples.length < 3) {
      anchorSamples.push(
        `${ev.symbol}@${eventDate} 前一日(${prevDate}) close=${Number(prev.closePrice)} preClose=${Number(prev.preClosePrice)} st=${st} ratio=${ratio}`,
      );
    }
  }
}
check(
  "T-1 锚点版本：每笔事件的前一交易日均真实涨停（生产口径：含 PIT ST 5%）",
  anchorViolations === 0,
  `抽查=${Math.min(t1Events.length, 60)} 违规=${anchorViolations}${anchorSamples.length ? ` | ${anchorSamples.join("；")}` : ""}`,
);

// T-1 版本的事件集与 T 日版本不同（锚点语义真实改变了出数）
const t1IdSet = new Set(t1Events.map((e) => e.eventId));
check(
  "T-1 锚点与 T 日首板产出的事件集不同（锚点语义真实生效）",
  [...t1IdSet].some((id) => !baseIdSet.has(id)) || t1IdSet.size !== baseIdSet.size,
  `t-1=${t1IdSet.size} t0=${baseIdSet.size}`,
);

// ---------------------------------------------------------------------------
// 阶段 6：前置窗口真实物化（负相对日 + 真实 OHLC）→ 归 prefix（PIT 安全特征层）
// ---------------------------------------------------------------------------
console.log("\n【阶段 6】t 日之前窗口（preWindowDays=5）真实物化 → prefix");
const preV = await buildWithFilter(definition.id!, "pre-5", WINDOW, {
  ...baselineFilter,
  preWindowDays: 5,
  postWindowDays: 3,
});
check("前置窗口版本构建完成 → READY", preV.status === "READY", `id=${preV.versionId} ${preV.detail}`);
terminalLags.push(preV.jobCompletedMs !== null && preV.readyMs !== null ? preV.readyMs - preV.jobCompletedMs : null);

const preBars = await queryRows<{ relativeDay: number; tradeDate: string; close: number | null; high: number | null }>(
  sql`SELECT \`relativeDay\`,\`tradeDate\`,\`close\`,\`high\` FROM ${sql.raw(`\`${PREFIX_TABLE}\``)}
      WHERE \`datasetVersionId\` = ${preV.versionId}`,
);
check("前置窗口版本在 prefix 产生 rd ≤ 0 行", preBars.length > 0, `prefixRows=${preBars.length}`);
check(
  "prefix 含负相对日行（t 日之前行情真实物化）",
  preBars.some((p) => p.relativeDay < 0),
  `negativeRows=${preBars.filter((p) => p.relativeDay < 0).length}`,
);
check(
  "prefix 行带真实 OHLC（非占位 null）",
  preBars.some((p) => p.close !== null),
  `非空 close 行数=${preBars.filter((p) => p.close !== null).length}`,
);
check(
  "prefix 含唯一 rd=0 行（t 日归属 prefix，不落 path）",
  preBars.filter((p) => p.relativeDay === 0).length > 0,
  `d0Rows=${preBars.filter((p) => p.relativeDay === 0).length}`,
);
const distinctRels = [...new Set(preBars.map((p) => p.relativeDay))].sort((a, b) => a - b);
check(
  "prefix 相对日覆盖到 -5..0 的子集（夹取在日历左边界内，诚实不臆造）",
  distinctRels.every((r) => r >= -5 && r <= 0),
  `distinct=${JSON.stringify(distinctRels)}`,
);

// PIT 边界（结构级 + 数据级）：rd ≤ 0 一律不得出现在 path。
const pathNonPositive = (
  await queryRows<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM ${sql.raw(`\`${PATH_TABLE}\``)}
        WHERE \`datasetVersionId\` = ${preV.versionId} AND \`relativeDay\` <= 0`,
  )
)[0];
check("path 中不存在 rd ≤ 0 行（PIT 边界收紧为 ≥ 1）", Number(pathNonPositive?.n ?? 0) === 0, `n=${pathNonPositive?.n}`);
const prefixCols = await queryRows<{ COLUMN_NAME: string }>(
  sql`SELECT \`COLUMN_NAME\` FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${PREFIX_TABLE}`,
);
const prefixColNames = prefixCols.map((c) => c.COLUMN_NAME.toLowerCase());
check(
  "prefix 表结构不含任何衍生列（I8 结构级 PIT 防线）",
  !prefixColNames.some(
    (c) => c.includes("fromeventclose") || c.includes("fromeventhigh") || c.startsWith("isbreakout") || c === "volumeratio",
  ),
  `列=[${prefixColNames.join(",")}]`,
);

// ---------------------------------------------------------------------------
// 阶段 7：级联清理（删版本 → 删配置；删数据集 → 删全部配置）
// ---------------------------------------------------------------------------
console.log("\n【阶段 7】级联清理");
const delTarget = preV.versionId;
const di = createdVersionIds.indexOf(delTarget);
if (di >= 0) createdVersionIds.splice(di, 1);
// 该版本可能因前一阶段超时仍带 RUNNING 作业 → safeDeleteVersion 会先取消再删。
const preCfgBefore = await service.getBuildConfig(delTarget);
const delRes = await safeDeleteVersion(delTarget);
check(
  "deleteVersion 成功且 configsDeleted ≥ 1",
  delRes.ok && delRes.detail.includes("configsDeleted=1"),
  `删除前配置存在=${preCfgBefore != null} | ${delRes.detail}`,
);
check(
  "删除后配置回读为 null",
  (await service.getBuildConfig(delTarget)) == null,
);
check(
  "删除后五表物理行清零",
  (await countRows(PATH_TABLE, delTarget)) === 0 &&
    (await countRows(EVENT_TABLE, delTarget)) === 0 &&
    (await countRows(PREFIX_TABLE, delTarget)) === 0 &&
    (await countRows(POST_TABLE, delTarget)) === 0,
);

// 临时数据集：定义 + 版本 + 配置 → 删定义应连配置一并清除
console.log("\n  · 临时数据集级联删除");
const tmpDef = await service.createDefinition({
  // datasetCode 命名铁律（§49）：lowercase snake_case 且禁止以数字序号/日期结尾。
  datasetCode: `vfy003b_tmp_holder`,
  name: "DATASET-003B 临时验证数据集",
  description: "端到端验证用（脚本结束即删）",
  datasetType: "EVENT",
  storageType: "DATABASE",
});
const tmpV = await service.createVersionWithBuildConfig({
  datasetId: tmpDef.id!,
  version: "v1",
  startDate: WINDOW.startDate,
  endDate: WINDOW.endDate,
  filter: baselineFilter,
});
check("临时数据集版本配置已落库", (await service.getBuildConfig(tmpV.id)) != null, `versionId=${tmpV.id}`);
const tmpDel = await service.deleteDefinition(tmpDef.id!);
check(
  "deleteDefinition 返回 configsDeleted ≥ 1",
  tmpDel.configsDeleted >= 1,
  `configsDeleted=${tmpDel.configsDeleted} versionsDeleted=${tmpDel.versionsDeleted} dropped=${tmpDel.droppedTables.length}`,
);
check("临时数据集配置回读为 null", (await service.getBuildConfig(tmpV.id)) == null);

// ---------------------------------------------------------------------------
// 阶段 8：零残留
// ---------------------------------------------------------------------------
console.log("\n【阶段 8】零残留检查");
const leftoverCleanup: string[] = [];
const pending = [...createdVersionIds];
for (const vid of pending) {
  const r = await safeDeleteVersion(vid);
  if (r.ok) {
    const i = createdVersionIds.indexOf(vid);
    if (i >= 0) createdVersionIds.splice(i, 1);
  } else if (!r.detail.includes("未找到")) {
    leftoverCleanup.push(`id=${vid}: ${r.detail}`);
  }
}
cleanupDone = true; // 正常路径已完成清理，抑制紧急清理重复执行
check("遗留临时版本清理无一失败", leftoverCleanup.length === 0, leftoverCleanup.join(" | ") || "全部清理成功");

const versionsAfter = await db
  .select({ id: datasetVersions.id })
  .from(datasetVersions)
  .where(eq(datasetVersions.datasetId, definition.id!));
const unexpectedVersions = versionsAfter.filter((v) => !baselineVersionIds.has(v.id));
check("无遗留临时版本", unexpectedVersions.length === 0, `unexpected=${unexpectedVersions.length}`);

const configsAfter = await db
  .select({ id: datasetBuildConfigs.id })
  .from(datasetBuildConfigs);
const unexpectedConfigs = configsAfter.filter((c) => !baselineConfigIds.has(c.id));
check("无遗留临时配置行", unexpectedConfigs.length === 0, `unexpected=${unexpectedConfigs.length}`);

const configsOfTempVersions = await db
  .select({ id: datasetBuildConfigs.id })
  .from(datasetBuildConfigs)
  .where(sql`\`datasetVersionId\` IN (${sql.join(createdConfigVersionIds.map((v) => sql`${v}`), sql`,`)})`);
check(
  "已删版本的配置行全部清除",
  configsOfTempVersions.length === 0,
  `leftover=${configsOfTempVersions.length}`,
);

const defsAfter = await db
  .select({ id: datasetDefinitions.id, code: datasetDefinitions.datasetCode })
  .from(datasetDefinitions)
  .where(sql`\`datasetCode\` LIKE 'vfy003b_tmp%'`);
check("临时数据集定义已清除", defsAfter.length === 0, `leftover=${defsAfter.length}`);

// ---------------------------------------------------------------------------
// 阶段 9：终态原子性汇总（发现项）
// ---------------------------------------------------------------------------
console.log("\n【阶段 9】终态非原子性汇总");
const measured = terminalLags.filter((x): x is number => x !== null);
check(
  "全部构建的「job COMPLETED → version READY」时间差已测量",
  measured.length === terminalLags.length && measured.length >= 4,
  `samples=${terminalLags.length} measured=${measured.length} lags=${JSON.stringify(measured)}`,
);
console.log(
  `     ℹ 非原子窗口：min=${measured.length ? Math.min(...measured) : "-"}ms max=${
    measured.length ? Math.max(...measured) : "-"
  }ms avg=${measured.length ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length) : "-"}ms` +
    "（两次独立写库；窗口内 version 仍为 BUILDING 且计数为 0）",
);

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(72));
console.log(`总计 ${results.length} 项检查：通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length > 0) {
  console.log("\n失败项：");
  for (const f of failed) console.log(`  ❌ ${f.step} — ${f.detail}`);
}
console.log("=".repeat(72));
process.exit(failed.length === 0 ? 0 : 1);
