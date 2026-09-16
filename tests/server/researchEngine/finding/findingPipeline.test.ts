/**
 * RESEARCH-FINDING-001 B4 —— 评分 / 组合 / 前视 / 域守卫 单测。
 *
 * 覆盖任务书 §32 Unit 清单中的：
 *   Interaction / Finding status / Hypothesis validation / Look-ahead validation
 * 以及 §14 评分纪律（缺失维度**重归一化**，而不是补 0）。
 */

import { describe, expect, it } from "vitest";

import type {
  ResearchConditionOperator,
  ResearchConditionSet,
  ResearchFinding,
  ResearchResult,
} from "../../../../server/researchCore";
import {
  DEFAULT_FINDING_POLICY,
  ResearchFindingError,
  assertEngineFindingCreationStatus,
  assertResearchFinding,
} from "../../../../server/researchCore";
import {
  assertConditionsSignalSafe,
  assertHypothesisReadyForCandidate,
  ResearchHypothesisError,
} from "../../../../server/researchCore/hypotheses";
import { FindingScorer, evidenceEffectMagnitude, monotonicityStrengthOf } from "../../../../server/researchEngine/finding/findingScorer";
import { FindingInteractionAnalyzer } from "../../../../server/researchEngine/finding/findingInteractionAnalyzer";
import { parseAnalysisSeries } from "../../../../server/researchEngine/finding/resultView";
import type { AnalysisSeries, FindingDraft } from "../../../../server/researchEngine/finding/types";

const POLICY = DEFAULT_FINDING_POLICY;

function effectOf(excessReturn: number): FindingDraft["effect"] {
  return {
    groupReturn: 0.02 + excessReturn,
    benchmarkReturn: 0.02,
    excessReturn,
    benchmarkUnavailable: false,
    benchmarkSource: "in-analysis:analysis=1.group=ALL",
    medianReturn: null,
    winRate: null,
    buckets: [],
  };
}

function draftOf(patch: Partial<FindingDraft>): FindingDraft {
  return { findingType: "EFFECT", title: "测试发现", ...patch };
}

describe("§14 研究评分", () => {
  it("缺失维度**重归一化**：只有 effect 可用时，总分 = effect 分（不被未测维度拖低）", () => {
    const b = FindingScorer.breakdown(draftOf({ effect: effectOf(0.02) }), POLICY);
    // effectStrengthOf(0.02) = 0.5 + 0.5 * ((0.02-0.005)/(0.005*3)) = 1.0
    expect(b.effectStrength).toBeCloseTo(1, 6);
    expect(b.sampleStrength).toBeNull();
    expect(b.stabilityStrength).toBeNull();
    expect(b.researchStrength).toBeCloseTo(1, 6);
    expect(b.researchStrengthGrade).toBe("STRONG");
  });

  it("五维全不可用 ⇒ 总分 null（无法评估，而不是 0 分）", () => {
    const b = FindingScorer.breakdown(draftOf({}), POLICY);
    expect(b.researchStrength).toBeNull();
    expect(b.researchStrengthGrade).toBeNull();
  });

  it("效应量在无基准时取档位间真实差异（§6「寻找明显差异」）", () => {
    const draft = draftOf({
      effect: {
        groupReturn: 0.05,
        benchmarkReturn: null,
        excessReturn: null,
        benchmarkUnavailable: true,
        benchmarkSource: "unavailable",
        medianReturn: null,
        winRate: null,
        buckets: [
          { label: "Q1", metricValue: 0.01, sampleCount: 100 },
          { label: "Q5", metricValue: 0.06, sampleCount: 100 },
        ],
      },
    });
    expect(evidenceEffectMagnitude(draft)).toBeCloseTo(0.05, 6);
  });

  it("score 恒写 DISCOVERED（引擎无权宣布 SUPPORTED）", () => {
    expect(FindingScorer.score(draftOf({}), POLICY).status).toBe("DISCOVERED");
  });

  it("§9 PEAK 的单调性取**更强的单调腿**（而非整体秩相关）", () => {
    const draft = draftOf({
      findingType: "PEAK_RELATION",
      monotonicity: {
        pattern: "PEAK",
        reversalAt: "Q4",
        rankCorrelation: 0,
        buckets: [
          { label: "Q1", metricValue: 0.01, sampleCount: 10 },
          { label: "Q2", metricValue: 0.02, sampleCount: 10 },
          { label: "Q3", metricValue: 0.03, sampleCount: 10 },
          { label: "Q4", metricValue: 0.04, sampleCount: 10 },
          { label: "Q5", metricValue: 0.005, sampleCount: 10 },
        ],
      },
    });
    expect(monotonicityStrengthOf(draft, POLICY)).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// §12 组合
// ---------------------------------------------------------------------------

const CLAUSE_DEPTH = { fieldName: "pullback_depth", operator: ">=" as ResearchConditionOperator, value: 0.03 };
const CLAUSE_OPEN = { fieldName: "break_limit_up_open", operator: "==" as ResearchConditionOperator, value: false };

function conditionSet(
  clauseGroups: Array<Array<{ fieldName: string; operator: ResearchConditionOperator; value: unknown }>>,
): ResearchConditionSet {
  return {
    groups: clauseGroups.map((clauses, gi) => ({
      groupNo: gi + 1,
      groupLogicalOperator: "AND" as const,
      conditions: clauses.map((c, ci) => ({
        groupNo: gi + 1,
        sortOrder: ci + 1,
        fieldName: c.fieldName,
        operator: c.operator,
        value: c.value,
        logicalOperator: "AND" as const,
        groupLogicalOperator: "AND" as const,
      })),
    })),
  };
}

/** 造一个 CONDITIONAL 序列（ALL + CONDITION + DIFFERENCE 标量）。 */
function conditionalSeries(analysisId: number, all: number, cond: number): AnalysisSeries {
  const rows: ResearchResult[] = [
    {
      id: analysisId * 10 + 1,
      analysisId,
      resultType: "GROUPED",
      dimension: { group: "ALL" },
      metricCode: "MEAN_RETURN",
      metricValue: all,
      sampleCount: 20000,
      details: { conditionRule: "see-analysis-condition-rows" },
    },
    {
      id: analysisId * 10 + 2,
      analysisId,
      resultType: "GROUPED",
      dimension: { group: "CONDITION" },
      metricCode: "MEAN_RETURN",
      metricValue: cond,
      sampleCount: 4000,
      details: { conditionRule: "see-analysis-condition-rows" },
    },
    {
      id: analysisId * 10 + 3,
      analysisId,
      resultType: "SCALAR",
      dimension: null,
      metricCode: "DIFFERENCE",
      metricValue: cond - all,
      sampleCount: 4000,
      details: null,
    },
  ];
  return parseAnalysisSeries({ analysisId, analysisType: "CONDITIONAL", target: "future_return_5d", results: rows })!;
}

function effectFinding(id: number, analysisId: number, excess: number): ResearchFinding {
  return {
    id,
    experimentId: 1,
    runId: 1,
    primaryAnalysisId: analysisId,
    findingType: "EFFECT",
    title: `条件分析 ${analysisId}`,
    summary: null,
    status: "DISCOVERED",
    target: "future_return_5d",
    dimension: null,
    sourceResultIds: [analysisId * 10 + 1],
    effect: effectOf(excess),
    sample: null,
    horizon: null,
    stability: null,
    monotonicity: null,
    interaction: null,
    limitations: null,
    evidence: null,
    fingerprint: null,
    researchStrength: 0.5,
  };
}

describe("§12 Interaction —— 有 Result 才产 Finding，否则只产未验证假设", () => {
  const seriesByAnalysisId = new Map<number, AnalysisSeries>([
    [1, conditionalSeries(1, 0.015, 0.055)],
    [2, conditionalSeries(2, 0.015, 0.035)],
    [3, conditionalSeries(3, 0.015, 0.065)],
  ]);
  const baseFindings = [effectFinding(101, 1, 0.04), effectFinding(102, 2, 0.02)];

  it("存在纯合取且子句 ⊇ 并集的分析 ⇒ 产出 INTERACTION Finding（引用真实 findingIds）", () => {
    const conditionSets = new Map([
      [1, conditionSet([[CLAUSE_DEPTH]])],
      [2, conditionSet([[CLAUSE_OPEN]])],
      [3, conditionSet([[CLAUSE_DEPTH, CLAUSE_OPEN]])],
    ]);
    const { confirmed, untested } = FindingInteractionAnalyzer.analyze({
      baseFindings,
      seriesByAnalysisId,
      conditionSets,
      policy: POLICY,
    });
    expect(untested).toHaveLength(0);
    expect(confirmed).toHaveLength(1);
    const c = confirmed[0]!;
    expect(c.findingType).toBe("INTERACTION");
    expect(c.primaryAnalysisId).toBe(3);
    expect(c.interaction?.tested).toBe(true);
    expect(c.interaction?.findingIds).toEqual([101, 102]);
    expect(c.interaction?.combinedEffect).toBeCloseTo(0.05, 6);
    expect(c.interaction?.singleEffect).toBeCloseTo(0.04, 6);
    expect(c.title).toContain("增强");
    expect(c.sourceResultIds).toEqual([31, 32, 33]);
  });

  it("没有任何分析覆盖组合 ⇒ **不产 Finding**，只回传 untested（任务书 §12）", () => {
    const conditionSets = new Map([
      [1, conditionSet([[CLAUSE_DEPTH]])],
      [2, conditionSet([[CLAUSE_OPEN]])],
    ]);
    const { confirmed, untested } = FindingInteractionAnalyzer.analyze({
      baseFindings,
      seriesByAnalysisId,
      conditionSets,
      policy: POLICY,
    });
    expect(confirmed).toHaveLength(0);
    expect(untested).toHaveLength(1);
    expect(untested[0]!.findingIds).toEqual([101, 102]);
    expect(untested[0]!.reason).toContain("不产出 Finding");
  });

  it("组合分析含 OR ⇒ 不认（保守充分条件，宁可说没验证过）", () => {
    const orSet = conditionSet([[CLAUSE_DEPTH, CLAUSE_OPEN]]);
    orSet.groups[0]!.conditions[1]!.logicalOperator = "OR";
    const conditionSets = new Map([
      [1, conditionSet([[CLAUSE_DEPTH]])],
      [2, conditionSet([[CLAUSE_OPEN]])],
      [3, orSet],
    ]);
    const { confirmed, untested } = FindingInteractionAnalyzer.analyze({
      baseFindings,
      seriesByAnalysisId,
      conditionSets,
      policy: POLICY,
    });
    expect(confirmed).toHaveLength(0);
    expect(untested).toHaveLength(1);
  });

  it("互为子集的两条条件不算组合（无信息量）", () => {
    const conditionSets = new Map([
      [1, conditionSet([[CLAUSE_DEPTH]])],
      [2, conditionSet([[CLAUSE_DEPTH]])],
    ]);
    const { confirmed, untested } = FindingInteractionAnalyzer.analyze({
      baseFindings,
      seriesByAnalysisId,
      conditionSets,
      policy: POLICY,
    });
    expect(confirmed).toHaveLength(0);
    expect(untested).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §21 前视 / §13 状态 / §3.1 provenance
// ---------------------------------------------------------------------------

describe("§21 Look-ahead —— Outcome 不得进入信号条件", () => {
  it("Outcome 字段出现在条件中 ⇒ 拒绝", () => {
    const set = conditionSet([[{ fieldName: "future_return_5d", operator: ">", value: 0 }]]);
    expect(() => assertConditionsSignalSafe(set, (f) => f.startsWith("future_return"))).toThrow(
      ResearchHypothesisError,
    );
  });

  it("仅特征 / 观察日字段 ⇒ 通过", () => {
    const set = conditionSet([
      [{ fieldName: "pullback_depth", operator: ">=", value: 0.03 }],
      [{ fieldName: "obs_5d_low", operator: ">=", value: 0.01 }],
    ]);
    expect(() => assertConditionsSignalSafe(set, (f) => f.startsWith("future_return"))).not.toThrow();
  });
});

describe("§13 Finding 状态 / §3.1 provenance 守卫", () => {
  it("引擎不能写 DISCOVERED 以外的状态", () => {
    expect(() => assertEngineFindingCreationStatus("DISCOVERED")).not.toThrow();
    for (const s of ["REVIEWED", "SUPPORTED", "WEAK", "CONTRADICTED", "REJECTED"] as const) {
      expect(() => assertEngineFindingCreationStatus(s)).toThrow(ResearchFindingError);
    }
  });

  it("无 Result provenance 的 Finding 被拒绝（禁止凭空产生发现）", () => {
    expect(() =>
      assertResearchFinding({
        experimentId: 1,
        findingType: "EFFECT",
        title: "凭空发现",
        status: "DISCOVERED",
        primaryAnalysisId: null,
        sourceResultIds: [],
      }),
    ).toThrow(ResearchFindingError);

    expect(() =>
      assertResearchFinding({
        experimentId: 1,
        findingType: "EFFECT",
        title: "有证据",
        status: "DISCOVERED",
        primaryAnalysisId: 7,
        sourceResultIds: null,
      }),
    ).not.toThrow();
  });
});

describe("§18 Hypothesis → Candidate 资格", () => {
  it("非 SUPPORTED 的假设不得转 Candidate", () => {
    // 「形式化」与「阶段」是**两道独立闸门**：SUPPORTED 的假设同样必须四件套齐备。
    const base = {
      experimentId: 1,
      name: "h",
      statement: "s",
      conditions: conditionSet([[CLAUSE_DEPTH]]),
      target: "future_return_5d",
      horizon: "T+5",
    };
    expect(() => assertHypothesisReadyForCandidate({ ...base, status: "TESTABLE" })).toThrow(ResearchHypothesisError);
    expect(() => assertHypothesisReadyForCandidate({ ...base, status: "SUPPORTED" })).not.toThrow();
  });

  it("SUPPORTED 但未形式化（缺 conditions/target/horizon）仍被拒", () => {
    expect(() =>
      assertHypothesisReadyForCandidate({
        experimentId: 1,
        name: "h",
        statement: "s",
        status: "SUPPORTED",
      }),
    ).toThrow(ResearchHypothesisError);
  });
});
