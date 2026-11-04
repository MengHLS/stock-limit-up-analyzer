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

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { closedLoopBacktestRun, strategyVersionStars } from "../../drizzle/schema";
import type { ClosedLoopRunResult } from "../../shared/researchContracts";
import { reconcileArchivedClosedLoopResult } from "./resultCompat";
import type { StrategyDocument } from "../research/strategySchema/types";
import {
  buildClosedLoopBacktestRunSummary,
  readEvaluationStageOutput,
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
  /**
   * 该版本是否已加星。
   *
   * 来源是独立的 `strategy_version_star`（`(strategyId, version)` 唯一键）；版本行是
   * 版本存在的唯一来源，星标只允许绑定正式 `strategy_versions` 坐标。
   */
  isStarred: boolean;
} & ClosedLoopBacktestRunSummary;

/** 留档详情（含完整运行结果）。 */
export type ClosedLoopBacktestRunDetail = ClosedLoopBacktestRunRecord & {
  /** `resultJson` 为 NULL 时为 null（表示本次未留完整结果，非「记录损坏」）。 */
  result: ClosedLoopRunResult | null;
  /**
   * `resultJson` 存在、却**读不出来**时的如实原因；`null` = 无此问题。
   *
   * 🔴 与 `result === null` 是两件事：前者=「留了但不可读」，后者=「本次没留」。
   * 细节与已登记升级路径见 `resultCompat.ts`。
   */
  resultIssue: string | null;
};

export type SaveClosedLoopBacktestRunInput = {
  /** 本次运行的坐标（取自 `loopRun` 入参 —— 比结果内嵌的 `assembly` 更可靠）。 */
  experimentId: string;
  strategyId: string;
  strategyVersion: string;
  startDate: string;
  endDate: string;
  /**
   * 本次运行使用的 canonical strategy document。
   *
   * 有值时由调用方保证它已通过策略域校验；保存留档前会先在同一持久化流程中把
   * `(strategyId, version)` 补成正式 `strategy_versions` 行。这样「回测留档」与
   * 「正式版本」不再产生两套版本来源，星标、详情、对比页都只认正式版本。
   */
  strategyDocument?: StrategyDocument;
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

  if (input.strategyDocument !== undefined) {
    const document = input.strategyDocument;
    if (document.strategyId !== input.strategyId || document.version !== input.strategyVersion) {
      throw new Error(
        `留档策略文档坐标不一致：input=${input.strategyId}@${input.strategyVersion}，`
        + `document=${document.strategyId}@${document.version}`,
      );
    }
    const { StrategyService } = await import("../research/strategyPersistence/service");
    const { DbStrategyRepository } = await import("../research/strategyPersistence/db");
    const strategyService = new StrategyService(new DbStrategyRepository());
    await strategyService.save({ document: document as unknown as Record<string, unknown> });
  }

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

type ParsedSummary = {
  summary: ClosedLoopBacktestRunSummary;
  missingMetrics: boolean;
};

/** 概要 JSON 解析：坏文本 ⇒ 抛错（不伪装成空摘要）。 */
function parseSummaryJson(text: string | null): ParsedSummary {
  if (text === null || text === undefined || text === "") {
    throw new Error("留档摘要缺失：summaryJson 为 NULL（记录损坏，不静默降级）");
  }
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("留档摘要结构非法：summaryJson 不是对象");
  }
  const raw = parsed as Record<string, unknown>;
  const missingMetrics =
    !Object.prototype.hasOwnProperty.call(raw, "totalReturnPct") ||
    !Object.prototype.hasOwnProperty.call(raw, "maxDrawdownPct") ||
    !Object.prototype.hasOwnProperty.call(raw, "cagrPct") ||
    !Object.prototype.hasOwnProperty.call(raw, "breadth");
  return {
    summary: {
      ...(parsed as ClosedLoopBacktestRunSummary),
      // 旧行没有这三项；读取时归一成 null，由列表路径惰性回填。
      totalReturnPct: readFiniteNumber(raw.totalReturnPct),
      maxDrawdownPct: readFiniteNumber(raw.maxDrawdownPct),
      cagrPct: readFiniteNumber(raw.cagrPct),
      // 旧行没有 breadth / 漏斗字段：读取时归一成 null，由列表路径惰性回填。
      breadth: readBreadthMetrics(raw.breadth),
      poolMemberCount: readFiniteNumber(raw.poolMemberCount),
      poolPeakActiveMembers: readFiniteNumber(raw.poolPeakActiveMembers),
      poolLowScoreRemoved: readFiniteNumber(raw.poolLowScoreRemoved),
      poolRetired: readFiniteNumber(raw.poolRetired),
      candidateCount: readFiniteNumber(raw.candidateCount),
      selectedIdentityCount: readFiniteNumber(raw.selectedIdentityCount),
      stExcludedEventCount: readFiniteNumber(raw.stExcludedEventCount),
      stRemovedMemberCount: readFiniteNumber(raw.stRemovedMemberCount),
    },
    missingMetrics,
  };
}

/** 星标坐标键：`${strategyId}@${version}`（与 DB 表键一一对应）。 */
function starCoordKey(strategyId: string, version: string): string {
  return `${strategyId}@${version}`;
}

/**
 * 批量读取给定策略的已加星坐标。
 *
 * 星标在 `strategy_version_star`，按 strategyId 一次取回后在内存里按 `strategyId@version`
 * 命中，避免逐行查询（列表最多 200 行）。
 */
async function loadStarredCoordKeys(strategyIds: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(strategyIds.filter(id => id !== ""))];
  if (unique.length === 0) return new Set();
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .select({
      strategyId: strategyVersionStars.strategyId,
      version: strategyVersionStars.version,
    })
    .from(strategyVersionStars)
    .where(inArray(strategyVersionStars.strategyId, unique));
  return new Set(rows.map(row => starCoordKey(row.strategyId, row.version)));
}

/** 单条坐标的星标查询（详情接口用）。 */
async function isVersionStarred(strategyId: string, version: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: strategyVersionStars.id })
    .from(strategyVersionStars)
    .where(
      and(
        eq(strategyVersionStars.strategyId, strategyId),
        eq(strategyVersionStars.version, version),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function rowToRecord(row: SummaryRow, isStarred: boolean): ClosedLoopBacktestRunRecord {
  const { summary } = parseSummaryJson(row.summaryJson);
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
    isStarred,
  };
}

/**
 * 旧留档惰性补齐卡片指标。
 *
 * 背景：三项评估标量是后加到 summaryJson 的；此前落库的行没有。若每次列表都回读
 * resultJson 会把首屏重新拖慢，因此只在内存里按 id 去重：读一次完整结果，回填
 * summaryJson，之后该进程内的列表请求就走摘要快路径。
 */
const summaryMetricsBackfillInFlight = new Map<number, Promise<void>>();

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 广度指标归一化：缺字段 / 结构非法一律当 null（旧行惰性回填前保持可读）。 */
function readBreadthMetrics(value: unknown): ClosedLoopBacktestRunSummary["breadth"] {
  const source =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    tradedInstrumentCount: readFiniteNumber(source.tradedInstrumentCount),
    tradedIdentityCount: readFiniteNumber(source.tradedIdentityCount),
    repeatTradeCount: readFiniteNumber(source.repeatTradeCount),
    repeatTradeRatioPct: readFiniteNumber(source.repeatTradeRatioPct),
    maxTradesPerInstrument: readFiniteNumber(source.maxTradesPerInstrument),
    sameCodeOverlapPairCount: readFiniteNumber(source.sameCodeOverlapPairCount),
    longestReentryChainLength: readFiniteNumber(source.longestReentryChainLength),
    chainTradeRatioPct: readFiniteNumber(source.chainTradeRatioPct),
    immediateReentryCount: readFiniteNumber(source.immediateReentryCount),
    medianReentryGapTradingDays: readFiniteNumber(source.medianReentryGapTradingDays),
    maxReentryGapTradingDays: readFiniteNumber(source.maxReentryGapTradingDays),
  };
}

async function backfillSummaryMetrics(id: number): Promise<void> {
  const existing = summaryMetricsBackfillInFlight.get(id);
  if (existing !== undefined) return existing;

  const task = (async () => {
    const db = await getDb();
    if (!db) return;
    const rows = await db
      .select({
        summaryJson: closedLoopBacktestRun.summaryJson,
        resultJson: closedLoopBacktestRun.resultJson,
      })
      .from(closedLoopBacktestRun)
      .where(eq(closedLoopBacktestRun.id, id));
    const row = rows[0];
    if (row === undefined || row.resultJson === null || row.resultJson === "") return;

    const parsedResult = JSON.parse(row.resultJson) as unknown;
    if (parsedResult === null || typeof parsedResult !== "object" || Array.isArray(parsedResult)) {
      return;
    }
    const fresh = buildClosedLoopBacktestRunSummary(parsedResult as ClosedLoopRunResult);
    const summary = row.summaryJson === null || row.summaryJson === ""
      ? fresh
      : parseSummaryJson(row.summaryJson).summary;
    const evaluation = readEvaluationStageOutput(parsedResult as ClosedLoopRunResult);
    const performance =
      evaluation !== null &&
      typeof evaluation.performance === "object" &&
      evaluation.performance !== null &&
      !Array.isArray(evaluation.performance)
        ? evaluation.performance as Record<string, unknown>
        : null;
    const nextSummary: ClosedLoopBacktestRunSummary = {
      ...summary,
      totalReturnPct:
        performance === null ? summary.totalReturnPct ?? null : readFiniteNumber(performance.totalReturnPct),
      maxDrawdownPct:
        performance === null ? summary.maxDrawdownPct ?? null : readFiniteNumber(performance.maxDrawdownPct),
      cagrPct:
        performance === null ? summary.cagrPct ?? null : readFiniteNumber(performance.cagrPct),
      // BREADTH-001：从真实结果重算并补齐广度 / 漏斗 / ST 口径审计（不读不写 resultJson）。
      breadth: fresh.breadth,
      poolMemberCount: fresh.poolMemberCount,
      poolPeakActiveMembers: fresh.poolPeakActiveMembers,
      poolLowScoreRemoved: fresh.poolLowScoreRemoved,
      poolRetired: fresh.poolRetired,
      candidateCount: fresh.candidateCount,
      selectedIdentityCount: fresh.selectedIdentityCount,
      stExcludedEventCount: fresh.stExcludedEventCount,
      stRemovedMemberCount: fresh.stRemovedMemberCount,
    };
    await db
      .update(closedLoopBacktestRun)
      .set({ summaryJson: JSON.stringify(nextSummary) })
      .where(eq(closedLoopBacktestRun.id, id));
  })().finally(() => {
    summaryMetricsBackfillInFlight.delete(id);
  });

  summaryMetricsBackfillInFlight.set(id, task);
  return task;
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
  const starredKeys = await loadStarredCoordKeys(rows.map(row => row.strategyId));
  const parsedRows = rows.map(row => {
    const { summary, missingMetrics } = parseSummaryJson(row.summaryJson);
    return {
      record: {
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
        isStarred: starredKeys.has(starCoordKey(row.strategyId, row.strategyVersion)),
      },
      missingMetrics,
    };
  });
  const staleIds = parsedRows.filter(row => row.missingMetrics).map(row => row.record.id);
  if (staleIds.length > 0) {
    // 不阻塞首屏：先返回现有摘要（旧记录指标暂为 null），后台小并发回填，
    // 之后的列表请求自然命中已更新的 summaryJson。
    const concurrency = 4;
    void (async () => {
      for (let index = 0; index < staleIds.length; index += concurrency) {
        await Promise.all(
          staleIds.slice(index, index + concurrency).map(id => backfillSummaryMetrics(id)),
        );
      }
    })().catch(() => {
      // 回填失败不改变列表可用性；下次请求会再尝试。
    });
  }
  return parsedRows.map(row => row.record);
}

/**
 * 从 `resultJson` 读出一条留档的结果（读路径的**唯一**入口）。
 *
 * 三种结局，刻意分开、不许互相冒充：
 *   1. `resultJson` 为 NULL / 空 ⇒ `{ result: null, resultIssue: null }`（本次没留完整结果）；
 *   2. 文本解析失败 / 不是对象 ⇒ **抛错**（「记录坏了」必须响，不降级成「没跑过」）；
 *   3. 解析成功但过不了当前契约 ⇒ `{ result: null, resultIssue: <原因> }` —— 如实上报
 *      「留了但读不出来」，且**不抛错**：一条旧契约留档不该把整批对比请求打死
 *      （升级路径与纪律见 `resultCompat.ts`）。
 */
function readArchivedResult(
  id: number,
  resultJson: string | null,
): { result: ClosedLoopRunResult | null; resultIssue: string | null } {
  if (resultJson === null || resultJson === "") {
    return { result: null, resultIssue: null };
  }
  const parsed = JSON.parse(resultJson) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`留档结果结构非法：closed_loop_backtest_run#${id}.resultJson 不是对象`);
  }
  const reconciled = reconcileArchivedClosedLoopResult(parsed);
  return reconciled.status === "ok"
    ? { result: reconciled.result, resultIssue: null }
    : { result: null, resultIssue: reconciled.reason };
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

  const record = rowToRecord(row, await isVersionStarred(row.strategyId, row.strategyVersion));
  return { ...record, ...readArchivedResult(id, row.resultJson) };
}

/**
 * 批量读取多条留档的完整内容（含 `resultJson`）。
 *
 * 用途：单策略多版本对比页需要一次性把若干版本的历史结果拼到一张曲线图上。
 * 与 `getClosedLoopBacktestRun` 同口径：不存在 ⇒ 不返回；`resultJson` 损坏 ⇒ 抛错；
 * 过不了当前契约 ⇒ `result: null` + `resultIssue`（**整批不因此失败**，见 `readArchivedResult`）。
 */
export async function getClosedLoopBacktestRunsByIds(
  ids: readonly number[],
): Promise<ClosedLoopBacktestRunDetail[]> {
  const unique = [...new Set(ids)].filter(id => Number.isInteger(id) && id > 0);
  if (unique.length === 0) return [];
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ ...SUMMARY_COLUMNS, resultJson: closedLoopBacktestRun.resultJson })
    .from(closedLoopBacktestRun)
    .where(inArray(closedLoopBacktestRun.id, unique));

  const byId = new Map<number, ClosedLoopBacktestRunDetail>();
  const starredKeys = await loadStarredCoordKeys(
    (rows as unknown as SummaryRow[]).map(row => row.strategyId),
  );
  for (const raw of rows) {
    const row = raw as unknown as SummaryRow & { resultJson: string | null };
    const record = rowToRecord(
      row,
      starredKeys.has(starCoordKey(row.strategyId, row.strategyVersion)),
    );
    byId.set(row.id, { ...record, ...readArchivedResult(row.id, row.resultJson) });
  }

  // 出参顺序跟随入参，保证「最近一次在前」的语义由调用方掌控。
  return unique.flatMap(id => {
    const detail = byId.get(id);
    return detail === undefined ? [] : [detail];
  });
}
