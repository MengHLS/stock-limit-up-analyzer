/**
 * 十二因子样本派生（Pass A~D）—— 冻结契约在代码里的**样本侧唯一落地处**。
 *
 * ## 为什么单独一个文件
 *
 * 这段逻辑原本内联在 `experiment.ts` 的 `run()` 里。「Top-N 排名」实验必须与
 * 「等权综合评分」实验跑在**逐字相同**的样本上（同样的入池条件、同样的因子值、
 * 同样的入场/退出/成本），否则两者的数字不可比。样本口径属于
 * `FROZEN-BUCKET-CONTRACT-001` 的冻结范围 —— 两份实现各写一遍必然漂移，
 * 而漂移是静默的（只会表现为两个实验的样本数不同）。因此抽到这里共用。
 *
 * 先例：`first-board-pullback/stability-validation` 复用
 * `first-board-pullback/fundamental-study/result` 的导出。
 *
 * ## 边界
 *
 * - 本文件**不含**任何因子定义 / 桶边界 / 方向 / 权重 —— 那些在 `./result.ts`；
 * - 本文件只做「从 Dataset 读出事件与行情 → 判定入池 → 算出 12 个因子值 + 净收益」；
 * - 🔴 语义与搬出前**逐字一致**；改动会同时影响两个已注册实验，必须同步升版本。
 *
 * ## 派生顺序（与搬出前一致，不可随意重排）
 *
 * ```
 * events() → feature(0) → feature(-10) / feature(-1) → observation(1..20)
 * Pass A 第 1~7 条 → Pass B 第 8 条（前置窗口）→ Pass C 同日成交额分位 → Pass D 第 9 条
 * ```
 *
 * `freezeSelection` 在**第一次读 `observation()` 之前**调用（平台硬约束：
 * 未来数据只能服务于已冻结样本的结果观察，不能反过来决定谁入池）。
 */

import type {
  ExperimentEvaluationWindow,
  ExperimentEventRow,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  MAX_RELATIVE_DAY,
  ROUND_TRIP_COST_BPS,
  type TwelveFactorSample,
} from "./result";

/** 决策只用到 T+5 收盘为止的信息 ⇒ 入场只能落在 T+6 开盘。 */
export const DECISION_OFFSET_DAYS = ENTRY_DAY - 1;
/** 因子需要 T+1..T+5 的行情（starts at CONTEXT_DAYS index 0）。 */
const CONTEXT_DAYS = DECISION_OFFSET_DAYS;
/** 前置窗口：T-1（前期涨幅的末端）与 T-10（起点）。 */
export const PREFIX_RELATIVE_DAYS = [-10, -1] as const;
/** post 侧要读到 T+20（顺延退出最多用到）。 */
export const POST_RELATIVE_DAYS = Array.from(
  { length: MAX_RELATIVE_DAY },
  (_, index) => index + 1
);
const EPSILON = 1e-9;

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

function numberValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string
): number | null {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(
  values: Readonly<Record<string, number | boolean | string | null>>,
  key: string
): boolean {
  return values[key] === true;
}

function parseEventDayBar(row: ExperimentEventRow | undefined): EventDayBar | null {
  if (!row) return null;
  const open = numberValue(row.values, "open");
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  const volume = numberValue(row.values, "volume");
  const amount = numberValue(row.values, "amount");
  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    amount === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    volume <= 0 ||
    amount < 0
  ) {
    return null;
  }
  return { open, high, low, close, volume, amount };
}

function parseBar(row: ExperimentEventRow | undefined): Bar | null {
  if (!row) return null;
  if (row.values.barPresent === false) return null;
  if (row.values.suspensionStatus === "SUSPENDED") return null;
  const open = numberValue(row.values, "open");
  const high = numberValue(row.values, "high");
  const low = numberValue(row.values, "low");
  const close = numberValue(row.values, "close");
  const volume = numberValue(row.values, "volume");
  const limitUpPrice = numberValue(row.values, "limitUpPrice");
  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    limitUpPrice === null ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    volume <= 0 ||
    limitUpPrice <= 0 ||
    high < Math.max(open, close) ||
    low > Math.min(open, close) ||
    high < low
  ) {
    return null;
  }
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

/**
 * 同日横截面百分位（`count(peer <= value) / N`，peer 含自身）。
 *
 * 与 `dynamic-state-factor-expansion-study/result.ts:205-212` 同法；
 * 该函数未上提到共享层，这里按既有口径保留一份，**不改变语义**。
 */
function percentileRank(value: number, peers: readonly number[]): number {
  if (peers.length <= 1) return 0.5;
  const belowOrEqual = peers.filter(peer => peer <= value).length;
  return belowOrEqual / peers.length;
}

function sortEventRows(left: ExperimentEventRow, right: ExperimentEventRow): number {
  return left.tradeDate === right.tradeDate
    ? left.eventId.localeCompare(right.eventId)
    : left.tradeDate.localeCompare(right.tradeDate);
}

/**
 * 入池样本的**事件元数据**（真实交易日 + 代码）。
 *
 * ## 为什么加这个（RESEARCH-EXPERIMENT 单因子模板，2026-09-25）
 *
 * 单因子模板的逐笔留档要求 `stockCode / signalDate / entryDate / exitDate / holdingDays`，
 * 而这些字段都是「平台数据里已有的、但原 `TwelveFactorSample` 没带」的事实。
 *
 * 🔴 它们**只增不改**：不参与任何计算，也不是判定条件 ——
 *    `TwelveFactorSample` 的字段与语义一个字都没动，
 *    因此 12F / Top-N 两个已注册实验的数字与代码指纹都不受影响。
 *    之所以放在这里而不是让新模板自己再读一遍行情：
 *    `exitRelativeDay` 是「主退出不可卖就顺延」的结果，**规则只有这一处实现**，
 *    让别处再解一次就等于长出第二套退出语义（迟早漂移，而且漂移是静默的）。
 */
export interface TwelveFactorUniverseFact {
  /** 代码域标识（`symbol`，如 `600000.SH`）。 */
  stockCode: string;
  /** 信息截止日（`T+5` 的真实交易日）。 */
  signalDate: string;
  /** 入场日（`T+6` 的真实交易日）。 */
  entryDate: string;
  /** 实际退出日（`T+10`，或其后第一个可卖日）。 */
  exitDate: string;
  entryRelativeDay: number;
  exitRelativeDay: number;
}

export interface TwelveFactorDerivation {
  /** 12 因子齐全、且入场/退出都可执行的样本（字段名与 `assemble*` 入参一致）。 */
  samples: TwelveFactorSample[];
  /** 每个入池样本的事件元数据（key = `eventId`，与 `samples` 一一对应）。 */
  universeFacts: ReadonlyMap<string, TwelveFactorUniverseFact>;
  candidateCount: number;
  exactLimitUpCloseCount: number;
  excludedByReason: Record<string, number>;
  factorMissingByCode: Record<string, number>;
  datasetEventCount: number | null;
  unscannedEventCount: number | null;
  duplicateEventIdCount: number;
  crossSectionPeerCount: number;
  prefixWindowMissingCount: number;
  /**
   * 本次 Run 的**平台评估窗口**（`OBSERVATION` / `HOLDOUT` 才有；`EXPLORATORY` 恒 `null`）。
   *
   * 🔴 本派生层**不自己过滤**事件：窗口是在取数层施加的
   *    （`server/researchExperiments/datasetPort.ts` 把 `evaluationWindow` 转成
   *    `fromDate` / `toDate` 传给读取层），因此这里读到的 `events()` 已经是窗口内的。
   *    登记它只为两件事：① 样本账不再谎报「全库候选数」；② 信封可追溯跑了哪一段。
   */
  evaluationWindow: ExperimentEvaluationWindow | null;
}

export async function deriveTwelveFactorSamples(
  context: ExperimentRunContext
): Promise<TwelveFactorDerivation> {
  // 平台评估窗口（`EXPLORATORY` ⇒ null）。窗口过滤发生在**取数层**，这里只登记。
  const evaluationWindow = context.protocol?.evaluationWindow ?? null;
  const events = await context.dataset.events();
  const deduped = new Map<string, ExperimentEventRow>();
  let duplicateEventIdCount = 0;
  for (const event of events) {
    if (deduped.has(event.eventId)) {
      duplicateEventIdCount += 1;
      continue;
    }
    deduped.set(event.eventId, event);
  }
  const uniqueEvents = [...deduped.values()].sort(sortEventRows);
  context.freezeSelection(uniqueEvents.map(event => event.eventId));

  const eventDayRows = await context.dataset.feature(0);
  const eventDayByEvent = new Map(eventDayRows.map(row => [row.eventId, row]));
  const prefixByDay = new Map<number, Map<string, ExperimentEventRow>>();
  for (const day of PREFIX_RELATIVE_DAYS) {
    const rows = await context.dataset.feature(day);
    prefixByDay.set(day, new Map(rows.map(row => [row.eventId, row])));
  }
  const postByDay = new Map<number, Map<string, ExperimentEventRow>>();
  for (const day of POST_RELATIVE_DAYS) {
    const rows = await context.dataset.observation(day);
    postByDay.set(day, new Map(rows.map(row => [row.eventId, row])));
  }

  const reasonByEvent = new Map<string, string>();
  const factorMissingByCode: Record<string, number> = {};
  const bumpFactorMissing = (code: string): void => {
    factorMissingByCode[code] = (factorMissingByCode[code] ?? 0) + 1;
  };

  interface StageItem {
    event: ExperimentEventRow;
    eventBar: EventDayBar;
    bars: ReadonlyArray<Bar | null>;
    entryOpen: number;
    exitIndex: number;
    exitPrice: number;
    preReturn10: number;
    amountPercentile: number;
  }

  // ---- Pass A：入池第 1~7 条 ----
  let exactLimitUpCloseCount = 0;
  const stageA: Array<Omit<StageItem, "preReturn10" | "amountPercentile">> = [];
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
    exactLimitUpCloseCount += 1;

    const bars: Array<Bar | null> = [];
    for (const day of POST_RELATIVE_DAYS) {
      bars.push(parseBar(postByDay.get(day)?.get(event.eventId)));
    }
    let contextPathOk = true;
    for (let index = 0; index < CONTEXT_DAYS; index += 1) {
      if (!bars[index]) contextPathOk = false;
    }
    if (!contextPathOk) {
      reasonByEvent.set(event.eventId, "MISSING_FACTOR_PATH");
      continue;
    }
    let forwardPathOk = true;
    for (let index = CONTEXT_DAYS; index < EXIT_RELATIVE_DAY; index += 1) {
      if (!bars[index]) forwardPathOk = false;
    }
    if (!forwardPathOk) {
      reasonByEvent.set(event.eventId, "MISSING_FORWARD_PATH");
      continue;
    }
    const entryBar = bars[CONTEXT_DAYS]!;
    if (!entryBar.canBuyAtOpen) {
      reasonByEvent.set(event.eventId, "ENTRY_UNFILLABLE");
      continue;
    }
    const primaryExitBar = bars[EXIT_RELATIVE_DAY - 1]!;
    let exitIndex = EXIT_RELATIVE_DAY;
    let exitPrice: number | null = primaryExitBar.canSellAtClose
      ? primaryExitBar.close
      : null;
    if (exitPrice === null) {
      for (let day = EXIT_RELATIVE_DAY + 1; day <= MAX_RELATIVE_DAY; day += 1) {
        const fallback = bars[day - 1];
        if (fallback && fallback.canSellAtClose) {
          exitPrice = fallback.close;
          exitIndex = day;
          break;
        }
      }
    }
    if (exitPrice === null) {
      reasonByEvent.set(event.eventId, "NO_EXECUTABLE_EXIT");
      continue;
    }
    stageA.push({
      event,
      eventBar,
      bars,
      entryOpen: entryBar.open,
      exitIndex,
      exitPrice,
    });
  }

  // ---- Pass B：入池第 8 条（T-1 / T-10 前置窗口）----
  let prefixWindowMissingCount = 0;
  const stageB: Array<Omit<StageItem, "amountPercentile">> = [];
  for (const item of stageA) {
    const prevRow = prefixByDay.get(-1)?.get(item.event.eventId);
    const baseRow = prefixByDay.get(-10)?.get(item.event.eventId);
    const prevClose = prevRow ? numberValue(prevRow.values, "close") : null;
    const baseClose = baseRow ? numberValue(baseRow.values, "close") : null;
    if (
      prevClose === null ||
      baseClose === null ||
      prevClose <= 0 ||
      baseClose <= 0
    ) {
      prefixWindowMissingCount += 1;
      reasonByEvent.set(item.event.eventId, "MISSING_PREFIX_PATH");
      continue;
    }
    stageB.push({ ...item, preReturn10: prevClose / baseClose - 1 });
  }

  // ---- Pass C：同日成交额分位（peer = 通过第 1~8 条的全部事件）----
  const peersByDate = new Map<string, number[]>();
  for (const item of stageB) {
    const peers = peersByDate.get(item.event.tradeDate) ?? [];
    peers.push(item.eventBar.amount);
    peersByDate.set(item.event.tradeDate, peers);
  }
  const crossSectionPeerCount = stageB.length;

  // ---- Pass D：入池第 9 条（12 因子完备用例）----
  const samples: TwelveFactorSample[] = [];
  const universeFacts = new Map<string, TwelveFactorUniverseFact>();
  for (const item of stageB) {
    const bars = item.bars;
    const eventClose = item.eventBar.close;
    const previousClose = numberValue(item.event.values, "previousClose");
    const turnover = numberValue(item.event.values, "turnover");
    const historyLimitCount = numberValue(
      item.event.values,
      "historicalLimitCount"
    );
    const limitGapRaw = numberValue(item.event.values, "daysSincePreviousLimit");

    const amplitudes: number[] = [];
    let runningPreClose = eventClose;
    let drawdownLow = Number.POSITIVE_INFINITY;
    let holdStreak = 0;
    let streakOpen = true;
    for (let index = 0; index < CONTEXT_DAYS; index += 1) {
      const bar = bars[index]!;
      amplitudes.push((bar.high - bar.low) / runningPreClose);
      runningPreClose = bar.close;
      drawdownLow = Math.min(drawdownLow, bar.low);
      if (streakOpen) {
        if (bar.close >= bar.limitUpPrice - EPSILON) holdStreak += 1;
        else streakOpen = false;
      }
    }
    const meanAmplitude =
      amplitudes.reduce((sum, value) => sum + value, 0) / CONTEXT_DAYS;
    const maxAmplitude = Math.max(...amplitudes);
    const t1Bar = bars[0]!;

    const factors: Record<string, number | null> = {
      bodyHeight:
        previousClose === null || previousClose <= 0
          ? null
          : (eventClose - item.eventBar.open) / previousClose,
      turnover,
      amountPercentile: (() => {
        const peers = peersByDate.get(item.event.tradeDate) ?? [];
        return peers.length === 0
          ? null
          : percentileRank(item.eventBar.amount, peers);
      })(),
      meanAmplitude,
      maxAmplitude,
      holdStreak,
      t1VolumeRatio:
        item.eventBar.volume <= 0 ? null : t1Bar.volume / item.eventBar.volume,
      limitGap: limitGapRaw,
      preReturn10: item.preReturn10,
      drawdownDepth:
        Number.isFinite(drawdownLow) ? drawdownLow / eventClose - 1 : null,
      t1OpenGap: t1Bar.open / eventClose - 1,
      historyLimitCount,
    };

    let complete = true;
    for (const [code, value] of Object.entries(factors)) {
      // limitGap 的 null 是契约里合法的 UNKNOWN 桶，不算缺失。
      if (code === "limitGap") continue;
      if (value === null || !Number.isFinite(value)) {
        bumpFactorMissing(code);
        complete = false;
      }
    }
    if (!complete) {
      reasonByEvent.set(item.event.eventId, "MISSING_FACTOR");
      continue;
    }

    let peak = Number.NEGATIVE_INFINITY;
    let trough = Number.POSITIVE_INFINITY;
    for (
      let index = CONTEXT_DAYS;
      index < item.exitIndex && index < bars.length;
      index += 1
    ) {
      const bar = bars[index];
      if (!bar) continue;
      peak = Math.max(peak, bar.high);
      trough = Math.min(trough, bar.low);
    }
    samples.push({
      eventId: item.event.eventId,
      eventDate: item.event.tradeDate,
      year: Number(item.event.tradeDate.slice(0, 4)),
      entryOpen: item.entryOpen,
      exitPrice: item.exitPrice,
      netReturn:
        item.exitPrice / item.entryOpen - 1 - ROUND_TRIP_COST_BPS / 10_000,
      mfe: Number.isFinite(peak) ? peak / item.entryOpen - 1 : 0,
      mae: Number.isFinite(trough) ? trough / item.entryOpen - 1 : 0,
      factors: factors as TwelveFactorSample["factors"],
    });

    // 事件元数据（只增不改口径）。上述 contextPathOk / forwardPathOk 已保证
    // rd=ENTRY_DAY−1、rd=ENTRY_DAY 与 rd=exitIndex 的行情行确实存在 ⇒ 这里取不到即为内部不一致。
    const signalRow = postByDay.get(ENTRY_DAY - 1)?.get(item.event.eventId);
    const entryRow = postByDay.get(ENTRY_DAY)?.get(item.event.eventId);
    const exitRow = postByDay.get(item.exitIndex)?.get(item.event.eventId);
    if (signalRow === undefined || entryRow === undefined || exitRow === undefined) {
      throw new Error(
        `公共底座内部不一致：事件 ${item.event.eventId} 缺少 rd=${ENTRY_DAY - 1}/` +
          `${ENTRY_DAY}/${item.exitIndex} 的行情行（入池判定本应已排除此情形）`
      );
    }
    universeFacts.set(item.event.eventId, {
      stockCode: item.event.symbol,
      signalDate: signalRow.tradeDate,
      entryDate: entryRow.tradeDate,
      exitDate: exitRow.tradeDate,
      entryRelativeDay: ENTRY_DAY,
      exitRelativeDay: item.exitIndex,
    });
  }

  const excludedByReason: Record<string, number> = {};
  for (const event of uniqueEvents) {
    const reason = reasonByEvent.get(event.eventId);
    if (!reason) continue;
    excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
  }

  // 🔴 有评估窗口时**不得**报「全库事件数 − 窗口内唯一事件数」这种差值：
  //    那会把「窗口外的事件」统统算成 `unscanned`（未扫描），是谎报。
  //    与先例一致（`first-board-pullback/oversold-gap-reversal-validation/experiment.ts`）：
  //    窗口化 Run 的这两个量一律为 `null`（= 不可得），不编造。
  const datasetEventCount =
    evaluationWindow === null ? context.dataset.facts.totalEvents : null;
  const unscannedEventCount =
    datasetEventCount === null
      ? null
      : Math.max(0, datasetEventCount - uniqueEvents.length);

  return {
    samples,
    universeFacts,
    candidateCount: uniqueEvents.length,
    exactLimitUpCloseCount,
    excludedByReason,
    factorMissingByCode,
    datasetEventCount,
    unscannedEventCount,
    duplicateEventIdCount,
    crossSectionPeerCount,
    prefixWindowMissingCount,
    evaluationWindow,
  };
}
