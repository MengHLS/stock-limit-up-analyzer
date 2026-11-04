import { describe, expect, it } from "vitest";
import { exitPolicyDefinitionErrors } from "../../../../server/research/exitPolicyCommon";
import {
  STOP_POLICY_EXPERIMENTS,
  getExitPolicyExperiment,
} from "../../../../server/research/exitPolicyExperiments";

describe("SL experiment registry", () => {
  it("contains the complete SL-00~SL-30 plan", () => {
    const ids = Object.keys(STOP_POLICY_EXPERIMENTS);
    expect(ids).toContain("SL-00");
    expect(ids).toContain("SL-01.0");
    expect(ids).toContain("SL-30.0");
    expect(ids.length).toBeGreaterThanOrEqual(35);
  });

  it("uses unique immutable strategy versions", () => {
    const versions = Object.values(STOP_POLICY_EXPERIMENTS).map(item => item.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("every registered exit policy passes the generic validator", () => {
    for (const experiment of Object.values(STOP_POLICY_EXPERIMENTS)) {
      expect(
        exitPolicyDefinitionErrors(experiment.policy),
        `${experiment.id}:${experiment.version}`,
      ).toEqual([]);
    }
  });

  it("lookup is strict and deterministic", () => {
    expect(getExitPolicyExperiment("SL-00").version).toBe("1.27.2");
    expect(() => getExitPolicyExperiment("SL-NOPE")).toThrow(/未知退出策略实验/);
  });
});
