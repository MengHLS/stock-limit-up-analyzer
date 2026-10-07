/**
 * STOCK-SELECTION-001/002 —— 选股 Router 单测（注入替身 registry，**不连库**）。
 *
 * 覆盖：
 *   1. `listStrategies` 暴露策略元数据（页面据此渲染策略选择器）；
 *   2. `select` 只把「决策日 + TopN + 数据载体」交给策略（不泄漏 strategyId / 数据集细节）；
 *   3. 未知策略 ⇒ BAD_REQUEST；
 *   4. 域错误（缺 rd0 / 载体未注册）⇒ INTERNAL_SERVER_ERROR，消息带错误码；
 *   5. 非法决策日 / 非法载体 kind ⇒ 输入校验拒绝；
 *   6. `appRouter` 已注册 `stockSelection`（端点可达守卫）。
 */

import { describe, expect, it, vi } from "vitest";
import { buildStockSelectionRouter } from "../../server/stockSelectionRouter";
import { appRouter } from "../../server/routers";
import {
  FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
  StockSelectionError,
  createMemoryStockSelectionRunStore,
  type DailyStockSelection,
  type StockSelectionRegistry,
  type StockSelectionRequest,
  type StockSelectionStrategy,
} from "../../server/stockSelection";

const ctx = { req: {} as never, res: {} as never, user: null };

const RESULT: DailyStockSelection = {
  strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
  strategyLabel: "首板回踩 · 3F Top-N",
  source: { kind: "dataset", label: "测试数据集载体" },
  datasetVersionId: 780001,
  decisionDate: "2024-02-22",
  topN: 3,
  picks: [],
  filterStats: { candidateEventCount: 0, rankedCandidateCount: 0, excluded: {}, excludedStocks: [] },
  dataWindow: null,
};

function makeRegistry(select: StockSelectionStrategy["select"] = async () => RESULT): StockSelectionRegistry {
  const strategy: StockSelectionStrategy = {
    id: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
    label: "首板回踩 · 3F Top-N",
    description: "测试用策略描述",
    datasetId: 120001,
    select,
  };
  return {
    list: () => [strategy],
    listDataSources: () => [{ kind: "dataset" as const, label: "测试数据集载体" }],
    get: (strategyId: string) => {
      if (strategyId !== strategy.id) {
        throw new StockSelectionError("SELECTION_STRATEGY_UNKNOWN", `未注册的选股策略：${strategyId}`);
      }
      return strategy;
    },
  };
}

const DATASET_SOURCE = { kind: "dataset" as const, datasetVersionId: 780001 };

describe("STOCK-SELECTION-001 · 选股 Router", () => {
  it("listStrategies 暴露策略元数据（含 datasetId，页面不硬编码）", async () => {
    const caller = buildStockSelectionRouter(makeRegistry()).createCaller(ctx);
    const strategies = await caller.listStrategies();
    expect(strategies).toEqual([
      {
        id: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
        label: "首板回踩 · 3F Top-N",
        description: "测试用策略描述",
        datasetId: 120001,
      },
    ]);
  });

  it("listDataSources 暴露可选数据载体（页面「数据来源」选择器）", async () => {
    const caller = buildStockSelectionRouter(makeRegistry()).createCaller(ctx);
    await expect(caller.listDataSources()).resolves.toEqual([{ kind: "dataset", label: "测试数据集载体" }]);
  });

  it("select 只把「决策日 + TopN + 载体」交给策略（不泄漏 strategyId）", async () => {
    const select = vi.fn(async () => RESULT);
    const caller = buildStockSelectionRouter(makeRegistry(select)).createCaller(ctx);
    await expect(
      caller.select({
        strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
        decisionDate: "2024-02-22",
        topN: 3,
        source: DATASET_SOURCE,
      }),
    ).resolves.toEqual(RESULT);

    const passed = select.mock.calls[0]![0] as Partial<StockSelectionRequest> & { strategyId?: string };
    expect(passed).toEqual({ decisionDate: "2024-02-22", topN: 3, source: DATASET_SOURCE });
    expect(passed.strategyId).toBeUndefined();
  });

  it("未知策略 ⇒ BAD_REQUEST（不静默回退到默认策略）", async () => {
    const caller = buildStockSelectionRouter(makeRegistry()).createCaller(ctx);
    await expect(
      caller.select({ strategyId: "no-such-strategy", decisionDate: "2024-02-22", source: DATASET_SOURCE }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("域错误（载体未注册）⇒ INTERNAL_SERVER_ERROR，且消息带错误码", async () => {
    const failing: StockSelectionStrategy["select"] = async () => {
      throw new StockSelectionError("SELECTION_DATA_SOURCE_UNSUPPORTED", "数据载体 live 未注册");
    };
    const caller = buildStockSelectionRouter(makeRegistry(failing)).createCaller(ctx);
    await expect(
      caller.select({ strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID, decisionDate: "2024-02-22", source: { kind: "live" } }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringContaining("SELECTION_DATA_SOURCE_UNSUPPORTED"),
    });
  });

  it("非法决策日 / 非法载体 kind ⇒ 输入校验拒绝（不落到策略）", async () => {
    const select = vi.fn(async () => RESULT);
    const caller = buildStockSelectionRouter(makeRegistry(select)).createCaller(ctx);
    await expect(
      caller.select({ strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID, decisionDate: "2024-02-30", source: DATASET_SOURCE }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.select({
        strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
        decisionDate: "2024-02-22",
        // @ts-expect-error 故意传入非法载体 kind（校验层必须拒绝）
        source: { kind: "tape" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(select).not.toHaveBeenCalled();
  });

  it("appRouter 已注册 stockSelection（端点可达守卫）", () => {
    expect(appRouter._def.procedures).toHaveProperty("stockSelection.listStrategies");
    expect(appRouter._def.procedures).toHaveProperty("stockSelection.listDataSources");
    expect(appRouter._def.procedures).toHaveProperty("stockSelection.select");
    expect(appRouter._def.procedures).toHaveProperty("stockSelection.saveRun");
    expect(appRouter._def.procedures).toHaveProperty("stockSelection.listRuns");
    expect(appRouter._def.procedures).toHaveProperty("stockSelection.getRun");
  });
});

/** STOCK-SELECTION-005 的夹具：带 picks + 非空剔除统计。 */
const RICH_RESULT: DailyStockSelection = {
  ...RESULT,
  picks: [
    {
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
    },
  ],
  filterStats: {
    candidateEventCount: 47,
    rankedCandidateCount: 22,
    excluded: { ONE_WORD_OR_T_BOARD: 1, NO_PULLBACK_IN_OBSERVATION_WINDOW: 1 },
    excludedStocks: [
      {
        canonicalSecurityId: "sec_test-2",
        code: "600001.SH",
        eventId: "EV-2",
        eventDate: "2026-09-23",
        reason: "ONE_WORD_OR_T_BOARD",
      },
      {
        canonicalSecurityId: "sec_test-3",
        code: "600002.SH",
        eventId: "EV-3",
        eventDate: "2026-09-24",
        reason: "NO_PULLBACK_IN_OBSERVATION_WINDOW",
      },
    ],
  },
  dataWindow: { startDate: "2024-02-15", endDate: "2024-02-23" },
};

describe("STOCK-SELECTION-005 · 选股结果保存与回看", () => {
  it("saveRun 落库并返回列表行；剔除统计逐一保留", async () => {
    const store = createMemoryStockSelectionRunStore();
    const caller = buildStockSelectionRouter(makeRegistry(async () => RICH_RESULT), store).createCaller(ctx);
    const saved = await caller.saveRun({
      strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
      decisionDate: "2024-02-22",
      topN: 3,
      source: DATASET_SOURCE,
    });
    expect(saved.runId).toMatch(/^SEL-20240222-/);
    expect(saved.candidateEventCount).toBe(47);
    expect(saved.rankedCandidateCount).toBe(22);
    expect(saved.pickCount).toBe(1);
    expect(saved.excluded).toEqual({ NO_PULLBACK_IN_OBSERVATION_WINDOW: 1, ONE_WORD_OR_T_BOARD: 1 });
    // 🔴 剔除的**具体股票**也要落库并可读回（用户需求：展示被剔除的票，不只是条数）
    expect(saved.excludedStocks).toHaveLength(2);
    expect(saved.excludedStocks.map((s) => [s.code, s.reason])).toEqual([
      ["600001.SH", "ONE_WORD_OR_T_BOARD"],
      ["600002.SH", "NO_PULLBACK_IN_OBSERVATION_WINDOW"],
    ]);
    expect(saved.datasetVersionId).toBe(780001);
  });

  it("同坐标重复 saveRun ⇒ 幂等覆盖（list 只有 1 条）", async () => {
    const store = createMemoryStockSelectionRunStore();
    const caller = buildStockSelectionRouter(makeRegistry(async () => RICH_RESULT), store).createCaller(ctx);
    const input = {
      strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
      decisionDate: "2024-02-22",
      topN: 3,
      source: DATASET_SOURCE,
    };
    const first = await caller.saveRun(input);
    const second = await caller.saveRun(input);
    expect(second.runId).toBe(first.runId);
    await expect(caller.listRuns({ limit: 20 })).resolves.toHaveLength(1);
  });

  it("listRuns 返回剔除统计（不含 picks）；getRun 返回 picks 明细", async () => {
    const store = createMemoryStockSelectionRunStore();
    const caller = buildStockSelectionRouter(makeRegistry(async () => RICH_RESULT), store).createCaller(ctx);
    const saved = await caller.saveRun({
      strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID,
      decisionDate: "2024-02-22",
      topN: 3,
      source: DATASET_SOURCE,
    });

    const list = await caller.listRuns({ limit: 20 });
    expect(list).toHaveLength(1);
    expect(list[0]!.excluded).toEqual({ NO_PULLBACK_IN_OBSERVATION_WINDOW: 1, ONE_WORD_OR_T_BOARD: 1 });
    expect(list[0]!.excludedStocks.map((s) => s.code)).toEqual(["600001.SH", "600002.SH"]);
    expect(list[0]).not.toHaveProperty("picks");

    const detail = await caller.getRun({ runId: saved.runId });
    expect(detail?.picks).toHaveLength(1);
    expect(detail?.picks[0]!.code).toBe("600000.SH");
    await expect(caller.getRun({ runId: "SEL-19700101-deadbeef" })).resolves.toBeNull();
  });

  it("saveRun 走同一注册表：未知策略 ⇒ BAD_REQUEST（不落库）", async () => {
    const store = createMemoryStockSelectionRunStore();
    const caller = buildStockSelectionRouter(makeRegistry(), store).createCaller(ctx);
    await expect(
      caller.saveRun({ strategyId: "no-such-strategy", decisionDate: "2024-02-22", source: DATASET_SOURCE }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.listRuns({ limit: 20 })).resolves.toEqual([]);
  });

  it("合法日期校验与 select 一致（非法决策日 ⇒ BAD_REQUEST，不落库）", async () => {
    const store = createMemoryStockSelectionRunStore();
    const caller = buildStockSelectionRouter(makeRegistry(async () => RICH_RESULT), store).createCaller(ctx);
    await expect(
      caller.saveRun({ strategyId: FIRST_LIMIT_PULLBACK_3F_STRATEGY_ID, decisionDate: "2024-02-30", source: DATASET_SOURCE }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.listRuns({ limit: 20 })).resolves.toEqual([]);
  });
});
