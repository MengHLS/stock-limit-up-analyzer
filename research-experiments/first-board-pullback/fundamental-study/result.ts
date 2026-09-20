/**
 * EXP-001 · 首板后回踩第一性研究 —— 结果结构与组装（`experiment.ts` 的搭档文件）。
 *
 * ## 本实验回答什么
 *
 * 一只股票**首次涨停**（首板）之后，T+1～T+5 的价格路径、回踩行为、回踩深度、
 * **是否跌破首板日开盘价**，以及不同观察 / 入场时点之后的后续表现。
 *
 * ## 口径总纲（全文件唯一口径，改这里就是改全局）
 *
 * | 名字 | 含义 |
 * | --- | --- |
 * | `firstLimitUpOpen` / `firstLimitUpClose` / `firstLimitUpPrice` | 首板日开盘价 / 收盘价 / 涨停价（rd=0 的 open、close 与事件表 `limitUpPrice`） |
 * | `dd`（drawdown） | `(截至某日的最低最低价 − 基准) / 基准`；**负数 = 下跌 / 回撤** |
 * | 全部比率类数值 | **小数比例**（`-0.05 = -5%`），全局统一，**不混用百分数与小数** |
 * | 回踩（当日） | `low_rd < firstLimitUpClose` |
 * | 破位（当日） | `low_rd < firstLimitUpOpen` |
 * | 不破位（截至 T+N） | `min(low_1..low_N) ≥ firstLimitUpOpen` —— **路径条件**，一旦破位不会因为后来涨回来而变回「不破」 |
 * | 样本单位 | **1 个首板事件**（不是「股票一天」） |
 *
 * ## 为什么 schema 与组装放在同一个文件
 *
 * 改「口径」只动 `experiment.ts`，改「怎么呈现」只动本文件与 `page.tsx`；
 * 而 `resultSchema`（本实验自有结果的 zod 校验）与组装函数同处一地 ⇒ **schema 与产物不可能漂移**。
 *
 * 🔴 本文件不得使用任何文件 IO（`readFile*` / `readdir*`）——
 * `tests/server/researchExperiments/manifest.test.ts` 把这条钉成了结构级断言。
 * SVG 图表是**纯字符串拼接**，不落盘（落盘由平台的 ArtifactStorage 负责）。
 */

import { z } from "zod";
import { mean, median, percentile } from "@shared/quant-stats";
import type {
  ExperimentCell,
  ExperimentResultDistribution,
  ExperimentResultPayload,
  ExperimentResultTable,
} from "@shared/researchExperimentsContracts";

// ---------------------------------------------------------------------------
// 0. 版本与常量
// ---------------------------------------------------------------------------

/**
 * 计算口径版本 —— 改动**任何一处计算**都必须升这个值。
 *
 * 🔴 它同时进 `descriptor.version` 与 `customPayload.computationVersion`（后者是 `z.literal`）：
 * 只改一处，`resultSchema` 会立刻校验失败 ⇒「版本与产物必须同步」是结构事实。
 */
export const COMPUTATION_VERSION = "1.0.0";

/**
 * 本实验声明的样本资格信息边界（= `descriptor.datasetRequirement.decisionOffsetDays`）。
 *
 * 语义（与数据集域同源）：判定「截至 T+N 是否跌破首板日开盘价」这类**决策时信息**
 * 只允许使用 rd ∈ [1, d]。`maxObservationDay` 参数的上界派生自它 ——
 * 观察窗口一旦超过这个边界，分组条件就会用上尚未「当时可见」的数据。
 */
export const DECLARED_DECISION_OFFSET_DAYS = 5;

/**
 * 声明要读的 post 相对日（rd ≥ 1）。
 *
 * 🔴「声明面 ⊇ 使用面」在这里是**可执行的不变量**：`futureHorizons` 的上界派生自它，
 * 且 `run()` 会核对「声明的相对日 ⊇ 参数需要的相对日」，缺一天就**响亮失败**而不是静默少读。
 */
export const DECLARED_POST_RELATIVE_DAYS: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1);

/** 最远的 post 相对日（= 声明面容量）。 */
export const MAX_DECLARED_POST_RELATIVE_DAY = DECLARED_POST_RELATIVE_DAYS[DECLARED_POST_RELATIVE_DAYS.length - 1]!;

/** 平台事件扫描安全阀（与 `server/researchExperiments/datasetPort.ts` 一致）。 */
export const PLATFORM_EVENT_SCAN_LIMIT = 20000;

/** 表格显示小数位（比率类；6 位 ≈ 0.0001%）。 */
const DISPLAY_DIGITS = 6;
/** CSV 落盘保留的小数位（比率类）。比显示位多，便于下游复算。 */
const CSV_DIGITS = 10;

/** 数值清洗：非有限数一律 `null`（**禁 0 兜底**）。 */
export function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 按指定小数位收敛（用于表格与 CSV 的确定性输出；`null` 原样透传）。 */
export function roundTo(value: number | null, digits: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// 1. 剔除原因（**闭集**：每条都必须真的会出现，禁臆造）
// ---------------------------------------------------------------------------

/**
 * 剔除原因码 → 人读说明（随结果下发，页面据此翻译 `sampleSummary.excludedByReason`）。
 *
 * 🔴 纪律：这里每一条都对应 `experiment.ts` 里的一处真实判定分支。
 * 不写「可能出现的猜测性原因」—— 臆造的 hint 会把下一次排查带偏。
 */
export const EXCLUSION_REASON_LABELS = {
  MAX_EVENTS_LIMIT: "超出 maxEvents 上限（本次未纳入统计）",
  MISSING_EVENT_DAY_BAR: "缺少首板日（rd=0）行情，无法确定基准价",
  INVALID_EVENT_DAY_OPEN: "首板日开盘价缺失 / 非正 / 非有限",
  INVALID_EVENT_DAY_CLOSE: "首板日收盘价缺失 / 非正 / 非有限",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC 自相矛盾（如 high < low，或 high 低于 open/close）",
  MISSING_LIMIT_UP_PRICE: "缺少首板涨停价（limitUpPrice），无法做「突破涨停价」研究",
  MISSING_OBSERVATION_BAR: "T+1～T+maxObservationDay 之间存在行情缺口（观察窗口不完整）",
  INVALID_OBSERVATION_OHLC: "观察窗口内 OHLC 缺失 / 非正 / 非有限 / 自相矛盾",
} as const;

export type ExclusionReasonCode = keyof typeof EXCLUSION_REASON_LABELS;

/** 闭集校验：未登记的码不得进账（`experiment.ts` 的 `addExclusion()` 会先查这张表）。 */
export function isExclusionReasonCode(code: string): code is ExclusionReasonCode {
  return Object.prototype.hasOwnProperty.call(EXCLUSION_REASON_LABELS, code);
}

// ---------------------------------------------------------------------------
// 2. 观测（Observations）—— 研究观察，**不是** 策略结论
// ---------------------------------------------------------------------------

/**
 * 观测类别（规格 §17）。
 *
 * 🔴 `POTENTIAL_SIGNAL` 仍然只是**研究观察**，不是策略结论、不自动创建 Strategy。
 */
export const OBSERVATION_KINDS = ["DESCRIPTIVE", "COMPARATIVE", "POTENTIAL_SIGNAL", "LIMITATION"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export const observationSchema = z.object({
  kind: z.enum(OBSERVATION_KINDS),
  text: z.string().min(1),
});

// ---------------------------------------------------------------------------
// 3. 自有结果结构（`result.customPayload`）
// ---------------------------------------------------------------------------

/** 某个（事件 × 分组）在某个视界上的分布摘要。 */
const groupOutcomeSchema = z.object({
  horizon: z.number().int(),
  group: z.string().min(1),
  sampleCount: z.number().int().nonnegative(),
  meanFutureCloseReturn: z.number().nullable(),
  medianFutureCloseReturn: z.number().nullable(),
  p25FutureCloseReturn: z.number().nullable(),
  p75FutureCloseReturn: z.number().nullable(),
});

export const fundamentalStudyCustomPayloadSchema = z.object({
  computationVersion: z.literal(COMPUTATION_VERSION),

  /** 本 Run 实际生效的研究范围参数（含从 bps 折算出的比率边界）。 */
  studyWindow: z.object({
    maxObservationDay: z.number().int(),
    futureHorizons: z.array(z.number().int()),
    classificationDay: z.number().int(),
    drawdownBucketEdgesBps: z.array(z.number().int()),
    drawdownBucketEdgesRatio: z.array(z.number()),
    /** 每个分桶的可读标签（与比率边界一一对应，页面/CSV 直接用）。 */
    drawdownBucketLabels: z.array(z.string()),
  }),

  /**
   * 信息边界（规格 §21）—— 明确区分「决策时信息」与「事后研究结果」。
   *
   * 这是本实验最容易被误读的地方：`futureHorizons` 的收益**不能**被当成
   * 「T+N 当时已经知道的信息」，它们只用于**事后描述统计**。
   */
  informationBoundary: z.object({
    decisionOffsetDays: z.number().int(),
    usesForwardData: z.boolean(),
    forwardDataPurpose: z.string(),
    prefixRelativeDaysDeclared: z.array(z.number().int()),
    postRelativeDaysDeclared: z.array(z.number().int()),
    decisionTimeInformation: z.array(z.string()),
    postEventResearchOutcome: z.array(z.string()),
    notes: z.array(z.string()),
  }),

  /** 候选口径（如实：数据集有几个、扫到几个、去重后几个、用了几个、**没扫到几个**）。 */
  candidates: z.object({
    datasetEventCount: z.number().int().nullable(),
    scannedRowCount: z.number().int(),
    candidateCount: z.number().int(),
    usedEventCount: z.number().int(),
    droppedByMaxEvents: z.number().int(),
    droppedByScanLimit: z.boolean(),
    scanLimit: z.number().int(),
    /**
     * 🔴 **账目缺口**：`datasetEventCount − candidateCount`。
     *
     * 平台事件扫描有安全阀（`PLATFORM_EVENT_SCAN_LIMIT`），触顶后本轮只拿到前 N 个事件。
     * 这些没被扫到的事件**既不在 `candidateCount` 里、也不在 `excludedByReason` 里** ——
     * 平台强制的 `eligible + excluded === candidate` 守恒式**天然覆盖不到它们**，
     * 所以必须单独出一个数，否则「数据集 23978 个事件、只统计了 19877 个」会静默变成
     * 「数据就只有 20000 个」，是会被读成事实的假信息（EXP-001 真机 Run 实测踩过）。
     *
     * 只有数据集声明了总数时才有值；为 `null` 表示总数不可知（不是「缺口为 0」）。
     */
    unscannedEventCount: z.number().int().nullable(),
  }),

  /** 数据质量（规格 §22）。 */
  dataQuality: z.object({
    datasetDeclaredTotalEvents: z.number().int().nullable(),
    scannedRowCount: z.number().int(),
    includedCount: z.number().int(),
    excludedCount: z.number().int(),
    excludedByReason: z.record(z.string(), z.number().int().nonnegative()),
    eventDayBarRowsRead: z.number().int(),
    observationBarRowsRead: z.number().int(),
    missingEventDayBarCount: z.number().int(),
    missingObservationBarCount: z.number().int(),
    invalidOhlcBarCount: z.number().int(),
    /** 已在核心研究中、但缺少某些长视界行情的事件数（对应单元格为 `null`，不是剔除）。 */
    insufficientForwardBarsEventCount: z.number().int(),
    duplicateEventIdCount: z.number().int(),
    /** 交叉核对：首板日收盘价与事件表 `limitUpPrice` 不一致的事件数（信息性，不剔除）。 */
    eventDayCloseDiffersFromLimitUpPriceCount: z.number().int(),
    closeMismatchToleranceRatio: z.number(),
  }),

  /** 汇总（规格 §16 Summary）。 */
  summary: z.object({
    sampleCount: z.number().int(),
    validSampleCount: z.number().int(),
    pullbackSampleCount: z.number().int(),
    nonBreakOpenSampleCount: z.number().int(),
    breakOpenSampleCount: z.number().int(),
  }),

  /**
   * 指标（规格 §16 Metrics）—— 全部为小数比例，负数 = 下跌。
   *
   * 🔴 命名刻意把「**当日**」与「**截至**」分开：`breakOpenCount` 是**当日**是否跌破首板日开盘价，
   *    而「不破位」是**路径条件**（截至 T+N 从未跌破）。两者不是互补关系，
   *    混用一个含 `Rate` 的名字会让读者把 0% 读成「没人破位」。
   */
  metrics: z.object({
    finalObservationDay: z.number().int(),
    /** 当日回踩率：分类日**当天**最低价 < 首板日收盘价的样本占比。 */
    pullbackRateOnFinalDay: z.number().nullable(),
    /** 当日破位率：分类日**当天**最低价 < 首板日开盘价的样本占比。 */
    breakOpenRateOnFinalDay: z.number().nullable(),
    /** 截至分类日未破位率（**路径条件**）：T+1…T+分类日 从未跌破首板日开盘价。 */
    nonBreakOpenRateThroughFinalDay: z.number().nullable(),
    /** 截至分类日曾破位率 = 1 − 未破位率。 */
    breakOpenRateThroughFinalDay: z.number().nullable(),
    meanDrawdownFromCloseThroughFinalDay: z.number().nullable(),
    medianDrawdownFromCloseThroughFinalDay: z.number().nullable(),
    meanDrawdownFromOpenThroughFinalDay: z.number().nullable(),
    medianDrawdownFromOpenThroughFinalDay: z.number().nullable(),
    /** 分类日当天的收盘收益（锚 = 首板日收盘价）。 */
    medianCloseReturnOnFinalDay: z.number().nullable(),
    groupOutcomes: z.array(groupOutcomeSchema),
  }),

  /** 剔除原因码 → 人读说明（页面据此翻译）。 */
  exclusionReasonLabels: z.record(z.string(), z.string()),

  /** 研究观察（**由本 Run 的计算结果生成**，不是模板文案）。 */
  observations: z.array(observationSchema),

  /** 待验证的策略假设（规格 §27）—— 只是假设，不自动创建 Strategy。 */
  potentialStrategyHypotheses: z.array(
    z.object({
      code: z.string().min(1),
      statement: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),

  /** 口径与偏差的显式登记（不藏）。 */
  selectionNotes: z.array(z.string()),
});

export type FundamentalStudyCustomPayload = z.infer<typeof fundamentalStudyCustomPayloadSchema>;

// ---------------------------------------------------------------------------
// 4. 纯计算层
// ---------------------------------------------------------------------------

/** 一根行情（已校验为有限正数）。 */
export interface StudyBar {
  relativeDay: number;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 一个入池样本（1 个首板事件 + 其可用的 T+1… 路径）。 */
export interface StudySample {
  eventId: string;
  symbol: string;
  eventDate: string;
  firstLimitUpOpen: number;
  firstLimitUpClose: number;
  firstLimitUpPrice: number;
  /** rd ∈ [1, maxAvailableRelativeDay] 的行情，按 rd 升序，逐根已校验。 */
  bars: StudyBar[];
  maxAvailableRelativeDay: number;
}

/** OHLC 自洽性判定（缺失 / 非有限 / 非正 / 高低倒挂都算非法）。 */
export function isValidOhlc(bar: {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}): boolean {
  const { open, high, low, close } = bar;
  if (open === null || high === null || low === null || close === null) return false;
  for (const value of [open, high, low, close]) {
    if (!Number.isFinite(value) || value <= 0) return false;
  }
  if (high < low) return false;
  if (high < open || high < close) return false;
  if (low > open || low > close) return false;
  return true;
}

/** 取事件日之后第 `rd` 天之后（含）的基准派生量。 */
function lowReturnFrom(bar: StudyBar, base: number): number {
  return (bar.low - base) / base;
}
function closeReturnFrom(bar: StudyBar, base: number): number {
  return (bar.close - base) / base;
}

/** `rd ∈ [from, to]` 的连续窗口；任一天缺失 ⇒ `null`（**禁止跳洞取数**）。 */
export function contiguousWindow(
  index: ReadonlyMap<number, StudyBar>,
  from: number,
  to: number,
): StudyBar[] | null {
  const out: StudyBar[] = [];
  for (let day = from; day <= to; day += 1) {
    const bar = index.get(day);
    if (bar === undefined) return null;
    out.push(bar);
  }
  return out;
}

/** 每个样本在「参数给定的研究范围」下的全部派生量（一次算好，所有表共用）。 */
export interface SampleDerived {
  sample: StudySample;
  /** 逐观察日（N ∈ 1..maxObservationDay）。 */
  byDay: Array<{
    relativeDay: number;
    tradeDate: string;
    lowReturnFromClose: number;
    highReturnFromClose: number;
    closeReturnFromClose: number;
    /** 当日最低价 < 首板日收盘价。 */
    pullbackBelowClose: boolean;
    /** 当日最低价 < 首板日开盘价。 */
    breakBelowOpen: boolean;
    /** min(low_1..low_N)。 */
    cumulativeLow: number;
    /** (min(low_1..low_N) − firstLimitUpClose) / firstLimitUpClose —— 负数 = 回撤。 */
    drawdownFromClose: number;
    /** (min(low_1..low_N) − firstLimitUpOpen) / firstLimitUpOpen —— 负数 = 回撤。 */
    drawdownFromOpen: number;
    /** 路径条件：截至 T+N 从未跌破首板日开盘价。 */
    nonBreakOpen: boolean;
  }>;
  /** 逐视界（事件日锚定，h ∈ futureHorizons）。 */
  byHorizon: Map<
    number,
    {
      available: boolean;
      barCount: number;
      futureHighReturnFromClose: number | null;
      futureLowReturnFromClose: number | null;
      futureCloseReturnFromClose: number | null;
      mfeFromClose: number | null;
      maeFromClose: number | null;
      breakoutVsClose: boolean;
      breakoutVsLimitUpPrice: boolean;
      timeToBreakoutVsClose: number | null;
      timeToBreakoutVsLimitUpPrice: number | null;
    }
  >;
  /** 逐入场日（k ∈ 1..maxObservationDay）。 */
  byEntryDay: Map<
    number,
    {
      entryRelativeDay: number;
      entryOpen: number;
      windowEndRelativeDay: number | null;
      windowBarCount: number;
      /** 决策时条件：min(low_1..low_{k−1}) ≥ firstLimitUpOpen（k=1 时路径为空 ⇒ 车空成立）。 */
      nonBreakOpenBeforeEntry: boolean;
      /** relativeDay → 收益（`null` = 该视界超出数据容量或路径有缺口）。 */
      nextReturnByHorizon: Map<number, number | null>;
      futureHighReturnFromEntry: number | null;
      futureLowReturnFromEntry: number | null;
      mfeFromEntry: number | null;
      maeFromEntry: number | null;
    }
  >;
}

/** 计算一个样本的全部派生量。 */
export function deriveSample(
  sample: StudySample,
  params: { maxObservationDay: number; futureHorizons: readonly number[] },
): SampleDerived {
  const index = new Map<number, StudyBar>();
  for (const bar of sample.bars) index.set(bar.relativeDay, bar);

  const close0 = sample.firstLimitUpClose;
  const open0 = sample.firstLimitUpOpen;

  // ---- 逐观察日 ----
  const byDay: SampleDerived["byDay"] = [];
  let runningLow = Number.POSITIVE_INFINITY;
  for (let day = 1; day <= params.maxObservationDay; day += 1) {
    const bar = index.get(day);
    // 样本资格已保证 1..maxObservationDay 齐备；这里仍显式判定（防御 + 可测）。
    if (bar === undefined) break;
    runningLow = Math.min(runningLow, bar.low);
    byDay.push({
      relativeDay: day,
      tradeDate: bar.tradeDate,
      lowReturnFromClose: lowReturnFrom(bar, close0),
      highReturnFromClose: (bar.high - close0) / close0,
      closeReturnFromClose: closeReturnFrom(bar, close0),
      pullbackBelowClose: bar.low < close0,
      breakBelowOpen: bar.low < open0,
      cumulativeLow: runningLow,
      drawdownFromClose: (runningLow - close0) / close0,
      drawdownFromOpen: (runningLow - open0) / open0,
      nonBreakOpen: runningLow >= open0,
    });
  }

  // ---- 逐视界（事件日锚定）----
  const byHorizon: SampleDerived["byHorizon"] = new Map();
  for (const horizon of params.futureHorizons) {
    const window = contiguousWindow(index, 1, horizon);
    if (window === null) {
      byHorizon.set(horizon, {
        available: false,
        barCount: 0,
        futureHighReturnFromClose: null,
        futureLowReturnFromClose: null,
        futureCloseReturnFromClose: null,
        mfeFromClose: null,
        maeFromClose: null,
        breakoutVsClose: false,
        breakoutVsLimitUpPrice: false,
        timeToBreakoutVsClose: null,
        timeToBreakoutVsLimitUpPrice: null,
      });
      continue;
    }
    let highest = Number.NEGATIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;
    let firstAboveClose: number | null = null;
    let firstAboveLimitUp: number | null = null;
    for (const bar of window) {
      highest = Math.max(highest, bar.high);
      lowest = Math.min(lowest, bar.low);
      if (firstAboveClose === null && bar.high > close0) firstAboveClose = bar.relativeDay;
      if (firstAboveLimitUp === null && bar.high > sample.firstLimitUpPrice) {
        firstAboveLimitUp = bar.relativeDay;
      }
    }
    const lastBar = window[window.length - 1]!;
    byHorizon.set(horizon, {
      available: true,
      barCount: window.length,
      futureHighReturnFromClose: (highest - close0) / close0,
      futureLowReturnFromClose: (lowest - close0) / close0,
      futureCloseReturnFromClose: closeReturnFrom(lastBar, close0),
      // 🔴 MFE / MAE 与「首板日收盘价锚定」下的 high/low 收益**在数学上恒等**
      //    （同一个锚、同一个窗口）—— 这里刻意都给出，并在口径说明里点明这层恒等关系，
      //    避免读者以为是两个独立指标。真正与它们不同的那组 MFE/MAE 在**入场日视角**
      //    （锚 = 入场日开盘价），见 `byEntryDay`。
      mfeFromClose: (highest - close0) / close0,
      maeFromClose: (lowest - close0) / close0,
      breakoutVsClose: firstAboveClose !== null,
      breakoutVsLimitUpPrice: firstAboveLimitUp !== null,
      timeToBreakoutVsClose: firstAboveClose,
      timeToBreakoutVsLimitUpPrice: firstAboveLimitUp,
    });
  }

  // ---- 逐入场日 ----
  const maxHorizon = params.futureHorizons.reduce((acc, h) => Math.max(acc, h), 1);
  const byEntryDay: SampleDerived["byEntryDay"] = new Map();
  for (let entry = 1; entry <= params.maxObservationDay; entry += 1) {
    const entryBar = index.get(entry);
    if (entryBar === undefined) break;
    const entryOpen = entryBar.open;

    // 决策时条件：入场前（rd 1..entry-1）是否始终未跌破首板日开盘价。
    // entry = 1 时路径为空 ⇒ 车空成立（**这是定义的结果，不是研究发现**，已登记为 LIMITATION）。
    let beforeLow = Number.POSITIVE_INFINITY;
    for (let day = 1; day <= entry - 1; day += 1) {
      const bar = index.get(day);
      if (bar === undefined) break;
      beforeLow = Math.min(beforeLow, bar.low);
    }
    const nonBreakOpenBeforeEntry = beforeLow === Number.POSITIVE_INFINITY ? true : beforeLow >= open0;

    // 未来窗口 = rd ∈ [entry, min(entry + maxHorizon, 可用最远 rd)]，并且必须连续。
    const requestedEnd = Math.min(entry + maxHorizon, MAX_DECLARED_POST_RELATIVE_DAY);
    const window = contiguousWindow(index, entry, requestedEnd);
    const windowEnd = window === null ? null : window[window.length - 1]!.relativeDay;

    let futureHigh: number | null = null;
    let futureLow: number | null = null;
    if (window !== null && window.length > 0) {
      let highest = Number.NEGATIVE_INFINITY;
      let lowest = Number.POSITIVE_INFINITY;
      for (const bar of window) {
        highest = Math.max(highest, bar.high);
        lowest = Math.min(lowest, bar.low);
      }
      futureHigh = (highest - entryOpen) / entryOpen;
      futureLow = (lowest - entryOpen) / entryOpen;
    }

    const nextReturnByHorizon = new Map<number, number | null>();
    for (const horizon of params.futureHorizons) {
      const target = entry + horizon;
      // 需要 rd entry+1..target 全部存在（入场在 T+entry 开盘，收益锚 = 该日收盘）。
      const forward = contiguousWindow(index, entry + 1, target);
      const targetBar = forward === null ? undefined : forward[forward.length - 1];
      nextReturnByHorizon.set(
        horizon,
        targetBar === undefined || targetBar === null ? null : (targetBar.close - entryOpen) / entryOpen,
      );
    }

    byEntryDay.set(entry, {
      entryRelativeDay: entry,
      entryOpen,
      windowEndRelativeDay: windowEnd,
      windowBarCount: window === null ? 0 : window.length,
      nonBreakOpenBeforeEntry,
      nextReturnByHorizon,
      futureHighReturnFromEntry: futureHigh,
      futureLowReturnFromEntry: futureLow,
      // MFE / MAE 锚 = 入场日开盘价（窗口含入场日当日：入场后的当日高低点仍然发生在入场之后）。
      mfeFromEntry: futureHigh,
      maeFromEntry: futureLow,
    });
  }

  return { sample, byDay, byHorizon, byEntryDay };
}

// ---------------------------------------------------------------------------
// 5. 分桶（研究观察桶，**不是**参数寻优）
// ---------------------------------------------------------------------------

/** 分桶定义（与 `customPayload.studyWindow` 一起下发，规则必须可复核）。 */
export interface DrawdownBucket {
  code: string;
  label: string;
  /** `null` = 无下界（最后一桶）。 */
  lowerBound: number | null;
  /** `null` = 无上界（NO_PULLBACK 桶）。 */
  upperBound: number | null;
  test: (value: number) => boolean;
}

/**
 * 从 bps 边界构造分桶（规格 §14）。
 *
 * 输入边界必须**严格递减**、首项为 0、全部 ≤ 0；构造出的桶**互不重叠且完全覆盖**：
 * ```
 * NO_PULLBACK        : dd ≥ 0
 * B1                 : e1 ≤ dd < e0
 * …
 * Bn                 : dd < e_{n-1}
 * ```
 * 抛错而不是「容错」：分桶边界写错会让「回撤深度 → 后续表现」的整张表失去意义。
 */
export function buildDrawdownBuckets(edgesBps: readonly number[]): {
  edgesRatio: number[];
  buckets: DrawdownBucket[];
} {
  if (edgesBps.length < 2) {
    throw new Error(`drawdownBucketEdgesBps 至少需要 2 个边界（含 0），实际 ${edgesBps.length} 个`);
  }
  if (edgesBps[0] !== 0) {
    throw new Error(`drawdownBucketEdgesBps 的第 1 项必须是 0（回撤的零点），实际 ${String(edgesBps[0])}`);
  }
  for (let i = 0; i < edgesBps.length; i += 1) {
    const value = edgesBps[i]!;
    if (!Number.isInteger(value)) throw new Error(`drawdownBucketEdgesBps[${i}] = ${value} 必须是整数（单位：基点）`);
    if (value > 0) throw new Error(`drawdownBucketEdgesBps[${i}] = ${value} 必须 ≤ 0（负 = 回撤）`);
    if (value < -10000) throw new Error(`drawdownBucketEdgesBps[${i}] = ${value} 超出下界 -10000（-100%）`);
    if (i > 0 && !(value < edgesBps[i - 1]!)) {
      throw new Error(
        `drawdownBucketEdgesBps 必须严格递减：第 ${i} 项 ${value} 未小于第 ${i - 1} 项 ${String(edgesBps[i - 1])}`,
      );
    }
  }

  const edgesRatio = edgesBps.map((bps) => bps / 10000);
  const percent = (ratio: number): string => {
    const value = ratio * 100;
    return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
  };

  const buckets: DrawdownBucket[] = [
    {
      code: "NO_PULLBACK",
      label: `未回踩（dd ≥ 0，即全程最低价 ≥ 首板日收盘价）`,
      lowerBound: 0,
      upperBound: null,
      test: (value) => value >= 0,
    },
  ];
  for (let i = 1; i < edgesRatio.length; i += 1) {
    const upper = edgesRatio[i - 1]!;
    const lower = edgesRatio[i]!;
    buckets.push({
      code: `DD_${Math.abs(edgesBps[i]!)}BP`,
      label: `${percent(lower)} ≤ dd < ${percent(upper)}`,
      lowerBound: lower,
      upperBound: upper,
      test: (value) => value >= lower && value < upper,
    });
  }
  const last = edgesRatio[edgesRatio.length - 1]!;
  buckets.push({
    code: `DD_BELOW_${Math.abs(edgesBps[edgesBps.length - 1]!)}BP`,
    label: `dd < ${percent(last)}`,
    lowerBound: null,
    upperBound: last,
    test: (value) => value < last,
  });

  return { edgesRatio, buckets };
}

/**
 * 分桶的**紧凑标签**（给图表横轴用）。从权威边界派生，不复制第二套边界数值：
 * `未回踩` / `-2%~0%` / `<-10%`。
 */
export function shortBucketLabel(bucket: DrawdownBucket): string {
  const one = (ratio: number): string => {
    const value = ratio * 100;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
  };
  if (bucket.lowerBound !== null && bucket.upperBound === null) return "未回踩";
  if (bucket.upperBound !== null && bucket.lowerBound === null) return `<${one(bucket.upperBound)}`;
  return `${one(bucket.lowerBound!)}~${one(bucket.upperBound!)}`;
}

// ---------------------------------------------------------------------------
// 6. 汇总（表格的数据源 —— 表格、图表、CSV **同源**）
// ---------------------------------------------------------------------------

/** 表格列定义（同时用于信封 `tables[].columns` 与 CSV 表头）。 */
export interface StudyTableColumn {
  key: string;
  label: string;
  unit?: string;
  digits?: number;
  align: "LEFT" | "RIGHT";
}

/** 一张研究表（机器可读行 + 列定义）。 */
export interface StudyTable {
  key: string;
  title: string;
  description: string;
  columns: StudyTableColumn[];
  rows: Array<Record<string, ExperimentCell>>;
}

const RATIO_UNIT = "比例";

function ratioColumn(key: string, label: string): StudyTableColumn {
  return { key, label, unit: RATIO_UNIT, digits: DISPLAY_DIGITS, align: "RIGHT" };
}
function intColumn(key: string, label: string): StudyTableColumn {
  return { key, label, align: "RIGHT" };
}
function textColumn(key: string, label: string): StudyTableColumn {
  return { key, label, align: "LEFT" };
}

function collect(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

/** 表 1 · `daily_path_by_relative_day`（规格 §10：分布而不是单一平均数）。 */
export function summarizeDailyPath(
  derived: readonly SampleDerived[],
  maxObservationDay: number,
): StudyTable {
  const rows: Array<Record<string, ExperimentCell>> = [];
  for (let day = 1; day <= maxObservationDay; day += 1) {
    const slices = derived
      .map((item) => item.byDay.find((d) => d.relativeDay === day))
      .filter((value): value is SampleDerived["byDay"][number] => value !== undefined);
    const sampleCount = slices.length;
    const lowReturns = collect(slices.map((s) => s.lowReturnFromClose));
    const closeReturns = collect(slices.map((s) => s.closeReturnFromClose));
    const drawdownsFromClose = collect(slices.map((s) => s.drawdownFromClose));
    const drawdownsFromOpen = collect(slices.map((s) => s.drawdownFromOpen));
    const pullbackCount = slices.filter((s) => s.pullbackBelowClose).length;
    const breakOpenCount = slices.filter((s) => s.breakBelowOpen).length;
    const nonBreakCount = slices.filter((s) => s.nonBreakOpen).length;
    rows.push({
      relativeDay: `T+${day}`,
      sampleCount,
      validCount: sampleCount,
      pullbackCount,
      pullbackRate: sampleCount === 0 ? null : pullbackCount / sampleCount,
      breakOpenCount,
      breakOpenRate: sampleCount === 0 ? null : breakOpenCount / sampleCount,
      nonBreakOpenCount: nonBreakCount,
      nonBreakOpenRate: sampleCount === 0 ? null : nonBreakCount / sampleCount,
      averageLowReturn: mean(lowReturns),
      medianLowReturn: median(lowReturns),
      p25LowReturn: percentile(lowReturns, 25),
      p75LowReturn: percentile(lowReturns, 75),
      averageCloseReturn: mean(closeReturns),
      medianCloseReturn: median(closeReturns),
      p25CloseReturn: percentile(closeReturns, 25),
      p75CloseReturn: percentile(closeReturns, 75),
      meanCumulativeDrawdownFromClose: mean(drawdownsFromClose),
      medianCumulativeDrawdownFromClose: median(drawdownsFromClose),
      meanCumulativeDrawdownFromOpen: mean(drawdownsFromOpen),
      medianCumulativeDrawdownFromOpen: median(drawdownsFromOpen),
      nonBreakOpenRateCumulative: sampleCount === 0 ? null : nonBreakCount / sampleCount,
    });
  }
  return {
    key: "daily_path_by_relative_day",
    title: "逐观察日路径（T+1 … T+maxObservationDay）",
    description:
      "回踩 = 当日最低价 < 首板日收盘价；破位 = 当日最低价 < 首板日开盘价；" +
      "不破位（截至 T+N）= T+1…T+N 的最低价始终 ≥ 首板日开盘价（**路径条件**，破位后再涨回不算不破）。" +
      "drawdown = (截至 T+N 的最低最低价 − 基准) / 基准，**负数 = 回撤**。全部比率类为小数比例。",
    columns: [
      textColumn("relativeDay", "相对日"),
      intColumn("sampleCount", "样本数"),
      intColumn("validCount", "有效数"),
      intColumn("pullbackCount", "当日回踩数"),
      ratioColumn("pullbackRate", "当日回踩率"),
      intColumn("breakOpenCount", "当日破位数"),
      ratioColumn("breakOpenRate", "当日破位率"),
      intColumn("nonBreakOpenCount", "不破位数(截至)"),
      ratioColumn("nonBreakOpenRate", "不破位率(截至)"),
      ratioColumn("averageLowReturn", "平均最低价收益"),
      ratioColumn("medianLowReturn", "中位最低价收益"),
      ratioColumn("p25LowReturn", "P25 最低价收益"),
      ratioColumn("p75LowReturn", "P75 最低价收益"),
      ratioColumn("averageCloseReturn", "平均收盘收益"),
      ratioColumn("medianCloseReturn", "中位收盘收益"),
      ratioColumn("p25CloseReturn", "P25 收盘收益"),
      ratioColumn("p75CloseReturn", "P75 收盘收益"),
      ratioColumn("meanCumulativeDrawdownFromClose", "平均累计回撤(对收盘价)"),
      ratioColumn("medianCumulativeDrawdownFromClose", "中位累计回撤(对收盘价)"),
      ratioColumn("meanCumulativeDrawdownFromOpen", "平均累计回撤(对开盘价)"),
      ratioColumn("medianCumulativeDrawdownFromOpen", "中位累计回撤(对开盘价)"),
    ],
    rows,
  };
}

export type StudyGroupCode = "ALL" | "NON_BREAK_OPEN" | "BREAK_OPEN";
const GROUP_CODES: readonly StudyGroupCode[] = ["ALL", "NON_BREAK_OPEN", "BREAK_OPEN"];

function matchesGroup(day: SampleDerived["byDay"][number] | undefined, group: StudyGroupCode): boolean {
  if (day === undefined) return false;
  if (group === "ALL") return true;
  return group === "NON_BREAK_OPEN" ? day.nonBreakOpen : !day.nonBreakOpen;
}

/** 表 2 · `non_break_vs_break`（规格 §11：ALL / NON_BREAK_OPEN / BREAK_OPEN）。 */
export function summarizeNonBreakVsBreak(
  derived: readonly SampleDerived[],
  maxObservationDay: number,
): StudyTable {
  const rows: Array<Record<string, ExperimentCell>> = [];
  for (let day = 1; day <= maxObservationDay; day += 1) {
    const allCount = derived.length;
    for (const group of GROUP_CODES) {
      const members = derived.filter((item) => {
        const slice = item.byDay.find((d) => d.relativeDay === day);
        return slice !== undefined && matchesGroup(slice, group);
      });
      const drawdownsFromClose = collect(members.map((m) => m.byDay.find((d) => d.relativeDay === day)!.drawdownFromClose));
      const drawdownsFromOpen = collect(members.map((m) => m.byDay.find((d) => d.relativeDay === day)!.drawdownFromOpen));
      const lowestLowReturns = collect(
        members.map((m) => m.byDay.find((d) => d.relativeDay === day)!.lowReturnFromClose),
      );
      rows.push({
        classificationDay: `T+${day}`,
        group,
        sampleCount: members.length,
        groupShare: allCount === 0 ? null : members.length / allCount,
        meanCumulativeDrawdownFromClose: mean(drawdownsFromClose),
        medianCumulativeDrawdownFromClose: median(drawdownsFromClose),
        meanCumulativeDrawdownFromOpen: mean(drawdownsFromOpen),
        medianCumulativeDrawdownFromOpen: median(drawdownsFromOpen),
        meanLowReturnOnDay: mean(lowestLowReturns),
      });
    }
  }
  return {
    key: "non_break_vs_break",
    title: "不破 / 破位分组（按观察日分类）",
    description:
      "NON_BREAK_OPEN = 截至该观察日 T+1…T+N 的最低最低价 ≥ 首板日开盘价；BREAK_OPEN = 期间曾跌破。" +
      "「不破」是路径条件 —— 后来涨回来不会把已破位的样本改回不破组。groupShare = 该组样本 / 全部样本。",
    columns: [
      textColumn("classificationDay", "分类观察日"),
      textColumn("group", "分组"),
      intColumn("sampleCount", "样本数"),
      ratioColumn("groupShare", "占比"),
      ratioColumn("meanCumulativeDrawdownFromClose", "平均累计回撤(对收盘价)"),
      ratioColumn("medianCumulativeDrawdownFromClose", "中位累计回撤(对收盘价)"),
      ratioColumn("meanCumulativeDrawdownFromOpen", "平均累计回撤(对开盘价)"),
      ratioColumn("medianCumulativeDrawdownFromOpen", "中位累计回撤(对开盘价)"),
      ratioColumn("meanLowReturnOnDay", "当日平均最低价收益"),
    ],
    rows,
  };
}

/** 表 3 · `drawdown_buckets`（规格 §14）。 */
export function summarizeDrawdownBuckets(
  derived: readonly SampleDerived[],
  buckets: readonly DrawdownBucket[],
  classificationDay: number,
  futureHorizons: readonly number[],
): StudyTable {
  const scored = derived
    .map((item) => item.byDay.find((d) => d.relativeDay === classificationDay))
    .filter((value): value is SampleDerived["byDay"][number] => value !== undefined);

  const membersOf = (bucket: DrawdownBucket): SampleDerived[] =>
    derived.filter((item) => {
      const slice = item.byDay.find((d) => d.relativeDay === classificationDay);
      return slice !== undefined && bucket.test(slice.drawdownFromClose);
    });

  const rows: Array<Record<string, ExperimentCell>> = buckets.map((bucket) => {
    const members = membersOf(bucket);
    const row: Record<string, ExperimentCell> = {
      bucket: bucket.code,
      bucketLabel: bucket.label,
      bucketShort: shortBucketLabel(bucket),
      lowerBound: bucket.lowerBound,
      upperBound: bucket.upperBound,
      sampleCount: members.length,
      share: scored.length === 0 ? null : members.length / scored.length,
    };
    for (const horizon of futureHorizons) {
      const returns = collect(
        members.map((m) => m.byHorizon.get(horizon)?.futureCloseReturnFromClose ?? null),
      );
      row[`meanFutureCloseReturn_T${horizon}`] = mean(returns);
      row[`medianFutureCloseReturn_T${horizon}`] = median(returns);
    }
    return row;
  });

  const columns: StudyTableColumn[] = [
    textColumn("bucket", "分桶"),
    textColumn("bucketLabel", "区间"),
    textColumn("bucketShort", "区间(简)"),
    ratioColumn("lowerBound", "下界（含）"),
    ratioColumn("upperBound", "上界（不含）"),
    intColumn("sampleCount", "样本数"),
    ratioColumn("share", "占比"),
  ];
  for (const horizon of futureHorizons) {
    columns.push(ratioColumn(`meanFutureCloseReturn_T${horizon}`, `T+${horizon} 平均收盘收益`));
    columns.push(ratioColumn(`medianFutureCloseReturn_T${horizon}`, `T+${horizon} 中位收盘收益`));
  }

  return {
    key: "drawdown_buckets",
    title: `回撤深度分桶（截至 T+${classificationDay}，对首板日收盘价）`,
    description:
      "分桶是**研究观察桶**，不是参数寻优；边界来自 Run 参数（基点），规则在下界含、上界不含。" +
      "NO_PULLBACK = 全程最低价 ≥ 首板日收盘价。后续收益以首板日收盘价为锚（事后研究结果）。",
    columns,
    rows,
  };
}

/** 表 4 · `entry_day_comparison`（规格 §15）。 */
export function summarizeEntryDay(
  derived: readonly SampleDerived[],
  maxObservationDay: number,
  futureHorizons: readonly number[],
): StudyTable {
  const rows: Array<Record<string, ExperimentCell>> = [];
  for (let entry = 1; entry <= maxObservationDay; entry += 1) {
    const slices = derived
      .map((item) => item.byEntryDay.get(entry))
      .filter((value): value is NonNullable<ReturnType<SampleDerived["byEntryDay"]["get"]>> => value !== undefined);
    const sampleCount = slices.length;
    const nonBreakCount = slices.filter((s) => s.nonBreakOpenBeforeEntry).length;
    const row: Record<string, ExperimentCell> = {
      entryDay: `T+${entry}`,
      sampleCount,
      nonBreakOpenCount: nonBreakCount,
      nonBreakOpenRate: sampleCount === 0 ? null : nonBreakCount / sampleCount,
      windowEndRelativeDay: slices[0]?.windowEndRelativeDay ?? null,
      meanWindowBarCount: mean(slices.map((s) => s.windowBarCount)),
      meanFutureHighReturnFromEntry: mean(collect(slices.map((s) => s.futureHighReturnFromEntry))),
      meanFutureLowReturnFromEntry: mean(collect(slices.map((s) => s.futureLowReturnFromEntry))),
      meanMfeFromEntry: mean(collect(slices.map((s) => s.mfeFromEntry))),
      meanMaeFromEntry: mean(collect(slices.map((s) => s.maeFromEntry))),
    };
    for (const horizon of futureHorizons) {
      const values = collect(slices.map((s) => s.nextReturnByHorizon.get(horizon) ?? null));
      const availableCount = slices.filter((s) => (s.nextReturnByHorizon.get(horizon) ?? null) !== null).length;
      row[`meanNext${horizon}TradingDayReturn`] = mean(values);
      row[`medianNext${horizon}TradingDayReturn`] = median(values);
      row[`availableCountNext${horizon}`] = availableCount;
    }
    rows.push(row);
  }

  const columns: StudyTableColumn[] = [
    textColumn("entryDay", "入场日"),
    intColumn("sampleCount", "样本数"),
    intColumn("nonBreakOpenCount", "入场前未破位数"),
    ratioColumn("nonBreakOpenRate", "入场前未破位率"),
    textColumn("windowEndRelativeDay", "未来窗口止于"),
    intColumn("meanWindowBarCount", "平均窗口 K 线数"),
    ratioColumn("meanFutureHighReturnFromEntry", "平均最高价收益(自入场价)"),
    ratioColumn("meanFutureLowReturnFromEntry", "平均最低价收益(自入场价)"),
    ratioColumn("meanMfeFromEntry", "平均 MFE(自入场价)"),
    ratioColumn("meanMaeFromEntry", "平均 MAE(自入场价)"),
  ];
  for (const horizon of futureHorizons) {
    columns.push(intColumn(`availableCountNext${horizon}`, `next${horizon} 可用样本`));
    columns.push(ratioColumn(`meanNext${horizon}TradingDayReturn`, `next${horizon} 平均收益`));
    columns.push(ratioColumn(`medianNext${horizon}TradingDayReturn`, `next${horizon} 中位收益`));
  }

  return {
    key: "entry_day_comparison",
    title: "入场日视角（把 T+k 当作观察 / 入场点）",
    description:
      "入场价 = T+k 开盘价；收益 = T+(k+h) 收盘 / T+k 开盘 − 1（需要 rd k+1…k+h 全部存在，否则为 null）。" +
      "入场前未破位 = min(low_1…low_{k−1}) ≥ 首板日开盘价 —— **只用入场前可见的路径**（决策时信息）。" +
      "MFE / MAE = 入场后窗口内最高 / 最低价相对入场价，窗口含入场日当日。" +
      "**本表不做最优入场日选择**：它只描述「若以该日入场，后续分布如何」。",
    columns,
    rows,
  };
}

/** 表 5 · `future_horizon_comparison`（规格 §12 / §13）。 */
export function summarizeFutureHorizons(
  derived: readonly SampleDerived[],
  horizons: readonly number[],
  classificationDay: number,
): StudyTable {
  const rows: Array<Record<string, ExperimentCell>> = [];
  for (const horizon of horizons) {
    for (const group of GROUP_CODES) {
      const members = derived.filter((item) => {
        const slice = item.byDay.find((d) => d.relativeDay === classificationDay);
        return slice !== undefined && matchesGroup(slice, group) && item.byHorizon.get(horizon)?.available === true;
      });
      const cells = members.map((m) => m.byHorizon.get(horizon)!);
      const closeReturns = collect(cells.map((c) => c.futureCloseReturnFromClose));
      const highReturns = collect(cells.map((c) => c.futureHighReturnFromClose));
      const lowReturns = collect(cells.map((c) => c.futureLowReturnFromClose));
      const breakoutClose = cells.filter((c) => c.breakoutVsClose).length;
      const breakoutLimitUp = cells.filter((c) => c.breakoutVsLimitUpPrice).length;
      rows.push({
        horizon: `T+${horizon}`,
        group,
        sampleCount: members.length,
        validCount: members.length,
        meanFutureCloseReturn: mean(closeReturns),
        medianFutureCloseReturn: median(closeReturns),
        p25FutureCloseReturn: percentile(closeReturns, 25),
        p75FutureCloseReturn: percentile(closeReturns, 75),
        meanFutureHighReturn: mean(highReturns),
        medianFutureHighReturn: median(highReturns),
        meanFutureLowReturn: mean(lowReturns),
        medianFutureLowReturn: median(lowReturns),
        meanMfe: mean(collect(cells.map((c) => c.mfeFromClose))),
        meanMae: mean(collect(cells.map((c) => c.maeFromClose))),
        breakoutVsCloseCount: breakoutClose,
        breakoutVsCloseRate: members.length === 0 ? null : breakoutClose / members.length,
        breakoutVsLimitUpPriceCount: breakoutLimitUp,
        breakoutVsLimitUpPriceRate: members.length === 0 ? null : breakoutLimitUp / members.length,
        meanTimeToBreakoutVsClose: mean(collect(cells.map((c) => c.timeToBreakoutVsClose))),
        medianTimeToBreakoutVsClose: median(collect(cells.map((c) => c.timeToBreakoutVsClose))),
        meanTimeToBreakoutVsLimitUpPrice: mean(
          collect(cells.map((c) => c.timeToBreakoutVsLimitUpPrice)),
        ),
        medianTimeToBreakoutVsLimitUpPrice: median(
          collect(cells.map((c) => c.timeToBreakoutVsLimitUpPrice)),
        ),
      });
    }
  }
  return {
    key: "future_horizon_comparison",
    title: `后续视界表现（分组固定为截至 T+${classificationDay} 的破位状态）`,
    description:
      "收益锚 = 首板日收盘价（事后研究结果，不是 T+N 当时可知的信息）。" +
      "MFE / MAE 与同锚下的最高 / 最低价收益**在数学上恒等**（同一锚、同一窗口）—— 两列都给出以便交叉核对。" +
      "突破 = 窗口内任一日最高价 > 基准价；timeToBreakout = 首次突破的相对日（无突破为 null）。",
    columns: [
      textColumn("horizon", "视界"),
      textColumn("group", "分组"),
      intColumn("sampleCount", "样本数"),
      intColumn("validCount", "有效数"),
      ratioColumn("meanFutureCloseReturn", "平均收盘收益"),
      ratioColumn("medianFutureCloseReturn", "中位收盘收益"),
      ratioColumn("p25FutureCloseReturn", "P25 收盘收益"),
      ratioColumn("p75FutureCloseReturn", "P75 收盘收益"),
      ratioColumn("meanFutureHighReturn", "平均最高价收益"),
      ratioColumn("medianFutureHighReturn", "中位最高价收益"),
      ratioColumn("meanFutureLowReturn", "平均最低价收益"),
      ratioColumn("medianFutureLowReturn", "中位最低价收益"),
      ratioColumn("meanMfe", "平均 MFE"),
      ratioColumn("meanMae", "平均 MAE"),
      intColumn("breakoutVsCloseCount", "突破收盘价数"),
      ratioColumn("breakoutVsCloseRate", "突破收盘价率"),
      intColumn("breakoutVsLimitUpPriceCount", "突破涨停价数"),
      ratioColumn("breakoutVsLimitUpPriceRate", "突破涨停价率"),
      ratioColumn("meanTimeToBreakoutVsClose", "平均突破耗时(收盘价)"),
      ratioColumn("medianTimeToBreakoutVsClose", "中位突破耗时(收盘价)"),
      ratioColumn("meanTimeToBreakoutVsLimitUpPrice", "平均突破耗时(涨停价)"),
      ratioColumn("medianTimeToBreakoutVsLimitUpPrice", "中位突破耗时(涨停价)"),
    ],
    rows,
  };
}

// ---------------------------------------------------------------------------
// 7. 观测的生成（**由计算结果生成**，不是模板文案）
// ---------------------------------------------------------------------------

const pct = (value: number | null, digits = 2): string =>
  value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
const ratio = (value: number | null, digits = 4): string =>
  value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

function rowOf(table: StudyTable, predicate: (row: Record<string, ExperimentCell>) => boolean) {
  return table.rows.find(predicate) ?? null;
}

function num(row: Record<string, ExperimentCell> | null, key: string): number | null {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function int(row: Record<string, ExperimentCell> | null, key: string): number {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(row: Record<string, ExperimentCell> | null, key: string): string {
  const value = row?.[key];
  return value === null || value === undefined ? "—" : String(value);
}

/** 生成研究观察（规格 §16 / §17）。全部数值来自本次计算。 */
export function buildObservations(args: {
  dailyPath: StudyTable;
  futureHorizons: StudyTable;
  entryDay: StudyTable;
  drawdownBuckets: StudyTable;
  maxObservationDay: number;
  futureHorizonList: readonly number[];
  classificationDay: number;
  sampleCount: number;
  pullbackSampleCount: number;
  nonBreakOpenSampleCount: number;
  breakOpenSampleCount: number;
  maxAvailableRelativeDay: number;
  availableMaxPostRelativeDay: number | null;
  droppedByMaxEvents: number;
  droppedByScanLimit: boolean;
  scanLimit: number;
  /** 数据集声明的事件总数（`null` = 不可知）。 */
  datasetDeclaredTotalEvents: number | null;
  /** 见 `candidates.unscannedEventCount`：账目缺口的**具体条数**。 */
  unscannedEventCount: number | null;
  minFutureHorizon: number;
}): Array<{ kind: ObservationKind; text: string }> {
  const out: Array<{ kind: ObservationKind; text: string }> = [];
  const {
    dailyPath,
    futureHorizons,
    entryDay,
    drawdownBuckets,
    maxObservationDay,
    futureHorizonList,
    classificationDay,
    sampleCount,
    pullbackSampleCount,
    nonBreakOpenSampleCount,
    breakOpenSampleCount,
  } = args;

  // ---- DESCRIPTIVE ----
  const perDayRates = Array.from({ length: maxObservationDay }, (_, i) => {
    const day = i + 1;
    const row = rowOf(dailyPath, (r) => str(r, "relativeDay") === `T+${day}`);
    return `T+${day} ${pct(num(row, "pullbackRate"))}`;
  });
  out.push({
    kind: "DESCRIPTIVE",
    text: `逐日回踩发生率（当日最低价 < 首板日收盘价的样本占比）：${perDayRates.join("、")}。`,
  });
  out.push({
    kind: "DESCRIPTIVE",
    text:
      `本次入池样本 ${sampleCount} 个首板事件；截至 T+${maxObservationDay} 期间曾出现回踩的样本 ` +
      `${pullbackSampleCount} 个（${pct(sampleCount === 0 ? null : pullbackSampleCount / sampleCount)}）。`,
  });

  const finalDayRow = rowOf(dailyPath, (r) => str(r, "relativeDay") === `T+${maxObservationDay}`);
  /**
   * 🔴 「曾跌破的占比」必须用**截至口径**（1 − 不破位率），不能用表里的 `breakOpenRate`
   *    —— 后者是**当日**破位率。两者不是互补关系，混用会把 33.23% 写成 26.23%
   *    （EXP-001 真机 Run 实测踩过：同一句话里出现「未跌破 66.77% / 曾跌破 26.23%」，
   *    两个数加起来不到 100%，是会被读成事实的假信息）。
   */
  const classificationDayTotal = nonBreakOpenSampleCount + breakOpenSampleCount;
  const breakThroughRate = classificationDayTotal === 0 ? null : breakOpenSampleCount / classificationDayTotal;
  out.push({
    kind: "DESCRIPTIVE",
    text:
      `截至 T+${maxObservationDay}：路径中始终未跌破首板日开盘价的样本占 ` +
      `${pct(num(finalDayRow, "nonBreakOpenRate"))}（${nonBreakOpenSampleCount} 条），曾跌破的占 ` +
      `${pct(breakThroughRate)}（${breakOpenSampleCount} 条，**截至口径**，与「当日破位率」不同）；` +
      `累计回撤（对首板日收盘价）` +
      `平均 ${ratio(num(finalDayRow, "meanCumulativeDrawdownFromClose"))}、` +
      `中位 ${ratio(num(finalDayRow, "medianCumulativeDrawdownFromClose"))}（负数 = 回撤）。`,
  });

  for (const horizon of futureHorizonList) {
    const allRow = rowOf(
      futureHorizons,
      (r) => str(r, "horizon") === `T+${horizon}` && str(r, "group") === "ALL",
    );
    if (allRow === null) continue;
    out.push({
      kind: "DESCRIPTIVE",
      text:
        `T+${horizon} 视界（全部样本，${int(allRow, "sampleCount")} 条）：收盘收益中位 ` +
        `${ratio(num(allRow, "medianFutureCloseReturn"))}、最高价收益中位 ` +
        `${ratio(num(allRow, "medianFutureHighReturn"))}、最低价收益中位 ` +
        `${ratio(num(allRow, "medianFutureLowReturn"))}；突破首板日收盘价的比例 ` +
        `${pct(num(allRow, "breakoutVsCloseRate"))}，突破首板日涨停价的比例 ` +
        `${pct(num(allRow, "breakoutVsLimitUpPriceRate"))}。`,
    });
  }

  const bucketSummary = drawdownBuckets.rows
    .map((r) => `${str(r, "bucket")}（${str(r, "bucketLabel")}）：${int(r, "sampleCount")} 条 / ${pct(num(r, "share"))}`)
    .join("；");
  out.push({
    kind: "DESCRIPTIVE",
    text: `截至 T+${classificationDay} 的回撤深度分桶分布：${bucketSummary}。`,
  });

  // ---- COMPARATIVE ----
  if (nonBreakOpenSampleCount > 0 && breakOpenSampleCount > 0) {
    out.push({
      kind: "COMPARATIVE",
      text:
        `不破组（T+1…T+${maxObservationDay} 最低价始终 ≥ 首板日开盘价）${nonBreakOpenSampleCount} 条，` +
        `破位组 ${breakOpenSampleCount} 条；两者在本次样本中并非同一分布：不破组的累计回撤天然被 ` +
        `「不破首板日开盘价」这条路径条件约束（其回撤下界即该条件本身）。`,
    });
    for (const horizon of futureHorizonList) {
      const nonBreakRow = rowOf(
        futureHorizons,
        (r) => str(r, "horizon") === `T+${horizon}` && str(r, "group") === "NON_BREAK_OPEN",
      );
      const breakRow = rowOf(
        futureHorizons,
        (r) => str(r, "horizon") === `T+${horizon}` && str(r, "group") === "BREAK_OPEN",
      );
      const a = num(nonBreakRow, "medianFutureCloseReturn");
      const b = num(breakRow, "medianFutureCloseReturn");
      out.push({
        kind: "COMPARATIVE",
        text:
          `T+${horizon} 中位收盘收益：不破组 ${ratio(a)}（${int(nonBreakRow, "sampleCount")} 条）vs ` +
          `破位组 ${ratio(b)}（${int(breakRow, "sampleCount")} 条），差 ${a === null || b === null ? "—" : ratio(a - b)}。` +
          `这是同一份样本内的描述性差异，未做显著性检验。`,
      });
    }
    const entryRows = entryDay.rows.filter((r) => int(r, "sampleCount") > 0);
    if (entryRows.length > 0) {
      out.push({
        kind: "COMPARATIVE",
        text:
          `入场日视角的「入场前未破位率」：` +
          entryRows
            .map((r) => `${str(r, "entryDay")} ${pct(num(r, "nonBreakOpenRate"))}`)
            .join("、") +
          `。注意 T+1 的该条件是**空路径**，因此恒为 100% —— 这是定义的结果，不是研究发现。`,
      });
    }
  }

  // ---- POTENTIAL_SIGNAL ----
  if (nonBreakOpenSampleCount > 0 && breakOpenSampleCount > 0) {
    const share = breakOpenSampleCount / (nonBreakOpenSampleCount + breakOpenSampleCount);
    out.push({
      kind: "POTENTIAL_SIGNAL",
      text:
        `「首板后 T+1…T+${maxObservationDay} 最低价始终不跌破首板日开盘价」在本次样本中筛掉了 ` +
        `${pct(share)} 的样本（破位组 ${breakOpenSampleCount} 条），两组在后续视界上的中位收益存在可观察差异 —— ` +
        `值得作为下一阶段**策略条件**做独立验证（含稳健性与样本外）。本实验只给出观察，不产出策略、不做参数搜索。`,
    });
  }
  out.push({
    kind: "POTENTIAL_SIGNAL",
    text:
      `回撤深度分桶与后续收益的对照（见 drawdown_buckets 表）显示各深度区间并非同样规模，` +
      `深度与后续表现之间是否存在非线性关系值得单独验证；本实验不输出任何「最佳回撤区间」。`,
  });

  // ---- LIMITATION ----
  out.push({
    kind: "LIMITATION",
    text:
      "本 Run 的全部数值都是**样本内描述统计**：没有参数搜索、没有稳健性检验、没有样本外（OOS）验证， " +
      "因此不能作为可交易结论，也不能据此判定任何观察日的优劣。",
  });
  out.push({
    kind: "LIMITATION",
    text:
      `样本资格包含「rd 1…${maxObservationDay} 行情齐备」这一**数据可得性**条件（属于选择偏差，不是价格条件）；` +
      `本数据集 post 视界为 rd 1…${args.availableMaxPostRelativeDay ?? args.maxAvailableRelativeDay}，` +
      `因此长视界的可用样本数会少于核心样本数（如 T+${args.maxAvailableRelativeDay}）。`,
  });
  const nextReturnAlwaysNull = entryDay.rows.every(
    (r) => num(r, `meanNext${args.minFutureHorizon}TradingDayReturn`) === null,
  );
  if (nextReturnAlwaysNull) {
    out.push({
      kind: "LIMITATION",
      text: `入场日视角的最短视界（next${args.minFutureHorizon}）在本 Run 也没有可用样本 —— 请核对数据集视界与 futureHorizons 参数的组合。`,
    });
  }
  if (args.availableMaxPostRelativeDay !== null) {
    const impossible = futureHorizonList.filter((h) => args.availableMaxPostRelativeDay !== null && h > args.availableMaxPostRelativeDay);
    if (impossible.length > 0) {
      out.push({
        kind: "LIMITATION",
        text: `futureHorizons 中的 ${impossible.map((h) => `T+${h}`).join("、")} 超出数据集真实视界（rd ≤ ${args.availableMaxPostRelativeDay}），相关单元格一律为 null（**不夹取**）。`,
      });
    }
  }
  const entryImpossible = entryDay.rows.filter(
    (r) =>
      int(r, "sampleCount") > 0 &&
      futureHorizonList.every((h) => num(r, `meanNext${h}TradingDayReturn`) === null),
  );
  if (entryImpossible.length > 0 && futureHorizonList.some((h) => h + 1 > (args.availableMaxPostRelativeDay ?? 0))) {
    out.push({
      kind: "LIMITATION",
      text:
        `入场日视角的部分「next{h}」列在结构上恒为 null：入场日 k ≥ 1 时 k+h 可能超过数据集 post 视界 ` +
        `（rd ≤ ${args.availableMaxPostRelativeDay}）。该列刻意保留以显示**视界边界**，不代表计算失败。`,
    });
  }
  if (args.droppedByMaxEvents > 0) {
    out.push({
      kind: "LIMITATION",
      text:
        `受 maxEvents 上限约束，只对确定性排序后的前 ${sampleCount + args.droppedByMaxEvents} 个候选事件做了评估，` +
        `其中 ${sampleCount} 个入池、${args.droppedByMaxEvents} 个因超出上限被剔除` +
        `（已计入 MAX_EVENTS_LIMIT，不是静默丢弃）。`,
    });
  }
  /**
   * 🔴 账目缺口必须**无论是否触顶都出数**。
   *
   * 平台强制的样本账守恒式是 `eligible + excluded = candidate` —— 而**未被扫描的事件
   * 压根不在 candidate 里**，所以守恒式在它们身上恒真、起不到任何保护作用。
   * 只写「可能还有更多事件」会让读者把「本轮候选数」读成「数据集全量」
   * （EXP-001 真机 Run 实测：数据集声明 23978 个事件、本轮只统计 19877 个，
   * 中间 3978 个事件在结果里没有任何数字记录）。
   * 因此这里不以「是否触顶」为条件，而以「缺口是否为 0」为条件。
   */
  const gap = args.unscannedEventCount;
  const declared = args.datasetDeclaredTotalEvents;
  const cause = args.droppedByScanLimit
    ? `事件扫描触达平台安全阀上限 ${args.scanLimit}`
    : "本轮扫描返回的事件数少于数据集声明的事件数";
  if (args.droppedByScanLimit || (gap !== null && gap !== 0)) {
    if (gap === null) {
      out.push({
        kind: "LIMITATION",
        text:
          `${cause}；数据集**未声明**事件总数 ⇒ 缺口条数不可知（并**不**代表缺口为 0）。` +
          `本结果的全部结论只适用于本轮扫描到的候选事件，不能外推到数据集全量。`,
      });
    } else if (gap < 0) {
      out.push({
        kind: "LIMITATION",
        text:
          `数据集口径不一致：声明的 ${declared} 个事件**少于**本轮扫描到的候选数 ${declared! - gap} 个` +
          `（差额 ${-gap}）。本结果按**实际扫描到的候选**统计，但该数据集的事件总数声明不可信。`,
      });
    } else {
      out.push({
        kind: "LIMITATION",
        text:
          `${cause}：数据集声明 ${declared} 个事件，本轮只扫描到 ${declared! - gap} 个` +
          `（候选口径见 customPayload.candidates）—— **${gap} 个事件未被扫描**，` +
          `它们既不在候选、也不在剔除清单里（平台守恒式 ` +
          "`eligible + excluded = candidate` 对「压根没进候选」的事件恒真，覆盖不到这个缺口）。" +
          `本结果的全部结论只适用于本轮扫描到的候选事件，不能外推到数据集全量。`,
      });
    }
  }

  return out;
}

/** 待验证的策略假设（规格 §27）—— 只描述假设，不创建 Strategy。 */
export function buildPotentialHypotheses(args: {
  futureHorizons: StudyTable;
  maxObservationDay: number;
  futureHorizonList: readonly number[];
  nonBreakOpenSampleCount: number;
  breakOpenSampleCount: number;
  drawdownBuckets: StudyTable;
}): Array<{ code: string; statement: string; rationale: string }> {
  const { futureHorizons, maxObservationDay, futureHorizonList, nonBreakOpenSampleCount, breakOpenSampleCount } = args;
  const longest = futureHorizonList[futureHorizonList.length - 1] ?? 5;
  const nonBreakRow = rowOf(
    futureHorizons,
    (r) => str(r, "horizon") === `T+${longest}` && str(r, "group") === "NON_BREAK_OPEN",
  );
  const breakRow = rowOf(
    futureHorizons,
    (r) => str(r, "horizon") === `T+${longest}` && str(r, "group") === "BREAK_OPEN",
  );
  const a = num(nonBreakRow, "medianFutureCloseReturn");
  const b = num(breakRow, "medianFutureCloseReturn");

  const biggestBucket = futureHorizons.rows.length > 0
    ? args.drawdownBuckets.rows.reduce(
        (acc, row) => (int(row, "sampleCount") > int(acc, "sampleCount") ? row : acc),
        args.drawdownBuckets.rows[0]!,
      )
    : null;

  return [
    {
      code: "H1",
      statement:
        "首板后若 N 日内最低价始终不跌破首板日开盘价，后续表现可能与破位样本存在结构性差异。",
      rationale:
        `本 Run 在 T+${longest} 上的中位收盘收益：不破组 ${ratio(a)}（${int(nonBreakRow, "sampleCount")} 条）` +
        `vs 破位组 ${ratio(b)}（${int(breakRow, "sampleCount")} 条）；` +
        `分组条件为 T+1…T+${maxObservationDay} 的路径条件（决策时信息，rd ≤ ${maxObservationDay}）。` +
        "该差异尚未经稳健性与样本外验证。",
    },
    {
      code: "H2",
      statement: "回撤深度与后续表现之间可能存在非线性关系。",
      rationale:
        biggestBucket === null
          ? "本 Run 的回撤分桶表为空，无法给出规模对照。"
          : `本 Run 中样本最多的回撤桶为 ${str(biggestBucket, "bucket")}（${str(biggestBucket, "bucketLabel")}），` +
            `共 ${int(biggestBucket, "sampleCount")} 条；各桶的后续收益中位数见 drawdown_buckets 表。` +
            "分桶是观察桶，不是参数寻优的结果。",
    },
    {
      code: "H3",
      statement: "不同 T+N 观察日可能对应不同的后续收益分布。",
      rationale:
        `本 Run 的逐日路径表给出 T+1…T+${maxObservationDay} 的回踩率与收益分布形态（见 daily_path_by_relative_day）。` +
        "是否「存在不同分布」需要独立验证，本实验不做排序、不判定最优观察日。",
    },
  ];
}

// ---------------------------------------------------------------------------
// 8. 产物内容（CSV / SVG）—— 纯字符串，不落盘
// ---------------------------------------------------------------------------

/** CSV 单元格转义（含逗号 / 引号 / 换行时加引号，引号翻倍）。 */
function csvCell(value: ExperimentCell): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "number"
      ? Number.isInteger(value)
        ? String(value)
        : String(roundTo(value, CSV_DIGITS))
      : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** 由「同一份表行 + 列定义」生成 CSV（表格与 CSV **必然同源**，不会漂移）。 */
export function tableToCsv(table: StudyTable): string {
  const header = table.columns.map((column) => csvCell(column.label)).join(",");
  const lines = table.rows.map((row) =>
    table.columns.map((column) => csvCell(row[column.key] ?? null)).join(","),
  );
  return [`# ${table.title}`, `# ${table.description.replace(/\n/gu, " ")}`, header, ...lines].join("\n") + "\n";
}

const SVG_WIDTH = 720;
const SVG_HEIGHT = 320;
const SVG_PAD = { top: 44, right: 24, bottom: 56, left: 68 };
const SVG_INK = "#1f2937";
const SVG_GRID = "#e5e7eb";
const SVG_ZERO = "#9ca3af";
const SVG_UP = "#e11d48"; // A 股习惯：涨 = 红
const SVG_DOWN = "#059669"; // 跌 = 绿
const SVG_PALETTE = ["#e11d48", "#2563eb", "#059669", "#d97706"];

function svgEscape(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function svgHeader(title: string, subtitle: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="${svgEscape(title)}">`,
    `<rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#ffffff"/>`,
    `<text x="${SVG_PAD.left}" y="20" font-family="sans-serif" font-size="14" font-weight="600" fill="${SVG_INK}">${svgEscape(title)}</text>`,
    `<text x="${SVG_PAD.left}" y="36" font-family="sans-serif" font-size="10" fill="#6b7280">${svgEscape(subtitle)}</text>`,
  ].join("\n");
}

interface SvgSeries {
  label: string;
  points: Array<number | null>;
  color?: string;
}

/** 折线图（自包含 SVG；无第三方依赖）。全部为 `null` 时画一条空网格并注明。 */
export function renderLineChartSvg(args: {
  title: string;
  subtitle: string;
  xLabels: readonly string[];
  series: readonly SvgSeries[];
  zeroLine?: boolean;
}): string {
  const { title, subtitle, xLabels, series } = args;
  const plotW = SVG_WIDTH - SVG_PAD.left - SVG_PAD.right;
  const plotH = SVG_HEIGHT - SVG_PAD.top - SVG_PAD.bottom;
  const allValues = series.flatMap((s) => s.points).filter((v): v is number => v !== null && Number.isFinite(v));

  const parts: string[] = [svgHeader(title, subtitle)];
  parts.push(
    `<rect x="${SVG_PAD.left}" y="${SVG_PAD.top}" width="${plotW}" height="${plotH}" fill="none" stroke="${SVG_GRID}"/>`,
  );

  if (allValues.length === 0) {
    parts.push(
      `<text x="${SVG_PAD.left + plotW / 2}" y="${SVG_PAD.top + plotH / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#6b7280">无可用数值</text>`,
    );
    parts.push("</svg>");
    return parts.join("\n");
  }

  let maxV = Math.max(...allValues);
  let minV = Math.min(...allValues);
  if (args.zeroLine !== false) {
    maxV = Math.max(maxV, 0);
    minV = Math.min(minV, 0);
  }
  if (maxV === minV) {
    maxV += 1;
    minV -= 1;
  }
  const yOf = (value: number): number => SVG_PAD.top + plotH - ((value - minV) / (maxV - minV)) * plotH;
  const xOf = (index: number): number =>
    xLabels.length <= 1 ? SVG_PAD.left + plotW / 2 : SVG_PAD.left + (index / (xLabels.length - 1)) * plotW;

  // 网格 + Y 轴刻度（5 档）
  for (let i = 0; i <= 4; i += 1) {
    const value = minV + ((maxV - minV) * i) / 4;
    const y = yOf(value);
    parts.push(`<line x1="${SVG_PAD.left}" y1="${y.toFixed(2)}" x2="${SVG_PAD.left + plotW}" y2="${y.toFixed(2)}" stroke="${SVG_GRID}"/>`);
    parts.push(
      `<text x="${SVG_PAD.left - 8}" y="${(y + 3).toFixed(2)}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#6b7280">${(value * 100).toFixed(2)}%</text>`,
    );
  }
  if (minV < 0 && maxV > 0) {
    const y = yOf(0);
    parts.push(`<line x1="${SVG_PAD.left}" y1="${y.toFixed(2)}" x2="${SVG_PAD.left + plotW}" y2="${y.toFixed(2)}" stroke="${SVG_ZERO}" stroke-dasharray="3 3"/>`);
  }
  xLabels.forEach((label, index) => {
    parts.push(
      `<text x="${xOf(index).toFixed(2)}" y="${SVG_PAD.top + plotH + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${SVG_INK}">${svgEscape(label)}</text>`,
    );
  });

  series.forEach((item, seriesIndex) => {
    const color = item.color ?? SVG_PALETTE[seriesIndex % SVG_PALETTE.length]!;
    const segments: string[][] = [];
    let current: string[] = [];
    item.points.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        if (current.length > 0) segments.push(current);
        current = [];
        return;
      }
      current.push(`${xOf(index).toFixed(2)},${yOf(value).toFixed(2)}`);
    });
    if (current.length > 0) segments.push(current);
    for (const segment of segments) {
      parts.push(
        `<polyline points="${segment.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`,
      );
      for (const point of segment) {
        const [x, y] = point.split(",");
        parts.push(`<circle cx="${x}" cy="${y}" r="2.4" fill="${color}"/>`);
      }
    }
    const legendX = SVG_PAD.left + seriesIndex * 170;
    parts.push(`<rect x="${legendX}" y="${SVG_HEIGHT - 26}" width="10" height="10" fill="${color}"/>`);
    parts.push(
      `<text x="${legendX + 14}" y="${SVG_HEIGHT - 17}" font-family="sans-serif" font-size="10" fill="${SVG_INK}">${svgEscape(item.label)}</text>`,
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/** 单序列柱状图（分桶规模）。 */
export function renderBarChartSvg(args: {
  title: string;
  subtitle: string;
  labels: readonly string[];
  values: readonly number[];
}): string {
  const { title, subtitle, labels, values } = args;
  const plotW = SVG_WIDTH - SVG_PAD.left - SVG_PAD.right;
  const plotH = SVG_HEIGHT - SVG_PAD.top - SVG_PAD.bottom;
  const parts: string[] = [svgHeader(title, subtitle)];
  parts.push(`<rect x="${SVG_PAD.left}" y="${SVG_PAD.top}" width="${plotW}" height="${plotH}" fill="none" stroke="${SVG_GRID}"/>`);

  const maxV = Math.max(1, ...values);
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxV * i) / 4;
    const y = SVG_PAD.top + plotH - (value / maxV) * plotH;
    parts.push(`<line x1="${SVG_PAD.left}" y1="${y.toFixed(2)}" x2="${SVG_PAD.left + plotW}" y2="${y.toFixed(2)}" stroke="${SVG_GRID}"/>`);
    parts.push(
      `<text x="${SVG_PAD.left - 8}" y="${(y + 3).toFixed(2)}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#6b7280">${Math.round(value)}</text>`,
    );
  }

  const slot = labels.length === 0 ? plotW : plotW / labels.length;
  const barW = Math.max(6, slot * 0.6);
  labels.forEach((label, index) => {
    const value = values[index] ?? 0;
    const height = maxV === 0 ? 0 : (value / maxV) * plotH;
    const x = SVG_PAD.left + slot * index + (slot - barW) / 2;
    const y = SVG_PAD.top + plotH - height;
    // 分桶是「回撤深度」维度 ⇒ 越深用越绿（跌），首桶（未回踩）用灰。
    const color = index === 0 ? "#6b7280" : SVG_DOWN;
    parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${height.toFixed(2)}" fill="${color}" opacity="0.85"/>`);
    parts.push(
      `<text x="${(x + barW / 2).toFixed(2)}" y="${(y - 5).toFixed(2)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${SVG_INK}">${value}</text>`,
    );
    parts.push(
      `<text x="${(x + barW / 2).toFixed(2)}" y="${SVG_PAD.top + plotH + 16}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${SVG_INK}">${svgEscape(label)}</text>`,
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/** 分组柱状图（不破组 vs 破位组，各视界）。 */
export function renderGroupedBarChartSvg(args: {
  title: string;
  subtitle: string;
  categories: readonly string[];
  series: readonly { label: string; values: Array<number | null>; color: string }[];
}): string {
  const { title, subtitle, categories, series } = args;
  const plotW = SVG_WIDTH - SVG_PAD.left - SVG_PAD.right;
  const plotH = SVG_HEIGHT - SVG_PAD.top - SVG_PAD.bottom;
  const parts: string[] = [svgHeader(title, subtitle)];
  parts.push(`<rect x="${SVG_PAD.left}" y="${SVG_PAD.top}" width="${plotW}" height="${plotH}" fill="none" stroke="${SVG_GRID}"/>`);

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
  if (all.length === 0) {
    parts.push(
      `<text x="${SVG_PAD.left + plotW / 2}" y="${SVG_PAD.top + plotH / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#6b7280">无可用数值</text>`,
    );
    parts.push("</svg>");
    return parts.join("\n");
  }
  let maxV = Math.max(0, ...all);
  let minV = Math.min(0, ...all);
  if (maxV === minV) {
    maxV += 0.01;
    minV -= 0.01;
  }
  const yOf = (value: number): number => SVG_PAD.top + plotH - ((value - minV) / (maxV - minV)) * plotH;

  for (let i = 0; i <= 4; i += 1) {
    const value = minV + ((maxV - minV) * i) / 4;
    const y = yOf(value);
    parts.push(`<line x1="${SVG_PAD.left}" y1="${y.toFixed(2)}" x2="${SVG_PAD.left + plotW}" y2="${y.toFixed(2)}" stroke="${SVG_GRID}"/>`);
    parts.push(
      `<text x="${SVG_PAD.left - 8}" y="${(y + 3).toFixed(2)}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#6b7280">${(value * 100).toFixed(2)}%</text>`,
    );
  }
  if (minV < 0 && maxV > 0) {
    const y = yOf(0);
    parts.push(`<line x1="${SVG_PAD.left}" y1="${y}" x2="${SVG_PAD.left + plotW}" y2="${y}" stroke="${SVG_ZERO}" stroke-dasharray="3 3"/>`);
  }

  const slot = categories.length === 0 ? plotW : plotW / categories.length;
  const barW = Math.max(6, (slot * 0.7) / Math.max(1, series.length));
  const zeroY = yOf(0);
  categories.forEach((category, catIndex) => {
    series.forEach((item, seriesIndex) => {
      const value = item.values[catIndex] ?? null;
      if (value === null || !Number.isFinite(value)) return;
      const y = yOf(value);
      const x = SVG_PAD.left + slot * catIndex + slot * 0.15 + seriesIndex * barW;
      const top = Math.min(y, zeroY);
      const height = Math.abs(zeroY - y);
      parts.push(`<rect x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(1, height).toFixed(2)}" fill="${item.color}" opacity="0.85"/>`);
    });
    parts.push(
      `<text x="${(SVG_PAD.left + slot * catIndex + slot / 2).toFixed(2)}" y="${SVG_PAD.top + plotH + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${SVG_INK}">${svgEscape(category)}</text>`,
    );
  });
  series.forEach((item, index) => {
    const legendX = SVG_PAD.left + index * 180;
    parts.push(`<rect x="${legendX}" y="${SVG_HEIGHT - 26}" width="10" height="10" fill="${item.color}"/>`);
    parts.push(
      `<text x="${legendX + 14}" y="${SVG_HEIGHT - 17}" font-family="sans-serif" font-size="10" fill="${SVG_INK}">${svgEscape(item.label)}</text>`,
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 9. 结果组装
// ---------------------------------------------------------------------------

/** 一个待落盘的文件产物（内容 + 元数据；`experiment.ts` 只做转交）。 */
export interface StudyArtifactFile {
  name: string;
  role: "table" | "chart";
  body: string;
  contentType: string;
  label: string;
  description: string;
}

/**
 * 组装产物清单（5 张 CSV + 2 张 SVG；与信封里的表 / 图**同源**）。
 *
 * 🔴 `name` 是 **Run 前缀下的相对名字，且必须不含角色段** ——
 *    Object Key = `…/runs/{runId}/{role}/{name}`，角色段由 `role` 决定。
 *    踩过的坑（EXP-001 真机 E2E 实测）：写成 `tables/x.csv` 且 `role: "table"`
 *    ⇒ 落成 `tables/tables/x.csv`（角色段重复），而规范 §P 的映射表恰好是
 *    「name 不含角色段」—— 当时**规范里那行代码示例是错的**，照抄就会踩。
 */
export function buildArtifacts(tables: readonly StudyTable[], svgs: readonly { name: string; label: string; description: string; body: string }[]): StudyArtifactFile[] {
  const files: StudyArtifactFile[] = tables.map((table) => ({
    name: `${table.key}.csv`,
    role: "table" as const,
    body: tableToCsv(table),
    contentType: "text/csv; charset=utf-8",
    label: `${table.title}（CSV）`,
    description: table.description,
  }));
  for (const svg of svgs) {
    files.push({
      name: svg.name,
      role: "chart",
      body: svg.body,
      contentType: "image/svg+xml",
      label: svg.label,
      description: svg.description,
    });
  }
  return files;
}

export interface AssembleStudyArgs {
  maxObservationDay: number;
  futureHorizons: readonly number[];
  classificationDay: number;
  drawdownBucketEdgesBps: readonly number[];
  derived: readonly SampleDerived[];
  tables: readonly StudyTable[];
  observations: Array<{ kind: ObservationKind; text: string }>;
  hypotheses: Array<{ code: string; statement: string; rationale: string }>;
  candidates: {
    datasetEventCount: number | null;
    scannedRowCount: number;
    candidateCount: number;
    usedEventCount: number;
    droppedByMaxEvents: number;
    droppedByScanLimit: boolean;
    scanLimit: number;
    /** 见 `candidates` 模式里的说明：`datasetEventCount − candidateCount`，`null` = 总数不可知。 */
    unscannedEventCount: number | null;
  };
  dataQuality: {
    eventDayBarRowsRead: number;
    observationBarRowsRead: number;
    missingEventDayBarCount: number;
    missingObservationBarCount: number;
    invalidOhlcBarCount: number;
    insufficientForwardBarsEventCount: number;
    duplicateEventIdCount: number;
    eventDayCloseDiffersFromLimitUpPriceCount: number;
    closeMismatchToleranceRatio: number;
  };
  excludedByReason: Record<string, number>;
  availableMaxPostRelativeDay: number | null;
  forwardDataPurpose: string;
}

const RETURN_BUCKETS: ReadonlyArray<{ label: string; test: (value: number) => boolean }> = [
  { label: "≤ -10%", test: (v) => v <= -0.1 },
  { label: "(-10%, -5%]", test: (v) => v > -0.1 && v <= -0.05 },
  { label: "(-5%, 0%]", test: (v) => v > -0.05 && v <= 0 },
  { label: "(0%, 5%]", test: (v) => v > 0 && v <= 0.05 },
  { label: "(5%, 10%]", test: (v) => v > 0.05 && v <= 0.1 },
  { label: "> 10%", test: (v) => v > 0.1 },
];

/** 组装最终结果（信封 + 自有结构）。 */
export function assembleFundamentalStudyResult(args: AssembleStudyArgs): ExperimentResultPayload {
  const {
    maxObservationDay,
    futureHorizons,
    classificationDay,
    drawdownBucketEdgesBps,
    derived,
    tables,
    candidates,
    dataQuality,
    excludedByReason,
  } = args;
  const { edgesRatio, buckets } = buildDrawdownBuckets(drawdownBucketEdgesBps);

  const tableByKey = new Map(tables.map((table) => [table.key, table]));
  const dailyPath = tableByKey.get("daily_path_by_relative_day")!;
  const nonBreakVsBreak = tableByKey.get("non_break_vs_break")!;
  const drawdownBuckets = tableByKey.get("drawdown_buckets")!;
  const entryDay = tableByKey.get("entry_day_comparison")!;
  const futureHorizonComparison = tableByKey.get("future_horizon_comparison")!;

  const finalDays = derived
    .map((item) => item.byDay.find((d) => d.relativeDay === classificationDay))
    .filter((value): value is SampleDerived["byDay"][number] => value !== undefined);
  const finalRow = dailyPath.rows.find((row) => row["relativeDay"] === `T+${classificationDay}`) ?? null;

  const sampleCount = derived.length;
  const nonBreakOpenSampleCount = finalDays.filter((d) => d.nonBreakOpen).length;
  const breakOpenSampleCount = finalDays.length - nonBreakOpenSampleCount;
  /**
   * 分类日的**分母**：该观察日上真的有路径的样本数。
   * 🔴 不能拿 `nonBreakOpenSampleCount`（分子）当 `sampleCount` 挂到比率上 ——
   *    那会让「不破位率 2/3」在卡片上显示成「样本 2 条」，是会被读成事实的假信息。
   */
  const classificationDaySampleCount = finalDays.length;
  const pullbackSampleCount = derived.filter((item) => item.byDay.some((d) => d.pullbackBelowClose)).length;

  const maxAvailableRelativeDay = derived.reduce(
    (acc, item) => Math.max(acc, item.sample.maxAvailableRelativeDay),
    0,
  );
  const minFutureHorizon = futureHorizons.reduce((acc, h) => Math.min(acc, h), futureHorizons[0] ?? 1);

  const observations = args.observations;

  const eligibleCount = sampleCount;
  const excludedCount = candidates.candidateCount - eligibleCount;

  // ---- 图表（结构化；与 SVG 产物同源同数） ----
  const pathLabels = Array.from({ length: maxObservationDay }, (_, i) => `T+${i + 1}`);
  const seriesOf = (key: string): Array<number | null> =>
    dailyPath.rows.map((row) => (typeof row[key] === "number" ? (row[key] as number) : null));

  const groupLabels = futureHorizons.map((h) => `T+${h}`);
  const groupRowOf = (group: string) =>
    futureHorizons.flatMap((h) => {
      const row = futureHorizonComparison.rows.find(
        (r) => r["horizon"] === `T+${h}` && r["group"] === group,
      );
      return [typeof row?.["meanFutureCloseReturn"] === "number" ? (row!["meanFutureCloseReturn"] as number) : null];
    });

  const charts = [
    {
      key: "path-mean-median",
      title: "T+1…T+maxObservationDay 路径（平均 / 中位）",
      description: "锚 = 首板日收盘价；收益与最低价收益均为小数比例（负数 = 下跌）。",
      kind: "LINE" as const,
      xLabel: "相对日",
      yLabel: "收益",
      unit: RATIO_UNIT,
      series: [
        { key: "mean-close-return", label: "平均收盘收益", points: pathLabels.map((x, i) => ({ x, y: seriesOf("averageCloseReturn")[i] ?? null })) },
        { key: "median-close-return", label: "中位收盘收益", points: pathLabels.map((x, i) => ({ x, y: seriesOf("medianCloseReturn")[i] ?? null })) },
        { key: "mean-low-return", label: "平均最低价收益", points: pathLabels.map((x, i) => ({ x, y: seriesOf("averageLowReturn")[i] ?? null })) },
      ],
    },
    {
      key: "drawdown-bucket-distribution",
      title: `回撤深度分布（截至 T+${classificationDay}）`,
      description: "桶为研究观察桶；边界见 customPayload.studyWindow。",
      kind: "BAR" as const,
      xLabel: "回撤桶",
      yLabel: "样本数",
      unit: "个",
      series: [
        {
          key: "bucket-count",
          label: "样本数",
          points: drawdownBuckets.rows.map((row) => ({
            x: String(row["bucketShort"] ?? row["bucket"] ?? "—"),
            y: typeof row["sampleCount"] === "number" ? (row["sampleCount"] as number) : null,
          })),
        },
      ],
    },
    {
      key: "non-break-vs-break-by-horizon",
      title: "不破组 vs 破位组（逐视界平均收盘收益）",
      description:
        "分组固定为「截至 T+classificationDay 是否跌破首板日开盘价」；锚 = 首板日收盘价。" +
        "**不做优劣判定** —— 只呈现两组的分布差异。",
      kind: "BAR" as const,
      xLabel: "视界",
      yLabel: "平均收盘收益",
      unit: RATIO_UNIT,
      series: [
        {
          key: "non-break-open",
          label: "不破组（NON_BREAK_OPEN）",
          points: groupLabels.map((x, i) => ({ x, y: groupRowOf("NON_BREAK_OPEN")[i] ?? null })),
        },
        {
          key: "break-open",
          label: "破位组（BREAK_OPEN）",
          points: groupLabels.map((x, i) => ({ x, y: groupRowOf("BREAK_OPEN")[i] ?? null })),
        },
        {
          key: "all",
          label: "全部样本（ALL）",
          points: groupLabels.map((x, i) => ({ x, y: groupRowOf("ALL")[i] ?? null })),
        },
      ],
    },
  ];

  // ---- 分布 ----
  const longHorizon = args.futureHorizons[args.futureHorizons.length - 1] ?? maxObservationDay;
  const longReturns = derived
    .map((item) => item.byHorizon.get(longHorizon)?.futureCloseReturnFromClose ?? null)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const distributions: ExperimentResultDistribution[] = [
    {
      code: "drawdown_from_close_bucket",
      label: `回撤深度分布（截至 T+${classificationDay}，对首板日收盘价）`,
      buckets: buckets.map((bucket) => ({
        label: bucket.label,
        count: derived.filter((item) => {
          const slice = item.byDay.find((d) => d.relativeDay === classificationDay);
          return slice !== undefined && bucket.test(slice.drawdownFromClose);
        }).length,
      })),
      note: "桶互不重叠且完全覆盖（下界含、上界不含）；NO_PULLBACK = 全程最低价 ≥ 首板日收盘价。",
    },
    {
      code: `future_close_return_T${longHorizon}_bucket`,
      label: `T+${longHorizon} 收盘收益分布（锚 = 首板日收盘价）`,
      buckets: RETURN_BUCKETS.map((bucket) => ({
        label: bucket.label,
        count: longReturns.filter((value) => bucket.test(value)).length,
      })),
      note: `样本 ${longReturns.length} 条（少于核心样本 ${sampleCount} 条时，差额为缺少 T+1…T+${longHorizon} 行情的事件）。区间左开右闭。`,
    },
  ];

  // ---- 统计量卡片 ----
  const statistics = [
    { code: "included_sample_count", label: "入池样本（首板事件）", value: eligibleCount, unit: "个", digits: 0 },
    { code: "excluded_sample_count", label: "被剔除候选", value: excludedCount, unit: "个", digits: 0, note: Object.keys(excludedByReason).length === 0 ? "无剔除" : "逐项原因见样本口径。" },
    { code: "pullback_sample_count", label: `T+1…T+${maxObservationDay} 曾回踩的样本`, value: pullbackSampleCount, unit: "个", digits: 0 },
    { code: "non_break_open_rate", label: `截至 T+${classificationDay} 未跌破首板日开盘价比例`, value: num(finalRow, "nonBreakOpenRate"), digits: DISPLAY_DIGITS, sampleCount: classificationDaySampleCount },
    { code: "break_open_rate", label: `截至 T+${classificationDay} 曾跌破首板日开盘价比例`, value: num(finalRow, "breakOpenRate"), digits: DISPLAY_DIGITS, sampleCount: classificationDaySampleCount },
    { code: "mean_drawdown_from_close", label: `平均累计回撤（对首板日收盘价）`, value: num(finalRow, "meanCumulativeDrawdownFromClose"), digits: DISPLAY_DIGITS },
    { code: "median_drawdown_from_close", label: `中位累计回撤（对首板日收盘价）`, value: num(finalRow, "medianCumulativeDrawdownFromClose"), digits: DISPLAY_DIGITS },
    { code: "median_drawdown_from_open", label: `中位累计回撤（对首板日开盘价）`, value: num(finalRow, "medianCumulativeDrawdownFromOpen"), digits: DISPLAY_DIGITS },
  ];

  // ---- 自有结构 ----
  const groupOutcomes = futureHorizons.flatMap((horizon) =>
    GROUP_CODES.map((group) => {
      const row = futureHorizonComparison.rows.find(
        (r) => r["horizon"] === `T+${horizon}` && r["group"] === group,
      ) ?? null;
      return {
        horizon,
        group,
        sampleCount: int(row, "sampleCount"),
        meanFutureCloseReturn: num(row, "meanFutureCloseReturn"),
        medianFutureCloseReturn: num(row, "medianFutureCloseReturn"),
        p25FutureCloseReturn: num(row, "p25FutureCloseReturn"),
        p75FutureCloseReturn: num(row, "p75FutureCloseReturn"),
      };
    }),
  );

  const customPayload: FundamentalStudyCustomPayload = {
    computationVersion: COMPUTATION_VERSION,
    studyWindow: {
      maxObservationDay,
      futureHorizons: [...futureHorizons],
      classificationDay,
      drawdownBucketEdgesBps: [...drawdownBucketEdgesBps],
      drawdownBucketEdgesRatio: edgesRatio,
      drawdownBucketLabels: buckets.map((bucket) => bucket.label),
    },
    informationBoundary: {
      decisionOffsetDays: DECLARED_DECISION_OFFSET_DAYS,
      usesForwardData: true,
      forwardDataPurpose: args.forwardDataPurpose,
      prefixRelativeDaysDeclared: [0],
      postRelativeDaysDeclared: [...DECLARED_POST_RELATIVE_DAYS],
      decisionTimeInformation: [
        "首板日（rd=0）的 open / close 与事件表 limitUpPrice —— 全部基准价来自这一天",
        `rd ∈ [1, ${maxObservationDay}] 的路径本身：用于判定「截至 T+N 是否跌破首板日开盘价」（分组条件）`,
        `入场日 T+k（k ≤ ${maxObservationDay}）的**入场前**路径 rd ∈ [1, k−1]：入场条件的决策时信息`,
      ],
      postEventResearchOutcome: [
        "futureHorizons 的 futureHighReturn / futureLowReturn / futureCloseReturn / MFE / MAE",
        "突破首板日收盘价、突破首板日涨停价的计数与 timeToBreakout",
        "入场日视角的 next{h}TradingDayReturn 与入场后 MFE / MAE",
      ],
      notes: [
        `decisionOffsetDays = ${DECLARED_DECISION_OFFSET_DAYS}：任何「截至某观察日」的判定都只使用 rd ∈ [1, ${DECLARED_DECISION_OFFSET_DAYS}]，` +
          `且 run() 强制 maxObservationDay ≤ ${DECLARED_DECISION_OFFSET_DAYS}（扩大观察窗口会让分组条件越过声明的信息边界）。`,
        "futureHorizons 的收益**不参与**任何样本资格或分组判定 —— 它们只作为事后研究结果呈现。",
        "「不破首板日开盘价」是**路径条件**：一旦在某个观察日跌破，这个样本在该日及之后的分类就固定为破位，不会因为后来涨回来而改回不破。",
      ],
    },
    candidates,
    dataQuality: {
      datasetDeclaredTotalEvents: candidates.datasetEventCount,
      scannedRowCount: candidates.scannedRowCount,
      includedCount: eligibleCount,
      excludedCount,
      excludedByReason,
      ...dataQuality,
    },
    summary: {
      sampleCount,
      validSampleCount: eligibleCount,
      pullbackSampleCount,
      nonBreakOpenSampleCount,
      breakOpenSampleCount,
    },
    metrics: {
      finalObservationDay: classificationDay,
      pullbackRateOnFinalDay: num(finalRow, "pullbackRate"),
      breakOpenRateOnFinalDay: num(finalRow, "breakOpenRate"),
      nonBreakOpenRateThroughFinalDay:
        classificationDaySampleCount === 0 ? null : nonBreakOpenSampleCount / classificationDaySampleCount,
      breakOpenRateThroughFinalDay:
        classificationDaySampleCount === 0 ? null : breakOpenSampleCount / classificationDaySampleCount,
      meanDrawdownFromCloseThroughFinalDay: num(finalRow, "meanCumulativeDrawdownFromClose"),
      medianDrawdownFromCloseThroughFinalDay: num(finalRow, "medianCumulativeDrawdownFromClose"),
      meanDrawdownFromOpenThroughFinalDay: num(finalRow, "meanCumulativeDrawdownFromOpen"),
      medianDrawdownFromOpenThroughFinalDay: num(finalRow, "medianCumulativeDrawdownFromOpen"),
      medianCloseReturnOnFinalDay: num(finalRow, "medianCloseReturn"),
      groupOutcomes,
    },
    exclusionReasonLabels: { ...EXCLUSION_REASON_LABELS },
    observations,
    potentialStrategyHypotheses: args.hypotheses,
    selectionNotes: [
      "样本单位 = 1 个首板事件（不是「股票一天」）；每个样本一次给出 T+1…T+maxObservationDay 的完整路径。",
      `全部比率类数值一律为**小数比例**（-0.05 表示 -5%），包括回撤、收益、比率与分桶边界 —— 全实验统一，不混用百分数。`,
      `回撤分桶边界来自 Run 参数（基点）：${drawdownBucketEdgesBps.map((bps) => `${bps}bp`).join(" / ")}；` +
        `分桶规则 = 下界含、上界不含，首桶为「未回踩（dd ≥ 0）」。`,
      "「不破首板日开盘价」的判定不使用首板日当日的 low —— 路径从 T+1 开始（首板日当天涨停，其盘中低点不属于「首板之后的回踩」）。",
      `样本资格包含「rd 1…${maxObservationDay} 行情齐备」这一数据可得性条件（选择偏差，不是价格条件），特此登记。`,
      `futureHorizons 最长视界 T+${longHorizon} 的可用样本数可能少于核心样本数（数据集 post 视界上限 rd=${args.availableMaxPostRelativeDay ?? "未知"}）。`,
      "MFE / MAE 在「事件日收盘价锚定」的表里与同锚的最高 / 最低价收益**数学恒等**；只有入场日视角（锚 = 入场日开盘价）才给出独立信息。",
      "本实验只做描述性统计：不排序、不评级、不做显著性主张、不判定最优观察日 / 入场日 / 回撤区间，也不产出任何策略对象。",
    ],
  };

  return {
    sampleSummary: {
      candidateCount: candidates.candidateCount,
      eligibleCount,
      excludedCount,
      excludedByReason,
      notes: [
        `候选 = 去重后的事件数 ${candidates.candidateCount}（扫描行 ${candidates.scannedRowCount}）；` +
          `数据集声明事件总数 ${candidates.datasetEventCount ?? "—"}。`,
        `剔除原因合计 = ${Object.values(excludedByReason).reduce((a, b) => a + b, 0)}，与 excludedCount 相等（由平台强制校验）。`,
        "剔除原因键为闭集，中文说明见 customPayload.exclusionReasonLabels。",
        /**
         * 🔴 守恒式的**边界**必须写在这里：平台只强制
         *    `eligible + excluded = candidate` 与 `Σ excludedByReason = excluded`。
         *    **未被扫描到的事件不属于 candidate**，所以这两条式子在它们身上恒真、
         *    起不到任何保护作用 —— 缺口只能靠 `customPayload.candidates.unscannedEventCount`
         *    显式带出，否则「数据集有 N 个、本 Run 只用了 M 个」的差额会消失得无声无息。
         */
        candidates.unscannedEventCount === null
          ? "数据集未声明事件总数，因此**无法核对**本轮候选是否为数据集全量；平台守恒式（eligible + excluded = candidate）对「未被扫描的事件」不成立保护。"
          : `账目缺口：数据集声明 ${candidates.datasetEventCount} 个事件 − 本轮候选 ${candidates.candidateCount} 个 = **${candidates.unscannedEventCount} 个未被扫描**（既不在候选、也不在剔除）。` +
            `平台守恒式只覆盖 candidate，覆盖不到这个缺口，故由 customPayload.candidates.unscannedEventCount 单独登记。`,
      ],
    },
    // 🔴 信封里的表格由**同一份行数据**投影而成（`toEnvelopeTable` 只做显示位收敛），
    //    因此页面看到的值与落盘 CSV 的同名指标在显示精度内必然一致，不存在第二套口径。
    tables: tables.map(toEnvelopeTable),
    statistics,
    distributions,
    charts,
    comparisons: [
      {
        key: "non-break-vs-break-at-longest-horizon",
        title: `不破组 vs 破位组（T+${longHorizon}，仅差值，不含优劣判断）`,
        description: "左列 = 不破组（截至 T+classificationDay 未跌破首板日开盘价），右列 = 破位组；差值 = 右 − 左。",
        leftLabel: "不破组",
        rightLabel: "破位组",
        rows: [
          {
            label: `T+${longHorizon} 平均收盘收益`,
            left: num(groupRowSource(futureHorizonComparison, longHorizon, "NON_BREAK_OPEN"), "meanFutureCloseReturn"),
            right: num(groupRowSource(futureHorizonComparison, longHorizon, "BREAK_OPEN"), "meanFutureCloseReturn"),
            delta: subtract(
              num(groupRowSource(futureHorizonComparison, longHorizon, "BREAK_OPEN"), "meanFutureCloseReturn"),
              num(groupRowSource(futureHorizonComparison, longHorizon, "NON_BREAK_OPEN"), "meanFutureCloseReturn"),
            ),
            deltaPercent: null,
          },
          {
            label: `T+${longHorizon} 中位收盘收益`,
            left: num(groupRowSource(futureHorizonComparison, longHorizon, "NON_BREAK_OPEN"), "medianFutureCloseReturn"),
            right: num(groupRowSource(futureHorizonComparison, longHorizon, "BREAK_OPEN"), "medianFutureCloseReturn"),
            delta: subtract(
              num(groupRowSource(futureHorizonComparison, longHorizon, "BREAK_OPEN"), "medianFutureCloseReturn"),
              num(groupRowSource(futureHorizonComparison, longHorizon, "NON_BREAK_OPEN"), "medianFutureCloseReturn"),
            ),
            deltaPercent: null,
          },
          {
            label: `样本数（左 = 不破组 / 右 = 破位组）`,
            left: nonBreakOpenSampleCount,
            right: breakOpenSampleCount,
            delta: breakOpenSampleCount - nonBreakOpenSampleCount,
            deltaPercent: null,
          },
        ],
      },
    ],
    customPayload,
  };
}

function subtract(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function groupRowSource(
  table: StudyTable,
  horizon: number,
  group: string,
): Record<string, ExperimentCell> | null {
  return table.rows.find((row) => row["horizon"] === `T+${horizon}` && row["group"] === group) ?? null;
}

/** 把 `StudyTable` 转成信封要求的表格形状。 */
export function toEnvelopeTable(table: StudyTable): ExperimentResultTable {
  return {
    key: table.key,
    title: table.title,
    description: table.description,
    columns: table.columns.map((column) => ({
      key: column.key,
      label: column.label,
      unit: column.unit ?? null,
      digits: column.digits ?? null,
      align: column.align,
    })),
    rows: table.rows.map((row) => {
      // 🔴 表格单元格只允许 number|string|boolean|null；比率类按显示位收敛，
      //    保证「页面看到的数字」与「落盘 CSV 的同一指标」在显示精度内一致。
      const out: Record<string, ExperimentCell> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === "number" && !Number.isInteger(value) ? roundTo(value, DISPLAY_DIGITS) : value;
      }
      return out;
    }),
  };
}
