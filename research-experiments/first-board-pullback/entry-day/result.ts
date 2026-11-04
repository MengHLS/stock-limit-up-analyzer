/**
 * 示例实验 · 结果结构定义与组装（`experiment.ts` 的搭档文件）。
 *
 * ## 为什么要拆成两个文件
 *
 * | 文件 | 回答的问题 |
 * | --- | --- |
 * | `experiment.ts` | **研究什么、怎么算**（元数据 + 取数 + 计算） |
 * | `result.ts` | **结果长什么样**（自有 schema + 表格 / 统计 / 图表 / 比较怎么组装） |
 *
 * 拆开的好处很实际：改「口径」只动 `experiment.ts`，改「怎么呈现」只动 `result.ts`
 * 与 `page.tsx`；而 `resultSchema`（本实验自有结果的 zod 校验）与它的组装函数
 * 放在同一个文件里，**schema 与产物不可能漂移**。
 */

import { z } from "zod";
import { mean, median, percentile } from "@shared/quant-stats";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";

/**
 * 计算口径版本 —— 改动任何一处**计算**都必须升这个值。
 *
 * 🔴 它同时进 `descriptor.version` 与 `customPayload.computationVersion`（后者是 `z.literal`）：
 * 若只改一处，`resultSchema` 会立刻校验失败 —— 「版本与产物必须同步」成为结构事实。
 */
export const COMPUTATION_VERSION = "1.0.0";

/**
 * 剔除原因的**闭集**（键 = 机器可读码，值 = 人读说明）。
 *
 * 🔴 每一条都必须**真的会出现**（禁止臆造原因）。这张表会随结果下发
 * （`customPayload.exclusionReasonLabels`），让「样本为什么变少」在页面上直接读得懂，
 * 不必回源码查码表。`experiment.ts` 的 `addExclusion()` 会拒绝未登记的码。
 */
export const EXCLUSION_REASON_LABELS = {
  MAX_EVENTS_LIMIT: "超出 maxEvents 上限（本次未纳入统计）",
  MISSING_EVENT_DAY_BAR: "缺少首板日（rd=0）行情，无法确定基准价",
  INVALID_EVENT_DAY_CLOSE: "首板日收盘价缺失或非正",
  MISSING_ENTRY_BAR: "缺少入场日（rd=k）行情",
  INVALID_ENTRY_OPEN: "入场日开盘价缺失或非正",
  MISSING_EXIT_BAR: "缺少退出日（rd=exit）行情",
  INVALID_EXIT_CLOSE: "退出日收盘价缺失或非正",
  MISSING_INTERMEDIATE_BAR: "入场日至退出日之间存在行情缺口，无法计算最大不利偏移",
} as const;

export type ExclusionReasonCode = keyof typeof EXCLUSION_REASON_LABELS;

/** 本实验自有结果结构（`result.customPayload`）。 */
export const entryDayCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  entryDays: z.array(z.number().int()),
  exitRelativeDay: z.number().int(),
  /** 剔除原因码 → 人读说明（页面据此翻译 `sampleSummary.excludedByReason` 的键）。 */
  exclusionReasonLabels: z.record(z.string(), z.string()),
  /** 候选事件口径（如实：数据集有几个、扫到几个、用了几个）。 */
  candidates: z.object({
    datasetEventCount: z.number().int().nullable(),
    scannedEventCount: z.number().int(),
    usedEventCount: z.number().int(),
    droppedByMaxEvents: z.number().int(),
    droppedByScanLimit: z.boolean(),
  }),
  /** 逐入场日的机器可读汇总（与表格同源；**不含**任何排序 / 择优字段）。 */
  slots: z.array(
    z.object({
      entryDay: z.number().int(),
      sampleCount: z.number().int(),
      meanForwardReturnPercent: z.number().nullable(),
      medianForwardReturnPercent: z.number().nullable(),
      winRatePercent: z.number().nullable(),
      meanEntryGapPercent: z.number().nullable(),
      meanMaxAdversePercent: z.number().nullable(),
    }),
  ),
  /** 样本选择偏差与口径边界的显式登记（不藏）。 */
  selectionNotes: z.array(z.string()),
});

export type EntryDayCustomPayload = z.infer<typeof entryDayCustomPayloadSchema>;

/** 单个（事件 × 入场日）槽位的观测值。 */
export interface EntryDaySample {
  entryDay: number;
  /** 入场日开盘相对首板日收盘（%，负 = 低开）。 */
  entryGapPercent: number;
  /** 入场价 → 退出日收盘（%）。 */
  forwardReturnPercent: number;
  /** 入场后到退出日之间最低价相对入场价（%，≤ 0 表示曾浮亏）。 */
  maxAdversePercent: number;
}

/** 逐入场日的汇总（内部结构，同时是表格 / 图表的数据源）。 */
export interface EntryDaySlotStats {
  entryDay: number;
  sampleCount: number;
  meanForwardReturnPercent: number | null;
  medianForwardReturnPercent: number | null;
  winRatePercent: number | null;
  meanEntryGapPercent: number | null;
  meanMaxAdversePercent: number | null;
  p25ForwardReturnPercent: number | null;
  p75ForwardReturnPercent: number | null;
}

/** 数值清洗：非有限数一律 `null`（**禁 0 兜底**）。 */
export function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 按入场日分组求汇总（空组 ⇒ 全部指标为 `null`，不编 0）。 */
export function summarizeByEntryDay(
  entryDays: readonly number[],
  samples: readonly EntryDaySample[],
): EntryDaySlotStats[] {
  return entryDays.map((entryDay) => {
    const group = samples.filter((sample) => sample.entryDay === entryDay);
    const returns = group.map((s) => s.forwardReturnPercent);
    const gaps = group.map((s) => s.entryGapPercent);
    const adverses = group.map((s) => s.maxAdversePercent);
    const wins = returns.filter((value) => value > 0).length;
    return {
      entryDay,
      sampleCount: group.length,
      meanForwardReturnPercent: mean(returns),
      medianForwardReturnPercent: median(returns),
      winRatePercent: returns.length === 0 ? null : (wins / returns.length) * 100,
      meanEntryGapPercent: mean(gaps),
      meanMaxAdversePercent: mean(adverses),
      p25ForwardReturnPercent: percentile(returns, 25),
      p75ForwardReturnPercent: percentile(returns, 75),
    };
  });
}

/** 收益分布分桶（左开右闭；首桶含 -10%）。 */
const RETURN_BUCKETS: ReadonlyArray<{ label: string; test: (value: number) => boolean }> = [
  { label: "≤ -10%", test: (v) => v <= -10 },
  { label: "(-10%, -5%]", test: (v) => v > -10 && v <= -5 },
  { label: "(-5%, 0%]", test: (v) => v > -5 && v <= 0 },
  { label: "(0%, 5%]", test: (v) => v > 0 && v <= 5 },
  { label: "(5%, 10%]", test: (v) => v > 5 && v <= 10 },
  { label: "> 10%", test: (v) => v > 10 },
];

/** 数值展示小数位。 */
const DIGITS = 4;

/** 组装最终结果（表格 / 统计 / 分布 / 比较 / 图表 / 自有结构）。 */
export function assembleEntryDayResult(args: {
  slots: readonly EntryDaySlotStats[];
  samples: readonly EntryDaySample[];
  exitRelativeDay: number;
  datasetEventCount: number | null;
  scannedEventCount: number;
  usedEventCount: number;
  droppedByMaxEvents: number;
  excludedByReason: Record<string, number>;
  candidateCount: number;
  eligibleCount: number;
  slotsPerEvent: number;
}): ExperimentResultPayload {
  const {
    slots,
    samples,
    exitRelativeDay,
    datasetEventCount,
    scannedEventCount,
    usedEventCount,
    droppedByMaxEvents,
    excludedByReason,
    candidateCount,
    eligibleCount,
  } = args;

  const excludedCount = candidateCount - eligibleCount;
  const firstSlot = slots[0];

  const distributions = slots.map((slot) => {
    const group = samples.filter((sample) => sample.entryDay === slot.entryDay);
    return {
      code: `forward_return_pct@T+${slot.entryDay}`,
      label: `T+${slot.entryDay} 入场 → T+${exitRelativeDay} 收盘 收益分布`,
      buckets: RETURN_BUCKETS.map((bucket) => ({
        label: bucket.label,
        count: group.filter((sample) => bucket.test(sample.forwardReturnPercent)).length,
      })),
      note: `样本 ${group.length} 条；区间为左开右闭（首桶含 -10%）。`,
    };
  });

  // 比较：以最早的入场日为基准，逐项给出差值（**不排序、不评优劣**）。
  const comparisonRows = firstSlot
    ? slots.slice(1).flatMap((slot) => [
        {
          label: `T+${slot.entryDay} − T+${firstSlot.entryDay} · 平均收益%`,
          left: firstSlot.meanForwardReturnPercent,
          right: slot.meanForwardReturnPercent,
          delta:
            firstSlot.meanForwardReturnPercent === null || slot.meanForwardReturnPercent === null
              ? null
              : slot.meanForwardReturnPercent - firstSlot.meanForwardReturnPercent,
          deltaPercent: null,
        },
        {
          label: `T+${slot.entryDay} − T+${firstSlot.entryDay} · 胜率%`,
          left: firstSlot.winRatePercent,
          right: slot.winRatePercent,
          delta:
            firstSlot.winRatePercent === null || slot.winRatePercent === null
              ? null
              : slot.winRatePercent - firstSlot.winRatePercent,
          deltaPercent: null,
        },
      ])
    : [];

  const selectionNotes = [
    "样本资格包含「T+k 与 T+exit 的行情存在」这一数据可得性条件 —— 属于选择偏差，不是价格条件，特此登记。",
    `退出日固定为 T+${exitRelativeDay} 收盘，因此越晚的入场日持有期越短；跨入场日比较时须记住这一点。`,
    "本实验只做描述性统计，不排序、不评级、不判定最优入场日，也不做显著性主张。",
  ];
  if (droppedByMaxEvents > 0) {
    selectionNotes.push(
      `受 maxEvents 限制，按事件日升序只使用了前 ${usedEventCount} 个事件，另有 ${droppedByMaxEvents} 个事件未纳入（已计入剔除原因 MAX_EVENTS_LIMIT）。`,
    );
  }
  if (scannedEventCount >= 20000) {
    selectionNotes.push("事件扫描触达平台安全阀上限，数据集内可能还有更多事件未被扫描（未计入候选）。");
  }

  const customPayload: EntryDayCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    entryDays: slots.map((slot) => slot.entryDay),
    exitRelativeDay,
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    candidates: {
      datasetEventCount,
      scannedEventCount,
      usedEventCount,
      droppedByMaxEvents,
      droppedByScanLimit: scannedEventCount >= 20000,
    },
    slots: slots.map((slot) => ({
      entryDay: slot.entryDay,
      sampleCount: slot.sampleCount,
      meanForwardReturnPercent: slot.meanForwardReturnPercent,
      medianForwardReturnPercent: slot.medianForwardReturnPercent,
      winRatePercent: slot.winRatePercent,
      meanEntryGapPercent: slot.meanEntryGapPercent,
      meanMaxAdversePercent: slot.meanMaxAdversePercent,
    })),
    selectionNotes,
  };

  return {
    sampleSummary: {
      candidateCount,
      eligibleCount,
      excludedCount,
      excludedByReason,
      notes: [
        `样本单位 =（事件 × 入场日）一次可评估的入场机会：候选事件 ${scannedEventCount} × ${args.slotsPerEvent} 个入场日 = ${candidateCount} 个槽位。`,
        "剔除原因键为闭集，中文说明见 customPayload.exclusionReasonLabels。",
      ],
    },
    tables: [
      {
        key: "entry-day-summary",
        title: "逐入场日基础统计",
        description: `收益 = 入场日开盘 → T+${exitRelativeDay} 收盘；入场位置 = 入场日开盘相对首板日收盘；最大不利偏移 = 入场日（含当日）到退出日之间最低价相对入场价。`,
        columns: [
          { key: "entryDay", label: "入场日", align: "LEFT" as const },
          { key: "sampleCount", label: "样本数", align: "RIGHT" as const },
          {
            key: "meanForwardReturnPercent",
            label: "平均收益",
            unit: "%",
            digits: DIGITS,
            align: "RIGHT" as const,
          },
          {
            key: "medianForwardReturnPercent",
            label: "中位收益",
            unit: "%",
            digits: DIGITS,
            align: "RIGHT" as const,
          },
          { key: "winRatePercent", label: "胜率", unit: "%", digits: 2, align: "RIGHT" as const },
          {
            key: "meanEntryGapPercent",
            label: "平均入场位置",
            unit: "%",
            digits: DIGITS,
            align: "RIGHT" as const,
          },
          {
            key: "meanMaxAdversePercent",
            label: "平均最大不利偏移",
            unit: "%",
            digits: DIGITS,
            align: "RIGHT" as const,
          },
        ],
        rows: slots.map((slot) => ({
          entryDay: `T+${slot.entryDay}`,
          sampleCount: slot.sampleCount,
          meanForwardReturnPercent: slot.meanForwardReturnPercent,
          medianForwardReturnPercent: slot.medianForwardReturnPercent,
          winRatePercent: slot.winRatePercent,
          meanEntryGapPercent: slot.meanEntryGapPercent,
          meanMaxAdversePercent: slot.meanMaxAdversePercent,
        })),
      },
    ],
    statistics: [
      {
        code: "candidate_event_count",
        label: "候选事件数（数据集扫描结果）",
        value: scannedEventCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "used_event_count",
        label: "实际纳入统计的事件数",
        value: usedEventCount,
        unit: "个",
        digits: 0,
        sampleCount: usedEventCount,
      },
      {
        code: "eligible_slot_count",
        label: "可评估槽位（事件 × 入场日）",
        value: eligibleCount,
        unit: "个",
        digits: 0,
      },
      {
        code: "excluded_slot_count",
        label: "被剔除槽位",
        value: excludedCount,
        unit: "个",
        digits: 0,
        note: Object.keys(excludedByReason).length === 0 ? "无剔除" : "逐项原因见样本口径。",
      },
    ],
    distributions,
    comparisons:
      comparisonRows.length > 0 && firstSlot
        ? [
            {
              key: "vs-first-entry-day",
              title: `相对 T+${firstSlot.entryDay} 的差异（仅差值，不含优劣判断）`,
              description: "左列 = 基准入场日，右列 = 对比入场日；差值 = 右 − 左。",
              leftLabel: `T+${firstSlot.entryDay}`,
              rightLabel: "对比入场日",
              rows: comparisonRows,
            },
          ]
        : undefined,
    charts: [
      {
        key: "mean-forward-return",
        title: "逐入场日平均收益",
        kind: "BAR" as const,
        xLabel: "入场日",
        yLabel: "平均收益",
        unit: "%",
        series: [
          {
            key: "mean-forward-return",
            label: `平均收益（入场 → T+${exitRelativeDay} 收盘）`,
            points: slots.map((slot) => ({
              x: `T+${slot.entryDay}`,
              y: slot.meanForwardReturnPercent,
            })),
          },
        ],
      },
      {
        key: "win-rate",
        title: "逐入场日胜率",
        kind: "BAR" as const,
        xLabel: "入场日",
        yLabel: "胜率",
        unit: "%",
        series: [
          {
            key: "win-rate",
            label: "收益 > 0 的比例",
            points: slots.map((slot) => ({ x: `T+${slot.entryDay}`, y: slot.winRatePercent })),
          },
        ],
      },
    ],
    customPayload,
  };
}
