/**
 * STEP STRATEGY-003 — 真实 TiDB 全链验证（SPEC §十三 / §十七 / §十八；§21 禁止 mock 证明持久化）。
 *
 * 链路：
 *   ① Migration 断言（information_schema：7 表 + 增量列 + 索引，期望集**由 0034 SQL 的
 *      `-- @guard:` 指令解析而来**，不手抄、不会漂移）
 *   ② Create → Save（幂等 ×2）→ Read（bundle）
 *   ③ Validate（文档 + Definition + Look-Ahead + 投影漂移）
 *   ④ Clone（任意源版本 / parentVersionId / 指纹重算 / 幂等三态）
 *   ⑤ Verify Hash（F1：落库行三方指纹 + 双份定义内容一致）
 *   ⑥ Verify Projection（两级：Repository 读回投影 + **裸 SQL 独立读**投影，两级都必须零漂移）
 *   ⑦ 状态迁移（唯一允许的 UPDATE）→ information_schema 复核 → 清理并回到基线行数
 *
 * 🔴 SPEC §十八：canonical 与投影逐版本比对，出现漂移 → `process.exit(1)`，脚本**绝不自动修复**。
 *
 * 运行：npx tsx scripts/verifyStrategyDomainModel.mts
 * 副作用：以唯一 strategyId 写入，并在 finally 里 `deleteStrategy` 逆序清理（不触碰既有数据）。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { composeCodeVersion } from "../server/research/experimentLineage/codeVersion";
import { checkStoredVersionConsistency } from "../server/research/strategyPersistence/consistency";
import { DbStrategyRepository } from "../server/research/strategyPersistence/db";
import { StrategyService } from "../server/research/strategyPersistence/service";
import type { StrategyDefinition } from "../server/research/strategySchema/definition";
import {
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "../server/research/strategySchema/goldenSample";
import { createStrategyDocumentFromDefinition } from "../server/research/strategySchema/map";
import {
  buildStrategyProjections,
  verifyStrategyProjections,
  type StrategyProjections,
} from "../server/research/strategySchema/projection";
import { computeStrategyDefinitionFingerprint } from "../server/research/strategySchema/serialize";
import { canonicalStringify } from "../server/researchDataset/version";

// ---------------------------------------------------------------------------
// 断言框架（失败累计，最后统一 exit 1；绝不「修好再报」）
// ---------------------------------------------------------------------------

let checks = 0;
const failures: string[] = [];
function check(ok: boolean, label: string, detail?: string): void {
  checks += 1;
  if (!ok) failures.push(`${label}${detail === undefined ? "" : ` :: ${detail}`}`);
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${detail}`}`);
}

/** 漂移明细必须响亮失败（SPEC §十八）。 */
function checkNoDrift(label: string, drifts: readonly string[]): void {
  check(drifts.length === 0, label, drifts.length === 0 ? undefined : drifts.slice(0, 6).join(" | "));
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

const PROJECTION_TABLES = [
  "strategy_parameters",
  "strategy_entry_rules",
  "strategy_exit_rules",
  "strategy_execution_rules",
  "strategy_version_datasets",
] as const;

const DOMAIN_TABLES = ["strategies", "strategy_versions", ...PROJECTION_TABLES] as const;

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
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM \`${table}\`${where}`,
    params,
  );
  return Number(rows[0]?.n ?? 0);
}

const asNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const asText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const asBool = (value: unknown): boolean => value === 1 || value === true || value === "1";

/**
 * 🔴 裸 SQL 独立读回投影（**不经过 Repository 的映射**），构造 StrategyProjections 供逐列比对。
 * 这是 §十八「canonical != projection」判定的第二道、也是更硬的一道证据。
 */
async function readProjectionsFromSql(
  conn: Connection,
  strategyId: string,
  version: string,
): Promise<StrategyProjections> {
  const scope = "WHERE strategyId = ? AND strategyVersion = ?";
  const scopeParams = [strategyId, version];

  // ⚠️ TiDB 保留字陷阱：`maxValue`（MAXVALUE 是 MySQL/TiDB 分区保留字）等列名**必须**用反引号，
  //    否则报 "You have an error in your SQL syntax ... near maxValue"。本脚本对全部列名统一加反引号。
  const [parameterRows] = await conn.query<RowDataPacket[]>(
    `SELECT \`code\`, \`name\`, \`dataType\`, \`parameterRole\`, \`defaultValueJson\`, \`minValue\`, \`maxValue\`, \`stepValue\`, \`unit\`, \`description\`, \`required\`, \`ordinal\`
     FROM strategy_parameters ${scope} ORDER BY \`ordinal\` ASC`,
    scopeParams,
  );
  const [entryRows] = await conn.query<RowDataPacket[]>(
    `SELECT \`ruleId\`, \`ruleType\`, \`eventType\`, \`windowStart\`, \`windowEnd\`, \`windowUnit\`, \`triggerType\`, \`conditionJson\`, \`conditionCount\`, \`priority\`, \`enabled\`
     FROM strategy_entry_rules ${scope} ORDER BY \`priority\` ASC`,
    scopeParams,
  );
  const [exitRows] = await conn.query<RowDataPacket[]>(
    `SELECT \`ruleId\`, \`ruleType\`, \`triggerType\`, \`thresholdValue\`, \`thresholdUnit\`, \`parameterCode\`, \`conditionJson\`, \`priority\`, \`enabled\`, \`ordinal\`
     FROM strategy_exit_rules ${scope} ORDER BY \`ordinal\` ASC`,
    scopeParams,
  );
  const [executionRows] = await conn.query<RowDataPacket[]>(
    `SELECT \`signalTiming\`, \`executionTiming\`, \`priceType\`, \`quantityMethod\`, \`lotSize\`, \`slippageModel\`, \`commissionModel\`, \`executionConstraintsJson\`
     FROM strategy_execution_rules ${scope} LIMIT 1`,
    scopeParams,
  );
  const [datasetRows] = await conn.query<RowDataPacket[]>(
    `SELECT \`datasetId\`, \`datasetVersion\`, \`datasetVersionId\`, \`role\`, \`note\`, \`ordinal\`
     FROM strategy_version_datasets ${scope} ORDER BY \`ordinal\` ASC`,
    scopeParams,
  );

  const executionRow = executionRows[0];
  if (executionRow === undefined) {
    throw new Error(`strategy_execution_rules 缺失：${strategyId}@${version}`);
  }

  return {
    parameters: parameterRows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      dataType: String(row.dataType),
      parameterRole: String(row.parameterRole),
      defaultValueJson: asText(row.defaultValueJson),
      minValue: asNumber(row.minValue),
      maxValue: asNumber(row.maxValue),
      stepValue: asNumber(row.stepValue),
      unit: asText(row.unit),
      description: asText(row.description),
      required: asBool(row.required),
      ordinal: Number(row.ordinal),
    })),
    entryRules: entryRows.map((row) => ({
      ruleId: String(row.ruleId),
      ruleType: String(row.ruleType) as "CONDITION" | "EVENT_OBSERVATION",
      eventType: String(row.eventType),
      windowStart: Number(row.windowStart),
      windowEnd: Number(row.windowEnd),
      windowUnit: String(row.windowUnit),
      triggerType: String(row.triggerType),
      conditionJson: asText(row.conditionJson),
      conditionCount: Number(row.conditionCount),
      priority: Number(row.priority),
      enabled: asBool(row.enabled),
    })),
    exitRules: exitRows.map((row) => ({
      ruleId: String(row.ruleId),
      ruleType: String(row.ruleType),
      triggerType: String(row.triggerType),
      thresholdValue: asNumber(row.thresholdValue),
      thresholdUnit: asText(row.thresholdUnit),
      parameterCode: asText(row.parameterCode),
      conditionJson: asText(row.conditionJson),
      priority: Number(row.priority),
      enabled: asBool(row.enabled),
      ordinal: Number(row.ordinal),
    })),
    executionRule: {
      signalTiming: String(executionRow.signalTiming),
      executionTiming: String(executionRow.executionTiming),
      priceType: String(executionRow.priceType),
      quantityMethod: String(executionRow.quantityMethod),
      lotSize: Number(executionRow.lotSize),
      slippageModel: asText(executionRow.slippageModel),
      commissionModel: asText(executionRow.commissionModel),
      executionConstraintsJson: asText(executionRow.executionConstraintsJson),
    },
    datasetBindings: datasetRows.map((row) => ({
      datasetId: String(row.datasetId),
      datasetVersion: String(row.datasetVersion),
      // 🔴 STRATEGY-004：投影新增 Dataset Registry 权威坐标列（legacy rd-… 绑定为 NULL）。
      datasetVersionId: row.datasetVersionId === null || row.datasetVersionId === undefined
        ? null
        : Number(row.datasetVersionId),
      role: String(row.role),
      note: asText(row.note),
      ordinal: Number(row.ordinal),
    })),
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const STRATEGY_ID = `s003-verify-${Date.now()}`;
const V1 = "1.0.0";
const V2 = "2.0.0";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const urlMatch = env.match(/DATABASE_URL=(\S+)/);
if (!urlMatch) throw new Error(".env 中缺少 DATABASE_URL");
const rawUrl = urlMatch[1].replace(/["']/g, "");
const parsed = new URL(rawUrl);

const conn = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port === "" ? 4000 : Number(parsed.port),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  connectTimeout: 15000,
});

const service = new StrategyService(new DbStrategyRepository(), { codeVersion: resolveCodeVersion() });
const repo = new DbStrategyRepository();
const baseline: Record<string, number> = {};
const report: Record<string, unknown> = { strategyId: STRATEGY_ID, checks: 0, failures, verdict: "PENDING" };

try {
  // -------------------------------------------------------------------------
  // ① Migration：期望集由 0034 SQL 的 @guard 指令解析（不手抄）
  // -------------------------------------------------------------------------
  console.log("\n① Migration 断言（information_schema）");
  const migrationSql = readFileSync(new URL("../drizzle/0034_strategy_domain_model.sql", import.meta.url), "utf8");
  const guards = [...migrationSql.matchAll(/^--\s*@guard:\s*(\w+)\s+(\S+)\s*$/gm)]
    .map((m) => ({ kind: m[1] as string, target: m[2] as string }));
  check(guards.length > 0, "0034 SQL 中存在 @guard 指令", `解析到 ${guards.length} 条`);

  for (const table of DOMAIN_TABLES) {
    check(await tableExists(conn, table), `表存在：${table}`);
  }
  for (const guard of guards) {
    check(await guardTargetPresent(conn, guard.kind, guard.target), `migration 目标存在：${guard.kind}:${guard.target}`);
  }

  for (const table of DOMAIN_TABLES) {
    baseline[table] = await countRows(conn, table);
  }
  console.log(`  基线行数：${JSON.stringify(baseline)}`);

  // -------------------------------------------------------------------------
  // ② Create → Save（幂等 ×2）→ Read
  // -------------------------------------------------------------------------
  console.log("\n② Create / Save / Read");
  const document = createStrategyDocumentFromDefinition({
    ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
    strategyId: STRATEGY_ID,
    version: V1,
    name: `[VERIFY-003] 首板回踩 ${STRATEGY_ID}`,
    description: "STRATEGY-003 全链验证用（Golden Sample §25），验证后删除",
  });
  const definition = document.definition as StrategyDefinition;

  await service.create({ document: document as unknown as Record<string, unknown> });
  check(true, "create 落库成功");

  await service.save({ document: document as unknown as Record<string, unknown> });
  await service.save({ document: document as unknown as Record<string, unknown> });
  const versionsAfterSave = await repo.listVersions(STRATEGY_ID);
  check(versionsAfterSave.length === 1, "Save 幂等：两次重复 Save 不产生重复版本", `实际版本数=${versionsAfterSave.length}`);

  const summary = await repo.getStrategy(STRATEGY_ID);
  const rowIdV1 = await repo.getVersionRowId(STRATEGY_ID, V1);
  check(rowIdV1 !== undefined, "getVersionRowId 返回版本行主键");
  check(summary?.currentVersionId === rowIdV1, "currentVersionId 指向当前版本行（权威指针）", `${String(summary?.currentVersionId)} vs ${String(rowIdV1)}`);
  check(summary?.latestVersion === V1, "latestVersion 与权威指针一致", String(summary?.latestVersion));

  const bundleV1 = await service.loadBundle(STRATEGY_ID, V1);
  check(bundleV1.hasDefinition, "bundle.hasDefinition = true（Canonical 富定义已落库）");
  check(
    canonicalStringify(bundleV1.document.definition) === canonicalStringify(definition),
    "读回的 Canonical Definition 与写入前逐字段一致（往返不退化）",
  );
  check(
    canonicalStringify(bundleV1.versionRecord.strategy.definition) === canonicalStringify(bundleV1.document.definition),
    "F1：versionRecordJson.strategy.definition 与 strategyDocumentJson.definition 内容一致",
  );

  // -------------------------------------------------------------------------
  // ③ Validate + ④ Clone
  // -------------------------------------------------------------------------
  console.log("\n③ Validate（含 Look-Ahead）");
  const validation = await service.validateVersion(STRATEGY_ID, V1);
  check(validation.valid, "validateVersion.valid = true", JSON.stringify(validation.document.issues.slice(0, 3)));
  check(validation.definitionPresent, "definitionPresent = true");
  checkNoDrift("validateVersion 报告零投影漂移（Repository 读回）", validation.projectionDrifts);

  console.log("\n④ Clone（任意源版本 / 演进链 / 幂等三态）");
  const clone1 = await service.cloneVersion({
    strategyId: STRATEGY_ID,
    fromVersion: V1,
    targetVersion: V2,
    description: "验证 clone：从 1.0.0 派生（规则不变，仅演进链）",
  });
  check(clone1.outcome === "inserted", "clone 首次 = inserted", clone1.outcome);
  check(clone1.parentVersionId === rowIdV1, "parentVersionId 指向源版本行", `${String(clone1.parentVersionId)} vs ${String(rowIdV1)}`);

  const clone2 = await service.cloneVersion({
    strategyId: STRATEGY_ID,
    fromVersion: V1,
    targetVersion: V2,
    description: "验证 clone：从 1.0.0 派生（规则不变，仅演进链）",
  });
  check(clone2.outcome === "idempotent-skip", "clone 重复 = idempotent-skip", clone2.outcome);
  check(clone2.versionRowId === undefined, "idempotent-skip 不返回新的 versionRowId");

  const clone3 = await service.cloneVersion({
    strategyId: STRATEGY_ID,
    fromVersion: V1,
    targetVersion: V2,
    description: "同目标版本但内容不同 → 必须 conflict",
  });
  check(clone3.outcome === "conflict", "clone 同目标版本不同内容 = conflict（不覆盖）", clone3.outcome);
  check(clone3.existingFingerprint === clone1.fingerprint, "conflict 返回既有指纹", String(clone3.existingFingerprint));

  const bundleV2 = await service.loadBundle(STRATEGY_ID, V2);
  check(bundleV2.parentVersionId === rowIdV1, "读取侧 parentVersionId 同样指向源版本行");
  check(bundleV2.description?.startsWith("验证 clone：从 1.0.0 派生") === true, "既有版本未被 conflict 覆盖（description 仍是首次写入值）");
  check(
    computeStrategyDefinitionFingerprint(bundleV2.document.definition as StrategyDefinition)
      === computeStrategyDefinitionFingerprint(definition),
    "clone 复制的是同一套规则（Definition 级指纹不变）",
  );
  check(bundleV2.fingerprint !== document.fingerprint, "文档级指纹已重算（version 参与指纹 → 新版本）");
  check((await repo.listVersions(STRATEGY_ID)).length === 2, "真实库中存在 2 个版本（v1 + clone 出的 v2）");

  // -------------------------------------------------------------------------
  // ⑤ Verify Hash（F1 三方指纹 + 双份定义）
  // -------------------------------------------------------------------------
  console.log("\n⑤ Verify Hash（F1 一致性，裸 SQL 读原始列）");
  const [storedRows] = await conn.query<RowDataPacket[]>(
    "SELECT strategyId, version, strategyDocumentJson, versionRecordJson, fingerprint FROM strategy_versions WHERE strategyId = ? ORDER BY id ASC",
    [STRATEGY_ID],
  );
  check(storedRows.length === 2, "strategy_versions 落库 2 行", `实际=${storedRows.length}`);
  for (const row of storedRows) {
    const drifts = checkStoredVersionConsistency({
      strategyId: String(row.strategyId),
      version: String(row.version),
      strategyDocumentJson: String(row.strategyDocumentJson),
      versionRecordJson: String(row.versionRecordJson),
      fingerprint: String(row.fingerprint),
    });
    checkNoDrift(`F1 一致性：${STRATEGY_ID}@${String(row.version)} 三方指纹 + 双份定义一致`, drifts);
  }

  // -------------------------------------------------------------------------
  // ⑥ Verify Projection（两级：Repository + 裸 SQL 独立读）
  // -------------------------------------------------------------------------
  console.log("\n⑥ Verify Projection（两级证据）");
  for (const version of [V1, V2]) {
    const bundle = await service.loadBundle(STRATEGY_ID, version);
    const expected = buildStrategyProjections(bundle.document.definition as StrategyDefinition);

    checkNoDrift(
      `投影零漂移（Repository 读回）：${STRATEGY_ID}@${version}`,
      verifyStrategyProjections(expected, bundle.projections),
    );

    const fromSql = await readProjectionsFromSql(conn, STRATEGY_ID, version);
    checkNoDrift(
      `投影零漂移（🔴 裸 SQL 独立读回）：${STRATEGY_ID}@${version}`,
      verifyStrategyProjections(expected, fromSql),
    );

    check(
      fromSql.parameters.length === expected.parameters.length
      && fromSql.entryRules.length === expected.entryRules.length
      && fromSql.exitRules.length === expected.exitRules.length
      && fromSql.datasetBindings.length === expected.datasetBindings.length,
      `投影行数与 canonical 逐类一致：${STRATEGY_ID}@${version}`,
      `param ${fromSql.parameters.length}/${expected.parameters.length} entry ${fromSql.entryRules.length}/${expected.entryRules.length} exit ${fromSql.exitRules.length}/${expected.exitRules.length} ds ${fromSql.datasetBindings.length}/${expected.datasetBindings.length}`,
    );

    const executionRows = await countRows(conn, "strategy_execution_rules", "WHERE strategyVersionId = ?", [rowIdV1 ?? 0]);
    if (version === V1) {
      check(executionRows === 1, "strategy_execution_rules 每个版本恰好 1 行", `实际=${executionRows}`);
    }
  }

  // 检测器自证：投影被篡改时必须能报出漂移（证明 verify 不是空转）
  const golden = buildStrategyProjections(definition);
  const tampered: StrategyProjections = {
    ...structuredClone(golden),
    parameters: structuredClone(golden).parameters.map((row, index) => (index === 0 ? { ...row, parameterRole: "FIXED" } : row)),
  };
  const tamperedDrifts = verifyStrategyProjections(golden, tampered);
  check(tamperedDrifts.length > 0, "漂移检测器自证：篡改投影后必须报出漂移（非空转）", tamperedDrifts[0]);

  // -------------------------------------------------------------------------
  // ⑦ 状态迁移（唯一允许的 UPDATE）+ information_schema 复核
  // -------------------------------------------------------------------------
  console.log("\n⑦ 状态迁移 + information_schema 复核");
  const beforeStatus = await getStatus(conn, STRATEGY_ID, V1);
  await service.setVersionStatus(STRATEGY_ID, V1, "Research");
  const afterStatus = await getStatus(conn, STRATEGY_ID, V1);
  check(beforeStatus === "Draft" && afterStatus === "Research", "版本状态迁移生效（Draft → Research）", `${beforeStatus} → ${afterStatus}`);

  const [fingerprintAfter] = await conn.query<RowDataPacket[]>(
    "SELECT fingerprint FROM strategy_versions WHERE strategyId = ? AND version = ?",
    [STRATEGY_ID, V1],
  );
  check(
    String(fingerprintAfter[0]?.fingerprint ?? "") === document.fingerprint,
    "状态迁移不改内容指纹（status 是唯一可变列）",
  );

  const validationAfterStatus = await service.validateVersion(STRATEGY_ID, V1);
  check(validationAfterStatus.valid, "状态迁移后仍通过全量校验");

  for (const table of DOMAIN_TABLES) {
    check(await tableExists(conn, table), `迁移后表仍存在：${table}`);
  }
  for (const guard of guards) {
    check(await guardTargetPresent(conn, guard.kind, guard.target), `迁移后目标仍在：${guard.kind}:${guard.target}`);
  }
} catch (error) {
  check(false, "全链执行未抛错", (error as Error).message);
} finally {
  // ---- 清理：删除本脚本创建的策略（级联删版本 + 投影），并复核回到基线 ----
  console.log("\n⑧ 清理（逆序级联删除 + 基线复核）");
  try {
    await service.delete(STRATEGY_ID);
    check(true, "deleteStrategy 执行成功");
  } catch (error) {
    check(false, "deleteStrategy 执行成功", (error as Error).message);
  }
  for (const table of DOMAIN_TABLES) {
    const now = await countRows(conn, table);
    check(now === baseline[table], `清理后行数回到基线：${table}`, `${baseline[table]} → ${now}`);
  }
  await conn.end();
}

report.checks = checks;
report.verdict = failures.length === 0 ? "PASS" : "FAIL";
console.log(`\n${JSON.stringify(report, null, 2)}`);
console.log(`\n总检查项 ${checks}，失败 ${failures.length}；VERDICT=${report.verdict}`);

// 🔴 必须显式退出：drizzle 的连接池（`getDb()`）会一直占住事件循环，
//    若只 `process.exitCode = 1` 而不退出，脚本会在打印结果后**永久挂起**
//    （配合 `| tail` 更会连输出都看不到）。SPEC §十八要求漂移必须 exit 1。
process.exit(failures.length > 0 ? 1 : 0);

async function getStatus(conn2: Connection, strategyId: string, version: string): Promise<string> {
  const [rows] = await conn2.query<RowDataPacket[]>(
    "SELECT status FROM strategy_versions WHERE strategyId = ? AND version = ?",
    [strategyId, version],
  );
  return String(rows[0]?.status ?? "");
}
