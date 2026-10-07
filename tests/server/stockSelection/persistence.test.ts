/**
 * STOCK-SELECTION-005/007 —— 选股快照持久化单测（纯函数 + 内存 store，**不连库**）。
 *
 * 覆盖：
 *   1. runId 确定性（同坐标同 id；TopN / 载体 / 版本 / 日期任一不同 ⇒ 不同 id）；
 *   2. 剔除统计（**计数 + 逐只明细**）序列化键序稳定 + 往返不丢；
 *   3. 兼容旧的「纯计数」JSON 形状（历史行仍可读）；
 *   4. picks / 剔除统计 JSON 损坏 ⇒ **响亮抛错**（不静默当成空）；
 *   5. `toInsertValues` 冻结「候选 / 合格 / 剔除计数 / 剔除明细 / 清单 / 数据窗口」；
 *   6. 内存 store 语义与 DB 一致：同 runId 覆盖（幂等），list / get 可回看（含剔除明细）。
 */

import { describe, expect, it } from "vitest";
import {
  buildSelectionRunId,
  createMemoryStockSelectionRunStore,
  normalizeListLimit,
  parseExcluded,
  parsePicks,
  serializeExcluded,
  toInsertValues,
  STOCK_SELECTION_RUN_LIST_DEFAULT_LIMIT,
  STOCK_SELECTION_RUN_LIST_MAX_LIMIT,
} from "../../../server/stockSelection/persistence";
import type { DailyStockSelection, StockSelectionExcludedStock } from "../../../server/stockSelection";

const PICK = {
  rank: 1,
  rankPercentile: 0.01,
  score: 0.8123,
  canonicalSecurityId: "sec_test-1",
  panelSecurityId: "sec_test-1::event:EV-1@2024-02-15",
  code: "600000.SH",
  eventId: "EV-1",
  eventDate: "2024-02-15",
  signalDate: "2024-02-22",
  entryDate: "2024-02-23",
  detail: { decisionRelativeDay: 5 },
} as const;

const EXCLUDED_STOCKS: StockSelectionExcludedStock[] = [
  {
    canonicalSecurityId: "sec_test-2",
    code: "600001.SH",
    eventId: "EV-2",
    eventDate: "2024-02-15",
    reason: "ONE_WORD_OR_T_BOARD",
  },
  {
    canonicalSecurityId: "sec_test-3",
    code: "600002.SH",
    eventId: "EV-3",
    eventDate: "2024-02-16",
    reason: "NO_PULLBACK_IN_OBSERVATION_WINDOW",
  },
];

function run(overrides: Partial<DailyStockSelection> = {}): DailyStockSelection {
  return {
    strategyId: "first-limit-pullback-3f-topn",
    strategyLabel: "首板回踩 · 3F Top-N",
    source: { kind: "dataset", label: "数据集快照" },
    datasetVersionId: 780001,
    decisionDate: "2024-02-22",
    topN: 3,
    picks: [PICK],
    filterStats: {
      candidateEventCount: 47,
      rankedCandidateCount: 22,
      excluded: { ONE_WORD_OR_T_BOARD: 1, NO_PULLBACK_IN_OBSERVATION_WINDOW: 1 },
      excludedStocks: EXCLUDED_STOCKS,
    },
    dataWindow: { startDate: "2024-02-15", endDate: "2024-02-23" },
    ...overrides,
  };
}

describe("buildSelectionRunId", () => {
  it("同坐标 ⇒ 同 runId（重复保存即覆盖，不新增行）", () => {
    const a = buildSelectionRunId({ strategyId: "s", sourceKind: "dataset", datasetVersionId: 1, decisionDate: "2024-02-22", topN: 3 });
    const b = buildSelectionRunId({ strategyId: "s", sourceKind: "dataset", datasetVersionId: 1, decisionDate: "2024-02-22", topN: 3 });
    expect(a).toBe(b);
    expect(a).toMatch(/^SEL-20240222-[0-9a-f]{8}$/);
  });

  it("TopN / 载体 / 版本 / 日期任一不同 ⇒ 不同 runId（各自独立成行）", () => {
    const base = { strategyId: "s", sourceKind: "dataset", datasetVersionId: 1, decisionDate: "2024-02-22", topN: 3 } as const;
    const ids = new Set([
      buildSelectionRunId(base),
      buildSelectionRunId({ ...base, topN: 5 }),
      buildSelectionRunId({ ...base, sourceKind: "live" }),
      buildSelectionRunId({ ...base, datasetVersionId: 2 }),
      buildSelectionRunId({ ...base, decisionDate: "2024-02-23" }),
    ]);
    expect(ids.size).toBe(5);
  });

  it("live 载体（datasetVersionId=null）不因 null 与 0/1 混淆", () => {
    const live = buildSelectionRunId({ strategyId: "s", sourceKind: "live", datasetVersionId: null, decisionDate: "2024-02-22", topN: 3 });
    const ds = buildSelectionRunId({ strategyId: "s", sourceKind: "dataset", datasetVersionId: 0, decisionDate: "2024-02-22", topN: 3 });
    expect(live).not.toBe(ds);
  });
});

describe("剔除统计 / 清单 序列化", () => {
  it("计数键序稳定（同一输入不同插入序 ⇒ 同一 JSON 文本）", () => {
    const a = serializeExcluded({ B: 2, A: 1 }, []);
    const b = serializeExcluded({ A: 1, B: 2 }, []);
    expect(a).toBe(b);
    expect(JSON.parse(a).counts).toEqual({ A: 1, B: 2 });
  });

  it("往返不丢：计数 + **逐只明细**都回来", () => {
    const counts = { ONE_WORD_OR_T_BOARD: 1, NO_PULLBACK_IN_OBSERVATION_WINDOW: 1 };
    const parsed = parseExcluded(serializeExcluded(counts, EXCLUDED_STOCKS));
    expect(parsed.counts).toEqual(counts);
    expect(parsed.stocks).toEqual(EXCLUDED_STOCKS);
    // 自洽：明细条数 = 计数之和
    expect(parsed.stocks).toHaveLength(Object.values(parsed.counts).reduce((a, b) => a + b, 0));
  });

  it("兼容历史「纯计数」JSON 形状（无 counts 键 ⇒ 视作计数、明细为空）", () => {
    const parsed = parseExcluded('{"ONE_WORD_OR_T_BOARD":3}');
    expect(parsed.counts).toEqual({ ONE_WORD_OR_T_BOARD: 3 });
    expect(parsed.stocks).toEqual([]);
  });

  it("JSON 损坏 / 形状非法 ⇒ 响亮抛错（不静默当成空）", () => {
    expect(() => parseExcluded("{not json")).toThrow(/解析失败/);
    expect(() => parseExcluded("[1,2]")).toThrow(/形状非法/);
    expect(() => parseExcluded('{"counts":[1]}')).toThrow(/形状非法/);
    expect(() => parseExcluded('{"counts":{"A":"3"}}')).toThrow(/条目非法/);
    expect(() => parseExcluded('{"counts":{},"stocks":{}}')).toThrow(/stocks/);
    expect(() => parsePicks("{not json")).toThrow(/解析失败/);
    expect(() => parsePicks('{"a":1}')).toThrow(/形状非法/);
  });

  it("清单往返保留全部字段", () => {
    expect(parsePicks(JSON.stringify([PICK]))).toEqual([PICK]);
  });
});

describe("toInsertValues", () => {
  it("冻结候选/合格/剔除(计数+明细)/清单/窗口", () => {
    const capturedAt = new Date("2026-10-06T12:00:00.000Z");
    const values = toInsertValues(run(), capturedAt);
    expect(values.runId).toMatch(/^SEL-20240222-/);
    expect(values.candidateEventCount).toBe(47);
    expect(values.rankedCandidateCount).toBe(22);
    const exclusion = parseExcluded(values.excludedJson);
    expect(exclusion.counts).toEqual({
      NO_PULLBACK_IN_OBSERVATION_WINDOW: 1,
      ONE_WORD_OR_T_BOARD: 1,
    });
    expect(exclusion.stocks.map((s) => s.code)).toEqual(["600001.SH", "600002.SH"]);
    expect(parsePicks(values.picksJson)).toHaveLength(1);
    expect(values.dataWindowStartDate).toBe("2024-02-15");
    expect(values.dataWindowEndDate).toBe("2024-02-23");
    expect(values.capturedAt).toBe(capturedAt);
  });

  it("无数据窗口（空态）⇒ 起止日为 null、剔除为空", () => {
    const values = toInsertValues(
      run({
        dataWindow: null,
        picks: [],
        filterStats: { candidateEventCount: 0, rankedCandidateCount: 0, excluded: {}, excludedStocks: [] },
      }),
      new Date(),
    );
    expect(values.dataWindowStartDate).toBeNull();
    expect(values.dataWindowEndDate).toBeNull();
    expect(parseExcluded(values.excludedJson)).toEqual({ counts: {}, stocks: [] });
  });
});

describe("normalizeListLimit", () => {
  it("缺省 / 非法 → 默认；超上限 → 上限", () => {
    expect(normalizeListLimit(undefined)).toBe(STOCK_SELECTION_RUN_LIST_DEFAULT_LIMIT);
    expect(normalizeListLimit(0)).toBe(STOCK_SELECTION_RUN_LIST_DEFAULT_LIMIT);
    expect(normalizeListLimit(Number.NaN)).toBe(STOCK_SELECTION_RUN_LIST_DEFAULT_LIMIT);
    expect(normalizeListLimit(5)).toBe(5);
    expect(normalizeListLimit(9999)).toBe(STOCK_SELECTION_RUN_LIST_MAX_LIMIT);
  });
});

describe("内存 store（与 DB 语义一致）", () => {
  it("save → list → get 往返；同 runId 覆盖不新增（含剔除明细）", async () => {
    const store = createMemoryStockSelectionRunStore();
    const saved = await store.save(run());
    expect(saved.pickCount).toBe(1);
    expect(saved.excluded).toEqual({ NO_PULLBACK_IN_OBSERVATION_WINDOW: 1, ONE_WORD_OR_T_BOARD: 1 });
    expect(saved.excludedStocks.map((s) => s.code)).toEqual(["600001.SH", "600002.SH"]);

    await store.save(run({ topN: 3 })); // 同坐标 ⇒ 覆盖
    const list = await store.list(10);
    expect(list).toHaveLength(1);
    expect(list[0]!.excludedStocks).toHaveLength(2);

    const detail = await store.get(saved.runId);
    expect(detail?.picks).toHaveLength(1);
    expect(detail?.excludedStocks.map((s) => s.reason)).toEqual([
      "ONE_WORD_OR_T_BOARD",
      "NO_PULLBACK_IN_OBSERVATION_WINDOW",
    ]);
  });

  it("不同 TopN ⇒ 独立成行；get 未知 runId = null", async () => {
    const store = createMemoryStockSelectionRunStore();
    await store.save(run({ topN: 3 }));
    await store.save(run({ topN: 5 }));
    expect(await store.list(10)).toHaveLength(2);
    expect(await store.get("SEL-19700101-deadbeef")).toBeNull();
  });
});