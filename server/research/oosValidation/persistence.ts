/**
 * OOS-001 §13 — 两表仓储（`oos_validation_run` / `oos_validation_result`；读写唯一落点）。
 *
 * ## 纪律
 *
 * - **只写这两张表**：对 `parameter_search_*` / `closed_loop_backtest_run` / 任何策略与数据集表
 *   **只读**（且只读经 `parameterSearch/persistence.ts` 的既有读函数，不新写一套 SQL
 *   —— 那是第二套读取实现，会造成口径漂移）；
 *   ⇒ 规格 §16 T3「OOS 不修改 Search Result」由此成为**结构事实**（本文件没有任何 UPDATE 它们的能力）；
 * - **快照写入即冻结**：`ON DUPLICATE KEY UPDATE` 的集合**不含** `resolvedParameterSetJson` /
 *   `searchSnapshotJson` / `searchSnapshotFingerprint` / 窗口 / FIXED 坐标
 *   —— 重放不得改写历史口径（规格 §5「OOS 不允许调参」在持久层的落地）；
 * - **幂等**：两表都有 UNIQUE 键（`oosRunId`；`(oosRunId, sourceParameterHash)`）
 *   ⇒ 重复 `start` 覆盖同一批行，不堆重复；
 * - 🔴 **不 `JSON.stringify` 非有限数**：`double` 列遇 `NaN / Infinity` 会被 mysql2 静默转成
 *   `null`（= 把「算出来了但是坏的」伪装成「没有这个值」）⇒ 统一走 `finiteOrNull` 守卫
 *   （**复用** `parameterSearch/persistence.ts` 的同一实现，不另写一份）。
 */

import { asc, desc, eq, sql } from "drizzle-orm";
import { oosValidationResult, oosValidationRun } from "../../../drizzle/schema";
import type { ParameterSearchRunStatus } from "../../../shared/parameterSearchContracts";
import { getDb } from "../../db";
import { finiteOrNull } from "../parameterSearch/persistence";

/** 取 DB（缺失即响亮抛错，不静默返回空列表让调用方以为「没有数据」）。 */
async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new Error("OOS 持久化失败：数据库不可用（getDb() 返回 undefined）");
  }
  return db;
}

function toDate(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`非法时间戳：${iso}`);
  return date;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Run 插入输入（**不含**任何结果字段；快照 / 窗口 / 冻结参数集写入即冻结）。
 *
 * 🔴 `sourceCombinationIndex` 允许为 `null`（源组合行可能已被重建，索引只是展示字段）；
 *   **身份**始终是 `sourceParameterHash`。
 */
export interface InsertOosValidationRunInput {
  readonly oosRunId: string;
  readonly sourceSearchRunId: string;
  readonly sourceParameterHash: string;
  readonly sourceCombinationIndex: number | null;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyVersionId: string;
  readonly strategyDefinitionFingerprint: string | null;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly searchStartDate: string;
  readonly searchEndDate: string;
  readonly oosStartDate: string;
  readonly oosEndDate: string;
  readonly searchSnapshotJson: string;
  readonly searchSnapshotFingerprint: string;
  readonly fixedCoordinatesJson: string;
  readonly executionPolicyVersion: number;
  readonly evaluationConfigFingerprint: string;
  readonly resolvedParameterSetJson: string;
  readonly metricsVersion: string;
  readonly engineVersion: string;
  readonly status: ParameterSearchRunStatus;
  readonly runFingerprint: string;
  readonly notesJson: string | null;
  readonly createdAt: string;
}

/** 幂等创建 Run（重放只刷 `updatedAt`，快照 / 窗口 / 冻结参数集一律不动）。 */
export async function insertOosValidationRun(input: InsertOosValidationRunInput): Promise<void> {
  const db = await requireDb();
  await db
    .insert(oosValidationRun)
    .values({
      oosRunId: input.oosRunId,
      sourceSearchRunId: input.sourceSearchRunId,
      sourceParameterHash: input.sourceParameterHash,
      sourceCombinationIndex: input.sourceCombinationIndex,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      strategyVersionId: input.strategyVersionId,
      strategyDefinitionFingerprint: input.strategyDefinitionFingerprint,
      datasetVersionId: input.datasetVersionId,
      datasetVersionLabel: input.datasetVersionLabel,
      searchStartDate: input.searchStartDate,
      searchEndDate: input.searchEndDate,
      oosStartDate: input.oosStartDate,
      oosEndDate: input.oosEndDate,
      searchSnapshotJson: input.searchSnapshotJson,
      searchSnapshotFingerprint: input.searchSnapshotFingerprint,
      fixedCoordinatesJson: input.fixedCoordinatesJson,
      executionPolicyVersion: input.executionPolicyVersion,
      evaluationConfigFingerprint: input.evaluationConfigFingerprint,
      resolvedParameterSetJson: input.resolvedParameterSetJson,
      metricsVersion: input.metricsVersion,
      engineVersion: input.engineVersion,
      status: input.status,
      runFingerprint: input.runFingerprint,
      notesJson: input.notesJson,
      createdAt: toDate(input.createdAt) ?? new Date(),
    })
    .onDuplicateKeyUpdate({ set: { updatedAt: sql`now()` } });
}

/** Run 状态更新补丁（**不含**快照 / 窗口 / 冻结参数集 —— 那些写入即冻结）。 */
export interface UpdateOosValidationRunInput {
  readonly status?: ParameterSearchRunStatus;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly notesJson?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

/** 更新 Run（只允许状态类字段）。 */
export async function updateOosValidationRun(
  oosRunId: string,
  patch: UpdateOosValidationRunInput,
): Promise<void> {
  const db = await requireDb();
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) set["status"] = patch.status;
  if (patch.startedAt !== undefined) set["startedAt"] = toDate(patch.startedAt);
  if (patch.completedAt !== undefined) set["completedAt"] = toDate(patch.completedAt);
  if (patch.notesJson !== undefined) set["notesJson"] = patch.notesJson;
  if (patch.errorCode !== undefined) set["errorCode"] = patch.errorCode;
  if (patch.errorMessage !== undefined) set["errorMessage"] = patch.errorMessage;
  if (Object.keys(set).length === 0) return;
  await db.update(oosValidationRun).set(set).where(eq(oosValidationRun.oosRunId, oosRunId));
}

export type OosValidationRunRow = typeof oosValidationRun.$inferSelect;
export type OosValidationResultRow = typeof oosValidationResult.$inferSelect;

/** 读取单个 Run 行（不存在 ⇒ null，由调用方决定是 404 还是响亮拒绝）。 */
export async function getOosValidationRunRow(
  oosRunId: string,
): Promise<OosValidationRunRow | null> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(oosValidationRun)
    .where(eq(oosValidationRun.oosRunId, oosRunId))
    .limit(1);
  return rows[0] ?? null;
}

/** 列出 Run 行（可按源 Search Run 过滤）。 */
export async function listOosValidationRunRows(options: {
  readonly limit: number;
  readonly offset?: number;
  readonly sourceSearchRunId?: string;
}): Promise<OosValidationRunRow[]> {
  const db = await requireDb();
  const base = db.select().from(oosValidationRun);
  const filtered =
    options.sourceSearchRunId === undefined
      ? base
      : base.where(eq(oosValidationRun.sourceSearchRunId, options.sourceSearchRunId));
  return filtered
    .orderBy(desc(oosValidationRun.createdAt))
    .limit(options.limit)
    .offset(options.offset ?? 0);
}

/** Run 的时间戳三元组（**统一读法**；全仓唯一，避免各调用方各取一次格式不同）。 */
export function oosRunTimestamps(row: OosValidationRunRow): {
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
} {
  return {
    createdAt: toIso(row.createdAt) ?? "",
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
  };
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Result 插入输入（IS 侧 = 冻结副本；OOS 侧 = 本次重跑读数）。 */
export interface UpsertOosValidationResultInput {
  readonly oosRunId: string;
  readonly sourceSearchRunId: string;
  readonly sourceParameterHash: string;
  readonly sourceCombinationIndex: number | null;
  readonly strategyVersionId: string;
  readonly datasetVersionId: number | null;
  readonly resolvedParameterSetJson: string;
  readonly searchStartDate: string;
  readonly searchEndDate: string;
  readonly oosStartDate: string;
  readonly oosEndDate: string;
  readonly isTotalReturnPct: number | null;
  readonly isAnnualizedReturnPct: number | null;
  readonly isMaxDrawdownPct: number | null;
  readonly isTradeCount: number | null;
  readonly isWinRatePct: number | null;
  readonly isProfitFactor: number | null;
  readonly isMetricsSource: string;
  readonly isAnnualizationBasisJson: string | null;
  readonly oosTotalReturnPct: number | null;
  readonly oosAnnualizedReturnPct: number | null;
  readonly oosMaxDrawdownPct: number | null;
  readonly oosTradeCount: number | null;
  readonly oosWinRatePct: number | null;
  readonly oosProfitFactor: number | null;
  readonly oosMetricsSource: string;
  readonly oosAnnualizationBasisJson: string | null;
  readonly comparisonJson: string;
  readonly status: string;
  readonly error: string | null;
  readonly backtestFingerprint: string | null;
  readonly evaluationId: string | null;
  readonly evaluationRunId: string | null;
  readonly executionPolicyVersion: number;
  readonly metricsVersion: string;
  readonly engineVersion: string;
  readonly fingerprint: string;
  readonly notesJson: string;
}

/**
 * 幂等写结果（`(oosRunId, sourceParameterHash)` UNIQUE ⇒ 重复 start 覆盖同一行）。
 *
 * 🔴 所有数值列一律过 `finiteOrNull`：`NaN / Infinity` **不得**被 mysql2 静默写成 `NULL`
 *   而让调用方以为「本来就没有这个值」。
 */
export async function upsertOosValidationResult(
  input: UpsertOosValidationResultInput,
): Promise<void> {
  const db = await requireDb();
  const values = {
    oosRunId: input.oosRunId,
    sourceSearchRunId: input.sourceSearchRunId,
    sourceParameterHash: input.sourceParameterHash,
    sourceCombinationIndex: input.sourceCombinationIndex,
    strategyVersionId: input.strategyVersionId,
    datasetVersionId: input.datasetVersionId,
    resolvedParameterSetJson: input.resolvedParameterSetJson,
    searchStartDate: input.searchStartDate,
    searchEndDate: input.searchEndDate,
    oosStartDate: input.oosStartDate,
    oosEndDate: input.oosEndDate,
    isTotalReturnPct: finiteOrNull(input.isTotalReturnPct),
    isAnnualizedReturnPct: finiteOrNull(input.isAnnualizedReturnPct),
    isMaxDrawdownPct: finiteOrNull(input.isMaxDrawdownPct),
    isTradeCount: finiteOrNull(input.isTradeCount),
    isWinRatePct: finiteOrNull(input.isWinRatePct),
    isProfitFactor: finiteOrNull(input.isProfitFactor),
    isMetricsSource: input.isMetricsSource,
    isAnnualizationBasisJson: input.isAnnualizationBasisJson,
    oosTotalReturnPct: finiteOrNull(input.oosTotalReturnPct),
    oosAnnualizedReturnPct: finiteOrNull(input.oosAnnualizedReturnPct),
    oosMaxDrawdownPct: finiteOrNull(input.oosMaxDrawdownPct),
    oosTradeCount: finiteOrNull(input.oosTradeCount),
    oosWinRatePct: finiteOrNull(input.oosWinRatePct),
    oosProfitFactor: finiteOrNull(input.oosProfitFactor),
    oosMetricsSource: input.oosMetricsSource,
    oosAnnualizationBasisJson: input.oosAnnualizationBasisJson,
    comparisonJson: input.comparisonJson,
    status: input.status,
    error: input.error,
    backtestFingerprint: input.backtestFingerprint,
    evaluationId: input.evaluationId,
    evaluationRunId: input.evaluationRunId,
    executionPolicyVersion: input.executionPolicyVersion,
    metricsVersion: input.metricsVersion,
    engineVersion: input.engineVersion,
    fingerprint: input.fingerprint,
    notesJson: input.notesJson,
  };
  await db
    .insert(oosValidationResult)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        resolvedParameterSetJson: values.resolvedParameterSetJson,
        isTotalReturnPct: values.isTotalReturnPct,
        isAnnualizedReturnPct: values.isAnnualizedReturnPct,
        isMaxDrawdownPct: values.isMaxDrawdownPct,
        isTradeCount: values.isTradeCount,
        isWinRatePct: values.isWinRatePct,
        isProfitFactor: values.isProfitFactor,
        isMetricsSource: values.isMetricsSource,
        isAnnualizationBasisJson: values.isAnnualizationBasisJson,
        oosTotalReturnPct: values.oosTotalReturnPct,
        oosAnnualizedReturnPct: values.oosAnnualizedReturnPct,
        oosMaxDrawdownPct: values.oosMaxDrawdownPct,
        oosTradeCount: values.oosTradeCount,
        oosWinRatePct: values.oosWinRatePct,
        oosProfitFactor: values.oosProfitFactor,
        oosMetricsSource: values.oosMetricsSource,
        oosAnnualizationBasisJson: values.oosAnnualizationBasisJson,
        comparisonJson: values.comparisonJson,
        status: values.status,
        error: values.error,
        backtestFingerprint: values.backtestFingerprint,
        evaluationId: values.evaluationId,
        evaluationRunId: values.evaluationRunId,
        executionPolicyVersion: values.executionPolicyVersion,
        metricsVersion: values.metricsVersion,
        engineVersion: values.engineVersion,
        fingerprint: values.fingerprint,
        notesJson: values.notesJson,
        updatedAt: sql`now()`,
      },
    });
}

/** 读取结果行（不存在 ⇒ null；`CREATED` 状态下的正常形态）。 */
export async function getOosValidationResultRow(
  oosRunId: string,
): Promise<OosValidationResultRow | null> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(oosValidationResult)
    .where(eq(oosValidationResult.oosRunId, oosRunId))
    .orderBy(asc(oosValidationResult.id))
    .limit(1);
  return rows[0] ?? null;
}

/** 列出某 Run 的结果行（1 Run = 1 候选 ⇒ 实际为 0 或 1 行；仍按数组返回以便未来扩展）。 */
export async function listOosValidationResultRows(
  oosRunId: string,
): Promise<OosValidationResultRow[]> {
  const db = await requireDb();
  return db
    .select()
    .from(oosValidationResult)
    .where(eq(oosValidationResult.oosRunId, oosRunId))
    .orderBy(asc(oosValidationResult.id));
}
