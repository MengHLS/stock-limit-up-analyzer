import { describe, expect, it } from "vitest";
import { oversoldGapReversalValidationExperiment } from "../../../research-experiments/first-board-pullback/oversold-gap-reversal-validation/experiment";
import type { OversoldGapReversalCustomPayload } from "../../../research-experiments/first-board-pullback/oversold-gap-reversal-validation/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_003;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_003,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-oversold-validation-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2026-12-31",
  totalEvents: 3,
  horizons: [5, 10, 20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: null,
};

function event(
  eventId: string,
  tradeDate: string,
  daysSincePreviousLimit: number | null
): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate,
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    turnover: 1,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function prefix(
  eventId: string,
  relativeDay: number,
  close: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: relativeDay === -11 ? "2025-05-15" : "2025-05-30",
    relativeDay,
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 1,
    amount: 1,
  };
}

function post(
  eventId: string,
  relativeDay: number,
  open: number,
  close: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-06-03",
    relativeDay,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    preClose: open,
    limitUpPrice: 11,
    limitDownPrice: 9,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
    volume: 1,
    amount: 1,
  };
}

describe("oversold-gap-reversal-validation", () => {
  it("只选择长间隔且前期跌幅超过 10% 的信号，并用同日可行首板做基准", async () => {
    const events = [
      event("signal", "2025-06-01", 25),
      event("peer", "2025-06-01", 5),
      event("not-signal", "2025-06-02", 25),
    ];
    const registry = new ExperimentRegistry();
    registry.register(oversoldGapReversalValidationExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events,
          prefixBars: [
            prefix("signal", -11, 10),
            prefix("signal", -1, 8.9),
            prefix("peer", -11, 10),
            prefix("peer", -1, 9.5),
            prefix("not-signal", -11, 10),
            prefix("not-signal", -1, 9.5),
          ],
          postBars: [
            ...([5, 10, 20] as const).flatMap(day => [
              post("signal", 1, 10, 10),
              post("signal", day, 10, 11),
              post("peer", 1, 10, 10),
              post("peer", day, 10, 10.5),
              post("not-signal", 1, 10, 10),
              post("not-signal", day, 10, 10.2),
            ]),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/oversold-gap-reversal-validation",
      datasetVersionId: VERSION_ID,
      protocol: {
        phase: "OBSERVATION",
        protocolId: "oversold-gap-reversal-validation",
        protocolVersion: "1.0.0",
        hypothesisCode: "H_OVERSOLD_GAP20_DROP10_T10",
        protocolFingerprint: "protocol-sha256:test",
        evaluationWindow: { startDate: "2025-01-01", endDate: "2025-12-31" },
        parentRunId: null,
      },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as OversoldGapReversalCustomPayload;
    expect(custom.candidates.signalCount).toBe(1);
    expect(custom.availability.signalPrimarySampleCount).toBe(1);
    expect(custom.availability.excessSampleCount).toBe(1);
    expect(outcome.result!.confirmatoryGate?.status).toBe("INSUFFICIENT");

    const table = outcome.result!.tables!.find(
      item => item.key === "frozen_cohort_returns"
    )!;
    const signal = table.rows.find(
      row => row.cohort === "SIGNAL" && row.horizon === 10
    )!;
    expect(signal.meanNetReturn).toBeCloseTo(0.1 - 0.002, 8);
  });
});
