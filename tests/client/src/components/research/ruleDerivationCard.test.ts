/**
 * PHASE-D-001 — 规则派生链卡片的**读取判据**测试（编号 `9cb`）。
 *
 * 本仓前端测试是**纯逻辑**测试（无 jsdom / @testing-library）⇒ 可测的、也是真正决定
 * 「该卡渲染与否」的，就是 `readDerivation` 这一个函数。因此这里只测它：
 *   - 没有 `sourceTraceJson` ⇒ null（老候选 / 关闭派生的候选：**整卡不渲染**）；
 *   - 有但缺 `derivation` 段 ⇒ null（不兜底）；
 *   - 畸形（字符串 / 数组 / 缺字段）⇒ 保持沉默，不抛；
 *   - 正常 ⇒ 逐字段读出，且非法元素被过滤（不把 `null` 混进表格）。
 */

import { describe, expect, it } from "vitest";
import { readDerivation } from "../../../../../client/src/components/research/RuleDerivationCard";

/**
 * 页面传进来的 `raw` 就是**候选对象本身**（`CandidateRawLike`）；本夹具为可读性多包了一层
 * `candidate`，这里统一解包 —— 免得为每种嵌套形态各写一套断言。
 */
function read(wrapped: unknown): ReturnType<typeof readDerivation> {
  const inner = (wrapped as { candidate?: unknown } | null | undefined)?.candidate;
  return readDerivation(inner ?? wrapped);
}

const WELL_FORMED = {
  candidate: {
    id: 1020003,
    sourceTraceJson: {
      snapshotKind: "research_conclusion_evidence",
      derivation: {
        derivationVersion: "research-evidence-derivation@1.0.0",
        fingerprint: "1b5cc6ed242809e8d9f0e26e701075daa365880946f5e7031fc244b438fbe70f",
        patternIds: ["first-limit-pullback-hold-shrink"],
        directionMismatchCount: 1,
        explain: "由 1 条研究侧条件派生出策略条件（来自 1 条 Finding）；1 条条件被登记为不可翻译。",
        derivedRules: [
          {
            fieldName: "bar.haircutFromEventLow",
            operator: "<=",
            value: "max_drawdown",
            sourceFindingId: 360002,
            sourceAnalysisId: 1200002,
            sourceFindingTitle: "满足条件…的样本在 future_return_5d 上优于全样本（超额 0.0157）",
            sourceFindingType: "EFFECT",
            researchVariable: "pat_pullback_hold_depth_2d",
            researchCondition: "pat_pullback_hold_depth_2d > 0",
            directionMismatch: true,
            effectExcessReturn: 0.0157,
            effectSampleCount: 1436,
          },
          // 畸形元素：应被过滤（否则表格会渲染出 undefined 行）
          null,
        ],
        skipped: [
          {
            reason: "NOT_PATTERN_SEMANTIC_VARIABLE",
            researchVariable: "pullback_holds_event_open_2d",
            detail: "不是任何 Pattern 语义声明的展开产物",
            sourceFindingId: 360002,
          },
        ],
        evidence: { conclusionId: 1080002, findingIds: [360002], analysisIds: [1200002], runIds: [1200002] },
      },
    },
  },
};

describe("readDerivation", () => {
  it("正常快照 ⇒ 逐字段读出，畸形元素被过滤", () => {
    const view = read(WELL_FORMED);
    expect(view).not.toBeNull();
    expect(view!.derivationVersion).toBe("research-evidence-derivation@1.0.0");
    expect(view!.fingerprint?.startsWith("1b5cc6ed")).toBe(true);
    expect(view!.patternIds).toEqual(["first-limit-pullback-hold-shrink"]);
    expect(view!.explain).toContain("派生出策略条件");
    // 畸形元素（null）不进入表格
    expect(view!.rules).toHaveLength(1);
    expect(view!.rules[0]!.fieldName).toBe("bar.haircutFromEventLow");
    expect(view!.rules[0]!.directionMismatch).toBe(true);
    expect(view!.skipped).toHaveLength(1);
    expect(view!.skipped[0]!.reason).toBe("NOT_PATTERN_SEMANTIC_VARIABLE");
    expect(view!.findingIds).toEqual([360002]);
  });

  it("没有 sourceTraceJson（老候选）⇒ null（整卡不渲染）", () => {
    expect(read({ candidate: { id: 1 } })).toBeNull();
    expect(read({ candidate: { sourceTraceJson: null } })).toBeNull();
  });

  it("有 sourceTraceJson 但缺 derivation 段（关闭派生的候选）⇒ null（不兜底）", () => {
    expect(
      read({
        candidate: { sourceTraceJson: { snapshotKind: "research_conclusion_evidence", derivation: null } },
      }),
    ).toBeNull();
    expect(
      read({ candidate: { sourceTraceJson: { snapshotKind: "research_conclusion_evidence" } } }),
    ).toBeNull();
  });

  it("畸形输入 ⇒ 保持沉默（返回 null 或空数组，绝不抛）", () => {
    expect(read(null)).toBeNull();
    expect(read(undefined)).toBeNull();
    expect(read("not-an-object")).toBeNull();
    expect(read([])).toBeNull();
    expect(read({ candidate: { sourceTraceJson: "{}" } })).toBeNull();
  });

  it("derivation 存在但字段缺失/类型错 ⇒ 缺的读作 null/空，不编造", () => {
    const view = read({
      candidate: {
        sourceTraceJson: {
          derivation: { derivedRules: "not-an-array", skipped: [], patternIds: [1, "ok"], evidence: {} },
        },
      },
    });
    expect(view).not.toBeNull();
    expect(view!.rules).toEqual([]);
    expect(view!.skipped).toEqual([]);
    // 非字符串元素被过滤（不会把数字渲染成 Pattern 名）
    expect(view!.patternIds).toEqual(["ok"]);
    expect(view!.explain).toBeNull();
    expect(view!.fingerprint).toBeNull();
    expect(view!.derivationVersion).toBeNull();
    expect(view!.findingIds).toEqual([]);
  });
});
