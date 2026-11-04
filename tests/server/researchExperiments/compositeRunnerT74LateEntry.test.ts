/** P8 · 延迟入场实验 descriptor 测试。 */
import { describe, expect, it } from "vitest";
import {
  LATE_ENTRY_ARMS,
  compositeRunnerT74LateEntryExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-late-entry/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P8 · 延迟入场 descriptor", () => {
  it("能通过注册", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74LateEntryExperiment)).not.toThrow();
  });

  it("七条臂：control + delay T+7/T+8/T+10 + rescore T+7/T+8/T+10", () => {
    expect(LATE_ENTRY_ARMS.map((arm) => [arm.id, arm.mode, arm.decisionRelativeDay, arm.sourceTopN])).toEqual([
      ["control", null, null, 3],
      ["delay-t7", "delay", 7, 3],
      ["delay-t8", "delay", 8, 3],
      ["delay-t10", "delay", 10, 3],
      ["rescore-t7", "rescore", 7, 5],
      ["rescore-t8", "rescore", 8, 5],
      ["rescore-t10", "rescore", 10, 5],
    ]);
  });

  it("provider 为 rescore 臂装载原 top5 扩展行", () => {
    expect(compositeRunnerT74LateEntryExperiment.descriptor.compositeExecution?.extensionSelectionArms).toEqual([
      { id: "control", trendWeight: null, topN: 3 },
      { id: "late", trendWeight: null, topN: 5 },
    ]);
  });
});
