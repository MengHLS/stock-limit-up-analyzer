import { describe, expect, it } from "vitest";
import type {
  ExperimentEventRow,
} from "@shared/researchExperimentsContracts";
import { decisionForwardStudyExperiment } from "../../../research-experiments/first-board-pullback/decision-forward-study/experiment";
import type { DecisionForwardMatrixRow } from "../../../research-experiments/first-board-pullback/decision-forward-study/result";
import { createRegistryExperimentDatasetPort } from "../../../server/researchExperiments/datasetPort";
import { ExperimentRegistry } from "../../../server/researchExperiments/registry";
import { createExperimentRunner } from "../../../server/researchExperiments/runner";
import { InMemoryResearchDatasetReader } from "../../../server/researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../../../server/researchRuntime/versionContext";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";

const VERSION_ID = 910_001;

const context: ResearchDatasetVersionContext = {
  datasetVersionId: VERSION_ID,
  datasetId: 930_001,
  datasetCode: "first_limit_pullback",
  datasetName: "首板回踩",
  versionLabel: "v-decision-forward-test",
  status: "READY",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  totalEvents: 3,
  horizons: [10],
  pathRelativeDayRange: { min: 1, max: 20 },
  postRelativeDayRange: { min: 1, max: 20 },
  decisionOffsetDays: null,
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
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: VERSION_ID,
    eventId,
    symbol: "600000.SH",
    tradeDate: `2025-01-${String(Math.max(1, relativeDay)).padStart(2, "0")}`,
    relativeDay,
    open,
    high: Math.max(open, close, low),
    low,
    close,
    volume: 1,
    amount: 1,
  };
}

function series(
  eventId: string,
  eventOpen: number,
  eventClose: number,
  path: Readonly<Record<number, { close: number; low?: number }>>,
  missingDay?: number,
): {
  prefix: FirstLimitPullbackRawBar[];
  post: FirstLimitPullbackRawBar[];
} {
  const prefix = [bar(eventId, 0, eventOpen, eventClose, Math.min(eventOpen, eventClose))];
  const post: FirstLimitPullbackRawBar[] = [];
  let lastClose = eventClose;
  for (let day = 1; day <= 20; day += 1) {
    if (day === missingDay) continue;
    const item = path[day];
    const close = item?.close ?? lastClose;
    const open = lastClose;
    const low = item?.low ?? Math.min(open, close);
    post.push(bar(eventId, day, open, close, low));
    lastClose = close;
  }
  return { prefix, post };
}

function buildRunner(seed: {
  events: FirstLimitPullbackEvent[];
  prefixBars: FirstLimitPullbackRawBar[];
  postBars: FirstLimitPullbackRawBar[];
}) {
  const registry = new ExperimentRegistry();
  registry.register(decisionForwardStudyExperiment);
  const datasetPort = createRegistryExperimentDatasetPort({
    reader: new InMemoryResearchDatasetReader({
      context,
      events: seed.events,
      prefixBars: seed.prefixBars,
      postBars: seed.postBars,
    }),
  });
  return createExperimentRunner({
    registry,
    datasetPort,
    now: () => new Date("2026-09-21T00:00:00.000Z"),
  });
}

function rowOf(
  rows: readonly DecisionForwardMatrixRow[],
  decisionDay: number,
  horizon: number,
  group: DecisionForwardMatrixRow["group"],
): DecisionForwardMatrixRow {
  const found = rows.find(
    (row) => row.decisionDay === decisionDay && row.horizon === horizon && row.group === group,
  );
  if (!found) throw new Error(`missing row ${decisionDay}/${horizon}/${group}`);
  return found;
}

describe("decision-forward-study", () => {
  it("收益严格从决策日收盘起算，并扣除成本", async () => {
    const e1 = event("e1", "2025-01-02");
    const e2 = event("e2", "2025-01-03");
    const s1 = series("e1", 10, 11, {
      1: { close: 10, low: 9.5 },
      5: { close: 12, low: 10 },
      10: { close: 13, low: 12 },
    });
    const s2 = series("e2", 10, 10.5, {
      1: { close: 10.5, low: 10.2 },
      5: { close: 11, low: 10.2 },
      10: { close: 9.9, low: 9.8 },
    });
    const runner = buildRunner({
      events: [e1, e2],
      prefixBars: [...s1.prefix, ...s2.prefix],
      postBars: [...s1.post, ...s2.post],
    });

    const outcome = await runner.run({
      experimentId: "first-board-pullback/decision-forward-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        decisionDays: [1, 5],
        forwardHorizons: [10],
        maxEvents: 100,
        roundTripCostBps: 20,
      },
    });

    expect(outcome.runStatus).toBe("SUCCEEDED");
    const result = outcome.result!;
    const rows = (result.tables?.find((table) => table.key === "decision_forward_matrix")?.rows ??
      []) as unknown as DecisionForwardMatrixRow[];

    const nonBreakT1 = rowOf(rows, 1, 10, "NON_BREAK_OPEN");
    const breakT1 = rowOf(rows, 1, 10, "BREAK_OPEN");
    expect(nonBreakT1.availableCount).toBe(1);
    expect(nonBreakT1.meanGrossReturn).toBeCloseTo(-0.0571428571, 9);
    expect(nonBreakT1.meanNetReturn).toBeCloseTo(-0.0591428571, 9);
    expect(breakT1.meanGrossReturn).toBeCloseTo(0.3, 9);
    expect(breakT1.meanNetReturn).toBeCloseTo(0.298, 9);

    const nonBreakT5 = rowOf(rows, 5, 10, "NON_BREAK_OPEN");
    expect(nonBreakT5.meanGrossReturn).toBeCloseTo(-0.1, 9);
    expect(nonBreakT5.meanNetReturn).toBeCloseTo(-0.102, 9);
  });

  it("决策路径齐备但远期窗口缺数据时，sampleCount 保留而 availableCount 下降", async () => {
    const e1 = event("e1", "2025-01-02");
    const e2 = event("e2", "2025-01-03");
    const complete = series("e1", 9, 10, {
      1: { close: 10.5, low: 10 },
      5: { close: 11, low: 10.2 },
      10: { close: 12, low: 11 },
    });
    const missing10 = series(
      "e2",
      9,
      10,
      {
        1: { close: 10.5, low: 10 },
        5: { close: 11, low: 10.2 },
        10: { close: 12, low: 11 },
      },
      10,
    );

    const runner = buildRunner({
      events: [e1, e2],
      prefixBars: [...complete.prefix, ...missing10.prefix],
      postBars: [...complete.post, ...missing10.post],
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/decision-forward-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        decisionDays: [5],
        forwardHorizons: [10],
        maxEvents: 100,
        roundTripCostBps: 0,
      },
    });

    expect(outcome.runStatus).toBe("SUCCEEDED");
    const rows = outcome.result!.tables!.find((table) => table.key === "decision_forward_matrix")!
      .rows as unknown as DecisionForwardMatrixRow[];
    const all = rowOf(rows, 5, 10, "ALL");
    expect(all.sampleCount).toBe(2);
    expect(all.availableCount).toBe(1);
  });

  it("跨年度输出按事件年份分组", async () => {
    const e1 = event("e1", "2025-01-02");
    const e2 = event("e2", "2026-01-05");
    const s1 = series("e1", 9, 10, { 1: { close: 10.5, low: 10 }, 10: { close: 11 } });
    const s2 = series("e2", 9, 10, { 1: { close: 10.5, low: 10 }, 10: { close: 9 } });
    const runner = buildRunner({
      events: [e1, e2],
      prefixBars: [...s1.prefix, ...s2.prefix],
      postBars: [...s1.post, ...s2.post],
    });
    const outcome = await runner.run({
      experimentId: "first-board-pullback/decision-forward-study",
      datasetVersionId: VERSION_ID,
      parameters: {
        decisionDays: [1],
        forwardHorizons: [10],
        maxEvents: 100,
        roundTripCostBps: 0,
      },
    });
    expect(outcome.runStatus).toBe("SUCCEEDED");
    const annual = outcome.result!.tables!.find((table) => table.key === "annual_forward_by_group")!;
    const years = new Set(annual.rows.map((row) => row.year));
    expect(years).toEqual(new Set([2025, 2026]));
  });
});
