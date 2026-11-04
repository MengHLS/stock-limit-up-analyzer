import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const ENTRY_WINDOW_DAYS = 5;
export const PULLBACK_TRIGGER_BPS = 100;
export const EXIT_DAY = 10;
export const VOLUME_RECOVERY_RATIO = 1;
export const BODY_HEIGHT_MIN = 0.001;
export const TURNOVER_MAX_PCT = 10;
export const ROUND_TRIP_COST_BPS = 20;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_922;

export type Mode =
  | "FILTERED_PRICE_EXIT"
  | "ALL_VOLUME_EXIT"
  | "FILTERED_VOLUME_EXIT";

export interface TradeSample {
  eventId: string;
  eventDate: string;
  year: number;
  bodyHeight: number;
  turnover: number;
  triggerDay: number;
  entryDay: number;
  exitDay: number;
  holdingDays: number;
  exitReason: "PRICE_BREAK" | "VOLUME_UNRECOVERED" | "TIME_T10";
  grossReturn: number;
}

export interface PerformanceRow {
  [key: string]: string | number | boolean | null;
  mode: Mode;
  entryDay: number;
  sampleCount: number;
  eventDateCount: number;
  meanBodyHeight: number | null;
  meanTurnover: number | null;
  meanHoldingDays: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
  priceBreakCount: number;
  volumeUnrecoveredCount: number;
  timeExitCount: number;
}

export interface ComparisonRow {
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

export const volumeRecoveryFilteredValidationSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  frozenRule: z.object({
    entryWindowDays: z.literal(ENTRY_WINDOW_DAYS),
    pullbackTriggerBps: z.literal(PULLBACK_TRIGGER_BPS),
    exitDay: z.literal(EXIT_DAY),
    volumeRecoveryRatio: z.literal(VOLUME_RECOVERY_RATIO),
    bodyHeightMin: z.literal(BODY_HEIGHT_MIN),
    turnoverMaxPct: z.literal(TURNOVER_MAX_PCT),
    costBps: z.literal(ROUND_TRIP_COST_BPS),
  }),
  informationBoundary: z.object({
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  counts: z.object({
    candidateCount: z.number().int().nonnegative(),
    exactLimitUpCloseCount: z.number().int().nonnegative(),
    filterEligibleEventCount: z.number().int().nonnegative(),
    triggeredCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    filteredPriceExitTradeCount: z.number().int().nonnegative(),
    allVolumeExitTradeCount: z.number().int().nonnegative(),
    filteredVolumeExitTradeCount: z.number().int().nonnegative(),
    duplicateEventIdCount: z.number().int().nonnegative(),
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

export type VolumeRecoveryFilteredValidationPayload = z.infer<
  typeof volumeRecoveryFilteredValidationSchema
>;

export const EXCLUSION_REASON_LABELS = {
  EVENT_NOT_EXACT_LIMIT_UP: "首板收盘价不等于交易所涨停价",
  EVENT_FILTERED_BODY: "首板实体高度不足 0.1%",
  EVENT_FILTERED_TURNOVER: "首板换手率不低于 10%",
  MISSING_PATH: "T+1..T+10 价格或成交量路径不完整",
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

function row(args: {
  mode: Mode;
  entryDay: number;
  trades: readonly TradeSample[];
  costBps: number;
}): PerformanceRow {
  const bootstrap = movingBlockBootstrapMean({
    samples: args.trades.map(trade => ({
      eventDate: trade.eventDate,
      value: trade.grossReturn - args.costBps / 10_000,
    })),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_DAYS,
    seed: BOOTSTRAP_SEED + args.entryDay * 10 + args.mode.length,
  });
  return {
    mode: args.mode,
    entryDay: args.entryDay,
    eventDateCount: new Set(args.trades.map(trade => trade.eventDate)).size,
    meanBodyHeight: mean(args.trades.map(trade => trade.bodyHeight)),
    meanTurnover: mean(args.trades.map(trade => trade.turnover)),
    meanHoldingDays: mean(args.trades.map(trade => trade.holdingDays)),
    ...summarize(
      args.trades.map(trade => trade.grossReturn),
      args.costBps
    ),
    bootstrapCi95Low: bootstrap?.low ?? null,
    bootstrapCi95High: bootstrap?.high ?? null,
    bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
    priceBreakCount: args.trades.filter(
      trade => trade.exitReason === "PRICE_BREAK"
    ).length,
    volumeUnrecoveredCount: args.trades.filter(
      trade => trade.exitReason === "VOLUME_UNRECOVERED"
    ).length,
    timeExitCount: args.trades.filter(trade => trade.exitReason === "TIME_T10")
      .length,
  };
}

export function assembleVolumeRecoveryFilteredValidation(args: {
  filteredPriceExitTrades: readonly TradeSample[];
  allVolumeExitTrades: readonly TradeSample[];
  filteredVolumeExitTrades: readonly TradeSample[];
  candidateCount: number;
  exactLimitUpCloseCount: number;
  filterEligibleEventCount: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const performanceRows: PerformanceRow[] = [];
  for (let entryDay = 2; entryDay <= 6; entryDay += 1) {
    for (const [mode, trades] of [
      ["FILTERED_PRICE_EXIT", args.filteredPriceExitTrades],
      ["ALL_VOLUME_EXIT", args.allVolumeExitTrades],
      ["FILTERED_VOLUME_EXIT", args.filteredVolumeExitTrades],
    ] as const) {
      performanceRows.push(
        row({
          mode,
          entryDay,
          trades: trades.filter(trade => trade.entryDay === entryDay),
          costBps: ROUND_TRIP_COST_BPS,
        })
      );
    }
  }

  const byEvent = (trades: readonly TradeSample[]) =>
    new Map(trades.map(trade => [trade.eventId, trade]));
  const compare = (
    comparison: string,
    left: readonly TradeSample[],
    right: readonly TradeSample[]
  ): ComparisonRow => {
    const rightByEvent = byEvent(right);
    const differences = left.flatMap(trade => {
      const other = rightByEvent.get(trade.eventId);
      return other
        ? [
            {
              eventDate: trade.eventDate,
              value: trade.grossReturn - other.grossReturn,
            },
          ]
        : [];
    });
    const bootstrap = movingBlockBootstrapMean({
      samples: differences,
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BOOTSTRAP_BLOCK_DAYS,
      seed: BOOTSTRAP_SEED + comparison.length,
    });
    return {
      comparison,
      sampleCount: differences.length,
      eventDateCount: new Set(differences.map(item => item.eventDate)).size,
      meanDifference: mean(differences.map(item => item.value)),
      medianDifference: quantile(
        [...differences.map(item => item.value)].sort((a, b) => a - b),
        0.5
      ),
      winRateDifference:
        differences.length === 0
          ? null
          : differences.filter(item => item.value > 0).length /
            differences.length,
      bootstrapCi95Low: bootstrap?.low ?? null,
      bootstrapCi95High: bootstrap?.high ?? null,
      bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
    };
  };

  const comparisonRows = [
    compare(
      "过滤后成交量退出 − 过滤后仅价格退出",
      args.filteredVolumeExitTrades,
      args.filteredPriceExitTrades
    ),
    compare(
      "过滤后成交量退出 − 未过滤成交量退出",
      args.filteredVolumeExitTrades,
      args.allVolumeExitTrades
    ),
  ];
  const primary = performanceRows.find(
    row => row.mode === "FILTERED_VOLUME_EXIT" && row.entryDay === 6
  )!;
  const totalFilteredVolume = args.filteredVolumeExitTrades;
  const observations: VolumeRecoveryFilteredValidationPayload["observations"] =
    [
      {
        kind: "DESCRIPTIVE",
        text:
          `严格涨停首板 ${args.exactLimitUpCloseCount} 个；通过实体/换手过滤 ${args.filterEligibleEventCount} 个；` +
          `触发 ${args.triggeredCount} 个；触发后不可买 ${args.entryUnfillableCount} 个。`,
      },
      {
        kind: "COMPARATIVE",
        text:
          `过滤后成交量子集 ${totalFilteredVolume.length} 条；价格破位退出 ` +
          `${totalFilteredVolume.filter(trade => trade.exitReason === "PRICE_BREAK").length} 条；` +
          `量能未恢复退出 ${totalFilteredVolume.filter(trade => trade.exitReason === "VOLUME_UNRECOVERED").length} 条；` +
          `持有到 T+10 ${totalFilteredVolume.filter(trade => trade.exitReason === "TIME_T10").length} 条。`,
      },
      {
        kind: "POTENTIAL_SIGNAL",
        text:
          `T+6 入场、过滤后成交量退出：平均净收益 ${formatPct(primary.meanNetReturn)}，` +
          `中位 ${formatPct(primary.medianNetReturn)}，胜率 ${formatPct(primary.winRateNet)}。`,
      },
      {
        kind: "LIMITATION",
        text: "量能恢复定义为 T+1..T+5 最大成交量不低于 T日成交量的 100%；这是固定阈值，不是搜索后的最优值。",
      },
      {
        kind: "LIMITATION",
        text: "当前运行是时间切片验证，不是未来未读数据 OOS；不能据此直接创建正式策略。",
      },
    ];

  const customPayload: VolumeRecoveryFilteredValidationPayload = {
    computationVersion: COMPUTATION_VERSION,
    frozenRule: {
      entryWindowDays: ENTRY_WINDOW_DAYS,
      pullbackTriggerBps: PULLBACK_TRIGGER_BPS,
      exitDay: EXIT_DAY,
      volumeRecoveryRatio: VOLUME_RECOVERY_RATIO,
      bodyHeightMin: BODY_HEIGHT_MIN,
      turnoverMaxPct: TURNOVER_MAX_PCT,
      costBps: ROUND_TRIP_COST_BPS,
    },
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "在固定状态机上验证实体/换手过滤与成交量恢复退出是否能改善动态交易结果。",
      decisionTimeInformation: [
        "首板日实体高度和换手率",
        "T+1..T+5 回撤路径价格与成交量",
      ],
      postEventResearchOutcome: [
        "动态退出的净收益",
        "成交量未恢复退出与仅价格退出、未过滤成交量退出的配对差异",
      ],
      notes: [
        "实体和换手过滤发生在事件入池阶段。",
        "成交量恢复状态在 T+5 收盘后确认，T+6 开盘执行退出。",
      ],
    },
    counts: {
      candidateCount: args.candidateCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      filterEligibleEventCount: args.filterEligibleEventCount,
      triggeredCount: args.triggeredCount,
      entryUnfillableCount: args.entryUnfillableCount,
      filteredPriceExitTradeCount: args.filteredPriceExitTrades.length,
      allVolumeExitTradeCount: args.allVolumeExitTrades.length,
      filteredVolumeExitTradeCount: args.filteredVolumeExitTrades.length,
      duplicateEventIdCount: args.duplicateEventIdCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "本实验固定实体、换手和成交量恢复阈值，不做参数搜索。",
      "过滤后成交量退出只有在配对比较中优于仅价格退出才有保留价值。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.filterEligibleEventCount,
      excludedCount: args.candidateCount - args.filterEligibleEventCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 严格收盘涨停，且通过实体 >0.1% 和换手率 <10% 过滤。",
        "成交量关系只在已产生动态交易后研究，不参与入场选择。",
      ],
    },
    statistics: [
      {
        code: "filter_eligible_event_count",
        label: "通过实体/换手过滤",
        value: args.filterEligibleEventCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "filtered_volume_exit_trade_count",
        label: "过滤后成交量退出交易",
        value: args.filteredVolumeExitTrades.length,
        unit: "条",
        digits: 0,
      },
      {
        code: "volume_unrecovered_count",
        label: "量能未恢复退出",
        value: totalFilteredVolume.filter(
          trade => trade.exitReason === "VOLUME_UNRECOVERED"
        ).length,
        unit: "条",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "filtered_volume_exit_performance",
        title: "组合过滤与成交量恢复退出",
        description:
          "FILTERED_PRICE_EXIT 只使用价格破位退出；ALL_VOLUME_EXIT 未做实体/换手过滤；FILTERED_VOLUME_EXIT 同时应用全部过滤和量能退出。",
        columns: [
          { key: "mode", label: "模式", align: "LEFT" },
          { key: "entryDay", label: "入场日", align: "RIGHT" },
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
            key: "meanTurnover",
            label: "平均换手",
            unit: "百分比",
            digits: 4,
            align: "RIGHT",
          },
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
          { key: "priceBreakCount", label: "价格退出", align: "RIGHT" },
          { key: "volumeUnrecoveredCount", label: "量能退出", align: "RIGHT" },
          { key: "timeExitCount", label: "时间退出", align: "RIGHT" },
        ],
        rows: performanceRows,
      },
      {
        key: "filtered_volume_paired_differences",
        title: "成交量恢复退出的配对增量",
        description: "同一事件存在两种模式结果时才纳入配对差值。",
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
    ],
    customPayload,
  };
}

function formatPct(value: number | null): string {
  return value === null ? "无法计算" : `${(value * 100).toFixed(2)}%`;
}
