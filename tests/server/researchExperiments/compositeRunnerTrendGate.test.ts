/**
 * P0-2 · 趋势门槛实验的静态契约测试（run() 需要真实数据，不在单测里跑）。
 *
 * 重点是「排序不改、只加门槛」这条语义前提：一旦门槛臂偷偷改了排序，或门槛臂没被登记进
 * extensionSelectionArms（导致扩展行缺失、在 rd16 被截断），结果都会看似正常。
 */
import { describe, expect, it } from "vitest";
import {
  TREND_GATE_ARMS,
  compositeRunnerNewHigh3T74TrendGateExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-trend-gate/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P0-2 · 趋势门槛实验 descriptor", () => {
  it("能通过注册（id / pageKey / dataset 声明自洽）", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerNewHigh3T74TrendGateExperiment)).not.toThrow();
  });

  it("pageKey 与 id 相同，且声明组合执行面", () => {
    const descriptor = compositeRunnerNewHigh3T74TrendGateExperiment.descriptor;
    expect(descriptor.id).toBe("first-board-pullback/composite-runner-newhigh3-t74-trend-gate");
    expect(descriptor.pageKey).toBe(descriptor.id);
    expect(descriptor.executionSurface).toBe("COMPOSITE_PORTFOLIO");
    expect(descriptor.datasetRequirement.datasetCode).toBe("first_limit_pullback");
  });

  it("四条臂：一个控制臂 + 三档门槛，且不带任何排序融合权重", () => {
    expect(TREND_GATE_ARMS.map((arm) => arm.minTrendScore)).toEqual([null, 1 / 6, 1 / 3, 2 / 3]);
    const declared = compositeRunnerNewHigh3T74TrendGateExperiment
      .descriptor.compositeExecution?.extensionSelectionArms;
    expect(declared).toEqual(
      TREND_GATE_ARMS.map((arm) => ({
        id: arm.id,
        trendWeight: null,
        minTrendScore: arm.minTrendScore,
      })),
    );
    // 排序不改：所有臂的 trendWeight 必须为 null（有值就意味着偷偷改了排序值）。
    for (const arm of declared ?? []) expect(arm.trendWeight).toBeNull();
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerNewHigh3T74TrendGateExperiment.resultSchema;
    const arm = {
      id: "gate-ge1of3",
      label: "门槛 trendScore >= 1/3",
      minTrendScore: 1 / 3,
      evaluatedCandidates: 43550,
      excludedByTrendGate: 28545,
      daysWithCandidates: 1558,
      daysWithFewerThanTopN: 233,
      fullCReturnPct: 100,
      fullCTrades: 900,
      fullCMaxDrawdownPct: 40,
      fullControlDeltaPct: -51.09,
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
    delete broken.excludedByTrendGate;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});
