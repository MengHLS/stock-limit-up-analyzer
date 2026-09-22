import { describe, expect, it } from "vitest";
import { volumeRecoveryFilteredValidationExperiment } from "../../../research-experiments/first-board-pullback/volume-recovery-filtered-validation/experiment";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_007;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_007,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-volume-recovery-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 2,
  horizons: [10],
  pathRelativeDayRange: { min: 1, max: 10 },
  postRelativeDayRange: { min: 1, max: 10 },
  decisionOffsetDays: 5,
};

function event(eventId: string, turnover: number): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-06-01",
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    turnover,
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
  eventId: string,
  day: number,
  close: number,
  volume: number
): FirstLimitPullbackRawBar {
  const open = day === 2 ? 10 : close;
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-06-03",
    relativeDay: day,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    preClose: open,
    limitUpPrice: Math.round(open * 1.1 * 100) / 100,
    limitDownPrice: Math.round(open * 0.9 * 100) / 100,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
    volume,
    amount: volume,
  };
}

describe("volume-recovery-filtered-validation", () => {
  it("过滤小实体 / 高换手，并在量能未恢复时退出", async () => {
    const registry = new ExperimentRegistry();
    registry.register(volumeRecoveryFilteredValidationExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [event("keep", 3), event("turnover", 12)],
          prefixBars: [prefix("keep"), prefix("turnover")],
          postBars: [
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(day =>
              post("keep", day, day === 1 ? 10.8 : 10.8, day <= 5 ? 50 : 60)
            ),
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(day =>
              post("turnover", day, day === 1 ? 10.8 : 11, 200)
            ),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/volume-recovery-filtered-validation",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!.customPayload as {
      counts: {
        filterEligibleEventCount: number;
        filteredVolumeExitTradeCount: number;
      };
    };
    expect(custom.counts.filterEligibleEventCount).toBe(1);
    expect(custom.counts.filteredVolumeExitTradeCount).toBe(1);
    const table = outcome.result!.tables!.find(
      item => item.key === "filtered_volume_exit_performance"
    )!;
    const row = table.rows.find(
      item => item.mode === "FILTERED_VOLUME_EXIT" && item.entryDay === 2
    )!;
    expect(row.volumeUnrecoveredCount).toBe(1);
    expect(row.timeExitCount).toBe(0);
  });
});
