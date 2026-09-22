import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";

export const COMPUTATION_VERSION = "1.0.0";
export const CONTEXT_DAYS = 5;
export const ENTRY_DAY = CONTEXT_DAYS + 1;
export const DEFAULT_FORWARD_HORIZONS = [10, 15, 20] as const;
export const MAX_FORWARD_HORIZON = 20;

export const AMPLITUDE_BUCKETS = [
  "LT_2",
  "P2_4",
  "P4_6",
  "P6_8",
  "GE_8",
] as const;
export type AmplitudeBucket = (typeof AMPLITUDE_BUCKETS)[number];
export type ObservationKind = "DESCRIPTIVE" | "COMPARATIVE" | "POTENTIAL_SIGNAL" | "LIMITATION";

export const AMPLITUDE_BUCKET_LABELS: Readonly<Record<AmplitudeBucket, string>> = Object.freeze({
  LT_2: "平均振幅 <2%",
  P2_4: "平均振幅 2% ~ 4%",
  P4_6: "平均振幅 4% ~ 6%",
  P6_8: "平均振幅 6% ~ 8%",
  GE_8: "平均振幅 ≥8%",
});

export type LimitContext = "NO_LIMIT" | "HAD_LIMIT";

export interface ContextSample {
  eventId: string;
  year: number;
  limitContext: LimitContext;
  meanAmplitude: number | null;
  maxAmplitude: number | null;
  amplitudeBucket: AmplitudeBucket | null;
}

export interface ForwardSample {
  eventId: string;
  year: number;
  sample: ContextSample;
  horizon: number;
  grossReturn: number;
}

export interface ContextPerformanceRow {
  [key: string]: string | number | boolean | null;
  dimension: "LIMIT_STATUS" | "AMPLITUDE";
  limitContext: LimitContext;
  amplitudeBucket: AmplitudeBucket | null;
  amplitudeLabel: string | null;
  horizon: number;
  sampleCount: number;
  availableCount: number;
  meanGrossReturn: number | null;
  medianGrossReturn: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  meanNetCi95Low: number | null;
  meanNetCi95High: number | null;
}

export const postEventAmplitudeCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  informationBoundary: z.object({
    decisionOffsetDays: z.literal(CONTEXT_DAYS),
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  parameters: z.object({
    contextDays: z.literal(CONTEXT_DAYS),
    entryDay: z.literal(ENTRY_DAY),
    forwardHorizons: z.array(z.number().int().positive()),
    costBps: z.number().nonnegative(),
  }),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    scannedRowCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    droppedByMaxEvents: z.number().int().nonnegative(),
    droppedByScanLimit: z.boolean(),
    unscannedEventCount: z.number().int().nonnegative().nullable(),
    duplicateEventIdCount: z.number().int().nonnegative(),
  }),
  contextCounts: z.object({
    noLimitCount: z.number().int().nonnegative(),
    hadLimitCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
  }),
  observations: z.array(
    z.object({
      kind: z.enum(["DESCRIPTIVE", "COMPARATIVE", "POTENTIAL_SIGNAL", "LIMITATION"]),
      text: z.string().min(1),
    }),
  ),
  hypotheses: z.array(
    z.object({
      code: z.string().min(1),
      statement: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
  notes: z.array(z.string().min(1)),
});

export type PostEventAmplitudeCustomPayload = z.infer<
  typeof postEventAmplitudeCustomPayloadSchema
>;

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

function ci95(values: readonly number[]): { low: number; high: number } | null {
  if (values.length < 2) return null;
  const avg = mean(values);
  if (avg === null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  const standardError = Math.sqrt(variance / values.length);
  return { low: avg - 1.96 * standardError, high: avg + 1.96 * standardError };
}

function summarize(values: readonly number[], costBps: number) {
  if (values.length === 0) {
    return {
      availableCount: 0,
      meanGrossReturn: null,
      medianGrossReturn: null,
      meanNetReturn: null,
      medianNetReturn: null,
      winRateNet: null,
      meanNetCi95Low: null,
      meanNetCi95High: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const net = values.map((value) => value - costBps / 10_000);
  const ci = ci95(net);
  return {
    availableCount: values.length,
    meanGrossReturn: round(mean(values)!),
    medianGrossReturn: round(quantile(sorted, 0.5)!),
    meanNetReturn: round(mean(net)!),
    medianNetReturn: round(quantile([...net].sort((a, b) => a - b), 0.5)!),
    winRateNet: round(net.filter((value) => value > 0).length / net.length),
    meanNetCi95Low: ci === null ? null : round(ci.low),
    meanNetCi95High: ci === null ? null : round(ci.high),
  };
}

export function amplitudeBucketOf(value: number | null): AmplitudeBucket | null {
  if (value === null) return null;
  if (value < 0.02) return "LT_2";
  if (value < 0.04) return "P2_4";
  if (value < 0.06) return "P4_6";
  if (value < 0.08) return "P6_8";
  return "GE_8";
}

function row(args: {
  dimension: ContextPerformanceRow["dimension"];
  limitContext: LimitContext;
  amplitudeBucket?: AmplitudeBucket | null;
  horizon: number;
  samples: readonly ForwardSample[];
  costBps: number;
}): ContextPerformanceRow {
  const values = args.samples.map((sample) => sample.grossReturn);
  return {
    dimension: args.dimension,
    limitContext: args.limitContext,
    amplitudeBucket: args.amplitudeBucket ?? null,
    amplitudeLabel: args.amplitudeBucket
      ? AMPLITUDE_BUCKET_LABELS[args.amplitudeBucket]
      : null,
    horizon: args.horizon,
    sampleCount: values.length,
    ...summarize(values, args.costBps),
  };
}

export function assemblePostEventAmplitudeResult(args: {
  forwardHorizons: readonly number[];
  costBps: number;
  samples: readonly ForwardSample[];
  candidateCount: number;
  eligibleCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  scannedRowCount: number;
  droppedByMaxEvents: number;
  droppedByScanLimit: boolean;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
  noLimitCount: number;
  hadLimitCount: number;
  entryUnfillableCount: number;
}): ExperimentResultPayload {
  const rows: ContextPerformanceRow[] = [];
  for (const horizon of args.forwardHorizons) {
    const horizonSamples = args.samples.filter((sample) => sample.horizon === horizon);
    for (const limitContext of ["NO_LIMIT", "HAD_LIMIT"] as const) {
      rows.push(
        row({
          dimension: "LIMIT_STATUS",
          limitContext,
          horizon,
          samples: horizonSamples.filter((sample) => sample.sample.limitContext === limitContext),
          costBps: args.costBps,
        }),
      );
    }
    for (const bucket of AMPLITUDE_BUCKETS) {
      rows.push(
        row({
          dimension: "AMPLITUDE",
          limitContext: "NO_LIMIT",
          amplitudeBucket: bucket,
          horizon,
          samples: horizonSamples.filter(
            (sample) =>
              sample.sample.limitContext === "NO_LIMIT" &&
              sample.sample.amplitudeBucket === bucket,
          ),
          costBps: args.costBps,
        }),
      );
    }
  }

  const amplitudeRows = rows.filter(
    (item) => item.dimension === "AMPLITUDE" && item.availableCount >= 100,
  );
  const best = [...amplitudeRows].sort(
    (a, b) => (b.medianNetReturn ?? -Infinity) - (a.medianNetReturn ?? -Infinity),
  )[0];
  const worst = [...amplitudeRows].sort(
    (a, b) => (a.medianNetReturn ?? Infinity) - (b.medianNetReturn ?? Infinity),
  )[0];

  const observations: PostEventAmplitudeCustomPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `T+1..T+5 均未触及涨跌停的事件 ${args.noLimitCount} 个；` +
        `期间至少一次触及涨跌停的事件 ${args.hadLimitCount} 个；` +
        `T+6 开盘不可买 ${args.entryUnfillableCount} 个。`,
    },
    best && worst
      ? {
          kind: "COMPARATIVE",
          text:
            `无涨跌停组内按平均日振幅分桶：最高中位净收益 ${best.amplitudeLabel} / T+${best.horizon} ` +
            `(${(best.medianNetReturn! * 100).toFixed(2)}%, n=${best.availableCount})；` +
            `最低 ${worst.amplitudeLabel} / T+${worst.horizon} ` +
            `(${(worst.medianNetReturn! * 100).toFixed(2)}%, n=${worst.availableCount})。` +
            "仅作样本内描述，尚未做日期聚类 Bootstrap 或 Holdout。",
        }
      : {
          kind: "LIMITATION",
          text: "振幅分桶缺少样本数 ≥100 的可用格子，无法给出最高 / 最低描述。",
        },
    {
      kind: "LIMITATION",
      text:
        "振幅定义 = (high-low)/preClose；T+1..T+5 只要 high 触及涨停价或 low 触及跌停价，即归入 HAD_LIMIT。",
    },
    {
      kind: "LIMITATION",
      text:
        "入场为 T+6 开盘，未实现盘中择时；停牌、开盘涨停不可买会直接导致该视界缺失。",
    },
  ];

  const customPayload: PostEventAmplitudeCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    informationBoundary: {
      decisionOffsetDays: CONTEXT_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        "观察首板后 T+1..T+5 的涨跌停状态和单日振幅，与 T+6 开盘后固定视界收益的关系。",
      decisionTimeInformation: [
        "T+1..T+5 的 OHLC、preClose、涨跌停价与停牌状态",
        "每日期振幅 (high-low)/preClose",
      ],
      postEventResearchOutcome: [
        "T+6 开盘到 T+10/T+15/T+20 收盘的毛收益与净收益",
        "按是否触及涨跌停和平均振幅分桶汇总",
      ],
      notes: [
        "T+1..T+5 全部路径必须齐备且合法，否则事件不进入 eligible。",
        "涨跌停触及使用 high/low 与交易所涨跌停价比较。",
      ],
    },
    parameters: {
      contextDays: CONTEXT_DAYS,
      entryDay: ENTRY_DAY,
      forwardHorizons: [...args.forwardHorizons],
      costBps: args.costBps,
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      scannedRowCount: args.scannedRowCount,
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      droppedByMaxEvents: args.droppedByMaxEvents,
      droppedByScanLimit: args.droppedByScanLimit,
      unscannedEventCount: args.unscannedEventCount,
      duplicateEventIdCount: args.duplicateEventIdCount,
    },
    contextCounts: {
      noLimitCount: args.noLimitCount,
      hadLimitCount: args.hadLimitCount,
      entryUnfillableCount: args.entryUnfillableCount,
    },
    observations,
    hypotheses: [
      {
        code: "H1",
        statement: "T+1..T+5 未触及涨跌停的样本，其后续收益分布可能不同于期间触及涨跌停的样本。",
        rationale: "涨跌停状态刻画情绪极值与流动性约束。",
      },
      {
        code: "H2",
        statement: "在未触及涨跌停的样本中，平均单日振幅可能与后续收益存在非线性关系。",
        rationale: "振幅反映多空分歧与换手激烈程度，但本实验不选择最佳振幅阈值。",
      },
    ],
    notes: [
      "本实验只输出描述性分组，不产出最优振幅区间或策略。",
      "所有分组统计均为样本内结果，未做多重比较校正。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 首板日有效且 T+1..T+5 OHLC/preClose/涨跌停价完整。",
        `后续收益从 T+${ENTRY_DAY} 开盘开始，避免复用 T+1..T+5 的决策窗口涨幅。`,
      ],
    },
    statistics: [
      {
        code: "no_limit_count",
        label: "T+1..T+5 未触及涨跌停",
        value: args.noLimitCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "had_limit_count",
        label: "T+1..T+5 至少一次触及涨跌停",
        value: args.hadLimitCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "entry_unfillable_count",
        label: "T+6 开盘不可买",
        value: args.entryUnfillableCount,
        unit: "个事件",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "post_event_amplitude_matrix",
        title: "首板后无涨跌停与振幅矩阵",
        description:
          "LIMIT_STATUS 比较是否触及涨跌停；AMPLITUDE 只统计未触及涨跌停组，按平均日振幅分桶。",
        columns: [
          { key: "dimension", label: "维度", align: "LEFT" },
          { key: "limitContext", label: "涨跌停状态", align: "LEFT" },
          { key: "amplitudeLabel", label: "振幅分组", align: "LEFT" },
          { key: "horizon", label: "后续视界", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "availableCount", label: "可用", align: "RIGHT" },
          { key: "meanGrossReturn", label: "平均毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianGrossReturn", label: "中位毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetReturn", label: "平均净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianNetReturn", label: "中位净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "winRateNet", label: "净收益胜率", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetCi95Low", label: "CI95 下界", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetCi95High", label: "CI95 上界", unit: "比例", digits: 6, align: "RIGHT" },
        ],
        rows,
      },
    ],
    charts: args.forwardHorizons.map((horizon) => ({
      key: `amplitude-median-net-h${horizon}`,
      title: `T+${horizon} · 无涨跌停组按平均振幅的中位净收益`,
      description: "振幅分桶只用于描述，不代表最佳振幅区间。",
      kind: "BAR" as const,
      xLabel: "平均日振幅",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `amplitude-h${horizon}`,
          label: `T+${horizon}`,
          points: AMPLITUDE_BUCKETS.map((bucket) => ({
            x: bucket,
            y:
              rows.find(
                (item) =>
                  item.dimension === "AMPLITUDE" &&
                  item.amplitudeBucket === bucket &&
                  item.horizon === horizon,
              )?.medianNetReturn ?? null,
          })),
        },
      ],
    })),
    customPayload,
  };
}
