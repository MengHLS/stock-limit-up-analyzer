import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const CONTEXT_DAYS = 5;
export const ENTRY_DAY = 6;
export const EXIT_DAY = 10;
export const ROUND_TRIP_COST_BPS = 20;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_922;

export const STREAK_VALUES = [0, 1, 2, 3, 4, 5] as const;
export type StreakValue = (typeof STREAK_VALUES)[number];
export type HoldMode = "CLOSE" | "LOW";
export type AmplitudeDimension = "MEAN" | "MAX";
export type AmplitudeBucket =
  | "LT4"
  | "P4_6"
  | "P6_8"
  | "GE8"
  | "MAX_LT8"
  | "MAX_GE8";

export const AMPLITUDE_BUCKET_LABELS: Readonly<
  Record<AmplitudeBucket, string>
> = Object.freeze({
  LT4: "平均振幅 <4%",
  P4_6: "平均振幅 4%~6%",
  P6_8: "平均振幅 6%~8%",
  GE8: "平均振幅 ≥8%",
  MAX_LT8: "最大日振幅 <8%",
  MAX_GE8: "最大日振幅 ≥8%",
});

export interface InteractionSample {
  eventId: string;
  eventDate: string;
  year: number;
  closeHoldStreak: StreakValue;
  lowHoldStreak: StreakValue;
  meanAmplitude: number;
  maxAmplitude: number;
  grossReturn: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  positive2First: boolean;
  negative2First: boolean;
  take2GrossReturn: number;
  stop2GrossReturn: number;
  symmetric2GrossReturn: number;
}

export interface InteractionPerformanceRow {
  [key: string]: string | number | boolean | null;
  mode: HoldMode;
  streak: StreakValue;
  amplitudeDimension: AmplitudeDimension;
  amplitudeBucket: AmplitudeBucket;
  amplitudeLabel: string;
  sampleCount: number;
  eventDateCount: number;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
  meanMfe: number | null;
  medianMfe: number | null;
  meanMae: number | null;
  medianMae: number | null;
  positive2FirstRate: number | null;
  negative2FirstRate: number | null;
  meanTake2NetReturn: number | null;
  meanStop2NetReturn: number | null;
  meanSymmetric2NetReturn: number | null;
}

export const holdStreakAmplitudeT10Schema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  rule: z.object({
    contextDays: z.literal(CONTEXT_DAYS),
    entryDay: z.literal(ENTRY_DAY),
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
    contextCompleteCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    sampleCount: z.number().int().nonnegative(),
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

export type HoldStreakAmplitudeT10Payload = z.infer<
  typeof holdStreakAmplitudeT10Schema
>;

export const EXCLUSION_REASON_LABELS = {
  EVENT_NOT_EXACT_LIMIT_UP: "首板收盘价不等于交易所涨停价",
  MISSING_CONTEXT: "T+1..T+5 行情路径不完整",
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

export function meanAmplitudeBucketOf(value: number): AmplitudeBucket {
  if (value < 0.04) return "LT4";
  if (value < 0.06) return "P4_6";
  if (value < 0.08) return "P6_8";
  return "GE8";
}

export function maxAmplitudeBucketOf(value: number): AmplitudeBucket {
  return value < 0.08 ? "MAX_LT8" : "MAX_GE8";
}

export function assembleHoldStreakAmplitudeT10(args: {
  samples: readonly InteractionSample[];
  candidateCount: number;
  exactLimitUpCloseCount: number;
  contextCompleteCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const rows: InteractionPerformanceRow[] = [];
  const dimensions: Array<{
    dimension: AmplitudeDimension;
    buckets: readonly AmplitudeBucket[];
    bucketOf: (sample: InteractionSample) => AmplitudeBucket;
  }> = [
    {
      dimension: "MEAN",
      buckets: ["LT4", "P4_6", "P6_8", "GE8"],
      bucketOf: sample => meanAmplitudeBucketOf(sample.meanAmplitude),
    },
    {
      dimension: "MAX",
      buckets: ["MAX_LT8", "MAX_GE8"],
      bucketOf: sample => maxAmplitudeBucketOf(sample.maxAmplitude),
    },
  ];
  for (const mode of ["CLOSE", "LOW"] as const) {
    for (const streak of STREAK_VALUES) {
      for (const dimension of dimensions) {
        for (const bucket of dimension.buckets) {
          const grouped = args.samples.filter(
            sample =>
              (mode === "CLOSE"
                ? sample.closeHoldStreak === streak
                : sample.lowHoldStreak === streak) &&
              dimension.bucketOf(sample) === bucket
          );
          const bootstrap = movingBlockBootstrapMean({
            samples: grouped.map(sample => ({
              eventDate: sample.eventDate,
              value: sample.grossReturn - ROUND_TRIP_COST_BPS / 10_000,
            })),
            iterations: BOOTSTRAP_ITERATIONS,
            blockLength: BOOTSTRAP_BLOCK_DAYS,
            seed:
              BOOTSTRAP_SEED +
              streak * 1_000 +
              (mode === "CLOSE" ? 0 : 100) +
              dimension.buckets.indexOf(bucket),
          });
          rows.push({
            mode,
            streak,
            amplitudeDimension: dimension.dimension,
            amplitudeBucket: bucket,
            amplitudeLabel: AMPLITUDE_BUCKET_LABELS[bucket],
            eventDateCount: new Set(grouped.map(sample => sample.eventDate))
              .size,
            ...summarize(
              grouped.map(sample => sample.grossReturn),
              ROUND_TRIP_COST_BPS
            ),
            bootstrapCi95Low: bootstrap?.low ?? null,
            bootstrapCi95High: bootstrap?.high ?? null,
            bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
            meanMfe: mean(grouped.map(sample => sample.maxFavorableExcursion)),
            medianMfe: quantile(
              [...grouped.map(sample => sample.maxFavorableExcursion)].sort(
                (a, b) => a - b
              ),
              0.5
            ),
            meanMae: mean(grouped.map(sample => sample.maxAdverseExcursion)),
            medianMae: quantile(
              [...grouped.map(sample => sample.maxAdverseExcursion)].sort(
                (a, b) => a - b
              ),
              0.5
            ),
            positive2FirstRate:
              grouped.length === 0
                ? null
                : grouped.filter(sample => sample.positive2First).length /
                  grouped.length,
            negative2FirstRate:
              grouped.length === 0
                ? null
                : grouped.filter(sample => sample.negative2First).length /
                  grouped.length,
            meanTake2NetReturn:
              mean(grouped.map(sample => sample.take2GrossReturn)) === null
                ? null
                : mean(grouped.map(sample => sample.take2GrossReturn))! -
                  ROUND_TRIP_COST_BPS / 10_000,
            meanStop2NetReturn:
              mean(grouped.map(sample => sample.stop2GrossReturn)) === null
                ? null
                : mean(grouped.map(sample => sample.stop2GrossReturn))! -
                  ROUND_TRIP_COST_BPS / 10_000,
            meanSymmetric2NetReturn:
              mean(grouped.map(sample => sample.symmetric2GrossReturn)) === null
                ? null
                : mean(grouped.map(sample => sample.symmetric2GrossReturn))! -
                  ROUND_TRIP_COST_BPS / 10_000,
          });
        }
      }
    }
  }

  const closeFive = rows.find(
    row =>
      row.mode === "CLOSE" &&
      row.streak === 5 &&
      row.amplitudeDimension === "MEAN" &&
      row.amplitudeBucket === "LT4"
  );
  const lowFive = rows.find(
    row =>
      row.mode === "LOW" &&
      row.streak === 5 &&
      row.amplitudeDimension === "MEAN" &&
      row.amplitudeBucket === "LT4"
  );
  const observations: HoldStreakAmplitudeT10Payload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `严格涨停首板 ${args.exactLimitUpCloseCount} 个；上下文完整 ${args.contextCompleteCount} 个；` +
        `T+6 不可买 ${args.entryUnfillableCount} 个；有效样本 ${args.samples.length} 条。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `T+6→T+10：收盘不破5日且平均振幅<4% 中位净收益 ` +
        `${formatPct(closeFive?.medianNetReturn ?? null)}；` +
        `盘中不破5日且平均振幅<4% 中位 ` +
        `${formatPct(lowFive?.medianNetReturn ?? null)}。`,
    },
    {
      kind: "LIMITATION",
      text: "振幅定义为 (high-low)/preClose；平均振幅和最大单日振幅单独交叉。",
    },
    {
      kind: "LIMITATION",
      text: "入场固定 T+6 开盘、退出固定 T+10 收盘；+2%/-2% 规则仅作为同一格子内的辅助比较。",
    },
  ];

  const customPayload: HoldStreakAmplitudeT10Payload = {
    computationVersion: COMPUTATION_VERSION,
    rule: {
      contextDays: CONTEXT_DAYS,
      entryDay: ENTRY_DAY,
      exitDay: EXIT_DAY,
      costBps: ROUND_TRIP_COST_BPS,
    },
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "T+1..T+5 只用于计算守线 streak 和振幅；T+6 开盘入场观察 T+10 退出。",
      decisionTimeInformation: [
        "首板日涨停价",
        "T+1..T+5 的 high / low / close / preClose",
      ],
      postEventResearchOutcome: [
        "T+6 开盘到 T+10 收盘净收益",
        "MFE、MAE、±2% 首次到达方向及辅助退出规则",
      ],
      notes: [
        "所有交叉格子使用相同的 T+6→T+10 基准退出。",
        "平均振幅和最大单日振幅分别分桶。",
      ],
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      contextCompleteCount: args.contextCompleteCount,
      entryUnfillableCount: args.entryUnfillableCount,
      sampleCount: args.samples.length,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "本实验不选择最优 streak 或振幅区间。",
      "结果仅用于判断“低振幅且不破涨停价”是否具有增量。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.contextCompleteCount,
      excludedCount: args.candidateCount - args.contextCompleteCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 严格涨停首板，且 T+1..T+5 路径完整。",
        "T+6 不可买只影响交易样本。",
      ],
    },
    statistics: [
      {
        code: "sample_count",
        label: "T+6→T+10有效样本",
        value: args.samples.length,
        unit: "条",
        digits: 0,
      },
      {
        code: "close_hold5_low_amp_median",
        label: "收盘不破5日+低振幅中位",
        value: closeFive?.medianNetReturn ?? null,
        unit: "比例",
        digits: 6,
      },
      {
        code: "low_hold5_low_amp_median",
        label: "盘中不破5日+低振幅中位",
        value: lowFive?.medianNetReturn ?? null,
        unit: "比例",
        digits: 6,
      },
    ],
    tables: [
      {
        key: "hold_streak_amplitude_t10_matrix",
        title: "守线 streak × 振幅：T+6→T+10",
        description:
          "每行固定 T+6 开盘入场、T+10 收盘退出；同时给出 MFE/MAE 和 ±2% 竞争辅助指标。",
        columns: [
          { key: "mode", label: "守线口径", align: "LEFT" },
          { key: "streak", label: "连续天数", align: "RIGHT" },
          { key: "amplitudeDimension", label: "振幅维度", align: "LEFT" },
          { key: "amplitudeLabel", label: "振幅分组", align: "LEFT" },
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
          {
            key: "meanMfe",
            label: "平均MFE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianMfe",
            label: "中位MFE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanMae",
            label: "平均MAE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianMae",
            label: "中位MAE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "positive2FirstRate",
            label: "+2%先到率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "negative2FirstRate",
            label: "-2%先到率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanTake2NetReturn",
            label: "+2%止盈平均",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanStop2NetReturn",
            label: "-2%止损平均",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanSymmetric2NetReturn",
            label: "±2%对称平均",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
        ],
        rows,
      },
    ],
    charts: [
      {
        key: "hold5-amplitude-median",
        title: "连续5日守线 × 平均振幅的中位收益",
        description: "仅展示 streak=5；T+6→T+10。",
        kind: "BAR" as const,
        xLabel: "振幅分组",
        yLabel: "中位净收益",
        unit: "比例",
        series: ["CLOSE", "LOW"].map(mode => ({
          key: `mode-${mode}`,
          label: mode === "CLOSE" ? "收盘守线" : "盘中守线",
          points: (["LT4", "P4_6", "P6_8", "GE8"] as const).map(bucket => ({
            x: AMPLITUDE_BUCKET_LABELS[bucket],
            y:
              rows.find(
                row =>
                  row.mode === mode &&
                  row.streak === 5 &&
                  row.amplitudeDimension === "MEAN" &&
                  row.amplitudeBucket === bucket
              )?.medianNetReturn ?? null,
          })),
        })),
      },
    ],
    customPayload,
  };
}

function formatPct(value: number | null): string {
  return value === null ? "无法计算" : `${(value * 100).toFixed(2)}%`;
}
