/**
 * COMPOSITE-RUNNER-BRIDGE-001 —— 组合层执行能力下沉（**唯一**实现）。
 *
 * 背景：`NEW_HIGH_3 Runner / hold=20` 的正式 HOLDOUT 需要在「完整 simulator / 资金循环」
 * 语义上重放 1.62.1 组合回测。该语义此前只存在于 `scripts/`：
 *   - 选股 `buildEvents` / `buildSourceRun` → `scripts/runDynamic3FEntryMechanism001.mts`
 *   - 执行投影 `extendDataset` / `rebuildRun` → `scripts/runRunnerHoldingNewHigh3*.mts`
 * 本模块把这两段**逐字**下沉为 server 侧纯函数/注入式数据访问，供脚本与 Experiment 共用。
 * 组合回测本身**不新增引擎** —— 唯一入口是既有 `runTradeSimulation`。
 *
 * 纪律：
 *   - 纯函数 + 注入式数据访问（不读文件、不连 DB、不依赖 cwd）；
 *   - 语义与脚本逐字一致（保证 PROMOTE-001 不漂移）；
 *   - 不新增第二套回测引擎。
 */
import { assembleRunWorkbenchInputs } from "../../runWorkbenchAssembly/assemble";
import { runTradeSimulation } from "../simulator/engine";
import { evaluateCandidateRun } from "../signalEngine/evaluate";
import { computeCandidateEvaluationRunFingerprint } from "../signalEngine/serialize";
import { rankSignals } from "../framework/ranking";
import { computeThreeFactorRaw, threeFactorCompositeScoreOf } from "../recipeFeatures/threeFactorScoreFeatures";
import { computeDatasetVersionStreaming } from "../../researchDataset/version";
import { derivePolicySet } from "../../researchDataset/policy";
import { deriveDatasetUniverseId } from "../datasetAccess/handle";
import type { CanonicalMarketBar } from "../../data";
import type { ResearchDataset, ResearchDatasetRow } from "../../researchDataset/types";
import type { CandidateDayRecord, CandidateEvaluationRun } from "../signalEngine/types";
import type { PositionIntent, SelectedCandidate } from "../framework/contract";
import type { SimulationConfig, TradeSimulationRun } from "../simulator/types";
import type { StrategyDocument } from "../strategySchema/types";
import type { RunnerHoldingBridgePolicyDefinition } from "../exitPolicyCommon";

export type { ResearchDataset, ResearchDatasetRow } from "../../researchDataset/types";

// ---------------------------------------------------------------------------
// 1.62.1 选股（逐字迁移自 scripts/runDynamic3FEntryMechanism001.mts）
// ---------------------------------------------------------------------------

export const COMPOSITE_RUNNER_TOP_N = 3;
export const COMPOSITE_RUNNER_MAX_AMPLITUDE = 0.14;
const TE_VALUES = [1, 2, 3, 4, 5] as const;
export type Te = (typeof TE_VALUES)[number];

export interface DynamicFactors {
  maxAmplitude_Te: number;
  meanAmplitude_Te: number;
  t1VolumeRatio: number;
}
export interface CompositeEventRecord {
  securityId: string;
  eventDate: string;
  eventBar: ResearchDatasetRow;
  barsByRelativeDay: Map<number, ResearchDatasetRow>;
  pullbackByTe: Map<Te, boolean>;
  factorsByTe: Map<Te, DynamicFactors>;
  signalDateByTe: Map<Te, string>;
}
export interface RankCandidate {
  event: CompositeEventRecord;
  te: Te;
  signalDate: string;
  factors: DynamicFactors;
  score: number;
}
export interface BucketCandidate {
  event: CompositeEventRecord;
  signalDate: string;
  score: number;
}
export type CompositeArmKind = "bucket_t5" | "rank_fixed_t5" | "rank_te_only" | "rank_dynamic_first";
export interface BuiltCompositeArm {
  id: string;
  label: string;
  kind: CompositeArmKind;
  sourceRun: CandidateEvaluationRun;
  selectedSecurityIds: Set<string>;
  signalTeBySecurity: Map<string, Te>;
  selectedCountByTe: Record<string, number>;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function parseEventDate(securityId: string): string {
  const marker = "::event:";
  const index = securityId.indexOf(marker);
  if (index < 0) return "";
  const raw = securityId.slice(index + marker.length);
  const at = raw.lastIndexOf("@");
  return at < 0 ? "" : raw.slice(at + 1);
}
function toBar(row: ResearchDatasetRow): CanonicalMarketBar {
  return {
    symbol: row.code ?? row.securityId,
    timestamp: row.tradeDate,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    preClose: row.preClose,
    volume: row.volume,
    amount: row.amount,
    turnoverRate: row.turnoverRate,
    adjustment: "raw",
  };
}
function validOhlcv(row: ResearchDatasetRow | undefined): row is ResearchDatasetRow {
  return row !== undefined
    && row.eligible !== false
    && finite(row.open) && row.open > 0
    && finite(row.high) && row.high > 0
    && finite(row.low) && row.low > 0
    && finite(row.close) && row.close > 0
    && finite(row.volume) && row.volume > 0
    && row.high >= row.low;
}
function dynamicFactorsOf(
  eventBar: ResearchDatasetRow,
  barsByRelativeDay: Map<number, ResearchDatasetRow>,
  te: Te,
): { factors: DynamicFactors | null; pullback: boolean } {
  if (!validOhlcv(eventBar)) return { factors: null, pullback: false };
  const t1 = barsByRelativeDay.get(1);
  if (!validOhlcv(t1)) return { factors: null, pullback: false };
  const t1VolumeRatio = t1.volume! / eventBar.volume!;
  let runningPreClose = eventBar.close!;
  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  let pullback = false;
  for (let day = 1; day <= te; day += 1) {
    const bar = barsByRelativeDay.get(day);
    if (!validOhlcv(bar)) return { factors: null, pullback };
    const amplitude = (bar.high! - bar.low!) / runningPreClose;
    if (!finite(amplitude) || amplitude < 0) return { factors: null, pullback };
    sum += amplitude;
    max = Math.max(max, amplitude);
    if (bar.close! < eventBar.close! - 1e-9) pullback = true;
    runningPreClose = bar.close!;
  }
  return { factors: { maxAmplitude_Te: max, meanAmplitude_Te: sum / te, t1VolumeRatio }, pullback };
}

export function buildCompositeEvents(dataset: ResearchDataset, maxAmplitude: number): {
  events: CompositeEventRecord[];
  tradingDays: string[];
  bucketCandidatesByDate: Map<string, BucketCandidate[]>;
  rankCandidatesByTe: Map<Te, Map<string, RankCandidate[]>>;
  accounting: Record<string, number>;
} {
  const tradingDays = dataset.universeDefinition.days.filter((day) => day.isTradingDay).map((day) => day.tradeDate);
  const dayIndex = new Map(tradingDays.map((date, index) => [date, index]));
  const rowsBySecurity = new Map<string, ResearchDatasetRow[]>();
  for (const row of dataset.rows) {
    const bucket = rowsBySecurity.get(row.securityId) ?? [];
    bucket.push(row);
    rowsBySecurity.set(row.securityId, bucket);
  }
  const bucketCandidatesByDate = new Map<string, BucketCandidate[]>();
  const rankCandidatesByTe = new Map<Te, Map<string, RankCandidate[]>>();
  for (const te of TE_VALUES) rankCandidatesByTe.set(te, new Map());
  const accounting: Record<string, number> = {
    rawEvents: rowsBySecurity.size, invalidEventDate: 0, invalidEventBar: 0,
    oneWordOrTEvent: 0, bucketComplete: 0, bucketPullback: 0, bucketPassed: 0, rankCandidateCounts: 0,
  };
  const events: CompositeEventRecord[] = [];
  for (const [securityId, rows] of rowsBySecurity) {
    const eventDate = parseEventDate(securityId);
    const eventIndex = dayIndex.get(eventDate);
    if (eventIndex === undefined) { accounting.invalidEventDate += 1; continue; }
    const barsByRelativeDay = new Map<number, ResearchDatasetRow>();
    for (const row of rows) {
      const rowIndex = dayIndex.get(row.tradeDate);
      if (rowIndex === undefined) continue;
      const relativeDay = rowIndex - eventIndex;
      if (relativeDay >= 0 && relativeDay <= 16) barsByRelativeDay.set(relativeDay, row);
    }
    const eventBar = barsByRelativeDay.get(0);
    if (!validOhlcv(eventBar)) { accounting.invalidEventBar += 1; continue; }
    const oneWordOrT = !(eventBar.open! < eventBar.high! - 1e-9);
    if (oneWordOrT) { accounting.oneWordOrTEvent += 1; continue; }
    const pullbackByTe = new Map<Te, boolean>();
    const factorsByTe = new Map<Te, DynamicFactors>();
    const signalDateByTe = new Map<Te, string>();
    for (const te of TE_VALUES) {
      const result = dynamicFactorsOf(eventBar, barsByRelativeDay, te);
      pullbackByTe.set(te, result.pullback);
      if (result.factors !== null) factorsByTe.set(te, result.factors);
      const signalRow = barsByRelativeDay.get(te);
      if (validOhlcv(signalRow)) signalDateByTe.set(te, signalRow.tradeDate);
      if (result.factors !== null && result.pullback && result.factors.maxAmplitude_Te < maxAmplitude && validOhlcv(signalRow)) {
        const rankedCandidate: RankCandidate = {
          event: { securityId, eventDate, eventBar, barsByRelativeDay, pullbackByTe, factorsByTe, signalDateByTe },
          te, signalDate: signalRow.tradeDate, factors: result.factors, score: Number.NaN,
        };
        const dateMap = rankCandidatesByTe.get(te)!;
        const list = dateMap.get(signalRow.tradeDate) ?? [];
        list.push(rankedCandidate);
        dateMap.set(signalRow.tradeDate, list);
        accounting.rankCandidateCounts += 1;
      }
    }
    const eventRecord: CompositeEventRecord = { securityId, eventDate, eventBar, barsByRelativeDay, pullbackByTe, factorsByTe, signalDateByTe };
    events.push(eventRecord);
    const bars: CanonicalMarketBar[] = [];
    let complete = true;
    for (let relativeDay = 0; relativeDay <= 5; relativeDay += 1) {
      const row = barsByRelativeDay.get(relativeDay);
      if (!validOhlcv(row)) { complete = false; break; }
      bars.push(toBar(row));
    }
    if (!complete) continue;
    accounting.bucketComplete += 1;
    const raw = computeThreeFactorRaw(bars);
    if (raw === null || !raw.hasPullbackInObservationWindow) continue;
    accounting.bucketPullback += 1;
    if (!(raw.maxAmplitude < maxAmplitude)) continue;
    accounting.bucketPassed += 1;
    const score = threeFactorCompositeScoreOf(raw, { requirePullback: true });
    if (score === null) continue;
    const signalDate = bars[5]!.timestamp;
    const list = bucketCandidatesByDate.get(signalDate) ?? [];
    list.push({ event: eventRecord, signalDate, score });
    bucketCandidatesByDate.set(signalDate, list);
  }
  return { events, tradingDays, bucketCandidatesByDate, rankCandidatesByTe, accounting };
}

function scoreRankCandidates(candidates: readonly RankCandidate[]): RankCandidate[] {
  if (candidates.length === 0) return [];
  const rankingConfig = { higherIsBetter: false, tieBreaking: "average" as const, missingPolicy: "exclude" as const };
  const highConfig = { higherIsBetter: true, tieBreaking: "average" as const, missingPolicy: "exclude" as const };
  const maxRanked = rankSignals(candidates.map((c) => ({ securityId: c.event.securityId, value: c.factors.maxAmplitude_Te })), rankingConfig);
  const meanRanked = rankSignals(candidates.map((c) => ({ securityId: c.event.securityId, value: c.factors.meanAmplitude_Te })), rankingConfig);
  const volumeRanked = rankSignals(candidates.map((c) => ({ securityId: c.event.securityId, value: c.factors.t1VolumeRatio })), highConfig);
  const maxById = new Map(maxRanked.map((i) => [i.securityId, i.percentile]));
  const meanById = new Map(meanRanked.map((i) => [i.securityId, i.percentile]));
  const volumeById = new Map(volumeRanked.map((i) => [i.securityId, i.percentile]));
  return candidates.map((candidate) => {
    const maxPercentile = maxById.get(candidate.event.securityId);
    const meanPercentile = meanById.get(candidate.event.securityId);
    const volumePercentile = volumeById.get(candidate.event.securityId);
    if (maxPercentile === null || maxPercentile === undefined || meanPercentile === null || meanPercentile === undefined || volumePercentile === null || volumePercentile === undefined) {
      return { ...candidate, score: Number.NaN };
    }
    return { ...candidate, score: (maxPercentile + meanPercentile + volumePercentile) / 3 };
  }).filter((candidate) => Number.isFinite(candidate.score));
}

export interface BuildCompositeSourceRunInput {
  armId: string;
  label: string;
  kind: CompositeArmKind;
  te?: Te;
  dataset: ResearchDataset;
  tradingDays: readonly string[];
  bucketCandidatesByDate: ReadonlyMap<string, readonly BucketCandidate[]>;
  rankCandidatesByTe: ReadonlyMap<Te, ReadonlyMap<string, readonly RankCandidate[]>>;
  topN: number;
  maxAmplitude: number;
  dateRange: { startDate: string; endDate: string };
  builderVersion?: string;
}

export function buildCompositeSourceRun(input: BuildCompositeSourceRunInput): BuiltCompositeArm {
  const { armId, label, kind, dataset, tradingDays, topN } = input;
  const selectedSecurityIds = new Set<string>();
  const signalTeBySecurity = new Map<string, Te>();
  const selectedCountByTe: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  const consumed = new Set<string>();
  const dayRecords: CandidateDayRecord[] = [];
  for (const date of tradingDays) {
    let rawCandidates: Array<RankCandidate | BucketCandidate> = [];
    if (kind === "bucket_t5") rawCandidates = [...(input.bucketCandidatesByDate.get(date) ?? [])];
    else if (kind === "rank_fixed_t5") rawCandidates = [...(input.rankCandidatesByTe.get(5)?.get(date) ?? [])];
    else if (kind === "rank_te_only") rawCandidates = [...(input.rankCandidatesByTe.get(input.te!)?.get(date) ?? [])];
    else {
      const all: RankCandidate[] = [];
      for (const te of TE_VALUES) {
        for (const candidate of input.rankCandidatesByTe.get(te)?.get(date) ?? []) {
          if (!consumed.has(candidate.event.securityId)) all.push(candidate);
        }
      }
      rawCandidates = all;
    }
    const candidates = kind === "bucket_t5" ? (rawCandidates as BucketCandidate[]) : scoreRankCandidates(rawCandidates as RankCandidate[]);
    const ranked = [...candidates].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.event.securityId.localeCompare(right.event.securityId);
    });
    const selectedCandidates = ranked.slice(0, topN);
    const selected: SelectedCandidate[] = selectedCandidates.map((candidate, index) => {
      const rank = index + 1;
      return { securityId: candidate.event.securityId, rank, percentile: ranked.length === 0 ? 0 : 1 - (rank - 1) / ranked.length, value: candidate.score };
    });
    const intents: PositionIntent[] = selected.map((candidate) => ({
      securityId: candidate.securityId, direction: "long", rank: candidate.rank, percentile: candidate.percentile,
      weight: selected.length === 0 ? 0 : 1 / selected.length, signalValue: candidate.value, confidence: null,
    }));
    for (const candidate of selectedCandidates) {
      const te = ("te" in candidate ? candidate.te : 5) as Te;
      selectedSecurityIds.add(candidate.event.securityId);
      signalTeBySecurity.set(candidate.event.securityId, te);
      selectedCountByTe[String(te)] = (selectedCountByTe[String(te)] ?? 0) + 1;
      if (kind === "rank_dynamic_first") consumed.add(candidate.event.securityId);
    }
    dayRecords.push({
      date, universeMembers: ranked.map((candidate) => candidate.event.securityId).sort(),
      signalCount: ranked.length, dropped: [], selected, positionIntents: intents,
    });
  }
  const builderVersion = input.builderVersion ?? "dynamic-3f-entry-mechanism-001";
  const evaluation = evaluateCandidateRun(dayRecords);
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: "CANDIDATE_EVALUATION_RUN", recordVersion: 1,
    datasetVersion: dataset.datasetVersion, builderVersion, rowSchemaVersion: builderVersion,
    datasetGate: dataset.gate, universeId: builderVersion + ":" + dataset.datasetVersion,
    strategyId: "study-dynamic-3f-entry-" + armId, strategyVersion: "1.0.0",
    parameters: { arm: armId, topN, maxAmplitude: input.maxAmplitude, factorDirections: "maxAmplitude_Te=LOW,meanAmplitude_Te=LOW,t1VolumeRatio=HIGH" },
    dateRange: { startDate: input.dateRange.startDate, endDate: input.dateRange.endDate },
    point: "close", signalDescription: label,
    featureVersions: kind === "bucket_t5"
      ? [{ featureId: "threeFactorCompositeScore", version: "1.0.0" }]
      : [
          { featureId: "maxAmplitude_Te", version: "dynamic-entry-001" },
          { featureId: "meanAmplitude_Te", version: "dynamic-entry-001" },
          { featureId: "t1VolumeRatio", version: "dynamic-entry-001" },
        ],
    rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    selectionConfig: { method: { kind: "topN", n: topN } },
    days: dayRecords, evaluation,
  };
  return {
    id: armId, label, kind,
    sourceRun: { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) },
    selectedSecurityIds, signalTeBySecurity, selectedCountByTe,
  };
}

/** 1.62.1 bucket-score fixed T+5（bridge_selection）——唯一被 Runner 研究使用的臂。 */
export function buildFirstLimitPullback3FTop3SourceRun(input: {
  dataset: ResearchDataset;
  dateRange: { startDate: string; endDate: string };
  topN?: number;
  maxAmplitude?: number;
  armId?: string;
  label?: string;
}): BuiltCompositeArm {
  const maxAmplitude = input.maxAmplitude ?? COMPOSITE_RUNNER_MAX_AMPLITUDE;
  const built = buildCompositeEvents(input.dataset, maxAmplitude);
  return buildCompositeSourceRun({
    armId: input.armId ?? "bridge_selection",
    label: input.label ?? "1.62.1 bridge selection",
    kind: "bucket_t5",
    dataset: input.dataset,
    tradingDays: built.tradingDays,
    bucketCandidatesByDate: built.bucketCandidatesByDate,
    rankCandidatesByTe: built.rankCandidatesByTe,
    topN: input.topN ?? COMPOSITE_RUNNER_TOP_N,
    maxAmplitude,
    dateRange: input.dateRange,
  });
}

// ---------------------------------------------------------------------------
// 执行投影（逐字迁移自 scripts/runRunnerHoldingNewHigh3*.mts）
// ---------------------------------------------------------------------------

export interface CompositeExtensionBar {
  eventId: string;
  relativeDay: number;
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  preClose?: number | null;
  volume: number | null;
  amount: number | null;
  barPresent?: boolean;
  suspensionStatus?: string | null;
}
export interface CompositeSelectedEvent {
  securityId: string;
  eventId: string;
  symbol: string;
}

function rowFromExtension(sourceId: string, code: string, b: CompositeExtensionBar): ResearchDatasetRow {
  return {
    tradeDate: b.tradeDate, asOf: b.tradeDate, securityId: sourceId, code, securityType: "STOCK",
    exchange: code.includes(".") ? code.slice(code.lastIndexOf(".") + 1) : "UNKNOWN",
    lifecycleVerdict: "LISTED", eligible: b.barPresent !== false && b.suspensionStatus !== "SUSPENDED",
    exclusionReason: null, st: "UNKNOWN", industryCode: null, industryName: null, turnoverRate: null,
    circulationMarketCap: null, totalMarketCap: null, liquidityAmount: null, liquidityVolume: null,
    open: b.open, high: b.high, low: b.low, close: b.close, preClose: b.preClose ?? null,
    volume: b.volume, amount: b.amount, corporateActionsEffectiveCount: 0, corporateActionsKnownCount: 0,
    indexClose: {},
    knowledge: { policy: "PIT", listing: "KNOWN", delisting: "UNKNOWN", tradability: "KNOWN", industry: "UNKNOWN", liquidity: "UNKNOWN", price: "KNOWN", corporateActions: "UNKNOWN", marketState: "UNKNOWN" },
  };
}

/**
 * 执行投影：base(v5) 官方行 + 选中事件 extension(v7) rd[fromDay..toDay]。
 * 与 `scripts/runRunnerHoldingNewHigh3*.mts#extendDataset` 逐字一致（含 request name），
 * 保证 datasetVersion 不漂移。
 */
export function buildCompositeExecutionDataset(input: {
  base: ResearchDataset;
  selectedEvents: readonly CompositeSelectedEvent[];
  extensionBarsByEvent: ReadonlyMap<string, readonly CompositeExtensionBar[]>;
  extensionRelativeDayRange?: { min: number; max: number };
  projectionName?: string;
}): ResearchDataset {
  const min = input.extensionRelativeDayRange?.min ?? 17;
  const max = input.extensionRelativeDayRange?.max ?? 80;
  const rows = input.base.rows.slice();
  const seen = new Set(rows.map((r) => r.tradeDate + "\u0000" + r.securityId));
  for (const event of input.selectedEvents) {
    for (const bar of input.extensionBarsByEvent.get(event.eventId) ?? []) {
      if (bar.relativeDay < min || bar.relativeDay > max) continue;
      const row = rowFromExtension(event.securityId, event.symbol, bar);
      const key = row.tradeDate + "\u0000" + row.securityId;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.tradeDate !== b.tradeDate ? a.tradeDate.localeCompare(b.tradeDate) : a.securityId.localeCompare(b.securityId));
  const request = { ...input.base.dataSnapshot.request, name: input.projectionName ?? "runner-holding-bridge-001-v5-plus-v7-rd17-80" };
  const snapshot = {
    ...input.base.dataSnapshot, capturedAt: new Date().toISOString(), request,
    domains: [{
      domain: "A", rowsLoaded: rows.length,
      securitiesCovered: new Set(rows.map((r) => r.securityId)).size,
      datesCovered: new Set(rows.map((r) => r.tradeDate)).size,
      datesExpected: new Set(rows.map((r) => r.tradeDate)).size,
      note: "v5 official rows plus v7 rd17..80 for selected 1.62.1 events",
    }],
    coverageGaps: [],
  };
  return {
    ...input.base,
    datasetVersion: computeDatasetVersionStreaming(request, input.base.universeDefinition, rows),
    rows, dataSnapshot: snapshot, policySet: derivePolicySet(request, snapshot), gate: "PASS", gateNotes: [],
  };
}

export function rebuildCompositeRun(base: CandidateEvaluationRun, dataset: ResearchDataset): CandidateEvaluationRun {
  const { fingerprint: _f, ...rest } = base;
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    ...rest, datasetVersion: dataset.datasetVersion,
    universeId: deriveDatasetUniverseId(dataset.datasetVersion), datasetGate: dataset.gate,
  };
  return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
}

// ---------------------------------------------------------------------------
// 组合回测（唯一入口 = 既有 runTradeSimulation）
// ---------------------------------------------------------------------------

export interface RunCompositeRunnerBacktestInput {
  dataset: ResearchDataset;
  sourceRun: CandidateEvaluationRun;
  strategyDocument: StrategyDocument;
  /** 显式模拟窗口（必须与调用方一致；不得回落到 dataset request，否则会漂移）。 */
  dateRange: { startDate: string; endDate: string };
  datasetVersionId: number;
  codeVersion: string;
  createdAt: string;
  name: string;
  runnerBridge?: RunnerHoldingBridgePolicyDefinition | null;
}

export interface CompositeRunnerBacktestResult {
  run: TradeSimulationRun;
  simulationConfig: SimulationConfig;
}

export async function runCompositeRunnerBacktest(
  input: RunCompositeRunnerBacktestInput,
): Promise<CompositeRunnerBacktestResult> {
  const assembled = await assembleRunWorkbenchInputs({
    strategyId: input.strategyDocument.strategyId,
    strategyVersion: input.strategyDocument.version,
    startDate: input.dateRange.startDate,
    endDate: input.dateRange.endDate,
    createdAt: input.createdAt,
    codeVersion: input.codeVersion,
    strategyDocument: input.strategyDocument,
    datasetVersionId: input.datasetVersionId,
    dataReady: true,
    datasetSourcePolicy: "prefer-registry",
    researchDataset: input.dataset,
  });
  const base = assembled.inputs.simulationConfig;
  if (!base) throw new Error("compositeRunner: assembleRunWorkbenchInputs 未产出 simulationConfig");
  const simulationConfig: SimulationConfig = input.runnerBridge
    ? {
        ...base, name: input.name,
        exitPolicy: {
          ...(base.exitPolicy ?? { stopLossRatio: null, takeProfitRatio: null, maxHoldingDays: null }),
          runnerBridge: input.runnerBridge,
        },
      }
    : { ...base, name: input.name };
  const run = runTradeSimulation({ dataset: input.dataset, sourceRun: input.sourceRun, simConfig: simulationConfig });
  return { run, simulationConfig };
}

