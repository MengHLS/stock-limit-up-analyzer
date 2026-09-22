import { describe, expect, it } from "vitest";
import { bodyFilteredExitCurveStudyExperiment } from "../../../research-experiments/first-board-pullback/body-filtered-exit-curve-study/experiment";
import type { BodyFilteredExitCurvePayload } from "../../../research-experiments/first-board-pullback/body-filtered-exit-curve-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_013;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_013,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-body-exit-curve-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 3,
  horizons: [10],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: null,
};

function event(
  eventId: string,
  tradeDate: string,
  previousClose: number
): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate,
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose,
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

function prefix(
  eventId: string,
  tradeDate: string,
  open: number,
  high: number,
  low: number,
  close: number,
  preClose: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate,
    relativeDay: 0,
    open,
    high,
    low,
    close,
    preClose,
    volume: 100,
    amount: 100,
  };
}

function post(
  eventId: string,
  day: number,
  open: number,
  close: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: `2025-06-${String(day + 1).padStart(2, "0")}`,
    relativeDay: day,
    open,
    high: close + 0.1,
    low: open - 0.1,
    close,
    preClose: open,
    limitUpPrice: 12,
    limitDownPrice: 9,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
    volume: 100,
    amount: 100,
  };
}

function completePost(eventId: string): FirstLimitPullbackRawBar[] {
  return [
    post(eventId, 1, 11, 11.1),
    post(eventId, 2, 11.1, 11.2),
    post(eventId, 3, 11.2, 11.3),
    post(eventId, 4, 11.3, 11.4),
    post(eventId, 5, 11.4, 11.5),
    post(eventId, 6, 11, 11.1),
    post(eventId, 7, 11.1, 11.2),
    post(eventId, 8, 11.2, 11.3),
    post(eventId, 9, 11.3, 11.4),
    post(eventId, 10, 11.4, 11.5),
  ];
}

describe("body-filtered-exit-curve-study", () => {
  it("排除一字板和小实体，并按共同路径输出持有曲线", async () => {
    const registry = new ExperimentRegistry();
    registry.register(bodyFilteredExitCurveStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [
            event("valid", "2025-06-01", 10),
            event("oneword", "2025-06-01", 10),
            event("small", "2025-06-01", 10),
          ],
          prefixBars: [
            prefix("valid", "2025-06-01", 10, 11, 10, 11, 10),
            prefix("oneword", "2025-06-01", 11, 11, 11, 11, 10),
            prefix("small", "2025-06-01", 10.995, 11, 10.9, 11, 10),
          ],
          postBars: [
            ...completePost("valid"),
            ...completePost("oneword"),
            ...completePost("small"),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/body-filtered-exit-curve-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        entryDay: 6,
        maxExitRelativeDay: 10,
        minBodyHeightPct: 0.1,
        excludeOneWordLimitUp: true,
        bootstrapIterations: 100,
      },
    });

    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as BodyFilteredExitCurvePayload;
    expect(custom.candidates.sampleCount).toBe(1);
    expect(custom.candidates.excludedOneWordLimitUpCount).toBe(1);
    expect(custom.candidates.belowMinBodyHeightCount).toBe(1);

    const table = outcome.result!.tables!.find(
      item => item.key === "body_filtered_exit_curve"
    )!;
    const row = table.rows.find(
      item => item.group === "ALL" && item.holdingDay === 5
    )!;
    expect(row.sampleCount).toBe(1);
    expect(row.meanNetReturn).toBeCloseTo(0.0434545455, 8);
  });
});
