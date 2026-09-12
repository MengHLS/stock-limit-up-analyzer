/**
 * RESEARCH-002 — Metric Calculator 测试。
 *
 * 覆盖：均值 / 中位数 / 标准差 / 分位 / 胜率 / 缺失统计 / 非有限值 / 二元指标 / 稳定性比率 /
 * 未登记指标码拒绝。
 */

import { describe, expect, it } from "vitest";
import {
  BINARY_METRIC_COMPUTATIONS,
  METRIC_COMPUTATIONS,
  MetricCalculator,
  UnknownMetricError,
  alignedPairs,
  directionConsistency,
  finiteValues,
  listMetricCodes,
  listPairedMetricCodes,
  metricCalculator,
  missingStatistics,
  welchTStatistic,
} from "./metrics";
import { RESEARCH_METRIC_CODES } from "../researchCore";

const SAMPLE = [0.02, -0.01, 0.03, 0.0, -0.02];

describe("Metric Calculator", () => {
  it("MEAN / MEDIAN / STD 与手算一致", () => {
    expect(metricCalculator.compute("MEAN", SAMPLE)).toBeCloseTo(0.004, 10);
    expect(metricCalculator.compute("MEDIAN", SAMPLE)).toBeCloseTo(0, 10);
    // 样本标准差（除以 n-1）
    expect(metricCalculator.compute("STD", SAMPLE)).toBeCloseTo(Math.sqrt(0.00172 / 4), 10);
  });

  it("分位数（线性插值，与 shared/quant-stats 同源）", () => {
    expect(metricCalculator.compute("P50", SAMPLE)).toBeCloseTo(0, 10);
    expect(metricCalculator.compute("P10", SAMPLE)).toBeCloseTo(-0.016, 10);
    expect(metricCalculator.compute("P90", SAMPLE)).toBeCloseTo(0.026, 10);
    expect(metricCalculator.compute("MIN", SAMPLE)).toBeCloseTo(-0.02, 10);
    expect(metricCalculator.compute("MAX", SAMPLE)).toBeCloseTo(0.03, 10);
  });

  it("WIN_RATE 严格大于 0（0 计为未胜）", () => {
    expect(metricCalculator.compute("WIN_RATE", SAMPLE)).toBeCloseTo(2 / 5, 10);
    expect(metricCalculator.compute("WIN_RATE", [0, 0, 0])).toBe(0);
  });

  it("非有限值被过滤；样本不足返回 null（绝不产出 NaN / Infinity）", () => {
    expect(metricCalculator.compute("MEAN", [1, NaN, 3, Infinity, null, undefined])).toBe(2);
    expect(metricCalculator.compute("MEAN", [])).toBeNull();
    expect(metricCalculator.compute("MEAN", [NaN, Infinity])).toBeNull();
    expect(metricCalculator.compute("STD", [1])).toBeNull();
    expect(metricCalculator.compute("SKEWNESS", [1, 2])).toBeNull();
  });

  it("PROFIT_FACTOR 在无亏损样本时返回 null（不返回 Infinity）", () => {
    expect(metricCalculator.compute("PROFIT_FACTOR", [0.1, 0.2])).toBeNull();
    const pf = metricCalculator.compute("PROFIT_FACTOR", [0.2, 0.3, -0.1]);
    expect(pf).toBeCloseTo(0.5 / 0.1, 10);
  });

  it("MAX_DRAWDOWN 的口径是「事件级回撤均值」，不是净值曲线回撤", () => {
    expect(METRIC_COMPUTATIONS.MAX_DRAWDOWN!.definition).toContain("事件级");
    expect(metricCalculator.compute("MAX_DRAWDOWN", [-0.05, -0.02])).toBeCloseTo(-0.035, 10);
  });

  it("缺失统计：区分「无样本」与「全缺失」", () => {
    expect(missingStatistics([])).toEqual({ sampleCount: 0, missingCount: 0, missingRate: 0 });
    expect(missingStatistics([null, 1, undefined])).toEqual({
      sampleCount: 3,
      missingCount: 2,
      missingRate: 2 / 3,
    });
  });

  it("finiteValues 不修改入参", () => {
    const input = [1, null, NaN, 2];
    const out = finiteValues(input);
    expect(out).toEqual([1, 2]);
    expect(input).toEqual([1, null, NaN, 2]);
  });

  it("未登记的指标码直接抛错（防止 Analysis 内偷偷自己算）", () => {
    expect(() => metricCalculator.compute("NOT_A_METRIC", [1])).toThrow(UnknownMetricError);
    expect(() => metricCalculator.computeBinary("NOT_A_METRIC", [1], [2])).toThrow(UnknownMetricError);
  });

  it("所有登记指标码都能在 researchCore 指标登记表中找到（零漂移）", () => {
    for (const code of listMetricCodes()) {
      expect(RESEARCH_METRIC_CODES, `指标码 ${code} 未在 RESEARCH_METRIC_CODES 登记`).toContain(code);
    }
    for (const code of Object.keys(BINARY_METRIC_COMPUTATIONS)) {
      expect(RESEARCH_METRIC_CODES, `二元指标码 ${code} 未登记`).toContain(code);
    }
  });

  it("Welch 两样本 t 统计量（可手算验证）", () => {
    // left: mean 2, var 1, n 3；right: mean 0, var 0, n 3 → se² = 1/3 → t = 2/√(1/3)
    expect(welchTStatistic([1, 2, 3], [0, 0, 0])).toBeCloseTo(2 / Math.sqrt(1 / 3), 10);
    expect(welchTStatistic([1], [0, 0])).toBeNull();
    expect(welchTStatistic([1, 1], [1, 1])).toBeNull();
  });

  it("二元指标：顶底差 / 差值 / 相对差值", () => {
    expect(metricCalculator.computeBinary("SPREAD_TOP_BOTTOM", [0.05, 0.07], [0.01, 0.02])).toBeCloseTo(0.045, 10);
    expect(metricCalculator.computeBinary("DIFFERENCE", [0.03, 0.03], [0.01, 0.02])).toBeCloseTo(0.015, 10);
    expect(metricCalculator.computeBinary("RELATIVE_DIFFERENCE", [0.03, 0.03], [0.01, 0.02])).toBeCloseTo(0.015 / 0.015, 10);
    expect(metricCalculator.computeBinary("RELATIVE_DIFFERENCE", [0.03], [0.01, -0.01])).toBeNull();
  });

  it("P_VALUE_DIFFERENCE 由 Welch t 经正态近似得到，且对明显差异给极小 p", () => {
    const p = metricCalculator.computeBinary("P_VALUE_DIFFERENCE", [1, 2, 3, 4, 5], [0, 0, 0, 0, 0]);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.01);
  });

  it("方向一致性：子区间与整体同号占比", () => {
    expect(directionConsistency([0.1, 0.2, 0.3])).toBe(1);
    expect(directionConsistency([0.1, -0.2, 0.3])).toBeCloseTo(2 / 3, 10);
    expect(directionConsistency([0, 0])).toBeNull();
  });

  it("MetricCalculator 是唯一实现：同一 code 只有一个定义对象", () => {
    const a = new MetricCalculator();
    expect(a.compute("MEAN", [1, 2, 3])).toBe(metricCalculator.compute("MEAN", [1, 2, 3]));
    expect(Object.keys(METRIC_COMPUTATIONS).filter((c) => c === "MEAN")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RESEARCH-004 —— 配对（同一样本两条序列）指标
// ---------------------------------------------------------------------------

describe("Metric Calculator — 配对指标", () => {
  it("配对口径：两侧同时有限才成对，缺失不插补、不整对均值填补", () => {
    expect(alignedPairs([1, null, 3], [2, 5, null])).toEqual([[1, 2]]);
    expect(alignedPairs([NaN, 1], [2, 3])).toEqual([[1, 3]]);
    // 长度不等直接抛错：下标错位会让「相关性」变成噪音
    expect(() => alignedPairs([1, 2], [1])).toThrow(/等长/);
  });

  it("PAIR_SAMPLE_COUNT = 真正进入计算的配对样本数（不是任一单侧的样本数）", () => {
    expect(metricCalculator.computePaired("PAIR_SAMPLE_COUNT", [1, null, 3, 4], [2, 5, null, 8])).toBe(2);
  });

  it("PAIR_CORRELATION / PAIR_RANK_CORRELATION 与 shared/quant-stats 同源", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(metricCalculator.computePaired("PAIR_CORRELATION", xs, [2, 4, 6, 8, 10])).toBeCloseTo(1, 12);
    // 完全反向 → 秩相关 −1；皮尔逊在非线性反向时不等于 −1
    expect(metricCalculator.computePaired("PAIR_RANK_CORRELATION", xs, [25, 16, 9, 4, 1])).toBeCloseTo(-1, 12);
    // 配对 < 3 或任一侧变差为 0 → null（不返回一个看似有效的数）
    expect(metricCalculator.computePaired("PAIR_CORRELATION", [1, 2], [1, 2])).toBeNull();
    expect(metricCalculator.computePaired("PAIR_CORRELATION", [1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it("配对指标码同样零漂移（与 RESEARCH_METRIC_CODES 一致），未登记码直接抛错", () => {
    expect(listPairedMetricCodes()).toEqual([
      "PAIR_CORRELATION",
      "PAIR_RANK_CORRELATION",
      "PAIR_SAMPLE_COUNT",
    ]);
    for (const code of listPairedMetricCodes()) {
      expect(RESEARCH_METRIC_CODES, `配对指标码 ${code} 未登记`).toContain(code);
    }
    expect(() => metricCalculator.computePaired("NOT_A_METRIC", [1], [1])).toThrow(UnknownMetricError);
    // 口径查询要覆盖三层（普通 / 二元 / 配对），否则结果 metadata 会缺定义
    expect(metricCalculator.definitionOf("PAIR_CORRELATION")).toBeTruthy();
    expect(metricCalculator.labelOf("PAIR_RANK_CORRELATION")).toBe("配对秩相关");
  });
});
