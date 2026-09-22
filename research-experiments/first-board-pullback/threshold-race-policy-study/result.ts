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

export const RACE_THRESHOLDS = [0.02, 0.05] as const;
export const RACE_POLICIES = [
  "HOLD_T10",
  "NEG2_STOP",
  "POS2_TAKE",
  "SYM2",
  "NEG5_STOP",
  "POS5_TAKE",
  "SYM5",
] as const;
export type RacePolicy = (typeof RACE_POLICIES)[number];
export type RacePair = "RACE_2PCT" | "RACE_5PCT";
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export const POLICY_LABELS: Readonly<Record<RacePolicy, string>> =
  Object.freeze({
    HOLD_T10: "持有到 T+10",
    NEG2_STOP: "-2%先到则止损",
    POS2_TAKE: "+2%先到则止盈",
    SYM2: "先触及 ±2% 则退出",
    NEG5_STOP: "-5%先到则止损",
    POS5_TAKE: "+5%先到则止盈",
    SYM5: "先触及 ±5% 则退出",
  });

export interface PolicySample {
  eventId: string;
  eventDate: string;
  year: number;
  entryDay: number;
  grossReturns: Readonly<Record<RacePolicy, number>>;
  holdingDays: Readonly<Record<RacePolicy, number>>;
  race2: "POS_FIRST" | "NEG_FIRST" | "NONE";
  race5: "POS_FIRST" | "NEG_FIRST" | "NONE";
}

export interface PolicyPerformanceRow {
  [key: string]: string | number | boolean | null;
  policy: RacePolicy;
  policyLabel: string;
  entryDay: number;
  sampleCount: number;
  eventDateCount: number;
  meanHoldingDays: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
}

export interface RaceCountRow {
  [key: string]: string | number | boolean | null;
  pair: RacePair;
  entryDay: number;
  sampleCount: number;
  positiveFirstCount: number;
  negativeFirstCount: number;
  neitherCount: number;
  positiveFirstRate: number | null;
  negativeFirstRate: number | null;
  neitherRate: number | null;
}

export interface ComparisonRow {
  [key: string]: string | number | boolean | null;
  policy: RacePolicy;
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

export const thresholdRacePolicySchema = z.object({
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

export type ThresholdRacePolicyPayload = z.infer<
  typeof thresholdRacePolicySchema
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

export function assembleThresholdRacePolicyResult(args: {
  samples: readonly PolicySample[];
  candidateCount: number;
  exactLimitUpCloseCount: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const performanceRows: PolicyPerformanceRow[] = [];
  for (let entryDay = 2; entryDay <= 6; entryDay += 1) {
    const entrySamples = args.samples.filter(
      sample => sample.entryDay === entryDay
    );
    for (const policy of RACE_POLICIES) {
      const returns = entrySamples.map(sample => sample.grossReturns[policy]);
      const bootstrap = movingBlockBootstrapMean({
        samples: entrySamples.map(sample => ({
          eventDate: sample.eventDate,
          value: sample.grossReturns[policy] - ROUND_TRIP_COST_BPS / 10_000,
        })),
        iterations: BOOTSTRAP_ITERATIONS,
        blockLength: BOOTSTRAP_BLOCK_DAYS,
        seed: BOOTSTRAP_SEED + entryDay * 100 + RACE_POLICIES.indexOf(policy),
      });
      performanceRows.push({
        policy,
        policyLabel: POLICY_LABELS[policy],
        entryDay,
        eventDateCount: new Set(entrySamples.map(sample => sample.eventDate))
          .size,
        meanHoldingDays: mean(
          entrySamples.map(sample => sample.holdingDays[policy])
        ),
        ...summarize(returns, ROUND_TRIP_COST_BPS),
        bootstrapCi95Low: bootstrap?.low ?? null,
        bootstrapCi95High: bootstrap?.high ?? null,
        bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
      });
    }
  }

  const raceRows: RaceCountRow[] = [];
  for (let entryDay = 2; entryDay <= 6; entryDay += 1) {
    const entrySamples = args.samples.filter(
      sample => sample.entryDay === entryDay
    );
    for (const pair of ["RACE_2PCT", "RACE_5PCT"] as const) {
      const values = entrySamples.map(sample =>
        pair === "RACE_2PCT" ? sample.race2 : sample.race5
      );
      const positive = values.filter(value => value === "POS_FIRST").length;
      const negative = values.filter(value => value === "NEG_FIRST").length;
      const neither = values.filter(value => value === "NONE").length;
      raceRows.push({
        pair,
        entryDay,
        sampleCount: values.length,
        positiveFirstCount: positive,
        negativeFirstCount: negative,
        neitherCount: neither,
        positiveFirstRate:
          values.length === 0 ? null : positive / values.length,
        negativeFirstRate:
          values.length === 0 ? null : negative / values.length,
        neitherRate: values.length === 0 ? null : neither / values.length,
      });
    }
  }

  const comparisons: ComparisonRow[] = [];
  for (const policy of RACE_POLICIES.filter(item => item !== "HOLD_T10")) {
    const differences = args.samples.map(sample => ({
      eventDate: sample.eventDate,
      value: sample.grossReturns[policy] - sample.grossReturns.HOLD_T10,
    }));
    const bootstrap = movingBlockBootstrapMean({
      samples: differences,
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BOOTSTRAP_BLOCK_DAYS,
      seed: BOOTSTRAP_SEED + 9_000 + RACE_POLICIES.indexOf(policy),
    });
    comparisons.push({
      policy,
      comparison: `${POLICY_LABELS[policy]} − 持有到 T+10`,
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
    });
  }

  const t6 = performanceRows.filter(row => row.entryDay === 6);
  const bestByMedian = [...t6].sort(
    (a, b) =>
      (b.medianNetReturn ?? -Infinity) - (a.medianNetReturn ?? -Infinity)
  )[0];
  const observations: ThresholdRacePolicyPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `严格收盘涨停首板 ${args.exactLimitUpCloseCount} 个；触发动态入场 ${args.triggeredCount} 个；` +
        `有效动态交易 ${args.samples.length} 条。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `T+6 入场组中，中位净收益最高的规则是 ${bestByMedian?.policyLabel ?? "无法计算"}：` +
        `平均 ${formatPct(bestByMedian?.meanNetReturn ?? null)}，` +
        `中位 ${formatPct(bestByMedian?.medianNetReturn ?? null)}，` +
        `胜率 ${formatPct(bestByMedian?.winRateNet ?? null)}。`,
    },
    {
      kind: "LIMITATION",
      text: "阈值竞争以收盘确认，退出在下一可卖开盘执行；日线无法模拟真实盘中止损或止盈成交。",
    },
    {
      kind: "LIMITATION",
      text: "所有阈值规则均在相同事件集上配对比较，未因为结果调整入场条件。",
    },
  ];

  const customPayload: ThresholdRacePolicyPayload = {
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
        "在固定动态入场后，比较首次收盘触及 ±2%/±5% 后的止损、止盈和持有规则。",
      decisionTimeInformation: ["T+1..T+5 回撤路径", "首板开盘价"],
      postEventResearchOutcome: [
        "首次触及 ±2%/±5% 正负方向的竞争概率",
        "止损、止盈、对称退出与持有 T+10 的配对差异",
      ],
      notes: [
        "阈值按收盘确认，下一可卖开盘执行。",
        "所有规则共用相同的动态入场事件。",
      ],
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
      "本实验不选择最优阈值，只比较预先固定的规则。",
      "结果属于探索性研究，不能替代独立 Holdout。",
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
        "止盈止损按收盘确认，下一可卖开盘执行。",
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
        code: "t6_best_policy_median",
        label: "T+6 最优规则中位净收益",
        value: bestByMedian?.medianNetReturn ?? null,
        unit: "比例",
        digits: 6,
      },
    ],
    tables: [
      {
        key: "threshold_race_performance",
        title: "阈值竞争规则收益",
        description:
          "每行是同一入场日内固定规则的实现收益；阈值以收盘确认，下一可卖开盘退出。",
        columns: [
          { key: "entryDay", label: "入场日", align: "RIGHT" },
          { key: "policyLabel", label: "规则", align: "LEFT" },
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
        ],
        rows: performanceRows,
      },
      {
        key: "threshold_race_counts",
        title: "首次触及方向",
        description:
          "统计每笔动态交易在持有路径内首次收盘触及正阈值、负阈值或均未触及。",
        columns: [
          { key: "entryDay", label: "入场日", align: "RIGHT" },
          { key: "pair", label: "竞争阈值", align: "LEFT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "positiveFirstCount", label: "正先到", align: "RIGHT" },
          { key: "negativeFirstCount", label: "负先到", align: "RIGHT" },
          { key: "neitherCount", label: "均未触及", align: "RIGHT" },
          {
            key: "positiveFirstRate",
            label: "正先到率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "negativeFirstRate",
            label: "负先到率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
        ],
        rows: raceRows,
      },
      {
        key: "threshold_race_comparisons",
        title: "相对持有 T+10 的配对差异",
        description: "同一事件上比较规则收益差。",
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
        ],
        rows: comparisons,
      },
    ],
    charts: [
      {
        key: "threshold-race-median",
        title: "各规则中位净收益",
        description: "按入场日拆分；不选择最优规则。",
        kind: "BAR" as const,
        xLabel: "规则",
        yLabel: "中位净收益",
        unit: "比例",
        series: [2, 3, 4, 5, 6].map(entryDay => ({
          key: `entry-${entryDay}`,
          label: `T+${entryDay}`,
          points: RACE_POLICIES.map(policy => ({
            x: POLICY_LABELS[policy],
            y:
              performanceRows.find(
                row => row.entryDay === entryDay && row.policy === policy
              )?.medianNetReturn ?? null,
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
