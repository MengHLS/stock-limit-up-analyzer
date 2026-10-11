/**
 * RIGHT-TAIL-RESEARCH-002 — **Tail Metrics MVP**：右尾池派生（纯逻辑 + 注入式取数端口，**零直连 DB**）。
 *
 * ## 与 `twelve-factor-composite-study/derive.ts` 的关系
 *
 * 本模块**复用其冻结语义**（Pass A/B/D 的判定、12 因子的计算式、成本口径），但有**四处刻意的差异**，
 * 全部是本轮预注册要求的：
 *
 * | # | 差异 | 理由 |
 * |---|---|---|
 * | 1 | **不施加回踩门**（不判定 `hasObservationPullback`，不产出 `NO_PULLBACK_IN_OBSERVATION`） | 本轮主线：首板回踩**不再**作为前置条件 |
 * | 2 | **多持有周期**（`T+5/T+10/T+20/T+60`，D1-a）而非单一 `T+10` | 研究问题要求四周期 |
 * | 3 | **退出顺延到主退出日 +10 个交易日**（`T+5` 即 `rd10→rd11..20`，与冻结契约一致） | 恢复正式策略语义 |
 * | 4 | **`limitGap` 的 `null` 单独记缺失码**（原文值排序不可排名），不插补 | 预注册强制口径 |
 *
 * 🔴 12 个因子的**计算式与冻结契约逐字一致**，**不得**在本模块重新定义因子含义或桶边界。
 */

import {
  RIGHT_TAIL_ALL_FACTOR_CODES,
  RIGHT_TAIL_DEFERRAL_MAX_DAYS,
  RIGHT_TAIL_HORIZONS,
  RIGHT_TAIL_MAX_RELATIVE_DAY,
  RIGHT_TAIL_ROUND_TRIP_COST,
  limitGapMissingCode,
  type CellValue,
  type RightTailBarRow,
  type RightTailDatasetAccess,
  type RightTailEventRow,
  type RightTailFactorCode,
  type RightTailOutcome,
  type RightTailSample,
} from "./rightTailTypes";

const EPSILON = 1e-9;
/** 因子计算窗口（`T+1..T+5`）。 */
const CONTEXT_DAYS = 5;
/** `derive.ts` 的入场相对日（`T+6`）。 */
const ENTRY_RELATIVE_DAY = 6;
/** 因子路径完整性与入场可得性判据所用的主退出相对日（沿用冻结契约）。 */
const PRIMARY_EXIT_RELATIVE_DAY = 10;
/** 前置窗口相对日（`preReturn10` 需要）。 */
const PREFIX_RELATIVE_DAYS = [-10, -1] as const;

/** 核心读取相对日（因子 + Pass A + 入场）：`T+1..T+10`。 */
export const RIGHT_TAIL_CORE_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: PRIMARY_EXIT_RELATIVE_DAY },
  (_, index) => index + 1
);

/** 退出读取相对日（四个周期的主退出 + 顺延窗口的并集）。 */
export const RIGHT_TAIL_EXIT_RELATIVE_DAYS: readonly number[] = [
  ...new Set(
    RIGHT_TAIL_HORIZONS.flatMap((horizon) =>
      Array.from(
        { length: horizon.lastExitRelativeDay - horizon.primaryExitRelativeDay + 1 },
        (_, index) => horizon.primaryExitRelativeDay + index
      )
    )
  ),
].sort((left, right) => left - right);

/** 平台 `datasetRequirement.postRelativeDays` 应声明的完整相对日集合。 */
export const RIGHT_TAIL_POST_RELATIVE_DAYS: readonly number[] = [
  ...new Set([...RIGHT_TAIL_CORE_RELATIVE_DAYS, ...RIGHT_TAIL_EXIT_RELATIVE_DAYS]),
].sort((left, right) => left - right);

export const RIGHT_TAIL_PREFIX_RELATIVE_DAYS: readonly number[] = [...PREFIX_RELATIVE_DAYS];

export const RIGHT_TAIL_EXCLUSION_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  NOT_FIRST_LIMIT: "事件不是首板",
  NOT_MAIN_BOARD: "非沪深主板",
  MISSING_EVENT_DAY_BAR: "首板日行情缺失",
  INVALID_EVENT_DAY_OHLC: "首板日 OHLC 结构非法",
  EVENT_NOT_EXACT_LIMIT_UP: "首板收盘价不等于涨停价",
  MISSING_FACTOR_PATH: "T+1..T+5 行情路径不完整或停牌",
  MISSING_FORWARD_PATH: "T+6..T+10 行情路径不完整或停牌",
  MISSING_PREFIX_PATH: "T-1 / T-10 收盘不可得",
  ENTRY_UNFILLABLE: "T+6 开盘不可买",
  NO_EXECUTABLE_EXIT: "T+10 及顺延窗口内无可卖收盘",
  MISSING_FACTOR: "12 因子完备用例不满足",
  FACTOR_VALUE_MISSING: "因子不可评估（原始值缺失）",
});

export function rightTailExclusionLabelOf(code: string): string {
  return RIGHT_TAIL_EXCLUSION_REASON_LABELS[code] ?? code;
}

// ---------------------------------------------------------------------------
// 取值解析（镜像 derive.ts）
// ---------------------------------------------------------------------------

function numberValue(values: Readonly<Record<string, CellValue>>, key: string): number | null {
  const value = values[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(values: Readonly<Record<string, CellValue>>, key: string): boolean {
  return values[key] === true || values[key] === 1;
}

interface EventDayBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  limitUpPrice: number;
  canBuyAtOpen: boolean;
  canSellAtClose: boolean;
}

function parseEventDayBar(row: RightTailBarRow | undefined): EventDayBar | null {
  if (!row) return null;
  const open = numberValue(row.values, "open");
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  const volume = numberValue(row.values, "volume");
  const amount = numberValue(row.values, "amount");
  if (open === null || high === null || low === null || close === null || volume === null || amount === null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume <= 0 || amount < 0) return null;
  return { open, high, low, close, volume, amount };
}

function parseBar(row: RightTailBarRow | undefined): Bar | null {
  if (!row) return null;
  if (row.values.barPresent === false || row.values.barPresent === 0) return null;
  if (row.values.suspensionStatus === "SUSPENDED") return null;
  const open = numberValue(row.values, "open");
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  const volume = numberValue(row.values, "volume");
  const limitUpPrice = numberValue(row.values, "limitUpPrice");
  if (open === null || high === null || low === null || close === null || volume === null || limitUpPrice === null) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume <= 0 || limitUpPrice <= 0) return null;
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;
  return {
    open,
    high,
    low,
    close,
    volume,
    limitUpPrice,
    canBuyAtOpen: booleanValue(row.values, "canBuyAtOpen"),
    canSellAtClose: booleanValue(row.values, "canSellAtClose"),
  };
}

/** 同日横截面百分位（`count(peer <= value) / N`，peer 含自身）——与 `derive.ts` 同法。 */
function percentileRank(value: number, peers: readonly number[]): number {
  if (peers.length <= 1) return 0.5;
  let belowOrEqual = 0;
  for (const peer of peers) if (peer <= value) belowOrEqual += 1;
  return belowOrEqual / peers.length;
}

// ---------------------------------------------------------------------------
// 派生结果
// ---------------------------------------------------------------------------

export interface RightTailDerivation {
  readonly samples: readonly RightTailSample[];
  /** `eventId` → 四个周期的结果（缺失周期不出现在数组里）。 */
  readonly outcomesByEventId: ReadonlyMap<string, readonly RightTailOutcome[]>;
  readonly candidateCount: number;
  readonly excludedByReason: Record<string, number>;
  readonly factorMissingByCode: Record<string, number>;
  /** `FACTOR_VALUE_MISSING:limitGap` 计数（**单独记录，不插补**）。 */
  readonly limitGapMissingCount: number;
  /** 逐周期「使用了顺延退出」的样本数。 */
  readonly deferredCountByHorizon: Record<string, number>;
  /** 逐周期「无可执行退出」而被剔除的池内样本数。 */
  readonly noExitCountByHorizon: Record<string, number>;
  readonly decisionDateCount: number;
  readonly duplicateEventIdCount: number;
  readonly datasetEventCount: number | null;
  readonly unscannedEventCount: number | null;
  readonly readRelativeDays: readonly number[];
}

function indexByEventId(
  rows: readonly RightTailBarRow[]
): Map<string, RightTailBarRow> {
  const map = new Map<string, RightTailBarRow>();
  for (const row of rows) map.set(row.eventId, row);
  return map;
}

/**
 * 派生右尾池。
 *
 * 🔴 **无回踩门**；🔴 不产出任何 Run / 不写库；取数一律经注入端口。
 */
export async function deriveRightTailUniverse(
  access: RightTailDatasetAccess,
  facts?: { readonly totalEvents?: number | null }
): Promise<RightTailDerivation> {
  const events = await access.events();
  const deduped = new Map<string, RightTailEventRow>();
  let duplicateEventIdCount = 0;
  for (const event of events) {
    if (deduped.has(event.eventId)) {
      duplicateEventIdCount += 1;
      continue;
    }
    deduped.set(event.eventId, event);
  }
  const uniqueEvents = [...deduped.values()].sort((left, right) =>
    left.tradeDate === right.tradeDate
      ? left.eventId.localeCompare(right.eventId)
      : left.tradeDate.localeCompare(right.tradeDate)
  );

  // ---- 核心读取：prefix(-10,-1,0) + post(1..10) ----
  const prefixByDay = new Map<number, Map<string, RightTailBarRow>>();
  for (const day of RIGHT_TAIL_PREFIX_RELATIVE_DAYS) {
    prefixByDay.set(day, indexByEventId(await access.feature(day)));
  }
  const eventDayByEvent = indexByEventId(await access.feature(0));
  const coreByDay = new Map<number, Map<string, RightTailBarRow>>();
  for (const day of RIGHT_TAIL_CORE_RELATIVE_DAYS) {
    coreByDay.set(day, indexByEventId(await access.observation(day)));
  }

  const reasonByEvent = new Map<string, string>();
  const factorMissingByCode: Record<string, number> = {};
  const bumpFactorMissing = (code: string): void => {
    factorMissingByCode[code] = (factorMissingByCode[code] ?? 0) + 1;
  };

  interface StageItem {
    event: RightTailEventRow;
    eventBar: EventDayBar;
    bars: ReadonlyArray<Bar | null>;
    entryOpen: number;
    preReturn10: number;
    amountPercentile: number | null;
  }

  // ---- Pass A（第 1~7 条）+ Pass B（前缀） ----
  const stage: StageItem[] = [];
  for (const event of uniqueEvents) {
    if (event.values.isFirstLimit !== true) {
      reasonByEvent.set(event.eventId, "NOT_FIRST_LIMIT");
      continue;
    }
    const boardType = event.values.boardType;
    const market = event.values.market;
    if (boardType !== "main" || (market !== "SH" && market !== "SZ")) {
      reasonByEvent.set(event.eventId, "NOT_MAIN_BOARD");
      continue;
    }
    const eventBar = parseEventDayBar(eventDayByEvent.get(event.eventId));
    if (!eventBar) {
      reasonByEvent.set(event.eventId, "MISSING_EVENT_DAY_BAR");
      continue;
    }
    const limitUpPrice = numberValue(event.values, "limitUpPrice");
    if (limitUpPrice === null || limitUpPrice <= 0) {
      reasonByEvent.set(event.eventId, "INVALID_EVENT_DAY_OHLC");
      continue;
    }
    if (Math.abs(eventBar.close - limitUpPrice) > EPSILON) {
      reasonByEvent.set(event.eventId, "EVENT_NOT_EXACT_LIMIT_UP");
      continue;
    }

    const bars: Array<Bar | null> = [];
    for (const day of RIGHT_TAIL_CORE_RELATIVE_DAYS) {
      bars.push(parseBar(coreByDay.get(day)?.get(event.eventId)));
    }
    let contextPathOk = true;
    for (let index = 0; index < CONTEXT_DAYS; index += 1) if (!bars[index]) contextPathOk = false;
    if (!contextPathOk) {
      reasonByEvent.set(event.eventId, "MISSING_FACTOR_PATH");
      continue;
    }
    let forwardPathOk = true;
    for (let index = CONTEXT_DAYS; index < PRIMARY_EXIT_RELATIVE_DAY; index += 1) {
      if (!bars[index]) forwardPathOk = false;
    }
    if (!forwardPathOk) {
      reasonByEvent.set(event.eventId, "MISSING_FORWARD_PATH");
      continue;
    }
    const entryBar = bars[CONTEXT_DAYS]!;
    if (entryBar.canBuyAtOpen !== true) {
      reasonByEvent.set(event.eventId, "ENTRY_UNFILLABLE");
      continue;
    }

    const prevClose = numberValue(prefixByDay.get(-1)?.get(event.eventId)?.values ?? {}, "close");
    const baseClose = numberValue(prefixByDay.get(-10)?.get(event.eventId)?.values ?? {}, "close");
    if (prevClose === null || baseClose === null || prevClose <= 0 || baseClose <= 0) {
      reasonByEvent.set(event.eventId, "MISSING_PREFIX_PATH");
      continue;
    }

    // 🔴 无回踩门：此处**刻意不**做 hasObservationPullback 判定

    stage.push({
      event,
      eventBar,
      bars,
      entryOpen: entryBar.open,
      preReturn10: prevClose / baseClose - 1,
      amountPercentile: null,
    });
  }

  // ---- Pass C：同日成交额分位（peer = 通过 Pass A/B 的全部事件） ----
  const peersByDate = new Map<string, number[]>();
  for (const item of stage) {
    const peers = peersByDate.get(item.event.tradeDate) ?? [];
    peers.push(item.eventBar.amount);
    peersByDate.set(item.event.tradeDate, peers);
  }
  for (const item of stage) {
    const peers = peersByDate.get(item.event.tradeDate) ?? [];
    item.amountPercentile = peers.length === 0 ? null : percentileRank(item.eventBar.amount, peers);
  }

  // ---- Pass D：12 因子（`limitGap` 的 null 为合法 UNKNOWN，不参与完整性判定） ----
  const samples: RightTailSample[] = [];
  let limitGapMissingCount = 0;
  for (const item of stage) {
    const eventClose = item.eventBar.close;
    const amplitudes: number[] = [];
    let runningPreClose = eventClose;
    let drawdownLow = Number.POSITIVE_INFINITY;
    let holdStreak = 0;
    let streakOpen = true;
    for (let index = 0; index < CONTEXT_DAYS; index += 1) {
      const bar = item.bars[index]!;
      amplitudes.push((bar.high - bar.low) / runningPreClose);
      runningPreClose = bar.close;
      drawdownLow = Math.min(drawdownLow, bar.low);
      if (streakOpen) {
        if (bar.close >= bar.limitUpPrice - EPSILON) holdStreak += 1;
        else streakOpen = false;
      }
    }
    const t1Bar = item.bars[0]!;
    const previousClose = numberValue(item.event.values, "previousClose");

    const factorValue: Record<RightTailFactorCode, number | null> = {
      bodyHeight:
        previousClose === null || previousClose <= 0 ? null : (eventClose - item.eventBar.open) / previousClose,
      turnover: numberValue(item.event.values, "turnover"),
      amountPercentile: item.amountPercentile,
      meanAmplitude: amplitudes.reduce((sum, value) => sum + value, 0) / CONTEXT_DAYS,
      maxAmplitude: Math.max(...amplitudes),
      holdStreak,
      t1VolumeRatio: item.eventBar.volume <= 0 ? null : t1Bar.volume / item.eventBar.volume,
      limitGap: numberValue(item.event.values, "daysSincePreviousLimit"),
      preReturn10: item.preReturn10,
      drawdownDepth: Number.isFinite(drawdownLow) ? drawdownLow / eventClose - 1 : null,
      t1OpenGap: t1Bar.open / eventClose - 1,
      historyLimitCount: numberValue(item.event.values, "historicalLimitCount"),
    };

    let complete = true;
    for (const code of RIGHT_TAIL_ALL_FACTOR_CODES) {
      if (code === "limitGap") continue; // UNKNOWN 是合法桶；原始值排序时单独记缺失码
      const value = factorValue[code];
      if (value === null || !Number.isFinite(value)) {
        bumpFactorMissing(code);
        complete = false;
      }
    }
    if (!complete) {
      reasonByEvent.set(item.event.eventId, "MISSING_FACTOR");
      continue;
    }
    if (factorValue.limitGap === null) {
      limitGapMissingCount += 1;
      bumpFactorMissing(limitGapMissingCode());
    }

    samples.push({
      eventId: item.event.eventId,
      symbol: item.event.symbol,
      decisionDate: item.event.tradeDate,
      year: Number(item.event.tradeDate.slice(0, 4)),
      entryOpen: item.entryOpen,
      factorValue,
    });
  }

  // ---- 退出解析（四个周期；主退出日不可卖 ⇒ 顺延到其后第一个可卖收盘） ----
  const inPool = new Set(samples.map((sample) => sample.eventId));
  const chosen = new Map<string, { exitRelativeDay: number; exitPrice: number; exitDate: string; deferred: boolean }>();
  for (const horizon of RIGHT_TAIL_HORIZONS) {
    for (const sample of samples) chosen.delete(`${horizon.label}|${sample.eventId}`);
  }
  const chosenByHorizon = new Map<string, Map<string, { exitRelativeDay: number; exitPrice: number; exitDate: string; deferred: boolean }>>();
  for (const horizon of RIGHT_TAIL_HORIZONS) chosenByHorizon.set(horizon.label, new Map());

  for (const day of RIGHT_TAIL_EXIT_RELATIVE_DAYS) {
    const rows = await access.observation(day);
    for (const row of rows) {
      if (!inPool.has(row.eventId)) continue;
      for (const horizon of RIGHT_TAIL_HORIZONS) {
        if (day < horizon.primaryExitRelativeDay || day > horizon.lastExitRelativeDay) continue;
        const target = chosenByHorizon.get(horizon.label)!;
        if (target.has(row.eventId)) continue; // 已取到更早的可卖日 ⇒ 保留
        if (row.values.barPresent === false || row.values.barPresent === 0) continue;
        if (row.values.suspensionStatus === "SUSPENDED") continue;
        if (!booleanValue(row.values, "canSellAtClose")) continue;
        const close = numberValue(row.values, "close");
        if (close === null || close <= 0) continue;
        target.set(row.eventId, {
          exitRelativeDay: day,
          exitPrice: close,
          exitDate: row.tradeDate,
          deferred: day !== horizon.primaryExitRelativeDay,
        });
      }
    }
  }

  const outcomesByEventId = new Map<string, RightTailOutcome[]>();
  const deferredCountByHorizon: Record<string, number> = {};
  const noExitCountByHorizon: Record<string, number> = {};
  for (const horizon of RIGHT_TAIL_HORIZONS) {
    deferredCountByHorizon[horizon.label] = 0;
    noExitCountByHorizon[horizon.label] = 0;
  }
  for (const sample of samples) {
    const list: RightTailOutcome[] = [];
    for (const horizon of RIGHT_TAIL_HORIZONS) {
      const exit = chosenByHorizon.get(horizon.label)!.get(sample.eventId);
      if (!exit) {
        noExitCountByHorizon[horizon.label] = (noExitCountByHorizon[horizon.label] ?? 0) + 1;
        continue;
      }
      if (exit.deferred) {
        deferredCountByHorizon[horizon.label] = (deferredCountByHorizon[horizon.label] ?? 0) + 1;
      }
      const grossReturn = exit.exitPrice / sample.entryOpen - 1;
      list.push({
        eventId: sample.eventId,
        holdingDays: horizon.holdingDays,
        exitRelativeDay: exit.exitRelativeDay,
        exitDate: exit.exitDate,
        exitPrice: exit.exitPrice,
        grossReturn,
        netReturn: grossReturn - RIGHT_TAIL_ROUND_TRIP_COST,
        deferred: exit.deferred,
      });
    }
    outcomesByEventId.set(sample.eventId, list);
  }

  const excludedByReason: Record<string, number> = {};
  for (const event of uniqueEvents) {
    const reason = reasonByEvent.get(event.eventId);
    if (!reason) continue;
    excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
  }

  const datasetEventCount = facts?.totalEvents ?? null;
  const unscannedEventCount =
    datasetEventCount === null ? null : Math.max(0, datasetEventCount - uniqueEvents.length);

  return {
    samples,
    outcomesByEventId,
    candidateCount: uniqueEvents.length,
    excludedByReason,
    factorMissingByCode,
    limitGapMissingCount,
    deferredCountByHorizon,
    noExitCountByHorizon,
    decisionDateCount: new Set(samples.map((sample) => sample.decisionDate)).size,
    duplicateEventIdCount,
    datasetEventCount,
    unscannedEventCount,
    readRelativeDays: RIGHT_TAIL_POST_RELATIVE_DAYS,
  };
}

// ---------------------------------------------------------------------------
// 年内归一化（`historyLimitCount` 等累计量的**强制**年度切片口径）
// ---------------------------------------------------------------------------

/**
 * 逐因子的**年内百分位**（`count(<=value)/n`，仅在同一年内比较）。
 *
 * 🔴 用途：年度稳定性切片。**不得**用跨年份原始累计值直接判断年度稳定性 ——
 * `RESULT-TAIL-EXPLORE-001` §6.1 已证该做法会让 42% 的表观信号来自年份漂移。
 */
export function yearPercentileByCode(
  samples: readonly RightTailSample[],
  code: RightTailFactorCode
): Map<string, number | null> {
  const byYear = new Map<number, { eventId: string; value: number }[]>();
  for (const sample of samples) {
    const value = sample.factorValue[code];
    if (value === null || !Number.isFinite(value)) continue;
    const bucket = byYear.get(sample.year) ?? [];
    bucket.push({ eventId: sample.eventId, value });
    byYear.set(sample.year, bucket);
  }
  const result = new Map<string, number | null>();
  for (const sample of samples) result.set(sample.eventId, null);
  for (const bucket of byYear.values()) {
    const sorted = bucket.map((item) => item.value).sort((a, b) => a - b);
    for (const item of bucket) {
      let belowOrEqual = 0;
      for (const value of sorted) if (value <= item.value) belowOrEqual += 1;
      result.set(item.eventId, belowOrEqual / sorted.length);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// `RIGHT-TAIL-ENTRY-TIMING-001`：入场时点 × 固定持有长度
// ---------------------------------------------------------------------------

/** 一个「事件 × 入场时点 × 持有长度」格子的净/毛收益。 */
export interface EntryTimingCell {
  readonly eventId: string;
  readonly entryRelativeDay: number;
  readonly holdingDays: number;
  readonly entryDate: string;
  readonly entryOpen: number;
  readonly exitRelativeDay: number;
  readonly exitDate: string;
  readonly exitPrice: number;
  readonly grossReturn: number;
  readonly netReturn: number;
  readonly deferred: boolean;
}

export interface EntryTimingPanel {
  /** `armKey(entryRelativeDay, holdingDays)` → `eventId` → cell。 */
  readonly cellsByArm: ReadonlyMap<string, ReadonlyMap<string, EntryTimingCell>>;
  /** 逐入场时点：「入场日开盘不可买」而剔除的池内样本数。 */
  readonly entryUnfillableByEntry: Record<string, number>;
  /** 逐臂：「主退出日 + 顺延窗口内无可卖收盘」而剔除的池内样本数。 */
  readonly noExitByArm: Record<string, number>;
  /** 逐臂：使用了顺延的格子数。 */
  readonly deferredByArm: Record<string, number>;
  readonly readRelativeDays: readonly number[];
}

export function entryTimingArmKey(entryRelativeDay: number, holdingDays: number): string {
  return `${entryRelativeDay}|${holdingDays}`;
}

/**
 * 派生「入场时点 × 固定持有长度」面板。
 *
 * 🔴 **只接受已派生的 `samples`** —— 池与因子值**逐对象复用**，因此
 * `RIGHT-TAIL-RESEARCH-002` 的因子值不可能被重算（满足入场实验 ABORT-5）。
 *
 * 口径：`Entry = open(T+entryRelativeDay)`（`canBuyAtOpen`）；`Exit = close(entry + N + exitOffsetDays)`；
 * 主退出不可卖 ⇒ 顺延到其后第一个可卖收盘，最多 `+10` 个交易日，且 `≤ rd80`。
 * 非交易/停牌/无 bar 一律剔除，**不插补、不顺延到窗口外**。
 */
export async function deriveEntryTimingOutcomes(
  access: RightTailDatasetAccess,
  samples: readonly RightTailSample[],
  entryRelativeDays: readonly number[],
  holdingPeriods: readonly number[],
  /**
   * 退出相对日偏移：`primary = entryRd + N + exitOffsetDays`。
   *
   * - `0`（默认）= `RIGHT-TAIL-ENTRY-TIMING-001` 口径（`Exit = Entry 后第 N 个交易日`）
   * - `-1` = `RIGHT-TAIL-RESEARCH-002` 的 `D1-a` 口径（`Exit = Entry + N − 1`），**仅作稳健性对照**
   *
   * 臂的 key 仍为 `${entryRd}|${N}`（**不含**偏移）；两次调用请各自存放结果。
   */
  exitOffsetDays = 0
): Promise<EntryTimingPanel> {
  const inPool = new Set(samples.map((sample) => sample.eventId));
  const entryUnfillableByEntry: Record<string, number> = {};
  const noExitByArm: Record<string, number> = {};
  const deferredByArm: Record<string, number> = {};

  // ---- 入场日开盘（canBuyAtOpen）----
  const entryPriceByEntry = new Map<number, Map<string, { open: number; date: string }>>();
  for (const entryDay of entryRelativeDays) {
    const rows = await access.observation(entryDay);
    const accepted = new Map<string, { open: number; date: string }>();
    let unfillable = 0;
    for (const row of rows) {
      if (!inPool.has(row.eventId)) continue;
      if (row.values.barPresent === false || row.values.barPresent === 0) { unfillable += 1; continue; }
      if (row.values.suspensionStatus === "SUSPENDED") { unfillable += 1; continue; }
      if (!booleanValue(row.values, "canBuyAtOpen")) { unfillable += 1; continue; }
      const open = numberValue(row.values, "open");
      if (open === null || open <= 0) { unfillable += 1; continue; }
      accepted.set(row.eventId, { open, date: row.tradeDate });
    }
    entryPriceByEntry.set(entryDay, accepted);
    entryUnfillableByEntry[String(entryDay)] = unfillable;
  }

  // ---- 臂与退出窗口 ----
  interface Arm { key: string; entryDay: number; holding: number; primary: number; last: number; }
  const arms: Arm[] = [];
  for (const entryDay of entryRelativeDays) {
    for (const holding of holdingPeriods) {
      const primary = entryDay + holding + exitOffsetDays;
      arms.push({
        key: entryTimingArmKey(entryDay, holding),
        entryDay,
        holding,
        primary,
        last: Math.min(primary + RIGHT_TAIL_DEFERRAL_MAX_DAYS, RIGHT_TAIL_MAX_RELATIVE_DAY),
      });
      noExitByArm[entryTimingArmKey(entryDay, holding)] = 0;
      deferredByArm[entryTimingArmKey(entryDay, holding)] = 0;
    }
  }
  const armsByDay = new Map<number, Arm[]>();
  for (const arm of arms) {
    for (let day = arm.primary; day <= arm.last; day += 1) {
      const bucket = armsByDay.get(day) ?? [];
      bucket.push(arm);
      armsByDay.set(day, bucket);
    }
  }
  const readDays = [...armsByDay.keys()].sort((left, right) => left - right);

  const chosen = new Map<string, Map<string, { exitRelativeDay: number; exitPrice: number; exitDate: string }>>();
  for (const arm of arms) chosen.set(arm.key, new Map());
  for (const day of readDays) {
    const rows = await access.observation(day);
    const dayArms = armsByDay.get(day)!;
    for (const row of rows) {
      if (!inPool.has(row.eventId)) continue;
      if (row.values.barPresent === false || row.values.barPresent === 0) continue;
      if (row.values.suspensionStatus === "SUSPENDED") continue;
      if (!booleanValue(row.values, "canSellAtClose")) continue;
      const close = numberValue(row.values, "close");
      if (close === null || close <= 0) continue;
      for (const arm of dayArms) {
        const target = chosen.get(arm.key)!;
        if (target.has(row.eventId)) continue; // 已取到更早的可卖日
        target.set(row.eventId, { exitRelativeDay: day, exitPrice: close, exitDate: row.tradeDate });
      }
    }
  }

  const cellsByArm = new Map<string, Map<string, EntryTimingCell>>();
  for (const arm of arms) {
    const cells = new Map<string, EntryTimingCell>();
    const entryPrices = entryPriceByEntry.get(arm.entryDay)!;
    const exits = chosen.get(arm.key)!;
    for (const sample of samples) {
      const entry = entryPrices.get(sample.eventId);
      if (!entry) continue; // 入场不可买 ⇒ entryUnfillableByEntry 已计
      const exit = exits.get(sample.eventId);
      if (!exit) {
        noExitByArm[arm.key] = (noExitByArm[arm.key] ?? 0) + 1;
        continue;
      }
      const grossReturn = exit.exitPrice / entry.open - 1;
      const deferred = exit.exitRelativeDay !== arm.primary;
      if (deferred) deferredByArm[arm.key] = (deferredByArm[arm.key] ?? 0) + 1;
      cells.set(sample.eventId, {
        eventId: sample.eventId,
        entryRelativeDay: arm.entryDay,
        holdingDays: arm.holding,
        entryDate: entry.date,
        entryOpen: entry.open,
        exitRelativeDay: exit.exitRelativeDay,
        exitDate: exit.exitDate,
        exitPrice: exit.exitPrice,
        grossReturn,
        netReturn: grossReturn - RIGHT_TAIL_ROUND_TRIP_COST,
        deferred,
      });
    }
    cellsByArm.set(arm.key, cells);
  }

  return {
    cellsByArm,
    entryUnfillableByEntry,
    noExitByArm,
    deferredByArm,
    readRelativeDays: readDays,
  };
}
