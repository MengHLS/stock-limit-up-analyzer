/** P7 · 跨日候选池 + 当日重评分 descriptor 的静态契约测试。 */
import { describe, expect, it } from "vitest";
import {
  REFRESH_ARMS,
  compositeRunnerT74CarryoverRefreshExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-carryover-refresh/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P7 · 跨日候选池 + 当日重评分 descriptor", () => {
  it("能通过注册", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74CarryoverRefreshExperiment)).not.toThrow();
  });

  it("臂矩阵：control / refresh-only w20/w35 / carry1 refresh w20/w35", () => {
    expect(REFRESH_ARMS.map((arm) => [
      arm.id,
      arm.selectionTopN,
      arm.carryMaxAgeDays,
      arm.refreshWeight,
    ])).toEqual([
      ["control", 3, 0, null],
      ["refresh-only-w20", 5, 0, 0.2],
      ["refresh-only-w35", 5, 0, 0.35],
      ["carry1-refresh-w20", 5, 1, 0.2],
      ["carry1-refresh-w35", 5, 1, 0.35],
    ]);
  });

  it("provider 为 top5 臂装载扩展行", () => {
    const declared = compositeRunnerT74CarryoverRefreshExperiment.descriptor.compositeExecution?.extensionSelectionArms;
    expect(declared).toEqual([
      { id: "control", trendWeight: null, topN: 3 },
      { id: "carry", trendWeight: null, topN: 5 },
    ]);
  });

  it("resultSchema 要求 refreshWeight，拒绝缺字段载荷", () => {
    const schema = compositeRunnerT74CarryoverRefreshExperiment.resultSchema;
    const arm = {
      id: "carry1-refresh-w20",
      label: "top5 + carry1 + refresh · w0.20",
      selectionTopN: 5,
      maxDailyBuys: 2,
      maxPositions: 5,
      carryMaxAgeDays: 1,
      replacementScoreMargin: 0,
      refreshWeight: 0.2,
      fullCReturnPct: 160,
      fullCMaxDrawdownPct: 42,
      fullCTrades: 1500,
      fullControlDeltaPct: 9,
      fullAReturnPct: null,
      runnerTrigger: null,
      bigWin50Count: 11,
      bigWin100Count: 3,
      carryQueuedCandidates: 300,
      carryConsideredCandidates: 200,
      carrySelectedCandidates: 20,
      carryAttemptedCandidates: 10,
      carryExpiredCandidates: 180,
      refreshUnscorableCarryCandidates: 3,
      carryTrades: 8,
      carryNetPnl: 12000,
      carryBigWin50Count: 2,
    };
    const payload = {
      computationVersion: "1.0.0",
      controlParity: { aReturnPct: 15.79, aTrades: 1619, cReturnPct: 151.1, cTrades: 1434, trigger: 161, pass: true },
      arms: [arm],
      note: "note",
    };
    expect(schema.safeParse(payload).success).toBe(true);
    const broken = { ...arm } as Record<string, unknown>;
    delete broken.refreshWeight;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});
