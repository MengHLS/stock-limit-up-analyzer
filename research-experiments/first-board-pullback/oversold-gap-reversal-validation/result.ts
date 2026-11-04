import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import { movingBlockBootstrapMean } from "../../shared/dateClusterBootstrap";

export const COMPUTATION_VERSION = "1.0.0";
export const PROTOCOL_ID = "oversold-gap-reversal-validation";
export const PROTOCOL_VERSION = "1.0.0";
export const HYPOTHESIS_CODE = "H_OVERSOLD_GAP20_DROP10_T10";

export const GAP_DAYS_THRESHOLD = 20;
export const PRE_RETURN_WINDOW_DAYS = 10;
export const PRE_RETURN_THRESHOLD = -0.1;
export const ENTRY_DAY = 1;
export const PRIMARY_EXIT_DAY = 10;
export const OBSERVATION_HORIZONS = [5, 10, 20] as const;
export const ROUND_TRIP_COST_BPS = 20;
export const BOOTSTRAP_ITERATIONS = 1_000;
export const BOOTSTRAP_BLOCK_DAYS = 20;
export const BOOTSTRAP_SEED = 20_260_922;
export const MIN_SIGNAL_EVENTS = 300;
export const MIN_EXCESS_EVENTS = 300;
export const MIN_EVENT_DATES = 80;
export const TAIL_TRIM_RATIO = 0.05;

export type CohortKind = "SIGNAL" | "ALL_ELIGIBLE";
export type ObservationKind =
  | "DESCRIPTIVE"
  | "COMPARATIVE"
  | "POTENTIAL_SIGNAL"
  | "LIMITATION";

export interface FrozenReturnSample {
  eventId: string;
  eventDate: string;
  year: number;
  isSignal: boolean;
  horizon: number;
  netReturn: number;
}

export interface ExcessReturnSample {
  eventId: string;
  eventDate: string;
  year: number;
  signalNetReturn: number;
  benchmarkNetReturn: number;
  excessNetReturn: number;
  peerCount: number;
}

export interface CohortMetricRow {
  [key: string]: string | number | boolean | null;
  cohort: CohortKind;
  horizon: number;
  sampleCount: number;
  eventDateCount: number;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
  trimmedMeanNetReturn: number | null;
}

export interface ExcessMetricRow {
  [key: string]: string | number | boolean | null;
  metric: string;
  value: number | null;
  threshold: number | null;
  sampleCount: number;
  eventDateCount: number;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
  bootstrapClusterCount: number;
}

export interface GateCheckRow {
  [key: string]: string | number | boolean | null;
  code: string;
  label: string;
  status: "PASS" | "FAIL" | "INSUFFICIENT";
  value: number | null;
  threshold: number | null;
  note: string;
}

export const oversoldGapReversalCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  frozenSpecification: z.object({
    protocolId: z.literal(PROTOCOL_ID),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    hypothesisCode: z.literal(HYPOTHESIS_CODE),
    gapDaysThreshold: z.literal(GAP_DAYS_THRESHOLD),
    preReturnWindowDays: z.literal(PRE_RETURN_WINDOW_DAYS),
    preReturnThreshold: z.literal(PRE_RETURN_THRESHOLD),
    entryDay: z.literal(ENTRY_DAY),
    primaryExitDay: z.literal(PRIMARY_EXIT_DAY),
    costBps: z.literal(ROUND_TRIP_COST_BPS),
    bootstrapIterations: z.literal(BOOTSTRAP_ITERATIONS),
    bootstrapBlockDays: z.literal(BOOTSTRAP_BLOCK_DAYS),
    bootstrapSeed: z.literal(BOOTSTRAP_SEED),
    minimumSignalEvents: z.literal(MIN_SIGNAL_EVENTS),
    minimumExcessEvents: z.literal(MIN_EXCESS_EVENTS),
    minimumEventDates: z.literal(MIN_EVENT_DATES),
    tailTrimRatio: z.literal(TAIL_TRIM_RATIO),
  }),
  informationBoundary: z.object({
    usesForwardData: z.literal(true),
    decisionOffsetDays: z.null(),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    signalCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    duplicateEventIdCount: z.number().int().nonnegative(),
    unscannedEventCount: z.number().int().nonnegative().nullable(),
  }),
  availability: z.object({
    signalPrimarySampleCount: z.number().int().nonnegative(),
    signalPrimaryEventDateCount: z.number().int().nonnegative(),
    excessSampleCount: z.number().int().nonnegative(),
    excessEventDateCount: z.number().int().nonnegative(),
    baselinePrimarySampleCount: z.number().int().nonnegative(),
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
  gateChecks: z.array(
    z.object({
      code: z.string().min(1),
      label: z.string().min(1),
      status: z.enum(["PASS", "FAIL", "INSUFFICIENT"]),
      value: z.number().nullable(),
      threshold: z.number().nullable(),
      note: z.string().min(1),
    })
  ),
  notes: z.array(z.string().min(1)),
});

export type OversoldGapReversalCustomPayload = z.infer<
  typeof oversoldGapReversalCustomPayloadSchema
>;

export const EXCLUSION_REASON_LABELS = {
  NOT_FIRST_LIMIT: "事件不是首板",
  MISSING_OR_INVALID_PRE_WINDOW: "缺少 T-11 / T-1 合法收盘价，无法计算冻结条件",
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

function trimmedMean(
  values: readonly number[],
  trimRatio: number
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimRatio);
  if (trimCount === 0) return mean(sorted);
  const trimmed = sorted.slice(0, sorted.length - trimCount);
  return mean(trimmed);
}

function summarize(values: readonly number[], costBps: number) {
  if (values.length === 0) {
    return {
      sampleCount: 0,
      meanNetReturn: null,
      medianNetReturn: null,
      winRateNet: null,
      trimmedMeanNetReturn: null,
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
    trimmedMeanNetReturn: round(trimmedMean(net, TAIL_TRIM_RATIO)!),
  };
}

function cohortRow(args: {
  cohort: CohortKind;
  horizon: number;
  samples: readonly FrozenReturnSample[];
  costBps: number;
}): CohortMetricRow {
  const values = args.samples.map(sample => sample.netReturn);
  const bootstrap = movingBlockBootstrapMean({
    samples: args.samples.map(sample => ({
      eventDate: sample.eventDate,
      value: sample.netReturn - args.costBps / 10_000,
    })),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_DAYS,
    seed:
      BOOTSTRAP_SEED + args.horizon * 10 + (args.cohort === "SIGNAL" ? 1 : 2),
  });
  return {
    cohort: args.cohort,
    horizon: args.horizon,
    eventDateCount: new Set(args.samples.map(sample => sample.eventDate)).size,
    ...summarize(values, args.costBps),
    bootstrapCi95Low: bootstrap?.low ?? null,
    bootstrapCi95High: bootstrap?.high ?? null,
    bootstrapClusterCount: bootstrap?.clusterCount ?? 0,
  };
}

function buildExcessSamples(
  samples: readonly FrozenReturnSample[]
): ExcessReturnSample[] {
  const primary = samples.filter(sample => sample.horizon === PRIMARY_EXIT_DAY);
  const byDate = new Map<string, FrozenReturnSample[]>();
  for (const sample of primary) {
    const values = byDate.get(sample.eventDate) ?? [];
    values.push(sample);
    byDate.set(sample.eventDate, values);
  }

  const excess: ExcessReturnSample[] = [];
  for (const signal of primary.filter(sample => sample.isSignal)) {
    const peers = (byDate.get(signal.eventDate) ?? []).filter(
      sample => sample.eventId !== signal.eventId
    );
    if (peers.length === 0) continue;
    const benchmarkNetReturn = mean(peers.map(sample => sample.netReturn));
    if (benchmarkNetReturn === null) continue;
    excess.push({
      eventId: signal.eventId,
      eventDate: signal.eventDate,
      year: signal.year,
      signalNetReturn: signal.netReturn,
      benchmarkNetReturn,
      excessNetReturn: signal.netReturn - benchmarkNetReturn,
      peerCount: peers.length,
    });
  }
  return excess;
}

function gateChecks(args: {
  phase: "EXPLORATORY" | "OBSERVATION" | "HOLDOUT";
  signalPrimary: readonly FrozenReturnSample[];
  excess: readonly ExcessReturnSample[];
  primaryRow: CohortMetricRow;
  excessMean: number | null;
  excessBootstrapLow: number | null;
}): {
  status: "OBSERVATION_READY" | "PASS" | "FAIL" | "INSUFFICIENT";
  checks: GateCheckRow[];
} {
  const signalCount = args.signalPrimary.length;
  const signalDateCount = new Set(
    args.signalPrimary.map(sample => sample.eventDate)
  ).size;
  const excessCount = args.excess.length;
  const baseChecks: GateCheckRow[] = [
    {
      code: "signal_primary_sample_count",
      label: "主视界有效信号事件数",
      status: signalCount >= MIN_SIGNAL_EVENTS ? "PASS" : "INSUFFICIENT",
      value: signalCount,
      threshold: MIN_SIGNAL_EVENTS,
      note: `要求至少 ${MIN_SIGNAL_EVENTS}`,
    },
    {
      code: "signal_event_date_count",
      label: "信号事件交易日数",
      status: signalDateCount >= MIN_EVENT_DATES ? "PASS" : "INSUFFICIENT",
      value: signalDateCount,
      threshold: MIN_EVENT_DATES,
      note: `要求至少 ${MIN_EVENT_DATES}`,
    },
    {
      code: "excess_sample_count",
      label: "同日基准可比事件数",
      status: excessCount >= MIN_EXCESS_EVENTS ? "PASS" : "INSUFFICIENT",
      value: excessCount,
      threshold: MIN_EXCESS_EVENTS,
      note: `要求至少 ${MIN_EXCESS_EVENTS}，且同日至少有一条非自身基准样本`,
    },
  ];

  if (args.phase !== "HOLDOUT") {
    const allReady = baseChecks.every(check => check.status === "PASS");
    return {
      status: allReady ? "OBSERVATION_READY" : "INSUFFICIENT",
      checks: baseChecks,
    };
  }

  if (baseChecks.some(check => check.status !== "PASS")) {
    return { status: "INSUFFICIENT", checks: baseChecks };
  }

  const outcomeChecks: GateCheckRow[] = [
    {
      code: "mean_net_return_positive",
      label: "T+10 平均净收益大于 0",
      status:
        (args.primaryRow.meanNetReturn ?? -Infinity) > 0 ? "PASS" : "FAIL",
      value: args.primaryRow.meanNetReturn,
      threshold: 0,
      note: "主指标",
    },
    {
      code: "median_net_return_positive",
      label: "T+10 中位净收益大于 0",
      status:
        (args.primaryRow.medianNetReturn ?? -Infinity) > 0 ? "PASS" : "FAIL",
      value: args.primaryRow.medianNetReturn,
      threshold: 0,
      note: "避免仅由均值尾部驱动",
    },
    {
      code: "win_rate_above_half",
      label: "T+10 净收益胜率大于 50%",
      status: (args.primaryRow.winRateNet ?? -Infinity) > 0.5 ? "PASS" : "FAIL",
      value: args.primaryRow.winRateNet,
      threshold: 0.5,
      note: "事件级胜率",
    },
    {
      code: "cluster_bootstrap_low_positive",
      label: "T+10 日期聚类 Bootstrap 下界大于 0",
      status:
        (args.primaryRow.bootstrapCi95Low ?? -Infinity) > 0 ? "PASS" : "FAIL",
      value: args.primaryRow.bootstrapCi95Low,
      threshold: 0,
      note: `${BOOTSTRAP_ITERATIONS} 次，block=${BOOTSTRAP_BLOCK_DAYS} 日`,
    },
    {
      code: "excess_mean_positive",
      label: "同日首板基准超额收益大于 0",
      status: (args.excessMean ?? -Infinity) > 0 ? "PASS" : "FAIL",
      value: args.excessMean,
      threshold: 0,
      note: "剔除同日市场整体涨跌影响",
    },
    {
      code: "excess_bootstrap_low_positive",
      label: "超额收益日期聚类 Bootstrap 下界大于 0",
      status: (args.excessBootstrapLow ?? -Infinity) > 0 ? "PASS" : "FAIL",
      value: args.excessBootstrapLow,
      threshold: 0,
      note: "按事件日聚类",
    },
    {
      code: "tail_trimmed_mean_positive",
      label: `去掉最高 ${TAIL_TRIM_RATIO * 100}% 收益后平均仍大于 0`,
      status:
        (args.primaryRow.trimmedMeanNetReturn ?? -Infinity) > 0
          ? "PASS"
          : "FAIL",
      value: args.primaryRow.trimmedMeanNetReturn,
      threshold: 0,
      note: "尾部依赖检查",
    },
  ];
  const checks = [...baseChecks, ...outcomeChecks];
  return {
    status: checks.every(check => check.status === "PASS") ? "PASS" : "FAIL",
    checks,
  };
}

export function assembleOversoldGapReversalResult(args: {
  phase: "EXPLORATORY" | "OBSERVATION" | "HOLDOUT";
  protocolFingerprint: string | null;
  candidateCount: number;
  eligibleCount: number;
  signalCount: number;
  entryUnfillableCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
  samples: readonly FrozenReturnSample[];
}): ExperimentResultPayload {
  const signalSamples = args.samples.filter(sample => sample.isSignal);
  const baselineSamples = args.samples;
  const cohortRows: CohortMetricRow[] = [];
  for (const horizon of OBSERVATION_HORIZONS) {
    cohortRows.push(
      cohortRow({
        cohort: "SIGNAL",
        horizon,
        samples: signalSamples.filter(sample => sample.horizon === horizon),
        costBps: ROUND_TRIP_COST_BPS,
      }),
      cohortRow({
        cohort: "ALL_ELIGIBLE",
        horizon,
        samples: baselineSamples.filter(sample => sample.horizon === horizon),
        costBps: ROUND_TRIP_COST_BPS,
      })
    );
  }

  const primaryRow = cohortRows.find(
    row => row.cohort === "SIGNAL" && row.horizon === PRIMARY_EXIT_DAY
  )!;
  const excess = buildExcessSamples(args.samples);
  const excessValues = excess.map(sample => sample.excessNetReturn);
  const excessMean = mean(excessValues);
  const excessBootstrap = movingBlockBootstrapMean({
    samples: excess.map(sample => ({
      eventDate: sample.eventDate,
      value: sample.excessNetReturn,
    })),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BOOTSTRAP_BLOCK_DAYS,
    seed: BOOTSTRAP_SEED + 9_001,
  });
  const excessRow: ExcessMetricRow = {
    metric: "同日首板基准超额净收益",
    value: excessMean === null ? null : round(excessMean),
    threshold: 0,
    sampleCount: excessValues.length,
    eventDateCount: new Set(excess.map(sample => sample.eventDate)).size,
    bootstrapCi95Low: excessBootstrap?.low ?? null,
    bootstrapCi95High: excessBootstrap?.high ?? null,
    bootstrapClusterCount: excessBootstrap?.clusterCount ?? 0,
  };
  const signalPrimary = signalSamples.filter(
    sample => sample.horizon === PRIMARY_EXIT_DAY
  );
  const gate = gateChecks({
    phase: args.phase,
    signalPrimary,
    excess,
    primaryRow,
    excessMean,
    excessBootstrapLow: excessBootstrap?.low ?? null,
  });

  const checksRows: GateCheckRow[] = gate.checks;
  const observations: OversoldGapReversalCustomPayload["observations"] = [
    {
      kind: "DESCRIPTIVE",
      text:
        `候选事件 ${args.candidateCount} 个，eligible ${args.eligibleCount} 个；` +
        `满足冻结条件 ${args.signalCount} 个；` +
        `T+${PRIMARY_EXIT_DAY} 有效信号样本 ${signalPrimary.length} 个。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `T+${PRIMARY_EXIT_DAY} 信号组平均净收益 ${percent(primaryRow.meanNetReturn)}，` +
        `中位 ${percent(primaryRow.medianNetReturn)}，胜率 ${percent(primaryRow.winRateNet)}；` +
        `同日首板超额平均 ${percent(excessRow.value)}。`,
    },
    {
      kind: "LIMITATION",
      text: "基准为同一事件日、至少一条非自身且具有相同 T+1 开盘入场 / T+10 收盘退出数据的首板事件均值。",
    },
    {
      kind: "LIMITATION",
      text: `成本固定 ${ROUND_TRIP_COST_BPS} bps；未实现盘口排队、滑点、部分成交和公司行为处理。`,
    },
    {
      kind: "LIMITATION",
      text: "冻结后不得修改条件、窗口或通过阈值；Observation 未通过只能补数据，Holdout 失败则终止该候选。",
    },
  ];

  const customPayload: OversoldGapReversalCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    frozenSpecification: {
      protocolId: PROTOCOL_ID,
      protocolVersion: PROTOCOL_VERSION,
      hypothesisCode: HYPOTHESIS_CODE,
      gapDaysThreshold: GAP_DAYS_THRESHOLD,
      preReturnWindowDays: PRE_RETURN_WINDOW_DAYS,
      preReturnThreshold: PRE_RETURN_THRESHOLD,
      entryDay: ENTRY_DAY,
      primaryExitDay: PRIMARY_EXIT_DAY,
      costBps: ROUND_TRIP_COST_BPS,
      bootstrapIterations: BOOTSTRAP_ITERATIONS,
      bootstrapBlockDays: BOOTSTRAP_BLOCK_DAYS,
      bootstrapSeed: BOOTSTRAP_SEED,
      minimumSignalEvents: MIN_SIGNAL_EVENTS,
      minimumExcessEvents: MIN_EXCESS_EVENTS,
      minimumEventDates: MIN_EVENT_DATES,
      tailTrimRatio: TAIL_TRIM_RATIO,
    },
    informationBoundary: {
      usesForwardData: true,
      decisionOffsetDays: null,
      forwardDataPurpose:
        "冻结条件只使用 T-11/T-1 收盘和事件日前涨停间隔；T+1 开盘入场后观察 T+5/T+10/T+20 收益。",
      decisionTimeInformation: [
        "T 日首板事件事实",
        "daysSincePreviousLimit",
        "close(T-11) 与 close(T-1)",
      ],
      postEventResearchOutcome: [
        "T+1 开盘可买性",
        "T+5/T+10/T+20 收盘收益与日期聚类 Bootstrap",
        "相对同日 eligible 首板基准的超额收益",
      ],
      notes: [
        "样本资格不使用 T 日之后的价格，但结论依赖 T+1 开盘后的执行数据。",
        "评估窗口由 Research Protocol 下推到事件扫描层，不手工裁事件。",
      ],
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      signalCount: args.signalCount,
      entryUnfillableCount: args.entryUnfillableCount,
      duplicateEventIdCount: args.duplicateEventIdCount,
      unscannedEventCount: args.unscannedEventCount,
    },
    availability: {
      signalPrimarySampleCount: signalPrimary.length,
      signalPrimaryEventDateCount: new Set(
        signalPrimary.map(sample => sample.eventDate)
      ).size,
      excessSampleCount: excess.length,
      excessEventDateCount: new Set(excess.map(sample => sample.eventDate))
        .size,
      baselinePrimarySampleCount: baselineSamples.filter(
        sample => sample.horizon === PRIMARY_EXIT_DAY
      ).length,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    gateChecks: checksRows,
    notes: [
      "本实验不包含参数网格，不输出最优阈值或策略对象。",
      "Holdout 每个协议指纹只能运行一次。",
      "只有 HOLDOUT / PASS 才可作为正式策略证据。",
    ],
  };

  const payload: ExperimentResultPayload = {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = T 日首板且 T-11/T-1 收盘可读；未满足冻结条件的事件仍作为同日基准候选。",
        `signal = daysSincePreviousLimit > ${GAP_DAYS_THRESHOLD} 且 close(T-1)/close(T-11)-1 < ${PRE_RETURN_THRESHOLD * 100}%。`,
      ],
    },
    statistics: [
      {
        code: "signal_count",
        label: "满足冻结条件的事件",
        value: args.signalCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "signal_primary_sample_count",
        label: "T+10 有效信号样本",
        value: signalPrimary.length,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "excess_sample_count",
        label: "同日基准可比信号样本",
        value: excess.length,
        unit: "个事件",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "frozen_cohort_returns",
        title: "冻结信号与全 eligible 首板收益",
        description:
          "收益从 T+1 开盘起算，扣除固定往返成本；Bootstrap 按事件交易日聚类。",
        columns: [
          { key: "cohort", label: "分组", align: "LEFT" },
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
          {
            key: "trimmedMeanNetReturn",
            label: "去最高 5% 平均",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
        ],
        rows: cohortRows,
      },
      {
        key: "same_date_excess",
        title: "同日首板基准超额收益",
        description:
          "每个信号事件减去同日除自身外 eligible 首板的平均 T+1 开盘到 T+10 收盘净收益。",
        columns: [
          { key: "metric", label: "指标", align: "LEFT" },
          {
            key: "value",
            label: "值",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "eventDateCount", label: "事件日数", align: "RIGHT" },
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
        rows: [excessRow],
      },
      {
        key: "confirmatory_gate_checks",
        title: "冻结判定",
        description: "Observation 只检查样本准备；Holdout 按全部预设条件判定。",
        columns: [
          { key: "code", label: "检查", align: "LEFT" },
          { key: "status", label: "状态", align: "LEFT" },
          { key: "value", label: "值", digits: 6, align: "RIGHT" },
          { key: "threshold", label: "阈值", digits: 6, align: "RIGHT" },
          { key: "note", label: "说明", align: "LEFT" },
        ],
        rows: checksRows,
      },
    ],
    charts: [
      {
        key: "primary-net-return-comparison",
        title: "T+10 平均净收益：信号 vs 全 eligible",
        description: "只有一个冻结信号和一个全样本基准，不比较其他分组。",
        kind: "BAR" as const,
        xLabel: "分组",
        yLabel: "平均净收益",
        unit: "比例",
        series: [
          {
            key: "t10-mean-net",
            label: "T+10",
            points: cohortRows
              .filter(row => row.horizon === PRIMARY_EXIT_DAY)
              .map(row => ({
                x: row.cohort === "SIGNAL" ? "冻结信号" : "全 eligible",
                y: row.meanNetReturn,
              })),
          },
        ],
      },
    ],
    ...(args.phase === "EXPLORATORY"
      ? {}
      : {
          confirmatoryGate: {
            status: gate.status,
            protocolFingerprint: args.protocolFingerprint!,
            sampleCount: signalPrimary.length,
            checks: checksRows.map(row => ({
              code: row.code,
              label: row.label,
              status: row.status,
              value: row.value,
              threshold: row.threshold,
              note: row.note,
            })),
            summary:
              gate.status === "OBSERVATION_READY"
                ? "Observation 样本和数据准备完成，可以进入 Holdout。"
                : gate.status === "PASS"
                  ? "Holdout 全部冻结条件通过。"
                  : gate.status === "FAIL"
                    ? "Holdout 样本充足，但至少一项冻结条件未通过。"
                    : "当前窗口样本或可比基准不足，不能作出确认性判定。",
          },
        }),
    customPayload,
  };
  return payload;
}

function percent(value: number | null): string {
  return value === null ? "无法计算" : `${(value * 100).toFixed(2)}%`;
}
