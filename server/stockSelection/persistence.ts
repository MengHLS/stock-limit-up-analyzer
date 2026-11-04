/**
 * STOCK-SELECTION-005 — 选股结果快照持久化（**手动保存**）。
 *
 * 职责：把一次 `DailyStockSelection`（选股清单 + **剔除统计**）冻结进 `stock_selection_run`，
 * 并支持回看。**不参与计算**：重算恒走 `strategies/**` 的权威实现，本模块只负责序列化 / 落库 / 读回。
 *
 * 纪律：
 *   - **runId 确定性**（同一坐标 → 同一 runId）⇒ 重复保存是 UPSERT 覆盖，不产生重复行；
 *   - JSON 读取**响亮失败**：快照由本模块写入，解析不出来说明数据真坏了，绝不静默当成「没有剔除」；
 *   - 存 store 端口（`StockSelectionRunStore`）以便路由单测注入内存实现，不连库。
 */

import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { stockSelectionRun } from "../../drizzle/schema";
import type { DailyStockSelection, StockSelectionExcludedStock, StockSelectionPick } from "./types";

/** 选股结果快照的**列表行**（不含 picks 明细，避免列表页拉大对象）。 */
export interface StockSelectionRunSummary {
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyLabel: string;
  readonly sourceKind: string;
  readonly sourceLabel: string;
  readonly datasetVersionId: number | null;
  readonly decisionDate: string;
  readonly topN: number;
  readonly candidateEventCount: number;
  readonly rankedCandidateCount: number;
  /** **剔除统计**（原因码 → 条数）；由 `excludedStocks` 归并，二者恒一致。 */
  readonly excluded: Readonly<Record<string, number>>;
  /** 被剔除的**具体股票**（原因 + 代码 + canonical 身份），用于「哪只票为什么没选上」。 */
  readonly excludedStocks: readonly StockSelectionExcludedStock[];
  /** 入选只数（由 picksJson 解析计数；列表展示用）。 */
  readonly pickCount: number;
  readonly dataWindow: { readonly startDate: string; readonly endDate: string } | null;
  /** 保存时点（服务端时间，ISO-8601）。 */
  readonly capturedAt: string;
}

/** 选股结果快照的**明细**（含 picks）。 */
export interface StockSelectionRunDetail extends StockSelectionRunSummary {
  readonly picks: readonly StockSelectionPick[];
}

/** 选股快照存取端口（生产 = DB；测试 = 内存）。 */
export interface StockSelectionRunStore {
  /** 保存（同坐标 UPSERT 覆盖）；返回落库后的列表行。 */
  save(run: DailyStockSelection): Promise<StockSelectionRunSummary>;
  /** 历史列表（按决策日倒序，其次保存顺序倒序）；limit 缺省 = 默认值。 */
  list(limit?: number): Promise<StockSelectionRunSummary[]>;
  /** 按 runId 取明细；不存在 = null。 */
  get(runId: string): Promise<StockSelectionRunDetail | null>;
}

/** 列表默认 / 上限条数（防止一次拉爆历史）。 */
export const STOCK_SELECTION_RUN_LIST_DEFAULT_LIMIT = 20;
export const STOCK_SELECTION_RUN_LIST_MAX_LIMIT = 200;

/**
 * 确定性 runId：`SEL-<YYYYMMDD>-<8 hex>`。
 *
 * 键 = (strategyId, sourceKind, datasetVersionId, decisionDate, topN)
 * ⇒ 同一坐标重复保存**覆盖同一行**（幂等），不同 TopN / 不同载体 / 不同版本各自独立成行。
 */
export function buildSelectionRunId(input: {
  strategyId: string;
  sourceKind: string;
  datasetVersionId: number | null;
  decisionDate: string;
  topN: number;
}): string {
  const key = [
    input.strategyId,
    input.sourceKind,
    input.datasetVersionId === null ? "none" : String(input.datasetVersionId),
    input.decisionDate,
    String(input.topN),
  ].join("|");
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return `SEL-${input.decisionDate.replaceAll("-", "")}-${digest}`;
}

/**
 * 剔除统计的落库形状：**计数 + 逐只明细**放进同一个 JSON 列（无需新增列）。
 * 二者由同一条记录流归并/展开 ⇒ 恒自洽（`sum(counts) === stocks.length`）。
 */
export interface PersistedExclusionStats {
  readonly counts: Record<string, number>;
  readonly stocks: readonly StockSelectionExcludedStock[];
}

/**
 * 剔除统计 → JSON（**键序稳定**，便于人工比对与对账）。
 *
 * 🔴 形状：`{ counts: {原因: 条数}, stocks: [逐只明细] }`。
 * 兼容读取旧的「纯计数」形状（见 `parseExcluded`），但**新写入恒为双段形状**。
 */
export function serializeExcluded(
  excluded: Readonly<Record<string, number>>,
  stocks: readonly StockSelectionExcludedStock[],
): string {
  const sorted = Object.fromEntries(
    Object.entries(excluded).sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify({ counts: sorted, stocks });
}

/** JSON → 剔除统计（计数 + 逐只明细）；非法 **响亮抛错**（不静默当成空）。 */
export function parseExcluded(json: string): PersistedExclusionStats {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`选股剔除统计 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("选股剔除统计 JSON 形状非法（应为对象）");
  }
  const record = parsed as Record<string, unknown>;
  // 向后兼容：早期版本写入的是「纯计数」扁平对象（无 counts 键）。
  const rawCounts = "counts" in record ? record.counts : record;
  const rawStocks = "counts" in record ? record.stocks : [];
  if (rawCounts === null || typeof rawCounts !== "object" || Array.isArray(rawCounts)) {
    throw new Error("选股剔除统计 JSON 形状非法（counts 应为对象）");
  }
  const counts: Record<string, number> = {};
  for (const [reason, count] of Object.entries(rawCounts as Record<string, unknown>)) {
    if (typeof count !== "number" || !Number.isFinite(count)) {
      throw new Error(`选股剔除统计条目非法：${reason}=${String(count)}`);
    }
    counts[reason] = count;
  }
  if (!Array.isArray(rawStocks)) {
    throw new Error("选股剔除统计 JSON 形状非法（stocks 应为数组）");
  }
  return { counts, stocks: rawStocks as StockSelectionExcludedStock[] };
}

/** 选股清单 → JSON。 */
export function serializePicks(picks: readonly StockSelectionPick[]): string {
  return JSON.stringify(picks);
}

/** JSON → 选股清单；非法 / 非数组 **响亮抛错**。 */
export function parsePicks(json: string): StockSelectionPick[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`选股清单 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("选股清单 JSON 形状非法（应为数组）");
  return parsed as StockSelectionPick[];
}

/** 汇总行 → 领域坐标（供 runId / 落库复用）。 */
export function selectionRunCoordinates(run: DailyStockSelection): {
  strategyId: string;
  sourceKind: string;
  sourceLabel: string;
  datasetVersionId: number | null;
  decisionDate: string;
  topN: number;
} {
  return {
    strategyId: run.strategyId,
    sourceKind: run.source.kind,
    sourceLabel: run.source.label,
    datasetVersionId: run.datasetVersionId,
    decisionDate: run.decisionDate,
    topN: run.topN,
  };
}

/** 领域结果 → 落库值（纯函数，便于单测断言「剔除统计不丢」）。 */
export function toInsertValues(run: DailyStockSelection, capturedAt: Date) {
  const coords = selectionRunCoordinates(run);
  return {
    runId: buildSelectionRunId(coords),
    strategyId: coords.strategyId,
    strategyLabel: run.strategyLabel,
    sourceKind: coords.sourceKind,
    sourceLabel: coords.sourceLabel,
    datasetVersionId: coords.datasetVersionId,
    decisionDate: coords.decisionDate,
    topN: coords.topN,
    candidateEventCount: run.filterStats.candidateEventCount,
    rankedCandidateCount: run.filterStats.rankedCandidateCount,
    excludedJson: serializeExcluded(run.filterStats.excluded, run.filterStats.excludedStocks),
    picksJson: serializePicks(run.picks),
    dataWindowStartDate: run.dataWindow?.startDate ?? null,
    dataWindowEndDate: run.dataWindow?.endDate ?? null,
    capturedAt,
  };
}

/** 归一化 limit（非法 / 缺省 → 默认值；超上限 → 上限）。 */
export function normalizeListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return STOCK_SELECTION_RUN_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), STOCK_SELECTION_RUN_LIST_MAX_LIMIT);
}

type StockSelectionRunRow = typeof stockSelectionRun.$inferSelect;

/** 从落库值直接构造列表行（DB save 与内存 store 共用，避免两处漂移）。 */
function summaryFromValues(values: ReturnType<typeof toInsertValues>): StockSelectionRunSummary {
  const exclusion = parseExcluded(values.excludedJson);
  return {
    runId: values.runId,
    strategyId: values.strategyId,
    strategyLabel: values.strategyLabel,
    sourceKind: values.sourceKind,
    sourceLabel: values.sourceLabel,
    datasetVersionId: values.datasetVersionId,
    decisionDate: values.decisionDate,
    topN: values.topN,
    candidateEventCount: values.candidateEventCount,
    rankedCandidateCount: values.rankedCandidateCount,
    excluded: exclusion.counts,
    excludedStocks: exclusion.stocks,
    pickCount: parsePicks(values.picksJson).length,
    dataWindow:
      values.dataWindowStartDate !== null && values.dataWindowEndDate !== null
        ? { startDate: values.dataWindowStartDate, endDate: values.dataWindowEndDate }
        : null,
    capturedAt: values.capturedAt.toISOString(),
  };
}

/** 落库行 → 列表行（picks 只计数，不解析大对象）。 */
function rowToSummary(row: StockSelectionRunRow): StockSelectionRunSummary {
  return {
    runId: row.runId,
    strategyId: row.strategyId,
    strategyLabel: row.strategyLabel,
    sourceKind: row.sourceKind,
    sourceLabel: row.sourceLabel,
    datasetVersionId: row.datasetVersionId ?? null,
    decisionDate: row.decisionDate,
    topN: row.topN,
    candidateEventCount: row.candidateEventCount,
    rankedCandidateCount: row.rankedCandidateCount,
    excluded: parseExcluded(row.excludedJson).counts,
    excludedStocks: parseExcluded(row.excludedJson).stocks,
    pickCount: parsePicks(row.picksJson).length,
    dataWindow:
      row.dataWindowStartDate !== null && row.dataWindowEndDate !== null
        ? { startDate: row.dataWindowStartDate, endDate: row.dataWindowEndDate }
        : null,
    capturedAt: new Date(row.capturedAt).toISOString(),
  };
}

/** 落库行 → 明细。 */
function rowToDetail(row: StockSelectionRunRow): StockSelectionRunDetail {
  return { ...rowToSummary(row), picks: parsePicks(row.picksJson) };
}

/** 生产实现（TiDB）。 */
export function createDbStockSelectionRunStore(): StockSelectionRunStore {
  return {
    async save(run) {
      const db = await getDb();
      if (!db) throw new Error("数据库不可用，无法保存选股结果");
      const values = toInsertValues(run, new Date());
      await db
        .insert(stockSelectionRun)
        .values(values)
        .onDuplicateKeyUpdate({
          set: {
            strategyLabel: values.strategyLabel,
            sourceKind: values.sourceKind,
            sourceLabel: values.sourceLabel,
            datasetVersionId: values.datasetVersionId,
            topN: values.topN,
            candidateEventCount: values.candidateEventCount,
            rankedCandidateCount: values.rankedCandidateCount,
            excludedJson: values.excludedJson,
            picksJson: values.picksJson,
            dataWindowStartDate: values.dataWindowStartDate,
            dataWindowEndDate: values.dataWindowEndDate,
            capturedAt: values.capturedAt,
            updatedAt: new Date(),
          },
        });
      return summaryFromValues(values);
    },

    async list(limit) {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(stockSelectionRun)
        .orderBy(desc(stockSelectionRun.decisionDate), desc(stockSelectionRun.id))
        .limit(normalizeListLimit(limit));
      return rows.map(rowToSummary);
    },

    async get(runId) {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select()
        .from(stockSelectionRun)
        .where(eq(stockSelectionRun.runId, runId))
        .limit(1);
      return rows[0] ? rowToDetail(rows[0]) : null;
    },
  };
}

/** 内存实现（单测 / 离线用；语义与 DB 实现一致：同 runId 覆盖）。 */
export function createMemoryStockSelectionRunStore(): StockSelectionRunStore {
  const byRunId = new Map<string, { run: DailyStockSelection; capturedAt: Date }>();
  const summaryOf = (runId: string): StockSelectionRunSummary => {
    const entry = byRunId.get(runId)!;
    return summaryFromValues(toInsertValues(entry.run, entry.capturedAt));
  };
  return {
    async save(run) {
      const runId = buildSelectionRunId(selectionRunCoordinates(run));
      byRunId.set(runId, { run, capturedAt: new Date() });
      return summaryOf(runId);
    },
    async list(limit) {
      const sorted = [...byRunId.keys()].sort((left, right) => right.localeCompare(left));
      return sorted.slice(0, normalizeListLimit(limit)).map(summaryOf);
    },
    async get(runId) {
      const entry = byRunId.get(runId);
      if (!entry) return null;
      return { ...summaryOf(runId), picks: entry.run.picks };
    },
  };
}