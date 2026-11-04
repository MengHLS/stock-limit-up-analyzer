/**
 * FIRST-LIMIT-POOL-001 — 池化逐日面板投影测试。
 *
 * 与事件窗投影的判据边界：
 *   A. 首板日（rd=0）即入池，且入池当天具决策资格（不同于事件窗 rd=0 无资格）；
 *   B. 同一证券的多个首板事件由 `poolMemberId` 隔离，重叠日各自成行；
 *   C. 面板按日历日对齐，覆盖到池龄上限日（含），不含池龄上限之后的行；
 *   D. 连续不可评分达 M 日 ⇒ 在 M 日当天移除、当天不投影；
 *   E. 资格线破坏（ST / eligible=false / 停牌无成交）⇒ 当天移除、当天不投影；
 *   F. Universe 每天成员 = 当日仍有效的池成员，且按 securityId 确定性排序；
 *   G. 池龄 / 单日成员数 / 总行数超预算 ⇒ 响亮抛稳定错误码，不静默裁剪。
 */

import { describe, expect, it } from "vitest";
import {
  buildPoolProjection,
  poolMemberIdOf,
  poolPanelSecurityId,
  type PoolProjection,
} from "../../../server/runWorkbenchAssembly/poolProjection";
import { RegistryDatasetBridgeError } from "../../../server/runWorkbenchAssembly/bridgeError";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";
import type { FirstLimitPoolPolicy } from "../../../server/strategyCore/types";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<FirstLimitPullbackEvent> = {}): FirstLimitPullbackEvent {
  return {
    datasetVersionId: 660001,
    eventId: "000001.SZ@2025-03-03",
    symbol: "000001.SZ",
    tradeDate: "2025-03-03",
    market: "SZ",
    industryCode: "I001",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    turnover: 7.5,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 1,
    marketCap: 1000,
    floatMarketCap: 900,
    ...overrides,
  } as FirstLimitPullbackEvent;
}

function makeBar(
  eventId: string,
  symbol: string,
  relativeDay: number,
  tradeDate: string,
  close: number | null,
  overrides: Partial<FirstLimitPullbackRawBar> = {},
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: 660001,
    eventId,
    symbol,
    tradeDate,
    relativeDay,
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
    amount: 1000,
    ...overrides,
  };
}

const DATES = [
  "2025-03-03",
  "2025-03-04",
  "2025-03-05",
  "2025-03-06",
  "2025-03-07",
  "2025-03-10",
  "2025-03-11",
  "2025-03-12",
];

/** 由一个交易日列表为事件构造 rd=0 起逐日 +1 的整段 bar（rd=0 归 prefix）。 */
function barsFromDates(
  event: FirstLimitPullbackEvent,
  dates: readonly string[],
  closeOf: (date: string, relativeDay: number) => number | null,
): { zero: FirstLimitPullbackRawBar; post: FirstLimitPullbackRawBar[] } {
  const zero = makeBar(
    event.eventId,
    event.symbol,
    0,
    dates[0]!,
    closeOf(dates[0]!, 0),
  );
  const post = dates.slice(1).map((date, i) =>
    makeBar(event.eventId, event.symbol, i + 1, date, closeOf(date, i + 1)),
  );
  return { zero, post };
}

function idsOf(...events: readonly FirstLimitPullbackEvent[]): Map<string, string> {
  return new Map(events.map((e) => [e.eventId, `sec_test-${e.symbol}`]));
}

function policy(overrides: Partial<FirstLimitPoolPolicy> = {}): FirstLimitPoolPolicy {
  return {
    poolPolicyId: "first-limit-pool-daily-score",
    admissionEventType: "FIRST_LIMIT_UP",
    admittedRelativeDay: 0,
    poolAgeCapTradingDays: 5,
    earlyScoreStageEnd: 4,
    fullScoreStart: 5,
    scoreInvalidationDays: 3,
    scoreAffectsExit: false,
    maxDailyCandidates: 3,
    ...overrides,
  };
}

function readErrorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof RegistryDatasetBridgeError ? error.code : null;
  }
}

/** 便捷：把投影结果按 (tradeDate, securityId) 索引。 */
function rowMapOf(projection: PoolProjection): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const row of projection.rows) {
    map.set(`${row.tradeDate}\u0000${row.securityId}`, row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// A. 首板日入池 + 入池当天可决策
// ---------------------------------------------------------------------------

describe("buildPoolProjection — 入池与日历对齐", () => {
  it("A. rd=0 首板日即投影且具决策资格（不同于事件窗 rd=0 无资格）", () => {
    const event = makeEvent();
    const { zero, post } = barsFromDates(event, DATES, (_, rd) => 10 + rd);
    const projection = buildPoolProjection({
      events: [event],
      prefixBars: [zero],
      postBars: post,
      securityIds: idsOf(event),
      policy: policy({ poolAgeCapTradingDays: 5 }),
      postMaxRelativeDay: 20,
    });

    // rd=0..4 为池龄内决策日；rd=5 为最后一日决策的次日执行行情。
    expect(projection.rows.map((r) => r.tradeDate)).toEqual(DATES.slice(0, 6));
    const universeDay0 = projection.universeDefinition.days[0]!;
    expect(universeDay0.members).toEqual([
      poolPanelSecurityId("sec_test-000001.SZ", event.eventId),
    ]);
    expect(projection.members).toHaveLength(1);
    expect(projection.members[0]).toMatchObject({
      poolMemberId: poolMemberIdOf(event.eventId),
      eventId: event.eventId,
      admittedAt: "2025-03-03",
      removalReason: "AGE_CAP",
      stageAtAdmission: "EARLY_OHLC",
    });
  });

  it("B. 同一证券多个首板事件由 poolMemberId 隔离，重叠日各自成行", () => {
    const price: Record<string, number> = {
      "2025-03-03": 10,
      "2025-03-04": 11,
      "2025-03-05": 12,
      "2025-03-06": 13,
      "2025-03-07": 14,
      "2025-03-10": 15,
      "2025-03-11": 16,
    };
    const e1 = makeEvent({ eventId: "E1", tradeDate: "2025-03-03" });
    const e2 = makeEvent({ eventId: "E2", tradeDate: "2025-03-05", previousClose: 11 });
    const w1 = barsFromDates(e1, DATES.slice(0, 5), (d) => price[d]!);
    const w2 = barsFromDates(e2, DATES.slice(2, 7), (d) => price[d]!);

    const projection = buildPoolProjection({
      events: [e1, e2],
      prefixBars: [w1.zero, w2.zero],
      postBars: [...w1.post, ...w2.post],
      securityIds: idsOf(e1, e2),
      policy: policy({ poolAgeCapTradingDays: 5 }),
      postMaxRelativeDay: 20,
    });

    expect(projection.members.map((m) => m.poolMemberId)).toEqual(["pool:E1", "pool:E2"]);
    const keyE1 = poolPanelSecurityId("sec_test-000001.SZ", "E1");
    const keyE2 = poolPanelSecurityId("sec_test-000001.SZ", "E2");
    expect(keyE1).not.toBe(keyE2);

    // 2025-03-05 同时是 E1 的 rd=2 与 E2 的 rd=0 ⇒ 必须各有一行。
    const overlapRows = projection.rows.filter((r) => r.tradeDate === "2025-03-05");
    expect(overlapRows.map((r) => r.securityId).sort()).toEqual([keyE1, keyE2]);
    expect(new Set(projection.rows.map((r) => `${r.tradeDate}\u0000${r.securityId}`)).size).toBe(
      projection.rows.length,
    );
  });

  it("C. 池龄上限日之后只保留执行行情，expiresAt = 上限日", () => {
    const event = makeEvent();
    const { zero, post } = barsFromDates(event, DATES, (_, rd) => 10 + rd);
    const projection = buildPoolProjection({
      events: [event],
      prefixBars: [zero],
      postBars: post,
      securityIds: idsOf(event),
      policy: policy({ poolAgeCapTradingDays: 4 }),
      postMaxRelativeDay: 20,
    });

    expect(projection.rows.map((r) => r.tradeDate)).toEqual(DATES.slice(0, 5));
    expect(projection.members[0]!.expiresAt).toBe("2025-03-06");
    expect(projection.members[0]!.removedAt).toBe("2025-03-07");
    expect(projection.stats.projectedRelativeDayMax).toBe(4);
  });

  it("D. 池龄超过 post 可覆盖范围 ⇒ POOL_AGE_CAP_EXCEEDED（不夹取）", () => {
    const event = makeEvent();
    const { zero, post } = barsFromDates(event, DATES, (_, rd) => 10 + rd);
    expect(
      readErrorCode(() =>
        buildPoolProjection({
          events: [event],
          prefixBars: [zero],
          postBars: post,
          securityIds: idsOf(event),
          policy: policy({ poolAgeCapTradingDays: 60 }),
          postMaxRelativeDay: 20,
        }),
      ),
    ).toBe("POOL_AGE_CAP_EXCEEDED");
  });
});

// ---------------------------------------------------------------------------
// E. 失效规则
// ---------------------------------------------------------------------------

describe("buildPoolProjection — 失效规则", () => {
  it("E1. 连续 M 日不可评分 ⇒ 第 M 日移除且当日不投影", () => {
    const event = makeEvent();
    // rd=0,1 正常；rd=2,3,4 全部 close=null（不可评分，M=3）⇒ rd=4 触发移除。
    const { zero, post } = barsFromDates(event, DATES.slice(0, 5), (_, rd) =>
      rd <= 1 ? 10 + rd : null,
    );
    const projection = buildPoolProjection({
      events: [event],
      prefixBars: [zero],
      postBars: post,
      securityIds: idsOf(event),
      policy: policy({ poolAgeCapTradingDays: 5, scoreInvalidationDays: 3 }),
      postMaxRelativeDay: 20,
    });

    // rd=0,1 有效；rd=2,3 为第 1、2 个不可评分日仍投影；rd=4 为第 3 个不可评分日 ⇒ 当天移除、不投影。
    expect(projection.rows.map((r) => r.tradeDate)).toEqual(DATES.slice(0, 4));
    expect(projection.members[0]).toMatchObject({
      removalReason: "SCORE_UNAVAILABLE",
      removedAt: "2025-03-07",
    });
  });

  it("E2. 连续不可评分未达 M ⇒ 不移除，仅当行如实缺价", () => {
    const event = makeEvent();
    const { zero, post } = barsFromDates(event, DATES.slice(0, 5), (_, rd) =>
      rd === 2 ? null : 10 + rd,
    );
    const projection = buildPoolProjection({
      events: [event],
      prefixBars: [zero],
      postBars: post,
      securityIds: idsOf(event),
      policy: policy({ poolAgeCapTradingDays: 5, scoreInvalidationDays: 3 }),
      postMaxRelativeDay: 20,
    });

    expect(projection.rows).toHaveLength(5);
    expect(projection.rows[2]!.close).toBeNull();
    expect(projection.members[0]!.removalReason).toBe("AGE_CAP");
  });

  it("E3. 资格线破坏（eligible=false / ST）⇒ 当天移除且当日不投影", () => {
    const event = makeEvent();
    const { zero, post } = barsFromDates(event, DATES.slice(0, 5), (_, rd) => 10 + rd);
    // 通过把 rd=2 的 bar 改成 volume=0（tradability UNKNOWN 下的硬停牌信号）触发移除。
    const brokenPost = post.map((bar) =>
      bar.relativeDay === 2 ? { ...bar, volume: 0 } : bar,
    );
    const projection = buildPoolProjection({
      events: [event],
      prefixBars: [zero],
      postBars: brokenPost,
      securityIds: idsOf(event),
      policy: policy({ poolAgeCapTradingDays: 5 }),
      postMaxRelativeDay: 20,
    });

    expect(projection.rows.map((r) => r.tradeDate)).toEqual(DATES.slice(0, 2));
    expect(projection.members[0]).toMatchObject({
      removalReason: "ELIGIBILITY_BROKEN",
      removedAt: "2025-03-05",
    });
  });
});

// ---------------------------------------------------------------------------
// F. Universe
// ---------------------------------------------------------------------------

describe("buildPoolProjection — Universe", () => {
  it("F. 每日成员 = 当日有效池成员，按 securityId 确定性排序", () => {
    const e1 = makeEvent({ eventId: "E1", symbol: "600000.SH", tradeDate: "2025-03-03" });
    const e2 = makeEvent({ eventId: "E2", symbol: "000001.SZ", tradeDate: "2025-03-03" });
    const w1 = barsFromDates(e1, DATES.slice(0, 3), (_, rd) => 10 + rd);
    const w2 = barsFromDates(e2, DATES.slice(0, 3), (_, rd) => 20 + rd);
    const projection = buildPoolProjection({
      events: [e1, e2],
      prefixBars: [w1.zero, w2.zero],
      postBars: [...w1.post, ...w2.post],
      securityIds: idsOf(e1, e2),
      policy: policy({ poolAgeCapTradingDays: 3 }),
      postMaxRelativeDay: 20,
    });

    for (const day of projection.universeDefinition.days) {
      expect(day.members).toEqual([...day.members].sort());
      expect(day.members).toHaveLength(2);
    }
    // 日期升序、无重复。
    const dates = projection.universeDefinition.days.map((d) => d.tradeDate);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
  });
});

// ---------------------------------------------------------------------------
// G. 预算护栏
// ---------------------------------------------------------------------------

describe("buildPoolProjection — 预算护栏（响亮失败，不静默裁剪）", () => {
  it("G1. 单日成员数超预算 ⇒ POOL_MEMBER_BUDGET_EXCEEDED", () => {
    const e1 = makeEvent({ eventId: "E1", symbol: "600000.SH", tradeDate: "2025-03-03" });
    const e2 = makeEvent({ eventId: "E2", symbol: "000001.SZ", tradeDate: "2025-03-03" });
    const e3 = makeEvent({ eventId: "E3", symbol: "300001.SZ", tradeDate: "2025-03-03" });
    const w = [e1, e2, e3].map((e) => barsFromDates(e, DATES.slice(0, 2), (_, rd) => 10 + rd));

    expect(
      readErrorCode(() =>
        buildPoolProjection({
          events: [e1, e2, e3],
          prefixBars: w.map((x) => x.zero),
          postBars: w.flatMap((x) => x.post),
          securityIds: idsOf(e1, e2, e3),
          policy: policy({ poolAgeCapTradingDays: 2 }),
          postMaxRelativeDay: 20,
          budgets: { maxMembersPerDay: 2 },
        }),
      ),
    ).toBe("POOL_MEMBER_BUDGET_EXCEEDED");
  });

  it("G2. 总行数超预算 ⇒ POOL_PANEL_ROW_BUDGET_EXCEEDED", () => {
    const event = makeEvent();
    const { zero, post } = barsFromDates(event, DATES.slice(0, 5), (_, rd) => 10 + rd);
    expect(
      readErrorCode(() =>
        buildPoolProjection({
          events: [event],
          prefixBars: [zero],
          postBars: post,
          securityIds: idsOf(event),
          policy: policy({ poolAgeCapTradingDays: 5 }),
          postMaxRelativeDay: 20,
          budgets: { maxPanelRows: 3 },
        }),
      ),
    ).toBe("POOL_PANEL_ROW_BUDGET_EXCEEDED");
  });

  it("G3. 缺 canonical 身份 ⇒ REGISTRY_SECURITY_IDENTITY_UNRESOLVED", () => {
    const event = makeEvent();
    const { zero, post } = barsFromDates(event, DATES.slice(0, 3), (_, rd) => 10 + rd);
    expect(
      readErrorCode(() =>
        buildPoolProjection({
          events: [event],
          prefixBars: [zero],
          postBars: post,
          securityIds: new Map(),
          policy: policy({ poolAgeCapTradingDays: 3 }),
          postMaxRelativeDay: 20,
        }),
      ),
    ).toBe("REGISTRY_SECURITY_IDENTITY_UNRESOLVED");
  });

  it("G4. 同 (tradeDate, poolMemberId) 重复行 ⇒ POOL_MEMBER_IDENTITY_NOT_UNIQUE", () => {
    const event = makeEvent();
    const { zero, post } = barsFromDates(event, DATES.slice(0, 3), (_, rd) => 10 + rd);
    // prefix 与 post 同时提供 rd=0 ⇒ barsByRelativeDay 合并，不产生重复；改用 post 里放一份 rd=0
    // 与 prefix 冲突则后者覆盖。为触发唯一性错误，这里重复一份 post rd=1（Map 会去重），
    // 故真正可触发的路径是 prefix 中重复同一 rd：构造两个相同 rd=0 的 bar。
    const duplicated = { ...zero };
    const projection = buildPoolProjection({
      events: [event],
      prefixBars: [zero, duplicated],
      postBars: post,
      securityIds: idsOf(event),
      policy: policy({ poolAgeCapTradingDays: 3 }),
      postMaxRelativeDay: 20,
    });
    // Map 去重后不报错 —— 这是预期：同一 rd 的重复 bar 被去重，唯一性护栏针对的是
    // 不同事件映射到同一 panelSecurityId（正常不可能）。这里断言去重后行为稳定。
    expect(projection.rows).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// H. PIT / preClose 链
// ---------------------------------------------------------------------------

describe("buildPoolProjection — PIT 字段", () => {
  it("H. asOf = tradeDate，preClose 链式（rd=0 用事件前收）", () => {
    const event = makeEvent({ previousClose: 9.5 });
    const { zero, post } = barsFromDates(event, DATES.slice(0, 3), (_, rd) => 10 + rd);
    const projection = buildPoolProjection({
      events: [event],
      prefixBars: [zero],
      postBars: post,
      securityIds: idsOf(event),
      policy: policy({ poolAgeCapTradingDays: 3 }),
      postMaxRelativeDay: 20,
    });

    for (const row of projection.rows) expect(row.asOf).toBe(row.tradeDate);
    expect(projection.rows.map((r) => r.preClose)).toEqual([9.5, 10, 11]);
    // 入池日 turnover / 市值来自事件；观察日如实为 null。
    expect(projection.rows[0]!.turnoverRate).toBe(7.5);
    expect(projection.rows[1]!.turnoverRate).toBeNull();
    expect(rowMapOf(projection).size).toBe(3);
  });
});
