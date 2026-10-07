/** P9 · 事件事实 gate descriptor 测试。 */
import { describe, expect, it } from "vitest";
import {
  EVENT_GATE_ARMS,
  compositeRunnerT74EventGateExperiment,
} from "../../../research-experiments/first-board-pullback/composite-runner-newhigh3-t74-event-gate/experiment";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";

describe("P9 · 事件事实 gate descriptor", () => {
  it("能通过注册", () => {
    const registry = new ExperimentRegistry();
    expect(() => registry.register(compositeRunnerT74EventGateExperiment)).not.toThrow();
  });

  it("六条臂：control + 单变量 + combo", () => {
    expect(EVENT_GATE_ARMS.map((arm) => [arm.id, arm.gates.length])).toEqual([
      ["control", 0],
      ["gap-p50", 1],
      ["gap-p33", 1],
      ["turnover-p50", 1],
      ["combo-p50", 2],
      ["histlimit-p67", 1],
    ]);
  });

  it("descriptor 请求注入事件元数据，且仍只装载 top3", () => {
    expect(compositeRunnerT74EventGateExperiment.descriptor.compositeExecution?.includeEventMetadata).toBe(true);
    expect(compositeRunnerT74EventGateExperiment.descriptor.compositeExecution?.extensionSelectionArms).toEqual([
      { id: "control", trendWeight: null, topN: 3 },
    ]);
  });
});
