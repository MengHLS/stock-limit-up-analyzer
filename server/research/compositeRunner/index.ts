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
import {
  computeTrendScore,
  fuseTrendIntoThreeFactorScore,
} from "../recipeFeatures/trendScoreFeatures";
import {
  TREND_V2_COMPONENT_IDS,
  computeTrendV2Components,
  fuseTrendV2IntoThreeFactorScore,
} from "../recipeFeatures/trendScoreV2Features";
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
import type { CompositeCarryoverAccounting } from "./carryover";
import type { CompositeLateEntryAccounting } from "./lateEntry";
import type { CompositeEventGateAccounting } from "./eventGate";

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
/** bucket_t5 臂的决策相对日恒为 T+5（3F 首次可算日）。 */
const BUCKET_DECISION_RELATIVE_DAY = 5;

/**
 * P0 趋势融合的如实计数（**只在 rankFusion 生效的臂上出现**）。
 *
 * `droppedMissingTrendScore > 0` 表示该臂确实**排除了** `trendScore` 不可算的候选
 * —— 不插补、不填 0（纪律与 3F 特征一致）。bucket_t5 的候选按构造已具备 rd0..5
 * 完整 bar，因此正常情况下该值应为 0；非 0 必须在页面上如实显示。
 */
export interface FusionAccounting {
  readonly scoredCandidateCount: number;
  readonly droppedMissingTrendScore: number;
}

/**
 * 阈值门槛的如实计数（**只在 candidateGate 生效的臂上出现**）。
 *
 * excludedByTrendGate = 因 trendScore < minTrendScore（含 trendScore 不可算）被剔除的
 * 候选数。门槛只**减少**候选池，**不改排序值**。
 */
export interface GateAccounting {
  readonly evaluatedCandidateCount: number;
  readonly excludedByTrendGate: number;
}

/** P1 趋势 v2 分位融合的如实计数（**只在 candidateScoreV2 生效的臂上出现**）。 */
export interface V2FusionAccounting {
  readonly scoredCandidateCount: number;
  /** v2 三分量不可算（缺失/非法 bar）而被排除的候选数。 */
  readonly droppedMissingComponents: number;
}

export interface BuiltCompositeArm {
  id: string;
  label: string;
  kind: CompositeArmKind;
  sourceRun: CandidateEvaluationRun;
  selectedSecurityIds: Set<string>;
  signalTeBySecurity: Map<string, Te>;
  selectedCountByTe: Record<string, number>;
  /** 仅 rankFusion 生效时出现（控制臂 = undefined，逐字段沿用既有行为）。 */
  fusionAccounting?: FusionAccounting;
  /** 仅 candidateGate 生效时出现（控制臂 = undefined）。 */
  gateAccounting?: GateAccounting;
  /** 仅 candidateScoreV2 生效时出现（控制臂 = undefined）。 */
  v2FusionAccounting?: V2FusionAccounting;
  /** 仅显式应用跨日候选池时出现（控制臂 = undefined）。 */
  carryAccounting?: CompositeCarryoverAccounting;
  /** 仅显式应用延迟入场 / 晚窗口重评分时出现（控制臂 = undefined）。 */
  lateEntryAccounting?: CompositeLateEntryAccounting;
  /** 仅显式应用事件事实 gate 时出现（控制臂 = undefined）。 */
  eventGateAccounting?: CompositeEventGateAccounting;
  /** 仅声明 candidateListingFilter 时出现（控制臂 = undefined）。 */
  listingFilterAccounting?: ListingFilterAccounting;
}

/**
 * 取「事件日 rd0 → 决策日 rdN」的**连续** bar 序列（升序）。
 *
 * 🔴 PIT：本函数**只读 `rd 0..decisionRelativeDay`**，绝不读决策日之后的行
 * （`barsByRelativeDay` 里 rd 6..16 的行是既有研究面板的机械产物，不是决策信息）。
 * 任一根缺失 / 非 OHLCV 有效 ⇒ 返回 null（不跳过、不插补）。
 */
function decisionWindowBarsOf(
  event: CompositeEventRecord,
  decisionRelativeDay: number,
): CanonicalMarketBar[] | null {
  if (!Number.isInteger(decisionRelativeDay) || decisionRelativeDay < 0) return null;
  const bars: CanonicalMarketBar[] = [];
  for (let relativeDay = 0; relativeDay <= decisionRelativeDay; relativeDay += 1) {
    const row = event.barsByRelativeDay.get(relativeDay);
    if (!validOhlcv(row)) return null;
    bars.push(toBar(row));
  }
  return bars;
}

/** 候选的 v2 三分量（决策日截断；不可算 ⇒ null）。 */
function trendV2ComponentsOfCandidate(
  candidate: RankCandidate | BucketCandidate,
  decisionRelativeDay: number,
): ReturnType<typeof computeTrendV2Components> {
  const bars = decisionWindowBarsOf(candidate.event, decisionRelativeDay);
  if (bars === null) return null;
  return computeTrendV2Components(bars);
}

/** 候选的趋势评分（决策日截断；不可算 ⇒ null）。 */
function trendScoreOfCandidate(
  candidate: RankCandidate | BucketCandidate,
  decisionRelativeDay: number,
): number | null {
  const bars = decisionWindowBarsOf(candidate.event, decisionRelativeDay);
  if (bars === null) return null;
  return computeTrendScore(bars);
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

/** 候选事件被硬过滤剔除的原因码（单一权威：与 `accounting` 在**同一次循环**里产出）。 */
export type CompositeEventExclusionReason =
  | "EVENT_DATE_NOT_IN_CALENDAR"
  | "EVENT_DAY_BAR_INVALID"
  | "ONE_WORD_OR_T_BOARD"
  | "OBSERVATION_WINDOW_INCOMPLETE"
  | "NO_PULLBACK_IN_OBSERVATION_WINDOW"
  | "MAX_AMPLITUDE_ABOVE_LIMIT"
  /** 观察窗完整但三因子算不出来（如 T+1 量比无基准）—— 如实单列，不混进「无回踩」。 */
  | "FACTORS_UNAVAILABLE";

/**
 * 被剔除的**单个候选事件**（可审计到票）。
 *
 * 🔴 为什么由本函数产出：剔除判定只应该有一份实现 ⇒ 记录在**同一次循环**里 push，
 * 保证「逐只明细」与既有 `accounting` 计数来自同一批判断，不会出现两套口径漂移。
 */
export interface CompositeEventExclusion {
  /** 事件级身份（与 `ResearchDatasetRow.securityId` 同源）。 */
  readonly securityId: string;
  /** 事件日 T0（无法解析 = ""）。 */
  readonly eventDate: string;
  readonly reason: CompositeEventExclusionReason;
}

export function buildCompositeEvents(dataset: ResearchDataset, maxAmplitude: number): {
  events: CompositeEventRecord[];
  tradingDays: string[];
  bucketCandidatesByDate: Map<string, BucketCandidate[]>;
  rankCandidatesByTe: Map<Te, Map<string, RankCandidate[]>>;
  accounting: Record<string, number>;
  /** 逐只剔除明细（原因码 + 事件身份）；与 `accounting` 的过滤计数同源。 */
  exclusionRecords: CompositeEventExclusion[];
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
  const exclusionRecords: CompositeEventExclusion[] = [];
  for (const [securityId, rows] of rowsBySecurity) {
    const eventDate = parseEventDate(securityId);
    const eventIndex = dayIndex.get(eventDate);
    if (eventIndex === undefined) {
      accounting.invalidEventDate += 1;
      exclusionRecords.push({ securityId, eventDate, reason: "EVENT_DATE_NOT_IN_CALENDAR" });
      continue;
    }
    const barsByRelativeDay = new Map<number, ResearchDatasetRow>();
    for (const row of rows) {
      const rowIndex = dayIndex.get(row.tradeDate);
      if (rowIndex === undefined) continue;
      const relativeDay = rowIndex - eventIndex;
      if (relativeDay >= 0 && relativeDay <= 16) barsByRelativeDay.set(relativeDay, row);
    }
    const eventBar = barsByRelativeDay.get(0);
    if (!validOhlcv(eventBar)) {
      accounting.invalidEventBar += 1;
      exclusionRecords.push({ securityId, eventDate, reason: "EVENT_DAY_BAR_INVALID" });
      continue;
    }
    const oneWordOrT = !(eventBar.open! < eventBar.high! - 1e-9);
    if (oneWordOrT) {
      accounting.oneWordOrTEvent += 1;
      exclusionRecords.push({ securityId, eventDate, reason: "ONE_WORD_OR_T_BOARD" });
      continue;
    }
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
    if (!complete) {
      exclusionRecords.push({ securityId, eventDate, reason: "OBSERVATION_WINDOW_INCOMPLETE" });
      continue;
    }
    accounting.bucketComplete += 1;
    const raw = computeThreeFactorRaw(bars);
    if (raw === null) {
      exclusionRecords.push({ securityId, eventDate, reason: "FACTORS_UNAVAILABLE" });
      continue;
    }
    if (!raw.hasPullbackInObservationWindow) {
      exclusionRecords.push({ securityId, eventDate, reason: "NO_PULLBACK_IN_OBSERVATION_WINDOW" });
      continue;
    }
    accounting.bucketPullback += 1;
    if (!(raw.maxAmplitude < maxAmplitude)) {
      exclusionRecords.push({ securityId, eventDate, reason: "MAX_AMPLITUDE_ABOVE_LIMIT" });
      continue;
    }
    accounting.bucketPassed += 1;
    const score = threeFactorCompositeScoreOf(raw, { requirePullback: true });
    if (score === null) continue;
    const signalDate = bars[5]!.timestamp;
    const list = bucketCandidatesByDate.get(signalDate) ?? [];
    list.push({ event: eventRecord, signalDate, score });
    bucketCandidatesByDate.set(signalDate, list);
  }
  return { events, tradingDays, bucketCandidatesByDate, rankCandidatesByTe, accounting, exclusionRecords };
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

/** P10 候选池上市龄过滤的如实计数（仅在声明了 candidateListingFilter 的臂上出现）。 */
export interface ListingFilterAccounting {
  readonly evaluatedCandidateCount: number;
  readonly excludedByListingAge: number;
  readonly unknownListingDate: number;
}

/** 去掉 `::event:<code>@<date>` 后缀，取回 Security Master 的永久身份 securityId。 */
export function baseSecurityIdOf(securityId: string): string {
  const index = securityId.indexOf("::event:");
  return index < 0 ? securityId : securityId.slice(0, index);
}

/** 自然日龄 = asOfDate − listedDate（两个入参均为 YYYY-MM-DD；按自然日，不按交易日）。 */
function listingAgeDays(listedDate: string, asOfDate: string): number {
  return Math.floor((Date.parse(asOfDate + "T00:00:00Z") - Date.parse(listedDate + "T00:00:00Z")) / 86400000);
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
  /**
   * P0：把趋势评分按权重融合进排序值（`rankFusion = null`（缺省）= **逐字段沿用既有
   * 3F 排序**，既有实验/版本零变化）。融合只改**排序值**，不改候选资格、不改 topN、
   * 不改退出政策 / 仓位 / Runner。
   */
  rankFusion?: { readonly trendWeight: number } | null;
  /**
   * P0-2：趋势分**门槛**（只筛不改排序）——trendScore < minTrendScore 的候选直接剔除，
   * 存活候选仍按**纯 3F 合成分**降序取 TopN。
   *
   * null（缺省）= 无门槛，既有行为逐字段不变。trendScore 不可算的候选**也按不通过处理**
   * （不可证实 ⇒ 不放行，不插补）。
   */
  candidateGate?: { readonly minTrendScore: number } | null;
  /**
   * P1：**趋势评分 v2（符号修正版）的分位融合**。
   *
   * v2 的三个分量（回撤深度 / 取负动量 / 取负窗内偏离）已由
   * docs/evidence/_analysis_trend_score_v1_forward_ic_20261004.json 验证方向；
   * 因为三者量纲不同，这里**逐分量在当日候选内做横截面分位**（唯一 ranker
   * framework/ranking#rankSignals），再等权平均成 v2Percentile，最后
   * fused = (1 - v2Weight)·3F + v2Weight·v2Percentile。
   *
   * null（缺省）= 不融合，既有行为逐字段不变；与 rankFusion **互斥**（同时给 ⇒ 抛错）。
   */
  candidateScoreV2?: { readonly v2Weight: number } | null;
  /**
   * P10：**候选池上市龄过滤**（排序前剔除，允许低名次递补）。
   *
   * null（缺省）= 不过滤，既有行为逐字段不变。
   * 上市日由调用方提供（Security Master `research_securities.listedDate`），按**决策日**
   * 计算自然日龄；上市日不可得 ⇒ **不剔除**并如实计数 —— 本规则是 alpha 资格过滤而非
   * 风控，不可证实的身份不得被静默排除。
   */
  candidateListingFilter?: {
    readonly minListingAgeDays: number;
    readonly listingDateOf: (securityId: string) => string | null;
  } | null;
}

export function buildCompositeSourceRun(input: BuildCompositeSourceRunInput): BuiltCompositeArm {
  const { armId, label, kind, dataset, tradingDays, topN } = input;
  const selectedSecurityIds = new Set<string>();
  const signalTeBySecurity = new Map<string, Te>();
  const selectedCountByTe: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  if (input.rankFusion !== undefined && input.rankFusion !== null
    && input.candidateScoreV2 !== undefined && input.candidateScoreV2 !== null) {
    throw new Error("compositeRunner：rankFusion（v1 融合）与 candidateScoreV2（v2 融合）互斥，不能同时生效。");
  }
  const consumed = new Set<string>();
  const dayRecords: CandidateDayRecord[] = [];
  const v2FusionAccounting: { scoredCandidateCount: number; droppedMissingComponents: number } = {
    scoredCandidateCount: 0,
    droppedMissingComponents: 0,
  };
  const fusionAccounting: { scoredCandidateCount: number; droppedMissingTrendScore: number } = {
    scoredCandidateCount: 0,
    droppedMissingTrendScore: 0,
  };
  const gateAccounting: { evaluatedCandidateCount: number; excludedByTrendGate: number } = {
    evaluatedCandidateCount: 0,
    excludedByTrendGate: 0,
  };
  const listingFilterAccounting: { evaluatedCandidateCount: number; excludedByListingAge: number; unknownListingDate: number } = {
    evaluatedCandidateCount: 0,
    excludedByListingAge: 0,
    unknownListingDate: 0,
  };
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
    const scoredCandidates = kind === "bucket_t5" ? (rawCandidates as BucketCandidate[]) : scoreRankCandidates(rawCandidates as RankCandidate[]);
    // P10：上市龄过滤（**在排序 / 门槛 / 融合之前**）——「从候选池里剔除」而非「选中后跳过」。
    const listingFilter = input.candidateListingFilter ?? null;
    let candidates: Array<RankCandidate | BucketCandidate> = scoredCandidates;
    if (listingFilter !== null) {
      const kept: Array<RankCandidate | BucketCandidate> = [];
      for (const candidate of scoredCandidates) {
        listingFilterAccounting.evaluatedCandidateCount += 1;
        const listedDate = listingFilter.listingDateOf(candidate.event.securityId);
        if (listedDate === null) {
          listingFilterAccounting.unknownListingDate += 1;
          kept.push(candidate);
          continue;
        }
        if (listingAgeDays(listedDate, date) < listingFilter.minListingAgeDays) {
          listingFilterAccounting.excludedByListingAge += 1;
          continue;
        }
        kept.push(candidate);
      }
      candidates = kept;
    }
    const gate = input.candidateGate ?? null;
    const gatePassed: Array<RankCandidate | BucketCandidate> = [];
    if (gate !== null) {
      for (const candidate of candidates) {
        const decisionRelativeDay = kind === "bucket_t5"
          ? BUCKET_DECISION_RELATIVE_DAY
          : (candidate as RankCandidate).te;
        gateAccounting.evaluatedCandidateCount += 1;
        const trendScore = trendScoreOfCandidate(candidate, decisionRelativeDay);
        if (trendScore === null || trendScore < gate.minTrendScore) {
          gateAccounting.excludedByTrendGate += 1;
          continue;
        }
        gatePassed.push(candidate);
      }
    }
    const gatedCandidates: Array<RankCandidate | BucketCandidate> = gate === null ? candidates : gatePassed;
    let scoreable: Array<RankCandidate | BucketCandidate> = gatedCandidates;
    const v2Fusion = input.candidateScoreV2 ?? null;
    if (v2Fusion !== null) {
      // ① 逐候选算 v2 三分量（PIT：rd0..决策日）
      const scored: Array<{ candidate: RankCandidate | BucketCandidate } & NonNullable<ReturnType<typeof computeTrendV2Components>>> = [];
      for (const candidate of gatedCandidates) {
        const decisionRelativeDay = kind === "bucket_t5"
          ? BUCKET_DECISION_RELATIVE_DAY
          : (candidate as RankCandidate).te;
        const components = trendV2ComponentsOfCandidate(candidate, decisionRelativeDay);
        if (components === null) {
          v2FusionAccounting.droppedMissingComponents += 1;
          continue;
        }
        scored.push({ candidate, ...components });
        v2FusionAccounting.scoredCandidateCount += 1;
      }
      // ② 逐分量横截面分位（同日 peer 集合；缺分量者已在 ① 排除）
      const v2RankingConfig = { higherIsBetter: true, tieBreaking: "average" as const, missingPolicy: "exclude" as const };
      const percentileByComponent = new Map<string, ReadonlyMap<string, number | null>>();
      for (const componentId of TREND_V2_COMPONENT_IDS) {
        const ranked = rankSignals(
          scored.map((item) => ({ securityId: item.candidate.event.securityId, value: item[componentId] })),
          v2RankingConfig,
        );
        percentileByComponent.set(
          componentId,
          new Map(ranked.map((item) => [item.securityId, item.percentile])),
        );
      }
      // ③ 等权平均三分位 ⇒ v2Percentile ⇒ 与 3F 融合
      const fused: Array<RankCandidate | BucketCandidate> = [];
      for (const item of scored) {
        const securityId = item.candidate.event.securityId;
        let sum = 0;
        let complete = true;
        for (const componentId of TREND_V2_COMPONENT_IDS) {
          const percentile = percentileByComponent.get(componentId)!.get(securityId) ?? null;
          if (percentile === null) { complete = false; break; }
          sum += percentile;
        }
        if (!complete) continue;
        const v2Percentile = sum / TREND_V2_COMPONENT_IDS.length;
        fused.push({
          ...item.candidate,
          score: fuseTrendV2IntoThreeFactorScore(item.candidate.score, v2Percentile, v2Fusion.v2Weight),
        });
      }
      scoreable = fused;
    }
    const fusion = input.rankFusion ?? null;
    if (fusion !== null) {
      const fused: Array<RankCandidate | BucketCandidate> = [];
      for (const candidate of gatedCandidates) {
        const decisionRelativeDay = kind === "bucket_t5"
          ? BUCKET_DECISION_RELATIVE_DAY
          : (candidate as RankCandidate).te;
        const trendScore = trendScoreOfCandidate(candidate, decisionRelativeDay);
        if (trendScore === null) {
          fusionAccounting.droppedMissingTrendScore += 1;
          continue;
        }
        fused.push({
          ...candidate,
          score: fuseTrendIntoThreeFactorScore(candidate.score, trendScore, fusion.trendWeight),
        });
        fusionAccounting.scoredCandidateCount += 1;
      }
      scoreable = fused;
    }
    const ranked = [...scoreable].sort((left, right) => {
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
    parameters: {
      arm: armId, topN, maxAmplitude: input.maxAmplitude,
      factorDirections: "maxAmplitude_Te=LOW,meanAmplitude_Te=LOW,t1VolumeRatio=HIGH",
      ...(input.rankFusion === undefined || input.rankFusion === null
        ? {}
        : { rankFusionTrendWeight: input.rankFusion.trendWeight }),
      ...(input.candidateGate === undefined || input.candidateGate === null
        ? {}
        : { minTrendScore: input.candidateGate.minTrendScore }),
      ...(input.candidateScoreV2 === undefined || input.candidateScoreV2 === null
        ? {}
        : { trendV2Weight: input.candidateScoreV2.v2Weight }),
      ...(input.candidateListingFilter === undefined || input.candidateListingFilter === null
        ? {}
        : { minListingAgeDays: input.candidateListingFilter.minListingAgeDays }),
    },
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
    ...(input.rankFusion === undefined || input.rankFusion === null
      ? {}
      : { fusionAccounting }),
    ...(input.candidateGate === undefined || input.candidateGate === null
      ? {}
      : { gateAccounting }),
    ...(input.candidateScoreV2 === undefined || input.candidateScoreV2 === null
      ? {}
      : { v2FusionAccounting }),
    ...(input.candidateListingFilter === undefined || input.candidateListingFilter === null
      ? {}
      : { listingFilterAccounting }),
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
  /** P0：趋势评分排序融合（缺省 = 既有纯 3F 排序，逐位不变）。 */
  rankFusion?: { readonly trendWeight: number } | null;
  /** P0-2：趋势分门槛（只筛不改排序；缺省 = 无门槛）。 */
  candidateGate?: { readonly minTrendScore: number } | null;
  /** P1：趋势评分 v2 分位融合（缺省 = 不融合）。 */
  candidateScoreV2?: { readonly v2Weight: number } | null;
  /** P10：候选池上市龄过滤（缺省 = 不过滤，逐位不变）。 */
  candidateListingFilter?: {
    readonly minListingAgeDays: number;
    readonly listingDateOf: (securityId: string) => string | null;
  } | null;
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
    rankFusion: input.rankFusion ?? null,
    candidateGate: input.candidateGate ?? null,
    candidateScoreV2: input.candidateScoreV2 ?? null,
    candidateListingFilter: input.candidateListingFilter ?? null,
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

export { applyCompositeCarryover } from "./carryover";
export type { CompositeCarryoverAccounting, CompositeCarryoverPolicy, CompositeCarryoverRefreshPolicy } from "./carryover";
export { applyCompositeLateEntry } from "./lateEntry";
export type { CompositeLateEntryAccounting, CompositeLateEntryPolicy } from "./lateEntry";
export { applyCompositeEventGate } from "./eventGate";
export type { CompositeEventGateAccounting, CompositeEventGatePolicy } from "./eventGate";

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

