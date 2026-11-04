import { describe, expect, it } from "vitest";
import type { ExperimentEventRow } from "@shared/researchExperimentsContracts";
import { preEventContextStudyExperiment } from "../../../research-experiments/first-board-pullback/pre-event-context-study/experiment";
import type { PreEventContextCustomPayload } from "../../../research-experiments/first-board-pullback/pre-event-context-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 960_001;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 970_001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-pre-event-test",
  status: "READY",
  startDate: "2024-01-01",
  endDate: "2025-12-31",
  totalEvents: 2,
  horizons: [5, 10, 20],
  pathRelativeDayRange: { min: -20, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: 1,
};

function event(eventId: string, gapDays: number | null): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-01-02",
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    turnover: 1,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: gapDays,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function prefixBar(eventId: string, day: number, close: number): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-01-02",
    relativeDay: day,
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 1,
    amount: 1,
  };
}

function postBar(eventId: string, day: number, close: number): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: "2025-01-03",
    relativeDay: day,
    open: day === 1 ? 10 : close,
    high: close,
    low: Math.min(10, close),
    close,
    preClose: close,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
    volume: 1,
    amount: 1,
  };
}

describe("pre-event-context-study", () => {
  it("用 PIT 间隔和 T-1/T-n 收盘计算前期涨幅，并输出上下文矩阵", async () => {
    const events = [event("e1", 10), event("e2", null)];
    const prefixBars = [
      prefixBar("e1", 0, 11),
      prefixBar("e1", -1, 10),
      prefixBar("e1", -5, 9),
      prefixBar("e1", -10, 8),
      prefixBar("e1", -20, 8.2),
      prefixBar("e2", 0, 11),
      prefixBar("e2", -1, 10),
      prefixBar("e2", -5, 11),
      prefixBar("e2", -10, 12),
      prefixBar("e2", -20, 13),
    ];
    const postBars = [
      postBar("e1", 1, 10.5),
      postBar("e1", 5, 11),
      postBar("e1", 10, 12),
      postBar("e1", 20, 11),
      postBar("e2", 1, 10.5),
      postBar("e2", 5, 9),
      postBar("e2", 10, 9.5),
      postBar("e2", 20, 9),
    ];
    const registry = new ExperimentRegistry();
    registry.register(preEventContextStudyExperiment);
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
      experimentId: "first-board-pullback/pre-event-context-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        preReturnWindows: [5, 10, 20],
        forwardHorizons: [5, 10, 20],
        primaryInteractionWindow: 10,
        maxEvents: 100,
        roundTripCostBps: 0,
      },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!.customPayload as PreEventContextCustomPayload;
    expect(custom.candidates.eligibleCount).toBe(2);
    expect(custom.contextCounts.gapKnownCount).toBe(1);
    expect(custom.contextCounts.gapUnknownCount).toBe(1);
    const table = outcome.result!.tables!.find(
      (item) => item.key === "pre_event_context_matrix",
    )!;
    const gapRow = table.rows.find(
      (row) =>
        row.dimension === "GAP" &&
        row.gapGroup === "GAP_6_10" &&
        row.horizon === 10,
    )!;
    expect(gapRow.availableCount).toBe(1);
    expect(gapRow.meanGrossReturn).toBeCloseTo(0.2, 8);
    const preRow = table.rows.find(
      (row) =>
        row.dimension === "PRE_RETURN" &&
        row.preWindow === 5 &&
        row.preReturnBucket === "POS10_POS20" &&
        row.horizon === 5,
    )!;
    expect(preRow.availableCount).toBe(1);
    expect(preRow.meanGrossReturn).toBeCloseTo(0.1, 8);
  });
});
