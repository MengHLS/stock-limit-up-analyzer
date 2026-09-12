/**
 * RESEARCH-001 — 结果层模型测试（指令 §10 / §22 / §23）。
 *
 * 覆盖：单值 / 分组 / 序列构造；结构化 vs JSON 边界；NaN / Infinity 拒绝；
 * 「不是样本层」的结构性约束（分组结果每组一行，维度进 dimensionJson）。
 */

import { describe, expect, it } from "vitest";
import {
  assertResearchResult,
  groupedResults,
  isResearchMetricCode,
  RESEARCH_METRIC_CODES,
  ResearchResultError,
  scalarResult,
  seriesResults,
} from "./results";

describe("Research 结果层", () => {
  it("指标码集合覆盖指令 §9 列举的核心指标", () => {
    for (const code of [
      "MEAN_RETURN",
      "MEDIAN_RETURN",
      "WIN_RATE",
      "MAX_DRAWDOWN",
      "IC",
      "RANK_IC",
      "ICIR",
      "T_STAT",
      "P_VALUE",
    ]) {
      expect(isResearchMetricCode(code), `缺少指标码 ${code}`).toBe(true);
      expect(RESEARCH_METRIC_CODES).toContain(code);
    }
  });

  it("单值结果：MEAN_RETURN = 0.0283 结构化落 metricValue", () => {
    const r = scalarResult({ analysisId: 1, metricCode: "MEAN_RETURN", metricValue: 0.0283, sampleCount: 120 });
    expect(r.resultType).toBe("SCALAR");
    expect(r.metricCode).toBe("MEAN_RETURN");
    expect(r.metricValue).toBeCloseTo(0.0283, 6);
    expect(r.dimension).toBeNull();
    expect(() => assertResearchResult(r)).not.toThrow();
  });

  it("分组结果：Q1..Q10 每组一行，维度进 dimensionJson", () => {
    const rows = groupedResults({
      analysisId: 1001,
      metricCode: "MEAN_RETURN",
      dimensionKey: "quantile",
      groups: [
        { label: 1, metricValue: 0.012, sampleCount: 50 },
        { label: 10, metricValue: 0.056, sampleCount: 48 },
      ],
    });
    expect(rows.length).toBe(2);
    expect(rows[0].resultType).toBe("GROUPED");
    expect(rows[0].dimension).toEqual({ quantile: 1 });
    expect(rows[1].metricValue).toBeCloseTo(0.056, 6);
    for (const r of rows) expect(() => assertResearchResult(r)).not.toThrow();
  });

  it("分组结果的 dimensionKey 不能为空", () => {
    expect(() =>
      groupedResults({ analysisId: 1, metricCode: "MEAN_RETURN", dimensionKey: "  ", groups: [] }),
    ).toThrow(/dimensionKey 不能为空/);
  });

  it("序列结果：逐年 IC 每点一行", () => {
    const rows = seriesResults({
      analysisId: 2,
      metricCode: "IC",
      points: [
        { dimension: { year: 2024 }, metricValue: 0.031 },
        { dimension: { year: 2025 }, metricValue: -0.008 },
      ],
    });
    expect(rows.map((r) => r.resultType)).toEqual(["SERIES", "SERIES"]);
    expect(rows[0].dimension).toEqual({ year: 2024 });
  });

  it("拒绝 NaN / Infinity（禁止非有限数值进入结果层）", () => {
    expect(() => assertResearchResult(scalarResult({ analysisId: 1, metricCode: "IC", metricValue: NaN }))).toThrow(
      ResearchResultError,
    );
    expect(() =>
      assertResearchResult(scalarResult({ analysisId: 1, metricCode: "IC", metricValue: Infinity })),
    ).toThrow(/有限数值/);
  });

  it("SCALAR 结果的 dimension 必须为 null（结构化边界）", () => {
    expect(() =>
      assertResearchResult({
        analysisId: 1,
        resultType: "SCALAR",
        dimension: { quantile: 1 },
        metricCode: "IC",
        metricValue: 0.01,
        sampleCount: 10,
        details: null,
      }),
    ).toThrow(/SCALAR 结果的 dimension 必须为 null/);
  });

  it("GROUPED 结果必须带非空 dimension", () => {
    expect(() =>
      assertResearchResult({
        analysisId: 1,
        resultType: "GROUPED",
        dimension: null,
        metricCode: "IC",
        metricValue: 0.01,
        sampleCount: 10,
        details: null,
      }),
    ).toThrow(/必须提供 dimension/);
  });

  it("sampleCount 必须非负整数", () => {
    expect(() =>
      assertResearchResult({
        analysisId: 1,
        resultType: "SCALAR",
        dimension: null,
        metricCode: "IC",
        metricValue: 0.01,
        sampleCount: -1,
        details: null,
      }),
    ).toThrow(/非负整数/);
  });

  it("非法 analysisId 被拒绝", () => {
    expect(() => assertResearchResult(scalarResult({ analysisId: 0, metricCode: "IC", metricValue: 1 }))).toThrow(
      /非法 analysisId/,
    );
  });

  it("metricValue 允许为 null（复杂结果走 resultJson）", () => {
    expect(() =>
      assertResearchResult({
        analysisId: 1,
        resultType: "SCALAR",
        dimension: null,
        metricCode: "CONFIDENCE_INTERVAL_LOW",
        metricValue: null,
        sampleCount: 100,
        details: { low: 0.01, high: 0.05 },
      }),
    ).not.toThrow();
  });
});
