/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 闭环回测结果留档（读写仓储）。
 *
 * 定位：让运行工作台的**每一次**闭环运行都「有结果可查」。此前 `loopRun` 是
 * 无状态调用（跑完即弃），界面刷新后无从回看。
 *
 * 三条纪律（改动前必读）：
 *   1. **列表不读长文本** —— `list` 只 SELECT 摘要列，**绝不** SELECT `resultJson`
 *      （单条可达数百 KB，列表页扫长文本是纯浪费）；
 *   2. **幂等写入** —— 以 `runId` 为唯一键 `ON DUPLICATE KEY UPDATE`：同一次运行的
 *      重试收敛为一行，不堆重复记录；
 *   3. **坏了要响** —— `resultJson` 文本存在但解析失败 ⇒ **抛错**（不静默降级成
 *      「没有结果」，那会把「记录坏了」伪装成「没跑过」）；只有该列为 `NULL` 才表示
 *      「本次未留完整结果」。
 *
 * 与 legacy `backtest_runs` 的边界见 `drizzle/0037_closed_loop_backtest_run.sql`：
 * 不同表、不同口径（那张存龙头候选回测结果），**禁互灌**。
 */

import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { closedLoopBacktestRun } from "../../drizzle/schema";
import type { ClosedLoopRunResult } from "../../shared/researchContracts";
import {
  buildClosedLoopBacktestRunSummary,
  type ClosedLoopBacktestRunSummary,
} from "./summary";

/**
 * 留档表的一行（不含长文本结果）—— 列表页与详情页头部共用。
 *
 * **平铺**（而非嵌套 `summary`）：前端表格直接按字段绑定，少一层解构；
 * 字段集 = 坐标列 + `ClosedLoopBacktestRunSummary`（同源同形，避免两套口径）。
 */
export type ClosedLoopBacktestRunRecord = {
  id: number;
  runId: string;
  createdAt: string;
  experimentId: string;
  strategyId: string;
  strategyVersion: string;
  startDate: string;
  endDate: string;
} & ClosedLoopBacktestRunSummary;

/** 留档详情（含完整运行结果）。 */
export type ClosedLoopBacktestRunDetail = ClosedLoopBacktestRunRecord & {
  /** `resultJson` 为 NULL 时为 null（表示本次未留完整结果，非「记录损坏」）。 */
  result: ClosedLoopRunResult | null;
};

export type SaveClosedLoopBacktestRunInput = {
  /** 本次运行的坐标（取自 `loopRun` 入参 —— 比结果内嵌的 `assembly` 更可靠）。 */
  experimentId: string;
  strategyId: string;
  strategyVersion: string;
  startDate: string;
  endDate: string;
  /** 完整运行结果（原样投影；不做二次加工）。 */
  result: ClosedLoopRunResult;
};

/** 列表默认/上限条数（与 legacy `listBacktestRuns` 同量级）。 */
export const CLOSED_LOOP_BACKTEST_LIST_DEFAULT_LIMIT = 50;
export const CLOSED_LOOP_BACKTEST_LIST_MAX_LIMIT = 200;

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * 留档一次闭环运行。返回留档行 id。
 *
 * 幂等：`runId` 冲突时覆盖（同一次运行重试 ⇒ 一行）。失败即抛错，由调用方决定是否
 * 让整次回测失败（当前策略：**不回滚回测**，只记录 —— 见 `researchRunRouter#loopRun`）。
 */
export async function saveClosedLoopBacktestRun(
  input: SaveClosedLoopBacktestRunInput,
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，无法留档闭环回测结果");

  const summary = buildClosedLoopBacktestRunSummary(input.result);
  const summaryJson = JSON.stringify(summary);

  const values = {
    runId: input.result.runId,
    experimentId: input.experimentId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    startDate: input.startDate,
    endDate: input.endDate,
    datasetVersion: summary.datasetVersion,
    datasetVersionId: summary.datasetVersionId,
    datasetSource: summary.datasetSource,
    recipeId: summary.recipeId,
    status: summary.status,
    executedStageCount: summary.executedStageCount,
    blockedStageCount: summary.blockedStageCount,
    skippedStageCount: summary.skippedStageCount,
    firstBlockedReasonCode: summary.firstBlockedReasonCode,
    initialCapital: summary.initialCapital,
    finalEquity: summary.finalEquity,
    tradeCount: summary.tradeCount,
    equityCurvePointCount: summary.equityCurvePointCount,
    summaryJson,
    resultJson: JSON.stringify(input.result),
  };

  await db
    .insert(closedLoopBacktestRun)
    .values(values)
    .onDuplicateKeyUpdate({
      // 覆盖除 runId（唯一键）外的全部内容：重试写入的应是「同一次运行的最终态」。
      set: {
        experimentId: values.experimentId,
        strategyId: values.strategyId,
        strategyVersion: values.strategyVersion,
        startDate: values.startDate,
        endDate: values.endDate,
        datasetVersion: values.datasetVersion,
        datasetVersionId: values.datasetVersionId,
        datasetSource: values.datasetSource,
        recipeId: values.recipeId,
        status: values.status,
        executedStageCount: values.executedStageCount,
        blockedStageCount: values.blockedStageCount,
        skippedStageCount: values.skippedStageCount,
        firstBlockedReasonCode: values.firstBlockedReasonCode,
        initialCapital: values.initialCapital,
        finalEquity: values.finalEquity,
        tradeCount: values.tradeCount,
        equityCurvePointCount: values.equityCurvePointCount,
        summaryJson: values.summaryJson,
        resultJson: values.resultJson,
      },
    });

  const rows = await db
    .select({ id: closedLoopBacktestRun.id })
    .from(closedLoopBacktestRun)
    .where(eq(closedLoopBacktestRun.runId, input.result.runId));
  return rows[0]?.id ?? 0;
}

const SUMMARY_COLUMNS = {
  id: closedLoopBacktestRun.id,
  runId: closedLoopBacktestRun.runId,
  createdAt: closedLoopBacktestRun.createdAt,
  experimentId: closedLoopBacktestRun.experimentId,
  strategyId: closedLoopBacktestRun.strategyId,
  strategyVersion: closedLoopBacktestRun.strategyVersion,
  startDate: closedLoopBacktestRun.startDate,
  endDate: closedLoopBacktestRun.endDate,
  status: closedLoopBacktestRun.status,
  executedStageCount: closedLoopBacktestRun.executedStageCount,
  blockedStageCount: closedLoopBacktestRun.blockedStageCount,
  skippedStageCount: closedLoopBacktestRun.skippedStageCount,
  firstBlockedReasonCode: closedLoopBacktestRun.firstBlockedReasonCode,
  summaryJson: closedLoopBacktestRun.summaryJson,
} as const;

type SummaryRow = {
  id: number;
  runId: string;
  createdAt: Date | string | null;
  experimentId: string;
  strategyId: string;
  strategyVersion: string;
  startDate: string;
  endDate: string;
  status: string;
  executedStageCount: number;
  blockedStageCount: number;
  skippedStageCount: number;
  firstBlockedReasonCode: string | null;
  summaryJson: string | null;
};

/** 概要 JSON 解析：坏文本 ⇒ 抛错（不伪装成空摘要）。 */
function parseSummaryJson(text: string | null): ClosedLoopBacktestRunSummary {
  if (text === null || text === undefined || text === "") {
    throw new Error("留档摘要缺失：summaryJson 为 NULL（记录损坏，不静默降级）");
  }
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("留档摘要结构非法：summaryJson 不是对象");
  }
  return parsed as ClosedLoopBacktestRunSummary;
}

function rowToRecord(row: SummaryRow): ClosedLoopBacktestRunRecord {
  const summary = parseSummaryJson(row.summaryJson);
  return {
    // 先铺摘要（自带 status / 阶段计数 / 金额等），再用**表列**覆盖坐标类字段：
    // 表列是本次运行入参的直接来源，比摘要 JSON 更权威；同值时不产生语义差异。
    // 摘要里表列没有的量（如 `datasetSourceNote` 回落原因）顺带保留。
    ...summary,
    id: row.id,
    runId: row.runId,
    createdAt: toIso(row.createdAt) ?? "",
    experimentId: row.experimentId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    executedStageCount: row.executedStageCount,
    blockedStageCount: row.blockedStageCount,
    skippedStageCount: row.skippedStageCount,
    firstBlockedReasonCode: row.firstBlockedReasonCode,
  };
}

/** 列出留档记录（摘要级，按留档时间倒序）。**不读** `resultJson`。 */
export async function listClosedLoopBacktestRuns(
  options?: { limit?: number; strategyId?: string },
): Promise<ClosedLoopBacktestRunRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const rawLimit = options?.limit ?? CLOSED_LOOP_BACKTEST_LIST_DEFAULT_LIMIT;
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : CLOSED_LOOP_BACKTEST_LIST_DEFAULT_LIMIT, 1),
    CLOSED_LOOP_BACKTEST_LIST_MAX_LIMIT,
  );

  const base = db.select(SUMMARY_COLUMNS).from(closedLoopBacktestRun);
  const ordered =
    options?.strategyId === undefined
      ? base
      : base.where(eq(closedLoopBacktestRun.strategyId, options.strategyId));
  const rows = (await ordered
    .orderBy(desc(closedLoopBacktestRun.createdAt))
    .limit(limit)) as unknown as SummaryRow[];
  return rows.map(rowToRecord);
}

/** 读取单条留档的完整内容（含 `resultJson`）。不存在 ⇒ null。 */
export async function getClosedLoopBacktestRun(
  id: number,
): Promise<ClosedLoopBacktestRunDetail | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ ...SUMMARY_COLUMNS, resultJson: closedLoopBacktestRun.resultJson })
    .from(closedLoopBacktestRun)
    .where(eq(closedLoopBacktestRun.id, id));
  const row = rows[0] as unknown as (SummaryRow & { resultJson: string | null }) | undefined;
  if (row === undefined) return null;

  const record = rowToRecord(row);
  let result: ClosedLoopRunResult | null = null;
  if (row.resultJson !== null && row.resultJson !== "") {
    const parsed = JSON.parse(row.resultJson) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`留档结果结构非法：closed_loop_backtest_run#${id}.resultJson 不是对象`);
    }
    result = parsed as ClosedLoopRunResult;
  }
  return { ...record, result };
}
