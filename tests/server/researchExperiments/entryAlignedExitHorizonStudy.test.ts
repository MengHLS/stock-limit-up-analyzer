import { describe, expect, it } from "vitest";
import { entryAlignedExitHorizonStudyExperiment } from "../../../research-experiments/first-board-pullback/entry-aligned-exit-horizon-study/experiment";
import type { EntryAlignedExitHorizonPayload } from "../../../research-experiments/first-board-pullback/entry-aligned-exit-horizon-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_013;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_013,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-entry-aligned-exit-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 3,
  horizons: [20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: 5,
};

function event(eventId: string): FirstLimitPullbackEvent {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
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
  args: { open: number; high: number; low: number; close: number }
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: "2025-06-01",
    relativeDay: 0,
    ...args,
    preClose: 10,
    volume: 100,
    amount: 100,
  };
}

function post(
  eventId: string,
  day: number,
  args: {
    open: number;
    high: number;
    low: number;
    close: number;
  }
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: `2025-06-${String(day + 1).padStart(2, "0")}`,
    relativeDay: day,
    ...args,
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

function contextBars(eventId: string, touchLimit = false): FirstLimitPullbackRawBar[] {
  return Array.from({ length: 5 }, (_, index) =>
    post(eventId, index + 1, {
      open: 10.2 + index * 0.02,
      high: touchLimit && index === 2 ? 11 : 10.5 + index * 0.02,
      low: 10.1 + index * 0.02,
      close: 10.3 + index * 0.02,
    })
  );
}

function forwardBars(eventId: string): FirstLimitPullbackRawBar[] {
  return Array.from({ length: 15 }, (_, index) => {
    const close = 10.5 + (index + 1) * 0.1;
    return post(eventId, index + 6, {
      open: 10.5 + index * 0.1,
      high: close + 0.1,
      low: 10.4 + index * 0.1,
      close,
    });
  });
}

describe("entry-aligned-exit-horizon-study", () => {
  it("排除一字板与T+1..T+5涨跌停触达，并按持有日展开共同样本", async () => {
    const registry = new ExperimentRegistry();
    registry.register(entryAlignedExitHorizonStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [event("clean"), event("one-word"), event("touch")],
          prefixBars: [
            prefix("clean", { open: 10, high: 11, low: 10, close: 11 }),
            prefix("one-word", { open: 11, high: 11, low: 11, close: 11 }),
            prefix("touch", { open: 10, high: 11, low: 10, close: 11 }),
          ],
          postBars: [
            ...contextBars("clean"),
            ...forwardBars("clean"),
            ...contextBars("one-word"),
            ...forwardBars("one-word"),
            ...contextBars("touch", true),
            ...forwardBars("touch"),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/entry-aligned-exit-horizon-study",
      datasetVersionId: VERSION_ID,
    });

    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as EntryAlignedExitHorizonPayload;
    expect(custom.candidates.candidateCount).toBe(3);
    expect(custom.candidates.exactLimitUpCloseCount).toBe(3);
    expect(custom.candidates.nonOneWordCount).toBe(2);
    expect(custom.candidates.cleanContextCount).toBe(1);
    expect(custom.candidates.sampleCount).toBe(1);
    expect(outcome.result!.sampleSummary?.excludedByReason).toMatchObject({
      ONE_WORD_LIMIT_UP: 1,
      HAD_LIMIT_TOUCH_IN_CONTEXT: 1,
    });

    const table = outcome.result!.tables!.find(
      item => item.key === "entry_aligned_exit_curve"
    )!;
    expect(table.rows).toHaveLength(15);
    const holdingFive = table.rows.find(row => row.holdingDay === 5)!;
    expect(holdingFive.targetEventDay).toBe(10);
    expect(holdingFive.sampleCount).toBe(1);
    expect(holdingFive.meanNetReturn).toBeCloseTo(11 / 10.5 - 1 - 0.002, 9);
    expect(holdingFive.meanMaxCloseDrawdown).toBe(0);
  });
});
