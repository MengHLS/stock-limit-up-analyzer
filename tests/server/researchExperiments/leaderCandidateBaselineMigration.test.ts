import { describe, expect, it } from "vitest";
import { leaderCandidateBaselineExperiment } from "../../../research-experiments/combo-backtest/leader-candidate-baseline/experiment";
import type { LeaderCandidateBaselinePayload } from "../../../research-experiments/combo-backtest/leader-candidate-baseline/result";
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
const EVENT_DATES = ["2025-06-02", "2025-06-03", "2025-06-04"] as const;
const VERSION_CONTEXT: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 990_014,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "combo-v1",
  status: "READY",
  startDate: "2025-06-02",
  endDate: "2025-07-31",
  totalEvents: 9,
  horizons: [1, 5, 10, 20],
  pathRelativeDayRange: { min: 1, max: 30 },
  postRelativeDayRange: { min: 1, max: 30 },
  decisionOffsetDays: null,
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function event(index: number, eventDate: string): FirstLimitPullbackEvent {
  const code = `60000${index}.SH`;
  return {
    datasetVersionId: VERSION_ID,
    eventId: `${code}@${eventDate}`,
    symbol: code,
    tradeDate: eventDate,
    market: "SH",
    industryCode: "IND",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    limitDownPrice: 9,
    limitRuleUp: 0.1,
    limitRuleDown: 0.1,
    limitRuleVersion: "test",
    turnover: 5,
    limitUpTime: "09:40:00",
    sector: "测试题材",
    keywords: "测试题材",
    sourceTurnoverAmount: 20,
    sourceCirculationValue: 100,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 0,
    marketCap: 100,
    floatMarketCap: 100,
  };
}

function post(eventId: string, day: number): FirstLimitPullbackRawBar {
  const eventDate = eventId.split("@")[1]!;
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: eventId.split("@")[0]!,
    tradeDate: addDays(eventDate, day),
    relativeDay: day,
    open: 10.9,
    high: 11.1,
    low: 10.8,
    close: 11,
    preClose: day === 1 ? 11 : 11,
    limitUpPrice: 12,
    limitDownPrice: 9,
    barPresent: true,
    suspensionStatus: "NOT_SUSPENDED",
    canBuyAtOpen: true,
    canSellAtClose: true,
    volume: 100,
    amount: 100,
  };
}

describe("combo-backtest/leader-candidate-baseline migration", () => {
  it("从 combo-v1 Dataset 取数并在 T+1 开盘建立 100 股仓位", async () => {
    const events = EVENT_DATES.flatMap(eventDate => [
      event(1, eventDate),
      event(2, eventDate),
      event(3, eventDate),
    ]);
    const postBars = events.flatMap(row =>
      Array.from({ length: 30 }, (_, index) => post(row.eventId, index + 1))
    );
    const registry = new ExperimentRegistry();
    registry.register(leaderCandidateBaselineExperiment);
    const runner = createExperimentRunner({
      registry,
      datasetPort: createRegistryExperimentDatasetPort({
        reader: new InMemoryResearchDatasetReader({
          context: VERSION_CONTEXT,
          events,
          postBars,
        }),
      }),
    });

    const outcome = await runner.run({
      experimentId: "combo-backtest/leader-candidate-baseline",
      datasetVersionId: VERSION_ID,
    });

    expect(outcome.runStatus).toBe("SUCCEEDED");
    expect(outcome.execution.datasetFacts.selectionFrozen).toBe(true);
    expect(outcome.execution.datasetFacts.selectedEventCount).toBe(9);
    const custom = outcome.result!
      .customPayload as LeaderCandidateBaselinePayload;
    expect(custom.source.sourceSignals).toBe(9);
    expect(custom.source.sourceKnownSignals).toBe(9);
    expect(custom.portfolio.filledCount).toBe(3);
    expect(custom.portfolio.openPositionCount).toBe(0);
    expect(
      outcome
        .result!.tables!.find(item => item.key === "portfolio_trades")!
        .rows.every(
          row => row.exitReason === "T+2收盘未满足强势续持条件"
        )
    ).toBe(true);
  });
});
