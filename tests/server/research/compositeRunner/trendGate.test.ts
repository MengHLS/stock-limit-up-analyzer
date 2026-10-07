/**
 * P0-2 · compositeRunner 的**趋势分门槛**测试（只筛不改排序）。
 *
 * 夹具四候选的 trendScore（已实测）：a=1/6、b=1/3、c=5/6、d=1。
 *
 * 钉住：
 *   1. candidateGate 缺省 / null => 既有行为逐字段不变；
 *   2. 门槛只减少候选池，存活候选的排序仍完全由纯 3F 决定；
 *   3. 账目（评估数 / 剔除数）与实际逐日剔除一致；
 *   4. 门槛抬到只留少数候选时，成交机会如实减少（signalCount 变小）；
 *   5. PIT：改动 rd >= 6 的行不改变门槛结果。
 */
import { describe, expect, it } from "vitest";
import {
  buildCompositeEvents,
  buildCompositeSourceRun,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
} from "../../../../server/research/compositeRunner/index";
import {
  DECISION_DAY,
  EVENT_DAY,
  LAST_TRADING_DAY,
  TREND_FUSION_CANDIDATES,
  buildTrendFusionArm,
  buildTrendFusionDataset,
  rankedSelectedKeysOf,
} from "./trendFusionFixture";

const ONE_SIXTH = 1 / 6;
const ONE_THIRD = 1 / 3;
const ONE = 1;

function buildGatedArm(minTrendScore: number | null, tailMultiplier = 1) {
  const dataset = buildTrendFusionDataset(tailMultiplier);
  const built = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
  return buildCompositeSourceRun({
    armId: "test-gate-arm",
    label: "test gate arm",
    kind: "bucket_t5",
    dataset,
    tradingDays: built.tradingDays,
    bucketCandidatesByDate: built.bucketCandidatesByDate,
    rankCandidatesByTe: built.rankCandidatesByTe,
    topN: 3,
    maxAmplitude: COMPOSITE_RUNNER_MAX_AMPLITUDE,
    dateRange: { startDate: EVENT_DAY, endDate: LAST_TRADING_DAY },
    candidateGate: minTrendScore === null ? null : { minTrendScore },
  });
}

describe("compositeRunner · 趋势分门槛", () => {
  it("candidateGate 缺省与 null => 与既有纯 3F 结果逐字段相同", () => {
    const omitted = buildTrendFusionArm(buildTrendFusionDataset(), null);
    const explicitNull = buildGatedArm(null);
    // 只比逐日选股记录：armId / label 不同会进 strategyId / signalDescription，
    // 那与「门槛」无关，不能算差异。
    expect(explicitNull.sourceRun.days).toEqual(omitted.sourceRun.days);
    expect(explicitNull.sourceRun.parameters).not.toHaveProperty("minTrendScore");
    expect(omitted.gateAccounting).toBeUndefined();
    expect(explicitNull.gateAccounting).toBeUndefined();
  });

  it("门槛 1/6 => 全部候选都 >= 1/6，什么都不剔除", () => {
    const gated = buildGatedArm(ONE_SIXTH);
    expect(gated.gateAccounting).toEqual({
      evaluatedCandidateCount: TREND_FUSION_CANDIDATES.length,
      excludedByTrendGate: 0,
    });
    expect(rankedSelectedKeysOf(gated.sourceRun.days)).toEqual([
      "sec-a-high3f",
      "sec-b-4th",
      "sec-c-mid",
    ]);
  });

  it("门槛只筛不改排序：门槛 1/3 剔除 a 后，存活候选仍按纯 3F 顺序取 TopN", () => {
    const gated = buildGatedArm(ONE_THIRD);
    expect(gated.gateAccounting).toEqual({
      evaluatedCandidateCount: TREND_FUSION_CANDIDATES.length,
      excludedByTrendGate: 1,
    });
    expect(rankedSelectedKeysOf(gated.sourceRun.days)).toEqual([
      "sec-b-4th",
      "sec-c-mid",
      "sec-d-low3f",
    ]);
    const day = gated.sourceRun.days.find((record) => record.date === DECISION_DAY)!;
    const values = [...day.selected]
      .sort((left, right) => left.rank - right.rank)
      .map((item) => item.value);
    // 排序值仍是纯 3F（降序），没有被任何趋势分改写。
    expect(values).toEqual([...values].sort((left, right) => right - left));
  });

  it("门槛抬到 1 => 只剩 trendScore=1 的候选，成交机会如实减少", () => {
    const gated = buildGatedArm(ONE);
    expect(gated.gateAccounting).toEqual({
      evaluatedCandidateCount: TREND_FUSION_CANDIDATES.length,
      excludedByTrendGate: 3,
    });
    const day = gated.sourceRun.days.find((record) => record.date === DECISION_DAY)!;
    expect(day.signalCount).toBe(1);
    expect(day.selected.map((item) => item.securityId.split("::event:")[0])).toEqual([
      "sec-d-low3f",
    ]);
  });

  it("PIT：改动 rd >= 6 的收盘价不改变门槛结果", () => {
    const base = buildGatedArm(ONE_THIRD, 1);
    const mutated = buildGatedArm(ONE_THIRD, 7);
    expect(mutated.sourceRun.days).toEqual(base.sourceRun.days);
    expect(mutated.gateAccounting).toEqual(base.gateAccounting);
  });
});