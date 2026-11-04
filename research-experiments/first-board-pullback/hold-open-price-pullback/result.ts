import { z } from "zod";
import type { ExperimentResultPayload } from "@shared/researchExperimentsContracts";

export const COMPUTATION_VERSION = "1.1.0";
export const MAX_ENTRY_WINDOW_DAYS = 5;
export const MAX_EXIT_DAY = 20;
export const DEFAULT_EXIT_DAYS = [10, 15, 20] as const;

export const EXCLUSION_REASON_LABELS = {
  MAX_EVENTS_LIMIT: "超出 maxEvents 上限（本次未纳入统计）",
  MISSING_EVENT_DAY_BAR: "缺少首板日（rd=0）行情",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC 缺失、非正或自相矛盾",
  EXCLUDED_ONE_WORD_LIMIT_UP: "首板日为一字涨停（按实验参数排除）",
  MISSING_SIGNAL_PATH: "等待入场窗口 rd=1..5 存在行情缺口",
  INVALID_SIGNAL_PATH_OHLC: "等待入场窗口 rd=1..5 存在非法 OHLC",
} as const;

export type ObservationKind = "DESCRIPTIVE" | "COMPARATIVE" | "POTENTIAL_SIGNAL" | "LIMITATION";

export interface PullbackTradeSample {
  eventId: string;
  year: number;
  triggerDay: number;
  entryDay: number;
  exitDay: number;
  grossReturn: number;
  breakAfterEntry: boolean;
}

export interface BaselineSample {
  eventId: string;
  year: number;
  exitDay: number;
  grossReturn: number;
}

export interface TradePerformanceRow {
  [key: string]: string | number | boolean | null;
  triggerDay: number;
  entryDay: number;
  exitDay: number;
  sampleCount: number;
  availableCount: number;
  breakAfterEntryCount: number;
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

export interface TriggerAccountingRow {
  [key: string]: string | number | null;
  triggerDay: number;
  entryDay: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  enteredCount: number;
  breakAfterEntryCount: number;
}

export interface AnnualTradeRow {
  [key: string]: string | number | null;
  year: number;
  triggerDay: number;
  exitDay: number;
  sampleCount: number;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRateNet: number | null;
}

export interface BaselineComparisonRow {
  [key: string]: string | number | null;
  exitDay: number;
  metric: string;
  modeValue: number | null;
  baselineValue: number | null;
  deltaModeMinusBaseline: number | null;
  modeCount: number;
  baselineCount: number;
}

export const holdOpenPricePullbackCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),
  informationBoundary: z.object({
    decisionOffsetDays: z.number().int().positive(),
    usesForwardData: z.literal(true),
    forwardDataPurpose: z.string().min(1),
    decisionTimeInformation: z.array(z.string().min(1)),
    postEventResearchOutcome: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  parameters: z.object({
    entryWindowDays: z.number().int().positive(),
    pullbackTriggerBps: z.number().nonnegative(),
    exitDays: z.array(z.number().int().positive()),
    costBps: z.number().nonnegative(),
    excludeOneWordLimitUp: z.boolean(),
  }),
  candidates: z.object({
    datasetEventCount: z.number().int().nonnegative().nullable(),
    scannedRowCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    droppedByMaxEvents: z.number().int().nonnegative(),
    droppedByScanLimit: z.boolean(),
    unscannedEventCount: z.number().int().nonnegative().nullable(),
    duplicateEventIdCount: z.number().int().nonnegative(),
    eventOneWordLimitUpCount: z.number().int().nonnegative(),
    excludedOneWordLimitUpCount: z.number().int().nonnegative(),
  }),
  accounting: z.object({
    breakBeforeEntryCount: z.number().int().nonnegative(),
    noTriggerCount: z.number().int().nonnegative(),
    triggeredCount: z.number().int().nonnegative(),
    entryUnfillableCount: z.number().int().nonnegative(),
    tradeSampleCount: z.number().int().nonnegative(),
  }),
  dataQuality: z.object({
    eventDayBarRowsRead: z.number().int().nonnegative(),
    observationBarRowsRead: z.number().int().nonnegative(),
    missingEventDayBarCount: z.number().int().nonnegative(),
    invalidEventDayCount: z.number().int().nonnegative(),
    missingSignalPathEventCount: z.number().int().nonnegative(),
    invalidSignalPathEventCount: z.number().int().nonnegative(),
  }),
  observations: z.array(
    z.object({
      kind: z.enum(["DESCRIPTIVE", "COMPARATIVE", "POTENTIAL_SIGNAL", "LIMITATION"]),
      text: z.string().min(1),
    }),
  ),
  hypotheses: z.array(
    z.object({
      code: z.string().min(1),
      statement: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
  notes: z.array(z.string().min(1)),
});

export type HoldOpenPricePullbackCustomPayload = z.infer<
  typeof holdOpenPricePullbackCustomPayloadSchema
>;

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

function summarize(values: readonly number[], costBps: number): {
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
  const ci = ci95(net);
  return {
    availableCount: values.length,
    meanGrossReturn: round(mean(values)!),
    medianGrossReturn: round(quantile(sorted, 0.5)!),
    p25GrossReturn: round(quantile(sorted, 0.25)!),
    p75GrossReturn: round(quantile(sorted, 0.75)!),
    meanNetReturn: netMean === null ? null : round(netMean),
    medianNetReturn: round(quantile([...net].sort((a, b) => a - b), 0.5)!),
    winRateNet: round(net.filter((value) => value > 0).length / net.length),
    meanNetCi95Low: ci === null ? null : round(ci.low),
    meanNetCi95High: ci === null ? null : round(ci.high),
  };
}

export function assembleHoldOpenPricePullbackResult(args: {
  entryWindowDays: number;
  pullbackTriggerBps: number;
  exitDays: readonly number[];
  costBps: number;
  excludeOneWordLimitUp: boolean;
  trades: readonly PullbackTradeSample[];
  baselineSamples: readonly BaselineSample[];
  candidateCount: number;
  eligibleCount: number;
  excludedByReason: Record<string, number>;
  datasetEventCount: number | null;
  scannedRowCount: number;
  droppedByMaxEvents: number;
  droppedByScanLimit: boolean;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
  eventOneWordLimitUpCount: number;
  excludedOneWordLimitUpCount: number;
  eventDayBarRowsRead: number;
  observationBarRowsRead: number;
  missingEventDayBarCount: number;
  invalidEventDayCount: number;
  missingSignalPathEventCount: number;
  invalidSignalPathEventCount: number;
  breakBeforeEntryCount: number;
  noTriggerCount: number;
  triggeredCount: number;
  entryUnfillableCount: number;
  triggerCounts: ReadonlyArray<{
    triggerDay: number;
    triggeredCount: number;
    entryUnfillableCount: number;
    enteredCount: number;
  }>;
}): ExperimentResultPayload {
  const triggerDays = Array.from({ length: args.entryWindowDays }, (_, index) => index + 1);
  const performanceRows: TradePerformanceRow[] = [];
  const accountingRows: TriggerAccountingRow[] = [];

  for (const triggerDay of triggerDays) {
    const entryDay = triggerDay + 1;
    const triggerTrades = args.trades.filter((trade) => trade.triggerDay === triggerDay);
    const accounting = args.triggerCounts.find((item) => item.triggerDay === triggerDay);
    accountingRows.push({
      triggerDay,
      entryDay,
      triggeredCount: accounting?.triggeredCount ?? 0,
      entryUnfillableCount: accounting?.entryUnfillableCount ?? 0,
      enteredCount: accounting?.enteredCount ?? 0,
      breakAfterEntryCount: triggerTrades.filter((trade) => trade.breakAfterEntry).length,
    });
    for (const exitDay of args.exitDays) {
      const grouped = triggerTrades.filter((trade) => trade.exitDay === exitDay);
      const values = grouped.map((trade) => trade.grossReturn);
      performanceRows.push({
        triggerDay,
        entryDay,
        exitDay,
        sampleCount: grouped.length,
        ...summarize(values, args.costBps),
        breakAfterEntryCount: grouped.filter((trade) => trade.breakAfterEntry).length,
      });
    }
  }

  const years = [...new Set(args.trades.map((trade) => trade.year))].sort((a, b) => a - b);
  const annualRows: AnnualTradeRow[] = years.flatMap((year) =>
    triggerDays.flatMap((triggerDay) =>
      args.exitDays.map((exitDay) => {
        const values = args.trades
          .filter(
            (trade) =>
              trade.year === year &&
              trade.triggerDay === triggerDay &&
              trade.exitDay === exitDay,
          )
          .map((trade) => trade.grossReturn);
        const stats = summarize(values, args.costBps);
        return {
          year,
          triggerDay,
          exitDay,
          sampleCount: values.length,
          meanNetReturn: stats.meanNetReturn,
          medianNetReturn: stats.medianNetReturn,
          winRateNet: stats.winRateNet,
        };
      }),
    ),
  );

  const modeByExit = new Map<number, TradePerformanceRow>();
  for (const exitDay of args.exitDays) {
    const rows = performanceRows.filter((row) => row.exitDay === exitDay);
    const values = args.trades
      .filter((trade) => trade.exitDay === exitDay)
      .map((trade) => trade.grossReturn);
    modeByExit.set(exitDay, {
      triggerDay: 0,
      entryDay: 0,
      exitDay,
      sampleCount: values.length,
      ...summarize(values, args.costBps),
      breakAfterEntryCount: rows.reduce((sum, row) => sum + row.breakAfterEntryCount, 0),
    });
  }

  const baselineByExit = new Map<number, ReturnType<typeof summarize>>();
  for (const exitDay of args.exitDays) {
    baselineByExit.set(
      exitDay,
      summarize(
        args.baselineSamples
          .filter((sample) => sample.exitDay === exitDay)
          .map((sample) => sample.grossReturn),
        args.costBps,
      ),
    );
  }

  const comparisonRows: BaselineComparisonRow[] = args.exitDays.flatMap((exitDay) => {
    const mode = modeByExit.get(exitDay)!;
    const baseline = baselineByExit.get(exitDay)!;
    const add = (
      metric: string,
      modeValue: number | null,
      baselineValue: number | null,
    ): BaselineComparisonRow => ({
      exitDay,
      metric,
      modeValue,
      baselineValue,
      deltaModeMinusBaseline:
        modeValue === null || baselineValue === null
          ? null
          : round(modeValue - baselineValue),
      modeCount: mode.availableCount,
      baselineCount: baseline.availableCount,
    });
    return [
      add("平均净收益", mode.meanNetReturn, baseline.meanNetReturn),
      add("中位净收益", mode.medianNetReturn, baseline.medianNetReturn),
      add("净收益胜率", mode.winRateNet, baseline.winRateNet),
    ];
  });

  const tradeSampleCount = args.trades.length;
  const positiveMedianCells = performanceRows.filter(
    (row) => row.medianNetReturn !== null && row.medianNetReturn > 0,
  ).length;
  const observations: Array<{ kind: ObservationKind; text: string }> = [
    {
      kind: "DESCRIPTIVE",
      text:
        `首板后 ${args.entryWindowDays} 个交易日内，首次回撤达到 ${args.pullbackTriggerBps} bps（相对首板日收盘）且未跌破首板开盘价的样本 ` +
        `${args.triggeredCount} 个；入场前破位 ${args.breakBeforeEntryCount} 个，未触发回撤 ${args.noTriggerCount} 个，` +
        `触发后次日不可买 ${args.entryUnfillableCount} 个。`,
    },
    {
      kind: "COMPARATIVE",
      text:
        `交易模式样本共 ${tradeSampleCount} 条（事件 × 退出视界）；` +
        `${performanceRows.length} 个触发日 × 退出视界格子中有 ${positiveMedianCells} 个中位净收益为正。`,
    },
    {
      kind: "LIMITATION",
      text: args.excludeOneWordLimitUp
        ? `一字涨停首板已排除：识别 ${args.eventOneWordLimitUpCount} 个，其中 ${args.excludedOneWordLimitUpCount} 个在本轮被剔除。`
        : `本轮未排除一字涨停首板；识别到 ${args.eventOneWordLimitUpCount} 个。`,
    },
    {
      kind: "LIMITATION",
      text:
        "入场固定为首次回撤日的次一交易日开盘；入场前收盘未破首板开盘价不代表开盘前路径不会破位，当前判定按日线 low、open、close 的保守顺序解释。",
    },
    {
      kind: "LIMITATION",
      text:
        "退出使用固定视界收盘；入场后跌破首板开盘价只作事实登记，尚未实现“破位后下一可卖点退出”的完整撮合模型。",
    },
    {
      kind: "LIMITATION",
      text:
        "净收益扣除统一往返成本；未处理公司行为、滑点、冲击成本、整手和部分成交。",
    },
  ];

  const customPayload: HoldOpenPricePullbackCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    informationBoundary: {
      decisionOffsetDays: args.entryWindowDays,
      usesForwardData: true,
      forwardDataPurpose:
        "等待首板后的首次回撤并在次一交易日开盘入场，随后观察固定视界退出收益；未来数据不用于新增候选事件。",
      decisionTimeInformation: [
        "首板日 rd=0 的 open / close 作为回撤和破位基准",
        "rd=1..5 已发生的 low，用于判定首次回撤触发和是否跌破首板开盘价",
        "入场日开盘可交易性字段",
      ],
      postEventResearchOutcome: [
        "入场日开盘到退出日收盘的毛收益与净收益",
        "触发日 / 退出日 / 年度统计与全首板基准比较",
      ],
      notes: [
        "回撤阈值相对首板收盘价定义：low ≤ eventClose × (1 - triggerBps / 10000)。",
        "一旦任一等待日 low < eventOpen，则判定入场前破位，不再入场。",
      ],
    },
    parameters: {
      entryWindowDays: args.entryWindowDays,
      pullbackTriggerBps: args.pullbackTriggerBps,
      exitDays: [...args.exitDays],
      costBps: args.costBps,
      excludeOneWordLimitUp: args.excludeOneWordLimitUp,
    },
    candidates: {
      datasetEventCount: args.datasetEventCount,
      scannedRowCount: args.scannedRowCount,
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      droppedByMaxEvents: args.droppedByMaxEvents,
      droppedByScanLimit: args.droppedByScanLimit,
      unscannedEventCount: args.unscannedEventCount,
      duplicateEventIdCount: args.duplicateEventIdCount,
      eventOneWordLimitUpCount: args.eventOneWordLimitUpCount,
      excludedOneWordLimitUpCount: args.excludedOneWordLimitUpCount,
    },
    accounting: {
      breakBeforeEntryCount: args.breakBeforeEntryCount,
      noTriggerCount: args.noTriggerCount,
      triggeredCount: args.triggeredCount,
      entryUnfillableCount: args.entryUnfillableCount,
      tradeSampleCount,
    },
    dataQuality: {
      eventDayBarRowsRead: args.eventDayBarRowsRead,
      observationBarRowsRead: args.observationBarRowsRead,
      missingEventDayBarCount: args.missingEventDayBarCount,
      invalidEventDayCount: args.invalidEventDayCount,
      missingSignalPathEventCount: args.missingSignalPathEventCount,
      invalidSignalPathEventCount: args.invalidSignalPathEventCount,
    },
    observations,
    hypotheses: [
      {
        code: "H1",
        statement:
          "首板后首次温和回撤且始终未跌破首板开盘价的样本，次日开盘入场后在固定视界内可能优于全首板基准。",
        rationale:
          "该模式把“回撤发生”和“关键支撑未破”同时作为入场前提，并与同一事件的 T+1 开盘入场基准比较。",
      },
    ],
    notes: [
      "本实验只研究交易周期，不自动生成策略、候选或参数最优值。",
      "触发日、退出日只是预定义观察网格，不应被解释为参数寻优结果。",
    ],
  };

  const modeRows = [...modeByExit.values()].map((row) => ({
    exitDay: row.exitDay,
    sampleCount: row.sampleCount,
    availableCount: row.availableCount,
    meanGrossReturn: row.meanGrossReturn,
    medianGrossReturn: row.medianGrossReturn,
    meanNetReturn: row.meanNetReturn,
    medianNetReturn: row.medianNetReturn,
    winRateNet: row.winRateNet,
    breakAfterEntryCount: row.breakAfterEntryCount,
  }));

  return {
    sampleSummary: {
      candidateCount: args.candidateCount,
      eligibleCount: args.eligibleCount,
      excludedCount: args.candidateCount - args.eligibleCount,
      excludedByReason: args.excludedByReason,
      notes: [
        "eligible = 首板日与等待入场窗口 rd=1..5 路径完整的事件；未触发 / 破位仍是 eligible，只影响交易账目。",
        `净收益 = 毛收益 − ${args.costBps} bps 往返成本。`,
      ],
    },
    statistics: [
      {
        code: "triggered_count",
        label: "触发首次回撤事件",
        value: args.triggeredCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "break_before_entry_count",
        label: "入场前跌破首板开盘价",
        value: args.breakBeforeEntryCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "no_trigger_count",
        label: "等待窗口内未触发回撤",
        value: args.noTriggerCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "entry_unfillable_count",
        label: "触发后次日不可买",
        value: args.entryUnfillableCount,
        unit: "个事件",
        digits: 0,
      },
      {
        code: "trade_sample_count",
        label: "交易样本（事件 × 退出视界）",
        value: tradeSampleCount,
        unit: "条",
        digits: 0,
      },
    ],
    tables: [
      {
        key: "trade_performance",
        title: "交易模式收益",
        description:
          "按首次回撤触发日与固定退出日分组；收益从次一交易日开盘到退出日收盘。",
        columns: [
          { key: "triggerDay", label: "回撤触发日", align: "RIGHT" },
          { key: "entryDay", label: "入场日", align: "RIGHT" },
          { key: "exitDay", label: "退出日", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "availableCount", label: "可用", align: "RIGHT" },
          { key: "meanGrossReturn", label: "平均毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianGrossReturn", label: "中位毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "p25GrossReturn", label: "P25", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "p75GrossReturn", label: "P75", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetReturn", label: "平均净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianNetReturn", label: "中位净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "winRateNet", label: "净收益胜率", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetCi95Low", label: "CI95 下界", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetCi95High", label: "CI95 上界", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "breakAfterEntryCount", label: "入场后破位样本", align: "RIGHT" },
        ],
        rows: performanceRows,
      },
      {
        key: "trigger_accounting",
        title: "触发与失效账目",
        description: "每个回撤触发日的事件级账目；不把“未入场”混成 0 收益。",
        columns: [
          { key: "triggerDay", label: "回撤触发日", align: "RIGHT" },
          { key: "entryDay", label: "理论入场日", align: "RIGHT" },
          { key: "triggeredCount", label: "触发", align: "RIGHT" },
          { key: "entryUnfillableCount", label: "不可买", align: "RIGHT" },
          { key: "enteredCount", label: "已入场", align: "RIGHT" },
          { key: "breakAfterEntryCount", label: "入场后破位", align: "RIGHT" },
        ],
        rows: accountingRows,
      },
      {
        key: "mode_vs_baseline",
        title: "交易模式 vs 全首板基准",
        description: "基准 = 同一批事件在 T+1 开盘入场、同一退出日收盘退出。",
        columns: [
          { key: "exitDay", label: "退出日", align: "RIGHT" },
          { key: "metric", label: "指标", align: "LEFT" },
          { key: "modeValue", label: "交易模式", digits: 6, align: "RIGHT" },
          { key: "baselineValue", label: "全首板", digits: 6, align: "RIGHT" },
          { key: "deltaModeMinusBaseline", label: "模式 − 基准", digits: 6, align: "RIGHT" },
          { key: "modeCount", label: "模式样本", align: "RIGHT" },
          { key: "baselineCount", label: "基准样本", align: "RIGHT" },
        ],
        rows: comparisonRows,
      },
      {
        key: "annual_trade_performance",
        title: "分年度交易表现",
        description: "按首板事件年份拆分；不进行年度间显著性判断。",
        columns: [
          { key: "year", label: "年份", align: "RIGHT" },
          { key: "triggerDay", label: "回撤触发日", align: "RIGHT" },
          { key: "exitDay", label: "退出日", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "meanNetReturn", label: "平均净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianNetReturn", label: "中位净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "winRateNet", label: "净收益胜率", unit: "比例", digits: 6, align: "RIGHT" },
        ],
        rows: annualRows,
      },
      {
        key: "mode_overall",
        title: "交易模式总体",
        description: "把所有触发日合并后，按退出日汇总。",
        columns: [
          { key: "exitDay", label: "退出日", align: "RIGHT" },
          { key: "sampleCount", label: "样本", align: "RIGHT" },
          { key: "availableCount", label: "可用", align: "RIGHT" },
          { key: "meanGrossReturn", label: "平均毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianGrossReturn", label: "中位毛收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "meanNetReturn", label: "平均净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "medianNetReturn", label: "中位净收益", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "winRateNet", label: "净收益胜率", unit: "比例", digits: 6, align: "RIGHT" },
          { key: "breakAfterEntryCount", label: "入场后破位", align: "RIGHT" },
        ],
        rows: modeRows,
      },
    ],
    charts: args.exitDays.map((exitDay) => ({
      key: `mode-median-net-exit-${exitDay}`,
      title: `T+${exitDay} 退出 · 按触发日的中位净收益`,
      description: "回撤触发日越早或越晚只是描述性横轴，不代表最佳触发日。",
      kind: "BAR" as const,
      xLabel: "触发日",
      yLabel: "中位净收益",
      unit: "比例",
      series: [
        {
          key: `exit-${exitDay}`,
          label: `T+${exitDay} 退出`,
          points: triggerDays.map((triggerDay) => ({
            x: `T+${triggerDay}`,
            y:
              performanceRows.find(
                (row) => row.triggerDay === triggerDay && row.exitDay === exitDay,
              )?.medianNetReturn ?? null,
          })),
        },
      ],
    })),
    customPayload,
  };
}
