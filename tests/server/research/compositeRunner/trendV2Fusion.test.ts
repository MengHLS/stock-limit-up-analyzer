/**
 * P1 · compositeRunner 的趋势 v2 分位融合测试。
 *
 * 夹具四候选：a=高3F弱趋势、d=低3F强趋势（v1 口径）。v2 口径方向相反，
 * 因此「v2 融合的选中顺序」必须与「v1 融合的选中顺序」不同，且账目如实。
 */
import { describe, expect, it } from "vitest";
import {
  buildCompositeEvents,
  buildCompositeSourceRun,
  COMPOSITE_RUNNER_MAX_AMPLITUDE,
} from "../../../../server/research/compositeRunner/index";
import {
  EVENT_DAY,
  LAST_TRADING_DAY,
  buildTrendFusionDataset,
  rankedSelectedKeysOf,
} from "./trendFusionFixture";

function armInput(dataset: ReturnType<typeof buildTrendFusionDataset>) {
  const built = buildCompositeEvents(dataset, COMPOSITE_RUNNER_MAX_AMPLITUDE);
  return {
    armId: "test-v2-arm",
    label: "test v2 arm",
    kind: "bucket_t5" as const,
    dataset,
    tradingDays: built.tradingDays,
    bucketCandidatesByDate: built.bucketCandidatesByDate,
    rankCandidatesByTe: built.rankCandidatesByTe,
    topN: 3,
    maxAmplitude: COMPOSITE_RUNNER_MAX_AMPLITUDE,
    dateRange: { startDate: EVENT_DAY, endDate: LAST_TRADING_DAY },
  };
}

describe("compositeRunner · 趋势 v2 分位融合", () => {
  it("candidateScoreV2 缺省 / null => 既有纯 3F 结果逐字段不变", () => {
    const dataset = buildTrendFusionDataset();
    const omitted = buildCompositeSourceRun(armInput(dataset));
    const explicitNull = buildCompositeSourceRun({ ...armInput(dataset), candidateScoreV2: null });
    expect(explicitNull.sourceRun).toEqual(omitted.sourceRun);
    expect(omitted.v2FusionAccounting).toBeUndefined();
    expect(explicitNull.v2FusionAccounting).toBeUndefined();
  });

  it("v2 融合改写排序，且方向与 v1 融合不同", () => {
    const dataset = buildTrendFusionDataset();
    const v1Arm = buildCompositeSourceRun({ ...armInput(dataset), rankFusion: { trendWeight: 0.5 } });
    const v2Arm = buildCompositeSourceRun({ ...armInput(dataset), candidateScoreV2: { v2Weight: 0.5 } });
    expect(rankedSelectedKeysOf(v2Arm.sourceRun.days)).not.toEqual(
      rankedSelectedKeysOf(v1Arm.sourceRun.days),
    );
    expect(v2Arm.v2FusionAccounting).toEqual({
      scoredCandidateCount: 4,
      droppedMissingComponents: 0,
    });
  });

  it("v2 与 v1 融合互斥（同时给 => 抛错）", () => {
    const dataset = buildTrendFusionDataset();
    expect(() => buildCompositeSourceRun({
      ...armInput(dataset),
      rankFusion: { trendWeight: 0.5 },
      candidateScoreV2: { v2Weight: 0.5 },
    })).toThrow(/互斥/);
  });

  it("PIT：改动 rd >= 6 的收盘价不改变 v2 融合结果", () => {
    const base = buildCompositeSourceRun({ ...armInput(buildTrendFusionDataset(1)), candidateScoreV2: { v2Weight: 0.35 } });
    const mutated = buildCompositeSourceRun({ ...armInput(buildTrendFusionDataset(7)), candidateScoreV2: { v2Weight: 0.35 } });
    expect(mutated.sourceRun.days).toEqual(base.sourceRun.days);
    expect(mutated.v2FusionAccounting).toEqual(base.v2FusionAccounting);
  });
});