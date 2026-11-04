/** P4 · 选股广度实验的静态契约测试。 */
import { describe, expect, it } from "vitest";
import {
  TOP5_ARMS,
  compositeRunnerT74Top5Experiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-top5/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P4 · 选股广度 TopN 3->5 descriptor", () => {
  it("能通过注册", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74Top5Experiment)).not.toThrow();
  });

  it("四条臂：控制 top3，其余 top5（含名额/仓位组合）", () => {
    expect(TOP5_ARMS.map((arm) => [arm.selectionTopN, arm.maxDailyBuys, arm.maxPositions])).toEqual([
      [3, 2, 5],
      [5, 4, 5],
      [5, 5, 5],
      [5, 5, 8],
    ]);
  });

  it("provider 必须为 top5 臂装载 rank4/5 扩展行（topN 声明）", () => {
    const declared = compositeRunnerT74Top5Experiment.descriptor.compositeExecution?.extensionSelectionArms;
    expect(declared).toEqual([
      { id: "control", trendWeight: null, topN: 3 },
      { id: "top5", trendWeight: null, topN: 5 },
    ]);
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerT74Top5Experiment.resultSchema;
    const arm = {
      id: "top5-3-5",
      label: "top5 / 3 笔 / 5 仓",
      selectionTopN: 5,
      maxDailyBuys: 3,
      maxPositions: 5,
      fullCReturnPct: 170,
      fullCMaxDrawdownPct: 52,
      fullCTrades: 1800,
      fullControlDeltaPct: 19,
      fullAReturnPct: null,
      runnerTrigger: null,
      bigWin50Count: 13,
      bigWin100Count: 3,
      extraRankTrades: 300,
      extraRankNetPnl: 12000,
      extraRankBigWin50: 3,
    };
    const payload = {
      computationVersion: "1.0.0",
      controlParity: { aReturnPct: 15.79, aTrades: 1619, cReturnPct: 151.1, cTrades: 1434, trigger: 161, pass: true },
      arms: [arm],
      note: "note",
    };
    expect(schema.safeParse(payload).success).toBe(true);
    const broken = { ...arm } as Record<string, unknown>;
    delete broken.extraRankNetPnl;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});
