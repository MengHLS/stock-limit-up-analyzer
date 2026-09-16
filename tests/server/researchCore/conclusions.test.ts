/**
 * RESEARCH-FINDING-001 B5 —— Conclusion 领域规则单测（§15 升级 / §26 回写映射）。
 */

import { describe, expect, it } from "vitest";

import {
  RESEARCH_CONCLUSION_STATUSES,
  RESEARCH_HYPOTHESIS_STATUSES,
  type ResearchConclusionStatus,
  type ResearchHypothesisStatus,
} from "../../../server/researchCore";
import {
  CONCLUSION_STATUS_TRANSITIONS,
  ResearchConclusionError,
  assertConclusionFinalizable,
  assertConclusionTransition,
  assertHypothesisWriteback,
  deriveHypothesisTargetStatus,
  planHypothesisStatusPath,
} from "../../../server/researchCore/conclusions";
import { HYPOTHESIS_STATUS_TRANSITIONS, ResearchHypothesisError } from "../../../server/researchCore/hypotheses";

describe("§15 结论状态机", () => {
  it("DRAFT / FINAL 可互转；SUPERSEDED 是终态", () => {
    expect(() => assertConclusionTransition("DRAFT", "FINAL")).not.toThrow();
    expect(() => assertConclusionTransition("FINAL", "DRAFT")).not.toThrow();
    expect(() => assertConclusionTransition("DRAFT", "SUPERSEDED")).not.toThrow();
    expect(() => assertConclusionTransition("FINAL", "SUPERSEDED")).not.toThrow();
    expect(() => assertConclusionTransition("DRAFT", "DRAFT")).not.toThrow(); // 幂等
    for (const to of RESEARCH_CONCLUSION_STATUSES) {
      // 终态语义 = 禁止「离开」SUPERSEDED；同态 no-op（SUPERSEDED→SUPERSEDED）不算转移，不抛。
      if (to === "SUPERSEDED") {
        expect(() => assertConclusionTransition("SUPERSEDED", to)).not.toThrow();
        continue;
      }
      expect(() => assertConclusionTransition("SUPERSEDED", to)).toThrow(ResearchConclusionError);
    }
  });

  it("每个状态的转移目标都在闭集内（防拼写漂移）", () => {
    for (const from of RESEARCH_CONCLUSION_STATUSES) {
      for (const to of CONCLUSION_STATUS_TRANSITIONS[from]) {
        expect(RESEARCH_CONCLUSION_STATUSES).toContain(to);
      }
    }
  });
});

describe("§15 定稿必须已引用 Finding", () => {
  it("findingIds 为空 ⇒ 拒绝定稿", () => {
    expect(() => assertConclusionFinalizable({ findingIds: [] })).toThrow(ResearchConclusionError);
    expect(() => assertConclusionFinalizable({ findingIds: null })).toThrow(ResearchConclusionError);
    expect(() => assertConclusionFinalizable({ findingIds: undefined })).toThrow(ResearchConclusionError);
  });

  it("findingIds 非空 ⇒ 允许", () => {
    expect(() => assertConclusionFinalizable({ findingIds: [1] })).not.toThrow();
  });
});

describe("§26 结论类型 → 假设状态映射", () => {
  it("SUPPORTED / REJECTED 如实映射；PARTIALLY_SUPPORTED 与 INCONCLUSIVE **只**到 TESTED", () => {
    expect(deriveHypothesisTargetStatus("SUPPORTED")).toBe("SUPPORTED");
    expect(deriveHypothesisTargetStatus("REJECTED")).toBe("REJECTED");
    // 🔴 绝不把「部分支持 / 无定论」升格为 SUPPORTED
    expect(deriveHypothesisTargetStatus("PARTIALLY_SUPPORTED")).toBe("TESTED");
    expect(deriveHypothesisTargetStatus("INCONCLUSIVE")).toBe("TESTED");
  });
});

describe("§26 状态推进链", () => {
  it("DRAFT → SUPPORTED 走逐级合法链（不可跳级）", () => {
    expect(planHypothesisStatusPath("DRAFT", "SUPPORTED")).toEqual([
      "DRAFT",
      "TESTABLE",
      "TESTED",
      "SUPPORTED",
    ]);
  });

  it("同态返回单元素；终态不可再推进", () => {
    expect(planHypothesisStatusPath("SUPPORTED", "SUPPORTED")).toEqual(["SUPPORTED"]);
    expect(planHypothesisStatusPath("REJECTED", "SUPPORTED")).toBeNull();
    expect(planHypothesisStatusPath("PROMOTED", "REJECTED")).toBeNull();
  });

  it("TESTABLE → TESTED → SUPPORTED 两段可达", () => {
    expect(planHypothesisStatusPath("TESTABLE", "SUPPORTED")).toEqual(["TESTABLE", "TESTED", "SUPPORTED"]);
  });

  it("🔴 链上每一步都必须被假设状态机认可（两套映射不许漂移）", () => {
    for (const from of RESEARCH_HYPOTHESIS_STATUSES) {
      for (const to of RESEARCH_HYPOTHESIS_STATUSES) {
        const path = planHypothesisStatusPath(from, to);
        if (path === null) continue;
        expect(path[0]).toBe(from);
        expect(path[path.length - 1]).toBe(to);
        for (let i = 1; i < path.length; i += 1) {
          const step = path[i]! as ResearchHypothesisStatus;
          const prev = path[i - 1]! as ResearchHypothesisStatus;
          expect(HYPOTHESIS_STATUS_TRANSITIONS[prev]).toContain(step);
        }
      }
    }
  });

  it("assertHypothesisWriteback 复用假设状态机（非法直跳被拒）", () => {
    expect(() => assertHypothesisWriteback("DRAFT", "SUPPORTED")).toThrow(ResearchHypothesisError);
    expect(() => assertHypothesisWriteback("TESTED", "SUPPORTED")).not.toThrow();
    const statuses: readonly ResearchConclusionStatus[] = RESEARCH_CONCLUSION_STATUSES;
    expect(statuses).toContain("FINAL");
  });
});
