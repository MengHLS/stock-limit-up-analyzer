/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` —— 滚动观察池的**纯研究投影**。
 *
 * ## 这一段做什么
 *
 * 把「逐事件 × 逐相对日」的行情账，投影成**股票级每日面板**：
 * 每天先取当时仍在 `rd1..40` 的事件成员，**同 symbol 只保留最早尚未过期成员作为锚点**，
 * 其余登记进 `relatedEventIds`；然后只用**当天收盘可知**的信息判定资格、算两个因子、排名。
 *
 * ## 为什么是「投影」而不是生产池表
 *
 * 规格 §S2：`每日池转为股票级研究面板，是研究投影，不新建生产池表`。
 * 既有生产级池化游标（`server/runWorkbenchAssembly/pooledDatasetCursor.ts`）刻意
 * **允许同股多成员**（`allowMultipleMembersPerSecurity` 缺省 `true`）且没有锚点概念，
 * 与本 MVP 的「同股不重复」规则语义不同 ⇒ 不修改它，另做研究投影。
 *
 * ## 契约缺口（如实登记，见 S1 §4）
 *
 * `decisionOffsetDays` 是**单标量**，无法表达逐日变化的决策坐标。
 * 本投影把逐日坐标表达为**纯函数**（输入 = 已冻结的候选事件 + 已声明的相对日并集），
 * 不谎报固定坐标、不新开 legacy 路径。
 *
 * ## 纯函数纪律
 *
 * 无 IO、无 `Date.now`、无 `Math.random`。`maxAmp5` 由调用方注入（Core 权威实现），
 * 本模块**不复制振幅公式**。
 */

import {
  MAIN_WINDOW,
  RANDOM_DRAW_COUNT,
  RANDOM_SEED_BASE,
  REJECTION_REASON_LABELS,
  SELECT_MAX_AGE,
  SELECT_MIN_AGE,
  SELECTABLE_AGE_LOWER_BOUND,
  TOP_K,
  WATCH_MAX_AGE,
  WATCH_MIN_AGE,
  PRE_RETURN10_PREFIX_DAYS,
  type DailyPoolRow,
  type DailyStStatus,
  type RejectionReasonCode,
} from "./types";
import { pickUniformRandomSubset } from "../singleFactor/rightTailMetrics";

// ---------------------------------------------------------------------------
// 一、输入形态（由 `experiment.ts` 从 Dataset 端口行归一化而来）
// ---------------------------------------------------------------------------

/** 归一化 bar（缺列 → `null`；`undefined` 与「真实缺失」严格分开）。 */
export interface PoolBar {
  readonly relativeDay: number;
  readonly tradeDate: string;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly close: number | null;
  readonly preClose: number | null;
  readonly limitUpPrice: number | null;
  readonly limitDownPrice: number | null;
  /**
   * 成交量（手）。
   *
   * 🔴 由 `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` **追加**（原右尾实验不读它）。
   * 旧实验的 `observation` 列投影**未声明 `volume`** ⇒ 该字段在旧实验里恒为 `null`，
   * 且旧实验的任何计算都不读它 ⇒ **旧实验行为与其产物逐字节不变**。
   * 续研实验在自己的 `requiredColumns.observation` 里声明 `volume`，从而拿到真实值。
   */
  readonly volume: number | null;
  /**
   * 成交额（**千元**，与平台 `CanonicalMarketBar.amount` 同单位）。
   *
   * 🔴 由 `OBSERVATION-WINDOW-003` 追加（原右尾实验不读它）。旧实验的列投影未声明 `amount`
   * ⇒ 该字段在旧实验里恒为 `null` 且旧实验不读它 ⇒ **旧实验行为与产物逐字节不变**。
   * 续研实验声明 `amount` 后即可恢复引擎的**流动性分层滑点**（<1 亿 +20bps）。
   */
  readonly amount: number | null;
  readonly barPresent: boolean;
  readonly suspended: boolean;
  readonly canBuyAtOpen: boolean | null;
  readonly canSellAtClose: boolean | null;
}

/** 归一化事件（只含本 MVP 需要的字段）。 */
export interface PoolEvent {
  readonly eventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly year: number;
  readonly market: string;
  readonly boardType: string;
  readonly isFirstLimit: boolean;
  /** prefix 相对日 → bar（含 rd0 = 事件日）。 */
  readonly prefix: ReadonlyMap<number, PoolBar>;
  /** post 相对日 → bar（rd ≥ 1）。 */
  readonly post: ReadonlyMap<number, PoolBar>;
}

/**
 * `maxAmp5` 计算器（**注入**）。
 *
 * 调用方必须用 Strategy Core 的权威 `FeatureDefinition` 实现它
 * （`@experiments/strategyCoreBridge` + `EVENT_STATE_AMPLITUDE_FEATURE_IDS.maxAmp5`），
 * 并经 Core 的日范围可见性访问器取 bar。本模块只管「rd1..15 全不全」。
 */
export type MaxAmp5Computer = (input: {
  readonly eventId: string;
  readonly eventDayBar: PoolBar;
  /** rd1..rd15 的 bar（升序）；调用方保证长度 = 15 且逐根可用。 */
  readonly barsThroughRd15: readonly PoolBar[];
}) => number | null;

// ---------------------------------------------------------------------------
// 二、事件级因子（与决策年龄无关 —— 这是 PIT 上最容易被搞错的一点）
// ---------------------------------------------------------------------------

export interface EventFactorValues {
  /** `close(rd−1)/close(rd−10) − 1`；不可评估 ⇒ `null`。 */
  readonly preReturn10: number | null;
  readonly preReturn10MissingReason: "MISSING_PREFIX_PATH" | null;
  /** `maxAmp5`（Core rd11~15 冻结口径）；不可评估 ⇒ `null`。 */
  readonly maxAmp5: number | null;
  readonly maxAmp5MissingReason:
    | "MISSING_MAXAMP5_PATH"
    | "EVENT_DAY_BAR_UNUSABLE"
    | null;
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** rd1..15 每根都可用于振幅计算（high/low/close 有限且 > 0）。 */
export function amplitudePathComplete(
  post: ReadonlyMap<number, PoolBar>,
): boolean {
  for (let day = 1; day <= SELECTABLE_AGE_LOWER_BOUND; day += 1) {
    const bar = post.get(day);
    if (bar === undefined) return false;
    if (!finitePositive(bar.high) || !finitePositive(bar.low) || !finitePositive(bar.close)) {
      return false;
    }
  }
  return true;
}

/**
 * 逐事件算两个因子。
 *
 * 🔴 **为什么可以「一次算完、逐日复用」**：
 *   - `preReturn10` 只读 `prefix rd −1 / −10`（恒 `≤ rd`）；
 *   - `maxAmp5` 的 Core 定义**硬截断在 rd15**（`bar.relativeDay <= window.end`），
 *     且要求当前 bar 的 `relativeDay >= 15` ⇒ 对任意决策年龄 `a ≥ 15`，取值**完全相同**。
 *   因此「逐日限定到 decisionDate」在这里被满足为：
 *   **因子只读 rd ≤ 15 ≤ 任意可选年龄**；可用性再按 `a ≥ 15` 判定（见 `buildDailyPool`）。
 */
export function deriveEventFactors(
  events: readonly PoolEvent[],
  computeMaxAmp5: MaxAmp5Computer,
): Map<string, EventFactorValues> {
  const out = new Map<string, EventFactorValues>();
  const [minusOne, minusTen] = PRE_RETURN10_PREFIX_DAYS;
  for (const event of events) {
    const prevClose = event.prefix.get(minusOne!)?.close ?? null;
    const baseClose = event.prefix.get(minusTen!)?.close ?? null;
    const preReturn10Available = finitePositive(prevClose) && finitePositive(baseClose);
    const preReturn10 = preReturn10Available ? prevClose / baseClose - 1 : null;

    const eventDayBar = event.prefix.get(0);
    const eventDayClose = eventDayBar?.close ?? null;
    let maxAmp5: number | null = null;
    let maxAmp5MissingReason: EventFactorValues["maxAmp5MissingReason"] = null;
    if (!finitePositive(eventDayClose)) {
      maxAmp5MissingReason = "EVENT_DAY_BAR_UNUSABLE";
    } else if (!amplitudePathComplete(event.post)) {
      maxAmp5MissingReason = "MISSING_MAXAMP5_PATH";
    } else {
      const bars: PoolBar[] = [];
      for (let day = 1; day <= SELECTABLE_AGE_LOWER_BOUND; day += 1) {
        bars.push(event.post.get(day)!);
      }
      const value = computeMaxAmp5({
        eventId: event.eventId,
        eventDayBar: eventDayBar!,
        barsThroughRd15: bars,
      });
      if (typeof value === "number" && Number.isFinite(value)) {
        maxAmp5 = value;
      } else {
        maxAmp5MissingReason = "MISSING_MAXAMP5_PATH";
      }
    }

    out.set(event.eventId, {
      preReturn10,
      preReturn10MissingReason: preReturn10Available ? null : "MISSING_PREFIX_PATH",
      maxAmp5,
      maxAmp5MissingReason,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 三、每日池：同股一个锚点
// ---------------------------------------------------------------------------

interface AnchorCandidate {
  readonly eventId: string;
  readonly rd: number;
  readonly bar: PoolBar;
}

export interface EventExclusion {
  readonly eventId: string;
  readonly reason: string;
}

export interface DailyPoolBuildResult {
  readonly dailyRows: readonly DailyPoolRow[];
  /** 决策日（升序）—— 由**事件自己的 rd→tradeDate** 派生，不是外部日历。 */
  readonly decisionDates: readonly string[];
  /** 每日可评估池的 eventId（升序）—— 两主臂与 Random 共用。 */
  readonly eligibleEventIdsByDate: ReadonlyMap<string, readonly string[]>;
  /** 锚点切换次数（显式记账）。 */
  readonly anchorSwitchCount: number;
  /** 进入过观察池的事件集合。 */
  readonly pooledEventIds: ReadonlySet<string>;
}

function approximatelyEqual(left: number, right: number, epsilon = 1e-9): boolean {
  return Math.abs(left - right) <= epsilon;
}

function usableBar(bar: PoolBar | undefined): bar is PoolBar {
  return bar !== undefined && bar.barPresent && !bar.suspended;
}

/** 截至 `age` 的路径状态（规格 §4.4：**仅描述**，不参与评分或过滤）。 */
interface PathState {
  limitUpCount3: number | null;
  limitUpCount5: number | null;
  consecutiveLimitUp: number | null;
  daysSinceLastLimitUp: number | null;
  limitDownStreak: number | null;
}

function pathStateAt(
  event: PoolEvent,
  age: number,
): PathState {
  const isLimitUp = (rd: number): boolean | null => {
    const bar = event.post.get(rd);
    if (!usableBar(bar) || !finitePositive(bar.close) || !finitePositive(bar.limitUpPrice)) {
      return null;
    }
    return approximatelyEqual(bar.close, bar.limitUpPrice);
  };
  const isLimitDown = (rd: number): boolean | null => {
    const bar = event.post.get(rd);
    if (!usableBar(bar) || !finitePositive(bar.close) || !finitePositive(bar.limitDownPrice)) {
      return null;
    }
    return approximatelyEqual(bar.close, bar.limitDownPrice);
  };
  const countWindow = (limit: number): number | null => {
    let count = 0;
    for (let rd = Math.max(1, age - limit + 1); rd <= age; rd += 1) {
      const flag = isLimitUp(rd);
      if (flag === null) return null;
      if (flag) count += 1;
    }
    return count;
  };
  const consecutive = (probe: (rd: number) => boolean | null): number | null => {
    let count = 0;
    for (let rd = age; rd >= 1; rd -= 1) {
      const flag = probe(rd);
      if (flag === null) return null;
      if (!flag) break;
      count += 1;
    }
    return count;
  };
  let daysSinceLast: number | null = null;
  for (let rd = age; rd >= 1; rd -= 1) {
    const flag = isLimitUp(rd);
    if (flag === null) {
      daysSinceLast = null;
      break;
    }
    if (flag) {
      daysSinceLast = age - rd;
      break;
    }
  }
  return {
    limitUpCount3: countWindow(3),
    limitUpCount5: countWindow(5),
    consecutiveLimitUp: consecutive(isLimitUp),
    daysSinceLastLimitUp: daysSinceLast,
    limitDownStreak: consecutive(isLimitDown),
  };
}

function rejectionCodesOf(args: {
  age: number;
  factors: EventFactorValues;
  bar: PoolBar;
}): RejectionReasonCode[] {
  const codes: RejectionReasonCode[] = [];
  if (args.age < SELECT_MIN_AGE) codes.push("AGE_BELOW_SELECT_MIN");
  if (args.age < SELECTABLE_AGE_LOWER_BOUND) {
    codes.push("MAXAMP5_NOT_AVAILABLE_BEFORE_RD15");
  }
  if (args.factors.preReturn10 === null) codes.push("MISSING_PREFIX_PATH");
  if (args.factors.maxAmp5 === null) {
    codes.push(args.factors.maxAmp5MissingReason === "EVENT_DAY_BAR_UNUSABLE"
      ? "EVENT_DAY_BAR_UNUSABLE"
      : "MISSING_MAXAMP5_PATH");
  }
  if (!args.bar.barPresent || args.bar.suspended || !finitePositive(args.bar.close)) {
    codes.push("CURRENT_BAR_UNUSABLE");
  }
  return codes;
}

/**
 * 构造逐日股票级面板。
 *
 * 锚点规则（规格 §4.1–§4.3）：
 *   1. 成员 = `{事件, rd}` 且 `rd ∈ [1,40]` 且该 rd 的 `tradeDate` 落在研究窗口内；
 *   2. 同 symbol 只保留**最早尚未过期**成员 = 「**rd 最大**」者（事件越早 ⇒ 年龄越大）；
 *   3. 其余同股成员登记进 `relatedEventIds`（升序，逗号分隔）；
 *   4. 锚点只在「上一决策日的锚点已过期」时切换 ⇒ 新首板**不刷新**旧锚点与年龄。
 */
export function buildDailyPool(args: {
  readonly events: readonly PoolEvent[];
  readonly factors: ReadonlyMap<string, EventFactorValues>;
  readonly window?: { readonly startDate: string; readonly endDate: string };
}): DailyPoolBuildResult {
  const window = args.window ?? MAIN_WINDOW;
  const byDate = new Map<string, Map<string, AnchorCandidate[]>>();
  const pooledEventIds = new Set<string>();

  for (const event of args.events) {
    for (let rd = WATCH_MIN_AGE; rd <= WATCH_MAX_AGE; rd += 1) {
      const bar = event.post.get(rd);
      if (bar === undefined) continue;
      const date = bar.tradeDate;
      if (date < window.startDate || date > window.endDate) continue;
      let bySymbol = byDate.get(date);
      if (bySymbol === undefined) {
        bySymbol = new Map<string, AnchorCandidate[]>();
        byDate.set(date, bySymbol);
      }
      const list = bySymbol.get(event.symbol) ?? [];
      list.push({ eventId: event.eventId, rd, bar });
      bySymbol.set(event.symbol, list);
      pooledEventIds.add(event.eventId);
    }
  }

  const decisionDates = [...byDate.keys()].sort();
  const eventById = new Map(args.events.map((event) => [event.eventId, event]));
  const dailyRows: DailyPoolRow[] = [];
  const eligibleEventIdsByDate = new Map<string, readonly string[]>();
  const previousAnchorBySymbol = new Map<string, string>();
  let anchorSwitchCount = 0;
  const dailyStStatus: DailyStStatus = "UNAVAILABLE";

  for (const date of decisionDates) {
    const bySymbol = byDate.get(date)!;
    const eligible: string[] = [];
    // 同一天内按 symbol 升序处理 ⇒ 输出确定性（与「确定性 symbol 升序」破平口径一致）。
    const symbols = [...bySymbol.keys()].sort();
    for (const symbol of symbols) {
      const candidates = bySymbol.get(symbol)!;
      // 「最早尚未过期成员」= rd 最大；rd 必须唯一（同 symbol 同一天不可能有两个事件同 rd）。
      const ordered = [...candidates].sort((left, right) =>
        right.rd - left.rd || left.eventId.localeCompare(right.eventId),
      );
      const anchor = ordered[0]!;
      const related = ordered.slice(1).map((item) => item.eventId).sort();
      const event = eventById.get(anchor.eventId);
      if (event === undefined) continue;
      const factors = args.factors.get(anchor.eventId);
      if (factors === undefined) continue;
      const previousAnchor = previousAnchorBySymbol.get(symbol);
      const anchorChanged = previousAnchor !== undefined && previousAnchor !== anchor.eventId;
      if (anchorChanged) anchorSwitchCount += 1;
      previousAnchorBySymbol.set(symbol, anchor.eventId);

      const codes = rejectionCodesOf({ age: anchor.rd, factors, bar: anchor.bar });
      const signalEligible = codes.length === 0;
      if (signalEligible) eligible.push(anchor.eventId);
      const path = pathStateAt(event, anchor.rd);
      const nextBar = event.post.get(anchor.rd + 1);
      /**
       * 🔴 每日账里的因子值必须是**该决策日当时可评估**的值：
       *    `maxAmp5` 的 Core 决策下界是 rd15 ⇒ 年龄 < 15 的那几天这一格**必须是 null**
       *    （否则账面上出现了当时拿不到的读数，等于把「事后算好的值」搬回当时）。
       *    `preReturn10` 只读 prefix（rd ≤ 0）⇒ 任何年龄都可评估。
       */
      const maxAmp5AtDecision =
        anchor.rd >= SELECTABLE_AGE_LOWER_BOUND ? factors.maxAmp5 : null;

      dailyRows.push({
        date,
        symbol,
        anchorEventId: anchor.eventId,
        eventAge: anchor.rd,
        relatedEventIds: related.join("|"),
        anchorChanged,
        inWatchPool: true,
        signalEligible,
        rejectionReasons: codes.join("|"),
        preReturn10: factors.preReturn10,
        maxAmp5: maxAmp5AtDecision,
        limitUpCount3: path.limitUpCount3,
        limitUpCount5: path.limitUpCount5,
        consecutiveLimitUp: path.consecutiveLimitUp,
        daysSinceLastLimitUp: path.daysSinceLastLimitUp,
        limitDownStreak: path.limitDownStreak,
        canBuyAtOpenToday: anchor.bar.canBuyAtOpen,
        canSellAtCloseToday: anchor.bar.canSellAtClose,
        // 🔴 下一交易日真实执行结果：只进账，**绝不参与资格或排名**。
        nextOpenExecutable:
          nextBar === undefined
            ? null
            : nextBar.canBuyAtOpen === null
              ? null
              : nextBar.canBuyAtOpen && nextBar.barPresent && !nextBar.suspended,
        dailyStStatus,
      });
    }
    eligibleEventIdsByDate.set(date, [...eligible].sort());
  }

  return {
    dailyRows,
    decisionDates,
    eligibleEventIdsByDate,
    anchorSwitchCount,
    pooledEventIds,
  };
}

// ---------------------------------------------------------------------------
// 四、两固定臂 + 随机对照（同日同池、同人数）
// ---------------------------------------------------------------------------

export interface DailyPicks {
  readonly date: string;
  readonly poolSize: number;
  /** R 臂：`preReturn10` HIGH。 */
  readonly armR: readonly string[];
  /** M 臂：`maxAmp5` LOW。 */
  readonly armM: readonly string[];
  /** 每日随机 K 子集（长度 = `RANDOM_DRAW_COUNT`，每项是 eventId 列表）。 */
  readonly randomDraws: readonly (readonly string[])[];
}

/**
 * 逐日排名 + 随机抽样。
 *
 * 破平 = **确定性 `symbol` 升序 + `eventId` 升序**（规格 §3；不得用不透明 UUID 悄悄决定赢家）。
 * Random = 同日同池、**同人数**（`K = min(3, 池大小)`）均匀**无放回**，200 个固定种子；
 * 种子规则 = `seedOf("uniform-random", RANDOM_SEED_BASE + drawIndex, date)`（既有原语）。
 */
export function buildDailyPicks(args: {
  readonly dailyRows: readonly DailyPoolRow[];
  readonly eligibleEventIdsByDate: ReadonlyMap<string, readonly string[]>;
  readonly decisionDates: readonly string[];
}): readonly DailyPicks[] {
  const rowsByDate = new Map<string, DailyPoolRow[]>();
  for (const row of args.dailyRows) {
    const list = rowsByDate.get(row.date) ?? [];
    list.push(row);
    rowsByDate.set(row.date, list);
  }
  const out: DailyPicks[] = [];
  for (const date of args.decisionDates) {
    const eligibleIds = args.eligibleEventIdsByDate.get(date) ?? [];
    if (eligibleIds.length === 0) {
      out.push({ date, poolSize: 0, armR: [], armM: [], randomDraws: [] });
      continue;
    }
    const eligibleSet = new Set(eligibleIds);
    const eligibleRows = (rowsByDate.get(date) ?? []).filter((row) =>
      eligibleSet.has(row.anchorEventId),
    );
    const byEventId = new Map(eligibleRows.map((row) => [row.anchorEventId, row]));
    const tieBreak = (left: DailyPoolRow, right: DailyPoolRow): number =>
      left.symbol.localeCompare(right.symbol) || left.anchorEventId.localeCompare(right.anchorEventId);

    const armR = [...eligibleRows]
      .sort((left, right) =>
        (right.preReturn10 ?? 0) - (left.preReturn10 ?? 0) || tieBreak(left, right),
      )
      .slice(0, TOP_K)
      .map((row) => row.anchorEventId);
    const armM = [...eligibleRows]
      .sort((left, right) =>
        (left.maxAmp5 ?? 0) - (right.maxAmp5 ?? 0) || tieBreak(left, right),
      )
      .slice(0, TOP_K)
      .map((row) => row.anchorEventId);

    const poolEventIds = [...eligibleIds].sort();
    const k = Math.min(TOP_K, poolEventIds.length);
    const randomDraws: string[][] = [];
    for (let draw = 0; draw < RANDOM_DRAW_COUNT; draw += 1) {
      randomDraws.push([
        ...pickUniformRandomSubset({
          eventIds: poolEventIds,
          topK: k,
          seedIndex: RANDOM_SEED_BASE + draw,
          date,
        }),
      ]);
    }
    void byEventId;
    out.push({ date, poolSize: poolEventIds.length, armR, armM, randomDraws });
  }
  return out;
}

export const REJECTION_LABELS = REJECTION_REASON_LABELS;
export { SELECT_MAX_AGE, WATCH_MAX_AGE };
