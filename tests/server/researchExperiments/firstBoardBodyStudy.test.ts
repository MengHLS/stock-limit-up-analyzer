import { describe, expect, it } from "vitest";
import { firstBoardBodyStudyExperiment } from "../../../research-experiments/first-board-pullback/first-board-body-study/experiment";
import type { FirstBoardBodyCustomPayload } from "../../../research-experiments/first-board-pullback/first-board-body-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_004;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_004,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-body-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 4,
  horizons: [5, 10, 20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: null,
};

function event(eventId: string): FirstLimitPullbackEvent {
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
  open: number,
  high: number,
  low: number,
  close: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-06-01",
    relativeDay: 0,
    open,
    high,
    low,
    close,
    preClose: 10,
    volume: 1,
    amount: 1,
  };
}

function post(
  eventId: string,
  day: number,
  close: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-06-03",
    relativeDay: day,
    open: day === 1 ? 10 : close,
    high: Math.max(10, close),
    low: Math.min(10, close),
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

describe("first-board-body-study", () => {
  it("按严格涨停首板实体高度分桶，并排除收盘高于涨停价的异常事件", async () => {
    const events = [
      event("zero"),
      event("small"),
      event("large"),
      event("invalid"),
    ];
    const registry = new ExperimentRegistry();
    registry.register(firstBoardBodyStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events,
          prefixBars: [
            prefix("zero", 11, 11, 11, 11),
            prefix("small", 10.7, 11, 10.6, 11),
            prefix("large", 10.1, 11, 10, 11),
            prefix("invalid", 10, 11, 10, 12),
          ],
          postBars: [
            ...([5, 10, 20] as const).flatMap(day => [
              post("zero", 1, 10),
              post("zero", day, 11),
              post("small", 1, 10),
              post("small", day, 10.5),
              post("large", 1, 10),
              post("large", day, 10.2),
              post("invalid", 1, 10),
              post("invalid", day, 11),
            ]),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/first-board-body-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        forwardHorizons: [5, 10, 20],
        roundTripCostBps: 0,
        bootstrapIterations: 100,
        bootstrapBlockDays: 20,
      },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!.customPayload as FirstBoardBodyCustomPayload;
    expect(custom.candidates.exactLimitUpCloseCount).toBe(3);
    expect(custom.candidates.oneWordLimitUpCount).toBe(1);
    const table = outcome.result!.tables!.find(
      item => item.key === "first_board_body_return_matrix"
    )!;
    const baseline = table.rows.find(
      row => row.dimension === "BASELINE" && row.horizon === 10
    )!;
    expect(baseline.sampleCount).toBe(3);
    const zero = table.rows.find(
      row => row.bucket === "EQ_ZERO" && row.horizon === 10
    )!;
    const large = table.rows.find(
      row => row.bucket === "GE_8" && row.horizon === 10
    )!;
    expect(zero.sampleCount).toBe(1);
    expect(large.sampleCount).toBe(1);
    expect(zero.meanNetReturn).toBeCloseTo(0.1, 8);
    expect(large.meanNetReturn).toBeCloseTo(0.02, 8);
  });
});
