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

export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export interface VolumeTradeSample {
  eventId: string;
  eventDate: string;
  year: number;
  triggerDay: number;
  entryDay: number;
  exitDay: number;
  holdingDays: number;
  netReturn: number;
  eventVolume: number;
  preVolumeRatios: Readonly<Record<string, number | null>>;
  triggerVolumeRatio: number | null;
  entryWindowVolumeRatio: number | null;
  postVolumeRatios: Readonly<Record<string, number | null>>;
}

export const VOLUME_FACTORS = [
  { code: "pre_t_minus_1", label: "T-1日成交量 / T日成交量", source: "PRE" },
  { code: "pre_t_minus_2", label: "T-2日成交量 / T日成交量", source: "PRE" },
  { code: "pre_t_minus_5", label: "T-5日成交量 / T日成交量", source: "PRE" },
  { code: "pre_t_minus_10", label: "T-10日成交量 / T日成交量", source: "PRE" },
  {
    code: "pre_selected_avg",
    label: "T-1/-2/-5/-10 均量 / T日成交量",
    source: "PRE",
  },
  { code: "entry_trigger", label: "触发日成交量 / T日成交量", source: "ENTRY" },
  {
    code: "entry_window_avg",
    label: "入场窗口均量 / T日成交量",
    source: "ENTRY",
  },
  { code: "post_t_plus_1", label: "T+1日成交量 / T日成交量", source: "POST" },
  { code: "post_t_plus_2", label: "T+2日成交量 / T日成交量", source: "POST" },
  { code: "post_t_plus_3", label: "T+3日成交量 / T日成交量", source: "POST" },
  { code: "post_t_plus_4", label: "T+4日成交量 / T日成交量", source: "POST" },
  { code: "post_t_plus_5", label: "T+5日成交量 / T日成交量", source: "POST" },
] as const;

export const VOLUME_BUCKETS = [
  "LT_50",
  "P50_80",
  "P80_120",
  "P120_200",
  "GE_200",
] as const;
export type VolumeBucket = (typeof VOLUME_BUCKETS)[number];

export const VOLUME_BUCKET_LABELS: Readonly<Record<VolumeBucket, string>> =
  Object.freeze({
    LT_50: "<50%",
    P50_80: "50% ~ 80%",
    P80_120: "80% ~ 120%",
    P120_200: "120% ~ 200%",
    GE_200: "≥200%",
  });

export interface VolumePerformanceRow {
  [key: string]: string | number | boolean | null;
  factorCode: string;
  factorLabel: string;
  source: "PRE" | "ENTRY" | "POST";
  bucket: VolumeBucket;
  bucketLabel: string;
  sampleCount: number;
  eventDateCount: number;
  meanVolumeRatio: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
}

export const volumeRelationshipCustomPayloadSchema = z.object({
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
    eligibleCount: z.number().int().nonnegative(),
    exactLimitUpCloseCount: z.number().int().nonnegative(),
    triggeredCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    dynamicTradeCount: z.number().int().nonnegative(),
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

export type VolumeRelationshipCustomPayload = z.infer<
  typeof volumeRelationshipCustomPayloadSchema
>;

export const EXCLUSION_REASON_LABELS = {
  NOT_FIRST_LIMIT: "事件不是首板",
  MISSING_EVENT_DAY_BAR: "缺少首板日行情",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC / 前收 / 成交量缺失或非法",
  EVENT_NOT_EXACT_LIMIT_UP: "首板日收盘价不等于交易所口径涨停价",
  MISSING_ENTRY_WINDOW_PATH: "T+1..T+5 行情或成交量路径不完整",
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

export function volumeBucketOf(value: number): VolumeBucket {
  if (value < 0.5) return "LT_50";
  if (value < 0.8) return "P50_80";
  if (value < 1.2) return "P80_120";
  if (value < 2) return "P120_200";
  return "GE_200";
}

function factorValue(sample: VolumeTradeSample, code: string): number | null {
  switch (code) {
    case "pre_t_minus_1":
      return sample.preVolumeRatios["-1"] ?? null;
    case "pre_t_minus_2":
      return sample.preVolumeRatios["-2"] ?? null;
    case "pre_t_minus_5":
      return sample.preVolumeRatios["-5"] ?? null;
    case "pre_t_minus_10":
      return sample.preVolumeRatios["-10"] ?? null;
    case "pre_selected_avg": {
      const values = ["-1", "-2", "-5", "-10"]
        .map(key => sample.preVolumeRatios[key])
        .filter(
          (value): value is number => value !== null && value !== undefined
        );
      return values.length === 0 ? null : mean(values);
    }
    case "entry_trigger":
      return sample.triggerVolumeRatio;
    case "entry_window_avg":
      return sample.entryWindowVolumeRatio;
    case "post_t_plus_1":
      return sample.postVolumeRatios["1"] ?? null;
    case "post_t_plus_2":
      return sample.postVolumeRatios["2"] ?? null;
    case "post_t_plus_3":
      return sample.postVolumeRatios["3"] ?? null;
    case "post_t_plus_4":
      return sample.postVolumeRatios["4"] ?? null;
    case "post_t_plus_5":
      return sample.postVolumeRatios["5"] ?? null;
    default:
      return null;
  }
}

export function assembleVolumeRelationshipResult(args: {
  samples: readonly VolumeTradeSample[];
  candidateCount: number;
  eligibleCount: number;
  exactLimitUpCloseCount: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const rows: VolumePerformanceRow[] = [];
  for (const factor of VOLUME_FACTORS) {
    const factorSamples = args.samples
      .map(sample => ({ sample, ratio: factorValue(sample, factor.code) }))
      .filter(
        (item): item is { sample: VolumeTradeSample; ratio: number } =>
          item.ratio !== null
      );
    for (const bucket of VOLUME_BUCKETS) {
      const grouped = factorSamples.filter(
        item => volumeBucketOf(item.ratio) === bucket
      );
      const bootstrap = movingBlockBootstrapMean({
        samples: grouped.map(item => ({
          eventDate: item.sample.eventDate,
          value: item.sample.netReturn - ROUND_TRIP_COST_BPS / 10_000,
        })),
        iterations: BOOTSTRAP_ITERATIONS,
        blockLength: BOOTSTRAP_BLOCK_DAYS,
        seed:
          BOOTSTRAP_SEED +
          VOLUME_FACTORS.findIndex(item => item.code === factor.code) * 10 +
          VOLUME_BUCKETS.indexOf(bucket),
      });
      rows.push({
        factorCode: factor.code,
        factorLabel: factor.label,
        source: factor.source,
        bucket,
        bucketLabel: VOLUME_BUCKET_LABELS[bucket],
        eventDateCount: new Set(grouped.map(item => item.sample.eventDate))
          .size,
        meanVolumeRatio: mean(grouped.map(item => item.ratio)),
        ...summarize(
          grouped.map(item => item.sample.netReturn),
          ROUND_TRIP_COST_BPS
        ),
        bootstrapCi95Low: bootstrap?.low ?? null,
        bootstrapCi95High: bootstrap?.high ?? null,
        bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
      });
    }
  }

  const observations: VolumeRelationshipCustomPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `严格收盘涨停首板 ${args.exactLimitUpCloseCount} 个；触发 ${args.triggeredCount} 个；` +
        `触发后不可买 ${args.entryUnfillableCount} 个；动态交易 ${args.samples.length} 条。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        "成交量关系按 T日成交量归一化。PRE 因子在入场前已知；ENTRY 因子在触发时已知；" +
        "POST 因子是入场后的成交量路径，只用于描述，不参与入场选择。",
    },
    {
      kind: "LIMITATION",
      text: "成交量分桶只用于描述关系，不选择最优量比区间，也不改变固定状态机入场和退出规则。",
    },
    {
      kind: "LIMITATION",
      text: "当前 Run 为探索性研究；结果不能替代独立 Holdout 或完整成交模型。",
    },
  ];

  const customPayload: VolumeRelationshipCustomPayload = {
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
        "固定状态机完成条件入场和动态退出后，研究 T-n、T 触发日和 T+N 成交量相对 T 日成交量的关系。",
      decisionTimeInformation: [
        "T日及之前的成交量",
        "T+1..T+5 触发路径上的价格和成交量",
      ],
      postEventResearchOutcome: [
        "动态退出的净收益",
        "按 T-n/T、触发日/T、T+N/T 量比分桶的收益分布",
      ],
      notes: [
        "PRE 与 ENTRY 因子在买入决策前可见。",
        "POST 因子只用于研究未来量价关系，不反向筛选入场。",
      ],
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      triggeredCount: args.triggeredCount,
      entryUnfillableCount: args.entryUnfillableCount,
      dynamicTradeCount: args.samples.length,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "本实验不输出最优成交量阈值或策略对象。",
      "状态机入场和退出规则在所有成交量分桶中完全一致。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 严格收盘涨停首板，且 T+1..T+5 价格和成交量路径完整。",
        "成交量缺失不会伪造为 0；对应因子格子不纳入样本。",
      ],
    },
    statistics: [
      {
        code: "triggered_count",
        label: "触发动态入场",
        value: args.triggeredCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "dynamic_trade_count",
        label: "动态交易样本",
        value: args.samples.length,
        unit: "条",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "volume_relationship_matrix",
        title: "成交量关系与动态交易收益",
        description:
          "所有量比均除以 T日成交量；PRE 和 ENTRY 是入场前信息，POST 是入场后路径信息。",
        columns: [
          { key: "source", label: "阶段", align: "LEFT" },
          { key: "factorLabel", label: "成交量关系", align: "LEFT" },
          { key: "bucketLabel", label: "量比分桶", align: "LEFT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "meanVolumeRatio",
            label: "平均量比",
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
