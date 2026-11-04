/**
 * P2 · 执行容量实验的静态契约测试（run() 需要真实数据，不在单测里跑）。
 *
 * 关键前提：**选股与排序必须冻结** —— 四条臂只差 maxDailyBuys / maxPositions，
 * 且扩展行只需按控制臂装载（各臂选股集合相同）。
 */
import { describe, expect, it } from "vitest";
import {
  SLOT_ARMS,
  compositeRunnerT74SlotsExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-slots/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P2 · 执行容量实验 descriptor", () => {
  it("能通过注册（id / pageKey / dataset 声明自洽）", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74SlotsExperiment)).not.toThrow();
  });

  it("pageKey 与 id 相同，且声明组合执行面", () => {
    const descriptor = compositeRunnerT74SlotsExperiment.descriptor;
    expect(descriptor.id).toBe("first-board-pullback/composite-runner-newhigh3-t74-slots");
    expect(descriptor.pageKey).toBe(descriptor.id);
    expect(descriptor.executionSurface).toBe("COMPOSITE_PORTFOLIO");
  });

  it("四条臂：控制臂 2 笔/5 仓 + 三档容量臂，且都只动容量", () => {
    expect(SLOT_ARMS.map((arm) => [arm.maxDailyBuys, arm.maxPositions])).toEqual([
      [2, 5],
      [3, 5],
      [3, 8],
      [3, 12],
    ]);
    // 扩展行按控制臂装载（各臂选股集合相同 ⇒ 不需要按臂并集）
    expect(compositeRunnerT74SlotsExperiment.descriptor.compositeExecution?.extensionSelectionArms).toEqual([
      { id: "control", trendWeight: null },
    ]);
  });

  it("resultSchema 接受自洽载荷、拒绝缺字段载荷", () => {
    const schema = compositeRunnerT74SlotsExperiment.resultSchema;
    const arm = {
      id: "slots-3-8",
      label: "3 笔/8 仓",
      maxDailyBuys: 3,
      maxPositions: 8,
      fullCReturnPct: 180,
      fullCTrades: 1900,
      fullCMaxDrawdownPct: 50,
      fullControlDeltaPct: 28.9,
      fullAReturnPct: null,
      runnerTrigger: null,
      bigWin50Count: 14,
      bigWin100Count: 3,
      bigWin50NetPnlSharePct: 120.5,
      maxTradeReturnPct: 140.2,
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
    delete broken.bigWin50Count;
    expect(schema.safeParse({ ...payload, arms: [broken] }).success).toBe(false);
  });
});
