/**
 * P0 · `compositeRunner` 的**趋势排序融合**测试。
 *
 * 钉住四件事（这是 P0 里唯一被改动的共享执行模块）：
 *   1. `rankFusion` 缺省 / `null` ⇒ 逐字段沿用既有纯 3F 排序（既有实验零变化）；
 *   2. 融合臂确实按 `(1-w)·3F + w·trendScore` 重排（夹具构造成「3F 第一名被挤掉」）；
 *   3. 融合只改**排序**，不改候选资格 / topN / 其它记录字段；
 *   4. **PIT**：改动 `rd >= 6` 的行（决策日之后）不得影响任何选中结果。
 */
import { describe, expect, it } from "vitest";
import {
  DECISION_DAY,
  TRADING_DAYS,
  TREND_FUSION_CANDIDATES,
  buildTrendFusionArm,
  buildTrendFusionDataset,
  rankedSelectedKeysOf,
  selectedKeysOf,
} from "./trendFusionFixture";
import {
  computeThreeFactorRaw,
  threeFactorCompositeScoreOf,
} from "../../../../server/research/recipeFeatures/threeFactorScoreFeatures";
import { computeTrendScore } from "../../../../server/research/recipeFeatures/trendScoreFeatures";

describe("compositeRunner · 趋势排序融合", () => {
  it("rankFusion 缺省与 null ⇒ 与既有纯 3F 排序逐字段相同", () => {
    const dataset = buildTrendFusionDataset();
    const omitted = buildTrendFusionArm(dataset, undefined);
    const explicitNull = buildTrendFusionArm(dataset, null);
    expect(explicitNull.sourceRun).toEqual(omitted.sourceRun);
    expect(omitted.fusionAccounting).toBeUndefined();
    expect(explicitNull.fusionAccounting).toBeUndefined();
  });

  it("纯 3F 的 Top3 按合成分排序（3F 第一名入选）", () => {
    const control = buildTrendFusionArm(buildTrendFusionDataset(), null);
    expect(rankedSelectedKeysOf(control.sourceRun.days)).toEqual([
      "sec-a-high3f",
      "sec-b-4th",
      "sec-c-mid",
    ]);
  });

  it("融合 50% 趋势 ⇒ 排序被改写（3F 最低但趋势最强的候选升到第一）", () => {
    const fused = buildTrendFusionArm(buildTrendFusionDataset(), { trendWeight: 0.5 });
    expect(rankedSelectedKeysOf(fused.sourceRun.days)).toEqual([
      "sec-d-low3f",
      "sec-c-mid",
      "sec-b-4th",
    ]);
    // 集合也变了：纯 3F 的第一名（sec-a-high3f）被挤出 Top3。
    expect(selectedKeysOf(fused.sourceRun.days)).toEqual([
      "sec-b-4th",
      "sec-c-mid",
      "sec-d-low3f",
    ]);
  });

  it("融合臂的排序值 = (1-w)·3F + w·trendScore（逐候选核对）", () => {
    const arm = buildTrendFusionArm(buildTrendFusionDataset(), { trendWeight: 0.5 });
    const day = arm.sourceRun.days.find((record) => record.date === DECISION_DAY)!;
    for (const selected of day.selected) {
      const key = selected.securityId.split("::event:")[0]!;
      const spec = TREND_FUSION_CANDIDATES.find((candidate) => candidate.key === key)!;
      const bars = spec.closes.map((close, index) => {
        const volume = index === 1 ? 1_000_000 * spec.t1VolumeRatio : 1_000_000;
        const half = close * 0.005;
        return {
          symbol: "000001.SZ",
          timestamp: TRADING_DAYS[index]!,
          open: close,
          high: close + half,
          low: close - half,
          close,
          preClose: close,
          volume,
          amount: close * volume,
          turnoverRate: null,
          adjustment: "raw" as const,
        };
      });
      const raw = computeThreeFactorRaw(bars)!;
      const threeFactor = threeFactorCompositeScoreOf(raw, { requirePullback: true })!;
      const trend = computeTrendScore(bars)!;
      expect(selected.value).toBeCloseTo(0.5 * threeFactor + 0.5 * trend, 12);
    }
  });

  it("融合不改候选资格与账目（候选数不变、无趋势分缺失）", () => {
    const dataset = buildTrendFusionDataset();
    const control = buildTrendFusionArm(dataset, null);
    const fused = buildTrendFusionArm(dataset, { trendWeight: 0.5 });
    const controlDay = control.sourceRun.days.find((record) => record.date === DECISION_DAY)!;
    const fusedDay = fused.sourceRun.days.find((record) => record.date === DECISION_DAY)!;
    expect(fusedDay.signalCount).toBe(controlDay.signalCount);
    expect(fusedDay.universeMembers).toEqual(controlDay.universeMembers);
    expect(fused.fusionAccounting).toEqual({
      scoredCandidateCount: TREND_FUSION_CANDIDATES.length,
      droppedMissingTrendScore: 0,
    });
  });

  it("PIT：改动 rd >= 6 的收盘价不改变任何选中结果", () => {
    const base = buildTrendFusionArm(buildTrendFusionDataset(1), { trendWeight: 0.5 });
    const mutated = buildTrendFusionArm(buildTrendFusionDataset(7), { trendWeight: 0.5 });
    expect(mutated.sourceRun.days).toEqual(base.sourceRun.days);
    expect(rankedSelectedKeysOf(mutated.sourceRun.days)).toEqual(
      rankedSelectedKeysOf(base.sourceRun.days),
    );
  });
});