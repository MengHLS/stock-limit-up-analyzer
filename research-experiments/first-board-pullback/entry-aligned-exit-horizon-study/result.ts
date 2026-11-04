import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const CONTEXT_DAYS = 5;
export const ENTRY_DAY = 6;
export const MAX_EXIT_DAY = 20;
export const MAX_HOLDING_DAY = MAX_EXIT_DAY - ENTRY_DAY + 1;
export const ROUND_TRIP_COST_BPS = 20;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_922;
export const REACH_THRESHOLDS = [-0.05, -0.02, 0.02, 0.05] as const;

export interface ExitPathPoint {
  targetHoldingDay: number;
  targetRelativeDay: number;
  exitRelativeDay: number;
  grossReturn: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  maxCloseDrawdown: number;
}

export interface ExitPathSample {
  eventId: string;
  eventDate: string;
  year: number;
  points: readonly ExitPathPoint[];
  firstReachByThreshold: Readonly<Record<string, number | null>>;
}

export interface ExitCurveRow {
  [key: string]: string | number | boolean | null;
  holdingDay: number;
  targetEventDay: number;
  sampleCount: number;
  eventDateCount: number;
  meanNetReturn: number | null;
  trimmedMeanNetReturn: number | null;
  medianNetReturn: number | null;
  p5NetReturn: number | null;
  p25NetReturn: number | null;
  p75NetReturn: number | null;
  p95NetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  meanMfe: number | null;
  medianMfe: number | null;
  meanMae: number | null;
  medianMae: number | null;
  meanMaxCloseDrawdown: number | null;
  meanExitDelayDays: number | null;
  sameDayExitRate: number | null;
  reachMinus5Rate: number | null;
  reachMinus2Rate: number | null;
  reachPlus2Rate: number | null;
  reachPlus5Rate: number | null;
}

export const entryAlignedExitHorizonSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  rule: z.object({
    contextDays: z.literal(CONTEXT_DAYS),
    entryDay: z.literal(ENTRY_DAY),
    maxExitDay: z.literal(MAX_EXIT_DAY),
    maxHoldingDay: z.literal(MAX_HOLDING_DAY),
    costBps: z.literal(ROUND_TRIP_COST_BPS),
  }),
  filters: z.object({
    exactLimitUpCloseRequired: z.literal(true),
    excludeOneWordEventDay: z.literal(true),
    excludeAnyLimitTouchInContext: z.literal(true),
    requireCommonForwardPath: z.literal(true),
    executableExitRequired: z.literal(true),
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
    nonOneWordCount: z.number().int().nonnegative(),
    cleanContextCount: z.number().int().nonnegative(),
    pathCompleteCount: z.number().int().nonnegative(),
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

export type EntryAlignedExitHorizonPayload = z.infer<
  typeof entryAlignedExitHorizonSchema
>;

export const EXCLUSION_REASON_LABELS = {
  EVENT_NOT_MAIN_BOARD: "非沪深主板事件",
  MISSING_EVENT_DAY_BAR: "缺少首板日行情",
  INVALID_EVENT_DAY_BAR: "首板日 OHLC / 涨停价缺失或非法",
  EVENT_NOT_EXACT_LIMIT_UP: "首板收盘价不等于交易所涨停价",
  ONE_WORD_LIMIT_UP: "首板日为一字涨停",
  MISSING_CONTEXT_BAR: "T+1..T+5 行情不完整",
  INVALID_CONTEXT_BAR: "T+1..T+5 存在停牌或非法行情",
  HAD_LIMIT_TOUCH_IN_CONTEXT: "T+1..T+5 曾触及涨停价或跌停价",
  ENTRY_UNFILLABLE: "T+6 开盘不可买",
  MISSING_FORWARD_PATH: "T+6..T+20 行情不完整",
  NO_EXECUTABLE_EXIT_BY_MAX_HORIZON: "T+6..T+20 没有可卖收盘点",
} as const;

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

function round(value: number, digits = 10): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function trimmedMean(values: readonly number[], trimFraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const remove = Math.floor(sorted.length * trimFraction);
  const kept = sorted.slice(remove, sorted.length - remove);
  return mean(kept.length > 0 ? kept : sorted);
}

export function assembleEntryAlignedExitHorizon(args: {
  samples: readonly ExitPathSample[];
  candidateCount: number;
  exactLimitUpCloseCount: number;
  nonOneWordCount: number;
  cleanContextCount: number;
  pathCompleteCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
}): ExperimentResultPayload {
  const rows: ExitCurveRow[] = [];

  for (let holdingDay = 1; holdingDay <= MAX_HOLDING_DAY; holdingDay += 1) {
    const points = args.samples.map(
      sample => sample.points[holdingDay - 1]!
    );
    const gross = points.map(point => point.grossReturn);
    const net = gross.map(value => value - ROUND_TRIP_COST_BPS / 10_000);
    const sortedNet = [...net].sort((left, right) => left - right);
    const bootstrap = movingBlockBootstrapMean({
      samples: args.samples.map((sample, index) => ({
        eventDate: sample.eventDate,
        value: net[index]!,
      })),
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BOOTSTRAP_BLOCK_DAYS,
      seed: BOOTSTRAP_SEED + holdingDay,
    });
    const reachRate = (threshold: number): number | null => {
      if (args.samples.length === 0) return null;
      const key = String(threshold);
      return (
        args.samples.filter(sample => {
          const reached = sample.firstReachByThreshold[key];
          return reached !== null && reached !== undefined && reached <= holdingDay;
        }).length / args.samples.length
      );
    };

    rows.push({
      holdingDay,
      targetEventDay: ENTRY_DAY + holdingDay - 1,
      sampleCount: args.samples.length,
      eventDateCount: new Set(args.samples.map(sample => sample.eventDate)).size,
      meanNetReturn: mean(net),
      trimmedMeanNetReturn: trimmedMean(net, 0.05),
      medianNetReturn: quantile(sortedNet, 0.5),
      p5NetReturn: quantile(sortedNet, 0.05),
      p25NetReturn: quantile(sortedNet, 0.25),
      p75NetReturn: quantile(sortedNet, 0.75),
      p95NetReturn: quantile(sortedNet, 0.95),
      winRateNet: net.length === 0 ? null : net.filter(value => value > 0).length / net.length,
      bootstrapCi95Low: bootstrap?.low ?? null,
      bootstrapCi95High: bootstrap?.high ?? null,
      meanMfe: mean(points.map(point => point.maxFavorableExcursion)),
      medianMfe: quantile(
        [...points.map(point => point.maxFavorableExcursion)].sort(
          (left, right) => left - right
        ),
        0.5
      ),
      meanMae: mean(points.map(point => point.maxAdverseExcursion)),
      medianMae: quantile(
        [...points.map(point => point.maxAdverseExcursion)].sort(
          (left, right) => left - right
        ),
        0.5
      ),
      meanMaxCloseDrawdown: mean(points.map(point => point.maxCloseDrawdown)),
      meanExitDelayDays: mean(
        points.map(point => point.exitRelativeDay - point.targetRelativeDay)
      ),
      sameDayExitRate:
        points.length === 0
          ? null
          : points.filter(
              point => point.exitRelativeDay === point.targetRelativeDay
            ).length / points.length,
      reachMinus5Rate: reachRate(-0.05),
      reachMinus2Rate: reachRate(-0.02),
      reachPlus2Rate: reachRate(0.02),
      reachPlus5Rate: reachRate(0.05),
    });
  }

  const rowAtHoldingDay = (holdingDay: number): ExitCurveRow | undefined =>
    rows.find(row => row.holdingDay === holdingDay);
  const t10 = rowAtHoldingDay(5);
  const t20 = rowAtHoldingDay(MAX_HOLDING_DAY);
  const observations: EntryAlignedExitHorizonPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `候选 ${args.candidateCount} 个；严格收盘涨停 ${args.exactLimitUpCloseCount} 个；` +
        `排除一字板后 ${args.nonOneWordCount} 个；T+1..T+5 无涨跌停触达 ${args.cleanContextCount} 个；` +
        `共同样本 ${args.samples.length} 个。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `共同样本下，持有第 5 日（事件 T+10）中位净收益 ` +
        `${formatPct(t10?.medianNetReturn ?? null)}；` +
        `持有第 ${MAX_HOLDING_DAY} 日（事件 T+20）中位净收益 ` +
        `${formatPct(t20?.medianNetReturn ?? null)}。`,
    },
    {
      kind: "LIMITATION",
      text:
        "所有退出曲线使用同一共同样本，避免 T+10 与 T+20 因未来路径完整度不同而改变样本集合。",
    },
    {
      kind: "LIMITATION",
      text:
        "T+10 / T+20 只是持有第 5 / 15 日的参考点，本实验不选择收益最高的退出日。",
    },
  ];

  const customPayload: EntryAlignedExitHorizonPayload = {
    computationVersion: COMPUTATION_VERSION,
    rule: {
      contextDays: CONTEXT_DAYS,
      entryDay: ENTRY_DAY,
      maxExitDay: MAX_EXIT_DAY,
      maxHoldingDay: MAX_HOLDING_DAY,
      costBps: ROUND_TRIP_COST_BPS,
    },
    filters: {
      exactLimitUpCloseRequired: true,
      excludeOneWordEventDay: true,
      excludeAnyLimitTouchInContext: true,
      requireCommonForwardPath: true,
      executableExitRequired: true,
    },
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "T+1..T+5 用于执行用户指定的涨跌停排除条件；T+6 开盘入场后按实际持有日展开退出曲线。",
      decisionTimeInformation: [
        "首板日 OHLC 与涨停价",
        "T+1..T+5 的 high / low 与交易所涨跌停价",
      ],
      postEventResearchOutcome: [
        "T+6 开盘到每个目标持有日可卖收盘的净收益曲线",
        "MFE、MAE、最大收盘回撤和阈值首次到达日",
      ],
      notes: [
        "排除条件在 T+5 收盘后即可确定，T+6 开盘入场不使用入场后的信息做筛选。",
        "持有时长全部从实际入场日 T+6 起算。",
      ],
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      exactLimitUpCloseCount: args.exactLimitUpCloseCount,
      nonOneWordCount: args.nonOneWordCount,
      cleanContextCount: args.cleanContextCount,
      pathCompleteCount: args.pathCompleteCount,
      entryUnfillableCount: args.entryUnfillableCount,
      sampleCount: args.samples.length,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    notes: [
      "一字板定义为首板日 open/high/low/close 都等于涨停价。",
      "T+1..T+5 任一日的 high 触及涨停价或 low 触及跌停价都会被排除。",
      "固定事件日退出被转换为从实际入场日计算的 holdingDay。",
      "结果不输出最佳退出日，也不产出策略结论。",
    ],
  };

  const tableRows = rows.map(row => ({
    ...row,
    meanNetReturn: roundNullable(row.meanNetReturn),
    trimmedMeanNetReturn: roundNullable(row.trimmedMeanNetReturn),
    medianNetReturn: roundNullable(row.medianNetReturn),
    p5NetReturn: roundNullable(row.p5NetReturn),
    p25NetReturn: roundNullable(row.p25NetReturn),
    p75NetReturn: roundNullable(row.p75NetReturn),
    p95NetReturn: roundNullable(row.p95NetReturn),
    winRateNet: roundNullable(row.winRateNet),
    bootstrapCi95Low: roundNullable(row.bootstrapCi95Low),
    bootstrapCi95High: roundNullable(row.bootstrapCi95High),
    meanMfe: roundNullable(row.meanMfe),
    medianMfe: roundNullable(row.medianMfe),
    meanMae: roundNullable(row.meanMae),
    medianMae: roundNullable(row.medianMae),
    meanMaxCloseDrawdown: roundNullable(row.meanMaxCloseDrawdown),
    meanExitDelayDays: roundNullable(row.meanExitDelayDays),
    sameDayExitRate: roundNullable(row.sameDayExitRate),
    reachMinus5Rate: roundNullable(row.reachMinus5Rate),
    reachMinus2Rate: roundNullable(row.reachMinus2Rate),
    reachPlus2Rate: roundNullable(row.reachPlus2Rate),
    reachPlus5Rate: roundNullable(row.reachPlus5Rate),
  }));

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.samples.length,
      excludedCount: args.candidateCount - args.samples.length,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 严格涨停、非一字板、T+1..T+5 未触及涨跌停、T+6 可买且拥有共同未来路径。",
        "所有曲线行使用同一个共同样本，不从较远视界反向补值。",
      ],
    },
    statistics: [
      {
        code: "common_sample_count",
        label: "共同样本",
        value: args.samples.length,
        unit: "个",
        digits: 0,
      },
      {
        code: "t10_median_net_return",
        label: "持有第5日中位净收益",
        value: t10?.medianNetReturn ?? null,
        unit: "比例",
        digits: 6,
      },
      {
        code: "t20_median_net_return",
        label: "持有第15日中位净收益",
        value: t20?.medianNetReturn ?? null,
        unit: "比例",
        digits: 6,
      },
    ],
    tables: [
      {
        key: "entry_aligned_exit_curve",
        title: "实际持有日对齐的退出视界曲线",
        description:
          "holdingDay 从 T+6 入场日起算；退出价使用目标日或其后第一个可卖收盘。",
        columns: [
          { key: "holdingDay", label: "持有日", align: "RIGHT" },
          { key: "targetEventDay", label: "事件相对日", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
          { key: "meanNetReturn", label: "平均净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "trimmedMeanNetReturn", label: "去最高5%后均值", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianNetReturn", label: "中位净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "winRateNet", label: "胜率", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "bootstrapCi95Low", label: "聚类CI95下界", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "bootstrapCi95High", label: "聚类CI95上界", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "p5NetReturn", label: "P5", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "p25NetReturn", label: "P25", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "p75NetReturn", label: "P75", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "p95NetReturn", label: "P95", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanMfe", label: "平均MFE", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanMae", label: "平均MAE", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanMaxCloseDrawdown", label: "平均最大收盘回撤", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanExitDelayDays", label: "平均退出延迟日", align: "RIGHT" },
          { key: "sameDayExitRate", label: "当日可卖率", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "reachMinus5Rate", label: "曾达-5%", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "reachMinus2Rate", label: "曾达-2%", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "reachPlus2Rate", label: "曾达+2%", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "reachPlus5Rate", label: "曾达+5%", unit: "比例", digits: 6, align: "RIGHT" },
        ],
        rows: tableRows,
      },
    ],
    charts: [
      {
        key: "entry-aligned-net-return-curve",
        title: "入场对齐的净收益曲线",
        description:
          "同一共同样本下，从 T+6 开盘入场后逐持有日观察；不选择最佳退出日。",
        kind: "LINE" as const,
        xLabel: "实际持有日",
        yLabel: "净收益",
        unit: "比例",
        series: [
          {
            key: "mean",
            label: "平均",
            points: rows.map(row => ({
              x: `H${row.holdingDay}`,
              y: row.meanNetReturn,
            })),
          },
          {
            key: "median",
            label: "中位",
            points: rows.map(row => ({
              x: `H${row.holdingDay}`,
              y: row.medianNetReturn,
            })),
          },
          {
            key: "p25",
            label: "P25",
            points: rows.map(row => ({
              x: `H${row.holdingDay}`,
              y: row.p25NetReturn,
            })),
          },
          {
            key: "p75",
            label: "P75",
            points: rows.map(row => ({
              x: `H${row.holdingDay}`,
              y: row.p75NetReturn,
            })),
          },
        ],
      },
    ],
    customPayload,
  };
}

function roundNullable(value: number | null): number | null {
  return value === null ? null : round(value);
}

function formatPct(value: number | null): string {
  return value === null ? "无法计算" : `${(value * 100).toFixed(2)}%`;
}
