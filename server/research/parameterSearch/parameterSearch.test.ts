/**
 * STEP 17 / C-17.1 — Grid / Random Parameter Search 测试。
 *
 * 覆盖（验收 §19 + 任务验收 ①-⑦）：
 *   ① Grid 全组合正确（与 combinationGenerator 对照）；
 *   ② Random 确定性（同 seed 同结果 / 不同 seed 不同）；
 *   ③ 稳定区判定：好区 + 坏区样本 → 候选区正确、坏点率生效；
 *   ④ 候选策略产出（kind = "candidate"，非 production/final 语义）；
 *   ⑤ SearchRun 记录完整（seed/budget/空间指纹/被评样本数/结论/fingerprint）round-trip；
 *   ⑥ evaluator 注入端到端（搜索 → 评估 → 候选闭环）；
 *   ⑦ 退化输入 / 参数校验。
 *   另：C-16.1 performanceMetrics 只读桥 / 非法指标转记 failed。
 */

import { describe, expect, it } from "vitest";
import { generateParameterCombinations } from "../combinationGenerator";
import { computeParameterSpaceFingerprint } from "../sweep";
import type { ParameterSpace } from "../parameterSpace";
import type { EquityPoint } from "../../backtest/types";
import { evaluatePerformance } from "../performanceMetrics/evaluate";
import {
  fromPerformanceEvaluationRun16,
  fromPerformanceMetrics16,
} from "./metrics";
import {
  analyzeCandidateRegion,
  resolveRegionAnalysisConfig,
} from "./region";
import { runGridSearch, runParameterSearch, runRandomSearch } from "./run";
import {
  computeParameterSearchCandidateFingerprint,
  computeParameterSearchRunFingerprint,
  deserializeParameterSearchCandidate,
  deserializeParameterSearchRun,
  serializeParameterSearchCandidate,
  serializeParameterSearchRun,
  validateParameterSearchRun,
} from "./serialize";
import type {
  ParameterSearchCandidateStrategy,
  ParameterSearchEvaluatedSample,
  ParameterSearchEvaluator,
  ParameterSearchRun,
} from "./types";
import {
  PARAMETER_SEARCH_CANDIDATE_RECORD_KIND,
  PARAMETER_SEARCH_CANDIDATE_RECORD_VERSION,
} from "./types";

// ---------------------------------------------------------------------------
// 测试 helpers
// ---------------------------------------------------------------------------

function ok(
  totalReturnPct: number,
  maxDrawdownPct: number,
  tradeCount: number | null = 1,
): ReturnType<ParameterSearchEvaluator> {
  return { status: "succeeded", metrics: { totalReturnPct, maxDrawdownPct, tradeCount } };
}

function sample(
  parameterSet: Record<string, number | string | boolean>,
  totalReturnPct: number,
  maxDrawdownPct: number,
  tradeCount: number | null = 1,
): ParameterSearchEvaluatedSample {
  return {
    parameterSet,
    status: "succeeded",
    totalReturnPct,
    maxDrawdownPct,
    tradeCount,
    error: null,
  };
}

function failedSample(
  parameterSet: Record<string, number | string | boolean>,
  error: string,
): ParameterSearchEvaluatedSample {
  return {
    parameterSet,
    status: "failed",
    totalReturnPct: null,
    maxDrawdownPct: null,
    tradeCount: null,
    error,
  };
}

/** 构造逐日上行权益曲线（equity 递增，无回撤）。 */
function risingCurve(values: readonly number[]): EquityPoint[] {
  const start = new Date(Date.UTC(2024, 0, 1));
  return values.map((equity, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      cash: equity,
      marketValue: 0,
      equity,
      openPositions: 0,
    };
  });
}

const DEFAULT_STRATEGY = { strategyId: "strategy-x", strategyVersion: "1.0.0" };

// ---------------------------------------------------------------------------
// ① Grid：与 combinationGenerator 对照
// ---------------------------------------------------------------------------

describe("Grid Search — 全组合正确（与 combinationGenerator 对照）", () => {
  it("evaluatedSamples 与 generateParameterCombinations 逐组合一致，记录元信息正确", () => {
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "x", min: 1, max: 3, step: 1 },
        { type: "enum", name: "mode", values: ["a", "b"] },
      ],
    };
    const expected = generateParameterCombinations(space);
    expect(expected).toHaveLength(6);

    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      evaluator: (ps) => ok(10, 3),
      searchRunId: "SEARCH-grid-cmp",
      createdAt: "2026-09-07T00:00:00.000Z",
    });

    expect(run.evaluatedSamples.map((entry) => entry.parameterSet)).toEqual(expected);
    expect(run.method).toBe("grid");
    expect(run.seed).toBeNull();
    expect(run.combinationCount).toBe(6);
    expect(run.sampleCount).toBe(6);
    expect(run.requestedBudget).toBe(6);
    expect(run.evaluatedSamples.every((entry) => entry.status === "succeeded")).toBe(true);
  });

  it("空参数空间 → 单个空参数集样本（组合语义与 STEP 6.3 一致）", () => {
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: { parameters: [] },
      evaluator: () => ok(5, 3),
      searchRunId: "SEARCH-grid-empty",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(run.sampleCount).toBe(1);
    expect(run.combinationCount).toBe(1);
    expect(run.evaluatedSamples[0]!.parameterSet).toEqual({});
    expect(run.region.qualifiedCount).toBe(1);
  });

  it("grid 超过 maxCombinations → 生成前抛错（不截断）", () => {
    const space: ParameterSpace = {
      parameters: [
        { type: "integer", name: "x", min: 1, max: 4, step: 1 },
        { type: "integer", name: "y", min: 1, max: 3, step: 1 },
      ],
    };
    expect(() =>
      runParameterSearch({
        ...DEFAULT_STRATEGY,
        method: "grid",
        parameterSpace: space,
        evaluator: () => ok(5, 3),
        maxCombinations: 5,
      }),
    ).toThrow(/超过上限/);
  });
});

// ---------------------------------------------------------------------------
// ② Random：确定性
// ---------------------------------------------------------------------------

describe("Random Search — 确定性（同 seed 同结果 / 不同 seed 不同）", () => {
  const space: ParameterSpace = {
    parameters: [{ type: "integer", name: "x", min: 1, max: 10, step: 1 }],
  };

  it("同 seed + 同注入元数据 → 整条记录深比较相等（含 fingerprint）", () => {
    const request = {
      ...DEFAULT_STRATEGY,
      method: "random" as const,
      parameterSpace: space,
      seed: 7,
      budget: 4,
      evaluator: (ps: { x: number }) => ok(10 + (ps.x as number) * 2, 5, null),
      searchRunId: "SEARCH-rand-det",
      createdAt: "2026-09-07T00:00:00.000Z",
    };
    const run1 = runParameterSearch(request);
    const run2 = runParameterSearch(request);
    expect(run2).toEqual(run1);
    expect(run1.fingerprint).toBe(computeParameterSearchRunFingerprint(run1));
  });

  it("不同 seed → 采样样本集合不同", () => {
    const wideSpace: ParameterSpace = {
      parameters: [{ type: "integer", name: "x", min: 0, max: 19, step: 1 }],
    };
    const runA = runRandomSearch({
      ...DEFAULT_STRATEGY,
      parameterSpace: wideSpace,
      seed: 1,
      budget: 5,
      evaluator: () => ok(5, 3),
    });
    const runB = runRandomSearch({
      ...DEFAULT_STRATEGY,
      parameterSpace: wideSpace,
      seed: 2,
      budget: 5,
      evaluator: () => ok(5, 3),
    });
    expect(runA.evaluatedSamples.map((entry) => entry.parameterSet)).not.toEqual(
      runB.evaluatedSamples.map((entry) => entry.parameterSet),
    );
    expect(runA.evaluatedSamples).toHaveLength(5);
    expect(runB.evaluatedSamples).toHaveLength(5);
  });

  it("budget = 1 → 恰 1 个样本", () => {
    const run = runRandomSearch({
      ...DEFAULT_STRATEGY,
      parameterSpace: space,
      seed: 3,
      budget: 1,
      evaluator: () => ok(5, 3),
    });
    expect(run.sampleCount).toBe(1);
    expect(run.requestedBudget).toBe(1);
  });

  it("budget 超过空间基数 → 采样收敛为全组合（无重复），requestedBudget 如实记录", () => {
    const smallSpace: ParameterSpace = {
      parameters: [{ type: "integer", name: "x", min: 1, max: 3, step: 1 }],
    };
    const run = runRandomSearch({
      ...DEFAULT_STRATEGY,
      parameterSpace: smallSpace,
      seed: 5,
      budget: 10,
      evaluator: () => ok(5, 3),
    });
    expect(run.combinationCount).toBe(3);
    expect(run.sampleCount).toBe(3);
    expect(run.requestedBudget).toBe(10);
    const sets = run.evaluatedSamples.map((entry) => entry.parameterSet);
    expect(new Set(sets.map((entry) => JSON.stringify(entry))).size).toBe(3);
  });

  it("混合类型空间：采样值落在各参数离散取值集合内、样本无重复", () => {
    const mixedSpace: ParameterSpace = {
      parameters: [
        { type: "integer", name: "x", min: 1, max: 3, step: 1 },
        { type: "enum", name: "mode", values: ["a", "b"] },
        { type: "boolean", name: "flag" },
      ],
    };
    const run = runRandomSearch({
      ...DEFAULT_STRATEGY,
      parameterSpace: mixedSpace,
      seed: 42,
      budget: 6,
      evaluator: () => ok(5, 3),
    });
    expect(run.sampleCount).toBe(6);
    const xValues = new Set<number>();
    const modeValues = new Set<string>();
    for (const entry of run.evaluatedSamples) {
      const ps = entry.parameterSet;
      expect([1, 2, 3]).toContain(ps.x);
      expect(["a", "b"]).toContain(ps.mode);
      expect(typeof ps.flag).toBe("boolean");
      xValues.add(ps.x as number);
      modeValues.add(ps.mode as string);
    }
    expect(xValues.size).toBeGreaterThan(1);
    expect(modeValues.size).toBeGreaterThan(1);
    const keys = run.evaluatedSamples.map((entry) => JSON.stringify(entry.parameterSet));
    expect(new Set(keys).size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// ③ 稳定区判定（直接喂样本：好区 + 坏区）
// ---------------------------------------------------------------------------

describe("Region Analysis — 稳定参数区判定（非单点最高）", () => {
  const config = resolveRegionAnalysisConfig({}).config;

  it("好区 + 高收益坏区 + 低收益样本 → 候选区只含好区，坏点率生效", () => {
    const evaluated: ParameterSearchEvaluatedSample[] = [
      sample({ theta: 1 }, 12, 3),
      sample({ theta: 2 }, 15, 4),
      sample({ theta: 3 }, 18, 5),
      sample({ theta: 4 }, 14, 30), // 高收益 + 高回撤 → 坏点（即便收益高于部分好点）
      sample({ theta: 5 }, 40, 35), // 全场收益最高但回撤失控 → 坏点，必须被排除
      sample({ theta: 6 }, -2, 3), // 低收益（负收益）→ 排除
    ];

    const report = analyzeCandidateRegion(evaluated, config);

    expect(report.verdict).toBe("stable");
    expect(report.evaluatedCount).toBe(6);
    expect(report.succeededCount).toBe(6);
    expect(report.failedCount).toBe(0);
    expect(report.qualifiedCount).toBe(3);
    expect(report.lowReturnCount).toBe(1);
    expect(report.badDrawdownCount).toBe(2);
    expect(report.badPointRatePct).toBeCloseTo(33.3333, 3);

    // 成员 = 好区（theta 1/2/3），按收益降序（18/15/12）
    const thetas = report.members.map((member) => member.parameterSet.theta);
    expect(thetas).toEqual([3, 2, 1]);
    // 收益最高的 theta=5（40%）不在候选区内 → 明确拒绝「单点历史最高」
    expect(thetas).not.toContain(5);
    expect(thetas).not.toContain(4);
    expect(thetas).not.toContain(6);

    // 聚合：均值/中位数而非单点极值（maxTotalReturnPct = 18，绝不是 40）
    expect(report.aggregate).toEqual({
      qualifiedCount: 3,
      meanTotalReturnPct: 15,
      medianTotalReturnPct: 15,
      minTotalReturnPct: 12,
      maxTotalReturnPct: 18,
      meanMaxDrawdownPct: 4,
      medianMaxDrawdownPct: 4,
      maxMaxDrawdownPct: 5,
    });
    expect(report.candidatesSuppressed).toBe(false);
  });

  it("坏点率超过 maxBadPointRatePct → degraded-bad-point-rate + candidatesSuppressed", () => {
    const evaluated: ParameterSearchEvaluatedSample[] = [
      sample({ theta: 1 }, 10, 2),
      sample({ theta: 2 }, 30, 20),
      sample({ theta: 3 }, 31, 21),
      sample({ theta: 4 }, 32, 22),
      sample({ theta: 5 }, 33, 23),
      sample({ theta: 6 }, 34, 24),
      sample({ theta: 7 }, 35, 25),
      sample({ theta: 8 }, 36, 26),
      sample({ theta: 9 }, 37, 27),
      sample({ theta: 10 }, 38, 28),
    ];
    const report = analyzeCandidateRegion(evaluated, config);
    expect(report.qualifiedCount).toBe(1);
    expect(report.badDrawdownCount).toBe(9);
    expect(report.badPointRatePct).toBeCloseTo(90, 3);
    expect(report.verdict).toBe("degraded-bad-point-rate");
    expect(report.candidatesSuppressed).toBe(true);
  });

  it("全部样本失败 → no-qualified-samples（结构化，不抛错）", () => {
    const evaluated = [
      failedSample({ theta: 1 }, "回测失败"),
      failedSample({ theta: 2 }, "回测失败"),
    ];
    const report = analyzeCandidateRegion(evaluated, config);
    expect(report.verdict).toBe("no-qualified-samples");
    expect(report.succeededCount).toBe(0);
    expect(report.failedCount).toBe(2);
    expect(report.qualifiedCount).toBe(0);
    expect(report.badPointRatePct).toBeNull();
    expect(report.aggregate).toBeNull();
  });

  it("合格样本不足 minQualifiedSamples → insufficient-qualified-samples", () => {
    const evaluated = [sample({ theta: 1 }, 10, 3), sample({ theta: 2 }, 12, 4)];
    const strict = resolveRegionAnalysisConfig({ minQualifiedSamples: 3 }).config;
    const report = analyzeCandidateRegion(evaluated, strict);
    expect(report.qualifiedCount).toBe(2);
    expect(report.verdict).toBe("insufficient-qualified-samples");
    expect(report.candidatesSuppressed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ④ 候选策略产出 + ⑤ 记录 round-trip + fingerprint
// ---------------------------------------------------------------------------

describe("Candidate Strategies — §19 候选语义 + fingerprint", () => {
  it("候选 kind = candidate、参数 + 绩效摘要 + 溯源 + 指纹自洽", () => {
    const space: ParameterSpace = {
      parameters: [{ type: "integer", name: "lookback", min: 5, max: 20, step: 5 }],
    };
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      evaluator: (ps) => ok(20 + (ps.lookback as number), 6, 7),
      searchRunId: "SEARCH-cand",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(run.region.verdict).toBe("stable");
    expect(run.candidates).toHaveLength(4);

    run.candidates.forEach((candidate, index) => {
      expect(candidate.recordKind).toBe(PARAMETER_SEARCH_CANDIDATE_RECORD_KIND);
      expect(candidate.recordVersion).toBe(PARAMETER_SEARCH_CANDIDATE_RECORD_VERSION);
      expect(candidate.strategyKind).toBe("candidate");
      expect(candidate.strategyId).toBe(DEFAULT_STRATEGY.strategyId);
      expect(candidate.strategyVersion).toBe(DEFAULT_STRATEGY.strategyVersion);
      expect(candidate.searchRunId).toBe("SEARCH-cand");
      expect(candidate.candidateId).toBe(`SEARCH-cand-candidate-${index}`);

      // 溯源：sampleIndex 指向 evaluatedSamples 对应条目
      const source = run.evaluatedSamples[candidate.sampleIndex]!;
      expect(source.parameterSet).toEqual(candidate.parameterSet);
      expect(source.status).toBe("succeeded");
      expect(candidate.performance).toEqual({
        totalReturnPct: source.totalReturnPct,
        maxDrawdownPct: source.maxDrawdownPct,
        tradeCount: source.tradeCount,
      });
      // 指纹自洽
      expect(candidate.fingerprint).toBe(computeParameterSearchCandidateFingerprint(candidate));
    });

    // 无任何 promotion：记录本身不含 production/final 语义字段
    const kinds = new Set(run.candidates.map((candidate) => candidate.strategyKind));
    expect(kinds).toEqual(new Set(["candidate"]));
  });

  it("候选策略序列化 → 反序列化 round-trip（指纹复核通过）", () => {
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: { parameters: [{ type: "integer", name: "k", min: 1, max: 2, step: 1 }] },
      evaluator: () => ok(5, 3),
      searchRunId: "SEARCH-cand-serial",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    const candidate: ParameterSearchCandidateStrategy = run.candidates[0]!;
    const restored = deserializeParameterSearchCandidate(serializeParameterSearchCandidate(candidate));
    expect(restored).toEqual(candidate);
  });
});

describe("SearchRun 记录 — 完整性 + round-trip", () => {
  const space: ParameterSpace = {
    parameters: [
      { type: "integer", name: "lookback", min: 5, max: 15, step: 5 },
      { type: "boolean", name: "useTrendFilter" },
    ],
  };

  it("记录含 seed/budget/参数空间指纹/被评样本数/结论/fingerprint", () => {
    const run = runRandomSearch({
      ...DEFAULT_STRATEGY,
      parameterSpace: space,
      seed: 11,
      budget: 3,
      evaluator: () => ok(8, 4),
      searchRunId: "SEARCH-full",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(run.method).toBe("random");
    expect(run.seed).toBe(11);
    expect(run.requestedBudget).toBe(3);
    expect(run.sampleCount).toBe(3);
    expect(run.combinationCount).toBe(6);
    expect(run.parameterSpaceFingerprint).toBe(computeParameterSpaceFingerprint(space));
    expect(run.evaluatedSamples).toHaveLength(3);
    expect(run.region.qualifiedCount).toBe(3);
    expect(run.candidates).toHaveLength(3);
    expect(run.createdAt).toBe("2026-09-07T00:00:00.000Z");
    expect(run.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(run.fingerprint).toBe(computeParameterSearchRunFingerprint(run));
  });

  it("serialize → deserialize round-trip：结构校验通过、全等、指纹不变", () => {
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      evaluator: (ps) => ok(5 + (ps.lookback as number), ps.useTrendFilter ? 2 : 6),
      searchRunId: "SEARCH-rt",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    const json = serializeParameterSearchRun(run);
    const restored = deserializeParameterSearchRun(json);
    expect(restored).toEqual(run);
    expect(validateParameterSearchRun(restored).valid).toBe(true);
  });

  it("篡改被评样本绩效 → 反序列化指纹复核失败（防篡改）", () => {
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      evaluator: () => ok(9, 3),
      searchRunId: "SEARCH-tamper",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    const tampered = JSON.parse(serializeParameterSearchRun(run)) as ParameterSearchRun;
    tampered.evaluatedSamples[0]!.totalReturnPct = 999;
    expect(() => deserializeParameterSearchRun(JSON.stringify(tampered))).toThrow(/指纹不匹配/);
  });
});

// ---------------------------------------------------------------------------
// ⑥ evaluator 注入端到端（搜索 → 评估 → 候选闭环，纯函数、无 IO）
// ---------------------------------------------------------------------------

describe("evaluator 注入端到端", () => {
  it("小型假 evaluator：高收益坏区被排除，只产出好区候选（非历史最高）", () => {
    const space: ParameterSpace = {
      parameters: [{ type: "integer", name: "theta", min: 1, max: 6, step: 1 }],
    };
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: space,
      evaluator: (ps) => {
        const theta = ps.theta as number;
        if (theta <= 3) return ok(10 + theta * 3, 2 + theta, 5); // 好区：收益 13/16/19，回撤 3/4/5
        if (theta === 6) return ok(-1, 3, 0); // 低收益
        return ok(25 + theta, 30 + theta, 0); // 高收益 + 高回撤（theta 4/5）
      },
      searchRunId: "SEARCH-e2e",
      createdAt: "2026-09-07T00:00:00.000Z",
    });

    expect(run.evaluatedSamples).toHaveLength(6);
    expect(run.region.qualifiedCount).toBe(3);
    expect(run.region.badDrawdownCount).toBe(2);
    expect(run.region.lowReturnCount).toBe(1);
    expect(run.region.verdict).toBe("stable");

    const thetas = run.candidates.map((candidate) => candidate.parameterSet.theta);
    expect(thetas).toEqual([3, 2, 1]);
    // 收益最高的 theta=5（≈30 高回撤）不是候选
    expect(thetas).not.toContain(5);

    // 闭环：每个候选的绩效摘要与 evaluatedSamples 一致
    for (const candidate of run.candidates) {
      const source = run.evaluatedSamples[candidate.sampleIndex]!;
      expect(candidate.performance.totalReturnPct).toBe(source.totalReturnPct);
      expect(candidate.performance.maxDrawdownPct).toBe(source.maxDrawdownPct);
    }
  });

  it("坏点率主导空间 + requireStableCandidates=false → 仍产出合格候选（verdict 保留 degraded）", () => {
    const space: ParameterSpace = {
      parameters: [{ type: "integer", name: "theta", min: 1, max: 10, step: 1 }],
    };
    const request = {
      ...DEFAULT_STRATEGY,
      method: "grid" as const,
      parameterSpace: space,
      evaluator: (ps: { theta: number }) =>
        (ps.theta === 1 ? ok(10, 2) : ok(30, 20)),
      analysis: { requireStableCandidates: false },
      searchRunId: "SEARCH-lenient",
      createdAt: "2026-09-07T00:00:00.000Z",
    };
    const run = runParameterSearch(request);
    expect(run.region.verdict).toBe("degraded-bad-point-rate");
    expect(run.region.candidatesSuppressed).toBe(false);
    expect(run.candidates).toHaveLength(1);
    expect(run.candidates[0]!.parameterSet.theta).toBe(1);

    // 严格默认 → 同一数据不产出候选（坏点率门生效）
    const strict = runParameterSearch({ ...request, analysis: undefined });
    expect(strict.region.verdict).toBe("degraded-bad-point-rate");
    expect(strict.region.candidatesSuppressed).toBe(true);
    expect(strict.candidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C-16.1 桥 + 非法指标
// ---------------------------------------------------------------------------

describe("metrics 桥与非法指标", () => {
  it("fromPerformanceEvaluationRun16 / fromPerformanceMetrics16 映射正确（只读桥）", () => {
    const curve = risingCurve([10000, 10500, 11000]);
    const run16 = evaluatePerformance({ equityCurve: curve });
    expect(run16.metrics.returns.totalReturnPct).toBeCloseTo(10, 6);

    const view = fromPerformanceEvaluationRun16(run16);
    expect(view.totalReturnPct).toBeCloseTo(10, 6);
    expect(view.maxDrawdownPct).toBe(0);
    expect(view.tradeCount).toBeNull();

    const viewFromMetrics = fromPerformanceMetrics16(run16.metrics);
    expect(viewFromMetrics.totalReturnPct).toBe(view.totalReturnPct);
    expect(viewFromMetrics.maxDrawdownPct).toBe(0);
  });

  it("评估产物含 NaN / 负回撤 → 样本转记 failed（结构化错误，run 不中断）", () => {
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 2, step: 1 }] },
      evaluator: (ps) => {
        if (ps.x === 1) return { status: "succeeded", metrics: { totalReturnPct: Number.NaN, maxDrawdownPct: 3, tradeCount: 1 } };
        return { status: "succeeded", metrics: { totalReturnPct: 5, maxDrawdownPct: -1, tradeCount: 1 } };
      },
      searchRunId: "SEARCH-badmetrics",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(run.evaluatedSamples[0]!.status).toBe("failed");
    expect(run.evaluatedSamples[0]!.error).toMatch(/totalReturnPct/);
    expect(run.evaluatedSamples[1]!.status).toBe("failed");
    expect(run.evaluatedSamples[1]!.error).toMatch(/maxDrawdownPct.*负|负/);
    expect(run.region.failedCount).toBe(2);
    expect(run.region.verdict).toBe("no-qualified-samples");
    expect(run.candidates).toHaveLength(0);
  });

  it("evaluator 抛异常 → 该样本转记 failed（其他样本正常评估）", () => {
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 3, step: 1 }] },
      evaluator: (ps) => {
        if (ps.x === 2) throw new Error("boom");
        return ok(5, 3);
      },
      searchRunId: "SEARCH-throw",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(run.evaluatedSamples.map((entry) => entry.status)).toEqual(["succeeded", "failed", "succeeded"]);
    expect(run.evaluatedSamples[1]!.error).toContain("评估器抛错");
    expect(run.evaluatedSamples[1]!.error).toContain("boom");
    expect(run.region.qualifiedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 退化输入 / 参数校验
// ---------------------------------------------------------------------------

describe("退化输入 / 参数校验", () => {
  it("random 缺 seed → 抛错", () => {
    expect(() =>
      runParameterSearch({
        ...DEFAULT_STRATEGY,
        method: "random",
        parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 3, step: 1 }] },
        evaluator: () => ok(5, 3),
      }),
    ).toThrow(/seed/);
  });

  it("random budget = 0 / 非整数 → 抛错", () => {
    const base = {
      ...DEFAULT_STRATEGY,
      method: "random" as const,
      seed: 1,
      parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 3, step: 1 }] },
      evaluator: () => ok(5, 3),
    };
    expect(() => runParameterSearch({ ...base, budget: 0 })).toThrow(/budget/);
    expect(() => runParameterSearch({ ...base, budget: 1.5 })).toThrow(/budget/);
  });

  it("非法参数空间（min > max）→ 抛错", () => {
    expect(() =>
      runGridSearch({
        ...DEFAULT_STRATEGY,
        method: "grid",
        parameterSpace: { parameters: [{ type: "integer", name: "x", min: 5, max: 1, step: 1 }] },
        evaluator: () => ok(5, 3),
      }),
    ).toThrow(/不能大于/);
  });

  it("空 strategyId → 抛错", () => {
    expect(() =>
      runGridSearch({
        strategyId: "",
        strategyVersion: "1.0.0",
        method: "grid",
        parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 2, step: 1 }] },
        evaluator: () => ok(5, 3),
      }),
    ).toThrow(/strategyId/);
  });

  it("evaluator 非法 → 抛错", () => {
    expect(() =>
      runParameterSearch({
        ...DEFAULT_STRATEGY,
        method: "grid",
        parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 2, step: 1 }] },
        evaluator: undefined as unknown as ParameterSearchEvaluator,
      }),
    ).toThrow(/evaluator/);
  });

  it("非法稳定区口径（maxDrawdownPct < 0 / maxBadPointRatePct > 100）→ 抛错", () => {
    const base = {
      ...DEFAULT_STRATEGY,
      method: "grid" as const,
      parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 2, step: 1 }] },
      evaluator: () => ok(5, 3),
    };
    expect(() => runParameterSearch({ ...base, analysis: { maxDrawdownPct: -1 } })).toThrow(/maxDrawdownPct/);
    expect(() => runParameterSearch({ ...base, analysis: { maxBadPointRatePct: 120 } })).toThrow(/maxBadPointRatePct/);
  });

  it("runGridSearch / runRandomSearch 便捷入口固定 method", () => {
    const run = runGridSearch({
      ...DEFAULT_STRATEGY,
      method: "random", // 被强制为 grid
      parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 2, step: 1 }] },
      evaluator: () => ok(5, 3),
      searchRunId: "SEARCH-wrapper",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(run.method).toBe("grid");
    expect(run.seed).toBeNull();

    const randomRun = runRandomSearch({
      ...DEFAULT_STRATEGY,
      method: "grid",
      seed: 9,
      budget: 1,
      parameterSpace: { parameters: [{ type: "integer", name: "x", min: 1, max: 2, step: 1 }] },
      evaluator: () => ok(5, 3),
      searchRunId: "SEARCH-wrapper2",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(randomRun.method).toBe("random");
    expect(randomRun.seed).toBe(9);
  });

  it("空参数空间 random → 单空样本（退化结构化）", () => {
    const run = runRandomSearch({
      ...DEFAULT_STRATEGY,
      parameterSpace: { parameters: [] },
      seed: 4,
      budget: 1,
      evaluator: () => ok(5, 3),
      searchRunId: "SEARCH-empty-rand",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
    expect(run.sampleCount).toBe(1);
    expect(run.evaluatedSamples[0]!.parameterSet).toEqual({});
  });
});
