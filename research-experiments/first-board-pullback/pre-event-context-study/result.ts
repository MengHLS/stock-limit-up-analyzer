import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";

export const COMPUTATION_VERSION = "1.0.0";
export const DEFAULT_PRE_RETURN_WINDOWS = [5, 10, 20] as const;
export const DEFAULT_FORWARD_HORIZONS = [5, 10, 20] as const;
export const MAX_PREFIX_DAYS = 20;
export const MAX_FORWARD_HORIZON = 20;

export const GAP_GROUPS = [
  "UNKNOWN",
  "GAP_1_3",
  "GAP_4_5",
  "GAP_6_10",
  "GAP_11_20",
  "GAP_OVER_20",
] as const;
export type GapGroup = (typeof GAP_GROUPS)[number];

export const GAP_GROUP_LABELS: Readonly<Record<GapGroup, string>> = Object.freeze({
  UNKNOWN: "无已知前次涨停 / 历史未知",
  GAP_1_3: "前次涨停间隔 1–3 日",
  GAP_4_5: "前次涨停间隔 4–5 日",
  GAP_6_10: "前次涨停间隔 6–10 日",
  GAP_11_20: "前次涨停间隔 11–20 日",
  GAP_OVER_20: "前次涨停间隔 >20 日",
});

export const PRE_RETURN_BUCKETS = [
  "LT_NEG10",
  "NEG10_NEG5",
  "NEG5_ZERO",
  "ZERO_POS5",
  "POS5_POS10",
  "POS10_POS20",
  "GT_POS20",
] as const;
export type PreReturnBucket = (typeof PRE_RETURN_BUCKETS)[number];
export type ObservationKind = "DESCRIPTIVE" | "COMPARATIVE" | "POTENTIAL_SIGNAL" | "LIMITATION";

export const PRE_RETURN_BUCKET_LABELS: Readonly<Record<PreReturnBucket, string>> = Object.freeze({
  LT_NEG10: "< -10%",
  NEG10_NEG5: "-10% ~ -5%",
  NEG5_ZERO: "-5% ~ 0%",
  ZERO_POS5: "0% ~ +5%",
  POS5_POS10: "+5% ~ +10%",
  POS10_POS20: "+10% ~ +20%",
  GT_POS20: "> +20%",
});

export interface PreEventSample {
  eventId: string;
  year: number;
  gapDays: number | null;
  gapGroup: GapGroup;
  preReturns: Readonly<Record<number, number | null>>;
}

export interface ForwardSample {
  eventId: string;
  year: number;
  sample: PreEventSample;
  horizon: number;
  grossReturn: number;
}

export interface ContextPerformanceRow {
  [key: string]: string | number | boolean | null;
  dimension: "GAP" | "PRE_RETURN" | "GAP_X_PRE_RETURN";
  preWindow: number | null;
  gapGroup: GapGroup | null;
  gapLabel: string | null;
  preReturnBucket: PreReturnBucket | null;
  preReturnLabel: string | null;
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

export const preEventContextCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  informationBoundary: z.object({
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  parameters: z.object({
    preReturnWindows: z.array(z.number().int().positive()),
    forwardHorizons: z.array(z.number().int().positive()),
    primaryInteractionWindow: z.number().int().positive(),
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
    gapKnownCount: z.number().int().nonnegative(),
    gapUnknownCount: z.number().int().nonnegative(),
    allPreReturnWindowsAvailableCount: z.number().int().nonnegative(),
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

export type PreEventContextCustomPayload = z.infer<
  typeof preEventContextCustomPayloadSchema
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

export function gapGroupOf(days: number | null): GapGroup {
  if (days === null) return "UNKNOWN";
  if (days <= 3) return "GAP_1_3";
  if (days <= 5) return "GAP_4_5";
  if (days <= 10) return "GAP_6_10";
  if (days <= 20) return "GAP_11_20";
  return "GAP_OVER_20";
}

export function preReturnBucketOf(value: number | null): PreReturnBucket | null {
  if (value === null) return null;
  if (value < -0.1) return "LT_NEG10";
  if (value < -0.05) return "NEG10_NEG5";
  if (value < 0) return "NEG5_ZERO";
  if (value < 0.05) return "ZERO_POS5";
  if (value < 0.1) return "POS5_POS10";
  if (value < 0.2) return "POS10_POS20";
  return "GT_POS20";
}

function contextRow(args: {
  dimension: ContextPerformanceRow["dimension"];
  preWindow: number | null;
  gapGroup?: GapGroup | null;
  preReturnBucket?: PreReturnBucket | null;
  horizon: number;
  samples: readonly ForwardSample[];
  costBps: number;
}): ContextPerformanceRow {
  const values = args.samples.map((sample) => sample.grossReturn);
  return {
    dimension: args.dimension,
    preWindow: args.preWindow,
    gapGroup: args.gapGroup ?? null,
    gapLabel: args.gapGroup ? GAP_GROUP_LABELS[args.gapGroup] : null,
    preReturnBucket: args.preReturnBucket ?? null,
    preReturnLabel: args.preReturnBucket ? PRE_RETURN_BUCKET_LABELS[args.preReturnBucket] : null,
    horizon: args.horizon,
    sampleCount: values.length,
    ...summarize(values, args.costBps),
  };
}

export function assemblePreEventContextResult(args: {
  preReturnWindows: readonly number[];
  forwardHorizons: readonly number[];
  primaryInteractionWindow: number;
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
  gapKnownCount: number;
  gapUnknownCount: number;
  allPreReturnWindowsAvailableCount: number;
}): ExperimentResultPayload {
  const rows: ContextPerformanceRow[] = [];

  for (const horizon of args.forwardHorizons) {
    const horizonSamples = args.samples.filter((sample) => sample.horizon === horizon);
    for (const gapGroup of GAP_GROUPS) {
      rows.push(
        contextRow({
          dimension: "GAP",
          preWindow: null,
          gapGroup,
          horizon,
          samples: horizonSamples.filter((sample) => sample.sample.gapGroup === gapGroup),
          costBps: args.costBps,
        }),
      );
    }
    for (const preWindow of args.preReturnWindows) {
      for (const bucket of PRE_RETURN_BUCKETS) {
        const selected = horizonSamples.filter((sample) => {
          const value = sample.sample.preReturns[preWindow] ?? null;
          return preReturnBucketOf(value) === bucket;
        });
        rows.push(
          contextRow({
            dimension: "PRE_RETURN",
            preWindow,
            preReturnBucket: bucket,
            horizon,
            samples: selected,
            costBps: args.costBps,
          }),
        );
      }
    }
    for (const gapGroup of GAP_GROUPS) {
      for (const bucket of PRE_RETURN_BUCKETS) {
        const selected = horizonSamples.filter((sample) => {
          if (sample.sample.gapGroup !== gapGroup) return false;
          const value = sample.sample.preReturns[args.primaryInteractionWindow] ?? null;
          return preReturnBucketOf(value) === bucket;
        });
        rows.push(
          contextRow({
            dimension: "GAP_X_PRE_RETURN",
            preWindow: args.primaryInteractionWindow,
            gapGroup,
            preReturnBucket: bucket,
            horizon,
            samples: selected,
            costBps: args.costBps,
          }),
        );
      }
    }
  }

  const gapRows = rows.filter((row) => row.dimension === "GAP");
  const bestGap = [...gapRows]
    .filter((row) => row.availableCount >= 100 && row.medianNetReturn !== null)
    .sort((a, b) => (b.medianNetReturn ?? -Infinity) - (a.medianNetReturn ?? -Infinity))[0];
  const worstGap = [...gapRows]
    .filter((row) => row.availableCount >= 100 && row.medianNetReturn !== null)
    .sort((a, b) => (a.medianNetReturn ?? Infinity) - (b.medianNetReturn ?? Infinity))[0];

  const observations: PreEventContextCustomPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `eligible ${args.eligibleCount} 个首板事件；前次涨停间隔已知 ${args.gapKnownCount} 个、` +
        `未知 ${args.gapUnknownCount} 个；所有前期涨幅窗口均可用 ${args.allPreReturnWindowsAvailableCount} 个。`,
    },
    bestGap && worstGap
      ? {
          kind: "COMPARATIVE",
          text:
            `按中位净收益比较间隔分组：最高为 ${bestGap.gapLabel} / T+${bestGap.horizon} ` +
            `(${(bestGap.medianNetReturn! * 100).toFixed(2)}%, n=${bestGap.availableCount})；` +
            `最低为 ${worstGap.gapLabel} / T+${worstGap.horizon} ` +
            `(${(worstGap.medianNetReturn! * 100).toFixed(2)}%, n=${worstGap.availableCount})。` +
            "这是样本内描述，尚未做多重比较或 Holdout。",
        }
      : {
          kind: "LIMITATION",
          text: "间隔分组中缺少样本数 ≥100 的可用格子，无法给出最高 / 最低描述。",
        },
    {
      kind: "LIMITATION",
      text:
        "前期涨幅定义为 close(T-1) / close(T-n) - 1；不包含首板日 T 自身的涨停涨幅。",
    },
    {
      kind: "LIMITATION",
      text:
        "收益使用 T+1 开盘入场到 T+h 收盘；未按日期聚类 Bootstrap，也未区分市场 / 行业状态。",
    },
  ];

  const customPayload: PreEventContextCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "研究首板前的前次涨停间隔与前期涨幅是否影响首板后的固定视界收益。",
      decisionTimeInformation: [
        "T 日事件身份与 PIT daysSincePreviousLimit",
        "T-n..T-1 已发生的 prefix 收盘价，用于计算前期涨幅",
      ],
      postEventResearchOutcome: [
        "T+1 开盘到 T+h 收盘的毛收益与净收益",
        "按间隔分组、前期涨幅分桶及二者交互汇总",
      ],
      notes: [
        "前期涨幅窗口严格早于首板日 T，不包含 T 日涨停本身。",
        "无已知前次涨停时 gapDays 记为未知，不伪造为无限间隔。",
      ],
    },
    parameters: {
      preReturnWindows: [...args.preReturnWindows],
      forwardHorizons: [...args.forwardHorizons],
      primaryInteractionWindow: args.primaryInteractionWindow,
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
      gapKnownCount: args.gapKnownCount,
      gapUnknownCount: args.gapUnknownCount,
      allPreReturnWindowsAvailableCount: args.allPreReturnWindowsAvailableCount,
    },
    observations,
    hypotheses: [
      {
        code: "H1",
        statement: "首板前距上一次涨停的间隔可能影响首板后的收益。",
        rationale: "间隔反映筹码换手与情绪冷却时间，必须使用 PIT 的 daysSincePreviousLimit。",
      },
      {
        code: "H2",
        statement: "首板前 5/10/20 日涨幅可能与首板后的收益存在非线性关系。",
        rationale: "前期涨幅反映趋势位置；本实验只报告分桶梯度，不选择最佳窗口。",
      },
    ],
    notes: [
      "本实验不输出最优间隔、最优前期涨幅或策略候选。",
      "分组格子只用于描述与后续验证输入，不进行多重比较显著性判断。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 首板日行情有效、T-20..T-1 prefix 足以计算全部已声明前期涨幅窗口、且 T+1..T+20 观察字段可读取。",
        "间隔未知不等于间隔很长；UNKNOWN 单独成组。",
      ],
    },
    statistics: [
      {
        code: "gap_known_count",
        label: "前次涨停间隔已知",
        value: args.gapKnownCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "gap_unknown_count",
        label: "前次涨停间隔未知",
        value: args.gapUnknownCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "all_pre_return_available_count",
        label: "全部前期涨幅窗口可用",
        value: args.allPreReturnWindowsAvailableCount,
        unit: "个事件",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "pre_event_context_matrix",
        title: "首板前上下文与后续收益",
        description:
          "GAP = 距上次涨停间隔；PRE_RETURN = 指定 n 日前至 T-1 的前期涨幅；GAP_X_PRE_RETURN = 主交互窗口的联合分组。",
        columns: [
          { key: "dimension", label: "维度", align: "LEFT" },
          { key: "preWindow", label: "前期窗口", align: "RIGHT" },
          { key: "gapLabel", label: "间隔分组", align: "LEFT" },
          { key: "preReturnLabel", label: "前期涨幅分组", align: "LEFT" },
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
      key: `gap-median-net-h${horizon}`,
      title: `T+${horizon} · 按涨停间隔的中位净收益`,
      description: "间隔分组只用于描述，不代表最佳间隔。",
      kind: "BAR" as const,
      xLabel: "涨停间隔",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `gap-h${horizon}`,
          label: `T+${horizon}`,
          points: GAP_GROUPS.map((gapGroup) => ({
            x: gapGroup,
            y:
              rows.find(
                (row) =>
                  row.dimension === "GAP" &&
                  row.gapGroup === gapGroup &&
                  row.horizon === horizon,
              )?.medianNetReturn ?? null,
          })),
        },
      ],
    })),
    customPayload,
  };
}
