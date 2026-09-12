/**
 * RESEARCH-002 — ConclusionBuilder 测试（保守判定 + 免责声明 + 阈值可复核）。
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONCLUSION_POLICY, buildConclusion, renderConclusionPolicy } from "./conclusion";
import type { AnalysisSummary, ResearchConclusionDraft } from "./types";
import type { ResearchAnalysisType } from "../researchCore";

function summary(overrides: Partial<AnalysisSummary> & { analysisType: ResearchAnalysisType }): AnalysisSummary {
  return {
    effectLabel: "effect",
    effect: 0.05,
    pValue: 0.01,
    tStat: 2.5,
    sampleCount: 500,
    minGroupSampleCount: 50,
    groupCount: 10,
    directionConsistency: 0.9,
    notes: [],
    ...overrides,
  };
}

function build(analyses: Array<{ analysisId: number; summary: AnalysisSummary }>): ResearchConclusionDraft & { evidence: Record<string, unknown> } {
  const { draft } = buildConclusion({
    experiment: { id: 1, name: "换手率与未来5日收益", researchType: "QUANTILE" },
    hypothesis: { id: 2, name: "H1", statement: "换手率不同区间的首板股票，未来5日收益存在系统性差异。" },
    analyses,
  });
  return draft as ResearchConclusionDraft & { evidence: Record<string, unknown> };
}

describe("ConclusionBuilder", () => {
  it("全部达标 → SUPPORTED，且结论正文强制带免责声明", () => {
    const draft = build([{ analysisId: 11, summary: summary({ analysisType: "QUANTILE" }) }]);
    expect(draft.conclusionType).toBe("SUPPORTED");
    expect(draft.conclusion).toContain("研究辅助");
    expect(draft.conclusion).toContain("Backtest");
    expect((draft.evidence as { disclaimer: string }).disclaimer).toContain("研究辅助");
  });

  it("样本不足 → INCONCLUSIVE（即使效应很大）", () => {
    const draft = build([
      { analysisId: 11, summary: summary({ analysisType: "QUANTILE", sampleCount: 12, minGroupSampleCount: 2 }) },
    ]);
    expect(draft.conclusionType).toBe("INCONCLUSIVE");
    expect(draft.conclusion).toContain("样本不足");
  });

  it("效应低于最小实际阈值 → REJECTED（不因 p 值小而宣称有差异）", () => {
    const draft = build([
      { analysisId: 11, summary: summary({ analysisType: "QUANTILE", effect: 0.0001, pValue: 0.0001 }) },
    ]);
    expect(draft.conclusionType).toBe("REJECTED");
    expect(draft.conclusion).toContain("最小实际效应");
  });

  it("方向一致但统计不达标 → PARTIALLY_SUPPORTED", () => {
    const draft = build([
      { analysisId: 11, summary: summary({ analysisType: "QUANTILE", pValue: 0.4 }) },
    ]);
    expect(draft.conclusionType).toBe("PARTIALLY_SUPPORTED");
  });

  it("p 值算不出（null）视为未达标 → PARTIALLY_SUPPORTED（保守）", () => {
    const draft = build([
      { analysisId: 11, summary: summary({ analysisType: "QUANTILE", pValue: null }) },
    ]);
    expect(draft.conclusionType).toBe("PARTIALLY_SUPPORTED");
  });

  it("方向不稳定 → INCONCLUSIVE", () => {
    const draft = build([
      { analysisId: 11, summary: summary({ analysisType: "QUANTILE", directionConsistency: 0.2 }) },
    ]);
    expect(draft.conclusionType).toBe("INCONCLUSIVE");
    expect(draft.conclusion).toContain("方向不稳定");
  });

  it("没有任何可用主效应 → INCONCLUSIVE", () => {
    const draft = build([
      { analysisId: 11, summary: summary({ analysisType: "QUANTILE", effect: null, pValue: null }) },
    ]);
    expect(draft.conclusionType).toBe("INCONCLUSIVE");
    expect(draft.conclusion).toContain("无法评估");
  });

  it("主分析按固定优先级选取（QUANTILE 优先于 EVENT_STUDY），不按效应大小挑选", () => {
    const draft = build([
      { analysisId: 11, summary: summary({ analysisType: "EVENT_STUDY", effect: 0.9 }) },
      { analysisId: 12, summary: summary({ analysisType: "QUANTILE", effect: 0.02 }) },
    ]);
    expect((draft.evidence as { primaryAnalysis: { analysisId: number } }).primaryAnalysis.analysisId).toBe(12);
    expect((draft.evidence as { primarySelectionRule: string }).primarySelectionRule).toContain("固定优先级");
  });

  it("confidence 是主观置信度 [0,1]，且显式标注「不是 p 值」", () => {
    const draft = build([{ analysisId: 11, summary: summary({ analysisType: "QUANTILE" }) }]);
    expect(draft.confidence).toBeGreaterThan(0);
    expect(draft.confidence!).toBeLessThanOrEqual(1);
    const evidence = draft.evidence as { confidenceIsNotPValue: boolean; confidenceBasis: string };
    expect(evidence.confidenceIsNotPValue).toBe(true);
    expect(evidence.confidenceBasis.length).toBeGreaterThan(0);
  });

  it("策略阈值原样写入 evidence（可复核 / 可复现）", () => {
    const draft = build([{ analysisId: 11, summary: summary({ analysisType: "QUANTILE" }) }]);
    expect((draft.evidence as { policy: unknown }).policy).toEqual(DEFAULT_CONCLUSION_POLICY);
    expect(renderConclusionPolicy()).toContain("alpha=0.05");
    expect(renderConclusionPolicy()).toContain("minSampleCount=30");
  });

  it("规则轨迹完整（每一步判定都留痕）", () => {
    const draft = build([{ analysisId: 11, summary: summary({ analysisType: "QUANTILE" }) }]);
    const trace = (draft.evidence as { ruleTrace: Array<{ rule: string; passed: boolean }> }).ruleTrace;
    expect(trace.map((t) => t.rule)).toEqual([
      "R2_样本达标",
      "R3_效应达到最小实际阈值",
      "R4_统计量达标",
      "R5_方向稳定",
    ]);
  });

  /**
   * 回归：证据是前端工作台 / 报告 / 审计共同消费的机器可读契约。
   * 早前「无可用主效应」分支与主判定分支各自手写对象字面量，键集不一致
   * （前者 `trace` / `analyses`，后者 `ruleTrace` / `contributingAnalyses`），
   * 导致下游必须写两套解析分支。本测试锁死「两个分支键集必须完全相同」。
   */
  it("evidence 形状在两个分支间保持一致（单一构造入口）", () => {
    const normal = build([{ analysisId: 11, summary: summary({ analysisType: "QUANTILE" }) }]);
    const degraded = build([
      { analysisId: 11, summary: summary({ analysisType: "QUANTILE", effect: null, pValue: null }) },
    ]);
    const normalKeys = Object.keys(normal.evidence).sort();
    const degradedKeys = Object.keys(degraded.evidence).sort();
    expect(degradedKeys).toEqual(normalKeys);

    // 「没有主分析」用 null 表达，而不是让键消失
    expect(degraded.evidence.primaryAnalysis).toBeNull();
    expect(normal.evidence.primaryAnalysis).not.toBeNull();

    // 两个分支都必须带免责声明与 confidence 语义标注
    for (const draft of [normal, degraded]) {
      const ev = draft.evidence as {
        disclaimer: string;
        confidenceIsNotPValue: boolean;
        ruleTrace: unknown[];
        contributingAnalyses: unknown[];
      };
      expect(ev.disclaimer.length).toBeGreaterThan(0);
      expect(ev.confidenceIsNotPValue).toBe(true);
      expect(Array.isArray(ev.ruleTrace)).toBe(true);
      expect(Array.isArray(ev.contributingAnalyses)).toBe(true);
    }
  });
});
