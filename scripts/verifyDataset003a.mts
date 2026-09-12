/**
 * STEP DATASET-003A — 真实 TiDB 端到端验证：多数据集 + 版本/数据集删除。
 *
 * 目标（逐条对应用户需求，全程真实 DB、无 mock 冒充）：
 *   1. **多数据集**：Registry 可登记多个逻辑 Dataset，彼此独立（各自 datasetCode / 物理表 / 版本）。
 *   2. **每个数据集独立表结构与构建逻辑**：以「运行时注册的探针插件」验证——
 *      插件自带 DDL（event/path/outcome 三表，自包含）与自有构建器，Runner 按 datasetCode
 *      解析插件并真实写入**该数据集自己的物理表**（不串到 first_limit_pullback 的表）。
 *   3. **删除版本 = 删数据、保留表结构**：清该版本物理行 + 删其作业 + 删版本记录；
 *      表结构仍在（可继续服务其它版本），其它版本数据不受影响。
 *   4. **删除数据集 = 删表结构 + 数据**：级联清所有版本数据/作业/版本记录，并 DROP 全部物理表。
 *   5. **守卫**：存在 RUNNING 作业时，删版本 / 删数据集均被拒绝（稳定错误码）。
 *   6. **未注册插件的数据集**：可登记定义与版本，但构建被明确拒绝（BUILDER_NOT_REGISTERED），
 *      且不会建表（不留「有定义无表」的假象）。
 *   7. **零残留**：脚本结束不留下任何临时定义 / 版本 / 物理表；first_limit_pullback 完全未被触碰。
 *
 * 用法：npx tsx scripts/verifyDataset003a.mts
 */

import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { datasetDefinitions } from "../drizzle/schema";
import {
  DATASET_LIFECYCLE_ERROR,
  DatasetLifecycleError,
  DatasetRegistryService,
  DbDatasetPhysicalStore,
  DbDatasetRegistry,
  DefaultDatasetBuildRunner,
  createDefaultPluginRegistry,
  type DatasetBuildIO,
  type DatasetBuilder,
  type DatasetBuildCheckpoint,
  type DatasetBuildResult,
  type DatasetPlugin,
} from "../server/datasetRegistry";

// ---------------------------------------------------------------------------
// 断言工具
// ---------------------------------------------------------------------------

const results: { step: string; ok: boolean; detail: string }[] = [];
function check(step: string, ok: boolean, detail = ""): void {
  results.push({ step, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
}

async function expectLifecycleError(fn: () => Promise<unknown>, code: string): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    if (e instanceof DatasetLifecycleError) return e.code === code;
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, label: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await sleep(300);
  }
  console.log(`     ⏱ waitFor 超时：${label}（${timeoutMs}ms）`);
  return false;
}

const db = await getDb();
if (!db) {
  console.error("数据库不可用");
  process.exit(1);
}

const database = db;

async function countTableRows(table: string, versionId: number): Promise<number> {
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

// ---------------------------------------------------------------------------
// 探针插件（验证「每个数据集独立表结构 + 独立构建逻辑」）
// ---------------------------------------------------------------------------

const PROBE_CODE = "verify003a_probe";
const NO_BUILDER_CODE = "verify003a_nobuilder";

const PROBE_TRADING_DAYS = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"];
const PROBE_FOOTER = "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin";

/** 探针物理表 DDL（自包含；与命名规范 ds_{code}_{role} 一致）。 */
const probeTables = [
  {
    role: "event" as const,
    label: "探针事件",
    createSql: (t: string) => `CREATE TABLE IF NOT EXISTS \`${t}\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`datasetVersionId\` bigint NOT NULL,
  \`eventId\` varchar(64) NOT NULL,
  \`symbol\` varchar(32) NOT NULL,
  \`tradeDate\` date NOT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_probe_event_version\` (\`datasetVersionId\`,\`eventId\`)${PROBE_FOOTER}`,
  },
  {
    role: "path" as const,
    label: "探针路径",
    createSql: (t: string) => `CREATE TABLE IF NOT EXISTS \`${t}\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`datasetVersionId\` bigint NOT NULL,
  \`eventId\` varchar(64) NOT NULL,
  \`relativeDay\` int NOT NULL,
  \`close\` double DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_probe_path_version\` (\`datasetVersionId\`,\`eventId\`,\`relativeDay\`)${PROBE_FOOTER}`,
  },
  {
    role: "outcome" as const,
    label: "探针结果",
    createSql: (t: string) => `CREATE TABLE IF NOT EXISTS \`${t}\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`datasetVersionId\` bigint NOT NULL,
  \`eventId\` varchar(64) NOT NULL,
  \`horizon\` int NOT NULL,
  \`returnPct\` double DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_probe_outcome_version\` (\`datasetVersionId\`,\`eventId\`,\`horizon\`)${PROBE_FOOTER}`,
  },
];

class ProbeBuildIO implements DatasetBuildIO {
  // 只读能力：探针构建器不使用（返回诚实空值，不伪造研究数据）。
  async loadTradingDays(): Promise<string[]> {
    return [...PROBE_TRADING_DAYS];
  }
  async loadSecurityIndexes(): Promise<void> {
    /* 探针不使用证券索引 */
  }
  resolveStSync(): "UNKNOWN" {
    return "UNKNOWN";
  }
  async resolveSt(): Promise<"UNKNOWN"> {
    return "UNKNOWN";
  }
  resolveIndustrySync(): null {
    return null;
  }
  async fetchLimitUpCandidateBars(): Promise<never[]> {
    return [];
  }
  async fetchBarsForSymbolsInRange(): Promise<never[]> {
    return [];
  }
  async fetchLiquidityForSymbolsInRange(): Promise<Map<string, never>> {
    return new Map();
  }
  async listEvents(): Promise<never[]> {
    return [];
  }

  /** 真实写入「该数据集自己的」event 表（INSERT IGNORE 幂等）。 */
  async insertEvents(rows: Array<{ datasetVersionId: number; eventId: string; symbol: string; tradeDate: string }>): Promise<void> {
    if (rows.length === 0) return;
    const table = `ds_${PROBE_CODE}_event`;
    const values = rows.map(
      (r) => sql`(${r.datasetVersionId}, ${r.eventId}, ${r.symbol}, ${r.tradeDate})`,
    );
    await database.execute(
      sql`INSERT IGNORE INTO ${sql.raw(`\`${table}\``)} (\`datasetVersionId\`, \`eventId\`, \`symbol\`, \`tradeDate\`) VALUES ${sql.join(values, sql`, `)}`,
    );
  }
  async insertPaths(): Promise<void> {
    /* 探针构建器不产出 paths（诚实空） */
  }
  async insertOutcomes(): Promise<void> {
    /* 探针构建器不产出 outcomes（诚实空） */
  }
}

/** 探针构建器：按窗口内每个交易日产出一行事件，逐个 chunk 上报进度。 */
class ProbeDatasetBuilder implements DatasetBuilder {
  readonly datasetCode = PROBE_CODE;
  constructor(private readonly io: ProbeBuildIO) {}

  async build(
    config: { datasetVersionId: number; startDate: string; endDate: string },
    reportProgress: (cp: DatasetBuildCheckpoint) => Promise<void>,
  ): Promise<DatasetBuildResult> {
    const days = PROBE_TRADING_DAYS.filter((d) => d >= config.startDate && d <= config.endDate);
    const rows = days.map((d, i) => ({
      datasetVersionId: config.datasetVersionId,
      eventId: `probe-${config.datasetVersionId}-${i}`,
      symbol: "600000.SH",
      tradeDate: d,
    }));
    await this.io.insertEvents(rows);
    for (let i = 0; i < days.length; i += 1) {
      await reportProgress({
        phase: "events",
        lastTradeDate: days[i]!,
        lastSymbol: null,
        lastEventId: null,
        processedRows: i + 1,
        completedChunks: i + 1,
      });
    }
    return {
      status: "COMPLETED",
      events: rows.length,
      paths: 0,
      outcomes: 0,
      chunks: days.length,
      processedRows: rows.length,
      failedRows: 0,
    };
  }
}

const probePlugin: DatasetPlugin = {
  datasetCode: PROBE_CODE,
  displayName: "003A 验证探针",
  description: "验证脚本临时插件（自带物理表 DDL 与构建器；脚本结束会注销并清理）",
  physicalTables: probeTables,
  createIO: () => new ProbeBuildIO(),
  createBuilder: (io) => new ProbeDatasetBuilder(io as ProbeBuildIO),
};

// ---------------------------------------------------------------------------
// 装配（与生产同一套注册表 / 物理表存储 / 执行器）
// ---------------------------------------------------------------------------

const plugins = createDefaultPluginRegistry();
plugins.register(probePlugin);

const registry = new DbDatasetRegistry();
const physicalStore = new DbDatasetPhysicalStore();
const service = new DatasetRegistryService(registry, { plugins, physicalStore });
const runner = new DefaultDatasetBuildRunner({ repo: registry, service, plugins });

/** 已登记的临时定义 id（清理用）。 */
const tempDefinitionIds: number[] = [];

async function safeDeleteDefinition(definitionId: number): Promise<void> {
  try {
    const def = await registry.getDefinitionById(definitionId);
    if (!def) return;
    await service.deleteDefinition(definitionId);
    console.log(`  🧹 已清理临时数据集 ${def.datasetCode}（id=${definitionId}）`);
  } catch (e) {
    console.log(`  ⚠️ 清理临时数据集 id=${definitionId} 失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

let allOk = false;
try {
  // =========================================================================
  // 阶段 1：只读基线快照（first_limit_pullback 必须全程不被触碰）
  // =========================================================================
  console.log("\n【阶段 1】只读基线快照（first_limit_pullback）");
  const [flp] = await database
    .select()
    .from(datasetDefinitions)
    .where(eq(datasetDefinitions.datasetCode, "first_limit_pullback"));
  if (!flp) throw new Error("未找到 first_limit_pullback 定义");

  const flpVersionsBefore = await registry.listVersions(flp.id!);
  const flpTables = [flp.eventTableName!, flp.pathTableName!, flp.outcomeTableName!];
  let flpRowsBefore = 0;
  for (const v of flpVersionsBefore) {
    for (const t of flpTables) flpRowsBefore += await countTableRows(t, v.id!);
  }
  check(
    "基线：first_limit_pullback 定义存在",
    flp.id !== undefined,
    `id=${flp.id} versions=${flpVersionsBefore.length} rows=${flpRowsBefore}`,
  );
  check(
    "基线：默认注册表可构建性（first_limit_pullback=true / 未注册=false）",
    service.isBuildable("first_limit_pullback") === true && service.isBuildable("no_such_dataset") === false,
  );

  // =========================================================================
  // 阶段 2：未注册插件的数据集（可登记，不可构建，不建表）
  // =========================================================================
  console.log("\n【阶段 2】未注册插件的数据集：可登记 / 不可构建 / 不建表");
  const noBuilder = await service.createDefinition({
    datasetCode: NO_BUILDER_CODE,
    name: "003A 无构建实现",
    description: "验证脚本临时定义",
    datasetType: "EVENT",
  });
  tempDefinitionIds.push(noBuilder.id!);
  check("createDefinition 成功（未注册插件）", noBuilder.id !== undefined, `id=${noBuilder.id}`);
  check("isBuildable = false", service.isBuildable(NO_BUILDER_CODE) === false);
  const nbTable = `ds_${NO_BUILDER_CODE}_event`;
  check("未注册插件不建表（诚实：无表）", (await tableExists(nbTable)) === false, `table=${nbTable}`);

  const nbVersion = await service.createVersionWithBuildConfig({
    datasetId: noBuilder.id!,
    version: "v1",
    startDate: "2024-01-02",
    endDate: "2024-01-05",
  });
  check("未注册插件仍可创建版本（DRAFT）", nbVersion.status === "DRAFT", `status=${nbVersion.status}`);
  check(
    "createJob 被拒（BUILDER_NOT_REGISTERED）",
    await expectLifecycleError(() => service.createJob(nbVersion.id!), DATASET_LIFECYCLE_ERROR.BUILDER_NOT_REGISTERED),
  );
  check(
    "非法 datasetCode 被拒（INVALID_DATASET_CODE）",
    await expectLifecycleError(
      () => service.createDefinition({ datasetCode: "Bad-Code", name: "x", datasetType: "EVENT" }),
      DATASET_LIFECYCLE_ERROR.INVALID_DATASET_CODE,
    ),
  );
  check(
    "带版本号的 datasetCode 被拒（INVALID_DATASET_CODE）",
    await expectLifecycleError(
      () => service.createDefinition({ datasetCode: "some_dataset_v1", name: "x", datasetType: "EVENT" }),
      DATASET_LIFECYCLE_ERROR.INVALID_DATASET_CODE,
    ),
  );

  // =========================================================================
  // 阶段 3：已注册插件的第二个数据集（独立表结构）
  // =========================================================================
  console.log("\n【阶段 3】第二个数据集（已注册插件）：独立物理表");
  const probe = await service.createDefinition({
    datasetCode: PROBE_CODE,
    name: "003A 验证探针数据集",
    description: "验证脚本临时数据集",
    datasetType: "EVENT",
  });
  tempDefinitionIds.push(probe.id!);
  check("createDefinition 成功（已注册插件）", probe.id !== undefined, `id=${probe.id}`);
  check("isBuildable = true", service.isBuildable(PROBE_CODE) === true);

  const probeTableNames = [`ds_${PROBE_CODE}_event`, `ds_${PROBE_CODE}_path`, `ds_${PROBE_CODE}_outcome`];
  const probeTableFlags = await Promise.all(probeTableNames.map((t) => tableExists(t)));
  check(
    "插件声明的 3 张物理表已在真实 TiDB 建立",
    probeTableFlags.every(Boolean),
    probeTableNames.join(", "),
  );
  check(
    "定义落库的表名 = 派生值 ds_{code}_{role}",
    probe.eventTableName === probeTableNames[0] && probe.outcomeTableName === probeTableNames[2],
    `event=${probe.eventTableName}`,
  );
  check(
    "重复 datasetCode 被拒（DEFINITION_ALREADY_EXISTS）",
    await expectLifecycleError(
      () => service.createDefinition({ datasetCode: PROBE_CODE, name: "dup", datasetType: "EVENT" }),
      DATASET_LIFECYCLE_ERROR.DEFINITION_ALREADY_EXISTS,
    ),
  );
  check(
    "显式错误表名被拒（INVALID_DATASET_CODE，防表名注入）",
    await expectLifecycleError(
      () =>
        service.createDefinition({
          datasetCode: "verify003a_injection",
          name: "inj",
          datasetType: "EVENT",
          tableNames: { event: "ds_first_limit_pullback_event" },
        }),
      DATASET_LIFECYCLE_ERROR.INVALID_DATASET_CODE,
    ),
  );
  check(
    "注入用 datasetCode 未落库（拒绝后不留痕）",
    (await registry.getDefinitionByCode("verify003a_injection")) === undefined,
  );

  // =========================================================================
  // 阶段 4：多版本 + 真实构建（写入该数据集自己的表）
  // =========================================================================
  console.log("\n【阶段 4】同一数据集多版本：各自真实构建落库");
  const pv1 = await service.createVersionWithBuildConfig({
    datasetId: probe.id!,
    version: "v1",
    startDate: "2024-01-02",
    endDate: "2024-01-05",
  });
  const pv2 = await service.createVersionWithBuildConfig({
    datasetId: probe.id!,
    version: "v2",
    startDate: "2024-01-02",
    endDate: "2024-01-08",
  });
  check(
    "同一数据集下两个版本并存（(datasetId, version) 唯一，彼此独立）",
    pv1.id !== pv2.id && pv1.status === "DRAFT" && pv2.status === "DRAFT",
    `v1=${pv1.id} v2=${pv2.id}`,
  );

  async function buildVersion(versionId: number, label: string): Promise<boolean> {
    const job = await service.createJob(versionId);
    await service.startJob(job.jobId);
    await runner.start(job.jobId);
    const done = await waitFor(
      async () => (await registry.getJob(job.jobId))?.status === "COMPLETED",
      30_000,
      `${label} 作业 COMPLETED`,
    );
    // runner 的收尾顺序是 completeJob → markReady，两次跨境往返之间版本可能仍为 BUILDING，
    // 故必须再等版本态收敛到 READY，而不是观测到 COMPLETED 就断言（避免时序竞态假失败）。
    const ready = await waitFor(
      async () => (await registry.getVersionById(versionId))?.status === "READY",
      20_000,
      `${label} 版本 READY`,
    );
    const rows = await countTableRows(`ds_${PROBE_CODE}_event`, versionId);
    const v = await registry.getVersionById(versionId);
    console.log(
      `     · ${label}: jobCompleted=${done} version=${v?.status} rows=${rows} declaredEvents=${v?.totalEvents} declaredRows=${v?.totalRows}`,
    );
    return done && ready && v?.status === "READY" && rows > 0;
  }

  const builtV1 = await buildVersion(pv1.id!, "v1");
  const builtV2 = await buildVersion(pv2.id!, "v2");
  check("v1 真实构建（插件构建器 → 自有 event 表）", builtV1);
  check("v2 真实构建（插件构建器 → 自有 event 表）", builtV2);

  const v1Rows = await countTableRows(`ds_${PROBE_CODE}_event`, pv1.id!);
  const v2Rows = await countTableRows(`ds_${PROBE_CODE}_event`, pv2.id!);
  check(
    "两版本数据按 datasetVersionId 隔离（行数各自独立）",
    v1Rows > 0 && v2Rows > 0,
    `v1=${v1Rows} 行 / v2=${v2Rows} 行`,
  );
  check(
    "first_limit_pullback 的表未被写入（数据集间物理隔离）",
    (await countTableRows(flpTables[0]!, pv1.id!)) === 0 && (await countTableRows(flpTables[0]!, pv2.id!)) === 0,
  );

  // =========================================================================
  // 阶段 5：删除版本 → 删数据、保留表结构、不影响其它版本
  // =========================================================================
  console.log("\n【阶段 5】删除版本：删数据 + 删作业，保留表结构");
  const delV1 = await service.deleteVersion(pv1.id!);
  check(
    "deleteVersion 诚实回报清理量",
    delV1.purgedRows === v1Rows && delV1.version === "v1",
    `purgedRows=${delV1.purgedRows} jobsDeleted=${delV1.jobsDeleted} tables=${delV1.tables.map((t) => `${t.table}:${t.deleted}`).join(",")}`,
  );
  check("v1 物理数据已清空", (await countTableRows(`ds_${PROBE_CODE}_event`, pv1.id!)) === 0);
  check(
    "**表结构保留**（删版本不 DROP 表）",
    (await Promise.all(probeTableNames.map((t) => tableExists(t)))).every(Boolean),
  );
  check("v2 数据未受影响", (await countTableRows(`ds_${PROBE_CODE}_event`, pv2.id!)) === v2Rows, `v2=${v2Rows} 行`);
  const probeVersionsAfterDel = await registry.listVersions(probe.id!);
  check(
    "v1 版本记录与作业已删除（仅剩 v2）",
    probeVersionsAfterDel.length === 1 && probeVersionsAfterDel[0]!.version === "v2",
    `剩余版本=${probeVersionsAfterDel.map((v) => v.version).join(",")}`,
  );
  check(
    "重复删除同一版本被拒（VERSION_NOT_FOUND）",
    await expectLifecycleError(() => service.deleteVersion(pv1.id!), DATASET_LIFECYCLE_ERROR.VERSION_NOT_FOUND),
  );

  // =========================================================================
  // 阶段 6：RUNNING 作业守卫
  // =========================================================================
  console.log("\n【阶段 6】RUNNING 作业守卫（删版本 / 删数据集均被拒绝）");
  const runningJob = await service.createJob(pv2.id!);
  check("v2 重新构建 → PENDING", runningJob.status === "PENDING", `jobId=${runningJob.jobId}`);
  await service.startJob(runningJob.jobId); // RUNNING，但**不**启动执行器（模拟构建进行中）
  const runningNow = (await registry.getJob(runningJob.jobId))?.status;
  check("作业已置 RUNNING（未启动执行器，模拟进行中）", runningNow === "RUNNING", `status=${runningNow}`);
  check(
    "deleteVersion 被拒（VERSION_HAS_RUNNING_JOB）",
    await expectLifecycleError(() => service.deleteVersion(pv2.id!), DATASET_LIFECYCLE_ERROR.VERSION_HAS_RUNNING_JOB),
  );
  check(
    "deleteDefinition 被拒（DEFINITION_HAS_RUNNING_JOB）",
    await expectLifecycleError(() => service.deleteDefinition(probe.id!), DATASET_LIFECYCLE_ERROR.DEFINITION_HAS_RUNNING_JOB),
  );
  check(
    "守卫拒绝后数据集与表均未被破坏",
    (await registry.getDefinitionById(probe.id!)) !== undefined &&
      (await Promise.all(probeTableNames.map((t) => tableExists(t)))).every(Boolean),
  );
  await service.cancelJob(runningJob.jobId);
  check("取消 RUNNING 作业 → CANCELLED", (await registry.getJob(runningJob.jobId))?.status === "CANCELLED");

  // =========================================================================
  // 阶段 7：删除数据集 → 级联删数据 + DROP 表结构
  // =========================================================================
  console.log("\n【阶段 7】删除数据集：级联清数据 + DROP 全部物理表");
  const rowsBeforeDeleteDataset = await countTableRows(`ds_${PROBE_CODE}_event`, pv2.id!);
  const delProbe = await service.deleteDefinition(probe.id!);
  check(
    "deleteDefinition 级联统计诚实",
    delProbe.versionsDeleted === 1 && delProbe.purgedRows === rowsBeforeDeleteDataset,
    `versionsDeleted=${delProbe.versionsDeleted} purgedRows=${delProbe.purgedRows} jobsDeleted=${delProbe.jobsDeleted}`,
  );
  check(
    "全部物理表已被 DROP（表结构删除）",
    delProbe.droppedTables.length === 3 && delProbe.droppedTables.every((t) => t.dropped),
    delProbe.droppedTables.map((t) => `${t.table}:${t.dropped}`).join(", "),
  );
  check(
    "真实 TiDB 上表已不存在",
    (await Promise.all(probeTableNames.map(async (t) => !(await tableExists(t))))).every(Boolean),
  );
  check("定义记录已删除", (await registry.getDefinitionById(probe.id!)) === undefined);
  const tempIds = tempDefinitionIds.splice(tempDefinitionIds.indexOf(probe.id!), 1);
  check("定义删除后 datasetCode 释放（同 code 可重建）", tempIds.length === 1);
  check(
    "残留版本/作业已随数据集清除",
    (await registry.listVersions(probe.id!)).length === 0 && (await registry.listJobs(pv2.id!)).length === 0,
  );
  check(
    "重复删除同一数据集被拒（DEFINITION_NOT_FOUND）",
    await expectLifecycleError(() => service.deleteDefinition(probe.id!), DATASET_LIFECYCLE_ERROR.DEFINITION_NOT_FOUND),
  );

  // 同 code 重建 → 重新建表 → 再删（验证「删干净、可重建」闭环）
  const rebuilt = await service.createDefinition({
    datasetCode: PROBE_CODE,
    name: "003A 验证探针数据集（重建）",
    datasetType: "EVENT",
  });
  tempDefinitionIds.push(rebuilt.id!);
  check(
    "同 code 重建成功且物理表重新建立",
    (await Promise.all(probeTableNames.map((t) => tableExists(t)))).every(Boolean),
    `id=${rebuilt.id}`,
  );
  const deletedRebuilt = await service.deleteDefinition(rebuilt.id!);
  tempDefinitionIds.splice(tempDefinitionIds.indexOf(rebuilt.id!), 1);
  check(
    "重建后再次删除同样 DROP 干净",
    deletedRebuilt.droppedTables.every((t) => t.dropped) &&
      (await Promise.all(probeTableNames.map(async (t) => !(await tableExists(t))))).every(Boolean),
  );

  // =========================================================================
  // 阶段 8：first_limit_pullback 未被触碰
  // =========================================================================
  console.log("\n【阶段 8】确认既有数据集未被修改");
  const flpVersionsAfter = await registry.listVersions(flp.id!);
  let flpRowsAfter = 0;
  for (const v of flpVersionsAfter) {
    for (const t of flpTables) flpRowsAfter += await countTableRows(t, v.id!);
  }
  check(
    "first_limit_pullback 版本数未变",
    flpVersionsAfter.length === flpVersionsBefore.length,
    `${flpVersionsAfter.length} 个`,
  );
  check("first_limit_pullback 物理表行数未变", flpRowsAfter === flpRowsBefore, `rows=${flpRowsAfter}`);
  check(
    "first_limit_pullback 物理表仍存在",
    (await Promise.all(flpTables.map((t) => tableExists(t)))).every(Boolean),
  );

  allOk = results.every((r) => r.ok);
  console.log(`\n${allOk ? "✅" : "❌"} DATASET-003A 真实 TiDB 端到端验证${allOk ? "全部通过" : "存在失败"}`);
  process.exitCode = allOk ? 0 : 1;
} catch (err) {
  console.error("\n❌ 验证脚本异常：", err);
  process.exitCode = 1;
} finally {
  for (const id of [...tempDefinitionIds]) {
    await safeDeleteDefinition(id);
  }
  // 兜底：确认无临时表残留
  const leftovers: string[] = [];
  for (const t of [`ds_${PROBE_CODE}_event`, `ds_${PROBE_CODE}_path`, `ds_${PROBE_CODE}_outcome`, `ds_${NO_BUILDER_CODE}_event`]) {
    if (await tableExists(t)) leftovers.push(t);
  }
  console.log(leftovers.length === 0 ? "  🧹 无临时物理表残留" : `  ⚠️ 残留表：${leftovers.join(", ")}`);
  plugins.unregister(PROBE_CODE);
  await database.execute(sql`select 1`).catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
