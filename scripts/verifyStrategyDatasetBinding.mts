/**
 * STEP STRATEGY-004 — Strategy ↔ Dataset Registry 绑定对齐与引用完整性 · **真实 TiDB 全链验证**
 * （SPEC §9 判定矩阵 / §10 API 测试 / §12 真实 TiDB 验收）。
 *
 * 与 `verifyStrategyDomainModel.mts`（STRATEGY-003）的区别：本脚本**额外**从**真实 tRPC 入口**进入
 * （`appRouter.createCaller` → `research.strategy.*` → StrategyService → DbStrategyRepository → TiDB），
 * 以证明「不只是 Domain Unit Test 通过」。
 *
 * 链路：
 *   ① Migration 断言（0035 SQL 的 `-- @guard:` 指令解析 → 2 列 + 2 索引，期望集不手抄、不漂移）
 *   ② 真实 Dataset Registry 事实（dataset_definition / dataset_version 现状 + 非 READY 版本存在性）
 *   ③ 真实 tRPC 全链路（11 个 endpoint：create / save / load / list / listVersions / loadVersion /
 *      loadBundle / getVersionBundle / validateVersion / createVersion / cloneVersion / setVersionStatus / delete）
 *   ④ 真实 SQL 断言（坐标落库 + **JOIN dataset_version → v2 / READY**）
 *   ⑤ 非法引用判定矩阵（NOT_FOUND / NOT_READY / BINDING_INVALID × label 不一致 × 交叉绑定）
 *   ⑥ 多绑定规则（PRIMARY + VALIDATION + OOS 全 READY → PASS；双 PRIMARY → 拒绝）
 *   ⑦ Legacy 兼容（`rd-…` 无坐标 → 保存成功、datasetVersionId 落 NULL）
 *   ⑧ 清理 + 基线复核（行数回到脚本启动时的基线）
 *
 * 🔴 纪律：
 *   - **只读 Dataset**：本脚本**不写入** `dataset_definition` / `dataset_version` / `dataset_build_job` / `ds_*`
 *     （SPEC §8）。NOT_READY 场景在真实库中暂无对应行，因此在**只读端口**这一已文档化的接缝上做状态覆盖，
 *     并在场景前后复核 Dataset 表行数与状态**逐字节未变** —— 不伪造数据、不冒充「真实非 READY 行」。
 *   - **失败响亮**：任一检查失败 → `process.exit(1)`，绝不自动修复。
 *
 * 运行：npx tsx scripts/verifyStrategyDatasetBinding.mts
 * 副作用：以唯一 strategyId 写入策略（仅 strategy_* 表），finally 逆序清理。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { composeCodeVersion } from "../server/research/experimentLineage/codeVersion";
import { DbDatasetRegistry } from "../server/datasetRegistry/db";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import {
  STRATEGY_DATASET_BINDING_ERROR_CODES,
  StrategyDatasetBindingError,
  type DatasetDefinitionReference,
  type DatasetVersionReference,
  type DatasetVersionReferencePort,
} from "../server/research/strategyPersistence/datasetBindingValidation";
import { validateStrategyDocument } from "../server/research/strategySchema/validate";
import type { StrategyDatasetBinding, StrategyDefinitionInput } from "../server/research/strategySchema/definition";
import {
  FIRST_BOARD_PULLBACK_DEFINITION,
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "../server/research/strategySchema/goldenSample";
import { createStrategyDocumentFromDefinition } from "../server/research/strategySchema/map";
import type { StrategyDocument } from "../server/research/strategySchema/types";

// ---------------------------------------------------------------------------
// 断言框架（失败累计，最后统一 exit 1）
// ---------------------------------------------------------------------------

let checks = 0;
const failures: string[] = [];
function check(ok: boolean, label: string, detail?: string): void {
  checks += 1;
  if (!ok) failures.push(`${label}${detail === undefined ? "" : ` :: ${detail}`}`);
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${detail}`}`);
}

function checkEq<T>(actual: T, expected: T, label: string): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(same, label, same ? undefined : `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
}

function resolveCodeVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return composeCodeVersion({
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      git: { commitShortHash: null, dirty: null },
    });
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// 只读端口：状态覆盖（Dataset 表零改动）
// ---------------------------------------------------------------------------

/**
 * 只读状态覆盖端口：把真实 `DbDatasetRegistry` 的读取结果里的 `status` 替换为指定值。
 *
 * 用途：真实库当前**只有** READY 版本（390001 / 390002），而 SPEC §9 要求验证 NOT_READY 拒绝路径。
 * 在「不写 Dataset 表」（SPEC §8 硬禁止）的前提下，唯一诚实的做法是在**只读接缝**上做状态覆盖 ——
 * 校验门看到的仍是真实行的 id / datasetId / version，只有 status 被替换。
 */
class ReadOnlyDatasetStatusOverride implements DatasetVersionReferencePort {
  readonly calls: number[] = [];
  constructor(
    private readonly inner: DatasetVersionReferencePort,
    private readonly overrides: ReadonlyMap<number, string>,
  ) {}

  async getVersionById(id: number): Promise<DatasetVersionReference | undefined> {
    this.calls.push(id);
    const version = await this.inner.getVersionById(id);
    if (version === undefined) return undefined;
    const override = this.overrides.get(id);
    return override === undefined ? version : { ...version, status: override };
  }

  getDefinitionById(id: number): Promise<DatasetDefinitionReference | undefined> {
    return this.inner.getDefinitionById(id);
  }
}

// ---------------------------------------------------------------------------
// 文档装配
// ---------------------------------------------------------------------------

/** Golden Sample 的 Definition，仅替换 `datasets` 绑定（其余全部保持 Canonical 语义）。 */
function definitionWith(bindings: readonly StrategyDatasetBinding[]): StrategyDefinitionInput {
  return { ...structuredClone(FIRST_BOARD_PULLBACK_DEFINITION), datasets: bindings };
}

/** 由绑定集合装配完整文档；`universeId` 严格由 PRIMARY label 派生（避免 SCHEMA_UNIVERSE_DATASET_MISMATCH）。 */
function documentWith(
  strategyId: string,
  version: string,
  bindings: readonly StrategyDatasetBinding[],
  label: string,
): StrategyDocument {
  const primary = bindings.find((binding) => binding.role === "PRIMARY");
  return createStrategyDocumentFromDefinition({
    ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
    strategyId,
    version,
    name: `[VERIFY-004] ${label} ${strategyId}`,
    description: `STRATEGY-004 全链验证（${label}），验证后删除`,
    universe: { universeId: `research-dataset:${primary?.datasetVersion ?? ""}` },
    definition: definitionWith(bindings),
  });
}

const coordinate = (over: Partial<StrategyDatasetBinding> = {}): StrategyDatasetBinding => ({
  datasetId: "first_limit_pullback",
  datasetVersion: "v2",
  datasetVersionId: 390002,
  role: "PRIMARY",
  note: "STRATEGY-004 验证：Registry 权威坐标 v2",
  ...over,
});

const legacy = (over: Partial<StrategyDatasetBinding> = {}): StrategyDatasetBinding => ({
  datasetId: "ds_first_limit_pullback",
  datasetVersion: FIRST_BOARD_PULLBACK_DEFINITION.datasets[0].datasetVersion,
  role: "PRIMARY",
  note: "STRATEGY-004 验证：legacy rd-… 兼容分支（保留）",
  ...over,
});

// ---------------------------------------------------------------------------
// 错误码判定（穿透 tRPC 包装 / 领域错误直抛）
// ---------------------------------------------------------------------------

const BINDING_CODES: ReadonlySet<string> = new Set<string>(STRATEGY_DATASET_BINDING_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 从错误链（tRPC TRPCError 可能包一层）中提取 Dataset Binding 错误码。 */
function extractBindingCode(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 8 && isRecord(cursor); depth += 1) {
    const code = cursor.code;
    if (typeof code === "string" && BINDING_CODES.has(code)) return code;
    if (cursor instanceof StrategyDatasetBindingError) return cursor.code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

/** 抽取「首个非 Dataset Binding 的领域校验错误码」（用于形态非法场景，证明分层拒绝）。 */
function extractAnyIssueCode(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 8 && isRecord(cursor); depth += 1) {
    const issues = (cursor as { issues?: unknown }).issues;
    if (Array.isArray(issues) && issues.length > 0 && isRecord(issues[0]) && typeof issues[0].code === "string") {
      return String(issues[0].code);
    }
    const code = cursor.code;
    if (typeof code === "string" && /^SCHEMA_/.test(code)) return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// SQL 辅助
// ---------------------------------------------------------------------------

async function tableExists(conn: Connection, table: string): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function guardTargetPresent(conn: Connection, kind: string, target: string): Promise<boolean> {
  if (kind === "table") return tableExists(conn, target);
  const [table, name] = target.split(".");
  const view = kind === "column" ? "COLUMNS" : "STATISTICS";
  const field = kind === "column" ? "COLUMN_NAME" : "INDEX_NAME";
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.${view} WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND ${field} = ?`,
    [table, name],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function countRows(conn: Connection, table: string, where = "", params: unknown[] = []): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\`${where}`, params);
  return Number(rows[0]?.n ?? 0);
}

/** 某 strategyId 的全部落库痕迹（用于「非法引用必须零写入」判定）。 */
async function writeFootprint(conn: Connection, strategyId: string): Promise<{ entities: number; versions: number; projections: number }> {
  const entities = await countRows(conn, "strategies", "WHERE strategyId = ?", [strategyId]);
  const versions = await countRows(conn, "strategy_versions", "WHERE strategyId = ?", [strategyId]);
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM strategy_version_datasets svd JOIN strategy_versions sv ON sv.id = svd.strategyVersionId WHERE sv.strategyId = ?",
    [strategyId],
  );
  return { entities, versions, projections: Number(rows[0]?.n ?? 0) };
}

const TABLES = [
  "strategies",
  "strategy_versions",
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_version_datasets",
] as const;

/**
 * 自愈：清理本脚本历史运行残留的 `s004-%` 策略（上一次运行中途抛错时 `finally` 之外的
 * 步骤不会执行）。**只**匹配本脚本专属前缀，绝不触碰其它数据。
 */
async function purgeOwnLeftovers(): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT DISTINCT strategyId FROM strategies WHERE strategyId LIKE 's004-%'",
  );
  let purged = 0;
  for (const row of rows) {
    const strategyId = String(row.strategyId);
    try {
      await service.delete(strategyId);
      purged += 1;
    } catch (error) {
      console.log(`  ⚠️ 残留清理失败 ${strategyId}：${(error as Error).message}`);
    }
  }
  return purged;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const STAMP = Date.now();
const S_CREATE = `s004-create-${STAMP}`;
const S_VERSION = `s004-version-${STAMP}`;
const S_MULTI = `s004-multi-${STAMP}`;
const S_LEGACY = `s004-legacy-${STAMP}`;
const S_NOTFOUND = `s004-notfound-${STAMP}`;
const S_NOTREADY = `s004-notready-${STAMP}`;
const S_CROSS = `s004-cross-${STAMP}`;
const S_LABEL = `s004-label-${STAMP}`;
const S_SHAPE = `s004-shape-${STAMP}`;
const S_DUPPK = `s004-duppk-${STAMP}`;
const ALL_STRATEGY_IDS = [
  S_CREATE, S_VERSION, S_MULTI, S_LEGACY, S_NOTFOUND, S_NOTREADY, S_CROSS, S_LABEL, S_SHAPE, S_DUPPK,
];

const V1 = "1.0.0";
const V2 = "2.0.0";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const urlMatch = env.match(/DATABASE_URL=(\S+)/);
if (!urlMatch) throw new Error(".env 中缺少 DATABASE_URL");
const parsed = new URL(urlMatch[1].replace(/["']/g, ""));

const conn = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port === "" ? 4000 : Number(parsed.port),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

const repo = new DbStrategyRepository();
const service = new StrategyService(repo, { codeVersion: resolveCodeVersion() });

const adminCtx: TrpcContext = {
  user: {
    id: 1,
    openId: "verify-004-admin",
    name: "STRATEGY-004 验证",
    email: null,
    loginMethod: null,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
};
const caller = appRouter.createCaller(adminCtx);
const api = caller.research.strategy;

const baseline: Record<string, number> = {};
const dsBaseline: Record<string, number> = {};
const report: Record<string, unknown> = { checks: 0, failures, verdict: "PENDING" };

try {
  // -------------------------------------------------------------------------
  // ① Migration 断言（期望集由 0035 SQL 的 @guard 解析而来）
  // -------------------------------------------------------------------------
  console.log("\n① Migration 断言（0035 · information_schema）");
  const migrationSql = readFileSync(new URL("../drizzle/0035_strategy_dataset_binding_version_id.sql", import.meta.url), "utf8");
  const guards = [...migrationSql.matchAll(/^--\s*@guard:\s*(\w+)\s+(\S+)\s*$/gm)]
    .map((match) => ({ kind: match[1] as string, target: match[2] as string }));
  check(guards.length === 4, "0035 SQL 解析出 4 条 @guard 指令（2 列 + 2 索引）", `实际=${guards.length}`);
  for (const guard of guards) {
    check(await guardTargetPresent(conn, guard.kind, guard.target), `migration 目标存在：${guard.kind}:${guard.target}`);
  }

  for (const table of TABLES) baseline[table] = await countRows(conn, table);
  console.log(`  基线行数（自愈前）：${JSON.stringify(baseline)}`);
  const purged = await purgeOwnLeftovers();
  if (purged > 0) console.log(`  ⚠️ 自愈：清理了上一次运行残留的 ${purged} 个 s004-% 策略`);
  for (const table of TABLES) baseline[table] = await countRows(conn, table);
  console.log(`  基线行数（自愈后）：${JSON.stringify(baseline)}`);
  checkEq(baseline.strategy_versions, 0, "基线 strategy_versions 为 0 行（本脚本从干净基线出发）");
  checkEq(baseline.strategy_version_datasets, 0, "基线 strategy_version_datasets 为 0 行");

  // -------------------------------------------------------------------------
  // ② 真实 Dataset Registry 事实（SPEC §12：390001 → v1；390002 → v2）
  // -------------------------------------------------------------------------
  console.log("\n② 真实 Dataset Registry 事实");
  dsBaseline.dataset_definition = await countRows(conn, "dataset_definition");
  dsBaseline.dataset_version = await countRows(conn, "dataset_version");

  const [definitionRows] = await conn.query<RowDataPacket[]>(
    "SELECT id, datasetCode, name FROM dataset_definition ORDER BY id ASC",
  );
  const firstPullback = definitionRows.find((row) => String(row.datasetCode) === "first_limit_pullback");
  check(firstPullback !== undefined, "dataset_definition 存在 datasetCode = first_limit_pullback");
  checkEq(Number(firstPullback?.id ?? 0), 120001, "first_limit_pullback 的 dataset_definition.id = 120001");

  const [versionRows] = await conn.query<RowDataPacket[]>(
    "SELECT id, datasetId, version, status FROM dataset_version ORDER BY id ASC",
  );
  const versionById = new Map(versionRows.map((row) => [Number(row.id), row]));
  const v1Row = versionById.get(390001);
  const v2Row = versionById.get(390002);
  checkEq(String(v1Row?.version ?? "(缺失)"), "v1", "dataset_version 390001 → version = v1");
  checkEq(String(v2Row?.version ?? "(缺失)"), "v2", "dataset_version 390002 → version = v2");
  checkEq(String(v1Row?.status ?? "(缺失)"), "READY", "dataset_version 390001.status = READY");
  checkEq(String(v2Row?.status ?? "(缺失)"), "READY", "dataset_version 390002.status = READY");
  checkEq(Number(v2Row?.datasetId ?? 0), 120001, "dataset_version 390002 属于 dataset_definition 120001");

  const nonReadyRows = versionRows.filter((row) => String(row.status) !== "READY");
  console.log(`  ⚠️ 真实库中非 READY 的 dataset_version 行数：${nonReadyRows.length}`);
  check(nonReadyRows.length === 0, "真实库现状：全部 dataset_version 均为 READY（NOT_READY 场景需只读端口覆盖）");

  // -------------------------------------------------------------------------
  // ③ 真实 tRPC 全链路（appRouter.createCaller → research.strategy.*）
  // -------------------------------------------------------------------------
  console.log("\n③ 真实 tRPC 全链路（create / save / load / list / listVersions / loadVersion）");
  const docCreate = documentWith(S_CREATE, V1, [coordinate()], "tRPC create");
  await api.create({ document: docCreate as unknown as Record<string, unknown> });
  check(true, "tRPC create 落库成功（坐标绑定 v2 / datasetVersionId=390002 / PRIMARY）");

  await api.save({ document: docCreate as unknown as Record<string, unknown> });
  await api.save({ document: docCreate as unknown as Record<string, unknown> });
  const versionsAfterSave = await api.listVersions({ strategyId: S_CREATE });
  checkEq(versionsAfterSave.length, 1, "tRPC save 幂等：两次重复 save 不产生重复版本");
  checkEq(versionsAfterSave[0]?.datasetVersion, "v2", "listVersions.datasetVersion = v2（label 快照）");
  checkEq(versionsAfterSave[0]?.datasetVersionId, 390002, "listVersions.datasetVersionId = 390002（权威坐标）");

  const loaded = await api.load({ strategyId: S_CREATE });
  checkEq(loaded.datasetVersionId, 390002, "tRPC load 返回 doc 级 datasetVersionId = 390002（由 PRIMARY 绑定单向派生）");

  const listed = await api.list();
  check(listed.some((item) => item.strategyId === S_CREATE), "tRPC list 包含新建策略");

  const record = await api.loadVersion({ strategyId: S_CREATE, version: V1 });
  checkEq(record.strategy.datasetVersionId, 390002, "tRPC loadVersion 返回 §17 追溯记录（含坐标）");

  const bundle = await api.loadBundle({ strategyId: S_CREATE, version: V1 });
  check(bundle.hasDefinition, "tRPC loadBundle.hasDefinition = true");
  checkEq(bundle.projections.datasetBindings.length, 1, "loadBundle 投影 datasetBindings 恰好 1 行");
  checkEq(bundle.projections.datasetBindings[0]?.datasetVersionId, 390002, "投影行 datasetVersionId = 390002");
  checkEq(bundle.projections.datasetBindings[0]?.role, "PRIMARY", "投影行 role = PRIMARY");

  const bundleAlias = await api.getVersionBundle({ strategyId: S_CREATE, version: V1 });
  checkEq(
    bundleAlias.fingerprint,
    bundle.fingerprint,
    "tRPC getVersionBundle 与 loadBundle 同实现同结果（指纹一致）",
  );

  const validation = await api.validateVersion({ strategyId: S_CREATE, version: V1 });
  check(validation.valid, "tRPC validateVersion.valid = true", JSON.stringify(validation.document.issues.slice(0, 3)));
  check(validation.definitionPresent, "validateVersion.definitionPresent = true");
  checkEq(validation.projectionDrifts.length, 0, "validateVersion 零投影漂移");

  // ---- ④ 真实 SQL 独立断言（JOIN Registry）----
  console.log("\n④ 真实 SQL 断言（strategy_versions / strategy_version_datasets JOIN dataset_version）");
  const [joined] = await conn.query<RowDataPacket[]>(
    `SELECT sv.strategyId, sv.version AS strategyVersion, sv.datasetVersionId, sv.datasetVersion AS labelSnapshot,
            dv.version AS registryVersion, dv.status AS registryStatus, dv.datasetId AS registryDatasetId,
            dd.datasetCode AS registryDatasetCode
     FROM strategy_versions sv
     LEFT JOIN dataset_version dv ON dv.id = sv.datasetVersionId
     LEFT JOIN dataset_definition dd ON dd.id = dv.datasetId
     WHERE sv.strategyId = ?`,
    [S_CREATE],
  );
  const joinedRow = joined[0];
  checkEq(Number(joinedRow?.datasetVersionId ?? 0), 390002, "SQL：strategy_versions.datasetVersionId = 390002");
  checkEq(String(joinedRow?.labelSnapshot ?? ""), "v2", "SQL：strategy_versions.datasetVersion（label 快照）= v2");
  checkEq(String(joinedRow?.registryVersion ?? ""), "v2", "SQL：JOIN dataset_version → version = v2");
  checkEq(String(joinedRow?.registryStatus ?? ""), "READY", "SQL：JOIN dataset_version → status = READY");
  checkEq(String(joinedRow?.registryDatasetCode ?? ""), "first_limit_pullback", "SQL：JOIN dataset_definition → datasetCode = first_limit_pullback");

  const [projectionRows] = await conn.query<RowDataPacket[]>(
    `SELECT svd.datasetId, svd.datasetVersion, svd.datasetVersionId, svd.role, svd.ordinal,
            dv.version AS registryVersion, dv.status AS registryStatus
     FROM strategy_version_datasets svd
     JOIN strategy_versions sv ON sv.id = svd.strategyVersionId
     LEFT JOIN dataset_version dv ON dv.id = svd.datasetVersionId
     WHERE sv.strategyId = ? ORDER BY svd.ordinal ASC`,
    [S_CREATE],
  );
  checkEq(projectionRows.length, 1, "SQL：strategy_version_datasets 落库 1 行");
  checkEq(String(projectionRows[0]?.role ?? ""), "PRIMARY", "SQL：投影 role = PRIMARY");
  checkEq(Number(projectionRows[0]?.datasetVersionId ?? 0), 390002, "SQL：投影 datasetVersionId = 390002");
  checkEq(String(projectionRows[0]?.registryVersion ?? ""), "v2", "SQL：投影 JOIN dataset_version → v2");
  checkEq(String(projectionRows[0]?.registryStatus ?? ""), "READY", "SQL：投影 JOIN dataset_version → READY");

  // -------------------------------------------------------------------------
  // ③' tRPC：cloneVersion / createVersion / setVersionStatus
  // -------------------------------------------------------------------------
  console.log("\n③' 真实 tRPC：cloneVersion / createVersion / setVersionStatus");
  const cloned = await api.cloneVersion({
    strategyId: S_VERSION,
    fromVersion: "0.9.0",
    targetVersion: V1,
  }).catch(() => undefined);
  check(cloned === undefined, "cloneVersion 对不存在的源版本必须失败（无静默兜底）");

  // 先把坐标版本落库（走 tRPC create），再 clone → createVersion
  const docVersion = documentWith(S_VERSION, V1, [coordinate()], "tRPC clone/createVersion");
  await api.create({ document: docVersion as unknown as Record<string, unknown> });

  const cloneResult = await api.cloneVersion({
    strategyId: S_VERSION,
    fromVersion: V1,
    targetVersion: V2,
    description: "STRATEGY-004 验证：clone 保留 Dataset 坐标",
  });
  checkEq(cloneResult.outcome, "inserted", "tRPC cloneVersion = inserted");
  checkEq(cloneResult.version, V2, "tRPC cloneVersion 目标版本 = 2.0.0");

  const cloneSkipped = await api.cloneVersion({
    strategyId: S_VERSION,
    fromVersion: V1,
    targetVersion: V2,
    description: "STRATEGY-004 验证：clone 保留 Dataset 坐标",
  });
  checkEq(cloneSkipped.outcome, "idempotent-skip", "tRPC cloneVersion 重复 = idempotent-skip");

  const bundleV2 = await api.loadBundle({ strategyId: S_VERSION, version: V2 });
  checkEq(bundleV2.document.datasetVersionId, 390002, "clone 出的 v2 仍带 datasetVersionId = 390002（坐标随 clone 复制）");
  checkEq(bundleV2.projections.datasetBindings[0]?.datasetVersionId, 390002, "clone 出的 v2 投影仍带坐标 = 390002");

  // createVersion：基于 latest（2.0.0）改一个参数默认值 → 自动判定 bump → 3.0.0
  const boostedDefinition = structuredClone(bundleV2.document.definition)!;
  boostedDefinition.parameters[0].defaultValue = 6;
  const wireForVersion = {
    ...structuredClone(bundleV2.document),
    description: "STRATEGY-004 验证：createVersion 改参数默认值（bump 由语义闸门自动判定）",
    definition: boostedDefinition,
  } as unknown as Record<string, unknown>;
  const created = await api.createVersion({
    strategyId: S_VERSION,
    document: wireForVersion,
  });
  checkEq(created.version, "3.0.0", "tRPC createVersion → 3.0.0（bump 由语义闸门自动判定为 major）");
  checkEq(created.datasetVersionId, 390002, "createVersion 产物保留 datasetVersionId = 390002");
  const bundleV3 = await api.loadBundle({ strategyId: S_VERSION, version: "3.0.0" });
  checkEq(bundleV3.projections.datasetBindings[0]?.datasetVersionId, 390002, "3.0.0 投影坐标仍为 390002");
  checkEq(bundleV3.document.datasetVersionId, 390002, "3.0.0 doc 级坐标仍为 390002");
  checkEq(bundleV3.parentVersionId, (await api.loadBundle({ strategyId: S_VERSION, version: V2 })).versionRowId, "3.0.0 的 parentVersionId 指向 2.0.0 行（演进链正确）");

  await api.setVersionStatus({ strategyId: S_VERSION, version: V1, status: "Research" });
  const [statusAfter] = await conn.query<RowDataPacket[]>(
    "SELECT status, fingerprint FROM strategy_versions WHERE strategyId = ? AND version = ?",
    [S_VERSION, V1],
  );
  checkEq(String(statusAfter[0]?.status ?? ""), "Research", "tRPC setVersionStatus 落库 Draft → Research");
  checkEq(String(statusAfter[0]?.fingerprint ?? ""), docVersion.fingerprint, "状态迁移不改内容指纹（status 是唯一可变列）");

  // -------------------------------------------------------------------------
  // ⑤ 非法引用判定矩阵（每条独立 strategyId；必须零写入）
  // -------------------------------------------------------------------------
  console.log("\n⑤ 非法引用判定矩阵（SPEC §9）");

  async function expectReject(
    strategyId: string,
    label: string,
    expectedCode: string,
    attempt: () => Promise<unknown>,
  ): Promise<void> {
    let caught: unknown;
    let succeeded = false;
    try {
      await attempt();
      succeeded = true;
    } catch (error) {
      caught = error;
    }
    if (succeeded) {
      check(false, label, "本应拒绝，却成功落库");
      return;
    }
    const actual = extractBindingCode(caught) ?? extractAnyIssueCode(caught) ?? "(无结构化错误码)";
    check(actual === expectedCode, label, `实际错误码=${actual}；message=${(caught as Error)?.message?.slice(0, 220)}`);
    const footprint = await writeFootprint(conn, strategyId);
    check(
      footprint.entities === 0 && footprint.versions === 0 && footprint.projections === 0,
      `${label} → 零写入（同一事务回滚）`,
      JSON.stringify(footprint),
    );
  }

  // ⑤-1 不存在的 dataset_version.id
  const docNotFound = documentWith(
    S_NOTFOUND,
    V1,
    [coordinate({ datasetVersionId: 999_999_999 })],
    "NOT_FOUND",
  );
  await expectReject(S_NOTFOUND, "FAIL 不存在坐标 999999999 → DATASET_VERSION_NOT_FOUND", "DATASET_VERSION_NOT_FOUND", () =>
    api.create({ document: docNotFound as unknown as Record<string, unknown> }));

  // ⑤-2 非 READY（只读端口状态覆盖；Dataset 表零改动）
  for (const badStatus of ["DRAFT", "BUILDING", "FAILED"] as const) {
    const overridePort = new ReadOnlyDatasetStatusOverride(new DbDatasetRegistry(), new Map([[390002, badStatus]]));
    const statusService = new StrategyService(new DbStrategyRepository(overridePort), { codeVersion: resolveCodeVersion() });
    const doc = documentWith(S_NOTREADY, V1, [coordinate()], `NOT_READY(${badStatus})`);
    await expectReject(
      S_NOTREADY,
      `FAIL status=${badStatus} → DATASET_VERSION_NOT_READY`,
      "DATASET_VERSION_NOT_READY",
      () => statusService.create({ document: doc as unknown as Record<string, unknown> }),
    );
    checkEq(overridePort.calls, [390002], `只读端口以真实坐标 390002 查询 Registry（status=${badStatus}）`);
  }
  // Dataset 表零改动复核（行数 + 状态 + 版本 label）
  const [afterOverride] = await conn.query<RowDataPacket[]>(
    "SELECT id, datasetId, version, status FROM dataset_version ORDER BY id ASC",
  );
  checkEq(
    afterOverride.map((row) => `${String(row.id)}:${String(row.datasetId)}:${String(row.version)}:${String(row.status)}`),
    versionRows.map((row) => `${String(row.id)}:${String(row.datasetId)}:${String(row.version)}:${String(row.status)}`),
    "NOT_READY 场景全程 Dataset 表逐行未变（只读端口覆盖，未写 Dataset）",
  );
  checkEq(await countRows(conn, "dataset_definition"), dsBaseline.dataset_definition, "dataset_definition 行数未变");
  checkEq(await countRows(conn, "dataset_version"), dsBaseline.dataset_version, "dataset_version 行数未变");

  // ⑤-3 交叉绑定：坐标指向 first_limit_pullback 的 v2，但声明别的 datasetId
  const docCross = documentWith(
    S_CROSS,
    V1,
    [coordinate({ datasetId: "second_board_pullback" })],
    "CROSS_BINDING",
  );
  await expectReject(S_CROSS, "FAIL 交叉绑定 datasetId → DATASET_BINDING_INVALID", "DATASET_BINDING_INVALID", () =>
    api.create({ document: docCross as unknown as Record<string, unknown> }));

  // ⑤-4 label 与 Registry 不一致：id=390002 却写 v1
  const docLabel = documentWith(
    S_LABEL,
    V1,
    [coordinate({ datasetVersion: "v1" })],
    "LABEL_MISMATCH",
  );
  await expectReject(S_LABEL, "FAIL id=390002 但 label=v1 → DATASET_BINDING_INVALID", "DATASET_BINDING_INVALID", () =>
    api.create({ document: docLabel as unknown as Record<string, unknown> }));

  // ⑤-5 坐标形态非法（datasetVersionId = 0）→ 领域校验层必须挡下（早于引用校验）
  let shapeRejected = false;
  let shapeCode = "(无)";
  try {
    const docShape = documentWith(S_SHAPE, V1, [coordinate({ datasetVersionId: 0 })], "SHAPE_INVALID");
    await api.create({ document: docShape as unknown as Record<string, unknown> });
  } catch (error) {
    shapeRejected = true;
    shapeCode = extractAnyIssueCode(error) ?? "(无结构化错误码)";
  }
  check(shapeRejected, "FAIL datasetVersionId = 0 → 领域校验层拒绝（向量形态非法）", `实际错误码=${shapeCode}`);
  checkEq(shapeCode, "SCHEMA_DEFINITION_DATASET_VERSION_ID_INVALID", "形态非法由 SCHEMA_DEFINITION_DATASET_VERSION_ID_INVALID 分层拒绝");
  checkEq(JSON.stringify(await writeFootprint(conn, S_SHAPE)), JSON.stringify({ entities: 0, versions: 0, projections: 0 }), "形态非法 → 零写入");

  // ⑤-6 坐标形态合法的 legacy rd-… label 冒充（rd-… 不得被当作 label）
  let rdAsLabelRejected = false;
  let rdAsLabelCode = "(无)";
  try {
    const docRdAsLabel = documentWith(
      S_LABEL,
      V1,
      [coordinate({ datasetVersion: FIRST_BOARD_PULLBACK_DEFINITION.datasets[0].datasetVersion })],
      "RD_AS_LABEL",
    );
    await api.create({ document: docRdAsLabel as unknown as Record<string, unknown> });
  } catch (error) {
    rdAsLabelRejected = true;
    rdAsLabelCode = extractAnyIssueCode(error) ?? extractBindingCode(error) ?? "(无结构化错误码)";
  }
  check(rdAsLabelRejected, "FAIL 声明坐标却把 rd-… 当 label → 拒绝（label 与 legacy 不得互相冒充）", `实际错误码=${rdAsLabelCode}`);

  // -------------------------------------------------------------------------
  // ⑥ 多绑定规则（PRIMARY + VALIDATION + OOS 全 READY → PASS；双 PRIMARY → 拒绝）
  // -------------------------------------------------------------------------
  console.log("\n⑥ 多绑定规则（SPEC §9 末项）");
  const docMulti = documentWith(S_MULTI, V1, [
    coordinate({ role: "PRIMARY", note: "PRIMARY：v2 全量窗口" }),
    coordinate({ role: "VALIDATION", datasetVersion: "v1", datasetVersionId: 390001, note: "VALIDATION：v1 子窗口" }),
    coordinate({ role: "OOS", datasetVersion: "v1", datasetVersionId: 390001, note: "OOS：v1 段外样本" }),
  ], "MULTI_BINDING");
  check(validateStrategyDocument(docMulti).valid, "多绑定文档通过领域校验（PRIMARY 唯一 + 去重 + role 白名单）");
  await api.create({ document: docMulti as unknown as Record<string, unknown> });
  const multiRows = await api.listVersions({ strategyId: S_MULTI });
  checkEq(multiRows.length, 1, "多绑定 create 成功落库 1 个版本");
  const [multiProjection] = await conn.query<RowDataPacket[]>(
    `SELECT svd.role, svd.datasetVersion, svd.datasetVersionId, dv.status AS registryStatus, svd.ordinal
     FROM strategy_version_datasets svd
     JOIN strategy_versions sv ON sv.id = svd.strategyVersionId
     LEFT JOIN dataset_version dv ON dv.id = svd.datasetVersionId
     WHERE sv.strategyId = ? ORDER BY svd.ordinal ASC`,
    [S_MULTI],
  );
  checkEq(multiProjection.length, 3, "SQL：多绑定投影落库 3 行");
  // 归一化顺序 = (role, datasetId, datasetVersion, datasetVersionId) 升序 ⇒ role 按字典序：
  // OOS < PRIMARY < VALIDATION（不是 role 白名单序）。此处断言真实归一化结果，不假设白名单序。
  checkEq(
    multiProjection.map((row) => `${String(row.role)}=${String(row.datasetVersionId)}`),
    ["OOS=390001", "PRIMARY=390002", "VALIDATION=390001"],
    "SQL：三条绑定 role → 坐标映射正确（ordinal = (role,datasetId,version,id) 升序）",
  );
  check(
    multiProjection.every((row) => String(row.registryStatus) === "READY"),
    "SQL：三条绑定的目标 dataset_version 全部 READY",
  );
  const multiBundle = await api.validateVersion({ strategyId: S_MULTI, version: V1 });
  check(multiBundle.valid, "多绑定版本通过 validateVersion 全量校验（含投影漂移）");

  // 双 PRIMARY → 领域层必须拒绝
  let dupPrimaryRejected = false;
  let dupPrimaryCode = "(无)";
  try {
    const docDupPrimary = documentWith(S_DUPPK, V1, [
      coordinate({ role: "PRIMARY", note: "第一个 PRIMARY" }),
      coordinate({ role: "PRIMARY", datasetVersion: "v1", datasetVersionId: 390001, note: "第二个 PRIMARY（非法）" }),
    ], "DUP_PRIMARY");
    await api.create({ document: docDupPrimary as unknown as Record<string, unknown> });
  } catch (error) {
    dupPrimaryRejected = true;
    dupPrimaryCode = extractAnyIssueCode(error) ?? "(无结构化错误码)";
  }
  check(dupPrimaryRejected, "FAIL 两个 PRIMARY binding → 领域校验拒绝", `实际错误码=${dupPrimaryCode}`);
  checkEq(JSON.stringify(await writeFootprint(conn, S_DUPPK)), JSON.stringify({ entities: 0, versions: 0, projections: 0 }), "双 PRIMARY → 零写入");

  // -------------------------------------------------------------------------
  // ⑦ Legacy 兼容（rd-… 无坐标 → 仍可保存；datasetVersionId 落 NULL）
  // -------------------------------------------------------------------------
  console.log("\n⑦ Legacy rd-… 兼容分支（SPEC §2.1 C：保留、不删除）");
  const docLegacy = documentWith(S_LEGACY, V1, [legacy()], "LEGACY");
  check(validateStrategyDocument(docLegacy).valid, "legacy 文档通过领域校验（无坐标分支形态合法）");
  checkEq(docLegacy.datasetVersionId, undefined, "legacy 文档无 doc 级 datasetVersionId（不冒充已校验坐标）");
  await api.create({ document: docLegacy as unknown as Record<string, unknown> });
  const legacyBundle = await api.loadBundle({ strategyId: S_LEGACY, version: V1 });
  checkEq(legacyBundle.projections.datasetBindings.length, 1, "legacy 投影仍落库 1 行（未被引用校验误杀）");
  checkEq(legacyBundle.projections.datasetBindings[0]?.datasetVersionId, null, "legacy 投影 datasetVersionId = NULL");
  const [legacySql] = await conn.query<RowDataPacket[]>(
    "SELECT datasetVersion, datasetVersionId FROM strategy_versions WHERE strategyId = ? AND version = ?",
    [S_LEGACY, V1],
  );
  checkEq(String(legacySql[0]?.datasetVersion ?? ""), FIRST_BOARD_PULLBACK_DEFINITION.datasets[0].datasetVersion, "SQL：legacy label 快照落库为 rd-… 串");
  check(legacySql[0]?.datasetVersionId === null, "SQL：legacy datasetVersionId 落库为 NULL（非 0、非伪造坐标）");
  check(
    (await api.validateVersion({ strategyId: S_LEGACY, version: V1 })).valid,
    "legacy 版本通过 validateVersion（兼容路径未被破坏）",
  );

  // -------------------------------------------------------------------------
  // ⑧ 清理在 finally 中执行（保证抛错路径同样回到基线）
  // -------------------------------------------------------------------------
} catch (error) {
  check(false, "全链执行未抛错", `${(error as Error).message}\n${(error as Error).stack?.split("\n").slice(0, 4).join("\n")}`);
} finally {
  // 🔴 清理必须放 finally：任一断言抛错时也要回到基线，脚本可重复运行。
  console.log("\n⑧ 清理（逆序级联删除 + 基线复核）");
  let deleted = 0;
  for (const strategyId of ALL_STRATEGY_IDS) {
    try {
      const footprint = await writeFootprint(conn, strategyId);
      if (footprint.entities === 0) continue;
      await service.delete(strategyId);
      deleted += 1;
    } catch (error) {
      check(false, `清理 ${strategyId}`, (error as Error).message);
    }
  }
  const purgedAgain = await purgeOwnLeftovers();
  check(deleted > 0 || purgedAgain > 0, `清理脚本本次创建的策略（显式 ${deleted} 个 / 自愈 ${purgedAgain} 个）`);
  for (const table of TABLES) {
    const now = await countRows(conn, table);
    checkEq(now, baseline[table] ?? 0, `清理后行数回到基线：${table}（${baseline[table] ?? 0} → ${now}）`);
  }
  checkEq(await countRows(conn, "strategies", "WHERE strategyId LIKE ?", ["s004-%"]), 0, "无残留 s004-% 策略");
  if (dsBaseline.dataset_version !== undefined) {
    checkEq(await countRows(conn, "dataset_version"), dsBaseline.dataset_version, "Dataset 表行数全程未变（dataset_version）");
    checkEq(await countRows(conn, "dataset_definition"), dsBaseline.dataset_definition, "Dataset 表行数全程未变（dataset_definition）");
  }
  await conn.end();
}

report.checks = checks;
report.verdict = failures.length > 0 ? "FAIL" : "PASS";
console.log(`\n${JSON.stringify(report, null, 2)}`);
console.log(`\n总检查项 ${checks}，失败 ${failures.length}；VERDICT=${report.verdict}`);

// 🔴 必须显式退出：drizzle 连接池会占住事件循环，仅设 exitCode 会永久挂起。
process.exit(failures.length > 0 ? 1 : 0);
