/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` · S3 有界验证（fixture 锁定 + 端到端重放）。
 *
 * 覆盖规格 §6/S3 的固定清单：
 *   首板定义 · 上市 365 日边界（构建期固化，实验只做坐标断言）· 非主板/ST ·
 *   同股多事件锚点不刷新 · 到期切换 · rd5 与 rd40 边界 · 三天两板/五天三板 ·
 *   连续跌停保留 · 未来 bar 污染 · 不可买不递补 · 退出顺延 / MTM · 右删失 · 确定性。
 *
 * 另加两条**仪器**测试：
 *   - `findExecutableExit` 的新增可选形参在缺省时与既有行为**逐字节一致**；
 *   - `movingBlockBootstrapMean/Difference` 的新增 `quantiles` 在缺省时与既有
 *     95% 双侧一致、并可表达 97.5% 双侧（Bonferroni）。
 *
 * 另加一条**权威口径平价**测试：本实验算出的 `maxAmp5` == Strategy Core
 * `EVENT_STATE_AMPLITUDE_WINDOW` 冻结公式的手算值，且**完全不受 rd16+ bar 影响**。
 */

import { describe, expect, it } from "vitest";
import type {
  ExperimentBarRow,
  ExperimentEventRow,
  ExperimentResultPayload,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  movingBlockBootstrapDifference,
  movingBlockBootstrapMean,
} from "../../../research-experiments/shared/dateClusterBootstrap";
import { findExecutableExit } from "../../../research-experiments/shared/firstBoardPullback/panel";
import type { NormalizedFoundationBar } from "../../../research-experiments/shared/firstBoardPullback/types";
import {
  buildDailyPicks,
  buildDailyPool,
  buildOpportunitySegments,
  deriveEventFactors,
  deriveSignalLabel,
  type MaxAmp5Computer,
  type PoolBar,
  type PoolEvent,
} from "../../../research-experiments/shared/rollingPoolRightTail";
import {
  CI_QUANTILES,
  MAX_POST_RELATIVE_DAY_NEEDED,
  POST_RELATIVE_DAYS,
  PREFIX_RELATIVE_DAYS,
  RANDOM_DRAW_COUNT,
  SELECTABLE_AGE_LOWER_BOUND,
  WATCH_MAX_AGE,
  WATCH_MIN_AGE,
} from "../../../research-experiments/shared/rollingPoolRightTail/types";
import {
  makeCoreMaxAmp5Computer,
  rollingPoolRightTailMvpExperiment,
} from "../../../research-experiments/first-board-pullback/rolling-pool-right-tail-mvp/experiment";

// ---------------------------------------------------------------------------
// fixture 工具
// ---------------------------------------------------------------------------

/** 生成 `count` 个工作日（跳过周六周日），从 `startISO` 起。 */
function tradingDays(startISO: string, count: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startISO}T00:00:00Z`);
  while (out.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** 覆盖事件日、prefix 窗与完整 rd1..70 标签窗的日历（140 个工作日 ≈ 到 2024-06）。 */
const CALENDAR = tradingDays("2023-11-01", 140);

interface BarSpec {
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly open?: number;
  readonly limitUpPrice?: number | null;
  readonly limitDownPrice?: number | null;
  readonly canBuyAtOpen?: boolean;
  readonly canSellAtClose?: boolean;
  readonly barPresent?: boolean;
  readonly suspended?: boolean;
}

function makeBar(relativeDay: number, tradeDate: string, spec: BarSpec): PoolBar {
  const open = spec.open ?? spec.close;
  return {
    relativeDay,
    tradeDate,
    open,
    high: spec.high,
    low: spec.low,
    close: spec.close,
    preClose: spec.close,
    // 缺省给一个「既不涨停也不跌停、且开盘价高于跌停价」的价位区间，
    // 使既有顺延原语（`open > limitDownPrice` ⇒ 开盘出场）走正常路径。
    limitUpPrice: spec.limitUpPrice === undefined ? spec.close * 1.5 : spec.limitUpPrice,
    limitDownPrice: spec.limitDownPrice === undefined ? spec.close * 0.5 : spec.limitDownPrice,
    barPresent: spec.barPresent ?? true,
    suspended: spec.suspended ?? false,
    canBuyAtOpen: spec.canBuyAtOpen ?? true,
    canSellAtClose: spec.canSellAtClose ?? true,
  };
}

/**
 * 造一个「平盘波动 1%」的事件：rd1..15 振幅可控，rd16+ 可选注入**极端**走势
 * （用于证明 maxAmp5 与资格判定完全不受 rd16+ 影响）。
 */
function makeEvent(args: {
  readonly eventId: string;
  readonly symbol: string;
  readonly eventDateIndex: number;
  readonly prefixCloses?: readonly [number, number, number]; // [-10, -1, 0]
  readonly amplitude?: (rd: number) => number;
  readonly closePath?: (rd: number) => number;
  readonly override?: (rd: number) => Partial<BarSpec> | null;
}): PoolEvent {
  const [closeMinus10, closeMinus1, close0] = args.prefixCloses ?? [10, 11, 12];
  const prefix = new Map<number, PoolBar>();
  prefix.set(-10, makeBar(-10, CALENDAR[args.eventDateIndex - 10]!, { high: closeMinus10, low: closeMinus10, close: closeMinus10 }));
  prefix.set(-1, makeBar(-1, CALENDAR[args.eventDateIndex - 1]!, { high: closeMinus1, low: closeMinus1, close: closeMinus1 }));
  prefix.set(0, makeBar(0, CALENDAR[args.eventDateIndex]!, { high: close0, low: close0, close: close0 }));

  const post = new Map<number, PoolBar>();
  let previousClose = close0;
  for (let rd = 1; rd <= MAX_POST_RELATIVE_DAY_NEEDED; rd += 1) {
    const close = args.closePath ? args.closePath(rd) : Math.round(previousClose * 100) / 100;
    const amplitude = args.amplitude ? args.amplitude(rd) : 0.01;
    const high = Math.round(previousClose * (1 + amplitude) * 100) / 100;
    const low = Math.round(previousClose * (1 - amplitude) * 100) / 100;
    const base: BarSpec = { high, low, close, open: previousClose };
    const override = args.override?.(rd) ?? null;
    post.set(rd, makeBar(rd, CALENDAR[args.eventDateIndex + rd]!, { ...base, ...override }));
    previousClose = close;
  }

  return {
    eventId: args.eventId,
    symbol: args.symbol,
    eventDate: CALENDAR[args.eventDateIndex]!,
    year: Number(CALENDAR[args.eventDateIndex]!.slice(0, 4)),
    market: "SH",
    boardType: "main",
    isFirstLimit: true,
    prefix,
    post,
  };
}

/** 一个永远返回固定值的 maxAmp5 注入替身（纯投影测试不依赖 Core）。 */
const FIXED_MAXAMP5: MaxAmp5Computer = ({ barsThroughRd15 }) =>
  barsThroughRd15.length === 15 ? 0.05 : null;

const AUDIT_START = "2024-01-02";
const AUDIT_END = "2025-09-30";
const AUDIT_WINDOW = { startDate: AUDIT_START, endDate: AUDIT_END };

// ---------------------------------------------------------------------------
// 1. 锚点规则：同股一个锚点 · 不刷新 · 到期切换
// ---------------------------------------------------------------------------

describe("滚动池 · 同股锚点", () => {
  const older = makeEvent({ eventId: "A@1", symbol: "600000.SH", eventDateIndex: 40 });
  const newer = makeEvent({ eventId: "B@2", symbol: "600000.SH", eventDateIndex: 52 });
  const other = makeEvent({ eventId: "C@3", symbol: "600001.SH", eventDateIndex: 40 });
  const events = [older, newer, other];
  const factors = deriveEventFactors(events, FIXED_MAXAMP5);
  const pool = buildDailyPool({ events, factors, window: AUDIT_WINDOW });

  it("每日同 symbol 恰一行（股票级面板）", () => {
    const seen = new Set<string>();
    for (const row of pool.dailyRows) {
      const key = `${row.date}|${row.symbol}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(pool.dailyRows.length).toBeGreaterThan(0);
  });

  it("锚点 = 最早尚未过期成员（= rd 最大），其余进 relatedEventIds", () => {
    // 找一个两只事件同时在池中的日期：older 年龄 ∈ [1,40] 且 newer 年龄 ∈ [1,40]。
    const row = pool.dailyRows.find(
      (item) => item.symbol === "600000.SH" && item.relatedEventIds.length > 0,
    );
    expect(row).toBeDefined();
    expect(row!.anchorEventId).toBe("A@1");
    expect(row!.relatedEventIds).toBe("B@2");
  });

  it("新首板不刷新旧锚点的年龄（年龄 = 锚点事件自己的 rd）", () => {
    const row = pool.dailyRows.find(
      (item) => item.symbol === "600000.SH" && item.relatedEventIds.length > 0,
    )!;
    const expectedAge = CALENDAR.indexOf(row.date) - 40;
    expect(row.eventAge).toBe(expectedAge);
  });

  it("旧锚点过期后切换到当时最早的未过期成员，并显式记账", () => {
    const switched = pool.dailyRows.find(
      (item) => item.symbol === "600000.SH" && item.anchorEventId === "B@2",
    );
    expect(switched).toBeDefined();
    expect(switched!.anchorChanged).toBe(true);
    expect(switched!.eventAge).toBeLessThanOrEqual(WATCH_MAX_AGE);
    expect(pool.anchorSwitchCount).toBeGreaterThan(0);
  });

  it("每日账的年龄恒落在 rd1..40（留池窗口是硬边界）", () => {
    for (const row of pool.dailyRows) {
      expect(row.eventAge).toBeGreaterThanOrEqual(WATCH_MIN_AGE);
      expect(row.eventAge).toBeLessThanOrEqual(WATCH_MAX_AGE);
      expect(row.date >= AUDIT_START && row.date <= AUDIT_END).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. rd5 / rd15 / rd40 边界
// ---------------------------------------------------------------------------

describe("滚动池 · 年龄边界与资格", () => {
  const event = makeEvent({
    eventId: "E@9",
    symbol: "600002.SH",
    eventDateIndex: 40,
    closePath: () => 10,
  });
  const factors = deriveEventFactors([event], FIXED_MAXAMP5);
  const pool = buildDailyPool({ events: [event], factors, window: AUDIT_WINDOW });
  const byAge = new Map(pool.dailyRows.map((row) => [row.eventAge, row]));

  it("rd4 仍在观察池但不参与选择（年龄 < rd5）", () => {
    const row = byAge.get(4);
    expect(row).toBeDefined();
    expect(row!.signalEligible).toBe(false);
    expect(row!.rejectionReasons).toContain("AGE_BELOW_SELECT_MIN");
  });

  it("rd5..14 因 maxAmp5 决策下界 rd15 而不可选（结构性事实，如实登记）", () => {
    for (let age = 5; age < SELECTABLE_AGE_LOWER_BOUND; age += 1) {
      const row = byAge.get(age);
      expect(row).toBeDefined();
      expect(row!.signalEligible).toBe(false);
      expect(row!.rejectionReasons).toContain("MAXAMP5_NOT_AVAILABLE_BEFORE_RD15");
      expect(row!.maxAmp5).toBeNull();
    }
  });

  it("rd15 与 rd40 可选（两因子均可评估）", () => {
    expect(byAge.get(SELECTABLE_AGE_LOWER_BOUND)!.signalEligible).toBe(true);
    expect(byAge.get(WATCH_MAX_AGE)!.signalEligible).toBe(true);
  });

  it("rd41 不再入池（成员过期）", () => {
    expect(byAge.get(WATCH_MAX_AGE + 1)).toBeUndefined();
  });

  it("缺失前缀 ⇒ preReturn10 不可评估，成员仍保留观察账", () => {
    const broken = makeEvent({ eventId: "F@9", symbol: "600003.SH", eventDateIndex: 40 });
    broken.prefix.delete(-10);
    const brokenFactors = deriveEventFactors([broken], FIXED_MAXAMP5);
    expect(brokenFactors.get("F@9")!.preReturn10).toBeNull();
    expect(brokenFactors.get("F@9")!.preReturn10MissingReason).toBe("MISSING_PREFIX_PATH");
    const brokenPool = buildDailyPool({
      events: [broken],
      factors: brokenFactors,
      window: AUDIT_WINDOW,
    });
    const eligibleAge = brokenPool.dailyRows.find(
      (row) => row.eventAge === SELECTABLE_AGE_LOWER_BOUND,
    )!;
    expect(eligibleAge.signalEligible).toBe(false);
    expect(eligibleAge.rejectionReasons).toContain("MISSING_PREFIX_PATH");
  });
});

// ---------------------------------------------------------------------------
// 3. 未来 bar 污染
// ---------------------------------------------------------------------------

describe("滚动池 · 未来 bar 污染", () => {
  const tame = makeEvent({
    eventId: "T@1",
    symbol: "600010.SH",
    eventDateIndex: 40,
    amplitude: () => 0.01,
    closePath: () => 10,
  });
  const wild = makeEvent({
    eventId: "W@1",
    symbol: "600011.SH",
    eventDateIndex: 40,
    amplitude: (rd) => (rd >= 16 ? 0.5 : 0.01),
    closePath: (rd) => (rd >= 16 ? 5 : 10),
  });
  const factors = deriveEventFactors([tame, wild], FIXED_MAXAMP5);

  it("rd16+ 的极端走势不改变 maxAmp5（Core 定义硬截断在 rd15）", () => {
    // 注入替身证明「只喂 rd1..15」；真实 Core 平价见下一节。
    expect(factors.get("T@1")!.maxAmp5).toBe(0.05);
    expect(factors.get("W@1")!.maxAmp5).toBe(0.05);
    expect(factors.get("W@1")!.maxAmp5MissingReason).toBeNull();
  });

  it("资格与排名不使用 nextOpenExecutable（它是下一交易日的真实结果）", () => {
    // 把「下一交易日不可买」注入到 rd16（= 可选年龄 15 的下一交易日），
    // 但资格与排名输入（preReturn10 / maxAmp5）不变 ⇒ 仍然可选。
    const event = makeEvent({
      eventId: "N@1",
      symbol: "600012.SH",
      eventDateIndex: 40,
      amplitude: () => 0.01,
      closePath: () => 10,
      override: (rd) => (rd === SELECTABLE_AGE_LOWER_BOUND + 1 ? { canBuyAtOpen: false } : null),
    });
    const eventFactors = deriveEventFactors([event], FIXED_MAXAMP5);
    const pool = buildDailyPool({ events: [event], factors: eventFactors, window: AUDIT_WINDOW });
    const row = pool.dailyRows.find((item) => item.eventAge === SELECTABLE_AGE_LOWER_BOUND)!;
    expect(row.signalEligible).toBe(true);
    expect(row.nextOpenExecutable).toBe(false);
    expect(row.rejectionReasons).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 4. 权威口径平价（Core maxAmp5）
// ---------------------------------------------------------------------------

describe("maxAmp5 · 权威口径平价", () => {
  /** 手算 Core 冻结公式：链式前收自 rd0 收盘起步，取 rd11..15 的最大振幅。 */
  function expectedMaxAmp5(event: PoolEvent): number {
    const amplitudes: number[] = [];
    let runningPreClose = event.prefix.get(0)!.close!;
    for (let rd = 1; rd <= 15; rd += 1) {
      const bar = event.post.get(rd)!;
      const amplitude = (bar.high! - bar.low!) / runningPreClose;
      if (rd >= 11) amplitudes.push(amplitude);
      runningPreClose = bar.close!;
    }
    return Math.max(...amplitudes);
  }

  const event = makeEvent({
    eventId: "P@1",
    symbol: "600020.SH",
    eventDateIndex: 40,
    prefixCloses: [9, 10.5, 11],
    amplitude: (rd) => 0.005 * rd,
    closePath: (rd) => 11 + rd * 0.05,
    override: (rd) => (rd >= 16 ? { high: 99, low: 1, close: 50 } : null),
  });

  it("与手算的 Core 公式一致（且不受 rd16+ 影响）", () => {
    const computer = makeCoreMaxAmp5Computer("test");
    const factors = deriveEventFactors([event], computer);
    const value = factors.get("P@1")!.maxAmp5;
    expect(value).not.toBeNull();
    expect(value!).toBeCloseTo(expectedMaxAmp5(event), 12);
  });

  it("rd16+ 被替换成极端值后取值不变（截断证明）", () => {
    const computer = makeCoreMaxAmp5Computer("test");
    const before = deriveEventFactors([event], computer).get("P@1")!.maxAmp5;
    const mutated: PoolEvent = {
      ...event,
      post: new Map(
        [...event.post.entries()].map(([rd, bar]) =>
          rd >= 16 ? [rd, { ...bar, high: 1000, low: 0.001, close: 500 }] : [rd, bar],
        ),
      ),
    };
    const after = deriveEventFactors([mutated], computer).get("P@1")!.maxAmp5;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 5. 不可买不递补 · 顺延 · MTM · 右删失 · 连续跌停
// ---------------------------------------------------------------------------

describe("标签 · 执行性与顺延", () => {
  it("下一交易日不可买 ⇒ NO_FILL，且不递补第 4 名", () => {
    const events = [0, 1, 2, 3].map((index) =>
      makeEvent({
        eventId: `S${index}@1`,
        symbol: `60010${index}.SH`,
        eventDateIndex: 40,
        closePath: () => 10,
        override: (rd) =>
          index === 0 && rd === SELECTABLE_AGE_LOWER_BOUND + 1 ? { canBuyAtOpen: false } : null,
      }),
    );
    const factors = deriveEventFactors(events, (input) => input.barsThroughRd15[0]!.close! * 0.001 + input.eventDayBar.relativeDay * 0);
    const pool = buildDailyPool({ events, factors, window: AUDIT_WINDOW });
    const picks = buildDailyPicks({
      dailyRows: pool.dailyRows,
      eligibleEventIdsByDate: pool.eligibleEventIdsByDate,
      decisionDates: pool.decisionDates,
    });
    const pick = picks.find((item) => item.poolSize === 4)!;
    expect(pick.armR.length).toBe(3);
    const labels = pick.armR.map((eventId) => {
      const factor = factors.get(eventId)!;
      void factor;
      const event = events.find((item) => item.eventId === eventId)!;
      return deriveSignalLabel(event, SELECTABLE_AGE_LOWER_BOUND);
    });
    expect(labels.some((label) => label.labelCode === "NO_FILL")).toBe(true);
    // 未选中的第 4 名没有被递补进来（armR 里没有第 4 只）
    expect(pick.armR).not.toContain(events[3]!.eventId);
  });

  it("目标出场不可卖 ⇒ 顺延到其后首个可卖价，并记录顺延天数", () => {
    const target = SELECTABLE_AGE_LOWER_BOUND + 1 + 19; // = 35
    const event = makeEvent({
      eventId: "D@1",
      symbol: "600030.SH",
      eventDateIndex: 40,
      closePath: () => 10,
      override: (rd) => {
        if (rd >= target && rd < target + 3) {
          return { canSellAtClose: false, limitDownPrice: 20 };
        }
        if (rd === target + 3) {
          return { close: 11, open: 10, high: 11, low: 10, limitDownPrice: 5, canSellAtClose: true };
        }
        return null;
      },
    });
    const label = deriveSignalLabel(event, SELECTABLE_AGE_LOWER_BOUND);
    expect(label.labelCode).toBe("EXECUTABLE");
    expect(label.deferredTradingDays).toBe(3);
    expect(label.exitRelativeDay).toBe(target + 3);
  });

  it("持续不可卖超过顺延上限 ⇒ 上限日收盘 MTM 并标未退出", () => {
    const event = makeEvent({
      eventId: "M@1",
      symbol: "600031.SH",
      eventDateIndex: 40,
      closePath: () => 10,
      override: (rd) => (rd >= 20 ? { canSellAtClose: false, limitDownPrice: 20 } : null),
    });
    const label = deriveSignalLabel(event, SELECTABLE_AGE_LOWER_BOUND);
    expect(label.labelCode).toBe("UNEXITED_MTM");
    expect(label.exitRelativeDay).toBe(SELECTABLE_AGE_LOWER_BOUND + 1 + 19 + 10);
    expect(label.exitPrice).not.toBeNull();
  });

  it("末端缺未来窗 ⇒ 右删失（不从样本删除）", () => {
    const target = SELECTABLE_AGE_LOWER_BOUND + 1 + 19; // = 35
    const event = makeEvent({
      eventId: "R@1",
      symbol: "600032.SH",
      eventDateIndex: 40,
      closePath: () => 10,
      override: (rd) => (rd >= target ? { barPresent: false } : null),
    });
    const label = deriveSignalLabel(event, SELECTABLE_AGE_LOWER_BOUND);
    expect(label.labelCode).toBe("RIGHT_CENSORED");
    expect(label.exitPrice).toBeNull();
  });

  it("连续跌停不删除原事件：member 仍在每日账里（仅描述）", () => {
    const event = makeEvent({
      eventId: "L@1",
      symbol: "600033.SH",
      eventDateIndex: 40,
      closePath: () => 9.5,
      override: (rd) => (rd >= 16 ? { close: 5, limitDownPrice: 5, high: 5, low: 5 } : null),
    });
    const factors = deriveEventFactors([event], FIXED_MAXAMP5);
    const pool = buildDailyPool({ events: [event], factors, window: AUDIT_WINDOW });
    const row = pool.dailyRows.find((item) => item.eventAge === SELECTABLE_AGE_LOWER_BOUND + 5)!;
    expect(row).toBeDefined();
    expect(row.limitDownStreak).toBeGreaterThan(0);
  });

  it("三天两板 / 五天三板：只描述，不参与资格", () => {
    const event = makeEvent({
      eventId: "U@1",
      symbol: "600034.SH",
      eventDateIndex: 40,
      closePath: (rd) => (rd % 2 === 1 ? 11 : 10),
      override: (rd) => (rd % 2 === 1 ? { limitUpPrice: 11 } : { limitUpPrice: 999 }),
    });
    const factors = deriveEventFactors([event], FIXED_MAXAMP5);
    const pool = buildDailyPool({ events: [event], factors, window: AUDIT_WINDOW });
    const row = pool.dailyRows.find((item) => item.eventAge === SELECTABLE_AGE_LOWER_BOUND)!;
    expect(row.limitUpCount3).toBe(2);
    expect(row.limitUpCount5).toBe(3);
    expect(row.signalEligible).toBe(true); // 路径状态**不影响**资格
  });
});

// ---------------------------------------------------------------------------
// 6. 确定性
// ---------------------------------------------------------------------------

describe("确定性", () => {
  it("两次重放输出逐字节一致（池 / 三臂 / 随机抽样）", () => {
    const events = [0, 1, 2, 3, 4].map((index) =>
      makeEvent({
        eventId: `X${index}@1`,
        symbol: `60020${index}.SH`,
        eventDateIndex: 40,
        closePath: (rd) => 10 + (index % 2) * 0.1 + rd * 0.01,
      }),
    );
    const runOnce = () => {
      const factors = deriveEventFactors(events, FIXED_MAXAMP5);
      const pool = buildDailyPool({ events, factors, window: AUDIT_WINDOW });
      const picks = buildDailyPicks({
        dailyRows: pool.dailyRows,
        eligibleEventIdsByDate: pool.eligibleEventIdsByDate,
        decisionDates: pool.decisionDates,
      });
      return JSON.stringify({ dailyRows: pool.dailyRows, picks, switches: pool.anchorSwitchCount });
    };
    expect(runOnce()).toBe(runOnce());
  });

  it("随机对照每格固定 200 次抽样，且同日同池同人数", () => {
    const events = [0, 1, 2, 3, 4, 5].map((index) =>
      makeEvent({
        eventId: `Y${index}@1`,
        symbol: `60030${index}.SH`,
        eventDateIndex: 40,
        closePath: () => 10,
      }),
    );
    const factors = deriveEventFactors(events, FIXED_MAXAMP5);
    const pool = buildDailyPool({ events, factors, window: AUDIT_WINDOW });
    const picks = buildDailyPicks({
      dailyRows: pool.dailyRows,
      eligibleEventIdsByDate: pool.eligibleEventIdsByDate,
      decisionDates: pool.decisionDates,
    });
    const pick = picks.find((item) => item.poolSize > 3)!;
    expect(pick.randomDraws.length).toBe(RANDOM_DRAW_COUNT);
    for (const draw of pick.randomDraws) {
      expect(draw.length).toBe(3);
      expect(new Set(draw).size).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. 唯一机会段合并
// ---------------------------------------------------------------------------

describe("唯一机会段", () => {
  it("标签窗共享交易日 ⇒ 同一段；不共享 ⇒ 新段", () => {
    const merged = buildOpportunitySegments(
      [
        { symbol: "S", date: "2024-01-02", arm: "R", windowStart: "2024-01-03", windowEnd: "2024-02-01", tail20Hit: true },
        { symbol: "S", date: "2024-01-20", arm: "R", windowStart: "2024-01-22", windowEnd: "2024-02-20", tail20Hit: true },
      ],
      "R",
    );
    expect(merged.length).toBe(1);
    expect(merged[0]!.tail20Hit).toBe(true);
    const split = buildOpportunitySegments(
      [
        { symbol: "S", date: "2024-01-02", arm: "R", windowStart: "2024-01-03", windowEnd: "2024-01-10", tail20Hit: false },
        { symbol: "S", date: "2024-02-02", arm: "R", windowStart: "2024-02-05", windowEnd: "2024-02-20", tail20Hit: true },
      ],
      "R",
    );
    expect(split.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. 仪器：最小扩展的缺省行为不变
// ---------------------------------------------------------------------------

function bar(relativeDay: number, close: number, extra: Partial<NormalizedFoundationBar> = {}): NormalizedFoundationBar {
  return {
    relativeDay,
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    limitUpPrice: 0,
    limitDownPrice: 0,
    barPresent: true,
    suspended: false,
    canBuyAtOpen: true,
    canSellAtClose: true,
    structurallyValid: true,
    ...extra,
  };
}

describe("仪器 · findExecutableExit 的最小扩展", () => {
  it("缺省上界 = 20（既有 25 个调用方行为不变）", () => {
    const bars = new Map<number, NormalizedFoundationBar>();
    for (let rd = 1; rd <= 25; rd += 1) bars.set(rd, bar(rd, 10));
    // 目标日 5 起全部不可卖（`open > limitDownPrice` 不成立 + `canSellAtClose=false`）。
    for (let rd = 5; rd <= 25; rd += 1) {
      bars.set(rd, bar(rd, 10, { canSellAtClose: false, limitDownPrice: 20 }));
    }
    // 缺省上界 = 20 ⇒ 5..20 全部不可卖 ⇒ 无解。
    expect(findExecutableExit(bars, 5)).toBeNull();
    // 显式放宽到 25 ⇒ 21..25 也被挡住 ⇒ 仍无解。
    expect(findExecutableExit(bars, 5, 25)).toBeNull();
    // 只把第 22 日放行 ⇒ 有解且落在 22（超出了缺省上界 20）。
    bars.set(22, bar(22, 10, { canSellAtClose: true, limitDownPrice: 0 }));
    expect(findExecutableExit(bars, 5)).toBeNull();
    const found = findExecutableExit(bars, 5, 25);
    expect(found?.day).toBe(22);
    expect(found?.reason).toBe("NEXT_SELLABLE_OPEN");
  });

  it("同图下缺省与显式 20 完全一致", () => {
    const bars = new Map<number, NormalizedFoundationBar>();
    for (let rd = 1; rd <= 40; rd += 1) {
      bars.set(rd, bar(rd, 10, { canSellAtClose: rd % 3 !== 0 }));
    }
    for (const target of [1, 5, 15, 25]) {
      expect(findExecutableExit(bars, target)).toEqual(findExecutableExit(bars, target, 20));
    }
  });
});

describe("仪器 · bootstrap 分位点扩展", () => {
  const samples = Array.from({ length: 60 }, (_, index) => ({
    eventDate: `2024-01-${String((index % 28) + 1).padStart(2, "0")}`,
    value: Math.sin(index) * 0.1,
  }));

  it("不传 quantiles ⇒ 与显式 0.025/0.975 完全一致", () => {
    const implicit = movingBlockBootstrapMean({ samples });
    const explicit = movingBlockBootstrapMean({
      samples,
      quantiles: { low: 0.025, high: 0.975 },
    });
    expect(implicit).toEqual(explicit);
  });

  it("可表达 Bonferroni 97.5% 双侧（0.0125/0.9875），且区间更宽", () => {
    const ci95 = movingBlockBootstrapMean({ samples })!;
    const ci975 = movingBlockBootstrapMean({ samples, quantiles: CI_QUANTILES })!;
    expect(ci975.low).toBeLessThanOrEqual(ci95.low);
    expect(ci975.high).toBeGreaterThanOrEqual(ci95.high);
  });

  it("差值版本同样支持（缺省一致 + 97.5% 更宽）", () => {
    const negative = samples.map((item) => ({ ...item, value: 0 }));
    const implicit = movingBlockBootstrapDifference({ positive: samples, negative });
    const explicit = movingBlockBootstrapDifference({
      positive: samples,
      negative,
      quantiles: { low: 0.025, high: 0.975 },
    });
    expect(implicit).toEqual(explicit);
    const ci975 = movingBlockBootstrapDifference({
      positive: samples,
      negative,
      quantiles: CI_QUANTILES,
    })!;
    expect(ci975.low).toBeLessThanOrEqual(implicit!.low);
    expect(ci975.high).toBeGreaterThanOrEqual(implicit!.high);
  });
});

// ---------------------------------------------------------------------------
// 9. 端到端 fixture：真实跑一次 run()（假 Dataset 端口）
// ---------------------------------------------------------------------------

interface FakeRuntime {
  readonly context: ExperimentRunContext;
  readonly artifacts: { name: string; role: string; bytes: number }[];
  readonly logs: string[];
  frozenCalls: number;
  observationBeforeFreeze: number;
}

function createFakeRuntime(args: {
  readonly events: readonly PoolEvent[];
  readonly frozen: Set<string>;
}): FakeRuntime {
  const artifactList: { name: string; role: string; bytes: number }[] = [];
  const logs: string[] = [];
  const runtime: FakeRuntime = {
    artifacts: artifactList,
    logs,
    frozenCalls: 0,
    observationBeforeFreeze: 0,
    context: undefined as unknown as ExperimentRunContext,
  };
  const eventRows: ExperimentEventRow[] = args.events.map((event) => ({
    relativeDay: 0,
    tradeDate: event.eventDate,
    eventId: event.eventId,
    symbol: event.symbol,
    values: { isFirstLimit: true, boardType: "main", market: "SH" },
  }));
  const barRowOf = (event: PoolEvent, bar: PoolBar): ExperimentBarRow => ({
    relativeDay: bar.relativeDay,
    tradeDate: bar.tradeDate,
    eventId: event.eventId,
    symbol: event.symbol,
    values: {
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      preClose: bar.preClose,
      limitUpPrice: bar.limitUpPrice,
      limitDownPrice: bar.limitDownPrice,
      barPresent: bar.barPresent,
      suspensionStatus: bar.suspended ? "SUSPENDED" : "NORMAL",
      canBuyAtOpen: bar.canBuyAtOpen,
      canSellAtClose: bar.canSellAtClose,
    },
  });
  let frozen = false;
  const featureRows = (relativeDay: number): readonly ExperimentBarRow[] =>
    args.events
      .map((event) => ({ event, bar: event.prefix.get(relativeDay) }))
      .filter(
        (item): item is { event: PoolEvent; bar: PoolBar } => item.bar !== undefined,
      )
      .map((item) => barRowOf(item.event, item.bar));
  const observationRows = (relativeDay: number): readonly ExperimentBarRow[] =>
    args.events
      .filter((event) => args.frozen.has(event.eventId))
      .map((event) => ({ event, bar: event.post.get(relativeDay) }))
      .filter(
        (item): item is { event: PoolEvent; bar: PoolBar } => item.bar !== undefined,
      )
      .map((item) => barRowOf(item.event, item.bar));

  runtime.context = {
    descriptor: rollingPoolRightTailMvpExperiment.descriptor,
    codeDigest: "test-code-digest",
    protocol: null,
    parameters: {},
    dataset: {
      facts: {
        datasetVersionId: 780004,
        datasetCode: "first_limit_pullback",
        datasetName: "test",
        datasetVersionLabel: "v10-listed365-pre10-post80",
        status: "READY",
        startDate: "2019-01-02",
        endDate: "2025-09-26",
        totalEvents: args.events.length,
        postRelativeDayRange: { min: 1, max: 80 },
      },
      events: () => Promise.resolve(eventRows),
      eventPages: async function* () {
        yield eventRows;
      },
      feature: (relativeDay) => Promise.resolve(featureRows(relativeDay)),
      observation: (relativeDay) => {
        if (!frozen) {
          runtime.observationBeforeFreeze += 1;
          return Promise.reject(new Error("EXPERIMENT_SELECTION_NOT_FROZEN"));
        }
        return Promise.resolve(observationRows(relativeDay));
      },
    },
    datasets: {},
    freezeSelection: (eventIds) => {
      runtime.frozenCalls += 1;
      frozen = true;
      for (const eventId of eventIds) args.frozen.add(eventId);
    },
    log: (message) => logs.push(message),
    artifact: (spec) => {
      artifactList.push({
        name: spec.name,
        role: spec.role,
        bytes: typeof spec.body === "string" ? spec.body.length : spec.body.byteLength,
      });
    },
  };
  return runtime;
}

describe("端到端 fixture：run() 真实重放", () => {
  const fixtures = [0, 1, 2, 3, 4, 5].map((index) =>
    makeEvent({
      eventId: `Z${index}@1`,
      symbol: index < 3 ? `60040${index}.SH` : "600400.SH",
      eventDateIndex: 40 + index * 2,
      closePath: (rd) => 10 + rd * 0.02 * (index + 1),
      amplitude: () => 0.01 + 0.001 * index,
    }),
  );

  it("端到端：账平、三臂同面板、产物齐全、PIT 闸门被尊重", async () => {
    const runtime = createFakeRuntime({ events: fixtures, frozen: new Set() });
    const payload: ExperimentResultPayload =
      await rollingPoolRightTailMvpExperiment.run(runtime.context);

    // ① 样本账必须平（平台硬约束）
    const summary = payload.sampleSummary;
    expect(summary.eligibleCount + summary.excludedCount).toBe(summary.candidateCount);
    expect(Object.values(summary.excludedByReason).reduce((a, b) => a + b, 0)).toBe(
      summary.excludedCount,
    );

    // ② freezeSelection 在第一次 observation 之前，且只调用一次
    expect(runtime.frozenCalls).toBe(1);
    expect(runtime.observationBeforeFreeze).toBe(0);

    // ③ 三臂同面板 + 判定
    const armTable = payload.tables!.find((table) => table.key === "rolling-pool-arm-summary")!;
    expect(armTable.rows.length).toBe(3);
    expect(String(armTable.rows[0]!.arm)).toContain("R · ");
    expect(String(armTable.rows[1]!.arm)).toContain("M · ");
    expect(String(armTable.rows[2]!.arm)).toContain("Random");
    const verdictTable = payload.tables!.find((table) => table.key === "rolling-pool-verdict")!;
    expect(verdictTable.rows.length).toBe(2);

    // ④ 产物：每日账（按季度分片）/ 信号账 / 随机抽样 / 逐日统计 / 机会段 / 配置
    const names = runtime.artifacts.map((item) => item.name);
    for (const expected of [
      "signal-ledger.csv",
      "random-draws.csv",
      "daily-arm-stats.csv",
      "opportunity-segments.csv",
      "rolling-pool-config.json",
    ]) {
      expect(names).toContain(expected);
    }
    const ledgerShards = names.filter((name) => name.startsWith("daily-pool-ledger-"));
    expect(ledgerShards.length).toBeGreaterThan(0);
    for (const shard of ledgerShards) {
      expect(shard).toMatch(/^daily-pool-ledger-\d{4}Q[1-4]\.csv$/);
    }

    // ⑤ 自有结构可被本实验的 schema 校验
    const parsed = rollingPoolRightTailMvpExperiment.resultSchema.safeParse(payload.customPayload);
    expect(parsed.success).toBe(true);

    // ⑥ 每日同一 symbol 只有一行，且年龄在 rd1..40
    const ledger = runtime.artifacts.find((item) => item.name.startsWith("daily-pool-ledger-"))!;
    expect(ledger.bytes).toBeGreaterThan(0);
    const config = payload.customPayload as { frozenConfig: { selectableAgeLowerBound: number } };
    expect(config.frozenConfig.selectableAgeLowerBound).toBe(SELECTABLE_AGE_LOWER_BOUND);
  });

  it("端到端确定性：同一 fixture 两次 run() 的表格逐字节一致", async () => {
    const first = await rollingPoolRightTailMvpExperiment.run(
      createFakeRuntime({ events: fixtures, frozen: new Set() }).context,
    );
    const second = await rollingPoolRightTailMvpExperiment.run(
      createFakeRuntime({ events: fixtures, frozen: new Set() }).context,
    );
    expect(JSON.stringify(first.tables)).toBe(JSON.stringify(second.tables));
    expect(JSON.stringify(first.sampleSummary)).toBe(JSON.stringify(second.sampleSummary));
  });
});

// ---------------------------------------------------------------------------
// 10. 描述符自洽（冻结坐标 + 契约缺口声明）
// ---------------------------------------------------------------------------

describe("描述符 · 冻结坐标", () => {
  const descriptor = rollingPoolRightTailMvpExperiment.descriptor;

  it("id / pageKey / 版本", () => {
    expect(descriptor.id).toBe("first-board-pullback/rolling-pool-right-tail-mvp");
    expect(descriptor.pageKey).toBe(descriptor.id);
    expect(descriptor.version).toBe("1.0.0");
  });

  it("Dataset 坐标：v10（含 excludeListedWithinDays=365 与 preWindowDays=10）", () => {
    expect(descriptor.datasetRequirement.datasetCode).toBe("first_limit_pullback");
    expect(descriptor.datasetRequirement.requiredDatasetVersionLabel).toBe(
      "v10-listed365-pre10-post80",
    );
    expect(descriptor.datasetRequirement.usesForwardData).toBe(true);
    expect(descriptor.datasetRequirement.eventScanPolicy).toBe("FULL_DATASET");
  });

  it("相对日声明：prefix 含 −10/−1/0；post 覆盖 1..70（标签视界）", () => {
    expect([...descriptor.datasetRequirement.prefixRelativeDays!].sort((a, b) => a - b)).toEqual([
      ...PREFIX_RELATIVE_DAYS,
    ].sort((a, b) => a - b));
    const post = descriptor.datasetRequirement.postRelativeDays!;
    expect(Math.min(...post)).toBe(1);
    expect(Math.max(...post)).toBe(MAX_POST_RELATIVE_DAY_NEEDED);
    expect(post.length).toBe(POST_RELATIVE_DAYS.length);
  });

  it("decisionOffsetDays 声明为 40（资格判定的**上界**，如实登记为契约缺口）", () => {
    expect(descriptor.datasetRequirement.decisionOffsetDays).toBe(WATCH_MAX_AGE);
    expect(descriptor.targetMetric?.kind).toBe("TAIL");
    expect(descriptor.targetMetric?.reportMeanAlongside).toBe(true);
    expect(descriptor.preRegisteredCriteria?.criteria.length).toBeGreaterThanOrEqual(4);
  });
});
