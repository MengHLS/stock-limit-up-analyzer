import { describe, expect, it } from "vitest";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";
import { createEventWindowDatasetCursor } from "../../../server/runWorkbenchAssembly/datasetFromRegistry";

const DATES = [
  "2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06",
  "2025-03-07", "2025-03-10", "2025-03-11", "2025-03-12",
];

function makeEvent(eventId: string, index: number, symbol = "600000.SH"): FirstLimitPullbackEvent {
  return {
    datasetVersionId: 1,
    eventId,
    symbol,
    tradeDate: DATES[index]!,
    market: "SH",
    industryCode: "I1",
    boardType: "main",
    previousClose: 9.5,
    limitUpPrice: 10.45,
    limitDownPrice: 8.55,
    limitRuleUp: 0.1,
    limitRuleDown: -0.1,
    limitRuleVersion: "test",
    turnover: 3.3,
    limitUpTime: null,
    sector: null,
    keywords: null,
    sourceTurnoverAmount: null,
    sourceCirculationValue: null,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 0,
    marketCap: 1_000_000,
    floatMarketCap: 800_000,
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

/** 内存 reader：按事件日装载，并记录调用（用于验证「按需读」）。 */
function makeReader(events: readonly FirstLimitPullbackEvent[]) {
  const bars = new Map(events.map((event) => [event.eventId, barsFor(event)] as const));
  const prefixLoads: string[][] = [];
  const postLoads: { eventIds: readonly string[]; relativeDays: readonly number[] }[] = [];
  return {
    prefixLoads,
    postLoads,
    reader: {
      loadPrefixBars: async (eventIds: readonly string[]) => {
        prefixLoads.push([...eventIds]);
        return eventIds.map((eventId) => bars.get(eventId)!.prefix);
      },
      loadPostBars: async (eventIds: readonly string[], relativeDays: readonly number[]) => {
        postLoads.push({ eventIds: [...eventIds], relativeDays: [...relativeDays] });
        return eventIds.flatMap((eventId) =>
          bars.get(eventId)!.post.filter((bar) => relativeDays.includes(bar.relativeDay)),
        );
      },
    },
  };
}

function makeCursor(events: readonly FirstLimitPullbackEvent[], window = { start: 1, end: 3 }) {
  const harness = makeReader(events);
  const identity = new Map(events.map((event) => [event.eventId, `sec_${event.symbol}`] as const));
  const cursor = createEventWindowDatasetCursor({
    reader: harness.reader,
    events,
    identityByEventId: identity,
    datasetVersion: "v-test",
    datasetGate: "PASS",
    tradingDates: DATES,
    observationWindow: window,
  });
  return { cursor, harness, identity };
}

describe("eventWindowDatasetCursor", () => {
  it("按 rd=0..end+1 逐日发射行，但只在 rd ∈ [start,end] 产生决策成员", async () => {
    const event = makeEvent("E1", 0);
    const { cursor } = makeCursor([event]);
    const panelId = "sec_600000.SH::event:E1";

    const day0 = await cursor.getDaySlice(DATES[0]!);
    expect(day0.rows.map((row) => row.securityId)).toEqual([panelId]);
    expect(day0.members).toEqual([]);
    expect(day0.executionBars.has(panelId)).toBe(true);

    const day1 = await cursor.getDaySlice(DATES[1]!);
    expect(day1.members).toEqual([panelId]);
    expect(day1.visibleBars.get(panelId)?.length).toBe(2);

    // rd=4 = end+1：仍有行（执行日），但不进决策成员，且此后该成员被释放。
    const day4 = await cursor.getDaySlice(DATES[4]!);
    expect(day4.rows.length).toBe(1);
    expect(day4.members).toEqual([]);
    expect(cursor.stats?.().retiredMemberCount).toBe(1);

    const day5 = await cursor.getDaySlice(DATES[5]!);
    expect(day5.rows).toEqual([]);
  });

  it("同一证券的多个事件各自独立成身份（::event:<eventId>），不合并成一条序列", async () => {
    const e1 = makeEvent("E1", 0);
    const e2 = makeEvent("E2", 1);
    const { cursor } = makeCursor([e1, e2]);
    const day1 = await cursor.getDaySlice(DATES[1]!);
    expect(day1.rows.map((row) => row.securityId).sort()).toEqual([
      "sec_600000.SH::event:E1",
      "sec_600000.SH::event:E2",
    ]);
    // E2 当日是 rd=0 ⇒ 只有 E1 是决策成员。
    expect(day1.members).toEqual(["sec_600000.SH::event:E1"]);
    // E1 可见 2 根、E2 可见 1 根（各自序列起点不同）。
    expect(day1.visibleBars.get("sec_600000.SH::event:E1")?.length).toBe(2);
    expect(day1.visibleBars.get("sec_600000.SH::event:E2")).toBeUndefined();
  });

  it("按需读 bars：只装载「已推进到的日期 + 预读窗口」的事件，不整表物化", async () => {
    // 30 个交易日、事件分别在首日与第 26 日（远超过预读窗口）。
    const longDates = Array.from({ length: 30 }, (_, i) => `2025-04-${String(i + 1).padStart(2, "0")}`);
    const e1 = { ...makeEvent("E1", 0), tradeDate: longDates[0]! } as FirstLimitPullbackEvent;
    const e2 = { ...makeEvent("E2", 0), tradeDate: longDates[25]! } as FirstLimitPullbackEvent;
    const harness = makeReader([e1, e2]);
    const cursor = createEventWindowDatasetCursor({
      reader: harness.reader,
      events: [e1, e2],
      identityByEventId: new Map([["E1", "sec_600000.SH"], ["E2", "sec_600000.SH"]]),
      datasetVersion: "v-test",
      datasetGate: "PASS",
      tradingDates: longDates,
      observationWindow: { start: 1, end: 3 },
    });

    await cursor.getDaySlice(longDates[0]!);
    // 只读到预读窗口为止 ⇒ 远期事件尚未装载。
    expect(harness.prefixLoads.length).toBe(1);
    expect(harness.prefixLoads[0]).toEqual(["E1"]);
    expect(harness.postLoads[0]!.relativeDays).toEqual([1, 2, 3, 4]);

    await cursor.getDaySlice(longDates[25]!);
    expect(harness.prefixLoads.length).toBe(2);
    expect(new Set(harness.postLoads.flatMap((load) => load.eventIds))).toEqual(new Set(["E1", "E2"]));
  });

  it("retainSecurityIds 只保留被标记面板身份的逐日行（回测复用，不重放）", async () => {
    const e1 = makeEvent("E1", 0);
    const e2 = makeEvent("E2", 1, "600001.SH");
    const { cursor } = makeCursor([e1, e2]);
    await cursor.getDaySlice(DATES[0]!);
    cursor.retainSecurityIds?.(["sec_600000.SH::event:E1"]);
    await cursor.getDaySlice(DATES[1]!);
    await cursor.getDaySlice(DATES[2]!);
    const retained = cursor.takeRetainedRows?.() ?? [];
    expect(retained.every((row) => row.securityId === "sec_600000.SH::event:E1")).toBe(true);
    expect(retained.map((row) => row.tradeDate)).toEqual([DATES[0], DATES[1], DATES[2]]);
  });

  it("注入决策成员判定器后，只有判定为真的成员进决策集（并计入审计计数）", async () => {
    const e1 = makeEvent("E1", 0);
    const e2 = makeEvent("E2", 1, "600001.SH");
    const harness = makeReader([e1, e2]);
    const seen: { eventId: string; relativeDay: number; bars: number }[] = [];
    const cursor = createEventWindowDatasetCursor({
      reader: harness.reader,
      events: [e1, e2],
      identityByEventId: new Map([["E1", "sec_600000.SH"], ["E2", "sec_600001.SH"]]),
      datasetVersion: "v-test",
      datasetGate: "PASS",
      tradingDates: DATES,
      observationWindow: { start: 1, end: 3 },
      decisionMemberPredicate: (member) => {
        seen.push({ eventId: member.eventId, relativeDay: member.relativeDay, bars: member.bars.length });
        return member.eventId === "E1" && member.relativeDay === 2;
      },
    });

    const day1 = await cursor.getDaySlice(DATES[1]!);
    expect(day1.members).toEqual([]);
    const day2 = await cursor.getDaySlice(DATES[2]!);
    expect(day2.members).toEqual(["sec_600000.SH::event:E1"]);
    expect(day2.visibleBars.get("sec_600000.SH::event:E1")?.length).toBe(3);
    expect(seen.find((x) => x.eventId === "E1" && x.relativeDay === 2)?.bars).toBe(3);
    expect(cursor.stats?.().suppressedNonTriggerMembers).toBeGreaterThan(0);
  });

  it("restart 回到起点，可被 research / backtest 两个消费者各读一遍", async () => {
    const event = makeEvent("E1", 0);
    const { cursor } = makeCursor([event]);
    const first = await cursor.getDaySlice(DATES[1]!);
    await cursor.restart?.();
    const again = await cursor.getDaySlice(DATES[1]!);
    expect(again.rows.length).toBe(first.rows.length);
    expect(again.members).toEqual(first.members);
  });

  it("顺序读取约束：回退请求日期直接抛错（不静默返回空）", async () => {
    const event = makeEvent("E1", 0);
    const { cursor } = makeCursor([event]);
    await cursor.getDaySlice(DATES[2]!);
    await expect(cursor.getDaySlice(DATES[1]!)).rejects.toThrowError(/顺序读取/);
  });

  it("缺少 canonical 身份时响亮抛错（不使用代码冒充身份）", async () => {
    const event = makeEvent("E1", 0);
    const harness = makeReader([event]);
    const cursor = createEventWindowDatasetCursor({
      reader: harness.reader,
      events: [event],
      identityByEventId: new Map(),
      datasetVersion: "v-test",
      datasetGate: "PASS",
      tradingDates: DATES,
      observationWindow: { start: 1, end: 3 },
    });
    await expect(cursor.getDaySlice(DATES[0]!)).rejects.toThrowError(/canonical securityId|缺少 canonical/);
  });
});
