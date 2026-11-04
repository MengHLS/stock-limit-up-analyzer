import { describe, expect, it } from "vitest";
import { thresholdRacePolicyStudyExperiment } from "../../../research-experiments/first-board-pullback/threshold-race-policy-study/experiment";
import type { ThresholdRacePolicyPayload } from "../../../research-experiments/first-board-pullback/threshold-race-policy-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_010;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_010,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-race-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 1,
  horizons: [10],
  pathRelativeDayRange: { min: 1, max: 10 },
  postRelativeDayRange: { min: 1, max: 10 },
  decisionOffsetDays: 5,
};

function event(): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId: "e1",
    symbol: "600000.SH",
    tradeDate: "2025-06-01",
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    turnover: 1,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: 10,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function prefix(): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId: "e1",
    symbol: "600000.SH",
    tradeDate: "2025-06-01",
    relativeDay: 0,
    open: 9.5,
    high: 11,
    low: 9.4,
    close: 11,
    preClose: 10,
    volume: 100,
    amount: 100,
  };
}

function post(
  day: number,
  open: number,
  close: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId: "e1",
    symbol: "600000.SH",
    tradeDate: "2025-06-03",
    relativeDay: day,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    preClose: 10,
    limitUpPrice: 11,
    limitDownPrice: 9,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
    volume: 100,
    amount: 100,
  };
}

describe("threshold-race-policy-study", () => {
  it("比较正负阈值先到时的止盈止损规则", async () => {
    const registry = new ExperimentRegistry();
    registry.register(thresholdRacePolicyStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [event()],
          prefixBars: [prefix()],
          postBars: [
            post(1, 10, 10.8),
            post(2, 10, 9.7),
            post(3, 10, 9.5),
            post(4, 10, 10),
            post(5, 10, 10),
            post(6, 10, 10),
            post(7, 10, 10),
            post(8, 10, 10),
            post(9, 10, 10),
            post(10, 10, 10),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/threshold-race-policy-study",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!.customPayload as ThresholdRacePolicyPayload;
    expect(custom.candidates.tradeCount).toBe(1);
    const raceTable = outcome.result!.tables!.find(
      item => item.key === "threshold_race_counts"
    )!;
    const race2 = raceTable.rows.find(
      row => row.entryDay === 2 && row.pair === "RACE_2PCT"
    )!;
    expect(race2.negativeFirstCount).toBe(1);
  });
});
