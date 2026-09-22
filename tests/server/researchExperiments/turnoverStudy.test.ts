import { describe, expect, it } from "vitest";
import { turnoverStudyExperiment } from "../../../research-experiments/first-board-pullback/turnover-study/experiment";
import type { TurnoverCustomPayload } from "../../../research-experiments/first-board-pullback/turnover-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 1_000_001;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 1_010_001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-turnover-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 2,
  horizons: [5, 10, 20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: 1,
};

function event(eventId: string, date: string, turnover: number): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: date,
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
    marketCap: null,
    floatMarketCap: null,
  };
}

function prefix(eventId: string, date: string): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: date,
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

function post(eventId: string, date: string, day: number): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: date,
    relativeDay: day,
    open: 10,
    high: 11,
    low: 10,
    close: 11,
    preClose: 10,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
    volume: 1,
    amount: 1,
  };
}

describe("turnover-study", () => {
  it("计算换手率分桶和日期聚类 Bootstrap，并披露流通市值缺失", async () => {
    const events = [event("e1", "2025-01-02", 0.5), event("e2", "2025-01-03", 5)];
    const prefixBars = [prefix("e1", "2025-01-02"), prefix("e2", "2025-01-03")];
    const postBars = [
      ...Array.from({ length: 20 }, (_, index) => post("e1", "2025-01-02", index + 1)),
      ...Array.from({ length: 20 }, (_, index) => post("e2", "2025-01-03", index + 1)),
    ];
    const registry = new ExperimentRegistry();
    registry.register(turnoverStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events,
          prefixBars,
          postBars,
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/turnover-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        forwardHorizons: [5, 10, 20],
        maxEvents: 100,
        roundTripCostBps: 0,
        bootstrapIterations: 100,
        bootstrapBlockDays: 20,
      },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!.customPayload as TurnoverCustomPayload;
    expect(custom.availability.turnoverAvailableCount).toBe(2);
    expect(custom.availability.floatMarketCapAvailableCount).toBe(0);
    expect(custom.availability.floatMarketCapStatus).toBe("INSUFFICIENT_DATA");
    const table = outcome.result!.tables!.find(
      (item) => item.key === "turnover_return_matrix",
    )!;
    const low = table.rows.find(
      (row) => row.turnoverBucket === "LT_1" && row.horizon === 10,
    )!;
    const mid = table.rows.find(
      (row) => row.turnoverBucket === "P5_10" && row.horizon === 10,
    )!;
    expect(low.availableCount).toBe(1);
    expect(mid.availableCount).toBe(1);
    expect(mid.bootstrapClusterCount).toBe(0);
  });
});
