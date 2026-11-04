/** P3-stopwide 执行容量实验的静态契约测试（run() 需要真实数据）。 */
import { describe, expect, it } from "vitest";
import {
  STOP_WIDE_ARMS,
  compositeRunnerT74StopWideExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-stopwide/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P3-stopwide · 固定止损实验 descriptor", () => {
  it("能通过注册", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74StopWideExperiment)).not.toThrow();
  });

  it("四条臂只差固定止损：6% / 8% / 10% / 12%", () => {
    expect(STOP_WIDE_ARMS.map((arm) => arm.stopRatio)).toEqual([0.06, 0.08, 0.1, 0.12]);
    expect(compositeRunnerT74StopWideExperiment.descriptor.compositeExecution?.extensionSelectionArms).toEqual([
      { id: "control", trendWeight: null },
    ]);
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerT74StopWideExperiment.resultSchema;
    const arm = {
      id: "stop-10",
      label: "止损 10%",
      stopRatio: 0.1,
      fullCReturnPct: 120,
      fullCMaxDrawdownPct: 50,
      fullCTrades: 1500,
      fullControlDeltaPct: -31,
      fullAReturnPct: null,
      runnerTrigger: null,
      bigWin50Count: 11,
      bigWin100Count: 2,
      losingTrades: 700,
      meanLossPct: -7.5,
      worstTradeReturnPct: -21,
      p05TradeReturnPct: -12,
      tradesWorseThan6Pct: 300,
      tradesWorseThan10Pct: 90,
      stopExitCount: 500,
    };
    const payload = {
      computationVersion: "1.0.0",
      controlParity: { aReturnPct: 15.79, aTrades: 1619, cReturnPct: 151.1, cTrades: 1434, trigger: 161, pass: true },
      arms: [arm],
      note: "note",
    };
    expect(schema.safeParse(payload).success).toBe(true);
    const broken = { ...arm } as Record<string, unknown>;
    delete broken.tradesWorseThan10Pct;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});
