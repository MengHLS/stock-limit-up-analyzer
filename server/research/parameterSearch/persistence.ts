/**
 * PARAMETER-001 §14 — Parameter Search 持久化（三表仓储；读写唯一落点）。
 *
 * ## 纪律
 *
 * - **只写这三张表**（`parameter_search_run` / `parameter_search_combination` /
 *   `parameter_search_result`）：不碰 `closed_loop_backtest_run`、不碰任何策略 / 数据集表；
 * - **状态收敛的唯一事实源 = 结果行**：`completedCount` / `failedCount` 一律由
 *   `parameter_search_result` 的实际行数**重算**（`recomputeRunCounters`），
 *   而不是靠调用方累加 —— 累加在 retry / resume / 进程中断后必然漂移；
 * - **幂等**：Run / Combination / Result 三张表都有 UNIQUE 键
 *   （`searchRunId`；`(searchRunId, parameterHash)`），写入一律
 *   `ON DUPLICATE KEY UPDATE` ⇒ 重放不会产生第二行；
 * - **不改历史**：`parameter_search_run.parameterSpaceJson` 只在 INSERT 时写，
 *   `ON DUPLICATE KEY UPDATE` 的集合里**不含**它（快照写入即冻结）；
 * - 🔴 **不 `JSON.stringify` 非有限数**：`double` 列遇 `NaN / Infinity` 会被 mysql2 静默转成
 *   `null`（= 把「算出来了但是坏的」伪装成「没有这个值」）⇒ 本层统一 `finiteOrNull()` 守卫。
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  datasetVersions,
  parameterSearchCombination,
  parameterSearchResult,
  parameterSearchRun,
} from "../../../drizzle/schema";
import type { ParameterSearchCombinationStatus, ParameterSearchRunStatus } from "../../../shared/parameterSearchContracts";
import { getDb } from "../../db";

/** 取 DB（缺失即响亮抛错，不静默返回空列表让调用方以为「没有数据」）。 */
async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Parameter Search 持久化失败：数据库不可用（getDb() 返回 undefined）");
  return db;
}

/**
 * PARAMETER-002 §9（N-01）— 只读：绑定数据集的**可用窗口**（**北京业务日**）。
 *
 * 🔴 为什么必须按北京时区取日：`dataset_version.startDate/endDate` 是 **UTC 时间戳**
 *   （北京日 `2024-09-01` 存成 `2024-08-31T16:00:00.000Z`）⇒ 直接 `toISOString().slice(0,10)`
 *   会**少一天**，于是「看起来在窗口内」的搜索窗口实际越界
 *   （N-02 排查实测：4 个组合全因越界失败、62 s 白跑）。
 *
 * 🔴 **只读**：本函数**绝不**修改 Dataset / Dataset Version 的任何字段。
 *   查不到该 `datasetVersionId` ⇒ 返回 `null`（不猜窗口）；调用方据此跳过前置校验并如实登记。
 */
export async function readDatasetVersionWindow(
  datasetVersionId: number,
): Promise<{ readonly startDate: string; readonly endDate: string } | null> {
  const db = await requireDb();
  const rows = await db
    .select({
      startDate: datasetVersions.startDate,
      endDate: datasetVersions.endDate,
    })
    .from(datasetVersions)
    .where(eq(datasetVersions.id, datasetVersionId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;

  /** UTC 时间戳 → 北京业务日（`YYYY-MM-DD`）。 */
  const beijingDate = (value: unknown): string => {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new Error(`dataset_version 日期列不是可解析时间戳：${String(value)}`);
    }
    return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  };

  return { startDate: beijingDate(row.startDate), endDate: beijingDate(row.endDate) };
}

/**
 * `NaN / Infinity` → `null`（明示：这不是「算出来的值」，而是「不可用」）。
 *
 * 🔴 **唯一实现**：下游鲁棒性域（`searchRobustness/persistence.ts`）**import 复用**本函数，
 *   而不是各写一份 —— 两处对「坏 double」的口径一旦不一致，就会一个写 `null`、
 *   一个把 `NaN` 交给 mysql2 静默转 `null`，排查时看不出差别。
 */
export function finiteOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) ? value : null;
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

/** Run 插入输入（已含快照与 FIXED 坐标；**不接受**任何结果字段）。 */
export interface InsertParameterSearchRunInput {
  readonly searchRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly searchMethod: string;
  readonly status: ParameterSearchRunStatus;
  readonly parameterSpaceJson: string;
  readonly parameterSpaceFingerprint: string;
  readonly fixedCoordinatesJson: string;
  readonly executionPolicyVersion: number;
  readonly evaluationConfigFingerprint: string;
  readonly combinationCount: number;
  readonly combinationSetFingerprint: string;
  readonly notesJson: string | null;
  /**
   * PARAMETER-002 死参数筛查结果（ROBUSTNESS-001 §12 依赖它做「参数引用状态继承」）。
   *
   * 🔴 为什么必须落库：下游稳健性分析要回答「被搜索的参数真的被策略消费了吗」，
   *   而它**不允许**回读当前策略版本来现算（那会把历史搜索用未来版本重新解释）。
   *   ⇒ 筛查结论必须**随 Search Run 冻结**。缺省 `undefined` ⇒ 写入 `NULL`（= 未知）。
   */
  readonly referenceCheckApplied?: boolean | null;
  /** 被排除的死参数 code 快照（JSON 数组字符串）；`undefined` ⇒ 写入 `NULL`。 */
  readonly unreferencedTunableCodesJson?: string | null;
}

/**
 * 幂等创建 Run。
 *
 * 🔴 `ON DUPLICATE KEY UPDATE` 的集合**刻意不含** `parameterSpaceJson` /
 *   `parameterSpaceFingerprint`：快照写入即冻结（未来策略改动不得重新解释历史 Run）。
 *   重放同一 `searchRunId` 只刷新 `updatedAt`（无副作用）。
 */
export async function insertParameterSearchRun(input: InsertParameterSearchRunInput): Promise<void> {
  const db = await requireDb();
  await db
    .insert(parameterSearchRun)
    .values({
      searchRunId: input.searchRunId,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      datasetVersionId: input.datasetVersionId,
      datasetVersionLabel: input.datasetVersionLabel,
      startDate: input.startDate,
      endDate: input.endDate,
      searchMethod: input.searchMethod,
      status: input.status,
      parameterSpaceJson: input.parameterSpaceJson,
      parameterSpaceFingerprint: input.parameterSpaceFingerprint,
      fixedCoordinatesJson: input.fixedCoordinatesJson,
      executionPolicyVersion: input.executionPolicyVersion,
      evaluationConfigFingerprint: input.evaluationConfigFingerprint,
      combinationCount: input.combinationCount,
      completedCount: 0,
      failedCount: 0,
      combinationSetFingerprint: input.combinationSetFingerprint,
      notesJson: input.notesJson,
      referenceCheckApplied: input.referenceCheckApplied ?? null,
      unreferencedTunableCodesJson: input.unreferencedTunableCodesJson ?? null,
    })
    .onDuplicateKeyUpdate({ set: { updatedAt: sql`now()` } });
}

/** Run 状态更新补丁（**不含**快照字段）。 */
export interface UpdateParameterSearchRunInput {
  readonly status?: ParameterSearchRunStatus;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly notesJson?: string | null;
}

/** 更新 Run 状态 / 时间戳 / 说明（不触碰快照）。 */
export async function updateParameterSearchRun(
  searchRunId: string,
  patch: UpdateParameterSearchRunInput,
): Promise<void> {
  const db = await requireDb();
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (patch.status !== undefined) set["status"] = patch.status;
  if (patch.startedAt !== undefined) set["startedAt"] = toDate(patch.startedAt);
  if (patch.completedAt !== undefined) set["completedAt"] = toDate(patch.completedAt);
  if (patch.errorCode !== undefined) set["errorCode"] = patch.errorCode;
  if (patch.errorMessage !== undefined) set["errorMessage"] = patch.errorMessage;
  if (patch.notesJson !== undefined) set["notesJson"] = patch.notesJson;
  await db.update(parameterSearchRun).set(set).where(eq(parameterSearchRun.searchRunId, searchRunId));
}

/**
 * 由结果行重算并写回 Run 计数（**唯一**计数来源）。
 *
 * 返回重算结果（供调用方断言 / 打印）。SKIPPED 组合**不**计入任何一边。
 */
export async function recomputeRunCounters(searchRunId: string): Promise<{
  readonly completedCount: number;
  readonly failedCount: number;
}> {
  const db = await requireDb();
  const rows = await db
    .select({ status: parameterSearchResult.status })
    .from(parameterSearchResult)
    .where(eq(parameterSearchResult.searchRunId, searchRunId));
  const completedCount = rows.filter((row) => row.status === "SUCCEEDED").length;
  const failedCount = rows.filter((row) => row.status === "FAILED").length;
  await db
    .update(parameterSearchRun)
    .set({ completedCount, failedCount, updatedAt: sql`now()` })
    .where(eq(parameterSearchRun.searchRunId, searchRunId));
  return { completedCount, failedCount };
}

export type ParameterSearchRunRow = typeof parameterSearchRun.$inferSelect;

/** 读取单个 Run 行（不存在返回 null）。 */
export async function getParameterSearchRunRow(
  searchRunId: string,
): Promise<ParameterSearchRunRow | null> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(parameterSearchRun)
    .where(eq(parameterSearchRun.searchRunId, searchRunId))
    .limit(1);
  return rows[0] ?? null;
}

/** 列表（按创建时间倒序；不读长文本快照列，列表页不需要）。 */
export async function listParameterSearchRunRows(options: {
  readonly limit: number;
  readonly offset?: number;
  readonly strategyId?: string;
}): Promise<ParameterSearchRunRow[]> {
  const db = await requireDb();
  const base = db
    .select({
      id: parameterSearchRun.id,
      searchRunId: parameterSearchRun.searchRunId,
      strategyId: parameterSearchRun.strategyId,
      strategyVersion: parameterSearchRun.strategyVersion,
      datasetVersionId: parameterSearchRun.datasetVersionId,
      datasetVersionLabel: parameterSearchRun.datasetVersionLabel,
      startDate: parameterSearchRun.startDate,
      endDate: parameterSearchRun.endDate,
      searchMethod: parameterSearchRun.searchMethod,
      status: parameterSearchRun.status,
      parameterSpaceJson: sql<string>`''`.as("parameterSpaceJson"),
      parameterSpaceFingerprint: parameterSearchRun.parameterSpaceFingerprint,
      fixedCoordinatesJson: sql<string>`''`.as("fixedCoordinatesJson"),
      executionPolicyVersion: parameterSearchRun.executionPolicyVersion,
      evaluationConfigFingerprint: parameterSearchRun.evaluationConfigFingerprint,
      combinationCount: parameterSearchRun.combinationCount,
      completedCount: parameterSearchRun.completedCount,
      failedCount: parameterSearchRun.failedCount,
      combinationSetFingerprint: parameterSearchRun.combinationSetFingerprint,
      notesJson: parameterSearchRun.notesJson,
      referenceCheckApplied: parameterSearchRun.referenceCheckApplied,
      unreferencedTunableCodesJson: parameterSearchRun.unreferencedTunableCodesJson,
      errorCode: parameterSearchRun.errorCode,
      errorMessage: parameterSearchRun.errorMessage,
      createdAt: parameterSearchRun.createdAt,
      startedAt: parameterSearchRun.startedAt,
      completedAt: parameterSearchRun.completedAt,
      updatedAt: parameterSearchRun.updatedAt,
    })
    .from(parameterSearchRun);
  const filtered =
    options.strategyId === undefined
      ? base
      : base.where(eq(parameterSearchRun.strategyId, options.strategyId));
  return filtered
    .orderBy(desc(parameterSearchRun.createdAt), desc(parameterSearchRun.id))
    .limit(options.limit)
    .offset(options.offset ?? 0);
}

// ---------------------------------------------------------------------------
// Combination
// ---------------------------------------------------------------------------

/** 组合插入输入。 */
export interface InsertParameterSearchCombinationInput {
  readonly searchRunId: string;
  readonly combinationIndex: number;
  readonly parameterHash: string;
  readonly parametersJson: string;
}

/**
 * 幂等写入组合（计划层）。
 *
 * 🔴 重复生成同一 Run 时**不改** `status` / `attemptCount`（那是执行事实，不是计划事实）；
 *   只修正 `combinationIndex` 与 `parametersJson` 以对齐本次生成结果。
 */
export async function insertParameterSearchCombinations(
  rows: readonly InsertParameterSearchCombinationInput[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await requireDb();
  const CHUNK = 200;
  let written = 0;
  for (let index = 0; index < rows.length; index += CHUNK) {
    const chunk = rows.slice(index, index + CHUNK);
    await db
      .insert(parameterSearchCombination)
      .values(
        chunk.map((row) => ({
          searchRunId: row.searchRunId,
          combinationIndex: row.combinationIndex,
          parameterHash: row.parameterHash,
          parametersJson: row.parametersJson,
          status: "PENDING",
          attemptCount: 0,
        })),
      )
      .onDuplicateKeyUpdate({
        set: {
          combinationIndex: sql`values(${sql.identifier("combinationIndex")})`,
          parametersJson: sql`values(${sql.identifier("parametersJson")})`,
          updatedAt: sql`now()`,
        },
      });
    written += chunk.length;
  }
  return written;
}

export type ParameterSearchCombinationRow = typeof parameterSearchCombination.$inferSelect;

/** 列出 Run 的全部组合（按序号升序）。 */
export async function listParameterSearchCombinationRows(
  searchRunId: string,
): Promise<ParameterSearchCombinationRow[]> {
  const db = await requireDb();
  return db
    .select()
    .from(parameterSearchCombination)
    .where(eq(parameterSearchCombination.searchRunId, searchRunId))
    .orderBy(asc(parameterSearchCombination.combinationIndex), asc(parameterSearchCombination.id));
}

/** 按 hash 读取若干组合（retry 用）。 */
export async function getParameterSearchCombinationRows(
  searchRunId: string,
  parameterHashes: readonly string[],
): Promise<ParameterSearchCombinationRow[]> {
  if (parameterHashes.length === 0) return [];
  const db = await requireDb();
  return db
    .select()
    .from(parameterSearchCombination)
    .where(
      and(
        eq(parameterSearchCombination.searchRunId, searchRunId),
        inArray(parameterSearchCombination.parameterHash, [...parameterHashes]),
      ),
    );
}

/** 更新组合执行状态（`attemptIncrement` 用于 retry 计数）。 */
export async function updateParameterSearchCombinationStatus(input: {
  readonly searchRunId: string;
  readonly parameterHash: string;
  readonly status: ParameterSearchCombinationStatus;
  readonly attemptIncrement?: number;
  readonly lastError?: string | null;
}): Promise<void> {
  const db = await requireDb();
  await db
    .update(parameterSearchCombination)
    .set({
      status: input.status,
      ...(input.attemptIncrement === undefined
        ? {}
        : { attemptCount: sql`${parameterSearchCombination.attemptCount} + ${input.attemptIncrement}` }),
      ...(input.lastError === undefined ? {} : { lastError: input.lastError }),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(parameterSearchCombination.searchRunId, input.searchRunId),
        eq(parameterSearchCombination.parameterHash, input.parameterHash),
      ),
    );
}

/** 批量把仍处于 RUNNING 的组合收敛为 FAILED（进程中断后的重启收敛；不假装它们还在跑）。 */
export async function failLingeringCombinations(
  searchRunId: string,
  reason: string,
): Promise<number> {
  const db = await requireDb();
  const rows = await db
    .update(parameterSearchCombination)
    .set({ status: "FAILED", lastError: reason, updatedAt: sql`now()` })
    .where(
      and(
        eq(parameterSearchCombination.searchRunId, searchRunId),
        eq(parameterSearchCombination.status, "RUNNING"),
      ),
    );
  return Number((rows as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** 结果 upsert 输入（值域已由 `searchResult.ts` 的投影层规范化）。 */
export interface UpsertParameterSearchResultInput {
  readonly searchRunId: string;
  readonly combinationIndex: number;
  readonly parameterHash: string;
  readonly parametersJson: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly error: string | null;
  readonly totalReturnPct: number | null;
  readonly annualizedReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly tradeCount: number | null;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly metricsSource: string;
  readonly annualizationBasisJson: string | null;
  readonly backtestFingerprint: string | null;
  readonly backtestRunId: string | null;
  readonly evaluationId: string | null;
  readonly evaluationRunId: string | null;
  readonly evaluationJson: string | null;
  readonly reproductionJson: string | null;
}

/**
 * 幂等写入结果（重试覆盖同一行）。
 *
 * 🔴 `finiteOrNull` 守卫：`double` 列遇 `NaN / Infinity` 会被 mysql2 静默转 `null`，
 *   与「本来就没有这个值」不可区分 ⇒ 在此显式归一并保持语义诚实。
 */
export async function upsertParameterSearchResult(
  input: UpsertParameterSearchResultInput,
): Promise<void> {
  const db = await requireDb();
  await db
    .insert(parameterSearchResult)
    .values({
      searchRunId: input.searchRunId,
      combinationIndex: input.combinationIndex,
      parameterHash: input.parameterHash,
      parametersJson: input.parametersJson,
      status: input.status,
      error: input.error,
      totalReturnPct: finiteOrNull(input.totalReturnPct),
      annualizedReturnPct: finiteOrNull(input.annualizedReturnPct),
      maxDrawdownPct: finiteOrNull(input.maxDrawdownPct),
      tradeCount: input.tradeCount,
      winRatePct: finiteOrNull(input.winRatePct),
      profitFactor: finiteOrNull(input.profitFactor),
      metricsSource: input.metricsSource,
      annualizationBasisJson: input.annualizationBasisJson,
      backtestFingerprint: input.backtestFingerprint,
      backtestRunId: input.backtestRunId,
      evaluationId: input.evaluationId,
      evaluationRunId: input.evaluationRunId,
      evaluationJson: input.evaluationJson,
      reproductionJson: input.reproductionJson,
    })
    .onDuplicateKeyUpdate({
      set: {
        combinationIndex: input.combinationIndex,
        parametersJson: input.parametersJson,
        status: input.status,
        error: input.error,
        totalReturnPct: finiteOrNull(input.totalReturnPct),
        annualizedReturnPct: finiteOrNull(input.annualizedReturnPct),
        maxDrawdownPct: finiteOrNull(input.maxDrawdownPct),
        tradeCount: input.tradeCount,
        winRatePct: finiteOrNull(input.winRatePct),
        profitFactor: finiteOrNull(input.profitFactor),
        metricsSource: input.metricsSource,
        annualizationBasisJson: input.annualizationBasisJson,
        backtestFingerprint: input.backtestFingerprint,
        backtestRunId: input.backtestRunId,
        evaluationId: input.evaluationId,
        evaluationRunId: input.evaluationRunId,
        evaluationJson: input.evaluationJson,
        reproductionJson: input.reproductionJson,
        updatedAt: sql`now()`,
      },
    });
}

export type ParameterSearchResultRow = typeof parameterSearchResult.$inferSelect;

/**
 * 列出 Run 的全部结果行。
 *
 * ⚠️ `evaluationJson` 可能是数百 KB（完整评估引用）⇒ **列表 / 排序不需要它**，
 *   故默认不取（`includeEvaluation: false`），详情页才取。
 */
export async function listParameterSearchResultRows(
  searchRunId: string,
  options: { readonly includeEvaluation?: boolean } = {},
): Promise<ParameterSearchResultRow[]> {
  const db = await requireDb();
  const includeEvaluation = options.includeEvaluation === true;
  return db
    .select({
      id: parameterSearchResult.id,
      searchRunId: parameterSearchResult.searchRunId,
      combinationIndex: parameterSearchResult.combinationIndex,
      parameterHash: parameterSearchResult.parameterHash,
      parametersJson: parameterSearchResult.parametersJson,
      status: parameterSearchResult.status,
      error: parameterSearchResult.error,
      totalReturnPct: parameterSearchResult.totalReturnPct,
      annualizedReturnPct: parameterSearchResult.annualizedReturnPct,
      maxDrawdownPct: parameterSearchResult.maxDrawdownPct,
      tradeCount: parameterSearchResult.tradeCount,
      winRatePct: parameterSearchResult.winRatePct,
      profitFactor: parameterSearchResult.profitFactor,
      metricsSource: parameterSearchResult.metricsSource,
      annualizationBasisJson: parameterSearchResult.annualizationBasisJson,
      backtestFingerprint: parameterSearchResult.backtestFingerprint,
      backtestRunId: parameterSearchResult.backtestRunId,
      evaluationId: parameterSearchResult.evaluationId,
      evaluationRunId: parameterSearchResult.evaluationRunId,
      evaluationJson: includeEvaluation
        ? parameterSearchResult.evaluationJson
        : sql<string | null>`null`.as("evaluationJson"),
      reproductionJson: parameterSearchResult.reproductionJson,
      createdAt: parameterSearchResult.createdAt,
      updatedAt: parameterSearchResult.updatedAt,
    })
    .from(parameterSearchResult)
    .where(eq(parameterSearchResult.searchRunId, searchRunId))
    .orderBy(asc(parameterSearchResult.combinationIndex), asc(parameterSearchResult.id));
}

/** 读取单个结果行（详情 / retry 判据）。 */
export async function getParameterSearchResultRow(
  searchRunId: string,
  parameterHash: string,
): Promise<ParameterSearchResultRow | null> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(parameterSearchResult)
    .where(
      and(
        eq(parameterSearchResult.searchRunId, searchRunId),
        eq(parameterSearchResult.parameterHash, parameterHash),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** 把 Run 行投影为 ISO 时间字符串（供视图层统一处理）。 */
export function runRowTimestamps(row: ParameterSearchRunRow): {
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
} {
  return {
    createdAt: toIso(row.createdAt) as string,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
  };
}

// ---------------------------------------------------------------------------
// Cache（规格 §13）：五要素一致则复用已有**成功**结果
// ---------------------------------------------------------------------------

/**
 * 查找可复用的已有成功结果（**跨 Run**）。
 *
 * 判据 = 规格 §13 的五要素**逐字段相等**：
 *   `strategyVersionId` + `datasetVersionId` + `parameterHash` +
 *   `executionPolicyVersion` + `evaluationConfigFingerprint`。
 *
 * 🔴 只认 `status = SUCCEEDED` 的结果行：失败结果**不复用**
 *   （失败可能是瞬时故障，复用会把「偶发失败」永久化）。
 * 🔴 不排除发起方自己的 Run：同一 Run 内 resume 时，`SUCCEEDED` 也已经由
 *   「resume 跳过」分支处理；本函数额外用于「组合尚未在本 Run 落结果，但别的 Run 已经算过」的场景。
 */
export async function findReusableResult(input: {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly datasetVersionId: number | null;
  readonly parameterHash: string;
  readonly executionPolicyVersion: number;
  readonly evaluationConfigFingerprint: string;
  /** 排除某个 Run（一般排除自己，避免「自己复用自己」的空转）。 */
  readonly excludeSearchRunId?: string;
}): Promise<{ readonly row: ParameterSearchResultRow; readonly searchRunId: string } | null> {
  const db = await requireDb();
  const conditions = [
    eq(parameterSearchResult.parameterHash, input.parameterHash),
    eq(parameterSearchResult.status, "SUCCEEDED"),
    eq(parameterSearchRun.strategyId, input.strategyId),
    eq(parameterSearchRun.strategyVersion, input.strategyVersion),
    eq(parameterSearchRun.executionPolicyVersion, input.executionPolicyVersion),
    eq(parameterSearchRun.evaluationConfigFingerprint, input.evaluationConfigFingerprint),
  ];
  if (input.excludeSearchRunId !== undefined) {
    conditions.push(sql`${parameterSearchResult.searchRunId} <> ${input.excludeSearchRunId}`);
  }
  if (input.datasetVersionId === null) {
    conditions.push(sql`${parameterSearchRun.datasetVersionId} is null`);
  } else {
    conditions.push(eq(parameterSearchRun.datasetVersionId, input.datasetVersionId));
  }

  const rows = await db
    .select({ result: parameterSearchResult })
    .from(parameterSearchResult)
    .innerJoin(
      parameterSearchRun,
      eq(parameterSearchResult.searchRunId, parameterSearchRun.searchRunId),
    )
    .where(and(...conditions))
    .orderBy(desc(parameterSearchResult.updatedAt), desc(parameterSearchResult.id))
    .limit(1);

  const hit = rows[0];
  if (hit === undefined) return null;
  return { row: hit.result, searchRunId: hit.result.searchRunId };
}
