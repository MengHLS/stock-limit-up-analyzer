import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const CONTEXT_DAYS = 5;
export const ENTRY_DAY = 6;
export const MAX_HORIZON = 20;
export const DEFAULT_HORIZONS = [10, 20] as const;
export const ROUND_TRIP_COST_BPS = 20;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_922;

export const STREAK_VALUES = [0, 1, 2, 3, 4, 5] as const;
export type StreakValue = (typeof STREAK_VALUES)[number];
export type HoldMode = "CLOSE" | "LOW";
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export interface HoldSample {
  eventId: string;
  eventDate: string;
  year: number;
  closeHoldStreak: StreakValue;
  lowHoldStreak: StreakValue;
  horizon: number;
  grossReturn: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
}

export interface HoldPerformanceRow {
  [key: string]: string | number | boolean | null;
  mode: HoldMode;
  streak: StreakValue;
  horizon: number;
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
}

export const limitUpPriceHoldStreakSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  studyRule: z.object({
    contextDays: z.literal(CONTEXT_DAYS),
    entryDay: z.literal(ENTRY_DAY),
    horizons: z.array(z.number().int().positive()),
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

export type LimitUpPriceHoldStreakPayload = z.infer<
  typeof limitUpPriceHoldStreakSchema
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

export function assembleLimitUpPriceHoldStreak(args: {
  samples: readonly HoldSample[];
  horizons: readonly number[];
  candidateCount: number;
  exactLimitUpCloseCount: number;
  contextCompleteCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const rows: HoldPerformanceRow[] = [];
  for (const horizon of args.horizons) {
    const horizonSamples = args.samples.filter(
      sample => sample.horizon === horizon
    );
    for (const mode of ["CLOSE", "LOW"] as const) {
      for (const streak of STREAK_VALUES) {
        const grouped = horizonSamples.filter(sample =>
          mode === "CLOSE"
            ? sample.closeHoldStreak === streak
            : sample.lowHoldStreak === streak
        );
        const values = grouped.map(sample => sample.grossReturn);
        const bootstrap = movingBlockBootstrapMean({
          samples: grouped.map(sample => ({
            eventDate: sample.eventDate,
            value: sample.grossReturn - ROUND_TRIP_COST_BPS / 10_000,
          })),
          iterations: BOOTSTRAP_ITERATIONS,
          blockLength: BOOTSTRAP_BLOCK_DAYS,
          seed:
            BOOTSTRAP_SEED +
            horizon * 100 +
            (mode === "CLOSE" ? 0 : 50) +
            streak,
        });
        rows.push({
          mode,
          streak,
          horizon,
          eventDateCount: new Set(grouped.map(sample => sample.eventDate)).size,
          ...summarize(values, ROUND_TRIP_COST_BPS),
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
        });
      }
    }
  }

  const hold5Close = rows.find(
    row => row.mode === "CLOSE" && row.streak === 5 && row.horizon === 20
  );
  const zeroLow = rows.find(
    row => row.mode === "LOW" && row.streak === 0 && row.horizon === 20
  );
  const observations: LimitUpPriceHoldStreakPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `严格涨停首板 ${args.exactLimitUpCloseCount} 个；T+1..T+5 路径完整 ` +
        `${args.contextCompleteCount} 个；T+6 不可买 ${args.entryUnfillableCount} 个。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `T+20：收盘连续5日不破涨停价 中位净收益 ${formatPct(hold5Close?.medianNetReturn ?? null)}；` +
        `盘中从未守住 中位 ${formatPct(zeroLow?.medianNetReturn ?? null)}。`,
    },
    {
      kind: "LIMITATION",
      text: "收盘口径要求 close ≥ 首板涨停价；盘中口径要求 low ≥ 首板涨停价。两者刻意分开。",
    },
    {
      kind: "LIMITATION",
      text: "买入固定为 T+6 开盘，T+6 不可买样本不会伪造成交；MFE/MAE 使用持有期高低点。",
    },
  ];

  const customPayload: LimitUpPriceHoldStreakPayload = {
    computationVersion: COMPUTATION_VERSION,
    studyRule: {
      contextDays: CONTEXT_DAYS,
      entryDay: ENTRY_DAY,
      horizons: [...args.horizons],
      costBps: ROUND_TRIP_COST_BPS,
    },
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "T+1..T+5 只用于判断收盘/盘中是否跌破首板涨停价；决策后从 T+6 开盘入场观察后续收益。",
      decisionTimeInformation: ["首板日涨停价", "T+1..T+5 的 close 和 low"],
      postEventResearchOutcome: [
        "T+6 开盘到 T+10/T+20 收盘收益",
        "持有期 MFE/MAE 与日期聚类 Bootstrap",
      ],
      notes: [
        "连续不破定义为从 T+1 开始连续满足条件；一旦打破即停止计数。",
        "收盘口径和盘中最低价口径分别统计。",
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
      "本实验不输出最优 streak 或策略对象。",
      "所有结果属于当前 Dataset 窗口内的探索性证据。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.contextCompleteCount,
      excludedCount: args.candidateCount - args.contextCompleteCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 严格收盘涨停首板，且 T+1..T+5 路径完整。",
        "T+6 不可买只影响交易样本，不影响事件入池账目。",
      ],
    },
    statistics: [
      {
        code: "close_hold5_count",
        label: "收盘连续5日不破",
        value:
          rows.find(
            row =>
              row.mode === "CLOSE" && row.streak === 5 && row.horizon === 10
          )?.sampleCount ?? 0,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "low_hold5_count",
        label: "盘中连续5日不破",
        value:
          rows.find(
            row => row.mode === "LOW" && row.streak === 5 && row.horizon === 10
          )?.sampleCount ?? 0,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "entry_unfillable_count",
        label: "T+6 不可买",
        value: args.entryUnfillableCount,
        unit: "个事件",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "limit_up_hold_streak_matrix",
        title: "首板涨停价守线 streak 与未来收益",
        description:
          "CLOSE 使用收盘价，LOW 使用盘中最低价；streak 为从 T+1 开始连续未跌破首板涨停价的天数。",
        columns: [
          { key: "mode", label: "口径", align: "LEFT" },
          { key: "streak", label: "连续天数", align: "RIGHT" },
          { key: "horizon", label: "退出视界", align: "RIGHT" },
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
        ],
        rows,
      },
    ],
    charts: args.horizons.map(horizon => ({
      key: `hold-streak-median-${horizon}`,
      title: `T+${horizon} · 按守线连续天数`,
      description: "固定 streak 分组，不代表最佳持有条件。",
      kind: "BAR" as const,
      xLabel: "连续不破天数",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `close-${horizon}`,
          label: "收盘口径",
          points: STREAK_VALUES.map(streak => ({
            x: String(streak),
            y:
              rows.find(
                row =>
                  row.mode === "CLOSE" &&
                  row.streak === streak &&
                  row.horizon === horizon
              )?.medianNetReturn ?? null,
          })),
        },
        {
          key: `low-${horizon}`,
          label: "盘中口径",
          points: STREAK_VALUES.map(streak => ({
            x: String(streak),
            y:
              rows.find(
                row =>
                  row.mode === "LOW" &&
                  row.streak === streak &&
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
