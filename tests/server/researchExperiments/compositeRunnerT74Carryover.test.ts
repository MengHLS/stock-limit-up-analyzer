/** P6 · 跨日候选池实验的静态契约测试。 */
import { describe, expect, it } from "vitest";
import {
  CARRY_ARMS,
  compositeRunnerT74CarryoverExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-carryover/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P6 · 跨日候选池 descriptor", () => {
  it("能通过注册", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74CarryoverExperiment)).not.toThrow();
  });

  it("第一轮四条臂冻结 top3/top5、买入名额和 carry 参数", () => {
    expect(CARRY_ARMS.map((arm) => [
      arm.id,
      arm.selectionTopN,
      arm.maxDailyBuys,
      arm.maxPositions,
      arm.carryMaxAgeDays,
      arm.replacementScoreMargin,
    ])).toEqual([
      ["control", 3, 2, 5, 0, 0],
      ["carry1-stale", 5, 2, 5, 1, 0],
      ["carry1-m03", 5, 2, 5, 1, 0.03],
      ["carry2-m03", 5, 2, 5, 2, 0.03],
    ]);
  });

  it("provider 必须为 carry 臂装载 top5 扩展行", () => {
    const declared = compositeRunnerT74CarryoverExperiment.descriptor.compositeExecution?.extensionSelectionArms;
    expect(declared).toEqual([
      { id: "control", trendWeight: null, topN: 3 },
      { id: "carry", trendWeight: null, topN: 5 },
    ]);
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerT74CarryoverExperiment.resultSchema;
    const arm = {
      id: "carry1-m03",
      label: "top5 + carry1 · margin 0.03",
      selectionTopN: 5,
      maxDailyBuys: 2,
      maxPositions: 5,
      carryMaxAgeDays: 1,
      replacementScoreMargin: 0.03,
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
    delete broken.carryTrades;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});
