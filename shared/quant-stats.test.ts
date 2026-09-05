import { describe, expect, it } from "vitest";
import {
  mean,
  median,
  variance,
  sampleVariance,
  standardDeviation,
  sampleStandardDeviation,
  skewness,
  excessKurtosis,
  quantile,
  percentile,
  pearsonCorrelation,
  spearman,
  spearmanCorrelation,
  rankIC,
  sharpeRatio,
  annualizedReturnFromEquityCurve,
  neweyWestMeanTStat,
  normalCdf,
  normalQuantile,
  normalTwoSidedPValue,
  isFiniteNumber,
} from "./quant-stats";

describe("mean", () => {
  it("空数组返回 null", () => { expect(mean([])).toBeNull(); });
  it("单元素返回该值", () => { expect(mean([5])).toBe(5); });
  it("两元素返回算术平均", () => { expect(mean([2, 4])).toBe(3); });
  it("负值与正值混合", () => { expect(mean([-2, 2])).toBe(0); });
  it("过滤 NaN/Infinity", () => {
    expect(mean([1, Number.NaN, 3])).toBe(2);
    expect(mean([1, Number.POSITIVE_INFINITY, 3])).toBe(2);
    expect(mean([Number.NaN])).toBeNull();
  });
  it("不修改输入数组", () => {
    const input = [3, 1, 2];
    mean(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("median", () => {
  it("空数组返回 null", () => { expect(median([])).toBeNull(); });
  it("奇数个取中位", () => { expect(median([3, 1, 2])).toBe(2); });
  it("偶数个取中间均值", () => { expect(median([1, 2, 3, 4])).toBe(2.5); });
  it("单元素返回该值", () => { expect(median([7])).toBe(7); });
  it("过滤 NaN/Infinity", () => {
    expect(median([1, Number.NaN, 3, 5])).toBe(3);
    expect(median([1, Number.POSITIVE_INFINITY, 3])).toBe(2);
  });
  it("不修改输入数组", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("variance / standardDeviation（population vs sample）", () => {
  it("总体方差除以 n", () => { expect(variance([2, 4])).toBe(1); });
  it("样本方差除以 n-1", () => { expect(sampleVariance([2, 4])).toBe(2); });
  it("单元素总体方差为 0", () => { expect(variance([5])).toBe(0); });
  it("单元素样本方差为 null", () => { expect(sampleVariance([5])).toBeNull(); });
  it("空数组两者均为 null", () => {
    expect(variance([])).toBeNull();
    expect(sampleVariance([])).toBeNull();
  });
  it("标准差为方差的平方根", () => {
    expect(standardDeviation([2, 4])).toBe(1);
    expect(sampleStandardDeviation([2, 4])).toBeCloseTo(Math.SQRT2, 10);
  });
  it("常数序列样本标准差为 0", () => { expect(sampleStandardDeviation([3, 3, 3])).toBe(0); });
  it("样本数不足样本标准差为 null", () => { expect(sampleStandardDeviation([3])).toBeNull(); });
});

describe("skewness / excessKurtosis（sample-adjusted Fisher-Pearson）", () => {
  it("样本数不足返回 null", () => {
    expect(skewness([])).toBeNull();
    expect(skewness([1])).toBeNull();
    expect(skewness([1, 2])).toBeNull();
    expect(excessKurtosis([1, 2, 3])).toBeNull();
  });
  it("常数序列返回 null", () => {
    expect(skewness([3, 3, 3, 3])).toBeNull();
    expect(excessKurtosis([3, 3, 3, 3, 3])).toBeNull();
  });
  it("对称序列偏度为 0", () => { expect(skewness([1, 2, 3])).toBeCloseTo(0, 10); });
  it("明显右偏序列偏度为正（已知解析值）", () => { expect(skewness([1, 1, 1, 10])).toBeCloseTo(2, 10); });
  it("均匀分布超额峰度约为 -1.2（已知解析值）", () => { expect(excessKurtosis([1, 2, 3, 4, 5])).toBeCloseTo(-1.2, 10); });
  it("偏度方向正确：右偏为正、左偏为负", () => {
    expect(skewness([1, 2, 2, 2, 3])).toBeCloseTo(0, 10);
    expect(skewness([1, 1, 1, 10])).toBeGreaterThan(0);
    expect(skewness([-10, -1, -1, -1])).toBeLessThan(0);
  });
});

describe("quantile / percentile", () => {
  it("空数组返回 null", () => { expect(quantile([], 0.5)).toBeNull(); });
  it("q 越界返回 null", () => {
    expect(quantile([1, 2, 3], -0.1)).toBeNull();
    expect(quantile([1, 2, 3], 1.1)).toBeNull();
  });
  it("q=0 与 q=1 取极值", () => {
    expect(quantile([3, 1, 2], 0)).toBe(1);
    expect(quantile([3, 1, 2], 1)).toBe(3);
  });
  it("q=NaN 返回 null", () => {
    expect(quantile([1, 2, 3], Number.NaN)).toBeNull();
  });
  it("包含 NaN 的输入先过滤后计算", () => {
    expect(quantile([1, Number.NaN, 3], 0.5)).toBe(2);
  });
  it("中位数等价 median", () => { expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5); });
  it("线性插值（R type 7）", () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(quantile([0, 10], 0.75)).toBe(7.5);
  });
  it("percentile 与 quantile 换算一致", () => {
    expect(percentile([0, 10], 25)).toBe(quantile([0, 10], 0.25));
    expect(percentile([0, 10], 75)).toBe(7.5);
  });
  it("不修改输入数组顺序", () => {
    const input = [3, 1, 2];
    quantile(input, 0.5);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("pearsonCorrelation", () => {
  it("完美正相关为 1", () => { expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10); });
  it("完美负相关为 -1", () => { expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10); });
  it("零相关接近 0", () => {
    expect(Math.abs(pearsonCorrelation([1, 2, 3, 4], [4, 1, 4, 1])!)).toBeLessThan(0.5);
  });
  it("常数向量返回 null", () => { expect(pearsonCorrelation([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull(); });
  it("样本不足返回 null", () => { expect(pearsonCorrelation([1, 2], [1, 2])).toBeNull(); });
  it("长度不一致抛错", () => {
    expect(() => pearsonCorrelation([1, 2, 3], [1, 2])).toThrow();
  });
  it("过滤 null 与 NaN", () => {
    expect(pearsonCorrelation([1, null, 2, 3, 4], [2, null, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(pearsonCorrelation([1, Number.NaN, 2, 3, 4], [2, 4, 4, 6, 8])).toBeCloseTo(1, 10);
  });
});

describe("spearman / spearmanCorrelation", () => {
  it("完全单调递增为 1（非线性但单调）", () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1, 10);
  });
  it("完全单调递减为 -1", () => {
    expect(spearman([1, 2, 3, 4], [16, 9, 4, 1])).toBeCloseTo(-1, 10);
  });
  it("并列值使用平均秩，单调关系仍成立", () => {
    expect(spearman([1, 1, 2, 3], [2, 2, 4, 6])).toBeCloseTo(1, 10);
  });
  it("样本不足返回 null", () => { expect(spearman([1, 2], [1, 2])).toBeNull(); });
  it("可空向量版过滤 null", () => {
    expect(spearmanCorrelation([1, null, 2, 3, 4], [2, null, 4, 6, 8])).toBeCloseTo(1, 10);
  });
  it("长度不一致抛错", () => {
    expect(() => spearman([1, 2, 3], [1, 2])).toThrow();
  });
  it("pairwise 缺失值过滤（与 pearson/rankIC 语义一致）", () => {
    // x=[1,2,NaN,4], y=[1,3,5,7] → 使用 x=[1,2,4], y=[1,3,7] 计算
    expect(spearman([1, 2, Number.NaN, 4], [1, 3, 5, 7])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, Number.NaN, 4], [1, 3, 5, 7])).toBe(spearman([1, 2, 4], [1, 3, 7]));
    expect(spearmanCorrelation([1, 2, null, 4], [1, 3, 5, 7])).toBeCloseTo(1, 10);
  });
  it("pairwise 过滤 Infinity（与 NaN 语义一致）", () => {
    // x=[1,2,Infinity,4], y=[1,3,5,7] → 使用 x=[1,2,4], y=[1,3,7] 计算
    expect(spearman([1, 2, Number.POSITIVE_INFINITY, 4], [1, 3, 5, 7])).toBe(spearman([1, 2, 4], [1, 3, 7]));
    expect(spearman([1, 2, Number.NEGATIVE_INFINITY, 4], [1, 3, 5, 7])).toBe(spearman([1, 2, 4], [1, 3, 7]));
  });
  it("spearman() 与 spearmanCorrelation() 缺失值语义一致", () => {
    const x = [1, 2, Number.NaN, 4, 5];
    const y = [1, 3, 5, 7, 9];
    expect(spearman(x, y)).toBe(spearmanCorrelation(x, y));
    // 不同位置缺失值也应一致（pairwise 只保留两边同时有限）
    const x2 = [1, Number.NaN, 3, 4, 5];
    const y2 = [1, 2, Number.NaN, 7, 9];
    expect(spearman(x2, y2)).toBe(spearmanCorrelation(x2, y2));
  });
  it("spearman 不修改输入数组", () => {
    const x = [3, 1, 2, 4];
    const y = [9, 1, 4, 16];
    spearman(x, y);
    expect(x).toEqual([3, 1, 2, 4]);
    expect(y).toEqual([9, 1, 4, 16]);
  });
});

describe("rankIC", () => {
  it("等于 Spearman 相关", () => {
    expect(rankIC([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1, 10);
  });
  it("rankIC === spearmanCorrelation（含缺失值）", () => {
    const x = [1, 2, null, 4, 5];
    const y = [2, 4, 8, 16, 32];
    expect(rankIC(x, y)).toBe(spearmanCorrelation(x, y));
  });
  it("非完美单调数据下 rankIC === spearmanCorrelation", () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = [2, 5, 1, 8, 3, 9]; // 非完美单调，含噪音
    expect(rankIC(x, y)).not.toBeNull();
    expect(rankIC(x, y)).toBe(spearmanCorrelation(x, y));
  });
});

describe("annualizedReturnFromEquityCurve（CAGR）", () => {
  it("零收益 CAGR 为 0", () => {
    expect(annualizedReturnFromEquityCurve(100, 100, 10)).toBeCloseTo(0, 10);
  });
  it("正收益 CAGR 为正", () => {
    expect(annualizedReturnFromEquityCurve(100, 121, 252)).toBeCloseTo(0.21, 10);
  });
  it("起点/终点非正返回 null", () => {
    expect(annualizedReturnFromEquityCurve(0, 100, 10)).toBeNull();
    expect(annualizedReturnFromEquityCurve(100, 0, 10)).toBeNull();
  });
  it("样本数不足返回 null", () => {
    expect(annualizedReturnFromEquityCurve(100, 110, 0)).toBeNull();
  });
});

describe("sharpeRatio（标准算术年化）", () => {
  it("正收益为正（已知解析值）", () => {
    expect(sharpeRatio([0.01, 0.02, 0.015, 0.018, 0.022, 0.025])).toBeCloseTo(54.739951261861236, 6);
  });
  it("负收益为负（已知解析值）", () => {
    expect(sharpeRatio([-0.01, -0.02, -0.015, -0.018])).toBeCloseTo(-57.48552777076767, 6);
  });
  it("零波动返回 null", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01])).toBeNull();
  });
  it("单观测返回 null", () => {
    expect(sharpeRatio([0.01])).toBeNull();
  });
  it("空数组返回 null", () => {
    expect(sharpeRatio([])).toBeNull();
  });
  it("常数收益返回 null", () => {
    expect(sharpeRatio([0.02, 0.02, 0.02, 0.02])).toBeNull();
  });
  it("自定义年化因子", () => {
    const daily = [0.01, 0.02, 0.015];
    const sharpe252 = sharpeRatio(daily, 252);
    const sharpe1 = sharpeRatio(daily, 1);
    expect(sharpe252).toBeCloseTo(sharpe1! * Math.sqrt(252), 8);
  });
  it("人工构造序列逐项验证 mean / sampleStd / Sharpe", () => {
    const daily = [0.01, 0.02, 0.015, 0.018];
    const m = mean(daily)!;
    const s = sampleStandardDeviation(daily)!;
    expect(m).toBeCloseTo((0.01 + 0.02 + 0.015 + 0.018) / 4, 12);
    expect(s).toBeCloseTo(Math.sqrt(((0.01 - m) ** 2 + (0.02 - m) ** 2 + (0.015 - m) ** 2 + (0.018 - m) ** 2) / 3), 12);
    expect(sharpeRatio(daily)).toBeCloseTo((m / s) * Math.sqrt(252), 10);
  });
  it("过滤 NaN/Infinity 后计算（与纯净序列一致）", () => {
    const clean = [0.01, 0.02, 0.015, 0.018];
    expect(sharpeRatio([0.01, Number.NaN, 0.02, 0.015, Number.POSITIVE_INFINITY, 0.018]))
      .toBe(sharpeRatio(clean));
    expect(sharpeRatio([0.01, Number.NEGATIVE_INFINITY, 0.02, 0.015, 0.018]))
      .toBe(sharpeRatio(clean));
  });
  it("过滤后有效样本不足（< 2）返回 null", () => {
    expect(sharpeRatio([0.01, Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
    expect(sharpeRatio([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toBeNull();
  });
});

describe("neweyWestMeanTStat（回归测试）", () => {
  it("固定输入 HAC t 统计量与旧实现一致（误差 ≤ 1e-10）", () => {
    const result = neweyWestMeanTStat([0.1, -0.05, 0.2, 0.15, -0.1, 0.05]);
    expect(result).not.toBeNull();
    expect(result!.tStat).toBeCloseTo(2.350320903776905, 10);
    expect(result!.se).toBeCloseTo(0.024819305840148537, 10);
  });
  it("样本不足返回 null", () => {
    expect(neweyWestMeanTStat([0.1, 0.2])).toBeNull();
  });
  it("常数序列返回 null", () => {
    expect(neweyWestMeanTStat([0.1, 0.1, 0.1, 0.1])).toBeNull();
  });
  it("显式 lag=0 合法（不返回 null）", () => {
    expect(neweyWestMeanTStat([0.1, -0.05, 0.2, 0.15, -0.1, 0.05], 0)).not.toBeNull();
  });
  it("合法最大 lag = n - 2", () => {
    const series = [0.1, -0.05, 0.2, 0.15, -0.1, 0.05]; // n=6，n-2=4
    expect(neweyWestMeanTStat(series, 4)).not.toBeNull();
  });
  it("非法负 lag 返回 null", () => {
    expect(neweyWestMeanTStat([0.1, -0.05, 0.2, 0.15, -0.1, 0.05], -1)).toBeNull();
  });
  it("非整数 lag 返回 null", () => {
    expect(neweyWestMeanTStat([0.1, -0.05, 0.2, 0.15, -0.1, 0.05], 1.5)).toBeNull();
  });
  it("超过最大 lag（n-1、n）返回 null", () => {
    const series = [0.1, -0.05, 0.2, 0.15, -0.1, 0.05]; // n=6
    expect(neweyWestMeanTStat(series, 5)).toBeNull(); // n-1
    expect(neweyWestMeanTStat(series, 6)).toBeNull(); // n
  });
});

describe("正态分布基础", () => {
  it("normalCdf 标准值", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 8);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("normalCdf 边界：±Infinity 与 NaN", () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalCdf(Number.NaN)).toBeNull();
  });
  it("normalQuantile 与 normalCdf 互逆", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.96, 2);
    expect(normalCdf(normalQuantile(0.9)!)).toBeCloseTo(0.9, 6);
  });
  it("normalQuantile 边界：0/1/NaN", () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 8);
    expect(normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(normalQuantile(1)).toBe(Number.POSITIVE_INFINITY);
    expect(normalQuantile(Number.NaN)).toBeNull();
  });
  it("normalTwoSidedPValue 双尾 p 值", () => {
    expect(normalTwoSidedPValue(0)).toBeCloseTo(1, 8);
    expect(normalTwoSidedPValue(1.96)).toBeCloseTo(0.05, 3);
    expect(normalTwoSidedPValue(-1.96)).toBeCloseTo(0.05, 3);
  });
  it("normalTwoSidedPValue 边界：NaN / ±Infinity", () => {
    expect(normalTwoSidedPValue(Number.NaN)).toBeNull();
    expect(normalTwoSidedPValue(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalTwoSidedPValue(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("isFiniteNumber", () => {
  it("有限数值返回 true", () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
  });
  it("NaN / ±Infinity 返回 false", () => {
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber(Number.NEGATIVE_INFINITY)).toBe(false);
  });
  it("非 number 类型返回 false", () => {
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber("1")).toBe(false);
    expect(isFiniteNumber({})).toBe(false);
  });
});
