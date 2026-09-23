import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";
import {
  type FoundationBootstrapRow,
  type FoundationCurveRow,
} from "../../shared/firstBoardPullback/types";

export const COMPUTATION_VERSION = "1.0.0";
export const DEFAULT_MAX_GAP_PCT = 2;
export const DEFAULT_NO_LIMIT_DAYS = 5;
export const DEFAULT_NO_PREVIOUS_LIMIT_DAYS = 10;
export const DEFAULT_MAX_EVENTS = 20_000;
export const ENTRY_DAY = 6;
export const MAX_EXIT_DAY = 20;

export const SUPPORT_GROUP_CODES = [
  "BODY_TOP",
  "BODY_HALF",
  "BODY_BOTTOM",
  "MA5",
  "MA10",
  "MA20",
] as const;
export type SupportGroupCode = (typeof SUPPORT_GROUP_CODES)[number];

export const SUPPORT_GROUP_LABELS: Readonly<
  Record<SupportGroupCode, string>
> = Object.freeze({
  BODY_TOP: "T+1..T+5 收盘不破首板实体顶",
  BODY_HALF: "T+1..T+5 收盘不破首板实体 1/2",
  BODY_BOTTOM: "T+1..T+5 收盘不破首板实体底",
  MA5: "T+1..T+5 收盘不破 MA5",
  MA10: "T+1..T+5 收盘不破 MA10",
  MA20: "T+1..T+5 收盘不破 MA20",
});

export const EXCLUSION_REASON_LABELS = {
  ONE_WORD_LIMIT_UP: "首板为一字板",
  GAP_OVER_LIMIT: "首板日高开超过阈值",
  LIMIT_TOUCH_IN_CONTEXT: "T+1..T+5 触及涨停或跌停",
  PREVIOUS_LIMIT_TOO_CLOSE: "T-10 内存在涨停",
  MISSING_PREVIOUS_LIMIT_HISTORY: "前次涨停历史缺失",
  MISSING_CONTEXT_BAR: "T+1..T+5 行情缺失或停牌",
  ENTRY_UNFILLABLE: "T+6 开盘不可买",
  MISSING_MA_HISTORY: "MA5/MA10/MA20 所需历史收盘价缺失",
} as const;

export interface SupportScreenAccountRow {
  [key: string]: string | number | null;
  stage: string;
  event_count: number;
}

export interface SupportGroupCountRow {
  [key: string]: string | number | null;
  group_code: SupportGroupCode;
  group_label: string;
  event_count: number;
  common_sample_event_count: number;
}

export const supportScreenPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  rule: z.object({
    maxGapPct: z.number().nonnegative(),
    noLimitDays: z.literal(DEFAULT_NO_LIMIT_DAYS),
    noPreviousLimitDays: z.literal(DEFAULT_NO_PREVIOUS_LIMIT_DAYS),
    entryDay: z.literal(ENTRY_DAY),
    maxExitDay: z.literal(MAX_EXIT_DAY),
    excludeOneWordLimitUp: z.boolean(),
    maxEvents: z.number().int().positive(),
  }),
  informationBoundary: z.object({
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  candidates: z.object({
    candidateCount: z.number().int().nonnegative(),
    datasetEventCount: z.number().int().nonnegative().nullable(),
    unscannedEventCount: z.number().int().nonnegative().nullable(),
    afterGapCount: z.number().int().nonnegative(),
    afterNoLimitCount: z.number().int().nonnegative(),
    afterNoPreviousLimitCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    commonSampleCount: z.number().int().nonnegative(),
  }),
  groupCounts: z.array(
    z.object({
      groupCode: z.string().min(1),
      groupLabel: z.string().min(1),
      eventCount: z.number().int().nonnegative(),
      commonSampleEventCount: z.number().int().nonnegative(),
    })
  ),
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

export type SupportScreenPayload = z.infer<typeof supportScreenPayloadSchema>;

export function assembleBodyMaSupportScreenResult(args: {
  maxGapPct: number;
  excludeOneWordLimitUp: boolean;
  maxEvents: number;
  candidateCount: number;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  afterGapCount: number;
  afterNoLimitCount: number;
  afterNoPreviousLimitCount: number;
  eligibleCount: number;
  commonSampleCount: number;
  groupCounts: readonly SupportGroupCountRow[];
  excludedByReason: Record<string, number>;
  curveRows: readonly FoundationCurveRow[];
  bootstrapRows: readonly FoundationBootstrapRow[];
}): ExperimentResultPayload {
  const customPayload: SupportScreenPayload = {
    computationVersion: COMPUTATION_VERSION,
    rule: {
      maxGapPct: args.maxGapPct,
      noLimitDays: DEFAULT_NO_LIMIT_DAYS,
      noPreviousLimitDays: DEFAULT_NO_PREVIOUS_LIMIT_DAYS,
      entryDay: ENTRY_DAY,
      maxExitDay: MAX_EXIT_DAY,
      excludeOneWordLimitUp: args.excludeOneWordLimitUp,
      maxEvents: args.maxEvents,
    },
    informationBoundary: {
      usesForwardData: true,
      forwardDataPurpose:
        "T+1..T+5 用于计算实体支撑与均线支撑，T+6 开盘入场后按实际持有日展开曲线。",
      decisionTimeInformation: [
        "首板日 open / close / previousClose",
        "T-10 前次涨停历史",
        "T+1..T+5 收盘、涨跌停价格和均线所需历史收盘",
      ],
      postEventResearchOutcome: [
        "T+6 开盘入场后的逐持有日净收益",
        "实际可卖退出、MFE/MAE 和锚点 Bootstrap",
      ],
      notes: [
        "不输出固定 T+10/T+20 单点结论。",
        "实体顶/中点/底和 MA 条件属于互相重叠的观察分组，不表示择优。",
      ],
    },
    candidates: {
      candidateCount: args.candidateCount,
      datasetEventCount: args.datasetEventCount,
      unscannedEventCount: args.unscannedEventCount,
      afterGapCount: args.afterGapCount,
      afterNoLimitCount: args.afterNoLimitCount,
      afterNoPreviousLimitCount: args.afterNoPreviousLimitCount,
      eligibleCount: args.eligibleCount,
      commonSampleCount: args.commonSampleCount,
    },
    groupCounts: args.groupCounts.map(row => ({
      groupCode: row.group_code,
      groupLabel: row.group_label,
      eventCount: row.event_count,
      commonSampleEventCount: row.common_sample_event_count,
    })),
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations: [
      {
        kind: "DESCRIPTIVE",
        text:
          `初始事件 ${args.candidateCount} 个；高开过滤后 ${args.afterGapCount} 个；` +
          `无涨跌停后 ${args.afterNoLimitCount} 个；T-10 无涨停后 ${args.afterNoPreviousLimitCount} 个；` +
          `最终可入场 ${args.eligibleCount} 个。`,
      },
      {
        kind: "LIMITATION",
        text: "结果按实际持有日展开，不选择收益最高的退出日。",
      },
    ],
    notes: [
      "实体顶=max(open, close)，实体底=min(open, close)，中点=(顶+底)/2。",
      "均线为包含当前交易日收盘的 MA5/MA10/MA20。",
      "所有条件在 T+1..T+5 每个交易日都必须成立。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 高开、无涨跌停、T-10 无涨停，且 T+6 可买。",
        "实体与均线支撑分组使用同一事件池。",
      ],
    },
    statistics: [
      {
        code: "screen_eligible_count",
        label: "筛选后可入场事件",
        value: args.eligibleCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "screen_common_count",
        label: "commonSample 事件",
        value: args.commonSampleCount,
        unit: "个事件",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "body_ma_screen_group_counts",
        title: "实体与均线支撑分组样本",
        description:
          "分组相互重叠；同一事件可以同时满足实体顶与 MA5 等条件。",
        columns: [
          { key: "group_label", label: "分组", align: "LEFT" },
          { key: "event_count", label: "事件数", align: "RIGHT" },
          {
            key: "common_sample_event_count",
            label: "commonSample",
            align: "RIGHT",
          },
        ],
        rows: [...args.groupCounts],
      },
      {
        key: "body_ma_entry_aligned_curve",
        title: "实体 / 均线支撑的入场对齐曲线",
        description:
          "全部从 T+6 开盘入场；退出按实际持有日展开，不比较固定 T+10/T+20 单点。",
        columns: [
          { key: "group_label", label: "分组", align: "LEFT" },
          { key: "sample_set", label: "样本口径", align: "LEFT" },
          { key: "holding_day", label: "持有日", align: "RIGHT" },
          { key: "sample_count", label: "样本", align: "RIGHT" },
          { key: "event_date_count", label: "事件日数", align: "RIGHT" },
          {
            key: "mean_net_return",
            label: "平均净收益",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "trimmed_mean_net_return",
            label: "去最高5%均值",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "median_net_return",
            label: "中位净收益",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "win_rate_net",
            label: "胜率",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "mean_mfe",
            label: "平均MFE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "mean_mae",
            label: "平均MAE",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
        ],
        rows: [...args.curveRows],
      },
      {
        key: "body_ma_anchor_bootstrap",
        title: "实体 / 均线支撑锚点 Bootstrap",
        description:
          "固定锚点持有日的日期聚类 Bootstrap，不用于选择最佳持有日。",
        columns: [
          { key: "group_label", label: "分组", align: "LEFT" },
          { key: "sample_set", label: "样本口径", align: "LEFT" },
          { key: "holding_day", label: "持有日", align: "RIGHT" },
          {
            key: "mean_net_return",
            label: "平均净收益",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrap_ci95_low",
            label: "CI95下界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
          {
            key: "bootstrap_ci95_high",
            label: "CI95上界",
            unit: "比例",
            digits: 6,
            align: "RIGHT",
          },
        ],
        rows: [...args.bootstrapRows],
      },
    ],
    customPayload,
  };
}
