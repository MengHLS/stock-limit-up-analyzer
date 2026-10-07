/** P8 · applyCompositeLateEntry 纯函数测试。 */
import { describe, expect, it } from "vitest";
import { applyCompositeLateEntry } from "../../../../server/research/compositeRunner/index";
import type { BuiltCompositeArm } from "../../../../server/research/compositeRunner/index";
import type { CandidateDayRecord, CandidateEvaluationRun } from "../../../../server/research/signalEngine/types";

function day(): CandidateDayRecord {
  const items = [["a1", 0.9], ["a2", 0.8], ["a3", 0.7], ["a4", 0.6], ["a5", 0.5]] as const;
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
    selectionConfig: { method: { kind: "topN", n: 5 } }, days, fingerprint: "test",
    evaluation: {
      decisionDayCount: 1, dates: [days[0]!.date], totalSelectedSlots: 5, meanSelectedPerDay: 5,
      minSelectedPerDay: 5, maxSelectedPerDay: 5, distinctUniverseSecurities: [], distinctSelectedSecurities: [],
      universeCoveragePct: 0, selectionStats: [], alwaysSelectedSecurities: [],
      selectedDirectionCounts: { long: 5, short: 0, neutral: 0 }, meanSelectedValue: 0, minSelectedValue: 0, maxSelectedValue: 0,
    },
  } as unknown as CandidateEvaluationRun;
  return { id: "test", label: "test", kind: "bucket_t5", sourceRun, selectedSecurityIds: new Set(), signalTeBySecurity: new Map(), selectedCountByTe: {} };
}

describe("applyCompositeLateEntry", () => {
  it("delay：只移动日期，保持原 top3 排名", () => {
    const result = applyCompositeLateEntry(armOf(), {
      mode: "delay", decisionRelativeDay: 7, sourceTopN: 3, outputTopN: 3,
      targetAvailableOf: () => true,
    }, () => "2026-03-10");
    expect(result.sourceRun.days[0]!.date).toBe("2026-03-10");
    expect(result.sourceRun.days[0]!.selected.map((item) => item.securityId)).toEqual(["a1", "a2", "a3"]);
    expect(result.lateEntryAccounting?.droppedUnavailableTarget).toBe(0);
  });

  it("rescore：在原 top5 内按晚窗口分数重排，a5/a4 可进入前 3", () => {
    const scores: Record<string, number> = { a1: 0.5, a2: 0.4, a3: 0.3, a4: 0.8, a5: 0.9 };
    const result = applyCompositeLateEntry(armOf(), {
      mode: "rescore", decisionRelativeDay: 7, sourceTopN: 5, outputTopN: 3,
      scoreOf: (securityId) => ({ score: scores[securityId]!, maxAmplitude: 0, meanAmplitude: 0, volumeRatio: 0 }),
    }, () => "2026-03-10");
    expect(result.sourceRun.days[0]!.selected.map((item) => item.securityId)).toEqual(["a5", "a4", "a1"]);
    expect(result.lateEntryAccounting?.droppedUnscorable).toBe(0);
  });

  it("目标日停牌 / 晚窗口不可评分时如实计数并丢弃", () => {
    const result = applyCompositeLateEntry(armOf(), {
      mode: "rescore", decisionRelativeDay: 7, sourceTopN: 5, outputTopN: 3,
      scoreOf: (securityId) => securityId === "a2" ? null : { score: 0.5, maxAmplitude: 0, meanAmplitude: 0, volumeRatio: 0 },
    }, () => "2026-03-10");
    expect(result.lateEntryAccounting?.droppedUnscorable).toBe(1);
    expect(result.lateEntryAccounting?.shiftedCandidates).toBe(4);
  });
});
