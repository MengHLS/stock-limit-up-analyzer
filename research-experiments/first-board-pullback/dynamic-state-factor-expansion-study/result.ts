import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const ENTRY_WINDOW_DAYS = 5;
export const PULLBACK_TRIGGER_BPS = 100;
export const EXIT_DAY = 10;
export const ROUND_TRIP_COST_BPS = 20;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_922;

export type FactorSource = "CROSS_SECTION" | "HISTORY" | "EXECUTION";
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export const EXECUTION_GAP_BUCKETS = [
  "LT_NEG5",
  "NEG5_0",
  "P0_5",
  "P5_10",
  "GE_10",
] as const;
export const EXECUTION_VOLUME_BUCKETS = [
  "LT_50",
  "P50_80",
  "P80_120",
  "P120_200",
  "GE_200",
] as const;
export const HISTORY_BUCKETS = [
  "H0",
  "H1",
  "H2",
  "H3_5",
  "H6_10",
  "HGT_10",
] as const;
export const CROSS_SECTION_BUCKETS = [
  "P0_20",
  "P20_40",
  "P40_60",
  "P60_80",
  "P80_100",
] as const;

export type FactorBucket =
  | (typeof EXECUTION_GAP_BUCKETS)[number]
  | (typeof EXECUTION_VOLUME_BUCKETS)[number]
  | (typeof HISTORY_BUCKETS)[number]
  | (typeof CROSS_SECTION_BUCKETS)[number];

export const FACTOR_BUCKET_LABELS: Readonly<Record<FactorBucket, string>> =
  Object.freeze({
    LT_NEG5: "开盘跳空 < -5%",
    NEG5_0: "-5% ~ 0%",
    P0_5: "0% ~ +5%",
    P5_10: "+5% ~ +10%",
    GE_10: "≥ +10%",
    LT_50: "<50%",
    P50_80: "50% ~ 80%",
    P80_120: "80% ~ 120%",
    P120_200: "120% ~ 200%",
    GE_200: "≥200%",
    H0: "0 次",
    H1: "1 次",
    H2: "2 次",
    H3_5: "3 ~ 5 次",
    H6_10: "6 ~ 10 次",
    HGT_10: ">10 次",
    P0_20: "0 ~ 20 分位",
    P20_40: "20 ~ 40 分位",
    P40_60: "40 ~ 60 分位",
    P60_80: "60 ~ 80 分位",
    P80_100: "80 ~ 100 分位",
  });

export interface FactorTradeSample {
  eventId: string;
  eventDate: string;
  year: number;
  entryDay: number;
  grossReturn: number;
  crossSection: Readonly<Record<string, number | null>>;
  historicalLimitCount: number;
  t1OpenGap: number;
  t1VolumeRatio: number;
}

export interface FactorPerformanceRow {
  [key: string]: string | number | boolean | null;
  source: FactorSource;
  factorCode: string;
  factorLabel: string;
  bucket: FactorBucket;
  bucketLabel: string;
  sampleCount: number;
  eventDateCount: number;
  meanFactorValue: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
}

export const dynamicStateFactorExpansionSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  stateMachine: z.object({
    entryWindowDays: z.literal(ENTRY_WINDOW_DAYS),
    pullbackTriggerBps: z.literal(PULLBACK_TRIGGER_BPS),
    exitDay: z.literal(EXIT_DAY),
    costBps: z.literal(ROUND_TRIP_COST_BPS),
  }),
  informationBoundary: z.object({
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    candidateCount: z.number().int().nonnegative(),
    exactLimitUpCloseCount: z.number().int().nonnegative(),
    triggeredCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    tradeCount: z.number().int().nonnegative(),
    duplicateEventIdCount: z.number().int().nonnegative(),
    unscannedEventCount: z.number().int().nonnegative().nullable(),
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

export type DynamicStateFactorExpansionPayload = z.infer<
  typeof dynamicStateFactorExpansionSchema
>;

export const EXCLUSION_REASON_LABELS = {
  EVENT_NOT_EXACT_LIMIT_UP: "首板收盘价不等于交易所涨停价",
  MISSING_PATH: "T+1..T+10 行情路径不完整",
} as const;

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function summarize(values: readonly number[], costBps: number) {
  if (values.length === 0) {
    return {
      sampleCount: 0,
      meanNetReturn: null,
      medianNetReturn: null,
      winRateNet: null,
    };
  }
  const net = values.map(value => value - costBps / 10_000);
  return {
    sampleCount: net.length,
    meanNetReturn: round(mean(net)!),
    medianNetReturn: round(
      quantile(
        [...net].sort((a, b) => a - b),
        0.5
      )!
    ),
    winRateNet: round(net.filter(value => value > 0).length / net.length),
  };
}

export function percentileRank(
  value: number,
  peers: readonly number[]
): number {
  if (peers.length <= 1) return 0.5;
  const belowOrEqual = peers.filter(peer => peer <= value).length;
  return belowOrEqual / peers.length;
}

export function crossSectionBucketOf(
  percentile: number
): (typeof CROSS_SECTION_BUCKETS)[number] {
  if (percentile < 0.2) return "P0_20";
  if (percentile < 0.4) return "P20_40";
  if (percentile < 0.6) return "P40_60";
  if (percentile < 0.8) return "P60_80";
  return "P80_100";
}

export function historyBucketOf(
  count: number
): (typeof HISTORY_BUCKETS)[number] {
  if (count <= 0) return "H0";
  if (count === 1) return "H1";
  if (count === 2) return "H2";
  if (count <= 5) return "H3_5";
  if (count <= 10) return "H6_10";
  return "HGT_10";
}

export function gapBucketOf(
  value: number
): (typeof EXECUTION_GAP_BUCKETS)[number] {
  if (value < -0.05) return "LT_NEG5";
  if (value < 0) return "NEG5_0";
  if (value < 0.05) return "P0_5";
  if (value < 0.1) return "P5_10";
  return "GE_10";
}

export function volumeBucketOf(
  value: number
): (typeof EXECUTION_VOLUME_BUCKETS)[number] {
  if (value < 0.5) return "LT_50";
  if (value < 0.8) return "P50_80";
  if (value < 1.2) return "P80_120";
  if (value < 2) return "P120_200";
  return "GE_200";
}

export function assembleDynamicStateFactorExpansion(args: {
  samples: readonly FactorTradeSample[];
  candidateCount: number;
  exactLimitUpCloseCount: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const rows: FactorPerformanceRow[] = [];
  const addRows = (
    source: FactorSource,
    factorCode: string,
    factorLabel: string,
    samples: readonly FactorTradeSample[],
    valueOf: (sample: FactorTradeSample) => number | null,
    bucketOf: (value: number) => FactorBucket,
    buckets: readonly FactorBucket[]
  ): void => {
    for (const bucket of buckets) {
      const grouped = samples
        .map(sample => ({ sample, value: valueOf(sample) }))
        .filter(
          (item): item is { sample: FactorTradeSample; value: number } =>
            item.value !== null
        )
        .filter(item => bucketOf(item.value) === bucket);
      const bootstrap = movingBlockBootstrapMean({
        samples: grouped.map(item => ({
          eventDate: item.sample.eventDate,
          value: item.sample.grossReturn - ROUND_TRIP_COST_BPS / 10_000,
        })),
        iterations: BOOTSTRAP_ITERATIONS,
        blockLength: BOOTSTRAP_BLOCK_DAYS,
        seed: BOOTSTRAP_SEED + factorCode.length * 10 + buckets.indexOf(bucket),
      });
      rows.push({
        source,
        factorCode,
        factorLabel,
        bucket,
        bucketLabel: FACTOR_BUCKET_LABELS[bucket],
        eventDateCount: new Set(grouped.map(item => item.sample.eventDate))
          .size,
        meanFactorValue: mean(grouped.map(item => item.value)),
        ...summarize(
          grouped.map(item => item.sample.grossReturn),
          ROUND_TRIP_COST_BPS
        ),
        bootstrapCi95Low: bootstrap?.low ?? null,
        bootstrapCi95High: bootstrap?.high ?? null,
        bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
      });
    }
  };

  for (const [code, label] of [
    ["turnover_percentile", "换手率同日分位"],
    ["amplitude_percentile", "振幅同日分位"],
    ["body_percentile", "实体高度同日分位"],
    ["amount_percentile", "成交额同日分位"],
  ] as const) {
    addRows(
      "CROSS_SECTION",
      code,
      label,
      args.samples,
      sample => sample.crossSection[code] ?? null,
      crossSectionBucketOf,
      CROSS_SECTION_BUCKETS
    );
  }
  addRows(
    "HISTORY",
    "historical_limit_count",
    "历史涨停次数",
    args.samples,
    sample => sample.historicalLimitCount,
    historyBucketOf,
    HISTORY_BUCKETS
  );
  addRows(
    "EXECUTION",
    "t1_open_gap",
    "T+1 开盘缺口",
    args.samples,
    sample => sample.t1OpenGap,
    gapBucketOf,
    EXECUTION_GAP_BUCKETS
  );
  addRows(
    "EXECUTION",
    "t1_volume_ratio",
    "T+1 成交量 / T日成交量",
    args.samples,
    sample => sample.t1VolumeRatio,
    volumeBucketOf,
    EXECUTION_VOLUME_BUCKETS
  );

  const t6Rows = rows.filter(row => row.sampleCount >= 100);
  const observations: DynamicStateFactorExpansionPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `严格收盘涨停首板 ${args.exactLimitUpCloseCount} 个；触发动态入场 ${args.triggeredCount} 个；` +
        `动态交易 ${args.samples.length} 条。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `已在同日横截面、历史涨停次数、T+1 开盘缺口、T+1 相对成交量四个维度形成 ` +
        `${t6Rows.length} 个样本数≥100的分组。`,
    },
    {
      kind: "LIMITATION",
      text: "横截面分位表示同一事件日内的相对位置；历史次数因缺少过去连板高度历史，只覆盖 historicalLimitCount。",
    },
    {
      kind: "LIMITATION",
      text: "执行维度只覆盖 T+1 开盘缺口和相对成交量；封单、排队、成交概率和滑点仍无法验证。",
    },
  ];

  const customPayload: DynamicStateFactorExpansionPayload = {
    computationVersion: COMPUTATION_VERSION,
    stateMachine: {
      entryWindowDays: ENTRY_WINDOW_DAYS,
      pullbackTriggerBps: PULLBACK_TRIGGER_BPS,
      exitDay: EXIT_DAY,
      costBps: ROUND_TRIP_COST_BPS,
    },
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "在固定条件下入场后，研究横截面排名、历史涨停次数和 T+1 执行特征与动态交易收益的关系。",
      decisionTimeInformation: [
        "首板日 OHLC、换手率和成交额",
        "同日所有严格首板事件的横截面排名",
        "historicalLimitCount",
        "T+1 开盘缺口和成交量",
      ],
      postEventResearchOutcome: [
        "动态状态机净收益",
        "按横截面分位、历史涨停次数和 T+1 执行特征分桶的收益分布",
      ],
      notes: [
        "横截面分位在事件日层面计算，不使用未来日期。",
        "T+1 开盘缺口与成交量是入场执行信息，不是首板前信息。",
      ],
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      triggeredCount: args.triggeredCount,
      entryUnfillableCount: args.entryUnfillableCount,
      tradeCount: args.samples.length,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "本实验只做描述性分桶，不输出最优因子或策略参数。",
      "当前 Run 是探索性研究；结果不能替代独立 Holdout。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.exactLimitUpCloseCount,
      excludedCount: args.candidateCount - args.exactLimitUpCloseCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 首板严格收盘涨停，且 T+1..T+10 价格路径完整。",
        "同一因子缺少值时只从该因子分桶中剔除，不填 0。",
      ],
    },
    statistics: [
      {
        code: "trade_count",
        label: "动态交易",
        value: args.samples.length,
        unit: "条",
        digits: 0,
      },
      {
        code: "triggered_count",
        label: "触发回撤",
        value: args.triggeredCount,
        unit: "个事件",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "dynamic_state_factor_expansion",
        title: "动态状态机下的扩展因子",
        description:
          "CROSS_SECTION 为同日分位；HISTORY 为历史涨停次数；EXECUTION 为 T+1 开盘缺口和相对成交量。",
        columns: [
          { key: "source", label: "维度", align: "LEFT" },
          { key: "factorLabel", label: "因子", align: "LEFT" },
          { key: "bucketLabel", label: "分桶", align: "LEFT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "meanFactorValue",
            label: "平均因子值",
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
            label: "胜率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrapCi95Low",
            label: "聚类 CI95 下界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrapCi95High",
            label: "聚类 CI95 上界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
        ],
        rows,
      },
    ],
    customPayload,
  };
}
