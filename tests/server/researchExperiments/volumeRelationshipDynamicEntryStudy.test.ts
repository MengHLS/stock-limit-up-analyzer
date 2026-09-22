import { describe, expect, it } from "vitest";
import { volumeRelationshipDynamicEntryStudyExperiment } from "../../../research-experiments/first-board-pullback/volume-relationship-dynamic-entry-study/experiment";
import type { VolumeRelationshipCustomPayload } from "../../../research-experiments/first-board-pullback/volume-relationship-dynamic-entry-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_006;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_006,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-volume-dynamic-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 1,
  horizons: [5, 10],
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

function bar(
  relativeDay: number,
  open: number,
  close: number,
  volume: number
): FirstLimitPullbackRawBar {
  const limitUp = Math.round(open * 1.1 * 100) / 100;
  const limitDown = Math.round(open * 0.9 * 100) / 100;
  return {
    datasetVersionId: VERSION_ID,
    eventId: "e1",
    symbol: "600000.SH",
    tradeDate: relativeDay === 0 ? "2025-06-01" : "2025-06-03",
    relativeDay,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    preClose: relativeDay === 0 ? 10 : open,
    limitUpPrice: limitUp,
    limitDownPrice: limitDown,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
    volume,
    amount: volume,
  };
}

describe("volume-relationship-dynamic-entry-study", () => {
  it("在固定动态入场后计算 T-n/T 与 T+N/T 量比", async () => {
    const registry = new ExperimentRegistry();
    registry.register(volumeRelationshipDynamicEntryStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [event()],
          prefixBars: [
            { ...bar(-10, 10, 10, 50), limitUpPrice: 11, limitDownPrice: 9 },
            { ...bar(-5, 10, 10, 80), limitUpPrice: 11, limitDownPrice: 9 },
            { ...bar(-2, 10, 10, 90), limitUpPrice: 11, limitDownPrice: 9 },
            { ...bar(-1, 10, 10, 100), limitUpPrice: 11, limitDownPrice: 9 },
            { ...bar(0, 9.5, 11, 100), limitUpPrice: 11, limitDownPrice: 9 },
          ],
          postBars: [
            bar(1, 10, 10.8, 150),
            bar(2, 10, 10.7, 180),
            bar(3, 10, 10.8, 120),
            bar(4, 10, 10.8, 110),
            bar(5, 10, 10.8, 90),
            bar(6, 10, 10.8, 80),
            bar(7, 10, 10.8, 70),
            bar(8, 10, 10.8, 60),
            bar(9, 10, 10.8, 50),
            bar(10, 10, 10.9, 50),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId:
        "first-board-pullback/volume-relationship-dynamic-entry-study",
      datasetVersionId: VERSION_ID,
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as VolumeRelationshipCustomPayload;
    expect(custom.candidates.dynamicTradeCount).toBe(1);
    const table = outcome.result!.tables!.find(
      item => item.key === "volume_relationship_matrix"
    )!;
    const tMinus1 = table.rows.find(
      row => row.factorCode === "pre_t_minus_1" && row.bucket === "P80_120"
    )!;
    const tPlus5 = table.rows.find(
      row => row.factorCode === "post_t_plus_5" && row.bucket === "P80_120"
    )!;
    expect(tMinus1.sampleCount).toBe(1);
    expect(tPlus5.sampleCount).toBe(1);
  });
});
