import { describe, expect, it } from "vitest";
import { dynamicStateFactorExpansionStudyExperiment } from "../../../research-experiments/first-board-pullback/dynamic-state-factor-expansion-study/experiment";
import type { DynamicStateFactorExpansionPayload } from "../../../research-experiments/first-board-pullback/dynamic-state-factor-expansion-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_008;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_008,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-factor-expansion-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 2,
  horizons: [10],
  pathRelativeDayRange: { min: 1, max: 10 },
  postRelativeDayRange: { min: 1, max: 10 },
  decisionOffsetDays: 5,
};

function event(
  eventId: string,
  historicalLimitCount: number
): FirstLimitPullbackEvent {
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
    turnover: historicalLimitCount === 1 ? 1 : 9,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: 10,
    historicalLimitCount,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function prefix(eventId: string, amount: number): FirstLimitPullbackRawBar {
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
    amount,
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

describe("dynamic-state-factor-expansion-study", () => {
  it("生成同日横截面分位、历史次数与 T+1 执行因子", async () => {
    const registry = new ExperimentRegistry();
    registry.register(dynamicStateFactorExpansionStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [event("low", 1), event("high", 6)],
          prefixBars: [prefix("low", 100), prefix("high", 200)],
          postBars: [
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(day =>
              post("low", day, day === 1 ? 10.8 : 10.8, day === 1 ? 80 : 100)
            ),
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(day =>
              post("high", day, day === 1 ? 10.8 : 11, day === 1 ? 200 : 100)
            ),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/dynamic-state-factor-expansion-study",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as DynamicStateFactorExpansionPayload;
    expect(custom.candidates.tradeCount).toBe(2);
    const table = outcome.result!.tables!.find(
      item => item.key === "dynamic_state_factor_expansion"
    )!;
    expect(
      table.rows.find(
        row =>
          row.factorCode === "historical_limit_count" && row.bucket === "H6_10"
      )?.sampleCount
    ).toBe(1);
    expect(
      table.rows.find(
        row =>
          row.factorCode === "amount_percentile" && row.bucket === "P80_100"
      )?.sampleCount
    ).toBe(1);
  });
});
