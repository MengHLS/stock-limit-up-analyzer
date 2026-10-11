/**
 * 入场观察规则的**唯一实现**（`FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002`）。
 *
 * 规则文本：`docs/research/RULE-FIRSTBOARD-ROLLING-OBSERVATION-ENTRY-001.md` §2–§4。
 * 本模块是纯函数：输入一个锚点事件（rd0 + rd1..9 的 bar），输出逐日评分、全部确认日与终态。
 *
 * 🔴 本模块**不做**：排序、随机、账户约束、撮合、成本、退出。那些各有唯一实现。
 */
import type { PoolBar, PoolEvent } from "../rollingPoolRightTail/projection";
import {
  CONFIRM_MAX_RD,
  CONFIRM_MIN_RD,
  ENTRY_FILL_MAX_RD,
  ENTRY_FILL_MAX_RD_DEFAULT,
  OBSERVATION_DAYS_DEFAULT,
  type EarlyEntryOptions,
  OBSERVATION_MIN_SCORE,
  SHRINK_RATIO,
  SUPPORT_RATIO,
  type EarlyEntryEvaluation,
  type EntryRejectReason,
  type EntryTrigger,
  type ObservationDayScore,
  type ObservationMissingReason,
} from "./types";

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** bar 可用于**评级**：存在、非停牌、OHLC 与 volume 全部有限且为正。 */
function usableForScoring(bar: PoolBar | undefined): bar is PoolBar {
  return bar !== undefined
    && bar.barPresent
    && !bar.suspended
    && finitePositive(bar.open)
    && finitePositive(bar.high)
    && finitePositive(bar.low)
    && finitePositive(bar.close)
    && finitePositive(bar.volume)
    && bar.high >= bar.low;
}

/** 从 pool 取 bar；不存在（该相对日无行）返回 undefined。 */
function barAt(event: PoolEvent, relativeDay: number): PoolBar | undefined {
  if (relativeDay === 0) return event.prefix.get(0);
  if (relativeDay < 0) return event.prefix.get(relativeDay);
  return event.post.get(relativeDay);
}

function missingReasonFor(bar: PoolBar | undefined): ObservationMissingReason {
  if (bar === undefined) return "BAR_MISSING";
  if (!bar.barPresent) return "BAR_MISSING";
  if (bar.suspended) return "BAR_SUSPENDED";
  // 零量**不得**被当成「缩量优秀」（规则 §4）；volume 缺失同样不可评估。
  if (bar.volume === null || bar.volume === undefined || bar.volume <= 0) return "ZERO_VOLUME";
  return "BAR_INVALID";
}

/**
 * 计算 rd ∈ [1, maxRd] 的逐日观察分。
 *
 * 分项（各 1 分，**单列**）：
 *   守线  `L_d >= 0.98 · O_0`
 *   缩量  `V_d <= 0.50 · V_0`
 *   低点稳定 `L_d >= L_(d-1)`
 *   收盘改善 `C_d > C_(d-1)`
 *
 * 🔴 rd1 的「前一日」= 事件日 rd0（规则 §2）。
 * 🔴 任何必要输入缺失 ⇒ 当日 `score = null` + 原因，**不打 0 分、不插值**（规则 §4）。
 * 🔴 停牌或零量**不得**被当成「缩量优秀」。
 */
export function observationScores(
  event: PoolEvent,
  maxRd: number,
): readonly ObservationDayScore[] {
  const eventDay = event.prefix.get(0);
  const eventUsable = usableForScoring(eventDay);
  const eventOpen = eventUsable ? (eventDay.open as number) : null;
  const eventVolume = eventUsable ? (eventDay.volume as number) : null;
  const out: ObservationDayScore[] = [];

  for (let relativeDay = 1; relativeDay <= maxRd; relativeDay += 1) {
    const bar = barAt(event, relativeDay);
    const previous = barAt(event, relativeDay - 1);
    const tradeDate = bar?.tradeDate ?? null;

    if (eventUsable !== true || eventOpen === null || eventVolume === null) {
      out.push({
        relativeDay, tradeDate, flags: null, score: null,
        missingReason: "EVENT_BAR_UNUSABLE", supportBreached: null,
      });
      continue;
    }
    if (!usableForScoring(bar)) {
      out.push({
        relativeDay, tradeDate, flags: null, score: null,
        missingReason: missingReasonFor(bar), supportBreached: null,
      });
      continue;
    }
    if (!usableForScoring(previous)) {
      out.push({
        relativeDay, tradeDate, flags: null, score: null,
        missingReason: "PREV_BAR_MISSING", supportBreached: null,
      });
      continue;
    }

    const supportFloor = SUPPORT_RATIO * eventOpen;
    const close = bar.close as number;
    const low = bar.low as number;
    const volume = bar.volume as number;
    const support: 0 | 1 = low >= supportFloor ? 1 : 0;
    const flags = {
      support,
      shrink: (volume <= SHRINK_RATIO * eventVolume ? 1 : 0) as 0 | 1,
      lowStable: (low >= (previous.low as number) ? 1 : 0) as 0 | 1,
      closeImprove: (close > (previous.close as number) ? 1 : 0) as 0 | 1,
    };
    out.push({
      relativeDay,
      tradeDate,
      flags,
      score: flags.support + flags.shrink + flags.lowStable + flags.closeImprove,
      missingReason: null,
      supportBreached: support === 0,
    });
  }
  return out;
}

/**
 * 单个锚点的完整入场评估。
 *
 * 六条件（规则 §3，**全部成立**才在确认日 `d` 触发）：
 *  1. `N+1 <= d <= L-1`（连续观察日数 N、最晚实际成交相对日 L）
 *  2. `∃ j ∈ [1, d−1]` 使 `C_j < C_0`（**确实发生过回撤**，只用当时已知历史）
 *  3. `min(L_1..L_d) >= 0.98 · O_0`（**支撑全程未失守**）
 *  4. 紧邻确认日的 **N 个**观察日 `d−N..d−1` **每天分别** `S_j >= 3`（都必须可评估）
 *  5. `C_d > max(H_(d−2), H_(d−1))`（突破参照恒为前**两日**高点，不随 N 改变）
 *  6. `V_d >= V_(d−1)`（量能回升）
 *
 * 🔴 **默认值 = N 2 / L 10 ⇒ 行为与 001/002 冻结口径逐字节一致**（旧版本可精确重放）。
 * 🔴 返回**全部**确认日（不是只留首次）：SRC-003 主配置要求保留每个锚点的所有触发日，
 *    未成交后可重试、平仓后新买点可再入场。
 */
export function evaluateEarlyEntry(
  event: PoolEvent,
  options: EarlyEntryOptions = {},
): EarlyEntryEvaluation {
  const observationDays = options.observationDays ?? OBSERVATION_DAYS_DEFAULT;
  const entryFillMaxRd = options.entryFillMaxRd ?? ENTRY_FILL_MAX_RD_DEFAULT;
  if (!Number.isInteger(observationDays) || observationDays < 1) {
    throw new Error(`EARLY-ENTRY：observationDays 必须是 >=1 的整数，实际 ${observationDays}`);
  }
  if (!Number.isInteger(entryFillMaxRd) || entryFillMaxRd < observationDays + 2) {
    throw new Error(
      `EARLY-ENTRY：entryFillMaxRd 必须是 >= observationDays+2 的整数（保证至少一个确认日），`
      + `实际 N=${observationDays} L=${entryFillMaxRd}`,
    );
  }
  /** 最早确认日 = N+1（先有 N 个完整观察日）。 */
  const minConfirmRd = observationDays + 1;
  /** 最晚确认日 = L−1（T+L 开盘成交）。 */
  const maxConfirmRd = entryFillMaxRd - 1;

  const scores = observationScores(event, maxConfirmRd);
  const scoreByRd = new Map(scores.map((item) => [item.relativeDay, item]));

  const eventDay = event.prefix.get(0);
  const eventUsable = usableForScoring(eventDay);
  const eventDayOpen = eventUsable ? (eventDay.open as number) : null;
  const eventDayVolume = eventUsable ? (eventDay.volume as number) : null;
  const supportFloor = eventDayOpen === null ? null : SUPPORT_RATIO * eventDayOpen;

  // -- 条件 1：首次回撤（只用 j ≤ d−1） --
  let pullbackFirstRd: number | null = null;
  if (eventUsable && eventDay !== undefined) {
    const close0 = eventDay.close as number;
    for (let day = 1; day <= maxConfirmRd; day += 1) {
      const bar = barAt(event, day);
      if (!usableForScoring(bar)) continue;
      if ((bar.close as number) < close0 - 1e-9) { pullbackFirstRd = day; break; }
    }
  }

  // -- 逐日推进：支撑路径、破位、触发 --
  const triggers: EntryTrigger[] = [];
  const supportMinLowByRd = new Map<number, number>();
  let supportBreachRd: number | null = null;
  let supportPathIncomplete = !eventUsable;
  let runningMinLow = Number.POSITIVE_INFINITY;
  let lastReason: EntryRejectReason = eventUsable ? "NOT_OBSERVATION_DAY" : "EVENT_DAY_BAR_UNUSABLE";

  for (let day = 1; day <= maxConfirmRd; day += 1) {
    const score = scoreByRd.get(day);
    const bar = barAt(event, day);
    if (score !== undefined && score.supportBreached === true && supportBreachRd === null) {
      supportBreachRd = day;
    }
    if (score === undefined || score.score === null) {
      // 该观察日不可评估 ⇒ 无法声称「rd1..d 全程未破位」（规则 §4）。
      if (supportBreachRd === null) supportPathIncomplete = true;
      if (day >= minConfirmRd && supportBreachRd === null) lastReason = "SUPPORT_PATH_INCOMPLETE";
      continue;
    }
    runningMinLow = Math.min(runningMinLow, bar?.low as number);
    supportMinLowByRd.set(day, runningMinLow);

    if (day < minConfirmRd) continue;

    // 条件 2：支撑全程未失守（破位即永久作废，不恢复 —— 规则 §4）
    if (supportBreachRd !== null) { lastReason = "SUPPORT_BREACHED"; continue; }
    if (!(runningMinLow >= (supportFloor as number) - 1e-9)) { lastReason = "SUPPORT_BREACHED"; continue; }
    if (supportPathIncomplete) { lastReason = "SUPPORT_PATH_INCOMPLETE"; continue; }

    // 条件 1：回撤必须发生在 d 之前
    if (pullbackFirstRd === null || pullbackFirstRd > day - 1) { lastReason = "NO_PULLBACK_YET"; continue; }

    // 条件 4：紧邻确认日的 **N 个**观察日 `d−N..d−1` **每天分别** `S_j >= 3`。
    // 🔴 每一天都必须**有效且非停牌**（`score === null` 即不成立）——
    //    停牌/零量日**不能**被跳过拼成「连续 N 天」。
    let observationOk = true;
    for (let cursor = day - observationDays; cursor <= day - 1; cursor += 1) {
      const scored = scoreByRd.get(cursor);
      if (scored === undefined || scored.score === null || scored.score < OBSERVATION_MIN_SCORE) {
        observationOk = false;
        break;
      }
    }
    if (!observationOk) { lastReason = "PREV_TWO_DAY_SCORE_INSUFFICIENT"; continue; }

    // 条件 5：收盘严格高于前**两日**高点（参照恒为前两日，**不随 N 改为前 N 日**）。
    const prev2 = scoreByRd.get(day - 2);
    const prev1 = scoreByRd.get(day - 1);
    const barPrev2 = barAt(event, day - 2);
    const barPrev1 = barAt(event, day - 1);
    if (!usableForScoring(barPrev2) || !usableForScoring(barPrev1) || !usableForScoring(bar)) {
      lastReason = "PREV_TWO_DAY_SCORE_INSUFFICIENT"; continue;
    }
    const closePrev2High = Math.max(barPrev2.high as number, barPrev1.high as number);
    if (!((bar.close as number) > closePrev2High)) { lastReason = "NO_CLOSE_BREAKOUT"; continue; }

    // 条件 6：量能回升
    if (!((bar.volume as number) >= (barPrev1.volume as number))) {
      lastReason = "VOLUME_NOT_RECOVERED"; continue;
    }

    // 条件 1（时间）：成交相对日 ≤ L
    const fillRd = day + 1;
    if (fillRd > entryFillMaxRd) { lastReason = "ENTRY_WINDOW_EXPIRED"; continue; }
    const fillBar = barAt(event, fillRd);

    triggers.push({
      confirmRd: day,
      confirmDate: bar.tradeDate,
      fillRd,
      fillDate: fillBar?.tradeDate ?? null,
      evidence: {
        pullbackFirstRd,
        supportMinLow: runningMinLow,
        supportFloor: supportFloor as number,
        scorePrev2: prev2?.score ?? 0,
        scorePrev1: prev1?.score ?? 0,
        closePrev2High,
        closeConfirm: bar.close as number,
        volumePrev1: barPrev1.volume as number,
        volumeConfirm: bar.volume as number,
      },
    });
    lastReason = "NOT_OBSERVATION_DAY";
  }

  // -- 终态 --
  let finalState: EarlyEntryEvaluation["finalState"];
  let finalReason: EntryRejectReason | null = null;
  if (!eventUsable) {
    finalState = "UNASSESSABLE";
    finalReason = "EVENT_DAY_BAR_UNUSABLE";
  } else if (supportBreachRd !== null) {
    finalState = "INVALIDATED_SUPPORT";
    finalReason = "SUPPORT_BREACHED";
  } else if (triggers.length > 0) {
    finalState = "TRIGGERED";
    finalReason = null;
  } else if (supportPathIncomplete) {
    finalState = "UNASSESSABLE";
    finalReason = "SUPPORT_PATH_INCOMPLETE";
  } else {
    finalState = "ENTRY_EXPIRED";
    finalReason = lastReason === "NOT_OBSERVATION_DAY" ? "ENTRY_WINDOW_EXPIRED" : lastReason;
  }

  return {
    eventId: event.eventId,
    symbol: event.symbol,
    eventDate: event.eventDate,
    eventDayOpen,
    eventDayVolume,
    supportFloor,
    observationDays: scores,
    pullbackFirstRd,
    supportBreachRd,
    supportPathIncomplete,
    triggers,
    finalState,
    finalReason,
  };
}

// ---------------------------------------------------------------------------
// 供下游（实验编排 / 账户层）使用的查询
// ---------------------------------------------------------------------------

/** `eventId → evaluation` 的批量评估（确定性：按输入顺序）。 */
export function evaluateEarlyEntries(
  events: readonly PoolEvent[],
  options: EarlyEntryOptions = {},
): Map<string, EarlyEntryEvaluation> {
  const out = new Map<string, EarlyEntryEvaluation>();
  for (const event of events) out.set(event.eventId, evaluateEarlyEntry(event, options));
  return out;
}

/**
 * 某锚点在**指定相对日**是否触发（当日收盘确认，次日开盘计划下单）。
 *
 * `relativeDay` = 该锚点在**当日**的年龄（rd）。等价于 `evaluation.triggers` 中是否存在
 * `confirmRd === relativeDay`。**不接受** `confirmRd` 以外的任何日期。
 */
export function triggerOn(evaluation: EarlyEntryEvaluation, relativeDay: number): EntryTrigger | null {
  for (const trigger of evaluation.triggers) {
    if (trigger.confirmRd === relativeDay) return trigger;
  }
  return null;
}