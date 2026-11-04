/** P6 · compositeRunner 跨日候选池纯函数测试。 */
import { describe, expect, it } from "vitest";
import {
  applyCompositeCarryover,
} from "../../../../server/research/compositeRunner/index";
import type { BuiltCompositeArm } from "../../../../server/research/compositeRunner/index";
import type {
  CandidateDayRecord,
  CandidateEvaluationRun,
} from "../../../../server/research/signalEngine/types";

function day(
  date: string,
  items: readonly [string, number][],
): CandidateDayRecord {
  return {
    date,
    universeMembers: items.map(([securityId]) => securityId),
    signalCount: items.length,
    dropped: [],
    selected: items.map(([securityId, value], index) => ({
      securityId,
      rank: index + 1,
      percentile: 1 - index / items.length,
      value,
    })),
    positionIntents: items.map(([securityId, signalValue], index) => ({
      securityId,
      direction: "long" as const,
      rank: index + 1,
      percentile: 1 - index / items.length,
      weight: 1 / items.length,
      signalValue,
      confidence: null,
    })),
  };
}

function armOf(days: readonly CandidateDayRecord[], topN = 5): BuiltCompositeArm {
  const sourceRun = {
    recordKind: "CANDIDATE_EVALUATION_RUN",
    recordVersion: 1,
    datasetVersion: "test-dataset",
    builderVersion: "test-builder",
    rowSchemaVersion: "test-row",
    datasetGate: "PASS",
    universeId: "test-universe",
    strategyId: "test-strategy",
    strategyVersion: "1.0.0",
    parameters: {},
    dateRange: { startDate: days[0]!.date, endDate: days[days.length - 1]!.date },
    point: "close",
    featureVersions: [],
    rankingConfig: { higherIsBetter: true, tieBreaking: "average", missingPolicy: "exclude" },
    selectionConfig: { method: { kind: "topN", n: topN } },
    days,
    evaluation: {
      decisionDayCount: days.length,
      dates: days.map((item) => item.date),
      totalSelectedSlots: days.reduce((sum, item) => sum + item.selected.length, 0),
      meanSelectedPerDay: 0,
      minSelectedPerDay: 0,
      maxSelectedPerDay: 0,
      distinctUniverseSecurities: [],
      distinctSelectedSecurities: [],
      universeCoveragePct: 0,
      selectionStats: [],
      alwaysSelectedSecurities: [],
      selectedDirectionCounts: { long: 0, short: 0, neutral: 0 },
      meanSelectedValue: 0,
      minSelectedValue: 0,
      maxSelectedValue: 0,
    },
    fingerprint: "test-fingerprint",
  } as unknown as CandidateEvaluationRun;
  return {
    id: "test-arm",
    label: "test-arm",
    kind: "bucket_t5",
    sourceRun,
    selectedSecurityIds: new Set(),
    signalTeBySecurity: new Map(),
    selectedCountByTe: {},
  };
}

describe("P6 · applyCompositeCarryover", () => {
  it("carry1/margin0：上一日 rank3 可在下一日插入并进入买入前 2 名", () => {
    const base = armOf([
      day("2026-03-02", [["a1", 0.9], ["a2", 0.8], ["a3", 0.7], ["a4", 0.6], ["a5", 0.5]]),
      day("2026-03-03", [["b1", 0.65], ["b2", 0.64], ["b3", 0.63], ["b4", 0.62], ["b5", 0.61]]),
    ]);
    const carried = applyCompositeCarryover(base, {
      maxAgeDays: 1,
      replacementScoreMargin: 0,
      attemptedPerDay: 2,
    });
    const second = carried.sourceRun.days[1]!;
    expect(second.selected.map((item) => item.securityId)).toEqual([
      "a3", "b1", "b2", "b3", "b4",
    ]);
    expect(carried.carryAccounting).toEqual({
      queuedCandidates: 6,
      consideredCarryCandidates: 3,
      selectedCarryCandidates: 1,
      attemptedCarryCandidates: 1,
      expiredCarryCandidates: 3,
      refreshUnscorableCarryCandidates: 0,
    });
  });

  it("margin 门槛：差一分不够时 pending 留在 fresh 之后，不进入买入前 2 名", () => {
    const base = armOf([
      day("2026-03-02", [["a1", 0.9], ["a2", 0.8], ["a3", 0.71], ["a4", 0.6], ["a5", 0.5]]),
      day("2026-03-03", [["b1", 0.70], ["b2", 0.69], ["b3", 0.68], ["b4", 0.67], ["b5", 0.66]]),
    ]);
    const carried = applyCompositeCarryover(base, {
      maxAgeDays: 1,
      replacementScoreMargin: 0.03,
      attemptedPerDay: 2,
    });
    expect(carried.sourceRun.days[1]!.selected.map((item) => item.securityId)).toEqual([
      "b1", "b2", "b3", "a3", "b4",
    ]);
    expect(carried.carryAccounting?.attemptedCarryCandidates).toBe(0);
  });

  it("P7 refresh：同一决策日统一重评分后，carry 可以凭当日状态分进入前 2 名", () => {
    const base = armOf([
      day("2026-03-02", [["a1", 0.9], ["a2", 0.8], ["a3", 0.7], ["a4", 0.6], ["a5", 0.5]]),
      day("2026-03-03", [["b1", 0.65], ["b2", 0.64], ["b3", 0.63], ["b4", 0.62], ["b5", 0.61]]),
    ]);
    const carried = applyCompositeCarryover(base, {
      maxAgeDays: 1,
      replacementScoreMargin: 0,
      attemptedPerDay: 2,
      refresh: {
        version: "carry-refresh-v1.0.0",
        weight: 1,
        componentsOf: (securityId) => securityId === "a3"
          ? { pullbackDepth: 1, negMomentum: 1, negWindowGap: 1 }
          : securityId.startsWith("b")
            ? { pullbackDepth: 0.75, negMomentum: 0.75, negWindowGap: 0.75 }
            : { pullbackDepth: 0, negMomentum: 0, negWindowGap: 0 },
      },
    });
    expect(carried.sourceRun.parameters.carryRefreshVersion).toBe("carry-refresh-v1.0.0");
    expect(carried.sourceRun.parameters.carryRefreshWeight).toBe(1);
    expect(carried.sourceRun.days[1]!.selected.map((item) => item.securityId)).toEqual([
      "a3", "b1", "b2", "b3", "b4",
    ]);
    expect(carried.carryAccounting?.attemptedCarryCandidates).toBe(1);
  });

  it("P7 refresh-only：maxAgeDays=0 时不产生 pending，只重排 fresh", () => {
    const base = armOf([
      day("2026-03-02", [["a1", 0.9], ["a2", 0.8], ["a3", 0.7], ["a4", 0.6], ["a5", 0.5]]),
      day("2026-03-03", [["b1", 0.9], ["b2", 0.8], ["b3", 0.7], ["b4", 0.6], ["b5", 0.5]]),
    ]);
    const carried = applyCompositeCarryover(base, {
      maxAgeDays: 0,
      replacementScoreMargin: 0,
      attemptedPerDay: 2,
      refresh: {
        version: "carry-refresh-v1.0.0",
        weight: 1,
        componentsOf: (securityId) => securityId === "b5"
          ? { pullbackDepth: 1, negMomentum: 1, negWindowGap: 1 }
          : { pullbackDepth: 0, negMomentum: 0, negWindowGap: 0 },
      },
    });
    expect(carried.carryAccounting).toEqual({
      queuedCandidates: 0,
      consideredCarryCandidates: 0,
      selectedCarryCandidates: 0,
      attemptedCarryCandidates: 0,
      expiredCarryCandidates: 0,
      refreshUnscorableCarryCandidates: 0,
    });
    expect(carried.sourceRun.days[1]!.selected[0]!.securityId).toBe("b5");
  });

  it("carry2：未选中的 pending 可多留一个决策日，之后如实过期", () => {
    const base = armOf([
      day("2026-03-02", [["a1", 0.9], ["a2", 0.8], ["a3", 0.7], ["a4", 0.6], ["a5", 0.5]]),
      day("2026-03-03", [["b1", 0.95], ["b2", 0.94], ["b3", 0.93], ["b4", 0.92], ["b5", 0.91]]),
      day("2026-03-04", [["c1", 0.99], ["c2", 0.98], ["c3", 0.97], ["c4", 0.96], ["c5", 0.95]]),
    ]);
    const carried = applyCompositeCarryover(base, {
      maxAgeDays: 2,
      replacementScoreMargin: 0,
      attemptedPerDay: 2,
    });
    // a3-a5 在 03-03 不敌 b*，但仍参与 03-04；到 03-04 后超龄淘汰。
    expect(carried.sourceRun.days[2]!.selected.every((item) => item.securityId.startsWith("c"))).toBe(true);
    expect(carried.carryAccounting?.consideredCarryCandidates).toBe(9);
    expect(carried.carryAccounting?.expiredCarryCandidates).toBe(3);
  });
});
