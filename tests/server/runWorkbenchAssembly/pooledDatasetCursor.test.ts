import { describe, expect, it } from "vitest";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";
import { createPooledDatasetCursor } from "../../../server/runWorkbenchAssembly/pooledDatasetCursor";

const DATES = [
  "2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07",
  "2025-03-10", "2025-03-11", "2025-03-12",
];

function event(): FirstLimitPullbackEvent {
  return {
    datasetVersionId: 1,
    eventId: "E1",
    symbol: "600000.SH",
    tradeDate: DATES[0]!,
    market: "SH",
    industryCode: null,
    boardType: "main",
    previousClose: 9.5,
    limitUpPrice: 10.45,
    limitDownPrice: 8.55,
    limitRuleUp: 0.1,
    limitRuleDown: -0.1,
    limitRuleVersion: "test",
    turnover: null,
    limitUpTime: null,
    sector: null,
    keywords: null,
    sourceTurnoverAmount: null,
    sourceCirculationValue: null,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 0,
    marketCap: null,
    floatMarketCap: null,
  } as unknown as FirstLimitPullbackEvent;
}

function prefix(eventId: string): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: 1,
    eventId,
    symbol: "600000.SH",
    tradeDate: DATES[0]!,
    relativeDay: 0,
    open: 9.6,
    high: 10.45,
    low: 9.5,
    close: 10.45,
    preClose: 9.5,
    volume: 1000,
    amount: 10_000,
  } as unknown as FirstLimitPullbackRawBar;
}

function post(eventId: string): FirstLimitPullbackRawBar[] {
  return DATES.slice(1).map((date, index) => ({
    datasetVersionId: 1,
    eventId,
    symbol: "600000.SH",
    tradeDate: date,
    relativeDay: index + 1,
    open: 10 + index,
    high: 10.5 + index,
    low: 9.8 + index,
    close: 10.2 + index,
    preClose: index === 0 ? 10.45 : 10.2 + index - 1,
    volume: 900,
    amount: 9000,
  })) as unknown as FirstLimitPullbackRawBar[];
}

function makeCursor() {
  const e = event();
  return createPooledDatasetCursor({
    reader: {
      listTradingDates: async () => DATES,
      listEvents: async () => [e],
      loadPrefixBars: async () => [prefix(e.eventId)],
      loadPostBars: async () => post(e.eventId),
    },
    identityByEventId: new Map([[e.eventId, "sec_1"]]),
    startDate: DATES[0]!,
    endDate: DATES[DATES.length - 1]!,
    poolAgeCapTradingDays: 5,
    scoreInvalidationDays: 3,
    exitTailTradingDays: 2,
  });
}

describe("pooledDatasetCursor", () => {
  it("按日输出决策成员与执行行情，并在池龄后进入退出尾窗", async () => {
    const e = event();
    const cursor = await createPooledDatasetCursor({
      reader: {
        listTradingDates: async () => DATES,
        listEvents: async () => [e],
        loadPrefixBars: async () => [prefix(e.eventId)],
        loadPostBars: async () => post(e.eventId),
      },
      identityByEventId: new Map([[e.eventId, "sec_1"]]),
      startDate: DATES[0]!,
      endDate: DATES[DATES.length - 1]!,
      poolAgeCapTradingDays: 5,
      scoreInvalidationDays: 3,
      exitTailTradingDays: 2,
    });

    const slices = [];
    for (;;) {
      const item = await cursor.next();
      if (item.done) break;
      slices.push(item.value);
    }

    expect(slices[0]!.decisionMembers).toHaveLength(1);
    expect(slices[4]!.decisionMembers).toHaveLength(1);
    expect(slices[5]!.decisionMembers).toHaveLength(0);
    expect(slices[5]!.executionBars.size).toBe(1);
    expect(slices[7]!.executionBars.size).toBe(0);
  });

  it("低分移池只停止未来买入，退出尾窗仍提供执行行情", async () => {
    const cursor = await makeCursor();
    const first = await cursor.getDaySlice(DATES[0]!);
    const memberId = first.decisionMembers[0]!.securityId;
    cursor.applyDecisionOutcomes?.([
      { securityId: memberId, scored: true, removeFromPool: true },
    ]);
    const second = await cursor.getDaySlice(DATES[1]!);
    expect(second.decisionMembers).toHaveLength(0);
    expect(second.executionBars.size).toBe(1);
  });

  it("retainSecurityIds 保留被选身份直到 cursor 结束，供 backtest 复用同一份真实行", async () => {
    const cursor = await makeCursor();
    const first = await cursor.getDaySlice(DATES[0]!);
    const memberId = first.decisionMembers[0]!.securityId;
    cursor.retainSecurityIds?.([memberId]);
    for (const date of DATES.slice(1)) await cursor.getDaySlice(date);
    const retained = cursor.takeRetainedRows?.() ?? [];
    expect(retained.map(row => row.tradeDate)).toEqual(DATES.slice(0, 8));
    expect(retained.every(row => row.securityId === memberId)).toBe(true);
  });

  it("restart 后重新生成同一天切片，供 research / backtest 两个顺序消费者使用", async () => {
    const cursor = await makeCursor();
    const first = await cursor.getDaySlice(DATES[0]!);
    await cursor.restart?.();
    const again = await cursor.getDaySlice(DATES[0]!);
    expect(again.decisionMembers.map(item => item.securityId)).toEqual(
      first.decisionMembers.map(item => item.securityId),
    );
  });
});
