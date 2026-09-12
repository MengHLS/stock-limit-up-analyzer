/**
 * STEP DATASET-002.2 — 只读查询层单测（纯内存，复用真实 keyset 语义，非 mock 冒名）。
 *
 * 覆盖：cursor 编解码 round-trip + 非法拒绝、排序键比较器、InMemory 分页
 * 不重 / 不漏 / 不乱序 / 版本隔离 / 日期与 event/horizon 过滤 / limit 上限。
 */

import { describe, expect, it } from "vitest";
import {
  InMemoryDatasetDataReader,
  compareEventKeys,
  compareOutcomeKeys,
  comparePathKeys,
  decodeEventCursor,
  decodeOutcomeCursor,
  decodePathCursor,
  encodeEventCursor,
  encodeOutcomeCursor,
  encodePathCursor,
} from "./query";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackOutcome,
  FirstLimitPullbackPath,
} from "./types";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeEvent(datasetVersionId: number, symbol: string, tradeDate: string): FirstLimitPullbackEvent {
  return {
    datasetVersionId,
    eventId: `${symbol}@${tradeDate}`,
    symbol,
    tradeDate,
    market: null,
    industryCode: null,
    boardType: "main",
    open: 10,
    high: 11,
    low: 9.5,
    close: 11,
    previousClose: 10,
    limitUpPrice: 11,
    volume: 1000,
    amount: 10000,
    turnover: 5,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 0,
    marketCap: 1000000,
    floatMarketCap: 500000,
  };
}

function makePath(datasetVersionId: number, eventId: string, relativeDay: number, tradeDate: string): FirstLimitPullbackPath {
  return {
    datasetVersionId,
    eventId,
    symbol: eventId.split("@")[0]!,
    tradeDate,
    relativeDay,
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1000,
    amount: 10000,
    turnover: 5,
    returnFromEventClose: 0.01,
    highFromEventClose: 0.02,
    lowFromEventClose: -0.01,
    closeFromEventClose: 0.005,
    pullbackFromEventClose: -0.005,
    pullbackFromEventHigh: -0.01,
    volumeRatio: 0.9,
    isBreakout: false,
    breakoutPrice: null,
    daysToBreakout: null,
  };
}

function makeOutcome(datasetVersionId: number, eventId: string, horizon: number): FirstLimitPullbackOutcome {
  return {
    datasetVersionId,
    eventId,
    horizon,
    maxReturn: 0.05,
    minReturn: -0.02,
    maxDrawdown: -0.03,
    isBreakout: false,
    daysToBreakout: null,
  };
}

// 版本 1：3 个 event（同一天两个 event 验证同日多 event 排序），
// 版本 2：1 个 event（验证隔离）。
const events: FirstLimitPullbackEvent[] = [
  makeEvent(1, "600001.SH", "2024-01-03"),
  makeEvent(1, "000001.SZ", "2024-01-02"),
  makeEvent(1, "600002.SH", "2024-01-02"),
  makeEvent(2, "300001.SZ", "2024-01-02"),
];

// 版本 1 的 path：event 600002.SH@2024-01-02 有 3 天，000001.SZ@2024-01-02 有 2 天。
const paths: FirstLimitPullbackPath[] = [
  makePath(1, "600002.SH@2024-01-02", 1, "2024-01-03"),
  makePath(1, "600002.SH@2024-01-02", 2, "2024-01-04"),
  makePath(1, "600002.SH@2024-01-02", 3, "2024-01-05"),
  makePath(1, "000001.SZ@2024-01-02", 1, "2024-01-03"),
  makePath(1, "000001.SZ@2024-01-02", 2, "2024-01-04"),
  makePath(2, "300001.SZ@2024-01-02", 1, "2024-01-03"),
];

const outcomes: FirstLimitPullbackOutcome[] = [
  makeOutcome(1, "600002.SH@2024-01-02", 5),
  makeOutcome(1, "600002.SH@2024-01-02", 10),
  makeOutcome(1, "600002.SH@2024-01-02", 20),
  makeOutcome(2, "300001.SZ@2024-01-02", 5),
];

describe("DATASET-002.2 · cursor 编解码", () => {
  it("event cursor round-trip", () => {
    const c = encodeEventCursor("2024-01-02", "600001.SH@2024-01-02");
    expect(decodeEventCursor(c)).toEqual({ tradeDate: "2024-01-02", eventId: "600001.SH@2024-01-02" });
  });

  it("path cursor round-trip", () => {
    const c = encodePathCursor("600001.SH@2024-01-02", 3);
    expect(decodePathCursor(c)).toEqual({ eventId: "600001.SH@2024-01-02", relativeDay: 3 });
  });

  it("outcome cursor round-trip", () => {
    const c = encodeOutcomeCursor("600001.SH@2024-01-02", 20);
    expect(decodeOutcomeCursor(c)).toEqual({ eventId: "600001.SH@2024-01-02", horizon: 20 });
  });

  it("非法 cursor 返回 null（不抛异常）", () => {
    expect(decodeEventCursor("garbage-not-base64!")).toBeNull();
    expect(decodeEventCursor(Buffer.from(JSON.stringify({ wrong: 1 })).toString("base64url"))).toBeNull();
    expect(decodeEventCursor(encodeEventCursor("bad-date", "x"))).toBeNull();
    expect(decodePathCursor(encodePathCursor("e", 1.5))).toBeNull();
    expect(decodeOutcomeCursor(encodeOutcomeCursor("", 5))).toBeNull();
  });
});

describe("DATASET-002.2 · 排序键比较器", () => {
  it("event：先日期后 eventId", () => {
    expect(compareEventKeys({ tradeDate: "2024-01-02", eventId: "a" }, { tradeDate: "2024-01-03", eventId: "a" })).toBeLessThan(0);
    expect(compareEventKeys({ tradeDate: "2024-01-02", eventId: "b" }, { tradeDate: "2024-01-02", eventId: "a" })).toBeGreaterThan(0);
  });

  it("path：先 eventId 后 relativeDay", () => {
    expect(comparePathKeys({ eventId: "a", relativeDay: 9 }, { eventId: "b", relativeDay: 1 })).toBeLessThan(0);
    expect(comparePathKeys({ eventId: "a", relativeDay: 2 }, { eventId: "a", relativeDay: 1 })).toBeGreaterThan(0);
  });

  it("outcome：先 eventId 后 horizon", () => {
    expect(compareOutcomeKeys({ eventId: "a", horizon: 20 }, { eventId: "a", horizon: 5 })).toBeGreaterThan(0);
    expect(compareOutcomeKeys({ eventId: "a", horizon: 5 }, { eventId: "b", horizon: 5 })).toBeLessThan(0);
  });
});

describe("DATASET-002.2 · InMemory keyset 分页", () => {
  const reader = new InMemoryDatasetDataReader(events, paths, outcomes);

  async function walk<T>(first: () => Promise<{ items: T[]; nextCursor: string | null }>, next: (cursor: string) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
    const collected: T[] = [];
    let page = await first();
    collected.push(...page.items);
    let guard = 0;
    while (page.nextCursor !== null) {
      page = await next(page.nextCursor);
      collected.push(...page.items);
      if (++guard > 100) throw new Error("分页未收敛");
    }
    return collected;
  }

  it("event：分页 walk 不重不漏不乱序，且版本隔离", async () => {
    const collected = await walk(
      () => reader.listEventsPage({ datasetVersionId: 1, limit: 2 }),
      (cursor) => reader.listEventsPage({ datasetVersionId: 1, cursor: decodeEventCursor(cursor), limit: 2 }),
    );
    const ids = collected.map((e) => `${e.tradeDate}|${e.eventId}`);
    expect(ids).toEqual([
      "2024-01-02|000001.SZ@2024-01-02",
      "2024-01-02|600002.SH@2024-01-02",
      "2024-01-03|600001.SH@2024-01-03",
    ]);
    expect(new Set(ids).size).toBe(ids.length); // 无重复
    expect(collected.every((e) => e.datasetVersionId === 1)).toBe(true); // 无跨版本泄漏
  });

  it("event：limit 上限生效（items.length <= limit）", async () => {
    const page = await reader.listEventsPage({ datasetVersionId: 1, limit: 2 });
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it("event：日期范围过滤", async () => {
    const page = await reader.listEventsPage({ datasetVersionId: 1, fromDate: "2024-01-03", toDate: "2024-01-03", limit: 10 });
    expect(page.items.map((e) => e.eventId)).toEqual(["600001.SH@2024-01-03"]);
  });

  it("path：分页 walk 不重不漏 + eventId 过滤", async () => {
    const collected = await walk(
      () => reader.listPathsPage({ datasetVersionId: 1, limit: 2 }),
      (cursor) => reader.listPathsPage({ datasetVersionId: 1, cursor: decodePathCursor(cursor), limit: 2 }),
    );
    const keys = collected.map((p) => `${p.eventId}#${p.relativeDay}`);
    expect(keys).toEqual([
      "000001.SZ@2024-01-02#1",
      "000001.SZ@2024-01-02#2",
      "600002.SH@2024-01-02#1",
      "600002.SH@2024-01-02#2",
      "600002.SH@2024-01-02#3",
    ]);

    const filtered = await reader.listPathsPage({ datasetVersionId: 1, eventId: "600002.SH@2024-01-02", limit: 10 });
    expect(filtered.items.map((p) => p.relativeDay)).toEqual([1, 2, 3]);
  });

  it("outcome：分页 walk 不重不漏 + horizon 过滤", async () => {
    const collected = await walk(
      () => reader.listOutcomesPage({ datasetVersionId: 1, limit: 2 }),
      (cursor) => reader.listOutcomesPage({ datasetVersionId: 1, cursor: decodeOutcomeCursor(cursor), limit: 2 }),
    );
    expect(collected.map((o) => `${o.eventId}#${o.horizon}`)).toEqual([
      "600002.SH@2024-01-02#5",
      "600002.SH@2024-01-02#10",
      "600002.SH@2024-01-02#20",
    ]);

    const filtered = await reader.listOutcomesPage({ datasetVersionId: 1, horizon: 20, limit: 10 });
    expect(filtered.items.map((o) => o.horizon)).toEqual([20]);
  });

  it("getVersionCounts：统计与 horizon 聚合正确", async () => {
    const counts = await reader.getVersionCounts(1);
    expect(counts.eventCount).toBe(3);
    expect(counts.pathCount).toBe(5);
    expect(counts.outcomeCount).toBe(3);
    expect(counts.rowCount).toBe(11);
    expect(counts.firstDate).toBe("2024-01-02");
    expect(counts.lastDate).toBe("2024-01-03");
    expect(counts.horizons).toEqual([5, 10, 20]);
  });
});
