import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const DEFAULT_FORWARD_HORIZONS = [5, 10, 20] as const;
export const MAX_FORWARD_HORIZON = 20;

export const TURNOVER_BUCKETS = [
  "LT_1",
  "P1_2",
  "P2_3",
  "P3_5",
  "P5_10",
  "GE_10",
] as const;
export type TurnoverBucket = (typeof TURNOVER_BUCKETS)[number];

export const TURNOVER_BUCKET_LABELS: Readonly<Record<TurnoverBucket, string>> = Object.freeze({
  LT_1: "换手率 <1%",
  P1_2: "换手率 1% ~ 2%",
  P2_3: "换手率 2% ~ 3%",
  P3_5: "换手率 3% ~ 5%",
  P5_10: "换手率 5% ~ 10%",
  GE_10: "换手率 ≥10%",
});

export interface ForwardSample {
  eventId: string;
  eventDate: string;
  year: number;
  turnover: number;
  floatMarketCap: number | null;
  horizon: number;
  grossReturn: number;
}

export interface TurnoverPerformanceRow {
  [key: string]: string | number | boolean | null;
  turnoverBucket: TurnoverBucket;
  turnoverLabel: string;
  horizon: number;
  sampleCount: number;
  availableCount: number;
  meanGrossReturn: number | null;
  medianGrossReturn: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapIterations: number;
  bootstrapBlockLength: number;
  bootstrapClusterCount: number;
  bootstrapSeed: number;
}

export const turnoverCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  informationBoundary: z.object({
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
    scannedRowCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    droppedByMaxEvents: z.number().int().nonnegative(),
    droppedByScanLimit: z.boolean(),
    unscannedEventCount: z.number().int().nonnegative().nullable(),
    duplicateEventIdCount: z.number().int().nonnegative(),
  }),
  availability: z.object({
    turnoverAvailableCount: z.number().int().nonnegative(),
    floatMarketCapAvailableCount: z.number().int().nonnegative(),
    floatMarketCapStatus: z.enum(["AVAILABLE", "INSUFFICIENT_DATA"]),
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

export type TurnoverCustomPayload = z.infer<typeof turnoverCustomPayloadSchema>;

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
      availableCount: 0,
      meanGrossReturn: null,
      medianGrossReturn: null,
      meanNetReturn: null,
      medianNetReturn: null,
      winRateNet: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const net = values.map((value) => value - costBps / 10_000);
  return {
    availableCount: values.length,
    meanGrossReturn: round(net.reduce((sum, value) => sum + value + costBps / 10_000, 0) / values.length),
    medianGrossReturn: round(quantile(sorted, 0.5)!),
    meanNetReturn: round(net.reduce((sum, value) => sum + value, 0) / net.length),
    medianNetReturn: round(quantile([...net].sort((a, b) => a - b), 0.5)!),
    winRateNet: round(net.filter((value) => value > 0).length / net.length),
  };
}

export function turnoverBucketOf(value: number): TurnoverBucket {
  if (value < 1) return "LT_1";
  if (value < 2) return "P1_2";
  if (value < 3) return "P2_3";
  if (value < 5) return "P3_5";
  if (value < 10) return "P5_10";
  return "GE_10";
}

export function assembleTurnoverResult(args: {
  forwardHorizons: readonly number[];
  costBps: number;
  bootstrapIterations: number;
  bootstrapBlockDays: number;
  bootstrapSeed: number;
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
  turnoverAvailableCount: number;
  floatMarketCapAvailableCount: number;
}): ExperimentResultPayload {
  const rows: TurnoverPerformanceRow[] = [];
  for (const horizon of args.forwardHorizons) {
    const horizonSamples = args.samples.filter((sample) => sample.horizon === horizon);
    for (const bucket of TURNOVER_BUCKETS) {
      const grouped = horizonSamples.filter(
        (sample) => turnoverBucketOf(sample.turnover) === bucket,
      );
      const values = grouped.map((sample) => sample.grossReturn);
      const stats = summarize(values, args.costBps);
      const bootstrap = movingBlockBootstrapMean({
        samples: grouped.map((sample) => ({
          eventDate: sample.eventDate,
          value: sample.grossReturn - args.costBps / 10_000,
        })),
        iterations: args.bootstrapIterations,
        blockLength: args.bootstrapBlockDays,
        seed: args.bootstrapSeed + horizon * 100 + TURNOVER_BUCKETS.indexOf(bucket),
      });
      rows.push({
        turnoverBucket: bucket,
        turnoverLabel: TURNOVER_BUCKET_LABELS[bucket],
        horizon,
        sampleCount: grouped.length,
        ...stats,
        bootstrapCi95Low: bootstrap?.low ?? null,
        bootstrapCi95High: bootstrap?.high ?? null,
        bootstrapIterations: bootstrap?.iterations ?? args.bootstrapIterations,
        bootstrapBlockLength: bootstrap?.blockLength ?? args.bootstrapBlockDays,
        bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
        bootstrapSeed: bootstrap?.seed ?? args.bootstrapSeed,
      });
    }
  }

  const completeRows = rows.filter((row) => row.availableCount >= 100);
  const best = [...completeRows].sort(
    (a, b) => (b.medianNetReturn ?? -Infinity) - (a.medianNetReturn ?? -Infinity),
  )[0];
  const worst = [...completeRows].sort(
    (a, b) => (a.medianNetReturn ?? Infinity) - (b.medianNetReturn ?? Infinity),
  )[0];
  const availableCount = args.floatMarketCapAvailableCount;
  const floatStatus = availableCount >= 1_000 ? "AVAILABLE" : "INSUFFICIENT_DATA";

  const observations: TurnoverCustomPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `换手率非空 ${args.turnoverAvailableCount} 个；流通市值非空 ${availableCount} 个。` +
        `日期聚类 Moving Block Bootstrap：${args.bootstrapIterations} 次，block=${args.bootstrapBlockDays} 日。`,
    },
    ...(best && worst
      ? [
          {
            kind: "COMPARATIVE" as const,
            text:
              `换手率分桶按中位净收益：最高 ${best.turnoverLabel} / T+${best.horizon} ` +
              `(${(best.medianNetReturn! * 100).toFixed(2)}%, n=${best.availableCount})；` +
              `最低 ${worst.turnoverLabel} / T+${worst.horizon} ` +
              `(${(worst.medianNetReturn! * 100).toFixed(2)}%, n=${worst.availableCount})。`,
          },
        ]
      : []),
    {
      kind: "LIMITATION",
      text:
        "Bootstrap 的 block 长度按 20 个交易日设置，以覆盖最长收益窗口；事件仍为同一 Dataset 内的探索性样本。",
    },
    {
      kind: "LIMITATION",
      text:
        floatStatus === "INSUFFICIENT_DATA"
          ? "流通市值字段在当前 Dataset 中完全缺失，流通市值与未来收益的关系无法估计。"
          : "流通市值可用，但本批次尚未单独形成市值分桶矩阵。",
    },
  ];

  const customPayload: TurnoverCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "研究首板日换手率与流通市值是否与 T+1 开盘后固定视界收益有关。",
      decisionTimeInformation: [
        "首板日 turnover",
        "首板日 floatMarketCap（当前全缺失）",
      ],
      postEventResearchOutcome: [
        "T+1 开盘到 T+5/T+10/T+20 收盘的毛收益与净收益",
        "换手率分桶、日期聚类 Moving Block Bootstrap 均值 CI",
      ],
      notes: [
        "流通市值缺失时标记 INSUFFICIENT_DATA，不生成伪分桶。",
        "Bootstrap 按事件交易日聚类，并以连续日期块重采样。",
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
      scannedRowCount: args.scannedRowCount,
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      droppedByMaxEvents: args.droppedByMaxEvents,
      droppedByScanLimit: args.droppedByScanLimit,
      unscannedEventCount: args.unscannedEventCount,
      duplicateEventIdCount: args.duplicateEventIdCount,
    },
    availability: {
      turnoverAvailableCount: args.turnoverAvailableCount,
      floatMarketCapAvailableCount: args.floatMarketCapAvailableCount,
      floatMarketCapStatus: floatStatus,
    },
    observations,
    hypotheses: [
      {
        code: "H1",
        statement: "首板日换手率高低与后续固定视界收益可能存在非线性关系。",
        rationale: "换手率反映分歧与承接强度；分桶仅用于描述，不选择最优区间。",
      },
      {
        code: "H2",
        statement: "流通市值可能与首板后的收益弹性相关。",
        rationale: "当前字段缺失，H2 暂不可检验，必须等市值数据补齐。",
      },
    ],
    notes: [
      "本实验不产出最优换手率区间或策略。",
      "Bootstrap 只解决统计不确定性，不能替代独立 Holdout。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 首板日换手率有效，且 T+1 开盘可买、后续退出可用的样本按 horizon 展开。",
        "流通市值不参与 eligible 过滤；缺失单独在 availability 中披露。",
      ],
    },
    statistics: [
      {
        code: "turnover_available_count",
        label: "换手率非空",
        value: args.turnoverAvailableCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "float_market_cap_available_count",
        label: "流通市值非空",
        value: args.floatMarketCapAvailableCount,
        unit: "个事件",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "turnover_return_matrix",
        title: "换手率与未来收益",
        description:
          "Bootstrap CI 使用按交易日聚类的 Moving Block Bootstrap，block=20 个交易日。",
        columns: [
          { key: "turnoverLabel", label: "换手率分组", align: "LEFT" },
          { key: "horizon", label: "后续视界", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "availableCount", label: "可用", align: "RIGHT" },
          { key: "meanGrossReturn", label: "平均毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianGrossReturn", label: "中位毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetReturn", label: "平均净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianNetReturn", label: "中位净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "winRateNet", label: "净收益胜率", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "bootstrapCi95Low", label: "聚类 Bootstrap CI95 下界", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "bootstrapCi95High", label: "聚类 Bootstrap CI95 上界", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "bootstrapClusterCount", label: "日期 cluster 数", align: "RIGHT" },
        ],
        rows,
      },
    ],
    charts: args.forwardHorizons.map((horizon) => ({
      key: `turnover-median-h${horizon}`,
      title: `T+${horizon} · 换手率分组中位净收益`,
      description: "换手率分桶只用于描述，不代表最佳区间。",
      kind: "BAR" as const,
      xLabel: "换手率分组",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `turnover-h${horizon}`,
          label: `T+${horizon}`,
          points: TURNOVER_BUCKETS.map((bucket) => ({
            x: TURNOVER_BUCKET_LABELS[bucket],
            y:
              rows.find(
                (row) => row.turnoverBucket === bucket && row.horizon === horizon,
              )?.medianNetReturn ?? null,
          })),
        },
      ],
    })),
    customPayload,
  };
}
