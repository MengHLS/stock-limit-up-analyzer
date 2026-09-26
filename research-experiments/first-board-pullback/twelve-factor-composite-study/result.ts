import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import {
  movingBlockBootstrapDifference,
  movingBlockBootstrapMean,
} from "../../shared/dateClusterBootstrap";

/**
 * 十二因子等权综合评分（第一版）。
 *
 * 🔴 桶边界 / 方向表 / 权重**全部**来自 `docs/research/FROZEN-BUCKET-CONTRACT-001.md`：
 *    本文件是本契约在代码里的**唯一**落地处，改动必须同步改契约并新开契约版本号。
 *    实验内**禁止**任何分位搜索、最优切点、权重优化、方向再估计。
 */

export const COMPUTATION_VERSION = "1.0.0";
export const BUCKET_CONTRACT_ID = "FROZEN-BUCKET-CONTRACT-001";

/** 入场相对日：T+6 开盘（先验要求决策时点晚于 T+5）。 */
export const ENTRY_DAY = 6;
/** 主退出持有日：holding day 5 ⇒ 相对日 T+10 收盘。 */
export const PRIMARY_HOLDING_DAY = 5;
export const EXIT_RELATIVE_DAY = ENTRY_DAY + PRIMARY_HOLDING_DAY - 1;
export const MAX_RELATIVE_DAY = 20;
export const MIN_RELATIVE_DAY = -10;
export const ROUND_TRIP_COST_BPS = 20;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_925;
export const MIN_BUCKET_SAMPLE = 100;
export const DECILE_COUNT = 10;
export const QUINTILE_COUNT = 5;
export const TOTAL_FACTOR_COUNT = 12;
export const WEIGHT_PER_FACTOR = 1 / TOTAL_FACTOR_COUNT;

export type Verdict = "POSITIVE" | "NEGATIVE" | "INCONCLUSIVE" | "INSUFFICIENT";

export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

// ---------------------------------------------------------------------------
// 契约 §2：12 组冻结分桶（标签即桶身份，顺序即升序）
// ---------------------------------------------------------------------------

const BODY_HEIGHT_BUCKETS = [
  "≤0.1%",
  "0.1~2%",
  "2~4%",
  "4~6%",
  "6~8%",
  "≥8%",
] as const;

const TURNOVER_BUCKETS = [
  "<1%",
  "1~2%",
  "2~3%",
  "3~5%",
  "5~10%",
  "≥10%",
] as const;

const PERCENTILE_BUCKETS = [
  "0~20 分位",
  "20~40 分位",
  "40~60 分位",
  "60~80 分位",
  "80~100 分位",
] as const;

const MEAN_AMPLITUDE_BUCKETS = [
  "<2%",
  "2~4%",
  "4~6%",
  "6~8%",
  "≥8%",
] as const;

const MAX_AMPLITUDE_BUCKETS = ["<8%", "≥8%"] as const;

const HOLD_STREAK_BUCKETS = [
  "0 日",
  "1 日",
  "2 日",
  "3 日",
  "4 日",
  "5 日",
] as const;

const VOLUME_RATIO_BUCKETS = [
  "<50%",
  "50~80%",
  "80~120%",
  "120~200%",
  "≥200%",
] as const;

const LIMIT_GAP_BUCKETS = [
  "UNKNOWN",
  "1~3 日",
  "4~5 日",
  "6~10 日",
  "11~20 日",
  ">20 日",
] as const;

const PRE_RETURN_BUCKETS = [
  "<-10%",
  "-10~-5%",
  "-5~0%",
  "0~+5%",
  "+5~+10%",
  "+10~+20%",
  ">+20%",
] as const;

const DRAWDOWN_BUCKETS = [
  "0~-2%",
  "-2~-5%",
  "-5~-8%",
  "-8~-10%",
  "<-10%",
] as const;

const OPEN_GAP_BUCKETS = [
  "<-5%",
  "-5~0%",
  "0~+5%",
  "+5~+10%",
  "≥+10%",
] as const;

const HISTORY_BUCKETS = [
  "0 次",
  "1 次",
  "2 次",
  "3~5 次",
  "6~10 次",
  ">10 次",
] as const;

export const TWELVE_FACTOR_CODES = [
  "bodyHeight",
  "turnover",
  "amountPercentile",
  "meanAmplitude",
  "maxAmplitude",
  "holdStreak",
  "t1VolumeRatio",
  "limitGap",
  "preReturn10",
  "drawdownDepth",
  "t1OpenGap",
  "historyLimitCount",
] as const;
export type TwelveFactorCode = (typeof TWELVE_FACTOR_CODES)[number];

export interface FactorDefinition {
  code: TwelveFactorCode;
  label: string;
  source: string;
  /** 契约 §3.2：+1 = 桶越大分越高；-1 = 桶越小分越高。 */
  orientation: 1 | -1;
  /** false = 「先验未验证方向」（契约 §3.2 的三条）。 */
  priorVerified: boolean;
  /** 升序桶标签；下标即契约 §3.1 的 `idx`。 */
  buckets: readonly string[];
  /** 返回桶标签；`null` = 因子缺失（F8 的 UNKNOWN 是合法桶，不返回 null）。 */
  bucketOf: (value: number | null) => string | null;
  /** 原实验已冻结的定性结论（策展 §5.4），用于横向比较表的最后一列。 */
  originalFinding: string;
}

export const TWELVE_FACTOR_DEFINITIONS: readonly FactorDefinition[] = [
  {
    code: "bodyHeight",
    label: "首板实体高度",
    source: "first-board-body-study",
    orientation: -1,
    priorVerified: true,
    buckets: BODY_HEIGHT_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value <= 0.001) return BODY_HEIGHT_BUCKETS[0];
      if (value < 0.02) return BODY_HEIGHT_BUCKETS[1];
      if (value < 0.04) return BODY_HEIGHT_BUCKETS[2];
      if (value < 0.06) return BODY_HEIGHT_BUCKETS[3];
      if (value < 0.08) return BODY_HEIGHT_BUCKETS[4];
      return BODY_HEIGHT_BUCKETS[5];
    },
    originalFinding: "实体高度分桶过滤是风控而非 alpha 来源；高分位表现差。",
  },
  {
    code: "turnover",
    label: "首板换手率",
    source: "turnover-study",
    orientation: -1,
    priorVerified: true,
    buckets: TURNOVER_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value < 1) return TURNOVER_BUCKETS[0];
      if (value < 2) return TURNOVER_BUCKETS[1];
      if (value < 3) return TURNOVER_BUCKETS[2];
      if (value < 5) return TURNOVER_BUCKETS[3];
      if (value < 10) return TURNOVER_BUCKETS[4];
      return TURNOVER_BUCKETS[5];
    },
    originalFinding: "高换手组表现差；流通市值列全空，未用现价伪造成交市值。",
  },
  {
    code: "amountPercentile",
    label: "同日成交额分位",
    source: "dynamic-state-factor-expansion-study",
    orientation: -1,
    priorVerified: true,
    buckets: PERCENTILE_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value < 0.2) return PERCENTILE_BUCKETS[0];
      if (value < 0.4) return PERCENTILE_BUCKETS[1];
      if (value < 0.6) return PERCENTILE_BUCKETS[2];
      if (value < 0.8) return PERCENTILE_BUCKETS[3];
      return PERCENTILE_BUCKETS[4];
    },
    originalFinding: "同日高分位（换手/振幅/实体/成交额）组表现差。",
  },
  {
    code: "meanAmplitude",
    label: "T+1..T+5 平均振幅",
    source: "post-event-amplitude-study",
    orientation: -1,
    priorVerified: true,
    buckets: MEAN_AMPLITUDE_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value < 0.02) return MEAN_AMPLITUDE_BUCKETS[0];
      if (value < 0.04) return MEAN_AMPLITUDE_BUCKETS[1];
      if (value < 0.06) return MEAN_AMPLITUDE_BUCKETS[2];
      if (value < 0.08) return MEAN_AMPLITUDE_BUCKETS[3];
      return MEAN_AMPLITUDE_BUCKETS[4];
    },
    originalFinding: "⭐ 高振幅是最明确的风险来源；低振幅改善均值与回撤但中位多为负。",
  },
  {
    code: "maxAmplitude",
    label: "T+1..T+5 最大振幅",
    source: "hold-streak-amplitude-t10-study",
    orientation: -1,
    priorVerified: true,
    buckets: MAX_AMPLITUDE_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      return value < 0.08 ? MAX_AMPLITUDE_BUCKETS[0] : MAX_AMPLITUDE_BUCKETS[1];
    },
    originalFinding: "`streak=5` 且平均振幅 `>=8%` 的 Bootstrap 区间整体低于 0。",
  },
  {
    code: "holdStreak",
    label: "守涨停价 streak（收盘口径）",
    source: "limit-up-price-hold-streak-study",
    orientation: 1,
    priorVerified: false,
    buckets: HOLD_STREAK_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      const clamped = Math.max(0, Math.min(5, Math.round(value)));
      return HOLD_STREAK_BUCKETS[clamped];
    },
    originalFinding: "连续守住涨停价的收益没有稳定正向证据 ⇒ 方向先验未验证。",
  },
  {
    code: "t1VolumeRatio",
    label: "T+1 成交量 ÷ T 日成交量",
    source: "volume-relationship-dynamic-entry-study",
    orientation: 1,
    priorVerified: true,
    buckets: VOLUME_RATIO_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value < 0.5) return VOLUME_RATIO_BUCKETS[0];
      if (value < 0.8) return VOLUME_RATIO_BUCKETS[1];
      if (value < 1.2) return VOLUME_RATIO_BUCKETS[2];
      if (value < 2) return VOLUME_RATIO_BUCKETS[3];
      return VOLUME_RATIO_BUCKETS[4];
    },
    originalFinding: "12 个量比定义与 5 档分桶已冻结；T+1 缩量差。",
  },
  {
    code: "limitGap",
    label: "前次涨停间隔",
    source: "pre-event-context-study",
    orientation: 1,
    priorVerified: false,
    buckets: LIMIT_GAP_BUCKETS,
    bucketOf: value => {
      if (value === null) return LIMIT_GAP_BUCKETS[0];
      if (value <= 3) return LIMIT_GAP_BUCKETS[1];
      if (value <= 5) return LIMIT_GAP_BUCKETS[2];
      if (value <= 10) return LIMIT_GAP_BUCKETS[3];
      if (value <= 20) return LIMIT_GAP_BUCKETS[4];
      return LIMIT_GAP_BUCKETS[5];
    },
    originalFinding:
      "长间隔＝超跌反弹属假设方向；`oversold-gap-reversal-validation` 的 Holdout = FAIL。",
  },
  {
    code: "preReturn10",
    label: "前期涨幅 close(T-1)/close(T-10)-1",
    source: "pre-event-context-study",
    orientation: -1,
    priorVerified: false,
    buckets: PRE_RETURN_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value < -0.1) return PRE_RETURN_BUCKETS[0];
      if (value < -0.05) return PRE_RETURN_BUCKETS[1];
      if (value < 0) return PRE_RETURN_BUCKETS[2];
      if (value < 0.05) return PRE_RETURN_BUCKETS[3];
      if (value < 0.1) return PRE_RETURN_BUCKETS[4];
      if (value < 0.2) return PRE_RETURN_BUCKETS[5];
      return PRE_RETURN_BUCKETS[6];
    },
    originalFinding:
      "前期跌＝超跌反弹属假设方向；冻结联合条件在 Holdout 上 FAIL。",
  },
  {
    code: "drawdownDepth",
    label: "T+1..T+5 回撤深度（对首板收盘）",
    source: "fundamental-study / decision-forward-study",
    orientation: -1,
    priorVerified: true,
    buckets: DRAWDOWN_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value >= -0.02) return DRAWDOWN_BUCKETS[0];
      if (value >= -0.05) return DRAWDOWN_BUCKETS[1];
      if (value >= -0.08) return DRAWDOWN_BUCKETS[2];
      if (value >= -0.1) return DRAWDOWN_BUCKETS[3];
      return DRAWDOWN_BUCKETS[4];
    },
    originalFinding: "深破位是风险向；回踩/破位分桶已冻结。",
  },
  {
    code: "t1OpenGap",
    label: "T+1 开盘缺口",
    source: "dynamic-state-factor-expansion-study",
    orientation: 1,
    priorVerified: true,
    buckets: OPEN_GAP_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value < -0.05) return OPEN_GAP_BUCKETS[0];
      if (value < 0) return OPEN_GAP_BUCKETS[1];
      if (value < 0.05) return OPEN_GAP_BUCKETS[2];
      if (value < 0.1) return OPEN_GAP_BUCKETS[3];
      return OPEN_GAP_BUCKETS[4];
    },
    originalFinding: "深度低开差；`T+1` 缩量差。",
  },
  {
    code: "historyLimitCount",
    label: "历史涨停次数",
    source: "dynamic-state-factor-expansion-study",
    orientation: -1,
    priorVerified: true,
    buckets: HISTORY_BUCKETS,
    bucketOf: value => {
      if (value === null) return null;
      if (value <= 0) return HISTORY_BUCKETS[0];
      if (value === 1) return HISTORY_BUCKETS[1];
      if (value === 2) return HISTORY_BUCKETS[2];
      if (value <= 5) return HISTORY_BUCKETS[3];
      if (value <= 10) return HISTORY_BUCKETS[4];
      return HISTORY_BUCKETS[5];
    },
    originalFinding: "历史涨停次数越多越差。",
  },
];

export const UNVERIFIED_FACTOR_CODES: readonly TwelveFactorCode[] = [
  "holdStreak",
  "limitGap",
  "preReturn10",
];

export const VERIFIED_FACTOR_CODES: readonly TwelveFactorCode[] =
  TWELVE_FACTOR_CODES.filter(
    code => !UNVERIFIED_FACTOR_CODES.includes(code)
  );

const FACTOR_DEFINITION_BY_CODE: ReadonlyMap<TwelveFactorCode, FactorDefinition> =
  new Map(TWELVE_FACTOR_DEFINITIONS.map(definition => [definition.code, definition]));

export function factorDefinitionOf(code: TwelveFactorCode): FactorDefinition {
  const definition = FACTOR_DEFINITION_BY_CODE.get(code);
  if (!definition) throw new Error(`未登记的因子 code：${code}`);
  return definition;
}

export const TOTAL_BUCKET_COUNT = TWELVE_FACTOR_DEFINITIONS.reduce(
  (sum, definition) => sum + definition.buckets.length,
  0
);

// ---------------------------------------------------------------------------
// 契约 §3：桶位分与综合评分
// ---------------------------------------------------------------------------

/** 契约 §3.1：`score = (idx + 0.5) / k`。 */
export function bucketPositionalScoreOf(
  code: TwelveFactorCode,
  value: number | null
): number | null {
  const definition = factorDefinitionOf(code);
  const bucket = definition.bucketOf(value);
  if (bucket === null) return null;
  const index = definition.buckets.indexOf(bucket);
  if (index < 0) return null;
  return (index + 0.5) / definition.buckets.length;
}

/** 契约 §3.1 + §3.2：桶位分经方向表变换后落在 `(0,1)`。 */
export function orientedScoreOf(
  code: TwelveFactorCode,
  value: number | null
): number | null {
  const score = bucketPositionalScoreOf(code, value);
  if (score === null) return null;
  return factorDefinitionOf(code).orientation === 1 ? score : 1 - score;
}

/** 契约 §3.3：等权平均；缺任一因子即返回 `null`（不插补、不填 0）。 */
export function compositeScoreOf(
  values: Readonly<Record<TwelveFactorCode, number | null>>,
  codes: readonly TwelveFactorCode[] = TWELVE_FACTOR_CODES
): number | null {
  let sum = 0;
  for (const code of codes) {
    const score = orientedScoreOf(code, values[code] ?? null);
    if (score === null) return null;
    sum += score;
  }
  return sum / codes.length;
}

// ---------------------------------------------------------------------------
// 样本与统计
// ---------------------------------------------------------------------------

export interface TwelveFactorSample {
  eventId: string;
  eventDate: string;
  year: number;
  /** 入场价 = T+6 开盘。 */
  entryOpen: number;
  /** 退出价 = T+10 收盘，或其后第一个可卖收盘。 */
  exitPrice: number;
  /** 已扣往返成本的净收益（比例）。 */
  netReturn: number;
  mfe: number;
  mae: number;
  /** 12 个因子值；`limitGap` 的 `null` 表示 UNKNOWN 桶，不是缺失。 */
  factors: Readonly<Record<TwelveFactorCode, number | null>>;
}

interface GroupRow {
  [key: string]: string | number | boolean | null;
  groupCode: string;
  groupLabel: string;
  sampleCount: number;
  eventDateCount: number;
  meanNetReturn: number | null;
  trimmedMeanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  p5NetReturn: number | null;
  p25NetReturn: number | null;
  p75NetReturn: number | null;
  p95NetReturn: number | null;
  meanMfe: number | null;
  meanMae: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
  verdict: Verdict;
}

interface BucketRow {
  [key: string]: string | number | boolean | null;
  factorCode: string;
  factorLabel: string;
  source: string;
  orientation: number;
  priorVerified: string;
  bucket: string;
  bucketIndex: number;
  bucketScore: number;
  orientedScore: number;
  sampleCount: number;
  eventDateCount: number;
  meanFactorValue: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  verdict: Verdict;
}

interface CrossComparisonRow {
  [key: string]: string | number | boolean | null;
  factorCode: string;
  factorLabel: string;
  priorVerified: string;
  orientation: number;
  bucketCount: number;
  usableBucketCount: number;
  bestBucket: string | null;
  worstBucket: string | null;
  bestBucketMean: number | null;
  worstBucketMean: number | null;
  spreadSingle: number | null;
  spreadCi95Low: number | null;
  spreadCi95High: number | null;
  spreadVerdict: Verdict;
  originalFinding: string;
}

interface RankedEntry {
  sample: TwelveFactorSample;
  score: number;
}

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantileOf(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/** 去最高 5% 后的均值（首板侧公共口径）。 */
function trimmedMeanTop5(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => b - a);
  const dropCount = Math.ceil(sorted.length * 0.05);
  const kept = sorted.slice(dropCount);
  if (kept.length === 0) return null;
  return mean(kept);
}

function ranksOf(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length).fill(0);
  let position = 0;
  while (position < order.length) {
    let end = position;
    while (
      end + 1 < order.length &&
      order[end + 1]!.value === order[position]!.value
    ) {
      end += 1;
    }
    const averageRank = (position + end) / 2 + 1;
    for (let cursor = position; cursor <= end; cursor += 1) {
      ranks[order[cursor]!.index] = averageRank;
    }
    position = end + 1;
  }
  return ranks;
}

/** Spearman 秩相关；任一侧全同值（无秩方差）⇒ `null`。 */
function spearman(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const leftRanks = ranksOf(left);
  const rightRanks = ranksOf(right);
  const leftMean = leftRanks.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean =
    rightRanks.reduce((sum, value) => sum + value, 0) / rightRanks.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = leftRanks[index]! - leftMean;
    const rightDelta = rightRanks[index]! - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  if (leftVariance === 0 || rightVariance === 0) return null;
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function verdictOf(args: {
  sampleCount: number;
  ciLow: number | null;
  ciHigh: number | null;
}): Verdict {
  if (args.sampleCount < MIN_BUCKET_SAMPLE) return "INSUFFICIENT";
  if (args.ciLow === null || args.ciHigh === null) return "INSUFFICIENT";
  if (args.ciLow > 0) return "POSITIVE";
  if (args.ciHigh < 0) return "NEGATIVE";
  return "INCONCLUSIVE";
}

/** 按 `score` 升序排序后用**下标等份**切档 ⇒ 各档样本数最多差 1。 */
function assignQuantileGroups(
  entries: readonly RankedEntry[],
  groupCount: number
): RankedEntry[][] {
  const groups: RankedEntry[][] = Array.from({ length: groupCount }, () => []);
  if (entries.length === 0) return groups;
  for (let index = 0; index < entries.length; index += 1) {
    const groupIndex = Math.min(
      groupCount - 1,
      Math.floor((index * groupCount) / entries.length)
    );
    groups[groupIndex]!.push(entries[index]!);
  }
  return groups;
}

function buildGroupRow(args: {
  groupCode: string;
  groupLabel: string;
  entries: readonly RankedEntry[];
  seed: number;
}): GroupRow {
  const net = args.entries.map(entry => entry.sample.netReturn);
  const sorted = [...net].sort((a, b) => a - b);
  const bootstrap = movingBlockBootstrapMean({
    samples: args.entries.map(entry => ({
      eventDate: entry.sample.eventDate,
      value: entry.sample.netReturn,
    })),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_DAYS,
    seed: args.seed,
  });
  const ciLow = bootstrap?.low ?? null;
  const ciHigh = bootstrap?.high ?? null;
  return {
    groupCode: args.groupCode,
    groupLabel: args.groupLabel,
    sampleCount: net.length,
    eventDateCount: new Set(args.entries.map(entry => entry.sample.eventDate)).size,
    meanNetReturn: net.length === 0 ? null : round(mean(net)!),
    trimmedMeanNetReturn:
      net.length === 0 ? null : round(trimmedMeanTop5(net)!),
    medianNetReturn: net.length === 0 ? null : round(quantileOf(sorted, 0.5)!),
    winRateNet:
      net.length === 0
        ? null
        : round(net.filter(value => value > 0).length / net.length),
    p5NetReturn: net.length === 0 ? null : round(quantileOf(sorted, 0.05)!),
    p25NetReturn: net.length === 0 ? null : round(quantileOf(sorted, 0.25)!),
    p75NetReturn: net.length === 0 ? null : round(quantileOf(sorted, 0.75)!),
    p95NetReturn: net.length === 0 ? null : round(quantileOf(sorted, 0.95)!),
    meanMfe: round(mean(args.entries.map(entry => entry.sample.mfe)) ?? 0),
    meanMae: round(mean(args.entries.map(entry => entry.sample.mae)) ?? 0),
    bootstrapCi95Low: ciLow === null ? null : round(ciLow),
    bootstrapCi95High: ciHigh === null ? null : round(ciHigh),
    bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
    verdict: verdictOf({
      sampleCount: net.length,
      ciLow,
      ciHigh,
    }),
  };
}

interface SpreadResult {
  best: { code: string; mean: number; entries: readonly RankedEntry[] } | null;
  worst: { code: string; mean: number; entries: readonly RankedEntry[] } | null;
  spread: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  verdict: Verdict;
}

function spreadOf(args: {
  groups: readonly { code: string; entries: readonly RankedEntry[] }[];
  seed: number;
}): SpreadResult {
  const usable = args.groups
    .filter(group => group.entries.length >= MIN_BUCKET_SAMPLE)
    .map(group => ({
      code: group.code,
      entries: group.entries,
      mean:
        group.entries.reduce((sum, entry) => sum + entry.sample.netReturn, 0) /
        group.entries.length,
    }));
  if (usable.length < 2) {
    return {
      best: null,
      worst: null,
      spread: null,
      ciLow: null,
      ciHigh: null,
      verdict: "INSUFFICIENT",
    };
  }
  const sorted = [...usable].sort((left, right) => right.mean - left.mean);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  const bootstrap = movingBlockBootstrapDifference({
    positive: best.entries.map(entry => ({
      eventDate: entry.sample.eventDate,
      value: entry.sample.netReturn,
    })),
    negative: worst.entries.map(entry => ({
      eventDate: entry.sample.eventDate,
      value: entry.sample.netReturn,
    })),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_DAYS,
    seed: args.seed,
  });
  return {
    best: { code: best.code, mean: best.mean, entries: best.entries },
    worst: { code: worst.code, mean: worst.mean, entries: worst.entries },
    spread: best.mean - worst.mean,
    ciLow: bootstrap?.low ?? null,
    ciHigh: bootstrap?.high ?? null,
    verdict: verdictOf({
      sampleCount: Math.min(best.entries.length, worst.entries.length),
      ciLow: bootstrap?.low ?? null,
      ciHigh: bootstrap?.high ?? null,
    }),
  };
}

// ---------------------------------------------------------------------------
// 结果信封
// ---------------------------------------------------------------------------

export const twelveFactorCompositeSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  bucketContractId: z.literal(BUCKET_CONTRACT_ID),
  coordinate: z.object({
    entryDay: z.literal(ENTRY_DAY),
    primaryHoldingDay: z.literal(PRIMARY_HOLDING_DAY),
    exitRelativeDay: z.literal(EXIT_RELATIVE_DAY),
    maxRelativeDay: z.literal(MAX_RELATIVE_DAY),
    roundTripCostBps: z.literal(ROUND_TRIP_COST_BPS),
  }),
  factorContract: z.array(
    z.object({
      code: z.string().min(1),
      label: z.string().min(1),
      source: z.string().min(1),
      orientation: z.union([z.literal(1), z.literal(-1)]),
      priorVerified: z.boolean(),
      bucketCount: z.number().int().positive(),
      weight: z.number().positive(),
    })
  ),
  composite: z.object({
    definition: z.string().min(1),
    weightPerFactor: z.number().positive(),
    totalBucketCount: z.number().int().positive(),
    minBucketSample: z.number().int().positive(),
    decileCount: z.number().int().positive(),
    decileSpread: z.number(),
    decileSpreadCi95Low: z.number().nullable(),
    decileSpreadCi95High: z.number().nullable(),
    decileSpreadVerdict: z.enum([
      "POSITIVE",
      "NEGATIVE",
      "INCONCLUSIVE",
      "INSUFFICIENT",
    ]),
    decileSpearman: z.number().nullable(),
    quintileSpearman: z.number().nullable(),
    verifiedOnlySpread: z.number().nullable(),
    verifiedOnlySpearman: z.number().nullable(),
    verifiedOnlyFactorCount: z.number().int().positive(),
  }),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    exactLimitUpCloseCount: z.number().int().nonnegative(),
    compositeUnavailableCount: z.number().int().nonnegative(),
    duplicateEventIdCount: z.number().int().nonnegative(),
    unscannedEventCount: z.number().int().nonnegative().nullable(),
    crossSectionPeerCount: z.number().int().nonnegative(),
    prefixWindowMissingCount: z.number().int().nonnegative(),
    factorMissingByCode: z.record(z.string(), z.number().int().nonnegative()),
  }),
  exclusionReasonLabels: z.record(z.string(), z.string().min(1)),
  observations: z.array(
    z.object({
      kind: z.enum([
        "DESCRIPTIVE",
        "COMPARATIVE",
        "POTENTIAL_SIGNAL",
        "LIMITATION",
      ]),
      text: z.string().min(1),
    })
  ),
  notes: z.array(z.string().min(1)),
});

export type TwelveFactorCompositePayload = z.infer<
  typeof twelveFactorCompositeSchema
>;

export const EXCLUSION_REASON_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    NOT_FIRST_LIMIT: "事件不是首板",
    NOT_MAIN_BOARD: "非沪深主板",
    MISSING_EVENT_DAY_BAR: "首板日行情缺失",
    INVALID_EVENT_DAY_OHLC: "首板日 OHLC 结构非法",
    EVENT_NOT_EXACT_LIMIT_UP: "首板收盘价不等于涨停价",
    MISSING_FACTOR_PATH: "T+1..T+5 行情路径不完整或停牌",
    NO_PULLBACK_IN_OBSERVATION: "T+1..T+5 从未回踩到首板收盘价下方",
    MISSING_FORWARD_PATH: "T+6..T+10 行情路径不完整或停牌",
    MISSING_PREFIX_PATH: "T-1 / T-10 收盘不可得",
    ENTRY_UNFILLABLE: "T+6 开盘不可买",
    NO_EXECUTABLE_EXIT: "T+10 及顺延窗口内无可卖收盘",
    MISSING_FACTOR: "12 因子完备用例不满足",
  });

export function exclusionReasonLabelOf(code: string): string {
  return EXCLUSION_REASON_LABELS[code] ?? code;
}

const GROUP_COLUMNS = [
  { key: "groupLabel", label: "档", align: "LEFT" },
  { key: "sampleCount", label: "样本", align: "RIGHT" },
  { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
  {
    key: "meanNetReturn",
    label: "平均净收益",
    unit: "比例",
    digits: 6,
    align: "RIGHT",
  },
  {
    key: "trimmedMeanNetReturn",
    label: "去最高5%均值",
    unit: "比例",
    digits: 6,
    align: "RIGHT",
  },
  {
    key: "medianNetReturn",
    label: "中位净收益",
    unit: "比例",
    digits: 6,
    align: "RIGHT",
  },
  { key: "winRateNet", label: "净胜率", unit: "比例", digits: 6, align: "RIGHT" },
  { key: "p5NetReturn", label: "P5", unit: "比例", digits: 6, align: "RIGHT" },
  { key: "p25NetReturn", label: "P25", unit: "比例", digits: 6, align: "RIGHT" },
  { key: "p75NetReturn", label: "P75", unit: "比例", digits: 6, align: "RIGHT" },
  { key: "p95NetReturn", label: "P95", unit: "比例", digits: 6, align: "RIGHT" },
  { key: "meanMfe", label: "平均MFE", unit: "比例", digits: 6, align: "RIGHT" },
  { key: "meanMae", label: "平均MAE", unit: "比例", digits: 6, align: "RIGHT" },
  {
    key: "bootstrapCi95Low",
    label: "聚类CI95下界",
    unit: "比例",
    digits: 6,
    align: "RIGHT",
  },
  {
    key: "bootstrapCi95High",
    label: "聚类CI95上界",
    unit: "比例",
    digits: 6,
    align: "RIGHT",
  },
  { key: "verdict", label: "三态判定", align: "LEFT" },
] as const;

export function assembleTwelveFactorComposite(args: {
  samples: readonly TwelveFactorSample[];
  candidateCount: number;
  exactLimitUpCloseCount: number;
  excludedByReason: Record<string, number>;
  factorMissingByCode: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
  crossSectionPeerCount: number;
  prefixWindowMissingCount: number;
}): ExperimentResultPayload {
  const eligibleCount = args.samples.length;
  const excludedCount = args.candidateCount - eligibleCount;
  const excludedSum = Object.values(args.excludedByReason).reduce(
    (sum, value) => sum + value,
    0
  );
  if (excludedSum !== excludedCount) {
    throw new Error(
      `样本账不守恒：excludedByReason 合计 ${excludedSum} ≠ candidate − eligible ${excludedCount}`
    );
  }

  // ---- 综合评分（12 因子）与对照（9 已验证因子） ----
  const entries12: RankedEntry[] = [];
  const entries9: RankedEntry[] = [];
  let compositeUnavailableCount = 0;
  for (const sample of args.samples) {
    const score12 = compositeScoreOf(sample.factors, TWELVE_FACTOR_CODES);
    const score9 = compositeScoreOf(sample.factors, VERIFIED_FACTOR_CODES);
    if (score12 === null || score9 === null) {
      compositeUnavailableCount += 1;
      continue;
    }
    entries12.push({ sample, score: score12 });
    entries9.push({ sample, score: score9 });
  }
  const sortRanked = (left: RankedEntry, right: RankedEntry): number =>
    left.score === right.score
      ? left.sample.eventId.localeCompare(right.sample.eventId)
      : left.score - right.score;
  entries12.sort(sortRanked);
  entries9.sort(sortRanked);

  const decileGroups12 = assignQuantileGroups(entries12, DECILE_COUNT);
  const quintileGroups12 = assignQuantileGroups(entries12, QUINTILE_COUNT);
  const decileRows12 = decileGroups12.map((entries, index) =>
    buildGroupRow({
      groupCode: `D${index + 1}`,
      groupLabel: `D${index + 1}（composite ${index === 0 ? "最低" : index === DECILE_COUNT - 1 ? "最高" : "居中"}）`,
      entries,
      seed: BOOTSTRAP_SEED + index,
    })
  );
  const quintileRows12 = quintileGroups12.map((entries, index) =>
    buildGroupRow({
      groupCode: `Q${index + 1}`,
      groupLabel: `Q${index + 1}`,
      entries,
      seed: BOOTSTRAP_SEED + 100 + index,
    })
  );
  const decileSpreads12 = spreadOf({
    groups: decileRows12.map((row, index) => ({
      code: row.groupCode,
      entries: decileGroups12[index]!,
    })),
    seed: BOOTSTRAP_SEED + 200,
  });
  const decileSpearman = spearman(
    decileRows12.map((_, index) => index + 1),
    decileRows12.map(row => row.meanNetReturn ?? 0)
  );
  const quintileSpearman = spearman(
    quintileRows12.map((_, index) => index + 1),
    quintileRows12.map(row => row.meanNetReturn ?? 0)
  );

  const decileGroups9 = assignQuantileGroups(entries9, DECILE_COUNT);
  const decileSpreads9 = spreadOf({
    groups: decileGroups9.map((entries, index) => ({
      code: `D${index + 1}`,
      entries,
    })),
    seed: BOOTSTRAP_SEED + 300,
  });
  const decileRows9 = decileGroups9.map((entries, index) =>
    buildGroupRow({
      groupCode: `D${index + 1}`,
      groupLabel: `D${index + 1}`,
      entries,
      seed: BOOTSTRAP_SEED + 400 + index,
    })
  );
  const decileSpearman9 = spearman(
    decileRows9.map((_, index) => index + 1),
    decileRows9.map(row => row.meanNetReturn ?? 0)
  );

  // ---- 12 因子各自分桶（同一份样本，用于横向比较） ----
  const bucketRows: BucketRow[] = [];
  const bucketEntriesByFactor = new Map<
    TwelveFactorCode,
    Array<{ code: string; entries: RankedEntry[] }>
  >();
  for (const definition of TWELVE_FACTOR_DEFINITIONS) {
    const groups = definition.buckets.map((bucket, bucketIndex) => ({
      code: bucket,
      bucketIndex,
      entries: [] as RankedEntry[],
    }));
    const valueByBucket = new Map<string, number[]>();
    for (const sample of args.samples) {
      const value = sample.factors[definition.code] ?? null;
      const bucket = definition.bucketOf(value);
      if (bucket === null) continue;
      const group = groups.find(candidate => candidate.code === bucket);
      if (!group) continue;
      group.entries.push({
        sample,
        score: orientedScoreOf(definition.code, value) ?? 0,
      });
      if (value !== null) {
        const list = valueByBucket.get(bucket) ?? [];
        list.push(value);
        valueByBucket.set(bucket, list);
      }
    }
    bucketEntriesByFactor.set(definition.code, groups);
    for (const group of groups) {
      const net = group.entries.map(entry => entry.sample.netReturn);
      const sorted = [...net].sort((a, b) => a - b);
      const bootstrap = movingBlockBootstrapMean({
        samples: group.entries.map(entry => ({
          eventDate: entry.sample.eventDate,
          value: entry.sample.netReturn,
        })),
        iterations: BOOTSTRAP_ITERATIONS,
        blockLength: BOOTSTRAP_BLOCK_DAYS,
        seed:
          BOOTSTRAP_SEED + 500 + definition.code.length * 10 + group.bucketIndex,
      });
      const ciLow = bootstrap?.low ?? null;
      const ciHigh = bootstrap?.high ?? null;
      const bucketScore = (group.bucketIndex + 0.5) / definition.buckets.length;
      bucketRows.push({
        factorCode: definition.code,
        factorLabel: definition.label,
        source: definition.source,
        orientation: definition.orientation,
        priorVerified: definition.priorVerified ? "先验·有证据" : "⚠️ 先验未验证",
        bucket: group.code,
        bucketIndex: group.bucketIndex,
        bucketScore: round(bucketScore),
        orientedScore: round(
          definition.orientation === 1 ? bucketScore : 1 - bucketScore
        ),
        sampleCount: net.length,
        eventDateCount: new Set(
          group.entries.map(entry => entry.sample.eventDate)
        ).size,
        meanFactorValue: round(mean(valueByBucket.get(group.code) ?? []) ?? 0),
        meanNetReturn: net.length === 0 ? null : round(mean(net)!),
        medianNetReturn: net.length === 0 ? null : round(quantileOf(sorted, 0.5)!),
        winRateNet:
          net.length === 0
            ? null
            : round(net.filter(value => value > 0).length / net.length),
        bootstrapCi95Low: ciLow === null ? null : round(ciLow),
        bootstrapCi95High: ciHigh === null ? null : round(ciHigh),
        verdict: verdictOf({ sampleCount: net.length, ciLow, ciHigh }),
      });
    }
  }

  // ---- 横向比较表 ----
  const crossComparisonRows: CrossComparisonRow[] = TWELVE_FACTOR_DEFINITIONS.map(
    (definition, factorIndex) => {
      const groups = bucketEntriesByFactor.get(definition.code) ?? [];
      const spread = spreadOf({
        groups,
        seed: BOOTSTRAP_SEED + 700 + factorIndex,
      });
      return {
        factorCode: definition.code,
        factorLabel: definition.label,
        priorVerified: definition.priorVerified ? "先验·有证据" : "⚠️ 先验未验证",
        orientation: definition.orientation,
        bucketCount: definition.buckets.length,
        usableBucketCount: groups.filter(
          group => group.entries.length >= MIN_BUCKET_SAMPLE
        ).length,
        bestBucket: spread.best?.code ?? null,
        worstBucket: spread.worst?.code ?? null,
        bestBucketMean: spread.best ? round(spread.best.mean) : null,
        worstBucketMean: spread.worst ? round(spread.worst.mean) : null,
        spreadSingle: spread.spread === null ? null : round(spread.spread),
        spreadCi95Low: spread.ciLow === null ? null : round(spread.ciLow),
        spreadCi95High: spread.ciHigh === null ? null : round(spread.ciHigh),
        spreadVerdict: spread.verdict,
        originalFinding: definition.originalFinding,
      };
    }
  );
  const summaryComparisonRow: CrossComparisonRow = {
    factorCode: "composite_12_equal_weight",
    factorLabel: "十二因子等权综合评分（本版主输出）",
    priorVerified: "9/12 有证据 + 3/12 未验证",
    orientation: 0,
    bucketCount: DECILE_COUNT,
    usableBucketCount: decileRows12.filter(
      row => row.sampleCount >= MIN_BUCKET_SAMPLE
    ).length,
    bestBucket: decileSpreads12.best?.code ?? null,
    worstBucket: decileSpreads12.worst?.code ?? null,
    bestBucketMean: decileSpreads12.best ? round(decileSpreads12.best.mean) : null,
    worstBucketMean: decileSpreads12.worst
      ? round(decileSpreads12.worst.mean)
      : null,
    spreadSingle:
      decileSpreads12.spread === null ? null : round(decileSpreads12.spread),
    spreadCi95Low:
      decileSpreads12.ciLow === null ? null : round(decileSpreads12.ciLow),
    spreadCi95High:
      decileSpreads12.ciHigh === null ? null : round(decileSpreads12.ciHigh),
    spreadVerdict: decileSpreads12.verdict,
    originalFinding: "十二因子等权（各 1/12），第一版不做权重优化。",
  };

  // ---- observations ----
  const observations: TwelveFactorCompositePayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `候选 ${args.candidateCount}；严格收盘涨停 ${args.exactLimitUpCloseCount}；` +
        `完备用例（12 因子齐全）${eligibleCount}；综合评分可用 ${entries12.length}。`,
    },
    {
      kind: "DESCRIPTIVE",
      text:
        `综合评分十分位：D10 − D1 = ` +
        `${decileSpreads12.spread === null ? "—" : (decileSpreads12.spread * 100).toFixed(2) + "pp"}` +
        `，日期聚类 Bootstrap 95% 区间 [` +
        `${decileSpreads12.ciLow === null ? "—" : (decileSpreads12.ciLow * 100).toFixed(2)}pp, ` +
        `${decileSpreads12.ciHigh === null ? "—" : (decileSpreads12.ciHigh * 100).toFixed(2)}pp]；` +
        `Spearman ρ（档序 ↔ 档均值）= ` +
        `${decileSpearman === null ? "—" : decileSpearman.toFixed(3)}。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `横向比较：12 个单因子中 spread 最大的因子与综合评分并列于「横向比较」表；` +
        `该表所有数字与综合评分同一份样本、同一入场（T+${ENTRY_DAY} 开盘）、同一退出（T+${EXIT_RELATIVE_DAY} 收盘）、` +
        `同一成本（${ROUND_TRIP_COST_BPS} bps 往返）、同一 Bootstrap 参数。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `对照变体：剔除 3 个「先验未验证方向」因子（holdStreak / limitGap / preReturn10）后的 ` +
        `${VERIFIED_FACTOR_CODES.length} 因子等权子评分：D10 − D1 = ` +
        `${decileSpreads9.spread === null ? "—" : (decileSpreads9.spread * 100).toFixed(2) + "pp"}，` +
        `Spearman ρ = ${decileSpearman9 === null ? "—" : decileSpearman9.toFixed(3)}。`,
    },
    {
      kind: "LIMITATION",
      text:
        `FBC-1~FBC-3 冻结的边界来自 v2~v5 —— 全部是已读数据，**不是 OOS**；` +
        `本 Run 是探索性研究，不能替代独立 Holdout。`,
    },
    {
      kind: "LIMITATION",
      text:
        `12 因子中有 3 个（holdStreak / limitGap / preReturn10）的方向属「先验未验证」，占 3/12 权重；` +
        `limitGap 的 UNKNOWN 桶按契约排在最前，会被评为最低分。`,
    },
    {
      kind: "LIMITATION",
      text:
        `综合评分是加权和：因子互相掩蔽、分数区间被压缩、若阈值卡在综合分上则改动无法归因。` +
        `本版只做描述性统计与横向对比，**不做任何归因**；归因须走 PLAN-FACTOR-EXP-001 的 Phase 3/4。`,
    },
    {
      kind: "LIMITATION",
      text:
        `多重比较：${TOTAL_BUCKET_COUNT} 个桶 + ${DECILE_COUNT} 档 + 12 个 spread ≈ 90 个判定，` +
        `α=0.05 下假阳性期望 ≈ 4.5 ⇒ 所有结论只能声明为探索性。`,
    },
  ];
  if (
    decileSpreads12.verdict === "POSITIVE" &&
    decileSpearman !== null &&
    decileSpearman >= 0.6
  ) {
    observations.push({
      kind: "POTENTIAL_SIGNAL",
      text:
        `等权综合评分的头部档显著高于尾部档（差值区间不跨 0）且档序单调（ρ ≥ 0.6）。` +
        `⚠️ 这是**样本内**的探索性信号，桶边界本身取自同一批已读数据 ⇒ 不得表述为「有效区间」或「策略有效」。`,
    });
  } else {
    observations.push({
      kind: "LIMITATION",
      text:
        `未观察到「头部档显著高于尾部档且档序单调」的组合 —— 等权综合评分在本样本上` +
        `**未显示出可用梯度**（详见十分位表的三态判定）。`,
    });
  }

  const customPayload: TwelveFactorCompositePayload = {
    computationVersion: COMPUTATION_VERSION,
    bucketContractId: BUCKET_CONTRACT_ID,
    coordinate: {
      entryDay: ENTRY_DAY,
      primaryHoldingDay: PRIMARY_HOLDING_DAY,
      exitRelativeDay: EXIT_RELATIVE_DAY,
      maxRelativeDay: MAX_RELATIVE_DAY,
      roundTripCostBps: ROUND_TRIP_COST_BPS,
    },
    factorContract: TWELVE_FACTOR_DEFINITIONS.map(definition => ({
      code: definition.code,
      label: definition.label,
      source: definition.source,
      orientation: definition.orientation,
      priorVerified: definition.priorVerified,
      bucketCount: definition.buckets.length,
      weight: WEIGHT_PER_FACTOR,
    })),
    composite: {
      definition: "composite = (1/12) · Σ orientedScore_f；orientedScore = o_f===+1 ? (idx+0.5)/k : 1−(idx+0.5)/k",
      weightPerFactor: WEIGHT_PER_FACTOR,
      totalBucketCount: TOTAL_BUCKET_COUNT,
      minBucketSample: MIN_BUCKET_SAMPLE,
      decileCount: DECILE_COUNT,
      decileSpread: round(decileSpreads12.spread ?? 0),
      decileSpreadCi95Low:
        decileSpreads12.ciLow === null ? null : round(decileSpreads12.ciLow),
      decileSpreadCi95High:
        decileSpreads12.ciHigh === null ? null : round(decileSpreads12.ciHigh),
      decileSpreadVerdict: decileSpreads12.verdict,
      decileSpearman: decileSpearman === null ? null : round(decileSpearman),
      quintileSpearman:
        quintileSpearman === null ? null : round(quintileSpearman),
      verifiedOnlySpread:
        decileSpreads9.spread === null ? null : round(decileSpreads9.spread),
      verifiedOnlySpearman:
        decileSpearman9 === null ? null : round(decileSpearman9),
      verifiedOnlyFactorCount: VERIFIED_FACTOR_CODES.length,
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      eligibleCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      compositeUnavailableCount,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
      crossSectionPeerCount: args.crossSectionPeerCount,
      prefixWindowMissingCount: args.prefixWindowMissingCount,
      factorMissingByCode: { ...args.factorMissingByCode },
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "桶边界 / 方向表 / 权重全部来自 FROZEN-BUCKET-CONTRACT-001，实验内没有任何边界搜索或权重优化。",
      "综合评分使用完备用例（12 因子全部可得）；缺失不插补、不填 0。",
      "单因子分桶表是在本 Run 的样本上重算的，未直接引用其它实验的历史数字（窗口与入场不同，直接并列不可比）。",
      "结论限定：v5 窗口（2018-12-31 ~ 2026-09-03）；探索性；非 OOS。",
    ],
  };

  const decileTableRows: GroupRow[] = decileRows12;
  const quintileTableRows: GroupRow[] = quintileRows12;
  const verifiedOnlyRows: GroupRow[] = decileRows9;

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount,
      excludedCount,
      excludedByReason: { ...args.excludedByReason },
      notes: [
        `eligible = 通过全部过滤且 12 因子完备用例，入场 T+${ENTRY_DAY} 开盘、退出 T+${EXIT_RELATIVE_DAY} 收盘（或其后第一个可卖收盘）。`,
        `成本 = 往返 ${ROUND_TRIP_COST_BPS} bps。`,
        "同一因子缺少值时只从该因子的分桶中剔除；综合评分要求 12 因子全部非缺失。",
      ],
    },
    statistics: [
      {
        code: "trade_count",
        label: "完备用例交易",
        value: eligibleCount,
        unit: "条",
        digits: 0,
      },
      {
        code: "composite_asset_count",
        label: "综合评分可用",
        value: entries12.length,
        unit: "条",
        digits: 0,
      },
      {
        code: "decile_spread",
        label: "D10 − D1 净收益差",
        value: round(decileSpreads12.spread ?? 0),
        unit: "比例",
        digits: 6,
      },
      {
        code: "decile_spearman",
        label: "十分位 Spearman ρ",
        value: round(decileSpearman ?? 0),
        unit: "—",
        digits: 6,
      },
      {
        code: "verified_only_spread",
        label: `${VERIFIED_FACTOR_CODES.length} 因子子评分 D10 − D1`,
        value: round(decileSpreads9.spread ?? 0),
        unit: "比例",
        digits: 6,
      },
      {
        code: "bucket_count_total",
        label: "契约桶总数",
        value: TOTAL_BUCKET_COUNT,
        unit: "个",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "composite_decile",
        title: `综合评分十分位（入场 T+${ENTRY_DAY} 开盘 → 退出 T+${EXIT_RELATIVE_DAY} 收盘）`,
        description:
          "D1 = composite 最低档，D10 = 最高档；档位按样本内秩等份，**不是**契约 §2 的冻结桶。",
        columns: [...GROUP_COLUMNS],
        rows: decileTableRows,
      },
      {
        key: "composite_quintile",
        title: "综合评分五分位（单调性稳健性对照）",
        description: "用于核对十分位读出的单调性是否被档数选择放大。",
        columns: [...GROUP_COLUMNS],
        rows: quintileTableRows,
      },
      {
        key: "verified_only_decile",
        title: `对照变体：剔除 3 个「先验未验证」因子后的 ${VERIFIED_FACTOR_CODES.length} 因子子评分十分位`,
        description:
          "与主输出同一切档法；用于判断信号是否来自那 3 个未验证方向的因子。",
        columns: [...GROUP_COLUMNS],
        rows: verifiedOnlyRows,
      },
      {
        key: "single_factor_buckets",
        title: "12 因子冻结分桶（同一份样本重算，供横向比较）",
        description:
          `共 ${TOTAL_BUCKET_COUNT} 个桶，边界与方向来自 FROZEN-BUCKET-CONTRACT-001；` +
          "桶序 = 契约升序；bucketScore = (idx+0.5)/k；orientedScore 为施加方向后的分数。",
        columns: [
          { key: "factorLabel", label: "因子", align: "LEFT" },
          { key: "bucket", label: "分桶", align: "LEFT" },
          { key: "bucketIndex", label: "桶序", align: "RIGHT" },
          {
            key: "bucketScore",
            label: "桶位分",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "orientedScore",
            label: "方向分",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          { key: "priorVerified", label: "方向置信", align: "LEFT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "meanFactorValue",
            label: "因子均值",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanNetReturn",
            label: "平均净收益",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianNetReturn",
            label: "中位净收益",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "winRateNet",
            label: "净胜率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrapCi95Low",
            label: "聚类CI95下界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrapCi95High",
            label: "聚类CI95上界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          { key: "verdict", label: "三态判定", align: "LEFT" },
        ],
        rows: bucketRows,
      },
      {
        key: "cross_comparison",
        title: "横向比较：综合评分 vs 12 个单因子（FBC-5）",
        description:
          "spread = 可用桶（样本 ≥ 100）中「最大均值 − 最小均值」；spread CI 由两臂独立块重采样得到。" +
          "最后一行是综合评分自身（用十分位代替桶）。",
        columns: [
          { key: "factorLabel", label: "因子 / 综合", align: "LEFT" },
          { key: "priorVerified", label: "方向置信", align: "LEFT" },
          { key: "bucketCount", label: "桶数", align: "RIGHT" },
          { key: "usableBucketCount", label: "可用桶数", align: "RIGHT" },
          { key: "bestBucket", label: "最优桶", align: "LEFT" },
          { key: "worstBucket", label: "最差桶", align: "LEFT" },
          {
            key: "bestBucketMean",
            label: "最优桶均值",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "worstBucketMean",
            label: "最差桶均值",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "spreadSingle",
            label: "spread",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "spreadCi95Low",
            label: "spread CI95 下界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "spreadCi95High",
            label: "spread CI95 上界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          { key: "spreadVerdict", label: "三态判定", align: "LEFT" },
          { key: "originalFinding", label: "原实验已冻结结论（定性）", align: "LEFT" },
        ],
        rows: [...crossComparisonRows, summaryComparisonRow],
      },
    ],
    customPayload,
  };
}
