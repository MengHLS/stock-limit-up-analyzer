/**
 * 留档保存入口的正式版本物化测试。
 *
 * 目标：证明保存 `closed_loop_backtest_run` 时，只要调用方提供了 canonical
 * strategy document，就会复用正式的 `StrategyService.save` 先写 `strategy_versions`；
 * 坐标不一致必须在写任何数据前失败；不提供文档的旧路径仍只写留档。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({
  db: null as unknown,
  savedDocuments: [] as unknown[],
  saveError: null as Error | null,
}));

vi.mock("../../../server/db", () => ({
  getDb: async () => holder.db,
}));

vi.mock("../../../server/research/strategyPersistence/service", () => ({
  StrategyService: class {
    async save(input: { document: unknown }): Promise<void> {
      if (holder.saveError !== null) throw holder.saveError;
      holder.savedDocuments.push(input.document);
    }
  },
}));

vi.mock("../../../server/research/strategyPersistence/db", () => ({
  DbStrategyRepository: class {},
}));

vi.mock("../../../server/closedLoopBacktestRun/summary", () => ({
  buildClosedLoopBacktestRunSummary: () => ({
    runId: "run-1",
    datasetVersion: "v1",
    datasetVersionId: 1,
    datasetSource: null,
    recipeId: null,
    status: "COMPLETED",
    executedStageCount: 1,
    blockedStageCount: 0,
    skippedStageCount: 0,
    firstBlockedReasonCode: null,
    initialCapital: 100_000,
    finalEquity: 100_000,
    tradeCount: 0,
    equityCurvePointCount: 0,
    totalReturnPct: 0,
    maxDrawdownPct: 0,
    cagrPct: 0,
  }),
  readEvaluationStageOutput: () => null,
}));

const { saveClosedLoopBacktestRun } = await import(
  "../../../server/closedLoopBacktestRun/repository"
);

let insertedRows: unknown[] = [];

function makeDb(): Record<string, unknown> {
  const insertChain = {
    values(values: unknown) {
      insertedRows.push(values);
      return insertChain;
    },
    async onDuplicateKeyUpdate() {
      return undefined;
    },
  };
  const selectChain: Record<string, unknown> = {};
  selectChain.from = () => selectChain;
  selectChain.where = () => selectChain;
  selectChain.then = (resolve: (rows: unknown[]) => unknown) =>
    Promise.resolve([{ id: 9 }]).then(resolve);
  return {
    insert: () => insertChain,
    select: () => selectChain,
  };
}

const RESULT = { runId: "run-1" } as never;

beforeEach(() => {
  holder.db = makeDb();
  holder.savedDocuments = [];
  holder.saveError = null;
  insertedRows = [];
});

describe("saveClosedLoopBacktestRun · canonical strategy document", () => {
  it("带 canonical document 时先通过 StrategyService.save 写正式版本，再写留档", async () => {
    const document = {
      strategyId: "s1",
      version: "1.2.3",
      fingerprint: "fp-1",
    };

    await expect(saveClosedLoopBacktestRun({
      experimentId: "exp-1",
      strategyId: "s1",
      strategyVersion: "1.2.3",
      startDate: "2025-01-01",
      endDate: "2025-01-31",
      strategyDocument: document as never,
      result: RESULT,
    })).resolves.toBe(9);

    expect(holder.savedDocuments).toEqual([document]);
    expect(insertedRows).toHaveLength(1);
  });

  it("document 坐标与留档坐标不一致时立即失败，不写正式版本也不写留档", async () => {
    await expect(saveClosedLoopBacktestRun({
      experimentId: "exp-1",
      strategyId: "s1",
      strategyVersion: "1.2.3",
      startDate: "2025-01-01",
      endDate: "2025-01-31",
      strategyDocument: {
        strategyId: "s1",
        version: "9.9.9",
        fingerprint: "fp-1",
      } as never,
      result: RESULT,
    })).rejects.toThrow(/坐标不一致/);

    expect(holder.savedDocuments).toEqual([]);
    expect(insertedRows).toEqual([]);
  });

  it("不带 document 的旧路径仍只写留档，兼容已有调用方", async () => {
    await expect(saveClosedLoopBacktestRun({
      experimentId: "exp-1",
      strategyId: "s1",
      strategyVersion: "1.2.3",
      startDate: "2025-01-01",
      endDate: "2025-01-31",
      result: RESULT,
    })).resolves.toBe(9);

    expect(holder.savedDocuments).toEqual([]);
    expect(insertedRows).toHaveLength(1);
  });
});
