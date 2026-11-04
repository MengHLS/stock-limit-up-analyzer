import { describe, expect, it } from "vitest";
import { postEventAmplitudeStudyExperiment } from "../../../research-experiments/first-board-pullback/post-event-amplitude-study/experiment";
import type { PostEventAmplitudeCustomPayload } from "../../../research-experiments/first-board-pullback/post-event-amplitude-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_001;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-post-amplitude-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 3,
  horizons: [10, 15, 20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: 5,
};

function event(eventId: string): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-01-02",
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

function prefix(eventId: string): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-01-02",
    relativeDay: 0,
    open: 10,
    high: 11,
    low: 10,
    close: 11,
    preClose: 10,
    volume: 1,
    amount: 1,
  };
}

function post(
  eventId: string,
  day: number,
  high: number,
  low: number,
  close: number,
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-01-03",
    relativeDay: day,
    open: day === 6 ? 10 : (high + low) / 2,
    high,
    low,
    close,
    preClose: 10,
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

function series(eventId: string, amplitude: number, hadLimit: boolean): FirstLimitPullbackRawBar[] {
  const rows: FirstLimitPullbackRawBar[] = [];
  for (let day = 1; day <= 20; day += 1) {
    const half = amplitude * 5;
    const high = hadLimit && day === 3 ? 11 : 10 + half;
    const low = hadLimit && day === 3 ? 9 : 10 - half;
    const close = day >= 10 ? 11 : 10.1;
    rows.push(post(eventId, day, high, low, close));
  }
  return rows;
}

describe("post-event-amplitude-study", () => {
  it("区分无涨跌停 / 有涨跌停，并在无涨跌停组内按平均振幅分桶", async () => {
    const events = [event("e1"), event("e2"), event("e3")];
    const registry = new ExperimentRegistry();
    registry.register(postEventAmplitudeStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events,
          prefixBars: [prefix("e1"), prefix("e2"), prefix("e3")],
          postBars: [
            ...series("e1", 0.02, false),
            ...series("e2", 0.2, true),
            ...series("e3", 0.06, false),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/post-event-amplitude-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        forwardHorizons: [10, 15, 20],
        maxEvents: 100,
        roundTripCostBps: 0,
      },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!.customPayload as PostEventAmplitudeCustomPayload;
    expect(custom.contextCounts.noLimitCount).toBe(2);
    expect(custom.contextCounts.hadLimitCount).toBe(1);
    const table = outcome.result!.tables!.find(
      (item) => item.key === "post_event_amplitude_matrix",
    )!;
    const noLimit = table.rows.find(
      (row) => row.dimension === "LIMIT_STATUS" && row.limitContext === "NO_LIMIT" && row.horizon === 10,
    )!;
    expect(noLimit.availableCount).toBe(2);
    const p2 = table.rows.find(
      (row) => row.dimension === "AMPLITUDE" && row.amplitudeBucket === "P2_4" && row.horizon === 10,
    )!;
    expect(p2.availableCount).toBe(1);
    expect(p2.meanGrossReturn).toBeCloseTo(0.1, 8);
  });
});
