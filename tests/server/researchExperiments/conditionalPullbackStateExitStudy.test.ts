import { describe, expect, it } from "vitest";
import { conditionalPullbackStateExitStudyExperiment } from "../../../research-experiments/first-board-pullback/conditional-pullback-state-exit-study/experiment";
import type { ConditionalPullbackStateExitCustomPayload } from "../../../research-experiments/first-board-pullback/conditional-pullback-state-exit-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_005;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_005,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-state-exit-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 3,
  horizons: [5, 10],
  pathRelativeDayRange: { min: 1, max: 10 },
  postRelativeDayRange: { min: 1, max: 10 },
  decisionOffsetDays: 5,
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
    volume: 1,
    amount: 1,
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
    volume: 1,
    amount: 1,
  };
}

function series(
  eventId: string,
  closes: number[],
  exitOpen = 10
): FirstLimitPullbackRawBar[] {
  return closes.map((close, index) => {
    const day = index + 1;
    return post(eventId, day, day === 3 ? exitOpen : 10, close);
  });
}

describe("conditional-pullback-state-exit-study", () => {
  it("触发后入场，并在收盘跌破首板开盘价后下一开盘退出", async () => {
    const events = [event("dynamic"), event("time"), event("no-trigger")];
    const registry = new ExperimentRegistry();
    registry.register(conditionalPullbackStateExitStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events,
          prefixBars: [prefix("dynamic"), prefix("time"), prefix("no-trigger")],
          postBars: [
            ...series(
              "dynamic",
              [10.8, 10.7, 9.4, 10.5, 10.5, 10.5, 10.5, 10.5, 10.5, 10.5],
              9.8
            ),
            ...series(
              "time",
              [10.8, 10.7, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.9]
            ),
            ...series(
              "no-trigger",
              [10.95, 11, 11, 11, 11, 11, 11, 11, 11, 11]
            ),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId:
        "first-board-pullback/conditional-pullback-state-exit-study",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as ConditionalPullbackStateExitCustomPayload;
    expect(custom.candidates.triggeredCount).toBe(2);
    expect(custom.candidates.dynamicTradeCount).toBe(2);
    expect(custom.candidates.stopNextOpenCount).toBe(1);
    const table = outcome.result!.tables!.find(
      item => item.key === "state_machine_performance"
    )!;
    const dynamic = table.rows.find(
      row => row.mode === "CONDITIONAL_DYNAMIC" && row.entryDay === 2
    )!;
    expect(dynamic.sampleCount).toBe(2);
    expect(dynamic.meanHoldingDays).toBeCloseTo(6, 8);
    expect(dynamic.stopExitCount).toBe(1);
  });
});
