/** P9 · 事件事实 gate 纯函数测试。 */
import { describe, expect, it } from "vitest";
import { applyCompositeEventGate } from "../../../../server/research/compositeRunner/index";
import type { BuiltCompositeArm } from "../../../../server/research/compositeRunner/index";
import type { CandidateDayRecord, CandidateEvaluationRun } from "../../../../server/research/signalEngine/types";

function day(): CandidateDayRecord {
  const items = [["a1", 0.9], ["a2", 0.8], ["a3", 0.7]] as const;
  return {
    date: "2026-03-02",
    universeMembers: items.map(([id]) => id),
    signalCount: items.length,
    dropped: [],
    selected: items.map(([id, value], index) => ({ securityId: id, rank: index + 1, percentile: 1 - index / items.length, value })),
    positionIntents: items.map(([id, signalValue], index) => ({
      securityId: id, direction: "long" as const, rank: index + 1, percentile: 1 - index / items.length,
      weight: 1 / items.length, signalValue, confidence: null,
    })),
  };
}

function armOf(): BuiltCompositeArm {
  const days = [day()];
  const sourceRun = {
    recordKind: "CANDIDATE_EVALUATION_RUN", recordVersion: 1, datasetVersion: "test", builderVersion: "test",
    rowSchemaVersion: "test", datasetGate: "PASS", universeId: "test", strategyId: "test", strategyVersion: "1.0.0",
    parameters: {}, dateRange: { startDate: days[0]!.date, endDate: days[0]!.date }, point: "close",
    featureVersions: [], rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    selectionConfig: { method: { kind: "topN", n: 3 } }, days, fingerprint: "test",
    evaluation: {
      decisionDayCount: 1, dates: [days[0]!.date], totalSelectedSlots: 3, meanSelectedPerDay: 3,
      minSelectedPerDay: 3, maxSelectedPerDay: 3, distinctUniverseSecurities: [], distinctSelectedSecurities: [],
      universeCoveragePct: 0, selectionStats: [], alwaysSelectedSecurities: [],
      selectedDirectionCounts: { long: 3, short: 0, neutral: 0 }, meanSelectedValue: 0, minSelectedValue: 0, maxSelectedValue: 0,
    },
  } as unknown as CandidateEvaluationRun;
  return { id: "test", label: "test", kind: "bucket_t5", sourceRun, selectedSecurityIds: new Set(), signalTeBySecurity: new Map(), selectedCountByTe: {} };
}

describe("applyCompositeEventGate", () => {
  it("只过滤 intent，保留原始 rank / percentile，不补位", () => {
    const result = applyCompositeEventGate(armOf(), {
      version: "test-v1",
      label: "keep a1/a3",
      keepOf: (securityId) => securityId === "a1" || securityId === "a3",
    });
    const day = result.sourceRun.days[0]!;
    expect(day.positionIntents.map((intent) => [intent.securityId, intent.rank])).toEqual([["a1", 1], ["a3", 3]]);
    expect(day.selected.map((candidate) => [candidate.securityId, candidate.rank])).toEqual([["a1", 1], ["a3", 3]]);
    expect(result.eventGateAccounting).toEqual({
      inputIntents: 3,
      keptIntents: 2,
      removedIntents: 1,
      daysWithRemoval: 1,
    });
  });

  it("全部过滤掉时 days 仍保留且 selected/intents 为空", () => {
    const result = applyCompositeEventGate(armOf(), {
      version: "test-v1",
      label: "remove all",
      keepOf: () => false,
    });
    expect(result.sourceRun.days).toHaveLength(1);
    expect(result.sourceRun.days[0]!.selected).toEqual([]);
    expect(result.sourceRun.days[0]!.positionIntents).toEqual([]);
    expect(result.eventGateAccounting?.removedIntents).toBe(3);
  });
});
