import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const CONTEXT_DAYS = 5;
export const ENTRY_DAY = CONTEXT_DAYS + 1;
export const DEFAULT_FORWARD_HORIZONS = [10, 15, 20] as const;
export const MAX_FORWARD_HORIZON = 20;

export const LIMIT_UP_CLOSE_CONTEXTS = [
  "AT_OR_ABOVE",
  "SLIGHT_BREACH",
  "DEEP_BREACH",
] as const;
export type LimitUpCloseContext = (typeof LIMIT_UP_CLOSE_CONTEXTS)[number];
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export const LIMIT_UP_CLOSE_CONTEXT_LABELS: Readonly<
  Record<LimitUpCloseContext, string>
> = Object.freeze({
  AT_OR_ABOVE: "收盘始终不低于 T 日涨停价",
  SLIGHT_BREACH: "最多略微跌破（不超过阈值）",
  DEEP_BREACH: "跌破超过阈值",
});

export const EXCLUSION_REASON_LABELS = {
  MAX_EVENTS_LIMIT: "超出 maxEvents 上限（本次未纳入统计）",
  MISSING_EVENT_DAY_BAR: "缺少首板日（rd=0）行情",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC / 涨停价缺失、非正或自相矛盾",
  EXCLUDED_ONE_WORD_LIMIT_UP: "首板日为一字涨停（按实验参数排除）",
  MISSING_CONTEXT_BAR: "T+1..T+5 存在行情缺口",
  INVALID_CONTEXT_BAR: "T+1..T+5 存在停牌、缺 bar 或非法收盘价",
} as const;

export interface ForwardSample {
  eventId: string;
  eventDate: string;
  year: number;
  context: LimitUpCloseContext;
  worstCloseVsLimitUp: number;
  horizon: number;
  grossReturn: number;
}

export interface LimitUpClosePerformanceRow {
  [key: string]: string | number | boolean | null;
  dimension: "BASELINE" | "CLOSE_CONTEXT";
  context: LimitUpCloseContext | null;
  contextLabel: string;
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
  meanWorstCloseVsLimitUp: number | null;
  medianWorstCloseVsLimitUp: number | null;
}

export const limitUpCloseHoldCustomPayloadSchema = z.object({
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
    slightBreachBps: z.number().nonnegative(),
    forwardHorizons: z.array(z.number().int().positive()),
    costBps: z.number().nonnegative(),
    bootstrapIterations: z.number().int().positive(),
    bootstrapBlockDays: z.number().int().positive(),
    bootstrapSeed: z.number().int(),
    excludeOneWordLimitUp: z.boolean(),
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
    eventOneWordLimitUpCount: z.number().int().nonnegative(),
    excludedOneWordLimitUpCount: z.number().int().nonnegative(),
  }),
  contextCounts: z.object({
    atOrAboveCount: z.number().int().nonnegative(),
    slightBreachCount: z.number().int().nonnegative(),
    deepBreachCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
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
  hypotheses: z.array(
    z.object({
      code: z.string().min(1),
      statement: z.string().min(1),
      rationale: z.string().min(1),
    })
  ),
  notes: z.array(z.string().min(1)),
});

export type LimitUpCloseHoldCustomPayload = z.infer<
  typeof limitUpCloseHoldCustomPayloadSchema
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
  const net = values.map(value => value - costBps / 10_000);
  return {
    availableCount: values.length,
    meanGrossReturn: round(mean(values)!),
    medianGrossReturn: round(quantile(sorted, 0.5)!),
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

export function limitUpCloseContextOf(
  worstCloseVsLimitUp: number,
  slightBreachBps: number
): LimitUpCloseContext {
  if (worstCloseVsLimitUp >= -1e-9) return "AT_OR_ABOVE";
  if (worstCloseVsLimitUp >= -slightBreachBps / 10_000 - 1e-9)
    return "SLIGHT_BREACH";
  return "DEEP_BREACH";
}

function performanceRow(args: {
  dimension: LimitUpClosePerformanceRow["dimension"];
  context: LimitUpCloseContext | null;
  horizon: number;
  samples: readonly ForwardSample[];
  costBps: number;
  bootstrapIterations: number;
  bootstrapBlockDays: number;
  bootstrapSeed: number;
}): LimitUpClosePerformanceRow {
  const values = args.samples.map(sample => sample.grossReturn);
  const worstCloseValues = args.samples.map(
    sample => sample.worstCloseVsLimitUp
  );
  const bootstrap = movingBlockBootstrapMean({
    samples: args.samples.map(sample => ({
      eventDate: sample.eventDate,
      value: sample.grossReturn - args.costBps / 10_000,
    })),
    iterations: args.bootstrapIterations,
    blockLength: args.bootstrapBlockDays,
    seed: args.bootstrapSeed,
  });
  return {
    dimension: args.dimension,
    context: args.context,
    contextLabel:
      args.context === null
        ? "全部 eligible"
        : LIMIT_UP_CLOSE_CONTEXT_LABELS[args.context],
    horizon: args.horizon,
    sampleCount: values.length,
    ...summarize(values, args.costBps),
    bootstrapCi95Low: bootstrap?.low ?? null,
    bootstrapCi95High: bootstrap?.high ?? null,
    bootstrapIterations: bootstrap?.iterations ?? args.bootstrapIterations,
    bootstrapBlockLength: bootstrap?.blockLength ?? args.bootstrapBlockDays,
    bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
    bootstrapSeed: bootstrap?.seed ?? args.bootstrapSeed,
    meanWorstCloseVsLimitUp: mean(worstCloseValues),
    medianWorstCloseVsLimitUp: quantile(
      [...worstCloseValues].sort((a, b) => a - b),
      0.5
    ),
  };
}

export function assembleLimitUpCloseHoldResult(args: {
  slightBreachBps: number;
  forwardHorizons: readonly number[];
  costBps: number;
  bootstrapIterations: number;
  bootstrapBlockDays: number;
  bootstrapSeed: number;
  excludeOneWordLimitUp: boolean;
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
  eventOneWordLimitUpCount: number;
  excludedOneWordLimitUpCount: number;
  atOrAboveCount: number;
  slightBreachCount: number;
  deepBreachCount: number;
  entryUnfillableCount: number;
}): ExperimentResultPayload {
  const rows: LimitUpClosePerformanceRow[] = [];
  for (const horizon of args.forwardHorizons) {
    const horizonSamples = args.samples.filter(
      sample => sample.horizon === horizon
    );
    rows.push(
      performanceRow({
        dimension: "BASELINE",
        context: null,
        horizon,
        samples: horizonSamples,
        costBps: args.costBps,
        bootstrapIterations: args.bootstrapIterations,
        bootstrapBlockDays: args.bootstrapBlockDays,
        bootstrapSeed: args.bootstrapSeed + horizon * 100,
      })
    );
    for (const context of LIMIT_UP_CLOSE_CONTEXTS) {
      rows.push(
        performanceRow({
          dimension: "CLOSE_CONTEXT",
          context,
          horizon,
          samples: horizonSamples.filter(sample => sample.context === context),
          costBps: args.costBps,
          bootstrapIterations: args.bootstrapIterations,
          bootstrapBlockDays: args.bootstrapBlockDays,
          bootstrapSeed:
            args.bootstrapSeed +
            horizon * 100 +
            LIMIT_UP_CLOSE_CONTEXTS.indexOf(context) +
            1,
        })
      );
    }
  }

  const formatPct = (value: number | null): string =>
    value === null ? "无可用样本" : `${(value * 100).toFixed(2)}%`;
  const t20Rows = rows.filter(
    row => row.dimension === "CLOSE_CONTEXT" && row.horizon === 20
  );
  const observations: LimitUpCloseHoldCustomPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `T+1..T+5 收盘始终不低于 T 日涨停价的样本 ${args.atOrAboveCount} 个；` +
        `最多跌破 ${args.slightBreachBps} bps 的样本 ${args.slightBreachCount} 个；` +
        `跌破超过 ${args.slightBreachBps} bps 的样本 ${args.deepBreachCount} 个；` +
        `T+6 开盘不可买 ${args.entryUnfillableCount} 个。`,
    },
    ...(t20Rows.length === LIMIT_UP_CLOSE_CONTEXTS.length
      ? [
          {
            kind: "COMPARATIVE" as const,
            text:
              "T+20 中位净收益：" +
              t20Rows
                .map(
                  row =>
                    `${row.contextLabel} ${formatPct(row.medianNetReturn)} (n=${row.availableCount})`
                )
                .join("；") +
              "。该比较为固定分组描述，不据此选择最优阈值。",
          },
        ]
      : []),
    {
      kind: "LIMITATION",
      text:
        `分组按 T+1..T+5 收盘价最低点相对 T 日涨停价定义；“略微跌破”预先固定为 ${args.slightBreachBps} bps，` +
        "不是搜索得到的最优阈值。",
    },
    {
      kind: "LIMITATION",
      text: "只使用收盘价判定，不模拟盘中跌破；T+6 开盘不可买、停牌或退出日不可卖不会用 0 收益替代。",
    },
    {
      kind: "LIMITATION",
      text:
        `日期聚类 Moving Block Bootstrap：${args.bootstrapIterations} 次，block=${args.bootstrapBlockDays} 日。` +
        "它只修正同一日期事件的统计不确定性，不能替代独立 Holdout。",
    },
  ];

  const customPayload: LimitUpCloseHoldCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    informationBoundary: {
      decisionOffsetDays: CONTEXT_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        "观察 T+1..T+5 收盘价相对首板日涨停价的最差位置，并在 T+6 开盘后计算固定视界收益。",
      decisionTimeInformation: [
        "首板日 OHLC 与 limitUpPrice",
        "T+1..T+5 每个交易日的收盘价、barPresent 与停牌状态",
        "T+6 开盘可买性",
      ],
      postEventResearchOutcome: [
        "T+6 开盘到 T+10/T+15/T+20 收盘的毛收益与净收益",
        "按收盘相对 T 日涨停价的最差位置分组的收益与日期聚类 Bootstrap CI",
      ],
      notes: [
        "分组只允许使用截至 T+5 收盘的信息，入场最早为 T+6 开盘。",
        "一字涨停首板可按参数在样本资格阶段排除。",
      ],
    },
    parameters: {
      contextDays: CONTEXT_DAYS,
      entryDay: ENTRY_DAY,
      slightBreachBps: args.slightBreachBps,
      forwardHorizons: [...args.forwardHorizons],
      costBps: args.costBps,
      bootstrapIterations: args.bootstrapIterations,
      bootstrapBlockDays: args.bootstrapBlockDays,
      bootstrapSeed: args.bootstrapSeed,
      excludeOneWordLimitUp: args.excludeOneWordLimitUp,
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
      eventOneWordLimitUpCount: args.eventOneWordLimitUpCount,
      excludedOneWordLimitUpCount: args.excludedOneWordLimitUpCount,
    },
    contextCounts: {
      atOrAboveCount: args.atOrAboveCount,
      slightBreachCount: args.slightBreachCount,
      deepBreachCount: args.deepBreachCount,
      entryUnfillableCount: args.entryUnfillableCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    hypotheses: [
      {
        code: "H1",
        statement:
          "T+1..T+5 收盘始终不低于 T 日涨停价的样本，其后续收益分布可能不同于跌破组。",
        rationale:
          "首板后收盘守住涨停价，意味着首板价格附近仍存在持续承接；本实验只检验差异，不产生策略。",
      },
      {
        code: "H2",
        statement: "收盘仅略微跌破与深度跌破的后续收益可能不同。",
        rationale:
          "轻微跌破可能是正常回踩，深度跌破可能意味着首板支撑失效；阈值预先固定，不做参数搜索。",
      },
    ],
    notes: [
      "本实验不输出最优阈值、最优持有期或策略对象。",
      "所有收益仍使用统一往返成本敏感性参数，未实现完整撮合、滑点和涨跌停排队。",
      "结果属于当前 Dataset 内的探索性证据，不能直接声称为 OOS 通过。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 首板日有效，且 T+1..T+5 每个交易日都有非停牌合法收盘价；一字板排除时不计入 eligible。",
        `T+5 收盘决策后最早从 T+${ENTRY_DAY} 开盘入场，净收益 = 毛收益 − ${args.costBps} bps。`,
      ],
    },
    statistics: [
      {
        code: "at_or_above_count",
        label: "收盘始终不低于涨停价",
        value: args.atOrAboveCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "slight_breach_count",
        label: "最多略微跌破",
        value: args.slightBreachCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "deep_breach_count",
        label: "深度跌破",
        value: args.deepBreachCount,
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
        key: "limit_up_close_performance",
        title: "T+1..T+5 收盘守涨停价矩阵",
        description:
          `BASELINE 为全部 eligible；CLOSE_CONTEXT 按最低收盘价相对 T 日涨停价分桶。` +
          `略微跌破阈值 ${args.slightBreachBps} bps；收益从 T+${ENTRY_DAY} 开盘开始。`,
        columns: [
          { key: "dimension", label: "维度", align: "LEFT" },
          { key: "contextLabel", label: "收盘位置", align: "LEFT" },
          { key: "horizon", label: "退出视界", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "availableCount", label: "可用", align: "RIGHT" },
          {
            key: "meanWorstCloseVsLimitUp",
            label: "最低收盘相对涨停价均值",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianWorstCloseVsLimitUp",
            label: "最低收盘相对涨停价中位",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanGrossReturn",
            label: "平均毛收益",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianGrossReturn",
            label: "中位毛收益",
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
            label: "净收益胜率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrapCi95Low",
            label: "聚类 Bootstrap CI95 下界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrapCi95High",
            label: "聚类 Bootstrap CI95 上界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrapClusterCount",
            label: "日期 cluster 数",
            align: "RIGHT",
          },
        ],
        rows,
      },
    ],
    charts: args.forwardHorizons.map(horizon => ({
      key: `limit-up-close-median-net-h${horizon}`,
      title: `T+${horizon} · 收盘守涨停价分组中位净收益`,
      description: "固定分组描述，不代表最佳阈值。",
      kind: "BAR" as const,
      xLabel: "T+1..T+5 最低收盘相对 T 日涨停价",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `context-h${horizon}`,
          label: `T+${horizon}`,
          points: LIMIT_UP_CLOSE_CONTEXTS.map(context => ({
            x: LIMIT_UP_CLOSE_CONTEXT_LABELS[context],
            y:
              rows.find(
                row =>
                  row.dimension === "CLOSE_CONTEXT" &&
                  row.context === context &&
                  row.horizon === horizon
              )?.medianNetReturn ?? null,
          })),
        },
      ],
    })),
    customPayload,
  };
}
