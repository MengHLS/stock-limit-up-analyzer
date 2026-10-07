/**
 * P0 · 趋势评分（`trendScoreFeatures`）纯函数测试。
 *
 * 钉住三件事：
 *   1. 三个分项的**边界取值**（含边界点本身）与 `trendScore` 的等权合成；
 *   2. **PIT 防线**：入参多于决策窗长度（= 调用方没在决策日截断）必须**响亮抛错**，
 *      不得静默 slice 掉多余 bar（那等于偷读未来数据）；
 *   3. 融合值的权重语义与越界拒绝。
 */
import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import {
  DEFAULT_TREND_SCORE_THRESHOLDS,
  TREND_DECISION_WINDOW_BARS,
  computeTrendMomentumScore,
  computeTrendPullbackScore,
  computeTrendScore,
  computeTrendScoreComponents,
  computeTrendStructureScore,
  fuseTrendIntoThreeFactorScore,
} from "../../../../server/research/recipeFeatures/trendScoreFeatures";

function bar(close: number, open = close): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp: "2026-01-01",
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    preClose: close,
    volume: 1_000_000,
    amount: close * 1_000_000,
    turnoverRate: null,
    adjustment: "raw",
  };
}

/** 决策窗 = 6 根（rd 0..5），`bars[0]` = 首板日。 */
function window(closes: readonly number[]): CanonicalMarketBar[] {
  return closes.map((close) => bar(close));
}

const FLAT_THEN_RISE = [10, 10, 10, 10.2, 10.4, 10.6];
const FLAT_THEN_FALL = [10, 10, 10, 9.8, 9.6, 9.4];

describe("趋势评分 · 结构分", () => {
  it("收盘站上窗内均值 + 均线抬升 ⇒ 1", () => {
    expect(computeTrendStructureScore(window(FLAT_THEN_RISE))).toBe(1);
  });

  it("收盘跌破窗内均值 / 均线走低 ⇒ 0", () => {
    expect(computeTrendStructureScore(window(FLAT_THEN_FALL))).toBe(0);
    // 冲高回落：收盘回到窗内均值之下（10 < 65.5/6）⇒ 结构不成立
    expect(computeTrendStructureScore(window([10, 12, 12, 11, 10.5, 10]))).toBe(0);
    // 收盘仍在窗内均值之上、但短均线已经走低（最近 3 根均值 < 最早 3 根均值）⇒ 结构不成立
    expect(computeTrendStructureScore(window([12, 12, 12, 10, 10, 11.5]))).toBe(0);
  });

  it("bar 不足决策窗 ⇒ null（不把数据不足伪装成结构不成立）", () => {
    expect(computeTrendStructureScore(window([10, 10, 10, 10, 10]))).toBeNull();
  });

  it("任一根收盘缺失 ⇒ null（不跳过缺失 bar）", () => {
    const bars = window(FLAT_THEN_RISE);
    const broken = bars.map((item, index) => (index === 2 ? { ...item, close: null } : item));
    expect(computeTrendStructureScore(broken)).toBeNull();
  });
});

describe("趋势评分 · 动量分", () => {
  it("低于首板日收盘 ⇒ 0", () => {
    expect(computeTrendMomentumScore(window([10, 10, 10, 9.9, 9.8, 9.7]))).toBe(0);
  });

  it("0 <= 动量 < 3% ⇒ 0.5（含 0，不含 3%）", () => {
    expect(computeTrendMomentumScore(window([10, 10, 10, 10, 10, 10]))).toBe(0.5);
    expect(computeTrendMomentumScore(window([10, 10, 10, 10, 10, 10.299]))).toBe(0.5);
  });

  it("动量 >= 3% ⇒ 1（含边界 3%）", () => {
    expect(computeTrendMomentumScore(window([10, 10, 10, 10, 10, 10.3]))).toBe(1);
    expect(computeTrendMomentumScore(window([10, 10, 10, 10, 10, 11]))).toBe(1);
  });

  it("bar 不足决策窗 ⇒ null", () => {
    expect(computeTrendMomentumScore(window([10, 10, 10]))).toBeNull();
  });
});

describe("趋势评分 · 回踩分", () => {
  // 峰值刻意用 100：`(100-97)/100` 与阈值字面量 `0.03` 是同一个双精度数，
  // 边界用例才不会被浮点表示差异（如 `(10-9.7)/10`）误判。
  it("恰好贴紧新高（回撤 0）⇒ 1", () => {
    expect(computeTrendPullbackScore(window([100, 100, 100, 110, 120, 120]))).toBe(1);
  });

  it("回撤 <= 3% ⇒ 1（含边界 3%）", () => {
    expect(computeTrendPullbackScore(window([100, 100, 100, 100, 100, 97]))).toBe(1);
  });

  it("3% < 回撤 <= 8% ⇒ 0.5（含边界 8%）", () => {
    expect(computeTrendPullbackScore(window([100, 100, 100, 100, 100, 96.9]))).toBe(0.5);
    expect(computeTrendPullbackScore(window([100, 100, 100, 100, 100, 92]))).toBe(0.5);
  });

  it("回撤 > 8% ⇒ 0", () => {
    expect(computeTrendPullbackScore(window([100, 100, 100, 100, 100, 91.9]))).toBe(0);
  });

  it("峰值取事件窗内最高收盘（不是首板日收盘）", () => {
    expect(computeTrendPullbackScore(window([100, 110, 120, 120, 120, 114]))).toBe(0.5);
  });

  it("bar 不足决策窗 ⇒ null", () => {
    expect(computeTrendPullbackScore(window([100, 100]))).toBeNull();
  });
});

describe("趋势评分 · 合成分与融合", () => {
  it("trendScore = 三个分项等权平均（累加顺序 结构→动量→回踩）", () => {
    const bars = window([10, 10, 10, 10.2, 10.4, 10.3]);
    const components = computeTrendScoreComponents(bars);
    expect(components).not.toBeNull();
    expect(components!.structureScore).toBe(1);
    expect(components!.momentumScore).toBe(1);
    expect(components!.pullbackScore).toBe(1);
    expect(computeTrendScore(bars)).toBeCloseTo(1, 12);
    expect(computeTrendScore(bars)).toBeCloseTo(
      (components!.structureScore + components!.momentumScore + components!.pullbackScore) / 3,
      12,
    );
  });

  it("任一分项不可算 ⇒ trendScore 为 null", () => {
    expect(computeTrendScore(window([10, 10, 10, 10, 10]))).toBeNull();
  });

  it("默认阈值是可冻结的常量（改动必须 bump 定义）", () => {
    expect(DEFAULT_TREND_SCORE_THRESHOLDS).toEqual({
      momentumWeakBelow: 0,
      momentumStrongAtOrAbove: 0.03,
      pullbackShallowAtOrBelow: 0.03,
      pullbackDeepAbove: 0.08,
    });
  });

  it("融合：(1-w)·3F + w·trend", () => {
    expect(fuseTrendIntoThreeFactorScore(0.8, 0.5, 0.2)).toBeCloseTo(0.74, 12);
    expect(fuseTrendIntoThreeFactorScore(0.8, 0.5, 0)).toBeCloseTo(0.8, 12);
    expect(fuseTrendIntoThreeFactorScore(0.8, 0.5, 1)).toBeCloseTo(0.5, 12);
  });

  it("融合权重越界 / 非有限 ⇒ 抛错（不静默夹取）", () => {
    expect(() => fuseTrendIntoThreeFactorScore(0.5, 0.5, 1.2)).toThrow(/trendWeight/);
    expect(() => fuseTrendIntoThreeFactorScore(0.5, 0.5, -0.1)).toThrow(/trendWeight/);
    expect(() => fuseTrendIntoThreeFactorScore(Number.NaN, 0.5, 0.2)).toThrow(/3F/);
    expect(() => fuseTrendIntoThreeFactorScore(0.5, Number.NaN, 0.2)).toThrow(/趋势评分/);
  });
});

describe("趋势评分 · PIT 防线", () => {
  it("入参多于决策窗（未按决策日截断）⇒ 响亮抛错，不静默读未来数据", () => {
    const tooLong = window([...FLAT_THEN_RISE, 99, 99]);
    expect(tooLong.length).toBeGreaterThan(TREND_DECISION_WINDOW_BARS);
    expect(() => computeTrendScore(tooLong)).toThrow(/决策日截断/);
    expect(() => computeTrendStructureScore(tooLong)).toThrow(/决策日截断/);
    expect(() => computeTrendMomentumScore(tooLong)).toThrow(/决策日截断/);
    expect(() => computeTrendPullbackScore(tooLong)).toThrow(/决策日截断/);
  });
});