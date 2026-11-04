import { describe, expect, it } from "vitest";
import type {
  ExperimentArtifactFileSpec,
  ExperimentBarRow,
  ExperimentDescriptor,
  ExperimentEventRow,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import { buyAdjustedPrice, sellAdjustedPrice } from "../../../research-experiments/shared/firstBoardPullback/cost";
import { buildFirstBoardPullbackFoundation } from "../../../research-experiments/shared/firstBoardPullback/foundation";
import { DEFAULT_FOUNDATION_COST } from "../../../research-experiments/shared/firstBoardPullback/types";
import { withFirstBoardPullbackFoundation } from "../../../research-experiments/shared/firstBoardPullback/wrapExperiment";
import { assertRequirementCodeMatches } from "../../../server/researchExperiments/datasetPort";
import type { ExperimentDefinition } from "@shared/researchExperimentsContracts";

function eventRow(eventId: string): ExperimentEventRow {
  return {
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: "2025-01-02",
    values: {
      isFirstLimit: true,
      boardType: "main",
      market: "SH",
      previousClose: 10,
      limitUpPrice: 11,
      turnover: 0.05,
      floatMarketCap: 1_000_000,
    },
  };
}

function eventDayBar(eventId: string): ExperimentBarRow {
  return {
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: "2025-01-02",
    values: {
      open: 9.5,
      high: 11,
      low: 9.5,
      close: 11,
    },
  };
}

function postBar(
  eventId: string,
  day: number,
  options: {
    open?: number;
    close?: number;
    canBuyAtOpen?: boolean;
    canSellAtClose?: boolean;
    suspended?: boolean;
  } = {}
): ExperimentBarRow {
  const open = options.open ?? 10.5;
  const close = options.close ?? 10.6;
  return {
    eventId,
    symbol: `${eventId}.SH`,
    tradeDate: `2025-01-${String(2 + day).padStart(2, "0")}`,
    values: {
      relativeDay: day,
      open,
      high: Math.max(open, close) + 0.1,
      low: Math.min(open, close) - 0.1,
      close,
      preClose: open,
      limitUpPrice: 12,
      limitDownPrice: 9,
      barPresent: true,
      suspensionStatus: options.suspended ? "SUSPENDED" : "NOT_SUSPENDED",
      canBuyAtOpen: options.canBuyAtOpen ?? true,
      canSellAtClose: options.canSellAtClose ?? true,
    },
  };
}

function contextWith(
  label: string,
  eventIds: readonly string[],
  postRows: readonly ExperimentBarRow[],
  artifacts: ExperimentArtifactFileSpec[]
): ExperimentRunContext {
  const descriptor: ExperimentDescriptor = {
    id: "first-board-pullback/foundation-test",
    name: "foundation test",
    version: "1.0.0",
    description: "test",
    source: "test",
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: [],
        feature: [],
        observation: [],
      },
      decisionOffsetDays: null,
      usesForwardData: true,
    },
    pageKey: "first-board-pullback/foundation-test",
    pageTitle: "foundation test",
  };
  const events = eventIds.map(eventRow);
  return {
    descriptor,
    codeDigest: "exp-code-sha256:test",
    protocol: null,
    parameters: {},
    dataset: {
      facts: {
        datasetVersionId: 660001,
        datasetCode: "first_limit_pullback",
        datasetName: "首板回踩",
        datasetVersionLabel: label,
        status: "READY",
        startDate: "2019-01-01",
        endDate: "2026-09-04",
        totalEvents: events.length,
        postRelativeDayRange: { min: 1, max: 20 },
      },
      async events() {
        return events;
      },
      async *eventPages() {
        yield events;
      },
      async feature() {
        return eventIds.map(eventDayBar);
      },
      async observation(relativeDay) {
        return postRows.filter(
          row => Number(row.values.relativeDay) === relativeDay
        );
      },
    },
    datasets: {},
    freezeSelection() {},
    log() {},
    artifact(spec) {
      artifacts.push(spec);
    },
  };
}

function fullPostFor(
  eventId: string,
  overrides: Record<number, Partial<Parameters<typeof postBar>[2]>> = {}
): ExperimentBarRow[] {
  return Array.from({ length: 20 }, (_, index) => {
    const day = index + 1;
    return postBar(eventId, day, {
      canBuyAtOpen: day !== 6 ? true : true,
      ...overrides[day],
    });
  });
}

describe("first-board-pullback public foundation", () => {
  it("declares and enforces the v5 Dataset binding", () => {
    const definition: ExperimentDefinition = {
      descriptor: {
        id: "first-board-pullback/dummy",
        name: "dummy",
        version: "1.0.0",
        description: "dummy",
        source: "test",
        parameters: [],
        datasetRequirement: {
          datasetCode: "first_limit_pullback",
          requiredColumns: {
            events: [],
            feature: [],
            observation: [],
          },
          decisionOffsetDays: null,
          usesForwardData: false,
        },
        pageKey: "first-board-pullback/dummy",
        pageTitle: "dummy",
      },
      resultSchema: {
        safeParse: value => ({ success: true, data: value }),
      } as never,
      run: async () => ({
        sampleSummary: {
          candidateCount: 0,
          eligibleCount: 0,
          excludedCount: 0,
          excludedByReason: {},
        },
      }),
    };
    const wrapped = withFirstBoardPullbackFoundation(definition);
    expect(
      wrapped.descriptor.datasetRequirement.requiredDatasetVersionLabel
    ).toBe("v5");
    expect(() =>
      assertRequirementCodeMatches(
        wrapped.descriptor.id,
        wrapped.descriptor.datasetRequirement,
        {
          datasetVersionId: 570001,
          datasetCode: "first_limit_pullback",
          datasetName: "首板回踩",
          datasetVersionLabel: "v4-validation",
          status: "READY",
          startDate: null,
          endDate: null,
          totalEvents: 0,
          postRelativeDayRange: { min: 1, max: 20 },
        }
      )
    ).toThrow(/要求数据集版本 "v5"/);
  });

  it("rejects non-v5 Dataset versions", async () => {
    const artifacts: ExperimentArtifactFileSpec[] = [];
    const context = contextWith("v4-validation", ["a"], fullPostFor("a"), artifacts);
    await expect(buildFirstBoardPullbackFoundation(context)).rejects.toThrow(
      /要求 Dataset version=v5/
    );
  });

  it("aligns holdingDay from actual entry and uses next sellable open", async () => {
    const artifacts: ExperimentArtifactFileSpec[] = [];
    const context = contextWith(
      "v5",
      ["a"],
      fullPostFor("a", {
        10: { close: 10.2, canSellAtClose: false },
        11: { open: 10.3, close: 10.4, canSellAtClose: true },
      }),
      artifacts
    );
    const output = await buildFirstBoardPullbackFoundation(context);
    const curve = output.curveRows.find(
      row =>
        row.group_code === "ALL" &&
        row.entry_mode === "FIXED_T6_OPEN" &&
        row.sample_set === "COMMON" &&
        row.holding_day === 5
    )!;
    expect(curve.sample_count).toBe(1);
    expect(curve.relative_day).toBe(10);

    const panel = await import(
      "../../../research-experiments/shared/firstBoardPullback/panel"
    );
    const loaded = await import(
      "../../../research-experiments/shared/firstBoardPullback/dataset"
    );
    const normalized = await loaded.loadNormalizedFoundationEvents(context);
    const built = panel.buildPanelRowsForEvent(
      normalized.events[0]!,
      "FIXED_T6_OPEN",
      DEFAULT_FOUNDATION_COST
    );
    const target = built.rows.find(row => row.exit_day === 10)!;
    expect(target.holding_day).toBe(5);
    expect(target.exit_reason).toBe("NEXT_SELLABLE_OPEN");
    expect(target.exit_day).toBe(10);
    expect(target.execution_delay_days).toBe(1);
    expect(target.gross_return).toBeCloseTo(10.3 / 10.5 - 1, 10);
  });

  it("uses the same commonSample event set for every holding day", async () => {
    const artifacts: ExperimentArtifactFileSpec[] = [];
    const context = contextWith(
      "v5",
      ["a", "b"],
      [
        ...fullPostFor("a"),
        ...fullPostFor("b", {
          20: { canSellAtClose: false },
        }),
      ],
      artifacts
    );
    const output = await buildFirstBoardPullbackFoundation(context);
    const commonRows = output.curveRows.filter(
      row =>
        row.entry_mode === "FIXED_T6_OPEN" &&
        row.sample_set === "COMMON" &&
        row.group_code === "ALL"
    );
    expect(new Set(commonRows.map(row => row.sample_count)).size).toBe(1);
    expect(commonRows[0]!.sample_count).toBe(1);
    const accounting = output.accounting.find(
      row => row.entry_mode === "FIXED_T6_OPEN"
    )!;
    expect(accounting.common_sample_event_count).toBe(1);
    expect(accounting.right_censored_event_count).toBe(1);
  });

  it("deducts commission, stamp duty, slippage and impact", async () => {
    const artifacts: ExperimentArtifactFileSpec[] = [];
    const context = contextWith(
      "v5",
      ["a"],
      fullPostFor("a", {
        10: { canSellAtClose: true, close: 10.2 },
      }),
      artifacts
    );
    const loaded = await import(
      "../../../research-experiments/shared/firstBoardPullback/dataset"
    );
    const panel = await import(
      "../../../research-experiments/shared/firstBoardPullback/panel"
    );
    const normalized = await loaded.loadNormalizedFoundationEvents(context);
    const row = panel
      .buildPanelRowsForEvent(
        normalized.events[0]!,
        "FIXED_T6_OPEN",
        DEFAULT_FOUNDATION_COST
      )
      .rows.find(item => item.exit_day === 10)!;
    const expected =
      sellAdjustedPrice(10.2, DEFAULT_FOUNDATION_COST) /
        buyAdjustedPrice(10.5, DEFAULT_FOUNDATION_COST) -
      1;
    expect(row.net_return).toBeCloseTo(expected, 10);
    expect(row.gross_return).toBeCloseTo(10.2 / 10.5 - 1, 10);
  });
});
