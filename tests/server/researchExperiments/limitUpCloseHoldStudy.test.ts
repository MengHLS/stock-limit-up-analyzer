import { describe, expect, it } from "vitest";
import { limitUpCloseHoldStudyExperiment } from "../../../research-experiments/first-board-pullback/limit-up-close-hold-study/experiment";
import type { LimitUpCloseHoldCustomPayload } from "../../../research-experiments/first-board-pullback/limit-up-close-hold-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_002;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_002,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-limit-up-close-hold-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 4,
  horizons: [10, 15, 20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: 5,
};

function event(eventId: string, tradeDate: string): FirstLimitPullbackEvent {
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
    daysSincePreviousLimit: 10,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function prefix(
  eventId: string,
  tradeDate: string,
  oneWord: boolean
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate,
    relativeDay: 0,
    open: oneWord ? 11 : 10,
    high: 11,
    low: oneWord ? 11 : 10,
    close: 11,
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
    tradeDate: "2025-01-03",
    relativeDay: day,
    open: day === 6 ? 10 : close,
    high: Math.max(close, 10),
    low: Math.min(close, 10),
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

function series(
  eventId: string,
  contextCloses: number[]
): FirstLimitPullbackRawBar[] {
  const rows: FirstLimitPullbackRawBar[] = [];
  for (let day = 1; day <= 20; day += 1) {
    const close = day <= 5 ? contextCloses[day - 1]! : day >= 10 ? 11 : 10.2;
    rows.push(post(eventId, day, close));
  }
  return rows;
}

describe("limit-up-close-hold-study", () => {
  it("按 T+1..T+5 最低收盘相对 T 日涨停价分组并排除一字板", async () => {
    const events = [
      event("e1", "2025-01-02"),
      event("e2", "2025-01-03"),
      event("e3", "2025-01-06"),
      event("one-word", "2025-01-07"),
    ];
    const registry = new ExperimentRegistry();
    registry.register(limitUpCloseHoldStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events,
          prefixBars: [
            prefix("e1", "2025-01-02", false),
            prefix("e2", "2025-01-03", false),
            prefix("e3", "2025-01-06", false),
            prefix("one-word", "2025-01-07", true),
          ],
          postBars: [
            ...series("e1", [11, 11.1, 11.2, 11.1, 11]),
            ...series("e2", [11, 10.95, 11, 11.05, 11]),
            ...series("e3", [11, 10.7, 10.6, 10.8, 10.9]),
            ...series("one-word", [11, 11, 11, 11, 11]),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/limit-up-close-hold-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        slightBreachBps: 200,
        forwardHorizons: [10, 15, 20],
        maxEvents: 100,
        roundTripCostBps: 0,
        excludeOneWordLimitUp: true,
        bootstrapIterations: 100,
        bootstrapBlockDays: 20,
      },
    });

    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as LimitUpCloseHoldCustomPayload;
    expect(custom.candidates.candidateCount).toBe(4);
    expect(custom.candidates.eligibleCount).toBe(3);
    expect(custom.candidates.excludedOneWordLimitUpCount).toBe(1);
    expect(custom.contextCounts.atOrAboveCount).toBe(1);
    expect(custom.contextCounts.slightBreachCount).toBe(1);
    expect(custom.contextCounts.deepBreachCount).toBe(1);

    const table = outcome.result!.tables!.find(
      item => item.key === "limit_up_close_performance"
    )!;
    const baseline = table.rows.find(
      row => row.dimension === "BASELINE" && row.horizon === 10
    )!;
    expect(baseline.availableCount).toBe(3);
    const slight = table.rows.find(
      row =>
        row.dimension === "CLOSE_CONTEXT" &&
        row.context === "SLIGHT_BREACH" &&
        row.horizon === 10
    )!;
    expect(slight.availableCount).toBe(1);
    expect(slight.meanGrossReturn).toBeCloseTo(0.1, 8);
  });
});
