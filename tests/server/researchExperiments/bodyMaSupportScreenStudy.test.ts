import { describe, expect, it } from "vitest";
import { bodyMaSupportScreenStudyExperiment } from "../../../research-experiments/first-board-pullback/body-ma-support-screen-study/experiment";
import type { SupportScreenPayload } from "../../../research-experiments/first-board-pullback/body-ma-support-screen-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 980_014;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_014,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v5",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 4,
  horizons: [20],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: 5,
};

function event(
  eventId: string,
  options: {
    gapPct?: number;
    daysSincePreviousLimit?: number | null;
  } = {}
): FirstLimitPullbackEvent {
  const open = 10 * (1 + (options.gapPct ?? 0.01));
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
    daysSincePreviousLimit:
      options.daysSincePreviousLimit === undefined
        ? 20
        : options.daysSincePreviousLimit,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function prefix(
  eventId: string,
  relativeDay: number,
  close: number
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: `2025-05-${String(20 + relativeDay).padStart(2, "0")}`,
    relativeDay,
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 100,
    amount: 100,
  };
}

function eventDay(eventId: string, open: number): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: "2025-06-01",
    relativeDay: 0,
    open,
    high: 11,
    low: open,
    close: 11,
    preClose: 10,
    volume: 100,
    amount: 100,
  };
}

function post(
  eventId: string,
  day: number,
  open: number,
  close: number,
  options: { high?: number; low?: number } = {}
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: `2025-06-${String(day + 1).padStart(2, "0")}`,
    relativeDay: day,
    open,
    high: options.high ?? Math.max(open, close) + 0.05,
    low: options.low ?? Math.min(open, close) - 0.05,
    close,
    preClose: open,
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

function completePost(
  eventId: string,
  options: { limitTouchDay?: number } = {}
): FirstLimitPullbackRawBar[] {
  return Array.from({ length: 20 }, (_, index) => {
    const day = index + 1;
    const close = day <= 5 ? 10.7 + day * 0.04 : 11 + day * 0.03;
    const open = day === 6 ? 11 : close - 0.05;
    const limitTouch = day === options.limitTouchDay;
    return post(eventId, day, open, close, {
      high: limitTouch ? 11 : undefined,
      low: limitTouch ? 9 : undefined,
    });
  });
}

describe("body-ma-support-screen-study", () => {
  it("applies all screens and keeps entity/MA support groups separate", async () => {
    const registry = new ExperimentRegistry();
    registry.register(bodyMaSupportScreenStudyExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events: [
            event("pass"),
            event("gap", { gapPct: 0.03 }),
            event("recent-limit", { daysSincePreviousLimit: 5 }),
            event("limit-touch"),
          ],
          prefixBars: [
            ...Array.from({ length: 19 }, (_, index) =>
              prefix("pass", -(index + 1), 10)
            ),
            ...Array.from({ length: 19 }, (_, index) =>
              prefix("gap", -(index + 1), 10)
            ),
            ...Array.from({ length: 19 }, (_, index) =>
              prefix("recent-limit", -(index + 1), 10)
            ),
            ...Array.from({ length: 19 }, (_, index) =>
              prefix("limit-touch", -(index + 1), 10)
            ),
            eventDay("pass", 10.1),
            eventDay("gap", 10.3),
            eventDay("recent-limit", 10.1),
            eventDay("limit-touch", 10.1),
          ],
          postBars: [
            ...completePost("pass"),
            ...completePost("gap"),
            ...completePost("recent-limit"),
            ...completePost("limit-touch", { limitTouchDay: 2 }),
          ],
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/body-ma-support-screen-study",
      datasetVersionId: VERSION_ID,
      parameters: { bootstrapIterations: 100 },
    });
    expect(outcome.runStatus, JSON.stringify(outcome.error)).toBe("SUCCEEDED");
    const custom = outcome.result!
      .customPayload as SupportScreenPayload;
    expect(custom.candidates.afterGapCount).toBe(3);
    expect(custom.candidates.afterNoLimitCount).toBe(2);
    expect(custom.candidates.afterNoPreviousLimitCount).toBe(1);
    expect(custom.candidates.eligibleCount).toBe(1);
    const bodyTop = custom.groupCounts.find(
      row => row.groupCode === "BODY_TOP"
    )!;
    expect(bodyTop.eventCount).toBe(0);
    expect(
      custom.groupCounts
        .filter(row => row.groupCode !== "BODY_TOP")
        .every(row => row.eventCount === 1)
    ).toBe(true);

    const table = outcome.result!.tables!.find(
      item => item.key === "body_ma_entry_aligned_curve"
    )!;
    expect(table.rows.length).toBe(5 * 2 * 15);
  });
});
