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

/** 组合执行面（shared 契约里以 `unknown` 声明；实验经 compositeRunnerBridge 收窄）。 */
export interface CompositeExecutionSurfacePayload {
  readonly baselineDatasetVersionId: number;
  readonly extensionDatasetVersionId: number;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly baselineDataset: ResearchDataset;
  readonly executionDataset: ResearchDataset;
  readonly selectedEventCount: number;
}

export interface CompositeDatasetBuildRequest {
  readonly baselineDatasetVersionId: number;
  readonly extensionDatasetVersionId: number;
  readonly evaluationWindow: ExperimentEvaluationWindow | null;
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
 * 真实 provider：读基线投影（缓存工件）+ 扩展版本 rd17..80（Registry 只读）。
 */
export function createDefaultCompositeDatasetProvider(): ExperimentCompositeDatasetProvider {
  return {
    async build(request) {
      const baseline = await loadCompositeBaselineProjection();
      // 选股只为确定「哪些事件需要扩展行」；使用与实验完全相同的共享实现。
      const built = buildCompositeEvents(baseline, COMPOSITE_RUNNER_MAX_AMPLITUDE);
      const arm = buildCompositeSourceRun({
        armId: "bridge_selection",
        label: "1.62.1 bridge selection",
        kind: "bucket_t5",
        dataset: baseline,
        tradingDays: built.tradingDays,
        bucketCandidatesByDate: built.bucketCandidatesByDate,
        rankCandidatesByTe: built.rankCandidatesByTe,
        topN: COMPOSITE_RUNNER_TOP_N,
        maxAmplitude: COMPOSITE_RUNNER_MAX_AMPLITUDE,
        dateRange: {
          startDate: baseline.dataSnapshot.request.startDate,
          endDate: baseline.dataSnapshot.request.endDate,
        },
      });
      const selectedEvents: CompositeSelectedEvent[] = [...arm.selectedSecurityIds].map((securityId) => ({
        securityId, eventId: eventIdOf(securityId), symbol: securityId,
      }));
      const extensionBars = await loadExtensionBars(request.extensionDatasetVersionId, selectedEvents.map((e) => e.eventId));
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
      };
    },
  };
}


