/**
 * ROBUSTNESS-001 §13 / §14 / §15 — 三表仓储（读写唯一落点）。
 *
 * ## 纪律
 *
 * - **只写这三张表**（`search_robustness_run` / `_result` / `_parameter_analysis`）：
 *   对 `parameter_search_*` **只读**（且只读经 `parameterSearch/persistence.ts` 的既有读函数，
 *   不新写一套 SQL —— 那是第二套读取实现，会导致口径漂移）；
 * - **快照写入即冻结**：`ON DUPLICATE KEY UPDATE` 的集合**不含** `searchSnapshotJson` /
 *   `searchSnapshotFingerprint` / `analysisConfigJson` / FIXED 坐标（重放不得改写历史口径）；
 * - **幂等**：三表都有 UNIQUE 键（`robustnessRunId`；`(robustnessRunId, parameterHash)`；
 *   `(robustnessRunId, parameterName)`）⇒ 重复 `start` 覆盖同一批行，不堆重复；
 * - 🔴 **不 `JSON.stringify` 非有限数**：`double` 列遇 `NaN / Infinity` 会被 mysql2 静默转成
 *   `null`（= 把「算出来了但是坏的」伪装成「没有这个值」）⇒ 统一走 `finiteOrNull` 守卫
 *   （**复用** `parameterSearch/persistence.ts` 的同一实现，不另写一份）。
 */

import { asc, desc, eq, sql } from "drizzle-orm";
import {
  searchRobustnessParameterAnalysis,
  searchRobustnessResult,
  searchRobustnessRun,
} from "../../../drizzle/schema";
import type { ParameterSearchRunStatus } from "../../../shared/parameterSearchContracts";
import { getDb } from "../../db";
import { finiteOrNull } from "../parameterSearch/persistence";
import type {
  ResolvedRobustnessAnalysisConfig,
  SearchRobustnessParameterAnalysis,
  SearchRobustnessResult,
  SearchRobustnessSummary,
} from "./types";

/** 取 DB（缺失即响亮抛错，不静默返回空列表让调用方以为「没有数据」）。 */
async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new Error("Robustness 持久化失败：数据库不可用（getDb() 返回 undefined）");
  }
  return db;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** Run 插入输入（**不含**任何结果字段；快照字段写入即冻结）。 */
export interface InsertSearchRobustnessRunInput {
  readonly robustnessRunId: string;
  readonly sourceSearchRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly searchMethod: string;
  readonly searchSnapshotJson: string;
  readonly searchSnapshotFingerprint: string;
  readonly fixedCoordinatesJson: string;
  readonly executionPolicyVersion: number;
  readonly evaluationConfigFingerprint: string;
  readonly sourceReferenceCheckApplied: boolean | null;
  readonly sourceUnreferencedCodesJson: string | null;
  readonly analysisConfigJson: string;
  readonly status: ParameterSearchRunStatus;
}

/** 幂等创建 Run（重放只刷 `updatedAt`，快照与口径不动）。 */
export async function insertSearchRobustnessRun(
  input: InsertSearchRobustnessRunInput,
): Promise<void> {
  const db = await requireDb();
  await db
    .insert(searchRobustnessRun)
    .values({
      robustnessRunId: input.robustnessRunId,
      sourceSearchRunId: input.sourceSearchRunId,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      datasetVersionId: input.datasetVersionId,
      datasetVersionLabel: input.datasetVersionLabel,
      startDate: input.startDate,
      endDate: input.endDate,
      searchMethod: input.searchMethod,
      searchSnapshotJson: input.searchSnapshotJson,
      searchSnapshotFingerprint: input.searchSnapshotFingerprint,
      fixedCoordinatesJson: input.fixedCoordinatesJson,
      executionPolicyVersion: input.executionPolicyVersion,
      evaluationConfigFingerprint: input.evaluationConfigFingerprint,
      sourceReferenceCheckApplied: input.sourceReferenceCheckApplied,
      sourceUnreferencedCodesJson: input.sourceUnreferencedCodesJson,
      analysisConfigJson: input.analysisConfigJson,
      status: input.status,
      analyzedCount: 0,
      stableCount: 0,
      unstableCount: 0,
      insufficientCount: 0,
      neighborhoodIncompleteCount: 0,
      parameterReferenceUnverified: input.sourceReferenceCheckApplied !== true,
    })
    .onDuplicateKeyUpdate({ set: { updatedAt: sql`now()` } });
}

/** Run 状态更新补丁（**不含**快照与口径字段）。 */
export interface UpdateSearchRobustnessRunInput {
  readonly status?: ParameterSearchRunStatus;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly summaryJson?: string | null;
  readonly analyzedCount?: number;
  readonly stableCount?: number;
  readonly unstableCount?: number;
  readonly insufficientCount?: number;
  readonly neighborhoodIncompleteCount?: number;
  readonly parameterReferenceUnverified?: boolean;
  readonly notesJson?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

function toDate(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`非法时间戳：${iso}`);
  return date;
}

/** 更新 Run（只更新显式给出的字段）。 */
export async function updateSearchRobustnessRun(
  robustnessRunId: string,
  patch: UpdateSearchRobustnessRunInput,
): Promise<void> {
  const db = await requireDb();
  await db
    .update(searchRobustnessRun)
    .set({
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.startedAt === undefined ? {} : { startedAt: toDate(patch.startedAt) }),
      ...(patch.completedAt === undefined ? {} : { completedAt: toDate(patch.completedAt) }),
      ...(patch.summaryJson === undefined ? {} : { summaryJson: patch.summaryJson }),
      ...(patch.analyzedCount === undefined ? {} : { analyzedCount: patch.analyzedCount }),
      ...(patch.stableCount === undefined ? {} : { stableCount: patch.stableCount }),
      ...(patch.unstableCount === undefined ? {} : { unstableCount: patch.unstableCount }),
      ...(patch.insufficientCount === undefined ? {} : { insufficientCount: patch.insufficientCount }),
      ...(patch.neighborhoodIncompleteCount === undefined
        ? {}
        : { neighborhoodIncompleteCount: patch.neighborhoodIncompleteCount }),
      ...(patch.parameterReferenceUnverified === undefined
        ? {}
        : { parameterReferenceUnverified: patch.parameterReferenceUnverified }),
      ...(patch.notesJson === undefined ? {} : { notesJson: patch.notesJson }),
      ...(patch.errorCode === undefined ? {} : { errorCode: patch.errorCode }),
      ...(patch.errorMessage === undefined ? {} : { errorMessage: patch.errorMessage }),
      updatedAt: sql`now()`,
    })
    .where(eq(searchRobustnessRun.robustnessRunId, robustnessRunId));
}

export type SearchRobustnessRunRow = typeof searchRobustnessRun.$inferSelect;

/** 读取单个 Run 行（不存在返回 null）。 */
export async function getSearchRobustnessRunRow(
  robustnessRunId: string,
): Promise<SearchRobustnessRunRow | null> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(searchRobustnessRun)
    .where(eq(searchRobustnessRun.robustnessRunId, robustnessRunId))
    .limit(1);
  return rows[0] ?? null;
}

/** 列表（按创建时间倒序；不取长文本快照列）。 */
export async function listSearchRobustnessRunRows(options: {
  readonly limit: number;
  readonly offset?: number;
  readonly sourceSearchRunId?: string;
}): Promise<SearchRobustnessRunRow[]> {
  const db = await requireDb();
  const base = db
    .select({
      id: searchRobustnessRun.id,
      robustnessRunId: searchRobustnessRun.robustnessRunId,
      sourceSearchRunId: searchRobustnessRun.sourceSearchRunId,
      strategyId: searchRobustnessRun.strategyId,
      strategyVersion: searchRobustnessRun.strategyVersion,
      datasetVersionId: searchRobustnessRun.datasetVersionId,
      datasetVersionLabel: searchRobustnessRun.datasetVersionLabel,
      startDate: searchRobustnessRun.startDate,
      endDate: searchRobustnessRun.endDate,
      searchMethod: searchRobustnessRun.searchMethod,
      searchSnapshotJson: sql<string>`''`.as("searchSnapshotJson"),
      searchSnapshotFingerprint: searchRobustnessRun.searchSnapshotFingerprint,
      fixedCoordinatesJson: sql<string>`''`.as("fixedCoordinatesJson"),
      executionPolicyVersion: searchRobustnessRun.executionPolicyVersion,
      evaluationConfigFingerprint: searchRobustnessRun.evaluationConfigFingerprint,
      sourceReferenceCheckApplied: searchRobustnessRun.sourceReferenceCheckApplied,
      sourceUnreferencedCodesJson: searchRobustnessRun.sourceUnreferencedCodesJson,
      analysisConfigJson: sql<string>`'{}'`.as("analysisConfigJson"),
      status: searchRobustnessRun.status,
      summaryJson: searchRobustnessRun.summaryJson,
      analyzedCount: searchRobustnessRun.analyzedCount,
      stableCount: searchRobustnessRun.stableCount,
      unstableCount: searchRobustnessRun.unstableCount,
      insufficientCount: searchRobustnessRun.insufficientCount,
      neighborhoodIncompleteCount: searchRobustnessRun.neighborhoodIncompleteCount,
      parameterReferenceUnverified: searchRobustnessRun.parameterReferenceUnverified,
      notesJson: searchRobustnessRun.notesJson,
      errorCode: searchRobustnessRun.errorCode,
      errorMessage: searchRobustnessRun.errorMessage,
      createdAt: searchRobustnessRun.createdAt,
      startedAt: searchRobustnessRun.startedAt,
      completedAt: searchRobustnessRun.completedAt,
      updatedAt: searchRobustnessRun.updatedAt,
    })
    .from(searchRobustnessRun);
  const filtered =
    options.sourceSearchRunId === undefined
      ? base
      : base.where(eq(searchRobustnessRun.sourceSearchRunId, options.sourceSearchRunId));
  return filtered
    .orderBy(desc(searchRobustnessRun.createdAt), desc(searchRobustnessRun.id))
    .limit(options.limit)
    .offset(options.offset ?? 0);
}

/** 汇总写库前的落列投影（关键计数单列，列表页无需解析 JSON）。 */
export function summaryToColumns(summary: SearchRobustnessSummary): {
  readonly analyzedCount: number;
  readonly stableCount: number;
  readonly unstableCount: number;
  readonly insufficientCount: number;
  readonly neighborhoodIncompleteCount: number;
  readonly parameterReferenceUnverified: boolean;
} {
  return {
    analyzedCount: summary.analyzedCombinationCount,
    stableCount: summary.stableCount,
    unstableCount: summary.unstableCount,
    insufficientCount:
      summary.insufficientTradingActivityCount
      + summary.insufficientNeighborhoodCount
      + summary.sourceResultUnavailableCount,
    neighborhoodIncompleteCount: summary.neighborhoodIncompleteCount,
    parameterReferenceUnverified: summary.parameterReferenceUnverified,
  };
}

/** Run 行 → ISO 时间串（视图层统一处理）。 */
export function robustnessRunTimestamps(row: SearchRobustnessRunRow): {
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
} {
  const iso = (value: Date | string | null): string | null =>
    value === null ? null : value instanceof Date ? value.toISOString() : String(value);
  return {
    createdAt: iso(row.createdAt) as string,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
  };
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** 把单组合结果投影为落库行（唯一落点；指标列写**冻结副本**，零派生）。 */
function toResultInsertRow(result: SearchRobustnessResult) {
  return {
    robustnessRunId: result.robustnessRunId,
    sourceSearchRunId: result.sourceSearchRunId,
    parameterHash: result.parameterHash,
    combinationIndex: result.combinationIndex,
    parametersJson: JSON.stringify(result.parameters),
    totalReturnPct: finiteOrNull(result.metrics.totalReturnPct),
    annualizedReturnPct: finiteOrNull(result.metrics.annualizedReturnPct),
    maxDrawdownPct: finiteOrNull(result.metrics.maxDrawdownPct),
    tradeCount: result.metrics.tradeCount,
    winRatePct: finiteOrNull(result.metrics.winRatePct),
    profitFactor: finiteOrNull(result.metrics.profitFactor),
    metricsSource: result.metricsSource,
    status: result.status,
    stable: result.stable,
    stabilityRatio: finiteOrNull(result.stabilityRatio),
    stableNeighborCount: result.stableNeighborCount,
    validNeighborCount: result.validNeighborCount,
    expectedNeighborCount: result.expectedNeighborCount,
    presentNeighborCount: result.presentNeighborCount,
    neighborhoodIncomplete: result.neighborhoodIncomplete,
    statusReason: result.statusReason,
    neighborsJson: JSON.stringify(result.neighbors),
    dispersionJson: JSON.stringify(result.dispersion),
    sensitivityJson: JSON.stringify(result.sensitivity),
    fingerprint: result.fingerprint,
  };
}

/** 幂等写入单组合结果（`(robustnessRunId, parameterHash)` UNIQUE）。 */
export async function upsertSearchRobustnessResults(
  results: readonly SearchRobustnessResult[],
): Promise<number> {
  if (results.length === 0) return 0;
  const db = await requireDb();
  const CHUNK = 100;
  let written = 0;
  for (let index = 0; index < results.length; index += CHUNK) {
    const chunk = results.slice(index, index + CHUNK);
    const rows = chunk.map(toResultInsertRow);
    const first = rows[0] as ReturnType<typeof toResultInsertRow>;
    await db
      .insert(searchRobustnessResult)
      .values(rows)
      .onDuplicateKeyUpdate({
        set: {
          combinationIndex: sql`values(${sql.identifier("combinationIndex")})`,
          parametersJson: sql`values(${sql.identifier("parametersJson")})`,
          totalReturnPct: sql`values(${sql.identifier("totalReturnPct")})`,
          annualizedReturnPct: sql`values(${sql.identifier("annualizedReturnPct")})`,
          maxDrawdownPct: sql`values(${sql.identifier("maxDrawdownPct")})`,
          tradeCount: sql`values(${sql.identifier("tradeCount")})`,
          winRatePct: sql`values(${sql.identifier("winRatePct")})`,
          profitFactor: sql`values(${sql.identifier("profitFactor")})`,
          metricsSource: sql`values(${sql.identifier("metricsSource")})`,
          status: sql`values(${sql.identifier("status")})`,
          stable: sql`values(${sql.identifier("stable")})`,
          stabilityRatio: sql`values(${sql.identifier("stabilityRatio")})`,
          stableNeighborCount: sql`values(${sql.identifier("stableNeighborCount")})`,
          validNeighborCount: sql`values(${sql.identifier("validNeighborCount")})`,
          expectedNeighborCount: sql`values(${sql.identifier("expectedNeighborCount")})`,
          presentNeighborCount: sql`values(${sql.identifier("presentNeighborCount")})`,
          neighborhoodIncomplete: sql`values(${sql.identifier("neighborhoodIncomplete")})`,
          statusReason: sql`values(${sql.identifier("statusReason")})`,
          neighborsJson: sql`values(${sql.identifier("neighborsJson")})`,
          dispersionJson: sql`values(${sql.identifier("dispersionJson")})`,
          sensitivityJson: sql`values(${sql.identifier("sensitivityJson")})`,
          fingerprint: sql`values(${sql.identifier("fingerprint")})`,
          updatedAt: sql`now()`,
        },
      });
    written += chunk.length;
    void first;
  }
  return written;
}

export type SearchRobustnessResultRow = typeof searchRobustnessResult.$inferSelect;

/**
 * 列出 Run 的全部结果行（按组合序号升序）。
 *
 * ⚠️ `neighborsJson` 可能较大（`(2·distance)·轴数` 条邻居 + 原因文本）⇒ 列表页用
 *   `includeDetail: false` 只取标量列；「查看邻域」才取明细，避免列表页白读大字段。
 */
export async function listSearchRobustnessResultRows(
  robustnessRunId: string,
  options: { readonly includeDetail?: boolean } = {},
): Promise<SearchRobustnessResultRow[]> {
  const db = await requireDb();
  const includeDetail = options.includeDetail === true;
  const empty = sql<string>`'[]'`;
  return db
    .select({
      id: searchRobustnessResult.id,
      robustnessRunId: searchRobustnessResult.robustnessRunId,
      sourceSearchRunId: searchRobustnessResult.sourceSearchRunId,
      parameterHash: searchRobustnessResult.parameterHash,
      combinationIndex: searchRobustnessResult.combinationIndex,
      parametersJson: searchRobustnessResult.parametersJson,
      totalReturnPct: searchRobustnessResult.totalReturnPct,
      annualizedReturnPct: searchRobustnessResult.annualizedReturnPct,
      maxDrawdownPct: searchRobustnessResult.maxDrawdownPct,
      tradeCount: searchRobustnessResult.tradeCount,
      winRatePct: searchRobustnessResult.winRatePct,
      profitFactor: searchRobustnessResult.profitFactor,
      metricsSource: searchRobustnessResult.metricsSource,
      status: searchRobustnessResult.status,
      stable: searchRobustnessResult.stable,
      stabilityRatio: searchRobustnessResult.stabilityRatio,
      stableNeighborCount: searchRobustnessResult.stableNeighborCount,
      validNeighborCount: searchRobustnessResult.validNeighborCount,
      expectedNeighborCount: searchRobustnessResult.expectedNeighborCount,
      presentNeighborCount: searchRobustnessResult.presentNeighborCount,
      neighborhoodIncomplete: searchRobustnessResult.neighborhoodIncomplete,
      statusReason: searchRobustnessResult.statusReason,
      neighborsJson: includeDetail
        ? searchRobustnessResult.neighborsJson
        : sql<string>`'[]'`.as("neighborsJson"),
      dispersionJson: includeDetail
        ? searchRobustnessResult.dispersionJson
        : empty.as("dispersionJson"),
      sensitivityJson: includeDetail
        ? searchRobustnessResult.sensitivityJson
        : empty.as("sensitivityJson"),
      fingerprint: searchRobustnessResult.fingerprint,
      createdAt: searchRobustnessResult.createdAt,
      updatedAt: searchRobustnessResult.updatedAt,
    })
    .from(searchRobustnessResult)
    .where(eq(searchRobustnessResult.robustnessRunId, robustnessRunId))
    .orderBy(asc(searchRobustnessResult.combinationIndex), asc(searchRobustnessResult.id));
}

// ---------------------------------------------------------------------------
// Parameter analysis
// ---------------------------------------------------------------------------

/** 把单参数分析投影为落库行。 */
function toParameterInsertRow(analysis: SearchRobustnessParameterAnalysis) {
  return {
    robustnessRunId: analysis.robustnessRunId,
    sourceSearchRunId: analysis.sourceSearchRunId,
    parameterName: analysis.parameterName,
    domainMode: analysis.domainMode,
    domainValueCount: analysis.domainValueCount,
    numeric: analysis.numeric,
    analyzedValueCount: analysis.analyzedValueCount,
    stableCombinationCount: analysis.stableCombinationCount,
    unstableCombinationCount: analysis.unstableCombinationCount,
    verdict: analysis.verdict,
    sensitivityJson: JSON.stringify(analysis.sensitivity),
    valueDispersionJson: JSON.stringify(analysis.valueDispersion),
    fingerprint: analysis.fingerprint,
  };
}

/** 幂等写入单参数分析（`(robustnessRunId, parameterName)` UNIQUE）。 */
export async function upsertSearchRobustnessParameterAnalyses(
  analyses: readonly SearchRobustnessParameterAnalysis[],
): Promise<number> {
  if (analyses.length === 0) return 0;
  const db = await requireDb();
  await db
    .insert(searchRobustnessParameterAnalysis)
    .values(analyses.map(toParameterInsertRow))
    .onDuplicateKeyUpdate({
      set: {
        domainMode: sql`values(${sql.identifier("domainMode")})`,
        domainValueCount: sql`values(${sql.identifier("domainValueCount")})`,
        numeric: sql`values(${sql.identifier("numeric")})`,
        analyzedValueCount: sql`values(${sql.identifier("analyzedValueCount")})`,
        stableCombinationCount: sql`values(${sql.identifier("stableCombinationCount")})`,
        unstableCombinationCount: sql`values(${sql.identifier("unstableCombinationCount")})`,
        verdict: sql`values(${sql.identifier("verdict")})`,
        sensitivityJson: sql`values(${sql.identifier("sensitivityJson")})`,
        valueDispersionJson: sql`values(${sql.identifier("valueDispersionJson")})`,
        fingerprint: sql`values(${sql.identifier("fingerprint")})`,
        updatedAt: sql`now()`,
      },
    });
  return analyses.length;
}

export type SearchRobustnessParameterAnalysisRow =
  typeof searchRobustnessParameterAnalysis.$inferSelect;

/** 列出 Run 的全部单参数分析（按参数名升序）。 */
export async function listSearchRobustnessParameterAnalysisRows(
  robustnessRunId: string,
): Promise<SearchRobustnessParameterAnalysisRow[]> {
  const db = await requireDb();
  return db
    .select()
    .from(searchRobustnessParameterAnalysis)
    .where(eq(searchRobustnessParameterAnalysis.robustnessRunId, robustnessRunId))
    .orderBy(asc(searchRobustnessParameterAnalysis.parameterName));
}

// ---------------------------------------------------------------------------
// 口径 JSON（落库 / 读回；唯一落点）
// ---------------------------------------------------------------------------

/** 序列化分析口径（落 `analysisConfigJson`）。 */
export function serializeAnalysisConfig(config: ResolvedRobustnessAnalysisConfig): string {
  return JSON.stringify(config);
}
