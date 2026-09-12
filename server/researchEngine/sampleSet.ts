/**
 * RESEARCH-002 — 样本装配（把 Dataset 原始行按变量需求最小化装成 `ResearchSample[]`）。
 *
 * 性能纪律（指令 §18）：
 *   - **只加载被申请的列**：先由 `columnProjection.ts` 从变量定义**自动派生**列投影
 *     （读取即声明），再把它下推到 Dataset 读取层；未申请的列不进内存、不上跨境链路；
 *   - **只加载被申请的窗口**：变量目录声明需要哪些 prefix 相对日 / path 相对日 / outcome 视界，
 *     未申请的行不进内存；
 *   - **逐页装配**：事件按 keyset 分页（默认 2000/批），每批一次 `IN (...)` 批量取窗口数据，
 *     不做「每事件一次查询」的 N+1；
 *   - **有界流水并发**：见下；
 *   - **硬上限保护**：超过 `maxSamples` 抛 `DATASET_TOO_LARGE`（诚实失败），
 *     不把百万级样本硬塞进 Node 内存后 OOM；
 *   - 装配结果**不落库**：本层不写任何 Dataset 表，也不建副本表。
 *
 * ## 为什么是「流水并发」而不是「并发分页」
 *
 * 跨境 TiDB 的成本模型是 `耗时 ≈ 行数 × 单行成本 ÷ 并发度`：实测 RTT≈208ms 但
 * 「RTT × 往返次数」只占总耗时约 2%，即**吞吐受限**。原实现是严格的「取一批 → 等 → 装配 → 取下一批」，
 * 每一批内部的 3 条批量查询（prefix / path / outcome）虽然 `Promise.all` 并发，但**批与批之间不重叠**：
 * 装配（CPU）与下一批取数（网络）串行，链路在装配期间完全空转。
 *
 * 本实现把两者叠成流水线：**下一批事件分页的取数在前一批的数据还在路上时就开始**，
 * 稳态最多 `pageConcurrency` 批数据在飞（有界，不把连接池打爆、不无界堆内存）。
 *
 * 排序不变：事件分页链仍然严格按 keyset 顺序推进（cursor 依赖上一页），
 * 消费端也严格按批序装配，因此结果与串行版本逐位一致。
 */

import { engineAssert } from "./errors";
import type { ResearchDatasetReader } from "./datasetReader";
import type { ResearchSample, ResearchVariableRequirement } from "./types";
import {
  ResearchVariableCatalog,
  resolveDimensionValue,
  type RegimeTagProvider,
} from "./variables";
import {
  deriveColumnProjection,
  fullColumnProjection,
  guardProjectedRow,
  resolveGuardMode,
  type ProjectionGuardMode,
  type ProjectionRole,
  type ResearchColumnProjection,
} from "./columnProjection";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
  FirstLimitPullbackRawBar,
} from "../datasetRegistry/types";

/** 默认事件分页大小。 */
export const DEFAULT_EVENT_PAGE_SIZE = 2000;

/** 默认样本上限（超限诚实失败，不静默截断）。 */
export const DEFAULT_MAX_SAMPLES = 200_000;

/**
 * 默认流水线深度（同时在飞的批次数）。
 *
 * 标定依据（跨境 TiDB，压缩 + 列裁剪）：单连接 5,666 行/s，3 连接 15,458，6 连接 18,357
 * ——吞吐在 **~6 条并发语句**后进入平台期。每批含 3 条批量查询（prefix / path / outcome），
 * 因此深度 2 即触及平台（6 条在飞），取 3 留一档抗抖动余量（稳态 ≤ 9 条，连接池 16 有余）。
 */
export const DEFAULT_ASSEMBLY_CONCURRENCY = 3;

/** 解析流水线深度（env `RESEARCH_ASSEMBLY_CONCURRENCY` 可覆盖；上限 16 防止把连接池打爆）。 */
export function resolveAssemblyConcurrency(raw: string | undefined = process.env.RESEARCH_ASSEMBLY_CONCURRENCY): number {
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 1) return Math.min(Math.floor(value), 16);
  return DEFAULT_ASSEMBLY_CONCURRENCY;
}

export interface BuildSampleSetOptions {
  reader: ResearchDatasetReader;
  datasetVersionId: number;
  catalog: ResearchVariableCatalog;
  requirement: ResearchVariableRequirement;
  /** 需要额外解析的分组维度键（year / board / regime…）。 */
  dimensionKeys?: readonly string[];
  regimeProvider?: RegimeTagProvider;
  dateRange?: { startDate?: string; endDate?: string };
  eventPageSize?: number;
  maxSamples?: number;
  /** 流水线深度（同时在飞的批次数）；缺省取 `resolveAssemblyConcurrency()`。 */
  pageConcurrency?: number;
  /** 列投影守卫策略；缺省取 env `RESEARCH_PROJECTION_GUARD`（默认 `first-chunk`）。 */
  projectionGuard?: ProjectionGuardMode;
  /**
   * 显式指定列投影。
   *   - 缺省：由变量定义自动派生（生产路径）；
   *   - `"all"`：不裁剪（A/B 对照与回归基线用）。
   */
  columnProjection?: ResearchColumnProjection | "all";
}

export interface AssembledSampleSet {
  samples: ResearchSample[];
  /** 落入样本集的事件数。 */
  eventCount: number;
  /** 实际读取批次数（性能证据）。 */
  chunkCount: number;
  /** 真正加载的变量清单。 */
  features: string[];
  outcomes: string[];
  /** 本次装配实际使用的列投影（性能证据；可用于核对是否发生了裁剪）。 */
  columnProjection: ResearchColumnProjection;
  /** 装配耗时（毫秒）。 */
  buildMs: number;
}

/** 一批事件连同它的窗口数据。 */
interface PreparedChunk {
  items: FirstLimitPullbackEvent[];
  prefixBars: FirstLimitPullbackRawBar[];
  pathRows: FirstLimitPullbackPath[];
  outcomeRows: FirstLimitPullbackOutcome[];
}

/** 按 key 建索引。 */
function indexByEventId<T extends { eventId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.eventId);
    if (list === undefined) map.set(row.eventId, [row]);
    else list.push(row);
  }
  return map;
}

/** 构造「越界读取即抛错」的行守卫；`enabled` 为假时是零成本直通。 */
function makeRowGuard(
  enabled: boolean,
  projection: ResearchColumnProjection,
): <T extends object>(row: T, role: ProjectionRole) => T {
  if (!enabled) return identityGuard;
  return (row, role) => guardProjectedRow(row, role, projection[role]);
}

/** 零成本直通行守卫（守卫关闭时使用，避免每批新建闭包）。 */
function identityGuard<T extends object>(row: T): T {
  return row;
}

/**
 * 装配样本集。
 *
 * `requirement` 中的变量名若未登记 → `UNKNOWN_VARIABLE`；
 * 若角色用反（结果当特征） → `VARIABLE_ROLE_VIOLATION`（**PIT 防线的运行期兜底**）。
 */
export async function buildSampleSet(options: BuildSampleSetOptions): Promise<AssembledSampleSet> {
  const startedAt = Date.now();
  const {
    reader,
    datasetVersionId,
    catalog,
    requirement,
    dimensionKeys = [],
    regimeProvider,
    dateRange,
    eventPageSize = DEFAULT_EVENT_PAGE_SIZE,
    maxSamples = DEFAULT_MAX_SAMPLES,
    pageConcurrency = resolveAssemblyConcurrency(),
    projectionGuard = resolveGuardMode(),
  } = options;

  const featureDefs = requirement.features.map((name) => catalog.resolveFeature(name));
  const outcomeDefs = requirement.outcomes.map((name) => catalog.resolveOutcome(name));

  const prefixDays = new Set<number>();
  for (const def of featureDefs) for (const d of def.prefixRelativeDays ?? []) prefixDays.add(d);
  const pathDays = new Set<number>();
  const outcomeHorizons = new Set<number>();
  for (const def of outcomeDefs) {
    for (const d of def.pathRelativeDays ?? []) pathDays.add(d);
    for (const h of def.outcomeHorizons ?? []) outcomeHorizons.add(h);
  }
  // 结果变量若以**事件日 K 线**为比较基准（声明了 `needsEventBar`），必须把相对日 0
  // 一并并入 prefix 装载范围 —— 否则 `OutcomeSources.eventBar` 恒为 undefined，
  // 这类变量会静默全 null（既不报错也不告警，正是最难发现的那种失败）。
  if (outcomeDefs.some((def) => def.needsEventBar === true)) prefixDays.add(0);

  // ---- 列投影：从变量定义自动派生（读取即声明），再下推到读取层 ----
  const projection: ResearchColumnProjection = options.columnProjection === "all"
    ? fullColumnProjection()
    : (options.columnProjection ?? deriveColumnProjection({
        featureDefs,
        outcomeDefs,
        dimensionKeys,
        prefixDays: [...prefixDays],
        pathDays: [...pathDays],
        outcomeHorizons: [...outcomeHorizons],
      }));

  const guardAll = projectionGuard === "all";
  const guardFirstChunk = projectionGuard === "first-chunk";
  const guardRow = makeRowGuard(guardAll, projection);
  const samples: ResearchSample[] = [];
  let eventCount = 0;
  let chunkCount = 0;

  // ---- 有界流水线：`pending` 里是「已发出、数据还在路上」的批次 ----
  const depth = Math.max(1, Math.floor(pageConcurrency));
  const pending: Array<Promise<PreparedChunk>> = [];
  let cursor: string | null = null;
  let exhausted = false;

  /** 把流水线填满到 depth（或数据取尽）。事件分页链严格串行，但数据加载与之重叠。 */
  const produce = async (): Promise<void> => {
    while (!exhausted && pending.length < depth) {
      const page = await reader.loadEventPage({
        datasetVersionId,
        ...(dateRange?.startDate !== undefined ? { fromDate: dateRange.startDate } : {}),
        ...(dateRange?.endDate !== undefined ? { toDate: dateRange.endDate } : {}),
        cursor,
        limit: eventPageSize,
        columns: projection.event,
      });
      if (page.items.length === 0) {
        exhausted = true;
        return;
      }
      cursor = page.nextCursor;
      if (!cursor) exhausted = true;

      const eventIds = page.items.map((e) => e.eventId);
      const items = page.items;
      // 不 await：让这一批的窗口数据与下一批的事件分页同时在飞（流水线的全部意义所在）。
      pending.push((async (): Promise<PreparedChunk> => {
        const [prefixBars, pathRows, outcomeRows] = await Promise.all([
          prefixDays.size > 0
            ? reader.loadPrefixBars({ datasetVersionId, eventIds, relativeDays: [...prefixDays], columns: projection.prefix })
            : Promise.resolve([] as FirstLimitPullbackRawBar[]),
          pathDays.size > 0
            ? reader.loadPaths({ datasetVersionId, eventIds, relativeDays: [...pathDays], columns: projection.path })
            : Promise.resolve([] as FirstLimitPullbackPath[]),
          outcomeHorizons.size > 0
            ? reader.loadOutcomes({ datasetVersionId, eventIds, horizons: [...outcomeHorizons], columns: projection.outcome })
            : Promise.resolve([] as FirstLimitPullbackOutcome[]),
        ]);
        return { items, prefixBars, pathRows, outcomeRows };
      })());
    }
  };

  try {
    for (;;) {
      await produce();
      const nextChunk = pending.shift();
      if (nextChunk === undefined) break;

      const { items, prefixBars, pathRows, outcomeRows } = await nextChunk;
      chunkCount += 1;

      // 守卫只在首批打开（默认）：真实数据 + 几乎零成本，用于捕获「只在特定取值下才读某列」的分支。
      const guard = guardAll || (guardFirstChunk && chunkCount === 1) ? guardRow : identityGuard;

      const prefixByEvent = indexByEventId(prefixBars);
      const pathByEvent = indexByEventId(pathRows);
      const outcomeByEvent = indexByEventId(outcomeRows);

      for (const event of items) {
        const prefixMap = new Map<number, FirstLimitPullbackRawBar>();
        for (const bar of prefixByEvent.get(event.eventId) ?? []) prefixMap.set(bar.relativeDay, guard(bar, "prefix"));
        const pathMap = new Map<number, FirstLimitPullbackPath>();
        for (const row of pathByEvent.get(event.eventId) ?? []) pathMap.set(row.relativeDay, guard(row, "path"));
        const outcomeMap = new Map<number, FirstLimitPullbackOutcome>();
        for (const row of outcomeByEvent.get(event.eventId) ?? []) outcomeMap.set(row.horizon, guard(row, "outcome"));

        const featureSources = { event: guard(event, "event"), prefixBars: prefixMap };
        // `eventBar` = 事件日当天那根 K 线（prefix rd=0）。缺该行时为 undefined，
        // 依赖它的结果变量会如实返回 null（不臆造基准线）。是否需要它由变量定义
        // 的 `needsEventBar` 决定，上面已据此把 rd=0 并入 prefixDays。
        const outcomeSources = { pathRows: pathMap, outcomeRows: outcomeMap, eventBar: prefixMap.get(0) };

        const features: Record<string, number | null> = {};
        for (const def of featureDefs) {
          const value = def.resolve(featureSources);
          features[def.name] = typeof value === "number" && Number.isFinite(value) ? value : null;
        }

        const outcomes: Record<string, number | null> = {};
        for (const def of outcomeDefs) {
          const value = def.resolve(outcomeSources);
          outcomes[def.name] = typeof value === "number" && Number.isFinite(value) ? value : null;
        }

        const dimensions: Record<string, string | number | null> = {};
        for (const key of dimensionKeys) {
          dimensions[key] = resolveDimensionValue(
            key,
            featureSources,
            regimeProvider,
          );
        }

        samples.push({ eventId: event.eventId, symbol: event.symbol, tradeDate: event.tradeDate, features, outcomes, dimensions });
        eventCount += 1;
      }

      engineAssert(
        samples.length <= maxSamples,
        "DATASET_TOO_LARGE",
        `样本数超过上限 ${maxSamples}（已装配 ${samples.length}）。请缩小日期范围或提高 maxSamples；本阶段不把全量 Dataset 载入内存。`,
        { maxSamples, assembled: samples.length, datasetVersionId },
      );
    }
  } catch (error) {
    // 快速失败：先把在飞批次收敛（不留下未处理的 rejection），再把首个错误原样抛出。
    await Promise.allSettled(pending);
    throw error;
  }

  return {
    samples,
    eventCount,
    chunkCount,
    features: requirement.features.slice(),
    outcomes: requirement.outcomes.slice(),
    columnProjection: projection,
    buildMs: Date.now() - startedAt,
  };
}
