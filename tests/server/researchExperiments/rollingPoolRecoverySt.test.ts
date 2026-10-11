/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` · S3 规则 / 修复分支 / ST 闸门 边界测试。
 *
 * ⚠️ **纯合成 fixture**：不读真实 Dataset、不连 DB、不跑 Run、不产出收益矩阵。
 * 断言的是**规则**（目标 §3 / §4 / §8「关键测试」），不是实现的内部形状。
 *
 * 覆盖：
 *   1. A 组与 003 的 D **逐日同源**（直接复用 `evaluateEarlyEntry({5,20})` 的确认日）+ 破位后永久停买；
 *   2. 修复信号可以在**原 `0.98·O_0` 线以下**触发（本研究的全部意义）；
 *   3. `ΣQ_j ≥ 15` 且存在单日 `Q < 3` 仍触发；`ΣQ_j == 14` 不触发；
 *   4. 新低重启五日积累且**不发信号**；
 *   5. 无效日（停牌 / 缺行 / 零量）**不能**被跳过拼接；
 *   6. B 破位后**不删池成员**；
 *   7. `d ≤ 19` 边界（rd19 允许、rd20 不允许）；
 *   8. `L_t == F` 不视作新低；
 *   9. 两时点 ST 闸门：观察中转 ST / 隔夜转 ST / 平仓后再入场 / UNKNOWN 全部拒买，
 *      且首次、重试、再入场与 R/Random 使用**同一个**闸门；
 *  10. `ST_COVERAGE_BLOCKED` 守卫在 provider 无法核验时触发。
 */

import { describe, expect, it } from "vitest";
import {
  evaluateEarlyEntry,
} from "../../../research-experiments/shared/rollingPoolEarlyEntry";
import type { PoolBar, PoolEvent } from "../../../research-experiments/shared/rollingPoolRightTail";
import {
  ABSENT_STATUS_PROVIDER,
  ABSENT_STATUS_PROVIDER_ID,
  ST_GATE_CONTRACT_VERSION,
  StCoverageBlockedError,
  evaluateStGate,
  evaluateStGateForCandidate,
  summarizeStCoverage,
  type SecurityStatusFact,
  type SecurityStatusProvider,
  type StCoverageCheckpoint,
} from "../../../research-experiments/shared/rollingPoolRecovery/stGate";
import {
  CONFIRM_MAX_RD,
  CONFIRM_MIN_RD,
  ORIGINAL_ENTRY_FILL_MAX_RD,
  ORIGINAL_OBSERVATION_DAYS,
  REPAIR_SCORE_TOTAL_MIN,
  evaluateRecoveryDays,
  isBuyableSignal,
  isNewLocalLow,
  repairEpisodeIdOf,
  triggersOfBranch,
} from "../../../research-experiments/shared/rollingPoolRecovery";
import {
  GROUPS,
  RANDOM_ACCOUNT_COUNT_DEFAULT,
  RANDOM_ACCOUNT_COUNT_MAX,
  RANDOM_SEED_INDEX_BASE,
  randomSeedIndexesOf,
  resolveRunMode,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/result";
import {
  fillRdWithinCap,
  rollingPoolRecoveryStExperiment,
  sortCandidates,
  stCoverageReportOf,
} from "../../../research-experiments/first-board-pullback/rolling-pool-recovery-st/experiment";

// ---------------------------------------------------------------------------
// 合成 fixture
// ---------------------------------------------------------------------------

const EVENT_DATE = "2024-01-02";
/** 事件日（rd0）：`O_0 = 10`、`V_0 = 1000` ⇒ 原支撑线 `0.98·O_0 = 9.8`、缩量阈值 500。 */
const EVENT_OPEN = 10;
const EVENT_VOLUME = 1000;
const SUPPORT_FLOOR = 0.98 * EVENT_OPEN;
const SYMBOL = "000001.SZ";
const EVENT_ID = `${SYMBOL}@${EVENT_DATE}`;

/** 基线 bar：低点 9.95 / 收盘 9.96 / 量 400 ⇒ 原分支 `S = 3`（守线+缩量+低点稳定），且**永不突破**。 */
interface BarSpec {
  readonly low?: number;
  readonly close?: number;
  readonly high?: number;
  readonly open?: number;
  readonly volume?: number;
  readonly suspended?: boolean;
}

function tradeDateOf(relativeDay: number): string {
  return `2024-02-${String(relativeDay + 1).padStart(2, "0")}`;
}

function mkBar(relativeDay: number, spec: BarSpec): PoolBar {
  const close = spec.close ?? 9.96;
  const low = spec.low ?? 9.95;
  return {
    relativeDay,
    tradeDate: tradeDateOf(relativeDay),
    open: spec.open ?? 10,
    high: spec.high ?? Math.max(close, low) + 0.05,
    low,
    close,
    preClose: 10,
    limitUpPrice: 11,
    limitDownPrice: 9,
    volume: spec.volume ?? 400,
    amount: null,
    barPresent: spec.suspended !== true,
    suspended: spec.suspended === true,
    canBuyAtOpen: true,
    canSellAtClose: true,
  };
}

function mkEvent(args: {
  readonly bars: Readonly<Record<number, BarSpec>>;
  /** 这些相对日**没有行**（缺行，与「停牌」分开）。 */
  readonly missingRds?: readonly number[];
  readonly maxRd?: number;
}): PoolEvent {
  const maxRd = args.maxRd ?? 40;
  const post = new Map<number, PoolBar>();
  for (let relativeDay = 1; relativeDay <= maxRd; relativeDay += 1) {
    if ((args.missingRds ?? []).includes(relativeDay)) continue;
    post.set(relativeDay, mkBar(relativeDay, args.bars[relativeDay] ?? {}));
  }
  return {
    eventId: EVENT_ID,
    symbol: SYMBOL,
    eventDate: EVENT_DATE,
    year: 2024,
    market: "SZ",
    boardType: "main",
    isFirstLimit: true,
    prefix: new Map<number, PoolBar>([
      [-10, mkBar(-10, { close: 9.5, low: 9.4 })],
      [-1, mkBar(-1, { close: 9.8, low: 9.7 })],
      [0, {
        relativeDay: 0,
        tradeDate: EVENT_DATE,
        open: EVENT_OPEN,
        high: 10.2,
        low: 9.8,
        close: 10,
        preClose: 9.9,
        limitUpPrice: 11,
        limitDownPrice: 9,
        volume: EVENT_VOLUME,
        amount: null,
        barPresent: true,
        suspended: false,
        canBuyAtOpen: true,
        canSellAtClose: true,
      }],
    ]),
    post,
  };
}

/** 原分支（= 003 的 D）在 rd7 确认：`C_7 = 10.06 > max(H_5, H_6) = 10.0`，全程守线。 */
const ORIGINAL_TRIGGER_AT_RD7 = (): PoolEvent => mkEvent({
  bars: { 7: { close: 10.06, high: 10.1, low: 9.95 } },
});

/**
 * 破位后修复：rd2 破位（`L_2 = 9.70 < 9.8`）建立 `p=2 / F=9.70`；
 * W=`[3..7]` 全部在 `F` 之上（且**全部低于原支撑线**），rd8 确认。
 *
 * ⇒ 这是本研究的核心场景：**信号在原 `0.98·O_0` 线以下成立**。
 */
function repairEvent(bars: Readonly<Record<number, BarSpec>> = {}): PoolEvent {
  return mkEvent({
    bars: {
      2: { low: 9.7, close: 9.8, high: 9.85 },
      3: { low: 9.7, close: 9.72, high: 9.725 },
      4: { low: 9.7, close: 9.73, high: 9.735 },
      5: { low: 9.7, close: 9.74, high: 9.745 },
      6: { low: 9.7, close: 9.75, high: 9.755 },
      7: { low: 9.7, close: 9.76, high: 9.765 },
      8: { low: 9.7, close: 9.78, high: 9.785 },
      ...bars,
    },
  });
}

/**
 * 清洁修复段：rd2 破位，其后低点恒等于 `F`（**不创新低**）、收盘单调、量恒 400。
 *
 * ⇒ 任意 5 日窗口 `ΣQ = 19~20`（rd3 的 `Q3/Q4` 之一为 0，其后各日 4 分），
 *   且 `L_d == F` 天天发生（用于验证「与 F 相等不视作新低」）。
 * `breakoutRds` 里的日子给出「收盘高于前两日高点」的跳空。
 */
function cleanRepairEvent(breakoutRds: readonly number[], maxRd = 40): PoolEvent {
  const bars: Record<number, BarSpec> = { 2: { low: 9.7, close: 9.8, high: 9.85 } };
  let previousClose = 9.8;
  for (let relativeDay = 3; relativeDay <= maxRd; relativeDay += 1) {
    const close = breakoutRds.includes(relativeDay)
      ? previousClose + 0.05
      : previousClose + 0.001;
    previousClose = close;
    bars[relativeDay] = { low: 9.7, close, high: close + 0.005 };
  }
  return mkEvent({ bars, maxRd });
}

// ---------------------------------------------------------------------------
// 1) A 组 = 003 的 D（逐日同源）+ 破位后永久停买
// ---------------------------------------------------------------------------

describe("1) A 组（STRICT_20）与 003 的 D 逐日同源", () => {
  it("确认日集合与 evaluateEarlyEntry({observationDays:5, entryFillMaxRd:20}) 完全一致", () => {
    for (const event of [
      ORIGINAL_TRIGGER_AT_RD7(),
      mkEvent({ bars: { 7: { close: 10.06, high: 10.1 }, 12: { close: 10.2, high: 10.25 } } }),
      repairEvent(),
      cleanRepairEvent([19]),
    ]) {
      const authoritative = evaluateEarlyEntry(event, {
        observationDays: ORIGINAL_OBSERVATION_DAYS,
        entryFillMaxRd: ORIGINAL_ENTRY_FILL_MAX_RD,
      });
      const evaluation = evaluateRecoveryDays(event, { group: "A_STRICT_20" });
      expect(evaluation.triggers.map((trigger) => trigger.confirmRd))
        .toEqual(authoritative.triggers.map((trigger) => trigger.confirmRd));
      expect(evaluation.supportBreachRd).toBe(authoritative.supportBreachRd);
      expect(evaluation.triggers.every((trigger) => trigger.branch === "ORIGINAL")).toBe(true);
      // 逐日 S 证据也必须来自同一次权威求值（四项原始值单列）。
      for (const day of evaluation.days) {
        const scored = authoritative.observationDays.find((item) => item.relativeDay === day.relativeDay);
        expect(day.originalScore).toBe(scored?.score ?? null);
        expect(day.originalComponents?.supportLine).toBe(scored?.flags?.support ?? undefined);
      }
    }
  });

  it("B 组未破位分支与 A 组给出**相同**的确认日（未破位不加新门）", () => {
    const event = mkEvent({ bars: { 7: { close: 10.06, high: 10.1 }, 12: { close: 10.2, high: 10.25 } } });
    const a = evaluateRecoveryDays(event, { group: "A_STRICT_20" });
    const b = evaluateRecoveryDays(event, { group: "B_RECOVERY_20" });
    expect(b.supportBreachRd).toBeNull();
    expect(b.triggers.map((trigger) => trigger.confirmRd))
      .toEqual(a.triggers.map((trigger) => trigger.confirmRd));
  });

  it("首次可靠破位后 A 组永久停买（继续观察），且不再产生任何信号", () => {
    const evaluation = evaluateRecoveryDays(cleanRepairEvent([9, 14, 19]), { group: "A_STRICT_20" });
    expect(evaluation.supportBreachRd).toBe(2);
    expect(evaluation.triggers).toHaveLength(0);
    const afterBreach = evaluation.days.filter((day) => day.relativeDay >= 2);
    expect(afterBreach).not.toHaveLength(0);
    expect(afterBreach.every((day) => day.buyDisabled)).toBe(true);
    expect(afterBreach.every(
      (day) => day.buyDisabledReason === "ANCHOR_BUY_DISABLED_SUPPORT_BREACHED",
    )).toBe(true);
    // 「保留观察」= 40 天记录仍在，且从未出现 RECOVERY_* 状态（A 组不走修复分支）。
    expect(evaluation.days).toHaveLength(40);
    expect(evaluation.days.some((day) => day.priceState.startsWith("RECOVERY"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2) 修复信号可以fire在 0.98·O_0 线以下
// ---------------------------------------------------------------------------

describe("2) 破位后的修复信号可以在原支撑线以下成立", () => {
  it("整段（含确认日）都在 0.98·O_0 以下，仍然触发", () => {
    const event = repairEvent();
    const evaluation = evaluateRecoveryDays(event, { group: "B_RECOVERY_20" });
    expect(evaluation.supportBreachRd).toBe(2);
    const recoveryTriggers = triggersOfBranch(evaluation, "RECOVERY");
    expect(recoveryTriggers.map((trigger) => trigger.confirmRd)).toEqual([8, 9]);
    const first = recoveryTriggers[0]!;
    expect(first.confirmRd).toBe(8);
    expect(first.fillRd).toBe(9);
    expect(first.localLowRd).toBe(2);
    expect(first.localLow).toBeCloseTo(9.7, 10);
    expect(first.repairWindow).toEqual([3, 4, 5, 6, 7]);
    expect(first.repairWindowScore).toBe(19);
    expect(first.repairWindowScore).toBeGreaterThanOrEqual(REPAIR_SCORE_TOTAL_MIN);
    // 确认日收盘与整段低点都在原支撑线之下。
    expect(first.closeConfirm).toBeLessThan(SUPPORT_FLOOR);
    for (const relativeDay of [2, 3, 4, 5, 6, 7, 8]) {
      const bar = event.post.get(relativeDay)!;
      expect(bar.low as number).toBeLessThan(SUPPORT_FLOOR);
    }
    // A 组在同一路径上被永久停买 ⇒ 这就是 A/B 的机制差异。
    const strict = evaluateRecoveryDays(event, { group: "A_STRICT_20" });
    expect(strict.triggers).toHaveLength(0);
    expect(strict.days[1]?.buyDisabled).toBe(true);
    // 破位后**不要求**收复 0.98·O_0（F 只是修复段的参考支撑，不是退出价）。
    expect(first.localLow).toBeLessThan(SUPPORT_FLOOR);
  });
});

// ---------------------------------------------------------------------------
// 3) ΣQ 判据：单日不足可触发、总分不足不触发
// ---------------------------------------------------------------------------

describe("3) 修复综合分 ΣQ_j 判据", () => {
  /** W=[3..7]：rd5 单日 `Q = 2`（放量 + 低点下移），其余日 4/3/4/4 ⇒ ΣQ = 17。 */
  const ONE_WEAK_DAY = (): PoolEvent => repairEvent({
    3: { low: 9.79, close: 9.9, high: 9.92 },
    4: { low: 9.78, close: 9.91, high: 9.93 },
    5: { low: 9.7, close: 9.92, high: 9.94, volume: 600 },
    6: { low: 9.72, close: 9.93, high: 9.95 },
    7: { low: 9.73, close: 9.94, high: 9.96 },
    8: { low: 9.74, close: 9.97, high: 10.0 },
  });

  it("ΣQ = 17 且存在单日 Q = 2 < 3 ⇒ 仍然触发（不要求每天 Q ≥ 3）", () => {
    const evaluation = evaluateRecoveryDays(ONE_WEAK_DAY(), { group: "B_RECOVERY_20" });
    const day5 = evaluation.days.find((day) => day.relativeDay === 5)!;
    const day8 = evaluation.days.find((day) => day.relativeDay === 8)!;
    expect(day5.repairScore).toBe(2);
    expect(day8.repairWindow).toEqual([3, 4, 5, 6, 7]);
    expect(day8.repairWindowScore).toBe(17);
    expect(triggersOfBranch(evaluation, "RECOVERY").map((trigger) => trigger.confirmRd)).toContain(8);
    // 四项原始值必须单列（合计不能掩盖路径差异）。
    expect(day5.repairComponents).toEqual({
      atOrAboveLocalLow: 1,
      shrink: 0,
      lowStable: 0,
      closeImprove: 1,
    });
  });

  it("ΣQ = 14 ⇒ 不触发（且如实给出 14 分与 `REPAIR_COMPOSITE_SCORE_INSUFFICIENT`）", () => {
    const evaluation = evaluateRecoveryDays(
      repairEvent({
        3: { low: 9.79, close: 9.9, high: 9.92 },
        4: { low: 9.78, close: 9.91, high: 9.93, volume: 600 },
        5: { low: 9.7, close: 9.92, high: 9.94, volume: 600 },
        6: { low: 9.72, close: 9.93, high: 9.95, volume: 600 },
        7: { low: 9.73, close: 9.94, high: 9.96, volume: 600 },
        8: { low: 9.74, close: 9.97, high: 10.0 },
      }),
      { group: "B_RECOVERY_20" },
    );
    const day8 = evaluation.days.find((day) => day.relativeDay === 8)!;
    expect(day8.repairWindowScore).toBeLessThan(REPAIR_SCORE_TOTAL_MIN);
    expect(day8.repairWindowScore).toBe(14);
    expect(day8.priceState).not.toBe("SIGNAL_FORMED");
    expect(day8.rejectionReasons).toContain("REPAIR_COMPOSITE_SCORE_INSUFFICIENT");
    expect(triggersOfBranch(evaluation, "RECOVERY")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4) 新低重启五日积累，不发信号
// ---------------------------------------------------------------------------

describe("4) 新低重启修复段", () => {
  /** rd7 创更低点（9.60 < F=9.70）⇒ 更新 `p=7 / F=9.60`，回到观察、不发信号。 */
  const NEW_LOW_AT_RD7 = (): PoolEvent => repairEvent({
    3: { low: 9.72, close: 9.73, high: 9.74 },
    4: { low: 9.74, close: 9.75, high: 9.76 },
    5: { low: 9.76, close: 9.77, high: 9.78 },
    6: { low: 9.78, close: 9.79, high: 9.8 },
    7: { low: 9.6, close: 9.65, high: 9.7 },
    8: { low: 9.6, close: 9.66, high: 9.67 },
    13: { low: 9.6, close: 10.06, high: 10.1 },
  });

  it("rd7 创更低点：更新 p/F、关闭旧段、不发信号（即使确认条件都满足）", () => {
    const evaluation = evaluateRecoveryDays(NEW_LOW_AT_RD7(), { group: "B_RECOVERY_20" });
    const day7 = evaluation.days.find((day) => day.relativeDay === 7)!;
    expect(day7.localLowUpdated).toBe(true);
    expect(day7.localLowRd).toBe(7);
    expect(day7.localLow).toBeCloseTo(9.6, 10);
    expect(day7.repairEpisodeId).toBe(repairEpisodeIdOf(EVENT_ID, 7));
    expect(day7.priceState).toBe("RECOVERY_WATCH");
    expect(day7.signalFormed).toBe(false);
    expect(day7.rejectionReasons).toContain("REPAIR_LOCAL_LOW_UPDATED");
    // 旧段被关闭并保留（破位记录不丢）。
    expect(evaluation.repairEpisodes.map((episode) => episode.localLowRd)).toEqual([2, 7]);
    expect(evaluation.repairEpisodes[0]?.brokenAtRd).toBe(7);
    // 新段必须**重新积累**五日：最早确认日 = p + 6 = rd13。
    const recoveryRds = triggersOfBranch(evaluation, "RECOVERY").map((trigger) => trigger.confirmRd);
    expect(recoveryRds).toContain(13);
    expect(recoveryRds.some((relativeDay) => relativeDay < 13)).toBe(false);
    expect(recoveryRds.every((relativeDay) => relativeDay - 5 > 7)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5) 无效日不能拼接
// ---------------------------------------------------------------------------

describe("5) 无效日（停牌 / 缺行 / 零量）不得被跳过拼接", () => {
  const baseline = (): PoolEvent => repairEvent();

  it("停牌日打断本段；下一有效日重开段并重新积累（对照：无停牌时 rd8 触发）", () => {
    const control = evaluateRecoveryDays(baseline(), { group: "B_RECOVERY_20" });
    expect(triggersOfBranch(control, "RECOVERY").map((trigger) => trigger.confirmRd)).toContain(8);

    const suspended = evaluateRecoveryDays(
      repairEvent({ 5: { suspended: true } }),
      { group: "B_RECOVERY_20" },
    );
    const day5 = suspended.days.find((day) => day.relativeDay === 5)!;
    expect(day5.episodeBroken).toBe(true);
    expect(day5.rejectionReasons).toContain("REPAIR_EPISODE_BROKEN_BY_GAP");
    expect(day5.repairWindowScore).toBeNull();
    // rd6 也无效：它缺的正是被停牌打断的前日比较值 ⇒ 仍在本段之外。
    const day6 = suspended.days.find((day) => day.relativeDay === 6)!;
    expect(day6.episodeBroken).toBe(true);
    // 下一有效日（rd7）建立新的局部观察段与低点基准。
    const day7 = suspended.days.find((day) => day.relativeDay === 7)!;
    expect(day7.episodeRestarted).toBe(true);
    expect(day7.localLowRd).toBe(7);
    expect(day7.rejectionReasons).toContain("REPAIR_EPISODE_RESTARTED_AFTER_GAP");
    // 五日在 p=7 之后 ⇒ 最早 rd13；rd8 绝不能触发。
    expect(suspended.days.find((day) => day.relativeDay === 8)?.signalFormed).toBe(false);
    expect(triggersOfBranch(suspended, "RECOVERY").map((trigger) => trigger.confirmRd))
      .not.toContain(8);
    expect(suspended.repairEpisodes.map((episode) => episode.localLowRd)).toEqual([2, 7]);
    // 历史缺口与破位记录都保留。
    expect(suspended.supportBreachRd).toBe(2);
    expect(suspended.diagnostics.GAP_BROKEN_EPISODES).toBeGreaterThanOrEqual(1);
  });

  it("零量日（volume = 0）同样不可评估 ⇒ 不可拼接", () => {
    const zeroVolume = evaluateRecoveryDays(
      repairEvent({ 5: { volume: 0 } }),
      { group: "B_RECOVERY_20" },
    );
    const day5 = zeroVolume.days.find((day) => day.relativeDay === 5)!;
    expect(day5.episodeBroken).toBe(true);
    expect(day5.rejectionReasons).toContain("DAY_NOT_ASSESSABLE");
    expect(triggersOfBranch(zeroVolume, "RECOVERY").map((trigger) => trigger.confirmRd))
      .not.toContain(8);
  });

  it("缺行（该相对日没有 bar）同样不可评估 ⇒ 不可拼接", () => {
    const missingRow = evaluateRecoveryDays(
      mkEvent({
        missingRds: [5],
        bars: {
          2: { low: 9.7, close: 9.8, high: 9.85 },
          3: { low: 9.7, close: 9.72, high: 9.725 },
          4: { low: 9.7, close: 9.73, high: 9.735 },
          6: { low: 9.7, close: 9.75, high: 9.755 },
          7: { low: 9.7, close: 9.76, high: 9.765 },
          8: { low: 9.7, close: 9.78, high: 9.785 },
        },
      }),
      { group: "B_RECOVERY_20" },
    );
    const day5 = missingRow.days.find((day) => day.relativeDay === 5)!;
    expect(day5.tradeDate).toBeNull();
    expect(day5.episodeBroken).toBe(true);
    expect(triggersOfBranch(missingRow, "RECOVERY").map((trigger) => trigger.confirmRd))
      .not.toContain(8);
  });

  it("无效日在窗口内的日子也不会被跳过（`REPAIR_WINDOW_NOT_ASSESSABLE` 或本段已重开）", () => {
    const suspended = evaluateRecoveryDays(repairEvent({ 4: { suspended: true } }), {
      group: "B_RECOVERY_20",
    });
    const day8 = suspended.days.find((day) => day.relativeDay === 8)!;
    expect(day8.signalFormed).toBe(false);
    expect(
      day8.rejectionReasons.includes("REPAIR_WINDOW_NOT_ASSESSABLE")
      || day8.rejectionReasons.includes("REPAIR_NO_FRESH_WINDOW_AFTER_LOCAL_LOW"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6) B 组破位后不删池成员
// ---------------------------------------------------------------------------

describe("6) B 组破位后不永久删池成员", () => {
  it("破位后仍有完整 rd1..40 记录、修复段持续跟踪，且后续仍能产生信号", () => {
    const evaluation = evaluateRecoveryDays(cleanRepairEvent([9, 14, 19]), { group: "B_RECOVERY_20" });
    expect(evaluation.supportBreachRd).toBe(2);
    expect(evaluation.days).toHaveLength(40);
    const afterBreach = evaluation.days.filter((day) => day.relativeDay > 2);
    expect(afterBreach.every((day) => day.buyDisabled === false)).toBe(true);
    expect(afterBreach.some((day) => day.priceState === "RECOVERY_WATCH")).toBe(true);
    expect(afterBreach.some((day) => day.priceState === "RECOVERY_MATURE")).toBe(true);
    expect(afterBreach.every((day) => day.repairEpisodeId === repairEpisodeIdOf(EVENT_ID, 2))).toBe(true);
    expect(triggersOfBranch(evaluation, "RECOVERY").map((trigger) => trigger.confirmRd))
      .toEqual([9, 14, 19]);
    // 与 A 组形成对照：同一条路径在 A 组被永久停买。
    const strict = evaluateRecoveryDays(cleanRepairEvent([9, 14, 19]), { group: "A_STRICT_20" });
    expect(strict.triggers).toHaveLength(0);
    expect(strict.days.filter((day) => day.buyDisabled).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7) d ≤ 19 边界
// ---------------------------------------------------------------------------

describe("7) 确认日上限 d ≤ 19", () => {
  it("rd19 允许（成交 rd20），rd20 不允许（到期只观察）", () => {
    const evaluation = evaluateRecoveryDays(cleanRepairEvent([19, 20]), { group: "B_RECOVERY_20" });
    expect(CONFIRM_MAX_RD).toBe(19);
    expect(CONFIRM_MIN_RD).toBe(6);
    const recoveryRds = triggersOfBranch(evaluation, "RECOVERY").map((trigger) => trigger.confirmRd);
    expect(recoveryRds).toContain(19);
    expect(recoveryRds).not.toContain(20);
    expect(recoveryRds.every((relativeDay) => relativeDay <= CONFIRM_MAX_RD)).toBe(true);
    const day19 = evaluation.days.find((day) => day.relativeDay === 19)!;
    const day20 = evaluation.days.find((day) => day.relativeDay === 20)!;
    expect(day19.priceState).toBe("SIGNAL_FORMED");
    expect(day19.signalFormed).toBe(true);
    expect(day20.priceState).toBe("EXPIRED");
    expect(day20.rejectionReasons).toContain("CONFIRM_WINDOW_EXPIRED");
    const trigger19 = evaluation.triggers.find((trigger) => trigger.confirmRd === 19)!;
    expect(trigger19.fillRd).toBe(20);
    expect(trigger19.fillRd).toBe(ORIGINAL_ENTRY_FILL_MAX_RD);
  });
});

// ---------------------------------------------------------------------------
// 8) L_t == F 不是新低
// ---------------------------------------------------------------------------

describe("8) `L_t == F` 不视作新低", () => {
  it("清洁修复段（低点恒等于 F）不产生任何 localLowUpdated / 新修复段", () => {
    const evaluation = evaluateRecoveryDays(cleanRepairEvent([9, 14, 19]), { group: "B_RECOVERY_20" });
    expect(evaluation.repairEpisodes).toHaveLength(1);
    expect(evaluation.days.filter((day) => day.localLowUpdated)).toHaveLength(0);
    expect(evaluation.days.every(
      (day) => day.localLowRd === null || day.localLowRd === 2,
    )).toBe(true);
    expect(evaluation.days.find((day) => day.relativeDay === 9)?.signalFormed).toBe(true);
  });

  it("`isNewLocalLow` 是**严格**小于（带容差）", () => {
    expect(isNewLocalLow(9.7, 9.7)).toBe(false);
    expect(isNewLocalLow(9.7 + 1e-12, 9.7)).toBe(false);
    expect(isNewLocalLow(9.7 - 1e-6, 9.7)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9) 两时点 ST 闸门
// ---------------------------------------------------------------------------

interface StInterval {
  readonly from: string;
  readonly to: string;
  /** 该区间**可获知**的时刻（公告时间），不是采集时间。 */
  readonly availableAsOf: string;
}

/**
 * 「穷尽名单」式 provider：ST 区间显式列出；区间之外给**有界**的 NORMAL 区间。
 *
 * 🔴 这正是 S1 审计要求的数据形态：区间 + 生效时间 + **可获知时间** + 来源 + 证据指纹。
 *    `coverage` 之外一律返回 `null`（无结论 ⇒ UNKNOWN），**绝不用 NORMAL 兜底**。
 */
function exhaustiveProvider(args: {
  readonly stIntervals: readonly StInterval[];
  readonly coverage: { readonly from: string; readonly to: string; readonly availableAsOf: string };
  readonly normalEffectiveTo?: string | null;
  readonly confidence?: "VERIFIED" | "UNVERIFIED";
  readonly contractVersion?: string;
  readonly source?: string;
}): SecurityStatusProvider {
  return {
    providerId: "TEST_EXHAUSTIVE_STATUS",
    contractVersion: args.contractVersion ?? ST_GATE_CONTRACT_VERSION,
    statusAt: (query): SecurityStatusFact | null => {
      if (query.tradeDate < args.coverage.from || query.tradeDate > args.coverage.to) return null;
      const st = args.stIntervals.find(
        (interval) => query.tradeDate >= interval.from && query.tradeDate <= interval.to,
      );
      if (st !== undefined) {
        return {
          symbol: query.symbol,
          tradeDate: query.tradeDate,
          status: "ST",
          effectiveFrom: st.from,
          effectiveTo: st.to,
          availableAsOf: st.availableAsOf,
          source: args.source ?? "TEST_ST_LIST",
          confidence: args.confidence ?? "VERIFIED",
          evidenceFingerprint: `test-st:${st.from}..${st.to}`,
        };
      }
      return {
        symbol: query.symbol,
        tradeDate: query.tradeDate,
        status: "NORMAL",
        effectiveFrom: args.coverage.from,
        effectiveTo: args.normalEffectiveTo === undefined ? args.coverage.to : args.normalEffectiveTo,
        availableAsOf: args.coverage.availableAsOf,
        source: args.source ?? "TEST_ST_LIST",
        confidence: args.confidence ?? "VERIFIED",
        evidenceFingerprint: `test-normal:${args.coverage.from}..${args.coverage.to}`,
      };
    },
  };
}

const NORMAL_COVERAGE = Object.freeze({
  from: "2024-02-02",
  to: "2024-03-31",
  availableAsOf: "2024-02-01",
});

/**
 * 「之后一直如此」的区间终点。
 *
 * 🔴 FIX-005 / F2 之后**必须**是**合法日历日**：闸门不再接受 `2024-02-41` 这类
 *    由算术溢出产生、却靠字典序「恰好排在区间内」的写法（那正是 F2 禁止的放行方式）。
 *    这里用一个真实的远期日期，语义与原来的 `tradeDateOf(40)` 相同（覆盖整个窗口）。
 */
const ST_FAR_END = "2024-03-31";

function checkpointOf(args: {
  readonly group: string;
  readonly confirmRd: number;
  readonly fillRd: number;
  readonly provider: SecurityStatusProvider | null;
}): StCoverageCheckpoint {
  return {
    anchorEventId: EVENT_ID,
    symbol: SYMBOL,
    group: args.group,
    confirmDate: tradeDateOf(args.confirmRd),
    fillDate: tradeDateOf(args.fillRd),
    gate: evaluateStGateForCandidate({
      provider: args.provider,
      symbol: SYMBOL,
      confirmDate: tradeDateOf(args.confirmRd),
      fillDate: tradeDateOf(args.fillRd),
    }),
  };
}

describe("9) 两时点 ST 闸门（确认日收盘资格 + 成交前复查）", () => {
  it("默认（无 provider）⇒ 逐日 UNKNOWN_BLOCKED，且没有任何一天可买", () => {
    const evaluation = evaluateRecoveryDays(cleanRepairEvent([9, 14, 19]), { group: "B_RECOVERY_20" });
    expect(evaluation.days.every((day) => day.buyEligibility === "UNKNOWN_BLOCKED")).toBe(true);
    expect(evaluation.days.filter((day) => day.signalFormed)
      .every((day) => isBuyableSignal(day) === false)).toBe(true);
    expect(evaluation.days.filter((day) => day.signalFormed).length).toBeGreaterThan(0);
    const withAbsent = evaluateRecoveryDays(cleanRepairEvent([19]), {
      group: "B_RECOVERY_20",
      stProvider: ABSENT_STATUS_PROVIDER,
    });
    expect(withAbsent.days.every((day) => day.buyEligibility === "UNKNOWN_BLOCKED")).toBe(true);
    expect(ABSENT_STATUS_PROVIDER.providerId).toBe(ABSENT_STATUS_PROVIDER_ID);
    expect(ABSENT_STATUS_PROVIDER.statusAt({
      symbol: SYMBOL,
      tradeDate: NORMAL_COVERAGE.from,
      timepoint: "PRE_FILL",
      effectiveAt: "2024-02-02T09:15:00",
    })).toBeNull();
  });

  it("(a) 观察中转 ST ⇒ 确认日收盘即拒买（R 与 Random 同结论）", () => {
    // ST 从 rd13 起生效，rd12 收盘后公告（可获知）。
    const provider = exhaustiveProvider({
      stIntervals: [{ from: tradeDateOf(13), to: ST_FAR_END, availableAsOf: tradeDateOf(12) }],
      coverage: NORMAL_COVERAGE,
    });
    const evaluation = evaluateRecoveryDays(cleanRepairEvent([9, 14, 19]), {
      group: "B_RECOVERY_20",
      stProvider: provider,
    });
    const day9 = evaluation.days.find((day) => day.relativeDay === 9)!;
    const day14 = evaluation.days.find((day) => day.relativeDay === 14)!;
    expect(day9.signalFormed).toBe(true);
    expect(day9.buyEligibility).toBe("NORMAL");
    expect(isBuyableSignal(day9)).toBe(true);
    expect(day14.buyEligibility).toBe("ST_BLOCKED");
    expect(isBuyableSignal(day14)).toBe(false);
    expect(day14.rejectionReasons).toContain("ST_BLOCKED_AT_CONFIRM_CLOSE");
    const gate = evaluateStGateForCandidate({
      provider,
      symbol: SYMBOL,
      confirmDate: tradeDateOf(14),
      fillDate: tradeDateOf(15),
    });
    expect(gate.buyAllowed).toBe(false);
    expect(gate.rejectionReason).toBe("VERIFIED_ST");
    expect(gate.rejectionTimepoint).toBe("CONFIRM_CLOSE_ELIGIBILITY");
    // 价格观察历史**不因 ST 被抹掉**：信号照样成立。
    expect(day14.priceState).toBe("SIGNAL_FORMED");
  });

  it("(b) 信号在前一日 / 隔夜转 ST ⇒ 成交前复查取消订单", () => {
    // rd14 收盘时仍是 NORMAL；rd15 起 ST，rd14 收盘后公告。
    const provider = exhaustiveProvider({
      stIntervals: [{ from: tradeDateOf(15), to: ST_FAR_END, availableAsOf: tradeDateOf(14) }],
      coverage: NORMAL_COVERAGE,
    });
    const gate = evaluateStGateForCandidate({
      provider,
      symbol: SYMBOL,
      confirmDate: tradeDateOf(14),
      fillDate: tradeDateOf(15),
    });
    expect(gate.confirmClose.outcome).toBe("NORMAL");
    expect(gate.preFill.outcome).toBe("ST");
    expect(gate.buyAllowed).toBe(false);
    expect(gate.rejectionReason).toBe("VERIFIED_ST");
    expect(gate.rejectionTimepoint).toBe("PRE_FILL");
    // 不可核验的情形（st 区间在覆盖范围之外 ⇒ provider 返回 null）同样拒买。
    const outside = evaluateStGateForCandidate({
      provider: exhaustiveProvider({
        stIntervals: [],
        coverage: { from: "2024-02-02", to: "2024-02-10", availableAsOf: "2024-02-01" },
      }),
      symbol: SYMBOL,
      confirmDate: tradeDateOf(19),
      fillDate: tradeDateOf(20),
    });
    expect(outside.confirmClose.outcome).toBe("UNKNOWN");
    expect(outside.buyAllowed).toBe(false);
    expect(outside.rejectionReason).toBe("NO_STATUS_FACT");
  });

  it("(c) 平仓后再次入场的信号**同样**被两时点闸门拦截", () => {
    const provider = exhaustiveProvider({
      stIntervals: [{ from: tradeDateOf(13), to: tradeDateOf(14), availableAsOf: tradeDateOf(12) }],
      coverage: NORMAL_COVERAGE,
    });
    const evaluation = evaluateRecoveryDays(cleanRepairEvent([9, 14, 19]), {
      group: "B_RECOVERY_20",
      stProvider: provider,
    });
    const recoveryRds = triggersOfBranch(evaluation, "RECOVERY").map((trigger) => trigger.confirmRd);
    // 首次入场（rd9）与再入场（rd14）都被求值；再入场那笔在确认日收盘被拒。
    expect(recoveryRds).toEqual([9, 14, 19]);
    const first = evaluation.days.find((day) => day.relativeDay === 9)!;
    const reentry = evaluation.days.find((day) => day.relativeDay === 14)!;
    expect(isBuyableSignal(first)).toBe(true);
    expect(isBuyableSignal(reentry)).toBe(false);
    expect(reentry.rejectionReasons).toContain("ST_BLOCKED_AT_CONFIRM_CLOSE");
    // 两笔走的是**同一个**组合器（同一个函数、同一个入参形状）。
    const firstGate = evaluateStGateForCandidate({
      provider, symbol: SYMBOL, confirmDate: tradeDateOf(9), fillDate: tradeDateOf(10),
    });
    const reentryGate = evaluateStGateForCandidate({
      provider, symbol: SYMBOL, confirmDate: tradeDateOf(14), fillDate: tradeDateOf(15),
    });
    expect(firstGate.buyAllowed).toBe(true);
    expect(reentryGate.buyAllowed).toBe(false);
  });

  it("首次 / 重试 / 再入场 / R / Random 共用**同一个**闸门（结构上无法区分臂与次序）", () => {
    const provider = exhaustiveProvider({ stIntervals: [], coverage: NORMAL_COVERAGE });
    const args = {
      provider, symbol: SYMBOL, confirmDate: tradeDateOf(9), fillDate: tradeDateOf(10),
    } as const;
    const first = evaluateStGateForCandidate(args);
    const retry = evaluateStGateForCandidate(args);
    const reentry = evaluateStGateForCandidate(args);
    expect(retry).toEqual(first);
    expect(reentry).toEqual(first);
    // 只接受一个入参对象 ⇒ 没有 arm / attempt / kind 之类的分支开关。
    expect(evaluateStGateForCandidate.length).toBe(1);
    // 检查点里的 group 只用于**报告**：同一 (symbol, 日期, provider) 下判决完全相同。
    const armA = checkpointOf({ group: "A_STRICT_20", confirmRd: 9, fillRd: 10, provider });
    const armB = checkpointOf({ group: "B_RECOVERY_20", confirmRd: 9, fillRd: 10, provider });
    expect(armA.gate).toEqual(armB.gate);
    expect(armA.gate.buyAllowed).toBe(true);
    // 单时点闸门也共用同一个实现（两格都由它产出）。
    expect(evaluateStGate({
      provider,
      query: {
        symbol: SYMBOL,
        tradeDate: tradeDateOf(9),
        timepoint: "CONFIRM_CLOSE_ELIGIBILITY",
        effectiveAt: `${tradeDateOf(9)}T15:00:00`,
      },
    }).outcome).toBe("NORMAL");
  });

  it("(d) UNKNOWN 一律拒买：缺 provider / 缺事实 / 未核验 / 事后补录 / 无界 NORMAL / 契约不符", () => {
    const unknownCases: readonly {
      readonly label: string;
      readonly provider: SecurityStatusProvider | null;
      readonly reason: string;
    }[] = [
      { label: "无 provider", provider: null, reason: "NO_STATUS_PROVIDER" },
      {
        label: "缺事实",
        provider: exhaustiveProvider({
          stIntervals: [],
          coverage: { from: "2024-03-01", to: "2024-03-31", availableAsOf: "2024-02-01" },
        }),
        reason: "NO_STATUS_FACT",
      },
      {
        label: "证据未核验",
        provider: exhaustiveProvider({
          stIntervals: [], coverage: NORMAL_COVERAGE, confidence: "UNVERIFIED",
        }),
        reason: "UNVERIFIED_STATUS_EVIDENCE",
      },
      {
        label: "当时还不可知（事后补录）",
        provider: exhaustiveProvider({
          stIntervals: [],
          coverage: { ...NORMAL_COVERAGE, availableAsOf: "2025-01-01" },
        }),
        reason: "NOT_AVAILABLE_AS_OF",
      },
      {
        label: "无界 NORMAL 区间",
        provider: exhaustiveProvider({
          stIntervals: [], coverage: NORMAL_COVERAGE, normalEffectiveTo: null,
        }),
        reason: "NORMAL_INTERVAL_UNBOUNDED",
      },
      {
        label: "provider 契约版本不符",
        provider: exhaustiveProvider({
          stIntervals: [], coverage: NORMAL_COVERAGE, contractVersion: "0.0.1",
        }),
        reason: "PROVIDER_CONTRACT_MISMATCH",
      },
    ];
    for (const testCase of unknownCases) {
      const evaluation = evaluateRecoveryDays(cleanRepairEvent([9]), {
        group: "B_RECOVERY_20",
        stProvider: testCase.provider,
      });
      const signalDay = evaluation.days.find((day) => day.signalFormed)!;
      expect(signalDay.buyEligibility, testCase.label).toBe("UNKNOWN_BLOCKED");
      expect(isBuyableSignal(signalDay), testCase.label).toBe(false);
      const gate = evaluateStGateForCandidate({
        provider: testCase.provider,
        symbol: SYMBOL,
        confirmDate: tradeDateOf(9),
        fillDate: tradeDateOf(10),
      });
      expect(gate.buyAllowed, testCase.label).toBe(false);
      expect(gate.confirmClose.reason, testCase.label).toBe(testCase.reason);
    }
  });
});

// ---------------------------------------------------------------------------
// 10) ST_COVERAGE_BLOCKED 守卫
// ---------------------------------------------------------------------------

describe("10) 覆盖缺口守卫（ST_COVERAGE_BLOCKED）", () => {
  it("任一计划检查时点缺少可核验结论 ⇒ blocked = true 且 carry 缺口摘要", () => {
    const checkpoints: StCoverageCheckpoint[] = [
      checkpointOf({ group: "A_STRICT_20", confirmRd: 9, fillRd: 10, provider: null }),
      checkpointOf({ group: "B_RECOVERY_20", confirmRd: 19, fillRd: 20, provider: null }),
    ];
    const summary = summarizeStCoverage(checkpoints);
    expect(summary.status).toBe("ST_COVERAGE_BLOCKED");
    expect(summary.blocked).toBe(true);
    expect(summary.candidateCount).toBe(2);
    expect(summary.timepointChecks).toBe(4);
    expect(summary.unknownCount).toBe(4);
    expect(summary.unknownByTimepoint.CONFIRM_CLOSE_ELIGIBILITY).toBe(2);
    expect(summary.unknownByTimepoint.PRE_FILL).toBe(2);
    expect(summary.unknownByReason.NO_STATUS_PROVIDER).toBe(4);
    expect(summary.gapSamples).toHaveLength(4);
    const error = new StCoverageBlockedError(summary);
    expect(error.code).toBe("ST_COVERAGE_BLOCKED");
    expect(error.message).toContain("ST_COVERAGE_BLOCKED");
    expect(error.message).toContain("收益矩阵暂停");
    expect(error.summary).toBe(summary);
  });

  it("全部时点都可核验 ⇒ blocked = false（正对照）", () => {
    const provider = exhaustiveProvider({ stIntervals: [], coverage: NORMAL_COVERAGE });
    const summary = summarizeStCoverage([
      checkpointOf({ group: "A_STRICT_20", confirmRd: 9, fillRd: 10, provider }),
      checkpointOf({ group: "B_RECOVERY_20", confirmRd: 19, fillRd: 20, provider }),
    ]);
    expect(summary.status).toBe("ST_COVERAGE_VERIFIED");
    expect(summary.blocked).toBe(false);
    expect(summary.verifiedNormalCount).toBe(4);
    expect(summary.unknownCount).toBe(0);
    expect(summary.gapSamples).toHaveLength(0);
  });

  it("真实的 ST 拒单与 UNKNOWN 缺口分开计数（不被 UNKNOWN 吞掉）", () => {
    const provider = exhaustiveProvider({
      stIntervals: [{ from: tradeDateOf(19), to: ST_FAR_END, availableAsOf: tradeDateOf(18) }],
      coverage: NORMAL_COVERAGE,
    });
    const summary = summarizeStCoverage([
      checkpointOf({ group: "A_STRICT_20", confirmRd: 9, fillRd: 10, provider }),
      checkpointOf({ group: "B_RECOVERY_20", confirmRd: 19, fillRd: 20, provider }),
    ]);
    expect(summary.stRejectedCount).toBeGreaterThan(0);
    expect(summary.verifiedNormalCount).toBeGreaterThan(0);
    expect(summary.unknownCount).toBe(0);
    expect(summary.blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11) 实验外壳：冻结坐标 + ST 闸门守卫（**真闸门**）
// ---------------------------------------------------------------------------

describe("11) 实验外壳：冻结坐标与 ST 覆盖守卫", () => {
  it("描述符：两组、42 账户默认、ST 覆盖闸门写进中止条件", () => {
    const descriptor = rollingPoolRecoveryStExperiment.descriptor;
    expect(descriptor.id).toBe("first-board-pullback/rolling-pool-recovery-st");
    expect(descriptor.pageKey).toBe(descriptor.id);
    /**
     * 🔴 这里断言的是「**保持缺省** `SINGLE_EVENT`」，不是 `COMPOSITE_PORTFOLIO`。
     *
     * 为什么原先那条断言（`executionSurface === "COMPOSITE_PORTFOLIO"`）是**错的**：
     * 平台 Runner 一旦看到该声明就要求 `compositeExecution.baselineDatasetVersionId`，
     * 缺了即在 `run()` 之前抛 `EXPERIMENT_COMPOSITE_BASELINE_MISSING`
     * （`server/researchExperiments/runner.ts`，刻意「拒绝静默降级」）⇒ **任何** Run 都起不来。
     * 而本实验的执行输入是自己在端口数据上 sealed 的执行投影
     * （`sealRollingPoolExecutionDataset`），与 003 逐字同构；经
     * `@experiments/compositeRunnerBridge` 调用既有唯一撮合引擎**不需要**该声明。
     */
    expect(descriptor.executionSurface).toBeUndefined();
    expect(descriptor.compositeExecution).toBeUndefined();
    expect(GROUPS.map((group) => group.id)).toEqual(["A_STRICT_20", "B_RECOVERY_20"]);
    expect(GROUPS.every((group) => group.entryFillMaxRd === 20)).toBe(true);
    expect(GROUPS.map((group) => group.breachPolicy))
      .toEqual(["PERMANENT_DISABLE", "RECOVERY_AFTER_BREACH"]);
    const parameter = descriptor.parameters.find((item) => item.code === "randomAccountCount");
    expect(parameter?.defaultValue).toBe(RANDOM_ACCOUNT_COUNT_DEFAULT);
    expect(parameter?.bounds?.max).toBe(RANDOM_ACCOUNT_COUNT_MAX);
    const abortText = (descriptor.preRegisteredCriteria?.abortConditions ?? []).join("\n");
    expect(abortText).toContain("ST_COVERAGE_BLOCKED");
    expect(abortText).toContain("不产出收益矩阵");
    const criteriaText = (descriptor.preRegisteredCriteria?.criteria ?? []).join("\n");
    expect(criteriaText).toContain("共同且数据资格可核实");
    expect(criteriaText).toContain("首次进入观察池");
    expect(criteriaText).toContain("不进入");
  });

  it("`resolveRunMode`：SMOKE = 6 / STUDY = 42 / CUSTOM（含 200），种子基址固定", () => {
    const smoke = resolveRunMode(2);
    expect(smoke.mode).toBe("SMOKE");
    expect(smoke.totalAccountCount).toBe(6);
    expect(smoke.accountsPerGroup).toBe(3);
    const study = resolveRunMode(20);
    expect(study.mode).toBe("STUDY");
    expect(study.totalAccountCount).toBe(42);
    expect(study.accountsPerGroup).toBe(21);
    expect(study.groupCount).toBe(2);
    const custom = resolveRunMode(200);
    expect(custom.mode).toBe("CUSTOM");
    expect(custom.totalAccountCount).toBe(402);
    expect(custom.note).toContain("不覆盖");
    expect(randomSeedIndexesOf(3)).toEqual([
      RANDOM_SEED_INDEX_BASE,
      RANDOM_SEED_INDEX_BASE + 1,
      RANDOM_SEED_INDEX_BASE + 2,
    ]);
    expect(() => resolveRunMode(0)).toThrow();
    expect(() => resolveRunMode(201)).toThrow();
  });

  it("🔴 `stCoverageReportOf`：缺口 ⇒ 抛 `ST_COVERAGE_BLOCKED`；全可核验 ⇒ 返回 VERIFIED", () => {
    const blockedSummary = summarizeStCoverage([
      checkpointOf({ group: "A_STRICT_20", confirmRd: 9, fillRd: 10, provider: null }),
    ]);
    expect(blockedSummary.blocked).toBe(true);
    let thrown: unknown = null;
    try {
      stCoverageReportOf(blockedSummary, null);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StCoverageBlockedError);
    expect((thrown as StCoverageBlockedError).code).toBe("ST_COVERAGE_BLOCKED");
    expect((thrown as StCoverageBlockedError).message).toContain("收益矩阵暂停");

    const provider = exhaustiveProvider({ stIntervals: [], coverage: NORMAL_COVERAGE });
    const verifiedSummary = summarizeStCoverage([
      checkpointOf({ group: "A_STRICT_20", confirmRd: 9, fillRd: 10, provider }),
    ]);
    const report = stCoverageReportOf(verifiedSummary, provider.providerId);
    expect(report.status).toBe("ST_COVERAGE_VERIFIED");
    expect(report.blocked).toBe(false);
    expect(report.providerId).toBe(provider.providerId);
    expect(report.contractVersion).toBe(ST_GATE_CONTRACT_VERSION);
  });

  it("账户层成交期限硬门禁与排序破平键是确定性的", () => {
    expect(fillRdWithinCap(19, 20)).toBe(true);
    expect(fillRdWithinCap(20, 20)).toBe(false);
    expect(fillRdWithinCap(5, 20)).toBe(false);
    expect(fillRdWithinCap(6, 20)).toBe(true);
    const rows = [
      { preReturn10: 0.1, symbol: "000002.SZ", anchorEventId: "000002.SZ@b" },
      { preReturn10: 0.1, symbol: "000001.SZ", anchorEventId: "000001.SZ@z" },
      { preReturn10: 0.2, symbol: "000003.SZ", anchorEventId: "000003.SZ@a" },
      { preReturn10: 0.1, symbol: "000001.SZ", anchorEventId: "000001.SZ@a" },
    ];
    expect(sortCandidates(rows).map((row) => row.anchorEventId)).toEqual([
      "000003.SZ@a",
      "000001.SZ@a",
      "000001.SZ@z",
      "000002.SZ@b",
    ]);
    // 确定性：同一输入两次排序结果逐字段相同（无 `Math.random` 参与破平）。
    expect(sortCandidates(rows)).toEqual(sortCandidates(rows));
  });
});

// ---------------------------------------------------------------------------
// 12) FIX-005 / F2 —— 区间有效性用**真正的检查时刻**（不是午夜）
// ---------------------------------------------------------------------------

describe("12) F2 区间边界：生效/失效按真正检查时刻判定（含日期形式归一化）", () => {
  const TRADE_DATE = tradeDateOf(13);

  function decisionOf(args: {
    readonly from: string;
    readonly to: string | null;
    readonly timepoint: "CONFIRM_CLOSE_ELIGIBILITY" | "PRE_FILL";
    readonly availableAsOf?: string;
  }) {
    const provider = exhaustiveProvider({
      stIntervals: [],
      coverage: NORMAL_COVERAGE,
      normalEffectiveTo: args.to,
    });
    // `exhaustiveProvider` 的 NORMAL 区间 from/to 固定取 coverage；这里用**直接 provider**
    // 才能把 effectiveFrom/To 精确摆到日内边界上。
    const exact: SecurityStatusProvider = {
      providerId: "TEST_F2_BOUNDARY",
      contractVersion: ST_GATE_CONTRACT_VERSION,
      statusAt: (query): SecurityStatusFact => ({
        symbol: query.symbol,
        tradeDate: query.tradeDate,
        status: "NORMAL",
        effectiveFrom: args.from,
        effectiveTo: args.to,
        availableAsOf: args.availableAsOf ?? tradeDateOf(12),
        source: "TEST_F2_BOUNDARY",
        confidence: "VERIFIED",
        evidenceFingerprint: `f2:${args.from}..${args.to ?? "null"}`,
      }),
    };
    expect(provider.providerId).toBe("TEST_EXHAUSTIVE_STATUS");
    return evaluateStGate({
      provider: exact,
      query: {
        symbol: SYMBOL,
        tradeDate: TRADE_DATE,
        timepoint: args.timepoint,
        effectiveAt: `${TRADE_DATE}T${args.timepoint === "PRE_FILL" ? "09:15:00" : "15:00:00"}`,
      },
    });
  }

  const cases: readonly {
    readonly label: string;
    readonly from: string;
    readonly to: string | null;
    readonly timepoint: "CONFIRM_CLOSE_ELIGIBILITY" | "PRE_FILL";
    readonly outcome: "NORMAL" | "UNKNOWN";
    readonly reason: string;
  }[] = [
    {
      label: "09:00 失效的区间在 09:15 已失效 ⇒ 不得放行",
      from: `${tradeDateOf(13)}T00:00:00`, to: `${tradeDateOf(13)}T09:00:00`,
      timepoint: "PRE_FILL", outcome: "UNKNOWN", reason: "NOT_EFFECTIVE_ON_TRADE_DATE",
    },
    {
      label: "08:00 生效的区间在 09:15 已生效 ⇒ 放行",
      from: `${tradeDateOf(13)}T08:00:00`, to: `${tradeDateOf(13)}T23:59:59`,
      timepoint: "PRE_FILL", outcome: "NORMAL", reason: "VERIFIED_NORMAL",
    },
    {
      label: "精确端点：失效含（effectiveTo == 检查时刻）",
      from: `${tradeDateOf(13)}T08:00:00`, to: `${tradeDateOf(13)}T09:15:00`,
      timepoint: "PRE_FILL", outcome: "NORMAL", reason: "VERIFIED_NORMAL",
    },
    {
      label: "精确端点：生效含（effectiveFrom == 检查时刻）",
      from: `${tradeDateOf(13)}T09:15:00`, to: `${tradeDateOf(13)}T23:59:59`,
      timepoint: "PRE_FILL", outcome: "NORMAL", reason: "VERIFIED_NORMAL",
    },
    {
      label: "精确端点：09:15:01 才生效 ⇒ 尚未生效",
      from: `${tradeDateOf(13)}T09:15:01`, to: `${tradeDateOf(13)}T23:59:59`,
      timepoint: "PRE_FILL", outcome: "UNKNOWN", reason: "NOT_EFFECTIVE_ON_TRADE_DATE",
    },
    {
      label: "日期终点：日期形式 effectiveTo 覆盖**整日**（15:00 收盘仍在区间内）",
      from: NORMAL_COVERAGE.from, to: tradeDateOf(13),
      timepoint: "CONFIRM_CLOSE_ELIGIBILITY", outcome: "NORMAL", reason: "VERIFIED_NORMAL",
    },
    {
      label: "无效日期不得靠字典序放行（2024-13-45）",
      from: "2024-01-01", to: "2024-13-45",
      timepoint: "PRE_FILL", outcome: "UNKNOWN", reason: "INVALID_STATUS_TIME_FORMAT",
    },
    {
      label: "不支持的时间写法不得放行（2024-2-14T08:00:00）",
      from: "2024-2-14T08:00:00", to: null,
      timepoint: "PRE_FILL", outcome: "UNKNOWN", reason: "INVALID_STATUS_TIME_FORMAT",
    },
  ];

  for (const testCase of cases) {
    it(testCase.label, () => {
      const decision = decisionOf({
        from: testCase.from,
        to: testCase.to,
        timepoint: testCase.timepoint,
      });
      expect(decision.outcome).toBe(testCase.outcome);
      expect(decision.reason).toBe(testCase.reason);
    });
  }

  it("availableAsOf 过晚（当日 10:00 才可知）⇒ 09:15 检查记 UNKNOWN", () => {
    const decision = decisionOf({
      from: "2024-01-01",
      to: ST_FAR_END,
      timepoint: "PRE_FILL",
      availableAsOf: `${tradeDateOf(13)}T10:00:00`,
    });
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.reason).toBe("NOT_AVAILABLE_AS_OF");
  });

  it("UNKNOWN 失败关闭：无界 NORMAL 区间不因 F2 修正而放行", () => {
    const decision = decisionOf({
      from: "2024-01-01",
      to: null,
      timepoint: "PRE_FILL",
    });
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.reason).toBe("NORMAL_INTERVAL_UNBOUNDED");
  });

  it("provider 契约版本显式升版：1.0.0 的 provider 记 PROVIDER_CONTRACT_MISMATCH", () => {
    expect(ST_GATE_CONTRACT_VERSION).toBe("1.1.0");
    const stale: SecurityStatusProvider = {
      providerId: "TEST_STALE_CONTRACT",
      contractVersion: "1.0.0",
      statusAt: () => null,
    };
    const decision = evaluateStGate({
      provider: stale,
      query: {
        symbol: SYMBOL,
        tradeDate: TRADE_DATE,
        timepoint: "PRE_FILL",
        effectiveAt: `${TRADE_DATE}T09:15:00`,
      },
    });
    expect(decision.outcome).toBe("UNKNOWN");
    expect(decision.reason).toBe("PROVIDER_CONTRACT_MISMATCH");
  });
});
