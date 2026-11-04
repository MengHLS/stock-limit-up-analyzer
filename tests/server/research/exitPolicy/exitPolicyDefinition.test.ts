import { describe, expect, it } from "vitest";
import {
  exitPolicyDefinitionErrors,
  strongHoldPolicyErrors,
} from "../../../../server/research/exitPolicyCommon";
import {
  stopAnchorDefinitionErrors,
  stopPolicyDefinitionErrors,
} from "../../../../server/research/stopPolicy";

function fixedStop(overrides: Record<string, unknown> = {}) {
  return {
    anchor: {
      kind: "FIXED_PERCENT",
      stopRatio: 0.06,
    },
    confirmation: "INTRADAY",
    ...overrides,
  };
}

describe("SL stop policy definitions", () => {
  it("accepts SL-00 fixed intraday stop", () => {
    expect(stopPolicyDefinitionErrors(fixedStop())).toEqual([]);
  });

  it("accepts ATR and structure anchors", () => {
    expect(stopAnchorDefinitionErrors({
      kind: "ATR",
      atrWindow: 10,
      atrMultiplier: 1.5,
      minStopRatio: 0.04,
      maxStopRatio: 0.1,
    })).toEqual([]);
    expect(stopAnchorDefinitionErrors({
      kind: "STRUCTURE_LOW",
      source: "OBSERVATION_WINDOW",
      bufferAtrMultiplier: 0.25,
      minStopRatio: 0.04,
      maxStopRatio: 0.1,
    })).toEqual([]);
  });

  it("accepts confirmation and escalation modifiers", () => {
    expect(stopPolicyDefinitionErrors(fixedStop({
      confirmation: "DISASTER_PLUS_CLOSE",
      disasterStopRatio: 0.09,
      escalation: {
        kind: "LADDER",
        steps: [
          { activationRatio: 0.03, stopRatio: 0 },
          { activationRatio: 0.06, stopRatio: 0.02 },
        ],
      },
    }))).toEqual([]);
  });

  it("accepts a phase schedule and partial reduction", () => {
    expect(stopPolicyDefinitionErrors(fixedStop({
      schedule: {
        phases: [
          { fromHoldingDay: 1, toHoldingDay: 2, stopRatio: 0.08 },
          { fromHoldingDay: 3, toHoldingDay: 5, stopRatio: 0.06 },
        ],
      },
      reduction: {
        steps: [
          { triggerRatio: -0.03, sellRatio: 0.5 },
          { triggerRatio: -0.06, sellRatio: 1 },
        ],
      },
    }))).toEqual([]);
  });

  it("rejects invalid duration and ATR bounds", () => {
    expect(stopPolicyDefinitionErrors(fixedStop({
      confirmation: "NO_SUCH_MODE",
    }))).not.toEqual([]);
    expect(stopAnchorDefinitionErrors({
      kind: "ATR",
      atrWindow: 0,
      atrMultiplier: -1,
      minStopRatio: 0.2,
      maxStopRatio: 0.1,
    }).length).toBeGreaterThan(0);
  });
});

describe("unified exit policy definitions", () => {
  it("accepts SL-23 with runner capital recycling", () => {
    expect(exitPolicyDefinitionErrors({
      stop: fixedStop(),
      takeProfit: {
        kind: "MA_CROSS",
        fastWindow: 5,
        slowWindow: 10,
        activationRatio: 0,
      },
      timeExit: {
        kind: "FIXED_HOLDING_DAYS",
        holdingDays: 5,
      },
      strongHold: {
        atHoldingDays: 5,
        minReturnRatio: 0.03,
        requireAboveMa5: true,
        requireAboveMa10: true,
        extendToHoldingDays: 10,
        afterExtendedHold: "TREND",
        scaleOutRatio: 0.5,
        runnerExitAtHoldingDays: 14,
      },
      capitalRecycle: {
        maxConcurrentRunners: 2,
        replacementScoreMargin: 0.03,
      },
    })).toEqual([]);
  });

  it("rejects invalid strong hold schedule", () => {
    expect(strongHoldPolicyErrors({
      atHoldingDays: 5,
      minReturnRatio: 0.03,
      requireAboveMa5: true,
      requireAboveMa10: true,
      extendToHoldingDays: 5,
      scaleOutRatio: 1,
    }).length).toBeGreaterThan(0);
  });
});
