/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` · S4 有意义的执行测试。
 *
 * 覆盖 RULE §7 要求的边界：得分高但不突破不买 / 突破但无两日历史不买 /
 * 中间停牌不把两个有效日拼接成连续 / 确认日放量不被「50% 缩量」误杀 /
 * 破位后反弹不能恢复同锚点资格 / T+9 确认-T+10 成交允许且不越界 /
 * 未来数据扰动不改变既有历史信号。
 */
import { describe, expect, it } from "vitest";
import type { PoolBar, PoolEvent } from "../../../research-experiments/shared/rollingPoolRightTail/projection";
import {
  CONFIRM_MAX_RD,
  CONFIRM_MIN_RD,
  EARLY_ENTRY_COMPUTATION_VERSION,
  ENTRY_FILL_MAX_RD,
  evaluateEarlyEntry,
  observationScores,
  SUPPORT_RATIO,
  triggerOn,
} from "../../../research-experiments/shared/rollingPoolEarlyEntry";

// ---------------------------------------------------------------------------
// fixture 构造器
// ---------------------------------------------------------------------------

interface BarInput {
  readonly open?: number | null;
  readonly high?: number | null;
  readonly low?: number | null;
  readonly close?: number | null;
  readonly volume?: number | null;
  readonly tradeDate?: string;
  readonly barPresent?: boolean;
  readonly suspended?: boolean;
}

/** 事件日 rd0 基线：open=10 → 支撑位 9.80；volume=1000 → 缩量阈值 500。 */
const EVENT_DAY: Required<Pick<BarInput, "open" | "high" | "low" | "close" | "volume">> = {
  open: 10, high: 11, low: 9.5, close: 11, volume: 1000,
};

function bar(relativeDay: number, input: BarInput): PoolBar {
  return {
    relativeDay,
    tradeDate: input.tradeDate ?? `2024-01-${String(relativeDay).padStart(2, "0")}`,
    open: input.open === undefined ? 10 : input.open,
    high: input.high === undefined ? 10.2 : input.high,
    low: input.low === undefined ? 9.9 : input.low,
    close: input.close === undefined ? 10 : input.close,
    preClose: null,
    limitUpPrice: null,
    limitDownPrice: null,
    volume: input.volume === undefined ? 400 : input.volume,
    barPresent: input.barPresent ?? true,
    suspended: input.suspended ?? false,
    canBuyAtOpen: true,
    canSellAtClose: true,
  };
}

function mkEvent(post: Readonly<Record<number, BarInput>>, eventDay: BarInput = {}): PoolEvent {
  // rd1..9 默认给一根「中性续走」bar（不制造突破、不破位），使 fixture 的观察窗**完整**；
  // 想表达「该日无 bar / 停牌 / 零量」时在 `post` 里显式覆盖。
  const NEUTRAL: BarInput = { low: 9.95, close: 10.0, high: 10.05, volume: 400 };
  const full: Record<number, BarInput> = {};
  for (let rd = 1; rd <= CONFIRM_MAX_RD; rd += 1) full[rd] = NEUTRAL;
  for (const [rd, value] of Object.entries(post)) full[Number(rd)] = value;
  return {
    eventId: "000001.SZ@2024-01-01",
    symbol: "000001.SZ",
    eventDate: "2024-01-01",
    year: 2024,
    market: "SZ",
    boardType: "main",
    isFirstLimit: true,
    prefix: new Map([[0, bar(0, { ...EVENT_DAY, ...eventDay })]]),
    post: new Map(Object.entries(full).map(([rd, value]) => [Number(rd), bar(Number(rd), value)])),
  };
}

/** rd1/rd2 均为 3 分以上、rd3 收盘突破且量能回升 ⇒ 应在 rd3 触发。 */
const HEALTHY_POST: Record<number, BarInput> = {
  1: { low: 9.85, close: 9.9, high: 10.0, volume: 400 },   // S=3（收盘未改善）
  2: { low: 9.9, close: 9.95, high: 10.0, volume: 300 },   // S=4
  3: { low: 9.95, close: 10.5, high: 10.6, volume: 600 },  // 突破 + 放量
};

// ---------------------------------------------------------------------------

describe("EARLY-ENTRY-002 · 观察分（四项单列、缺失不打 0）", () => {
  it("分项单列且与 RULE §2 的四个判据一一对应", () => {
    const scores = observationScores(mkEvent(HEALTHY_POST), 9);
    expect(scores).toHaveLength(9);
    const first = scores[0]!;
    expect(first.relativeDay).toBe(1);
    expect(Object.keys(first.flags ?? {}).sort()).toEqual(
      ["closeImprove", "lowStable", "shrink", "support"].sort(),
    );
    // rd1: 守线 9.85>=9.80 ✓ / 缩量 400<=500 ✓ / 低点稳定 9.85>=9.5 ✓ / 收盘改善 9.9>11 ✗
    expect(first.flags).toEqual({ support: 1, shrink: 1, lowStable: 1, closeImprove: 0 });
    expect(first.score).toBe(3);
    // rd2: 四项全中
    expect(scores[1]!.flags).toEqual({ support: 1, shrink: 1, lowStable: 1, closeImprove: 1 });
    expect(scores[1]!.score).toBe(4);
  });

  it("rd0 无 bar ⇒ 所有观察日不可评估（EVENT_BAR_UNUSABLE），且不伪造成交", () => {
    const event = mkEvent(HEALTHY_POST, { barPresent: false });
    const scores = observationScores(event, 9);
    expect(scores.every((s) => s.score === null)).toBe(true);
    expect(scores.every((s) => s.missingReason === "EVENT_BAR_UNUSABLE")).toBe(true);
    const evaluation = evaluateEarlyEntry(event);
    expect(evaluation.finalState).toBe("UNASSESSABLE");
    expect(evaluation.finalReason).toBe("EVENT_DAY_BAR_UNUSABLE");
    expect(evaluation.triggers).toHaveLength(0);
  });

  it("停牌日 / 零量日：score=null 且有原因，绝不被当成「缩量优秀」", () => {
    const event = mkEvent({ ...HEALTHY_POST, 2: { suspended: true }, 4: { volume: 0 } });
    const scores = observationScores(event, 9);
    expect(scores[1]!.score).toBeNull();
    expect(scores[1]!.missingReason).toBe("BAR_SUSPENDED");
    expect(scores[3]!.score).toBeNull();
    expect(scores[3]!.missingReason).toBe("ZERO_VOLUME");
  });

  it("支撑位锚点是首板日**开盘价**（0.98 × O_0），不是低点/涨停价/MA", () => {
    const evaluation = evaluateEarlyEntry(mkEvent(HEALTHY_POST));
    expect(evaluation.eventDayOpen).toBe(10);
    expect(evaluation.supportFloor).toBeCloseTo(SUPPORT_RATIO * 10, 12);
  });
});

describe("EARLY-ENTRY-002 · 六条件触发", () => {
  it("条件全成立 ⇒ 在 rd3 触发，成交日为 rd4（T+9 确认 / T+10 成交的上界不越界）", () => {
    const evaluation = evaluateEarlyEntry(mkEvent(HEALTHY_POST));
    expect(evaluation.finalState).toBe("TRIGGERED");
    expect(evaluation.triggers).toHaveLength(1);
    const trigger = evaluation.triggers[0]!;
    expect(trigger.confirmRd).toBe(3);
    expect(trigger.fillRd).toBe(4);
    expect(trigger.evidence.pullbackFirstRd).toBe(1);
    expect(trigger.evidence.scorePrev2).toBe(3);
    expect(trigger.evidence.scorePrev1).toBe(4);
    expect(triggerOn(evaluation, 3)).toStrictEqual(trigger);
    expect(triggerOn(evaluation, 4)).toBeNull();
  });

  it("得分高但**当日不突破** ⇒ 不触发", () => {
    // rd3 收盘 9.99 未超过 max(H1=10.0, H2=10.0)
    const evaluation = evaluateEarlyEntry(mkEvent({
      ...HEALTHY_POST,
      3: { low: 9.95, close: 9.99, high: 10.0, volume: 600 },
    }));
    expect(evaluation.triggers).toHaveLength(0);
    expect(evaluation.finalState).toBe("ENTRY_EXPIRED");
  });

  it("突破但**前两日观察分不足** ⇒ 不触发", () => {
    // rd1 只有 2 分：缩量✗（600 > 500）且收盘改善✗。
    // 🔴 结构事实：当 `L_0 < 0.98·O_0`（本例 9.5 < 9.8）时「低点稳定」被「守线」蕴含
    //    ⇒ 四分项里可独立失分的是缩量与收盘改善两条。
    const weakFirstDay = { low: 9.85, close: 9.9, high: 10.0, volume: 600 };
    expect(observationScores(mkEvent({ ...HEALTHY_POST, 1: weakFirstDay }), 9)[0]!.score).toBe(2);
    const evaluation = evaluateEarlyEntry(mkEvent({ ...HEALTHY_POST, 1: weakFirstDay }));
    expect(evaluation.triggers.every((t) => t.confirmRd !== 3)).toBe(true);
  });

  it("**确实发生过回撤**：C_j < C_0 必须发生在确认日之前", () => {
    // 全程收盘都在事件日收盘 11 之上 ⇒ 无回撤（且支撑不破）
    const noPullback: Record<number, BarInput> = {};
    for (let rd = 1; rd <= CONFIRM_MAX_RD; rd += 1) {
      noPullback[rd] = {
        low: 11.0, close: 11.1 + rd * 0.1, high: 11.2 + rd * 0.1, volume: 400 + rd * 10,
      };
    }
    const evaluation = evaluateEarlyEntry(mkEvent(noPullback));
    expect(evaluation.pullbackFirstRd).toBeNull();
    expect(evaluation.triggers).toHaveLength(0);
  });

  it("确认日**放量**不被「50% 缩量」误杀（缩量只约束观察日）", () => {
    const evaluation = evaluateEarlyEntry(mkEvent({
      ...HEALTHY_POST,
      3: { low: 9.95, close: 10.5, high: 10.6, volume: 8000 }, // 远超 V0
    }));
    expect(evaluation.triggers).toHaveLength(1);
    expect(observationScores(mkEvent({
      ...HEALTHY_POST,
      3: { low: 9.95, close: 10.5, high: 10.6, volume: 8000 },
    }), 9)[2]!.flags?.shrink).toBe(0);
  });

  it("**量能未回升** ⇒ 当日不触发", () => {
    const evaluation = evaluateEarlyEntry(mkEvent({
      ...HEALTHY_POST,
      3: { low: 9.95, close: 10.5, high: 10.6, volume: 200 }, // V3 < V2=300
    }));
    expect(evaluation.triggers).toHaveLength(0);
  });

  it("所有确认日的 fillRd 恒 ≤ 10，且 confirmRd ∈ [3,9]", () => {
    for (let rd = CONFIRM_MIN_RD; rd <= CONFIRM_MAX_RD; rd += 1) {
      expect(rd + 1).toBeLessThanOrEqual(ENTRY_FILL_MAX_RD);
    }
    const evaluation = evaluateEarlyEntry(mkEvent(HEALTHY_POST));
    for (const trigger of evaluation.triggers) {
      expect(trigger.confirmRd).toBeGreaterThanOrEqual(CONFIRM_MIN_RD);
      expect(trigger.confirmRd).toBeLessThanOrEqual(CONFIRM_MAX_RD);
      expect(trigger.fillRd).toBeLessThanOrEqual(ENTRY_FILL_MAX_RD);
    }
  });
});

describe("EARLY-ENTRY-002 · 停牌 / 破位 / 未来数据", () => {
  it("中间停牌**不能**把两个有效日拼接成连续两日", () => {
    const evaluation = evaluateEarlyEntry(mkEvent({ ...HEALTHY_POST, 2: { suspended: true } }));
    // rd2 不可评估 ⇒ d=3 的 S2 缺失、d=4 的 S2 也缺失 ⇒ 不触发
    expect(evaluation.triggers).toHaveLength(0);
    expect(evaluation.finalState).toBe("UNASSESSABLE");
    expect(evaluation.finalReason).toBe("SUPPORT_PATH_INCOMPLETE");
  });

  it("支撑破位后**反弹不能恢复**同锚点资格（INVALIDATED_SUPPORT，不恢复）", () => {
    const evaluation = evaluateEarlyEntry(mkEvent({
      1: { low: 9.7, close: 9.75, high: 10.0, volume: 400 },  // 9.7 < 9.80 ⇒ 破位
      2: { low: 9.9, close: 10.6, high: 10.7, volume: 300 },  // 反弹且「突破」
      3: { low: 9.95, close: 10.9, high: 11.0, volume: 600 },
      4: { low: 10.0, close: 11.2, high: 11.3, volume: 700 },
    }));
    expect(evaluation.supportBreachRd).toBe(1);
    expect(evaluation.finalState).toBe("INVALIDATED_SUPPORT");
    expect(evaluation.finalReason).toBe("SUPPORT_BREACHED");
    expect(evaluation.triggers).toHaveLength(0);
  });

  it("**未来数据扰动**不改变既有历史信号（PIT）", () => {
    const base = mkEvent(HEALTHY_POST);
    const disturbed = mkEvent({
      ...HEALTHY_POST,
      6: { low: 1, close: 99, high: 100, volume: 99999 },
      7: { low: 0.1, close: 0.2, high: 0.3, volume: 1 },
      8: { barPresent: false },
      9: { suspended: true },
    });
    const a = evaluateEarlyEntry(base);
    const b = evaluateEarlyEntry(disturbed);
    expect(b.triggers.map((t) => ({ ...t }))).toStrictEqual(a.triggers.map((t) => ({ ...t })));
    // rd1..3 的评分逐字节一致
    expect(observationScores(disturbed, 3)).toStrictEqual(observationScores(base, 3));
  });

  it("常量与规则版本可审计", () => {
    expect(EARLY_ENTRY_COMPUTATION_VERSION).toBe("1.0.0");
    expect(SUPPORT_RATIO).toBe(0.98);
    expect(CONFIRM_MIN_RD).toBe(3);
    expect(CONFIRM_MAX_RD).toBe(9);
  });
});
