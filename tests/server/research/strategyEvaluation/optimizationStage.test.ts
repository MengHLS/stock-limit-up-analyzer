/**
 * 闭环 `optimization` 阶段两个纯函数的单测 —— STEP B 落点③ 的接线件。
 *
 * 为什么值得单独锁死：
 *   1. `deriveParameterSpaceFromDocument` 是「搜索空间从哪来」的唯一实现。它最容易犯的错是
 *      **替调用方猜界**（缺 `step` 就补 1、`min > max` 就交换）—— 那会把「研究者声明的意图」
 *      换成「我们的臆测」，且**产物看起来完全正常**。⇒ 本文件把「缺界就拒绝、不猜」钉死。
 *   2. `projectOptimizationRef` 是交接产物的唯一投影。它最容易犯的错是
 *      **advance 语义漂移**（没有候选却报 `candidate`）与 **静默丢弃**（被排除的参数不出现在
 *      `consistency.note` 里 ⇒ 调用方无从知道优化没覆盖哪些维度，正是 P0-2 的病）。
 */

import { describe, expect, it } from "vitest";
import { projectOptimizationRef } from "../../../../server/research/closedLoopWiring/executors";
import {
  deriveParameterSpaceFromDocument,
  type ParameterSpaceDerivation,
} from "../../../../server/research/strategyEvaluation/parameterSpaceFromDocument";
import type { StrategyDocument } from "../../../../server/research/strategySchema/types";
import type { ResearchParameterDefinition } from "../../../../server/research/types";

function docWith(parameters: ResearchParameterDefinition[]): StrategyDocument {
  return { parameters: { parameters } } as unknown as StrategyDocument;
}

function numberParam(
  name: string,
  extra: Partial<ResearchParameterDefinition> = {},
): ResearchParameterDefinition {
  return { name, type: "number", required: false, ...extra };
}

// ---------------------------------------------------------------------------
// deriveParameterSpaceFromDocument
// ---------------------------------------------------------------------------

describe("deriveParameterSpaceFromDocument", () => {
  it("min / max / step 齐备的数值参数全部进搜索空间，且 excluded 为空", () => {
    const derivation = deriveParameterSpaceFromDocument(
      docWith([
        numberParam("max_drawdown", { min: 0, max: 0.3, step: 0.01 }),
        numberParam("max_volume_ratio", { min: 0.05, max: 1, step: 0.05 }),
      ]),
    );
    expect(derivation.space.parameters).toEqual([
      { type: "number", name: "max_drawdown", min: 0, max: 0.3, step: 0.01 },
      { type: "number", name: "max_volume_ratio", min: 0.05, max: 1, step: 0.05 },
    ]);
    expect(derivation.excluded).toEqual([]);
    expect(derivation.declaredParameterNames).toEqual(["max_drawdown", "max_volume_ratio"]);
  });

  it("🔴 缺 step ⇒ 拒绝进空间并如实给出原因（**不替你猜步长**）", () => {
    const derivation = deriveParameterSpaceFromDocument(
      docWith([numberParam("topN", { min: 1, max: 20 })]),
    );
    expect(derivation.space.parameters).toEqual([]);
    expect(derivation.excluded).toHaveLength(1);
    expect(derivation.excluded[0].name).toBe("topN");
    expect(derivation.excluded[0].reason).toContain("step");
    expect(derivation.declaredParameterNames).toEqual(["topN"]);
  });

  it("🔴 缺 min / max ⇒ 拒绝（范围必须由文档声明）", () => {
    const derivation = deriveParameterSpaceFromDocument(
      docWith([numberParam("minScore", { step: 0.1 })]),
    );
    expect(derivation.space.parameters).toEqual([]);
    expect(derivation.excluded[0].reason).toContain("min");
    expect(derivation.excluded[0].reason).toContain("max");
  });

  it("step = 0 / 负数 / 非有限数 ⇒ 一律拒绝", () => {
    for (const step of [0, -1]) {
      const derivation = deriveParameterSpaceFromDocument(
        docWith([numberParam("p", { min: 0, max: 1, step })]),
      );
      expect(derivation.space.parameters).toEqual([]);
      expect(derivation.excluded[0].reason).toContain("step");
    }
    const infinity = deriveParameterSpaceFromDocument(
      docWith([numberParam("p", { min: 0, max: 1, step: Number.POSITIVE_INFINITY })]),
    );
    expect(infinity.space.parameters).toEqual([]);
  });

  it("🔴 min > max ⇒ 拒绝，**不替它交换**", () => {
    const derivation = deriveParameterSpaceFromDocument(
      docWith([numberParam("p", { min: 1, max: 0, step: 0.1 })]),
    );
    expect(derivation.space.parameters).toEqual([]);
    expect(derivation.excluded[0].reason).toContain("倒挂");
  });

  it("非数值参数（string / boolean）⇒ 如实排除并说明类型，不被静默转成数值", () => {
    const derivation = deriveParameterSpaceFromDocument(
      docWith([
        { name: "mode", type: "string", required: false, allowedValues: ["a", "b"] },
        { name: "flag", type: "boolean", required: false },
        numberParam("ok", { min: 0, max: 1, step: 1 }),
      ]),
    );
    expect(derivation.space.parameters.map(p => p.name)).toEqual(["ok"]);
    expect(derivation.excluded.map(e => e.name)).toEqual(["mode", "flag"]);
    expect(derivation.excluded[0].reason).toContain("string");
    expect(derivation.excluded[1].reason).toContain("boolean");
    // 声明名清单含被排除者 —— 供审计对账
    expect(derivation.declaredParameterNames).toEqual(["mode", "flag", "ok"]);
  });

  it("空参数表 ⇒ 空空间、空 excluded（空不等于错，由调用方决定怎么处理）", () => {
    const derivation = deriveParameterSpaceFromDocument(docWith([]));
    expect(derivation.space.parameters).toEqual([]);
    expect(derivation.excluded).toEqual([]);
    expect(derivation.declaredParameterNames).toEqual([]);
  });

  it("保持文档声明顺序（不排序；顺序是研究者声明的一部分）", () => {
    const derivation = deriveParameterSpaceFromDocument(
      docWith([
        numberParam("z", { min: 0, max: 1, step: 1 }),
        numberParam("a", { min: 0, max: 1, step: 1 }),
      ]),
    );
    expect(derivation.space.parameters.map(p => p.name)).toEqual(["z", "a"]);
  });

  it("排除项不影响可搜索项的产出（**部分可用时不是全盘拒绝**）", () => {
    const derivation = deriveParameterSpaceFromDocument(
      docWith([
        numberParam("good", { min: 0, max: 1, step: 0.5 }),
        numberParam("bad", { min: 0, max: 1 }),
      ]),
    );
    expect(derivation.space.parameters.map(p => p.name)).toEqual(["good"]);
    expect(derivation.excluded.map(e => e.name)).toEqual(["bad"]);
  });
});

// ---------------------------------------------------------------------------
// projectOptimizationRef
// ---------------------------------------------------------------------------

const DERIVATION: ParameterSpaceDerivation = {
  space: {
    parameters: [
      { type: "number", name: "max_drawdown", min: 0, max: 0.3, step: 0.01 },
      { type: "number", name: "max_volume_ratio", min: 0.05, max: 1, step: 0.05 },
    ],
  },
  excluded: [],
  declaredParameterNames: ["max_drawdown", "max_volume_ratio"],
};

function runStub(overrides: {
  verdict: "stable" | "degraded-bad-point-rate" | "insufficient-qualified-samples" | "no-qualified-samples";
  candidateSets?: Record<string, unknown>[];
  badPointRatePct?: number | null;
}) {
  return {
    searchRunId: "OPT-RUN-1",
    fingerprint: "fp-abc",
    method: "random" as const,
    combinationCount: 1240,
    sampleCount: 12,
    region: {
      verdict: overrides.verdict,
      qualifiedCount: overrides.candidateSets?.length ?? 0,
      // 🔴 不能用 `??` —— `null ?? 10` 会变成 10，那样就测不到「null 要写成不适用」
      badPointRatePct: overrides.badPointRatePct === undefined ? 10 : overrides.badPointRatePct,
    },
    candidates: (overrides.candidateSets ?? []).map(parameterSet => ({ parameterSet })),
  };
}

describe("projectOptimizationRef", () => {
  it("stable 且有候选 ⇒ consistency.status = candidate，候选键 = 候选参数键并集（排序）", () => {
    const ref = projectOptimizationRef(
      runStub({
        verdict: "stable",
        candidateSets: [
          { max_volume_ratio: 0.3, max_drawdown: 0.02 },
          { max_volume_ratio: 0.5, max_drawdown: 0.02 },
        ],
      }),
      DERIVATION,
    );
    expect(ref.kind).toBe("optimizationRef");
    expect(ref.synthetic).toBe(false);
    expect(ref.method).toBe("random");
    expect(ref.consistency.status).toBe("candidate");
    expect(ref.candidateParameterKeys).toEqual(["max_drawdown", "max_volume_ratio"]);
    expect(ref.evaluatedCandidateCount).toBe(12);
    expect(ref.source).toEqual({
      module: "parameterSearch",
      moduleRunKind: "PARAMETER_SEARCH_RUN",
      runId: "OPT-RUN-1",
      fingerprint: "fp-abc",
    });
  });

  it("🔴 verdict=stable 但**零候选** ⇒ noStableRegion（不让「没有候选」冒称候选）", () => {
    const ref = projectOptimizationRef(runStub({ verdict: "stable", candidateSets: [] }), DERIVATION);
    expect(ref.consistency.status).toBe("noStableRegion");
    expect(ref.candidateParameterKeys).toEqual([]);
  });

  it("verdict 三态映射：degraded-bad-point-rate ⇒ degraded；其余不足 ⇒ noStableRegion", () => {
    expect(projectOptimizationRef(runStub({ verdict: "degraded-bad-point-rate" }), DERIVATION).consistency.status)
      .toBe("degraded");
    expect(projectOptimizationRef(runStub({ verdict: "insufficient-qualified-samples" }), DERIVATION).consistency.status)
      .toBe("noStableRegion");
    expect(projectOptimizationRef(runStub({ verdict: "no-qualified-samples" }), DERIVATION).consistency.status)
      .toBe("noStableRegion");
  });

  it("🔴 note 必须如实交代搜索边界：预算 / 全网格 / verdict / 搜索键（禁静默）", () => {
    const ref = projectOptimizationRef(runStub({ verdict: "stable", candidateSets: [{}] }), DERIVATION);
    expect(ref.consistency.note).toContain("random 采样 12");
    expect(ref.consistency.note).toContain("全网格 1240");
    expect(ref.consistency.note).toContain("verdict=stable");
    expect(ref.consistency.note).toContain("max_drawdown / max_volume_ratio");
    expect(ref.consistency.note).toContain("全部声明参数均进搜索空间");
  });

  it("🔴 有被排除参数时，note 必须逐条列出（未覆盖的维度不能被藏起来）", () => {
    const derivationWithExcluded: ParameterSpaceDerivation = {
      space: DERIVATION.space,
      excluded: [{ name: "topN", type: "number", reason: "数值参数缺 step（必须 > 0 且有限）" }],
      declaredParameterNames: ["max_drawdown", "max_volume_ratio", "topN"],
    };
    const ref = projectOptimizationRef(
      runStub({ verdict: "insufficient-qualified-samples" }),
      derivationWithExcluded,
    );
    expect(ref.consistency.note).toContain("未进搜索空间的参数");
    expect(ref.consistency.note).toContain("topN");
    expect(ref.consistency.note).toContain("step");
  });

  it("badPointRatePct 为 null ⇒ note 写「不适用」，不写成 0（禁编数）", () => {
    const ref = projectOptimizationRef(
      runStub({ verdict: "no-qualified-samples", badPointRatePct: null }),
      DERIVATION,
    );
    expect(ref.consistency.note).toContain("坏点率 不适用");
  });
});
