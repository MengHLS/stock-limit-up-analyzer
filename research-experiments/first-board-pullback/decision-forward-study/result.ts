/**
 * 首板后回踩决策时点后续收益研究 · 结果结构与组装。
 *
 * 研究问题：
 *   - 在 T+k 收盘时，仅使用 T+1…T+k 已可见路径，把样本分成「未破首板日开盘价」
 *     与「已破首板日开盘价」；
 *   - 此后从 T+k 收盘到 T+h 收盘的收益是否仍存在可观察差异；
 *   - 回撤深度分桶与后续收益之间是否存在稳定梯度；
 *   - 使用统一往返成本参数给出净收益敏感性，而不是把毛收益当可交易收益。
 *
 * 本实验刻意不产出最佳决策日、最佳视界、最优阈值或策略对象。
 */

import { z } from "zod";
import type {
  ExperimentConfirmatoryGate,
  ExperimentProtocolContext,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";

export const COMPUTATION_VERSION = "1.0.0";
export const MAX_DECISION_DAY = 5;
export const MAX_FORWARD_HORIZON = 20;

export const FORWARD_GROUPS = [
  "ALL",
  "NON_BREAK_OPEN",
  "BREAK_OPEN",
  "NO_PULLBACK",
  "DD_200BP",
  "DD_500BP",
  "DD_800BP",
  "DD_1000BP",
  "DD_BELOW_1000BP",
] as const;

export type ForwardGroupCode = (typeof FORWARD_GROUPS)[number];

export const FORWARD_GROUP_LABELS: Readonly<Record<ForwardGroupCode, string>> = Object.freeze({
  ALL: "全部样本",
  NON_BREAK_OPEN: "截至决策日始终未跌破首板日开盘价",
  BREAK_OPEN: "截至决策日曾跌破首板日开盘价",
  NO_PULLBACK: "未回踩（累计最低价 ≥ 首板日收盘价）",
  DD_200BP: "回撤 -2% 至 0%",
  DD_500BP: "回撤 -5% 至 -2%",
  DD_800BP: "回撤 -8% 至 -5%",
  DD_1000BP: "回撤 -10% 至 -8%",
  DD_BELOW_1000BP: "回撤低于 -10%",
});

export const EXCLUSION_REASON_LABELS = {
  MAX_EVENTS_LIMIT: "超出 maxEvents 上限（本次未纳入统计）",
  MISSING_EVENT_DAY_BAR: "缺少首板日（rd=0）行情",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC 缺失、非正或自相矛盾",
  MISSING_DECISION_PATH_BAR: `决策路径 rd=1..${MAX_DECISION_DAY} 存在行情缺口`,
  INVALID_DECISION_PATH_OHLC: `决策路径 rd=1..${MAX_DECISION_DAY} 存在非法 OHLC`,
} as const;

export type ExclusionReasonCode = keyof typeof EXCLUSION_REASON_LABELS;

export type ObservationKind = "DESCRIPTIVE" | "COMPARATIVE" | "POTENTIAL_SIGNAL" | "LIMITATION";

export interface ForwardSample {
  eventId: string;
  year: number;
  decisionDay: number;
  horizon: number;
  groups: readonly ForwardGroupCode[];
  grossReturn: number | null;
}

export interface DecisionForwardMatrixRow {
  [key: string]: string | number | boolean | null;
  decisionDay: number;
  horizon: number;
  group: ForwardGroupCode;
  groupLabel: string;
  sampleCount: number;
  availableCount: number;
  meanGrossReturn: number | null;
  medianGrossReturn: number | null;
  p25GrossReturn: number | null;
  p75GrossReturn: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  meanNetCi95Low: number | null;
  meanNetCi95High: number | null;
}

export interface ForwardComparisonRow {
  [key: string]: string | number | boolean | null;
  decisionDay: number;
  horizon: number;
  metric: string;
  nonBreakValue: number | null;
  breakValue: number | null;
  deltaBreakMinusNonBreak: number | null;
  nonBreakCount: number;
  breakCount: number;
}

export interface AnnualForwardRow {
  [key: string]: string | number | boolean | null;
  year: number;
  decisionDay: number;
  horizon: number;
  group: ForwardGroupCode;
  groupLabel: string;
  sampleCount: number;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
}

const observationSchema = z.object({
  kind: z.enum(["DESCRIPTIVE", "COMPARATIVE", "POTENTIAL_SIGNAL", "LIMITATION"]),
  text: z.string().min(1),
});

const hypothesisSchema = z.object({
  code: z.string().min(1),
  statement: z.string().min(1),
  rationale: z.string().min(1),
});

export const decisionForwardCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  informationBoundary: z.object({
    decisionOffsetDays: z.literal(MAX_DECISION_DAY),
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    scannedRowCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    droppedByMaxEvents: z.number().int().nonnegative(),
    droppedByScanLimit: z.boolean(),
    unscannedEventCount: z.number().int().nonnegative().nullable(),
    eventScanPolicy: z.string().min(1),
    scanLimit: z.number().int().positive(),
    duplicateEventIdCount: z.number().int().nonnegative(),
  }),
  dataQuality: z.object({
    eventDayBarRowsRead: z.number().int().nonnegative(),
    observationBarRowsRead: z.number().int().nonnegative(),
    missingEventDayBarCount: z.number().int().nonnegative(),
    invalidEventDayCount: z.number().int().nonnegative(),
    missingDecisionPathEventCount: z.number().int().nonnegative(),
    invalidDecisionPathEventCount: z.number().int().nonnegative(),
    invalidDecisionPathBarCount: z.number().int().nonnegative(),
  }),
  summary: z.object({
    coreSampleCount: z.number().int().nonnegative(),
    decisionDayCount: z.number().int().nonnegative(),
    horizonCount: z.number().int().nonnegative(),
    completeCellCount: z.number().int().nonnegative(),
    positiveAllMeanNetCellCount: z.number().int().nonnegative(),
    nonBreakMinusBreakPositiveCellCount: z.number().int().nonnegative(),
    nonBreakMinusBreakNegativeCellCount: z.number().int().nonnegative(),
  }),
  costBps: z.number().nonnegative(),
  exclusionReasonLabels: z.record(z.string(), z.string()),
  groupLabels: z.record(z.string(), z.string()),
  observations: z.array(observationSchema),
  hypotheses: z.array(hypothesisSchema),
  notes: z.array(z.string().min(1)),
});

export type DecisionForwardCustomPayload = z.infer<typeof decisionForwardCustomPayloadSchema>;

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

function summarizeReturns(values: readonly number[], costBps: number): {
  availableCount: number;
  meanGrossReturn: number | null;
  medianGrossReturn: number | null;
  p25GrossReturn: number | null;
  p75GrossReturn: number | null;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
  meanNetCi95Low: number | null;
  meanNetCi95High: number | null;
} {
  if (values.length === 0) {
    return {
      availableCount: 0,
      meanGrossReturn: null,
      medianGrossReturn: null,
      p25GrossReturn: null,
      p75GrossReturn: null,
      meanNetReturn: null,
      medianNetReturn: null,
      winRateNet: null,
      meanNetCi95Low: null,
      meanNetCi95High: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const net = values.map((value) => value - costBps / 10_000);
  const netMean = mean(net);
  const netCi = ci95(net);
  return {
    availableCount: values.length,
    meanGrossReturn: round(mean(values)!),
    medianGrossReturn: round(quantile(sorted, 0.5)!),
    p25GrossReturn: round(quantile(sorted, 0.25)!),
    p75GrossReturn: round(quantile(sorted, 0.75)!),
    meanNetReturn: netMean === null ? null : round(netMean),
    medianNetReturn: round(quantile([...net].sort((a, b) => a - b), 0.5)!),
    winRateNet: round(net.filter((value) => value > 0).length / net.length),
    meanNetCi95Low: netCi === null ? null : round(netCi.low),
    meanNetCi95High: netCi === null ? null : round(netCi.high),
  };
}

function groupSamples(
  samples: readonly ForwardSample[],
  decisionDay: number,
  horizon: number,
  group: ForwardGroupCode,
): ForwardSample[] {
  return samples.filter(
    (sample) =>
      sample.decisionDay === decisionDay &&
      sample.horizon === horizon &&
      sample.groups.includes(group),
  );
}

export function assembleDecisionForwardResult(args: {
  decisionDays: readonly number[];
  forwardHorizons: readonly number[];
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
  eventScanPolicy: string;
  scanLimit: number;
  duplicateEventIdCount: number;
  eventDayBarRowsRead: number;
  observationBarRowsRead: number;
  missingEventDayBarCount: number;
  invalidEventDayCount: number;
  missingDecisionPathEventCount: number;
  invalidDecisionPathEventCount: number;
  invalidDecisionPathBarCount: number;
  protocol: ExperimentProtocolContext | null;
}): ExperimentResultPayload {
  const {
    decisionDays,
    forwardHorizons,
    costBps,
    samples,
    candidateCount,
    eligibleCount,
    excludedByReason,
  } = args;

  const matrixRows: DecisionForwardMatrixRow[] = [];
  for (const decisionDay of decisionDays) {
    for (const horizon of forwardHorizons) {
      for (const group of FORWARD_GROUPS) {
        const grouped = groupSamples(samples, decisionDay, horizon, group);
        const values = grouped
          .map((sample) => sample.grossReturn)
          .filter((value): value is number => value !== null);
        const stats = summarizeReturns(values, costBps);
        matrixRows.push({
          decisionDay,
          horizon,
          group,
          groupLabel: FORWARD_GROUP_LABELS[group],
          sampleCount: grouped.length,
          ...stats,
        });
      }
    }
  }

  const rowOf = (decisionDay: number, horizon: number, group: ForwardGroupCode) =>
    matrixRows.find(
      (row) =>
        row.decisionDay === decisionDay && row.horizon === horizon && row.group === group,
    ) ?? null;

  const comparisonRows: ForwardComparisonRow[] = [];
  for (const decisionDay of decisionDays) {
    for (const horizon of forwardHorizons) {
      const nonBreak = rowOf(decisionDay, horizon, "NON_BREAK_OPEN");
      const breakOpen = rowOf(decisionDay, horizon, "BREAK_OPEN");
      if (nonBreak === null || breakOpen === null) continue;
      const add = (
        metric: string,
        left: number | null,
        right: number | null,
        nonBreakCount: number,
        breakCount: number,
      ): void => {
        comparisonRows.push({
          decisionDay,
          horizon,
          metric,
          nonBreakValue: left,
          breakValue: right,
          deltaBreakMinusNonBreak: left === null || right === null ? null : round(right - left),
          nonBreakCount,
          breakCount,
        });
      };
      add(
        "平均毛收益",
        nonBreak.meanGrossReturn,
        breakOpen.meanGrossReturn,
        nonBreak.availableCount,
        breakOpen.availableCount,
      );
      add(
        "中位毛收益",
        nonBreak.medianGrossReturn,
        breakOpen.medianGrossReturn,
        nonBreak.availableCount,
        breakOpen.availableCount,
      );
      add(
        "平均净收益",
        nonBreak.meanNetReturn,
        breakOpen.meanNetReturn,
        nonBreak.availableCount,
        breakOpen.availableCount,
      );
      add(
        "中位净收益",
        nonBreak.medianNetReturn,
        breakOpen.medianNetReturn,
        nonBreak.availableCount,
        breakOpen.availableCount,
      );
      comparisonRows.push({
        decisionDay,
        horizon,
        metric: "可用样本数",
        nonBreakValue: nonBreak.availableCount,
        breakValue: breakOpen.availableCount,
        deltaBreakMinusNonBreak: breakOpen.availableCount - nonBreak.availableCount,
        nonBreakCount: nonBreak.availableCount,
        breakCount: breakOpen.availableCount,
      });
    }
  }

  const annualRows: AnnualForwardRow[] = [];
  const years = [...new Set(samples.map((sample) => sample.year))].sort((a, b) => a - b);
  for (const year of years) {
    for (const decisionDay of decisionDays) {
      for (const horizon of forwardHorizons) {
        for (const group of ["ALL", "NON_BREAK_OPEN", "BREAK_OPEN"] as const) {
          const grouped = samples.filter(
            (sample) =>
              sample.year === year &&
              sample.decisionDay === decisionDay &&
              sample.horizon === horizon &&
              sample.groups.includes(group),
          );
          const values = grouped
            .map((sample) => sample.grossReturn)
            .filter((value): value is number => value !== null);
          const stats = summarizeReturns(values, costBps);
          annualRows.push({
            year,
            decisionDay,
            horizon,
            group,
            groupLabel: FORWARD_GROUP_LABELS[group],
            sampleCount: grouped.length,
            meanNetReturn: stats.meanNetReturn,
            medianNetReturn: stats.medianNetReturn,
            winRateNet: stats.winRateNet,
          });
        }
      }
    }
  }

  const completeCells = matrixRows.filter(
    (row) => row.group === "ALL" && row.availableCount > 0,
  );
  const positiveAllMeanNetCellCount = completeCells.filter(
    (row) => row.meanNetReturn !== null && row.meanNetReturn > 0,
  ).length;
  const deltaCells = comparisonRows.filter((row) => row.metric === "中位净收益");
  const nonBreakMinusBreakPositiveCellCount = deltaCells.filter(
    (row) =>
      row.nonBreakValue !== null &&
      row.breakValue !== null &&
      row.nonBreakValue - row.breakValue > 0,
  ).length;
  const nonBreakMinusBreakNegativeCellCount = deltaCells.filter(
    (row) =>
      row.nonBreakValue !== null &&
      row.breakValue !== null &&
      row.nonBreakValue - row.breakValue < 0,
  ).length;

  const observations: Array<{ kind: ObservationKind; text: string }> = [];
  for (const decisionDay of decisionDays) {
    for (const horizon of forwardHorizons) {
      const nonBreak = rowOf(decisionDay, horizon, "NON_BREAK_OPEN");
      const breakOpen = rowOf(decisionDay, horizon, "BREAK_OPEN");
      if (nonBreak === null || breakOpen === null) continue;
      if (nonBreak.medianNetReturn === null || breakOpen.medianNetReturn === null) {
        observations.push({
          kind: "LIMITATION",
          text: `T+${decisionDay} 决策、T+${horizon} 视界：至少一个分组没有足够未来行情，无法给出组间比较。`,
        });
        continue;
      }
      observations.push({
        kind: "COMPARATIVE",
        text:
          `T+${decisionDay} 决策、T+${horizon} 视界（决策日收盘价锚定、扣除 ${costBps} bps 往返成本）：` +
          `不破开盘价组中位净收益 ${(nonBreak.medianNetReturn * 100).toFixed(2)}%（n=${nonBreak.availableCount}），` +
          `破位组 ${(breakOpen.medianNetReturn * 100).toFixed(2)}%（n=${breakOpen.availableCount}），` +
          `破位组减不破组 = ${((breakOpen.medianNetReturn - nonBreak.medianNetReturn) * 100).toFixed(2)} 个百分点。` +
          `该差值尚未做显著性、多重比较或样本外验证。`,
      });
    }
  }
  observations.push({
    kind: "DESCRIPTIVE",
    text:
      `共检验 ${decisionDays.length} 个决策日 × ${forwardHorizons.length} 个后续视界；` +
      `在不破 / 破位的 ${deltaCells.length} 个中位净收益比较中，` +
      `不破组更高的格子 ${nonBreakMinusBreakPositiveCellCount} 个，破位组更高的格子 ${nonBreakMinusBreakNegativeCellCount} 个。`,
  });
  observations.push({
    kind: "LIMITATION",
    text:
      "收益按收盘价到收盘价计算，不是一个可直接成交的执行模型；净收益只统一扣除往返成本参数，未处理滑点、涨跌停不可成交、停牌、整手、公司行为与冲击成本。",
  });
  observations.push({
    kind: "LIMITATION",
    text:
      "当前 Dataset 仅覆盖沪深主板（boardType=main）。结果不能外推到创业板、科创板、北交所或全市场。",
  });
  observations.push({
    kind: "LIMITATION",
    text:
      "均值置信区间为普通近似 95% CI，未控制多重比较、重叠收益窗口或横截面相关性；不能据此宣称统计显著。",
  });

  const customPayload: DecisionForwardCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    informationBoundary: {
      decisionOffsetDays: MAX_DECISION_DAY,
      usesForwardData: true,
      forwardDataPurpose:
        "在 T+k 决策时点之后，从 T+k 收盘到 T+h 收盘计算未来收益，并比较路径分组与回撤分桶；事件日之后的未来数据只用于结果观察，不用于新增候选事件。",
      decisionTimeInformation: [
        "首板日 rd=0 的 open / close 作为路径基准",
        "T+1…T+k 已经发生的 low / close，用于判定是否破首板日开盘价与回撤深度",
      ],
      postEventResearchOutcome: [
        "T+k 收盘到 T+h 收盘的毛收益与成本后净收益",
        "各决策日 / 视界 / 分组 / 年度的统计量",
      ],
      notes: [
        "收益窗口严格为 rd ∈ [k+1, h]，不包含 T+k 当日，也不复用 T+1…T+k 的路径涨幅。",
        "核心样本只要求 rd=1..max(decisionDays) 路径齐备，不要求远期 h 齐备；每个决策日 / 视界独立报告可用样本数。",
      ],
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      scannedRowCount: args.scannedRowCount,
      candidateCount: args.candidateCount,
      droppedByMaxEvents: args.droppedByMaxEvents,
      droppedByScanLimit: args.droppedByScanLimit,
      unscannedEventCount: args.unscannedEventCount,
      eventScanPolicy: args.eventScanPolicy,
      scanLimit: args.scanLimit,
      duplicateEventIdCount: args.duplicateEventIdCount,
    },
    dataQuality: {
      eventDayBarRowsRead: args.eventDayBarRowsRead,
      observationBarRowsRead: args.observationBarRowsRead,
      missingEventDayBarCount: args.missingEventDayBarCount,
      invalidEventDayCount: args.invalidEventDayCount,
      missingDecisionPathEventCount: args.missingDecisionPathEventCount,
      invalidDecisionPathEventCount: args.invalidDecisionPathEventCount,
      invalidDecisionPathBarCount: args.invalidDecisionPathBarCount,
    },
    summary: {
      coreSampleCount: eligibleCount,
      decisionDayCount: decisionDays.length,
      horizonCount: forwardHorizons.length,
      completeCellCount: completeCells.length,
      positiveAllMeanNetCellCount,
      nonBreakMinusBreakPositiveCellCount,
      nonBreakMinusBreakNegativeCellCount,
    },
    costBps,
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    groupLabels: { ...FORWARD_GROUP_LABELS },
    observations,
    hypotheses: [
      {
        code: "H1",
        statement:
          "在决策日之后，未跌破首板日开盘价的样本可能比已破位样本有更好的后续收益。",
        rationale:
          "本实验严格把收益窗口限制在决策日之后；是否成立由各组净收益及置信区间决定，不能沿用事件日起算的重叠区间结论。",
      },
      {
        code: "H2",
        statement: "截至决策日的回撤深度与后续净收益之间可能存在单调或非线性关系。",
        rationale:
          "回撤深度分组使用 T+1…T+k 的累计最低价，相对收益从 T+k 收盘起算；本实验只报告梯度，不选择最佳桶。",
      },
    ],
    notes: [
      "本实验只做决策时点之后的描述与稳定性输入，不产出策略、候选、参数或排序。",
      "正收益格子数只是描述性计数，不进行多重比较显著性判断。",
      "若后续进入策略阶段，必须另行加入真实执行模型、公司行为、样本外和 Walk-Forward。",
    ],
  };

  const dataSufficiencyChecks = [
    {
      code: "core_sample_ge_1000",
      label: "核心样本数不少于 1000",
      status: eligibleCount >= 1000 ? ("PASS" as const) : ("FAIL" as const),
      value: eligibleCount,
      threshold: 1000,
    },
    {
      code: "all_cells_available_ge_500",
      label: "每个决策日 / 视界格子的可用样本不少于 500",
      status: matrixRows
        .filter((row) => row.group === "ALL")
        .every((row) => row.availableCount >= 500)
        ? ("PASS" as const)
        : ("FAIL" as const),
      value: Math.min(
        ...matrixRows.filter((row) => row.group === "ALL").map((row) => row.availableCount),
      ),
      threshold: 500,
    },
    {
      code: "decision_path_exclusion_le_5pct",
      label: "决策路径缺失 / 非法剔除率不超过 5%",
      status:
        candidateCount > 0 &&
        (args.missingDecisionPathEventCount + args.invalidDecisionPathEventCount) /
          candidateCount <=
          0.05
          ? ("PASS" as const)
          : ("FAIL" as const),
      value:
        candidateCount === 0
          ? null
          : (args.missingDecisionPathEventCount + args.invalidDecisionPathEventCount) /
            candidateCount,
      threshold: 0.05,
    },
  ];
  const dataSufficient = dataSufficiencyChecks.every((check) => check.status === "PASS");
  const h1Checks = deltaCells.map((row) => {
    const nonBreak = row.nonBreakValue;
    const breakOpen = row.breakValue;
    const delta =
      nonBreak === null || breakOpen === null ? null : nonBreak - breakOpen;
    return {
      code: `nonbreak_minus_break_k${row.decisionDay}_h${row.horizon}`,
      label: `T+${row.decisionDay} 决策 → T+${row.horizon}，不破组中位净收益 − 破位组`,
      status:
        delta === null
          ? ("INSUFFICIENT" as const)
          : delta > 0
            ? ("PASS" as const)
            : ("FAIL" as const),
      value: delta,
      threshold: 0,
    };
  });
  const h1PositiveCellCount = h1Checks.filter((check) => check.status === "PASS").length;
  const h1VerdictCheck = {
    code: "h1_positive_cells_ge_7",
    label: "H1：至少 7/10 个格子的不破组中位净收益高于破位组",
    status:
      dataSufficient && h1PositiveCellCount >= 7
        ? ("PASS" as const)
        : dataSufficient
          ? ("FAIL" as const)
          : ("INSUFFICIENT" as const),
    value: h1PositiveCellCount,
    threshold: 7,
  };

  let confirmatoryGate: ExperimentConfirmatoryGate | undefined;
  if (
    args.protocol?.phase === "OBSERVATION" ||
    args.protocol?.phase === "HOLDOUT"
  ) {
    const status =
      args.protocol.phase === "OBSERVATION"
        ? dataSufficient
          ? "OBSERVATION_READY"
          : "INSUFFICIENT"
        : !dataSufficient
          ? "INSUFFICIENT"
          : h1VerdictCheck.status === "PASS"
            ? "PASS"
            : "FAIL";
    confirmatoryGate = {
      status,
      protocolFingerprint: args.protocol.protocolFingerprint!,
      sampleCount: eligibleCount,
      checks: [...dataSufficiencyChecks, ...h1Checks, h1VerdictCheck],
      summary:
        status === "OBSERVATION_READY"
          ? `Observation 数据充分，可冻结并进入 Holdout；H1 预检 ${h1PositiveCellCount}/10 个格子为正。`
          : status === "PASS"
            ? `Holdout 通过：${h1PositiveCellCount}/10 个格子支持 H1。`
            : status === "FAIL"
              ? `Holdout 未通过 H1：仅 ${h1PositiveCellCount}/10 个格子支持不破组更优。`
              : "样本 / 数据质量不足，Gate 为 INSUFFICIENT。",
    };
  }

  const chartRows = (
    group: ForwardGroupCode,
  ): Array<{ x: string; y: number | null }> =>
    decisionDays.flatMap((decisionDay) =>
      forwardHorizons.map((horizon) => {
        const row = rowOf(decisionDay, horizon, group);
        return {
          x: `T+${decisionDay}→T+${horizon}`,
          y: row?.meanNetReturn ?? null,
        };
      }),
    );

  return {
    sampleSummary: {
      candidateCount,
      eligibleCount,
      excludedCount: candidateCount - eligibleCount,
      excludedByReason,
      notes: [
        "样本单位 = 1 个首板事件的决策日 / 视界观测；核心样本资格只要求决策路径齐备，远期视界不足按每个格子独立登记。",
        `净收益 = 毛收益 − ${costBps} bps 往返成本；这是敏感性参数，不是完整执行模型。`,
      ],
    },
    statistics: [
      {
        code: "core_sample_count",
        label: "核心样本事件数",
        value: eligibleCount,
        unit: "个事件",
        digits: 0,
        sampleCount: eligibleCount,
      },
      {
        code: "decision_horizon_cell_count",
        label: "决策日 × 后续视界格子数",
        value: decisionDays.length * forwardHorizons.length,
        unit: "个",
        digits: 0,
      },
      {
        code: "positive_all_mean_net_cell_count",
        label: "全部样本平均净收益为正的格子",
        value: positiveAllMeanNetCellCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "nonbreak_minus_break_positive_cell_count",
        label: "中位净收益不破组更高的格子",
        value: nonBreakMinusBreakPositiveCellCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "nonbreak_minus_break_negative_cell_count",
        label: "中位净收益破位组更高的格子",
        value: nonBreakMinusBreakNegativeCellCount,
        unit: "个",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "decision_forward_matrix",
        title: "决策日后续收益矩阵",
        description:
          "收益严格从 T+k 收盘到 T+h 收盘；sampleCount = 该分组已冻结样本文本，availableCount = 未来窗口齐备且可计算。",
        columns: [
          { key: "decisionDay", label: "决策日", align: "RIGHT" },
          { key: "horizon", label: "后续视界", align: "RIGHT" },
          { key: "group", label: "分组码", align: "LEFT" },
          { key: "groupLabel", label: "分组", align: "LEFT" },
          { key: "sampleCount", label: "分组样本", align: "RIGHT" },
          { key: "availableCount", label: "可用样本", align: "RIGHT" },
          { key: "meanGrossReturn", label: "平均毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianGrossReturn", label: "中位毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "p25GrossReturn", label: "P25 毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "p75GrossReturn", label: "P75 毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetReturn", label: "平均净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianNetReturn", label: "中位净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "winRateNet", label: "净收益胜率", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetCi95Low", label: "净均值 CI95 下界", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetCi95High", label: "净均值 CI95 上界", unit: "比例", digits: 6, align: "RIGHT" },
        ],
        rows: matrixRows,
      },
      {
        key: "non_break_vs_break_forward",
        title: "不破组 vs 破位组（决策日之后）",
        description:
          "每行固定一个决策日和后续视界；差值为破位组减不破组。此表不判定优劣。",
        columns: [
          { key: "decisionDay", label: "决策日", align: "RIGHT" },
          { key: "horizon", label: "后续视界", align: "RIGHT" },
          { key: "metric", label: "指标", align: "LEFT" },
          { key: "nonBreakValue", label: "不破组", digits: 6, align: "RIGHT" },
          { key: "breakValue", label: "破位组", digits: 6, align: "RIGHT" },
          { key: "deltaBreakMinusNonBreak", label: "破位 − 不破", digits: 6, align: "RIGHT" },
          { key: "nonBreakCount", label: "不破样本", align: "RIGHT" },
          { key: "breakCount", label: "破位样本", align: "RIGHT" },
        ],
        rows: comparisonRows,
      },
      {
        key: "annual_forward_by_group",
        title: "分年度决策后净收益",
        description:
          "按事件年份拆分；只展示 ALL / 不破 / 破位三组。各年样本量不同，不做年度间显著性判断。",
        columns: [
          { key: "year", label: "年份", align: "RIGHT" },
          { key: "decisionDay", label: "决策日", align: "RIGHT" },
          { key: "horizon", label: "后续视界", align: "RIGHT" },
          { key: "groupLabel", label: "分组", align: "LEFT" },
          { key: "sampleCount", label: "分组样本", align: "RIGHT" },
          { key: "meanNetReturn", label: "平均净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianNetReturn", label: "中位净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "winRateNet", label: "净收益胜率", unit: "比例", digits: 6, align: "RIGHT" },
        ],
        rows: annualRows,
      },
    ],
    charts: (["ALL", "NON_BREAK_OPEN", "BREAK_OPEN"] as const).map((group) => ({
      key: `mean-net-${group.toLowerCase()}`,
      title: `${FORWARD_GROUP_LABELS[group]} · 平均净收益`,
      description: `决策日收盘到后续视界收盘，已扣除 ${costBps} bps 往返成本。`,
      kind: "BAR" as const,
      xLabel: "决策日 → 视界",
      yLabel: "平均净收益",
      unit: "比例",
      series: [
        {
          key: group,
          label: FORWARD_GROUP_LABELS[group],
          points: chartRows(group),
        },
      ],
    })),
    ...(confirmatoryGate !== undefined ? { confirmatoryGate } : {}),
    customPayload,
  };
}
