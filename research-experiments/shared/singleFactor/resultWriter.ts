/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **Structured Result Writer**（通用基础之八）。
 *
 * ## 产出结构（与需求文档逐项对应）
 *
 * ```
 * Experiment Definition  → 表 sf_experiment_definition
 * Overall Result         → 表 sf_overall_result
 * TopN Result            → 表 sf_topn_result
 * Benchmark Result       → 表 sf_benchmark_result
 * Excess Return          → 表 sf_excess_result
 * Time Slice Result      → 表 sf_time_slice_result
 * Trade Details          → 表 sf_trade_details（有界样本）+ CSV 产物（全量）
 * 附加：样本流 sf_sample_flow / 因子契约 sf_factor_contract / 决策日诊断 sf_day_diagnostics
 * ```
 *
 * ## 两条硬纪律
 *
 * 1. **样本账必须平**：`Σ excludedByReason === candidate − eligible`，不平即抛
 *    （`EXPERIMENT_RESULT_INVALID` 的触发点）。
 * 2. **全套组合一次算完**：`2 方向 × 4 档 = 8` 个组合全部进结果，
 *    没有任何「只保留最优组合」的开关 ⇒ 结构上禁止事后择优。
 *
 * ## 逐笔明细为什么落 CSV 而不是塞进 result.json
 *
 * 8 个组合 × 上千个决策日 × 最多 20 只 ≈ 十万级行。`result.json` 的平台上限是 8 MiB
 * （`EXPERIMENT_RESULT_JSON_MAX_BYTES`），塞进去必然超限；因此：
 * 结果里放**有界样本**（每组合前 `TRADE_TABLE_SAMPLE_PER_COMBO` 笔，便于页面直接看），
 * 全量走 `context.artifact()` 落成 gzip CSV（`trades/single-factor-<factor>.csv.gz`）。
 */

import { gzipSync } from "node:zlib";
import { z } from "zod";
import type {
  ExperimentArtifactFileSpec,
  ExperimentResultChart,
  ExperimentResultPayload,
  ExperimentResultStatistic,
  ExperimentResultTable,
} from "@shared/researchExperimentsContracts";
import type { FoundationCostConfig } from "../firstBoardPullback/types";
import {
  BENCHMARK_DEFINITION,
  BENCHMARK_DISCLOSURE,
  benchmarkDayNetReturnOf,
} from "./benchmark";
import {
  BUCKET_CONTRACT_ID,
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  MAX_RELATIVE_DAY,
  ROUND_TRIP_COST_BPS,
} from "./coordinate";
import type { SingleFactorCatalogEntry } from "./factorResolver";
import { factorContractRecordOf } from "./factorResolver";
import {
  bootstrapOf,
  computeMetrics,
  quantileOf,
  verdictOf,
  MIN_DECISION_DAY_COUNT,
} from "./metrics";
import {
  POSITION_MODEL_RECORD,
  assertTradeCostReconciles,
  costModelRecordOf,
  equalWeightMean,
  portfolioDayReturnOf,
} from "./positionCost";
import { buildCrossSections, selectTopN } from "./ranker";
import { sliceByYear, type TimeSliceResult } from "./timeSlice";
import {
  OBSERVATION_END_RELATIVE_DAY,
  OBSERVATION_START_RELATIVE_DAY,
  PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
  SINGLE_FACTOR_COMBOS,
  SINGLE_FACTOR_CONTRACT_ID,
  SINGLE_FACTOR_EXPERIMENT_TYPE,
  SINGLE_FACTOR_TEMPLATE_ID,
  SINGLE_FACTOR_VERDICTS,
  TOP_N_SIZES,
  type RankingDirection,
  type SingleFactorComboResult,
  type SingleFactorSample,
  type SingleFactorTrade,
  type TopNSize,
} from "./types";
import {
  UNIVERSE_LABEL,
  UNIVERSE_POLICY_DISCLOSURE,
  type SingleFactorUniverseResult,
} from "./universe";

/** 本模板计算引擎版本（改动口径必须升级）。 */
export const COMPUTATION_VERSION = "1.0.0";

/** Bootstrap 种子基数（与 12F / Top-N 同值，便于横向对照时理解「同种子」的含义）。 */
export const BOOTSTRAP_SEED_BASE = 20_260_925;

/** 逐笔明细表里每个组合保留的笔数上限（全量在 CSV 产物里）。 */
export const TRADE_TABLE_SAMPLE_PER_COMBO = 50;

/** 逐笔明细 CSV 产物名。 */
export function tradeArtifactNameOf(factorCode: string): string {
  return `trades/single-factor-${factorCode}.csv.gz`;
}

/**
 * 种子公式（**明文写死**，避免出现「同数据不同 CI」而无法解释）。
 *
 * ```
 * 组合级      seed = BASE + 1_000 + comboIndex × 100_000
 * 组合×年切片 seed = 组合级 + (year − 2000)
 * ```
 * `(year − 2000) < 100 ≪ 100_000` ⇒ 不同（组合 × 年份）的种子互不重合。
 */
export function comboSeedOf(comboIndex: number): number {
  return BOOTSTRAP_SEED_BASE + 1_000 + comboIndex * 100_000;
}

export function comboYearSeedOf(comboIndex: number, year: number): number {
  return comboSeedOf(comboIndex) + (year - 2000);
}

// ---------------------------------------------------------------------------
// 一、结果 schema（`customPayload` 的形状）
// ---------------------------------------------------------------------------

const verdictSchema = z.enum(SINGLE_FACTOR_VERDICTS);
const nullableNumber = z.number().nullable();

export const singleFactorMetricsSchema = z.object({
  totalReturn: nullableNumber,
  grossTotalReturn: nullableNumber,
  meanTradeReturn: nullableNumber,
  medianTradeReturn: nullableNumber,
  winRate: nullableNumber,
  profitFactor: nullableNumber,
  maxDrawdown: nullableNumber,
  tradeCount: z.number().int().nonnegative(),
  benchmarkReturn: nullableNumber,
  excessReturn: nullableNumber,
  averageHoldingDays: nullableNumber,
  costBps: z.number(),
  slippageBpsPerSide: z.number(),
  costDrag: nullableNumber,
});

export const singleFactorTradeSchema = z.object({
  decisionDate: z.string().min(1).optional(),
  stockCode: z.string().min(1),
  eventId: z.string().min(1),
  factorValue: z.number(),
  rank: z.number().int().positive(),
  poolSize: z.number().int().positive(),
  signalDate: z.string().min(1),
  entryDate: z.string().min(1),
  entryPrice: z.number(),
  exitDate: z.string().min(1),
  exitPrice: z.number(),
  exitRelativeDay: z.number().int(),
  holdingDays: z.number().int().positive(),
  grossReturn: z.number(),
  cost: z.number(),
  costBps: z.number(),
  netReturn: z.number(),
});

export const singleFactorComboSchema = z.object({
  comboId: z.string().min(1),
  direction: z.enum(["HIGH", "LOW"]),
  size: z.number().int().positive(),
  label: z.string().min(1),
  daysIncluded: z.number().int().nonnegative(),
  daysExcludedSmall: z.number().int().nonnegative(),
  picks: z.number().int().nonnegative(),
  picksPerDayMedian: nullableNumber,
  metrics: singleFactorMetricsSchema,
  meanDailyPortfolioReturn: nullableNumber,
  meanDailyBenchmarkReturn: nullableNumber,
  meanDailyExcess: nullableNumber,
  excessCi95Low: nullableNumber,
  excessCi95High: nullableNumber,
  excessVerdict: verdictSchema,
  portfolioCi95Low: nullableNumber,
  portfolioCi95High: nullableNumber,
  portfolioVerdict: verdictSchema,
  dayWinRate: nullableNumber,
  poolDayWinRate: nullableNumber,
});

export const singleFactorTimeSliceSchema = z.object({
  comboId: z.string().min(1),
  year: z.number().int(),
  dayCount: z.number().int().nonnegative(),
  tradeCount: z.number().int().nonnegative(),
  metrics: singleFactorMetricsSchema,
  excessMean: nullableNumber,
  excessCi95Low: nullableNumber,
  excessCi95High: nullableNumber,
  excessVerdict: verdictSchema,
});

export const singleFactorSchema = z.object({
  templateId: z.string().min(1),
  contractId: z.string().min(1),
  experimentType: z.string().min(1),
  computationVersion: z.string().min(1),
  factorCode: z.string().min(1),
  factorLabel: z.string().min(1),
  factorContractId: z.string().min(1),
  bucketContractId: z.string().min(1),
  factorContract: z.object({
    code: z.string().min(1),
    label: z.string().min(1),
    source: z.string().min(1),
    orientation: z.number(),
    priorVerified: z.boolean(),
    bucketCount: z.number().int().nonnegative(),
    buckets: z.array(z.string()),
    contractId: z.string().min(1),
    fingerprint: z.string().min(1),
  }),
  coordinate: z.object({
    eventRelativeDay: z.number().int(),
    observationStart: z.number().int(),
    observationEnd: z.number().int(),
    informationCutoffRelativeDay: z.number().int(),
    entryRelativeDay: z.number().int(),
    exitRelativeDay: z.number().int(),
    maxRelativeDay: z.number().int(),
    roundTripCostBps: z.number(),
  }),
  position: z.object({
    model: z.string().min(1),
    label: z.string().min(1),
    disclosure: z.string().min(1),
  }),
  cost: z.object({
    roundTripCostBps: z.number(),
    foundationRoundTripCostBps: z.number(),
    slippageBpsPerSide: z.number(),
    commissionBpsPerSide: z.number(),
    impactBpsPerSide: z.number(),
    stampDutyBps: z.number(),
    accounting: z.string().min(1),
  }),
  benchmark: z.object({
    definition: z.string().min(1),
    disclosure: z.string().min(1),
  }),
  universePolicy: z.object({
    label: z.string().min(1),
    disclosure: z.string().min(1),
  }),
  observationPolicy: z.object({
    statement: z.string().min(1),
    isEntryWindow: z.boolean(),
  }),
  combos: z.array(singleFactorComboSchema),
  timeSlices: z.array(singleFactorTimeSliceSchema),
  dayDiagnostics: z.object({
    daysTotal: z.number().int().nonnegative(),
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
    histogram: z.array(
      z.object({
        bucket: z.string().min(1),
        days: z.number().int().nonnegative(),
        share: z.number(),
      })
    ),
  }),
  sampleFlow: z.object({
    candidateCount: z.number().int().nonnegative(),
    eligibleCountBeforeFactorFilter: z.number().int().nonnegative(),
    rankableSampleCount: z.number().int().nonnegative(),
    factorValueMissingCount: z.number().int().nonnegative(),
    factorMissingByCode: z.record(z.string(), z.number().int().nonnegative()),
    excludedByReason: z.record(z.string(), z.number().int().nonnegative()),
    duplicateEventIdCount: z.number().int().nonnegative(),
    crossSectionPeerCount: z.number().int().nonnegative(),
    datasetEventCount: nullableNumber,
    unscannedEventCount: nullableNumber,
    pitObservationRowCount: z.number().int().nonnegative(),
    pitExecutionRowCount: z.number().int().nonnegative(),
  }),
  tradeArtifact: z.object({
    name: z.string().min(1),
    rowCount: z.number().int().nonnegative(),
    columns: z.array(z.string().min(1)),
    note: z.string().min(1),
  }),
  disclosures: z.array(z.string().min(1)),
});

export type SingleFactorPayload = z.infer<typeof singleFactorSchema>;

// ---------------------------------------------------------------------------
// 二、装配入参
// ---------------------------------------------------------------------------

export interface SingleFactorAssemblyArgs {
  readonly factor: SingleFactorCatalogEntry;
  readonly universe: SingleFactorUniverseResult;
  /** 声明一个落对象存储的产物；不传则不写（单测场景）。 */
  readonly emitArtifact?: (spec: ExperimentArtifactFileSpec) => void;
  readonly costInput?: Partial<FoundationCostConfig>;
}

interface ComboComputation {
  comboIndex: number;
  comboId: string;
  direction: RankingDirection;
  size: TopNSize;
  label: string;
  daysIncluded: number;
  daysExcludedSmall: number;
  trades: readonly SingleFactorTrade[];
  grossDaily: { eventDate: string; value: number }[];
  netDaily: { eventDate: string; value: number }[];
  benchmarkDaily: { eventDate: string; value: number }[];
  equity: { date: string; value: number }[];
  excessDaily: readonly { eventDate: string; value: number }[];
  aggregate: SingleFactorComboResult;
  timeSlices: readonly TimeSliceResult[];
}

// ---------------------------------------------------------------------------
// 三、单组合计算
// ---------------------------------------------------------------------------

function computeCombo(
  samples: readonly SingleFactorSample[],
  comboIndex: number,
  direction: RankingDirection,
  size: TopNSize
): ComboComputation {
  const combo = SINGLE_FACTOR_COMBOS[comboIndex]!;
  const sections = buildCrossSections(samples, direction);
  const trades: SingleFactorTrade[] = [];
  const grossDaily: { eventDate: string; value: number }[] = [];
  const netDaily: { eventDate: string; value: number }[] = [];
  const benchmarkDaily: { eventDate: string; value: number }[] = [];
  const equity: { date: string; value: number }[] = [];
  let daysExcludedSmall = 0;
  let running = 1;

  for (const section of sections.values()) {
    const selection = selectTopN(section, size);
    const benchmark = benchmarkDayNetReturnOf(section.pool);
    if (!selection.included || benchmark === null) {
      daysExcludedSmall += 1;
      continue;
    }
    const members = selection.picks.map(pick => pick.sample);
    const day = portfolioDayReturnOf(members);
    if (day.gross === null || day.net === null) {
      daysExcludedSmall += 1;
      continue;
    }
    grossDaily.push({ eventDate: section.date, value: day.gross });
    netDaily.push({ eventDate: section.date, value: day.net });
    benchmarkDaily.push({ eventDate: section.date, value: benchmark });
    running *= 1 + day.net;
    equity.push({ date: section.date, value: running });

    for (const pick of selection.picks) {
      const trade: SingleFactorTrade = {
        decisionDate: section.date,
        stockCode: pick.sample.stockCode,
        eventId: pick.sample.eventId,
        factorValue: pick.sample.factorValue,
        rank: pick.rank,
        poolSize: section.pool.length,
        signalDate: pick.sample.signalDate,
        entryDate: pick.sample.entryDate,
        entryPrice: pick.sample.entryPrice,
        exitDate: pick.sample.exitDate,
        exitPrice: pick.sample.exitPrice,
        exitRelativeDay: pick.sample.exitRelativeDay,
        holdingDays: pick.sample.holdingDays,
        grossReturn: pick.sample.grossReturn,
        cost: pick.sample.cost,
        costBps: pick.sample.costBps,
        netReturn: pick.sample.netReturn,
      };
      assertTradeCostReconciles(trade);
      trades.push(trade);
    }
  }

  /**
   * 🔴 即使一个组合一个可用决策日都没有（例如当日池从来凑不满 Top-20），
   *    也**照样输出这一行**（`daysIncluded = 0` + 指标全 `null`）——
   *    「8 个预定义组合全部落进结果」是需求，静默丢掉一个组合等于事后择优。
   */
  const computed = computeMetrics({
    trades,
    grossDaily,
    netDaily,
    benchmarkDaily,
  });
  const excessCi =
    computed.excessDaily.length === 0
      ? null
      : bootstrapOf(computed.excessDaily, comboSeedOf(comboIndex));
  const portfolioCi =
    netDaily.length === 0 ? null : bootstrapOf(netDaily, comboSeedOf(comboIndex) + 1);
  const excessValues = computed.excessDaily.map(point => point.value);
  const benchmarkValues = benchmarkDaily.map(point => point.value);

  const aggregate: SingleFactorComboResult = {
    comboId: combo.id,
    direction,
    size,
    label: combo.label,
    daysIncluded: netDaily.length,
    daysExcludedSmall,
    metrics: computed.metrics,
    excessCi95Low: excessCi?.low ?? null,
    excessCi95High: excessCi?.high ?? null,
    excessVerdict: verdictOf({
      dayCount: computed.excessDaily.length,
      ciLow: excessCi?.low ?? null,
      ciHigh: excessCi?.high ?? null,
    }),
    portfolioCi95Low: portfolioCi?.low ?? null,
    portfolioCi95High: portfolioCi?.high ?? null,
    portfolioVerdict: verdictOf({
      dayCount: netDaily.length,
      ciLow: portfolioCi?.low ?? null,
      ciHigh: portfolioCi?.high ?? null,
    }),
    dayWinRate:
      excessValues.length === 0
        ? null
        : excessValues.filter(value => value > 0).length / excessValues.length,
    trades,
  };

  const timeSlices = sliceByYear({
    trades,
    grossDaily,
    netDaily,
    benchmarkDaily,
    seedOf: year => comboYearSeedOf(comboIndex, year),
  });

  return {
    comboIndex,
    comboId: combo.id,
    direction,
    size,
    label: combo.label,
    daysIncluded: netDaily.length,
    daysExcludedSmall,
    trades,
    grossDaily,
    netDaily,
    benchmarkDaily,
    equity,
    excessDaily: computed.excessDaily,
    aggregate,
    timeSlices,
  };
}

// ---------------------------------------------------------------------------
// 四、表格 / 图表工具
// ---------------------------------------------------------------------------

function tableColumn(
  key: string,
  label: string,
  digits: number | null = null
): { key: string; label: string; digits?: number; align?: "LEFT" | "RIGHT" } {
  return digits === null
    ? { key, label, align: "LEFT" }
    : { key, label, digits, align: "RIGHT" };
}

function describe(values: readonly number[]): {
  min: number | null;
  p5: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
  mean: number | null;
} {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted.length === 0 ? null : sorted[0]!,
    p5: quantileOf(sorted, 0.05),
    p25: quantileOf(sorted, 0.25),
    p50: quantileOf(sorted, 0.5),
    p75: quantileOf(sorted, 0.75),
    p95: quantileOf(sorted, 0.95),
    max: sorted.length === 0 ? null : sorted[sorted.length - 1]!,
    mean: equalWeightMean(values),
  };
}

const DAY_SIZE_BUCKETS: readonly { label: string; test: (size: number) => boolean }[] =
  [
    { label: "1", test: size => size === 1 },
    { label: "2", test: size => size === 2 },
    { label: "3~4", test: size => size >= 3 && size <= 4 },
    { label: "5~9", test: size => size >= 5 && size <= 9 },
    { label: "10~19", test: size => size >= 10 && size <= 19 },
    { label: "20~49", test: size => size >= 20 && size <= 49 },
    { label: "≥50", test: size => size >= 50 },
  ];

// ---------------------------------------------------------------------------
// 五、装配
// ---------------------------------------------------------------------------

function comboMetricsRow(computation: ComboComputation): Record<
  string,
  string | number | boolean | null
> {
  const metrics = computation.aggregate.metrics;
  return {
    comboId: computation.comboId,
    direction: computation.direction,
    size: computation.size,
    label: computation.label,
    tradeCount: metrics.tradeCount,
    daysIncluded: computation.daysIncluded,
    daysExcludedSmall: computation.daysExcludedSmall,
    totalReturn: metrics.totalReturn,
    grossTotalReturn: metrics.grossTotalReturn,
    meanTradeReturn: metrics.meanTradeReturn,
    medianTradeReturn: metrics.medianTradeReturn,
    winRate: metrics.winRate,
    profitFactor: metrics.profitFactor,
    maxDrawdown: metrics.maxDrawdown,
    averageHoldingDays: metrics.averageHoldingDays,
    costBps: metrics.costBps,
    slippageBpsPerSide: metrics.slippageBpsPerSide,
    costDrag: metrics.costDrag,
    benchmarkReturn: metrics.benchmarkReturn,
    excessReturn: metrics.excessReturn,
  };
}

export function assembleSingleFactorResult(
  args: SingleFactorAssemblyArgs
): ExperimentResultPayload {
  const { factor, universe } = args;
  const samples = universe.samples;
  const eligibleCount = samples.length;
  const excludedCount = universe.candidateCount - eligibleCount;
  const excludedSum = Object.values(universe.excludedByReason).reduce(
    (sum, value) => sum + value,
    0
  );
  if (excludedSum !== excludedCount) {
    throw new Error(
      `样本账不守恒：excludedByReason 合计 ${excludedSum} ≠ candidate − eligible ${excludedCount}`
    );
  }
  if (samples.length === 0) {
    throw new Error(
      `因子 ${factor.code} 没有任何可排名样本（候选 ${universe.candidateCount}）——` +
        `请检查该因子是否真的被计算出来（valueOf 是否恒为 null）。`
    );
  }

  const computations: ComboComputation[] = SINGLE_FACTOR_COMBOS.map((combo, index) =>
    computeCombo(samples, index, combo.direction, combo.size)
  );
  if (computations.length !== SINGLE_FACTOR_COMBOS.length) {
    throw new Error(
      `预定义组合必须全部输出：期望 ${SINGLE_FACTOR_COMBOS.length} 个，实得 ${computations.length} 个`
    );
  }
  if (!computations.some(computation => computation.daysIncluded > 0)) {
    throw new Error("8 个预定义组合全部没有可用决策日 —— 无法产出结果。");
  }

  // ---- 决策日诊断（与方向/档位无关：这一层只看当日可排名样本数）----
  const daysByDate = new Map<string, number>();
  for (const sample of samples) {
    daysByDate.set(sample.eventDate, (daysByDate.get(sample.eventDate) ?? 0) + 1);
  }
  const daySizes = [...daysByDate.values()];
  const daySizeStats = describe(daySizes);
  const countDays = (minimum: number): number =>
    daySizes.filter(size => size >= minimum).length;
  const histogram = DAY_SIZE_BUCKETS.map(bucket => {
    const days = daySizes.filter(size => bucket.test(size)).length;
    return {
      bucket: bucket.label,
      days,
      share: daySizes.length === 0 ? 0 : days / daySizes.length,
    };
  });
  const dayDiagnostics = {
    daysTotal: daySizes.length,
    daysAtLeast3: countDays(3),
    daysAtLeast5: countDays(5),
    daysAtLeast10: countDays(10),
    daysAtLeast20: countDays(20),
    daySizeMin: daySizeStats.min,
    daySizeP5: daySizeStats.p5,
    daySizeP25: daySizeStats.p25,
    daySizeP50: daySizeStats.p50,
    daySizeP75: daySizeStats.p75,
    daySizeP95: daySizeStats.p95,
    daySizeMax: daySizeStats.max,
    daySizeMean: daySizeStats.mean,
    histogram,
  };

  // ---- Trade Details：有界样本（全量在 CSV 产物）+ 全量 CSV ----
  const tradeColumns: readonly string[] = [
    "comboId",
    "decisionDate",
    "stockCode",
    "factorValue",
    "rank",
    "poolSize",
    "signalDate",
    "entryDate",
    "entryPrice",
    "exitDate",
    "exitPrice",
    "exitRelativeDay",
    "holdingDays",
    "grossReturn",
    "cost",
    "costBps",
    "netReturn",
    "eventId",
  ];
  const tradeArtifact = {
    name: tradeArtifactNameOf(factor.code),
    rowCount: computations.reduce(
      (sum, computation) => sum + computation.trades.length,
      0
    ),
    columns: [...tradeColumns],
    note:
      "全量逐笔明细（8 个组合全部笔数）落对象存储；result.json 里只放每组合前 " +
      `${TRADE_TABLE_SAMPLE_PER_COMBO} 笔。`,
  };
  if (args.emitArtifact) {
    emitTradeArtifact(args.emitArtifact, tradeArtifact.name, computations);
  }

  // ---- 表格 ----
  const definitionRows: Record<string, string | number | boolean | null>[] = [
    { field: "模板", value: SINGLE_FACTOR_TEMPLATE_ID },
    { field: "契约", value: SINGLE_FACTOR_CONTRACT_ID },
    { field: "experimentType", value: SINGLE_FACTOR_EXPERIMENT_TYPE },
    { field: "Factor", value: `${factor.code} · ${factor.label}` },
    { field: "Universe", value: UNIVERSE_LABEL },
    { field: "T", value: `首板日（rd=${0}）` },
    {
      field: "Observation",
      value: `T+${OBSERVATION_START_RELATIVE_DAY} ~ T+${OBSERVATION_END_RELATIVE_DAY}（观察窗，非买入窗）`,
    },
    { field: "信息截止", value: `T+${PIT_INFORMATION_CUTOFF_RELATIVE_DAY} 收盘` },
    { field: "Entry", value: `T+${ENTRY_DAY} 开盘（canBuyAtOpen）` },
    { field: "Exit", value: `T+${EXIT_RELATIVE_DAY} 收盘（不可卖顺延，≤ T+${MAX_RELATIVE_DAY}）` },
    { field: "Position", value: POSITION_MODEL_RECORD.label },
    { field: "Cost", value: `往返 ${ROUND_TRIP_COST_BPS} bps` },
    {
      field: "Ranking",
      value: "HIGH / LOW（两个方向都跑，禁止事后择优）",
    },
    { field: "TopN", value: TOP_N_SIZES.join(" / ") },
    { field: "Benchmark", value: BENCHMARK_DEFINITION },
    { field: "预定义组合数", value: SINGLE_FACTOR_COMBOS.length },
  ];

  const overallRows = computations.map(comboMetricsRow);

  const topnRows = computations.map(computation => {
    const picksPerDay =
      computation.daysIncluded === 0
        ? null
        : computation.trades.length / computation.daysIncluded;
    return {
      comboId: computation.comboId,
      direction: computation.direction,
      size: computation.size,
      daysIncluded: computation.daysIncluded,
      daysExcludedSmall: computation.daysExcludedSmall,
      picks: computation.trades.length,
      picksPerDayMedian: picksPerDay,
      meanDailyPortfolioReturn: equalWeightMean(
        computation.netDaily.map(point => point.value)
      ),
      portfolioCi95Low: computation.aggregate.portfolioCi95Low,
      portfolioCi95High: computation.aggregate.portfolioCi95High,
      portfolioVerdict: computation.aggregate.portfolioVerdict,
    };
  });

  const benchmarkRows = computations.map(computation => ({
    comboId: computation.comboId,
    direction: computation.direction,
    size: computation.size,
    daysIncluded: computation.daysIncluded,
    meanDailyPortfolioReturn: equalWeightMean(
      computation.netDaily.map(point => point.value)
    ),
    meanDailyBenchmarkReturn: equalWeightMean(
      computation.benchmarkDaily.map(point => point.value)
    ),
    meanDailyExcess: equalWeightMean(
      computation.excessDaily.map(point => point.value)
    ),
    benchmarkReturn: computation.aggregate.metrics.benchmarkReturn,
    portfolioTotalReturn: computation.aggregate.metrics.totalReturn,
    excessReturn: computation.aggregate.metrics.excessReturn,
  }));

  const excessRows = computations.map(computation => ({
    comboId: computation.comboId,
    direction: computation.direction,
    size: computation.size,
    daysIncluded: computation.daysIncluded,
    meanDailyExcess: equalWeightMean(
      computation.excessDaily.map(point => point.value)
    ),
    excessCi95Low: computation.aggregate.excessCi95Low,
    excessCi95High: computation.aggregate.excessCi95High,
    excessVerdict: computation.aggregate.excessVerdict,
    dayWinRate: computation.aggregate.dayWinRate,
    minDayCount: MIN_DECISION_DAY_COUNT,
  }));

  const timeSliceRows = computations.flatMap(computation =>
    computation.timeSlices.map(slice => ({
      comboId: computation.comboId,
      direction: computation.direction,
      size: computation.size,
      year: slice.year,
      dayCount: slice.dayCount,
      tradeCount: slice.tradeCount,
      totalReturn: slice.metrics.totalReturn,
      meanTradeReturn: slice.metrics.meanTradeReturn,
      winRate: slice.metrics.winRate,
      maxDrawdown: slice.metrics.maxDrawdown,
      benchmarkReturn: slice.metrics.benchmarkReturn,
      excessReturn: slice.metrics.excessReturn,
      meanDailyExcess: slice.excessMean,
      excessCi95Low: slice.excessCi95Low,
      excessCi95High: slice.excessCi95High,
      excessVerdict: slice.excessVerdict,
    }))
  );

  const tradeSampleRows = computations.flatMap(computation =>
    computation.trades.slice(0, TRADE_TABLE_SAMPLE_PER_COMBO).map(trade => ({
      comboId: computation.comboId,
      decisionDate: trade.decisionDate ?? trade.signalDate,
      stockCode: trade.stockCode,
      factorValue: trade.factorValue,
      rank: trade.rank,
      poolSize: trade.poolSize,
      signalDate: trade.signalDate,
      entryDate: trade.entryDate,
      entryPrice: trade.entryPrice,
      exitDate: trade.exitDate,
      exitPrice: trade.exitPrice,
      exitRelativeDay: trade.exitRelativeDay,
      holdingDays: trade.holdingDays,
      grossReturn: trade.grossReturn,
      cost: trade.cost,
      costBps: trade.costBps,
      netReturn: trade.netReturn,
    }))
  );

  const factorContract = factorContractRecordOf(factor);
  const factorContractRows: Record<string, string | number | boolean | null>[] = [
    { field: "factorCode", value: factorContract.code },
    { field: "factorLabel", value: factorContract.label },
    { field: "来源实验", value: factorContract.source },
    { field: "先验方向", value: factorContract.orientation },
    { field: "先验已验证", value: factorContract.priorVerified ? "是" : "否" },
    { field: "桶数", value: factorContract.bucketCount },
    { field: "桶词表", value: factorContract.buckets.join(" | ") },
    { field: "分桶契约", value: factorContract.contractId },
    { field: "因子指纹", value: factorContract.fingerprint },
    { field: "本模板是否使用桶位分排序", value: "否（用因子原始值排序）" },
  ];

  const dayDiagnosticsRows: Record<string, string | number | boolean | null>[] = [
    { statistic: "决策日总数", value: dayDiagnostics.daysTotal },
    { statistic: "当日样本 ≥ 3", value: dayDiagnostics.daysAtLeast3 },
    { statistic: "当日样本 ≥ 5", value: dayDiagnostics.daysAtLeast5 },
    { statistic: "当日样本 ≥ 10", value: dayDiagnostics.daysAtLeast10 },
    { statistic: "当日样本 ≥ 20", value: dayDiagnostics.daysAtLeast20 },
    { statistic: "当日样本最小值", value: dayDiagnostics.daySizeMin },
    { statistic: "当日样本 P5", value: dayDiagnostics.daySizeP5 },
    { statistic: "当日样本 P25", value: dayDiagnostics.daySizeP25 },
    { statistic: "当日样本中位", value: dayDiagnostics.daySizeP50 },
    { statistic: "当日样本 P75", value: dayDiagnostics.daySizeP75 },
    { statistic: "当日样本 P95", value: dayDiagnostics.daySizeP95 },
    { statistic: "当日样本最大值", value: dayDiagnostics.daySizeMax },
    { statistic: "当日样本均值", value: dayDiagnostics.daySizeMean },
  ];

  const sampleFlowRows: Record<string, string | number | boolean | null>[] = [
    { statistic: "候选事件（Dataset）", value: universe.candidateCount },
    {
      statistic: "公共底座入池（12 因子齐全）",
      value: universe.eligibleCountBeforeFactorFilter,
    },
    {
      statistic: `因子可评估（${factor.code}）`,
      value: universe.samples.length,
    },
    { statistic: "因子不可评估被剔", value: universe.factorValueMissingCount },
    { statistic: "剔除合计", value: excludedCount },
    ...Object.entries(universe.excludedByReason)
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => ({ statistic: `剔除 · ${reason}`, value: count })),
    { statistic: "重复 eventId", value: universe.duplicateEventIdCount },
    { statistic: "横向截面 peer", value: universe.crossSectionPeerCount },
    { statistic: "Dataset 声明事件总数", value: universe.datasetEventCount },
    { statistic: "未扫描事件数", value: universe.unscannedEventCount },
    { statistic: "PIT 观察窗读行数", value: universe.pitObservationRowCount },
    { statistic: "PIT 成交侧读行数", value: universe.pitExecutionRowCount },
  ];

  const tables: ExperimentResultTable[] = [
    {
      key: "sf_experiment_definition",
      title: "Experiment Definition · 实验定义",
      description:
        "本模板的冻结口径。全部字段都是常量或从冻结契约引入，不受运行时参数影响。",
      columns: [tableColumn("field", "字段"), tableColumn("value", "值")],
      rows: definitionRows,
    },
    {
      key: "sf_sample_flow",
      title: "样本流 · 候选 → 可排名（账必须平）",
      description:
        "候选 − 可排名 = 剔除合计 = Σ 剔除原因。因子不可评估（FACTOR_VALUE_MISSING）是单因子实验特有的一类剔除。",
      columns: [
        tableColumn("statistic", "统计项"),
        tableColumn("value", "值", 0),
      ],
      rows: sampleFlowRows,
    },
    {
      key: "sf_overall_result",
      title: "Overall Result · 8 个预定义组合的核心指标",
      description:
        "totalReturn = 组合净收益按决策日复利；grossTotalReturn 为同构造毛收益；costDrag = grossTotalReturn − totalReturn。",
      columns: [
        tableColumn("comboId", "组合"),
        tableColumn("direction", "方向"),
        tableColumn("size", "TopN"),
        tableColumn("tradeCount", "#交易", 0),
        tableColumn("daysIncluded", "#决策日", 0),
        tableColumn("daysExcludedSmall", "剔除日(池不足N)", 0),
        tableColumn("totalReturn", "总收益(净)", 6),
        tableColumn("grossTotalReturn", "总收益(毛)", 6),
        tableColumn("meanTradeReturn", "逐笔均值", 6),
        tableColumn("medianTradeReturn", "逐笔中位", 6),
        tableColumn("winRate", "胜率", 6),
        tableColumn("profitFactor", "盈亏比", 6),
        tableColumn("maxDrawdown", "最大回撤(≤0)", 6),
        tableColumn("averageHoldingDays", "平均持有日", 3),
        tableColumn("costBps", "往返成本bps", 2),
        tableColumn("costDrag", "成本拖累", 6),
        tableColumn("benchmarkReturn", "基准总收益", 6),
        tableColumn("excessReturn", "超额(复利差)", 6),
      ],
      rows: overallRows,
    },
    {
      key: "sf_topn_result",
      title: "TopN Result · 组合构建与绝对表现",
      description:
        "每决策日在当日可排名样本里取前 N 名（池不足 N 的整天不纳入，见「剔除日」）。绝对表现为净口径日收益均值 + 日期聚类 Bootstrap 95%。",
      columns: [
        tableColumn("comboId", "组合"),
        tableColumn("size", "TopN", 0),
        tableColumn("daysIncluded", "#决策日", 0),
        tableColumn("daysExcludedSmall", "剔除日", 0),
        tableColumn("picks", "#选中笔数", 0),
        tableColumn("picksPerDayMedian", "日均笔数", 3),
        tableColumn("meanDailyPortfolioReturn", "组合日均收益", 6),
        tableColumn("portfolioCi95Low", "CI95 下", 6),
        tableColumn("portfolioCi95High", "CI95 上", 6),
        tableColumn("portfolioVerdict", "绝对判定"),
      ],
      rows: topnRows,
    },
    {
      key: "sf_benchmark_result",
      title: "Benchmark Result · 当日候选池等权",
      description: BENCHMARK_DISCLOSURE,
      columns: [
        tableColumn("comboId", "组合"),
        tableColumn("daysIncluded", "#决策日", 0),
        tableColumn("meanDailyPortfolioReturn", "组合日均收益", 6),
        tableColumn("meanDailyBenchmarkReturn", "基准日均收益", 6),
        tableColumn("meanDailyExcess", "日均超额", 6),
        tableColumn("benchmarkReturn", "基准总收益", 6),
        tableColumn("portfolioTotalReturn", "组合总收益", 6),
        tableColumn("excessReturn", "超额(复利差)", 6),
      ],
      rows: benchmarkRows,
    },
    {
      key: "sf_excess_result",
      title: "Excess Return · 配对日度超额（主判据）",
      description:
        "对每个决策日 d：excess_d = 组合净收益 − 当日池净收益（同日、同成本、同一批事件，**配对**）。" +
        `判定：CI95 下界 > 0 ⇒ POSITIVE；上界 < 0 ⇒ NEGATIVE；跨 0 ⇒ INCONCLUSIVE；决策日 < ${MIN_DECISION_DAY_COUNT} ⇒ INSUFFICIENT。`,
      columns: [
        tableColumn("comboId", "组合"),
        tableColumn("daysIncluded", "#决策日", 0),
        tableColumn("meanDailyExcess", "日均超额", 6),
        tableColumn("excessCi95Low", "CI95 下", 6),
        tableColumn("excessCi95High", "CI95 上", 6),
        tableColumn("excessVerdict", "判定"),
        tableColumn("dayWinRate", "日胜率(超额>0)", 6),
      ],
      rows: excessRows,
    },
    {
      key: "sf_time_slice_result",
      title: "Time Slice Result · 按决策日自然年切片",
      description:
        "每个切片上重算同一套指标与判据（不是把全期结果相加）。年切片是描述性的：又一批多重比较，只用于看「是否只在某几年有效」。",
      columns: [
        tableColumn("comboId", "组合"),
        tableColumn("year", "年", 0),
        tableColumn("dayCount", "#决策日", 0),
        tableColumn("tradeCount", "#交易", 0),
        tableColumn("totalReturn", "总收益(净)", 6),
        tableColumn("meanTradeReturn", "逐笔均值", 6),
        tableColumn("winRate", "胜率", 6),
        tableColumn("maxDrawdown", "最大回撤", 6),
        tableColumn("benchmarkReturn", "基准总收益", 6),
        tableColumn("excessReturn", "超额(复利差)", 6),
        tableColumn("meanDailyExcess", "日均超额", 6),
        tableColumn("excessCi95Low", "CI95 下", 6),
        tableColumn("excessCi95High", "CI95 上", 6),
        tableColumn("excessVerdict", "判定"),
      ],
      rows: timeSliceRows,
    },
    {
      key: "sf_trade_details",
      title: `Trade Details · 逐笔明细（每组合前 ${TRADE_TABLE_SAMPLE_PER_COMBO} 笔）`,
      description:
        `逐笔字段与需求一致；全量 ${tradeArtifact.rowCount} 笔在产物 ${tradeArtifact.name} 里。` +
        "cost 为往返 20 bps 的比例值，恒满足 netReturn = grossReturn − cost。",
      columns: [
        tableColumn("comboId", "组合"),
        tableColumn("decisionDate", "决策日(T)"),
        tableColumn("stockCode", "stockCode"),
        tableColumn("factorValue", "factorValue", 6),
        tableColumn("rank", "rank", 0),
        tableColumn("poolSize", "poolSize", 0),
        tableColumn("signalDate", "signalDate"),
        tableColumn("entryDate", "entryDate"),
        tableColumn("entryPrice", "entryPrice", 4),
        tableColumn("exitDate", "exitDate"),
        tableColumn("exitPrice", "exitPrice", 4),
        tableColumn("exitRelativeDay", "exitRd", 0),
        tableColumn("holdingDays", "holdingDays", 0),
        tableColumn("grossReturn", "grossReturn", 6),
        tableColumn("cost", "cost", 6),
        tableColumn("costBps", "costBps", 2),
        tableColumn("netReturn", "netReturn", 6),
      ],
      rows: tradeSampleRows,
    },
    {
      key: "sf_factor_contract",
      title: "Factor Contract · 因子口径留档（零改动）",
      description:
        "因子定义 / 桶边界 / 方向全部来自 FROZEN-BUCKET-CONTRACT-001，本模板零改动；" +
        "并且**不使用**桶位分做排序（用因子原始值）。",
      columns: [tableColumn("field", "字段"), tableColumn("value", "值")],
      rows: factorContractRows,
    },
    {
      key: "sf_day_diagnostics",
      title: "决策日样本量诊断",
      description:
        "「每天取前 N 名」的可操作空间。注意：候选池口径为 12F 入池池，因此这里的日样本量同时受「12 因子齐全」约束。",
      columns: [
        tableColumn("statistic", "统计项"),
        tableColumn("value", "值", 3),
      ],
      rows: dayDiagnosticsRows,
    },
  ];

  // ---- statistics ----
  const statistics: ExperimentResultStatistic[] = [
    {
      code: "decision_day_count",
      label: "决策日总数",
      value: dayDiagnostics.daysTotal,
      unit: "日",
      digits: 0,
    },
    {
      code: "day_size_median",
      label: "当日可排名样本数中位",
      value: dayDiagnostics.daySizeP50,
      unit: "只",
      digits: 0,
      note: "「每天挑前几名」的可操作空间。",
    },
    {
      code: "rankable_sample_count",
      label: `因子可评估样本数（${factor.code}）`,
      value: samples.length,
      unit: "笔",
      digits: 0,
    },
    {
      code: "factor_value_missing_count",
      label: "因子不可评估被剔数",
      value: universe.factorValueMissingCount,
      unit: "笔",
      digits: 0,
      note: "单因子模板特有的一类剔除；null 值不可排名。",
    },
    ...computations.flatMap(computation => [
      {
        code: `total_return_${computation.comboId}`,
        label: `${computation.label} · 组合总收益（净，复利）`,
        value: computation.aggregate.metrics.totalReturn,
        unit: "ratio",
        digits: 6,
        sampleCount: computation.trades.length,
      },
      {
        code: `excess_return_${computation.comboId}`,
        label: `${computation.label} · 超额（组合 − 当日池，复利差）`,
        value: computation.aggregate.metrics.excessReturn,
        unit: "ratio",
        digits: 6,
        sampleCount: computation.daysIncluded,
        note: `判定 ${computation.aggregate.excessVerdict}；CI95 [${computation.aggregate.excessCi95Low}, ${computation.aggregate.excessCi95High}]`,
      },
      {
        code: `max_drawdown_${computation.comboId}`,
        label: `${computation.label} · 最大回撤（≤0）`,
        value: computation.aggregate.metrics.maxDrawdown,
        unit: "ratio",
        digits: 6,
        sampleCount: computation.daysIncluded,
      },
    ]),
  ];

  // ---- charts ----
  const equityComboHigh = computations.find(
    computation => computation.direction === "HIGH" && computation.size === 5
  );
  const equityComboLow = computations.find(
    computation => computation.direction === "LOW" && computation.size === 5
  );
  const benchmarkEquity = cumulativeOf(
    (equityComboHigh ?? computations[0]!).benchmarkDaily
  );
  const equitySeries: {
    key: string;
    label: string;
    points: { x: string; y: number | null }[];
  }[] = [];
  if (equityComboHigh !== undefined) {
    equitySeries.push({
      key: "high_n5",
      label: "HIGH · Top-5 净值",
      points: equityComboHigh.equity.map(point => ({ x: point.date, y: point.value })),
    });
  }
  if (equityComboLow !== undefined) {
    equitySeries.push({
      key: "low_n5",
      label: "LOW · Top-5 净值",
      points: equityComboLow.equity.map(point => ({ x: point.date, y: point.value })),
    });
  }
  equitySeries.push({
    key: "benchmark",
    label: "当日池（基准）净值",
    points: benchmarkEquity.map(point => ({ x: point.date, y: point.value })),
  });

  const charts: ExperimentResultChart[] = [
    {
      key: "sf_excess_by_combo",
      title: `超额（组合 − 当日池）· 8 个预定义组合`,
      description:
        "横轴 = 组合；纵轴 = 组合总收益 − 基准总收益（复利口径）。8 个组合一次全给，不做择优。",
      kind: "BAR",
      xLabel: "组合",
      yLabel: "超额（ratio）",
      unit: "ratio",
      series: [
        {
          key: "excess_return",
          label: "超额（复利差）",
          points: computations.map(computation => ({
            x: computation.label,
            y: computation.aggregate.metrics.excessReturn,
          })),
        },
        {
          key: "mean_daily_excess",
          label: "日均超额",
          points: computations.map(computation => ({
            x: computation.label,
            y: equalWeightMean(computation.excessDaily.map(point => point.value)),
          })),
        },
      ],
    },
    {
      key: "sf_equity_curve_n5",
      title: "净值曲线 · Top-5（HIGH / LOW）vs 当日池",
      description:
        "每个决策日一单位资金、全仓等权、按日复利。基准 = 当日池等权。持有期重叠 ⇒ 曲线不是无风险套利的可交易曲线。",
      kind: "LINE",
      xLabel: "决策日",
      yLabel: "净值",
      unit: "ratio",
      series: equitySeries,
    },
  ];

  const disclosures = buildDisclosures(factor, universe, computations);

  const customPayload: SingleFactorPayload = {
    templateId: SINGLE_FACTOR_TEMPLATE_ID,
    contractId: SINGLE_FACTOR_CONTRACT_ID,
    experimentType: SINGLE_FACTOR_EXPERIMENT_TYPE,
    computationVersion: COMPUTATION_VERSION,
    factorCode: factor.code,
    factorLabel: factor.label,
    factorContractId: BUCKET_CONTRACT_ID,
    bucketContractId: BUCKET_CONTRACT_ID,
    factorContract: {
      ...factorContract,
      buckets: [...factorContract.buckets],
    },
    coordinate: {
      eventRelativeDay: 0,
      observationStart: OBSERVATION_START_RELATIVE_DAY,
      observationEnd: OBSERVATION_END_RELATIVE_DAY,
      informationCutoffRelativeDay: PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
      entryRelativeDay: ENTRY_DAY,
      exitRelativeDay: EXIT_RELATIVE_DAY,
      maxRelativeDay: MAX_RELATIVE_DAY,
      roundTripCostBps: ROUND_TRIP_COST_BPS,
    },
    position: POSITION_MODEL_RECORD,
    cost: costModelRecordOf(args.costInput),
    benchmark: {
      definition: BENCHMARK_DEFINITION,
      disclosure: BENCHMARK_DISCLOSURE,
    },
    universePolicy: {
      label: UNIVERSE_LABEL,
      disclosure: UNIVERSE_POLICY_DISCLOSURE,
    },
    observationPolicy: {
      statement:
        `T+${OBSERVATION_START_RELATIVE_DAY}~T+${OBSERVATION_END_RELATIVE_DAY} 是**观察窗**（信息），` +
        `不是重复买入窗；唯一入场点是 T+${ENTRY_DAY} 开盘。`,
      isEntryWindow: false,
    },
    combos: computations.map(computation => {
      const aggregate = computation.aggregate;
      const benchmarkValues = computation.benchmarkDaily.map(point => point.value);
      return {
        comboId: aggregate.comboId,
        direction: aggregate.direction,
        size: aggregate.size,
        label: aggregate.label,
        daysIncluded: aggregate.daysIncluded,
        daysExcludedSmall: aggregate.daysExcludedSmall,
        picks: computation.trades.length,
        picksPerDayMedian:
          computation.daysIncluded === 0
            ? null
            : computation.trades.length / computation.daysIncluded,
        metrics: aggregate.metrics,
        meanDailyPortfolioReturn: equalWeightMean(
          computation.netDaily.map(point => point.value)
        ),
        meanDailyBenchmarkReturn: equalWeightMean(benchmarkValues),
        meanDailyExcess: equalWeightMean(
          computation.excessDaily.map(point => point.value)
        ),
        excessCi95Low: aggregate.excessCi95Low,
        excessCi95High: aggregate.excessCi95High,
        excessVerdict: aggregate.excessVerdict,
        portfolioCi95Low: aggregate.portfolioCi95Low,
        portfolioCi95High: aggregate.portfolioCi95High,
        portfolioVerdict: aggregate.portfolioVerdict,
        dayWinRate: aggregate.dayWinRate,
        poolDayWinRate:
          benchmarkValues.length === 0
            ? null
            : benchmarkValues.filter(value => value > 0).length /
              benchmarkValues.length,
      };
    }),
    timeSlices: computations.flatMap(computation =>
      computation.timeSlices.map(slice => ({
        comboId: computation.comboId,
        year: slice.year,
        dayCount: slice.dayCount,
        tradeCount: slice.tradeCount,
        metrics: slice.metrics,
        excessMean: slice.excessMean,
        excessCi95Low: slice.excessCi95Low,
        excessCi95High: slice.excessCi95High,
        excessVerdict: slice.excessVerdict,
      }))
    ),
    dayDiagnostics,
    sampleFlow: {
      candidateCount: universe.candidateCount,
      eligibleCountBeforeFactorFilter: universe.eligibleCountBeforeFactorFilter,
      rankableSampleCount: samples.length,
      factorValueMissingCount: universe.factorValueMissingCount,
      factorMissingByCode: universe.factorMissingByCode,
      excludedByReason: universe.excludedByReason,
      duplicateEventIdCount: universe.duplicateEventIdCount,
      crossSectionPeerCount: universe.crossSectionPeerCount,
      datasetEventCount: universe.datasetEventCount,
      unscannedEventCount: universe.unscannedEventCount,
      pitObservationRowCount: universe.pitObservationRowCount,
      pitExecutionRowCount: universe.pitExecutionRowCount,
    },
    tradeArtifact,
    disclosures,
  };

  return {
    sampleSummary: {
      candidateCount: universe.candidateCount,
      eligibleCount,
      excludedCount,
      excludedByReason: universe.excludedByReason,
      notes: [
        `本模板的池子与 first-board-pullback/twelve-factor-composite-study 共用同一份样本派生` +
          `（derive.ts）⇒ 候选数 / 公共底座入池数应与那个实验逐项相同。`,
        `公共底座入池 ${universe.eligibleCountBeforeFactorFilter}；` +
          `因子 ${factor.code} 可评估 ${samples.length}；不可评估被剔 ${universe.factorValueMissingCount}。`,
        `未扫描事件数（应为 0 表示全量）：${universe.unscannedEventCount ?? "未知"}；` +
          `重复 eventId ${universe.duplicateEventIdCount}。`,
        `预定义组合 ${SINGLE_FACTOR_COMBOS.length} 个（2 方向 × ${TOP_N_SIZES.length} 档）全部输出，无择优。`,
      ],
    },
    tables,
    charts,
    statistics,
    customPayload,
  };
}

function cumulativeOf(
  daily: readonly { eventDate: string; value: number }[]
): { date: string; value: number }[] {
  let running = 1;
  return daily.map(point => {
    running *= 1 + point.value;
    return { date: point.eventDate, value: running };
  });
}

function emitTradeArtifact(
  emit: (spec: ExperimentArtifactFileSpec) => void,
  name: string,
  computations: readonly ComboComputation[]
): void {
  const header = [
    "comboId",
    "decisionDate",
    "stockCode",
    "factorValue",
    "rank",
    "poolSize",
    "signalDate",
    "entryDate",
    "entryPrice",
    "exitDate",
    "exitPrice",
    "exitRelativeDay",
    "holdingDays",
    "grossReturn",
    "cost",
    "costBps",
    "netReturn",
    "eventId",
  ];
  const chunks: Buffer[] = [Buffer.from(`${header.join(",")}\n`, "utf8")];
  let pending: string[] = [];
  const flushPending = (): void => {
    if (pending.length === 0) return;
    chunks.push(Buffer.from(pending.join(""), "utf8"));
    pending = [];
  };
  for (const computation of computations) {
    for (const trade of computation.trades) {
      pending.push(
        [
          computation.comboId,
          trade.decisionDate,
          trade.stockCode,
          trade.factorValue,
          trade.rank,
          trade.poolSize,
          trade.signalDate,
          trade.entryDate,
          trade.entryPrice,
          trade.exitDate,
          trade.exitPrice,
          trade.exitRelativeDay,
          trade.holdingDays,
          trade.grossReturn,
          trade.cost,
          trade.costBps,
          trade.netReturn,
          trade.eventId,
        ].join(",") + "\n"
      );
      if (pending.length >= 5_000) flushPending();
    }
  }
  flushPending();
  const bytes = gzipSync(Buffer.concat(chunks), { level: 6 });
  emit({
    name,
    role: "table",
    body: new Uint8Array(bytes),
    contentType: "application/gzip",
    label: "逐笔交易明细（全量，8 个组合）",
    description:
      "列为 comboId/decisionDate/stockCode/factorValue/rank/poolSize/signalDate/entryDate/" +
      "entryPrice/exitDate/exitPrice/exitRelativeDay/holdingDays/grossReturn/cost/costBps/netReturn/eventId。",
  });
}

function buildDisclosures(
  factor: SingleFactorCatalogEntry,
  universe: SingleFactorUniverseResult,
  computations: readonly ComboComputation[]
): string[] {
  const combosWithVerdict = computations.filter(
    computation => computation.aggregate.excessVerdict !== "INSUFFICIENT"
  ).length;
  return [
    `🔴 观察窗不是买入窗：T+1~T+5 只用于取信息（因子 / 排名 / 信号的信息截止日 = T+${PIT_INFORMATION_CUTOFF_RELATIVE_DAY} 收盘）；` +
      `唯一入场点是 T+${ENTRY_DAY} 开盘。把这段窗口读成「可以反复买入」是对口径的误解。`,
    `🔴 池子口径：候选池 = 12F 的入池池（要求 12 个因子全部可评估），因此 ${factor.code} 之外因子的缺失也会减少样本；` +
      `这样 12 个单因子实验跑在同一份样本上，「哪个因子更能挑」才成立。`,
    `🔴 基准不是指数：基准 = 当日全部可排名候选的等权。随机抽 N 只的期望恒等于该值 ⇒ 「正超额」= 「平均意义上优于随机抽签」，` +
      `而不是跑赢大盘。`,
    `🔴 持仓重叠：持有期 T+${ENTRY_DAY} 开盘 → T+${EXIT_RELATIVE_DAY} 收盘（5 个交易日）⇒ 相邻决策日的持仓互相重叠，` +
      `日度序列不是独立观测；CI 用 block=20 的日期聚类 Moving-Block Bootstrap 吸收这一点，但不得把 N 个决策日当 N 个独立实验。`,
    `🔴 8 个组合全部输出（2 方向 × 4 档），**没有**任何「只保留最优组合」的开关 ⇒ 结构上禁止事后择优；` +
      `但 8 个组合仍是 8 次比较，α=0.05 下假阳性期望 ≈ 0.4${combosWithVerdict === 0 ? "（本次全部 INSUFFICIENT）" : ""}，结论只能声明为**探索性**。`,
    `⚠️ 因子定义 / 桶边界 / 方向零改动：全部来自 ${BUCKET_CONTRACT_ID}（唯一落地处为 twelve-factor-composite-study/result.ts）；` +
      `本模板**不使用桶位分排序**（用因子原始值），桶词表只作留档。`,
    `⚠️ 成本口径：netReturn = grossReturn − 20bps（比例直接相减），与公共底座 derive.ts 逐字一致 ⇒ 与 12F / Top-N 的净收益逐位可比。`,
    `⚠️ 未扫描事件数：${universe.unscannedEventCount ?? "未知"}（0 = 全量成立，null = 总数未知）。`,
    `⚠️ 本 Run 是 EXPLORATORY：没有 OOS / Holdout，不构成「策略可用」的证据。`,
    `⚠️ 年切片各自做 Bootstrap 判定 ⇒ 又一批多重比较，只用于描述「是否只在某几年有效」。`,
    `⚠️ 排序并列时按 eventId 升序打破（确定性）⇒ 同一份数据重复运行结果完全一致。`,
    `⚠️ Bootstrap 种子公式：组合级 = BASE + 1000 + comboIndex×100000；组合×年 = 组合级 + (year−2000)。` +
      `因此「不同组合 / 不同年份的 CI 不同」是种子设计使然，**不能**据此推断样本不同。`,
  ];
}
