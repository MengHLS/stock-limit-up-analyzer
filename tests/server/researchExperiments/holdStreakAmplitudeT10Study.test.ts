import { describe, expect, it } from "vitest";
import { holdStreakAmplitudeT10StudyExperiment } from "../../../research-experiments/first-board-pullback/hold-streak-amplitude-t10-study/experiment";
import type { HoldStreakAmplitudeT10Payload } from "../../../research-experiments/first-board-pullback/hold-streak-amplitude-t10-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_012;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_012,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-hold-amp-test",
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
    open: 10,
    high: 11,
    low: 10,
    close: 11,
    preClose: 10,
    volume: 100,
    amount: 100,
  };
}

function post(
  day: number,
  high: number,
  low: number,
  close: number,
  preClose: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId: "e1",
    symbol: "600000.SH",
    tradeDate: "2025-06-02",
    relativeDay: day,
    open: close,
    high,
    low,
    close,
    preClose,
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

describe("hold-streak-amplitude-t10-study", () => {
  it("交叉守线 streak 与平均振幅", async () => {
    const registry = new ExperimentRegistry();
    registry.register(holdStreakAmplitudeT10StudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [event()],
          prefixBars: [prefix()],
          postBars: [
            post(1, 11.2, 11, 11.1, 11),
            post(2, 11.1, 11, 11.05, 11),
            post(3, 11.2, 11, 11.1, 11),
            post(4, 11.2, 11, 11.1, 11),
            post(5, 11.2, 11, 11.1, 11),
            post(6, 11.3, 10.8, 11, 11),
            ...Array.from({ length: 4 }, (_, index) =>
              post(index + 7, 11.3, 10.8, 11.1, 11)
            ),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/hold-streak-amplitude-t10-study",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as HoldStreakAmplitudeT10Payload;
    expect(custom.candidates.sampleCount).toBe(1);
    const table = outcome.result!.tables!.find(
      item => item.key === "hold_streak_amplitude_t10_matrix"
    )!;
    const row = table.rows.find(
      item =>
        item.mode === "CLOSE" &&
        item.streak === 5 &&
        item.amplitudeDimension === "MEAN" &&
        item.amplitudeBucket === "LT4"
    )!;
    expect(row.sampleCount).toBe(1);
    expect(row.meanNetReturn).toBeCloseTo(0.0070909091, 8);
  });
});
