/** P10 · 候选池上市龄过滤实验的静态契约测试。 */
import { describe, expect, it } from "vitest";
import {
  SUBNEW_ARMS,
  compositeRunnerT74SubNewExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-subnew/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P10 · 候选池上市龄过滤 descriptor", () => {
  it("能通过注册", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74SubNewExperiment)).not.toThrow();
  });

  it("四条臂：控制臂不过滤，其余 365 / 180 / 90", () => {
    expect(SUBNEW_ARMS.map((arm) => arm.excludeListedWithinDays)).toEqual([null, 365, 180, 90]);
  });

  it("provider 必须按同一坐标声明过滤臂（否则扩展示例行会缺失）", () => {
    const declared = compositeRunnerT74SubNewExperiment.descriptor.compositeExecution?.extensionSelectionArms;
    expect(declared).toEqual([
      { id: "control", trendWeight: null, excludeListedWithinDays: null },
      { id: "excl365", trendWeight: null, excludeListedWithinDays: 365 },
      { id: "excl180", trendWeight: null, excludeListedWithinDays: 180 },
      { id: "excl90", trendWeight: null, excludeListedWithinDays: 90 },
    ]);
  });

  it("descriptor 冻结坐标：baseline=660001、executionSurface=COMPOSITE_PORTFOLIO、决策日 rd5", () => {
    const descriptor = compositeRunnerT74SubNewExperiment.descriptor;
    expect(descriptor.executionSurface).toBe("COMPOSITE_PORTFOLIO");
    expect(descriptor.compositeExecution?.baselineDatasetVersionId).toBe(660001);
    expect(descriptor.datasetRequirement.decisionOffsetDays).toBe(5);
    expect(descriptor.datasetRequirement.usesForwardData).toBe(true);
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerT74SubNewExperiment.resultSchema;
    const arm = {
      id: "excl365",
      label: "剔除上市 < 365 日",
      excludeListedWithinDays: 365,
      fullAReturnPct: null,
      fullATrades: null,
      fullCReturnPct: 160,
      fullCTrades: 1400,
      fullCMaxDrawdownPct: 42,
      fullControlDeltaPct: 8.9,
      runnerTrigger: null,
      bigWin50Count: 10,
      bigWin100Count: 2,
      listingEvaluatedCandidates: 70000,
      listingExcludedCandidates: 5000,
      listingUnknownDateCandidates: 0,
      subNewTrades: 0,
      subNewNetPnl: 0,
      subNewBigWin50: 0,
    };
    const payload = {
      computationVersion: "1.0.0",
      controlParity: { aReturnPct: 15.79, aTrades: 1619, cReturnPct: 151.1, cTrades: 1434, trigger: 161, pass: true },
      arms: [arm],
      note: "note",
    };
    expect(schema.safeParse(payload).success).toBe(true);
    const broken = { ...arm } as Record<string, unknown>;
    delete broken.listingExcludedCandidates;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});
