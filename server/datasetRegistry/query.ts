/**
 * STEP DATASET-002.2 — Dataset Registry 只读查询层（query）。
 *
 * 职责边界（只读，不承载构建/写入/策略/因子）：
 *   - 纯函数：keyset cursor 编解码 + 排序键比较器（唯一事实来源，DB 与 InMemory 共用）；
 *   - `DatasetDataReader`：Event / Prefix / Post / Path / Outcome 的 keyset 分页读取 + 统计聚合
 *     （COUNT/MIN/MAX/GROUP BY，禁止全量加载到 Node）；
 *   - `DbDatasetDataReader`：真实 TiDB 实现，走既有索引
 *     `idx_ds_flp_event_version_date` / `idx_ds_flp_{prefix,post,path}_version_day` / outcome 唯一键；
 *   - `InMemoryDatasetDataReader`：测试用，复用同一套 keyset 比较器（真实分页语义，非 mock 冒名）；
 *   - `DatasetQueryService`：编排 repo（Definition/Version/Job）+ reader（Event/Window/Outcome/Statistics），
 *     产出 shared wire 形状。
 *
 * ### keyset 排序键设计（保证同一天多 event 不重不漏）###
 *   - Event：   `(tradeDate ASC, eventId ASC)`，cursor=(tradeDate, eventId)。eventId 在版本内唯一
 *               （`uq_ds_flp_event_version_event`），故 (tradeDate, eventId) 是全序且唯一，稳定无重复。
 *   - 原始窗口（prefix/post）/ Path：`(eventId ASC, relativeDay ASC)`，cursor=(eventId, relativeDay)。
 *               唯一键 `uq_ds_flp_{prefix,post,path}_version_event_day` 保证全序。
 *   - Outcome： `(eventId ASC, horizon ASC)`，cursor=(eventId, horizon)。唯一键
 *               `uq_ds_flp_outcome_version_event_horizon` 保证全序。
 *   三者的 WHERE 均强制 `datasetVersionId = ?` 下推 + 可选时间/event 过滤 + keyset 谓词 + `LIMIT`，
 *   不使用 OFFSET 深分页。
 */

import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { getDb } from "../db";
import {
  firstLimitPullbackEvents,
  firstLimitPullbackOutcomes,
  firstLimitPullbackPaths,
  firstLimitPullbackPosts,
  firstLimitPullbackPrefixes,
} from "../../drizzle/schema";
import type { DatasetRegistryRepository } from "./registry";
import { computeBuildProgress } from "./lifecycle";
import { isTableMissingError } from "./physicalTables";
import type {
  DatasetBuildConfigRecord,
  DatasetBuildJob,
  DatasetDefinition,
  DatasetVersion,
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "./types";
import type {
  DatasetBuildCheckpointSummary,
  DatasetBuildConfigView,
  DatasetBuildJobDetail,
  DatasetBuildJobListItem,
  DatasetDefinitionDetail,
  DatasetDefinitionListItem,
  DatasetEventItem,
  DatasetOutcomeItem,
  DatasetPage,
  DatasetPathItem,
  DatasetRawBarItem,
  DatasetStatistics,
  DatasetVersionDetail,
  DatasetVersionListItem,
} from "../../shared/datasetRegistryContracts";
import { DATASET_PAGE_LIMIT_DEFAULT } from "../../shared/datasetRegistryContracts";

// ===========================================================================
// 0. 全列名清单（列裁剪与投影校验的共用事实来源）
// ===========================================================================
//
// 从 drizzle 表对象**派生**而不是手抄一份清单：schema 增删列时这里自动跟随，
// 不会出现「schema 加了列、裁剪清单没跟上」这类静默漏读。
//
// 用途：
//   - Research 层据此判断「某个变量的实际读取列」是否真在表里（写错列名当场失败）；
//   - 投影守卫据此区分「未投影的列」与「已投影但取值为 null 的列」。

/** `ds_first_limit_pullback_event` 全部列名。 */
export const DATASET_EVENT_COLUMNS: readonly string[] = Object.keys(getTableColumns(firstLimitPullbackEvents));
/** `ds_first_limit_pullback_prefix` 全部列名（post 表与之同构，共用本清单）。 */
export const DATASET_PREFIX_COLUMNS: readonly string[] = Object.keys(getTableColumns(firstLimitPullbackPrefixes));
/** `ds_first_limit_pullback_path` 全部列名。 */
export const DATASET_PATH_COLUMNS: readonly string[] = Object.keys(getTableColumns(firstLimitPullbackPaths));
/** `ds_first_limit_pullback_outcome` 全部列名。 */
export const DATASET_OUTCOME_COLUMNS: readonly string[] = Object.keys(getTableColumns(firstLimitPullbackOutcomes));

// ===========================================================================
// 1. keyset cursor 编解码（纯函数）
// ===========================================================================

function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
    return obj as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface EventCursor {
  tradeDate: string;
  eventId: string;
}

export interface PathCursor {
  eventId: string;
  relativeDay: number;
}

export interface OutcomeCursor {
  eventId: string;
  horizon: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function encodeEventCursor(tradeDate: string, eventId: string): string {
  return encodeCursor({ tradeDate, eventId });
}

export function decodeEventCursor(cursor: string): EventCursor | null {
  const obj = decodeCursor(cursor);
  if (!obj) return null;
  const { tradeDate, eventId } = obj;
  if (typeof tradeDate !== "string" || !DATE_RE.test(tradeDate)) return null;
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 64) return null;
  return { tradeDate, eventId };
}

export function encodePathCursor(eventId: string, relativeDay: number): string {
  return encodeCursor({ eventId, relativeDay });
}

export function decodePathCursor(cursor: string): PathCursor | null {
  const obj = decodeCursor(cursor);
  if (!obj) return null;
  const { eventId, relativeDay } = obj;
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 64) return null;
  if (typeof relativeDay !== "number" || !Number.isInteger(relativeDay)) return null;
  return { eventId, relativeDay };
}

export function encodeOutcomeCursor(eventId: string, horizon: number): string {
  return encodeCursor({ eventId, horizon });
}

export function decodeOutcomeCursor(cursor: string): OutcomeCursor | null {
  const obj = decodeCursor(cursor);
  if (!obj) return null;
  const { eventId, horizon } = obj;
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 64) return null;
  if (typeof horizon !== "number" || !Number.isInteger(horizon)) return null;
  return { eventId, horizon };
}

// ===========================================================================
// 2. keyset 排序键比较器（DB SQL 谓词与 InMemory 过滤共用的唯一语义来源）
// ===========================================================================

export function compareEventKeys(
  a: { tradeDate: string; eventId: string },
  b: { tradeDate: string; eventId: string },
): number {
  const byDate = a.tradeDate.localeCompare(b.tradeDate);
  return byDate !== 0 ? byDate : a.eventId.localeCompare(b.eventId);
}

export function comparePathKeys(
  a: { eventId: string; relativeDay: number },
  b: { eventId: string; relativeDay: number },
): number {
  const byEvent = a.eventId.localeCompare(b.eventId);
  return byEvent !== 0 ? byEvent : a.relativeDay - b.relativeDay;
}

export function compareOutcomeKeys(
  a: { eventId: string; horizon: number },
  b: { eventId: string; horizon: number },
): number {
  const byEvent = a.eventId.localeCompare(b.eventId);
  return byEvent !== 0 ? byEvent : a.horizon - b.horizon;
}

// ===========================================================================
// 3. DatasetDataReader 契约
// ===========================================================================

/** 原始行情窗口角色（prefix / post 同构，仅相对日区间不同）。 */
export type DatasetRawBarRole = "prefix" | "post";

/**
 * 列投影（可选）：只 SELECT 列名清单里的列。
 *
 * 设计约束：
 *   - 省略 / 空数组 = 不裁剪（等价旧行为 `SELECT *`），保证既有调用方语义不变；
 *   - 列名必须是**该表真实存在**的列，写错当场抛错（不静默少查一列）；
 *   - 裁剪**只减少传输的列数**：不改 WHERE / ORDER BY / LIMIT / 行数，因此不改变任何取值口径。
 *
 * 调用方（Research 装配）见 `server/researchEngine/columnProjection.ts`。
 */
export type ColumnProjection = readonly string[];

/** 把列名数组编译成 drizzle selection；返回 null 表示不裁剪。 */
function buildColumnSelection(
  table: object,
  columns: ColumnProjection | undefined,
): Record<string, MySqlColumn> | null {
  if (!columns || columns.length === 0) return null;
  const columnsByName = table as Record<string, unknown>;
  const selection: Record<string, MySqlColumn> = {};
  for (const name of columns) {
    const column = columnsByName[name];
    if (column === undefined) {
      // 写错列名必须当场失败：否则 drizzle 会少查一列，变量解析读到的永远是 undefined（形同 null），
      // 而这类「特征悄悄变空」在结果层几乎无法察觉 —— 属于正确性事故，不是性能问题。
      throw new Error(`[DatasetQuery] 列投影包含未知列 "${name}"：该表不存在此列`);
    }
    selection[name] = column as MySqlColumn;
  }
  return selection;
}

/** 单版本物理表统计（真实 COUNT / MIN / MAX / DISTINCT，不加载全量行）。 */
export interface DatasetVersionCounts {
  eventCount: number;
  prefixCount: number;
  postCount: number;
  pathCount: number;
  outcomeCount: number;
  /** event + prefix + post + path + outcome 五表行数之和。 */
  rowCount: number;
  /** MIN(event.tradeDate)。 */
  firstDate: string | null;
  /** MAX(event.tradeDate)。 */
  lastDate: string | null;
  /** DISTINCT outcome.horizon（升序）。 */
  horizons: number[];
}

export interface EventPageQuery {
  datasetVersionId: number;
  fromDate?: string;
  toDate?: string;
  cursor?: EventCursor | null;
  limit: number;
  /** 只取这些列（省略 = 全列）。 */
  columns?: ColumnProjection;
}

/** 原始窗口分页查询（prefix / post 共用一套 keyset 语义）。 */
export interface RawBarPageQuery {
  datasetVersionId: number;
  eventId?: string;
  fromDate?: string;
  toDate?: string;
  cursor?: PathCursor | null;
  limit: number;
  /** 只取这些列（省略 = 全列）。 */
  columns?: ColumnProjection;
}

export interface PathPageQuery {
  datasetVersionId: number;
  eventId?: string;
  fromDate?: string;
  toDate?: string;
  cursor?: PathCursor | null;
  limit: number;
  /** 只取这些列（省略 = 全列）。 */
  columns?: ColumnProjection;
}

export interface OutcomePageQuery {
  datasetVersionId: number;
  eventId?: string;
  horizon?: number;
  cursor?: OutcomeCursor | null;
  limit: number;
  /** 只取这些列（省略 = 全列）。 */
  columns?: ColumnProjection;
}

/**
 * 按 eventId 集合批量读取（RESEARCH-002 新增，**只增不改**既有分页语义）。
 *
 * 动机：Research Engine 逐日 keyset 拉事件后，需要「一次把这一批事件的 outcome / path /
 * prefix 取回」，而不是为每个事件各发一次分页查询（1130 事件 = 1130 次跨境往返）。
 *
 * 约束（与既有读取完全一致）：
 *   - 必须带 `datasetVersionId`（版本边界，禁止跨版本读）；
 *   - `eventIds` 为空数组时直接返回 `[]`（**不发 SQL**，避免 `IN ()` 语法错误）；
 *   - 仍走既有唯一键 / 索引，不做全表扫描；
 *   - 不改变任何写路径，不触碰构建逻辑。
 */
export interface OutcomeBatchQuery {
  datasetVersionId: number;
  eventIds: readonly string[];
  horizons?: readonly number[];
  /** 只取这些列（省略 = 全列）。 */
  columns?: ColumnProjection;
}

export interface PathBatchQuery {
  datasetVersionId: number;
  eventIds: readonly string[];
  relativeDays?: readonly number[];
  /** 只取这些列（省略 = 全列）。 */
  columns?: ColumnProjection;
}

export interface RawBarBatchQuery {
  datasetVersionId: number;
  eventIds: readonly string[];
  relativeDays?: readonly number[];
  /** 只取这些列（省略 = 全列）。 */
  columns?: ColumnProjection;
}

export interface DatasetDataReader {
  getVersionCounts(datasetVersionId: number): Promise<DatasetVersionCounts>;
  listEventsPage(query: EventPageQuery): Promise<DatasetPage<FirstLimitPullbackEvent>>;
  /** 原始行情窗口分页（role 决定读 prefix 还是 post；两表同构）。 */
  listRawBarsPage(
    role: DatasetRawBarRole,
    query: RawBarPageQuery,
  ): Promise<DatasetPage<FirstLimitPullbackRawBar>>;
  listPathsPage(query: PathPageQuery): Promise<DatasetPage<FirstLimitPullbackPath>>;
  listOutcomesPage(query: OutcomePageQuery): Promise<DatasetPage<FirstLimitPullbackOutcome>>;

  // ---- 批量读取（按 eventId 集合；RESEARCH-002）----
  loadOutcomesBatch(query: OutcomeBatchQuery): Promise<FirstLimitPullbackOutcome[]>;
  loadPathsBatch(query: PathBatchQuery): Promise<FirstLimitPullbackPath[]>;
  loadRawBarsBatch(role: DatasetRawBarRole, query: RawBarBatchQuery): Promise<FirstLimitPullbackRawBar[]>;
  /** 该版本 `path.relativeDay` 的真实取值范围（供 Research 判断可用视界；无数据返回 null）。 */
  getPathRelativeDayRange(datasetVersionId: number): Promise<{ min: number; max: number } | null>;
}

// ===========================================================================
// 4. InMemory 实现（测试，复用同一套 keyset 语义，非 mock 冒名）
// ===========================================================================

function paginateInMemory<T>(
  sorted: T[],
  limit: number,
  encode: (last: T) => string,
): DatasetPage<T> {
  const hasMore = sorted.length > limit;
  const items = hasMore ? sorted.slice(0, limit) : sorted;
  const nextCursor = hasMore ? encode(items[items.length - 1]!) : null;
  return { items, nextCursor };
}

export class InMemoryDatasetDataReader implements DatasetDataReader {
  constructor(
    private readonly events: FirstLimitPullbackEvent[] = [],
    private readonly paths: FirstLimitPullbackPath[] = [],
    private readonly outcomes: FirstLimitPullbackOutcome[] = [],
    private readonly prefixes: FirstLimitPullbackRawBar[] = [],
    private readonly posts: FirstLimitPullbackRawBar[] = [],
  ) {}

  private rawBars(role: DatasetRawBarRole): FirstLimitPullbackRawBar[] {
    return role === "prefix" ? this.prefixes : this.posts;
  }

  async getVersionCounts(datasetVersionId: number): Promise<DatasetVersionCounts> {
    const events = this.events.filter((e) => e.datasetVersionId === datasetVersionId);
    const prefixes = this.prefixes.filter((p) => p.datasetVersionId === datasetVersionId);
    const posts = this.posts.filter((p) => p.datasetVersionId === datasetVersionId);
    const paths = this.paths.filter((p) => p.datasetVersionId === datasetVersionId);
    const outcomes = this.outcomes.filter((o) => o.datasetVersionId === datasetVersionId);
    const dates = events.map((e) => e.tradeDate).sort();
    const horizons = Array.from(new Set(outcomes.map((o) => o.horizon))).sort((a, b) => a - b);
    return {
      eventCount: events.length,
      prefixCount: prefixes.length,
      postCount: posts.length,
      pathCount: paths.length,
      outcomeCount: outcomes.length,
      rowCount: events.length + prefixes.length + posts.length + paths.length + outcomes.length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      horizons,
    };
  }

  async listRawBarsPage(
    role: DatasetRawBarRole,
    query: RawBarPageQuery,
  ): Promise<DatasetPage<FirstLimitPullbackRawBar>> {
    const { datasetVersionId, eventId, fromDate, toDate, cursor, limit } = query;
    const sorted = this.rawBars(role)
      .filter((b) => {
        if (b.datasetVersionId !== datasetVersionId) return false;
        if (eventId && b.eventId !== eventId) return false;
        if (fromDate && b.tradeDate < fromDate) return false;
        if (toDate && b.tradeDate > toDate) return false;
        if (cursor && comparePathKeys({ eventId: b.eventId, relativeDay: b.relativeDay }, cursor) <= 0) return false;
        return true;
      })
      .sort((a, b) => comparePathKeys({ eventId: a.eventId, relativeDay: a.relativeDay }, { eventId: b.eventId, relativeDay: b.relativeDay }));
    return paginateInMemory(sorted, limit, (b) => encodePathCursor(b.eventId, b.relativeDay));
  }

  async listEventsPage(query: EventPageQuery): Promise<DatasetPage<FirstLimitPullbackEvent>> {
    const { datasetVersionId, fromDate, toDate, cursor, limit } = query;
    const sorted = this.events
      .filter((e) => {
        if (e.datasetVersionId !== datasetVersionId) return false;
        if (fromDate && e.tradeDate < fromDate) return false;
        if (toDate && e.tradeDate > toDate) return false;
        if (cursor && compareEventKeys({ tradeDate: e.tradeDate, eventId: e.eventId }, cursor) <= 0) return false;
        return true;
      })
      .sort((a, b) => compareEventKeys({ tradeDate: a.tradeDate, eventId: a.eventId }, { tradeDate: b.tradeDate, eventId: b.eventId }));
    return paginateInMemory(sorted, limit, (e) => encodeEventCursor(e.tradeDate, e.eventId));
  }

  async listPathsPage(query: PathPageQuery): Promise<DatasetPage<FirstLimitPullbackPath>> {
    const { datasetVersionId, eventId, fromDate, toDate, cursor, limit } = query;
    const sorted = this.paths
      .filter((p) => {
        if (p.datasetVersionId !== datasetVersionId) return false;
        if (eventId && p.eventId !== eventId) return false;
        if (fromDate && p.tradeDate < fromDate) return false;
        if (toDate && p.tradeDate > toDate) return false;
        if (cursor && comparePathKeys({ eventId: p.eventId, relativeDay: p.relativeDay }, cursor) <= 0) return false;
        return true;
      })
      .sort((a, b) => comparePathKeys({ eventId: a.eventId, relativeDay: a.relativeDay }, { eventId: b.eventId, relativeDay: b.relativeDay }));
    return paginateInMemory(sorted, limit, (p) => encodePathCursor(p.eventId, p.relativeDay));
  }

  async listOutcomesPage(query: OutcomePageQuery): Promise<DatasetPage<FirstLimitPullbackOutcome>> {
    const { datasetVersionId, eventId, horizon, cursor, limit } = query;
    const sorted = this.outcomes
      .filter((o) => {
        if (o.datasetVersionId !== datasetVersionId) return false;
        if (eventId && o.eventId !== eventId) return false;
        if (horizon !== undefined && o.horizon !== horizon) return false;
        if (cursor && compareOutcomeKeys({ eventId: o.eventId, horizon: o.horizon }, cursor) <= 0) return false;
        return true;
      })
      .sort((a, b) => compareOutcomeKeys({ eventId: a.eventId, horizon: a.horizon }, { eventId: b.eventId, horizon: b.horizon }));
    return paginateInMemory(sorted, limit, (o) => encodeOutcomeCursor(o.eventId, o.horizon));
  }

  // ---- 批量读取（按 eventId 集合；语义与 DB 实现一致）----

  async loadOutcomesBatch(query: OutcomeBatchQuery): Promise<FirstLimitPullbackOutcome[]> {
    if (query.eventIds.length === 0) return [];
    const ids = new Set(query.eventIds);
    const horizons = query.horizons ? new Set(query.horizons) : null;
    return this.outcomes
      .filter(
        (o) =>
          o.datasetVersionId === query.datasetVersionId &&
          ids.has(o.eventId) &&
          (horizons === null || horizons.has(o.horizon)),
      )
      .sort((a, b) => compareOutcomeKeys({ eventId: a.eventId, horizon: a.horizon }, { eventId: b.eventId, horizon: b.horizon }));
  }

  async loadPathsBatch(query: PathBatchQuery): Promise<FirstLimitPullbackPath[]> {
    if (query.eventIds.length === 0) return [];
    const ids = new Set(query.eventIds);
    const days = query.relativeDays ? new Set(query.relativeDays) : null;
    return this.paths
      .filter(
        (p) =>
          p.datasetVersionId === query.datasetVersionId &&
          ids.has(p.eventId) &&
          (days === null || days.has(p.relativeDay)),
      )
      .sort((a, b) => comparePathKeys({ eventId: a.eventId, relativeDay: a.relativeDay }, { eventId: b.eventId, relativeDay: b.relativeDay }));
  }

  async loadRawBarsBatch(
    role: DatasetRawBarRole,
    query: RawBarBatchQuery,
  ): Promise<FirstLimitPullbackRawBar[]> {
    if (query.eventIds.length === 0) return [];
    const ids = new Set(query.eventIds);
    const days = query.relativeDays ? new Set(query.relativeDays) : null;
    return this.rawBars(role)
      .filter(
        (b) =>
          b.datasetVersionId === query.datasetVersionId &&
          ids.has(b.eventId) &&
          (days === null || days.has(b.relativeDay)),
      )
      .sort((a, b) => comparePathKeys({ eventId: a.eventId, relativeDay: a.relativeDay }, { eventId: b.eventId, relativeDay: b.relativeDay }));
  }

  async getPathRelativeDayRange(datasetVersionId: number): Promise<{ min: number; max: number } | null> {
    const days = this.paths.filter((p) => p.datasetVersionId === datasetVersionId).map((p) => p.relativeDay);
    if (days.length === 0) return null;
    return { min: Math.min(...days), max: Math.max(...days) };
  }
}

// ===========================================================================
// 5. DbDatasetDataReader（真实 TiDB）
// ===========================================================================

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function eventRowToDomain(row: typeof firstLimitPullbackEvents.$inferSelect): FirstLimitPullbackEvent {
  return {
    datasetVersionId: row.datasetVersionId,
    eventId: row.eventId,
    symbol: row.symbol,
    tradeDate: row.tradeDate,
    market: row.market,
    industryCode: row.industryCode,
    boardType: row.boardType,
    previousClose: parseNumber(row.previousClose),
    limitUpPrice: parseNumber(row.limitUpPrice),
    turnover: parseNumber(row.turnover),
    isFirstLimit: row.isFirstLimit === null ? null : Boolean(row.isFirstLimit),
    previousLimitDate: row.previousLimitDate,
    daysSincePreviousLimit: row.daysSincePreviousLimit,
    historicalLimitCount: row.historicalLimitCount,
    marketCap: parseNumber(row.marketCap),
    floatMarketCap: parseNumber(row.floatMarketCap),
  };
}

function pathRowToDomain(row: typeof firstLimitPullbackPaths.$inferSelect): FirstLimitPullbackPath {
  return {
    datasetVersionId: row.datasetVersionId,
    eventId: row.eventId,
    symbol: row.symbol,
    tradeDate: row.tradeDate,
    relativeDay: row.relativeDay,
    highFromEventClose: parseNumber(row.highFromEventClose),
    lowFromEventClose: parseNumber(row.lowFromEventClose),
    closeFromEventClose: parseNumber(row.closeFromEventClose),
    pullbackFromEventHigh: parseNumber(row.pullbackFromEventHigh),
    volumeRatio: parseNumber(row.volumeRatio),
    isBreakout: row.isBreakout === null ? null : Boolean(row.isBreakout),
    breakoutPrice: parseNumber(row.breakoutPrice),
    daysToBreakout: row.daysToBreakout,
  };
}

function outcomeRowToDomain(row: typeof firstLimitPullbackOutcomes.$inferSelect): FirstLimitPullbackOutcome {
  return {
    datasetVersionId: row.datasetVersionId,
    eventId: row.eventId,
    horizon: row.horizon,
    maxReturn: parseNumber(row.maxReturn),
    minReturn: parseNumber(row.minReturn),
    maxDrawdown: parseNumber(row.maxDrawdown),
    isBreakout: row.isBreakout === null ? null : Boolean(row.isBreakout),
    daysToBreakout: row.daysToBreakout,
  };
}

function rawBarRowToDomain(row: typeof firstLimitPullbackPrefixes.$inferSelect): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: row.datasetVersionId,
    eventId: row.eventId,
    symbol: row.symbol,
    tradeDate: row.tradeDate,
    relativeDay: row.relativeDay,
    open: parseNumber(row.open),
    high: parseNumber(row.high),
    low: parseNumber(row.low),
    close: parseNumber(row.close),
    volume: parseNumber(row.volume),
    amount: parseNumber(row.amount),
  };
}

const EMPTY_COUNTS: DatasetVersionCounts = {
  eventCount: 0,
  prefixCount: 0,
  postCount: 0,
  pathCount: 0,
  outcomeCount: 0,
  rowCount: 0,
  firstDate: null,
  lastDate: null,
  horizons: [],
};

export class DbDatasetDataReader implements DatasetDataReader {
  async getVersionCounts(datasetVersionId: number): Promise<DatasetVersionCounts> {
    const db = await getDb();
    if (!db) return { ...EMPTY_COUNTS, horizons: [] };
    try {
      const [eventAgg, prefixAgg, postAgg, pathAgg, outcomeAgg, horizonRows] = await Promise.all([
        db.select({
          n: count(),
          mn: sql<string | null>`MIN(${firstLimitPullbackEvents.tradeDate})`,
          mx: sql<string | null>`MAX(${firstLimitPullbackEvents.tradeDate})`,
        }).from(firstLimitPullbackEvents).where(eq(firstLimitPullbackEvents.datasetVersionId, datasetVersionId)),
        db.select({ n: count() }).from(firstLimitPullbackPrefixes).where(eq(firstLimitPullbackPrefixes.datasetVersionId, datasetVersionId)),
        db.select({ n: count() }).from(firstLimitPullbackPosts).where(eq(firstLimitPullbackPosts.datasetVersionId, datasetVersionId)),
        db.select({ n: count() }).from(firstLimitPullbackPaths).where(eq(firstLimitPullbackPaths.datasetVersionId, datasetVersionId)),
        db.select({ n: count() }).from(firstLimitPullbackOutcomes).where(eq(firstLimitPullbackOutcomes.datasetVersionId, datasetVersionId)),
        db.selectDistinct({ horizon: firstLimitPullbackOutcomes.horizon })
          .from(firstLimitPullbackOutcomes)
          .where(eq(firstLimitPullbackOutcomes.datasetVersionId, datasetVersionId))
          .orderBy(asc(firstLimitPullbackOutcomes.horizon)),
      ]);
      const eventCount = Number(eventAgg[0]?.n ?? 0);
      const prefixCount = Number(prefixAgg[0]?.n ?? 0);
      const postCount = Number(postAgg[0]?.n ?? 0);
      const pathCount = Number(pathAgg[0]?.n ?? 0);
      const outcomeCount = Number(outcomeAgg[0]?.n ?? 0);
      const firstDate = eventAgg[0]?.mn ?? null;
      const lastDate = eventAgg[0]?.mx ?? null;
      const horizons = horizonRows.map((r) => r.horizon);
      return {
        eventCount,
        prefixCount,
        postCount,
        pathCount,
        outcomeCount,
        rowCount: eventCount + prefixCount + postCount + pathCount + outcomeCount,
        firstDate,
        lastDate,
        horizons,
      };
    } catch (err) {
      // 物理表不存在（该 Dataset 未注册构建插件 / 尚未建表）：诚实返回 0 统计，不 500、不编造数据。
      if (isTableMissingError(err)) return { ...EMPTY_COUNTS, horizons: [] };
      throw err;
    }
  }

  async listRawBarsPage(
    role: DatasetRawBarRole,
    query: RawBarPageQuery,
  ): Promise<DatasetPage<FirstLimitPullbackRawBar>> {
    const db = await getDb();
    if (!db) return { items: [], nextCursor: null };
    const table = role === "prefix" ? firstLimitPullbackPrefixes : firstLimitPullbackPosts;
    const { datasetVersionId, eventId, fromDate, toDate, cursor, limit, columns } = query;
    const conditions: SQL[] = [eq(table.datasetVersionId, datasetVersionId)];
    if (eventId) conditions.push(eq(table.eventId, eventId));
    if (fromDate) conditions.push(gte(table.tradeDate, fromDate));
    if (toDate) conditions.push(lte(table.tradeDate, toDate));
    if (cursor) {
      const keyset = or(
        gt(table.eventId, cursor.eventId),
        and(eq(table.eventId, cursor.eventId), gt(table.relativeDay, cursor.relativeDay)),
      );
      if (keyset) conditions.push(keyset);
    }
    const selection = buildColumnSelection(table, columns);
    const rows = selection
      ? await db.select(selection).from(table).where(and(...conditions))
          .orderBy(asc(table.eventId), asc(table.relativeDay)).limit(limit + 1)
      : await db.select().from(table).where(and(...conditions))
          .orderBy(asc(table.eventId), asc(table.relativeDay)).limit(limit + 1);
    const items = rows.map((row) =>
      rawBarRowToDomain(row as unknown as typeof firstLimitPullbackPrefixes.$inferSelect),
    );
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? encodePathCursor(page[page.length - 1]!.eventId, page[page.length - 1]!.relativeDay) : null;
    return { items: page, nextCursor };
  }

  async listEventsPage(query: EventPageQuery): Promise<DatasetPage<FirstLimitPullbackEvent>> {
    const db = await getDb();
    if (!db) return { items: [], nextCursor: null };
    const { datasetVersionId, fromDate, toDate, cursor, limit, columns } = query;
    const conditions: SQL[] = [eq(firstLimitPullbackEvents.datasetVersionId, datasetVersionId)];
    if (fromDate) conditions.push(gte(firstLimitPullbackEvents.tradeDate, fromDate));
    if (toDate) conditions.push(lte(firstLimitPullbackEvents.tradeDate, toDate));
    if (cursor) {
      const keyset = or(
        gt(firstLimitPullbackEvents.tradeDate, cursor.tradeDate),
        and(eq(firstLimitPullbackEvents.tradeDate, cursor.tradeDate), gt(firstLimitPullbackEvents.eventId, cursor.eventId)),
      );
      if (keyset) conditions.push(keyset);
    }
    const selection = buildColumnSelection(firstLimitPullbackEvents, columns);
    const rows = selection
      ? await db.select(selection).from(firstLimitPullbackEvents).where(and(...conditions))
          .orderBy(asc(firstLimitPullbackEvents.tradeDate), asc(firstLimitPullbackEvents.eventId)).limit(limit + 1)
      : await db.select().from(firstLimitPullbackEvents).where(and(...conditions))
          .orderBy(asc(firstLimitPullbackEvents.tradeDate), asc(firstLimitPullbackEvents.eventId)).limit(limit + 1);
    const items = rows.map((row) =>
      eventRowToDomain(row as unknown as typeof firstLimitPullbackEvents.$inferSelect),
    );
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? encodeEventCursor(page[page.length - 1]!.tradeDate, page[page.length - 1]!.eventId) : null;
    return { items: page, nextCursor };
  }

  async listPathsPage(query: PathPageQuery): Promise<DatasetPage<FirstLimitPullbackPath>> {
    const db = await getDb();
    if (!db) return { items: [], nextCursor: null };
    const { datasetVersionId, eventId, fromDate, toDate, cursor, limit, columns } = query;
    const conditions: SQL[] = [eq(firstLimitPullbackPaths.datasetVersionId, datasetVersionId)];
    if (eventId) conditions.push(eq(firstLimitPullbackPaths.eventId, eventId));
    if (fromDate) conditions.push(gte(firstLimitPullbackPaths.tradeDate, fromDate));
    if (toDate) conditions.push(lte(firstLimitPullbackPaths.tradeDate, toDate));
    if (cursor) {
      const keyset = or(
        gt(firstLimitPullbackPaths.eventId, cursor.eventId),
        and(eq(firstLimitPullbackPaths.eventId, cursor.eventId), gt(firstLimitPullbackPaths.relativeDay, cursor.relativeDay)),
      );
      if (keyset) conditions.push(keyset);
    }
    const selection = buildColumnSelection(firstLimitPullbackPaths, columns);
    const rows = selection
      ? await db.select(selection).from(firstLimitPullbackPaths).where(and(...conditions))
          .orderBy(asc(firstLimitPullbackPaths.eventId), asc(firstLimitPullbackPaths.relativeDay)).limit(limit + 1)
      : await db.select().from(firstLimitPullbackPaths).where(and(...conditions))
          .orderBy(asc(firstLimitPullbackPaths.eventId), asc(firstLimitPullbackPaths.relativeDay)).limit(limit + 1);
    const items = rows.map((row) =>
      pathRowToDomain(row as unknown as typeof firstLimitPullbackPaths.$inferSelect),
    );
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? encodePathCursor(page[page.length - 1]!.eventId, page[page.length - 1]!.relativeDay) : null;
    return { items: page, nextCursor };
  }

  async listOutcomesPage(query: OutcomePageQuery): Promise<DatasetPage<FirstLimitPullbackOutcome>> {
    const db = await getDb();
    if (!db) return { items: [], nextCursor: null };
    const { datasetVersionId, eventId, horizon, cursor, limit, columns } = query;
    const conditions: SQL[] = [eq(firstLimitPullbackOutcomes.datasetVersionId, datasetVersionId)];
    if (eventId) conditions.push(eq(firstLimitPullbackOutcomes.eventId, eventId));
    if (horizon !== undefined) conditions.push(eq(firstLimitPullbackOutcomes.horizon, horizon));
    if (cursor) {
      const keyset = or(
        gt(firstLimitPullbackOutcomes.eventId, cursor.eventId),
        and(eq(firstLimitPullbackOutcomes.eventId, cursor.eventId), gt(firstLimitPullbackOutcomes.horizon, cursor.horizon)),
      );
      if (keyset) conditions.push(keyset);
    }
    const selection = buildColumnSelection(firstLimitPullbackOutcomes, columns);
    const rows = selection
      ? await db.select(selection).from(firstLimitPullbackOutcomes).where(and(...conditions))
          .orderBy(asc(firstLimitPullbackOutcomes.eventId), asc(firstLimitPullbackOutcomes.horizon)).limit(limit + 1)
      : await db.select().from(firstLimitPullbackOutcomes).where(and(...conditions))
          .orderBy(asc(firstLimitPullbackOutcomes.eventId), asc(firstLimitPullbackOutcomes.horizon)).limit(limit + 1);
    const items = rows.map((row) =>
      outcomeRowToDomain(row as unknown as typeof firstLimitPullbackOutcomes.$inferSelect),
    );
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? encodeOutcomeCursor(page[page.length - 1]!.eventId, page[page.length - 1]!.horizon) : null;
    return { items: page, nextCursor };
  }

  // ---- 批量读取（按 eventId 集合；强制版本下推，空集合直接返回不触 DB）----

  async loadOutcomesBatch(query: OutcomeBatchQuery): Promise<FirstLimitPullbackOutcome[]> {
    if (query.eventIds.length === 0) return [];
    const db = await getDb();
    if (!db) return [];
    const conditions: SQL[] = [
      eq(firstLimitPullbackOutcomes.datasetVersionId, query.datasetVersionId),
      inArray(firstLimitPullbackOutcomes.eventId, [...query.eventIds]),
    ];
    if (query.horizons && query.horizons.length > 0) {
      conditions.push(inArray(firstLimitPullbackOutcomes.horizon, [...query.horizons]));
    }
    const selection = buildColumnSelection(firstLimitPullbackOutcomes, query.columns);
    const rows = selection
      ? await db.select(selection).from(firstLimitPullbackOutcomes).where(and(...conditions))
      : await db.select().from(firstLimitPullbackOutcomes).where(and(...conditions));
    return rows.map((row) => outcomeRowToDomain(row as unknown as typeof firstLimitPullbackOutcomes.$inferSelect));
  }

  async loadPathsBatch(query: PathBatchQuery): Promise<FirstLimitPullbackPath[]> {
    if (query.eventIds.length === 0) return [];
    const db = await getDb();
    if (!db) return [];
    const conditions: SQL[] = [
      eq(firstLimitPullbackPaths.datasetVersionId, query.datasetVersionId),
      inArray(firstLimitPullbackPaths.eventId, [...query.eventIds]),
    ];
    if (query.relativeDays && query.relativeDays.length > 0) {
      conditions.push(inArray(firstLimitPullbackPaths.relativeDay, [...query.relativeDays]));
    }
    const selection = buildColumnSelection(firstLimitPullbackPaths, query.columns);
    const rows = selection
      ? await db.select(selection).from(firstLimitPullbackPaths).where(and(...conditions))
      : await db.select().from(firstLimitPullbackPaths).where(and(...conditions));
    return rows.map((row) => pathRowToDomain(row as unknown as typeof firstLimitPullbackPaths.$inferSelect));
  }

  async loadRawBarsBatch(
    role: DatasetRawBarRole,
    query: RawBarBatchQuery,
  ): Promise<FirstLimitPullbackRawBar[]> {
    if (query.eventIds.length === 0) return [];
    const db = await getDb();
    if (!db) return [];
    const table = role === "prefix" ? firstLimitPullbackPrefixes : firstLimitPullbackPosts;
    const conditions: SQL[] = [
      eq(table.datasetVersionId, query.datasetVersionId),
      inArray(table.eventId, [...query.eventIds]),
    ];
    if (query.relativeDays && query.relativeDays.length > 0) {
      conditions.push(inArray(table.relativeDay, [...query.relativeDays]));
    }
    const selection = buildColumnSelection(table, query.columns);
    try {
      const rows = selection
        ? await db.select(selection).from(table).where(and(...conditions))
        : await db.select().from(table).where(and(...conditions));
      return rows.map((row) => rawBarRowToDomain(row as unknown as typeof firstLimitPullbackPrefixes.$inferSelect));
    } catch (err) {
      // prefix / post 表尚未建立（该数据集未声明该角色）：诚实返回空，不 500、不编造。
      if (isTableMissingError(err)) return [];
      throw err;
    }
  }

  async getPathRelativeDayRange(datasetVersionId: number): Promise<{ min: number; max: number } | null> {
    const db = await getDb();
    if (!db) return null;
    try {
      const agg = await db
        .select({
          mn: sql<number | null>`MIN(${firstLimitPullbackPaths.relativeDay})`,
          mx: sql<number | null>`MAX(${firstLimitPullbackPaths.relativeDay})`,
        })
        .from(firstLimitPullbackPaths)
        .where(eq(firstLimitPullbackPaths.datasetVersionId, datasetVersionId));
      const mn = agg[0]?.mn;
      const mx = agg[0]?.mx;
      if (mn === null || mn === undefined || mx === null || mx === undefined) return null;
      return { min: Number(mn), max: Number(mx) };
    } catch (err) {
      if (isTableMissingError(err)) return null;
      throw err;
    }
  }
}

// ===========================================================================
// 6. DatasetQueryService（编排 repo + reader → wire）
// ===========================================================================

function isoOrNull(value: string | null | undefined): string | null {
  return value ?? null;
}

export function toDefinitionListItem(d: DatasetDefinition, buildable = false): DatasetDefinitionListItem {
  return {
    id: d.id!,
    datasetCode: d.datasetCode,
    name: d.name,
    description: d.description ?? null,
    datasetType: d.datasetType,
    storageType: d.storageType,
    status: d.status,
    eventTableName: d.eventTableName,
    prefixTableName: d.prefixTableName,
    postTableName: d.postTableName,
    pathTableName: d.pathTableName,
    outcomeTableName: d.outcomeTableName,
    featureTableName: d.featureTableName,
    buildable,
    createdAt: isoOrNull(d.createdAt),
    updatedAt: isoOrNull(d.updatedAt),
  };
}

/** 落库筛选配置 → wire 视图（DATASET-003B；子表多值已展开）。 */
export function toBuildConfigView(c: DatasetBuildConfigRecord): DatasetBuildConfigView {
  return {
    id: c.id!,
    datasetVersionId: c.datasetVersionId,
    boards: [...c.boards],
    excludeSt: c.excludeSt,
    events: c.events.map((e) => ({ relativeDay: e.relativeDay, kind: e.kind })),
    preWindowDays: c.preWindowDays,
    postWindowDays: c.postWindowDays,
    outcomeHorizons: [...c.outcomeHorizons],
    batchSize: c.batchSize,
    configVersion: c.configVersion,
    createdAt: isoOrNull(c.createdAt),
    updatedAt: isoOrNull(c.updatedAt),
  };
}

export function toVersionListItem(v: DatasetVersion): DatasetVersionListItem {
  return {
    id: v.id!,
    datasetId: v.datasetId,
    version: v.version,
    status: v.status,
    startDate: v.startDate ?? null,
    endDate: v.endDate ?? null,
    featureVersion: v.featureVersion ?? null,
    sourceVersion: v.sourceVersion ?? null,
    totalEvents: v.totalEvents ?? null,
    totalRows: v.totalRows ?? null,
    createdAt: isoOrNull(v.createdAt),
    completedAt: isoOrNull(v.completedAt),
  };
}

export function toJobListItem(j: DatasetBuildJob): DatasetBuildJobListItem {  return {
    id: j.id!,
    datasetVersionId: j.datasetVersionId,
    jobId: j.jobId,
    status: j.status,
    totalChunks: j.totalChunks ?? null,
    completedChunks: j.completedChunks ?? null,
    currentChunk: j.currentChunk ?? null,
    processedRows: j.processedRows ?? null,
    failedRows: j.failedRows ?? null,
    lastSymbol: j.lastSymbol ?? null,
    lastTradeDate: j.lastTradeDate ?? null,
    startedAt: j.startedAt ?? null,
    updatedAt: j.updatedAt ?? null,
    completedAt: j.completedAt ?? null,
    errorMessage: j.errorMessage ?? null,
    progress: computeBuildProgress(j),
  };
}

function toCheckpointSummary(j: DatasetBuildJob): DatasetBuildCheckpointSummary | null {
  if (!j.lastCursor) return null;
  try {
    const raw = JSON.parse(j.lastCursor) as Record<string, unknown>;
    return {
      phase: typeof raw.phase === "string" ? raw.phase : "unknown",
      lastTradeDate: typeof raw.lastTradeDate === "string" ? raw.lastTradeDate : null,
      lastSymbol: typeof raw.lastSymbol === "string" ? raw.lastSymbol : null,
      lastEventId: typeof raw.lastEventId === "string" ? raw.lastEventId : null,
      processedRows: typeof raw.processedRows === "number" ? raw.processedRows : 0,
      completedChunks: typeof raw.completedChunks === "number" ? raw.completedChunks : 0,
    };
  } catch {
    return null;
  }
}

export class DatasetQueryService {
  constructor(
    private readonly repo: DatasetRegistryRepository,
    private readonly reader: DatasetDataReader,
    /**
     * 判断某 datasetCode 是否具备构建能力（已注册插件）。
     * 缺省恒 false（只读查询层不猜测构建能力；生产由 router 注入插件注册表）。
     */
    private readonly isBuildable: (datasetCode: string) => boolean = () => false,
  ) {}

  async listDefinitions(): Promise<DatasetDefinitionListItem[]> {
    return (await this.repo.listDefinitions()).map((d) => toDefinitionListItem(d, this.isBuildable(d.datasetCode)));
  }

  async getDefinition(definitionId: number): Promise<DatasetDefinitionDetail | null> {
    const def = await this.repo.getDefinitionById(definitionId);
    if (!def) return null;
    const versions = (await this.repo.listVersions(def.id!)).map(toVersionListItem);
    return { ...toDefinitionListItem(def, this.isBuildable(def.datasetCode)), versions };
  }

  async listVersions(datasetId: number): Promise<DatasetVersionListItem[]> {
    return (await this.repo.listVersions(datasetId)).map(toVersionListItem);
  }

  async getVersion(datasetVersionId: number): Promise<DatasetVersionDetail | null> {
    const version = await this.repo.getVersionById(datasetVersionId);
    if (!version) return null;
    const jobs = (await this.repo.listJobs(version.id!)).map(toJobListItem);
    const config = await this.repo.getBuildConfig(version.id!);
    return {
      ...toVersionListItem(version),
      jobs,
      buildConfig: config ? toBuildConfigView(config) : null,
    };
  }

  async listJobs(datasetVersionId: number): Promise<DatasetBuildJobListItem[]> {
    return (await this.repo.listJobs(datasetVersionId)).map(toJobListItem);
  }

  async getJob(jobId: string): Promise<DatasetBuildJobDetail | null> {
    const job = await this.repo.getJob(jobId);
    if (!job) return null;
    return { ...toJobListItem(job), checkpointSummary: toCheckpointSummary(job) };
  }

  async getStatistics(datasetVersionId: number): Promise<DatasetStatistics | null> {
    const version = await this.repo.getVersionById(datasetVersionId);
    if (!version) return null;
    const counts = await this.reader.getVersionCounts(datasetVersionId);
    return {
      datasetVersionId,
      version: version.version,
      status: version.status,
      declared: {
        totalEvents: version.totalEvents ?? null,
        totalRows: version.totalRows ?? null,
      },
      actual: {
        eventCount: counts.eventCount,
        prefixCount: counts.prefixCount,
        postCount: counts.postCount,
        pathCount: counts.pathCount,
        outcomeCount: counts.outcomeCount,
        rowCount: counts.rowCount,
        firstDate: counts.firstDate,
        lastDate: counts.lastDate,
        horizons: counts.horizons,
      },
    };
  }

  async listEvents(input: EventPageQuery): Promise<DatasetPage<DatasetEventItem>> {
    const page = await this.reader.listEventsPage(input);
    return { items: page.items, nextCursor: page.nextCursor };
  }

  /** 原始行情窗口分页（role 决定读 prefix 还是 post；两表同构）。 */
  async listRawBars(
    role: DatasetRawBarRole,
    input: RawBarPageQuery,
  ): Promise<DatasetPage<DatasetRawBarItem>> {
    const page = await this.reader.listRawBarsPage(role, input);
    return { items: page.items, nextCursor: page.nextCursor };
  }

  async listPaths(input: PathPageQuery): Promise<DatasetPage<DatasetPathItem>> {
    const page = await this.reader.listPathsPage(input);
    return { items: page.items, nextCursor: page.nextCursor };
  }

  async listOutcomes(input: OutcomePageQuery): Promise<DatasetPage<DatasetOutcomeItem>> {
    const page = await this.reader.listOutcomesPage(input);
    return { items: page.items, nextCursor: page.nextCursor };
  }
}

export { DATASET_PAGE_LIMIT_DEFAULT };
