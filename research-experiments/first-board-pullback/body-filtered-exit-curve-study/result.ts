import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const DEFAULT_ENTRY_DAY = 6;
export const MIN_ENTRY_DAY = 1;
export const MAX_ENTRY_DAY = 6;
export const DEFAULT_MAX_EXIT_DAY = 20;
export const MAX_EXIT_DAY = 20;
export const DEFAULT_MIN_BODY_HEIGHT_PCT = 0.1;
export const ROUND_TRIP_COST_BPS = 20;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_922;
export const ANCHOR_HOLDING_DAYS = [1, 2, 3, 5, 10, 15] as const;

export const BODY_HEIGHT_BUCKETS = [
  "P0_1",
  "P1_2",
  "P2_4",
  "P4_6",
  "P6_8",
  "GE8",
] as const;
export type BodyHeightBucket = (typeof BODY_HEIGHT_BUCKETS)[number];
export type BodyGroupCode = "ALL" | BodyHeightBucket;
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export const BODY_GROUP_CODES: readonly BodyGroupCode[] = [
  "ALL",
  ...BODY_HEIGHT_BUCKETS,
];

export const BODY_GROUP_LABELS: Readonly<Record<BodyGroupCode, string>> =
  Object.freeze({
    ALL: "全部过滤后样本",
    P0_1: "实体 0.1% ~ 1%",
    P1_2: "实体 1% ~ 2%",
    P2_4: "实体 2% ~ 4%",
    P4_6: "实体 4% ~ 6%",
    P6_8: "实体 6% ~ 8%",
    GE8: "实体 >= 8%",
  });

export interface ExitCurveSample {
  eventId: string;
  eventDate: string;
  year: number;
  bodyHeight: number;
  bodyBucket: BodyHeightBucket;
  entryDay: number;
  marksByHoldingDay: Readonly<Record<string, number>>;
  mfeByHoldingDay: Readonly<Record<string, number>>;
  maeByHoldingDay: Readonly<Record<string, number>>;
  positive2HoldingDay: number | null;
  negative2HoldingDay: number | null;
}

export interface ExitCurveRow {
  [key: string]: string | number | boolean | null;
  group: BodyGroupCode;
  groupLabel: string;
  holdingDay: number;
  relativeDay: number;
  sampleCount: number;
  eventDateCount: number;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  p5NetReturn: number | null;
  p25NetReturn: number | null;
  p75NetReturn: number | null;
  p95NetReturn: number | null;
  meanMfe: number | null;
  medianMfe: number | null;
  meanMae: number | null;
  medianMae: number | null;
  positive2AtOrBeforeRate: number | null;
  negative2AtOrBeforeRate: number | null;
}

export interface BodyGroupSummaryRow {
  [key: string]: string | number | boolean | null;
  group: BodyGroupCode;
  groupLabel: string;
  sampleCount: number;
  eventDateCount: number;
  meanBodyHeight: number | null;
  medianBodyHeight: number | null;
  maxHoldingDay: number;
  finalMeanNetReturn: number | null;
  finalMedianNetReturn: number | null;
  finalWinRateNet: number | null;
}

export interface AnchorBootstrapRow {
  [key: string]: string | number | boolean | null;
  group: BodyGroupCode;
  groupLabel: string;
  holdingDay: number;
  sampleCount: number;
  eventDateCount: number;
  meanNetReturn: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
}

export const bodyFilteredExitCurveSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  rule: z.object({
    entryDay: z.number().int(),
    maxExitDay: z.number().int(),
    maxHoldingDays: z.number().int().positive(),
    minBodyHeightPct: z.number().nonnegative(),
    excludeOneWordLimitUp: z.boolean(),
    costBps: z.number().nonnegative(),
    anchorHoldingDays: z.array(z.number().int().positive()),
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
    oneWordLimitUpCount: z.number().int().nonnegative(),
    excludedOneWordLimitUpCount: z.number().int().nonnegative(),
    belowMinBodyHeightCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    incompleteCommonPathCount: z.number().int().nonnegative(),
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

export type BodyFilteredExitCurvePayload = z.infer<
  typeof bodyFilteredExitCurveSchema
>;

export const EXCLUSION_REASON_LABELS = {
  NOT_FIRST_LIMIT: "不是首板事件",
  MISSING_EVENT_DAY_BAR: "缺少首板日行情",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC 或前收非法",
  EVENT_NOT_EXACT_LIMIT_UP: "首板收盘价不等于交易所涨停价",
  EXCLUDED_ONE_WORD_LIMIT_UP: "首板为一字涨停，按规则排除",
  BELOW_MIN_BODY_HEIGHT: "首板实体高度低于最小过滤阈值",
  ENTRY_UNFILLABLE: "入场日开盘不可买或行情不可用",
  INCOMPLETE_COMMON_PATH: "入场日至最大退出日的共同行情路径不完整或不可卖",
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

function summarize(values: readonly number[]) {
  if (values.length === 0) {
    return {
      sampleCount: 0,
      mean: null,
      median: null,
      winRate: null,
      p5: null,
      p25: null,
      p75: null,
      p95: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    sampleCount: values.length,
    mean: round(mean(values)!),
    median: round(quantile(sorted, 0.5)!),
    winRate: round(values.filter(value => value > 0).length / values.length),
    p5: round(quantile(sorted, 0.05)!),
    p25: round(quantile(sorted, 0.25)!),
    p75: round(quantile(sorted, 0.75)!),
    p95: round(quantile(sorted, 0.95)!),
  };
}

function markAtDay(
  sample: ExitCurveSample,
  holdingDay: number
): number | null {
  const value = sample.marksByHoldingDay[String(holdingDay)];
  return value === undefined ? null : value;
}

export function bodyHeightBucketOf(value: number): BodyHeightBucket {
  if (value < 0.01) return "P0_1";
  if (value < 0.02) return "P1_2";
  if (value < 0.04) return "P2_4";
  if (value < 0.06) return "P4_6";
  if (value < 0.08) return "P6_8";
  return "GE8";
}

export function assembleBodyFilteredExitCurve(args: {
  samples: readonly ExitCurveSample[];
  entryDay: number;
  maxExitDay: number;
  minBodyHeightPct: number;
  excludeOneWordLimitUp: boolean;
  costBps: number;
  bootstrapIterations: number;
  bootstrapBlockDays: number;
  bootstrapSeed: number;
  candidateCount: number;
  exactLimitUpCloseCount: number;
  oneWordLimitUpCount: number;
  excludedOneWordLimitUpCount: number;
  belowMinBodyHeightCount: number;
  entryUnfillableCount: number;
  incompleteCommonPathCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const maxHoldingDays = args.maxExitDay - args.entryDay + 1;
  const curveRows: ExitCurveRow[] = [];
  const summaryRows: BodyGroupSummaryRow[] = [];
  const anchorRows: AnchorBootstrapRow[] = [];
  const anchorHoldingDays = ANCHOR_HOLDING_DAYS.filter(
    day => day <= maxHoldingDays
  );

  for (const group of BODY_GROUP_CODES) {
    const grouped =
      group === "ALL"
        ? args.samples
        : args.samples.filter(sample => sample.bodyBucket === group);

    for (let holdingDay = 1; holdingDay <= maxHoldingDays; holdingDay += 1) {
      const marks = grouped
        .map(sample => markAtDay(sample, holdingDay))
        .filter((value): value is number => value !== null);
      const netMarks = marks.map(value => value - args.costBps / 10_000);
      const mfe = grouped
        .map(sample => sample.mfeByHoldingDay[String(holdingDay)])
        .filter((value): value is number => value !== undefined);
      const mae = grouped
        .map(sample => sample.maeByHoldingDay[String(holdingDay)])
        .filter((value): value is number => value !== undefined);
      const summary = summarize(netMarks);
      curveRows.push({
        group,
        groupLabel: BODY_GROUP_LABELS[group],
        holdingDay,
        relativeDay: args.entryDay + holdingDay - 1,
        sampleCount: grouped.length,
        eventDateCount: new Set(grouped.map(sample => sample.eventDate)).size,
        meanNetReturn: summary.mean,
        medianNetReturn: summary.median,
        winRateNet: summary.winRate,
        p5NetReturn: summary.p5,
        p25NetReturn: summary.p25,
        p75NetReturn: summary.p75,
        p95NetReturn: summary.p95,
        meanMfe: mean(mfe),
        medianMfe: quantile([...mfe].sort((a, b) => a - b), 0.5),
        meanMae: mean(mae),
        medianMae: quantile([...mae].sort((a, b) => a - b), 0.5),
        positive2AtOrBeforeRate:
          grouped.length === 0
            ? null
            : grouped.filter(
                sample =>
                  sample.positive2HoldingDay !== null &&
                  sample.positive2HoldingDay <= holdingDay
              ).length / grouped.length,
        negative2AtOrBeforeRate:
          grouped.length === 0
            ? null
            : grouped.filter(
                sample =>
                  sample.negative2HoldingDay !== null &&
                  sample.negative2HoldingDay <= holdingDay
              ).length / grouped.length,
      });
    }

    const finalRow = curveRows.find(
      row => row.group === group && row.holdingDay === maxHoldingDays
    );
    const bodyValues = grouped.map(sample => sample.bodyHeight);
    summaryRows.push({
      group,
      groupLabel: BODY_GROUP_LABELS[group],
      sampleCount: grouped.length,
      eventDateCount: new Set(grouped.map(sample => sample.eventDate)).size,
      meanBodyHeight: mean(bodyValues),
      medianBodyHeight: quantile(
        [...bodyValues].sort((a, b) => a - b),
        0.5
      ),
      maxHoldingDay: maxHoldingDays,
      finalMeanNetReturn: finalRow?.meanNetReturn ?? null,
      finalMedianNetReturn: finalRow?.medianNetReturn ?? null,
      finalWinRateNet: finalRow?.winRateNet ?? null,
    });

    for (const holdingDay of anchorHoldingDays) {
      const values = grouped
        .map(sample => markAtDay(sample, holdingDay))
        .filter((value): value is number => value !== null)
        .map(value => value - args.costBps / 10_000);
      const bootstrap = movingBlockBootstrapMean({
        samples: grouped
          .map(sample => {
            const mark = markAtDay(sample, holdingDay);
            return mark === null
              ? null
              : {
                  eventDate: sample.eventDate,
                  value: mark - args.costBps / 10_000,
                };
          })
          .filter(
            (
              value
            ): value is { eventDate: string; value: number } => value !== null
          ),
        iterations: args.bootstrapIterations,
        blockLength: args.bootstrapBlockDays,
        seed:
          args.bootstrapSeed +
          BODY_GROUP_CODES.indexOf(group) * 100 +
          holdingDay,
      });
      anchorRows.push({
        group,
        groupLabel: BODY_GROUP_LABELS[group],
        holdingDay,
        sampleCount: values.length,
        eventDateCount: new Set(grouped.map(sample => sample.eventDate)).size,
        meanNetReturn: mean(values),
        bootstrapCi95Low: bootstrap?.low ?? null,
        bootstrapCi95High: bootstrap?.high ?? null,
        bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
      });
    }
  }

  const allSummary = summaryRows.find(row => row.group === "ALL")!;
  const t10RelativeDay = 10;
  const t10HoldingDay = t10RelativeDay - args.entryDay + 1;
  const t10Row =
    t10HoldingDay >= 1 && t10HoldingDay <= maxHoldingDays
      ? curveRows.find(
          row => row.group === "ALL" && row.holdingDay === t10HoldingDay
        )
      : undefined;
  const t20HoldingDay = 20 - args.entryDay + 1;
  const t20Row =
    t20HoldingDay >= 1 && t20HoldingDay <= maxHoldingDays
      ? curveRows.find(
          row => row.group === "ALL" && row.holdingDay === t20HoldingDay
        )
      : undefined;

  const observations: BodyFilteredExitCurvePayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `严格涨停 ${args.exactLimitUpCloseCount} 个；一字板 ${args.oneWordLimitUpCount} 个；` +
        `实体过滤后有效样本 ${args.samples.length} 个。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `全部过滤后样本：T+10 中位净收益 ${formatPct(t10Row?.medianNetReturn ?? null)}，` +
        `T+20 中位净收益 ${formatPct(t20Row?.medianNetReturn ?? null)}。`,
    },
    {
      kind: "LIMITATION",
      text:
        "所有退出日使用同一批共同路径完整样本，避免 T+10 与 T+20 的样本集合漂移。",
    },
    {
      kind: "LIMITATION",
      text:
        "曲线只展示不同持有日的结果，不选择收益最高的退出日。",
    },
  ];

  const customPayload: BodyFilteredExitCurvePayload = {
    computationVersion: COMPUTATION_VERSION,
    rule: {
      entryDay: args.entryDay,
      maxExitDay: args.maxExitDay,
      maxHoldingDays,
      minBodyHeightPct: args.minBodyHeightPct,
      excludeOneWordLimitUp: args.excludeOneWordLimitUp,
      costBps: args.costBps,
      anchorHoldingDays,
    },
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "首板日实体高度用于样本过滤；实际入场后逐日展开收益、MFE 和 MAE。",
      decisionTimeInformation: [
        "首板日 open / high / low / close / previousClose / limitUpPrice",
        "首板日实体高度",
      ],
      postEventResearchOutcome: [
        "从实际入场日开始的逐日净收益",
        "持有期 MFE / MAE",
        "T+10 / T+20 等锚点收益",
      ],
      notes: [
        "实体高度 = (首板收盘 - 首板开盘) / 首板前收。",
        "一字板定义为首板日 O=H=L=C=涨停价。",
        "所有退出日要求同一条完整且可卖的共同路径。",
      ],
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      oneWordLimitUpCount: args.oneWordLimitUpCount,
      excludedOneWordLimitUpCount: args.excludedOneWordLimitUpCount,
      belowMinBodyHeightCount: args.belowMinBodyHeightCount,
      entryUnfillableCount: args.entryUnfillableCount,
      incompleteCommonPathCount: args.incompleteCommonPathCount,
      sampleCount: args.samples.length,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      `默认过滤首板实体高度低于 ${args.minBodyHeightPct}% 的样本。`,
      "结果只用于研究入场后的持有曲线，不输出最优退出日。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.samples.length,
      excludedCount: args.candidateCount - args.samples.length,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 严格涨停首板、非一字板、实体过滤通过、入场可买且共同路径完整。",
        "所有退出日使用同一批 eligible 样本。",
      ],
    },
    statistics: [
      {
        code: "filtered_sample_count",
        label: "过滤后样本",
        value: args.samples.length,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "excluded_one_word_count",
        label: "排除一字板",
        value: args.excludedOneWordLimitUpCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "t10_median",
        label: "全部样本 T+10 中位",
        value: t10Row?.medianNetReturn ?? null,
        unit: "比例",
        digits: 6,
      },
      {
        code: "t20_median",
        label: "全部样本 T+20 中位",
        value: t20Row?.medianNetReturn ?? null,
        unit: "比例",
        digits: 6,
      },
    ],
    tables: [
      {
        key: "body_filtered_exit_curve",
        title: "实体过滤后的实际持有曲线",
        description:
          "持有日从实际入场日起算；每个 group 使用同一批共同路径完整样本。",
        columns: [
          { key: "groupLabel", label: "实体分组", align: "LEFT" },
          { key: "holdingDay", label: "持有第N日", align: "RIGHT" },
          { key: "relativeDay", label: "相对日", align: "RIGHT" },
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
            key: "p5NetReturn",
            label: "P5",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "p25NetReturn",
            label: "P25",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "p75NetReturn",
            label: "P75",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "p95NetReturn",
            label: "P95",
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
            key: "meanMae",
            label: "平均MAE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "positive2AtOrBeforeRate",
            label: "截至该日触及+2%",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "negative2AtOrBeforeRate",
            label: "截至该日触及-2%",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
        ],
        rows: curveRows,
      },
      {
        key: "body_group_summary",
        title: "实体分组摘要",
        description: "同一批共同路径完整样本按首板实体高度分组。",
        columns: [
          { key: "groupLabel", label: "实体分组", align: "LEFT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "meanBodyHeight",
            label: "平均实体",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianBodyHeight",
            label: "中位实体",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          { key: "maxHoldingDay", label: "最大持有日", align: "RIGHT" },
          {
            key: "finalMeanNetReturn",
            label: "最末持有日平均",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "finalMedianNetReturn",
            label: "最末持有日中位",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "finalWinRateNet",
            label: "最末持有日胜率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
        ],
        rows: summaryRows,
      },
      {
        key: "anchor_bootstrap",
        title: "锚点持有日的日期聚类 Bootstrap",
        description:
          "只对固定锚点持有日重采样，用于检查均值的不确定性；不选择最佳锚点。",
        columns: [
          { key: "groupLabel", label: "实体分组", align: "LEFT" },
          { key: "holdingDay", label: "持有第N日", align: "RIGHT" },
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
          { key: "bootstrapClusterCount", label: "聚类数", align: "RIGHT" },
        ],
        rows: anchorRows,
      },
    ],
    charts: [
      {
        key: "body-filtered-median-exit-curve",
        title: "实体分组的中位净收益持有曲线",
        description:
          "横轴为从实际入场日起算的持有日；不选择最佳退出日。",
        kind: "LINE" as const,
        xLabel: "持有第 N 日",
        yLabel: "中位净收益",
        unit: "比例",
        series: BODY_GROUP_CODES.map(group => ({
          key: `group-${group}`,
          label: BODY_GROUP_LABELS[group],
          points: curveRows
            .filter(row => row.group === group)
            .map(row => ({
              x: String(row.holdingDay),
              y: row.medianNetReturn,
            })),
        })),
      },
      {
        key: "body-filtered-mean-exit-curve",
        title: "实体分组的平均净收益持有曲线",
        description:
          "平均曲线只用于与中位和 Bootstrap 交叉检查，不用于选择最优退出日。",
        kind: "LINE" as const,
        xLabel: "持有第 N 日",
        yLabel: "平均净收益",
        unit: "比例",
        series: BODY_GROUP_CODES.map(group => ({
          key: `group-${group}`,
          label: BODY_GROUP_LABELS[group],
          points: curveRows
            .filter(row => row.group === group)
            .map(row => ({
              x: String(row.holdingDay),
              y: row.meanNetReturn,
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
