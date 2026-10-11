/**
 * EVENT-STATE-LONG-EXECUTION-PARITY-001 · 执行尾窗（`exitTailTradingDays`）契约测试。
 *
 * 背景：事件窗投影此前把「决策窗口」与「执行行情覆盖」绑在同一个 `{start,end}` 上，
 * 面板/游标只到 `rd = end + 1` ⇒ 40 交易日持有在正式链路上**结构性不可能**。
 * 本测试锁住解耦后的两条硬边界：
 *   1. **尾窗只扩大行情覆盖**（`rd ≤ end + 1 + tail`），持仓期能取到可撮合行情；
 *   2. **决策成员范围不变**（仍严格 `rd ∈ [start,end]`），且决策日可见 bar 不含未来数据
 *      ⇒ 尾窗**不可能**让后续 bar 参与决策。
 * 并锁住「缺省 0 ⇒ 既有行为逐字节不变」这一回归保证。
 */

import { describe, expect, it } from "vitest";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";
import {
  createEventWindowDatasetCursor,
  estimateEventWindowPanelRowsUpperBound,
} from "../../../server/runWorkbenchAssembly/datasetFromRegistry";
import { clampEventWindowExitTailTradingDays, resolveEventWindowExitTailTradingDays } from "../../../server/runWorkbenchAssembly/assemble";

/** 30 个合成交易日（够覆盖 rd0..21 与「再往后为空」的断言）。 */
const DATES = Array.from(
  { length: 30 },
  (_, i) => `2025-04-${String(i + 1).padStart(2, "0")}`,
);

const EVENT_WINDOW = { start: 15, end: 15, unit: "TRADING_DAY" } as const;

function makeEvent(eventId: string, index: number, symbol = "600000.SH"): FirstLimitPullbackEvent {
  return {
    datasetVersionId: 1,
    eventId,
    symbol,
    tradeDate: DATES[index]!,
    market: "SH",
    previousClose: 9.5,
    limitUpPrice: 10.45,
    limitDownPrice: 8.55,
    isFirstLimit: true,
  } as unknown as FirstLimitPullbackEvent;
}

function barsFor(event: FirstLimitPullbackEvent): {
  prefix: FirstLimitPullbackRawBar;
  post: FirstLimitPullbackRawBar[];
} {
  const start = DATES.indexOf(event.tradeDate);
  const prefix = {
    datasetVersionId: 1,
    eventId: event.eventId,
    symbol: event.symbol,
    tradeDate: event.tradeDate,
    relativeDay: 0,
    open: 10,
    high: 10.45,
    low: 9.9,
    close: 10.45,
    preClose: 9.5,
    volume: 1000,
    amount: 10_000,
  } as unknown as FirstLimitPullbackRawBar;
  const post: FirstLimitPullbackRawBar[] = [];
  for (let rd = 1; start + rd < DATES.length; rd += 1) {
    post.push({
      datasetVersionId: 1,
      eventId: event.eventId,
      symbol: event.symbol,
      tradeDate: DATES[start + rd]!,
      relativeDay: rd,
      open: 10 + rd,
      high: 10.5 + rd,
      low: 9.5 + rd,
      close: 10.2 + rd,
      preClose: 10 + rd,
      volume: 900,
      amount: 9000,
    } as unknown as FirstLimitPullbackRawBar);
  }
  return { prefix, post };
}

function makeCursor(options: {
  events: readonly FirstLimitPullbackEvent[];
  exitTailTradingDays?: number;
}) {
  const bars = new Map(options.events.map((e) => [e.eventId, barsFor(e)] as const));
  const identity = new Map(options.events.map((e) => [e.eventId, `sec_${e.symbol}`] as const));
  const cursor = createEventWindowDatasetCursor({
    reader: {
      loadPrefixBars: async (eventIds: readonly string[]) =>
        eventIds.map((eventId) => bars.get(eventId)!.prefix),
      loadPostBars: async (eventIds: readonly string[], relativeDays: readonly number[]) =>
        eventIds.flatMap((eventId) =>
          bars.get(eventId)!.post.filter((bar) => relativeDays.includes(bar.relativeDay)),
        ),
    },
    events: options.events,
    identityByEventId: identity,
    datasetVersion: "v-test",
    datasetGate: "PASS",
    tradingDates: DATES,
    observationWindow: EVENT_WINDOW,
    ...(options.exitTailTradingDays === undefined
      ? {}
      : { exitTailTradingDays: options.exitTailTradingDays }),
  });
  return cursor;
}

const PANEL_ID = "sec_600000.SH::event:E1";

describe("执行尾窗 · 缺省 0 时既有行为不变", () => {
  it("覆盖只到 rd = end + 1，决策成员只在 rd=end", async () => {
    const cursor = makeCursor({ events: [makeEvent("E1", 0)] });

    const day0 = await cursor.getDaySlice(DATES[0]!);
    expect(day0.members).toEqual([]);
    expect(day0.executionBars.has(PANEL_ID)).toBe(true);

    const decisionDay = await cursor.getDaySlice(DATES[15]!);
    expect(decisionDay.members).toEqual([PANEL_ID]);
    // rd15 决策时可见 bar 恰为 rd0..15（PIT：不含任何未来 bar）。
    expect(decisionDay.visibleBars.get(PANEL_ID)?.length).toBe(16);

    // rd16 = end+1（决策日下一交易日）：仍有行（入场成交依据），但不是决策成员。
    const entryDay = await cursor.getDaySlice(DATES[16]!);
    expect(entryDay.rows.length).toBe(1);
    expect(entryDay.members).toEqual([]);
    expect(cursor.stats?.().retiredMemberCount).toBe(1);

    // rd17：成员已释放 ⇒ 无行（= 既有行为：没有持仓期行情）。
    const after = await cursor.getDaySlice(DATES[17]!);
    expect(after.rows).toEqual([]);
  });
});

describe("执行尾窗 · 只扩大行情覆盖，不改变决策", () => {
  it("tail=5 ⇒ 行覆盖到 rd = end + 1 + 5，决策成员仍只在 rd=end", async () => {
    const cursor = makeCursor({ events: [makeEvent("E1", 0)], exitTailTradingDays: 5 });

    const decisionDay = await cursor.getDaySlice(DATES[15]!);
    expect(decisionDay.members).toEqual([PANEL_ID]);
    expect(decisionDay.visibleBars.get(PANEL_ID)?.length).toBe(16);

    // rd16..rd21 逐日仍有行与可撮合行情（持仓期可定价/可退出）。
    for (const rd of [16, 18, 20, 21]) {
      const day = await cursor.getDaySlice(DATES[rd]!);
      expect(day.rows.length, `rd=${rd}`).toBe(1);
      expect(day.members, `rd=${rd}`).toEqual([]);
      expect(day.executionBars.has(PANEL_ID), `rd=${rd}`).toBe(true);
      expect(day.visibleBars.has(PANEL_ID), `rd=${rd}`).toBe(false);
    }
    expect(cursor.stats?.().retiredMemberCount).toBe(1);

    // rd22 起无行（尾窗边界精确）。
    const after = await cursor.getDaySlice(DATES[22]!);
    expect(after.rows).toEqual([]);
  });

  it("尾窗不改变决策日可见 bar（结构上不可能让后续 bar 参与决策）", async () => {
    const noTail = makeCursor({ events: [makeEvent("E1", 0)] });
    const withTail = makeCursor({ events: [makeEvent("E1", 0)], exitTailTradingDays: 60 });
    const a = await noTail.getDaySlice(DATES[15]!);
    const b = await withTail.getDaySlice(DATES[15]!);
    const barsA = a.visibleBars.get(PANEL_ID)!;
    const barsB = b.visibleBars.get(PANEL_ID)!;
    expect(barsB.length).toBe(barsA.length);
    expect(barsB.map((bar) => bar.timestamp)).toEqual(barsA.map((bar) => bar.timestamp));
  });
});

describe("执行尾窗 · 由已声明的出场政策派生（缺省 0）", () => {
  function requestWith(exitRules: readonly unknown[] | null, pooled = false) {
    return {
      strategyId: "s",
      strategyVersion: "1.0.0",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      strategyDocument: {
        strategyId: "s",
        version: "1.0.0",
        recipe: {
          kind: "signalEngine",
          recipeId: "event-state-long-amp5-top3",
          point: "close",
          signalFrequency: "daily",
          signalDescription: "x",
          featureVersions: [{ featureId: "maxAmp5", version: "1.0.0" }],
          rankingConfig: { higherIsBetter: false },
          selectionConfig: { method: { kind: "topN", n: 3 } },
          requiredData: ["OHLCV"],
        },
        parameters: { parameters: [] },
        definition: {
          ...(pooled ? { firstLimitPool: { poolPolicyId: "p" } } : {}),
          exit: { rules: exitRules ?? [] },
        },
      },
    } as never;
  }

  it("TIME_EXIT 40 TRADING_DAY ⇒ 尾窗 = 40 + 20（顺延缓冲）", () => {
    expect(
      resolveEventWindowExitTailTradingDays(
        requestWith([
          {
            id: "exit-time-40",
            type: "TIME_EXIT",
            trigger: "ON_CLOSE",
            enabled: true,
            threshold: 40,
            thresholdUnit: "TRADING_DAY",
          },
        ]),
      ),
    ).toBe(60);
  });

  it("无 TIME_EXIT ⇒ 0（不改变任何既有策略的行情覆盖）", () => {
    expect(resolveEventWindowExitTailTradingDays(requestWith([]))).toBe(0);
    expect(
      resolveEventWindowExitTailTradingDays(
        requestWith([
          {
            id: "sl",
            type: "STOP_LOSS",
            trigger: "INTRADAY",
            enabled: true,
            threshold: 5,
            thresholdUnit: "PERCENT",
          },
        ]),
      ),
    ).toBe(0);
  });

  /**
   * 🔴 回归锁（EVENT-STATE-LONG-STRONG-HOLD-001）：统一 `policy` 形式的退出**必须**也被认出来。
   * 旧实现的便宜筛选只认 `rule.thresholdUnit === "TRADING_DAY"`，而带 `policy` 的规则
   * **不得**声明 `threshold` / `thresholdUnit`（`definitionValidation.ts` 明确禁止两者并存）
   * ⇒ policy 形式的策略静默拿到尾窗 0 ⇒ 退回物化路径 ⇒ 区间超出数据集事件窗时被守卫拒绝
   * （实测 C 臂失败：`实验日期范围 [2019-01-03, 2026-01-28] 超出数据集窗口 [2019-01-02, 2025-09-26]`）。
   */
  it("统一 policy 的 timeExit 40 ⇒ 尾窗 = 40 + 20（policy 形式必须与 rule-list 等价）", () => {
    expect(
      resolveEventWindowExitTailTradingDays(
        requestWith([
          {
            id: "exit-unified-policy",
            type: "TIME_EXIT",
            trigger: "ON_CLOSE",
            enabled: true,
            priority: 0,
            policy: {
              stop: { anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 }, confirmation: "INTRADAY" },
              takeProfit: null,
              timeExit: { kind: "FIXED_HOLDING_DAYS", holdingDays: 40 },
              strongHold: null,
              capitalRecycle: null,
            },
          },
        ]),
      ),
    ).toBe(60);
  });

  it("policy + strongHold 40→60 ⇒ 尾窗按**有效最长持有期** 60 派生 = 80", () => {
    expect(
      resolveEventWindowExitTailTradingDays(
        requestWith([
          {
            id: "exit-unified-policy",
            type: "TIME_EXIT",
            trigger: "ON_CLOSE",
            enabled: true,
            priority: 0,
            policy: {
              stop: { anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 }, confirmation: "INTRADAY" },
              takeProfit: null,
              timeExit: { kind: "FIXED_HOLDING_DAYS", holdingDays: 40 },
              strongHold: {
                atHoldingDays: 40,
                minReturnRatio: 0.03,
                requireAboveMa5: true,
                requireAboveMa10: true,
                extendToHoldingDays: 60,
                afterExtendedHold: "TIME_EXIT",
              },
              capitalRecycle: null,
            },
          },
        ]),
      ),
    ).toBe(80);
  });

  it("strongHold 延长超过 timeExit ⇒ 取两者较大者（runnerExitAtHoldingDays 也计入）", () => {
    const withPolicy = (timeExitDays: number, extendTo: number, runnerExit: number | null) =>
      resolveEventWindowExitTailTradingDays(
        requestWith([
          {
            id: "exit-unified-policy",
            type: "TIME_EXIT",
            trigger: "ON_CLOSE",
            enabled: true,
            priority: 0,
            policy: {
              stop: { anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 }, confirmation: "INTRADAY" },
              takeProfit: null,
              timeExit: { kind: "FIXED_HOLDING_DAYS", holdingDays: timeExitDays },
              strongHold: {
                atHoldingDays: 5,
                minReturnRatio: 0.03,
                requireAboveMa5: true,
                requireAboveMa10: true,
                extendToHoldingDays: extendTo,
                afterExtendedHold: "TIME_EXIT",
                runnerExitAtHoldingDays: runnerExit,
              },
              capitalRecycle: null,
            },
          },
        ]),
      );
    // timeExit 5 但 strongHold 延到 60 ⇒ 60 + 20
    expect(withPolicy(5, 60, null)).toBe(80);
    // runnerExitAtHoldingDays 80 比 extendTo 60 更远 ⇒ 80 + 20
    expect(withPolicy(5, 60, 80)).toBe(100);
    // 未启用（enabled=false）⇒ 0
    expect(
      resolveEventWindowExitTailTradingDays(
        requestWith([
          {
            id: "exit-unified-policy",
            type: "TIME_EXIT",
            trigger: "ON_CLOSE",
            enabled: false,
            priority: 0,
            policy: {
              stop: { anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 }, confirmation: "INTRADAY" },
              takeProfit: null,
              timeExit: { kind: "FIXED_HOLDING_DAYS", holdingDays: 40 },
              strongHold: null,
              capitalRecycle: null,
            },
          },
        ]),
      ),
    ).toBe(0);
  });

  it("池化策略有自己的退出尾部 ⇒ 事件窗尾窗为 0（不叠加两套口径）", () => {
    expect(
      resolveEventWindowExitTailTradingDays(
        requestWith(
          [
            {
              id: "exit-time-40",
              type: "TIME_EXIT",
              trigger: "ON_CLOSE",
              enabled: true,
              threshold: 40,
              thresholdUnit: "TRADING_DAY",
            },
          ],
          true,
        ),
      ),
    ).toBe(0);
  });
});

describe("执行尾窗 · 夹取到数据集 post 上限（不静默）", () => {
  it("派生 80 + post 上限 80 + end 15 ⇒ 夹取到 64（覆盖恰好 rd=80）", () => {
    expect(clampEventWindowExitTailTradingDays(80, 15, 80)).toBe(64);
  });

  it("派生值未超上限 ⇒ 原样返回（既有行为不变）", () => {
    expect(clampEventWindowExitTailTradingDays(60, 15, 80)).toBe(60);
    expect(clampEventWindowExitTailTradingDays(64, 15, 80)).toBe(64);
  });

  it("post 上限未知 / 观察窗末端未知 ⇒ 不夹取（保持既有行为）", () => {
    expect(clampEventWindowExitTailTradingDays(80, 15, null)).toBe(80);
    expect(clampEventWindowExitTailTradingDays(80, null, 80)).toBe(80);
  });

  it("派生 0 ⇒ 0（无时间退出时不追加行情覆盖）", () => {
    expect(clampEventWindowExitTailTradingDays(0, 15, 80)).toBe(0);
  });

  it("数据集连入场那一根都覆盖不到 ⇒ 0（交给既有守卫响亮拒绝，不在此静默追加）", () => {
    expect(clampEventWindowExitTailTradingDays(80, 15, 16)).toBe(0);
    expect(clampEventWindowExitTailTradingDays(80, 15, 15)).toBe(0);
  });
});

describe("执行尾窗 · 行数上界估计必须与真实投影一致", () => {
  it("tail 计入上界（否则会低估行数而错误地走材料化路径）", async () => {
    const version = { totalEvents: 1000, id: 7 } as never;
    const deps = {
      // 只提供元数据读者：本函数只读 totalEvents。
      metadataReader: {
        getVersionById: async () => version,
      } as never,
    };
    const base = await estimateEventWindowPanelRowsUpperBound(7, EVENT_WINDOW, deps);
    const withTail = await estimateEventWindowPanelRowsUpperBound(7, EVENT_WINDOW, deps, 60);
    expect(base).toBe(1000 * (15 + 2));
    expect(withTail).toBe(1000 * (15 + 2 + 60));
  });
});
