import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import {
  movingBlockBootstrapMean,
  type DateClusterValue,
} from "../../shared/dateClusterBootstrap";
import {
  BUCKET_CONTRACT_ID,
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  ROUND_TRIP_COST_BPS,
  TWELVE_FACTOR_CODES,
  TWELVE_FACTOR_DEFINITIONS,
  VERIFIED_FACTOR_CODES,
  compositeScoreOf,
  orientedScoreOf,
  type TwelveFactorCode,
  type TwelveFactorSample,
  type Verdict,
} from "../twelve-factor-composite-study/result";

/**
 * 十二因子综合评分的 **Top-N 排名可用性**研究。
 *
 * ## 这个实验回答的唯一问题
 *
 * 「这个评分到底能不能帮助我每天从首板股票里挑出前几名？」
 *
 * 「等权综合评分」实验（`twelve-factor-composite-study`）回答的是
 * 「评分分档与净收益有没有梯度」——那是**全样本分档**的问题。
 * 每天实际要做的动作是**横截面排序取头部**，这是一个不同的问题：
 *
 * - 分档看的是「档均值是否单调」；
 * - Top-N 看的是「头部 N 个相对**当日全部候选**有没有优势」。
 *
 * 一个评分完全可以在分档上有单调梯度、却在 Top-N 上毫无优势
 * （例如梯度只体现在尾部，或者头部与中部的差距小于日内噪声）。
 *
 * ## 判据（主判据只有一条）
 *
 * ```
 * 对每个决策日 d：excess_d = mean(topN_d) − mean(pool_d)      （同日、同坐标、配对）
 * 主指标 excessMean = mean_d(excess_d)，日期聚类 Moving-Block Bootstrap 95% CI
 * ```
 *
 * 🔴 「相对当日池（= 随机 N 的期望）有没有正超额」才是「能不能帮我挑」。
 *    「Top-N 绝对收益 > 0」是**另一个**问题（即使超额为正，绝对收益也可能为负
 *    ⇒ 这个评分也不能单独当多头策略用），报告里两条分开给。
 *
 * ## 冻结口径（本文件一律不重估）
 *
 * - 因子定义 / 桶边界 / 方向 / 权重：全部 import 自 `./../twelve-factor-composite-study/result`
 *   —— 那份文件是 `FROZEN-BUCKET-CONTRACT-001` 在代码里的唯一落地处，本实验**零改动**；
 * - 样本派生（入场/退出/成本/入池条件）：import 自同一目录的 `derive.ts`，与 12F 实验共用同一实现；
 * - 本实验**只新增**「按 eventDate 分组 → 按评分降序取前 N → 与当日池配对」这一层。
 *
 * ## 刻意不做
 *
 * - 不做权重优化、不重估桶边界、不做因子选择、不做参数搜索；
 * - 不做 OOS / Holdout（`researchPhase = EXPLORATORY`）；
 * - 不做任何归因（「为什么头部好」不在本实验范围内）。
 */

export const COMPUTATION_VERSION = "1.0.0";
/** 本实验自己的契约编号（排名口径），与 FBC-001（分桶口径）区分。 */
export const RANKING_CONTRACT_ID = "TOPN-RANKING-001";

/** 固定档 N。`Top-1` 是「挑出第一名」的最纯形式，必须在内。 */
export const TOP_N_SPECS = [
  { id: "N1", label: "Top-1", ratio: 0, fixedSize: 1 },
  { id: "N2", label: "Top-2", ratio: 0, fixedSize: 2 },
  { id: "N3", label: "Top-3", ratio: 0, fixedSize: 3 },
  { id: "N5", label: "Top-5", ratio: 0, fixedSize: 5 },
  { id: "N10", label: "Top-10", ratio: 0, fixedSize: 10 },
  { id: "P20", label: "Top-20%", ratio: 0.2, fixedSize: null },
] as const;

/** 深度曲线 K 的范围（综合评分，固定日集）。 */
export const DEPTH_CURVE_MIN_N = 1;
export const DEPTH_CURVE_MAX_N = 20;

/** `DEEP` 日集门槛：当日可用样本 ≥ 此值才纳入 ⇒ 所有 N 共用同一日集，可横向比较。 */
export const DEEP_DAY_MIN_SIZE = 10;

export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_926;
export const RANDOM_SIMULATIONS = 1_000;
export const RANDOM_SEED = 20_260_927;

/** 判定所需的最少**决策日**数（单位是日，不是样本）。 */
export const MIN_DAY_COUNT = 100;

/** 与 12F 实验对照用的参照样本账（同一 Dataset v5）——只作自检与披露，不作为断言。 */
export const REFERENCE_CANDIDATE_COUNT = 73_003;
export const REFERENCE_ELIGIBLE_COUNT = 70_236;

export const DAY_SCOPES = ["OWN", "DEEP"] as const;
export type DayScope = (typeof DAY_SCOPES)[number];

export const DAY_SCOPE_LABELS: Readonly<Record<DayScope, string>> = {
  OWN: `本职日集（当日样本 ≥ 该档所需 N）`,
  DEEP: `固定日集（当日样本 ≥ ${DEEP_DAY_MIN_SIZE}）`,
};

export type VerdictOfRanking = Verdict;

// ---------------------------------------------------------------------------
// 排名键（综合评分 + 2 个变体 + 12 个单因子）
// ---------------------------------------------------------------------------

export interface RankingKey {
  key: string;
  label: string;
  kind: "composite" | "composite_verified9" | "composite_reversed" | "single_factor";
  factorCode: TwelveFactorCode | null;
  note: string;
}

export const COMPOSITE_RANKING_KEY = "composite";
export const COMPOSITE_VERIFIED9_RANKING_KEY = "composite_verified9";
export const COMPOSITE_REVERSED_RANKING_KEY = "composite_reversed";

export const RANKING_KEYS: readonly RankingKey[] = [
  {
    key: COMPOSITE_RANKING_KEY,
    label: "综合评分（12 因子等权，降序）",
    kind: "composite",
    factorCode: null,
    note: "FROZEN-BUCKET-CONTRACT-001 的等权合成分；本实验的主角。",
  },
  {
    key: COMPOSITE_VERIFIED9_RANKING_KEY,
    label: "综合评分 · 9 已验证因子子评分（降序）",
    kind: "composite_verified9",
    factorCode: null,
    note: "剔除 3 个「先验未验证方向」因子后的子评分，用于看那 3/12 权重是帮忙还是添噪。",
  },
  {
    key: COMPOSITE_REVERSED_RANKING_KEY,
    label: "综合评分反转（取最低分，对照臂）",
    kind: "composite_reversed",
    factorCode: null,
    note: "对称性检验：若评分有区分度，「最差 N 个」应显著弱于当日池。",
  },
  ...TWELVE_FACTOR_DEFINITIONS.map(
    (definition): RankingKey => ({
      key: `factor:${definition.code}`,
      label: `单因子 · ${definition.label}（桶位分，降序）`,
      kind: "single_factor",
      factorCode: definition.code,
      note:
        `来源 ${definition.source}；方向 o=${definition.orientation}` +
        `${definition.priorVerified ? "" : "（先验未验证方向）"}。`,
    })
  ),
];

export const SINGLE_FACTOR_RANKING_KEYS: readonly RankingKey[] =
  RANKING_KEYS.filter(item => item.kind === "single_factor");

/** 桶词表指纹 —— 证明「本次 Run 读到的桶边界/方向与契约一致」可被事后审计。 */
export function bucketFingerprintOf(): string {
  const canonical = TWELVE_FACTOR_DEFINITIONS.map(
    definition =>
      `${definition.code}|${definition.orientation}|${definition.priorVerified ? 1 : 0}|` +
      definition.buckets.join(",")
  ).join(";");
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
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

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 三态判定。`unitCount` = 决策日数 ⇒ 样本不足由日数门槛把关。 */
function verdictOf(args: {
  unitCount: number;
  ciLow: number | null;
  ciHigh: number | null;
}): Verdict {
  if (args.unitCount < MIN_DAY_COUNT) return "INSUFFICIENT";
  if (args.ciLow === null || args.ciHigh === null) return "INSUFFICIENT";
  if (args.ciLow > 0) return "POSITIVE";
  if (args.ciHigh < 0) return "NEGATIVE";
  return "INCONCLUSIVE";
}

function bootstrapOf(
  values: readonly DateClusterValue[],
  seed: number
): { low: number; high: number } | null {
  const result = movingBlockBootstrapMean({
    samples: values,
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_DAYS,
    seed,
  });
  return result === null ? null : { low: result.low, high: result.high };
}

// ---------------------------------------------------------------------------
// 日分组与取头
// ---------------------------------------------------------------------------

interface RankedSample {
  sample: TwelveFactorSample;
  score: number;
}

interface DayGroup {
  date: string;
  year: number;
  /** 该 key 下当日本实验可评分的全部样本（= 配对基线池）。 */
  pool: readonly TwelveFactorSample[];
  /** 按名次排序后的样本；`descending=false` 时为升序（反转臂）。 */
  ranked: readonly TwelveFactorSample[];
}

function scoreOfKey(
  key: RankingKey,
  sample: TwelveFactorSample
): number | null {
  if (key.kind === "composite") {
    return compositeScoreOf(sample.factors, TWELVE_FACTOR_CODES);
  }
  if (key.kind === "composite_verified9") {
    return compositeScoreOf(sample.factors, VERIFIED_FACTOR_CODES);
  }
  if (key.kind === "composite_reversed") {
    return compositeScoreOf(sample.factors, TWELVE_FACTOR_CODES);
  }
  if (key.factorCode === null) return null;
  return orientedScoreOf(key.factorCode, sample.factors[key.factorCode] ?? null);
}

function buildDays(args: {
  samples: readonly TwelveFactorSample[];
  key: RankingKey;
}): { days: DayGroup[]; unscoreableCount: number } {
  const byDate = new Map<string, TwelveFactorSample[]>();
  for (const sample of args.samples) {
    const bucket = byDate.get(sample.eventDate) ?? [];
    bucket.push(sample);
    byDate.set(sample.eventDate, bucket);
  }
  const descending = args.key.kind !== "composite_reversed";
  let unscoreableCount = 0;
  const days: DayGroup[] = [];
  for (const [date, samples] of byDate) {
    const ranked: RankedSample[] = [];
    for (const sample of samples) {
      const score = scoreOfKey(args.key, sample);
      if (score === null) {
        unscoreableCount += 1;
        continue;
      }
      ranked.push({ sample, score });
    }
    if (ranked.length === 0) continue;
    ranked.sort((left, right) => {
      if (left.score !== right.score) {
        return descending ? right.score - left.score : left.score - right.score;
      }
      return left.sample.eventId.localeCompare(right.sample.eventId);
    });
    days.push({
      date,
      year: samples[0]!.year,
      pool: ranked.map(item => item.sample),
      ranked: ranked.map(item => item.sample),
    });
  }
  days.sort((left, right) => left.date.localeCompare(right.date));
  return { days, unscoreableCount };
}

/** 某一档在该日实际取几个（比例档按当日样本量取整，至少 1 个）。 */
function sizeOf(spec: (typeof TOP_N_SPECS)[number], daySize: number): number {
  if (spec.fixedSize !== null) return Math.min(spec.fixedSize, daySize);
  return Math.max(1, Math.round(daySize * spec.ratio));
}

function minDaySizeOf(spec: (typeof TOP_N_SPECS)[number]): number {
  return spec.fixedSize ?? 1;
}

// ---------------------------------------------------------------------------
// 逐档评估
// ---------------------------------------------------------------------------

export interface DayPoint {
  date: string;
  value: number;
}

export interface GroupStats {
  daysIncluded: number;
  daysExcludedSmall: number;
  picks: number;
  picksPerDayMedian: number | null;
  portfolioMean: number | null;
  portfolioCi95Low: number | null;
  portfolioCi95High: number | null;
  portfolioVerdict: Verdict;
  poolMean: number | null;
  poolCi95Low: number | null;
  poolCi95High: number | null;
  poolVerdict: Verdict;
  excessMean: number | null;
  excessCi95Low: number | null;
  excessCi95High: number | null;
  excessVerdict: Verdict;
  dayWinRate: number | null;
  pickHitRate: number | null;
  poolHitRate: number | null;
}

function evaluateGroup(args: {
  days: readonly DayGroup[];
  sizeOfDay: (daySize: number) => number;
  /** 纳入门槛：当日可用样本 ≥ 该值。 */
  minDaySize: number;
  seed: number;
}): GroupStats {
  const included = args.days.filter(day => day.pool.length >= args.minDaySize);
  const portfolioSeries: DateClusterValue[] = [];
  const excessSeries: DateClusterValue[] = [];
  const poolSeries: DateClusterValue[] = [];
  const daySizes: number[] = [];
  let picks = 0;
  let pickWins = 0;
  let poolCount = 0;
  let poolWins = 0;

  for (const day of included) {
    const size = args.sizeOfDay(day.pool.length);
    const head = day.ranked.slice(0, size);
    if (head.length === 0) continue;
    let headSum = 0;
    for (const sample of head) {
      headSum += sample.netReturn;
      picks += 1;
      if (sample.netReturn > 0) pickWins += 1;
    }
    let poolSum = 0;
    for (const sample of day.pool) {
      poolSum += sample.netReturn;
      poolCount += 1;
      if (sample.netReturn > 0) poolWins += 1;
    }
    const headMean = headSum / head.length;
    const poolMean = poolSum / day.pool.length;
    portfolioSeries.push({ eventDate: day.date, value: headMean });
    poolSeries.push({ eventDate: day.date, value: poolMean });
    excessSeries.push({ eventDate: day.date, value: headMean - poolMean });
    daySizes.push(day.pool.length);
  }

  const portfolioCi = bootstrapOf(portfolioSeries, args.seed);
  const poolCi = bootstrapOf(poolSeries, args.seed + 1_000);
  const excessCi = bootstrapOf(excessSeries, args.seed + 2_000);
  const daysIncluded = portfolioSeries.length;
  const portfolioMean = meanOf(portfolioSeries.map(item => item.value));
  const poolMean = meanOf(poolSeries.map(item => item.value));
  const excessMean = meanOf(excessSeries.map(item => item.value));
  const sortedDaySizes = [...daySizes].sort((a, b) => a - b);
  const dayWins = excessSeries.filter(item => item.value > 0).length;

  return {
    daysIncluded,
    daysExcludedSmall: args.days.length - included.length,
    picks,
    picksPerDayMedian: quantileOf(sortedDaySizes, 0.5),
    portfolioMean: portfolioMean === null ? null : round(portfolioMean),
    portfolioCi95Low: portfolioCi === null ? null : round(portfolioCi.low),
    portfolioCi95High: portfolioCi === null ? null : round(portfolioCi.high),
    portfolioVerdict: verdictOf({
      unitCount: daysIncluded,
      ciLow: portfolioCi?.low ?? null,
      ciHigh: portfolioCi?.high ?? null,
    }),
    poolMean: poolMean === null ? null : round(poolMean),
    poolCi95Low: poolCi === null ? null : round(poolCi.low),
    poolCi95High: poolCi === null ? null : round(poolCi.high),
    poolVerdict: verdictOf({
      unitCount: poolSeries.length,
      ciLow: poolCi?.low ?? null,
      ciHigh: poolCi?.high ?? null,
    }),
    excessMean: excessMean === null ? null : round(excessMean),
    excessCi95Low: excessCi === null ? null : round(excessCi.low),
    excessCi95High: excessCi === null ? null : round(excessCi.high),
    excessVerdict: verdictOf({
      unitCount: daysIncluded,
      ciLow: excessCi?.low ?? null,
      ciHigh: excessCi?.high ?? null,
    }),
    dayWinRate:
      daysIncluded === 0 ? null : round(dayWins / daysIncluded),
    pickHitRate: picks === 0 ? null : round(pickWins / picks),
    poolHitRate: poolCount === 0 ? null : round(poolWins / poolCount),
  };
}

// ---------------------------------------------------------------------------
// 随机 N 基准（Monte-Carlo：给定当日候选池，随机抽同样多的股票）
// ---------------------------------------------------------------------------

export interface RandomBenchmark {
  size: string;
  simulations: number;
  daysIncluded: number;
  randomMean: number | null;
  randomP5: number | null;
  randomP50: number | null;
  randomP95: number | null;
  observed: number | null;
  observedPercentile: number | null;
  impliedPValue: number | null;
}

/**
 * 随机 N 的**期望**恒等于当日池均值（无偏），所以「超额」本身就是
 * 「相对随机 N 的平均优势」。这里额外用 Monte-Carlo 给出随机 N 估计量的
 * **抽样分布**，把观测到的组合均值换成「落在随机分布的哪个分位」——
 * 这是对「这点优势会不会只是抽签运气」最直观的回答。
 *
 * ⚠️ 口径披露：该检验是**条件于已实现样本**的置换型检验，不处理时间相关性；
 * 时间相关性由主指标的日期聚类 Moving-Block Bootstrap 处理。
 */
function randomBenchmarkOf(args: {
  days: readonly DayGroup[];
  sizeOfDay: (daySize: number) => number;
  minDaySize: number;
  observed: number | null;
  simulations: number;
  seed: number;
}): RandomBenchmark {
  const included = args.days.filter(day => day.pool.length >= args.minDaySize);
  const returnsByDay = included.map(day =>
    day.pool.map(sample => sample.netReturn)
  );
  const sizes = included.map(day => args.sizeOfDay(day.pool.length));
  const maxDaySize = returnsByDay.reduce(
    (max, values) => Math.max(max, values.length),
    0
  );
  const random = mulberry32(args.seed);
  const scratch = new Int32Array(Math.max(1, maxDaySize));
  const simulated: number[] = [];

  for (let simulation = 0; simulation < args.simulations; simulation += 1) {
    let total = 0;
    let counted = 0;
    for (let dayIndex = 0; dayIndex < returnsByDay.length; dayIndex += 1) {
      const values = returnsByDay[dayIndex]!;
      const size = sizes[dayIndex]!;
      const length = values.length;
      if (size >= length) {
        let sum = 0;
        for (const value of values) sum += value;
        total += sum / length;
        counted += 1;
        continue;
      }
      for (let index = 0; index < length; index += 1) scratch[index] = index;
      for (let index = 0; index < size; index += 1) {
        const swap = index + Math.floor(random() * (length - index));
        const held = scratch[index]!;
        scratch[index] = scratch[swap]!;
        scratch[swap] = held;
      }
      let sum = 0;
      for (let index = 0; index < size; index += 1) {
        sum += values[scratch[index]!]!;
      }
      total += sum / size;
      counted += 1;
    }
    if (counted === 0) {
      simulated.push(0);
      continue;
    }
    simulated.push(total / counted);
  }

  simulated.sort((a, b) => a - b);
  const observed = args.observed;
  let below = 0;
  let atOrAbove = 0;
  if (observed !== null) {
    for (const value of simulated) {
      if (value < observed) below += 1;
      else atOrAbove += 1;
    }
  }
  return {
    size: "",
    simulations: args.simulations,
    daysIncluded: included.length,
    randomMean: meanOf(simulated) === null ? null : round(meanOf(simulated)!),
    randomP5: quantileOf(simulated, 0.05) === null ? null : round(quantileOf(simulated, 0.05)!),
    randomP50: quantileOf(simulated, 0.5) === null ? null : round(quantileOf(simulated, 0.5)!),
    randomP95: quantileOf(simulated, 0.95) === null ? null : round(quantileOf(simulated, 0.95)!),
    observed: observed === null ? null : round(observed),
    observedPercentile:
      observed === null || simulated.length === 0
        ? null
        : round(below / simulated.length),
    impliedPValue:
      observed === null || simulated.length === 0
        ? null
        : round(atOrAbove / simulated.length),
  };
}

// ---------------------------------------------------------------------------
// 结果结构
// ---------------------------------------------------------------------------

export interface TopNRow extends GroupStats {
  key: string;
  keyLabel: string;
  size: string;
  sizeLabel: string;
  scope: DayScope;
}

export interface DepthCurveRow {
  k: number;
  daysIncluded: number;
  portfolioMean: number | null;
  excessMean: number | null;
  excessCi95Low: number | null;
  excessCi95High: number | null;
  excessVerdict: Verdict;
  dayWinRate: number | null;
  pickHitRate: number | null;
}

export interface YearlyRow {
  year: number;
  size: string;
  daysIncluded: number;
  portfolioMean: number | null;
  excessMean: number | null;
  excessCi95Low: number | null;
  excessCi95High: number | null;
  excessVerdict: Verdict;
}

export interface KeyRow {
  key: string;
  keyLabel: string;
  size: string;
  scope: DayScope;
  daysIncluded: number;
  excessMean: number | null;
  excessCi95Low: number | null;
  excessCi95High: number | null;
  excessVerdict: Verdict;
  dayWinRate: number | null;
  pickHitRate: number | null;
}

export interface DaySizeBucket {
  bucket: string;
  days: number;
  share: number;
}

export interface DayDiagnostics {
  daysTotal: number;
  daysAtLeast1: number;
  daysAtLeast2: number;
  daysAtLeast3: number;
  daysAtLeast5: number;
  daysAtLeast10: number;
  daysAtLeast20: number;
  daySizeMin: number | null;
  daySizeP5: number | null;
  daySizeP25: number | null;
  daySizeP50: number | null;
  daySizeP75: number | null;
  daySizeP95: number | null;
  daySizeMax: number | null;
  daySizeMean: number | null;
  daySizeHistogram: DaySizeBucket[];
}

const verdictSchema = z.enum(["POSITIVE", "NEGATIVE", "INCONCLUSIVE", "INSUFFICIENT"]);
const nullableNumber = z.number().nullable();

const groupStatsShape = {
  daysIncluded: z.number().int().nonnegative(),
  daysExcludedSmall: z.number().int().nonnegative(),
  picks: z.number().int().nonnegative(),
  picksPerDayMedian: nullableNumber,
  portfolioMean: nullableNumber,
  portfolioCi95Low: nullableNumber,
  portfolioCi95High: nullableNumber,
  portfolioVerdict: verdictSchema,
  poolMean: nullableNumber,
  poolCi95Low: nullableNumber,
  poolCi95High: nullableNumber,
  poolVerdict: verdictSchema,
  excessMean: nullableNumber,
  excessCi95Low: nullableNumber,
  excessCi95High: nullableNumber,
  excessVerdict: verdictSchema,
  dayWinRate: nullableNumber,
  pickHitRate: nullableNumber,
  poolHitRate: nullableNumber,
} as const;

export const topNRankingSchema = z.object({
  computationVersion: z.string().min(1),
  rankingContractId: z.string().min(1),
  bucketContractId: z.string().min(1),
  bucketFingerprint: z.string().min(1),
  coordinate: z.object({
    entryDay: z.number().int(),
    exitRelativeDay: z.number().int(),
    roundTripCostBps: z.number(),
    decisionOffsetDays: z.number().int(),
  }),
  dayGrouping: z.object({
    unit: z.string().min(1),
    deepDayMinSize: z.number().int(),
    minDayCount: z.number().int(),
    overlapDisclosure: z.string().min(1),
    weightingDisclosure: z.string().min(1),
  }),
  rankingKeys: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      kind: z.string().min(1),
      factorCode: z.string().nullable(),
      note: z.string().min(1),
    })
  ),
  headline: z.array(
    z.object({
      key: z.string(),
      keyLabel: z.string(),
      size: z.string(),
      sizeLabel: z.string(),
      scope: z.enum(["OWN", "DEEP"]),
      ...groupStatsShape,
    })
  ),
  keyMatrix: z.array(
    z.object({
      key: z.string(),
      keyLabel: z.string(),
      size: z.string(),
      scope: z.enum(["OWN", "DEEP"]),
      daysIncluded: z.number().int(),
      excessMean: nullableNumber,
      excessCi95Low: nullableNumber,
      excessCi95High: nullableNumber,
      excessVerdict: verdictSchema,
      dayWinRate: nullableNumber,
      pickHitRate: nullableNumber,
    })
  ),
  depthCurve: z.array(
    z.object({
      k: z.number().int().positive(),
      daysIncluded: z.number().int(),
      portfolioMean: nullableNumber,
      excessMean: nullableNumber,
      excessCi95Low: nullableNumber,
      excessCi95High: nullableNumber,
      excessVerdict: verdictSchema,
      dayWinRate: nullableNumber,
      pickHitRate: nullableNumber,
    })
  ),
  randomBenchmark: z.array(
    z.object({
      size: z.string(),
      simulations: z.number().int(),
      daysIncluded: z.number().int(),
      randomMean: nullableNumber,
      randomP5: nullableNumber,
      randomP50: nullableNumber,
      randomP95: nullableNumber,
      observed: nullableNumber,
      observedPercentile: nullableNumber,
      impliedPValue: nullableNumber,
    })
  ),
  yearly: z.array(
    z.object({
      year: z.number().int(),
      size: z.string(),
      daysIncluded: z.number().int(),
      portfolioMean: nullableNumber,
      excessMean: nullableNumber,
      excessCi95Low: nullableNumber,
      excessCi95High: nullableNumber,
      excessVerdict: verdictSchema,
    })
  ),
  dayDiagnostics: z.object({
    daysTotal: z.number().int().nonnegative(),
    daysAtLeast1: z.number().int().nonnegative(),
    daysAtLeast2: z.number().int().nonnegative(),
    daysAtLeast3: z.number().int().nonnegative(),
    daysAtLeast5: z.number().int().nonnegative(),
    daysAtLeast10: z.number().int().nonnegative(),
    daysAtLeast20: z.number().int().nonnegative(),
    daySizeMin: nullableNumber,
    daySizeP5: nullableNumber,
    daySizeP25: nullableNumber,
    daySizeP50: nullableNumber,
    daySizeP75: nullableNumber,
    daySizeP95: nullableNumber,
    daySizeMax: nullableNumber,
    daySizeMean: nullableNumber,
    daySizeHistogram: z.array(
      z.object({
        bucket: z.string().min(1),
        days: z.number().int().nonnegative(),
        share: z.number(),
      })
    ),
  }),
  referenceCheck: z.object({
    referenceCandidateCount: z.number().int(),
    actualCandidateCount: z.number().int(),
    matchesCandidateCount: z.boolean(),
    referenceEligibleCount: z.number().int(),
    actualEligibleCount: z.number().int(),
    matchesEligibleCount: z.boolean(),
    referenceExperimentId: z.string().min(1),
  }),
  disclosures: z.array(z.string().min(1)),
});

export type TopNRankingPayload = z.infer<typeof topNRankingSchema>;

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

export interface AssembleTopNRankingArgs {
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
}

function tableColumn(
  key: string,
  label: string,
  digits: number | null = null
): { key: string; label: string; digits?: number; align?: "LEFT" | "RIGHT" } {
  return digits === null
    ? { key, label, align: "LEFT" }
    : { key, label, digits, align: "RIGHT" };
}

function rowOf(row: TopNRow): Record<string, string | number | boolean | null> {
  return {
    key: row.key,
    keyLabel: row.keyLabel,
    size: row.sizeLabel,
    scope: row.scope,
    daysIncluded: row.daysIncluded,
    daysExcludedSmall: row.daysExcludedSmall,
    picks: row.picks,
    picksPerDayMedian: row.picksPerDayMedian,
    portfolioMean: row.portfolioMean,
    portfolioCi95Low: row.portfolioCi95Low,
    portfolioCi95High: row.portfolioCi95High,
    portfolioVerdict: row.portfolioVerdict,
    poolMean: row.poolMean,
    excessMean: row.excessMean,
    excessCi95Low: row.excessCi95Low,
    excessCi95High: row.excessCi95High,
    excessVerdict: row.excessVerdict,
    dayWinRate: row.dayWinRate,
    pickHitRate: row.pickHitRate,
    poolHitRate: row.poolHitRate,
  };
}

function computeDayDiagnostics(
  samples: readonly TwelveFactorSample[]
): DayDiagnostics {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    counts.set(sample.eventDate, (counts.get(sample.eventDate) ?? 0) + 1);
  }
  const sizes = [...counts.values()].sort((a, b) => a - b);
  const atLeast = (threshold: number): number =>
    sizes.filter(size => size >= threshold).length;
  const edges: Array<{ label: string; from: number; to: number | null }> = [
    { label: "1", from: 1, to: 1 },
    { label: "2-3", from: 2, to: 3 },
    { label: "4-5", from: 4, to: 5 },
    { label: "6-10", from: 6, to: 10 },
    { label: "11-20", from: 11, to: 20 },
    { label: "21-40", from: 21, to: 40 },
    { label: "41-80", from: 41, to: 80 },
    { label: "81+", from: 81, to: null },
  ];
  const histogram: DaySizeBucket[] = edges.map(edge => {
    const days = sizes.filter(
      size => size >= edge.from && (edge.to === null || size <= edge.to)
    ).length;
    return {
      bucket: edge.label,
      days,
      share: sizes.length === 0 ? 0 : round(days / sizes.length),
    };
  });
  return {
    daysTotal: sizes.length,
    daysAtLeast1: atLeast(1),
    daysAtLeast2: atLeast(2),
    daysAtLeast3: atLeast(3),
    daysAtLeast5: atLeast(5),
    daysAtLeast10: atLeast(10),
    daysAtLeast20: atLeast(20),
    daySizeMin: quantileOf(sizes, 0) === null ? null : round(quantileOf(sizes, 0)!),
    daySizeP5: quantileOf(sizes, 0.05) === null ? null : round(quantileOf(sizes, 0.05)!),
    daySizeP25: quantileOf(sizes, 0.25) === null ? null : round(quantileOf(sizes, 0.25)!),
    daySizeP50: quantileOf(sizes, 0.5) === null ? null : round(quantileOf(sizes, 0.5)!),
    daySizeP75: quantileOf(sizes, 0.75) === null ? null : round(quantileOf(sizes, 0.75)!),
    daySizeP95: quantileOf(sizes, 0.95) === null ? null : round(quantileOf(sizes, 0.95)!),
    daySizeMax: quantileOf(sizes, 1) === null ? null : round(quantileOf(sizes, 1)!),
    daySizeMean: meanOf(sizes) === null ? null : round(meanOf(sizes)!),
    daySizeHistogram: histogram,
  };
}

export function assembleTopNRanking(
  args: AssembleTopNRankingArgs
): ExperimentResultPayload {
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

  // ---- 每个排名键：建日分组 ----
  const daysByKey = new Map<string, DayGroup[]>();
  const unscoreableByKey = new Map<string, number>();
  for (const key of RANKING_KEYS) {
    const built = buildDays({ samples: args.samples, key });
    daysByKey.set(key.key, built.days);
    unscoreableByKey.set(key.key, built.unscoreableCount);
  }

  // ---- 主表：全 15 键 × 6 档 × 2 日集 ----
  const headline: TopNRow[] = [];
  const keyMatrix: KeyRow[] = [];
  let seedCursor = BOOTSTRAP_SEED;

  for (const key of RANKING_KEYS) {
    const days = daysByKey.get(key.key)!;
    for (const spec of TOP_N_SPECS) {
      for (const scope of DAY_SCOPES) {
        const minDaySize =
          scope === "DEEP" ? DEEP_DAY_MIN_SIZE : minDaySizeOf(spec);
        const stats = evaluateGroup({
          days,
          sizeOfDay: daySize => sizeOf(spec, daySize),
          minDaySize,
          seed: (seedCursor += 10),
        });
        headline.push({
          key: key.key,
          keyLabel: key.label,
          size: spec.id,
          sizeLabel: spec.label,
          scope,
          ...stats,
        });
        if (scope === "DEEP") {
          keyMatrix.push({
            key: key.key,
            keyLabel: key.label,
            size: spec.id,
            scope,
            daysIncluded: stats.daysIncluded,
            excessMean: stats.excessMean,
            excessCi95Low: stats.excessCi95Low,
            excessCi95High: stats.excessCi95High,
            excessVerdict: stats.excessVerdict,
            dayWinRate: stats.dayWinRate,
            pickHitRate: stats.pickHitRate,
          });
        }
      }
    }
  }

  // ---- 深度曲线：综合评分，固定日集，K = 1..20 ----
  const compositeDays = daysByKey.get(COMPOSITE_RANKING_KEY)!;
  const depthCurve: DepthCurveRow[] = [];
  for (let k = DEPTH_CURVE_MIN_N; k <= DEPTH_CURVE_MAX_N; k += 1) {
    const stats = evaluateGroup({
      days: compositeDays,
      sizeOfDay: daySize => Math.min(k, daySize),
      minDaySize: DEEP_DAY_MIN_SIZE,
      seed: BOOTSTRAP_SEED + 30_000 + k,
    });
    depthCurve.push({
      k,
      daysIncluded: stats.daysIncluded,
      portfolioMean: stats.portfolioMean,
      excessMean: stats.excessMean,
      excessCi95Low: stats.excessCi95Low,
      excessCi95High: stats.excessCi95High,
      excessVerdict: stats.excessVerdict,
      dayWinRate: stats.dayWinRate,
      pickHitRate: stats.pickHitRate,
    });
  }

  // ---- 随机 N 基准：只对综合评分（其它键的「随机期望」就等于当日池均值） ----
  const randomBenchmark: RandomBenchmark[] = [];
  for (const spec of TOP_N_SPECS) {
    const observed =
      headline.find(
        row =>
          row.key === COMPOSITE_RANKING_KEY &&
          row.size === spec.id &&
          row.scope === "OWN"
      )?.portfolioMean ?? null;
    const benchmark = randomBenchmarkOf({
      days: compositeDays,
      sizeOfDay: daySize => sizeOf(spec, daySize),
      minDaySize: minDaySizeOf(spec),
      observed,
      simulations: RANDOM_SIMULATIONS,
      seed: RANDOM_SEED + spec.id.length * 100 + minDaySizeOf(spec),
    });
    randomBenchmark.push({ ...benchmark, size: spec.id });
  }

  // ---- 年度稳定性：综合评分，4 档，本职日集 ----
  const yearly: YearlyRow[] = [];
  const years = [...new Set(args.samples.map(sample => sample.year))].sort(
    (a, b) => a - b
  );
  const yearlySpecs = TOP_N_SPECS.filter(spec =>
    ["N1", "N3", "N5", "N10"].includes(spec.id)
  );
  for (const year of years) {
    const yearDays = compositeDays.filter(day => day.year === year);
    for (const spec of yearlySpecs) {
      const stats = evaluateGroup({
        days: yearDays,
        sizeOfDay: daySize => sizeOf(spec, daySize),
        minDaySize: minDaySizeOf(spec),
        seed: BOOTSTRAP_SEED + 40_000 + year * 100 + minDaySizeOf(spec),
      });
      yearly.push({
        year,
        size: spec.id,
        daysIncluded: stats.daysIncluded,
        portfolioMean: stats.portfolioMean,
        excessMean: stats.excessMean,
        excessCi95Low: stats.excessCi95Low,
        excessCi95High: stats.excessCi95High,
        excessVerdict: stats.excessVerdict,
      });
    }
  }

  const dayDiagnostics = computeDayDiagnostics(args.samples);
  const bucketFingerprint = bucketFingerprintOf();

  const compositeOwn = headline.filter(
    row => row.key === COMPOSITE_RANKING_KEY && row.scope === "OWN"
  );
  const compositeDeep = headline.filter(
    row => row.key === COMPOSITE_RANKING_KEY && row.scope === "DEEP"
  );
  const deepN5 = headline.find(
    row =>
      row.key === COMPOSITE_RANKING_KEY &&
      row.size === "N5" &&
      row.scope === "DEEP"
  )!;
  const deepReversedN5 = headline.find(
    row =>
      row.key === COMPOSITE_REVERSED_RANKING_KEY &&
      row.size === "N5" &&
      row.scope === "DEEP"
  )!;
  const bestKeyAtN5 = [...keyMatrix]
    .filter(row => row.size === "N5")
    .sort((left, right) => (right.excessMean ?? -9) - (left.excessMean ?? -9))[0];
  const peakDepth = [...depthCurve].sort(
    (left, right) => (right.excessMean ?? -9) - (left.excessMean ?? -9)
  )[0];

  const disclosures = [
    "🔴 持仓重叠：本实验的持有期是 T+6 开盘 → T+10 收盘（5 个交易日），相邻决策日的持仓**互相重叠** ⇒ 「日度序列」不是独立观测。主指标的置信区间用日期聚类 Moving-Block Bootstrap（block = 20 交易日）吸收这一点，但**不得**把 N 个决策日当作 N 个独立实验。",
    "🔴 等权口径：组合日收益 = 当日 Top-N 的**等权**平均；主指标 = 各日组合收益的**等权**平均（每个决策日一单位资金，不做资金复利、不做现金管理、不设持仓上限）。这与「始终满仓滚动」的真实资金曲线不同。",
    "🔴 基准 = 当日池：配对基准是同一天**全部可用样本**的等权均值。随机抽 N 个的**期望**恒等于该值 ⇒ 「正超额」等价于「平均意义上优于随机抽签」。但 Top-N 相对随机 N 的优势**不是**策略的可交易收益 —— 两者都在同一成本口径下（20 bps 往返）。",
    "⚠️ 决策日 = 首板日 T（决策发生在 T+5 收盘）。同一天可能有多个首板事件，因此「每天挑前 N 名」就是「在每个 T 的横截面上按评分排序取头部」。",
    "⚠️ 比例档 Top-20% 的 N 随当日样本量浮动（至少 1 个），因此「固定日集」下的可比性最强；本职日集口径下各档的日集并不相同，跨档比较请以固定日集为准。",
    "⚠️ 多重比较：15 个排名键 × 6 档 × 2 日集 ≈ 180 个判定，α=0.05 下假阳性期望 ≈ 9 ⇒ 所有结论只能声明为**探索性**。",
    "⚠️ 本 Run 是 EXPLORATORY：桶边界与方向取自同一批已读数据（v2~v5），**不是 OOS**；本实验不构成「策略有效」的证据。",
    "⚠️ 因子定义 / 桶边界 / 方向 / 权重**零改动**：全部 import 自 twelve-factor-composite-study/result（FROZEN-BUCKET-CONTRACT-001 的唯一落地处）；样本派生与其共用 derive.ts。",
  ];

  const tables = [
    {
      key: "topn_headline",
      title: "主表 · 综合评分 Top-N（6 档 × 2 日集）",
      description:
        "portfolioMean = 组合日收益的等权均值（每决策日一单位资金）；excessMean = 同日相对当日池的超额均值（主判据）；两者都是日期聚类 Bootstrap 95% 区间。verdict：CI 下界>0 ⇒ POSITIVE，上界<0 ⇒ NEGATIVE，跨 0 ⇒ INCONCLUSIVE，日数<100 ⇒ INSUFFICIENT。",
      columns: [
        tableColumn("size", "档位"),
        tableColumn("scope", "日集"),
        tableColumn("daysIncluded", "纳入日数"),
        tableColumn("picks", "总共选出"),
        tableColumn("picksPerDayMedian", "日样本量中位"),
        tableColumn("portfolioMean", "组合日均收益", 6),
        tableColumn("poolMean", "当日池日均", 6),
        tableColumn("excessMean", "超额(日均)", 6),
        tableColumn("excessCi95Low", "超额CI下", 6),
        tableColumn("excessCi95High", "超额CI上", 6),
        tableColumn("excessVerdict", "超额判定"),
        tableColumn("portfolioVerdict", "绝对判定"),
        tableColumn("dayWinRate", "日胜率", 6),
        tableColumn("pickHitRate", "选中胜率", 6),
        tableColumn("poolHitRate", "池胜率", 6),
      ],
      rows: [...compositeOwn, ...compositeDeep].map(rowOf),
    },
    {
      key: "topn_key_matrix",
      title: "对照矩阵 · 15 个排名键 × 6 档（固定日集）",
      description:
        "同一份样本、同一坐标、同一成本，只把「排序依据」换掉。固定日集（当日样本≥10）下所有档共用同一批决策日 ⇒ 可横向比较。这是「综合评分 vs 单因子，谁更能帮我挑」的直接答案。",
      columns: [
        tableColumn("keyLabel", "排序依据"),
        tableColumn("size", "档位"),
        tableColumn("daysIncluded", "纳入日数"),
        tableColumn("excessMean", "超额(日均)", 6),
        tableColumn("excessCi95Low", "超额CI下", 6),
        tableColumn("excessCi95High", "超额CI上", 6),
        tableColumn("excessVerdict", "判定"),
        tableColumn("dayWinRate", "日胜率", 6),
        tableColumn("pickHitRate", "选中胜率", 6),
      ],
      rows: keyMatrix.map(row => ({
        key: row.key,
        keyLabel: row.keyLabel,
        size:
          TOP_N_SPECS.find(spec => spec.id === row.size)?.label ?? row.size,
        daysIncluded: row.daysIncluded,
        excessMean: row.excessMean,
        excessCi95Low: row.excessCi95Low,
        excessCi95High: row.excessCi95High,
        excessVerdict: row.excessVerdict,
        dayWinRate: row.dayWinRate,
        pickHitRate: row.pickHitRate,
      })),
    },
    {
      key: "topn_depth_curve",
      title: "深度曲线 · 综合评分「取前 K 名」的超额随 K 变化（固定日集）",
      description:
        "K = 1..20。曲线在第 1 名最高、随 K 增大衰减到 0 是「信号只在最头部」的特征；一开始就贴 0 说明头部没有优势；起点为负说明排序方向在头部失效。",
      columns: [
        tableColumn("k", "K"),
        tableColumn("daysIncluded", "纳入日数"),
        tableColumn("portfolioMean", "组合日均收益", 6),
        tableColumn("excessMean", "超额(日均)", 6),
        tableColumn("excessCi95Low", "超额CI下", 6),
        tableColumn("excessCi95High", "超额CI上", 6),
        tableColumn("excessVerdict", "判定"),
        tableColumn("dayWinRate", "日胜率", 6),
        tableColumn("pickHitRate", "选中胜率", 6),
      ],
      rows: depthCurve.map(row => ({ ...row })),
    },
    {
      key: "topn_random_benchmark",
      title: "随机 N 基准 · 综合评分档位在「随机抽签分布」中的分位",
      description:
        "给定当日候选池，随机抽同样多的股票并重复 1000 次（固定种子）。随机 N 的期望 = 当日池均值，因此超额为 0 的档位应落在 50 分位；impliedPValue = 模拟值 ≥ 观测值的比例（单侧）。",
      columns: [
        tableColumn("size", "档位"),
        tableColumn("daysIncluded", "纳入日数"),
        tableColumn("simulations", "模拟次数"),
        tableColumn("randomMean", "随机均值", 6),
        tableColumn("randomP5", "随机P5", 6),
        tableColumn("randomP50", "随机P50", 6),
        tableColumn("randomP95", "随机P95", 6),
        tableColumn("observed", "实际组合均值", 6),
        tableColumn("observedPercentile", "实际分位", 4),
        tableColumn("impliedPValue", "单侧p", 4),
      ],
      rows: randomBenchmark.map(row => ({
        size:
          TOP_N_SPECS.find(spec => spec.id === row.size)?.label ?? row.size,
        daysIncluded: row.daysIncluded,
        simulations: row.simulations,
        randomMean: row.randomMean,
        randomP5: row.randomP5,
        randomP50: row.randomP50,
        randomP95: row.randomP95,
        observed: row.observed,
        observedPercentile: row.observedPercentile,
        impliedPValue: row.impliedPValue,
      })),
    },
    {
      key: "topn_yearly",
      title: "年度切片 · 综合评分 Top-N 超额的逐年表现（描述性）",
      description:
        "⚠️ 单年日数远小于整体 ⇒ 这里的 CI 与判定只作为描述性参考，**不得**称为「稳健性检验」（窗口只有 v5 这一段，无法做真正的跨窗口验证）。",
      columns: [
        tableColumn("year", "年份"),
        tableColumn("size", "档位"),
        tableColumn("daysIncluded", "纳入日数"),
        tableColumn("portfolioMean", "组合日均收益", 6),
        tableColumn("excessMean", "超额(日均)", 6),
        tableColumn("excessCi95Low", "超额CI下", 6),
        tableColumn("excessCi95High", "超额CI上", 6),
        tableColumn("excessVerdict", "判定"),
      ],
      rows: yearly.map(row => ({
        year: row.year,
        size:
          TOP_N_SPECS.find(spec => spec.id === row.size)?.label ?? row.size,
        daysIncluded: row.daysIncluded,
        portfolioMean: row.portfolioMean,
        excessMean: row.excessMean,
        excessCi95Low: row.excessCi95Low,
        excessCi95High: row.excessCi95High,
        excessVerdict: row.excessVerdict,
      })),
    },
    {
      key: "topn_day_size",
      title: "决策日样本量分布（Top-N 可不可做的前提）",
      description:
        "「每天挑前 N 名」只有在当日候选足够多时才有意义。这里给出每个决策日可用样本数的分布与直方图。",
      columns: [
        tableColumn("bucket", "当日可用样本数"),
        tableColumn("days", "决策日数"),
        tableColumn("share", "占比", 6),
      ],
      rows: dayDiagnostics.daySizeHistogram.map(bucket => ({ ...bucket })),
    },
    {
      key: "topn_day_size_summary",
      title: "决策日样本量摘要",
      description: "分位数与「至少有多少个候选」的日数统计。",
      columns: [
        tableColumn("statistic", "统计量"),
        tableColumn("value", "值"),
      ],
      rows: [
        { statistic: "决策日总数", value: dayDiagnostics.daysTotal },
        { statistic: "当日样本 ≥ 1（可做 Top-1）", value: dayDiagnostics.daysAtLeast1 },
        { statistic: "当日样本 ≥ 3（可做 Top-3）", value: dayDiagnostics.daysAtLeast3 },
        { statistic: "当日样本 ≥ 5（可做 Top-5）", value: dayDiagnostics.daysAtLeast5 },
        { statistic: "当日样本 ≥ 10（固定日集门槛）", value: dayDiagnostics.daysAtLeast10 },
        { statistic: "当日样本 ≥ 20", value: dayDiagnostics.daysAtLeast20 },
        { statistic: "最小值", value: dayDiagnostics.daySizeMin },
        { statistic: "P5", value: dayDiagnostics.daySizeP5 },
        { statistic: "P25", value: dayDiagnostics.daySizeP25 },
        { statistic: "中位数", value: dayDiagnostics.daySizeP50 },
        { statistic: "P75", value: dayDiagnostics.daySizeP75 },
        { statistic: "P95", value: dayDiagnostics.daySizeP95 },
        { statistic: "最大值", value: dayDiagnostics.daySizeMax },
        { statistic: "均值", value: dayDiagnostics.daySizeMean },
      ],
    },
  ];

  const charts = [
    {
      key: "topn_depth_curve",
      title: "取前 K 名的超额随 K 变化（综合评分 · 固定日集）",
      description:
        "横轴 K = 1..20；纵轴 = 相对当日池的超额（比例）。区间为日期聚类 Bootstrap 95%。",
      kind: "LINE" as const,
      xLabel: "K（取前几名）",
      yLabel: "超额（比例）",
      unit: "ratio",
      series: [
        {
          key: "excess_mean",
          label: "超额均值",
          points: depthCurve.map(row => ({
            x: String(row.k),
            y: row.excessMean,
          })),
        },
        {
          key: "excess_ci_low",
          label: "CI 下界",
          points: depthCurve.map(row => ({
            x: String(row.k),
            y: row.excessCi95Low,
          })),
        },
        {
          key: "excess_ci_high",
          label: "CI 上界",
          points: depthCurve.map(row => ({
            x: String(row.k),
            y: row.excessCi95High,
          })),
        },
      ],
    },
    {
      key: "topn_key_excess_n5",
      title: "同样取 Top-5：不同排序依据的超额（固定日集）",
      description:
        "横轴 = 排序依据；纵轴 = 相对当日池的超额（比例）。用来直接回答「综合评分 vs 单因子，谁更会挑」。",
      kind: "BAR" as const,
      xLabel: "排序依据",
      yLabel: "超额（比例）",
      unit: "ratio",
      series: [
        {
          key: "excess_mean",
          label: "Top-5 超额均值",
          points: keyMatrix
            .filter(row => row.size === "N5")
            .map(row => ({ x: row.keyLabel, y: row.excessMean })),
        },
      ],
    },
  ];

  const statistics = [
    {
      code: "decision_day_count",
      label: "决策日总数",
      value: dayDiagnostics.daysTotal,
      unit: "日",
      digits: 0,
    },
    {
      code: "day_size_median",
      label: "当日可用样本数中位",
      value: dayDiagnostics.daySizeP50,
      unit: "只",
      digits: 0,
      note: "「每天挑前几名」的可操作空间。",
    },
    {
      code: "composite_top5_excess",
      label: "综合评分 Top-5 日均超额（固定日集，主判据）",
      value: deepN5.excessMean,
      unit: "ratio",
      digits: 6,
      sampleCount: deepN5.daysIncluded,
      note: `判定 ${deepN5.excessVerdict}；CI95 [${deepN5.excessCi95Low}, ${deepN5.excessCi95High}]`,
    },
    {
      code: "composite_top1_excess",
      label: "综合评分 Top-1 日均超额（本职日集）",
      value: compositeOwn.find(row => row.size === "N1")?.excessMean ?? null,
      unit: "ratio",
      digits: 6,
      note:
        `判定 ${compositeOwn.find(row => row.size === "N1")?.excessVerdict ?? "—"}`,
    },
    {
      code: "composite_top5_portfolio_mean",
      label: "综合评分 Top-5 组合日均收益（固定日集）",
      value: deepN5.portfolioMean,
      unit: "ratio",
      digits: 6,
      note: `判定 ${deepN5.portfolioVerdict}；当日池同日 ${deepN5.poolMean}`,
    },
    {
      code: "composite_reversed_top5_excess",
      label: "综合评分反转 Top-5 日均超额（对称性检验）",
      value: deepReversedN5.excessMean,
      unit: "ratio",
      digits: 6,
      note: `判定 ${deepReversedN5.excessVerdict}`,
    },
    {
      code: "best_key_at_n5_excess",
      label: "Top-5 超额最高的排序依据",
      value: bestKeyAtN5?.excessMean ?? null,
      unit: "ratio",
      digits: 6,
      note: `依据 = ${bestKeyAtN5?.keyLabel ?? "—"}；判定 ${bestKeyAtN5?.excessVerdict ?? "—"}`,
    },
    {
      code: "depth_curve_peak_k",
      label: "深度曲线超额最高处的 K",
      value: peakDepth?.k ?? null,
      unit: "名",
      digits: 0,
      note: `超额 ${peakDepth?.excessMean ?? "—"}；判定 ${peakDepth?.excessVerdict ?? "—"}`,
    },
  ];

  const customPayload: TopNRankingPayload = {
    computationVersion: COMPUTATION_VERSION,
    rankingContractId: RANKING_CONTRACT_ID,
    bucketContractId: BUCKET_CONTRACT_ID,
    bucketFingerprint,
    coordinate: {
      entryDay: ENTRY_DAY,
      exitRelativeDay: EXIT_RELATIVE_DAY,
      roundTripCostBps: ROUND_TRIP_COST_BPS,
      decisionOffsetDays: ENTRY_DAY - 1,
    },
    dayGrouping: {
      unit: "决策日 = 首板日 T（信息截止 T+5 收盘）",
      deepDayMinSize: DEEP_DAY_MIN_SIZE,
      minDayCount: MIN_DAY_COUNT,
      overlapDisclosure:
        "持有期 T+6 开盘 → T+10 收盘（5 个交易日）⇒ 相邻决策日持仓重叠，日度序列非独立；CI 用 block=20 的日期聚类 Bootstrap。",
      weightingDisclosure:
        "组合日收益 = 当日 Top-N 等权平均；主指标 = 各日等权平均（每决策日一单位资金），不做复利与资金管理。",
    },
    rankingKeys: RANKING_KEYS.map(key => ({
      key: key.key,
      label: key.label,
      kind: key.kind,
      factorCode: key.factorCode,
      note: key.note,
    })),
    headline,
    keyMatrix,
    depthCurve,
    randomBenchmark,
    yearly,
    dayDiagnostics,
    referenceCheck: {
      referenceCandidateCount: REFERENCE_CANDIDATE_COUNT,
      actualCandidateCount: args.candidateCount,
      matchesCandidateCount: args.candidateCount === REFERENCE_CANDIDATE_COUNT,
      referenceEligibleCount: REFERENCE_ELIGIBLE_COUNT,
      actualEligibleCount: eligibleCount,
      matchesEligibleCount: eligibleCount === REFERENCE_ELIGIBLE_COUNT,
      referenceExperimentId: "first-board-pullback/twelve-factor-composite-study",
    },
    disclosures,
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount,
      excludedCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "本实验与 first-board-pullback/twelve-factor-composite-study 共用同一份样本派生（derive.ts）⇒ 候选数 / 入池数 / 剔除原因应与那个实验逐项相同。",
        `未评分的样本数按键统计（应为 0）：${[...unscoreableByKey.entries()]
          .map(([key, count]) => `${key}=${count}`)
          .join(", ")}`,
        `严格收盘涨停 ${args.exactLimitUpCloseCount}；重复 eventId ${args.duplicateEventIdCount}；` +
          `横向截面 peer ${args.crossSectionPeerCount}；前置窗口缺失 ${args.prefixWindowMissingCount}。`,
      ],
    },
    tables,
    charts,
    statistics,
    customPayload,
  };
}
