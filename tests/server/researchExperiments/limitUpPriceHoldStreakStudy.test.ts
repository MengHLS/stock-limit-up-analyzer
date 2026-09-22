import { describe, expect, it } from "vitest";
import { limitUpPriceHoldStreakStudyExperiment } from "../../../research-experiments/first-board-pullback/limit-up-price-hold-streak-study/experiment";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_011;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_011,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-hold-streak-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 1,
  horizons: [10, 20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
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
  close: number
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
    preClose: 11,
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

describe("limit-up-price-hold-streak-study", () => {
  it("分别计算收盘守线和盘中守线 streak", async () => {
    const registry = new ExperimentRegistry();
    registry.register(limitUpPriceHoldStreakStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [event()],
          prefixBars: [prefix()],
          postBars: [
            post(1, 11.2, 11, 11.1),
            post(2, 11.1, 10.9, 11.05),
            post(3, 11, 10.8, 10.9),
            post(4, 11, 10.9, 11),
            post(5, 11.2, 11, 11.1),
            ...Array.from({ length: 15 }, (_, index) =>
              post(index + 6, 11.3, 10.8, 11.1)
            ),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/limit-up-price-hold-streak-study",
      datasetVersionId: VERSION_ID,
      parameters: { horizons: [10, 20] },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const table = outcome.result!.tables!.find(
      item => item.key === "limit_up_hold_streak_matrix"
    )!;
    const close = table.rows.find(
      row => row.mode === "CLOSE" && row.streak === 2 && row.horizon === 10
    )!;
    const low = table.rows.find(
      row => row.mode === "LOW" && row.streak === 1 && row.horizon === 10
    )!;
    expect(close.sampleCount).toBe(1);
    expect(low.sampleCount).toBe(1);
  });
});
