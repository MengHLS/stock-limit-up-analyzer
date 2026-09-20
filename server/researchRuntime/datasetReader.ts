/**
 * RESEARCH-002 — Research 侧的**唯一** Dataset 读取层。
 *
 * 职责（指令 §5）：
 *   - 把「Dataset 数据怎么读」集中到本文件：Analysis / Metric / Conclusion 一律拿不到 DB；
 *   - **不复制** Dataset（不建任何行情 / event / path / outcome 副本表，不写 INSERT）；
 *   - **不修改** Dataset（全只读）；
 *   - 强制 `datasetVersionId` 下推（版本边界），不提供「跨版本」读取入口；
 *   - 复用 `datasetRegistry` 既有的 `DatasetDataReader`（表名安全校验 / 索引 / keyset 基建），
 *     **不另写第二套 SQL**。
 *
 * 复用而非重写：版本上下文来自 `DatasetRegistryRepository`（dataset_version / dataset_definition），
 * 事件与窗口数据来自 `DatasetDataReader`。本文件只做「编排 + 形状适配」。
 */

import type { DatasetRegistryRepository } from "../datasetRegistry/registry";
import {
  DbDatasetDataReader,
  decodeEventCursor,
  encodeEventCursor,
  type DatasetDataReader,
} from "../datasetRegistry/query";
import { withReadRetry } from "../readRetry";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";
import type { ResearchDatasetVersionContext } from "./versionContext";

/** 事件分页查询（cursor 为上次返回的 nextCursor，原样回传）。 */
export interface ResearchEventPageQuery {
  datasetVersionId: number;
  fromDate?: string;
  toDate?: string;
  cursor?: string | null;
  limit: number;
  /** 列投影：只取这些列（省略 = 全列）。由 `columnProjection.ts` 派生。 */
  columns?: readonly string[];
}

export interface ResearchEventPage {
  items: FirstLimitPullbackEvent[];
  nextCursor: string | null;
}

export interface ResearchOutcomeQuery {
  datasetVersionId: number;
  eventIds: readonly string[];
  horizons?: readonly number[];
  /** 列投影：只取这些列（省略 = 全列）。 */
  columns?: readonly string[];
}

export interface ResearchPathQuery {
  datasetVersionId: number;
  eventIds: readonly string[];
  relativeDays?: readonly number[];
  /** 列投影：只取这些列（省略 = 全列）。 */
  columns?: readonly string[];
}

export interface ResearchPrefixBarQuery {
  datasetVersionId: number;
  eventIds: readonly string[];
  relativeDays?: readonly number[];
  /** 列投影：只取这些列（省略 = 全列）。 */
  columns?: readonly string[];
}

/**
 * 观察日（post）行情查询。
 *
 * `post` 与 `prefix` 表**逐字段同构**（仅 `relativeDay` 取值域不同：prefix ≤ 0、post ≥ 1），
 * 因此复用同一个 `loadRawBarsBatch("post", …)` 通路，不新增第二套读取实现。
 *
 * 🔴 PIT：本查询只返回**事件日之后**的行情；调用方（装配层）必须按观察窗口终点裁剪
 * `relativeDays`，且条件求值必须遵守「求值日 k 只能看 offsets ≤ k」。
 */
export interface ResearchPostBarQuery {
  datasetVersionId: number;
  eventIds: readonly string[];
  relativeDays?: readonly number[];
  /** 列投影：只取这些列（省略 = 全列）。 */
  columns?: readonly string[];
}

/** Dataset 读取契约（Research 内唯一入口）。 */
export interface ResearchDatasetReader {
  /** 版本上下文（含 READY 状态与真实视界）；版本不存在返回 null。 */
  getVersionContext(datasetVersionId: number): Promise<ResearchDatasetVersionContext | null>;
  /** 事件 keyset 分页（按 tradeDate, eventId）。 */
  loadEventPage(query: ResearchEventPageQuery): Promise<ResearchEventPage>;
  /** 按 eventId 集合批量读 outcome（future 标签）。 */
  loadOutcomes(query: ResearchOutcomeQuery): Promise<FirstLimitPullbackOutcome[]>;
  /** 按 eventId 集合批量读 path（future 衍生）。 */
  loadPaths(query: ResearchPathQuery): Promise<FirstLimitPullbackPath[]>;
  /** 按 eventId 集合批量读 prefix 原始行情（≤ T，PIT 安全）。 */
  loadPrefixBars(query: ResearchPrefixBarQuery): Promise<FirstLimitPullbackRawBar[]>;
  /**
   * 按 eventId 集合批量读 post 原始行情（T+1..T+N，**观察日**）。
   *
   * 与 `loadPrefixBars` 的关系：同一张「bar」形状、不同的时间域。返回的行可安全用于
   * 构造 `ObservationSources.postBars`（在 T+k 收盘时点可观测，不是事后标签）。
   */
  loadPostBars(query: ResearchPostBarQuery): Promise<FirstLimitPullbackRawBar[]>;
}

// ---------------------------------------------------------------------------
// 真实实现：适配 datasetRegistry
// ---------------------------------------------------------------------------

export interface RegistryResearchDatasetReaderDeps {
  /** Dataset 数据读取器；缺省构造真实 DB 实现。 */
  dataReader?: DatasetDataReader;
  /** Dataset Registry 仓储（读 dataset_version / dataset_definition）。 */
  registryRepo: DatasetRegistryRepository;
}

/**
 * 从 `dataset_version` 冻结的 universe / filter 定义里读「决策日偏移 d」。
 *
 * 🔴 只认真实落库值：取不到就是 `null`（**不是**「默认整窗」）。研究引擎据此拒绝
 * 「数据集未声明决策日却使用观察日变量」的分析 —— 缺省绝不放行。
 * 先看 universeDefinition（当前写入点），再看 filterDefinition（历史镜像）。
 */
function extractDecisionOffsetDays(...definitions: unknown[]): number | null {
  for (const definition of definitions) {
    if (definition === null || typeof definition !== "object") continue;
    const value = (definition as Record<string, unknown>).pullbackDecisionOffsetDays;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  }
  return null;
}

export class RegistryResearchDatasetReader implements ResearchDatasetReader {
  private readonly dataReader: DatasetDataReader;
  private readonly registryRepo: DatasetRegistryRepository;

  constructor(deps: RegistryResearchDatasetReaderDeps) {
    this.dataReader = deps.dataReader ?? new DbDatasetDataReader();
    this.registryRepo = deps.registryRepo;
  }

  async getVersionContext(datasetVersionId: number): Promise<ResearchDatasetVersionContext | null> {
    const version = await withReadRetry("getVersionById", () => this.registryRepo.getVersionById(datasetVersionId));
    if (!version) return null;
    const definition = await withReadRetry("getDefinitionById", () => this.registryRepo.getDefinitionById(version.datasetId));
    const [counts, pathRange, postRange] = await Promise.all([
      withReadRetry("getVersionCounts", () => this.dataReader.getVersionCounts(datasetVersionId)),
      withReadRetry("getPathRelativeDayRange", () => this.dataReader.getPathRelativeDayRange(datasetVersionId)),
      withReadRetry("getPostRelativeDayRange", () => this.dataReader.getPostRelativeDayRange(datasetVersionId)),
    ]);
    return {
      datasetVersionId,
      datasetId: version.datasetId,
      datasetCode: definition?.datasetCode ?? "(unknown)",
      datasetName: definition?.name ?? "(unknown)",
      versionLabel: version.version,
      status: version.status,
      startDate: version.startDate ?? null,
      endDate: version.endDate ?? null,
      totalEvents: version.totalEvents ?? counts.eventCount,
      horizons: counts.horizons,
      pathRelativeDayRange: pathRange,
      postRelativeDayRange: postRange,
      decisionOffsetDays: extractDecisionOffsetDays(
        version.universeDefinition,
        version.filterDefinition,
      ),
    };
  }

  async loadEventPage(query: ResearchEventPageQuery): Promise<ResearchEventPage> {
    const cursor = query.cursor ? decodeEventCursor(query.cursor) : null;
    const page = await withReadRetry("loadEventPage", () => this.dataReader.listEventsPage({
      datasetVersionId: query.datasetVersionId,
      ...(query.fromDate !== undefined ? { fromDate: query.fromDate } : {}),
      ...(query.toDate !== undefined ? { toDate: query.toDate } : {}),
      cursor,
      limit: query.limit,
      ...(query.columns !== undefined ? { columns: query.columns } : {}),
    }));
    return { items: page.items, nextCursor: page.nextCursor };
  }

  async loadOutcomes(query: ResearchOutcomeQuery): Promise<FirstLimitPullbackOutcome[]> {
    return withReadRetry("loadOutcomes", () => this.dataReader.loadOutcomesBatch({
      datasetVersionId: query.datasetVersionId,
      eventIds: query.eventIds,
      ...(query.horizons !== undefined ? { horizons: query.horizons } : {}),
      ...(query.columns !== undefined ? { columns: query.columns } : {}),
    }));
  }

  async loadPaths(query: ResearchPathQuery): Promise<FirstLimitPullbackPath[]> {
    return withReadRetry("loadPaths", () => this.dataReader.loadPathsBatch({
      datasetVersionId: query.datasetVersionId,
      eventIds: query.eventIds,
      ...(query.relativeDays !== undefined ? { relativeDays: query.relativeDays } : {}),
      ...(query.columns !== undefined ? { columns: query.columns } : {}),
    }));
  }

  async loadPrefixBars(query: ResearchPrefixBarQuery): Promise<FirstLimitPullbackRawBar[]> {
    return withReadRetry("loadPrefixBars", () => this.dataReader.loadRawBarsBatch("prefix", {
      datasetVersionId: query.datasetVersionId,
      eventIds: query.eventIds,
      ...(query.relativeDays !== undefined ? { relativeDays: query.relativeDays } : {}),
      ...(query.columns !== undefined ? { columns: query.columns } : {}),
    }));
  }

  async loadPostBars(query: ResearchPostBarQuery): Promise<FirstLimitPullbackRawBar[]> {
    return withReadRetry("loadPostBars", () => this.dataReader.loadRawBarsBatch("post", {
      datasetVersionId: query.datasetVersionId,
      eventIds: query.eventIds,
      ...(query.relativeDays !== undefined ? { relativeDays: query.relativeDays } : {}),
      ...(query.columns !== undefined ? { columns: query.columns } : {}),
    }));
  }
}

// ---------------------------------------------------------------------------
// 内存实现（单测用；不是 mock 冒名：它执行与 DB 实现等价的过滤语义）
// ---------------------------------------------------------------------------

export interface InMemoryResearchDatasetReaderSeed {
  context: ResearchDatasetVersionContext;
  events?: readonly FirstLimitPullbackEvent[];
  paths?: readonly FirstLimitPullbackPath[];
  outcomes?: readonly FirstLimitPullbackOutcome[];
  prefixBars?: readonly FirstLimitPullbackRawBar[];
  /** 观察日行情（`relativeDay` ≥ 1）。缺省表示该数据集无 post 数据 ⇒ 观察日变量全部不可用。 */
  postBars?: readonly FirstLimitPullbackRawBar[];
}

export class InMemoryResearchDatasetReader implements ResearchDatasetReader {
  readonly events: FirstLimitPullbackEvent[];
  readonly paths: FirstLimitPullbackPath[];
  readonly outcomes: FirstLimitPullbackOutcome[];
  readonly prefixBars: FirstLimitPullbackRawBar[];
  readonly postBars: FirstLimitPullbackRawBar[];
  private readonly context: ResearchDatasetVersionContext;

  /** 便于断言「读取层确实按版本 / 按批下推」，而不是把全部数据无脑塞回去。 */
  readonly callLog: Array<{ method: string; datasetVersionId: number; ids?: number }> = [];

  constructor(seed: InMemoryResearchDatasetReaderSeed) {
    this.context = seed.context;
    this.events = [...(seed.events ?? [])];
    this.paths = [...(seed.paths ?? [])];
    this.outcomes = [...(seed.outcomes ?? [])];
    this.prefixBars = [...(seed.prefixBars ?? [])];
    this.postBars = [...(seed.postBars ?? [])];
  }

  async getVersionContext(datasetVersionId: number): Promise<ResearchDatasetVersionContext | null> {
    return this.context.datasetVersionId === datasetVersionId ? this.context : null;
  }

  async loadEventPage(query: ResearchEventPageQuery): Promise<ResearchEventPage> {
    const decoded = query.cursor ? decodeEventCursor(query.cursor) : null;
    this.callLog.push({ method: "loadEventPage", datasetVersionId: query.datasetVersionId });
    const sorted = this.events
      .filter((e) => {
        if (e.datasetVersionId !== query.datasetVersionId) return false;
        if (query.fromDate && e.tradeDate < query.fromDate) return false;
        if (query.toDate && e.tradeDate > query.toDate) return false;
        if (decoded) {
          if (e.tradeDate < decoded.tradeDate) return false;
          if (e.tradeDate === decoded.tradeDate && e.eventId <= decoded.eventId) return false;
        }
        return true;
      })
      .sort((a, b) =>
        a.tradeDate === b.tradeDate ? a.eventId.localeCompare(b.eventId) : a.tradeDate.localeCompare(b.tradeDate),
      );
    const hasMore = sorted.length > query.limit;
    const items = hasMore ? sorted.slice(0, query.limit) : sorted;
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeEventCursor(last.tradeDate, last.eventId) : null,
    };
  }

  async loadOutcomes(query: ResearchOutcomeQuery): Promise<FirstLimitPullbackOutcome[]> {
    if (query.eventIds.length === 0) return [];
    this.callLog.push({ method: "loadOutcomes", datasetVersionId: query.datasetVersionId, ids: query.eventIds.length });
    const ids = new Set(query.eventIds);
    const horizons = query.horizons ? new Set(query.horizons) : null;
    return this.outcomes.filter(
      (o) =>
        o.datasetVersionId === query.datasetVersionId &&
        ids.has(o.eventId) &&
        (horizons === null || horizons.has(o.horizon)),
    );
  }

  async loadPaths(query: ResearchPathQuery): Promise<FirstLimitPullbackPath[]> {
    if (query.eventIds.length === 0) return [];
    this.callLog.push({ method: "loadPaths", datasetVersionId: query.datasetVersionId, ids: query.eventIds.length });
    const ids = new Set(query.eventIds);
    const days = query.relativeDays ? new Set(query.relativeDays) : null;
    return this.paths.filter(
      (p) =>
        p.datasetVersionId === query.datasetVersionId &&
        ids.has(p.eventId) &&
        (days === null || days.has(p.relativeDay)),
    );
  }

  async loadPrefixBars(query: ResearchPrefixBarQuery): Promise<FirstLimitPullbackRawBar[]> {
    if (query.eventIds.length === 0) return [];
    this.callLog.push({ method: "loadPrefixBars", datasetVersionId: query.datasetVersionId, ids: query.eventIds.length });
    const ids = new Set(query.eventIds);
    const days = query.relativeDays ? new Set(query.relativeDays) : null;
    return this.prefixBars.filter(
      (b) =>
        b.datasetVersionId === query.datasetVersionId &&
        ids.has(b.eventId) &&
        (days === null || days.has(b.relativeDay)),
    );
  }

  async loadPostBars(query: ResearchPostBarQuery): Promise<FirstLimitPullbackRawBar[]> {
    if (query.eventIds.length === 0) return [];
    this.callLog.push({ method: "loadPostBars", datasetVersionId: query.datasetVersionId, ids: query.eventIds.length });
    const ids = new Set(query.eventIds);
    const days = query.relativeDays ? new Set(query.relativeDays) : null;
    return this.postBars.filter(
      (b) =>
        b.datasetVersionId === query.datasetVersionId &&
        ids.has(b.eventId) &&
        (days === null || days.has(b.relativeDay)),
    );
  }
}
