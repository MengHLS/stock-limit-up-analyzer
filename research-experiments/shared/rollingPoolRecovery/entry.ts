/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` §3 —— **唯一**的信号求值实现。
 *
 * ## 为什么只有一个求值器
 *
 * 目标 §3 末段：「代码必须只有一个信号求值实现，归因直接消费其逐日证据，避免再写一套接近
 * 但不相同的条件解释器。」因此本文件同时产出：
 *
 *  - **A 组（`STRICT_20`）= 003 的 D**：确认日**直接复用**
 *    `rollingPoolEarlyEntry/entry.ts#evaluateEarlyEntry({observationDays: 5, entryFillMaxRd: 20})`
 *    的输出（**不重新实现 N=5/L=20 的任何条件**），只在首次可靠破位后把该锚点
 *    **永久禁止买入**（继续观察、继续出证据）。
 *  - **B 组（`RECOVERY_20`）**：破位前与原分支**逐字相同**（同样复用那一次求值的确认日），
 *    首次可靠 `L_t < 0.98·O_0` 之后进入 §3.3 的局部修复分支（`p`/`F` 低点基准、
 *    `W = [d−5,d−1]`、`ΣQ_j ≥ 15`、确认日 `C_d > max(H_(d−2),H_(d−1))` 且 `V_d ≥ V_(d−1)`）。
 *
 * 两个分支共用同一份逐日记录结构（`RecoveryDayRecord`）⇒ 归因不需要第二套解释器。
 *
 * ## 🔴 目标 §3.3 五条硬约束的落点
 *
 * | 条件 | 落点 |
 * |---|---|
 * | 1. `d ≤ 19`；`W=[d−5,d−1]` 全在最新低点 `p` 之后（`d−5 > p`）；d 有效 | `CONFIRM_MAX_RD`；`t − 5 > p`；`assessDay` |
 * | 2. W 每日有效 OHLC+正量+前日比较值；无效日**不得跳过拼接**，下一有效日重开段并重积累 | `pendingRestart` + `REPAIR_EPISODE_BROKEN_BY_GAP` / `REPAIR_EPISODE_RESTARTED_AFTER_GAP` |
 * | 3. W 与 d 都不低于 `F`；`L_d < F` 更新 `p/F` 且**不发信号**；`L_d == F` **不算**新低 | `isNewLocalLow()`（严格小于，带容差） |
 * | 4. `Q_j` 四项原始值 + `ΣQ_j ≥ 15`（**不要求**单日 `Q ≥ 3`） | `repairComponents` / `repairWindowScore` |
 * | 5. 确认日突破 + 放量；回撤确实发生过；当日非 ST 且因子可评估 | `confirmDayBlockers()` + 两时点 ST 闸门 + `factorAssessableOf` |
 *
 * ## 🔴 不做的事
 *
 *  - **不要求收复 `0.98·O_0`**：`F` 只作修复分支的参考支撑，**永不作为退出价**（退出是冻结 Runner 政策）；
 *  - `ΣQ` 只是**观察证据**，**不进入横截面排序**（排序仍用 `preReturn10`）；
 *  - ST 与账户容量**不得**抹掉价格观察历史：`priceState` 与 `buyEligibility` 分开记录
 *    （一只票可以同一天 `SIGNAL_FORMED` + `ST_BLOCKED`）。
 */
import {
  evaluateEarlyEntry,
  SHRINK_RATIO,
  SUPPORT_RATIO,
  type EarlyEntryEvaluation,
} from "../rollingPoolEarlyEntry";
import type { PoolBar, PoolEvent } from "../rollingPoolRightTail/projection";
import {
  ABSENT_STATUS_PROVIDER,
  effectiveAtOf,
  evaluateStGate,
  type BuyEligibility,
  type SecurityStatusFact,
  type SecurityStatusProvider,
} from "./stGate";
import {
  CONFIRM_MAX_RD,
  CONFIRM_MIN_RD,
  EPSILON,
  ORIGINAL_ENTRY_FILL_MAX_RD,
  ORIGINAL_OBSERVATION_DAYS,
  RECOVERY_WINDOW_DAYS,
  REPAIR_SCORE_TOTAL_MIN,
  WATCH_MAX_RD,
  type OriginalScoreComponents,
  type PositionState,
  type PriceState,
  type RecoveryDayRecord,
  type RecoveryEvaluation,
  type RecoveryEvaluationOptions,
  type RecoveryRejectReason,
  type RecoveryTrigger,
  type RepairEpisode,
  type RepairScoreComponents,
} from "./types";

// ---------------------------------------------------------------------------
// 数据质量判据（**只描述数据是否可用**，不含任何规则阈值判断）
// ---------------------------------------------------------------------------

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function approximatelyAtLeast(left: number, right: number): boolean {
  return left >= right - EPSILON;
}

/** 当日 bar 是否可用于**评级**：存在、非停牌、OHLC 与 volume 全部有限为正。 */
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

/** 前一日是否提供**所需比较值**（`L_(j−1)`、`C_(j−1)`）：停牌 / 缺行一律不可用。 */
function providesComparators(bar: PoolBar | undefined): bar is PoolBar {
  return bar !== undefined
    && bar.barPresent
    && !bar.suspended
    && finitePositive(bar.low)
    && finitePositive(bar.close);
}

/** 前一日是否提供**收盘突破与放量**所需的两个比较值（`H_(j−1)`、`V_(j−1)`）。 */
function providesBreakoutComparators(bar: PoolBar | undefined): bar is PoolBar {
  return providesComparators(bar) && finitePositive(bar.high) && finitePositive(bar.volume);
}

/**
 * 「可用于评级」的 bar 视图（数值字段都是**确定的数字**）。
 *
 * `PoolBar` 的每个数值字段都是 `number | null`（缺列 = `null`）；本视图只在
 * 通过数据质量判据之后构造，因此下游不需要满屏 `as number`。
 */
interface ScoringBar {
  readonly relativeDay: number;
  readonly tradeDate: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** 「提供前日比较值」的 bar 视图（`L`、`C` 确定）。 */
interface ComparatorBar {
  readonly low: number;
  readonly close: number;
}

/** 「提供突破与放量比较值」的 bar 视图（`L`、`C`、`H`、`V` 确定）。 */
interface BreakoutBar extends ComparatorBar {
  readonly high: number;
  readonly volume: number;
}

function scoringBarOf(bar: PoolBar | undefined): ScoringBar | null {
  if (!usableForScoring(bar)) return null;
  return {
    relativeDay: bar.relativeDay,
    tradeDate: bar.tradeDate,
    open: bar.open as number,
    high: bar.high as number,
    low: bar.low as number,
    close: bar.close as number,
    volume: bar.volume as number,
  };
}

function comparatorBarOf(bar: PoolBar | undefined): ComparatorBar | null {
  if (!providesComparators(bar)) return null;
  return { low: bar.low as number, close: bar.close as number };
}

function breakoutBarOf(bar: PoolBar | undefined): BreakoutBar | null {
  if (!providesBreakoutComparators(bar)) return null;
  return {
    low: bar.low as number,
    close: bar.close as number,
    high: bar.high as number,
    volume: bar.volume as number,
  };
}

/** 从事件取 bar；不存在（该相对日无行）返回 undefined。 */
function barAt(event: PoolEvent, relativeDay: number): PoolBar | undefined {
  if (relativeDay === 0) return event.prefix.get(0);
  if (relativeDay < 0) return event.prefix.get(relativeDay);
  return event.post.get(relativeDay);
}

/** `repairEpisodeId = anchorEventId + p`（**不是**新锚点、**不是**新期限）。 */
export function repairEpisodeIdOf(anchorEventId: string, localLowRd: number): string {
  return `${anchorEventId}+${localLowRd}`;
}

/** 某个修复段的低点是否比当前更低（**与 `F` 相等不算新低** —— 目标 §3.3-3）。 */
export function isNewLocalLow(low: number, localLow: number): boolean {
  return low < localLow - EPSILON;
}

/** 修复分支逐日综合分 `Q_t` 的四项原始值（目标 §3.3-4）。 */
export function repairScoreComponentsOf(input: {
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly previousLow: number;
  readonly previousClose: number;
  readonly eventDayVolume: number;
  readonly localLow: number;
}): RepairScoreComponents {
  return {
    atOrAboveLocalLow: approximatelyAtLeast(input.low, input.localLow) ? 1 : 0,
    shrink: input.volume <= SHRINK_RATIO * input.eventDayVolume ? 1 : 0,
    lowStable: approximatelyAtLeast(input.low, input.previousLow) ? 1 : 0,
    closeImprove: input.close > input.previousClose ? 1 : 0,
  };
}

export function repairScoreOf(components: RepairScoreComponents): number {
  return components.atOrAboveLocalLow + components.shrink + components.lowStable + components.closeImprove;
}

// ---------------------------------------------------------------------------
// 原分支：从 003 的权威求值结果里派生**逐日证据 + 非确认日归因标签**
// ---------------------------------------------------------------------------

/**
 * 非确认日的**归因标签**（不是第二套规则引擎）。
 *
 * 🔴 是否触发**完全**由权威的 `evaluateEarlyEntry` 决定（`originalEvaluation.triggers`）；
 *    本函数只在「已确定不是确认日」的前提下给出**成因**（003 的 `classifyDecisionLayer`
 *    是同一范式：只解释、不判定）。
 */
export function originalAttributionReason(
  event: PoolEvent,
  original: EarlyEntryEvaluation,
  relativeDay: number,
  breachRd: number | null,
): RecoveryRejectReason {
  if (relativeDay > CONFIRM_MAX_RD) return "CONFIRM_WINDOW_EXPIRED";
  if (relativeDay < CONFIRM_MIN_RD) return "ORIGINAL_NOT_CONFIRM_DAY";
  if (original.eventDayOpen === null) return "ORIGINAL_EVENT_DAY_BAR_UNUSABLE";
  if (breachRd !== null && breachRd <= relativeDay) return "ORIGINAL_SUPPORT_BREACHED";
  if (original.supportPathIncomplete) return "ORIGINAL_SUPPORT_PATH_INCOMPLETE";
  const pullbackFirstRd = original.pullbackFirstRd;
  if (pullbackFirstRd === null || pullbackFirstRd > relativeDay - 1) return "ORIGINAL_NO_PULLBACK_YET";
  for (let cursor = relativeDay - ORIGINAL_OBSERVATION_DAYS; cursor <= relativeDay - 1; cursor += 1) {
    const scored = original.observationDays.find((day) => day.relativeDay === cursor);
    if (scored === undefined || scored.score === null || scored.score < 3) {
      return "ORIGINAL_WINDOW_SCORE_INSUFFICIENT";
    }
  }
  const previous1 = breakoutBarOf(barAt(event, relativeDay - 1));
  const previous2 = breakoutBarOf(barAt(event, relativeDay - 2));
  const current = scoringBarOf(barAt(event, relativeDay));
  if (previous1 === null || previous2 === null || current === null) {
    return "ORIGINAL_WINDOW_SCORE_INSUFFICIENT";
  }
  if (!(current.close > Math.max(previous2.high, previous1.high))) {
    return "ORIGINAL_NO_CLOSE_BREAKOUT";
  }
  if (!(current.volume >= previous1.volume)) {
    return "ORIGINAL_VOLUME_NOT_RECOVERED";
  }
  return "ORIGINAL_NOT_CONFIRM_DAY";
}

// ---------------------------------------------------------------------------
// 确认日条件（目标 §3.3-5）
// ---------------------------------------------------------------------------

/**
 * 确认日不满足的**全部**条件（空数组 = 确认日成立）。
 *
 * `C_d > max(H_(d−2), H_(d−1))` 与 `V_d ≥ V_(d−1)`；回撤必须**已经发生**。
 * 🔴 确认日**不受**缩量评分门限制（`shrink` 只是 `Q_j` 的一项，不是确认门槛）。
 */
export function confirmDayBlockers(input: {
  readonly event: PoolEvent;
  readonly relativeDay: number;
  readonly bar: ScoringBar;
  readonly firstPullbackRd: number | null;
}): RecoveryRejectReason[] {
  const blockers: RecoveryRejectReason[] = [];
  const previous1 = breakoutBarOf(barAt(input.event, input.relativeDay - 1));
  const previous2 = breakoutBarOf(barAt(input.event, input.relativeDay - 2));
  if (previous1 === null || previous2 === null) {
    blockers.push("PREV_TWO_DAY_UNASSESSABLE");
    return blockers;
  }
  const reference = Math.max(previous2.high, previous1.high);
  if (!(input.bar.close > reference)) blockers.push("REPAIR_CLOSE_BREAKOUT_MISSING");
  if (!(input.bar.volume >= previous1.volume)) blockers.push("REPAIR_VOLUME_NOT_RECOVERED");
  if (input.firstPullbackRd === null || input.firstPullbackRd > input.relativeDay - 1) {
    blockers.push("REPAIR_NO_PULLBACK_YET");
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// 求值：单锚点（**唯一入口**）
// ---------------------------------------------------------------------------

interface DayAssessment {
  readonly usable: boolean;
  readonly hasComparators: boolean;
  readonly missingReason: RecoveryRejectReason | null;
}

/**
 * B 组修复段状态（用一个**显式类型**的对象承载）。
 *
 * 🔴 为什么不是几个 `let`：无效日的处理需要「段中断 → 下一有效日重开段」，
 *    状态由闭包修改；对象属性保留声明类型，读起来不需要在每处做 `as` 转换。
 */
interface RepairState {
  localLowRd: number | null;
  localLow: number | null;
  episodeStartedRd: number | null;
  episodeMaxWindowScore: number | null;
  episodeMaxWindowScoreRd: number | null;
  pendingRestart: boolean;
}

function requireLocalLow(state: RepairState): number {
  if (state.localLow === null) {
    throw new Error("ROLLING-POOL-RECOVERY：内部状态错误 —— 修复段没有低点基准（localLow 为空）。");
  }
  return state.localLow;
}

function requireLocalLowRd(state: RepairState): number {
  if (state.localLowRd === null) {
    throw new Error("ROLLING-POOL-RECOVERY：内部状态错误 —— 修复段没有低点相对日（localLowRd 为空）。");
  }
  return state.localLowRd;
}

function requireUsableBar(event: PoolEvent, relativeDay: number): ScoringBar {
  const bar = scoringBarOf(barAt(event, relativeDay));
  if (bar === null) {
    throw new Error(`ROLLING-POOL-RECOVERY：内部状态错误 —— rd=${relativeDay} 的 bar 不可用。`);
  }
  return bar;
}

function requireComparatorBar(event: PoolEvent, relativeDay: number): ComparatorBar {
  const bar = comparatorBarOf(barAt(event, relativeDay));
  if (bar === null) {
    throw new Error(`ROLLING-POOL-RECOVERY：内部状态错误 —— rd=${relativeDay} 缺前日比较值。`);
  }
  return bar;
}

function requireBreakoutBar(event: PoolEvent, relativeDay: number): BreakoutBar {
  const bar = breakoutBarOf(barAt(event, relativeDay));
  if (bar === null) {
    throw new Error(`ROLLING-POOL-RECOVERY：内部状态错误 —— rd=${relativeDay} 缺突破/放量比较值。`);
  }
  return bar;
}

export function evaluateRecoveryDays(
  event: PoolEvent,
  options: RecoveryEvaluationOptions,
): RecoveryEvaluation {
  const group = options.group;
  const maxRelativeDay = options.maxRelativeDay ?? WATCH_MAX_RD;
  if (!Number.isInteger(maxRelativeDay) || maxRelativeDay < 1) {
    throw new Error(`ROLLING-POOL-RECOVERY：maxRelativeDay 必须是 >=1 的整数，实际 ${maxRelativeDay}`);
  }
  const stProvider: SecurityStatusProvider | null = options.stProvider ?? ABSENT_STATUS_PROVIDER;
  const positionStateOf = options.positionStateOf;
  const factorAssessableOf = options.factorAssessableOf;

  /**
   * 原分支的**权威**求值（= 003 的 D 组口径：N=5 / L=20）。
   * 🔴 这是唯一的原分支信号来源；本文件**不重写** N=5 / L=20 的任何条件。
   */
  const originalEvaluation = evaluateEarlyEntry(event, {
    observationDays: ORIGINAL_OBSERVATION_DAYS,
    entryFillMaxRd: ORIGINAL_ENTRY_FILL_MAX_RD,
  });

  const eventScoring = scoringBarOf(event.prefix.get(0));
  const eventDayOpen = eventScoring?.open ?? null;
  const eventDayVolume = eventScoring?.volume ?? null;
  const eventDayClose = eventScoring?.close ?? null;
  const supportFloor = eventDayOpen === null ? null : SUPPORT_RATIO * eventDayOpen;
  const requireEventDayVolume = (): number => {
    if (eventDayVolume === null) {
      throw new Error("ROLLING-POOL-RECOVERY：内部状态错误 —— 事件日成交量不可用（V_0 为空）。");
    }
    return eventDayVolume;
  };

  const breachRd = originalEvaluation.supportBreachRd;
  const triggerByRd = new Map<number, (typeof originalEvaluation.triggers)[number]>();
  for (const trigger of originalEvaluation.triggers) triggerByRd.set(trigger.confirmRd, trigger);

  /** 首次 `C_j < C_0` 的相对日（全观察日；只与「≤ d−1」比较 ⇒ 预计算不构成前视）。 */
  let firstPullbackRd: number | null = null;
  if (eventDayClose !== null) {
    for (let day = 1; day <= maxRelativeDay; day += 1) {
      const bar = scoringBarOf(barAt(event, day));
      if (bar === null) continue;
      if (bar.close < eventDayClose - EPSILON) {
        firstPullbackRd = day;
        break;
      }
    }
  }

  const assess = (relativeDay: number): DayAssessment => {
    if (scoringBarOf(barAt(event, relativeDay)) === null) {
      return { usable: false, hasComparators: false, missingReason: "DAY_NOT_ASSESSABLE" };
    }
    if (comparatorBarOf(barAt(event, relativeDay - 1)) === null) {
      return { usable: true, hasComparators: false, missingReason: "PREV_TWO_DAY_UNASSESSABLE" };
    }
    return { usable: true, hasComparators: true, missingReason: null };
  };

  const diagnostics: Record<string, number> = {};
  const bump = (code: string, count = 1): void => {
    if (count <= 0) return;
    diagnostics[code] = (diagnostics[code] ?? 0) + count;
  };

  const days: RecoveryDayRecord[] = [];
  const triggers: RecoveryTrigger[] = [];
  const episodes: RepairEpisode[] = [];
  const state: RepairState = {
    localLowRd: null,
    localLow: null,
    episodeStartedRd: null,
    episodeMaxWindowScore: null,
    episodeMaxWindowScoreRd: null,
    pendingRestart: false,
  };
  let runningMinLow: number | null = null;

  const closeEpisode = (brokenAtRd: number | null): void => {
    if (state.localLowRd === null || state.localLow === null || state.episodeStartedRd === null) return;
    episodes.push({
      repairEpisodeId: repairEpisodeIdOf(event.eventId, state.localLowRd),
      localLowRd: requireLocalLowRd(state),
      localLow: requireLocalLow(state),
      startedRd: state.episodeStartedRd,
      brokenAtRd,
      maxWindowScore: state.episodeMaxWindowScore,
      maxWindowScoreRd: state.episodeMaxWindowScoreRd,
    });
    state.episodeMaxWindowScore = null;
    state.episodeMaxWindowScoreRd = null;
  };

  const openEpisode = (relativeDay: number, low: number): void => {
    state.localLowRd = relativeDay;
    state.localLow = low;
    state.episodeStartedRd = relativeDay;
    state.episodeMaxWindowScore = null;
    state.episodeMaxWindowScoreRd = null;
  };

  /** 把权威原分支确认日包装成统一的 `RecoveryTrigger`（A 组与 B 组未破位分支共用）。 */
  const originalTriggerAt = (
    relativeDay: number,
    buyEligibility: BuyEligibility,
    statusFact: SecurityStatusFact | null,
  ): RecoveryTrigger | null => {
    const trigger = triggerByRd.get(relativeDay);
    if (trigger === undefined) return null;
    return {
      confirmRd: trigger.confirmRd,
      confirmDate: trigger.confirmDate,
      fillRd: trigger.fillRd,
      fillDate: trigger.fillDate,
      branch: "ORIGINAL",
      repairEpisodeId: null,
      localLowRd: null,
      localLow: null,
      repairWindow: [],
      repairWindowScore: null,
      closePrev2High: trigger.evidence.closePrev2High,
      closeConfirm: trigger.evidence.closeConfirm,
      volumePrev1: trigger.evidence.volumePrev1,
      volumeConfirm: trigger.evidence.volumeConfirm,
      pullbackFirstRd: trigger.evidence.pullbackFirstRd,
      confirmCloseBuyEligibility: buyEligibility,
      confirmCloseStatusFact: statusFact,
    };
  };

  for (let relativeDay = 1; relativeDay <= maxRelativeDay; relativeDay += 1) {
    const bar = barAt(event, relativeDay);
    const tradeDate = bar?.tradeDate ?? null;
    const expired = relativeDay > CONFIRM_MAX_RD;
    const assessment = assess(relativeDay);

    const stDecision = tradeDate === null
      ? null
      : evaluateStGate({
        provider: stProvider,
        query: {
          symbol: event.symbol,
          tradeDate,
          timepoint: "CONFIRM_CLOSE_ELIGIBILITY",
          effectiveAt: effectiveAtOf(tradeDate, "CONFIRM_CLOSE_ELIGIBILITY"),
        },
      });
    const buyEligibility: BuyEligibility = stDecision === null ? "UNKNOWN_BLOCKED" : stDecision.buyEligibility;
    const statusFact: SecurityStatusFact | null = stDecision?.fact ?? null;

    const reasons: RecoveryRejectReason[] = [];
    let priceState: PriceState = expired ? "EXPIRED" : "ORIGINAL_WATCH";
    let signalFormed = false;
    let repairScore: number | null = null;
    let repairComponents: RepairScoreComponents | null = null;
    let repairWindow: readonly number[] = [];
    let repairWindowScore: number | null = null;
    let localLowUpdated = false;
    let episodeRestarted = false;
    let episodeBroken = false;
    let buyDisabled = false;

    const preBreach = group === "A_STRICT_20" || breachRd === null || relativeDay < breachRd;

    if (preBreach) {
      // ── 原分支（A 组 = 003 的 D；B 组未破位分支**逐字相同**） ──────────────
      const trigger = triggerByRd.get(relativeDay);
      if (expired) {
        reasons.push("CONFIRM_WINDOW_EXPIRED");
      } else if (trigger !== undefined) {
        priceState = "SIGNAL_FORMED";
        signalFormed = true;
      } else {
        priceState = "ORIGINAL_WATCH";
        reasons.push(originalAttributionReason(event, originalEvaluation, relativeDay, breachRd));
      }
      if (group === "A_STRICT_20") {
        buyDisabled = breachRd !== null && relativeDay >= breachRd;
        if (buyDisabled) reasons.push("ANCHOR_BUY_DISABLED_SUPPORT_BREACHED");
      }
      if (!expired) {
        const wrapped = originalTriggerAt(relativeDay, buyEligibility, statusFact);
        if (wrapped !== null) {
          triggers.push(wrapped);
          bump("ORIGINAL_SIGNALS");
        }
      }
    } else if (relativeDay === breachRd) {
      // ── B：首次可靠破位日 ⇒ 建立局部低点基准、进入修复观察（**不删池成员**） ──
      const low = scoringBarOf(bar)?.low ?? null;
      if (low === null) {
        reasons.push("DAY_NOT_ASSESSABLE");
        bump("BREACH_DAY_UNASSESSABLE");
      } else {
        openEpisode(relativeDay, low);
        bump("RECOVERY_EPISODES_STARTED");
      }
      reasons.push("ORIGINAL_SUPPORT_BREACHED");
      priceState = expired ? "EXPIRED" : "RECOVERY_WATCH";
    } else {
      // ── B：破位之后的每一个交易日 ────────────────────────────────────────
      reasons.push("ORIGINAL_SUPPORT_BREACHED");
      if (!assessment.usable || !assessment.hasComparators) {
        // 目标 §3.3-2：无效日**不得跳过拼接** ⇒ 本段中断；下一有效日重开段并重新积累五日。
        episodeBroken = true;
        state.pendingRestart = true;
        bump("GAP_BROKEN_EPISODES");
        if (assessment.missingReason !== null) reasons.push(assessment.missingReason);
        reasons.push("REPAIR_EPISODE_BROKEN_BY_GAP");
        closeEpisode(relativeDay);
        state.localLowRd = null;
        state.localLow = null;
        state.episodeStartedRd = null;
        priceState = expired ? "EXPIRED" : "RECOVERY_WATCH";
      } else {
        const currentBar = requireUsableBar(event, relativeDay);
        const previous = requireComparatorBar(event, relativeDay - 1);
        const low = currentBar.low;
        const hadLocalLow = state.localLow !== null && state.localLowRd !== null;
        const newLow = hadLocalLow && isNewLocalLow(low, requireLocalLow(state));
        const restarting = state.pendingRestart || !hadLocalLow || newLow;

        if (restarting) {
          if (newLow) {
            bump("LOCAL_LOW_UPDATES");
            localLowUpdated = true;
            reasons.push("REPAIR_LOCAL_LOW_UPDATED");
          }
          if (state.pendingRestart) {
            bump("RESTARTED_EPISODES");
            episodeRestarted = true;
            reasons.push("REPAIR_EPISODE_RESTARTED_AFTER_GAP");
          }
          if (hadLocalLow) closeEpisode(relativeDay);
          openEpisode(relativeDay, low);
          state.pendingRestart = false;
          bump("RECOVERY_EPISODES_STARTED");
          // 目标 §3.3-3：`L_d` 创更低点 ⇒ 先更新 `p/F`、回到观察，**不发信号**。
          priceState = expired ? "EXPIRED" : "RECOVERY_WATCH";
        }

        // 破位后的每个有效日都记录 `Q_t`（四项原始值 + 合计）——归因直接消费。
        repairComponents = repairScoreComponentsOf({
          low,
          close: currentBar.close,
          volume: currentBar.volume,
          previousLow: previous.low,
          previousClose: previous.close,
          eventDayVolume: requireEventDayVolume(),
          localLow: requireLocalLow(state),
        });
        repairScore = repairScoreOf(repairComponents);

        if (!restarting) {
          const windowStart = relativeDay - RECOVERY_WINDOW_DAYS;
          if (windowStart <= requireLocalLowRd(state)) {
            reasons.push("REPAIR_NO_FRESH_WINDOW_AFTER_LOCAL_LOW");
            priceState = expired ? "EXPIRED" : "RECOVERY_WATCH";
          } else {
            const windowRds: number[] = [];
            for (let cursor = windowStart; cursor <= relativeDay - 1; cursor += 1) windowRds.push(cursor);
            const windowAssessable = windowRds.every(
              (cursor) => assess(cursor).usable && assess(cursor).hasComparators,
            );
            const windowBelowLocalLow = windowRds.some((cursor) => {
              const cursorBar = scoringBarOf(barAt(event, cursor));
              return cursorBar === null || cursorBar.low < requireLocalLow(state) - EPSILON;
            });
            if (!windowAssessable) {
              // 无效日**不能**被跳过拼成「连续五日」（条件 2）。
              reasons.push("REPAIR_WINDOW_NOT_ASSESSABLE");
              priceState = expired ? "EXPIRED" : "RECOVERY_WATCH";
            } else if (windowBelowLocalLow) {
              reasons.push("REPAIR_WINDOW_BELOW_LOCAL_LOW");
              priceState = expired ? "EXPIRED" : "RECOVERY_WATCH";
            } else {
              const components = windowRds.map((cursor) => {
                const cursorBar = requireUsableBar(event, cursor);
                const cursorPrev = requireComparatorBar(event, cursor - 1);
                return repairScoreComponentsOf({
                  low: cursorBar.low,
                  close: cursorBar.close,
                  volume: cursorBar.volume,
                  previousLow: cursorPrev.low,
                  previousClose: cursorPrev.close,
                  eventDayVolume: requireEventDayVolume(),
                  localLow: requireLocalLow(state),
                });
              });
              const windowScore = components.reduce((sum, item) => sum + repairScoreOf(item), 0);
              repairWindow = windowRds;
              repairWindowScore = windowScore;
              if (state.episodeMaxWindowScore === null || windowScore > state.episodeMaxWindowScore) {
                state.episodeMaxWindowScore = windowScore;
                state.episodeMaxWindowScoreRd = relativeDay;
              }
              bump("REPAIR_WINDOWS_ASSESSED");

              if (windowScore < REPAIR_SCORE_TOTAL_MIN) {
                // 目标 §3.3-4：**不要求**单日 `Q ≥ 3`，只要求 W 上合计 ≥ 15。
                reasons.push("REPAIR_COMPOSITE_SCORE_INSUFFICIENT");
                priceState = expired ? "EXPIRED" : "RECOVERY_WATCH";
              } else {
                bump("REPAIR_COMPOSITE_MET");
                const blockers = confirmDayBlockers({
                  event,
                  relativeDay,
                  bar: currentBar,
                  firstPullbackRd,
                });
                if (factorAssessableOf !== undefined
                  && factorAssessableOf({ relativeDay, tradeDate }) === false) {
                  blockers.push("FACTOR_NOT_ASSESSABLE");
                }
                if (expired) {
                  reasons.push("CONFIRM_WINDOW_EXPIRED");
                  priceState = "EXPIRED";
                } else if (blockers.length > 0) {
                  reasons.push(...blockers);
                  reasons.push("REPAIR_COMPOSITE_OK_AWAITING_CONFIRM");
                  priceState = "RECOVERY_MATURE";
                } else {
                  priceState = "SIGNAL_FORMED";
                  signalFormed = true;
                  bump("RECOVERY_SIGNALS");
                  triggers.push({
                    confirmRd: relativeDay,
                    confirmDate: currentBar.tradeDate,
                    fillRd: relativeDay + 1,
                    fillDate: barAt(event, relativeDay + 1)?.tradeDate ?? null,
                    branch: "RECOVERY",
                    repairEpisodeId: repairEpisodeIdOf(event.eventId, requireLocalLowRd(state)),
                    localLowRd: requireLocalLowRd(state),
                    localLow: requireLocalLow(state),
                    repairWindow,
                    repairWindowScore,
                    closePrev2High: Math.max(
                      requireBreakoutBar(event, relativeDay - 2).high,
                      requireBreakoutBar(event, relativeDay - 1).high,
                    ),
                    closeConfirm: currentBar.close,
                    volumePrev1: requireBreakoutBar(event, relativeDay - 1).volume,
                    volumeConfirm: currentBar.volume,
                    pullbackFirstRd: firstPullbackRd as number,
                    confirmCloseBuyEligibility: buyEligibility,
                    confirmCloseStatusFact: statusFact,
                  });
                }
              }
            }
          }
        }
      }
    }

    // ---- 原分支逐日 S 证据（**直接来自 003 的权威求值**，不重算） ----
    const originalDay = originalEvaluation.observationDays.find(
      (day) => day.relativeDay === relativeDay,
    ) ?? null;
    const originalComponents: OriginalScoreComponents | null = originalDay?.flags == null
      ? null
      : {
        supportLine: originalDay.flags.support,
        shrink: originalDay.flags.shrink,
        lowStable: originalDay.flags.lowStable,
        closeImprove: originalDay.flags.closeImprove,
      };

    // ---- ST 闸门（价格状态照记；买入被拒单独标注） ----
    if (buyEligibility === "ST_BLOCKED") {
      reasons.push("ST_BLOCKED_AT_CONFIRM_CLOSE");
      bump("ST_BLOCKED_DAYS");
    } else if (buyEligibility === "UNKNOWN_BLOCKED") {
      reasons.push("UNKNOWN_BLOCKED_AT_CONFIRM_CLOSE");
      bump("UNKNOWN_BLOCKED_DAYS");
    }
    const factorAssessable = factorAssessableOf === undefined
      ? null
      : factorAssessableOf({ relativeDay, tradeDate });
    if (factorAssessable === false && !reasons.includes("FACTOR_NOT_ASSESSABLE")) {
      reasons.push("FACTOR_NOT_ASSESSABLE");
    }

    if (bar !== undefined && finitePositive(bar.low)) {
      runningMinLow = runningMinLow === null ? bar.low : Math.min(runningMinLow, bar.low);
    }
    const positionState: PositionState = positionStateOf === undefined
      ? "FLAT"
      : positionStateOf({ relativeDay, tradeDate });

    days.push({
      relativeDay,
      tradeDate,
      priceState,
      buyEligibility,
      positionState,
      signalFormed,
      buyDisabled,
      buyDisabledReason: buyDisabled ? "ANCHOR_BUY_DISABLED_SUPPORT_BREACHED" : null,
      originalScore: originalDay?.score ?? null,
      originalComponents,
      originalMissingReason: originalDay?.missingReason ?? null,
      repairScore,
      repairComponents,
      repairWindow,
      repairWindowScore,
      localLowRd: state.localLowRd,
      localLow: state.localLow,
      repairEpisodeId: state.localLowRd === null
        ? null
        : repairEpisodeIdOf(event.eventId, state.localLowRd),
      localLowUpdated,
      episodeRestarted,
      episodeBroken,
      runningMinLow,
      factorAssessable,
      statusFact,
      rejectionReasons: reasons,
    });
  }

  closeEpisode(null);

  if (breachRd !== null) bump("SUPPORT_BREACHED_ANCHORS");
  if (group === "A_STRICT_20") {
    if (breachRd !== null) {
      const violations = days.filter((day) => day.buyDisabled !== true).length;
      if (violations > 0) bump("BUY_DISABLE_FLAG_VIOLATIONS", violations);
      bump("PERMANENTLY_DISABLED_ANCHORS");
    }
  } else if (breachRd !== null && !triggers.some((trigger) => trigger.branch === "RECOVERY")) {
    bump("NO_RECOVERY_SIGNAL");
  }

  const finalDay = days[days.length - 1] ?? null;
  return {
    eventId: event.eventId,
    symbol: event.symbol,
    eventDate: event.eventDate,
    group,
    eventDayOpen,
    eventDayVolume,
    eventDayClose,
    supportFloor,
    days,
    triggers,
    originalEvaluation,
    supportBreachRd: breachRd,
    repairEpisodes: episodes,
    finalPriceState: finalDay?.priceState ?? "ORIGINAL_WATCH",
    finalReason: finalDay === null
      ? null
      : finalDay.rejectionReasons[finalDay.rejectionReasons.length - 1] ?? null,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// 下游查询
// ---------------------------------------------------------------------------

/** 批量求值（确定性：按输入顺序）。 */
export function evaluateRecoveryDaysFor(
  events: readonly PoolEvent[],
  options: RecoveryEvaluationOptions,
): Map<string, RecoveryEvaluation> {
  const out = new Map<string, RecoveryEvaluation>();
  for (const event of events) out.set(event.eventId, evaluateRecoveryDays(event, options));
  return out;
}

/** 某锚点在指定相对日是否形成信号（当日收盘确认、次日开盘计划下单）。 */
export function recoveryTriggerOn(
  evaluation: RecoveryEvaluation,
  relativeDay: number,
): RecoveryTrigger | null {
  for (const trigger of evaluation.triggers) {
    if (trigger.confirmRd === relativeDay) return trigger;
  }
  return null;
}

/** 只保留某一分支的确认日（归因用）。 */
export function triggersOfBranch(
  evaluation: RecoveryEvaluation,
  branch: RecoveryTrigger["branch"],
): readonly RecoveryTrigger[] {
  return evaluation.triggers.filter((trigger) => trigger.branch === branch);
}

/** 该锚点当日是否**可以真实买入**（价格信号 + 因子可评估 + 未被永久停用；ST 由两时点闸门另判）。 */
export function isBuyableSignal(day: RecoveryDayRecord): boolean {
  return day.signalFormed
    && day.buyEligibility === "NORMAL"
    && day.factorAssessable !== false
    && !day.buyDisabled;
}
