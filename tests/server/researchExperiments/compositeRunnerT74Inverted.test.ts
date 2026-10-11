/** `TAIL-SELECTION-002` · 3F 取向翻转实验的静态契约测试（run() 需要真实数据）。 */
import { describe, expect, it } from "vitest";
import {
  INVERTED_ARMS,
  compositeRunnerT74InvertedExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-inverted/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("TAIL-SELECTION-002 · 取向翻转实验 descriptor", () => {
  it("能通过注册", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74InvertedExperiment)).not.toThrow();
  });

  it("五条臂：控制有/无 Runner + 翻转有/无 Runner + 翻转+延长；取向是唯一自变量", () => {
    expect(INVERTED_ARMS.map((arm) => arm.id)).toEqual(["A0", "A", "B0", "B", "D"]);
    expect(INVERTED_ARMS.map((arm) => arm.orientation)).toEqual(["LOW", "LOW", "HIGH", "HIGH", "HIGH"]);
    expect(INVERTED_ARMS.map((arm) => arm.withRunner)).toEqual([false, true, false, true, true]);
    // 只有 D 覆盖 Runner 延长上限；其余沿用族默认。
    expect(INVERTED_ARMS.map((arm) => arm.runnerExitAtHoldingDays)).toEqual([null, null, null, null, 30]);
    expect(compositeRunnerT74InvertedExperiment.descriptor.compositeExecution?.extensionSelectionArms).toEqual([
      { id: "control", trendWeight: null, amplitudeOrientation: "LOW" },
      { id: "inverted", trendWeight: null, amplitudeOrientation: "HIGH" },
    ]);
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerT74InvertedExperiment.resultSchema;
    const arm = {
      id: "B",
      label: "取向翻转 · 有 Runner",
      orientation: "HIGH",
      withRunner: true,
      runnerExitAtHoldingDays: null,
      fullCReturnPct: 120,
      fullCMaxDrawdownPct: 50,
      fullCTrades: 1500,
      fullControlDeltaPct: -31,
      fullAReturnPct: null,
      runnerTrigger: null,
      bigWin50Count: 11,
      bigWin100Count: 2,
      winRatePct: 38,
      meanLossPct: -7.5,
      worstTradeReturnPct: -21,
      p05TradeReturnPct: -12,
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
    delete broken.bigWin100Count;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
    // 取向只允许 LOW / HIGH。
    expect(schema.safeParse({ ...payload, arms: [{ ...arm, orientation: "SIDEWAYS" }] }).success).toBe(false);
  });
});
