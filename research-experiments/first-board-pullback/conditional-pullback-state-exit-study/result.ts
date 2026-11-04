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

export type ExitReason = "TIME_T10" | "STOP_NEXT_OPEN" | "STOP_FALLBACK_CLOSE";
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export interface DynamicTradeSample {
  eventId: string;
  eventDate: string;
  year: number;
  triggerDay: number;
  entryDay: number;
  exitDay: number;
  exitReason: ExitReason;
  holdingDays: number;
  grossReturn: number;
}

export interface FixedTradeSample {
  eventId: string;
  eventDate: string;
  year: number;
  triggerDay: number;
  entryDay: number;
  exitDay: number;
  grossReturn: number;
}

export interface BaselineSample {
  eventId: string;
  eventDate: string;
  year: number;
  grossReturn: number;
}

export interface PerformanceRow {
  [key: string]: string | number | boolean | null;
  mode: "BASELINE" | "CONDITIONAL_FIXED" | "CONDITIONAL_DYNAMIC";
  entryDay: number;
  exitDay: number;
  sampleCount: number;
  eventDateCount: number;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
  meanHoldingDays: number | null;
  stopExitCount: number;
  timeExitCount: number;
}

export interface PairedDifferenceRow {
  [key: string]: string | number | boolean | null;
  comparison: string;
  sampleCount: number;
  eventDateCount: number;
  meanDifference: number | null;
  medianDifference: number | null;
  winRateDifference: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
}

export interface EntryAccountingRow {
  [key: string]: string | number | boolean | null;
  triggerDay: number;
  entryDay: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  enteredCount: number;
  stopExitCount: number;
  timeExitCount: number;
}

export const conditionalPullbackStateExitCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  informationBoundary: z.object({
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  frozenRule: z.object({
    entryWindowDays: z.literal(ENTRY_WINDOW_DAYS),
    pullbackTriggerBps: z.literal(PULLBACK_TRIGGER_BPS),
    exitDay: z.literal(EXIT_DAY),
    costBps: z.literal(ROUND_TRIP_COST_BPS),
    entryDecision: z.string().min(1),
    exitDecision: z.string().min(1),
  }),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    exactLimitUpCloseCount: z.number().int().nonnegative(),
    breakBeforeEntryCount: z.number().int().nonnegative(),
    noTriggerCount: z.number().int().nonnegative(),
    triggeredCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    dynamicTradeCount: z.number().int().nonnegative(),
    fixedTradeCount: z.number().int().nonnegative(),
    baselineCount: z.number().int().nonnegative(),
    stopNextOpenCount: z.number().int().nonnegative(),
    stopFallbackCloseCount: z.number().int().nonnegative(),
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

export type ConditionalPullbackStateExitCustomPayload = z.infer<
  typeof conditionalPullbackStateExitCustomPayloadSchema
>;

export const EXCLUSION_REASON_LABELS = {
  NOT_FIRST_LIMIT: "事件不是首板",
  MISSING_EVENT_DAY_BAR: "缺少首板日行情",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC / 前收缺失或非法",
  EVENT_NOT_EXACT_LIMIT_UP: "首板日收盘价不等于交易所口径涨停价",
  MISSING_ENTRY_WINDOW_PATH: "T+1..T+5 行情路径不完整",
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

export function assembleConditionalPullbackStateExitResult(args: {
  dynamicTrades: readonly DynamicTradeSample[];
  fixedTrades: readonly FixedTradeSample[];
  baselineSamples: readonly BaselineSample[];
  candidateCount: number;
  eligibleCount: number;
  exactLimitUpCloseCount: number;
  breakBeforeEntryCount: number;
  noTriggerCount: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
  triggerAccounting: ReadonlyArray<{
    triggerDay: number;
    triggeredCount: number;
    entryUnfillableCount: number;
    enteredCount: number;
    stopExitCount: number;
    timeExitCount: number;
  }>;
}): ExperimentResultPayload {
  const performanceRows: PerformanceRow[] = [];
  const entryDays = Array.from(
    { length: ENTRY_WINDOW_DAYS },
    (_, index) => index + 1
  );
  const dynamicByDay = (entryDay: number) =>
    args.dynamicTrades.filter(trade => trade.entryDay === entryDay);
  const fixedByDay = (entryDay: number) =>
    args.fixedTrades.filter(trade => trade.entryDay === entryDay);

  const baseline = summarize(
    args.baselineSamples.map(sample => sample.grossReturn),
    ROUND_TRIP_COST_BPS
  );
  performanceRows.push({
    mode: "BASELINE",
    entryDay: 1,
    exitDay: EXIT_DAY,
    eventDateCount: new Set(
      args.baselineSamples.map(sample => sample.eventDate)
    ).size,
    ...baseline,
    bootstrapCi95Low:
      movingBlockBootstrapMean({
        samples: args.baselineSamples.map(sample => ({
          eventDate: sample.eventDate,
          value: sample.grossReturn - ROUND_TRIP_COST_BPS / 10_000,
        })),
        iterations: BOOTSTRAP_ITERATIONS,
        blockLength: BOOTSTRAP_BLOCK_DAYS,
        seed: BOOTSTRAP_SEED + 1,
      })?.low ?? null,
    bootstrapCi95High:
      movingBlockBootstrapMean({
        samples: args.baselineSamples.map(sample => ({
          eventDate: sample.eventDate,
          value: sample.grossReturn - ROUND_TRIP_COST_BPS / 10_000,
        })),
        iterations: BOOTSTRAP_ITERATIONS,
        blockLength: BOOTSTRAP_BLOCK_DAYS,
        seed: BOOTSTRAP_SEED + 1,
      })?.high ?? null,
    bootstrapClusterCount: new Set(
      args.baselineSamples.map(sample => sample.eventDate)
    ).size,
    meanHoldingDays: EXIT_DAY,
    stopExitCount: 0,
    timeExitCount: args.baselineSamples.length,
  });

  for (const entryDay of entryDays) {
    const dynamic = dynamicByDay(entryDay);
    const fixed = fixedByDay(entryDay);
    const dynamicBootstrap = movingBlockBootstrapMean({
      samples: dynamic.map(sample => ({
        eventDate: sample.eventDate,
        value: sample.grossReturn - ROUND_TRIP_COST_BPS / 10_000,
      })),
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BOOTSTRAP_BLOCK_DAYS,
      seed: BOOTSTRAP_SEED + entryDay * 100 + 1,
    });
    const fixedBootstrap = movingBlockBootstrapMean({
      samples: fixed.map(sample => ({
        eventDate: sample.eventDate,
        value: sample.grossReturn - ROUND_TRIP_COST_BPS / 10_000,
      })),
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BOOTSTRAP_BLOCK_DAYS,
      seed: BOOTSTRAP_SEED + entryDay * 100 + 2,
    });
    performanceRows.push({
      mode: "CONDITIONAL_DYNAMIC",
      entryDay,
      exitDay: EXIT_DAY,
      eventDateCount: new Set(dynamic.map(sample => sample.eventDate)).size,
      ...summarize(
        dynamic.map(sample => sample.grossReturn),
        ROUND_TRIP_COST_BPS
      ),
      bootstrapCi95Low: dynamicBootstrap?.low ?? null,
      bootstrapCi95High: dynamicBootstrap?.high ?? null,
      bootstrapClusterCount: dynamicBootstrap?.clusterCount ?? 0,
      meanHoldingDays: mean(dynamic.map(sample => sample.holdingDays)),
      stopExitCount: dynamic.filter(sample => sample.exitReason !== "TIME_T10")
        .length,
      timeExitCount: dynamic.filter(sample => sample.exitReason === "TIME_T10")
        .length,
    });
    performanceRows.push({
      mode: "CONDITIONAL_FIXED",
      entryDay,
      exitDay: EXIT_DAY,
      eventDateCount: new Set(fixed.map(sample => sample.eventDate)).size,
      ...summarize(
        fixed.map(sample => sample.grossReturn),
        ROUND_TRIP_COST_BPS
      ),
      bootstrapCi95Low: fixedBootstrap?.low ?? null,
      bootstrapCi95High: fixedBootstrap?.high ?? null,
      bootstrapClusterCount: fixedBootstrap?.clusterCount ?? 0,
      meanHoldingDays: mean(
        fixed.map(sample => sample.exitDay - sample.entryDay + 1)
      ),
      stopExitCount: 0,
      timeExitCount: fixed.length,
    });
  }

  const dynamicByEvent = new Map(
    args.dynamicTrades.map(trade => [trade.eventId, trade])
  );
  const fixedByEvent = new Map(
    args.fixedTrades.map(trade => [trade.eventId, trade])
  );
  const baselineByEvent = new Map(
    args.baselineSamples.map(trade => [trade.eventId, trade])
  );
  const pairedDifferences: Array<{
    eventId: string;
    eventDate: string;
    value: number;
  }> = [];
  for (const [eventId, dynamic] of dynamicByEvent) {
    const fixed = fixedByEvent.get(eventId);
    if (!fixed) continue;
    pairedDifferences.push({
      eventId,
      eventDate: dynamic.eventDate,
      value: dynamic.grossReturn - fixed.grossReturn,
    });
  }
  const dynamicVsBaseline: Array<{
    eventId: string;
    eventDate: string;
    value: number;
  }> = [];
  for (const [eventId, dynamic] of dynamicByEvent) {
    const base = baselineByEvent.get(eventId);
    if (!base) continue;
    dynamicVsBaseline.push({
      eventId,
      eventDate: dynamic.eventDate,
      value: dynamic.grossReturn - base.grossReturn,
    });
  }
  const comparisonRow = (
    comparison: string,
    samples: readonly { eventDate: string; value: number }[]
  ): PairedDifferenceRow => {
    const bootstrap = movingBlockBootstrapMean({
      samples,
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BOOTSTRAP_BLOCK_DAYS,
      seed: BOOTSTRAP_SEED + comparison.length,
    });
    return {
      comparison,
      sampleCount: samples.length,
      eventDateCount: new Set(samples.map(sample => sample.eventDate)).size,
      meanDifference: mean(samples.map(sample => sample.value)),
      medianDifference: quantile(
        [...samples.map(sample => sample.value)].sort((a, b) => a - b),
        0.5
      ),
      winRateDifference:
        samples.length === 0
          ? null
          : samples.filter(sample => sample.value > 0).length / samples.length,
      bootstrapCi95Low: bootstrap?.low ?? null,
      bootstrapCi95High: bootstrap?.high ?? null,
      bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
    };
  };
  const comparisonRows = [
    comparisonRow("动态退出 − 条件买入固定T+10", pairedDifferences),
    comparisonRow("动态退出 − T+1固定基准", dynamicVsBaseline),
  ];

  const entryAccountingRows: EntryAccountingRow[] = args.triggerAccounting.map(
    item => ({
      triggerDay: item.triggerDay,
      entryDay: item.triggerDay + 1,
      triggeredCount: item.triggeredCount,
      entryUnfillableCount: item.entryUnfillableCount,
      enteredCount: item.enteredCount,
      stopExitCount: item.stopExitCount,
      timeExitCount: item.timeExitCount,
    })
  );

  const dynamicPerformance = performanceRows.filter(
    row => row.mode === "CONDITIONAL_DYNAMIC"
  );
  const observations: ConditionalPullbackStateExitCustomPayload["observations"] =
    [
      {
        kind: "DESCRIPTIVE",
        text:
          `严格涨停首板 ${args.exactLimitUpCloseCount} 个；等待窗口内破位 ${args.breakBeforeEntryCount} 个；` +
          `未触发回撤 ${args.noTriggerCount} 个；触发 ${args.triggeredCount} 个；触发后不可买 ${args.entryUnfillableCount} 个。`,
      },
      {
        kind: "COMPARATIVE",
        text:
          `动态退出交易 ${args.dynamicTrades.length} 条；其中下一可卖开盘止损 ${args.dynamicTrades.filter(trade => trade.exitReason === "STOP_NEXT_OPEN").length} 条，` +
          `止损后回退到 T+10 收盘 ${args.dynamicTrades.filter(trade => trade.exitReason === "STOP_FALLBACK_CLOSE").length} 条，` +
          `持有到 T+10 ${args.dynamicTrades.filter(trade => trade.exitReason === "TIME_T10").length} 条。`,
      },
      {
        kind: "COMPARATIVE",
        text:
          "按入场日的动态退出中位净收益：" +
          dynamicPerformance
            .map(
              row =>
                `T+${row.entryDay} ${formatPct(row.medianNetReturn)} (n=${row.sampleCount})`
            )
            .join("；") +
          "。",
      },
      {
        kind: "LIMITATION",
        text: "跌破首板开盘价按收盘确认，下一交易日开盘退出；若开盘跌停不可卖，则向后寻找可卖开盘，最迟回退到 T+10 收盘。",
      },
      {
        kind: "LIMITATION",
        text: "只使用日线价格；未实现盘口排队、滑点、部分成交或日内止损。结果属于探索性研究，不是策略 OOS。",
      },
    ];

  const customPayload: ConditionalPullbackStateExitCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "研究 T+1..T+5 条件入场后，T+6..T+10 跌破首板开盘价时动态退出，与固定 T+10 退出和 T+1 基准的差异。",
      decisionTimeInformation: [
        "T+1..T+5 收盘价相对首板收盘的回撤",
        "T+1..T+5 是否跌破首板开盘价",
        "入场后每日收盘是否跌破首板开盘价",
      ],
      postEventResearchOutcome: [
        "动态退出、条件买入固定 T+10 退出、T+1 固定基准的净收益",
        "动态退出相对固定退出和基准的配对差异",
      ],
      notes: [
        "所有入场与退出均只使用当时已发生的数据，次日开盘执行。",
        "冻结规则不允许在查看结果后修改阈值或窗口。",
      ],
    },
    frozenRule: {
      entryWindowDays: ENTRY_WINDOW_DAYS,
      pullbackTriggerBps: PULLBACK_TRIGGER_BPS,
      exitDay: EXIT_DAY,
      costBps: ROUND_TRIP_COST_BPS,
      entryDecision:
        "收盘首次回撤至首板收盘下方 100bps，且未跌破首板开盘价；次日开盘买入。",
      exitDecision:
        "买入后收盘跌破首板开盘价，则下一可卖开盘退出；否则 T+10 收盘退出。",
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      breakBeforeEntryCount: args.breakBeforeEntryCount,
      noTriggerCount: args.noTriggerCount,
      triggeredCount: args.triggeredCount,
      entryUnfillableCount: args.entryUnfillableCount,
      dynamicTradeCount: args.dynamicTrades.length,
      fixedTradeCount: args.fixedTrades.length,
      baselineCount: args.baselineSamples.length,
      stopNextOpenCount: args.dynamicTrades.filter(
        trade => trade.exitReason === "STOP_NEXT_OPEN"
      ).length,
      stopFallbackCloseCount: args.dynamicTrades.filter(
        trade => trade.exitReason === "STOP_FALLBACK_CLOSE"
      ).length,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "本实验不输出最优回撤阈值或退出日。",
      "动态退出必须同时优于条件买入固定 T+10 和 T+1 固定基准才有继续价值。",
      "当前 Run 为探索性研究，不能直接作为正式策略证据。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 首板严格收盘涨停，且 T+1..T+5 路径完整。",
        "未触发、触发后不可买仍计入 eligible，但不会产生交易样本。",
      ],
    },
    statistics: [
      {
        code: "triggered_count",
        label: "触发回撤",
        value: args.triggeredCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "dynamic_trade_count",
        label: "动态退出交易",
        value: args.dynamicTrades.length,
        unit: "条",
        digits: 0,
      },
      {
        code: "stop_next_open_count",
        label: "跌破后下一开盘退出",
        value: args.dynamicTrades.filter(
          trade => trade.exitReason === "STOP_NEXT_OPEN"
        ).length,
        unit: "条",
        digits: 0,
      },
      {
        code: "time_exit_count",
        label: "持有到 T+10 收盘",
        value: args.dynamicTrades.filter(
          trade => trade.exitReason === "TIME_T10"
        ).length,
        unit: "条",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "state_machine_performance",
        title: "条件入场与动态退出收益",
        description:
          "BASELINE = T+1 开盘到 T+10 收盘；CONDITIONAL_FIXED = 条件买入但固定 T+10 退出；CONDITIONAL_DYNAMIC = 条件买入并动态退出。",
        columns: [
          { key: "mode", label: "模式", align: "LEFT" },
          { key: "entryDay", label: "入场日", align: "RIGHT" },
          { key: "exitDay", label: "最迟退出", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "meanHoldingDays",
            label: "平均持有日",
            digits: 3,
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
          { key: "stopExitCount", label: "止损退出", align: "RIGHT" },
          { key: "timeExitCount", label: "时间退出", align: "RIGHT" },
        ],
        rows: performanceRows,
      },
      {
        key: "paired_differences",
        title: "动态退出的配对增量",
        description: "只在同一事件同时存在两种模式结果时计算差值。",
        columns: [
          { key: "comparison", label: "比较", align: "LEFT" },
          { key: "sampleCount", label: "配对样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "meanDifference",
            label: "平均差",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianDifference",
            label: "中位差",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "winRateDifference",
            label: "差值胜率",
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
        rows: comparisonRows,
      },
      {
        key: "entry_accounting",
        title: "触发与入场账目",
        description: "每个触发日的触发、不可买和实际入场账目。",
        columns: [
          { key: "triggerDay", label: "触发日", align: "RIGHT" },
          { key: "entryDay", label: "理论入场日", align: "RIGHT" },
          { key: "triggeredCount", label: "触发", align: "RIGHT" },
          { key: "entryUnfillableCount", label: "不可买", align: "RIGHT" },
          { key: "enteredCount", label: "已入场", align: "RIGHT" },
          { key: "stopExitCount", label: "止损退出", align: "RIGHT" },
          { key: "timeExitCount", label: "时间退出", align: "RIGHT" },
        ],
        rows: entryAccountingRows,
      },
    ],
    charts: [
      {
        key: "dynamic-vs-fixed-by-entry-day",
        title: "按入场日的 T+10 中位净收益",
        description: "动态退出与条件买入固定退出的直接比较。",
        kind: "BAR" as const,
        xLabel: "入场日",
        yLabel: "中位净收益",
        unit: "比例",
        series: [
          {
            key: "dynamic",
            label: "动态退出",
            points: entryDays.map(entryDay => ({
              x: `T+${entryDay}`,
              y:
                performanceRows.find(
                  row =>
                    row.mode === "CONDITIONAL_DYNAMIC" &&
                    row.entryDay === entryDay
                )?.medianNetReturn ?? null,
            })),
          },
          {
            key: "fixed",
            label: "固定 T+10",
            points: entryDays.map(entryDay => ({
              x: `T+${entryDay}`,
              y:
                performanceRows.find(
                  row =>
                    row.mode === "CONDITIONAL_FIXED" &&
                    row.entryDay === entryDay
                )?.medianNetReturn ?? null,
            })),
          },
        ],
      },
    ],
    customPayload,
  };
}

function formatPct(value: number | null): string {
  return value === null ? "无法计算" : `${(value * 100).toFixed(2)}%`;
}
