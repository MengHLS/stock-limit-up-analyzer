/**
 * COMPOSITE-RUNNER-DATASET-PROVIDER-001 —— 平台侧组合执行数据集 provider。
 *
 * 唯一职责：**数据装配**。按 Run 坐标把「基线数据集（660001）官方投影 + 选中事件的
 * 扩展数据集（750001）rd17..80」装配成与 `PROMOTE-001` 同形的两个 `ResearchDataset`，
 * 交给声明了 `executionSurface: "COMPOSITE_PORTFOLIO"` 的实验（经 `context.composite`）。
 *
 * 纪律：
 *   - **不实现任何回测 / 研究逻辑**（选股只用于确定「哪些事件需要扩展行」，调用共享模块）；
 *   - 不新增第二套读取实现：扩展行走既有 `DbDatasetDataReader`；
 *   - 基线投影与 PROMOTE-001 / HORIZON-001 使用**同一工件**（3f-top3 基线投影缓存），
 *     这是逐字段 parity 的前提。
 */
import { DbDatasetDataReader } from "../datasetRegistry/query";
import { loadCompositeBaselineProjection } from "../research/compositeRunner/baselineProjection";
import {
  buildCompositeEvents,
  buildCompositeSourceRun,
  buildCompositeExecutionDataset,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
  COMPOSITE_RUNNER_TOP_N,
} from "../research/compositeRunner/index";
import type { ResearchDataset, CompositeExtensionBar, CompositeSelectedEvent } from "../research/compositeRunner/index";
import type { ExperimentEvaluationWindow } from "@shared/researchExperimentsContracts";
import { loadListedDatesBySecurityIds } from "../security/repository";

/** 组合执行面（shared 契约里以 `unknown` 声明；实验经 compositeRunnerBridge 收窄）。 */
export interface CompositeEventMetadata {
  readonly eventId: string;
  readonly tradeDate: string;
  readonly symbol: string;
  readonly boardType: string | null;
  readonly turnover: number | null;
  readonly limitUpTime: string | null;
  readonly sector: string | null;
  readonly keywords: string | null;
  readonly historicalLimitCount: number | null;
  readonly daysSincePreviousLimit: number | null;
  readonly isFirstLimit: boolean | null;
  readonly previousLimitDate: string | null;
  readonly marketCap: number | null;
  readonly floatMarketCap: number | null;
}

export interface CompositeExecutionSurfacePayload {
  readonly baselineDatasetVersionId: number;
  readonly extensionDatasetVersionId: number;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly baselineDataset: ResearchDataset;
  readonly executionDataset: ResearchDataset;
  readonly selectedEventCount: number;
  /** 仅 descriptor.includeEventMetadata=true 时非空。 */
  readonly eventMetadata: readonly CompositeEventMetadata[];
  /**
   * P10：base securityId（已剥离 `::event:` 后缀）→ listedDate（YYYY-MM-DD）。
   * 仅当某臂声明 excludeListedWithinDays 或 request.includeListingDates=true 时非空。
   */
  readonly listingDateBySecurityId: ReadonlyMap<string, string>;
}

export interface CompositeExtensionSelectionArm {
  readonly id: string;
  /** null = 该臂使用既有纯 3F 排序（不融合趋势评分）。 */
  readonly trendWeight: number | null;
  /** P0-2：趋势分门槛（只筛不改排序）；缺省 / null = 无门槛。 */
  readonly minTrendScore?: number | null;
  /** P1：趋势评分 v2（符号修正版）分位融合权重；缺省 / null = 不融合。 */
  readonly v2Weight?: number | null;
  /** P4：该臂的选股广度（每日取前 N 名）；缺省 = 3。 */
  readonly topN?: number;
  /** P10：该臂在排序前剔除上市龄 < N 个自然日的候选；缺省 / null = 不过滤。 */
  readonly excludeListedWithinDays?: number | null;
}

export interface CompositeDatasetBuildRequest {
  readonly baselineDatasetVersionId: number;
  readonly extensionDatasetVersionId: number;
  readonly evaluationWindow: ExperimentEvaluationWindow | null;
  /**
   * P0 趋势融合：需要装载扩展行（rd17..80）的**臂集合**。
   *
   * 缺省 = 单个控制臂（纯 3F 排序）⇒ 与既有 provider 行为**逐字一致**。
   * 声明多臂时按**并集**装载：融合臂选中而控制臂未选中的事件同样拿到 rd17..80，
   * 否则融合臂会在 rd16 被数据边界截断，比较失真。
   */
  readonly extensionSelectionArms?: readonly CompositeExtensionSelectionArm[];
  /** 是否读取 selected events 的事件事实。缺省 false = 既有行为逐字不变。 */
  readonly includeEventMetadata?: boolean;
  /** 是否装载候选池的上市日（Security Master）。缺省 false = 既有行为逐字不变。 */
  readonly includeListingDates?: boolean;
}

export interface ExperimentCompositeDatasetProvider {
  build(request: CompositeDatasetBuildRequest): Promise<CompositeExecutionSurfacePayload>;
}

function eventIdOf(securityId: string): string {
  const marker = "::event:";
  const index = securityId.indexOf(marker);
  return index < 0 ? securityId : securityId.slice(index + marker.length);
}
async function mapLimit<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  async function worker() { for (;;) { const j = i++; if (j >= xs.length) return; out[j] = await fn(xs[j]!); } }
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, worker));
  return out;
}

async function loadEventMetadata(
  datasetVersionId: number,
  eventIds: readonly string[],
): Promise<CompositeEventMetadata[]> {
  const ids = [...new Set(eventIds)].sort();
  if (ids.length === 0) return [];
  const reader = new DbDatasetDataReader();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 1000) chunks.push(ids.slice(i, i + 1000));
  const rows = (await mapLimit(chunks, 8, (chunk) => reader.loadEventsBatch({
    datasetVersionId,
    eventIds: chunk,
    columns: [
      "eventId", "tradeDate", "symbol", "boardType", "turnover", "limitUpTime",
      "sector", "keywords", "historicalLimitCount", "daysSincePreviousLimit",
      "isFirstLimit", "previousLimitDate", "marketCap", "floatMarketCap",
    ],
  }))).flat();
  return rows.map((row) => ({
    eventId: row.eventId,
    tradeDate: row.tradeDate,
    symbol: row.symbol,
    boardType: row.boardType,
    turnover: row.turnover,
    limitUpTime: row.limitUpTime,
    sector: row.sector,
    keywords: row.keywords,
    historicalLimitCount: row.historicalLimitCount,
    daysSincePreviousLimit: row.daysSincePreviousLimit,
    isFirstLimit: row.isFirstLimit,
    previousLimitDate: row.previousLimitDate,
    marketCap: row.marketCap,
    floatMarketCap: row.floatMarketCap,
  })).sort((a, b) => a.eventId.localeCompare(b.eventId));
}

async function loadExtensionBars(datasetVersionId: number, eventIds: readonly string[]): Promise<Map<string, CompositeExtensionBar[]>> {
  const ids = [...new Set(eventIds)].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 1000) chunks.push(ids.slice(i, i + 1000));
  const reader = new DbDatasetDataReader();
  const [pre, post] = await Promise.all([
    mapLimit(chunks, 8, (c) => reader.loadRawBarsBatch("prefix", { datasetVersionId, eventIds: c, relativeDays: [0] })),
    mapLimit(chunks, 8, (c) => reader.loadRawBarsBatch("post", { datasetVersionId, eventIds: c, relativeDays: Array.from({ length: 80 }, (_, i) => i + 1) })),
  ]);
  const by = new Map<string, CompositeExtensionBar[]>();
  for (const bar of [...pre.flat(), ...post.flat()]) {
    const list = by.get(bar.eventId) ?? [];
    list.push(bar as unknown as CompositeExtensionBar);
    by.set(bar.eventId, list);
  }
  for (const list of by.values()) list.sort((a, b) => a.relativeDay - b.relativeDay);
  return by;
}

/**
 * provider 的可注入依赖。
 *
 * 🔴 默认值 = 真实实现（读缓存工件 + 走 Registry 只读）；只有测试会注入内存桩，
 * 生产装配不得传参 —— 「谁提供数据」这件事必须仍然只有一处。
 */
/**
 * P10：为「候选池上市龄过滤」装载 Security Master 上市日（只读）。
 * 入参为 `::event:` 后缀已被剥离的 base securityId。
 */
async function loadListingDates(securityIds: readonly string[]): Promise<Map<string, string>> {
  return loadListedDatesBySecurityIds(securityIds);
}

export interface CompositeDatasetProviderDeps {
  readonly loadBaseline?: () => Promise<ResearchDataset>;
  readonly loadExtensionBars?: typeof loadExtensionBars;
  readonly loadEventMetadata?: typeof loadEventMetadata;
  readonly loadListingDates?: typeof loadListingDates;
}

/**
 * 真实 provider：读基线投影（缓存工件）+ 扩展版本 rd17..80（Registry 只读）。
 */
export function createDefaultCompositeDatasetProvider(
  deps: CompositeDatasetProviderDeps = {},
): ExperimentCompositeDatasetProvider {
  const loadBaseline = deps.loadBaseline ?? loadCompositeBaselineProjection;
  const loadExtensionRows = deps.loadExtensionBars ?? loadExtensionBars;
  const loadSelectedEventMetadata = deps.loadEventMetadata ?? loadEventMetadata;
  const loadListingDatesFn = deps.loadListingDates ?? loadListingDates;
  return {
    async build(request) {
      const baseline = await loadBaseline();
      // 选股只为确定「哪些事件需要扩展行」；使用与实验完全相同的共享实现。
      const built = buildCompositeEvents(baseline, COMPOSITE_RUNNER_MAX_AMPLITUDE);
      const selectionArms: readonly CompositeExtensionSelectionArm[] =
        request.extensionSelectionArms ?? [{ id: "bridge_selection", trendWeight: null }];
      const needsListingDates = selectionArms.some(
        (arm) => arm.excludeListedWithinDays !== undefined && arm.excludeListedWithinDays !== null,
      );
      const candidateSecurityIds = new Set<string>();
      for (const list of built.bucketCandidatesByDate.values()) {
        for (const candidate of list) candidateSecurityIds.add(candidate.event.securityId);
      }
      const listingDateBySecurityId = needsListingDates || request.includeListingDates === true
        ? await loadListingDatesFn([...candidateSecurityIds].map((id) => id.split("::event:")[0]!))
        : new Map<string, string>();
      const listingDateOf = (securityId: string): string | null =>
        listingDateBySecurityId.get(securityId.split("::event:")[0]!) ?? null;
      const dateRange = {
        startDate: baseline.dataSnapshot.request.startDate,
        endDate: baseline.dataSnapshot.request.endDate,
      };
      // 并集（不是交集）：任何一支臂选中的事件都必须拿到 rd17..80。
      const selectedSecurityIdSet = new Set<string>();
      for (const selectionArm of selectionArms) {
        // 三档旋钮互斥：v1 排序融合 / v2 排序融合 / 门槛 —— 同时给两个说明调用方写错了坐标。
        const activeKnobs = [
          selectionArm.trendWeight !== null,
          selectionArm.minTrendScore !== undefined && selectionArm.minTrendScore !== null,
          selectionArm.v2Weight !== undefined && selectionArm.v2Weight !== null,
        ].filter(Boolean).length;
        if (activeKnobs > 1) {
          throw new Error(
            "compositeDatasetProvider：臂 " + selectionArm.id + " 同时声明了多个趋势用法"
              + "（trendWeight / minTrendScore / v2Weight 只能选一个）。",
          );
        }
        const arm = buildCompositeSourceRun({
          armId: selectionArm.id,
          label: selectionArm.v2Weight !== undefined && selectionArm.v2Weight !== null
            ? ("1.62.1 bridge selection + trend v2 fusion w=" + String(selectionArm.v2Weight))
            : (selectionArm.trendWeight === null
              ? "1.62.1 bridge selection"
              : ("1.62.1 bridge selection + trend fusion w=" + String(selectionArm.trendWeight))),
          kind: "bucket_t5",
          dataset: baseline,
          tradingDays: built.tradingDays,
          bucketCandidatesByDate: built.bucketCandidatesByDate,
          rankCandidatesByTe: built.rankCandidatesByTe,
          topN: selectionArm.topN ?? COMPOSITE_RUNNER_TOP_N,
          maxAmplitude: COMPOSITE_RUNNER_MAX_AMPLITUDE,
          dateRange,
          rankFusion: selectionArm.trendWeight === null
            ? null
            : { trendWeight: selectionArm.trendWeight },
          candidateGate: selectionArm.minTrendScore === undefined || selectionArm.minTrendScore === null
            ? null
            : { minTrendScore: selectionArm.minTrendScore },
          candidateScoreV2: selectionArm.v2Weight === undefined || selectionArm.v2Weight === null
            ? null
            : { v2Weight: selectionArm.v2Weight },
          candidateListingFilter: selectionArm.excludeListedWithinDays === undefined || selectionArm.excludeListedWithinDays === null
            ? null
            : { minListingAgeDays: selectionArm.excludeListedWithinDays, listingDateOf },
        });
        for (const securityId of arm.selectedSecurityIds) selectedSecurityIdSet.add(securityId);
      }
      const selectedEvents: CompositeSelectedEvent[] = [...selectedSecurityIdSet].map((securityId) => ({
        securityId, eventId: eventIdOf(securityId), symbol: securityId,
      }));
      const selectedEventIds = selectedEvents.map((event) => event.eventId);
      const eventMetadata = request.includeEventMetadata === true
        ? await loadSelectedEventMetadata(request.extensionDatasetVersionId, selectedEventIds)
        : [];
      const extensionBars = await loadExtensionRows(
        request.extensionDatasetVersionId,
        selectedEventIds,
      );
      const executionDataset = buildCompositeExecutionDataset({
        base: baseline,
        selectedEvents,
        extensionBarsByEvent: extensionBars,
        extensionRelativeDayRange: { min: 17, max: 80 },
      });
      return {
        baselineDatasetVersionId: request.baselineDatasetVersionId,
        extensionDatasetVersionId: request.extensionDatasetVersionId,
        dateRange: {
          startDate: baseline.dataSnapshot.request.startDate,
          endDate: baseline.dataSnapshot.request.endDate,
        },
        baselineDataset: baseline,
        executionDataset,
        selectedEventCount: selectedEvents.length,
        eventMetadata,
        listingDateBySecurityId,
      };
    },
  };
}


