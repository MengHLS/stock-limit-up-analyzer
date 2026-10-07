/**
 * P0 · 趋势融合实验的**静态契约**测试。
 *
 * `run()` 需要真实数据集 + 平台 provider（不在单测里跑），但 descriptor 与臂表是
 * **纯静态**的，必须被钉住 —— 尤其是「扩展行按并集装载」这条公平性前提：一旦臂表与
 * `compositeExecution.extensionSelectionArms` 漂移，融合臂会在 rd16 被数据边界截断，
 * 而结果看上去仍然「正常」（静默失真）。
 */
import { describe, expect, it } from "vitest";
import {
  TREND_FUSION_ARMS,
  compositeRunnerNewHigh3T74TrendExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-trend/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P0 · 趋势融合实验 descriptor", () => {
  it("能通过注册（id / pageKey / dataset 声明自洽）", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerNewHigh3T74TrendExperiment)).not.toThrow();
  });

  it("pageKey 与 id 相同，且声明组合执行面", () => {
    const descriptor = compositeRunnerNewHigh3T74TrendExperiment.descriptor;
    expect(descriptor.id).toBe("first-board-pullback/composite-runner-newhigh3-t74-trend");
    expect(descriptor.pageKey).toBe(descriptor.id);
    expect(descriptor.executionSurface).toBe("COMPOSITE_PORTFOLIO");
    expect(descriptor.datasetRequirement.datasetCode).toBe("first_limit_pullback");
    expect(descriptor.datasetRequirement.usesForwardData).toBe(true);
  });

  it("扩展行装载臂集合与臂表逐项一致（公平性前提，不得漂移）", () => {
    const declared = compositeRunnerNewHigh3T74TrendExperiment
      .descriptor.compositeExecution?.extensionSelectionArms;
    expect(declared).toEqual(
      TREND_FUSION_ARMS.map((arm) => ({ id: arm.id, trendWeight: arm.trendWeight })),
    );
  });

  it("四条臂：恰好一个控制臂（trendWeight=null）+ 三档权重", () => {
    expect(TREND_FUSION_ARMS.map((arm) => arm.trendWeight)).toEqual([null, 0.2, 0.3, 0.5]);
    expect(new Set(TREND_FUSION_ARMS.map((arm) => arm.id)).size).toBe(TREND_FUSION_ARMS.length);
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerNewHigh3T74TrendExperiment.resultSchema;
    const arm = {
      id: "control",
      label: "控制臂 · 纯 3F（T74）",
      trendWeight: null,
      fusionScoredCandidates: null,
      fusionDroppedCandidates: null,
      fullCReturnPct: 151.0958341843399,
      fullCTrades: 1434,
      fullCMaxDrawdownPct: 12.3,
      fullControlDeltaPct: 0,
      fullAReturnPct: 15.7876907121,
      holdoutCReturnPct: 89.48,
      holdoutCMaxDrawdownPct: 14.06,
      holdoutControlDeltaPct: 0,
      runnerTrigger: 161,
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
    delete broken.fullCTrades;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});