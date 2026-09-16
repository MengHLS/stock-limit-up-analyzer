/**
 * RESEARCH-FINDING-001 B4 —— 探测器 / 解析层单测（纯函数，无 DB）。
 *
 * 覆盖任务书 §32 Unit 清单中的：
 *   Effect detection / Sample classification / Horizon consistency / Stability /
 *   Monotonicity / Interaction（后者见 findingPipeline.test.ts）
 */

import { describe, expect, it } from "vitest";

import type { ResearchResult } from "../../../../server/researchCore";
import { DEFAULT_FINDING_POLICY, classifySampleGrade } from "../../../../server/researchCore";
import {
  buildBaselineIndex,
  buildFingerprint,
  detectPattern,
  FindingDetector,
} from "../../../../server/researchEngine/finding/findingDetector";
import { isPureConjunction } from "../../../../server/researchEngine/finding/findingInteractionAnalyzer";
import { buildRangeTexts, isStrictlyIncreasing, parseAnalysisSeries } from "../../../../server/researchEngine/finding/resultView";

const POLICY = DEFAULT_FINDING_POLICY;
const CTX = { baselines: new Map(), policy: POLICY };

/** 构造一行 GROUPED Result。 */
function grouped(input: {
  id: number;
  analysisId: number;
  dimensionKey: string;
  dimensionValue: string | number;
  metricCode: string;
  metricValue: number | null;
  sampleCount?: number | null;
  details?: unknown;
}): ResearchResult {
  return {
    id: input.id,
    analysisId: input.analysisId,
    resultType: "GROUPED",
    dimension: { [input.dimensionKey]: input.dimensionValue },
    metricCode: input.metricCode,
    metricValue: input.metricValue,
    sampleCount: input.sampleCount ?? null,
    details: input.details ?? null,
  };
}

/** 构造 QUANTILE 的 5 档结果（每档 MEAN_RETURN + SAMPLE_COUNT）。 */
function quantileRows(input: {
  analysisId: number;
  values: number[];
  cutPoints: number[];
  samplePerBucket?: number;
  feature?: string;
  target?: string;
}): ResearchResult[] {
  const { analysisId, values, cutPoints } = input;
  const samplePerBucket = input.samplePerBucket ?? 500;
  const details = {
    featureVariable: input.feature ?? "pullback_depth",
    outcomeVariable: input.target ?? "future_return_5d",
    requestedGroups: values.length,
    actualGroups: values.length,
    cutPoints,
    groupingRule: "group(v) = 1 + |{k : v > percentile(feature, k/G)}|",
  };
  const rows: ResearchResult[] = [];
  let id = analysisId * 100;
  values.forEach((v, i) => {
    rows.push(
      grouped({
        id: id++,
        analysisId,
        dimensionKey: "quantile",
        dimensionValue: i + 1,
        metricCode: "MEAN_RETURN",
        metricValue: v,
        sampleCount: samplePerBucket,
        details,
      }),
      grouped({
        id: id++,
        analysisId,
        dimensionKey: "quantile",
        dimensionValue: i + 1,
        metricCode: "SAMPLE_COUNT",
        metricValue: samplePerBucket,
        sampleCount: samplePerBucket,
        details,
      }),
    );
  });
  return rows;
}

describe("§9 detectPattern —— 单调 / 峰 / 谷 / 无", () => {
  it("全正差分 ⇒ 单调上升", () => {
    expect(detectPattern([0.01, 0.02, 0.03, 0.04]).pattern).toBe("MONOTONIC_INCREASING");
  });

  it("全负差分 ⇒ 单调下降", () => {
    expect(detectPattern([0.04, 0.03, 0.02, 0.01]).pattern).toBe("MONOTONIC_DECREASING");
  });

  it("内部最大 ⇒ 峰（并给出反转位置）", () => {
    const r = detectPattern([0.01, 0.02, 0.031, 0.04, 0.01]);
    expect(r.pattern).toBe("PEAK");
    expect(r.reversalIndex).toBe(3);
  });

  it("内部最小 ⇒ 谷", () => {
    const r = detectPattern([0.04, 0.02, 0.01, 0.03, 0.05]);
    expect(r.pattern).toBe("VALLEY");
    expect(r.reversalIndex).toBe(2);
  });

  it("端点即极值 ⇒ NONE（不硬判峰谷）", () => {
    expect(detectPattern([0.05, 0.04, 0.03]).pattern).toBe("MONOTONIC_DECREASING");
    expect(detectPattern([0.01, 0.05, 0.02, 0.06]).pattern).toBe("NONE");
  });

  it("少于 3 档 ⇒ NONE（不足以判定）", () => {
    expect(detectPattern([0.01, 0.02]).pattern).toBe("NONE");
  });
});

describe("§9 区间文字 —— 退化切点一律不编造", () => {
  it("严格递增切点 ⇒ 还原区间", () => {
    const texts = buildRangeTexts([0.02, 0.04, 0.06, 0.08], 5);
    expect(texts[0]).toBe("< 0.0200");
    expect(texts[1]).toBe("[0.0200, 0.0400)");
    expect(texts[4]).toBe(">= 0.0800");
  });

  it("切点全 0（真库 0/1 特征实测）⇒ 全部 null，且判为不严格递增", () => {
    expect(isStrictlyIncreasing([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
    expect(buildRangeTexts([0, 0, 0, 0], 5).every((t) => t === null)).toBe(true);
  });
});

describe("§7 样本分级（阈值配置化）", () => {
  it("按 <100 / 100~299 / 300~999 / >=1000 分级", () => {
    expect(classifySampleGrade(99, POLICY)).toBe("INSUFFICIENT");
    expect(classifySampleGrade(100, POLICY)).toBe("WEAK");
    expect(classifySampleGrade(299, POLICY)).toBe("WEAK");
    expect(classifySampleGrade(300, POLICY)).toBe("MEDIUM");
    expect(classifySampleGrade(999, POLICY)).toBe("MEDIUM");
    expect(classifySampleGrade(1000, POLICY)).toBe("STRONG");
  });
});

describe("resultView —— Result 行 → 有序序列", () => {
  it("QUANTILE：档位带区间文字，且 ordinal 顺序由 quantile 号决定", () => {
    const series = parseAnalysisSeries({
      analysisId: 1,
      analysisType: "QUANTILE",
      target: "future_return_5d",
      results: quantileRows({ analysisId: 1, values: [0.01, 0.02, 0.03, 0.04, 0.05], cutPoints: [0.02, 0.04, 0.06, 0.08] }),
    })!;
    expect(series.dimensionKey).toBe("quantile");
    expect(series.buckets.map((b) => b.rawLabel)).toEqual([1, 2, 3, 4, 5]);
    expect(series.buckets[1]!.label).toBe("Q2 [0.0200, 0.0400)");
    expect(series.assessable).toBe(true);
  });

  it("CONDITIONAL：ALL 进 benchmark，不进 buckets", () => {
    const results: ResearchResult[] = [
      grouped({ id: 11, analysisId: 2, dimensionKey: "group", dimensionValue: "ALL", metricCode: "MEAN_RETURN", metricValue: 0.0152, sampleCount: 23751 }),
      grouped({ id: 12, analysisId: 2, dimensionKey: "group", dimensionValue: "CONDITION", metricCode: "MEAN_RETURN", metricValue: 0.0555, sampleCount: 4482 }),
    ];
    const series = parseAnalysisSeries({ analysisId: 2, analysisType: "CONDITIONAL", target: "future_return_5d", results })!;
    expect(series.benchmark?.metricValue).toBeCloseTo(0.0152, 6);
    expect(series.buckets).toHaveLength(1);
    expect(series.buckets[0]!.label).toBe("CONDITION");
  });

  it("STABILITY：ALL 行进 benchmark；年份切片按数值排序", () => {
    const results: ResearchResult[] = [
      grouped({ id: 21, analysisId: 3, dimensionKey: "year", dimensionValue: 2026, metricCode: "MEAN_RETURN", metricValue: 0.038, sampleCount: 800 }),
      grouped({ id: 22, analysisId: 3, dimensionKey: "year", dimensionValue: 2024, metricCode: "MEAN_RETURN", metricValue: 0.032, sampleCount: 500 }),
      grouped({ id: 23, analysisId: 3, dimensionKey: "year", dimensionValue: 2025, metricCode: "MEAN_RETURN", metricValue: 0.045, sampleCount: 600 }),
      grouped({ id: 24, analysisId: 3, dimensionKey: "year", dimensionValue: "ALL", metricCode: "MEAN_RETURN", metricValue: 0.0383, sampleCount: 23751 }),
    ];
    const series = parseAnalysisSeries({ analysisId: 3, analysisType: "STABILITY", target: "future_return_5d", results })!;
    expect(series.buckets.map((b) => b.rawLabel)).toEqual([2024, 2025, 2026]);
    expect(series.benchmark?.metricValue).toBeCloseTo(0.0383, 6);
  });

  it("DESCRIPTIVE：不可评估（档位是变量名），但可作基准提供者", () => {
    const results: ResearchResult[] = [
      grouped({ id: 31, analysisId: 4, dimensionKey: "variable", dimensionValue: "future_return_5d", metricCode: "MEAN", metricValue: 0.01521, sampleCount: 23751 }),
    ];
    const series = parseAnalysisSeries({ analysisId: 4, analysisType: "DESCRIPTIVE", target: null, results })!;
    expect(series.assessable).toBe(false);
    const index = buildBaselineIndex([series]);
    expect(index.get("future_return_5d")?.metricValue).toBeCloseTo(0.01521, 6);
    expect(index.get("future_return_5d")?.source).toContain("descriptive:analysis=4");
  });
});

describe("§6/§9 QUANTILE 探测", () => {
  it("单调上升且差异达标 ⇒ MONOTONIC_RELATION，档位证据完整", () => {
    const series = parseAnalysisSeries({
      analysisId: 10,
      analysisType: "QUANTILE",
      target: "future_return_5d",
      results: quantileRows({ analysisId: 10, values: [0.01, 0.02, 0.03, 0.04, 0.05], cutPoints: [0.02, 0.04, 0.06, 0.08] }),
    })!;
    const drafts = FindingDetector.detect(series, CTX);
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.findingType).toBe("MONOTONIC_RELATION");
    expect(d.monotonicity?.pattern).toBe("MONOTONIC_INCREASING");
    expect(d.monotonicity?.buckets).toHaveLength(5);
    expect(d.effect?.buckets).toHaveLength(5);
    // 单调 ⇒ 极端档位取末端（规则写死）
    expect(d.effect?.groupReturn).toBeCloseTo(0.05, 6);
    // 无基准 ⇒ 如实标注，不虚构
    expect(d.effect?.benchmarkUnavailable).toBe(true);
    expect(d.effect?.benchmarkSource).toBe("unavailable");
    expect(d.sample?.grade).toBe("MEDIUM"); // 每档 500
    expect(d.sourceResultIds).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009]);
  });

  it("差异低于 materialityAbs ⇒ **不产出** Finding（如实「没有发现」）", () => {
    const series = parseAnalysisSeries({
      analysisId: 11,
      analysisType: "QUANTILE",
      target: "future_return_5d",
      results: quantileRows({ analysisId: 11, values: [0.001, 0.0011, 0.0012, 0.0013, 0.0014], cutPoints: [0.02, 0.04, 0.06, 0.08] }),
    })!;
    expect(FindingDetector.detect(series, CTX)).toHaveLength(0);
  });

  it("退化切点（全 0）⇒ 降级为 EFFECT，且不判定单调", () => {
    const series = parseAnalysisSeries({
      analysisId: 12,
      analysisType: "QUANTILE",
      target: "future_return_5d",
      results: quantileRows({
        analysisId: 12,
        values: [0.01, 0.01, 0.01, 0.05, 0.001],
        cutPoints: [0, 0, 0, 0],
        feature: "is_one_word_hold",
      }),
    })!;
    const drafts = FindingDetector.detect(series, CTX);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.findingType).toBe("EFFECT");
    expect(drafts[0]!.monotonicity).toBeNull();
    expect(drafts[0]!.limitations.some((l) => l.includes("分组退化"))).toBe(true);
    expect(drafts[0]!.evidence).toMatchObject({ degenerateGrouping: true });
  });

  it("有同 Run 基准时报告真实 excessReturn", () => {
    const baselineSeries = parseAnalysisSeries({
      analysisId: 9,
      analysisType: "DESCRIPTIVE",
      target: null,
      results: [
        grouped({ id: 901, analysisId: 9, dimensionKey: "variable", dimensionValue: "future_return_5d", metricCode: "MEAN", metricValue: 0.01, sampleCount: 23751 }),
      ],
    })!;
    const series = parseAnalysisSeries({
      analysisId: 13,
      analysisType: "QUANTILE",
      target: "future_return_5d",
      results: quantileRows({ analysisId: 13, values: [0.01, 0.02, 0.03, 0.04, 0.08], cutPoints: [0.02, 0.04, 0.06, 0.08] }),
    })!;
    const ctx = { baselines: buildBaselineIndex([baselineSeries]), policy: POLICY };
    const d = FindingDetector.detect(series, ctx)[0]!;
    expect(d.effect?.benchmarkUnavailable).toBe(false);
    expect(d.effect?.benchmarkReturn).toBeCloseTo(0.01, 6);
    expect(d.effect?.excessReturn).toBeCloseTo(0.07, 6);
    expect(d.effect?.benchmarkSource).toContain("descriptive:analysis=9");
  });
});

describe("§10 EVENT_STUDY 探测", () => {
  it("识别峰值视界与连续有效区间（对齐任务书示例）", () => {
    const values = [0.011, 0.028, 0.042, 0.039, 0.012];
    const horizons = [1, 3, 5, 10, 20];
    const results: ResearchResult[] = horizons.map((h, i) =>
      grouped({
        id: 500 + i,
        analysisId: 20,
        dimensionKey: "horizon",
        dimensionValue: h,
        metricCode: "MEAN_RETURN",
        metricValue: values[i]!,
        sampleCount: 2000,
        details: { horizon: h },
      }),
    );
    const series = parseAnalysisSeries({ analysisId: 20, analysisType: "EVENT_STUDY", target: null, results })!;
    const drafts = FindingDetector.detect(series, CTX);
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.findingType).toBe("HORIZON_PATTERN");
    expect(d.horizon?.peakHorizon).toBe(5);
    expect(d.horizon?.effectiveHorizonRange).toEqual([3, 10]);
    expect(d.horizon?.directionConsistency).toBeCloseTo(1, 6);
    expect(d.horizon?.points).toHaveLength(5);
    expect(d.effect?.benchmarkUnavailable).toBe(true);
  });
});

describe("§11 STABILITY 探测", () => {
  function stabilitySeries(analysisId: number, slices: Array<{ year: number | string; v: number }>) {
    const results: ResearchResult[] = slices.map((s, i) =>
      grouped({
        id: 700 + i,
        analysisId,
        dimensionKey: "year",
        dimensionValue: s.year,
        metricCode: "MEAN_RETURN",
        metricValue: s.v,
        sampleCount: 600,
        details: { dimension: "year", dimensionKey: "year" },
      }),
    );
    return parseAnalysisSeries({ analysisId, analysisType: "STABILITY", target: "future_return_5d", results })!;
  }

  it("三切片同向 ⇒ stable，effect 恒为 null（稳定性发现不主张效应量）", () => {
    const d = FindingDetector.detect(
      stabilitySeries(30, [
        { year: 2024, v: 0.032 },
        { year: 2025, v: 0.045 },
        { year: 2026, v: 0.038 },
      ]),
      CTX,
    )[0]!;
    expect(d.findingType).toBe("STABILITY");
    expect(d.stability?.stable).toBe(true);
    expect(d.stability?.contradicted).toBe(false);
    expect(d.effect).toBeNull();
    expect(d.title).toContain("方向一致");
  });

  it("正负各半 ⇒ contradicted（不进 SUPPORTED 路线）", () => {
    const d = FindingDetector.detect(
      stabilitySeries(31, [
        { year: 2024, v: 0.05 },
        { year: 2025, v: -0.06 },
      ]),
      CTX,
    )[0]!;
    expect(d.stability?.contradicted).toBe(true);
    expect(d.stability?.stable).toBe(false);
    expect(d.title).toContain("方向明显冲突");
  });

  it("单切片 ⇒ 不产出 Finding（不可评估，不编造「稳定」）", () => {
    expect(FindingDetector.detect(stabilitySeries(32, [{ year: 2024, v: 0.05 }]), CTX)).toHaveLength(0);
  });
});

describe("§12 组合判定辅助", () => {
  it("纯 AND ⇒ 可视为已测试；含 OR / NOT ⇒ 不可", () => {
    const pure = {
      groups: [
        {
          groupNo: 1,
          groupLogicalOperator: "AND" as const,
          conditions: [
            { groupNo: 1, sortOrder: 1, fieldName: "pullback_depth", operator: ">=" as const, value: 0.03, logicalOperator: "AND" as const, groupLogicalOperator: "AND" as const },
            { groupNo: 1, sortOrder: 2, fieldName: "pullback_depth", operator: "<=" as const, value: 0.05, logicalOperator: "AND" as const, groupLogicalOperator: "AND" as const },
          ],
        },
      ],
    };
    expect(isPureConjunction(pure)).toBe(true);
    // ⚠️ 必须让「含 OR 的那条」处在**组内非首条**位置：组内首条的连接符按语义被忽略，
    //    把它放在首位会让判定正确地放过 —— 那是测试构造错误，不是实现问题。
    expect(
      isPureConjunction({
        groups: [
          {
            ...pure.groups[0]!,
            conditions: [
              pure.groups[0]!.conditions[0]!,
              { ...pure.groups[0]!.conditions[1]!, logicalOperator: "OR" },
            ],
          },
        ],
      }),
    ).toBe(false);
    // 组间 OR 同样不被认作纯合取
    expect(
      isPureConjunction({
        groups: [pure.groups[0]!, { ...pure.groups[0]!, groupNo: 2, groupLogicalOperator: "OR" }],
      }),
    ).toBe(false);
  });
});

describe("fingerprint 幂等键", () => {
  it("同 (runId, type, analysis, dimension) ⇒ 同值；任一变化 ⇒ 变值", () => {
    const base = { runId: 5, findingType: "EFFECT", primaryAnalysisId: 7, dimension: { a: 1, b: "x" } };
    const a = buildFingerprint(base);
    const b = buildFingerprint({ ...base, dimension: { b: "x", a: 1 } });
    expect(a).toBe(b);
    expect(a).toHaveLength(40);
    expect(buildFingerprint({ ...base, runId: 6 })).not.toBe(a);
    expect(buildFingerprint({ ...base, findingType: "STABILITY" })).not.toBe(a);
  });
});
