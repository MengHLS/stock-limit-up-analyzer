/**
 * P1 · 趋势评分 v2（符号修正版）纯计算测试。
 *
 * 钉住：三分量的方向（回撤深度为正、动量/结构偏离取负）、PIT 形状防线、缺数据不插补。
 */
import { describe, expect, it } from "vitest";
import type { CanonicalMarketBar } from "../../../../server/data";
import {
  TREND_V2_COMPONENT_IDS,
  computeTrendV2Components,
  computeTrendV2MeanComponent,
  fuseTrendV2IntoThreeFactorScore,
} from "../../../../server/research/recipeFeatures/trendScoreV2Features";

function bar(close: number): CanonicalMarketBar {
  return {
    symbol: "600001.SH",
    timestamp: "2026-01-01",
    open: close,
    high: close,
    low: close,
    close,
    preClose: close,
    volume: 1_000_000,
    amount: close * 1_000_000,
    turnoverRate: null,
    adjustment: "raw",
  };
}

function window(closes: readonly number[]): CanonicalMarketBar[] {
  return closes.map((close) => bar(close));
}

describe("趋势评分 v2 · 分量方向", () => {
  it("深回撤 + 负动量 + 跌破窗内均值 => 三项都为正", () => {
    const components = computeTrendV2Components(window([10, 9.6, 9.4, 9.2, 9.0, 8.8]))!;
    expect(components.pullbackDepth).toBeCloseTo(0.12, 10);
    expect(components.negMomentum).toBeCloseTo(0.12, 10);
    expect(components.negWindowGap).toBeGreaterThan(0);
  });

  it("创新高 + 正动量 + 站上窗内均值 => 三项都不利于策略", () => {
    const components = computeTrendV2Components(window([10, 10.2, 10.4, 10.6, 10.8, 11]))!;
    expect(components.pullbackDepth).toBe(0);
    expect(components.negMomentum).toBeLessThan(0);
    expect(components.negWindowGap).toBeLessThan(0);
  });

  it("回撤深度以「事件以来最高收盘」为基准", () => {
    const components = computeTrendV2Components(window([10, 11, 11.5, 12, 11.8, 11.4]))!;
    expect(components.pullbackDepth).toBeCloseTo(0.05, 10);
  });

  it("bar 不足决策窗 或 收盘缺失 => null（不插补）", () => {
    expect(computeTrendV2Components(window([10, 10, 10]))).toBeNull();
    const broken = window([10, 10, 10, 10, 10, 10]).map((item, index) => (index === 2 ? { ...item, close: null } : item));
    expect(computeTrendV2Components(broken)).toBeNull();
  });

  it("PIT：入参多于决策窗 => 响亮抛错", () => {
    expect(() => computeTrendV2Components(window([10, 10, 10, 10, 10, 10, 10]))).toThrow(/决策日截断/);
  });

  it("退化单值：三分量等权平均", () => {
    const bars = window([10, 9.6, 9.4, 9.2, 9.0, 8.8]);
    const components = computeTrendV2Components(bars)!;
    expect(computeTrendV2MeanComponent(bars)).toBeCloseTo(
      (components.pullbackDepth + components.negMomentum + components.negWindowGap) / 3,
      12,
    );
  });

  it("分量 id 顺序固定（参与浮点累加）", () => {
    expect(TREND_V2_COMPONENT_IDS).toEqual(["pullbackDepth", "negMomentum", "negWindowGap"]);
  });

  it("融合：(1-w)*3F + w*v2，越界抛错", () => {
    expect(fuseTrendV2IntoThreeFactorScore(0.8, 0.4, 0.25)).toBeCloseTo(0.7, 12);
    expect(() => fuseTrendV2IntoThreeFactorScore(0.8, 0.4, 1.5)).toThrow(/v2Weight/);
    expect(() => fuseTrendV2IntoThreeFactorScore(Number.NaN, 0.4, 0.2)).toThrow(/3F/);
  });
});
