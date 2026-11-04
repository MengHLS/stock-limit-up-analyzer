/**
 * WALK-FORWARD-001 — 两表仓储（`walk_forward_run` / `walk_forward_fold`；读写唯一落点）。
 *
 * ## 纪律
 *
 * - **只写这两张表**：对 `parameter_search_*` / `oos_validation_*` / `research_runs` / 任何策略与
 *   数据集表**只读、且不在此处读**（读取经 PS / OOS 域既有读函数，由组合根完成）
 *   ⇒ 「Walk-Forward 不修改历史 Search / OOS 结果」由此成为**结构事实**：
 *   本文件没有任何 UPDATE 它们的能力（规格 §22）；
 * - **幂等建行**：两表都有 UNIQUE 键（`walkForwardRunId`；`(walkForwardRunId, foldIndex)`）
 *   ⇒ `insert*` 走 `ON DUPLICATE KEY UPDATE` 且**只刷 `updatedAt`**，
 *   重放不会改写几何 / 冻结坐标 / 执行指纹；
 * - 🔴 **写入即冻结的列**：Run 行的 `scheduleJson` / `selectionPolicyJson` / `runFingerprint` /
 *   策略与数据集坐标，Fold 行的 `isStart..oosEnd` / `strategyVersionId` / `strategyFingerprint` /
 *   `datasetVersionId` / `executionFingerprint` —— 这些**不在**任何 UPDATE 集合里，
 *   连 `updateWalkForwardFold` 都够不着（规格 §10：不一致要 FAIL LOUDLY，不是就地改）；
 * - ⚠️ **唯一的回退写入** = `resetWalkForwardFoldForExecution`（整条 Run 重执行时把 Fold 行
 *   拉回 `WINDOW_CREATED`）。它**只清结果类列**，几何与执行指纹一个字节都不动，
 *   且必须显式调用（不会在任何隐式路径上发生）；
 * - 🔴 **不 `JSON.stringify` 非有限数**：`NaN / Infinity` 被 `JSON.stringify` 会变成 `null`，
 *   等于把「算出来了但是坏的」伪装成「本来就没有这个值」⇒ 一律走
 *   `stringifyWalkForwardJson` 守卫（**响亮抛错**，不静默降级）。
 */

import { asc, desc, eq, sql } from "drizzle-orm";
import { walkForwardFold, walkForwardRun } from "../../../drizzle/schema";
import type {
  WalkForwardFoldOutcome,
  WalkForwardFoldStatus,
  WalkForwardRunStatus,
} from "../../../shared/walkForwardContracts";
import { getDb } from "../../db";
import { ResearchValidationError } from "../experimentValidation";

/** 取 DB（缺失即响亮抛错，不静默返回空列表让调用方以为「没有数据」）。 */
async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new Error("Walk-Forward 持久化失败：数据库不可用（getDb() 返回 undefined）");
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
// JSON 守卫（写入侧）
// ---------------------------------------------------------------------------

/** 递归断言对象里没有任何非有限数（`NaN` / `±Infinity`）。 */
function assertNoNonFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ResearchValidationError([
        {
          code: "WALK_FORWARD_JSON_NOT_FINITE",
          path,
          message:
            `${path} 是非有限数（${String(value)}）。`
            + "JSON.stringify 会把它静默写成 null，等于把「算坏了」伪装成「没有这个值」"
            + "⇒ 拒绝写入（规格 §9：不得静默改语义）。",
        },
      ]);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoNonFiniteNumbers(item, `${path}[${String(index)}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertNoNonFiniteNumbers(item, `${path}.${key}`);
    }
  }
}

/** 序列化落库 JSON（先过非有限数守卫）。 */
export function stringifyWalkForwardJson(value: unknown, label: string): string {
  assertNoNonFiniteNumbers(value, label);
  return JSON.stringify(value);
}

/**
 * 反序列化落库 JSON（`longtext` 读回来可能是**字符串**，也可能是已解析对象）。
 *
 * 🔴 解析失败**响亮抛错**（`WALK_FORWARD_RECORD_UNREADABLE`）：
 *   历史行读不出来时静默回落成 `null` / `[]`，会让调用方以为「这条 Run 本来就没冻结排程」。
 */
export function parseWalkForwardJson<T>(value: unknown, label: string): T {
  if (value === null || value === undefined) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RECORD_UNREADABLE",
        path: label,
        message: `${label} 为 NULL —— 冻结列缺失说明该行不完整，拒绝用默认值顶替。`,
      },
    ]);
  }
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RECORD_UNREADABLE",
        path: label,
        message: `${label} 的类型不可解析：${typeof value}`,
      },
    ]);
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new ResearchValidationError([
      {
        code: "WALK_FORWARD_RECORD_UNREADABLE",
        path: label,
        message: `${label} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
}

/** 可空 JSON 列的反序列化（`null` ⇒ `null`，其余走上面那条响亮路径）。 */
export function parseWalkForwardJsonOrNull<T>(value: unknown, label: string): T | null {
  if (value === null || value === undefined) return null;
  return parseWalkForwardJson<T>(value, label);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** Run 建行输入（**不含**任何结果字段；排程 / 选择策略 / 冻结坐标写入即冻结）。 */
export interface InsertWalkForwardRunInput {
  readonly walkForwardRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyVersionId: string;
  readonly strategyFingerprint: string | null;
  readonly datasetVersionId: number | null;
  readonly datasetVersionLabel: string | null;
  readonly scheduleJson: string;
  readonly scheduleFingerprint: string;
  readonly selectionPolicyJson: string;
  readonly searchMethod: string;
  readonly maxCombinationsPerFold: number | null;
  readonly totalFoldCount: number;
  readonly metricsVersion: string;
  readonly engineVersion: string;
  readonly status: WalkForwardRunStatus;
  readonly runFingerprint: string;
  readonly notesJson: string | null;
  readonly createdAt: string;
}

/** 幂等建 Run（重放只刷 `updatedAt`；排程 / 选择策略 / 运行指纹一个字节都不动）。 */
export async function insertWalkForwardRun(input: InsertWalkForwardRunInput): Promise<void> {
  const db = await requireDb();
  await db
    .insert(walkForwardRun)
    .values({
      walkForwardRunId: input.walkForwardRunId,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      strategyVersionId: input.strategyVersionId,
      strategyFingerprint: input.strategyFingerprint,
      datasetVersionId: input.datasetVersionId,
      datasetVersionLabel: input.datasetVersionLabel,
      scheduleJson: input.scheduleJson,
      scheduleFingerprint: input.scheduleFingerprint,
      selectionPolicyJson: input.selectionPolicyJson,
      searchMethod: input.searchMethod,
      maxCombinationsPerFold: input.maxCombinationsPerFold,
      totalFoldCount: input.totalFoldCount,
      metricsVersion: input.metricsVersion,
      engineVersion: input.engineVersion,
      status: input.status,
      runFingerprint: input.runFingerprint,
      notesJson: input.notesJson,
      createdAt: toDate(input.createdAt) ?? new Date(),
    })
    .onDuplicateKeyUpdate({ set: { updatedAt: sql`now()` } });
}

/**
 * Run 更新补丁（**只有状态与进度类字段**）。
 *
 * 🔴 这里没有 `scheduleJson` / `selectionPolicyJson` / `runFingerprint` / 策略与数据集坐标
 *   —— 它们是创建时冻结的，本函数在类型层面就没有改它们的能力（规格 §10）。
 */
export interface UpdateWalkForwardRunInput {
  readonly status?: WalkForwardRunStatus;
  readonly completedFoldCount?: number;
  readonly failedFoldCount?: number;
  readonly currentFoldIndex?: number | null;
  readonly aggregateJson?: string | null;
  readonly notesJson?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

/** 更新 Run（只允许状态 / 进度类字段；空补丁 = 不写）。 */
export async function updateWalkForwardRun(
  walkForwardRunId: string,
  patch: UpdateWalkForwardRunInput,
): Promise<void> {
  const db = await requireDb();
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) set["status"] = patch.status;
  if (patch.completedFoldCount !== undefined) set["completedFoldCount"] = patch.completedFoldCount;
  if (patch.failedFoldCount !== undefined) set["failedFoldCount"] = patch.failedFoldCount;
  if (patch.currentFoldIndex !== undefined) set["currentFoldIndex"] = patch.currentFoldIndex;
  if (patch.aggregateJson !== undefined) set["aggregateJson"] = patch.aggregateJson;
  if (patch.notesJson !== undefined) set["notesJson"] = patch.notesJson;
  if (patch.errorCode !== undefined) set["errorCode"] = patch.errorCode;
  if (patch.errorMessage !== undefined) set["errorMessage"] = patch.errorMessage;
  if (patch.startedAt !== undefined) set["startedAt"] = toDate(patch.startedAt);
  if (patch.completedAt !== undefined) set["completedAt"] = toDate(patch.completedAt);
  if (Object.keys(set).length === 0) return;
  await db.update(walkForwardRun).set(set).where(eq(walkForwardRun.walkForwardRunId, walkForwardRunId));
}

export type WalkForwardRunRow = typeof walkForwardRun.$inferSelect;
export type WalkForwardFoldRow = typeof walkForwardFold.$inferSelect;

/** 读取单个 Run 行（不存在 ⇒ null，由调用方决定是 404 还是响亮拒绝）。 */
export async function getWalkForwardRunRow(
  walkForwardRunId: string,
): Promise<WalkForwardRunRow | null> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(walkForwardRun)
    .where(eq(walkForwardRun.walkForwardRunId, walkForwardRunId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 列出 Run 行（可按策略过滤；恒定按 `createdAt` 倒序 ⇒ 列表顺序**确定**，规格 §16）。
 *
 * ⚠️ 同一 `createdAt` 毫秒内的多行顺序在 DB 层不保证 ⇒ 追加 `id` 倒序作**稳定次序键**，
 *   否则分页会出现重复 / 漏行。
 */
export async function listWalkForwardRunRows(options: {
  readonly limit: number;
  readonly offset?: number;
  readonly strategyId?: string;
}): Promise<WalkForwardRunRow[]> {
  const db = await requireDb();
  const base = db.select().from(walkForwardRun);
  const filtered =
    options.strategyId === undefined
      ? base
      : base.where(eq(walkForwardRun.strategyId, options.strategyId));
  return filtered
    .orderBy(desc(walkForwardRun.createdAt), desc(walkForwardRun.id))
    .limit(options.limit)
    .offset(options.offset ?? 0);
}

/** Run 的时间戳三元组（全仓唯一读法，避免各处格式不一）。 */
export function walkForwardRunTimestamps(row: WalkForwardRunRow): {
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
// Fold
// ---------------------------------------------------------------------------

/**
 * Fold 建行输入（**只有几何 + 冻结坐标 + 初始状态**）。
 *
 * 🔴 `createdAt` 由调用方给（保持「同一 Run 的 Fold 行时间戳一致」这一可断言性质）。
 */
export interface InsertWalkForwardFoldInput {
  readonly walkForwardRunId: string;
  readonly foldIndex: number;
  readonly isStart: string;
  readonly isEnd: string;
  readonly oosStart: string;
  readonly oosEnd: string;
  readonly strategyVersionId: string;
  readonly strategyFingerprint: string | null;
  readonly datasetVersionId: number | null;
  readonly executionFingerprint: string;
  readonly status: WalkForwardFoldStatus;
  readonly outcome: WalkForwardFoldOutcome;
  readonly notesJson: string | null;
  readonly createdAt: string;
}

/**
 * 幂等建 Fold（重放只刷 `updatedAt`）。
 *
 * 🔴 **几何端点与 `executionFingerprint` 不在 UPDATE 集合里** —— 这是「窗口冻结」在持久层的
 *   落地：任何重放都不可能悄悄把 Fold 挪到另一个窗口（规格 §10 / §11）。
 */
export async function insertWalkForwardFold(input: InsertWalkForwardFoldInput): Promise<void> {
  const db = await requireDb();
  await db
    .insert(walkForwardFold)
    .values({
      walkForwardRunId: input.walkForwardRunId,
      foldIndex: input.foldIndex,
      isStart: input.isStart,
      isEnd: input.isEnd,
      oosStart: input.oosStart,
      oosEnd: input.oosEnd,
      strategyVersionId: input.strategyVersionId,
      strategyFingerprint: input.strategyFingerprint,
      datasetVersionId: input.datasetVersionId,
      executionFingerprint: input.executionFingerprint,
      status: input.status,
      outcome: input.outcome,
      notesJson: input.notesJson,
      createdAt: toDate(input.createdAt) ?? new Date(),
    })
    .onDuplicateKeyUpdate({ set: { updatedAt: sql`now()` } });
}

/**
 * Fold 更新补丁（**结果类字段**；几何 / 冻结坐标 / 执行指纹不在其中）。
 *
 * ⚠️ `resolvedParameterSetJson` 在这里**可写**，但它受生命周期约束：
 *   只有 `search → freeze` 那一步会写它（见 `executor.ts`），且整条 Run 重执行时
 *   会先经过 `resetWalkForwardFoldForExecution` 显式清空 —— 不存在「静默改写已冻结参数」的路径。
 */
export interface UpdateWalkForwardFoldInput {
  readonly status?: WalkForwardFoldStatus;
  readonly outcome?: WalkForwardFoldOutcome;
  readonly sourceSearchRunId?: string | null;
  readonly searchStartDate?: string | null;
  readonly searchEndDate?: string | null;
  readonly sourceCombinationIndex?: number | null;
  readonly parameterHash?: string | null;
  readonly resolvedParameterSetJson?: string | null;
  readonly oosRunId?: string | null;
  readonly oosWindowStartDate?: string | null;
  readonly oosWindowEndDate?: string | null;
  readonly isMetricsJson?: string | null;
  readonly isMetricsSource?: string | null;
  readonly oosMetricsJson?: string | null;
  readonly oosMetricsSource?: string | null;
  readonly comparisonJson?: string | null;
  readonly oosBacktestFingerprint?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly notesJson?: string | null;
  readonly completedAt?: string | null;
}

/** 更新 Fold（只允许结果类字段；空补丁 = 不写）。 */
export async function updateWalkForwardFold(
  walkForwardRunId: string,
  foldIndex: number,
  patch: UpdateWalkForwardFoldInput,
): Promise<void> {
  const db = await requireDb();
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) set["status"] = patch.status;
  if (patch.outcome !== undefined) set["outcome"] = patch.outcome;
  if (patch.sourceSearchRunId !== undefined) set["sourceSearchRunId"] = patch.sourceSearchRunId;
  if (patch.searchStartDate !== undefined) set["searchStartDate"] = patch.searchStartDate;
  if (patch.searchEndDate !== undefined) set["searchEndDate"] = patch.searchEndDate;
  if (patch.sourceCombinationIndex !== undefined) {
    set["sourceCombinationIndex"] = patch.sourceCombinationIndex;
  }
  if (patch.parameterHash !== undefined) set["parameterHash"] = patch.parameterHash;
  if (patch.resolvedParameterSetJson !== undefined) {
    set["resolvedParameterSetJson"] = patch.resolvedParameterSetJson;
  }
  if (patch.oosRunId !== undefined) set["oosRunId"] = patch.oosRunId;
  if (patch.oosWindowStartDate !== undefined) set["oosWindowStartDate"] = patch.oosWindowStartDate;
  if (patch.oosWindowEndDate !== undefined) set["oosWindowEndDate"] = patch.oosWindowEndDate;
  if (patch.isMetricsJson !== undefined) set["isMetricsJson"] = patch.isMetricsJson;
  if (patch.isMetricsSource !== undefined) set["isMetricsSource"] = patch.isMetricsSource;
  if (patch.oosMetricsJson !== undefined) set["oosMetricsJson"] = patch.oosMetricsJson;
  if (patch.oosMetricsSource !== undefined) set["oosMetricsSource"] = patch.oosMetricsSource;
  if (patch.comparisonJson !== undefined) set["comparisonJson"] = patch.comparisonJson;
  if (patch.oosBacktestFingerprint !== undefined) {
    set["oosBacktestFingerprint"] = patch.oosBacktestFingerprint;
  }
  if (patch.errorCode !== undefined) set["errorCode"] = patch.errorCode;
  if (patch.errorMessage !== undefined) set["errorMessage"] = patch.errorMessage;
  if (patch.notesJson !== undefined) set["notesJson"] = patch.notesJson;
  if (patch.completedAt !== undefined) set["completedAt"] = toDate(patch.completedAt);
  if (Object.keys(set).length === 0) return;
  await db
    .update(walkForwardFold)
    .set(set)
    .where(
      sql`${walkForwardFold.walkForwardRunId} = ${walkForwardRunId}
        AND ${walkForwardFold.foldIndex} = ${foldIndex}`,
    );
}

/**
 * 把 Fold 行清回 `WINDOW_CREATED` / `PENDING`（**整条 Run 重执行的唯一回退写入**）。
 *
 * 🔴 为什么需要它：`WALK_FORWARD_FOLD_TRANSITIONS` 把 `FAILED` / `OOS_COMPLETED` 定为终态
 *   （单 Fold 不允许回头，否则 Fold 行会出现难以审计的往复时间线）。要让一条 `FAILED`
 *   或 `CANCELLED` 的 Run 能重执行，就必须在**开跑前**把整批 Fold 行显式重置。
 *
 * 🔴 **不动**几何四端点 / `strategyVersionId` / `strategyFingerprint` / `datasetVersionId` /
 *   `executionFingerprint` —— 重执行前后「这批 Fold 是哪几个窗口」必须逐字节不变，
 *   否则「同 scheduleFingerprint ⇒ 同 fold 坐标」这条确定性判据（规格 §16）就没了。
 *
 * ⚠️ 它**只**清本表结果列：从不触碰 `parameter_search_*` / `oos_validation_*` 的历史行。
 */
export async function resetWalkForwardFoldForExecution(
  walkForwardRunId: string,
  foldIndex: number,
): Promise<void> {
  const db = await requireDb();
  await db
    .update(walkForwardFold)
    .set({
      status: "WINDOW_CREATED",
      outcome: "PENDING",
      sourceSearchRunId: null,
      searchStartDate: null,
      searchEndDate: null,
      sourceCombinationIndex: null,
      parameterHash: null,
      resolvedParameterSetJson: null,
      oosRunId: null,
      oosWindowStartDate: null,
      oosWindowEndDate: null,
      isMetricsJson: null,
      isMetricsSource: null,
      oosMetricsJson: null,
      oosMetricsSource: null,
      comparisonJson: null,
      oosBacktestFingerprint: null,
      errorCode: null,
      errorMessage: null,
      notesJson: null,
      completedAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      sql`${walkForwardFold.walkForwardRunId} = ${walkForwardRunId}
        AND ${walkForwardFold.foldIndex} = ${foldIndex}`,
    );
}

/** 读取单个 Fold 行（不存在 ⇒ null）。 */
export async function getWalkForwardFoldRow(
  walkForwardRunId: string,
  foldIndex: number,
): Promise<WalkForwardFoldRow | null> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(walkForwardFold)
    .where(
      sql`${walkForwardFold.walkForwardRunId} = ${walkForwardRunId}
        AND ${walkForwardFold.foldIndex} = ${foldIndex}`,
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 列出某 Run 的全部 Fold 行，**恒定按 `foldIndex` 升序**。
 *
 * 🔴 顺序在这里被显式固定（而不是让数据库自由返回）：Fold 的序号承载「时间向前推进」
 *   的语义，任何依赖列表顺序的展示 / 断言都不得依赖隐式顺序（规格 §16）。
 */
export async function listWalkForwardFoldRows(
  walkForwardRunId: string,
): Promise<WalkForwardFoldRow[]> {
  const db = await requireDb();
  return db
    .select()
    .from(walkForwardFold)
    .where(eq(walkForwardFold.walkForwardRunId, walkForwardRunId))
    .orderBy(asc(walkForwardFold.foldIndex));
}

/** Fold 的时间戳三元组（`createdAt` / `completedAt`；无 `startedAt` 列，如实只给两项用途）。 */
export function walkForwardFoldTimestamps(row: WalkForwardFoldRow): {
  readonly createdAt: string;
  readonly completedAt: string | null;
} {
  return {
    createdAt: toIso(row.createdAt) ?? "",
    completedAt: toIso(row.completedAt),
  };
}
