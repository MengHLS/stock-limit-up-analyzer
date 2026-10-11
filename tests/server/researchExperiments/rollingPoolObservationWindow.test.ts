/**
 * `FIRSTBOARD-ROLLING-POOL-OBSERVATION-WINDOW-003` · 观察窗口 / 再入场 / 成本 / 配对统计边界测试。
 *
 * ⚠️ 纯合成 fixture：**不读真实 Dataset、不连 DB、不跑完整 Run**（正式 Run 由 Lead 执行）。
 *
 * 覆盖目标 §7-S4 里可在无数据库条件下锁定的边界：
 *   1. N=2/3/5 的最早确认日与最早成交日；`L` 的 T+19/T+20 边界；
 *   2. 中间无效（停牌 / 零量）日**打断** N 连续要求；N 日合格但未突破 ⇒ 不触发；
 *      突破参照恒为前**两日**高点（不随 N 变化）；
 *   3. 🔴 修正 1：**保留全部确认日**（3 个确认日的 fixture ⇒ 3 个候选，且第 2/3 个被标为「非首个」）；
 *   4. 🔴 修正 2/3：事件作用域身份 + `reentryPolicy` —— E 阻断同锚点第二次入场、D 允许；
 *      同股**不同锚点**不被 E 误伤；`maxConcurrentOpenPerCode = 1` 约束同一真实股票；
 *   5. 🔴 修正 4：`amount` 进入执行行，且在真实 `runTradeSimulation` 上产生流动性分层滑点差异；
 *   6. 🔴 修正 6：`openAtEnd` 三分类（含「卖不出去」反查证据）；
 *   7. 🔴 修正 8：配对日期块 bootstrap 的共享日历配对、零分母计数、均值型配对差；
 *   8. 确定性：同一输入两次调用逐字段相同。
 */

import { describe, expect, it } from "vitest";
import type { CostModel } from "../../../../server/engine/domain";
import type { ResearchDataset } from "../../../../server/researchDataset/types";
import {
  computeCandidateEvaluationRunFingerprint,
  evaluateCandidateRun,
  runTradeSimulation,
  sealRollingPoolExecutionDataset,
  type CandidateDayRecord,
  type CandidateEvaluationRun,
  type PositionIntent,
  type RollingPoolExecutionRowInput,
  type SelectedCandidate,
  type SimulationConfig,
} from "../../../research-experiments/compositeRunnerBridge";
import {
  evaluateEarlyEntry,
  type EarlyEntryEvaluation,
} from "../../../research-experiments/shared/rollingPoolEarlyEntry";
import { DEFAULT_BOOTSTRAP_QUANTILES } from "../../../research-experiments/shared/dateClusterBootstrap";
import type { PoolBar, PoolEvent } from "../../../research-experiments/shared/rollingPoolRightTail";
import {
  ACCOUNTS_PER_GROUP,
  GATE_YEARS,
  GROUPS,
  SIGNAL_REENTRY_POLICY,
  SINGLE_ENTRY_POLICY,
  TOTAL_ACCOUNT_COUNT,
  assembleObservationWindowResult,
  observationWindowCustomPayloadSchema,
  type AccountMetrics,
  type BootstrapInterval,
  type CoverageAccounting,
  type GroupComputeOutput,
  type ObservationWindowComputeOutput,
  type PairedDifference,
  type TailRateBlock,
} from "../../../research-experiments/first-board-pullback/rolling-pool-observation-window/result";
import {
  anchorEventIdOf,
  candidateOnDecisionDay,
  classifyDecisionLayer,
  clusterObservationsOf,
  exitBucketOf,
  exitKillEvidenceIn,
  groupFillRdWithinCap,
  judgeGroupVerdict,
  judgeStudyVerdict,
  openAtEndClassOf,
  pairedMeanDifference,
  pairedRatioDifference,
  rankResolutionOf,
  sortCandidates,
  symbolOfSecurityId,
} from "../../../research-experiments/first-board-pullback/rolling-pool-observation-window/experiment";

// ---------------------------------------------------------------------------
// 事件 fixture：可控的「先回撤 → 观察日合格 → 收盘突破前两日高点」路径
// ---------------------------------------------------------------------------

/** 事件日（rd0）：`O_0 = 10`、`V_0 = 1000` ⇒ 支撑 9.8、缩量阈值 500。 */
const EVENT_DAY_OPEN = 10;
const EVENT_DAY_VOLUME = 1000;

interface EventFixtureSpec {
  readonly eventId?: string;
  /** 这些相对日出现「收盘突破」（其余日收盘压在 9.95、最高压在 10.0）。 */
  readonly breakoutRds: readonly number[];
  /** 这些相对日**缩量/收盘都不合格**（总分 = 2 < 3）。 */
  readonly weakRds?: readonly number[];
  /** 该相对日 bar 标记为停牌（`score = null` ⇒ 不可评估）。 */
  readonly suspendedRd?: number | null;
  /** 该相对日 bar 标记为**零量**（`score = null` ⇒ 不可评估）。 */
  readonly zeroVolumeRd?: number | null;
  /** rd1 的最高价抬到 11.0（用于验证「突破参照是前两日，而不是前 N 日」）。 */
  readonly wideSpikeAtRd1?: boolean;
  readonly maxRd?: number;
}

function poolBar(args: {
  readonly relativeDay: number;
  readonly tradeDate: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly suspended?: boolean;
}): PoolBar {
  return {
    relativeDay: args.relativeDay,
    tradeDate: args.tradeDate,
    open: args.open,
    high: args.high,
    low: args.low,
    close: args.close,
    preClose: args.open,
    limitUpPrice: args.high * 1.1,
    limitDownPrice: args.low * 0.9,
    volume: args.volume,
    amount: null,
    barPresent: args.suspended !== true,
    suspended: args.suspended === true,
    canBuyAtOpen: true,
    canSellAtClose: true,
  };
}

const EVENT_DATE = "2024-01-02";

function tradeDateOf(relativeDay: number): string {
  // 只是把相对日映射成**唯一且升序**的日期串；不规则日历对规则库无关紧要。
  const day = 2 + relativeDay;
  return `2024-01-${String(day).padStart(2, "0")}`;
}

/**
 * 事件 fixture。
 *
 * 基线路径（除 `breakoutRds` 外）：
 *   - rd1 收盘 9.90 **低于**事件日收盘 10（⇒ 确实回撤过）；
 *   - 低点 `9.85 + 0.02·(rd−1)`、最高 `10.00 + 0.02·(rd−1)`、收盘 `9.90 + 0.02·(rd−1)`；
 *   - 量恒为 400（≤ 500 ⇒ `shrink` 恒为 1，且 `V_d ≥ V_(d−1)` 取等号）；
 *   - 收盘**始终低于**前一日最高 ⇒ 基线日**永不突破**。
 *
 * ⇒ 基线日总分 = 守线 1 + 缩量 1 + 低点稳定 1 + 收盘改善 1 = **4**（恒合格）。
 * ⇒ 突破日：收盘 = 「历史最高 + 0.1」（必然 > 前两日高点），最高 = 收盘 + 0.1。
 */
function buildEvent(spec: EventFixtureSpec): PoolEvent {
  const maxRd = spec.maxRd ?? 24;
  const baseLow = (relativeDay: number): number => 9.85 + 0.02 * (relativeDay - 1);
  const baseHigh = (relativeDay: number): number => 10.0 + 0.02 * (relativeDay - 1);
  const baseClose = (relativeDay: number): number => 9.9 + 0.02 * (relativeDay - 1);

  const prefix = new Map<number, PoolBar>([
    [-10, poolBar({
      relativeDay: -10, tradeDate: tradeDateOf(-10), open: 9,
      high: 9.1, low: 8.9, close: 9, volume: 900,
    })],
    [-1, poolBar({
      relativeDay: -1, tradeDate: tradeDateOf(-1), open: 9.5,
      high: 9.6, low: 9.4, close: 9.5, volume: 950,
    })],
    [0, poolBar({
      relativeDay: 0, tradeDate: EVENT_DATE, open: EVENT_DAY_OPEN,
      high: 10.2, low: 9.8, close: 10, volume: EVENT_DAY_VOLUME,
    })],
  ]);

  const post = new Map<number, PoolBar>();
  let highestHighSoFar = 10.2;
  for (let relativeDay = 1; relativeDay <= maxRd; relativeDay += 1) {
    const isBreakout = spec.breakoutRds.includes(relativeDay);
    const isWeak = (spec.weakRds ?? []).includes(relativeDay);
    const suspended = spec.suspendedRd === relativeDay;
    const zeroVolume = spec.zeroVolumeRd === relativeDay;
    const volume = zeroVolume ? 0 : 400;

    if (isWeak) {
      // 总分 = 1(守线) + 1(缩量) + 0(继续创新低) + 0(收盘不改善) = 2 < 3
      const low = baseLow(relativeDay) - 0.05;
      const high = baseHigh(relativeDay);
      post.set(relativeDay, poolBar({
        relativeDay, tradeDate: tradeDateOf(relativeDay), open: baseHigh(relativeDay),
        high, low, close: Math.min(baseClose(relativeDay - 1), high) - 0.02, volume,
      }));
      highestHighSoFar = Math.max(highestHighSoFar, high);
      continue;
    }
    if (isBreakout) {
      const close = highestHighSoFar + 0.1;
      const high = close + 0.1;
      highestHighSoFar = Math.max(highestHighSoFar, high);
      post.set(relativeDay, poolBar({
        relativeDay, tradeDate: tradeDateOf(relativeDay), open: close - 0.05,
        high, low: baseLow(relativeDay), close, volume, suspended,
      }));
      continue;
    }
    const high = relativeDay === 1 && spec.wideSpikeAtRd1 === true ? 11.0 : baseHigh(relativeDay);
    post.set(relativeDay, poolBar({
      relativeDay,
      tradeDate: tradeDateOf(relativeDay),
      open: baseHigh(relativeDay),
      high,
      low: baseLow(relativeDay),
      close: baseClose(relativeDay),
      volume,
      suspended,
    }));
    highestHighSoFar = Math.max(highestHighSoFar, high);
  }

  return {
    eventId: spec.eventId ?? "000001.SZ@2024-01-02",
    symbol: "000001.SZ",
    eventDate: EVENT_DATE,
    year: 2024,
    market: "SZ",
    boardType: "main",
    isFirstLimit: true,
    prefix,
    post,
  };
}

function evaluate(spec: EventFixtureSpec, observationDays: number, entryFillMaxRd: number): EarlyEntryEvaluation {
  return evaluateEarlyEntry(buildEvent(spec), { observationDays, entryFillMaxRd });
}

const RISING: EventFixtureSpec = { breakoutRds: [] };

/** 从 rd3 起每天都是突破日 ⇒ 任意 N 的最早确认日 = N+1（只为「最早确认」而设计）。 */
const RISING_FROM_3: EventFixtureSpec = {
  breakoutRds: Array.from({ length: 20 }, (_unused, index) => index + 3),
};

// ---------------------------------------------------------------------------
// 1) N/L 边界：最早确认 / 最早成交 / T+19-T+20 边界
// ---------------------------------------------------------------------------

describe("1) N/L 边界：最早确认日、最早成交日与 cap 判据", () => {
  it("N=2/3/5 的最早确认日分别是 3/4/6，最早成交日分别是 4/5/7", () => {
    const cases: readonly (readonly [number, number])[] = [[2, 3], [3, 4], [5, 6]];
    for (const [observationDays, expectedConfirm] of cases) {
      const evaluation = evaluate(RISING_FROM_3, observationDays, 20);
      const triggers = evaluation.triggers;
      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0]!.confirmRd).toBe(expectedConfirm);
      expect(triggers[0]!.fillRd).toBe(expectedConfirm + 1);
      // 🔴 「最早可能成交」是历史成熟的**结果**，不是固定买入日。
      expect(triggers[0]!.confirmRd).toBe(observationDays + 1);
    }
  });

  it("T+19 确认 ⇒ T+20 成交**允许**；T+20 确认 ⇒ T+21 **禁止**", () => {
    // 只在 rd19 一次突破 ⇒ N=2/L=20 允许（成交 rd20）；L=19 时越界 ⇒ 不产出。
    const onlyAt19: EventFixtureSpec = { breakoutRds: [19] };
    const allowed = evaluate(onlyAt19, 2, 20);
    expect(allowed.triggers.map((trigger) => trigger.confirmRd)).toContain(19);
    expect(allowed.triggers.find((trigger) => trigger.confirmRd === 19)!.fillRd).toBe(20);

    // 确认日 rd20 ⇒ 成交 rd21 > L=20 ⇒ 规则库**不可能**产出该确认日。
    const onlyAt20: EventFixtureSpec = { breakoutRds: [20] };
    const forbidden = evaluate(onlyAt20, 2, 20);
    expect(forbidden.triggers).toEqual([]);
    expect(forbidden.finalState).toBe("ENTRY_EXPIRED");

    expect(groupFillRdWithinCap(19, 2, 20)).toBe(true);
    expect(groupFillRdWithinCap(20, 2, 20)).toBe(false);
    expect(groupFillRdWithinCap(10, 2, 10)).toBe(false);
    expect(groupFillRdWithinCap(3, 2, 10)).toBe(true);
    expect(groupFillRdWithinCap(2, 2, 10)).toBe(false);
    // N=5 时 rd5 仍不足（需要 5 个完整观察日）⇒ 确认下界 = 6
    expect(groupFillRdWithinCap(5, 5, 20)).toBe(false);
    expect(groupFillRdWithinCap(6, 5, 20)).toBe(true);
  });

  it("五组矩阵与再入场政策逐字冻结（A..E）", () => {
    expect(GROUPS.map((group) => group.id)).toEqual(["A", "B", "C", "D", "E"]);
    expect(GROUPS.map((group) => [group.observationDays, group.entryFillMaxRd])).toEqual([
      [2, 10],
      [2, 20],
      [3, 20],
      [5, 20],
      [5, 20],
    ]);
    expect(GROUPS.map((group) => [group.confirmMinRd, group.confirmMaxRd])).toEqual([
      [3, 9],
      [3, 19],
      [4, 19],
      [6, 19],
      [6, 19],
    ]);
    expect(GROUPS.map((group) => group.reentryKind)).toEqual([
      "SIGNAL_REENTRY",
      "SIGNAL_REENTRY",
      "SIGNAL_REENTRY",
      "SIGNAL_REENTRY",
      "SINGLE_ENTRY",
    ]);
    expect(SIGNAL_REENTRY_POLICY).toEqual({
      securityCooldownTradingDays: null,
      maxEntriesPerMember: null,
      maxConcurrentOpenPerCode: 1,
    });
    expect(SINGLE_ENTRY_POLICY).toEqual({
      securityCooldownTradingDays: null,
      maxEntriesPerMember: 1,
      maxConcurrentOpenPerCode: 1,
    });
    // E 与 D 同买点池（同 N/L、同确认区间），只有政策不同
    const d = GROUPS.find((group) => group.id === "D")!;
    const e = GROUPS.find((group) => group.id === "E")!;
    expect([e.observationDays, e.entryFillMaxRd, e.confirmMinRd, e.confirmMaxRd]).toEqual([
      d.observationDays,
      d.entryFillMaxRd,
      d.confirmMinRd,
      d.confirmMaxRd,
    ]);
    expect(ACCOUNTS_PER_GROUP).toBe(201);
    expect(TOTAL_ACCOUNT_COUNT).toBe(1005);
    expect([...GATE_YEARS]).toEqual([2024, 2025]);
  });
});

// ---------------------------------------------------------------------------
// 2) 观察连续性与突破参照
// ---------------------------------------------------------------------------

describe("2) 观察连续性、N 日得分与「前两日高点」参照", () => {
  it("N 日都合格但没有突破 ⇒ **不触发**", () => {
    for (const observationDays of [2, 3, 5]) {
      const evaluation = evaluate(RISING, observationDays, 20);
      expect(evaluation.triggers).toEqual([]);
      expect(evaluation.finalState).toBe("ENTRY_EXPIRED");
      // 归因应停在突破层，而不是「没观察」「没回撤」或「支撑破了」。
      const layer = classifyDecisionLayer({
        evaluation,
        event: buildEvent(RISING),
        eventAge: observationDays + 1,
        observationDays,
        confirmMinRd: observationDays + 1,
        confirmMaxRd: 19,
      });
      expect(layer.layer).toBe("breakout");
      expect(layer.code).toBe("NO_CLOSE_BREAKOUT");
    }
  });

  it("停牌日 / 零量日**不能**被跳过拼成连续 N 天（且支撑路径变得不可评估）", () => {
    // 停牌行在数据集里同时是 `barPresent = false` ⇒ 规则库先报 `BAR_MISSING`（不伪造 BAR_SUSPENDED）。
    for (const spec of [
      { fixture: { breakoutRds: [3, 5], suspendedRd: 2 } as EventFixtureSpec, expectedReason: "BAR_MISSING" },
      { fixture: { breakoutRds: [3, 5], zeroVolumeRd: 2 } as EventFixtureSpec, expectedReason: "ZERO_VOLUME" },
    ]) {
      const evaluation = evaluate(spec.fixture, 2, 20);
      expect(evaluation.triggers).toEqual([]);
      expect(evaluation.finalState).toBe("UNASSESSABLE");
      expect(evaluation.supportPathIncomplete).toBe(true);
      const invalidDay = evaluation.observationDays.find((day) => day.relativeDay === 2)!;
      expect(invalidDay.score).toBeNull();
      expect(invalidDay.missingReason).toBe(spec.expectedReason);
      // 正对照：同一突破日集合、**没有**无效日时 N=2 会产出 rd3/rd5 两个确认
      // ⇒ 上面的 `triggers = []` 确实由「窗口内无效日」造成（而不是该 fixture 本来就不触发）。
      const control = evaluate({ breakoutRds: [3, 5] }, 2, 20);
      expect(control.triggers.map((trigger) => trigger.confirmRd)).toEqual([3, 5]);
      expect(control.finalState).not.toBe("UNASSESSABLE");
      expect(control.observationDays.every((day) => day.score !== null)).toBe(true);
    }
    // 无效日在确认窗**之后**时：之前已成立的确认日仍然有效，但此后不再产出（路径不可评估）
    const later = evaluate({ breakoutRds: [3, 7], suspendedRd: 5 }, 2, 20);
    expect(later.triggers.map((trigger) => trigger.confirmRd)).toEqual([3]);
    expect(later.supportPathIncomplete).toBe(true);
  });

  it("观察窗里有一天总分 < 3 ⇒ 不触发，且归因落在 N 日得分层", () => {
    // 在第 4 日插入一个「继续创新低 + 收盘回落」的弱日（低点仍 ≥ 9.8，不构成支撑破位）
    const spec: EventFixtureSpec = { breakoutRds: [6], weakRds: [4] };
    const evaluation = evaluate(spec, 5, 20);
    expect(evaluation.triggers).toEqual([]);
    const layer = classifyDecisionLayer({
      evaluation,
      event: buildEvent(spec),
      eventAge: 6,
      observationDays: 5,
      confirmMinRd: 6,
      confirmMaxRd: 19,
    });
    expect(layer.layer).toBe("score");
    expect(layer.code).toBe("N_DAY_SCORE_INSUFFICIENT");
    expect(evaluation.observationDays.find((day) => day.relativeDay === 4)!.score).toBe(2);
  });

  it("突破参照恒为前**两日**高点（不是前 N 日）：rd1 的 11.0 高点不阻挡 rd6 突破", () => {
    const spec: EventFixtureSpec = { breakoutRds: [6], wideSpikeAtRd1: true };
    const evaluation = evaluate(spec, 5, 20);
    // 若参照是「前 N 日高点」，max(H1..H5) = 11.0 > C6 ⇒ 永远不会触发。
    expect(evaluation.triggers.map((trigger) => trigger.confirmRd)).toContain(6);
    const trigger = evaluation.triggers.find((item) => item.confirmRd === 6)!;
    expect(trigger.evidence.closePrev2High).toBeCloseTo(10.08, 6);
    // 参照**必须**逐字等于前两日高点 max(H4, H5)，且**不得**等于前 N 日高点 max(H1..H5) = 11.0（rd1 的 spike）。
    const event = buildEvent(spec);
    const prev2High = Math.max(event.post.get(4)!.high, event.post.get(5)!.high);
    const prevNHigh = Math.max(
      ...[1, 2, 3, 4, 5].map((relativeDay) => event.post.get(relativeDay)!.high),
    );
    expect(trigger.evidence.closePrev2High).toBeCloseTo(prev2High, 10);
    expect(prevNHigh).toBeCloseTo(11, 10);
    expect(prev2High).toBeLessThan(prevNHigh);
    expect(trigger.evidence.closePrev2High).toBeLessThan(11);
    expect(trigger.evidence.closeConfirm).toBeGreaterThan(trigger.evidence.closePrev2High);
  });

  it("支撑破位是**永久**失效：首次失效与后续重复拒绝分开归因", () => {
    // rd3 低点 9.0 < 9.8 ⇒ 首次失效；此后每天都是重复拒绝。
    const event = buildEvent({ breakoutRds: [5] });
    event.post.set(3, poolBar({
      relativeDay: 3, tradeDate: tradeDateOf(3), open: 9.9,
      high: 10.0, low: 9.0, close: 9.2, volume: 400,
    }));
    const evaluation = evaluateEarlyEntry(event, { observationDays: 2, entryFillMaxRd: 20 });
    expect(evaluation.supportBreachRd).toBe(3);
    const first = classifyDecisionLayer({
      evaluation, event, eventAge: 3, observationDays: 2, confirmMinRd: 3, confirmMaxRd: 19,
    });
    expect(first.code).toBe("SUPPORT_BREACHED_FIRST_INVALIDATION");
    expect(first.isFirstSupportInvalidationDay).toBe(true);
    const repeat = classifyDecisionLayer({
      evaluation, event, eventAge: 5, observationDays: 2, confirmMinRd: 3, confirmMaxRd: 19,
    });
    expect(repeat.code).toBe("SUPPORT_BREACHED_REPEAT");
    expect(repeat.isFirstSupportInvalidationDay).toBe(false);
    expect(evaluation.triggers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3) 修正 1：保留全部确认日
// ---------------------------------------------------------------------------

describe("3) 修正 1：保留全部确认日（不再首发优先截断）", () => {
  it("3 个确认日的 fixture ⇒ 3 个候选，且第 2/3 个被标为「非首个」", () => {
    const spec: EventFixtureSpec = { breakoutRds: [3, 5, 7] };
    const evaluation = evaluate(spec, 2, 10);
    expect(evaluation.triggers.map((trigger) => trigger.confirmRd)).toEqual([3, 5, 7]);

    const decisions = [3, 5, 7].map((eventAge) =>
      candidateOnDecisionDay({ evaluation, eventAge, observationDays: 2, entryFillMaxRd: 10 }),
    );
    expect(decisions.every((decision) => decision !== null)).toBe(true);
    expect(decisions.map((decision) => decision!.triggerOrdinal)).toEqual([1, 2, 3]);
    expect(decisions.map((decision) => decision!.isLaterTriggerDay)).toEqual([false, true, true]);

    // 非确认日**不**产出候选（只计数、不错发）
    expect(candidateOnDecisionDay({
      evaluation, eventAge: 4, observationDays: 2, entryFillMaxRd: 10,
    })).toBeNull();
    // 超出本组 cap 的确认日（rd9 之后）一律不进入 sourceRun
    expect(candidateOnDecisionDay({
      evaluation, eventAge: 9, observationDays: 2, entryFillMaxRd: 10,
    })).toBeNull();
  });

  it("N=5/L=20 下 rd3..5 的确认日存在但在本组区间之外 ⇒ 不产出候选", () => {
    const spec: EventFixtureSpec = { breakoutRds: [3, 4, 5, 6, 8] };
    const evaluation = evaluate(spec, 5, 20);
    expect(evaluation.triggers.map((trigger) => trigger.confirmRd)).toEqual([6, 8]);
    expect(candidateOnDecisionDay({
      evaluation, eventAge: 5, observationDays: 5, entryFillMaxRd: 20,
    })).toBeNull();
    expect(candidateOnDecisionDay({
      evaluation, eventAge: 6, observationDays: 5, entryFillMaxRd: 20,
    })?.isLaterTriggerDay).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4) P3 / 排序确定性
// ---------------------------------------------------------------------------

describe("4) 排序与 P3 排序分辨力", () => {
  it("破平键确定性（preReturn10 降序 → symbol → eventId），两次调用逐字段相同", () => {
    const rows = [
      { preReturn10: 0.1, symbol: "000002.SZ", anchorEventId: "b" },
      { preReturn10: 0.3, symbol: "000003.SZ", anchorEventId: "c" },
      { preReturn10: 0.3, symbol: "000001.SZ", anchorEventId: "a" },
    ];
    const first = sortCandidates(rows);
    const second = sortCandidates(rows);
    expect(first).toEqual(second);
    expect(first.map((row) => row.anchorEventId)).toEqual(["a", "c", "b"]);
  });

  it("边界并列日（池 > TopK 且第 K 与第 K+1 名同值）被如实计数", () => {
    const rows = [
      { date: "2024-03-01", preReturn10: 0.5 },
      { date: "2024-03-01", preReturn10: 0.4 },
      { date: "2024-03-01", preReturn10: 0.4 },
      { date: "2024-03-01", preReturn10: 0.4 },
      { date: "2024-03-04", preReturn10: 0.2 },
      { date: "2024-03-04", preReturn10: 0.1 },
    ];
    const first = rankResolutionOf("A", rows);
    const second = rankResolutionOf("A", rows);
    expect(first).toEqual(second);
    expect(first.candidateDayCount).toBe(2);
    expect(first.candidateRowCount).toBe(6);
    expect(first.distinctPreReturn10Count).toBe(4);
    expect(first.boundaryTieDayCount).toBe(1);
    expect(first.boundaryTieSizeMax).toBe(3);
    // 最大取值占比（单位 = **百分数 0–100**，不是分数 0–1）= 池内**同一个取值出现次数最多**的一组 / 6 行 × 100。
    // 本例 0.4 是最大并列组（出现 3 次）⇒ (3 / 6) × 100 = 50；若误读成「最大因子值 0.5 的占比」会得到 16.67。
    expect(first.maxValueSharePct).toBeCloseTo(50, 6);
  });
});

// ---------------------------------------------------------------------------
// 5) 执行面：身份 / 再入场政策 / amount 滑点
// ---------------------------------------------------------------------------

const D1 = "2024-03-01";
const D2 = "2024-03-04";
const D3 = "2024-03-05";
const D4 = "2024-03-06";
const D5 = "2024-03-07";
const D6 = "2024-03-08";
const D7 = "2024-03-11";
const D8 = "2024-03-12";
const ALL_DATES = [D1, D2, D3, D4, D5, D6, D7, D8] as const;

const COST_ZERO: CostModel = {
  commissionRate: 0,
  stampDutyRate: 0,
  transferFeeRate: 0,
  slippageBps: 0,
  lotSize: 100,
  minCommission: 0,
};
const COST_SLIPPAGE_5: CostModel = { ...COST_ZERO, slippageBps: 5 };

/** 事件作用域身份（`sec_<uuid>::event:<symbol>@<eventDate>`）。 */
const SEC_A1 = "sec_000000000000000000000000000000a1::event:000001.SZ@2024-03-01";
const SEC_A2 = "sec_000000000000000000000000000000a1::event:000001.SZ@2024-05-06";
const SEC_B = "sec_000000000000000000000000000000b2::event:000002.SZ@2024-03-01";

interface RowSpec {
  readonly date: string;
  readonly securityId: string;
  readonly open: number;
  readonly close: number;
  readonly amount?: number | null;
  readonly suspended?: boolean;
}

function executionRow(spec: RowSpec): RollingPoolExecutionRowInput {
  const symbol = symbolOfSecurityId(spec.securityId);
  return {
    tradeDate: spec.date,
    securityId: spec.securityId,
    code: symbol,
    exchange: "SZ",
    open: spec.open,
    high: Math.max(spec.open, spec.close) + 0.1,
    low: Math.min(spec.open, spec.close) - 0.1,
    close: spec.close,
    preClose: spec.open,
    volume: spec.suspended === true ? 0 : 1_000_000,
    amount: spec.amount ?? null,
    barPresent: spec.suspended !== true,
    suspended: spec.suspended === true,
  };
}

function sealDataset(rows: readonly RollingPoolExecutionRowInput[]): ResearchDataset {
  const dates = [...new Set(rows.map((row) => row.tradeDate))].sort();
  return sealRollingPoolExecutionDataset({
    name: "observation-window-test-projection",
    startDate: dates[0]!,
    endDate: dates[dates.length - 1]!,
    datasetVersionId: 780_004,
    rows,
    tradingDates: dates,
  });
}

function buildSourceRun(args: {
  readonly dataset: ResearchDataset;
  readonly days: readonly {
    readonly date: string;
    readonly intents: readonly { readonly securityId: string; readonly value: number }[];
  }[];
}): CandidateEvaluationRun {
  const dayRecords: CandidateDayRecord[] = args.days.map((day) => {
    const selected: SelectedCandidate[] = day.intents.map((intent, index) => ({
      securityId: intent.securityId,
      rank: index + 1,
      percentile: day.intents.length === 0 ? 0 : 1 - index / day.intents.length,
      value: intent.value,
    }));
    const positionIntents: PositionIntent[] = day.intents.map((intent, index) => ({
      securityId: intent.securityId,
      direction: "long",
      rank: index + 1,
      percentile: day.intents.length === 0 ? 0 : 1 - index / day.intents.length,
      weight: day.intents.length === 0 ? 0 : 1 / day.intents.length,
      signalValue: intent.value,
      confidence: null,
    }));
    return {
      date: day.date,
      universeMembers: day.intents.map((intent) => intent.securityId).sort(),
      signalCount: day.intents.length,
      dropped: [],
      selected,
      positionIntents,
    };
  });
  const body: Omit<CandidateEvaluationRun, "fingerprint"> = {
    recordKind: "CANDIDATE_EVALUATION_RUN",
    recordVersion: 1,
    datasetVersion: args.dataset.datasetVersion,
    builderVersion: "observation-window-test-1.0.0",
    rowSchemaVersion: "observation-window-test-1.0.0",
    datasetGate: args.dataset.gate,
    universeId: `test:${args.dataset.datasetVersion}`,
    strategyId: "study-observation-window-test",
    strategyVersion: "1.0.0",
    parameters: { topK: 3 },
    dateRange: {
      startDate: args.days[0]!.date,
      endDate: args.days[args.days.length - 1]!.date,
    },
    point: "close",
    signalDescription: "test fixture",
    featureVersions: [{ featureId: "preReturn10", version: "1.0.0" }],
    rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    selectionConfig: { method: { kind: "topN", n: 3 } },
    days: dayRecords,
    evaluation: evaluateCandidateRun(dayRecords),
  };
  return { ...body, fingerprint: computeCandidateEvaluationRunFingerprint(body) };
}

function simConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    initialCapital: 100_000,
    cost: COST_ZERO,
    candidateExitPolicy: "HOLD_WHILE_SELECTED",
    maxPositions: 5,
    maxDailyBuys: 2,
    dateRange: { startDate: D1, endDate: D8 },
    positionSizing: { sizingMethod: "EQUITY_FRACTION", fraction: 0.2, fixedAmount: null },
    ...overrides,
  };
}

function rowsFor(securityIds: readonly string[], overrides: Partial<RowSpec> = {}): RollingPoolExecutionRowInput[] {
  return securityIds.flatMap((securityId) =>
    ALL_DATES.map((date) => executionRow({ date, securityId, open: 10, close: 10, ...overrides })),
  );
}

describe("5) 执行面：事件作用域身份 + reentryPolicy + amount", () => {
  it("身份形如 `sec_<uuid>::event:<symbol>@<date>`，且能剥回 symbol 与锚点事件 id", () => {
    expect(anchorEventIdOf(SEC_A1)).toBe("000001.SZ@2024-03-01");
    expect(symbolOfSecurityId(SEC_A1)).toBe("000001.SZ");
    expect(anchorEventIdOf(SEC_A2)).toBe("000001.SZ@2024-05-06");
    expect(symbolOfSecurityId(SEC_A2)).toBe("000001.SZ");
  });

  it("E（maxEntriesPerMember=1）阻断同锚点第二次入场；D（null）允许", () => {
    const dataset = sealDataset(rowsFor([SEC_A1, SEC_B]));
    const sourceRun = buildSourceRun({
      dataset,
      days: [
        { date: D1, intents: [{ securityId: SEC_A1, value: 0.9 }] },
        { date: D2, intents: [{ securityId: SEC_B, value: 0.9 }] },
        { date: D3, intents: [{ securityId: SEC_B, value: 0.9 }] },
        { date: D4, intents: [{ securityId: SEC_A1, value: 0.8 }] },
        { date: D5, intents: [{ securityId: SEC_B, value: 0.9 }] },
        { date: D6, intents: [{ securityId: SEC_B, value: 0.9 }] },
        { date: D7, intents: [{ securityId: SEC_B, value: 0.9 }] },
      ],
    });
    const runD = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({ reentryPolicy: { ...SIGNAL_REENTRY_POLICY } }),
    });
    const runE = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({ reentryPolicy: { ...SINGLE_ENTRY_POLICY } }),
    });

    const aD = runD.trades.filter((trade) => trade.securityId === SEC_A1);
    const aE = runE.trades.filter((trade) => trade.securityId === SEC_A1);
    expect(aD).toHaveLength(2);
    expect(aD.map((trade) => trade.entryTime)).toEqual([D2, D5]);
    expect(aE).toHaveLength(1);
    // 被阻断的意图**必须**出现在 skipped 里（不静默丢弃），且不产生成交
    expect(
      runE.skipped.some(
        (entry) => entry.securityId === SEC_A1 && entry.code === "MEMBER_ENTRY_LIMIT_REACHED",
      ),
    ).toBe(true);
    expect(runD.skipped.some((entry) => entry.code === "MEMBER_ENTRY_LIMIT_REACHED")).toBe(false);
  });

  it("同股**不同锚点**不被 E 误伤（次数键 = 锚点事件，不是股票）", () => {
    const dataset = sealDataset(rowsFor([SEC_A1, SEC_A2, SEC_B]));
    const sourceRun = buildSourceRun({
      dataset,
      days: [
        { date: D1, intents: [{ securityId: SEC_A1, value: 0.9 }] },
        { date: D2, intents: [{ securityId: SEC_B, value: 0.9 }] },
        { date: D3, intents: [{ securityId: SEC_B, value: 0.9 }] },
        { date: D4, intents: [{ securityId: SEC_A2, value: 0.8 }] },
        { date: D5, intents: [{ securityId: SEC_B, value: 0.9 }] },
        { date: D6, intents: [{ securityId: SEC_B, value: 0.9 }] },
        { date: D7, intents: [{ securityId: SEC_B, value: 0.9 }] },
      ],
    });
    const runE = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({ reentryPolicy: { ...SINGLE_ENTRY_POLICY } }),
    });
    expect(runE.trades.filter((trade) => trade.securityId === SEC_A1)).toHaveLength(1);
    // 另一个锚点的**第一次**建仓不受「同锚点一次」限制
    expect(runE.trades.filter((trade) => trade.securityId === SEC_A2)).toHaveLength(1);
    // 两个同股锚点都各自只成交一次 ⇒ 它们的次数上限都没有被触发
    for (const securityId of [SEC_A1, SEC_A2]) {
      expect(
        runE.skipped.some(
          (entry) => entry.securityId === securityId && entry.code === "MEMBER_ENTRY_LIMIT_REACHED",
        ),
      ).toBe(false);
    }
  });

  it("maxConcurrentOpenPerCode=1 约束**同一真实股票**的不同锚点（跨事件身份仍生效）", () => {
    const dataset = sealDataset(rowsFor([SEC_A1, SEC_A2]));
    // D1 只买 A1（成交在 D2 开盘）；此后 A1 始终是 desired（一直持有），A2 作为**另一个锚点**
    // 试图在 A1 仍在仓时建仓 —— 只有 `maxConcurrentOpenPerCode` 能拦住它。
    const sourceRun = buildSourceRun({
      dataset,
      days: [
        { date: D1, intents: [{ securityId: SEC_A1, value: 0.9 }] },
        { date: D2, intents: [{ securityId: SEC_A1, value: 0.9 }, { securityId: SEC_A2, value: 0.8 }] },
        { date: D3, intents: [{ securityId: SEC_A1, value: 0.9 }, { securityId: SEC_A2, value: 0.8 }] },
        { date: D4, intents: [{ securityId: SEC_A1, value: 0.9 }, { securityId: SEC_A2, value: 0.8 }] },
        { date: D5, intents: [{ securityId: SEC_A1, value: 0.9 }, { securityId: SEC_A2, value: 0.8 }] },
      ],
    });
    const capped = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({ reentryPolicy: { ...SIGNAL_REENTRY_POLICY } }),
    });
    const uncapped = runTradeSimulation({
      dataset,
      sourceRun,
      simConfig: simConfig({
        reentryPolicy: {
          securityCooldownTradingDays: null,
          maxEntriesPerMember: null,
          maxConcurrentOpenPerCode: null,
        },
      }),
    });
    expect(capped.trades.filter((trade) => trade.securityId === SEC_A2)).toHaveLength(0);
    expect(
      capped.skipped.some(
        (entry) => entry.securityId === SEC_A2 && entry.code === "CONCURRENT_CODE_POSITION_LIMIT",
      ),
    ).toBe(true);
    // 反证：去掉并发上限后，同股不同锚点会被**同时持有**（这正是需要该上限的原因）
    expect(uncapped.trades.filter((trade) => trade.securityId === SEC_A2)).toHaveLength(1);
    expect(new Set(uncapped.trades.map((trade) => trade.securityId)).size).toBe(2);
  });

  it("amount 进入执行行，并在真实 runTradeSimulation 上产生流动性分层滑点", () => {
    const days = [{ date: D1, intents: [{ securityId: SEC_A1, value: 0.9 }] }];
    const lowLiquidity = sealDataset(rowsFor([SEC_A1], { amount: 50_000 }));
    const noAmount = sealDataset(rowsFor([SEC_A1], { amount: null }));
    const highLiquidity = sealDataset(rowsFor([SEC_A1], { amount: 3_000_000 }));

    // ① 声明并透传：封出来的数据集行确实带 amount
    expect(lowLiquidity.rows.every((row) => row.amount === 50_000)).toBe(true);
    expect(noAmount.rows.every((row) => row.amount === null)).toBe(true);

    const buyPriceOf = (dataset: ResearchDataset): number =>
      runTradeSimulation({
        dataset,
        sourceRun: buildSourceRun({ dataset, days }),
        simConfig: simConfig({ cost: COST_SLIPPAGE_5 }),
      }).trades[0]!.entryPrice;

    // ② 50,000 千元 < 100,000 ⇒ +20bps ⇒ 基础 5 + 20 = 25bps
    expect(buyPriceOf(lowLiquidity)).toBeCloseTo(10 * (1 + 25 / 10_000), 4);
    // ③ 无成交额 ⇒ 回落基础 5bps
    expect(buyPriceOf(noAmount)).toBeCloseTo(10 * (1 + 5 / 10_000), 4);
    // ④ ≥ 20 亿元 ⇒ 同样回落基础 5bps
    expect(buyPriceOf(highLiquidity)).toBeCloseTo(10 * (1 + 5 / 10_000), 4);
    expect(buyPriceOf(lowLiquidity)).toBeGreaterThan(buyPriceOf(noAmount));
  });
});

// ---------------------------------------------------------------------------
// 6) 修正 6：openAtEnd 三分类
// ---------------------------------------------------------------------------

describe("6) 修正 6：openAtEnd 三分类（实验侧启发式）", () => {
  it("分类器：已平仓 / 正常期末 MTM / 无执行 bar / 停牌无法卖出", () => {
    expect(openAtEndClassOf({ openAtEnd: false, exitPrice: 10, hasExitKillEvidence: false }).kind)
      .toBe("NOT_OPEN_AT_END");
    expect(openAtEndClassOf({ openAtEnd: true, exitPrice: 10, hasExitKillEvidence: false }).kind)
      .toBe("MTM_VALID");
    expect(openAtEndClassOf({ openAtEnd: true, exitPrice: null, hasExitKillEvidence: false }).kind)
      .toBe("NO_EXECUTION_BAR");
    expect(openAtEndClassOf({ openAtEnd: true, exitPrice: 10, hasExitKillEvidence: true }).kind)
      .toBe("SUSPENDED_CANNOT_SELL");
    // 无执行 bar 且有「卖不出去」证据 ⇒ 仍归到更具体的 SUSPENDED_CANNOT_SELL（优先级写死）
    expect(openAtEndClassOf({ openAtEnd: true, exitPrice: null, hasExitKillEvidence: true }).kind)
      .toBe("SUSPENDED_CANNOT_SELL");
  });

  it("`exitKillEvidenceIn` 反查卖出拒单理由与顺延码", () => {
    const fakeRun = (orders: unknown[], skipped: unknown[]): never =>
      ({ audit: { orders }, skipped } as unknown as never);
    expect(exitKillEvidenceIn(
      fakeRun([{ securityId: "s1", side: "sell", status: "REJECTED", rejectionReason: "SUSPENDED" }], []),
      "s1",
    )).toBe(true);
    expect(exitKillEvidenceIn(
      fakeRun([{ securityId: "s1", side: "sell", status: "REJECTED", rejectionReason: "LIMIT_DOWN" }], []),
      "s1",
    )).toBe(true);
    expect(exitKillEvidenceIn(
      fakeRun([], [{ securityId: "s1", side: "sell", code: "FROZEN_EXIT_DEFERRED" }]),
      "s1",
    )).toBe(true);
    // 与目标证券无关 / 方向不匹配 / 非拒绝 ⇒ 不构成证据
    expect(exitKillEvidenceIn(
      fakeRun([{ securityId: "s2", side: "sell", status: "REJECTED", rejectionReason: "SUSPENDED" }], []),
      "s1",
    )).toBe(false);
    expect(exitKillEvidenceIn(
      fakeRun([{ securityId: "s1", side: "buy", status: "REJECTED", rejectionReason: "SUSPENDED" }], []),
      "s1",
    )).toBe(false);
  });

  it("真实 run 的期末持仓按输入事实分类（不把正常期末 MTM 当数据缺口）", () => {
    const dataset = sealDataset(rowsFor([SEC_A1]));
    const run = runTradeSimulation({
      dataset,
      sourceRun: buildSourceRun({ dataset, days: [{ date: D1, intents: [{ securityId: SEC_A1, value: 0.9 }] }] }),
      simConfig: simConfig(),
    });
    expect(run.trades).toHaveLength(1);
    const trade = run.trades[0]!;
    expect(trade.openAtEnd).toBe(true);
    const kind = openAtEndClassOf({
      openAtEnd: trade.openAtEnd,
      exitPrice: trade.exitPrice,
      hasExitKillEvidence: exitKillEvidenceIn(run, trade.securityId),
    }).kind;
    expect(kind).toBe("MTM_VALID");
    expect(trade.exitPrice).not.toBeNull();
  });

  it("退出原因分桶是确定性的关键词归一（未命中进 EXIT_OTHER）", () => {
    expect(exitBucketOf("止损：跌破建仓价6%")).toBe("EXIT_STOP_LOSS");
    expect(exitBucketOf("Runner Bridge持有满74个交易日")).toBe("EXIT_RUNNER_BRIDGE");
    expect(exitBucketOf("期末估值")).toBe("EXIT_OPEN_AT_END");
    expect(exitBucketOf(null)).toBe("EXIT_UNLABELED");
    expect(exitBucketOf("某种新理由")).toBe("EXIT_OTHER");
  });
});

// ---------------------------------------------------------------------------
// 7) 修正 8：配对日期块 bootstrap
// ---------------------------------------------------------------------------

describe("7) 修正 8：配对日期块 bootstrap（共享日历 / 零分母 / 均值差）", () => {
  const calendar = Array.from({ length: 30 }, (_unused, index) => `2024-04-${String(index + 1).padStart(2, "0")}`);
  const arms = {
    A: calendar.map((date, index) => ({
      date,
      hits: index % 2 === 0 ? 1 : 0,
      completed: 1,
      sumReturn: index % 2 === 0 ? 10 : -5,
    })),
    B: calendar.map(() => ({ date: calendar[0]!, hits: 0, completed: 1, sumReturn: 0 })),
  };

  it("共享日历配对：日历长度 = 完整交易日序列（含无入场日），比率差与全量读数一致", () => {
    const result = pairedRatioDifference({
      calendar,
      arms: {
        A: arms.A,
        B: calendar.map((date) => ({ date, hits: 0, completed: 1, sumReturn: 0 })),
      },
      compare: ["A", "B"],
      iterations: 200,
      blockLength: 5,
      seed: 20_261_010,
      quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
    });
    expect(result).not.toBeNull();
    expect(result!.calendarLength).toBe(calendar.length);
    expect(result!.clusterCount).toBe(calendar.length);
    expect(result!.ignoredObservationCount).toBe(0);
    expect(result!.zeroDenominatorIterations).toBe(0);
    // 分子/分母在全量上的比率差：A = 15/30 = 0.5；B = 0
    expect(result!.pointEstimate).toBeCloseTo(0.5, 10);
    expect(result!.low).toBeLessThanOrEqual(result!.pointEstimate);
    expect(result!.high).toBeGreaterThanOrEqual(result!.pointEstimate);
    // 确定性：同种子两次调用逐字段相同
    const again = pairedRatioDifference({
      calendar,
      arms: {
        A: arms.A,
        B: calendar.map((date) => ({ date, hits: 0, completed: 1, sumReturn: 0 })),
      },
      compare: ["A", "B"],
      iterations: 200,
      blockLength: 5,
      seed: 20_261_010,
      quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
    });
    expect(again).toEqual(result);
  });

  it("分母为 0 的迭代被**计数**而不是静默丢弃", () => {
    // 臂 A 只有最后一天有观测：块长 1 的重采样里会出现「整轮都没抽到 A 的观测日」
    const sparse = {
      A: [{ date: calendar[calendar.length - 1]!, hits: 1, completed: 1, sumReturn: 20 }],
      B: calendar.map((date) => ({ date, hits: 0, completed: 1, sumReturn: 0 })),
    };
    const result = pairedRatioDifference({
      calendar,
      arms: sparse,
      compare: ["A", "B"],
      iterations: 1_000,
      blockLength: 1,
      seed: 20_261_011,
      quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
    });
    expect(result).not.toBeNull();
    expect(result!.zeroDenominatorIterations).toBeGreaterThan(0);
    expect(result!.pointEstimate).toBeCloseTo(1, 10);
  });

  it("列表里有**日历之外**的观测 ⇒ 被忽略并计数（不静默）", () => {
    const result = pairedRatioDifference({
      calendar,
      arms: {
        A: [...arms.A, { date: "2099-01-01", hits: 1, completed: 1, sumReturn: 1 }],
        B: calendar.map((date) => ({ date, hits: 0, completed: 1, sumReturn: 0 })),
      },
      compare: ["A", "B"],
      iterations: 200,
      blockLength: 5,
      seed: 20_261_010,
      quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
    });
    expect(result!.ignoredObservationCount).toBe(1);
  });

  it("均值型配对差走同一个唯一实现（口径 = 收益和/分母之差）", () => {
    const result = pairedMeanDifference({
      calendar,
      arms: {
        A: arms.A,
        B: calendar.map((date) => ({ date, hits: 0, completed: 1, sumReturn: 0 })),
      },
      compare: ["A", "B"],
      iterations: 200,
      blockLength: 5,
      seed: 20_261_010,
      quantiles: DEFAULT_BOOTSTRAP_QUANTILES,
    });
    expect(result).not.toBeNull();
    // A：15 天 +10、15 天 −5 ⇒ 均值 (150 − 75) / 30 = 2.5；B = 0
    expect(result!.pointEstimate).toBeCloseTo(2.5, 10);
  });

  it("clusterObservationsOf 输出稳定升序（确定性）", () => {
    const cells = new Map<string, { hits: number; completed: number; sumReturn: number }>([
      ["2024-04-03", { hits: 1, completed: 2, sumReturn: 3 }],
      ["2024-04-01", { hits: 0, completed: 1, sumReturn: -1 }],
    ]);
    const first = clusterObservationsOf(cells);
    const second = clusterObservationsOf(cells);
    expect(first).toEqual(second);
    expect(first.map((row) => row.date)).toEqual(["2024-04-01", "2024-04-03"]);
  });
});

// ---------------------------------------------------------------------------
// 8) 判定函数（修正 5：年度靶 = 实际成交尾率差）
// ---------------------------------------------------------------------------

function tailBlock(overrides: Partial<TailRateBlock>): TailRateBlock {
  return {
    label: "R",
    tradeCount: 60,
    completedTradeCount: 60,
    openAtEndCount: 0,
    hit20Count: 20,
    tail20Rate: 20 / 60,
    hit50Count: 5,
    tail50Rate: 5 / 60,
    hit100Count: 1,
    tail100Rate: 1 / 60,
    loss20Count: 10,
    loss20Rate: 10 / 60,
    meanReturnPct: 3,
    medianReturnPct: 1,
    winRatePct: 45,
    maxDrawdownPct: 20,
    finalCashSharePct: 30,
    averageHoldingPeriod: 8,
    fillCount: 60,
    skippedIntentCount: 0,
    rejectedOrderCount: 0,
    uniqueTail20AnchorCount: 55,
    ...overrides,
  };
}

function interval(overrides: Partial<BootstrapInterval> = {}): BootstrapInterval {
  return {
    low: 0.01,
    high: 0.2,
    iterations: 1_000,
    blockLength: 20,
    clusterCount: 120,
    seed: 20_261_010,
    quantiles: { low: 0.025, high: 0.975 },
    zeroDenominatorIterations: 0,
    calendarLength: 430,
    ignoredObservationCount: 0,
    ...overrides,
  };
}

function pairedDifference(overrides: Partial<PairedDifference> = {}): PairedDifference {
  return {
    metric: "tail20Rate",
    pointEstimate: 0.05,
    blockPrimary: interval(),
    blockSensitivity: interval({ blockLength: 40, seed: 20_261_011 }),
    anchorChainPrimary: interval(),
    meanPrimary: interval(),
    ...overrides,
  };
}

function yearlyRow(overrides: Partial<{
  year: number;
  rCompletedCount: number;
  rHit20Count: number;
  randomCompletedCount: number;
  randomHit20Count: number;
  inSignalGate: boolean;
}>) {
  const year = overrides.year ?? 2024;
  const rCompletedCount = overrides.rCompletedCount ?? 100;
  const rHit20Count = overrides.rHit20Count ?? 40;
  const randomCompletedCount = overrides.randomCompletedCount ?? 1_000;
  const randomHit20Count = overrides.randomHit20Count ?? 300;
  return {
    year,
    rCompletedCount,
    rHit20Count,
    rTail20Rate: rCompletedCount === 0 ? null : rHit20Count / rCompletedCount,
    randomCompletedCount,
    randomHit20Count,
    randomTail20Rate: randomCompletedCount === 0 ? null : randomHit20Count / randomCompletedCount,
    tail20RateDifference:
      rCompletedCount === 0 || randomCompletedCount === 0
        ? null
        : rHit20Count / rCompletedCount - randomHit20Count / randomCompletedCount,
    hasMainWindowEntry: overrides.inSignalGate ?? true,
    inSignalGate: overrides.inSignalGate ?? true,
    gateNote: "test",
  };
}

describe("8) 判定：年度闸门用「实际成交尾率差」而不是账户权益收益", () => {
  it("样本门槛不足（唯一锚点 < 50）⇒ INSUFFICIENT_EVIDENCE", () => {
    const verdict = judgeGroupVerdict({
      group: "A",
      candidateDayCount: 100,
      rBlock: tailBlock({ uniqueTail20AnchorCount: 12 }),
      randomBlock: tailBlock({ label: "RANDOM" }),
      difference: pairedDifference(),
      yearly: [yearlyRow({ year: 2024 }), yearlyRow({ year: 2025 })],
      rTotalReturnPct: 100,
      randomMedianTotalReturnPct: 10,
      rMaxDrawdownPct: 10,
      randomMedianMaxDrawdownPct: 30,
    });
    expect(verdict.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.reasons.join(" ")).toContain("唯一锚点");
  });

  it("区间下界 > 0 且 2024/2025 同靶同向 ⇒ RIGHT_TAIL_EVIDENCE；年度反向则降级", () => {
    const base = {
      group: "D" as const,
      candidateDayCount: 100,
      rBlock: tailBlock({}),
      randomBlock: tailBlock({ label: "RANDOM" }),
      difference: pairedDifference(),
      rTotalReturnPct: 50,
      randomMedianTotalReturnPct: 10,
      rMaxDrawdownPct: 10,
      randomMedianMaxDrawdownPct: 30,
    };
    expect(judgeGroupVerdict({
      ...base,
      yearly: [yearlyRow({ year: 2024 }), yearlyRow({ year: 2025 })],
    }).verdict).toBe("RIGHT_TAIL_EVIDENCE");

    // 2025 反向（R 尾率低于 Random）⇒ 不同向 ⇒ 证据不足（即使账户权益收益更好）
    const notSameDirection = judgeGroupVerdict({
      ...base,
      yearly: [
        yearlyRow({ year: 2024 }),
        yearlyRow({ year: 2025, rHit20Count: 1, randomHit20Count: 900 }),
      ],
    });
    expect(notSameDirection.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(notSameDirection.reasons.join(" ")).toContain("年度同靶");
  });

  it("区间整体为负 ⇒ NO_SUPPORT；无候选 ⇒ NO_TRIGGER_IN_WINDOW", () => {
    expect(judgeGroupVerdict({
      group: "B",
      candidateDayCount: 100,
      rBlock: tailBlock({}),
      randomBlock: tailBlock({ label: "RANDOM" }),
      difference: pairedDifference({
        pointEstimate: -0.1,
        blockPrimary: interval({ low: -0.2, high: -0.01 }),
      }),
      yearly: [yearlyRow({ year: 2024 }), yearlyRow({ year: 2025 })],
      rTotalReturnPct: 50,
      randomMedianTotalReturnPct: 10,
      rMaxDrawdownPct: 10,
      randomMedianMaxDrawdownPct: 30,
    }).verdict).toBe("NO_SUPPORT");

    expect(judgeGroupVerdict({
      group: "C",
      candidateDayCount: 0,
      rBlock: tailBlock({ tradeCount: 0, completedTradeCount: 0, hit20Count: 0, tail20Rate: null }),
      randomBlock: tailBlock({ label: "RANDOM" }),
      difference: pairedDifference({ blockPrimary: null, blockSensitivity: null, anchorChainPrimary: null, meanPrimary: null }),
      yearly: [],
      rTotalReturnPct: 0,
      randomMedianTotalReturnPct: null,
      rMaxDrawdownPct: 0,
      randomMedianMaxDrawdownPct: null,
    }).verdict).toBe("NO_TRIGGER_IN_WINDOW");
  });

  it("全研究收口：主比较门槛 / 支持 / 风险权衡", () => {
    const comparison = (overrides: Partial<{
      sampleGateMet: boolean;
      supported: boolean;
      blockPrimaryLow: number;
      blockPrimaryHigh: number;
      pointEstimate: number;
    }>) => ({
      key: "D_R − B_R",
      label: "primary",
      fromGroup: "D" as const,
      toGroup: "B" as const,
      classification: "PRIMARY_CONFIRMATORY" as const,
      difference: pairedDifference({
        pointEstimate: overrides.pointEstimate ?? 0.05,
        blockPrimary: interval({
          low: overrides.blockPrimaryLow ?? 0.01,
          high: overrides.blockPrimaryHigh ?? 0.2,
        }),
      }),
      sampleGateMet: overrides.sampleGateMet ?? true,
      gateReason: "test gate",
      sameDirectionYears: [2024, 2025],
      sensitivityNotReversed: true,
      supported: overrides.supported ?? true,
      note: "test note",
    });
    const groups = [
      { group: "D" as const, tail20Rate: 0.4, totalReturnPct: 60, meanReturnPct: 5, maxDrawdownPct: 25 },
      { group: "B" as const, tail20Rate: 0.3, totalReturnPct: 40, meanReturnPct: 4, maxDrawdownPct: 20 },
    ];
    expect(judgeStudyVerdict({ primary: comparison({}), groups }).verdict).toBe("RIGHT_TAIL_EVIDENCE");
    expect(judgeStudyVerdict({
      primary: comparison({ sampleGateMet: false, supported: false }),
      groups,
    }).verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(judgeStudyVerdict({
      primary: comparison({ blockPrimaryLow: -0.2, blockPrimaryHigh: -0.01, pointEstimate: -0.1 }),
      groups,
    }).verdict).toBe("NO_SUPPORT");
    // 尾部有证据但均值与总收益更差 ⇒ RISK_TRADEOFF
    expect(judgeStudyVerdict({
      primary: comparison({}),
      groups: [
        { group: "D" as const, tail20Rate: 0.4, totalReturnPct: 10, meanReturnPct: 1, maxDrawdownPct: 25 },
        { group: "B" as const, tail20Rate: 0.3, totalReturnPct: 40, meanReturnPct: 4, maxDrawdownPct: 20 },
      ],
    }).verdict).toBe("RISK_TRADEOFF");
  });
});

// ---------------------------------------------------------------------------
// 9) 信封组装 ⇄ 自有 payload schema
// ---------------------------------------------------------------------------

function accountFixture(overrides: Partial<AccountMetrics>): AccountMetrics {
  return {
    group: "A",
    accountIndex: 0,
    kind: "R",
    seedIndex: null,
    decisionDayCount: 3,
    intentCount: 3,
    uniqueAnchorCount: 3,
    uniqueSecurityCount: 3,
    totalReturnPct: 12.5,
    annualizedReturnPct: 6.1,
    maxDrawdownPct: 8.2,
    tradeCount: 3,
    completedTradeCount: 2,
    openAtEndCount: 1,
    winRatePct: 50,
    profitFactor: 1.4,
    averageWinPct: 22.1,
    averageLossPct: -4.3,
    tail20Count: 1,
    tail20Rate: 0.5,
    tail50Count: 0,
    tail50Rate: 0,
    tail100Count: 0,
    tail100Rate: 0,
    averageHoldingPeriod: 12,
    finalCashSharePct: 21.3,
    skippedIntentCount: 1,
    fillCount: 3,
    rejectedOrderCount: 0,
    reentryEntryCount: 1,
    heldToExtendedCapCount: 0,
    ...overrides,
  };
}

function coverageFixture(group: CoverageAccounting["group"]): CoverageAccounting {
  return {
    group,
    tradesTotal: 3,
    tradesCompleted: 2,
    tradesOpenAtEnd: 1,
    mtmValidCount: 1,
    noExecutionBarCount: 0,
    suspendedCannotSellCount: 0,
    mtmValidWithRejectedSellEvidenceCount: 0,
    heldToExtendedCapCount: 0,
    runnerBridgeExitReasonCount: 0,
    runnerTriggerObservability: "UNOBSERVABLE",
    runnerObservabilityNote: "fixture",
    requiredPostRelativeDayForFullRunner: group === "A" ? 84 : 94,
    physicalPostMaxRelativeDay: 80,
    firstObservedTradingDate: D1,
    lastObservedTradingDate: D8,
    classifierNote: "fixture",
  };
}

function groupOutputFixture(groupId: "A" | "D"): GroupComputeOutput {
  const spec = GROUPS.find((group) => group.id === groupId)!;
  const block = tailBlock({ label: groupId === "D" ? "R" : "R" });
  return {
    group: spec,
    reentryPolicy: spec.reentryPolicy,
    configSnapshotJson: "{}",
    decisionDateCount: 3,
    candidateRowCount: 4,
    candidateDayCount: 3,
    poolSizeByDate: { min: 1, median: 1, max: 2 },
    poolSizeHistogram: { le2: 2, eq3: 1, gt3: 0 },
    triggerAnchorCount: 4,
    multiTriggerAnchorCount: 1,
    retriggerDayCount: 2,
    laterTriggerDayRetainedCount: 2,
    fillCount: 3,
    rejectedOrderCount: 0,
    skippedIntentCount: 1,
    accounts: [
      accountFixture({ group: groupId }),
      accountFixture({ group: groupId, accountIndex: 1, kind: "RANDOM", seedIndex: 20_261_010 }),
    ],
    tail: {
      r: block,
      randomPooled: tailBlock({ label: "pooled Random", uniqueTail20AnchorCount: null }),
      difference: pairedDifference(),
    },
    yearlyTail: [yearlyRow({ year: 2024 }), yearlyRow({ year: 2025 })],
    yearlyAccountReturns: [
      {
        year: 2024,
        rReturnPct: 12.5,
        randomMeanReturnPct: 9.1,
        randomMedianReturnPct: 9.1,
        randomPositiveSharePct: 100,
        randomP25ReturnPct: 8,
        randomP75ReturnPct: 10,
      },
    ],
    randomDistribution: [
      {
        group: groupId,
        field: "totalReturnPct",
        label: "复合总收益",
        unit: "%",
        min: 9.1,
        p05: 9.1,
        p25: 9.1,
        p50: 9.1,
        p75: 9.1,
        p95: 9.1,
        max: 9.1,
        mean: 9.1,
        rValue: 12.5,
        rPercentile: 100,
      },
    ],
    fillAge: [
      {
        group: groupId,
        fillRd: 4,
        fillCount: 3,
        uniqueAnchorCount: 3,
        completedTradeCount: 2,
        hit20Count: 1,
        tail20Rate: 0.5,
      },
    ],
    boundary: {
      group: groupId,
      observationDays: spec.observationDays,
      entryFillMaxRd: spec.entryFillMaxRd,
      confirmMinRd: spec.confirmMinRd,
      confirmMaxRd: spec.confirmMaxRd,
      earliestPossibleFillRd: spec.earliestPossibleFillRd,
      observedMinConfirmRd: spec.confirmMinRd,
      observedMaxConfirmRd: spec.confirmMaxRd,
      observedMinFillRd: spec.confirmMinRd + 1,
      observedMaxFillRd: spec.entryFillMaxRd,
      candidatesAtMinConfirmRd: 1,
      candidatesAtMaxConfirmRd: 0,
      candidatesAtFillCap: 0,
      fillRdViolationCount: 0,
      belowConfirmMinDayCount: 2,
      aboveConfirmMaxDayCount: 5,
      note: "fixture",
    },
    exclusionLedger: [
      { group: groupId, layer: "candidate", code: "TRIGGER_DAY", count: 4, unit: "行", note: "fixture" },
    ],
    reentry: {
      ordinals: [
        {
          group: groupId,
          entryOrdinal: 1,
          tradeCount: 3,
          completedCount: 2,
          hit20Count: 1,
          tail20Rate: 0.5,
          meanReturnPct: 3,
          medianReturnPct: 2,
          netPnlSum: 100,
          feesSum: 10,
        },
      ],
      filledAnchorCount: 3,
      anchorWithAtLeastOneHit20Count: 1,
      anchorChainNetPnlSum: 100,
      anchorChainHitButNetLossCount: 0,
      failedAttemptCount: 1,
      failedAttemptsByCode: { MEMBER_ENTRY_LIMIT_REACHED: 1 },
      note: "fixture",
    },
    rankingResolution: rankResolutionOf(groupId, [{ date: D1, preReturn10: 0.1 }]),
    coverage: coverageFixture(groupId),
    verdict: { verdict: "INSUFFICIENT_EVIDENCE", reasons: ["fixture"] },
  };
}

function computeOutputFixture(): ObservationWindowComputeOutput {
  const groupA = groupOutputFixture("A");
  const groupD = groupOutputFixture("D");
  const comparison = {
    key: "D_R − B_R",
    label: "primary",
    fromGroup: "D" as const,
    toGroup: "B" as const,
    classification: "PRIMARY_CONFIRMATORY" as const,
    difference: pairedDifference(),
    sampleGateMet: false,
    gateReason: "fixture gate",
    sameDirectionYears: [2024],
    sensitivityNotReversed: true,
    supported: false,
    note: "fixture",
  };
  return {
    scannedEventCount: 10,
    eligibleEventCount: 6,
    excludedByReason: { NOT_FIRST_LIMIT: 3, NO_POST_BARS: 1 },
    datasetDeclaredEventCount: 10,
    unresolvedIdentityEventCount: 0,
    poolDecisionDateCount: 4,
    anchorSwitchCount: 1,
    executionRowCount: 16,
    executionSecurityCount: 2,
    tradingDayCount: 8,
    tradingDayCalendarFirst: D1,
    tradingDayCalendarLast: D8,
    barValueConflictCount: 0,
    fillDayCalendarMismatchCount: 0,
    groups: [groupA, groupD],
    primaryComparison: comparison,
    secondaryComparisons: [
      {
        ...comparison,
        key: "D_R − E_R",
        label: "secondary",
        toGroup: "E" as const,
        classification: "SECONDARY_DESCRIPTIVE" as const,
      },
    ],
    studyVerdict: { verdict: "INSUFFICIENT_EVIDENCE", reasons: ["fixture"] },
    coverage: coverageFixture("ALL"),
    contractGaps: ["fixture gap"],
    coverageNotes: ["fixture note"],
    poolDailySummary: [
      { date: D1, poolSize: 2, candidateCountByGroup: { A: 1, D: 2 }, rSelected: 1 },
    ],
  };
}

describe("9) 信封组装 ⇄ 自有 payload schema", () => {
  it("组装出的 customPayload 通过本实验的 zod schema，账平，关键表齐全", () => {
    const payload = assembleObservationWindowResult({
      output: computeOutputFixture(),
      datasetVersionId: 780_004,
      datasetVersionLabel: "v10-listed365-pre10-post80",
    });
    const parsed = observationWindowCustomPayloadSchema.safeParse(payload.customPayload);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);

    expect(payload.sampleSummary.eligibleCount + payload.sampleSummary.excludedCount)
      .toBe(payload.sampleSummary.candidateCount);
    expect(Object.values(payload.sampleSummary.excludedByReason).reduce((sum, value) => sum + value, 0))
      .toBe(payload.sampleSummary.excludedCount);

    const keys = (payload.tables ?? []).map((table) => table.key);
    for (const key of [
      "observation-window-group-overview",
      "observation-window-tail-rates",
      "observation-window-paired-bootstrap",
      "observation-window-candidate-headcount",
      "observation-window-fill-age",
      "observation-window-nl-boundary",
      "observation-window-exclusion-ledger",
      "observation-window-reentry",
      "observation-window-reentry-anchors",
      "observation-window-yearly-tail",
      "observation-window-yearly-account-returns",
      "observation-window-coverage",
      "observation-window-account-metrics",
      "observation-window-verdicts",
    ]) {
      expect(keys).toContain(key);
    }
    // 修正 5：年度信号表与年度账户收益表**必须分开**
    expect(keys).toContain("observation-window-yearly-tail");
    expect(keys).toContain("observation-window-yearly-account-returns");
    const overview = (payload.customPayload as { groupSummaries: readonly { groupId: string }[] }).groupSummaries;
    expect(overview.map((row) => row.groupId)).toEqual(["A", "D"]);
    expect(payload.statistics?.some((row) => row.code === "observation_window_primary_difference")).toBe(true);
  });
});
