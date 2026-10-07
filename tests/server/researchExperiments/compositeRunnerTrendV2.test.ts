/**
 * P1 · 趋势 v2 融合实验的静态契约测试（run() 需要真实数据，不在单测里跑）。
 */
import { describe, expect, it } from "vitest";
import {
  TREND_V2_ARMS,
  compositeRunnerNewHigh3T74TrendV2Experiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-trend-v2/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P1 · 趋势 v2 实验 descriptor", () => {
  it("能通过注册（id / pageKey / dataset 声明自洽）", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerNewHigh3T74TrendV2Experiment)).not.toThrow();
  });

  it("pageKey 与 id 相同，且声明组合执行面", () => {
    const descriptor = compositeRunnerNewHigh3T74TrendV2Experiment.descriptor;
    expect(descriptor.id).toBe("first-board-pullback/composite-runner-newhigh3-t74-trend-v2");
    expect(descriptor.pageKey).toBe(descriptor.id);
    expect(descriptor.executionSurface).toBe("COMPOSITE_PORTFOLIO");
  });

  it("四条臂：控制臂 + 三档 v2 权重，且都不使用 v1 融合 / 门槛", () => {
    expect(TREND_V2_ARMS.map((arm) => arm.v2Weight)).toEqual([null, 0.2, 0.35, 0.5]);
    const declared = compositeRunnerNewHigh3T74TrendV2Experiment
      .descriptor.compositeExecution?.extensionSelectionArms;
    expect(declared).toEqual(
      TREND_V2_ARMS.map((arm) => ({ id: arm.id, trendWeight: null, v2Weight: arm.v2Weight })),
    );
    for (const arm of declared ?? []) {
      expect(arm.trendWeight).toBeNull();
      expect(arm.minTrendScore ?? null).toBeNull();
    }
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerNewHigh3T74TrendV2Experiment.resultSchema;
    const arm = {
      id: "v2-w35",
      label: "融合 v2 35%",
      v2Weight: 0.35,
      scoredCandidates: 43528,
      droppedMissingComponents: 0,
      fullCReturnPct: 160,
      fullCTrades: 1400,
      fullCMaxDrawdownPct: 40,
      fullControlDeltaPct: 8.9,
      fullAReturnPct: null,
      runnerTrigger: null,
    };
    const payload = {
      computationVersion: "1.0.0",
      controlParity: {
        aReturnPct: 15.7876907121,
        aTrades: 1619,
        cReturnPct: 151.0958341843399,
        cTrades: 1434,
        trigger: 161,
        pass: true,
      },
      arms: [arm],
      note: "note",
    };
    expect(schema.safeParse(payload).success).toBe(true);
    const broken = { ...arm } as Record<string, unknown>;
    delete broken.droppedMissingComponents;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});