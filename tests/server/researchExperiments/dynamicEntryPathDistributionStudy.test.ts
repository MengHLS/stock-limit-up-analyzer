import { describe, expect, it } from "vitest";
import { dynamicEntryPathDistributionStudyExperiment } from "../../../research-experiments/first-board-pullback/dynamic-entry-path-distribution-study/experiment";
import type { DynamicEntryPathDistributionPayload } from "../../../research-experiments/first-board-pullback/dynamic-entry-path-distribution-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_009;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_009,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-path-test",
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
  high: number,
  low: number,
  close: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId: "e1",
    symbol: "600000.SH",
    tradeDate: "2025-06-03",
    relativeDay: day,
    open: day === 2 ? 10 : close,
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
    volume: 100,
    amount: 100,
  };
}

describe("dynamic-entry-path-distribution-study", () => {
  it("输出每日路径、MFE/MAE 和阈值到达时间", async () => {
    const registry = new ExperimentRegistry();
    registry.register(dynamicEntryPathDistributionStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [event()],
          prefixBars: [prefix()],
          postBars: [
            post(1, 10.9, 10.4, 10.8),
            post(2, 10.8, 10.0, 10.2),
            post(3, 10.5, 9.2, 9.4),
            post(4, 10.0, 9.5, 9.8),
            post(5, 10.2, 9.7, 10),
            post(6, 10.3, 9.8, 10.1),
            post(7, 10.5, 10, 10.4),
            post(8, 10.8, 10.2, 10.6),
            post(9, 11, 10.4, 10.8),
            post(10, 11.2, 10.6, 11),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId:
        "first-board-pullback/dynamic-entry-path-distribution-study",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as DynamicEntryPathDistributionPayload;
    expect(custom.candidates.tradeCount).toBe(1);
    const daily = outcome.result!.tables!.find(
      item => item.key === "daily_path_distribution"
    )!;
    expect(
      daily.rows.some(row => row.entryDay === 2 && row.holdingDay === 1)
    ).toBe(true);
    const summary = outcome.result!.tables!.find(
      item => item.key === "path_summary"
    )!;
    const row = summary.rows.find(item => item.entryDay === 2)!;
    expect(row.sampleCount).toBe(1);
    expect(row.medianPlus2ReachDay).toBe(2);
  });
});
