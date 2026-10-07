/**
 * STOCK-SELECTION-001/002 —— 按决策日选股器单测（纯内存，不连库）。
 *
 * 覆盖：
 *   1. 按决策日切片选出的 Top-N **与既有全史选股实现逐位一致**（无第二套语义）；
 *   2. 硬过滤统计如实（一字板 / 无回踩 / 超振幅 / 观察窗不完整）；
 *   3. 其它事件日的事件**不会**混进本决策日；
 *   4. **载体可替换**：换成 `live` 载体（测试替身）得到**同一份**选股结果 ⇒ 口径与载体解耦；
 *   5. 三类不一致**响亮失败**（缺 rd0 / 日历缺洞 / 事件窗口超护栏）；
 *   6. 注册表可扩展（未知策略响亮拒绝）。
 */

import { describe, expect, it } from "vitest";
import { InMemoryDatasetDataReader } from "../../../server/datasetRegistry/query";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";
import type { SecurityIdentifier } from "../../../server/security/types";
import { buildWindowRows } from "../../../server/runWorkbenchAssembly/datasetFromRegistry";
import { resolveSecurityIdsByEvent } from "../../../server/runWorkbenchAssembly/datasetIdentityProvider";
import { buildFirstLimitPullback3FTop3SourceRun } from "../../../server/research/compositeRunner/index";
import {
  FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
  STOCK_SELECTION_STRATEGY_IDS,
  StockSelectionError,
  buildSelectionSliceDataset,
  createDatasetSelectionDataSource,
  createLiveSelectionDataSource,
  createStockSelectionRegistry,
  defaultStockSelectionDeps,
  selectFirstLimitPullback3FTopN,
  type SelectionDataSource,
  type StockSelectionDeps,
} from "../../../server/stockSelection";

const VERSION = 900001;
const T0 = "2024-01-02";
/** 交易日（rd0..rd7）：覆盖两个事件日，供「全史」参考实现使用。 */
const ALL_DAYS = [
  "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05",
  "2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11",
];
/** 决策日 = T0 + 5 个交易日（rd5）。 */
const DECISION = "2024-01-09";
/** 计划执行日 = T0 + 6 个交易日（rd6）。 */
const ENTRY = "2024-01-10";
/** 第二个事件日（其 rd5 = 2024-01-10 ≠ 决策日）。 */
const T0B = "2024-01-03";
const FIXED_NOW = "2026-10-06T00:00:00.000Z";

interface BarSpec { open: number; high: number; low: number; close: number; volume: number; }

function makeEvent(symbol: string, tradeDate: string): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION,
    eventId: `${symbol}@${tradeDate}`,
    symbol,
    tradeDate,
    market: null,
    industryCode: null,
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    limitDownPrice: 9,
    limitRuleUp: 0.1,
    limitRuleDown: 0.1,
    limitRuleVersion: "v1",
    turnover: 5,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 0,
    marketCap: 1_000_000,
    floatMarketCap: 500_000,
  };
}

function rawBar(
  symbol: string,
  eventDate: string,
  relativeDay: number,
  tradeDate: string,
  spec: BarSpec,
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION,
    eventId: `${symbol}@${eventDate}`,
    symbol,
    tradeDate,
    relativeDay,
    open: spec.open,
    high: spec.high,
    low: spec.low,
    close: spec.close,
    preClose: null,
    volume: spec.volume,
    amount: spec.volume * spec.close,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
  };
}

/** 温和回踩（振幅小）：合格候选。 */
function gentleBar(close: number, volume: number): BarSpec {
  return { open: close - 0.05, high: close + 0.1, low: close - 0.15, close, volume };
}

function candidatePaths(symbol: string, eventDate: string, rd1Close: number, rd1Volume: number) {
  const base = ALL_DAYS.indexOf(eventDate);
  const zero = rawBar(symbol, eventDate, 0, eventDate, { open: 10, high: 11, low: 9.9, close: 11, volume: 1000 });
  const post = [
    rawBar(symbol, eventDate, 1, ALL_DAYS[base + 1]!, gentleBar(rd1Close, rd1Volume)),
    rawBar(symbol, eventDate, 2, ALL_DAYS[base + 2]!, gentleBar(rd1Close + 0.05, 400)),
    rawBar(symbol, eventDate, 3, ALL_DAYS[base + 3]!, gentleBar(rd1Close + 0.02, 400)),
    rawBar(symbol, eventDate, 4, ALL_DAYS[base + 4]!, gentleBar(rd1Close + 0.08, 400)),
    rawBar(symbol, eventDate, 5, ALL_DAYS[base + 5]!, gentleBar(rd1Close + 0.1, 400)),
    rawBar(symbol, eventDate, 6, ALL_DAYS[base + 6]!, gentleBar(rd1Close + 0.12, 400)),
  ];
  return { zero, post };
}

const events: FirstLimitPullbackEvent[] = [
  makeEvent("600001.SH", T0),
  makeEvent("600002.SH", T0),
  makeEvent("600003.SH", T0),
  makeEvent("600004.SH", T0),
  makeEvent("600005.SH", T0),
  makeEvent("600006.SH", T0),
  makeEvent("600007.SH", T0B),
];

const zeroBars: FirstLimitPullbackRawBar[] = [];
const postBars: FirstLimitPullbackRawBar[] = [];

for (const symbol of ["600001.SH", "600006.SH"]) {
  const paths = candidatePaths(symbol, T0, symbol === "600001.SH" ? 10.9 : 10.95, symbol === "600001.SH" ? 500 : 200);
  zeroBars.push(paths.zero);
  postBars.push(...paths.post);
}
{
  // 一字板：rd0 open == high ⇒ 应被剔除
  zeroBars.push(rawBar("600002.SH", T0, 0, T0, { open: 11, high: 11, low: 11, close: 11, volume: 1000 }));
  postBars.push(...candidatePaths("600002.SH", T0, 10.9, 500).post);
}
{
  // 无回踩：观察期收盘始终高于首板日收盘 11 ⇒ 应被剔除
  zeroBars.push(rawBar("600003.SH", T0, 0, T0, { open: 10, high: 11, low: 9.9, close: 11, volume: 1000 }));
  for (let rd = 1; rd <= 6; rd += 1) {
    postBars.push(rawBar("600003.SH", T0, rd, ALL_DAYS[rd]!, gentleBar(11.2, 400)));
  }
}
{
  // 振幅超限：(high-low)/前收 > 0.14 ⇒ 应被剔除
  zeroBars.push(rawBar("600004.SH", T0, 0, T0, { open: 10, high: 11, low: 9.9, close: 11, volume: 1000 }));
  for (let rd = 1; rd <= 6; rd += 1) {
    postBars.push(rawBar("600004.SH", T0, rd, ALL_DAYS[rd]!, rd === 3
      ? { open: 11, high: 12.5, low: 10.2, close: 10.9, volume: 400 }
      : gentleBar(10.9, 400)));
  }
}
{
  // 观察窗不完整：缺 rd4 行 ⇒ 应被剔除（不计入合格候选）
  zeroBars.push(rawBar("600005.SH", T0, 0, T0, { open: 10, high: 11, low: 9.9, close: 11, volume: 1000 }));
  for (const rd of [1, 2, 3, 5, 6]) {
    postBars.push(rawBar("600005.SH", T0, rd, ALL_DAYS[rd]!, gentleBar(10.9, 400)));
  }
}
{
  // 其它事件日（T0B）的合格候选：其 rd5 = 2024-01-10 ⇒ 不得出现在本决策日
  const paths = candidatePaths("600007.SH", T0B, 10.9, 500);
  zeroBars.push(paths.zero);
  postBars.push(...paths.post);
}

const identifiers: SecurityIdentifier[] = [
  "600001", "600002", "600003", "600004", "600005", "600006", "600007",
].map((code) => ({
  securityId: `sec_test_${code}`,
  exchange: "SH" as const,
  code,
  identifierType: "primary" as const,
  effectiveFrom: "2000-01-01",
  effectiveTo: null,
  source: "test",
}));

function datasetSource(options: { maxEvents?: number; zeroBarsOverride?: readonly FirstLimitPullbackRawBar[]; postBarsOverride?: readonly FirstLimitPullbackRawBar[] } = {}) {
  return createDatasetSelectionDataSource({
    reader: new InMemoryDatasetDataReader(
      events,
      [],
      [],
      options.zeroBarsOverride ?? zeroBars,
      options.postBarsOverride ?? postBars,
    ),
    maxEvents: options.maxEvents,
    label: "测试数据集载体",
  });
}

/** 决策日 = DECISION 的 6 个 T0 候选（其余为被剔除样本 / 其它事件日）。 */
const DECISION_CANDIDATE_EVENT_IDS = [
  "600001.SH@2024-01-02", "600002.SH@2024-01-02", "600003.SH@2024-01-02",
  "600004.SH@2024-01-02", "600005.SH@2024-01-02", "600006.SH@2024-01-02",
];

/** `live` 载体测试替身：返回**同一批**候选事件窗行（证明载体可替换、口径不变）。 */
const liveSourceStub: SelectionDataSource = {
  kind: "live",
  label: "内存实时（测试替身）",
  load: async () => {
    const ids = new Set(DECISION_CANDIDATE_EVENT_IDS);
    return {
      kind: "live",
      label: "内存实时（测试替身）",
      calendarDays: ALL_DAYS.slice(0, 7),
      events: events.filter((item) => ids.has(item.eventId)),
      zeroBars: zeroBars.filter((bar) => ids.has(bar.eventId)),
      postBars: postBars.filter((bar) => ids.has(bar.eventId)),
    };
  },
};

function deps(overrides: Partial<StockSelectionDeps> = {}): StockSelectionDeps {
  return {
    sources: [datasetSource()],
    defaultSourceKind: "dataset",
    loadIdentifiers: async () => identifiers,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

/** 决策日请求（载体 = dataset / 默认；或显式给 live）。 */
function requestFor(decisionDate: string, topN?: number, source?: { kind: "dataset" | "live"; datasetVersionId?: number }) {
  return {
    decisionDate,
    topN,
    source: source ?? { kind: "dataset" as const, datasetVersionId: VERSION },
  };
}

/** 「全史」参考实现：同一批数据 + 同一权威函数，但不做按日裁剪。 */
function referenceSelectedForDecisionDay(topN: number) {
  const securityIds = resolveSecurityIdsByEvent(events, identifiers);
  const projection = buildWindowRows(events, zeroBars, postBars, { start: 1, end: 5 }, securityIds);
  const dataset = buildSelectionSliceDataset({
    parentDatasetVersionId: VERSION,
    decisionDate: DECISION,
    rows: projection.rows,
    tradingDays: ALL_DAYS,
    capturedAt: FIXED_NOW,
  });
  const arm = buildFirstLimitPullback3FTop3SourceRun({
    dataset,
    dateRange: { startDate: ALL_DAYS[0]!, endDate: ALL_DAYS[ALL_DAYS.length - 1]! },
    topN,
  });
  const day = arm.sourceRun.days.find((record) => record.date === DECISION);
  if (day === undefined) throw new Error("reference：参考实现未产出决策日记录");
  return day.selected;
}


/** 前一交易日（非涨停）——live 载体需要「上一交易日未涨停」才能判首板。 */
const PREV_DAY = "2023-12-29";

/** 夹具 → live 载体读取口（纯内存，不连库）。 */
const liveBarReader = {
  tradingDates: async (from: string, to: string) =>
    [PREV_DAY, ...ALL_DAYS].filter((day) => day >= from && day <= to),
  barsForDate: async (date: string) =>
    zeroBars
      .filter((bar) => bar.tradeDate === date)
      .map((bar) => ({
        symbol: bar.symbol,
        timestamp: bar.tradeDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        preClose: bar.preClose ?? 10,
        volume: bar.volume,
        amount: bar.amount,
        turnoverRate: null,
        adjustment: "raw" as const,
      })),
  barsForSecuritiesDateRange: async (codes: readonly string[], from: string, to: string) => {
    const wanted = new Set(codes);
    const rows = [...zeroBars, ...postBars].filter(
      (bar) => wanted.has(bar.symbol) && bar.tradeDate >= from && bar.tradeDate <= to,
    );
    if (from <= PREV_DAY && PREV_DAY <= to) {
      for (const code of wanted) {
        // 上一交易日：收盘 10.00 / 前收 9.50 ⇒ 非涨停（首板规则要求上一交易日未涨停）
        rows.push({ ...zeroBars[0]!, symbol: code, eventId: `${code}@${PREV_DAY}`, tradeDate: PREV_DAY, relativeDay: -1, open: 9.6, high: 10.1, low: 9.5, close: 10, preClose: 9.5 });
      }
    }
    return rows.map((bar) => ({
      symbol: bar.symbol,
      timestamp: bar.tradeDate,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      preClose: bar.preClose ?? 10,
      volume: bar.volume,
      amount: bar.amount,
      turnoverRate: null,
      adjustment: "raw" as const,
    }));
  },
};

const liveReferenceData = { resolveSt: async () => "NORMAL" as const };

function liveSource(options: { maxCandidates?: number } = {}) {
  return createLiveSelectionDataSource({
    bars: liveBarReader,
    referenceData: liveReferenceData,
    label: "内存实时载体",
    maxCandidates: options.maxCandidates,
  });
}
describe("STOCK-SELECTION-001 · 首板回踩 3F 按日选股", () => {
  it("按决策日切片 == 全史参考实现（逐位一致，且只含合格候选）", async () => {
    const result = await selectFirstLimitPullback3FTopN(deps(), requestFor(DECISION, 2));

    const reference = referenceSelectedForDecisionDay(2);
    expect(reference.length).toBe(2);
    expect(result.picks.map((pick) => pick.panelSecurityId)).toEqual(
      reference.map((selected) => selected.securityId),
    );
    expect(result.picks.map((pick) => pick.rank)).toEqual([1, 2]);
    expect(result.picks.map((pick) => pick.score)).toEqual(reference.map((selected) => selected.value));

    for (const pick of result.picks) {
      expect(["600001.SH", "600006.SH"]).toContain(pick.code);
      expect(pick.eventDate).toBe(T0);
      expect(pick.signalDate).toBe(DECISION);
      expect(pick.entryDate).toBe(ENTRY);
      expect(pick.canonicalSecurityId.startsWith("sec_test_")).toBe(true);
    }
    expect(result.picks.some((pick) => pick.code === "600007.SH")).toBe(false);
    expect(result.source).toEqual({ kind: "dataset", label: "测试数据集载体" });
    expect(result.datasetVersionId).toBe(VERSION);
  });

  it("live 载体：同一夹具下与 dataset 载体给出**同一份**选股结果（口径同源）", async () => {
    const viaDataset = await selectFirstLimitPullback3FTopN(
      deps({ sources: [datasetSource(), liveSource()] }),
      requestFor(DECISION, 2, { kind: "dataset", datasetVersionId: VERSION }),
    );
    const viaLive = await selectFirstLimitPullback3FTopN(
      deps({ sources: [datasetSource(), liveSource()] }),
      requestFor(DECISION, 2, { kind: "live" }),
    );

    expect(viaLive.picks.map((pick) => pick.panelSecurityId)).toEqual(
      viaDataset.picks.map((pick) => pick.panelSecurityId),
    );
    expect(viaLive.picks.map((pick) => pick.score)).toEqual(viaDataset.picks.map((pick) => pick.score));
    expect(viaLive.picks.map((pick) => pick.entryDate)).toEqual(viaDataset.picks.map((pick) => pick.entryDate));
    expect(viaLive.filterStats.candidateEventCount).toBe(viaDataset.filterStats.candidateEventCount);
    expect(viaLive.source).toEqual({ kind: "live", label: "内存实时载体" });
    expect(viaLive.datasetVersionId).toBeNull();
  });

  it("live 载体：决策日不是交易日 ⇒ 响亮失败（不猜交易日）", async () => {
    const reader = { ...liveBarReader, tradingDates: async () => [PREV_DAY, ...ALL_DAYS].filter((day) => day !== DECISION) };
    const source = createLiveSelectionDataSource({ bars: reader, referenceData: liveReferenceData });
    await expect(
      selectFirstLimitPullback3FTopN(deps({ sources: [source] }), requestFor(DECISION, undefined, { kind: "live" })),
    ).rejects.toMatchObject({ code: "SELECTION_CALENDAR_INCONSISTENT" });
  });

  it("live 载体：交易日不足（窗口未成形）⇒ 如实空结果", async () => {
    const reader = { ...liveBarReader, tradingDates: async () => [PREV_DAY, "2024-01-02", DECISION] };
    const source = createLiveSelectionDataSource({ bars: reader, referenceData: liveReferenceData });
    const result = await selectFirstLimitPullback3FTopN(
      deps({ sources: [source] }),
      requestFor(DECISION, undefined, { kind: "live" }),
    );
    expect(result.picks).toEqual([]);
    expect(result.filterStats.candidateEventCount).toBe(0);
  });
  it("载体可替换：live 载体得到同一份选股结果（口径与载体解耦）", async () => {
    const viaDataset = await selectFirstLimitPullback3FTopN(
      deps({ sources: [datasetSource(), liveSourceStub] }),
      requestFor(DECISION, 2, { kind: "dataset", datasetVersionId: VERSION }),
    );
    const viaLive = await selectFirstLimitPullback3FTopN(
      deps({ sources: [datasetSource(), liveSourceStub] }),
      requestFor(DECISION, 2, { kind: "live" }),
    );

    expect(viaLive.picks.map((pick) => pick.panelSecurityId)).toEqual(
      viaDataset.picks.map((pick) => pick.panelSecurityId),
    );
    expect(viaLive.picks.map((pick) => pick.score)).toEqual(viaDataset.picks.map((pick) => pick.score));
    expect(viaLive.picks.map((pick) => pick.entryDate)).toEqual(viaDataset.picks.map((pick) => pick.entryDate));
    expect(viaLive.source).toEqual({ kind: "live", label: "内存实时（测试替身）" });
    // live 载体没有数据集坐标 —— 如实为 null，不编造。
    expect(viaLive.datasetVersionId).toBeNull();
  });

  it("未注册的载体 ⇒ 响亮拒绝（不静默回退到 dataset）", async () => {
    await expect(
      selectFirstLimitPullback3FTopN(deps(), requestFor(DECISION, 2, { kind: "live" })),
    ).rejects.toMatchObject({ code: "SELECTION_DATA_SOURCE_UNSUPPORTED" });
  });

  it("剔除统计如实（一字板 / 无回踩 / 超振幅 / 观察窗不完整）", async () => {
    const result = await selectFirstLimitPullback3FTopN(deps(), requestFor(DECISION, 3));
    expect(result.filterStats.candidateEventCount).toBe(6);
    expect(result.filterStats.rankedCandidateCount).toBe(2);
    expect(result.filterStats.excluded).toMatchObject({
      ONE_WORD_OR_T_BOARD: 1,
      NO_PULLBACK_IN_OBSERVATION_WINDOW: 1,
      MAX_AMPLITUDE_ABOVE_LIMIT: 1,
      OBSERVATION_WINDOW_INCOMPLETE: 1,
    });
    expect(result.picks.length).toBe(2);
    expect(result.dataWindow).toEqual({ startDate: T0, endDate: ENTRY });
  });

  it("剔除统计可下钻到票：excludedStocks 逐只有代码/身份/事件日，且与计数自洽", async () => {
    const result = await selectFirstLimitPullback3FTopN(deps(), requestFor(DECISION, 3));
    const stocks = result.filterStats.excludedStocks;

    // 🔴 自洽：每个原因码的「计数」= 该原因的「逐只明细」条数（同一记录流归并 ⇒ 不会对不上）。
    const counts = result.filterStats.excluded;
    for (const [reason, count] of Object.entries(counts)) {
      expect(stocks.filter((stock) => stock.reason === reason)).toHaveLength(count);
    }
    expect(stocks).toHaveLength(Object.values(counts).reduce((a, b) => a + b, 0));

    // 每只都能落到「哪只票」：代码 + canonical 身份 + 事件日。
    for (const stock of stocks) {
      expect(stock.code).toMatch(/^\d{6}\.(SH|SZ|BJ)$/);
      expect(stock.canonicalSecurityId).toMatch(/^sec_/);
      expect(stock.eventId).not.toBe("");
      expect(stock.eventDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(stocks.map((stock) => stock.reason).sort()).toEqual([
      "MAX_AMPLITUDE_ABOVE_LIMIT",
      "NO_PULLBACK_IN_OBSERVATION_WINDOW",
      "OBSERVATION_WINDOW_INCOMPLETE",
      "ONE_WORD_OR_T_BOARD",
    ]);
    // 逐只的代码互不重复（同一事件只被剔除一次）
    expect(new Set(stocks.map((stock) => stock.eventId)).size).toBe(stocks.length);
  });

  it("决策日无候选事件 ⇒ 如实空结果（不抛错、不编造）", async () => {
    const result = await selectFirstLimitPullback3FTopN(deps(), requestFor("2025-06-05"));
    expect(result.picks).toEqual([]);
    expect(result.filterStats.candidateEventCount).toBe(0);
    expect(result.dataWindow).toBeNull();
  });

  it("候选缺 rd=0 ⇒ 响亮失败", async () => {
    const source = datasetSource({ zeroBarsOverride: zeroBars.filter((bar) => bar.eventId !== "600001.SH@2024-01-02") });
    await expect(
      selectFirstLimitPullback3FTopN(deps({ sources: [source] }), requestFor(DECISION)),
    ).rejects.toMatchObject({ code: "SELECTION_EVENT_DAY_BAR_MISSING" });
  });

  it("日历缺洞（所有事件都缺 rd3 行）⇒ 响亮失败，不静默改语义", async () => {
    const source = datasetSource({ postBarsOverride: postBars.filter((bar) => bar.relativeDay !== 3) });
    const call = () => selectFirstLimitPullback3FTopN(deps({ sources: [source] }), requestFor(DECISION));
    await expect(call()).rejects.toBeInstanceOf(StockSelectionError);
    await expect(call()).rejects.toMatchObject({ code: "SELECTION_CALENDAR_INCONSISTENT" });
  });

  it("事件窗口超护栏 ⇒ 响亮失败（不静默截断成更小的候选集）", async () => {
    await expect(
      selectFirstLimitPullback3FTopN(deps({ sources: [datasetSource({ maxEvents: 3 })] }), requestFor(DECISION)),
    ).rejects.toMatchObject({ code: "SELECTION_PAGE_LIMIT_EXCEEDED" });
  });

  it("dataset 载体缺坐标 ⇒ 响亮失败（不猜版本）", async () => {
    await expect(
      selectFirstLimitPullback3FTopN(deps(), { decisionDate: DECISION, source: { kind: "dataset" } }),
    ).rejects.toMatchObject({ code: "SELECTION_DATA_SOURCE_COORDINATE_MISSING" });
  });

  it("注册表：已注册策略可枚举，未知策略响亮拒绝", () => {
    const registry = createStockSelectionRegistry(deps());
    expect(registry.list().map((strategy) => strategy.id)).toEqual([...STOCK_SELECTION_STRATEGY_IDS]);
    expect(registry.get(FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID).label).toContain("首板回踩");
    expect(() => registry.get("no-such-strategy")).toThrowError(/SELECTION_STRATEGY_UNKNOWN/);
    expect(typeof defaultStockSelectionDeps().loadIdentifiers).toBe("function");
  });
});
