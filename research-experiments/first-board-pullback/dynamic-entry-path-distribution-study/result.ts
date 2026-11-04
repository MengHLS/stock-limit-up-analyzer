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
export const PATH_THRESHOLDS = [-0.05, -0.02, 0.02, 0.05] as const;

export type ExitReason = "PRICE_BREAK" | "TIME_T10";
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export interface PathTradeSample {
  eventId: string;
  eventDate: string;
  year: number;
  entryDay: number;
  exitDay: number;
  exitReason: ExitReason;
  actualNetReturn: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  maxFavorableDay: number;
  maxAdverseDay: number;
  marksByDay: Readonly<Record<string, number>>;
  cumulativeMfeByDay: Readonly<Record<string, number>>;
  cumulativeMaeByDay: Readonly<Record<string, number>>;
  firstReachByThreshold: Readonly<Record<string, number | null>>;
}

export interface DailyPathRow {
  [key: string]: string | number | boolean | null;
  entryDay: number;
  holdingDay: number;
  sampleCount: number;
  eventDateCount: number;
  meanNetMark: number | null;
  p5NetMark: number | null;
  p25NetMark: number | null;
  medianNetMark: number | null;
  p75NetMark: number | null;
  p95NetMark: number | null;
  winRate: number | null;
  meanCumulativeMfe: number | null;
  meanCumulativeMae: number | null;
  exitedAtOrBeforeDayCount: number;
}

export interface PathSummaryRow {
  [key: string]: string | number | boolean | null;
  entryDay: number;
  sampleCount: number;
  eventDateCount: number;
  actualMeanNetReturn: number | null;
  actualMedianNetReturn: number | null;
  actualWinRateNet: number | null;
  actualBootstrapCi95Low: number | null;
  actualBootstrapCi95High: number | null;
  meanMfe: number | null;
  medianMfe: number | null;
  meanMae: number | null;
  medianMae: number | null;
  medianMfeDay: number | null;
  medianMaeDay: number | null;
  priceBreakCount: number;
  timeExitCount: number;
  reachMinus5Rate: number | null;
  reachMinus2Rate: number | null;
  reachPlus2Rate: number | null;
  reachPlus5Rate: number | null;
  medianMinus2ReachDay: number | null;
  medianPlus2ReachDay: number | null;
}

export const dynamicEntryPathDistributionSchema = z.object({
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
    exactLimitUpCloseCount: z.number().int().nonnegative(),
    triggeredCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    tradeCount: z.number().int().nonnegative(),
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

export type DynamicEntryPathDistributionPayload = z.infer<
  typeof dynamicEntryPathDistributionSchema
>;

export const EXCLUSION_REASON_LABELS = {
  EVENT_NOT_EXACT_LIMIT_UP: "首板收盘价不等于交易所涨停价",
  MISSING_PATH: "T+1..T+10 行情路径不完整",
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
      meanNetMark: null,
      p5NetMark: null,
      p25NetMark: null,
      medianNetMark: null,
      p75NetMark: null,
      p95NetMark: null,
      winRate: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    sampleCount: values.length,
    meanNetMark: round(mean(values)!),
    p5NetMark: round(quantile(sorted, 0.05)!),
    p25NetMark: round(quantile(sorted, 0.25)!),
    medianNetMark: round(quantile(sorted, 0.5)!),
    p75NetMark: round(quantile(sorted, 0.75)!),
    p95NetMark: round(quantile(sorted, 0.95)!),
    winRate: round(values.filter(value => value > 0).length / values.length),
  };
}

export function assembleDynamicEntryPathDistribution(args: {
  samples: readonly PathTradeSample[];
  candidateCount: number;
  exactLimitUpCloseCount: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const dailyRows: DailyPathRow[] = [];
  const summaryRows: PathSummaryRow[] = [];
  for (let entryDay = 2; entryDay <= 6; entryDay += 1) {
    const entrySamples = args.samples.filter(
      sample => sample.entryDay === entryDay
    );
    for (let day = entryDay; day <= EXIT_DAY; day += 1) {
      const held = entrySamples.filter(sample => sample.exitDay >= day);
      const marks = held
        .map(sample => sample.marksByDay[String(day)])
        .filter((value): value is number => value !== undefined);
      const cumulativeMfe = held
        .map(sample => sample.cumulativeMfeByDay[String(day)])
        .filter((value): value is number => value !== undefined);
      const cumulativeMae = held
        .map(sample => sample.cumulativeMaeByDay[String(day)])
        .filter((value): value is number => value !== undefined);
      dailyRows.push({
        entryDay,
        holdingDay: day - entryDay + 1,
        eventDateCount: new Set(held.map(sample => sample.eventDate)).size,
        ...summarize(marks),
        meanCumulativeMfe: mean(cumulativeMfe),
        meanCumulativeMae: mean(cumulativeMae),
        exitedAtOrBeforeDayCount: entrySamples.filter(
          sample => sample.exitDay <= day
        ).length,
      });
    }
  }

  for (let entryDay = 2; entryDay <= 6; entryDay += 1) {
    const entrySamples = args.samples.filter(
      sample => sample.entryDay === entryDay
    );
    const actualNet = entrySamples.map(sample => sample.actualNetReturn);
    const bootstrap = movingBlockBootstrapMean({
      samples: entrySamples.map(sample => ({
        eventDate: sample.eventDate,
        value: sample.actualNetReturn,
      })),
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BOOTSTRAP_BLOCK_DAYS,
      seed: BOOTSTRAP_SEED + entryDay * 10,
    });
    const medianReachDay = (threshold: number): number | null => {
      const days = entrySamples
        .map(sample => sample.firstReachByThreshold[String(threshold)])
        .filter((day): day is number => day !== null && day !== undefined);
      return quantile(
        [...days].sort((a, b) => a - b),
        0.5
      );
    };
    summaryRows.push({
      entryDay,
      sampleCount: entrySamples.length,
      eventDateCount: new Set(entrySamples.map(sample => sample.eventDate))
        .size,
      actualMeanNetReturn: mean(actualNet),
      actualMedianNetReturn: quantile(
        [...actualNet].sort((a, b) => a - b),
        0.5
      ),
      actualWinRateNet:
        actualNet.length === 0
          ? null
          : actualNet.filter(value => value > 0).length / actualNet.length,
      actualBootstrapCi95Low: bootstrap?.low ?? null,
      actualBootstrapCi95High: bootstrap?.high ?? null,
      meanMfe: mean(entrySamples.map(sample => sample.maxFavorableExcursion)),
      medianMfe: quantile(
        [...entrySamples.map(sample => sample.maxFavorableExcursion)].sort(
          (a, b) => a - b
        ),
        0.5
      ),
      meanMae: mean(entrySamples.map(sample => sample.maxAdverseExcursion)),
      medianMae: quantile(
        [...entrySamples.map(sample => sample.maxAdverseExcursion)].sort(
          (a, b) => a - b
        ),
        0.5
      ),
      medianMfeDay: quantile(
        [...entrySamples.map(sample => sample.maxFavorableDay)].sort(
          (a, b) => a - b
        ),
        0.5
      ),
      medianMaeDay: quantile(
        [...entrySamples.map(sample => sample.maxAdverseDay)].sort(
          (a, b) => a - b
        ),
        0.5
      ),
      priceBreakCount: entrySamples.filter(
        sample => sample.exitReason === "PRICE_BREAK"
      ).length,
      timeExitCount: entrySamples.filter(
        sample => sample.exitReason === "TIME_T10"
      ).length,
      reachMinus5Rate:
        entrySamples.length === 0
          ? null
          : entrySamples.filter(
              sample => sample.firstReachByThreshold["-0.05"] !== null
            ).length / entrySamples.length,
      reachMinus2Rate:
        entrySamples.length === 0
          ? null
          : entrySamples.filter(
              sample => sample.firstReachByThreshold["-0.02"] !== null
            ).length / entrySamples.length,
      reachPlus2Rate:
        entrySamples.length === 0
          ? null
          : entrySamples.filter(
              sample => sample.firstReachByThreshold["0.02"] !== null
            ).length / entrySamples.length,
      reachPlus5Rate:
        entrySamples.length === 0
          ? null
          : entrySamples.filter(
              sample => sample.firstReachByThreshold["0.05"] !== null
            ).length / entrySamples.length,
      medianMinus2ReachDay: medianReachDay(-0.02),
      medianPlus2ReachDay: medianReachDay(0.02),
    });
  }

  const t6Summary = summaryRows.find(row => row.entryDay === 6)!;
  const observations: DynamicEntryPathDistributionPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `严格收盘涨停首板 ${args.exactLimitUpCloseCount} 个；触发动态入场 ${args.triggeredCount} 个；` +
        `动态交易 ${args.samples.length} 条。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `T+6 入场实际结果：平均净收益 ${formatPct(t6Summary.actualMeanNetReturn)}，` +
        `中位 ${formatPct(t6Summary.actualMedianNetReturn)}，` +
        `MFE 中位 ${formatPct(t6Summary.medianMfe)}，MAE 中位 ${formatPct(t6Summary.medianMae)}。`,
    },
    {
      kind: "LIMITATION",
      text: "每日收益标记以实际入场开盘价为基准；退出日使用实际退出价格，退出后路径停止计算。",
    },
    {
      kind: "LIMITATION",
      text: "MFE/MAE 使用持有期间的高低点估计，不代表可成交的盘中价位。",
    },
  ];

  const customPayload: DynamicEntryPathDistributionPayload = {
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
        "在固定条件下入场和动态退出后，展开 T+1..T+10 每日路径、MFE/MAE 和阈值时间结构。",
      decisionTimeInformation: [
        "T+1..T+5 回撤路径价格",
        "首板日开盘价与收盘价",
      ],
      postEventResearchOutcome: [
        "每日净收益分位数",
        "MFE / MAE 及发生日",
        "首次触及 ±2% / ±5% 的比例和日期",
      ],
      notes: ["路径只对实际入场事件计算。", "每笔交易的路径在动态退出日停止。"],
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      triggeredCount: args.triggeredCount,
      entryUnfillableCount: args.entryUnfillableCount,
      tradeCount: args.samples.length,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "本实验不选择最优持有期。",
      "每日路径分布用于识别收益发生和衰减的时间结构。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.exactLimitUpCloseCount,
      excludedCount: args.candidateCount - args.exactLimitUpCloseCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 严格收盘涨停首板，且 T+1..T+10 行情路径完整。",
        "入场、退出和样本资格沿用既有动态状态机。",
      ],
    },
    statistics: [
      {
        code: "trade_count",
        label: "动态交易",
        value: args.samples.length,
        unit: "条",
        digits: 0,
      },
      {
        code: "t6_median_mfe",
        label: "T+6入场 MFK 中位",
        value: t6Summary.medianMfe,
        unit: "比例",
        digits: 6,
      },
      {
        code: "t6_median_mae",
        label: "T+6入场 MAE 中位",
        value: t6Summary.medianMae,
        unit: "比例",
        digits: 6,
      },
    ],
    tables: [
      {
        key: "daily_path_distribution",
        title: "每日持有路径分布",
        description:
          "按实际入场日展开；退出日使用实际退出价格，退出后不再计入。",
        columns: [
          { key: "entryDay", label: "入场日", align: "RIGHT" },
          { key: "holdingDay", label: "持有第N日", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "meanNetMark",
            label: "平均标记",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "p5NetMark",
            label: "P5",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "p25NetMark",
            label: "P25",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianNetMark",
            label: "中位",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "p75NetMark",
            label: "P75",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "p95NetMark",
            label: "P95",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "winRate",
            label: "胜率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanCumulativeMfe",
            label: "平均累计MFE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "meanCumulativeMae",
            label: "平均累计MAE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          { key: "exitedAtOrBeforeDayCount", label: "已退出", align: "RIGHT" },
        ],
        rows: dailyRows,
      },
      {
        key: "path_summary",
        title: "路径摘要",
        description: "每笔交易的实际净收益、MFE/MAE 及阈值首次触及时间。",
        columns: [
          { key: "entryDay", label: "入场日", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          {
            key: "actualMeanNetReturn",
            label: "实际平均净收益",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "actualMedianNetReturn",
            label: "实际中位净收益",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "actualWinRateNet",
            label: "实际胜率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "actualBootstrapCi95Low",
            label: "实际聚类CI95下界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "actualBootstrapCi95High",
            label: "实际聚类CI95上界",
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
            key: "medianMfeDay",
            label: "MFE中位日",
            digits: 3,
            align: "RIGHT",
          },
          {
            key: "medianMaeDay",
            label: "MAE中位日",
            digits: 3,
            align: "RIGHT",
          },
          { key: "priceBreakCount", label: "价格退出", align: "RIGHT" },
          { key: "timeExitCount", label: "时间退出", align: "RIGHT" },
          {
            key: "reachMinus5Rate",
            label: "曾触及-5%",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "reachMinus2Rate",
            label: "曾触及-2%",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "reachPlus2Rate",
            label: "曾触及+2%",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "reachPlus5Rate",
            label: "曾触及+5%",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "medianMinus2ReachDay",
            label: "-2%中位到达日",
            digits: 3,
            align: "RIGHT",
          },
          {
            key: "medianPlus2ReachDay",
            label: "+2%中位到达日",
            digits: 3,
            align: "RIGHT",
          },
        ],
        rows: summaryRows,
      },
    ],
    charts: [2, 3, 4, 5, 6].map(entryDay => ({
      key: `path-median-entry-${entryDay}`,
      title: `T+${entryDay} 入场后的中位路径`,
      description: "中位净收益按持有日展开；退出后停止。",
      kind: "LINE" as const,
      xLabel: "持有第 N 日",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `entry-${entryDay}`,
          label: `T+${entryDay} 入场`,
          points: dailyRows
            .filter(row => row.entryDay === entryDay)
            .map(row => ({
              x: String(row.holdingDay),
              y: row.medianNetMark,
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
