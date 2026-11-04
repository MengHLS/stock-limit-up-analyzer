import { describe, expect, it } from "vitest";
import type { ExperimentEventRow } from "@shared/researchExperimentsContracts";
import { holdOpenPricePullbackExperiment } from "../../../research-experiments/first-board-pullback/hold-open-price-pullback/experiment";
import type { HoldOpenPricePullbackCustomPayload } from "../../../research-experiments/first-board-pullback/hold-open-price-pullback/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 940_001;
const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 950_001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-hold-open-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 4,
  horizons: [10],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: 5,
};

function event(eventId: string): FirstLimitPullbackEvent {
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
    limitDownPrice: 9,
    limitRuleUp: 0.1,
    limitRuleDown: 0.1,
    limitRuleVersion: "cn-limit-rules-v1",
    turnover: 1,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 1,
    marketCap: 1,
    floatMarketCap: 1,
  };
}

function bar(
  eventId: string,
  relativeDay: number,
  open: number,
  close: number,
  low: number,
  canBuyAtOpen = true,
  canSellAtClose = true,
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: `2025-01-${String(relativeDay).padStart(2, "0")}`,
    relativeDay,
    open,
    high: Math.max(open, close, low),
    low,
    close,
    preClose: open,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen,
    canSellAtClose,
    volume: 1,
    amount: 1,
  };
}

function series(
  eventId: string,
  path: Readonly<Record<number, { close: number; low: number; open?: number; canBuy?: boolean; canSell?: boolean }>>,
): { prefix: FirstLimitPullbackRawBar[]; post: FirstLimitPullbackRawBar[] } {
  const prefix = [bar(eventId, 0, 10, 11, 10)];
  const post: FirstLimitPullbackRawBar[] = [];
  let last = 11;
  for (let day = 1; day <= 20; day += 1) {
    const item = path[day];
    const open = item?.open ?? last;
    const close = item?.close ?? last;
    const low = item?.low ?? Math.min(open, close);
    post.push(bar(eventId, day, open, close, low, item?.canBuy ?? true, item?.canSell ?? true));
    last = close;
  }
  return { prefix, post };
}

describe("hold-open-price-pullback", () => {
  it("冷启动仅登记交易周期事实，不把未触发 / 破位算成 0 收益", async () => {
    const events = [event("e1"), event("e2"), event("e3"), event("e4")];
    const s1 = series("e1", {
      1: { close: 11, low: 10.95 },
      2: { close: 10.7, low: 10.7, open: 10.8 },
      3: { close: 10.4, low: 10.4, open: 10.7 },
      10: { close: 11, low: 10.3 },
    });
    const s2 = series("e2", {
      1: { close: 10.2, low: 9.99 },
      10: { close: 12, low: 10.1 },
    });
    const s3 = series("e3", {
      1: { close: 11, low: 10.95 },
      5: { close: 11, low: 11 },
      10: { close: 11, low: 11 },
    });
    const s4 = series("e4", {
      1: { close: 11, low: 10.95 },
      2: { close: 10.7, low: 10.7, open: 10.8 },
      3: { close: 10.4, low: 10.3, open: 10.7, canBuy: false },
      10: { close: 11, low: 10.1 },
    });

    const registry = new ExperimentRegistry();
    registry.register(holdOpenPricePullbackExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context,
          events,
          prefixBars: [...s1.prefix, ...s2.prefix, ...s3.prefix, ...s4.prefix],
          postBars: [...s1.post, ...s2.post, ...s3.post, ...s4.post],
        }),
      }),
      now: () => new Date("2026-09-22T00:00:00.000Z"),
    });

    const outcome = await runner.run({
      experimentId: "first-board-pullback/hold-open-price-pullback",
      datasetVersionId: VERSION_ID,
      parameters: {
        entryWindowDays: 5,
        pullbackTriggerBps: 100,
        exitDays: [10],
        maxEvents: 100,
        roundTripCostBps: 0,
      },
    });

    expect(outcome.runStatus).toBe("SUCCEEDED");
    const custom = outcome.result!.customPayload as HoldOpenPricePullbackCustomPayload;
    expect(custom.candidates.eligibleCount).toBe(4);
    expect(custom.accounting.breakBeforeEntryCount).toBe(1);
    expect(custom.accounting.noTriggerCount).toBe(1);
    expect(custom.accounting.triggeredCount).toBe(2);
    expect(custom.accounting.entryUnfillableCount).toBe(1);
    expect(custom.accounting.tradeSampleCount).toBe(1);
    const trades = outcome.result!.tables!.find((table) => table.key === "trade_performance")!;
    const row = trades.rows.find((item) => item.triggerDay === 2 && item.exitDay === 10)!;
    expect(row.availableCount).toBe(1);
    expect(row.meanGrossReturn).toBeCloseTo(11 / 10.7 - 1, 8);
  });

  it("缺少等待窗口行情时归入样本账外，不伪造触发或收益", async () => {
    const events = [event("e1")];
    const s1 = series("e1", {
      1: { close: 10.5, low: 10.2 },
    });
    s1.post = s1.post.filter((row) => row.relativeDay !== 3);
    const registry = new ExperimentRegistry();
    registry.register(holdOpenPricePullbackExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context: { ...context, totalEvents: 1 },
          events,
          prefixBars: s1.prefix,
          postBars: s1.post,
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/hold-open-price-pullback",
      datasetVersionId: VERSION_ID,
      parameters: { entryWindowDays: 5, pullbackTriggerBps: 100, exitDays: [10], maxEvents: 100 },
    });
    expect(outcome.result!.sampleSummary.eligibleCount).toBe(0);
    expect(outcome.result!.sampleSummary.excludedByReason.MISSING_SIGNAL_PATH).toBe(1);
  });

  it("排除一字涨停首板时，事件仍保留候选账但不进入 eligible", async () => {
    const e1 = event("e1");
    const oneWord = bar("e1", 0, 11, 11, 11);
    oneWord.high = 11;
    oneWord.low = 11;
    const post = Array.from({ length: 20 }, (_, index) =>
      bar("e1", index + 1, 11, 11, 11),
    );
    const registry = new ExperimentRegistry();
    registry.register(holdOpenPricePullbackExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context: { ...context, totalEvents: 1 },
          events: [e1],
          prefixBars: [oneWord],
          postBars: post,
        }),
      }),
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/hold-open-price-pullback",
      datasetVersionId: VERSION_ID,
      parameters: {
        entryWindowDays: 5,
        pullbackTriggerBps: 100,
        exitDays: [10],
        maxEvents: 100,
        excludeOneWordLimitUp: true,
      },
    });
    const custom = outcome.result!.customPayload as HoldOpenPricePullbackCustomPayload;
    expect(custom.candidates.candidateCount).toBe(1);
    expect(custom.candidates.eligibleCount).toBe(0);
    expect(custom.candidates.eventOneWordLimitUpCount).toBe(1);
    expect(outcome.result!.sampleSummary.excludedByReason.EXCLUDED_ONE_WORD_LIMIT_UP).toBe(1);
  });
});
