import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const DEFAULT_FORWARD_HORIZONS = [5, 10, 20] as const;
export const MAX_FORWARD_HORIZON = 20;
export const ENTRY_DAY = 1;

export const BODY_HEIGHT_BUCKETS = [
  "EQ_ZERO",
  "P0_2",
  "P2_4",
  "P4_6",
  "P6_8",
  "GE_8",
] as const;
export type BodyHeightBucket = (typeof BODY_HEIGHT_BUCKETS)[number];
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export const BODY_HEIGHT_BUCKET_LABELS: Readonly<
  Record<BodyHeightBucket, string>
> = Object.freeze({
  EQ_ZERO: "实体 ≤0.1%",
  P0_2: "实体 0.1% ~ 2%",
  P2_4: "实体 2% ~ 4%",
  P4_6: "实体 4% ~ 6%",
  P6_8: "实体 6% ~ 8%",
  GE_8: "实体 ≥8%",
});

export interface BodySample {
  eventId: string;
  eventDate: string;
  year: number;
  bodyHeight: number;
  bodyRangeRatio: number | null;
  gap: number;
  oneWordLimitUp: boolean;
  horizon: number;
  netReturn: number;
}

export interface BodyPerformanceRow {
  [key: string]: string | number | boolean | null;
  dimension: "BASELINE" | "BODY_HEIGHT";
  bucket: BodyHeightBucket | null;
  bucketLabel: string;
  horizon: number;
  sampleCount: number;
  eventDateCount: number;
  meanBodyHeight: number | null;
  meanBodyRangeRatio: number | null;
  meanGap: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
}

export const firstBoardBodyCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  informationBoundary: z.object({
    decisionOffsetDays: z.literal(0),
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  parameters: z.object({
    forwardHorizons: z.array(z.number().int().positive()),
    costBps: z.number().nonnegative(),
    bootstrapIterations: z.number().int().positive(),
    bootstrapBlockDays: z.number().int().positive(),
    bootstrapSeed: z.number().int(),
  }),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    exactLimitUpCloseCount: z.number().int().nonnegative(),
    oneWordLimitUpCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
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

export type FirstBoardBodyCustomPayload = z.infer<
  typeof firstBoardBodyCustomPayloadSchema
>;

export const EXCLUSION_REASON_LABELS = {
  NOT_FIRST_LIMIT: "事件不是首板",
  MISSING_EVENT_DAY_BAR: "缺少首板日行情",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC / 前收缺失或非法",
  EVENT_NOT_EXACT_LIMIT_UP: "首板日收盘价不等于交易所口径涨停价",
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

export function bodyHeightBucketOf(value: number): BodyHeightBucket {
  if (value <= 0.001) return "EQ_ZERO";
  if (value < 0.02) return "P0_2";
  if (value < 0.04) return "P2_4";
  if (value < 0.06) return "P4_6";
  if (value < 0.08) return "P6_8";
  return "GE_8";
}

function bodyRow(args: {
  dimension: BodyPerformanceRow["dimension"];
  bucket: BodyHeightBucket | null;
  horizon: number;
  samples: readonly BodySample[];
  costBps: number;
  bootstrapIterations: number;
  bootstrapBlockDays: number;
  bootstrapSeed: number;
}): BodyPerformanceRow {
  const values = args.samples.map(sample => sample.netReturn);
  const bootstrap = movingBlockBootstrapMean({
    samples: args.samples.map(sample => ({
      eventDate: sample.eventDate,
      value: sample.netReturn,
    })),
    iterations: args.bootstrapIterations,
    blockLength: args.bootstrapBlockDays,
    seed: args.bootstrapSeed,
  });
  const rangeValues = args.samples
    .map(sample => sample.bodyRangeRatio)
    .filter((value): value is number => value !== null);
  return {
    dimension: args.dimension,
    bucket: args.bucket,
    bucketLabel:
      args.bucket === null
        ? "全部严格涨停首板"
        : BODY_HEIGHT_BUCKET_LABELS[args.bucket],
    horizon: args.horizon,
    eventDateCount: new Set(args.samples.map(sample => sample.eventDate)).size,
    ...summarize(values, args.costBps),
    meanBodyHeight: mean(args.samples.map(sample => sample.bodyHeight)),
    meanBodyRangeRatio: mean(rangeValues),
    meanGap: mean(args.samples.map(sample => sample.gap)),
    bootstrapCi95Low: bootstrap?.low ?? null,
    bootstrapCi95High: bootstrap?.high ?? null,
    bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
  };
}

export function assembleFirstBoardBodyResult(args: {
  forwardHorizons: readonly number[];
  costBps: number;
  bootstrapIterations: number;
  bootstrapBlockDays: number;
  bootstrapSeed: number;
  samples: readonly BodySample[];
  candidateCount: number;
  eligibleCount: number;
  exactLimitUpCloseCount: number;
  oneWordLimitUpCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const rows: BodyPerformanceRow[] = [];
  for (const horizon of args.forwardHorizons) {
    const horizonSamples = args.samples.filter(
      sample => sample.horizon === horizon
    );
    rows.push(
      bodyRow({
        dimension: "BASELINE",
        bucket: null,
        horizon,
        samples: horizonSamples,
        costBps: args.costBps,
        bootstrapIterations: args.bootstrapIterations,
        bootstrapBlockDays: args.bootstrapBlockDays,
        bootstrapSeed: args.bootstrapSeed + horizon * 10,
      })
    );
    for (const bucket of BODY_HEIGHT_BUCKETS) {
      rows.push(
        bodyRow({
          dimension: "BODY_HEIGHT",
          bucket,
          horizon,
          samples: horizonSamples.filter(
            sample => bodyHeightBucketOf(sample.bodyHeight) === bucket
          ),
          costBps: args.costBps,
          bootstrapIterations: args.bootstrapIterations,
          bootstrapBlockDays: args.bootstrapBlockDays,
          bootstrapSeed:
            args.bootstrapSeed +
            horizon * 10 +
            BODY_HEIGHT_BUCKETS.indexOf(bucket) +
            1,
        })
      );
    }
  }

  const t10Rows = rows.filter(
    row => row.dimension === "BODY_HEIGHT" && row.horizon === 10
  );
  const observations: FirstBoardBodyCustomPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `严格收盘涨停首板 ${args.exactLimitUpCloseCount} 个；其中一字涨停 ${args.oneWordLimitUpCount} 个；` +
        `T+1 开盘不可买 ${args.entryUnfillableCount} 个。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        "T+10 各实体高度分桶的中位净收益：" +
        t10Rows
          .map(
            row =>
              `${row.bucketLabel} ${formatPct(row.medianNetReturn)} (n=${row.sampleCount})`
          )
          .join("；") +
        "。该比较是固定分桶描述，不代表最佳分组。",
    },
    {
      kind: "LIMITATION",
      text: "实体高度 = (首板收盘 - 首板开盘) / 首板前收；一字板实体高度为 0。",
    },
    {
      kind: "LIMITATION",
      text: "入场为 T+1 开盘，未实现盘口排队、滑点、部分成交或整手约束；同日市场涨跌未做完整中性化。",
    },
  ];

  const customPayload: FirstBoardBodyCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    informationBoundary: {
      decisionOffsetDays: 0,
      usesForwardData: true,
      forwardDataPurpose:
        "用首板日实体高度作为事件特征，观察 T+1 开盘入场后的固定视界收益。",
      decisionTimeInformation: [
        "首板日 open / high / low / close / previousClose",
        "交易所口径 limitUpPrice",
      ],
      postEventResearchOutcome: [
        "T+1 开盘入场到 T+5/T+10/T+20 收盘的净收益",
        "按首板实体高度分桶与日期聚类 Bootstrap",
      ],
      notes: [
        "只保留收盘价严格等于交易所口径涨停价的事件。",
        "实体高度只用于描述性研究，不选择最优区间。",
      ],
    },
    parameters: {
      forwardHorizons: [...args.forwardHorizons],
      costBps: args.costBps,
      bootstrapIterations: args.bootstrapIterations,
      bootstrapBlockDays: args.bootstrapBlockDays,
      bootstrapSeed: args.bootstrapSeed,
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      oneWordLimitUpCount: args.oneWordLimitUpCount,
      entryUnfillableCount: args.entryUnfillableCount,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "本实验不输出最优实体高度、策略对象或交易建议。",
      "结果只解释当前 Dataset 窗口内的样本关系，不能替代独立 Holdout。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 首板日 OHLC / 前收合法，且收盘价严格等于交易所口径涨停价。",
        `净收益 = T+${ENTRY_DAY} 开盘到退出日收盘 − ${args.costBps} bps。`,
      ],
    },
    statistics: [
      {
        code: "exact_limit_up_close_count",
        label: "严格收盘涨停首板",
        value: args.exactLimitUpCloseCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "one_word_limit_up_count",
        label: "一字涨停首板",
        value: args.oneWordLimitUpCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "entry_unfillable_count",
        label: "T+1 开盘不可买",
        value: args.entryUnfillableCount,
        unit: "个事件",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "first_board_body_return_matrix",
        title: "首板实体高度与未来收益",
        description:
          "实体高度 = (close-open)/previousClose；实体占区间比 = (close-open)/(high-low)；入场为 T+1 开盘。",
        columns: [
          { key: "dimension", label: "维度", align: "LEFT" },
          { key: "bucketLabel", label: "实体高度分组", align: "LEFT" },
          { key: "horizon", label: "退出视界", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "meanBodyHeight",
            label: "平均实体高度",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanBodyRangeRatio",
            label: "平均实体占区间",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanGap",
            label: "平均开盘跳空",
            unit: "比例",
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
    charts: args.forwardHorizons.map(horizon => ({
      key: `body-height-median-net-h${horizon}`,
      title: `T+${horizon} · 首板实体高度分桶中位净收益`,
      description: "固定分桶描述，不代表最佳实体高度。",
      kind: "BAR" as const,
      xLabel: "首板实体高度",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `body-h${horizon}`,
          label: `T+${horizon}`,
          points: BODY_HEIGHT_BUCKETS.map(bucket => ({
            x: BODY_HEIGHT_BUCKET_LABELS[bucket],
            y:
              rows.find(
                row =>
                  row.dimension === "BODY_HEIGHT" &&
                  row.bucket === bucket &&
                  row.horizon === horizon
              )?.medianNetReturn ?? null,
          })),
        },
      ],
    })),
    customPayload,
  };
}

function formatPct(value: number | null): string {
  return value === null ? "无法计算" : `${(value * 100).toFixed(2)}%`;
}
